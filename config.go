package main

import (
	"fmt"
)

const (
	DefaultWindowWidth     = 1024
	DefaultWindowHeight    = 768
	DefaultSidebarWidth    = 250
	DefaultTheme           = "dark" // "dark", "light", or "system"
	DefaultScrollbackLines = 10000

	MinWindowWidth     = 800
	MinWindowHeight    = 600
	MinSidebarWidth    = 100
	MaxSidebarWidth    = 1000
	MaxWindowWidth     = 10000 // Arbitrary large value for upper bound
	MaxWindowHeight    = 10000 // Arbitrary large value for upper bound
	MinScrollbackLines = 100
	MaxScrollbackLines = 100000
)

// ThemeSystem represents the system theme preference.
const ThemeSystem = "system"

// ThemeDark represents the dark theme preference.
const ThemeDark = "dark"

// ThemeLight represents the light theme preference.
const ThemeLight = "light"

// AllowedThemes lists the valid theme names.
var AllowedThemes = []string{ThemeDark, ThemeLight, ThemeSystem}

// PlatformShells holds platform-specific default shell configurations
type PlatformShells struct {
	Windows string `yaml:"windows,omitempty"`
	Linux   string `yaml:"linux,omitempty"`
	Darwin  string `yaml:"darwin,omitempty"`
}

// AIConfig holds AI-related configuration
type AIConfig struct {
	Enabled       bool   `yaml:"enabled"`           // Whether AI features are enabled
	Provider      string `yaml:"provider"`          // AI provider (openai, gemini, etc.)
	APIKey        string `yaml:"api_key,omitempty"` // API key for the provider
	APIURL        string `yaml:"api_url"`           // API endpoint URL
	ModelID       string `yaml:"model_id"`          // Model identifier
	Hotkey        string `yaml:"hotkey"`            // Hotkey to activate AI (default: ctrl+k)
	SystemMessage string `yaml:"system_message"`    // System message for AI context
}

// AppConfig holds the application configuration
type AppConfig struct {
	WindowWidth     int            `yaml:"window_width"`
	WindowHeight    int            `yaml:"window_height"`
	WindowMaximized bool           `yaml:"window_maximized"`
	DefaultShell    string         `yaml:"default_shell,omitempty"` // Legacy field for migration only
	DefaultShells   PlatformShells `yaml:"default_shells"`          // Platform-specific default shells
	ProfilesPath    string         `yaml:"profiles_path,omitempty"` // Custom path for profiles directory
	// Context menu settings
	EnableSelectToCopy bool `yaml:"enable_select_to_copy"` // Enable select-to-copy and right-click-to-paste (disables context menu)
	// Sidebar settings
	SidebarCollapsed     bool `yaml:"sidebar_collapsed"`       // Whether the sidebar is collapsed
	SidebarWidth         int  `yaml:"sidebar_width,omitempty"` // Width of the sidebar when expanded (legacy - for migration only)
	SidebarProfilesWidth int  `yaml:"sidebar_profiles_width"`  // Width of the sidebar for profiles view
	SidebarFilesWidth    int  `yaml:"sidebar_files_width"`     // Width of the sidebar for files view
	// Theme settings
	Theme string `yaml:"theme"` // Theme preference: "dark", "light", or "system"
	// Terminal settings
	ScrollbackLines           int  `yaml:"scrollback_lines"`             // Number of lines to keep in scrollback buffer
	OpenLinksInExternalBrowser bool `yaml:"open_links_in_external_browser"` // Open URLs in external browser instead of in-app
	// AI settings
	AI AIConfig `yaml:"ai"` // AI configuration
}

// DefaultConfig returns a new AppConfig with default values
func DefaultConfig() *AppConfig {
	return &AppConfig{
		WindowWidth:     DefaultWindowWidth,
		WindowHeight:    DefaultWindowHeight,
		WindowMaximized: false, // Default to not maximized
		DefaultShell:    "",    // Legacy field for migration only - will be empty in new configs
		DefaultShells: PlatformShells{ // Empty strings mean use system default for each platform
			Windows: "",
			Linux:   "",
			Darwin:  "",
		},
		ProfilesPath: "", // Empty string means use default profiles directory
		// Default context menu settings
		EnableSelectToCopy: false, // Default to disabled (standard context menu behavior)
		// Default sidebar settings
		SidebarCollapsed:     false, // Default to expanded
		SidebarWidth:         DefaultSidebarWidth,
		SidebarProfilesWidth: DefaultSidebarWidth,       // Default profiles width
		SidebarFilesWidth:    DefaultSidebarWidth + 100, // Default files width (slightly wider)
		// Default theme settings
		Theme: DefaultTheme,
		// Default terminal settings
		ScrollbackLines:            DefaultScrollbackLines,
		OpenLinksInExternalBrowser: true, // Default to opening links in external browser
		// Default AI settings
		AI: AIConfig{
			Enabled:  false,
			Provider: "openai",
			APIKey:   "",
			APIURL:   "https://api.openai.com/v1",
			ModelID:  "gpt-4o-mini",
			Hotkey:   "ctrl+k",
			SystemMessage: `
You are a terminal command assistant. Your sole purpose is to provide relevant command-line commands based on user queries.

RULES:
1. Respond ONLY with executable commands
2. Each command must be on a new line
3. Do not include explanations, descriptions, or commentary
4. Do not use markdown formatting or code blocks
5. Provide multiple alternative commands when applicable
6. Consider any output/context provided by the user
7. Commands should be practical and directly address the user's request

EXAMPLES:

User: "show all files including hidden"
Response:
ls -la
ls -a
find . -type f

User: "find large files over 100MB"
Response:
find / -type f -size +100M 2>/dev/null
du -h / | grep '[0-9\.]\+G'
find . -type f -size +100M -exec ls -lh {} \;

User: "check disk space"
Response:
df -h
du -sh *
ncdu

Always respond with raw commands only. No explanations. No formatting. Just commands.`,
		},
	}
}

// Validate checks the configuration for basic validity.
func (c *AppConfig) Validate() error {
	if c.WindowWidth < MinWindowWidth || c.WindowWidth > MaxWindowWidth {
		return fmt.Errorf("window width %d is out of range (%d-%d)", c.WindowWidth, MinWindowWidth, MaxWindowWidth)
	}
	if c.WindowHeight < MinWindowHeight || c.WindowHeight > MaxWindowHeight {
		return fmt.Errorf("window height %d is out of range (%d-%d)", c.WindowHeight, MinWindowHeight, MaxWindowHeight)
	}
	if c.SidebarWidth < MinSidebarWidth || c.SidebarWidth > MaxSidebarWidth {
		return fmt.Errorf("sidebar width %d is out of range (%d-%d)", c.SidebarWidth, MinSidebarWidth, MaxSidebarWidth)
	}
	if c.ScrollbackLines < MinScrollbackLines || c.ScrollbackLines > MaxScrollbackLines {
		return fmt.Errorf("scrollback lines %d is out of range (%d-%d)", c.ScrollbackLines, MinScrollbackLines, MaxScrollbackLines)
	}

	validTheme := false
	for _, t := range AllowedThemes {
		if c.Theme == t {
			validTheme = true
			break
		}
	}
	if !validTheme {
		return fmt.Errorf("invalid theme specified: '%s'. Allowed themes are: %v", c.Theme, AllowedThemes)
	}

	// Basic validation for ProfilesPath to prevent obviously problematic paths.
	// A more robust validation (e.g., checking if it's an absolute path, writability, path sanitization)
	// would typically be handled by a ConfigManager or when the path is actually used.
	if len(c.ProfilesPath) > 1024 { // Arbitrary length limit for sanity
		return fmt.Errorf("profiles path is too long (max 1024 characters)")
	}
	// Note: Validation for shell paths within c.DefaultShells would also be beneficial here or in ConfigManager.

	// AI configuration validation
	if c.AI.Enabled {
		if c.AI.Provider == "" {
			return fmt.Errorf("AI provider cannot be empty when AI is enabled")
		}
		if c.AI.APIURL == "" {
			return fmt.Errorf("AI API URL cannot be empty when AI is enabled")
		}
		if c.AI.ModelID == "" {
			return fmt.Errorf("AI model ID cannot be empty when AI is enabled")
		}
		if c.AI.Hotkey == "" {
			return fmt.Errorf("AI hotkey cannot be empty when AI is enabled")
		}
		// API key validation is optional as some providers might not require it
	}

	return nil
}
