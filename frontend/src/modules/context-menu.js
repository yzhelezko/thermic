// Context menu management module
import { WriteToShell } from '../../wailsjs/go/main/App';
import { showNotification } from './utils.js';
import { modal } from '../components/Modal.js';

export class ContextMenuManager {
    constructor(terminalManager, remoteExplorerManager = null) {
        this.terminalManager = terminalManager;
        this.remoteExplorerManager = remoteExplorerManager;
        this.activeMenu = null;
        this.currentTarget = null;
        this.selectedSidebarItem = null;
        // Add tab context properties
        this.currentTab = null;
        this.currentTabData = null;
        // File explorer context properties
        this.currentFileItem = null;
        this.currentFileData = null;
        // Context menu settings
        this.selectToCopyEnabled = false;
    }

    async init() {
        await this.loadContextMenuSettings();
        this.bindEvents();
    }

    async loadContextMenuSettings() {
        try {
            this.selectToCopyEnabled = await window.go.main.App.ConfigGet("EnableSelectToCopy");
        } catch (error) {
            console.error('Error loading context menu settings:', error);
            // Use defaults if loading fails
            this.selectToCopyEnabled = false;
        }
    }

    async updateContextMenuSettings() {
        await this.loadContextMenuSettings();
        // Rebind events if select-to-copy-paste setting changed
        this.bindTerminalEvents();
    }

    bindTerminalEvents() {
        // Remove existing terminal event listeners by storing references and removing them
        const terminalContainer = document.querySelector('.terminal-container');
        if (!terminalContainer) return;

        // Remove existing listeners if they exist
        if (this.terminalMouseUpHandler) {
            terminalContainer.removeEventListener('mouseup', this.terminalMouseUpHandler);
        }
        if (this.terminalContextMenuHandler) {
            terminalContainer.removeEventListener('contextmenu', this.terminalContextMenuHandler);
        }

        if (this.selectToCopyEnabled) {
            // Select-to-copy mode: auto-copy on selection, right-click to paste
            this.terminalMouseUpHandler = async (e) => {
                // Only handle if we're not in the middle of dragging/selecting
                if (e.button !== 0) return; // Only handle left mouse button release
                
                // Small delay to ensure selection is complete
                setTimeout(async () => {
                    if (this.terminalManager.terminal && this.terminalManager.terminal.hasSelection()) {
                        const selectedText = this.terminalManager.terminal.getSelection();
                        if (selectedText && selectedText.trim().length > 0) {
                            try {
                                await navigator.clipboard.writeText(selectedText);
                                console.log('Auto-copied:', selectedText.substring(0, 50) + '...');
                            } catch (error) {
                                console.error('Failed to copy selected text:', error);
                            }
                        }
                    }
                }, 100);
            };

            this.terminalContextMenuHandler = async (e) => {
                e.preventDefault();
                // Right-click to paste - only if connected and has session
                if (this.terminalManager.isConnected && this.terminalManager.sessionId) {
                    try {
                        const text = await navigator.clipboard.readText();
                        if (text && text.trim()) {
                            await WriteToShell(this.terminalManager.sessionId, text);
                            console.log('Pasted:', text.substring(0, 50) + '...');
                        }
                    } catch (error) {
                        console.error('Failed to paste text:', error);
                    }
                }
            };

            terminalContainer.addEventListener('mouseup', this.terminalMouseUpHandler);
            terminalContainer.addEventListener('contextmenu', this.terminalContextMenuHandler);
        } else {
            // Standard context menu mode
            this.terminalContextMenuHandler = (e) => {
                e.preventDefault();
                this.showTerminalContextMenu(e);
            };

            terminalContainer.addEventListener('contextmenu', this.terminalContextMenuHandler);
        }
    }

    bindEvents() {
        // Prevent default context menu globally
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Global click to hide context menus
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideAllMenus();
            }
        });

        // Bind terminal events
        this.bindTerminalEvents();

        // Sidebar context menu
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                
                // Check if we're in history view - don't show context menus there
                const sidebarContent = document.getElementById('sidebar-content');
                if (sidebarContent && sidebarContent.classList.contains('history-view-active')) {
                    return; // Don't show any context menu in history view
                }
                
                const treeItem = e.target.closest('.tree-item');
                if (treeItem) {
                    this.selectSidebarItem(treeItem);
                    this.showSidebarContextMenu(e, treeItem);
                }
            });
        }

        // Context menu item clicks
        document.addEventListener('click', (e) => {
            const menuItem = e.target.closest('.context-menu-item');
            if (menuItem && !menuItem.classList.contains('disabled')) {
                const action = menuItem.dataset.action;
                this.handleMenuAction(action);
                this.hideAllMenus();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideAllMenus();
            }
        });
    }

    showTerminalContextMenu(event) {
        const menu = document.getElementById('terminal-context-menu');
        if (!menu) return;

        this.hideAllMenus();

        // Update menu items based on terminal state
        this.updateTerminalMenuItems(menu);

        // Position and show menu
        this.positionMenu(menu, event.clientX, event.clientY);
        this.showMenu(menu);
        this.activeMenu = menu;
    }

    showSidebarContextMenu(event, treeItem) {
        const menu = document.getElementById('sidebar-context-menu');
        if (!menu) return;

        this.hideAllMenus();
        this.currentTarget = treeItem;

        // Update menu items based on sidebar item type
        this.updateSidebarMenuItems(menu, treeItem);

        // Position and show menu
        this.positionMenu(menu, event.clientX, event.clientY);
        this.showMenu(menu);
        this.activeMenu = menu;
    }

    showRootContextMenu(event) {
        const menu = document.getElementById('sidebar-context-menu');
        if (!menu) return;

        this.hideAllMenus();
        this.currentTarget = null; // No specific target - root context

        // Update menu items for root context (only show create options)
        this.updateRootMenuItems(menu);

        // Position and show menu
        this.positionMenu(menu, event.clientX, event.clientY);
        this.showMenu(menu);
        this.activeMenu = menu;
    }

    showTabContextMenu(event, tabElement, tabData) {
        const menu = document.getElementById('tab-context-menu');
        if (!menu) {
            return;
        }

        this.hideAllMenus();
        this.currentTab = tabElement;
        this.currentTabData = tabData;

        // Update menu items based on tab state
        this.updateTabMenuItems(menu, tabData);

        // Position and show menu
        this.positionMenu(menu, event.clientX, event.clientY);
        this.showMenu(menu);
        this.activeMenu = menu;
    }

    showFileExplorerItemContextMenu(event, fileItem, fileData) {
        if (!this.remoteExplorerManager) {
            console.warn('Remote explorer manager not available for context menu');
            return;
        }

        // Don't show context menu for parent directory (..)
        if (fileData.isParent) return;

        const menu = document.getElementById('file-explorer-context-menu');
        if (!menu) return;

        this.hideAllMenus();
        this.currentFileItem = fileItem;
        this.currentFileData = fileData;

        // Update menu items based on file type
        this.updateFileExplorerItemMenuItems(menu, fileData);

        // Position and show menu
        this.positionMenu(menu, event.clientX, event.clientY);
        this.showMenu(menu);
        this.activeMenu = menu;
    }

    showFileExplorerDirectoryContextMenu(event) {
        if (!this.remoteExplorerManager) {
            console.warn('Remote explorer manager not available for context menu');
            return;
        }

        const menu = document.getElementById('file-explorer-directory-context-menu');
        if (!menu) return;

        this.hideAllMenus();
        this.currentFileItem = null;
        this.currentFileData = null;

        // Position and show menu
        this.positionMenu(menu, event.clientX, event.clientY);
        this.showMenu(menu);
        this.activeMenu = menu;
    }

    updateTerminalMenuItems(menu) {
        const copyItem = menu.querySelector('[data-action="copy"]');
        const pasteItem = menu.querySelector('[data-action="paste"]');
        const clearItem = menu.querySelector('[data-action="clear"]');

        // Check if terminal has selection for copy
        const hasSelection = this.terminalManager.terminal && 
                            this.terminalManager.terminal.hasSelection();

        if (copyItem) {
            copyItem.classList.toggle('disabled', !hasSelection);
        }

        // Check if terminal is connected for paste and clear
        const isConnected = this.terminalManager.isConnected;
        if (pasteItem) {
            pasteItem.classList.toggle('disabled', !isConnected);
        }
        if (clearItem) {
            clearItem.classList.toggle('disabled', !isConnected);
        }
    }

    updateSidebarMenuItems(menu, treeItem) {
        const isShellItem = treeItem.classList.contains('tree-item-shell');
        const isProfile = treeItem.dataset.type === 'profile';
        const isFolder = treeItem.dataset.type === 'folder';
        const isConnected = this.terminalManager.isConnected;
        
        // First, reset ALL menu items to be visible (fixes broken state from root menu)
        const allItems = menu.querySelectorAll('.context-menu-item');
        allItems.forEach(item => {
            item.style.display = 'flex';
        });
        
        // Enable/disable items based on context
        const connectItem = menu.querySelector('[data-action="connect"]');
        const editItem = menu.querySelector('[data-action="edit"]');
        const duplicateItem = menu.querySelector('[data-action="duplicate"]');
        const renameItem = menu.querySelector('[data-action="rename"]');
        const deleteItem = menu.querySelector('[data-action="delete"]');
        const propertiesItem = menu.querySelector('[data-action="properties"]');
        const searchItem = menu.querySelector('[data-action="search"]');
        
        // Create options - only show for folders
        const createProfileItem = menu.querySelector('[data-action="create-profile"]');
        const createFolderItem = menu.querySelector('[data-action="create-folder"]');

        // Show/hide create options based on target
        const showCreateOptions = isFolder;
        if (createProfileItem) {
            createProfileItem.style.display = showCreateOptions ? 'flex' : 'none';
        }
        if (createFolderItem) {
            createFolderItem.style.display = showCreateOptions ? 'flex' : 'none';
        }

        // Search - hide for profile/folder context menus (only show in root context)
        if (searchItem) {
            searchItem.style.display = 'none';
        }

        // Now handle separators manually based on what's visible
        const allSeparators = menu.querySelectorAll('.context-menu-separator');
        
        // Hide all separators first
        allSeparators.forEach(separator => {
            separator.style.display = 'none';
        });
        
        // For profile/folder context menus:
        // - Show separator after Connect (before Edit section)
        // - Show separator after Delete (before Properties)
        // - Show create separator only if create options are visible
        
        // Separator 1: After Connect - always show for profile/folder menus
        if (allSeparators[0]) {
            allSeparators[0].style.display = 'block';
        }
        
        // Create separator: Only show when create options are visible
        const createSeparator = menu.querySelector('.context-menu-create-separator');
        if (createSeparator && showCreateOptions) {
            createSeparator.style.display = 'block';
        }
        
        // Separator before Properties: Always show
        if (allSeparators.length > 1) {
            allSeparators[allSeparators.length - 1].style.display = 'block';
        }

        // Connect action - available for profiles and shell items
        if (connectItem) {
            connectItem.classList.toggle('disabled', !(isProfile || isShellItem));
        }

        // Edit action - available for profiles and folders
        if (editItem) {
            editItem.classList.toggle('disabled', !(isProfile || isFolder));
        }

        // Duplicate action - available for profiles
        if (duplicateItem) {
            duplicateItem.classList.toggle('disabled', !isProfile);
        }

        // Rename action - available for all items
        if (renameItem) {
            renameItem.classList.remove('disabled');
        }

        // Delete action - available for all items
        if (deleteItem) {
            deleteItem.classList.remove('disabled');
        }

        // Properties action - available for all items
        if (propertiesItem) {
            propertiesItem.classList.remove('disabled');
        }
    }

    updateRootMenuItems(menu) {
        // Hide all regular menu items, only show create options and search
        const allItems = menu.querySelectorAll('.context-menu-item');
        const allSeparators = menu.querySelectorAll('.context-menu-separator');
        
        // Hide all items first
        allItems.forEach(item => {
            const action = item.dataset.action;
            if (action === 'create-profile' || action === 'create-folder' || action === 'search') {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
        
        // Show only the create and search separators
        allSeparators.forEach(separator => {
            if (separator.classList.contains('context-menu-create-separator')) {
                separator.style.display = 'block';
            } else {
                separator.style.display = 'none';
            }
        });
    }

    updateTabMenuItems(menu, tabData) {
        const isSSH = tabData.connectionType === 'ssh';
        const canReconnect = isSSH; // Allow reconnect for any SSH connection
        const canForceDisconnect = isSSH && tabData.status === 'hanging';
        const canClose = window.tabsManager && window.tabsManager.tabs.size > 1;

        // Get menu items
        const reconnectItem = menu.querySelector('[data-action="tab-reconnect"]');
        const forceDisconnectItem = menu.querySelector('[data-action="tab-force-disconnect"]');
        const duplicateItem = menu.querySelector('[data-action="tab-duplicate"]');
        const closeItem = menu.querySelector('[data-action="tab-close"]');
        const closeOthersItem = menu.querySelector('[data-action="tab-close-others"]');

        // Show/hide and enable/disable items based on tab state
        if (reconnectItem) {
            reconnectItem.style.display = canReconnect ? 'flex' : 'none';
        }
        
        if (forceDisconnectItem) {
            forceDisconnectItem.style.display = canForceDisconnect ? 'flex' : 'none';
        }

        if (duplicateItem) {
            duplicateItem.classList.remove('disabled');
        }

        if (closeItem) {
            closeItem.classList.toggle('disabled', !canClose);
        }

        if (closeOthersItem) {
            closeOthersItem.classList.toggle('disabled', !canClose);
        }

        // Handle separators - show the first separator for SSH connections (since reconnect is always available)
        const separators = menu.querySelectorAll('.context-menu-separator');
        if (separators[0]) {
            separators[0].style.display = isSSH ? 'block' : 'none';
        }
    }

    updateFileExplorerItemMenuItems(menu, fileData) {
        const { isDir, isParent } = fileData;
        
        // Hide/show items based on file type
        const openItem = menu.querySelector('[data-action="file-open"]');
        const previewItem = menu.querySelector('[data-action="file-preview"]');
        const uploadHereItem = menu.querySelector('[data-action="file-upload-here"]');
        
        // Hide "Open" for files, show only for directories
        if (openItem) {
            openItem.style.display = isDir ? 'flex' : 'none';
        }
        
        // Show "Preview" only for files, hide for directories
        if (previewItem) {
            previewItem.style.display = !isDir ? 'flex' : 'none';
        }
        
        // Show "Upload Files Here" only for directories
        if (uploadHereItem) {
            uploadHereItem.style.display = isDir ? 'flex' : 'none';
        }

        // Update text based on item type
        const downloadItem = menu.querySelector('[data-action="file-download"]');
        
        if (downloadItem) {
            const textSpan = downloadItem.querySelector('span:not(.context-menu-item-icon)');
            if (textSpan) {
                textSpan.textContent = isDir ? 'Download Folder' : 'Download';
            }
        }
    }

    selectSidebarItem(treeItem) {
        // Remove previous selection
        const prevSelected = document.querySelector('.tree-item.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }

        // Add selection to current item
        treeItem.classList.add('selected');
        this.selectedSidebarItem = treeItem;
    }

    positionMenu(menu, x, y) {
        const rect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Adjust position if menu would go off screen
        let adjustedX = x;
        let adjustedY = y;

        if (x + rect.width > viewportWidth) {
            adjustedX = x - rect.width;
        }

        if (y + rect.height > viewportHeight) {
            adjustedY = y - rect.height;
        }

        menu.style.left = `${Math.max(0, adjustedX)}px`;
        menu.style.top = `${Math.max(0, adjustedY)}px`;
    }

    showMenu(menu) {
        menu.classList.add('active');
    }

    hideAllMenus() {
        const menus = document.querySelectorAll('.context-menu');
        menus.forEach(menu => menu.classList.remove('active'));
        this.activeMenu = null;
        this.currentTarget = null;
        this.currentTab = null;
        this.currentTabData = null;
        this.currentFileItem = null;
        this.currentFileData = null;
    }

    async handleMenuAction(action) {
        switch (action) {
            case 'copy':
                await this.handleCopy();
                break;
            case 'paste':
                await this.handlePaste();
                break;
            case 'select-all':
                this.handleSelectAll();
                break;
            case 'clear':
                await this.handleClear();
                break;
            case 'scroll-to-top':
                this.handleScrollToTop();
                break;
            case 'scroll-to-bottom':
                this.handleScrollToBottom();
                break;
            case 'connect':
                await this.handleConnect();
                break;
            case 'edit':
                await this.handleEdit();
                break;
            case 'duplicate':
                await this.handleDuplicate();
                break;
            case 'rename':
                await this.handleRename();
                break;
            case 'delete':
                await this.handleDelete();
                break;
            case 'properties':
                await this.handleProperties();
                break;
            case 'create-profile':
                await this.handleCreateProfile();
                break;
            case 'create-folder':
                await this.handleCreateFolder();
                break;
            case 'search':
                await this.handleSearch();
                break;
            case 'tab-reconnect':
                await this.handleTabReconnect();
                break;
            case 'tab-force-disconnect':
                await this.handleTabForceDisconnect();
                break;
            case 'tab-duplicate':
                await this.handleTabDuplicate();
                break;
            case 'tab-close':
                await this.handleTabClose();
                break;
            case 'tab-close-others':
                await this.handleTabCloseOthers();
                break;
            // File Explorer actions
            case 'file-open':
                await this.handleFileOpen();
                break;
            case 'file-preview':
                await this.handleFilePreview();
                break;
            case 'file-download':
                await this.handleFileDownload();
                break;
            case 'file-upload-here':
                await this.handleFileUploadHere();
                break;
            case 'file-rename':
                await this.handleFileRename();
                break;
            case 'file-copy-path':
                await this.handleFileCopyPath();
                break;
            case 'file-delete':
                await this.handleFileDelete();
                break;
            case 'dir-new-folder':
                await this.handleDirNewFolder();
                break;
            case 'dir-upload-files':
                await this.handleDirUploadFiles();
                break;
            case 'dir-upload-folder':
                await this.handleDirUploadFolder();
                break;
            case 'dir-refresh':
                await this.handleDirRefresh();
                break;
            case 'dir-copy-path':
                await this.handleDirCopyPath();
                break;
            case 'dir-properties':
                await this.handleDirProperties();
                break;
            case 'directory-properties':
                await this.handleDirectoryProperties();
                break;
            default:
                console.log('Unknown action:', action);
        }
    }

    // Terminal actions
    async handleCopy() {
        if (this.terminalManager.terminal && this.terminalManager.terminal.hasSelection()) {
            const selectedText = this.terminalManager.terminal.getSelection();
            try {
                await navigator.clipboard.writeText(selectedText);
                showNotification('Text copied to clipboard', 2000);
            } catch (error) {
                console.error('Failed to copy text:', error);
                showNotification('Failed to copy text', 2000);
            }
        }
    }

    async handlePaste() {
        if (this.terminalManager.isConnected && this.terminalManager.sessionId) {
            try {
                const text = await navigator.clipboard.readText();
                await WriteToShell(this.terminalManager.sessionId, text);
                showNotification('Text pasted', 1500);
            } catch (error) {
                console.error('Failed to paste text:', error);
                showNotification('Failed to paste text', 2000);
            }
        }
    }

    handleSelectAll() {
        if (this.terminalManager.terminal) {
            this.terminalManager.terminal.selectAll();
        }
    }

    async handleClear() {
        if (this.terminalManager.isConnected && this.terminalManager.sessionId) {
            try {
                // Use frontend terminal clearing that respects clearScrollback setting
                this.terminalManager.clearTerminal(this.terminalManager.sessionId);
                showNotification('Terminal cleared', 1500);
            } catch (error) {
                console.error('Failed to clear terminal:', error);
            }
        }
    }

    handleScrollToTop() {
        if (this.terminalManager.terminal) {
            this.terminalManager.terminal.scrollToTop();
        }
    }

    handleScrollToBottom() {
        if (this.terminalManager.terminal) {
            this.terminalManager.terminal.scrollToBottom();
        }
    }

    // Sidebar actions
    async handleConnect() {
        if (!this.currentTarget) return;

        // Handle profiles (new system)
        if (this.currentTarget.dataset.type === 'profile') {
            const profileId = this.currentTarget.dataset.id;
            if (profileId && window.sidebarManager) {
                try {
                    await window.sidebarManager.openProfile(profileId);
                } catch (error) {
                    console.error('Failed to connect to profile:', error);
                }
            }
            return;
        }

        // Handle legacy shell items (old system)
        if (this.currentTarget.classList.contains('tree-item-shell')) {
            const shellPath = this.currentTarget.dataset.shell;
            if (shellPath && this.terminalManager) {
                try {
                    await this.terminalManager.startShell(shellPath);
                    // Removed redundant notification - terminal shows connection status
                } catch (error) {
                    // Removed redundant notification - terminal output already shows connection failures
                }
            }
        }
    }

    async handleEdit() {
        if (!this.currentTarget) return;

        // Handle profiles (new system)
        if (this.currentTarget.dataset.type === 'profile') {
            const profileId = this.currentTarget.dataset.id;
            if (profileId && window.sidebarManager) {
                try {
                    await window.sidebarManager.editProfile(profileId);
                } catch (error) {
                    console.error('Failed to edit profile:', error);
                    showNotification('Failed to edit profile', 2000);
                }
            }
            return;
        }

        // Handle folders
        if (this.currentTarget.dataset.type === 'folder') {
            const folderId = this.currentTarget.dataset.id;
            if (folderId && window.sidebarManager) {
                try {
                    await window.sidebarManager.editFolder(folderId);
                } catch (error) {
                    console.error('Failed to edit folder:', error);
                    showNotification('Failed to edit folder', 2000);
                }
            }
            return;
        }

        // Handle legacy items (old system)
        const itemText = this.currentTarget.querySelector('.tree-item-text');
        if (itemText) {
            // Make item editable
            const currentText = itemText.textContent;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentText;
            input.className = 'tree-item-edit';
            
            input.addEventListener('blur', () => this.finishEdit(itemText, input));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.finishEdit(itemText, input);
                } else if (e.key === 'Escape') {
                    itemText.textContent = currentText;
                    itemText.style.display = '';
                    input.remove();
                }
            });

            itemText.style.display = 'none';
            itemText.parentNode.insertBefore(input, itemText.nextSibling);
            input.focus();
            input.select();
        }
    }

    finishEdit(originalElement, inputElement) {
        const newText = inputElement.value.trim();
        if (newText && newText !== originalElement.textContent) {
            originalElement.textContent = newText;
            showNotification('Item renamed', 1500);
        }
        originalElement.style.display = '';
        inputElement.remove();
    }

    async handleDuplicate() {
        if (!this.currentTarget) return;

        // Handle profiles (new system)
        if (this.currentTarget.dataset.type === 'profile') {
            const profileId = this.currentTarget.dataset.id;
            if (profileId && window.sidebarManager) {
                try {
                    await window.sidebarManager.duplicateProfile(profileId);
                } catch (error) {
                    console.error('Failed to duplicate profile:', error);
                    showNotification('Failed to duplicate profile', 2000);
                }
            }
            return;
        }

        // Handle legacy items (old system)
        const clone = this.currentTarget.cloneNode(true);
        const itemText = clone.querySelector('.tree-item-text');
        if (itemText) {
            itemText.textContent += ' (Copy)';
        }
        
        // Remove selection from clone
        clone.classList.remove('selected');
        
        // Insert after current item
        this.currentTarget.parentNode.insertBefore(clone, this.currentTarget.nextSibling);
        showNotification('Item duplicated', 1500);
    }

    handleRename() {
        // Same as edit for now
        this.handleEdit();
    }

    async handleDelete() {
        if (!this.currentTarget) return;

        // Handle profiles (new system)
        if (this.currentTarget.dataset.type === 'profile') {
            const profileId = this.currentTarget.dataset.id;
            if (profileId && window.sidebarManager) {
                try {
                    await window.sidebarManager.deleteProfile(profileId);
                } catch (error) {
                    console.error('Failed to delete profile:', error);
                    showNotification('Failed to delete profile', 2000);
                }
            }
            return;
        }

        // Handle folders
        if (this.currentTarget.dataset.type === 'folder') {
            const folderId = this.currentTarget.dataset.id;
            const itemText = this.currentTarget.querySelector('.tree-item-text');
            const itemName = itemText ? itemText.textContent : 'folder';
            
            try {
                // Show folder deletion options using the universal modal
                const result = await modal.show({
                    title: 'Delete Folder',
                    message: `What would you like to do with the profiles in "${itemName}"?`,
                    icon: '🗑️',
                    buttons: [
                        { text: 'Cancel', style: 'secondary', action: 'cancel' },
                        { text: 'Move to Root', style: 'primary', action: 'move' },
                        { text: 'Delete All', style: 'danger', action: 'delete-all' }
                    ]
                });
                
                if (result !== 'cancel' && window.sidebarManager) {
                    const deleteContents = result === 'delete-all';
                    await window.sidebarManager.deleteFolder(folderId, deleteContents);
                }
            } catch (error) {
                console.error('Failed to delete folder:', error);
                showNotification('Failed to delete folder', 2000);
            }
            return;
        }

        // Handle legacy items (old system)
        const itemText = this.currentTarget.querySelector('.tree-item-text');
        const itemName = itemText ? itemText.textContent : 'item';
        
        try {
            const result = await modal.confirmDelete(itemName, 'item');
            if (result === 'confirm') {
                this.currentTarget.remove();
                showNotification('Item deleted', 1500);
            }
        } catch (error) {
            console.error('Failed to show delete confirmation:', error);
            showNotification('Failed to delete item', 2000);
        }
    }

    handleProperties() {
        if (this.currentTarget) {
            const itemText = this.currentTarget.querySelector('.tree-item-text');
            const itemName = itemText ? itemText.textContent : 'Unknown';
            const itemType = this.currentTarget.classList.contains('tree-item-shell') ? 'Shell' : 'Folder';
            
            alert(`Properties:\nName: ${itemName}\nType: ${itemType}`);
        }
    }

    async handleCreateProfile() {
        // Get the parent folder ID if right-clicking on a folder
        let parentFolderId = null;
        if (this.currentTarget && this.currentTarget.dataset.type === 'folder') {
            parentFolderId = this.currentTarget.dataset.id;
        }

        // Use the sidebar manager to open the profile creation panel
        if (window.sidebarManager) {
            try {
                await window.sidebarManager.openProfilePanel('create', 'profile', parentFolderId);
            } catch (error) {
                console.error('Failed to open profile creation panel:', error);
                showNotification('Failed to create profile', 2000);
            }
        }
    }

    async handleCreateFolder() {
        // Get the parent folder ID if right-clicking on a folder
        let parentFolderId = null;
        if (this.currentTarget && this.currentTarget.dataset.type === 'folder') {
            parentFolderId = this.currentTarget.dataset.id;
        }

        // Use the sidebar manager to open the folder creation panel
        if (window.sidebarManager) {
            try {
                await window.sidebarManager.openProfilePanel('create', 'folder', parentFolderId);
            } catch (error) {
                console.error('Failed to open folder creation panel:', error);
                showNotification('Failed to create folder', 2000);
            }
        }
    }

    async handleSearch() {
        // Open search panel through sidebar manager
        if (window.sidebarManager) {
            try {
                window.sidebarManager.showSearchPanel();
            } catch (error) {
                console.error('Failed to open search panel:', error);
                showNotification('Failed to open search', 'error');
            }
        }
    }

    async handleTabReconnect() {
        if (!this.currentTabData) {
            showNotification('No tab data available for reconnection', 2000);
            return;
        }
        
        if (!window.tabsManager) {
            showNotification('TabsManager not available', 2000);
            return;
        }
        
        try {
            await window.tabsManager.reconnectTab(this.currentTabData.id);
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            // Removed redundant notification - terminal output already shows connection failures
        }
    }

    async handleTabForceDisconnect() {
        if (!this.currentTabData || !window.tabsManager) return;
        
        try {
            await window.tabsManager.forceDisconnectTab(this.currentTabData.id);
        } catch (error) {
            console.error('Failed to force disconnect tab:', error);
            showNotification('Failed to force disconnect tab', 2000);
        }
    }

    async handleTabDuplicate() {
        if (!this.currentTabData || !window.tabsManager) return;
        
        try {
            if (this.currentTabData.connectionType === 'ssh') {
                await window.tabsManager.createNewTab(null, this.currentTabData.sshConfig);
            } else {
                await window.tabsManager.createNewTab(this.currentTabData.shell);
            }
        } catch (error) {
            console.error('Failed to duplicate tab:', error);
            showNotification('Failed to duplicate tab', 2000);
        }
    }

    async handleTabClose() {
        if (!this.currentTabData || !window.tabsManager) return;
        
        // Check if we can close (need more than 1 tab)
        if (window.tabsManager.tabs.size <= 1) {
            showNotification('Cannot close the last tab', 2000);
            return;
        }
        
        try {
            await window.tabsManager.closeTab(this.currentTabData.id);
        } catch (error) {
            console.error('Failed to close tab:', error);
            showNotification('Failed to close tab', 2000);
        }
    }

    async handleTabCloseOthers() {
        if (!this.currentTabData || !window.tabsManager) return;
        
        try {
            const otherTabs = Array.from(window.tabsManager.tabs.keys()).filter(id => id !== this.currentTabData.id);
            for (const otherId of otherTabs) {
                await window.tabsManager.closeTab(otherId);
            }
        } catch (error) {
            console.error('Failed to close other tabs:', error);
            showNotification('Failed to close other tabs', 2000);
        }
    }

    // File Explorer actions
    async handleFileOpen() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        if (this.currentFileData.isDir) {
            await this.remoteExplorerManager.navigateToPath(this.currentFileData.path);
        } else {
            // For files, we could implement file preview or download
            await this.remoteExplorerManager.showFileActions(this.currentFileItem);
        }
    }

    async handleFilePreview() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        if (!this.currentFileData.isDir) {
            await this.remoteExplorerManager.showFilePreview(this.currentFileData.path, this.currentFileData.name);
        }
    }

    async handleFileDownload() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        await this.remoteExplorerManager.downloadFile(
            this.currentFileData.path, 
            this.currentFileData.name, 
            this.currentFileData.isDir
        );
    }

    async handleFileUploadHere() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        if (this.currentFileData.isDir) {
            await this.remoteExplorerManager.uploadToDirectory(this.currentFileData.path);
        }
    }

    async handleFileRename() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        this.remoteExplorerManager.showRenameDialog(
            this.currentFileData.path, 
            this.currentFileData.name
        );
    }

    async handleFileCopyPath() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        await this.remoteExplorerManager.copyPathToClipboard(this.currentFileData.path);
    }

    async handleFileDelete() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        this.remoteExplorerManager.showDeleteConfirmation(
            this.currentFileData.path, 
            this.currentFileData.name, 
            this.currentFileData.isDir
        );
    }

    async handleDirNewFolder() {
        if (!this.remoteExplorerManager) return;
        
        this.remoteExplorerManager.showNewFolderDialog();
    }

    async handleDirUploadFiles() {
        if (!this.remoteExplorerManager) return;
        
        await this.remoteExplorerManager.uploadToDirectory(this.remoteExplorerManager.currentRemotePath);
    }

    async handleDirUploadFolder() {
        if (!this.remoteExplorerManager) return;
        
        await this.remoteExplorerManager.uploadFolderToDirectory(this.remoteExplorerManager.currentRemotePath);
    }

    async handleDirRefresh() {
        if (!this.remoteExplorerManager) return;
        
        await this.remoteExplorerManager.refreshCurrentDirectory();
    }

    async handleDirCopyPath() {
        if (!this.remoteExplorerManager) return;
        
        await this.remoteExplorerManager.copyPathToClipboard(this.remoteExplorerManager.currentRemotePath);
    }

    async handleDirProperties() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        if (this.currentFileData.isDir) {
            this.remoteExplorerManager.showDirectoryProperties(this.currentFileData.path, this.currentFileData.name);
        }
    }

    async handleDirectoryProperties() {
        if (!this.remoteExplorerManager || !this.currentFileData) return;
        
        if (this.currentFileData.isDir) {
            this.remoteExplorerManager.showDirectoryProperties(this.currentFileData.path, this.currentFileData.name);
        }
    }
}