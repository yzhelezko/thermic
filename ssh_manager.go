package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"strings"
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
}

// CreateSSHSession creates a new SSH connection and session
func (a *App) CreateSSHSession(sessionID string, config *SSHConfig) (*SSHSession, error) {
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
		}

		// Try default key locations
		defaultKeys := []string{
			os.ExpandEnv("$HOME/.ssh/id_rsa"),
			os.ExpandEnv("$HOME/.ssh/id_ed25519"),
			os.ExpandEnv("$HOME/.ssh/id_ecdsa"),
		}

		for _, keyPath := range defaultKeys {
			if key, err := a.loadSSHKey(keyPath); err == nil {
				sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
				authMethodsAdded++
				break
			}
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
		cols:      80,
		rows:      24,
		cleaning:  false,
		sessionID: sessionID,
	}

	return sshSession, nil
}

// StartSSHShell starts a shell on the SSH session
func (a *App) StartSSHShell(sshSession *SSHSession) error {
	// Request a pseudo-terminal
	if err := sshSession.session.RequestPty("xterm-256color", sshSession.rows, sshSession.cols, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
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

		n, err := sshSession.stdout.Read(buffer)
		if err != nil {
			if err != io.EOF {
				fmt.Printf("SSH stdout read error: %v\n", err)
			}
			break
		}

		if n > 0 && a.ctx != nil {
			output := string(buffer[:n])
			wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
				"sessionId": sshSession.sessionID,
				"data":      output,
			})
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
	for _, tab := range a.tabs {
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

		if a.ctx != nil {
			// Send formatted disconnect error message
			disconnectError := fmt.Sprintf("\r\n\033[31m╭─ Connection Lost\033[0m\r\n\033[31m│\033[0m %v\r\n\033[31m╰─\033[0m \033[33mUse the reconnect button to try again\033[0m\r\n\r\n", err)
			wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
				"sessionId": sshSession.sessionID,
				"data":      disconnectError,
			})
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

		if a.ctx != nil {
			// Send formatted clean disconnect message
			disconnectMsg := "\r\n\033[36m╭─ Connection Closed\033[0m\r\n\033[36m│\033[0m SSH session ended normally\r\n\033[36m╰─\033[0m \033[32m✓ Clean disconnect\033[0m\r\n\r\n"
			wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
				"sessionId": sshSession.sessionID,
				"data":      disconnectMsg,
			})
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
