package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// linuxGpuPolicy returns the appropriate GPU policy for the current display server.
// On XWayland (Wayland session forced to X11), GPU compositing causes GBM buffer failures,
// so software rendering is used. On native X11, GPU acceleration is allowed.
func linuxGpuPolicy() linux.WebviewGpuPolicy {
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		// Running on Wayland (or XWayland fallback) — disable GPU to avoid GBM buffer errors
		return linux.WebviewGpuPolicyNever
	}
	// Native X11 session — GPU works fine
	return linux.WebviewGpuPolicyOnDemand
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Config loading logic
	if err := a.loadConfig(); err != nil {
		fmt.Println("Error loading config:", err)
		// Fallback or handle error appropriately
	}

	// Update AI manager with loaded config
	if a.ai != nil && a.config != nil && a.config.config != nil {
		if err := a.ai.UpdateConfig(&a.config.config.AI); err != nil {
			fmt.Printf("Warning: Failed to update AI manager with loaded config: %v\n", err)
		} else {
			fmt.Println("AI manager updated with loaded configuration")
		}
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
	if a.ctx != nil && a.config != nil && a.config.config != nil { // Added check for a.config.config
		// Capture previous state for comparison
		prevWidth := a.config.config.WindowWidth
		prevHeight := a.config.config.WindowHeight
		prevMaximized := a.config.config.WindowMaximized

		// Safe window size retrieval with validation and panic recovery
		var width, height int
		func() {
			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("Recovered from panic during WindowGetSize in shutdown: %v\n", r)
					// Use previous values on panic
					width = prevWidth
					height = prevHeight
				}
			}()
			width, height = wailsRuntime.WindowGetSize(a.ctx)
		}()

		if width > 0 && height > 0 {
			a.config.config.WindowWidth = width
			a.config.config.WindowHeight = height
			fmt.Printf("Final window size captured: %dx%d\n", width, height)
		} else {
			fmt.Printf("Invalid window dimensions during shutdown: %dx%d - keeping previous values (%dx%d)\n", width, height, prevWidth, prevHeight)
			// Restore previous valid values
			a.config.config.WindowWidth = prevWidth
			a.config.config.WindowHeight = prevHeight
		}

		// Safe maximized state retrieval with panic recovery
		var isMaximized bool
		func() {
			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("Recovered from panic during WindowIsMaximised in shutdown: %v\n", r)
					// Use previous value on panic
					isMaximized = prevMaximized
				}
			}()
			isMaximized = wailsRuntime.WindowIsMaximised(a.ctx)
		}()

		a.config.config.WindowMaximized = isMaximized
		fmt.Printf("Final maximized state: %t\n", isMaximized)

		// Check if the state actually changed during this shutdown capture
		// and if so, mark configDirty = true to ensure it's saved by saveConfigIfDirty()
		if a.config.config.WindowWidth != prevWidth ||
			a.config.config.WindowHeight != prevHeight ||
			a.config.config.WindowMaximized != prevMaximized {
			a.mutex.Lock() // App's main mutex, which protects config.configDirty
			a.config.configDirty = true
			a.mutex.Unlock()
			fmt.Println("Window state changed during shutdown, explicitly marked config dirty for final save.")
		}
	}

	// Force save any pending config changes
	a.saveConfigIfDirty()

	// Flush in-memory folder expanded states to disk before stopping watcher
	a.SaveAllFolderStates()

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
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: false,
			CSSDropProperty:    "--wails-drop-target",
			CSSDropValue:       "drop",
		},
		Linux: &linux.Options{
			ProgramName:      "Thermic",
			WebviewGpuPolicy: linuxGpuPolicy(),
		},
	}
}
