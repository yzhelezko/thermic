package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Watcher constants
const (
	WatcherBufferSize  = 10
	WatcherDebounceMs  = 300 * time.Millisecond
)

// StartProfileWatcher starts monitoring profile files for changes
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

	err = watcher.Add(profilesDir)
	if err != nil {
		watcher.Close()
		return fmt.Errorf("failed to watch profiles directory: %w", err)
	}

	pw := &ProfileWatcher{
		watchDir:    profilesDir,
		stopChan:    make(chan bool, 1),
		doneChan:    make(chan struct{}),
		updatesChan: make(chan ProfileUpdate, WatcherBufferSize),
		manager:     a.profiles,
	}
	a.profiles.profileWatcher = pw

	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("Profile watcher panic recovered: %v\n", r)
			}
			watcher.Close()
			close(pw.doneChan) // Signal that the goroutine has exited
		}()

		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				a.handleProfileFileEvent(event)

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				fmt.Printf("Profile watcher error: %v\n", err)

			case <-pw.stopChan:
				return
			}
		}
	}()

	fmt.Printf("Profile file watcher started for directory: %s\n", profilesDir)
	return nil
}

// StopProfileWatcher stops the profile file watcher and waits for it to exit
func (a *App) StopProfileWatcher() {
	pw := a.profiles.profileWatcher
	if pw == nil {
		return
	}

	// Cancel any pending debounce timer
	pw.debounceMutex.Lock()
	if pw.debounceTimer != nil {
		pw.debounceTimer.Stop()
		pw.debounceTimer = nil
	}
	pw.debounceMutex.Unlock()

	// Send stop signal
	select {
	case pw.stopChan <- true:
	default:
	}

	// Wait for the goroutine to actually exit (with timeout)
	select {
	case <-pw.doneChan:
	case <-time.After(2 * time.Second):
		fmt.Println("Warning: Profile watcher goroutine did not exit in time")
	}

	a.profiles.profileWatcher = nil
	fmt.Println("Profile file watcher stopped")
}

// handleProfileFileEvent processes file system events for profile files
func (a *App) handleProfileFileEvent(event fsnotify.Event) {
	baseName := filepath.Base(event.Name)

	// Only process YAML files
	if !strings.HasSuffix(strings.ToLower(baseName), ".yaml") {
		return
	}

	// Skip metrics file
	if strings.EqualFold(baseName, "metrics.yaml") {
		return
	}

	fmt.Printf("Profile file event: %s %s\n", event.Op.String(), baseName)

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

	// Debounced emit to frontend — coalesces rapid events into one refresh
	a.emitProfileChangedDebounced()
}

// emitProfileChangedDebounced debounces the profile:file:changed event to the frontend.
// Multiple rapid file events are coalesced into a single frontend refresh.
func (a *App) emitProfileChangedDebounced() {
	pw := a.profiles.profileWatcher
	if pw == nil || a.ctx == nil {
		return
	}

	pw.debounceMutex.Lock()
	defer pw.debounceMutex.Unlock()

	if pw.debounceTimer != nil {
		pw.debounceTimer.Stop()
	}

	pw.debounceTimer = time.AfterFunc(WatcherDebounceMs, func() {
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "profile:file:changed", nil)
		}
	})
}

// handleFileModified handles file modification events
func (a *App) handleFileModified(filePath string) {
	baseName := filepath.Base(filePath)

	if strings.HasPrefix(strings.ToLower(baseName), "folder-") {
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
	a.handleFileModified(filePath)
}

// handleFileRemoved handles file deletion events
func (a *App) handleFileRemoved(filePath string) {
	baseName := filepath.Base(filePath)

	if strings.HasPrefix(strings.ToLower(baseName), "folder-") {
		a.handleFolderFileRemoved(baseName)
	} else {
		a.handleProfileFileRemoved(baseName)
	}
}

// handleProfileFileRemoved removes a deleted profile from memory
func (a *App) handleProfileFileRemoved(baseName string) {
	// Extract ID from filename: Name-ID.yaml
	name := strings.TrimSuffix(baseName, ".yaml")
	parts := strings.Split(name, "-")
	if len(parts) < 2 {
		return
	}

	id := parts[len(parts)-1]

	a.profiles.mutex.Lock()
	if _, exists := a.profiles.profiles[id]; exists {
		delete(a.profiles.profiles, id)
		fmt.Printf("Removed deleted profile from memory: %s\n", id)
	}
	a.profiles.mutex.Unlock()
}

// handleFolderFileRemoved removes a deleted folder from memory
func (a *App) handleFolderFileRemoved(baseName string) {
	// Extract ID from filename: folder-Name-ID.yaml
	name := strings.TrimSuffix(baseName, ".yaml")
	parts := strings.Split(name, "-")
	if len(parts) < 3 {
		return
	}

	id := parts[len(parts)-1]

	a.profiles.mutex.Lock()
	if _, exists := a.profiles.profileFolders[id]; exists {
		delete(a.profiles.profileFolders, id)
		fmt.Printf("Removed deleted folder from memory: %s\n", id)
	}
	a.profiles.mutex.Unlock()
}

// handleFileRenamed handles file rename events
func (a *App) handleFileRenamed(filePath string) {
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
	a.StopProfileWatcher()
	return a.StartProfileWatcher()
}
