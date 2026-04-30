package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const (
	DefaultWindowWidth         = 1024
	DefaultWindowHeight        = 768
	DefaultSidebarWidth        = 250
	DefaultTheme               = "dark" // "dark", "light", or "system"
	DefaultScrollbackLines     = 10000
	DefaultUIScale             = 100                                             // 100% (no zoom)
	DefaultTerminalFontFamily  = `Consolas, Monaco, "Lucida Console", monospace` // xterm.js fontFamily
	DefaultTerminalFontSize    = 14                                              // px
	DefaultTerminalLineHeight  = 100                                             // percent (100 = 1.0)
	DefaultTerminalCursorBlink = true
	DefaultAutoCheckUpdates    = true
	// New terminal extras
	DefaultTerminalCursorStyle           = "block" // block | bar | underline
	DefaultTerminalBellSound             = false
	DefaultTerminalWordSeparators        = " ()[]{}',\":;<>"
	DefaultTerminalScrollSensitivity     = 1
	DefaultTerminalFastScrollSensitivity = 5
	// Window
	DefaultAlwaysOnTop                = false
	DefaultConfirmCloseActiveSessions = true
	DefaultRestoreTabsOnLaunch        = false
	// SSH
	DefaultSSHConnectionTimeout = 10 // seconds
	DefaultSSHKeepAliveInterval = 30 // seconds (0 disables)

	MinWindowWidth        = 800
	MinWindowHeight       = 600
	MinSidebarWidth       = 100
	MaxSidebarWidth       = 1000
	MaxWindowWidth        = 10000 // Arbitrary large value for upper bound
	MaxWindowHeight       = 10000 // Arbitrary large value for upper bound
	MinScrollbackLines    = 100
	MaxScrollbackLines    = 100000
	MinUIScale            = 50  // 50% — smallest allowed zoom
	MaxUIScale            = 300 // 300% — largest allowed zoom
	MinTerminalFontSize   = 8
	MaxTerminalFontSize   = 32
	MinTerminalLineHeight = 80  // 0.8
	MaxTerminalLineHeight = 200 // 2.0
	// SSH limits
	MinSSHConnectionTimeout = 1
	MaxSSHConnectionTimeout = 300
	MinSSHKeepAliveInterval = 0   // 0 = disabled
	MaxSSHKeepAliveInterval = 600 // 10 minutes
	// Scroll sensitivity limits
	MinScrollSensitivity     = 1
	MaxScrollSensitivity     = 50
	MinFastScrollSensitivity = 1
	MaxFastScrollSensitivity = 100
)

// AllowedTerminalCursorStyles lists valid xterm.js cursor styles.
var AllowedTerminalCursorStyles = []string{"block", "bar", "underline"}

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

// SFTPConfig holds SFTP transfer optimization settings
type SFTPConfig struct {
	MaxPacketSize      int  `yaml:"max_packet_size"`     // Maximum SFTP packet size in bytes (default: 256KB)
	BufferSize         int  `yaml:"buffer_size"`         // Transfer buffer size in bytes (default: 1MB)
	ConcurrentRequests int  `yaml:"concurrent_requests"` // Concurrent requests per file (default: 64)
	ParallelTransfers  int  `yaml:"parallel_transfers"`  // Number of parallel file transfers (default: 4)
	UseConcurrentIO    bool `yaml:"use_concurrent_io"`   // Enable concurrent reads/writes (default: true)
}

// SFTP configuration constants
const (
	DefaultSFTPMaxPacketSize      = 64 * 1024        // 64KB - safer default that works with most servers
	DefaultSFTPBufferSize         = 256 * 1024       // 256KB buffer - balanced for performance and compatibility
	DefaultSFTPConcurrentRequests = 16               // Concurrent requests per file - conservative default
	DefaultSFTPParallelTransfers  = 2                // Parallel file transfers - safe for low-powered servers
	MinSFTPMaxPacketSize          = 32 * 1024        // 32KB minimum (SFTP default)
	MaxSFTPMaxPacketSize          = 512 * 1024       // 512KB maximum
	MinSFTPBufferSize             = 64 * 1024        // 64KB minimum
	MaxSFTPBufferSize             = 16 * 1024 * 1024 // 16MB maximum
	MinSFTPConcurrentRequests     = 1
	MaxSFTPConcurrentRequests     = 128
	MinSFTPParallelTransfers      = 1
	MaxSFTPParallelTransfers      = 16
)

// SavedTab is a minimal snapshot used to restore tabs on next launch.
type SavedTab struct {
	ProfileID string `yaml:"profile_id,omitempty"`
	Shell     string `yaml:"shell,omitempty"`
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
	ScrollbackLines               int    `yaml:"scrollback_lines"`                 // Number of lines to keep in scrollback buffer
	OpenLinksInExternalBrowser    bool   `yaml:"open_links_in_external_browser"`   // Open URLs in external browser instead of in-app
	TerminalFontFamily            string `yaml:"terminal_font_family"`             // Monospace font family for the terminal
	TerminalFontSize              int    `yaml:"terminal_font_size"`               // Terminal font size in px
	TerminalLineHeight            int    `yaml:"terminal_line_height"`             // Terminal line height as percent (100 = 1.0)
	TerminalCursorBlink           bool   `yaml:"terminal_cursor_blink"`            // Whether the terminal cursor blinks
	TerminalCursorStyle           string `yaml:"terminal_cursor_style"`            // block | bar | underline
	TerminalBellSound             bool   `yaml:"terminal_bell_sound"`              // Audible bell on BEL char
	TerminalWordSeparators        string `yaml:"terminal_word_separators"`         // Characters that delimit words on double-click
	TerminalScrollSensitivity     int    `yaml:"terminal_scroll_sensitivity"`      // Lines per scroll tick
	TerminalFastScrollSensitivity int    `yaml:"terminal_fast_scroll_sensitivity"` // Lines per scroll tick when Alt is held
	// Appearance settings
	UIScale int `yaml:"ui_scale"` // UI zoom level as a percentage (100 = 100%)
	// Window
	AlwaysOnTop                bool `yaml:"always_on_top"`                 // Keep the window on top of others
	ConfirmCloseActiveSessions bool `yaml:"confirm_close_active_sessions"` // Prompt before closing tabs/window with running PTYs
	RestoreTabsOnLaunch        bool `yaml:"restore_tabs_on_launch"`        // Reopen previous tabs at startup
	// SSH global defaults
	SSHConnectionTimeout int `yaml:"ssh_connection_timeout"` // Initial connect timeout in seconds
	SSHKeepAliveInterval int `yaml:"ssh_keepalive_interval"` // Keep-alive heartbeat interval (0 = disabled)
	// Updates
	AutoCheckUpdates bool `yaml:"auto_check_updates"` // Automatically poll GitHub for new releases
	// Tab restoration snapshot
	LastOpenTabs []SavedTab `yaml:"last_open_tabs,omitempty"` // Captured on shutdown when RestoreTabsOnLaunch is enabled
	// Hotkeys overrides (action ID -> keystroke). Missing entries fall back to defaults.
	Hotkeys map[string]string `yaml:"hotkeys,omitempty"`
	// AI settings
	AI AIConfig `yaml:"ai"` // AI configuration
	// SFTP settings
	SFTP SFTPConfig `yaml:"sftp"` // SFTP transfer optimization settings
}

// defaultProfilesPath returns the resolved default profiles directory path
func defaultProfilesPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(configDir, ConfigDirName, ProfilesDirName)
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
		ProfilesPath: defaultProfilesPath(), // Explicit default so it's visible in config file
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
		ScrollbackLines:               DefaultScrollbackLines,
		OpenLinksInExternalBrowser:    true, // Default to opening links in external browser
		TerminalFontFamily:            DefaultTerminalFontFamily,
		TerminalFontSize:              DefaultTerminalFontSize,
		TerminalLineHeight:            DefaultTerminalLineHeight,
		TerminalCursorBlink:           DefaultTerminalCursorBlink,
		TerminalCursorStyle:           DefaultTerminalCursorStyle,
		TerminalBellSound:             DefaultTerminalBellSound,
		TerminalWordSeparators:        DefaultTerminalWordSeparators,
		TerminalScrollSensitivity:     DefaultTerminalScrollSensitivity,
		TerminalFastScrollSensitivity: DefaultTerminalFastScrollSensitivity,
		// Default appearance settings
		UIScale: DefaultUIScale,
		// Default window settings
		AlwaysOnTop:                DefaultAlwaysOnTop,
		ConfirmCloseActiveSessions: DefaultConfirmCloseActiveSessions,
		RestoreTabsOnLaunch:        DefaultRestoreTabsOnLaunch,
		// Default SSH settings
		SSHConnectionTimeout: DefaultSSHConnectionTimeout,
		SSHKeepAliveInterval: DefaultSSHKeepAliveInterval,
		// Default update settings
		AutoCheckUpdates: DefaultAutoCheckUpdates,
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
		// Default SFTP settings for optimized transfers
		SFTP: SFTPConfig{
			MaxPacketSize:      DefaultSFTPMaxPacketSize,
			BufferSize:         DefaultSFTPBufferSize,
			ConcurrentRequests: DefaultSFTPConcurrentRequests,
			ParallelTransfers:  DefaultSFTPParallelTransfers,
			UseConcurrentIO:    true,
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
	if c.UIScale != 0 && (c.UIScale < MinUIScale || c.UIScale > MaxUIScale) {
		return fmt.Errorf("UI scale %d is out of range (%d-%d)", c.UIScale, MinUIScale, MaxUIScale)
	}
	if c.TerminalFontSize != 0 && (c.TerminalFontSize < MinTerminalFontSize || c.TerminalFontSize > MaxTerminalFontSize) {
		return fmt.Errorf("terminal font size %d is out of range (%d-%d)", c.TerminalFontSize, MinTerminalFontSize, MaxTerminalFontSize)
	}
	if c.TerminalLineHeight != 0 && (c.TerminalLineHeight < MinTerminalLineHeight || c.TerminalLineHeight > MaxTerminalLineHeight) {
		return fmt.Errorf("terminal line height %d is out of range (%d-%d)", c.TerminalLineHeight, MinTerminalLineHeight, MaxTerminalLineHeight)
	}
	if c.TerminalCursorStyle != "" {
		valid := false
		for _, s := range AllowedTerminalCursorStyles {
			if c.TerminalCursorStyle == s {
				valid = true
				break
			}
		}
		if !valid {
			return fmt.Errorf("invalid terminal cursor style '%s', allowed: %v", c.TerminalCursorStyle, AllowedTerminalCursorStyles)
		}
	}
	if c.TerminalScrollSensitivity != 0 && (c.TerminalScrollSensitivity < MinScrollSensitivity || c.TerminalScrollSensitivity > MaxScrollSensitivity) {
		return fmt.Errorf("terminal scroll sensitivity %d is out of range (%d-%d)", c.TerminalScrollSensitivity, MinScrollSensitivity, MaxScrollSensitivity)
	}
	if c.TerminalFastScrollSensitivity != 0 && (c.TerminalFastScrollSensitivity < MinFastScrollSensitivity || c.TerminalFastScrollSensitivity > MaxFastScrollSensitivity) {
		return fmt.Errorf("terminal fast scroll sensitivity %d is out of range (%d-%d)", c.TerminalFastScrollSensitivity, MinFastScrollSensitivity, MaxFastScrollSensitivity)
	}
	if c.SSHConnectionTimeout != 0 && (c.SSHConnectionTimeout < MinSSHConnectionTimeout || c.SSHConnectionTimeout > MaxSSHConnectionTimeout) {
		return fmt.Errorf("SSH connection timeout %d is out of range (%d-%d)", c.SSHConnectionTimeout, MinSSHConnectionTimeout, MaxSSHConnectionTimeout)
	}
	if c.SSHKeepAliveInterval < MinSSHKeepAliveInterval || c.SSHKeepAliveInterval > MaxSSHKeepAliveInterval {
		return fmt.Errorf("SSH keep-alive interval %d is out of range (%d-%d)", c.SSHKeepAliveInterval, MinSSHKeepAliveInterval, MaxSSHKeepAliveInterval)
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

	// SFTP configuration validation
	if c.SFTP.MaxPacketSize < MinSFTPMaxPacketSize || c.SFTP.MaxPacketSize > MaxSFTPMaxPacketSize {
		return fmt.Errorf("SFTP max packet size %d is out of range (%d-%d)", c.SFTP.MaxPacketSize, MinSFTPMaxPacketSize, MaxSFTPMaxPacketSize)
	}
	if c.SFTP.BufferSize < MinSFTPBufferSize || c.SFTP.BufferSize > MaxSFTPBufferSize {
		return fmt.Errorf("SFTP buffer size %d is out of range (%d-%d)", c.SFTP.BufferSize, MinSFTPBufferSize, MaxSFTPBufferSize)
	}
	if c.SFTP.ConcurrentRequests < MinSFTPConcurrentRequests || c.SFTP.ConcurrentRequests > MaxSFTPConcurrentRequests {
		return fmt.Errorf("SFTP concurrent requests %d is out of range (%d-%d)", c.SFTP.ConcurrentRequests, MinSFTPConcurrentRequests, MaxSFTPConcurrentRequests)
	}
	if c.SFTP.ParallelTransfers < MinSFTPParallelTransfers || c.SFTP.ParallelTransfers > MaxSFTPParallelTransfers {
		return fmt.Errorf("SFTP parallel transfers %d is out of range (%d-%d)", c.SFTP.ParallelTransfers, MinSFTPParallelTransfers, MaxSFTPParallelTransfers)
	}

	return nil
}
