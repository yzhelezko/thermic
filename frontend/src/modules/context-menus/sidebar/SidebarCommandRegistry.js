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

        this.registerSeparator();

        this.register(new ContextMenuCommand(
            'properties',
            'Properties',
            'properties',
            (context) => this.handleProperties(context),
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
        if (!currentTarget) return;

        // Handle profiles (new system)
        if (currentTarget.dataset.type === 'profile') {
            const profileId = currentTarget.dataset.id;
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
        if (currentTarget.dataset.type === 'folder') {
            const folderId = currentTarget.dataset.id;
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

        // Handle legacy items (old system) - inline editing
        const itemText = currentTarget.querySelector('.tree-item-text');
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

    async handleDuplicate(context) {
        const currentTarget = this.contextMenuManager.currentTarget;
        if (!currentTarget) return;

        // Handle profiles (new system)
        if (currentTarget.dataset.type === 'profile') {
            const profileId = currentTarget.dataset.id;
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
        const clone = currentTarget.cloneNode(true);
        const itemText = clone.querySelector('.tree-item-text');
        if (itemText) {
            itemText.textContent += ' (Copy)';
        }
        
        // Remove selection from clone
        clone.classList.remove('selected');
        
        // Insert after current item
        currentTarget.parentNode.insertBefore(clone, currentTarget.nextSibling);
        showNotification('Item duplicated', 1500);
    }

    handleRename(context) {
        // Same as edit for now
        this.handleEdit(context);
    }

    async handleDelete(context) {
        const currentTarget = this.contextMenuManager.currentTarget;
        if (!currentTarget) return;

        // Handle profiles (new system)
        if (currentTarget.dataset.type === 'profile') {
            const profileId = currentTarget.dataset.id;
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
        if (currentTarget.dataset.type === 'folder') {
            const folderId = currentTarget.dataset.id;
            const itemText = currentTarget.querySelector('.tree-item-text');
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
        const itemText = currentTarget.querySelector('.tree-item-text');
        const itemName = itemText ? itemText.textContent : 'item';
        
        try {
            const result = await modal.confirmDelete(itemName, 'item');
            if (result === 'confirm') {
                currentTarget.remove();
                showNotification('Item deleted', 1500);
            }
        } catch (error) {
            console.error('Failed to show delete confirmation:', error);
            showNotification('Failed to delete item', 2000);
        }
    }

    async handleToggleFavorite(context) {
        if (context.itemType !== 'profile') return;

        const isFavorite = context.treeItem?.classList.contains('favorite') || false;
        
        contextMenuEventBus.emit('profile:toggle-favorite', {
            profileId: context.itemId,
            isFavorite: isFavorite,
            treeItem: context.treeItem
        });
    }

    handleProperties(context) {
        if (context.itemType !== 'profile') return;

        contextMenuEventBus.emit('profile:show-properties', {
            profileId: context.itemId,
            treeItem: context.treeItem
        });
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