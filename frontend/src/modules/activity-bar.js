// Activity Bar management module (VS Code style)
import { themeManager } from './theme-manager.js';
import { ViewManager } from '../managers/view-manager.js';
import { SidebarStateManager } from '../managers/sidebar-state-manager.js';
import { ActivityEventHandler } from '../managers/activity-event-handler.js';

export class ActivityBarManager {
    constructor(sidebarManager, uiManager = null) {
        this.sidebarManager = sidebarManager;
        this.uiManager = uiManager;
        
        // Initialize specialized managers
        this.viewManager = new ViewManager(sidebarManager);
        this.sidebarStateManager = new SidebarStateManager(uiManager);
        this.eventHandler = new ActivityEventHandler(this.viewManager, this.sidebarStateManager);
        
        // Subscribe to theme changes from theme-manager
        this.onThemeChange = this.onThemeChange.bind(this);
        themeManager.addObserver(this.onThemeChange);
    }

    onThemeChange(theme) {
        // Handle theme changes from theme-manager
        console.log('Activity Bar: Theme changed to:', theme);
        
        // Sync settings panel dark mode toggle
        this.syncSettingsDarkModeToggle(theme === 'dark');
        
        // Notify other managers of theme change
        if (window.thermicApp?.uiManager?.onThemeChange) {
            window.thermicApp.uiManager.onThemeChange(theme === 'dark');
        }
    }

    async init() {
        // Initialize all managers
        this.sidebarStateManager.initialize();
        this.eventHandler.initialize();
        
        // Theme manager is already initialized by main.js after DOM is ready
        // Just sync initial theme state
        
        // Sync initial theme state with theme-manager
        const currentTheme = themeManager.getCurrentTheme();
        this.syncSettingsDarkModeToggle(currentTheme === 'dark');
        
        console.log('✅ Activity Bar initialized with theme:', currentTheme);
    }

    syncSettingsDarkModeToggle(isDarkTheme) {
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.checked = isDarkTheme;
        }
    }

    // Public API methods for backwards compatibility
    getCurrentView() {
        return this.viewManager.getCurrentView();
    }

    isSidebarCollapsed() {
        return this.sidebarStateManager.isCollapsed();
    }
    
    setSidebarWidth(width) {
        return this.sidebarStateManager.setWidth(width);
    }
    
    toggleSidebar() {
        this.sidebarStateManager.toggle();
    }
    
    switchView(view) {
        this.viewManager.switchToView(view);
    }
    
    // Manager access methods for advanced usage
    getViewManager() {
        return this.viewManager;
    }
    
    getSidebarStateManager() {
        return this.sidebarStateManager;
    }
    
    getEventHandler() {
        return this.eventHandler;
    }
    
    // Cleanup method
    destroy() {
        themeManager.removeObserver(this.onThemeChange);
        this.eventHandler.destroy();
        console.log('ActivityBarManager destroyed');
    }
} 