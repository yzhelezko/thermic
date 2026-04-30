# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Thermic is a cross-platform terminal emulator built with Wails v2 (Go backend) and xterm.js (frontend). It supports local shells, SSH connections with SFTP file browsing, WSL distributions, an embedded AI assistant (OpenAI), and a profile/folder tree.

## Development commands

- **Run dev mode** (hot reload, primary workflow): `wails dev`
  - Per `.cursor/rules/airules.md`: always use `wails dev` to test the app.
- **Build**: `wails build` (dev) or `wails build -clean -trimpath` (production)
- **Build on Linux** must use the WebKit 2.41 tag: `wails build -clean -tags webkit2_41`
- **Tests**: `go test -tags webkit2_41 -v ./...` (Linux); `go test ./...` on other platforms
  - Run a single test: `go test -run TestNewApp -v` (or with `-tags webkit2_41` on Linux)
- **Format check**: `gofmt -s -l .` must produce no output (CI fails otherwise)
- **Vet**: `go vet -tags webkit2_41 ./...` on Linux, `go vet ./...` elsewhere
- **Frontend deps**: `cd frontend && npm install` (Node 18+, npm 9+)
- **Frontend build only**: `cd frontend && npm run build`

Linux build prereqs: `build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev`. On Wayland, `main_linux.go` forces `GDK_BACKEND=x11` (XWayland) and `app_core.go` disables the WebKit GPU policy to avoid GBM buffer errors.

## Architecture

### Backend (Go, package `main` at repo root — flat layout, no subpackages)

The `App` struct (`types.go`) is the single Wails-bound object. It composes **focused managers** rather than holding everything itself. Always go through the manager fields — never reach back to a global App mutex for manager-owned state.

| Manager | Field | Owns |
|---|---|---|
| `TerminalManager` | `a.terminal` | PTY sessions, tabs, active tab |
| `ProfileManager` | `a.profiles` | Profiles, folders, watcher, virtual folders, metrics, file history |
| `SSHManager` | `a.ssh` | SSH sessions + SFTP clients (with **separate** mutexes — see below) |
| `ConfigManager` | `a.config` | `AppConfig`, dirty flag, debounce timer |
| `MessageManager` | `a.messages` | Unified terminal status messages and connection flow |
| `AIManager` | `a.ai` | AI providers, rate limiter |
| `MonitoringManager` | `a.monitoring` | Per-session metric history (CPU/mem/disk/net) for status graphs |

Each manager owns its own `sync.RWMutex` and a `ResourceManager` which tracks `Cleanup`-implementing resources (sessions, watchers, timers). Register new tracked resources with `resourceManager.Register()`. Shutdown calls cascade through these.

**SSH/SFTP mutex separation is critical**: `a.ssh.sshSessionsMutex` is for SSH sessions, `a.ssh.sftpClientsMutex` is for SFTP clients. Mixing them deadlocks. Never substitute one for the other.

### File layout (backend)

The Go code is split by concern across many files in package `main`:

- `main.go` / `main_linux.go` / `main_darwin.go` — platform entry points; share `createAppOptions()` from `app_core.go`. The Linux variant is non-frameless (native decorations); Windows is frameless.
- `app_core.go` — startup/shutdown, Wails options, basic methods. **Keep separate from `app.go`**.
- `app.go` — file/dialog selection business logic.
- `app_tabs.go` — all tab CRUD, SSH tab connections, status, reordering.
- `app_profiles.go` — profile/folder CRUD, tree, virtual folders, search, tag/metric APIs.
- `app_sftp.go` — SFTP file explorer (initialize sessions, list/upload/download, batch transfers, progress events).
- `app_system.go` — local + remote system stats, CPU/memory/network/disk monitoring.
- `app_monitoring.go` — metric history wiring for the monitoring manager.
- `app_ai.go`, `ai_manager.go`, `ai_providers.go` — AI integration.
- `app_unix.go` / `app_windows.go` — platform-specific shell/PTY code.
- `profile_core.go` / `profile_storage.go` / `profile_watcher.go` / `profile_tree.go` / `profile_metrics.go` — profile manager split by responsibility (CRUD / file I/O / fsnotify watcher / tree+virtual folders / analytics).
- `config.go` (`AppConfig`, defaults, validators) + `config_manager.go` (universal `ConfigGet`/`ConfigSet` system, `settingConfigs` registry, atomic save with backup, debounce).
- `ssh_manager.go`, `terminal_manager.go`, `message_manager.go`, `platform_info.go`, `version.go`, `window_manager.go`, `types.go`.

When adding a feature, place it in the corresponding `app_*.go` file or manager rather than growing `app.go` / `app_core.go`. Maintain the separation.

### Frontend (`frontend/src/`)

Plain JS modules built with Vite, no framework. Wails-generated bindings live in `frontend/wailsjs/` and are called as `window.go.main.App.Method(...)`.

- `main.js` — application coordinator, wires modules together.
- `modules/terminal.js` — xterm.js sessions, PTY bridge. **Always extend terminal features through `setupGlobalOutputListener()`**.
- `modules/tabs.js`, `modules/sidebar.js`, `modules/settings.js`, `modules/status.js`, `modules/remote-explorer.js`, `modules/window-controls.js`, `modules/activity-bar.js`, `modules/theme-manager.js`, `modules/context-menu.js`.
- `components/` — `Modal.js`, `Notification.js`, `GraphModal.js`, `LiveSearch.js`, `AIFloatWindow.js`, `VersionManager.js`. **Always use** `Modal` (`modal.confirm()`, `modal.confirmDelete()`, `modal.info()`, `modal.error()`) and `Notification` (`notification.success/error/warning/info()`) for dialogs/notifications — don't roll your own.
- `managers/` — `view-manager.js`, `sidebar-state-manager.js`, `activity-event-handler.js`, orchestrated by `activity-bar.js`.
- `templates.js` + `dom.js` — HTML is generated dynamically from a minimal `index.html` skeleton.
- `styles/` — modular CSS, all imports from `styles/main.css`. Theme via CSS variables in `variables.css`.
- Icons: load via inline SVG (`updateAllIconsToInline()` / `loadSvgContent()` in theme-manager) so `currentColor` works across themes — **don't use `<img>`-based SVGs**. Pass an explicit `isDark` to `updateThemeToggleIcon()` to avoid prod race conditions.

### Universal config system (`config_manager.go`)

All settings flow through `ConfigGet(name)` / `ConfigSet(name, value)`, backed by the `settingConfigs` map. Adding a new setting requires (per `README.md`): (1) add field to `AppConfig`, (2) default in `DefaultConfig()`, (3) entry in `settingConfigs` (specifying `Type`, optional `Min`/`Max`/`MaxLength`/`AllowedValues`, `ConfigField` for auto-mapping, or `CustomUpdate` for special cases), (4) a case in the `ConfigGet` switch, (5) optional event emission via `RequiresEvent`/`EventName`. Frontend calls `window.go.main.App.ConfigGet/ConfigSet`.

Auto-save is debounced — `markConfigDirty()` schedules an atomic write (with backup) to `~/.thermic/config.yaml`. Use `config.mutex` (not `app.mutex`) for timer ops; check `app.ctx != nil` before async saves. Always validate with `config.Validate()` before writing.

### Unified messaging (`message_manager.go`)

Use `a.messages.*` (not separate SSH/tab message paths) for **all** terminal status output and connection lifecycle. Key methods: `EmitMessage`, `UpdateConnectionStatus`, `StartConnectionFlow`, `ConnectionEstablished`, `SessionReady`, `ConnectionFailed`. It also handles host-key prompts and connection animations centrally with status icons (● ✓ ⚠ ✗ ⏳).

### Type safety & resource limits

- Use the strongly-typed IDs from `types.go` (`SessionID`, `ProfileID`, `TabID`, `FolderID`, `SSHSessionID`) instead of bare strings.
- Use the constants `ProfileTypeLocal`/`ProfileTypeSSH`/`ProfileTypeCustom`, `ConnectionTypeLocal`/`ConnectionTypeSSH`, `StatusConnecting`/`StatusConnected`/etc. (call `.String()` for serialization).
- Respect limits: `MaxSessions=50`, `MaxProfiles=1000`, `MaxFileHistory=100`, `MaxTagsPerProfile=20`, `MaxSSHSessions=25`, `MaxSFTPClients=25`. `BoundedMap`/`BoundedSlice` enforce these via FIFO eviction (closing evicted resources).
- All user-facing types implement `Validator.Validate()` — call it before persisting.

### Profiles & folders

Use **ID-based references only**: `Profile.FolderID`, `ProfileFolder.ParentFolderID`. The deprecated `FolderPath`/`ParentPath` fields have been removed. Profile/folder rename cleans up the old YAML file to prevent duplicate-ID artifacts. `validateProfile`/`validateProfileFolder` and `sanitizeFilename` must run before file ops; all paths stay within the profiles directory; `ProfileError` is the structured error type. Tag operations enforce `MaxTagsPerProfile`.

### SFTP

`InitializeFileExplorerSession` checks `MaxSFTPClients` before allocating. Wraps clients in `SFTPClientWrapper` for tracked cleanup. Transfer config (`SFTPConfig` in `config.yaml`) tunes `MaxPacketSize`, `BufferSize`, `ConcurrentRequests`, `ParallelTransfers`, `UseConcurrentIO`. Uploads emit `sftp-upload-progress`, downloads emit `sftp-download-progress` with `bytesPerSec`. Path validation (undefined/null) must happen on both sides; backend uses `sftpClient.Getwd()` for absolute-path consistency.

When determining text-vs-binary for remote viewing, backend uses `isTextContentWithExtension()` (checks extension + content). Frontend `RemoteExplorerManager` has base64 auto-decode for known text extensions to handle backend mis-classification.

### SSH key auto-discovery

Per-profile, user-controlled (`SSHConfig.AllowKeyAutoDiscovery`). Only when explicitly enabled does Thermic scan `~/.ssh` (or Windows equivalent) for valid private keys to try. Default: explicit `KeyPath` only.

### Terminal sizing

`TerminalManager` uses visibility-aware sizing with a `MutationObserver`, deferred-op queue, container-dimension validation, per-terminal `ResizeObserver` (Phase 2), exponential backoff retry (100ms→3.2s), and DOM-connectivity checks. The `TerminalManager.handleResize()` method must fit terminals and emit `frontend:window:resized` so the backend persists window state. On SSH reconnect, backend `ReconnectTab()` emits `tab-reconnected-sizing`; frontend `handleReconnectionSizing()` re-fits with fallbacks. Never auto-clear terminals in resource cleanup — xterm.js scrolls naturally and clearing disrupts the user.

For Ctrl+L / context-menu clear, call `clearTerminal(sessionId)` (uses `terminal.reset()`) — **not** `WriteToShell('\x0C')`. The latter doesn't clear scrollback.

## Conventions and gotchas

- App layer separation: `app_core.go` = lifecycle/options, `app.go` = business logic. Tab/profile/system/SFTP/AI logic each live in their dedicated `app_*.go` file. Don't merge them back.
- Platform detection: cache `runtime.GOOS` in `currentPlatform`; use `PlatformWindows`/`PlatformLinux`/`PlatformDarwin` constants.
- Window controls: integrated into the tabs titlebar, no separate header. macOS controls left (12px, 6px gap), Windows/Linux controls right (46×32). macOS titlebar 28px, Windows/Linux 32px.
- Settings panel slides from the right; profile/folder panels slide from the left; both start below the tabs bar.
- Theme: `GetTheme()`/`SetTheme()` persist to `config.yaml`. Settings panel theme changes must call `terminalManager.updateTheme()` and `uiManager.onThemeChange()` so the terminal updates too.
- Sidebar save button: only `handleProfileSave()` — duplicate handlers cause multiple API calls.
- Config dir: `~/.thermic/config.yaml` (perms 0600, dir 0750).
- The minimal `default.mdc` cursor rule asks: before non-trivial implementation, describe the plan and wait for approval.

## CI

`.github/workflows/ci.yml` runs on PRs to `main`: gofmt, `go vet`, `go test` (with `-tags webkit2_41` on Ubuntu), then a build matrix on ubuntu/windows/macos. `.github/workflows/build-release.yml` runs on `v*` tags and produces release artifacts for windows-amd64, linux-amd64, darwin-amd64, darwin-arm64.
