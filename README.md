# Thermic Terminal

[![Build Status](https://github.com/yzhelezko/thermic/workflows/CI/badge.svg)](https://github.com/yzhelezko/thermic/actions)
[![Release](https://github.com/yzhelezko/thermic/workflows/Build%20and%20Release/badge.svg)](https://github.com/yzhelezko/thermic/releases)
[![Go Version](https://img.shields.io/badge/Go-1.24+-blue.svg)](https://golang.org)
[![Wails](https://img.shields.io/badge/Wails-v2-red.svg)](https://wails.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, cross-platform terminal emulator built with **Wails** and **xterm.js**, delivering a **VS Code-like terminal experience** with native performance and comprehensive **WSL support**.

![Thermic Terminal Screenshot](https://via.placeholder.com/800x500/0c0c0c/ffffff?text=Thermic+Terminal+Screenshot)

## ✨ Features

### 🚀 **Core Features**
- **🖥️ Cross-Platform**: Native support for Windows, macOS, and Linux
- **🐧 WSL Integration**: Full Windows Subsystem for Linux support with automatic detection
- **⚡ VS Code Experience**: Same xterm.js library with identical terminal behavior
- **🎨 Modern UI**: Clean, dark-themed interface with responsive design
- **🔄 Real-Time**: Raw byte streaming for authentic terminal experience

### 🛠️ **Shell Support**
- **Windows**: PowerShell, Command Prompt, PowerShell Core, WSL distributions
- **macOS**: zsh (default), bash, fish, and other common shells  
- **Linux**: bash, zsh, fish, sh, and all available shells
- **WSL**: Automatic detection and integration of all WSL distributions

### 🏗️ **Developer Features**  
- **🤖 CI/CD Pipeline**: Automated building and releasing for all platforms
- **📦 Binary Distribution**: Ready-to-run executables for all major platforms
- **🔧 Hot Reload**: Development mode with live frontend/backend updates
- **🧪 Quality Assurance**: Automated testing and code quality checks

## 🚀 Quick Start

### Option 1: Download Pre-built Binaries (Recommended)

1. **Download** the latest release for your platform:
   - [📥 **Download Latest Release**](https://github.com/yzhelezko/thermic/releases/latest)

2. **Install** and run:
   ```bash
   # Windows
   # Download thermic-windows-amd64.exe and run

   # Linux
   chmod +x thermic-linux-amd64
   ./thermic-linux-amd64

   # macOS Intel
   chmod +x thermic-darwin-amd64
   ./thermic-darwin-amd64

   # macOS Apple Silicon  
   chmod +x thermic-darwin-arm64
   ./thermic-darwin-arm64
   ```

### Option 2: Build from Source

1. **Prerequisites**:
   - Go 1.24+
   - Node.js 18+
   - Wails CLI v2

2. **Clone and build**:
   ```bash
   git clone https://github.com/yzhelezko/thermic.git
   cd thermic
   go mod tidy
   cd frontend && npm install && cd ..
   wails build
   ```

## 🎯 Architecture: VS Code Comparison

| Component | **VS Code** | **Thermic Terminal** |
|-----------|------------|---------------------|
| **Backend** | Node.js + node-pty | Go + custom PTY |
| **Frontend** | xterm.js | xterm.js (same!) |
| **Platform** | Electron | Wails + WebView |
| **Communication** | IPC | Wails Events |
| **Bundle Size** | ~150MB | ~15MB |
| **Memory Usage** | ~100MB | ~20MB |
| **Startup Time** | ~2s | ~0.5s |

### 🔄 **Data Flow (VS Code Compatible)**
```
User Input → xterm.js → Wails Events → Go Backend → Shell Process
    ↑                                                      ↓
xterm.js ← Wails Events ← Go Backend ← Raw Byte Stream ← Shell Output
```

## 🐧 WSL Integration

Thermic provides **first-class WSL support** on Windows:

### **Automatic Detection**
- ✅ Detects all installed WSL distributions
- ✅ Shows distribution status (Running/Stopped)
- ✅ Identifies default distribution
- ✅ Handles Unicode/BOM in WSL output correctly

### **Seamless Experience**
- 🔄 **Easy Switching**: Toggle between Windows shells and Linux environments
- 🚀 **Auto-Start**: WSL distributions start automatically when selected  
- 🎨 **Native Display**: Full ANSI color and formatting support
- ⚙️ **VS Code Compatible**: Uses same WSL launching mechanism as VS Code

### **Supported WSL Features**
```bash
# All WSL features work seamlessly:
ls -la --color=auto
vim file.txt
htop
docker ps
git status
npm install
```

## 🤖 CI/CD & Releases

### **Automated Pipeline**
- **✅ Continuous Integration**: Tests and builds on every push
- **✅ Cross-Platform Builds**: Windows, Linux, macOS (Intel + ARM) 
- **✅ Automated Releases**: Tag-triggered releases with binaries
- **✅ Quality Gates**: Go formatting, testing, and static analysis

### **Creating Releases**

#### **Method 1: Release Scripts (Recommended)**
```bash
# Linux/macOS
./scripts/release.sh 1.0.0

# Windows PowerShell  
.\scripts\release.ps1 1.0.0
```

#### **Method 2: Manual Git Tags**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**🎉 Result**: Automatic GitHub release with 4 platform binaries!

## 💻 Development

### **Development Mode**
```bash
wails dev
```
- Hot reload for frontend changes
- Automatic Go rebuilds
- Real-time debugging

### **Manual Building**
```bash
# Development build
wails build

# Production build with optimization
wails build -clean -trimpath
```

### **Testing**
```bash
# Run tests
go test ./...

# Code formatting  
gofmt -s -w .

# Static analysis
go vet ./...
```

## 🎨 Terminal Features

### **Interactive Commands** ✅
```bash
# Windows PowerShell
Get-Process | Select-Object -First 5
Get-ChildItem | Where-Object Name -like "*.go"

# Windows CMD  
dir /s
echo %PATH%

# Linux/macOS/WSL
ls -la | grep ".git"
ps aux | head -10
htop
```

### **Advanced Features** ✅
- **🎨 ANSI Colors**: Full color and formatting support
- **📝 Tab Completion**: Shell-native completion 
- **🕐 Command History**: Persistent history per shell
- **📏 Dynamic Resize**: Proper terminal resizing
- **🔗 Clickable Links**: Web and file links detection
- **⌨️ Keyboard Shortcuts**: Standard terminal key bindings

## 🛠️ Technology Stack

### **Backend**
- **Language**: Go 1.24+
- **Framework**: Wails v2
- **Terminal**: Custom PTY implementation with raw byte streaming
- **Shells**: Native process execution with stdin/stdout pipes

### **Frontend**  
- **Terminal**: xterm.js (same as VS Code)
- **Addons**: fit-addon, web-links-addon
- **Build**: Vite bundling
- **Styling**: CSS with VS Code-inspired themes

### **Platform**
- **Windows**: WebView2 
- **macOS**: WKWebView
- **Linux**: WebKit2GTK

## 📁 Project Structure

```
thermic/
├── app.go                 # Main application logic
├── main.go               # Wails app entry point
├── frontend/             # xterm.js frontend
│   ├── src/main.js      # Terminal implementation  
│   └── index.html       # App shell
├── .github/             # CI/CD workflows
│   ├── workflows/       # GitHub Actions
│   └── ISSUE_TEMPLATE/  # Issue templates
├── scripts/             # Release automation
└── build/              # Built binaries
```

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **🍴 Fork** the repository
2. **🌟 Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **✅ Test** your changes: `go test ./...`
4. **📝 Commit** your changes: `git commit -m 'Add amazing feature'`
5. **🚀 Push** to the branch: `git push origin feature/amazing-feature`
6. **🔀 Create** a Pull Request

### **Development Guidelines**
- Follow Go formatting with `gofmt`
- Add tests for new features
- Update documentation as needed
- Test on multiple platforms when possible

## 📋 Roadmap

### **✅ Completed**
- [x] Real shell command execution with PTY
- [x] Raw byte streaming (VS Code compatibility)
- [x] ANSI color and formatting support
- [x] Interactive shell modes for all platforms
- [x] WSL (Windows Subsystem for Linux) integration
- [x] CI/CD pipeline with automated releases  
- [x] Cross-platform binary distribution
- [x] Professional UI with VS Code theming

### **🚧 In Progress**  
- [ ] Multiple terminal tabs/sessions
- [ ] Customizable themes and color schemes
- [ ] Font size and family configuration

### **🔮 Planned**
- [ ] Terminal session persistence  
- [ ] SSH connection support
- [ ] Plugin/extension system
- [ ] Terminal multiplexing (tmux/screen integration)
- [ ] Configuration file support
- [ ] Keyboard shortcut customization

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[Wails](https://wails.io)** - For the amazing Go-to-frontend framework
- **[xterm.js](https://xtermjs.org)** - For the robust terminal emulation library  
- **[VS Code](https://code.visualstudio.com)** - For terminal architecture inspiration
- **Go Community** - For the excellent ecosystem and tools

---

**⭐ Star this repository if you find it useful!**

Made with ❤️ using Go and Wails
