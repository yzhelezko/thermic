package main

import (
	"fmt"
)

const (
	DefaultWindowWidth  = 1024
	DefaultWindowHeight = 768
	DefaultSidebarWidth = 250
	DefaultTheme        = "dark" // "dark", "light", or "system"

	MinWindowWidth  = 800
	MinWindowHeight = 600
	MinSidebarWidth = 100
	MaxSidebarWidth = 1000
	MaxWindowWidth  = 10000 // Arbitrary large value for upper bound
	MaxWindowHeight = 10000 // Arbitrary large value for upper bound
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
	SidebarCollapsed bool `yaml:"sidebar_collapsed"` // Whether the sidebar is collapsed
	SidebarWidth     int  `yaml:"sidebar_width"`     // Width of the sidebar when expanded
	// Theme settings
	Theme string `yaml:"theme"` // Theme preference: "dark", "light", or "system"
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
		SidebarCollapsed: false, // Default to expanded
		SidebarWidth:     DefaultSidebarWidth,
		// Default theme settings
		Theme: DefaultTheme,
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

	return nil
}
