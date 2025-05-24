// Settings management module
import { showNotification } from './utils.js';

export class SettingsManager {
    constructor() {
        this.settingsTabsInitialized = false;
        this.onThemeChange = null;
    }

    setThemeChangeCallback(callback) {
        this.onThemeChange = callback;
    }

    initSettings() {
        this.setupSettingsPanel();
    }

    setupSettingsPanel() {
        // Settings panel toggle
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.toggleSettingsPanel();
        });

        // Close settings when clicking overlay
        document.getElementById('settings-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'settings-overlay') {
                this.closeSettingsPanel();
            }
        });

        // Close settings with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const overlay = document.getElementById('settings-overlay');
                if (overlay.classList.contains('active')) {
                    this.closeSettingsPanel();
                }
            }
        });
    }

    toggleSettingsPanel() {
        const overlay = document.getElementById('settings-overlay');
        const settingsBtn = document.getElementById('settings-btn');
        
        if (overlay.classList.contains('active')) {
            this.closeSettingsPanel();
        } else {
            overlay.classList.add('active');
            settingsBtn.classList.add('active');
            
            // Initialize settings tabs if not already done
            this.initializeSettingsTabs();
        }
    }

    initializeSettingsTabs() {
        // Avoid multiple initializations
        if (this.settingsTabsInitialized) return;
        
        const settingsTabs = document.querySelectorAll('.settings-tab');
        const settingsTabPanes = document.querySelectorAll('.settings-tab-pane');

        if (settingsTabs.length === 0) return; // Elements not ready yet

        settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Deactivate all tabs and panes
                settingsTabs.forEach(t => t.classList.remove('active'));
                settingsTabPanes.forEach(p => p.classList.remove('active'));

                // Activate clicked tab and corresponding pane
                tab.classList.add('active');
                const targetPaneId = tab.dataset.tabTarget;
                const targetPane = document.querySelector(targetPaneId);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });

        // Dark mode toggle in settings panel
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.addEventListener('change', () => {
                this.onThemeChange?.();
            });
        }

        this.settingsTabsInitialized = true;
    }

    closeSettingsPanel() {
        const overlay = document.getElementById('settings-overlay');
        const settingsBtn = document.getElementById('settings-btn');
        
        overlay.classList.remove('active');
        settingsBtn.classList.remove('active');
    }

    // Sync the dark mode toggle with current theme
    syncDarkModeToggle(isDarkTheme) {
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.checked = isDarkTheme;
        }
    }
} 