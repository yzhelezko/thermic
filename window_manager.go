package main

import (
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// MinimizeWindow minimizes the application window
func (a *App) MinimizeWindow() {
	wailsRuntime.WindowMinimise(a.ctx)
}

// MaximizeWindow toggles the window maximized state
func (a *App) MaximizeWindow() {
	wailsRuntime.WindowToggleMaximise(a.ctx)

	// Update config with new window state after toggle
	if a.updateWindowState() {
		a.markConfigDirty()
	}
}

// CloseWindow closes the application
func (a *App) CloseWindow() {
	wailsRuntime.Quit(a.ctx)
}

// IsWindowMaximized returns the current maximized state of the window
func (a *App) IsWindowMaximized() bool {
	return wailsRuntime.WindowIsMaximised(a.ctx)
}

// GetWindowMaximizedState returns the saved maximized state from config
func (a *App) GetWindowMaximizedState() bool {
	if a.config == nil {
		return false
	}
	return a.config.config.WindowMaximized
}
