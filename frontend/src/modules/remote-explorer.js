// Remote File Explorer module for SFTP file browsing
import { updateStatus, showNotification } from './utils.js';

export class RemoteExplorerManager {
    constructor(tabsManager) {
        this.tabsManager = tabsManager;
        this.isActivePanel = false;
        this.currentSessionID = null;
        this.currentRemotePath = null;
        this.loadingIndicator = null;
        this.breadcrumbs = [];
        this.fileCache = new Map(); // Cache directory listings for performance
        this.backgroundSessionID = null; // Track session in background
        this.backgroundRemotePath = null; // Track path in background
    }

    init() {
        this.setupEventListeners();
        console.log('✅ Remote Explorer initialized');
    }

    setupEventListeners() {
        // Listen for active tab changes from the tabs manager
        document.addEventListener('active-tab-changed', (e) => {
            console.log('🔄 Active tab changed event received');
            console.log('🔄 isActivePanel:', this.isActivePanel);
            console.log('🔄 Event detail:', e.detail);
            
            if (this.isActivePanel) {
                console.log('🔄 Processing tab change (panel is active)');
                this.handleActiveTabChanged(e.detail);
            } else {
                console.log('🔄 Ignoring tab change (panel is not active)');
            }
        });

        // Listen for file interaction events
        document.addEventListener('click', (e) => {
            if (!this.isActivePanel) return;

            // Handle breadcrumb navigation
            if (e.target.closest('.breadcrumb-item')) {
                const breadcrumb = e.target.closest('.breadcrumb-item');
                const path = breadcrumb.dataset.path;
                this.navigateToPath(path);
                return;
            }

            // Handle file/directory clicks
            if (e.target.closest('.file-item')) {
                const fileItem = e.target.closest('.file-item');
                this.handleFileItemClick(fileItem, e);
                return;
            }

            // Handle toolbar buttons
            if (e.target.closest('.file-toolbar-btn')) {
                const btn = e.target.closest('.file-toolbar-btn');
                this.handleToolbarAction(btn.dataset.action);
                return;
            }
        });

        // Listen for double clicks on file items
        document.addEventListener('dblclick', (e) => {
            if (!this.isActivePanel) return;

            if (e.target.closest('.file-item')) {
                const fileItem = e.target.closest('.file-item');
                this.handleFileItemDoubleClick(fileItem);
            }
        });

        // Listen for context menu events
        document.addEventListener('contextmenu', (e) => {
            if (!this.isActivePanel) return;

            if (e.target.closest('.file-item')) {
                e.preventDefault();
                const fileItem = e.target.closest('.file-item');
                
                // Extract file data from the DOM element
                const fileData = {
                    name: fileItem.dataset.name,
                    path: fileItem.dataset.path,
                    isDir: fileItem.dataset.isDir === 'true',
                    isParent: fileItem.dataset.isParent === 'true'
                };
                
                // Use the existing context menu system
                if (window.contextMenuManager) {
                    window.contextMenuManager.showFileExplorerItemContextMenu(e, fileItem, fileData);
                }
            } else if (e.target.closest('.remote-files-container')) {
                e.preventDefault();
                
                // Use the existing context menu system for directory context menu
                if (window.contextMenuManager) {
                    window.contextMenuManager.showFileExplorerDirectoryContextMenu(e);
                }
            }
        });

        // Listen for keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (!this.isActivePanel) return;

            // F3 - Preview selected file
            if (e.key === 'F3') {
                // Check if a file preview is currently open
                const filePreviewOpen = document.getElementById('file-preview-overlay');
                if (filePreviewOpen && filePreviewOpen.classList.contains('active')) {
                    console.log('📄 F3 pressed with file preview open - this will be handled by preview modal');
                    return; // Let the file preview modal handle F3 (close)
                }
                
                e.preventDefault();
                const selectedFile = document.querySelector('.file-item.selected');
                if (selectedFile && selectedFile.dataset.isDir !== 'true') {
                    this.showFilePreview(selectedFile.dataset.path, selectedFile.dataset.name);
                }
                return;
            }

            // Enter - Open/navigate to selected item
            if (e.key === 'Enter') {
                // Check if a file preview is currently open - if so, don't handle Enter
                const filePreviewOpen = document.getElementById('file-preview-overlay');
                if (filePreviewOpen && filePreviewOpen.classList.contains('active')) {
                    console.log('📄 File preview is active, ignoring Enter key');
                    return; // Let the editor handle Enter key
                }
                
                e.preventDefault();
                const selectedFile = document.querySelector('.file-item.selected');
                if (selectedFile) {
                    this.handleFileItemDoubleClick(selectedFile);
                }
                return;
            }

            // Delete - Delete selected item (with confirmation)
            if (e.key === 'Delete') {
                // Check if a file preview is currently open - if so, don't handle Delete
                const filePreviewOpen = document.getElementById('file-preview-overlay');
                if (filePreviewOpen && filePreviewOpen.classList.contains('active')) {
                    console.log('📄 File preview is active, ignoring Delete key');
                    return; // Let the editor handle Delete key
                }
                
                e.preventDefault();
                const selectedFile = document.querySelector('.file-item.selected');
                if (selectedFile && selectedFile.dataset.isParent !== 'true') {
                    this.showDeleteConfirmation(
                        selectedFile.dataset.path,
                        selectedFile.dataset.name,
                        selectedFile.dataset.isDir === 'true'
                    );
                }
                return;
            }

            // F2 - Rename selected item
            if (e.key === 'F2') {
                // Check if a file preview is currently open - if so, don't handle F2
                const filePreviewOpen = document.getElementById('file-preview-overlay');
                if (filePreviewOpen && filePreviewOpen.classList.contains('active')) {
                    console.log('📄 File preview is active, ignoring F2 key');
                    return; // Let the editor handle F2 key
                }
                
                e.preventDefault();
                const selectedFile = document.querySelector('.file-item.selected');
                if (selectedFile && selectedFile.dataset.isParent !== 'true') {
                    this.showRenameDialog(selectedFile.dataset.path, selectedFile.dataset.name);
                }
                return;
            }

            // F5 - Refresh directory
            if (e.key === 'F5') {
                // Check if a file preview is currently open - if so, don't handle F5
                const filePreviewOpen = document.getElementById('file-preview-overlay');
                if (filePreviewOpen && filePreviewOpen.classList.contains('active')) {
                    console.log('📄 File preview is active, ignoring F5 key');
                    return; // Let the editor handle F5 key (if needed)
                }
                
                e.preventDefault();
                this.refreshCurrentDirectory();
                return;
            }
        });

        // Set up toolbar event listeners when the UI is rendered
        this.setupToolbarEventListeners();
    }

    setupToolbarEventListeners() {
        // This will be called after the UI is rendered
        // Add event listener for upload button
        const uploadBtn = document.getElementById('upload-files-btn');
        if (uploadBtn) {
            uploadBtn.removeEventListener('click', this.handleUploadClick); // Remove any existing listener
            this.handleUploadClick = async () => {
                await this.handleFileUpload();
            };
            uploadBtn.addEventListener('click', this.handleUploadClick);
        }

        // Add event listener for new folder button
        const newFolderBtn = document.querySelector('.file-toolbar-btn[data-action="new-folder"]');
        if (newFolderBtn) {
            newFolderBtn.removeEventListener('click', this.handleNewFolderClick); // Remove any existing listener
            this.handleNewFolderClick = async () => {
                await this.handleToolbarAction('new-folder');
            };
            newFolderBtn.addEventListener('click', this.handleNewFolderClick);
        }

        // Add event listener for new file button
        const newFileBtn = document.querySelector('.file-toolbar-btn[data-action="new-file"]');
        if (newFileBtn) {
            newFileBtn.removeEventListener('click', this.handleNewFileClick); // Remove any existing listener
            this.handleNewFileClick = async () => {
                await this.handleToolbarAction('new-file');
            };
            newFileBtn.addEventListener('click', this.handleNewFileClick);
        }

        // Add event listener for refresh button
        const refreshBtn = document.querySelector('.file-toolbar-btn[data-action="refresh"]');
        if (refreshBtn) {
            refreshBtn.removeEventListener('click', this.handleRefreshClick); // Remove any existing listener
            this.handleRefreshClick = async () => {
                await this.handleToolbarAction('refresh');
            };
            refreshBtn.addEventListener('click', this.handleRefreshClick);
        }
    }

    // Called when the Files sidebar panel becomes active
    async handlePanelBecameActive() {
        console.log('🔵 Remote Explorer: Panel became active');
        console.log('🔵 Current session ID:', this.currentSessionID);
        console.log('🔵 Background session ID:', this.backgroundSessionID);
        console.log('🔵 Background path:', this.backgroundRemotePath);
        
        this.isActivePanel = true;

        // Get current active tab
        const activeTab = this.tabsManager.getActiveTab();
        console.log('🔵 Active tab:', activeTab);
        
        // Check if we have a valid SSH tab
        if (!activeTab || activeTab.connectionType !== 'ssh' || activeTab.status !== 'connected') {
            console.log('🔴 No SSH tab or not connected - showing select SSH message');
            this.showSelectSSHMessage();
            return;
        }
        
        // Check if we have a background session for this same tab
        if (this.backgroundSessionID === activeTab.sessionId) {
            console.log('🟢 Restoring background SFTP session:', this.backgroundSessionID);
            console.log('🟢 Restoring path:', this.backgroundRemotePath);
            
            // Restore from background
            this.currentSessionID = this.backgroundSessionID;
            this.currentRemotePath = this.backgroundRemotePath || '.';
            
            console.log('🟢 Restored current path:', this.currentRemotePath);
            
            // Check if we have cached content for this path
            const cacheKey = `${this.currentSessionID}:${this.currentRemotePath}`;
            console.log('🟢 Checking cache key:', cacheKey);
            console.log('🟢 Cache has key:', this.fileCache.has(cacheKey));
            
            if (this.fileCache.has(cacheKey)) {
                console.log('🟢 Using cached content for path:', this.currentRemotePath);
                const cachedFiles = this.fileCache.get(cacheKey);
                console.log('🟢 Cached files count:', cachedFiles.length);
                
                // Add parent directory if needed
                const processedFiles = [...cachedFiles];
                if (this.currentRemotePath !== '/') {
                    const parentPath = this.getParentPath(this.currentRemotePath);
                    console.log('🟢 Adding parent directory with path:', parentPath);
                    processedFiles.unshift({
                        name: '..',
                        path: parentPath,
                        isDir: true,
                        isParent: true,
                        size: 0,
                        mode: 'drwxr-xr-x',
                        modifiedTime: new Date()
                    });
                }
                
                // Sort files
                processedFiles.sort((a, b) => {
                    if (a.isParent) return -1;
                    if (b.isParent) return 1;
                    if (a.isDir !== b.isDir) {
                        return b.isDir - a.isDir;
                    }
                    return a.name.localeCompare(b.name);
                });
                
                console.log('🟢 About to render UI - files count:', processedFiles.length);
                
                // Render the UI completely
                this.renderFileExplorerUI();
                console.log('🟢 File explorer UI rendered');
                
                this.updateBreadcrumbs(this.currentRemotePath); // Rebuild breadcrumbs from path
                console.log('🟢 Breadcrumbs updated for path:', this.currentRemotePath);
                
                this.renderFileList(processedFiles);
                console.log('🟢 File list rendered');
            } else {
                console.log('🟠 No cache, reloading directory:', this.currentRemotePath);
                // No cache, reload the directory
                try {
                    await this.loadDirectoryContent(this.currentRemotePath);
                } catch (error) {
                    console.error('Failed to load directory content:', error);
                    this.showErrorState(`Failed to load directory: ${error.message}`);
                }
            }
            
            updateStatus(`File Explorer restored for ${activeTab.title}`);
        } else {
            console.log('🔴 Different tab or no background session - initializing new');
            // Different tab or no background session - initialize new
            try {
                await this.initializeForSSHSession(activeTab);
            } catch (error) {
                console.error('Failed to initialize for SSH session:', error);
                this.showErrorState(`Failed to initialize: ${error.message}`);
            }
        }
    }

    // Called when the Files sidebar panel becomes hidden (switching to Profiles, etc.)
    async handlePanelBecameHidden() {
        console.log('🔵 Remote Explorer: Panel became hidden');
        console.log('🔵 Current session ID before hiding:', this.currentSessionID);
        console.log('🔵 Current path before hiding:', this.currentRemotePath);
        
        this.isActivePanel = false;

        // Move current session to background instead of disconnecting
        if (this.currentSessionID) {
            console.log('🟡 Moving SFTP session to background:', this.currentSessionID);
            console.log('🟡 Saving current path:', this.currentRemotePath);
            
            this.backgroundSessionID = this.currentSessionID;
            this.backgroundRemotePath = this.currentRemotePath;
            // Note: We don't need to save breadcrumbs since we rebuild them from path
            
            console.log('🟡 Background session saved:', this.backgroundSessionID);
            console.log('🟡 Background path saved:', this.backgroundRemotePath);
            
            // Clear active session but keep background
            this.currentSessionID = null;
            this.currentRemotePath = null;
            
            console.log('🟡 Active session cleared');
        }

        // DON'T clear the view - keep the UI intact for faster restoration
        console.log('🟡 NOT calling clearView() - keeping UI intact');
        // this.clearView();
        console.log('🟡 handlePanelBecameHidden completed');
    }

    // Handle active tab changes when panel is visible
    async handleActiveTabChanged(tabDetails) {
        const { tab } = tabDetails;
        
        console.log('🔄 handleActiveTabChanged called with tab:', tab);
        console.log('🔄 Current session ID:', this.currentSessionID);
        console.log('🔄 Background session ID:', this.backgroundSessionID);

        // If switching to a different SSH session or different session type
        if (tab && tab.connectionType === 'ssh' && tab.status === 'connected') {
            if (this.currentSessionID !== tab.sessionId) {
                console.log('🔄 Switching to different session:', tab.sessionId);
                
                // Clean up old session (if different from background)
                if (this.currentSessionID && this.currentSessionID !== this.backgroundSessionID) {
                    await this.cleanupSFTPSession(this.currentSessionID);
                }
                
                // Check if this tab matches our background session
                if (this.backgroundSessionID === tab.sessionId) {
                    console.log('🟢 Switching to background SFTP session:', this.backgroundSessionID);
                    console.log('🟢 Restoring background path:', this.backgroundRemotePath);
                    
                    // Restore from background
                    this.currentSessionID = this.backgroundSessionID;
                    this.currentRemotePath = this.backgroundRemotePath || '.';
                    
                    // Always reload the directory to ensure fresh state
                    // Don't use cache here to avoid stale breadcrumbs
                    console.log('🟢 Reloading directory for tab switch:', this.currentRemotePath);
                    await this.loadDirectoryContent(this.currentRemotePath);
                    
                    updateStatus(`File Explorer switched to ${tab.title}`);
                } else {
                    // Clean up old background session if different
                    if (this.backgroundSessionID && this.backgroundSessionID !== tab.sessionId) {
                        await this.cleanupSFTPSession(this.backgroundSessionID);
                        this.backgroundSessionID = null;
                        this.backgroundRemotePath = null;
                    }
                    
                    // Initialize new session
                    console.log('🔴 Initializing new session for tab:', tab.sessionId);
                    await this.initializeForSSHSession(tab);
                }
            } else {
                console.log('🔄 Same session, no action needed');
            }
        } else {
            console.log('🔴 Tab is not SSH or not connected, cleaning up');
            // Tab is not SSH or not connected - cleanup everything
            if (this.currentSessionID) {
                await this.cleanupSFTPSession(this.currentSessionID);
            }
            if (this.backgroundSessionID) {
                await this.cleanupSFTPSession(this.backgroundSessionID);
                this.backgroundSessionID = null;
                this.backgroundRemotePath = null;
            }
            this.currentSessionID = null;
            this.showSelectSSHMessage();
        }
    }

    async initializeForSSHSession(tab) {
        try {
            this.currentSessionID = tab.sessionId;
            this.showLoadingState();

            // Initialize SFTP session in backend
            await window.go.main.App.InitializeFileExplorerSession(this.currentSessionID);
            
            // Resolve the home directory to get absolute path
            let startPath = '.';
            try {
                // Get the current working directory (absolute path)
                const workingDir = await window.go.main.App.GetRemoteWorkingDirectory(this.currentSessionID);
                if (workingDir && workingDir.trim()) {
                    startPath = workingDir.trim();
                    console.log(`Resolved home directory to: ${startPath}`);
                } else {
                    console.warn('Empty working directory result, using relative path');
                }
            } catch (error) {
                console.warn('Failed to resolve home directory, using relative path:', error);
                // Fallback to relative path if pwd fails
                startPath = '.';
            }
            
            // Set resolved path and load directory
            this.currentRemotePath = startPath;
            await this.loadDirectoryContent(startPath);
            updateStatus(`File Explorer connected to ${tab.title}`);
        } catch (error) {
            console.error('Failed to initialize SFTP session:', error);
            this.showErrorState(`Failed to connect: ${error.message}`);
            showNotification('Failed to initialize file explorer', 'error');
        }
    }

    async cleanupSFTPSession(sessionID) {
        try {
            await window.go.main.App.CloseFileExplorerSession(sessionID);
            console.log(`SFTP session cleaned up for ${sessionID}`);
        } catch (error) {
            console.error('Error cleaning up SFTP session:', error);
        }
    }

    async loadDirectoryContent(remotePath) {
        if (!this.currentSessionID) return;

        try {
            this.showLoadingState();

            // Check cache first
            const cacheKey = `${this.currentSessionID}:${remotePath}`;
            if (this.fileCache.has(cacheKey)) {
                console.log('📦 Using cached content for path:', remotePath);
                const cachedFiles = this.fileCache.get(cacheKey);
                
                // Add parent directory entry if not at absolute root
                const processedFiles = [...cachedFiles];
                if (remotePath !== '/') {
                    const parentPath = this.getParentPath(remotePath);
                    processedFiles.unshift({
                        name: '..',
                        path: parentPath,
                        isDir: true,
                        isParent: true,
                        size: 0,
                        mode: 'drwxr-xr-x',
                        modifiedTime: new Date()
                    });
                }
                
                // Sort files: parent directory first, then directories, then files by name
                processedFiles.sort((a, b) => {
                    if (a.isParent) return -1;
                    if (b.isParent) return 1;
                    if (a.isDir !== b.isDir) {
                        return b.isDir - a.isDir; // Directories first
                    }
                    return a.name.localeCompare(b.name);
                });
                
                // IMPORTANT: Update current path and breadcrumbs even for cached content
                this.currentRemotePath = remotePath;
                this.updateBreadcrumbs(remotePath);
                this.renderFileList(processedFiles);
                return;
            }

            console.log('🌐 Loading fresh content for path:', remotePath);
            const files = await window.go.main.App.ListRemoteFiles(this.currentSessionID, remotePath);
            
            // Add parent directory entry if not at absolute root
            const processedFiles = [...files];
            if (remotePath !== '/') {
                const parentPath = this.getParentPath(remotePath);
                processedFiles.unshift({
                    name: '..',
                    path: parentPath,
                    isDir: true,
                    isParent: true,
                    size: 0,
                    mode: 'drwxr-xr-x',
                    modifiedTime: new Date()
                });
            }
            
            // Sort files: parent directory first, then directories, then files by name
            processedFiles.sort((a, b) => {
                if (a.isParent) return -1;
                if (b.isParent) return 1;
                if (a.isDir !== b.isDir) {
                    return b.isDir - a.isDir; // Directories first
                }
                return a.name.localeCompare(b.name);
            });

            // Cache the results (without parent directory entry for consistency)
            this.fileCache.set(cacheKey, files);
            
            this.currentRemotePath = remotePath;
            this.updateBreadcrumbs(remotePath);
            this.renderFileList(processedFiles);

        } catch (error) {
            console.error('Failed to load directory:', error);
            this.showErrorState(`Failed to load directory: ${error.message}`);
        }
    }

    getParentPath(path) {
        // Handle relative path case (fallback)
        if (!path || path === '.' || path === '') {
            return '/';
        }
        
        if (path === '/') {
            return '/'; // Already at root
        }
        
        // Always work with absolute paths
        if (path.startsWith('/')) {
            const parts = path.split('/').filter(part => part.length > 0);
            if (parts.length <= 1) {
                return '/';
            }
            return '/' + parts.slice(0, -1).join('/');
        }
        
        // Fallback for relative paths (shouldn't happen with new logic)
        const parts = path.split('/').filter(part => part.length > 0);
        if (parts.length <= 1) {
            return '/';
        }
        return parts.slice(0, -1).join('/');
    }

    updateBreadcrumbs(path) {
        console.log('🍞 updateBreadcrumbs called with path:', path);
        
        // Always build breadcrumbs from root for absolute paths
        this.breadcrumbs = [{ name: 'Root', path: '/' }];
        
        if (path && path !== '/' && path !== '.' && path !== '') {
            if (path.startsWith('/')) {
                // Build breadcrumbs from root for absolute paths
                const parts = path.split('/').filter(part => part.length > 0);
                console.log('🍞 Path parts:', parts);
                let currentPath = '';
                
                for (const part of parts) {
                    currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
                    this.breadcrumbs.push({ name: part, path: currentPath });
                    console.log('🍞 Added breadcrumb:', { name: part, path: currentPath });
                }
            } else {
                // Handle relative path case (fallback) - should be rare now
                console.log('🍞 Using relative path fallback for:', path);
                this.breadcrumbs = [{ name: 'Home', path: '.' }];
                const parts = path.split('/').filter(part => part.length > 0);
                let currentPath = '';
                
                for (const part of parts) {
                    currentPath = currentPath ? `${currentPath}/${part}` : part;
                    this.breadcrumbs.push({ name: part, path: currentPath });
                }
            }
        }

        console.log('🍞 Final breadcrumbs:', this.breadcrumbs);
        this.renderBreadcrumbs();
    }

    renderBreadcrumbs() {
        const breadcrumbContainer = document.querySelector('.file-breadcrumbs');
        if (!breadcrumbContainer) return;

        const breadcrumbHTML = this.breadcrumbs.map((crumb, index) => {
            const isLast = index === this.breadcrumbs.length - 1;
            return `
                <span class="breadcrumb-item ${isLast ? 'active' : 'clickable'}" data-path="${crumb.path}">
                    ${crumb.name}
                </span>
                ${!isLast ? '<span class="breadcrumb-separator">></span>' : ''}
            `;
        }).join('');

        breadcrumbContainer.innerHTML = breadcrumbHTML;
    }

    renderFileList(files) {
        const container = this.getFileListContainer();
        if (!container) return;

        if (files.length === 0) {
            container.innerHTML = `
                <div class="empty-directory">
                    <div class="empty-directory-icon">📁</div>
                    <div>This directory is empty</div>
                </div>
            `;
            return;
        }

        const filesHTML = files.map(file => this.createFileItemHTML(file)).join('');
        container.innerHTML = filesHTML;
    }

    createFileItemHTML(file) {
        const icon = this.getFileIcon(file);
        const sizeDisplay = file.isDir ? '' : this.formatFileSize(file.size);
        const modTimeDisplay = file.isParent ? '' : this.formatDateTime(file.modifiedTime);
        const fileName = file.isParent ? '..' : file.name;
        const fileClass = file.isParent ? 'file-item parent-directory' : 'file-item';

        return `
            <div class="${fileClass}" data-name="${fileName}" data-path="${file.path}" data-is-dir="${file.isDir}" data-is-parent="${file.isParent || false}">
                <div class="file-icon">${icon}</div>
                <div class="file-details">
                    <div class="file-name">
                        ${fileName}
                        ${file.isSymlink ? ' → ' + (file.symlinkTarget || '?') : ''}
                    </div>
                    <div class="file-meta">
                        <span class="file-size">${sizeDisplay}</span>
                        <span class="file-modified">${modTimeDisplay}</span>
                        ${!file.isParent ? `<span class="file-mode">${file.mode}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    getFileIcon(file) {
        if (file.isParent) {
            return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: var(--text-secondary);">
                <path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/>
            </svg>`;
        } else if (file.isDir) {
            return '📁';
        } else if (file.isSymlink) {
            return '🔗';
        } else {
            const ext = file.name.split('.').pop().toLowerCase();
            const iconMap = {
                'txt': '📄', 'md': '📄', 'log': '📄', 'readme': '📄',
                'js': '📜', 'ts': '📜', 'py': '📜', 'sh': '📜', 'bash': '📜',
                'html': '🌐', 'htm': '🌐', 'css': '🎨', 'json': '📋', 'xml': '📋',
                'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
                'pdf': '📕', 'doc': '📘', 'docx': '📘', 'xls': '📗', 'xlsx': '📗',
                'zip': '📦', 'tar': '📦', 'gz': '📦', 'rar': '📦', '7z': '📦',
                'exe': '⚙️', 'bin': '⚙️', 'app': '⚙️', 'deb': '⚙️', 'rpm': '⚙️',
                'conf': '🔧', 'config': '🔧', 'cfg': '🔧', 'ini': '🔧',
                'sql': '🗃️', 'db': '🗃️', 'sqlite': '🗃️'
            };
            return iconMap[ext] || '📄';
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    formatDateTime(dateTime) {
        if (!dateTime) return '';
        const date = new Date(dateTime);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    handleFileItemClick(fileItem, event) {
        // Clear previous selections
        document.querySelectorAll('.file-item.selected').forEach(item => {
            item.classList.remove('selected');
        });

        // Select current item
        fileItem.classList.add('selected');

        const fileName = fileItem.dataset.name;
        const isParent = fileItem.dataset.isParent === 'true';
        
        if (isParent) {
            updateStatus('Selected: Parent directory');
        } else {
            updateStatus(`Selected: ${fileName}`);
        }
    }

    handleFileItemDoubleClick(fileItem) {
        const isDir = fileItem.dataset.isDir === 'true';
        const path = fileItem.dataset.path;
        const isParent = fileItem.dataset.isParent === 'true';
        const fileName = fileItem.dataset.name;

        if (isDir) {
            // Navigate to directory (works for both regular directories and parent directory)
            this.navigateToPath(path);
            
            if (isParent) {
                if (path === '/') {
                    updateStatus('Navigated to root directory (/)');
                } else if (path === '.') {
                    updateStatus('Navigated to home directory');
                } else {
                    updateStatus('Navigated to parent directory');
                }
            } else {
                const dirName = fileItem.dataset.name;
                updateStatus(`Entered directory: ${dirName}`);
            }
        } else {
            // For files, show file preview on double-click
            console.log('📄 Double-click on file, showing preview:', fileName);
            this.showFilePreview(path, fileName);
        }
    }

    async navigateToPath(path) {
        if (path !== this.currentRemotePath) {
            // Clear cache when navigating to force refresh
            const cacheKey = `${this.currentSessionID}:${path}`;
            this.fileCache.delete(cacheKey);
            
            const pathDescription = path === '/' ? 'root (/)' : 
                                   path === '.' ? 'home' : 
                                   `"${path}"`;
            console.log(`Navigating from ${this.currentRemotePath} to ${pathDescription}`);
            await this.loadDirectoryContent(path);
        }
    }

    showLoadingState() {
        const container = this.getFileListContainer();
        if (container) {
            container.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner"></div>
                    <div>Loading files...</div>
                </div>
            `;
        }
    }

    showErrorState(message) {
        const container = this.getFileListContainer();
        if (container) {
            container.innerHTML = `
                <div class="error-state">
                    <div class="error-icon">⚠️</div>
                    <div class="error-message">${message}</div>
                    <button class="retry-btn" onclick="window.remoteExplorerManager.retryCurrentOperation()">Retry</button>
                </div>
            `;
        }
    }

    showSelectSSHMessage() {
        const sidebarContent = document.getElementById('sidebar-content');
        if (sidebarContent) {
            sidebarContent.innerHTML = `
                <div class="remote-explorer-placeholder">
                    <div class="placeholder-icon">🔗</div>
                    <div class="placeholder-title">Remote File Explorer</div>
                    <div class="placeholder-message">
                        Select a connected SSH tab to browse remote files
                    </div>
                </div>
            `;
        }
    }

    clearView() {
        const sidebarContent = document.getElementById('sidebar-content');
        if (sidebarContent) {
            sidebarContent.innerHTML = '';
        }
    }

    getFileListContainer() {
        let container = document.querySelector('.remote-files-list');
        if (!container) {
            this.renderFileExplorerUI();
            container = document.querySelector('.remote-files-list');
        }
        return container;
    }

    renderFileExplorerUI() {
        console.log('🎨 renderFileExplorerUI called');
        console.log('🎨 isActivePanel:', this.isActivePanel);
        
        const sidebarContent = document.getElementById('sidebar-content');
        if (!sidebarContent) {
            console.log('🎨 No sidebar content element found');
            return;
        }

        console.log('🎨 Rendering file explorer UI');
        sidebarContent.innerHTML = `
            <div class="remote-explorer-container">
                <div class="file-toolbar">
                    <button class="file-toolbar-btn" data-action="refresh" title="Refresh">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                        </svg>
                    </button>
                    <button class="file-toolbar-btn" id="upload-files-btn" title="Upload Files">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                            <path d="M12,11L16,15H13V19H11V15H8L12,11Z"/>
                        </svg>
                    </button>
                    <button class="file-toolbar-btn" data-action="new-file" title="New File">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z"/>
                            <path d="M11,15H13V12H16V10H13V7H11V10H8V12H11V15Z"/>
                        </svg>
                    </button>
                    <button class="file-toolbar-btn" data-action="new-folder" title="New Folder">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                        </svg>
                    </button>
                </div>
                <div class="file-breadcrumbs">
                    <!-- Breadcrumbs will be rendered here -->
                </div>
                <div class="remote-files-container">
                    <div class="remote-files-list">
                        <!-- File list will be rendered here -->
                    </div>
                </div>
            </div>
        `;
        console.log('🎨 File explorer UI rendered');
        
        // Set up toolbar event listeners after UI is rendered
        this.setupToolbarEventListeners();
    }

    async handleToolbarAction(action) {
        switch (action) {
            case 'refresh':
                if (this.currentSessionID && this.currentRemotePath) {
                    // Clear cache and reload
                    const cacheKey = `${this.currentSessionID}:${this.currentRemotePath}`;
                    this.fileCache.delete(cacheKey);
                    await this.loadDirectoryContent(this.currentRemotePath);
                }
                break;
            case 'upload':
                this.showUploadDialog();
                break;
            case 'new-file':
                this.showNewFileDialog();
                break;
            case 'new-folder':
                this.showNewFolderDialog();
                break;
        }
    }

    showUploadDialog() {
        // TODO: Implement file upload dialog
        showNotification('File upload coming soon', 'info');
    }

    showNewFolderDialog() {
        console.log('📁 Showing new folder dialog');
        
        // Use the existing modal component with custom content for input
        if (window.modal) {
            window.modal.show({
                title: 'Create New Folder',
                message: `Create a new folder in: ${this.currentRemotePath}`,
                icon: '📁',
                content: `
                    <div style="margin-top: 16px;">
                        <label for="new-folder-name" style="display: block; margin-bottom: 6px; color: var(--text-primary); font-size: 13px; font-weight: 500;">
                            Folder Name:
                        </label>
                        <input type="text" id="new-folder-name" placeholder="Enter folder name" 
                               style="width: 100%; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); 
                                      border-radius: 4px; color: var(--text-primary); font-size: 13px; transition: border-color 0.15s ease;"
                               onfocus="this.style.borderColor = 'var(--accent-color)'"
                               onblur="this.style.borderColor = 'var(--border-color)'">
                    </div>
                `,
                buttons: [
                    { text: 'Cancel', style: 'secondary', action: 'cancel' },
                    { 
                        text: 'Create', 
                        style: 'primary', 
                        action: 'confirm',
                        handler: () => {
                            const input = document.getElementById('new-folder-name');
                            const folderName = input?.value?.trim();
                            if (folderName) {
                                this.createNewFolder(folderName);
                            } else {
                                showNotification('Please enter a folder name', 'error');
                                return false; // Prevent modal from closing
                            }
                        }
                    }
                ]
            }).then(result => {
                // Focus the input when modal opens
                setTimeout(() => {
                    const input = document.getElementById('new-folder-name');
                    if (input) {
                        input.focus();
                    }
                }, 100);
            });
        }
    }

    showNewFileDialog() {
        console.log('📄 Showing new file dialog');
        
        // Use the existing modal component with custom content for input
        if (window.modal) {
            window.modal.show({
                title: 'Create New File',
                message: `Create a new file in: ${this.currentRemotePath}`,
                icon: '📄',
                content: `
                    <div style="margin-top: 16px;">
                        <label for="new-file-name" style="display: block; margin-bottom: 6px; color: var(--text-primary); font-size: 13px; font-weight: 500;">
                            File Name:
                        </label>
                        <input type="text" id="new-file-name" placeholder="Enter file name (e.g., script.js, readme.md)" 
                               style="width: 100%; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); 
                                      border-radius: 4px; color: var(--text-primary); font-size: 13px; transition: border-color 0.15s ease;"
                               onfocus="this.style.borderColor = 'var(--accent-color)'"
                               onblur="this.style.borderColor = 'var(--border-color)'">
                    </div>
                `,
                buttons: [
                    { text: 'Cancel', style: 'secondary', action: 'cancel' },
                    { 
                        text: 'Create', 
                        style: 'primary', 
                        action: 'confirm',
                        handler: () => {
                            const input = document.getElementById('new-file-name');
                            const fileName = input?.value?.trim();
                            if (fileName) {
                                this.createNewFile(fileName);
                            } else {
                                showNotification('Please enter a file name', 'error');
                                return false; // Prevent modal from closing
                            }
                        }
                    }
                ]
            }).then(result => {
                // Focus the input when modal opens
                setTimeout(() => {
                    const input = document.getElementById('new-file-name');
                    if (input) {
                        input.focus();
                    }
                }, 100);
            });
        }
    }

    showRenameDialog(filePath, currentName) {
        console.log('📝 Showing rename dialog for:', currentName);
        
        // Use the existing modal component with custom content for input
        if (window.modal) {
            window.modal.show({
                title: 'Rename File/Folder',
                message: `Rename: ${filePath}`,
                icon: '📝',
                content: `
                    <div style="margin-top: 16px;">
                        <label for="new-file-name" style="display: block; margin-bottom: 6px; color: var(--text-primary); font-size: 13px; font-weight: 500;">
                            New Name:
                        </label>
                        <input type="text" id="new-file-name" value="${currentName}" 
                               style="width: 100%; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); 
                                      border-radius: 4px; color: var(--text-primary); font-size: 13px; transition: border-color 0.15s ease;"
                               onfocus="this.style.borderColor = 'var(--accent-color)'"
                               onblur="this.style.borderColor = 'var(--border-color)'">
                    </div>
                `,
                buttons: [
                    { text: 'Cancel', style: 'secondary', action: 'cancel' },
                    { 
                        text: 'Rename', 
                        style: 'primary', 
                        action: 'confirm',
                        handler: () => {
                            const input = document.getElementById('new-file-name');
                            const newName = input?.value?.trim();
                            if (newName) {
                                this.renameFile(filePath, currentName, newName);
                            } else {
                                showNotification('Please enter a new name', 'error');
                                return false; // Prevent modal from closing
                            }
                        }
                    }
                ]
            }).then(result => {
                // Focus and select the input when modal opens
                setTimeout(() => {
                    const input = document.getElementById('new-file-name');
                    if (input) {
                        input.focus();
                        // Select filename without extension
                        const lastDot = currentName.lastIndexOf('.');
                        if (lastDot > 0) {
                            input.setSelectionRange(0, lastDot);
                        } else {
                            input.select();
                        }
                    }
                }, 100);
            });
        }
    }

    showDeleteConfirmation(filePath, fileName, isDir) {
        console.log('🗑️ Showing delete confirmation for:', fileName);
        
        // Use the existing modal system for confirmation
        if (window.modal) {
            const itemType = isDir ? 'folder' : 'file';
            window.modal.show({
                title: `Delete ${itemType}`,
                message: `Are you sure you want to delete "${fileName}"?${isDir ? ' This will delete all contents.' : ''}`,
                icon: '🗑️',
                buttons: [
                    { text: 'Cancel', style: 'secondary', action: 'cancel' },
                    { text: 'Delete', style: 'danger', action: 'confirm' }
                ]
            }).then(result => {
                if (result === 'confirm') {
                    this.deleteFile(filePath, fileName, isDir);
                }
            });
        } else {
            // Fallback confirm dialog
            const confirmed = confirm(`Are you sure you want to delete "${fileName}"?`);
            if (confirmed) {
                this.deleteFile(filePath, fileName, isDir);
            }
        }
    }

    showFileActions(fileItem) {
        // TODO: Implement file actions (download, etc.)
        console.log('File actions for:', fileItem.dataset.name);
    }

    retryCurrentOperation() {
        if (this.currentSessionID && this.currentRemotePath) {
            this.loadDirectoryContent(this.currentRemotePath);
        }
    }

    // Get current active tab (delegated to tabs manager)
    getActiveTab() {
        return this.tabsManager.getActiveTab();
    }

    // Force cleanup method for when truly closing the explorer
    async forceCleanup() {
        console.log('Remote Explorer: Force cleanup');
        
        if (this.currentSessionID) {
            await this.cleanupSFTPSession(this.currentSessionID);
            this.currentSessionID = null;
        }
        
        if (this.backgroundSessionID) {
            await this.cleanupSFTPSession(this.backgroundSessionID);
            this.backgroundSessionID = null;
            this.backgroundRemotePath = null;
        }
        
        this.currentRemotePath = null;
        this.fileCache.clear();
        this.clearView();
    }

    // Utility methods for file operations
    async refreshCurrentDirectory() {
        if (this.currentSessionID && this.currentRemotePath) {
            // Clear cache and reload
            const cacheKey = `${this.currentSessionID}:${this.currentRemotePath}`;
            this.fileCache.delete(cacheKey);
            await this.loadDirectoryContent(this.currentRemotePath);
            updateStatus('Directory refreshed');
        }
    }

    async copyPathToClipboard(path) {
        try {
            await navigator.clipboard.writeText(path);
            showNotification(`Path copied: ${path}`, 'success');
        } catch (error) {
            console.error('Failed to copy path:', error);
            showNotification('Failed to copy path to clipboard', 'error');
        }
    }

    // File operation methods that call backend APIs
    async createNewFolder(folderName) {
        if (!this.currentSessionID || !this.currentRemotePath) {
            showNotification('No active session', 'error');
            return;
        }

        try {
            const newFolderPath = this.currentRemotePath === '/' 
                ? `/${folderName}` 
                : `${this.currentRemotePath}/${folderName}`;
            
            console.log('📁 Creating folder:', newFolderPath);
            await window.go.main.App.CreateRemoteDirectory(this.currentSessionID, newFolderPath);
            
            showNotification(`Folder "${folderName}" created successfully`, 'success');
            
            // Refresh the current directory to show the new folder
            await this.refreshCurrentDirectory();
            
        } catch (error) {
            console.error('Failed to create folder:', error);
            showNotification(`Failed to create folder: ${error.message}`, 'error');
        }
    }

    async createNewFile(fileName) {
        if (!this.currentSessionID || !this.currentRemotePath) {
            showNotification('No active session', 'error');
            return;
        }

        try {
            const newFilePath = this.currentRemotePath === '/' 
                ? `/${fileName}` 
                : `${this.currentRemotePath}/${fileName}`;
            
            console.log('📄 Creating file:', newFilePath);
            
            // Create an empty file by uploading empty content
            await window.go.main.App.UpdateRemoteFileContent(this.currentSessionID, newFilePath, '');
            
            showNotification(`File "${fileName}" created successfully`, 'success');
            
            // Refresh the current directory to show the new file
            await this.refreshCurrentDirectory();
            
            // Auto-open the new file for editing
            setTimeout(() => {
                this.showFilePreview(newFilePath, fileName);
            }, 500); // Small delay to ensure directory refresh completes
            
        } catch (error) {
            console.error('Failed to create file:', error);
            showNotification(`Failed to create file: ${error.message}`, 'error');
        }
    }

    async renameFile(oldPath, oldName, newName) {
        if (!this.currentSessionID) {
            showNotification('No active session', 'error');
            return;
        }

        try {
            // Build new path
            const pathParts = oldPath.split('/');
            pathParts[pathParts.length - 1] = newName;
            const newPath = pathParts.join('/');
            
            console.log('📝 Renaming from:', oldPath, 'to:', newPath);
            await window.go.main.App.RenameRemotePath(this.currentSessionID, oldPath, newPath);
            
            showNotification(`"${oldName}" renamed to "${newName}"`, 'success');
            
            // Refresh the current directory to show the renamed item
            await this.refreshCurrentDirectory();
            
        } catch (error) {
            console.error('Failed to rename file:', error);
            showNotification(`Failed to rename: ${error.message}`, 'error');
        }
    }

    async deleteFile(filePath, fileName, isDir) {
        if (!this.currentSessionID) {
            showNotification('No active session', 'error');
            return;
        }

        try {
            console.log('🗑️ Deleting:', filePath);
            await window.go.main.App.DeleteRemotePath(this.currentSessionID, filePath);
            
            const itemType = isDir ? 'folder' : 'file';
            showNotification(`${itemType} "${fileName}" deleted successfully`, 'success');
            
            // Refresh the current directory to remove the deleted item
            await this.refreshCurrentDirectory();
            
        } catch (error) {
            console.error('Failed to delete file:', error);
            showNotification(`Failed to delete: ${error.message}`, 'error');
        }
    }

    async downloadFile(filePath, fileName, isDir) {
        if (!this.currentSessionID) {
            showNotification('No active session', 'error');
            return;
        }

        try {
            console.log('⬇️ Starting download:', filePath);
            
            // Use Wails runtime to show save dialog
            if (window.go?.main?.App?.SelectSaveLocation) {
                const localPath = await window.go.main.App.SelectSaveLocation(fileName);
                if (!localPath) {
                    return; // User cancelled
                }
                
                showNotification(`Downloading "${fileName}"...`, 'info');
                
                // Call backend download method
                await window.go.main.App.DownloadRemoteFile(this.currentSessionID, filePath, localPath);
                
                const itemType = isDir ? 'folder' : 'file';
                showNotification(`${itemType} "${fileName}" downloaded successfully`, 'success');
                
            } else {
                showNotification('File save dialog not available', 'error');
            }
            
        } catch (error) {
            console.error('Failed to download file:', error);
            showNotification(`Failed to download: ${error.message}`, 'error');
        }
    }

    async uploadToDirectory(targetPath) {
        if (!this.currentSessionID) {
            showNotification('No active session', 'error');
            return;
        }

        try {
            console.log('⬆️ Starting upload to:', targetPath);
            
            // Use Wails runtime to show file selection dialog
            if (window.go?.main?.App?.SelectFilesToUpload) {
                const localPaths = await window.go.main.App.SelectFilesToUpload();
                if (!localPaths || localPaths.length === 0) {
                    return; // User cancelled
                }
                
                showNotification(`Uploading ${localPaths.length} file(s)...`, 'info');
                
                // Call backend upload method
                await window.go.main.App.UploadRemoteFiles(this.currentSessionID, localPaths, targetPath);
                
                showNotification(`${localPaths.length} file(s) uploaded successfully`, 'success');
                
                // Refresh the current directory to show uploaded files
                await this.refreshCurrentDirectory();
                
            } else {
                showNotification('File selection dialog not available', 'error');
            }
            
        } catch (error) {
            console.error('Failed to upload files:', error);
            showNotification(`Failed to upload: ${error.message}`, 'error');
        }
    }

    async uploadFolderToDirectory(targetPath) {
        // This is similar to uploadToDirectory but for folder selection
        // We can implement this when the backend supports folder upload
        showNotification('Folder upload coming soon', 'info');
    }

    // File preview and editing methods
    async showFilePreview(filePath, fileName) {
        console.log('👁️ Showing file preview for:', fileName);
        
        if (!this.currentSessionID) {
            showNotification('No active session', 'error');
            return;
        }

        // Check if a file preview is already open
        const existingPreview = document.getElementById('file-preview-overlay');
        if (existingPreview) {
            console.log('📄 File preview already open, bringing to focus');
            // If the same file is being opened, just focus the existing preview
            if (this.currentEditingFile && this.currentEditingFile.path === filePath) {
                // Focus the Monaco editor if it exists
                if (this.monacoEditor) {
                    this.monacoEditor.focus();
                }
                return;
            } else {
                // Different file - close existing and open new one
                console.log('📄 Different file requested, closing existing preview');
                existingPreview.classList.remove('active');
                setTimeout(() => {
                    if (this.monacoEditor) {
                        this.monacoEditor.dispose();
                        this.monacoEditor = null;
                    }
                    existingPreview.remove();
                    this.currentEditingFile = null;
                    // Now open the new file
                    this.showFilePreview(filePath, fileName);
                }, 300);
                return;
            }
        }

        // Show loading notification while fetching file content
        showNotification(`Loading ${fileName}...`, 'info');
        
        try {
            // Download file content for preview
            const content = await window.go.main.App.GetRemoteFileContent(this.currentSessionID, filePath);
            
            // Show file preview panel
            this.showFilePreviewPanel(filePath, fileName, content);
            
            // Update status to show file is loaded
            updateStatus(`Previewing: ${fileName}`);
            
        } catch (error) {
            console.error('Failed to load file content:', error);
            showNotification(`Failed to load file: ${error.message}`, 'error');
        }
    }

    showFilePreviewPanel(filePath, fileName, content, forceTextMode = false) {
        // Create a larger panel overlay similar to profile panel but bigger
        const overlay = document.createElement('div');
        overlay.id = 'file-preview-overlay';
        overlay.className = 'file-preview-overlay'; // Use consistent class name for animation
        
        const fileExtension = fileName.split('.').pop().toLowerCase();
        const isTextFile = forceTextMode || this.isTextFile(fileExtension);
        const isImageFile = !forceTextMode && this.isImageFile(fileExtension);
        
        // For files without extensions or common config files, suggest they might be text
        const mightBeText = !isTextFile && !isImageFile && (
            !fileExtension || 
            fileName.includes('rc') || 
            fileName.includes('config') ||
            fileName.startsWith('.') ||
            ['dockerfile', 'makefile', 'license', 'readme', 'changelog', 'authors', 'contributing'].includes(fileName.toLowerCase())
        );
        
        overlay.innerHTML = `
            <div class="profile-panel file-preview-panel">
                <div class="profile-panel-header">
                    <div class="profile-panel-title">
                        <span class="profile-panel-title-icon">${isImageFile ? '🖼️' : isTextFile || forceTextMode ? '📄' : '📦'}</span>
                        ${fileName}${forceTextMode ? ' (Text Mode)' : ''}
                    </div>
                    <div class="file-preview-header-actions">
                        <button class="profile-panel-action-btn" id="file-preview-fullscreen" title="Toggle Fullscreen">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M7,14H5v5h5v-2H7V14z M5,10h2V7h3V5H5V10z M17,17h-3v2h5v-5h-2V17z M14,5v2h3v3h2V5H14z"/>
                            </svg>
                        </button>
                        <button class="profile-panel-close" id="file-preview-close">×</button>
                    </div>
                </div>
                <div class="profile-panel-content file-preview-content">
                    ${isTextFile ? this.createTextEditor(content, fileExtension) : 
                      isImageFile ? this.createImageViewer(content) : 
                      this.createBinaryViewer(fileName)}
                </div>
                <div class="profile-panel-footer">
                    ${isTextFile ? `
                        <button class="btn btn-secondary" id="file-preview-cancel">Cancel</button>
                        <button class="btn btn-secondary" id="file-download-btn">Download</button>
                        <button class="btn btn-primary" id="file-save-btn">Save Changes</button>
                    ` : `
                        <button class="btn btn-secondary" id="file-preview-close-btn">Close</button>
                        <button class="btn btn-primary" id="file-download-btn">Download</button>
                    `}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Store file info for saving
        this.currentEditingFile = {
            path: filePath,
            name: fileName,
            content: content,
            isText: isTextFile,
            forceTextMode: forceTextMode
        };

        // Setup event handlers
        this.setupFilePreviewHandlers(overlay, isTextFile);

        // Show the panel with animation (same as profile panel)
        // Add a small delay to ensure DOM is ready for animation
        setTimeout(() => {
            overlay.classList.add('active');
        }, 10);

        // Initialize editor if it's a text file
        if (isTextFile) {
            // Delay editor initialization until after animation starts
            setTimeout(() => {
                this.initializeMonacoEditor(content, fileExtension);
            }, 100);
        }

        // Setup image viewer controls
        if (isImageFile) {
            this.setupImageViewerControls();
        }

        // Setup "Open as Text" button for binary files
        if (!isTextFile && !isImageFile) {
            const openAsTextBtn = overlay.querySelector('#open-as-text-btn');
            if (openAsTextBtn) {
                openAsTextBtn.addEventListener('click', () => {
                    // Close current modal and reopen as text
                    overlay.classList.remove('active');
                    setTimeout(() => {
                        overlay.remove();
                        this.showFilePreviewPanel(filePath, fileName, content, true);
                    }, 300);
                });
            }
        }
    }

    createTextEditor(content, fileExtension) {
        return `
            <div class="file-editor-container">
                <div class="file-editor-toolbar">
                    <span class="file-editor-info">
                        <span class="file-type-badge">${fileExtension.toUpperCase()}</span>
                        <span class="file-encoding">UTF-8</span>
                    </span>
                    <span class="file-editor-actions">
                        <button class="editor-btn" id="wrap-text-btn" title="Toggle word wrap">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M4,6H20V8H4V6M4,18V16H20V18H4M4,11H15V13H4V11Z"/>
                            </svg>
                        </button>
                        <button class="editor-btn" id="find-replace-btn" title="Find & Replace">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15.5,12C18,12 20,14 20,16.5C20,17.38 19.75,18.21 19.31,18.9L22.39,22L21,23.39L17.88,20.32C17.19,20.75 16.37,21 15.5,21C13,21 11,19 11,16.5C11,14 13,12 15.5,12M15.5,14A2.5,2.5 0 0,0 13,16.5A2.5,2.5 0 0,0 15.5,19A2.5,2.5 0 0,0 18,16.5A2.5,2.5 0 0,0 15.5,14M6.5,2C7.33,2 8,2.67 8,3.5C8,4.33 7.33,5 6.5,5C5.67,5 5,4.33 5,3.5C5,2.67 5.67,2 6.5,2M6.5,6C7.33,6 8,6.67 8,7.5C8,8.33 7.33,9 6.5,9C5.67,9 5,8.33 5,7.5C5,6.67 5.67,6 6.5,6M6.5,10C7.33,10 8,10.67 8,11.5C8,12.33 7.33,13 6.5,13C5.67,13 5,12.33 5,11.5C5,10.67 5.67,10 6.5,10Z"/>
                            </svg>
                        </button>
                    </span>
                </div>
                <div id="monaco-editor" class="monaco-editor-container"></div>
            </div>
        `;
    }

    createImageViewer(content) {
        return `
            <div class="file-image-viewer">
                <div class="image-viewer-toolbar">
                    <span class="image-info">Image Preview</span>
                    <div class="image-controls">
                        <button class="editor-btn" id="zoom-fit-btn" title="Fit to window">📐</button>
                        <button class="editor-btn" id="zoom-actual-btn" title="Actual size">🔍</button>
                        <button class="editor-btn" id="zoom-in-btn" title="Zoom in">➕</button>
                        <button class="editor-btn" id="zoom-out-btn" title="Zoom out">➖</button>
                    </div>
                </div>
                <div class="image-container">
                    <img src="data:image/*;base64,${content}" alt="Preview" class="preview-image" />
                </div>
            </div>
        `;
    }

    createBinaryViewer(fileName) {
        const mightBeText = this.mightBeTextFile(fileName);
        
        return `
            <div class="file-binary-viewer">
                <div class="binary-info">
                    <div class="binary-icon">${mightBeText ? '📄' : '📦'}</div>
                    <h3>${mightBeText ? 'Unknown Text File' : 'Binary File'}</h3>
                    <p>Cannot preview "${fileName}"</p>
                    <p>${mightBeText 
                        ? 'This file might be a text file without a recognized extension.' 
                        : 'This appears to be a binary file that cannot be displayed.'
                    }</p>
                    <div class="binary-actions">
                        <button class="btn btn-secondary" id="open-as-text-btn">
                            📝 Open as Text
                        </button>
                        <p class="binary-hint">
                            ${mightBeText 
                                ? 'Try opening as text - common for config files like .bashrc, .vimrc, etc.'
                                : 'Force open this file as text (useful for config files, scripts without extensions, etc.)'
                            }
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    isTextFile(extension) {
        const textExtensions = [
            'txt', 'md', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'js', 'ts', 
            'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 
            'rs', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'r', 'swift', 
            'kt', 'scala', 'clj', 'hs', 'elm', 'erl', 'ex', 'exs', 'lua', 'pl', 'pm', 
            'tcl', 'vim', 'conf', 'config', 'cfg', 'ini', 'toml', 'properties', 'env',
            'log', 'csv', 'tsv', 'dockerfile', 'makefile', 'gradle', 'pom', 'sbt',
            // Additional common text file extensions
            'rc', 'profile', 'aliases', 'exports', 'functions', 'path', 'extra',
            'gitignore', 'gitattributes', 'gitmodules', 'editorconfig', 'eslintrc',
            'prettierrc', 'babelrc', 'npmrc', 'yarnrc', 'nvmrc', 'rvmrc', 'rbenv-version',
            'gemfile', 'rakefile', 'procfile', 'cmakelists', 'cmakecache',
            'requirements', 'pipfile', 'setup', 'manifest', 'license', 'readme',
            'changelog', 'authors', 'contributors', 'copying', 'install', 'news',
            'todo', 'bugs', 'thanks', 'acknowledgments', 'credits'
        ];
        return textExtensions.includes(extension.toLowerCase());
    }

    isImageFile(extension) {
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'];
        return imageExtensions.includes(extension.toLowerCase());
    }

    async initializeMonacoEditor(content, fileExtension) {
        // Load Monaco Editor dynamically
        if (!window.monaco) {
            await this.loadMonacoEditor();
        }

        const editorContainer = document.getElementById('monaco-editor');
        if (!editorContainer) return;

        // Determine language from file extension
        const language = this.getMonacoLanguage(fileExtension);

        // Create editor
        this.monacoEditor = window.monaco.editor.create(editorContainer, {
            value: content,
            language: language,
            theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs-light',
            fontSize: 14,
            lineNumbers: 'on',
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'off',
            tabSize: 2,
            insertSpaces: true
        });

        // Mark as modified when content changes
        this.monacoEditor.onDidChangeModelContent(() => {
            this.currentEditingFile.modified = true;
            const saveBtn = document.getElementById('file-save-btn');
            if (saveBtn) {
                saveBtn.textContent = 'Save Changes*';
                saveBtn.classList.add('modified');
            }
        });
    }

    async loadMonacoEditor() {
        return new Promise((resolve, reject) => {
            // Load Monaco Editor from CDN
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js';
            script.onload = () => {
                window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
                window.require(['vs/editor/editor.main'], () => {
                    resolve();
                });
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    getMonacoLanguage(extension) {
        const languageMap = {
            'js': 'javascript',
            'ts': 'typescript',
            'jsx': 'javascript',
            'tsx': 'typescript',
            'json': 'json',
            'html': 'html',
            'htm': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'py': 'python',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'h': 'c',
            'hpp': 'cpp',
            'cs': 'csharp',
            'php': 'php',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'sh': 'shell',
            'bash': 'shell',
            'zsh': 'shell',
            'fish': 'shell',
            'ps1': 'powershell',
            'sql': 'sql',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
            'md': 'markdown',
            'swift': 'swift',
            'kt': 'kotlin',
            'scala': 'scala',
            'dockerfile': 'dockerfile',
            'toml': 'toml',
            'ini': 'ini',
            'conf': 'ini',
            'config': 'ini'
        };
        return languageMap[extension.toLowerCase()] || 'plaintext';
    }

    setupFilePreviewHandlers(overlay, isTextFile) {
        const closeBtn = overlay.querySelector('#file-preview-close, #file-preview-close-btn');
        const cancelBtn = overlay.querySelector('#file-preview-cancel');
        const downloadBtn = overlay.querySelector('#file-download-btn');
        const saveBtn = overlay.querySelector('#file-save-btn');
        const fullscreenBtn = overlay.querySelector('#file-preview-fullscreen');

        const closeModal = () => {
            // Start close animation
            overlay.classList.remove('active');
            
            // Remove from DOM after animation completes
            setTimeout(() => {
                if (this.monacoEditor) {
                    this.monacoEditor.dispose();
                    this.monacoEditor = null;
                }
                overlay.remove();
                this.currentEditingFile = null;
                
                // Remove the keyboard event listener when modal is closed
                document.removeEventListener('keydown', handleModalKeyboard);
            }, 300); // Match the CSS transition duration
        };

        const toggleFullscreen = () => {
            const panel = overlay.querySelector('.profile-panel');
            const isFullscreen = overlay.classList.contains('fullscreen');
            
            if (isFullscreen) {
                // Exit fullscreen
                overlay.classList.remove('fullscreen');
                fullscreenBtn.title = 'Toggle Fullscreen';
                fullscreenBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7,14H5v5h5v-2H7V14z M5,10h2V7h3V5H5V10z M17,17h-3v2h5v-5h-2V17z M14,5v2h3v3h2V5H14z"/>
                    </svg>
                `;
            } else {
                // Enter fullscreen
                overlay.classList.add('fullscreen');
                fullscreenBtn.title = 'Exit Fullscreen';
                fullscreenBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5,16h3v3h2v-5H5V16z M8,8H5v2h5V5H8V8z M14,19h2v-3h3v-2h-5V19z M16,8V5h-2v5h5V8H16z"/>
                    </svg>
                `;
            }
            
            // Trigger Monaco editor resize if it exists
            if (this.monacoEditor) {
                setTimeout(() => {
                    this.monacoEditor.layout();
                }, 350); // After animation completes
            }
        };

        // Keyboard shortcuts specific to the preview modal
        const handleModalKeyboard = (e) => {
            // Only handle if this specific modal is active
            if (!overlay.classList.contains('active')) return;

            // Escape - Close modal
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
                return;
            }

            // F11 - Toggle fullscreen
            if (e.key === 'F11') {
                e.preventDefault();
                e.stopPropagation();
                toggleFullscreen();
                return;
            }

            // Ctrl+S or Cmd+S - Save file (for text files)
            if ((e.ctrlKey || e.metaKey) && e.key === 's' && isTextFile) {
                e.preventDefault();
                e.stopPropagation();
                this.saveFileChanges();
                return;
            }

            // Ctrl+D or Cmd+D - Download file
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                e.stopPropagation();
                this.downloadFile(this.currentEditingFile.path, this.currentEditingFile.name, false);
                return;
            }

            // F3 - Close preview (same as opening it)
            if (e.key === 'F3') {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
                return;
            }
        };

        // Add the keyboard event listener
        document.addEventListener('keydown', handleModalKeyboard);

        closeBtn?.addEventListener('click', closeModal);
        cancelBtn?.addEventListener('click', closeModal);
        fullscreenBtn?.addEventListener('click', toggleFullscreen);

        // Download button
        downloadBtn?.addEventListener('click', async () => {
            await this.downloadFile(this.currentEditingFile.path, this.currentEditingFile.name, false);
        });

        // Save button (for text files)
        saveBtn?.addEventListener('click', async () => {
            await this.saveFileChanges();
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });

        // Setup editor toolbar buttons
        if (isTextFile) {
            this.setupEditorToolbarButtons();
        }

        // Setup image viewer controls
        if (!isTextFile && this.isImageFile(this.currentEditingFile.name.split('.').pop().toLowerCase())) {
            this.setupImageViewerControls();
        }
    }

    setupEditorToolbarButtons() {
        // Word wrap toggle
        const wrapBtn = document.getElementById('wrap-text-btn');
        wrapBtn?.addEventListener('click', () => {
            if (this.monacoEditor) {
                const currentWrap = this.monacoEditor.getOption(window.monaco.editor.EditorOption.wordWrap);
                this.monacoEditor.updateOptions({ 
                    wordWrap: currentWrap === 'off' ? 'on' : 'off' 
                });
                wrapBtn.classList.toggle('active');
            }
        });

        // Find & Replace
        const findBtn = document.getElementById('find-replace-btn');
        findBtn?.addEventListener('click', () => {
            if (this.monacoEditor) {
                this.monacoEditor.trigger('keyboard', 'actions.find');
            }
        });
    }

    async saveFileChanges() {
        if (!this.monacoEditor || !this.currentEditingFile) {
            showNotification('No file to save', 'error');
            return;
        }

        try {
            const newContent = this.monacoEditor.getValue();
            
            // Upload the modified content back to the remote server
            await window.go.main.App.UpdateRemoteFileContent(
                this.currentSessionID, 
                this.currentEditingFile.path, 
                newContent
            );
            
            showNotification(`File "${this.currentEditingFile.name}" saved successfully`, 'success');
            
            // Reset modified state
            this.currentEditingFile.modified = false;
            const saveBtn = document.getElementById('file-save-btn');
            if (saveBtn) {
                saveBtn.textContent = 'Save Changes';
                saveBtn.classList.remove('modified');
            }
            
        } catch (error) {
            console.error('Failed to save file:', error);
            showNotification(`Failed to save file: ${error.message}`, 'error');
        }
    }

    showDirectoryProperties(dirPath, dirName) {
        console.log('📋 Showing directory properties for:', dirName);
        
        if (!this.currentSessionID) {
            showNotification('No active session', 'error');
            return;
        }

        // Use the existing modal component for directory properties
        if (window.modal) {
            window.modal.show({
                title: 'Directory Properties',
                message: `Properties for: ${dirName}`,
                icon: '📁',
                content: `
                    <div style="margin-top: 16px;">
                        <div class="property-row">
                            <label class="property-label">Path:</label>
                            <span class="property-value">${dirPath}</span>
                        </div>
                        <div class="property-row">
                            <label class="property-label">Type:</label>
                            <span class="property-value">Directory</span>
                        </div>
                        <div class="property-row">
                            <label class="property-label">Remote Server:</label>
                            <span class="property-value">SSH Connection (Session: ${this.currentSessionID})</span>
                        </div>
                        <div class="property-actions" style="margin-top: 20px; display: flex; gap: 8px;">
                            <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${dirPath}'); showNotification('Path copied to clipboard', 'success');">
                                Copy Path
                            </button>
                            <button class="btn btn-secondary" onclick="window.remoteExplorerManager.refreshCurrentDirectory(); window.modal.hide();">
                                Refresh Directory
                            </button>
                        </div>
                    </div>
                    <style>
                        .property-row {
                            display: flex;
                            margin-bottom: 12px;
                            align-items: center;
                        }
                        .property-label {
                            font-weight: 600;
                            color: var(--text-primary);
                            min-width: 120px;
                            font-size: 13px;
                        }
                        .property-value {
                            color: var(--text-secondary);
                            font-family: monospace;
                            font-size: 12px;
                            background: var(--bg-secondary);
                            padding: 4px 8px;
                            border-radius: 4px;
                            border: 1px solid var(--border-color);
                            flex: 1;
                        }
                        .property-actions .btn {
                            font-size: 12px;
                            padding: 6px 12px;
                        }
                    </style>
                `,
                buttons: [
                    { text: 'Close', style: 'secondary', action: 'cancel' }
                ]
            });
        } else {
            // Fallback if modal is not available
            showNotification(`Directory: ${dirPath}`, 'info');
        }
    }

    setupImageViewerControls() {
        const zoomFitBtn = document.getElementById('zoom-fit-btn');
        const zoomActualBtn = document.getElementById('zoom-actual-btn');
        const zoomInBtn = document.getElementById('zoom-in-btn');
        const zoomOutBtn = document.getElementById('zoom-out-btn');
        const previewImage = document.querySelector('.preview-image');

        if (!previewImage) return;

        let currentZoom = 1;
        const minZoom = 0.1;
        const maxZoom = 5;
        const zoomStep = 0.2;

        const updateImageZoom = (zoom) => {
            currentZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
            previewImage.style.transform = `scale(${currentZoom})`;
            previewImage.style.transformOrigin = 'center center';
            
            // Update button states
            zoomInBtn.disabled = currentZoom >= maxZoom;
            zoomOutBtn.disabled = currentZoom <= minZoom;
        };

        const fitToWindow = () => {
            const container = previewImage.parentElement;
            const containerRect = container.getBoundingClientRect();
            const imageRect = previewImage.getBoundingClientRect();
            
            // Reset scale to get natural dimensions
            previewImage.style.transform = 'scale(1)';
            const naturalRect = previewImage.getBoundingClientRect();
            
            // Calculate scale to fit
            const scaleX = (containerRect.width - 40) / naturalRect.width; // 40px padding
            const scaleY = (containerRect.height - 40) / naturalRect.height;
            const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
            
            updateImageZoom(scale);
        };

        // Button event listeners
        zoomFitBtn?.addEventListener('click', fitToWindow);
        
        zoomActualBtn?.addEventListener('click', () => {
            updateImageZoom(1);
        });
        
        zoomInBtn?.addEventListener('click', () => {
            updateImageZoom(currentZoom + zoomStep);
        });
        
        zoomOutBtn?.addEventListener('click', () => {
            updateImageZoom(currentZoom - zoomStep);
        });

        // Mouse wheel zoom
        previewImage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
            updateImageZoom(currentZoom + delta);
        });

        // Initial fit to window
        setTimeout(fitToWindow, 100); // Delay to ensure image is loaded
    }

    // Helper method to detect files that might be text based on filename patterns
    mightBeTextFile(fileName) {
        const lowercaseName = fileName.toLowerCase();
        
        // Files that commonly don't have extensions but are text
        const commonTextFiles = [
            'dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile', 'vagrantfile',
            'license', 'readme', 'changelog', 'authors', 'contributors', 'copying',
            'install', 'news', 'todo', 'bugs', 'thanks', 'acknowledgments', 'credits'
        ];
        
        // Check exact matches
        if (commonTextFiles.includes(lowercaseName)) {
            return true;
        }
        
        // Files starting with dots (hidden config files)
        if (fileName.startsWith('.') && !fileName.includes('.')) {
            return true;
        }
        
        // Files containing common config patterns
        const configPatterns = [
            'rc', 'config', 'conf', 'profile', 'aliases', 'exports', 'functions',
            'bashrc', 'zshrc', 'vimrc', 'tmux.conf', 'ssh_config', 'hosts'
        ];
        
        return configPatterns.some(pattern => lowercaseName.includes(pattern));
    }
} 