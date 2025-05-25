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
	tabs          map[string]*Tab
	activeTabId   string
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

// Tab represents a terminal tab
type Tab struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	SessionID      string     `json:"sessionId"`
	Shell          string     `json:"shell"`
	IsActive       bool       `json:"isActive"`
	ConnectionType string     `json:"connectionType"` // "local" or "ssh"
	SSHConfig      *SSHConfig `json:"sshConfig,omitempty"`
	Created        time.Time  `json:"created"`
}

// SSHConfig represents SSH connection configuration
type SSHConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"` // Optional, prefer key auth
	KeyPath  string `json:"keyPath,omitempty"`  // Path to SSH private key
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
		sessions:    make(map[string]*TerminalSession),
		tabs:        make(map[string]*Tab),
		activeTabId: "",
		config:      DefaultConfig(),
	}
}
