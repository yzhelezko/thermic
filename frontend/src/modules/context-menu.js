// Context menu management module
import { WriteToShell } from '../../wailsjs/go/main/App';
import { showNotification } from './utils.js';

export class ContextMenuManager {
    constructor(terminalManager) {
        this.terminalManager = terminalManager;
        this.activeMenu = null;
        this.currentTarget = null;
        this.selectedSidebarItem = null;
    }

    init() {
        this.bindEvents();
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

        // Terminal context menu
        const terminalContainer = document.querySelector('.terminal-container');
        if (terminalContainer) {
            terminalContainer.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showTerminalContextMenu(e);
            });
        }

        // Sidebar context menu
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const treeItem = e.target.closest('.tree-item');
                if (treeItem) {
                    this.selectSidebarItem(treeItem);
                    this.showSidebarContextMenu(e, treeItem);
                } else {
                    // Right-clicked on empty space anywhere in sidebar - show root context menu
                    // Check if we're actually in the sidebar (not just a child element)
                    const isInSidebar = e.target.closest('.sidebar');
                    if (isInSidebar) {
                        this.showRootContextMenu(e);
                    }
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
                await WriteToShell(this.terminalManager.sessionId, '\x0C'); // Ctrl+L
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
                    showNotification('Failed to connect to profile', 2000);
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
                    showNotification(`Connected to ${shellPath}`, 2000);
                } catch (error) {
                    showNotification('Failed to connect to shell', 2000);
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
            
            // Show options for folder deletion
            const result = confirm(`Delete "${itemName}"?\n\nOK = Move profiles to root\nCancel = Keep folder`);
            if (result && window.sidebarManager) {
                try {
                    // Ask if they want to delete contents too
                    const deleteContents = confirm(`Delete all profiles inside "${itemName}" too?\n\nOK = Delete all contents\nCancel = Move profiles to root`);
                    await window.sidebarManager.deleteFolder(folderId, deleteContents);
                } catch (error) {
                    console.error('Failed to delete folder:', error);
                    showNotification('Failed to delete folder', 2000);
                }
            }
            return;
        }

        // Handle legacy items (old system)
        const itemText = this.currentTarget.querySelector('.tree-item-text');
        const itemName = itemText ? itemText.textContent : 'item';
        
        if (confirm(`Are you sure you want to delete "${itemName}"?`)) {
            this.currentTarget.remove();
            showNotification('Item deleted', 1500);
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
}