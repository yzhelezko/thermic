//go:build !windows

package main

import (
	"os"
	"os/exec"

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

	// For non-Windows, check common paths first
	commonPaths := map[string][]string{
		"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"},
		"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"},
		"fish": {"/bin/fish", "/usr/bin/fish", "/usr/local/bin/fish"},
		"sh":   {"/bin/sh", "/usr/bin/sh"},
	}

	for shellName, paths := range commonPaths {
		for _, path := range paths {
			if fileExists(path) {
				shells = append(shells, shellName)
				break
			}
		}
	}

	// Fallback to exec.LookPath for shells not found in common paths
	fallbackCandidates := []string{"csh", "tcsh", "ksh"}
	for _, shell := range fallbackCandidates {
		if _, err := exec.LookPath(shell); err == nil {
			shells = append(shells, shell)
		}
	}

	return shells
}

// configurePtyProcess is a no-op on Unix platforms
func configurePtyProcess(cmd *pty.Cmd) {
	// No-op on Unix
}

// findWSLExecutable returns error on non-Windows platforms
func findWSLExecutable() (string, error) {
	return "", exec.ErrNotFound
}

// findShellExecutable finds shell executable using standard PATH lookup
func findShellExecutable(shell string) (string, error) {
	return exec.LookPath(shell)
}
