// File explorer context menu manager
import { ContextMenuBase } from '../base/ContextMenuBase.js';
import { ContextMenuBuilder } from '../base/ContextMenuBuilder.js';
import { FileCommandRegistry } from './FileCommandRegistry.js';

export class FileContextMenu extends ContextMenuBase {
    constructor(contextMenuManager) {
        super();
        this.contextMenuManager = contextMenuManager;
        this.commandRegistry = new FileCommandRegistry(contextMenuManager);
        this.currentFileItem = null;
        this.currentFileData = null;
        this.init();
    }

    init() {
        // File context menus are triggered programmatically by remote explorer
        // No global event binding needed here
    }

    async showFileItemContextMenu(event, fileItem, fileData) {
        this.hideAllMenus();
        this.currentFileItem = fileItem;
        this.currentFileData = fileData;
        // Store in context menu manager for command access
        this.contextMenuManager.currentFileItem = fileItem;
        this.contextMenuManager.currentFileData = fileData;

        // Derive multi-selection context from DOM
        const selectedElements = Array.from(document.querySelectorAll('.file-item.selected'))
            .filter(el => el.dataset.isParent !== 'true');
        const selectedFiles = selectedElements.map(el => ({
            name: el.dataset.name,
            path: el.dataset.path,
            isDir: el.dataset.isDir === 'true',
        }));

        const context = {
            fileItem: fileItem,
            fileData: fileData,
            selected: selectedFiles,
            isFile: fileData.type === 'file',
            isDirectory: fileData.type === 'directory',
            event: event
        };

        const commands = this.commandRegistry.getCommands(context);
        const menuBuilder = new ContextMenuBuilder();

        menuBuilder.create();
        
        // Add all available commands
        for (const command of commands) {
            await menuBuilder.addCommand(command, context);
        }

        const menu = menuBuilder.showAt(event.clientX, event.clientY);
        this.activeMenu = menu;

        // Add click handler for menu items
        this.addMenuClickHandler(menu, context);
    }

    async showDirectoryContextMenu(event, currentPath = null) {
        this.hideAllMenus();
        this.currentFileItem = null;
        this.currentFileData = null;
        // Store in context menu manager for command access
        this.contextMenuManager.currentFileItem = null;
        this.contextMenuManager.currentFileData = null;
        this.contextMenuManager.currentPath = currentPath;

        // Create a fake directory fileData for commands to work with
        const directoryData = {
            name: 'Current Directory',
            path: currentPath || (this.contextMenuManager.remoteExplorerManager?.currentRemotePath || '/'),
            type: 'directory',
            isDir: true,
            isParent: false
        };

        const context = {
            fileItem: null,
            fileData: directoryData,
            isFile: false,
            isDirectory: true,
            currentPath: directoryData.path,
            event: event
        };

        // Store directory data in context menu manager for commands
        this.contextMenuManager.currentFileData = directoryData;

        // Get all commands and filter for directory context
        const allCommands = this.commandRegistry.getCommands(context);
        
        const menuBuilder = new ContextMenuBuilder();
        menuBuilder.create();
        
        // Add all available commands (the isEnabled check will filter appropriately)
        for (const command of allCommands) {
            await menuBuilder.addCommand(command, context);
        }

        const menu = menuBuilder.showAt(event.clientX, event.clientY);
        this.activeMenu = menu;

        // Add click handler for menu items
        this.addMenuClickHandler(menu, context);
    }

    addMenuClickHandler(menu, context) {
        menu.addEventListener('click', async (e) => {
            const menuItem = e.target.closest('.context-menu-item');
            if (menuItem && !menuItem.classList.contains('disabled')) {
                const action = menuItem.dataset.action;
                try {
                    await this.commandRegistry.executeCommand(action, context);
                } catch (error) {
                    console.error('Error executing file command:', error);
                }
                this.hideAllMenus();
            }
        });
    }

    // Method to programmatically trigger commands (used by remote explorer)
    async executeCommand(commandId, fileItem = null, fileData = null, currentPath = null) {
        const context = {
            fileItem: fileItem,
            fileData: fileData,
            isFile: fileData?.type === 'file',
            isDirectory: fileData?.type === 'directory' || !fileData,
            currentPath: currentPath,
            event: null
        };
        
        try {
            await this.commandRegistry.executeCommand(commandId, context);
        } catch (error) {
            console.error('Error executing file command programmatically:', error);
        }
    }

    destroy() {
        this.hideAllMenus();
        this.currentFileItem = null;
        this.currentFileData = null;
    }
} 