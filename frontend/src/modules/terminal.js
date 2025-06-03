// Terminal management module
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { GetAvailableShells, StartShell, WriteToShell, ResizeShell, CloseShell, ShowMessageDialog, WaitForSessionClose, ConfigGet, ConfigSet, ApproveHostKeyUpdate } from '../../wailsjs/go/main/App';
import { EventsOn, EventsEmit } from '../../wailsjs/runtime/runtime';
import { THEMES, DEFAULT_TERMINAL_OPTIONS, generateSessionId, formatShellName, updateStatus } from './utils.js';

export class TerminalManager {
    constructor(tabsManager = null) {
        this.terminals = new Map(); // sessionId -> { terminal, fitAddon, container, isConnected }
        this.activeSessionId = null;
        this.currentShell = null;
        this.isDarkTheme = true;
        
        // Default terminal instance for compatibility
        this.terminal = null;
        this.fitAddon = null;
        this.sessionId = null;
        this.isConnected = false;
        this.eventUnsubscribe = null;
        
        // Global terminal output handler - single listener for all sessions
        this.globalOutputListener = null;
        this.globalTabStatusListener = null;
        this.globalTabSwitchListener = null;
        this.globalSizeSyncListener = null;
        this.globalConfigListener = null;
        this.globalListenerSetup = false;
        this.globalOutputListenerSetup = false;
        this.tabsManager = tabsManager; // Reference to tabs manager for reconnection
        
        // Resource management
        this.maxSessions = 50;
        this.resizeObserver = null;
        this.cleanupInterval = null;
        
        // Host key prompt mode
        this.hostKeyPromptMode = {
            active: false,
            sessionId: null,
            keydownHandler: null
        };
        
        // Terminal configuration
        this.scrollbackLines = 10000; // Will be loaded from backend
        this.maxBufferLines = this.scrollbackLines; // Updated when scrollbackLines changes
        
        // Load terminal config from backend
        this.loadTerminalConfig();
        
        // Set up terminal size sync system for SSH connections
        this.setupTerminalSizeSync();
        
        // Set up config change listeners
        this.setupConfigListeners();
        
        // Start resource monitoring
        this.startResourceMonitoring();
    }

    setupGlobalOutputListener() {
        if (!this.globalListenerSetup) {
            console.log('Setting up global event listeners');
            try {
                // Set up terminal output listener
                this.globalOutputListener = EventsOn('terminal-output', (data) => {
                    // Validate data first
                    if (!data || !data.sessionId) {
                        console.warn('Invalid terminal output data received:', data);
                        return;
                    }
                    
                    const sessionId = data.sessionId;
                    console.log(`Global listener received output for session: ${sessionId}`);
                    
                    // Track activity for inactive tabs
                    if (this.tabsManager && sessionId !== this.activeSessionId) {
                        // Filter out certain types of output that shouldn't trigger activity
                        if (this.shouldTriggerActivity(data.data)) {
                            // Find the tab associated with this session
                            const tabId = this.findTabBySessionId(sessionId);
                            if (tabId) {
                                this.tabsManager.markTabActivity(tabId);
                            }
                        }
                    }
                    
                    // Route output to the correct terminal session
                    const terminalSession = this.terminals.get(sessionId);
                    
                    if (terminalSession && terminalSession.isConnected && terminalSession.terminal) {
                        try {
                            console.log(`Writing output to terminal session: ${sessionId}`);
                            
                            // Check if we're at the bottom before writing
                            const isAtBottom = terminalSession.terminal.buffer.active.viewportY >= 
                                              terminalSession.terminal.buffer.active.baseY;
                            
                            // Process SSH status messages for better display
                            const processedData = this.processSSHMessage(data.data, sessionId);
                            terminalSession.terminal.write(processedData);
                            
                            // Auto-scroll to bottom if we were already at the bottom
                            if (isAtBottom || terminalSession.terminal.buffer.active.length === 0) {
                                setTimeout(() => {
                                    // Double-check session still exists and is connected
                                    const currentSession = this.terminals.get(sessionId);
                                    if (currentSession && currentSession.terminal && currentSession.isConnected) {
                                        currentSession.terminal.scrollToBottom();
                                    }
                                }, 0);
                            }
                        } catch (error) {
                            console.error(`Error writing to terminal session ${sessionId}:`, error);
                            // Mark session as problematic to avoid further errors
                            if (terminalSession) {
                                terminalSession.isConnected = false;
                            }
                        }
                    } else if (!terminalSession) {
                        // This is expected after closing a tab - backend might still send some final output
                        console.log(`Ignoring output for closed session: ${sessionId}`);
                    } else if (!terminalSession.isConnected) {
                        console.log(`Ignoring output for disconnected session: ${sessionId}`);
                    } else {
                        console.warn(`Session ${sessionId} exists but terminal is missing:`, terminalSession);
                    }
                });

                // Set up tab status update listener
                this.globalTabStatusListener = EventsOn('tab-status-update', (data) => {
                    console.log('Global listener received tab status update:', data);
                    
                    // Forward to tabs manager if it exists
                    if (window.tabsManager && typeof window.tabsManager.handleTabStatusUpdate === 'function') {
                        window.tabsManager.handleTabStatusUpdate(data);
                    } else {
                        console.warn('TabsManager not available for status update:', data);
                    }
                });

                // Set up tab switch listener for status bar updates
                this.globalTabSwitchListener = EventsOn('tab-switched', (data) => {
                    console.log('Global listener received tab switch event:', data);
                    
                    // Forward to status manager if it exists
                    if (window.statusManager && typeof window.statusManager.onTabSwitch === 'function') {
                        window.statusManager.onTabSwitch(data.tabId);
                    } else {
                        console.warn('StatusManager not available for tab switch:', data);
                    }
                });

                // Set up host key prompt listener
                this.globalHostKeyPromptListener = EventsOn('host-key-prompt', (data) => {
                    console.log('Global listener received host key prompt:', data);
                    this.enableHostKeyPromptMode(data.sessionId);
                });

                this.globalListenerSetup = true;
                console.log('Global event listeners set up successfully');
            } catch (error) {
                console.error('Failed to set up global listeners:', error);
            }
        } else {
            console.log('Global event listeners already set up');
        }
    }

    initTerminal() {
        // Initialize the main terminal container
        const terminalElement = document.getElementById('terminal');
        if (!terminalElement) {
            console.error('Terminal container not found');
            return;
        }

        // Create initial terminal session (will be managed by tabs)
        this.updateTerminalContainer();
    }

    createTerminalSession(sessionId) {
        // Check session limits
        if (this.terminals.size >= this.maxSessions) {
            throw new Error(`Maximum terminal sessions (${this.maxSessions}) reached`);
        }
        
        // Ensure global output listener is set up
        this.setupGlobalOutputListener();
        
        // Create terminal instance with current theme and backend config
        const initialTheme = this.isDarkTheme ? THEMES.DARK : THEMES.LIGHT;
        console.log(`Creating terminal session ${sessionId} with theme:`, this.isDarkTheme ? 'dark' : 'light');

        const terminal = new Terminal({
            ...DEFAULT_TERMINAL_OPTIONS,
            theme: initialTheme,
            scrollback: this.scrollbackLines // Use backend config
        });

        // Add addons
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());

        // Create terminal container div with wrapper for proper padding
        const terminalContainer = document.createElement('div');
        terminalContainer.className = 'terminal-instance';
        terminalContainer.dataset.sessionId = sessionId;
        terminalContainer.style.display = 'none'; // Initially hidden

        // Create wrapper div for padding
        const terminalWrapper = document.createElement('div');
        terminalWrapper.className = 'terminal-wrapper';
        terminalContainer.appendChild(terminalWrapper);

        // Add to main terminal container
        const mainContainer = document.getElementById('terminal');
        mainContainer.appendChild(terminalContainer);

        // Open terminal in the wrapper (not the container)
        terminal.open(terminalWrapper);

        // Delay fit to ensure container is properly sized
        setTimeout(() => {
            fitAddon.fit();
        }, 100);

        // Handle terminal input - send to shell
        terminal.onData((data) => {
            console.log(`Terminal input received for session ${sessionId}:`, data.charCodeAt(0));
            const terminalSession = this.terminals.get(sessionId);
            
            // Update last activity
            if (terminalSession) {
                terminalSession.lastActivity = Date.now();
            }
            
            // Check for Enter key (char code 13) and if we should trigger reconnection
            if (data.charCodeAt(0) === 13 && this.tabsManager) {
                const shouldReconnect = this.checkForReconnection(sessionId);
                if (shouldReconnect) {
                    console.log(`Enter key pressed - triggering reconnection for session ${sessionId}`);
                    return; // Don't send Enter to shell, just trigger reconnection
                }
            }
            
            if (terminalSession && terminalSession.isConnected) {
                console.log(`Sending input to shell for session ${sessionId}`);
                WriteToShell(sessionId, data).catch(error => {
                    console.error(`Failed to write to shell ${sessionId}:`, error);
                });
            } else {
                console.warn(`Cannot send input to shell ${sessionId} - session not connected`);
            }
        });

        // Add keyboard shortcuts for terminal functions
        terminal.attachCustomKeyEventHandler((event) => {
            // Ctrl+Home - scroll to top
            if (event.ctrlKey && event.code === 'Home') {
                terminal.scrollToTop();
                return false;
            }
            // Ctrl+End - scroll to bottom
            if (event.ctrlKey && event.code === 'End') {
                terminal.scrollToBottom();
                return false;
            }
            // Ctrl+L - clear terminal (common shell shortcut)
            if (event.ctrlKey && event.code === 'KeyL') {
                const terminalSession = this.terminals.get(sessionId);
                if (terminalSession && terminalSession.isConnected) {
                    // Use frontend terminal clearing that respects clearScrollback setting
                    this.clearTerminal(sessionId);
                }
                return false;
            }
            // Ctrl+T - new tab
            if (event.ctrlKey && event.code === 'KeyT') {
                // Emit event for new tab
                document.dispatchEvent(new CustomEvent('terminal:new-tab'));
                return false;
            }
            // Ctrl+W - close tab
            if (event.ctrlKey && event.code === 'KeyW') {
                // Emit event for close tab
                document.dispatchEvent(new CustomEvent('terminal:close-tab', { detail: { sessionId } }));
                return false;
            }
            return true;
        });

        // Auto-focus when terminal container is clicked
        terminalContainer.addEventListener('click', () => {
            terminal.focus();
        });

        // Store terminal session (no individual event listener needed)
        const terminalSession = {
            terminal,
            fitAddon,
            container: terminalContainer,
            isConnected: false,
            created: Date.now(),
            lastActivity: Date.now(),
            resizeHandler: null,
            resizeTimeout: null
        };

        this.terminals.set(sessionId, terminalSession);

        // Set up resize handling for this terminal
        this.setupTerminalResize(sessionId);

        return terminalSession;
    }

    setupTerminalResize(sessionId) {
        // Handle resize for specific terminal with debouncing and proper dimension calculation
        let resizeTimeout;
        const resizeHandler = () => {
            // Clear previous timeout to debounce rapid resize events
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
            }
            
            resizeTimeout = setTimeout(() => {
                const terminalSession = this.terminals.get(sessionId);
                if (terminalSession && sessionId === this.activeSessionId) {
                    try {
                        // Force a reflow to ensure accurate measurements
                        terminalSession.container.offsetHeight;
                        
                        // Use proposeDimensions to get exact dimensions that fit properly
                        const proposedDimensions = terminalSession.fitAddon.proposeDimensions();
                        
                        if (proposedDimensions && proposedDimensions.cols > 0 && proposedDimensions.rows > 0) {
                            // Use the proposed dimensions to ensure exact fit
                            terminalSession.terminal.resize(proposedDimensions.cols, proposedDimensions.rows);
                            
                            // Additional fit after resize to ensure proper layout
                            setTimeout(() => {
                                if (terminalSession.fitAddon && this.terminals.has(sessionId)) {
                                    terminalSession.fitAddon.fit();
                                    
                                    // Update shell size if connected
                                    if (terminalSession.isConnected) {
                                        const cols = terminalSession.terminal.cols;
                                        const rows = terminalSession.terminal.rows;
                                        ResizeShell(sessionId, cols, rows).catch(error => {
                                            console.warn('Error resizing shell during window resize:', error);
                                        });
                                    }
                                }
                            }, 10);
                        } else {
                            // Fallback to regular fit if proposeDimensions fails
                            terminalSession.fitAddon.fit();
                            
                            setTimeout(() => {
                                if (terminalSession.fitAddon && this.terminals.has(sessionId)) {
                                    terminalSession.fitAddon.fit();
                                    
                                    if (terminalSession.isConnected) {
                                        const cols = terminalSession.terminal.cols;
                                        const rows = terminalSession.terminal.rows;
                                        ResizeShell(sessionId, cols, rows).catch(error => {
                                            console.warn('Error resizing shell during window resize:', error);
                                        });
                                    }
                                }
                            }, 50);
                        }
                    } catch (error) {
                        console.warn('Error during terminal resize:', error);
                        // Fallback to basic fit on error
                        try {
                            terminalSession.fitAddon.fit();
                        } catch (fallbackError) {
                            console.error('Fallback fit also failed:', fallbackError);
                        }
                    }
                }
            }, 100); // Debounce resize events by 100ms
        };

        window.addEventListener('resize', resizeHandler);
        
        // Store resize handler for cleanup
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession) {
            terminalSession.resizeHandler = resizeHandler;
            terminalSession.resizeTimeout = resizeTimeout;
        }
    }

    async loadShells() {
        try {
            const shells = await GetAvailableShells();
            const defaultShell = await ConfigGet("DefaultShell");
            
            const shellSelector = document.getElementById('shell-selector');
            shellSelector.innerHTML = '';

            if (shells.length === 0) {
                shellSelector.innerHTML = '<option value="">No shells found</option>';
                return;
            }

            shells.forEach(shell => {
                const option = document.createElement('option');
                option.value = shell;
                
                let displayName = formatShellName(shell);
                
                option.textContent = displayName;
                if (shell === defaultShell) {
                    option.textContent += ' (default)';
                }
                shellSelector.appendChild(option);
            });

            updateStatus(`${shells.length} shell(s) available`);
            return { shells, defaultShell };
        } catch (error) {
            console.error('Failed to load shells:', error);
            updateStatus('Failed to load shells');
            throw error;
        }
    }

    async startShell(shell) {
        try {
            if (this.sessionId) {
                updateStatus('Closing previous session...');
                await this.cleanupSession();
                
                updateStatus('Previous session closed. Preparing new session...');
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            updateStatus(`Starting ${shell}...`);
            
            this.sessionId = generateSessionId();
            
            this.terminal.clear();
            
            this.eventUnsubscribe = EventsOn('terminal-output', (data) => {
                if (data.sessionId === this.sessionId && this.isConnected) {
                    // Check if we're at the bottom before writing
                    const isAtBottom = this.terminal.buffer.active.viewportY >= 
                                      this.terminal.buffer.active.baseY;
                    
                    this.terminal.write(data.data);
                    
                    // Auto-scroll to bottom if we were already at the bottom
                    // or if this is the first output
                    if (isAtBottom || this.terminal.buffer.active.length === 0) {
                        // Use setTimeout to ensure the write operation completes first
                        setTimeout(() => {
                            this.terminal.scrollToBottom();
                        }, 0);
                    }
                }
            });

            await StartShell(shell, this.sessionId);
            
            this.isConnected = true;
            this.currentShell = shell;
            updateStatus(`Running ${shell} - Terminal active`);

            // Auto-scroll to bottom for new shell
            setTimeout(() => {
                if (this.terminal) {
                    this.terminal.scrollToBottom();
                }
            }, 100);

            setTimeout(async () => {
                if (this.isConnected && this.sessionId) {
                    const cols = this.terminal.cols;
                    const rows = this.terminal.rows;
                    await ResizeShell(this.sessionId, cols, rows);
                }
            }, 300);

        } catch (error) {
            console.error('Failed to start shell:', error);
            this.terminal.writeln(`\x1b[1;31mFailed to start ${shell}: ${error.message}\x1b[0m`);
            updateStatus('Failed to start shell');
            
            await ShowMessageDialog('Shell Error', `Failed to start ${shell}: ${error.message}`);
            
            if (this.eventUnsubscribe) {
                this.eventUnsubscribe();
                this.eventUnsubscribe = null;
            }
            
            this.isConnected = false;
            this.sessionId = null;
        }
    }

    async cleanupSession() {
        if (this.sessionId) {
            const sessionToClose = this.sessionId;
            
            if (this.eventUnsubscribe) {
                this.eventUnsubscribe();
                this.eventUnsubscribe = null;
            }
            
            this.isConnected = false;
            
            try {
                await CloseShell(sessionToClose);
                await WaitForSessionClose(sessionToClose);
            } catch (error) {
                console.warn('Error during session cleanup:', error);
            }
            
            this.sessionId = null;
            this.currentShell = null;
        }
    }

    updateTheme(isDarkTheme) {
        this.isDarkTheme = isDarkTheme;
        const newTheme = isDarkTheme ? THEMES.DARK : THEMES.LIGHT;
        
        console.log(`Updating terminal theme to: ${isDarkTheme ? 'dark' : 'light'}`);
        
        // Update all terminal sessions, not just the active one
        for (const [sessionId, terminalSession] of this.terminals) {
            if (terminalSession.terminal) {
                // Update the theme
                terminalSession.terminal.options.theme = newTheme;
                
                // Force a refresh to apply the new theme immediately
                try {
                    terminalSession.terminal.refresh(0, terminalSession.terminal.rows - 1);
                    console.log(`Updated and refreshed theme for session ${sessionId}`);
                } catch (error) {
                    console.warn(`Error refreshing terminal session ${sessionId}:`, error);
                }
            }
        }
        
        // Also update the legacy terminal instance for backward compatibility
        if (this.terminal) {
            this.terminal.options.theme = newTheme;
            try {
                this.terminal.refresh(0, this.terminal.rows - 1);
                console.log('Updated and refreshed theme for legacy terminal instance');
            } catch (error) {
                console.warn('Error refreshing legacy terminal:', error);
            }
        }
        
        this.updateTerminalContainer();
        console.log('Terminal theme update completed');
    }

    updateTerminalContainer() {
        const terminalContainer = document.querySelector('.terminal-container');
        if (terminalContainer) {
            terminalContainer.style.backgroundColor = this.isDarkTheme ? '#0c0c0c' : '#ffffff';
        }
    }

    setupResizeObserver() {
        // Cleanup existing observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        
        this.resizeObserver = new ResizeObserver(() => {
            if (this.fitAddon) {
                setTimeout(() => {
                    this.fitAddon.fit();
                    if (this.isConnected && this.sessionId) {
                        const cols = this.terminal.cols;
                        const rows = this.terminal.rows;
                        ResizeShell(this.sessionId, cols, rows);
                    }
                }, 100);
            }
        });
        
        const terminalContainer = document.querySelector('.terminal-container');
        if (terminalContainer) {
            this.resizeObserver.observe(terminalContainer);
        }
    }

    setupBeforeUnloadHandler() {
        window.addEventListener('beforeunload', () => {
            if (this.sessionId) {
                if (this.eventUnsubscribe) {
                    this.eventUnsubscribe();
                }
                CloseShell(this.sessionId);
            }
        });
    }

    connectToSession(sessionId) {
        console.log(`Connecting to session: ${sessionId}`);
        
        // Create terminal session if it doesn't exist
        if (!this.terminals.has(sessionId)) {
            console.log(`Creating new terminal session: ${sessionId}`);
            this.createTerminalSession(sessionId);
        }

        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession) {
            console.error(`Failed to get terminal session: ${sessionId}`);
            return;
        }
        
        // Reset terminal state for reconnections
        if (terminalSession.terminal) {
            console.log(`Resetting terminal state for session: ${sessionId}`);
            this.resetTerminalState(terminalSession.terminal);
        }
        
        // Mark session as connected (global output listener will handle routing)
        terminalSession.isConnected = true;
        console.log(`Session ${sessionId} marked as connected - using global output listener`);
        
        this.sessionId = sessionId; // For backward compatibility
        this.isConnected = true; // For backward compatibility
        
        // Switch to this session to make it visible
        this.switchToSession(sessionId);
    }

    resetTerminalState(terminal) {
        try {
            // Reset terminal state without clearing the screen (backend will handle that)
            // This ensures the frontend terminal is in a clean state
            
            // Reset cursor and scrolling state
            terminal.reset();
            
            // Clear any selection
            terminal.clearSelection();
            
            // Ensure we're at the bottom of the buffer
            terminal.scrollToBottom();
            
            console.log('Terminal state reset successfully');
        } catch (error) {
            console.warn('Error resetting terminal state:', error);
        }
    }

    switchToSession(sessionId) {
        console.log(`Switching to session: ${sessionId}, current active: ${this.activeSessionId}`);
        
        // Skip if already active
        if (this.activeSessionId === sessionId) {
            console.log(`Session ${sessionId} is already active`);
            return;
        }
        
        // Hide current active terminal
        if (this.activeSessionId) {
            const currentSession = this.terminals.get(this.activeSessionId);
            if (currentSession && currentSession.container) {
                console.log(`Hiding current session: ${this.activeSessionId}`);
                try {
                    currentSession.container.style.display = 'none';
                } catch (error) {
                    console.warn('Error hiding current session:', error);
                }
            }
        }

        // Show and activate new terminal
        const newSession = this.terminals.get(sessionId);
        if (newSession && newSession.container && newSession.terminal) {
            console.log(`Showing new session: ${sessionId}`);
            try {
                newSession.container.style.display = 'block';
                
                // Update active session first
                this.activeSessionId = sessionId;
                
                // Update backward compatibility properties
                this.terminal = newSession.terminal;
                this.fitAddon = newSession.fitAddon;
                this.sessionId = sessionId;
                this.isConnected = newSession.isConnected;
                this.eventUnsubscribe = this.globalOutputListener;
                
                // Focus and fit the terminal with proper timing
                setTimeout(() => {
                    try {
                        if (newSession.terminal && newSession.fitAddon) {
                            // For SSH connections, be more aggressive about sizing
                            const isSSH = this.isSSHConnection(sessionId);
                            
                            if (isSSH) {
                                // SSH requires precise sizing - use proposed dimensions
                                const proposedDimensions = newSession.fitAddon.proposeDimensions();
                                
                                if (proposedDimensions && proposedDimensions.cols > 0 && proposedDimensions.rows > 0) {
                                    // Resize to proposed dimensions first
                                    newSession.terminal.resize(proposedDimensions.cols, proposedDimensions.rows);
                                    
                                    setTimeout(() => {
                                        newSession.fitAddon.fit();
                                        
                                        // Update shell size for SSH
                                        if (newSession.isConnected) {
                                            const cols = newSession.terminal.cols;
                                            const rows = newSession.terminal.rows;
                                            console.log(`SSH tab switch - updating size to ${cols}x${rows}`);
                                            ResizeShell(sessionId, cols, rows).catch(error => {
                                                console.warn('Error resizing SSH shell on tab switch:', error);
                                            });
                                        }
                                        
                                        newSession.terminal.focus();
                                        console.log(`SSH Terminal ${sessionId} fitted (${newSession.terminal.cols}x${newSession.terminal.rows}) and focused`);
                                    }, 20);
                                } else {
                                    // Fallback for SSH
                                    newSession.fitAddon.fit();
                                    setTimeout(() => {
                                        newSession.fitAddon.fit();
                                        if (newSession.isConnected) {
                                            const cols = newSession.terminal.cols;
                                            const rows = newSession.terminal.rows;
                                            ResizeShell(sessionId, cols, rows).catch(error => {
                                                console.warn('Error resizing shell on tab switch:', error);
                                            });
                                        }
                                        newSession.terminal.focus();
                                        console.log(`Terminal ${sessionId} fitted (${newSession.terminal.cols}x${newSession.terminal.rows}) and focused`);
                                    }, 50);
                                }
                            } else {
                                // Local shells - simpler sizing
                                newSession.fitAddon.fit();
                                
                                setTimeout(() => {
                                    newSession.fitAddon.fit();
                                    
                                    // Update shell size if connected
                                    if (newSession.isConnected) {
                                        const cols = newSession.terminal.cols;
                                        const rows = newSession.terminal.rows;
                                        ResizeShell(sessionId, cols, rows).catch(error => {
                                            console.warn('Error resizing shell on tab switch:', error);
                                        });
                                    }
                                    
                                    // Focus after fitting is complete
                                    newSession.terminal.focus();
                                    console.log(`Terminal ${sessionId} fitted (${newSession.terminal.cols}x${newSession.terminal.rows}) and focused`);
                                }, 50);
                            }
                        }
                    } catch (error) {
                        console.warn('Error focusing/fitting terminal:', error);
                    }
                }, 100);
                
                console.log(`Successfully switched to session: ${sessionId}`);
            } catch (error) {
                console.error('Error during session switch:', error);
            }
        } else {
            console.error(`Session ${sessionId} not found or incomplete`);
            
            // Try to create session if it doesn't exist (but don't block)
            if (!this.terminals.has(sessionId)) {
                console.log(`Attempting to create missing session: ${sessionId}`);
                console.warn(`Session ${sessionId} was missing - this indicates the terminal session was lost`);
                console.warn(`Frontend terminal will be created but backend shell may need to be restarted`);
                try {
                    this.createTerminalSession(sessionId);
                    // Try switching again after a short delay
                    setTimeout(() => {
                        if (this.terminals.has(sessionId)) {
                            this.switchToSession(sessionId);
                        }
                    }, 100);
                } catch (error) {
                    console.error('Error creating missing session:', error);
                }
            }
        }
    }

    disconnectSession(sessionId) {
        console.log(`Disconnecting session: ${sessionId}`);
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession) {
            // Mark as disconnected first to stop any ongoing operations
            terminalSession.isConnected = false;
            
            // Cleanup resize timeout if it exists
            if (terminalSession.resizeTimeout) {
                try {
                    clearTimeout(terminalSession.resizeTimeout);
                } catch (error) {
                    console.warn('Error clearing resize timeout:', error);
                }
                terminalSession.resizeTimeout = null;
            }
            
            // Cleanup resize handler safely
            if (terminalSession.resizeHandler) {
                try {
                    window.removeEventListener('resize', terminalSession.resizeHandler);
                } catch (error) {
                    console.warn('Error removing resize handler:', error);
                }
                terminalSession.resizeHandler = null;
            }
            
            // Properly dispose of the terminal instance to free memory and event listeners
            if (terminalSession.terminal) {
                try {
                    // Clear any selection and reset state
                    terminalSession.terminal.clearSelection();
                    
                    // Dispose of the terminal instance properly
                    terminalSession.terminal.dispose();
                    console.log(`Terminal instance disposed for session ${sessionId}`);
                } catch (error) {
                    console.warn('Error disposing terminal instance:', error);
                }
                terminalSession.terminal = null;
            }
            
            // Hide and remove terminal container safely
            if (terminalSession.container) {
                try {
                    terminalSession.container.style.display = 'none';
                    
                    // Remove all event listeners from container
                    const newContainer = terminalSession.container.cloneNode(true);
                    terminalSession.container.parentNode.replaceChild(newContainer, terminalSession.container);
                    newContainer.remove();
                } catch (error) {
                    console.warn('Error removing terminal container:', error);
                }
                terminalSession.container = null;
            }
            
            // Clear fitAddon reference
            if (terminalSession.fitAddon) {
                terminalSession.fitAddon = null;
            }
            
            // Remove from sessions
            this.terminals.delete(sessionId);
            
            // If this was the active session, clear active session only if no other sessions exist
            if (this.activeSessionId === sessionId) {
                // Check if there are other sessions available
                const remainingSessions = Array.from(this.terminals.keys());
                if (remainingSessions.length > 0) {
                    // Don't clear active session, let the switching logic handle it
                    console.log(`Session ${sessionId} was active, but ${remainingSessions.length} sessions remain`);
                } else {
                    // No other sessions, clear active session
                    this.activeSessionId = null;
                    this.terminal = null;
                    this.fitAddon = null;
                    this.sessionId = null;
                    this.isConnected = false;
                    this.eventUnsubscribe = this.globalOutputListener;
                }
            }
            
            console.log(`Session ${sessionId} disconnected and cleaned up successfully`);
        } else {
            console.warn(`Session ${sessionId} not found for disconnection`);
        }
    }

    async getDefaultShell() {
        try {
            return await ConfigGet("DefaultShell");
        } catch (error) {
            console.error('Failed to get default shell:', error);
            return 'cmd.exe'; // Fallback for Windows
        }
    }

    fit() {
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (terminalSession && terminalSession.fitAddon) {
                try {
                    // Use proposeDimensions for more accurate sizing
                    const proposedDimensions = terminalSession.fitAddon.proposeDimensions();
                    
                    if (proposedDimensions && proposedDimensions.cols > 0 && proposedDimensions.rows > 0) {
                        // Use the proposed dimensions to ensure exact fit
                        terminalSession.terminal.resize(proposedDimensions.cols, proposedDimensions.rows);
                        
                        // Follow up with fit to ensure proper layout
                        setTimeout(() => {
                            if (terminalSession.fitAddon) {
                                terminalSession.fitAddon.fit();
                                
                                // Update shell size if connected
                                if (terminalSession.isConnected) {
                                    const cols = terminalSession.terminal.cols;
                                    const rows = terminalSession.terminal.rows;
                                    ResizeShell(this.activeSessionId, cols, rows).catch(error => {
                                        console.warn('Error resizing shell in fit():', error);
                                    });
                                }
                            }
                        }, 10);
                    } else {
                        // Fallback to regular fit if proposeDimensions fails
                        terminalSession.fitAddon.fit();
                        setTimeout(() => {
                            if (terminalSession.fitAddon) {
                                terminalSession.fitAddon.fit();
                                
                                // Update shell size if connected
                                if (terminalSession.isConnected) {
                                    const cols = terminalSession.terminal.cols;
                                    const rows = terminalSession.terminal.rows;
                                    ResizeShell(this.activeSessionId, cols, rows).catch(error => {
                                        console.warn('Error resizing shell in fit():', error);
                                    });
                                }
                            }
                        }, 10);
                    }
                } catch (error) {
                    console.warn('Error in fit() method:', error);
                    // Fallback to basic fit
                    try {
                        terminalSession.fitAddon.fit();
                    } catch (fallbackError) {
                        console.error('Fallback fit also failed:', fallbackError);
                    }
                }
            }
        } else if (this.fitAddon) {
            this.fitAddon.fit();
        }
    }

    handleResize() {
        // Handle window resize - fit terminals and notify backend of window state change
        console.log('Handling window resize...');
        
        // Fit all terminal sessions to their containers
        this.fit();
        
        // Also fit any other active terminals
        for (const [sessionId, terminalSession] of this.terminals) {
            if (terminalSession && terminalSession.fitAddon) {
                try {
                    terminalSession.fitAddon.fit();
                    
                    // Update shell size if connected
                    if (terminalSession.isConnected) {
                        const cols = terminalSession.terminal.cols;
                        const rows = terminalSession.terminal.rows;
                        ResizeShell(sessionId, cols, rows).catch(error => {
                            console.warn(`Error resizing shell ${sessionId}:`, error);
                        });
                    }
                } catch (error) {
                    console.warn(`Error resizing terminal session ${sessionId}:`, error);
                }
            }
        }
        
        // Emit resize event to backend to save window state
        try {
            EventsEmit('frontend:window:resized').catch(error => {
                console.warn('Error emitting window resize event:', error);
            });
        } catch (error) {
            console.warn('Error emitting resize event to backend:', error);
        }
    }

    scrollToBottom() {
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (terminalSession) {
                terminalSession.terminal.scrollToBottom();
            }
        } else if (this.terminal) {
            this.terminal.scrollToBottom();
        }
    }

    focus() {
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (terminalSession) {
                terminalSession.terminal.focus();
            }
        } else if (this.terminal) {
            this.terminal.focus();
        }
    }

    findTabBySessionId(sessionId) {
        if (!this.tabsManager) return null;
        
        for (const [tabId, tab] of this.tabsManager.tabs) {
            if (tab.sessionId === sessionId) {
                return tabId;
            }
        }
        return null;
    }

    shouldTriggerActivity(data) {
        // Don't trigger activity for certain types of output
        if (!data || typeof data !== 'string') return false;
        
        // Filter out SSH connection status messages with new format
        if (data.includes('SSH Connection') || 
            data.includes('Connecting...') ||
            data.includes('Connected to') ||
            data.includes('Connection established') ||
            data.includes('╭─') || data.includes('╰─') || // SSH status borders
            data.match(/^\033\[[0-9;]*[mK]$/) || // Pure ANSI escape sequences
            data.trim() === '' || // Empty content
            data === '\r' || // Just carriage returns
            data.length < 2) { // Very short content
            return false;
        }
        
        // Filter out new formatted SSH status messages (they shouldn't trigger activity)
        if (data.includes('● Authentication:') ||
            data.includes('⏳ Connecting to') ||
            data.includes('⏳ Creating session') ||
            data.includes('⏳ Loading key:') ||
            data.includes('⏳ Discovering authentication') ||
            data.includes('✓ Connection established') ||
            data.includes('✓ SSH session ready') ||
            data.includes('● New host:') ||
            data.includes('⏳ Adding') && data.includes('to known hosts') ||
            data.includes('✓ Host') && data.includes('verified and added')) {
            return false;
        }
        
        // Trigger activity for actual user content and important warnings/errors
        return true;
    }

    processSSHMessage(data, sessionId) {
        // Don't process empty or non-string data
        if (!data || typeof data !== 'string') {
            return data;
        }

        // Check if this is an SSH connection message by looking for our new format
        const isSSHMessage = data.includes('●') || data.includes('✓') || data.includes('⚠') || data.includes('⏳') || data.includes('✗');
        
        if (!isSSHMessage) {
            return data; // Return original data if not an SSH status message
        }

        // Add some spacing and formatting improvements for SSH messages
        let processedData = data;

        // Add subtle animation effect for progress messages
        if (data.includes('⏳')) {
            // Add a subtle pulse effect using ANSI sequences (optional enhancement)
            processedData = data.replace('⏳', '\x1b[2m⏳\x1b[0m\x1b[90m');
        }

        // Make success messages slightly more prominent
        if (data.includes('✓')) {
            processedData = data.replace('✓', '\x1b[1m✓\x1b[0m');
        }

        // Make warning messages more noticeable
        if (data.includes('⚠')) {
            processedData = data.replace('⚠', '\x1b[1m⚠\x1b[0m');
        }

        // Add subtle visual separation for SSH connection flow
        if (data.includes('✓ SSH session ready')) {
            // Update tab status for successful connection
            this.updateSSHConnectionStatus(sessionId, 'connected');
        }

        // Handle connection errors
        if (data.includes('✗') && (data.includes('failed') || data.includes('error'))) {
            this.updateSSHConnectionStatus(sessionId, 'failed');
        }

        // Handle warnings
        if (data.includes('⚠') && data.includes('Host key changed')) {
            this.updateSSHConnectionStatus(sessionId, 'warning');
        }

        return processedData;
    }

    updateSSHConnectionStatus(sessionId, status) {
        // Find the tab associated with this session and update its visual state
        if (this.tabsManager) {
            const tabId = this.findTabBySessionId(sessionId);
            if (tabId) {
                // Emit a custom event that the tabs manager can listen to
                const event = new CustomEvent('ssh-connection-status', {
                    detail: { 
                        sessionId, 
                        tabId, 
                        status,
                        timestamp: Date.now()
                    }
                });
                document.dispatchEvent(event);
                
                // Also log for debugging
                console.log(`SSH connection status updated: ${sessionId} -> ${status}`);
            }
        }
    }

    async loadTerminalConfig() {
        try {
            const scrollbackLines = await ConfigGet("ScrollbackLines");
            
            this.scrollbackLines = scrollbackLines;
            this.maxBufferLines = scrollbackLines;
            
            console.log(`Loaded terminal config: scrollback=${scrollbackLines}`);
            
            // Update existing terminals with new config
            this.applyConfigToAllTerminals();
        } catch (error) {
            console.warn('Failed to load terminal config from backend:', error);
            // Use defaults if backend fails
            this.scrollbackLines = 10000;
            this.maxBufferLines = 10000;
        }
    }

    setupConfigListeners() {
        // Listen for config changes from backend
        EventsOn('config:scrollback-lines-changed', (data) => {
            const { scrollbackLines } = data;
            console.log(`Scrollback lines changed to: ${scrollbackLines}`);
            this.scrollbackLines = scrollbackLines;
            this.maxBufferLines = scrollbackLines;
            this.applyConfigToAllTerminals();
        });


    }

    applyConfigToAllTerminals() {
        // Update all existing terminal sessions with new config
        for (const [sessionId, terminalSession] of this.terminals) {
            if (terminalSession.terminal) {
                try {
                    // Update terminal options
                    terminalSession.terminal.options.scrollback = this.scrollbackLines;
                    console.log(`Updated scrollback for session ${sessionId} to ${this.scrollbackLines} lines`);
                } catch (error) {
                    console.warn(`Error updating config for session ${sessionId}:`, error);
                }
            }
        }
    }

    // Host key prompt mode methods
    enableHostKeyPromptMode(sessionId) {
        console.log(`Enabling host key prompt mode for session: ${sessionId}`);
        
        this.hostKeyPromptMode.active = true;
        this.hostKeyPromptMode.sessionId = sessionId;
        
        // Add visual indicator to the terminal
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession && terminalSession.container) {
            terminalSession.container.classList.add('host-key-prompt-active');
        }
        
        // Set up global keyboard listener
        this.hostKeyPromptMode.keydownHandler = (event) => {
            this.handleHostKeyPromptInput(event);
        };
        
        document.addEventListener('keydown', this.hostKeyPromptMode.keydownHandler, true);
        console.log('Host key prompt mode enabled - listening for keyboard input');
    }

    disableHostKeyPromptMode() {
        console.log('Disabling host key prompt mode');
        
        const sessionId = this.hostKeyPromptMode.sessionId;
        this.hostKeyPromptMode.active = false;
        this.hostKeyPromptMode.sessionId = null;
        
        // Remove visual indicator
        if (sessionId) {
            const terminalSession = this.terminals.get(sessionId);
            if (terminalSession && terminalSession.container) {
                terminalSession.container.classList.remove('host-key-prompt-active');
            }
        }
        
        // Remove keyboard event listener
        if (this.hostKeyPromptMode.keydownHandler) {
            document.removeEventListener('keydown', this.hostKeyPromptMode.keydownHandler, true);
            this.hostKeyPromptMode.keydownHandler = null;
        }
        
        console.log('Host key prompt mode disabled');
    }

    handleHostKeyPromptInput(event) {
        if (!this.hostKeyPromptMode.active) return;
        
        const sessionId = this.hostKeyPromptMode.sessionId;
        console.log(`Host key prompt input: ${event.key} for session: ${sessionId}`);
        
        // Handle Enter key (approve)
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, true);
            this.disableHostKeyPromptMode();
        }
        // Handle Escape key (reject)
        else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, false);
            this.disableHostKeyPromptMode();
        }
        // Handle 'y' or 'Y' for yes
        else if (event.key.toLowerCase() === 'y') {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, true);
            this.disableHostKeyPromptMode();
        }
        // Handle 'n' or 'N' for no
        else if (event.key.toLowerCase() === 'n') {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, false);
            this.disableHostKeyPromptMode();
        }
    }

    async approveHostKey(sessionId, approved) {
        try {
            console.log(`Host key ${approved ? 'approved' : 'rejected'} for session: ${sessionId}`);
            
            await ApproveHostKeyUpdate(sessionId, approved);
            
            if (approved) {
                console.log('Host key updated successfully. You can now retry the connection.');
            } else {
                console.log('Host key update cancelled by user.');
            }
            
        } catch (error) {
            console.error('Failed to process host key approval:', error);
        }
    }

    cleanup() {
        // Stop resource monitoring
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Cleanup resize observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        
        // Cleanup global listeners
        if (this.globalOutputListener) {
            try {
                this.globalOutputListener();
            } catch (error) {
                console.warn('Error cleaning up global output listener:', error);
            }
            this.globalOutputListener = null;
        }

        if (this.globalTabStatusListener) {
            try {
                this.globalTabStatusListener();
            } catch (error) {
                console.warn('Error cleaning up global tab status listener:', error);
            }
            this.globalTabStatusListener = null;
        }

        if (this.globalTabSwitchListener) {
            try {
                this.globalTabSwitchListener();
            } catch (error) {
                console.warn('Error cleaning up global tab switch listener:', error);
            }
            this.globalTabSwitchListener = null;
        }
        
        if (this.globalSizeSyncListener) {
            try {
                this.globalSizeSyncListener();
            } catch (error) {
                console.warn('Error cleaning up global size sync listener:', error);
            }
            this.globalSizeSyncListener = null;
        }

        if (this.globalConfigListener) {
            try {
                this.globalConfigListener();
            } catch (error) {
                console.warn('Error cleaning up global config listener:', error);
            }
            this.globalConfigListener = null;
        }

        if (this.globalHostKeyPromptListener) {
            try {
                this.globalHostKeyPromptListener();
            } catch (error) {
                console.warn('Error cleaning up global host key prompt listener:', error);
            }
            this.globalHostKeyPromptListener = null;
        }

        // Disable host key prompt mode if active
        if (this.hostKeyPromptMode.active) {
            this.disableHostKeyPromptMode();
        }

        // Cleanup all terminal sessions
        for (const [sessionId, terminalSession] of this.terminals) {
            this.disconnectSession(sessionId);
        }
        
        // Clear terminals map
        this.terminals.clear();
    }

    checkForReconnection(sessionId) {
        // Find the tab associated with this session
        for (const [tabId, tab] of this.tabsManager.tabs) {
            if (tab.sessionId === sessionId) {
                // Check if it's an SSH tab that is disconnected/failed/hanging
                const isSSH = tab.connectionType === 'ssh';
                const needsReconnection = tab.status === 'failed' || tab.status === 'disconnected' || tab.status === 'hanging';
                
                if (isSSH && needsReconnection) {
                    // Trigger reconnection
                    this.tabsManager.reconnectTab(tabId).catch(error => {
                        console.error('Failed to reconnect tab via Enter key:', error);
                    });
                    return true;
                }
                break;
            }
        }
        return false;
    }

    setupTerminalSizeSync() {
        // Clean up existing listeners first
        if (this.globalSizeSyncListener) {
            try {
                this.globalSizeSyncListener();
            } catch (error) {
                console.warn('Error cleaning up size sync listener:', error);
            }
        }
        
        // Listen for terminal size requests from backend using Wails EventsOn
        this.globalSizeSyncListener = EventsOn('terminal-size-request', (data) => {
            const { sessionId } = data;
            console.log(`Received terminal size request for session: ${sessionId}`);
            this.handleTerminalSizeRequest(sessionId);
        });
        
        // Listen for immediate terminal size sync requests (for SSH connections)
        EventsOn('terminal-size-sync-request', (data) => {
            const { sessionId, immediate } = data;
            console.log(`Received terminal size sync request for session: ${sessionId}, immediate: ${immediate}`);
            if (immediate) {
                // For immediate requests, do aggressive terminal fitting and sizing
                setTimeout(() => {
                    this.handleImmediateTerminalSizeSync(sessionId);
                }, 50); // Shorter delay for immediate requests
            } else {
                this.handleTerminalSizeRequest(sessionId);
            }
        });
        
        // Reduce periodic size sync to prevent constant resizing
        // Only sync SSH connections and only every 30 seconds to avoid disrupting VIM/editors
        setInterval(() => {
            this.syncSSHTerminalSizes();
        }, 30000); // Sync every 30 seconds instead of 5
    }

    handleTerminalSizeRequest(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.terminal) {
            console.warn(`Terminal size request for unknown session: ${sessionId}`);
            return;
        }

        // Only resize if the terminal is visible and active to avoid disrupting editors
        const isActiveSession = sessionId === this.activeSessionId;
        if (!isActiveSession) {
            console.log(`Skipping size sync for inactive session: ${sessionId}`);
            return;
        }

        // Get current dimensions without forcing a fit (to avoid disruption)
        const currentCols = terminalSession.terminal.cols || 80;
        const currentRows = terminalSession.terminal.rows || 24;

        // Check if size has actually changed since last sync
        const lastSyncedSize = terminalSession.lastSyncedSize;
        if (lastSyncedSize && 
            lastSyncedSize.cols === currentCols && 
            lastSyncedSize.rows === currentRows) {
            console.log(`Terminal size unchanged for ${sessionId}: ${currentCols}x${currentRows}`);
            return;
        }

        console.log(`Syncing terminal size for ${sessionId}: ${currentCols}x${currentRows}`);

        // Store the size we're syncing to avoid redundant calls
        terminalSession.lastSyncedSize = { cols: currentCols, rows: currentRows };

        // Send current size to backend
        ResizeShell(sessionId, currentCols, currentRows).catch(error => {
            console.warn(`Failed to sync terminal size for ${sessionId}:`, error);
            // Clear the stored size on error so we can retry later
            delete terminalSession.lastSyncedSize;
        });
    }

    handleImmediateTerminalSizeSync(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.terminal) {
            console.warn(`Immediate terminal size sync for unknown session: ${sessionId}`);
            return;
        }

        console.log(`Performing immediate terminal size sync for ${sessionId}`);

        // For immediate sync (SSH connections), always force fit and get accurate dimensions
        if (terminalSession.fitAddon) {
            // Force multiple fits to ensure accurate sizing
            terminalSession.fitAddon.fit();
            
            // Use proposeDimensions for most accurate sizing
            const proposedDimensions = terminalSession.fitAddon.proposeDimensions();
            
            if (proposedDimensions && proposedDimensions.cols > 0 && proposedDimensions.rows > 0) {
                // Resize terminal to proposed dimensions first
                terminalSession.terminal.resize(proposedDimensions.cols, proposedDimensions.rows);
                
                // Then fit again to ensure proper layout
                setTimeout(() => {
                    if (terminalSession.fitAddon) {
                        terminalSession.fitAddon.fit();
                        
                        // Get final dimensions and send to backend
                        const finalCols = terminalSession.terminal.cols || proposedDimensions.cols;
                        const finalRows = terminalSession.terminal.rows || proposedDimensions.rows;
                        
                        console.log(`Immediate sync - final dimensions for ${sessionId}: ${finalCols}x${finalRows}`);
                        
                        // Clear any cached size to force the update
                        delete terminalSession.lastSyncedSize;
                        
                        // Send size to backend
                        ResizeShell(sessionId, finalCols, finalRows).catch(error => {
                            console.warn(`Failed to sync immediate terminal size for ${sessionId}:`, error);
                        });
                    }
                }, 10);
            } else {
                // Fallback to regular terminal dimensions
                const cols = terminalSession.terminal.cols || 80;
                const rows = terminalSession.terminal.rows || 24;
                
                console.log(`Immediate sync - fallback dimensions for ${sessionId}: ${cols}x${rows}`);
                
                // Clear any cached size to force the update
                delete terminalSession.lastSyncedSize;
                
                ResizeShell(sessionId, cols, rows).catch(error => {
                    console.warn(`Failed to sync immediate terminal size (fallback) for ${sessionId}:`, error);
                });
            }
        } else {
            // No fit addon available, use current dimensions
            const cols = terminalSession.terminal.cols || 80;
            const rows = terminalSession.terminal.rows || 24;
            
            console.log(`Immediate sync - no fitAddon, using current dimensions for ${sessionId}: ${cols}x${rows}`);
            
            // Clear any cached size to force the update
            delete terminalSession.lastSyncedSize;
            
            ResizeShell(sessionId, cols, rows).catch(error => {
                console.warn(`Failed to sync immediate terminal size (no addon) for ${sessionId}:`, error);
            });
        }
    }

    syncSSHTerminalSizes() {
        // Only sync SSH connections and only if they haven't been resized recently
        this.terminals.forEach((terminalSession, sessionId) => {
            if (terminalSession.isConnected && terminalSession.terminal) {
                // Check if this is an SSH connection
                const isSSH = this.isSSHConnection(sessionId);
                if (isSSH) {
                    // Only sync if the session is active or if it's been a while since last sync
                    const isActiveSession = sessionId === this.activeSessionId;
                    const now = Date.now();
                    const lastSync = terminalSession.lastSizeSync || 0;
                    const timeSinceLastSync = now - lastSync;
                    
                    // Sync if it's the active session or if it's been more than 2 minutes
                    if (isActiveSession || timeSinceLastSync > 120000) {
                        console.log(`Syncing SSH terminal size for session: ${sessionId}`);
                        this.handleTerminalSizeRequest(sessionId);
                        terminalSession.lastSizeSync = now;
                    }
                }
            }
        });
    }

    isSSHConnection(sessionId) {
        // Check if this session belongs to an SSH tab
        // This is a simple check - you could enhance this by storing connection type
        const tabManager = window.tabsManager;
        if (!tabManager) return false;
        
        for (const [tabId, tab] of tabManager.tabs) {
            if (tab.sessionId === sessionId && tab.connectionType === 'ssh') {
                return true;
            }
        }
        return false;
    }

    startResourceMonitoring() {
        // Monitor resource usage every 30 seconds
        this.cleanupInterval = setInterval(() => {
            this.performResourceCleanup();
        }, 30000);
    }

    performResourceCleanup() {
        try {
            // Cleanup disconnected sessions
            for (const [sessionId, terminalSession] of this.terminals) {
                if (!terminalSession.isConnected && !terminalSession.terminal) {
                    console.log(`Cleaning up orphaned session: ${sessionId}`);
                    this.terminals.delete(sessionId);
                }
                
                // Note: Removed automatic terminal clearing when buffer gets large
                // xterm.js handles buffer limits naturally by scrolling old content out
                // Auto-clearing was disruptive to user experience
            }
            
            // Enforce session limits
            if (this.terminals.size > this.maxSessions) {
                console.warn(`Too many terminal sessions (${this.terminals.size}), cleaning up oldest`);
                this.cleanupOldestSessions(this.terminals.size - this.maxSessions);
            }
        } catch (error) {
            console.warn('Error during resource cleanup:', error);
        }
    }

    cleanupOldestSessions(count) {
        // Sort by last activity or creation time
        const sessions = Array.from(this.terminals.entries())
            .filter(([_, session]) => !session.isConnected)
            .sort((a, b) => (a[1].lastActivity || 0) - (b[1].lastActivity || 0))
            .slice(0, count);
            
        for (const [sessionId] of sessions) {
            console.log(`Force cleaning up old session: ${sessionId}`);
            this.disconnectSession(sessionId);
        }
    }

    clearTerminal(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession && terminalSession.terminal) {
            // Always clear everything including scrollback buffer
            terminalSession.terminal.reset();
        }
    }
} 