/**
 * Sidebar State Manager - Handles sidebar collapse/expand and width management
 */

import { updateStatus } from '../modules/utils.js';

export class SidebarStateManager {
    constructor(uiManager = null) {
        this.uiManager = uiManager;
        this.collapsed = false;
        
        // Separate widths for different views
        this.profilesWidth = 250;
        this.filesWidth = 350;
        this.currentView = 'profiles'; // 'profiles' or 'files'
        this.width = this.profilesWidth; // Current active width
        
        this.minWidth = 200;
        this.maxWidth = 600;
        this.observers = [];
        
        // Add debounced save for resize operations
        this.resizeSaveTimeout = null;
    }
    
    initialize() {
        // Load state from UI manager if available
        if (this.uiManager) {
            this.collapsed = this.uiManager.sidebarCollapsed || false;
            this.profilesWidth = this.uiManager.sidebarProfilesWidth || 250;
            this.filesWidth = this.uiManager.sidebarFilesWidth || 350;
            
            // Set current width based on current view
            this.width = this.currentView === 'profiles' ? this.profilesWidth : this.filesWidth;
        }
        
        this.applySidebarState();
        console.log('✅ Sidebar State Manager initialized:', { 
            collapsed: this.collapsed, 
            profilesWidth: this.profilesWidth, 
            filesWidth: this.filesWidth,
            currentView: this.currentView,
            currentWidth: this.width 
        });
    }
    
    toggle() {
        if (this.collapsed) {
            this.expand();
        } else {
            this.collapse();
        }
    }
    
    collapse() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) {
            console.warn('Sidebar element not found');
            return;
        }
        
        // Save current width before collapsing
        if (!this.collapsed) {
            const currentWidth = sidebar.style.width ? parseInt(sidebar.style.width) : this.width;
            this.width = Math.max(currentWidth, this.minWidth);
        }
        
        sidebar.classList.add('collapsed');
        this.collapsed = true;
        
        // Clear inline width style to allow CSS collapse to work
        sidebar.style.width = '';
        
        // Update CSS variable for collapsed sidebar (width = 0)
        document.documentElement.style.setProperty('--sidebar-width', '0px');
        
        // Update collapse button icon
        this.updateCollapseButtonIcon(true);
        
        // Sync with UI manager
        this.syncWithUIManager();
        
        // Clear any active search in profiles view
        this.clearProfileSearchIfActive();
        
        // Notify observers
        this.notifyObservers({ collapsed: true, width: 0 });
        
        updateStatus('Sidebar collapsed');
        console.log('📐 Sidebar collapsed, saved width:', this.width);
    }
    
    expand() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) {
            console.warn('Sidebar element not found');
            return;
        }
        
        sidebar.classList.remove('collapsed');
        this.collapsed = false;
        
        // Restore the saved width
        sidebar.style.width = this.width + 'px';
        
        // Update CSS variable for expanded sidebar
        document.documentElement.style.setProperty('--sidebar-width', this.width + 'px');
        
        // Update collapse button icon
        this.updateCollapseButtonIcon(false);
        
        // Sync with UI manager
        this.syncWithUIManager();
        
        // Clear any active search in profiles view  
        this.clearProfileSearchIfActive();
        
        // Notify observers
        this.notifyObservers({ collapsed: false, width: this.width });
        
        updateStatus('Sidebar expanded');
        console.log('📐 Sidebar expanded to width:', this.width);
    }
    
    setWidth(width, isResizing = false) {
        if (width < this.minWidth || width > this.maxWidth) {
            console.warn(`Width ${width} outside allowed range ${this.minWidth}-${this.maxWidth}`);
            return false;
        }
        
        // Update both the current width and the view-specific width
        this.width = width;
        if (this.currentView === 'profiles') {
            this.profilesWidth = width;
        } else {
            this.filesWidth = width;
        }
        
        if (!this.collapsed) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.style.width = this.width + 'px';
                document.documentElement.style.setProperty('--sidebar-width', this.width + 'px');
            }
            
            // Always sync to update the UI manager's values
            this.syncWithUIManager();
            
            // Handle saving based on whether this is during active resizing
            if (isResizing) {
                // During resize, debounce the save to avoid too many config writes
                this.debouncedSave();
            } else {
                // Immediate save for non-resize changes (like view switching)
                this.saveCurrentViewWidth();
            }
            
            this.notifyObservers({ collapsed: false, width: this.width, view: this.currentView });
        }
        
        return true;
    }
    
    debouncedSave() {
        // Clear any existing timeout
        if (this.resizeSaveTimeout) {
            clearTimeout(this.resizeSaveTimeout);
        }
        
        // Set a new timeout to save after 300ms of no changes
        this.resizeSaveTimeout = setTimeout(() => {
            this.saveCurrentViewWidth();
            this.resizeSaveTimeout = null;
        }, 300);
    }
    
    async saveCurrentViewWidth() {
        try {
            if (this.currentView === 'profiles') {
                await window.go.main.App.ConfigSet("SidebarProfilesWidth", this.profilesWidth);
            } else {
                await window.go.main.App.ConfigSet("SidebarFilesWidth", this.filesWidth);
            }
            
            // Also update the UI manager's values for consistency
            if (this.uiManager) {
                this.uiManager.sidebarProfilesWidth = this.profilesWidth;
                this.uiManager.sidebarFilesWidth = this.filesWidth;
            }
        } catch (error) {
            console.error(`Failed to save ${this.currentView} width:`, error);
        }
    }
    
    applySidebarState() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        if (this.collapsed) {
            sidebar.classList.add('collapsed');
            sidebar.style.width = '';
            document.documentElement.style.setProperty('--sidebar-width', '0px');
            this.updateCollapseButtonIcon(true);
        } else {
            sidebar.classList.remove('collapsed');
            sidebar.style.width = this.width + 'px';
            document.documentElement.style.setProperty('--sidebar-width', this.width + 'px');
            this.updateCollapseButtonIcon(false);
        }
    }
    
    updateCollapseButtonIcon(collapsed) {
        const collapseBtn = document.getElementById('sidebar-collapse');
        if (!collapseBtn) return;

        if (collapsed) {
            collapseBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
            `;
            collapseBtn.title = 'Expand Sidebar';
        } else {
            collapseBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                </svg>
            `;
            collapseBtn.title = 'Collapse Sidebar';
        }
    }
    
    syncWithUIManager() {
        if (this.uiManager) {
            this.uiManager.sidebarCollapsed = this.collapsed;
            this.uiManager.sidebarProfilesWidth = this.profilesWidth;
            this.uiManager.sidebarFilesWidth = this.filesWidth;
            this.uiManager.sidebarWidth = this.collapsed ? 0 : this.width; // Keep for backward compatibility
            
            // Call UIManager methods if available
            if (this.uiManager.setSidebarCollapsed) {
                this.uiManager.setSidebarCollapsed(this.collapsed);
            }
            if (this.uiManager.setSidebarProfilesWidth) {
                this.uiManager.setSidebarProfilesWidth(this.profilesWidth);
            }
            if (this.uiManager.setSidebarFilesWidth) {
                this.uiManager.setSidebarFilesWidth(this.filesWidth);
            }
        }
    }
    
    subscribe(callback) {
        this.observers.push(callback);
    }
    
    unsubscribe(callback) {
        this.observers = this.observers.filter(obs => obs !== callback);
    }
    
    notifyObservers(state) {
        this.observers.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                console.error('Error in sidebar state observer:', error);
            }
        });
    }
    
    clearProfileSearchIfActive() {
        // Clear profile search when sidebar is hidden/shown to avoid tree structure issues
        if (window.sidebarManager && window.sidebarManager.profileLiveSearch) {
            const search = window.sidebarManager.profileLiveSearch;
            if (search.isActive()) {
                console.log('📐 Clearing active profile search due to sidebar hide/show');
                search.clearSearch();
                
                // Also restore the tree structure properly
                if (window.sidebarManager.restoreProfileTreeStructure) {
                    window.sidebarManager.restoreProfileTreeStructure();
                }
            }
        }
    }
    
    // Getters
    isCollapsed() {
        return this.collapsed;
    }
    
    getWidth() {
        return this.width;
    }
    
    switchToView(view) {
        if (view !== 'profiles' && view !== 'files') {
            console.warn(`Invalid view: ${view}. Must be 'profiles' or 'files'`);
            return false;
        }
        
        if (this.currentView === view) {
            console.log(`Already in ${view} view`);
            return true;
        }
        
        console.log(`📐 Switching sidebar from ${this.currentView} view to ${view} view`);
        
        // Save current width to the old view
        if (this.currentView === 'profiles') {
            this.profilesWidth = this.width;
        } else {
            this.filesWidth = this.width;
        }
        
        // Switch to new view
        this.currentView = view;
        const newWidth = view === 'profiles' ? this.profilesWidth : this.filesWidth;
        
        // Only change width if sidebar is not collapsed
        if (!this.collapsed && newWidth !== this.width) {
            this.width = newWidth;
            
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.style.width = this.width + 'px';
                document.documentElement.style.setProperty('--sidebar-width', this.width + 'px');
            }
            
            console.log(`📐 Sidebar width changed to ${this.width}px for ${view} view`);
            
            this.syncWithUIManager();
            this.notifyObservers({ collapsed: false, width: this.width, view: this.currentView });
        }
        
        return true;
    }
    
    getProfilesWidth() {
        return this.profilesWidth;
    }
    
    getFilesWidth() {
        return this.filesWidth;
    }
    
    getCurrentView() {
        return this.currentView;
    }

    getState() {
        return {
            collapsed: this.collapsed,
            width: this.width,
            profilesWidth: this.profilesWidth,
            filesWidth: this.filesWidth,
            currentView: this.currentView,
            minWidth: this.minWidth,
            maxWidth: this.maxWidth
        };
    }
} 