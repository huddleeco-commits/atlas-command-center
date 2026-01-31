/**
 * PM2 Ecosystem Configuration
 *
 * For ATLAS server (runs on ASUS server):
 *   pm2 start ecosystem.config.js --only atlas-server
 *
 * For Ralph worker (runs on YOUR workstation):
 *   pm2 start ecosystem.config.js --only ralph-worker
 */

module.exports = {
  apps: [
    // ATLAS Server - Run on ASUS Server
    {
      name: 'atlas-server',
      script: 'server.js',
      cwd: 'C:/Users/huddl/command-center',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/atlas-error.log',
      out_file: 'logs/atlas-out.log',
      merge_logs: true
    },

    // Ralph Worker - Run on YOUR WORKSTATION
    {
      name: 'ralph-worker',
      script: 'ralph-worker.js',
      cwd: 'C:/Users/huddl/command-center',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',

      // Restart delays
      restart_delay: 5000,        // Wait 5s between restarts
      max_restarts: 100,          // Max restarts before stopping
      min_uptime: '10s',          // Consider running after 10s

      env: {
        NODE_ENV: 'production',
        // ATLAS server on ASUS via Tailscale
        ATLAS_URL: 'http://100.117.103.53:3002',
        ATLAS_TOKEN: 'atlas-ralph-worker-2026',
        WORKER_NAME: 'Workstation'
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/ralph-error.log',
      out_file: 'logs/ralph-out.log',
      merge_logs: true
    }
  ]
};
