//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// Unix-specific constants
const (
	// Default terminal settings
	DefaultTermType = "xterm-256color"
	ColorTermType   = "truecolor"

	// SSH key limits
	MaxSSHKeys = 10

	// Standard Unix directories
	BinDir      = "/bin"
	UsrBinDir   = "/usr/bin"
	LocalBinDir = "/usr/local/bin"
	HomebrewDir = "/opt/homebrew/bin"

	// Shell executables
	BashShell = "bash"
	ZshShell  = "zsh"
	ShShell   = "sh"
	FishShell = "fish"
	CshShell  = "csh"
	TcshShell = "tcsh"
	KshShell  = "ksh"

	// Cache settings
	UnixShellCacheTimeout = 5 * time.Minute
)

// UnixError represents Unix-specific errors with context
type UnixError struct {
	Operation string
	Path      string
	Platform  string
	Err       error
}

func (e *UnixError) Error() string {
	if e.Path != "" {
		return fmt.Sprintf("unix %s on %s at %s: %v", e.Operation, e.Platform, e.Path, e.Err)
	}
	return fmt.Sprintf("unix %s on %s: %v", e.Operation, e.Platform, e.Err)
}

// Unix shell detection cache
type unixShellCache struct {
	shells    []string
	timestamp time.Time
	mutex     sync.RWMutex
}

var (
	unixShellCacheInstance = &unixShellCache{}
)

// fileExists checks if a file exists using os.Stat with proper error handling
func fileExists(path string) bool {
	if path == "" {
		return false
	}

	info, err := os.Stat(path)
	if err != nil {
		return false
	}

	// Ensure it's a file, not a directory
	return info.Mode().IsRegular()
}

// isExecutable checks if a file exists and is executable
func isExecutable(path string) bool {
	if path == "" {
		return false
	}

	info, err := os.Stat(path)
	if err != nil {
		return false
	}

	// Check if file and executable
	mode := info.Mode()
	return mode.IsRegular() && (mode.Perm()&0111) != 0
}

// validateUnixPath ensures path is within allowed Unix directories
func validateUnixPath(path string) error {
	if path == "" {
		return fmt.Errorf("path cannot be empty")
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("failed to get absolute path: %w", err)
	}

	// Clean the path
	absPath = filepath.Clean(absPath)

	// Check if path is within allowed Unix directories
	allowedPrefixes := []string{
		BinDir,
		UsrBinDir,
		LocalBinDir,
		HomebrewDir,
		"/usr/libexec", // For system executables
		"/opt",         // For optional software
	}

	// Add user home directory
	if homeDir, err := os.UserHomeDir(); err == nil {
		allowedPrefixes = append(allowedPrefixes, homeDir)
	}

	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(absPath, prefix) {
			return nil
		}
	}

	return fmt.Errorf("path not in allowed Unix directories: %s", absPath)
}

// checkWSLAvailable always returns false on non-Windows platforms
func (a *App) checkWSLAvailable() bool {
	return false
}

// getWSLDistributions returns empty list on non-Windows platforms
func (a *App) getWSLDistributions() []WSLDistribution {
	return []WSLDistribution{}
}

// Platform-specific shell paths configuration
type unixShellPaths struct {
	platform string
}

func (u *unixShellPaths) getShellPaths() map[string][]string {
	// Common paths for all Unix systems
	commonPaths := map[string][]string{
		BashShell: {filepath.Join(BinDir, BashShell), filepath.Join(UsrBinDir, BashShell), filepath.Join(LocalBinDir, BashShell)},
		ZshShell:  {filepath.Join(BinDir, ZshShell), filepath.Join(UsrBinDir, ZshShell), filepath.Join(LocalBinDir, ZshShell)},
		ShShell:   {filepath.Join(BinDir, ShShell), filepath.Join(UsrBinDir, ShShell)},
		FishShell: {filepath.Join(BinDir, FishShell), filepath.Join(UsrBinDir, FishShell), filepath.Join(LocalBinDir, FishShell)},
	}

	// Platform-specific customizations
	if u.platform == "darwin" {
		// macOS specific paths - prioritize Homebrew locations
		commonPaths[ZshShell] = append([]string{filepath.Join(HomebrewDir, ZshShell)}, commonPaths[ZshShell]...)
		commonPaths[BashShell] = append([]string{filepath.Join(HomebrewDir, BashShell)}, commonPaths[BashShell]...)
		commonPaths[FishShell] = append([]string{filepath.Join(HomebrewDir, FishShell)}, commonPaths[FishShell]...)
	} else {
		// Linux and other Unix systems - add additional shells
		commonPaths[CshShell] = []string{filepath.Join(BinDir, CshShell), filepath.Join(UsrBinDir, CshShell)}
		commonPaths[TcshShell] = []string{filepath.Join(BinDir, TcshShell), filepath.Join(UsrBinDir, TcshShell)}
		commonPaths[KshShell] = []string{filepath.Join(BinDir, KshShell), filepath.Join(UsrBinDir, KshShell)}
	}

	return commonPaths
}

// getAvailableShells returns a list of available shells on Unix-like systems with caching
func (a *App) getAvailableShells() []string {
	// Check cache first
	unixShellCacheInstance.mutex.RLock()
	if time.Since(unixShellCacheInstance.timestamp) < UnixShellCacheTimeout {
		shells := make([]string, len(unixShellCacheInstance.shells))
		copy(shells, unixShellCacheInstance.shells)
		unixShellCacheInstance.mutex.RUnlock()
		return shells
	}
	unixShellCacheInstance.mutex.RUnlock()

	// Detect shells
	shells := a.detectUnixShells()

	// Update cache
	unixShellCacheInstance.mutex.Lock()
	unixShellCacheInstance.shells = make([]string, len(shells))
	copy(shells, unixShellCacheInstance.shells)
	unixShellCacheInstance.timestamp = time.Now()
	unixShellCacheInstance.mutex.Unlock()

	return shells
}

func (a *App) detectUnixShells() []string {
	var shells []string

	paths := &unixShellPaths{
		platform: runtime.GOOS,
	}

	shellPaths := paths.getShellPaths()
	found := make(map[string]bool)

	// Define shell priority based on platform
	var shellPriority []string
	if runtime.GOOS == "darwin" {
		// macOS: zsh is default since Catalina
		shellPriority = []string{ZshShell, BashShell, ShShell, FishShell}
	} else {
		// Linux: bash is most common
		shellPriority = []string{BashShell, ZshShell, ShShell, FishShell, CshShell, TcshShell, KshShell}
	}

	// Check shells in priority order to avoid duplicates
	for _, shellName := range shellPriority {
		if found[shellName] {
			continue
		}

		if pathList, exists := shellPaths[shellName]; exists {
			for _, path := range pathList {
				// Validate path before checking
				if err := validateUnixPath(path); err != nil {
					continue
				}

				if isExecutable(path) {
					shells = append(shells, shellName)
					found[shellName] = true
					break
				}
			}
		}
	}

	return shells
}

// configurePtyProcess configures PTY process attributes for Unix platforms
func configurePtyProcess(cmd *pty.Cmd) {
	// Set basic environment variables
	if cmd.Env == nil {
		cmd.Env = os.Environ()
	}

	// Add terminal configuration
	cmd.Env = append(cmd.Env, fmt.Sprintf("TERM=%s", DefaultTermType))
	cmd.Env = append(cmd.Env, fmt.Sprintf("COLORTERM=%s", ColorTermType))

	// Platform-specific process attributes
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}

	if runtime.GOOS == "darwin" {
		// macOS-specific configuration to avoid permission issues
		cmd.SysProcAttr.Setpgid = false
		cmd.SysProcAttr.Noctty = false
	} else {
		// Linux and other Unix systems
		cmd.SysProcAttr.Setpgid = true
		cmd.SysProcAttr.Noctty = false
	}
}

// findWSLExecutable returns error on non-Windows platforms
func findWSLExecutable() (string, error) {
	return "", &UnixError{
		Operation: "WSL executable search",
		Platform:  runtime.GOOS,
		Err:       fmt.Errorf("WSL not available on Unix platforms"),
	}
}

// findShellExecutable finds shell executable using file-based detection with improved error handling
func findShellExecutable(shell string) (string, error) {
	if shell == "" {
		return "", &UnixError{
			Operation: "shell executable search",
			Platform:  runtime.GOOS,
			Err:       fmt.Errorf("shell name cannot be empty"),
		}
	}

	paths := &unixShellPaths{
		platform: runtime.GOOS,
	}

	shellPaths := paths.getShellPaths()

	// Check known paths first
	if pathList, exists := shellPaths[shell]; exists {
		for _, path := range pathList {
			// Validate path before checking
			if err := validateUnixPath(path); err != nil {
				continue
			}

			if isExecutable(path) {
				return path, nil
			}
		}
	}

	// Fallback to PATH lookup
	if path, err := exec.LookPath(shell); err == nil {
		// Validate the found path
		if err := validateUnixPath(path); err == nil && isExecutable(path) {
			return path, nil
		}
	}

	return "", &UnixError{
		Operation: "shell executable search",
		Path:      shell,
		Platform:  runtime.GOOS,
		Err:       fmt.Errorf("shell '%s' not found or not executable on %s", shell, runtime.GOOS),
	}
}

// getHomeDirectory safely gets user home directory with fallbacks
func getHomeDirectory() (string, error) {
	// Try HOME environment variable first (standard on Unix)
	homeDir := os.Getenv("HOME")
	if homeDir != "" {
		// Validate the path
		if err := validateUnixPath(homeDir); err == nil {
			return homeDir, nil
		}
	}

	// Fallback to os.UserHomeDir()
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", &UnixError{
			Operation: "home directory detection",
			Platform:  runtime.GOOS,
			Err:       err,
		}
	}

	// Validate the fallback path
	if err := validateUnixPath(homeDir); err != nil {
		return "", &UnixError{
			Operation: "home directory validation",
			Platform:  runtime.GOOS,
			Path:      homeDir,
			Err:       err,
		}
	}

	return homeDir, nil
}

// getDefaultSSHKeyPaths returns default SSH key paths for Unix-like systems with user choice integration
func (a *App) getDefaultSSHKeyPaths() []string {
	// Get user home directory safely
	homeDir, err := getHomeDirectory()
	if err != nil {
		fmt.Printf("Failed to get home directory: %v\n", err)
		return []string{} // No default paths available
	}

	sshDir := filepath.Join(homeDir, ".ssh")

	// Validate SSH directory path
	if err := validateUnixPath(sshDir); err != nil {
		fmt.Printf("SSH directory path validation failed: %v\n", err)
		return []string{}
	}

	// First try to scan the entire .ssh directory for valid private keys
	discoveredKeys := a.scanSSHDirectory(sshDir)
	if len(discoveredKeys) > 0 {
		// Limit to first MaxSSHKeys to avoid excessive authentication attempts
		if len(discoveredKeys) > MaxSSHKeys {
			discoveredKeys = discoveredKeys[:MaxSSHKeys]
		}
		fmt.Printf("Using %d discovered SSH keys from %s\n", len(discoveredKeys), sshDir)
		return discoveredKeys
	}

	// Fallback to common key names if directory scan didn't find anything
	fmt.Printf("No SSH keys discovered, falling back to common key names in %s\n", sshDir)

	// Standard SSH key types in order of preference
	commonKeyPaths := []string{
		filepath.Join(sshDir, "id_ed25519"), // Modern, secure key type
		filepath.Join(sshDir, "id_ecdsa"),   // Elliptic curve key
		filepath.Join(sshDir, "id_rsa"),     // Traditional RSA key
		filepath.Join(sshDir, "id_dsa"),     // Legacy key type (for compatibility)
	}

	// Validate each path
	validPaths := make([]string, 0, len(commonKeyPaths))
	for _, path := range commonKeyPaths {
		if err := validateUnixPath(path); err == nil {
			validPaths = append(validPaths, path)
		}
	}

	return validPaths
}
