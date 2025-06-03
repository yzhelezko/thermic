// Menu builder for creating consistent context menus
import { createInlineIconElement } from '../../../utils/icons.js';

// Map command icon names to emojis (for use with the SVG icon system)
const ICON_NAME_TO_EMOJI = {
    'connect': '🔗',
    'edit': '✏️',
    'duplicate': '📑',
    'rename': '📝',
    'delete': '🗑️',
    'favorite': '⭐',
    'properties': 'ℹ️',
    'add-profile': '➕',
    'add-folder': '📁',
    'search': '🔍',
    'copy': '📋',
    'paste': '📄',
    'select-all': '🔤',
    'clear': '🧹',
    'scroll-top': '⬆️',
    'scroll-bottom': '⬇️',
    // Tab icons
    'reconnect': '🔄',
    'disconnect': '❌',
    'close': '❌',
    'close-others': '🗑️',
    // File icons
    'open': '📂',
    'preview': '👁️',  // Will map to eye.svg
    'download': '⬇️', // Will map to arrow-down.svg
    'upload': '⬆️',   // Will map to arrow-up.svg
    'upload-files': '⬆️',
    'upload-folder': '⬆️',
    'new-folder': '📁',
    'refresh': '🔄',
    'copy-path': '📋',
    'properties': 'ℹ️'
};

export class ContextMenuBuilder {
    constructor() {
        this.menuElement = null;
    }

    create() {
        this.menuElement = document.createElement('div');
        this.menuElement.className = 'context-menu';
        this.menuElement.style.position = 'absolute';
        this.menuElement.style.zIndex = '10000';
        return this;
    }

    async addCommand(command, context) {
        if (!command) return this;
        
        if (command.isSeparator) {
            this.addSeparator();
        } else if (command.isEnabled(context)) {
            const item = await this.createMenuItem(command);
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

    async createMenuItem(command) {
        const item = document.createElement('div');
        item.className = 'context-menu-item';
        item.dataset.action = command.id;
        
        // Create icon element using the proper SVG icon system
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'context-menu-item-icon';
        
        const emoji = ICON_NAME_TO_EMOJI[command.icon];
        if (emoji) {
            try {
                const iconHtml = await createInlineIconElement(emoji, 'context-menu-svg-icon');
                iconWrapper.innerHTML = iconHtml;
            } catch (error) {
                console.error('Failed to create SVG icon for command:', command.icon, error);
                // Fallback to emoji if SVG fails
                iconWrapper.innerHTML = `<span class="emoji-fallback">${emoji}</span>`;
            }
        } else {
            // Fallback icon
            iconWrapper.innerHTML = `<span class="emoji-fallback">${command.icon || '📄'}</span>`;
        }
        
        // Create text element
        const text = document.createElement('span');
        text.className = 'context-menu-item-text';
        text.textContent = command.name;
        
        item.appendChild(iconWrapper);
        item.appendChild(text);
        
        return item;
    }

    showAt(x, y) {
        if (!this.menuElement) {
            console.error('Menu not created. Call create() first.');
            return;
        }
        
        document.body.appendChild(this.menuElement);
        this.positionMenu(x, y);
        this.menuElement.classList.add('active');
        return this.menuElement;
    }

    positionMenu(x, y) {
        // Ensure menu is in DOM to get accurate measurements
        const rect = this.menuElement.getBoundingClientRect();
        const viewport = { 
            width: window.innerWidth, 
            height: window.innerHeight 
        };
        
        const position = {
            x: Math.min(x, viewport.width - rect.width),
            y: Math.min(y, viewport.height - rect.height)
        };
        
        this.menuElement.style.left = `${Math.max(0, position.x)}px`;
        this.menuElement.style.top = `${Math.max(0, position.y)}px`;
    }

    getElement() {
        return this.menuElement;
    }

    destroy() {
        if (this.menuElement) {
            this.menuElement.classList.remove('active');
            if (this.menuElement.parentNode) {
                this.menuElement.parentNode.removeChild(this.menuElement);
            }
            this.menuElement = null;
        }
    }
} 