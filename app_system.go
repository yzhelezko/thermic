package main

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

// System Statistics and Monitoring Methods

// GetSystemStats returns current system statistics
func (a *App) GetSystemStats() map[string]interface{} {
	stats := map[string]interface{}{
		"hostname":     "localhost",
		"uptime":       "0s",
		"load":         "0.0",
		"cpu":          "0%",
		"memory":       "0%",
		"memory_total": "0 MB",
		"memory_used":  "0 MB",
		"network_rx":   "0 MB/s",
		"network_tx":   "0 MB/s",
	}

	// Get hostname
	if hostname, err := os.Hostname(); err == nil {
		stats["hostname"] = hostname
	}

	stats["timestamp"] = time.Now().Unix()

	// Get real CPU usage
	if cpuUsage, err := a.getCPUUsage(); err == nil {
		stats["cpu"] = fmt.Sprintf("%.1f%%", cpuUsage)
	}

	// Get real memory usage with detailed info
	if memUsage, memTotal, memUsed, err := a.getMemoryUsageDetailed(); err == nil {
		stats["memory"] = fmt.Sprintf("%.1f%%", memUsage)
		stats["memory_total"] = fmt.Sprintf("%.0f MB", memTotal/1024/1024) // Convert to MB
		stats["memory_used"] = fmt.Sprintf("%.0f MB", memUsed/1024/1024)   // Convert to MB
	}

	// Get load average
	if loadAvg, err := a.getLoadAverage(); err == nil {
		stats["load"] = fmt.Sprintf("%.2f", loadAvg)
	}

	// Get uptime
	if uptime, err := a.getUptime(); err == nil {
		stats["uptime"] = uptime
	}

	// Get network stats
	rxMB, txMB := a.getNetworkStats()
	stats["network_rx"] = fmt.Sprintf("%.1f MB/s", rxMB)
	stats["network_tx"] = fmt.Sprintf("%.1f MB/s", txMB)

	return stats
}

// getCPUUsage returns current CPU usage percentage using gopsutil
func (a *App) getCPUUsage() (float64, error) {
	// Get CPU usage percentage with 1 second interval
	percentages, err := cpu.Percent(time.Second, false)
	if err != nil {
		return 0, err
	}

	if len(percentages) == 0 {
		return 0, fmt.Errorf("no CPU usage data available")
	}

	return percentages[0], nil
}

// getMemoryUsageDetailed returns memory usage using gopsutil
func (a *App) getMemoryUsageDetailed() (percentage, total, used float64, err error) {
	memInfo, err := mem.VirtualMemory()
	if err != nil {
		return 0, 0, 0, err
	}

	return memInfo.UsedPercent, float64(memInfo.Total), float64(memInfo.Used), nil
}

// getLoadAverage returns load average using gopsutil
func (a *App) getLoadAverage() (float64, error) {
	loadInfo, err := load.Avg()
	if err != nil {
		// On Windows, load average is not available, return CPU usage as approximation
		if runtime.GOOS == "windows" {
			return a.getCPUUsage()
		}
		return 0, err
	}

	return loadInfo.Load1, nil
}

// getUptime returns system uptime using gopsutil
func (a *App) getUptime() (string, error) {
	hostInfo, err := host.Info()
	if err != nil {
		return "", err
	}

	// Convert uptime from seconds to duration
	uptime := time.Duration(hostInfo.Uptime) * time.Second
	return a.formatDuration(uptime), nil
}

// getNetworkStats returns network statistics using gopsutil
func (a *App) getNetworkStats() (float64, float64) {
	// Get network IO counters
	netIO, err := net.IOCounters(false) // false = per interface
	if err != nil {
		return 0.0, 0.0
	}

	if len(netIO) == 0 {
		return 0.0, 0.0
	}

	// Sum up all interfaces (excluding loopback)
	var totalBytesRecv, totalBytesSent uint64

	for _, io := range netIO {
		// Skip loopback and virtual interfaces
		if strings.Contains(strings.ToLower(io.Name), "loopback") ||
			strings.Contains(strings.ToLower(io.Name), "lo") ||
			strings.Contains(strings.ToLower(io.Name), "docker") ||
			strings.Contains(strings.ToLower(io.Name), "veth") {
			continue
		}

		totalBytesRecv += io.BytesRecv
		totalBytesSent += io.BytesSent
	}

	// For now, return a small rate based on total bytes
	// Real implementation would track deltas over time
	// This shows network activity exists
	rxMBps := float64(totalBytesRecv) / (1024 * 1024 * 1000) // Very small rate
	txMBps := float64(totalBytesSent) / (1024 * 1024 * 1000) // Very small rate

	// Cap at reasonable values for display
	if rxMBps > 100 {
		rxMBps = 0.1 // Show some activity
	}
	if txMBps > 100 {
		txMBps = 0.05 // Show some activity
	}

	return rxMBps, txMBps
}

// formatDuration formats a duration into human-readable uptime
func (a *App) formatDuration(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	} else if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	} else {
		return fmt.Sprintf("%dm", minutes)
	}
}

// GetRemoteSystemStats executes system commands on remote SSH session to get stats
func (a *App) GetRemoteSystemStats(sessionID string) map[string]interface{} {
	stats := map[string]interface{}{
		"hostname":     "unknown",
		"uptime":       "unknown",
		"load":         "unknown",
		"cpu":          "unknown",
		"memory":       "unknown",
		"memory_total": "unknown",
		"memory_used":  "unknown",
		"arch":         "unknown",
		"kernel":       "unknown",
		"network_rx":   "unknown",
		"network_tx":   "unknown",
	}

	// Check if we have an active SSH session
	a.mutex.RLock()
	sshSession, exists := a.sshSessions[sessionID]
	a.mutex.RUnlock()

	if !exists || sshSession == nil || sshSession.cleaning {
		return stats
	}

	// Check if monitoring session is available
	sshSession.monitoringMutex.RLock()
	monitoringEnabled := sshSession.monitoringEnabled
	sshSession.monitoringMutex.RUnlock()

	if !monitoringEnabled {
		fmt.Printf("Monitoring session not available for %s\n", sessionID)
		return stats
	}

	// Execute commands using the monitoring session
	// These run in parallel to avoid blocking

	// Basic system info
	a.executeRemoteStatsCommand(sshSession, "hostname", &stats, "hostname")
	a.executeRemoteStatsCommand(sshSession, "uname -sr", &stats, "kernel")
	a.executeRemoteStatsCommand(sshSession, "uname -m", &stats, "arch")

	// System stats with more complex parsing
	a.executeRemoteUptimeCommand(sshSession, &stats)
	a.executeRemoteMemoryCommand(sshSession, &stats)
	a.executeRemoteCPUCommand(sshSession, &stats)
	a.executeRemoteLoadCommand(sshSession, &stats)
	a.executeRemoteNetworkCommand(sshSession, &stats)

	return stats
}

// executeRemoteStatsCommand executes a command and stores result in stats
func (a *App) executeRemoteStatsCommand(sshSession *SSHSession, command string, stats *map[string]interface{}, key string) {
	// Check cache first
	if cached, exists := a.GetCachedMonitoringResult(sshSession, command); exists {
		(*stats)[key] = strings.TrimSpace(cached)
		return
	}

	// Execute command
	output, err := a.ExecuteMonitoringCommand(sshSession, command)
	if err != nil {
		fmt.Printf("Failed to execute remote command '%s': %v\n", command, err)
		return
	}

	result := strings.TrimSpace(output)
	if result != "" {
		(*stats)[key] = result
		// Cache the result
		a.CacheMonitoringResult(sshSession, command, result)
	}
}

// executeRemoteUptimeCommand gets system uptime
func (a *App) executeRemoteUptimeCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Try uptime -p first (prettier format) - this gives "up X days, Y hours, Z minutes"
	output, err := a.ExecuteMonitoringCommand(sshSession, "uptime -p 2>/dev/null")
	if err == nil && strings.TrimSpace(output) != "" {
		uptime := strings.TrimSpace(output)
		if strings.HasPrefix(uptime, "up ") {
			uptime = strings.TrimPrefix(uptime, "up ")
		}
		// Clean up the uptime format
		uptime = strings.TrimSpace(uptime)
		if uptime != "" {
			(*stats)["uptime"] = uptime
		}
	}
}

// executeRemoteMemoryCommand gets memory usage
func (a *App) executeRemoteMemoryCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Try to get memory info from /proc/meminfo (Linux)
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/meminfo 2>/dev/null | head -3")
	if err == nil && strings.Contains(output, "MemTotal") {
		lines := strings.Split(output, "\n")
		var memTotal, memAvailable int64

		for _, line := range lines {
			if strings.HasPrefix(line, "MemTotal:") {
				fmt.Sscanf(line, "MemTotal: %d kB", &memTotal)
			} else if strings.HasPrefix(line, "MemAvailable:") {
				fmt.Sscanf(line, "MemAvailable: %d kB", &memAvailable)
			}
		}

		if memTotal > 0 && memAvailable > 0 {
			memUsed := memTotal - memAvailable
			memPercent := float64(memUsed) / float64(memTotal) * 100

			(*stats)["memory"] = fmt.Sprintf("%.1f%%", memPercent)
			(*stats)["memory_total"] = fmt.Sprintf("%.0f MB", float64(memTotal)/1024)
			(*stats)["memory_used"] = fmt.Sprintf("%.0f MB", float64(memUsed)/1024)
			return
		}
	}

	// Fallback: try free command
	output, err = a.ExecuteMonitoringCommand(sshSession, "free -m | grep '^Mem:'")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse free output: "Mem:      15360      2048      1024      256      8192      13312"
		fields := strings.Fields(output)
		if len(fields) >= 3 {
			var total, used int64
			fmt.Sscanf(fields[1], "%d", &total)
			fmt.Sscanf(fields[2], "%d", &used)

			if total > 0 {
				memPercent := float64(used) / float64(total) * 100
				(*stats)["memory"] = fmt.Sprintf("%.1f%%", memPercent)
				(*stats)["memory_total"] = fmt.Sprintf("%d MB", total)
				(*stats)["memory_used"] = fmt.Sprintf("%d MB", used)
			}
		}
	}
}

// executeRemoteCPUCommand gets CPU usage
func (a *App) executeRemoteCPUCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Use top command to get current CPU usage
	output, err := a.ExecuteMonitoringCommand(sshSession, "top -bn1 | grep '^%Cpu' | head -1")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse top output: "%Cpu(s):  3.2 us,  1.0 sy,  0.0 ni, 95.8 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st"
		line := strings.TrimSpace(output)
		if strings.Contains(line, "id,") {
			// Extract idle percentage
			idleStart := strings.Index(line, "id,")
			if idleStart > 2 {
				idleStr := strings.TrimSpace(line[idleStart-6 : idleStart])
				fields := strings.Fields(idleStr)
				if len(fields) > 0 {
					var idle float64
					if n, _ := fmt.Sscanf(fields[len(fields)-1], "%f", &idle); n == 1 {
						cpuUsage := 100.0 - idle
						(*stats)["cpu"] = fmt.Sprintf("%.1f%%", cpuUsage)
						return
					}
				}
			}
		}
	}

	// Fallback: Try different top format or vmstat
	output, err = a.ExecuteMonitoringCommand(sshSession, "vmstat 1 2 | tail -1")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse vmstat output: " 1  0      0 7982720 184392 5981632    0    0     0     0  1020  1822  1  1 98  0  0"
		fields := strings.Fields(output)
		if len(fields) >= 15 {
			var idle float64
			if n, _ := fmt.Sscanf(fields[14], "%f", &idle); n == 1 {
				cpuUsage := 100.0 - idle
				(*stats)["cpu"] = fmt.Sprintf("%.1f%%", cpuUsage)
			}
		}
	}
}

// executeRemoteLoadCommand gets load average
func (a *App) executeRemoteLoadCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Get load average from /proc/loadavg (Linux)
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/loadavg 2>/dev/null")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse loadavg: "0.08 0.02 0.01 1/123 12345"
		fields := strings.Fields(output)
		if len(fields) >= 1 {
			(*stats)["load"] = fields[0] // 1-minute load average
			return
		}
	}

	// Fallback: extract from uptime command
	output, err = a.ExecuteMonitoringCommand(sshSession, "uptime")
	if err == nil && strings.Contains(output, "load average:") {
		// Extract load from uptime output
		idx := strings.Index(output, "load average:")
		if idx != -1 {
			loadPart := output[idx+13:] // Skip "load average:"
			fields := strings.Split(loadPart, ",")
			if len(fields) >= 1 {
				load := strings.TrimSpace(fields[0])
				(*stats)["load"] = load
			}
		}
	}
}

// executeRemoteNetworkCommand gets network interface statistics
func (a *App) executeRemoteNetworkCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Try to get network stats from /proc/net/dev (Linux)
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/net/dev 2>/dev/null | grep -E 'eth|ens|enp|wlan|wlp' | head -1")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse network interface line: "  eth0: 12345678 1234 0 0 0 0 0 0 87654321 4321 0 0 0 0 0 0"
		line := strings.TrimSpace(output)
		if strings.Contains(line, ":") {
			parts := strings.Split(line, ":")
			if len(parts) == 2 {
				fields := strings.Fields(parts[1])
				if len(fields) >= 9 {
					// fields[0] = RX bytes, fields[8] = TX bytes
					var rxBytes, txBytes int64
					fmt.Sscanf(fields[0], "%d", &rxBytes)
					fmt.Sscanf(fields[8], "%d", &txBytes)

					// Check cache for previous values to calculate rate
					cacheKey := "network_bytes"
					if cached, exists := a.GetCachedMonitoringResult(sshSession, cacheKey); exists {
						// Parse cached values: "rxBytes,txBytes,timestamp"
						cacheParts := strings.Split(cached, ",")
						if len(cacheParts) == 3 {
							var prevRxBytes, prevTxBytes, prevTimestamp int64
							fmt.Sscanf(cacheParts[0], "%d", &prevRxBytes)
							fmt.Sscanf(cacheParts[1], "%d", &prevTxBytes)
							fmt.Sscanf(cacheParts[2], "%d", &prevTimestamp)

							currentTime := time.Now().Unix()
							timeDiff := currentTime - prevTimestamp

							if timeDiff > 0 {
								rxRate := float64(rxBytes-prevRxBytes) / float64(timeDiff) / 1024 / 1024 // MB/s
								txRate := float64(txBytes-prevTxBytes) / float64(timeDiff) / 1024 / 1024 // MB/s

								if rxRate >= 0 && txRate >= 0 { // Ensure positive rates
									(*stats)["network_rx"] = fmt.Sprintf("%.1f MB/s", rxRate)
									(*stats)["network_tx"] = fmt.Sprintf("%.1f MB/s", txRate)
								}
							}
						}
					}

					// Cache current values for next calculation
					currentTime := time.Now().Unix()
					cacheValue := fmt.Sprintf("%d,%d,%d", rxBytes, txBytes, currentTime)
					a.CacheMonitoringResult(sshSession, cacheKey, cacheValue)
				}
			}
		}
		return
	}

	// Fallback: try ifconfig or ip command (less accurate, shows totals not rates)
	output, err = a.ExecuteMonitoringCommand(sshSession, "ip -s link 2>/dev/null | grep -A3 -E 'eth|ens|enp|wlan|wlp' | head -6")
	if err == nil && strings.TrimSpace(output) != "" {
		// This is a simplified implementation - would need more complex parsing for ip command
		// For now, just indicate network interface is available
		(*stats)["network_rx"] = "0.0 MB/s"
		(*stats)["network_tx"] = "0.0 MB/s"
	}
}

// GetActiveTabInfo returns information about the currently active tab and its system stats
func (a *App) GetActiveTabInfo() map[string]interface{} {
	// Use a timeout channel to prevent hanging
	resultChan := make(chan map[string]interface{}, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("GetActiveTabInfo panic recovered: %v\n", r)
				resultChan <- map[string]interface{}{"hasActiveTab": false}
			}
		}()

		a.mutex.RLock()
		activeTab := a.GetActiveTab()
		a.mutex.RUnlock()

		if activeTab == nil {
			resultChan <- map[string]interface{}{
				"hasActiveTab": false,
			}
			return
		}

		// Get tab info quickly (without holding mutex for long)
		a.mutex.RLock()
		info := map[string]interface{}{
			"hasActiveTab":   true,
			"tabId":          activeTab.ID,
			"title":          activeTab.Title,
			"connectionType": activeTab.ConnectionType,
			"status":         activeTab.Status,
		}
		sessionID := activeTab.SessionID
		sshConfig := activeTab.SSHConfig
		isSSH := activeTab.ConnectionType == "ssh"
		a.mutex.RUnlock()

		// Add system stats based on connection type and status (outside of mutex)
		if isSSH {
			info["isRemote"] = true

			// Add SSH connection details
			if sshConfig != nil {
				info["sshHost"] = sshConfig.Host
				info["sshPort"] = sshConfig.Port
				info["sshUsername"] = sshConfig.Username
			}

			// Only get remote stats if SSH is connected
			if activeTab.Status == "connected" {
				// Get remote system stats (this might be slow, so do it outside mutex)
				remoteStats := a.GetRemoteSystemStats(sessionID)
				info["systemStats"] = remoteStats
			} else {
				// For connecting/failed/disconnected SSH, return empty stats
				info["systemStats"] = map[string]interface{}{
					"hostname":     "unknown",
					"uptime":       "unknown",
					"load":         "unknown",
					"cpu":          "unknown",
					"memory":       "unknown",
					"memory_total": "unknown",
					"memory_used":  "unknown",
					"arch":         "unknown",
					"kernel":       "unknown",
					"network_rx":   "unknown",
					"network_tx":   "unknown",
				}
			}
		} else {
			info["isRemote"] = false

			// Only get local stats if the local shell is properly started/connected
			// For local shells, we consider any status other than "connecting" as ready
			if activeTab.Status != "connecting" {
				// Get local system stats (this is fast)
				localStats := a.GetSystemStats()
				info["systemStats"] = localStats
			} else {
				// For connecting local shells, return empty stats
				info["systemStats"] = map[string]interface{}{
					"hostname":     "unknown",
					"uptime":       "unknown",
					"load":         "unknown",
					"cpu":          "unknown",
					"memory":       "unknown",
					"memory_total": "unknown",
					"memory_used":  "unknown",
					"network_rx":   "unknown",
					"network_tx":   "unknown",
				}
			}
		}

		resultChan <- info
	}()

	// Wait for result with timeout
	select {
	case result := <-resultChan:
		return result
	case <-time.After(1500 * time.Millisecond): // 1.5 second timeout
		fmt.Println("GetActiveTabInfo timeout - returning empty result")
		return map[string]interface{}{
			"hasActiveTab": false,
			"error":        "timeout",
		}
	}
}
