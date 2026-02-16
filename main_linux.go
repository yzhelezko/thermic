//go:build linux
// +build linux

package main

import (
	"embed"
	"fmt"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Handle Wayland compatibility before GTK initializes.
	// WebKit2GTK has known issues on non-GNOME Wayland compositors
	// (protocol errors on KDE, Sway, Hyprland, etc.).
	// Force XWayland fallback when running on Wayland for reliability.
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		// Only override if user hasn't explicitly set GDK_BACKEND
		if os.Getenv("GDK_BACKEND") == "" {
			os.Setenv("GDK_BACKEND", "x11")
			fmt.Println("Wayland detected: using XWayland (GDK_BACKEND=x11) for WebKit2GTK compatibility")
		}
	}

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options using shared configuration
	// Frameless=false: use native window decorations (like macOS)
	err := wails.Run(createAppOptions(app, assets, false))
	if err != nil {
		log.Fatalf("Failed to start Thermic application: %v", err)
		os.Exit(1)
	}
}
