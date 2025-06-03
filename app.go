package main

import (
	"fmt"
	"path/filepath"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Dialog configuration constants
const (
	DefaultDialogTimeout = 30 // seconds
	MaxFileNameLength    = 255
	MaxFileCount         = 100
)

// DialogError represents dialog-related errors with context
type DialogError struct {
	Operation string
	Err       error
}

func (e *DialogError) Error() string {
	return fmt.Sprintf("dialog %s failed: %v", e.Operation, e.Err)
}

// validateContext ensures application context is available for dialog operations
func (a *App) validateContext() error {
	if a.ctx == nil {
		return &DialogError{
			Operation: "context validation",
			Err:       fmt.Errorf("application context not available"),
		}
	}
	return nil
}

// validateFilename checks if filename is safe and within limits
func validateFilename(filename string) error {
	if filename == "" {
		return fmt.Errorf("filename cannot be empty")
	}

	if len(filename) > MaxFileNameLength {
		return fmt.Errorf("filename too long: %d characters (max: %d)", len(filename), MaxFileNameLength)
	}

	// Check for invalid characters
	invalidChars := []string{"<", ">", ":", "\"", "|", "?", "*"}
	for _, char := range invalidChars {
		if strings.Contains(filename, char) {
			return fmt.Errorf("filename contains invalid character: %s", char)
		}
	}

	// Check for reserved names on Windows
	reservedNames := []string{"CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}
	baseName := strings.ToUpper(strings.TrimSuffix(filename, filepath.Ext(filename)))
	for _, reserved := range reservedNames {
		if baseName == reserved {
			return fmt.Errorf("filename uses reserved name: %s", reserved)
		}
	}

	return nil
}

// Dialog and File Selection Methods

// SelectDirectory opens a directory selection dialog and returns the selected path
func (a *App) SelectDirectory() (string, error) {
	if err := a.validateContext(); err != nil {
		return "", err
	}

	// Use Wails runtime to open directory selection dialog
	selectedPath, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Profiles Directory",
	})

	if err != nil {
		return "", &DialogError{
			Operation: "directory selection",
			Err:       err,
		}
	}

	// Validate selected path
	if selectedPath != "" {
		if !filepath.IsAbs(selectedPath) {
			return "", &DialogError{
				Operation: "directory validation",
				Err:       fmt.Errorf("selected path is not absolute: %s", selectedPath),
			}
		}

		// Clean the path
		selectedPath = filepath.Clean(selectedPath)
	}

	return selectedPath, nil
}

// SelectFile opens a file selection dialog and returns the selected file path
func (a *App) SelectFile(title string, filters []wailsRuntime.FileFilter) (string, error) {
	if err := a.validateContext(); err != nil {
		return "", err
	}

	// Validate title
	if title == "" {
		title = "Select File"
	}

	// Use Wails runtime to open file selection dialog
	selectedPath, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})

	if err != nil {
		return "", &DialogError{
			Operation: "file selection",
			Err:       err,
		}
	}

	// Validate selected path
	if selectedPath != "" {
		if !filepath.IsAbs(selectedPath) {
			return "", &DialogError{
				Operation: "file validation",
				Err:       fmt.Errorf("selected path is not absolute: %s", selectedPath),
			}
		}

		// Clean the path
		selectedPath = filepath.Clean(selectedPath)
	}

	return selectedPath, nil
}

// SelectSSHPrivateKey opens a file selection dialog specifically for SSH private keys
func (a *App) SelectSSHPrivateKey() (string, error) {
	filters := []wailsRuntime.FileFilter{
		{
			DisplayName: "SSH Private Keys",
			Pattern:     "*",
		},
		{
			DisplayName: "All Files",
			Pattern:     "*.*",
		},
	}

	selectedPath, err := a.SelectFile("Select SSH Private Key", filters)
	if err != nil {
		return "", fmt.Errorf("SSH private key selection failed: %w", err)
	}

	// Additional validation for SSH keys
	if selectedPath != "" {
		// Check if file exists and is readable
		if !fileExists(selectedPath) {
			return "", &DialogError{
				Operation: "SSH key validation",
				Err:       fmt.Errorf("selected SSH key file does not exist: %s", selectedPath),
			}
		}
	}

	return selectedPath, nil
}

// SelectSaveLocation shows a save dialog for downloading files
func (a *App) SelectSaveLocation(defaultName string) (string, error) {
	if err := a.validateContext(); err != nil {
		return "", err
	}

	// Validate default filename
	if defaultName != "" {
		if err := validateFilename(defaultName); err != nil {
			return "", &DialogError{
				Operation: "default filename validation",
				Err:       err,
			}
		}
	}

	selectedPath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:                "Save File",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
	})

	if err != nil {
		return "", &DialogError{
			Operation: "save location selection",
			Err:       err,
		}
	}

	// Validate selected path
	if selectedPath != "" {
		if !filepath.IsAbs(selectedPath) {
			return "", &DialogError{
				Operation: "save path validation",
				Err:       fmt.Errorf("selected save path is not absolute: %s", selectedPath),
			}
		}

		// Clean the path and validate filename
		selectedPath = filepath.Clean(selectedPath)
		filename := filepath.Base(selectedPath)
		if err := validateFilename(filename); err != nil {
			return "", &DialogError{
				Operation: "save filename validation",
				Err:       err,
			}
		}
	}

	return selectedPath, nil
}

// SelectFilesToUpload shows a file selection dialog for uploading files
func (a *App) SelectFilesToUpload() ([]string, error) {
	if err := a.validateContext(); err != nil {
		return nil, err
	}

	selectedFiles, err := wailsRuntime.OpenMultipleFilesDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Files to Upload",
	})
	if err != nil {
		return nil, &DialogError{
			Operation: "multiple files selection",
			Err:       err,
		}
	}

	// Validate selected files
	if len(selectedFiles) > MaxFileCount {
		return nil, &DialogError{
			Operation: "file count validation",
			Err:       fmt.Errorf("too many files selected: %d (max: %d)", len(selectedFiles), MaxFileCount),
		}
	}

	// Validate each file path
	validatedFiles := make([]string, 0, len(selectedFiles))
	for _, file := range selectedFiles {
		if file == "" {
			continue // Skip empty paths
		}

		if !filepath.IsAbs(file) {
			return nil, &DialogError{
				Operation: "upload file validation",
				Err:       fmt.Errorf("file path is not absolute: %s", file),
			}
		}

		// Clean the path
		cleanFile := filepath.Clean(file)

		// Check if file exists
		if !fileExists(cleanFile) {
			return nil, &DialogError{
				Operation: "upload file validation",
				Err:       fmt.Errorf("selected file does not exist: %s", cleanFile),
			}
		}

		validatedFiles = append(validatedFiles, cleanFile)
	}

	return validatedFiles, nil
}
