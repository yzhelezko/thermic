package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
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

	// Check if tab exists
	tab, exists := a.tabs[tabId]
	if !exists {
		a.mutex.Unlock()
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

	// Copy tab data for event emission outside of mutex
	tabData := map[string]interface{}{
		"tabId":          tabId,
		"connectionType": tab.ConnectionType,
		"status":         tab.Status,
	}

	a.mutex.Unlock()

	// Emit tab switch event to update status bar (outside of mutex to prevent blocking)
	if a.ctx != nil {
		// Use goroutine to make this completely non-blocking
		go func() {
			wailsRuntime.EventsEmit(a.ctx, "tab-switched", tabData)
		}()
	}

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
		// Handle local shell - update status to track local shell state
		err = a.StartShell(tab.Shell, tab.SessionID)

		// Update local shell status based on result
		a.mutex.Lock()
		if err != nil {
			tab.Status = "failed"
			tab.ErrorMessage = err.Error()
		} else {
			tab.Status = "connected"
			tab.ErrorMessage = ""
		}
		a.mutex.Unlock()

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
	if a.ctx == nil {
		return
	}

	// Show connecting banner with host info
	banner := fmt.Sprintf("\r\n\033[36m╭─ SSH Connection\033[0m\r\n\033[36m│\033[0m Host: \033[33m%s:%d\033[0m\r\n\033[36m│\033[0m User: \033[33m%s\033[0m\r\n\033[36m│\033[0m",
		tab.SSHConfig.Host, tab.SSHConfig.Port, tab.SSHConfig.Username)
	wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
		"sessionId": tab.SessionID,
		"data":      banner,
	})

	// Start animated connection sequence
	go func() {
		frames := []string{
			"\033[36m│\033[0m \033[32m●\033[0m Connecting   ",
			"\033[36m│\033[0m \033[32m●\033[0m Connecting.  ",
			"\033[36m│\033[0m \033[32m●\033[0m Connecting.. ",
			"\033[36m│\033[0m \033[32m●\033[0m Connecting...",
		}
		i := 0
		for {
			// Check if connection is still in progress
			a.mutex.RLock()
			currentStatus := tab.Status
			a.mutex.RUnlock()
			if currentStatus != "connecting" {
				break
			}

			frame := frames[i%len(frames)]

			// Use carriage return to overwrite the same line
			wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
				"sessionId": tab.SessionID,
				"data":      "\r" + frame,
			})

			time.Sleep(300 * time.Millisecond)
			i++
		}
	}()
}

// getSSHErrorHints provides helpful troubleshooting tips based on error type
func (a *App) getSSHErrorHints(errorMsg string) string {
	errorLower := strings.ToLower(errorMsg)
	if strings.Contains(errorLower, "authentication failed") || strings.Contains(errorLower, "unable to authenticate") {
		return "\033[33m│\033[0m • Check your username and password\r\n\033[33m│\033[0m • Verify SSH key permissions (chmod 600)\r\n\033[33m│\033[0m • Try using password authentication\r\n"
	}
	if strings.Contains(errorLower, "connection refused") {
		return "\033[33m│\033[0m • SSH server may not be running\r\n\033[33m│\033[0m • Check if port 22 (or custom port) is open\r\n\033[33m│\033[0m • Verify firewall settings\r\n"
	}
	if strings.Contains(errorLower, "timeout") || strings.Contains(errorLower, "could not reach") {
		return "\033[33m│\033[0m • Check network connectivity\r\n\033[33m│\033[0m • Verify the hostname/IP address\r\n\033[33m│\033[0m • Check VPN or proxy settings\r\n"
	}
	if strings.Contains(errorLower, "no route to host") || strings.Contains(errorLower, "not reachable") {
		return "\033[33m│\033[0m • Host may be down or unreachable\r\n\033[33m│\033[0m • Check network routing\r\n\033[33m│\033[0m • Verify VPN connection if required\r\n"
	}
	if strings.Contains(errorLower, "host key") {
		return "\033[33m│\033[0m • Host key has changed or is unknown\r\n\033[33m│\033[0m • Check ~/.ssh/known_hosts file\r\n\033[33m│\033[0m • Use ssh-keyscan to verify host key\r\n"
	}
	// Generic SSH tips
	return "\033[33m│\033[0m • Check SSH server configuration\r\n\033[33m│\033[0m • Verify network connectivity\r\n\033[33m│\033[0m • Review SSH logs for details\r\n"
}

// sendFormattedError sends a nicely formatted error message to the terminal
func (a *App) sendFormattedError(tab *Tab, err error) {
	if a.ctx == nil {
		return
	}

	// Complete the connection banner with failure
	clearAndComplete := "\r\033[36m│\033[0m \033[31m✗ Connection failed\033[0m\r\n\033[36m╰─\033[0m\r\n"

	// Create formatted error message for SSH
	errorMsg := clearAndComplete

	// Add error details box
	errorBox := fmt.Sprintf("\r\n\033[31m╭─ Error Details\033[0m\r\n\033[31m│\033[0m %s\r\n\033[31m╰─\033[0m\r\n", err.Error())

	// Add troubleshooting hints for SSH errors
	hints := a.getSSHErrorHints(err.Error())
	if hints != "" {
		hintBox := fmt.Sprintf("\r\n\033[33m╭─ Troubleshooting Tips\033[0m\r\n%s\033[33m╰─\033[0m\r\n", hints)
		errorBox += hintBox
	}
	fullError := errorMsg + errorBox + "\r\n"

	// Send error message to terminal with a small delay to ensure terminal is ready
	go func() {
		time.Sleep(100 * time.Millisecond) // Small delay to ensure terminal session is established
		wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
			"sessionId": tab.SessionID,
			"data":      fullError,
		})
	}()
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

	// Create monitoring session in background (don't fail main connection if this fails)
	go func() {
		if err := a.CreateMonitoringSession(sshSession, tab.SSHConfig); err != nil {
			fmt.Printf("Warning: Failed to create monitoring session for %s: %v\n", tab.SessionID, err)
		}
	}()

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

// ReconnectTab reconnects a disconnected SSH tab
func (a *App) ReconnectTab(tabId string) error {
	a.mutex.Lock()
	tab, exists := a.tabs[tabId]
	if !exists {
		a.mutex.Unlock()
		return fmt.Errorf("tab %s not found", tabId)
	}

	// Only allow reconnection for SSH tabs
	if tab.ConnectionType != "ssh" || tab.SSHConfig == nil {
		a.mutex.Unlock()
		return fmt.Errorf("tab %s is not an SSH connection", tabId)
	}

	// Update status to connecting
	tab.Status = "connecting"
	tab.ErrorMessage = ""
	a.mutex.Unlock()

	// Emit status update
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":  tabId,
			"status": "connecting",
		})
	}

	// Start animated connection sequence
	if a.ctx != nil {
		a.startSSHConnectionAnimation(tab)
	}

	// Get current terminal dimensions from the frontend
	cols, rows := 80, 24 // default fallback

	// Start SSH session with current dimensions
	err := a.startSSHSessionWithSize(tab, cols, rows)
	if err != nil {
		a.mutex.Lock()
		tab.Status = "failed"
		tab.ErrorMessage = err.Error()
		a.mutex.Unlock()

		// Send formatted error message to terminal
		a.sendFormattedError(tab, err)

		// Emit status update
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
				"tabId":        tabId,
				"status":       "failed",
				"errorMessage": err.Error(),
			})
		}

		return err
	}

	// Update status to connected
	a.mutex.Lock()
	tab.Status = "connected"
	tab.ErrorMessage = ""
	a.mutex.Unlock()

	// Send success message
	a.sendSuccessMessage(tab)

	// Emit status update
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":  tabId,
			"status": "connected",
		})
	}

	return nil
}

// ReorderTabs reorders tabs based on the provided tab IDs array
func (a *App) ReorderTabs(tabIds []string) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	// Validate that all provided tab IDs exist
	for _, tabId := range tabIds {
		if _, exists := a.tabs[tabId]; !exists {
			return fmt.Errorf("tab %s not found", tabId)
		}
	}

	// Validate that all existing tabs are included in the reorder
	if len(tabIds) != len(a.tabs) {
		return fmt.Errorf("tab count mismatch: expected %d, got %d", len(a.tabs), len(tabIds))
	}

	// Update the creation time of tabs to reflect the new order
	// We'll use the current time as base and increment by nanoseconds
	baseTime := time.Now()
	for i, tabId := range tabIds {
		if tab, exists := a.tabs[tabId]; exists {
			// Set creation time to maintain the desired order
			tab.Created = baseTime.Add(time.Duration(i) * time.Nanosecond)
		}
	}

	return nil
}

// GetSystemStats returns current system statistics
func (a *App) GetSystemStats() map[string]interface{} {
	stats := map[string]interface{}{
		"hostname":     "localhost",
		"uptime":       "0s",
		"load":         "0.0",
		"cpu":          "0%",
		"memory":       "0%",
		"memory_total": "0 MB",
		"memory_used":  "0 MB",
		"network_rx":   "0 MB/s",
		"network_tx":   "0 MB/s",
	}

	// Get hostname
	if hostname, err := os.Hostname(); err == nil {
		stats["hostname"] = hostname
	}

	stats["timestamp"] = time.Now().Unix()

	// Get real CPU usage
	if cpuUsage, err := a.getCPUUsage(); err == nil {
		stats["cpu"] = fmt.Sprintf("%.1f%%", cpuUsage)
	}

	// Get real memory usage with detailed info
	if memUsage, memTotal, memUsed, err := a.getMemoryUsageDetailed(); err == nil {
		stats["memory"] = fmt.Sprintf("%.1f%%", memUsage)
		stats["memory_total"] = fmt.Sprintf("%.0f MB", memTotal/1024/1024) // Convert to MB
		stats["memory_used"] = fmt.Sprintf("%.0f MB", memUsed/1024/1024)   // Convert to MB
	}

	// Get load average
	if loadAvg, err := a.getLoadAverage(); err == nil {
		stats["load"] = fmt.Sprintf("%.2f", loadAvg)
	}

	// Get uptime
	if uptime, err := a.getUptime(); err == nil {
		stats["uptime"] = uptime
	}

	// Get network stats
	rxMB, txMB := a.getNetworkStats()
	stats["network_rx"] = fmt.Sprintf("%.1f MB/s", rxMB)
	stats["network_tx"] = fmt.Sprintf("%.1f MB/s", txMB)

	return stats
}

// getCPUUsage returns current CPU usage percentage using gopsutil
func (a *App) getCPUUsage() (float64, error) {
	// Get CPU usage percentage with 1 second interval
	percentages, err := cpu.Percent(time.Second, false)
	if err != nil {
		return 0, err
	}

	if len(percentages) == 0 {
		return 0, fmt.Errorf("no CPU usage data available")
	}

	return percentages[0], nil
}

// getMemoryUsageDetailed returns memory usage using gopsutil
func (a *App) getMemoryUsageDetailed() (percentage, total, used float64, err error) {
	memInfo, err := mem.VirtualMemory()
	if err != nil {
		return 0, 0, 0, err
	}

	return memInfo.UsedPercent, float64(memInfo.Total), float64(memInfo.Used), nil
}

// getLoadAverage returns load average using gopsutil
func (a *App) getLoadAverage() (float64, error) {
	loadInfo, err := load.Avg()
	if err != nil {
		// On Windows, load average is not available, return CPU usage as approximation
		if runtime.GOOS == "windows" {
			return a.getCPUUsage()
		}
		return 0, err
	}

	return loadInfo.Load1, nil
}

// getUptime returns system uptime using gopsutil
func (a *App) getUptime() (string, error) {
	hostInfo, err := host.Info()
	if err != nil {
		return "", err
	}

	// Convert uptime from seconds to duration
	uptime := time.Duration(hostInfo.Uptime) * time.Second
	return a.formatDuration(uptime), nil
}

// getNetworkStats returns network statistics using gopsutil
func (a *App) getNetworkStats() (float64, float64) {
	// Get network IO counters
	netIO, err := net.IOCounters(false) // false = per interface
	if err != nil {
		return 0.0, 0.0
	}

	if len(netIO) == 0 {
		return 0.0, 0.0
	}

	// Sum up all interfaces (excluding loopback)
	var totalBytesRecv, totalBytesSent uint64

	for _, io := range netIO {
		// Skip loopback and virtual interfaces
		if strings.Contains(strings.ToLower(io.Name), "loopback") ||
			strings.Contains(strings.ToLower(io.Name), "lo") ||
			strings.Contains(strings.ToLower(io.Name), "docker") ||
			strings.Contains(strings.ToLower(io.Name), "veth") {
			continue
		}

		totalBytesRecv += io.BytesRecv
		totalBytesSent += io.BytesSent
	}

	// For now, return a small rate based on total bytes
	// Real implementation would track deltas over time
	// This shows network activity exists
	rxMBps := float64(totalBytesRecv) / (1024 * 1024 * 1000) // Very small rate
	txMBps := float64(totalBytesSent) / (1024 * 1024 * 1000) // Very small rate

	// Cap at reasonable values for display
	if rxMBps > 100 {
		rxMBps = 0.1 // Show some activity
	}
	if txMBps > 100 {
		txMBps = 0.05 // Show some activity
	}

	return rxMBps, txMBps
}

// formatDuration formats a duration into human-readable uptime
func (a *App) formatDuration(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	} else if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	} else {
		return fmt.Sprintf("%dm", minutes)
	}
}

// GetRemoteSystemStats executes system commands on remote SSH session to get stats
func (a *App) GetRemoteSystemStats(sessionID string) map[string]interface{} {
	stats := map[string]interface{}{
		"hostname":     "unknown",
		"uptime":       "unknown",
		"load":         "unknown",
		"cpu":          "unknown",
		"memory":       "unknown",
		"memory_total": "unknown",
		"memory_used":  "unknown",
		"arch":         "unknown",
		"kernel":       "unknown",
		"network_rx":   "unknown",
		"network_tx":   "unknown",
	}

	// Check if we have an active SSH session
	a.mutex.RLock()
	sshSession, exists := a.sshSessions[sessionID]
	a.mutex.RUnlock()

	if !exists || sshSession == nil || sshSession.cleaning {
		return stats
	}

	// Check if monitoring session is available
	sshSession.monitoringMutex.RLock()
	monitoringEnabled := sshSession.monitoringEnabled
	sshSession.monitoringMutex.RUnlock()

	if !monitoringEnabled {
		fmt.Printf("Monitoring session not available for %s\n", sessionID)
		return stats
	}

	// Execute commands using the monitoring session
	// These run in parallel to avoid blocking

	// Basic system info
	a.executeRemoteStatsCommand(sshSession, "hostname", &stats, "hostname")
	a.executeRemoteStatsCommand(sshSession, "uname -sr", &stats, "kernel")
	a.executeRemoteStatsCommand(sshSession, "uname -m", &stats, "arch")

	// System stats with more complex parsing
	a.executeRemoteUptimeCommand(sshSession, &stats)
	a.executeRemoteMemoryCommand(sshSession, &stats)
	a.executeRemoteCPUCommand(sshSession, &stats)
	a.executeRemoteLoadCommand(sshSession, &stats)
	a.executeRemoteNetworkCommand(sshSession, &stats)

	return stats
}

// executeRemoteStatsCommand executes a command and stores result in stats
func (a *App) executeRemoteStatsCommand(sshSession *SSHSession, command string, stats *map[string]interface{}, key string) {
	// Check cache first
	if cached, exists := a.GetCachedMonitoringResult(sshSession, command); exists {
		(*stats)[key] = strings.TrimSpace(cached)
		return
	}

	// Execute command
	output, err := a.ExecuteMonitoringCommand(sshSession, command)
	if err != nil {
		fmt.Printf("Failed to execute remote command '%s': %v\n", command, err)
		return
	}

	result := strings.TrimSpace(output)
	if result != "" {
		(*stats)[key] = result
		// Cache the result
		a.CacheMonitoringResult(sshSession, command, result)
	}
}

// executeRemoteUptimeCommand gets system uptime
func (a *App) executeRemoteUptimeCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Try uptime -p first (prettier format) - this gives "up X days, Y hours, Z minutes"
	output, err := a.ExecuteMonitoringCommand(sshSession, "uptime -p 2>/dev/null")
	if err == nil && strings.TrimSpace(output) != "" {
		uptime := strings.TrimSpace(output)
		if strings.HasPrefix(uptime, "up ") {
			uptime = strings.TrimPrefix(uptime, "up ")
		}
		// Clean up the uptime format
		uptime = strings.TrimSpace(uptime)
		if uptime != "" {
			(*stats)["uptime"] = uptime
		}
	}
}

// executeRemoteMemoryCommand gets memory usage
func (a *App) executeRemoteMemoryCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Try to get memory info from /proc/meminfo (Linux)
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/meminfo 2>/dev/null | head -3")
	if err == nil && strings.Contains(output, "MemTotal") {
		lines := strings.Split(output, "\n")
		var memTotal, memAvailable int64

		for _, line := range lines {
			if strings.HasPrefix(line, "MemTotal:") {
				fmt.Sscanf(line, "MemTotal: %d kB", &memTotal)
			} else if strings.HasPrefix(line, "MemAvailable:") {
				fmt.Sscanf(line, "MemAvailable: %d kB", &memAvailable)
			}
		}

		if memTotal > 0 && memAvailable > 0 {
			memUsed := memTotal - memAvailable
			memPercent := float64(memUsed) / float64(memTotal) * 100

			(*stats)["memory"] = fmt.Sprintf("%.1f%%", memPercent)
			(*stats)["memory_total"] = fmt.Sprintf("%.0f MB", float64(memTotal)/1024)
			(*stats)["memory_used"] = fmt.Sprintf("%.0f MB", float64(memUsed)/1024)
			return
		}
	}

	// Fallback: try free command
	output, err = a.ExecuteMonitoringCommand(sshSession, "free -m | grep '^Mem:'")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse free output: "Mem:      15360      2048      1024      256      8192      13312"
		fields := strings.Fields(output)
		if len(fields) >= 3 {
			var total, used int64
			fmt.Sscanf(fields[1], "%d", &total)
			fmt.Sscanf(fields[2], "%d", &used)

			if total > 0 {
				memPercent := float64(used) / float64(total) * 100
				(*stats)["memory"] = fmt.Sprintf("%.1f%%", memPercent)
				(*stats)["memory_total"] = fmt.Sprintf("%d MB", total)
				(*stats)["memory_used"] = fmt.Sprintf("%d MB", used)
			}
		}
	}
}

// executeRemoteCPUCommand gets CPU usage
func (a *App) executeRemoteCPUCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Use top command to get current CPU usage
	output, err := a.ExecuteMonitoringCommand(sshSession, "top -bn1 | grep '^%Cpu' | head -1")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse top output: "%Cpu(s):  3.2 us,  1.0 sy,  0.0 ni, 95.8 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st"
		line := strings.TrimSpace(output)
		if strings.Contains(line, "id,") {
			// Extract idle percentage
			idleStart := strings.Index(line, "id,")
			if idleStart > 2 {
				idleStr := strings.TrimSpace(line[idleStart-6 : idleStart])
				fields := strings.Fields(idleStr)
				if len(fields) > 0 {
					var idle float64
					if n, _ := fmt.Sscanf(fields[len(fields)-1], "%f", &idle); n == 1 {
						cpuUsage := 100.0 - idle
						(*stats)["cpu"] = fmt.Sprintf("%.1f%%", cpuUsage)
						return
					}
				}
			}
		}
	}

	// Fallback: Try different top format or vmstat
	output, err = a.ExecuteMonitoringCommand(sshSession, "vmstat 1 2 | tail -1")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse vmstat output: " 1  0      0 7982720 184392 5981632    0    0     0     0  1020  1822  1  1 98  0  0"
		fields := strings.Fields(output)
		if len(fields) >= 15 {
			var idle float64
			if n, _ := fmt.Sscanf(fields[14], "%f", &idle); n == 1 {
				cpuUsage := 100.0 - idle
				(*stats)["cpu"] = fmt.Sprintf("%.1f%%", cpuUsage)
			}
		}
	}
}

// executeRemoteLoadCommand gets load average
func (a *App) executeRemoteLoadCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Get load average from /proc/loadavg (Linux)
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/loadavg 2>/dev/null")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse loadavg: "0.08 0.02 0.01 1/123 12345"
		fields := strings.Fields(output)
		if len(fields) >= 1 {
			(*stats)["load"] = fields[0] // 1-minute load average
			return
		}
	}

	// Fallback: extract from uptime command
	output, err = a.ExecuteMonitoringCommand(sshSession, "uptime")
	if err == nil && strings.Contains(output, "load average:") {
		// Extract load from uptime output
		idx := strings.Index(output, "load average:")
		if idx != -1 {
			loadPart := output[idx+13:] // Skip "load average:"
			fields := strings.Split(loadPart, ",")
			if len(fields) >= 1 {
				load := strings.TrimSpace(fields[0])
				(*stats)["load"] = load
			}
		}
	}
}

// executeRemoteNetworkCommand gets network interface statistics
func (a *App) executeRemoteNetworkCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Try to get network stats from /proc/net/dev (Linux)
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/net/dev 2>/dev/null | grep -E 'eth|ens|enp|wlan|wlp' | head -1")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse network interface line: "  eth0: 12345678 1234 0 0 0 0 0 0 87654321 4321 0 0 0 0 0 0"
		line := strings.TrimSpace(output)
		if strings.Contains(line, ":") {
			parts := strings.Split(line, ":")
			if len(parts) == 2 {
				fields := strings.Fields(parts[1])
				if len(fields) >= 9 {
					// fields[0] = RX bytes, fields[8] = TX bytes
					var rxBytes, txBytes int64
					fmt.Sscanf(fields[0], "%d", &rxBytes)
					fmt.Sscanf(fields[8], "%d", &txBytes)

					// Check cache for previous values to calculate rate
					cacheKey := "network_bytes"
					if cached, exists := a.GetCachedMonitoringResult(sshSession, cacheKey); exists {
						// Parse cached values: "rxBytes,txBytes,timestamp"
						cacheParts := strings.Split(cached, ",")
						if len(cacheParts) == 3 {
							var prevRxBytes, prevTxBytes, prevTimestamp int64
							fmt.Sscanf(cacheParts[0], "%d", &prevRxBytes)
							fmt.Sscanf(cacheParts[1], "%d", &prevTxBytes)
							fmt.Sscanf(cacheParts[2], "%d", &prevTimestamp)

							currentTime := time.Now().Unix()
							timeDiff := currentTime - prevTimestamp

							if timeDiff > 0 {
								rxRate := float64(rxBytes-prevRxBytes) / float64(timeDiff) / 1024 / 1024 // MB/s
								txRate := float64(txBytes-prevTxBytes) / float64(timeDiff) / 1024 / 1024 // MB/s

								if rxRate >= 0 && txRate >= 0 { // Ensure positive rates
									(*stats)["network_rx"] = fmt.Sprintf("%.1f MB/s", rxRate)
									(*stats)["network_tx"] = fmt.Sprintf("%.1f MB/s", txRate)
								}
							}
						}
					}

					// Cache current values for next calculation
					currentTime := time.Now().Unix()
					cacheValue := fmt.Sprintf("%d,%d,%d", rxBytes, txBytes, currentTime)
					a.CacheMonitoringResult(sshSession, cacheKey, cacheValue)
				}
			}
		}
		return
	}

	// Fallback: try ifconfig or ip command (less accurate, shows totals not rates)
	output, err = a.ExecuteMonitoringCommand(sshSession, "ip -s link 2>/dev/null | grep -A3 -E 'eth|ens|enp|wlan|wlp' | head -6")
	if err == nil && strings.TrimSpace(output) != "" {
		// This is a simplified implementation - would need more complex parsing for ip command
		// For now, just indicate network interface is available
		(*stats)["network_rx"] = "0.0 MB/s"
		(*stats)["network_tx"] = "0.0 MB/s"
	}
}

// GetActiveTabInfo returns information about the currently active tab and its system stats
func (a *App) GetActiveTabInfo() map[string]interface{} {
	// Use a timeout channel to prevent hanging
	resultChan := make(chan map[string]interface{}, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("GetActiveTabInfo panic recovered: %v\n", r)
				resultChan <- map[string]interface{}{"hasActiveTab": false}
			}
		}()

		a.mutex.RLock()
		activeTab := a.GetActiveTab()
		a.mutex.RUnlock()

		if activeTab == nil {
			resultChan <- map[string]interface{}{
				"hasActiveTab": false,
			}
			return
		}

		// Get tab info quickly (without holding mutex for long)
		a.mutex.RLock()
		info := map[string]interface{}{
			"hasActiveTab":   true,
			"tabId":          activeTab.ID,
			"title":          activeTab.Title,
			"connectionType": activeTab.ConnectionType,
			"status":         activeTab.Status,
		}
		sessionID := activeTab.SessionID
		sshConfig := activeTab.SSHConfig
		isSSH := activeTab.ConnectionType == "ssh"
		a.mutex.RUnlock()

		// Add system stats based on connection type and status (outside of mutex)
		if isSSH {
			info["isRemote"] = true

			// Add SSH connection details
			if sshConfig != nil {
				info["sshHost"] = sshConfig.Host
				info["sshPort"] = sshConfig.Port
				info["sshUsername"] = sshConfig.Username
			}

			// Only get remote stats if SSH is connected
			if activeTab.Status == "connected" {
				// Get remote system stats (this might be slow, so do it outside mutex)
				remoteStats := a.GetRemoteSystemStats(sessionID)
				info["systemStats"] = remoteStats
			} else {
				// For connecting/failed/disconnected SSH, return empty stats
				info["systemStats"] = map[string]interface{}{
					"hostname":     "unknown",
					"uptime":       "unknown",
					"load":         "unknown",
					"cpu":          "unknown",
					"memory":       "unknown",
					"memory_total": "unknown",
					"memory_used":  "unknown",
					"arch":         "unknown",
					"kernel":       "unknown",
					"network_rx":   "unknown",
					"network_tx":   "unknown",
				}
			}
		} else {
			info["isRemote"] = false

			// Only get local stats if the local shell is properly started/connected
			// For local shells, we consider any status other than "connecting" as ready
			if activeTab.Status != "connecting" {
				// Get local system stats (this is fast)
				localStats := a.GetSystemStats()
				info["systemStats"] = localStats
			} else {
				// For connecting local shells, return empty stats
				info["systemStats"] = map[string]interface{}{
					"hostname":     "unknown",
					"uptime":       "unknown",
					"load":         "unknown",
					"cpu":          "unknown",
					"memory":       "unknown",
					"memory_total": "unknown",
					"memory_used":  "unknown",
					"network_rx":   "unknown",
					"network_tx":   "unknown",
				}
			}
		}

		resultChan <- info
	}()

	// Wait for result with timeout
	select {
	case result := <-resultChan:
		return result
	case <-time.After(1500 * time.Millisecond): // 1.5 second timeout
		fmt.Println("GetActiveTabInfo timeout - returning empty result")
		return map[string]interface{}{
			"hasActiveTab": false,
			"error":        "timeout",
		}
	}
}

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
