// Enhanced Sidebar management module with profile tree support
import { updateStatus, showNotification } from './utils.js';

export class SidebarManager {
    constructor() {
        this.profileTree = [];
        this.selectedItem = null;
        this.draggedItem = null;
        this.expandedFolders = new Set();
        this.profilePanelOpen = false;
        this.editingProfile = null;
        this.doubleClickHandled = false;
        this.iconSelectorListeners = [];
    }

    async initSidebar() {
        console.log('🚀 Initializing sidebar...');
        this.setupSidebarInteractions();
        await this.setupProfilePanel();
        await this.loadProfileTree();
        this.renderProfileTree();
        this.setupProfileUpdateListener();
        console.log('✅ Sidebar initialization complete');
        
        // Test profile interaction after a brief delay
        setTimeout(() => {
            this.testProfileInteraction();
        }, 1000);
    }
    
    testProfileInteraction() {
        const profileItems = document.querySelectorAll('.tree-item[data-type="profile"]');
        console.log(`🔍 Found ${profileItems.length} profile items for interaction`);
        
        if (profileItems.length > 0) {
            const firstProfile = profileItems[0];
            const profileId = firstProfile.dataset.id;
            const profileName = firstProfile.querySelector('.tree-item-text')?.textContent;
            console.log(`📋 First profile: ${profileName} (ID: ${profileId})`);
        }
        
        // Test if CreateTabFromProfile API is available
        if (window.go?.main?.App?.CreateTabFromProfile) {
            console.log('✅ CreateTabFromProfile API is available');
        } else {
            console.error('❌ CreateTabFromProfile API is NOT available');
        }
    }

    async loadProfileTree() {
        try {
            // Load regular profile tree
            this.profileTree = await window.go.main.App.GetProfileTreeAPI();
            console.log('Loaded profile tree:', this.profileTree);

            // Populate expandedFolders set based on loaded tree
            this.expandedFolders.clear(); // Clear existing state
            const populateExpanded = (nodes) => {
                for (const node of nodes) {
                    if (node.type === 'folder' && node.expanded) {
                        this.expandedFolders.add(node.id);
                    }
                    if (node.children) {
                        populateExpanded(node.children);
                    }
                }
            };
            populateExpanded(this.profileTree);
            console.log('Initialized expanded folders:', Array.from(this.expandedFolders));
            
            // Load virtual folders
            this.virtualFolders = await window.go.main.App.GetVirtualFoldersAPI();
            console.log('Loaded virtual folders:', this.virtualFolders);
            
            // Load metrics for display
            this.metrics = await window.go.main.App.GetMetricsAPI();
            console.log('Loaded metrics:', this.metrics);
            
        } catch (error) {
            console.error('Failed to load profile tree:', error);
            showNotification('Failed to load profiles', 'error');
            this.profileTree = [];
            this.virtualFolders = [];
            this.metrics = {};
            this.expandedFolders.clear(); // Ensure consistent state on error
        }
    }

    setupSidebarInteractions() {
        // Main document click listener for handling various interactions
        document.addEventListener('click', (e) => {
            const treeItem = e.target.closest('.tree-item');
            const profileActionButton = e.target.closest('.profile-action-btn');
            const contextMenu = e.target.closest('.context-menu');
            const profilePanel = e.target.closest('.profile-panel');
            const isProfilePanelButton = ['profile-panel-close', 'profile-save', 'profile-cancel'].includes(e.target.id);

            // Priority 1: Profile Panel Buttons
            if (isProfilePanelButton) {
                if (e.target.id === 'profile-panel-close' || e.target.id === 'profile-cancel') {
                    this.closeProfilePanel();
                } else if (e.target.id === 'profile-save') {
                    this.saveProfile();
                }
                return; // Explicitly stop further processing for these buttons
            }
            
            // Priority 2: Profile Action Buttons (could be inside a treeItem)
            if (profileActionButton) {
                this.handleProfileAction(e); // Assuming this method exists and handles its own logic
                // If the action button is part of a tree item, we might not want to deselect the item.
                // Let handleProfileAction manage selection if necessary.
                return; // Stop further processing if an action button was clicked
            } 
            
            // Priority 3: Tree Items (folders or profiles)
            if (treeItem) {
                this.handleTreeItemClick(e, treeItem);
                return; // Stop further processing if a tree item was clicked
            } 
            
            // Priority 4: Click outside of any interactive sidebar elements
            // (and not inside a context menu or profile panel, which are handled by their own logic or ignored here)
            if (!contextMenu && !profilePanel) {
                document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
                this.selectedItem = null;
            }
        });

        // Double-click to open profile (enhanced)
        document.addEventListener('dblclick', (e) => {
            const profileItem = e.target.closest('.tree-item[data-type="profile"]') || 
                               e.target.closest('.virtual-profile[data-type="profile"]') ||
                               e.target.closest('.search-result[data-type="profile"]');
            if (profileItem) {
                this.doubleClickHandled = true;
                this.handleProfileDoubleClick(e);
            }
        });

        // Context menu is handled by the existing ContextMenuManager
        // No need to add another context menu handler here

        // Drag and drop
        this.setupDragAndDrop();

        // Search functionality (can be triggered through context menu or other means)
        document.addEventListener('keydown', (e) => {
            // Ctrl+F or Cmd+F to open search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                this.showSearchPanel();
            }
        });

        // The profile panel button clicks are now handled in the main document click listener above.
    }

    setupDragAndDrop() {
        document.addEventListener('dragstart', (e) => {
            if (e.target.closest('.tree-item')) {
                this.handleDragStart(e);
            }
        });

        document.addEventListener('dragover', (e) => {
            if (e.target.closest('.tree-item') || e.target.closest('.sidebar-content')) {
                this.handleDragOver(e);
            }
        });

        document.addEventListener('drop', (e) => {
            if (e.target.closest('.tree-item') || e.target.closest('.sidebar-content')) {
                this.handleDrop(e);
            }
        });

        document.addEventListener('dragend', () => {
            this.handleDragEnd();
        });
    }

    handleTreeItemClick(e, item) {
        e.preventDefault();
        e.stopPropagation();

        const itemId = item.dataset.id;
        const itemType = item.dataset.type;
        const isToggleClick = e.target.closest('.tree-folder-toggle');

        // Ensure any previously selected item is deselected
        document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
        this.selectedItem = { id: itemId, type: itemType }; // Still track selected item internally if needed

        const name = item.querySelector('.tree-item-text')?.textContent;
        updateStatus(`Selected: ${name}`);

        if (itemType === 'folder') {
            // Toggle folder expansion if clicking on the folder item itself or its toggle icon
            const folderElement = item.closest('.tree-folder');
            const isExpanded = this.expandedFolders.has(itemId);

            if (isExpanded) {
                this.expandedFolders.delete(itemId);
                folderElement.classList.remove('expanded');
            } else {
                this.expandedFolders.add(itemId);
                folderElement.classList.add('expanded');
            }

            // Update folder state in backend
            this.updateFolderExpandedState(itemId, this.expandedFolders.has(itemId));
            
            // Update the toggle icon
            const toggle = folderElement.querySelector('.tree-folder-toggle');
            if (toggle) {
                toggle.textContent = this.expandedFolders.has(itemId) ? '▼' : '▶';
            }
            updateStatus(`Toggled: ${name}`);
        } else if (itemType === 'profile' && !isToggleClick) {
            // Connect to profile on single click, but only if not clicking a folder toggle
            // This handles both regular tree profiles and virtual/search profiles
            this.connectToProfile(itemId, item);
        }
    }

    async handleProfileDoubleClick(e) {
        const item = e.target.closest('.tree-item') || 
                    e.target.closest('.virtual-profile') || 
                    e.target.closest('.search-result');
                    
        console.log('Double-click on profile item:', item);
        
        const profileId = item?.dataset.id;

        if (!profileId) {
            console.error('No profile ID found for double-click');
            return;
        }

        // Enhanced visual feedback
        item.style.transform = 'scale(0.95)';
        setTimeout(() => {
            item.style.transform = '';
        }, 100);

        // Connect to profile
        await this.connectToProfile(profileId, item);
    }

    async connectToProfile(profileId, item) {
        try {
            console.log('Connecting to profile:', profileId);
            
            // Get profile data
            const profile = this.getProfileById(profileId);
            if (!profile) {
                throw new Error('Profile not found');
            }
            
            // Get profile name for feedback
            const nameElement = item.querySelector('.tree-item-text');
            const profileName = nameElement ? nameElement.textContent : profile.name;
            
            // Show connecting feedback
            showNotification(`Connecting to ${profileName}...`, 'info');
            
            // Use the existing TabsManager to create a new tab
            // Access the global terminal app instance
            const tabsManager = window.thermicApp?.tabsManager;
            if (!tabsManager) {
                throw new Error('TabsManager not available');
            }
            
            console.log('Profile data:', profile);
            
            // Create tab based on profile type
            let newTab;
            if (profile.type === 'ssh' && profile.sshConfig) {
                console.log('Creating SSH tab with config:', profile.sshConfig);
                newTab = await tabsManager.createNewTab(null, profile.sshConfig);
            } else {
                console.log('Creating local tab with shell:', profile.shell);
                newTab = await tabsManager.createNewTab(profile.shell || null);
            }
            
            // Set working directory if specified
            if (newTab && profile.workingDir) {
                try {
                    // Send cd command to change directory
                    const cdCommand = process.platform === 'win32' 
                        ? `cd /d "${profile.workingDir}"\n`
                        : `cd "${profile.workingDir}"\n`;
                    
                    setTimeout(() => {
                        window.go.main.App.WriteToShell(newTab.sessionId, cdCommand);
                    }, 1000); // Wait for shell to initialize
                } catch (cdError) {
                    console.warn('Failed to change working directory:', cdError);
                }
            }
            
            // Update tab title to match profile name
            if (newTab && profileName !== newTab.title) {
                try {
                    await window.go.main.App.RenameTab(newTab.id, profileName);
                    newTab.title = profileName;
                    tabsManager.renderTabs(); // Refresh tab display
                } catch (renameError) {
                    console.warn('Failed to rename tab:', renameError);
                }
            }
            
            showNotification(`✅ Connected to ${profileName}`, 'success');
            
            // Update profile usage tracking
            try {
                // The backend already handles usage tracking in CreateTabFromProfile
                // But since we're using TabsManager instead, we need to manually update it
                const profile = this.getProfileById(profileId);
                if (profile) {
                    profile.usageCount = (profile.usageCount || 0) + 1;
                    profile.lastUsed = new Date();
                    await window.go.main.App.UpdateProfile(profile);
                    
                    // Refresh the sidebar to show updated usage
                    setTimeout(() => {
                        this.loadProfileTree().then(() => this.renderProfileTree());
                    }, 500);
                }
            } catch (usageError) {
                console.warn('Failed to update usage tracking:', usageError);
            }
            
        } catch (error) {
            console.error('Failed to connect to profile:', error);
            console.error('Profile ID was:', profileId);
            console.error('Error stack:', error.stack);
            showNotification('❌ Failed to connect: ' + error.message, 'error');
        }
    }

    // Context menu is handled by the existing ContextMenuManager
    // The existing context menu will call our methods when needed

    handleDragStart(e) {
        const item = e.target.closest('.tree-item');
        this.draggedItem = {
            id: item.dataset.id,
            type: item.dataset.type,
            element: item
        };

        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ''); // Required for Firefox
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Remove 'drop-target' from all items first
        document.querySelectorAll('.tree-item.drop-target').forEach(el => {
            el.classList.remove('drop-target');
        });

        // Highlight current valid drop target
        const item = e.target.closest('.tree-item');
        if (item && item.dataset.type === 'folder' && item !== this.draggedItem?.element) {
            item.classList.add('drop-target');
        }
    }

    async handleDrop(e) {
        e.preventDefault();
        
        const dropTarget = e.target.closest('.tree-item');
        const isRootDrop = e.target.closest('.sidebar-content') && !dropTarget;

        if (!this.draggedItem) return;

        let newFolderPath = '';
        
        if (dropTarget && dropTarget.dataset.type === 'folder') {
            // Dropped on a folder
            newFolderPath = this.getFolderPath(dropTarget.dataset.id);
        } else if (isRootDrop) {
            // Dropped on root
            newFolderPath = '';
        } else {
            return; // Invalid drop target
        }

        try {
            if (this.draggedItem.type === 'profile') {
                await window.go.main.App.MoveProfile(this.draggedItem.id, newFolderPath);
            } else if (this.draggedItem.type === 'folder') {
                // Move folder logic would go here
                showNotification('Moving folders not yet implemented', 'info');
                return;
            }

            await this.loadProfileTree();
            this.renderProfileTree();
            showNotification('Item moved successfully', 'success');
        } catch (error) {
            console.error('Failed to move item:', error);
            showNotification('Failed to move item', 'error');
        }
    }

    handleDragEnd() {
        if (this.draggedItem) {
            this.draggedItem.element.classList.remove('dragging');
            this.draggedItem = null;
        }

        // Remove all drop target highlights
        document.querySelectorAll('.drop-target').forEach(el => {
            el.classList.remove('drop-target');
        });
    }

    getFolderPath(folderId) {
        // Find folder path by traversing the tree
        const findPath = (nodes, targetId, currentPath = '') => {
            for (const node of nodes) {
                const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
                
                if (node.id === targetId) {
                    return nodePath;
                }
                
                if (node.children) {
                    const childPath = findPath(node.children, targetId, nodePath);
                    if (childPath) return childPath;
                }
            }
            return null;
        };

        return findPath(this.profileTree, folderId) || '';
    }

    async openProfile(profileId) {
        // Use the same connectToProfile method for consistency
        // Create a mock item element for the connectToProfile method
        const profile = this.getProfileById(profileId);
        if (!profile) {
            showNotification('❌ Profile not found', 'error');
            return;
        }
        
        const mockItem = {
            querySelector: () => ({ textContent: profile.name })
        };
        
        await this.connectToProfile(profileId, mockItem);
    }

    async editProfile(profileId) {
        try {
            const profile = await window.go.main.App.GetProfile(profileId);
            this.openProfilePanel('edit', 'profile', null, profile);
        } catch (error) {
            console.error('Failed to load profile for editing:', error);
            showNotification('Failed to load profile', 'error');
        }
    }

    async duplicateProfile(profileId) {
        try {
            await window.go.main.App.DuplicateProfile(profileId);
            await this.loadProfileTree();
            this.renderProfileTree();
            showNotification('Profile duplicated', 'success');
        } catch (error) {
            console.error('Failed to duplicate profile:', error);
            showNotification('Failed to duplicate profile', 'error');
        }
    }

    async deleteProfile(profileId) {
        if (!confirm('Are you sure you want to delete this profile?')) {
            return;
        }

        try {
            await window.go.main.App.DeleteProfileAPI(profileId);
            
            await this.loadProfileTree();
            this.renderProfileTree();
            showNotification('Profile deleted', 'success');
            
        } catch (error) {
            console.error('Failed to delete profile:', error);
            showNotification('Failed to delete profile: ' + error.message, 'error');
        }
    }

    async editFolder(folderId) {
        try {
            const folder = await window.go.main.App.GetProfileFolder(folderId);
            this.openProfilePanel('edit', 'folder', null, folder);
        } catch (error) {
            console.error('Failed to load folder for editing:', error);
            showNotification('Failed to load folder', 'error');
        }
    }

    async deleteFolder(folderId) {
        if (!confirm('Are you sure you want to delete this folder? All profiles in this folder will be moved to the root.')) {
            return;
        }

        try {
            await window.go.main.App.DeleteProfileFolderAPI(folderId);
            
            await this.loadProfileTree();
            this.renderProfileTree();
            showNotification('Folder deleted', 'success');
            
        } catch (error) {
            console.error('Failed to delete folder:', error);
            showNotification('Failed to delete folder: ' + error.message, 'error');
        }
    }

    renderProfileTree() {
        const sidebarContent = document.querySelector('.sidebar-content');
        if (!sidebarContent) return;

        let virtualFoldersHTML = '';
        if (this.virtualFolders && this.virtualFolders.length > 0) {
            virtualFoldersHTML = `
                <div class="virtual-folders-section">
                    ${this.renderVirtualFolders()}
                </div>
            `;
        }

        sidebarContent.innerHTML = `
            ${virtualFoldersHTML}
            <div class="profile-tree">
                <div class="section-header">ROOT FOLDER</div>
                ${this.renderTreeNodes(this.profileTree)}
            </div>
        `;

        // Setup virtual folder interactions
        this.setupVirtualFolderInteractions();
    }

    renderVirtualFolders() {
        return this.virtualFolders.map(vf => `
            <div class="virtual-folder" data-id="${vf.id}" data-type="virtual">
                <div class="tree-item-content">
                    <span class="tree-item-icon">${vf.icon}</span>
                    <span class="tree-item-text">${vf.name}</span>
                    <span class="virtual-folder-count" data-folder-id="${vf.id}">...</span>
                </div>
            </div>
        `).join('');
    }

    setupVirtualFolderInteractions() {
        // Load profile counts for virtual folders
        this.virtualFolders?.forEach(async vf => {
            try {
                const profiles = await window.go.main.App.GetVirtualFolderProfilesAPI(vf.id);
                const countElement = document.querySelector(`[data-folder-id="${vf.id}"]`);
                if (countElement) {
                    countElement.textContent = `(${profiles.length})`;
                }
            } catch (error) {
                console.error(`Failed to load count for virtual folder ${vf.id}:`, error);
            }
        });

        // Handle virtual folder clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.virtual-folder')) {
                this.handleVirtualFolderClick(e);
            }
        });
    }

    async handleVirtualFolderClick(e) {
        const vfElement = e.target.closest('.virtual-folder');
        const vfId = vfElement.dataset.id;
        
        try {
            const profiles = await window.go.main.App.GetVirtualFolderProfilesAPI(vfId);
            this.showVirtualFolderContent(vfId, profiles);
        } catch (error) {
            console.error('Failed to load virtual folder content:', error);
            showNotification('Failed to load virtual folder', 'error');
        }
    }

    showVirtualFolderContent(vfId, profiles) {
        const vf = this.virtualFolders.find(f => f.id === vfId);
        if (!vf) return;

        const sidebarContent = document.querySelector('.sidebar-content');
        const backButton = `
            <div class="virtual-folder-header">
                <button class="back-btn" onclick="window.sidebarManager.renderProfileTree()">← Back</button>
                <h3>${vf.icon} ${vf.name}</h3>
            </div>
        `;

        const profilesHTML = profiles.map(profile => {
            const tooltipText = `Click or double-click to connect to ${profile.name} (${profile.type || 'local'})`;
            return `
                <div class="tree-item virtual-profile" data-id="${profile.id}" data-type="profile" title="${tooltipText}">
                    <div class="tree-item-content">
                        <span class="tree-item-icon">${profile.icon}</span>
                        <span class="tree-item-text">${profile.name}</span>
                        ${profile.isFavorite ? '<span class="favorite-star">⭐</span>' : ''}
                        ${profile.usageCount > 0 ? `<span class="usage-count">${profile.usageCount}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        sidebarContent.innerHTML = backButton + (profilesHTML || '<div class="empty-state">No profiles found</div>');
    }

    showSearchPanel() {
        const sidebarContent = document.querySelector('.sidebar-content');
        
        sidebarContent.innerHTML = `
            <div class="search-panel">
                <div class="search-header">
                    <button class="back-btn" onclick="window.sidebarManager.renderProfileTree()">← Back</button>
                    <h3>🔍 Search Profiles</h3>
                </div>
                <div class="search-controls">
                    <input type="text" id="search-input" placeholder="Search profiles..." class="search-input">
                    <div class="tag-filter">
                        <label>Filter by tags:</label>
                        <div id="tag-buttons" class="tag-buttons"></div>
                    </div>
                </div>
                <div id="search-results" class="search-results"></div>
            </div>
        `;

        this.setupSearchInteractions();
    }

    async setupSearchInteractions() {
        const searchInput = document.getElementById('search-input');
        const tagButtons = document.getElementById('tag-buttons');
        const searchResults = document.getElementById('search-results');

        // Load popular tags
        try {
            const tags = await window.go.main.App.GetPopularTagsAPI();
            tagButtons.innerHTML = tags.map(tag => 
                `<button class="tag-btn" data-tag="${tag}">${tag}</button>`
            ).join('');
        } catch (error) {
            console.error('Failed to load tags:', error);
        }

        let selectedTags = [];

        // Tag selection
        tagButtons.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-btn')) {
                const tag = e.target.dataset.tag;
                if (selectedTags.includes(tag)) {
                    selectedTags = selectedTags.filter(t => t !== tag);
                    e.target.classList.remove('selected');
                } else {
                    selectedTags.push(tag);
                    e.target.classList.add('selected');
                }
                this.performSearch(searchInput.value, selectedTags, searchResults);
            }
        });

        // Search input
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.performSearch(e.target.value, selectedTags, searchResults);
            }, 300);
        });

        // Initial search
        this.performSearch('', selectedTags, searchResults);
    }

    async performSearch(query, tags, resultsContainer) {
        try {
            const results = await window.go.main.App.SearchProfilesAPI(query, tags);
            
            if (results.length === 0) {
                resultsContainer.innerHTML = '<div class="empty-state">No profiles found</div>';
                return;
            }

            resultsContainer.innerHTML = results.map(profile => {
                const tooltipText = `Click or double-click to connect to ${profile.name} (${profile.type || 'local'})`;
                return `
                    <div class="tree-item search-result" data-id="${profile.id}" data-type="profile" title="${tooltipText}">
                        <div class="tree-item-content">
                            <span class="tree-item-icon">${profile.icon}</span>
                            <span class="tree-item-text">${profile.name}</span>
                            ${profile.isFavorite ? '<span class="favorite-star">⭐</span>' : ''}
                            <div class="profile-meta">
                                ${profile.tags?.length ? `<span class="profile-tags">${profile.tags.join(', ')}</span>` : ''}
                                ${profile.usageCount > 0 ? `<span class="usage-count">Used ${profile.usageCount} times</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Search failed:', error);
            resultsContainer.innerHTML = '<div class="error-state">Search failed</div>';
        }
    }

    renderTreeNodes(nodes, level = 0) {
        return nodes.map(node => {
            if (node.type === 'folder') {
                return this.renderFolderNode(node, level);
            } else {
                return this.renderProfileNode(node, level);
            }
        }).join('');
    }

    renderFolderNode(folder, level) {
        const isExpanded = this.expandedFolders.has(folder.id) || folder.expanded;
        const children = folder.children || [];
        
        return `
            <div class="tree-folder ${isExpanded ? 'expanded' : ''}" data-level="${level}">
                <div class="tree-item" data-id="${folder.id}" data-type="folder" draggable="true">
                <div class="tree-item-content" style="padding-left: ${(level * 16) + 8}px">
                        <span class="tree-folder-toggle" data-folder-id="${folder.id}">
                            ${isExpanded ? '▼' : '▶'}
                        </span>
                        <span class="tree-item-icon">${folder.icon}</span>
                        <span class="tree-item-text">${folder.name}</span>
                    </div>
                </div>
                <div class="tree-folder-children" style="display: ${isExpanded ? 'block' : 'none'}">
                    ${this.renderTreeNodes(children, level + 1)}
                </div>
            </div>
        `;
    }

    renderProfileNode(profile, level) {
        const favoriteIcon = profile.profile?.isFavorite ? '<span class="favorite-indicator">⭐</span>' : '';
        const profileType = profile.profile?.type || 'local';
        const tooltipText = `Click or double-click to connect to ${profile.name} (${profileType})`;
        
        return `
            <div class="tree-item" data-id="${profile.id}" data-type="profile" draggable="true" title="${tooltipText}">
                <div class="tree-item-content" style="padding-left: ${(level + 1) * 16}px">
                    <span class="tree-item-icon">${profile.icon}</span>
                    <span class="tree-item-text">${profile.name}</span>
                    ${favoriteIcon}
                    <span class="tree-item-type">${profileType}</span>
                </div>
            </div>
        `;
    }

    updateSidebarContent(activeButton) {
        const sidebarHeader = document.querySelector('.sidebar-header');
        const sidebarContent = document.querySelector('.sidebar-content');

        switch (activeButton) {
            case 'btn-explorer':
                sidebarHeader.textContent = 'Profiles';
                this.renderProfileTree();
                break;
            case 'btn-filemanager':
                sidebarHeader.textContent = 'File Explorer';
                sidebarContent.innerHTML = this.getFileManagerContent();
                break;
            case 'btn-search':
                sidebarHeader.textContent = 'Search';
                sidebarContent.innerHTML = this.getSearchContent();
                break;
        }
    }

    getFileManagerContent() {
        return `
            <div style="padding: 20px; text-align: center; color: var(--text-tertiary);">
                <div>📂</div>
                <div style="margin-top: 8px;">File Explorer</div>
                <div style="margin-top: 4px; font-size: 11px;">Coming soon...</div>
            </div>
        `;
    }

    getSearchContent() {
        return `
            <div style="padding: 8px;">
                <input type="text" placeholder="Search profiles..." style="width: 100%; padding: 4px 8px; background: var(--bg-quaternary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
            </div>
            <div class="tree-item">
                <span class="tree-icon">🔍</span>
                <span>Search results will appear here</span>
            </div>
        `;
    }

    // Profile panel implementation
    async setupProfilePanel() {
        // Import the template functions
        try {
            const module = await import('./templates.js');
            this.createProfilePanelTemplate = module.createProfilePanelTemplate;
            this.createProfileFormTemplate = module.createProfileFormTemplate;
            this.createProfileConnectionContent = module.createProfileConnectionContent;
            this.createProfileSettingsContent = module.createProfileSettingsContent;
        } catch (error) {
            console.error('Failed to load templates module:', error);
        }

        // Add profile panel HTML to body if not exists
        if (!document.getElementById('profile-panel-overlay')) {
            const panelHTML = this.createProfilePanelTemplate();
            document.body.insertAdjacentHTML('beforeend', panelHTML);
        }

        // Setup event listeners
        this.setupProfilePanelEventListeners();
    }

    setupProfilePanelEventListeners() {
        // Close button
        const closeBtn = document.getElementById('profile-panel-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeProfilePanel());
        }

        // Cancel button
        const cancelBtn = document.getElementById('profile-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.closeProfilePanel());
        }

        // Save button
        const saveBtn = document.getElementById('profile-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveProfile());
        }

        // Close on overlay click
        const overlay = document.getElementById('profile-panel-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target.id === 'profile-panel-overlay' && e.target === e.currentTarget) {
                    this.closeProfilePanel();
                }
            });
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const overlay = document.getElementById('profile-panel-overlay');
                if (overlay && overlay.classList.contains('active')) {
                    this.closeProfilePanel();
                }
            }
        });
    }

    async openProfilePanel(mode, type, parentId = null, data = null) {
        const overlay = document.getElementById('profile-panel-overlay');
        const form = document.getElementById('profile-form');
        const connectionContent = document.querySelector('.profile-connection-content');
        const settingsContent = document.querySelector('.profile-settings-content');

        // Populate General tab (existing form)
        if (form) {
            form.innerHTML = this.createProfileFormTemplate(mode, type, data);
        }

        // Populate Connection tab
        if (connectionContent) {
            connectionContent.innerHTML = this.createProfileConnectionContent(type, data);
        }

        // Populate Settings tab
        if (settingsContent) {
            settingsContent.innerHTML = this.createProfileSettingsContent(type, data);
        }

        // Setup tab switching
        this.setupProfileTabs();

        // Setup form functionality
        this.setupProfileTypeHandling();
        this.setupIconSelector();
        this.setupProfileFormHandlers(mode, type, parentId, data);

        // Show overlay
        overlay.classList.add('active');
    }

    setupIconSelector() {
        // Remove any existing icon selector listeners to avoid duplicates
        if (this.iconSelectorListeners) {
            this.iconSelectorListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
        }
        this.iconSelectorListeners = [];

        // Handle compact icon selector button clicks
        const handleButtonClick = (e) => {
            if (e.target.closest('.icon-selector-button')) {
                const button = e.target.closest('.icon-selector-button');
                const dropdown = button.parentElement.querySelector('.icon-dropdown');
                
                if (!dropdown) {
                    console.warn('Icon dropdown not found for button:', button);
                    return;
                }
                
                // Toggle dropdown
                const isActive = button.classList.contains('active');
                
                // Close all other dropdowns
                document.querySelectorAll('.icon-selector-button.active').forEach(btn => {
                    btn.classList.remove('active');
                });
                document.querySelectorAll('.icon-dropdown.active').forEach(dd => {
                    dd.classList.remove('active');
                });
                
                if (!isActive) {
                    button.classList.add('active');
                    dropdown.classList.add('active');
                    console.log('Opened icon dropdown for:', button.id);
                }
                
                e.stopPropagation();
            }
        };

        // Handle icon option clicks
        const handleIconClick = (e) => {
            if (e.target.classList.contains('icon-option')) {
                const icon = e.target.dataset.icon;
                const dropdown = e.target.closest('.icon-dropdown');
                
                if (!dropdown) {
                    console.warn('Icon dropdown not found for option:', e.target);
                    return;
                }
                
                const button = dropdown.parentElement.querySelector('.icon-selector-button');
                const currentIconSpan = button.querySelector('.current-icon');
                
                // Update the current icon display
                currentIconSpan.textContent = icon;
                
                // Update the hidden input value
                const isFolder = dropdown.id.includes('folder');
                const hiddenInput = document.getElementById(isFolder ? 'folder-icon' : 'profile-icon');
                if (hiddenInput) {
                    hiddenInput.value = icon;
                    console.log('Updated icon value:', icon, 'for', isFolder ? 'folder' : 'profile');
                } else {
                    console.warn('Hidden input not found for:', isFolder ? 'folder-icon' : 'profile-icon');
                }
                
                // Close dropdown
                button.classList.remove('active');
                dropdown.classList.remove('active');
                
                e.stopPropagation();
            }
        };

        // Close dropdowns when clicking outside
        const handleOutsideClick = (e) => {
            if (!e.target.closest('.icon-selector-compact')) {
                document.querySelectorAll('.icon-selector-button.active').forEach(btn => {
                    btn.classList.remove('active');
                });
                document.querySelectorAll('.icon-dropdown.active').forEach(dd => {
                    dd.classList.remove('active');
                });
            }
        };

        // Add event listeners and track them for cleanup
        document.addEventListener('click', handleButtonClick);
        document.addEventListener('click', handleIconClick);
        document.addEventListener('click', handleOutsideClick);
        
        this.iconSelectorListeners = [
            { element: document, event: 'click', handler: handleButtonClick },
            { element: document, event: 'click', handler: handleIconClick },
            { element: document, event: 'click', handler: handleOutsideClick }
        ];

        // Legacy icon selector support (for backward compatibility)
        const handleLegacyIconClick = (e) => {
            if (e.target.classList.contains('icon-option') && !e.target.closest('.icon-grid-compact')) {
                const icon = e.target.dataset.icon;
                const iconInput = e.target.closest('.icon-selector')?.querySelector('.icon-input');
                if (iconInput) {
                    iconInput.value = icon;
                }
            }
        };
        
        document.addEventListener('click', handleLegacyIconClick);
        this.iconSelectorListeners.push({ element: document, event: 'click', handler: handleLegacyIconClick });
    }

    setupProfileTypeHandling() {
        const typeSelect = document.getElementById('profile-type');
        if (!typeSelect) return;

        typeSelect.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            
            // Hide all type-specific groups and sections
            document.querySelectorAll('.local-shell-group, .ssh-group, .custom-group').forEach(group => {
                group.style.display = 'none';
            });

            // Hide SSH section entirely
            document.querySelectorAll('.profile-form-section.ssh-group').forEach(section => {
                section.style.display = 'none';
            });

            // Show relevant groups and sections
            if (selectedType === 'local') {
                document.querySelectorAll('.local-shell-group').forEach(group => {
                    group.style.display = 'block';
                });
            } else if (selectedType === 'ssh') {
                document.querySelectorAll('.ssh-group').forEach(group => {
                    group.style.display = 'block';
                });
                document.querySelectorAll('.profile-form-section.ssh-group').forEach(section => {
                    section.style.display = 'block';
                });
            } else if (selectedType === 'custom') {
                document.querySelectorAll('.custom-group').forEach(group => {
                    group.style.display = 'block';
                });
            }
        });
    }

    async loadShellsForForm() {
        try {
            const shells = await window.go.main.App.GetShellsForUI();
            const shellSelect = document.getElementById('profile-shell');
            
            if (shellSelect && shells) {
                shellSelect.innerHTML = shells.map(shell => 
                    `<option value="${shell.value}">${shell.displayName}</option>`
                ).join('');

                // Set selected value if editing
                if (this.editingProfile?.data?.shell) {
                    shellSelect.value = this.editingProfile.data.shell;
                }
            }
        } catch (error) {
            console.error('Failed to load shells for form:', error);
        }
    }

    closeProfilePanel() {
        const overlay = document.getElementById('profile-panel-overlay');
        overlay.classList.remove('active');
        this.profilePanelOpen = false;
        this.editingProfile = null;
        
        // Clean up icon selector event listeners
        if (this.iconSelectorListeners) {
            this.iconSelectorListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            this.iconSelectorListeners = [];
        }
    }

    async saveProfile() {
        if (!this.editingProfile) return;

        const { mode, type, parentId, data } = this.editingProfile;

        try {
            if (type === 'folder') {
                await this.saveFolderData(mode, data);
            } else {
                await this.saveProfileData(mode, data);
            }

            this.closeProfilePanel();
            await this.loadProfileTree();
            this.renderProfileTree();
            showNotification(`${type === 'folder' ? 'Folder' : 'Profile'} ${mode === 'edit' ? 'updated' : 'created'} successfully`, 'success');
        } catch (error) {
            console.error('Failed to save:', error);
            showNotification(`Failed to ${mode === 'edit' ? 'update' : 'create'} ${type}: ${error.message}`, 'error');
        }
    }

    async saveFolderData(mode, existingData) {
        const name = document.getElementById('folder-name').value.trim();
        const icon = document.getElementById('folder-icon').value.trim();

        if (!name) {
            throw new Error('Folder name is required');
        }

        if (mode === 'edit' && existingData) {
            // Update existing folder
            existingData.name = name;
            existingData.icon = icon;
            await window.go.main.App.UpdateProfileFolder(existingData);
        } else {
            // Create new folder
            const parentPath = this.editingProfile.parentId ? this.getFolderPath(this.editingProfile.parentId) : '';
            await window.go.main.App.CreateProfileFolderAPI(name, icon, parentPath);
        }
    }

    async saveProfileData(mode, existingData) {
        const name = document.getElementById('profile-name').value.trim();
        const icon = document.getElementById('profile-icon').value.trim();
        const profileType = document.getElementById('profile-type').value;
        const workingDir = document.getElementById('profile-workdir').value.trim();

        if (!name) {
            throw new Error('Profile name is required');
        }

        let shell = '';
        let sshConfig = null;

        if (profileType === 'local') {
            shell = document.getElementById('profile-shell').value;
        } else if (profileType === 'ssh') {
            const host = document.getElementById('ssh-host').value.trim();
            const port = parseInt(document.getElementById('ssh-port').value) || 22;
            const username = document.getElementById('ssh-username').value.trim();
            const password = document.getElementById('ssh-password').value;
            const keyPath = document.getElementById('ssh-keypath').value.trim();

            if (!host || !username) {
                throw new Error('SSH host and username are required');
            }

            sshConfig = { host, port, username, password, keyPath };
        } else if (profileType === 'custom') {
            shell = document.getElementById('custom-command').value.trim();
            if (!shell) {
                throw new Error('Custom command is required');
            }
        }

        if (mode === 'edit' && existingData) {
            // Update existing profile
            existingData.name = name;
            existingData.icon = icon;
            existingData.type = profileType;
            existingData.shell = shell;
            existingData.workingDir = workingDir;
            existingData.sshConfig = sshConfig;
            await window.go.main.App.UpdateProfile(existingData);
        } else {
            // Create new profile
            const folderPath = this.editingProfile.parentId ? this.getFolderPath(this.editingProfile.parentId) : '';
            const profile = await window.go.main.App.CreateProfileAPI(name, profileType, shell, icon, folderPath);
            
            if (sshConfig) {
                profile.sshConfig = sshConfig;
                await window.go.main.App.UpdateProfile(profile);
            }
            
            if (workingDir) {
                profile.workingDir = workingDir;
                await window.go.main.App.UpdateProfile(profile);
            }
        }
    }

    async updateFolderExpandedState(folderId, expanded) {
        try {
            const folder = await window.go.main.App.GetProfileFolder(folderId);
            folder.expanded = expanded;
            await window.go.main.App.UpdateProfileFolder(folder);
        } catch (error) {
            console.error('Failed to update folder state:', error);
        }
    }

    setupProfileUpdateListener() {
        // Listen for profile updates from file watcher
        if (window.runtime && window.runtime.EventsOn) {
            window.runtime.EventsOn('profile:updated', (data) => {
                console.log('Profile update event received:', data);
                // Reload and re-render the profile tree
                this.loadProfileTree().then(() => {
                    this.renderProfileTree();
                });
            });
        }
    }

    // Helper methods
    getProfileById(profileId) {
        const findProfile = (nodes) => {
            for (const node of nodes) {
                if (node.type === 'profile' && node.id === profileId) {
                    return node.profile;
                }
                if (node.children) {
                    const found = findProfile(node.children);
                    if (found) return found;
                }
            }
            return null;
        };
        
        const profile = findProfile(this.profileTree);
        if (!profile) {
            console.warn(`Profile with ID ${profileId} not found in tree`);
        }
        return profile;
    }

    async toggleFavorite(profileId) {
        try {
            await window.go.main.App.ToggleFavoriteAPI(profileId);
            await this.loadProfileTree();
            this.renderProfileTree();
            showNotification('Favorite status updated', 'success');
        } catch (error) {
            console.error('Failed to toggle favorite:', error);
            showNotification('Failed to update favorite', 'error');
        }
    }

    setupProfileTabs() {
        const tabs = document.querySelectorAll('.profile-tab');
        const panes = document.querySelectorAll('.profile-tab-pane');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;

                // Remove active class from all tabs and panes
                tabs.forEach(t => t.classList.remove('active'));
                panes.forEach(p => p.classList.remove('active'));

                // Add active class to clicked tab and corresponding pane
                tab.classList.add('active');
                const targetPane = document.getElementById(`profile-tab-${targetTab}`);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });
    }

    setupProfileFormHandlers(mode, type, parentId, data) {
        // Load shells for profile forms
        if (type === 'profile') {
            this.loadShellsForForm();
        }

        // Setup save/cancel handlers
        const saveBtn = document.getElementById('profile-save');
        const cancelBtn = document.getElementById('profile-cancel');

        if (saveBtn) {
            saveBtn.onclick = () => this.handleProfileSave(mode, type, parentId, data);
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => this.closeProfilePanel();
        }

        // Setup SSH key browse button
        const browseSSHKeyBtn = document.getElementById('browse-ssh-key');
        if (browseSSHKeyBtn) {
            browseSSHKeyBtn.addEventListener('click', async () => {
                try {
                    const selectedPath = await window.go.main.App.SelectSSHPrivateKey();
                    if (selectedPath) {
                        const sshKeyInput = document.getElementById('ssh-keypath');
                        if (sshKeyInput) {
                            sshKeyInput.value = selectedPath;
                        }
                    }
                } catch (error) {
                    console.error('Error selecting SSH private key:', error);
                    showNotification(`Failed to open file selector: ${error.message}`, 'error');
                }
            });
        }

        // Set editing state
        this.profilePanelOpen = true;
        this.editingProfile = { mode, type, parentId, data };

        // Focus first input
        const firstInput = document.querySelector('#profile-form input, #profile-form select');
        if (firstInput) {
            firstInput.focus();
        }
    }

    async handleProfileSave(mode, type, parentId, data) {
        try {
            if (type === 'folder') {
                await this.saveFolderData(mode, data);
            } else {
                await this.saveProfileData(mode, data);
            }

            this.closeProfilePanel();
            await this.loadProfileTree();
            this.renderProfileTree();
            showNotification(`${type === 'folder' ? 'Folder' : 'Profile'} ${mode === 'edit' ? 'updated' : 'created'} successfully`, 'success');
        } catch (error) {
            console.error('Failed to save:', error);
            showNotification(`Failed to ${mode === 'edit' ? 'update' : 'create'} ${type}: ${error.message}`, 'error');
        }
    }
}
