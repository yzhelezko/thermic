// HTML template functions for UI components

export function createHeaderTemplate() {
    // Detect platform for correct button order
    const userAgent = navigator.userAgent.toLowerCase();
    const isMacOS = userAgent.includes('mac');
    
    // Define button order based on platform
    const windowControlsHTML = isMacOS ? `
        <!-- macOS order: close, minimize, maximize -->
        <button class="window-control window-close" id="window-close" title="Close">
            <span class="window-control-icon">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M0.7,0 L5,4.3 L9.3,0 L10,0.7 L5.7,5 L10,9.3 L9.3,10 L5,5.7 L0.7,10 L0,9.3 L4.3,5 L0,0.7 Z"/>
                </svg>
            </span>
        </button>
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
    ` : `
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
        <!-- Custom Window Titlebar -->
        <div class="window-titlebar" id="window-titlebar">
            <div class="window-titlebar-content">
                <div class="window-title">Thermic</div>
                <div class="window-controls">
                    ${windowControlsHTML}
                </div>
            </div>
        </div>

        <!-- Application Header/Toolbar -->
        <div class="app-header">
            <div class="header-left">
                <button class="toolbar-btn active" id="btn-explorer">
                    <span>📁</span> Profiles
                </button>
                <button class="toolbar-btn" id="btn-filemanager">
                    <span>📂</span> Files
                </button>
                <button class="toolbar-btn" id="btn-search">
                    <span>🔍</span> Search
                </button>
            </div>
            
            <div class="header-center">
                <!-- Empty center area -->
            </div>
            
            <div class="header-right">
                <button class="icon-btn" id="theme-toggle" title="Toggle theme">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z"/>
                    </svg>
                </button>
                <button class="icon-btn" id="settings-btn" title="Settings">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.828 2.25c-.916 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.243.243a1.875 1.875 0 00-.2 2.416l.324.453a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.549.091A1.875 1.875 0 002.25 11.828v.344c0 .916.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.243.243c.648.648 1.67.733 2.416.2l.453-.324a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.091.549a1.875 1.875 0 001.85 1.567h.344c.916 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.243-.243c.648-.648.733-1.67.2-2.416l-.324-.453a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.549-.091A1.875 1.875 0 0021.75 12.172v-.344c0-.916-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.243-.243a1.875 1.875 0 00-2.416-.2l-.453.324a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.091-.549A1.875 1.875 0 0012.172 2.25h-.344zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"/>
                    </svg>
                </button>
                <button class="icon-btn" id="account-btn" title="Account">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

export function createTabsTemplate() {
    return `
        <div class="tabs-bar">
            <div class="tabs-list" id="tabs-list">
                <!-- Tabs will be inserted here dynamically -->
            </div>
            <div class="tabs-controls">
                <button class="new-tab-btn" id="new-tab-btn" title="New Terminal">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
                <button class="new-ssh-tab-btn" id="new-ssh-tab-btn" title="New SSH Connection">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 12l2 2 4-4"></path>
                        <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 0-2-2z"></path>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

export function createSidebarTemplate() {
    return `
        <div class="sidebar-header">
            <span>Profiles</span>
        </div>
        <div class="sidebar-content">
            <!-- Profile tree will be dynamically populated by SidebarManager -->
            <div class="loading-placeholder" style="padding: 20px; text-align: center; color: var(--text-tertiary);">
                <div>📁</div>
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
                    <button class="settings-tab active" data-tab-target="#settings-tab-signals">Signals</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-general">General</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-packing">Packing</button>
                    <button class="settings-tab" data-tab-target="#settings-tab-common">Common</button>
                </div>
            </div>
            <div class="settings-panel-content">
                <div class="settings-tab-pane active" id="settings-tab-signals">
                    ${createTerminalSettingsCard()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-general">
                    ${createGeneralSettingsCard()}
                </div>
                <div class="settings-tab-pane" id="settings-tab-packing">
                    <p style="padding: 20px; text-align: center; color: var(--text-tertiary);">Packing settings will be here.</p>
                </div>
                <div class="settings-tab-pane" id="settings-tab-common">
                    <p style="padding: 20px; text-align: center; color: var(--text-tertiary);">Common settings will be here.</p>
                </div>
            </div>
        </div>
    `;
}

export function createTerminalSettingsCard() {
    return `
        <div class="settings-card">
            <div class="settings-card-header">
                <div class="settings-card-icon">💻</div>
                <div class="settings-card-title">Terminal Database</div>
            </div>
            <div class="settings-card-content">
                <div class="setting-row">
                    <div class="setting-label">Type</div>
                    <div class="setting-control">
                        <select class="setting-select">
                            <option>System</option>
                            <option>Custom</option>
                            <option>Remote</option>
                        </select>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-label">State Config</div>
                    <div class="setting-control">
                        <select class="setting-select" id="shell-selector">
                            <option value="">Loading shells...</option>
                        </select>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-label">Title</div>
                    <div class="setting-control">
                        <input type="text" class="setting-input" value="Thermic" placeholder="Enter title">
                        <button class="setting-button">✓</button>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-label">Font</div>
                    <div class="setting-control">
                        <select class="setting-select">
                            <option>Consolas</option>
                            <option>Monaco</option>
                            <option>Fira Code</option>
                            <option>JetBrains Mono</option>
                        </select>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-label">Text Color</div>
                    <div class="setting-control">
                        <input type="text" class="setting-input" value="#FAFAFA" style="width: 80px;">
                        <div class="color-indicator" style="background: #FAFAFA;"></div>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-label">Shadow Color</div>
                    <div class="setting-control">
                        <input type="text" class="setting-input" value="#E3E3E3" style="width: 80px;">
                        <div class="color-indicator" style="background: #E3E3E3;"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="settings-card">
            <div class="settings-card-header">
                <div class="settings-card-icon">🖱️</div>
                <div class="settings-card-title">Terminal Interaction</div>
            </div>
            <div class="settings-card-content">
                <div class="setting-item">
                    <div class="setting-item-content">
                        <div class="setting-item-info">
                            <div class="setting-item-title">Select to Copy</div>
                            <div class="setting-item-description">Automatically copy selected text and paste with right-click</div>
                        </div>
                        <label class="modern-toggle">
                            <input type="checkbox" id="select-to-copy-toggle">
                            <span class="toggle-slider"></span>
                        </label>
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
                <span class="context-menu-item-icon">📋</span>
                <span>Copy</span>
                <span class="context-menu-shortcut">Ctrl+C</span>
            </div>
            <div class="context-menu-item" data-action="paste">
                <span class="context-menu-item-icon">📄</span>
                <span>Paste</span>
                <span class="context-menu-shortcut">Ctrl+V</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="select-all">
                <span class="context-menu-item-icon">🔤</span>
                <span>Select All</span>
                <span class="context-menu-shortcut">Ctrl+A</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="clear">
                <span class="context-menu-item-icon">🗑️</span>
                <span>Clear Terminal</span>
                <span class="context-menu-shortcut">Ctrl+L</span>
            </div>
            <div class="context-menu-item" data-action="scroll-to-top">
                <span class="context-menu-item-icon">⬆️</span>
                <span>Scroll to Top</span>
                <span class="context-menu-shortcut">Ctrl+Home</span>
            </div>
            <div class="context-menu-item" data-action="scroll-to-bottom">
                <span class="context-menu-item-icon">⬇️</span>
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
                <span class="context-menu-item-icon">🔗</span>
                <span>Connect</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item context-menu-create-section" data-action="create-profile">
                <span class="context-menu-item-icon">➕</span>
                <span>Create Profile</span>
            </div>
            <div class="context-menu-item context-menu-create-section" data-action="create-folder">
                <span class="context-menu-item-icon">📁</span>
                <span>Create Folder</span>
            </div>
            <div class="context-menu-separator context-menu-create-separator"></div>
            <div class="context-menu-item" data-action="search">
                <span class="context-menu-item-icon">🔍</span>
                <span>Search Profiles</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="edit">
                <span class="context-menu-item-icon">✏️</span>
                <span>Edit</span>
            </div>
            <div class="context-menu-item" data-action="duplicate">
                <span class="context-menu-item-icon">📑</span>
                <span>Duplicate</span>
            </div>
            <div class="context-menu-item" data-action="rename">
                <span class="context-menu-item-icon">📝</span>
                <span>Rename</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="delete">
                <span class="context-menu-item-icon">🗑️</span>
                <span>Delete</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="properties">
                <span class="context-menu-item-icon">ℹ️</span>
                <span>Properties</span>
            </div>
        </div>
    `;
}

export function createTabContextMenuTemplate() {
    return `
        <div class="context-menu" id="tab-context-menu">
            <div class="context-menu-item" data-action="tab-reconnect">
                <span class="context-menu-item-icon">🔄</span>
                <span>Reconnect</span>
            </div>
            <div class="context-menu-item" data-action="tab-force-disconnect">
                <span class="context-menu-item-icon">❌</span>
                <span>Force Disconnect</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="tab-duplicate">
                <span class="context-menu-item-icon">📑</span>
                <span>Duplicate Tab</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="tab-close">
                <span class="context-menu-item-icon">❌</span>
                <span>Close Tab</span>
            </div>
            <div class="context-menu-item" data-action="tab-close-others">
                <span class="context-menu-item-icon">🗂️</span>
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
                    <h3 id="profile-panel-title">Create Profile</h3>
                    <button class="profile-panel-close" id="profile-panel-close">×</button>
                </div>
                <div class="profile-panel-content">
                    <div class="profile-form" id="profile-form">
                        <!-- Form content will be dynamically generated -->
                    </div>
                </div>
                <div class="profile-panel-footer">
                    <button class="btn btn-secondary" id="profile-cancel-btn">Cancel</button>
                    <button class="btn btn-primary" id="profile-save-btn">Save</button>
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
            <div class="form-group">
                <label for="folder-name">Folder Name</label>
                <input type="text" id="folder-name" class="form-input" value="${data?.name || ''}" placeholder="Enter folder name" required>
            </div>
            <div class="form-group">
                <label for="folder-icon">Icon</label>
                <div class="icon-selector">
                    <input type="text" id="folder-icon" class="form-input icon-input" value="${data?.icon || '📁'}" placeholder="📁">
                    <div class="icon-grid">
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
        `;
    } else {
        return `
            <div class="form-group">
                <label for="profile-name">Profile Name</label>
                <input type="text" id="profile-name" class="form-input" value="${data?.name || ''}" placeholder="Enter profile name" required>
            </div>
            <div class="form-group">
                <label for="profile-icon">Icon</label>
                <div class="icon-selector">
                    <input type="text" id="profile-icon" class="form-input icon-input" value="${data?.icon || '💻'}" placeholder="💻">
                    <div class="icon-grid">
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
            <div class="form-group">
                <label for="profile-type">Profile Type</label>
                <select id="profile-type" class="form-select">
                    <option value="local" ${data?.type === 'local' ? 'selected' : ''}>Local Shell</option>
                    <option value="ssh" ${data?.type === 'ssh' ? 'selected' : ''}>SSH Connection</option>
                    <option value="custom" ${data?.type === 'custom' ? 'selected' : ''}>Custom Command</option>
                </select>
            </div>
            <div class="form-group local-shell-group" style="display: ${data?.type === 'local' || !data?.type ? 'block' : 'none'}">
                <label for="profile-shell">Shell Command</label>
                <select id="profile-shell" class="form-select">
                    <option value="">Loading shells...</option>
                </select>
            </div>
            <div class="form-group ssh-group" style="display: ${data?.type === 'ssh' ? 'block' : 'none'}">
                <label for="ssh-host">SSH Host</label>
                <input type="text" id="ssh-host" class="form-input" value="${data?.sshConfig?.host || ''}" placeholder="hostname or IP">
            </div>
            <div class="form-group ssh-group" style="display: ${data?.type === 'ssh' ? 'block' : 'none'}">
                <label for="ssh-port">SSH Port</label>
                <input type="number" id="ssh-port" class="form-input" value="${data?.sshConfig?.port || 22}" placeholder="22">
            </div>
            <div class="form-group ssh-group" style="display: ${data?.type === 'ssh' ? 'block' : 'none'}">
                <label for="ssh-username">Username</label>
                <input type="text" id="ssh-username" class="form-input" value="${data?.sshConfig?.username || ''}" placeholder="username">
            </div>
            <div class="form-group ssh-group" style="display: ${data?.type === 'ssh' ? 'block' : 'none'}">
                <label for="ssh-password">Password (optional)</label>
                <input type="password" id="ssh-password" class="form-input" value="${data?.sshConfig?.password || ''}" placeholder="password">
            </div>
            <div class="form-group ssh-group" style="display: ${data?.type === 'ssh' ? 'block' : 'none'}">
                <label for="ssh-keypath">Private Key Path (optional)</label>
                <input type="text" id="ssh-keypath" class="form-input" value="${data?.sshConfig?.keyPath || ''}" placeholder="/path/to/private/key">
            </div>
            <div class="form-group custom-group" style="display: ${data?.type === 'custom' ? 'block' : 'none'}">
                <label for="custom-command">Custom Command</label>
                <input type="text" id="custom-command" class="form-input" value="${data?.shell || ''}" placeholder="Enter custom command">
            </div>
            <div class="form-group">
                <label for="profile-workdir">Working Directory (optional)</label>
                <input type="text" id="profile-workdir" class="form-input" value="${data?.workingDir || ''}" placeholder="Enter working directory">
            </div>
        `;
    }
}

export function createGeneralSettingsCard() {
    return `
        <div class="settings-card">
            <div class="settings-card-header">
                <div class="settings-card-icon">📁</div>
                <div class="settings-card-title">Profiles Configuration</div>
            </div>
            <div class="settings-card-content">
                <div class="setting-row">
                    <div class="setting-label">Profiles Directory</div>
                    <div class="setting-control">
                        <input type="text" class="setting-input" id="profiles-path-input" placeholder="Leave empty for default location">
                        <button class="setting-button" id="browse-profiles-path">📂</button>
                        <button class="setting-button" id="save-profiles-path">✓</button>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-label">Current Path</div>
                    <div class="setting-control">
                        <span class="setting-info" id="current-profiles-path">Loading...</span>
                    </div>
                </div>
            </div>
        </div>
    `;
} 