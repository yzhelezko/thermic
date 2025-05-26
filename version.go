package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
)

// Version information - will be injected at build time
var (
	Version   = "dev"     // Will be set via ldflags
	GitCommit = "unknown" // Will be set via ldflags
	BuildDate = "unknown" // Will be set via ldflags
)

// VersionInfo represents version information
type VersionInfo struct {
	Version   string `json:"version"`
	GitCommit string `json:"gitCommit"`
	BuildDate string `json:"buildDate"`
	GoVersion string `json:"goVersion"`
	Platform  string `json:"platform"`
	Arch      string `json:"arch"`
}

// UpdateInfo represents update information from GitHub
type UpdateInfo struct {
	Available      bool   `json:"available"`
	LatestVersion  string `json:"latestVersion"`
	CurrentVersion string `json:"currentVersion"`
	DownloadURL    string `json:"downloadUrl"`
	ReleaseNotes   string `json:"releaseNotes"`
	Size           int64  `json:"size"`
}

// GitHubRelease represents GitHub release API response
type GitHubRelease struct {
	TagName    string `json:"tag_name"`
	Name       string `json:"name"`
	Body       string `json:"body"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
		Size               int64  `json:"size"`
	} `json:"assets"`
}

// GetVersionInfo returns current application version information
func (a *App) GetVersionInfo() *VersionInfo {
	return &VersionInfo{
		Version:   Version,
		GitCommit: GitCommit,
		BuildDate: BuildDate,
		GoVersion: runtime.Version(),
		Platform:  runtime.GOOS,
		Arch:      runtime.GOARCH,
	}
}

// CheckForUpdates checks GitHub releases for newer versions
func (a *App) CheckForUpdates() (*UpdateInfo, error) {
	const repoURL = "https://api.github.com/repos/yzhelezko/thermic/releases/latest"

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(repoURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch release info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("failed to decode release info: %w", err)
	}

	// Skip draft and prerelease versions
	if release.Draft || release.Prerelease {
		return &UpdateInfo{
			Available:      false,
			CurrentVersion: Version,
			LatestVersion:  Version,
		}, nil
	}

	updateInfo := &UpdateInfo{
		CurrentVersion: Version,
		LatestVersion:  release.TagName,
		ReleaseNotes:   release.Body,
	}

	// Compare versions using semantic versioning
	updateInfo.Available = isNewerVersion(Version, release.TagName)

	if updateInfo.Available {
		// Find the appropriate asset for current platform
		assetName := getAssetNameForPlatform()
		for _, asset := range release.Assets {
			if asset.Name == assetName {
				updateInfo.DownloadURL = asset.BrowserDownloadURL
				updateInfo.Size = asset.Size
				break
			}
		}

		if updateInfo.DownloadURL == "" {
			return nil, fmt.Errorf("no suitable binary found for platform %s/%s", runtime.GOOS, runtime.GOARCH)
		}
	}

	return updateInfo, nil
}

// DownloadAndInstallUpdate downloads and installs the update
func (a *App) DownloadAndInstallUpdate(downloadURL string) error {
	if downloadURL == "" {
		return fmt.Errorf("download URL is empty")
	}

	// Handle macOS app bundle updates differently
	if runtime.GOOS == "darwin" {
		return a.downloadAndInstallMacOSUpdate(downloadURL)
	}

	// Get current executable path
	currentExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get current executable path: %w", err)
	}

	// Create temp directory for download
	tempDir, err := os.MkdirTemp("", "thermic-update-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Download the new binary
	newBinaryPath := filepath.Join(tempDir, filepath.Base(currentExe))
	if err := a.downloadFile(downloadURL, newBinaryPath); err != nil {
		return fmt.Errorf("failed to download update: %w", err)
	}

	// Make the new binary executable on Unix-like systems
	if runtime.GOOS != "windows" {
		if err := os.Chmod(newBinaryPath, 0755); err != nil {
			return fmt.Errorf("failed to make binary executable: %w", err)
		}
	}

	// Replace the current binary
	if err := a.replaceBinary(currentExe, newBinaryPath); err != nil {
		return fmt.Errorf("failed to replace binary: %w", err)
	}

	return nil
}

// RestartApplication restarts the application after update
func (a *App) RestartApplication() error {
	if runtime.GOOS == "darwin" {
		// On macOS, find the app bundle and use 'open' command
		currentExe, err := os.Executable()
		if err != nil {
			return fmt.Errorf("failed to get current executable path: %w", err)
		}

		// Find the app bundle path
		appBundlePath := currentExe
		for {
			if strings.HasSuffix(appBundlePath, ".app") {
				break
			}
			parent := filepath.Dir(appBundlePath)
			if parent == appBundlePath {
				return fmt.Errorf("could not find .app bundle path")
			}
			appBundlePath = parent
		}

		// Use 'open' command to restart the app
		cmd := exec.Command("open", appBundlePath)
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("failed to restart app: %w", err)
		}

		// Exit current instance
		os.Exit(0)
		return nil
	}

	// For other platforms, use the original logic
	currentExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get current executable path: %w", err)
	}

	// Start new instance
	cmd := exec.Command(currentExe, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start new instance: %w", err)
	}

	// Exit current instance
	os.Exit(0)
	return nil
}

// downloadFile downloads a file from URL to local path
func (a *App) downloadFile(url, filepath string) error {
	client := &http.Client{
		Timeout: 5 * time.Minute, // Longer timeout for file download
	}

	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// replaceBinary replaces the current binary with the new one
func (a *App) replaceBinary(currentPath, newPath string) error {
	switch runtime.GOOS {
	case "windows":
		return a.replaceBinaryWindows(currentPath, newPath)
	default:
		return a.replaceBinaryUnix(currentPath, newPath)
	}
}

// replaceBinaryWindows handles binary replacement on Windows
func (a *App) replaceBinaryWindows(currentPath, newPath string) error {
	// On Windows, we can't replace a running executable directly
	// We need to create a batch script that replaces it after the app exits

	batchPath := currentPath + ".update.bat"
	batchContent := fmt.Sprintf(`@echo off
timeout /t 2 /nobreak >nul
move "%s" "%s.bak" >nul 2>&1
move "%s" "%s"
if errorlevel 1 (
    move "%s.bak" "%s" >nul 2>&1
    echo Update failed
    pause
    exit /b 1
)
del "%s.bak" >nul 2>&1
start "" "%s"
del "%%~f0"
`, currentPath, currentPath, newPath, currentPath, currentPath, currentPath, currentPath, currentPath)

	if err := os.WriteFile(batchPath, []byte(batchContent), 0755); err != nil {
		return err
	}

	// Execute the batch script
	cmd := exec.Command("cmd", "/c", batchPath)
	cmd.Start()

	// Exit current process
	os.Exit(0)
	return nil
}

// replaceBinaryUnix handles binary replacement on Unix-like systems
func (a *App) replaceBinaryUnix(currentPath, newPath string) error {
	// Create a shell script that replaces the binary after the app exits
	scriptPath := currentPath + ".update.sh"
	scriptContent := fmt.Sprintf(`#!/bin/bash
sleep 2
mv "%s" "%s.bak" 2>/dev/null
mv "%s" "%s"
if [ $? -ne 0 ]; then
    mv "%s.bak" "%s" 2>/dev/null
    echo "Update failed"
    exit 1
fi
rm -f "%s.bak"
"%s" &
rm -f "$0"
`, currentPath, currentPath, newPath, currentPath, currentPath, currentPath, currentPath, currentPath)

	if err := os.WriteFile(scriptPath, []byte(scriptContent), 0755); err != nil {
		return err
	}

	// Execute the script
	cmd := exec.Command("bash", scriptPath)
	cmd.Start()

	// Exit current process
	os.Exit(0)
	return nil
}

// getAssetNameForPlatform returns the expected asset name for current platform
func getAssetNameForPlatform() string {
	switch runtime.GOOS {
	case "windows":
		return "thermic-windows-amd64.exe"
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return "thermic-darwin-arm64.zip"
		}
		return "thermic-darwin-amd64.zip"
	case "linux":
		return "thermic-linux-amd64"
	default:
		return fmt.Sprintf("thermic-%s-%s", runtime.GOOS, runtime.GOARCH)
	}
}

// isNewerVersion compares two version strings using semantic versioning
func isNewerVersion(current, latest string) bool {
	// Handle dev version - always consider updates available
	if strings.HasPrefix(current, "dev") {
		return !strings.HasPrefix(latest, "dev")
	}

	// Parse versions - remove 'v' prefix if present
	currentVer, err := semver.NewVersion(strings.TrimPrefix(current, "v"))
	if err != nil {
		// If current version is not valid semver, consider update available
		return true
	}

	latestVer, err := semver.NewVersion(strings.TrimPrefix(latest, "v"))
	if err != nil {
		// If latest version is not valid semver, no update available
		return false
	}

	// Compare semantic versions
	return latestVer.GreaterThan(currentVer)
}

// downloadAndInstallMacOSUpdate handles macOS app bundle updates
func (a *App) downloadAndInstallMacOSUpdate(downloadURL string) error {
	// Get current executable path - this will be inside the app bundle
	currentExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get current executable path: %w", err)
	}

	// Find the app bundle path (should be something like /Applications/Thermic.app)
	appBundlePath := currentExe
	for {
		if strings.HasSuffix(appBundlePath, ".app") {
			break
		}
		parent := filepath.Dir(appBundlePath)
		if parent == appBundlePath {
			return fmt.Errorf("could not find .app bundle path")
		}
		appBundlePath = parent
	}

	// Create temp directory for download
	tempDir, err := os.MkdirTemp("", "thermic-update-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Download the zip file
	zipPath := filepath.Join(tempDir, "update.zip")
	if err := a.downloadFile(downloadURL, zipPath); err != nil {
		return fmt.Errorf("failed to download update: %w", err)
	}

	// Extract the zip file
	extractDir := filepath.Join(tempDir, "extracted")
	if err := a.extractZip(zipPath, extractDir); err != nil {
		return fmt.Errorf("failed to extract update: %w", err)
	}

	// Find the new app bundle in the extracted files
	newAppBundlePath := filepath.Join(extractDir, "Thermic.app")
	if _, err := os.Stat(newAppBundlePath); os.IsNotExist(err) {
		return fmt.Errorf("Thermic.app not found in update package")
	}

	// Replace the app bundle
	if err := a.replaceAppBundle(appBundlePath, newAppBundlePath); err != nil {
		return fmt.Errorf("failed to replace app bundle: %w", err)
	}

	return nil
}

// extractZip extracts a zip file to the specified directory
func (a *App) extractZip(src, dest string) error {
	// Open the zip file for reading
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	// Create the destination directory
	if err := os.MkdirAll(dest, 0755); err != nil {
		return err
	}

	// Extract files
	for _, f := range r.File {
		// Construct the full path
		path := filepath.Join(dest, f.Name)

		// Check for directory traversal
		if !strings.HasPrefix(path, filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("invalid file path: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			// Create directory
			if err := os.MkdirAll(path, f.FileInfo().Mode()); err != nil {
				return err
			}
			continue
		}

		// Create the directories for this file
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}

		// Open the file in the zip
		rc, err := f.Open()
		if err != nil {
			return err
		}

		// Create the destination file
		outFile, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.FileInfo().Mode())
		if err != nil {
			rc.Close()
			return err
		}

		// Copy the file contents
		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()

		if err != nil {
			return err
		}
	}

	return nil
}

// replaceAppBundle replaces the current app bundle with a new one
func (a *App) replaceAppBundle(currentAppPath, newAppPath string) error {
	// Create a shell script that replaces the app bundle after the app exits
	scriptPath := currentAppPath + ".update.sh"
	scriptContent := fmt.Sprintf(`#!/bin/bash
sleep 2
mv "%s" "%s.bak" 2>/dev/null
mv "%s" "%s"
if [ $? -ne 0 ]; then
    mv "%s.bak" "%s" 2>/dev/null
    echo "Update failed"
    exit 1
fi
rm -rf "%s.bak"
open "%s"
rm -f "$0"
`, currentAppPath, currentAppPath, newAppPath, currentAppPath, currentAppPath, currentAppPath, currentAppPath, currentAppPath)

	if err := os.WriteFile(scriptPath, []byte(scriptContent), 0755); err != nil {
		return err
	}

	// Execute the script
	cmd := exec.Command("bash", scriptPath)
	cmd.Start()

	// Exit current process
	os.Exit(0)
	return nil
}
