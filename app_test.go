package main

import (
	"testing"
)

func TestNewApp(t *testing.T) {
	app := NewApp()
	if app == nil {
		t.Fatal("NewApp() returned nil")
	}

	if app.terminal.sessions == nil {
		t.Fatal("NewApp() did not initialize sessions map")
	}
}

func TestCheckWSLAvailable(t *testing.T) {
	app := NewApp()

	// This should not panic and should return a boolean
	result := app.CheckWSLAvailable()

	// Just ensure it returns a boolean without errors
	_ = result
}

func TestGetPlatformInfo(t *testing.T) {
	app := NewApp()

	info := app.GetPlatformInfo()
	if info == nil {
		t.Fatal("GetPlatformInfo() returned nil")
	}

	// Check required fields exist
	if _, exists := info["os"]; !exists {
		t.Fatal("PlatformInfo missing 'os' field")
	}

	if _, exists := info["arch"]; !exists {
		t.Fatal("PlatformInfo missing 'arch' field")
	}

	if _, exists := info["defaultShell"]; !exists {
		t.Fatal("PlatformInfo missing 'defaultShell' field")
	}
}

func TestGetAvailableShells(t *testing.T) {
	app := NewApp()

	shells := app.GetAvailableShells()

	// Should return at least one shell on any platform
	if len(shells) == 0 {
		t.Fatal("GetAvailableShells() returned empty list")
	}
}

func TestGetDefaultShell(t *testing.T) {
	app := NewApp()

	defaultShell := app.GetDefaultShell()
	if defaultShell == "" {
		t.Fatal("GetDefaultShell() returned empty string")
	}
}
