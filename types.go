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
	sshSessions   map[string]*SSHSession // Add SSH session tracking
	tabs          map[string]*Tab
	activeTabId   string
	mutex         sync.RWMutex
	config        *AppConfig
	configDirty   bool
	debounceTimer *time.Timer
	// Profile management
	profiles       map[string]*Profile
	profileFolders map[string]*ProfileFolder
	profileWatcher *ProfileWatcher
	virtualFolders []*VirtualFolder
	metrics        *ProfileMetrics
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

// Profile represents a terminal profile configuration
type Profile struct {
	ID           string            `yaml:"id" json:"id"`
	Name         string            `yaml:"name" json:"name"`
	Icon         string            `yaml:"icon" json:"icon"`
	Type         string            `yaml:"type" json:"type"` // "local", "ssh", "custom"
	Shell        string            `yaml:"shell" json:"shell"`
	WorkingDir   string            `yaml:"working_dir" json:"workingDir"`
	Environment  map[string]string `yaml:"environment" json:"environment"`
	SSHConfig    *SSHConfig        `yaml:"ssh_config,omitempty" json:"sshConfig,omitempty"`
	FolderPath   string            `yaml:"folder_path" json:"folderPath"` // Path in folder tree (e.g., "Development/Frontend")
	SortOrder    int               `yaml:"sort_order" json:"sortOrder"`
	Created      time.Time         `yaml:"created" json:"created"`
	LastModified time.Time         `yaml:"last_modified" json:"lastModified"`
	// Enhanced fields
	Tags        []string          `yaml:"tags,omitempty" json:"tags,omitempty"`               // For filtering/search
	LastUsed    time.Time         `yaml:"last_used,omitempty" json:"lastUsed,omitempty"`      // For MRU sorting
	UsageCount  int               `yaml:"usage_count,omitempty" json:"usageCount,omitempty"`  // For popularity sorting
	Color       string            `yaml:"color,omitempty" json:"color,omitempty"`             // Visual grouping
	Description string            `yaml:"description,omitempty" json:"description,omitempty"` // Tooltips/notes
	IsFavorite  bool              `yaml:"is_favorite,omitempty" json:"isFavorite,omitempty"`  // Quick access
	Shortcuts   map[string]string `yaml:"shortcuts,omitempty" json:"shortcuts,omitempty"`     // Custom key bindings
}

// ProfileFolder represents a folder in the profile tree
type ProfileFolder struct {
	ID           string    `yaml:"id" json:"id"`
	Name         string    `yaml:"name" json:"name"`
	Icon         string    `yaml:"icon" json:"icon"`
	ParentPath   string    `yaml:"parent_path" json:"parentPath"` // Path to parent folder
	SortOrder    int       `yaml:"sort_order" json:"sortOrder"`
	Expanded     bool      `yaml:"expanded" json:"expanded"`
	Created      time.Time `yaml:"created" json:"created"`
	LastModified time.Time `yaml:"last_modified" json:"lastModified"`
	// Enhanced fields
	Color       string   `yaml:"color,omitempty" json:"color,omitempty"`             // Folder theming
	SortMethod  string   `yaml:"sort_method,omitempty" json:"sortMethod,omitempty"`  // name, date, usage, manual
	IsTemplate  bool     `yaml:"is_template,omitempty" json:"isTemplate,omitempty"`  // Template folders
	Tags        []string `yaml:"tags,omitempty" json:"tags,omitempty"`               // Folder categorization
	Description string   `yaml:"description,omitempty" json:"description,omitempty"` // Folder notes
}

// ProfileTreeNode represents a node in the profile tree for frontend
type ProfileTreeNode struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Icon     string             `json:"icon"`
	Type     string             `json:"type"` // "folder" or "profile"
	Path     string             `json:"path"`
	Children []*ProfileTreeNode `json:"children,omitempty"`
	Profile  *Profile           `json:"profile,omitempty"`
	Expanded bool               `json:"expanded"`
}

// ProfileWatcher handles file system watching for profile changes
type ProfileWatcher struct {
	watchDir    string
	stopChan    chan bool
	updatesChan chan ProfileUpdate
	app         *App
}

// ProfileUpdate represents a profile file change event
type ProfileUpdate struct {
	Type      string `json:"type"` // "created", "modified", "deleted"
	FilePath  string `json:"filePath"`
	ProfileID string `json:"profileId"`
}

// VirtualFolder represents special auto-generated folders
type VirtualFolder struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Icon        string        `json:"icon"`
	Type        string        `json:"type"` // "favorites", "recent", "tags", "search"
	Filter      VirtualFilter `json:"filter"`
	IsCollapsed bool          `json:"isCollapsed"`
}

// VirtualFilter defines the criteria for virtual folders
type VirtualFilter struct {
	Type      string `json:"type"`      // "favorite", "recent", "tag", "type", "search"
	Value     string `json:"value"`     // tag name, search term, etc.
	Limit     int    `json:"limit"`     // max items to show
	SortBy    string `json:"sortBy"`    // "name", "lastUsed", "usage", "created"
	SortOrder string `json:"sortOrder"` // "asc", "desc"
	DateRange int    `json:"dateRange"` // days for recent items
}

// ProfileMetrics for analytics and smart features - saved as separate YAML file
type ProfileMetrics struct {
	TotalProfiles    int            `yaml:"total_profiles" json:"totalProfiles"`
	TotalFolders     int            `yaml:"total_folders" json:"totalFolders"`
	MostUsedProfiles []string       `yaml:"most_used_profiles" json:"mostUsedProfiles"`
	RecentProfiles   []string       `yaml:"recent_profiles" json:"recentProfiles"`
	FavoriteProfiles []string       `yaml:"favorite_profiles" json:"favoriteProfiles"`
	TagUsage         map[string]int `yaml:"tag_usage" json:"tagUsage"`
	LastSync         time.Time      `yaml:"last_sync" json:"lastSync"`
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
	ConfigFileName  = "config.yaml"
	ConfigDirName   = "Thermic"
	ProfilesDirName = "Profiles"
	DebounceDelay   = 1 * time.Second
	ConfigFileMode  = 0600
	ConfigDirMode   = 0750
)

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sessions:       make(map[string]*TerminalSession),
		sshSessions:    make(map[string]*SSHSession),
		tabs:           make(map[string]*Tab),
		profiles:       make(map[string]*Profile),
		profileFolders: make(map[string]*ProfileFolder),
		activeTabId:    "",
		config:         DefaultConfig(),
	}
}
