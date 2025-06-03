package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v2"
)

// Metrics constants
const (
	MetricsFilename     = "metrics.yaml"
	MetricsUpdatePeriod = 5 * time.Minute
	TopItemsLimit       = 10
)

// updateProfileUsage increments usage statistics for a profile with safety checks
func (a *App) updateProfileUsage(profileID string) error {
	if profileID == "" {
		return fmt.Errorf("profile ID cannot be empty")
	}

	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return &ProfileError{
			Op:        "updateUsage",
			ProfileID: profileID,
			Err:       fmt.Errorf("profile not found"),
		}
	}

	profile.LastUsed = time.Now()
	profile.UsageCount++

	// Save the updated profile using internal function to avoid deadlock
	err := a.saveProfileInternal(profile)
	if err == nil {
		// Also update metrics asynchronously
		go a.saveMetrics()
	}
	return err
}

// saveMetrics saves profile metrics to file with enhanced data collection
func (a *App) saveMetrics() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return fmt.Errorf("failed to get profiles directory: %w", err)
	}

	metricsPath := filepath.Join(profilesDir, MetricsFilename)

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	// Update metrics
	if a.profiles.metrics == nil {
		a.profiles.metrics = &ProfileMetrics{}
	}

	a.profiles.metrics.TotalProfiles = len(a.profiles.profiles)
	a.profiles.metrics.TotalFolders = len(a.profiles.profileFolders)
	a.profiles.metrics.LastSync = time.Now()

	// Collect all profiles for analysis
	var allProfiles []*Profile
	for _, profile := range a.profiles.profiles {
		allProfiles = append(allProfiles, profile)
	}

	// Update most used profiles (sorted by usage count)
	sort.Slice(allProfiles, func(i, j int) bool {
		return allProfiles[i].UsageCount > allProfiles[j].UsageCount
	})

	a.profiles.metrics.MostUsedProfiles = []string{}
	for i, profile := range allProfiles {
		if i >= TopItemsLimit {
			break
		}
		if profile.UsageCount > 0 {
			a.profiles.metrics.MostUsedProfiles = append(a.profiles.metrics.MostUsedProfiles, profile.ID)
		}
	}

	// Update recent profiles (sorted by last used)
	sort.Slice(allProfiles, func(i, j int) bool {
		return allProfiles[i].LastUsed.After(allProfiles[j].LastUsed)
	})

	a.profiles.metrics.RecentProfiles = []string{}
	for i, profile := range allProfiles {
		if i >= TopItemsLimit {
			break
		}
		if !profile.LastUsed.IsZero() {
			a.profiles.metrics.RecentProfiles = append(a.profiles.metrics.RecentProfiles, profile.ID)
		}
	}

	// Update favorite profiles
	a.profiles.metrics.FavoriteProfiles = []string{}
	for _, profile := range a.profiles.profiles {
		if profile.IsFavorite {
			a.profiles.metrics.FavoriteProfiles = append(a.profiles.metrics.FavoriteProfiles, profile.ID)
		}
	}

	// Update tag usage statistics
	a.profiles.metrics.TagUsage = make(map[string]int)
	for _, profile := range a.profiles.profiles {
		for _, tag := range profile.Tags {
			if tag != "" { // Only count non-empty tags
				a.profiles.metrics.TagUsage[strings.ToLower(tag)]++
			}
		}
	}

	// Save to YAML file with atomic operation
	data, err := yaml.Marshal(a.profiles.metrics)
	if err != nil {
		return fmt.Errorf("failed to marshal metrics: %w", err)
	}

	// Write to temporary file first, then rename for atomic operation
	tempPath := metricsPath + ".tmp"
	if err := os.WriteFile(tempPath, data, ConfigFileMode); err != nil {
		return fmt.Errorf("failed to write metrics temp file: %w", err)
	}

	if err := os.Rename(tempPath, metricsPath); err != nil {
		os.Remove(tempPath) // Clean up temp file
		return fmt.Errorf("failed to rename metrics file: %w", err)
	}

	return nil
}

// loadMetrics loads profile metrics from file with error handling
func (a *App) loadMetrics() error {
	profilesDir, err := a.GetProfilesDirectory()
	if err != nil {
		return fmt.Errorf("failed to get profiles directory: %w", err)
	}

	metricsPath := filepath.Join(profilesDir, MetricsFilename)

	// Check if metrics file exists
	if _, err := os.Stat(metricsPath); os.IsNotExist(err) {
		a.profiles.metrics = &ProfileMetrics{}
		return nil
	}

	data, err := os.ReadFile(metricsPath)
	if err != nil {
		return fmt.Errorf("failed to read metrics file: %w", err)
	}

	// Handle empty file
	if len(data) == 0 {
		a.profiles.metrics = &ProfileMetrics{}
		return nil
	}

	a.profiles.metrics = &ProfileMetrics{}
	if err := yaml.Unmarshal(data, a.profiles.metrics); err != nil {
		return fmt.Errorf("failed to parse metrics YAML: %w", err)
	}

	return nil
}

// GetMetrics returns current profile metrics with read lock
func (a *App) GetMetrics() *ProfileMetrics {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	if a.profiles.metrics == nil {
		return &ProfileMetrics{}
	}

	// Return a copy to prevent external modification
	metricsCopy := *a.profiles.metrics
	return &metricsCopy
}

// GetProfileUsageStats returns detailed usage statistics for a profile
func (a *App) GetProfileUsageStats(profileID string) map[string]interface{} {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	profile, exists := a.profiles.profiles[profileID]
	if !exists {
		return map[string]interface{}{
			"error": "Profile not found",
		}
	}

	stats := map[string]interface{}{
		"id":         profile.ID,
		"name":       profile.Name,
		"usageCount": profile.UsageCount,
		"lastUsed":   profile.LastUsed,
		"created":    profile.Created,
		"isFavorite": profile.IsFavorite,
		"tags":       profile.Tags,
		"type":       profile.Type,
	}

	// Calculate days since last use
	if !profile.LastUsed.IsZero() {
		daysSinceLastUse := int(time.Since(profile.LastUsed).Hours() / 24)
		stats["daysSinceLastUse"] = daysSinceLastUse
	}

	// Calculate days since creation
	daysSinceCreation := int(time.Since(profile.Created).Hours() / 24)
	stats["daysSinceCreation"] = daysSinceCreation

	// Calculate average usage per day
	if daysSinceCreation > 0 {
		avgUsagePerDay := float64(profile.UsageCount) / float64(daysSinceCreation)
		stats["avgUsagePerDay"] = avgUsagePerDay
	}

	return stats
}

// GetTopProfiles returns the most used profiles with details
func (a *App) GetTopProfiles(limit int) []*Profile {
	if limit <= 0 {
		limit = TopItemsLimit
	}

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	var profiles []*Profile
	for _, profile := range a.profiles.profiles {
		if profile.UsageCount > 0 {
			profiles = append(profiles, profile)
		}
	}

	// Sort by usage count
	sort.Slice(profiles, func(i, j int) bool {
		return profiles[i].UsageCount > profiles[j].UsageCount
	})

	// Limit results
	if len(profiles) > limit {
		profiles = profiles[:limit]
	}

	return profiles
}

// GetRecentProfiles returns recently used profiles
func (a *App) GetRecentProfiles(limit int, days int) []*Profile {
	if limit <= 0 {
		limit = TopItemsLimit
	}
	if days <= 0 {
		days = 30
	}

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	cutoffTime := time.Now().AddDate(0, 0, -days)
	var profiles []*Profile

	for _, profile := range a.profiles.profiles {
		if !profile.LastUsed.IsZero() && profile.LastUsed.After(cutoffTime) {
			profiles = append(profiles, profile)
		}
	}

	// Sort by last used time
	sort.Slice(profiles, func(i, j int) bool {
		return profiles[i].LastUsed.After(profiles[j].LastUsed)
	})

	// Limit results
	if len(profiles) > limit {
		profiles = profiles[:limit]
	}

	return profiles
}

// GetPopularTags returns most used tags with counts
func (a *App) GetPopularTags() []map[string]interface{} {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	if a.profiles.metrics == nil || len(a.profiles.metrics.TagUsage) == 0 {
		return []map[string]interface{}{}
	}

	// Convert to slice for sorting
	type tagCount struct {
		tag   string
		count int
	}

	var tags []tagCount
	for tag, count := range a.profiles.metrics.TagUsage {
		tags = append(tags, tagCount{tag: tag, count: count})
	}

	// Sort by count (descending)
	sort.Slice(tags, func(i, j int) bool {
		return tags[i].count > tags[j].count
	})

	// Convert to response format
	result := make([]map[string]interface{}, 0, len(tags))
	for _, tc := range tags {
		result = append(result, map[string]interface{}{
			"tag":   tc.tag,
			"count": tc.count,
		})
	}

	return result
}

// GetUsageTrends returns usage trends over time
func (a *App) GetUsageTrends(days int) map[string]interface{} {
	if days <= 0 {
		days = 30
	}

	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	trends := map[string]interface{}{
		"totalProfiles":  len(a.profiles.profiles),
		"totalFolders":   len(a.profiles.profileFolders),
		"activeProfiles": 0,
		"favoriteCount":  0,
		"averageUsage":   0.0,
		"mostActiveDay":  "",
		"recentActivity": []map[string]interface{}{},
	}

	cutoffTime := time.Now().AddDate(0, 0, -days)
	var totalUsage int
	var activeProfiles int

	for _, profile := range a.profiles.profiles {
		if profile.IsFavorite {
			trends["favoriteCount"] = trends["favoriteCount"].(int) + 1
		}

		if !profile.LastUsed.IsZero() && profile.LastUsed.After(cutoffTime) {
			activeProfiles++
		}

		totalUsage += profile.UsageCount
	}

	trends["activeProfiles"] = activeProfiles

	if len(a.profiles.profiles) > 0 {
		trends["averageUsage"] = float64(totalUsage) / float64(len(a.profiles.profiles))
	}

	return trends
}

// ResetMetrics clears all metrics data
func (a *App) ResetMetrics() error {
	a.profiles.mutex.Lock()
	defer a.profiles.mutex.Unlock()

	a.profiles.metrics = &ProfileMetrics{}

	// Also reset usage counters in profiles
	for _, profile := range a.profiles.profiles {
		profile.UsageCount = 0
		profile.LastUsed = time.Time{}
		a.saveProfileInternal(profile)
	}

	return a.saveMetrics()
}

// ExportMetrics exports metrics data to a file
func (a *App) ExportMetrics(filePath string) error {
	a.profiles.mutex.RLock()
	defer a.profiles.mutex.RUnlock()

	if a.profiles.metrics == nil {
		return fmt.Errorf("no metrics data available")
	}

	data, err := yaml.Marshal(a.profiles.metrics)
	if err != nil {
		return fmt.Errorf("failed to marshal metrics: %w", err)
	}

	if err := os.WriteFile(filePath, data, ConfigFileMode); err != nil {
		return fmt.Errorf("failed to write metrics export: %w", err)
	}

	return nil
}

// StartMetricsAutoSave starts automatic metrics saving
func (a *App) StartMetricsAutoSave() {
	go func() {
		ticker := time.NewTicker(MetricsUpdatePeriod)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				if err := a.saveMetrics(); err != nil {
					fmt.Printf("Warning: Failed to auto-save metrics: %v\n", err)
				}
			}
		}
	}()
}
