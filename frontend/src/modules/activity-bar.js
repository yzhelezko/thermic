// Activity Bar management module (VS Code style)
import { updateStatus, showNotification } from './utils.js';
import { updateThemeToggleIcon, updateAllIconsToInline } from '../utils/icons.js';

export class ActivityBarManager {
    constructor(sidebarManager, uiManager = null) {
        this.sidebarManager = sidebarManager;
        this.uiManager = uiManager;
        this.currentView = 'profiles';
        this.sidebarCollapsed = false;
        this.isDarkTheme = true; // Default, will be updated in init
        this.savedSidebarWidth = 250; // Store the width before collapsing
    }

    async detectCurrentTheme() {
        // First check if we can load theme from backend config
        if (window.go?.main?.App?.GetTheme) {
            try {
                const savedTheme = await window.go.main.App.GetTheme();
                console.log('Loaded theme from config:', savedTheme);
                if (savedTheme === 'dark' || savedTheme === 'light') {
                    return savedTheme === 'dark';
                }
                // If saved theme is 'system', fall through to system detection
                if (savedTheme === 'system') {
                    console.log('System theme preference detected, checking system preference');
                }
            } catch (error) {
                console.warn('Failed to load theme from config:', error);
            }
        }

        // Check data-theme attribute
        const dataTheme = document.documentElement.getAttribute('data-theme');
        if (dataTheme) {
            return dataTheme === 'dark';
        }

        // Check for dark-mode class on body
        if (document.body.classList.contains('dark-mode')) {
            return true;
        }

        // Check system preference as fallback
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return true;
        }

        // Default to dark theme
        return true;
    }

    async init() {
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
        
        // Detect and sync the theme state on initialization
        await this.initializeTheme();
        
        console.log('✅ Activity Bar initialized with theme:', this.isDarkTheme ? 'dark' : 'light');
    }

    async initializeTheme() {
        // Detect the current theme from config or DOM
        this.isDarkTheme = await this.detectCurrentTheme();
        
        // Sync the theme state to DOM
        this.syncThemeState();
    }

    syncThemeState() {
        // Make sure the DOM reflects our detected theme
        const currentTheme = this.isDarkTheme ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        document.body.setAttribute('data-theme', currentTheme);
        
        // Sync settings toggle
        this.syncSettingsDarkModeToggle(this.isDarkTheme);
        
        console.log('Theme state synced:', currentTheme);
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

    async handleThemeToggle() {
        // Detect current theme from DOM instead of just toggling internal state
        const currentTheme = await this.detectCurrentTheme();
        this.isDarkTheme = !currentTheme; // Toggle to opposite
        
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

        // Apply the new theme
        const newTheme = this.isDarkTheme ? 'dark' : 'light';
        body.setAttribute('data-theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);

        // Update the theme toggle icon using the new async function
        setTimeout(async () => {
            try {
                await updateThemeToggleIcon(themeToggle);
                
                // Also update all other icons to inline SVGs for proper theme support
                await updateAllIconsToInline();
            } catch (error) {
                console.error('Error updating theme icons:', error);
            }
        }, 150); // Change icon halfway through rotation

        // Debug the theme change
        console.log('Theme toggled from:', currentTheme ? 'dark' : 'light', 'to:', newTheme);
        console.log('data-theme attribute:', document.documentElement.getAttribute('data-theme'));

        // Notify other managers of theme change
        if (window.thermicApp?.uiManager?.onThemeChange) {
            window.thermicApp.uiManager.onThemeChange(this.isDarkTheme);
        }

        // Sync the settings panel dark mode toggle
        this.syncSettingsDarkModeToggle(this.isDarkTheme);

        // Save theme preference to config
        if (window.go?.main?.App?.SetTheme) {
            try {
                const themeValue = this.isDarkTheme ? 'dark' : 'light';
                await window.go.main.App.SetTheme(themeValue);
                console.log('Theme preference saved to config:', themeValue);
            } catch (error) {
                console.warn('Failed to save theme to config:', error);
            }
        }

        updateStatus(`Switched to ${newTheme} theme`);
    }

    syncSettingsDarkModeToggle(isDarkTheme) {
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.checked = isDarkTheme;
        }
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