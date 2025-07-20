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
        this.menuElement.style.position = 'fixed'; // Use fixed positioning to match CSS
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
        
        // Add to DOM first to get accurate measurements
        document.body.appendChild(this.menuElement);
        
        // Temporarily set to active state to get correct dimensions
        this.menuElement.classList.add('active');
        
        // Force a layout calculation to ensure accurate measurements
        this.menuElement.offsetHeight; // Trigger reflow
        
        // Position with correct dimensions
        this.positionMenu(x, y);
        
        // Reset and reapply active class for proper animation
        this.menuElement.classList.remove('active');
        
        // Use requestAnimationFrame to ensure positioning is applied before animation
        requestAnimationFrame(() => {
            this.menuElement.classList.add('active');
        });
        
        return this.menuElement;
    }

    positionMenu(x, y) {
        // Get viewport dimensions
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        
        // Get menu dimensions after it's in DOM
        const rect = this.menuElement.getBoundingClientRect();
        const menuWidth = rect.width || this.menuElement.offsetWidth;
        const menuHeight = rect.height || this.menuElement.offsetHeight;
        
        // Use threshold-based positioning for more predictable behavior
        const margin = 8;
        const bottomThreshold = 0.7; // If cursor is below 70% of window height
        const rightThreshold = 0.7;  // If cursor is beyond 70% of window width
        
        let menuX = x;
        let menuY = y;
        
        // Position horizontally: if cursor is in right 30% of window, show menu to the left
        if (x > viewport.width * rightThreshold) {
            menuX = x - menuWidth;
        }
        
        // Position vertically: if cursor is in bottom 30% of window, show menu above
        if (y > viewport.height * bottomThreshold) {
            menuY = y - menuHeight;
        }
        
        // Ensure menu doesn't go off edges with margins
        menuX = Math.max(margin, Math.min(menuX, viewport.width - menuWidth - margin));
        menuY = Math.max(margin, Math.min(menuY, viewport.height - menuHeight - margin));
        
        // Apply positioning
        this.menuElement.style.left = `${menuX}px`;
        this.menuElement.style.top = `${menuY}px`;
        
        // Debug logging
        console.log('🎯 Context menu positioned (threshold-based):', {
            cursor: { x, y },
            menu: { x: menuX, y: menuY, width: menuWidth, height: menuHeight },
            viewport: viewport,
            thresholds: {
                inBottomArea: y > viewport.height * bottomThreshold,
                inRightArea: x > viewport.width * rightThreshold
            },
            positioning: {
                cursorInBottomArea: y > viewport.height * bottomThreshold ? 'YES - Menu shown ABOVE cursor' : 'NO - Menu shown below cursor',
                cursorInRightArea: x > viewport.width * rightThreshold ? 'YES - Menu shown LEFT of cursor' : 'NO - Menu shown right of cursor'
            }
        });
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