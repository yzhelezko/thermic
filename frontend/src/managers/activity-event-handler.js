/**
 * Activity Event Handler - Unified event handling for activity bar interactions
 */

import { updateStatus, showNotification } from '../modules/utils.js';
import { themeManager } from '../modules/theme-manager.js';

export class ActivityEventHandler {
    constructor(viewManager, sidebarStateManager) {
        this.viewManager = viewManager;
        this.sidebarStateManager = sidebarStateManager;
        this.handlers = new Map();
        this.isInitialized = false;
    }
    
    initialize() {
        if (this.isInitialized) {
            console.warn('ActivityEventHandler already initialized');
            return;
        }
        
        this.setupGlobalClickHandler();
        this.registerHandlers();
        this.isInitialized = true;
        
        console.log('✅ Activity Event Handler initialized');
    }
    
    setupGlobalClickHandler() {
        // Single event listener using event delegation
        document.addEventListener('click', (e) => {
            for (const [selector, handler] of this.handlers) {
                if (e.target.closest(selector)) {
                    handler(e);
                    break; // Stop after first match to prevent multiple handlers
                }
            }
        });
    }
    
    registerHandlers() {
        // Register all activity bar related event handlers
        
        // Activity button clicks
        this.handlers.set('.activity-btn', (e) => {
            const button = e.target.closest('.activity-btn');
            const view = button.dataset.view;
            if (view) {
                this.handleActivityButton(view);
            }
        });
        
        // Sidebar collapse/expand button
        this.handlers.set('#sidebar-collapse', () => {
            this.sidebarStateManager.toggle();
        });
        
        // Theme toggle button - handled by theme-manager, no need to register here
        
        // Settings button
        this.handlers.set('#settings-btn', () => {
            this.handleSettingsClick();
        });
        
        // Account button  
        this.handlers.set('#account-btn', () => {
            this.handleAccountClick();
        });
    }
    
    handleActivityButton(view) {
        const currentView = this.viewManager.getCurrentView();
        const isCollapsed = this.sidebarStateManager.isCollapsed();
        
        // If clicking same view and sidebar is open, collapse it
        if (currentView === view && !isCollapsed) {
            this.sidebarStateManager.collapse();
            return;
        }
        
        // If sidebar is collapsed, expand it
        if (isCollapsed) {
            this.sidebarStateManager.expand();
        }
        
        // Switch to the new view
        this.viewManager.switchToView(view);
        updateStatus(`Switched to ${view} view`);
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
    
    // Method to add custom handlers
    addHandler(selector, handler) {
        if (this.handlers.has(selector)) {
            console.warn(`Handler for selector '${selector}' already exists, overwriting`);
        }
        this.handlers.set(selector, handler);
    }
    
    // Method to remove handlers
    removeHandler(selector) {
        return this.handlers.delete(selector);
    }
    
    // Method to get registered handlers
    getHandlers() {
        return Array.from(this.handlers.keys());
    }
    
    // Cleanup method
    destroy() {
        this.handlers.clear();
        this.isInitialized = false;
        console.log('ActivityEventHandler destroyed');
    }
} 