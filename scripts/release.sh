#!/bin/bash

# Thermic Terminal Release Script
# This script helps create a new release by creating and pushing a git tag

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if version argument is provided
if [ $# -eq 0 ]; then
    print_error "Please provide a version number"
    echo "Usage: $0 <version>"
    echo "Example: $0 1.0.0"
    exit 1
fi

VERSION=$1

# Validate version format (basic check)
if [[ ! $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid version format. Please use semantic versioning (e.g., 1.0.0)"
    exit 1
fi

TAG="v$VERSION"

print_info "Preparing release for Thermic Terminal $TAG"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    print_warning "You are not on the main branch (current: $CURRENT_BRANCH)"
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Cancelled release process"
        exit 0
    fi
fi

# Check if working directory is clean
if [[ -n $(git status --porcelain) ]]; then
    print_error "Working directory is not clean. Please commit or stash changes first."
    git status --short
    exit 1
fi

# Check if tag already exists
if git tag | grep -q "^$TAG$"; then
    print_error "Tag $TAG already exists"
    exit 1
fi

# Pull latest changes
print_info "Pulling latest changes from remote..."
git pull origin main

# Run tests before creating release
print_info "Running tests..."
if command -v go &> /dev/null; then
    go test ./...
    print_success "Tests passed"
else
    print_warning "Go not found, skipping tests"
fi

# Create tag
print_info "Creating tag $TAG..."
git tag -a "$TAG" -m "Release $TAG

## Thermic Terminal $TAG

Cross-platform terminal emulator with WSL support.

### Features
- 🖥️ Cross-platform terminal emulator
- 🐧 WSL support on Windows  
- 🎨 VS Code-like terminal experience
- ⚡ Built with Wails and xterm.js

### Downloads
Binaries will be available after the GitHub Action completes:
- Windows: thermic-windows-amd64.exe
- Linux: thermic-linux-amd64
- macOS Intel: thermic-darwin-amd64
- macOS Apple Silicon: thermic-darwin-arm64"

print_success "Tag $TAG created locally"

# Push tag
print_info "Pushing tag to remote..."
git push origin "$TAG"

print_success "Tag $TAG pushed to remote"

print_info "🚀 Release process initiated!"
print_info "GitHub Actions will now:"
print_info "  1. Build binaries for all platforms"
print_info "  2. Create a GitHub release"
print_info "  3. Upload binaries as release assets"
print_info ""
print_info "Check the progress at: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/actions"
print_info ""
print_success "Release $TAG is being prepared! 🎉" 