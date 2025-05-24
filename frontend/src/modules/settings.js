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

        // --- Shell Selector Logic ---
        const shellSelector = document.getElementById('shell-selector');
        if (!shellSelector) {
            console.error("Shell selector dropdown ('shell-selector') not found in the DOM.");
        } else {
            // Load and populate shell options
            this.loadAndPopulateShellSelector();

            // Add event listener for changes
            shellSelector.addEventListener('change', async (event) => {
                const newShell = event.target.value;
                const displayValue = newShell || "<System Default>";
                try {
                    await window.go.main.App.SetDefaultShell(newShell);
                    // Adjusted notification:
                    showNotification(`Default shell preference updated to: ${displayValue}. Settings will be saved shortly.`, 'info'); // Changed to 'info' and updated text
                    console.log("Default shell preference updated to:", newShell); // Log updated preference
                } catch (error) {
                    console.error("Error updating default shell preference:", error); // Adjusted error log
                    showNotification(`Failed to update default shell preference.`, 'error'); // Adjusted error notification
                    // Re-fetch to show actual stored state on error
                    this.loadAndPopulateShellSelector(); 
                }
            });
        }
    }

    async loadAndPopulateShellSelector() {
        const shellSelector = document.getElementById('shell-selector');
        if (!shellSelector) {
            // This check is redundant if called only from initializeSettingsTabs after its own check,
            // but good for a standalone callable method.
            console.error("Shell selector dropdown not found for loading.");
            return;
        }

        try {
            // Fetch available shells (formatted for UI) and current configured shell
            const availableShells = await window.go.main.App.GetAvailableShellsFormatted();
            const currentConfiguredShell = await window.go.main.App.GetCurrentDefaultShellSetting();

            // Clear existing options
            shellSelector.innerHTML = '';

            // Add a "System Default" option
            const defaultOption = document.createElement('option');
            defaultOption.value = ""; // Empty value represents system default
            defaultOption.textContent = "<System Default>";
            shellSelector.appendChild(defaultOption);

            // Populate with available shells using formatted names
            if (availableShells && availableShells.length > 0) {
                availableShells.forEach(shell => {
                    const option = document.createElement('option');
                    option.value = shell.value;  // Raw value for saving to config
                    option.textContent = shell.name;  // Formatted name for display
                    shellSelector.appendChild(option);
                });
            }

            // Set selected value
            shellSelector.value = currentConfiguredShell;
            
            console.log("Shell selector populated. Current configured:", currentConfiguredShell, "Available:", availableShells);

        } catch (error) {
            console.error("Error loading shell information:", error);
            showNotification("Error loading shell settings.", "error");
            // Add a placeholder error option
            shellSelector.innerHTML = '<option value="">Error loading shells</option>';
        }
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