import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// Import Wails runtime functions
import { GetPlatformInfo, GetAvailableShells, GetDefaultShell, StartShell, WriteToShell, ResizeShell, CloseShell, ShowMessageDialog, GetWSLInfo, CheckWSLAvailable } from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';

class ThermicTerminal {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.currentShell = null;
        this.platformInfo = null;
        this.sessionId = null;
        this.isConnected = false;
        
        this.init();
    }

    async init() {
        try {
            // Get platform information
            this.platformInfo = await GetPlatformInfo();
            this.updatePlatformInfo();

            // Initialize terminal
            this.initTerminal();

            // Load available shells
            await this.loadShells();

            // Set up event listeners
            this.setupEventListeners();

            // Show ready status
            this.updateStatus('Terminal ready - Select a shell to start');
        } catch (error) {
            console.error('Failed to initialize terminal:', error);
            this.updateStatus('Initialization failed');
        }
    }

    initTerminal() {
        // Create terminal instance
        this.terminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Consolas, Monaco, "Lucida Console", monospace',
            theme: {
                background: '#0c0c0c',
                foreground: '#ffffff',
                cursor: '#ffffff',
                selection: '#ffffff40',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#ffffff'
            },
            allowTransparency: true,
            rightClickSelectsWord: true,
            cols: 80,
            rows: 24
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

        // Handle resize
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
            if (this.isConnected && this.sessionId) {
                // Notify backend of terminal resize
                const cols = this.terminal.cols;
                const rows = this.terminal.rows;
                ResizeShell(this.sessionId, cols, rows);
            }
        });

        // Terminal welcome message
        this.terminal.writeln('\x1b[1;32m╔══════════════════════════════════════════════════════════════════╗\x1b[0m');
        this.terminal.writeln('\x1b[1;32m║                     Welcome to Thermic Terminal                 ║\x1b[0m');
        this.terminal.writeln('\x1b[1;32m║                  Cross-platform terminal emulator               ║\x1b[0m');
        this.terminal.writeln('\x1b[1;32m╚══════════════════════════════════════════════════════════════════╝\x1b[0m');
        this.terminal.writeln('');
        this.terminal.writeln(`Platform: ${this.platformInfo?.os || 'Unknown'} ${this.platformInfo?.arch || ''}`);
        this.terminal.writeln(`Default Shell: ${this.platformInfo?.defaultShell || 'Unknown'}`);
        
        // Show WSL info if available
        if (this.platformInfo?.wslAvailable) {
            this.terminal.writeln(`\x1b[1;36mWSL Status: Available\x1b[0m`);
            const distributions = this.platformInfo?.wslDistributions || [];
            if (distributions.length > 0) {
                this.terminal.writeln(`\x1b[36mWSL Distributions: ${distributions.length} found\x1b[0m`);
                distributions.forEach(dist => {
                    const defaultMark = dist.default ? ' (default)' : '';
                    const stateMark = dist.state === 'Running' ? '\x1b[32m●\x1b[0m' : '\x1b[33m○\x1b[0m';
                    this.terminal.writeln(`  ${stateMark} ${dist.name}${defaultMark} - ${dist.state}`);
                });
            }
        } else if (this.platformInfo?.os === 'windows') {
            this.terminal.writeln(`\x1b[90mWSL Status: Not available\x1b[0m`);
        }
        
        this.terminal.writeln('');
        this.terminal.writeln('Select a shell from the dropdown above to start a terminal session.');
        this.terminal.writeln('');

        // Handle terminal input - send to shell
        this.terminal.onData((data) => {
            if (this.isConnected && this.sessionId) {
                WriteToShell(this.sessionId, data);
            }
        });

        // We'll set up the event listener when we start a shell session
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

            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select a shell...';
            shellSelector.appendChild(defaultOption);

            // Add shells to dropdown
            shells.forEach(shell => {
                const option = document.createElement('option');
                option.value = shell;
                
                // Format shell name nicely
                let displayName = shell;
                if (shell.startsWith('wsl::')) {
                    const distName = shell.replace('wsl::', '');
                    displayName = `WSL - ${distName}`;
                } else if (shell === 'powershell.exe') {
                    displayName = 'PowerShell';
                } else if (shell === 'pwsh.exe') {
                    displayName = 'PowerShell Core';
                } else if (shell === 'cmd.exe') {
                    displayName = 'Command Prompt';
                }
                
                option.textContent = displayName;
                if (shell === defaultShell) {
                    option.textContent += ' (default)';
                }
                shellSelector.appendChild(option);
            });

            this.updateStatus(`${shells.length} shell(s) available`);
        } catch (error) {
            console.error('Failed to load shells:', error);
            this.updateStatus('Failed to load shells');
        }
    }

    setupEventListeners() {
        const shellSelector = document.getElementById('shell-selector');
        
        shellSelector.addEventListener('change', async (event) => {
            const selectedShell = event.target.value;
            if (selectedShell) {
                await this.startShell(selectedShell);
            }
        });

        // Handle window resize for terminal fitting
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

        // Handle application close
        window.addEventListener('beforeunload', () => {
            if (this.sessionId) {
                CloseShell(this.sessionId);
            }
        });
    }

    async startShell(shell) {
        try {
            // Close existing session if any
            if (this.sessionId) {
                await CloseShell(this.sessionId);
                this.isConnected = false;
            }

            this.updateStatus(`Starting ${shell}...`);
            
            // Generate unique session ID
            this.sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            // Clear terminal
            this.terminal.clear();
            
            // Set up event listener for this specific session
            EventsOn('terminal-output', (data) => {
                if (data.sessionId === this.sessionId) {
                    this.terminal.write(data.data);
                }
            });

            // Start shell with PTY
            await StartShell(shell, this.sessionId);
            
            this.isConnected = true;
            this.currentShell = shell;
            this.updateStatus(`Running ${shell} - Terminal active`);

            // Set terminal size
            setTimeout(async () => {
                const cols = this.terminal.cols;
                const rows = this.terminal.rows;
                await ResizeShell(this.sessionId, cols, rows);
            }, 100);

        } catch (error) {
            console.error('Failed to start shell:', error);
            this.terminal.writeln(`\x1b[1;31mFailed to start ${shell}: ${error.message}\x1b[0m`);
            this.updateStatus('Failed to start shell');
            
            // Show error dialog
            await ShowMessageDialog('Shell Error', `Failed to start ${shell}: ${error.message}`);
            
            this.isConnected = false;
            this.sessionId = null;
        }
    }

    updateStatus(message) {
        const statusInfo = document.getElementById('status-info');
        if (statusInfo) {
            statusInfo.textContent = message;
        }
    }

    updatePlatformInfo() {
        const platformInfo = document.getElementById('platform-info');
        if (platformInfo && this.platformInfo) {
            const hostname = this.platformInfo.hostname || 'Unknown';
            platformInfo.textContent = `${this.platformInfo.os}/${this.platformInfo.arch} @ ${hostname}`;
        }
    }
}

// Initialize the terminal when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ThermicTerminal();
});
