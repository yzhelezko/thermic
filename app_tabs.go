package main

import (
	"fmt"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Tab Management Methods

// CreateTab creates a new terminal tab
func (a *App) CreateTab(shell string, sshConfig *SSHConfig) (*Tab, error) {
	a.terminal.mutex.Lock()
	defer a.terminal.mutex.Unlock()

	// Check tab limit
	if len(a.terminal.tabs) >= MaxSessions {
		return nil, fmt.Errorf("maximum number of tabs (%d) reached", MaxSessions)
	}

	// Generate unique IDs
	tabId := fmt.Sprintf("tab_%d", time.Now().UnixNano())
	sessionId := fmt.Sprintf("session_%d", time.Now().UnixNano())

	// Determine connection type and title
	connectionType := ConnectionTypeLocal
	status := StatusConnecting.String()
	title := shell
	if shell == "" {
		shell = a.GetDefaultShell()
		title = shell
	}

	// Handle SSH connections
	if sshConfig != nil {
		// Validate SSH config
		if err := sshConfig.Validate(); err != nil {
			return nil, fmt.Errorf("invalid SSH config: %w", err)
		}
		connectionType = ConnectionTypeSSH
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

	// Validate tab
	if err := tab.Validate(); err != nil {
		return nil, fmt.Errorf("invalid tab configuration: %w", err)
	}

	// Store tab
	a.terminal.tabs[tabId] = tab

	return tab, nil
}

// GetTabs returns all tabs
func (a *App) GetTabs() []*Tab {
	a.terminal.mutex.RLock()
	defer a.terminal.mutex.RUnlock()

	tabs := make([]*Tab, 0, len(a.terminal.tabs))
	for _, tab := range a.terminal.tabs {
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
	a.terminal.mutex.Lock()

	// Check if tab exists
	tab, exists := a.terminal.tabs[tabId]
	if !exists {
		a.terminal.mutex.Unlock()
		return fmt.Errorf("tab %s not found", tabId)
	}

	// Deactivate current active tab
	if a.terminal.activeTabId != "" {
		if currentTab, exists := a.terminal.tabs[a.terminal.activeTabId]; exists {
			currentTab.IsActive = false
		}
	}

	// Activate new tab
	tab.IsActive = true
	a.terminal.activeTabId = tabId

	// Copy tab data for event emission outside of mutex
	tabData := map[string]interface{}{
		"tabId":          tabId,
		"connectionType": tab.ConnectionType,
		"status":         tab.Status,
	}

	a.terminal.mutex.Unlock()

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
	a.terminal.mutex.RLock()
	defer a.terminal.mutex.RUnlock()

	if a.terminal.activeTabId == "" {
		return nil
	}

	return a.terminal.tabs[a.terminal.activeTabId]
}

// CloseTab closes a tab and its associated session
func (a *App) CloseTab(tabId string) error {
	a.terminal.mutex.Lock()
	defer a.terminal.mutex.Unlock()

	tab, exists := a.terminal.tabs[tabId]
	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	// Remove tab first
	delete(a.terminal.tabs, tabId)

	// Close the associated session asynchronously to avoid blocking
	if tab.SessionID != "" {
		go func(sessionID string) {
			if err := a.CloseShell(sessionID); err != nil {
				fmt.Printf("Error closing session %s: %v\n", sessionID, err)
			}
		}(tab.SessionID)
	}

	// If this was the active tab, find a new active tab
	if a.terminal.activeTabId == tabId {
		a.terminal.activeTabId = ""

		// Set first available tab as active
		for id, t := range a.terminal.tabs {
			t.IsActive = true
			a.terminal.activeTabId = id
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
	a.terminal.mutex.RLock()
	tab, exists := a.terminal.tabs[tabId]
	a.terminal.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	var err error

	// Handle SSH connections with unified messaging system
	if tab.ConnectionType == "ssh" && tab.SSHConfig != nil {
		// Start unified connection flow
		target := fmt.Sprintf("%s@%s:%d", tab.SSHConfig.Username, tab.SSHConfig.Host, tab.SSHConfig.Port)
		authMethods := []string{} // Will be populated in CreateSSHSession

		a.messages.StartConnectionFlow(tab.SessionID, target, authMethods)

		// Log dimensions for debugging SSH sizing issues
		fmt.Printf("SSH Connection Debug: Starting SSH session with dimensions %dx%d for %s\n", cols, rows, tab.SSHConfig.Host)

		// Attempt SSH connection with terminal dimensions
		err = a.startSSHSessionWithSize(tab, cols, rows)

		if err != nil {
			a.messages.ConnectionFailed(tab.SessionID, err)
		} else {
			a.messages.SessionReady(tab.SessionID)

			// For SSH connections, ensure proper terminal sizing immediately
			go func() {
				// Wait for SSH session to establish and terminal to be ready
				time.Sleep(500 * time.Millisecond)

				// Send multiple resize attempts to ensure proper SSH terminal sizing
				for i := 0; i < 3; i++ {
					// Request terminal size sync from frontend
					wailsRuntime.EventsEmit(a.ctx, "terminal-size-sync-request", map[string]interface{}{
						"sessionId": tab.SessionID,
						"immediate": true,
					})

					// Small delay between attempts
					if i < 2 {
						time.Sleep(200 * time.Millisecond)
					}
				}
			}()
		}
	} else {
		// Handle local shell with unified messaging
		err = a.StartShell(tab.Shell, tab.SessionID)

		if err != nil {
			a.messages.UpdateConnectionStatus(tab.SessionID, StatusFailed.String(), err.Error())
			// Send clean error message for local shells
			if a.ctx != nil {
				a.messages.EmitMessage(tab.SessionID, fmt.Sprintf("Failed to start shell: %s", tab.Shell), MessageError)
				a.messages.EmitMessage(tab.SessionID, err.Error(), MessageError)
			}
		} else {
			a.messages.UpdateConnectionStatus(tab.SessionID, StatusConnected.String(), "")
		}
	}

	return err
}

// startSSHSessionWithSize starts an SSH session for a tab with specified terminal dimensions
func (a *App) startSSHSessionWithSize(tab *Tab, cols, rows int) error {
	// Create native SSH session with terminal dimensions
	sshSession, err := a.CreateSSHSessionWithSize(tab.SessionID, tab.SSHConfig, cols, rows)
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}

	// Store SSH session
	a.ssh.sshSessionsMutex.Lock()
	a.ssh.sshSessions[tab.SessionID] = sshSession
	a.ssh.sshSessionsMutex.Unlock()

	// Start SSH shell
	if err := a.StartSSHShell(sshSession); err != nil {
		// Clean up on failure
		a.ssh.sshSessionsMutex.Lock()
		delete(a.ssh.sshSessions, tab.SessionID)
		a.ssh.sshSessionsMutex.Unlock()
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
	a.terminal.mutex.Lock()
	defer a.terminal.mutex.Unlock()

	tab, exists := a.terminal.tabs[tabId]
	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	tab.Title = newTitle
	return nil
}

// GetTabStatus returns the status of a specific tab
func (a *App) GetTabStatus(tabId string) (map[string]interface{}, error) {
	a.terminal.mutex.RLock()
	defer a.terminal.mutex.RUnlock()

	tab, exists := a.terminal.tabs[tabId]
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
	a.terminal.mutex.RLock()
	tab, exists := a.terminal.tabs[tabId]
	a.terminal.mutex.RUnlock()

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
	a.terminal.mutex.Lock()
	tab.Status = "disconnected"
	tab.ErrorMessage = "Forcefully disconnected"
	a.terminal.mutex.Unlock()

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
	a.terminal.mutex.Lock()
	tab, exists := a.terminal.tabs[tabId]
	if !exists {
		a.terminal.mutex.Unlock()
		return fmt.Errorf("tab %s not found", tabId)
	}

	// Only allow reconnection for SSH tabs
	if tab.ConnectionType != "ssh" || tab.SSHConfig == nil {
		a.terminal.mutex.Unlock()
		return fmt.Errorf("tab %s is not an SSH connection", tabId)
	}

	// Update status to connecting
	tab.Status = "connecting"
	tab.ErrorMessage = ""
	sessionID := tab.SessionID
	a.terminal.mutex.Unlock()

	// Emit status update
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":  tabId,
			"status": "connecting",
		})
	}

	// CRITICAL FIX: Clean up old failed/disconnected session before reconnecting
	fmt.Printf("Cleaning up old session before reconnect: %s\n", sessionID)

	// Close SFTP client for old session
	a.CloseFileExplorerSession(sessionID)

	// Close and remove old SSH session if it exists. We MUST wait for the old
	// session's waitForSSHSessionEnd goroutine to finish before reusing this
	// SessionID — otherwise its trailing UpdateConnectionStatus(StatusFailed) +
	// "Press Enter to reconnect" message will fire against the same SessionID
	// that's now bound to the *new* session and overwrite its "connecting"
	// status. SetCleaning(true) tells those handlers to short-circuit.
	a.ssh.sshSessionsMutex.Lock()
	oldSession, hadOld := a.ssh.sshSessions[sessionID]
	if hadOld {
		fmt.Printf("Removing old SSH session: %s\n", sessionID)
		oldSession.SetCleaning(true)
		delete(a.ssh.sshSessions, sessionID)
	}
	a.ssh.sshSessionsMutex.Unlock()

	if hadOld {
		// Initiate close (synchronous now, see CloseSSHSession). Then wait for
		// the session-end handler to finish so no stale events race the new
		// session's startup. Bound the wait so a wedged remote peer can't block
		// reconnect indefinitely.
		_ = a.CloseSSHSession(oldSession)
		select {
		case <-oldSession.done:
		case <-time.After(3 * time.Second):
			fmt.Printf("Timed out waiting for old SSH session %s to finish; proceeding\n", sessionID)
		}
	}

	// Start unified connection flow
	target := fmt.Sprintf("%s@%s:%d", tab.SSHConfig.Username, tab.SSHConfig.Host, tab.SSHConfig.Port)
	a.messages.StartConnectionFlow(sessionID, target, []string{})

	// Get current terminal dimensions from the frontend
	cols, rows := 80, 24 // default fallback

	// Start fresh SSH session with current dimensions
	err := a.startSSHSessionWithSize(tab, cols, rows)
	if err != nil {
		a.messages.ConnectionFailed(sessionID, err)
		return err
	}

	a.messages.SessionReady(sessionID)

	// Reinitialize SFTP client for file manager functionality
	fmt.Printf("Reinitializing SFTP client for session: %s\n", sessionID)
	if err := a.InitializeFileExplorerSession(sessionID); err != nil {
		fmt.Printf("Warning: Failed to reinitialize SFTP client: %v\n", err)
		// Don't fail the reconnection if SFTP init fails
	} else {
		// Emit event to refresh file explorer if it's open
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "sftp-reconnected", map[string]interface{}{
				"sessionId": sessionID,
			})
		}
	}

	// Trigger enhanced terminal sizing after successful reconnection
	if a.ctx != nil {
		go func() {
			// Give the connection a moment to stabilize
			time.Sleep(100 * time.Millisecond)

			// Emit reconnection sizing event to frontend to trigger Phase 2 sizing system
			wailsRuntime.EventsEmit(a.ctx, "tab-reconnected-sizing", map[string]interface{}{
				"sessionId": sessionID,
				"tabId":     tabId,
				"immediate": true, // Flag for immediate enhanced sizing
			})
		}()
	}

	return nil
}

// ReorderTabs reorders tabs based on the provided tab IDs array
func (a *App) ReorderTabs(tabIds []string) error {
	a.terminal.mutex.Lock()
	defer a.terminal.mutex.Unlock()

	// Validate that all provided tab IDs exist
	for _, tabId := range tabIds {
		if _, exists := a.terminal.tabs[tabId]; !exists {
			return fmt.Errorf("tab %s not found", tabId)
		}
	}

	// Validate that all existing tabs are included in the reorder
	if len(tabIds) != len(a.terminal.tabs) {
		return fmt.Errorf("tab count mismatch: expected %d, got %d", len(a.terminal.tabs), len(tabIds))
	}

	// Update the creation time of tabs to reflect the new order
	// We'll use the current time as base and increment by nanoseconds
	baseTime := time.Now()
	for i, tabId := range tabIds {
		if tab, exists := a.terminal.tabs[tabId]; exists {
			// Set creation time to maintain the desired order
			tab.Created = baseTime.Add(time.Duration(i) * time.Nanosecond)
		}
	}

	return nil
}

// captureOpenTabsForRestore snapshots open tabs into config.LastOpenTabs.
// Called from shutdown. Honors RestoreTabsOnLaunch — clears the snapshot when disabled
// so we never replay stale state if the user toggles it back on later.
func (a *App) captureOpenTabsForRestore() {
	if a.config == nil || a.config.config == nil {
		return
	}

	if !a.config.config.RestoreTabsOnLaunch {
		if len(a.config.config.LastOpenTabs) > 0 {
			a.config.config.LastOpenTabs = nil
			a.markConfigDirty()
		}
		return
	}

	a.terminal.mutex.RLock()
	tabs := make([]*Tab, 0, len(a.terminal.tabs))
	for _, tab := range a.terminal.tabs {
		tabs = append(tabs, tab)
	}
	a.terminal.mutex.RUnlock()

	// Sort by creation order so they reopen in the same order
	for i := 0; i < len(tabs)-1; i++ {
		for j := i + 1; j < len(tabs); j++ {
			if tabs[i].Created.After(tabs[j].Created) {
				tabs[i], tabs[j] = tabs[j], tabs[i]
			}
		}
	}

	activeTabID := a.terminal.activeTabId
	saved := make([]SavedTab, 0, len(tabs))
	for _, tab := range tabs {
		entry := SavedTab{
			ProfileID:           tab.ProfileID,
			Title:               tab.Title,
			LastFileManagerPath: tab.LastFileManagerPath,
			LastSidebarView:     tab.LastSidebarView,
			IsActive:            tab.ID == activeTabID,
		}
		// Identity preference: ProfileID (resolves to current profile data on
		// restore, including any updates) > raw SSHConfig (ad-hoc SSH tab) >
		// Shell (local).
		if tab.ProfileID == "" {
			if tab.ConnectionType == ConnectionTypeSSH && tab.SSHConfig != nil {
				// Strip password — we don't want plaintext credentials in
				// config.yaml. The user will be prompted on reconnect, or
				// agent/key auth will pick up.
				cfgCopy := *tab.SSHConfig
				cfgCopy.Password = ""
				entry.SSHConfig = &cfgCopy
			} else {
				entry.Shell = tab.Shell
			}
		}
		saved = append(saved, entry)
	}

	a.config.config.LastOpenTabs = saved
	a.markConfigDirty()
	fmt.Printf("Captured %d tab(s) for next-launch restore.\n", len(saved))
}

// RestoreTabs recreates tabs from the previous-session snapshot if the feature is enabled
// and the in-memory tab map is empty (i.e. fresh launch). Returns the recreated tabs so
// the frontend can drive shell startup the same way it does for normal tabs.
func (a *App) RestoreTabs() ([]*Tab, error) {
	if a.config == nil || a.config.config == nil {
		return nil, nil
	}
	if !a.config.config.RestoreTabsOnLaunch {
		return nil, nil
	}

	a.terminal.mutex.RLock()
	hasExisting := len(a.terminal.tabs) > 0
	a.terminal.mutex.RUnlock()
	if hasExisting {
		return nil, nil
	}

	saved := a.config.config.LastOpenTabs
	if len(saved) == 0 {
		return nil, nil
	}

	restored := make([]*Tab, 0, len(saved))
	activeIdx := -1
	for _, entry := range saved {
		var tab *Tab
		var err error
		switch {
		case entry.ProfileID != "":
			tab, err = a.CreateTabFromProfile(entry.ProfileID)
		case entry.SSHConfig != nil:
			// Ad-hoc SSH tab — no profile to resolve. Password was stripped
			// on save, so auth will fall back to agent/keys. If neither is
			// available the connection will fail and the user can supply a
			// password through the normal flow.
			tab, err = a.CreateTab("", entry.SSHConfig)
		case entry.Shell != "":
			tab, err = a.CreateTab(entry.Shell, nil)
		default:
			continue
		}
		if err != nil {
			fmt.Printf("Skipping tab restore (%+v): %v\n", entry, err)
			continue
		}

		// Restore runtime hints. Custom title overrides the default that
		// CreateTab* generated; path/view are pushed back to the frontend so
		// it can re-seed the file manager state map and sidebar view.
		a.terminal.mutex.Lock()
		if entry.Title != "" {
			tab.Title = entry.Title
		}
		tab.LastFileManagerPath = entry.LastFileManagerPath
		tab.LastSidebarView = entry.LastSidebarView
		a.terminal.mutex.Unlock()

		if entry.IsActive && activeIdx < 0 {
			activeIdx = len(restored)
		}
		restored = append(restored, tab)
	}

	// Pick which tab to mark active. Prefer the one flagged in the snapshot;
	// fall back to the first restored tab if no flag survived (older snapshot
	// or all entries failed to restore).
	if len(restored) > 0 {
		if activeIdx < 0 {
			activeIdx = 0
		}
		a.terminal.mutex.Lock()
		a.terminal.activeTabId = restored[activeIdx].ID
		restored[activeIdx].IsActive = true
		a.terminal.mutex.Unlock()
	}

	fmt.Printf("Restored %d tab(s) from previous session.\n", len(restored))
	return restored, nil
}

// SetTabFileManagerPath records the last directory the SFTP file manager was
// showing for the given tab. Called from the frontend whenever the user
// navigates so the value is fresh when shutdown captures the snapshot.
// Pushed lazily — failure to update is non-fatal (worst case the tab restores
// to the remote home next launch).
func (a *App) SetTabFileManagerPath(tabID, path string) error {
	a.terminal.mutex.Lock()
	defer a.terminal.mutex.Unlock()
	tab, exists := a.terminal.tabs[tabID]
	if !exists {
		return fmt.Errorf("tab %s not found", tabID)
	}
	tab.LastFileManagerPath = path
	return nil
}

// SetTabSidebarView records which sidebar panel ("profiles" | "files") was
// last shown while this tab was active. Used both for cross-restart
// restoration and for per-tab "remember the panel I was on" behavior on tab
// switches inside a single session.
func (a *App) SetTabSidebarView(tabID, view string) error {
	a.terminal.mutex.Lock()
	defer a.terminal.mutex.Unlock()
	tab, exists := a.terminal.tabs[tabID]
	if !exists {
		return fmt.Errorf("tab %s not found", tabID)
	}
	tab.LastSidebarView = view
	return nil
}

// CreateTabFromProfile creates a new tab using a profile
func (a *App) CreateTabFromProfile(profileID string) (*Tab, error) {
	a.profiles.mutex.RLock()
	profile, exists := a.profiles.profiles[profileID]
	a.profiles.mutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("profile not found: %s", profileID)
	}

	// Update usage tracking
	go a.updateProfileUsage(profileID)

	// Create tab based on profile type
	var tab *Tab
	var err error
	switch profile.Type {
	case "ssh":
		tab, err = a.CreateTab("", profile.SSHConfig)
	default:
		tab, err = a.CreateTab(profile.Shell, nil)
	}

	// Set the profile ID on the created tab
	if err == nil && tab != nil {
		tab.ProfileID = profileID
	}

	return tab, err
}
