// Enhanced Sidebar management module with profile tree support
import { updateStatus, showNotification } from './utils.js';
import { modal } from '../components/Modal.js';
import { LiveSearch } from '../components/LiveSearch.js';

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
        this.virtualFolderClickHandler = null; // For proper event listener cleanup
        this.profileLiveSearch = null; // Live search for profiles
    }

    async initSidebar() {
        console.log('🚀 Initializing sidebar...');
        this.setupSidebarInteractions();
        await this.setupProfilePanel();
        await this.loadProfileTree();
        this.renderProfileTree();
        this.setupProfileUpdateListener();
        
        // Ensure profiles view is properly set up for initial load
        // This will be called by the activity bar manager when the initial view is set
        this.isReadyForLiveSearch = true;
        
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
            // Add timeout wrapper function
            const withTimeout = (promise, timeoutMs = 10000) => {
                return Promise.race([
                    promise,
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
                    )
                ]);
            };

            // Load regular profile tree with timeout protection
            console.log('Loading profile tree...');
            this.profileTree = await withTimeout(window.go.main.App.GetProfileTreeAPI());
            console.log('Loaded profile tree:', this.profileTree);

            // Safety check for null/undefined tree
            if (!this.profileTree) {
                console.warn('Profile tree is null/undefined, initializing as empty array');
                this.profileTree = [];
            }

            // Populate expandedFolders set based on loaded tree
            this.expandedFolders.clear(); // Clear existing state
            const populateExpanded = (nodes) => {
                if (!nodes || !Array.isArray(nodes)) return;
                for (const node of nodes) {
                    if (node && node.type === 'folder' && node.expanded) {
                        this.expandedFolders.add(node.id);
                    }
                    if (node && node.children) {
                        populateExpanded(node.children);
                    }
                }
            };
            populateExpanded(this.profileTree);
            console.log('Initialized expanded folders:', Array.from(this.expandedFolders));
            
            // Load virtual folders with timeout protection
            try {
                this.virtualFolders = await withTimeout(window.go.main.App.GetVirtualFoldersAPI(), 5000);
                console.log('Loaded virtual folders:', this.virtualFolders);
            } catch (vfError) {
                console.error('Failed to load virtual folders:', vfError);
                this.virtualFolders = [];
            }
            
            // Load metrics for display with timeout protection
            try {
                this.metrics = await withTimeout(window.go.main.App.GetMetricsAPI(), 5000);
                console.log('Loaded metrics:', this.metrics);
            } catch (metricsError) {
                console.error('Failed to load metrics:', metricsError);
                this.metrics = {};
            }
            
        } catch (error) {
            console.error('Failed to load profile tree:', error);
            showNotification('Failed to load profiles - check console for details', 'error');
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
                showNotification('Profile not found', 'error');
                return;
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
                newTab = await tabsManager.createNewTab(null, profile.sshConfig, profileId);
            } else {
                console.log('Creating local tab with shell:', profile.shell);
                newTab = await tabsManager.createNewTab(profile.shell || null, null, profileId);
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
            
            showNotification(`Connected to ${profileName}`, 'success');
            
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

        let targetFolderID = '';
        
        if (dropTarget && dropTarget.dataset.type === 'folder') {
            // Dropped on a folder - use the folder's ID
            targetFolderID = dropTarget.dataset.id;
        } else if (isRootDrop) {
            // Dropped on root - empty string means root level
            targetFolderID = '';
        } else {
            return; // Invalid drop target
        }

        // Prevent dropping folder into itself or its descendants
        if (this.draggedItem.type === 'folder' && this.draggedItem.id === targetFolderID) {
            showNotification('Cannot move folder into itself', 'error');
            return;
        }

        try {
            if (this.draggedItem.type === 'profile') {
                // Use new ID-based profile move API
                await window.go.main.App.MoveProfileByIDAPI(this.draggedItem.id, targetFolderID);
                showNotification('Profile moved successfully', 'success');
            } else if (this.draggedItem.type === 'folder') {
                // Use new ID-based folder move API
                await window.go.main.App.MoveFolderAPI(this.draggedItem.id, targetFolderID);
                showNotification('Folder moved successfully', 'success');
            }

            // Reload and re-render the tree
            await this.loadProfileTree();
            this.renderProfileTree();
            
        } catch (error) {
            console.error('Failed to move item:', error);
            showNotification(`Failed to move item: ${error.message || error}`, 'error');
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
            showNotification('Profile not found', 'error');
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
        try {
            // Get profile name for the confirmation dialog
            const profile = this.getProfileById(profileId);
            const profileName = profile ? profile.name : 'this profile';
            
            // Use the universal modal for confirmation
            const result = await modal.confirmDelete(profileName, 'profile');
            
            if (result !== 'confirm') {
                return; // User cancelled
            }

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

    async deleteFolder(folderId, deleteContents = false) {
        try {
            // Get folder name for the confirmation dialog
            const folder = await window.go.main.App.GetProfileFolder(folderId);
            const folderName = folder ? folder.name : 'this folder';
            
            // If deleteContents parameter is provided, use it directly (called from context menu)
            // Otherwise, show the modal to get user choice
            let shouldDeleteContents = deleteContents;
            
            if (arguments.length === 1) {
                // Called without deleteContents parameter, show modal
                const result = await modal.show({
                    title: 'Delete Folder',
                    message: `What would you like to do with the profiles in "${folderName}"?`,
                    icon: '🗑️',
                    buttons: [
                        { text: 'Cancel', style: 'secondary', action: 'cancel' },
                        { text: 'Move to Root', style: 'primary', action: 'move' },
                        { text: 'Delete All', style: 'danger', action: 'delete-all' }
                    ]
                });
                
                if (result === 'cancel') {
                    return; // User cancelled
                }
                
                shouldDeleteContents = result === 'delete-all';
            }

            // Use the appropriate API based on user choice
            if (shouldDeleteContents) {
                await window.go.main.App.DeleteProfileFolderWithContentsAPI(folderId);
            } else {
                await window.go.main.App.DeleteProfileFolderAPI(folderId);
            }
            
            await this.loadProfileTree();
            this.renderProfileTree();
            
            if (shouldDeleteContents) {
                showNotification('Folder and all contents deleted', 'success');
            } else {
                showNotification('Folder deleted, profiles moved to root', 'success');
            }
            
        } catch (error) {
            console.error('Failed to delete folder:', error);
            showNotification('Failed to delete folder: ' + error.message, 'error');
        }
    }

    renderProfileTree() {
        const sidebarContent = document.getElementById('sidebar-content');
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
        console.log('🔧 Setting up virtual folder interactions');
        
        // Remove any existing virtual folder click handler to prevent duplicates
        if (this.virtualFolderClickHandler) {
            document.removeEventListener('click', this.virtualFolderClickHandler);
        }
        
        // Create a new handler and store reference for cleanup
        this.virtualFolderClickHandler = (e) => {
            if (e.target.closest('.virtual-folder')) {
                this.handleVirtualFolderClick(e);
            }
        };
        
        // Add the new handler
        document.addEventListener('click', this.virtualFolderClickHandler);
        
        // Load profile counts for virtual folders
        this.virtualFolders?.forEach(async vf => {
            try {
                console.log(`🔧 Loading count for virtual folder: ${vf.name} (${vf.id})`);
                const profiles = await window.go.main.App.GetVirtualFolderProfilesAPI(vf.id);
                const countElement = document.querySelector(`[data-folder-id="${vf.id}"]`);
                if (countElement) {
                    countElement.textContent = `(${profiles.length})`;
                    console.log(`🔧 Updated count for ${vf.name}: ${profiles.length}`);
                } else {
                    console.warn(`🔧 Count element not found for virtual folder: ${vf.id}`);
                }
            } catch (error) {
                console.error(`Failed to load count for virtual folder ${vf.id}:`, error);
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
        if (!vf) {
            console.error('Virtual folder not found:', vfId);
            return;
        }

        console.log(`📁 Showing virtual folder content: ${vf.name} with ${profiles.length} profiles`);
        
        const sidebarContent = document.getElementById('sidebar-content');
        if (!sidebarContent) {
            console.error('Sidebar content element not found');
            return;
        }
        
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
        console.log(`📁 Virtual folder content rendered: ${profiles.length} profiles`);
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
                    <input type="text" id="search-input" placeholder="Search profiles..." class="search-input"
                    autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
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
        
        // Extract searchable data for live search
        const sshConfig = profile.profile?.sshConfig || {};
        const host = sshConfig.host || '';
        const username = sshConfig.username || '';
        const tags = profile.profile?.tags?.join(' ') || '';
        
        return `
            <div class="tree-item" 
                 data-id="${profile.id}" 
                 data-type="profile" 
                 data-name="${profile.name}" 
                 data-host="${host}" 
                 data-username="${username}" 
                 data-tags="${tags}" 
                 draggable="true" 
                 title="${tooltipText}">
                <div class="tree-item-content" style="padding-left: ${(level + 1) * 16}px">
                    <span class="tree-item-icon">${profile.icon}</span>
                    <span class="tree-item-text">${profile.name}</span>
                    ${favoriteIcon}
                    <span class="tree-item-type">${profileType}</span>
                </div>
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

        // NOTE: Save button handler is now only set up in setupProfileFormHandlers to avoid duplicates

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
        if (overlay) {
            overlay.classList.remove('active');
        }

        // Clear editing state
        this.profilePanelOpen = false;
        this.editingProfile = null;

        // Clean up icon selector listeners
        if (this.iconSelectorListeners) {
            this.iconSelectorListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            this.iconSelectorListeners = [];
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
            // Create new folder using ID-based reference instead of path-based
            const parentFolderId = this.editingProfile.parentId || '';
            await window.go.main.App.CreateProfileFolderWithParentIDAPI(name, icon, parentFolderId);
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

            const allowKeyAutoDiscovery = document.getElementById('ssh-auto-discover').checked;
            sshConfig = { host, port, username, password, keyPath, allowKeyAutoDiscovery };
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
            // Create new profile using ID-based reference instead of path-based
            const parentFolderId = this.editingProfile.parentId || '';
            const profile = await window.go.main.App.CreateProfileWithFolderIDAPI(name, profileType, shell, icon, parentFolderId);
            
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

    initializeProfileLiveSearch() {
        if (this.profileLiveSearch) {
            this.profileLiveSearch.destroy();
        }
        
        this.profileLiveSearch = new LiveSearch({
            containerSelector: '#sidebar-content',
            itemSelector: '.tree-item[data-type="profile"], .virtual-profile[data-type="profile"]',
            searchIndicatorClass: 'profile-search-indicator',
            clearManagerCallback: () => this.clearProfileSearch(),
            getItemData: (item) => {
                return {
                    name: item.dataset.name || '',
                    text: item.textContent || '',
                    tags: item.dataset.tags || '',
                    host: item.dataset.host || '',
                    username: item.dataset.username || ''
                };
            },
            onSearch: (query) => {
                if (query.trim() === '') {
                    this.clearProfileSearch();
                } else {
                    this.performProfileSearch(query);
                }
            }
        });
    }

    clearProfileSearch() {
        console.log('🔍 Clearing profile search and restoring tree structure');
        
        // Restore proper tree structure by respecting folder expanded states
        this.restoreProfileTreeStructure();
        
        // Clear the search state
        if (this.profileLiveSearch) {
            this.profileLiveSearch.clearSearch();
        }
    }

    restoreProfileTreeStructure() {
        const container = document.querySelector('#sidebar-content');
        if (!container) return;
        
        console.log('🔍 Restoring profile tree structure...');
        
        // Restore original expanded state if we have it
        if (this.originalExpandedState) {
            console.log('🔍 Restoring original expanded state');
            this.expandedFolders = new Set(this.originalExpandedState);
            this.originalExpandedState = null; // Clear the stored state
        }
        
        console.log('🔍 Current expanded folders:', Array.from(this.expandedFolders));
        
        // Show all items first, then handle visibility based on folder state
        const allItems = container.querySelectorAll('.tree-item, .tree-folder');
        allItems.forEach(item => {
            item.style.display = '';
        });
        
        // Handle folders based on their expanded/collapsed state
        const folderItems = container.querySelectorAll('.tree-item[data-type="folder"]');
        console.log('🔍 Found folders:', folderItems.length);
        
        folderItems.forEach(folder => {
            // Always show the folder itself
            folder.style.display = '';
            
            // Check if this folder is expanded
            const folderId = folder.dataset.id;
            const isExpanded = this.expandedFolders.has(folderId);
            const folderContainer = folder.closest('.tree-folder');
            
            console.log(`🔍 Folder ${folderId}: expanded=${isExpanded}`);
            
            if (folderContainer) {
                if (isExpanded) {
                    // Ensure folder is properly expanded in DOM
                    folderContainer.classList.add('expanded');
                    const toggle = folderContainer.querySelector('.tree-folder-toggle');
                    if (toggle) {
                        toggle.textContent = '▼';
                    }
                } else {
                    // Ensure folder is properly collapsed in DOM
                    folderContainer.classList.remove('expanded');
                    const toggle = folderContainer.querySelector('.tree-folder-toggle');
                    if (toggle) {
                        toggle.textContent = '▶';
                    }
                    // Hide children of collapsed folders
                    this.hideChildrenOfCollapsedFolder(folder);
                }
            }
        });
        
        console.log('🔍 Profile tree structure restored');
    }

    hideChildrenOfCollapsedFolder(folderElement) {
        // Find the children container for this folder
        let current = folderElement.nextElementSibling;
        const folderLevel = parseInt(folderElement.dataset.level || '0');
        
        // Hide all items that are children of this folder (higher level number)
        while (current) {
            const currentLevel = parseInt(current.dataset.level || '0');
            
            // If we encounter an item at the same level or lower, we've moved out of this folder's children
            if (currentLevel <= folderLevel) {
                break;
            }
            
            // Hide this child item
            current.style.display = 'none';
            current = current.nextElementSibling;
        }
    }

    performProfileSearch(query) {
        const container = document.querySelector('#sidebar-content');
        if (!container) return;
        
        console.log('🔍 Performing profile search for query:', query);
        
        // Step 1: Find matching profiles from our in-memory data
        const matchingProfiles = this.findMatchingProfilesInData(query);
        console.log('🔍 Found matching profiles in data:', matchingProfiles.length);
        
        // Step 2: Temporarily expand folders that contain matching profiles
        const foldersToExpand = new Set();
        matchingProfiles.forEach(profile => {
            if (profile.folderId) {
                foldersToExpand.add(profile.folderId);
                console.log('🔍 Need to expand folder for profile:', profile.name, 'in folder:', profile.folderId);
            }
        });
        
        // Step 3: Expand required folders temporarily and ensure all profiles are visible
        this.temporarilyExpandFoldersForSearch(foldersToExpand);
        
        // Step 4: Wait for DOM updates and then search the visible elements
        setTimeout(() => {
            this.searchVisibleProfileElements(query, matchingProfiles);
        }, 50); // Small delay to ensure DOM is updated
    }

    findMatchingProfilesInData(query) {
        const matchingProfiles = [];
        const queryLower = query.toLowerCase();
        
        // Search through the in-memory profile tree data
        const searchInNodes = (nodes) => {
            nodes.forEach(node => {
                if (node.type === 'profile' && node.profile) {
                    const profile = node.profile;
                    const sshConfig = profile.sshConfig || {};
                    
                    // Check for matches in various fields
                    const matches = 
                        profile.name.toLowerCase().includes(queryLower) ||
                        (profile.description || '').toLowerCase().includes(queryLower) ||
                        (sshConfig.host || '').toLowerCase().includes(queryLower) ||
                        (sshConfig.username || '').toLowerCase().includes(queryLower) ||
                        (profile.tags || []).some(tag => tag.toLowerCase().includes(queryLower)) ||
                        (profile.type || '').toLowerCase().includes(queryLower);
                    
                    if (matches) {
                        matchingProfiles.push({
                            id: profile.id,
                            name: profile.name,
                            folderId: profile.folderId
                        });
                    }
                }
                
                // Recursively search in children
                if (node.children && node.children.length > 0) {
                    searchInNodes(node.children);
                }
            });
        };
        
        if (this.profileTree) {
            searchInNodes(this.profileTree);
        }
        
        return matchingProfiles;
    }

    temporarilyExpandFoldersForSearch(foldersToExpand) {
        // Store original expanded state for restoration later
        if (!this.originalExpandedState) {
            this.originalExpandedState = new Set(this.expandedFolders);
        }
        
        // Temporarily expand required folders
        foldersToExpand.forEach(folderId => {
            if (!this.expandedFolders.has(folderId)) {
                console.log('🔍 Temporarily expanding folder:', folderId);
                this.expandedFolders.add(folderId);
                
                // Update DOM to reflect expansion
                const folderElement = document.querySelector(`.tree-folder .tree-item[data-id="${folderId}"]`)?.closest('.tree-folder');
                if (folderElement) {
                    folderElement.classList.add('expanded');
                    const toggle = folderElement.querySelector('.tree-folder-toggle');
                    if (toggle) {
                        toggle.textContent = '▼';
                    }
                }
            }
        });
    }

    searchVisibleProfileElements(query, matchingProfiles) {
        const container = document.querySelector('#sidebar-content');
        if (!container) return;
        
        const profileItems = container.querySelectorAll('.tree-item[data-type="profile"], .virtual-profile[data-type="profile"]');
        const folderItems = container.querySelectorAll('.tree-item[data-type="folder"]');
        let matchCount = 0;
        
        // Create a set of matching profile IDs for quick lookup
        const matchingProfileIds = new Set(matchingProfiles.map(p => p.id));
        
        // Search profiles in DOM
        profileItems.forEach(item => {
            const profileId = item.dataset.id;
            const matches = matchingProfileIds.has(profileId);
            
            if (matches) {
                item.style.display = '';
                matchCount++;
                
                // Show parent folders of matching profiles
                let parent = item.parentElement;
                while (parent && parent !== container) {
                    if (parent.classList.contains('tree-folder')) {
                        const folderItem = parent.querySelector('.tree-item[data-type="folder"]');
                        if (folderItem) {
                            folderItem.style.display = '';
                        }
                        parent.style.display = '';
                    }
                    parent = parent.parentElement;
                }
            } else {
                item.style.display = 'none';
            }
        });
        
        // Handle folders - show if they contain visible children or are on the path to matching profiles
        folderItems.forEach(folder => {
            const folderContainer = folder.closest('.tree-folder');
            if (folderContainer) {
                const visibleChildren = folderContainer.querySelectorAll('.tree-item[data-type="profile"]:not([style*="display: none"])');
                if (visibleChildren.length > 0) {
                    folder.style.display = '';
                    folderContainer.style.display = '';
                } else {
                    folder.style.display = 'none';
                }
            }
        });
        
        console.log('🔍 Profile search completed. Matches found:', matchCount);
        this.profileLiveSearch.updateSearchResults(matchCount);
    }

    // New view methods for activity bar integration
    showProfilesView() {
        console.log('📋 SidebarManager: Showing profiles view (isReadyForLiveSearch:', this.isReadyForLiveSearch, ')');
        const sidebarContent = document.getElementById('sidebar-content');
        if (!sidebarContent) {
            console.error('📋 SidebarManager: Sidebar content element not found');
            return;
        }
        
        // Check if profiles view is already showing
        const hasProfileContent = sidebarContent.querySelector('.tree-item[data-type="profile"], .virtual-profile[data-type="profile"]');
        const hasFilesContent = sidebarContent.querySelector('.remote-explorer-container, .remote-explorer-placeholder');
        
        console.log('📋 SidebarManager: Current content check - hasProfileContent:', !!hasProfileContent, 'hasFilesContent:', !!hasFilesContent);
        
        // If we already have profile content and no files content, just ensure live search is set up
        if (hasProfileContent && !hasFilesContent && this.isReadyForLiveSearch) {
            console.log('📋 SidebarManager: Profiles view already showing, ensuring live search is active');
            this.setupLiveSearchForCurrentContent();
            return;
        }
        
        // Clear any existing content first to prevent mixing
        sidebarContent.innerHTML = '';
        sidebarContent.className = ''; // Clear any classes from other views
        console.log('📋 SidebarManager: Sidebar content cleared');
        
        // Force reload profile tree data to ensure it's fresh (including virtual folders)
        this.loadProfileTree().then(() => {
            // Render the profile tree
            this.renderProfileTree();
            console.log('📋 SidebarManager: Profile tree rendered');
            
            // Initialize/re-initialize and enable profile live search after rendering
            this.setupLiveSearchForCurrentContent();
            
        }).catch(error => {
            console.error('📋 SidebarManager: Failed to load profile tree:', error);
            // Render with existing data as fallback
            this.renderProfileTree();
            
            // Still try to setup interactions and search
            this.setupLiveSearchForCurrentContent();
        });
    }

    setupLiveSearchForCurrentContent() {
        setTimeout(() => {
            console.log('📋 SidebarManager: Setting up live search for current content');
            console.log('📋 SidebarManager: DOM ready check - profiles found:', document.querySelectorAll('.tree-item[data-type="profile"]').length);
            
            this.initializeProfileLiveSearch();
            if (this.profileLiveSearch) {
                this.profileLiveSearch.enable();
                console.log('📋 SidebarManager: Profile live search enabled successfully');
            } else {
                console.error('📋 SidebarManager: Failed to initialize profile live search');
            }
            
            // Setup virtual folder interactions after rendering
            console.log('📋 SidebarManager: Setting up virtual folder interactions after render');
            this.setupVirtualFolderInteractions();
        }, 200); // Increased timeout to 200ms for better reliability
    }

    showFilesView() {
        console.log('📁 SidebarManager: Showing files view');
        
        // Disable profile live search when switching to files view
        if (this.profileLiveSearch) {
            this.profileLiveSearch.disable();
        }
        
        // Clear the sidebar content first to prevent conflicts
        const sidebarContent = document.getElementById('sidebar-content');
        if (sidebarContent) {
            sidebarContent.innerHTML = '';
            console.log('📁 SidebarManager: Sidebar content cleared for files view');
        }
        
        // Trigger remote explorer to handle the Files view
        if (window.remoteExplorerManager) {
            console.log('📁 SidebarManager: Triggering remote explorer activation');
            window.remoteExplorerManager.handlePanelBecameActive();
        } else {
            // Fallback if remote explorer isn't available yet
            console.log('📁 SidebarManager: Remote explorer not available, showing placeholder');
            if (sidebarContent) {
                sidebarContent.innerHTML = `
                    <div class="remote-explorer-placeholder">
                        <div class="placeholder-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="color: var(--text-secondary);">
                                <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                                <path d="M4,8V18H20V8H4M6,10H8V12H6V10M10,10H18V12H10V10M6,14H8V16H6V14M10,14H18V16H10V14Z"/>
                            </svg>
                        </div>
                        <div class="placeholder-title">Remote File Explorer</div>
                        <div class="placeholder-message">
                            Initializing file explorer...
                        </div>
                    </div>
                `;
            }
        }
    }

    // Called when the sidebar switches away from Profiles view
    hideProfilesView() {
        console.log('📋 SidebarManager: Hiding profiles view');
        
        // Disable profile live search when hiding profiles view
        if (this.profileLiveSearch) {
            this.profileLiveSearch.disable();
        }
    }

    // Called when the sidebar switches away from Files view
    hideFilesView() {
        if (window.remoteExplorerManager) {
            // Use the background session management instead of full cleanup
            window.remoteExplorerManager.handlePanelBecameHidden();
        }
    }

    // Method for complete cleanup (called on app shutdown or similar)
    async forceCleanupFilesView() {
        if (window.remoteExplorerManager) {
            await window.remoteExplorerManager.forceCleanup();
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

    async showProfileProperties(profileId, treeItem) {
        try {
            // Get profile data
            const profile = this.getProfileById(profileId);
            if (!profile) {
                showNotification('Profile not found', 'error');
                return;
            }

            // Build properties info
            let propertiesContent = `
                <div class="properties-section">
                    <h4>General Information</h4>
                    <div class="property-item">
                        <strong>Name:</strong> ${profile.name || 'Unknown'}
                    </div>
                    <div class="property-item">
                        <strong>Type:</strong> ${(profile.type || 'local').toUpperCase()}
                    </div>
                    <div class="property-item">
                        <strong>Icon:</strong> ${profile.icon || '🖥️'}
                    </div>
                    <div class="property-item">
                        <strong>Favorite:</strong> ${profile.isFavorite ? 'Yes' : 'No'}
                    </div>
                </div>
            `;

            if (profile.type === 'ssh' && profile.sshConfig) {
                propertiesContent += `
                    <div class="properties-section">
                        <h4>SSH Configuration</h4>
                        <div class="property-item">
                            <strong>Host:</strong> ${profile.sshConfig.host || 'N/A'}
                        </div>
                        <div class="property-item">
                            <strong>Port:</strong> ${profile.sshConfig.port || 22}
                        </div>
                        <div class="property-item">
                            <strong>Username:</strong> ${profile.sshConfig.username || 'N/A'}
                        </div>
                        <div class="property-item">
                            <strong>Key Path:</strong> ${profile.sshConfig.keyPath || 'Not specified'}
                        </div>
                        <div class="property-item">
                            <strong>Auto-discover Keys:</strong> ${profile.sshConfig.allowKeyAutoDiscovery ? 'Yes' : 'No'}
                        </div>
                    </div>
                `;
            } else if (profile.type === 'local' || profile.type === 'custom') {
                propertiesContent += `
                    <div class="properties-section">
                        <h4>Shell Configuration</h4>
                        <div class="property-item">
                            <strong>Shell/Command:</strong> ${profile.shell || 'Default shell'}
                        </div>
                    </div>
                `;
            }

            if (profile.workingDir) {
                propertiesContent += `
                    <div class="properties-section">
                        <h4>Working Directory</h4>
                        <div class="property-item">
                            <strong>Path:</strong> ${profile.workingDir}
                        </div>
                    </div>
                `;
            }

            propertiesContent += `
                <div class="properties-section">
                    <h4>Usage Statistics</h4>
                    <div class="property-item">
                        <strong>Usage Count:</strong> ${profile.usageCount || 0}
                    </div>
                    <div class="property-item">
                        <strong>Last Used:</strong> ${profile.lastUsed ? new Date(profile.lastUsed).toLocaleString() : 'Never'}
                    </div>
                    <div class="property-item">
                        <strong>Created:</strong> ${profile.createdAt ? new Date(profile.createdAt).toLocaleString() : 'Unknown'}
                    </div>
                </div>
            `;

            // Show properties using Modal.js
            await modal.show({
                title: `${profile.name} Properties`,
                content: propertiesContent,
                icon: '⚙️',
                buttons: [
                    { text: 'Edit', style: 'primary', action: 'edit' },
                    { text: 'Close', style: 'secondary', action: 'close' }
                ]
            }).then(result => {
                if (result === 'edit') {
                    this.editProfile(profileId);
                }
            });

        } catch (error) {
            console.error('Error showing profile properties:', error);
            showNotification('Failed to show profile properties', 'error');
        }
    }
}
