package main

import (
	"fmt"
	"strings"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// MessageManager handles all terminal messaging and status updates
type MessageManager struct {
	app                  *App
	activePrompts        map[string]bool
	promptsMutex         sync.RWMutex
	connectionAnimations map[string]*ConnectionAnimation
	animationsMutex      sync.RWMutex
}

// ConnectionAnimation tracks ongoing connection animations
type ConnectionAnimation struct {
	sessionID string
	stopChan  chan bool
	isRunning bool
	mutex     sync.Mutex
}

// Extended status constants (building on existing ConnectionStatus)
const (
	StatusHanging       = "hanging"
	StatusHostKeyPrompt = "host-key-prompt"
)

// NewMessageManager creates a new message manager
func NewMessageManager(app *App) *MessageManager {
	return &MessageManager{
		app:                  app,
		activePrompts:        make(map[string]bool),
		connectionAnimations: make(map[string]*ConnectionAnimation),
	}
}

// EmitMessage sends a formatted message to the terminal
func (mm *MessageManager) EmitMessage(sessionID, message string, msgType MessageType) {
	// Check if a host key prompt is active for this session
	mm.promptsMutex.RLock()
	promptActive := mm.activePrompts[sessionID]
	mm.promptsMutex.RUnlock()

	// Don't emit additional messages if host key prompt is active
	if promptActive && msgType != MessageWarning && msgType != MessageError {
		fmt.Printf("[%s] (HOST KEY PROMPT ACTIVE) %s\n", sessionID, message)
		return
	}

	if mm.app.ctx != nil {
		var formattedMessage string

		switch msgType {
		case MessageInfo:
			formattedMessage = fmt.Sprintf("\x1b[36m● %s\x1b[0m\r\n", message)
		case MessageSuccess:
			formattedMessage = fmt.Sprintf("\x1b[32m✓ %s\x1b[0m\r\n", message)
		case MessageWarning:
			formattedMessage = fmt.Sprintf("\x1b[33m⚠ %s\x1b[0m\r\n", message)
		case MessageError:
			formattedMessage = fmt.Sprintf("\x1b[31m✗ %s\x1b[0m\r\n", message)
		case MessageProgress:
			formattedMessage = fmt.Sprintf("\x1b[90m⏳ %s\x1b[0m\r\n", message)
		case MessageDebug:
			// Don't show debug messages to user, only log to console
			fmt.Printf("[%s] DEBUG: %s\n", sessionID, message)
			return
		default:
			formattedMessage = fmt.Sprintf("%s\r\n", message)
		}

		wailsRuntime.EventsEmit(mm.app.ctx, "terminal-output", map[string]interface{}{
			"sessionId": sessionID,
			"data":      formattedMessage,
		})
	}

	// Log to console for debugging
	fmt.Printf("[%s] %s\n", sessionID, message)
}

// UpdateConnectionStatus updates both the tab status and emits appropriate messages
func (mm *MessageManager) UpdateConnectionStatus(sessionID string, status string, errorMsg string) {
	// Update tab status
	mm.updateTabStatus(sessionID, status, errorMsg)

	// Emit status update event
	if mm.app.ctx != nil {
		// Find tab associated with this session
		mm.app.mutex.RLock()
		var tab *Tab
		for _, t := range mm.app.terminal.tabs {
			if t.SessionID == sessionID {
				tab = t
				break
			}
		}
		mm.app.mutex.RUnlock()

		if tab != nil {
			wailsRuntime.EventsEmit(mm.app.ctx, "tab-status-update", map[string]interface{}{
				"tabId":        tab.ID,
				"status":       status,
				"errorMessage": errorMsg,
			})
		}
	}
}

// StartConnectionFlow starts the connection process with clean messaging
func (mm *MessageManager) StartConnectionFlow(sessionID string, target string, authMethods []string) {
	// Stop any existing animation for this session
	mm.stopConnectionAnimation(sessionID)

	// Update status to connecting
	mm.UpdateConnectionStatus(sessionID, StatusConnecting.String(), "")

	// Show authentication methods
	if len(authMethods) > 0 {
		mm.EmitMessage(sessionID, fmt.Sprintf("Authentication: %s", strings.Join(authMethods, ", ")), MessageInfo)
	}

	// Start connection message
	mm.EmitMessage(sessionID, fmt.Sprintf("Connecting to %s", target), MessageProgress)

	// Start connection animation
	mm.startConnectionAnimation(sessionID)
}

// ConnectionEstablished handles successful connection
func (mm *MessageManager) ConnectionEstablished(sessionID string) {
	// Stop animation
	mm.stopConnectionAnimation(sessionID)

	// Emit success messages
	mm.EmitMessage(sessionID, "Connection established", MessageSuccess)
	mm.EmitMessage(sessionID, "Creating session...", MessageProgress)
}

// SessionReady handles successful session creation
func (mm *MessageManager) SessionReady(sessionID string) {
	// Update status and emit final success
	mm.UpdateConnectionStatus(sessionID, StatusConnected.String(), "")
	mm.EmitMessage(sessionID, "SSH session ready", MessageSuccess)

	// Send terminal reset for clean session start
	mm.sendTerminalReset(sessionID)
}

// ConnectionFailed handles connection failures
func (mm *MessageManager) ConnectionFailed(sessionID string, err error) {
	// Stop animation
	mm.stopConnectionAnimation(sessionID)

	// Update status
	mm.UpdateConnectionStatus(sessionID, StatusFailed.String(), err.Error())

	// Clean up error message - remove redundant prefixes
	errMsg := err.Error()
	if strings.HasPrefix(errMsg, "failed to create SSH session: ") {
		errMsg = strings.TrimPrefix(errMsg, "failed to create SSH session: ")
	}
	if strings.HasPrefix(errMsg, "failed to connect to ") {
		// Extract just the core error part
		parts := strings.Split(errMsg, ": ")
		if len(parts) > 1 {
			errMsg = parts[len(parts)-1] // Get the last part
		}
	}

	// Emit clean error message
	mm.EmitMessage(sessionID, fmt.Sprintf("Connection failed: %s", errMsg), MessageError)

	// Emit troubleshooting hints
	hints := mm.getErrorHints(err.Error())
	if hints != "" {
		mm.EmitMessage(sessionID, "Troubleshooting suggestions:", MessageInfo)
		mm.EmitMessage(sessionID, hints, MessageInfo)
	}

	// Add retry hint
	mm.EmitMessage(sessionID, "Press Enter to retry connection", MessageInfo)
}

// SetHostKeyPromptActive marks a session as having an active host key prompt
func (mm *MessageManager) SetHostKeyPromptActive(sessionID string, active bool) {
	mm.promptsMutex.Lock()
	defer mm.promptsMutex.Unlock()

	if active {
		mm.activePrompts[sessionID] = true
		mm.UpdateConnectionStatus(sessionID, StatusHostKeyPrompt, "")
	} else {
		delete(mm.activePrompts, sessionID)
	}
}

// IsHostKeyPromptActive checks if a host key prompt is active for a session
func (mm *MessageManager) IsHostKeyPromptActive(sessionID string) bool {
	mm.promptsMutex.RLock()
	defer mm.promptsMutex.RUnlock()
	return mm.activePrompts[sessionID]
}

// startConnectionAnimation starts a subtle connection animation
func (mm *MessageManager) startConnectionAnimation(sessionID string) {
	mm.animationsMutex.Lock()
	defer mm.animationsMutex.Unlock()

	// Clean up any existing animation
	if existing, exists := mm.connectionAnimations[sessionID]; exists {
		existing.stop()
		delete(mm.connectionAnimations, sessionID)
	}

	// Create new animation
	animation := &ConnectionAnimation{
		sessionID: sessionID,
		stopChan:  make(chan bool, 1),
		isRunning: true,
	}
	mm.connectionAnimations[sessionID] = animation

	// Start animation in goroutine
	go func() {
		defer func() {
			animation.mutex.Lock()
			animation.isRunning = false
			animation.mutex.Unlock()

			mm.animationsMutex.Lock()
			delete(mm.connectionAnimations, sessionID)
			mm.animationsMutex.Unlock()
		}()

		dots := ""
		for {
			select {
			case <-animation.stopChan:
				return
			case <-time.After(500 * time.Millisecond):
				// Update dots
				dots += "."
				if len(dots) > 3 {
					dots = ""
				}

				// Send subtle progress update
				if mm.app.ctx != nil {
					// Just update the last line with dots - very subtle
					updateMsg := fmt.Sprintf("\r\x1b[90m⏳ Connecting%s\x1b[K", dots)
					wailsRuntime.EventsEmit(mm.app.ctx, "terminal-output", map[string]interface{}{
						"sessionId": sessionID,
						"data":      updateMsg,
					})
				}
			}
		}
	}()
}

// stopConnectionAnimation stops the connection animation for a session
func (mm *MessageManager) stopConnectionAnimation(sessionID string) {
	mm.animationsMutex.Lock()
	defer mm.animationsMutex.Unlock()

	if animation, exists := mm.connectionAnimations[sessionID]; exists {
		animation.stop()
		delete(mm.connectionAnimations, sessionID)

		// Clear the animation line to prevent mixing with next message
		if mm.app.ctx != nil {
			clearMsg := "\r\x1b[K" // Clear current line
			wailsRuntime.EventsEmit(mm.app.ctx, "terminal-output", map[string]interface{}{
				"sessionId": sessionID,
				"data":      clearMsg,
			})
		}
	}
}

// stop stops the connection animation
func (ca *ConnectionAnimation) stop() {
	ca.mutex.Lock()
	defer ca.mutex.Unlock()

	if ca.isRunning {
		close(ca.stopChan)
		ca.isRunning = false
	}
}

// updateTabStatus updates the tab status in the terminal manager
func (mm *MessageManager) updateTabStatus(sessionID, status, errorMsg string) {
	mm.app.terminal.mutex.Lock()
	defer mm.app.terminal.mutex.Unlock()

	for _, tab := range mm.app.terminal.tabs {
		if tab.SessionID == sessionID {
			tab.Status = status
			tab.ErrorMessage = errorMsg
			break
		}
	}
}

// sendTerminalReset sends terminal reset sequence for clean session
func (mm *MessageManager) sendTerminalReset(sessionID string) {
	if mm.app.ctx == nil {
		return
	}

	// Clean terminal reset sequence without visual separator
	clearTerminal := "\033[2J\033[H\033[3J\033[!p\033[?1049l\033[m"
	initSequence := "\033[?1l\033[?25h\033[0m"
	fullSequence := clearTerminal + initSequence

	wailsRuntime.EventsEmit(mm.app.ctx, "terminal-output", map[string]interface{}{
		"sessionId": sessionID,
		"data":      fullSequence,
	})
}

// getErrorHints provides troubleshooting hints based on error message
func (mm *MessageManager) getErrorHints(errorMsg string) string {
	errorLower := strings.ToLower(errorMsg)

	if strings.Contains(errorLower, "authentication failed") || strings.Contains(errorLower, "unable to authenticate") {
		return "Check username/password, verify SSH key permissions (chmod 600), try password authentication"
	}
	if strings.Contains(errorLower, "connection refused") {
		return "SSH server may not be running, check port 22 or custom port, verify firewall settings"
	}
	if strings.Contains(errorLower, "timeout") || strings.Contains(errorLower, "could not reach") {
		return "Check network connectivity, verify hostname/IP address, check VPN/proxy settings"
	}
	if strings.Contains(errorLower, "no route to host") || strings.Contains(errorLower, "not reachable") {
		return "Host may be down, check network routing, verify VPN connection if required"
	}
	if strings.Contains(errorLower, "host key") {
		return "Host key changed or unknown, check ~/.ssh/known_hosts, use ssh-keyscan to verify"
	}

	// Generic hints
	return "Check SSH server configuration, verify network connectivity, review SSH logs"
}

// Cleanup stops all animations and clears state
func (mm *MessageManager) Cleanup() {
	mm.animationsMutex.Lock()
	defer mm.animationsMutex.Unlock()

	// Stop all animations
	for sessionID, animation := range mm.connectionAnimations {
		animation.stop()
		delete(mm.connectionAnimations, sessionID)
	}

	// Clear prompts
	mm.promptsMutex.Lock()
	mm.activePrompts = make(map[string]bool)
	mm.promptsMutex.Unlock()
}
