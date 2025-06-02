package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/sftp"
)

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

// SFTP File Explorer Methods

// InitializeFileExplorerSession initializes an SFTP client for the given SSH session
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

	// Create SFTP client
	sftpClient, err := sftp.NewClient(sshSession.client)
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

	fmt.Printf("SFTP client initialized for session %s\n", sessionID)

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
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

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

// DownloadRemoteFile downloads a file from the remote server to local path
func (a *App) DownloadRemoteFile(sessionID string, remotePath string, localPath string) error {
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

	// Create local file
	localFile, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create local file %s: %w", localPath, err)
	}
	defer localFile.Close()

	// Copy data
	_, err = io.Copy(localFile, remoteFile)
	if err != nil {
		return fmt.Errorf("failed to copy file data: %w", err)
	}

	return nil
}

// UploadRemoteFiles uploads local files to the remote directory
func (a *App) UploadRemoteFiles(sessionID string, localFilePaths []string, remotePath string) error {
	a.ssh.sftpClientsMutex.RLock()
	sftpClient, exists := a.ssh.sftpClients[sessionID]
	a.ssh.sftpClientsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("SFTP client not initialized for session %s", sessionID)
	}

	for _, localFilePath := range localFilePaths {
		// Open local file
		localFile, err := os.Open(localFilePath)
		if err != nil {
			return fmt.Errorf("failed to open local file %s: %w", localFilePath, err)
		}

		// Get file name from path
		fileName := filepath.Base(localFilePath)
		remoteFilePath := filepath.Join(remotePath, fileName)

		// Create remote file
		remoteFile, err := sftpClient.Create(remoteFilePath)
		if err != nil {
			localFile.Close()
			return fmt.Errorf("failed to create remote file %s: %w", remoteFilePath, err)
		}

		// Copy data
		_, err = io.Copy(remoteFile, localFile)

		// Close files
		localFile.Close()
		remoteFile.Close()

		if err != nil {
			return fmt.Errorf("failed to copy file %s: %w", localFilePath, err)
		}
	}

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
		fullPath := filepath.Join(remotePath, fileInfo.Name())

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
