# Command Center Deploy Script
# Deploys to server at 100.117.103.53 via Tailscale

param(
    [switch]$SkipBuild,
    [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

$ServerIP = "100.117.103.53"
$ServerDrive = "Z:"
$ServerShare = "\\REDHEADKIDZCARD\command-center"
$PM2Process = "command-center"
$SSHUser = "deploy"
$SSHPass = "deploy123"

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

Write-Host "Files copied successfully!" -ForegroundColor Green

# Step 3: Restart PM2 on server via SSH
if (-not $SkipRestart) {
    Write-Host "`n[3/3] Restarting PM2 on server..." -ForegroundColor Yellow

    # Create expect-like script for SSH with password
    $restartCommand = "pm2 restart $PM2Process"

    # Try using plink (PuTTY) if available
    $plink = Get-Command plink -ErrorAction SilentlyContinue
    if ($plink) {
        Write-Host "  Using plink for SSH..." -ForegroundColor Cyan
        echo y | plink -ssh -pw $SSHPass "$SSHUser@$ServerIP" $restartCommand
    } else {
        # Try native SSH with sshpass-like approach using stdin
        Write-Host "  Using native SSH..." -ForegroundColor Cyan

        # Write a temporary script to handle the SSH
        $tempScript = [System.IO.Path]::GetTempFileName() + ".ps1"
        @"
`$env:SSH_ASKPASS = "echo $SSHPass"
`$env:DISPLAY = ":0"
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=no ${SSHUser}@${ServerIP} "$restartCommand" 2>&1
"@ | Out-File -FilePath $tempScript -Encoding UTF8

        try {
            # Try SSH directly - it may prompt for password or use key
            $result = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${SSHUser}@${ServerIP}" $restartCommand 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  PM2 restarted successfully!" -ForegroundColor Green
            } else {
                throw "SSH failed"
            }
        } catch {
            Write-Host "  SSH auto-restart failed. Manual restart required:" -ForegroundColor Yellow
            Write-Host "    ssh ${SSHUser}@${ServerIP}" -ForegroundColor Cyan
            Write-Host "    pm2 restart $PM2Process" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  Or use the file watcher (run on server):" -ForegroundColor Yellow
            Write-Host "    node watch-restart.js" -ForegroundColor Cyan
        } finally {
            Remove-Item -Path $tempScript -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host "`n[3/3] Skipping PM2 restart..." -ForegroundColor Gray
}

Write-Host "`n=== Deploy Complete ===" -ForegroundColor Green
Write-Host "Server URL: http://${ServerIP}:3456" -ForegroundColor Cyan
