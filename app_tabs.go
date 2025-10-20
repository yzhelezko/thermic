package main

import (
	"fmt"
	"net"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Tab Management Methods

// CreateTab creates a new terminal tab (legacy - supports local and SSH only)
func (a *App) CreateTab(shell string, sshConfig *SSHConfig) (*Tab, error) {
	return a.CreateTabEx(shell, sshConfig, nil)
}

// CreateTabEx creates a new terminal tab with extended support for all connection types
func (a *App) CreateTabEx(shell string, sshConfig *SSHConfig, rdpConfig *RDPConfig) (*Tab, error) {
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

	// Handle RDP connections
	if rdpConfig != nil {
		// Validate RDP config
		if err := rdpConfig.Validate(); err != nil {
			return nil, fmt.Errorf("invalid RDP config: %w", err)
		}
		connectionType = ConnectionTypeRDP
		title = fmt.Sprintf("%s@%s (RDP)", rdpConfig.Username, rdpConfig.Host)
		if rdpConfig.Port != 3389 {
			title = fmt.Sprintf("%s@%s:%d (RDP)", rdpConfig.Username, rdpConfig.Host, rdpConfig.Port)
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
		RDPConfig:      rdpConfig,
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

	// Handle RDP connections
	if tab.ConnectionType == "rdp" && tab.RDPConfig != nil {
		// Start unified connection flow for RDP
		target := fmt.Sprintf("%s@%s:%d (RDP)", tab.RDPConfig.Username, tab.RDPConfig.Host, tab.RDPConfig.Port)
		a.messages.StartConnectionFlow(tab.SessionID, target, []string{"RDP Protocol"})

		fmt.Printf("RDP Connection: Starting RDP session with dimensions %dx%d for %s\n", cols, rows, tab.RDPConfig.Host)

		// Attempt RDP connection with terminal dimensions
		err = a.startRDPSessionWithSize(tab, cols, rows)

		if err != nil {
			a.messages.ConnectionFailed(tab.SessionID, err)
		} else {
			a.messages.SessionReady(tab.SessionID)
		}
	} else if tab.ConnectionType == "ssh" && tab.SSHConfig != nil {
		// Handle SSH connections with unified messaging system
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

// ForceDisconnectTab forcefully disconnects a hanging SSH or RDP tab
func (a *App) ForceDisconnectTab(tabId string) error {
	a.terminal.mutex.RLock()
	tab, exists := a.terminal.tabs[tabId]
	a.terminal.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("tab %s not found", tabId)
	}

	if tab.ConnectionType == "ssh" {
		// Force disconnect the SSH session
		if err := a.ForceDisconnectSSHSession(tab.SessionID); err != nil {
			return fmt.Errorf("failed to force disconnect SSH session: %w", err)
		}
	} else if tab.ConnectionType == "rdp" {
		// Force disconnect the RDP session
		if err := a.CloseRDPSession(tab.SessionID); err != nil {
			return fmt.Errorf("failed to force disconnect RDP session: %w", err)
		}
	} else {
		return fmt.Errorf("tab %s is not a remote connection (SSH/RDP)", tabId)
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

// ReconnectTab reconnects a disconnected SSH or RDP tab
func (a *App) ReconnectTab(tabId string) error {
	a.terminal.mutex.Lock()
	tab, exists := a.terminal.tabs[tabId]
	if !exists {
		a.terminal.mutex.Unlock()
		return fmt.Errorf("tab %s not found", tabId)
	}

	// Allow reconnection for SSH and RDP tabs
	if tab.ConnectionType == "ssh" && tab.SSHConfig != nil {
		return a.reconnectSSHTab(tab)
	} else if tab.ConnectionType == "rdp" && tab.RDPConfig != nil {
		return a.reconnectRDPTab(tab)
	}

	a.terminal.mutex.Unlock()
	return fmt.Errorf("tab %s is not a remote connection (SSH/RDP)", tabId)
}

// reconnectSSHTab reconnects a disconnected SSH tab
func (a *App) reconnectSSHTab(tab *Tab) error {

	// Update status to connecting
	tab.Status = "connecting"
	tab.ErrorMessage = ""
	sessionID := tab.SessionID
	tabID := tab.ID
	a.terminal.mutex.Unlock()

	// Emit status update
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":  tabID,
			"status": "connecting",
		})
	}

	// CRITICAL FIX: Clean up old failed/disconnected session before reconnecting
	fmt.Printf("Cleaning up old session before reconnect: %s\n", sessionID)

	// Close SFTP client for old session
	a.CloseFileExplorerSession(sessionID)

	// Close and remove old SSH session if it exists
	a.ssh.sshSessionsMutex.Lock()
	if oldSession, exists := a.ssh.sshSessions[sessionID]; exists {
		fmt.Printf("Removing old SSH session: %s\n", sessionID)
		// Mark as cleaning and close
		a.CloseSSHSession(oldSession)
		// Remove from map
		delete(a.ssh.sshSessions, sessionID)
	}
	a.ssh.sshSessionsMutex.Unlock()

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
				"tabId":     tabID,
				"immediate": true, // Flag for immediate enhanced sizing
			})
		}()
	}

	return nil
}

// reconnectRDPTab reconnects a disconnected RDP tab
func (a *App) reconnectRDPTab(tab *Tab) error {
	// Update status to connecting
	tab.Status = "connecting"
	tab.ErrorMessage = ""
	sessionID := tab.SessionID
	tabID := tab.ID
	a.terminal.mutex.Unlock()

	// Emit status update
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":  tabID,
			"status": "connecting",
		})
	}

	// Clean up old failed/disconnected session before reconnecting
	fmt.Printf("Cleaning up old RDP session before reconnect: %s\n", sessionID)

	// Close and remove old RDP session if it exists
	a.rdp.rdpSessionsMutex.Lock()
	if oldSession, exists := a.rdp.rdpSessions[sessionID]; exists {
		fmt.Printf("Removing old RDP session: %s\n", sessionID)
		// Close connection
		if oldSession.conn != nil {
			if conn, ok := oldSession.conn.(net.Conn); ok {
				conn.Close()
			}
		}
		// Remove from map
		delete(a.rdp.rdpSessions, sessionID)
	}
	a.rdp.rdpSessionsMutex.Unlock()

	// Get current canvas dimensions from the frontend
	width, height := 1024, 768 // default fallback

	// Start fresh RDP session with current dimensions
	err := a.startRDPSessionWithSize(tab, width, height)
	if err != nil {
		a.messages.ConnectionFailed(sessionID, err)
		return err
	}

	fmt.Printf("RDP session reconnected successfully for %s\n", sessionID)
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
		tab, err = a.CreateTabEx("", profile.SSHConfig, nil)
	case "rdp":
		tab, err = a.CreateTabEx("", nil, profile.RDPConfig)
	default:
		tab, err = a.CreateTabEx(profile.Shell, nil, nil)
	}

	// Set the profile ID on the created tab
	if err == nil && tab != nil {
		tab.ProfileID = profileID
	}

	return tab, err
}

// startRDPSessionWithSize starts an RDP session for a tab with specified dimensions
func (a *App) startRDPSessionWithSize(tab *Tab, cols, rows int) error {
	// Update RDP config with current dimensions
	tab.RDPConfig.Width = cols
	tab.RDPConfig.Height = rows

	// Create RDP session with dimensions
	rdpSession, err := a.CreateRDPSessionWithSize(tab.SessionID, tab.RDPConfig, cols, rows)
	if err != nil {
		return fmt.Errorf("failed to create RDP session: %w", err)
	}

	// Store RDP session
	a.rdp.rdpSessionsMutex.Lock()
	a.rdp.rdpSessions[tab.SessionID] = rdpSession
	a.rdp.rdpSessionsMutex.Unlock()

	fmt.Printf("RDP session started for %s with dimensions %dx%d\n", tab.SessionID, cols, rows)

	return nil
}
