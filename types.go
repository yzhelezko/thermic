package main

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aymanbagabas/go-pty"
	"github.com/pkg/sftp" // Import for SFTP client
)

// Strongly-typed IDs for type safety
type SessionID string
type ProfileID string
type TabID string
type FolderID string
type SSHSessionID string

// Connection status constants
type ConnectionStatus int

const (
	StatusConnecting ConnectionStatus = iota
	StatusConnected
	StatusFailed
	StatusDisconnected
)

// String representation for JSON serialization
func (cs ConnectionStatus) String() string {
	switch cs {
	case StatusConnecting:
		return "connecting"
	case StatusConnected:
		return "connected"
	case StatusFailed:
		return "failed"
	case StatusDisconnected:
		return "disconnected"
	default:
		return "unknown"
	}
}

// Profile type constants
const (
	ProfileTypeLocal  = "local"
	ProfileTypeSSH    = "ssh"
	ProfileTypeRDP    = "rdp"
	ProfileTypeCustom = "custom"
)

// Connection type constants
const (
	ConnectionTypeLocal = "local"
	ConnectionTypeSSH   = "ssh"
	ConnectionTypeRDP   = "rdp"
)

// Virtual folder type constants
const (
	VirtualFolderFavorites = "favorites"
	VirtualFolderRecent    = "recent"
	VirtualFolderTags      = "tags"
	VirtualFolderSearch    = "search"
)

// Sort method constants
const (
	SortByName     = "name"
	SortByDate     = "date"
	SortByUsage    = "usage"
	SortByCreated  = "created"
	SortByLastUsed = "lastUsed"
	SortByManual   = "manual"
)

// Sort order constants
const (
	SortOrderAsc  = "asc"
	SortOrderDesc = "desc"
)

// Profile update type constants
const (
	ProfileUpdateCreated  = "created"
	ProfileUpdateModified = "modified"
	ProfileUpdateDeleted  = "deleted"
)

// Tree node type constants
const (
	TreeNodeTypeFolder  = "folder"
	TreeNodeTypeProfile = "profile"
)

// Resource limits
const (
	MaxSessions       = 50
	MaxProfiles       = 1000
	MaxProfileFolders = 200
	MaxFileHistory    = 100
	MaxVirtualFolders = 20
	MaxTagsPerProfile = 20
	MaxProfilesPerTag = 500

	// Collection size limits for infrastructure
	MaxSSHSessions = 25
	MaxSFTPClients = 25
)

// Validation interface for type validation
type Validator interface {
	Validate() error
}

// Cleanup interface for resource management
type Cleanup interface {
	Close() error
}

// String methods for typed IDs to maintain compatibility
func (s SessionID) String() string {
	return string(s)
}

func (p ProfileID) String() string {
	return string(p)
}

func (t TabID) String() string {
	return string(t)
}

func (f FolderID) String() string {
	return string(f)
}

func (s SSHSessionID) String() string {
	return string(s)
}

// Helper functions to create typed IDs from strings
func NewSessionID(s string) SessionID {
	return SessionID(s)
}

func NewProfileID(s string) ProfileID {
	return ProfileID(s)
}

func NewTabID(s string) TabID {
	return TabID(s)
}

func NewFolderID(s string) FolderID {
	return FolderID(s)
}

func NewSSHSessionID(s string) SSHSessionID {
	return SSHSessionID(s)
}

// Manager structs for focused responsibilities

// TerminalManager handles terminal sessions and tabs
type TerminalManager struct {
	sessions        map[string]*TerminalSession
	tabs            map[string]*Tab
	activeTabId     string
	mutex           sync.RWMutex
	resourceManager *ResourceManager
}

// ProfileManager handles profile and folder management
type ProfileManager struct {
	profiles        map[string]*Profile
	profileFolders  map[string]*ProfileFolder
	profileWatcher  *ProfileWatcher
	virtualFolders  []*VirtualFolder
	metrics         *ProfileMetrics
	fileHistory     *BoundedSlice[*FileHistoryEntry]
	mutex           sync.RWMutex
	resourceManager *ResourceManager
}

// SSHManager handles SSH connections and SFTP operations
type SSHManager struct {
	sshSessions      map[string]*SSHSession
	sftpClients      map[string]*sftp.Client
	sshSessionsMutex sync.RWMutex // Dedicated mutex for SSH sessions
	sftpClientsMutex sync.RWMutex
	resourceManager  *ResourceManager
}

// RDPSession represents an active RDP connection
type RDPSession struct {
	sessionID string
	width     int
	height    int
	mu        sync.RWMutex
	cleaning  bool
	done      chan bool
	closed    chan bool
	// Connection and protocol stack components
	// Store as interfaces to avoid import cycle
	conn interface{} // net.Conn
	pdu  interface{} // *pdu.Client - main PDU layer for sending/receiving
}

// SetCleaning atomically sets the session as cleaning
func (r *RDPSession) SetCleaning(cleaning bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cleaning = cleaning
}

// IsCleaning atomically checks if the session is cleaning
func (r *RDPSession) IsCleaning() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cleaning
}

// RDPManager handles RDP connections
type RDPManager struct {
	rdpSessions      map[string]*RDPSession
	rdpSessionsMutex sync.RWMutex
	resourceManager  *ResourceManager
}

// MonitoringManager handles system metrics history and update rates
type MonitoringManager struct {
	sessionHistories map[string]*SessionMetrics // Per-session metric histories
	updateRates      map[string]int             // Per-session update rates (milliseconds)
	diskIOTracking   map[string]*DiskIOState    // Track previous disk I/O for rate calculation
	mutex            sync.RWMutex
	resourceManager  *ResourceManager
}

// SessionMetrics stores metric history for a session
type SessionMetrics struct {
	CPU       *MetricHistory
	Memory    *MetricHistory
	Load      *MetricHistory
	DiskUsage *MetricHistory
	DiskRead  *MetricHistory
	DiskWrite *MetricHistory
	DiskIO    *MetricHistory // Combined disk I/O (read + write)
	NetworkRX *MetricHistory
	NetworkTX *MetricHistory
	mutex     sync.RWMutex
}

// MetricHistory stores time-series data for a single metric
type MetricHistory struct {
	Timestamps []int64   // Unix timestamps in milliseconds
	Values     []float64 // Metric values
	MaxSize    int       // Maximum number of data points to keep
	nextIndex  int       // Next position to write (circular buffer)
	isFull     bool      // True once we've filled the buffer once
}

// DiskIOState tracks disk I/O for rate calculation
type DiskIOState struct {
	ReadBytes  uint64
	WriteBytes uint64
	Timestamp  int64 // Unix timestamp in milliseconds
}

// ConfigManager handles application configuration
type ConfigManager struct {
	config          *AppConfig
	configDirty     bool
	debounceTimer   *time.Timer
	mutex           sync.RWMutex
	resourceManager *ResourceManager
}

// App struct represents the main application with focused managers
type App struct {
	ctx             context.Context
	terminal        *TerminalManager
	profiles        *ProfileManager
	ssh             *SSHManager
	rdp             *RDPManager
	config          *ConfigManager
	messages        *MessageManager
	ai              *AIManager
	monitoring      *MonitoringManager
	resourceManager *ResourceManager
	mutex           sync.RWMutex
}

// Close implements the Cleanup interface for App
func (a *App) Close() error {
	// Stop all managers in reverse order
	if a.profiles != nil && a.profiles.resourceManager != nil {
		a.profiles.resourceManager.Cleanup()
	}
	if a.terminal != nil && a.terminal.resourceManager != nil {
		a.terminal.resourceManager.Cleanup()
	}
	if a.ssh != nil && a.ssh.resourceManager != nil {
		a.ssh.resourceManager.Cleanup()
	}
	if a.rdp != nil && a.rdp.resourceManager != nil {
		a.rdp.resourceManager.Cleanup()
	}
	if a.config != nil && a.config.resourceManager != nil {
		a.config.resourceManager.Cleanup()
	}
	if a.resourceManager != nil {
		a.resourceManager.Cleanup()
	}
	return nil
}

// TerminalSession represents a PTY session (exactly like VS Code)
type TerminalSession struct {
	pty      pty.Pty
	cmd      *pty.Cmd
	done     chan bool
	closed   chan bool
	cols     int
	rows     int
	cleaning int32              // Using atomic int32 for thread-safe access
	ctx      context.Context    // Context for cancellation
	cancel   context.CancelFunc // Cancel function
}

// requestClose atomically sets the session as closing
func (ts *TerminalSession) requestClose() {
	atomic.StoreInt32(&ts.cleaning, 1)
	if ts.cancel != nil {
		ts.cancel()
	}
}

// isClosing atomically checks if the session is closing
func (ts *TerminalSession) isClosing() bool {
	return atomic.LoadInt32(&ts.cleaning) == 1
}

// Close implements the Cleanup interface for TerminalSession
func (ts *TerminalSession) Close() error {
	if ts.isClosing() {
		return nil // Already cleaning
	}
	ts.requestClose()

	if ts.pty != nil {
		ts.pty.Close()
	}
	if ts.cmd != nil && ts.cmd.Process != nil {
		ts.cmd.Process.Kill()
	}

	// Close channels if they exist
	if ts.done != nil {
		close(ts.done)
	}
	if ts.closed != nil {
		close(ts.closed)
	}

	return nil
}

// Tab represents a terminal tab
type Tab struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	SessionID      string     `json:"sessionId"`
	Shell          string     `json:"shell"`
	IsActive       bool       `json:"isActive"`
	ConnectionType string     `json:"connectionType"` // "local", "ssh", or "rdp"
	SSHConfig      *SSHConfig `json:"sshConfig,omitempty"`
	RDPConfig      *RDPConfig `json:"rdpConfig,omitempty"`
	ProfileID      string     `json:"profileId,omitempty"` // ID of the profile this tab was created from
	Created        time.Time  `json:"created"`
	Status         string     `json:"status"`                 // "connecting", "connected", "failed", "disconnected"
	ErrorMessage   string     `json:"errorMessage,omitempty"` // Store error details for failed connections
}

// Validate implements the Validator interface for Tab
func (t *Tab) Validate() error {
	if t.ID == "" {
		return fmt.Errorf("tab ID cannot be empty")
	}
	if t.Title == "" {
		return fmt.Errorf("tab title cannot be empty")
	}
	if t.SessionID == "" {
		return fmt.Errorf("tab session ID cannot be empty")
	}
	if t.ConnectionType != ConnectionTypeLocal && t.ConnectionType != ConnectionTypeSSH && t.ConnectionType != ConnectionTypeRDP {
		return fmt.Errorf("invalid connection type: %s", t.ConnectionType)
	}
	if t.ConnectionType == ConnectionTypeSSH && t.SSHConfig == nil {
		return fmt.Errorf("SSH config required for SSH connection type")
	}
	if t.ConnectionType == ConnectionTypeRDP && t.RDPConfig == nil {
		return fmt.Errorf("RDP config required for RDP connection type")
	}
	return nil
}

// SSHConfig represents SSH connection configuration
type SSHConfig struct {
	Host                  string `json:"host"`
	Port                  int    `json:"port"`
	Username              string `json:"username"`
	Password              string `json:"password,omitempty"`              // Optional, prefer key auth
	KeyPath               string `json:"keyPath,omitempty"`               // Path to SSH private key
	AllowKeyAutoDiscovery bool   `json:"allowKeyAutoDiscovery,omitempty"` // Allow automatic SSH key discovery
}

// RDPConfig represents RDP connection configuration
type RDPConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"` // Default 3389
	Username   string `json:"username"`
	Password   string `json:"password,omitempty"` // RDP password
	Domain     string `json:"domain,omitempty"`   // Optional Windows domain
	Width      int    `json:"width"`              // Screen width
	Height     int    `json:"height"`             // Screen height
	ColorDepth int    `json:"colorDepth"`         // Bits per pixel (16, 24, 32)
}

// Validate implements the Validator interface for SSHConfig
func (ssh *SSHConfig) Validate() error {
	if ssh.Host == "" {
		return fmt.Errorf("SSH host cannot be empty")
	}
	if ssh.Port <= 0 || ssh.Port > 65535 {
		return fmt.Errorf("SSH port must be between 1 and 65535, got: %d", ssh.Port)
	}
	if ssh.Username == "" {
		return fmt.Errorf("SSH username cannot be empty")
	}
	return nil
}

// Validate implements the Validator interface for RDPConfig
func (rdp *RDPConfig) Validate() error {
	if rdp.Host == "" {
		return fmt.Errorf("RDP host cannot be empty")
	}
	if rdp.Port <= 0 || rdp.Port > 65535 {
		return fmt.Errorf("RDP port must be between 1 and 65535, got: %d", rdp.Port)
	}
	if rdp.Username == "" {
		return fmt.Errorf("RDP username cannot be empty")
	}
	if rdp.Width <= 0 || rdp.Height <= 0 {
		return fmt.Errorf("RDP screen dimensions must be positive, got: %dx%d", rdp.Width, rdp.Height)
	}
	if rdp.ColorDepth != 16 && rdp.ColorDepth != 24 && rdp.ColorDepth != 32 {
		return fmt.Errorf("RDP color depth must be 16, 24, or 32, got: %d", rdp.ColorDepth)
	}
	return nil
}

// FileHistoryEntry represents a file access history entry
type FileHistoryEntry struct {
	Path          string    `yaml:"path" json:"path"`                    // Full remote file path
	FileName      string    `yaml:"file_name" json:"fileName"`           // File name for display
	AccessCount   int       `yaml:"access_count" json:"accessCount"`     // Number of times accessed
	FirstAccessed time.Time `yaml:"first_accessed" json:"firstAccessed"` // First time this file was accessed
	LastAccessed  time.Time `yaml:"last_accessed" json:"lastAccessed"`   // Most recent access time
}

// Profile represents a terminal profile configuration
type Profile struct {
	ID           string            `yaml:"id" json:"id"`
	Name         string            `yaml:"name" json:"name"`
	Icon         string            `yaml:"icon" json:"icon"`
	Type         string            `yaml:"type" json:"type"` // "local", "ssh", "rdp", "custom"
	Shell        string            `yaml:"shell" json:"shell"`
	WorkingDir   string            `yaml:"working_dir" json:"workingDir"`
	Environment  map[string]string `yaml:"environment" json:"environment"`
	SSHConfig    *SSHConfig        `yaml:"ssh_config,omitempty" json:"sshConfig,omitempty"`
	RDPConfig    *RDPConfig        `yaml:"rdp_config,omitempty" json:"rdpConfig,omitempty"`
	FolderID     string            `yaml:"folder_id,omitempty" json:"folderId,omitempty"` // Direct reference to parent folder by ID
	SortOrder    int               `yaml:"sort_order" json:"sortOrder"`
	Created      time.Time         `yaml:"created" json:"created"`
	LastModified time.Time         `yaml:"last_modified" json:"lastModified"`
	// Enhanced fields
	Tags        []string            `yaml:"tags,omitempty" json:"tags,omitempty"`                // For filtering/search
	LastUsed    time.Time           `yaml:"last_used,omitempty" json:"lastUsed,omitempty"`       // For MRU sorting
	UsageCount  int                 `yaml:"usage_count,omitempty" json:"usageCount,omitempty"`   // For popularity sorting
	Color       string              `yaml:"color,omitempty" json:"color,omitempty"`              // Visual grouping
	Description string              `yaml:"description,omitempty" json:"description,omitempty"`  // Tooltips/notes
	IsFavorite  bool                `yaml:"is_favorite,omitempty" json:"isFavorite,omitempty"`   // Quick access
	Shortcuts   map[string]string   `yaml:"shortcuts,omitempty" json:"shortcuts,omitempty"`      // Custom key bindings
	FileHistory []*FileHistoryEntry `yaml:"file_history,omitempty" json:"fileHistory,omitempty"` // Remote file access history
}

// Validate implements the Validator interface for Profile
func (p *Profile) Validate() error {
	if p.ID == "" {
		return fmt.Errorf("profile ID cannot be empty")
	}
	if p.Name == "" {
		return fmt.Errorf("profile name cannot be empty")
	}
	if p.Type != ProfileTypeLocal && p.Type != ProfileTypeSSH && p.Type != ProfileTypeRDP && p.Type != ProfileTypeCustom {
		return fmt.Errorf("invalid profile type: %s", p.Type)
	}
	if p.Type == ProfileTypeSSH && p.SSHConfig != nil {
		if err := p.SSHConfig.Validate(); err != nil {
			return fmt.Errorf("invalid SSH config: %w", err)
		}
	}
	if p.Type == ProfileTypeRDP && p.RDPConfig != nil {
		if err := p.RDPConfig.Validate(); err != nil {
			return fmt.Errorf("invalid RDP config: %w", err)
		}
	}
	if len(p.Tags) > MaxTagsPerProfile {
		return fmt.Errorf("too many tags: %d, maximum allowed: %d", len(p.Tags), MaxTagsPerProfile)
	}
	if len(p.FileHistory) > MaxFileHistory {
		return fmt.Errorf("too many file history entries: %d, maximum allowed: %d", len(p.FileHistory), MaxFileHistory)
	}
	return nil
}

// ProfileFolder represents a folder in the profile tree
type ProfileFolder struct {
	ID             string    `yaml:"id" json:"id"`
	Name           string    `yaml:"name" json:"name"`
	Icon           string    `yaml:"icon" json:"icon"`
	ParentFolderID string    `yaml:"parent_folder_id,omitempty" json:"parentFolderId,omitempty"` // Direct reference to parent folder by ID
	SortOrder      int       `yaml:"sort_order" json:"sortOrder"`
	Expanded       bool      `yaml:"expanded" json:"expanded"`
	Created        time.Time `yaml:"created" json:"created"`
	LastModified   time.Time `yaml:"last_modified" json:"lastModified"`
	// Enhanced fields
	Color       string   `yaml:"color,omitempty" json:"color,omitempty"`             // Folder theming
	SortMethod  string   `yaml:"sort_method,omitempty" json:"sortMethod,omitempty"`  // name, date, usage, manual
	IsTemplate  bool     `yaml:"is_template,omitempty" json:"isTemplate,omitempty"`  // Template folders
	Tags        []string `yaml:"tags,omitempty" json:"tags,omitempty"`               // Folder categorization
	Description string   `yaml:"description,omitempty" json:"description,omitempty"` // Folder notes
}

// ProfileTreeNode represents a node in the profile tree for frontend
type ProfileTreeNode struct {
	ID       string             `json:"id"` // Can be ProfileID or FolderID
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
	manager     *ProfileManager
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

// RemoteFileEntry represents a file or directory entry on a remote SFTP server.
type RemoteFileEntry struct {
	Name          string    `json:"name"`                    // Name of the file or directory
	Path          string    `json:"path"`                    // Full remote path
	IsDir         bool      `json:"isDir"`                   // True if this entry is a directory
	IsSymlink     bool      `json:"isSymlink"`               // True if this entry is a symbolic link
	SymlinkTarget string    `json:"symlinkTarget,omitempty"` // Target path if IsSymlink is true
	Size          int64     `json:"size"`                    // Size in bytes
	Mode          string    `json:"mode"`                    // File mode string (e.g., "drwxr-xr-x")
	ModifiedTime  time.Time `json:"modifiedTime"`            // Last modification time
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

// NewApp creates a new App application struct with manager components
func NewApp() *App {
	// Create main resource manager
	mainRM := NewResourceManager()

	// Create terminal manager with resource management
	terminalRM := NewResourceManager()
	terminal := &TerminalManager{
		sessions:        make(map[string]*TerminalSession),
		tabs:            make(map[string]*Tab),
		activeTabId:     "",
		resourceManager: terminalRM,
	}
	mainRM.Register(terminal.resourceManager)

	// Create profile manager with resource management
	profileRM := NewResourceManager()
	profiles := &ProfileManager{
		profiles:        make(map[string]*Profile),
		profileFolders:  make(map[string]*ProfileFolder),
		virtualFolders:  make([]*VirtualFolder, 0),
		metrics:         &ProfileMetrics{},
		fileHistory:     NewBoundedSlice[*FileHistoryEntry](MaxFileHistory),
		resourceManager: profileRM,
	}
	mainRM.Register(profiles.resourceManager)

	// Create SSH manager with resource management
	sshRM := NewResourceManager()
	ssh := &SSHManager{
		sshSessions:     make(map[string]*SSHSession),
		sftpClients:     make(map[string]*sftp.Client),
		resourceManager: sshRM,
	}
	mainRM.Register(ssh.resourceManager)

	// Create RDP manager with resource management
	rdpRM := NewResourceManager()
	rdp := &RDPManager{
		rdpSessions:     make(map[string]*RDPSession),
		resourceManager: rdpRM,
	}
	mainRM.Register(rdp.resourceManager)

	// Create config manager with resource management
	configRM := NewResourceManager()
	config := &ConfigManager{
		config:          DefaultConfig(),
		resourceManager: configRM,
	}
	mainRM.Register(config.resourceManager)

	// Create monitoring manager with resource management
	monitoringRM := NewResourceManager()
	monitoring := &MonitoringManager{
		sessionHistories: make(map[string]*SessionMetrics),
		updateRates:      make(map[string]int),
		diskIOTracking:   make(map[string]*DiskIOState),
		resourceManager:  monitoringRM,
	}
	mainRM.Register(monitoring.resourceManager)

	// Create the app
	app := &App{
		terminal:        terminal,
		profiles:        profiles,
		ssh:             ssh,
		rdp:             rdp,
		config:          config,
		monitoring:      monitoring,
		resourceManager: mainRM,
	}

	// Create message manager (requires app reference)
	app.messages = NewMessageManager(app)

	// Create AI manager with default config
	app.ai = NewAIManager(&config.config.AI)

	return app
}

// BoundedMap provides a map with size limits and automatic cleanup
type BoundedMap[K comparable, V Cleanup] struct {
	data    map[K]V
	maxSize int
	mutex   sync.RWMutex
}

// NewBoundedMap creates a new bounded map with the specified maximum size
func NewBoundedMap[K comparable, V Cleanup](maxSize int) *BoundedMap[K, V] {
	return &BoundedMap[K, V]{
		data:    make(map[K]V),
		maxSize: maxSize,
	}
}

// Set adds or updates an item, removing oldest if at capacity
func (bm *BoundedMap[K, V]) Set(key K, value V) error {
	bm.mutex.Lock()
	defer bm.mutex.Unlock()

	// If key already exists, just update
	if existing, exists := bm.data[key]; exists {
		existing.Close() // Clean up old value
		bm.data[key] = value
		return nil
	}

	// If at capacity, remove one item (simple FIFO)
	if len(bm.data) >= bm.maxSize {
		for k, v := range bm.data {
			v.Close() // Clean up
			delete(bm.data, k)
			break // Remove just one
		}
	}

	bm.data[key] = value
	return nil
}

// Get retrieves an item from the map
func (bm *BoundedMap[K, V]) Get(key K) (V, bool) {
	bm.mutex.RLock()
	defer bm.mutex.RUnlock()
	val, exists := bm.data[key]
	return val, exists
}

// Delete removes an item from the map
func (bm *BoundedMap[K, V]) Delete(key K) bool {
	bm.mutex.Lock()
	defer bm.mutex.Unlock()

	if val, exists := bm.data[key]; exists {
		val.Close() // Clean up
		delete(bm.data, key)
		return true
	}
	return false
}

// Len returns the current size
func (bm *BoundedMap[K, V]) Len() int {
	bm.mutex.RLock()
	defer bm.mutex.RUnlock()
	return len(bm.data)
}

// Keys returns all keys
func (bm *BoundedMap[K, V]) Keys() []K {
	bm.mutex.RLock()
	defer bm.mutex.RUnlock()

	keys := make([]K, 0, len(bm.data))
	for k := range bm.data {
		keys = append(keys, k)
	}
	return keys
}

// Close cleans up all items
func (bm *BoundedMap[K, V]) Close() error {
	bm.mutex.Lock()
	defer bm.mutex.Unlock()

	for _, v := range bm.data {
		v.Close()
	}
	bm.data = make(map[K]V)
	return nil
}

// BoundedSlice provides a slice with size limits
type BoundedSlice[T any] struct {
	data    []T
	maxSize int
	mutex   sync.RWMutex
}

// NewBoundedSlice creates a new bounded slice
func NewBoundedSlice[T any](maxSize int) *BoundedSlice[T] {
	return &BoundedSlice[T]{
		data:    make([]T, 0),
		maxSize: maxSize,
	}
}

// Add appends an item, removing oldest if at capacity
func (bs *BoundedSlice[T]) Add(item T) {
	bs.mutex.Lock()
	defer bs.mutex.Unlock()

	bs.data = append(bs.data, item)

	// If over capacity, remove from beginning (FIFO)
	if len(bs.data) > bs.maxSize {
		bs.data = bs.data[len(bs.data)-bs.maxSize:]
	}
}

// Get returns all items as a copy
func (bs *BoundedSlice[T]) Get() []T {
	bs.mutex.RLock()
	defer bs.mutex.RUnlock()

	result := make([]T, len(bs.data))
	copy(result, bs.data)
	return result
}

// Len returns current size
func (bs *BoundedSlice[T]) Len() int {
	bs.mutex.RLock()
	defer bs.mutex.RUnlock()
	return len(bs.data)
}

// Clear removes all items
func (bs *BoundedSlice[T]) Clear() {
	bs.mutex.Lock()
	defer bs.mutex.Unlock()
	bs.data = bs.data[:0]
}

// ResourceManager handles overall resource lifecycle
type ResourceManager struct {
	resources []Cleanup
	mutex     sync.Mutex
}

// NewResourceManager creates a new resource manager
func NewResourceManager() *ResourceManager {
	return &ResourceManager{
		resources: make([]Cleanup, 0),
	}
}

// Register adds a resource for lifecycle management
func (rm *ResourceManager) Register(resource Cleanup) {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()
	rm.resources = append(rm.resources, resource)
}

// Cleanup closes all registered resources
func (rm *ResourceManager) Cleanup() error {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	var lastError error
	for _, resource := range rm.resources {
		if err := resource.Close(); err != nil {
			lastError = err
		}
	}
	rm.resources = rm.resources[:0]
	return lastError
}

// Close implements the Cleanup interface for ResourceManager
func (rm *ResourceManager) Close() error {
	return rm.Cleanup()
}

// Close implements the Cleanup interface for MonitoringManager
func (mm *MonitoringManager) Close() error {
	mm.mutex.Lock()
	defer mm.mutex.Unlock()

	// Clear all histories
	mm.sessionHistories = make(map[string]*SessionMetrics)
	mm.updateRates = make(map[string]int)
	mm.diskIOTracking = make(map[string]*DiskIOState)

	return nil
}
