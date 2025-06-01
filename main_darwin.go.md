# main_darwin.go Analysis

## Overview
Darwin (macOS) specific entry point for Thermic terminal emulator - nearly identical to main.go.

## Critical Issues - MAJOR CODE DUPLICATION
- **99% duplicate code**: This file is almost identical to `main.go` except for:
  - Build constraint: `//go:build darwin` vs `//go:build !darwin`  
  - Line 20: `isFrameless = false` vs `isFrameless = true`
- **Same error handling issue**: Line 62 uses `println` instead of proper error handling

## Duplication Analysis
**Identical sections:**
- Lines 6-14: All imports
- Lines 16-17: Embed directive and assets variable
- Lines 22-60: Entire Wails configuration (title, dimensions, colors, platform options)
- Lines 62-64: Error handling

**Only difference:**
- Line 20: `const isFrameless = false` (Darwin) vs `true` (other platforms)

## Potential Bugs
- **Same as main.go**: Poor error handling with `println`
- **Code maintenance risk**: Any changes need to be duplicated across both files

## Optimizations - HIGH PRIORITY
- **Eliminate duplication**: Extract common configuration to shared function
- **Single source of truth**: Use runtime detection instead of build constraints for this minor difference
- **Suggested refactor**: Create `createAppOptions(frameless bool)` function in shared file

## Recommended Fix
```go
// In a shared file (e.g., app.go)
func createAppOptions(app *App, frameless bool) *options.App {
    return &options.App{
        // ... all the common configuration
        Frameless: frameless,
        // ... rest of config
    }
}

// Then in platform-specific files:
// main.go: wails.Run(createAppOptions(app, true))
// main_darwin.go: wails.Run(createAppOptions(app, false))
``` 