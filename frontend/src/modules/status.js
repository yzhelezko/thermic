// Enhanced Status management module
import { GetPlatformInfo, GetActiveTabInfo, GetSystemStats, GetMetricHistory, SetUpdateRate, GetSystemMetadata } from '../../wailsjs/go/main/App';
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
        this.hoverLoopSessionID = null; // Track which session the hover loop is for
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

        // For connections that are connecting or not fully established, show loading state
        const isConnecting = connectionStatus === 'connecting';
        const isFailed = connectionStatus === 'failed' || connectionStatus === 'disconnected';

        // Update platform/host info - show loading or actual data
        if (platformInfo) {
            let hasRealData = false;
            
            if (isRemote && !isConnecting && !isFailed) {
                const hostname = stats.hostname;
                const arch = stats.arch;
                const kernel = stats.kernel;
                
                // Only show if we have real data (not unknown/empty)
                if (hostname && hostname !== 'unknown' && hostname !== '' && 
                    arch && arch !== 'unknown' && arch !== '') {
                    platformInfo.textContent = `${hostname} (${arch})${kernel && kernel !== 'unknown' && kernel !== '' ? ' • ' + kernel : ''}`;
                    hasRealData = true;
                }
            } else if (!isRemote && !isConnecting && !isFailed) {
                const hostname = this.platformInfo?.hostname || stats.hostname;
                if (hostname && hostname !== 'unknown' && hostname !== '') {
                    platformInfo.textContent = `${this.platformInfo?.os || 'Local'}/${this.platformInfo?.arch || 'unknown'} @ ${hostname}`;
                    hasRealData = true;
                }
            }
            
            // Show loading state for connecting
            if (isConnecting) {
                platformInfo.textContent = 'Connecting...';
                platformInfo.style.display = 'block';
            } else if (hasRealData) {
                platformInfo.style.display = 'block';
            } else {
                platformInfo.style.display = 'none';
            }
        }

        // Show the monitoring section
        const statusMonitoring = document.querySelector('.status-monitoring');
        if (statusMonitoring) {
            statusMonitoring.style.display = 'flex';
        }

        // If connecting, show loading indicators
        if (isConnecting) {
            console.log(`Showing loading state for ${connectionType} connection`);
            
            // Show "Loading..." in all stat elements
            this.updateStatElement(systemElement, 'SYSTEM', 'Loading...');
            this.updateStatElement(diskIOElement, 'DIS', 'Loading...');
            this.updateStatElement(networkElement, 'NET', 'Loading...');
            return;
        }

        // If failed/disconnected, hide monitoring stats
        if (isFailed) {
            console.log(`Hiding all stats for ${connectionType} connection with status: ${connectionStatus}`);
            
            // Hide the entire monitoring section
            if (statusMonitoring) {
                statusMonitoring.style.display = 'none';
            }
            return;
        }

        // Update combined system stats (CPU + Memory + Load)
        if (systemElement) {
            this.updateCombinedSystemElement(systemElement, stats);
        }
        
        // Disk usage element removed from status bar
        // diskUsageElement is no longer used
        
        if (diskIOElement) {
            // Format disk I/O to show both read and write
            // Filter out 'unknown' and use '0 MB/s' as default
            let diskRead = stats.disk_read || '0 MB/s';
            let diskWrite = stats.disk_write || '0 MB/s';
            
            // Replace 'unknown' with '0 MB/s' to prevent layout jumping
            if (diskRead === 'unknown' || diskRead === 'N/A') diskRead = '0 MB/s';
            if (diskWrite === 'unknown' || diskWrite === 'N/A') diskWrite = '0 MB/s';
            
            // Extract numeric values for display
            const readDisplay = diskRead.replace(' MB/s', '');
            const writeDisplay = diskWrite.replace(' MB/s', '');
            
            // Always show disk I/O, even when zero (prevents layout jumping)
            diskIOElement.textContent = `DIS: ↓${readDisplay} MB/s ↑${writeDisplay} MB/s`;
            diskIOElement.style.display = 'inline';
        }
        
        if (networkElement) {
            // Format network info to show both RX and TX
            // Filter out 'unknown' and use '0 MB/s' as default
            let rxInfo = stats.network_rx || '0 MB/s';
            let txInfo = stats.network_tx || '0 MB/s';
            
            // Replace 'unknown' with '0 MB/s' to prevent layout jumping
            if (rxInfo === 'unknown' || rxInfo === 'N/A') rxInfo = '0 MB/s';
            if (txInfo === 'unknown' || txInfo === 'N/A') txInfo = '0 MB/s';
            
            // Extract numeric values for display
            const rxDisplay = rxInfo.replace(' MB/s', '');
            const txDisplay = txInfo.replace(' MB/s', '');
            
            // Always show network, even when zero (prevents layout jumping)
            networkElement.textContent = `NET: ↓${rxDisplay} MB/s ↑${txDisplay} MB/s`;
            networkElement.style.display = 'inline';
        }
        
        // Hide monitoring stats section if no real monitoring data is available
        this.toggleMonitoringStatsVisibility(stats, isRemote);
    }

    updateCombinedSystemElement(element, stats) {
        if (!element) return;
        
        // Check if stats contain "Loading..." (passed from updateSystemStats when connecting)
        if (stats === 'Loading...') {
            element.textContent = 'Loading...';
            element.style.display = 'inline';
            return;
        }
        
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
            return;
        }
        
        // Format: "CPU: 10% RAM: 20.03Gb L: 1.2" or "CPU: 10% RAM: 405Mb L: 1.2"
        element.textContent = `CPU: ${cpuValue}% RAM: ${memoryDisplay} L: ${loadValue}`;
        element.style.display = 'inline';
    }
    
    updateStatElement(element, label, value) {
        if (!element) return;
        
        // Show loading state if value is "Loading..."
        if (value === 'Loading...') {
            element.textContent = `${label}: Loading...`;
            element.style.display = 'inline';
            element.className = 'status-loading';
            return;
        }
        
        // Hide element if value is unknown, null, undefined, or empty string
        // Don't hide for valid values like '0%' or '0.0' - those are legitimate data
        if (value === 'unknown' || value === null || value === undefined || value === '' || value === 'N/A') {
            element.style.display = 'none';
            return;
        } else {
            element.style.display = 'inline';
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
            // Hide all monitoring stat elements when no real data
            monitoringElements.forEach(element => {
                element.style.display = 'none';
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
        
        // Track if we're hovering over a metric element
        let hoveredElement = null;
        
        statusMonitoring.addEventListener('mouseenter', (e) => {
            if (e.target.dataset.stat) {
                hoveredElement = e.target;
                this.onMetricHover(e.target);
            }
        }, true);
        
        statusMonitoring.addEventListener('mouseleave', (e) => {
            if (e.target.dataset.stat) {
                hoveredElement = null;
                // Only trigger leave if we're not moving to the modal
                // The modal has its own mouse handling
                this.onMetricLeave(e.target);
            }
        }, true);
    }

    async onMetricHover(element) {
        const metric = element.dataset.stat;
        if (!metric || !this.activeTabInfo) return;
        
        // Only show modal for the combined system metric (CPU/RAM/Load)
        // Don't show for individual metrics like disk-usage, disk-io, network
        if (metric !== 'system') {
            return;
        }
        
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
                // Fetch all metrics and metadata in parallel
                const [cpuHistory, memoryHistory, loadHistory, diskUsageHistory, diskIOHistory, networkHistory, metadata] = await Promise.all([
                    GetMetricHistory(sessionID, 'cpu'),
                    GetMetricHistory(sessionID, 'memory'),
                    GetMetricHistory(sessionID, 'load'),
                    GetMetricHistory(sessionID, 'disk_usage'),
                    GetMetricHistory(sessionID, 'disk_io'),
                    GetMetricHistory(sessionID, 'network_rx'), // Network RX as representative
                    GetSystemMetadata()
                ]);
                
                // Get current uptime from the stats
                const uptime = this.activeTabInfo?.systemStats?.uptime || 'N/A';
                
                // Combine into multi-metric format
                const history = {
                    cpu: cpuHistory,
                    memory: memoryHistory,
                    load: loadHistory,
                    disk_usage: diskUsageHistory,
                    disk_io: diskIOHistory,
                    network: networkHistory,
                    uptime: uptime,
                    metadata: metadata
                };
                
                console.log('Got multi-metric history:', history);
                
                // Show graph modal with history and close callback
                this.graphModal.show(metric, element, history, () => {
                    // This callback is called when modal closes
                    this.onMetricLeaveComplete();
                });
                
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
        const metric = element.dataset.stat;
        
        // Only handle leave for system metric (since we only show modal for it)
        if (metric !== 'system') {
            return;
        }
        
        // Clear debounce timer
        if (this.hoverDebounceTimer) {
            clearTimeout(this.hoverDebounceTimer);
            this.hoverDebounceTimer = null;
        }
        
        // Hide graph modal with delay (allows moving cursor into modal)
        this.graphModal.hideWithDelay(300);
    }
    
    onMetricLeaveComplete() {
        // This is called when the modal actually closes (after delay or click outside)
        
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
        
        // Store the initial session ID
        this.hoverLoopSessionID = sessionID;
        
        // Update graph every 500ms
        this.hoverUpdateInterval = setInterval(async () => {
            try {
                // Always use the CURRENT active tab's session ID (it might have changed)
                const currentSessionID = this.activeTabInfo?.sessionId;
                
                // If session changed, close the modal
                if (!currentSessionID || currentSessionID !== this.hoverLoopSessionID) {
                    console.log('Session changed during hover, closing modal');
                    this.graphModal.hide();
                    this.stopHoverUpdateLoop();
                    return;
                }
                
                // Fetch fresh active tab info to get latest system stats (including uptime)
                // This updates at 500ms rate when hovering
                const freshTabInfo = await GetActiveTabInfo();
                
                // Always fetch all system metrics (metadata is cached, fetched only once)
                const [cpuHistory, memoryHistory, loadHistory, diskUsageHistory, diskIOHistory, networkHistory] = await Promise.all([
                    GetMetricHistory(currentSessionID, 'cpu'),
                    GetMetricHistory(currentSessionID, 'memory'),
                    GetMetricHistory(currentSessionID, 'load'),
                    GetMetricHistory(currentSessionID, 'disk_usage'),
                    GetMetricHistory(currentSessionID, 'disk_io'),
                    GetMetricHistory(currentSessionID, 'network_rx')
                ]);
                
                // Get current uptime from the FRESH stats (not cached)
                const uptime = freshTabInfo?.systemStats?.uptime || 'N/A';
                
                // Reuse metadata from initial load (stored in graphModal.data)
                const metadata = this.graphModal.data.metadata || {};
                
                const history = {
                    cpu: cpuHistory,
                    memory: memoryHistory,
                    load: loadHistory,
                    disk_usage: diskUsageHistory,
                    disk_io: diskIOHistory,
                    network: networkHistory,
                    uptime: uptime,
                    metadata: metadata
                };
                
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
        
        // Close the modal if it's open (data is for old tab)
        if (this.graphModal && this.graphModal.isVisible) {
            console.log('Closing modal due to tab switch');
            this.graphModal.hide();
            this.stopHoverUpdateLoop();
            
            // Restore original update rate for the old session
            if (this.hoveredMetric && this.activeTabInfo) {
                const oldSessionID = this.activeTabInfo.sessionId;
                if (oldSessionID) {
                    SetUpdateRate(oldSessionID, this.originalUpdateRate).catch(err => {
                        console.warn('Failed to restore update rate on tab switch:', err);
                    });
                }
            }
            this.hoveredMetric = null;
        }
        
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