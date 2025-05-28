// UI management module
import { showNotification, updateStatus } from './utils.js';

export class UIManager {
    constructor() {
        this.isDarkTheme = true; // Default to dark theme, will be synced
        this.tabs = [{ id: 'terminal-1', title: 'Terminal 1', active: true }];
        this.tabCounter = 1;
        this.sidebarWidth = 250;
        this.onThemeChange = null;
        this.onTerminalResize = null;
    }

    setThemeChangeCallback(callback) {
        this.onThemeChange = callback;
    }

    setTerminalResizeCallback(callback) {
        this.onTerminalResize = callback;
    }

    initUI() {
        this.setupThemeToggle();
        this.setupResizablePanels();
        
        // Initialize CSS custom property for sidebar width
        document.documentElement.style.setProperty('--sidebar-width', this.sidebarWidth + 'px');
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

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!isResizing) return;

            if (direction === 'left') {
                const newWidth = e.clientX;
                if (newWidth >= 200 && newWidth <= 400) {
                    const sidebar = document.querySelector('.sidebar');
                    sidebar.style.width = newWidth + 'px';
                    this.sidebarWidth = newWidth;
                    
                    // Update profile panel positioning
                    this.updateProfilePanelPosition();
                }
            }

            // Trigger terminal resize
            setTimeout(() => {
                this.onTerminalResize?.();
            }, 10);
        };

        const onMouseUp = () => {
            isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }
} 