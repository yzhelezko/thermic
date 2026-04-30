// Settings management module
import { showNotification } from './utils.js';
import { updateAllIconsToInline, updateThemeToggleIcon } from '../utils/icons.js';
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime.js';
import { GetHotkeyActions, GetHotkeys, SetHotkey, ResetHotkey, ResetAllHotkeys } from '../../wailsjs/go/main/App';
import { hotkeyManager } from './hotkey-manager.js';

const REPO_URL = 'https://github.com/yzhelezko/thermic';
const RELEASES_URL = 'https://github.com/yzhelezko/thermic/releases';
const ISSUES_URL = 'https://github.com/yzhelezko/thermic/issues';

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
                
                // Ensure the settings panel HTML is rendered first
                if (!overlay.innerHTML.trim()) {
                    console.log('Rendering settings panel HTML...');
                    try {
                        // Import and render the template
                        const { createSettingsPanelTemplate } = await import('./templates.js');
                        overlay.innerHTML = createSettingsPanelTemplate();
                        // Reset the initialization flag since we have new HTML
                        this.settingsTabsInitialized = false;
                        console.log('Settings panel HTML rendered successfully');
                    } catch (error) {
                        console.error('Error rendering settings panel template:', error);
                        return;
                    }
                }
                
                // Initialize settings tabs if not already done
                try {
                    await this.initializeSettingsTabs();
                } catch (tabsError) {
                    console.error('Error initializing settings tabs:', tabsError);
                    // Still show the panel even if tabs initialization fails
                }
                
                // Convert any img-based icons to inline SVGs for proper theme support
                try {
                    await updateAllIconsToInline();
                } catch (iconsError) {
                    console.warn('Error updating icons in settings panel:', iconsError);
                }
            }
        } catch (error) {
            console.error('Error toggling settings panel:', error);
        }
    }

    async initializeSettingsTabs() {
        // Avoid multiple initializations unless we've reset the flag
        if (this.settingsTabsInitialized) {
            console.log('Settings tabs already initialized, skipping');
            return;
        }
        
        try {
            console.log('Initializing settings tabs...');
            
            const settingsTabs = document.querySelectorAll('.settings-tab');
            const settingsTabPanes = document.querySelectorAll('.settings-tab-pane');

            if (settingsTabs.length === 0) {
                console.warn("No settings tabs found - elements may not be ready yet");
                return; // Elements not ready yet
            }

            console.log(`Found ${settingsTabs.length} settings tabs and ${settingsTabPanes.length} tab panes`);

            settingsTabs.forEach((tab, index) => {
                try {
                    tab.addEventListener('click', async () => {
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
                                
                                // Update icons in the newly visible pane
                                try {
                                    await updateAllIconsToInline();
                                } catch (iconsError) {
                                    console.warn('Error updating icons in tab:', iconsError);
                                }
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

            // Theme selector (dark / light / system)
            try {
                const themeSelect = document.getElementById('theme-mode-select');
                if (themeSelect) {
                    let currentTheme = 'dark';
                    try {
                        if (window.go?.main?.App?.ConfigGet) {
                            currentTheme = await window.go.main.App.ConfigGet('Theme') || 'dark';
                        }
                    } catch (_) { /* fallback to default */ }
                    themeSelect.value = currentTheme;

                    themeSelect.addEventListener('change', async (event) => {
                        const value = event.target.value;
                        try {
                            if (window.themeManager) {
                                await window.themeManager.setTheme(value);
                            }
                            // Compute the effective dark/light to update terminal + icons
                            let effectiveDark = value === 'dark';
                            if (value === 'system' && window.matchMedia) {
                                effectiveDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                            }
                            const themeToggle = document.getElementById('theme-toggle');
                            if (themeToggle) {
                                await updateThemeToggleIcon(themeToggle, effectiveDark);
                            }
                            await updateAllIconsToInline();
                            if (window.thermicApp?.terminalManager) {
                                window.thermicApp.terminalManager.updateTheme(effectiveDark);
                            }
                            if (window.thermicApp?.uiManager?.onThemeChange) {
                                window.thermicApp.uiManager.onThemeChange(effectiveDark);
                            }
                            if (window.thermicApp?.activityBarManager) {
                                window.thermicApp.activityBarManager.isDarkTheme = effectiveDark;
                            }
                            showNotification(`Theme set to ${value}`, 'info');
                        } catch (error) {
                            console.error('Error applying theme:', error);
                            showNotification(`Failed to apply theme: ${error.message}`, 'error');
                        }
                    });
                }
            } catch (error) {
                console.error('Error setting up theme selector:', error);
            }

            // Legacy dark-mode toggle (kept for backwards compatibility if surfaced elsewhere)
            try {
                const darkModeToggle = document.getElementById('dark-mode-toggle');
                if (darkModeToggle) {
                    console.log('Dark mode toggle element found');
                    // Initialize the toggle with theme from config (with fallback to DOM)
                    let initialTheme = 'dark'; // default
                    
                    try {
                                if (window.go?.main?.App?.ConfigGet) {
            initialTheme = await window.go.main.App.ConfigGet("Theme");
                            console.log('Loaded initial theme from config for settings toggle:', initialTheme);
                        } else {
                            // Fallback to DOM
                            const currentTheme = document.documentElement.getAttribute('data-theme');
                            initialTheme = currentTheme || 'dark';
                            console.log('Fallback: loaded initial theme from DOM for settings toggle:', initialTheme);
                        }
                    } catch (error) {
                        console.warn('Failed to load theme from config, using DOM fallback:', error);
                        const currentTheme = document.documentElement.getAttribute('data-theme');
                        initialTheme = currentTheme || 'dark';
                    }
                    
                    darkModeToggle.checked = initialTheme === 'dark';
                    console.log('Settings dark mode toggle initialized with state:', darkModeToggle.checked);
                    
                    darkModeToggle.addEventListener('change', async () => {
                        try {
                            const isDarkMode = darkModeToggle.checked;
                            console.log('Dark mode toggle changed in settings:', isDarkMode);
                            
                            // Apply the theme through theme manager for consistency
                            const newTheme = isDarkMode ? 'dark' : 'light';
                            if (window.themeManager) {
                                await window.themeManager.setTheme(newTheme);
                                console.log('Theme set through theme manager:', newTheme);
                            } else {
                                // Fallback to direct DOM manipulation
                                document.documentElement.setAttribute('data-theme', newTheme);
                                document.body.setAttribute('data-theme', newTheme);
                                console.log('Theme set directly (theme manager not available):', newTheme);
                            }
                            
                            // Update theme toggle icon in activity bar with explicit theme state
                            const themeToggle = document.getElementById('theme-toggle');
                            if (themeToggle) {
                                await updateThemeToggleIcon(themeToggle, isDarkMode);
                            }
                            
                            // Update all icons to inline SVGs for proper theme support
                            await updateAllIconsToInline();
                            
                            // Update terminal theme (fix for terminal output window not updating)
                            if (window.thermicApp?.terminalManager) {
                                window.thermicApp.terminalManager.updateTheme(isDarkMode);
                                console.log('Updated terminal theme from settings panel');
                            }
                            
                            // Trigger UI manager theme change callback if available
                            if (window.thermicApp?.uiManager?.onThemeChange) {
                                window.thermicApp.uiManager.onThemeChange(isDarkMode);
                                console.log('Triggered UI manager theme change callback');
                            }
                            
                            // Sync with activity bar manager if available
                            if (window.thermicApp?.activityBarManager) {
                                window.thermicApp.activityBarManager.isDarkTheme = isDarkMode;
                                console.log('Synced theme state with activity bar manager');
                            }
                            
                            // Theme manager already handles saving to config when setTheme is called
                            
                            console.log('Theme applied from settings panel:', newTheme);
                        } catch (error) {
                            console.error('Error in settings theme change handler:', error);
                            // Revert the toggle on error
                            darkModeToggle.checked = !darkModeToggle.checked;
                        }
                    });
                    
                    console.log('Dark mode toggle in settings panel initialized successfully');
                } else {
                    console.warn('Dark mode toggle not found in settings panel - element may not exist yet');
                }
            } catch (error) {
                console.error('Error setting up dark mode toggle in settings:', error);
            }

            this.settingsTabsInitialized = true;
            console.log('Settings tabs initialization completed successfully');
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
                
                await window.go.main.App.ConfigSet("DefaultShell", newShell);
                
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

        // --- Terminal Settings Logic ---
        this.setupTerminalSettings().catch(error => {
            console.error('Error setting up terminal settings:', error);
        });

        // --- URL Opening Settings Logic ---
        this.setupURLSettings().catch(error => {
            console.error('Error setting up URL settings:', error);
        });

        // --- SFTP Transfer Settings Logic ---
        this.setupSFTPSettings().catch(error => {
            console.error('Error setting up SFTP settings:', error);
        });

        // --- Profiles Path Settings Logic ---
        this.setupProfilesPathSettings().catch(error => {
            console.error('Error setting up profiles path settings:', error);
        });

        // --- AI Settings Logic ---
        this.setupAISettings().catch(error => {
            console.error('Error setting up AI settings:', error);
        });

        // --- Terminal Typography Logic ---
        this.setupTypographySettings().catch(error => {
            console.error('Error setting up typography settings:', error);
        });

        // --- Updates Logic ---
        this.setupUpdatesSettings().catch(error => {
            console.error('Error setting up updates settings:', error);
        });

        // --- About Logic ---
        this.setupAboutSection().catch(error => {
            console.error('Error setting up about section:', error);
        });

        // --- Terminal Behavior (bell, word separators, confirm-close, restore tabs) ---
        this.setupTerminalBehaviorSettings().catch(error => {
            console.error('Error setting up terminal behavior settings:', error);
        });

        // --- Scroll Sensitivity ---
        this.setupScrollSensitivitySettings().catch(error => {
            console.error('Error setting up scroll sensitivity settings:', error);
        });

        // --- Window: Always on Top ---
        this.setupWindowSettings().catch(error => {
            console.error('Error setting up window settings:', error);
        });

        // --- SSH Defaults ---
        this.setupSSHDefaultsSettings().catch(error => {
            console.error('Error setting up SSH defaults settings:', error);
        });

        // --- Hotkeys ---
        this.setupHotkeysSettings().catch(error => {
            console.error('Error setting up hotkeys settings:', error);
        });

        // --- UI Zoom Setting Logic ---
        // The settings panel HTML is rendered lazily, so we attach the input here every time
        // the tabs are initialized. UIZoomManager.attachSettingsInput is idempotent.
        const uiScaleInput = document.getElementById('ui-scale-input');
        if (uiScaleInput && window.uiZoomManager) {
            window.uiZoomManager.attachSettingsInput(uiScaleInput);
        }
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
            const selectToCopyEnabled = await window.go.main.App.ConfigGet("EnableSelectToCopy");

            // Set initial toggle state
            selectToCopyToggle.checked = selectToCopyEnabled;

            // Add event listener
            selectToCopyToggle.addEventListener('change', async (event) => {
                try {
                    const enabled = event.target.checked;
                    await window.go.main.App.ConfigSet("EnableSelectToCopy", enabled);
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

    async setupTerminalSettings() {
        try {
            // Get terminal settings elements
            const scrollbackLinesInput = document.getElementById('scrollback-lines-input');

            if (!scrollbackLinesInput) {
                console.warn('Terminal settings elements not found in DOM');
                return;
            }

            // Load current settings from backend
            const scrollbackLines = await window.go.main.App.ConfigGet("ScrollbackLines");

            // Set initial values
            scrollbackLinesInput.value = scrollbackLines;

            // Scrollback lines input handler with debouncing
            let scrollbackDebounceTimeout;
            scrollbackLinesInput.addEventListener('input', (event) => {
                clearTimeout(scrollbackDebounceTimeout);
                scrollbackDebounceTimeout = setTimeout(async () => {
                    try {
                        const lines = parseInt(event.target.value, 10);
                        if (isNaN(lines) || lines < 100 || lines > 100000) {
                            showNotification('Scrollback lines must be between 100 and 100,000', 'error');
                            // Reset to current value
                            event.target.value = await window.go.main.App.ConfigGet("ScrollbackLines");
                            return;
                        }
                        
                        await window.go.main.App.ConfigSet("ScrollbackLines", lines);
                        showNotification(`Scrollback lines updated to ${lines}`, 'info');
                    } catch (error) {
                        console.error('Error updating scrollback lines:', error);
                        showNotification(`Failed to update scrollback lines: ${error.message}`, 'error');
                        // Reset to current value
                        event.target.value = await window.go.main.App.ConfigGet("ScrollbackLines");
                    }
                }, 1000); // 1 second debounce
            });



        } catch (error) {
            console.error('Error in setupTerminalSettings:', error);
        }
    }

    async setupURLSettings() {
        try {
            // Get URL settings elements
            const openLinksExternalToggle = document.getElementById('open-links-external-toggle');

            if (!openLinksExternalToggle) {
                console.warn('URL settings elements not found in DOM');
                return;
            }

            // Load current setting from backend
            const openLinksExternal = await window.go.main.App.ConfigGet("OpenLinksInExternalBrowser");

            // Set initial toggle state
            openLinksExternalToggle.checked = openLinksExternal;

            // Add event listener for toggle
            openLinksExternalToggle.addEventListener('change', async (event) => {
                try {
                    const enabled = event.target.checked;
                    await window.go.main.App.ConfigSet("OpenLinksInExternalBrowser", enabled);
                    showNotification(`URLs will ${enabled ? 'open in external browser' : 'open in-app'}`, 'info');
                } catch (error) {
                    console.error('Error updating URL opening setting:', error);
                    showNotification(`Failed to update URL setting: ${error.message}`, 'error');
                    // Revert the toggle on error
                    event.target.checked = !event.target.checked;
                }
            });

        } catch (error) {
            console.error('Error in setupURLSettings:', error);
        }
    }

    async setupSFTPSettings() {
        try {
            // Get SFTP settings elements
            const parallelTransfersInput = document.getElementById('sftp-parallel-transfers-input');
            const maxPacketInput = document.getElementById('sftp-max-packet-input');
            const bufferSizeInput = document.getElementById('sftp-buffer-size-input');
            const concurrentIOToggle = document.getElementById('sftp-concurrent-io-toggle');

            if (!parallelTransfersInput || !maxPacketInput || !bufferSizeInput || !concurrentIOToggle) {
                console.warn('SFTP settings elements not found in DOM');
                return;
            }

            // Load current SFTP settings from backend
            const sftpConfig = await window.go.main.App.ConfigGet("SFTP");
            
            if (sftpConfig) {
                parallelTransfersInput.value = sftpConfig.parallel_transfers || 4;
                maxPacketInput.value = (sftpConfig.max_packet_size || 262144) / 1024; // Convert bytes to KB
                bufferSizeInput.value = (sftpConfig.buffer_size || 1048576) / 1024; // Convert bytes to KB
                concurrentIOToggle.checked = sftpConfig.use_concurrent_io !== false; // Default to true
            }

            // Debounced handlers for numeric inputs
            let debounceTimeout;
            const saveWithDebounce = async (field, value) => {
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(async () => {
                    try {
                        const currentConfig = await window.go.main.App.ConfigGet("SFTP") || {};
                        currentConfig[field] = value;
                        await window.go.main.App.ConfigSet("SFTP", currentConfig);
                        showNotification('SFTP settings updated (apply on next connection)', 'info');
                    } catch (error) {
                        console.error('Error updating SFTP setting:', error);
                        showNotification(`Failed to update SFTP setting: ${error.message}`, 'error');
                    }
                }, 1000);
            };

            // Parallel transfers handler
            parallelTransfersInput.addEventListener('input', async (event) => {
                const value = parseInt(event.target.value, 10);
                if (isNaN(value) || value < 1 || value > 16) {
                    showNotification('Parallel transfers must be between 1 and 16', 'error');
                    event.target.value = 4;
                    return;
                }
                saveWithDebounce('parallel_transfers', value);
            });

            // Max packet size handler (input in KB, store in bytes)
            maxPacketInput.addEventListener('input', async (event) => {
                const valueKB = parseInt(event.target.value, 10);
                if (isNaN(valueKB) || valueKB < 32 || valueKB > 512) {
                    showNotification('Max packet size must be between 32 and 512 KB', 'error');
                    event.target.value = 256;
                    return;
                }
                saveWithDebounce('max_packet_size', valueKB * 1024);
            });

            // Buffer size handler (input in KB, store in bytes)
            bufferSizeInput.addEventListener('input', async (event) => {
                const valueKB = parseInt(event.target.value, 10);
                if (isNaN(valueKB) || valueKB < 64 || valueKB > 16384) {
                    showNotification('Buffer size must be between 64 and 16384 KB', 'error');
                    event.target.value = 1024;
                    return;
                }
                saveWithDebounce('buffer_size', valueKB * 1024);
            });

            // Concurrent I/O toggle handler
            concurrentIOToggle.addEventListener('change', async (event) => {
                try {
                    const currentConfig = await window.go.main.App.ConfigGet("SFTP") || {};
                    currentConfig.use_concurrent_io = event.target.checked;
                    await window.go.main.App.ConfigSet("SFTP", currentConfig);
                    showNotification(`Concurrent I/O ${event.target.checked ? 'enabled' : 'disabled'} (apply on next connection)`, 'info');
                } catch (error) {
                    console.error('Error updating concurrent I/O setting:', error);
                    showNotification(`Failed to update setting: ${error.message}`, 'error');
                    event.target.checked = !event.target.checked;
                }
            });

        } catch (error) {
            console.error('Error in setupSFTPSettings:', error);
        }
    }

    async setupProfilesPathSettings() {
        try {
            // Get profiles path elements
            const profilesPathInput = document.getElementById('profiles-path-input');
            const browseProfilesPathBtn = document.getElementById('browse-profiles-path');
            const saveProfilesPathBtn = document.getElementById('save-profiles-path');

            if (!profilesPathInput || !browseProfilesPathBtn || !saveProfilesPathBtn) {
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
                    await window.go.main.App.ConfigSet("ProfilesPath", newPath);
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
            const profilesPathInput = document.getElementById('profiles-path-input');
            
            if (!profilesPathInput) {
                return;
            }

            // Get the actual directory being used (this is what we want to show in the input)
            const actualDirectory = await window.go.main.App.GetProfilesDirectory();

            // Populate the input field with the current actual directory path
            profilesPathInput.value = actualDirectory || '';

        } catch (error) {
            console.error('Error loading current profiles path:', error);
            const profilesPathInput = document.getElementById('profiles-path-input');
            if (profilesPathInput) {
                profilesPathInput.value = '';
                profilesPathInput.placeholder = 'Error loading current path';
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
            const currentConfiguredShell = await window.go.main.App.ConfigGet("DefaultShell");
            
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

    async setupAISettings() {
        try {
            console.log('Setting up AI settings...');

            // Get AI settings elements
            const aiEnabledToggle = document.getElementById('ai-enabled-toggle');
            const aiProviderSelect = document.getElementById('ai-provider-select');
            const aiModelInput = document.getElementById('ai-model-input');
            const aiModelSuggestions = document.getElementById('ai-model-suggestions');
            const aiApiKeyInput = document.getElementById('ai-api-key-input');
            const aiApiKeyToggle = document.getElementById('ai-api-key-toggle');
            const aiApiUrlInput = document.getElementById('ai-api-url-input');

            const aiTestConnectionBtn = document.getElementById('ai-test-connection-btn');
            const aiConnectionStatus = document.getElementById('ai-connection-status');

            if (!aiEnabledToggle || !aiProviderSelect || !aiModelInput) {
                console.warn('Some AI settings elements not found in DOM');
                return;
            }

            // Load current AI configuration using ConfigGet
            const aiEnabled = await window.go.main.App.ConfigGet("AIEnabled");
            const aiProvider = await window.go.main.App.ConfigGet("AIProvider");
            const aiModelID = await window.go.main.App.ConfigGet("AIModelID");
            const aiAPIKey = await window.go.main.App.ConfigGet("AIAPIKey");
            const aiAPIURL = await window.go.main.App.ConfigGet("AIURL");

            // Set initial values
            aiEnabledToggle.checked = aiEnabled || false;
            aiProviderSelect.value = aiProvider || 'openai';
            aiModelInput.value = aiModelID || 'gpt-4o-mini';
            if (aiApiKeyInput) aiApiKeyInput.value = aiAPIKey || '';
            if (aiApiUrlInput) aiApiUrlInput.value = aiAPIURL || '';

            // AI enabled toggle
            aiEnabledToggle.addEventListener('change', async (event) => {
                try {
                    const enabled = event.target.checked;
                    await window.go.main.App.ConfigSet('AIEnabled', enabled);
                    showNotification(`AI assistant ${enabled ? 'enabled' : 'disabled'}`, 'info');
                } catch (error) {
                    console.error('Error updating AI enabled setting:', error);
                    showNotification(`Failed to update AI setting: ${error.message}`, 'error');
                    event.target.checked = !event.target.checked;
                }
            });

            // AI provider select
            aiProviderSelect.addEventListener('change', async (event) => {
                try {
                    const provider = event.target.value;
                    await window.go.main.App.ConfigSet('AIProvider', provider);
                    showNotification(`AI provider set to ${provider}`, 'info');
                } catch (error) {
                    console.error('Error updating AI provider:', error);
                    showNotification(`Failed to update AI provider: ${error.message}`, 'error');
                }
            });

            // Model input with suggestions
            if (aiModelInput && aiModelSuggestions) {
                aiModelInput.addEventListener('input', async (event) => {
                    try {
                        const modelID = event.target.value.trim();
                        await window.go.main.App.ConfigSet('AIModelID', modelID);
                    } catch (error) {
                        console.error('Error updating AI model:', error);
                    }
                });

                aiModelInput.addEventListener('focus', () => {
                    aiModelSuggestions.classList.add('show');
                });

                aiModelInput.addEventListener('blur', () => {
                    // Delay hiding to allow clicks on suggestions
                    setTimeout(() => {
                        aiModelSuggestions.classList.remove('show');
                    }, 200);
                });

                // Handle suggestion clicks
                aiModelSuggestions.addEventListener('click', async (event) => {
                    const suggestionItem = event.target.closest('.suggestion-item');
                    if (suggestionItem) {
                        const modelID = suggestionItem.dataset.model;
                        aiModelInput.value = modelID;
                        aiModelSuggestions.classList.remove('show');
                        
                        try {
                            await window.go.main.App.ConfigSet('AIModelID', modelID);
                            showNotification(`AI model set to ${modelID}`, 'info');
                        } catch (error) {
                            console.error('Error updating AI model:', error);
                            showNotification(`Failed to update AI model: ${error.message}`, 'error');
                        }
                    }
                });
            }

                            // API key input with enhanced status display
            if (aiApiKeyInput) {
                const aiApiKeyStatus = document.getElementById('ai-api-key-status');
                
                // Update API key status
                const updateApiKeyStatus = (apiKey) => {
                    if (!aiApiKeyStatus) return;
                    
                    if (apiKey && apiKey.length > 0) {
                        aiApiKeyStatus.innerHTML = `
                            <img src="./assets/icons/success.svg" class="svg-icon small" alt="✓">
                            <span>Configured (${apiKey.length} chars)</span>
                        `;
                        aiApiKeyStatus.className = 'api-key-status configured';
                    } else {
                        aiApiKeyStatus.innerHTML = `
                            <img src="./assets/icons/warning.svg" class="svg-icon small" alt="⚠️">
                            <span>Not configured</span>
                        `;
                        aiApiKeyStatus.className = 'api-key-status';
                    }
                };
                
                // Initial status update
                updateApiKeyStatus(aiApiKeyInput.value);
                
                let apiKeyDebounceTimeout;
                aiApiKeyInput.addEventListener('input', (event) => {
                    const apiKey = event.target.value.trim();
                    updateApiKeyStatus(apiKey);
                    
                    clearTimeout(apiKeyDebounceTimeout);
                    apiKeyDebounceTimeout = setTimeout(async () => {
                        try {
                            await window.go.main.App.ConfigSet('AIAPIKey', apiKey);
                        } catch (error) {
                            console.error('Error updating AI API key:', error);
                        }
                    }, 1000);
                });

                // API key show/hide toggle with simple text button
                if (aiApiKeyToggle) {
                    aiApiKeyToggle.addEventListener('click', () => {
                        const isPassword = aiApiKeyInput.type === 'password';
                        aiApiKeyInput.type = isPassword ? 'text' : 'password';
                        aiApiKeyToggle.textContent = isPassword ? 'Hide' : 'Show';
                    });
                }
            }

            // API URL input
            if (aiApiUrlInput) {
                let apiUrlDebounceTimeout;
                aiApiUrlInput.addEventListener('input', (event) => {
                    clearTimeout(apiUrlDebounceTimeout);
                    apiUrlDebounceTimeout = setTimeout(async () => {
                        try {
                            const apiUrl = event.target.value.trim();
                            await window.go.main.App.ConfigSet('AIURL', apiUrl);
                        } catch (error) {
                            console.error('Error updating AI API URL:', error);
                        }
                    }, 1000);
                });
            }



            // Test connection button with enhanced status display
            if (aiTestConnectionBtn && aiConnectionStatus) {
                aiTestConnectionBtn.addEventListener('click', async () => {
                    try {
                        aiTestConnectionBtn.disabled = true;
                        aiConnectionStatus.innerHTML = `
                            <img src="./assets/icons/refresh.svg" class="svg-icon small status-indicator" alt="⟳">
                            <span>Testing...</span>
                        `;
                        aiConnectionStatus.className = 'setting-status testing';

                        const result = await window.go.main.App.TestAIConnection();
                        
                        if (result.Success) {
                            aiConnectionStatus.innerHTML = `
                                <img src="./assets/icons/success.svg" class="svg-icon small status-indicator" alt="✓">
                                <span>Connected</span>
                            `;
                            aiConnectionStatus.className = 'setting-status success';
                            showNotification('AI connection test successful', 'success');
                        } else {
                            aiConnectionStatus.innerHTML = `
                                <img src="./assets/icons/error.svg" class="svg-icon small status-indicator" alt="✗">
                                <span>Failed: ${result.Error}</span>
                            `;
                            aiConnectionStatus.className = 'setting-status error';
                            showNotification(`AI connection test failed: ${result.Error}`, 'error');
                        }
                    } catch (error) {
                        console.error('Error testing AI connection:', error);
                        aiConnectionStatus.innerHTML = `
                            <img src="./assets/icons/error.svg" class="svg-icon small status-indicator" alt="✗">
                            <span>Error: ${error.message}</span>
                        `;
                        aiConnectionStatus.className = 'setting-status error';
                        showNotification(`AI connection test error: ${error.message}`, 'error');
                    } finally {
                        aiTestConnectionBtn.disabled = false;
                    }
                });
            }

            console.log('AI settings initialized successfully');

        } catch (error) {
            console.error('Error in setupAISettings:', error);
        }
    }

    async setupHotkeysSettings() {
        const root = document.getElementById('hotkeys-list');
        const resetAllBtn = document.getElementById('hotkeys-reset-all-btn');
        if (!root) return;

        const render = async () => {
            try {
                const [actions, bindings] = await Promise.all([GetHotkeyActions(), GetHotkeys()]);
                this.renderHotkeysList(root, actions || [], bindings || {});
            } catch (error) {
                console.error('Failed to load hotkeys:', error);
                root.innerHTML = '<div class="hotkeys-loading">Failed to load shortcuts</div>';
            }
        };

        if (resetAllBtn) {
            resetAllBtn.addEventListener('click', async () => {
                try {
                    await ResetAllHotkeys();
                    showNotification('All shortcuts restored to defaults', 'info');
                    await render();
                } catch (error) {
                    console.error('Failed to reset all hotkeys:', error);
                    showNotification(`Reset failed: ${error.message}`, 'error');
                }
            });
        }

        await render();
    }

    renderHotkeysList(root, actions, bindings) {
        // Group by category
        const byCategory = new Map();
        for (const action of actions) {
            const cat = action.category || 'Other';
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat).push(action);
        }

        // Detect conflicts (combos used by more than one action)
        const counts = new Map();
        for (const combo of Object.values(bindings)) {
            counts.set(combo, (counts.get(combo) || 0) + 1);
        }
        const conflicting = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c));

        const html = [];
        for (const [category, items] of byCategory) {
            html.push(`<div class="hotkey-category"><div class="hotkey-category-label">${this.escapeHtml(category)}</div>`);
            for (const action of items) {
                const combo = bindings[action.id] || action.default;
                const isOverride = combo !== action.default;
                const conflict = conflicting.has(combo);
                html.push(`
                    <div class="setting-item hotkey-row ${conflict ? 'has-conflict' : ''}" data-action-id="${this.escapeHtml(action.id)}">
                        <div class="setting-item-content">
                            <div class="setting-item-info">
                                <div class="setting-item-title">${this.escapeHtml(action.label)}</div>
                                <div class="setting-item-description">
                                    ${isOverride ? `Default: ${this.escapeHtml(action.default)}` : '&nbsp;'}
                                    ${conflict ? '<span class="hotkey-conflict-tag">conflict</span>' : ''}
                                </div>
                            </div>
                            <div class="setting-item-control hotkey-controls">
                                <input type="text" class="modern-input hotkey-input" data-hotkey-input="${this.escapeHtml(action.id)}"
                                    value="${this.escapeHtml(combo)}" readonly placeholder="Click & press">
                                <button type="button" class="modern-button secondary hotkey-reset-btn" data-hotkey-reset="${this.escapeHtml(action.id)}" title="Reset to default">↺</button>
                            </div>
                        </div>
                    </div>
                `);
            }
            html.push(`</div>`);
        }

        root.innerHTML = html.join('');

        // Wire capture inputs
        root.querySelectorAll('input[data-hotkey-input]').forEach(input => {
            const actionID = input.getAttribute('data-hotkey-input');
            input.addEventListener('focus', () => {
                input.dataset.previous = input.value;
                input.value = '';
                input.placeholder = 'Press combination…';
                input.classList.add('capturing');
            });
            input.addEventListener('blur', () => {
                input.classList.remove('capturing');
                if (!input.value) input.value = input.dataset.previous || '';
                input.placeholder = 'Click & press';
            });
            input.addEventListener('keydown', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') {
                    input.value = input.dataset.previous || '';
                    input.blur();
                    return;
                }
                const combo = hotkeyManager.eventToCombo(event);
                if (!combo) return;
                input.value = combo;
                try {
                    await SetHotkey(actionID, combo);
                    showNotification(`${actionID} → ${combo}`, 'info');
                } catch (error) {
                    console.error(`Failed to set hotkey ${actionID}:`, error);
                    showNotification(`Failed: ${error.message}`, 'error');
                    input.value = input.dataset.previous || '';
                }
                input.blur();
                // Re-render to refresh conflict highlights and override-indicator text
                await this.setupHotkeysSettings();
            });
        });

        // Wire per-row reset buttons
        root.querySelectorAll('button[data-hotkey-reset]').forEach(btn => {
            const actionID = btn.getAttribute('data-hotkey-reset');
            btn.addEventListener('click', async () => {
                try {
                    await ResetHotkey(actionID);
                    await this.setupHotkeysSettings();
                } catch (error) {
                    console.error(`Failed to reset hotkey ${actionID}:`, error);
                    showNotification(`Failed: ${error.message}`, 'error');
                }
            });
        });
    }

    escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    async setupTypographySettings() {
        const fontFamilyInput = document.getElementById('terminal-font-family-input');
        const fontSizeInput = document.getElementById('terminal-font-size-input');
        const lineHeightInput = document.getElementById('terminal-line-height-input');
        const cursorBlinkToggle = document.getElementById('terminal-cursor-blink-toggle');
        const cursorStyleSelect = document.getElementById('terminal-cursor-style-select');

        if (!fontFamilyInput || !fontSizeInput || !lineHeightInput || !cursorBlinkToggle) {
            console.warn('Typography settings elements not found in DOM');
            return;
        }

        try {
            const fontFamily = await window.go.main.App.ConfigGet('TerminalFontFamily');
            const fontSize = await window.go.main.App.ConfigGet('TerminalFontSize');
            const lineHeightPct = await window.go.main.App.ConfigGet('TerminalLineHeight');
            const cursorBlink = await window.go.main.App.ConfigGet('TerminalCursorBlink');
            const cursorStyle = await window.go.main.App.ConfigGet('TerminalCursorStyle');

            fontFamilyInput.value = fontFamily || '';
            fontSizeInput.value = fontSize || 14;
            lineHeightInput.value = (lineHeightPct ? lineHeightPct / 100 : 1.0).toFixed(1);
            cursorBlinkToggle.checked = !!cursorBlink;
            if (cursorStyleSelect) cursorStyleSelect.value = cursorStyle || 'block';
        } catch (error) {
            console.warn('Failed to load typography settings:', error);
        }

        if (cursorStyleSelect) {
            cursorStyleSelect.addEventListener('change', async (event) => {
                try {
                    await window.go.main.App.ConfigSet('TerminalCursorStyle', event.target.value);
                } catch (error) {
                    console.error('Error updating cursor style:', error);
                    showNotification(`Failed to update cursor style: ${error.message}`, 'error');
                }
            });
        }

        let fontFamilyTimeout;
        fontFamilyInput.addEventListener('input', (event) => {
            clearTimeout(fontFamilyTimeout);
            fontFamilyTimeout = setTimeout(async () => {
                const value = event.target.value.trim();
                if (!value) return;
                try {
                    await window.go.main.App.ConfigSet('TerminalFontFamily', value);
                } catch (error) {
                    console.error('Error updating terminal font family:', error);
                    showNotification(`Failed to update font family: ${error.message}`, 'error');
                }
            }, 800);
        });

        let fontSizeTimeout;
        fontSizeInput.addEventListener('input', (event) => {
            clearTimeout(fontSizeTimeout);
            fontSizeTimeout = setTimeout(async () => {
                const px = parseInt(event.target.value, 10);
                if (isNaN(px) || px < 8 || px > 32) {
                    showNotification('Font size must be between 8 and 32', 'error');
                    return;
                }
                try {
                    await window.go.main.App.ConfigSet('TerminalFontSize', px);
                } catch (error) {
                    console.error('Error updating font size:', error);
                    showNotification(`Failed to update font size: ${error.message}`, 'error');
                }
            }, 600);
        });

        let lineHeightTimeout;
        lineHeightInput.addEventListener('input', (event) => {
            clearTimeout(lineHeightTimeout);
            lineHeightTimeout = setTimeout(async () => {
                const lh = parseFloat(event.target.value);
                if (isNaN(lh) || lh < 0.8 || lh > 2.0) {
                    showNotification('Line height must be between 0.8 and 2.0', 'error');
                    return;
                }
                try {
                    await window.go.main.App.ConfigSet('TerminalLineHeight', Math.round(lh * 100));
                } catch (error) {
                    console.error('Error updating line height:', error);
                    showNotification(`Failed to update line height: ${error.message}`, 'error');
                }
            }, 600);
        });

        cursorBlinkToggle.addEventListener('change', async (event) => {
            try {
                await window.go.main.App.ConfigSet('TerminalCursorBlink', event.target.checked);
            } catch (error) {
                console.error('Error updating cursor blink:', error);
                showNotification(`Failed to update cursor: ${error.message}`, 'error');
                event.target.checked = !event.target.checked;
            }
        });
    }

    async setupUpdatesSettings() {
        const autoToggle = document.getElementById('auto-check-updates-toggle');
        const checkBtn = document.getElementById('check-updates-now-btn');
        const statusEl = document.getElementById('update-status');

        if (!autoToggle || !checkBtn || !statusEl) {
            console.warn('Updates settings elements not found in DOM');
            return;
        }

        try {
            autoToggle.checked = !!(await window.go.main.App.ConfigGet('AutoCheckUpdates'));
        } catch (error) {
            console.warn('Failed to load AutoCheckUpdates:', error);
        }

        autoToggle.addEventListener('change', async (event) => {
            try {
                await window.go.main.App.ConfigSet('AutoCheckUpdates', event.target.checked);
                showNotification(`Automatic update checks ${event.target.checked ? 'enabled' : 'disabled'}`, 'info');
            } catch (error) {
                console.error('Error updating auto-check setting:', error);
                showNotification(`Failed to update setting: ${error.message}`, 'error');
                event.target.checked = !event.target.checked;
            }
        });

        checkBtn.addEventListener('click', async () => {
            checkBtn.disabled = true;
            statusEl.textContent = 'Checking…';
            try {
                const updateInfo = await window.go.main.App.CheckForUpdates();
                if (updateInfo && updateInfo.available) {
                    statusEl.textContent = `Update available: ${updateInfo.latestVersion}`;
                    showNotification(`Update available: ${updateInfo.latestVersion}`, 'success');
                } else {
                    const current = updateInfo?.currentVersion || '';
                    statusEl.textContent = current ? `Up to date (${current})` : 'Up to date';
                }
            } catch (error) {
                console.error('Manual update check failed:', error);
                statusEl.textContent = 'Check failed';
                showNotification(`Update check failed: ${error.message}`, 'error');
            } finally {
                checkBtn.disabled = false;
            }
        });
    }

    async setupAboutSection() {
        const versionEl = document.getElementById('app-version');
        const osEl = document.getElementById('os-info');
        const archEl = document.getElementById('arch-info');
        const sourceBtn = document.getElementById('about-source-btn');
        const issuesBtn = document.getElementById('about-issues-btn');
        const releasesBtn = document.getElementById('about-releases-btn');

        try {
            const versionInfo = await window.go.main.App.GetVersionInfo();
            if (versionEl && versionInfo?.version) versionEl.textContent = versionInfo.version;
            if (osEl && versionInfo?.platform) osEl.textContent = this.getOSDisplayName(versionInfo.platform);
            if (archEl && versionInfo?.arch) archEl.textContent = versionInfo.arch;
        } catch (error) {
            console.warn('Failed to load version info for About:', error);
        }

        if (sourceBtn) sourceBtn.addEventListener('click', () => BrowserOpenURL(REPO_URL));
        if (issuesBtn) issuesBtn.addEventListener('click', () => BrowserOpenURL(ISSUES_URL));
        if (releasesBtn) releasesBtn.addEventListener('click', () => BrowserOpenURL(RELEASES_URL));
    }

    async setupTerminalBehaviorSettings() {
        const bellToggle = document.getElementById('terminal-bell-toggle');
        const wordSepInput = document.getElementById('terminal-word-separators-input');
        const confirmCloseToggle = document.getElementById('confirm-close-active-toggle');
        const restoreTabsToggle = document.getElementById('restore-tabs-toggle');

        if (!bellToggle && !wordSepInput && !confirmCloseToggle && !restoreTabsToggle) {
            return;
        }

        try {
            if (bellToggle) bellToggle.checked = !!(await window.go.main.App.ConfigGet('TerminalBellSound'));
            if (wordSepInput) wordSepInput.value = (await window.go.main.App.ConfigGet('TerminalWordSeparators')) || '';
            if (confirmCloseToggle) confirmCloseToggle.checked = !!(await window.go.main.App.ConfigGet('ConfirmCloseActiveSessions'));
            if (restoreTabsToggle) restoreTabsToggle.checked = !!(await window.go.main.App.ConfigGet('RestoreTabsOnLaunch'));
        } catch (error) {
            console.warn('Failed to load terminal behavior settings:', error);
        }

        if (bellToggle) {
            bellToggle.addEventListener('change', async (event) => {
                try {
                    await window.go.main.App.ConfigSet('TerminalBellSound', event.target.checked);
                } catch (error) {
                    console.error('Error updating bell setting:', error);
                    event.target.checked = !event.target.checked;
                }
            });
        }

        if (wordSepInput) {
            let timeout;
            wordSepInput.addEventListener('input', (event) => {
                clearTimeout(timeout);
                timeout = setTimeout(async () => {
                    try {
                        await window.go.main.App.ConfigSet('TerminalWordSeparators', event.target.value);
                    } catch (error) {
                        console.error('Error updating word separators:', error);
                        showNotification(`Failed to update word separators: ${error.message}`, 'error');
                    }
                }, 800);
            });
        }

        if (confirmCloseToggle) {
            confirmCloseToggle.addEventListener('change', async (event) => {
                try {
                    await window.go.main.App.ConfigSet('ConfirmCloseActiveSessions', event.target.checked);
                } catch (error) {
                    console.error('Error updating confirm-close setting:', error);
                    event.target.checked = !event.target.checked;
                }
            });
        }

        if (restoreTabsToggle) {
            restoreTabsToggle.addEventListener('change', async (event) => {
                try {
                    await window.go.main.App.ConfigSet('RestoreTabsOnLaunch', event.target.checked);
                    showNotification(`Tab restore ${event.target.checked ? 'enabled' : 'disabled'} (applies on next launch)`, 'info');
                } catch (error) {
                    console.error('Error updating restore-tabs setting:', error);
                    event.target.checked = !event.target.checked;
                }
            });
        }
    }

    async setupScrollSensitivitySettings() {
        const scrollInput = document.getElementById('terminal-scroll-sensitivity-input');
        const fastScrollInput = document.getElementById('terminal-fast-scroll-sensitivity-input');
        if (!scrollInput && !fastScrollInput) return;

        try {
            if (scrollInput) scrollInput.value = await window.go.main.App.ConfigGet('TerminalScrollSensitivity');
            if (fastScrollInput) fastScrollInput.value = await window.go.main.App.ConfigGet('TerminalFastScrollSensitivity');
        } catch (error) {
            console.warn('Failed to load scroll sensitivity:', error);
        }

        const debouncedSet = (key, min, max, label) => {
            let t;
            return (event) => {
                clearTimeout(t);
                t = setTimeout(async () => {
                    const val = parseInt(event.target.value, 10);
                    if (isNaN(val) || val < min || val > max) {
                        showNotification(`${label} must be between ${min} and ${max}`, 'error');
                        return;
                    }
                    try {
                        await window.go.main.App.ConfigSet(key, val);
                    } catch (error) {
                        console.error(`Error updating ${key}:`, error);
                        showNotification(`Failed to update ${label}: ${error.message}`, 'error');
                    }
                }, 600);
            };
        };

        if (scrollInput) scrollInput.addEventListener('input', debouncedSet('TerminalScrollSensitivity', 1, 50, 'Scroll sensitivity'));
        if (fastScrollInput) fastScrollInput.addEventListener('input', debouncedSet('TerminalFastScrollSensitivity', 1, 100, 'Fast scroll sensitivity'));
    }

    async setupWindowSettings() {
        const alwaysOnTopToggle = document.getElementById('always-on-top-toggle');
        if (!alwaysOnTopToggle) return;

        try {
            alwaysOnTopToggle.checked = !!(await window.go.main.App.ConfigGet('AlwaysOnTop'));
        } catch (error) {
            console.warn('Failed to load AlwaysOnTop:', error);
        }

        alwaysOnTopToggle.addEventListener('change', async (event) => {
            try {
                await window.go.main.App.ConfigSet('AlwaysOnTop', event.target.checked);
                showNotification(`Always on Top ${event.target.checked ? 'enabled' : 'disabled'}`, 'info');
            } catch (error) {
                console.error('Error updating AlwaysOnTop:', error);
                showNotification(`Failed: ${error.message}`, 'error');
                event.target.checked = !event.target.checked;
            }
        });
    }

    async setupSSHDefaultsSettings() {
        const timeoutInput = document.getElementById('ssh-timeout-input');
        const keepaliveInput = document.getElementById('ssh-keepalive-input');
        if (!timeoutInput && !keepaliveInput) return;

        try {
            if (timeoutInput) timeoutInput.value = await window.go.main.App.ConfigGet('SSHConnectionTimeout');
            if (keepaliveInput) keepaliveInput.value = await window.go.main.App.ConfigGet('SSHKeepAliveInterval');
        } catch (error) {
            console.warn('Failed to load SSH defaults:', error);
        }

        const debouncedSet = (key, min, max, label) => {
            let t;
            return (event) => {
                clearTimeout(t);
                t = setTimeout(async () => {
                    const val = parseInt(event.target.value, 10);
                    if (isNaN(val) || val < min || val > max) {
                        showNotification(`${label} must be between ${min} and ${max}`, 'error');
                        return;
                    }
                    try {
                        await window.go.main.App.ConfigSet(key, val);
                    } catch (error) {
                        console.error(`Error updating ${key}:`, error);
                        showNotification(`Failed to update ${label}: ${error.message}`, 'error');
                    }
                }, 700);
            };
        };

        if (timeoutInput) timeoutInput.addEventListener('input', debouncedSet('SSHConnectionTimeout', 1, 300, 'SSH timeout'));
        if (keepaliveInput) keepaliveInput.addEventListener('input', debouncedSet('SSHKeepAliveInterval', 0, 600, 'Keep-alive interval'));
    }

}