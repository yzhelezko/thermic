package main

import (
	"context"
	"fmt"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Config loading logic
	if err := a.loadConfig(); err != nil {
		fmt.Println("Error loading config:", err)
		// Fallback or handle error appropriately
	}

	// Set initial window size and state using loaded/default config
	if a.config != nil { // Ensure config is not nil
		wailsRuntime.WindowSetSize(a.ctx, a.config.WindowWidth, a.config.WindowHeight)
		fmt.Printf("Initial window size set to: %d x %d\n", a.config.WindowWidth, a.config.WindowHeight)

		// Restore window maximized state if it was saved as maximized
		if a.config.WindowMaximized {
			wailsRuntime.WindowMaximise(a.ctx)
			fmt.Println("Window restored to maximized state")
		}
	} else {
		// This case should ideally not be reached if NewApp initializes config correctly
		fmt.Println("Config is nil, cannot set initial window size.")
	}

	// Listen for frontend resize events
	wailsRuntime.EventsOn(a.ctx, "frontend:window:resized", a.handleFrontendResizeEvent)
	fmt.Println("Registered listener for window resize events.")
}

// shutdown is called during application shutdown (including auto-restart)
func (a *App) shutdown(ctx context.Context) {
	fmt.Println("Shutdown initiated...")

	// Stop the debounce timer if it's running
	a.mutex.Lock()
	if a.debounceTimer != nil {
		a.debounceTimer.Stop()
		fmt.Println("Debounce timer stopped.")
	}
	a.mutex.Unlock()

	// Final update and save of window state before shutdown
	// We'll use defer/recover for additional safety during shutdown
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("Recovered from panic during window state update: %v\n", r)
		}
	}()

	// Update final window state if possible
	if a.ctx != nil && a.config != nil {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("Recovered from panic during WindowGetSize: %v\n", r)
			}
		}()

		// Safe window size retrieval with validation
		width, height := wailsRuntime.WindowGetSize(a.ctx)
		if width > 0 && height > 0 {
			a.config.WindowWidth = width
			a.config.WindowHeight = height
			fmt.Printf("Final window size captured: %dx%d\n", width, height)
		} else {
			fmt.Printf("Invalid window dimensions during shutdown: %dx%d - keeping previous values\n", width, height)
		}

		// Safe maximized state retrieval
		isMaximized := wailsRuntime.WindowIsMaximised(a.ctx)
		a.config.WindowMaximized = isMaximized
		fmt.Printf("Final maximized state: %t\n", isMaximized)
	}

	// Force save any pending config changes
	a.saveConfigIfDirty()

	// Close all terminal sessions
	a.mutex.Lock()
	sessionIds := make([]string, 0, len(a.sessions))
	for sessionId := range a.sessions {
		sessionIds = append(sessionIds, sessionId)
	}
	a.mutex.Unlock()

	for _, sessionId := range sessionIds {
		fmt.Printf("Closing terminal session: %s\n", sessionId)
		if err := a.CloseShell(sessionId); err != nil {
			fmt.Printf("Error closing session %s: %v\n", sessionId, err)
		}
	}

	// Wait for sessions to close (with timeout)
	timeout := time.After(3 * time.Second)
	for _, sessionId := range sessionIds {
		select {
		case <-timeout:
			fmt.Printf("Timeout waiting for session %s to close\n", sessionId)
			break
		default:
			if err := a.WaitForSessionClose(sessionId); err != nil {
				fmt.Printf("Session %s didn't close cleanly: %v\n", sessionId, err)
			}
		}
	}

	fmt.Println("Shutdown completed.")
}

// CheckWSLAvailable checks if WSL is available on the system
func (a *App) CheckWSLAvailable() bool {
	return a.isWSLAvailable()
}

// GetWSLDistributions returns a list of available WSL distributions
func (a *App) GetWSLDistributions() []WSLDistribution {
	return a.getWSLDistributions()
}

// GetAvailableShells returns a list of available shells as strings (legacy support)
func (a *App) GetAvailableShells() []string {
	return a.getAvailableShells()
}

// GetPlatformInfo returns platform information
func (a *App) GetPlatformInfo() map[string]interface{} {
	return a.GetOSInfo()
}

// GetWSLInfo returns WSL-specific information
func (a *App) GetWSLInfo() map[string]interface{} {
	info := map[string]interface{}{
		"available":     a.CheckWSLAvailable(),
		"distributions": a.GetWSLDistributions(),
	}
	return info
}

// ShowMessageDialog shows a message dialog to the user
func (a *App) ShowMessageDialog(title, message string) {
	wailsRuntime.MessageDialog(a.ctx, wailsRuntime.MessageDialogOptions{
		Type:    wailsRuntime.InfoDialog,
		Title:   title,
		Message: message,
	})
}

// GetShellsForUI returns formatted shell list for UI settings
func (a *App) GetShellsForUI() []map[string]interface{} {
	shells := a.GetAvailableShellsFormatted()
	result := make([]map[string]interface{}, len(shells))

	for i, shell := range shells {
		result[i] = map[string]interface{}{
			"name":        shell["name"],  // Formatted name for display
			"value":       shell["value"], // Raw value for saving to config
			"displayName": shell["name"],  // Explicit display name field
		}
	}

	return result
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
