package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"gopkg.in/yaml.v2"
)

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

// GetProfilesDirectory returns the full path to the profiles directory
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

// InitializeProfiles sets up the profile management system
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

// LoadProfiles loads all profiles from the profiles directory
func (a *App) LoadProfiles() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Clear existing profiles
	a.profiles.profiles = make(map[string]*Profile)
	a.profiles.profileFolders = make(map[string]*ProfileFolder)

	// Walk through all files in profiles directory
	err = filepath.WalkDir(profilesDir, func(path string, d fs.DirEntry, err error) error {
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

		// Determine if it's a profile or folder based on filename pattern
		if strings.HasPrefix(name, "folder-") {
			// Load folder
			folder, err := a.LoadProfileFolder(path)
			if err != nil {
				fmt.Printf("Warning: Failed to load profile folder %s: %v\n", path, err)
				return nil // Continue loading other files
			}
			a.profiles.profileFolders[folder.ID] = folder
		} else {
			// Load profile
			profile, err := a.LoadProfile(path)
			if err != nil {
				fmt.Printf("Warning: Failed to load profile %s: %v\n", path, err)
				return nil // Continue loading other files
			}
			a.profiles.profiles[profile.ID] = profile
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to walk profiles directory: %w", err)
	}

	fmt.Printf("Loaded %d profiles and %d folders\n", len(a.profiles.profiles), len(a.profiles.profileFolders))
	return nil
}

// LoadProfile loads a single profile from file
func (a *App) LoadProfile(filePath string) (*Profile, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var profile Profile
	if err := yaml.Unmarshal(data, &profile); err != nil {
		return nil, err
	}

	return &profile, nil
}

// LoadProfileFolder loads a single profile folder from file
func (a *App) LoadProfileFolder(filePath string) (*ProfileFolder, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var folder ProfileFolder
	if err := yaml.Unmarshal(data, &folder); err != nil {
		return nil, err
	}

	return &folder, nil
}

// findProfileFile finds the existing file for a profile by ID
func (a *App) findProfileFile(profileID string) (string, error) {
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
		return "", err
	}

	return foundFile, nil
}

// findFolderFile finds the existing file for a folder by ID
func (a *App) findFolderFile(folderID string) (string, error) {
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
		return "", err
	}

	return foundFile, nil
}

// saveProfileInternal saves a profile to file without mutex locking (internal use)
func (a *App) saveProfileInternal(profile *Profile) error {
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
	// Sanitize filename
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)

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

// SaveProfile saves a profile to file
func (a *App) SaveProfile(profile *Profile) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()
	return a.saveProfileInternal(profile)
}

// saveProfileFolderInternal saves a profile folder to file without mutex locking (internal use)
func (a *App) saveProfileFolderInternal(folder *ProfileFolder) error {
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
	// Sanitize filename
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)

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

// SaveProfileFolder saves a profile folder to file
func (a *App) SaveProfileFolder(folder *ProfileFolder) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()
	return a.saveProfileFolderInternal(folder)
}

// CreateProfile creates a new profile
func (a *App) CreateProfile(name, profileType, shell, icon, folderPath string) (*Profile, error) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

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

	// If folderPath is provided, try to find the corresponding folder ID
	if folderPath != "" {
		folderID := a.findFolderByPath(folderPath)
		profile.FolderID = folderID
	}

	if err := a.saveProfileInternal(profile); err != nil {
		return nil, err
	}

	return profile, nil
}

// CreateProfileWithFolderID creates a new profile using folder ID reference
func (a *App) CreateProfileWithFolderID(name, profileType, shell, icon, folderID string) (*Profile, error) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	id := generateID()
	now := time.Now()

	// Validate folder exists if folderID is provided
	if folderID != "" {
		if _, exists := a.profiles.profileFolders[folderID]; !exists {
			return nil, fmt.Errorf("folder with ID %s not found", folderID)
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

	if err := a.saveProfileInternal(profile); err != nil {
		return nil, err
	}

	return profile, nil
}

// CreateProfileFolder creates a new profile folder
func (a *App) CreateProfileFolder(name, icon, parentPath string) (*ProfileFolder, error) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	id := generateID()
	now := time.Now()

	folder := &ProfileFolder{
		ID:           id,
		Name:         name,
		Icon:         icon,
		Expanded:     true,
		Created:      now,
		LastModified: now,
	}

	// If parentPath is provided, try to find the corresponding folder ID
	if parentPath != "" {
		parentFolderID := a.findFolderByPath(parentPath)
		folder.ParentFolderID = parentFolderID
	}

	if err := a.saveProfileFolderInternal(folder); err != nil {
		return nil, err
	}

	return folder, nil
}

// CreateProfileFolderWithParentID creates a new profile folder using parent folder ID reference
func (a *App) CreateProfileFolderWithParentID(name, icon, parentFolderID string) (*ProfileFolder, error) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	id := generateID()
	now := time.Now()

	// Validate parent folder exists if parentFolderID is provided
	if parentFolderID != "" {
		if _, exists := a.profiles.profileFolders[parentFolderID]; !exists {
			return nil, fmt.Errorf("parent folder with ID %s not found", parentFolderID)
		}
	}

	folder := &ProfileFolder{
		ID:             id,
		Name:           name,
		Icon:           icon,
		ParentFolderID: parentFolderID,
		Expanded:       true,
		Created:        now,
		LastModified:   now,
	}

	if err := a.saveProfileFolderInternal(folder); err != nil {
		return nil, err
	}

	return folder, nil
}

// DeleteProfile deletes a profile
func (a *App) DeleteProfile(id string) error {
	profile, exists := a.profiles.profiles[id]
	if !exists {
		return fmt.Errorf("profile not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Find and delete the file
	filename := fmt.Sprintf("%s-%s.yaml", profile.Name, id)
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile file: %w", err)
	}

	// Remove from memory
	delete(a.profiles.profiles, id)

	return nil
}

// DeleteProfileFolder deletes a profile folder
func (a *App) DeleteProfileFolder(id string) error {
	folder, exists := a.profiles.profileFolders[id]
	if !exists {
		return fmt.Errorf("profile folder not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Find and delete the file
	filename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, id)
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile folder file: %w", err)
	}

	// Move any profiles in this folder to root
	folderPath := a.buildFolderPath(id)
	for _, profile := range a.profiles.profiles {
		if strings.HasPrefix(a.buildFolderPath(profile.FolderID), folderPath) {
			// Remove this folder from the path
			newPath := strings.TrimPrefix(a.buildFolderPath(profile.FolderID), folderPath)
			newPath = strings.TrimPrefix(newPath, "/")
			profile.FolderID = newPath
			a.SaveProfile(profile)
		}
	}

	// Remove from memory
	delete(a.profiles.profileFolders, id)

	return nil
}

// GetProfileTree builds the profile tree for the frontend
func (a *App) GetProfileTree() []*ProfileTreeNode {
	// Build tree structure
	tree := make(map[string]*ProfileTreeNode)
	var rootNodes []*ProfileTreeNode

	// Add folders first
	for _, folder := range a.profiles.profileFolders {
		node := &ProfileTreeNode{
			ID:       folder.ID,
			Name:     folder.Name,
			Icon:     folder.Icon,
			Type:     "folder",
			Path:     a.buildFolderPath(folder.ID),
			Children: make([]*ProfileTreeNode, 0),
			Expanded: folder.Expanded,
		}
		tree[folder.ID] = node
	}

	// Add profiles
	for _, profile := range a.profiles.profiles {
		node := &ProfileTreeNode{
			ID:      profile.ID,
			Name:    profile.Name,
			Icon:    profile.Icon,
			Type:    "profile",
			Path:    a.buildFolderPath(profile.FolderID),
			Profile: profile,
		}

		// Find parent folder - prioritize ID-based reference over path-based
		var parentID string
		if profile.FolderID != "" {
			// Use new ID-based reference
			parentID = profile.FolderID
		}

		if parentID != "" && tree[parentID] != nil {
			tree[parentID].Children = append(tree[parentID].Children, node)
		} else {
			// Parent not found or profile is at root level
			rootNodes = append(rootNodes, node)
		}
	}

	// Add folders to their parents or root
	for folderID, folder := range a.profiles.profileFolders {
		node := tree[folderID]

		// Find parent folder - prioritize ID-based reference over path-based
		var parentID string
		if folder.ParentFolderID != "" {
			// Use new ID-based reference
			parentID = folder.ParentFolderID
		}

		if parentID != "" && tree[parentID] != nil {
			tree[parentID].Children = append(tree[parentID].Children, node)
		} else {
			// Parent not found or folder is at root level
			rootNodes = append(rootNodes, node)
		}
	}

	// Sort nodes
	a.sortTreeNodes(rootNodes)
	for _, node := range tree {
		a.sortTreeNodes(node.Children)
	}

	return rootNodes
}

// Helper functions

func (a *App) buildFolderPath(folderID string) string {
	folder, exists := a.profiles.profileFolders[folderID]
	if !exists {
		return ""
	}

	if folder.ParentFolderID == "" {
		return folder.Name
	}

	return a.buildFolderPath(folder.ParentFolderID) + "/" + folder.Name
}

func (a *App) findFolderByPath(path string) string {
	for id := range a.profiles.profileFolders {
		if a.buildFolderPath(id) == path {
			return id
		}
	}
	return ""
}

func (a *App) sortTreeNodes(nodes []*ProfileTreeNode) {
	sort.Slice(nodes, func(i, j int) bool {
		// Folders first, then profiles
		if nodes[i].Type != nodes[j].Type {
			return nodes[i].Type == "folder"
		}
		// Then by name
		return nodes[i].Name < nodes[j].Name
	})
}

func generateID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// CreateDefaultProfiles creates some default profiles if none exist
func (a *App) CreateDefaultProfiles() error {
	// Create Local Shells folder
	localFolder, err := a.CreateProfileFolder("Local Shells", "📁", "")
	if err != nil {
		return err
	}

	// Create some default local profiles
	defaultShells := []struct {
		name  string
		shell string
		icon  string
	}{
		{"PowerShell", "powershell.exe", "💻"},
		{"Command Prompt", "cmd.exe", "⚫"},
		{"PowerShell Core", "pwsh.exe", "🔷"},
	}

	for _, shell := range defaultShells {
		_, err := a.CreateProfile(shell.name, "local", shell.shell, shell.icon, localFolder.Name)
		if err != nil {
			fmt.Printf("Warning: Failed to create default profile %s: %v\n", shell.name, err)
		}
	}

	// Create SSH Connections folder
	_, err = a.CreateProfileFolder("SSH Connections", "🌐", "")
	if err != nil {
		return err
	}

	// Create Development folder
	_, err = a.CreateProfileFolder("Development", "🛠️", "")
	if err != nil {
		return err
	}

	return nil
}

// StartProfileWatcher starts monitoring profile files for changes
func (a *App) StartProfileWatcher() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("failed to create file watcher: %w", err)
	}

	// Watch the profiles directory
	err = watcher.Add(profilesDir)
	if err != nil {
		watcher.Close()
		return fmt.Errorf("failed to watch profiles directory: %w", err)
	}

	a.profiles.profileWatcher = &ProfileWatcher{
		watchDir:    profilesDir,
		stopChan:    make(chan bool),
		updatesChan: make(chan ProfileUpdate, 10),
		manager:     a.profiles,
	}

	// Start watcher goroutine
	go func() {
		defer watcher.Close()
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				a.handleProfileFileEvent(event)

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				fmt.Printf("Profile watcher error: %v\n", err)

			case <-a.profiles.profileWatcher.stopChan:
				return
			}
		}
	}()

	fmt.Println("Profile file watcher started")
	return nil
}

// StopProfileWatcher stops the profile file watcher
func (a *App) StopProfileWatcher() {
	if a.profiles.profileWatcher != nil {
		close(a.profiles.profileWatcher.stopChan)
		a.profiles.profileWatcher = nil
		fmt.Println("Profile file watcher stopped")
	}
}

// handleProfileFileEvent processes file system events for profile files
func (a *App) handleProfileFileEvent(event fsnotify.Event) {
	// Only process YAML files
	if !strings.HasSuffix(strings.ToLower(event.Name), ".yaml") {
		return
	}

	filename := filepath.Base(event.Name)

	// Skip metrics file - it's not a profile or folder
	if filename == "metrics.yaml" {
		return
	}
	var updateType string
	var profileID string

	// Determine event type
	switch {
	case event.Op&fsnotify.Create == fsnotify.Create:
		updateType = "created"
	case event.Op&fsnotify.Write == fsnotify.Write:
		updateType = "modified"
	case event.Op&fsnotify.Remove == fsnotify.Remove:
		updateType = "deleted"
	default:
		return // Ignore other events
	}

	// Extract profile ID from filename
	if strings.HasPrefix(filename, "folder-") {
		// Folder file: folder-Name-ID.yaml
		parts := strings.Split(filename, "-")
		if len(parts) >= 2 {
			id := strings.TrimSuffix(parts[len(parts)-1], ".yaml")
			profileID = id
		}
	} else {
		// Profile file: Name-ID.yaml
		parts := strings.Split(filename, "-")
		if len(parts) >= 2 {
			id := strings.TrimSuffix(parts[len(parts)-1], ".yaml")
			profileID = id
		}
	}

	if profileID == "" {
		return
	}

	// Handle the update
	switch updateType {
	case "created", "modified":
		// Reload the specific file
		if strings.HasPrefix(filename, "folder-") {
			folder, err := a.LoadProfileFolder(event.Name)
			if err == nil {
				a.profiles.profileFolders[folder.ID] = folder
			}
		} else {
			profile, err := a.LoadProfile(event.Name)
			if err == nil {
				a.profiles.profiles[profile.ID] = profile
			}
		}

	case "deleted":
		// Remove from memory
		if strings.HasPrefix(filename, "folder-") {
			delete(a.profiles.profileFolders, profileID)
		} else {
			delete(a.profiles.profiles, profileID)
		}
	}

	// Notify frontend if context is available
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "profile:updated", ProfileUpdate{
			Type:      updateType,
			FilePath:  event.Name,
			ProfileID: profileID,
		})
	}

	fmt.Printf("Profile file %s: %s\n", updateType, filename)
}

// Virtual Folder Management
func (a *App) initializeVirtualFolders() {
	a.profiles.virtualFolders = []*VirtualFolder{
		{
			ID:   "vf_favorites",
			Name: "Favorites",
			Icon: "⭐",
			Type: "favorites",
			Filter: VirtualFilter{
				Type:      "favorite",
				SortBy:    "lastUsed",
				SortOrder: "desc",
				Limit:     20,
			},
		},
		{
			ID:   "vf_recent",
			Name: "Recent",
			Icon: "🕐",
			Type: "recent",
			Filter: VirtualFilter{
				Type:      "recent",
				SortBy:    "lastUsed",
				SortOrder: "desc",
				Limit:     10,
				DateRange: 30,
			},
		},
		{
			ID:   "vf_most_used",
			Name: "Most Used",
			Icon: "📈",
			Type: "usage",
			Filter: VirtualFilter{
				Type:      "usage",
				SortBy:    "usage",
				SortOrder: "desc",
				Limit:     15,
			},
		},
	}
}

func (a *App) getVirtualFolderProfiles(vf *VirtualFolder) []*Profile {
	var profiles []*Profile

	for _, profile := range a.profiles.profiles {
		switch vf.Filter.Type {
		case "favorite":
			if profile.IsFavorite {
				profiles = append(profiles, profile)
			}
		case "recent":
			if !profile.LastUsed.IsZero() {
				days := int(time.Since(profile.LastUsed).Hours() / 24)
				if days <= vf.Filter.DateRange {
					profiles = append(profiles, profile)
				}
			}
		case "usage":
			if profile.UsageCount > 0 {
				profiles = append(profiles, profile)
			}
		}
	}

	// Sort profiles based on filter criteria
	sort.Slice(profiles, func(i, j int) bool {
		switch vf.Filter.SortBy {
		case "lastUsed":
			if vf.Filter.SortOrder == "desc" {
				return profiles[i].LastUsed.After(profiles[j].LastUsed)
			}
			return profiles[i].LastUsed.Before(profiles[j].LastUsed)
		case "usage":
			if vf.Filter.SortOrder == "desc" {
				return profiles[i].UsageCount > profiles[j].UsageCount
			}
			return profiles[i].UsageCount < profiles[j].UsageCount
		case "name":
			if vf.Filter.SortOrder == "desc" {
				return profiles[i].Name > profiles[j].Name
			}
			return profiles[i].Name < profiles[j].Name
		default:
			return profiles[i].Name < profiles[j].Name
		}
	})

	// Limit results
	if vf.Filter.Limit > 0 && len(profiles) > vf.Filter.Limit {
		profiles = profiles[:vf.Filter.Limit]
	}

	return profiles
}

func (a *App) updateProfileUsage(profileID string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile not found: %s", profileID)
	}

	profile.LastUsed = time.Now()
	profile.UsageCount++

	// Save the updated profile using internal function to avoid deadlock
	err := a.saveProfileInternal(profile)
	if err == nil {
		// Also update metrics asynchronously
		go a.saveMetrics()
	}
	return err
}

func (a *App) saveMetrics() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	metricsPath := filepath.Join(profilesDir, "metrics.yaml")

	// Update metrics
	if a.profiles.metrics == nil {
		a.profiles.metrics = &ProfileMetrics{}
	}

	a.profiles.metrics.TotalProfiles = len(a.profiles.profiles)
	a.profiles.metrics.TotalFolders = len(a.profiles.profileFolders)
	a.profiles.metrics.LastSync = time.Now()

	// Update most used and recent profiles
	var allProfiles []*Profile
	for _, profile := range a.profiles.profiles {
		allProfiles = append(allProfiles, profile)
	}

	// Sort by usage
	sort.Slice(allProfiles, func(i, j int) bool {
		return allProfiles[i].UsageCount > allProfiles[j].UsageCount
	})

	a.profiles.metrics.MostUsedProfiles = []string{}
	for i, profile := range allProfiles {
		if i >= 10 { // Top 10
			break
		}
		if profile.UsageCount > 0 {
			a.profiles.metrics.MostUsedProfiles = append(a.profiles.metrics.MostUsedProfiles, profile.ID)
		}
	}

	// Sort by last used
	sort.Slice(allProfiles, func(i, j int) bool {
		return allProfiles[i].LastUsed.After(allProfiles[j].LastUsed)
	})

	a.profiles.metrics.RecentProfiles = []string{}
	for i, profile := range allProfiles {
		if i >= 10 { // Top 10
			break
		}
		if !profile.LastUsed.IsZero() {
			a.profiles.metrics.RecentProfiles = append(a.profiles.metrics.RecentProfiles, profile.ID)
		}
	}

	// Update favorites
	a.profiles.metrics.FavoriteProfiles = []string{}
	for _, profile := range a.profiles.profiles {
		if profile.IsFavorite {
			a.profiles.metrics.FavoriteProfiles = append(a.profiles.metrics.FavoriteProfiles, profile.ID)
		}
	}

	// Update tag usage
	a.profiles.metrics.TagUsage = make(map[string]int)
	for _, profile := range a.profiles.profiles {
		for _, tag := range profile.Tags {
			a.profiles.metrics.TagUsage[tag]++
		}
	}

	// Save to YAML file
	data, err := yaml.Marshal(a.profiles.metrics)
	if err != nil {
		return err
	}

	return os.WriteFile(metricsPath, data, 0644)
}

func (a *App) loadMetrics() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	metricsPath := filepath.Join(profilesDir, "metrics.yaml")

	if _, err := os.Stat(metricsPath); os.IsNotExist(err) {
		a.profiles.metrics = &ProfileMetrics{}
		return nil
	}

	data, err := os.ReadFile(metricsPath)
	if err != nil {
		return err
	}

	a.profiles.metrics = &ProfileMetrics{}
	return yaml.Unmarshal(data, a.profiles.metrics)
}

// MoveFolder moves a folder to a different parent folder by ID
func (a *App) MoveFolder(folderID, targetParentFolderID string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	folder, exists := a.profiles.profileFolders[folderID]
	if !exists {
		return fmt.Errorf("folder with ID %s not found", folderID)
	}

	// Validate target parent folder exists (empty string means root level)
	if targetParentFolderID != "" {
		if _, exists := a.profiles.profileFolders[targetParentFolderID]; !exists {
			return fmt.Errorf("target parent folder with ID %s not found", targetParentFolderID)
		}

		// Prevent moving folder into itself or its descendants
		if a.isFolderDescendant(targetParentFolderID, folderID) {
			return fmt.Errorf("cannot move folder into itself or its descendants")
		}
	}

	// Update folder's parent reference
	folder.ParentFolderID = targetParentFolderID
	folder.LastModified = time.Now()

	// Save the updated folder using internal function to avoid deadlock
	if err := a.saveProfileFolderInternal(folder); err != nil {
		return fmt.Errorf("failed to save moved folder: %w", err)
	}

	// Update all child profiles and folders to maintain path consistency
	a.updateChildrenPaths(folderID)

	return nil
}

// isFolderDescendant checks if candidateParentID is a descendant of folderID
func (a *App) isFolderDescendant(candidateParentID, folderID string) bool {
	if candidateParentID == folderID {
		return true
	}

	candidateParent, exists := a.profiles.profileFolders[candidateParentID]
	if !exists {
		return false
	}

	// Check if the candidate parent's parent is the folder we're checking
	if candidateParent.ParentFolderID != "" {
		return a.isFolderDescendant(candidateParent.ParentFolderID, folderID)
	}

	return false
}

// updateChildrenPaths updates legacy paths for all children of a moved folder
func (a *App) updateChildrenPaths(folderID string) {
	// Update child folders
	for _, childFolder := range a.profiles.profileFolders {
		if childFolder.ParentFolderID == folderID {
			childFolder.LastModified = time.Now()
			a.saveProfileFolderInternal(childFolder)
			// Recursively update grandchildren
			a.updateChildrenPaths(childFolder.ID)
		}
	}

	// Update child profiles
	for _, profile := range a.profiles.profiles {
		if profile.FolderID == folderID {
			profile.LastModified = time.Now()
			a.saveProfileInternal(profile)
		}
	}
}

// GetFolderByID retrieves a folder by its ID
func (a *App) GetFolderByID(folderID string) (*ProfileFolder, error) {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	folder, exists := a.profiles.profileFolders[folderID]
	if !exists {
		return nil, fmt.Errorf("folder with ID %s not found", folderID)
	}

	return folder, nil
}

// GetProfileByID retrieves a profile by its ID
func (a *App) GetProfileByID(profileID string) (*Profile, error) {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return nil, fmt.Errorf("profile with ID %s not found", profileID)
	}

	return profile, nil
}
