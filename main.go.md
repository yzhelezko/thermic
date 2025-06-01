# main.go Analysis

## Overview
Entry point for non-Darwin builds of Thermic terminal emulator using Wails v2 framework.

## Critical Issues
- **Build constraint conflict**: File has `//go:build !darwin` but there's also a `main_darwin.go` file, suggesting platform-specific builds
- **Missing error handling**: Error on line 62 only prints to stdout instead of proper logging or exit

## Potential Bugs
- **Line 62**: `println("Error:", err.Error())` - should use proper logging and potentially `os.Exit(1)`
- **No validation**: No validation of embedded assets or app initialization

## Code Quality
- Clean structure with embedded frontend assets
- Good use of build constraints for cross-platform support
- Reasonable default window configuration

## Optimizations
- Consider using structured logging instead of `println`
- Add graceful error handling with proper exit codes
- Consider making window dimensions configurable

## Dependencies
- Wails v2 framework
- Embedded frontend assets from `frontend/dist`

## Platform Support
- Explicitly excludes Darwin (macOS) builds
- Includes specific options for Windows, Linux, and macOS 