// Remote File Explorer module for SFTP file browsing
import { updateStatus, showNotification } from "./utils.js";
import { OnFileDrop } from "../../wailsjs/runtime/runtime";
import { modal } from "../components/Modal.js";
import { LiveSearch } from "../components/LiveSearch.js";

export class RemoteExplorerManager {
    constructor(tabsManager) {
        this.tabsManager = tabsManager;
        this.isActivePanel = false;
        this.currentSessionID = null;
        this.currentRemotePath = null;
        this.currentFileList = [];
        this.loadingIndicator = null;
        this.breadcrumbs = [];
        this.fileCache = new Map(); // Cache directory listings for performance
        this.backgroundSessionID = null; // Track session in background
        this.backgroundRemotePath = null; // Track path in background
        this.maxHistoryItems = 50; // Maximum files to keep in history
        this.isInitialized = false;
        this.retryHandler = null;

        // Live search properties
        this.liveSearch = null;

        // Monaco Editor theme observer
        this.themeObserver = null;

        // Bind methods to preserve 'this' context
        this.handleActiveTabChanged = this.handleActiveTabChanged.bind(this);

        // Multi-select state
        this.lastSelectedIndex = null;

        // Batch transfer progress tracking
        this.batchProgress = {
            active: false,
            isDownload: false,
            totalFiles: 0,
            completedFiles: 0,
            fileProgress: new Map(), // Map<fileIndex, {percent, bytesPerSec}>
            startTime: null,
            cancelled: false,
        };
    }

    init() {
        if (this.isInitialized) return;

        console.log("Initializing Remote Explorer Manager...");
        this.setupEventListeners();

        // Note: SFTP events (sftp-reconnected, sftp-upload-progress, sftp-download-progress)
        // are handled by global listeners in terminal.js and forwarded to this manager

        // Register OS-level file drop (drag & drop) support
        try {
            if (!this.fileDropRegistered && typeof OnFileDrop === "function") {
                OnFileDrop(async (x, y, paths) => {
                    // Only handle when file panel is active and path is set
                    if (
                        !this.isActivePanel ||
                        !this.currentSessionID ||
                        !this.currentRemotePath
                    )
                        return;
                    if (!paths || paths.length === 0) return;

                    // Ensure drop point is inside our file list area
                    const container = document.querySelector(
                        ".remote-files-container",
                    );
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        const within =
                            x >= rect.left &&
                            x <= rect.right &&
                            y >= rect.top &&
                            y <= rect.bottom;
                        if (!within) return;
                    }

                    try {
                        this.showUploadProgress({
                            fileIndex: 0,
                            totalFiles: paths.length,
                            percent: 0,
                            fileName: "",
                        });
                        
                        try {
                            await window.go.main.App.UploadRemoteFiles(
                                this.currentSessionID,
                                paths,
                                this.currentRemotePath,
                            );
                        } catch (uploadErr) {
                            const errorMsg = uploadErr.message || uploadErr.toString();
                            const isPermissionError = this.isPermissionError(errorMsg);

                            if (isPermissionError) {
                                this.hideUploadProgress();
                                const useSudo = await this.confirmSudoOperation("upload files", `${paths.length} file(s)`);
                                if (useSudo) {
                                    this.showUploadProgress({
                                        fileIndex: 0,
                                        totalFiles: paths.length,
                                        percent: 0,
                                        fileName: "",
                                    });
                                    await window.go.main.App.UploadRemoteFilesWithSudo(
                                        this.currentSessionID,
                                        paths,
                                        this.currentRemotePath,
                                    );
                                } else {
                                    throw new Error("Upload cancelled - requires elevated permissions");
                                }
                            } else {
                                throw uploadErr;
                            }
                        }
                        
                        this.hideUploadProgress();
                        showNotification(
                            `${paths.length} file(s) uploaded successfully`,
                            "success",
                        );
                        await this.refreshCurrentDirectory();
                    } catch (err) {
                        console.error("DnD upload failed:", err);
                        this.hideUploadProgress();
                        showNotification(
                            `Failed to upload: ${err.message}`,
                            "error",
                        );
                    }
                }, true); // rely on Wails drop-target detection
                this.fileDropRegistered = true;

                // Ensure we unregister file-drop listeners when the app unloads
                if (
                    typeof OnFileDropOff === "function" &&
                    !this.fileDropOffHooked
                ) {
                    window.addEventListener("beforeunload", () => {
                        try {
                            OnFileDropOff();
                        } catch (_) {}
                    });
                    this.fileDropOffHooked = true;
                }
            }
        } catch (e) {
            console.warn("Failed to set up OnFileDrop:", e);
        }
        this.isInitialized = true;

        // Make globally accessible for onclick handlers
        window.remoteExplorerManager = this;

        console.log("Remote Explorer Manager initialized");
    }

    setupEventListeners() {
        // Listen for active tab changes from the tabs manager
        document.addEventListener("active-tab-changed", (e) => {
            console.log("Active tab changed event received");
            console.log("isActivePanel:", this.isActivePanel);
            console.log("Event detail:", e.detail);

            if (this.isActivePanel) {
                console.log("Processing tab change (panel is active)");
                this.handleActiveTabChanged(e.detail);
            } else {
                console.log("Ignoring tab change (panel is not active)");
            }
        });

        // Note: tab-status-update and sftp-reconnected events are handled by global listeners
        // in terminal.js and forwarded to this manager's handleTabStatusUpdate() and handleSftpReconnected()

        // Listen for file interaction events
        document.addEventListener("click", (e) => {
            if (!this.isActivePanel) return;

            // Handle breadcrumb navigation
            if (e.target.closest(".breadcrumb-item")) {
                const breadcrumb = e.target.closest(".breadcrumb-item");
                const path = breadcrumb.dataset.path;
                this.navigateToPath(path);
                return;
            }

            // Handle file/directory clicks
            if (e.target.closest(".file-item")) {
                const fileItem = e.target.closest(".file-item");
                this.handleFileItemClick(fileItem, e);
                return;
            }

            // Handle toolbar buttons
            if (e.target.closest(".file-toolbar-btn")) {
                const btn = e.target.closest(".file-toolbar-btn");
                this.handleToolbarAction(btn.dataset.action);
                return;
            }
        });

        // Listen for double clicks on file items
        document.addEventListener("dblclick", (e) => {
            if (!this.isActivePanel) return;

            if (e.target.closest(".file-item")) {
                const fileItem = e.target.closest(".file-item");
                this.handleFileItemDoubleClick(fileItem);
            }
        });

        // Listen for context menu events
        document.addEventListener("contextmenu", (e) => {
            if (!this.isActivePanel) return;

            // Check if we're in the remote explorer container
            const remoteExplorerContainer = e.target.closest(
                ".remote-explorer-container",
            );
            if (!remoteExplorerContainer) return;

            // Prevent default for all context menus in remote explorer area
            e.preventDefault();
            e.stopPropagation();

            // If no session or showing placeholder, don't show any context menu
            if (
                !this.currentSessionID ||
                e.target.closest(".remote-explorer-placeholder")
            ) {
                return;
            }

            if (e.target.closest(".file-item")) {
                const fileItem = e.target.closest(".file-item");

                // Preserve multi-selection: if the item is already selected, keep current set.
                // Otherwise, single-select this item for the context menu actions.
                if (!fileItem.classList.contains("selected")) {
                    const all = Array.from(
                        document.querySelectorAll(".file-item"),
                    );
                    all.forEach((it) => it.classList.remove("selected"));
                    if (fileItem.dataset.isParent !== "true") {
                        fileItem.classList.add("selected");
                    }
                    this.lastSelectedIndex = all.indexOf(fileItem);
                }

                // Extract file data from the DOM element and convert to new format
                const isDir = fileItem.dataset.isDir === "true";
                const fileData = {
                    name: fileItem.dataset.name,
                    path: fileItem.dataset.path,
                    type: isDir ? "directory" : "file",
                    isDir: isDir, // Keep for backward compatibility
                    isParent: fileItem.dataset.isParent === "true",
                };

                // Use the existing context menu system
                if (window.contextMenuManager) {
                    window.contextMenuManager.showFileExplorerItemContextMenu(
                        e,
                        fileItem,
                        fileData,
                    );
                }
            } else if (e.target.closest(".remote-files-container")) {
                // Use the existing context menu system for directory context menu
                if (window.contextMenuManager) {
                    window.contextMenuManager.showFileExplorerDirectoryContextMenu(
                        e,
                    );
                }
            }
            // If neither file item nor files container, don't show any context menu
        });

        // Listen for keyboard shortcuts
        document.addEventListener("keydown", (e) => {
            if (!this.isActivePanel) return;

            // F3 - Preview selected file
            if (e.key === "F3") {
                // Check if a file preview is currently open
                const filePreviewOpen = document.getElementById(
                    "file-preview-overlay",
                );
                if (
                    filePreviewOpen &&
                    filePreviewOpen.classList.contains("active")
                ) {
                    console.log(
                        "F3 pressed with file preview open - this will be handled by preview modal",
                    );
                    return; // Let the file preview modal handle F3 (close)
                }

                e.preventDefault();
                const selectedFile = document.querySelector(
                    ".file-item.selected",
                );
                if (selectedFile && selectedFile.dataset.isDir !== "true") {
                    this.showFilePreview(
                        selectedFile.dataset.path,
                        selectedFile.dataset.name,
                    );
                }
                return;
            }

            // Enter - Open/navigate to selected item
            if (e.key === "Enter") {
                // Check if a file preview is currently open - if so, don't handle Enter
                const filePreviewOpen = document.getElementById(
                    "file-preview-overlay",
                );
                if (
                    filePreviewOpen &&
                    filePreviewOpen.classList.contains("active")
                ) {
                    console.log(
                        "File preview is active, ignoring Enter key",
                    );
                    return; // Let the editor handle Enter key
                }

                e.preventDefault();
                const selectedFile = document.querySelector(
                    ".file-item.selected",
                );
                if (selectedFile) {
                    this.handleFileItemDoubleClick(selectedFile);
                }
                return;
            }

            // Delete - Delete selected item(s) (with confirmation)
            if (e.key === "Delete") {
                // Check if a file preview is currently open - if so, don't handle Delete
                const filePreviewOpen = document.getElementById(
                    "file-preview-overlay",
                );
                if (
                    filePreviewOpen &&
                    filePreviewOpen.classList.contains("active")
                ) {
                    console.log(
                        "File preview is active, ignoring Delete key",
                    );
                    return; // Let the editor handle Delete key
                }

                e.preventDefault();
                const selected = Array.from(
                    document.querySelectorAll(".file-item.selected"),
                ).filter((el) => el.dataset.isParent !== "true");
                if (selected.length === 0) return;

                if (selected.length === 1) {
                    const el = selected[0];
                    this.showDeleteConfirmation(
                        el.dataset.path,
                        el.dataset.name,
                        el.dataset.isDir === "true",
                    );
                } else {
                    const count = selected.length;
                    const confirmMsg = `Delete ${count} selected items?`;
                    if (window.modal) {
                        window.modal
                            .show({
                                title: "Delete items",
                                message: confirmMsg,
                                icon: '<img src="./icons/trash.svg" class="svg-icon" alt="">',
                                buttons: [
                                    {
                                        text: "Cancel",
                                        style: "secondary",
                                        action: "cancel",
                                    },
                                    {
                                        text: "Delete",
                                        style: "danger",
                                        action: "confirm",
                                    },
                                ],
                            })
                            .then(async (result) => {
                                if (result === "confirm") {
                                    await this.deleteMultiple(selected);
                                }
                            });
                    } else if (confirm(confirmMsg)) {
                        this.deleteMultiple(selected);
                    }
                }
                return;
            }

            // F2 - Rename selected item
            if (e.key === "F2") {
                // Check if a file preview is currently open - if so, don't handle F2
                const filePreviewOpen = document.getElementById(
                    "file-preview-overlay",
                );
                if (
                    filePreviewOpen &&
                    filePreviewOpen.classList.contains("active")
                ) {
                    console.log("File preview is active, ignoring F2 key");
                    return; // Let the editor handle F2 key
                }

                e.preventDefault();
                const selectedFile = document.querySelector(
                    ".file-item.selected",
                );
                if (selectedFile && selectedFile.dataset.isParent !== "true") {
                    this.showRenameDialog(
                        selectedFile.dataset.path,
                        selectedFile.dataset.name,
                    );
                }
                return;
            }

            // F5 - Refresh directory
            if (e.key === "F5") {
                // Check if a file preview is currently open - if so, don't handle F5
                const filePreviewOpen = document.getElementById(
                    "file-preview-overlay",
                );
                if (
                    filePreviewOpen &&
                    filePreviewOpen.classList.contains("active")
                ) {
                    console.log("File preview is active, ignoring F5 key");
                    return; // Let the editor handle F5 key (if needed)
                }

                e.preventDefault();
                this.refreshCurrentDirectory();
                return;
            }

            // Escape - Clear search if active
            if (e.key === "Escape") {
                if (this.liveSearch && this.liveSearch.isActive()) {
                    e.preventDefault();
                    this.liveSearch.clearSearch();
                }
                return;
            }

            // Live search is handled by the LiveSearch component automatically
        });

        // Set up toolbar event listeners when the UI is rendered
        this.setupToolbarEventListeners();
    }

    async setupToolbarEventListeners() {
        // This will be called after the UI is rendered
        // Add event listener for upload button
        const uploadBtn = document.getElementById("upload-files-btn");
        if (uploadBtn) {
            uploadBtn.removeEventListener("click", this.handleUploadClick); // Remove any existing listener
            this.handleUploadClick = async () => {
                // Use the same upload mechanism as "Upload Files Here" context menu
                await this.uploadToDirectory(this.currentRemotePath);
            };
            uploadBtn.addEventListener("click", this.handleUploadClick);
        }

        // Add event listener for cancel transfer button
        const cancelBtn = document.getElementById("upload-cancel-btn");
        if (cancelBtn) {
            cancelBtn.removeEventListener("click", this.handleCancelClick);
            this.handleCancelClick = async () => {
                await this.cancelTransfer();
            };
            cancelBtn.addEventListener("click", this.handleCancelClick);
        }

        // Add event listener for new folder button
        const newFolderBtn = document.querySelector(
            '.file-toolbar-btn[data-action="new-folder"]',
        );
        if (newFolderBtn) {
            newFolderBtn.removeEventListener(
                "click",
                this.handleNewFolderClick,
            ); // Remove any existing listener
            this.handleNewFolderClick = async () => {
                await this.handleToolbarAction("new-folder");
            };
            newFolderBtn.addEventListener("click", this.handleNewFolderClick);
        }

        // Add event listener for new file button
        const newFileBtn = document.querySelector(
            '.file-toolbar-btn[data-action="new-file"]',
        );
        if (newFileBtn) {
            newFileBtn.removeEventListener("click", this.handleNewFileClick); // Remove any existing listener
            this.handleNewFileClick = async () => {
                await this.handleToolbarAction("new-file");
            };
            newFileBtn.addEventListener("click", this.handleNewFileClick);
        }

        // Add event listener for refresh button
        const refreshBtn = document.querySelector(
            '.file-toolbar-btn[data-action="refresh"]',
        );
        if (refreshBtn) {
            refreshBtn.removeEventListener("click", this.handleRefreshClick); // Remove any existing listener
            this.handleRefreshClick = async () => {
                await this.handleToolbarAction("refresh");
            };
            refreshBtn.addEventListener("click", this.handleRefreshClick);
        }

        // Add event listener for history button
        const historyBtn = document.querySelector(
            '.file-toolbar-btn[data-action="history"]',
        );
        if (historyBtn) {
            historyBtn.removeEventListener("click", this.handleHistoryClick); // Remove any existing listener
            this.handleHistoryClick = async () => {
                await this.handleToolbarAction("history");
            };
            historyBtn.addEventListener("click", this.handleHistoryClick);
        }

        // Update history button count
        await this.updateHistoryButtonCount();
    }

    async updateHistoryButtonCount() {
        const historyBtn = document.querySelector(
            '.file-toolbar-btn[data-action="history"]',
        );
        if (!historyBtn) return;

        try {
            const history = await this.getFileHistory();
            const count = history.length;

            // Remove existing badge
            const existingBadge = historyBtn.querySelector(
                ".history-count-badge",
            );
            if (existingBadge) {
                existingBadge.remove();
            }

            // Add badge if there are history items
            if (count > 0) {
                const badge = document.createElement("span");
                badge.className = "history-count-badge";
                badge.textContent = count > 99 ? "99+" : count.toString();
                historyBtn.appendChild(badge);
            }
        } catch (error) {
            console.error("Failed to update history count:", error);
        }
    }

    // Called when the Files sidebar panel becomes active
    async handlePanelBecameActive() {
        console.log("Remote Explorer: Panel became active");
        console.log("Current session ID:", this.currentSessionID);
        console.log("Background session ID:", this.backgroundSessionID);
        console.log("Background path:", this.backgroundRemotePath);
        console.log("isActivePanel before:", this.isActivePanel);

        this.isActivePanel = true;
        console.log("isActivePanel set to:", this.isActivePanel);

        // Enable live search for files
        this.initializeLiveSearch();

        // Get current active tab
        const activeTab = this.tabsManager.getActiveTab();
        console.log("Active tab:", activeTab);

        // Check if we have a valid SSH tab
        if (
            !activeTab ||
            activeTab.connectionType !== "ssh" ||
            activeTab.status !== "connected"
        ) {
            console.log(
                "No SSH tab or not connected - showing select SSH message",
            );
            this.showSelectSSHMessage();
            return;
        }

        console.log("SSH tab is valid, processing...");

        // Check if we have a background session for this same tab
        if (this.backgroundSessionID === activeTab.sessionId) {
            console.log(
                "Restoring background SFTP session:",
                this.backgroundSessionID,
            );
            console.log("Restoring path:", this.backgroundRemotePath);

            // Restore from background
            this.currentSessionID = this.backgroundSessionID;
            this.currentRemotePath = this.backgroundRemotePath || ".";

            console.log("Restored current path:", this.currentRemotePath);

            // Always render the UI first to ensure proper structure
            console.log("Rendering file explorer UI");
            this.renderFileExplorerUI();

            // Check if we have cached content for this path
            const cacheKey = `${this.currentSessionID}:${this.currentRemotePath}`;
            console.log("Checking cache key:", cacheKey);
            console.log("Cache has key:", this.fileCache.has(cacheKey));

            if (this.fileCache.has(cacheKey)) {
                console.log(
                    "Using cached content for path:",
                    this.currentRemotePath,
                );
                const cachedFiles = this.fileCache.get(cacheKey);
                console.log("Cached files count:", cachedFiles.length);

                // Add parent directory if needed
                const processedFiles = [...cachedFiles];
                if (this.currentRemotePath !== "/") {
                    const parentPath = this.getParentPath(
                        this.currentRemotePath,
                    );
                    console.log(
                        "Adding parent directory with path:",
                        parentPath,
                    );
                    processedFiles.unshift({
                        name: "..",
                        path: parentPath,
                        isDir: true,
                        isParent: true,
                        size: 0,
                        mode: "drwxr-xr-x",
                        modifiedTime: new Date(),
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

                console.log(
                    "About to render cached files - count:",
                    processedFiles.length,
                );

                this.updateBreadcrumbs(this.currentRemotePath); // Rebuild breadcrumbs from path
                console.log(
                    "Breadcrumbs updated for path:",
                    this.currentRemotePath,
                );

                this.renderFileList(processedFiles);
                console.log("File list rendered from cache");
            } else {
                console.log(
                    "No cache, reloading directory:",
                    this.currentRemotePath,
                );
                // No cache, reload the directory
                try {
                    await this.loadDirectoryContent(this.currentRemotePath);
                } catch (error) {
                    console.error("Failed to load directory content:", error);
                    this.showErrorState(
                        `Failed to load directory: ${error.message}`,
                    );
                }
            }

            updateStatus(`File Explorer restored for ${activeTab.title}`);
        } else {
            console.log(
                "Different tab or no background session - initializing new",
            );
            // Different tab or no background session - initialize new
            try {
                await this.initializeForSSHSession(activeTab);

                // Update history count for the new tab
                await this.updateHistoryButtonCount();
            } catch (error) {
                console.error(
                    "Failed to initialize for new SSH session:",
                    error,
                );
                this.showErrorState(`Failed to initialize: ${error.message}`);
            }
        }
    }

    // Called when the Files sidebar panel becomes hidden (switching to Profiles, etc.)
    async handlePanelBecameHidden() {
        console.log("Remote Explorer: Panel became hidden");
        console.log(
            "Current session ID before hiding:",
            this.currentSessionID,
        );
        console.log("Current path before hiding:", this.currentRemotePath);

        this.isActivePanel = false;

        // Disable live search
        if (this.liveSearch) {
            this.liveSearch.disable();
        }

        // Move current session to background instead of disconnecting
        if (this.currentSessionID) {
            console.log(
                "Moving SFTP session to background:",
                this.currentSessionID,
            );
            console.log("Saving current path:", this.currentRemotePath);

            this.backgroundSessionID = this.currentSessionID;
            this.backgroundRemotePath = this.currentRemotePath;
            // Note: We don't need to save breadcrumbs since we rebuild them from path

            console.log(
                "Background session saved:",
                this.backgroundSessionID,
            );
            console.log("Background path saved:", this.backgroundRemotePath);

            // Clear active session but keep background
            this.currentSessionID = null;
            this.currentRemotePath = null;

            console.log("Active session cleared");
        }

        // Clear any search state
        if (this.liveSearch) {
            this.liveSearch.clearSearch();
        }

        // Clear any UI classes that might interfere with other views
        const sidebarContent = document.getElementById("sidebar-content");
        if (sidebarContent) {
            sidebarContent.className = "";
            console.log("Cleared sidebar content classes");
        }

        // DON'T clear the view - keep the UI intact for faster restoration
        console.log("NOT calling clearView() - keeping UI intact");
        // this.clearView();
        console.log("handlePanelBecameHidden completed");
    }

    // Handle active tab changes when panel is visible
    async handleActiveTabChanged(tabDetails) {
        const { tab } = tabDetails;

        console.log("handleActiveTabChanged called with tab:", tab);

        // Only process if the panel is currently active
        if (!this.isActivePanel) {
            console.log("Panel not active, skipping tab change processing");
            return;
        }

        console.log("Processing tab change for active panel");
        console.log("New tab:", tab);
        console.log("Tab type:", tab?.connectionType);
        console.log("Tab status:", tab?.status);

        // Check if we have a valid SSH tab
        if (
            !tab ||
            tab.connectionType !== "ssh" ||
            tab.status !== "connected"
        ) {
            console.log("No SSH tab or not connected");

            // Clean up current session but keep background intact
            this.currentSessionID = null;
            this.currentRemotePath = null;

            this.showSelectSSHMessage();
            return;
        }

        // If this is the same session as our current or background, don't reinitialize
        if (
            this.currentSessionID === tab.sessionId ||
            this.backgroundSessionID === tab.sessionId
        ) {
            console.log("Same session, no reinitialization needed");

            // If we have a background session for this tab, restore it
            if (this.backgroundSessionID === tab.sessionId) {
                console.log("Restoring from background session");
                this.currentSessionID = this.backgroundSessionID;
                this.currentRemotePath = this.backgroundRemotePath || ".";

                // Re-render if needed
                await this.loadDirectoryContent(this.currentRemotePath);

                // Update history count for the new tab
                await this.updateHistoryButtonCount();
            }

            return;
        }

        console.log("Different session, initializing new connection");

        // Move current session to background if it exists and is different
        if (this.currentSessionID && this.currentSessionID !== tab.sessionId) {
            console.log("Moving current session to background");
            this.backgroundSessionID = this.currentSessionID;
            this.backgroundRemotePath = this.currentRemotePath;
        }

        // Initialize for the new SSH session
        try {
            await this.initializeForSSHSession(tab);

            // Update history count for the new tab
            await this.updateHistoryButtonCount();
        } catch (error) {
            console.error(
                "Failed to initialize for new SSH session:",
                error,
            );
            this.showErrorState(`Failed to initialize: ${error.message}`);
        }
    }

    async initializeForSSHSession(tab) {
        try {
            this.currentSessionID = tab.sessionId;
            this.showLoadingState();

            // Initialize SFTP session in backend
            await window.go.main.App.InitializeFileExplorerSession(
                this.currentSessionID,
            );

            // Resolve the home directory to get absolute path
            let startPath = ".";
            try {
                // Get the current working directory (absolute path)
                const workingDir =
                    await window.go.main.App.GetRemoteWorkingDirectory(
                        this.currentSessionID,
                    );
                if (workingDir && workingDir.trim()) {
                    startPath = workingDir.trim();
                    console.log(`Resolved home directory to: ${startPath}`);
                } else {
                    console.warn(
                        "Empty working directory result, using relative path",
                    );
                }
            } catch (error) {
                console.warn(
                    "Failed to resolve home directory, using relative path:",
                    error,
                );
                // Fallback to relative path if pwd fails
                startPath = ".";
            }

            // Set resolved path and load directory
            this.currentRemotePath = startPath;
            await this.loadDirectoryContent(startPath);
            updateStatus(`File Explorer connected to ${tab.title}`);
        } catch (error) {
            console.error("Failed to initialize SFTP session:", error);
            this.showErrorState(`Failed to connect: ${error.message}`);
            showNotification("Failed to initialize file explorer", "error");
        }
    }

    async cleanupSFTPSession(sessionID) {
        try {
            await window.go.main.App.CloseFileExplorerSession(sessionID);
            console.log(`SFTP session cleaned up for ${sessionID}`);
        } catch (error) {
            console.error("Error cleaning up SFTP session:", error);
        }
    }

    async loadDirectoryContent(remotePath) {
        console.log("loadDirectoryContent called with path:", remotePath);
        console.log("Current session ID:", this.currentSessionID);

        if (!this.currentSessionID) {
            console.error("No current session ID");
            this.showErrorState("No active SSH session");
            return;
        }

        // Validate and normalize the remote path
        if (
            !remotePath ||
            remotePath === "undefined" ||
            remotePath === "null"
        ) {
            console.error("Invalid remote path provided:", remotePath);
            console.log("Falling back to current working directory");
            remotePath = ".";
        }

        // Ensure remotePath is a string
        remotePath = String(remotePath).trim();

        if (!remotePath) {
            console.error("Empty remote path after trimming");
            remotePath = ".";
        }

        try {
            this.showLoadingState();

            // Check cache first
            const cacheKey = `${this.currentSessionID}:${remotePath}`;
            console.log("Checking cache for key:", cacheKey);

            if (this.fileCache.has(cacheKey)) {
                console.log("Using cached content for path:", remotePath);
                const cachedFiles = this.fileCache.get(cacheKey);

                if (!cachedFiles || !Array.isArray(cachedFiles)) {
                    console.error("Invalid cached data:", cachedFiles);
                    this.fileCache.delete(cacheKey);
                    // Fall through to fresh load
                } else {
                    // Add parent directory entry if not at absolute root
                    const processedFiles = [...cachedFiles];
                    if (remotePath !== "/") {
                        const parentPath = this.getParentPath(remotePath);
                        processedFiles.unshift({
                            name: "..",
                            path: parentPath,
                            isDir: true,
                            isParent: true,
                            size: 0,
                            mode: "drwxr-xr-x",
                            modifiedTime: new Date(),
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
                    console.log("Cached content rendered successfully");
                    return;
                }
            }

            console.log("Loading fresh content for path:", remotePath);

            // Add more detailed error handling for the API call
            let files;
            let usedSudo = false;
            try {
                files = await window.go.main.App.ListRemoteFiles(
                    this.currentSessionID,
                    remotePath,
                );
                console.log("API call successful, received files:", files);
            } catch (apiError) {
                console.error("API call failed:", apiError);
                const errorMsg = apiError.message || apiError.toString();

                // Check if this is a permission error
                const isPermissionError = this.isPermissionError(errorMsg);

                if (isPermissionError) {
                    console.log("Permission error detected, showing sudo retry option");
                    this.showErrorState(
                        "Access denied - directory requires elevated permissions",
                        { showSudoRetry: true, path: remotePath }
                    );
                    return;
                } else if (
                    errorMsg.includes("failed to read directory")
                ) {
                    console.log(
                        "Directory read failed, trying to fallback to working directory",
                    );
                    if (remotePath !== ".") {
                        // Try fallback to current working directory
                        try {
                            files = await window.go.main.App.ListRemoteFiles(
                                this.currentSessionID,
                                ".",
                            );
                            remotePath = "."; // Update path to reflect the fallback
                            console.log("Fallback successful");
                        } catch (fallbackError) {
                            console.error(
                                "Fallback also failed:",
                                fallbackError,
                            );
                            throw apiError; // Throw original error
                        }
                    } else {
                        throw apiError; // Already at working directory, can't fallback further
                    }
                } else {
                    throw apiError; // Re-throw other types of errors
                }
            }

            // Handle null/undefined response as empty directory
            let fileList = files;
            if (!files) {
                console.log(
                    "Empty directory (null response), treating as empty array",
                );
                fileList = [];
            } else if (!Array.isArray(files)) {
                console.error(
                    "Invalid files response (not an array):",
                    files,
                );
                this.showErrorState("Invalid response from server");
                return;
            }

            console.log("Received files:", fileList.length);
            console.log(
                "Sample file data:",
                fileList.length > 0 ? fileList[0] : "none",
            );

            // Add parent directory entry if not at absolute root
            const processedFiles = [...fileList];
            if (remotePath !== "/") {
                const parentPath = this.getParentPath(remotePath);
                console.log(
                    "Adding parent directory with path:",
                    parentPath,
                );
                processedFiles.unshift({
                    name: "..",
                    path: parentPath,
                    isDir: true,
                    isParent: true,
                    size: 0,
                    mode: "drwxr-xr-x",
                    modifiedTime: new Date(),
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
            this.fileCache.set(cacheKey, fileList);

            this.currentRemotePath = remotePath;
            this.updateBreadcrumbs(remotePath);
            this.renderFileList(processedFiles);
            console.log("Fresh content rendered successfully");
        } catch (error) {
            console.error("Failed to load directory:", error);
            console.error("Error details:", {
                message: error.message,
                stack: error.stack,
                remotePath,
                sessionID: this.currentSessionID,
            });
            this.showErrorState(`Failed to load directory: ${error.message}`);
        }
    }

    getParentPath(path) {
        // Handle relative path case (fallback)
        if (!path || path === "." || path === "") {
            return "/";
        }

        if (path === "/") {
            return "/"; // Already at root
        }

        // Always work with absolute paths
        if (path.startsWith("/")) {
            const parts = path.split("/").filter((part) => part.length > 0);
            if (parts.length <= 1) {
                return "/";
            }
            return "/" + parts.slice(0, -1).join("/");
        }

        // Fallback for relative paths (shouldn't happen with new logic)
        const parts = path.split("/").filter((part) => part.length > 0);
        if (parts.length <= 1) {
            return "/";
        }
        return parts.slice(0, -1).join("/");
    }

    updateBreadcrumbs(path) {
        console.log("Updating breadcrumbs for path:", path);
        this.breadcrumbs = [];

        if (path === "← Back to Files") {
            // Special case for history view - make it clickable
            this.breadcrumbs = [
                {
                    name: "← Back to Files",
                    path: "back-to-files",
                    isClickable: true,
                },
            ];
        } else if (path === "/") {
            this.breadcrumbs = [
                { name: "Root", path: "/", isClickable: false },
            ];
        } else {
            const parts = path.split("/").filter((part) => part.length > 0);
            let currentPath = "";

            // Add root
            this.breadcrumbs.push({
                name: "Root",
                path: "/",
                isClickable: true,
            });

            // Add each directory
            for (let i = 0; i < parts.length; i++) {
                currentPath += "/" + parts[i];
                this.breadcrumbs.push({
                    name: parts[i],
                    path: currentPath,
                    isClickable: i < parts.length - 1, // Make all except the last one clickable
                });
            }
        }

        this.renderBreadcrumbs();
    }

    renderBreadcrumbs() {
        const container = document.querySelector(".file-breadcrumbs");
        if (!container) return;

        const breadcrumbsHTML = this.breadcrumbs
            .map((item, index) => {
                const isLast = index === this.breadcrumbs.length - 1;
                const itemClass = `breadcrumb-item ${item.isClickable ? "clickable" : ""} ${isLast ? "active" : ""}`;

                let content = `<span class="${itemClass}" data-path="${item.path}">${item.name}</span>`;

                if (!isLast) {
                    content += `<span class="breadcrumb-separator">></span>`;
                }

                return content;
            })
            .join("");

        container.innerHTML = breadcrumbsHTML;

        // Add click listeners for clickable breadcrumbs
        container
            .querySelectorAll(".breadcrumb-item.clickable")
            .forEach((item) => {
                item.addEventListener("click", async () => {
                    const targetPath = item.dataset.path;
                    console.log("Breadcrumb clicked:", targetPath);

                    if (targetPath === "back-to-files") {
                        // Return to files from history view
                        await this.toggleFileHistoryView();
                    } else {
                        // Navigate to directory
                        await this.navigateToPath(targetPath);
                    }
                });
            });

        // Subscription moved to init() to ensure a single global listener
    }

    initializeLiveSearch() {
        if (this.liveSearch) {
            this.liveSearch.destroy();
        }

        this.liveSearch = new LiveSearch({
            containerSelector: ".remote-files-container",
            itemSelector: ".file-item",
            searchIndicatorClass: "file-search-indicator",
            clearManagerCallback: () => {
                this.restoreAllFileItems();
                this.liveSearch.clearSearch();
            },
            getItemData: (item) => {
                return {
                    name: item.dataset.name || "",
                    path: item.dataset.path || "",
                    text: item.textContent || "",
                    isParent: item.dataset.isParent === "true",
                };
            },
            onSearch: (query) => {
                if (query.trim() === "") {
                    this.restoreAllFileItems();
                } else {
                    this.performFileSearch(query);
                }
            },
        });

        this.liveSearch.enable();
    }

    // Handle progress events from backend (unified for upload/download)
    handleTransferProgressEvent(data, direction = "upload") {
        if (!data || data.sessionId !== this.currentSessionID) return;
        const phase = data.phase || "";
        const isDownload = direction === "download";

        if (phase === "batch-start") {
            // Initialize batch tracking
            this.batchProgress = {
                active: true,
                isDownload,
                totalFiles: data.totalFiles || 0,
                completedFiles: 0,
                fileProgress: new Map(),
                startTime: Date.now(),
                cancelled: false,
            };
            this.showBatchProgress();
            return;
        }

        if (phase === "start" || phase === "progress") {
            const fileIndex = data.fileIndex || 1;
            const totalFiles = data.totalFiles || 1;
            const percent = typeof data.percent === "number" ? data.percent : 0;
            const bytesPerSec = data.bytesPerSec || 0;

            // Initialize batchProgress if not set (for single file transfers without batch-start)
            if (!this.batchProgress || !this.batchProgress.active) {
                this.batchProgress = {
                    active: true,
                    isDownload,
                    totalFiles: totalFiles,
                    completedFiles: 0,
                    fileProgress: new Map(),
                    startTime: Date.now(),
                    cancelled: false,
                };
            }

            // Update individual file progress in batch
            this.batchProgress.fileProgress.set(fileIndex, {
                percent,
                bytesPerSec,
                fileName: data.fileName || "",
            });

            this.showBatchProgress();
            return;
        }

        if (phase === "complete") {
            const fileIndex = data.fileIndex || 1;
            const totalFiles = data.totalFiles || 1;
            
            // Initialize batchProgress if not set (for single file transfers)
            if (!this.batchProgress || !this.batchProgress.active) {
                this.batchProgress = {
                    active: true,
                    isDownload,
                    totalFiles: totalFiles,
                    completedFiles: 0,
                    fileProgress: new Map(),
                    startTime: Date.now(),
                    cancelled: false,
                };
            }
            
            // Mark file as complete
            this.batchProgress.fileProgress.set(fileIndex, {
                percent: 100,
                bytesPerSec: 0,
                fileName: data.fileName || "",
                completed: true,
            });
            this.batchProgress.completedFiles++;

            this.showBatchProgress();
            
            // For single file transfers, hide progress when done
            if (this.batchProgress.completedFiles >= this.batchProgress.totalFiles) {
                setTimeout(() => {
                    this.resetBatchProgress();
                    this.hideTransferProgress();
                }, 500);
            }
            return;
        }

        if (phase === "error") {
            this.resetBatchProgress();
            this.hideTransferProgress();
            showNotification(
                `${isDownload ? "Download" : "Upload"} error: ${data.error || "Unknown error"}`,
                "error",
            );
            return;
        }

        if (phase === "batch-complete") {
            this.resetBatchProgress();
            this.hideTransferProgress();
            // Refresh directory after uploads (not needed for downloads)
            if (!isDownload && this.currentRemotePath) {
                this.refreshCurrentDirectory();
            }
            return;
        }
    }

    // Calculate aggregate batch progress
    calculateBatchProgress() {
        if (!this.batchProgress.active || this.batchProgress.totalFiles === 0) {
            return { overallPercent: 0, avgSpeed: 0, activeFiles: 0 };
        }

        let totalPercent = 0;
        let totalSpeed = 0;
        let activeCount = 0;

        for (const [, fileInfo] of this.batchProgress.fileProgress) {
            totalPercent += fileInfo.percent || 0;
            if (!fileInfo.completed && fileInfo.bytesPerSec > 0) {
                totalSpeed += fileInfo.bytesPerSec;
                activeCount++;
            }
        }

        // Calculate overall progress: completed files + partial progress of active files
        const completedPercent = this.batchProgress.completedFiles * 100;
        const activePercent = totalPercent - (this.batchProgress.completedFiles * 100);
        const overallPercent = (completedPercent + activePercent) / this.batchProgress.totalFiles;

        return {
            overallPercent: Math.min(100, Math.max(0, overallPercent)),
            avgSpeed: totalSpeed,
            activeFiles: activeCount,
        };
    }

    // Show batch progress with aggregated info
    showBatchProgress() {
        const container = document.getElementById("upload-progress");
        const text = document.getElementById("upload-progress-text");
        const fill = document.getElementById("upload-progress-fill");
        if (!container || !text || !fill) return;

        container.style.display = "";

        const { overallPercent, avgSpeed, activeFiles } = this.calculateBatchProgress();
        
        fill.style.width = `${overallPercent}%`;
        
        // Build progress text
        const direction = this.batchProgress.isDownload ? "" : "";
        const completed = this.batchProgress.completedFiles;
        const total = this.batchProgress.totalFiles;
        const speedPart = avgSpeed > 0 ? ` • ${this.formatTransferSpeed(avgSpeed)}` : "";
        const activePart = activeFiles > 1 ? ` (${activeFiles} active)` : "";
        
        text.textContent = `${direction} ${completed}/${total} files • ${overallPercent.toFixed(0)}%${speedPart}${activePart}`;
    }

    // Reset batch progress state
    resetBatchProgress() {
        this.batchProgress = {
            active: false,
            isDownload: false,
            totalFiles: 0,
            completedFiles: 0,
            fileProgress: new Map(),
            startTime: null,
            cancelled: false,
        };
    }

    // Cancel ongoing transfer
    async cancelTransfer() {
        if (!this.batchProgress.active) return;
        
        this.batchProgress.cancelled = true;
        
        try {
            if (window.go?.main?.App?.CancelSFTPTransfer) {
                await window.go.main.App.CancelSFTPTransfer(this.currentSessionID);
                showNotification("Transfer cancelled", "info");
            }
        } catch (error) {
            console.error("Failed to cancel transfer:", error);
        }
        
        this.resetBatchProgress();
        this.hideTransferProgress();
    }

    // Legacy handler for backwards compatibility
    handleUploadProgressEvent(data) {
        this.handleTransferProgressEvent(data, "upload");
    }

    handleTabStatusUpdate(data) {
        if (!data || !data.tabId) {
            return;
        }

        const status = data.status;

        // If a tab disconnects/fails and it's our current session, clear the view
        if (
            status === "disconnected" ||
            status === "failed" ||
            status === "hanging"
        ) {
            // Get the session ID for this tab
            const tab = this.tabsManager?.getTabById?.(data.tabId);
            if (tab && tab.sessionId === this.currentSessionID) {
                console.log(
                    "Remote Explorer: Session disconnected, clearing view",
                );
                // Clear the current session so reconnection will trigger refresh
                this.currentSessionID = null;
                this.currentRemotePath = null;

                // Show the placeholder message
                if (this.isActivePanel) {
                    this.showSelectSSHMessage();
                }
            }
        }
    }

    async handleSftpReconnected(data) {
        if (!data || !data.sessionId) {
            console.warn("Remote Explorer: Invalid sftp-reconnected data");
            return;
        }

        console.log(
            "Remote Explorer: SFTP reconnected for session:",
            data.sessionId,
        );

        // Update background session if this is a reconnection
        this.backgroundSessionID = data.sessionId;

        // If the file manager panel is not active, we're done (will load when panel activates)
        if (!this.isActivePanel) {
            return;
        }

        // If the reconnected session is the currently displayed one OR we don't have a session, refresh
        if (
            this.currentSessionID === data.sessionId ||
            !this.currentSessionID
        ) {
            // Set this as the current session
            this.currentSessionID = data.sessionId;

            // Refresh the current directory to show files again
            if (this.currentRemotePath && this.currentRemotePath !== ".") {
                try {
                    console.log(
                        "Refreshing current path:",
                        this.currentRemotePath,
                    );
                    await this.loadDirectory(this.currentRemotePath);
                    showNotification("File manager reconnected", "success");
                } catch (err) {
                    console.error("Failed to refresh after reconnection:", err);
                    // Fall back to working directory
                    try {
                        console.log("Falling back to working directory");
                        let startPath = ".";
                        try {
                            const workingDir =
                                await window.go.main.App.GetRemoteWorkingDirectory(
                                    data.sessionId,
                                );
                            if (workingDir && workingDir.trim()) {
                                startPath = workingDir.trim();
                            }
                        } catch (error) {
                            console.warn(
                                "Failed to get working directory:",
                                error,
                            );
                        }

                        this.currentRemotePath = startPath;
                        await this.loadDirectoryContent(startPath);
                        showNotification("File manager reconnected", "success");
                    } catch (err2) {
                        console.error(
                            "Failed to initialize working directory:",
                            err2,
                        );
                        showNotification(
                            "Failed to reconnect file manager",
                            "error",
                        );
                    }
                }
            } else {
                // No path set yet, initialize from home/working directory
                try {
                    console.log("Initializing from working directory");
                    // Try to get the current working directory
                    let startPath = ".";
                    try {
                        const workingDir =
                            await window.go.main.App.GetRemoteWorkingDirectory(
                                data.sessionId,
                            );
                        if (workingDir && workingDir.trim()) {
                            startPath = workingDir.trim();
                            console.log(
                                `Resolved working directory to: ${startPath}`,
                            );
                        }
                    } catch (error) {
                        console.warn(
                            "Failed to get working directory, using '.':",
                            error,
                        );
                    }

                    this.currentRemotePath = startPath;
                    await this.loadDirectoryContent(startPath);
                    showNotification("File manager reconnected", "success");
                } catch (err) {
                    console.error(
                        "Failed to initialize after reconnection:",
                        err,
                    );
                    showNotification(
                        "Failed to reconnect file manager",
                        "error",
                    );
                }
            }
        } else {
            console.log(
                "Reconnected session is different from current, ignoring",
            );
        }
    }

    // Format bytes per second to human readable format
    formatTransferSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec <= 0) return "";
        if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
        if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
        return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    showTransferProgress({
        fileIndex = 0,
        totalFiles = 1,
        percent = 0,
        fileName = "",
        bytesPerSec = 0,
        isDownload = false,
    } = {}) {
        // If batch progress is active, use that instead
        if (this.batchProgress.active) {
            this.showBatchProgress();
            return;
        }

        const container = document.getElementById("upload-progress");
        const text = document.getElementById("upload-progress-text");
        const fill = document.getElementById("upload-progress-fill");
        if (!container || !text || !fill) return;

        container.style.display = "";
        const safePercent = Math.max(0, Math.min(100, percent));
        fill.style.width = `${safePercent}%`;
        
        // Build progress text with direction indicator and speed
        const direction = isDownload ? "" : "";
        const namePart = fileName ? ` - ${fileName}` : "";
        const speedPart = bytesPerSec > 0 ? ` • ${this.formatTransferSpeed(bytesPerSec)}` : "";
        text.textContent = `${direction} File ${fileIndex}/${totalFiles}${namePart} • ${safePercent.toFixed(0)}%${speedPart}`;
    }

    // Legacy method for backwards compatibility
    showUploadProgress({
        fileIndex = 0,
        totalFiles = 1,
        percent = 0,
        fileName = "",
    } = {}) {
        this.showTransferProgress({
            fileIndex,
            totalFiles,
            percent,
            fileName,
            isDownload: false,
        });
    }

    hideTransferProgress() {
        const container = document.getElementById("upload-progress");
        if (container) {
            container.style.display = "none";
        }
        // Also reset batch progress
        this.resetBatchProgress();
    }

    // Legacy method for backwards compatibility
    hideUploadProgress() {
        this.hideTransferProgress();
    }

    performFileSearch(query) {
        const container = document.querySelector(".remote-files-container");
        if (!container) return;

        const fileItems = document.querySelectorAll(".file-item");
        let matchCount = 0;

        fileItems.forEach((item) => {
            const itemData = {
                name: item.dataset.name || "",
                path: item.dataset.path || "",
                text: item.textContent || "",
                isParent: item.dataset.isParent === "true",
            };

            // Always show parent directory (..)
            const matches =
                itemData.isParent ||
                itemData.name.toLowerCase().includes(query.toLowerCase()) ||
                itemData.path.toLowerCase().includes(query.toLowerCase());

            if (matches) {
                item.style.display = "";
                if (!itemData.isParent) matchCount++;
            } else {
                item.style.display = "none";
            }
        });

        this.liveSearch.updateSearchResults(matchCount);
    }

    restoreAllFileItems() {
        const fileItems = document.querySelectorAll(".file-item");
        fileItems.forEach((item) => {
            item.style.display = "";
        });

        if (this.liveSearch) {
            this.liveSearch.updateSearchResults(0); // Clear search results counter
        }
    }

    renderFileList(files) {
        // Clear any active search when showing new files
        if (this.liveSearch) {
            this.liveSearch.clearSearch();
        }

        const container = this.getFileListContainer();
        if (!container) return;

        if (files.length === 0) {
            container.innerHTML = `
                <div class="empty-directory">
                    <div class="empty-directory-icon"></div>
                    <div>This directory is empty</div>
                </div>
            `;
            return;
        }

        const filesHTML = files
            .map((file) => this.createFileItemHTML(file))
            .join("");
        container.innerHTML = filesHTML;
    }

    createFileItemHTML(file) {
        const icon = this.getFileIcon(file);
        const sizeDisplay = file.isDir ? "" : this.formatFileSize(file.size);
        const modTimeDisplay = file.isParent
            ? ""
            : this.formatDateTime(file.modifiedTime);
        const fileName = file.isParent ? ".." : file.name;
        const fileClass = file.isParent
            ? "file-item parent-directory"
            : "file-item";

        return `
            <div class="${fileClass}" data-name="${fileName}" data-path="${file.path}" data-is-dir="${file.isDir}" data-is-parent="${file.isParent || false}">
                <div class="file-icon">${icon}</div>
                <div class="file-details">
                    <div class="file-name">
                        ${fileName}
                        ${file.isSymlink ? " → " + (file.symlinkTarget || "?") : ""}
                    </div>
                    <div class="file-meta">
                        <span class="file-size">${sizeDisplay}</span>
                        <span class="file-modified">${modTimeDisplay}</span>
                        ${!file.isParent ? `<span class="file-mode">${file.mode}</span>` : ""}
                    </div>
                </div>
            </div>
        `;
    }

    getFileIcon(file) {
        const svgIcon = (name) => `<img src="./icons/${name}.svg" class="svg-icon file-icon" alt="">`;
        
        if (file.isParent) {
            return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: var(--text-secondary);">
                <path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/>
            </svg>`;
        } else if (file.isDir) {
            return svgIcon("folder");
        } else if (file.isSymlink) {
            return svgIcon("link");
        } else {
            const ext = file.name.split(".").pop().toLowerCase();
            const iconMap = {
                txt: "document",
                md: "document",
                log: "document",
                readme: "document",
                js: "text",
                ts: "text",
                py: "text",
                sh: "terminal",
                bash: "terminal",
                html: "globe",
                htm: "globe",
                css: "palette",
                json: "clipboard",
                xml: "clipboard",
                jpg: "eye",
                jpeg: "eye",
                png: "eye",
                gif: "eye",
                svg: "eye",
                pdf: "page",
                doc: "page",
                docx: "page",
                xls: "page",
                xlsx: "page",
                zip: "files",
                tar: "files",
                gz: "files",
                rar: "files",
                "7z": "files",
                exe: "settings",
                bin: "settings",
                app: "settings",
                deb: "settings",
                rpm: "settings",
                conf: "wrench",
                config: "wrench",
                cfg: "wrench",
                ini: "wrench",
                sql: "clipboard",
                db: "clipboard",
                sqlite: "clipboard",
            };
            return iconMap[ext] ? svgIcon(iconMap[ext]) : svgIcon("document");
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    formatDateTime(dateTime) {
        if (!dateTime) return "";
        const date = new Date(dateTime);
        return date.toLocaleDateString() + " " + date.toLocaleTimeString();
    }

    selectFileItem(fileItem, event = null) {
        const items = Array.from(document.querySelectorAll(".file-item"));
        const index = items.indexOf(fileItem);

        const isParent = fileItem.dataset.isParent === "true";

        // Determine selection mode
        const shift = event?.shiftKey === true;
        const ctrl = event?.ctrlKey === true || event?.metaKey === true;

        if (shift && this.lastSelectedIndex !== null) {
            // Range selection
            const start = Math.min(this.lastSelectedIndex, index);
            const end = Math.max(this.lastSelectedIndex, index);
            items.forEach((it, i) => {
                if (i >= start && i <= end && it.dataset.isParent !== "true") {
                    it.classList.add("selected");
                } else if (!ctrl) {
                    it.classList.remove("selected");
                }
            });
        } else if (ctrl) {
            // Toggle selection
            if (fileItem.dataset.isParent !== "true") {
                fileItem.classList.toggle("selected");
            }
            // Keep others as-is
            this.lastSelectedIndex = index;
        } else {
            // Single selection
            document
                .querySelectorAll(".file-item.selected")
                .forEach((it) => it.classList.remove("selected"));
            if (fileItem.dataset.isParent !== "true") {
                fileItem.classList.add("selected");
            }
            this.lastSelectedIndex = index;
        }

        // Update status with selection count
        const selected = Array.from(
            document.querySelectorAll(".file-item.selected"),
        );
        if (selected.length === 0) {
            updateStatus("No selection");
        } else if (selected.length === 1) {
            const name = selected[0].dataset.name;
            updateStatus(`Selected: ${name}`);
        } else {
            updateStatus(`Selected ${selected.length} items`);
        }
    }

    handleFileItemClick(fileItem, event) {
        this.selectFileItem(fileItem, event);
    }

    handleFileItemDoubleClick(fileItem) {
        console.log("Double-click detected on file item");

        const isDir = fileItem.dataset.isDir === "true";
        const path = fileItem.dataset.path;
        const isParent = fileItem.dataset.isParent === "true";
        const fileName = fileItem.dataset.name;

        console.log("File item data:", {
            isDir,
            path,
            isParent,
            fileName,
        });

        // Validate path before proceeding
        if (!path || path === "undefined" || path === "null") {
            console.error("Invalid path detected in file item:", path);
            console.error("File item element:", fileItem);
            updateStatus("Error: Invalid file path");
            return;
        }

        if (isDir) {
            // Navigate to directory (works for both regular directories and parent directory)
            console.log("Navigating to directory:", path);
            this.navigateToPath(path);

            if (isParent) {
                if (path === "/") {
                    updateStatus("Navigated to root directory (/)");
                } else if (path === ".") {
                    updateStatus("Navigated to home directory");
                } else {
                    updateStatus("Navigated to parent directory");
                }
            } else {
                const dirName = fileItem.dataset.name;
                updateStatus(`Entered directory: ${dirName}`);
            }
        } else {
            // For files, show file preview on double-click
            console.log("Double-click on file, showing preview:", fileName);
            console.log("File path:", path);
            this.showFilePreview(path, fileName);
        }
    }

    async navigateToPath(path) {
        console.log("navigateToPath called with:", path);
        console.log("Current path:", this.currentRemotePath);

        // Validate the path parameter
        if (!path || path === "undefined" || path === "null") {
            console.error("Invalid path provided to navigateToPath:", path);
            console.log("Staying at current path:", this.currentRemotePath);
            return;
        }

        // Ensure path is a string
        path = String(path).trim();

        if (!path) {
            console.error("Empty path after trimming");
            return;
        }

        console.log("Normalized path:", path);

        if (path !== this.currentRemotePath) {
            // Clear cache when navigating to force refresh
            const cacheKey = `${this.currentSessionID}:${path}`;
            this.fileCache.delete(cacheKey);

            const pathDescription =
                path === "/" ? "root (/)" : path === "." ? "home" : `"${path}"`;
            console.log(
                `Navigating from ${this.currentRemotePath} to ${pathDescription}`,
            );
            await this.loadDirectoryContent(path);
        } else {
            console.log("Already at target path, no navigation needed");
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

    showErrorState(message, options = {}) {
        const container = this.getFileListContainer();
        if (container) {
            const { showSudoRetry = false, path = null } = options;
            
            let buttonsHtml = `<button class="retry-btn" onclick="window.remoteExplorerManager.retryCurrentOperation()">Retry</button>`;
            
            if (showSudoRetry && path) {
                buttonsHtml = `
                    <button class="retry-btn" onclick="window.remoteExplorerManager.retryCurrentOperation()">Retry</button>
                    <button class="retry-btn sudo-retry-btn" onclick="window.remoteExplorerManager.retryWithSudo('${path.replace(/'/g, "\\'")}')">Retry with sudo</button>
                `;
            }
            
            container.innerHTML = `
                <div class="error-state">
                    <div class="error-icon"><img src="./icons/${showSudoRetry ? "lock" : "warning"}.svg" class="svg-icon" alt=""></div>
                    <div class="error-message">${message}</div>
                    <div class="error-buttons">${buttonsHtml}</div>
                </div>
            `;
        }
    }

    // Retry directory listing with sudo
    async retryWithSudo(path) {
        console.log("Retrying with sudo for path:", path);
        
        if (!this.currentSessionID) {
            this.showErrorState("No active session");
            return;
        }

        this.showLoadingState();

        try {
            const files = await window.go.main.App.ListRemoteFilesWithSudo(
                this.currentSessionID,
                path,
            );
            
            console.log("Sudo listing successful, received files:", files?.length || 0);
            
            // Process and display files
            const fileList = files || [];
            const processedFiles = [...fileList];
            
            if (path !== "/") {
                const parentPath = this.getParentPath(path);
                processedFiles.unshift({
                    name: "..",
                    path: parentPath,
                    isDir: true,
                    isParent: true,
                });
            }

            this.currentRemotePath = path;
            this.updateBreadcrumbs(path);
            this.renderFileList(processedFiles);
            
        } catch (error) {
            console.error("Sudo listing failed:", error);
            this.showErrorState(`Cannot access directory with sudo: ${error.message}`);
        }
    }

    showSelectSSHMessage() {
        const sidebarContent = document.getElementById("sidebar-content");
        if (sidebarContent) {
            sidebarContent.innerHTML = `
                <div class="remote-explorer-placeholder">
                    <div class="placeholder-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="color: var(--text-secondary);">
                            <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                            <path d="M4,8V18H20V8H4M6,10H8V12H6V10M10,10H18V12H10V10M6,14H8V16H6V14M10,14H18V16H10V14Z"/>
                        </svg>
                    </div>
                    <div class="placeholder-title">Remote File Explorer</div>
                    <div class="placeholder-message">
                        Select a connected SSH tab to browse remote files
                    </div>
                </div>
            `;
        }
    }

    clearView() {
        const sidebarContent = document.getElementById("sidebar-content");
        if (sidebarContent) {
            sidebarContent.innerHTML = "";
        }
    }

    getFileListContainer() {
        let container = document.querySelector(".remote-files-list");
        if (!container) {
            this.renderFileExplorerUI();
            container = document.querySelector(".remote-files-list");
        }
        return container;
    }

    renderFileExplorerUI() {
        console.log("renderFileExplorerUI called");
        console.log("isActivePanel:", this.isActivePanel);

        const sidebarContent = document.getElementById("sidebar-content");
        if (!sidebarContent) {
            console.log("No sidebar content element found");
            return;
        }

        console.log("Rendering file explorer UI");
        sidebarContent.innerHTML = `
            <div class="remote-explorer-container">
                <div class="file-toolbar">
                    <div class="file-toolbar-left">
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
                    <div class="file-toolbar-right">
                        <button class="file-toolbar-btn" data-action="history" title="File History">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="file-breadcrumbs">
                    <!-- Breadcrumbs will be rendered here -->
                </div>
                <div class="upload-progress" id="upload-progress" style="display:none;">
                    <div class="upload-progress-header">
                        <div class="upload-progress-summary">
                            <span class="upload-progress-text" id="upload-progress-text"></span>
                        </div>
                        <button class="upload-cancel-btn" id="upload-cancel-btn" title="Cancel transfer">✕</button>
                    </div>
                    <div class="upload-progress-bar">
                        <div class="upload-progress-fill" id="upload-progress-fill" style="width:0%"></div>
                    </div>
                </div>
                <div class="remote-files-container" style="--wails-drop-target: drop;">
                    <div class="remote-files-list" style="--wails-drop-target: drop;">
                        <!-- File list will be rendered here -->
                    </div>
                </div>
            </div>
        `;
        console.log("File explorer UI rendered");

        // Set up toolbar event listeners after UI is rendered
        this.setupToolbarEventListeners();

        // Visual drag-over feedback for DnD
        const dropContainer = document.querySelector(".remote-files-container");
        if (dropContainer) {
            const enter = () => dropContainer.classList.add("drag-over");
            const leave = () => dropContainer.classList.remove("drag-over");
            dropContainer.addEventListener("dragenter", (e) => {
                e.preventDefault();
                enter();
            });
            dropContainer.addEventListener("dragover", (e) => {
                e.preventDefault();
                enter();
            });
            dropContainer.addEventListener("dragleave", (e) => {
                e.preventDefault();
                leave();
            });
            dropContainer.addEventListener("drop", (e) => {
                e.preventDefault();
                leave();
            });
        }
    }

    async handleToolbarAction(action) {
        switch (action) {
            case "refresh":
                if (this.currentSessionID && this.currentRemotePath) {
                    // Clear cache and reload
                    const cacheKey = `${this.currentSessionID}:${this.currentRemotePath}`;
                    this.fileCache.delete(cacheKey);
                    await this.loadDirectoryContent(this.currentRemotePath);
                }
                break;
            case "upload":
                this.showUploadDialog();
                break;
            case "new-file":
                this.showNewFileDialog();
                break;
            case "new-folder":
                this.showNewFolderDialog();
                break;
            case "history":
                await this.showFileHistoryView();
                break;
        }
    }

    showUploadDialog() {
        console.log("Showing upload dialog");

        if (!this.currentSessionID) {
            showNotification("No active SSH session", "error");
            return;
        }

        // Use the existing modal component for file upload
        if (window.modal) {
            window.modal
                .show({
                    title: "Upload Files",
                    message: `Upload files to: ${this.currentRemotePath}`,
                    icon: '<img src="./icons/arrow-up.svg" class="svg-icon" alt="">',
                    content: `
                    <div style="margin-top: 16px;">
                        <label for="file-upload" style="display: block; margin-bottom: 12px; color: var(--text-primary); font-size: 13px; font-weight: 500;">
                            Select files to upload:
                        </label>
                        <input type="file" id="file-upload" multiple
                               style="width: 100%; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color);
                                      border-radius: 4px; color: var(--text-primary); font-size: 13px; transition: border-color 0.15s ease;"
                               onfocus="this.style.borderColor = 'var(--accent-color)'"
                               onblur="this.style.borderColor = 'var(--border-color)'">
                        <div id="upload-file-list" style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">
                            No files selected
                        </div>
                    </div>
                `,
                    buttons: [
                        {
                            text: "Cancel",
                            style: "secondary",
                            action: "cancel",
                        },
                        {
                            text: "Upload",
                            style: "primary",
                            action: "confirm",
                            handler: () => {
                                const input =
                                    document.getElementById("file-upload");
                                const files = input?.files;
                                if (files && files.length > 0) {
                                    this.handleWebFileUpload(files);
                                } else {
                                    showNotification(
                                        "Please select files to upload",
                                        "error",
                                    );
                                    return false; // Prevent modal from closing
                                }
                            },
                        },
                    ],
                })
                .then((result) => {
                    // Set up file input change handler after modal opens
                    setTimeout(() => {
                        const input = document.getElementById("file-upload");
                        const fileList =
                            document.getElementById("upload-file-list");
                        if (input && fileList) {
                            input.addEventListener("change", (e) => {
                                const files = e.target.files;
                                if (files && files.length > 0) {
                                    const fileNames = Array.from(files)
                                        .map((f) => f.name)
                                        .join(", ");
                                    fileList.textContent = `${files.length} file(s) selected: ${fileNames}`;
                                } else {
                                    fileList.textContent = "No files selected";
                                }
                            });
                        }
                    }, 100);
                });
        }
    }

    showNewFolderDialog() {
        console.log("Showing new folder dialog");

        // Use the existing modal component with custom content for input
        if (window.modal) {
            window.modal
                .show({
                    title: "Create New Folder",
                    message: `Create a new folder in: ${this.currentRemotePath}`,
                    icon: '<img src="./icons/folder.svg" class="svg-icon" alt="">',
                    content: `
                    <div style="margin-top: 16px;">
                        <label for="new-folder-name" style="display: block; margin-bottom: 6px; color: var(--text-primary); font-size: 13px; font-weight: 500;">
                            Folder Name:
                        </label>
                        <input type="text" id="new-folder-name" placeholder="Enter folder name"
                    autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"
                               style="width: 100%; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color);
                                      border-radius: 4px; color: var(--text-primary); font-size: 13px; transition: border-color 0.15s ease;"
                               onfocus="this.style.borderColor = 'var(--accent-color)'"
                               onblur="this.style.borderColor = 'var(--border-color)'">
                    </div>
                `,
                    buttons: [
                        {
                            text: "Cancel",
                            style: "secondary",
                            action: "cancel",
                        },
                        {
                            text: "Create",
                            style: "primary",
                            action: "confirm",
                            handler: () => {
                                const input =
                                    document.getElementById("new-folder-name");
                                const folderName = input?.value?.trim();
                                if (folderName) {
                                    this.createNewFolder(folderName);
                                } else {
                                    showNotification(
                                        "Please enter a folder name",
                                        "error",
                                    );
                                    return false; // Prevent modal from closing
                                }
                            },
                        },
                    ],
                })
                .then((result) => {
                    // Focus the input when modal opens
                    setTimeout(() => {
                        const input =
                            document.getElementById("new-folder-name");
                        if (input) {
                            input.focus();
                        }
                    }, 100);
                });
        }
    }

    showNewFileDialog() {
        console.log("Showing new file dialog");

        // Use the existing modal component with custom content for input
        if (window.modal) {
            window.modal
                .show({
                    title: "Create New File",
                    message: `Create a new file in: ${this.currentRemotePath}`,
                    icon: '<img src="./icons/document.svg" class="svg-icon" alt="">',
                    content: `
                    <div style="margin-top: 16px;">
                        <label for="new-file-name" style="display: block; margin-bottom: 6px; color: var(--text-primary); font-size: 13px; font-weight: 500;">
                            File Name:
                        </label>
                        <input type="text" id="new-file-name" placeholder="Enter file name (e.g., script.js, readme.md)"
                    autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"
                               style="width: 100%; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color);
                                      border-radius: 4px; color: var(--text-primary); font-size: 13px; transition: border-color 0.15s ease;"
                               onfocus="this.style.borderColor = 'var(--accent-color)'"
                               onblur="this.style.borderColor = 'var(--border-color)'">
                    </div>
                `,
                    buttons: [
                        {
                            text: "Cancel",
                            style: "secondary",
                            action: "cancel",
                        },
                        {
                            text: "Create",
                            style: "primary",
                            action: "confirm",
                            handler: () => {
                                const input =
                                    document.getElementById("new-file-name");
                                const fileName = input?.value?.trim();
                                if (fileName) {
                                    this.createNewFile(fileName);
                                } else {
                                    showNotification(
                                        "Please enter a file name",
                                        "error",
                                    );
                                    return false; // Prevent modal from closing
                                }
                            },
                        },
                    ],
                })
                .then((result) => {
                    // Focus the input when modal opens
                    setTimeout(() => {
                        const input = document.getElementById("new-file-name");
                        if (input) {
                            input.focus();
                        }
                    }, 100);
                });
        }
    }

    showRenameDialog(filePath, currentName) {
        console.log("Showing rename dialog for:", currentName);

        // Use the existing modal component with custom content for input
        if (window.modal) {
            window.modal
                .show({
                    title: "Rename File/Folder",
                    message: `Rename: ${filePath}`,
                    icon: '<img src="./icons/rename.svg" class="svg-icon" alt="">',
                    content: `
                    <div style="margin-top: 16px;">
                        <label for="new-file-name" style="display: block; margin-bottom: 6px; color: var(--text-primary); font-size: 13px; font-weight: 500;">
                            New Name:
                        </label>
                        <input type="text" id="new-file-name" value="${currentName}"
                    autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"
                               style="width: 100%; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color);
                                      border-radius: 4px; color: var(--text-primary); font-size: 13px; transition: border-color 0.15s ease;"
                               onfocus="this.style.borderColor = 'var(--accent-color)'"
                               onblur="this.style.borderColor = 'var(--border-color)'">
                    </div>
                `,
                    buttons: [
                        {
                            text: "Cancel",
                            style: "secondary",
                            action: "cancel",
                        },
                        {
                            text: "Rename",
                            style: "primary",
                            action: "confirm",
                            handler: () => {
                                const input =
                                    document.getElementById("new-file-name");
                                const newName = input?.value?.trim();
                                if (newName) {
                                    this.renameFile(
                                        filePath,
                                        currentName,
                                        newName,
                                    );
                                } else {
                                    showNotification(
                                        "Please enter a new name",
                                        "error",
                                    );
                                    return false; // Prevent modal from closing
                                }
                            },
                        },
                    ],
                })
                .then((result) => {
                    // Focus and select the input when modal opens
                    setTimeout(() => {
                        const input = document.getElementById("new-file-name");
                        if (input) {
                            input.focus();
                            // Select filename without extension
                            const lastDot = currentName.lastIndexOf(".");
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
        console.log("Showing delete confirmation for:", fileName);

        // Use the existing modal system for confirmation
        if (window.modal) {
            const itemType = isDir ? "folder" : "file";
            window.modal
                .show({
                    title: `Delete ${itemType}`,
                    message: `Are you sure you want to delete "${fileName}"?${isDir ? " This will delete all contents." : ""}`,
                    icon: '<img src="./icons/trash.svg" class="svg-icon" alt="">',
                    buttons: [
                        {
                            text: "Cancel",
                            style: "secondary",
                            action: "cancel",
                        },
                        { text: "Delete", style: "danger", action: "confirm" },
                    ],
                })
                .then((result) => {
                    if (result === "confirm") {
                        this.deleteFile(filePath, fileName, isDir);
                    }
                });
        } else {
            // Fallback confirm dialog
            const confirmed = confirm(
                `Are you sure you want to delete "${fileName}"?`,
            );
            if (confirmed) {
                this.deleteFile(filePath, fileName, isDir);
            }
        }
    }

    showFileActions(fileItem) {
        // TODO: Implement file actions (download, etc.)
        console.log("File actions for:", fileItem.dataset.name);
    }

    retryCurrentOperation() {
        console.log("Retry operation called");
        console.log("Current session ID:", this.currentSessionID);
        console.log("Current remote path:", this.currentRemotePath);

        if (this.currentSessionID && this.currentRemotePath) {
            console.log("Retrying with valid session and path");
            this.loadDirectoryContent(this.currentRemotePath);
        } else {
            console.error("Cannot retry - missing session or path");
            this.showErrorState("Cannot retry: no active session or path");
        }
    }

    // Get current active tab (delegated to tabs manager)
    getActiveTab() {
        return this.tabsManager.getActiveTab();
    }

    // Force cleanup method for when truly closing the explorer
    async forceCleanup() {
        console.log("Remote Explorer: Force cleanup");

        if (this.currentSessionID) {
            await this.cleanupSFTPSession(this.currentSessionID);
            this.currentSessionID = null;
        }

        if (this.backgroundSessionID) {
            await this.cleanupSFTPSession(this.backgroundSessionID);
            this.backgroundSessionID = null;
            this.backgroundRemotePath = null;
        }

        // Cleanup live search
        if (this.liveSearch) {
            this.liveSearch.destroy();
            this.liveSearch = null;
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
            updateStatus("Directory refreshed");
        }
    }

    async copyPathToClipboard(path) {
        try {
            await navigator.clipboard.writeText(path);
            showNotification(`Path copied: ${path}`, "success");
        } catch (error) {
            console.error("Failed to copy path:", error);
            showNotification("Failed to copy path to clipboard", "error");
        }
    }

    // File operation methods that call backend APIs
    async createNewFolder(folderName) {
        if (!this.currentSessionID || !this.currentRemotePath) {
            showNotification("No active session", "error");
            return;
        }

        const newFolderPath =
            this.currentRemotePath === "/"
                ? `/${folderName}`
                : `${this.currentRemotePath}/${folderName}`;

        try {
            console.log("Creating folder:", newFolderPath);
            await window.go.main.App.CreateRemoteDirectory(
                this.currentSessionID,
                newFolderPath,
            );

            showNotification(
                `Folder "${folderName}" created successfully`,
                "success",
            );

            // Refresh the current directory to show the new folder
            await this.refreshCurrentDirectory();
        } catch (error) {
            console.error("Failed to create folder:", error);
            const errorMsg = error.message || error.toString();
            const isPermissionError = this.isPermissionError(errorMsg);

            if (isPermissionError) {
                // Try with sudo
                const useSudo = await this.confirmSudoOperation("create folder", folderName);
                if (useSudo) {
                    try {
                        await window.go.main.App.CreateRemoteDirectoryWithSudo(
                            this.currentSessionID,
                            newFolderPath,
                        );
                        showNotification(
                            `Folder "${folderName}" created with sudo`,
                            "success",
                        );
                        await this.refreshCurrentDirectory();
                        return;
                    } catch (sudoError) {
                        showNotification(
                            `Failed to create folder with sudo: ${sudoError.message}`,
                            "error",
                        );
                        return;
                    }
                }
            }

            showNotification(
                `Failed to create folder: ${errorMsg}`,
                "error",
            );
        }
    }

    async createNewFile(fileName) {
        if (!this.currentSessionID || !this.currentRemotePath) {
            showNotification("No active session", "error");
            return;
        }

        const newFilePath =
            this.currentRemotePath === "/"
                ? `/${fileName}`
                : `${this.currentRemotePath}/${fileName}`;

        try {
            console.log("Creating file:", newFilePath);

            // Create an empty file by uploading empty content
            await window.go.main.App.UpdateRemoteFileContent(
                this.currentSessionID,
                newFilePath,
                "",
            );

            showNotification(
                `File "${fileName}" created successfully`,
                "success",
            );

            // Refresh the current directory to show the new file
            await this.refreshCurrentDirectory();

            // Auto-open the new file for editing
            setTimeout(() => {
                this.showFilePreview(newFilePath, fileName);
            }, 500); // Small delay to ensure directory refresh completes
        } catch (error) {
            console.error("Failed to create file:", error);
            const errorMsg = error.message || error.toString();
            const isPermissionError = this.isPermissionError(errorMsg);

            if (isPermissionError) {
                // Try with sudo
                const useSudo = await this.confirmSudoOperation("create file", fileName);
                if (useSudo) {
                    try {
                        await window.go.main.App.UpdateRemoteFileContentWithSudo(
                            this.currentSessionID,
                            newFilePath,
                            "",
                        );
                        showNotification(
                            `File "${fileName}" created with sudo`,
                            "success",
                        );
                        await this.refreshCurrentDirectory();
                        setTimeout(() => {
                            this.showFilePreview(newFilePath, fileName);
                        }, 500);
                        return;
                    } catch (sudoError) {
                        showNotification(
                            `Failed to create file with sudo: ${sudoError.message}`,
                            "error",
                        );
                        return;
                    }
                }
            }

            showNotification(
                `Failed to create file: ${errorMsg}`,
                "error",
            );
        }
    }

    async renameFile(oldPath, oldName, newName) {
        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        // Build new path
        const pathParts = oldPath.split("/");
        pathParts[pathParts.length - 1] = newName;
        const newPath = pathParts.join("/");

        try {
            console.log("Renaming from:", oldPath, "to:", newPath);
            await window.go.main.App.RenameRemotePath(
                this.currentSessionID,
                oldPath,
                newPath,
            );

            showNotification(`"${oldName}" renamed to "${newName}"`, "success");

            // Refresh the current directory to show the renamed item
            await this.refreshCurrentDirectory();
        } catch (error) {
            console.error("Failed to rename file:", error);
            const errorMsg = error.message || error.toString();
            const isPermissionError = this.isPermissionError(errorMsg);

            if (isPermissionError) {
                const useSudo = await this.confirmSudoOperation("rename", oldName);
                if (useSudo) {
                    try {
                        await window.go.main.App.RenameRemotePathWithSudo(
                            this.currentSessionID,
                            oldPath,
                            newPath,
                        );
                        showNotification(`"${oldName}" renamed to "${newName}" with sudo`, "success");
                        await this.refreshCurrentDirectory();
                        return;
                    } catch (sudoError) {
                        showNotification(`Failed to rename with sudo: ${sudoError.message}`, "error");
                        return;
                    }
                }
            }

            showNotification(`Failed to rename: ${errorMsg}`, "error");
        }
    }

    async deleteFile(filePath, fileName, isDir) {
        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        const itemType = isDir ? "folder" : "file";

        try {
            console.log("Deleting:", filePath);
            await window.go.main.App.DeleteRemotePath(
                this.currentSessionID,
                filePath,
            );

            showNotification(
                `${itemType} "${fileName}" deleted successfully`,
                "success",
            );

            // Refresh the current directory to remove the deleted item
            await this.refreshCurrentDirectory();
        } catch (error) {
            console.error("Failed to delete file:", error);
            const errorMsg = error.message || error.toString();
            const isPermissionError = this.isPermissionError(errorMsg);

            if (isPermissionError) {
                const useSudo = await this.confirmSudoOperation("delete", fileName);
                if (useSudo) {
                    try {
                        await window.go.main.App.DeleteRemotePathWithSudo(
                            this.currentSessionID,
                            filePath,
                        );
                        showNotification(
                            `${itemType} "${fileName}" deleted with sudo`,
                            "success",
                        );
                        await this.refreshCurrentDirectory();
                        return;
                    } catch (sudoError) {
                        showNotification(`Failed to delete with sudo: ${sudoError.message}`, "error");
                        return;
                    }
                }
            }

            showNotification(`Failed to delete: ${errorMsg}`, "error");
        }
    }

    async deleteMultiple(selectedElements) {
        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        let useSudoForAll = false;
        let deletedCount = 0;

        try {
            // Delete sequentially to keep backend simple and show progress in status
            for (const el of selectedElements) {
                const path = el.dataset.path;
                const name = el.dataset.name;
                
                try {
                    if (useSudoForAll) {
                        await window.go.main.App.DeleteRemotePathWithSudo(
                            this.currentSessionID,
                            path,
                        );
                    } else {
                        await window.go.main.App.DeleteRemotePath(
                            this.currentSessionID,
                            path,
                        );
                    }
                    deletedCount++;
                    console.log("Deleted:", path);
                } catch (itemError) {
                    const errorMsg = itemError.message || itemError.toString();
                    const isPermissionError = this.isPermissionError(errorMsg);

                    if (isPermissionError && !useSudoForAll) {
                        const useSudo = await this.confirmSudoOperation("delete remaining items", `${selectedElements.length - deletedCount} item(s)`);
                        if (useSudo) {
                            useSudoForAll = true;
                            // Retry this item with sudo
                            await window.go.main.App.DeleteRemotePathWithSudo(
                                this.currentSessionID,
                                path,
                            );
                            deletedCount++;
                            console.log("Deleted with sudo:", path);
                        } else {
                            throw new Error(`Cancelled - ${deletedCount} item(s) deleted before permission error`);
                        }
                    } else {
                        throw itemError;
                    }
                }
            }
            
            const sudoSuffix = useSudoForAll ? " with sudo" : "";
            showNotification(
                `Deleted ${deletedCount} item(s)${sudoSuffix}`,
                "success",
            );
            await this.refreshCurrentDirectory();
        } catch (error) {
            console.error("Failed to delete multiple:", error);
            showNotification(
                `Failed to delete items: ${error.message}`,
                "error",
            );
            // Still refresh to show what was deleted
            if (deletedCount > 0) {
                await this.refreshCurrentDirectory();
            }
        }
    }

    async downloadFile(filePath, fileName, isDir) {
        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        try {
            console.log(
                "Starting download:",
                filePath,
                `(${isDir ? "directory" : "file"})`,
            );

            // Use Wails runtime to show save dialog
            if (window.go?.main?.App?.SelectSaveLocation) {
                const localPath =
                    await window.go.main.App.SelectSaveLocation(fileName);
                if (!localPath) {
                    return; // User cancelled
                }

                const itemType = isDir ? "folder" : "file";
                
                // Show initial progress indicator
                this.showTransferProgress({
                    fileIndex: isDir ? 0 : 1,
                    totalFiles: 1,
                    percent: 0,
                    fileName: fileName,
                    isDownload: true,
                });

                // Call appropriate backend download method based on type
                // Progress events will be received via sftp-download-progress
                if (isDir) {
                    // Use the new directory download method for folders
                    await window.go.main.App.DownloadRemoteDirectory(
                        this.currentSessionID,
                        filePath,
                        localPath,
                    );
                } else {
                    // Use regular file download for individual files
                    await window.go.main.App.DownloadRemoteFile(
                        this.currentSessionID,
                        filePath,
                        localPath,
                    );
                }

                // Hide progress (may already be hidden by event handler)
                this.hideTransferProgress();

                showNotification(
                    `${itemType} "${fileName}" downloaded successfully`,
                    "success",
                );
            } else {
                showNotification("File save dialog not available", "error");
            }
        } catch (error) {
            console.error("Failed to download file:", error);
            this.hideTransferProgress();
            showNotification(`Failed to download: ${error.message}`, "error");
        }
    }

    async uploadToDirectory(targetPath) {
        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        try {
            console.log("Starting upload to:", targetPath);

            // Use Wails runtime to show file selection dialog
            if (window.go?.main?.App?.SelectFilesToUpload) {
                const localPaths =
                    await window.go.main.App.SelectFilesToUpload();
                if (!localPaths || localPaths.length === 0) {
                    return; // User cancelled
                }

                // Show progress header immediately
                this.showUploadProgress({
                    fileIndex: 0,
                    totalFiles: localPaths.length,
                    percent: 0,
                    fileName: "",
                });

                // Call backend upload method (progress arrives via events)
                try {
                    await window.go.main.App.UploadRemoteFiles(
                        this.currentSessionID,
                        localPaths,
                        targetPath,
                    );
                } catch (uploadError) {
                    const errorMsg = uploadError.message || uploadError.toString();
                    const isPermissionError = this.isPermissionError(errorMsg);

                    if (isPermissionError) {
                        this.hideUploadProgress();
                        const useSudo = await this.confirmSudoOperation("upload files", `${localPaths.length} file(s)`);
                        if (useSudo) {
                            this.showUploadProgress({
                                fileIndex: 0,
                                totalFiles: localPaths.length,
                                percent: 0,
                                fileName: "",
                            });
                            await window.go.main.App.UploadRemoteFilesWithSudo(
                                this.currentSessionID,
                                localPaths,
                                targetPath,
                            );
                        } else {
                            throw new Error("Upload cancelled - requires elevated permissions");
                        }
                    } else {
                        throw uploadError;
                    }
                }

                // Fallback: ensure the progress bar is cleared when call finishes
                this.hideUploadProgress();

                // Keep success toast
                showNotification(
                    `${localPaths.length} file(s) uploaded successfully`,
                    "success",
                );

                // Refresh the current directory to show uploaded files
                await this.refreshCurrentDirectory();
            } else {
                showNotification(
                    "File selection dialog not available",
                    "error",
                );
            }
        } catch (error) {
            console.error("Failed to upload files:", error);
            this.hideUploadProgress();
            showNotification(`Failed to upload: ${error.message}`, "error");
        }
    }

    async uploadFolderToDirectory(targetPath) {
        // This is similar to uploadToDirectory but for folder selection
        // We can implement this when the backend supports folder upload
        showNotification("Folder upload coming soon", "info");
    }

    async handleWebFileUpload(files) {
        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        try {
            console.log(
                "Starting web file upload of",
                files.length,
                "files",
            );

            // Show progress notification
            showNotification(`Uploading ${files.length} file(s)...`, "info");

            // Convert FileList to array and process each file
            const fileArray = Array.from(files);

            for (const file of fileArray) {
                console.log("Uploading file:", file.name);

                // Read file content as ArrayBuffer
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                // Convert to base64 for transmission
                const base64Content = btoa(String.fromCharCode(...uint8Array));

                // Calculate remote path
                const remotePath = `${this.currentRemotePath}/${file.name}`;

                // Begin progress for single file
                this.showUploadProgress({
                    fileIndex: 1,
                    totalFiles: 1,
                    percent: 0,
                    fileName: file.name,
                });
                
                // Upload via backend API that accepts base64 content (progress handled by events)
                try {
                    await window.go.main.App.UploadFileContent(
                        this.currentSessionID,
                        remotePath,
                        base64Content,
                    );
                } catch (uploadError) {
                    const errorMsg = uploadError.message || uploadError.toString();
                    const isPermissionError = this.isPermissionError(errorMsg);

                    if (isPermissionError) {
                        // Try with sudo
                        this.hideUploadProgress();
                        const useSudo = await this.confirmSudoOperation("upload file", file.name);
                        if (useSudo) {
                            try {
                                await window.go.main.App.UploadFileContentWithSudo(
                                    this.currentSessionID,
                                    remotePath,
                                    base64Content,
                                );
                            } catch (sudoError) {
                                throw new Error(`Sudo upload failed: ${sudoError.message || sudoError}`);
                            }
                        } else {
                            throw new Error(`Upload cancelled - "${file.name}" requires elevated permissions`);
                        }
                    } else {
                        throw uploadError;
                    }
                }
                
                // Fallback clear
                this.hideUploadProgress();
            }

            showNotification(
                `${files.length} file(s) uploaded successfully`,
                "success",
            );

            // Refresh the current directory to show uploaded files
            await this.refreshCurrentDirectory();
        } catch (error) {
            console.error("Failed to upload files:", error);
            this.hideUploadProgress();
            showNotification(`Failed to upload: ${error.message}`, "error");
        }
    }

    // File preview and editing methods
    async showFilePreview(filePath, fileName) {
        console.log("Showing file preview for:", fileName);

        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        // Check if a file preview is already open
        const existingPreview = document.getElementById("file-preview-overlay");
        if (existingPreview) {
            console.log("File preview already open, bringing to focus");
            // If the same file is being opened, just focus the existing preview
            if (
                this.currentEditingFile &&
                this.currentEditingFile.path === filePath
            ) {
                // Focus the Monaco editor if it exists
                if (this.monacoEditor) {
                    this.monacoEditor.focus();
                }
                return;
            } else {
                // Different file - close existing and open new one
                console.log(
                    "Different file requested, closing existing preview",
                );
                existingPreview.classList.remove("active");
                setTimeout(() => {
                    if (this.monacoEditor) {
                        this.monacoEditor.dispose();
                        this.monacoEditor = null;
                    }
                    // Clean up theme observer
                    if (this.themeObserver) {
                        this.themeObserver.disconnect();
                        this.themeObserver = null;
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
        showNotification(`Loading ${fileName}...`, "info");

        try {
            // Download file content for preview
            let content;
            let usedSudoForRead = false;
            
            try {
                content = await window.go.main.App.GetRemoteFileContent(
                    this.currentSessionID,
                    filePath,
                );
            } catch (readError) {
                const errorMsg = readError.message || readError.toString();
                const isPermissionError = this.isPermissionError(errorMsg);
                
                if (isPermissionError) {
                    console.log("Permission error reading file, trying with sudo");
                    // Try reading with sudo
                    content = await window.go.main.App.GetRemoteFileContentWithSudo(
                        this.currentSessionID,
                        filePath,
                    );
                    usedSudoForRead = true;
                    console.log("Successfully read file with sudo");
                } else {
                    throw readError;
                }
            }

            // Check if we received base64 content for a file that should be text
            const fileExtension = fileName.split(".").pop().toLowerCase();
            const shouldBeText = this.isTextFile(fileExtension);

            if (shouldBeText && this.isBase64String(content)) {
                console.log(
                    `Received base64 content for text file ${fileName}, attempting to decode...`,
                );
                try {
                    // Decode base64 to get the actual text content
                    content = atob(content);
                    console.log(
                        `Successfully decoded base64 content for ${fileName}`,
                    );
                } catch (decodeError) {
                    console.warn(
                        `Failed to decode base64 content for ${fileName}:`,
                        decodeError,
                    );
                    // Keep original base64 content as fallback
                }
            }

            // Track file in history
            await this.addToFileHistory(filePath, fileName);

            // Check if file is writable by the current user
            let canWrite = true;
            let requiresSudo = usedSudoForRead; // If we needed sudo to read, we'll need it to write
            
            if (!usedSudoForRead) {
                try {
                    const [writable, fileExists] = await window.go.main.App.CheckFileWritePermission(
                        this.currentSessionID,
                        filePath,
                    );
                    canWrite = writable;
                    requiresSudo = fileExists && !writable;
                    if (requiresSudo) {
                        console.log(`File "${fileName}" requires sudo to edit`);
                    }
                } catch (permError) {
                    console.warn("Could not check file permissions:", permError);
                    // Continue anyway, we'll handle errors on save
                }
            }

            // Show file preview panel
            this.showFilePreviewPanel(filePath, fileName, content, false, requiresSudo);

            // Update status to show file is loaded
            updateStatus(`Previewing: ${fileName}${requiresSudo ? " (read-only)" : ""}`);
        } catch (error) {
            console.error("Failed to load file content:", error);
            showNotification(`Failed to load file: ${error.message}`, "error");
        }
    }

    showFilePreviewPanel(filePath, fileName, content, forceTextMode = false, requiresSudo = false) {
        // Create a larger panel overlay similar to profile panel but bigger
        const overlay = document.createElement("div");
        overlay.id = "file-preview-overlay";
        overlay.className = "file-preview-overlay"; // Use consistent class name for animation

        const fileExtension = fileName.split(".").pop().toLowerCase();
        const isTextFile = forceTextMode || this.isTextFile(fileExtension);
        const isImageFile = !forceTextMode && this.isImageFile(fileExtension);

        // For files without extensions or common config files, suggest they might be text
        const mightBeText =
            !isTextFile &&
            !isImageFile &&
            (!fileExtension ||
                fileName.includes("rc") ||
                fileName.includes("config") ||
                fileName.startsWith(".") ||
                [
                    "dockerfile",
                    "makefile",
                    "license",
                    "readme",
                    "changelog",
                    "authors",
                    "contributing",
                ].includes(fileName.toLowerCase()));

        // Build sudo indicator if needed
        const sudoIndicator = requiresSudo ? `<span class="sudo-indicator" title="This file requires elevated permissions to save"><img src="./icons/lock.svg" class="svg-icon" alt=""> sudo</span>` : "";

        overlay.innerHTML = `
            <div class="profile-panel file-preview-panel">
                <div class="profile-panel-header">
                    <div class="profile-panel-title">
                        <span class="profile-panel-title-icon"><img src="./icons/${isImageFile ? "eye" : "document"}.svg" class="svg-icon" alt=""></span>
                        ${fileName}${forceTextMode ? " (Text Mode)" : ""}${sudoIndicator}
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
                    ${
                        isTextFile
                            ? this.createTextEditor(content, fileExtension)
                            : isImageFile
                              ? this.createImageViewer(content)
                              : this.createBinaryViewer(fileName)
                    }
                </div>
                <div class="profile-panel-footer">
                    ${
                        isTextFile
                            ? `
                        <button class="btn btn-secondary" id="file-preview-cancel">Cancel</button>
                        <button class="btn btn-secondary" id="file-download-btn">Download</button>
                        <button class="btn btn-primary${requiresSudo ? " sudo-save" : ""}" id="file-save-btn">${requiresSudo ? "Save with sudo" : "Save Changes"}</button>
                    `
                            : `
                        <button class="btn btn-secondary" id="file-preview-close-btn">Close</button>
                        <button class="btn btn-primary" id="file-download-btn">Download</button>
                    `
                    }
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
            forceTextMode: forceTextMode,
            requiresSudo: requiresSudo,
        };

        // Setup event handlers
        this.setupFilePreviewHandlers(overlay, isTextFile);

        // Show the panel with animation (same as profile panel)
        // Add a small delay to ensure DOM is ready for animation
        setTimeout(() => {
            overlay.classList.add("active");
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
            const openAsTextBtn = overlay.querySelector("#open-as-text-btn");
            if (openAsTextBtn) {
                openAsTextBtn.addEventListener("click", () => {
                    // Close current modal and reopen as text
                    overlay.classList.remove("active");
                    setTimeout(() => {
                        overlay.remove();
                        this.showFilePreviewPanel(
                            filePath,
                            fileName,
                            content,
                            true,
                        );
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
                        <button class="editor-btn" id="zoom-fit-btn" title="Fit to window"><img src="./icons/ruler.svg" class="svg-icon" alt="Fit"></button>
                        <button class="editor-btn" id="zoom-actual-btn" title="Actual size"><img src="./icons/search.svg" class="svg-icon" alt="Actual"></button>
                        <button class="editor-btn" id="zoom-in-btn" title="Zoom in"><img src="./icons/plus.svg" class="svg-icon" alt="+"></button>
                        <button class="editor-btn" id="zoom-out-btn" title="Zoom out"><img src="./icons/arrow-down.svg" class="svg-icon" alt="-"></button>
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
                    <div class="binary-icon">${mightBeText ? "" : ""}</div>
                    <h3>${mightBeText ? "Unknown Text File" : "Binary File"}</h3>
                    <p>Cannot preview "${fileName}"</p>
                    <p>${
                        mightBeText
                            ? "This file might be a text file without a recognized extension."
                            : "This appears to be a binary file that cannot be displayed."
                    }</p>
                    <div class="binary-actions">
                        <button class="btn btn-secondary" id="open-as-text-btn">
                            Open as Text
                        </button>
                        <p class="binary-hint">
                            ${
                                mightBeText
                                    ? "Try opening as text - common for config files like .bashrc, .vimrc, etc."
                                    : "Force open this file as text (useful for config files, scripts without extensions, etc.)"
                            }
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    isTextFile(extension) {
        const textExtensions = [
            "txt",
            "md",
            "json",
            "yaml",
            "yml",
            "xml",
            "html",
            "htm",
            "css",
            "js",
            "ts",
            "jsx",
            "tsx",
            "py",
            "java",
            "c",
            "cpp",
            "h",
            "hpp",
            "cs",
            "php",
            "rb",
            "go",
            "rs",
            "sh",
            "bash",
            "zsh",
            "fish",
            "ps1",
            "bat",
            "cmd",
            "sql",
            "r",
            "swift",
            "kt",
            "scala",
            "clj",
            "hs",
            "elm",
            "erl",
            "ex",
            "exs",
            "lua",
            "pl",
            "pm",
            "tcl",
            "vim",
            "conf",
            "config",
            "cfg",
            "ini",
            "toml",
            "properties",
            "env",
            "log",
            "csv",
            "tsv",
            "dockerfile",
            "makefile",
            "gradle",
            "pom",
            "sbt",
            // Additional common text file extensions
            "rc",
            "profile",
            "aliases",
            "exports",
            "functions",
            "path",
            "extra",
            "gitignore",
            "gitattributes",
            "gitmodules",
            "editorconfig",
            "eslintrc",
            "prettierrc",
            "babelrc",
            "npmrc",
            "yarnrc",
            "nvmrc",
            "rvmrc",
            "rbenv-version",
            "gemfile",
            "rakefile",
            "procfile",
            "cmakelists",
            "cmakecache",
            "requirements",
            "pipfile",
            "setup",
            "manifest",
            "license",
            "readme",
            "changelog",
            "authors",
            "contributors",
            "copying",
            "install",
            "news",
            "todo",
            "bugs",
            "thanks",
            "acknowledgments",
            "credits",
        ];
        return textExtensions.includes(extension.toLowerCase());
    }

    isImageFile(extension) {
        const imageExtensions = [
            "jpg",
            "jpeg",
            "png",
            "gif",
            "bmp",
            "svg",
            "webp",
            "ico",
        ];
        return imageExtensions.includes(extension.toLowerCase());
    }

    async initializeMonacoEditor(content, fileExtension) {
        // Load Monaco Editor dynamically
        if (!window.monaco) {
            await this.loadMonacoEditor();
        }

        const editorContainer = document.getElementById("monaco-editor");
        if (!editorContainer) return;

        // Determine language from file extension
        const language = this.getMonacoLanguage(fileExtension);

        // Create editor
        this.monacoEditor = window.monaco.editor.create(editorContainer, {
            value: content,
            language: language,
            theme:
                document.documentElement.getAttribute("data-theme") === "dark"
                    ? "vs-dark"
                    : "vs-light",
            fontSize: 14,
            lineNumbers: "on",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "off",
            tabSize: 2,
            insertSpaces: true,
        });

        // Mark as modified when content changes
        this.monacoEditor.onDidChangeModelContent(() => {
            this.currentEditingFile.modified = true;
            const saveBtn = document.getElementById("file-save-btn");
            if (saveBtn) {
                saveBtn.textContent = "Save Changes*";
                saveBtn.classList.add("modified");
            }
        });

        // Add theme change listener
        this.setupThemeChangeListener();
    }

    setupThemeChangeListener() {
        // Remove existing observer if it exists
        if (this.themeObserver) {
            this.themeObserver.disconnect();
        }

        // Create a MutationObserver to watch for theme changes on the document element
        this.themeObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (
                    mutation.type === "attributes" &&
                    mutation.attributeName === "data-theme"
                ) {
                    this.updateEditorTheme();
                }
            });
        });

        // Start observing the document element for attribute changes
        this.themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
    }

    updateEditorTheme() {
        if (this.monacoEditor && window.monaco) {
            const currentTheme =
                document.documentElement.getAttribute("data-theme");
            const newTheme = currentTheme === "dark" ? "vs-dark" : "vs-light";

            console.log("Updating Monaco Editor theme to:", newTheme);
            window.monaco.editor.setTheme(newTheme);
        }
    }

    async loadMonacoEditor() {
        return new Promise((resolve, reject) => {
            // Load Monaco Editor from CDN
            const script = document.createElement("script");
            script.src =
                "https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js";
            script.onload = () => {
                window.require.config({
                    paths: {
                        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs",
                    },
                });
                window.require(["vs/editor/editor.main"], () => {
                    resolve();
                });
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    getMonacoLanguage(extension) {
        const languageMap = {
            js: "javascript",
            ts: "typescript",
            jsx: "javascript",
            tsx: "typescript",
            json: "json",
            html: "html",
            htm: "html",
            css: "css",
            scss: "scss",
            sass: "sass",
            py: "python",
            java: "java",
            c: "c",
            cpp: "cpp",
            h: "c",
            hpp: "cpp",
            cs: "csharp",
            php: "php",
            rb: "ruby",
            go: "go",
            rs: "rust",
            sh: "shell",
            bash: "shell",
            zsh: "shell",
            fish: "shell",
            ps1: "powershell",
            sql: "sql",
            xml: "xml",
            yaml: "yaml",
            yml: "yaml",
            md: "markdown",
            swift: "swift",
            kt: "kotlin",
            scala: "scala",
            dockerfile: "dockerfile",
            toml: "toml",
            ini: "ini",
            conf: "ini",
            config: "ini",
        };
        return languageMap[extension.toLowerCase()] || "plaintext";
    }

    setupFilePreviewHandlers(overlay, isTextFile) {
        const closeBtn = overlay.querySelector(
            "#file-preview-close, #file-preview-close-btn",
        );
        const cancelBtn = overlay.querySelector("#file-preview-cancel");
        const downloadBtn = overlay.querySelector("#file-download-btn");
        const saveBtn = overlay.querySelector("#file-save-btn");
        const fullscreenBtn = overlay.querySelector("#file-preview-fullscreen");

        const closeModal = () => {
            // Start close animation
            overlay.classList.remove("active");

            // Remove from DOM after animation completes
            setTimeout(() => {
                if (this.monacoEditor) {
                    this.monacoEditor.dispose();
                    this.monacoEditor = null;
                }
                // Clean up theme observer
                if (this.themeObserver) {
                    this.themeObserver.disconnect();
                    this.themeObserver = null;
                }
                overlay.remove();
                this.currentEditingFile = null;

                // Remove the keyboard event listener when modal is closed
                document.removeEventListener("keydown", handleModalKeyboard);
            }, 300); // Match the CSS transition duration
        };

        const toggleFullscreen = () => {
            const panel = overlay.querySelector(".profile-panel");
            const isFullscreen = overlay.classList.contains("fullscreen");

            if (isFullscreen) {
                // Exit fullscreen
                overlay.classList.remove("fullscreen");
                fullscreenBtn.title = "Toggle Fullscreen";
                fullscreenBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7,14H5v5h5v-2H7V14z M5,10h2V7h3V5H5V10z M17,17h-3v2h5v-5h-2V17z M14,5v2h3v3h2V5H14z"/>
                    </svg>
                `;
            } else {
                // Enter fullscreen
                overlay.classList.add("fullscreen");
                fullscreenBtn.title = "Exit Fullscreen";
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
            if (!overlay.classList.contains("active")) return;

            // Escape - Close modal
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
                return;
            }

            // F11 - Toggle fullscreen
            if (e.key === "F11") {
                e.preventDefault();
                e.stopPropagation();
                toggleFullscreen();
                return;
            }

            // Ctrl+S or Cmd+S - Save file (for text files)
            if ((e.ctrlKey || e.metaKey) && e.key === "s" && isTextFile) {
                e.preventDefault();
                e.stopPropagation();
                this.saveFileChanges();
                return;
            }

            // Ctrl+D or Cmd+D - Download file
            if ((e.ctrlKey || e.metaKey) && e.key === "d") {
                e.preventDefault();
                e.stopPropagation();
                this.downloadFile(
                    this.currentEditingFile.path,
                    this.currentEditingFile.name,
                    false,
                );
                return;
            }

            // F3 - Close preview (same as opening it)
            if (e.key === "F3") {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
                return;
            }
        };

        // Add the keyboard event listener
        document.addEventListener("keydown", handleModalKeyboard);

        closeBtn?.addEventListener("click", closeModal);
        cancelBtn?.addEventListener("click", closeModal);
        fullscreenBtn?.addEventListener("click", toggleFullscreen);

        // Download button
        downloadBtn?.addEventListener("click", async () => {
            await this.downloadFile(
                this.currentEditingFile.path,
                this.currentEditingFile.name,
                false,
            );
        });

        // Save button (for text files)
        saveBtn?.addEventListener("click", async () => {
            await this.saveFileChanges();
        });

        // Close on overlay click
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });

        // Setup editor toolbar buttons
        if (isTextFile) {
            this.setupEditorToolbarButtons();
        }

        // Setup image viewer controls
        if (
            !isTextFile &&
            this.isImageFile(
                this.currentEditingFile.name.split(".").pop().toLowerCase(),
            )
        ) {
            this.setupImageViewerControls();
        }
    }

    setupEditorToolbarButtons() {
        // Word wrap toggle
        const wrapBtn = document.getElementById("wrap-text-btn");
        wrapBtn?.addEventListener("click", () => {
            if (this.monacoEditor) {
                const currentWrap = this.monacoEditor.getOption(
                    window.monaco.editor.EditorOption.wordWrap,
                );
                this.monacoEditor.updateOptions({
                    wordWrap: currentWrap === "off" ? "on" : "off",
                });
                wrapBtn.classList.toggle("active");
            }
        });

        // Find & Replace
        const findBtn = document.getElementById("find-replace-btn");
        findBtn?.addEventListener("click", () => {
            if (this.monacoEditor) {
                this.monacoEditor.trigger("keyboard", "actions.find");
            }
        });
    }

    async saveFileChanges() {
        if (!this.monacoEditor || !this.currentEditingFile) {
            showNotification("No file to save", "error");
            return;
        }

        const saveBtn = document.getElementById("file-save-btn");
        const originalBtnText = saveBtn?.textContent;

        try {
            const newContent = this.monacoEditor.getValue();

            // Update button to show saving state
            if (saveBtn) {
                saveBtn.textContent = "Saving...";
                saveBtn.disabled = true;
            }

            // Check if we need to use sudo
            if (this.currentEditingFile.requiresSudo) {
                // Try to save with sudo
                await window.go.main.App.UpdateRemoteFileContentWithSudo(
                    this.currentSessionID,
                    this.currentEditingFile.path,
                    newContent,
                );
                showNotification(
                    `File "${this.currentEditingFile.name}" saved with sudo`,
                    "success",
                );
            } else {
                // Try regular save first
                try {
                    await window.go.main.App.UpdateRemoteFileContent(
                        this.currentSessionID,
                        this.currentEditingFile.path,
                        newContent,
                    );
                    showNotification(
                        `File "${this.currentEditingFile.name}" saved successfully`,
                        "success",
                    );
                } catch (regularError) {
                    // Check if it's a permission error
                    const errorMsg = regularError.message || regularError.toString();
                    const isPermissionError = this.isPermissionError(errorMsg);

                    if (isPermissionError) {
                        // Offer to retry with sudo
                        console.log("Permission error detected, prompting for sudo retry");
                        const useSudo = await this.confirmSudoSave(this.currentEditingFile.name);
                        if (useSudo) {
                            await window.go.main.App.UpdateRemoteFileContentWithSudo(
                                this.currentSessionID,
                                this.currentEditingFile.path,
                                newContent,
                            );
                            // Update the file state to remember it needs sudo
                            this.currentEditingFile.requiresSudo = true;
                            // Update UI to show sudo indicator
                            this.updateSudoIndicator(true);
                            showNotification(
                                `File "${this.currentEditingFile.name}" saved with sudo`,
                                "success",
                            );
                        } else {
                            throw new Error("Save cancelled - file requires elevated permissions");
                        }
                    } else {
                        throw regularError;
                    }
                }
            }

            // Reset modified state
            this.currentEditingFile.modified = false;
            if (saveBtn) {
                saveBtn.textContent = this.currentEditingFile.requiresSudo ? "Save with sudo" : "Save Changes";
                saveBtn.classList.remove("modified");
                saveBtn.disabled = false;
                // Update button class for sudo styling
                if (this.currentEditingFile.requiresSudo) {
                    saveBtn.classList.add("sudo-save");
                }
            }
        } catch (error) {
            console.error("Failed to save file:", error);
            const errorMsg = error.message || error.toString();

            // Provide more helpful error messages
            let userMessage = `Failed to save file: ${errorMsg}`;
            if (errorMsg.includes("sudo")) {
                userMessage = `Could not save with sudo: ${errorMsg}. Make sure your user has sudo privileges without password, or use the terminal to save manually.`;
            } else if (errorMsg.includes("permission") || errorMsg.includes("denied")) {
                userMessage = `Permission denied: Cannot write to "${this.currentEditingFile.name}". The file may be owned by root or another user.`;
            }

            showNotification(userMessage, "error");

            // Restore button state
            if (saveBtn) {
                saveBtn.textContent = originalBtnText || "Save Changes";
                saveBtn.disabled = false;
            }
        }
    }

    // Update the sudo indicator in the file preview panel
    updateSudoIndicator(showSudo) {
        const titleElement = document.querySelector(".file-preview-panel .profile-panel-title");
        if (!titleElement) return;

        // Remove existing indicator if any
        const existingIndicator = titleElement.querySelector(".sudo-indicator");
        if (existingIndicator) {
            existingIndicator.remove();
        }

        // Add indicator if needed
        if (showSudo) {
            const indicator = document.createElement("span");
            indicator.className = "sudo-indicator";
            indicator.title = "This file requires elevated permissions to save";
            indicator.innerHTML = '<img src="./icons/lock.svg" class="svg-icon" alt=""> sudo';
            titleElement.appendChild(indicator);
        }

        // Also update the save button
        const saveBtn = document.getElementById("file-save-btn");
        if (saveBtn) {
            if (showSudo) {
                saveBtn.textContent = "Save with sudo";
                saveBtn.classList.add("sudo-save");
            } else {
                saveBtn.textContent = "Save Changes";
                saveBtn.classList.remove("sudo-save");
            }
        }
    }

    // Check if an error message indicates a permission problem
    isPermissionError(errorMsg) {
        const lowerMsg = errorMsg.toLowerCase();
        return lowerMsg.includes("permission") ||
            lowerMsg.includes("denied") ||
            lowerMsg.includes("access") ||
            lowerMsg.includes("not permitted") ||
            lowerMsg.includes("operation not allowed") ||
            lowerMsg.includes("read-only") ||
            lowerMsg.includes("cannot create") ||
            lowerMsg.includes("cannot open") ||
            lowerMsg.includes("failed to create");
    }

    // Show confirmation dialog for sudo operation (generic)
    async confirmSudoOperation(operation, itemName) {
        if (window.modal) {
            const result = await window.modal.show({
                title: "Permission Required",
                message: `Cannot ${operation} "${itemName}" - elevated permissions required.`,
                icon: '<img src="./icons/lock.svg" class="svg-icon" alt="">',
                content: `
                    <p style="margin-top: 12px; color: var(--text-secondary);">
                        Do you want to ${operation} using sudo?
                    </p>
                    <p style="margin-top: 8px; font-size: 12px; color: var(--text-tertiary);">
                        Note: This requires your user to have sudo privileges.
                    </p>
                `,
                buttons: [
                    {
                        text: "Cancel",
                        style: "secondary",
                        action: "cancel",
                    },
                    {
                        text: `${operation.charAt(0).toUpperCase() + operation.slice(1)} with sudo`,
                        style: "primary",
                        action: "confirm",
                    },
                ],
            });
            return result === "confirm";
        } else {
            return confirm(`Cannot ${operation} "${itemName}". Use sudo?`);
        }
    }

    // Show confirmation dialog for sudo save
    async confirmSudoSave(fileName) {
        if (window.modal) {
            const result = await window.modal.show({
                title: "Permission Required",
                message: `The file "${fileName}" requires elevated permissions to save.`,
                icon: '<img src="./icons/lock.svg" class="svg-icon" alt="">',
                content: `
                    <p style="margin-top: 12px; color: var(--text-secondary);">
                        Do you want to save this file using sudo?
                    </p>
                    <p style="margin-top: 8px; font-size: 12px; color: var(--text-tertiary);">
                        Note: This requires your user to have sudo privileges.
                    </p>
                `,
                buttons: [
                    {
                        text: "Cancel",
                        style: "secondary",
                        action: "cancel",
                    },
                    {
                        text: "Save with sudo",
                        style: "primary",
                        action: "confirm",
                    },
                ],
            });
            return result === "confirm";
        } else {
            // Fallback to confirm dialog
            return confirm(`The file "${fileName}" requires elevated permissions. Save with sudo?`);
        }
    }

    showDirectoryProperties(dirPath, dirName) {
        console.log("Showing directory properties for:", dirName);

        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        // Use the existing modal component for directory properties
        if (window.modal) {
            window.modal.show({
                title: "Directory Properties",
                message: `Properties for: ${dirName}`,
                icon: '<img src="./icons/folder.svg" class="svg-icon" alt="">',
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
                    { text: "Close", style: "secondary", action: "cancel" },
                ],
            });
        } else {
            // Fallback if modal is not available
            showNotification(`Directory: ${dirPath}`, "info");
        }
    }

    showFileProperties(filePath, fileName) {
        console.log("Showing file properties for:", fileName);

        if (!this.currentSessionID) {
            showNotification("No active session", "error");
            return;
        }

        // Get file extension for additional info
        const extension = fileName.toLowerCase().split(".").pop();
        const isTextFile = this.isTextFile(extension);
        const isImageFile = this.isImageFile(extension);

        // Use the existing modal component for file properties
        if (window.modal) {
            window.modal.show({
                title: "File Properties",
                message: `Properties for: ${fileName}`,
                icon: '<img src="./icons/document.svg" class="svg-icon" alt="">',
                content: `
                    <div style="margin-top: 16px;">
                        <div class="property-row">
                            <label class="property-label">Name:</label>
                            <span class="property-value">${fileName}</span>
                        </div>
                        <div class="property-row">
                            <label class="property-label">Path:</label>
                            <span class="property-value">${filePath}</span>
                        </div>
                        <div class="property-row">
                            <label class="property-label">Type:</label>
                            <span class="property-value">File</span>
                        </div>
                        <div class="property-row">
                            <label class="property-label">Extension:</label>
                            <span class="property-value">${extension || "No extension"}</span>
                        </div>
                        <div class="property-row">
                            <label class="property-label">File Type:</label>
                            <span class="property-value">${isTextFile ? "Text File" : isImageFile ? "Image File" : "Binary File"}</span>
                        </div>
                        <div class="property-row">
                            <label class="property-label">Remote Server:</label>
                            <span class="property-value">SSH Connection (Session: ${this.currentSessionID})</span>
                        </div>
                        <div class="property-actions" style="margin-top: 20px; display: flex; gap: 8px;">
                            <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${filePath}'); showNotification('Path copied to clipboard', 'success');">
                                Copy Path
                            </button>
                            ${
                                isTextFile
                                    ? `<button class="btn btn-primary" onclick="window.remoteExplorerManager.showFilePreview('${filePath}', '${fileName}'); window.modal.hide();">
                                Preview File
                            </button>`
                                    : ""
                            }
                            <button class="btn btn-secondary" onclick="window.remoteExplorerManager.downloadFile('${filePath}', '${fileName}', false); window.modal.hide();">
                                Download
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
                    { text: "Close", style: "secondary", action: "cancel" },
                ],
            });
        } else {
            // Fallback if modal is not available
            showNotification(`File: ${filePath}`, "info");
        }
    }

    setupImageViewerControls() {
        const zoomFitBtn = document.getElementById("zoom-fit-btn");
        const zoomActualBtn = document.getElementById("zoom-actual-btn");
        const zoomInBtn = document.getElementById("zoom-in-btn");
        const zoomOutBtn = document.getElementById("zoom-out-btn");
        const previewImage = document.querySelector(".preview-image");

        if (!previewImage) return;

        let currentZoom = 1;
        const minZoom = 0.1;
        const maxZoom = 5;
        const zoomStep = 0.2;

        const updateImageZoom = (zoom) => {
            currentZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
            previewImage.style.transform = `scale(${currentZoom})`;
            previewImage.style.transformOrigin = "center center";

            // Update button states
            zoomInBtn.disabled = currentZoom >= maxZoom;
            zoomOutBtn.disabled = currentZoom <= minZoom;
        };

        const fitToWindow = () => {
            const container = previewImage.parentElement;
            const containerRect = container.getBoundingClientRect();
            const imageRect = previewImage.getBoundingClientRect();

            // Reset scale to get natural dimensions
            previewImage.style.transform = "scale(1)";
            const naturalRect = previewImage.getBoundingClientRect();

            // Calculate scale to fit
            const scaleX = (containerRect.width - 40) / naturalRect.width; // 40px padding
            const scaleY = (containerRect.height - 40) / naturalRect.height;
            const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%

            updateImageZoom(scale);
        };

        // Button event listeners
        zoomFitBtn?.addEventListener("click", fitToWindow);

        zoomActualBtn?.addEventListener("click", () => {
            updateImageZoom(1);
        });

        zoomInBtn?.addEventListener("click", () => {
            updateImageZoom(currentZoom + zoomStep);
        });

        zoomOutBtn?.addEventListener("click", () => {
            updateImageZoom(currentZoom - zoomStep);
        });

        // Mouse wheel zoom
        previewImage.addEventListener("wheel", (e) => {
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
            "dockerfile",
            "makefile",
            "rakefile",
            "gemfile",
            "procfile",
            "vagrantfile",
            "license",
            "readme",
            "changelog",
            "authors",
            "contributors",
            "copying",
            "install",
            "news",
            "todo",
            "bugs",
            "thanks",
            "acknowledgments",
            "credits",
        ];

        // Check exact matches
        if (commonTextFiles.includes(lowercaseName)) {
            return true;
        }

        // Files starting with dots (hidden config files)
        if (fileName.startsWith(".") && !fileName.includes(".")) {
            return true;
        }

        // Files containing common config patterns
        const configPatterns = [
            "rc",
            "config",
            "conf",
            "profile",
            "aliases",
            "exports",
            "functions",
            "bashrc",
            "zshrc",
            "vimrc",
            "tmux.conf",
            "ssh_config",
            "hosts",
        ];

        return configPatterns.some((pattern) =>
            lowercaseName.includes(pattern),
        );
    }

    // Helper method to detect if a string is base64 encoded
    isBase64String(str) {
        // Basic checks for base64 content
        if (!str || typeof str !== "string") {
            return false;
        }

        // Base64 strings should only contain valid base64 characters
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        if (!base64Regex.test(str)) {
            return false;
        }

        // Base64 strings should be divisible by 4 (with padding)
        if (str.length % 4 !== 0) {
            return false;
        }

        // Additional check: base64 strings usually don't contain normal text patterns
        // If it looks like normal text, it's probably not base64
        const hasNormalTextPattern =
            /\s+/.test(str) || // Contains whitespace
            /[a-z]{3,}/.test(str.toLowerCase()) || // Contains lowercase words
            str.includes("\n") ||
            str.includes("\r"); // Contains line breaks

        if (hasNormalTextPattern && str.length < 200) {
            return false; // Short strings with text patterns are likely not base64
        }

        // For longer strings or strings without obvious text patterns,
        // they might be base64
        return str.length > 50; // Only consider as base64 if reasonably long
    }

    // File History Management Methods
    async addToFileHistory(filePath, fileName) {
        const activeTab = this.tabsManager.getActiveTab();

        if (!activeTab) {
            console.log("No active tab for file history");
            return;
        }

        if (!activeTab.profileId) {
            console.log(
                "Tab was not created from a profile, skipping file history",
            );
            return;
        }

        // Get the profile from backend
        let profile;
        try {
            profile = await window.go.main.App.GetProfileByIDAPI(
                activeTab.profileId,
            );
        } catch (error) {
            console.error("Failed to load profile for file history:", error);
            return;
        }

        // Initialize history if it doesn't exist
        if (!profile.fileHistory) {
            profile.fileHistory = [];
        }

        const now = new Date();
        const existingIndex = profile.fileHistory.findIndex(
            (item) => item.path === filePath,
        );

        if (existingIndex >= 0) {
            // Update existing entry
            const existingItem = profile.fileHistory[existingIndex];
            existingItem.accessCount++;
            existingItem.lastAccessed = now;

            // Move to front of array for recent access
            profile.fileHistory.splice(existingIndex, 1);
            profile.fileHistory.unshift(existingItem);
        } else {
            // Add new entry
            const historyItem = {
                path: filePath,
                fileName: fileName,
                accessCount: 1,
                firstAccessed: now,
                lastAccessed: now,
            };

            profile.fileHistory.unshift(historyItem);
        }

        // Limit history size
        if (profile.fileHistory.length > this.maxHistoryItems) {
            profile.fileHistory = profile.fileHistory.slice(
                0,
                this.maxHistoryItems,
            );
        }

        // Save the updated profile
        try {
            await this.saveProfileHistory(profile);
            console.log(
                `Added ${fileName} to file history. Total: ${profile.fileHistory.length}`,
            );

            // Update history button count
            await this.updateHistoryButtonCount();
        } catch (error) {
            console.error("Failed to save file history:", error);
        }

        console.log(
            `Added to history: ${fileName} (${profile.fileHistory.length} total files)`,
        );
    }

    async getFileHistory() {
        const activeTab = this.tabsManager.getActiveTab();
        if (!activeTab || !activeTab.profileId) {
            return [];
        }

        try {
            const profile = await window.go.main.App.GetProfileByIDAPI(
                activeTab.profileId,
            );
            if (!profile || !profile.fileHistory) {
                return [];
            }

            // Sort by access count (most used first), then by last accessed
            return profile.fileHistory
                .slice() // Create a copy
                .sort((a, b) => {
                    if (a.accessCount !== b.accessCount) {
                        return b.accessCount - a.accessCount; // Higher access count first
                    }
                    return new Date(b.lastAccessed) - new Date(a.lastAccessed); // More recent first
                });
        } catch (error) {
            console.error("Failed to load profile for file history:", error);
            return [];
        }
    }

    async saveProfileHistory(profile) {
        try {
            // Use the backend SaveProfile method
            await window.go.main.App.SaveProfile(profile);
            console.log(`Profile file history saved: ${profile.name}`);
        } catch (error) {
            console.error("Failed to save profile history:", error);
            showNotification("Failed to save file history", "error");
        }
    }

    async showFileHistory() {
        console.log("Showing file history");

        const history = await this.getFileHistory();

        if (history.length === 0) {
            showNotification("No file history available", "info");
            return;
        }

        // Create history content
        const historyContent = this.createHistoryContent(history);

        // Use the existing modal component
        if (window.modal) {
            window.modal
                .show({
                    title: "File History",
                    message: `Recently opened files (${history.length} files)`,
                    icon: '<img src="./icons/files.svg" class="svg-icon" alt="">',
                    content: historyContent,
                    buttons: [
                        {
                            text: "Clear History",
                            style: "secondary",
                            action: "custom",
                            handler: () => {
                                this.clearFileHistory();
                                window.modal.hide();
                            },
                        },
                        { text: "Close", style: "primary", action: "cancel" },
                    ],
                })
                .then((result) => {
                    // Setup click handlers for history items
                    setTimeout(() => {
                        this.setupHistoryClickHandlers();
                    }, 100);
                });
        }
    }

    createHistoryContent(history) {
        return `
            <div class="file-history-container">
                <div class="history-stats">
                    <span class="history-stat">Total files: ${history.length}</span>
                    <span class="history-stat">Most used: ${history[0]?.fileName || "None"} (${history[0]?.accessCount || 0} times)</span>
                </div>
                <div class="history-list">
                    ${history
                        .map(
                            (item, index) => `
                        <div class="history-item" data-path="${item.path}" data-filename="${item.fileName}">
                            <div class="history-item-content">
                                <div class="history-item-main">
                                    <div class="history-file-icon">${this.getFileIconForExtension(item.fileName)}</div>
                                    <div class="history-file-details">
                                        <div class="history-file-name">${item.fileName}</div>
                                        <div class="history-file-path">${item.path}</div>
                                    </div>
                                </div>
                                <div class="history-item-stats">
                                    <div class="history-access-count">${item.accessCount} times</div>
                                    <div class="history-last-accessed">${this.formatRelativeTime(item.lastAccessed)}</div>
                                </div>
                            </div>
                        </div>
                    `,
                        )
                        .join("")}
                </div>
            </div>
            <style>
                .file-history-container {
                    margin-top: 16px;
                    max-height: 400px;
                    overflow-y: auto;
                }
                .history-stats {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 12px;
                    padding: 8px 12px;
                    background: var(--bg-tertiary);
                    border-radius: 4px;
                    font-size: 12px;
                }
                .history-stat {
                    color: var(--text-secondary);
                }
                .history-list {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .history-item {
                    padding: 8px 12px;
                    background: var(--bg-secondary);
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    border: 1px solid transparent;
                }
                .history-item:hover {
                    background: var(--hover-bg);
                    border-color: var(--accent-color);
                }
                .history-item-content {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .history-item-main {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 1;
                    min-width: 0;
                }
                .history-file-icon {
                    font-size: 16px;
                    width: 20px;
                    text-align: center;
                    flex-shrink: 0;
                }
                .history-file-details {
                    flex: 1;
                    min-width: 0;
                }
                .history-file-name {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .history-file-path {
                    font-size: 11px;
                    color: var(--text-tertiary);
                    font-family: monospace;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-top: 2px;
                }
                .history-item-stats {
                    text-align: right;
                    flex-shrink: 0;
                }
                .history-access-count {
                    font-size: 12px;
                    color: var(--accent-color);
                    font-weight: 600;
                }
                .history-last-accessed {
                    font-size: 10px;
                    color: var(--text-tertiary);
                    margin-top: 2px;
                }
            </style>
        `;
    }

    setupHistoryClickHandlers() {
        const historyItems = document.querySelectorAll(".history-item");
        historyItems.forEach((item) => {
            item.addEventListener("click", () => {
                const filePath = item.dataset.path;
                const fileName = item.dataset.filename;

                // Close modal and open file
                window.modal.hide();
                setTimeout(() => {
                    this.showFilePreview(filePath, fileName);
                }, 300);
            });
        });
    }

    getFileIconForExtension(fileName) {
        // Simple version of getFileIcon for history display
        const svgIcon = (name) => `<img src="./icons/${name}.svg" class="svg-icon file-icon" alt="">`;
        const ext = fileName.split(".").pop().toLowerCase();
        const iconMap = {
            txt: "document",
            md: "document",
            log: "document",
            js: "text",
            ts: "text",
            py: "text",
            sh: "terminal",
            html: "globe",
            css: "palette",
            json: "clipboard",
            jpg: "eye",
            png: "eye",
            gif: "eye",
            pdf: "page",
            zip: "files",
        };
        return iconMap[ext] ? svgIcon(iconMap[ext]) : svgIcon("document");
    }

    formatRelativeTime(date) {
        const now = new Date();
        const diff = now - new Date(date);
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (minutes < 1) return "Just now";
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return new Date(date).toLocaleDateString();
    }

    async clearFileHistory() {
        console.log("Clearing file history...");

        const activeTab = this.tabsManager.getActiveTab();
        if (!activeTab || !activeTab.profileId) {
            console.log("No active tab or profile ID");
            showNotification("No active profile found", "error");
            return;
        }

        console.log("Active tab profile ID:", activeTab.profileId);

        try {
            const profile = await window.go.main.App.GetProfileByIDAPI(
                activeTab.profileId,
            );
            if (profile) {
                console.log(
                    "Current history length:",
                    profile.fileHistory?.length || 0,
                );

                profile.fileHistory = [];
                await this.saveProfileHistory(profile);

                console.log("History cleared and saved");

                // Update history button count
                await this.updateHistoryButtonCount();

                showNotification("File history cleared", "success");
            } else {
                console.log("Profile not found");
                showNotification("Profile not found", "error");
            }
        } catch (error) {
            console.error("Failed to clear file history:", error);
            showNotification("Failed to clear file history", "error");
        }
    }

    async showFileHistoryView() {
        console.log("Showing file history view");

        if (!this.currentSessionID) {
            showNotification("No active SSH session", "info");
            return;
        }

        const history = await this.getFileHistory();
        const sidebarContent = document.getElementById("sidebar-content");

        if (!sidebarContent) {
            console.error("Sidebar content not found");
            return;
        }

        // Add class to indicate we're in history view
        sidebarContent.className = "history-view-active";

        // Create back button header without emojis
        const backButton = `
            <div class="virtual-folder-header">
                <button class="back-btn" onclick="window.remoteExplorerManager.showFilesView()">← Back to Files</button>
                <h3>File History</h3>
            </div>
        `;

        if (history.length === 0) {
            sidebarContent.innerHTML =
                backButton +
                `
                <div class="empty-state">
                    <div class="empty-state-title">No File History</div>
                    <div class="empty-state-description">Files you open will appear here for quick access</div>
                </div>
            `;
            return;
        }

        // Create history list HTML showing file paths
        const historyHTML = history
            .map((entry) => {
                const icon = this.getFileIconForExtension(entry.fileName);
                const relativeTime = this.formatRelativeTime(
                    new Date(entry.lastAccessed),
                );
                const accessText =
                    entry.accessCount === 1
                        ? "1 time"
                        : `${entry.accessCount} times`;

                // Show the filename first, then path under
                const displayPath = entry.path;
                const fileName = entry.fileName;

                return `
                <div class="tree-item virtual-profile history-item" data-file-path="${entry.path}" data-file-name="${entry.fileName}" title="Click to open ${fileName}">
                    <div class="tree-item-content">
                        <span class="tree-item-icon">${icon}</span>
                        <div class="file-info">
                            <div class="tree-item-text">${fileName}</div>
                            <div class="file-path-secondary">${displayPath}</div>
                        </div>
                        <div class="history-meta">
                            <div class="usage-count">${accessText}</div>
                            <div class="last-accessed">${relativeTime}</div>
                        </div>
                        <div class="history-actions-inline">
                            <button class="action-btn remove-btn" onclick="window.remoteExplorerManager.removeFromHistory('${entry.path.replace(/'/g, "\\'")}'); event.stopPropagation();" title="Remove from history">×</button>
                        </div>
                    </div>
                </div>
            `;
            })
            .join("");

        const clearButton = `
            <div class="history-actions">
                <button class="btn btn-secondary" onclick="window.remoteExplorerManager.clearFileHistoryAndRefresh()">Clear History</button>
            </div>
        `;

        sidebarContent.innerHTML = backButton + historyHTML + clearButton;

        // Setup click handlers for history items
        this.setupHistoryItemClickHandlers();
    }

    async showFilesView() {
        console.log("Returning to files view");

        // Remove history view class
        const sidebarContent = document.getElementById("sidebar-content");
        if (sidebarContent) {
            sidebarContent.className = "";
        }

        // Restore the file explorer UI
        this.renderFileExplorerUI();

        // Reload current directory if we have session and path
        if (this.currentSessionID && this.currentRemotePath) {
            try {
                await this.loadDirectoryContent(this.currentRemotePath);
            } catch (error) {
                console.error("Failed to load directory:", error);
                this.showErrorState(
                    `Failed to load directory: ${error.message}`,
                );
            }
        } else {
            this.showSelectSSHMessage();
        }
    }

    setupHistoryItemClickHandlers() {
        const historyItems = document.querySelectorAll(
            ".tree-item[data-file-path]",
        );
        historyItems.forEach((item) => {
            item.addEventListener("click", async () => {
                const filePath = item.dataset.filePath;
                const fileName = item.dataset.fileName;

                if (filePath && fileName) {
                    await this.openFileFromHistory(filePath, fileName);
                }
            });
        });
    }

    async clearFileHistoryAndRefresh() {
        console.log("Clear history button clicked");

        try {
            // Use Modal.js for confirmation
            const result = await modal.confirmDelete(
                "all file history",
                "file history",
            );

            if (result === "confirm") {
                console.log("User confirmed, clearing history...");

                await this.clearFileHistory();
                console.log("History cleared, refreshing view...");

                await this.showFileHistoryView(); // Refresh the view
                console.log("View refreshed, updating count...");

                await this.updateHistoryButtonCount(); // Update the count badge
                console.log("Count updated, done!");

                showNotification("File history cleared", "success");
            } else {
                console.log("User cancelled clear operation");
            }
        } catch (error) {
            console.error("Error during clear and refresh:", error);
            showNotification("Failed to clear history", "error");
        }
    }

    async openFileFromHistory(filePath, fileName) {
        try {
            console.log("Opening file from history:", filePath);

            if (!this.currentSessionID) {
                showNotification("No active SSH session", "error");
                return;
            }

            // Get the directory containing the file
            const dirPath = this.getParentPath(filePath);
            console.log("File directory:", dirPath);

            // Return to files view first
            await this.showFilesView();

            // Wait a moment for the UI to be ready
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Navigate to the directory containing the file
            console.log("Navigating to directory:", dirPath);
            await this.navigateToPath(dirPath);

            // Wait for the directory to load and file list to update
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Highlight the file in the list if possible
            this.highlightFileInList(fileName);

            // Open the file preview
            await this.showFilePreview(filePath, fileName);

            showNotification(`Opened ${fileName}`, "success");
        } catch (error) {
            console.error("Failed to open file from history:", error);
            showNotification(`Failed to open file: ${error.message}`, "error");
        }
    }

    highlightFileInList(fileName) {
        // Find and highlight the file in the current file list
        const fileItems = document.querySelectorAll(".file-item");
        fileItems.forEach((item) => {
            const itemName = item.dataset.name;
            if (itemName === fileName) {
                // Clear previous selections
                document
                    .querySelectorAll(".file-item.selected")
                    .forEach((selected) => {
                        selected.classList.remove("selected");
                    });
                // Highlight this file
                item.classList.add("selected");
                // Scroll into view if needed
                item.scrollIntoView({ behavior: "smooth", block: "center" });
                console.log("Highlighted file in list:", fileName);
            }
        });
    }

    async removeFromHistory(filePath) {
        try {
            const activeTab = this.tabsManager.getActiveTab();
            if (!activeTab || !activeTab.profileId) {
                return;
            }

            const profile = await window.go.main.App.GetProfileByIDAPI(
                activeTab.profileId,
            );
            if (profile && profile.fileHistory) {
                // Remove the specific file from history
                profile.fileHistory = profile.fileHistory.filter(
                    (entry) => entry.path !== filePath,
                );
                await this.saveProfileHistory(profile);

                // Update history button count
                await this.updateHistoryButtonCount();

                // Refresh the history view
                await this.showFileHistoryView();
                showNotification("Removed from history", "success");
            }
        } catch (error) {
            console.error("Failed to remove from history:", error);
            showNotification("Failed to remove from history", "error");
        }
    }

    // Live Search Methods (now handled by LiveSearch component)
    // Methods moved to LiveSearch utility class for reusability

    updateFileList(files, path = null) {
        // Clear any active search when showing new directory
        if (this.liveSearch) {
            this.liveSearch.clearSearch();
        }

        const container = document.querySelector(".remote-files-container");
        if (!container) {
            console.error("Remote files container not found");
            return;
        }

        // Store the current file list for reference
        this.currentFileList = files;

        // Update breadcrumbs if path is provided
        if (path !== null) {
            this.updateBreadcrumbs(path);
        }

        // Clear current content
        container.innerHTML = "";

        // Create file list
        const fileList = document.createElement("div");
        fileList.className = "file-list";

        if (!files || files.length === 0) {
            fileList.innerHTML =
                '<div class="empty-state">No files in this directory</div>';
            container.appendChild(fileList);
            return;
        }

        // Sort files: directories first, then files, both alphabetically
        const sortedFiles = [...files].sort((a, b) => {
            // Parent directory always comes first
            if (a.name === "..") return -1;
            if (b.name === "..") return 1;

            // Directories before files
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;

            // Alphabetical within same type
            return a.name.localeCompare(b.name);
        });

        // Create file items
        sortedFiles.forEach((file, index) => {
            const fileItem = this.createFileItem(file, index);
            fileList.appendChild(fileItem);
        });

        container.appendChild(fileList);

        // Select first non-parent item by default
        const firstSelectableItem = fileList.querySelector(
            '.file-item:not([data-is-parent="true"])',
        );
        if (firstSelectableItem) {
            firstSelectableItem.classList.add("selected");
        }
    }
}
