// File explorer command registry for file and directory operations
import { ContextMenuCommand, CommandRegistry } from '../base/ContextMenuCommand.js';
import { showNotification } from '../../utils.js';

export class FileCommandRegistry extends CommandRegistry {
    constructor(contextMenuManager) {
        super();
        this.contextMenuManager = contextMenuManager;
        // Direct references for easier access (matching old system)
        // The contextMenuManager here is the coordinator, so get remoteExplorerManager from it
        this.remoteExplorerManager = contextMenuManager.remoteExplorerManager;
        this.setupCommands();
    }

    setupCommands() {
        // Directory commands first
        this.register(new ContextMenuCommand(
            'dir-open',
            'Open',
            'open',
            (context) => this.handleDirOpen(context),
            (context) => context.isDirectory
        ));

        // File commands
        this.register(new ContextMenuCommand(
            'file-preview',
            'Preview',
            'preview',
            (context) => this.handleFilePreview(context),
            (context) => context.isFile
        ));

        this.registerSeparator();

        this.register(new ContextMenuCommand(
            'file-download',
            'Download',
            'download',
            (context) => this.handleFileDownload(context),
            (context) => context.isFile || context.isDirectory
        ));

        this.register(new ContextMenuCommand(
            'file-upload-here',
            'Upload Files Here',
            'upload-files',
            (context) => this.handleFileUploadHere(context),
            (context) => context.isDirectory
        ));

        this.registerSeparator();

        this.register(new ContextMenuCommand(
            'file-rename',
            'Rename',
            'rename',
            (context) => this.handleFileRename(context),
            (context) => context.isFile || context.isDirectory
        ));

        this.register(new ContextMenuCommand(
            'file-copy-path',
            'Copy Path',
            'copy-path',
            (context) => this.handleFileCopyPath(context),
            (context) => context.isFile || context.isDirectory
        ));

        this.register(new ContextMenuCommand(
            'file-delete',
            'Delete',
            'delete',
            (context) => this.handleDelete(context),
            (context) => (context.isFile || context.isDirectory)
        ));

        this.registerSeparator();

        // Properties for both files and directories
        this.register(new ContextMenuCommand(
            'file-properties',
            'Properties',
            'properties',
            (context) => this.handleFileProperties(context),
            (context) => context.isFile
        ));

        this.register(new ContextMenuCommand(
            'dir-properties',
            'Properties',
            'properties',
            (context) => this.handleDirProperties(context),
            (context) => context.isDirectory
        ));

        // Directory-only commands (for empty space context menu)
        this.registerSeparator();

        this.register(new ContextMenuCommand(
            'dir-refresh',
            'Refresh',
            'refresh',
            (context) => this.handleDirRefresh(context),
            (context) => context.isDirectory && !context.fileItem // Only show for empty space, not folder items
        ));

        this.register(new ContextMenuCommand(
            'dir-copy-path',
            'Copy Current Path',
            'copy-path',
            (context) => this.handleDirCopyPath(context),
            (context) => context.isDirectory && !context.fileItem // Only show for empty space, not folder items
        ));
    }



    async handleDirOpen(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;
        
        if (currentFileData.isDir || currentFileData.type === 'directory') {
            await this.remoteExplorerManager.navigateToPath(currentFileData.path);
        }
    }

    async handleFilePreview(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;
        
        // Only preview files, not directories
        if (!currentFileData.isDir && currentFileData.type !== 'directory') {
            await this.remoteExplorerManager.showFilePreview(currentFileData.path, currentFileData.name);
        }
    }

    async handleFileDownload(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;

        await this.remoteExplorerManager.downloadFile(
            currentFileData.path, 
            currentFileData.name, 
            currentFileData.isDir || currentFileData.type === 'directory'
        );
    }

    async handleFileUploadHere(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;
        
        if (currentFileData.isDir || currentFileData.type === 'directory') {
            await this.remoteExplorerManager.uploadToDirectory(currentFileData.path);
        }
    }

    async handleFileRename(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;

        this.remoteExplorerManager.showRenameDialog(
            currentFileData.path, 
            currentFileData.name
        );
    }

    async handleFileCopyPath(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;

        await this.remoteExplorerManager.copyPathToClipboard(currentFileData.path);
    }

    async handleDelete(context) {
        if (!this.remoteExplorerManager) return;

        // If multiple selected, prefer bulk delete
        const selected = Array.isArray(context.selected) ? context.selected.filter(i => i && i.path) : [];
        if (selected.length > 1) {
            const count = selected.length;
            const msg = `Delete ${count} selected items?`;
            if (window.modal) {
                window.modal.show({
                    title: 'Delete items',
                    message: msg,
                    icon: '🗑️',
                    buttons: [
                        { text: 'Cancel', style: 'secondary', action: 'cancel' },
                        { text: 'Delete', style: 'danger', action: 'confirm' }
                    ]
                }).then(async (result) => {
                    if (result === 'confirm') {
                        // Map to DOM elements by path
                        const byPath = new Map();
                        document.querySelectorAll('.file-item').forEach(el => byPath.set(el.dataset.path, el));
                        const selectedEls = selected.map(s => byPath.get(s.path)).filter(Boolean);
                        await this.remoteExplorerManager.deleteMultiple(selectedEls);
                    }
                });
            } else if (confirm(msg)) {
                const byPath = new Map();
                document.querySelectorAll('.file-item').forEach(el => byPath.set(el.dataset.path, el));
                const selectedEls = selected.map(s => byPath.get(s.path)).filter(Boolean);
                await this.remoteExplorerManager.deleteMultiple(selectedEls);
            }
            return;
        }

        // Fallback to single item
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData) return;
        this.remoteExplorerManager.showDeleteConfirmation(
            currentFileData.path,
            currentFileData.name,
            currentFileData.isDir || currentFileData.type === 'directory'
        );
    }

    async handleFileProperties(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;

        if (!currentFileData.isDir && currentFileData.type !== 'directory') {
            this.remoteExplorerManager.showFileProperties(currentFileData.path, currentFileData.name);
        }
    }

    async handleDirRefresh(context) {
        if (!this.remoteExplorerManager) return;
        
        await this.remoteExplorerManager.refreshCurrentDirectory();
    }

    async handleDirCopyPath(context) {
        if (!this.remoteExplorerManager) return;
        
        await this.remoteExplorerManager.copyPathToClipboard(this.remoteExplorerManager.currentRemotePath);
    }

    async handleDirProperties(context) {
        const currentFileData = this.contextMenuManager.currentFileData;
        if (!currentFileData || !this.remoteExplorerManager) return;

        if (currentFileData.isDir || currentFileData.type === 'directory') {
            this.remoteExplorerManager.showDirectoryProperties(currentFileData.path, currentFileData.name);
        }
    }
} 