package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx      context.Context
	sessions map[string]*TerminalSession
	mutex    sync.RWMutex
}

// TerminalSession represents a PTY session (exactly like VS Code)
type TerminalSession struct {
	pty      pty.Pty
	cmd      *pty.Cmd
	done     chan bool
	closed   chan bool
	cols     int
	rows     int
	cleaning bool
}

// WSLDistribution represents a WSL distribution
type WSLDistribution struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	State   string `json:"state"`
	Default bool   `json:"default"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sessions: make(map[string]*TerminalSession),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// CheckWSLAvailable checks if WSL is available on the system
func (a *App) CheckWSLAvailable() bool {
	if runtime.GOOS != "windows" {
		return false
	}

	// Check if wsl.exe exists
	if _, err := exec.LookPath("wsl.exe"); err != nil {
		return false
	}

	// Try to run wsl --list to see if WSL is properly installed
	cmd := exec.Command("wsl.exe", "--list", "--quiet")
	if err := cmd.Run(); err != nil {
		return false
	}

	return true
}

// GetWSLDistributions returns a list of available WSL distributions (VS Code style)
func (a *App) GetWSLDistributions() []WSLDistribution {
	var distributions []WSLDistribution

	if !a.CheckWSLAvailable() {
		return distributions
	}

	// Get list of WSL distributions (like VS Code does)
	cmd := exec.Command("wsl.exe", "--list", "--verbose")
	output, err := cmd.Output()
	if err != nil {
		return distributions
	}

	// Convert to string and clean up Unicode issues (VS Code approach)
	text := string(output)

	// Remove BOM (Byte Order Mark) and null characters that WSL often includes
	text = strings.Replace(text, "\ufeff", "", -1) // UTF-8 BOM
	text = strings.Replace(text, "\u0000", "", -1) // Null characters
	text = strings.Replace(text, "\x00", "", -1)   // More null characters

	lines := strings.Split(text, "\n")

	for i, line := range lines {
		// Skip the header line (first line contains "NAME STATE VERSION")
		if i == 0 {
			continue
		}

		// Clean and trim the line
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Check if this is the default distribution (has * at the beginning)
		isDefault := strings.HasPrefix(line, "*")

		// Remove the * character for parsing
		if isDefault {
			line = strings.TrimPrefix(line, "*")
			line = strings.TrimSpace(line)
		}

		// Split by whitespace to get parts
		parts := strings.Fields(line)
		if len(parts) >= 1 && parts[0] != "" {
			dist := WSLDistribution{
				Name:    parts[0],
				Version: "2",       // Default to WSL2
				State:   "Stopped", // Default state
				Default: isDefault,
			}

			// Parse additional fields if available
			if len(parts) >= 2 {
				dist.State = parts[1]
			}
			if len(parts) >= 3 {
				dist.Version = parts[2]
			}

			// Only add if we have a valid name
			if dist.Name != "" && dist.Name != "NAME" {
				distributions = append(distributions, dist)
			}
		}
	}

	return distributions
}

// GetDefaultShell returns the default shell for the current platform
func (a *App) GetDefaultShell() string {
	switch runtime.GOOS {
	case "windows":
		// Check if WSL is available and has a default distribution
		if a.CheckWSLAvailable() {
			distributions := a.GetWSLDistributions()
			for _, dist := range distributions {
				if dist.Default {
					return fmt.Sprintf("wsl::%s", dist.Name)
				}
			}
		}

		// Check if PowerShell is available, otherwise use cmd
		if _, err := exec.LookPath("powershell.exe"); err == nil {
			return "powershell.exe"
		}
		return "cmd.exe"
	case "darwin":
		// Use zsh as default on macOS (default since macOS Catalina)
		if _, err := exec.LookPath("zsh"); err == nil {
			return "zsh"
		}
		// Fallback to bash
		return "bash"
	case "linux":
		// Check for common shells in order of preference
		shells := []string{"bash", "zsh", "sh"}
		for _, shell := range shells {
			if _, err := exec.LookPath(shell); err == nil {
				return shell
			}
		}
		return "sh" // Ultimate fallback
	default:
		return "sh"
	}
}

// GetAvailableShells returns a list of available shells on the system
func (a *App) GetAvailableShells() []string {
	var shells []string

	switch runtime.GOOS {
	case "windows":
		// Add native Windows shells
		candidates := []string{"powershell.exe", "cmd.exe", "pwsh.exe"}
		for _, shell := range candidates {
			if _, err := exec.LookPath(shell); err == nil {
				shells = append(shells, shell)
			}
		}

		// Add WSL distributions
		if a.CheckWSLAvailable() {
			distributions := a.GetWSLDistributions()
			for _, dist := range distributions {
				shellName := fmt.Sprintf("wsl::%s", dist.Name)
				shells = append(shells, shellName)
			}
		}

	case "darwin", "linux":
		candidates := []string{"bash", "zsh", "fish", "sh", "csh", "tcsh"}
		for _, shell := range candidates {
			if _, err := exec.LookPath(shell); err == nil {
				shells = append(shells, shell)
			}
		}
	}

	return shells
}

// GetPlatformInfo returns information about the current platform
func (a *App) GetPlatformInfo() map[string]interface{} {
	info := make(map[string]interface{})
	info["os"] = runtime.GOOS
	info["arch"] = runtime.GOARCH
	info["defaultShell"] = a.GetDefaultShell()

	if hostname, err := os.Hostname(); err == nil {
		info["hostname"] = hostname
	}

	// Add WSL information for Windows
	if runtime.GOOS == "windows" {
		info["wslAvailable"] = a.CheckWSLAvailable()
		if a.CheckWSLAvailable() {
			info["wslDistributions"] = a.GetWSLDistributions()
		}
	}

	return info
}

// GetWSLInfo returns detailed WSL information
func (a *App) GetWSLInfo() map[string]interface{} {
	wslInfo := make(map[string]interface{})
	wslInfo["available"] = a.CheckWSLAvailable()
	wslInfo["distributions"] = a.GetWSLDistributions()

	// Get default WSL distribution
	if a.CheckWSLAvailable() {
		distributions := a.GetWSLDistributions()
		for _, dist := range distributions {
			if dist.Default {
				wslInfo["defaultDistribution"] = dist.Name
				break
			}
		}
	}

	return wslInfo
}

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

		// Create WSL command (exactly like VS Code does)
		wslPath, err := exec.LookPath("wsl.exe")
		if err != nil {
			ptty.Close()
			return fmt.Errorf("wsl.exe not found: %v", err)
		}

		// VS Code approach: always specify the distribution explicitly
		cmd = ptty.Command(wslPath, "-d", distName)
	} else {
		// Get the full path to the shell executable (fixes PATH resolution)
		shellPath, err := exec.LookPath(shell)
		if err != nil {
			ptty.Close()
			return fmt.Errorf("shell not found: %v", err)
		}

		// Create command with PTY using full path (exactly like VS Code does)
		switch runtime.GOOS {
		case "windows":
			// On Windows, use the shell directly with PTY
			cmd = ptty.Command(shellPath)
		default:
			// On Unix-like systems, use interactive shell
			cmd = ptty.Command(shellPath, "-i")
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

// ShowMessageDialog shows a message dialog to the user
func (a *App) ShowMessageDialog(title, message string) {
	wailsRuntime.MessageDialog(a.ctx, wailsRuntime.MessageDialogOptions{
		Type:    wailsRuntime.InfoDialog,
		Title:   title,
		Message: message,
	})
}

// Greet returns a greeting for the given name (keeping for compatibility)
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, Welcome to Thermic Terminal!", name)
}
