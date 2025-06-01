# app_unix.go Analysis

## Overview
Unix-specific platform implementation with 174 lines. Handles shell detection, PTY configuration, and SSH key management for non-Windows platforms.

## Critical Issues

### 1. **Security Vulnerabilities**
- **Lines 140-174**: SSH key discovery automatically scans `.ssh` directory
- **Line 161**: Limits to 10 keys but still reads all keys without consent
- **No user permission**: Scans private keys without explicit authorization
- **Privacy violation**: Same issue as in ssh_manager.go

### 2. **Error Handling Issues**
- **Line 19**: fileExists() ignores specific error types (permissions, etc.)
- **Line 126**: Shell executable check only verifies basic executable bit
- **No validation**: Shell paths not validated for safety before execution

### 3. **Platform Detection Flaws**
- **Build constraint**: Uses `!windows` which includes all non-Windows platforms
- **Runtime checks**: Additional runtime.GOOS checks create nested platform logic
- **Inconsistent behavior**: Different shell priorities for macOS vs Linux

## Potential Bugs

### 1. **Shell Detection Issues**
- **Lines 81-89**: macOS/Linux shell paths have different priorities
- **Duplicate detection**: Same shell could be found multiple times
- **No deduplication**: getAvailableShells() doesn't remove duplicates
- **Path precedence**: No clear precedence when multiple shells found

### 2. **PTY Configuration Problems**
- **Lines 68-78**: macOS-specific configuration may not work on all macOS versions
- **Environment variables**: TERM=xterm-256color hardcoded without detection
- **Process attributes**: Setpgid=false may cause process group issues

### 3. **File System Issues**
- **No permission checks**: Doesn't verify execute permissions properly
- **Symlink handling**: No special handling for symbolic links
- **Home directory**: Multiple ways to get home directory, inconsistent fallback

## Design Issues

### 1. **Code Duplication**
- **Shell paths**: Hardcoded paths duplicated between functions
- **Platform checks**: runtime.GOOS checked multiple times
- **Path logic**: Similar path checking logic repeated

### 2. **Magic Constants**
- **Line 76**: TERM=xterm-256color hardcoded
- **Line 161**: Magic number 10 for key limit
- **Shell paths**: All shell paths hardcoded without configuration

### 3. **Inconsistent Patterns**
- **Error handling**: Some functions return errors, others return empty results
- **Naming**: Mix of camelCase and snake_case in different contexts
- **Return types**: Inconsistent return patterns across similar functions

## Performance Issues

### 1. **File System Operations**
- **Repeated stat calls**: Multiple os.Stat() calls for same paths
- **No caching**: Shell detection repeated every time
- **Sequential scanning**: SSH directory scanned sequentially without optimization

### 2. **Memory Usage**
- **String arrays**: Multiple large string arrays for shell paths
- **No lazy evaluation**: All paths checked even if first one succeeds

## Security Recommendations

### 1. **SSH Key Access Control**
```go
func (a *App) getDefaultSSHKeyPaths() []string {
    // NEVER automatically scan SSH directory
    // Require explicit user consent
    if !a.userConsentForSSHKeys {
        return []string{} // Return empty, require manual key selection
    }
    
    // Only return keys explicitly approved by user
    return a.approvedSSHKeys
}
```

### 2. **Shell Path Validation**
```go
func validateShellPath(path string) error {
    // Check if path is within allowed directories
    allowedDirs := []string{"/bin", "/usr/bin", "/usr/local/bin"}
    
    absPath, err := filepath.Abs(path)
    if err != nil {
        return err
    }
    
    for _, allowedDir := range allowedDirs {
        if strings.HasPrefix(absPath, allowedDir) {
            return nil
        }
    }
    
    return fmt.Errorf("shell path not in allowed directories")
}
```

### 3. **Better Permission Checking**
```go
func isExecutable(path string) bool {
    info, err := os.Stat(path)
    if err != nil {
        return false
    }
    
    // Check if file and executable
    mode := info.Mode()
    return mode.IsRegular() && (mode.Perm()&0111) != 0
}
```

## Code Quality Improvements

### 1. **Extract Constants**
```go
const (
    DefaultTermType = "xterm-256color"
    MaxSSHKeys     = 10
    
    // Shell paths
    BinDir        = "/bin"
    UsrBinDir     = "/usr/bin"
    LocalBinDir   = "/usr/local/bin"
    HomebrewDir   = "/opt/homebrew/bin"
)
```

### 2. **Deduplicate Shell Detection**
```go
type ShellDetector struct {
    platform string
    paths    map[string][]string
}

func (sd *ShellDetector) FindShells() []string {
    var found []string
    seen := make(map[string]bool)
    
    for shell, paths := range sd.paths {
        for _, path := range paths {
            if isExecutable(path) && !seen[shell] {
                found = append(found, shell)
                seen[shell] = true
                break
            }
        }
    }
    return found
}
```

### 3. **Better Error Handling**
```go
type ShellError struct {
    Shell   string
    Paths   []string
    Message string
}

func (e *ShellError) Error() string {
    return fmt.Sprintf("shell '%s' not found in paths %v: %s", 
        e.Shell, e.Paths, e.Message)
}
```

## Platform-Specific Issues

### 1. **macOS Specifics**
- **Homebrew paths**: Assumes Homebrew installation patterns
- **System Integrity Protection**: May affect some shell operations
- **Process attributes**: macOS-specific syscall configurations

### 2. **Linux Variations**
- **Distribution differences**: Different Linux distros have different shell locations
- **Package managers**: Doesn't account for snap, flatpak, or other package managers
- **Container environments**: May not work correctly in containers

## Recommended Improvements

### 1. **Remove Automatic SSH Key Scanning**
```go
// Replace automatic scanning with explicit user selection
func (a *App) requestSSHKeySelection() []string {
    // Show UI for user to select SSH keys
    // Only scan after explicit user consent
    return userSelectedKeys
}
```

### 2. **Improve Shell Detection Caching**
```go
type shellCache struct {
    shells     []string
    timestamp  time.Time
    mutex      sync.RWMutex
}

func (a *App) getAvailableShellsCached() []string {
    // Cache shell detection results
    // Refresh only when needed
}
```

### 3. **Better Platform Abstraction**
```go
type PlatformShellDetector interface {
    GetAvailableShells() []string
    FindShellExecutable(shell string) (string, error)
    ConfigurePTY(cmd *pty.Cmd) error
}

type UnixShellDetector struct {
    platform string
}
```

## Immediate Action Items

1. **SECURITY**: Remove automatic SSH key scanning - require user consent
2. **Validation**: Add proper shell path validation
3. **Caching**: Implement shell detection caching
4. **Constants**: Extract hardcoded values to constants
5. **Error handling**: Improve error messages and handling
6. **Deduplication**: Remove duplicate shell detection logic

## Code Quality Score: 4/10
- **Security**: Poor (automatic SSH key scanning)
- **Performance**: Fair (repeated file operations)
- **Maintainability**: Fair (some duplication, platform mixing)
- **Error handling**: Fair (basic error handling present) 