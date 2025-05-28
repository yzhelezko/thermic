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
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', async (e) => {
                try {
                    e.preventDefault();
                    e.stopPropagation();
                    await this.toggleSettingsPanel();
                } catch (error) {
                    console.error('Error in settings button click handler:', error);
                }
            });
        } else {
            console.warn('Settings button not found');
        }

        // Close settings when clicking overlay
        const settingsOverlay = document.getElementById('settings-overlay');
        if (settingsOverlay) {
            settingsOverlay.addEventListener('click', (e) => {
                // Only close if clicking directly on the overlay background, not its children
                if (e.target.id === 'settings-overlay' && e.target === e.currentTarget) {
                    this.closeSettingsPanel();
                }
            });
        } else {
            console.warn('Settings overlay not found');
        }

        // Close settings with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const overlay = document.getElementById('settings-overlay');
                if (overlay && overlay.classList.contains('active')) {
                    this.closeSettingsPanel();
                }
            }
        });
    }

    async toggleSettingsPanel() {
        try {
            const overlay = document.getElementById('settings-overlay');
            const settingsBtn = document.getElementById('settings-btn');
            
            if (!overlay || !settingsBtn) {
                console.warn('Settings panel elements not found');
                return;
            }
            
            if (overlay.classList.contains('active')) {
                this.closeSettingsPanel();
            } else {
                overlay.classList.add('active');
                settingsBtn.classList.add('active');
                
                // Force display to ensure it's visible (CSS fallback)
                overlay.style.display = 'block';
                
                // Initialize settings tabs if not already done
                try {
                    await this.initializeSettingsTabs();
                } catch (tabsError) {
                    console.error('Error initializing settings tabs:', tabsError);
                    // Still show the panel even if tabs initialization fails
                }
            }
        } catch (error) {
            console.error('Error toggling settings panel:', error);
        }
    }

    async initializeSettingsTabs() {
        // Avoid multiple initializations
        if (this.settingsTabsInitialized) {
            return;
        }
        
        try {
            const settingsTabs = document.querySelectorAll('.settings-tab');
            const settingsTabPanes = document.querySelectorAll('.settings-tab-pane');

            if (settingsTabs.length === 0) {
                console.warn("No settings tabs found - elements may not be ready yet");
                return; // Elements not ready yet
            }

            settingsTabs.forEach((tab, index) => {
                try {
                    tab.addEventListener('click', () => {
                        try {
                            // Deactivate all tabs and panes
                            settingsTabs.forEach(t => t.classList.remove('active'));
                            settingsTabPanes.forEach(p => p.classList.remove('active'));

                            // Activate clicked tab and corresponding pane
                            tab.classList.add('active');
                            const targetPaneId = tab.dataset.tabTarget;
                            const targetPane = document.querySelector(targetPaneId);
                            if (targetPane) {
                                targetPane.classList.add('active');
                            } else {
                                console.warn(`Target pane not found: ${targetPaneId}`);
                            }
                        } catch (error) {
                            console.error('Error in tab click handler:', error);
                        }
                    });
                } catch (error) {
                    console.error(`Error setting up tab ${index}:`, error);
                }
            });

            // Dark mode toggle in settings panel
            try {
                const darkModeToggle = document.getElementById('dark-mode-toggle');
                if (darkModeToggle) {
                    darkModeToggle.addEventListener('change', () => {
                        try {
                            this.onThemeChange?.();
                        } catch (error) {
                            console.error('Error in theme change handler:', error);
                        }
                    });
                } else {
                    console.warn('Dark mode toggle not found');
                }
            } catch (error) {
                console.error('Error setting up dark mode toggle:', error);
            }

            this.settingsTabsInitialized = true;
        } catch (error) {
            console.error('Error initializing settings tabs:', error);
        }

        // --- Shell Selector Logic ---
        const shellSelector = document.getElementById('shell-selector');
        if (!shellSelector) {
            console.error("Shell selector dropdown not found for loading.");
            return;
        }
        
        // Load shell options
        this.loadAndPopulateShellSelector().catch(error => {
            console.error('Error loading shell selector:', error);
        });
        
        // Add delayed retry to ensure it works
        setTimeout(async () => {
            try {
                const currentOptions = document.getElementById('shell-selector')?.options.length || 0;
                if (currentOptions <= 1) { // Only default option
                    await this.loadAndPopulateShellSelector();
                }
            } catch (error) {
                console.error('Error in delayed shell selector check:', error);
            }
        }, 500);

        // Add event listener for changes
        shellSelector.addEventListener('change', async (event) => {
            const newShell = event.target.value;
            
            try {
                // Get OS info for more specific messaging
                const osInfo = await window.go.main.App.GetOSInfo();
                const osName = this.getOSDisplayName(osInfo.os);
                
                await window.go.main.App.SetDefaultShell(newShell);
                
                const displayValue = newShell ? this.formatShellName(newShell) : `System Default (${this.formatShellName(osInfo.defaultShell || 'auto')})`;
                showNotification(`Default shell for ${osName} updated to: ${displayValue}. New tabs will use this shell.`, 'info');
            } catch (error) {
                console.error("Error updating default shell preference:", error);
                showNotification(`Failed to update default shell preference: ${error.message}`, 'error');
                
                // Re-fetch to show actual stored state on error
                try {
                    await this.loadAndPopulateShellSelector();
                } catch (reloadError) {
                    console.error("Error reloading shell selector after failure:", reloadError);
                }
            }
        });

        // --- Context Menu Settings Logic ---
        this.setupContextMenuSettings().catch(error => {
            console.error('Error setting up context menu settings:', error);
        });

        // --- Profiles Path Settings Logic ---
        this.setupProfilesPathSettings().catch(error => {
            console.error('Error setting up profiles path settings:', error);
        });
    }

    async setupContextMenuSettings() {
        try {
            // Get select-to-copy toggle
            const selectToCopyToggle = document.getElementById('select-to-copy-toggle');

            if (!selectToCopyToggle) {
                console.warn('Select-to-copy toggle not found in DOM');
                return;
            }

            // Load current setting
            const selectToCopyEnabled = await window.go.main.App.GetSelectToCopyEnabled();

            // Set initial toggle state
            selectToCopyToggle.checked = selectToCopyEnabled;

            // Add event listener
            selectToCopyToggle.addEventListener('change', async (event) => {
                try {
                    const enabled = event.target.checked;
                    await window.go.main.App.SetSelectToCopyEnabled(enabled);
                    showNotification(`Select-to-copy ${enabled ? 'enabled' : 'disabled'}`, 'info');
                    
                    // Notify context menu manager about the change
                    if (window.contextMenuManager) {
                        window.contextMenuManager.updateContextMenuSettings();
                    }
                } catch (error) {
                    console.error('Error updating select-to-copy setting:', error);
                    showNotification(`Failed to update select-to-copy setting: ${error.message}`, 'error');
                    // Revert the toggle on error
                    event.target.checked = !event.target.checked;
                }
            });

        } catch (error) {
            console.error('Error in setupContextMenuSettings:', error);
        }
    }

    async setupProfilesPathSettings() {
        try {
            // Get profiles path elements
            const profilesPathInput = document.getElementById('profiles-path-input');
            const browseProfilesPathBtn = document.getElementById('browse-profiles-path');
            const saveProfilesPathBtn = document.getElementById('save-profiles-path');
            const currentProfilesPath = document.getElementById('current-profiles-path');

            if (!profilesPathInput || !browseProfilesPathBtn || !saveProfilesPathBtn || !currentProfilesPath) {
                console.warn('Profiles path settings elements not found in DOM');
                return;
            }

            // Load current profiles path setting
            await this.loadCurrentProfilesPath();

            // Browse button functionality
            browseProfilesPathBtn.addEventListener('click', async () => {
                try {
                    // Use Wails dialog to select directory
                    const selectedPath = await window.go.main.App.SelectDirectory();
                    if (selectedPath) {
                        profilesPathInput.value = selectedPath;
                    }
                } catch (error) {
                    console.error('Error selecting directory:', error);
                    showNotification(`Failed to open directory selector: ${error.message}`, 'error');
                }
            });

            // Save button functionality
            saveProfilesPathBtn.addEventListener('click', async () => {
                try {
                    const newPath = profilesPathInput.value.trim();
                    await window.go.main.App.SetProfilesPath(newPath);
                    await this.loadCurrentProfilesPath(); // Refresh current path display
                    
                    // Refresh the sidebar to reflect the new profiles directory
                    if (window.sidebarManager) {
                        await window.sidebarManager.loadProfileTree();
                        window.sidebarManager.renderProfileTree();
                        console.log('Sidebar refreshed after profiles path update');
                    }
                    
                    showNotification('Profiles path updated successfully', 'info');
                } catch (error) {
                    console.error('Error updating profiles path:', error);
                    showNotification(`Failed to update profiles path: ${error.message}`, 'error');
                }
            });

            // Enter key to save
            profilesPathInput.addEventListener('keypress', async (event) => {
                if (event.key === 'Enter') {
                    // Trigger the save button click which already includes sidebar refresh
                    saveProfilesPathBtn.click();
                }
            });

        } catch (error) {
            console.error('Error in setupProfilesPathSettings:', error);
        }
    }

    async loadCurrentProfilesPath() {
        try {
            const currentProfilesPath = document.getElementById('current-profiles-path');
            const profilesPathInput = document.getElementById('profiles-path-input');
            
            if (!currentProfilesPath || !profilesPathInput) {
                return;
            }

            // Get current configured path and actual directory
            const configuredPath = await window.go.main.App.GetProfilesPath();
            const actualDirectory = await window.go.main.App.GetProfilesDirectory();

            // Update input with configured path
            profilesPathInput.value = configuredPath || '';

            // Show actual directory being used
            if (configuredPath) {
                currentProfilesPath.textContent = actualDirectory;
            } else {
                currentProfilesPath.textContent = `${actualDirectory} (default)`;
            }

        } catch (error) {
            console.error('Error loading current profiles path:', error);
            const currentProfilesPath = document.getElementById('current-profiles-path');
            if (currentProfilesPath) {
                currentProfilesPath.textContent = 'Error loading path';
            }
        }
    }

    async loadAndPopulateShellSelector() {
        const shellSelector = document.getElementById('shell-selector');
        if (!shellSelector) {
            console.error("Shell selector dropdown not found for loading.");
            return;
        }

        try {
            // Fetch OS info, available shells, and current configured shell
            const osInfo = await window.go.main.App.GetOSInfo();
            const availableShells = await window.go.main.App.GetAvailableShellsFormatted();
            const currentConfiguredShell = await window.go.main.App.GetCurrentDefaultShellSetting();
            
            // Update the shell selector label to show which platform we're configuring
            const shellSelectorLabel = document.querySelector('label[for="shell-selector"]');
            if (shellSelectorLabel) {
                const osName = this.getOSDisplayName(osInfo.os);
                shellSelectorLabel.textContent = `Default Shell (${osName}):`;
            }

            // Clear existing options
            shellSelector.innerHTML = '';

            // Add a "System Default" option with platform info
            const defaultOption = document.createElement('option');
            defaultOption.value = ""; // Empty value represents system default
            const systemDefault = osInfo.defaultShell || 'auto';
            defaultOption.textContent = `<System Default: ${this.formatShellName(systemDefault)}>`;
            shellSelector.appendChild(defaultOption);

            // Populate with available shells using formatted names
            if (availableShells && availableShells.length > 0) {
                availableShells.forEach(shell => {
                    const option = document.createElement('option');
                    option.value = shell.value;  // Raw value for saving to config
                    option.textContent = shell.name;  // Formatted name for display
                    shellSelector.appendChild(option);
                });
            } else {
                console.warn("No shells available or shells array is empty");
            }

            // Set selected value
            shellSelector.value = currentConfiguredShell;

        } catch (error) {
            console.error("Error loading shell information:", error);
            showNotification("Error loading shell settings: " + error.message, "error");
            
            // Add a placeholder error option
            shellSelector.innerHTML = '<option value="">Error loading shells</option>';
        }
    }

    getOSDisplayName(osCode) {
        switch (osCode) {
            case 'windows':
                return 'Windows';
            case 'darwin':
                return 'macOS';
            case 'linux':
                return 'Linux';
            default:
                return osCode || 'Unknown';
        }
    }

    formatShellName(shellName) {
        if (!shellName) return 'Unknown';
        
        switch (shellName.toLowerCase()) {
            case 'bash':
                return 'Bash';
            case 'zsh':
                return 'Zsh';
            case 'fish':
                return 'Fish';
            case 'powershell':
            case 'powershell.exe':
                return 'PowerShell';
            case 'pwsh':
            case 'pwsh.exe':
                return 'PowerShell 7+';
            case 'cmd':
            case 'cmd.exe':
                return 'Command Prompt';
            default:
                if (shellName.startsWith('wsl::')) {
                    const distro = shellName.replace('wsl::', '');
                    return `WSL: ${distro.charAt(0).toUpperCase() + distro.slice(1)}`;
                }
                return shellName;
        }
    }

    closeSettingsPanel() {
        try {
            const overlay = document.getElementById('settings-overlay');
            const settingsBtn = document.getElementById('settings-btn');
            
            if (overlay) {
                overlay.classList.remove('active');
                // Reset inline style to let CSS take over
                overlay.style.display = '';
            } else {
                console.warn('Settings overlay not found when trying to close');
            }
            
            if (settingsBtn) {
                settingsBtn.classList.remove('active');
            } else {
                console.warn('Settings button not found when trying to deactivate');
            }
        } catch (error) {
            console.error('Error closing settings panel:', error);
        }
    }

    // Sync the dark mode toggle with current theme
    syncDarkModeToggle(isDarkTheme) {
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.checked = isDarkTheme;
        }
    }


} 