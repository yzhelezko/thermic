package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath" // New import
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"gopkg.in/yaml.v2" // New import
)

// App struct
type App struct {
	ctx      context.Context
	sessions map[string]*TerminalSession
	mutex    sync.RWMutex
	config   *AppConfig // New field
	// ticker   *time.Ticker // Removed: Replaced by debouncer

	configDirty   bool          // New field for debounced saving
	debounceTimer *time.Timer   // New field for debounced saving
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
		config:   DefaultConfig(), // Initialize with defaults
		// configDirty is false by default
		// debounceTimer is nil by default
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Config loading logic
	configDir, err := os.UserConfigDir()
	if err != nil {
		fmt.Println("Error getting user config dir:", err)
		// Fallback or handle error appropriately
	}

	configPath := filepath.Join(configDir, "Thermic", "config.yaml")

	// Create Thermic directory if it doesn't exist
	if err := os.MkdirAll(filepath.Dir(configPath), 0750); err != nil {
		fmt.Println("Error creating config directory:", err)
		// Proceed with defaults if directory creation fails
	}

	if _, err := os.Stat(configPath); err == nil {
		// Config file exists, try to load it
		data, readErr := os.ReadFile(configPath)
		if readErr != nil {
			fmt.Println("Error reading config file:", readErr)
			// Proceed with defaults if read fails
		} else {
			unmarshalErr := yaml.Unmarshal(data, a.config)
			if unmarshalErr != nil {
				fmt.Println("Error unmarshalling config:", unmarshalErr)
				// Reset to default config to be safe if unmarshal fails
				a.config = DefaultConfig()
			} else {
				fmt.Println("Config loaded successfully from", configPath)
			}
		}
	} else {
		// Config file does not exist, or error stating it
		fmt.Println("Config file not found at", configPath, "- creating with default values.")
		// Save default config if not found
		if saveErr := a.saveConfig(); saveErr != nil {
			fmt.Println("Error creating default config file:", saveErr)
		}
	}

	// Set initial window size using loaded/default config
	if a.config != nil { // Ensure config is not nil
		wailsRuntime.WindowSetSize(a.ctx, a.config.WindowWidth, a.config.WindowHeight)
		fmt.Printf("Initial window size set to: %d x %d\n", a.config.WindowWidth, a.config.WindowHeight)
	} else {
		// This case should ideally not be reached if NewApp initializes config correctly
		fmt.Println("Config is nil, cannot set initial window size.")
	}

	// --- Periodic saving removed, replaced by debouncer ---
	// fmt.Println("Periodic config saving (ticker) has been removed.")

	// Listen for frontend resize events
	wailsRuntime.EventsOn(a.ctx, "frontend:window:resized", a.handleFrontendResizeEvent)
	fmt.Println("Go: Registered listener for 'frontend:window:resized'.") // Debug
}

// handleFrontendResizeEvent is called when the frontend signals that window resizing has finished.
func (a *App) handleFrontendResizeEvent(optionalData ...interface{}) {
	if a.ctx == nil || a.config == nil {
		fmt.Println("Resize event: Context or config not ready.") // Debug
		return
	}

	width, height := wailsRuntime.WindowGetSize(a.ctx)
	fmt.Printf("Go: Received frontend:window:resized event. Current size: %dx%d\n", width, height) // Debug

	// Lock config if other parts might read it while we're potentially writing
	// For now, assuming direct update is fine before marking dirty.
	// a.mutex.Lock() // Consider if needed around config read/write here
	// defer a.mutex.Unlock()

	if a.config.WindowWidth != width || a.config.WindowHeight != height {
		a.config.WindowWidth = width
		a.config.WindowHeight = height
		fmt.Printf("Go: Window dimensions changed to %dx%d. Marking dirty.\n", width, height) // Debug
		a.markConfigDirty() // This will handle its own locking for debounceTimer and configDirty flag
	} else {
		fmt.Println("Go: Window dimensions unchanged, no action.") // Debug
	}
}

// markConfigDirty flags the configuration as needing a save and resets the debounce timer.
func (a *App) markConfigDirty() {
	a.mutex.Lock() // Lock to protect configDirty and debounceTimer
	defer a.mutex.Unlock()

	a.configDirty = true
	if a.debounceTimer != nil {
		a.debounceTimer.Stop() // Stop any existing timer
	}
	// Start a new timer
	a.debounceTimer = time.AfterFunc(1*time.Second, func() {
		// This function will run after 1 second.
		if a.ctx != nil { // Check if app is still running
			 fmt.Println("Debounce timer fired. Attempting to save config if dirty.")
			 // Need to ensure saveConfigIfDirty is goroutine-safe or called on main thread if it interacts with UI.
			 // For file I/O and internal state, it's generally okay.
			 a.saveConfigIfDirty()
		}
	})
	// fmt.Println("Config marked dirty, debounce timer started/reset.") // Debug
}

// saveConfigIfDirty checks the dirty flag and saves the configuration if it's set.
func (a *App) saveConfigIfDirty() {
	a.mutex.Lock() // Lock to protect configDirty and the save operation
	defer a.mutex.Unlock()

	if a.configDirty {
		fmt.Println("Config is dirty, proceeding with save.")
		if err := a.saveConfig(); err != nil { // saveConfig itself should be goroutine-safe if called from here
			fmt.Println("Error saving config via saveConfigIfDirty:", err)
			// If save fails, config is still dirty. Consider behavior here.
		} else {
			fmt.Println("Config saved successfully via saveConfigIfDirty. Marking clean.")
			a.configDirty = false // Reset dirty flag only on successful save
		}
	} else {
		// fmt.Println("Config is not dirty, no save needed.") // Debug
	}
}


// Window management methods for custom window controls
func (a *App) MinimizeWindow() {
	wailsRuntime.WindowMinimise(a.ctx)
}

func (a *App) MaximizeWindow() {
	wailsRuntime.WindowToggleMaximise(a.ctx)
}

func (a *App) CloseWindow() {
	wailsRuntime.Quit(a.ctx)
}

func (a *App) IsWindowMaximized() bool {
	return wailsRuntime.WindowIsMaximised(a.ctx)
}

// CheckWSLAvailable checks if WSL is available on the system
func (a *App) CheckWSLAvailable() bool {
	return a.checkWSLAvailable()
}

// GetWSLDistributions returns a list of available WSL distributions
func (a *App) GetWSLDistributions() []WSLDistribution {
	return a.getWSLDistributions()
}

// GetDefaultShell returns the default shell for the current platform
func (a *App) GetDefaultShell() string {
	// Use configured default shell if available and not empty
	if a.config != nil && a.config.DefaultShell != "" {
		// Optional: Add a check here to see if the configured shell is actually available/executable.
		// For now, we'll trust the user's configuration.
		// If validation is needed, it could look like:
		// if _, err := exec.LookPath(a.config.DefaultShell); err == nil {
		//    return a.config.DefaultShell
		// } else {
		//    fmt.Printf("Configured default shell %s not found, falling back to OS default.\n", a.config.DefaultShell)
		//    // Fall through to OS detection, or explicitly clear a.config.DefaultShell
		// }
		fmt.Printf("Using default shell from config: %s\n", a.config.DefaultShell)
		return a.config.DefaultShell
	}

	// If no configured shell or config is nil, proceed with OS-based detection
	fmt.Println("No default shell in config or config is nil, detecting OS default.")
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
		// Use file-based detection for macOS to prevent terminal windows
		macosShells := []string{"zsh", "bash", "sh"}
		for _, shell := range macosShells {
			if shellPath, err := findShellExecutable(shell); err == nil && shellPath != "" {
				return shell
			}
		}
		return "sh" // Ultimate fallback
	case "linux":
		// Use file-based detection for Linux to prevent terminal windows
		linuxShells := []string{"bash", "zsh", "sh"}
		for _, shell := range linuxShells {
			if shellPath, err := findShellExecutable(shell); err == nil && shellPath != "" {
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
	return a.getAvailableShells()
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
	return fmt.Sprintf("Hello %s, Welcome to Thermic!", name)
}

// saveConfig saves the current application configuration to a file
func (a *App) saveConfig() error {
	if a.config == nil {
		return fmt.Errorf("config is nil, cannot save")
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		fmt.Println("Error getting user config dir for saving:", err)
		return err // Or handle by trying to save to a fallback path
	}

	configPath := filepath.Join(configDir, "Thermic", "config.yaml")

	if err := os.MkdirAll(filepath.Dir(configPath), 0750); err != nil {
		fmt.Println("Error creating config directory for saving:", err)
		return err
	}

	data, err := yaml.Marshal(a.config)
	if err != nil {
		fmt.Println("Error marshalling config for saving:", err)
		return err
	}

	err = os.WriteFile(configPath, data, 0600) // Changed permission to 0600 for config file
	if err != nil {
		fmt.Println("Error writing config file for saving:", err)
		return err
	}

	fmt.Println("Config successfully saved to", configPath)
	return nil
}

// shutdown is called when the app is shutting down.
// It saves the current window size to the config file.
func (a *App) shutdown(ctx context.Context) {
	fmt.Println("Starting application shutdown...")
	// Stop any active debounce timer to prevent it from firing during/after shutdown
	a.mutex.Lock()
	if a.debounceTimer != nil {
		a.debounceTimer.Stop()
		fmt.Println("Debounce timer stopped.")
	}
	a.mutex.Unlock() // Unlock before potentially lengthy save operation

	// Perform a final save if config is dirty
	// Get latest window size directly, as OnWindowResize might not have fired for the very last change.
	// Note: Using a.ctx for WindowGetSize as the passed ctx to shutdown might be a different one specific to shutdown lifecycle.
	if a.ctx != nil { // Ensure app context is still valid for runtime calls
		width, height := wailsRuntime.WindowGetSize(a.ctx)
		if a.config != nil {
			if a.config.WindowWidth != width || a.config.WindowHeight != height {
				a.config.WindowWidth = width
				a.config.WindowHeight = height
				a.configDirty = true // Mark dirty if size changed since last save/check
				fmt.Printf("Window size updated to %dx%d for final save.\n", width, height)
			}
		}
	}
	
	fmt.Println("Attempting final config save on shutdown if dirty...")
	a.saveConfigIfDirty() // This is now mutex-protected internally

	// ... any other shutdown tasks ...
	fmt.Println("Application shutdown complete.")
}

// SetDefaultShell updates the default shell in the configuration and marks it dirty.
func (a *App) SetDefaultShell(shellPath string) error {
	if a.config == nil {
		return fmt.Errorf("config not initialized, cannot set default shell")
	}

	// Only mark dirty if value actually changes
	if a.config.DefaultShell != shellPath {
		a.config.DefaultShell = shellPath
		fmt.Printf("Default shell value set to: %s. Config marked dirty.\n", shellPath)
		a.markConfigDirty()
	} else {
		// fmt.Printf("Default shell already set to: %s. No change made.\n", shellPath) // Debug
	}
	return nil // Saving is now handled by debouncer
}

// GetCurrentDefaultShellSetting returns the raw default shell string from the configuration.
// This is intended for populating UI elements.
func (a *App) GetCurrentDefaultShellSetting() string {
	if a.config == nil {
		fmt.Println("GetCurrentDefaultShellSetting: config is nil, returning empty string.")
		return ""
	}
	return a.config.DefaultShell
}
