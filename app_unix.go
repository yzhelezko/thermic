//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"

	"github.com/aymanbagabas/go-pty"
)

// fileExists checks if a file exists using os.Stat
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// checkWSLAvailable always returns false on non-Windows platforms
func (a *App) checkWSLAvailable() bool {
	return false
}

// getWSLDistributions returns empty list on non-Windows platforms
func (a *App) getWSLDistributions() []WSLDistribution {
	return []WSLDistribution{}
}

// getAvailableShells returns a list of available shells on Unix-like systems
func (a *App) getAvailableShells() []string {
	var shells []string

	// Platform-specific shell paths
	var commonPaths map[string][]string

	if runtime.GOOS == "darwin" {
		// macOS specific paths
		commonPaths = map[string][]string{
			"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh", "/opt/homebrew/bin/zsh"},
			"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/opt/homebrew/bin/bash"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
			"fish": {"/usr/local/bin/fish", "/opt/homebrew/bin/fish", "/usr/bin/fish"},
		}
	} else {
		// Linux and other Unix systems
		commonPaths = map[string][]string{
			"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"},
			"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
			"fish": {"/bin/fish", "/usr/bin/fish", "/usr/local/bin/fish"},
		}
	}

	for shellName, paths := range commonPaths {
		for _, path := range paths {
			if fileExists(path) {
				shells = append(shells, shellName)
				break
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
	cmd.Env = append(cmd.Env, "TERM=xterm-256color")

	// Minimal process attributes on macOS to avoid permission issues
	if runtime.GOOS == "darwin" {
		if cmd.SysProcAttr == nil {
			cmd.SysProcAttr = &syscall.SysProcAttr{}
		}
		// Keep process attributes minimal to avoid macOS security restrictions
		cmd.SysProcAttr.Setpgid = false
		cmd.SysProcAttr.Noctty = false
	}
}

// findWSLExecutable returns error on non-Windows platforms
func findWSLExecutable() (string, error) {
	return "", exec.ErrNotFound
}

// findShellExecutable finds shell executable using file-based detection
func findShellExecutable(shell string) (string, error) {
	// Platform-specific shell paths
	var shellPaths map[string][]string

	if runtime.GOOS == "darwin" {
		// macOS specific paths
		shellPaths = map[string][]string{
			"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh", "/opt/homebrew/bin/zsh"},
			"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/opt/homebrew/bin/bash"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
			"fish": {"/usr/local/bin/fish", "/opt/homebrew/bin/fish", "/usr/bin/fish"},
		}
	} else {
		// Linux and other Unix systems
		shellPaths = map[string][]string{
			"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"},
			"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
			"fish": {"/bin/fish", "/usr/bin/fish", "/usr/local/bin/fish"},
			"csh":  {"/bin/csh", "/usr/bin/csh"},
			"tcsh": {"/bin/tcsh", "/usr/bin/tcsh"},
			"ksh":  {"/bin/ksh", "/usr/bin/ksh"},
		}
	}

	// Check known paths first
	if paths, exists := shellPaths[shell]; exists {
		for _, path := range paths {
			if info, err := os.Stat(path); err == nil {
				// Check if executable
				if info.Mode()&0111 != 0 {
					return path, nil
				}
			}
		}
	}

	// Fallback to PATH lookup
	if path, err := exec.LookPath(shell); err == nil {
		return path, nil
	}

	return "", fmt.Errorf("shell '%s' not found or not executable on %s", shell, runtime.GOOS)
}
