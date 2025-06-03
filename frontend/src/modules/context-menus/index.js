// Context menu system main exports
import { ContextMenuCoordinator } from './ContextMenuCoordinator.js';

export { ContextMenuCoordinator } from './ContextMenuCoordinator.js';

// Base classes (in case other modules need to extend them)
export { ContextMenuBase } from './base/ContextMenuBase.js';
export { ContextMenuBuilder } from './base/ContextMenuBuilder.js';
export { ContextMenuCommand, CommandRegistry, ContextMenuSeparator } from './base/ContextMenuCommand.js';
export { ContextMenuEventBus, contextMenuEventBus } from './base/ContextMenuEventBus.js';

// Domain-specific managers
export { TerminalContextMenu } from './terminal/TerminalContextMenu.js';
export { TerminalCommandRegistry } from './terminal/TerminalCommandRegistry.js';

export { SidebarContextMenu } from './sidebar/SidebarContextMenu.js';
export { SidebarCommandRegistry } from './sidebar/SidebarCommandRegistry.js';

export { TabContextMenu } from './tabs/TabContextMenu.js';
export { TabCommandRegistry } from './tabs/TabCommandRegistry.js';

export { FileContextMenu } from './files/FileContextMenu.js';
export { FileCommandRegistry } from './files/FileCommandRegistry.js';

/**
 * Create a new context menu coordinator with the provided managers
 * 
 * @param {Object} terminalManager - Terminal manager instance
 * @param {Object} remoteExplorerManager - Remote explorer manager instance (optional)
 * @returns {ContextMenuCoordinator} Configured context menu coordinator
 */
export function createContextMenuCoordinator(terminalManager, remoteExplorerManager = null) {
    return new ContextMenuCoordinator(terminalManager, remoteExplorerManager);
} 