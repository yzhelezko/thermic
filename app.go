package main

import (
	"fmt"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Dialog and File Selection Methods

// SelectDirectory opens a directory selection dialog and returns the selected path
func (a *App) SelectDirectory() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("application context not available")
	}

	// Use Wails runtime to open directory selection dialog
	selectedPath, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Profiles Directory",
	})

	if err != nil {
		return "", fmt.Errorf("failed to open directory dialog: %w", err)
	}

	return selectedPath, nil
}

// SelectFile opens a file selection dialog and returns the selected file path
func (a *App) SelectFile(title string, filters []wailsRuntime.FileFilter) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("application context not available")
	}

	// Use Wails runtime to open file selection dialog
	selectedPath, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})

	if err != nil {
		return "", fmt.Errorf("failed to open file dialog: %w", err)
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

	return a.SelectFile("Select SSH Private Key", filters)
}

// SelectSaveLocation shows a save dialog for downloading files
func (a *App) SelectSaveLocation(defaultName string) (string, error) {
	return wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:                "Save File",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
	})
}

// SelectFilesToUpload shows a file selection dialog for uploading files
func (a *App) SelectFilesToUpload() ([]string, error) {
	selectedFiles, err := wailsRuntime.OpenMultipleFilesDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Files to Upload",
	})
	if err != nil {
		return nil, err
	}

	return selectedFiles, nil
}
