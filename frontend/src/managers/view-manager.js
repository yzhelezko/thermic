/**
 * View Manager - Handles view switching and content management
 */

export class ViewManager {
    constructor(sidebarManager, sidebarStateManager = null) {
        this.sidebarManager = sidebarManager;
        this.sidebarStateManager = sidebarStateManager;
        this.currentView = 'profiles';
        this.isInitialized = false;
        this.views = new Map([
            ['profiles', {
                title: 'Profiles',
                show: () => this.sidebarManager.showProfilesView(),
                hide: () => this.sidebarManager.hideProfilesView?.() || null
            }],
            ['files', {
                title: 'Files',
                show: () => this.sidebarManager.showFilesView(),
                hide: () => this.sidebarManager.hideFilesView()
            }]
        ]);
    }

    initialize() {
        if (this.isInitialized) return;
        
        console.log('🔀 ViewManager: Initializing with profiles view');
        this.isInitialized = true;
        
        // Show the initial view
        this.switchToView('profiles');
    }

    switchToView(viewName, force = false) {
        if (!this.views.has(viewName)) {
            console.warn(`Unknown view: ${viewName}`);
            return;
        }
        
        const previousView = this.currentView;
        const newView = this.views.get(viewName);
        
        console.log('🔀 View Manager: Switching from', previousView, 'to', viewName, force ? '(forced)' : '');
        
        // Switch sidebar width to the appropriate view first
        if (this.sidebarStateManager && (previousView !== viewName || force)) {
            this.sidebarStateManager.switchToView(viewName);
        }
        
        // Hide previous view if it's different and has a hide method, or if forcing
        if ((previousView !== viewName || force) && this.views.has(previousView)) {
            const prevViewConfig = this.views.get(previousView);
            if (prevViewConfig.hide) {
                prevViewConfig.hide();
            }
        }
        
        // Show new view
        newView.show();
        
        // Update UI
        this.updateViewUI(viewName, newView.title);
        
        // Update state
        this.currentView = viewName;

        // Persist this preference on the active tab so it survives both
        // tab switches (read by tabs.js:switchToTab) and app restart
        // (captured into LastOpenTabs at shutdown).
        //
        // Critical: update BOTH the backend Tab struct AND the frontend's
        // local tab cache. The frontend never re-fetches tabs after startup,
        // so without the local mutation tabs.js would keep reading whatever
        // lastSidebarView was at launch (usually undefined) and the per-tab
        // restore-on-switch would silently no-op.
        const tabsManager = window.thermicApp?.tabsManager;
        const activeTabId = tabsManager?.activeTabId;
        if (activeTabId) {
            const localTab = tabsManager.tabs?.get(activeTabId);
            if (localTab) {
                localTab.lastSidebarView = viewName;
            }
            const setView = window.go?.main?.App?.SetTabSidebarView;
            if (typeof setView === 'function') {
                setView(activeTabId, viewName).catch((err) => {
                    console.warn('SetTabSidebarView failed:', err);
                });
            }
        }

        console.log(`✅ View switched from ${previousView} to ${viewName}`);
    }
    
    updateViewUI(viewName, title) {
        // Update sidebar title
        const sidebarTitle = document.getElementById('sidebar-title');
        if (sidebarTitle) {
            sidebarTitle.textContent = title;
        }
        
        // Update active button
        document.querySelectorAll('.activity-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });
    }
    
    getCurrentView() {
        return this.currentView;
    }
    
    addView(name, config) {
        if (!config.title || !config.show) {
            throw new Error('View config must have title and show method');
        }
        this.views.set(name, config);
    }
    
    removeView(name) {
        if (name === this.currentView) {
            console.warn(`Cannot remove current view: ${name}`);
            return false;
        }
        return this.views.delete(name);
    }
    
    getAvailableViews() {
        return Array.from(this.views.keys());
    }
} 