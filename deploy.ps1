# Command Center Deploy Script
# Deploys to server at 100.117.103.53 via Tailscale

param(
    [switch]$SkipBuild,
    [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

$ServerIP = "100.117.103.53"
$ServerShare = "\\REDHEADKIDZCARD\command-center"
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

# Step 2: Copy files to server using robocopy
Write-Host "`n[2/3] Copying files to server..." -ForegroundColor Yellow

# Ensure we have access to the share
if (-not (Test-Path $ServerShare)) {
    Write-Host "  Connecting to $ServerShare..." -ForegroundColor Yellow
    $cred = Get-Credential -Message "Enter credentials for $ServerShare"
    net use $ServerShare /user:$($cred.UserName) $($cred.GetNetworkCredential().Password)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Failed to connect to share!" -ForegroundColor Red
        exit 1
    }
}

# Copy dist folder using robocopy (mirror mode for efficiency)
Write-Host "  Copying dist/ folder..."
robocopy ".\dist" "$ServerShare\dist" /MIR /NJH /NJS /NDL /NC /NS /NP
if ($LASTEXITCODE -ge 8) {
    Write-Host "Failed to copy dist folder!" -ForegroundColor Red
    exit 1
}

# Copy individual files
Write-Host "  Copying server.js..."
Copy-Item -Path ".\server.js" -Destination "$ServerShare\" -Force

Write-Host "  Copying agents.json..."
Copy-Item -Path ".\agents.json" -Destination "$ServerShare\" -Force

Write-Host "  Copying package.json..."
Copy-Item -Path ".\package.json" -Destination "$ServerShare\" -Force

Write-Host "Files copied successfully!" -ForegroundColor Green

# Step 3: Restart PM2 reminder
if (-not $SkipRestart) {
    Write-Host "`n[3/3] PM2 Restart Required" -ForegroundColor Yellow
    Write-Host "  Run this on the server:" -ForegroundColor White
    Write-Host "    pm2 restart $PM2Process" -ForegroundColor Cyan
} else {
    Write-Host "`n[3/3] Skipping PM2 restart reminder..." -ForegroundColor Gray
}

Write-Host "`n=== Deploy Complete ===" -ForegroundColor Green
Write-Host "Server URL: http://${ServerIP}:3456" -ForegroundColor Cyan
