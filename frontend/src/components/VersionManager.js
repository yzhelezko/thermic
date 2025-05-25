// Version Manager Component
class VersionManager {
    constructor() {
        this.versionInfo = null;
        this.updateInfo = null;
        this.isCheckingUpdate = false;
        this.isDownloading = false;
        this.downloadProgress = 0;
        this.updateCheckInterval = null;
        this.statusBarElement = null;
        
        this.init();
    }

    init() {
        // Get current version info on startup
        this.loadVersionInfo();
        
        // Initialize status bar integration
        this.initStatusBarIntegration();
        
        // Start automatic update checking
        this.startAutomaticUpdateChecking();
    }

    async loadVersionInfo() {
        try {
            this.versionInfo = await window.go.main.App.GetVersionInfo();
            this.updateStatusBarVersion();
        } catch (error) {
            console.error('Failed to load version info:', error);
            this.updateStatusBarVersion();
        }
    }

    initStatusBarIntegration() {
        // Wait for DOM to be ready, then add version to status bar
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.addVersionToStatusBar());
        } else {
            this.addVersionToStatusBar();
        }
    }

    addVersionToStatusBar() {
        const statusRight = document.querySelector('.status-right');
        if (statusRight) {
            // Add version element to the right side of status bar
            const versionElement = document.createElement('span');
            versionElement.id = 'version-status';
            versionElement.className = 'version-status-display';
            versionElement.textContent = 'Loading...';
            versionElement.style.cursor = 'pointer';
            versionElement.style.userSelect = 'none';
            
            // Add separator and version
            const separator = document.createElement('span');
            separator.textContent = '•';
            
            statusRight.appendChild(separator);
            statusRight.appendChild(versionElement);
            
            this.statusBarElement = versionElement;
            this.updateStatusBarVersion();
        }
    }

    updateStatusBarVersion() {
        if (this.statusBarElement) {
            if (this.updateInfo && this.updateInfo.available) {
                // Show upgrade button
                this.statusBarElement.textContent = `Upgrade to ${this.updateInfo.latestVersion}`;
                this.statusBarElement.className = 'version-status-upgrade';
                this.statusBarElement.onclick = () => this.handleUpgradeClick();
            } else {
                // Show current version
                const version = this.versionInfo ? this.versionInfo.version : 'Unknown';
                this.statusBarElement.textContent = version;
                this.statusBarElement.className = 'version-status-display';
                this.statusBarElement.onclick = () => this.showVersionDialog();
            }
        }
    }

    startAutomaticUpdateChecking() {
        // Check for updates on startup (after 5 seconds delay)
        setTimeout(() => {
            this.checkForUpdatesInBackground();
        }, 5000);

        // Set up periodic checking every hour
        this.updateCheckInterval = setInterval(() => {
            this.checkForUpdatesInBackground();
        }, 60 * 60 * 1000); // 1 hour in milliseconds
    }

    async checkForUpdatesInBackground() {
        if (this.isCheckingUpdate) return;
        
        try {
            console.log('Checking for updates in background...');
            this.updateInfo = await window.go.main.App.CheckForUpdates();
            this.updateStatusBarVersion();
            
            if (this.updateInfo.available) {
                console.log(`Update available: ${this.updateInfo.latestVersion}`);
                // Optionally show a subtle notification
                this.showUpdateAvailableNotification();
            }
        } catch (error) {
            console.error('Background update check failed:', error);
        }
    }

    showUpdateAvailableNotification() {
        // Create a subtle notification that doesn't interrupt the user
        const notification = document.createElement('div');
        notification.className = 'update-available-notification toast';
        notification.innerHTML = `
            <div class="toast-header">
                <strong>Update Available</strong>
                <button class="close-toast">&times;</button>
            </div>
            <div class="toast-body">
                Version ${this.updateInfo.latestVersion} is available. Check the status bar to upgrade.
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 8000);

        // Close button
        notification.querySelector('.close-toast').addEventListener('click', () => {
            notification.parentNode.removeChild(notification);
        });
    }

    handleUpgradeClick() {
        // Show upgrade dialog/modal
        this.showUpgradeModal();
    }

    showUpgradeModal() {
        const modal = document.createElement('div');
        modal.className = 'upgrade-modal modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Update Available</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="update-info">
                        <p><strong>Current Version:</strong> ${this.versionInfo ? this.versionInfo.version : 'Unknown'}</p>
                        <p><strong>Latest Version:</strong> ${this.updateInfo.latestVersion}</p>
                        <p><strong>Download Size:</strong> ${this.formatBytes(this.updateInfo.size)}</p>
                        
                        <div class="release-notes">
                            <p><strong>Release Notes:</strong></p>
                            <div class="notes-content">${this.formatMarkdown(this.updateInfo.releaseNotes)}</div>
                        </div>
                    </div>
                    
                    <div id="upgrade-progress" class="download-progress" style="display: none;">
                        <p>Downloading and installing update...</p>
                        <div class="progress-bar">
                            <div id="upgrade-progress-fill" class="progress-fill"></div>
                        </div>
                        <p class="progress-text">This may take a few minutes</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="start-upgrade-btn" class="btn btn-success">Download & Install</button>
                    <button id="cancel-upgrade-btn" class="btn btn-secondary">Cancel</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event handlers
        modal.querySelector('.modal-close').onclick = () => this.closeModal(modal);
        modal.querySelector('#cancel-upgrade-btn').onclick = () => this.closeModal(modal);
        modal.querySelector('#start-upgrade-btn').onclick = () => this.startUpgradeFromModal(modal);
        
        // Close on outside click
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.closeModal(modal);
            }
        };
    }

    closeModal(modal) {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    }

    async startUpgradeFromModal(modal) {
        const startBtn = modal.querySelector('#start-upgrade-btn');
        const cancelBtn = modal.querySelector('#cancel-upgrade-btn');
        const progressDiv = modal.querySelector('#upgrade-progress');
        const bodyDiv = modal.querySelector('.modal-body .update-info');
        
        // Disable buttons and show progress
        startBtn.disabled = true;
        cancelBtn.disabled = true;
        bodyDiv.style.display = 'none';
        progressDiv.style.display = 'block';
        
        try {
            this.isDownloading = true;
            await window.go.main.App.DownloadAndInstallUpdate(this.updateInfo.downloadUrl);
            
            // If we reach here, download completed successfully
            this.closeModal(modal);
            this.showRestartPrompt();
        } catch (error) {
            console.error('Failed to download/install update:', error);
            this.isDownloading = false;
            
            // Reset UI
            bodyDiv.style.display = 'block';
            progressDiv.style.display = 'none';
            startBtn.disabled = false;
            cancelBtn.disabled = false;
            
            this.showErrorNotification('Failed to install update: ' + error);
        }
    }

    showVersionDialog() {
        // Create version info dialog
        const modal = document.createElement('div');
        modal.className = 'version-info-modal modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Version Information</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="version-details">
                        <div class="version-item">
                            <span class="label">Version:</span>
                            <span class="value">${this.versionInfo ? this.versionInfo.version : 'Unknown'}</span>
                        </div>
                        <div class="version-item">
                            <span class="label">Build Date:</span>
                            <span class="value">${this.versionInfo ? new Date(this.versionInfo.buildDate).toLocaleString() : 'Unknown'}</span>
                        </div>
                        <div class="version-item">
                            <span class="label">Git Commit:</span>
                            <span class="value">${this.versionInfo ? this.versionInfo.gitCommit.substring(0, 8) : 'Unknown'}</span>
                        </div>
                        <div class="version-item">
                            <span class="label">Platform:</span>
                            <span class="value">${this.versionInfo ? `${this.versionInfo.platform}/${this.versionInfo.arch}` : 'Unknown'}</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="check-updates-manual-btn" class="btn btn-primary">Check for Updates</button>
                    <button id="close-version-btn" class="btn btn-secondary">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event handlers
        modal.querySelector('.modal-close').onclick = () => this.closeModal(modal);
        modal.querySelector('#close-version-btn').onclick = () => this.closeModal(modal);
        modal.querySelector('#check-updates-manual-btn').onclick = () => this.manualCheckForUpdates(modal);
        
        // Close on outside click
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.closeModal(modal);
            }
        };
    }

    async manualCheckForUpdates(modal) {
        const checkBtn = modal.querySelector('#check-updates-manual-btn');
        checkBtn.disabled = true;
        checkBtn.textContent = 'Checking...';
        
        try {
            this.updateInfo = await window.go.main.App.CheckForUpdates();
            this.updateStatusBarVersion();
            
            if (this.updateInfo.available) {
                this.closeModal(modal);
                this.showUpgradeModal();
            } else {
                checkBtn.textContent = 'No updates available';
                setTimeout(() => {
                    checkBtn.textContent = 'Check for Updates';
                    checkBtn.disabled = false;
                }, 2000);
            }
        } catch (error) {
            console.error('Failed to check for updates:', error);
            checkBtn.textContent = 'Check failed';
            setTimeout(() => {
                checkBtn.textContent = 'Check for Updates';
                checkBtn.disabled = false;
            }, 2000);
        }
    }

    // Cleanup method
    destroy() {
        if (this.updateCheckInterval) {
            clearInterval(this.updateCheckInterval);
            this.updateCheckInterval = null;
        }
    }

    async checkForUpdates() {
        if (this.isCheckingUpdate) return;
        
        this.isCheckingUpdate = true;
        
        try {
            this.updateInfo = await window.go.main.App.CheckForUpdates();
            this.updateStatusBarVersion();
            
            if (this.updateInfo.available) {
                this.showUpdateNotification();
            }
        } catch (error) {
            console.error('Failed to check for updates:', error);
            this.showErrorNotification('Failed to check for updates: ' + error);
        } finally {
            this.isCheckingUpdate = false;
        }
    }

    async downloadAndInstallUpdate() {
        if (!this.updateInfo || !this.updateInfo.available || this.isDownloading) {
            return;
        }

        this.isDownloading = true;

        try {
            // Start download
            await window.go.main.App.DownloadAndInstallUpdate(this.updateInfo.downloadUrl);
            
            // If we reach here, download completed successfully
            this.showRestartPrompt();
        } catch (error) {
            console.error('Failed to download/install update:', error);
            this.showErrorNotification('Failed to install update: ' + error);
        } finally {
            this.isDownloading = false;
        }
    }

    async restartApplication() {
        try {
            await window.go.main.App.RestartApplication();
        } catch (error) {
            console.error('Failed to restart application:', error);
            this.showErrorNotification('Failed to restart application: ' + error);
        }
    }



    showUpdateNotification() {
        // Create a toast notification
        const notification = document.createElement('div');
        notification.className = 'update-notification toast';
        notification.innerHTML = `
            <div class="toast-header">
                <strong>Update Available</strong>
                <button class="close-toast">&times;</button>
            </div>
            <div class="toast-body">
                Version ${this.updateInfo.latestVersion} is now available! Check the status bar to upgrade.
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 8000);

        // Close button
        notification.querySelector('.close-toast').addEventListener('click', () => {
            notification.parentNode.removeChild(notification);
        });
    }

    showRestartPrompt() {
        const modal = document.createElement('div');
        modal.className = 'update-modal modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Update Installed Successfully</h3>
                </div>
                <div class="modal-body">
                    <p>The update has been downloaded and installed. Please restart the application to complete the update.</p>
                </div>
                <div class="modal-footer">
                    <button id="restart-now-btn" class="btn btn-primary">Restart Now</button>
                    <button id="restart-later-btn" class="btn btn-secondary">Restart Later</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('#restart-now-btn').addEventListener('click', () => {
            this.restartApplication();
        });
        
        modal.querySelector('#restart-later-btn').addEventListener('click', () => {
            modal.parentNode.removeChild(modal);
        });
    }

    showErrorNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'error-notification toast error';
        notification.innerHTML = `
            <div class="toast-header">
                <strong>Update Error</strong>
                <button class="close-toast">&times;</button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 8000);

        notification.querySelector('.close-toast').addEventListener('click', () => {
            notification.parentNode.removeChild(notification);
        });
    }



    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatMarkdown(text) {
        // Simple markdown formatting for release notes
        return text
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*)\*/gim, '<em>$1</em>')
            .replace(/\n/gim, '<br>');
    }
}

// Create global instance
window.versionManager = new VersionManager();

export default VersionManager; 