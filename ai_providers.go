package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/sashabaranov/go-openai"
)

// OpenAIProvider implements the AIProvider interface for OpenAI
type OpenAIProvider struct {
	client  *openai.Client
	modelID string
	apiURL  string
	apiKey  string
}

// NewOpenAIProvider creates a new OpenAI provider
func NewOpenAIProvider(apiURL, apiKey, modelID string) *OpenAIProvider {
	config := openai.DefaultConfig(apiKey)

	// Set custom base URL if provided and different from default
	if apiURL != "" && !strings.Contains(apiURL, "api.openai.com") {
		config.BaseURL = apiURL
	}

	client := openai.NewClientWithConfig(config)

	return &OpenAIProvider{
		client:  client,
		modelID: modelID,
		apiURL:  apiURL,
		apiKey:  apiKey,
	}
}

// SendRequest sends a request to OpenAI API
func (p *OpenAIProvider) SendRequest(ctx context.Context, prompt, systemMessage string) (string, error) {
	if p.apiKey == "" {
		return "", fmt.Errorf("OpenAI API key is not configured")
	}

	messages := []openai.ChatCompletionMessage{}

	// Add system message if provided
	if systemMessage != "" {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleSystem,
			Content: systemMessage,
		})
	}

	// Add user prompt
	messages = append(messages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: prompt,
	})

	req := openai.ChatCompletionRequest{
		Model:       p.modelID,
		Messages:    messages,
		MaxTokens:   1000,
		Temperature: 0.1,
	}

	resp, err := p.client.CreateChatCompletion(ctx, req)
	if err != nil {
		return "", fmt.Errorf("OpenAI API error: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("no response from OpenAI API")
	}

	return resp.Choices[0].Message.Content, nil
}

// TestConnection tests the connection to OpenAI API
func (p *OpenAIProvider) TestConnection(ctx context.Context) error {
	if p.apiKey == "" {
		return fmt.Errorf("OpenAI API key is not configured")
	}

	// Try to list models as a connectivity test
	_, err := p.client.ListModels(ctx)
	if err != nil {
		// Check if it's an authentication error
		if strings.Contains(err.Error(), "401") {
			return fmt.Errorf("invalid API key")
		}
		if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "connection") {
			return fmt.Errorf("connection failed: check your internet connection and API URL")
		}
		return fmt.Errorf("API test failed: %w", err)
	}

	return nil
}

// GetProviderName returns the provider name
func (p *OpenAIProvider) GetProviderName() string {
	return "openai"
}

// ValidateConfig validates the OpenAI provider configuration
func (p *OpenAIProvider) ValidateConfig() error {
	if p.apiKey == "" {
		return fmt.Errorf("API key is required")
	}
	if p.modelID == "" {
		return fmt.Errorf("model ID is required")
	}
	if p.apiURL == "" {
		return fmt.Errorf("API URL is required")
	}
	return nil
}

// GetSupportedModels returns a list of supported OpenAI models
func (p *OpenAIProvider) GetSupportedModels(ctx context.Context) ([]string, error) {
	if p.apiKey == "" {
		// Return default models if no API key
		return []string{
			"gpt-4",
			"gpt-4-turbo-preview",
			"gpt-3.5-turbo",
			"gpt-3.5-turbo-16k",
		}, nil
	}

	models, err := p.client.ListModels(ctx)
	if err != nil {
		// Return default models on error
		return []string{
			"gpt-4",
			"gpt-4-turbo-preview",
			"gpt-3.5-turbo",
			"gpt-3.5-turbo-16k",
		}, nil
	}

	var supportedModels []string
	for _, model := range models.Models {
		// Filter for chat completion models
		if strings.Contains(model.ID, "gpt") {
			supportedModels = append(supportedModels, model.ID)
		}
	}

	return supportedModels, nil
}

// Future provider implementations can be added here:

// GeminiProvider would implement the AIProvider interface for Google Gemini
// type GeminiProvider struct {
//     // Implementation fields
// }
//
// func NewGeminiProvider(apiKey, modelID string) *GeminiProvider {
//     // Implementation
// }
//
// func (p *GeminiProvider) SendRequest(ctx context.Context, prompt, systemMessage string) (string, error) {
//     // Implementation
// }
//
// func (p *GeminiProvider) TestConnection(ctx context.Context) error {
//     // Implementation
// }
//
// func (p *GeminiProvider) GetProviderName() string {
//     return "gemini"
// }
