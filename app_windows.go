//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"github.com/aymanbagabas/go-pty"
	"golang.org/x/sys/windows/registry"
)

// Windows API declarations for native shell detection
var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	procGetFileAttributes = kernel32.NewProc("GetFileAttributesW")
)

// fileExists checks if a file exists using Windows API
func fileExists(path string) bool {
	pathPtr, _ := syscall.UTF16PtrFromString(path)
	attr, _, _ := procGetFileAttributes.Call(uintptr(unsafe.Pointer(pathPtr)))
	return attr != 0xFFFFFFFF
}

// checkWSLAvailable checks if WSL is available
func (a *App) checkWSLAvailable() bool {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = "C:\\Windows"
	}

	wslPaths := []string{
		filepath.Join(systemRoot, "System32", "wsl.exe"),
		filepath.Join(systemRoot, "SysWOW64", "wsl.exe"),
	}

	for _, path := range wslPaths {
		if fileExists(path) {
			return true
		}
	}

	// Fallback to PATH
	if _, err := exec.LookPath("wsl.exe"); err == nil {
		return true
	}

	return false
}

// getWSLDistributions returns WSL distributions
func (a *App) getWSLDistributions() []WSLDistribution {
	var distributions []WSLDistribution

	if !a.checkWSLAvailable() {
		return distributions
	}

	// Try registry first, fallback to command
	distributions = a.getWSLFromRegistry()
	if len(distributions) == 0 {
		distributions = a.getWSLFromCommand()
	}

	return distributions
}

// getWSLFromRegistry gets distributions from registry
func (a *App) getWSLFromRegistry() []WSLDistribution {
	var distributions []WSLDistribution

	key, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss`, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return distributions
	}
	defer key.Close()

	defaultDistGUID, _, _ := key.GetStringValue("DefaultDistribution")
	subkeys, err := key.ReadSubKeyNames(-1)
	if err != nil {
		return distributions
	}

	for _, subkey := range subkeys {
		distKey, err := registry.OpenKey(key, subkey, registry.QUERY_VALUE)
		if err != nil {
			continue
		}

		distName, _, err := distKey.GetStringValue("DistributionName")
		if err != nil {
			distKey.Close()
			continue
		}

		version, _, err := distKey.GetIntegerValue("Version")
		if err != nil {
			version = 2
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
		distKey.Close()
	}

	return distributions
}

// getWSLFromCommand gets distributions using command
func (a *App) getWSLFromCommand() []WSLDistribution {
	var distributions []WSLDistribution

	cmd := exec.Command("wsl.exe", "--list", "--verbose")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	output, err := cmd.Output()
	if err != nil {
		return distributions
	}

	text := string(output)
	text = strings.Replace(text, "\ufeff", "", -1)
	text = strings.Replace(text, "\u0000", "", -1)
	text = strings.Replace(text, "\x00", "", -1)

	lines := strings.Split(text, "\n")

	for i, line := range lines {
		if i == 0 {
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		isDefault := strings.HasPrefix(line, "*")
		if isDefault {
			line = strings.TrimPrefix(line, "*")
			line = strings.TrimSpace(line)
		}

		parts := strings.Fields(line)
		if len(parts) >= 1 && parts[0] != "" && parts[0] != "NAME" {
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

// getAvailableShells returns available shells on Windows
func (a *App) getAvailableShells() []string {
	var shells []string

	// Check Windows shells
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = "C:\\Windows"
	}

	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = "C:\\Program Files"
	}

	userProfile := os.Getenv("USERPROFILE")

	shellPaths := map[string][]string{
		"cmd.exe": {
			filepath.Join(systemRoot, "System32", "cmd.exe"),
		},
		"powershell.exe": {
			filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		},
		"pwsh.exe": {
			filepath.Join(programFiles, "PowerShell", "7", "pwsh.exe"),
		},
	}

	if userProfile != "" {
		shellPaths["pwsh.exe"] = append(shellPaths["pwsh.exe"],
			filepath.Join(userProfile, "AppData", "Local", "Microsoft", "WindowsApps", "pwsh.exe"))
	}

	for shellName, paths := range shellPaths {
		for _, path := range paths {
			if fileExists(path) {
				shells = append(shells, shellName)
				break // Break after finding first valid path to avoid duplicates
			}
		}
	}

	// Add WSL distributions
	if a.checkWSLAvailable() {
		distributions := a.getWSLDistributions()
		for _, dist := range distributions {
			shellName := fmt.Sprintf("wsl::%s", dist.Name)
			shells = append(shells, shellName)
		}
	}

	return shells
}

// configurePtyProcess configures PTY process attributes
func configurePtyProcess(cmd *pty.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}

// findWSLExecutable finds WSL executable
func findWSLExecutable() (string, error) {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = "C:\\Windows"
	}

	wslPaths := []string{
		filepath.Join(systemRoot, "System32", "wsl.exe"),
		filepath.Join(systemRoot, "SysWOW64", "wsl.exe"),
	}

	for _, path := range wslPaths {
		if fileExists(path) {
			return path, nil
		}
	}

	return exec.LookPath("wsl.exe")
}

// findShellExecutable finds shell executable
func findShellExecutable(shell string) (string, error) {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = "C:\\Windows"
	}

	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = "C:\\Program Files"
	}

	userProfile := os.Getenv("USERPROFILE")

	shellPaths := map[string][]string{
		"cmd.exe": {
			filepath.Join(systemRoot, "System32", "cmd.exe"),
		},
		"powershell.exe": {
			filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		},
		"pwsh.exe": {
			filepath.Join(programFiles, "PowerShell", "7", "pwsh.exe"),
		},
	}

	if userProfile != "" {
		shellPaths["pwsh.exe"] = append(shellPaths["pwsh.exe"],
			filepath.Join(userProfile, "AppData", "Local", "Microsoft", "WindowsApps", "pwsh.exe"))
	}

	if paths, exists := shellPaths[shell]; exists {
		for _, path := range paths {
			if fileExists(path) {
				return path, nil
			}
		}
	}

	return exec.LookPath(shell)
}

// getDefaultSSHKeyPaths returns default SSH key paths for Windows
func (a *App) getDefaultSSHKeyPaths() []string {
	// Get user home directory (handles Windows profile correctly)
	homeDir, err := os.UserHomeDir()
	if err != nil {
		// Fallback to USERPROFILE environment variable
		homeDir = os.Getenv("USERPROFILE")
		if homeDir == "" {
			return []string{} // No default paths available
		}
	}

	sshDir := filepath.Join(homeDir, ".ssh")

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
	return []string{
		filepath.Join(sshDir, "id_rsa"),
		filepath.Join(sshDir, "id_ed25519"),
		filepath.Join(sshDir, "id_ecdsa"),
		filepath.Join(sshDir, "id_dsa"), // Legacy key type
	}
}
