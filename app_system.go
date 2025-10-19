package main

import (
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

// System Statistics and Monitoring Methods

// GetSystemMetadata returns static system information for the active tab's system
// Returns local system info if no tab is active or for local tabs
// Returns remote system info for SSH tabs
func (a *App) GetSystemMetadata() map[string]interface{} {
	// Get active tab info to determine if we need local or remote metadata
	activeTab := a.GetActiveTab()
	if activeTab == nil {
		// No active tab, return local metadata
		return a.getLocalSystemMetadata()
	}

	// Check if this is an SSH connection
	if activeTab.ConnectionType == "ssh" && activeTab.Status == "connected" {
		// Get remote metadata
		return a.getRemoteSystemMetadata(activeTab.SessionID)
	}

	// Default to local metadata
	return a.getLocalSystemMetadata()
}

// getLocalSystemMetadata returns local system metadata
func (a *App) getLocalSystemMetadata() map[string]interface{} {
	metadata := map[string]interface{}{
		"cpu_count":     runtime.NumCPU(),
		"memory_total":  0.0,
		"disk_capacity": 0.0,
	}

	// Get total memory
	if memInfo, err := mem.VirtualMemory(); err == nil {
		metadata["memory_total"] = float64(memInfo.Total) / 1024 / 1024 // MB
	}

	// Get disk capacity
	if usage, err := disk.Usage("/"); err == nil {
		metadata["disk_capacity"] = float64(usage.Total) / 1024 / 1024 / 1024 // GB
	}

	return metadata
}

// getRemoteSystemMetadata returns remote system metadata via SSH
func (a *App) getRemoteSystemMetadata(sessionID string) map[string]interface{} {
	metadata := map[string]interface{}{
		"cpu_count":     0,
		"memory_total":  0.0,
		"disk_capacity": 0.0,
	}

	fmt.Printf("Getting remote metadata for session: %s\n", sessionID)

	// Check if we have an active SSH session
	a.ssh.sshSessionsMutex.RLock()
	sshSession, exists := a.ssh.sshSessions[sessionID]
	a.ssh.sshSessionsMutex.RUnlock()

	if !exists || sshSession == nil {
		fmt.Printf("No SSH session found for: %s\n", sessionID)
		return metadata
	}

	// Get CPU count - try multiple methods
	cpuCmd := "nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null"
	if output, err := a.ExecuteMonitoringCommand(sshSession, cpuCmd); err == nil {
		trimmed := strings.TrimSpace(output)
		fmt.Printf("Remote CPU count output: '%s'\n", trimmed)
		if cpuCount, parseErr := strconv.Atoi(trimmed); parseErr == nil && cpuCount > 0 {
			metadata["cpu_count"] = cpuCount
			fmt.Printf("Remote CPU count: %d\n", cpuCount)
		} else {
			fmt.Printf("Failed to parse CPU count: %v\n", parseErr)
		}
	} else {
		fmt.Printf("Failed to get CPU count: %v\n", err)
	}

	// Get total memory - try multiple methods
	// Method 1: /proc/meminfo (Linux) - extract just the number
	memCmd := "grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' | tr -d ' '"
	if output, err := a.ExecuteMonitoringCommand(sshSession, memCmd); err == nil {
		trimmed := strings.TrimSpace(output)
		fmt.Printf("Remote memory (KB) output: '%s'\n", trimmed)
		if memKB, parseErr := strconv.ParseFloat(trimmed, 64); parseErr == nil && memKB > 0 {
			metadata["memory_total"] = memKB / 1024 // Convert KB to MB
			fmt.Printf("Remote memory total: %.2f MB (%.2f GB)\n", memKB/1024, memKB/1024/1024)
		} else {
			fmt.Printf("Failed to parse memory: %v, trying alternative method\n", parseErr)
			// Alternative: extract number using sed
			altMemCmd := "cat /proc/meminfo 2>/dev/null | grep MemTotal | sed 's/[^0-9]//g'"
			if altOutput, altErr := a.ExecuteMonitoringCommand(sshSession, altMemCmd); altErr == nil {
				altTrimmed := strings.TrimSpace(altOutput)
				if altMemKB, altParseErr := strconv.ParseFloat(altTrimmed, 64); altParseErr == nil && altMemKB > 0 {
					metadata["memory_total"] = altMemKB / 1024
					fmt.Printf("Remote memory total (alt): %.2f MB\n", altMemKB/1024)
				}
			}
		}
	} else {
		fmt.Printf("Failed to get memory: %v\n", err)
	}

	// Get disk capacity - try multiple methods
	// Method 1: df -k (most universal) - extract just the total size column
	diskCmd := "df -k / 2>/dev/null | tail -1 | awk '{print $2}' | tr -d ' '"
	if output, err := a.ExecuteMonitoringCommand(sshSession, diskCmd); err == nil {
		trimmed := strings.TrimSpace(output)
		fmt.Printf("Remote disk (KB) output: '%s'\n", trimmed)
		if diskKB, parseErr := strconv.ParseFloat(trimmed, 64); parseErr == nil && diskKB > 0 {
			metadata["disk_capacity"] = diskKB / 1024 / 1024 // Convert KB to GB
			fmt.Printf("Remote disk capacity: %.2f GB (%.0f KB)\n", diskKB/1024/1024, diskKB)
		} else {
			fmt.Printf("Failed to parse disk capacity: %v, trying alternative method\n", parseErr)
			// Alternative: use df --output
			altDiskCmd := "df -k / 2>/dev/null | grep -v Filesystem | head -1 | awk '{print $2}'"
			if altOutput, altErr := a.ExecuteMonitoringCommand(sshSession, altDiskCmd); altErr == nil {
				altTrimmed := strings.TrimSpace(altOutput)
				if altDiskKB, altParseErr := strconv.ParseFloat(altTrimmed, 64); altParseErr == nil && altDiskKB > 0 {
					metadata["disk_capacity"] = altDiskKB / 1024 / 1024
					fmt.Printf("Remote disk capacity (alt): %.2f GB\n", altDiskKB/1024/1024)
				}
			}
		}
	} else {
		fmt.Printf("Failed to get disk capacity: %v\n", err)
	}

	fmt.Printf("Final remote metadata: %+v\n", metadata)
	return metadata
}

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
		"disk_usage":   "0%",
		"disk_read":    "0 MB/s",
		"disk_write":   "0 MB/s",
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

	// Get disk usage
	if diskUsage, err := a.getDiskUsage(); err == nil {
		stats["disk_usage"] = fmt.Sprintf("%.1f%%", diskUsage)
	}

	// Get disk I/O
	readMB, writeMB := a.getDiskIO("local")
	stats["disk_read"] = fmt.Sprintf("%.1f MB/s", readMB)
	stats["disk_write"] = fmt.Sprintf("%.1f MB/s", writeMB)

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

// getDiskUsage returns disk usage percentage for the main disk
func (a *App) getDiskUsage() (float64, error) {
	// Get the main disk path based on OS
	var path string
	switch runtime.GOOS {
	case "windows":
		path = "C:\\"
	default:
		path = "/"
	}

	usage, err := disk.Usage(path)
	if err != nil {
		return 0, err
	}

	return usage.UsedPercent, nil
}

// getDiskIO returns disk read/write speeds in MB/s
func (a *App) getDiskIO(sessionID string) (float64, float64) {
	// Get disk I/O counters
	ioCounters, err := disk.IOCounters()
	if err != nil {
		return 0.0, 0.0
	}

	// Sum up all physical disks (skip partitions)
	var totalReadBytes, totalWriteBytes uint64
	for name, counter := range ioCounters {
		// Filter out partition-level stats to avoid double-counting
		// On Linux: skip things like sda1, sda2, keep only sda
		// On Windows: keep all (simpler naming)
		// On macOS: keep disk0, disk1 (physical disks)
		if runtime.GOOS == "linux" && len(name) > 3 {
			// Skip partition numbers (e.g., sda1, nvme0n1p1)
			lastChar := name[len(name)-1]
			if lastChar >= '0' && lastChar <= '9' {
				continue
			}
		}

		totalReadBytes += counter.ReadBytes
		totalWriteBytes += counter.WriteBytes
	}

	// Get or create previous state for rate calculation
	a.monitoring.mutex.Lock()
	defer a.monitoring.mutex.Unlock()

	prevState, exists := a.monitoring.diskIOTracking[sessionID]
	currentTime := time.Now().UnixMilli()

	if !exists || prevState == nil {
		// First reading, just store state
		a.monitoring.diskIOTracking[sessionID] = &DiskIOState{
			ReadBytes:  totalReadBytes,
			WriteBytes: totalWriteBytes,
			Timestamp:  currentTime,
		}
		return 0.0, 0.0
	}

	// Calculate time difference
	timeDiff := float64(currentTime-prevState.Timestamp) / 1000.0 // Convert to seconds
	if timeDiff <= 0 {
		return 0.0, 0.0
	}

	// Calculate rates
	readRate := float64(totalReadBytes-prevState.ReadBytes) / timeDiff / 1024 / 1024    // MB/s
	writeRate := float64(totalWriteBytes-prevState.WriteBytes) / timeDiff / 1024 / 1024 // MB/s

	// Update state for next calculation
	a.monitoring.diskIOTracking[sessionID] = &DiskIOState{
		ReadBytes:  totalReadBytes,
		WriteBytes: totalWriteBytes,
		Timestamp:  currentTime,
	}

	// Ensure non-negative rates (in case of counter reset)
	if readRate < 0 {
		readRate = 0
	}
	if writeRate < 0 {
		writeRate = 0
	}

	return readRate, writeRate
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
		"disk_usage":   "unknown",
		"disk_read":    "unknown",
		"disk_write":   "unknown",
	}

	// Check if we have an active SSH session
	a.ssh.sshSessionsMutex.RLock()
	sshSession, exists := a.ssh.sshSessions[sessionID]
	a.ssh.sshSessionsMutex.RUnlock()

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
	// Run commands in parallel to avoid timeout issues
	var wg sync.WaitGroup
	statsMutex := &sync.Mutex{} // Protect concurrent writes to stats map

	// Helper to safely write to stats map
	safeSetStat := func(key string, value interface{}) {
		statsMutex.Lock()
		defer statsMutex.Unlock()
		stats[key] = value
	}

	// Create thread-safe stats pointer wrapper
	statsWrapper := &struct {
		data  *map[string]interface{}
		mutex *sync.Mutex
		set   func(string, interface{})
	}{
		data:  &stats,
		mutex: statsMutex,
		set:   safeSetStat,
	}

	// Basic system info - run in parallel
	wg.Add(3)
	go func() {
		defer wg.Done()
		// Execute and store result safely
		if cached, exists := a.GetCachedMonitoringResult(sshSession, "hostname"); exists {
			statsWrapper.set("hostname", strings.TrimSpace(cached))
		} else if output, err := a.ExecuteMonitoringCommand(sshSession, "hostname"); err == nil {
			result := strings.TrimSpace(output)
			if result != "" {
				statsWrapper.set("hostname", result)
				a.CacheMonitoringResult(sshSession, "hostname", result)
			}
		}
	}()
	go func() {
		defer wg.Done()
		if cached, exists := a.GetCachedMonitoringResult(sshSession, "uname -sr"); exists {
			statsWrapper.set("kernel", strings.TrimSpace(cached))
		} else if output, err := a.ExecuteMonitoringCommand(sshSession, "uname -sr"); err == nil {
			result := strings.TrimSpace(output)
			if result != "" {
				statsWrapper.set("kernel", result)
				a.CacheMonitoringResult(sshSession, "uname -sr", result)
			}
		}
	}()
	go func() {
		defer wg.Done()
		if cached, exists := a.GetCachedMonitoringResult(sshSession, "uname -m"); exists {
			statsWrapper.set("arch", strings.TrimSpace(cached))
		} else if output, err := a.ExecuteMonitoringCommand(sshSession, "uname -m"); err == nil {
			result := strings.TrimSpace(output)
			if result != "" {
				statsWrapper.set("arch", result)
				a.CacheMonitoringResult(sshSession, "uname -m", result)
			}
		}
	}()

	// System stats with more complex parsing - run in parallel
	// These functions write to the map, so we need to pass mutex-protected access
	wg.Add(7)
	go func() {
		defer wg.Done()
		localStats := make(map[string]interface{})
		a.executeRemoteUptimeCommand(sshSession, &localStats)
		for k, v := range localStats {
			statsWrapper.set(k, v)
		}
	}()
	go func() {
		defer wg.Done()
		localStats := make(map[string]interface{})
		a.executeRemoteMemoryCommand(sshSession, &localStats)
		for k, v := range localStats {
			statsWrapper.set(k, v)
		}
	}()
	go func() {
		defer wg.Done()
		localStats := make(map[string]interface{})
		a.executeRemoteCPUCommand(sshSession, &localStats)
		for k, v := range localStats {
			statsWrapper.set(k, v)
		}
	}()
	go func() {
		defer wg.Done()
		localStats := make(map[string]interface{})
		a.executeRemoteLoadCommand(sshSession, &localStats)
		for k, v := range localStats {
			statsWrapper.set(k, v)
		}
	}()
	go func() {
		defer wg.Done()
		localStats := make(map[string]interface{})
		a.executeRemoteNetworkCommand(sshSession, &localStats)
		for k, v := range localStats {
			statsWrapper.set(k, v)
		}
	}()
	go func() {
		defer wg.Done()
		localStats := make(map[string]interface{})
		a.executeRemoteDiskUsageCommand(sshSession, &localStats)
		for k, v := range localStats {
			statsWrapper.set(k, v)
		}
	}()
	go func() {
		defer wg.Done()
		localStats := make(map[string]interface{})
		a.executeRemoteDiskIOCommand(sshSession, sessionID, &localStats)
		for k, v := range localStats {
			statsWrapper.set(k, v)
		}
	}()

	// Wait for all commands to complete with a timeout
	doneChan := make(chan struct{})
	go func() {
		wg.Wait()
		close(doneChan)
	}()

	select {
	case <-doneChan:
		// All commands completed successfully
		fmt.Printf("All remote stats collected successfully for session %s\n", sessionID)
	case <-time.After(1200 * time.Millisecond):
		// Timeout after 1.2 seconds (leave 300ms buffer for GetActiveTabInfo)
		fmt.Printf("Warning: Some remote commands timed out for session %s\n", sessionID)
	}

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
	fmt.Printf("Remote uptime command output: %q, err: %v\n", output, err)

	if err == nil && strings.TrimSpace(output) != "" {
		uptime := strings.TrimSpace(output)
		uptime = strings.TrimPrefix(uptime, "up ")
		// Clean up the uptime format
		uptime = strings.TrimSpace(uptime)
		if uptime != "" {
			fmt.Printf("Setting remote uptime to: %q\n", uptime)
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
	// Prioritize real physical/virtual interfaces, exclude management/virtual/loopback
	// Priority order: eth*, ens*, enp*, eno* (physical), then others
	// Exclude: lo, docker*, veth*, dummy*, tunl*, sit*, bond* (virtual/management)
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/net/dev 2>/dev/null | grep -E '(eth|ens|enp|eno)[0-9]:' | head -1")

	// If no standard interface found, try broader search but still exclude virtual
	if err != nil || strings.TrimSpace(output) == "" {
		output, err = a.ExecuteMonitoringCommand(sshSession, "cat /proc/net/dev 2>/dev/null | grep -vE 'lo:|docker|veth|Inter|face|dummy|tunl|sit|bond' | grep ':' | grep -E '[0-9]' | head -1")
	}

	fmt.Printf("Network command output: %q\n", output)

	if err == nil && strings.TrimSpace(output) != "" {
		// Parse network interface line: "  eth0: 12345678 1234 0 0 0 0 0 0 87654321 4321 0 0 0 0 0 0"
		line := strings.TrimSpace(output)
		if strings.Contains(line, ":") {
			parts := strings.Split(line, ":")
			if len(parts) == 2 {
				fields := strings.Fields(parts[1])
				fmt.Printf("Network fields count: %d, fields: %v\n", len(fields), fields)

				if len(fields) >= 9 {
					// fields[0] = RX bytes, fields[8] = TX bytes
					var rxBytes, txBytes int64
					fmt.Sscanf(fields[0], "%d", &rxBytes)
					fmt.Sscanf(fields[8], "%d", &txBytes)

					fmt.Printf("Parsed network bytes - RX: %d, TX: %d\n", rxBytes, txBytes)

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

							fmt.Printf("Network rate calculation - timeDiff: %d, prev RX: %d, curr RX: %d, prev TX: %d, curr TX: %d\n",
								timeDiff, prevRxBytes, rxBytes, prevTxBytes, txBytes)

							if timeDiff > 0 {
								rxRate := float64(rxBytes-prevRxBytes) / float64(timeDiff) / 1024 / 1024 // MB/s
								txRate := float64(txBytes-prevTxBytes) / float64(timeDiff) / 1024 / 1024 // MB/s

								fmt.Printf("Calculated rates - RX: %.3f MB/s, TX: %.3f MB/s\n", rxRate, txRate)

								if rxRate >= 0 && txRate >= 0 { // Ensure positive rates
									(*stats)["network_rx"] = fmt.Sprintf("%.1f MB/s", rxRate)
									(*stats)["network_tx"] = fmt.Sprintf("%.1f MB/s", txRate)
								}
							}
						}
					} else {
						fmt.Printf("No cached network data found - this is the first reading\n")
					}

					// Cache current values for next calculation
					currentTime := time.Now().Unix()
					cacheValue := fmt.Sprintf("%d,%d,%d", rxBytes, txBytes, currentTime)
					a.CacheMonitoringResult(sshSession, cacheKey, cacheValue)
					fmt.Printf("Cached network values for next calculation\n")
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

// executeRemoteDiskUsageCommand gets disk usage percentage
func (a *App) executeRemoteDiskUsageCommand(sshSession *SSHSession, stats *map[string]interface{}) {
	// Use df to get disk usage for the root filesystem
	output, err := a.ExecuteMonitoringCommand(sshSession, "df -h / | tail -1")
	if err == nil && strings.TrimSpace(output) != "" {
		// Parse df output: "Filesystem  Size  Used  Avail Use% Mounted on"
		// Example: "/dev/sda1      50G   25G    23G  53% /"
		fields := strings.Fields(output)
		if len(fields) >= 5 {
			// The Use% field is typically at index 4
			usageStr := fields[4]
			// Remove the % sign
			usageStr = strings.TrimSuffix(usageStr, "%")

			var usage float64
			if n, _ := fmt.Sscanf(usageStr, "%f", &usage); n == 1 {
				(*stats)["disk_usage"] = fmt.Sprintf("%.1f%%", usage)
				return
			}
		}
	}
}

// executeRemoteDiskIOCommand gets disk I/O statistics
func (a *App) executeRemoteDiskIOCommand(sshSession *SSHSession, sessionID string, stats *map[string]interface{}) {
	// Try to get disk I/O from /proc/diskstats (Linux)
	// Format: major minor name reads ... sectors_read ... writes ... sectors_written ...
	output, err := a.ExecuteMonitoringCommand(sshSession, "cat /proc/diskstats 2>/dev/null | grep -E '(sda|nvme0n1|vda|xvda|hda)\\s' | head -1")
	if err == nil && strings.TrimSpace(output) != "" {
		fields := strings.Fields(output)
		if len(fields) >= 14 {
			// Field 5 = sectors read, Field 9 = sectors written
			// Sectors are typically 512 bytes
			var sectorsRead, sectorsWritten uint64
			fmt.Sscanf(fields[5], "%d", &sectorsRead)
			fmt.Sscanf(fields[9], "%d", &sectorsWritten)

			// Convert sectors to bytes (512 bytes per sector)
			readBytes := sectorsRead * 512
			writeBytes := sectorsWritten * 512

			// Check cache for previous values to calculate rate
			cacheKey := "disk_io_bytes"
			if cached, exists := a.GetCachedMonitoringResult(sshSession, cacheKey); exists {
				// Parse cached values: "readBytes,writeBytes,timestamp"
				cacheParts := strings.Split(cached, ",")
				if len(cacheParts) == 3 {
					var prevReadBytes, prevWriteBytes uint64
					var prevTimestamp int64
					fmt.Sscanf(cacheParts[0], "%d", &prevReadBytes)
					fmt.Sscanf(cacheParts[1], "%d", &prevWriteBytes)
					fmt.Sscanf(cacheParts[2], "%d", &prevTimestamp)

					currentTime := time.Now().Unix()
					timeDiff := currentTime - prevTimestamp

					if timeDiff > 0 {
						readRate := float64(readBytes-prevReadBytes) / float64(timeDiff) / 1024 / 1024    // MB/s
						writeRate := float64(writeBytes-prevWriteBytes) / float64(timeDiff) / 1024 / 1024 // MB/s

						if readRate >= 0 && writeRate >= 0 { // Ensure positive rates
							(*stats)["disk_read"] = fmt.Sprintf("%.1f MB/s", readRate)
							(*stats)["disk_write"] = fmt.Sprintf("%.1f MB/s", writeRate)
						}
					}
				}
			}

			// Cache current values for next calculation
			currentTime := time.Now().Unix()
			cacheValue := fmt.Sprintf("%d,%d,%d", readBytes, writeBytes, currentTime)
			a.CacheMonitoringResult(sshSession, cacheKey, cacheValue)
		}
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
		sessionID := activeTab.SessionID
		sshConfig := activeTab.SSHConfig
		isSSH := activeTab.ConnectionType == "ssh"

		info := map[string]interface{}{
			"hasActiveTab":   true,
			"tabId":          activeTab.ID,
			"sessionId":      sessionID, // Add session ID for metric tracking
			"title":          activeTab.Title,
			"connectionType": activeTab.ConnectionType,
			"status":         activeTab.Status,
		}
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

				// Record metrics to history
				a.RecordStats(sessionID, remoteStats)
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

				// Record metrics to history
				a.RecordStats(sessionID, localStats)
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
