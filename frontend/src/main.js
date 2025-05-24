import '@xterm/xterm/css/xterm.css';
import { GetDefaultShell } from '../wailsjs/go/main/App';

// Import all modules
import { DOMManager } from './modules/dom.js';
import { TerminalManager } from './modules/terminal.js';
import { ContextMenuManager } from './modules/context-menu.js';
import { WindowControlsManager } from './modules/window-controls.js';
import { UIManager } from './modules/ui.js';
import { SettingsManager } from './modules/settings.js';
import { SidebarManager } from './modules/sidebar.js';
import { StatusManager } from './modules/status.js';
import { updateStatus } from './modules/utils.js';

class ThermicTerminal {
    constructor() {
        // Initialize all managers
        this.domManager = new DOMManager();
        this.terminalManager = new TerminalManager();
        this.contextMenuManager = new ContextMenuManager(this.terminalManager);
        this.windowControlsManager = new WindowControlsManager();
        this.uiManager = new UIManager(this.terminalManager);
        this.settingsManager = new SettingsManager(this.terminalManager);
        this.sidebarManager = new SidebarManager(this.terminalManager);
        this.statusManager = new StatusManager();
        
        this.init();
        this.setupCleanup();
    }

    async init() {
        try {
            // First, generate all dynamic HTML content
            this.domManager.initializeDOM();

            // Initialize all components
            await this.initializeComponents();
            
            // Set up inter-module communication
            this.setupModuleCommunication();

            // Load available shells and start default shell
            await this.loadAndStartDefaultShell();

            // Set platform-specific styling
            this.setPlatformStyling();

        } catch (error) {
            console.error('Failed to initialize terminal:', error);
            updateStatus('Initialization failed');
        }
    }

    async initializeComponents() {
        // Initialize status first to show platform info
        await this.statusManager.initStatus();

        // Initialize UI components
        this.uiManager.initUI();
        this.settingsManager.initSettings();
        this.sidebarManager.initSidebar();

        // Initialize terminal
        this.terminalManager.initTerminal();

        // Initialize context menu
        this.contextMenuManager.init();

        // Initialize window controls (Wails handles dragging natively via CSS)
        this.windowControlsManager.init();

        // Set up terminal resize and cleanup handlers
        this.terminalManager.setupResizeObserver();
        this.terminalManager.setupBeforeUnloadHandler();
    }

    setPlatformStyling() {
        const platform = this.windowControlsManager.platform;
        document.body.classList.add(`platform-${platform}`);
        console.log('Platform detected and applied:', platform);
    }

    setupCleanup() {
        // Clean up intervals and listeners when the page unloads
        window.addEventListener('beforeunload', () => {
            if (this.windowControlsManager) {
                this.windowControlsManager.cleanup();
            }
        });

        // Also handle page visibility changes to reduce polling when hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Page is hidden, could pause polling here if needed
            } else {
                // Page is visible again
            }
        });
    }

    setupModuleCommunication() {
        // Connect UI theme changes to terminal
        this.uiManager.setThemeChangeCallback((isDarkTheme) => {
            this.terminalManager.updateTheme(isDarkTheme);
            this.settingsManager.syncDarkModeToggle(isDarkTheme);
        });

        // Connect settings theme changes to UI
        this.settingsManager.setThemeChangeCallback(() => {
            this.uiManager.toggleTheme();
        });

        // Connect UI resize events to terminal
        this.uiManager.setTerminalResizeCallback(() => {
            this.terminalManager.fit();
        });

        // Connect sidebar changes to sidebar manager
        this.uiManager.setSidebarChangeCallback((activeButton) => {
            this.sidebarManager.updateSidebarContent(activeButton);
        });

        // Set up shell selector event listener
        this.setupShellSelector();
    }

    setupShellSelector() {
        const shellSelector = document.getElementById('shell-selector');
        
        let switchTimeout = null;
        shellSelector.addEventListener('change', async (event) => {
            const selectedShell = event.target.value;
            if (selectedShell) {
                // Clear any pending switch
                if (switchTimeout) {
                    clearTimeout(switchTimeout);
                }
                
                // Disable the selector during switch
                shellSelector.disabled = true;
                updateStatus('Switching shell...');
                
                try {
                    await this.terminalManager.startShell(selectedShell);
                } catch (error) {
                    console.error('Shell switch failed:', error);
                    updateStatus('Shell switch failed');
                    
                    // Reset selector to previous value
                    const currentShell = this.terminalManager.currentShell;
                    if (currentShell) {
                        for (let option of shellSelector.options) {
                            if (option.value === currentShell) {
                                shellSelector.value = currentShell;
                                break;
                            }
                        }
                    } else {
                        shellSelector.value = '';
                    }
                } finally {
                    shellSelector.disabled = false;
                }
            }
        });
    }

    async loadAndStartDefaultShell() {
        try {
            // Load available shells
            const { shells, defaultShell } = await this.terminalManager.loadShells();

            // Auto-start default shell
            if (defaultShell) {
                const shellSelector = document.getElementById('shell-selector');
                shellSelector.value = defaultShell;
                
                console.log('Starting default shell:', defaultShell);
                await this.terminalManager.startShell(defaultShell);
            } else {
                console.error('No default shell detected');
                updateStatus('No default shell found - Please select a shell manually');
            }
        } catch (error) {
            console.error('Failed to load shells or start default shell:', error);
            updateStatus('Failed to initialize shell system');
        }
    }
}

// Initialize the terminal when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ThermicTerminal();
});
