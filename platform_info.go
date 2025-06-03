// Platform Information Module
//
// This module provides secure, cached platform detection and shell management.
// Key features:
// - Comprehensive shell validation with security checks
// - Thread-safe caching with configurable TTL (30s default)
// - Platform-specific shell detection (Windows, macOS, Linux)
// - WSL distribution validation and security checks
// - Structured error handling with detailed error messages
//
// Security measures:
// - Shell path validation to prevent code injection
// - WSL distribution name sanitization
// - Permission checks for shell executables
// - Path traversal attack prevention
//
// Performance optimizations:
// - Cached OS information and shell lists
// - Efficient deduplication in shell detection
// - Reduced system calls through intelligent caching

package main

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Shell constants
const (
	ShellBash       = "bash"
	ShellZsh        = "zsh"
	ShellFish       = "fish"
	ShellPowerShell = "powershell"
	ShellPwsh       = "pwsh"
	ShellCmd        = "cmd"
	ShellSh         = "sh"
	ShellDash       = "dash"
	ShellAsh        = "ash"
	ShellTcsh       = "tcsh"
	ShellCsh        = "csh"
	ShellKsh        = "ksh"
	ShellGitBash    = "git-bash"
	ShellWSLPrefix  = "wsl::"
)

// Default shells by platform
const (
	DefaultWindowsShell = ShellPowerShell
	DefaultDarwinShell  = ShellZsh
	DefaultLinuxShell   = ShellBash
)

// Shell display names mapping
var shellDisplayNames = map[string]string{
	ShellBash:        "Bash",
	ShellZsh:         "Zsh",
	ShellFish:        "Fish Shell",
	ShellPowerShell:  "PowerShell",
	"powershell.exe": "PowerShell",
	ShellPwsh:        "PowerShell 7+",
	"pwsh.exe":       "PowerShell 7+",
	ShellCmd:         "Command Prompt",
	"cmd.exe":        "Command Prompt",
	ShellSh:          "Bourne Shell (sh)",
	ShellDash:        "Dash Shell",
	ShellAsh:         "Ash Shell",
	ShellTcsh:        "Tcsh Shell",
	ShellCsh:         "C Shell (csh)",
	ShellKsh:         "Korn Shell (ksh)",
	ShellGitBash:     "Git Bash",
	"bash.exe":       "Git Bash",
}

// Cache configuration
const (
	OSInfoCacheTTL = 30 * time.Second
)

// ShellValidationError represents shell validation errors
type ShellValidationError struct {
	Shell    string
	Reason   string
	Platform string
	Err      error
}

func (e *ShellValidationError) Error() string {
	return fmt.Sprintf("shell validation failed for '%s' on %s: %s: %v",
		e.Shell, e.Platform, e.Reason, e.Err)
}

// OSInfoCache provides thread-safe caching for OS information
type OSInfoCache struct {
	osInfo      map[string]interface{}
	shells      []map[string]string
	lastUpdated time.Time
	mutex       sync.RWMutex
	ttl         time.Duration
}

// Global cache instance
var osInfoCache = &OSInfoCache{
	ttl: OSInfoCacheTTL,
}

// ClearOSInfoCache clears the cached OS information to force refresh
func ClearOSInfoCache() {
	osInfoCache.mutex.Lock()
	defer osInfoCache.mutex.Unlock()
	osInfoCache.osInfo = nil
	osInfoCache.shells = nil
	osInfoCache.lastUpdated = time.Time{}
}

// IsOSInfoCacheValid returns whether the cache is still valid
func IsOSInfoCacheValid() bool {
	osInfoCache.mutex.RLock()
	defer osInfoCache.mutex.RUnlock()
	return time.Since(osInfoCache.lastUpdated) < osInfoCache.ttl && osInfoCache.osInfo != nil
}

// GetDefaultShell returns the appropriate default shell for the platform
func (a *App) GetDefaultShell() string {
	if a.config == nil {
		fmt.Println("GetDefaultShell: config is nil, falling back to system default.")
		return getSystemDefaultShell()
	}

	// Get platform-specific shell configuration
	configShell := a.getPlatformDefaultShell()

	if configShell == "" || configShell == "auto" {
		return getSystemDefaultShell()
	}

	// For all shells (including WSL), validate they are safe and available
	if err := a.validateShell(configShell); err != nil {
		fmt.Printf("Shell validation failed for '%s': %v. Falling back to system default '%s'.\n",
			configShell, err, getSystemDefaultShell())
		return getSystemDefaultShell()
	}

	return configShell
}

// validateShell performs comprehensive shell validation
func (a *App) validateShell(shell string) error {
	if shell == "" {
		return &ShellValidationError{
			Shell:    shell,
			Reason:   "empty shell name",
			Platform: runtime.GOOS,
			Err:      fmt.Errorf("shell name cannot be empty"),
		}
	}

	// Special validation for WSL shells
	if strings.HasPrefix(shell, ShellWSLPrefix) {
		return a.validateWSLShell(shell)
	}

	// Check if shell executable exists and is valid
	if _, err := findShellExecutable(shell); err != nil {
		return &ShellValidationError{
			Shell:    shell,
			Reason:   "shell not found or not executable",
			Platform: runtime.GOOS,
			Err:      err,
		}
	}

	return nil
}

// validateWSLShell performs security validation for WSL shells
func (a *App) validateWSLShell(shell string) error {
	if runtime.GOOS != PlatformWindows {
		return &ShellValidationError{
			Shell:    shell,
			Reason:   "WSL not available on non-Windows platforms",
			Platform: runtime.GOOS,
			Err:      fmt.Errorf("WSL shells are only available on Windows"),
		}
	}

	// Extract distribution name
	distroName := strings.TrimPrefix(shell, ShellWSLPrefix)
	if distroName == "" {
		return &ShellValidationError{
			Shell:    shell,
			Reason:   "empty WSL distribution name",
			Platform: runtime.GOOS,
			Err:      fmt.Errorf("WSL shell must specify a distribution name"),
		}
	}

	// Validate distribution name for security
	if err := validateWSLDistributionName(distroName); err != nil {
		return &ShellValidationError{
			Shell:    shell,
			Reason:   "invalid WSL distribution name",
			Platform: runtime.GOOS,
			Err:      err,
		}
	}

	// Check if WSL is available
	if !a.checkWSLAvailable() {
		return &ShellValidationError{
			Shell:    shell,
			Reason:   "WSL not available on system",
			Platform: runtime.GOOS,
			Err:      fmt.Errorf("WSL is not installed or not available"),
		}
	}

	// Verify the distribution exists
	distributions := a.getWSLDistributions()
	for _, dist := range distributions {
		if dist.Name == distroName {
			return nil // Distribution found and valid
		}
	}

	return &ShellValidationError{
		Shell:    shell,
		Reason:   "WSL distribution not found",
		Platform: runtime.GOOS,
		Err:      fmt.Errorf("WSL distribution '%s' is not installed", distroName),
	}
}

// validateWSLDistributionName validates WSL distribution name for security
func validateWSLDistributionName(distroName string) error {
	if distroName == "" {
		return fmt.Errorf("distribution name cannot be empty")
	}

	// Check for path traversal attempts
	if strings.Contains(distroName, "..") || strings.Contains(distroName, "/") || strings.Contains(distroName, "\\") {
		return fmt.Errorf("invalid characters in distribution name: %s", distroName)
	}

	// Check for null bytes or control characters
	for _, r := range distroName {
		if r < 32 || r == 127 {
			return fmt.Errorf("invalid control characters in distribution name: %s", distroName)
		}
	}

	// Reasonable length limit
	if len(distroName) > 64 {
		return fmt.Errorf("distribution name too long (max 64 characters): %s", distroName)
	}

	// Only allow alphanumeric, dash, underscore, and period
	for _, r := range distroName {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.') {
			return fmt.Errorf("invalid character in distribution name: %c", r)
		}
	}

	return nil
}

// getPlatformDefaultShell returns the platform-specific default shell configuration
func (a *App) getPlatformDefaultShell() string {
	if a.config == nil || a.config.config == nil {
		fmt.Println("getPlatformDefaultShell: config or a.config.config is nil, falling back to system default.")
		return getSystemDefaultShell()
	}

	switch runtime.GOOS {
	case PlatformWindows:
		return a.config.config.DefaultShells.Windows
	case PlatformDarwin:
		return a.config.config.DefaultShells.Darwin
	case PlatformLinux:
		return a.config.config.DefaultShells.Linux
	default:
		// For other Unix-like systems, use Linux configuration
		return a.config.config.DefaultShells.Linux
	}
}

// getSystemDefaultShell returns the platform-appropriate default shell
func getSystemDefaultShell() string {
	switch runtime.GOOS {
	case PlatformWindows:
		return DefaultWindowsShell
	case PlatformDarwin:
		return DefaultDarwinShell
	default:
		return DefaultLinuxShell
	}
}

// GetAvailableShellsFormatted returns a list of available shells for the platform in map format
func (a *App) GetAvailableShellsFormatted() []map[string]string {
	// Check cache first
	osInfoCache.mutex.RLock()
	if time.Since(osInfoCache.lastUpdated) < osInfoCache.ttl && osInfoCache.shells != nil {
		shells := make([]map[string]string, len(osInfoCache.shells))
		copy(shells, osInfoCache.shells)
		osInfoCache.mutex.RUnlock()
		return shells
	}
	osInfoCache.mutex.RUnlock()

	// Generate fresh shell list
	shells := a.generateAvailableShells()

	// Update cache
	osInfoCache.mutex.Lock()
	osInfoCache.shells = make([]map[string]string, len(shells))
	copy(osInfoCache.shells, shells)
	osInfoCache.lastUpdated = time.Now()
	osInfoCache.mutex.Unlock()

	return shells
}

// generateAvailableShells creates the formatted shell list
func (a *App) generateAvailableShells() []map[string]string {
	var shells []map[string]string
	seen := make(map[string]bool) // Track seen shell values to avoid duplicates

	// Get shell names from platform-specific function (already includes WSL on Windows)
	shellNames := a.getAvailableShells()

	// Convert to map format for the frontend with deduplication
	for _, shellName := range shellNames {
		if !seen[shellName] {
			seen[shellName] = true
			shells = append(shells, map[string]string{
				"name":  formatShellName(shellName),
				"value": shellName,
			})
		}
	}

	return shells
}

// formatShellName formats a shell name for display in the UI
func formatShellName(shellName string) string {
	// Check predefined display names first
	if displayName, exists := shellDisplayNames[strings.ToLower(shellName)]; exists {
		return displayName
	}

	// Handle WSL distributions
	if strings.HasPrefix(shellName, ShellWSLPrefix) {
		distroName := strings.TrimPrefix(shellName, ShellWSLPrefix)
		// Capitalize the first letter of the distribution name
		if len(distroName) > 0 {
			distroName = strings.ToUpper(distroName[:1]) + distroName[1:]
		}
		return fmt.Sprintf("WSL: %s", distroName)
	}

	// For unknown shells, capitalize first letter and clean up
	if len(shellName) > 0 {
		// Remove .exe extension if present
		cleanName := strings.TrimSuffix(shellName, ".exe")
		return strings.ToUpper(cleanName[:1]) + cleanName[1:] + " Shell"
	}
	return shellName
}

// GetOSInfo returns information about the operating system
func (a *App) GetOSInfo() map[string]interface{} {
	// Check cache first
	osInfoCache.mutex.RLock()
	if time.Since(osInfoCache.lastUpdated) < osInfoCache.ttl && osInfoCache.osInfo != nil {
		info := make(map[string]interface{})
		for k, v := range osInfoCache.osInfo {
			info[k] = v
		}
		osInfoCache.mutex.RUnlock()
		return info
	}
	osInfoCache.mutex.RUnlock()

	// Generate fresh OS info
	info := a.generateOSInfo()

	// Update cache
	osInfoCache.mutex.Lock()
	osInfoCache.osInfo = make(map[string]interface{})
	for k, v := range info {
		osInfoCache.osInfo[k] = v
	}
	osInfoCache.lastUpdated = time.Now()
	osInfoCache.mutex.Unlock()

	return info
}

// generateOSInfo creates fresh OS information
func (a *App) generateOSInfo() map[string]interface{} {
	info := map[string]interface{}{
		"os":            runtime.GOOS,
		"arch":          runtime.GOARCH,
		"go_version":    runtime.Version(),
		"num_cpu":       runtime.NumCPU(),
		"num_goroutine": runtime.NumGoroutine(),
		"defaultShell":  a.GetDefaultShell(),
	}

	// Add hostname
	if hostname, err := os.Hostname(); err == nil {
		info["hostname"] = hostname
	}

	// Add OS-specific information
	switch runtime.GOOS {
	case PlatformWindows:
		info["wsl_available"] = a.checkWSLAvailable()
		info["shells"] = a.GetAvailableShellsFormatted()
	case PlatformDarwin:
		info["shells"] = a.GetAvailableShellsFormatted()
	default:
		info["shells"] = a.GetAvailableShellsFormatted()
	}

	return info
}

// isWSLAvailable checks if WSL is available (delegates to platform-specific function)
func (a *App) isWSLAvailable() bool {
	return a.checkWSLAvailable()
}
