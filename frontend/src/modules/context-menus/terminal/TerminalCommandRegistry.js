// Terminal-specific command registry
import { ContextMenuCommand, CommandRegistry } from '../base/ContextMenuCommand.js';
import { WriteToShell } from '../../../../wailsjs/go/main/App.js';
import { showNotification } from '../../utils.js';

export class TerminalCommandRegistry extends CommandRegistry {
    constructor(terminalManager) {
        super();
        this.terminalManager = terminalManager;
        this.setupCommands();
    }

    setupCommands() {
        // Copy command
        this.register(new ContextMenuCommand(
            'copy',
            'Copy',
            'copy',
            () => this.handleCopy(),
            () => this.terminalManager.terminal && this.terminalManager.terminal.hasSelection()
        ));

        // Paste command
        this.register(new ContextMenuCommand(
            'paste',
            'Paste',
            'paste',
            () => this.handlePaste(),
            () => this.terminalManager.isConnected && this.terminalManager.sessionId
        ));

        // Select All command
        this.register(new ContextMenuCommand(
            'select-all',
            'Select All',
            'select-all',
            () => this.handleSelectAll(),
            () => this.terminalManager.terminal
        ));

        // Separator
        this.registerSeparator();

        // Clear command
        this.register(new ContextMenuCommand(
            'clear',
            'Clear',
            'clear',
            () => this.handleClear(),
            () => this.terminalManager.isConnected && this.terminalManager.sessionId
        ));

        // Separator
        this.registerSeparator();

        // Scroll to Top command
        this.register(new ContextMenuCommand(
            'scroll-top',
            'Scroll to Top',
            'scroll-top',
            () => this.handleScrollToTop(),
            () => this.terminalManager.terminal
        ));

        // Scroll to Bottom command
        this.register(new ContextMenuCommand(
            'scroll-bottom',
            'Scroll to Bottom',
            'scroll-bottom',
            () => this.handleScrollToBottom(),
            () => this.terminalManager.terminal
        ));
    }

    async handleCopy() {
        if (!this.terminalManager.terminal || !this.terminalManager.terminal.hasSelection()) {
            return;
        }

        try {
            const selectedText = this.terminalManager.terminal.getSelection();
            if (selectedText && selectedText.trim().length > 0) {
                await navigator.clipboard.writeText(selectedText);
                console.log('Copied text:', selectedText.substring(0, 50) + '...');
            }
        } catch (error) {
            console.error('Failed to copy text:', error);
            showNotification('Failed to copy text', 'error');
        }
    }

    async handlePaste() {
        if (!this.terminalManager.isConnected || !this.terminalManager.sessionId) {
            return;
        }

        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                await WriteToShell(this.terminalManager.sessionId, text);
                console.log('Pasted text:', text.substring(0, 50) + '...');
            }
        } catch (error) {
            console.error('Failed to paste text:', error);
            showNotification('Failed to paste text', 'error');
        }
    }

    handleSelectAll() {
        if (this.terminalManager.terminal) {
            this.terminalManager.terminal.selectAll();
        }
    }

    async handleClear() {
        if (!this.terminalManager.isConnected || !this.terminalManager.sessionId) {
            return;
        }

        try {
            await WriteToShell(this.terminalManager.sessionId, 'clear\n');
        } catch (error) {
            console.error('Failed to clear terminal:', error);
            showNotification('Failed to clear terminal', 'error');
        }
    }

    handleScrollToTop() {
        if (this.terminalManager.terminal) {
            this.terminalManager.terminal.scrollToTop();
        }
    }

    handleScrollToBottom() {
        if (this.terminalManager.terminal) {
            this.terminalManager.terminal.scrollToBottom();
        }
    }
} 