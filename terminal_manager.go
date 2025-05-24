package main

import (
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

	a.mutex.Lock()
	defer a.mutex.Unlock()

	// Check if session already exists and clean it up if needed
	if existingSession, exists := a.sessions[sessionId]; exists {
		existingSession.cleaning = true
		if existingSession.pty != nil {
			existingSession.pty.Close()
		}
		delete(a.sessions, sessionId)
	}

	// Create a new PTY (this is what VS Code does with node-pty)
	ptty, err := pty.New()
	if err != nil {
		return fmt.Errorf("failed to create pty: %v", err)
	}

	// Set initial terminal size (VS Code default)
	cols, rows := 80, 24
	if err := ptty.Resize(cols, rows); err != nil {
		// Not critical, continue
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

	// Create session
	session := &TerminalSession{
		pty:      ptty,
		cmd:      cmd,
		done:     make(chan bool, 1),
		closed:   make(chan bool, 1),
		cols:     cols,
		rows:     rows,
		cleaning: false,
	}

	// Store session
	a.sessions[sessionId] = session

	// Start reading from PTY (VS Code style - raw byte streaming)
	go a.streamPtyOutput(sessionId, ptty)

	// Monitor process completion
	go a.monitorProcess(sessionId, cmd)

	return nil
}

// streamPtyOutput streams PTY output exactly like VS Code does
func (a *App) streamPtyOutput(sessionId string, ptty pty.Pty) {
	defer func() {
		// Signal that streaming has ended
		a.mutex.RLock()
		if session, exists := a.sessions[sessionId]; exists && !session.cleaning {
			session.closed <- true
		}
		a.mutex.RUnlock()
	}()

	buffer := make([]byte, 1024)
	for {
		// Check if session is being cleaned up
		a.mutex.RLock()
		session, exists := a.sessions[sessionId]
		if !exists || session.cleaning {
			a.mutex.RUnlock()
			break
		}
		a.mutex.RUnlock()

		n, err := ptty.Read(buffer)
		if err != nil {
			if err == io.EOF {
				break
			}
			continue
		}

		if n > 0 {
			data := string(buffer[:n])
			// Send raw PTY data to frontend (exactly like VS Code)
			wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
				"sessionId": sessionId,
				"data":      data,
			})
		}
	}
}

// monitorProcess monitors the shell process
func (a *App) monitorProcess(sessionId string, cmd *pty.Cmd) {
	cmd.Wait()

	// Notify frontend that process has ended
	wailsRuntime.EventsEmit(a.ctx, "terminal-output", map[string]interface{}{
		"sessionId": sessionId,
		"data":      "\r\n[Process completed]\r\n",
	})
}

// WriteToShell writes data to the PTY (exactly like VS Code)
func (a *App) WriteToShell(sessionId string, data string) error {
	a.mutex.RLock()
	session, exists := a.sessions[sessionId]
	a.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("session %s not found", sessionId)
	}

	_, err := session.pty.Write([]byte(data))
	return err
}

// ResizeShell resizes the PTY (proper implementation like VS Code)
func (a *App) ResizeShell(sessionId string, cols, rows int) error {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	session, exists := a.sessions[sessionId]
	if !exists {
		return fmt.Errorf("session %s not found", sessionId)
	}

	// Update session size
	session.cols = cols
	session.rows = rows

	// Resize the PTY (this is exactly what VS Code does)
	return session.pty.Resize(cols, rows)
}

// CloseShell closes a PTY session (exactly like VS Code)
func (a *App) CloseShell(sessionId string) error {
	a.mutex.Lock()
	session, exists := a.sessions[sessionId]
	if !exists {
		a.mutex.Unlock()
		return fmt.Errorf("session %s not found", sessionId)
	}

	// Mark session as being cleaned up to stop goroutines
	session.cleaning = true
	a.mutex.Unlock()

	// Close PTY (will terminate the shell process)
	if session.pty != nil {
		session.pty.Close()
	}

	// Wait for process to finish with timeout
	if session.cmd != nil {
		done := make(chan error, 1)
		go func() {
			done <- session.cmd.Wait()
		}()

		// Wait for either process completion or timeout (max 3 seconds)
		select {
		case <-done:
			// Process finished normally
		case <-session.closed:
			// Stream goroutine finished
		case <-time.After(3 * time.Second):
			// Timeout - force kill the process
			if session.cmd.Process != nil {
				session.cmd.Process.Kill()
			}
		}
	}

	// Remove from sessions map
	a.mutex.Lock()
	delete(a.sessions, sessionId)
	a.mutex.Unlock()

	return nil
}

// IsSessionClosed checks if a session is completely closed and cleaned up
func (a *App) IsSessionClosed(sessionId string) bool {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	session, exists := a.sessions[sessionId]
	if !exists {
		return true // Session doesn't exist, so it's "closed"
	}

	return session.cleaning
}

// WaitForSessionClose waits for a session to be completely closed
func (a *App) WaitForSessionClose(sessionId string) error {
	// Wait up to 5 seconds for session to close
	timeout := time.After(5 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			return fmt.Errorf("timeout waiting for session %s to close", sessionId)
		case <-ticker.C:
			a.mutex.RLock()
			_, exists := a.sessions[sessionId]
			a.mutex.RUnlock()

			if !exists {
				return nil // Session is fully closed
			}
		}
	}
}
