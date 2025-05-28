// Activity Bar management module (VS Code style)
import { updateStatus, showNotification } from './utils.js';

export class ActivityBarManager {
    constructor(sidebarManager, uiManager = null) {
        this.sidebarManager = sidebarManager;
        this.uiManager = uiManager;
        this.currentView = 'profiles';
        this.sidebarCollapsed = false;
        this.isDarkTheme = true; // Default to dark theme
        this.savedSidebarWidth = 250; // Store the width before collapsing
    }

    init() {
        this.setupActivityBarInteractions();
        this.setupSidebarCollapse();
        this.setupBottomButtons();
        
        // Initialize saved sidebar width from UIManager
        if (this.uiManager) {
            this.savedSidebarWidth = this.uiManager.sidebarWidth;
            this.sidebarCollapsed = this.uiManager.sidebarCollapsed;
            
            // Apply initial state to the sidebar
            this.applySidebarState();
        }
        
        console.log('✅ Activity Bar initialized');
    }

    setupActivityBarInteractions() {
        // Handle activity button clicks
        document.addEventListener('click', (e) => {
            const activityBtn = e.target.closest('.activity-btn');
            if (activityBtn) {
                const view = activityBtn.dataset.view;
                if (view) {
                    this.handleActivityButtonClick(activityBtn);
                }
            }
        });
    }

    setupSidebarCollapse() {
        // Handle sidebar collapse button
        document.addEventListener('click', (e) => {
            if (e.target.closest('#sidebar-collapse')) {
                this.toggleSidebar();
            }
        });
    }

    setupBottomButtons() {
        // Handle settings button
        document.addEventListener('click', (e) => {
            if (e.target.closest('#settings-btn')) {
                this.handleSettingsClick();
            }
        });

        // Handle account button
        document.addEventListener('click', (e) => {
            if (e.target.closest('#account-btn')) {
                this.handleAccountClick();
            }
        });

        // Handle theme toggle button
        document.addEventListener('click', (e) => {
            if (e.target.closest('#theme-toggle')) {
                this.handleThemeToggle();
            }
        });
    }

    handleActivityButtonClick(button) {
        const view = button.dataset.view;
        
        // If clicking the same view and sidebar is open, collapse it
        if (this.currentView === view && !this.sidebarCollapsed) {
            this.toggleSidebar();
            return;
        }

        // If sidebar is collapsed, expand it
        if (this.sidebarCollapsed) {
            this.expandSidebar();
        }

        // Switch to the new view
        this.switchView(view);
    }

    switchView(view) {
        // Update active button
        document.querySelectorAll('.activity-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-view="${view}"]`).classList.add('active');

        // Update sidebar content
        this.currentView = view;
        this.updateSidebarContent(view);
        
        updateStatus(`Switched to ${view} view`);
    }

    updateSidebarContent(view) {
        const sidebarTitle = document.getElementById('sidebar-title');
        const sidebarContent = document.getElementById('sidebar-content');

        switch (view) {
            case 'profiles':
                sidebarTitle.textContent = 'Profiles';
                this.sidebarManager.showProfilesView();
                break;
            case 'files':
                sidebarTitle.textContent = 'Files';
                this.sidebarManager.showFilesView();
                break;
        }
    }

    toggleSidebar() {
        if (this.sidebarCollapsed) {
            this.expandSidebar();
        } else {
            this.collapseSidebar();
        }
    }

    collapseSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.add('collapsed');
        this.sidebarCollapsed = true;
        
        // Save current sidebar width before collapsing
        // Check inline style first (from resizing), then UIManager, then default
        const currentWidth = sidebar.style.width ? parseInt(sidebar.style.width) : 
                           (this.uiManager ? this.uiManager.sidebarWidth : 250);
        this.savedSidebarWidth = currentWidth;
        
        // Also update UIManager to keep it in sync
        if (this.uiManager) {
            this.uiManager.sidebarWidth = currentWidth;
            this.uiManager.setSidebarCollapsed(true);
        }
        
        // Clear inline width style to allow CSS collapse to work
        sidebar.style.width = '';
        
        // Update CSS variable for collapsed sidebar (width = 0)
        document.documentElement.style.setProperty('--sidebar-width', '0px');
        
        // Update collapse button icon
        this.updateCollapseButtonIcon(true);
        
        updateStatus('Sidebar collapsed');
    }

    expandSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.remove('collapsed');
        this.sidebarCollapsed = false;
        
        // Restore the saved sidebar width with fallback
        const sidebarWidth = this.savedSidebarWidth || (this.uiManager ? this.uiManager.sidebarWidth : 250);
        
        // Update the actual sidebar element width
        sidebar.style.width = sidebarWidth + 'px';
        
        // Update UIManager's width tracking and save state
        if (this.uiManager) {
            this.uiManager.sidebarWidth = sidebarWidth;
            this.uiManager.setSidebarCollapsed(false);
        }
        
        // Update CSS variable for expanded sidebar
        document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
        
        // Update collapse button icon
        this.updateCollapseButtonIcon(false);
        
        updateStatus('Sidebar expanded');
    }

    handleSettingsClick() {
        const settingsOverlay = document.getElementById('settings-overlay');
        if (settingsOverlay) {
            settingsOverlay.style.display = settingsOverlay.style.display === 'flex' ? 'none' : 'flex';
        }
        updateStatus('Settings panel toggled');
    }

    handleAccountClick() {
        showNotification('Account management coming soon!');
        updateStatus('Account button clicked');
    }

    handleThemeToggle() {
        this.isDarkTheme = !this.isDarkTheme;
        const body = document.body;
        const themeToggle = document.getElementById('theme-toggle');

        if (!themeToggle) {
            console.warn('Theme toggle button not found');
            return;
        }

        // Add rotation animation
        themeToggle.classList.add('rotating');
        setTimeout(() => {
            themeToggle.classList.remove('rotating');
        }, 300);

        if (this.isDarkTheme) {
            body.setAttribute('data-theme', 'dark');
            // Sun icon for dark theme (to switch to light)
            setTimeout(() => {
                themeToggle.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z"/>
                    </svg>
                `;
            }, 150); // Change icon halfway through rotation
        } else {
            body.setAttribute('data-theme', 'light');
            // Moon icon for light theme (to switch to dark)
            setTimeout(() => {
                themeToggle.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z"/>
                    </svg>
                `;
            }, 150); // Change icon halfway through rotation
        }

        // Notify other managers of theme change
        if (window.thermicApp?.uiManager?.onThemeChange) {
            window.thermicApp.uiManager.onThemeChange(this.isDarkTheme);
        }

        updateStatus(`Switched to ${this.isDarkTheme ? 'dark' : 'light'} theme`);
    }

    getCurrentView() {
        return this.currentView;
    }

    isSidebarCollapsed() {
        return this.sidebarCollapsed;
    }

    applySidebarState() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        if (this.sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            sidebar.style.width = '';
            document.documentElement.style.setProperty('--sidebar-width', '0px');
            this.updateCollapseButtonIcon(true);
        } else {
            sidebar.classList.remove('collapsed');
            sidebar.style.width = this.savedSidebarWidth + 'px';
            document.documentElement.style.setProperty('--sidebar-width', this.savedSidebarWidth + 'px');
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
} 