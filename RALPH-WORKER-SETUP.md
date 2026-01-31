# Ralph Worker Setup - Windows Workstation

Run these commands on your **WORKSTATION** (where your code repos live).

## Prerequisites

- Node.js installed
- Git configured with credentials
- Repos cloned locally:
  - `C:/Users/huddl/OneDrive/Desktop/GitHub/slabtrack`
  - `C:/Users/huddl/OneDrive/Desktop/module-library`
  - `C:/Users/huddl/command-center`

## Step 1: Install PM2 (one-time)

Open PowerShell as Administrator:

```powershell
# Install PM2 globally
npm install -g pm2

# Install Windows startup module
npm install -g pm2-windows-startup

# Initialize Windows startup
pm2-startup install
```

## Step 2: Start Ralph Worker

```powershell
# Navigate to command-center
cd C:\Users\huddl\command-center

# Start Ralph Worker with PM2
pm2 start ecosystem.config.js --only ralph-worker

# Check status
pm2 status

# View logs
pm2 logs ralph-worker
```

You should see:
```
╔══════════════════════════════════════════════════════════════╗
║              ✓ CONNECTED TO ATLAS SERVER                     ║
╚══════════════════════════════════════════════════════════════╝

[SUCCESS] Socket ID: abc123xyz
[INFO] Worker: Workstation
[INFO] Waiting for tasks from ATLAS...
```

## Step 3: Save PM2 Configuration

```powershell
# Save the current PM2 process list
pm2 save

# This ensures Ralph Worker restarts on boot
```

## Step 4: Verify Auto-Start

1. Restart your workstation
2. Open PowerShell
3. Run `pm2 status`
4. Ralph Worker should be running automatically

## Useful PM2 Commands

```powershell
# View status
pm2 status

# View logs (live)
pm2 logs ralph-worker

# View logs (last 100 lines)
pm2 logs ralph-worker --lines 100

# Restart worker
pm2 restart ralph-worker

# Stop worker
pm2 stop ralph-worker

# Delete from PM2
pm2 delete ralph-worker

# Monitor (interactive)
pm2 monit
```

## Troubleshooting

### Worker not connecting?

1. Check ATLAS server is running:
   ```powershell
   curl http://100.117.103.53:3002/api/health
   ```

2. Check Tailscale is connected:
   ```powershell
   tailscale status
   ```

3. View worker logs:
   ```powershell
   pm2 logs ralph-worker --lines 50
   ```

### Worker keeps restarting?

Check the error logs:
```powershell
type C:\Users\huddl\command-center\logs\ralph-error.log
```

### Need to update ATLAS IP?

Edit `ecosystem.config.js` and update `ATLAS_URL`, then:
```powershell
pm2 restart ralph-worker
```

## Testing

1. Open ATLAS Dashboard in browser
2. Chat with Ralph: `execute on slabtrack: add a comment to server.js`
3. Watch the Ralph Visualizer open
4. Worker executes task locally
5. Changes are committed and pushed to git
6. Railway/Vercel auto-deploy

## Architecture

```
YOUR WORKSTATION                    ASUS SERVER
┌─────────────────┐                ┌─────────────────┐
│  ralph-worker   │ ──WebSocket──▶ │  ATLAS Server   │
│  (PM2 managed)  │                │  (PM2 managed)  │
│                 │ ◀──Tasks────── │                 │
│  - Executes CLI │                │  - Dashboard    │
│  - Git push     │ ──Progress───▶ │  - Visualizer   │
└─────────────────┘                └─────────────────┘
        │
        ▼ (git push)
┌─────────────────┐
│  GitHub         │
│  └─▶ Railway    │ (auto-deploy)
│  └─▶ Vercel     │ (auto-deploy)
└─────────────────┘
```
