# config_manager.go Analysis

## Overview
Configuration management implementation with 403 lines. Handles loading, saving, validation, and migration of application configuration.

## Critical Issues

### 1. **Error Handling Patterns**
- **Lines 40, 45, 57**: Swallowing errors with fmt.Printf instead of proper error handling
- **Line 131**: Error in saveConfig() doesn't propagate up, keeps dirty flag set
- **Inconsistent fallbacks**: Some methods return defaults on nil config, others return errors

### 2. **Resource Management**
- **Line 116**: Timer created in markConfigDirty but potential race conditions
- **No cleanup**: Debounce timer may leak if app shuts down quickly
- **File locking**: No file locking during config save operations

### 3. **Data Integrity Issues**
- **Line 320**: SetProfilesPath reloads profiles but doesn't rollback config on failure
- **No atomic operations**: Config file could be corrupted if save fails mid-write
- **No backup**: Previous config version not preserved before overwriting

## Potential Bugs

### 1. **Concurrency Issues**
- **Lines 109-123**: markConfigDirty has race condition between timer stop and create
- **Timer callback (line 118)**: Could execute after app shutdown if ctx becomes nil
- **Multiple markConfigDirty calls**: Could create multiple timers without proper cleanup

### 2. **Migration Logic Flaws**
- **Lines 238-250**: migrateLegacyConfig sets shell even if platform already has one
- **Line 247**: Clearing DefaultShell always returns true even if no migration needed
- **No migration version tracking**: Could re-migrate already migrated configs

### 3. **Validation Issues**
- **SetTheme (line 386)**: Only validates known themes but accepts any string initially
- **No bounds checking**: SetSidebarWidth accepts any integer (could be negative)
- **Path validation missing**: SetProfilesPath doesn't validate if path exists/writable

## Design Issues

### 1. **Poor Separation of Concerns**
- **Mixed responsibilities**: Configuration management mixed with window state tracking
- **UI coupling**: Config manager knows about Wails runtime directly
- **Business logic leakage**: Profile reloading logic in config setter

### 2. **Inefficient Patterns**
- **Repeated nil checks**: Every getter/setter checks if config is nil
- **Platform detection**: runtime.GOOS checked multiple times instead of caching
- **File I/O**: No caching, re-reads config file unnecessarily

### 3. **Maintenance Issues**
- **Magic strings**: Platform names ("windows", "darwin") hardcoded multiple places
- **Duplication**: Similar patterns repeated across different setters
- **No validation abstraction**: Each setter implements its own validation

## Code Quality Issues

### 1. **Error Messages & Logging**
- **Inconsistent logging**: Mix of fmt.Printf and fmt.Println
- **Poor error context**: Generic error messages without stack traces
- **No log levels**: All output at same level, no debug/info distinction

### 2. **Method Naming**
- **Inconsistent prefixes**: Some use "Get/Set", others just action verbs
- **Platform methods**: getPlatformDefaultShell/setPlatformDefaultShell not exported but used widely
- **API surface**: Too many public methods, should limit exported functions

## Performance Issues

### 1. **File I/O Optimization**
- **No caching**: Config read from disk every time (though this may be intentional)
- **Debouncing**: Good pattern but could batch multiple changes better
- **YAML overhead**: Using reflection-heavy YAML for simple key-value config

### 2. **Memory Usage**
- **Timer objects**: Creating new timers frequently instead of reusing
- **String duplication**: Platform names created repeatedly
- **No pooling**: Config objects not reused

## Security Issues

### 1. **File System**
- **Directory creation**: Creates directories with fixed permissions, may be too permissive
- **No path validation**: SetProfilesPath could write outside intended directories
- **Race conditions**: Config file could be read by other processes during write

### 2. **Input Validation**
- **Shell paths**: No validation that shell executables are safe
- **Path traversal**: Profiles path could potentially escape intended directory
- **Integer overflow**: Width/height values not checked for reasonable bounds

## Recommended Improvements

### 1. **Better Error Handling**
```go
type ConfigError struct {
    Op   string
    Path string
    Err  error
}

func (e *ConfigError) Error() string {
    return fmt.Sprintf("config %s %s: %v", e.Op, e.Path, e.Err)
}
```

### 2. **Atomic Operations**
```go
func (a *App) saveConfigAtomic() error {
    tmpPath := a.configPath + ".tmp"
    if err := a.writeConfigToFile(tmpPath); err != nil {
        return err
    }
    return os.Rename(tmpPath, a.configPath)
}
```

### 3. **Better Validation**
```go
type Validator interface {
    Validate() error
}

func (c *AppConfig) Validate() error {
    var errors []error
    if c.WindowWidth < 100 || c.WindowWidth > 10000 {
        errors = append(errors, fmt.Errorf("invalid window width: %d", c.WindowWidth))
    }
    // ... more validation
    if len(errors) > 0 {
        return fmt.Errorf("config validation failed: %v", errors)
    }
    return nil
}
```

### 4. **Configuration Watching**
```go
type ConfigWatcher struct {
    watcher  *fsnotify.Watcher
    callback func(*AppConfig)
}
```

## Immediate Action Items

1. **Fix race conditions** in timer management
2. **Add proper validation** for all config values
3. **Implement atomic file operations** for config saves
4. **Add configuration backup** before overwriting
5. **Improve error handling** and logging consistency
6. **Extract platform detection** to constants
7. **Add bounds checking** for numeric values
8. **Implement proper cleanup** for resources

## Optimization Opportunities

1. **Cache config in memory** and only write when changed
2. **Use structured logging** instead of fmt.Printf
3. **Implement config watching** for external changes
4. **Add configuration validation** on load
5. **Use type-safe enums** for theme and other string values 