// Window controls management module
import { MinimizeWindow, MaximizeWindow, CloseWindow, IsWindowMaximized } from '../../wailsjs/go/main/App';

export class WindowControlsManager {
    constructor() {
        this.isMaximised = false;
        this.platform = this.detectPlatform();
    }

    init() {
        this.bindEvents();
        this.updateMaximizeButton();
        // Initial state check only
        this.checkInitialState();
    }

    detectPlatform() {
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('mac')) return 'darwin';
        if (userAgent.includes('win')) return 'windows';
        return 'linux';
    }

    async checkInitialState() {
        try {
            this.isMaximised = await IsWindowMaximized();
            this.updateMaximizeButton();
        } catch (error) {
            // Silent initial check
        }
    }

    bindEvents() {
        // Minimize button
        const minimizeBtn = document.getElementById('window-minimize');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', this.minimize.bind(this));
        }

        // Maximize/Restore button
        const maximizeBtn = document.getElementById('window-maximize');
        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', this.toggleMaximize.bind(this));
        }

        // Close button
        const closeBtn = document.getElementById('window-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', this.close.bind(this));
        }

        // Double-click titlebar to maximize (Windows/Linux behavior)
        const titlebar = document.getElementById('window-titlebar');
        if (titlebar && this.platform !== 'darwin') {
            titlebar.addEventListener('dblclick', this.toggleMaximize.bind(this));
        }
    }

    cleanup() {
        // No cleanup needed - Wails handles dragging natively through CSS
    }

    async minimize() {
        try {
            await MinimizeWindow();
        } catch (error) {
            console.error('Failed to minimize window:', error);
        }
    }

    async toggleMaximize() {
        try {
            await MaximizeWindow();
            // Update state immediately after toggle
            setTimeout(async () => {
                try {
                    this.isMaximised = await IsWindowMaximized();
                    this.updateMaximizeButton();
                } catch (error) {
                    // Silent error handling
                }
            }, 50); // Very short delay to let the window state change
        } catch (error) {
            console.error('Failed to toggle maximize window:', error);
        }
    }

    async close() {
        try {
            await CloseWindow();
        } catch (error) {
            console.error('Failed to close window:', error);
        }
    }

    updateMaximizeButton() {
        const maximizeBtn = document.getElementById('window-maximize');
        const maximizeIcon = maximizeBtn?.querySelector('.window-control-icon');
        
        if (maximizeIcon) {
            if (this.isMaximised) {
                // Restore icon
                maximizeIcon.innerHTML = `
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M2,0 L2,2 L0,2 L0,8 L6,8 L6,6 L8,6 L8,0 Z M1,3 L1,7 L5,7 L5,6 L2,6 L2,3 Z M3,1 L7,1 L7,5 L6,5 L6,2 L3,2 Z"/>
                    </svg>
                `;
                maximizeBtn.title = 'Restore';
            } else {
                // Maximize icon
                maximizeIcon.innerHTML = `
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M0,0 L0,10 L10,10 L10,0 Z M1,1 L9,1 L9,9 L1,9 Z"/>
                    </svg>
                `;
                maximizeBtn.title = 'Maximize';
            }
        }
    }
} 