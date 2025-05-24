package main

import (
	"context"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// App struct represents the main application
type App struct {
	ctx           context.Context
	sessions      map[string]*TerminalSession
	mutex         sync.RWMutex
	config        *AppConfig
	configDirty   bool
	debounceTimer *time.Timer
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

// Config constants
const (
	ConfigFileName = "config.yaml"
	ConfigDirName  = "Thermic"
	DebounceDelay  = 1 * time.Second
	ConfigFileMode = 0600
	ConfigDirMode  = 0750
)

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sessions: make(map[string]*TerminalSession),
		config:   DefaultConfig(),
	}
}
