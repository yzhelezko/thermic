// Sidebar context menu manager
import { ContextMenuBase } from '../base/ContextMenuBase.js';
import { ContextMenuBuilder } from '../base/ContextMenuBuilder.js';
import { SidebarCommandRegistry } from './SidebarCommandRegistry.js';

export class SidebarContextMenu extends ContextMenuBase {
    constructor(contextMenuManager) {
        super();
        this.contextMenuManager = contextMenuManager;
        this.commandRegistry = new SidebarCommandRegistry(contextMenuManager);
        this.currentTarget = null;
        this.init();
    }

    init() {
        this.bindEventsWithRetry();
    }

    bindEventsWithRetry(maxRetries = 5, delay = 100) {
        let attempts = 0;
        
        const tryBind = () => {
            attempts++;
            const sidebar = document.querySelector('.sidebar');
            
            if (sidebar) {
                console.log(`SidebarContextMenu: Found sidebar on attempt ${attempts}`);
                this.bindEvents();
                return true;
            } else if (attempts < maxRetries) {
                console.log(`SidebarContextMenu: .sidebar not found, retrying in ${delay}ms (attempt ${attempts}/${maxRetries})`);
                setTimeout(tryBind, delay);
                return false;
            } else {
                console.error(`SidebarContextMenu: Failed to find .sidebar after ${maxRetries} attempts`);
                return false;
            }
        };
        
        tryBind();
    }

    bindEvents() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) {
            console.error('SidebarContextMenu: .sidebar not found!');
            return;
        }

        console.log('SidebarContextMenu: Found sidebar, binding events...');

        sidebar.addEventListener('contextmenu', (e) => {
            console.log('SidebarContextMenu: Right-click detected in sidebar!');
            e.preventDefault();
            
            // Check if we're in history view - don't show context menus there
            const sidebarContent = document.getElementById('sidebar-content');
            if (sidebarContent && sidebarContent.classList.contains('history-view-active')) {
                console.log('SidebarContextMenu: Ignoring right-click in history view');
                return;
            }
            
            const treeItem = e.target.closest('.tree-item');
            if (treeItem) {
                console.log('SidebarContextMenu: Right-click on tree item:', treeItem);
                this.selectSidebarItem(treeItem);
                this.showContextMenu(e, treeItem);
            } else {
                console.log('SidebarContextMenu: Right-click on empty space');
                // Right-clicked on empty space - show root context menu
                this.showRootContextMenu(e);
            }
        });
        console.log('SidebarContextMenu: Event listener added to sidebar');
    }

    selectSidebarItem(treeItem) {
        // Remove selection from all items
        const allItems = document.querySelectorAll('.tree-item');
        allItems.forEach(item => item.classList.remove('selected'));
        
        // Select the current item
        treeItem.classList.add('selected');
        this.currentTarget = treeItem;
    }

    async showContextMenu(event, treeItem) {
        console.log('SidebarContextMenu: showContextMenu called');
        this.hideAllMenus();
        this.currentTarget = treeItem;
        // Also store in context menu manager for command access
        this.contextMenuManager.currentTarget = treeItem;

        const context = this.buildContext(treeItem, event);
        console.log('SidebarContextMenu: Built context:', context);
        
        // Update dynamic command names
        this.updateDynamicCommands(context);

        const commands = this.commandRegistry.getCommands(context);
        console.log('SidebarContextMenu: Got commands:', commands);
        
        if (commands.length === 0) {
            console.warn('SidebarContextMenu: No commands available for context');
            return;
        }

        const menuBuilder = new ContextMenuBuilder();
        console.log('SidebarContextMenu: Created menu builder');

        menuBuilder.create();
        console.log('SidebarContextMenu: Called menuBuilder.create()');
        
        // Add all available commands
        for (const command of commands) {
            console.log('SidebarContextMenu: Adding command:', command.name);
            await menuBuilder.addCommand(command, context);
        }

        console.log('SidebarContextMenu: About to show menu at:', event.clientX, event.clientY);
        const menu = menuBuilder.showAt(event.clientX, event.clientY);
        console.log('SidebarContextMenu: Menu returned from showAt:', menu);
        
        this.activeMenu = menu;

        // Add click handler for menu items
        this.addMenuClickHandler(menu, context);
        console.log('SidebarContextMenu: Menu setup complete');
    }

    async showRootContextMenu(event) {
        this.hideAllMenus();
        this.currentTarget = null;

        const context = {
            isRoot: true,
            itemType: null,
            itemId: null,
            treeItem: null,
            event: event
        };

        const commands = this.commandRegistry.getCommands(context);
        const menuBuilder = new ContextMenuBuilder();

        menuBuilder.create();
        
        // Add available commands for root context
        for (const command of commands) {
            await menuBuilder.addCommand(command, context);
        }

        const menu = menuBuilder.showAt(event.clientX, event.clientY);
        this.activeMenu = menu;

        // Add click handler for menu items
        this.addMenuClickHandler(menu, context);
    }

    buildContext(treeItem, event) {
        const itemType = treeItem.dataset.type;
        const itemId = treeItem.dataset.id;
        const isFavorite = treeItem.classList.contains('favorite');

        return {
            treeItem: treeItem,
            itemType: itemType,
            itemId: itemId,
            isFavorite: isFavorite,
            isRoot: false,
            event: event
        };
    }

    updateDynamicCommands(context) {
        // Update favorite toggle text based on current state
        if (context.itemType === 'profile') {
            const favoriteText = context.isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
            this.commandRegistry.updateCommandName('toggle-favorite', favoriteText);
        }
    }

    addMenuClickHandler(menu, context) {
        menu.addEventListener('click', async (e) => {
            console.log('SidebarContextMenu: Menu clicked, target:', e.target);
            const menuItem = e.target.closest('.context-menu-item');
            console.log('SidebarContextMenu: Found menu item:', menuItem);
            
            if (menuItem && !menuItem.classList.contains('disabled')) {
                const action = menuItem.dataset.action;
                console.log('SidebarContextMenu: Executing action:', action);
                try {
                    await this.commandRegistry.executeCommand(action, context);
                    console.log('SidebarContextMenu: Action executed successfully');
                } catch (error) {
                    console.error('Error executing sidebar command:', error);
                }
                this.hideAllMenus();
            } else {
                console.log('SidebarContextMenu: Menu item not found or disabled');
            }
        });
    }

    // Method to programmatically trigger commands (used by other modules)
    async executeCommand(commandId, treeItem = null) {
        const context = treeItem ? this.buildContext(treeItem, null) : { isRoot: true };
        try {
            await this.commandRegistry.executeCommand(commandId, context);
        } catch (error) {
            console.error('Error executing sidebar command programmatically:', error);
        }
    }

    destroy() {
        this.hideAllMenus();
        this.currentTarget = null;
    }
} 