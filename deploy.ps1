# Command Center Deploy Script
# Deploys to server at 100.117.103.53 via Tailscale
# PM2 restart is handled by watch-restart.js on the server

param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ServerDrive = "Z:"
$ServerShare = "\\REDHEADKIDZCARD\command-center"

Write-Host "=== Command Center Deploy ===" -ForegroundColor Cyan

# Step 1: Build frontend
if (-not $SkipBuild) {
    Write-Host "`n[1/2] Building frontend..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build complete!" -ForegroundColor Green
} else {
    Write-Host "`n[1/2] Skipping build..." -ForegroundColor Gray
}

# Step 2: Copy files to server
Write-Host "`n[2/2] Copying files to server..." -ForegroundColor Yellow

# Check if Z: drive is mapped, if not map it
if (-not (Test-Path $ServerDrive)) {
    Write-Host "  Mapping $ServerDrive to $ServerShare..." -ForegroundColor Yellow
    net use $ServerDrive $ServerShare /persistent:yes
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Failed to map drive. Trying direct path..." -ForegroundColor Yellow
        $DestPath = $ServerShare
    } else {
        $DestPath = $ServerDrive
    }
} else {
    $DestPath = $ServerDrive
}

Write-Host "  Destination: $DestPath" -ForegroundColor Cyan

# Copy dist folder using robocopy
Write-Host "  Copying dist/ folder..."
robocopy ".\dist" "$DestPath\dist" /MIR /NJH /NJS /NDL /NC /NS /NP /R:3 /W:1
if ($LASTEXITCODE -ge 8) {
    Write-Host "Failed to copy dist folder! Error: $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

# Copy individual files
Write-Host "  Copying server.js..."
Copy-Item -Path ".\server.js" -Destination "$DestPath\" -Force

Write-Host "  Copying agents.json..."
Copy-Item -Path ".\agents.json" -Destination "$DestPath\" -Force

Write-Host "  Copying package.json..."
Copy-Item -Path ".\package.json" -Destination "$DestPath\" -Force

Write-Host "`n=== Deploy Complete ===" -ForegroundColor Green
Write-Host "Files copied. Watcher will restart PM2 automatically." -ForegroundColor Gray
Write-Host "Server URL: http://100.117.103.53:3002" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: ralph-worker.js runs on WORKSTATION, not server." -ForegroundColor DarkGray
Write-Host "      Restart workstation worker: pm2 restart ralph-worker" -ForegroundColor DarkGray
