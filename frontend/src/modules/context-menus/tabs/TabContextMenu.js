// Tab context menu manager
import { ContextMenuBase } from '../base/ContextMenuBase.js';
import { ContextMenuBuilder } from '../base/ContextMenuBuilder.js';
import { TabCommandRegistry } from './TabCommandRegistry.js';

export class TabContextMenu extends ContextMenuBase {
    constructor(contextMenuManager) {
        super();
        this.contextMenuManager = contextMenuManager;
        this.commandRegistry = new TabCommandRegistry(contextMenuManager);
        this.currentTab = null;
        this.currentTabData = null;
        this.init();
    }

    init() {
        // Tab context menus are triggered programmatically by tab manager
        // No global event binding needed here
    }

    async showContextMenu(event, tabElement, tabData) {
        this.hideAllMenus();
        this.currentTab = tabElement;
        this.currentTabData = tabData;
        // Store in context menu manager for command access
        this.contextMenuManager.currentTab = tabElement;
        this.contextMenuManager.currentTabData = tabData;

        const context = {
            tabElement: tabElement,
            tabData: tabData,
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

    addMenuClickHandler(menu, context) {
        menu.addEventListener('click', async (e) => {
            const menuItem = e.target.closest('.context-menu-item');
            if (menuItem && !menuItem.classList.contains('disabled')) {
                const action = menuItem.dataset.action;
                try {
                    await this.commandRegistry.executeCommand(action, context);
                } catch (error) {
                    console.error('Error executing tab command:', error);
                }
                this.hideAllMenus();
            }
        });
    }

    // Method to programmatically trigger commands (used by tab manager)
    async executeCommand(commandId, tabElement, tabData) {
        const context = {
            tabElement: tabElement,
            tabData: tabData,
            event: null
        };
        
        try {
            await this.commandRegistry.executeCommand(commandId, context);
        } catch (error) {
            console.error('Error executing tab command programmatically:', error);
        }
    }

    destroy() {
        this.hideAllMenus();
        this.currentTab = null;
        this.currentTabData = null;
    }
} 