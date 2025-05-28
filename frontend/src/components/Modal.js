/**
 * Universal Modal Component
 * 
 * A flexible modal system that can be used for various purposes:
 * - Confirmation dialogs (delete, save, etc.)
 * - Form dialogs
 * - Information dialogs
 * - Custom content dialogs
 * 
 * Usage:
 * const modal = new Modal();
 * modal.show({
 *   title: 'Delete Profile',
 *   message: 'Are you sure you want to delete this profile?',
 *   buttons: [
 *     { text: 'Cancel', style: 'secondary', action: 'cancel' },
 *     { text: 'Delete', style: 'danger', action: 'confirm' }
 *   ]
 * }).then(result => {
 *   if (result === 'confirm') {
 *     // Handle confirmation
 *   }
 * });
 */

export class Modal {
    constructor() {
        this.currentModal = null;
        this.currentResolve = null;
        this.isInitialized = false;
        this.init();
    }

    init() {
        if (this.isInitialized) return;
        
        // Create modal HTML structure
        const modalHTML = `
            <div id="universal-modal-overlay" class="modal-overlay">
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 id="modal-title" class="modal-title"></h3>
                        <button id="modal-close" class="modal-close-btn" aria-label="Close">
                            <span class="modal-close-icon">×</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div id="modal-icon" class="modal-icon"></div>
                        <div id="modal-message" class="modal-message"></div>
                        <div id="modal-content" class="modal-content"></div>
                    </div>
                    <div class="modal-footer">
                        <div id="modal-buttons" class="modal-buttons"></div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to body if it doesn't exist
        if (!document.getElementById('universal-modal-overlay')) {
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        // Add CSS styles
        this.addStyles();
        
        // Setup event listeners
        this.setupEventListeners();
        
        this.isInitialized = true;
    }

    addStyles() {
        if (document.getElementById('modal-styles')) return;

        const styles = `
            <style id="modal-styles">
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.2s ease;
                }

                .modal-overlay.active {
                    opacity: 1;
                    visibility: visible;
                }

                .modal-container {
                    background: var(--bg-primary, #1e1e1e);
                    border: 1px solid var(--border-color, #333);
                    border-radius: 8px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                    max-width: 500px;
                    width: 90%;
                    max-height: 80vh;
                    overflow: hidden;
                    transform: scale(0.9) translateY(-20px);
                    transition: transform 0.2s ease;
                }

                .modal-overlay.active .modal-container {
                    transform: scale(1) translateY(0);
                }

                .modal-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--border-color, #333);
                    background: var(--bg-secondary, #252525);
                }

                .modal-title {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--text-primary, #ffffff);
                }

                .modal-close-btn {
                    background: none;
                    border: none;
                    color: var(--text-secondary, #888);
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                }

                .modal-close-btn:hover {
                    background: var(--bg-quaternary, #333);
                    color: var(--text-primary, #ffffff);
                }

                .modal-close-icon {
                    font-size: 18px;
                    line-height: 1;
                }

                .modal-body {
                    padding: 20px;
                    max-height: 60vh;
                    overflow-y: auto;
                }

                .modal-icon {
                    text-align: center;
                    margin-bottom: 12px;
                    font-size: 32px;
                    line-height: 1;
                }

                .modal-icon.hidden {
                    display: none;
                }

                .modal-message {
                    color: var(--text-primary, #ffffff);
                    line-height: 1.5;
                    margin-bottom: 16px;
                    text-align: center;
                }

                .modal-message.hidden {
                    display: none;
                }

                .modal-content {
                    color: var(--text-primary, #ffffff);
                }

                .modal-content.hidden {
                    display: none;
                }

                .modal-footer {
                    padding: 16px 20px;
                    border-top: 1px solid var(--border-color, #333);
                    background: var(--bg-secondary, #252525);
                }

                .modal-buttons {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                }

                .modal-btn {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s ease;
                    min-width: 80px;
                }

                .modal-btn.primary {
                    background: var(--accent-color, #007acc);
                    color: white;
                }

                .modal-btn.primary:hover {
                    background: var(--accent-hover, #005a9e);
                }

                .modal-btn.secondary {
                    background: var(--bg-quaternary, #333);
                    color: var(--text-primary, #ffffff);
                    border: 1px solid var(--border-color, #444);
                }

                .modal-btn.secondary:hover {
                    background: var(--bg-tertiary, #404040);
                }

                .modal-btn.danger {
                    background: #dc3545;
                    color: white;
                }

                .modal-btn.danger:hover {
                    background: #c82333;
                }

                .modal-btn.success {
                    background: #28a745;
                    color: white;
                }

                .modal-btn.success:hover {
                    background: #218838;
                }

                .modal-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                /* Animation classes */
                @keyframes modalFadeIn {
                    from {
                        opacity: 0;
                        transform: scale(0.9) translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }

                @keyframes modalFadeOut {
                    from {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                    to {
                        opacity: 0;
                        transform: scale(0.9) translateY(-20px);
                    }
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    setupEventListeners() {
        const overlay = document.getElementById('universal-modal-overlay');
        const closeBtn = document.getElementById('modal-close');

        // Close on overlay click
        overlay?.addEventListener('click', (e) => {
            if (e.target.id === 'universal-modal-overlay') {
                this.close('cancel');
            }
        });

        // Close on close button click
        closeBtn?.addEventListener('click', () => {
            this.close('cancel');
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.currentModal) {
                this.close('cancel');
            }
        });
    }

    /**
     * Show modal with configuration
     * @param {Object} config - Modal configuration
     * @param {string} config.title - Modal title
     * @param {string} [config.message] - Modal message text
     * @param {string} [config.icon] - Icon to display (emoji or HTML)
     * @param {string} [config.content] - Custom HTML content
     * @param {Array} [config.buttons] - Array of button configurations
     * @param {boolean} [config.closable=true] - Whether modal can be closed
     * @param {string} [config.size='medium'] - Modal size: 'small', 'medium', 'large'
     * @returns {Promise} Promise that resolves with the action result
     */
    show(config = {}) {
        return new Promise((resolve) => {
            this.currentResolve = resolve;
            this.currentModal = config;

            const overlay = document.getElementById('universal-modal-overlay');
            const title = document.getElementById('modal-title');
            const icon = document.getElementById('modal-icon');
            const message = document.getElementById('modal-message');
            const content = document.getElementById('modal-content');
            const buttons = document.getElementById('modal-buttons');
            const closeBtn = document.getElementById('modal-close');

            // Set title
            if (title) {
                title.textContent = config.title || 'Confirm';
            }

            // Set icon
            if (icon) {
                if (config.icon) {
                    icon.innerHTML = config.icon;
                    icon.classList.remove('hidden');
                } else {
                    icon.classList.add('hidden');
                }
            }

            // Set message
            if (message) {
                if (config.message) {
                    message.textContent = config.message;
                    message.classList.remove('hidden');
                } else {
                    message.classList.add('hidden');
                }
            }

            // Set custom content
            if (content) {
                if (config.content) {
                    content.innerHTML = config.content;
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            }

            // Set up buttons
            if (buttons) {
                buttons.innerHTML = '';
                const buttonConfigs = config.buttons || [
                    { text: 'Cancel', style: 'secondary', action: 'cancel' },
                    { text: 'OK', style: 'primary', action: 'confirm' }
                ];

                buttonConfigs.forEach(btnConfig => {
                    const button = document.createElement('button');
                    button.className = `modal-btn ${btnConfig.style || 'secondary'}`;
                    button.textContent = btnConfig.text;
                    button.disabled = btnConfig.disabled || false;
                    
                    button.addEventListener('click', () => {
                        if (btnConfig.handler) {
                            btnConfig.handler();
                        }
                        this.close(btnConfig.action);
                    });

                    buttons.appendChild(button);
                });
            }

            // Handle closable option
            if (closeBtn) {
                closeBtn.style.display = config.closable === false ? 'none' : 'flex';
            }

            // Show modal
            if (overlay) {
                overlay.classList.add('active');
            }

            // Focus first button
            setTimeout(() => {
                const firstBtn = buttons?.querySelector('.modal-btn');
                if (firstBtn) {
                    firstBtn.focus();
                }
            }, 100);
        });
    }

    /**
     * Close modal with result
     * @param {string} result - The result to resolve the promise with
     */
    close(result = 'cancel') {
        const overlay = document.getElementById('universal-modal-overlay');
        
        if (overlay) {
            overlay.classList.remove('active');
        }

        if (this.currentResolve) {
            this.currentResolve(result);
            this.currentResolve = null;
        }

        this.currentModal = null;
    }

    /**
     * Convenience method for confirmation dialogs
     */
    confirm(title, message, options = {}) {
        return this.show({
            title,
            message,
            icon: options.icon || '⚠️',
            buttons: [
                { text: options.cancelText || 'Cancel', style: 'secondary', action: 'cancel' },
                { text: options.confirmText || 'Confirm', style: options.danger ? 'danger' : 'primary', action: 'confirm' }
            ],
            ...options
        });
    }

    /**
     * Convenience method for delete confirmation dialogs
     */
    confirmDelete(itemName, itemType = 'item') {
        return this.confirm(
            `Delete ${itemType}`,
            `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
            {
                icon: '🗑️',
                confirmText: 'Delete',
                danger: true
            }
        );
    }

    /**
     * Convenience method for info dialogs
     */
    info(title, message, options = {}) {
        return this.show({
            title,
            message,
            icon: options.icon || 'ℹ️',
            buttons: [
                { text: 'OK', style: 'primary', action: 'ok' }
            ],
            ...options
        });
    }

    /**
     * Convenience method for error dialogs
     */
    error(title, message, options = {}) {
        return this.show({
            title,
            message,
            icon: options.icon || '❌',
            buttons: [
                { text: 'OK', style: 'danger', action: 'ok' }
            ],
            ...options
        });
    }

    /**
     * Convenience method for success dialogs
     */
    success(title, message, options = {}) {
        return this.show({
            title,
            message,
            icon: options.icon || '✅',
            buttons: [
                { text: 'OK', style: 'success', action: 'ok' }
            ],
            ...options
        });
    }
}

// Create global instance
export const modal = new Modal();

// Make it available globally for easy access
if (typeof window !== 'undefined') {
    window.modal = modal;
} 