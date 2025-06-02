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

// getConfigPath returns the full path to the config file
func (a *App) getConfigPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config directory: %w", err)
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
		return fmt.Errorf("failed to create config directory %s: %w", configDir, err)
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

	// Migrate legacy configuration to platform-specific format
	if migrated := a.migrateLegacyConfig(); migrated {
		fmt.Println("Migrated legacy shell configuration to platform-specific format")
		a.markConfigDirty() // Save the migrated config
	}

	fmt.Printf("Config loaded successfully from %s\n", configPath)
	return nil
}

// saveConfig saves the current application configuration to a file
func (a *App) saveConfig() error {
	if a.config == nil {
		return fmt.Errorf("config is nil, cannot save")
	}

	configPath, err := a.getConfigPath()
	if err != nil {
		return fmt.Errorf("failed to get config path: %w", err)
	}

	if err := a.ensureConfigDir(); err != nil {
		return fmt.Errorf("failed to ensure config directory: %w", err)
	}

	data, err := yaml.Marshal(a.config.config)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(configPath, data, ConfigFileMode); err != nil {
		return fmt.Errorf("failed to write config file %s: %w", configPath, err)
	}

	return nil
}

// markConfigDirty flags the configuration as needing a save and resets the debounce timer.
func (a *App) markConfigDirty() {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	a.config.configDirty = true
	if a.config.debounceTimer != nil {
		a.config.debounceTimer.Stop()
	}

	a.config.debounceTimer = time.AfterFunc(DebounceDelay, func() {
		if a.ctx != nil { // Check if app is still running
			fmt.Println("Debounce timer fired. Attempting to save config.")
			a.saveConfigIfDirty()
		}
	})
}

// saveConfigIfDirty checks the dirty flag and saves the configuration if it's set.
func (a *App) saveConfigIfDirty() {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	if !a.config.configDirty {
		return // Nothing to save
	}

	if err := a.saveConfig(); err != nil {
		fmt.Printf("Error saving config: %v\n", err)
		// Keep config dirty so it will be retried later
		return
	}

	fmt.Println("Config saved successfully.")
	a.config.configDirty = false
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

// SetDefaultShell updates the platform-specific default shell in the configuration and marks it dirty.
func (a *App) SetDefaultShell(shellPath string) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set default shell")
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
	// The calling function SetDefaultShell already checks if a.config is nil.
	// However, a.config.config could still be nil if DefaultConfig() wasn't called
	// or if it was reset. Adding a check for robustness.
	if a.config == nil || a.config.config == nil {
		fmt.Println("setPlatformDefaultShell: config or a.config.config is nil. Cannot set shell.")
		return
	}

	switch runtime.GOOS {
	case "windows":
		a.config.config.DefaultShells.Windows = shellPath
	case "darwin":
		a.config.config.DefaultShells.Darwin = shellPath
	case "linux":
		a.config.config.DefaultShells.Linux = shellPath
	default:
		// For other Unix-like systems, use Linux configuration
		a.config.config.DefaultShells.Linux = shellPath
	}
}

// getOSName returns a human-readable OS name for logging
func getOSName() string {
	switch runtime.GOOS {
	case "windows":
		return "Windows"
	case "darwin":
		return "macOS"
	case "linux":
		return "Linux"
	default:
		return runtime.GOOS
	}
}

// migrateLegacyConfig migrates legacy default_shell configuration to platform-specific format
func (a *App) migrateLegacyConfig() bool {
	if a.config == nil {
		return false
	}

	// Check if we have a legacy default_shell set
	if a.config.config.DefaultShell != "" {
		// Only migrate to the current platform if it's not already set
		currentPlatformShell := a.getPlatformDefaultShell()
		if currentPlatformShell == "" {
			// Set only the current platform's shell
			a.setPlatformDefaultShell(a.config.config.DefaultShell)
			fmt.Printf("Migrated legacy shell '%s' to %s configuration\n", a.config.config.DefaultShell, getOSName())

			// Clear the legacy field after migration
			a.config.config.DefaultShell = ""
			return true
		} else {
			// Platform-specific shell already set, just clear legacy field
			fmt.Printf("Legacy shell '%s' found but %s already has platform-specific shell '%s', clearing legacy field\n",
				a.config.config.DefaultShell, getOSName(), currentPlatformShell)
			a.config.config.DefaultShell = ""
			return true
		}
	}

	return false
}

// GetCurrentDefaultShellSetting returns the platform-specific default shell string from the configuration.
// This is intended for populating UI elements.
func (a *App) GetCurrentDefaultShellSetting() string {
	if a.config == nil {
		fmt.Println("GetCurrentDefaultShellSetting: config is nil, returning empty string.")
		return ""
	}

	// Get platform-specific shell configuration
	return a.getPlatformDefaultShell()
}

// GetSelectToCopyEnabled returns whether select-to-copy mode is enabled
func (a *App) GetSelectToCopyEnabled() bool {
	if a.config == nil {
		fmt.Println("GetSelectToCopyEnabled: config is nil, returning default false.")
		return false
	}
	return a.config.config.EnableSelectToCopy
}

// SetSelectToCopyEnabled updates the select-to-copy setting
func (a *App) SetSelectToCopyEnabled(enabled bool) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set select-to-copy setting")
	}

	if a.config.config.EnableSelectToCopy != enabled {
		a.config.config.EnableSelectToCopy = enabled
		fmt.Printf("Select-to-copy setting updated to: %t\n", enabled)
		a.markConfigDirty()
	}
	return nil
}

// GetProfilesPath returns the configured profiles directory path
func (a *App) GetProfilesPath() string {
	if a.config == nil {
		fmt.Println("GetProfilesPath: config is nil, returning empty string.")
		return ""
	}
	return a.config.config.ProfilesPath
}

// SetProfilesPath updates the profiles directory path in the configuration and marks it dirty
func (a *App) SetProfilesPath(path string) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set profiles path")
	}

	if a.config.config.ProfilesPath != path {
		a.config.config.ProfilesPath = path
		fmt.Printf("Profiles path updated to: %s\n", path)
		a.markConfigDirty()

		// Reload profiles from the new directory
		if err := a.LoadProfiles(); err != nil {
			fmt.Printf("Warning: Failed to reload profiles from new path: %v\n", err)
			// Don't return error here as the config update was successful
		} else {
			fmt.Println("Profiles reloaded from new directory")
		}
	}
	return nil
}

// GetSidebarCollapsed returns whether the sidebar is collapsed
func (a *App) GetSidebarCollapsed() bool {
	if a.config == nil {
		fmt.Println("GetSidebarCollapsed: config is nil, returning default false.")
		return false
	}
	return a.config.config.SidebarCollapsed
}

// SetSidebarCollapsed updates the sidebar collapsed state
func (a *App) SetSidebarCollapsed(collapsed bool) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set sidebar collapsed state")
	}

	if a.config.config.SidebarCollapsed != collapsed {
		a.config.config.SidebarCollapsed = collapsed
		fmt.Printf("Sidebar collapsed state updated to: %t\n", collapsed)
		a.markConfigDirty()
	}
	return nil
}

// GetSidebarWidth returns the sidebar width
func (a *App) GetSidebarWidth() int {
	if a.config == nil {
		fmt.Println("GetSidebarWidth: config is nil, returning default 250.")
		return 250
	}
	return a.config.config.SidebarWidth
}

// SetSidebarWidth updates the sidebar width
func (a *App) SetSidebarWidth(width int) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set sidebar width")
	}

	if a.config.config.SidebarWidth != width {
		a.config.config.SidebarWidth = width
		fmt.Printf("Sidebar width updated to: %d\n", width)
		a.markConfigDirty()
	}
	return nil
}

// GetTheme returns the saved theme preference
func (a *App) GetTheme() string {
	if a.config == nil {
		fmt.Println("GetTheme: config is nil, returning default 'dark'.")
		return "dark"
	}
	// Ensure we have a valid theme value
	theme := a.config.config.Theme
	if theme != "dark" && theme != "light" && theme != "system" {
		return "dark" // Default fallback
	}
	return theme
}

// SetTheme updates the theme preference in the configuration and marks it dirty
func (a *App) SetTheme(theme string) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set theme")
	}

	// Validate theme value
	if theme != "dark" && theme != "light" && theme != "system" {
		return fmt.Errorf("invalid theme value: %s. Must be 'dark', 'light', or 'system'", theme)
	}

	if a.config.config.Theme != theme {
		a.config.config.Theme = theme
		fmt.Printf("Theme preference updated to: %s\n", theme)
		a.markConfigDirty()
	}
	return nil
}
