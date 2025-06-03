//go:build darwin
// +build darwin

package main

import (
	"embed"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options using shared configuration
	err := wails.Run(createAppOptions(app, assets, false))
	if err != nil {
		log.Fatalf("Failed to start Thermic application: %v", err)
		os.Exit(1)
	}
}
