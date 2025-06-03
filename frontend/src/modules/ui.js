// UI management module
import { showNotification, updateStatus } from './utils.js';

export class UIManager {
    constructor() {
        this.isDarkTheme = true; // Default to dark theme, will be synced
        this.tabs = [{ id: 'terminal-1', title: 'Terminal 1', active: true }];
        this.tabCounter = 1;
        this.sidebarWidth = 250; // Keep for backward compatibility
        this.sidebarProfilesWidth = 250;
        this.sidebarFilesWidth = 350;
        this.sidebarCollapsed = false;
        this.onThemeChange = null;
        this.onTerminalResize = null;
        this.saveWidthTimeout = null; // For debouncing width saves
        this.saveProfilesWidthTimeout = null;
        this.saveFilesWidthTimeout = null;
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
        // The actual width will be set by the sidebar state manager based on current view
        document.documentElement.style.setProperty('--sidebar-width', this.sidebarProfilesWidth + 'px');
    }

    async loadSidebarState() {
        try {
            // Load sidebar state from backend
            const collapsed = await window.go.main.App.ConfigGet("SidebarCollapsed");
            const width = await window.go.main.App.ConfigGet("SidebarWidth");
            
            // Try to load separate view widths (new config keys)
            let profilesWidth, filesWidth;
            try {
                profilesWidth = await window.go.main.App.ConfigGet("SidebarProfilesWidth");
                filesWidth = await window.go.main.App.ConfigGet("SidebarFilesWidth");
                
                // If we got default values (meaning they weren't set), migrate from legacy width
                if ((profilesWidth === 250 && filesWidth === 350) && width && width !== 250) {
                    console.log('Migrating legacy sidebar width to separate view widths');
                    profilesWidth = width;
                    filesWidth = Math.max(width + 100, 350);
                    
                    // Save the migrated values
                    await window.go.main.App.ConfigSet("SidebarProfilesWidth", profilesWidth);
                    await window.go.main.App.ConfigSet("SidebarFilesWidth", filesWidth);
                }
            } catch (error) {
                // New config keys don't exist yet, use defaults based on main width
                console.log('Separate view widths not found, using defaults');
                profilesWidth = width || 250;
                filesWidth = Math.max((width || 250) + 100, 350); // Files view slightly wider
                
                // Save the default values
                try {
                    await window.go.main.App.ConfigSet("SidebarProfilesWidth", profilesWidth);
                    await window.go.main.App.ConfigSet("SidebarFilesWidth", filesWidth);
                } catch (saveError) {
                    console.warn('Failed to save default view widths:', saveError);
                }
            }
            
            this.sidebarCollapsed = collapsed;
            this.sidebarWidth = width;
            this.sidebarProfilesWidth = profilesWidth;
            this.sidebarFilesWidth = filesWidth;
            
            console.log(`Loaded sidebar state: collapsed=${collapsed}, width=${width}, profilesWidth=${profilesWidth}, filesWidth=${filesWidth}`);
        } catch (error) {
            console.warn('Failed to load sidebar state from config:', error);
            // Use defaults if loading fails
            this.sidebarCollapsed = false;
            this.sidebarWidth = 250;
            this.sidebarProfilesWidth = 250;
            this.sidebarFilesWidth = 350;
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
            await window.go.main.App.ConfigSet("SidebarProfilesWidth", this.sidebarProfilesWidth);
            await window.go.main.App.ConfigSet("SidebarFilesWidth", this.sidebarFilesWidth);
            console.log(`Saved sidebar state: collapsed=${this.sidebarCollapsed}, width=${this.sidebarWidth}, profilesWidth=${this.sidebarProfilesWidth}, filesWidth=${this.sidebarFilesWidth}`);
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

    setSidebarProfilesWidth(width) {
        if (this.sidebarProfilesWidth !== width) {
            this.sidebarProfilesWidth = width;
            
            // Debounce width saves to avoid too many calls during resizing
            if (this.saveProfilesWidthTimeout) {
                clearTimeout(this.saveProfilesWidthTimeout);
            }
            
            this.saveProfilesWidthTimeout = setTimeout(() => {
                this.saveSidebarProfilesWidth();
                this.saveProfilesWidthTimeout = null;
            }, 300); // Save after 300ms of no changes
        }
    }

    setSidebarFilesWidth(width) {
        if (this.sidebarFilesWidth !== width) {
            this.sidebarFilesWidth = width;
            
            // Debounce width saves to avoid too many calls during resizing
            if (this.saveFilesWidthTimeout) {
                clearTimeout(this.saveFilesWidthTimeout);
            }
            
            this.saveFilesWidthTimeout = setTimeout(() => {
                this.saveSidebarFilesWidth();
                this.saveFilesWidthTimeout = null;
            }, 300); // Save after 300ms of no changes
        }
    }

    async saveSidebarProfilesWidth() {
        try {
            await window.go.main.App.ConfigSet("SidebarProfilesWidth", this.sidebarProfilesWidth);
            console.log(`Saved sidebar profiles width: ${this.sidebarProfilesWidth}`);
        } catch (error) {
            console.warn('Failed to save sidebar profiles width to config:', error);
        }
    }

    async saveSidebarFilesWidth() {
        try {
            await window.go.main.App.ConfigSet("SidebarFilesWidth", this.sidebarFilesWidth);
            console.log(`Saved sidebar files width: ${this.sidebarFilesWidth}`);
        } catch (error) {
            console.warn('Failed to save sidebar files width to config:', error);
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
                if (newWidth >= 200 && newWidth <= 600) {
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
                        
                        // Update the appropriate view-specific width based on current view
                        if (window.thermicApp?.activityBarManager?.getSidebarStateManager) {
                            const sidebarStateManager = window.thermicApp.activityBarManager.getSidebarStateManager();
                            if (sidebarStateManager && sidebarStateManager.setWidth) {
                                sidebarStateManager.setWidth(newWidth, true); // true = isResizing
                            }
                        }
                        
                        // Keep legacy width updated for backward compatibility
                        this.sidebarWidth = newWidth;
                        
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
            
                                        // Trigger immediate save when resize ends
                            if (window.thermicApp?.activityBarManager?.getSidebarStateManager) {
                                const sidebarStateManager = window.thermicApp.activityBarManager.getSidebarStateManager();
                                if (sidebarStateManager && sidebarStateManager.saveCurrentViewWidth) {
                                    sidebarStateManager.saveCurrentViewWidth();
                                }
                            }
        };
    }
} 