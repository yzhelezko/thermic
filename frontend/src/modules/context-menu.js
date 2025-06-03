// Context menu management module - REFACTORED
// This is now a compatibility wrapper around the new domain-separated context menu system
import { createContextMenuCoordinator, contextMenuEventBus } from './context-menus/index.js';

export class ContextMenuManager {
    constructor(terminalManager, remoteExplorerManager = null) {
        this.terminalManager = terminalManager;
        this.remoteExplorerManager = remoteExplorerManager;
        
        // Create the new context menu coordinator
        this.coordinator = createContextMenuCoordinator(terminalManager, remoteExplorerManager);
        
        // Compatibility properties for backward compatibility
        this.activeMenu = null;
        this.currentTarget = null;
        this.selectedSidebarItem = null;
        this.currentTab = null;
        this.currentTabData = null;
        this.currentFileItem = null;
        this.currentFileData = null;
        this.selectToCopyEnabled = false;
        
        // Forward these properties to the coordinator so commands can access them
        this.coordinator.terminalManager = terminalManager;
        this.coordinator.remoteExplorerManager = remoteExplorerManager;
    }

    async init() {
        // The coordinator handles its own initialization
        await this.loadContextMenuSettings();
        // Setup event bus listeners for compatibility
        this.setupEventBusListeners();
    }

    setupEventBusListeners() {
        // Set up event listeners to maintain compatibility with existing code
        // that might expect certain behaviors from the old context menu system
        
        // Listen for profile events and delegate to existing handlers if they exist
        contextMenuEventBus.on('profile:connect', (data) => {
            if (this.remoteExplorerManager && this.remoteExplorerManager.handleConnect) {
                this.remoteExplorerManager.handleConnect(data.profileId, data.treeItem);
            }
        });

        contextMenuEventBus.on('profile:edit', (data) => {
            if (this.remoteExplorerManager && this.remoteExplorerManager.handleEdit) {
                this.remoteExplorerManager.handleEdit(data.profileId, data.newName, data.treeItem);
            }
        });

        contextMenuEventBus.on('profile:delete', (data) => {
            if (this.remoteExplorerManager && this.remoteExplorerManager.handleDelete) {
                this.remoteExplorerManager.handleDelete(data.profileId, data.treeItem);
            }
        });

        // Handle profile properties event
        contextMenuEventBus.on('profile:show-properties', (data) => {
            if (window.sidebarManager) {
                window.sidebarManager.showProfileProperties(data.profileId, data.treeItem);
            }
        });

        // Add more event handlers as needed for compatibility
    }

    async loadContextMenuSettings() {
        try {
            this.selectToCopyEnabled = await window.go.main.App.ConfigGet("EnableSelectToCopy");
        } catch (error) {
            console.error('Error loading context menu settings:', error);
            this.selectToCopyEnabled = false;
        }
    }

    async updateContextMenuSettings() {
        await this.loadContextMenuSettings();
        await this.coordinator.updateTerminalSettings();
    }

    // Compatibility wrapper methods for the refactored system

    hideAllMenus() {
        this.coordinator.hideAllMenus();
        this.activeMenu = null;
    }

    // Tab context menu compatibility methods
    showTabContextMenu(event, tabElement, tabData) {
        this.currentTab = tabElement;
        this.currentTabData = tabData;
        this.coordinator.showTabContextMenu(event, tabElement, tabData);
    }

    // File explorer context menu compatibility methods
    async showFileExplorerItemContextMenu(event, fileItem, fileData) {
        this.currentFileItem = fileItem;
        this.currentFileData = fileData;
        await this.coordinator.showFileItemContextMenu(event, fileItem, fileData);
    }

    async showFileExplorerDirectoryContextMenu(event, currentPath = null) {
        await this.coordinator.showFileDirectoryContextMenu(event, currentPath);
    }

    // Compatibility methods - these now delegate to the new system
    selectSidebarItem(treeItem) {
        // This functionality is now handled internally by the sidebar context menu
        this.selectedSidebarItem = treeItem;
    }

    // Cleanup method
    destroy() {
        if (this.coordinator) {
            this.coordinator.destroy();
        }
    }
}