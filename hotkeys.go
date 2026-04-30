package main

import (
	"fmt"
	"sort"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// HotkeyAction describes a user-rebindable keyboard shortcut.
type HotkeyAction struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Default  string `json:"default"`
	Category string `json:"category"`
}

// HotkeyActions is the canonical list of rebindable shortcuts.
// Ordering controls how they appear in the settings UI.
var HotkeyActions = []HotkeyAction{
	{ID: "tab.new", Label: "New Tab", Default: "ctrl+t", Category: "Tabs"},
	{ID: "tab.new-ssh", Label: "New SSH Tab", Default: "ctrl+shift+n", Category: "Tabs"},
	{ID: "tab.close", Label: "Close Tab", Default: "ctrl+w", Category: "Tabs"},
	{ID: "terminal.clear", Label: "Clear Terminal", Default: "ctrl+l", Category: "Terminal"},
	{ID: "terminal.scroll-top", Label: "Scroll to Top", Default: "ctrl+home", Category: "Terminal"},
	{ID: "terminal.scroll-bottom", Label: "Scroll to Bottom", Default: "ctrl+end", Category: "Terminal"},
	{ID: "sidebar.search", Label: "Search Profiles", Default: "ctrl+f", Category: "Sidebar"},
	{ID: "ai.toggle", Label: "Toggle AI Assistant", Default: "ctrl+k", Category: "AI"},
	{ID: "ui.zoom-in", Label: "Zoom In", Default: "ctrl+=", Category: "Interface"},
	{ID: "ui.zoom-out", Label: "Zoom Out", Default: "ctrl+-", Category: "Interface"},
	{ID: "ui.zoom-reset", Label: "Reset Zoom", Default: "ctrl+0", Category: "Interface"},
}

// hotkeyDefaults returns a map of action ID to default combo for fast lookups.
func hotkeyDefaults() map[string]string {
	out := make(map[string]string, len(HotkeyActions))
	for _, a := range HotkeyActions {
		out[a.ID] = a.Default
	}
	return out
}

// GetHotkeyActions returns the list of rebindable actions for the settings UI.
func (a *App) GetHotkeyActions() []HotkeyAction {
	out := make([]HotkeyAction, len(HotkeyActions))
	copy(out, HotkeyActions)
	return out
}

// GetHotkeys returns the merged action-to-keystroke map (defaults + user overrides).
// Includes a backwards-compat migration: if AIConfig.Hotkey was customized in an older
// config but the new map has no override for ai.toggle, surface it here.
func (a *App) GetHotkeys() map[string]string {
	merged := hotkeyDefaults()
	if a.config == nil || a.config.config == nil {
		return merged
	}

	// Apply explicit overrides
	for id, combo := range a.config.config.Hotkeys {
		if combo == "" {
			continue
		}
		merged[id] = combo
	}

	// Backwards compat: legacy AIHotkey field still wins for ai.toggle if no explicit override
	if _, hasOverride := a.config.config.Hotkeys["ai.toggle"]; !hasOverride {
		legacy := strings.TrimSpace(a.config.config.AI.Hotkey)
		if legacy != "" && legacy != merged["ai.toggle"] {
			merged["ai.toggle"] = legacy
		}
	}

	return merged
}

// SetHotkey persists a user override for the given action.
// Pass an empty combo to clear the override (same as ResetHotkey).
func (a *App) SetHotkey(actionID, combo string) error {
	if a.config == nil || a.config.config == nil {
		return fmt.Errorf("config not initialized")
	}

	// Validate that the action exists
	if _, ok := hotkeyDefaults()[actionID]; !ok {
		return fmt.Errorf("unknown hotkey action: %s", actionID)
	}

	combo = strings.TrimSpace(combo)
	if combo == "" {
		return a.ResetHotkey(actionID)
	}

	if a.config.config.Hotkeys == nil {
		a.config.config.Hotkeys = make(map[string]string)
	}

	// If the override matches the default, drop it instead of persisting
	if combo == hotkeyDefaults()[actionID] {
		delete(a.config.config.Hotkeys, actionID)
	} else {
		a.config.config.Hotkeys[actionID] = combo
	}

	// Keep the legacy AIHotkey field in sync so the AI manager observes the change
	if actionID == "ai.toggle" {
		a.config.config.AI.Hotkey = combo
	}

	a.markConfigDirty()
	a.emitHotkeysChanged()
	return nil
}

// ResetHotkey removes any user override for the action, restoring the default.
func (a *App) ResetHotkey(actionID string) error {
	if a.config == nil || a.config.config == nil {
		return fmt.Errorf("config not initialized")
	}
	if _, ok := hotkeyDefaults()[actionID]; !ok {
		return fmt.Errorf("unknown hotkey action: %s", actionID)
	}
	if a.config.config.Hotkeys != nil {
		delete(a.config.config.Hotkeys, actionID)
	}
	if actionID == "ai.toggle" {
		a.config.config.AI.Hotkey = hotkeyDefaults()[actionID]
	}
	a.markConfigDirty()
	a.emitHotkeysChanged()
	return nil
}

// ResetAllHotkeys clears every user override.
func (a *App) ResetAllHotkeys() error {
	if a.config == nil || a.config.config == nil {
		return fmt.Errorf("config not initialized")
	}
	a.config.config.Hotkeys = nil
	a.config.config.AI.Hotkey = hotkeyDefaults()["ai.toggle"]
	a.markConfigDirty()
	a.emitHotkeysChanged()
	return nil
}

func (a *App) emitHotkeysChanged() {
	if a.ctx == nil {
		return
	}
	wailsRuntime.EventsEmit(a.ctx, "config:hotkeys-changed", a.GetHotkeys())
}

// FindHotkeyConflicts returns a deterministic list of keystroke values that are
// bound to more than one action. Used by the settings UI to surface duplicates.
func (a *App) FindHotkeyConflicts() []string {
	merged := a.GetHotkeys()
	counts := make(map[string]int)
	for _, combo := range merged {
		counts[combo]++
	}
	conflicts := make([]string, 0)
	for combo, n := range counts {
		if n > 1 {
			conflicts = append(conflicts, combo)
		}
	}
	sort.Strings(conflicts)
	return conflicts
}
