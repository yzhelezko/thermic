// Context menu coordinator - manages all context menu domains
import { TerminalContextMenu } from './terminal/TerminalContextMenu.js';
import { SidebarContextMenu } from './sidebar/SidebarContextMenu.js';
import { TabContextMenu } from './tabs/TabContextMenu.js';
import { FileContextMenu } from './files/FileContextMenu.js';

export class ContextMenuCoordinator {
    constructor(terminalManager, remoteExplorerManager = null) {
        this.terminalManager = terminalManager;
        this.remoteExplorerManager = remoteExplorerManager;
        
        // Store state for command access
        this.currentTarget = null;
        
        // Initialize domain managers
        this.terminalMenus = new TerminalContextMenu(terminalManager);
        this.sidebarMenus = new SidebarContextMenu(this);
        this.tabMenus = new TabContextMenu(this);
        this.fileMenus = new FileContextMenu(this);
        
        this.init();
    }

    init() {
        this.bindGlobalEvents();
    }

    bindGlobalEvents() {
        // Global click to hide all context menus
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideAllMenus();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideAllMenus();
            }
        });

        // Prevent context menu on title bar and tabs area
        document.addEventListener('contextmenu', (e) => {
            // Check if the right-click is on the title bar area or tabs area
            if (e.target.closest('.tabs-titlebar') || 
                e.target.closest('.titlebar-content') || 
                e.target.closest('.window-title') ||
                e.target.closest('.window-controls-right') ||
                e.target.closest('.window-control') ||
                e.target.closest('.tabs-bar') ||
                e.target.closest('.tabs-list')) {
                
                // Allow tab context menu on actual tab elements
                if (e.target.closest('.tab')) {
                    return; // Let tab context menu work
                }
                
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        });
    }



    hideAllMenus() {
        this.terminalMenus.hideAllMenus();
        this.sidebarMenus.hideAllMenus();
        this.tabMenus.hideAllMenus();
        this.fileMenus.hideAllMenus();
    }

    // Public API methods for other modules to use

    // Terminal menu methods
    async updateTerminalSettings() {
        await this.terminalMenus.updateSettings();
    }

    // Sidebar menu methods
    async executeSidebarCommand(commandId, treeItem = null) {
        return await this.sidebarMenus.executeCommand(commandId, treeItem);
    }

    // Tab menu methods
    async showTabContextMenu(event, tabElement, tabData) {
        await this.tabMenus.showContextMenu(event, tabElement, tabData);
    }

    async executeTabCommand(commandId, tabElement, tabData) {
        return await this.tabMenus.executeCommand(commandId, tabElement, tabData);
    }

    // File menu methods
    async showFileItemContextMenu(event, fileItem, fileData) {
        await this.fileMenus.showFileItemContextMenu(event, fileItem, fileData);
    }

    async showFileDirectoryContextMenu(event, currentPath = null) {
        await this.fileMenus.showDirectoryContextMenu(event, currentPath);
    }

    async executeFileCommand(commandId, fileItem = null, fileData = null, currentPath = null) {
        return await this.fileMenus.executeCommand(commandId, fileItem, fileData, currentPath);
    }

    // Utility methods
    getCurrentActiveMenu() {
        if (this.terminalMenus.activeMenu) return 'terminal';
        if (this.sidebarMenus.activeMenu) return 'sidebar';
        if (this.tabMenus.activeMenu) return 'tab';
        if (this.fileMenus.activeMenu) return 'file';
        return null;
    }

    isAnyMenuVisible() {
        return (
            this.terminalMenus.isVisible ||
            this.sidebarMenus.isVisible ||
            this.tabMenus.isVisible ||
            this.fileMenus.isVisible
        );
    }

    // Cleanup method
    destroy() {
        this.terminalMenus.destroy();
        this.sidebarMenus.destroy();
        this.tabMenus.destroy();
        this.fileMenus.destroy();
    }
} 