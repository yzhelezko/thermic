// Enhanced Status management module
import { GetPlatformInfo, GetActiveTabInfo, GetSystemStats } from '../../wailsjs/go/main/App';

export class StatusManager {
    constructor() {
        this.platformInfo = null;
        this.statusInterval = null;
        this.activeTabInfo = null;
        this.tabsManager = null;
        this.lastUpdateTime = 0;
        this.updateInterval = 3000; // Update every 3 seconds
        this.hoverTimeouts = new Map(); // For hover tooltips
        this.updateDebounceTimer = null; // For debouncing rapid updates
        this.isUpdating = false; // Prevent concurrent updates
    }

    setTabsManager(tabsManager) {
        this.tabsManager = tabsManager;
    }

    async initStatus() {
        try {
            this.platformInfo = await GetPlatformInfo();
            this.updateDisplay();
            this.startStatusUpdates();
            this.setupTooltips();
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize status:', error);
        }
    }

    setupEventListeners() {
        // Tab switch events are now handled by the global terminal manager
        // No individual listeners needed here to prevent memory leaks
        console.log('StatusManager event listeners set up (using global terminal manager)');
    }

    async updateDisplay() {
        // Prevent concurrent updates that can cause hanging
        if (this.isUpdating) {
            console.log('StatusManager: Update already in progress, skipping');
            return;
        }

        this.isUpdating = true;
        
        try {
            // Get active tab information with timeout
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Status update timeout')), 2000)
            );
            
            this.activeTabInfo = await Promise.race([
                GetActiveTabInfo(),
                timeoutPromise
            ]);
            
            // Update left side (connection info)
            this.updateConnectionInfo();
            
            // Update right side (system stats)
            this.updateSystemStats();
            
            this.lastUpdateTime = Date.now();
        } catch (error) {
            console.error('Failed to update status display:', error);
            this.showErrorState();
        } finally {
            this.isUpdating = false;
        }
    }

    showErrorState() {
        // Show error state in status bar
        const statusInfo = document.getElementById('status-info');
        const platformInfo = document.getElementById('platform-info');
        
        if (statusInfo) {
            statusInfo.textContent = 'Error loading status';
            statusInfo.className = 'status-error';
        }
        
        if (platformInfo) {
            platformInfo.textContent = 'Error loading platform info';
        }
        
        // Hide all stat elements
        document.querySelectorAll('[data-stat]').forEach(el => {
            el.style.display = 'none';
        });
        
        document.querySelectorAll('.separator').forEach(el => {
            el.style.display = 'none';
        });
    }

    updateConnectionInfo() {
        const statusInfo = document.getElementById('status-info');
        const selectedShell = document.getElementById('selected-shell');
        
        if (!statusInfo || !selectedShell) return;

        if (this.activeTabInfo && this.activeTabInfo.hasActiveTab) {
            const tab = this.activeTabInfo;
            
            if (tab.connectionType === 'ssh') {
                // SSH connection
                const connectionStatus = this.getConnectionStatusText(tab.status);
                statusInfo.textContent = connectionStatus;
                
                const sshInfo = `${tab.sshUsername || 'user'}@${tab.sshHost || 'host'}`;
                selectedShell.textContent = sshInfo;
                
                // Add status-based coloring
                statusInfo.className = `status-${tab.status || 'unknown'}`;
            } else {
                // Local shell
                statusInfo.textContent = 'Local Shell';
                statusInfo.className = 'status-connected';
                selectedShell.textContent = tab.title || 'Terminal';
            }
        } else {
            statusInfo.textContent = 'No Active Tab';
            statusInfo.className = 'status-disconnected';
            selectedShell.textContent = 'N/A';
        }
    }

    updateSystemStats() {
        const platformInfo = document.getElementById('platform-info');
        const cpuElement = document.querySelector('span[data-stat="cpu"]');
        const memElement = document.querySelector('span[data-stat="memory"]');
        const loadElement = document.querySelector('span[data-stat="load"]');
        const uptimeElement = document.querySelector('span[data-stat="uptime"]');
        const networkElement = document.querySelector('span[data-stat="network"]');

        if (!this.activeTabInfo || !this.activeTabInfo.hasActiveTab) {
            // No active tab - show local platform info or loading state
            if (platformInfo) {
                if (this.platformInfo) {
            const hostname = this.platformInfo.hostname || 'Unknown';
            platformInfo.textContent = `${this.platformInfo.os}/${this.platformInfo.arch} @ ${hostname}`;
                } else {
                    platformInfo.textContent = 'Loading platform info...';
                }
            }
            
            // Hide system stats when no active tab
            this.updateStatElement(cpuElement, 'CPU', null);
            this.updateStatElement(memElement, 'RAM', null);
            this.updateStatElement(loadElement, 'LOAD', null);
            this.updateStatElement(uptimeElement, 'UP', null);
            this.updateStatElement(networkElement, 'NET', null);
            return;
        }

        const stats = this.activeTabInfo.systemStats;
        const isRemote = this.activeTabInfo.isRemote;
        const connectionStatus = this.activeTabInfo.status;
        const connectionType = this.activeTabInfo.connectionType;

        // Debug: log what we're receiving for SSH connections
        if (connectionType === 'ssh') {
            console.log('SSH Status Debug:', {
                connectionType,
                connectionStatus,
                isRemote,
                uptime: stats?.uptime,
                load: stats?.load,
                cpu: stats?.cpu
            });
        }

        // For connections that are connecting or not fully established, hide monitoring stats
        const isConnecting = connectionStatus === 'connecting' || 
                            connectionStatus === 'failed' || 
                            connectionStatus === 'disconnected';

        // Update platform/host info - hide entire section when no real data
        if (platformInfo) {
            let hasRealData = false;
            
            if (isRemote && !isConnecting) {
                const hostname = stats.hostname;
                const arch = stats.arch;
                const kernel = stats.kernel;
                
                // Only show if we have real data (not unknown/empty)
                if (hostname && hostname !== 'unknown' && hostname !== '' && 
                    arch && arch !== 'unknown' && arch !== '') {
                    platformInfo.textContent = `${hostname} (${arch})${kernel && kernel !== 'unknown' && kernel !== '' ? ' • ' + kernel : ''}`;
                    hasRealData = true;
                }
            } else if (!isRemote && !isConnecting) {
                const hostname = this.platformInfo?.hostname || stats.hostname;
                if (hostname && hostname !== 'unknown' && hostname !== '') {
                    platformInfo.textContent = `${this.platformInfo?.os || 'Local'}/${this.platformInfo?.arch || 'unknown'} @ ${hostname}`;
                    hasRealData = true;
                }
            }
            
            // Show/hide the entire platform info section
            if (hasRealData) {
                platformInfo.style.display = 'block';
            } else {
                platformInfo.style.display = 'none';
            }
        }

        // If any connection is connecting/failed/disconnected, hide all monitoring stats IMMEDIATELY
        if (isConnecting) {
            console.log(`Hiding all stats for ${connectionType} connection with status: ${connectionStatus}`);
            
            // Hide the entire monitoring section
            const statusMonitoring = document.querySelector('.status-monitoring');
            if (statusMonitoring) {
                statusMonitoring.style.display = 'none';
            }
            return;
        }

        // Show the monitoring section since we have a connected tab
        const statusMonitoring = document.querySelector('.status-monitoring');
        if (statusMonitoring) {
            statusMonitoring.style.display = 'flex';
        }

        // Update individual stats - only show if they have real values
        this.updateStatElement(cpuElement, 'CPU', stats.cpu);
        this.updateStatElement(memElement, isRemote ? 'MEM' : 'RAM', stats.memory);
        
        if (loadElement) {
            this.updateStatElement(loadElement, 'LOAD', stats.load);
        }
        
        if (uptimeElement) {
            const uptime = this.formatUptime(stats.uptime);
            this.updateStatElement(uptimeElement, 'UP', uptime);
        }
        
        if (networkElement) {
            // Format network info to show both RX and TX
            const rxInfo = stats.network_rx || '0 MB/s';
            const txInfo = stats.network_tx || '0 MB/s';
            
            // Only show network if there's actual data (not 0.0 MB/s)
            const rxValue = parseFloat(rxInfo.replace(' MB/s', ''));
            const txValue = parseFloat(txInfo.replace(' MB/s', ''));
            
            if (rxValue > 0 || txValue > 0) {
                // Extract numeric values for display
                const rxDisplay = rxInfo.replace(' MB/s', '');
                const txDisplay = txInfo.replace(' MB/s', '');
                
                networkElement.textContent = `NET: ↓${rxDisplay} ↑${txDisplay}`;
                networkElement.style.display = 'inline';
                
                // Show the separator
                const separator = networkElement.previousElementSibling;
                if (separator && separator.classList.contains('separator')) {
                    separator.style.display = 'inline';
                }
            } else {
                // Hide network element when no activity
                this.updateStatElement(networkElement, 'NET', null);
            }
        }
        
        // Hide monitoring stats section if no real monitoring data is available
        this.toggleMonitoringStatsVisibility(stats, isRemote);
    }

    updateStatElement(element, label, value) {
        if (!element) return;
        
        // Hide element if value is unknown, null, undefined, or empty string
        // Don't hide for valid values like '0%' or '0.0' - those are legitimate data
        if (value === 'unknown' || value === null || value === undefined || value === '' || value === 'N/A') {
            element.style.display = 'none';
            // Also hide the corresponding separator
            const separator = element.previousElementSibling;
            if (separator && separator.classList.contains('separator')) {
                separator.style.display = 'none';
            }
            return;
        } else {
            element.style.display = 'inline';
            // Show the corresponding separator
            const separator = element.previousElementSibling;
            if (separator && separator.classList.contains('separator')) {
                separator.style.display = 'inline';
            }
        }
        
        element.textContent = `${label}: ${value}`;
        
        // Remove all color coding - no more usage indicators
        element.className = '';
    }

    getConnectionStatusText(status) {
        const statusMap = {
            'connecting': 'Connecting...',
            'connected': 'Connected',
            'disconnected': 'Disconnected',
            'failed': 'Connection Failed',
            'hanging': 'Connection Hanging'
        };
        return statusMap[status] || 'Unknown Status';
    }

    formatUptime(uptime) {
        if (!uptime || uptime === 'unknown') return null; // Return null instead of 'N/A' to trigger hiding
        
        // Simple uptime formatting
        if (uptime.includes('day')) {
            const days = uptime.match(/(\d+)\s*day/);
            return days ? `${days[1]}d` : uptime;
        }
        
        return uptime;
    }

    toggleMonitoringStatsVisibility(stats, isRemote) {
        // Check if we have any real monitoring data (excluding hostname)
        const hasRealMonitoringData = this.hasRealMonitoringData(stats);
        
        // Get all monitoring stat elements
        const monitoringElements = document.querySelectorAll('[data-stat]');
        
        if (hasRealMonitoringData) {
            // Show the status-right container
            const statusRight = document.querySelector('.status-right');
            if (statusRight) {
                statusRight.style.display = 'flex';
            }
        } else {
            // Hide all monitoring stat elements and their separators when no real data
            monitoringElements.forEach(element => {
                element.style.display = 'none';
                const separator = element.previousElementSibling;
                if (separator && separator.classList.contains('separator')) {
                    separator.style.display = 'none';
                }
            });
        }
    }

    hasRealMonitoringData(stats) {
        // Check if any monitoring stat has real data (not unknown/empty/null)
        // Exclude hostname as it's platform info, not monitoring data
        const monitoringStatsToCheck = ['cpu', 'memory', 'load', 'uptime'];
        
        for (const statKey of monitoringStatsToCheck) {
            const value = stats[statKey];
            if (value && value !== 'unknown' && value !== '' && value !== 'N/A') {
                return true;
            }
        }
        
        // Also check network stats
        const rxInfo = stats.network_rx || '0 MB/s';
        const txInfo = stats.network_tx || '0 MB/s';
        const rxValue = parseFloat(rxInfo.replace(' MB/s', ''));
        const txValue = parseFloat(txInfo.replace(' MB/s', ''));
        
        if (rxValue > 0 || txValue > 0) {
            return true;
        }
        
        return false;
    }

    setupTooltips() {
        // Setup tooltips for status elements - use event delegation since elements may be shown/hidden
        const statusMonitoring = document.querySelector('.status-monitoring');
        if (!statusMonitoring) return;
        
        statusMonitoring.addEventListener('mouseenter', (e) => {
            if (e.target.dataset.stat) {
                this.showTooltip(e.target);
            }
        }, true);
        
        statusMonitoring.addEventListener('mouseleave', (e) => {
            if (e.target.dataset.stat) {
                this.hideTooltip(e.target);
            }
        }, true);
    }

    showTooltip(element) {
        const stat = element.dataset.stat;
        if (!stat || !this.activeTabInfo) return;

        const stats = this.activeTabInfo.systemStats;
        const isRemote = this.activeTabInfo.isRemote;
        
        let tooltipText = '';
        
        switch (stat) {
            case 'cpu':
                const cpuCores = this.platformInfo?.num_cpu || 'unknown';
                tooltipText = `CPU Usage: ${stats.cpu}
${isRemote ? 'Remote system' : 'Local system'} processor utilization
CPU Cores: ${cpuCores}
Architecture: ${isRemote ? (stats.arch || 'unknown') : (this.platformInfo?.arch || 'unknown')}`;
                break;
            case 'memory':
                let memoryDetails = `Memory Usage: ${stats.memory}
${isRemote ? 'Remote system' : 'Local system'} RAM utilization`;
                
                // Add detailed memory information if available
                if (stats.memory_total && stats.memory_used) {
                    memoryDetails += `
Total Memory: ${stats.memory_total}
Used Memory: ${stats.memory_used}`;
                } else if (stats.memory && stats.memory !== 'unknown') {
                    const percentage = parseFloat(stats.memory.replace('%', ''));
                    if (!isNaN(percentage)) {
                        memoryDetails += `
Memory percentage: ${percentage.toFixed(1)}%`;
                    }
                }
                tooltipText = memoryDetails;
                break;
            case 'load':
                const coreCount = this.platformInfo?.num_cpu || 1;
                const loadValue = parseFloat(stats.load);
                let loadDetails = `Load Average: ${stats.load}
System load average (1 minute)
CPU cores: ${coreCount}`;
                
                if (!isNaN(loadValue)) {
                    const loadPerCore = (loadValue / coreCount).toFixed(2);
                    loadDetails += `
Load per core: ${loadPerCore}`;
                }
                tooltipText = loadDetails;
                break;
            case 'uptime':
                tooltipText = `System Uptime: ${stats.uptime}
Time since last ${isRemote ? 'remote' : 'local'} system boot
Host: ${stats.hostname || (this.platformInfo?.hostname || 'unknown')}`;
                break;
            case 'network':
                const rxInfo = stats.network_rx || '0 MB/s';
                const txInfo = stats.network_tx || '0 MB/s';
                
                // Extract numeric values for more detailed info
                const rxValue = parseFloat(rxInfo.replace(' MB/s', ''));
                const txValue = parseFloat(txInfo.replace(' MB/s', ''));
                
                tooltipText = `Network Activity:
Download: ${rxInfo} (${(rxValue * 8).toFixed(1)} Mbps)
Upload: ${txInfo} (${(txValue * 8).toFixed(1)} Mbps)
${isRemote ? 'Remote network interface' : 'Local network interfaces'}`;
                break;
        }

        if (tooltipText) {
            element.title = tooltipText;
        }
    }

    hideTooltip(element) {
        // Tooltip cleanup handled by browser
    }

    startStatusUpdates() {
        this.statusInterval = setInterval(async () => {
            await this.updateDisplay();
        }, this.updateInterval);
    }

    stopStatusUpdates() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }

    // Called when tab switches
    onTabSwitch(tabId) {
        console.log(`StatusManager: Tab switched to ${tabId}, debouncing update`);
        
        // Clear any pending update
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }
        
        // Debounce rapid tab switches to prevent hanging
        this.updateDebounceTimer = setTimeout(() => {
            console.log(`StatusManager: Executing debounced update for tab ${tabId}`);
            this.updateDisplay();
        }, 150); // Wait 150ms for rapid switching to settle
    }

    destroy() {
        this.stopStatusUpdates();
        this.hoverTimeouts.clear();
        
        // Clear any pending debounced updates
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
            this.updateDebounceTimer = null;
        }
    }
} 