# app.go Analysis

## Overview
Core application file containing 2444 lines with main business logic for Thermic terminal emulator. Handles tab management, SSH connections, system monitoring, profile management, and file operations.

## Critical Issues

### 1. **Resource Leaks & Memory Management**
- **Lines 1996-2080**: SFTP clients stored in maps but potential cleanup issues
- **Line 2066**: `CloseFileExplorerSession` doesn't check for active operations before cleanup
- **Lines 94-115**: Session cleanup during shutdown has timeouts but no graceful degradation

### 2. **Error Handling Inconsistencies**
- **Line 32**: `fmt.Println("Error loading config:", err)` - should use structured logging
- **Line 47**: Nil config check after startup, but continues execution
- **Lines 1586-1805**: Remote command execution with no timeout controls
- **Error propagation**: Many methods return errors but callers don't handle them properly

### 3. **Concurrency Issues**
- **Lines 67-72**: Mutex usage during shutdown with defer/recover - race condition potential
- **RWMutex patterns**: Multiple RWMutex locks (`sftpClientsMutex`) but inconsistent lock duration
- **No context cancellation**: Long-running operations don't respect context cancellation

## Potential Bugs

### 1. **SSH/SFTP Operations**
- **Line 2291**: `deleteRemoteDirectoryRecursive` - no protection against symlink loops
- **Line 2395**: File content operations don't validate file sizes (OOM risk)
- **Lines 2421-2444**: `isTextContent` binary detection is naive (false positives possible)

### 2. **Session Management**
- **Line 1225**: `ForceDisconnectTab` doesn't clean up associated resources
- **Line 115**: Session timeout logic may leave orphaned processes
- **Tab reordering**: No validation of tab IDs in `ReorderTabs` (line 1341)

### 3. **File Operations**
- **Line 2132**: Download operations don't check disk space
- **Line 2165**: Upload operations process all files even if one fails
- **No atomic operations**: File operations not transactional

## Code Quality Issues

### 1. **Method Bloat**
- File is 2444 lines - should be split into smaller, focused files
- Methods like `GetSystemStats` (lines 1371-1421) mix different concerns
- API wrapper methods (lines 1969-1989) add unnecessary indirection

### 2. **Naming Inconsistencies**
- Mix of `API` suffix (e.g., `CreateProfileAPI`) and without
- Some methods expose internal details in public interface
- Inconsistent parameter naming (`tabId` vs `sessionID`)

### 3. **Type Safety**
- **Line 183**: `map[string]interface{}` return types reduce type safety
- **Line 1371**: System stats return generic map instead of struct
- Dynamic typing used where structs would be more appropriate

## Optimizations - HIGH PRIORITY

### 1. **File Structure Refactoring**
```
app.go (2444 lines) → Split into:
- app_core.go (startup/shutdown/basic methods)
- app_tabs.go (tab management)
- app_ssh.go (SSH/SFTP operations)
- app_profiles.go (profile management)
- app_system.go (system monitoring)
- app_files.go (file operations)
```

### 2. **Performance Improvements**
- **Lines 1533-1805**: Cache remote system stats instead of executing commands every time
- **Line 2080**: Implement directory listing pagination for large directories
- **Memory usage**: Use streaming for large file operations instead of loading into memory

### 3. **Error Handling Standardization**
```go
// Replace scattered fmt.Println with structured logging
type Logger interface {
    Error(msg string, err error)
    Warn(msg string)
    Info(msg string)
}
```

### 4. **Context Usage**
- Add context.Context to all long-running operations
- Implement proper cancellation for SSH operations
- Add request timeouts for remote operations

## Security Concerns
- **Path traversal**: Remote file operations don't validate paths properly
- **Resource exhaustion**: No limits on concurrent SFTP operations
- **SSH key handling**: Private keys may be logged in error messages

## Dependencies Analysis
- Heavy reliance on external packages (gopsutil, sftp, wails)
- No version pinning visible for system monitoring libraries
- Tight coupling between UI and business logic

## Recommended Immediate Actions
1. **Split file**: Break into 6 smaller, focused files
2. **Add structured logging**: Replace all fmt.Println calls
3. **Fix resource leaks**: Proper cleanup in SFTP operations
4. **Add input validation**: Validate all user inputs and file paths
5. **Implement timeouts**: Add context with timeout to all remote operations 