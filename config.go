package main

// AppConfig holds the application configuration
type AppConfig struct {
	WindowWidth  int    `yaml:"window_width"`
	WindowHeight int    `yaml:"window_height"`
	DefaultShell string `yaml:"default_shell"`
}

// DefaultConfig returns a new AppConfig with default values
func DefaultConfig() *AppConfig {
	return &AppConfig{
		WindowWidth:  1024,
		WindowHeight: 768,
		DefaultShell: "", // Empty string means use existing detection logic
	}
}
