// Terminal-specific command registry
import { ContextMenuCommand, CommandRegistry } from '../base/ContextMenuCommand.js';
import { showNotification, getUnwrappedSelection } from '../../utils.js';

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
            () => this.isActiveSessionConnected()
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
            () => this.isActiveSessionConnected()
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
        // Always read selection from the active session's terminal — the
        // command-registry's `terminalManager.terminal` reference can be stale
        // after tab switches, while activeSessionId is authoritative.
        const activeSession = this.terminalManager.activeSessionId
            ? this.terminalManager.terminals.get(this.terminalManager.activeSessionId)
            : null;
        const term = activeSession && activeSession.terminal
            ? activeSession.terminal
            : this.terminalManager.terminal;

        if (!term || !term.hasSelection || !term.hasSelection()) {
            return;
        }

        try {
            const selectedText = getUnwrappedSelection(term);
            if (selectedText && selectedText.length > 0) {
                await navigator.clipboard.writeText(selectedText);
                console.log('Copied text:', selectedText.substring(0, 50) + '...');
            }
        } catch (error) {
            console.error('Failed to copy text:', error);
            showNotification('Failed to copy text', 'error');
        }
    }

    // Whether the active session (not the possibly-stale legacy terminal
    // reference) is connected. activeSessionId is authoritative after tab
    // switches; terminalManager.isConnected/sessionId can lag behind.
    isActiveSessionConnected() {
        const activeSession = this.terminalManager.activeSessionId
            ? this.terminalManager.terminals.get(this.terminalManager.activeSessionId)
            : null;
        return !!(activeSession && activeSession.isConnected);
    }

    async handlePaste() {
        if (!this.isActiveSessionConnected()) {
            return;
        }

        // pasteFromClipboard reads the system clipboard via the reliable Wails
        // binding (navigator.clipboard.readText() is flaky on Linux WebKit2GTK)
        // and routes through the active session's terminal.
        const success = await this.terminalManager.pasteFromClipboard();
        if (!success) {
            console.error('Failed to paste text');
            showNotification('Failed to paste text', 'error');
        }
    }

    handleSelectAll() {
        if (this.terminalManager.terminal) {
            this.terminalManager.terminal.selectAll();
        }
    }

    handleClear() {
        const activeSessionId = this.terminalManager.activeSessionId;
        if (!this.isActiveSessionConnected()) {
            return;
        }

        // clearTerminal() uses terminal.reset() which clears scrollback too.
        // WriteToShell('clear\n') only scrolls and leaves scrollback intact
        // (see CLAUDE.md terminal conventions).
        this.terminalManager.clearTerminal(activeSessionId);
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