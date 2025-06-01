import '@xterm/xterm/css/xterm.css';
import { GetDefaultShell } from '../wailsjs/go/main/App';

// Import all modules
import { DOMManager } from './modules/dom.js';
import { TerminalManager } from './modules/terminal.js';
import { TabsManager } from './modules/tabs.js';
import { ContextMenuManager } from './modules/context-menu.js';
import { WindowControlsManager } from './modules/window-controls.js';
import { UIManager } from './modules/ui.js';
import { SettingsManager } from './modules/settings.js';
import { SidebarManager } from './modules/sidebar.js';
import { ActivityBarManager } from './modules/activity-bar.js';
import { StatusManager } from './modules/status.js';
import { RemoteExplorerManager } from './modules/remote-explorer.js';
import { updateStatus } from './modules/utils.js';
import VersionManager from './components/VersionManager.js';
import { modal } from './components/Modal.js';
import { notification } from './components/Notification.js';

// Import icon utilities
import { initializeIcons, debugThemeState, updateAllIconsToInline } from './utils/icons.js';

// Platform detection for window controls
function detectPlatform() {
    const userAgent = navigator.userAgent.toLowerCase();
    let platform = 'unknown';
    
    if (userAgent.includes('mac')) {
        platform = 'darwin';
    } else if (userAgent.includes('win')) {
        platform = 'windows';
    } else if (userAgent.includes('linux')) {
        platform = 'linux';
    }
    
    // Add platform class to body for CSS targeting
    document.body.classList.add(`platform-${platform}`);
    
    return platform;
}

class ThermicTerminal {
    constructor() {
        // Initialize all managers
        this.domManager = new DOMManager();
        this.terminalManager = new TerminalManager(); // Initialize without tabs manager first
        this.tabsManager = new TabsManager(this.terminalManager);
        
        // Now update terminal manager with tabs manager reference
        this.terminalManager.tabsManager = this.tabsManager;
        
        // Initialize remote explorer first
        this.remoteExplorerManager = new RemoteExplorerManager(this.tabsManager);
        
        // Pass remote explorer to context menu manager
        this.contextMenuManager = new ContextMenuManager(this.terminalManager, this.remoteExplorerManager);
        this.windowControlsManager = new WindowControlsManager();
        this.uiManager = new UIManager();
        this.settingsManager = new SettingsManager();
        this.sidebarManager = new SidebarManager();
        this.activityBarManager = new ActivityBarManager(this.sidebarManager, this.uiManager);
        this.statusManager = new StatusManager();
        this.versionManager = null; // Initialize later after DOM is ready
        
        this.platform = detectPlatform();
        
        this.init();
        this.setupCleanup();
    }

    async init() {
        try {
            console.log('Starting Thermic initialization...');
            
            // First, generate all dynamic HTML content
            console.log('Initializing DOM...');
            this.domManager.initializeDOM();

            // Initialize all components
            console.log('Initializing components...');
            await this.initializeComponents();
            
            // Set up inter-module communication
            console.log('Setting up module communication...');
            this.setupModuleCommunication();

            // Load tabs and initialize tab system
            try {
                console.log('Attempting to load tabs system...');
                await this.tabsManager.loadTabs();
                console.log('Tabs system loaded successfully');
            } catch (error) {
                console.error('Failed to load tabs system:', error);
                console.error('Stack trace:', error.stack);
                updateStatus('Tabs system failed to initialize - using fallback terminal');
                
                // Initialize a fallback terminal if tabs fail
                try {
                    console.log('Initializing fallback terminal...');
                    await this.initializeFallbackTerminal();
                } catch (fallbackError) {
                    console.error('Fallback terminal also failed:', fallbackError);
                    updateStatus('Critical error: Unable to initialize terminal');
                }
            }

            // Set platform-specific styling
            console.log('Setting platform-specific styling...');
            this.setPlatformStyling();
            
            console.log('Thermic initialization completed successfully!');
            updateStatus('Application ready');

        } catch (error) {
            console.error('Failed to initialize Thermic application:', error);
            console.error('Stack trace:', error.stack);
            updateStatus('Initialization failed: ' + error.message);
        }
    }

    async initializeComponents() {
        try {
            // Initialize icons first
            console.log('Initializing icon system...');
            await initializeIcons();
            
            // Initialize status first to show platform info
            console.log('Initializing status manager...');
            await this.statusManager.initStatus();

            // Initialize UI components
            console.log('Initializing UI manager...');
            await this.uiManager.initUI();
            
            console.log('Initializing settings manager...');
            this.settingsManager.initSettings();
            
            console.log('Initializing sidebar manager...');
            await this.sidebarManager.initSidebar();
            
            console.log('Initializing activity bar manager...');
            await this.activityBarManager.init();
            
            // Initialize remote explorer
            console.log('Initializing remote explorer manager...');
            this.remoteExplorerManager.init();
            
            // Expose sidebar manager globally for back buttons
            window.sidebarManager = this.sidebarManager;
            
            // Expose activity bar manager globally
            window.activityBarManager = this.activityBarManager;
            
            // Expose tabs manager globally for event handling
            window.tabsManager = this.tabsManager;
            
            // Expose remote explorer globally for integration
            window.remoteExplorerManager = this.remoteExplorerManager;
            
            // Expose status manager globally for event handling
            window.statusManager = this.statusManager;
            
            // Expose context menu manager globally for tab context menu integration
            window.contextMenuManager = this.contextMenuManager;
            
            // Expose the main app instance globally for settings integration
            window.thermicApp = this;

            // Initialize terminal
            console.log('Initializing terminal manager...');
            this.terminalManager.initTerminal();

            // Initialize tabs manager AFTER DOM is ready
            console.log('Initializing tabs manager...');
            this.tabsManager.init();

            // Connect status manager with tabs manager
            this.statusManager.setTabsManager(this.tabsManager);
            
            // Set up tab switch monitoring for status updates
            this.setupTabSwitchMonitoring();

            // Initialize context menu
            console.log('Initializing context menu manager...');
            await this.contextMenuManager.init();

            // Initialize window controls (Wails handles dragging natively via CSS)
            // Skip on macOS since we use native window controls there
            if (this.windowControlsManager.platform !== 'darwin') {
                console.log('Initializing window controls manager...');
                this.windowControlsManager.init();
            } else {
                console.log('Skipping window controls manager on macOS (using native controls)');
            }
            
            // Initialize version manager AFTER DOM is fully ready
            console.log('Initializing version manager...');
            this.versionManager = new VersionManager();
            
            // Convert all existing icons to inline SVGs for proper theme support
            console.log('Converting icons to inline SVGs for theme support...');
            await updateAllIconsToInline();
            
            console.log('Component initialization completed successfully');
        } catch (error) {
            console.error('Critical error during component initialization:', error);
            console.error('Stack trace:', error.stack);
            
            // Show error in status bar
            updateStatus('Initialization failed: ' + error.message);
        }

        // Set up terminal resize and cleanup handlers
        this.terminalManager.setupResizeObserver();
        this.terminalManager.setupBeforeUnloadHandler();

        // Debounced window resize event emitter
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.terminalManager.handleResize();
            }, 100);
        });
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
            if (this.versionManager) {
                this.versionManager.destroy();
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

        // Connect settings theme changes to UI (this is now handled by activity bar manager)
        this.settingsManager.setThemeChangeCallback(() => {
            // This callback is now mainly for backward compatibility
            // The actual theme switching is handled by the activity bar manager
            console.log('Settings theme change callback called (handled by activity bar manager)');
        });

        // Connect UI resize events to terminal
        this.uiManager.setTerminalResizeCallback(() => {
            this.terminalManager.fit();
        });

        // Initialize settings dark mode toggle with current theme
        const currentTheme = document.documentElement.getAttribute('data-theme') || 
                           (document.body.classList.contains('dark-mode') ? 'dark' : 'light');
        const isDarkTheme = currentTheme === 'dark';
        this.activityBarManager.isDarkTheme = isDarkTheme;
        this.activityBarManager.syncSettingsDarkModeToggle(isDarkTheme);

        // Set up shell selector event listener
        this.setupShellSelector();

        // Set up tab keyboard shortcuts
        this.setupTabShortcuts();
    }

    setupShellSelector() {
        // Shell selection is now handled in the settings panel only
        // when tabs system is active. This prevents accidentally changing
        // shells for existing tabs when the default shell preference is changed.
        
        const shellSelector = document.getElementById('shell-selector');
        
        if (!shellSelector) {
            return; // Expected since shell selector is in settings panel
        }
        
        // Check if this is the settings panel shell selector
        const isInSettingsPanel = shellSelector.closest('.settings-panel') !== null;
        
        if (isInSettingsPanel) {
            // Don't disable this one - it's the one we want to keep working
            return;
        }
        
        // Only disable shell selectors that are NOT in the settings panel
        shellSelector.style.display = 'none';
        shellSelector.disabled = true;
    }

    setupTabShortcuts() {
        // Listen for tab-related keyboard events
        document.addEventListener('terminal:new-tab', () => {
            this.tabsManager.createNewTab();
        });

        document.addEventListener('terminal:close-tab', (e) => {
            if (e.detail && e.detail.sessionId) {
                // Find tab by session ID
                for (const [tabId, tab] of this.tabsManager.tabs) {
                    if (tab.sessionId === e.detail.sessionId) {
                        this.tabsManager.closeTab(tabId);
                        break;
                    }
                }
            }
        });

        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+T - New tab
            if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
                e.preventDefault();
                this.tabsManager.createNewTab();
            }
            // Ctrl+Shift+N - New SSH tab
            else if (e.ctrlKey && e.shiftKey && e.code === 'KeyN') {
                e.preventDefault();
                this.tabsManager.showSSHDialog();
            }
        });
    }

    setupTabSwitchMonitoring() {
        // Override the switchToTab method to notify status manager
        const originalSwitchToTab = this.tabsManager.switchToTab.bind(this.tabsManager);
        
        this.tabsManager.switchToTab = async (tabId) => {
            const result = await originalSwitchToTab(tabId);
            
            // Notify status manager of tab switch
            if (this.statusManager) {
                this.statusManager.onTabSwitch(tabId);
            }
            
            // Update status bar class for SSH connections
            this.updateStatusBarClass();
            
            return result;
        };
        
        // Also monitor for tab close events
        const originalCloseTab = this.tabsManager.closeTab.bind(this.tabsManager);
        
        this.tabsManager.closeTab = async (tabId) => {
            const result = await originalCloseTab(tabId);
            
            // Update status after tab close
            if (this.statusManager) {
                setTimeout(() => {
                    this.statusManager.onTabSwitch(this.tabsManager.activeTabId);
                    this.updateStatusBarClass();
                }, 100);
            }
            
            return result;
        };
    }

    updateStatusBarClass() {
        const statusBar = document.querySelector('.status-bar');
        if (!statusBar) return;
        
        // Get active tab info
        const activeTab = this.tabsManager.tabs.get(this.tabsManager.activeTabId);
        
        // Update status bar class based on connection type
        statusBar.classList.remove('ssh-active', 'local-active');
        
        if (activeTab) {
            if (activeTab.connectionType === 'ssh') {
                statusBar.classList.add('ssh-active'); 
                // Visibility of specific stats like load/uptime is handled by StatusManager based on data availability
            } else {
                statusBar.classList.add('local-active');
                // Visibility of specific stats like load/uptime is handled by StatusManager
            }
        }
    }

    async initializeFallbackTerminal() {
        console.log('Setting up fallback terminal without tabs system');
        
        // Load available shells for the selector
        try {
            await this.terminalManager.loadShells();
        } catch (error) {
            console.warn('Failed to load shells for fallback terminal:', error);
        }

        // Start with default shell
        try {
            const defaultShell = await this.terminalManager.getDefaultShell();
            console.log('Starting fallback terminal with default shell:', defaultShell);
            await this.terminalManager.startShell(defaultShell);
            updateStatus('Fallback terminal ready');
        } catch (error) {
            console.error('Failed to start fallback terminal:', error);
            updateStatus('Terminal initialization failed');
            throw error;
        }
    }
}

// Initialize the terminal when the page loads - v2.0
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, waiting for Wails to be ready...');
    
    // Wait for Wails bindings to be available
    function waitForWails() {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 10000; // 10 second timeout
            
            function checkWails() {
                if (window.go && window.go.main && window.go.main.App) {
                    console.log('Wails bindings are ready');
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Timeout waiting for Wails bindings'));
                } else {
                    console.log('Waiting for Wails bindings...');
                    setTimeout(checkWails, 100);
                }
            }
            checkWails();
        });
    }
    
    // Initialize the application after Wails is ready
    waitForWails().then(() => {
        console.log('Initializing Thermic Terminal...');
        try {
            const app = new ThermicTerminal();
            // Store reference globally for debugging
            window.thermicApp = app;
        } catch (error) {
            console.error('Critical error during application startup:', error);
            console.error('Stack trace:', error.stack);
            
            // Show error in UI if possible
            const statusElement = document.getElementById('status-info');
            if (statusElement) {
                statusElement.textContent = 'Startup failed: ' + error.message;
                statusElement.style.color = 'red';
            }
        }
    }).catch((error) => {
        console.error('Failed to wait for Wails:', error);
        
        // Show error in UI
        const statusElement = document.getElementById('status-info');
        if (statusElement) {
            statusElement.textContent = 'Wails initialization failed: ' + error.message;
            statusElement.style.color = 'red';
        }
        
        // Also try to show a user-friendly message
        document.body.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background: #1a1a1a; color: #fff; font-family: Arial, sans-serif;">
                <div style="text-align: center; padding: 20px;">
                    <h2>Application Initialization Failed</h2>
                    <p>The Wails runtime failed to initialize properly.</p>
                    <p>Please try restarting the application.</p>
                    <p style="color: #ff6b6b; font-size: 12px; margin-top: 20px;">Error: ${error.message}</p>
                </div>
            </div>
        `;
    });
});