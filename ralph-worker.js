#!/usr/bin/env node
/**
 * RALPH WORKER - Local Code Execution Agent
 *
 * Runs on your local machine where the code lives.
 * Connects to ATLAS server via WebSocket.
 * Executes Claude Code CLI tasks and pushes via git.
 *
 * Usage: node ralph-worker.js [--atlas-url wss://your-atlas-server]
 */

const { spawn, execSync } = require('child_process');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // ATLAS server URL - ASUS Server via Tailscale
  // Update this IP if your Tailscale IP changes
  atlasUrl: process.env.ATLAS_URL || 'http://100.117.103.53:3002',

  // Authentication token (must match ATLAS server's expected token)
  authToken: process.env.ATLAS_TOKEN || 'atlas-ralph-worker-2026',

  // Worker name (shown in ATLAS UI)
  workerName: process.env.WORKER_NAME || require('os').hostname(),

  // Project configurations with git settings
  projects: {
    'slabtrack': {
      path: 'C:/Users/huddl/OneDrive/Desktop/GitHub/slabtrack',
      ralphDir: 'scripts/ralph',
      git: {
        remote: 'origin',
        branch: 'main',
        autoPush: true
      },
      structure: {
        frontendEntry: 'frontend/src/App.jsx',
        backendEntry: 'backend/server.js',
        keyFiles: {
          'QuickActions': 'frontend/src/pages/QuickActions.jsx',
          'Scanner': 'backend/services/claude-scanner.js'
        },
        warnings: ['QuickActions.jsx NOT QuickActionsPage.jsx']
      }
    },
    'blink': {
      path: 'C:/Users/huddl/OneDrive/Desktop/module-library',
      ralphDir: 'module-assembler-ui/scripts/ralph',
      git: {
        remote: 'origin',
        branch: 'main',
        autoPush: true
      },
      structure: {
        serverEntry: 'module-assembler-ui/server.cjs',
        frontendEntry: 'module-assembler-ui/src/App.jsx',
        keyFiles: {
          'Main Server': 'module-assembler-ui/server.cjs',
          'Master Agent': 'module-assembler-ui/lib/agents/master-agent.cjs'
        },
        warnings: ['Primary app is in module-assembler-ui/, NOT root']
      }
    },
    'command-center': {
      path: 'C:/Users/huddl/command-center',
      ralphDir: 'scripts/ralph',
      git: {
        remote: 'origin',
        branch: 'main',
        autoPush: false  // Local only, use PM2
      },
      postDeploy: 'pm2 restart command-center',
      structure: {
        serverEntry: 'server.js',
        frontendEntry: 'src/App.jsx',
        keyFiles: {
          'Server': 'server.js',
          'Dashboard': 'src/pages/Dashboard.jsx'
        }
      }
    }
  }
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--atlas-url' && args[i + 1]) {
    CONFIG.atlasUrl = args[i + 1];
  }
  if (args[i] === '--token' && args[i + 1]) {
    CONFIG.authToken = args[i + 1];
  }
}

// State
let socket = null;
let activeTask = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Logging with timestamps
function log(level, ...args) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const prefix = {
    'info': '\x1b[36m[INFO]\x1b[0m',
    'success': '\x1b[32m[SUCCESS]\x1b[0m',
    'error': '\x1b[31m[ERROR]\x1b[0m',
    'warn': '\x1b[33m[WARN]\x1b[0m',
    'task': '\x1b[35m[TASK]\x1b[0m'
  }[level] || '[LOG]';

  console.log(`${timestamp} ${prefix}`, ...args);
}

// Check Claude Code CLI availability
function checkClaudeCLI() {
  try {
    const version = execSync('claude --version', { encoding: 'utf8', timeout: 5000 });
    log('info', `Claude Code CLI: ${version.trim()}`);
    return true;
  } catch (err) {
    log('error', 'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
    return false;
  }
}

// Check git status for a project
function checkGitStatus(projectPath) {
  try {
    const status = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf8' });
    const branch = execSync('git branch --show-current', { cwd: projectPath, encoding: 'utf8' }).trim();
    return { clean: status.trim() === '', branch, status: status.trim() };
  } catch (err) {
    return { clean: false, branch: 'unknown', error: err.message };
  }
}

// Git operations
async function gitCommitAndPush(projectPath, message, gitConfig) {
  const results = { staged: false, committed: false, pushed: false, error: null };

  try {
    // Stage all changes
    log('info', 'Staging changes...');
    execSync('git add -A', { cwd: projectPath, encoding: 'utf8' });
    results.staged = true;

    // Check if there are changes to commit
    const status = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf8' });
    if (!status.trim()) {
      log('warn', 'No changes to commit');
      return results;
    }

    // Commit
    log('info', 'Committing changes...');
    const commitMsg = `${message}\n\nCo-Authored-By: Ralph (ATLAS Worker) <ralph@atlas.local>`;
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: projectPath, encoding: 'utf8' });
    results.committed = true;
    log('success', 'Changes committed');

    // Push if configured
    if (gitConfig.autoPush) {
      log('info', `Pushing to ${gitConfig.remote}/${gitConfig.branch}...`);
      execSync(`git push ${gitConfig.remote} ${gitConfig.branch}`, { cwd: projectPath, encoding: 'utf8', timeout: 60000 });
      results.pushed = true;
      log('success', 'Changes pushed - auto-deploy triggered');
    }

    return results;
  } catch (err) {
    results.error = err.message;
    log('error', 'Git operation failed:', err.message);
    return results;
  }
}

// Execute task with Claude Code CLI
async function executeTask(task) {
  const { taskId, project, prompt } = task;
  const projectConfig = CONFIG.projects[project];

  if (!projectConfig) {
    return { success: false, error: `Unknown project: ${project}` };
  }

  const projectPath = projectConfig.path;
  const ralphDir = path.join(projectPath, projectConfig.ralphDir);

  // Verify project path exists
  if (!fs.existsSync(projectPath)) {
    return { success: false, error: `Project path not found: ${projectPath}` };
  }

  // Create ralph directory if needed
  if (!fs.existsSync(ralphDir)) {
    fs.mkdirSync(ralphDir, { recursive: true });
  }

  // Check git status before starting
  const gitStatus = checkGitStatus(projectPath);
  if (!gitStatus.clean && projectConfig.git?.autoPush) {
    log('warn', `Working directory has uncommitted changes: ${gitStatus.status}`);
  }

  // Build the prompt with project context
  const structure = projectConfig.structure || {};
  let contextPrompt = prompt;

  if (structure.warnings?.length > 0) {
    contextPrompt += `\n\nCRITICAL PATH REMINDERS:\n${structure.warnings.map(w => `- ${w}`).join('\n')}`;
  }
  if (structure.keyFiles) {
    const files = Object.entries(structure.keyFiles).map(([name, p]) => `- ${name}: ${p}`).join('\n');
    contextPrompt += `\n\nKEY FILES:\n${files}`;
  }

  log('task', `Executing: ${prompt.slice(0, 100)}...`);
  log('info', `Project: ${project} | Path: ${projectPath}`);

  // Write PRD file
  const prdPath = path.join(ralphDir, 'prd.json');
  const prd = {
    meta: { taskId, project, startedAt: new Date().toISOString() },
    projectStructure: structure,
    task: { title: prompt, description: prompt },
    completed: false
  };
  fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2));

  // Emit start event
  socket.emit('ralph:worker:start', {
    taskId,
    project,
    task: prompt,
    startTime: Date.now()
  });

  // State tracking
  const state = {
    startTime: Date.now(),
    turns: 0,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    filesRead: [],
    filesWritten: [],
    filesEdited: [],
    toolCalls: []
  };

  return new Promise((resolve) => {
    // Build Claude Code command
    // IMPORTANT: --dangerously-skip-permissions MUST come BEFORE -p
    const command = `claude --dangerously-skip-permissions -p "${contextPrompt.replace(/"/g, '\\"')}" --output-format stream-json --verbose`;

    log('info', 'Spawning Claude Code CLI...');

    const claudeProcess = spawn(command, [], {
      cwd: projectPath,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    });

    activeTask = { process: claudeProcess, taskId, project };

    let buffer = '';

    claudeProcess.stdin?.end();

    claudeProcess.stdout?.on('data', (data) => {
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);
          processEvent(taskId, project, event, state);
        } catch (e) {
          // Raw output
          log('info', `[raw] ${line.slice(0, 150)}`);
        }
      }
    });

    claudeProcess.stderr?.on('data', (data) => {
      const msg = data.toString();
      log('warn', `[stderr] ${msg.slice(0, 200)}`);
      socket.emit('ralph:worker:log', { taskId, type: 'stderr', content: msg });
    });

    claudeProcess.on('close', async (code, signal) => {
      activeTask = null;
      const duration = Math.round((Date.now() - state.startTime) / 1000);

      log('info', `Claude Code finished - Exit: ${code}, Duration: ${duration}s`);

      // Update PRD completion status
      try {
        const updatedPrd = JSON.parse(fs.readFileSync(prdPath, 'utf8'));
        updatedPrd.completed = code === 0;
        updatedPrd.result = { duration, turns: state.turns, code };
        fs.writeFileSync(prdPath, JSON.stringify(updatedPrd, null, 2));
      } catch (e) {}

      // Git commit and push if successful
      let gitResult = null;
      if (code === 0 && projectConfig.git) {
        const commitMessage = `Ralph: ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}`;
        gitResult = await gitCommitAndPush(projectPath, commitMessage, projectConfig.git);
      }

      // Run post-deploy command if configured
      if (code === 0 && projectConfig.postDeploy) {
        log('info', `Running post-deploy: ${projectConfig.postDeploy}`);
        try {
          execSync(projectConfig.postDeploy, { encoding: 'utf8', timeout: 30000 });
          log('success', 'Post-deploy completed');
        } catch (e) {
          log('error', `Post-deploy failed: ${e.message}`);
        }
      }

      // Emit completion
      socket.emit('ralph:worker:complete', {
        taskId,
        project,
        success: code === 0,
        duration,
        turns: state.turns,
        cost: state.cost,
        filesRead: state.filesRead,
        filesWritten: state.filesWritten,
        filesEdited: state.filesEdited,
        git: gitResult
      });

      resolve({
        success: code === 0,
        duration,
        turns: state.turns,
        cost: state.cost,
        git: gitResult
      });
    });

    claudeProcess.on('error', (err) => {
      activeTask = null;
      log('error', `Spawn error: ${err.message}`);

      socket.emit('ralph:worker:error', {
        taskId,
        project,
        error: `Failed to spawn Claude Code: ${err.message}`
      });

      resolve({ success: false, error: err.message });
    });

    // Timeout after 30 minutes
    setTimeout(() => {
      if (activeTask?.taskId === taskId) {
        log('warn', 'Task timeout - killing process');
        claudeProcess.kill('SIGTERM');
      }
    }, 30 * 60 * 1000);
  });
}

// Process streaming JSON events
function processEvent(taskId, project, event, state) {
  const elapsed = Math.round((Date.now() - state.startTime) / 1000);

  switch (event.type) {
    case 'system':
      log('info', `Session: ${event.session_id}, Model: ${event.model}`);
      socket.emit('ralph:worker:init', {
        taskId,
        project,
        sessionId: event.session_id,
        model: event.model,
        tools: event.tools
      });
      break;

    case 'assistant':
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const input = block.input || {};
            const filePath = input.file_path || input.path || input.pattern || null;

            state.toolCalls.push({ tool: toolName, file: filePath, time: elapsed });

            // Track files
            if (filePath) {
              if (toolName === 'Read' && !state.filesRead.includes(filePath)) {
                state.filesRead.push(filePath);
              } else if (toolName === 'Write' && !state.filesWritten.includes(filePath)) {
                state.filesWritten.push(filePath);
              } else if (toolName === 'Edit' && !state.filesEdited.includes(filePath)) {
                state.filesEdited.push(filePath);
              }
            }

            const shortPath = filePath ? filePath.split(/[/\\]/).slice(-2).join('/') : '';
            log('task', `${toolName}${shortPath ? `: ${shortPath}` : ''}`);

            socket.emit('ralph:worker:tool', {
              taskId,
              project,
              tool: toolName,
              file: filePath,
              elapsed
            });
          } else if (block.type === 'text' && block.text) {
            // Only emit substantial thoughts
            if (block.text.length > 30) {
              socket.emit('ralph:worker:thought', {
                taskId,
                project,
                content: block.text.slice(0, 500),
                elapsed
              });
            }
          }
        }
      }

      // Track usage
      if (event.message?.usage) {
        state.tokensIn += event.message.usage.input_tokens || 0;
        state.tokensOut += event.message.usage.output_tokens || 0;
      }
      break;

    case 'user':
      state.turns++;
      socket.emit('ralph:worker:progress', {
        taskId,
        project,
        turns: state.turns,
        tokensIn: state.tokensIn,
        tokensOut: state.tokensOut,
        elapsed
      });
      break;

    case 'result':
      if (event.result) {
        state.cost = event.result.cost_usd || 0;
        log('info', `Cost: $${state.cost.toFixed(4)}`);
      }
      break;
  }
}

// Connect to ATLAS server
function connect() {
  console.log('');
  log('info', `Connecting to ATLAS server...`);
  log('info', `URL: ${CONFIG.atlasUrl}`);

  socket = io(CONFIG.atlasUrl, {
    auth: {
      token: CONFIG.authToken,
      workerType: 'ralph',
      workerName: CONFIG.workerName
    },
    reconnection: true,
    reconnectionAttempts: Infinity, // Never stop trying
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    timeout: 20000
  });

  socket.on('connect', () => {
    console.log('');
    console.log('\x1b[32m╔══════════════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[32m║              ✓ CONNECTED TO ATLAS SERVER                 ║\x1b[0m');
    console.log('\x1b[32m╚══════════════════════════════════════════════════════════╝\x1b[0m');
    console.log('');
    log('success', `Socket ID: ${socket.id}`);
    log('info', `Worker: ${CONFIG.workerName}`);
    reconnectAttempts = 0;

    // Register as Ralph worker
    socket.emit('ralph:worker:register', {
      projects: Object.keys(CONFIG.projects),
      capabilities: ['execute', 'git-push'],
      hostname: CONFIG.workerName
    });

    log('info', 'Waiting for tasks from ATLAS...');
    console.log('');
  });

  socket.on('disconnect', (reason) => {
    console.log('');
    log('warn', `Disconnected from ATLAS: ${reason}`);
    if (reason === 'io server disconnect') {
      log('info', 'Server disconnected us, attempting to reconnect...');
      socket.connect();
    } else {
      log('info', 'Will automatically reconnect...');
    }
  });

  socket.on('connect_error', (err) => {
    reconnectAttempts++;
    if (reconnectAttempts === 1 || reconnectAttempts % 10 === 0) {
      log('error', `Connection failed (attempt ${reconnectAttempts}): ${err.message}`);
      log('info', 'Is ATLAS server running? Check: http://100.117.103.53:3002');
      log('info', 'Retrying every few seconds...');
    }
  });

  socket.on('reconnect', (attemptNumber) => {
    log('success', `Reconnected after ${attemptNumber} attempts`);
  });

  // Listen for tasks from ATLAS
  socket.on('ralph:task', async (task) => {
    log('task', `Received task: ${task.taskId} for ${task.project}`);

    if (activeTask) {
      log('warn', 'Already executing a task, rejecting new task');
      socket.emit('ralph:worker:busy', { taskId: task.taskId });
      return;
    }

    const result = await executeTask(task);
    log(result.success ? 'success' : 'error', `Task ${task.taskId} ${result.success ? 'completed' : 'failed'}`);
  });

  // Listen for cancel requests
  socket.on('ralph:cancel', (data) => {
    if (activeTask && activeTask.taskId === data.taskId) {
      log('warn', `Cancelling task ${data.taskId}`);
      activeTask.process.kill('SIGTERM');
    }
  });

  // Ping/pong for keepalive
  socket.on('ping', () => {
    socket.emit('pong', { activeTask: activeTask?.taskId || null });
  });

  // ==================== TERMINAL PTY HANDLERS ====================
  // Track active terminal sessions
  const terminalSessions = new Map();

  // Create new terminal session
  socket.on('terminal:create', (data) => {
    const { sessionId, cwd, title, preset, autoCommand } = data;
    log('info', `[Terminal] Creating session: ${sessionId}${title ? ` (${title})` : ''}${autoCommand ? ` [auto: ${autoCommand}]` : ''}`);

    try {
      // Try to load node-pty
      let pty;
      try {
        pty = require('node-pty');
      } catch (e) {
        log('error', '[Terminal] node-pty not installed. Run: npm install node-pty');
        socket.emit('terminal:error', { sessionId, error: 'node-pty not installed on worker' });
        return;
      }

      // Determine working directory
      const defaultCwd = process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\huddl';
      let workingDir = cwd || defaultCwd;

      // Normalize path for Windows (replace forward slashes)
      if (process.platform === 'win32') {
        workingDir = workingDir.replace(/\//g, '\\');
      }

      // Verify directory exists
      const fs = require('fs');
      if (!fs.existsSync(workingDir)) {
        log('warn', `[Terminal] Directory not found: ${workingDir}, using default`);
        workingDir = defaultCwd;
      }

      log('info', `[Terminal] Starting in: ${workingDir}`);

      // Spawn PowerShell
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: workingDir,
        env: process.env
      });

      terminalSessions.set(sessionId, ptyProcess);

      // Handle output from PTY
      ptyProcess.onData((data) => {
        socket.emit('terminal:output', { sessionId, data });
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode }) => {
        log('info', `[Terminal] Session ${sessionId} exited with code ${exitCode}`);
        terminalSessions.delete(sessionId);
        socket.emit('terminal:closed', { sessionId, exitCode });
      });

      // Notify success with title, preset, and autoCommand info
      socket.emit('terminal:created', { sessionId, title, preset, autoCommand });
      log('success', `[Terminal] Session ${sessionId} created in ${workingDir}`);

    } catch (err) {
      log('error', `[Terminal] Failed to create session: ${err.message}`);
      socket.emit('terminal:error', { sessionId, error: err.message });
    }
  });

  // Handle input from browser
  socket.on('terminal:input', (data) => {
    const { sessionId, data: inputData } = data;
    const ptyProcess = terminalSessions.get(sessionId);
    if (ptyProcess) {
      ptyProcess.write(inputData);
    }
  });

  // Handle resize from browser
  socket.on('terminal:resize', (data) => {
    const { sessionId, cols, rows } = data;
    const ptyProcess = terminalSessions.get(sessionId);
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (e) {
        // Ignore resize errors
      }
    }
  });

  // Handle close request
  socket.on('terminal:close', (data) => {
    const { sessionId } = data;
    const ptyProcess = terminalSessions.get(sessionId);
    if (ptyProcess) {
      log('info', `[Terminal] Closing session: ${sessionId}`);
      ptyProcess.kill();
      terminalSessions.delete(sessionId);
    }
  });

  // Clean up all terminals on disconnect
  socket.on('disconnect', () => {
    for (const [sessionId, ptyProcess] of terminalSessions) {
      log('info', `[Terminal] Cleaning up session: ${sessionId}`);
      try {
        ptyProcess.kill();
      } catch (e) {}
    }
    terminalSessions.clear();
  });

  // ==================== END TERMINAL HANDLERS ====================
}

// Startup
function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           RALPH WORKER - Local Code Executor             ║');
  console.log('║          Connects to ATLAS for task dispatch             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Check Claude CLI
  if (!checkClaudeCLI()) {
    process.exit(1);
  }

  // Verify project paths
  log('info', 'Verifying project paths...');
  for (const [name, config] of Object.entries(CONFIG.projects)) {
    if (fs.existsSync(config.path)) {
      const gitStatus = checkGitStatus(config.path);
      log('success', `${name}: ${config.path} (${gitStatus.branch})`);
    } else {
      log('error', `${name}: ${config.path} NOT FOUND`);
    }
  }

  console.log('');

  // Connect to ATLAS
  connect();

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('info', 'Shutting down...');
    if (activeTask) {
      activeTask.process.kill('SIGTERM');
    }
    socket?.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('info', 'Received SIGTERM');
    if (activeTask) {
      activeTask.process.kill('SIGTERM');
    }
    socket?.disconnect();
    process.exit(0);
  });
}

main();
