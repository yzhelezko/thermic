//go:build !windows

package main

import (
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
			"fish": {"/usr/local/bin/fish", "/opt/homebrew/bin/fish", "/usr/bin/fish"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
		}
	} else {
		// Linux and other Unix systems
		commonPaths = map[string][]string{
			"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"},
			"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"},
			"fish": {"/bin/fish", "/usr/bin/fish", "/usr/local/bin/fish"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
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
	// Configure process attributes to prevent visible terminal windows on macOS
	if runtime.GOOS == "darwin" {
		if cmd.SysProcAttr == nil {
			cmd.SysProcAttr = &syscall.SysProcAttr{}
		}
		// On macOS, create a new process group and detach from controlling terminal
		cmd.SysProcAttr.Setpgid = true
		cmd.SysProcAttr.Pgid = 0
		// Prevent the process from creating a visible terminal window
		cmd.SysProcAttr.Noctty = true
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
			"fish": {"/usr/local/bin/fish", "/opt/homebrew/bin/fish", "/usr/bin/fish"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
		}
	} else {
		// Linux and other Unix systems
		shellPaths = map[string][]string{
			"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"},
			"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"},
			"fish": {"/bin/fish", "/usr/bin/fish", "/usr/local/bin/fish"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
			"csh":  {"/bin/csh", "/usr/bin/csh"},
			"tcsh": {"/bin/tcsh", "/usr/bin/tcsh"},
			"ksh":  {"/bin/ksh", "/usr/bin/ksh"},
		}
	}

	// Check known paths first
	if paths, exists := shellPaths[shell]; exists {
		for _, path := range paths {
			if fileExists(path) {
				return path, nil
			}
		}
	}

	// Fallback to PATH lookup only if no file-based paths work
	return exec.LookPath(shell)
}
