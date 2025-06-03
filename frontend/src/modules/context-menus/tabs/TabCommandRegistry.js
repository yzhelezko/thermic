// Tab-specific command registry for tab lifecycle operations
import { ContextMenuCommand, CommandRegistry } from '../base/ContextMenuCommand.js';
import { showNotification } from '../../utils.js';

export class TabCommandRegistry extends CommandRegistry {
    constructor(contextMenuManager) {
        super();
        this.contextMenuManager = contextMenuManager;
        this.setupCommands();
    }

    setupCommands() {
        // Tab connection commands
        this.register(new ContextMenuCommand(
            'tab-reconnect',
            'Reconnect',
            'reconnect',
            (context) => this.handleTabReconnect(context),
            (context) => context.tabData && context.tabData.status === 'disconnected'
        ));

        this.register(new ContextMenuCommand(
            'tab-force-disconnect',
            'Force Disconnect',
            'disconnect',
            (context) => this.handleTabForceDisconnect(context),
            (context) => context.tabData && context.tabData.status === 'connected'
        ));

        this.registerSeparator();

        // Tab management commands
        this.register(new ContextMenuCommand(
            'tab-duplicate',
            'Duplicate Tab',
            'duplicate',
            (context) => this.handleTabDuplicate(context),
            (context) => context.tabData && context.tabData.profileId
        ));

        this.registerSeparator();

        // Tab close commands
        this.register(new ContextMenuCommand(
            'tab-close',
            'Close Tab',
            'close',
            (context) => this.handleTabClose(context),
            () => true
        ));

        this.register(new ContextMenuCommand(
            'tab-close-others',
            'Close Other Tabs',
            'close-others',
            (context) => this.handleTabCloseOthers(context),
            (context) => this.hasOtherTabs(context)
        ));
    }

    hasOtherTabs(context) {
        const allTabs = document.querySelectorAll('.tab');
        return allTabs.length > 1;
    }

    async handleTabReconnect(context) {
        const currentTabData = this.contextMenuManager.currentTabData;
        if (!currentTabData) {
            showNotification('No tab data available for reconnection', 2000);
            return;
        }
        
        if (!window.tabsManager) {
            showNotification('TabsManager not available', 2000);
            return;
        }
        
        try {
            await window.tabsManager.reconnectTab(currentTabData.id);
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            console.error('Failed to reconnect tab:', errorMessage);
        }
    }

    async handleTabForceDisconnect(context) {
        const currentTabData = this.contextMenuManager.currentTabData;
        if (!currentTabData || !window.tabsManager) return;
        
        try {
            await window.tabsManager.forceDisconnectTab(currentTabData.id);
        } catch (error) {
            console.error('Failed to force disconnect tab:', error);
            showNotification('Failed to force disconnect tab', 2000);
        }
    }

    async handleTabDuplicate(context) {
        const currentTabData = this.contextMenuManager.currentTabData;
        if (!currentTabData || !window.tabsManager) return;
        
        try {
            if (currentTabData.connectionType === 'ssh') {
                await window.tabsManager.createNewTab(null, currentTabData.sshConfig);
            } else {
                await window.tabsManager.createNewTab(currentTabData.shell);
            }
        } catch (error) {
            console.error('Failed to duplicate tab:', error);
            showNotification('Failed to duplicate tab', 2000);
        }
    }

    async handleTabClose(context) {
        const currentTabData = this.contextMenuManager.currentTabData;
        if (!currentTabData || !window.tabsManager) return;
        
        // Check if we can close (need more than 1 tab)
        if (window.tabsManager.tabs.size <= 1) {
            showNotification('Cannot close the last tab', 2000);
            return;
        }
        
        try {
            await window.tabsManager.closeTab(currentTabData.id);
        } catch (error) {
            console.error('Failed to close tab:', error);
            showNotification('Failed to close tab', 2000);
        }
    }

    async handleTabCloseOthers(context) {
        const currentTabData = this.contextMenuManager.currentTabData;
        if (!currentTabData || !window.tabsManager) return;
        
        try {
            const otherTabs = Array.from(window.tabsManager.tabs.keys()).filter(id => id !== currentTabData.id);
            for (const otherId of otherTabs) {
                await window.tabsManager.closeTab(otherId);
            }
        } catch (error) {
            console.error('Failed to close other tabs:', error);
            showNotification('Failed to close other tabs', 2000);
        }
    }
} 