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
	// Use the safer implementation from profile_tree.go
	return a.GetProfileTree()
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
	// Validate profile before updating
	if err := profile.Validate(); err != nil {
		return fmt.Errorf("invalid profile: %w", err)
	}

	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()
	return a.saveProfileInternal(profile)
}

// UpdateProfileFolder updates an existing profile folder
func (a *App) UpdateProfileFolder(folder *ProfileFolder) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()
	return a.saveProfileFolderInternal(folder)
}

// DeleteProfileAPI deletes a profile
func (a *App) DeleteProfileAPI(id string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	profile, exists := a.profiles.profiles[id]
	if !exists {
		return fmt.Errorf("profile not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	filename := fmt.Sprintf("%s-%s.yaml", profile.Name, id)
	filename = sanitizeFilename(filename)
	filePath := filepath.Join(profilesDir, filename)

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile file %s: %w", filePath, err)
	}

	delete(a.profiles.profiles, id)
	return nil
}

// DeleteProfileFolderAPI deletes a profile folder
func (a *App) DeleteProfileFolderAPI(id string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	folder, exists := a.profiles.profileFolders[id]
	if !exists {
		return fmt.Errorf("profile folder not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	filename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, id)
	filename = sanitizeFilename(filename)
	filePath := filepath.Join(profilesDir, filename)

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile folder file %s: %w", filePath, err)
	}

	delete(a.profiles.profileFolders, id)
	return nil
}

// GetProfile returns a specific profile by ID
func (a *App) GetProfile(id string) (*Profile, error) {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	profile, exists := a.profiles.profiles[id]
	if !exists {
		return nil, fmt.Errorf("profile not found: %s", id)
	}
	return profile, nil
}

// GetProfileFolder returns a specific profile folder by ID
func (a *App) GetProfileFolder(id string) (*ProfileFolder, error) {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	folder, exists := a.profiles.profileFolders[id]
	if !exists {
		return nil, fmt.Errorf("profile folder not found: %s", id)
	}
	return folder, nil
}

// MoveProfile moves a profile to a different folder
func (a *App) MoveProfile(profileID, newFolderPath string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile not found: %s", profileID)
	}

	// Update both path and ID references
	profile.LastModified = time.Now()

	// If newFolderPath is provided, try to find the corresponding folder ID
	if newFolderPath != "" {
		folderID := a.findFolderByPathLockFree(newFolderPath)
		profile.FolderID = folderID
	} else {
		// Root level
		profile.FolderID = ""
	}

	return a.saveProfileInternal(profile)
}

// MoveProfileByID moves a profile to a different folder using folder ID
func (a *App) MoveProfileByID(profileID, targetFolderID string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile with ID %s not found", profileID)
	}

	// Validate target folder exists (empty string means root level)
	if targetFolderID != "" {
		if _, exists := a.profiles.profileFolders[targetFolderID]; !exists {
			return fmt.Errorf("target folder with ID %s not found", targetFolderID)
		}
	}

	// Update profile's folder reference
	profile.FolderID = targetFolderID
	profile.LastModified = time.Now()

	// Update legacy path for backward compatibility
	if targetFolderID != "" {
		profile.FolderID = targetFolderID
	} else {
		profile.FolderID = ""
	}

	// Save the updated profile using internal function to avoid deadlock
	if err := a.saveProfileInternal(profile); err != nil {
		return fmt.Errorf("failed to save moved profile: %w", err)
	}

	return nil
}

// DuplicateProfile creates a copy of an existing profile
func (a *App) DuplicateProfile(profileID string) (*Profile, error) {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	original, exists := a.profiles.profiles[profileID]
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
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	folder, exists := a.profiles.profileFolders[id]
	if !exists {
		return fmt.Errorf("profile folder not found: %s", id)
	}

	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return err
	}

	// Delete all profiles in this folder first
	folderPath := a.buildFolderPathLockFree(id, 0)
	profilesToDelete := make([]string, 0)

	// Collect profiles to delete
	for profileID, profile := range a.profiles.profiles {
		if strings.HasPrefix(a.buildFolderPathLockFree(profile.FolderID, 0), folderPath) {
			profilesToDelete = append(profilesToDelete, profileID)
		}
	}

	// Delete each profile file and remove from memory
	for _, profileID := range profilesToDelete {
		profile := a.profiles.profiles[profileID]

		// Delete profile file
		filename := fmt.Sprintf("%s-%s.yaml", profile.Name, profileID)
		filename = sanitizeFilename(filename)

		filePath := filepath.Join(profilesDir, filename)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Warning: Failed to delete profile file %s: %v\n", filePath, err)
		}

		// Remove from memory
		delete(a.profiles.profiles, profileID)
	}

	// Delete the folder file
	folderFilename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, id)
	folderFilename = sanitizeFilename(folderFilename)

	folderFilePath := filepath.Join(profilesDir, folderFilename)
	if err := os.Remove(folderFilePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile folder file: %w", err)
	}

	// Remove folder from memory
	delete(a.profiles.profileFolders, id)

	return nil
}

// Virtual Folder APIs
func (a *App) GetVirtualFoldersAPI() []*VirtualFolder {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()
	return a.profiles.virtualFolders
}

func (a *App) GetVirtualFolderProfilesAPI(folderID string) []*Profile {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	for _, vf := range a.profiles.virtualFolders {
		if vf.ID == folderID {
			return a.getVirtualFolderProfiles(vf)
		}
	}
	return []*Profile{}
}

// Enhanced Profile APIs
func (a *App) ToggleFavoriteAPI(profileID string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	profile, exists := a.profiles.profiles[profileID]
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
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return fmt.Errorf("profile not found: %s", profileID)
	}

	// Validate tag limits
	if len(tags) > MaxTagsPerProfile {
		return fmt.Errorf("too many tags: %d, maximum allowed: %d", len(tags), MaxTagsPerProfile)
	}

	profile.Tags = tags
	err := a.saveProfileInternal(profile)
	if err == nil {
		go a.saveMetrics()
	}
	return err
}

func (a *App) SearchProfilesAPI(query string, tags []string) []*Profile {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	var results []*Profile
	query = strings.ToLower(query)

	for _, profile := range a.profiles.profiles {
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
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()
	return a.profiles.metrics
}

func (a *App) GetPopularTagsAPI() []string {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	if a.profiles.metrics == nil || len(a.profiles.metrics.TagUsage) == 0 {
		return []string{}
	}

	// Sort tags by usage
	type tagCount struct {
		tag   string
		count int
	}

	var tags []tagCount
	for tag, count := range a.profiles.metrics.TagUsage {
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

// SetFolderExpandedAPI updates a folder's expanded state in memory only (no disk write).
// This avoids the file watcher triggering a full reload on every folder toggle.
// The state is persisted to disk on shutdown via SaveAllFolderStates.
func (a *App) SetFolderExpandedAPI(folderID string, expanded bool) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	folder, exists := a.profiles.profileFolders[folderID]
	if !exists {
		return fmt.Errorf("profile folder not found: %s", folderID)
	}

	folder.Expanded = expanded
	return nil
}

// SaveAllFolderStates persists all folder states to disk.
// Called during shutdown to flush in-memory expanded states.
func (a *App) SaveAllFolderStates() {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	for _, folder := range a.profiles.profileFolders {
		if err := a.saveProfileFolderInternal(folder); err != nil {
			fmt.Printf("Warning: Failed to save folder %s state: %v\n", folder.Name, err)
		}
	}
}
