/**
 * View Manager - Handles view switching and content management
 */

export class ViewManager {
    constructor(sidebarManager) {
        this.sidebarManager = sidebarManager;
        this.currentView = 'profiles';
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

    switchToView(viewName) {
        if (!this.views.has(viewName)) {
            console.warn(`Unknown view: ${viewName}`);
            return;
        }
        
        const previousView = this.currentView;
        const newView = this.views.get(viewName);
        
        console.log('🔀 View Manager: Switching from', previousView, 'to', viewName);
        
        // Hide previous view if it's different and has a hide method
        if (previousView !== viewName && this.views.has(previousView)) {
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