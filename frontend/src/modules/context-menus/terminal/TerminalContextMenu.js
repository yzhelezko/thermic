// Terminal context menu manager
import { ContextMenuBase } from '../base/ContextMenuBase.js';
import { ContextMenuBuilder } from '../base/ContextMenuBuilder.js';
import { TerminalCommandRegistry } from './TerminalCommandRegistry.js';

export class TerminalContextMenu extends ContextMenuBase {
    constructor(terminalManager) {
        super();
        this.terminalManager = terminalManager;
        this.commandRegistry = new TerminalCommandRegistry(terminalManager);
        this.selectToCopyEnabled = false;
        
        // Store event handler references for cleanup
        this.terminalMouseUpHandler = null;
        this.terminalContextMenuHandler = null;
        
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.bindEventsWithRetry();
    }

    bindEventsWithRetry(maxRetries = 5, delay = 100) {
        let attempts = 0;
        
        const tryBind = () => {
            attempts++;
            const terminalContainer = document.querySelector('.terminal-container');
            
            if (terminalContainer) {
                console.log(`TerminalContextMenu: Found terminal container on attempt ${attempts}`);
                this.bindEvents();
                return true;
            } else if (attempts < maxRetries) {
                console.log(`TerminalContextMenu: .terminal-container not found, retrying in ${delay}ms (attempt ${attempts}/${maxRetries})`);
                setTimeout(tryBind, delay);
                return false;
            } else {
                console.error(`TerminalContextMenu: Failed to find .terminal-container after ${maxRetries} attempts`);
                return false;
            }
        };
        
        tryBind();
    }

    async loadSettings() {
        try {
            this.selectToCopyEnabled = await window.go.main.App.ConfigGet("EnableSelectToCopy");
        } catch (error) {
            console.error('Error loading terminal context menu settings:', error);
            this.selectToCopyEnabled = false;
        }
    }

    async updateSettings() {
        await this.loadSettings();
        this.bindEvents(); // Rebind events based on new settings
    }

    bindEvents() {
        const terminalContainer = document.querySelector('.terminal-container');
        if (!terminalContainer) {
            console.error('TerminalContextMenu: .terminal-container not found!');
            return;
        }

        console.log('TerminalContextMenu: Found terminal container, binding events...');

        // Remove existing listeners
        this.removeEventListeners(terminalContainer);

        if (this.selectToCopyEnabled) {
            console.log('TerminalContextMenu: Binding select-to-copy events');
            this.bindSelectToCopyEvents(terminalContainer);
        } else {
            console.log('TerminalContextMenu: Binding standard context menu events');
            this.bindStandardContextMenuEvents(terminalContainer);
        }
    }

    removeEventListeners(terminalContainer) {
        if (this.terminalMouseUpHandler) {
            terminalContainer.removeEventListener('mouseup', this.terminalMouseUpHandler);
        }
        if (this.terminalContextMenuHandler) {
            terminalContainer.removeEventListener('contextmenu', this.terminalContextMenuHandler);
        }
    }

    bindSelectToCopyEvents(terminalContainer) {
        // Select-to-copy mode: auto-copy on selection, right-click to paste
        this.terminalMouseUpHandler = async (e) => {
            // Only handle left mouse button release
            if (e.button !== 0) return;
            
            // Small delay to ensure selection is complete
            setTimeout(async () => {
                // Get the active terminal session
                const activeSession = this.terminalManager.activeSessionId 
                    ? this.terminalManager.terminals.get(this.terminalManager.activeSessionId)
                    : null;
                
                // Check if active session has terminal and selection
                if (activeSession && activeSession.terminal && activeSession.terminal.hasSelection()) {
                    const selectedText = activeSession.terminal.getSelection();
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
            // Right-click to paste - get active session
            const activeSession = this.terminalManager.activeSessionId 
                ? this.terminalManager.terminals.get(this.terminalManager.activeSessionId)
                : null;
            
            // Only paste if we have an active connected session
            if (activeSession && activeSession.isConnected) {
                try {
                    const text = await navigator.clipboard.readText();
                    if (text && text.trim()) {
                        // Use terminal manager's native paste method for proper multiline handling
                        this.terminalManager.pasteText(text);
                        console.log('Pasted:', text.substring(0, 50) + '...');
                    }
                } catch (error) {
                    console.error('Failed to paste text:', error);
                }
            }
        };

        terminalContainer.addEventListener('mouseup', this.terminalMouseUpHandler);
        terminalContainer.addEventListener('contextmenu', this.terminalContextMenuHandler);
    }

    bindStandardContextMenuEvents(terminalContainer) {
        // Standard context menu mode
        this.terminalContextMenuHandler = async (e) => {
            console.log('TerminalContextMenu: Right-click detected in terminal!');
            e.preventDefault();
            await this.showContextMenu(e);
        };

        terminalContainer.addEventListener('contextmenu', this.terminalContextMenuHandler);
        console.log('TerminalContextMenu: Event listener added to terminal container');
    }

    async showContextMenu(event) {
        this.hideAllMenus();

        const context = {
            terminal: this.terminalManager,
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
                    console.error('Error executing terminal command:', error);
                }
                this.hideAllMenus();
            }
        });
    }

    destroy() {
        const terminalContainer = document.querySelector('.terminal-container');
        if (terminalContainer) {
            this.removeEventListeners(terminalContainer);
        }
        this.hideAllMenus();
    }
} 