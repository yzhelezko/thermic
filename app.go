package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/aymanbagabas/go-pty"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
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

// Windows API declarations for native shell detection
var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	procGetFileAttributes = kernel32.NewProc("GetFileAttributesW")
)

// fileExists checks if a file exists using Windows API (faster than os.Stat)
func fileExists(path string) bool {
	if runtime.GOOS != "windows" {
		// Fallback for non-Windows
		_, err := os.Stat(path)
		return err == nil
	}

	pathPtr, _ := syscall.UTF16PtrFromString(path)
	attr, _, _ := procGetFileAttributes.Call(uintptr(unsafe.Pointer(pathPtr)))
	return attr != 0xFFFFFFFF
}

// getWindowsShellPaths returns shell paths using environment variables
func getWindowsShellPaths() map[string][]string {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = "C:\\Windows" // fallback
	}

	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = "C:\\Program Files" // fallback
	}

	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	if programFilesX86 == "" {
		programFilesX86 = "C:\\Program Files (x86)" // fallback
	}

	userProfile := os.Getenv("USERPROFILE")

	paths := map[string][]string{
		"cmd.exe": {
			filepath.Join(systemRoot, "System32", "cmd.exe"),
			filepath.Join(systemRoot, "SysWOW64", "cmd.exe"),
		},
		"powershell.exe": {
			filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			filepath.Join(systemRoot, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe"),
		},
		"pwsh.exe": {
			filepath.Join(programFiles, "PowerShell", "7", "pwsh.exe"),
			filepath.Join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
		},
	}

	// Add user-specific and additional PowerShell Core paths
	if userProfile != "" {
		paths["pwsh.exe"] = append(paths["pwsh.exe"],
			filepath.Join(userProfile, "AppData", "Local", "Microsoft", "WindowsApps", "pwsh.exe"))
	}

	// Check for newer PowerShell versions
	for i := 6; i <= 10; i++ {
		paths["pwsh.exe"] = append(paths["pwsh.exe"],
			filepath.Join(programFiles, "PowerShell", fmt.Sprintf("%d", i), "pwsh.exe"),
			filepath.Join(programFilesX86, "PowerShell", fmt.Sprintf("%d", i), "pwsh.exe"))
	}

	// Check common installation locations
	paths["pwsh.exe"] = append(paths["pwsh.exe"],
		filepath.Join(programFiles, "pwsh", "pwsh.exe"),
		filepath.Join(programFilesX86, "pwsh", "pwsh.exe"))

	return paths
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

// CheckWSLAvailable checks if WSL is available on the system using native methods
func (a *App) CheckWSLAvailable() bool {
	if runtime.GOOS != "windows" {
		return false
	}

	// Method 1: Check for WSL executable using system paths
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = "C:\\Windows"
	}

	wslPaths := []string{
		filepath.Join(systemRoot, "System32", "wsl.exe"),
		filepath.Join(systemRoot, "SysWOW64", "wsl.exe"),
	}

	wslExists := false
	for _, path := range wslPaths {
		if fileExists(path) {
			wslExists = true
			break
		}
	}

	// If wsl.exe not found, try PATH
	if !wslExists {
		if _, err := exec.LookPath("wsl.exe"); err == nil {
			wslExists = true
		}
	}

	if !wslExists {
		return false
	}

	// Method 2: Check registry for WSL feature
	key, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss`, registry.QUERY_VALUE)
	if err != nil {
		// Fallback: try a quick hidden WSL command to verify it's working
		return a.testWSLWithHiddenCommand()
	}
	defer key.Close()

	// If we can open the Lxss registry key, WSL is installed
	return true
}

// testWSLWithHiddenCommand tests WSL availability with a hidden command
func (a *App) testWSLWithHiddenCommand() bool {
	cmd := exec.Command("wsl.exe", "--status")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	// Set a short timeout
	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case err := <-done:
		return err == nil
	case <-time.After(2 * time.Second):
		cmd.Process.Kill()
		return false
	}
}

// GetWSLDistributions returns a list of available WSL distributions using registry
func (a *App) GetWSLDistributions() []WSLDistribution {
	var distributions []WSLDistribution

	if !a.CheckWSLAvailable() {
		return distributions
	}

	// Try registry approach first
	distributions = a.getWSLFromRegistry()

	// If registry approach failed, try command fallback
	if len(distributions) == 0 {
		distributions = a.getWSLFromCommand()
	}

	return distributions
}

// getWSLFromRegistry gets WSL distributions from Windows registry
func (a *App) getWSLFromRegistry() []WSLDistribution {
	var distributions []WSLDistribution

	// Read WSL distributions from registry
	key, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss`, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return distributions
	}
	defer key.Close()

	// Get default distribution UUID
	defaultDistGUID, _, _ := key.GetStringValue("DefaultDistribution")

	// Enumerate distribution subkeys
	subkeys, err := key.ReadSubKeyNames(-1)
	if err != nil {
		return distributions
	}

	for _, subkey := range subkeys {
		distKey, err := registry.OpenKey(key, subkey, registry.QUERY_VALUE)
		if err != nil {
			continue
		}

		// Get distribution name
		distName, _, err := distKey.GetStringValue("DistributionName")
		if err != nil {
			distKey.Close()
			continue
		}

		// Get WSL version (1 or 2)
		version, _, err := distKey.GetIntegerValue("Version")
		if err != nil {
			version = 2 // Default to WSL2
		}

		// Get state (1 = Running, others = Stopped)
		state, _, err := distKey.GetIntegerValue("State")
		stateStr := "Stopped"
		if err == nil && state == 1 {
			stateStr = "Running"
		}

		// Check if this is the default distribution
		isDefault := (subkey == defaultDistGUID)

		dist := WSLDistribution{
			Name:    distName,
			Version: fmt.Sprintf("%d", version),
			State:   stateStr,
			Default: isDefault,
		}

		distributions = append(distributions, dist)
		distKey.Close()
	}

	return distributions
}

// getWSLFromCommand gets WSL distributions using hidden command as fallback
func (a *App) getWSLFromCommand() []WSLDistribution {
	var distributions []WSLDistribution

	cmd := exec.Command("wsl.exe", "--list", "--verbose")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	output, err := cmd.Output()
	if err != nil {
		return distributions
	}

	// Convert to string and clean up Unicode issues
	text := string(output)
	text = strings.Replace(text, "\ufeff", "", -1) // UTF-8 BOM
	text = strings.Replace(text, "\u0000", "", -1) // Null characters
	text = strings.Replace(text, "\x00", "", -1)   // More null characters

	lines := strings.Split(text, "\n")

	for i, line := range lines {
		// Skip the header line
		if i == 0 {
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Check if this is the default distribution
		isDefault := strings.HasPrefix(line, "*")
		if isDefault {
			line = strings.TrimPrefix(line, "*")
			line = strings.TrimSpace(line)
		}

		parts := strings.Fields(line)
		if len(parts) >= 1 && parts[0] != "" && parts[0] != "NAME" {
			dist := WSLDistribution{
				Name:    parts[0],
				Version: "2",
				State:   "Stopped",
				Default: isDefault,
			}

			if len(parts) >= 2 {
				dist.State = parts[1]
			}
			if len(parts) >= 3 {
				dist.Version = parts[2]
			}

			distributions = append(distributions, dist)
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

// GetAvailableShells returns a list of available shells on the system using native detection
func (a *App) GetAvailableShells() []string {
	var shells []string

	switch runtime.GOOS {
	case "windows":
		// Check for Windows shells using known paths (no exec.LookPath)
		windowsShellPaths := getWindowsShellPaths()
		for shellName, paths := range windowsShellPaths {
			for _, path := range paths {
				if fileExists(path) {
					shells = append(shells, shellName)
					break // Found one instance, no need to check other paths
				}
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
		// For non-Windows, keep the current approach but check common paths first
		commonPaths := map[string][]string{
			"bash": {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"},
			"zsh":  {"/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"},
			"fish": {"/bin/fish", "/usr/bin/fish", "/usr/local/bin/fish"},
			"sh":   {"/bin/sh", "/usr/bin/sh"},
		}

		for shellName, paths := range commonPaths {
			for _, path := range paths {
				if fileExists(path) {
					shells = append(shells, shellName)
					break
				}
			}
		}

		// Fallback to exec.LookPath for shells not found in common paths
		fallbackCandidates := []string{"csh", "tcsh", "ksh"}
		for _, shell := range fallbackCandidates {
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

		// Find WSL executable using universal detection
		var wslPath string

		// Try system paths first
		systemRoot := os.Getenv("SystemRoot")
		if systemRoot == "" {
			systemRoot = "C:\\Windows"
		}

		wslPaths := []string{
			filepath.Join(systemRoot, "System32", "wsl.exe"),
			filepath.Join(systemRoot, "SysWOW64", "wsl.exe"),
		}

		for _, path := range wslPaths {
			if fileExists(path) {
				wslPath = path
				break
			}
		}

		// Fallback to PATH lookup
		if wslPath == "" {
			var err error
			wslPath, err = exec.LookPath("wsl.exe")
			if err != nil {
				ptty.Close()
				return fmt.Errorf("wsl.exe not found: %v", err)
			}
		}

		// VS Code approach: always specify the distribution explicitly
		cmd = ptty.Command(wslPath, "-d", distName)
		// Hide console window for WSL process
		if cmd.SysProcAttr == nil {
			cmd.SysProcAttr = &syscall.SysProcAttr{}
		}
		cmd.SysProcAttr.HideWindow = true
	} else {
		// Get the full path to the shell executable using native detection
		var shellPath string

		// On Windows, check our known paths first
		if runtime.GOOS == "windows" {
			windowsShellPaths := getWindowsShellPaths()
			if paths, exists := windowsShellPaths[shell]; exists {
				for _, path := range paths {
					if fileExists(path) {
						shellPath = path
						break
					}
				}
			}
		}

		// Fallback to exec.LookPath if not found in known paths
		if shellPath == "" {
			var err error
			shellPath, err = exec.LookPath(shell)
			if err != nil {
				ptty.Close()
				return fmt.Errorf("shell not found: %v", err)
			}
		}

		// Create command with PTY using full path (exactly like VS Code does)
		switch runtime.GOOS {
		case "windows":
			// On Windows, use the shell directly with PTY
			cmd = ptty.Command(shellPath)
			// Hide console window for the shell process
			if cmd.SysProcAttr == nil {
				cmd.SysProcAttr = &syscall.SysProcAttr{}
			}
			cmd.SysProcAttr.HideWindow = true
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
