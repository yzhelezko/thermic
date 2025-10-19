package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Metric History and Update Rate Management

// NewMetricHistory creates a new metric history with circular buffer
func NewMetricHistory(maxSize int) *MetricHistory {
	return &MetricHistory{
		Timestamps: make([]int64, maxSize),
		Values:     make([]float64, maxSize),
		MaxSize:    maxSize,
		nextIndex:  0,
		isFull:     false,
	}
}

// Add adds a new data point to the metric history (circular buffer)
func (mh *MetricHistory) Add(timestamp int64, value float64) {
	mh.Timestamps[mh.nextIndex] = timestamp
	mh.Values[mh.nextIndex] = value

	mh.nextIndex++
	if mh.nextIndex >= mh.MaxSize {
		mh.nextIndex = 0
		mh.isFull = true
	}
}

// GetData returns the metric history in chronological order
func (mh *MetricHistory) GetData() ([]int64, []float64) {
	if !mh.isFull {
		// Buffer not full yet, return data from start to nextIndex
		timestamps := make([]int64, mh.nextIndex)
		values := make([]float64, mh.nextIndex)
		copy(timestamps, mh.Timestamps[:mh.nextIndex])
		copy(values, mh.Values[:mh.nextIndex])
		return timestamps, values
	}

	// Buffer is full, return in chronological order
	size := mh.MaxSize
	timestamps := make([]int64, size)
	values := make([]float64, size)

	// Copy from nextIndex to end (oldest data)
	copy(timestamps, mh.Timestamps[mh.nextIndex:])
	copy(values, mh.Values[mh.nextIndex:])

	// Copy from start to nextIndex (newest data)
	copy(timestamps[size-mh.nextIndex:], mh.Timestamps[:mh.nextIndex])
	copy(values[size-mh.nextIndex:], mh.Values[:mh.nextIndex])

	return timestamps, values
}

// InitSessionMetrics initializes metric histories for a session
func (a *App) InitSessionMetrics(sessionID string) {
	a.monitoring.mutex.Lock()
	defer a.monitoring.mutex.Unlock()

	// Check if already initialized
	if _, exists := a.monitoring.sessionHistories[sessionID]; exists {
		return
	}

	// Create new session metrics with 120 data points (60 seconds at 500ms intervals)
	a.monitoring.sessionHistories[sessionID] = &SessionMetrics{
		CPU:       NewMetricHistory(120),
		Memory:    NewMetricHistory(120),
		Load:      NewMetricHistory(120),
		DiskUsage: NewMetricHistory(120),
		DiskRead:  NewMetricHistory(120),
		DiskWrite: NewMetricHistory(120),
		DiskIO:    NewMetricHistory(120),
		NetworkRX: NewMetricHistory(120),
		NetworkTX: NewMetricHistory(120),
	}

	// Set default update rate (3 seconds)
	a.monitoring.updateRates[sessionID] = 3000
}

// RecordMetric records a metric value in the history
func (a *App) RecordMetric(sessionID, metricName string, value float64) {
	a.monitoring.mutex.RLock()
	metrics, exists := a.monitoring.sessionHistories[sessionID]
	a.monitoring.mutex.RUnlock()

	if !exists {
		// Initialize if not exists
		a.InitSessionMetrics(sessionID)
		a.monitoring.mutex.RLock()
		metrics = a.monitoring.sessionHistories[sessionID]
		a.monitoring.mutex.RUnlock()
	}

	timestamp := time.Now().UnixMilli()

	metrics.mutex.Lock()
	defer metrics.mutex.Unlock()

	switch metricName {
	case "cpu":
		metrics.CPU.Add(timestamp, value)
	case "memory":
		metrics.Memory.Add(timestamp, value)
	case "load":
		metrics.Load.Add(timestamp, value)
	case "disk_usage":
		metrics.DiskUsage.Add(timestamp, value)
	case "disk_read":
		metrics.DiskRead.Add(timestamp, value)
	case "disk_write":
		metrics.DiskWrite.Add(timestamp, value)
	case "disk_io":
		metrics.DiskIO.Add(timestamp, value)
	case "network_rx":
		metrics.NetworkRX.Add(timestamp, value)
	case "network_tx":
		metrics.NetworkTX.Add(timestamp, value)
	}
}

// RecordStats records all stats from a stats map
func (a *App) RecordStats(sessionID string, stats map[string]interface{}) {
	fmt.Printf("RecordStats called for session: %s with %d stats\n", sessionID, len(stats))

	// Parse and record each metric
	if cpu, ok := stats["cpu"].(string); ok {
		if val := parsePercentage(cpu); val >= 0 {
			fmt.Printf("Recording CPU: %.1f%% for session %s\n", val, sessionID)
			a.RecordMetric(sessionID, "cpu", val)
		}
	}

	// Record memory in MB (not percentage) for better graph display
	if memoryUsed, ok := stats["memory_used"].(string); ok {
		// Parse "405 MB" or "1.2 GB" format
		memMatch := strings.Fields(memoryUsed)
		if len(memMatch) >= 2 {
			if val, err := strconv.ParseFloat(memMatch[0], 64); err == nil && val >= 0 {
				unit := strings.ToUpper(memMatch[1])
				memoryMB := val
				if unit == "GB" {
					memoryMB = val * 1024
				}
				a.RecordMetric(sessionID, "memory", memoryMB)
			}
		}
	}

	if load, ok := stats["load"].(string); ok {
		if val, err := strconv.ParseFloat(load, 64); err == nil && val >= 0 {
			a.RecordMetric(sessionID, "load", val)
		}
	}

	if diskUsage, ok := stats["disk_usage"].(string); ok {
		if val := parsePercentage(diskUsage); val >= 0 {
			a.RecordMetric(sessionID, "disk_usage", val)
		}
	}

	// Record combined disk I/O (read + write) for the main graph
	diskReadVal := 0.0
	diskWriteVal := 0.0

	if diskRead, ok := stats["disk_read"].(string); ok {
		if val := parseMBps(diskRead); val >= 0 {
			diskReadVal = val
			a.RecordMetric(sessionID, "disk_read", val)
		}
	}

	if diskWrite, ok := stats["disk_write"].(string); ok {
		if val := parseMBps(diskWrite); val >= 0 {
			diskWriteVal = val
			a.RecordMetric(sessionID, "disk_write", val)
		}
	}

	// Record combined disk I/O
	a.RecordMetric(sessionID, "disk_io", diskReadVal+diskWriteVal)

	if networkRX, ok := stats["network_rx"].(string); ok {
		if val := parseMBps(networkRX); val >= 0 {
			a.RecordMetric(sessionID, "network_rx", val)
		}
	}

	if networkTX, ok := stats["network_tx"].(string); ok {
		if val := parseMBps(networkTX); val >= 0 {
			a.RecordMetric(sessionID, "network_tx", val)
		}
	}
}

// GetMetricHistory returns the metric history for a specific metric
func (a *App) GetMetricHistory(sessionID, metricName string) map[string]interface{} {
	// Map frontend metric names to backend names
	backendMetricName := metricName
	switch metricName {
	case "disk-usage":
		backendMetricName = "disk_usage"
	case "disk-io":
		// For disk-io, we'll return disk_read data (frontend can request both separately if needed)
		backendMetricName = "disk_read"
	}

	fmt.Printf("GetMetricHistory called for session: %s, metric: %s (mapped to: %s)\n", sessionID, metricName, backendMetricName)

	a.monitoring.mutex.RLock()
	metrics, exists := a.monitoring.sessionHistories[sessionID]
	a.monitoring.mutex.RUnlock()

	if !exists {
		fmt.Printf("No metrics found for session: %s\n", sessionID)
		return map[string]interface{}{
			"timestamps": []int64{},
			"values":     []float64{},
		}
	}

	metrics.mutex.RLock()
	defer metrics.mutex.RUnlock()

	var timestamps []int64
	var values []float64

	switch backendMetricName {
	case "cpu":
		timestamps, values = metrics.CPU.GetData()
	case "memory":
		timestamps, values = metrics.Memory.GetData()
	case "load":
		timestamps, values = metrics.Load.GetData()
	case "disk_usage":
		timestamps, values = metrics.DiskUsage.GetData()
	case "disk_read":
		timestamps, values = metrics.DiskRead.GetData()
	case "disk_write":
		timestamps, values = metrics.DiskWrite.GetData()
	case "disk_io":
		timestamps, values = metrics.DiskIO.GetData()
	case "network_rx":
		timestamps, values = metrics.NetworkRX.GetData()
	case "network_tx":
		timestamps, values = metrics.NetworkTX.GetData()
	case "network":
		// For network, return RX data (frontend can handle both)
		timestamps, values = metrics.NetworkRX.GetData()
	default:
		timestamps = []int64{}
		values = []float64{}
	}

	fmt.Printf("Returning %d data points for metric %s\n", len(timestamps), backendMetricName)

	return map[string]interface{}{
		"timestamps": timestamps,
		"values":     values,
		"metric":     metricName,
	}
}

// SetUpdateRate sets the update rate for a session (in milliseconds)
func (a *App) SetUpdateRate(sessionID string, rateMs int) error {
	// Validate rate (between 100ms and 60000ms)
	if rateMs < 100 || rateMs > 60000 {
		return fmt.Errorf("invalid update rate: %d ms (must be between 100 and 60000)", rateMs)
	}

	a.monitoring.mutex.Lock()
	defer a.monitoring.mutex.Unlock()

	a.monitoring.updateRates[sessionID] = rateMs
	fmt.Printf("Set update rate for session %s to %d ms\n", sessionID, rateMs)

	return nil
}

// GetUpdateRate gets the current update rate for a session
func (a *App) GetUpdateRate(sessionID string) int {
	a.monitoring.mutex.RLock()
	defer a.monitoring.mutex.RUnlock()

	if rate, exists := a.monitoring.updateRates[sessionID]; exists {
		return rate
	}

	// Default rate
	return 3000
}

// CleanupSessionMetrics removes metrics for a closed session
func (a *App) CleanupSessionMetrics(sessionID string) {
	a.monitoring.mutex.Lock()
	defer a.monitoring.mutex.Unlock()

	delete(a.monitoring.sessionHistories, sessionID)
	delete(a.monitoring.updateRates, sessionID)
	delete(a.monitoring.diskIOTracking, sessionID)
}

// Helper functions

func parsePercentage(s string) float64 {
	// Remove % sign and parse
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, "%")

	val, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return -1
	}
	return val
}

func parseMBps(s string) float64 {
	// Parse "X.X MB/s" format
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, " MB/s")
	s = strings.TrimSuffix(s, "MB/s")

	val, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return -1
	}
	return val
}
