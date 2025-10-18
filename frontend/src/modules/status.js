// Enhanced Status management module
import { GetPlatformInfo, GetActiveTabInfo, GetSystemStats, GetMetricHistory, SetUpdateRate } from '../../wailsjs/go/main/App';
import { GraphModal } from '../components/GraphModal.js';

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
        
        // Graph modal for hover visualization
        this.graphModal = new GraphModal();
        this.hoveredMetric = null;
        this.hoverUpdateInterval = null;
        this.originalUpdateRate = 3000;
        this.hoverDebounceTimer = null;
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
        }
    }

    updateSystemStats() {
        const platformInfo = document.getElementById('platform-info');
        const systemElement = document.querySelector('span[data-stat="system"]');
        const diskUsageElement = document.querySelector('span[data-stat="disk-usage"]');
        const diskIOElement = document.querySelector('span[data-stat="disk-io"]');
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
            this.updateStatElement(systemElement, 'SYSTEM', null);
            this.updateStatElement(diskUsageElement, 'DISK', null);
            this.updateStatElement(diskIOElement, 'DISK I/O', null);
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

        // Update combined system stats (CPU + Memory + Load)
        if (systemElement) {
            this.updateCombinedSystemElement(systemElement, stats);
        }
        
        // Update disk stats
        if (diskUsageElement) {
            this.updateStatElement(diskUsageElement, 'DISK', stats.disk_usage);
        }
        
        if (diskIOElement) {
            // Format disk I/O to show both read and write
            const diskRead = stats.disk_read || '0 MB/s';
            const diskWrite = stats.disk_write || '0 MB/s';
            
            // Extract numeric values
            const readValue = parseFloat(diskRead.replace(' MB/s', ''));
            const writeValue = parseFloat(diskWrite.replace(' MB/s', ''));
            
            if (readValue > 0 || writeValue > 0) {
                // Extract numeric values for display
                const readDisplay = diskRead.replace(' MB/s', '');
                const writeDisplay = diskWrite.replace(' MB/s', '');
                
                diskIOElement.textContent = `↓${readDisplay} ↑${writeDisplay}`;
                diskIOElement.style.display = 'inline';
                
                // Show the separator
                const separator = diskIOElement.previousElementSibling;
                if (separator && separator.classList.contains('separator')) {
                    separator.style.display = 'inline';
                }
            } else {
                // Hide disk I/O element when no activity
                this.updateStatElement(diskIOElement, 'DISK I/O', null);
            }
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

    updateCombinedSystemElement(element, stats) {
        if (!element) return;
        
        // Parse CPU (percentage)
        const cpu = stats.cpu || 'unknown';
        const cpuValue = cpu !== 'unknown' ? cpu.replace('%', '') : '0';
        
        // Parse Memory (convert to MB, then to GB if large)
        const memory = stats.memory || 'unknown';
        const memoryUsed = stats.memory_used || 'unknown';
        let memoryDisplay = '0Mb';
        
        if (memoryUsed !== 'unknown') {
            // memory_used is in format "405 MB" or "1.2 GB"
            const memMatch = memoryUsed.match(/^([\d.]+)\s*(MB|GB)/i);
            if (memMatch) {
                const value = parseFloat(memMatch[1]);
                const unit = memMatch[2].toUpperCase();
                const memoryMB = unit === 'GB' ? value * 1024 : value;
                
                // If >= 1024 MB, show as GB
                if (memoryMB >= 1024) {
                    memoryDisplay = `${(memoryMB / 1024).toFixed(2)}Gb`;
                } else {
                    memoryDisplay = `${Math.round(memoryMB)}Mb`;
                }
            }
        }
        
        // Parse Load (float)
        const load = stats.load || 'unknown';
        const loadValue = load !== 'unknown' ? load : '0.0';
        
        // Check if we have real data
        const hasRealData = cpu !== 'unknown' || memory !== 'unknown' || load !== 'unknown';
        
        if (!hasRealData) {
            element.style.display = 'none';
            const separator = element.previousElementSibling;
            if (separator && separator.classList.contains('separator')) {
                separator.style.display = 'none';
            }
            return;
        }
        
        // Format: "CPU: 10% RAM: 20.03Gb L: 1.2" or "CPU: 10% RAM: 405Mb L: 1.2"
        element.textContent = `CPU: ${cpuValue}% RAM: ${memoryDisplay} L: ${loadValue}`;
        element.style.display = 'inline';
        
        const separator = element.previousElementSibling;
        if (separator && separator.classList.contains('separator')) {
            separator.style.display = 'inline';
        }
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
        // Setup hover handlers for metric graphs - use event delegation since elements may be shown/hidden
        const statusMonitoring = document.querySelector('.status-monitoring');
        if (!statusMonitoring) return;
        
        statusMonitoring.addEventListener('mouseenter', (e) => {
            if (e.target.dataset.stat) {
                this.onMetricHover(e.target);
            }
        }, true);
        
        statusMonitoring.addEventListener('mouseleave', (e) => {
            if (e.target.dataset.stat) {
                this.onMetricLeave(e.target);
            }
        }, true);
    }

    async onMetricHover(element) {
        const metric = element.dataset.stat;
        if (!metric || !this.activeTabInfo) return;
        
        // Debounce hover events
        if (this.hoverDebounceTimer) {
            clearTimeout(this.hoverDebounceTimer);
        }
        
        this.hoverDebounceTimer = setTimeout(async () => {
            this.hoveredMetric = metric;
            
            // Get current session ID - use sessionId from active tab (not tabId!)
            const sessionID = this.activeTabInfo.sessionId;
            if (!sessionID) {
                console.warn('No sessionId found in activeTabInfo:', this.activeTabInfo);
                return;
            }
            
            console.log('Hovering over metric:', metric, 'for session:', sessionID);
            
            try {
                let history;
                
                // Handle combined system metric (CPU + Memory + Load)
                if (metric === 'system') {
                    // Fetch all three metrics in parallel
                    const [cpuHistory, memoryHistory, loadHistory] = await Promise.all([
                        GetMetricHistory(sessionID, 'cpu'),
                        GetMetricHistory(sessionID, 'memory'),
                        GetMetricHistory(sessionID, 'load')
                    ]);
                    
                    // Combine into multi-metric format
                    history = {
                        cpu: cpuHistory,
                        memory: memoryHistory,
                        load: loadHistory
                    };
                    
                    console.log('Got multi-metric history:', history);
                } else {
                    // Single metric fetch
                    history = await GetMetricHistory(sessionID, metric);
                    console.log('Got history:', history);
                }
                
                // Show graph modal with history
                this.graphModal.show(metric, element, history);
                
                // Switch to 500ms update rate
                await SetUpdateRate(sessionID, 500);
                
                // Start rapid update loop for graph
                this.startHoverUpdateLoop(sessionID, metric);
                
            } catch (error) {
                console.error('Failed to fetch metric history:', error);
            }
        }, 100); // 100ms debounce
    }

    onMetricLeave(element) {
        // Clear debounce timer
        if (this.hoverDebounceTimer) {
            clearTimeout(this.hoverDebounceTimer);
            this.hoverDebounceTimer = null;
        }
        
        // Hide graph modal
        this.graphModal.hide();
        
        // Stop hover update loop
        this.stopHoverUpdateLoop();
        
        // Restore original update rate
        if (this.activeTabInfo && this.hoveredMetric) {
            const sessionID = this.activeTabInfo.sessionId;
            if (sessionID) {
                SetUpdateRate(sessionID, this.originalUpdateRate).catch(err => {
                    console.warn('Failed to restore update rate:', err);
                });
            }
        }
        
        this.hoveredMetric = null;
    }

    startHoverUpdateLoop(sessionID, metric) {
        // Clear any existing loop
        this.stopHoverUpdateLoop();
        
        // Update graph every 500ms
        this.hoverUpdateInterval = setInterval(async () => {
            try {
                let history;
                
                // Handle combined system metric
                if (metric === 'system') {
                    const [cpuHistory, memoryHistory, loadHistory] = await Promise.all([
                        GetMetricHistory(sessionID, 'cpu'),
                        GetMetricHistory(sessionID, 'memory'),
                        GetMetricHistory(sessionID, 'load')
                    ]);
                    
                    history = {
                        cpu: cpuHistory,
                        memory: memoryHistory,
                        load: loadHistory
                    };
                } else {
                    history = await GetMetricHistory(sessionID, metric);
                }
                
                this.graphModal.update(history);
            } catch (error) {
                console.error('Failed to update metric history:', error);
            }
        }, 500);
    }

    stopHoverUpdateLoop() {
        if (this.hoverUpdateInterval) {
            clearInterval(this.hoverUpdateInterval);
            this.hoverUpdateInterval = null;
        }
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
        
        // Clean up hover state
        this.stopHoverUpdateLoop();
        if (this.hoverDebounceTimer) {
            clearTimeout(this.hoverDebounceTimer);
            this.hoverDebounceTimer = null;
        }
        
        // Destroy graph modal
        if (this.graphModal) {
            this.graphModal.destroy();
        }
    }
} 