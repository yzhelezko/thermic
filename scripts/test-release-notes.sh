#!/bin/bash

# Test script for release notes generation
# Usage: ./scripts/test-release-notes.sh [tag] [--demo]

# Configure git to prevent hanging
git config --global core.pager cat
export GIT_PAGER=cat

CURRENT_TAG="${1:-v1.0.0}"
DEMO_MODE="${2}"

echo "Testing release notes generation for tag: $CURRENT_TAG"

if [ "$DEMO_MODE" = "--demo" ]; then
  echo "Running in DEMO mode with example commit data"
  
  # Create demo data showing how bullet points would be extracted
  cat << 'EOF' > /tmp/demo_commits.txt
feat: Add SSH connection management|- Add auto-reconnect functionality for dropped connections
- Implement connection status monitoring 
- Add visual indicators for connection states|a1b2c3d|John Doe
fix: Resolve terminal hanging issues|- Fix hanging detection for SSH connections
- Correct timeout handling in terminal processes
- Repair context menu positioning bug|b2c3d4e|Jane Smith
improve: Enhance UI and performance|- Optimize terminal rendering performance
- Update status bar design with modern icons
- Refactor code cleanup and organization|c3d4e5f|Bob Wilson
Other commit without bullets|No bullet points here, just regular text|d4e5f6g|Alice Brown
EOF

  ALL_COMMITS=$(cat /tmp/demo_commits.txt)
  COMMIT_COUNT=4
  PREVIOUS_TAG="v0.1.0"
  
else
  # Get the previous tag
  PREVIOUS_TAG=$(git tag --sort=-version:refname | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+" | head -1)

  echo "Current tag: $CURRENT_TAG"
  echo "Previous tag: $PREVIOUS_TAG"

  # Generate categorized commit log since last tag
  if [ -n "$PREVIOUS_TAG" ]; then
    echo "Generating changelog from $PREVIOUS_TAG to HEAD"
    
    # Get all commits with full body text
    ALL_COMMITS=$(git log --pretty=format:"%s|%b|%h|%an" $PREVIOUS_TAG..HEAD --no-merges)
    COMMIT_COUNT=$(git rev-list --count $PREVIOUS_TAG..HEAD --no-merges)
    
  else
    echo "No previous tag found, showing recent commits"
    ALL_COMMITS=$(git log --pretty=format:"%s|%b|%h|%an" --max-count=10 --no-merges)
    COMMIT_COUNT=$(git rev-list --count HEAD --max-count=10 --no-merges)
  fi
fi

# Extract and categorize bullet points from commits
FEATURES=""
FIXES=""
IMPROVEMENTS=""
OTHER=""

# Process each commit
while IFS='|' read -r subject body hash author; do
  [ -z "$subject" ] && continue  # Skip empty lines
  
  # First, categorize the main commit message
  commit_category=""
  if [[ $subject =~ ^[Ff]eat.*|^[Aa]dd.*|^[Nn]ew.* ]]; then
    commit_category="FEATURES"
  elif [[ $subject =~ ^[Ff]ix.*|^[Bb]ug.*|^[Rr]epair.* ]]; then
    commit_category="FIXES"
  elif [[ $subject =~ ^[Ii]mprove.*|^[Ee]nhance.*|^[Oo]ptimize.*|^[Uu]pdate.*|^[Rr]efactor.* ]]; then
    commit_category="IMPROVEMENTS"
  else
    commit_category="OTHER"
  fi
  
  # Extract bullet points from commit body
  bullet_points=$(echo "$body" | grep -E "^\s*-\s+" | sed 's/^\s*-\s*/- /' | sed 's/$//')
  
  if [ -n "$bullet_points" ]; then
    # Add bullet points with commit reference
    while IFS= read -r bullet; do
      if [ -n "$bullet" ]; then
        # Categorize bullet points based on keywords
        if [[ $bullet =~ [Ff]eat|[Aa]dd|[Nn]ew|[Ii]mplement ]]; then
          FEATURES="$FEATURES$bullet ([$hash])\n"
        elif [[ $bullet =~ [Ff]ix|[Bb]ug|[Rr]epair|[Cc]orrect ]]; then
          FIXES="$FIXES$bullet ([$hash])\n"
        elif [[ $bullet =~ [Ii]mprove|[Ee]nhance|[Oo]ptimize|[Uu]pdate|[Rr]efactor ]]; then
          IMPROVEMENTS="$IMPROVEMENTS$bullet ([$hash])\n"
        else
          # Use the commit's category for uncategorized bullet points
          case $commit_category in
            "FEATURES") FEATURES="$FEATURES$bullet ([$hash])\n" ;;
            "FIXES") FIXES="$FIXES$bullet ([$hash])\n" ;;
            "IMPROVEMENTS") IMPROVEMENTS="$IMPROVEMENTS$bullet ([$hash])\n" ;;
            *) OTHER="$OTHER$bullet ([$hash])\n" ;;
          esac
        fi
      fi
    done <<< "$bullet_points"
  else
    # No bullet points, add the main subject
    case $commit_category in
      "FEATURES") FEATURES="$FEATURES- $subject ([$hash])\n" ;;
      "FIXES") FIXES="$FIXES- $subject ([$hash])\n" ;;
      "IMPROVEMENTS") IMPROVEMENTS="$IMPROVEMENTS- $subject ([$hash])\n" ;;
      *) OTHER="$OTHER- $subject ([$hash])\n" ;;
    esac
  fi
done <<< "$ALL_COMMITS"

# Get build info
BUILD_DATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
GIT_COMMIT=$(git rev-parse --short HEAD)

# Get contributors since last tag
if [ -n "$PREVIOUS_TAG" ] && [ "$DEMO_MODE" != "--demo" ]; then
  CONTRIBUTORS=$(git log --pretty=format:"%an" $PREVIOUS_TAG..HEAD --no-merges | sort -u | sed 's/^/- /')
elif [ "$DEMO_MODE" = "--demo" ]; then
  CONTRIBUTORS="- John Doe\n- Jane Smith\n- Bob Wilson\n- Alice Brown"
else
  CONTRIBUTORS=$(git log --pretty=format:"%an" --max-count=10 --no-merges | sort -u | sed 's/^/- /')
fi

# Create release notes
cat << EOF > test_release_notes.md
## Thermic $CURRENT_TAG

Cross-platform terminal emulator with advanced SSH connection management and WSL support.

### 🎯 What's New in This Release

EOF

if [ "$COMMIT_COUNT" -gt 0 ]; then
  echo "**$COMMIT_COUNT commits** since ${PREVIOUS_TAG:-"initial development"}:" >> test_release_notes.md
  echo "" >> test_release_notes.md
  
  # Add categorized sections
  if [ -n "$FEATURES" ]; then
    echo "#### 🆕 New Features" >> test_release_notes.md
    echo -e "$FEATURES" >> test_release_notes.md
  fi
  
  if [ -n "$IMPROVEMENTS" ]; then
    echo "#### 🔧 Improvements & Updates" >> test_release_notes.md
    echo -e "$IMPROVEMENTS" >> test_release_notes.md
  fi
  
  if [ -n "$FIXES" ]; then
    echo "#### 🐛 Bug Fixes" >> test_release_notes.md
    echo -e "$FIXES" >> test_release_notes.md
  fi
  
  if [ -n "$OTHER" ]; then
    echo "#### 📝 Other Changes" >> test_release_notes.md
    echo -e "$OTHER" >> test_release_notes.md
  fi
else
  echo "Initial release with core terminal emulator functionality." >> test_release_notes.md
fi

cat << EOF >> test_release_notes.md

### 📦 Downloads
- **Windows**: thermic-windows-amd64.exe
- **Linux**: thermic-linux-amd64  
- **macOS Intel**: thermic-darwin-amd64
- **macOS Apple Silicon**: thermic-darwin-arm64

### 🌟 Key Features
- 🖥️ Cross-platform terminal emulator
- 🔒 Advanced SSH connection management with auto-reconnect
- 🐧 WSL support on Windows
- 🎨 VS Code-like terminal experience with tabs
- ⚡ Built with Wails and xterm.js
- 🔄 Auto-update functionality
- 📊 Real-time system monitoring in status bar
- 🎯 Smart connection hanging detection
- 🔧 Context-aware right-click menus

### 🚀 Installation
1. Download the appropriate binary for your platform
2. Make it executable (Linux/macOS): \`chmod +x thermic-*\`
3. Run the application

### 🔄 Auto-Update
The application automatically checks for updates and notifies you through the status bar.
EOF

# Add contributors section if there are any
if [ -n "$CONTRIBUTORS" ]; then
  echo "" >> test_release_notes.md
  echo "### 👥 Contributors" >> test_release_notes.md
  echo "Thanks to everyone who contributed to this release:" >> test_release_notes.md
  echo "" >> test_release_notes.md
  echo -e "$CONTRIBUTORS" >> test_release_notes.md
fi

cat << EOF >> test_release_notes.md

### 📋 Build Information
- **Build Date**: $BUILD_DATE
- **Git Commit**: $GIT_COMMIT
- **Platforms**: Windows (amd64), Linux (amd64), macOS (Intel + Apple Silicon)
EOF

# Debug output
echo "=== Debug Information ==="
echo "Current tag: $CURRENT_TAG"
echo "Previous tag: $PREVIOUS_TAG"
echo "Commit count: $COMMIT_COUNT"
echo "Features found: $([ -n "$FEATURES" ] && echo "YES" || echo "NO")"
echo "Fixes found: $([ -n "$FIXES" ] && echo "YES" || echo "NO")"
echo "Improvements found: $([ -n "$IMPROVEMENTS" ] && echo "YES" || echo "NO")"
echo "Other changes found: $([ -n "$OTHER" ] && echo "YES" || echo "NO")"
echo "Contributors found: $([ -n "$CONTRIBUTORS" ] && echo "YES" || echo "NO")"
echo "=========================="

echo ""
echo "Generated test release notes:"
echo "=========================="
cat test_release_notes.md
echo "=========================="
echo ""
echo "Test release notes saved to: test_release_notes.md"

# Clean up demo file
[ "$DEMO_MODE" = "--demo" ] && rm -f /tmp/demo_commits.txt 