package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// buildFolderPath builds the full path for a folder by recursively traversing parent folders
func (a *App) buildFolderPath(folderID string) string {
	return a.buildFolderPathWithDepth(folderID, 0)
}

// buildFolderPathWithDepth prevents infinite recursion with depth tracking
func (a *App) buildFolderPathWithDepth(folderID string, depth int) string {
	if folderID == "" {
		return ""
	}

	// Prevent infinite recursion - max folder depth of 20
	if depth > 20 {
		fmt.Printf("Warning: Maximum folder depth exceeded for folder ID: %s\n", folderID)
		return ""
	}

	a.profiles.mutex.RLock()
	folder, exists := a.profiles.profileFolders[folderID]
	a.profiles.mutex.RUnlock()

	if !exists {
		return ""
	}

	if folder.ParentFolderID == "" {
		return folder.Name
	}

	// Check for circular reference
	if folder.ParentFolderID == folderID {
		fmt.Printf("Warning: Circular folder reference detected for folder ID: %s\n", folderID)
		return folder.Name
	}

	parentPath := a.buildFolderPathWithDepth(folder.ParentFolderID, depth+1)
	if parentPath == "" {
		return folder.Name
	}

	return parentPath + "/" + folder.Name
}

// findFolderByPath finds a folder ID by its full path
func (a *App) findFolderByPath(path string) string {
	if path == "" {
		return ""
	}

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	// Use a timeout to prevent hanging on problematic folder structures
	done := make(chan string, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("Warning: Panic in findFolderByPath for path '%s': %v\n", path, r)
				done <- ""
			}
		}()

		for id := range a.profiles.profileFolders {
			folderPath := a.buildFolderPath(id)
			if folderPath == path {
				done <- id
				return
			}
		}
		done <- ""
	}()

	select {
	case result := <-done:
		return result
	case <-time.After(5 * time.Second):
		fmt.Printf("Warning: Timeout finding folder by path: %s\n", path)
		return ""
	}
}

// GetProfileTree builds the profile tree for the frontend with enhanced organization
func (a *App) GetProfileTree() []*ProfileTreeNode {
	a.profiles.mutex.RLock()

	// Create local copies to avoid holding lock during path building
	profiles := make(map[string]*Profile)
	folders := make(map[string]*ProfileFolder)

	for k, v := range a.profiles.profiles {
		profiles[k] = v
	}
	for k, v := range a.profiles.profileFolders {
		folders[k] = v
	}

	a.profiles.mutex.RUnlock()

	// Debug logging
	fmt.Printf("DEBUG: GetProfileTree - Found %d profiles and %d folders\n", len(profiles), len(folders))
	for id, folder := range folders {
		fmt.Printf("DEBUG: Folder: %s (ID: %s, Parent: %s)\n", folder.Name, id, folder.ParentFolderID)
	}

	// Build tree structure without holding locks
	tree := make(map[string]*ProfileTreeNode)
	var rootNodes []*ProfileTreeNode

	// Add folders first
	for _, folder := range folders {
		if folder == nil {
			fmt.Printf("DEBUG: Skipping nil folder\n")
			continue
		}

		node := &ProfileTreeNode{
			ID:       folder.ID,
			Name:     folder.Name,
			Icon:     folder.Icon,
			Type:     TreeNodeTypeFolder,
			Path:     a.buildFolderPath(folder.ID),
			Children: make([]*ProfileTreeNode, 0),
			Expanded: folder.Expanded,
		}
		tree[folder.ID] = node
		fmt.Printf("DEBUG: Added folder node %s to tree\n", folder.Name)
	}

	// Add profiles
	for _, profile := range profiles {
		node := &ProfileTreeNode{
			ID:      profile.ID,
			Name:    profile.Name,
			Icon:    profile.Icon,
			Type:    TreeNodeTypeProfile,
			Path:    a.buildFolderPath(profile.FolderID),
			Profile: profile,
		}

		// Find parent folder - prioritize ID-based reference
		var parentID string
		if profile.FolderID != "" {
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
	for folderID, folder := range folders {
		node := tree[folderID]

		if node == nil {
			fmt.Printf("DEBUG: ERROR: No tree node found for folder %s (ID: %s)\n", folder.Name, folderID)
			continue
		}

		// Find parent folder - prioritize ID-based reference
		var parentID string
		if folder.ParentFolderID != "" {
			parentID = folder.ParentFolderID
		}

		fmt.Printf("DEBUG: Processing folder %s (ID: %s, ParentID: %s)\n", folder.Name, folderID, parentID)

		if parentID != "" && tree[parentID] != nil {
			tree[parentID].Children = append(tree[parentID].Children, node)
			fmt.Printf("DEBUG: Added folder %s as child of %s\n", folder.Name, parentID)
		} else {
			// Parent not found or folder is at root level
			rootNodes = append(rootNodes, node)
			fmt.Printf("DEBUG: Added folder %s to root (parent %s not found or empty)\n", folder.Name, parentID)
		}
	}

	// Sort nodes
	a.sortTreeNodes(rootNodes)
	for _, node := range tree {
		a.sortTreeNodes(node.Children)
	}

	// Debug logging for final result
	fmt.Printf("DEBUG: GetProfileTree returning %d root nodes\n", len(rootNodes))
	for i, node := range rootNodes {
		fmt.Printf("DEBUG: Root node %d: %s (Type: %s, Children: %d)\n", i, node.Name, node.Type, len(node.Children))
	}

	return rootNodes
}

// sortTreeNodes sorts tree nodes with folders first, then by name
func (a *App) sortTreeNodes(nodes []*ProfileTreeNode) {
	if nodes == nil || len(nodes) == 0 {
		return
	}

	sort.Slice(nodes, func(i, j int) bool {
		// Safety check for nil nodes
		if nodes[i] == nil {
			return false
		}
		if nodes[j] == nil {
			return true
		}

		// Folders first, then profiles
		if nodes[i].Type != nodes[j].Type {
			return nodes[i].Type == TreeNodeTypeFolder
		}
		// Then by name
		return nodes[i].Name < nodes[j].Name
	})
}

// MoveFolder moves a folder to a different parent folder by ID with validation
func (a *App) MoveFolder(folderID, targetParentFolderID string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	folder, exists := a.profiles.profileFolders[folderID]
	if !exists {
		return &ProfileError{
			Op:        "move",
			ProfileID: folderID,
			Err:       fmt.Errorf("folder not found"),
		}
	}

	// Validate target parent folder exists (empty string means root level)
	if targetParentFolderID != "" {
		if _, exists := a.profiles.profileFolders[targetParentFolderID]; !exists {
			return &ProfileError{
				Op:        "move",
				ProfileID: folderID,
				Err:       fmt.Errorf("target parent folder with ID %s not found", targetParentFolderID),
			}
		}

		// Prevent moving folder into itself or its descendants
		if a.isFolderDescendant(targetParentFolderID, folderID) {
			return &ProfileError{
				Op:        "move",
				ProfileID: folderID,
				Err:       fmt.Errorf("cannot move folder into itself or its descendants"),
			}
		}
	}

	// Update folder's parent reference
	folder.ParentFolderID = targetParentFolderID
	folder.LastModified = time.Now()

	// Save the updated folder using internal function to avoid deadlock
	if err := a.saveProfileFolderInternal(folder); err != nil {
		return &ProfileError{
			Op:        "move",
			ProfileID: folderID,
			Err:       fmt.Errorf("failed to save moved folder: %w", err),
		}
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

// updateChildrenPaths updates paths for all children of a moved folder
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

// initializeVirtualFolders sets up virtual folders for smart organization
func (a *App) initializeVirtualFolders() {
	a.profiles.virtualFolders = []*VirtualFolder{
		{
			ID:   "vf_favorites",
			Name: "Favorites",
			Icon: "⭐",
			Type: "favorite",
			Filter: VirtualFilter{
				Type:      "favorite",
				SortBy:    "name",
				SortOrder: "asc",
			},
		},
		{
			ID:   "vf_recent",
			Name: "Recent",
			Icon: "🕒",
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

// getVirtualFolderProfiles retrieves profiles for a virtual folder with filtering
func (a *App) getVirtualFolderProfiles(vf *VirtualFolder) []*Profile {
	var profiles []*Profile

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

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
		case "tag":
			for _, tag := range profile.Tags {
				if strings.EqualFold(tag, vf.Filter.Value) {
					profiles = append(profiles, profile)
					break
				}
			}
		case "type":
			if strings.EqualFold(profile.Type, vf.Filter.Value) {
				profiles = append(profiles, profile)
			}
		case "search":
			searchTerm := strings.ToLower(vf.Filter.Value)
			if strings.Contains(strings.ToLower(profile.Name), searchTerm) ||
				strings.Contains(strings.ToLower(profile.Description), searchTerm) {
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
		case "created":
			if vf.Filter.SortOrder == "desc" {
				return profiles[i].Created.After(profiles[j].Created)
			}
			return profiles[i].Created.Before(profiles[j].Created)
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

// GetVirtualFolders returns all virtual folders
func (a *App) GetVirtualFolders() []*VirtualFolder {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	return a.profiles.virtualFolders
}

// CreateVirtualFolder creates a new virtual folder with validation
func (a *App) CreateVirtualFolder(name, icon, folderType string, filter VirtualFilter) (*VirtualFolder, error) {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	// Check limits
	if len(a.profiles.virtualFolders) >= MaxVirtualFolders {
		return nil, fmt.Errorf("virtual folder limit reached (%d)", MaxVirtualFolders)
	}

	// Validate inputs
	if name == "" {
		return nil, fmt.Errorf("virtual folder name cannot be empty")
	}

	vf := &VirtualFolder{
		ID:     generateID(),
		Name:   name,
		Icon:   icon,
		Type:   folderType,
		Filter: filter,
	}

	a.profiles.virtualFolders = append(a.profiles.virtualFolders, vf)

	return vf, nil
}

// UpdateVirtualFolder updates an existing virtual folder
func (a *App) UpdateVirtualFolder(folderID string, name, icon string, filter VirtualFilter) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	for i, vf := range a.profiles.virtualFolders {
		if vf.ID == folderID {
			a.profiles.virtualFolders[i].Name = name
			a.profiles.virtualFolders[i].Icon = icon
			a.profiles.virtualFolders[i].Filter = filter
			return nil
		}
	}

	return fmt.Errorf("virtual folder not found: %s", folderID)
}

// DeleteVirtualFolder removes a virtual folder
func (a *App) DeleteVirtualFolder(folderID string) error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	for i, vf := range a.profiles.virtualFolders {
		if vf.ID == folderID {
			// Remove from slice
			a.profiles.virtualFolders = append(
				a.profiles.virtualFolders[:i],
				a.profiles.virtualFolders[i+1:]...,
			)
			return nil
		}
	}

	return fmt.Errorf("virtual folder not found: %s", folderID)
}

// SearchProfiles searches profiles by name, description, and tags
func (a *App) SearchProfiles(query string, tags []string) []*Profile {
	if query == "" && len(tags) == 0 {
		return []*Profile{}
	}

	var results []*Profile
	queryLower := strings.ToLower(query)

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	for _, profile := range a.profiles.profiles {
		match := false

		// Text search
		if query != "" {
			if strings.Contains(strings.ToLower(profile.Name), queryLower) ||
				strings.Contains(strings.ToLower(profile.Description), queryLower) ||
				strings.Contains(strings.ToLower(profile.Shell), queryLower) {
				match = true
			}
		}

		// Tag search
		if len(tags) > 0 {
			for _, searchTag := range tags {
				for _, profileTag := range profile.Tags {
					if strings.EqualFold(profileTag, searchTag) {
						match = true
						break
					}
				}
				if match {
					break
				}
			}
		}

		if match {
			results = append(results, profile)
		}
	}

	// Sort by relevance (name matches first, then description, then tags)
	sort.Slice(results, func(i, j int) bool {
		iName := strings.Contains(strings.ToLower(results[i].Name), queryLower)
		jName := strings.Contains(strings.ToLower(results[j].Name), queryLower)

		if iName && !jName {
			return true
		}
		if !iName && jName {
			return false
		}

		// If both or neither match name, sort alphabetically
		return results[i].Name < results[j].Name
	})

	return results
}

// GetProfilesByTag returns all profiles with a specific tag
func (a *App) GetProfilesByTag(tag string) []*Profile {
	if tag == "" {
		return []*Profile{}
	}

	var results []*Profile

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	for _, profile := range a.profiles.profiles {
		for _, profileTag := range profile.Tags {
			if strings.EqualFold(profileTag, tag) {
				results = append(results, profile)
				break
			}
		}
	}

	// Sort alphabetically
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results
}

// GetProfilesByType returns all profiles of a specific type
func (a *App) GetProfilesByType(profileType string) []*Profile {
	if profileType == "" {
		return []*Profile{}
	}

	var results []*Profile

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	for _, profile := range a.profiles.profiles {
		if strings.EqualFold(profile.Type, profileType) {
			results = append(results, profile)
		}
	}

	// Sort alphabetically
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results
}
