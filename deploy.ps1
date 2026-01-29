# Command Center Deploy Script
# Deploys to server at 100.117.103.53 via Tailscale

param(
    [switch]$SkipBuild,
    [switch]$SkipRestart,
    [switch]$UseSSH,
    [string]$User = "Redhe"
)

$ErrorActionPreference = "Stop"

$ServerIP = "100.117.103.53"
$ServerPath = "\\$ServerIP\c$\Users\$User\command-center"
$RemotePath = "C:\Users\$User\command-center"
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

if ($UseSSH) {
    # SSH/SCP deployment
    Write-Host "  Using SSH/SCP for file transfer..." -ForegroundColor Cyan

    # Copy dist folder
    Write-Host "  Copying dist/..."
    scp -r ./dist/* "${User}@${ServerIP}:${RemotePath}/dist/"

    # Copy server files
    Write-Host "  Copying server.js..."
    scp ./server.js "${User}@${ServerIP}:${RemotePath}/"

    Write-Host "  Copying agents.json..."
    scp ./agents.json "${User}@${ServerIP}:${RemotePath}/"

    Write-Host "  Copying package.json..."
    scp ./package.json "${User}@${ServerIP}:${RemotePath}/"

    Write-Host "Files copied via SSH!" -ForegroundColor Green

} else {
    # Windows file share deployment
    # Verify server is reachable
    if (-not (Test-Path $ServerPath)) {
        Write-Host "Cannot reach server at $ServerPath" -ForegroundColor Red
        Write-Host ""
        Write-Host "Options:" -ForegroundColor Yellow
        Write-Host "  1. Map network drive with credentials:" -ForegroundColor White
        Write-Host "     net use Z: $ServerPath /user:$User <password>" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  2. Use SSH deployment instead:" -ForegroundColor White
        Write-Host "     .\deploy.ps1 -UseSSH" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  3. Manual SCP commands:" -ForegroundColor White
        Write-Host "     scp server.js agents.json package.json ${User}@${ServerIP}:${RemotePath}/" -ForegroundColor Cyan
        Write-Host "     scp -r dist/* ${User}@${ServerIP}:${RemotePath}/dist/" -ForegroundColor Cyan
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
}

# Step 3: Restart PM2 on server
if (-not $SkipRestart) {
    Write-Host "`n[3/3] Restarting PM2 on server..." -ForegroundColor Yellow

    if ($UseSSH) {
        Write-Host "  Restarting via SSH..."
        ssh "${User}@${ServerIP}" "pm2 restart $PM2Process"
        Write-Host "PM2 restarted!" -ForegroundColor Green
    } else {
        Write-Host "  NOTE: Run on server to restart:" -ForegroundColor Yellow
        Write-Host "    pm2 restart $PM2Process" -ForegroundColor Cyan
        Write-Host "  OR use SSH deployment: .\deploy.ps1 -UseSSH" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n[3/3] Skipping PM2 restart..." -ForegroundColor Gray
}

Write-Host "`n=== Deploy Complete ===" -ForegroundColor Green
Write-Host "Server URL: http://${ServerIP}:3456" -ForegroundColor Cyan
