# config.go Analysis

## Overview
Simple configuration management with 42 lines. Defines AppConfig struct and default values for window, shell, and UI settings.

## Critical Issues

### 1. **Missing Essential Features**
- **No validation**: Configuration fields accept any values without validation
- **No config file operations**: Only struct definition, no load/save logic
- **No migration logic**: Legacy `DefaultShell` field but no migration code visible
- **No environment variable support**: Common pattern missing

### 2. **Security & Input Validation**
- **Path injection risk**: `ProfilesPath` field with no validation
- **No size limits**: Window dimensions could be set to extreme values
- **Shell path validation**: No verification that shell paths are safe/exist

### 3. **Platform Handling**
- **Redundant platform shells**: Three separate fields instead of runtime detection
- **Magic strings**: Platform names hardcoded instead of constants
- **No platform validation**: Could set Linux shell on Windows

## Design Issues

### 1. **Poor Default Handling**
- **Empty string defaults**: DefaultShell* fields use "" instead of nil/omit pattern
- **Hard-coded values**: Magic numbers (1024, 768, 250) should be constants
- **No environment detection**: Defaults don't consider actual system capabilities

### 2. **Limited Extensibility**
- **Flat structure**: No nested configuration groups
- **No versioning**: No config format version for future migrations
- **Tight coupling**: UI settings mixed with core application settings

### 3. **Missing Features**
- **No backup/restore**: Configuration changes can't be rolled back
- **No validation rules**: No way to enforce valid ranges or values
- **No hot reload**: Changes require restart
- **No user preferences**: Only application-level config

## Potential Bugs

### 1. **Edge Cases**
- **Negative dimensions**: WindowWidth/Height could be negative
- **Invalid theme**: Theme field accepts any string
- **Zero sidebar width**: Could make UI unusable

### 2. **Migration Issues**
- **Legacy field handling**: DefaultShell field marked legacy but no cleanup
- **Breaking changes**: No way to handle incompatible config versions
- **Partial migration**: Some fields migrated, others orphaned

## Performance Issues
- **No caching**: Config likely re-read multiple times
- **No lazy loading**: All config loaded even if not needed
- **Serialization overhead**: YAML parsing for simple values

## Recommended Improvements

### 1. **Add Validation**
```go
func (c *AppConfig) Validate() error {
    if c.WindowWidth < 100 || c.WindowWidth > 10000 {
        return fmt.Errorf("invalid window width: %d", c.WindowWidth)
    }
    if c.SidebarWidth < 100 || c.SidebarWidth > 1000 {
        return fmt.Errorf("invalid sidebar width: %d", c.SidebarWidth)
    }
    // ... more validation
    return nil
}
```

### 2. **Use Constants**
```go
const (
    DefaultWindowWidth  = 1024
    DefaultWindowHeight = 768
    DefaultSidebarWidth = 250
    MinWindowWidth      = 800
    MinWindowHeight     = 600
)
```

### 3. **Better Platform Handling**
```go
type PlatformShells struct {
    Windows string `yaml:"windows,omitempty"`
    Linux   string `yaml:"linux,omitempty"`
    Darwin  string `yaml:"darwin,omitempty"`
}

type AppConfig struct {
    // ... other fields
    DefaultShells PlatformShells `yaml:"default_shells"`
}
```

### 4. **Add Configuration Management**
```go
type ConfigManager struct {
    config   *AppConfig
    filePath string
    mutex    sync.RWMutex
}

func (cm *ConfigManager) Load() error { /* ... */ }
func (cm *ConfigManager) Save() error { /* ... */ }
func (cm *ConfigManager) Validate() error { /* ... */ }
```

## Missing Functionality
1. **Config file location logic** (user vs system)
2. **Environment variable overrides**
3. **Configuration watching** for external changes
4. **Schema versioning** for future compatibility
5. **Backup and restore** functionality

## Security Recommendations
1. **Validate all paths** to prevent directory traversal
2. **Sanitize shell commands** before execution
3. **Set reasonable limits** on numeric values
4. **Use whitelist validation** for enum-like fields (theme)

## Immediate Actions
1. **Add input validation** for all fields
2. **Define constants** for magic numbers
3. **Implement proper config loading/saving**
4. **Add migration logic** for legacy fields
5. **Consider splitting** UI and core config concerns 