// HTML template functions for UI components

export function createHeaderTemplate() {
    // Return empty since we're removing the header
    return '';
}

export function createTabsTemplate() {
    // Detect platform for correct button order
    const userAgent = navigator.userAgent.toLowerCase();
    const isMacOS = userAgent.includes('mac');
    const isLinux = userAgent.includes('linux');
    const useNativeControls = isMacOS || isLinux;

    // Define button order based on platform - no controls for macOS/Linux since they use native ones
    const windowControlsHTML = useNativeControls ? '' : `
        <!-- Windows/Linux order: minimize, maximize, close -->
        <button class="window-control window-minimize" id="window-minimize" title="Minimize">
            <span class="window-control-icon">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M0,5 L10,5 L10,6 L0,6 Z"/>
                </svg>
            </span>
        </button>
        <button class="window-control window-maximize" id="window-maximize" title="Maximize">
            <span class="window-control-icon">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M0,0 L0,10 L10,10 L10,0 Z M1,1 L9,1 L9,9 L1,9 Z"/>
                </svg>
            </span>
        </button>
        <button class="window-control window-close" id="window-close" title="Close">
            <span class="window-control-icon">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M0.7,0 L5,4.3 L9.3,0 L10,0.7 L5.7,5 L10,9.3 L9.3,10 L5,5.7 L0.7,10 L0,9.3 L4.3,5 L0,0.7 Z"/>
                </svg>
            </span>
        </button>
    `;

    return `
        <div class="tabs-titlebar">
            <div class="titlebar-content">
                ${useNativeControls ? `
                    <div class="window-title">Thermic</div>
                    <div class="titlebar-spacer"></div>
                ` : `
                    <div class="window-title">Thermic</div>
                    <div class="titlebar-spacer"></div>
                    <div class="window-controls-right">
                        ${windowControlsHTML}
                    </div>
                `}
            </div>
        </div>
        <div class="tabs-bar">
            <div class="tabs-list" id="tabs-list">
                <!-- Tabs and new tab buttons will be inserted here dynamically -->
            </div>
        </div>
    `;
}

export function createActivityBarTemplate() {
    return `
        <div class="activity-bar-buttons">
            <button class="activity-btn active" id="activity-profiles" title="Profiles" data-view="profiles">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 16a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z"/>
                </svg>
            </button>
            <button class="activity-btn" id="activity-files" title="Files" data-view="files">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                </svg>
            </button>
        </div>
        <div class="activity-bar-bottom">
            <button class="activity-btn" id="theme-toggle" title="Toggle theme">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="theme-toggle-icon">
                    <path d="M21.64 13a1 1 0 0 0-1.05-.14a8.05 8.05 0 0 1-3.37.73a8.15 8.15 0 0 1-8.14-8.1a8.59 8.59 0 0 1 .25-2A1 1 0 0 0 8 2.36a10.14 10.14 0 1 0 14 11.69a1 1 0 0 0-.36-1.05Zm-9.5 6.69A8.14 8.14 0 0 1 7.08 5.22v.27a10.15 10.15 0 0 0 10.14 10.14a9.79 9.79 0 0 0 2.1-.22a8.11 8.11 0 0 1-7.18 4.32Z"/>
                </svg>
            </button>
            <button class="activity-btn" id="account-btn" title="Account">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z"/>
                </svg>
            </button>
            <button class="activity-btn" id="settings-btn" title="Settings">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/>
                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
            </button>
        </div>
    `;
}

export function createSidebarTemplate() {
    return `
        <div class="sidebar-header">
            <span id="sidebar-title">Profiles</span>
            <div class="sidebar-actions">
                <button class="sidebar-action-btn" id="sidebar-collapse" title="Collapse Sidebar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="sidebar-content" id="sidebar-content">
            <!-- Content will be dynamically populated by SidebarManager -->
            <div class="loading-placeholder" style="padding: 20px; text-align: center; color: var(--text-tertiary);">
                <div><img src="./icons/folder.svg" class="svg-icon" alt="📁"></div>
                <div style="margin-top: 8px;">Loading profiles...</div>
            </div>
        </div>
    `;
}

export function createStatusBarTemplate() {
    return `
        <div class="status-left">
            <span id="status-info">Ready</span>
            <span id="selected-shell">PowerShell</span>
        </div>
        <div class="status-right">
            <button id="ui-scale-indicator" class="ui-scale-indicator" type="button" title="Reset zoom to 100%" hidden>
                <span class="ui-scale-value">100%</span>
            </button>
            <div class="status-monitoring" id="status-monitoring">
                <span id="platform-info">Loading...</span>
                <span data-stat="system" data-metrics="cpu,memory,load,disk,uptime" title="System Resources - Hover for detailed graphs">CPU: 0% RAM: 0Mb L: 0.0</span>
                <span data-stat="disk-io">DIS: ↓0 MB/s ↑0 MB/s</span>
                <span data-stat="network">NET: ↓0 MB/s ↑0 MB/s</span>
            </div>
            <div class="status-version" id="status-version">
                <!-- Version/upgrade button will be added here by VersionManager -->
            </div>
        </div>
    `;
}

export function createSettingsPanelTemplate() {
    return `
        <div class="settings-panel">
            <div class="settings-panel-header">
                <div class="settings-tabs-container">
                    <button class="settings-tab active" data-tab-target="#settings-tab-terminal"><img src="./icons/terminal.svg" class="svg-icon" alt="🖥️"> Terminal</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-appearance"><img src="./icons/palette.svg" class="svg-icon" alt="🎨"> Appearance</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-profiles"><img src="./icons/folder.svg" class="svg-icon" alt="📁"> Profiles</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-advanced"><img src="./icons/settings.svg" class="svg-icon" alt="⚙️"> Advanced</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-hotkeys"><img src="./icons/keyboard.svg" class="svg-icon" alt="⌨️"> Hotkeys</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-ai"><img src="./icons/ai.svg" class="svg-icon" alt="🤖"> AI</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-about"><img src="./icons/info.svg" class="svg-icon" alt="ℹ️"> About</button>
                </div>
            </div>
            <div class="settings-panel-content">
                <div class="settings-tab-pane active" id="settings-tab-terminal">
                    ${createTerminalSettingsContent()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-appearance">
                    ${createAppearanceSettingsContent()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-profiles">
                    ${createProfilesSettingsContent()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-advanced">
                    ${createAdvancedSettingsContent()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-hotkeys">
                    ${createHotkeysSettingsContent()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-ai">
                    ${createAISettingsContent()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-about">
                    ${createAboutSettingsContent()}
                </div>
            </div>
        </div>
    `;
}

export function createTerminalSettingsContent() {
    return `
        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/terminal.svg" class="svg-icon" alt="🖥️"></span>
                Shell Configuration
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Default Shell</div>
                            <div class="setting-item-description">Choose the default shell for new terminal sessions</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" id="shell-selector">
                                <option value="">Loading shells...</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/keyboard.svg" class="svg-icon" alt="⌨️"></span>
                Terminal Behavior
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Select to Copy</div>
                            <div class="setting-item-description">Automatically copy selected text to clipboard, and paste on right-click</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="select-to-copy-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Audible Bell</div>
                            <div class="setting-item-description">Play a sound when the terminal sends a BEL character</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="terminal-bell-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Word Separators</div>
                            <div class="setting-item-description">Characters that delimit words on double-click selection</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="text" id="terminal-word-separators-input" class="modern-input"
                                autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Confirm on Close</div>
                            <div class="setting-item-description">Prompt before closing tabs or window with running sessions</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="confirm-close-active-toggle" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Restore Tabs on Launch</div>
                            <div class="setting-item-description">Reopen previously open tabs when the app starts</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="restore-tabs-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/document.svg" class="svg-icon" alt="📜"></span>
                Scrolling
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Scrollback Lines</div>
                            <div class="setting-item-description">Number of lines to keep in scrollback buffer (100-100,000)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="scrollback-lines-input" class="modern-input" value="10000" min="100" max="100000">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Scroll Sensitivity</div>
                            <div class="setting-item-description">Lines per scroll tick (1-50)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="terminal-scroll-sensitivity-input" class="modern-input" value="1" min="1" max="50">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Fast Scroll Sensitivity</div>
                            <div class="setting-item-description">Lines per scroll tick when Alt is held (1-100)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="terminal-fast-scroll-sensitivity-input" class="modern-input" value="5" min="1" max="100">
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/link.svg" class="svg-icon" alt="🔗"></span>
                Links & URLs
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Click to Open URLs</div>
                            <div class="setting-item-description">Open URLs in default browser when clicked</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="open-links-external-toggle" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/files.svg" class="svg-icon" alt="📁"></span>
                SFTP Transfer Performance
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Parallel Transfers</div>
                            <div class="setting-item-description">Number of simultaneous file transfers (1-16)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="sftp-parallel-transfers-input" class="modern-input" value="2" min="1" max="16">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Max Packet Size (KB)</div>
                            <div class="setting-item-description">Larger packets improve speed over fast connections (32-512)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="sftp-max-packet-input" class="modern-input" value="64" min="32" max="512">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Buffer Size (KB)</div>
                            <div class="setting-item-description">Transfer buffer size - larger buffers improve throughput (64-16384)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="sftp-buffer-size-input" class="modern-input" value="256" min="64" max="16384">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Concurrent I/O</div>
                            <div class="setting-item-description">Enable concurrent reads/writes per file for high-latency connections</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="sftp-concurrent-io-toggle" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createAppearanceSettingsContent() {
    return `
        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/palette.svg" class="svg-icon" alt="🎨"></span>
                Theme
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Theme</div>
                            <div class="setting-item-description">Dark, Light, or follow the system setting</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" id="theme-mode-select">
                                <option value="dark">Dark</option>
                                <option value="light">Light</option>
                                <option value="system">System</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/text.svg" class="svg-icon" alt="🔤"></span>
                Terminal Typography
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Font Family</div>
                            <div class="setting-item-description">Monospace font stack for terminal text. Falls back through the list if a font is not installed.</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="text" id="terminal-font-family-input" class="modern-input" placeholder='Consolas, Monaco, "Lucida Console", monospace'
                                autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Font Size</div>
                            <div class="setting-item-description">Terminal text size in pixels (8-32)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="terminal-font-size-input" class="modern-input" value="14" min="8" max="32">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Line Height</div>
                            <div class="setting-item-description">Line spacing multiplier (0.8-2.0)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="terminal-line-height-input" class="modern-input" value="1.0" min="0.8" max="2.0" step="0.1">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Cursor Style</div>
                            <div class="setting-item-description">Shape of the terminal cursor</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" id="terminal-cursor-style-select">
                                <option value="block">Block</option>
                                <option value="bar">Bar</option>
                                <option value="underline">Underline</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Cursor Blink</div>
                            <div class="setting-item-description">Make the terminal cursor blink</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="terminal-cursor-blink-toggle" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/ruler.svg" class="svg-icon" alt="📐"></span>
                Interface
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Interface Zoom</div>
                            <div class="setting-item-description">Scale the entire UI. Shortcuts: Ctrl/Cmd +, Ctrl/Cmd -, Ctrl/Cmd 0 to reset.</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="ui-scale-input" class="modern-input" value="100" min="50" max="300" step="10">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createProfilesSettingsContent() {
    return `
        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/folder.svg" class="svg-icon" alt="📁"></span>
                Profiles Configuration
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Profiles Directory</div>
                            <div class="setting-item-description">Custom location for storing profile files</div>
                        </div>
                        <div class="setting-item-control">
                            <div class="profiles-path-container">
                                <input type="text" class="modern-input" id="profiles-path-input" placeholder="Default location will be used"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                                <button class="modern-button secondary" id="browse-profiles-path"><img src="./icons/folder-open.svg" class="svg-icon" alt="📂"> Browse</button>
                                <button class="modern-button" id="save-profiles-path">Save</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createAdvancedSettingsContent() {
    return `
        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/laptop.svg" class="svg-icon" alt="💻"></span>
                Window
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Always on Top</div>
                            <div class="setting-item-description">Keep Thermic above other windows</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="always-on-top-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/lock.svg" class="svg-icon" alt="🔒"></span>
                SSH Defaults
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Connection Timeout</div>
                            <div class="setting-item-description">Initial connect timeout in seconds (1-300)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="ssh-timeout-input" class="modern-input" value="10" min="1" max="300">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Keep-Alive Interval</div>
                            <div class="setting-item-description">Server heartbeat in seconds (0 = disabled, max 600)</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="ssh-keepalive-input" class="modern-input" value="30" min="0" max="600">
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/refresh.svg" class="svg-icon" alt="🔄"></span>
                Updates
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Automatic Update Checks</div>
                            <div class="setting-item-description">Periodically check GitHub for new releases in the background</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="auto-check-updates-toggle" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Check for Updates</div>
                            <div class="setting-item-description">Manually check for an available update now</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" id="check-updates-now-btn">Check Now</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Update Status</div>
                            <div class="setting-item-description">Result of the most recent check</div>
                        </div>
                        <div class="setting-item-control">
                            <span class="setting-info" id="update-status">Not checked yet</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createHotkeysSettingsContent() {
    return `
        <div class="settings-section" id="hotkeys-settings-root">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/keyboard.svg" class="svg-icon" alt="⌨️"></span>
                Keyboard Shortcuts
            </div>
            <div class="hotkeys-toolbar">
                <span class="hotkeys-help">Click a binding and press the new key combination. Conflicts are highlighted.</span>
                <button class="modern-button secondary" id="hotkeys-reset-all-btn">Reset All to Defaults</button>
            </div>
            <div class="hotkeys-list" id="hotkeys-list">
                <div class="hotkeys-loading">Loading shortcuts…</div>
            </div>
        </div>
    `;
}

export function createAISettingsContent() {
    return `
        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./assets/icons/ai.svg" class="svg-icon" alt="🤖"></span>
                AI Assistant Configuration
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Enable AI Assistant</div>
                            <div class="setting-item-description">Enable AI-powered assistance in terminal</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="ai-enabled-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">AI Provider</div>
                            <div class="setting-item-description">Choose your AI service provider</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" id="ai-provider-select">
                                <option value="openai">OpenAI</option>
                                <option value="gemini" disabled>Google Gemini (Coming Soon)</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">API URL</div>
                            <div class="setting-item-description">API endpoint URL for your provider</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="url" id="ai-api-url-input" class="modern-input" placeholder="https://api.openai.com/v1">
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Model ID</div>
                            <div class="setting-item-description">AI model to use for responses</div>
                        </div>
                        <div class="setting-item-control">
                            <div class="input-with-suggestion">
                                <input type="text" id="ai-model-input" class="modern-input" placeholder="Enter model ID (e.g. gpt-4o-mini)"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                                <div class="model-suggestions" id="ai-model-suggestions">
                                    <div class="suggestion-item" data-model="gpt-4o-mini">gpt-4o-mini (recommended)</div>
                                    <div class="suggestion-item" data-model="gpt-4o">gpt-4o</div>
                                    <div class="suggestion-item" data-model="gpt-4-turbo">gpt-4-turbo</div>
                                    <div class="suggestion-item" data-model="gpt-3.5-turbo">gpt-3.5-turbo</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">API Key</div>
                            <div class="setting-item-description">Your API key for the selected provider</div>
                        </div>
                        <div class="setting-item-control">
                            <div class="api-key-input-container">
                                <input type="password" id="ai-api-key-input" class="modern-input api-key-input" placeholder="Enter your API key">
                                <button type="button" class="api-key-toggle-btn" id="ai-api-key-toggle" title="Show/Hide API Key">
                                    Show
                                </button>
                                <div class="api-key-status" id="ai-api-key-status">
                                    <img src="./assets/icons/warning.svg" class="svg-icon small" alt="⚠️">
                                    <span>Not configured</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./assets/icons/globe.svg" class="svg-icon" alt="🌐"></span>
                Connection & Testing
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Test Connection</div>
                            <div class="setting-item-description">Verify your AI provider configuration</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button primary test-connection-btn" id="ai-test-connection-btn">
                                <img src="./assets/icons/globe.svg" class="svg-icon" alt="🌐">
                                <span>Test Connection</span>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Connection Status</div>
                            <div class="setting-item-description">Current status of AI service connection</div>
                        </div>
                        <div class="setting-item-control">
                            <div class="connection-status-display">
                                <span class="setting-status" id="ai-connection-status">
                                    <img src="./assets/icons/circle.svg" class="svg-icon small status-indicator" alt="●">
                                    <span>Not tested</span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createAboutSettingsContent() {
    return `
        <div class="about-header">
            <div class="app-icon"><img src="./icons/fire.svg" class="svg-icon" alt="🔥"></div>
            <h2 class="app-title">Thermic Terminal</h2>
            <p class="app-subtitle">Modern terminal emulator with advanced features</p>
            <div class="app-version">
                <strong>Version:</strong> <span id="app-version">1.0.0</span>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/info.svg" class="svg-icon" alt="ℹ️"></span>
                Project
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Source Code</div>
                            <div class="setting-item-description">github.com/yzhelezko/thermic</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" id="about-source-btn">Open</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Report Issues</div>
                            <div class="setting-item-description">Report bugs or request features on GitHub</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" id="about-issues-btn">Open</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Releases</div>
                            <div class="setting-item-description">Browse all release notes and downloads</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" id="about-releases-btn">Open</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/laptop.svg" class="svg-icon" alt="💻"></span>
                System Information
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Operating System</div>
                            <div class="setting-item-description">Current OS and version</div>
                        </div>
                        <div class="setting-item-control">
                            <span class="setting-info" id="os-info">Loading...</span>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Architecture</div>
                            <div class="setting-item-description">System architecture</div>
                        </div>
                        <div class="setting-item-control">
                            <span class="setting-info" id="arch-info">Loading...</span>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Runtime</div>
                            <div class="setting-item-description">Application runtime environment</div>
                        </div>
                        <div class="setting-item-control">
                            <span class="setting-info">Wails v2 + Go</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/heart.svg" class="svg-icon" alt="🙏"></span>
                Acknowledgments
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Built with</div>
                            <div class="setting-item-description">Wails v2, Go, Xterm.js, Modern CSS</div>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Special thanks</div>
                            <div class="setting-item-description">The Wails community, Xterm.js contributors, beta testers</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Context Menu Templates
export function createTerminalContextMenuTemplate() {
    return `
        <div class="context-menu" id="terminal-context-menu">
            <div class="context-menu-item" data-action="copy">
                <span class="context-menu-item-icon"><img src="./icons/clipboard.svg" class="svg-icon" alt="📋"></span>
                <span>Copy</span>
                <span class="context-menu-shortcut">Ctrl+C</span>
            </div>
            <div class="context-menu-item" data-action="paste">
                <span class="context-menu-item-icon"><img src="./icons/page.svg" class="svg-icon" alt="📄"></span>
                <span>Paste</span>
                <span class="context-menu-shortcut">Ctrl+V</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="select-all">
                <span class="context-menu-item-icon"><img src="./icons/text.svg" class="svg-icon" alt="🔤"></span>
                <span>Select All</span>
                <span class="context-menu-shortcut">Ctrl+A</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="clear">
                <span class="context-menu-item-icon"><img src="./icons/trash.svg" class="svg-icon" alt="🗑️"></span>
                <span>Clear Terminal</span>
                <span class="context-menu-shortcut">Ctrl+L</span>
            </div>
            <div class="context-menu-item" data-action="scroll-to-top">
                <span class="context-menu-item-icon"><img src="./icons/arrow-up.svg" class="svg-icon" alt="⬆️"></span>
                <span>Scroll to Top</span>
                <span class="context-menu-shortcut">Ctrl+Home</span>
            </div>
            <div class="context-menu-item" data-action="scroll-to-bottom">
                <span class="context-menu-item-icon"><img src="./icons/arrow-down.svg" class="svg-icon" alt="⬇️"></span>
                <span>Scroll to Bottom</span>
                <span class="context-menu-shortcut">Ctrl+End</span>
            </div>
        </div>
    `;
}

export function createSidebarContextMenuTemplate() {
    return `
        <div class="context-menu" id="sidebar-context-menu">
            <div class="context-menu-item" data-action="connect">
                <span class="context-menu-item-icon"><img src="./icons/link.svg" class="svg-icon" alt="🔗"></span>
                <span>Connect</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item context-menu-create-section" data-action="create-profile">
                <span class="context-menu-item-icon"><img src="./icons/plus.svg" class="svg-icon" alt="➕"></span>
                <span>Create Profile</span>
            </div>
            <div class="context-menu-item context-menu-create-section" data-action="create-folder">
                <span class="context-menu-item-icon"><img src="./icons/folder.svg" class="svg-icon" alt="📁"></span>
                <span>Create Folder</span>
            </div>
            <div class="context-menu-separator context-menu-create-separator"></div>
            <div class="context-menu-item" data-action="search">
                <span class="context-menu-item-icon"><img src="./icons/search.svg" class="svg-icon" alt="🔍"></span>
                <span>Search Profiles</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="edit">
                <span class="context-menu-item-icon"><img src="./icons/edit.svg" class="svg-icon" alt="✏️"></span>
                <span>Edit</span>
            </div>
            <div class="context-menu-item" data-action="duplicate">
                <span class="context-menu-item-icon"><img src="./icons/copy.svg" class="svg-icon" alt="📑"></span>
                <span>Duplicate</span>
            </div>
            <div class="context-menu-item" data-action="rename">
                <span class="context-menu-item-icon"><img src="./icons/rename.svg" class="svg-icon" alt="📝"></span>
                <span>Rename</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="delete">
                <span class="context-menu-item-icon"><img src="./icons/trash.svg" class="svg-icon" alt="🗑️"></span>
                <span>Delete</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="properties">
                <span class="context-menu-item-icon"><img src="./icons/info.svg" class="svg-icon" alt="ℹ️"></span>
                <span>Properties</span>
            </div>
        </div>
    `;
}

export function createTabContextMenuTemplate() {
    return `
        <div class="context-menu" id="tab-context-menu">
            <div class="context-menu-item" data-action="tab-reconnect">
                <span class="context-menu-item-icon"><img src="./icons/refresh.svg" class="svg-icon" alt="🔄"></span>
                <span>Reconnect</span>
            </div>
            <div class="context-menu-item" data-action="tab-force-disconnect">
                <span class="context-menu-item-icon"><img src="./icons/error.svg" class="svg-icon" alt="❌"></span>
                <span>Force Disconnect</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="tab-duplicate">
                <span class="context-menu-item-icon"><img src="./icons/copy.svg" class="svg-icon" alt="📑"></span>
                <span>Duplicate Tab</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="tab-close">
                <span class="context-menu-item-icon"><img src="./icons/error.svg" class="svg-icon" alt="❌"></span>
                <span>Close Tab</span>
            </div>
            <div class="context-menu-item" data-action="tab-close-others">
                <span class="context-menu-item-icon"><img src="./icons/files.svg" class="svg-icon" alt="🗂️"></span>
                <span>Close Other Tabs</span>
            </div>
        </div>
    `;
}

// Profile Panel Templates
export function createProfilePanelTemplate() {
    return `
        <div class="profile-panel-overlay" id="profile-panel-overlay">
            <div class="profile-panel">
                <div class="profile-panel-header">
                    <div class="profile-panel-title" id="profile-panel-title">Profile</div>
                    <button class="profile-panel-close" id="profile-panel-close">×</button>
                </div>
                <div class="profile-panel-content">
                    <div class="profile-form" id="profile-form">
                        <!-- Form content will be dynamically generated -->
                    </div>
                </div>
                <div class="profile-panel-footer">
                    <button class="btn btn-secondary" id="profile-cancel">Cancel</button>
                    <button class="btn btn-primary" id="profile-save">Save</button>
                </div>
            </div>
        </div>
    `;
}

export function createProfileFormTemplate(mode, type, data = null) {
    const isEdit = mode === 'edit';
    const isFolder = type === 'folder';
    
    if (isFolder) {
        return `
            <div class="profile-form-section">
                <div class="profile-form-section-title">
                    <span class="profile-form-section-icon"><img src="./icons/folder.svg" class="svg-icon" alt="📁"></span>
                    Folder Information
                </div>
                <div class="form-group">
                    <label for="folder-name">Folder Name</label>
                    <div class="name-icon-container">
                        <input type="text" id="folder-name" class="form-input" value="${data?.name || ''}" placeholder="Enter folder name" required
                    autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                        <div class="icon-selector-compact">
                            <button type="button" class="icon-selector-button" id="folder-icon-btn">
                                <span class="current-icon" id="folder-current-icon">${data?.icon || '📁'}</span>
                                <span class="icon-selector-arrow">▼</span>
                            </button>
                            <div class="icon-dropdown" id="folder-icon-dropdown">
                                <div class="icon-grid-compact">
                                    <span class="icon-option" data-icon="📁">📁</span>
                                    <span class="icon-option" data-icon="📂">📂</span>
                                    <span class="icon-option" data-icon="🗂️">🗂️</span>
                                    <span class="icon-option" data-icon="📋">📋</span>
                                    <span class="icon-option" data-icon="🛠️">🛠️</span>
                                    <span class="icon-option" data-icon="🌐">🌐</span>
                                    <span class="icon-option" data-icon="🔧">🔧</span>
                                    <span class="icon-option" data-icon="⚙️">⚙️</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <input type="hidden" id="folder-icon" value="${data?.icon || '📁'}">
                </div>
            </div>
        `;
    } else {
        return `
            <div class="profile-form-section">
                <div class="profile-form-section-title">
                    <span class="profile-form-section-icon"><img src="./icons/info.svg" class="svg-icon" alt="ℹ️"></span>
                    Basic Information
                </div>
                <div class="form-group">
                    <label for="profile-name">Profile Name</label>
                    <div class="name-icon-container">
                        <input type="text" id="profile-name" class="form-input" value="${data?.name || ''}" placeholder="Enter profile name" required
                    autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                        <div class="icon-selector-compact">
                            <button type="button" class="icon-selector-button" id="profile-icon-btn">
                                <span class="current-icon" id="profile-current-icon">${data?.icon || '💻'}</span>
                                <span class="icon-selector-arrow">▼</span>
                            </button>
                            <div class="icon-dropdown" id="profile-icon-dropdown">
                                <div class="icon-grid-compact">
                                    <span class="icon-option" data-icon="💻">💻</span>
                                    <span class="icon-option" data-icon="🔷">🔷</span>
                                    <span class="icon-option" data-icon="⚫">⚫</span>
                                    <span class="icon-option" data-icon="🐧">🐧</span>
                                    <span class="icon-option" data-icon="🌐">🌐</span>
                                    <span class="icon-option" data-icon="🐳">🐳</span>
                                    <span class="icon-option" data-icon="⚡">⚡</span>
                                    <span class="icon-option" data-icon="🚀">🚀</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <input type="hidden" id="profile-icon" value="${data?.icon || '💻'}">
                </div>
            </div>

            <div class="profile-form-section">
                <div class="profile-form-section-title">
                    <span class="profile-form-section-icon"><img src="./icons/link.svg" class="svg-icon" alt="🔗"></span>
                    Connection Settings
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Profile Type</div>
                            <div class="setting-item-description">Choose the connection type for this profile</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" id="profile-type">
                               <option value="local"${data?.type === 'local' || !data?.type ? ' selected' : ''}>Local Shell</option>
                               <option value="ssh"${data?.type === 'ssh' ? ' selected' : ''}>SSH Connection</option>
                               <option value="custom"${data?.type === 'custom' ? ' selected' : ''}>Custom Command</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="form-group local-shell-group" style="display: ${data?.type === 'local' || !data?.type ? 'block' : 'none'}">
                    <label for="profile-shell">Shell Command</label>
                    <select id="profile-shell" class="form-select">
                        <option value="">Loading shells...</option>
                    </select>
                </div>
                <div class="form-group custom-group" style="display: ${data?.type === 'custom' ? 'block' : 'none'}">
                    <label for="custom-command">Custom Command</label>
                                            <input type="text" id="custom-command" class="form-input" value="${data?.shell || ''}" placeholder="Enter custom command"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                </div>
                <div class="form-group">
                    <label for="profile-workdir">Working Directory (optional)</label>
                                            <input type="text" id="profile-workdir" class="form-input" value="${data?.workingDir || ''}" placeholder="Enter working directory"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                </div>
            </div>

            <div class="profile-form-section ssh-group" style="display: ${data?.type === 'ssh' ? 'block' : 'none'}">
                <div class="profile-form-section-title">
                    <span class="profile-form-section-icon"><img src="./icons/lock.svg" class="svg-icon" alt="🔐"></span>
                    SSH Configuration
                </div>
                <div class="form-group">
                    <label for="ssh-host">SSH Host</label>
                                            <input type="text" id="ssh-host" class="form-input" value="${data?.sshConfig?.host || ''}" placeholder="hostname or IP address"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                </div>
                <div class="form-group">
                    <label for="ssh-port">SSH Port</label>
                    <input type="number" id="ssh-port" class="form-input" value="${data?.sshConfig?.port || 22}" placeholder="22">
                </div>
                <div class="form-group">
                    <label for="ssh-username">Username</label>
                                            <input type="text" id="ssh-username" class="form-input" value="${data?.sshConfig?.username || ''}" placeholder="username"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                </div>
                <div class="form-group">
                    <label for="ssh-password">Password (optional)</label>
                    <input type="password" id="ssh-password" class="form-input" value="${data?.sshConfig?.password || ''}" placeholder="password">
                </div>
                <div class="form-group">
                    <label for="ssh-keypath">Private Key Path (optional)</label>
                    <div class="ssh-key-path-container">
                        <input type="text" id="ssh-keypath" class="form-input" value="${data?.sshConfig?.keyPath || ''}" placeholder="/path/to/private/key"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                        <button type="button" class="modern-button secondary" id="browse-ssh-key"><img src="./icons/folder-open.svg" class="svg-icon" alt="📂"> Browse</button>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Auto-discover SSH keys</div>
                            <div class="setting-item-description">Automatically scan ~/.ssh directory for private keys when connecting</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="ssh-auto-discover" ${data?.sshConfig?.allowKeyAutoDiscovery ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <div class="profile-form-section">
                <div class="profile-form-section-title">
                    <span class="profile-form-section-icon"><img src="./icons/edit.svg" class="svg-icon" alt="📝"></span>
                    Details
                </div>
                <div class="form-group">
                    <label for="profile-description">Description (optional)</label>
                    <textarea id="profile-description" class="form-input" rows="2" placeholder="Notes about this profile"
                        autocomplete="off" spellcheck="false">${data?.description || ''}</textarea>
                </div>
                <div class="form-group">
                    <label for="profile-tags">Tags (comma separated, max 20)</label>
                    <input type="text" id="profile-tags" class="form-input" value="${(data?.tags || []).join(', ')}" placeholder="prod, db, eu-west"
                        autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                </div>
                <div class="form-group">
                    <label>Accent color</label>
                    <div class="color-swatches" id="profile-color-swatches" data-selected="${data?.color || ''}">
                        <button type="button" class="color-swatch ${!data?.color ? 'selected' : ''}" data-color="" title="None"><span class="color-swatch-none">∅</span></button>
                        <button type="button" class="color-swatch ${data?.color === '#ff6b35' ? 'selected' : ''}" data-color="#ff6b35" style="background:#ff6b35" title="Orange"></button>
                        <button type="button" class="color-swatch ${data?.color === '#4ec9b0' ? 'selected' : ''}" data-color="#4ec9b0" style="background:#4ec9b0" title="Teal"></button>
                        <button type="button" class="color-swatch ${data?.color === '#007acc' ? 'selected' : ''}" data-color="#007acc" style="background:#007acc" title="Blue"></button>
                        <button type="button" class="color-swatch ${data?.color === '#c586c0' ? 'selected' : ''}" data-color="#c586c0" style="background:#c586c0" title="Purple"></button>
                        <button type="button" class="color-swatch ${data?.color === '#ffcc02' ? 'selected' : ''}" data-color="#ffcc02" style="background:#ffcc02" title="Yellow"></button>
                        <button type="button" class="color-swatch ${data?.color === '#f44747' ? 'selected' : ''}" data-color="#f44747" style="background:#f44747" title="Red"></button>
                    </div>
                    <input type="hidden" id="profile-color" value="${data?.color || ''}">
                </div>
            </div>
        `;
    }
}

export function createFileExplorerContextMenuTemplate() {
    return `
        <div class="context-menu" id="file-explorer-context-menu">
            <!-- File/Directory specific actions -->
            <div class="context-menu-item" data-action="file-open">
                <span class="context-menu-item-icon"><img src="./icons/folder.svg" class="svg-icon" alt="📁"></span>
                <span>Open</span>
            </div>
            <div class="context-menu-item" data-action="file-preview">
                <span class="context-menu-item-icon"><img src="./icons/eye.svg" class="svg-icon" alt="👁️"></span>
                <span>Preview</span>
            </div>
            <div class="context-menu-separator"></div>
            
            <!-- Transfer actions -->
            <div class="context-menu-item" data-action="file-download">
                <span class="context-menu-item-icon"><img src="./icons/arrow-down.svg" class="svg-icon" alt="⬇️"></span>
                <span>Download</span>
            </div>
            <div class="context-menu-item" data-action="file-upload-here">
                <span class="context-menu-item-icon"><img src="./icons/arrow-up.svg" class="svg-icon" alt="⬆️"></span>
                <span>Upload Files Here</span>
            </div>
            <div class="context-menu-separator"></div>
            
            <!-- File management actions -->
            <div class="context-menu-item" data-action="file-rename">
                <span class="context-menu-item-icon"><img src="./icons/rename.svg" class="svg-icon" alt="📝"></span>
                <span>Rename</span>
            </div>
            <div class="context-menu-item" data-action="file-copy-path">
                <span class="context-menu-item-icon"><img src="./icons/clipboard.svg" class="svg-icon" alt="📋"></span>
                <span>Copy Path</span>
            </div>
            <div class="context-menu-separator"></div>
            
            <!-- Dangerous actions -->
            <div class="context-menu-item" data-action="file-delete">
                <span class="context-menu-item-icon"><img src="./icons/trash.svg" class="svg-icon" alt="🗑️"></span>
                <span>Delete</span>
            </div>
        </div>
        
        <div class="context-menu" id="file-explorer-directory-context-menu">
            <!-- Directory creation and upload -->
            <div class="context-menu-item" data-action="dir-new-folder">
                <span class="context-menu-item-icon"><img src="./icons/folder.svg" class="svg-icon" alt="📁"></span>
                <span>New Folder</span>
            </div>
            <div class="context-menu-item" data-action="dir-upload-files">
                <span class="context-menu-item-icon"><img src="./icons/arrow-up.svg" class="svg-icon" alt="⬆️"></span>
                <span>Upload Files</span>
            </div>
            <div class="context-menu-item" data-action="dir-upload-folder">
                <span class="context-menu-item-icon"><img src="./icons/arrow-up.svg" class="svg-icon" alt="⬆️"></span>
                <span>Upload Folder</span>
            </div>
            <div class="context-menu-separator"></div>
            
            <!-- Directory actions -->
            <div class="context-menu-item" data-action="dir-refresh">
                <span class="context-menu-item-icon"><img src="./icons/refresh.svg" class="svg-icon" alt="🔄"></span>
                <span>Refresh</span>
            </div>
            <div class="context-menu-item" data-action="dir-copy-path">
                <span class="context-menu-item-icon"><img src="./icons/clipboard.svg" class="svg-icon" alt="📋"></span>
                <span>Copy Current Path</span>
            </div>
            <div class="context-menu-separator"></div>
            
            <!-- Directory info -->
            <div class="context-menu-item" data-action="dir-properties">
                <span class="context-menu-item-icon"><img src="./icons/info.svg" class="svg-icon" alt="📊"></span>
                <span>Show Properties</span>
            </div>
        </div>
    `;
}