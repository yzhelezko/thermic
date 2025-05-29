package main

// AppConfig holds the application configuration
type AppConfig struct {
	WindowWidth         int    `yaml:"window_width"`
	WindowHeight        int    `yaml:"window_height"`
	WindowMaximized     bool   `yaml:"window_maximized"`
	DefaultShell        string `yaml:"default_shell,omitempty"` // Legacy field for migration only
	DefaultShellWindows string `yaml:"default_shell_windows"`   // Windows-specific default shell
	DefaultShellLinux   string `yaml:"default_shell_linux"`     // Linux-specific default shell
	DefaultShellDarwin  string `yaml:"default_shell_darwin"`    // macOS-specific default shell
	ProfilesPath        string `yaml:"profiles_path,omitempty"` // Custom path for profiles directory
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
		WindowWidth:         1024,
		WindowHeight:        768,
		WindowMaximized:     false, // Default to not maximized
		DefaultShell:        "",    // Legacy field for migration only - will be empty in new configs
		DefaultShellWindows: "",    // Empty string means use system default
		DefaultShellLinux:   "",    // Empty string means use system default
		DefaultShellDarwin:  "",    // Empty string means use system default
		ProfilesPath:        "",    // Empty string means use default profiles directory
		// Default context menu settings
		EnableSelectToCopy: false, // Default to disabled (standard context menu behavior)
		// Default sidebar settings
		SidebarCollapsed: false, // Default to expanded
		SidebarWidth:     250,   // Default width
		// Default theme settings
		Theme: "dark", // Default to dark theme
	}
}
