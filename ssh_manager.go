package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
)

// SSHSession represents a native SSH session
type SSHSession struct {
	// Core SSH connection fields
	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
	stderr  io.Reader

	// Channel management
	done       chan bool
	closed     chan bool
	forceClose chan bool

	// Terminal dimensions
	cols int
	rows int

	// Session state (protected by mutex)
	mu           sync.RWMutex
	cleaning     bool
	sessionID    string
	lastActivity time.Time
	isHanging    bool

	// Monitoring session for system stats
	monitoringClient  *ssh.Client
	monitoringEnabled bool
	monitoringCache   map[string]string
	monitoringMutex   sync.RWMutex

	// Resource tracking for cleanup
	activeGoroutines int32
}

// PendingHostKeyUpdate stores information about a host key that needs user approval
type PendingHostKeyUpdate struct {
	SessionID      string
	Hostname       string
	KnownHostsPath string
	Remote         net.Addr
	NewKey         ssh.PublicKey
	KeyError       *knownhosts.KeyError
}

// Thread-safe getters and setters for SSHSession state
func (s *SSHSession) SetCleaning(cleaning bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleaning = cleaning
}

func (s *SSHSession) IsCleaning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cleaning
}

func (s *SSHSession) UpdateLastActivity() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastActivity = time.Now()
	s.isHanging = false
}

func (s *SSHSession) GetLastActivity() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastActivity
}

func (s *SSHSession) SetHanging(hanging bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.isHanging = hanging
}

func (s *SSHSession) IsHanging() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isHanging
}

// createHostKeyCallback creates a sophisticated host key callback with user interaction
func (a *App) createHostKeyCallback(sessionID string) ssh.HostKeyCallback {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		a.emitTerminalMessage(sessionID, "WARNING: Could not determine home directory, using insecure host key verification")
		return ssh.InsecureIgnoreHostKey()
	}

	knownHostsPath := filepath.Join(homeDir, ".ssh", "known_hosts")

	// Ensure .ssh directory exists
	sshDir := filepath.Dir(knownHostsPath)
	if err := os.MkdirAll(sshDir, 0700); err != nil {
		a.emitTerminalMessage(sessionID, fmt.Sprintf("WARNING: Could not create .ssh directory: %v", err))
		return ssh.InsecureIgnoreHostKey()
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		// Try to load existing known_hosts file
		callback, err := knownhosts.New(knownHostsPath)
		if err != nil {
			// known_hosts file doesn't exist or can't be read, create it
			a.emitTerminalMessage(sessionID, fmt.Sprintf("Creating new known_hosts file: %s", knownHostsPath))
			return a.addHostKeyToKnownHosts(sessionID, knownHostsPath, hostname, remote, key)
		}

		// Try to verify with existing known_hosts
		err = callback(hostname, remote, key)
		if err != nil {
			// Handle different types of host key errors
			if keyErr, ok := err.(*knownhosts.KeyError); ok {
				return a.handleHostKeyError(sessionID, knownHostsPath, hostname, remote, key, keyErr)
			}

			// Generic error
			a.emitTerminalMessage(sessionID, fmt.Sprintf("Host key verification failed: %v", err))
			return err
		}

		return nil
	}
}

// MessageType defines different types of SSH messages
type MessageType int

const (
	MessageInfo MessageType = iota
	MessageSuccess
	MessageWarning
	MessageError
	MessageProgress
	MessageDebug
)

// emitTerminalMessage sends a basic message (for backward compatibility)
func (a *App) emitTerminalMessage(sessionID, message string) {
	a.messages.EmitMessage(sessionID, message, MessageInfo)
}

// addHostKeyToKnownHosts adds a new host key to the known_hosts file
func (a *App) addHostKeyToKnownHosts(sessionID, knownHostsPath, hostname string, remote net.Addr, key ssh.PublicKey) error {
	a.messages.EmitMessage(sessionID, fmt.Sprintf("Adding %s to known hosts", hostname), MessageProgress)

	// Create the host entry
	hostEntry := knownhosts.Line([]string{hostname}, key)

	// Append to known_hosts file
	file, err := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("failed to open known_hosts file: %w", err)
	}
	defer file.Close()

	if _, err := file.WriteString(hostEntry + "\n"); err != nil {
		return fmt.Errorf("failed to write to known_hosts file: %w", err)
	}

	a.messages.EmitMessage(sessionID, fmt.Sprintf("Host %s verified and added", hostname), MessageSuccess)
	return nil
}

// handleHostKeyError handles various host key verification errors
func (a *App) handleHostKeyError(sessionID, knownHostsPath, hostname string, remote net.Addr, key ssh.PublicKey, keyErr *knownhosts.KeyError) error {
	if len(keyErr.Want) == 0 {
		// Host not in known_hosts, add it
		a.messages.EmitMessage(sessionID, fmt.Sprintf("New host: %s", hostname), MessageInfo)
		return a.addHostKeyToKnownHosts(sessionID, knownHostsPath, hostname, remote, key)
	}

	// Host key has changed - this is potentially dangerous
	a.messages.EmitMessage(sessionID, fmt.Sprintf("Host key changed for %s!", hostname), MessageWarning)
	a.messages.EmitMessage(sessionID, "This could indicate a security issue - verify before continuing", MessageWarning)

	// Get key fingerprints for display
	oldFingerprint := ""
	if len(keyErr.Want) > 0 {
		oldFingerprint = ssh.FingerprintSHA256(keyErr.Want[0].Key)
	}
	newFingerprint := ssh.FingerprintSHA256(key)

	a.messages.EmitMessage(sessionID, fmt.Sprintf("Old: %s", oldFingerprint), MessageInfo)
	a.messages.EmitMessage(sessionID, fmt.Sprintf("New: %s", newFingerprint), MessageInfo)

	// Store the pending host key info for user decision
	a.storePendingHostKeyUpdate(sessionID, hostname, knownHostsPath, remote, key, keyErr)

	// Mark that a host key prompt is active for this session
	a.messages.SetHostKeyPromptActive(sessionID, true)

	// Show interactive prompt in terminal
	a.messages.EmitMessage(sessionID, "", MessageInfo)
	a.messages.EmitMessage(sessionID, "Continue connecting? (ENTER=yes, ESC=no)", MessageWarning)

	// Emit a special event for the frontend to handle keyboard input
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "host-key-prompt", map[string]interface{}{
			"sessionId":      sessionID,
			"hostname":       hostname,
			"oldFingerprint": oldFingerprint,
			"newFingerprint": newFingerprint,
			"type":           "keyboard-prompt",
		})
	}

	// Return a specific error that indicates user intervention is needed
	return fmt.Errorf("host key verification pending user approval")
}

// UpdateHostKey manually updates a host key in known_hosts (can be called from frontend)
func (a *App) UpdateHostKey(sessionID, hostname string, acceptNewKey bool) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("could not determine home directory: %w", err)
	}

	knownHostsPath := filepath.Join(homeDir, ".ssh", "known_hosts")

	if !acceptNewKey {
		a.emitTerminalMessage(sessionID, "Host key update cancelled by user")
		return fmt.Errorf("host key update cancelled")
	}

	// This would typically be called after a host key verification failure
	// For now, we'll just emit a message that the key would be updated
	a.emitTerminalMessage(sessionID, fmt.Sprintf("Would update host key for %s in %s", hostname, knownHostsPath))
	a.emitTerminalMessage(sessionID, "Note: Automatic host key updates not yet implemented for security")

	return nil
}

// Package-level storage for pending host key updates (in production, this could be stored in App struct)
var pendingHostKeyUpdates = make(map[string]*PendingHostKeyUpdate)
var pendingHostKeyMutex sync.RWMutex

// storePendingHostKeyUpdate stores a pending host key update for user approval
func (a *App) storePendingHostKeyUpdate(sessionID, hostname, knownHostsPath string, remote net.Addr, key ssh.PublicKey, keyErr *knownhosts.KeyError) {
	pendingHostKeyMutex.Lock()
	defer pendingHostKeyMutex.Unlock()

	pendingHostKeyUpdates[sessionID] = &PendingHostKeyUpdate{
		SessionID:      sessionID,
		Hostname:       hostname,
		KnownHostsPath: knownHostsPath,
		Remote:         remote,
		NewKey:         key,
		KeyError:       keyErr,
	}
}

// ApproveHostKeyUpdate handles user approval/rejection of host key changes
func (a *App) ApproveHostKeyUpdate(sessionID string, approved bool) error {
	// Clear the host key prompt active flag first
	a.messages.SetHostKeyPromptActive(sessionID, false)

	pendingHostKeyMutex.Lock()
	pending, exists := pendingHostKeyUpdates[sessionID]
	if exists && approved {
		// Keep the pending update for processing
	} else {
		// Remove the pending update
		delete(pendingHostKeyUpdates, sessionID)
	}
	pendingHostKeyMutex.Unlock()

	if !exists {
		return fmt.Errorf("no pending host key update found for session %s", sessionID)
	}

	if !approved {
		a.messages.EmitMessage(sessionID, "Connection cancelled", MessageWarning)
		return fmt.Errorf("host key update rejected by user")
	}

	// User approved the update - overwrite the known_hosts entry
	a.messages.EmitMessage(sessionID, "Updating known_hosts...", MessageProgress)

	err := a.updateKnownHostsEntry(pending)
	if err != nil {
		a.messages.EmitMessage(sessionID, fmt.Sprintf("Failed to update: %v", err), MessageError)
		return err
	}

	// Clean up the pending update
	pendingHostKeyMutex.Lock()
	delete(pendingHostKeyUpdates, sessionID)
	pendingHostKeyMutex.Unlock()

	a.messages.EmitMessage(sessionID, "Host key updated - retry connection", MessageSuccess)

	return nil
}

// updateKnownHostsEntry updates a specific host entry in known_hosts file
func (a *App) updateKnownHostsEntry(pending *PendingHostKeyUpdate) error {
	// Read the current known_hosts file
	content, err := os.ReadFile(pending.KnownHostsPath)
	if err != nil {
		return fmt.Errorf("failed to read known_hosts file: %w", err)
	}

	lines := strings.Split(string(content), "\n")
	var updatedLines []string
	hostname := pending.Hostname
	newHostEntry := knownhosts.Line([]string{hostname}, pending.NewKey)

	// Process each line
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			// Keep empty lines and comments
			updatedLines = append(updatedLines, line)
			continue
		}

		// Check if this line is for our hostname
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			hosts := strings.Split(parts[0], ",")
			isOurHost := false
			for _, host := range hosts {
				if host == hostname || (strings.Contains(hostname, ":") && host == strings.Split(hostname, ":")[0]) {
					isOurHost = true
					break
				}
			}

			if isOurHost {
				// Skip this line (we'll replace it)
				continue
			}
		}

		updatedLines = append(updatedLines, line)
	}

	// Add the new host entry
	updatedLines = append(updatedLines, newHostEntry)

	// Write the updated content back
	newContent := strings.Join(updatedLines, "\n")
	if !strings.HasSuffix(newContent, "\n") {
		newContent += "\n"
	}

	return os.WriteFile(pending.KnownHostsPath, []byte(newContent), 0600)
}

// CreateSSHSession creates a new SSH connection and session
func (a *App) CreateSSHSession(sessionID string, config *SSHConfig) (*SSHSession, error) {
	return a.CreateSSHSessionWithSize(sessionID, config, 80, 24)
}

// CreateSSHSessionWithSize creates a new SSH connection and session with specified terminal size
func (a *App) CreateSSHSessionWithSize(sessionID string, config *SSHConfig, cols, rows int) (*SSHSession, error) {
	// Validate configuration
	if config.Host == "" {
		return nil, fmt.Errorf("SSH host cannot be empty")
	}
	if config.Username == "" {
		return nil, fmt.Errorf("SSH username cannot be empty")
	}
	if config.Port <= 0 || config.Port > 65535 {
		return nil, fmt.Errorf("SSH port must be between 1 and 65535")
	}

	// Validate terminal dimensions
	if cols <= 0 || rows <= 0 {
		cols, rows = 80, 24 // fallback to default
	}

	// Create SSH client configuration with secure host key verification
	sshConfig := &ssh.ClientConfig{
		User:            config.Username,
		HostKeyCallback: a.createHostKeyCallback(sessionID),
		Timeout:         10 * time.Second,
	}

	// Add authentication methods
	authMethodsAdded := 0
	var authMethods []string

	if config.Password != "" {
		authMethods = append(authMethods, "password")
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(config.Password))
		authMethodsAdded++
	}

	if config.KeyPath != "" {
		a.messages.EmitMessage(sessionID, fmt.Sprintf("Loading key: %s", filepath.Base(config.KeyPath)), MessageProgress)
		key, err := a.loadSSHKey(config.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load SSH key from %s: %w", config.KeyPath, err)
		} else {
			authMethods = append(authMethods, "private key")
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
			authMethodsAdded++
		}
	}

	// If no auth methods, try ssh-agent or default keys
	if authMethodsAdded == 0 {
		a.messages.EmitMessage(sessionID, "Discovering authentication methods...", MessageProgress)

		// Try to add default authentication methods
		if agentAuth, err := a.getSSHAgentAuth(); err == nil {
			authMethods = append(authMethods, "SSH agent")
			sshConfig.Auth = append(sshConfig.Auth, agentAuth)
			authMethodsAdded++
		}

		// Try default key locations using platform-specific paths (only if allowed)
		var validKeys []ssh.Signer
		if config.AllowKeyAutoDiscovery {
			defaultKeys := a.getDefaultSSHKeyPaths()
			for _, keyPath := range defaultKeys {
				if key, err := a.loadSSHKey(keyPath); err == nil {
					validKeys = append(validKeys, key)
				}
			}
		}

		// Add all valid keys to authentication methods
		if len(validKeys) > 0 {
			authMethods = append(authMethods, fmt.Sprintf("%d local keys", len(validKeys)))
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(validKeys...))
			authMethodsAdded++
		}
	}

	// If still no auth methods available, return specific error
	if authMethodsAdded == 0 {
		return nil, fmt.Errorf("no authentication methods available: please provide password or SSH key")
	}

	// Show authentication methods being used
	if len(authMethods) > 0 {
		a.messages.EmitMessage(sessionID, fmt.Sprintf("Authentication: %s", strings.Join(authMethods, ", ")), MessageInfo)
	}

	// Connect to SSH server with more specific error handling
	address := fmt.Sprintf("%s:%d", config.Host, config.Port)
	// Don't emit "Connecting to..." here - it's already shown by StartConnectionFlow()

	client, err := ssh.Dial("tcp", address, sshConfig)
	if err != nil {
		// Provide more specific error messages based on error type
		if netErr, ok := err.(net.Error); ok {
			if netErr.Timeout() {
				return nil, fmt.Errorf("connection timeout: could not reach %s (check host and port)", address)
			}
		}

		// Check for common SSH errors
		errStr := err.Error()
		if strings.Contains(errStr, "connection refused") {
			return nil, fmt.Errorf("connection refused: SSH server may not be running on %s", address)
		}
		if strings.Contains(errStr, "no route to host") {
			return nil, fmt.Errorf("no route to host: %s is not reachable", config.Host)
		}
		if strings.Contains(errStr, "authentication failed") || strings.Contains(errStr, "unable to authenticate") {
			return nil, fmt.Errorf("authentication failed: invalid username/password or SSH key")
		}
		if strings.Contains(errStr, "host key verification failed") {
			return nil, fmt.Errorf("host key verification failed: host key has changed or is unknown")
		}

		// Generic connection error
		return nil, fmt.Errorf("failed to connect to %s: %v", address, err)
	}

	// Use unified connection flow to stop animation properly
	a.messages.ConnectionEstablished(sessionID)

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	// Set up session I/O
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Create SSH session wrapper with proper initialization
	sshSession := &SSHSession{
		client:            client,
		session:           session,
		stdin:             stdin,
		stdout:            stdout,
		stderr:            stderr,
		done:              make(chan bool),
		closed:            make(chan bool),
		forceClose:        make(chan bool),
		cols:              cols,
		rows:              rows,
		sessionID:         sessionID,
		lastActivity:      time.Now(),
		isHanging:         false,
		monitoringEnabled: false,
		monitoringCache:   make(map[string]string),
		activeGoroutines:  0,
	}

	// Session is ready - this should be called from the tab management layer
	// after StartSSHShell succeeds, so we don't call SessionReady here
	return sshSession, nil
}

// StartSSHShell starts a shell on the SSH session
func (a *App) StartSSHShell(sshSession *SSHSession) error {
	// Request a pseudo-terminal with comprehensive terminal modes
	if err := sshSession.session.RequestPty("xterm-256color", sshSession.rows, sshSession.cols, ssh.TerminalModes{
		ssh.ECHO:          1,     // Enable echo
		ssh.TTY_OP_ISPEED: 14400, // Input speed
		ssh.TTY_OP_OSPEED: 14400, // Output speed
		ssh.ICRNL:         1,     // Map CR to NL on input
		ssh.OPOST:         1,     // Enable output processing
		ssh.ONLCR:         1,     // Map NL to CR-NL on output
		ssh.ICANON:        1,     // Enable canonical mode
		ssh.ISIG:          1,     // Enable signals
		ssh.IEXTEN:        1,     // Enable extended functions
		ssh.INPCK:         0,     // Disable input parity checking
		ssh.ISTRIP:        0,     // Don't strip 8th bit
		ssh.INLCR:         0,     // Don't map NL to CR on input
		ssh.IGNCR:         0,     // Don't ignore CR
		ssh.IXON:          0,     // Disable XON/XOFF flow control on output
		ssh.IXOFF:         0,     // Disable XON/XOFF flow control on input
		ssh.IXANY:         0,     // Disable any character restart output
	}); err != nil {
		return fmt.Errorf("failed to request PTY: %w", err)
	}

	// Start a shell
	if err := sshSession.session.Shell(); err != nil {
		return fmt.Errorf("failed to start shell: %w", err)
	}

	// Start output handling goroutines
	go a.handleSSHOutput(sshSession)
	go a.handleSSHErrors(sshSession)
	go a.waitForSSHSessionEnd(sshSession)

	return nil
}

// handleSSHOutput handles stdout from SSH session
func (a *App) handleSSHOutput(sshSession *SSHSession) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("SSH output handler panic: %v\n", r)
		}
	}()

	buffer := make([]byte, 4096)
	for {
		if sshSession.IsCleaning() {
			break
		}

		// Check for force close signal
		select {
		case <-sshSession.forceClose:
			fmt.Printf("SSH session %s force closed\n", sshSession.sessionID)
			return
		default:
		}

		// Set read timeout to detect hanging connections
		if conn, ok := sshSession.client.Conn.(net.Conn); ok {
			conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		}

		n, err := sshSession.stdout.Read(buffer)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				// Check if session has been inactive too long
				if time.Since(sshSession.GetLastActivity()) > 60*time.Second {
					fmt.Printf("SSH session %s appears to be hanging (no activity for %v)\n",
						sshSession.sessionID, time.Since(sshSession.GetLastActivity()))
					sshSession.SetHanging(true)
					a.handleHangingSession(sshSession)
					return
				}
				continue // Continue reading after timeout
			}
			if err == io.EOF {
				break
			}
			fmt.Printf("SSH stdout read error: %v\n", err)
			break
		}

		if n > 0 {
			// Update activity timestamp using thread-safe method
			sshSession.UpdateLastActivity()

			if a.ctx != nil {
				output := string(buffer[:n])
				wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
					"sessionId": sshSession.sessionID,
					"data":      output,
				})
			}
		}
	}
}

// handleSSHErrors handles stderr from SSH session
func (a *App) handleSSHErrors(sshSession *SSHSession) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("SSH error handler panic: %v\n", r)
		}
	}()

	buffer := make([]byte, 4096)
	for {
		if sshSession.IsCleaning() {
			break
		}

		n, err := sshSession.stderr.Read(buffer)
		if err != nil {
			if err != io.EOF {
				fmt.Printf("SSH stderr read error: %v\n", err)
			}
			break
		}

		if n > 0 && a.ctx != nil {
			output := string(buffer[:n])
			// Send stderr as regular output with error formatting
			errorOutput := fmt.Sprintf("\x1b[31m%s\x1b[0m", output)
			wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
				"sessionId": sshSession.sessionID,
				"data":      errorOutput,
			})
		}
	}
}

// waitForSSHSessionEnd waits for SSH session to end
func (a *App) waitForSSHSessionEnd(sshSession *SSHSession) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("SSH session end handler panic: %v\n", r)
		}
	}()

	err := sshSession.session.Wait()

	if err != nil && !sshSession.IsCleaning() {
		fmt.Printf("SSH session ended with error: %v\n", err)
		a.messages.UpdateConnectionStatus(sshSession.sessionID, StatusFailed.String(), fmt.Sprintf("SSH connection lost: %v", err))

		// Auto-cleanup SFTP client when connection fails
		fmt.Printf("Auto-closing SFTP client for failed session: %s\n", sshSession.sessionID)
		a.CloseFileExplorerSession(sshSession.sessionID)

		// Close monitoring session
		a.CloseMonitoringSession(sshSession)
	} else if !sshSession.IsCleaning() {
		// Clean disconnection
		a.messages.UpdateConnectionStatus(sshSession.sessionID, StatusDisconnected.String(), "")

		// Auto-cleanup SFTP client when connection disconnects
		fmt.Printf("Auto-closing SFTP client for disconnected session: %s\n", sshSession.sessionID)
		a.CloseFileExplorerSession(sshSession.sessionID)

		// Close monitoring session
		a.CloseMonitoringSession(sshSession)
	}

	close(sshSession.done)
	close(sshSession.closed)
}

// WriteToSSHSession writes data to SSH session
func (a *App) WriteToSSHSession(sshSession *SSHSession, data string) error {
	if sshSession.IsCleaning() {
		return fmt.Errorf("SSH session is being cleaned up")
	}

	_, err := sshSession.stdin.Write([]byte(data))
	return err
}

// ResizeSSHSession resizes the SSH session terminal
func (a *App) ResizeSSHSession(sshSession *SSHSession, cols, rows int) error {
	if sshSession.IsCleaning() {
		return fmt.Errorf("SSH session is being cleaned up")
	}

	sshSession.cols = cols
	sshSession.rows = rows

	// Send window change signal
	return sshSession.session.WindowChange(rows, cols)
}

// CloseSSHSession closes an SSH session
func (a *App) CloseSSHSession(sshSession *SSHSession) error {
	if sshSession.IsCleaning() {
		return nil
	}

	sshSession.SetCleaning(true)

	// Close SFTP client if it exists for this session
	a.CloseFileExplorerSession(sshSession.sessionID)

	// Close monitoring session first
	a.CloseMonitoringSession(sshSession)

	// Close session and client
	go func() {
		if sshSession.session != nil {
			sshSession.session.Close()
		}
		if sshSession.client != nil {
			sshSession.client.Close()
		}
	}()

	return nil
}

// loadSSHKey loads an SSH private key from file
func (a *App) loadSSHKey(keyPath string) (ssh.Signer, error) {
	key, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, err
	}

	return signer, nil
}

// getSSHAgentAuth tries to get SSH agent authentication
func (a *App) getSSHAgentAuth() (ssh.AuthMethod, error) {
	// On Windows, SSH agent might not be available via Unix socket
	// Try the SSH_AUTH_SOCK environment variable first
	authSock := os.Getenv("SSH_AUTH_SOCK")
	if authSock == "" {
		return nil, fmt.Errorf("SSH_AUTH_SOCK not set")
	}

	// Try to connect to SSH agent
	sshAgent, err := net.Dial("unix", authSock)
	if err != nil {
		// If Unix socket fails, it might be on Windows - skip for now
		return nil, fmt.Errorf("failed to connect to SSH agent: %w", err)
	}

	return ssh.PublicKeysCallback(agent.NewClient(sshAgent).Signers), nil
}

// handleHangingSession handles SSH sessions that appear to be hanging
func (a *App) handleHangingSession(sshSession *SSHSession) {
	a.messages.UpdateConnectionStatus(sshSession.sessionID, StatusHanging, "Connection appears to be hanging - no response from server")

	// Auto-cleanup SFTP client when connection is hanging
	fmt.Printf("Auto-closing SFTP client for hanging session: %s\n", sshSession.sessionID)
	a.CloseFileExplorerSession(sshSession.sessionID)

	// Close monitoring session
	a.CloseMonitoringSession(sshSession)
}

// ForceDisconnectSSHSession forcefully disconnects a hanging SSH session
func (a *App) ForceDisconnectSSHSession(sessionID string) error {
	a.ssh.sshSessionsMutex.RLock()
	sshSession, exists := a.ssh.sshSessions[sessionID]
	a.ssh.sshSessionsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SSH session %s not found", sessionID)
	}

	fmt.Printf("Force disconnecting SSH session: %s\n", sessionID)

	// Signal force close to all handlers
	select {
	case sshSession.forceClose <- true:
	default:
	}

	// Force close the session
	return a.CloseSSHSession(sshSession)
}

// CreateMonitoringSession creates a separate SSH connection for system monitoring
func (a *App) CreateMonitoringSession(sshSession *SSHSession, config *SSHConfig) error {
	// Create SSH client configuration (same as main session)
	sshConfig := &ssh.ClientConfig{
		User:            config.Username,
		HostKeyCallback: a.createHostKeyCallback(sshSession.sessionID),
		Timeout:         5 * time.Second, // Shorter timeout for monitoring
	}

	// Add authentication methods (same as main session)
	if config.Password != "" {
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(config.Password))
	}

	if config.KeyPath != "" {
		key, err := a.loadSSHKey(config.KeyPath)
		if err == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
		}
	}

	// Try SSH agent if no other auth
	if len(sshConfig.Auth) == 0 {
		if agentAuth, err := a.getSSHAgentAuth(); err == nil {
			sshConfig.Auth = append(sshConfig.Auth, agentAuth)
		}

		// Try default key locations using platform-specific paths (only if allowed)
		var validKeys []ssh.Signer
		if config.AllowKeyAutoDiscovery {
			defaultKeys := a.getDefaultSSHKeyPaths()
			for _, keyPath := range defaultKeys {
				if key, err := a.loadSSHKey(keyPath); err == nil {
					validKeys = append(validKeys, key)
				}
			}
		}

		// Add all valid keys to authentication methods
		if len(validKeys) > 0 {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(validKeys...))
		}
	}

	// Connect monitoring client
	address := fmt.Sprintf("%s:%d", config.Host, config.Port)
	monitoringClient, err := ssh.Dial("tcp", address, sshConfig)
	if err != nil {
		return fmt.Errorf("failed to create monitoring SSH connection: %w", err)
	}

	// Store monitoring client
	sshSession.monitoringMutex.Lock()
	sshSession.monitoringClient = monitoringClient
	sshSession.monitoringEnabled = true
	sshSession.monitoringMutex.Unlock()

	fmt.Printf("Created monitoring SSH session for %s\n", sshSession.sessionID)
	return nil
}

// ExecuteMonitoringCommand executes a command on the monitoring SSH session
// Commands are executed in a way that prevents them from being logged to shell history
func (a *App) ExecuteMonitoringCommand(sshSession *SSHSession, command string) (string, error) {
	sshSession.monitoringMutex.RLock()
	monitoringClient := sshSession.monitoringClient
	enabled := sshSession.monitoringEnabled
	sshSession.monitoringMutex.RUnlock()

	if !enabled || monitoringClient == nil {
		return "", fmt.Errorf("monitoring session not available")
	}

	// Create a new session for this command
	session, err := monitoringClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create monitoring session: %w", err)
	}
	defer session.Close()

	// Set timeout for command execution
	done := make(chan bool)
	go func() {
		time.Sleep(5 * time.Second) // 5 second timeout
		select {
		case <-done:
			return
		default:
			session.Close() // Force close on timeout
		}
	}()

	// Wrap command to prevent history logging
	// Method 1: Use HISTFILE=/dev/null for bash/zsh
	// Method 2: Prefix with space (works if HISTCONTROL=ignorespace)
	// Method 3: Use a subshell with disabled history
	wrappedCommand := fmt.Sprintf("HISTFILE=/dev/null bash -c %q", command)

	// Execute command and get output
	output, err := session.CombinedOutput(wrappedCommand)
	close(done)

	if err != nil {
		return "", fmt.Errorf("command execution failed: %w", err)
	}

	return string(output), nil
}

// CacheMonitoringResult caches a monitoring result
func (a *App) CacheMonitoringResult(sshSession *SSHSession, command, result string) {
	sshSession.monitoringMutex.Lock()
	defer sshSession.monitoringMutex.Unlock()

	if sshSession.monitoringCache == nil {
		sshSession.monitoringCache = make(map[string]string)
	}
	sshSession.monitoringCache[command] = result
}

// GetCachedMonitoringResult gets a cached monitoring result
func (a *App) GetCachedMonitoringResult(sshSession *SSHSession, command string) (string, bool) {
	sshSession.monitoringMutex.RLock()
	defer sshSession.monitoringMutex.RUnlock()

	if sshSession.monitoringCache == nil {
		return "", false
	}
	result, exists := sshSession.monitoringCache[command]
	return result, exists
}

// CloseMonitoringSession closes the monitoring SSH session
func (a *App) CloseMonitoringSession(sshSession *SSHSession) {
	sshSession.monitoringMutex.Lock()
	defer sshSession.monitoringMutex.Unlock()

	if sshSession.monitoringClient != nil {
		sshSession.monitoringClient.Close()
		sshSession.monitoringClient = nil
		fmt.Printf("Closed monitoring SSH session for %s\n", sshSession.sessionID)
	}
	sshSession.monitoringEnabled = false
}

// scanSSHDirectory scans the .ssh directory for potential private key files
func (a *App) scanSSHDirectory(sshDir string) []string {
	var keyFiles []string

	// Check if directory exists
	if _, err := os.Stat(sshDir); os.IsNotExist(err) {
		return keyFiles
	}

	// Read directory contents
	entries, err := os.ReadDir(sshDir)
	if err != nil {
		fmt.Printf("Failed to read SSH directory %s: %v\n", sshDir, err)
		return keyFiles
	}

	// Filter for potential private key files
	for _, entry := range entries {
		if entry.IsDir() {
			continue // Skip directories
		}

		filename := entry.Name()
		filePath := filepath.Join(sshDir, filename)

		// Skip known non-key files
		if a.shouldSkipFile(filename) {
			continue
		}

		// Check if it's a valid private key
		if a.isValidPrivateKey(filePath) {
			keyFiles = append(keyFiles, filePath)
		}
	}

	fmt.Printf("Found %d potential SSH private keys in %s\n", len(keyFiles), sshDir)
	return keyFiles
}

// shouldSkipFile determines if a file should be skipped during SSH key scanning
func (a *App) shouldSkipFile(filename string) bool {
	filename = strings.ToLower(filename)

	// Skip public key files
	if strings.HasSuffix(filename, ".pub") {
		return true
	}

	// Skip known SSH configuration files
	skipFiles := []string{
		"known_hosts",
		"authorized_keys",
		"config",
		"environment",
		".DS_Store",
	}

	for _, skipFile := range skipFiles {
		if filename == skipFile {
			return true
		}
	}

	// Skip backup files
	if strings.HasSuffix(filename, ".old") ||
		strings.HasSuffix(filename, ".bak") ||
		strings.HasSuffix(filename, ".backup") {
		return true
	}

	// Skip temporary files
	if strings.HasPrefix(filename, ".") && strings.HasSuffix(filename, ".tmp") {
		return true
	}

	return false
}

// isValidPrivateKey checks if a file is a valid SSH private key
func (a *App) isValidPrivateKey(filePath string) bool {
	// Check file permissions and size
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return false
	}

	// Skip files that are too large (private keys are typically < 10KB)
	if fileInfo.Size() > 10*1024 {
		return false
	}

	// Skip files that are too small (private keys are typically > 100 bytes)
	if fileInfo.Size() < 100 {
		return false
	}

	// Try to read and parse as SSH private key
	keyData, err := os.ReadFile(filePath)
	if err != nil {
		return false
	}

	// Check if it looks like a private key by content
	keyStr := string(keyData)
	if !strings.Contains(keyStr, "BEGIN") || !strings.Contains(keyStr, "PRIVATE KEY") {
		return false
	}

	// Try to parse it as an SSH private key
	_, err = ssh.ParsePrivateKey(keyData)
	if err != nil {
		// Not a valid private key
		return false
	}

	fmt.Printf("Found valid SSH private key: %s\n", filePath)
	return true
}
