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
        const isConnected = this.terminalManager.isConnected;
        
        // Enable/disable items based on context
        const connectItem = menu.querySelector('[data-action="connect"]');
        const editItem = menu.querySelector('[data-action="edit"]');
        const deleteItem = menu.querySelector('[data-action="delete"]');

        if (connectItem) {
            connectItem.classList.toggle('disabled', !isShellItem || isConnected);
        }

        // All items can be edited/deleted for now
        if (editItem) {
            editItem.classList.remove('disabled');
        }
        if (deleteItem) {
            deleteItem.classList.remove('disabled');
        }
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
                this.handleEdit();
                break;
            case 'duplicate':
                this.handleDuplicate();
                break;
            case 'rename':
                this.handleRename();
                break;
            case 'delete':
                this.handleDelete();
                break;
            case 'properties':
                this.handleProperties();
                break;
            default:
                console.warn('Unknown context menu action:', action);
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
        if (this.currentTarget && this.currentTarget.classList.contains('tree-item-shell')) {
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

    handleEdit() {
        if (this.currentTarget) {
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

    handleDuplicate() {
        if (this.currentTarget) {
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
    }

    handleRename() {
        // Same as edit for now
        this.handleEdit();
    }

    handleDelete() {
        if (this.currentTarget) {
            const itemText = this.currentTarget.querySelector('.tree-item-text');
            const itemName = itemText ? itemText.textContent : 'item';
            
            if (confirm(`Are you sure you want to delete "${itemName}"?`)) {
                this.currentTarget.remove();
                showNotification('Item deleted', 1500);
            }
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
} 