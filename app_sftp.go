package main

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pkg/sftp"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// joinRemotePath properly joins remote paths using forward slashes
func joinRemotePath(base, name string) string {
	if base == "" {
		return name
	}
	if name == "" {
		return base
	}
	// Always use forward slashes for remote paths (Unix-style)
	return strings.TrimSuffix(base, "/") + "/" + name
}

// SFTPClientWrapper wraps an SFTP client for resource management
type SFTPClientWrapper struct {
	client    *sftp.Client
	sessionID string
}

// Close implements the Cleanup interface for SFTPClientWrapper
func (w *SFTPClientWrapper) Close() error {
	if w.client != nil {
		return w.client.Close()
	}
	return nil
}

// TransferProgress tracks progress of file transfers
type TransferProgress struct {
	SessionID    string  `json:"sessionId"`
	Phase        string  `json:"phase"`     // "start", "progress", "complete", "error"
	Direction    string  `json:"direction"` // "upload" or "download"
	FileName     string  `json:"fileName"`
	FileIndex    int     `json:"fileIndex"`
	TotalFiles   int     `json:"totalFiles"`
	Transferred  int64   `json:"transferred"`
	Total        int64   `json:"total"`
	Percent      float64 `json:"percent"`
	BytesPerSec  int64   `json:"bytesPerSec,omitempty"` // Transfer speed
	ErrorMessage string  `json:"errorMessage,omitempty"`
}

// TransferJob represents a single file transfer job for the worker pool
type TransferJob struct {
	LocalPath  string
	RemotePath string
	FileName   string
	FileIndex  int
	TotalFiles int
	IsUpload   bool
	FileSize   int64
}

// TransferResult represents the result of a file transfer
type TransferResult struct {
	Job   TransferJob
	Error error
}

// TransferState tracks active transfers for cancellation
type TransferState struct {
	cancelled bool
	mu        sync.RWMutex
}

// activeTransfers tracks ongoing transfers per session for cancellation
var activeTransfers = make(map[string]*TransferState)
var activeTransfersMu sync.RWMutex

// SFTP File Explorer Methods

// progressReader wraps an io.Reader and periodically emits transfer progress events
type progressReader struct {
	reader      io.Reader
	app         *App
	sessionID   string
	fileName    string
	fileIndex   int
	totalFiles  int
	totalBytes  int64
	readBytes   int64
	lastEmitted time.Time
	startTime   time.Time
	direction   string // "upload" or "download"
	eventName   string // event name to emit
}

func newProgressReader(reader io.Reader, app *App, sessionID, fileName string, fileIndex, totalFiles int, totalBytes int64, direction string) *progressReader {
	eventName := "sftp-upload-progress"
	if direction == "download" {
		eventName = "sftp-download-progress"
	}
	return &progressReader{
		reader:     reader,
		app:        app,
		sessionID:  sessionID,
		fileName:   fileName,
		fileIndex:  fileIndex,
		totalFiles: totalFiles,
		totalBytes: totalBytes,
		direction:  direction,
		eventName:  eventName,
		startTime:  time.Now(),
	}
}

// ErrTransferCancelled is returned when a transfer is cancelled by the user
var ErrTransferCancelled = fmt.Errorf("transfer cancelled by user")

func (pr *progressReader) Read(p []byte) (int, error) {
	// Check for cancellation before reading
	if pr.app != nil && pr.app.isTransferCancelled(pr.sessionID) {
		return 0, ErrTransferCancelled
	}

	n, err := pr.reader.Read(p)
	if n > 0 {
		pr.readBytes += int64(n)
		now := time.Now()
		if pr.readBytes == pr.totalBytes || now.Sub(pr.lastEmitted) >= 150*time.Millisecond {
			percent := float64(0)
			if pr.totalBytes > 0 {
				percent = float64(pr.readBytes) * 100.0 / float64(pr.totalBytes)
			}
			// Calculate transfer speed
			elapsed := now.Sub(pr.startTime).Seconds()
			var bytesPerSec int64
			if elapsed > 0 {
				bytesPerSec = int64(float64(pr.readBytes) / elapsed)
			}
			if pr.app != nil && pr.app.ctx != nil {
				wailsRuntime.EventsEmit(pr.app.ctx, pr.eventName, map[string]interface{}{
					"sessionId":   pr.sessionID,
					"phase":       "progress",
					"direction":   pr.direction,
					"fileName":    pr.fileName,
					"fileIndex":   pr.fileIndex,
					"totalFiles":  pr.totalFiles,
					"transferred": pr.readBytes,
					"total":       pr.totalBytes,
					"percent":     percent,
					"bytesPerSec": bytesPerSec,
				})
			}
			pr.lastEmitted = now
		}
	}
	return n, err
}

// progressWriter wraps an io.Writer and periodically emits transfer progress events
type progressWriter struct {
	writer       io.Writer
	app          *App
	sessionID    string
	fileName     string
	fileIndex    int
	totalFiles   int
	totalBytes   int64
	writtenBytes int64
	lastEmitted  time.Time
	startTime    time.Time
	direction    string
	eventName    string
}

func newProgressWriter(writer io.Writer, app *App, sessionID, fileName string, fileIndex, totalFiles int, totalBytes int64, direction string) *progressWriter {
	eventName := "sftp-upload-progress"
	if direction == "download" {
		eventName = "sftp-download-progress"
	}
	return &progressWriter{
		writer:     writer,
		app:        app,
		sessionID:  sessionID,
		fileName:   fileName,
		fileIndex:  fileIndex,
		totalFiles: totalFiles,
		totalBytes: totalBytes,
		direction:  direction,
		eventName:  eventName,
		startTime:  time.Now(),
	}
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	// Check for cancellation before writing
	if pw.app != nil && pw.app.isTransferCancelled(pw.sessionID) {
		return 0, ErrTransferCancelled
	}

	n, err := pw.writer.Write(p)
	if n > 0 {
		pw.writtenBytes += int64(n)
		now := time.Now()
		if pw.writtenBytes == pw.totalBytes || now.Sub(pw.lastEmitted) >= 150*time.Millisecond {
			percent := float64(0)
			if pw.totalBytes > 0 {
				percent = float64(pw.writtenBytes) * 100.0 / float64(pw.totalBytes)
			}
			// Calculate transfer speed
			elapsed := now.Sub(pw.startTime).Seconds()
			var bytesPerSec int64
			if elapsed > 0 {
				bytesPerSec = int64(float64(pw.writtenBytes) / elapsed)
			}
			if pw.app != nil && pw.app.ctx != nil {
				wailsRuntime.EventsEmit(pw.app.ctx, pw.eventName, map[string]interface{}{
					"sessionId":   pw.sessionID,
					"phase":       "progress",
					"direction":   pw.direction,
					"fileName":    pw.fileName,
					"fileIndex":   pw.fileIndex,
					"totalFiles":  pw.totalFiles,
					"transferred": pw.writtenBytes,
					"total":       pw.totalBytes,
					"percent":     percent,
					"bytesPerSec": bytesPerSec,
				})
			}
			pw.lastEmitted = now
		}
	}
	return n, err
}

func (a *App) emitUploadEvent(sessionID string, phase string, payload map[string]interface{}) {
	a.emitTransferEvent(sessionID, phase, "upload", payload)
}

func (a *App) emitDownloadEvent(sessionID string, phase string, payload map[string]interface{}) {
	a.emitTransferEvent(sessionID, phase, "download", payload)
}

func (a *App) emitTransferEvent(sessionID string, phase string, direction string, payload map[string]interface{}) {
	if a == nil || a.ctx == nil {
		return
	}
	data := map[string]interface{}{
		"sessionId": sessionID,
		"phase":     phase,
		"direction": direction,
	}
	for k, v := range payload {
		data[k] = v
	}
	eventName := "sftp-upload-progress"
	if direction == "download" {
		eventName = "sftp-download-progress"
	}
	wailsRuntime.EventsEmit(a.ctx, eventName, data)
}

// getSFTPConfig returns the current SFTP configuration with defaults
func (a *App) getSFTPConfig() SFTPConfig {
	if a.config != nil && a.config.config != nil {
		cfg := a.config.config.SFTP
		// Apply defaults if values are zero
		if cfg.MaxPacketSize == 0 {
			cfg.MaxPacketSize = DefaultSFTPMaxPacketSize
		}
		if cfg.BufferSize == 0 {
			cfg.BufferSize = DefaultSFTPBufferSize
		}
		if cfg.ConcurrentRequests == 0 {
			cfg.ConcurrentRequests = DefaultSFTPConcurrentRequests
		}
		if cfg.ParallelTransfers == 0 {
			cfg.ParallelTransfers = DefaultSFTPParallelTransfers
		}
		return cfg
	}
	return SFTPConfig{
		MaxPacketSize:      DefaultSFTPMaxPacketSize,
		BufferSize:         DefaultSFTPBufferSize,
		ConcurrentRequests: DefaultSFTPConcurrentRequests,
		ParallelTransfers:  DefaultSFTPParallelTransfers,
		UseConcurrentIO:    true,
	}
}

// startTransfer marks the beginning of a transfer for cancellation tracking
func (a *App) startTransfer(sessionID string) *TransferState {
	activeTransfersMu.Lock()
	defer activeTransfersMu.Unlock()

	state := &TransferState{cancelled: false}
	activeTransfers[sessionID] = state
	return state
}

// endTransfer cleans up transfer state
func (a *App) endTransfer(sessionID string) {
	activeTransfersMu.Lock()
	defer activeTransfersMu.Unlock()
	delete(activeTransfers, sessionID)
}

// isTransferCancelled checks if a transfer has been cancelled
func (a *App) isTransferCancelled(sessionID string) bool {
	activeTransfersMu.RLock()
	state, exists := activeTransfers[sessionID]
	activeTransfersMu.RUnlock()

	if !exists {
		return false
	}

	state.mu.RLock()
	defer state.mu.RUnlock()
	return state.cancelled
}

// CancelSFTPTransfer cancels an ongoing SFTP transfer
func (a *App) CancelSFTPTransfer(sessionID string) error {
	activeTransfersMu.RLock()
	state, exists := activeTransfers[sessionID]
	activeTransfersMu.RUnlock()

	if !exists {
		return fmt.Errorf("no active transfer for session %s", sessionID)
	}

	state.mu.Lock()
	state.cancelled = true
	state.mu.Unlock()

	fmt.Printf("SFTP transfer cancelled for session %s\n", sessionID)
	return nil
}

// getOrReconnectSFTPClient gets the SFTP client, reconnecting if connection was lost
func (a *App) getOrReconnectSFTPClient(sessionID string) (*sftp.Client, error) {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Test if connection is still alive by trying a simple operation
	_, err := sftpClient.Getwd()
	if err != nil {
		fmt.Printf("SFTP connection lost for session %s, attempting reconnect...\n", sessionID)

		// Close the old client
		a.ssh.sftpClientsMutex.Lock()
		if oldClient, exists := a.ssh.sftpClients[sessionID]; exists {
			oldClient.Close()
			delete(a.ssh.sftpClients, sessionID)
		}
		a.ssh.sftpClientsMutex.Unlock()

		// Reinitialize the SFTP client
		if err := a.InitializeFileExplorerSession(sessionID); err != nil {
			return nil, fmt.Errorf("failed to reconnect SFTP: %w", err)
		}

		// Get the new client
		a.ssh.sftpClientsMutex.RLock()
		sftpClient = a.ssh.sftpClients[sessionID]
		a.ssh.sftpClientsMutex.RUnlock()

		fmt.Printf("SFTP reconnected successfully for session %s\n", sessionID)
	}

	return sftpClient, nil
}

// InitializeFileExplorerSession initializes an SFTP client for the given SSH session
// Uses optimized settings for improved transfer performance
func (a *App) InitializeFileExplorerSession(sessionID string) error {
	a.ssh.sftpClientsMutex.Lock()
	defer a.ssh.sftpClientsMutex.Unlock()

	// Check if SFTP client already exists
	if _, exists := a.ssh.sftpClients[sessionID]; exists {
		return nil // Already initialized
	}

	// Check SFTP client limit
	if len(a.ssh.sftpClients) >= MaxSFTPClients {
		return fmt.Errorf("maximum number of SFTP clients (%d) reached", MaxSFTPClients)
	}

	// Get the SSH session using its dedicated mutex
	a.ssh.sshSessionsMutex.RLock()
	sshSession, exists := a.ssh.sshSessions[sessionID]
	a.ssh.sshSessionsMutex.RUnlock()

	if !exists || sshSession == nil {
		return fmt.Errorf("SSH session %s not found", sessionID)
	}

	if sshSession.client == nil {
		return fmt.Errorf("SSH session %s is not connected", sessionID)
	}

	// Get optimized SFTP configuration
	cfg := a.getSFTPConfig()

	// Build SFTP client options for optimized performance
	var opts []sftp.ClientOption

	// Increase max packet size (default is 32KB, we use 256KB for better throughput)
	// Use MaxPacketUnchecked to bypass the 32KB safety check - modern SFTP servers support larger packets
	opts = append(opts, sftp.MaxPacketUnchecked(cfg.MaxPacketSize))

	// Set concurrent requests per file for parallel I/O within a single file transfer
	opts = append(opts, sftp.MaxConcurrentRequestsPerFile(cfg.ConcurrentRequests))

	// Enable concurrent reads and writes for better performance on high-latency connections
	if cfg.UseConcurrentIO {
		opts = append(opts, sftp.UseConcurrentReads(true))
		opts = append(opts, sftp.UseConcurrentWrites(true))
	}

	// Create optimized SFTP client
	sftpClient, err := sftp.NewClient(sshSession.client, opts...)
	if err != nil {
		return fmt.Errorf("failed to create SFTP client: %w", err)
	}

	// Create wrapper for resource management
	wrapper := &SFTPClientWrapper{
		client:    sftpClient,
		sessionID: sessionID,
	}

	// Store the SFTP client
	a.ssh.sftpClients[sessionID] = sftpClient

	// Register for resource cleanup
	a.ssh.resourceManager.Register(wrapper)

	fmt.Printf("SFTP client initialized for session %s (MaxPacket=%dKB, ConcurrentReqs=%d, ConcurrentIO=%v)\n",
		sessionID, cfg.MaxPacketSize/1024, cfg.ConcurrentRequests, cfg.UseConcurrentIO)

	return nil
}

// GetRemoteWorkingDirectory gets the current working directory for an SSH session
func (a *App) GetRemoteWorkingDirectory(sessionID string) (string, error) {
	a.ssh.sshSessionsMutex.RLock()
	sshSession, exists := a.ssh.sshSessions[sessionID]
	a.ssh.sshSessionsMutex.RUnlock()

	if !exists || sshSession == nil {
		return "", fmt.Errorf("SSH session %s not found", sessionID)
	}

	// Check if monitoring session is available
	sshSession.monitoringMutex.RLock()
	monitoringEnabled := sshSession.monitoringEnabled
	sshSession.monitoringMutex.RUnlock()

	if !monitoringEnabled {
		return "", fmt.Errorf("monitoring session not available for %s", sessionID)
	}

	// Execute pwd command to get current working directory
	output, err := a.ExecuteMonitoringCommand(sshSession, "pwd")
	if err != nil {
		return "", fmt.Errorf("failed to execute pwd command: %w", err)
	}

	workingDir := strings.TrimSpace(output)
	if workingDir == "" {
		return "", fmt.Errorf("empty working directory result")
	}

	fmt.Printf("Working directory for session %s: %s\n", sessionID, workingDir)
	return workingDir, nil
}

// CloseFileExplorerSession closes and removes the SFTP client for the given session
func (a *App) CloseFileExplorerSession(sessionID string) error {
	a.ssh.sftpClientsMutex.Lock()
	defer a.ssh.sftpClientsMutex.Unlock()

	if sftpClient, exists := a.ssh.sftpClients[sessionID]; exists {
		sftpClient.Close()
		delete(a.ssh.sftpClients, sessionID)
		fmt.Printf("SFTP client closed for session %s\n", sessionID)
	}

	return nil
}

// ListRemoteFiles lists files and directories in the specified remote path
func (a *App) ListRemoteFiles(sessionID string, remotePath string) ([]RemoteFileEntry, error) {
	sftpClient, err := a.getOrReconnectSFTPClient(sessionID)
	if err != nil {
		return nil, err
	}
	_ = sftpClient // used below

	// Normalize path - use "." as fallback for empty path
	if remotePath == "" {
		remotePath = "."
	}

	// Log the path being accessed for debugging
	fmt.Printf("SFTP: Listing files for session %s, path: %s\n", sessionID, remotePath)

	// Read directory contents
	fileInfos, err := sftpClient.ReadDir(remotePath)
	if err != nil {
		fmt.Printf("SFTP: Failed to read directory %s: %v\n", remotePath, err)
		return nil, fmt.Errorf("failed to read directory %s: %w", remotePath, err)
	}

	// Get the working directory to resolve relative paths consistently
	var baseDir string
	if remotePath == "." {
		// Try to get the absolute working directory
		if wd, err := sftpClient.Getwd(); err == nil && wd != "" {
			baseDir = wd
			fmt.Printf("SFTP: Resolved working directory to: %s\n", baseDir)
		} else {
			// Fallback to relative path
			baseDir = "."
			fmt.Printf("SFTP: Using relative path fallback\n")
		}
	} else {
		baseDir = remotePath
	}

	var entries []RemoteFileEntry
	for _, fileInfo := range fileInfos {
		var fullPath string

		// Construct consistent paths
		if baseDir == "." {
			// For relative paths, just use the filename
			fullPath = fileInfo.Name()
		} else if baseDir == "/" {
			// For root directory
			fullPath = "/" + fileInfo.Name()
		} else {
			// For absolute paths, join properly
			if strings.HasSuffix(baseDir, "/") {
				fullPath = baseDir + fileInfo.Name()
			} else {
				fullPath = baseDir + "/" + fileInfo.Name()
			}
		}

		// Clean the path to remove any double slashes
		fullPath = strings.ReplaceAll(fullPath, "//", "/")

		fmt.Printf("SFTP: File: %s -> Path: %s\n", fileInfo.Name(), fullPath)

		entry := RemoteFileEntry{
			Name:         fileInfo.Name(),
			Path:         fullPath,
			IsDir:        fileInfo.IsDir(),
			Size:         fileInfo.Size(),
			Mode:         fileInfo.Mode().String(),
			ModifiedTime: fileInfo.ModTime(),
		}

		// Check if it's a symlink
		if fileInfo.Mode()&os.ModeSymlink != 0 {
			entry.IsSymlink = true
			// Try to read the symlink target
			if target, err := sftpClient.ReadLink(fullPath); err == nil {
				entry.SymlinkTarget = target
			}
		}

		entries = append(entries, entry)
	}

	fmt.Printf("SFTP: Successfully listed %d entries for path: %s\n", len(entries), remotePath)
	return entries, nil
}

// DownloadRemoteFile downloads a file from the remote server to local path with progress reporting
func (a *App) DownloadRemoteFile(sessionID string, remotePath string, localPath string) error {
	return a.DownloadRemoteFileWithProgress(sessionID, remotePath, localPath, 1, 1)
}

// DownloadRemoteFileWithProgress downloads a file with progress reporting for batch operations
func (a *App) DownloadRemoteFileWithProgress(sessionID string, remotePath string, localPath string, fileIndex, totalFiles int) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Open remote file
	remoteFile, err := sftpClient.Open(remotePath)
	if err != nil {
		return fmt.Errorf("failed to open remote file %s: %w", remotePath, err)
	}
	defer remoteFile.Close()

	// Get file info for progress tracking
	fileInfo, err := remoteFile.Stat()
	if err != nil {
		return fmt.Errorf("failed to stat remote file %s: %w", remotePath, err)
	}

	fileName := filepath.Base(remotePath)
	totalBytes := fileInfo.Size()

	// Emit download start event
	a.emitDownloadEvent(sessionID, "start", map[string]interface{}{
		"fileName":   fileName,
		"fileIndex":  fileIndex,
		"totalFiles": totalFiles,
		"total":      totalBytes,
	})

	// Create local file
	localFile, err := os.Create(localPath)
	if err != nil {
		a.emitDownloadEvent(sessionID, "error", map[string]interface{}{
			"fileName": fileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to create local file %s: %w", localPath, err)
	}
	defer localFile.Close()

	// Use buffered writer for better performance
	cfg := a.getSFTPConfig()
	bufferedWriter := bufio.NewWriterSize(localFile, cfg.BufferSize)
	defer bufferedWriter.Flush()

	// Wrap with progress writer for progress tracking
	progressWriter := newProgressWriter(bufferedWriter, a, sessionID, fileName, fileIndex, totalFiles, totalBytes, "download")

	// Use optimized buffer for copying
	buffer := make([]byte, cfg.BufferSize)
	_, err = io.CopyBuffer(progressWriter, remoteFile, buffer)
	if err != nil {
		// Close file before attempting delete
		localFile.Close()

		// If cancelled, delete the partial file
		if errors.Is(err, ErrTransferCancelled) {
			os.Remove(localPath)
			return fmt.Errorf("download cancelled")
		}

		a.emitDownloadEvent(sessionID, "error", map[string]interface{}{
			"fileName": fileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to copy file data: %w", err)
	}

	// Flush the buffered writer
	if err := bufferedWriter.Flush(); err != nil {
		return fmt.Errorf("failed to flush file data: %w", err)
	}

	// Emit download complete event
	a.emitDownloadEvent(sessionID, "complete", map[string]interface{}{
		"fileName":    fileName,
		"fileIndex":   fileIndex,
		"totalFiles":  totalFiles,
		"total":       totalBytes,
		"transferred": totalBytes,
		"percent":     100.0,
	})

	return nil
}

// DownloadRemoteDirectory downloads a directory recursively from the remote server to local path
// Uses parallel file downloads for improved performance
func (a *App) DownloadRemoteDirectory(sessionID string, remotePath string, localPath string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Check if remote path is actually a directory
	stat, err := sftpClient.Stat(remotePath)
	if err != nil {
		return fmt.Errorf("failed to stat remote path %s: %w", remotePath, err)
	}

	if !stat.IsDir() {
		// If it's a file, just use the regular file download
		return a.DownloadRemoteFile(sessionID, remotePath, localPath)
	}

	// Start transfer tracking for cancellation
	a.startTransfer(sessionID)
	defer a.endTransfer(sessionID)

	// Create local directory
	err = os.MkdirAll(localPath, 0755)
	if err != nil {
		return fmt.Errorf("failed to create local directory %s: %w", localPath, err)
	}

	// First, collect all files to download for progress tracking
	var downloadJobs []TransferJob
	if err := a.collectDownloadJobs(sftpClient, remotePath, localPath, &downloadJobs); err != nil {
		return err
	}

	if len(downloadJobs) == 0 {
		return nil // Empty directory
	}

	// Update job indices
	for i := range downloadJobs {
		downloadJobs[i].FileIndex = i + 1
		downloadJobs[i].TotalFiles = len(downloadJobs)
	}

	// Emit batch start
	dirName := filepath.Base(remotePath)
	a.emitDownloadEvent(sessionID, "batch-start", map[string]interface{}{
		"totalFiles": len(downloadJobs),
		"sourcePath": remotePath,
		"targetPath": localPath,
		"dirName":    dirName,
	})

	// Use parallel download worker pool
	cfg := a.getSFTPConfig()
	if err := a.executeParallelDownloads(sessionID, sftpClient, downloadJobs, cfg.ParallelTransfers); err != nil {
		return err
	}

	// Emit batch complete
	a.emitDownloadEvent(sessionID, "batch-complete", map[string]interface{}{
		"totalFiles": len(downloadJobs),
		"sourcePath": remotePath,
		"targetPath": localPath,
	})

	return nil
}

// collectDownloadJobs recursively collects all files to download, creating directories as needed
func (a *App) collectDownloadJobs(sftpClient *sftp.Client, remotePath string, localPath string, jobs *[]TransferJob) error {
	fileInfos, err := sftpClient.ReadDir(remotePath)
	if err != nil {
		return fmt.Errorf("failed to read directory %s: %w", remotePath, err)
	}

	for _, fileInfo := range fileInfos {
		remoteItemPath := joinRemotePath(remotePath, fileInfo.Name())
		localItemPath := filepath.Join(localPath, fileInfo.Name())

		if fileInfo.IsDir() {
			// Create local subdirectory
			if err := os.MkdirAll(localItemPath, 0755); err != nil {
				return fmt.Errorf("failed to create local directory %s: %w", localItemPath, err)
			}
			// Recursively collect from subdirectory
			if err := a.collectDownloadJobs(sftpClient, remoteItemPath, localItemPath, jobs); err != nil {
				return err
			}
		} else {
			// Add file to download jobs
			*jobs = append(*jobs, TransferJob{
				LocalPath:  localItemPath,
				RemotePath: remoteItemPath,
				FileName:   fileInfo.Name(),
				FileSize:   fileInfo.Size(),
				IsUpload:   false,
			})
		}
	}
	return nil
}

// executeParallelDownloads runs download jobs using a worker pool
func (a *App) executeParallelDownloads(sessionID string, sftpClient *sftp.Client, jobs []TransferJob, workers int) error {
	if len(jobs) == 0 {
		return nil
	}

	// Limit workers to job count
	if workers > len(jobs) {
		workers = len(jobs)
	}

	jobChan := make(chan TransferJob, len(jobs))
	resultChan := make(chan TransferResult, len(jobs))
	var wg sync.WaitGroup

	// Start worker goroutines
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cfg := a.getSFTPConfig()
			buffer := make([]byte, cfg.BufferSize)

			for job := range jobChan {
				err := a.downloadSingleFile(sessionID, sftpClient, job, buffer)
				resultChan <- TransferResult{Job: job, Error: err}
			}
		}()
	}

	// Send jobs to workers
	for _, job := range jobs {
		jobChan <- job
	}
	close(jobChan)

	// Wait for all workers to complete
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	// Collect results
	var firstError error
	for result := range resultChan {
		if result.Error != nil && firstError == nil {
			firstError = result.Error
		}
	}

	return firstError
}

// downloadSingleFile downloads a single file with progress reporting
func (a *App) downloadSingleFile(sessionID string, sftpClient *sftp.Client, job TransferJob, buffer []byte) error {
	// Check for cancellation before starting
	if a.isTransferCancelled(sessionID) {
		return fmt.Errorf("transfer cancelled")
	}

	// Emit start event
	a.emitDownloadEvent(sessionID, "start", map[string]interface{}{
		"fileName":   job.FileName,
		"fileIndex":  job.FileIndex,
		"totalFiles": job.TotalFiles,
		"total":      job.FileSize,
	})

	// Open remote file
	remoteFile, err := sftpClient.Open(job.RemotePath)
	if err != nil {
		a.emitDownloadEvent(sessionID, "error", map[string]interface{}{
			"fileName": job.FileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to open remote file %s: %w", job.RemotePath, err)
	}
	defer remoteFile.Close()

	// Create local file
	localFile, err := os.Create(job.LocalPath)
	if err != nil {
		a.emitDownloadEvent(sessionID, "error", map[string]interface{}{
			"fileName": job.FileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to create local file %s: %w", job.LocalPath, err)
	}
	defer localFile.Close()

	// Use buffered writer
	cfg := a.getSFTPConfig()
	bufferedWriter := bufio.NewWriterSize(localFile, cfg.BufferSize)
	defer bufferedWriter.Flush()

	// Wrap with progress writer
	progressWriter := newProgressWriter(bufferedWriter, a, sessionID, job.FileName, job.FileIndex, job.TotalFiles, job.FileSize, "download")

	// Copy with buffer
	_, err = io.CopyBuffer(progressWriter, remoteFile, buffer)
	if err != nil {
		// Close file before attempting delete
		localFile.Close()

		// If cancelled, delete the partial file
		if errors.Is(err, ErrTransferCancelled) {
			os.Remove(job.LocalPath)
			return fmt.Errorf("download cancelled")
		}

		a.emitDownloadEvent(sessionID, "error", map[string]interface{}{
			"fileName": job.FileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to copy file data: %w", err)
	}

	// Flush
	if err := bufferedWriter.Flush(); err != nil {
		return fmt.Errorf("failed to flush file data: %w", err)
	}

	// Emit complete event
	a.emitDownloadEvent(sessionID, "complete", map[string]interface{}{
		"fileName":    job.FileName,
		"fileIndex":   job.FileIndex,
		"totalFiles":  job.TotalFiles,
		"total":       job.FileSize,
		"transferred": job.FileSize,
		"percent":     100.0,
	})

	return nil
}

// UploadRemoteFiles uploads local files to the remote directory using parallel transfers
func (a *App) UploadRemoteFiles(sessionID string, localFilePaths []string, remotePath string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	totalFiles := len(localFilePaths)
	if totalFiles == 0 {
		return nil
	}

	// Start transfer tracking for cancellation
	a.startTransfer(sessionID)
	defer a.endTransfer(sessionID)

	// Build upload jobs
	var uploadJobs []TransferJob
	for i, localFilePath := range localFilePaths {
		fileName := filepath.Base(localFilePath)
		remoteFilePath := joinRemotePath(remotePath, fileName)

		// Get file size
		var fileSize int64
		if info, err := os.Stat(localFilePath); err == nil {
			fileSize = info.Size()
		}

		uploadJobs = append(uploadJobs, TransferJob{
			LocalPath:  localFilePath,
			RemotePath: remoteFilePath,
			FileName:   fileName,
			FileIndex:  i + 1,
			TotalFiles: totalFiles,
			IsUpload:   true,
			FileSize:   fileSize,
		})
	}

	// Emit batch start
	a.emitUploadEvent(sessionID, "batch-start", map[string]interface{}{
		"totalFiles": totalFiles,
		"targetPath": remotePath,
	})

	// Use parallel upload worker pool
	cfg := a.getSFTPConfig()
	if err := a.executeParallelUploads(sessionID, sftpClient, uploadJobs, cfg.ParallelTransfers); err != nil {
		return err
	}

	// Emit batch complete
	a.emitUploadEvent(sessionID, "batch-complete", map[string]interface{}{
		"totalFiles": totalFiles,
		"targetPath": remotePath,
	})

	return nil
}

// executeParallelUploads runs upload jobs using a worker pool
func (a *App) executeParallelUploads(sessionID string, sftpClient *sftp.Client, jobs []TransferJob, workers int) error {
	if len(jobs) == 0 {
		return nil
	}

	// For small batches, use sequential processing to maintain order
	if len(jobs) <= 2 || workers == 1 {
		for _, job := range jobs {
			if err := a.uploadSingleFile(sessionID, sftpClient, job); err != nil {
				return err
			}
		}
		return nil
	}

	// Limit workers to job count
	if workers > len(jobs) {
		workers = len(jobs)
	}

	jobChan := make(chan TransferJob, len(jobs))
	resultChan := make(chan TransferResult, len(jobs))
	var wg sync.WaitGroup

	// Start worker goroutines
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobChan {
				err := a.uploadSingleFile(sessionID, sftpClient, job)
				resultChan <- TransferResult{Job: job, Error: err}
			}
		}()
	}

	// Send jobs to workers
	for _, job := range jobs {
		jobChan <- job
	}
	close(jobChan)

	// Wait for all workers to complete
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	// Collect results
	var firstError error
	var completedCount int32
	for result := range resultChan {
		atomic.AddInt32(&completedCount, 1)
		if result.Error != nil && firstError == nil {
			firstError = result.Error
		}
	}

	return firstError
}

// uploadSingleFile uploads a single file with progress reporting
func (a *App) uploadSingleFile(sessionID string, sftpClient *sftp.Client, job TransferJob) error {
	// Check for cancellation before starting
	if a.isTransferCancelled(sessionID) {
		return fmt.Errorf("transfer cancelled")
	}

	// Emit start event
	a.emitUploadEvent(sessionID, "start", map[string]interface{}{
		"fileName":   job.FileName,
		"fileIndex":  job.FileIndex,
		"totalFiles": job.TotalFiles,
		"total":      job.FileSize,
	})

	// Open local file
	localFile, err := os.Open(job.LocalPath)
	if err != nil {
		a.emitUploadEvent(sessionID, "error", map[string]interface{}{
			"fileName": job.FileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to open local file %s: %w", job.LocalPath, err)
	}
	defer localFile.Close()

	// Create remote file
	remoteFile, err := sftpClient.Create(job.RemotePath)
	if err != nil {
		a.emitUploadEvent(sessionID, "error", map[string]interface{}{
			"fileName": job.FileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to create remote file %s: %w", job.RemotePath, err)
	}
	defer remoteFile.Close()

	// Use buffered reader for better performance
	cfg := a.getSFTPConfig()
	bufferedReader := bufio.NewReaderSize(localFile, cfg.BufferSize)

	// Wrap with progress reader
	progressReader := newProgressReader(bufferedReader, a, sessionID, job.FileName, job.FileIndex, job.TotalFiles, job.FileSize, "upload")

	// Copy with optimized buffer
	buffer := make([]byte, cfg.BufferSize)
	_, err = io.CopyBuffer(remoteFile, progressReader, buffer)
	if err != nil {
		// Close remote file before attempting delete
		remoteFile.Close()

		// If cancelled, delete the partial remote file
		if errors.Is(err, ErrTransferCancelled) {
			sftpClient.Remove(job.RemotePath)
			return fmt.Errorf("upload cancelled")
		}

		a.emitUploadEvent(sessionID, "error", map[string]interface{}{
			"fileName": job.FileName,
			"error":    err.Error(),
		})
		return fmt.Errorf("failed to copy file %s: %w", job.LocalPath, err)
	}

	// Emit complete event
	a.emitUploadEvent(sessionID, "complete", map[string]interface{}{
		"fileName":    job.FileName,
		"fileIndex":   job.FileIndex,
		"totalFiles":  job.TotalFiles,
		"total":       job.FileSize,
		"transferred": job.FileSize,
		"percent":     100.0,
	})

	return nil
}

// CreateRemoteDirectory creates a new directory on the remote server
func (a *App) CreateRemoteDirectory(sessionID string, remotePath string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	err := sftpClient.Mkdir(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create directory %s: %w", remotePath, err)
	}

	return nil
}

// DeleteRemotePath deletes a file or directory on the remote server (auto-detects recursion)
func (a *App) DeleteRemotePath(sessionID string, remotePath string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Check if it's a directory
	stat, err := sftpClient.Stat(remotePath)
	if err != nil {
		return fmt.Errorf("failed to stat %s: %w", remotePath, err)
	}

	if stat.IsDir() {
		// For directories, always use recursive deletion
		return a.deleteRemoteDirectoryRecursive(sftpClient, remotePath)
	} else {
		// For files, simple remove
		err := sftpClient.Remove(remotePath)
		if err != nil {
			return fmt.Errorf("failed to remove file %s: %w", remotePath, err)
		}
	}

	return nil
}

// DeleteRemotePathAdvanced deletes a file or directory with explicit recursion control
func (a *App) DeleteRemotePathAdvanced(sessionID string, remotePath string, isRecursive bool) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Check if it's a directory
	stat, err := sftpClient.Stat(remotePath)
	if err != nil {
		return fmt.Errorf("failed to stat %s: %w", remotePath, err)
	}

	if stat.IsDir() {
		if isRecursive {
			return a.deleteRemoteDirectoryRecursive(sftpClient, remotePath)
		} else {
			err := sftpClient.RemoveDirectory(remotePath)
			if err != nil {
				return fmt.Errorf("failed to remove directory %s: %w", remotePath, err)
			}
		}
	} else {
		err := sftpClient.Remove(remotePath)
		if err != nil {
			return fmt.Errorf("failed to remove file %s: %w", remotePath, err)
		}
	}

	return nil
}

// Helper function to recursively delete a directory
func (a *App) deleteRemoteDirectoryRecursive(sftpClient *sftp.Client, remotePath string) error {
	// List directory contents
	fileInfos, err := sftpClient.ReadDir(remotePath)
	if err != nil {
		return fmt.Errorf("failed to read directory %s: %w", remotePath, err)
	}

	// Delete each item recursively
	for _, fileInfo := range fileInfos {
		// Use proper remote path joining
		fullPath := joinRemotePath(remotePath, fileInfo.Name())

		if fileInfo.IsDir() {
			if err := a.deleteRemoteDirectoryRecursive(sftpClient, fullPath); err != nil {
				return err
			}
		} else {
			if err := sftpClient.Remove(fullPath); err != nil {
				return fmt.Errorf("failed to remove file %s: %w", fullPath, err)
			}
		}
	}

	// Remove the directory itself
	err = sftpClient.RemoveDirectory(remotePath)
	if err != nil {
		return fmt.Errorf("failed to remove directory %s: %w", remotePath, err)
	}

	return nil
}

// RenameRemotePath renames a file or directory on the remote server
func (a *App) RenameRemotePath(sessionID string, oldPath string, newPath string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	err := sftpClient.Rename(oldPath, newPath)
	if err != nil {
		return fmt.Errorf("failed to rename %s to %s: %w", oldPath, newPath, err)
	}

	return nil
}

// GetRemoteFileContent reads the content of a remote file
func (a *App) GetRemoteFileContent(sessionID string, remotePath string) (string, error) {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return "", fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Open the remote file
	file, err := sftpClient.Open(remotePath)
	if err != nil {
		return "", fmt.Errorf("failed to open remote file %s: %w", remotePath, err)
	}
	defer file.Close()

	// Read the file content
	content, err := io.ReadAll(file)
	if err != nil {
		return "", fmt.Errorf("failed to read file content: %w", err)
	}

	// Check if it's a binary file - consider both extension and content
	if !isTextContentWithExtension(remotePath, content) {
		// For binary files, return base64 encoded content
		return base64.StdEncoding.EncodeToString(content), nil
	}

	// For text files, return as string
	return string(content), nil
}

// UpdateRemoteFileContent updates the content of a remote file
func (a *App) UpdateRemoteFileContent(sessionID string, remotePath string, content string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Create or truncate the remote file
	file, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create/open remote file %s: %w", remotePath, err)
	}
	defer file.Close()

	// Write the content
	_, err = file.Write([]byte(content))
	if err != nil {
		return fmt.Errorf("failed to write file content: %w", err)
	}

	return nil
}

// UploadFileContent uploads file content from base64 string to a remote path
func (a *App) UploadFileContent(sessionID string, remotePath string, base64Content string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	// Decode base64 content
	content, err := base64.StdEncoding.DecodeString(base64Content)
	if err != nil {
		return fmt.Errorf("failed to decode base64 content: %w", err)
	}

	// Create or truncate the remote file
	file, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote file %s: %w", remotePath, err)
	}
	defer file.Close()

	// Emit start for single file upload
	fileName := filepath.Base(remotePath)
	totalBytes := int64(len(content))
	a.emitUploadEvent(sessionID, "start", map[string]interface{}{
		"fileName":   fileName,
		"fileIndex":  1,
		"totalFiles": 1,
		"total":      totalBytes,
	})

	// Get optimized chunk size from config
	cfg := a.getSFTPConfig()
	chunkSize := cfg.BufferSize
	if chunkSize > len(content) {
		chunkSize = len(content)
	}
	if chunkSize == 0 {
		chunkSize = 64 * 1024 // Fallback to 64KB
	}

	startTime := time.Now()
	var written int64
	for written < totalBytes {
		end := written + int64(chunkSize)
		if end > totalBytes {
			end = totalBytes
		}
		n, err := file.Write(content[written:end])
		if n > 0 {
			written += int64(n)
			percent := float64(0)
			if totalBytes > 0 {
				percent = float64(written) * 100.0 / float64(totalBytes)
			}
			// Calculate transfer speed
			elapsed := time.Since(startTime).Seconds()
			var bytesPerSec int64
			if elapsed > 0 {
				bytesPerSec = int64(float64(written) / elapsed)
			}
			a.emitUploadEvent(sessionID, "progress", map[string]interface{}{
				"fileName":    fileName,
				"fileIndex":   1,
				"totalFiles":  1,
				"transferred": written,
				"total":       totalBytes,
				"percent":     percent,
				"bytesPerSec": bytesPerSec,
			})
		}
		if err != nil {
			return fmt.Errorf("failed to write file content: %w", err)
		}
	}

	// Emit complete
	a.emitUploadEvent(sessionID, "complete", map[string]interface{}{
		"fileName":    fileName,
		"fileIndex":   1,
		"totalFiles":  1,
		"transferred": totalBytes,
		"total":       totalBytes,
		"percent":     100.0,
	})

	return nil
}

// isTextContentWithExtension checks if the content is likely text considering both file extension and content
func isTextContentWithExtension(filePath string, content []byte) bool {
	// Extract file extension
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext != "" {
		ext = ext[1:] // Remove the dot
	}

	// Define known text file extensions
	textExtensions := map[string]bool{
		"txt": true, "md": true, "json": true, "yaml": true, "yml": true, "xml": true,
		"html": true, "htm": true, "css": true, "js": true, "ts": true, "jsx": true,
		"tsx": true, "py": true, "java": true, "c": true, "cpp": true, "h": true,
		"hpp": true, "cs": true, "php": true, "rb": true, "go": true, "rs": true,
		"sh": true, "bash": true, "zsh": true, "fish": true, "ps1": true, "bat": true,
		"cmd": true, "sql": true, "r": true, "swift": true, "kt": true, "scala": true,
		"clj": true, "hs": true, "elm": true, "erl": true, "ex": true, "exs": true,
		"lua": true, "pl": true, "pm": true, "tcl": true, "vim": true, "conf": true,
		"config": true, "cfg": true, "ini": true, "toml": true, "properties": true,
		"env": true, "log": true, "csv": true, "tsv": true, "dockerfile": true,
		"makefile": true, "gradle": true, "pom": true, "sbt": true, "rc": true,
		"profile": true, "aliases": true, "exports": true, "functions": true,
		"path": true, "extra": true, "gitignore": true, "gitattributes": true,
		"gitmodules": true, "editorconfig": true, "eslintrc": true, "prettierrc": true,
		"babelrc": true, "npmrc": true, "yarnrc": true, "nvmrc": true, "rvmrc": true,
		"rbenv-version": true, "gemfile": true, "rakefile": true, "procfile": true,
		"cmakelists": true, "cmakecache": true, "requirements": true, "pipfile": true,
		"setup": true, "manifest": true, "license": true, "readme": true,
		"changelog": true, "authors": true, "contributors": true, "copying": true,
		"install": true, "news": true, "todo": true, "bugs": true, "thanks": true,
		"acknowledgments": true, "credits": true,
	}

	// If it's a known text extension, always treat as text
	if textExtensions[ext] {
		return true
	}

	// Check filename without extension for common text files
	fileName := strings.ToLower(filepath.Base(filePath))
	commonTextFiles := map[string]bool{
		"dockerfile": true, "makefile": true, "rakefile": true, "gemfile": true,
		"procfile": true, "vagrantfile": true, "license": true, "readme": true,
		"changelog": true, "authors": true, "contributors": true, "copying": true,
		"install": true, "news": true, "todo": true, "bugs": true, "thanks": true,
		"acknowledgments": true, "credits": true,
	}

	if commonTextFiles[fileName] {
		return true
	}

	// Check for files starting with dots (config files)
	if strings.HasPrefix(fileName, ".") && !strings.Contains(fileName[1:], ".") {
		return true
	}

	// For other files, fall back to content-based detection
	return isTextContent(content)
}

// isTextContent checks if the content is likely text (not binary) - legacy function for fallback
func isTextContent(content []byte) bool {
	// Check for null bytes which indicate binary content
	for _, b := range content {
		if b == 0 {
			return false
		}
	}

	// Check if most characters are printable (including UTF-8)
	printableCount := 0
	nonASCIICount := 0

	for _, b := range content {
		if (b >= 32 && b <= 126) || b == 9 || b == 10 || b == 13 {
			// Standard ASCII printable characters, tabs, newlines, carriage returns
			printableCount++
		} else if b >= 128 {
			// Non-ASCII bytes (could be UTF-8)
			nonASCIICount++
		}
	}

	totalPrintable := printableCount + nonASCIICount

	// If less than 90% are printable (lowered threshold to accommodate UTF-8), consider it binary
	if len(content) > 0 && float64(totalPrintable)/float64(len(content)) < 0.90 {
		return false
	}

	return true
}
