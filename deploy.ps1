# Command Center Deploy Script
# Deploys to server at 100.117.103.53 via Tailscale

param(
    [switch]$SkipBuild,
    [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

$ServerPath = "\\100.117.103.53\c$\Users\Redhe\command-center"
$PM2Process = "command-center"

Write-Host "=== Command Center Deploy ===" -ForegroundColor Cyan

# Step 1: Build frontend
if (-not $SkipBuild) {
    Write-Host "`n[1/3] Building frontend..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build complete!" -ForegroundColor Green
} else {
    Write-Host "`n[1/3] Skipping build..." -ForegroundColor Gray
}

# Step 2: Copy files to server
Write-Host "`n[2/3] Copying files to server..." -ForegroundColor Yellow

# Verify server is reachable
if (-not (Test-Path $ServerPath)) {
    Write-Host "Cannot reach server at $ServerPath" -ForegroundColor Red
    Write-Host "Make sure Tailscale is connected and the share is accessible." -ForegroundColor Yellow
    exit 1
}

# Copy dist folder
Write-Host "  Copying dist/..."
Copy-Item -Path ".\dist\*" -Destination "$ServerPath\dist\" -Recurse -Force

# Copy server files
Write-Host "  Copying server.js..."
Copy-Item -Path ".\server.js" -Destination "$ServerPath\" -Force

Write-Host "  Copying agents.json..."
Copy-Item -Path ".\agents.json" -Destination "$ServerPath\" -Force

Write-Host "  Copying package.json..."
Copy-Item -Path ".\package.json" -Destination "$ServerPath\" -Force

Write-Host "Files copied!" -ForegroundColor Green

# Step 3: Restart PM2 on server
if (-not $SkipRestart) {
    Write-Host "`n[3/3] Restarting PM2 on server..." -ForegroundColor Yellow

    # Use SSH to restart PM2 (requires SSH key setup)
    # ssh redhe@100.117.103.53 "pm2 restart $PM2Process"

    # Alternative: Use PowerShell remoting if WinRM is configured
    # Invoke-Command -ComputerName 100.117.103.53 -ScriptBlock { pm2 restart command-center }

    # For now, just remind user to restart manually
    Write-Host "  NOTE: SSH/WinRM not configured. Please restart PM2 manually:" -ForegroundColor Yellow
    Write-Host "    ssh redhe@100.117.103.53 'pm2 restart $PM2Process'" -ForegroundColor Cyan
    Write-Host "    OR run on server: pm2 restart $PM2Process" -ForegroundColor Cyan
} else {
    Write-Host "`n[3/3] Skipping PM2 restart..." -ForegroundColor Gray
}

Write-Host "`n=== Deploy Complete ===" -ForegroundColor Green
Write-Host "Server URL: http://100.117.103.53:3456" -ForegroundColor Cyan
