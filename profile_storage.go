package main

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v2"
)

// File operation timeout for safety
const FileOperationTimeout = 30 * time.Second

// GetProfilesDirectory returns the full path to the profiles directory with validation
func (a *App) GetProfilesDirectory() (string, error) {
	// Check if a custom profiles path is configured
	if a.config != nil && a.config.config.ProfilesPath != "" {
		// Use the configured custom path
		return a.config.config.ProfilesPath, nil
	}

	// Fall back to default path
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config directory: %w", err)
	}
	return filepath.Join(configDir, ConfigDirName, ProfilesDirName), nil
}

// InitializeProfiles sets up the profile management system with proper error handling
func (a *App) InitializeProfiles() error {
	// Ensure profiles directory exists
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return fmt.Errorf("failed to get profiles directory: %w", err)
	}

	if err := os.MkdirAll(profilesDir, ConfigDirMode); err != nil {
		return fmt.Errorf("failed to create profiles directory: %w", err)
	}

	// Initialize virtual folders
	a.initializeVirtualFolders()

	// Load metrics
	if err := a.loadMetrics(); err != nil {
		fmt.Printf("Warning: Failed to load metrics: %v\n", err)
		a.profiles.metrics = &ProfileMetrics{}
	}

	// Load existing profiles
	if err := a.LoadProfiles(); err != nil {
		return fmt.Errorf("failed to load profiles: %w", err)
	}

	// Create default profiles if none exist
	if len(a.profiles.profiles) == 0 {
		if err := a.CreateDefaultProfiles(); err != nil {
			return fmt.Errorf("failed to create default profiles: %w", err)
		}
	}

	// Start file watcher
	if err := a.StartProfileWatcher(); err != nil {
		return fmt.Errorf("failed to start profile watcher: %w", err)
	}

	// Save initial metrics
	go a.saveMetrics()

	return nil
}

// LoadProfiles loads all profiles from the profiles directory with timeout protection
func (a *App) LoadProfiles() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), FileOperationTimeout)
	defer cancel()

	// Clear existing profiles
	a.profiles.mutex.Lock()
	a.profiles.profiles = make(map[string]*Profile)
	a.profiles.profileFolders = make(map[string]*ProfileFolder)
	a.profiles.mutex.Unlock()

	// Walk through all files in profiles directory
	err = filepath.WalkDir(profilesDir, func(path string, d fs.DirEntry, err error) error {
		// Check for context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err != nil {
			return err
		}

		// Skip directories and non-yaml files
		if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".yaml") {
			return nil
		}

		// Skip metrics file - it's not a profile or folder
		name := d.Name()
		if name == "metrics.yaml" {
			return nil
		}

		// Validate file size
		info, err := d.Info()
		if err != nil {
			fmt.Printf("Warning: Failed to get file info for %s: %v\n", path, err)
			return nil
		}

		if info.Size() > MaxFileSize {
			fmt.Printf("Warning: File %s exceeds maximum size limit, skipping\n", path)
			return nil
		}

		// Determine if it's a profile or folder based on filename pattern
		if strings.HasPrefix(name, "folder-") {
			// Load folder
			folder, err := a.LoadProfileFolder(path)
			if err != nil {
				fmt.Printf("Warning: Failed to load profile folder %s: %v\n", path, err)
				return nil // Continue loading other files
			}

			a.profiles.mutex.Lock()
			a.profiles.profileFolders[folder.ID] = folder
			a.profiles.mutex.Unlock()
		} else {
			// Load profile
			profile, err := a.LoadProfile(path)
			if err != nil {
				fmt.Printf("Warning: Failed to load profile %s: %v\n", path, err)
				return nil // Continue loading other files
			}

			a.profiles.mutex.Lock()
			a.profiles.profiles[profile.ID] = profile
			a.profiles.mutex.Unlock()
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to walk profiles directory: %w", err)
	}

	a.profiles.mutex.RLock()
	profileCount := len(a.profiles.profiles)
	folderCount := len(a.profiles.profileFolders)

	// Debug: List all loaded folders
	fmt.Printf("DEBUG: LoadProfiles - All loaded folders:\n")
	for id, folder := range a.profiles.profileFolders {
		fmt.Printf("DEBUG: - %s (ID: %s, Parent: %s, Path: %s)\n", folder.Name, id, folder.ParentFolderID, a.buildFolderPath(id))
	}

	a.profiles.mutex.RUnlock()

	fmt.Printf("Loaded %d profiles and %d folders\n", profileCount, folderCount)
	return nil
}

// LoadProfile loads a single profile from file with validation
func (a *App) LoadProfile(filePath string) (*Profile, error) {
	// Validate file path
	if err := a.validateProfilePath(filePath); err != nil {
		return nil, fmt.Errorf("invalid file path: %w", err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read profile file: %w", err)
	}

	// Check for empty file
	if len(data) == 0 {
		return nil, fmt.Errorf("profile file is empty")
	}

	var profile Profile
	if err := yaml.Unmarshal(data, &profile); err != nil {
		return nil, fmt.Errorf("failed to parse profile YAML: %w", err)
	}

	// Validate loaded profile
	if err := a.validateProfile(&profile); err != nil {
		return nil, fmt.Errorf("invalid profile data: %w", err)
	}

	return &profile, nil
}

// LoadProfileFolder loads a single profile folder from file with validation
func (a *App) LoadProfileFolder(filePath string) (*ProfileFolder, error) {
	// Validate file path
	if err := a.validateProfilePath(filePath); err != nil {
		return nil, fmt.Errorf("invalid file path: %w", err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read folder file: %w", err)
	}

	// Check for empty file
	if len(data) == 0 {
		return nil, fmt.Errorf("folder file is empty")
	}

	var folder ProfileFolder
	if err := yaml.Unmarshal(data, &folder); err != nil {
		return nil, fmt.Errorf("failed to parse folder YAML: %w", err)
	}

	// Validate loaded folder
	if err := a.validateProfileFolder(&folder); err != nil {
		return nil, fmt.Errorf("invalid folder data: %w", err)
	}

	return &folder, nil
}

// findProfileFile finds the existing file for a profile by ID with better error handling
func (a *App) findProfileFile(profileID string) (string, error) {
	if profileID == "" {
		return "", fmt.Errorf("profile ID cannot be empty")
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return "", err
	}

	// Walk through all files in profiles directory to find the one with matching ID
	var foundFile string
	err = filepath.WalkDir(profilesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and non-yaml files
		if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".yaml") {
			return nil
		}

		name := d.Name()
		// Skip metrics file and folder files
		if name == "metrics.yaml" || strings.HasPrefix(name, "folder-") {
			return nil
		}

		// Check if this is a profile file with the matching ID
		// Profile files are in format: Name-ID.yaml
		parts := strings.Split(name, "-")
		if len(parts) >= 2 {
			id := strings.TrimSuffix(parts[len(parts)-1], ".yaml")
			if id == profileID {
				foundFile = path
				return filepath.SkipAll // Stop walking once found
			}
		}

		return nil
	})

	if err != nil {
		return "", fmt.Errorf("failed to search for profile file: %w", err)
	}

	if foundFile == "" {
		return "", fmt.Errorf("profile file not found for ID: %s", profileID)
	}

	return foundFile, nil
}

// findFolderFile finds the existing file for a folder by ID with better error handling
func (a *App) findFolderFile(folderID string) (string, error) {
	if folderID == "" {
		return "", fmt.Errorf("folder ID cannot be empty")
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return "", err
	}

	// Walk through all files in profiles directory to find the one with matching ID
	var foundFile string
	err = filepath.WalkDir(profilesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and non-yaml files
		if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".yaml") {
			return nil
		}

		name := d.Name()
		// Skip metrics file and non-folder files
		if name == "metrics.yaml" || !strings.HasPrefix(name, "folder-") {
			return nil
		}

		// Check if this is a folder file with the matching ID
		// Folder files are in format: folder-Name-ID.yaml
		parts := strings.Split(name, "-")
		if len(parts) >= 3 { // folder-Name-ID.yaml has at least 3 parts
			id := strings.TrimSuffix(parts[len(parts)-1], ".yaml")
			if id == folderID {
				foundFile = path
				return filepath.SkipAll // Stop walking once found
			}
		}

		return nil
	})

	if err != nil {
		return "", fmt.Errorf("failed to search for folder file: %w", err)
	}

	if foundFile == "" {
		return "", fmt.Errorf("folder file not found for ID: %s", folderID)
	}

	return foundFile, nil
}

// saveProfileInternal saves a profile to file without mutex locking (internal use) with enhanced safety
func (a *App) saveProfileInternal(profile *Profile) error {
	if profile == nil {
		return fmt.Errorf("profile cannot be nil")
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	profile.LastModified = time.Now()

	data, err := yaml.Marshal(profile)
	if err != nil {
		return fmt.Errorf("failed to marshal profile: %w", err)
	}

	filename := fmt.Sprintf("%s-%s.yaml", profile.Name, profile.ID)
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)

	// Validate file path
	if err := a.validateProfilePath(filePath); err != nil {
		return fmt.Errorf("invalid file path: %w", err)
	}

	// Temporarily stop the file watcher to prevent race conditions
	wasWatcherRunning := a.profiles.profileWatcher != nil
	if wasWatcherRunning {
		a.StopProfileWatcher()
	}

	// Find and delete any existing file for this profile ID (handles renames)
	existingFile, err := a.findProfileFile(profile.ID)
	if err == nil && existingFile != "" && existingFile != filePath {
		// Only delete if it's a different file (different name)
		if deleteErr := os.Remove(existingFile); deleteErr != nil && !os.IsNotExist(deleteErr) {
			fmt.Printf("Warning: Failed to delete old profile file %s: %v\n", existingFile, deleteErr)
		}
	}

	// Write file with proper permissions
	if err := os.WriteFile(filePath, data, ConfigFileMode); err != nil {
		// Restart watcher before returning error
		if wasWatcherRunning {
			go func() {
				if watchErr := a.StartProfileWatcher(); watchErr != nil {
					fmt.Printf("Warning: Failed to restart profile watcher: %v\n", watchErr)
				}
			}()
		}
		return fmt.Errorf("failed to write profile file: %w", err)
	}

	// Update in memory
	a.profiles.profiles[profile.ID] = profile

	// Restart the file watcher
	if wasWatcherRunning {
		go func() {
			if watchErr := a.StartProfileWatcher(); watchErr != nil {
				fmt.Printf("Warning: Failed to restart profile watcher: %v\n", watchErr)
			}
		}()
	}

	return nil
}

// saveProfileFolderInternal saves a profile folder to file without mutex locking (internal use) with enhanced safety
func (a *App) saveProfileFolderInternal(folder *ProfileFolder) error {
	if folder == nil {
		return fmt.Errorf("folder cannot be nil")
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	folder.LastModified = time.Now()

	data, err := yaml.Marshal(folder)
	if err != nil {
		return fmt.Errorf("failed to marshal profile folder: %w", err)
	}

	filename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, folder.ID)
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)

	// Validate file path
	if err := a.validateProfilePath(filePath); err != nil {
		return fmt.Errorf("invalid file path: %w", err)
	}

	// Temporarily stop the file watcher to prevent race conditions
	wasWatcherRunning := a.profiles.profileWatcher != nil
	if wasWatcherRunning {
		a.StopProfileWatcher()
	}

	// Find and delete any existing file for this folder ID (handles renames)
	existingFile, err := a.findFolderFile(folder.ID)
	if err == nil && existingFile != "" && existingFile != filePath {
		// Only delete if it's a different file (different name)
		if deleteErr := os.Remove(existingFile); deleteErr != nil && !os.IsNotExist(deleteErr) {
			fmt.Printf("Warning: Failed to delete old folder file %s: %v\n", existingFile, deleteErr)
		}
	}

	// Write file with proper permissions
	if err := os.WriteFile(filePath, data, ConfigFileMode); err != nil {
		// Restart watcher before returning error
		if wasWatcherRunning {
			go func() {
				if watchErr := a.StartProfileWatcher(); watchErr != nil {
					fmt.Printf("Warning: Failed to restart profile watcher: %v\n", watchErr)
				}
			}()
		}
		return fmt.Errorf("failed to write profile folder file: %w", err)
	}

	// Update in memory
	a.profiles.profileFolders[folder.ID] = folder

	// Restart the file watcher
	if wasWatcherRunning {
		go func() {
			if watchErr := a.StartProfileWatcher(); watchErr != nil {
				fmt.Printf("Warning: Failed to restart profile watcher: %v\n", watchErr)
			}
		}()
	}

	return nil
}
