package main

import (
	"context"
	"fmt"
)

// AI-related Wails bindings

// SendAIRequest sends a prompt to the AI and returns the response
func (a *App) SendAIRequest(prompt string) (*AIResponse, error) {
	if a.ai == nil {
		return nil, fmt.Errorf("AI manager not initialized")
	}

	ctx := context.Background()
	return a.ai.SendRequest(ctx, prompt)
}

// GetAIConfig returns the current AI configuration
func (a *App) GetAIConfig() (*AIConfig, error) {
	if a.config == nil || a.config.config == nil {
		return nil, fmt.Errorf("config not available")
	}

	return &a.config.config.AI, nil
}

// SetAIConfig updates the AI configuration
func (a *App) SetAIConfig(config *AIConfig) error {
	if a.config == nil || a.config.config == nil {
		return fmt.Errorf("config not available")
	}

	if config == nil {
		return fmt.Errorf("AI config cannot be nil")
	}

	// Update the configuration
	a.config.config.AI = *config
	a.markConfigDirty()

	// Update AI manager with new config
	if a.ai != nil {
		if err := a.ai.UpdateConfig(config); err != nil {
			return fmt.Errorf("failed to update AI manager: %w", err)
		}
	}

	return nil
}

// TestAIConnection tests the connection to the configured AI provider
func (a *App) TestAIConnection() map[string]interface{} {
	if a.ai == nil {
		return map[string]interface{}{
			"Success": false,
			"Error":   "AI manager not initialized",
		}
	}

	ctx := context.Background()
	err := a.ai.TestConnection(ctx)
	if err != nil {
		return map[string]interface{}{
			"Success": false,
			"Error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"Success": true,
		"Error":   "",
	}
}

// GetAvailableAIProviders returns a list of available AI providers
func (a *App) GetAvailableAIProviders() ([]string, error) {
	if a.ai == nil {
		return nil, fmt.Errorf("AI manager not initialized")
	}

	return a.ai.GetAvailableProviders(), nil
}

// SetAIProvider changes the current AI provider
func (a *App) SetAIProvider(providerName string) error {
	if a.ai == nil {
		return fmt.Errorf("AI manager not initialized")
	}

	if err := a.ai.SetProvider(providerName); err != nil {
		return err
	}

	// Update config to persist the change
	a.config.config.AI.Provider = providerName
	a.markConfigDirty()

	return nil
}

// GetAISupportedModels returns supported models for the current provider
func (a *App) GetAISupportedModels() ([]string, error) {
	if a.ai == nil {
		return nil, fmt.Errorf("AI manager not initialized")
	}

	provider := a.ai.currentProvider
	if provider == nil {
		return nil, fmt.Errorf("no AI provider configured")
	}

	// Check if provider supports model listing
	if openaiProvider, ok := provider.(*OpenAIProvider); ok {
		ctx := context.Background()
		return openaiProvider.GetSupportedModels(ctx)
	}

	// Return default models for other providers
	return []string{"default"}, nil
}

// EnableAI enables or disables AI features
func (a *App) EnableAI(enabled bool) error {
	if a.config == nil || a.config.config == nil {
		return fmt.Errorf("config not available")
	}

	a.config.config.AI.Enabled = enabled
	a.markConfigDirty()

	return nil
}

// IsAIEnabled returns whether AI features are enabled
func (a *App) IsAIEnabled() bool {
	if a.config == nil || a.config.config == nil {
		return false
	}

	return a.config.config.AI.Enabled
}
