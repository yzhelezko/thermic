// Tabs management module
import { CreateTab, GetTabs, SetActiveTab, CloseTab, StartTabShell, GetAvailableShellsFormatted } from '../../wailsjs/go/main/App';
import { generateSessionId, formatShellName, updateStatus } from './utils.js';

export class TabsManager {
    constructor(terminalManager) {
        this.terminalManager = terminalManager;
        this.tabs = new Map(); // tabId -> tab data
        this.activeTabId = null;
        this.newTabCounter = 1;
        this.isInitialized = false;
        this.isAvailable = false; // Will be set to true if tabs system works
        this.closingTabs = new Set(); // Track tabs currently being closed
        this.shellFormats = new Map(); // Cache for shell raw value -> formatted name mapping
    }

    init() {
        if (this.isInitialized) return;
        
        try {
            this.initTabsUI();
            this.setupTabEvents();
            this.isInitialized = true;
            console.log('TabsManager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize TabsManager:', error);
            updateStatus('Tabs system initialization failed');
        }
    }

    initTabsUI() {
        const tabsContainer = document.querySelector('.tabs-container');
        if (!tabsContainer) {
            console.error('Tabs container not found');
            return;
        }

        // Only initialize if not already done
        if (tabsContainer.querySelector('.tabs-bar')) {
            console.log('Tabs UI already initialized');
            return;
        }

        // Create the tabs bar HTML
        tabsContainer.innerHTML = `
            <div class="tabs-bar">
                <div class="tabs-list" id="tabs-list">
                    <!-- Tabs will be inserted here -->
                </div>
                <div class="tabs-controls">
                    <button class="new-tab-btn" id="new-tab-btn" title="New Terminal">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <button class="new-ssh-tab-btn" id="new-ssh-tab-btn" title="New SSH Connection">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12l2 2 4-4"></path>
                            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 0-2-2z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        // Add some initial styling if not present
        this.addTabsCSS();
        
        console.log('Tabs UI initialized successfully');
    }

    addTabsCSS() {
        // CSS is now handled by tabs.css file
        // This method is kept for compatibility but does nothing
    }

    async loadShellFormats() {
        try {
            const shells = await GetAvailableShellsFormatted();
            this.shellFormats.clear();
            
            // Create mapping from raw shell value to formatted name
            shells.forEach(shell => {
                this.shellFormats.set(shell.value, shell.name);
            });
            
            console.log('Loaded shell formats:', this.shellFormats);
        } catch (error) {
            console.warn('Failed to load shell formats:', error);
            // Fallback to using formatShellName utility function
        }
    }

    getFormattedShellName(shellValue) {
        // First try the cached formatted names
        if (this.shellFormats.has(shellValue)) {
            return this.shellFormats.get(shellValue);
        }
        
        // Fallback to utility function
        return formatShellName(shellValue);
    }

    setupTabEvents() {
        // New tab button
        document.addEventListener('click', (e) => {
            if (e.target.closest('#new-tab-btn')) {
                console.log('New tab button clicked');
                e.preventDefault();
                e.stopPropagation();
                this.createNewTab().catch(error => {
                    console.error('Error creating new tab:', error);
                });
            } else if (e.target.closest('#new-ssh-tab-btn')) {
                console.log('New SSH tab button clicked');
                e.preventDefault();
                e.stopPropagation();
                this.showSSHDialog();
            }
        });

        // Tab events (using event delegation)
        document.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;

            const tabId = tab.dataset.tabId;
            
            if (e.target.closest('.tab-close')) {
                e.stopPropagation();
                // Add visual feedback while closing
                tab.classList.add('closing');
                this.closeTab(tabId);
            } else {
                this.switchToTab(tabId);
            }
        });

        // Tab right-click context menu
        document.addEventListener('contextmenu', (e) => {
            const tab = e.target.closest('.tab');
            if (tab) {
                e.preventDefault();
                this.showTabContextMenu(tab.dataset.tabId, e.clientX, e.clientY);
            }
        });
    }

    async createNewTab(shell = null, sshConfig = null) {
        try {
            updateStatus('Creating new tab...');
            console.log('Creating new tab with shell:', shell, 'ssh:', sshConfig);

            // Load shell formats if not already loaded
            if (this.shellFormats.size === 0) {
                await this.loadShellFormats();
            }

            // Use default shell if none specified
            if (!shell && !sshConfig) {
                try {
                    shell = await this.terminalManager.getDefaultShell();
                    console.log('Got default shell:', shell);
                } catch (error) {
                    console.warn('Failed to get default shell, using empty string:', error);
                    shell = '';
                }
            }

            // Create tab on backend (backend generates its own session ID)
            console.log('Calling CreateTab with:', shell || '', sshConfig);
            const tab = await CreateTab(shell || '', sshConfig);
            console.log('Tab created on backend:', tab);
            console.log(`Backend assigned session ID: ${tab.sessionId} to tab: ${tab.id}`);
            
            // Enhance tab title with formatted shell name
            if (!sshConfig && shell) {
                const formattedShellName = this.getFormattedShellName(shell);
                tab.formattedShellName = formattedShellName;
                // Update title to include formatted shell name
                tab.title = formattedShellName;
                console.log(`Tab title updated to: ${tab.title}`);
            }
            
            // Add to local tabs (use backend's session ID)
            this.tabs.set(tab.id, tab);

            // Create terminal session using backend's session ID
            this.terminalManager.createTerminalSession(tab.sessionId);

            // Update UI
            this.renderTabs();

            // Start shell first (creates backend shell process), then switch to make it visible
            await this.startTabShell(tab.id);
            await this.switchToTab(tab.id);

            updateStatus(`New tab created: ${tab.title}`);
            console.log(`Tab ${tab.id} now has its own isolated shell process`);
            return tab;
        } catch (error) {
            console.error('Failed to create tab:', error);
            console.error('Error details:', error.stack);
            updateStatus('Failed to create new tab: ' + error.message);
            throw error;
        }
    }

    async startTabShell(tabId) {
        try {
            const tab = this.tabs.get(tabId);
            if (!tab) {
                throw new Error(`Tab ${tabId} not found`);
            }
            
            console.log(`Starting backend shell for tab: ${tabId}, session: ${tab.sessionId}`);
            
            // Start the backend shell process for this tab
            await StartTabShell(tabId);
            console.log(`Backend shell started for tab: ${tabId}`);
            
            // Connect the frontend terminal to the backend shell session
            this.terminalManager.connectToSession(tab.sessionId);
            console.log(`Frontend terminal connected to session: ${tab.sessionId}`);
            
        } catch (error) {
            console.error(`Failed to start shell for tab ${tabId}:`, error);
            throw error;
        }
    }

    async switchToTab(tabId) {
        try {
            console.log(`Switching to tab: ${tabId}`);
            
            const tab = this.tabs.get(tabId);
            if (!tab) {
                console.error(`Tab ${tabId} not found`);
                updateStatus('Tab not found');
                return;
            }

            // Update local state immediately (optimistic update)
            this.activeTabId = tabId;
            
            // Switch terminal manager to this session immediately
            console.log(`Switching terminal to session: ${tab.sessionId}`);
            this.terminalManager.switchToSession(tab.sessionId);
            
            // Update UI immediately
            this.renderTabs();
            updateStatus(`Switched to: ${tab.title}`);

            // Set active on backend asynchronously (don't block UI)
            SetActiveTab(tabId).then(() => {
                console.log(`Backend SetActiveTab completed for: ${tabId}`);
            }).catch((error) => {
                console.warn('Backend SetActiveTab failed:', error);
                // UI is already updated, so this is not critical
            });
            
            console.log(`Successfully switched to tab: ${tabId}`);
        } catch (error) {
            console.error('Failed to switch tab:', error);
            updateStatus('Failed to switch tab: ' + error.message);
        }
    }

    async closeTab(tabId) {
        if (this.tabs.size <= 1) {
            updateStatus('Cannot close the last tab');
            return;
        }

        // Prevent multiple close operations on the same tab
        if (this.closingTabs.has(tabId)) {
            console.log('Tab already being closed:', tabId);
            return;
        }

        this.closingTabs.add(tabId);

        try {
            updateStatus('Closing tab...');
            console.log('Closing tab:', tabId);

            const tab = this.tabs.get(tabId);
            if (!tab) {
                console.warn('Tab not found:', tabId);
                return;
            }

            // If this was the active tab, switch to another first (before disconnecting)
            if (this.activeTabId === tabId) {
                const remainingTabs = Array.from(this.tabs.keys()).filter(id => id !== tabId);
                if (remainingTabs.length > 0) {
                    console.log('Switching to tab before close:', remainingTabs[0]);
                    await this.switchToTab(remainingTabs[0]);
                }
            }

            // Then disconnect the terminal session after switching away
            console.log('Disconnecting terminal session:', tab.sessionId);
            this.terminalManager.disconnectSession(tab.sessionId);

            // Remove from local tabs first (optimistic update)
            this.tabs.delete(tabId);
            this.renderTabs();

            // Close on backend asynchronously (don't wait for it)
            console.log('Calling backend CloseTab asynchronously...');
            CloseTab(tabId).then(() => {
                console.log('Backend CloseTab completed successfully');
            }).catch((error) => {
                console.warn('Backend CloseTab failed:', error);
                // This is fine, the UI is already updated
            });
            
            updateStatus('Tab closed');
        } catch (error) {
            console.error('Failed to close tab:', error);
            
            // Check if the tab was already removed from UI (optimistic update worked)
            if (!this.tabs.has(tabId)) {
                console.log('Tab was successfully removed from UI despite error');
                updateStatus('Tab closed');
            } else {
                console.error('Tab close failed completely, restoring tab...');
                // If we have the tab data, we could restore it here
                updateStatus('Failed to close tab: ' + error.message);
            }
        } finally {
            // Always remove from closing set
            this.closingTabs.delete(tabId);
        }
    }



    renderTabs() {
        const tabsList = document.getElementById('tabs-list');
        if (!tabsList) return;

        tabsList.innerHTML = '';

        for (const [tabId, tab] of this.tabs) {
            const tabElement = this.createTabElement(tab);
            tabsList.appendChild(tabElement);
        }
    }

    createTabElement(tab) {
        const isActive = tab.id === this.activeTabId;
        const isSSH = tab.connectionType === 'ssh';
        const isLastTab = this.tabs.size <= 1;
        
        const tabEl = document.createElement('div');
        tabEl.className = `tab ${isActive ? 'active' : ''} ${isSSH ? 'ssh-tab' : ''}`;
        tabEl.dataset.tabId = tab.id;

        // Determine icon
        const iconSvg = isSSH ? 
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"></path><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 0-2-2z"></path></svg>' :
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,17 10,11 4,5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';

        // Format title for display
        const displayTitle = this.formatTabTitle(tab.title);
        const needsTooltip = tab.title && tab.title.length > 25; // Show tooltip if title is long

        // Only show close button if there's more than one tab
        const closeButtonHtml = !isLastTab ? `
            <button class="tab-close" title="Close tab">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        ` : '';

        tabEl.innerHTML = `
            <div class="tab-icon">${iconSvg}</div>
            <div class="tab-title">${displayTitle}</div>
            ${closeButtonHtml}
            ${needsTooltip ? `<div class="tab-tooltip">${tab.title || 'Untitled'}</div>` : ''}
        `;

        return tabEl;
    }

    formatTabTitle(title) {
        // Handle undefined or null title
        if (!title) {
            return 'Untitled';
        }
        
        // Truncate long titles but keep meaningful parts
        if (title.length <= 25) {
            return title;
        }

        // For SSH connections, prioritize host information
        if (title.includes('@')) {
            const parts = title.split('@');
            if (parts.length === 2) {
                const [user, hostPort] = parts;
                if (hostPort.length > 15) {
                    return `${user}@...${hostPort.slice(-12)}`;
                }
            }
        }

        // For paths, show end of path
        if (title.includes('/') || title.includes('\\')) {
            return `...${title.slice(-22)}`;
        }

        // General truncation
        return `${title.slice(0, 22)}...`;
    }

    showSSHDialog() {
        // Create SSH connection dialog
        const dialog = document.createElement('div');
        dialog.className = 'ssh-dialog-overlay';
        dialog.innerHTML = `
            <div class="ssh-dialog">
                <div class="ssh-dialog-header">
                    <h3>New SSH Connection</h3>
                    <button class="ssh-dialog-close">&times;</button>
                </div>
                <div class="ssh-dialog-content">
                    <div class="ssh-form">
                        <div class="form-group">
                            <label for="ssh-host">Host:</label>
                            <input type="text" id="ssh-host" placeholder="hostname or IP" required>
                        </div>
                        <div class="form-group">
                            <label for="ssh-port">Port:</label>
                            <input type="number" id="ssh-port" value="22" min="1" max="65535">
                        </div>
                        <div class="form-group">
                            <label for="ssh-username">Username:</label>
                            <input type="text" id="ssh-username" placeholder="username" required>
                        </div>
                        <div class="form-group">
                            <label for="ssh-password">Password (optional):</label>
                            <input type="password" id="ssh-password" placeholder="password">
                        </div>
                        <div class="form-group">
                            <label for="ssh-keypath">Private Key Path (optional):</label>
                            <input type="text" id="ssh-keypath" placeholder="/path/to/private/key">
                        </div>
                    </div>
                </div>
                <div class="ssh-dialog-footer">
                    <button class="ssh-cancel-btn">Cancel</button>
                    <button class="ssh-connect-btn">Connect</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        this.addSSHDialogCSS();

        // Focus first input
        setTimeout(() => {
            document.getElementById('ssh-host').focus();
        }, 100);

        // Event handlers
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog || e.target.closest('.ssh-dialog-close') || e.target.closest('.ssh-cancel-btn')) {
                document.body.removeChild(dialog);
            } else if (e.target.closest('.ssh-connect-btn')) {
                this.handleSSHConnect(dialog);
            }
        });

        // Enter key to connect
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.handleSSHConnect(dialog);
            } else if (e.key === 'Escape') {
                document.body.removeChild(dialog);
            }
        });
    }

    async handleSSHConnect(dialog) {
        const host = document.getElementById('ssh-host').value.trim();
        const port = parseInt(document.getElementById('ssh-port').value) || 22;
        const username = document.getElementById('ssh-username').value.trim();
        const password = document.getElementById('ssh-password').value;
        const keyPath = document.getElementById('ssh-keypath').value.trim();

        if (!host || !username) {
            alert('Host and username are required');
            return;
        }

        const sshConfig = {
            Host: host,
            Port: port,
            Username: username,
            Password: password || null,
            KeyPath: keyPath || null
        };

        try {
            await this.createNewTab(null, sshConfig);
            document.body.removeChild(dialog);
        } catch (error) {
            alert('Failed to create SSH connection: ' + error.message);
        }
    }

    addSSHDialogCSS() {
        if (document.getElementById('ssh-dialog-styles')) return;

        const style = document.createElement('style');
        style.id = 'ssh-dialog-styles';
        style.textContent = `
            .ssh-dialog-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }

            .ssh-dialog {
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                width: 400px;
                max-width: 90vw;
            }

            .ssh-dialog-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border-color);
            }

            .ssh-dialog-header h3 {
                margin: 0;
                color: var(--text-primary);
                font-size: 16px;
            }

            .ssh-dialog-close {
                background: none;
                border: none;
                color: var(--text-primary);
                font-size: 20px;
                cursor: pointer;
                padding: 0;
                width: 24px;
                height: 24px;
            }

            .ssh-dialog-content {
                padding: 20px;
            }

            .ssh-form .form-group {
                margin-bottom: 16px;
            }

            .ssh-form .form-group label {
                display: block;
                margin-bottom: 4px;
                color: var(--text-primary);
                font-size: 14px;
            }

            .ssh-form .form-group input {
                width: 100%;
                padding: 8px 12px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border-color);
                border-radius: 4px;
                color: var(--text-primary);
                font-size: 14px;
                box-sizing: border-box;
            }

            .ssh-form .form-group input:focus {
                outline: none;
                border-color: var(--accent-color);
            }

            .ssh-dialog-footer {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                padding: 16px 20px;
                border-top: 1px solid var(--border-color);
            }

            .ssh-cancel-btn,
            .ssh-connect-btn {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                font-size: 14px;
                cursor: pointer;
                transition: background-color 0.15s ease;
            }

            .ssh-cancel-btn {
                background: var(--bg-quaternary);
                color: var(--text-primary);
            }

            .ssh-cancel-btn:hover {
                background: var(--bg-tertiary);
            }

            .ssh-connect-btn {
                background: var(--accent-color);
                color: white;
            }

            .ssh-connect-btn:hover {
                background: var(--accent-hover-color);
            }
        `;
        document.head.appendChild(style);
    }

    showTabContextMenu(tabId, x, y) {
        // Simple context menu for tab operations
        const menu = document.createElement('div');
        menu.className = 'tab-context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        
        const tab = this.tabs.get(tabId);
        const canClose = this.tabs.size > 1;
        
        menu.innerHTML = `
            <div class="context-menu-item" data-action="duplicate">Duplicate Tab</div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item ${!canClose ? 'disabled' : ''}" data-action="close">Close Tab</div>
            <div class="context-menu-item" data-action="close-others">Close Other Tabs</div>
        `;

        document.body.appendChild(menu);

        // Position menu properly
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (y - rect.height) + 'px';
        }

        // Handle menu clicks
        const handleMenuClick = async (e) => {
            const action = e.target.dataset.action;
            if (!action || e.target.classList.contains('disabled')) return;

            switch (action) {
                case 'duplicate':
                    if (tab.connectionType === 'ssh') {
                        await this.createNewTab(null, tab.sshConfig);
                    } else {
                        await this.createNewTab(tab.shell);
                    }
                    break;
                case 'close':
                    if (canClose) {
                        await this.closeTab(tabId);
                    }
                    break;
                case 'close-others':
                    const otherTabs = Array.from(this.tabs.keys()).filter(id => id !== tabId);
                    for (const otherId of otherTabs) {
                        await this.closeTab(otherId);
                    }
                    break;
            }

            document.body.removeChild(menu);
            document.removeEventListener('click', handleMenuClick);
        };

        menu.addEventListener('click', handleMenuClick);
        
        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (!menu.contains(e.target)) {
                    document.body.removeChild(menu);
                }
            }, { once: true });
        }, 0);
    }

    async loadTabs() {
        try {
            console.log('Loading tabs...');
            
            // Load shell formats first
            await this.loadShellFormats();
            
            const tabs = await GetTabs();
            console.log('Retrieved tabs:', tabs);
            
            this.tabs.clear();
            for (const tab of tabs) {
                // Enhance tab title with formatted shell name if it's a regular shell tab
                if (tab.shell && tab.connectionType !== 'ssh') {
                    const formattedShellName = this.getFormattedShellName(tab.shell);
                    tab.formattedShellName = formattedShellName;
                    // Update title to show formatted shell name instead of generic "Terminal X"
                    if (!tab.title || tab.title.startsWith('Terminal ')) {
                        tab.title = formattedShellName;
                    }
                }
                
                this.tabs.set(tab.id, tab);
                if (tab.isActive) {
                    this.activeTabId = tab.id;
                }
            }

            this.renderTabs();
            
            // If no tabs exist, create a default one
            if (this.tabs.size === 0) {
                console.log('No tabs found, creating default tab');
                await this.createNewTab();
            } else {
                console.log(`Loaded ${this.tabs.size} tabs, creating fresh shells for each...`);
                
                // Create terminal sessions for all loaded tabs using their existing session IDs
                // The backend has already created the tabs and assigned session IDs
                for (const [tabId, tab] of this.tabs) {
                    try {
                        console.log(`Setting up terminal for tab: ${tabId} (${tab.title}) with session: ${tab.sessionId}`);
                        
                        // Create terminal session using the backend's session ID
                        this.terminalManager.createTerminalSession(tab.sessionId);
                        
                        // Start shell process (backend will use the existing session ID)
                        await this.startTabShell(tabId);
                        
                        // If this is the active tab, switch to it
                        if (tab.isActive) {
                            console.log(`Switching to active tab: ${tabId}`);
                            await this.switchToTab(tabId);
                        }
                    } catch (error) {
                        console.error(`Failed to setup shell for tab ${tabId}:`, error);
                    }
                }
                
                console.log('All tabs now have fresh, isolated shells');
            }
            
            // Mark tabs system as available
            this.isAvailable = true;
            console.log('Tabs system is now available');
        } catch (error) {
            console.error('Failed to load tabs:', error);
            // Create a default tab as fallback
            console.log('Creating fallback tab due to error');
            try {
                await this.createNewTab();
                this.isAvailable = true; // Still available even with fallback
            } catch (createError) {
                console.error('Failed to create fallback tab:', createError);
                updateStatus('Failed to initialize tabs system');
                this.isAvailable = false; // Tabs system failed completely
            }
        }
    }
} 