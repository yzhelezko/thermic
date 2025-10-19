/**
 * Universal Notification Component
 * 
 * A flexible notification system that can be used for various purposes:
 * - Success messages
 * - Error messages
 * - Info messages
 * - Warning messages
 * - Status bar integration
 * - Notification history
 * 
 * Usage:
 * import { notification } from './components/Notification.js';
 * 
 * notification.success('Profile created successfully');
 * notification.error('Failed to delete profile');
 * notification.info('Loading profiles...');
 * notification.warning('This action cannot be undone');
 */

export class Notification {
    constructor() {
        this.notifications = new Map();
        this.history = [];
        this.nextId = 1;
        this.isInitialized = false;
        this.maxHistoryItems = 100;
        this.statusElement = null;
        this.originalStatusText = 'Ready';
        this.statusTimeout = null;
        this.init();
    }

    init() {
        if (this.isInitialized) return;
        
        // Create notification container
        const containerHTML = `
            <div id="notification-container" class="notification-container"></div>
        `;

        // Add container to body if it doesn't exist
        if (!document.getElementById('notification-container')) {
            document.body.insertAdjacentHTML('beforeend', containerHTML);
        }

        // Create notification history panel
        const historyHTML = `
            <div id="notification-history-panel" class="notification-history-panel">
                <div class="notification-history-header">
                    <h3>Notification History</h3>
                    <div class="notification-history-actions">
                        <button id="clear-history-btn" class="notification-history-btn">Clear All</button>
                        <button id="close-history-btn" class="notification-history-btn">×</button>
                    </div>
                </div>
                <div class="notification-history-content" id="notification-history-content">
                    <div class="notification-history-empty">No notifications yet</div>
                </div>
            </div>
            <div id="notification-history-overlay" class="notification-history-overlay"></div>
        `;

        // Add history panel to body if it doesn't exist
        if (!document.getElementById('notification-history-panel')) {
            document.body.insertAdjacentHTML('beforeend', historyHTML);
        }

        // Add CSS styles
        this.addStyles();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup status bar integration
        this.setupStatusBarIntegration();
        
        this.isInitialized = true;
    }

    addStyles() {
        if (document.getElementById('notification-styles')) return;

        const styles = `
            <style id="notification-styles">
                .notification-container {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10001;
                    pointer-events: none;
                    max-width: 400px;
                }

                .notification {
                    background: var(--bg-primary, #1e1e1e);
                    border: 1px solid var(--border-color, #333);
                    border-radius: 8px;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
                    margin-bottom: 12px;
                    padding: 16px;
                    pointer-events: auto;
                    opacity: 1;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    max-width: 100%;
                    word-wrap: break-word;
                }

                .notification.show {
                    opacity: 1;
                }

                .notification.hide {
                    opacity: 0;
                }

                .notification-icon {
                    font-size: 20px;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                }

                .notification-content {
                    flex: 1;
                    min-width: 0;
                }

                .notification-title {
                    font-weight: 600;
                    font-size: 14px;
                    margin-bottom: 4px;
                    color: var(--text-primary, #ffffff);
                }

                .notification-message {
                    font-size: 13px;
                    line-height: 1.4;
                    color: var(--text-secondary, #cccccc);
                }

                .notification-close {
                    background: none;
                    border: none;
                    color: var(--text-secondary, #888);
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 4px;
                    flex-shrink: 0;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    line-height: 1;
                }

                .notification-close:hover {
                    background: var(--bg-quaternary, #333);
                    color: var(--text-primary, #ffffff);
                }

                /* Notification types */
                .notification.success {
                    border-left: 4px solid #28a745;
                }

                .notification.error {
                    border-left: 4px solid #dc3545;
                }

                .notification.warning {
                    border-left: 4px solid #ffc107;
                }

                .notification.info {
                    border-left: 4px solid #17a2b8;
                }

                /* Progress bar for auto-dismiss */
                .notification-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    height: 2px;
                    background: rgba(255, 255, 255, 0.3);
                    transition: width linear;
                    border-radius: 0 0 8px 8px;
                }

                .notification.success .notification-progress {
                    background: #28a745;
                }

                .notification.error .notification-progress {
                    background: #dc3545;
                }

                .notification.warning .notification-progress {
                    background: #ffc107;
                }

                .notification.info .notification-progress {
                    background: #17a2b8;
                }

                /* Status bar integration */
                #status-info {
                    cursor: pointer;
                    position: relative;
                }

                #status-info:hover {
                    opacity: 0.8;
                }

                /* Notification History Panel */
                .notification-history-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(4px);
                    z-index: 10002;
                    opacity: 0;
                    visibility: hidden;
                }

                .notification-history-overlay.active {
                    opacity: 1;
                    visibility: visible;
                }

                .notification-history-panel {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: var(--bg-primary, #1e1e1e);
                    border: 1px solid var(--border-color, #333);
                    border-radius: 8px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                    width: 500px;
                    max-width: 90vw;
                    max-height: 70vh;
                    z-index: 10003;
                    opacity: 0;
                    visibility: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .notification-history-panel.active {
                    opacity: 1;
                    visibility: visible;
                }

                .notification-history-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--border-color, #333);
                    background: var(--bg-secondary, #252525);
                    border-radius: 8px 8px 0 0;
                }

                .notification-history-header h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--text-primary, #ffffff);
                }

                .notification-history-actions {
                    display: flex;
                    gap: 8px;
                }

                .notification-history-btn {
                    background: var(--bg-quaternary, #333);
                    border: 1px solid var(--border-color, #444);
                    color: var(--text-primary, #ffffff);
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }

                .notification-history-btn:hover {
                    background: var(--bg-tertiary, #404040);
                }

                .notification-history-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                    max-height: 400px;
                }

                .notification-history-empty {
                    text-align: center;
                    color: var(--text-secondary, #888);
                    padding: 40px 20px;
                    font-style: italic;
                }

                .notification-history-item {
                    display: block;
                    padding: 12px;
                    border-radius: 6px;
                    margin-bottom: 8px;
                    background: var(--bg-secondary, #252525);
                    border-left: 3px solid transparent;
                }

                .notification-history-item.success {
                    border-left-color: #28a745;
                }

                .notification-history-item.error {
                    border-left-color: #dc3545;
                }

                .notification-history-item.warning {
                    border-left-color: #ffc107;
                }

                .notification-history-item.info {
                    border-left-color: #17a2b8;
                }

                .notification-history-content-text {
                    flex: 1;
                    min-width: 0;
                }

                .notification-history-title {
                    font-weight: 600;
                    font-size: 13px;
                    margin-bottom: 2px;
                    color: var(--text-primary, #ffffff);
                }

                .notification-history-message {
                    font-size: 12px;
                    line-height: 1.4;
                    color: var(--text-secondary, #cccccc);
                    margin-bottom: 4px;
                }

                .notification-history-time {
                    font-size: 11px;
                    color: var(--text-tertiary, #666);
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    setupEventListeners() {
        // History panel event listeners
        const historyOverlay = document.getElementById('notification-history-overlay');
        const closeHistoryBtn = document.getElementById('close-history-btn');
        const clearHistoryBtn = document.getElementById('clear-history-btn');

        // Close history panel
        historyOverlay?.addEventListener('click', () => this.hideHistory());
        closeHistoryBtn?.addEventListener('click', () => this.hideHistory());

        // Clear history
        clearHistoryBtn?.addEventListener('click', () => this.clearHistory());

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideHistory();
            }
        });
    }

    setupStatusBarIntegration() {
        // Wait for DOM to be ready and find status element
        const findStatusElement = () => {
            this.statusElement = document.getElementById('status-info');
            if (this.statusElement) {
                this.originalStatusText = this.statusElement.textContent || 'Ready';
                
                // Make status element clickable
                this.statusElement.addEventListener('click', () => this.showHistory());
                
                // Add tooltip
                this.statusElement.title = 'Click to view notification history';
            } else {
                // Retry after a short delay if element not found
                setTimeout(findStatusElement, 100);
            }
        };

        findStatusElement();
    }

    /**
     * Show notification with configuration
     * @param {Object} config - Notification configuration
     * @param {string} config.type - Type: 'success', 'error', 'warning', 'info'
     * @param {string} config.title - Notification title
     * @param {string} [config.message] - Notification message
     * @param {string} [config.icon] - Custom icon (emoji or HTML)
     * @param {number} [config.duration=5000] - Auto-dismiss duration in ms (0 = no auto-dismiss)
     * @param {boolean} [config.closable=true] - Whether notification can be manually closed
     * @param {boolean} [config.showInStatus=true] - Whether to show in status bar
     * @param {boolean} [config.showToast=true] - Whether to show toast notification
     * @returns {string} Notification ID
     */
    show(config = {}) {
        const id = `notification-${this.nextId++}`;
        const {
            type = 'info',
            title = '',
            message = '',
            icon = this.getDefaultIcon(type),
            duration = 5000,
            closable = true,
            showInStatus = true,
            showToast = true
        } = config;

        // Add to history
        this.addToHistory({
            id,
            type,
            title,
            message,
            icon,
            timestamp: new Date()
        });

        // Show in status bar
        if (showInStatus && this.statusElement) {
            this.showInStatusBar(title || message, type, duration);
        }

        // Show toast notification
        if (showToast) {
            this.showToast(id, config);
        }

        return id;
    }

    showToast(id, config) {
        const container = document.getElementById('notification-container');
        
        if (!container) {
            console.error('Notification container not found');
            return;
        }

        const {
            type = 'info',
            title = '',
            message = '',
            icon = this.getDefaultIcon(type),
            duration = 5000,
            closable = true
        } = config;

        // Create notification element
        const notificationHTML = `
            <div id="${id}" class="notification ${type}">
                <div class="notification-icon">${icon}</div>
                <div class="notification-content">
                    ${title ? `<div class="notification-title">${title}</div>` : ''}
                    ${message ? `<div class="notification-message">${message}</div>` : ''}
                </div>
                ${closable ? '<button class="notification-close" aria-label="Close">×</button>' : ''}
                ${duration > 0 ? '<div class="notification-progress"></div>' : ''}
            </div>
        `;

        container.insertAdjacentHTML('afterbegin', notificationHTML);
        const notificationElement = document.getElementById(id);

        // Store notification data
        this.notifications.set(id, {
            element: notificationElement,
            config,
            timeoutId: null
        });

        // Setup close button
        if (closable) {
            const closeBtn = notificationElement.querySelector('.notification-close');
            closeBtn?.addEventListener('click', () => this.dismiss(id));
        }

        // Show notification immediately
        notificationElement.classList.add('show');

        // Setup auto-dismiss
        if (duration > 0) {
            this.setupAutoDismiss(id, duration);
        }
    }

    showInStatusBar(text, type, duration) {
        if (!this.statusElement) return;

        // Clear any existing timeout
        if (this.statusTimeout) {
            clearTimeout(this.statusTimeout);
        }

        // Set color based on type - updated for better contrast with blue layout
        let color = '#ffffff'; // default white for better visibility
        switch (type) {
            case 'success':
                color = '#90ee90'; // light green for better visibility
                break;
            case 'error':
                color = '#ffb3b3'; // light red for better visibility
                break;
            case 'info':
                color = '#add8e6'; // light blue for better visibility
                break;
            case 'warning':
                color = '#ffeb9c'; // light yellow for better visibility
                break;
            default:
                color = '#ffffff'; // white
        }

        // Update status immediately without transitions
        this.statusElement.textContent = text;
        this.statusElement.style.color = color;

        // Reset after duration
        if (duration > 0) {
            this.statusTimeout = setTimeout(() => {
                this.statusElement.textContent = this.originalStatusText;
                this.statusElement.style.color = '';
            }, duration);
        }
    }

    addToHistory(notification) {
        this.history.unshift(notification);
        
        // Limit history size
        if (this.history.length > this.maxHistoryItems) {
            this.history = this.history.slice(0, this.maxHistoryItems);
        }
    }

    showHistory() {
        const panel = document.getElementById('notification-history-panel');
        const overlay = document.getElementById('notification-history-overlay');
        
        if (!panel || !overlay) return;

        // Render history content
        this.renderHistory();

        // Show panel
        overlay.classList.add('active');
        panel.classList.add('active');
    }

    hideHistory() {
        const panel = document.getElementById('notification-history-panel');
        const overlay = document.getElementById('notification-history-overlay');
        
        if (!panel || !overlay) return;

        overlay.classList.remove('active');
        panel.classList.remove('active');
    }

    renderHistory() {
        const content = document.getElementById('notification-history-content');
        if (!content) return;

        if (this.history.length === 0) {
            content.innerHTML = '<div class="notification-history-empty">No notifications yet</div>';
            return;
        }

        const historyHTML = this.history.map(item => {
            const timeStr = this.formatTime(item.timestamp);
            return `
                <div class="notification-history-item ${item.type}">
                    <div class="notification-history-content-text">
                        ${item.title ? `<div class="notification-history-title">${item.title}</div>` : ''}
                        ${item.message ? `<div class="notification-history-message">${item.message}</div>` : ''}
                        <div class="notification-history-time">${timeStr}</div>
                    </div>
                </div>
            `;
        }).join('');

        content.innerHTML = historyHTML;
    }

    clearHistory() {
        this.history = [];
        this.renderHistory();
    }

    formatTime(date) {
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) { // Less than 1 minute
            return 'Just now';
        } else if (diff < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        } else if (diff < 86400000) { // Less than 1 day
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        } else {
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    setupAutoDismiss(id, duration) {
        const notification = this.notifications.get(id);
        if (!notification) return;

        const progressBar = notification.element.querySelector('.notification-progress');
        
        if (progressBar) {
            // Animate progress bar
            progressBar.style.width = '100%';
            setTimeout(() => {
                progressBar.style.width = '0%';
                progressBar.style.transition = `width ${duration}ms linear`;
            }, 10);
        }

        // Set timeout for auto-dismiss
        notification.timeoutId = setTimeout(() => {
            this.dismiss(id);
        }, duration);
    }

    /**
     * Dismiss notification
     * @param {string} id - Notification ID
     */
    dismiss(id) {
        const notification = this.notifications.get(id);
        if (!notification) return;

        // Clear timeout
        if (notification.timeoutId) {
            clearTimeout(notification.timeoutId);
        }

        // Remove immediately
        notification.element.remove();
        this.notifications.delete(id);
    }

    /**
     * Dismiss all notifications
     */
    dismissAll() {
        const ids = Array.from(this.notifications.keys());
        ids.forEach(id => this.dismiss(id));
    }

    getDefaultIcon(type) {
        const icons = {
            success: '<img src="./icons/star.svg" class="svg-icon" alt="✅">',
            error: '<img src="./icons/error.svg" class="svg-icon" alt="❌">',
            warning: '<img src="./icons/warning.svg" class="svg-icon" alt="⚠️">',
            info: '<img src="./icons/info.svg" class="svg-icon" alt="ℹ️">'
        };
        return icons[type] || icons.info;
    }

    // Convenience methods
    success(title, message, options = {}) {
        return this.show({
            type: 'success',
            title,
            message,
            ...options
        });
    }

    error(title, message, options = {}) {
        return this.show({
            type: 'error',
            title,
            message,
            duration: 8000, // Longer duration for errors
            ...options
        });
    }

    warning(title, message, options = {}) {
        return this.show({
            type: 'warning',
            title,
            message,
            duration: 6000,
            ...options
        });
    }

    info(title, message, options = {}) {
        return this.show({
            type: 'info',
            title,
            message,
            ...options
        });
    }

    // Legacy compatibility method for existing showNotification calls
    showNotification(message, type = 'info', duration = 3000) {
        return this.show({
            type,
            title: message,
            duration,
            showToast: false, // Only show in status bar for legacy calls
            showInStatus: true
        });
    }

    /**
     * Set permanent status message (like shell selection)
     * @param {string} message - The permanent message to display
     * @param {string} color - Optional color for the message
     */
    setPermanentStatus(message, color = '') {
        if (!this.statusElement) return;
        
        // Clear any existing timeout
        if (this.statusTimeout) {
            clearTimeout(this.statusTimeout);
            this.statusTimeout = null;
        }
        
        // Set permanent message
        this.statusElement.textContent = message;
        this.statusElement.style.color = color;
        
        // Update original text so it doesn't get overwritten
        this.originalStatusText = message;
    }

    /**
     * Clear permanent status and return to default
     */
    clearPermanentStatus() {
        if (!this.statusElement) return;
        
        // Clear any existing timeout
        if (this.statusTimeout) {
            clearTimeout(this.statusTimeout);
            this.statusTimeout = null;
        }
        
        // Reset to default
        this.originalStatusText = 'Ready';
        this.statusElement.textContent = this.originalStatusText;
        this.statusElement.style.color = '';
    }
}

// Create global instance
export const notification = new Notification();

// Make it available globally for easy access
if (typeof window !== 'undefined') {
    window.notification = notification;
}