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
)

// SSHSession represents a native SSH session
type SSHSession struct {
	client    *ssh.Client
	session   *ssh.Session
	stdin     io.WriteCloser
	stdout    io.Reader
	stderr    io.Reader
	done      chan bool
	closed    chan bool
	cols      int
	rows      int
	cleaning  bool
	sessionID string
	// Add connection monitoring fields
	lastActivity time.Time
	isHanging    bool
	forceClose   chan bool
	// Add monitoring session for system stats
	monitoringClient  *ssh.Client
	monitoringEnabled bool
	monitoringCache   map[string]string
	monitoringMutex   sync.RWMutex
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

	// Create SSH client configuration
	sshConfig := &ssh.ClientConfig{
		User:            config.Username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // For now, accept all host keys
		Timeout:         10 * time.Second,
	}

	// Add authentication methods
	authMethodsAdded := 0
	if config.Password != "" {
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(config.Password))
		authMethodsAdded++
	}

	if config.KeyPath != "" {
		key, err := a.loadSSHKey(config.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load SSH key from %s: %w", config.KeyPath, err)
		} else {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
			authMethodsAdded++
		}
	}

	// If no auth methods, try ssh-agent or default keys
	if authMethodsAdded == 0 {
		// Try to add default authentication methods
		if agentAuth, err := a.getSSHAgentAuth(); err == nil {
			sshConfig.Auth = append(sshConfig.Auth, agentAuth)
			authMethodsAdded++
			fmt.Printf("Added SSH agent authentication\n")
		}

		// Try default key locations using platform-specific paths (only if allowed)
		var validKeys []ssh.Signer
		if config.AllowKeyAutoDiscovery {
			defaultKeys := a.getDefaultSSHKeyPaths()
			for _, keyPath := range defaultKeys {
				if key, err := a.loadSSHKey(keyPath); err == nil {
					validKeys = append(validKeys, key)
					fmt.Printf("Successfully loaded SSH key: %s\n", keyPath)
				} else {
					fmt.Printf("Failed to load SSH key %s: %v\n", keyPath, err)
				}
			}
		}

		// Add all valid keys to authentication methods
		if len(validKeys) > 0 {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(validKeys...))
			authMethodsAdded++
			fmt.Printf("Added %d SSH private keys for authentication\n", len(validKeys))
		}
	}

	// If still no auth methods available, return specific error
	if authMethodsAdded == 0 {
		return nil, fmt.Errorf("no authentication methods available: please provide password or SSH key")
	}

	// Connect to SSH server with more specific error handling
	address := fmt.Sprintf("%s:%d", config.Host, config.Port)
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

	// Create SSH session
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

	// Create SSH session wrapper
	sshSession := &SSHSession{
		client:    client,
		session:   session,
		stdin:     stdin,
		stdout:    stdout,
		stderr:    stderr,
		done:      make(chan bool),
		closed:    make(chan bool),
		cols:      cols,
		rows:      rows,
		cleaning:  false,
		sessionID: sessionID,
		// Add connection monitoring fields
		lastActivity: time.Now(),
		isHanging:    false,
		forceClose:   make(chan bool),
		// Add monitoring session for system stats
		monitoringClient:  nil,
		monitoringEnabled: false,
		monitoringCache:   make(map[string]string),
		monitoringMutex:   sync.RWMutex{},
	}

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
		if sshSession.cleaning {
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
				if time.Since(sshSession.lastActivity) > 60*time.Second {
					fmt.Printf("SSH session %s appears to be hanging (no activity for %v)\n",
						sshSession.sessionID, time.Since(sshSession.lastActivity))
					sshSession.isHanging = true
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
			// Update activity timestamp
			sshSession.lastActivity = time.Now()
			sshSession.isHanging = false

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
		if sshSession.cleaning {
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

	// Find the tab associated with this session to update status
	a.mutex.RLock()
	var associatedTab *Tab
	for _, tab := range a.terminal.tabs {
		if tab.SessionID == sshSession.sessionID {
			associatedTab = tab
			break
		}
	}
	a.mutex.RUnlock()

	if err != nil && !sshSession.cleaning {
		fmt.Printf("SSH session ended with error: %v\n", err)

		// Update tab status to disconnected with error
		if associatedTab != nil {
			a.mutex.Lock()
			associatedTab.Status = "failed"
			associatedTab.ErrorMessage = fmt.Sprintf("SSH connection lost: %v", err)
			a.mutex.Unlock()

			// Emit tab status update
			if a.ctx != nil {
				wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
					"tabId":        associatedTab.ID,
					"status":       "failed",
					"errorMessage": associatedTab.ErrorMessage,
				})
			}
		}
	} else if !sshSession.cleaning {
		// Clean disconnection
		if associatedTab != nil {
			a.mutex.Lock()
			associatedTab.Status = "disconnected"
			associatedTab.ErrorMessage = ""
			a.mutex.Unlock()

			// Emit tab status update
			if a.ctx != nil {
				wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
					"tabId":        associatedTab.ID,
					"status":       "disconnected",
					"errorMessage": "",
				})
			}
		}
	}

	close(sshSession.done)
	close(sshSession.closed)
}

// WriteToSSHSession writes data to SSH session
func (a *App) WriteToSSHSession(sshSession *SSHSession, data string) error {
	if sshSession.cleaning {
		return fmt.Errorf("SSH session is being cleaned up")
	}

	_, err := sshSession.stdin.Write([]byte(data))
	return err
}

// ResizeSSHSession resizes the SSH session terminal
func (a *App) ResizeSSHSession(sshSession *SSHSession, cols, rows int) error {
	if sshSession.cleaning {
		return fmt.Errorf("SSH session is being cleaned up")
	}

	sshSession.cols = cols
	sshSession.rows = rows

	// Send window change signal
	return sshSession.session.WindowChange(rows, cols)
}

// CloseSSHSession closes an SSH session
func (a *App) CloseSSHSession(sshSession *SSHSession) error {
	if sshSession.cleaning {
		return nil
	}

	sshSession.cleaning = true

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
	if a.ctx == nil {
		return
	}

	// Find the tab associated with this session
	a.mutex.RLock()
	var associatedTab *Tab
	for _, tab := range a.terminal.tabs {
		if tab.SessionID == sshSession.sessionID {
			associatedTab = tab
			break
		}
	}
	a.mutex.RUnlock()

	if associatedTab != nil {
		// Update tab status to indicate hanging connection
		a.mutex.Lock()
		associatedTab.Status = "hanging"
		associatedTab.ErrorMessage = "Connection appears to be hanging - no response from server"
		a.mutex.Unlock()

		// Emit tab status update
		wailsRuntime.EventsEmit(a.ctx, "tab-status-update", map[string]interface{}{
			"tabId":        associatedTab.ID,
			"status":       "hanging",
			"errorMessage": associatedTab.ErrorMessage,
		})
	}
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
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
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
