# Thermic Terminal

A modern, cross-platform terminal emulator built with Wails and xterm.js, inspired by VS Code's terminal implementation.

## 🎯 **VS Code Terminal Architecture Comparison**

### **VS Code Implementation:**
- **Backend**: `node-pty` (Node.js pseudo-terminal library)
- **Frontend**: `xterm.js` for terminal display
- **Communication**: IPC between main/renderer processes
- **Data Flow**: Raw byte streams with full PTY support
- **Platform**: Electron (Node.js + Chromium)

### **Thermic Implementation:**
- **Backend**: Go with `os/exec` and raw pipe streaming
- **Frontend**: `xterm.js` (same as VS Code)
- **Communication**: Wails events system
- **Data Flow**: Raw byte streams (VS Code style)
- **Platform**: Wails (Go + WebView)

## 🔄 **Recent Fixes (v2.0)**

### **Issues Fixed:**
1. ❌ **`terminal.getSize() is not a function`** → ✅ Use `terminal.cols` and `terminal.rows`
2. ❌ **Line-by-line output buffering** → ✅ Raw byte streaming (like VS Code)
3. ❌ **PowerShell initialization issues** → ✅ Use `-Interactive` flag instead of `-Command`
4. ❌ **Timing issues with terminal sizing** → ✅ Added proper async handling

### **VS Code-Style Improvements:**
- **Raw byte streaming**: Data flows as raw bytes, preserving ANSI sequences
- **Interactive shells**: Proper interactive mode for PowerShell and other shells
- **Event-driven architecture**: Real-time communication like VS Code's IPC
- **Proper terminal lifecycle**: Better session management and cleanup

## Features

- **Cross-platform support**: Works on Windows, macOS, and Linux
- **Multiple shell support**: Automatically detects and supports various shells:
  - **Windows**: PowerShell, Command Prompt (cmd), PowerShell Core (pwsh)
  - **macOS**: zsh (default), bash, fish, and other common shells
  - **Linux**: bash, zsh, fish, sh, and other available shells
- **Modern UI**: Clean, VS Code-inspired interface with dark theme
- **xterm.js integration**: Full-featured terminal emulation (same as VS Code)
- **Real-time shell detection**: Automatically finds available shells on your system
- **Responsive design**: Adapts to window resizing
- **Raw byte streaming**: Preserves ANSI escape sequences and colors

## Technology Stack

- **Backend**: Go with Wails v2 framework
- **Frontend**: Vanilla JavaScript with xterm.js (same library as VS Code)
- **Terminal**: xterm.js with fit and web-links addons
- **Build System**: Vite for frontend bundling
- **Communication**: Wails events (similar to VS Code's IPC)

## Prerequisites

- Go 1.21 or later
- Node.js and npm
- Wails CLI v2

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yzhelezko/thermic.git
cd thermic
```

2. Install dependencies:
```bash
# Install Go dependencies
go mod tidy

# Install frontend dependencies
cd frontend
npm install
cd ..
```

## Development

To run the application in development mode:

```bash
wails dev
```

This will start the application with hot reload enabled for both frontend and backend changes.

## Building

To build the application for production:

```bash
wails build
```

The built executable will be available in the `build/bin` directory.

## Usage

1. Launch the application
2. The terminal will automatically detect your platform and available shells
3. Select a shell from the dropdown in the toolbar
4. Start typing commands in the terminal - **they now actually execute!**

## 🚀 **What Now Works (v2.0)**

### **Real Command Execution:**
```bash
# Windows PowerShell
Get-Date
Get-Process | Select-Object -First 5
Get-ChildItem
Clear-Host

# Windows CMD
dir
echo Hello World
ver
cls

# Unix-like systems
ls -la
pwd
echo "Hello from terminal"
ps aux | head -5
clear
```

### **Features Working:**
✅ **Interactive commands** with real output
✅ **ANSI colors and formatting** preserved
✅ **Tab completion** (shell-dependent)
✅ **Command history** (shell-dependent)
✅ **Multi-line input** support
✅ **Error output** properly displayed
✅ **Shell-specific features** (PowerShell cmdlets, bash aliases, etc.)

## Architecture Deep Dive

### **Data Flow (VS Code Style):**
1. **User Input** → xterm.js captures keystrokes
2. **Frontend** → Sends raw input to Go backend via Wails events
3. **Backend** → Writes to shell's stdin pipe
4. **Shell** → Processes command and outputs to stdout/stderr
5. **Backend** → Reads raw bytes from shell pipes
6. **Frontend** → Receives raw data via Wails events
7. **xterm.js** → Renders output with ANSI sequences

### **Key Differences from VS Code:**
| Feature | VS Code | Thermic |
|---------|---------|---------|
| Backend Language | Node.js | Go |
| PTY Library | node-pty | Custom pipes |
| Process Communication | IPC | Wails events |
| Platform | Electron | Native + WebView |
| Bundle Size | ~150MB | ~15MB |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Roadmap

- [x] ✅ Real shell command execution
- [x] ✅ Raw byte streaming (VS Code style)
- [x] ✅ ANSI color/formatting support
- [x] ✅ Interactive shell modes
- [ ] Full PTY support (proper terminal resize)
- [ ] Multiple terminal tabs
- [ ] Customizable themes
- [ ] Font size and family configuration
- [ ] Terminal session persistence
- [ ] SSH connection support
- [ ] Plugin system
