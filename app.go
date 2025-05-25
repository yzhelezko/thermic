package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Config loading logic
	if err := a.loadConfig(); err != nil {
		fmt.Println("Error loading config:", err)
		// Fallback or handle error appropriately
	}

	// Set initial window size and state using loaded/default config
	if a.config != nil { // Ensure config is not nil
		wailsRuntime.WindowSetSize(a.ctx, a.config.WindowWidth, a.config.WindowHeight)
		fmt.Printf("Initial window size set to: %d x %d\n", a.config.WindowWidth, a.config.WindowHeight)

		// Restore window maximized state if it was saved as maximized
		if a.config.WindowMaximized {
			wailsRuntime.WindowMaximise(a.ctx)
			fmt.Println("Window restored to maximized state")
		}
	} else {
		// This case should ideally not be reached if NewApp initializes config correctly
		fmt.Println("Config is nil, cannot set initial window size.")
	}

	// Initialize profile management system
	if err := a.InitializeProfiles(); err != nil {
		fmt.Printf("Warning: Failed to initialize profiles: %v\n", err)
		// Continue without profiles - they're not critical for basic functionality
	}

	// Listen for frontend resize events
	wailsRuntime.EventsOn(a.ctx, "frontend:window:resized", a.handleFrontendResizeEvent)
	fmt.Println("Registered listener for window resize events.")
}

// shutdown is called during application shutdown (including auto-restart)
func (a *App) shutdown(ctx context.Context) {
	fmt.Println("Shutdown initiated...")

	// Stop the debounce timer if it's running
	a.mutex.Lock()
	if a.debounceTimer != nil {
		a.debounceTimer.Stop()
		fmt.Println("Debounce timer stopped.")
	}
	a.mutex.Unlock()

	// Final update and save of window state before shutdown
	// We'll use defer/recover for additional safety during shutdown
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("Recovered from panic during window state update: %v\n", r)
		}
	}()

	// Update final window state if possible
	if a.ctx != nil && a.config != nil {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("Recovered from panic during WindowGetSize: %v\n", r)
			}
		}()

		// Safe window size retrieval with validation
		width, height := wailsRuntime.WindowGetSize(a.ctx)
		if width > 0 && height > 0 {
			a.config.WindowWidth = width
			a.config.WindowHeight = height
			fmt.Printf("Final window size captured: %dx%d\n", width, height)
		} else {
			fmt.Printf("Invalid window dimensions during shutdown: %dx%d - keeping previous values\n", width, height)
		}

		// Safe maximized state retrieval
		isMaximized := wailsRuntime.WindowIsMaximised(a.ctx)
		a.config.WindowMaximized = isMaximized
		fmt.Printf("Final maximized state: %t\n", isMaximized)
	}

	// Force save any pending config changes
	a.saveConfigIfDirty()

	// Stop profile watcher
	a.StopProfileWatcher()

	// Close all terminal sessions
	a.mutex.Lock()
	sessionIds := make([]string, 0, len(a.sessions))
	for sessionId := range a.sessions {
		sessionIds = append(sessionIds, sessionId)
	}
	a.mutex.Unlock()

	for _, sessionId := range sessionIds {
		fmt.Printf("Closing terminal session: %s\n", sessionId)
		if err := a.CloseShell(sessionId); err != nil {
			fmt.Printf("Error closing session %s: %v\n", sessionId, err)
		}
	}

	// Wait for sessions to close (with timeout)
	timeout := time.After(3 * time.Second)
	for _, sessionId := range sessionIds {
		select {
		case <-timeout:
			fmt.Printf("Timeout waiting for session %s to close\n", sessionId)
			break
		default:
			if err := a.WaitForSessionClose(sessionId); err != nil {
				fmt.Printf("Session %s didn't close cleanly: %v\n", sessionId, err)
			}
		}
	}

	fmt.Println("Shutdown completed.")
}

// CheckWSLAvailable checks if WSL is available on the system
func (a *App) CheckWSLAvailable() bool {
	return a.isWSLAvailable()
}

// GetWSLDistributions returns a list of available WSL distributions
func (a *App) GetWSLDistributions() []WSLDistribution {
	return a.getWSLDistributions()
}

// GetAvailableShells returns a list of available shells as strings (legacy support)
func (a *App) GetAvailableShells() []string {
	return a.getAvailableShells()
}

// GetPlatformInfo returns platform information
func (a *App) GetPlatformInfo() map[string]interface{} {
	return a.GetOSInfo()
}

// GetWSLInfo returns WSL-specific information
func (a *App) GetWSLInfo() map[string]interface{} {
	info := map[string]interface{}{
		"available":     a.CheckWSLAvailable(),
		"distributions": a.GetWSLDistributions(),
	}
	return info
}

// ShowMessageDialog shows a message dialog to the user
func (a *App) ShowMessageDialog(title, message string) {
	wailsRuntime.MessageDialog(a.ctx, wailsRuntime.MessageDialogOptions{
		Type:    wailsRuntime.InfoDialog,
		Title:   title,
		Message: message,
	})
}

// GetShellsForUI returns formatted shell list for UI settings
func (a *App) GetShellsForUI() []map[string]interface{} {
	shells := a.GetAvailableShellsFormatted()
	result := make([]map[string]interface{}, len(shells))

	for i, shell := range shells {
		result[i] = map[string]interface{}{
			"name":        shell["name"],  // Formatted name for display
			"value":       shell["value"], // Raw value for saving to config
			"displayName": shell["name"],  // Explicit display name field
		}
	}

	return result
}

// Tab Management Methods

// CreateTab creates a new terminal tab
func (a *App) CreateTab(shell string, sshConfig *SSHConfig) (*Tab, error) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	// Generate unique IDs
	tabId := fmt.Sprintf("tab_%d", time.Now().UnixNano())
	sessionId := fmt.Sprintf("session_%d", time.Now().UnixNano())

	// Determine connection type and title
	connectionType := "local"
	status := "connecting"
	title := shell
	if shell == "" {
		shell = a.GetDefaultShell()
		title = shell
	}

	// Handle SSH connections
	if sshConfig != nil {
		connectionType = "ssh"
		title = fmt.Sprintf("%s@%s", sshConfig.Username, sshConfig.Host)
		if sshConfig.Port != 22 {
			title = fmt.Sprintf("%s@%s:%d", sshConfig.Username, sshConfig.Host, sshConfig.Port)
		}
	}

	// Create tab
	tab := &Tab{
		ID:             tabId,
		Title:          title,
		SessionID:      sessionId,
		Shell:          shell,
		IsActive:       false,
		ConnectionType: connectionType,
		SSHConfig:      sshConfig,
		Created:        time.Now(),
		Status:         status,
		ErrorMessage:   "",
	}

	// Store tab
	a.tabs[tabId] = tab

	return tab, nil
}

// GetTabs returns all tabs
func (a *App) GetTabs() []*Tab {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	tabs := make([]*Tab, 0, len(a.tabs))
	for _, tab := range a.tabs {
		tabs = append(tabs, tab)
	}

	// Sort by creation time
	for i := 0; i < len(tabs)-1; i++ {
		for j := i + 1; j < len(tabs); j++ {
			if tabs[i].Created.After(tabs[j].Created) {
				tabs[i], tabs[j] = tabs[j], tabs[i]
			}
		}
	}

	return tabs
}

// SetActiveTab sets the active tab
func (a *App) SetActiveTab(tabId string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	// Check if tab exists
	tab, exists := a.tabs[tabId]
	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	// Deactivate current active tab
	if a.activeTabId != "" {
		if currentTab, exists := a.tabs[a.activeTabId]; exists {
			currentTab.IsActive = false
		}
	}

	// Activate new tab
	tab.IsActive = true
	a.activeTabId = tabId

	return nil
}

// GetActiveTab returns the currently active tab
func (a *App) GetActiveTab() *Tab {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	if a.activeTabId == "" {
		return nil
	}

	return a.tabs[a.activeTabId]
}

// CloseTab closes a tab and its associated session
func (a *App) CloseTab(tabId string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	tab, exists := a.tabs[tabId]
	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	// Remove tab first
	delete(a.tabs, tabId)

	// Close the associated session asynchronously to avoid blocking
	if tab.SessionID != "" {
		go func(sessionID string) {
			if err := a.CloseShell(sessionID); err != nil {
				fmt.Printf("Error closing session %s: %v\n", sessionID, err)
			}
		}(tab.SessionID)
	}

	// If this was the active tab, find a new active tab
	if a.activeTabId == tabId {
		a.activeTabId = ""

		// Set first available tab as active
		for id, t := range a.tabs {
			t.IsActive = true
			a.activeTabId = id
			break
		}
	}

	return nil
}

// StartTabShell starts a shell for a tab without dimensions (backward compatibility)
func (a *App) StartTabShell(tabId string) error {
	return a.StartTabShellWithSize(tabId, 80, 24)
}

// StartTabShellWithSize starts a shell for a tab with specified terminal dimensions
func (a *App) StartTabShellWithSize(tabId string, cols, rows int) error {
	a.mutex.RLock()
	tab, exists := a.tabs[tabId]
	a.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	var err error

	// Handle SSH connections with status tracking and animation
	if tab.ConnectionType == "ssh" && tab.SSHConfig != nil {
		// Update tab status to connecting for SSH
		a.mutex.Lock()
		tab.Status = "connecting"
		tab.ErrorMessage = ""
		a.mutex.Unlock()

		// Emit tab update event for SSH
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
				"tabId":  tabId,
				"status": "connecting",
			})
		}

		// Start animated connection sequence for SSH
		if a.ctx != nil {
			a.startSSHConnectionAnimation(tab)
		}

		// Attempt SSH connection with terminal dimensions
		err = a.startSSHSessionWithSize(tab, cols, rows)

		// Update SSH tab status based on result
		a.mutex.Lock()
		if err != nil {
			tab.Status = "failed"
			tab.ErrorMessage = err.Error()
		} else {
			tab.Status = "connected"
			tab.ErrorMessage = ""
		}
		a.mutex.Unlock()

		// Send SSH connection result to terminal
		if a.ctx != nil {
			if err != nil {
				a.sendFormattedError(tab, err)
			} else {
				// Clear the connecting animation and show clean success message
				a.sendSuccessMessage(tab)
			}
		}

		// Emit SSH tab update event with final status
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
				"tabId":        tabId,
				"status":       tab.Status,
				"errorMessage": tab.ErrorMessage,
			})
		}
	} else {
		// Handle local shell - no status tracking, just start directly
		err = a.StartShell(tab.Shell, tab.SessionID)

		// For local shells, only show errors in terminal if they occur
		if err != nil && a.ctx != nil {
			// Send local shell error to terminal
			errorMsg := fmt.Sprintf("\r\n\033[31m╭─ Shell Error\033[0m\r\n\033[31m│\033[0m Failed to start: \033[33m%s\033[0m\r\n\033[31m│\033[0m %s\r\n\033[31m╰─\033[0m\r\n\r\n", tab.Shell, err.Error())
			wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
				"sessionId": tab.SessionID,
				"data":      errorMsg,
			})
		}
	}

	return err
}

// startSSHConnectionAnimation shows animated connecting sequence
func (a *App) startSSHConnectionAnimation(tab *Tab) {
	// No more animation messages - just silent status updates
}

// sendFormattedError sends a nicely formatted error message to the terminal
func (a *App) sendFormattedError(tab *Tab, err error) {
	// No more error messages in terminal - rely on tab status only
}

// sendSuccessMessage clears the connecting animation and terminal for clean SSH session
func (a *App) sendSuccessMessage(tab *Tab) {
	if a.ctx == nil {
		return
	}

	// More comprehensive terminal reset sequence
	// ESC[2J - Clear entire screen
	// ESC[H - Move cursor to home position
	// ESC[3J - Clear scrollback buffer (for terminals that support it)
	// ESC[!p - Soft terminal reset
	// ESC[?1049l - Exit alternate screen buffer (if in use)
	// ESC[m - Reset all attributes
	clearTerminal := "\033[2J\033[H\033[3J\033[!p\033[?1049l\033[m"

	// Terminal initialization sequence for proper arrow key handling
	// ESC[?1l - Reset cursor key mode (ensure standard arrow key sequences)
	// ESC[?25h - Show cursor
	// ESC[0m - Reset all attributes
	initSequence := "\033[?1l\033[?25h\033[0m"

	// Combine reset and initialization
	fullSequence := clearTerminal + initSequence

	// Send terminal reset and initialization
	wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
		"sessionId": tab.SessionID,
		"data":      fullSequence,
	})
}

// startSSHSessionWithSize starts an SSH session for a tab with specified terminal dimensions
func (a *App) startSSHSessionWithSize(tab *Tab, cols, rows int) error {
	// Create native SSH session with terminal dimensions
	sshSession, err := a.CreateSSHSessionWithSize(tab.SessionID, tab.SSHConfig, cols, rows)
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}

	// Store SSH session
	a.mutex.Lock()
	a.sshSessions[tab.SessionID] = sshSession
	a.mutex.Unlock()

	// Start SSH shell
	if err := a.StartSSHShell(sshSession); err != nil {
		// Clean up on failure
		a.mutex.Lock()
		delete(a.sshSessions, tab.SessionID)
		a.mutex.Unlock()
		a.CloseSSHSession(sshSession)
		return fmt.Errorf("failed to start SSH shell: %w", err)
	}

	return nil
}

// RenameTab renames a tab
func (a *App) RenameTab(tabId, newTitle string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	tab, exists := a.tabs[tabId]
	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	tab.Title = newTitle
	return nil
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

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

		// Find parent folder
		if profile.FolderPath == "" {
			// Root level
			rootNodes = append(rootNodes, node)
		} else {
			// Find parent folder by path
			parentID := a.findFolderByPath(profile.FolderPath)
			if parentID != "" && tree[parentID] != nil {
				tree[parentID].Children = append(tree[parentID].Children, node)
			} else {
				// Parent not found, add to root
				rootNodes = append(rootNodes, node)
			}
		}
	}

	// Add folders to their parents or root
	for folderID, folder := range a.profileFolders {
		node := tree[folderID]
		if folder.ParentPath == "" {
			// Root level folder
			rootNodes = append(rootNodes, node)
		} else {
			// Find parent folder
			parentID := a.findFolderByPath(folder.ParentPath)
			if parentID != "" && tree[parentID] != nil {
				tree[parentID].Children = append(tree[parentID].Children, node)
			} else {
				// Parent not found, add to root
				rootNodes = append(rootNodes, node)
			}
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
		FolderPath:   folderPath,
		Environment:  make(map[string]string),
		Created:      now,
		LastModified: now,
	}

	if err := a.SaveProfile(profile); err != nil {
		return nil, err
	}

	return profile, nil
}

// CreateProfileFolderAPI creates a new profile folder
func (a *App) CreateProfileFolderAPI(name, icon, parentPath string) (*ProfileFolder, error) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	id := generateID()
	now := time.Now()

	folder := &ProfileFolder{
		ID:           id,
		Name:         name,
		Icon:         icon,
		ParentPath:   parentPath,
		Expanded:     true,
		Created:      now,
		LastModified: now,
	}

	if err := a.SaveProfileFolder(folder); err != nil {
		return nil, err
	}

	return folder, nil
}

// UpdateProfile updates an existing profile
func (a *App) UpdateProfile(profile *Profile) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()
	return a.SaveProfile(profile)
}

// UpdateProfileFolder updates an existing profile folder
func (a *App) UpdateProfileFolder(folder *ProfileFolder) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()
	return a.SaveProfileFolder(folder)
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

	// Find and delete the file
	filename := fmt.Sprintf("%s-%s.yaml", profile.Name, id)
	filename = strings.ReplaceAll(filename, " ", "_")
	filename = strings.ReplaceAll(filename, "/", "_")
	filename = strings.ReplaceAll(filename, "\\", "_")

	filePath := filepath.Join(profilesDir, filename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile file: %w", err)
	}

	// Remove from memory
	delete(a.profiles, id)

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

	// Find and delete the file
	filename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, id)
	filename = strings.ReplaceAll(filename, " ", "_")
	filename = strings.ReplaceAll(filename, "/", "_")
	filename = strings.ReplaceAll(filename, "\\", "_")

	filePath := filepath.Join(profilesDir, filename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile folder file: %w", err)
	}

	// Move any profiles in this folder to root
	folderPath := a.buildFolderPath(id)
	for _, profile := range a.profiles {
		if strings.HasPrefix(profile.FolderPath, folderPath) {
			// Remove this folder from the path
			newPath := strings.TrimPrefix(profile.FolderPath, folderPath)
			newPath = strings.TrimPrefix(newPath, "/")
			profile.FolderPath = newPath
			a.SaveProfile(profile)
		}
	}

	// Remove from memory
	delete(a.profileFolders, id)

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

	profile.FolderPath = newFolderPath
	return a.SaveProfile(profile)
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

	if err := a.SaveProfile(&duplicate); err != nil {
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
		filename = strings.ReplaceAll(filename, " ", "_")
		filename = strings.ReplaceAll(filename, "/", "_")
		filename = strings.ReplaceAll(filename, "\\", "_")

		filePath := filepath.Join(profilesDir, filename)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Warning: Failed to delete profile file %s: %v\n", filePath, err)
		}

		// Remove from memory
		delete(a.profiles, profileID)
	}

	// Delete the folder file
	folderFilename := fmt.Sprintf("folder-%s-%s.yaml", folder.Name, id)
	folderFilename = strings.ReplaceAll(folderFilename, " ", "_")
	folderFilename = strings.ReplaceAll(folderFilename, "/", "_")
	folderFilename = strings.ReplaceAll(folderFilename, "\\", "_")

	folderFilePath := filepath.Join(profilesDir, folderFilename)
	if err := os.Remove(folderFilePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete profile folder file: %w", err)
	}

	// Remove folder from memory
	delete(a.profileFolders, id)

	return nil
}

// CreateTabFromProfile creates a new tab using a profile
func (a *App) CreateTabFromProfile(profileID string) (*Tab, error) {
	a.mutex.RLock()
	profile, exists := a.profiles[profileID]
	a.mutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("profile not found: %s", profileID)
	}

	// Update usage tracking
	go a.updateProfileUsage(profileID)

	// Create tab based on profile type
	switch profile.Type {
	case "ssh":
		return a.CreateTab("", profile.SSHConfig)
	default:
		return a.CreateTab(profile.Shell, nil)
	}
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
	err := a.SaveProfile(profile)
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
	err := a.SaveProfile(profile)
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

// GetTabStatus returns the status of a specific tab
func (a *App) GetTabStatus(tabId string) (map[string]interface{}, error) {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	tab, exists := a.tabs[tabId]
	if !exists {
		return nil, fmt.Errorf("tab %s not found", tabId)
	}

	return map[string]interface{}{
		"tabId":          tab.ID,
		"status":         tab.Status,
		"errorMessage":   tab.ErrorMessage,
		"title":          tab.Title,
		"connectionType": tab.ConnectionType,
	}, nil
}

// ForceDisconnectTab forcefully disconnects a hanging SSH tab
func (a *App) ForceDisconnectTab(tabId string) error {
	a.mutex.RLock()
	tab, exists := a.tabs[tabId]
	a.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	if tab.ConnectionType != "ssh" {
		return fmt.Errorf("tab %s is not an SSH connection", tabId)
	}

	// Force disconnect the SSH session
	if err := a.ForceDisconnectSSHSession(tab.SessionID); err != nil {
		return fmt.Errorf("failed to force disconnect SSH session: %w", err)
	}

	// Update tab status
	a.mutex.Lock()
	tab.Status = "disconnected"
	tab.ErrorMessage = "Forcefully disconnected"
	a.mutex.Unlock()

	// Emit status update
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":        tabId,
			"status":       "disconnected",
			"errorMessage": tab.ErrorMessage,
		})
	}

	return nil
}

// ReconnectTab attempts to reconnect an SSH tab (works for any status)
func (a *App) ReconnectTab(tabId string) error {
	a.mutex.RLock()
	tab, exists := a.tabs[tabId]
	a.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	if tab.ConnectionType != "ssh" {
		return fmt.Errorf("tab %s is not an SSH connection", tabId)
	}

	fmt.Printf("Reconnecting SSH tab %s (current status: %s)\n", tabId, tab.Status)

	// For any existing connection (hanging, connected, connecting), disconnect first
	if tab.Status == "hanging" || tab.Status == "connected" || tab.Status == "connecting" {
		fmt.Printf("Disconnecting existing session before reconnect: %s\n", tabId)

		// Clean up existing SSH session
		a.mutex.RLock()
		if existingSession, exists := a.sshSessions[tab.SessionID]; exists {
			a.mutex.RUnlock()
			a.CloseSSHSession(existingSession)
			a.mutex.Lock()
			delete(a.sshSessions, tab.SessionID)
			a.mutex.Unlock()
		} else {
			a.mutex.RUnlock()
		}

		// Update status to disconnected temporarily
		a.mutex.Lock()
		tab.Status = "disconnected"
		tab.ErrorMessage = "Reconnecting..."
		a.mutex.Unlock()

		// Emit disconnect status
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
				"tabId":        tabId,
				"status":       "disconnected",
				"errorMessage": "Reconnecting...",
			})
		}

		// Small delay to allow cleanup
		time.Sleep(500 * time.Millisecond)
	}

	// Clean up any remaining SSH session (for failed/disconnected states)
	a.mutex.RLock()
	if existingSession, exists := a.sshSessions[tab.SessionID]; exists {
		a.mutex.RUnlock()
		a.CloseSSHSession(existingSession)
		a.mutex.Lock()
		delete(a.sshSessions, tab.SessionID)
		a.mutex.Unlock()
	} else {
		a.mutex.RUnlock()
	}

	// Reset tab status and attempt reconnection
	a.mutex.Lock()
	tab.Status = "connecting"
	tab.ErrorMessage = ""
	a.mutex.Unlock()

	// Emit reconnection status
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":  tabId,
			"status": "connecting",
		})
	}

	// Attempt to start SSH session again
	return a.StartTabShell(tabId)
}
