/**
 * Version Manager Component
 * Handles version display, update checking, and inline upgrade functionality in the status bar
 */

// Import Wails bindings properly
import { GetVersionInfo, CheckForUpdates, DownloadAndInstallUpdate } from '../../wailsjs/go/main/App';

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
            this.versionInfo = await GetVersionInfo();
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
            
            // Create version container (no separator needed - using gap spacing)
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
            await DownloadAndInstallUpdate(this.updateInfo.downloadUrl);
            
            // Show restarting state
            this.showRestartingState();
            
            // The application should restart automatically after download
            // If it doesn't restart within 10 seconds, show error
            setTimeout(() => {
                if (this.isDownloading) {
                    console.error('Application did not restart after update');
                    this.isDownloading = false;
                    this.updateStatusBarVersion();
                }
            }, 10000);
            
        } catch (error) {
            console.error('Failed to download and install update:', error);
            this.isDownloading = false;
            this.updateStatusBarVersion();
        }
    }

    // =========================================================================
    // UPDATE CHECKING
    // =========================================================================

    triggerStartupUpdateCheck() {
        // Check for updates 5 seconds after startup
        setTimeout(() => this.checkForUpdatesInBackground(), 5000);
    }

    startAutomaticUpdateChecking() {
        // Check for updates every 6 hours
        this.updateCheckInterval = setInterval(() => {
            this.checkForUpdatesInBackground();
        }, 6 * 60 * 60 * 1000);
    }

    async checkForUpdatesInBackground() {
        if (this.isCheckingUpdate || this.isDownloading) return;
        
        this.isCheckingUpdate = true;
        
        try {
            console.log('Checking for updates in background...');
            this.updateInfo = await CheckForUpdates();
            
            if (this.updateInfo && this.updateInfo.available) {
                console.log('Update available:', this.updateInfo);
                this.updateStatusBarVersion();
            } else {
                console.log('No updates available');
            }
        } catch (error) {
            console.error('Background update check failed:', error);
        } finally {
            this.isCheckingUpdate = false;
        }
    }

    async checkForUpdatesManually() {
        if (this.isCheckingUpdate || this.isDownloading) return;
        
        this.isCheckingUpdate = true;
        
        // Show checking state temporarily
        const originalText = this.versionContainer.innerHTML;
        this.versionContainer.innerHTML = '<span class="version-checking">Checking...</span>';
        
        try {
            console.log('Manually checking for updates...');
            this.updateInfo = await CheckForUpdates();
            
            if (this.updateInfo && this.updateInfo.available) {
                console.log('Update available:', this.updateInfo);
                this.updateStatusBarVersion();
            } else {
                console.log('No updates available');
                // Show "Up to date" message briefly
                this.versionContainer.innerHTML = '<span class="version-up-to-date">Up to date</span>';
                setTimeout(() => {
                    this.updateStatusBarVersion();
                }, 2000);
            }
        } catch (error) {
            console.error('Manual update check failed:', error);
            // Restore original state on error
            this.versionContainer.innerHTML = originalText;
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

// Export for use in other modules
export default VersionManager; 