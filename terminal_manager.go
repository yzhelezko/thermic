package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/aymanbagabas/go-pty"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// StartShell starts a shell with proper PTY (exactly like VS Code does)
func (a *App) StartShell(shell string, sessionId string) error {
	if shell == "" {
		shell = a.GetDefaultShell()
	}

	a.terminal.mutex.Lock()
	defer a.terminal.mutex.Unlock()

	// Check session limit
	if len(a.terminal.sessions) >= MaxSessions {
		return fmt.Errorf("maximum number of sessions (%d) reached", MaxSessions)
	}

	// Check if session already exists and clean it up if needed
	if existingSession, exists := a.terminal.sessions[sessionId]; exists {
		existingSession.requestClose()
		if existingSession.pty != nil {
			existingSession.pty.Close()
		}
		delete(a.terminal.sessions, sessionId)
	}

	// Create a new PTY (this is what VS Code does with node-pty)
	ptty, err := pty.New()
	if err != nil {
		return fmt.Errorf("failed to create pty: %v", err)
	}

	// Set initial terminal size (larger to prevent text wrapping)
	// Default size - will be properly synced when frontend connects
	cols, rows := 120, 30
	if err := ptty.Resize(cols, rows); err != nil {
		// Not critical, continue - size will be synced later
	}

	// Handle WSL shells differently (VS Code style)
	var cmd *pty.Cmd
	if strings.HasPrefix(shell, "wsl::") {
		// Extract WSL distribution name
		distName := strings.TrimPrefix(shell, "wsl::")

		// Validate that we have a distribution name
		if distName == "" || distName == "undefined" {
			ptty.Close()
			return fmt.Errorf("invalid WSL distribution name: %s", distName)
		}

		// Find WSL executable using universal detection
		wslPath, err := findWSLExecutable()
		if err != nil {
			ptty.Close()
			return fmt.Errorf("wsl.exe not found: %v", err)
		}

		// VS Code approach: always specify the distribution explicitly
		cmd = ptty.Command(wslPath, "-d", distName)
		// Configure Windows-specific process attributes
		configurePtyProcess(cmd)
	} else {
		// Get the full path to the shell executable using native detection
		shellPath, err := findShellExecutable(shell)
		if err != nil {
			ptty.Close()
			return fmt.Errorf("shell not found: %v", err)
		}

		// Create command with PTY using full path (exactly like VS Code does)
		switch runtime.GOOS {
		case "windows":
			// On Windows, use the shell directly with PTY
			cmd = ptty.Command(shellPath)
			// Configure Windows-specific process attributes
			configurePtyProcess(cmd)
		case "darwin":
			// On macOS, don't use -i flag as it can cause issues with zsh
			cmd = ptty.Command(shellPath)
			// Configure Unix-specific process attributes (prevents additional windows on macOS)
			configurePtyProcess(cmd)
		default:
			// On other Unix-like systems, use interactive shell
			cmd = ptty.Command(shellPath, "-i")
			// Configure Unix-specific process attributes (prevents additional windows on macOS)
			configurePtyProcess(cmd)
		}
	}

	// Set working directory
	if wd, err := os.Getwd(); err == nil {
		cmd.Dir = wd
	}

	// Start the command in the PTY
	if err := cmd.Start(); err != nil {
		ptty.Close()
		return fmt.Errorf("failed to start shell: %v", err)
	}

	// Create session with proper cancellation context
	ctx, cancel := context.WithCancel(context.Background())
	session := &TerminalSession{
		pty:      ptty,
		cmd:      cmd,
		done:     make(chan bool, 1),
		closed:   make(chan bool, 1),
		cols:     cols,
		rows:     rows,
		cleaning: 0, // Using atomic int32 instead of bool
		ctx:      ctx,
		cancel:   cancel,
	}

	// Store session
	a.terminal.sessions[sessionId] = session

	// Register session for resource cleanup
	a.terminal.resourceManager.Register(session)

	// Start reading from PTY with context cancellation
	go a.streamPtyOutputWithContext(sessionId, ptty, ctx)

	// Monitor process completion with context
	go a.monitorProcessWithContext(sessionId, cmd, ctx)

	// Start terminal size sync for this session
	go a.syncTerminalSize(sessionId, ctx)

	return nil
}

// streamPtyOutputWithContext streams PTY output with proper context cancellation
func (a *App) streamPtyOutputWithContext(sessionId string, ptty pty.Pty, ctx context.Context) {
	// Add panic recovery for goroutine safety
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("Panic in streamPtyOutputWithContext for session %s: %v\n", sessionId, r)
		}

		// Signal that streaming has ended
		a.terminal.mutex.RLock()
		session, exists := a.terminal.sessions[sessionId]
		if exists && !session.isClosing() {
			select {
			case session.closed <- true:
			default: // Channel might be closed, ignore
			}
		}
		a.terminal.mutex.RUnlock()
	}()

	// Use larger buffer for better performance (4KB instead of 1KB)
	buffer := make([]byte, 4096)

	// Add error tracking
	consecutiveErrors := 0
	maxConsecutiveErrors := 5

	for {
		select {
		case <-ctx.Done():
			// Context cancelled, exit gracefully
			return
		default:
			// Check if session is being cleaned up
			a.terminal.mutex.RLock()
			session, exists := a.terminal.sessions[sessionId]
			if !exists || session.isClosing() {
				a.terminal.mutex.RUnlock()
				return
			}
			a.terminal.mutex.RUnlock()

			// Set read timeout to allow context cancellation checks
			if deadline, ok := ctx.Deadline(); ok {
				if time.Until(deadline) > 100*time.Millisecond {
					// Only set deadline if we have reasonable time left
					if f, ok := ptty.(interface{ SetDeadline(time.Time) error }); ok {
						f.SetDeadline(time.Now().Add(100 * time.Millisecond))
					}
				}
			}

			n, err := ptty.Read(buffer)
			if err != nil {
				if err == io.EOF {
					return
				}

				// Count consecutive errors
				consecutiveErrors++
				if consecutiveErrors >= maxConsecutiveErrors {
					fmt.Printf("Too many consecutive read errors for session %s, stopping: %v\n", sessionId, err)
					return
				}

				// On timeout or temporary errors, continue checking context
				continue
			}

			// Reset error counter on successful read
			consecutiveErrors = 0

			if n > 0 {
				data := string(buffer[:n])
				// Send raw PTY data to frontend (exactly like VS Code)
				if a.ctx != nil {
					wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
						"sessionId": sessionId,
						"data":      data,
					})
				}
			}
		}
	}
}

// monitorProcessWithContext monitors the shell process with context cancellation
func (a *App) monitorProcessWithContext(sessionId string, cmd *pty.Cmd, ctx context.Context) {
	// Add panic recovery for goroutine safety
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("Panic in monitorProcessWithContext for session %s: %v\n", sessionId, r)
		}
	}()

	// Wait for process completion or context cancellation
	done := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("Panic in process wait goroutine for session %s: %v\n", sessionId, r)
				done <- fmt.Errorf("process wait panic: %v", r)
			}
		}()
		done <- cmd.Wait()
	}()

	select {
	case <-ctx.Done():
		// Context cancelled, kill process if still running
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return
	case err := <-done:
		// Process completed
		if err != nil {
			fmt.Printf("Process for session %s ended with error: %v\n", sessionId, err)
		}
	}

	// Notify frontend that process has ended
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
			"sessionId": sessionId,
			"data":      "\r\n[Process completed]\r\n",
		})
	}
}

// syncTerminalSize periodically syncs terminal size for proper display
func (a *App) syncTerminalSize(sessionId string, ctx context.Context) {
	// Only start periodic sync for SSH sessions to prevent disrupting local shells/editors
	a.ssh.sshSessionsMutex.RLock()
	_, isSSH := a.ssh.sshSessions[sessionId]
	a.ssh.sshSessionsMutex.RUnlock()

	if !isSSH {
		// For local shells, don't do periodic syncing as it disrupts editors like VIM
		return
	}

	// For SSH sessions, use longer intervals to prevent disruption
	ticker := time.NewTicker(30 * time.Second) // Check every 30 seconds for SSH only
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Only request size sync for SSH sessions and only if they're still active
			a.ssh.sshSessionsMutex.RLock()
			_, stillExists := a.ssh.sshSessions[sessionId]
			a.ssh.sshSessionsMutex.RUnlock()

			if stillExists {
				// Request current terminal size from frontend
				wailsRuntime.EventsEmit(a.ctx, "terminal-size-request", map[string]interface{}{
					"sessionId": sessionId,
				})
			} else {
				// SSH session no longer exists, stop syncing
				return
			}
		}
	}
}

// WriteToShell writes data to the PTY or SSH session
func (a *App) WriteToShell(sessionId string, data string) error {
	a.terminal.mutex.RLock()

	// Check if it's a PTY session
	if session, exists := a.terminal.sessions[sessionId]; exists {
		a.terminal.mutex.RUnlock()
		if session.isClosing() {
			return fmt.Errorf("session %s is closing", sessionId)
		}
		_, err := session.pty.Write([]byte(data))
		return err
	}
	a.terminal.mutex.RUnlock()

	// Check if it's an SSH session
	a.ssh.sshSessionsMutex.RLock()
	if sshSession, exists := a.ssh.sshSessions[sessionId]; exists {
		a.ssh.sshSessionsMutex.RUnlock()
		return a.WriteToSSHSession(sshSession, data)
	}
	a.ssh.sshSessionsMutex.RUnlock()

	return fmt.Errorf("session %s not found", sessionId)
}

// ResizeShell resizes the PTY or SSH session
func (a *App) ResizeShell(sessionId string, cols, rows int) error {
	a.terminal.mutex.Lock()
	// Check if it's a PTY session
	if session, exists := a.terminal.sessions[sessionId]; exists {
		session.cols = cols
		session.rows = rows
		a.terminal.mutex.Unlock()

		if session.isClosing() {
			return fmt.Errorf("session %s is closing", sessionId)
		}

		return session.pty.Resize(cols, rows)
	}
	a.terminal.mutex.Unlock()

	// Check if it's an SSH session
	a.ssh.sshSessionsMutex.Lock()
	if sshSession, exists := a.ssh.sshSessions[sessionId]; exists {
		a.ssh.sshSessionsMutex.Unlock()
		return a.ResizeSSHSession(sshSession, cols, rows)
	}
	a.ssh.sshSessionsMutex.Unlock()

	return fmt.Errorf("session %s not found", sessionId)
}

// CloseShell closes a PTY or SSH session with proper cleanup
func (a *App) CloseShell(sessionId string) error {
	// First, check and handle PTY sessions
	a.terminal.mutex.Lock()
	session, isPtySession := a.terminal.sessions[sessionId]
	if isPtySession {
		// Mark session for closure and remove from active sessions immediately
		session.requestClose()
		delete(a.terminal.sessions, sessionId)
	}
	a.terminal.mutex.Unlock()

	if isPtySession {
		// Do cleanup with timeout to avoid blocking
		go func() {
			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("Panic during session cleanup for %s: %v\n", sessionId, r)
				}
			}()

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			done := make(chan error, 1)
			go func() {
				defer func() {
					if r := recover(); r != nil {
						fmt.Printf("Panic in session close for %s: %v\n", sessionId, r)
						done <- fmt.Errorf("session close panic: %v", r)
					}
				}()
				done <- session.Close()
			}()

			select {
			case err := <-done:
				if err != nil {
					fmt.Printf("Session cleanup completed with error for %s: %v\n", sessionId, err)
				} else {
					fmt.Printf("Session cleanup completed successfully for %s\n", sessionId)
				}
			case <-ctx.Done():
				// Cleanup timed out, force close
				fmt.Printf("Session cleanup timed out for %s, forcing closure\n", sessionId)
				if session.pty != nil {
					session.pty.Close()
				}
				if session.cmd != nil && session.cmd.Process != nil {
					session.cmd.Process.Kill()
				}
			}
		}()
		return nil
	}

	// Check if it's an SSH session
	a.ssh.sshSessionsMutex.Lock()
	sshSession, isSSHSession := a.ssh.sshSessions[sessionId]
	if isSSHSession {
		delete(a.ssh.sshSessions, sessionId)
	}
	a.ssh.sshSessionsMutex.Unlock()

	if isSSHSession {
		return a.CloseSSHSession(sshSession)
	}

	return fmt.Errorf("session %s not found", sessionId)
}

// IsSessionClosed checks if a session is completely closed and cleaned up
func (a *App) IsSessionClosed(sessionId string) bool {
	a.terminal.mutex.RLock()
	defer a.terminal.mutex.RUnlock()

	session, exists := a.terminal.sessions[sessionId]
	if !exists {
		return true // Session doesn't exist, so it's "closed"
	}

	return session.isClosing()
}

// WaitForSessionClose waits for a session to be completely closed with better efficiency
func (a *App) WaitForSessionClose(sessionId string) error {
	// Create a context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Check if session exists and get its closed channel
	a.terminal.mutex.RLock()
	session, exists := a.terminal.sessions[sessionId]
	if !exists {
		a.terminal.mutex.RUnlock()
		return nil // Session doesn't exist, consider it closed
	}
	closedChan := session.closed
	a.terminal.mutex.RUnlock()

	// Wait for session to close or timeout
	select {
	case <-ctx.Done():
		return fmt.Errorf("timeout waiting for session %s to close", sessionId)
	case <-closedChan:
		return nil // Session closed successfully
	}
}
