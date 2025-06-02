package main

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Watcher constants
const (
	WatcherBufferSize = 10
	WatcherTimeout    = 5 * time.Second
)

// ProfileWatcherManager handles safe file watching with proper cleanup
type ProfileWatcherManager struct {
	watcher     *fsnotify.Watcher
	stopChan    chan bool
	updatesChan chan ProfileUpdate
	mutex       sync.RWMutex
	running     bool
}

// NewProfileWatcherManager creates a new watcher manager
func NewProfileWatcherManager() *ProfileWatcherManager {
	return &ProfileWatcherManager{
		stopChan:    make(chan bool, 1),
		updatesChan: make(chan ProfileUpdate, WatcherBufferSize),
		running:     false,
	}
}

// StartProfileWatcher starts monitoring profile files for changes with enhanced safety
func (a *App) StartProfileWatcher() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return fmt.Errorf("failed to get profiles directory: %w", err)
	}

	// Stop existing watcher if running
	if a.profiles.profileWatcher != nil {
		a.StopProfileWatcher()
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("failed to create file watcher: %w", err)
	}

	// Watch the profiles directory
	err = watcher.Add(profilesDir)
	if err != nil {
		watcher.Close()
		return fmt.Errorf("failed to watch profiles directory: %w", err)
	}

	a.profiles.profileWatcher = &ProfileWatcher{
		watchDir:    profilesDir,
		stopChan:    make(chan bool, 1),
		updatesChan: make(chan ProfileUpdate, WatcherBufferSize),
		manager:     a.profiles,
	}

	// Start watcher goroutine with proper error handling
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("Profile watcher panic recovered: %v\n", r)
			}
			watcher.Close()
		}()

		watcherTimeout := time.NewTimer(WatcherTimeout)
		defer watcherTimeout.Stop()

		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					fmt.Println("Profile watcher events channel closed")
					return
				}

				// Reset timeout
				if !watcherTimeout.Stop() {
					<-watcherTimeout.C
				}
				watcherTimeout.Reset(WatcherTimeout)

				a.handleProfileFileEvent(event)

			case err, ok := <-watcher.Errors:
				if !ok {
					fmt.Println("Profile watcher errors channel closed")
					return
				}
				fmt.Printf("Profile watcher error: %v\n", err)

			case <-a.profiles.profileWatcher.stopChan:
				fmt.Println("Profile watcher stop signal received")
				return

			case <-watcherTimeout.C:
				// Periodic check - could be used for cleanup or health checks
				watcherTimeout.Reset(WatcherTimeout)
			}
		}
	}()

	fmt.Printf("Profile file watcher started for directory: %s\n", profilesDir)
	return nil
}

// StopProfileWatcher stops the profile file watcher with proper cleanup
func (a *App) StopProfileWatcher() {
	if a.profiles.profileWatcher != nil {
		// Send stop signal
		select {
		case a.profiles.profileWatcher.stopChan <- true:
			// Signal sent successfully
		default:
			// Channel might be full or closed, that's okay
		}

		// Close stop channel to ensure cleanup
		close(a.profiles.profileWatcher.stopChan)

		// Clear reference
		a.profiles.profileWatcher = nil

		fmt.Println("Profile file watcher stopped")
	}
}

// handleProfileFileEvent processes file system events for profile files with better error handling
func (a *App) handleProfileFileEvent(event fsnotify.Event) {
	// Only process YAML files
	if !strings.HasSuffix(strings.ToLower(event.Name), ".yaml") {
		return
	}

	// Skip metrics file
	fileName := strings.ToLower(event.Name)
	if strings.Contains(fileName, "metrics.yaml") {
		return
	}

	// Prevent processing during our own file operations
	if a.profiles.profileWatcher == nil {
		return
	}

	fmt.Printf("Profile file event: %s %s\n", event.Op.String(), event.Name)

	switch {
	case event.Op&fsnotify.Write == fsnotify.Write:
		a.handleFileModified(event.Name)
	case event.Op&fsnotify.Create == fsnotify.Create:
		a.handleFileCreated(event.Name)
	case event.Op&fsnotify.Remove == fsnotify.Remove:
		a.handleFileRemoved(event.Name)
	case event.Op&fsnotify.Rename == fsnotify.Rename:
		a.handleFileRenamed(event.Name)
	}

	// Emit update to frontend if context is available
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "profile:file:changed", ProfileUpdate{
			Type:     event.Op.String(),
			FilePath: event.Name,
		})
	}
}

// handleFileModified handles file modification events
func (a *App) handleFileModified(filePath string) {
	// Determine if it's a profile or folder file
	fileName := strings.ToLower(filePath)

	if strings.Contains(fileName, "folder-") {
		a.handleFolderFileModified(filePath)
	} else {
		a.handleProfileFileModified(filePath)
	}
}

// handleProfileFileModified reloads a modified profile file
func (a *App) handleProfileFileModified(filePath string) {
	profile, err := a.LoadProfile(filePath)
	if err != nil {
		fmt.Printf("Warning: Failed to reload modified profile %s: %v\n", filePath, err)
		return
	}

	a.profiles.mutex.Lock()
	a.profiles.profiles[profile.ID] = profile
	a.profiles.mutex.Unlock()

	fmt.Printf("Reloaded modified profile: %s\n", profile.Name)
}

// handleFolderFileModified reloads a modified folder file
func (a *App) handleFolderFileModified(filePath string) {
	folder, err := a.LoadProfileFolder(filePath)
	if err != nil {
		fmt.Printf("Warning: Failed to reload modified folder %s: %v\n", filePath, err)
		return
	}

	a.profiles.mutex.Lock()
	a.profiles.profileFolders[folder.ID] = folder
	a.profiles.mutex.Unlock()

	fmt.Printf("Reloaded modified folder: %s\n", folder.Name)
}

// handleFileCreated handles file creation events
func (a *App) handleFileCreated(filePath string) {
	// Same as modification for our purposes
	a.handleFileModified(filePath)
}

// handleFileRemoved handles file deletion events
func (a *App) handleFileRemoved(filePath string) {
	fileName := strings.ToLower(filePath)

	if strings.Contains(fileName, "folder-") {
		a.handleFolderFileRemoved(filePath)
	} else {
		a.handleProfileFileRemoved(filePath)
	}
}

// handleProfileFileRemoved removes a deleted profile from memory
func (a *App) handleProfileFileRemoved(filePath string) {
	// Extract ID from filename
	fileName := strings.ToLower(filePath)
	parts := strings.Split(fileName, "-")
	if len(parts) < 2 {
		return
	}

	id := strings.TrimSuffix(parts[len(parts)-1], ".yaml")

	a.profiles.mutex.Lock()
	if _, exists := a.profiles.profiles[id]; exists {
		delete(a.profiles.profiles, id)
		fmt.Printf("Removed deleted profile from memory: %s\n", id)
	}
	a.profiles.mutex.Unlock()
}

// handleFolderFileRemoved removes a deleted folder from memory
func (a *App) handleFolderFileRemoved(filePath string) {
	// Extract ID from filename (folder-Name-ID.yaml)
	fileName := strings.ToLower(filePath)
	parts := strings.Split(fileName, "-")
	if len(parts) < 3 {
		return
	}

	id := strings.TrimSuffix(parts[len(parts)-1], ".yaml")

	a.profiles.mutex.Lock()
	if _, exists := a.profiles.profileFolders[id]; exists {
		delete(a.profiles.profileFolders, id)
		fmt.Printf("Removed deleted folder from memory: %s\n", id)
	}
	a.profiles.mutex.Unlock()
}

// handleFileRenamed handles file rename events
func (a *App) handleFileRenamed(filePath string) {
	// For renames, we treat it as a removal since the new file will trigger a create event
	a.handleFileRemoved(filePath)
}

// GetWatcherStatus returns the current status of the profile watcher
func (a *App) GetWatcherStatus() map[string]interface{} {
	status := map[string]interface{}{
		"running":      false,
		"watchDir":     "",
		"profileCount": 0,
		"folderCount":  0,
	}

	if a.profiles.profileWatcher != nil {
		status["running"] = true
		status["watchDir"] = a.profiles.profileWatcher.watchDir
	}

	a.profiles.mutex.RLock()
	status["profileCount"] = len(a.profiles.profiles)
	status["folderCount"] = len(a.profiles.profileFolders)
	a.profiles.mutex.RUnlock()

	return status
}

// RestartProfileWatcher safely restarts the profile watcher
func (a *App) RestartProfileWatcher() error {
	fmt.Println("Restarting profile watcher...")

	// Stop current watcher
	a.StopProfileWatcher()

	// Wait a bit for cleanup
	time.Sleep(100 * time.Millisecond)

	// Start new watcher
	return a.StartProfileWatcher()
}
