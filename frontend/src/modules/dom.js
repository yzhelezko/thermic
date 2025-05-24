// DOM management and dynamic HTML generation
import { 
    createHeaderTemplate, 
    createTabsTemplate, 
    createSidebarTemplate, 
    createStatusBarTemplate, 
    createSettingsPanelTemplate,
    createTerminalContextMenuTemplate,
    createSidebarContextMenuTemplate
} from './templates.js';

export class DOMManager {
    constructor() {
        this.isInitialized = false;
    }

    initializeDOM() {
        if (this.isInitialized) return;

        // Populate all the dynamic HTML content
        this.renderHeader();
        this.renderTabs();
        this.renderSidebar();
        this.renderStatusBar();
        this.renderSettingsPanel();
        this.renderContextMenus();

        this.isInitialized = true;
    }

    renderHeader() {
        const header = document.getElementById('header');
        if (header) {
            header.innerHTML = createHeaderTemplate();
        }
    }

    renderTabs() {
        const tabsContainer = document.getElementById('tabs-container');
        if (tabsContainer) {
            tabsContainer.innerHTML = createTabsTemplate();
        }
    }

    renderSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.innerHTML = createSidebarTemplate();
        }
    }

    renderStatusBar() {
        const statusBar = document.getElementById('status-bar');
        if (statusBar) {
            statusBar.innerHTML = createStatusBarTemplate();
        }
    }

    renderSettingsPanel() {
        const settingsOverlay = document.getElementById('settings-overlay');
        if (settingsOverlay) {
            settingsOverlay.innerHTML = createSettingsPanelTemplate();
        }
    }

    renderContextMenus() {
        // Add context menus to the body
        const body = document.body;
        
        // Create container for context menus if it doesn't exist
        let contextMenuContainer = document.getElementById('context-menu-container');
        if (!contextMenuContainer) {
            contextMenuContainer = document.createElement('div');
            contextMenuContainer.id = 'context-menu-container';
            body.appendChild(contextMenuContainer);
        }
        
        // Add terminal and sidebar context menus
        contextMenuContainer.innerHTML = 
            createTerminalContextMenuTemplate() + 
            createSidebarContextMenuTemplate();
    }

    // Utility methods for dynamic updates
    updateElement(selector, content) {
        const element = document.querySelector(selector);
        if (element) {
            element.innerHTML = content;
        }
    }

    createElement(tag, className, content, attributes = {}) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (content) element.innerHTML = content;
        
        Object.entries(attributes).forEach(([key, value]) => {
            element.setAttribute(key, value);
        });
        
        return element;
    }

    insertElement(parentSelector, element, position = 'beforeend') {
        const parent = document.querySelector(parentSelector);
        if (parent) {
            parent.insertAdjacentElement(position, element);
        }
    }

    removeElement(selector) {
        const element = document.querySelector(selector);
        if (element) {
            element.remove();
        }
    }

    toggleClass(selector, className) {
        const element = document.querySelector(selector);
        if (element) {
            element.classList.toggle(className);
        }
    }

    addClass(selector, className) {
        const element = document.querySelector(selector);
        if (element) {
            element.classList.add(className);
        }
    }

    removeClass(selector, className) {
        const element = document.querySelector(selector);
        if (element) {
            element.classList.remove(className);
        }
    }

    // Query helpers
    getElement(selector) {
        return document.querySelector(selector);
    }

    getElements(selector) {
        return document.querySelectorAll(selector);
    }

    getElementById(id) {
        return document.getElementById(id);
    }
} 