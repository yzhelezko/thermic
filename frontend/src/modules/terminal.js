// Terminal management module
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { GetAvailableShells, GetDefaultShell, StartShell, WriteToShell, ResizeShell, CloseShell, ShowMessageDialog, WaitForSessionClose } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
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
        this.globalListenerSetup = false;
        this.globalOutputListenerSetup = false;
        this.tabsManager = tabsManager; // Reference to tabs manager for reconnection
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
                            
                            terminalSession.terminal.write(data.data);
                            
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
        // Ensure global output listener is set up
        this.setupGlobalOutputListener();
        
        // Create terminal instance with current theme
        const initialTheme = this.isDarkTheme ? THEMES.DARK : THEMES.LIGHT;
        console.log(`Creating terminal session ${sessionId} with theme:`, this.isDarkTheme ? 'dark' : 'light');

        const terminal = new Terminal({
            ...DEFAULT_TERMINAL_OPTIONS,
            theme: initialTheme
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
                    WriteToShell(sessionId, '\x0C');
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
            isConnected: false
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
            const defaultShell = await GetDefaultShell();
            
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
        const resizeObserver = new ResizeObserver(() => {
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
            resizeObserver.observe(terminalContainer);
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
                            // Force fit multiple times to ensure proper sizing
                            newSession.fitAddon.fit();
                            
                            // Additional fit after a short delay to handle any layout changes
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
                    terminalSession.container.remove();
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
            return await GetDefaultShell();
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
        
        // Filter out SSH connection animations and status messages
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
        
        // Trigger activity for actual content
        return true;
    }

    cleanup() {
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

        // Cleanup all terminal sessions
        for (const [sessionId, terminalSession] of this.terminals) {
            this.disconnectSession(sessionId);
        }
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
} 