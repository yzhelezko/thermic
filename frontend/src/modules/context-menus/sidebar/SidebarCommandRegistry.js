// Sidebar-specific command registry for profile and folder operations
import { ContextMenuCommand, CommandRegistry } from '../base/ContextMenuCommand.js';
import { showNotification } from '../../utils.js';
import { modal } from '../../../components/Modal.js';

export class SidebarCommandRegistry extends CommandRegistry {
    constructor(contextMenuManager) {
        super();
        // Store reference to the main context menu manager for access to state and managers
        this.contextMenuManager = contextMenuManager;
        this.setupCommands();
    }

    setupCommands() {
        // Profile commands
        this.register(new ContextMenuCommand(
            'connect',
            'Connect',
            'connect',
            (context) => this.handleConnect(context),
            (context) => context.itemType === 'profile'
        ));

        this.register(new ContextMenuCommand(
            'edit',
            'Edit',
            'edit',
            (context) => this.handleEdit(context),
            (context) => context.itemType === 'profile' || context.itemType === 'folder'
        ));

        this.register(new ContextMenuCommand(
            'duplicate',
            'Duplicate',
            'duplicate',
            (context) => this.handleDuplicate(context),
            (context) => context.itemType === 'profile'
        ));

        this.register(new ContextMenuCommand(
            'rename',
            'Rename',
            'rename',
            (context) => this.handleRename(context),
            (context) => context.itemType === 'profile' || context.itemType === 'folder'
        ));

        this.register(new ContextMenuCommand(
            'delete',
            'Delete',
            'delete',
            (context) => this.handleDelete(context),
            (context) => context.itemType === 'profile' || context.itemType === 'folder'
        ));

        this.registerSeparator();

        this.register(new ContextMenuCommand(
            'toggle-favorite',
            'Add to Favorites',
            'favorite',
            (context) => this.handleToggleFavorite(context),
            (context) => context.itemType === 'profile'
        ));

        // Folder commands
        this.register(new ContextMenuCommand(
            'create-profile',
            'Create Profile',
            'add-profile',
            (context) => this.handleCreateProfile(context),
            (context) => context.itemType === 'folder' || context.isRoot
        ));

        this.register(new ContextMenuCommand(
            'create-folder',
            'Create Folder',
            'add-folder',
            (context) => this.handleCreateFolder(context),
            (context) => context.itemType === 'folder' || context.isRoot
        ));

        this.registerSeparator();

        this.register(new ContextMenuCommand(
            'search',
            'Search',
            'search',
            (context) => this.handleSearch(context),
            () => true
        ));
    }

    async handleConnect(context) {
        const currentTarget = this.contextMenuManager.currentTarget;
        if (!currentTarget) return;

        // Handle profiles (new system)
        if (currentTarget.dataset.type === 'profile') {
            const profileId = currentTarget.dataset.id;
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
        if (currentTarget.classList.contains('tree-item-shell')) {
            const shellPath = currentTarget.dataset.shell;
            if (shellPath && this.contextMenuManager.terminalManager) {
                try {
                    await this.contextMenuManager.terminalManager.startShell(shellPath);
                } catch (error) {
                    console.error('Failed to start shell:', error);
                }
            }
        }
    }

    async handleEdit(context) {
        const currentTarget = this.contextMenuManager.currentTarget;
        if (!currentTarget || !window.sidebarManager) return;

        const id = currentTarget.dataset.id;
        if (!id) return;

        try {
            if (currentTarget.dataset.type === 'profile') {
                await window.sidebarManager.editProfile(id);
            } else if (currentTarget.dataset.type === 'folder') {
                await window.sidebarManager.editFolder(id);
            }
        } catch (error) {
            console.error('Failed to edit item:', error);
            showNotification('Failed to edit item', 2000);
        }
    }

    async handleDuplicate(context) {
        const currentTarget = this.contextMenuManager.currentTarget;
        if (!currentTarget || currentTarget.dataset.type !== 'profile') return;

        const profileId = currentTarget.dataset.id;
        if (!profileId || !window.sidebarManager) return;

        try {
            await window.sidebarManager.duplicateProfile(profileId);
        } catch (error) {
            console.error('Failed to duplicate profile:', error);
            showNotification('Failed to duplicate profile', 2000);
        }
    }

    handleRename(context) {
        // Same as edit for now
        this.handleEdit(context);
    }

    async handleDelete(context) {
        const currentTarget = this.contextMenuManager.currentTarget;
        if (!currentTarget || !window.sidebarManager) return;

        if (currentTarget.dataset.type === 'profile') {
            const profileId = currentTarget.dataset.id;
            if (!profileId) return;
            try {
                await window.sidebarManager.deleteProfile(profileId);
            } catch (error) {
                console.error('Failed to delete profile:', error);
                showNotification('Failed to delete profile', 2000);
            }
            return;
        }

        if (currentTarget.dataset.type === 'folder') {
            const folderId = currentTarget.dataset.id;
            const itemText = currentTarget.querySelector('.tree-item-text');
            const itemName = itemText ? itemText.textContent : 'folder';
            try {
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
                if (result !== 'cancel') {
                    await window.sidebarManager.deleteFolder(folderId, result === 'delete-all');
                }
            } catch (error) {
                console.error('Failed to delete folder:', error);
                showNotification('Failed to delete folder', 2000);
            }
        }
    }

    async handleToggleFavorite(context) {
        if (context.itemType !== 'profile') return;
        if (!context.itemId || !window.sidebarManager) return;

        try {
            await window.sidebarManager.toggleFavorite(context.itemId);
        } catch (error) {
            console.error('Failed to toggle favorite:', error);
            showNotification('Failed to update favorite', 2000);
        }
    }

    async handleCreateProfile(context) {
        // Get the parent folder ID if right-clicking on a folder
        const currentTarget = this.contextMenuManager.currentTarget;
        let parentFolderId = null;
        if (currentTarget && currentTarget.dataset.type === 'folder') {
            parentFolderId = currentTarget.dataset.id;
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

    async handleCreateFolder(context) {
        // Get the parent folder ID if right-clicking on a folder
        const currentTarget = this.contextMenuManager.currentTarget;
        let parentFolderId = null;
        if (currentTarget && currentTarget.dataset.type === 'folder') {
            parentFolderId = currentTarget.dataset.id;
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

    async handleSearch(context) {
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

    // Update command names dynamically based on context
    updateCommandName(commandId, newName) {
        const command = this.getCommand(commandId);
        if (command) {
            command.name = newName;
        }
    }
} 