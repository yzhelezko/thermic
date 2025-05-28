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

	if err := yaml.Unmarshal(data, a.config); err != nil {
		fmt.Printf("Warning: Failed to parse config file %s: %v. Using default config.\n", configPath, err)
		a.config = DefaultConfig() // Reset to default on parse error
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

	data, err := yaml.Marshal(a.config)
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

	a.configDirty = true
	if a.debounceTimer != nil {
		a.debounceTimer.Stop()
	}

	a.debounceTimer = time.AfterFunc(DebounceDelay, func() {
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

	if !a.configDirty {
		return // Nothing to save
	}

	if err := a.saveConfig(); err != nil {
		fmt.Printf("Error saving config: %v\n", err)
		// Keep config dirty so it will be retried later
		return
	}

	fmt.Println("Config saved successfully.")
	a.configDirty = false
}

// updateWindowState updates the config with current window state and marks dirty if changed
func (a *App) updateWindowState() bool {
	if a.ctx == nil || a.config == nil {
		return false
	}

	width, height := wailsRuntime.WindowGetSize(a.ctx)
	isMaximized := wailsRuntime.WindowIsMaximised(a.ctx)

	configChanged := false

	if a.config.WindowWidth != width || a.config.WindowHeight != height {
		a.config.WindowWidth = width
		a.config.WindowHeight = height
		fmt.Printf("Window dimensions updated to %dx%d\n", width, height)
		configChanged = true
	}

	if a.config.WindowMaximized != isMaximized {
		a.config.WindowMaximized = isMaximized
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
	switch runtime.GOOS {
	case "windows":
		a.config.DefaultShellWindows = shellPath
	case "darwin":
		a.config.DefaultShellDarwin = shellPath
	case "linux":
		a.config.DefaultShellLinux = shellPath
	default:
		// For other Unix-like systems, use Linux configuration
		a.config.DefaultShellLinux = shellPath
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
	if a.config.DefaultShell != "" {
		// Only migrate to the current platform if it's not already set
		currentPlatformShell := a.getPlatformDefaultShell()
		if currentPlatformShell == "" {
			// Set only the current platform's shell
			a.setPlatformDefaultShell(a.config.DefaultShell)
			fmt.Printf("Migrated legacy shell '%s' to %s configuration\n", a.config.DefaultShell, getOSName())

			// Clear the legacy field after migration
			a.config.DefaultShell = ""
			return true
		} else {
			// Platform-specific shell already set, just clear legacy field
			fmt.Printf("Legacy shell '%s' found but %s already has platform-specific shell '%s', clearing legacy field\n",
				a.config.DefaultShell, getOSName(), currentPlatformShell)
			a.config.DefaultShell = ""
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
	return a.config.EnableSelectToCopy
}

// SetSelectToCopyEnabled updates the select-to-copy setting
func (a *App) SetSelectToCopyEnabled(enabled bool) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set select-to-copy setting")
	}

	if a.config.EnableSelectToCopy != enabled {
		a.config.EnableSelectToCopy = enabled
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
	return a.config.ProfilesPath
}

// SetProfilesPath updates the profiles directory path in the configuration and marks it dirty
func (a *App) SetProfilesPath(path string) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set profiles path")
	}

	if a.config.ProfilesPath != path {
		a.config.ProfilesPath = path
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
