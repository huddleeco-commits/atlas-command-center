/**
 * File Watcher for PM2 Auto-Restart
 * Run this on the server: node watch-restart.js
 *
 * Watches for changes to key files and restarts PM2 automatically.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PM2_PROCESS = 'command-center';
const WATCH_FILES = ['server.js', 'agents.json', 'package.json'];
const WATCH_DIRS = ['dist'];
const DEBOUNCE_MS = 2000; // Wait 2 seconds after last change before restarting

let restartTimeout = null;
let lastRestart = 0;

console.log('🔄 Command Center File Watcher');
console.log('================================');
console.log(`Watching: ${WATCH_FILES.join(', ')}, ${WATCH_DIRS.join('/')}`);
console.log(`PM2 Process: ${PM2_PROCESS}`);
console.log('');

function restartPM2() {
  const now = Date.now();
  if (now - lastRestart < DEBOUNCE_MS) {
    return; // Skip if we just restarted
  }

  lastRestart = now;
  console.log(`\n⚡ [${new Date().toLocaleTimeString()}] Restarting PM2...`);

  exec(`pm2 restart ${PM2_PROCESS}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Restart failed: ${error.message}`);
      return;
    }
    console.log(`✅ PM2 restarted successfully`);
    if (stdout) console.log(stdout.trim());
  });
}

function scheduleRestart(filename) {
  console.log(`📁 [${new Date().toLocaleTimeString()}] Changed: ${filename}`);

  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }

  restartTimeout = setTimeout(restartPM2, DEBOUNCE_MS);
}

// Watch individual files
WATCH_FILES.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    fs.watch(filePath, (eventType) => {
      if (eventType === 'change') {
        scheduleRestart(file);
      }
    });
    console.log(`👁️  Watching: ${file}`);
  } else {
    console.log(`⚠️  Not found: ${file}`);
  }
});

// Watch directories recursively
WATCH_DIRS.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (fs.existsSync(dirPath)) {
    fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (eventType === 'change' && filename) {
        scheduleRestart(`${dir}/${filename}`);
      }
    });
    console.log(`👁️  Watching: ${dir}/`);
  } else {
    console.log(`⚠️  Not found: ${dir}/`);
  }
});

console.log('\n✅ Watcher started. Press Ctrl+C to stop.\n');

// Keep the process running
process.on('SIGINT', () => {
  console.log('\n👋 Watcher stopped.');
  process.exit(0);
});
