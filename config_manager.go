package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"gopkg.in/yaml.v2"
)

// Platform constants to avoid repeated runtime.GOOS calls
const (
	PlatformWindows = "windows"
	PlatformLinux   = "linux"
	PlatformDarwin  = "darwin"
)

var currentPlatform = runtime.GOOS // Cache platform detection

// ConfigError represents configuration-related errors with context
type ConfigError struct {
	Op   string
	Path string
	Err  error
}

func (e *ConfigError) Error() string {
	if e.Path != "" {
		return fmt.Sprintf("config %s %s: %v", e.Op, e.Path, e.Err)
	}
	return fmt.Sprintf("config %s: %v", e.Op, e.Err)
}

// getConfigPath returns the full path to the config file
func (a *App) getConfigPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", &ConfigError{Op: "get_user_config_dir", Err: err}
	}
	return filepath.Join(configDir, ConfigDirName, ConfigFileName), nil
}

// ensureConfigDir creates the config directory if it doesn't exist
func (a *App) ensureConfigDir() error {
	configPath, err := a.getConfigPath()
	if err != nil {
		return err
	}

	configDir := filepath.Dir(configPath)
	if err := os.MkdirAll(configDir, ConfigDirMode); err != nil {
		return &ConfigError{Op: "create_directory", Path: configDir, Err: err}
	}
	return nil
}

// createConfigBackup creates a backup of the existing config file
func (a *App) createConfigBackup(configPath, backupPath string) error {
	// Check if config file exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return nil // No backup needed if file doesn't exist
	}

	// Read existing config
	data, err := os.ReadFile(configPath)
	if err != nil {
		return &ConfigError{Op: "read_for_backup", Path: configPath, Err: err}
	}

	// Write backup
	if err := os.WriteFile(backupPath, data, ConfigFileMode); err != nil {
		return &ConfigError{Op: "write_backup", Path: backupPath, Err: err}
	}

	return nil
}

// writeConfigToFile writes the config to a specific file path
func (a *App) writeConfigToFile(filePath string) error {
	if a.config == nil || a.config.config == nil {
		return &ConfigError{Op: "write", Err: fmt.Errorf("config is nil")}
	}

	// Validate config before writing
	if err := a.config.config.Validate(); err != nil {
		return &ConfigError{Op: "validate", Err: err}
	}

	data, err := yaml.Marshal(a.config.config)
	if err != nil {
		return &ConfigError{Op: "marshal", Err: err}
	}

	if err := os.WriteFile(filePath, data, ConfigFileMode); err != nil {
		return &ConfigError{Op: "write", Path: filePath, Err: err}
	}

	return nil
}

// loadConfig loads configuration from file or creates default
func (a *App) loadConfig() error {
	configPath, err := a.getConfigPath()
	if err != nil {
		fmt.Printf("Warning: %v. Using default config.\n", err)
		return nil // Continue with default config
	}

	// Ensure config directory exists
	if err := a.ensureConfigDir(); err != nil {
		fmt.Printf("Warning: %v. Using default config.\n", err)
		return nil
	}

	// Check if config file exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		fmt.Printf("Config file not found at %s - creating with default values.\n", configPath)
		return a.saveConfig() // Create default config file
	}

	// Load existing config
	data, err := os.ReadFile(configPath)
	if err != nil {
		fmt.Printf("Warning: Failed to read config file %s: %v. Using default config.\n", configPath, err)
		return nil
	}

	if err := yaml.Unmarshal(data, a.config.config); err != nil {
		fmt.Printf("Warning: Failed to parse config file %s: %v. Using default config.\n", configPath, err)
		a.config.config = DefaultConfig() // Reset to default on parse error
		return nil
	}

	// Validate loaded config
	if err := a.config.config.Validate(); err != nil {
		fmt.Printf("Warning: Invalid config loaded from %s: %v. Using default config.\n", configPath, err)
		a.config.config = DefaultConfig() // Reset to default on validation error
		return nil
	}

	// Migrate legacy configuration to platform-specific format
	if migrated := a.migrateLegacyConfig(); migrated {
		fmt.Println("Migrated legacy shell configuration to platform-specific format")
		a.markConfigDirty() // Save the migrated config
	}

	fmt.Printf("Config loaded successfully from %s\n", configPath)
	return nil
}

// saveConfigAtomic saves the config using atomic operations with backup
func (a *App) saveConfigAtomic() error {
	configPath, err := a.getConfigPath()
	if err != nil {
		return err
	}

	if err := a.ensureConfigDir(); err != nil {
		return err
	}

	// Create backup before save
	backupPath := configPath + ".backup"
	if err := a.createConfigBackup(configPath, backupPath); err != nil {
		return fmt.Errorf("create backup: %w", err)
	}

	// Write to temporary file first
	tempPath := configPath + ".tmp"
	if err := a.writeConfigToFile(tempPath); err != nil {
		return err
	}

	// Atomic replace
	if err := os.Rename(tempPath, configPath); err != nil {
		os.Remove(tempPath) // Cleanup temp file on error
		return &ConfigError{Op: "atomic_replace", Path: configPath, Err: err}
	}

	return nil
}

// saveConfig saves the current application configuration to a file
func (a *App) saveConfig() error {
	if a.config == nil {
		return &ConfigError{Op: "save", Err: fmt.Errorf("config is nil")}
	}

	return a.saveConfigAtomic()
}

// markConfigDirty flags the configuration as needing a save and resets the debounce timer.
// Fixed race condition in timer management.
func (a *App) markConfigDirty() {
	a.config.mutex.Lock()
	defer a.config.mutex.Unlock()

	a.config.configDirty = true

	// Safely replace timer to avoid race conditions
	if a.config.debounceTimer != nil {
		a.config.debounceTimer.Stop()
		a.config.debounceTimer = nil
	}

	a.config.debounceTimer = time.AfterFunc(DebounceDelay, func() {
		a.saveConfigIfDirtyAsync()
	})
}

// saveConfigIfDirtyAsync handles async config saving with proper error handling
func (a *App) saveConfigIfDirtyAsync() {
	a.config.mutex.Lock()
	defer a.config.mutex.Unlock()

	if !a.config.configDirty {
		return // Nothing to save
	}

	// Check if app is still running
	if a.ctx == nil {
		fmt.Println("Warning: App context is nil, skipping config save")
		return
	}

	if err := a.saveConfig(); err != nil {
		fmt.Printf("Error saving config: %v\n", err)
		// Keep config dirty so it will be retried later
		return
	}

	fmt.Println("Config saved successfully.")
	a.config.configDirty = false
}

// saveConfigIfDirty checks the dirty flag and saves the configuration if it's set.
func (a *App) saveConfigIfDirty() {
	a.saveConfigIfDirtyAsync()
}

// updateWindowState updates the config with current window state and marks dirty if changed
func (a *App) updateWindowState() bool {
	if a.ctx == nil || a.config == nil {
		return false
	}

	width, height := wailsRuntime.WindowGetSize(a.ctx)
	isMaximized := wailsRuntime.WindowIsMaximised(a.ctx)

	configChanged := false

	if a.config.config.WindowWidth != width || a.config.config.WindowHeight != height {
		a.config.config.WindowWidth = width
		a.config.config.WindowHeight = height
		fmt.Printf("Window dimensions updated to %dx%d\n", width, height)
		configChanged = true
	}

	if a.config.config.WindowMaximized != isMaximized {
		a.config.config.WindowMaximized = isMaximized
		fmt.Printf("Window maximized state updated to %t\n", isMaximized)
		configChanged = true
	}

	return configChanged
}

// handleFrontendResizeEvent is called when the frontend signals that window resizing has finished.
func (a *App) handleFrontendResizeEvent(optionalData ...interface{}) {
	if a.ctx == nil || a.config == nil {
		fmt.Println("Resize event: Context or config not ready.")
		return
	}

	if a.updateWindowState() {
		fmt.Println("Window state changed, marking config dirty.")
		a.markConfigDirty()
	}
}

// validateShellPath validates a shell path for basic sanity
func (a *App) validateShellPath(shellPath string) error {
	if shellPath == "" {
		return nil // Empty is allowed (means use system default)
	}

	if len(shellPath) > 1024 { // Arbitrary length limit
		return fmt.Errorf("shell path too long (max 1024 characters)")
	}

	// Additional validation could be added here (file existence, executable bit, etc.)
	return nil
}

// SetDefaultShell updates the platform-specific default shell in the configuration and marks it dirty.
func (a *App) SetDefaultShell(shellPath string) error {
	if a.config == nil {
		return &ConfigError{Op: "set_default_shell", Err: fmt.Errorf("config not initialized")}
	}

	if err := a.validateShellPath(shellPath); err != nil {
		return &ConfigError{Op: "validate_shell_path", Err: err}
	}

	// Set the platform-specific shell configuration
	currentShell := a.getPlatformDefaultShell()
	if currentShell != shellPath {
		a.setPlatformDefaultShell(shellPath)
		fmt.Printf("Default shell for %s set to: %s\n", getOSName(), shellPath)
		a.markConfigDirty()
	}
	return nil
}

// setPlatformDefaultShell sets the platform-specific default shell configuration
func (a *App) setPlatformDefaultShell(shellPath string) {
	switch currentPlatform {
	case PlatformWindows:
		a.config.config.DefaultShells.Windows = shellPath
	case PlatformLinux:
		a.config.config.DefaultShells.Linux = shellPath
	case PlatformDarwin:
		a.config.config.DefaultShells.Darwin = shellPath
	}
}

// getOSName returns a human-readable OS name
func getOSName() string {
	switch currentPlatform {
	case PlatformWindows:
		return "Windows"
	case PlatformLinux:
		return "Linux"
	case PlatformDarwin:
		return "macOS"
	default:
		return currentPlatform
	}
}

// migrateLegacyConfig migrates old single shell config to platform-specific configuration
func (a *App) migrateLegacyConfig() bool {
	if a.config.config.DefaultShell == "" {
		return false // No legacy config to migrate
	}

	// Check if platform-specific shell is already set
	currentPlatformShell := a.getPlatformDefaultShell()
	if currentPlatformShell == "" {
		// Migrate legacy shell to current platform
		a.setPlatformDefaultShell(a.config.config.DefaultShell)
	}

	// Clear legacy field
	a.config.config.DefaultShell = ""
	return true // Migration occurred
}

// GetCurrentDefaultShellSetting returns the current platform's default shell setting
func (a *App) GetCurrentDefaultShellSetting() string {
	if a.config == nil {
		return ""
	}
	return a.getPlatformDefaultShell()
}

// validateBooleanSetting validates boolean configuration values
func (a *App) validateBooleanSetting(settingName string, value bool) error {
	// Boolean values are inherently valid, but we keep this for consistency
	// and potential future enhancements
	return nil
}

// GetSelectToCopyEnabled returns the current select-to-copy setting
func (a *App) GetSelectToCopyEnabled() bool {
	if a.config == nil {
		return false
	}
	return a.config.config.EnableSelectToCopy
}

// SetSelectToCopyEnabled updates the select-to-copy setting and marks config dirty
func (a *App) SetSelectToCopyEnabled(enabled bool) error {
	if a.config == nil {
		return &ConfigError{Op: "set_select_to_copy", Err: fmt.Errorf("config not initialized")}
	}

	if err := a.validateBooleanSetting("EnableSelectToCopy", enabled); err != nil {
		return &ConfigError{Op: "validate_select_to_copy", Err: err}
	}

	if a.config.config.EnableSelectToCopy != enabled {
		a.config.config.EnableSelectToCopy = enabled
		fmt.Printf("Select-to-copy setting updated to: %t\n", enabled)
		a.markConfigDirty()
	}
	return nil
}

// validateProfilesPath validates the profiles path setting
func (a *App) validateProfilesPath(path string) error {
	if path == "" {
		return nil // Empty is allowed (means use default)
	}

	if len(path) > 1024 {
		return fmt.Errorf("profiles path too long (max 1024 characters)")
	}

	// Additional validation could be added here (path existence, writability, etc.)
	return nil
}

// GetProfilesPath returns the current profiles path setting
func (a *App) GetProfilesPath() string {
	if a.config == nil {
		return ""
	}
	return a.config.config.ProfilesPath
}

// SetProfilesPath updates the profiles path setting and marks config dirty
func (a *App) SetProfilesPath(path string) error {
	if a.config == nil {
		return &ConfigError{Op: "set_profiles_path", Err: fmt.Errorf("config not initialized")}
	}

	if err := a.validateProfilesPath(path); err != nil {
		return &ConfigError{Op: "validate_profiles_path", Err: err}
	}

	if a.config.config.ProfilesPath != path {
		a.config.config.ProfilesPath = path
		fmt.Printf("Profiles path updated to: %s\n", path)
		a.markConfigDirty()

		// Reload profiles from new path
		if err := a.LoadProfiles(); err != nil {
			// Log error but don't fail the config update
			fmt.Printf("Warning: Failed to reload profiles from new path: %v\n", err)
		}
	}
	return nil
}

// validateSidebarWidth validates sidebar width values
func (a *App) validateSidebarWidth(width int) error {
	if width < MinSidebarWidth || width > MaxSidebarWidth {
		return fmt.Errorf("width %d out of range [%d, %d]", width, MinSidebarWidth, MaxSidebarWidth)
	}
	return nil
}

// GetSidebarCollapsed returns the current sidebar collapsed state
func (a *App) GetSidebarCollapsed() bool {
	if a.config == nil {
		return false
	}
	return a.config.config.SidebarCollapsed
}

// SetSidebarCollapsed updates the sidebar collapsed state and marks config dirty
func (a *App) SetSidebarCollapsed(collapsed bool) error {
	if a.config == nil {
		return &ConfigError{Op: "set_sidebar_collapsed", Err: fmt.Errorf("config not initialized")}
	}

	if err := a.validateBooleanSetting("SidebarCollapsed", collapsed); err != nil {
		return &ConfigError{Op: "validate_sidebar_collapsed", Err: err}
	}

	if a.config.config.SidebarCollapsed != collapsed {
		a.config.config.SidebarCollapsed = collapsed
		fmt.Printf("Sidebar collapsed state updated to: %t\n", collapsed)
		a.markConfigDirty()
	}
	return nil
}

// GetSidebarWidth returns the current sidebar width setting
func (a *App) GetSidebarWidth() int {
	if a.config == nil {
		return DefaultSidebarWidth
	}
	return a.config.config.SidebarWidth
}

// SetSidebarWidth updates the sidebar width setting and marks config dirty
func (a *App) SetSidebarWidth(width int) error {
	if a.config == nil {
		return &ConfigError{Op: "set_sidebar_width", Err: fmt.Errorf("config not initialized")}
	}

	if err := a.validateSidebarWidth(width); err != nil {
		return &ConfigError{Op: "validate_sidebar_width", Err: err}
	}

	if a.config.config.SidebarWidth != width {
		a.config.config.SidebarWidth = width
		fmt.Printf("Sidebar width updated to: %d\n", width)
		a.markConfigDirty()
	}
	return nil
}

// validateTheme validates theme setting values
func (a *App) validateTheme(theme string) error {
	for _, validTheme := range AllowedThemes {
		if theme == validTheme {
			return nil
		}
	}
	return fmt.Errorf("invalid theme '%s', allowed themes: %v", theme, AllowedThemes)
}

// GetTheme returns the current theme setting
func (a *App) GetTheme() string {
	if a.config == nil {
		return DefaultTheme
	}
	return a.config.config.Theme
}

// SetTheme updates the theme setting and marks config dirty
func (a *App) SetTheme(theme string) error {
	if a.config == nil {
		return &ConfigError{Op: "set_theme", Err: fmt.Errorf("config not initialized")}
	}

	if err := a.validateTheme(theme); err != nil {
		return &ConfigError{Op: "validate_theme", Err: err}
	}

	if a.config.config.Theme != theme {
		a.config.config.Theme = theme
		fmt.Printf("Theme updated to: %s\n", theme)
		a.markConfigDirty()
	}
	return nil
}
