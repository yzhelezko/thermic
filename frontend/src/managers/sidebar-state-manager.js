/**
 * Sidebar State Manager - Handles sidebar collapse/expand and width management
 */

import { updateStatus } from '../modules/utils.js';

export class SidebarStateManager {
    constructor(uiManager = null) {
        this.uiManager = uiManager;
        this.collapsed = false;
        this.width = 250;
        this.minWidth = 200;
        this.maxWidth = 600;
        this.observers = [];
    }
    
    initialize() {
        // Load state from UI manager if available
        if (this.uiManager) {
            this.collapsed = this.uiManager.sidebarCollapsed || false;
            this.width = this.uiManager.sidebarWidth || 250;
        }
        
        this.applySidebarState();
        console.log('✅ Sidebar State Manager initialized:', { collapsed: this.collapsed, width: this.width });
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
        
        // Notify observers
        this.notifyObservers({ collapsed: false, width: this.width });
        
        updateStatus('Sidebar expanded');
        console.log('📐 Sidebar expanded to width:', this.width);
    }
    
    setWidth(width) {
        if (width < this.minWidth || width > this.maxWidth) {
            console.warn(`Width ${width} outside allowed range ${this.minWidth}-${this.maxWidth}`);
            return false;
        }
        
        this.width = width;
        
        if (!this.collapsed) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.style.width = this.width + 'px';
                document.documentElement.style.setProperty('--sidebar-width', this.width + 'px');
            }
            
            this.syncWithUIManager();
            this.notifyObservers({ collapsed: false, width: this.width });
        }
        
        return true;
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
            this.uiManager.sidebarWidth = this.collapsed ? 0 : this.width;
            
            // Call UIManager method if available
            if (this.uiManager.setSidebarCollapsed) {
                this.uiManager.setSidebarCollapsed(this.collapsed);
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
    
    // Getters
    isCollapsed() {
        return this.collapsed;
    }
    
    getWidth() {
        return this.width;
    }
    
    getState() {
        return {
            collapsed: this.collapsed,
            width: this.width,
            minWidth: this.minWidth,
            maxWidth: this.maxWidth
        };
    }
} 