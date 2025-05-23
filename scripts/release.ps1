# Thermic Terminal Release Script (PowerShell)
# This script helps create a new release by creating and pushing a git tag

param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

# Function to print colored output
function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

# Validate version format (basic check)
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Invalid version format. Please use semantic versioning (e.g., 1.0.0)"
    exit 1
}

$Tag = "v$Version"

Write-Info "Preparing release for Thermic Terminal $Tag"

# Check if we're on main branch
$CurrentBranch = git branch --show-current
if ($CurrentBranch -ne "main") {
    Write-Warning "You are not on the main branch (current: $CurrentBranch)"
    $Response = Read-Host "Do you want to continue? (y/N)"
    if ($Response -ne "y" -and $Response -ne "Y") {
        Write-Info "Cancelled release process"
        exit 0
    }
}

# Check if working directory is clean
$GitStatus = git status --porcelain
if ($GitStatus) {
    Write-Error "Working directory is not clean. Please commit or stash changes first."
    git status --short
    exit 1
}

# Check if tag already exists
$ExistingTags = git tag
if ($ExistingTags -contains $Tag) {
    Write-Error "Tag $Tag already exists"
    exit 1
}

# Pull latest changes
Write-Info "Pulling latest changes from remote..."
git pull origin main

# Run tests before creating release
Write-Info "Running tests..."
try {
    $GoAvailable = Get-Command go -ErrorAction Stop
    go test ./...
    Write-Success "Tests passed"
} catch {
    Write-Warning "Go not found, skipping tests"
}

# Create tag
Write-Info "Creating tag $Tag..."
$TagMessage = @"
Release $Tag

## Thermic Terminal $Tag

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
- macOS Apple Silicon: thermic-darwin-arm64
"@

git tag -a $Tag -m $TagMessage

Write-Success "Tag $Tag created locally"

# Push tag
Write-Info "Pushing tag to remote..."
git push origin $Tag

Write-Success "Tag $Tag pushed to remote"

Write-Info "🚀 Release process initiated!"
Write-Info "GitHub Actions will now:"
Write-Info "  1. Build binaries for all platforms"
Write-Info "  2. Create a GitHub release"
Write-Info "  3. Upload binaries as release assets"
Write-Info ""

# Try to get the repository URL for actions link
try {
    $RemoteUrl = git config --get remote.origin.url
    $RepoPath = $RemoteUrl -replace '.*github\.com[:/]([^.]*).*', '$1'
    Write-Info "Check the progress at: https://github.com/$RepoPath/actions"
} catch {
    Write-Info "Check the progress in your GitHub repository's Actions tab"
}

Write-Info ""
Write-Success "Release $Tag is being prepared! 🎉" 