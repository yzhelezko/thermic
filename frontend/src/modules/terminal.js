// Terminal management module
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { GetAvailableShells, GetDefaultShell, StartShell, WriteToShell, ResizeShell, CloseShell, ShowMessageDialog, WaitForSessionClose } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { THEMES, DEFAULT_TERMINAL_OPTIONS, generateSessionId, formatShellName, updateStatus } from './utils.js';

export class TerminalManager {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.currentShell = null;
        this.sessionId = null;
        this.isConnected = false;
        this.eventUnsubscribe = null;
        this.isDarkTheme = true;
    }

    initTerminal() {
        // Create terminal instance with initial theme
        const initialTheme = this.isDarkTheme ? THEMES.DARK : THEMES.LIGHT;

        this.terminal = new Terminal({
            ...DEFAULT_TERMINAL_OPTIONS,
            theme: initialTheme
        });

        // Add addons
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(new WebLinksAddon());

        // Open terminal in the container
        const terminalElement = document.getElementById('terminal');
        this.terminal.open(terminalElement);

        // Fit terminal to container
        this.fitAddon.fit();

        // Focus terminal by default
        this.terminal.focus();

        // Auto-focus when terminal container is clicked
        const terminalContainer = document.querySelector('.terminal-container');
        if (terminalContainer) {
            terminalContainer.addEventListener('click', () => {
                this.terminal.focus();
            });
        }

        // Handle resize
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
            if (this.isConnected && this.sessionId) {
                const cols = this.terminal.cols;
                const rows = this.terminal.rows;
                ResizeShell(this.sessionId, cols, rows);
            }
        });

        // Handle terminal input - send to shell
        this.terminal.onData((data) => {
            if (this.isConnected && this.sessionId) {
                WriteToShell(this.sessionId, data);
            }
        });

        // Add keyboard shortcuts for terminal functions
        this.terminal.attachCustomKeyEventHandler((event) => {
            // Ctrl+Home - scroll to top
            if (event.ctrlKey && event.code === 'Home') {
                this.terminal.scrollToTop();
                return false;
            }
            // Ctrl+End - scroll to bottom
            if (event.ctrlKey && event.code === 'End') {
                this.terminal.scrollToBottom();
                return false;
            }
            // Ctrl+L - clear terminal (common shell shortcut)
            if (event.ctrlKey && event.code === 'KeyL') {
                if (this.isConnected && this.sessionId) {
                    // Send Ctrl+L to shell instead of clearing locally
                    WriteToShell(this.sessionId, '\x0C');
                }
                return false;
            }
            return true;
        });

        this.updateTerminalContainer();
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
        if (this.terminal) {
            this.terminal.options.theme = isDarkTheme ? THEMES.DARK : THEMES.LIGHT;
            this.updateTerminalContainer();
        }
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

    fit() {
        if (this.fitAddon) {
            this.fitAddon.fit();
        }
    }

    scrollToBottom() {
        if (this.terminal) {
            this.terminal.scrollToBottom();
        }
    }

    focus() {
        if (this.terminal) {
            this.terminal.focus();
        }
    }
} 