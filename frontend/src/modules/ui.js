// UI management module
import { showNotification, updateStatus } from './utils.js';

export class UIManager {
    constructor() {
        this.isDarkTheme = true;
        this.tabs = [{ id: 'terminal-1', title: 'Terminal 1', active: true }];
        this.tabCounter = 1;
        this.sidebarWidth = 250;
        this.onThemeChange = null;
        this.onTerminalResize = null;
    }

    setThemeChangeCallback(callback) {
        this.onThemeChange = callback;
    }

    setTerminalResizeCallback(callback) {
        this.onTerminalResize = callback;
    }

    initUI() {
        this.setupThemeToggle();
        this.setupToolbarButtons();
        this.setupTabManagement();
        this.setupResizablePanels();
        this.setupAccountButton();
    }

    setupThemeToggle() {
        const themeToggle = document.getElementById('theme-toggle');
        themeToggle.addEventListener('click', () => this.toggleTheme());
    }

    setupToolbarButtons() {
        const buttons = ['btn-explorer', 'btn-filemanager', 'btn-search'];
        buttons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            btn.addEventListener('click', () => {
                // Remove active class from all buttons
                buttons.forEach(id => document.getElementById(id).classList.remove('active'));
                // Add active class to clicked button
                btn.classList.add('active');
                
                // Trigger sidebar content update
                this.onSidebarChange?.(btnId);
            });
        });
    }

    setupTabManagement() {
        // Add tab button
        document.getElementById('add-tab').addEventListener('click', () => {
            this.addNewTab();
        });

        // Tab close buttons
        this.updateTabEventListeners();
    }

    updateTabEventListeners() {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            const closeBtn = tab.querySelector('.tab-close');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.closeTab(tab.dataset.tab);
                };
            }
            
            tab.onclick = () => {
                this.switchToTab(tab.dataset.tab);
            };
        });
    }

    addNewTab() {
        this.tabCounter++;
        const newTabId = `terminal-${this.tabCounter}`;
        this.tabs.push({
            id: newTabId,
            title: `Terminal ${this.tabCounter}`,
            active: false
        });
        
        this.renderTabs();
        this.switchToTab(newTabId);
    }

    closeTab(tabId) {
        if (this.tabs.length <= 1) {
            showNotification('Cannot close the last tab');
            return;
        }

        const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
        if (tabIndex === -1) return;

        const wasActive = this.tabs[tabIndex].active;
        this.tabs.splice(tabIndex, 1);

        if (wasActive && this.tabs.length > 0) {
            const newActiveIndex = Math.max(0, tabIndex - 1);
            this.tabs[newActiveIndex].active = true;
        }

        this.renderTabs();
    }

    switchToTab(tabId) {
        this.tabs.forEach(tab => {
            tab.active = tab.id === tabId;
        });
        this.renderTabs();
    }

    renderTabs() {
        const tabsContainer = document.querySelector('.tabs-container');
        const addTabBtn = document.getElementById('add-tab');
        
        // Remove existing tabs
        const existingTabs = tabsContainer.querySelectorAll('.tab');
        existingTabs.forEach(tab => tab.remove());

        // Add tabs
        this.tabs.forEach(tab => {
            const tabElement = document.createElement('div');
            tabElement.className = `tab ${tab.active ? 'active' : ''}`;
            tabElement.dataset.tab = tab.id;
            tabElement.innerHTML = `
                <span class="tab-title">${tab.title}</span>
                <button class="tab-close">×</button>
            `;
            tabsContainer.insertBefore(tabElement, addTabBtn);
        });

        this.updateTabEventListeners();
    }

    setupResizablePanels() {
        this.setupResize('sidebar-resize', 'left');
    }

    setupResize(handleId, direction) {
        const handle = document.getElementById(handleId);
        if (!handle) return;
        
        let isResizing = false;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!isResizing) return;

            if (direction === 'left') {
                const newWidth = e.clientX;
                if (newWidth >= 200 && newWidth <= 400) {
                    document.querySelector('.sidebar').style.width = newWidth + 'px';
                    this.sidebarWidth = newWidth;
                }
            }

            // Trigger terminal resize
            setTimeout(() => {
                this.onTerminalResize?.();
            }, 10);
        };

        const onMouseUp = () => {
            isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }

    setupAccountButton() {
        document.getElementById('account-btn').addEventListener('click', () => {
            showNotification('Account management coming soon!');
        });
    }

    toggleTheme() {
        this.isDarkTheme = !this.isDarkTheme;
        const body = document.body;
        const themeToggle = document.getElementById('theme-toggle');

        if (this.isDarkTheme) {
            body.setAttribute('data-theme', 'dark');
            // Sun icon for dark theme (to switch to light)
            themeToggle.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z"/>
                </svg>
            `;
        } else {
            body.setAttribute('data-theme', 'light');
            // Moon icon for light theme (to switch to dark)
            themeToggle.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z"/>
                </svg>
            `;
        }

        // Notify terminal manager of theme change
        this.onThemeChange?.(this.isDarkTheme);
    }

    setSidebarChangeCallback(callback) {
        this.onSidebarChange = callback;
    }
} 