// Base context menu functionality shared across all menu types
export class ContextMenuBase {
    constructor() {
        this.activeMenu = null;
        this.isVisible = false;
    }

    positionMenu(menu, x, y) {
        // Get viewport dimensions
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        
        // Force a layout calculation to ensure accurate measurements
        menu.offsetHeight; // Trigger reflow
        
        // Get menu dimensions
        const rect = menu.getBoundingClientRect();
        const menuWidth = rect.width || menu.offsetWidth;
        const menuHeight = rect.height || menu.offsetHeight;

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
        menu.style.left = `${menuX}px`;
        menu.style.top = `${menuY}px`;
        
        // Debug logging
        console.log('Context menu positioned (Base, threshold-based):', {
            cursor: { x, y },
            menu: { x: menuX, y: menuY, width: menuWidth, height: menuHeight },
            viewport: viewport,
            thresholds: {
                inBottomArea: y > viewport.height * bottomThreshold,
                inRightArea: x > viewport.width * rightThreshold
            }
        });
    }

    showMenu(menu) {
        menu.classList.add('active');
        this.activeMenu = menu;
        this.isVisible = true;
    }

    hideMenu() {
        if (this.activeMenu) {
            this.activeMenu.classList.remove('active');
            if (this.activeMenu.parentNode) {
                this.activeMenu.parentNode.removeChild(this.activeMenu);
            }
            this.activeMenu = null;
            this.isVisible = false;
        }
    }

    hideAllMenus() {
        // Hide all context menus on the page
        const menus = document.querySelectorAll('.context-menu.active');
        menus.forEach(menu => {
            menu.classList.remove('active');
            if (menu.parentNode) {
                menu.parentNode.removeChild(menu);
            }
        });
        this.activeMenu = null;
        this.isVisible = false;
    }
} 