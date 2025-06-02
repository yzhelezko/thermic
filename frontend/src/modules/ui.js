// UI management module
import { showNotification, updateStatus } from './utils.js';

export class UIManager {
    constructor() {
        this.isDarkTheme = true; // Default to dark theme, will be synced
        this.tabs = [{ id: 'terminal-1', title: 'Terminal 1', active: true }];
        this.tabCounter = 1;
        this.sidebarWidth = 250;
        this.sidebarCollapsed = false;
        this.onThemeChange = null;
        this.onTerminalResize = null;
        this.saveWidthTimeout = null; // For debouncing width saves
    }

    setThemeChangeCallback(callback) {
        this.onThemeChange = callback;
    }

    setTerminalResizeCallback(callback) {
        this.onTerminalResize = callback;
    }

    async initUI() {
        // Load sidebar state from backend config
        await this.loadSidebarState();
        
        this.setupThemeToggle();
        this.setupResizablePanels();
        
        // Initialize CSS custom property for sidebar width
        document.documentElement.style.setProperty('--sidebar-width', this.sidebarWidth + 'px');
    }

    async loadSidebarState() {
        try {
            // Load sidebar state from backend
                    const collapsed = await window.go.main.App.ConfigGet("SidebarCollapsed");
        const width = await window.go.main.App.ConfigGet("SidebarWidth");
            
            this.sidebarCollapsed = collapsed;
            this.sidebarWidth = width;
            
            console.log(`Loaded sidebar state: collapsed=${collapsed}, width=${width}`);
        } catch (error) {
            console.warn('Failed to load sidebar state from config:', error);
            // Use defaults if loading fails
            this.sidebarCollapsed = false;
            this.sidebarWidth = 250;
        }
    }

    async saveSidebarCollapsed() {
        try {
            await window.go.main.App.ConfigSet("SidebarCollapsed", this.sidebarCollapsed);
            console.log(`Saved sidebar collapsed state: ${this.sidebarCollapsed}`);
        } catch (error) {
            console.warn('Failed to save sidebar collapsed state to config:', error);
        }
    }

    async saveSidebarWidth() {
        try {
            await window.go.main.App.ConfigSet("SidebarWidth", this.sidebarWidth);
            console.log(`Saved sidebar width: ${this.sidebarWidth}`);
        } catch (error) {
            console.warn('Failed to save sidebar width to config:', error);
        }
    }

    async saveSidebarState() {
        try {
            await window.go.main.App.ConfigSet("SidebarCollapsed", this.sidebarCollapsed);
            await window.go.main.App.ConfigSet("SidebarWidth", this.sidebarWidth);
            console.log(`Saved sidebar state: collapsed=${this.sidebarCollapsed}, width=${this.sidebarWidth}`);
        } catch (error) {
            console.warn('Failed to save sidebar state to config:', error);
        }
    }

    setSidebarCollapsed(collapsed) {
        if (this.sidebarCollapsed !== collapsed) {
            this.sidebarCollapsed = collapsed;
            this.saveSidebarCollapsed(); // Save immediately for collapsed state
        }
    }

    setSidebarWidth(width) {
        if (this.sidebarWidth !== width) {
            this.sidebarWidth = width;
            
            // Debounce width saves to avoid too many calls during resizing
            if (this.saveWidthTimeout) {
                clearTimeout(this.saveWidthTimeout);
            }
            
            this.saveWidthTimeout = setTimeout(() => {
                this.saveSidebarWidth();
                this.saveWidthTimeout = null;
            }, 300); // Save after 300ms of no changes
        }
    }

    setupThemeToggle() {
        // Theme toggle is now handled by activity bar manager
        // This method is kept for backward compatibility but does nothing
    }

    setupResizablePanels() {
        this.setupResize('sidebar-resize', 'left');
    }

    updateProfilePanelPosition() {
        // Update CSS custom property for profile panel positioning
        document.documentElement.style.setProperty('--sidebar-width', this.sidebarWidth + 'px');
    }

    setupResize(handleId, direction) {
        const handle = document.getElementById(handleId);
        if (!handle) return;
        
        let isResizing = false;
        let lastUpdateTime = 0;
        const throttleDelay = 16; // ~60fps (1000ms / 60fps = 16.67ms)
        let animationFrameId = null;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!isResizing) return;

            // Throttle the updates to improve performance
            const now = Date.now();
            if (now - lastUpdateTime < throttleDelay) {
                return;
            }
            lastUpdateTime = now;

            if (direction === 'left') {
                const newWidth = e.clientX;
                if (newWidth >= 200 && newWidth <= 400) {
                    // Cancel any pending animation frame
                    if (animationFrameId) {
                        cancelAnimationFrame(animationFrameId);
                    }
                    
                    // Use requestAnimationFrame for smooth DOM updates
                    animationFrameId = requestAnimationFrame(() => {
                        const sidebar = document.querySelector('.sidebar');
                        sidebar.style.width = newWidth + 'px';
                        
                        // Update CSS variable for profile panel positioning
                        document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
                        
                        this.sidebarWidth = newWidth;
                        
                        // Save the new width to config (debounced)
                        this.setSidebarWidth(newWidth);
                        
                        // Trigger terminal resize (throttled)
                        this.onTerminalResize?.();
                        
                        animationFrameId = null;
                    });
                }
            }
        };

        const onMouseUp = () => {
            isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            // Cancel any pending animation frame
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            
            // Ensure the final width is saved immediately when resizing ends
            if (this.saveWidthTimeout) {
                clearTimeout(this.saveWidthTimeout);
                this.saveWidthTimeout = null;
            }
            this.saveSidebarWidth();
        };
    }
} 