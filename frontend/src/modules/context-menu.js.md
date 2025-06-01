# frontend/src/modules/context-menu.js Analysis

## Overview
Comprehensive context menu management module with **1,150 lines** handling terminal, sidebar, tab, and file explorer context menus. This module manages complex contextual actions across multiple UI components and demonstrates tight coupling between different application areas.

## 📊 Functional Scope Analysis

### **Context Menu Types Managed**
- **Terminal Context Menu**: Copy, paste, select all, clear, scroll operations (Lines 1-300)
- **Sidebar Context Menu**: Profile/folder operations (create, edit, delete, duplicate) (Lines 300-600)
- **Tab Context Menu**: Tab lifecycle operations (reconnect, close, duplicate) (Lines 600-800)
- **File Explorer Context Menu**: File operations (open, download, upload, delete) (Lines 800-1150)

### **Cross-Cutting Responsibilities**
```js
export class ContextMenuManager {
    constructor(terminalManager, remoteExplorerManager = null) {
        this.terminalManager = terminalManager;           // Terminal coupling
        this.remoteExplorerManager = remoteExplorerManager; // File explorer coupling
        this.activeMenu = null;                           // Menu state
        this.currentTarget = null;                        // Context target
        this.selectedSidebarItem = null;                 // Sidebar coupling
        this.currentTab = null;                           // Tab system coupling
        this.currentTabData = null;                       // Tab state coupling
        this.currentFileItem = null;                      // File system coupling
        this.currentFileData = null;                      // File state coupling
        this.selectToCopyEnabled = false;                 // Settings coupling
    }
}
```

## 🚨 Critical Architectural Issues

### 1. **Multi-Domain Coupling** 🔴 CRITICAL
```js
// PROBLEMATIC: Single class managing 4+ different UI domains
class ContextMenuManager {
    // Terminal domain
    showTerminalContextMenu(event) { /* Terminal-specific logic */ }
    updateTerminalMenuItems(menu) { /* Terminal state checks */ }
    handleCopy() { /* Terminal selection handling */ }
    handlePaste() { /* Terminal input handling */ }
    
    // Sidebar domain  
    showSidebarContextMenu(event, treeItem) { /* Profile tree logic */ }
    updateSidebarMenuItems(menu, treeItem) { /* Profile state checks */ }
    handleEdit() { /* Profile editing logic */ }
    handleDelete() { /* Profile deletion logic */ }
    
    // Tab domain
    showTabContextMenu(event, tabElement, tabData) { /* Tab management logic */ }
    handleTabReconnect() { /* SSH reconnection logic */ }
    handleTabClose() { /* Tab lifecycle logic */ }
    
    // File explorer domain
    showFileExplorerItemContextMenu(event, fileItem, fileData) { /* File operations */ }
    handleFileDownload() { /* File transfer logic */ }
    handleFileUpload() { /* Upload management */ }
}
```

### 2. **Complex Conditional Menu Building** 🔴 CRITICAL
```js
updateSidebarMenuItems(menu, treeItem) {
    // 100+ lines of complex conditional logic
    const itemType = treeItem.dataset.type;
    const itemId = treeItem.dataset.id;
    const isProfile = itemType === 'profile';
    const isFolder = itemType === 'folder';
    const isFavorite = treeItem.classList.contains('favorite');
    
    // Complex nested conditions for menu item visibility
    if (isProfile) {
        menu.querySelector('[data-action="connect"]').style.display = 'block';
        menu.querySelector('[data-action="edit"]').style.display = 'block';
        menu.querySelector('[data-action="duplicate"]').style.display = 'block';
        menu.querySelector('[data-action="delete"]').style.display = 'block';
        menu.querySelector('[data-action="properties"]').style.display = 'block';
        
        // More complex conditions...
        if (isFavorite) {
            menu.querySelector('[data-action="toggle-favorite"]').textContent = 'Remove from Favorites';
        } else {
            menu.querySelector('[data-action="toggle-favorite"]').textContent = 'Add to Favorites';
        }
    } else if (isFolder) {
        // Different set of menu items for folders
        menu.querySelector('[data-action="create-profile"]').style.display = 'block';
        menu.querySelector('[data-action="create-folder"]').style.display = 'block';
        // ... more conditional logic
    }
    
    // Similar complex logic for other menu types
}
```

### 3. **Settings Integration Complexity** 🟠 HIGH
```js
async loadContextMenuSettings() {
    try {
        this.selectToCopyEnabled = await window.go.main.App.GetSelectToCopyEnabled();
    } catch (error) {
        console.error('Error loading context menu settings:', error);
        this.selectToCopyEnabled = false;
    }
}

bindTerminalEvents() {
    // Complex conditional event binding based on settings
    if (this.selectToCopyEnabled) {
        // Select-to-copy mode: different event handlers
        this.terminalMouseUpHandler = async (e) => {
            // Auto-copy on selection logic
        };
        this.terminalContextMenuHandler = async (e) => {
            // Right-click to paste logic
        };
    } else {
        // Standard context menu mode: different handlers
        this.terminalContextMenuHandler = (e) => {
            e.preventDefault();
            this.showTerminalContextMenu(e);
        };
    }
    
    // Event listener management complexity
    if (this.terminalMouseUpHandler) {
        terminalContainer.removeEventListener('mouseup', this.terminalMouseUpHandler);
    }
    if (this.terminalContextMenuHandler) {
        terminalContainer.removeEventListener('contextmenu', this.terminalContextMenuHandler);
    }
}
```

### 4. **Action Handler Explosion** 🟠 HIGH
```js
async handleMenuAction(action) {
    // 110+ line switch statement with 20+ actions
    switch (action) {
        case 'copy': await this.handleCopy(); break;
        case 'paste': await this.handlePaste(); break;
        case 'select-all': this.handleSelectAll(); break;
        case 'clear': await this.handleClear(); break;
        case 'scroll-top': this.handleScrollToTop(); break;
        case 'scroll-bottom': this.handleScrollToBottom(); break;
        case 'connect': await this.handleConnect(); break;
        case 'edit': await this.handleEdit(); break;
        case 'duplicate': await this.handleDuplicate(); break;
        case 'rename': this.handleRename(); break;
        case 'delete': await this.handleDelete(); break;
        case 'properties': this.handleProperties(); break;
        case 'create-profile': await this.handleCreateProfile(); break;
        case 'create-folder': await this.handleCreateFolder(); break;
        case 'search': await this.handleSearch(); break;
        case 'tab-reconnect': await this.handleTabReconnect(); break;
        case 'tab-force-disconnect': await this.handleTabForceDisconnect(); break;
        case 'tab-duplicate': await this.handleTabDuplicate(); break;
        case 'tab-close': await this.handleTabClose(); break;
        case 'tab-close-others': await this.handleTabCloseOthers(); break;
        case 'file-open': await this.handleFileOpen(); break;
        case 'file-preview': await this.handleFilePreview(); break;
        case 'file-download': await this.handleFileDownload(); break;
        case 'file-upload-here': await this.handleFileUploadHere(); break;
        case 'file-rename': await this.handleFileRename(); break;
        case 'file-copy-path': await this.handleFileCopyPath(); break;
        case 'file-delete': await this.handleFileDelete(); break;
        case 'dir-new-folder': await this.handleDirNewFolder(); break;
        case 'dir-upload-files': await this.handleDirUploadFiles(); break;
        case 'dir-upload-folder': await this.handleDirUploadFolder(); break;
        case 'dir-refresh': await this.handleDirRefresh(); break;
        // ... more cases
        default:
            console.warn('Unknown context menu action:', action);
    }
}
```

## 🔍 Specific Problem Areas

### 1. **Menu Positioning Logic (Lines 506-527)**
```js
positionMenu(menu, x, y) {
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Complex positioning calculations
    let menuX = x;
    let menuY = y;

    // Adjust if menu would go off-screen horizontally
    if (x + menuRect.width > viewportWidth) {
        menuX = x - menuRect.width;
        if (menuX < 0) menuX = 0;
    }

    // Adjust if menu would go off-screen vertically
    if (y + menuRect.height > viewportHeight) {
        menuY = y - menuRect.height;
        if (menuY < 0) menuY = 0;
    }

    menu.style.left = `${menuX}px`;
    menu.style.top = `${menuY}px`;
}
```

### 2. **File Operation Complexity (Lines 1043-1143)**
```js
async handleFileDownload() {
    if (!this.currentFileData) return;
    
    try {
        if (this.remoteExplorerManager) {
            await this.remoteExplorerManager.downloadFile(this.currentFileData.path);
        }
    } catch (error) {
        console.error('Failed to download file:', error);
        showNotification('Failed to download file', 'error');
    }
}

async handleFileUploadHere() {
    try {
        if (this.remoteExplorerManager) {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.onchange = async (e) => {
                const files = Array.from(e.target.files);
                for (const file of files) {
                    await this.remoteExplorerManager.uploadFile(file, this.remoteExplorerManager.currentPath);
                }
            };
            input.click();
        }
    } catch (error) {
        console.error('Failed to upload files:', error);
        showNotification('Failed to upload files', 'error');
    }
}
```

### 3. **Profile Operation Delegation (Lines 808-918)**
```js
async handleEdit() {
    if (!this.currentTarget) return;
    
    const itemType = this.currentTarget.dataset.type;
    const itemId = this.currentTarget.dataset.id;
    
    if (itemType === 'profile') {
        // Inline editing attempt
        const textElement = this.currentTarget.querySelector('.tree-item-text');
        if (textElement) {
            const originalText = textElement.textContent;
            const inputElement = document.createElement('input');
            inputElement.type = 'text';
            inputElement.value = originalText;
            inputElement.className = 'tree-item-edit-input';
            
            // Complex inline editing logic
            textElement.replaceWith(inputElement);
            inputElement.focus();
            inputElement.select();
            
            const finishEdit = () => {
                // More complex logic to handle edit completion
            };
            
            inputElement.addEventListener('blur', finishEdit);
            inputElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') finishEdit();
                if (e.key === 'Escape') {
                    inputElement.replaceWith(textElement);
                }
            });
        }
    } else if (itemType === 'folder') {
        // Similar complex logic for folder editing
    }
}
```

## 🔧 Recommended Architectural Refactoring

### 1. **Domain-Specific Context Menu Managers**
```js
// RECOMMENDED: Split by domain responsibility
class TerminalContextMenuManager {
    constructor(terminalManager) {
        this.terminalManager = terminalManager;
        this.selectToCopyEnabled = false;
    }
    
    showContextMenu(event) { /* Terminal-specific only */ }
    updateMenuItems(menu) { /* Terminal state only */ }
    
    // Terminal-specific actions
    async copy() { /* */ }
    async paste() { /* */ }
    selectAll() { /* */ }
    clear() { /* */ }
}

class SidebarContextMenuManager {
    constructor(sidebarManager) {
        this.sidebarManager = sidebarManager;
    }
    
    showContextMenu(event, treeItem) { /* Sidebar-specific only */ }
    updateMenuItems(menu, treeItem) { /* Profile/folder state only */ }
    
    // Profile/folder-specific actions
    async connectProfile() { /* */ }
    async editProfile() { /* */ }
    async deleteProfile() { /* */ }
    async createFolder() { /* */ }
}

class FileExplorerContextMenuManager {
    constructor(fileManager) {
        this.fileManager = fileManager;
    }
    
    showContextMenu(event, fileItem) { /* File operations only */ }
    updateMenuItems(menu, fileData) { /* File state only */ }
    
    // File-specific actions
    async downloadFile() { /* */ }
    async uploadFile() { /* */ }
    async deleteFile() { /* */ }
}

// Coordinating manager
class ContextMenuCoordinator {
    constructor() {
        this.terminalMenus = new TerminalContextMenuManager();
        this.sidebarMenus = new SidebarContextMenuManager();
        this.fileMenus = new FileExplorerContextMenuManager();
        this.tabMenus = new TabContextMenuManager();
    }
    
    init() {
        // Register global right-click handler
        document.addEventListener('contextmenu', (e) => {
            this.routeContextMenu(e);
        });
    }
    
    routeContextMenu(event) {
        const terminalElement = event.target.closest('.terminal-container');
        const sidebarElement = event.target.closest('.sidebar');
        const fileElement = event.target.closest('.file-explorer');
        const tabElement = event.target.closest('.tab');
        
        if (terminalElement) {
            this.terminalMenus.showContextMenu(event);
        } else if (sidebarElement) {
            this.sidebarMenus.showContextMenu(event);
        } else if (fileElement) {
            this.fileMenus.showContextMenu(event);
        } else if (tabElement) {
            this.tabMenus.showContextMenu(event);
        }
    }
}
```

### 2. **Action Command Pattern**
```js
// RECOMMENDED: Command pattern for actions
class ContextMenuCommand {
    constructor(name, icon, action, condition = null) {
        this.name = name;
        this.icon = icon;
        this.action = action;
        this.condition = condition;
    }
    
    isEnabled(context) {
        return this.condition ? this.condition(context) : true;
    }
    
    async execute(context) {
        return await this.action(context);
    }
}

class TerminalCommandRegistry {
    constructor(terminalManager) {
        this.terminalManager = terminalManager;
        this.commands = new Map([
            ['copy', new ContextMenuCommand(
                'Copy',
                'copy',
                () => this.copy(),
                () => this.terminalManager.hasSelection()
            )],
            ['paste', new ContextMenuCommand(
                'Paste',
                'paste',
                () => this.paste(),
                () => this.terminalManager.isConnected
            )],
            ['select-all', new ContextMenuCommand(
                'Select All',
                'select-all',
                () => this.selectAll()
            )],
            ['clear', new ContextMenuCommand(
                'Clear',
                'clear',
                () => this.clear(),
                () => this.terminalManager.isConnected
            )]
        ]);
    }
    
    getCommands(context) {
        return Array.from(this.commands.values())
            .filter(cmd => cmd.isEnabled(context));
    }
    
    executeCommand(commandId, context) {
        const command = this.commands.get(commandId);
        if (command && command.isEnabled(context)) {
            return command.execute(context);
        }
    }
}
```

### 3. **Menu Builder System**
```js
class ContextMenuBuilder {
    constructor() {
        this.menuElement = null;
    }
    
    create() {
        this.menuElement = document.createElement('div');
        this.menuElement.className = 'context-menu';
        return this;
    }
    
    addCommand(command, context) {
        if (command.isEnabled(context)) {
            const item = this.createMenuItem(command);
            this.menuElement.appendChild(item);
        }
        return this;
    }
    
    addSeparator() {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        this.menuElement.appendChild(separator);
        return this;
    }
    
    createMenuItem(command) {
        const item = document.createElement('div');
        item.className = 'context-menu-item';
        item.dataset.action = command.id;
        item.innerHTML = `
            <img src="./icons/${command.icon}.svg" class="svg-icon" alt="${command.icon}">
            ${command.name}
        `;
        return item;
    }
    
    showAt(x, y) {
        document.body.appendChild(this.menuElement);
        this.positionMenu(x, y);
        this.menuElement.classList.add('visible');
    }
    
    positionMenu(x, y) {
        // Reusable positioning logic
        const rect = this.menuElement.getBoundingClientRect();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        
        const position = {
            x: Math.min(x, viewport.width - rect.width),
            y: Math.min(y, viewport.height - rect.height)
        };
        
        this.menuElement.style.left = `${Math.max(0, position.x)}px`;
        this.menuElement.style.top = `${Math.max(0, position.y)}px`;
    }
}

// Usage
const terminalCommands = new TerminalCommandRegistry(terminalManager);
const menuBuilder = new ContextMenuBuilder();

function showTerminalContextMenu(event) {
    const context = { terminal: terminalManager };
    const commands = terminalCommands.getCommands(context);
    
    menuBuilder
        .create()
        .addCommand(commands.find(c => c.id === 'copy'), context)
        .addCommand(commands.find(c => c.id === 'paste'), context)
        .addSeparator()
        .addCommand(commands.find(c => c.id === 'select-all'), context)
        .addCommand(commands.find(c => c.id === 'clear'), context)
        .showAt(event.clientX, event.clientY);
}
```

### 4. **Event System Decoupling**
```js
class ContextMenuEventBus {
    constructor() {
        this.listeners = new Map();
    }
    
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }
    
    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(callback => callback(data));
    }
    
    off(event, callback) {
        const callbacks = this.listeners.get(event) || [];
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }
}

// Usage for decoupled communication
const eventBus = new ContextMenuEventBus();

// Sidebar manager subscribes to profile events
eventBus.on('profile:edit', (profileId) => {
    sidebarManager.editProfile(profileId);
});

// Context menu emits events instead of direct calls
class SidebarContextMenuManager {
    async executeEditProfile(profileId) {
        eventBus.emit('profile:edit', profileId);
    }
}
```

## 📊 Performance Considerations

### **Current Performance: FAIR**
- **Menu creation**: Dynamic HTML generation on each show
- **Event handling**: Multiple event listeners per menu type
- **DOM operations**: Frequent show/hide operations
- **Memory usage**: Event listener accumulation over time

### **Performance Optimizations**
```js
class ContextMenuPool {
    constructor() {
        this.pools = new Map();
        this.activeMenus = new Set();
    }
    
    getMenu(type) {
        if (!this.pools.has(type)) {
            this.pools.set(type, []);
        }
        
        const pool = this.pools.get(type);
        let menu = pool.pop();
        
        if (!menu) {
            menu = this.createMenu(type);
        }
        
        this.activeMenus.add(menu);
        return menu;
    }
    
    releaseMenu(menu) {
        menu.classList.remove('visible');
        menu.remove();
        this.activeMenus.delete(menu);
        
        const type = menu.dataset.menuType;
        this.pools.get(type).push(menu);
    }
    
    createMenu(type) {
        // Create and configure menu based on type
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.dataset.menuType = type;
        return menu;
    }
}
```

## 🧪 Testing Strategy

### **Current Testability: 3/10** (Poor)
- **Multi-domain coupling**: Hard to test individual menu types
- **DOM dependencies**: Requires full DOM setup for testing
- **Manager dependencies**: Tight coupling to multiple managers
- **Event handling**: Complex event interaction testing

### **Improved Testing Approach**
```js
describe('TerminalContextMenuManager', () => {
    let contextMenu;
    let mockTerminal;
    
    beforeEach(() => {
        mockTerminal = new MockTerminalManager();
        contextMenu = new TerminalContextMenuManager(mockTerminal);
    });
    
    it('should show copy option when terminal has selection', () => {
        mockTerminal.setHasSelection(true);
        
        const commands = contextMenu.getAvailableCommands();
        
        expect(commands.some(cmd => cmd.id === 'copy')).toBe(true);
    });
    
    it('should disable paste when terminal not connected', () => {
        mockTerminal.setConnected(false);
        
        const commands = contextMenu.getAvailableCommands();
        const pasteCommand = commands.find(cmd => cmd.id === 'paste');
        
        expect(pasteCommand.isEnabled()).toBe(false);
    });
});

describe('ContextMenuBuilder', () => {
    let builder;
    
    beforeEach(() => {
        builder = new ContextMenuBuilder();
    });
    
    it('should create menu with correct structure', () => {
        const menu = builder
            .create()
            .addCommand(new MockCommand('test', 'Test'))
            .menuElement;
        
        expect(menu.className).toBe('context-menu');
        expect(menu.children).toHaveLength(1);
        expect(menu.querySelector('.context-menu-item')).toBeTruthy();
    });
});
```

## 🎯 Immediate Action Items

1. **🔴 CRITICAL**: Split into domain-specific context menu managers
2. **🔴 CRITICAL**: Extract action handlers into command pattern
3. **🟠 HIGH**: Implement menu builder system for reusability
4. **🟠 HIGH**: Add event bus for decoupled communication
5. **🟡 MEDIUM**: Implement menu object pooling for performance
6. **🟡 MEDIUM**: Add comprehensive testing for each domain
7. **🟢 LOW**: Extract menu positioning logic into utility

## 📈 Code Quality Score: 4/10
- **Architecture**: Poor (multi-domain coupling)
- **Maintainability**: Poor (large switch statements, tight coupling)
- **Reusability**: Poor (domain-specific logic mixed)
- **Performance**: Fair (dynamic generation, no pooling)
- **Testability**: Poor (complex dependencies)
- **Separation of Concerns**: Very poor (everything in one class)

## 🏆 Refactoring Success Metrics

### **Target Architecture**
- **4 domain managers**: Terminal, Sidebar, File, Tab context menus
- **Command pattern**: Reusable action system
- **Event-driven**: Decoupled communication
- **Menu builder**: Consistent menu creation

### **Performance Targets**
- **Menu show time**: <10ms for any context menu
- **Memory usage**: 60% reduction through pooling
- **Event handling**: Clean listener management

### **Testing Targets**
- **Unit test coverage**: 80% for each domain manager
- **Integration tests**: Cross-domain menu interactions
- **Performance tests**: Menu creation and positioning

## 🎯 CONCLUSION

The `context-menu.js` module demonstrates **comprehensive functionality** but suffers from **severe architectural coupling** that makes it a maintenance liability. The single-class-handles-everything approach violates multiple SOLID principles and makes testing extremely difficult.

**Strengths to preserve**:
- Comprehensive context menu coverage
- Good user experience with consistent interactions
- Solid menu positioning logic

**Critical issues requiring immediate attention**:
- Multi-domain coupling (split into focused managers)
- Complex action handling (implement command pattern)
- Poor testability (extract dependencies)
- Performance issues (add menu pooling)

**Priority**: HIGH - This module is central to user interaction but its current architecture makes it fragile and difficult to extend or maintain. The coupling between domains creates cascading effects when changes are needed.

## 🎯 Immediate Action Items

1. **🔴 CRITICAL**: Split into domain-specific context menu managers
2. **🔴 CRITICAL**: Extract action handlers into command pattern
3. **🟠 HIGH**: Implement menu builder system for reusability
4. **🟠 HIGH**: Add event bus for decoupled communication
5. **🟡 MEDIUM**: Implement menu object pooling for performance
6. **🟡 MEDIUM**: Add comprehensive testing for each domain
7. **🟢 LOW**: Extract menu positioning logic into utility

## 📈 Code Quality Score: 4/10
- **Architecture**: Poor (multi-domain coupling)
- **Maintainability**: Poor (large switch statements, tight coupling)
- **Reusability**: Poor (domain-specific logic mixed)
- **Performance**: Fair (dynamic generation, no pooling)
- **Testability**: Poor (complex dependencies)
- **Separation of Concerns**: Very poor (everything in one class)

## 🏆 Refactoring Success Metrics

### **Target Architecture**
- **4 domain managers**: Terminal, Sidebar, File, Tab context menus
- **Command pattern**: Reusable action system
- **Event-driven**: Decoupled communication
- **Menu builder**: Consistent menu creation

### **Performance Targets**
- **Menu show time**: <10ms for any context menu
- **Memory usage**: 60% reduction through pooling
- **Event handling**: Clean listener management

### **Testing Targets**
- **Unit test coverage**: 80% for each domain manager
- **Integration tests**: Cross-domain menu interactions
- **Performance tests**: Menu creation and positioning

## 🎯 CONCLUSION

The `context-menu.js` module demonstrates **comprehensive functionality** but suffers from **severe architectural coupling** that makes it a maintenance liability. The single-class-handles-everything approach violates multiple SOLID principles and makes testing extremely difficult.

**Strengths to preserve**:
- Comprehensive context menu coverage
- Good user experience with consistent interactions
- Solid menu positioning logic

**Critical issues requiring immediate attention**:
- Multi-domain coupling (split into focused managers)
- Complex action handling (implement command pattern)
- Poor testability (extract dependencies)
- Performance issues (add menu pooling)

**Priority**: HIGH - This module is central to user interaction but its current architecture makes it fragile and difficult to extend or maintain. The coupling between domains creates cascading effects when changes are needed. 