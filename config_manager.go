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

// SettingValue represents a setting value that can be of any type
type SettingValue interface{}

// SettingType represents the data type of a setting
type SettingType string

const (
	SettingTypeBool   SettingType = "bool"
	SettingTypeInt    SettingType = "int"
	SettingTypeString SettingType = "string"
	SettingTypePath   SettingType = "path"
	SettingTypeMap    SettingType = "map" // For complex nested settings like SFTP config
)

// SettingConfig contains all configuration options for a setting
type SettingConfig struct {
	Name string
	Type SettingType

	// Validation options
	Min           *int
	Max           *int
	AllowedValues []string
	MaxLength     *int

	// Event options
	RequiresEvent bool
	EventName     string

	// Update options
	ConfigField   string                                 // Field name in config struct
	RequiresMutex bool                                   // Whether this field requires mutex locking
	CustomUpdate  func(a *App, value SettingValue) error // Only for special cases
}

// Validate validates a setting value according to its configuration
func (c *SettingConfig) Validate(value SettingValue) error {
	switch c.Type {
	case SettingTypeBool:
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("invalid type for %s: expected bool, got %T", c.Name, value)
		}

	case SettingTypeInt:
		var intVal int

		// Handle both int and float64 types (JavaScript sends numbers as float64)
		switch val := value.(type) {
		case int:
			intVal = val
		case float64:
			// Convert float64 to int, ensuring it's a whole number
			if val != float64(int(val)) {
				return fmt.Errorf("%s must be a whole number, got %v", c.Name, val)
			}
			intVal = int(val)
		default:
			return fmt.Errorf("invalid type for %s: expected int or number, got %T", c.Name, value)
		}

		if c.Min != nil && intVal < *c.Min {
			return fmt.Errorf("%s %d below minimum %d", c.Name, intVal, *c.Min)
		}
		if c.Max != nil && intVal > *c.Max {
			return fmt.Errorf("%s %d above maximum %d", c.Name, intVal, *c.Max)
		}

	case SettingTypeString, SettingTypePath:
		strVal, ok := value.(string)
		if !ok {
			return fmt.Errorf("invalid type for %s: expected string, got %T", c.Name, value)
		}

		// For paths, empty values are allowed (means use default)
		if c.Type == SettingTypePath && strVal == "" {
			return nil
		}

		if c.MaxLength != nil && len(strVal) > *c.MaxLength {
			return fmt.Errorf("%s too long (max %d characters)", c.Name, *c.MaxLength)
		}

		if len(c.AllowedValues) > 0 {
			for _, allowed := range c.AllowedValues {
				if strVal == allowed {
					return nil
				}
			}
			return fmt.Errorf("invalid %s '%s', allowed values: %v", c.Name, strVal, c.AllowedValues)
		}

	case SettingTypeMap:
		// Map types are validated by the CustomUpdate function
		if _, ok := value.(map[string]interface{}); !ok {
			return fmt.Errorf("invalid type for %s: expected map, got %T", c.Name, value)
		}

	default:
		return fmt.Errorf("unknown setting type: %s", c.Type)
	}

	return nil
}

// Update updates the setting value using universal logic or custom function
func (c *SettingConfig) Update(a *App, value SettingValue) error {
	// Use custom update function if provided
	if c.CustomUpdate != nil {
		return c.CustomUpdate(a, value)
	}

	// Universal update logic based on field mapping
	if c.ConfigField == "" {
		return fmt.Errorf("no config field or custom update function defined for setting %s", c.Name)
	}

	// Apply mutex if required
	if c.RequiresMutex {
		a.config.mutex.Lock()
		defer a.config.mutex.Unlock()
	}

	// Convert value to proper type for integers (handle JavaScript float64)
	if c.Type == SettingTypeInt {
		switch val := value.(type) {
		case float64:
			value = int(val)
		case int:
			// Already correct type
		default:
			return fmt.Errorf("invalid type for %s: expected int or number, got %T", c.Name, value)
		}
	}

	// Update the appropriate config field
	switch c.ConfigField {
	case "EnableSelectToCopy":
		a.config.config.EnableSelectToCopy = value.(bool)
	case "ProfilesPath":
		path := value.(string)
		if a.config.config.ProfilesPath != path {
			a.config.config.ProfilesPath = path
			fmt.Printf("Profiles path updated to: %s\n", path)
			// Reload profiles from new path
			if err := a.LoadProfiles(); err != nil {
				fmt.Printf("Warning: Failed to reload profiles from new path: %v\n", err)
			}
		}
		return nil
	case "SidebarCollapsed":
		a.config.config.SidebarCollapsed = value.(bool)
	case "SidebarWidth":
		a.config.config.SidebarWidth = value.(int)
	case "SidebarProfilesWidth":
		a.config.config.SidebarProfilesWidth = value.(int)
	case "SidebarFilesWidth":
		a.config.config.SidebarFilesWidth = value.(int)
	case "Theme":
		a.config.config.Theme = value.(string)
	case "ScrollbackLines":
		a.config.config.ScrollbackLines = value.(int)
	case "OpenLinksInExternalBrowser":
		a.config.config.OpenLinksInExternalBrowser = value.(bool)

	// AI Configuration Fields
	case "AI.Enabled":
		a.config.config.AI.Enabled = value.(bool)
	case "AI.Provider":
		a.config.config.AI.Provider = value.(string)
	case "AI.APIKey":
		a.config.config.AI.APIKey = value.(string)
	case "AI.APIURL":
		a.config.config.AI.APIURL = value.(string)
	case "AI.ModelID":
		a.config.config.AI.ModelID = value.(string)
	case "AI.Hotkey":
		a.config.config.AI.Hotkey = value.(string)

	default:
		return fmt.Errorf("unknown config field: %s", c.ConfigField)
	}

	fmt.Printf("%s updated to: %v\n", c.Name, value)
	return nil
}

// GetEventData returns event data for settings that require events
func (c *SettingConfig) GetEventData(value SettingValue) map[string]interface{} {
	if !c.RequiresEvent {
		return nil
	}
	return map[string]interface{}{c.Name: value}
}

// Custom update function for DefaultShell (needs platform-specific handling)
func updateDefaultShell(a *App, value SettingValue) error {
	shellPath := value.(string)
	currentShell := a.getPlatformDefaultShell()
	if currentShell != shellPath {
		a.setPlatformDefaultShell(shellPath)
		fmt.Printf("Default shell for %s set to: %s\n", getOSName(), shellPath)
	}
	return nil
}

// Custom update function for AI settings that also updates the AI manager
func updateAIEnabledSetting(a *App, value SettingValue) error {
	enabled := value.(bool)
	a.config.config.AI.Enabled = enabled

	// Update AI manager with new config if available
	if a.ai != nil {
		if err := a.ai.UpdateConfig(&a.config.config.AI); err != nil {
			fmt.Printf("Warning: Failed to update AI manager with new config: %v\n", err)
		}
	}

	fmt.Printf("AI enabled setting updated to: %v\n", enabled)
	return nil
}

// Custom update function for AI provider that also updates the AI manager
func updateAIProviderSetting(a *App, value SettingValue) error {
	provider := value.(string)
	a.config.config.AI.Provider = provider

	// Update AI manager with new config if available
	if a.ai != nil {
		if err := a.ai.UpdateConfig(&a.config.config.AI); err != nil {
			fmt.Printf("Warning: Failed to update AI manager with new config: %v\n", err)
		}
	}

	fmt.Printf("AI provider updated to: %s\n", provider)
	return nil
}

// Custom update function for AI API key that also updates the AI manager
func updateAIAPIKeySetting(a *App, value SettingValue) error {
	apiKey := value.(string)
	a.config.config.AI.APIKey = apiKey

	// Update AI manager with new config if available
	if a.ai != nil {
		if err := a.ai.UpdateConfig(&a.config.config.AI); err != nil {
			fmt.Printf("Warning: Failed to update AI manager with new config: %v\n", err)
		}
	}

	fmt.Printf("AI API key updated\n") // Don't log the actual key for security
	return nil
}

// Custom update function for SFTP settings
func updateSFTPSetting(a *App, value SettingValue) error {
	// The value comes as a map[string]interface{} from JavaScript
	sftpMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid SFTP config type: expected map, got %T", value)
	}

	// Update each field if present
	if v, exists := sftpMap["max_packet_size"]; exists {
		if intVal, ok := toInt(v); ok {
			a.config.config.SFTP.MaxPacketSize = intVal
		}
	}
	if v, exists := sftpMap["buffer_size"]; exists {
		if intVal, ok := toInt(v); ok {
			a.config.config.SFTP.BufferSize = intVal
		}
	}
	if v, exists := sftpMap["concurrent_requests"]; exists {
		if intVal, ok := toInt(v); ok {
			a.config.config.SFTP.ConcurrentRequests = intVal
		}
	}
	if v, exists := sftpMap["parallel_transfers"]; exists {
		if intVal, ok := toInt(v); ok {
			a.config.config.SFTP.ParallelTransfers = intVal
		}
	}
	if v, exists := sftpMap["use_concurrent_io"]; exists {
		if boolVal, ok := v.(bool); ok {
			a.config.config.SFTP.UseConcurrentIO = boolVal
		}
	}

	fmt.Printf("SFTP settings updated: %+v\n", a.config.config.SFTP)
	return nil
}

// Helper to convert interface{} to int (handles float64 from JSON)
func toInt(v interface{}) (int, bool) {
	switch val := v.(type) {
	case int:
		return val, true
	case int64:
		return int(val), true
	case float64:
		return int(val), true
	default:
		return 0, false
	}
}

// Helper function to create pointer to int
func intPtr(i int) *int {
	return &i
}

// Initialize setting configurations
var settingConfigs = map[string]*SettingConfig{
	"DefaultShell": {
		Name:         "DefaultShell",
		Type:         SettingTypePath,
		MaxLength:    intPtr(1024),
		CustomUpdate: updateDefaultShell, // Needs special platform handling
	},
	"EnableSelectToCopy": {
		Name:        "EnableSelectToCopy",
		Type:        SettingTypeBool,
		ConfigField: "EnableSelectToCopy",
	},
	"ProfilesPath": {
		Name:        "ProfilesPath",
		Type:        SettingTypePath,
		MaxLength:   intPtr(1024),
		ConfigField: "ProfilesPath", // Has special reload logic in Update method
	},
	"SidebarCollapsed": {
		Name:        "SidebarCollapsed",
		Type:        SettingTypeBool,
		ConfigField: "SidebarCollapsed",
	},
	"SidebarWidth": {
		Name:        "SidebarWidth",
		Type:        SettingTypeInt,
		Min:         intPtr(MinSidebarWidth),
		Max:         intPtr(MaxSidebarWidth),
		ConfigField: "SidebarWidth",
	},
	"SidebarProfilesWidth": {
		Name:        "SidebarProfilesWidth",
		Type:        SettingTypeInt,
		Min:         intPtr(MinSidebarWidth),
		Max:         intPtr(MaxSidebarWidth),
		ConfigField: "SidebarProfilesWidth",
	},
	"SidebarFilesWidth": {
		Name:        "SidebarFilesWidth",
		Type:        SettingTypeInt,
		Min:         intPtr(MinSidebarWidth),
		Max:         intPtr(MaxSidebarWidth),
		ConfigField: "SidebarFilesWidth",
	},
	"Theme": {
		Name:          "Theme",
		Type:          SettingTypeString,
		AllowedValues: AllowedThemes,
		ConfigField:   "Theme",
	},
	"ScrollbackLines": {
		Name:          "ScrollbackLines",
		Type:          SettingTypeInt,
		Min:           intPtr(MinScrollbackLines),
		Max:           intPtr(MaxScrollbackLines),
		RequiresEvent: true,
		EventName:     "config:scrollback-lines-changed",
		ConfigField:   "ScrollbackLines",
		RequiresMutex: true,
	},
	"OpenLinksInExternalBrowser": {
		Name:          "OpenLinksInExternalBrowser",
		Type:          SettingTypeBool,
		RequiresEvent: true,
		EventName:     "config:open-links-external-changed",
		ConfigField:   "OpenLinksInExternalBrowser",
	},
	// AI Configuration Settings
	"AIEnabled": {
		Name:         "AIEnabled",
		Type:         SettingTypeBool,
		CustomUpdate: updateAIEnabledSetting,
	},
	"AIProvider": {
		Name:          "AIProvider",
		Type:          SettingTypeString,
		AllowedValues: []string{"openai", "gemini"},
		CustomUpdate:  updateAIProviderSetting,
	},
	"AIAPIKey": {
		Name:         "AIAPIKey",
		Type:         SettingTypeString,
		MaxLength:    intPtr(512),
		CustomUpdate: updateAIAPIKeySetting,
	},
	"AIURL": {
		Name:        "AIURL",
		Type:        SettingTypeString,
		MaxLength:   intPtr(1024),
		ConfigField: "AI.APIURL",
	},
	"AIModelID": {
		Name:        "AIModelID",
		Type:        SettingTypeString,
		MaxLength:   intPtr(256),
		ConfigField: "AI.ModelID",
	},
	"AIHotkey": {
		Name:        "AIHotkey",
		Type:        SettingTypeString,
		MaxLength:   intPtr(32),
		ConfigField: "AI.Hotkey",
	},
	// SFTP Configuration
	"SFTP": {
		Name:         "SFTP",
		Type:         SettingTypeMap,
		CustomUpdate: updateSFTPSetting,
	},
}

// ConfigSet is a universal method for updating any configuration setting
func (a *App) ConfigSet(settingName string, value SettingValue) error {
	if a.config == nil || a.config.config == nil {
		return &ConfigError{Op: "set_setting", Err: fmt.Errorf("config not initialized")}
	}

	// Get setting configuration
	config, exists := settingConfigs[settingName]
	if !exists {
		return &ConfigError{Op: "set_setting", Err: fmt.Errorf("unknown setting: %s", settingName)}
	}

	// Validate the value
	if err := config.Validate(value); err != nil {
		return &ConfigError{Op: "validate_setting", Err: err}
	}

	// Update the setting
	if err := config.Update(a, value); err != nil {
		return &ConfigError{Op: "set_setting", Err: err}
	}

	// Mark config as dirty to save changes
	a.markConfigDirty()

	// Emit events if required
	if config.RequiresEvent && a.ctx != nil {
		eventData := config.GetEventData(value)
		wailsRuntime.EventsEmit(a.ctx, config.EventName, eventData)
	}

	return nil
}

// ConfigGet is a universal method for retrieving any configuration setting
func (a *App) ConfigGet(settingName string) (SettingValue, error) {
	if a.config == nil || a.config.config == nil {
		return nil, &ConfigError{Op: "get_setting", Err: fmt.Errorf("config not initialized")}
	}

	// Check if setting exists
	if _, exists := settingConfigs[settingName]; !exists {
		return nil, &ConfigError{Op: "get_setting", Err: fmt.Errorf("unknown setting: %s", settingName)}
	}

	// Return the appropriate setting value
	switch settingName {
	case "DefaultShell":
		return a.getPlatformDefaultShell(), nil
	case "EnableSelectToCopy":
		return a.config.config.EnableSelectToCopy, nil
	case "ProfilesPath":
		return a.config.config.ProfilesPath, nil
	case "SidebarCollapsed":
		return a.config.config.SidebarCollapsed, nil
	case "SidebarWidth":
		return a.config.config.SidebarWidth, nil
	case "SidebarProfilesWidth":
		return a.config.config.SidebarProfilesWidth, nil
	case "SidebarFilesWidth":
		return a.config.config.SidebarFilesWidth, nil
	case "Theme":
		return a.config.config.Theme, nil
	case "ScrollbackLines":
		a.config.mutex.RLock()
		defer a.config.mutex.RUnlock()
		return a.config.config.ScrollbackLines, nil
	case "OpenLinksInExternalBrowser":
		return a.config.config.OpenLinksInExternalBrowser, nil

	// AI Configuration Settings
	case "AIEnabled":
		return a.config.config.AI.Enabled, nil
	case "AIProvider":
		return a.config.config.AI.Provider, nil
	case "AIAPIKey":
		return a.config.config.AI.APIKey, nil
	case "AIURL":
		return a.config.config.AI.APIURL, nil
	case "AIModelID":
		return a.config.config.AI.ModelID, nil
	case "AIHotkey":
		return a.config.config.AI.Hotkey, nil

	// SFTP Configuration
	case "SFTP":
		return map[string]interface{}{
			"max_packet_size":      a.config.config.SFTP.MaxPacketSize,
			"buffer_size":          a.config.config.SFTP.BufferSize,
			"concurrent_requests":  a.config.config.SFTP.ConcurrentRequests,
			"parallel_transfers":   a.config.config.SFTP.ParallelTransfers,
			"use_concurrent_io":    a.config.config.SFTP.UseConcurrentIO,
		}, nil

	default:
		return nil, &ConfigError{Op: "get_setting", Err: fmt.Errorf("unhandled setting: %s", settingName)}
	}
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
