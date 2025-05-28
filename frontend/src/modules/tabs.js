// Tabs management module
import { CreateTab, GetTabs, SetActiveTab, CloseTab, StartTabShell, GetAvailableShellsFormatted, StartTabShellWithSize, ResizeShell, ForceDisconnectTab, ReconnectTab } from '../../wailsjs/go/main/App';
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
        this.tabActivity = new Map(); // Track activity in inactive tabs (tabId -> boolean)
    }

    init() {
        if (this.isInitialized) return;
        
        try {
            this.initTabsUI();
            this.setupTabEvents();
            this.isInitialized = true;
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
            return;
        }

        // Create the tabs bar HTML (new tab buttons will be rendered inline)
        tabsContainer.innerHTML = `
            <div class="tabs-bar">
                <div class="tabs-list" id="tabs-list">
                    <!-- Tabs and new tab buttons will be inserted here -->
                </div>
            </div>
        `;

        // Add some initial styling if not present
        this.addTabsCSS();
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
                e.preventDefault();
                e.stopPropagation();
                this.createNewTab().catch(error => {
                    console.error('Error creating new tab:', error);
                });
            } else if (e.target.closest('#new-ssh-tab-btn')) {
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
            } else if (e.target.closest('.tab-reconnect')) {
                e.stopPropagation();
                this.reconnectTab(tabId);
            } else if (e.target.closest('.tab-force-disconnect')) {
                e.stopPropagation();
                this.forceDisconnectTab(tabId);
            } else {
                this.switchToTab(tabId);
            }
        });

        // Tab right-click context menu
        document.addEventListener('contextmenu', (e) => {
            const tab = e.target.closest('.tab');
            if (tab) {
                e.preventDefault();
                e.stopPropagation();
                this.handleTabContextMenu(tab, e);
            }
        });

        // Tab status updates are now handled by the global listener in terminal manager
    }

    handleTabStatusUpdate(data) {
        const { tabId, status, errorMessage } = data;
        const tab = this.tabs.get(tabId);
        
        if (!tab) {
            return;
        }

        // Update tab data
        tab.status = status;
        tab.errorMessage = errorMessage || '';

        // Update UI
        this.updateTabStatusDisplay(tabId);
    }

    updateTabStatusDisplay(tabId) {
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (!tabElement) return;

        const tab = this.tabs.get(tabId);
        if (!tab) return;

        // Only show status for SSH connections, not local shells
        if (tab.connectionType === 'ssh') {
            // Remove all status classes
            tabElement.classList.remove('connecting', 'connected', 'failed', 'disconnected', 'hanging');
            
            // Add current status class
            if (tab.status) {
                tabElement.classList.add(tab.status);
            }

            // Update status indicator
            let statusIndicator = tabElement.querySelector('.tab-status-indicator');
            if (!statusIndicator) {
                statusIndicator = document.createElement('div');
                statusIndicator.className = 'tab-status-indicator';
                tabElement.querySelector('.tab-content').appendChild(statusIndicator);
            }

            // Update action buttons based on status
            this.updateTabActionButtons(tabElement, tab);

            // Update title to show error on hover if failed or hanging
            if ((tab.status === 'failed' || tab.status === 'hanging') && tab.errorMessage) {
                tabElement.title = `${tab.title} - ${tab.errorMessage}`;
            } else {
                tabElement.title = tab.title;
            }
        } else {
            // For local shells, remove any status indicators and action buttons
            tabElement.classList.remove('connecting', 'connected', 'failed', 'disconnected', 'hanging');
            
            const statusIndicator = tabElement.querySelector('.tab-status-indicator');
            if (statusIndicator) statusIndicator.remove();
            
            this.removeTabActionButtons(tabElement);
            
            // Just set the basic title
            tabElement.title = tab.title;
        }
    }

    updateTabActionButtons(tabElement, tab) {
        // Remove existing action buttons
        this.removeTabActionButtons(tabElement);

        const tabContent = tabElement.querySelector('.tab-content');
        const closeBtn = tabContent.querySelector('.tab-close');

        // Add appropriate action buttons based on status
        if (tab.status === 'failed') {
            const reconnectBtn = this.createActionButton('reconnect', 'Reconnect', `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
            `, () => this.reconnectTab(tab.id));
            
            if (closeBtn) {
                tabContent.insertBefore(reconnectBtn, closeBtn);
            } else {
                tabContent.appendChild(reconnectBtn);
            }
        } else if (tab.status === 'hanging') {
            // For hanging connections, show both force disconnect and reconnect options
            const forceDisconnectBtn = this.createActionButton('force-disconnect', 'Force Disconnect', `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="m18 6 12 12"></path>
                    <path d="m6 6 12 12"></path>
                    <circle cx="12" cy="12" r="10"></circle>
                </svg>
            `, () => this.forceDisconnectTab(tab.id));

            const reconnectBtn = this.createActionButton('reconnect', 'Reconnect (will force disconnect first)', `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
            `, () => this.reconnectTab(tab.id));

            if (closeBtn) {
                tabContent.insertBefore(forceDisconnectBtn, closeBtn);
                tabContent.insertBefore(reconnectBtn, closeBtn);
            } else {
                tabContent.appendChild(forceDisconnectBtn);
                tabContent.appendChild(reconnectBtn);
            }
        } else if (tab.status === 'disconnected') {
            const reconnectBtn = this.createActionButton('reconnect', 'Reconnect', `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
            `, () => this.reconnectTab(tab.id));
            
            if (closeBtn) {
                tabContent.insertBefore(reconnectBtn, closeBtn);
            } else {
                tabContent.appendChild(reconnectBtn);
            }
        }
    }

    createActionButton(className, title, iconSvg, onClick) {
        const button = document.createElement('button');
        button.className = `tab-${className}`;
        button.title = title;
        button.innerHTML = iconSvg;
        button.onclick = (e) => {
            e.stopPropagation();
            onClick();
        };
        return button;
    }

    removeTabActionButtons(tabElement) {
        const actionButtons = tabElement.querySelectorAll('.tab-reconnect, .tab-force-disconnect');
        actionButtons.forEach(btn => btn.remove());
    }

    async forceDisconnectTab(tabId) {
        try {
            updateStatus('Force disconnecting...');
            
            await ForceDisconnectTab(tabId);
            
            updateStatus('Connection forcefully closed');
        } catch (error) {
            console.error('Failed to force disconnect tab:', error);
            updateStatus(`Force disconnect failed: ${error.message}`);
        }
    }

    async reconnectTab(tabId) {
        try {
            updateStatus('Reconnecting...');
            
            if (!tabId) {
                throw new Error('Tab ID is required for reconnection');
            }
            
            const tab = this.tabs.get(tabId);
            if (!tab) {
                throw new Error(`Tab ${tabId} not found`);
            }
            
            if (tab.connectionType !== 'ssh') {
                throw new Error('Only SSH connections can be reconnected');
            }
            
            await ReconnectTab(tabId);
            updateStatus('Reconnection initiated');
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            updateStatus(`Reconnection failed: ${errorMessage}`);
            throw error;
        }
    }

    async createNewTab(shell = null, sshConfig = null) {
        try {
            updateStatus('Creating new tab...');

            // Load shell formats if not already loaded
            if (this.shellFormats.size === 0) {
                await this.loadShellFormats();
            }

            // Use default shell if none specified
            if (!shell && !sshConfig) {
                try {
                    shell = await this.terminalManager.getDefaultShell();
                } catch (error) {
                    console.warn('Failed to get default shell, using empty string:', error);
                    shell = '';
                }
            }

            // Create tab on backend (backend generates its own session ID)
            const tab = await CreateTab(shell || '', sshConfig);
            
            // Enhance tab title with formatted shell name
            if (!sshConfig && shell) {
                const formattedShellName = this.getFormattedShellName(shell);
                tab.formattedShellName = formattedShellName;
                // Update title to include formatted shell name
                tab.title = formattedShellName;
            }
            
            // Add to local tabs (use backend's session ID)
            this.tabs.set(tab.id, tab);

            // Create terminal session using backend's session ID
            this.terminalManager.createTerminalSession(tab.sessionId);

            // Switch to the new tab immediately so user can see connection progress
            await this.switchToTab(tab.id);

            // Start shell process (this will show connecting status and progress)
            await this.startTabShell(tab.id);

            updateStatus(`New tab created: ${tab.title}`);
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
            
            // IMPORTANT: Connect the frontend terminal BEFORE starting the backend shell
            // This ensures the terminal can receive error messages immediately during connection
            this.terminalManager.connectToSession(tab.sessionId);
            
            // Get current terminal dimensions for SSH sessions
            let cols = 80, rows = 24; // default fallback
            
            const terminalSession = this.terminalManager.terminals.get(tab.sessionId);
            if (terminalSession && terminalSession.terminal) {
                // Ensure terminal is fitted before getting dimensions
                if (terminalSession.fitAddon) {
                    terminalSession.fitAddon.fit();
                }
                
                cols = terminalSession.terminal.cols || 80;
                rows = terminalSession.terminal.rows || 24;
            }
            
            // Start the backend shell process with terminal dimensions
            await StartTabShellWithSize(tabId, cols, rows);
            
            // For SSH connections, send an additional resize to ensure proper synchronization
            if (tab.connectionType === 'ssh') {
                setTimeout(async () => {
                    if (terminalSession && terminalSession.terminal && terminalSession.isConnected) {
                        const currentCols = terminalSession.terminal.cols;
                        const currentRows = terminalSession.terminal.rows;
                        try {
                            await ResizeShell(tab.sessionId, currentCols, currentRows);
                        } catch (error) {
                            console.warn('Failed to sync SSH terminal size:', error);
                        }
                    }
                }, 500); // Small delay to ensure SSH session is fully established
            }
            
        } catch (error) {
            console.error(`Failed to start shell for tab ${tabId}:`, error);
            throw error;
        }
    }

    async switchToTab(tabId) {
        try {
            const tab = this.tabs.get(tabId);
            if (!tab) {
                console.error(`Tab ${tabId} not found`);
                updateStatus('Tab not found');
                return;
            }

            // Update local state immediately (optimistic update)
            this.activeTabId = tabId;
            
            // Clear activity indicator for this tab
            this.clearTabActivity(tabId);
            
            // Switch terminal manager to this session immediately
            this.terminalManager.switchToSession(tab.sessionId);
            
            // Update UI immediately
            this.renderTabs();
            updateStatus(`Switched to: ${tab.title}`);

            // Set active on backend asynchronously (don't block UI)
            SetActiveTab(tabId).catch((error) => {
                console.warn('Backend SetActiveTab failed:', error);
                // UI is already updated, so this is not critical
            });
            
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
            return;
        }

        this.closingTabs.add(tabId);

        try {
            updateStatus('Closing tab...');

            const tab = this.tabs.get(tabId);
            if (!tab) {
                console.warn('Tab not found:', tabId);
                return;
            }

            // Close backend session first to stop any incoming data
            try {
                await CloseTab(tabId);
                console.log(`Backend session closed for tab ${tabId}`);
            } catch (error) {
                console.warn('Backend CloseTab failed, continuing with cleanup:', error);
            }

            // Wait a moment for backend to fully close
            await new Promise(resolve => setTimeout(resolve, 100));

            // If this was the active tab, switch to another first (after backend close)
            if (this.activeTabId === tabId) {
                const remainingTabs = Array.from(this.tabs.keys()).filter(id => id !== tabId);
                if (remainingTabs.length > 0) {
                    try {
                        await this.switchToTab(remainingTabs[0]);
                        console.log(`Switched to tab ${remainingTabs[0]} before closing ${tabId}`);
                    } catch (switchError) {
                        console.warn('Error switching tabs during close:', switchError);
                    }
                }
            }

            // Now safely disconnect the terminal session
            this.terminalManager.disconnectSession(tab.sessionId);

            // Remove from local tabs (after all cleanup)
            this.tabs.delete(tabId);
            
            // Clear any activity tracking for this tab
            this.clearTabActivity(tabId);
            
            this.renderTabs();
            
            updateStatus('Tab closed');
        } catch (error) {
            console.error('Failed to close tab:', error);
            
            // Check if the tab was already removed from UI (optimistic update worked)
            if (!this.tabs.has(tabId)) {
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

        // Render all tabs
        for (const [tabId, tab] of this.tabs) {
            const tabElement = this.createTabElement(tab);
            tabsList.appendChild(tabElement);
        }

        // Add new tab buttons right after the last tab
        const newTabButtons = this.createNewTabButtons();
        tabsList.appendChild(newTabButtons);
    }

    createTabElement(tab) {
        const isActive = tab.id === this.activeTabId;
        const isSSH = tab.connectionType === 'ssh';
        const isLastTab = this.tabs.size <= 1;
        const hasActivity = this.hasTabActivity(tab.id);
        
        const tabEl = document.createElement('div');
        tabEl.className = `tab ${isActive ? 'active' : ''} ${isSSH ? 'ssh-tab' : ''} ${hasActivity ? 'has-activity' : ''}`;
        tabEl.dataset.tabId = tab.id;

        // Add status class only for SSH connections
        if (tab.status && isSSH) {
            tabEl.classList.add(tab.status);
        }

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

        // Show action buttons for SSH connections with issues
        let actionButtonsHtml = '';
        if (isSSH && (tab.status === 'failed' || tab.status === 'hanging' || tab.status === 'disconnected')) {
            if (tab.status === 'hanging') {
                actionButtonsHtml = `
                    <button class="tab-force-disconnect" title="Force Disconnect">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="m18 6 12 12"></path>
                            <path d="m6 6 12 12"></path>
                            <circle cx="12" cy="12" r="10"></circle>
                        </svg>
                    </button>
                    <button class="tab-reconnect" title="Reconnect (will force disconnect first)">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                    </button>
                `;
            } else {
                actionButtonsHtml = `
                    <button class="tab-reconnect" title="Reconnect">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                    </button>
                `;
            }
        }

        // Status indicator for all tabs (SSH status or activity indicator)
        const statusIndicatorHtml = '<div class="tab-status-indicator"></div>';

        // Update tooltip to include status information
        let tooltipText = tab.title || 'Untitled';
        if (isSSH && tab.status) {
            if (tab.status === 'hanging') {
                tooltipText += ' - Connection hanging (no response from server)';
            } else if (tab.status === 'failed' && tab.errorMessage) {
                tooltipText += ` - Error: ${tab.errorMessage}`;
            } else if (tab.status === 'connecting') {
                tooltipText += ' - Connecting...';
            } else if (tab.status === 'connected') {
                tooltipText += ' - Connected';
            } else if (tab.status === 'disconnected') {
                tooltipText += ' - Disconnected';
            }
        }

        tabEl.innerHTML = `
            <div class="tab-content">
                <div class="tab-icon">${iconSvg}</div>
                <div class="tab-title">${displayTitle}</div>
                ${statusIndicatorHtml}
                ${actionButtonsHtml}
                ${closeButtonHtml}
            </div>
            ${needsTooltip || (isSSH && tab.status && (tab.status === 'failed' || tab.status === 'hanging')) ? `<div class="tab-tooltip">${tooltipText}</div>` : ''}
        `;

        // Set tooltip on the element
        tabEl.title = tooltipText;

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
                            <div class="ssh-key-path-container">
                                <input type="text" id="ssh-keypath" placeholder="/path/to/private/key">
                                <button type="button" class="ssh-browse-key-btn">📂 Browse</button>
                            </div>
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
            } else if (e.target.closest('.ssh-browse-key-btn')) {
                this.handleSSHKeyBrowse();
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

    async handleSSHKeyBrowse() {
        try {
            const selectedPath = await window.go.main.App.SelectSSHPrivateKey();
            if (selectedPath) {
                const sshKeyInput = document.getElementById('ssh-keypath');
                if (sshKeyInput) {
                    sshKeyInput.value = selectedPath;
                }
            }
        } catch (error) {
            console.error('Error selecting SSH private key:', error);
            alert(`Failed to open file selector: ${error.message}`);
        }
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

            .ssh-key-path-container {
                display: flex;
                gap: 8px;
                align-items: center;
                width: 100%;
            }

            .ssh-key-path-container input {
                flex: 1;
                min-width: 0;
            }

            .ssh-browse-key-btn {
                background: var(--bg-quaternary);
                color: var(--text-primary);
                border: 1px solid var(--border-color);
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
                transition: background-color 0.15s ease;
                white-space: nowrap;
                flex-shrink: 0;
            }

            .ssh-browse-key-btn:hover {
                background: var(--bg-tertiary);
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

    handleTabContextMenu(tabElement, e) {
        const tabId = tabElement.dataset.tabId;
        const tabData = this.tabs.get(tabId);
        
        if (!tabData) {
            return;
        }
        
        // Set the tab as the context menu target and delegate to the existing context menu system
        if (window.contextMenuManager) {
            window.contextMenuManager.showTabContextMenu(e, tabElement, tabData);
        }
    }

    async loadTabs() {
        try {
            // Load shell formats first
            await this.loadShellFormats();
            
            const tabs = await GetTabs();
            
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
                await this.createNewTab();
            } else {
                // Create terminal sessions for all loaded tabs using their existing session IDs
                // The backend has already created the tabs and assigned session IDs
                for (const [tabId, tab] of this.tabs) {
                    try {
                        // Create terminal session using the backend's session ID
                        this.terminalManager.createTerminalSession(tab.sessionId);
                        
                        // Start shell process (backend will use the existing session ID)
                        await this.startTabShell(tabId);
                        
                        // If this is the active tab, switch to it
                        if (tab.isActive) {
                            await this.switchToTab(tabId);
                        }
                    } catch (error) {
                        console.error(`Failed to setup shell for tab ${tabId}:`, error);
                    }
                }
            }
            
            // Mark tabs system as available
            this.isAvailable = true;
        } catch (error) {
            console.error('Failed to load tabs:', error);
            // Create a default tab as fallback
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

    // Method to mark tab as having new activity
    markTabActivity(tabId) {
        if (tabId !== this.activeTabId) {
            this.tabActivity.set(tabId, true);
            this.renderTabs(); // Re-render to show blinking dot
        }
    }

    // Method to clear tab activity (when tab becomes active)
    clearTabActivity(tabId) {
        if (this.tabActivity.has(tabId)) {
            this.tabActivity.delete(tabId);
            this.renderTabs(); // Re-render to remove blinking dot
        }
    }

    // Method to check if tab has activity
    hasTabActivity(tabId) {
        return this.tabActivity.has(tabId) && this.tabActivity.get(tabId);
    }

    createNewTabButtons() {
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'new-tab-buttons';
        
        buttonsContainer.innerHTML = `
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
        `;

        return buttonsContainer;
    }
} 