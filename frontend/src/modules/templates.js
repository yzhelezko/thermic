// HTML template functions for UI components

export function createHeaderTemplate() {
    // Return empty since we're removing the header
    return '';
}

export function createTabsTemplate() {
    // Detect platform for correct button order
    const userAgent = navigator.userAgent.toLowerCase();
    const isMacOS = userAgent.includes('mac');
    
    // Define button order based on platform - no controls for macOS since it uses native ones
    const windowControlsHTML = isMacOS ? '' : `
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
                ${isMacOS ? `
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
            <span>•</span>
            <span id="selected-shell">PowerShell</span>
        </div>
        <div class="status-right">
            <div class="status-monitoring" id="status-monitoring">
                <span id="platform-info">Loading...</span>
                <span class="separator">•</span>
                <span data-stat="cpu">CPU: 0%</span>
                <span class="separator">•</span>
                <span data-stat="memory">RAM: 0%</span>
                <span class="separator">•</span>
                <span data-stat="network">NET: ↓0 ↑0</span>
                <span class="separator" data-for="load">•</span>
                <span data-stat="load" style="display: none;">LOAD: 0.0</span>
                <span class="separator" data-for="uptime">•</span>
                <span data-stat="uptime" style="display: none;">UP: N/A</span>
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
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Shell Arguments</div>
                            <div class="setting-item-description">Additional arguments to pass to the shell</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="text" class="modern-input" placeholder="--login -i" disabled>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Environment Variables</div>
                            <div class="setting-item-description">Custom environment variables for terminal sessions</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>Configure</button>
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
                            <div class="setting-item-description">Automatically copy selected text to clipboard</div>
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
                            <div class="setting-item-title">Right Click Paste</div>
                            <div class="setting-item-description">Paste clipboard content on right-click</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Bell Sound</div>
                            <div class="setting-item-description">Play sound on terminal bell character</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Confirm on Exit</div>
                            <div class="setting-item-description">Show confirmation when closing terminal with running processes</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
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
                Scrollback & History
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Scrollback Lines</div>
                            <div class="setting-item-description">Number of lines to keep in scrollback buffer</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" id="scrollback-lines-input" class="modern-input" value="10000" min="100" max="100000">
                        </div>
                    </div>
                </div>

                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Save Session History</div>
                            <div class="setting-item-description">Persist command history between sessions</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
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
                            <div class="setting-item-title">Detect URLs</div>
                            <div class="setting-item-description">Automatically detect and highlight URLs</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Click to Open URLs</div>
                            <div class="setting-item-description">Open URLs in default browser when clicked</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">URL Modifier Key</div>
                            <div class="setting-item-description">Key to hold while clicking URLs</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" disabled>
                                <option>Ctrl</option>
                                <option>Alt</option>
                                <option>Shift</option>
                                <option>None</option>
                            </select>
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
                Theme & Colors
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Dark Mode</div>
                            <div class="setting-item-description">Use dark theme for the interface</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="dark-mode-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Accent Color</div>
                            <div class="setting-item-description">Primary accent color for UI elements</div>
                        </div>
                        <div class="setting-item-control">
                            <div class="color-picker-container">
                                <input type="color" class="modern-input" value="#007ACC" disabled>
                                <div class="color-indicator" style="background: #007ACC;"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Terminal Background</div>
                            <div class="setting-item-description">Background color for terminal area</div>
                        </div>
                        <div class="setting-item-control">
                            <div class="color-picker-container">
                                <input type="color" class="modern-input" value="#1E1E1E" disabled>
                                <div class="color-indicator" style="background: #1E1E1E;"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Terminal Text Color</div>
                            <div class="setting-item-description">Default text color in terminal</div>
                        </div>
                        <div class="setting-item-control">
                            <div class="color-picker-container">
                                <input type="color" class="modern-input" value="#FAFAFA" disabled>
                                <div class="color-indicator" style="background: #FAFAFA;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/text.svg" class="svg-icon" alt="🔤"></span>
                Typography
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Font Family</div>
                            <div class="setting-item-description">Monospace font for terminal text</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" disabled>
                                <option>Consolas</option>
                                <option>Monaco</option>
                                <option>Fira Code</option>
                                <option>JetBrains Mono</option>
                                <option>Source Code Pro</option>
                                <option>Cascadia Code</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Font Size</div>
                            <div class="setting-item-description">Size of terminal text in pixels</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" class="modern-input" value="14" min="8" max="32" disabled>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Line Height</div>
                            <div class="setting-item-description">Spacing between lines of text</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" class="modern-input" value="1.2" min="1.0" max="2.0" step="0.1" disabled>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Font Weight</div>
                            <div class="setting-item-description">Thickness of terminal text</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" disabled>
                                <option>Normal</option>
                                <option>Bold</option>
                                <option>Light</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/ruler.svg" class="svg-icon" alt="📐"></span>
                Layout & Spacing
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Sidebar Width</div>
                            <div class="setting-item-description">Width of the sidebar panel in pixels</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" class="modern-input" value="280" min="200" max="500" disabled>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Terminal Padding</div>
                            <div class="setting-item-description">Internal padding around terminal content</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" class="modern-input" value="8" min="0" max="32" disabled>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Tab Bar Height</div>
                            <div class="setting-item-description">Height of the tab bar in pixels</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" class="modern-input" value="40" min="30" max="60" disabled>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Status Bar</div>
                            <div class="setting-item-description">Show status bar at the bottom</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/sparkles.svg" class="svg-icon" alt="✨"></span>
                Visual Effects
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Smooth Animations</div>
                            <div class="setting-item-description">Enable smooth transitions and animations</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Cursor Blink</div>
                            <div class="setting-item-description">Make terminal cursor blink</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Window Transparency</div>
                            <div class="setting-item-description">Make window background semi-transparent</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Blur Background</div>
                            <div class="setting-item-description">Apply blur effect to transparent background</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
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

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/refresh.svg" class="svg-icon" alt="🔄"></span>
                Auto-Save & Backup
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Auto-Save Profiles</div>
                            <div class="setting-item-description">Automatically save profile changes</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Backup Profiles</div>
                            <div class="setting-item-description">Create backup copies of profile files</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Backup Interval</div>
                            <div class="setting-item-description">How often to create backups</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" disabled>
                                <option>Daily</option>
                                <option>Weekly</option>
                                <option>Monthly</option>
                                <option>Never</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/export.svg" class="svg-icon" alt="📤"></span>
                Import & Export
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Export All Profiles</div>
                            <div class="setting-item-description">Export all profiles to a backup file</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>Export</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Import Profiles</div>
                            <div class="setting-item-description">Import profiles from a backup file</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>Import</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Reset All Profiles</div>
                            <div class="setting-item-description">Delete all profiles and start fresh</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button" style="background: #dc3545;" disabled>Reset</button>
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
                <span class="settings-section-icon"><img src="./icons/wrench.svg" class="svg-icon" alt="🔧"></span>
                Performance
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Hardware Acceleration</div>
                            <div class="setting-item-description">Use GPU acceleration for rendering</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Memory Limit</div>
                            <div class="setting-item-description">Maximum memory usage in MB</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="number" class="modern-input" value="512" min="128" max="2048" disabled>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Process Monitoring</div>
                            <div class="setting-item-description">Monitor system processes and resources</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
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
                Security
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Store SSH Keys</div>
                            <div class="setting-item-description">Allow storing SSH private keys in profiles</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Store Passwords</div>
                            <div class="setting-item-description">Allow storing passwords in profiles</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Encrypt Profile Data</div>
                            <div class="setting-item-description">Encrypt sensitive data in profile files</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/bug.svg" class="svg-icon" alt="🐛"></span>
                Debugging
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Debug Mode</div>
                            <div class="setting-item-description">Enable debug logging and developer tools</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Log Level</div>
                            <div class="setting-item-description">Verbosity of application logs</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" disabled>
                                <option>Error</option>
                                <option>Warning</option>
                                <option>Info</option>
                                <option>Debug</option>
                                <option>Trace</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Open Log Directory</div>
                            <div class="setting-item-description">View application log files</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>Open Logs</button>
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
                            <div class="setting-item-title">Auto-Update</div>
                            <div class="setting-item-description">Automatically check for and install updates</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" checked disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Update Channel</div>
                            <div class="setting-item-description">Choose update release channel</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" disabled>
                                <option>Stable</option>
                                <option>Beta</option>
                                <option>Alpha</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Check for Updates</div>
                            <div class="setting-item-description">Manually check for available updates</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>Check Now</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createAISettingsContent() {
    return `
        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/ai.svg" class="svg-icon" alt="🤖"></span>
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
                            <div class="setting-item-description">AI model to use for responses (e.g. gpt-4o-mini, gpt-4, claude-3-sonnet)</div>
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
                            <div class="input-with-button">
                                <input type="password" id="ai-api-key-input" class="modern-input" placeholder="Enter your API key">
                                <button type="button" class="input-button" id="ai-api-key-toggle" title="Show/Hide API Key">
                                    <img src="./icons/eye.svg" class="svg-icon" alt="👁️">
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/keyboard.svg" class="svg-icon" alt="⌨️"></span>
                Hotkeys & Interaction
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Activation Hotkey</div>
                            <div class="setting-item-description">Keyboard shortcut to open AI assistant</div>
                        </div>
                        <div class="setting-item-control">
                            <input type="text" id="ai-hotkey-input" class="modern-input" placeholder="ctrl+k" readonly>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-section-title">
                <span class="settings-section-icon"><img src="./icons/network.svg" class="svg-icon" alt="🌐"></span>
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
                            <button class="modern-button primary" id="ai-test-connection-btn">
                                <img src="./icons/network.svg" class="svg-icon" alt="🌐">
                                Test Connection
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
                            <span class="setting-status" id="ai-connection-status">Not tested</span>
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
                Application
            </div>
            <div class="settings-list">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">License</div>
                            <div class="setting-item-description">MIT License - Open source software</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>View License</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Source Code</div>
                            <div class="setting-item-description">View the project on GitHub</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>GitHub</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Report Issues</div>
                            <div class="setting-item-description">Report bugs or request features</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>Report Issue</button>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Documentation</div>
                            <div class="setting-item-description">User guide and API documentation</div>
                        </div>
                        <div class="setting-item-control">
                            <button class="modern-button secondary" disabled>View Docs</button>
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
                    <div class="profile-tabs-container">
                        <button class="profile-tab active" data-tab="general">
                            <span class="profile-tab-icon"><img src="./icons/edit.svg" class="svg-icon" alt="📝"></span>
                            General
                        </button>
                        <button class="profile-tab" data-tab="connection">
                            <span class="profile-tab-icon"><img src="./icons/link.svg" class="svg-icon" alt="🔗"></span>
                            Connection
                        </button>
                        <button class="profile-tab" data-tab="settings">
                            <span class="profile-tab-icon"><img src="./icons/settings.svg" class="svg-icon" alt="⚙️"></span>
                            Settings
                        </button>
                    </div>
                    <button class="profile-panel-close" id="profile-panel-close">×</button>
                </div>
                <div class="profile-panel-content">
                    <div class="profile-tab-pane active" id="profile-tab-general">
                        <div class="profile-form" id="profile-form">
                            <!-- Form content will be dynamically generated -->
                        </div>
                    </div>
                    <div class="profile-tab-pane" id="profile-tab-connection">
                        <div class="profile-connection-content">
                            <!-- Connection settings will be here -->
                        </div>
                    </div>
                    <div class="profile-tab-pane" id="profile-tab-settings">
                        <div class="profile-settings-content">
                            <!-- Profile-specific settings will be here -->
                        </div>
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
        `;
    }
}

export function createProfileConnectionContent(type, data = null) {
    if (type === 'folder') {
        return `
            <div class="profile-form-section">
                <div class="profile-form-section-title">
                    <span class="profile-form-section-icon"><img src="./icons/link.svg" class="svg-icon" alt="🔗"></span>
                    Connection Settings
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Auto-connect profiles</div>
                            <div class="setting-item-description">Automatically connect to profiles in this folder when opened</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="folder-auto-connect">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    return `
        <div class="profile-form-section">
            <div class="profile-form-section-title">
                <span class="profile-form-section-icon"><img src="./icons/link.svg" class="svg-icon" alt="🔗"></span>
                Connection Settings
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Auto-connect on startup</div>
                        <div class="setting-item-description">Automatically connect to this profile when application starts</div>
                    </div>
                    <div class="setting-item-control">
                        <label class="modern-toggle">
                            <input type="checkbox" id="profile-auto-connect">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Connection timeout</div>
                        <div class="setting-item-description">Timeout for establishing connection (seconds)</div>
                    </div>
                    <div class="setting-item-control">
                        <select class="modern-select" id="connection-timeout">
                            <option value="10">10 seconds</option>
                            <option value="30" selected>30 seconds</option>
                            <option value="60">60 seconds</option>
                            <option value="120">2 minutes</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Keep alive interval</div>
                        <div class="setting-item-description">Send keep-alive packets every N seconds</div>
                    </div>
                    <div class="setting-item-control">
                        <select class="modern-select" id="keep-alive">
                            <option value="0">Disabled</option>
                            <option value="30" selected>30 seconds</option>
                            <option value="60">60 seconds</option>
                            <option value="300">5 minutes</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createProfileSettingsContent(type, data = null) {
    if (type === 'folder') {
        return `
            <div class="profile-form-section">
                <div class="profile-form-section-title">
                    <span class="profile-form-section-icon"><img src="./icons/settings.svg" class="svg-icon" alt="⚙️"></span>
                    Folder Settings
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Sort profiles</div>
                            <div class="setting-item-description">How to sort profiles within this folder</div>
                        </div>
                        <div class="setting-item-control">
                            <select class="modern-select" id="folder-sort">
                                <option value="name">By name</option>
                                <option value="recent">Recently used</option>
                                <option value="created">Date created</option>
                                <option value="manual">Manual order</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Show in favorites</div>
                            <div class="setting-item-description">Display this folder in the favorites section</div>
                        </div>
                        <div class="setting-item-control">
                            <label class="modern-toggle">
                                <input type="checkbox" id="folder-favorite">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    return `
        <div class="profile-form-section">
            <div class="profile-form-section-title">
                <span class="profile-form-section-icon"><img src="./icons/settings.svg" class="svg-icon" alt="⚙️"></span>
                Profile Settings
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Add to favorites</div>
                        <div class="setting-item-description">Show this profile in the favorites section</div>
                    </div>
                    <div class="setting-item-control">
                        <label class="modern-toggle">
                            <input type="checkbox" id="profile-favorite">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Terminal theme</div>
                        <div class="setting-item-description">Override global theme for this profile</div>
                    </div>
                    <div class="setting-item-control">
                        <select class="modern-select" id="profile-theme">
                            <option value="">Use global theme</option>
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                            <option value="auto">Auto</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Font size</div>
                        <div class="setting-item-description">Override global font size for this profile</div>
                    </div>
                    <div class="setting-item-control">
                        <select class="modern-select" id="profile-font-size">
                            <option value="">Use global size</option>
                            <option value="12">12px</option>
                            <option value="14">14px</option>
                            <option value="16">16px</option>
                            <option value="18">18px</option>
                            <option value="20">20px</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Working directory</div>
                        <div class="setting-item-description">Default directory when opening this profile</div>
                    </div>
                    <div class="setting-item-control">
                        <input type="text" class="modern-input" id="profile-working-dir" placeholder="Leave empty for default"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                    </div>
                </div>
            </div>
            <div class="setting-item">
                <div class="setting-item-content">
                    <div class="setting-item-info">
                        <div class="setting-item-title">Environment variables</div>
                        <div class="setting-item-description">Custom environment variables for this profile</div>
                    </div>
                    <div class="setting-item-control">
                        <button class="modern-button secondary" id="edit-env-vars">Edit Variables</button>
                    </div>
                </div>
            </div>
        </div>
    `;
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