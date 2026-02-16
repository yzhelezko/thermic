package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Additional profile constants that extend the ones in types.go
const (
	MaxProfileName = 255
	MaxFileSize    = 1024 * 1024 // 1MB
)

// ProfileError represents a structured profile operation error
type ProfileError struct {
	Op        string
	ProfileID string
	Path      string
	Err       error
}

func (e *ProfileError) Error() string {
	return fmt.Sprintf("profile %s %s %s: %v", e.Op, e.ProfileID, e.Path, e.Err)
}

// sanitizeFilename ensures a filename is safe for all operating systems
func sanitizeFilename(filename string) string {
	// Replace spaces with underscores
	filename = strings.ReplaceAll(filename, " ", "_")

	// Replace path separators
	filename = strings.ReplaceAll(filename, "/", "_")
	filename = strings.ReplaceAll(filename, "\\", "_")

	// Replace other problematic characters for Windows/Unix compatibility
	filename = strings.ReplaceAll(filename, ":", "_")
	filename = strings.ReplaceAll(filename, "*", "_")
	filename = strings.ReplaceAll(filename, "?", "_")
	filename = strings.ReplaceAll(filename, "\"", "_")
	filename = strings.ReplaceAll(filename, "<", "_")
	filename = strings.ReplaceAll(filename, ">", "_")
	filename = strings.ReplaceAll(filename, "|", "_")

	// Remove any remaining control characters
	reg := regexp.MustCompile(`[[:cntrl:]]`)
	filename = reg.ReplaceAllString(filename, "_")

	// Trim dots and spaces from the end (Windows doesn't like these)
	filename = strings.TrimRight(filename, ". ")

	// Ensure filename isn't empty
	if filename == "" {
		filename = "unnamed"
	}

	return filename
}

// validateProfilePath validates that the path is within the profiles directory
func (a *App) validateProfilePath(path string) error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return err
	}

	if !strings.HasPrefix(absPath, profilesDir) {
		return fmt.Errorf("invalid profile path: outside profiles directory")
	}

	return nil
}

// validateProfile validates profile data before operations
func (a *App) validateProfile(profile *Profile) error {
	if profile.Name == "" {
		return fmt.Errorf("profile name cannot be empty")
	}

	if len(profile.Name) > MaxProfileName {
		return fmt.Errorf("profile name exceeds maximum length of %d", MaxProfileName)
	}

	if len(profile.Tags) > MaxTagsPerProfile {
		return fmt.Errorf("profile exceeds maximum tags limit of %d", MaxTagsPerProfile)
	}

	return nil
}

// validateProfileFolder validates profile folder data before operations
func (a *App) validateProfileFolder(folder *ProfileFolder) error {
	if folder.Name == "" {
		return fmt.Errorf("folder name cannot be empty")
	}

	if len(folder.Name) > MaxProfileName {
		return fmt.Errorf("folder name exceeds maximum length of %d", MaxProfileName)
	}

	return nil
}

// generateID creates a unique identifier
func generateID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// CreateProfile creates a new profile with validation and security checks
func (a *App) CreateProfile(name, profileType, shell, icon, folderPath string) (*Profile, error) {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	// Check profile count limit
	if len(a.profiles.profiles) >= MaxProfiles {
		return nil, fmt.Errorf("profile limit reached (%d)", MaxProfiles)
	}

	id := generateID()
	now := time.Now()

	profile := &Profile{
		ID:           id,
		Name:         name,
		Icon:         icon,
		Type:         profileType,
		Shell:        shell,
		Environment:  make(map[string]string),
		Created:      now,
		LastModified: now,
	}

	// Validate profile data
	if err := a.validateProfile(profile); err != nil {
		return nil, &ProfileError{
			Op:        "create",
			ProfileID: id,
			Err:       err,
		}
	}

	// If folderPath is provided, try to find the corresponding folder ID
	if folderPath != "" {
		folderID := a.findFolderByPathLockFree(folderPath)
		profile.FolderID = folderID
	}

	if err := a.saveProfileInternal(profile); err != nil {
		return nil, &ProfileError{
			Op:        "save",
			ProfileID: id,
			Err:       err,
		}
	}

	return profile, nil
}

// CreateProfileWithFolderID creates a new profile using folder ID reference with validation
func (a *App) CreateProfileWithFolderID(name, profileType, shell, icon, folderID string) (*Profile, error) {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	// Check profile count limit
	if len(a.profiles.profiles) >= MaxProfiles {
		return nil, fmt.Errorf("profile limit reached (%d)", MaxProfiles)
	}

	id := generateID()
	now := time.Now()

	// Validate folder exists if folderID is provided
	if folderID != "" {
		if _, exists := a.profiles.profileFolders[folderID]; !exists {
			return nil, &ProfileError{
				Op:        "validate",
				ProfileID: id,
				Err:       fmt.Errorf("folder with ID %s not found", folderID),
			}
		}
	}

	profile := &Profile{
		ID:           id,
		Name:         name,
		Icon:         icon,
		Type:         profileType,
		Shell:        shell,
		FolderID:     folderID,
		Environment:  make(map[string]string),
		Created:      now,
		LastModified: now,
	}

	// Validate profile data
	if err := a.validateProfile(profile); err != nil {
		return nil, &ProfileError{
			Op:        "create",
			ProfileID: id,
			Err:       err,
		}
	}

	if err := a.saveProfileInternal(profile); err != nil {
		return nil, &ProfileError{
			Op:        "save",
			ProfileID: id,
			Err:       err,
		}
	}

	return profile, nil
}

// CreateProfileFolder creates a new profile folder with validation
func (a *App) CreateProfileFolder(name, icon, parentPath string) (*ProfileFolder, error) {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	id := generateID()
	now := time.Now()

	folder := &ProfileFolder{
		ID:           id,
		Name:         name,
		Icon:         icon,
		Created:      now,
		LastModified: now,
		Expanded:     false,
	}

	// If parentPath is provided, try to find the corresponding folder ID
	if parentPath != "" {
		parentID := a.findFolderByPathLockFree(parentPath)
		folder.ParentFolderID = parentID
	}

	// Validate folder data
	if err := a.validateProfileFolder(folder); err != nil {
		return nil, &ProfileError{
			Op:        "create",
			ProfileID: id,
			Err:       err,
		}
	}

	if err := a.saveProfileFolderInternal(folder); err != nil {
		return nil, &ProfileError{
			Op:        "save",
			ProfileID: id,
			Err:       err,
		}
	}

	return folder, nil
}

// CreateProfileFolderWithParentID creates a new profile folder using parent ID reference
func (a *App) CreateProfileFolderWithParentID(name, icon, parentFolderID string) (*ProfileFolder, error) {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	id := generateID()
	now := time.Now()

	// Validate parent folder exists if parentFolderID is provided
	if parentFolderID != "" {
		if _, exists := a.profiles.profileFolders[parentFolderID]; !exists {
			return nil, &ProfileError{
				Op:        "validate",
				ProfileID: id,
				Err:       fmt.Errorf("parent folder with ID %s not found", parentFolderID),
			}
		}
	}

	folder := &ProfileFolder{
		ID:             id,
		Name:           name,
		Icon:           icon,
		ParentFolderID: parentFolderID,
		Created:        now,
		LastModified:   now,
		Expanded:       false,
	}

	// Validate folder data
	if err := a.validateProfileFolder(folder); err != nil {
		return nil, &ProfileError{
			Op:        "create",
			ProfileID: id,
			Err:       err,
		}
	}

	if err := a.saveProfileFolderInternal(folder); err != nil {
		return nil, &ProfileError{
			Op:        "save",
			ProfileID: id,
			Err:       err,
		}
	}

	return folder, nil
}

// DeleteProfile removes a profile with proper cleanup
func (a *App) DeleteProfile(id string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	profile, exists := a.profiles.profiles[id]
	if !exists {
		return &ProfileError{
			Op:        "delete",
			ProfileID: id,
			Err:       fmt.Errorf("profile not found"),
		}
	}

	// Find and delete the profile file
	filename := fmt.Sprintf("%s-%s.yaml", profile.Name, profile.ID)
	filename = sanitizeFilename(filename)

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return &ProfileError{
			Op:        "delete",
			ProfileID: id,
			Path:      profilesDir,
			Err:       err,
		}
	}

	filePath := filepath.Join(profilesDir, filename)

	// Validate path before deletion
	if err := a.validateProfilePath(filePath); err != nil {
		return &ProfileError{
			Op:        "validate",
			ProfileID: id,
			Path:      filePath,
			Err:       err,
		}
	}

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return &ProfileError{
			Op:        "delete",
			ProfileID: id,
			Path:      filePath,
			Err:       err,
		}
	}

	// Remove from memory
	delete(a.profiles.profiles, id)

	return nil
}

// DeleteProfileFolder removes a profile folder with proper cleanup
func (a *App) DeleteProfileFolder(id string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	folder, exists := a.profiles.profileFolders[id]
	if !exists {
		return &ProfileError{
			Op:        "delete",
			ProfileID: id,
			Err:       fmt.Errorf("folder not found"),
		}
	}

	// Find and delete the folder file
	filename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, folder.ID)
	filename = sanitizeFilename(filename)

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return &ProfileError{
			Op:        "delete",
			ProfileID: id,
			Path:      profilesDir,
			Err:       err,
		}
	}

	filePath := filepath.Join(profilesDir, filename)

	// Validate path before deletion
	if err := a.validateProfilePath(filePath); err != nil {
		return &ProfileError{
			Op:        "validate",
			ProfileID: id,
			Path:      filePath,
			Err:       err,
		}
	}

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return &ProfileError{
			Op:        "delete",
			ProfileID: id,
			Path:      filePath,
			Err:       err,
		}
	}

	// Move any profiles in this folder to root
	folderPath := a.buildFolderPathLockFree(id, 0)
	for _, profile := range a.profiles.profiles {
		profilePath := a.buildFolderPathLockFree(profile.FolderID, 0)
		if strings.HasPrefix(profilePath, folderPath) {
			// Move profile to root
			profile.FolderID = ""
			a.saveProfileInternal(profile)
		}
	}

	// Remove from memory
	delete(a.profiles.profileFolders, id)

	return nil
}

// GetProfileByID retrieves a profile by its ID with proper validation
func (a *App) GetProfileByID(profileID string) (*Profile, error) {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	if profileID == "" {
		return nil, &ProfileError{
			Op:        "get",
			ProfileID: profileID,
			Err:       fmt.Errorf("profile ID cannot be empty"),
		}
	}

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return nil, &ProfileError{
			Op:        "get",
			ProfileID: profileID,
			Err:       fmt.Errorf("profile not found"),
		}
	}

	return profile, nil
}

// GetFolderByID retrieves a folder by its ID with proper validation
func (a *App) GetFolderByID(folderID string) (*ProfileFolder, error) {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	if folderID == "" {
		return nil, &ProfileError{
			Op:        "get",
			ProfileID: folderID,
			Err:       fmt.Errorf("folder ID cannot be empty"),
		}
	}

	folder, exists := a.profiles.profileFolders[folderID]
	if !exists {
		return nil, &ProfileError{
			Op:        "get",
			ProfileID: folderID,
			Err:       fmt.Errorf("folder not found"),
		}
	}

	return folder, nil
}

// SaveProfile saves a profile to file (wrapper for external compatibility)
func (a *App) SaveProfile(profile *Profile) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()
	return a.saveProfileInternal(profile)
}

// SaveProfileFolder saves a profile folder to file (wrapper for external compatibility)
func (a *App) SaveProfileFolder(folder *ProfileFolder) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()
	return a.saveProfileFolderInternal(folder)
}

// CreateDefaultProfiles creates some default profiles if none exist
func (a *App) CreateDefaultProfiles() error {
	// Create Local Shells folder
	localFolder, err := a.CreateProfileFolder("Local Shells", "📁", "")
	if err != nil {
		return fmt.Errorf("failed to create Local Shells folder: %w", err)
	}

	// Create platform-appropriate default local profiles
	type defaultShell struct {
		name  string
		shell string
		icon  string
	}

	var defaultShells []defaultShell
	switch runtime.GOOS {
	case "windows":
		defaultShells = []defaultShell{
			{"PowerShell", "powershell", "💻"},
			{"Command Prompt", "cmd", "⚫"},
			{"PowerShell Core", "pwsh", "🔷"},
		}
	case "darwin":
		defaultShells = []defaultShell{
			{"Zsh", "zsh", "💻"},
			{"Bash", "bash", "⚫"},
		}
	default: // linux and other unix
		defaultShells = []defaultShell{
			{"Bash", "bash", "💻"},
			{"Zsh", "zsh", "⚫"},
		}
	}

	// Only create profiles for shells that are actually available
	availableShells := a.getAvailableShells()
	availableSet := make(map[string]bool)
	for _, s := range availableShells {
		availableSet[s] = true
	}

	for _, shell := range defaultShells {
		if !availableSet[shell.shell] {
			continue
		}
		_, err := a.CreateProfile(shell.name, "local", shell.shell, shell.icon, localFolder.Name)
		if err != nil {
			fmt.Printf("Warning: Failed to create default profile %s: %v\n", shell.name, err)
		}
	}

	// Create SSH Connections folder
	_, err = a.CreateProfileFolder("SSH Connections", "🌐", "")
	if err != nil {
		return fmt.Errorf("failed to create SSH Connections folder: %w", err)
	}

	// Create Development folder
	_, err = a.CreateProfileFolder("Development", "🛠️", "")
	if err != nil {
		return fmt.Errorf("failed to create Development folder: %w", err)
	}

	return nil
}
