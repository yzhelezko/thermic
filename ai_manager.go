package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// AIProvider defines the interface for AI providers
type AIProvider interface {
	SendRequest(ctx context.Context, prompt, systemMessage string) (string, error)
	TestConnection(ctx context.Context) error
	GetProviderName() string
}

// AIRequest represents a request to the AI
type AIRequest struct {
	Prompt        string `json:"prompt"`
	SystemMessage string `json:"systemMessage"`
	SessionID     string `json:"sessionId,omitempty"`
}

// AIResponse represents a response from the AI
type AIResponse struct {
	Content   string    `json:"content"`
	Provider  string    `json:"provider"`
	Model     string    `json:"model"`
	Timestamp time.Time `json:"timestamp"`
	Error     string    `json:"error,omitempty"`
}

// AIManager manages AI operations and providers
type AIManager struct {
	providers       map[string]AIProvider
	currentProvider AIProvider
	config          *AIConfig
	mutex           sync.RWMutex
	rateLimiter     *RateLimiter
}

// RateLimiter provides basic rate limiting for AI requests
type RateLimiter struct {
	requests    []time.Time
	maxRequests int
	window      time.Duration
	mutex       sync.Mutex
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(maxRequests int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		requests:    make([]time.Time, 0),
		maxRequests: maxRequests,
		window:      window,
	}
}

// Allow checks if a request is allowed under the rate limit
func (rl *RateLimiter) Allow() bool {
	rl.mutex.Lock()
	defer rl.mutex.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	// Remove old requests outside the window
	filtered := rl.requests[:0]
	for _, reqTime := range rl.requests {
		if reqTime.After(cutoff) {
			filtered = append(filtered, reqTime)
		}
	}
	rl.requests = filtered

	// Check if we can make a new request
	if len(rl.requests) >= rl.maxRequests {
		return false
	}

	// Add the current request
	rl.requests = append(rl.requests, now)
	return true
}

// NewAIManager creates a new AI manager
func NewAIManager(config *AIConfig) *AIManager {
	am := &AIManager{
		providers:   make(map[string]AIProvider),
		config:      config,
		rateLimiter: NewRateLimiter(10, time.Minute), // 10 requests per minute
	}

	// Register providers
	am.registerProviders()

	// Set current provider
	if provider, exists := am.providers[config.Provider]; exists {
		am.currentProvider = provider
	}

	return am
}

// registerProviders registers all available AI providers
func (am *AIManager) registerProviders() {
	// Register OpenAI provider
	openaiProvider := NewOpenAIProvider(am.config.APIURL, am.config.APIKey, am.config.ModelID)
	am.providers["openai"] = openaiProvider

	// Future providers can be registered here
	// am.providers["gemini"] = NewGeminiProvider(...)
}

// SendRequest sends a request to the current AI provider
func (am *AIManager) SendRequest(ctx context.Context, prompt string) (*AIResponse, error) {
	am.mutex.RLock()
	defer am.mutex.RUnlock()

	if !am.config.Enabled {
		return nil, fmt.Errorf("AI features are disabled")
	}

	if am.currentProvider == nil {
		return nil, fmt.Errorf("no AI provider configured")
	}

	// Check rate limiting
	if !am.rateLimiter.Allow() {
		return nil, fmt.Errorf("rate limit exceeded, please try again later")
	}

	// Add timeout to context
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Send request to provider
	content, err := am.currentProvider.SendRequest(ctx, prompt, am.config.SystemMessage)
	fmt.Println("content", content)
	response := &AIResponse{
		Provider:  am.currentProvider.GetProviderName(),
		Model:     am.config.ModelID,
		Timestamp: time.Now(),
	}

	if err != nil {
		response.Error = err.Error()
		return response, err
	}

	response.Content = content
	return response, nil
}

// TestConnection tests the connection to the current AI provider
func (am *AIManager) TestConnection(ctx context.Context) error {
	am.mutex.RLock()
	defer am.mutex.RUnlock()

	if am.currentProvider == nil {
		return fmt.Errorf("no AI provider configured")
	}

	// Add timeout to context
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	return am.currentProvider.TestConnection(ctx)
}

// UpdateConfig updates the AI configuration and reinitializes providers
func (am *AIManager) UpdateConfig(config *AIConfig) error {
	am.mutex.Lock()
	defer am.mutex.Unlock()

	am.config = config

	// Re-register providers with new config
	am.registerProviders()

	// Update current provider
	if provider, exists := am.providers[config.Provider]; exists {
		am.currentProvider = provider
	} else {
		return fmt.Errorf("provider '%s' not found", config.Provider)
	}

	return nil
}

// GetAvailableProviders returns a list of available AI providers
func (am *AIManager) GetAvailableProviders() []string {
	am.mutex.RLock()
	defer am.mutex.RUnlock()

	providers := make([]string, 0, len(am.providers))
	for name := range am.providers {
		providers = append(providers, name)
	}
	return providers
}

// SetProvider changes the current AI provider
func (am *AIManager) SetProvider(providerName string) error {
	am.mutex.Lock()
	defer am.mutex.Unlock()

	provider, exists := am.providers[providerName]
	if !exists {
		return fmt.Errorf("provider '%s' not found", providerName)
	}

	am.currentProvider = provider
	am.config.Provider = providerName
	return nil
}
