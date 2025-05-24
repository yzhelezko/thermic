//go:build !integration

package main

import (
	"testing"
)

// Test that main package compiles without requiring frontend
func TestMainPackage(t *testing.T) {
	// Just test that we can create an app instance
	app := NewApp()
	if app == nil {
		t.Fatal("Failed to create app instance")
	}
}
