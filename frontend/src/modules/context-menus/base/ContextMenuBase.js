// Base context menu functionality shared across all menu types
export class ContextMenuBase {
    constructor() {
        this.activeMenu = null;
        this.isVisible = false;
    }

    positionMenu(menu, x, y) {
        const menuRect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

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