//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/aymanbagabas/go-pty"
	"golang.org/x/sys/windows/registry"
)

// Windows-specific constants
const (
	// Windows registry paths
	WSLRegistryPath = `SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss`

	// Default Windows directories
	System32Dir = "System32"
	SysWOW64Dir = "SysWOW64"

	// Shell executables
	CmdExe        = "cmd.exe"
	PowerShellExe = "powershell.exe"
	PwshExe       = "pwsh.exe"
	BashExe       = "bash.exe"
	ZshExe        = "zsh.exe"

	// Cache settings
	ShellCacheTimeout = 5 * time.Minute
	WSLCacheTimeout   = 10 * time.Minute
)

// WindowsError represents Windows-specific errors with context
type WindowsError struct {
	Operation string
	Path      string
	Err       error
}

func (e *WindowsError) Error() string {
	if e.Path != "" {
		return fmt.Sprintf("windows %s at %s: %v", e.Operation, e.Path, e.Err)
	}
	return fmt.Sprintf("windows %s: %v", e.Operation, e.Err)
}

// Windows shell detection cache
type shellCache struct {
	shells    []string
	timestamp time.Time
	mutex     sync.RWMutex
}

type wslCache struct {
	distributions []WSLDistribution
	timestamp     time.Time
	mutex         sync.RWMutex
}

var (
	windowsShellCache = &shellCache{}
	windowsWSLCache   = &wslCache{}
)

// fileExists checks if a file exists using standard Go instead of unsafe Windows API
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

// safeGetEnvironment safely gets environment variable with fallback
func safeGetEnvironment(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

// validateWindowsPath ensures path is within allowed Windows directories
func validateWindowsPath(path string) error {
	if path == "" {
		return fmt.Errorf("path cannot be empty")
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("failed to get absolute path: %w", err)
	}

	// Clean the path
	absPath = filepath.Clean(absPath)

	// Check if path is within allowed Windows directories
	allowedPrefixes := []string{
		safeGetEnvironment("SystemRoot", "C:\\Windows"),
		safeGetEnvironment("ProgramFiles", "C:\\Program Files"),
		safeGetEnvironment("ProgramFiles(x86)", "C:\\Program Files (x86)"),
		safeGetEnvironment("USERPROFILE", "C:\\Users"),
		safeGetEnvironment("ProgramData", "C:\\ProgramData"),
	}

	for _, prefix := range allowedPrefixes {
		cleanPrefix := filepath.Clean(prefix)
		if strings.HasPrefix(strings.ToLower(absPath), strings.ToLower(cleanPrefix)) {
			return nil
		}
	}

	return fmt.Errorf("path not in allowed Windows directories: %s", absPath)
}

// checkWSLAvailable checks if WSL is available with proper error handling
func (a *App) checkWSLAvailable() bool {
	systemRoot := safeGetEnvironment("SystemRoot", "C:\\Windows")

	wslPaths := []string{
		filepath.Join(systemRoot, System32Dir, "wsl.exe"),
		filepath.Join(systemRoot, SysWOW64Dir, "wsl.exe"),
	}

	for _, path := range wslPaths {
		if err := validateWindowsPath(path); err != nil {
			continue // Skip invalid paths
		}

		if fileExists(path) {
			return true
		}
	}

	// Fallback to PATH
	if path, err := exec.LookPath("wsl.exe"); err == nil {
		if err := validateWindowsPath(path); err == nil {
			return true
		}
	}

	return false
}

// getWSLDistributions returns WSL distributions with caching
func (a *App) getWSLDistributions() []WSLDistribution {
	// Check cache first
	windowsWSLCache.mutex.RLock()
	if time.Since(windowsWSLCache.timestamp) < WSLCacheTimeout {
		distributions := make([]WSLDistribution, len(windowsWSLCache.distributions))
		copy(distributions, windowsWSLCache.distributions)
		windowsWSLCache.mutex.RUnlock()
		return distributions
	}
	windowsWSLCache.mutex.RUnlock()

	var distributions []WSLDistribution

	if !a.checkWSLAvailable() {
		return distributions
	}

	// Try registry first, fallback to command
	distributions = a.getWSLFromRegistrySafe()
	if len(distributions) == 0 {
		distributions = a.getWSLFromCommandSafe()
	}

	// Update cache
	windowsWSLCache.mutex.Lock()
	windowsWSLCache.distributions = make([]WSLDistribution, len(distributions))
	copy(windowsWSLCache.distributions, distributions)
	windowsWSLCache.timestamp = time.Now()
	windowsWSLCache.mutex.Unlock()

	return distributions
}

// getWSLFromRegistrySafe gets distributions from registry with proper error handling and cleanup
func (a *App) getWSLFromRegistrySafe() []WSLDistribution {
	var distributions []WSLDistribution

	// Proper error handling with defer cleanup
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, WSLRegistryPath,
		registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return distributions
	}
	defer func() {
		if closeErr := key.Close(); closeErr != nil {
			fmt.Printf("Warning: Failed to close registry key: %v\n", closeErr)
		}
	}()

	defaultDistGUID, _, _ := key.GetStringValue("DefaultDistribution")
	subkeys, err := key.ReadSubKeyNames(-1)
	if err != nil {
		return distributions
	}

	for _, subkey := range subkeys {
		if subkey == "" {
			continue // Skip empty subkeys
		}

		distKey, err := registry.OpenKey(key, subkey, registry.QUERY_VALUE)
		if err != nil {
			continue
		}

		// Ensure distKey is always closed
		func() {
			defer func() {
				if closeErr := distKey.Close(); closeErr != nil {
					fmt.Printf("Warning: Failed to close distribution registry key: %v\n", closeErr)
				}
			}()

			distName, _, err := distKey.GetStringValue("DistributionName")
			if err != nil || distName == "" {
				return
			}

			version, _, err := distKey.GetIntegerValue("Version")
			if err != nil {
				version = 2 // Default to WSL2
			}

			state, _, err := distKey.GetIntegerValue("State")
			stateStr := "Stopped"
			if err == nil && state == 1 {
				stateStr = "Running"
			}

			isDefault := (subkey == defaultDistGUID)

			dist := WSLDistribution{
				Name:    distName,
				Version: fmt.Sprintf("%d", version),
				State:   stateStr,
				Default: isDefault,
			}

			distributions = append(distributions, dist)
		}()
	}

	return distributions
}

// getWSLFromCommandSafe gets distributions using command with proper timeout and validation
func (a *App) getWSLFromCommandSafe() []WSLDistribution {
	var distributions []WSLDistribution

	cmd := exec.Command("wsl.exe", "--list", "--verbose")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	// Set timeout to prevent hanging
	timeout := time.After(10 * time.Second)
	done := make(chan bool)
	var output []byte
	var err error

	go func() {
		output, err = cmd.Output()
		done <- true
	}()

	select {
	case <-timeout:
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return distributions
	case <-done:
		if err != nil {
			return distributions
		}
	}

	if len(output) == 0 {
		return distributions
	}

	// Clean up common encoding issues in WSL output
	text := string(output)
	text = strings.Replace(text, "\ufeff", "", -1) // Remove BOM
	text = strings.Replace(text, "\u0000", "", -1) // Remove null bytes
	text = strings.Replace(text, "\x00", "", -1)   // Remove null bytes

	lines := strings.Split(text, "\n")

	for i, line := range lines {
		if i == 0 || line == "" {
			continue // Skip header and empty lines
		}

		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, "----") {
			continue // Skip separators
		}

		isDefault := strings.HasPrefix(line, "*")
		if isDefault {
			line = strings.TrimPrefix(line, "*")
			line = strings.TrimSpace(line)
		}

		parts := strings.Fields(line)
		if len(parts) >= 1 && parts[0] != "" &&
			parts[0] != "NAME" && !strings.Contains(parts[0], "----") {

			dist := WSLDistribution{
				Name:    parts[0],
				Version: "2",
				State:   "Stopped",
				Default: isDefault,
			}

			if len(parts) >= 2 {
				dist.State = parts[1]
			}
			if len(parts) >= 3 {
				dist.Version = parts[2]
			}

			distributions = append(distributions, dist)
		}
	}

	return distributions
}

// Shell detection with extracted constants and improved logic
type windowsShellPaths struct {
	systemRoot   string
	programFiles string
	programX86   string
	userProfile  string
}

func (w *windowsShellPaths) getShellPaths() map[string][]string {
	return map[string][]string{
		"cmd": {
			filepath.Join(w.systemRoot, System32Dir, CmdExe),
			filepath.Join(w.systemRoot, SysWOW64Dir, CmdExe),
		},
		"powershell": {
			filepath.Join(w.systemRoot, System32Dir, "WindowsPowerShell", "v1.0", PowerShellExe),
			filepath.Join(w.systemRoot, SysWOW64Dir, "WindowsPowerShell", "v1.0", PowerShellExe),
		},
		"pwsh": {
			filepath.Join(w.programFiles, "PowerShell", "7", PwshExe),
			filepath.Join(w.programX86, "PowerShell", "7", PwshExe),
		},
		"bash": {
			filepath.Join(w.systemRoot, System32Dir, BashExe),
			filepath.Join(w.programFiles, "Git", "bin", BashExe),
			filepath.Join(w.programX86, "Git", "bin", BashExe),
		},
		"zsh": {
			filepath.Join(w.programFiles, "Git", "usr", "bin", ZshExe),
			filepath.Join(w.programX86, "Git", "usr", "bin", ZshExe),
		},
	}
}

// getAvailableShells returns available shells on Windows with caching
func (a *App) getAvailableShells() []string {
	// Check cache first
	windowsShellCache.mutex.RLock()
	if time.Since(windowsShellCache.timestamp) < ShellCacheTimeout {
		shells := make([]string, len(windowsShellCache.shells))
		copy(shells, windowsShellCache.shells)
		windowsShellCache.mutex.RUnlock()
		return shells
	}
	windowsShellCache.mutex.RUnlock()

	// Detect shells
	shells := a.detectWindowsShells()

	// Update cache
	windowsShellCache.mutex.Lock()
	windowsShellCache.shells = make([]string, len(shells))
	copy(windowsShellCache.shells, shells)
	windowsShellCache.timestamp = time.Now()
	windowsShellCache.mutex.Unlock()

	return shells
}

func (a *App) detectWindowsShells() []string {
	var shells []string

	paths := &windowsShellPaths{
		systemRoot:   safeGetEnvironment("SystemRoot", "C:\\Windows"),
		programFiles: safeGetEnvironment("ProgramFiles", "C:\\Program Files"),
		programX86:   safeGetEnvironment("ProgramFiles(x86)", "C:\\Program Files (x86)"),
		userProfile:  safeGetEnvironment("USERPROFILE", "C:\\Users"),
	}

	shellPaths := paths.getShellPaths()
	found := make(map[string]bool)

	// Check each shell type
	for shellName, pathList := range shellPaths {
		if found[shellName] {
			continue // Already found this shell
		}

		for _, path := range pathList {
			// Validate path before checking
			if err := validateWindowsPath(path); err != nil {
				continue
			}

			if fileExists(path) {
				shells = append(shells, shellName)
				found[shellName] = true
				break
			}
		}
	}

	// Add WSL shells if available
	if a.checkWSLAvailable() {
		distributions := a.getWSLDistributions()
		for _, dist := range distributions {
			wslShell := fmt.Sprintf("wsl:%s", dist.Name)
			if !found[wslShell] {
				shells = append(shells, wslShell)
				found[wslShell] = true
			}
		}
	}

	return shells
}

// configurePtyProcess configures PTY process attributes for Windows
func configurePtyProcess(cmd *pty.Cmd) {
	// Set basic environment variables for Windows
	if cmd.Env == nil {
		cmd.Env = os.Environ()
	}

	// Add Windows-specific environment variables
	cmd.Env = append(cmd.Env, "TERM=xterm-256color")
	cmd.Env = append(cmd.Env, "COLORTERM=truecolor")

	// Configure Windows process attributes
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}

	// Hide console window
	cmd.SysProcAttr.HideWindow = true
	// Don't create new process group to allow signal propagation (Ctrl+C, etc.)
	// ConPty handles signal forwarding when processes are in the same group
	// For more details see: https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags
	cmd.SysProcAttr.CreationFlags = 0
}

// findWSLExecutable finds WSL executable with proper validation
func findWSLExecutable() (string, error) {
	systemRoot := safeGetEnvironment("SystemRoot", "C:\\Windows")

	wslPaths := []string{
		filepath.Join(systemRoot, System32Dir, "wsl.exe"),
		filepath.Join(systemRoot, SysWOW64Dir, "wsl.exe"),
	}

	for _, path := range wslPaths {
		if err := validateWindowsPath(path); err != nil {
			continue
		}

		if fileExists(path) {
			return path, nil
		}
	}

	// Fallback to PATH lookup
	if path, err := exec.LookPath("wsl.exe"); err == nil {
		if err := validateWindowsPath(path); err == nil {
			return path, nil
		}
	}

	return "", &WindowsError{
		Operation: "WSL executable search",
		Err:       fmt.Errorf("wsl.exe not found in system paths"),
	}
}

// findShellExecutable finds shell executable with improved error handling
func findShellExecutable(shell string) (string, error) {
	if shell == "" {
		return "", &WindowsError{
			Operation: "shell executable search",
			Err:       fmt.Errorf("shell name cannot be empty"),
		}
	}

	paths := &windowsShellPaths{
		systemRoot:   safeGetEnvironment("SystemRoot", "C:\\Windows"),
		programFiles: safeGetEnvironment("ProgramFiles", "C:\\Program Files"),
		programX86:   safeGetEnvironment("ProgramFiles(x86)", "C:\\Program Files (x86)"),
		userProfile:  safeGetEnvironment("USERPROFILE", "C:\\Users"),
	}

	shellPaths := paths.getShellPaths()

	// Handle WSL shells
	if strings.HasPrefix(shell, "wsl:") {
		wslPath, err := findWSLExecutable()
		if err != nil {
			return "", fmt.Errorf("WSL shell '%s' not available: %w", shell, err)
		}
		return wslPath, nil
	}

	// Check known paths first
	if pathList, exists := shellPaths[shell]; exists {
		for _, path := range pathList {
			if err := validateWindowsPath(path); err != nil {
				continue
			}

			if fileExists(path) {
				return path, nil
			}
		}
	}

	// Fallback to PATH lookup for custom shells
	if path, err := exec.LookPath(shell); err == nil {
		if err := validateWindowsPath(path); err == nil {
			return path, nil
		}
	}

	return "", &WindowsError{
		Operation: "shell executable search",
		Path:      shell,
		Err:       fmt.Errorf("shell '%s' not found or not accessible on Windows", shell),
	}
}

// getDefaultSSHKeyPaths returns default SSH key paths for Windows with user choice integration
func (a *App) getDefaultSSHKeyPaths() []string {
	// Get user home directory
	userProfile := safeGetEnvironment("USERPROFILE", "")
	if userProfile == "" {
		// Fallback to os.UserHomeDir()
		var err error
		userProfile, err = os.UserHomeDir()
		if err != nil {
			return []string{} // No default paths available
		}
	}

	sshDir := filepath.Join(userProfile, ".ssh")

	// Validate SSH directory path
	if err := validateWindowsPath(sshDir); err != nil {
		fmt.Printf("SSH directory path validation failed: %v\n", err)
		return []string{}
	}

	// First try to scan the entire .ssh directory for valid private keys
	discoveredKeys := a.scanSSHDirectory(sshDir)
	if len(discoveredKeys) > 0 {
		// Limit to first 10 keys to avoid excessive authentication attempts
		if len(discoveredKeys) > 10 {
			discoveredKeys = discoveredKeys[:10]
		}
		fmt.Printf("Using %d discovered SSH keys from %s\n", len(discoveredKeys), sshDir)
		return discoveredKeys
	}

	// Fallback to common key names if directory scan didn't find anything
	fmt.Printf("No SSH keys discovered, falling back to common key names in %s\n", sshDir)

	// Use Windows-style environment variable expansion
	commonKeyPaths := []string{
		filepath.Join(userProfile, ".ssh", "id_rsa"),
		filepath.Join(userProfile, ".ssh", "id_ed25519"),
		filepath.Join(userProfile, ".ssh", "id_ecdsa"),
		filepath.Join(userProfile, ".ssh", "id_dsa"), // Legacy key type
	}

	// Validate each path
	validPaths := make([]string, 0, len(commonKeyPaths))
	for _, path := range commonKeyPaths {
		if err := validateWindowsPath(path); err == nil {
			validPaths = append(validPaths, path)
		}
	}

	return validPaths
}
