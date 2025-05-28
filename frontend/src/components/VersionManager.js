/**
 * Version Manager Component
 * Handles version display, update checking, and inline upgrade functionality in the status bar
 */
class VersionManager {
    constructor() {
        // State management
        this.versionInfo = null;
        this.updateInfo = null;
        this.isCheckingUpdate = false;
        this.isDownloading = false;
        this.updateCheckInterval = null;
        this.versionContainer = null;
        
        this.init();
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    init() {
        this.loadVersionInfo();
        this.initStatusBarIntegration();
        this.startAutomaticUpdateChecking();
    }

    async loadVersionInfo() {
        try {
            console.log('Loading version info...');
            this.versionInfo = await window.go.main.App.GetVersionInfo();
            console.log('Version info loaded:', this.versionInfo);
            this.updateStatusBarVersion();
        } catch (error) {
            console.error('Failed to load version info:', error);
            // Set default version info so UI still works
            this.versionInfo = {
                version: 'dev',
                gitCommit: 'unknown',
                buildDate: new Date().toISOString(),
                platform: 'unknown',
                arch: 'unknown'
            };
            this.updateStatusBarVersion();
        }
    }

    initStatusBarIntegration() {
        // Add a small delay to ensure status bar is fully initialized
        setTimeout(() => {
            this.addVersionToStatusBar();
            this.triggerStartupUpdateCheck();
        }, 100);
    }

    addVersionToStatusBar() {
        const statusVersion = document.querySelector('.status-version');
        
        if (statusVersion) {
            // Check if version container already exists
            const existingContainer = document.getElementById('version-container');
            if (existingContainer) {
                this.versionContainer = existingContainer;
                this.updateStatusBarVersion();
                return;
            }
            
            // Add separator
            const separator = document.createElement('span');
            separator.textContent = '•';
            statusVersion.appendChild(separator);
            
            // Create version container
            const versionContainer = document.createElement('span');
            versionContainer.id = 'version-container';
            versionContainer.className = 'version-container';
            statusVersion.appendChild(versionContainer);
            
            this.versionContainer = versionContainer;
            this.updateStatusBarVersion();
        } else {
            // Retry after delay if status bar not ready
            setTimeout(() => this.addVersionToStatusBar(), 1000);
        }
    }

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================

    updateStatusBarVersion() {
        if (!this.versionContainer) return;
        
        const currentState = this.versionContainer.getAttribute('data-state') || 'normal';
        
        if (this.isDownloading) {
            this.showProgressState();
        } else if (this.updateInfo && this.updateInfo.available) {
            // Always show upgrade if available (unless in confirmation state)
            if (currentState !== 'confirming') {
                this.showUpgradeAvailableState();
            }
        } else {
            this.showNormalState();
        }
    }

    // =========================================================================
    // UI STATE RENDERERS
    // =========================================================================

    showNormalState() {
        const version = this.versionInfo ? this.versionInfo.version : 'Loading...';
        
        this.versionContainer.innerHTML = `
            <span class="version-display" title="Click to check for updates">${version}</span>
        `;
        this.versionContainer.setAttribute('data-state', 'normal');
        
        // Add click handler and tooltip
        const versionDisplay = this.versionContainer.querySelector('.version-display');
        versionDisplay.onclick = () => this.checkForUpdatesManually();
        this.setupVersionTooltip(versionDisplay);
    }

    showUpgradeAvailableState() {
        this.versionContainer.innerHTML = `
            <span class="version-upgrade-btn" title="Click to upgrade to ${this.updateInfo.latestVersion}">
                Upgrade to ${this.updateInfo.latestVersion}
            </span>
        `;
        this.versionContainer.setAttribute('data-state', 'upgrade-available');
        
        const upgradeBtn = this.versionContainer.querySelector('.version-upgrade-btn');
        upgradeBtn.onclick = () => this.showConfirmationState();
    }

    showConfirmationState() {
        this.versionContainer.innerHTML = `
            <span class="version-confirm-btns">
                <button class="version-btn version-approve" title="Download and install update">✓</button>
                <button class="version-btn version-deny" title="Cancel update">✕</button>
            </span>
        `;
        this.versionContainer.setAttribute('data-state', 'confirming');
        
        const approveBtn = this.versionContainer.querySelector('.version-approve');
        const denyBtn = this.versionContainer.querySelector('.version-deny');
        
        approveBtn.onclick = () => this.startInlineUpgrade();
        denyBtn.onclick = () => {
            this.versionContainer.setAttribute('data-state', 'normal');
            this.updateStatusBarVersion();
        };
    }

    showProgressState() {
        this.versionContainer.innerHTML = `
            <span class="version-progress-container">
                <span class="version-progress-text">Downloading</span>
                <div class="version-progress-bar">
                    <div class="version-progress-fill"></div>
                </div>
            </span>
        `;
        this.versionContainer.setAttribute('data-state', 'downloading');
    }

    showRestartingState() {
        this.versionContainer.innerHTML = `
            <span class="version-restarting">Restarting application...</span>
        `;
        this.versionContainer.setAttribute('data-state', 'restarting');
    }

    setupVersionTooltip(element) {
        if (!this.versionInfo) return;
        
        const tooltipContent = `
Version: ${this.versionInfo.version}
Build: ${new Date(this.versionInfo.buildDate).toLocaleDateString()}
Commit: ${this.versionInfo.gitCommit.substring(0, 8)}
Platform: ${this.versionInfo.platform}/${this.versionInfo.arch}
        `.trim();
        
        element.title = tooltipContent;
    }

    // =========================================================================
    // UPDATE LOGIC
    // =========================================================================

    async startInlineUpgrade() {
        if (!this.updateInfo || !this.updateInfo.available) return;
        
        this.isDownloading = true;
        this.showProgressState();
        
        try {
            await window.go.main.App.DownloadAndInstallUpdate(this.updateInfo.downloadUrl);
            this.showRestartingState();
            
            // Restart after brief delay
            setTimeout(async () => {
                try {
                    await window.go.main.App.RestartApplication();
                } catch (error) {
                    console.error('Failed to restart application:', error);
                    this.versionContainer.innerHTML = `
                        <span class="version-error" title="Restart failed. Please restart manually.">Update complete - Restart manually</span>
                    `;
                }
            }, 2000);
            
        } catch (error) {
            console.error('Failed to download/install update:', error);
            this.isDownloading = false;
            this.versionContainer.innerHTML = `
                <span class="version-error" title="Update failed: ${error}">Update failed</span>
            `;
            
            // Return to normal state after delay
            setTimeout(() => this.showNormalState(), 3000);
        }
    }

    // =========================================================================
    // UPDATE CHECKING
    // =========================================================================

    triggerStartupUpdateCheck() {
        setTimeout(() => this.checkForUpdatesInBackground(), 2000);
    }

    startAutomaticUpdateChecking() {
        // Set up periodic checking every hour
        this.updateCheckInterval = setInterval(() => {
            this.checkForUpdatesInBackground();
        }, 60 * 60 * 1000);
    }

    async checkForUpdatesInBackground() {
        if (this.isCheckingUpdate) return;
        
        this.isCheckingUpdate = true;
        
        try {
            console.log('Checking for updates in background...');
            this.updateInfo = await window.go.main.App.CheckForUpdates();
            console.log('Background update check result:', this.updateInfo);
            
            if (this.updateInfo && this.updateInfo.available) {
                console.log(`Background update found: ${this.updateInfo.latestVersion}`);
                this.updateStatusBarVersion();
            } else {
                console.log('Background check: No updates available');
            }
        } catch (error) {
            console.error('Background update check failed:', error);
        } finally {
            this.isCheckingUpdate = false;
        }
    }

    async checkForUpdatesManually() {
        if (this.isCheckingUpdate) return;
        
        console.log('Manually checking for updates...');
        
        // Show checking state
        this.versionContainer.innerHTML = `
            <span class="version-checking" title="Checking for updates...">Checking...</span>
        `;
        
        this.isCheckingUpdate = true;
        
        try {
            this.updateInfo = await window.go.main.App.CheckForUpdates();
            console.log('Manual update check result:', this.updateInfo);
            
            if (this.updateInfo && this.updateInfo.available) {
                console.log(`Update found: ${this.updateInfo.latestVersion}`);
                this.showUpgradeAvailableState();
            } else {
                console.log('No updates available');
                this.versionContainer.innerHTML = `
                    <span class="version-no-update" title="You have the latest version">Up to date</span>
                `;
                setTimeout(() => this.showNormalState(), 2000);
            }
        } catch (error) {
            console.error('Manual update check failed:', error);
            this.versionContainer.innerHTML = `
                <span class="version-error" title="Failed to check for updates">Check failed</span>
            `;
            setTimeout(() => this.showNormalState(), 2000);
        } finally {
            this.isCheckingUpdate = false;
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    destroy() {
        if (this.updateCheckInterval) {
            clearInterval(this.updateCheckInterval);
            this.updateCheckInterval = null;
        }
    }
}

// Create global instance
window.versionManager = new VersionManager();

export default VersionManager; 