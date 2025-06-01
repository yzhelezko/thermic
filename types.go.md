# types.go Analysis

## Overview
Defines all data structures for Thermic terminal emulator. Contains 11 main types and 224 lines of struct definitions.

## Critical Issues

### 1. **Data Structure Design Flaws**
- **App struct (lines 13-29)**: Massive struct with too many responsibilities
- **Memory leaks**: Multiple maps (`sessions`, `tabs`, `profiles`) without size limits
- **Circular references**: `ProfileWatcher` contains `*App`, potential memory leak

### 2. **Deprecated Fields - Technical Debt**
- **Profile.FolderPath (line 80)**: Marked DEPRECATED but still present
- **ProfileFolder.ParentPath (line 97)**: Also deprecated
- **Migration needed**: Old field coexisting with new ones creates inconsistency

### 3. **Concurrency Issues**
- **App.mutex (line 18)**: Single RWMutex for entire app state (contention bottleneck)
- **Missing synchronization**: Several maps lack proper mutex protection
- **Race conditions**: `TerminalSession.cleaning` field (line 41) without mutex

## Potential Bugs

### 1. **SSH Configuration Security**
- **SSHConfig.Password (line 54)**: Plain text password storage
- **No validation**: Password and key path can both be empty
- **JSON exposure**: Sensitive data serialized to frontend

### 2. **Channel Management**
- **TerminalSession channels (lines 37-38)**: `done` and `closed` channels never show cleanup
- **ProfileWatcher channels (line 128)**: No buffer size specified, potential deadlock

### 3. **File History Vulnerabilities**
- **FileHistoryEntry.Path (line 59)**: No path validation, potential traversal attacks
- **Unbounded growth**: No limit on `Profile.FileHistory` array size

## Design Pattern Issues

### 1. **Poor Separation of Concerns**
- **App struct**: Mixes terminal, SSH, profile, and file management
- **Profile struct**: 90+ lines with too many responsibilities
- **Type mixing**: UI concerns (JSON tags) mixed with persistence (YAML tags)

### 2. **Naming Inconsistencies**
- **ID vs Id**: `ProfileID` vs `activeTabId` inconsistent casing
- **Mixed conventions**: Some use `Config` suffix, others don't
- **Redundant API suffix**: Many types have unnecessary API wrappers

### 3. **Type Safety Issues**
- **String-based IDs**: No type safety for different ID types
- **Magic strings**: Status values ("connecting", "connected") not constants
- **Interface{} usage**: Should use proper types instead

## Memory Optimization Issues

### 1. **Large Structs**
- **Profile struct**: 20+ fields, should be split
- **App struct**: 16 fields of various maps and complex types
- **No lazy loading**: All data loaded into memory

### 2. **Inefficient Data Storage**
- **Map[string] everywhere**: Consider using more efficient data structures
- **Duplicate data**: Profile data duplicated in multiple places
- **No caching strategy**: Fresh data fetched every time

## Security Concerns

### 1. **Sensitive Data Exposure**
- **SSH passwords**: Stored in plain text in structs
- **Key paths**: Exposed in JSON serialization
- **No encryption**: Configuration files store sensitive data unencrypted

### 2. **Input Validation**
- **No field validation**: Structs accept any string values
- **Path injection**: File paths not validated
- **No size limits**: Arrays can grow unbounded

## Recommended Fixes

### 1. **Struct Decomposition**
```go
// Split App into focused components
type App struct {
    ctx          context.Context
    terminal     *TerminalManager
    profiles     *ProfileManager  
    ssh          *SSHManager
    files        *FileManager
    config       *ConfigManager
}
```

### 2. **Type Safety Improvements**
```go
type SessionID string
type ProfileID string
type TabID string

type ConnectionStatus int
const (
    StatusConnecting ConnectionStatus = iota
    StatusConnected
    StatusFailed
    StatusDisconnected
)
```

### 3. **Security Enhancements**
```go
type SecureSSHConfig struct {
    Host         string
    Port         int  
    Username     string
    KeyPath      string          // Only key-based auth
    PasswordHash []byte `json:"-"` // Never serialize
}
```

### 4. **Resource Management**
```go
type BoundedMap[K comparable, V any] struct {
    data     map[K]V
    maxSize  int
    mutex    sync.RWMutex
}
```

## Performance Optimizations
1. **Use sync.Pool** for frequently allocated structs
2. **Implement lazy loading** for profile data
3. **Add size limits** to all maps and slices
4. **Use more specific mutexes** instead of single global mutex

## Immediate Actions Required
1. **Remove deprecated fields** and implement migration
2. **Add field validation** to all structs  
3. **Split App struct** into smaller, focused managers
4. **Implement proper cleanup** for channels and goroutines
5. **Add size limits** to prevent memory exhaustion 