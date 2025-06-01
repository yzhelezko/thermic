package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Profile Management API Methods

// GetProfileTreeAPI returns the profile tree structure for the frontend
func (a *App) GetProfileTreeAPI() []*ProfileTreeNode {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	// Build tree structure
	tree := make(map[string]*ProfileTreeNode)
	var rootNodes []*ProfileTreeNode

	// Add folders first
	for _, folder := range a.profileFolders {
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
	for _, profile := range a.profiles {
		node := &ProfileTreeNode{
			ID:      profile.ID,
			Name:    profile.Name,
			Icon:    profile.Icon,
			Type:    "profile",
			Path:    profile.FolderPath,
			Profile: profile,
		}

		// Find parent folder - prioritize ID-based reference over path-based
		var parentID string
		if profile.FolderID != "" {
			// Use new ID-based reference
			parentID = profile.FolderID
		} else if profile.FolderPath != "" {
			// Fall back to path-based reference for backward compatibility
			parentID = a.findFolderByPath(profile.FolderPath)
		}

		if parentID != "" && tree[parentID] != nil {
			tree[parentID].Children = append(tree[parentID].Children, node)
		} else {
			// Parent not found or profile is at root level
			rootNodes = append(rootNodes, node)
		}
	}

	// Add folders to their parents or root - prioritize ID-based reference over path-based
	for folderID, folder := range a.profileFolders {
		node := tree[folderID]

		var parentID string
		if folder.ParentFolderID != "" {
			// Use new ID-based reference
			parentID = folder.ParentFolderID
		} else if folder.ParentPath != "" {
			// Fall back to path-based reference for backward compatibility
			parentID = a.findFolderByPath(folder.ParentPath)
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

// CreateProfileAPI creates a new profile
func (a *App) CreateProfileAPI(name, profileType, shell, icon, folderPath string) (*Profile, error) {
	return a.CreateProfile(name, profileType, shell, icon, folderPath)
}

// CreateProfileFolderAPI creates a new profile folder
func (a *App) CreateProfileFolderAPI(name, icon, parentPath string) (*ProfileFolder, error) {
	return a.CreateProfileFolder(name, icon, parentPath)
}

// UpdateProfile updates an existing profile
func (a *App) UpdateProfile(profile *Profile) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()
	return a.saveProfileInternal(profile)
}

// UpdateProfileFolder updates an existing profile folder
func (a *App) UpdateProfileFolder(folder *ProfileFolder) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()
	return a.saveProfileFolderInternal(folder)
}

// DeleteProfileAPI deletes a profile
func (a *App) DeleteProfileAPI(id string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	profile, exists := a.profiles[id]
	if !exists {
		return fmt.Errorf("profile not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Temporarily stop the file watcher to prevent conflicts
	wasWatcherRunning := a.profileWatcher != nil
	if wasWatcherRunning {
		a.StopProfileWatcher()
	}

	// Find and delete the file
	filename := fmt.Sprintf("%s-%s.yaml", profile.Name, id)
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		// Restart watcher before returning error
		if wasWatcherRunning {
			go func() {
				if watchErr := a.StartProfileWatcher(); watchErr != nil {
					fmt.Printf("Warning: Failed to restart profile watcher: %v\n", watchErr)
				}
			}()
		}
		return fmt.Errorf("failed to delete profile file %s: %w", filePath, err)
	}

	// Remove from memory
	delete(a.profiles, id)

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

// DeleteProfileFolderAPI deletes a profile folder
func (a *App) DeleteProfileFolderAPI(id string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	folder, exists := a.profileFolders[id]
	if !exists {
		return fmt.Errorf("profile folder not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Temporarily stop the file watcher to prevent conflicts
	wasWatcherRunning := a.profileWatcher != nil
	if wasWatcherRunning {
		a.StopProfileWatcher()
	}

	// Find and delete the file
	filename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, id)
	filename = sanitizeFilename(filename)

	filePath := filepath.Join(profilesDir, filename)

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		// Restart watcher before returning error
		if wasWatcherRunning {
			go func() {
				if watchErr := a.StartProfileWatcher(); watchErr != nil {
					fmt.Printf("Warning: Failed to restart profile watcher: %v\n", watchErr)
				}
			}()
		}
		return fmt.Errorf("failed to delete profile folder file %s: %w", filePath, err)
	}

	// Remove from memory
	delete(a.profileFolders, id)

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

// GetProfile returns a specific profile by ID
func (a *App) GetProfile(id string) (*Profile, error) {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	profile, exists := a.profiles[id]
	if !exists {
		return nil, fmt.Errorf("profile not found: %s", id)
	}
	return profile, nil
}

// GetProfileFolder returns a specific profile folder by ID
func (a *App) GetProfileFolder(id string) (*ProfileFolder, error) {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	folder, exists := a.profileFolders[id]
	if !exists {
		return nil, fmt.Errorf("profile folder not found: %s", id)
	}
	return folder, nil
}

// MoveProfile moves a profile to a different folder
func (a *App) MoveProfile(profileID, newFolderPath string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	profile, exists := a.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile not found: %s", profileID)
	}

	// Update both path and ID references
	profile.FolderPath = newFolderPath
	profile.LastModified = time.Now()

	// If newFolderPath is provided, try to find the corresponding folder ID
	if newFolderPath != "" {
		folderID := a.findFolderByPath(newFolderPath)
		profile.FolderID = folderID
	} else {
		// Root level
		profile.FolderID = ""
	}

	return a.saveProfileInternal(profile)
}

// MoveProfileByID moves a profile to a different folder using folder ID
func (a *App) MoveProfileByID(profileID, targetFolderID string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	profile, exists := a.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile with ID %s not found", profileID)
	}

	// Validate target folder exists (empty string means root level)
	if targetFolderID != "" {
		if _, exists := a.profileFolders[targetFolderID]; !exists {
			return fmt.Errorf("target folder with ID %s not found", targetFolderID)
		}
	}

	// Update profile's folder reference
	profile.FolderID = targetFolderID
	profile.LastModified = time.Now()

	// Update legacy path for backward compatibility
	if targetFolderID != "" {
		profile.FolderPath = a.buildFolderPath(targetFolderID)
	} else {
		profile.FolderPath = ""
	}

	// Save the updated profile using internal function to avoid deadlock
	if err := a.saveProfileInternal(profile); err != nil {
		return fmt.Errorf("failed to save moved profile: %w", err)
	}

	return nil
}

// DuplicateProfile creates a copy of an existing profile
func (a *App) DuplicateProfile(profileID string) (*Profile, error) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	original, exists := a.profiles[profileID]
	if !exists {
		return nil, fmt.Errorf("profile not found: %s", profileID)
	}

	// Create a copy with new ID and name
	duplicate := *original
	duplicate.ID = generateID()
	duplicate.Name = original.Name + " (Copy)"
	duplicate.Created = time.Now()
	duplicate.LastModified = time.Now()

	if err := a.saveProfileInternal(&duplicate); err != nil {
		return nil, err
	}

	return &duplicate, nil
}

// DeleteProfileFolderWithContentsAPI deletes a profile folder and all profiles inside it
func (a *App) DeleteProfileFolderWithContentsAPI(id string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	folder, exists := a.profileFolders[id]
	if !exists {
		return fmt.Errorf("profile folder not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Delete all profiles in this folder first
	folderPath := a.buildFolderPath(id)
	profilesToDelete := make([]string, 0)

	// Collect profiles to delete
	for profileID, profile := range a.profiles {
		if strings.HasPrefix(profile.FolderPath, folderPath) {
			profilesToDelete = append(profilesToDelete, profileID)
		}
	}

	// Delete each profile file and remove from memory
	for _, profileID := range profilesToDelete {
		profile := a.profiles[profileID]

		// Delete profile file
		filename := fmt.Sprintf("%s-%s.yaml", profile.Name, profileID)
		filename = sanitizeFilename(filename)

		filePath := filepath.Join(profilesDir, filename)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Warning: Failed to delete profile file %s: %v\n", filePath, err)
		}

		// Remove from memory
		delete(a.profiles, profileID)
	}

	// Delete the folder file
	folderFilename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, id)
	folderFilename = sanitizeFilename(folderFilename)

	folderFilePath := filepath.Join(profilesDir, folderFilename)
	if err := os.Remove(folderFilePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile folder file: %w", err)
	}

	// Remove folder from memory
	delete(a.profileFolders, id)

	return nil
}

// Virtual Folder APIs
func (a *App) GetVirtualFoldersAPI() []*VirtualFolder {
	a.mutex.RLock()
	defer a.mutex.RUnlock()
	return a.virtualFolders
}

func (a *App) GetVirtualFolderProfilesAPI(folderID string) []*Profile {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	for _, vf := range a.virtualFolders {
		if vf.ID == folderID {
			return a.getVirtualFolderProfiles(vf)
		}
	}
	return []*Profile{}
}

// Enhanced Profile APIs
func (a *App) ToggleFavoriteAPI(profileID string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	profile, exists := a.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile not found: %s", profileID)
	}

	profile.IsFavorite = !profile.IsFavorite
	err := a.saveProfileInternal(profile)
	if err == nil {
		go a.saveMetrics()
	}
	return err
}

func (a *App) UpdateProfileTagsAPI(profileID string, tags []string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	profile, exists := a.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile not found: %s", profileID)
	}

	profile.Tags = tags
	err := a.saveProfileInternal(profile)
	if err == nil {
		go a.saveMetrics()
	}
	return err
}

func (a *App) SearchProfilesAPI(query string, tags []string) []*Profile {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	var results []*Profile
	query = strings.ToLower(query)

	for _, profile := range a.profiles {
		// Text search
		if query != "" {
			nameMatch := strings.Contains(strings.ToLower(profile.Name), query)
			descMatch := strings.Contains(strings.ToLower(profile.Description), query)
			if !nameMatch && !descMatch {
				continue
			}
		}

		// Tag filtering
		if len(tags) > 0 {
			hasAllTags := true
			for _, requiredTag := range tags {
				found := false
				for _, profileTag := range profile.Tags {
					if strings.EqualFold(profileTag, requiredTag) {
						found = true
						break
					}
				}
				if !found {
					hasAllTags = false
					break
				}
			}
			if !hasAllTags {
				continue
			}
		}

		results = append(results, profile)
	}

	// Sort by relevance (favorites first, then by usage)
	sort.Slice(results, func(i, j int) bool {
		if results[i].IsFavorite != results[j].IsFavorite {
			return results[i].IsFavorite
		}
		return results[i].UsageCount > results[j].UsageCount
	})

	return results
}

func (a *App) GetMetricsAPI() *ProfileMetrics {
	a.mutex.RLock()
	defer a.mutex.RUnlock()
	return a.metrics
}

func (a *App) GetPopularTagsAPI() []string {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	if a.metrics == nil || len(a.metrics.TagUsage) == 0 {
		return []string{}
	}

	// Sort tags by usage
	type tagCount struct {
		tag   string
		count int
	}

	var tags []tagCount
	for tag, count := range a.metrics.TagUsage {
		tags = append(tags, tagCount{tag, count})
	}

	sort.Slice(tags, func(i, j int) bool {
		return tags[i].count > tags[j].count
	})

	// Return top 20 tags
	var result []string
	for i, tc := range tags {
		if i >= 20 {
			break
		}
		result = append(result, tc.tag)
	}

	return result
}

// Enhanced Profile APIs with ID-based references
func (a *App) CreateProfileWithFolderIDAPI(name, profileType, shell, icon, folderID string) (*Profile, error) {
	return a.CreateProfileWithFolderID(name, profileType, shell, icon, folderID)
}

func (a *App) CreateProfileFolderWithParentIDAPI(name, icon, parentFolderID string) (*ProfileFolder, error) {
	return a.CreateProfileFolderWithParentID(name, icon, parentFolderID)
}

func (a *App) MoveProfileByIDAPI(profileID, targetFolderID string) error {
	return a.MoveProfileByID(profileID, targetFolderID)
}

func (a *App) MoveFolderAPI(folderID, targetParentFolderID string) error {
	return a.MoveFolder(folderID, targetParentFolderID)
}

func (a *App) GetFolderByIDAPI(folderID string) (*ProfileFolder, error) {
	return a.GetFolderByID(folderID)
}

func (a *App) GetProfileByIDAPI(profileID string) (*Profile, error) {
	return a.GetProfileByID(profileID)
}
