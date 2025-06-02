package main

import (
	"context"
	"embed"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
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
	if a.config != nil && a.config.config != nil { // Ensure config is not nil
		wailsRuntime.WindowSetSize(a.ctx, a.config.config.WindowWidth, a.config.config.WindowHeight)
		fmt.Printf("Initial window size set to: %d x %d\n", a.config.config.WindowWidth, a.config.config.WindowHeight)

		// Restore window maximized state if it was saved as maximized
		if a.config.config.WindowMaximized {
			wailsRuntime.WindowMaximise(a.ctx)
			fmt.Println("Window restored to maximized state")
		}
	} else {
		// This case should ideally not be reached if NewApp initializes config correctly
		fmt.Println("Config is nil, cannot set initial window size.")
	}

	// Initialize profile management system
	if err := a.InitializeProfiles(); err != nil {
		fmt.Printf("Warning: Failed to initialize profiles: %v\n", err)
		// Continue without profiles - they're not critical for basic functionality
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
	if a.config.debounceTimer != nil {
		a.config.debounceTimer.Stop()
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
			a.config.config.WindowWidth = width
			a.config.config.WindowHeight = height
			fmt.Printf("Final window size captured: %dx%d\n", width, height)
		} else {
			fmt.Printf("Invalid window dimensions during shutdown: %dx%d - keeping previous values\n", width, height)
		}

		// Safe maximized state retrieval
		isMaximized := wailsRuntime.WindowIsMaximised(a.ctx)
		a.config.config.WindowMaximized = isMaximized
		fmt.Printf("Final maximized state: %t\n", isMaximized)
	}

	// Force save any pending config changes
	a.saveConfigIfDirty()

	// Stop profile watcher
	a.StopProfileWatcher()

	// Close all terminal sessions
	a.mutex.Lock()
	sessionIds := make([]string, 0, len(a.terminal.sessions))
	for sessionId := range a.terminal.sessions {
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

// createAppOptions creates the Wails application options with platform-specific frameless setting
func createAppOptions(app *App, assets embed.FS, isFrameless bool) *options.App {
	return &options.App{
		Title:     "Thermic",
		Width:     1024,
		Height:    768,
		MinWidth:  800,
		MinHeight: 600,
		Frameless: isFrameless,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 12, G: 12, B: 12, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
				HideTitleBar:               false,
				FullSizeContent:            true,
				UseToolbar:                 false,
				HideToolbarSeparator:       true,
			},
			About: &mac.AboutInfo{
				Title:   "Thermic",
				Message: "Cross-platform terminal emulator built with Wails",
			},
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
		Linux: &linux.Options{
			Icon: nil,
		},
	}
}
