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
        this.setupResizablePanels();
        this.setupAccountButton();
        this.setupSettingsButton();
    }

    setupThemeToggle() {
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        } else {
            console.warn('Theme toggle button not found');
        }
    }

    setupToolbarButtons() {
        const buttons = ['btn-explorer', 'btn-filemanager', 'btn-search'];
        buttons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', () => {
                    // Remove active class from all buttons
                    buttons.forEach(id => {
                        const button = document.getElementById(id);
                        if (button) button.classList.remove('active');
                    });
                    // Add active class to clicked button
                    btn.classList.add('active');
                    
                    // Trigger sidebar content update
                    this.onSidebarChange?.(btnId);
                });
            } else {
                console.warn(`Toolbar button not found: ${btnId}`);
            }
        });
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
        const accountBtn = document.getElementById('account-btn');
        if (accountBtn) {
            accountBtn.addEventListener('click', () => {
                showNotification('Account management coming soon!');
            });
        } else {
            console.warn('Account button not found');
        }
    }

    setupSettingsButton() {
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                const settingsOverlay = document.getElementById('settings-overlay');
                if (settingsOverlay) {
                    settingsOverlay.style.display = settingsOverlay.style.display === 'flex' ? 'none' : 'flex';
                }
            });
        } else {
            console.warn('Settings button not found');
        }
    }

    toggleTheme() {
        this.isDarkTheme = !this.isDarkTheme;
        const body = document.body;
        const themeToggle = document.getElementById('theme-toggle');

        if (!themeToggle) {
            console.warn('Theme toggle button not found');
            return;
        }

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