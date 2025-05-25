package main

import (
	"fmt"
	"os"
	"runtime"
	"strings"
)

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

	// For custom shells, validate they exist before returning
	if !strings.HasPrefix(configShell, "wsl::") {
		if _, err := findShellExecutable(configShell); err != nil {
			fmt.Printf("Configured shell '%s' not found, falling back to system default.\n", configShell)
			return getSystemDefaultShell()
		}
	}

	return configShell
}

// getPlatformDefaultShell returns the platform-specific default shell configuration
func (a *App) getPlatformDefaultShell() string {
	switch runtime.GOOS {
	case "windows":
		return a.config.DefaultShellWindows
	case "darwin":
		return a.config.DefaultShellDarwin
	case "linux":
		return a.config.DefaultShellLinux
	default:
		// For other Unix-like systems, use Linux configuration
		return a.config.DefaultShellLinux
	}
}

// getSystemDefaultShell returns the platform-appropriate default shell
func getSystemDefaultShell() string {
	switch runtime.GOOS {
	case "windows":
		return "powershell"
	case "darwin":
		return "zsh"
	default:
		return "bash"
	}
}

// GetAvailableShellsFormatted returns a list of available shells for the platform in map format
func (a *App) GetAvailableShellsFormatted() []map[string]string {
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

	// Note: WSL distributions are already included in getAvailableShells() on Windows
	// No need to add them again here to avoid duplicates

	return shells
}

// formatShellName formats a shell name for display in the UI
func formatShellName(shellName string) string {
	switch strings.ToLower(shellName) {
	case "bash":
		return "Bash"
	case "zsh":
		return "Zsh"
	case "fish":
		return "Fish Shell"
	case "powershell", "powershell.exe":
		return "PowerShell"
	case "pwsh", "pwsh.exe":
		return "PowerShell 7+"
	case "cmd", "cmd.exe":
		return "Command Prompt"
	case "sh":
		return "Bourne Shell (sh)"
	case "dash":
		return "Dash Shell"
	case "ash":
		return "Ash Shell"
	case "tcsh":
		return "Tcsh Shell"
	case "csh":
		return "C Shell (csh)"
	case "ksh":
		return "Korn Shell (ksh)"
	case "git-bash", "bash.exe":
		return "Git Bash"
	default:
		// Handle WSL distributions
		if strings.HasPrefix(shellName, "wsl::") {
			distroName := strings.TrimPrefix(shellName, "wsl::")
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
}

// GetOSInfo returns information about the operating system
func (a *App) GetOSInfo() map[string]interface{} {
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
	case "windows":
		info["wsl_available"] = a.checkWSLAvailable()
		info["shells"] = a.GetAvailableShellsFormatted()
	case "darwin":
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
