import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import {
  Plus, X, Terminal as TerminalIcon, AlertCircle,
  Maximize2, Minimize2, Wifi, WifiOff, ChevronDown,
  FolderOpen, Play, GitBranch, Activity, ArrowRight, Sparkles, RotateCcw,
  ExternalLink, Monitor, HelpCircle
} from 'lucide-react';

// Workstation Tailscale IP for dev server access
const WORKSTATION_IP = '100.91.205.101';

// Quick links to dev servers
const DEV_SERVER_LINKS = [
  { label: 'Vite Dev', port: 5173 },
  { label: 'Port 3000', port: 3000 },
  { label: 'Port 3001', port: 3001 },
  { label: 'Port 8080', port: 8080 },
];

// Project presets for quick terminal spawning
const TERMINAL_PRESETS = [
  // SlabTrack
  {
    id: 'slabtrack',
    label: 'SlabTrack Terminal',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/GitHub/slabtrack',
    color: 'text-blue-400'
  },
  {
    id: 'slabtrack-claude',
    label: 'SlabTrack + Claude Code',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/GitHub/slabtrack',
    color: 'text-blue-400',
    autoCommand: 'claude'
  },
  {
    id: 'slabtrack-resume',
    label: 'SlabTrack + Resume',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/GitHub/slabtrack',
    color: 'text-blue-400',
    autoCommand: 'claude --resume'
  },
  // Blink
  {
    id: 'blink',
    label: 'Blink Terminal',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/module-library',
    color: 'text-purple-400'
  },
  {
    id: 'blink-claude',
    label: 'Blink + Claude Code',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/module-library',
    color: 'text-purple-400',
    autoCommand: 'claude'
  },
  {
    id: 'blink-resume',
    label: 'Blink + Resume',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/module-library',
    color: 'text-purple-400',
    autoCommand: 'claude --resume'
  },
  {
    id: 'blink-frontend',
    label: 'Blink Frontend',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/module-library/module-assembler-ui',
    color: 'text-purple-400',
    autoCommand: 'npm run dev -- --host'
  },
  {
    id: 'blink-backend',
    label: 'Blink Backend',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/module-library/module-assembler-ui',
    color: 'text-purple-400',
    autoCommand: 'npm start'
  },
  {
    id: 'blink-worker',
    label: 'Blink Worker',
    cwd: 'C:/Users/huddl/OneDrive/Desktop/module-library/module-assembler-ui',
    color: 'text-purple-400',
    autoCommand: 'npm run worker'
  },
  // ATLAS
  {
    id: 'atlas',
    label: 'ATLAS Terminal',
    cwd: 'C:/Users/huddl/command-center',
    color: 'text-green-400'
  },
  {
    id: 'atlas-claude',
    label: 'ATLAS + Claude Code',
    cwd: 'C:/Users/huddl/command-center',
    color: 'text-green-400',
    autoCommand: 'claude'
  },
  {
    id: 'atlas-resume',
    label: 'ATLAS + Resume',
    cwd: 'C:/Users/huddl/command-center',
    color: 'text-green-400',
    autoCommand: 'claude --resume'
  },
  {
    id: 'atlas-frontend',
    label: 'ATLAS Frontend',
    cwd: 'C:/Users/huddl/command-center',
    color: 'text-green-400',
    autoCommand: 'npm run dev -- --host'
  },
  {
    id: 'atlas-backend',
    label: 'ATLAS Backend',
    cwd: 'C:/Users/huddl/command-center',
    color: 'text-green-400',
    autoCommand: 'node server.js'
  },
  // General
  {
    id: 'general',
    label: 'General Terminal',
    cwd: null, // Use default home directory
    color: 'text-gray-400'
  }
];

// Quick command buttons
const QUICK_COMMANDS = [
  {
    label: 'SlabTrack',
    command: 'cd C:\\Users\\huddl\\OneDrive\\Desktop\\GitHub\\slabtrack',
    icon: ArrowRight,
    color: 'bg-blue-600 hover:bg-blue-700'
  },
  {
    label: 'Blink',
    command: 'cd C:\\Users\\huddl\\OneDrive\\Desktop\\module-library',
    icon: ArrowRight,
    color: 'bg-purple-600 hover:bg-purple-700'
  },
  {
    label: 'ATLAS',
    command: 'cd C:\\Users\\huddl\\command-center',
    icon: ArrowRight,
    color: 'bg-green-600 hover:bg-green-700'
  },
  {
    label: 'Claude Code',
    command: 'claude',
    icon: Sparkles,
    color: 'bg-amber-600 hover:bg-amber-700'
  },
  {
    label: 'Resume Claude',
    command: 'claude --resume',
    icon: RotateCcw,
    color: 'bg-amber-600 hover:bg-amber-700'
  },
  {
    label: 'Start Dev',
    command: 'npm run dev',
    icon: Play,
    color: 'bg-orange-600 hover:bg-orange-700'
  },
  {
    label: 'Git Status',
    command: 'git status',
    icon: GitBranch,
    color: 'bg-cyan-600 hover:bg-cyan-700'
  },
  {
    label: 'PM2 Status',
    command: 'pm2 status',
    icon: Activity,
    color: 'bg-pink-600 hover:bg-pink-700'
  }
];

function TerminalPage({ socket }) {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [workerConnected, setWorkerConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const terminalRefs = useRef({});
  const fitAddons = useRef({});
  const pendingAutoCommands = useRef({}); // Track auto commands to run after terminal ready
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowPresetDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check worker connection status
  useEffect(() => {
    if (!socket) return;

    socket.emit('terminal:check-worker');

    socket.on('terminal:worker-status', (data) => {
      setWorkerConnected(data.connected);
    });

    socket.on('terminal:session-created', (data) => {
      console.log('[Terminal] Session created:', data.sessionId, data.title, 'autoCommand:', data.autoCommand);
      setSessions(prev => [...prev, {
        id: data.sessionId,
        title: data.title || `Terminal ${prev.length + 1}`,
        preset: data.preset || null,
        autoCommand: data.autoCommand || null,
        created: Date.now()
      }]);
      // Store pending auto command if present
      if (data.autoCommand) {
        console.log('[Terminal] Storing pending autoCommand:', data.autoCommand);
        pendingAutoCommands.current[data.sessionId] = data.autoCommand;
      }
      setActiveSession(data.sessionId);
    });

    socket.on('terminal:output', (data) => {
      const term = terminalRefs.current[data.sessionId];
      if (term) {
        term.write(data.data);
      }
    });

    socket.on('terminal:session-closed', (data) => {
      console.log('[Terminal] Session closed:', data.sessionId);
      setSessions(prev => {
        const remaining = prev.filter(s => s.id !== data.sessionId);
        // If we closed the active session, switch to another
        if (activeSession === data.sessionId && remaining.length > 0) {
          setActiveSession(remaining[remaining.length - 1].id);
        } else if (remaining.length === 0) {
          setActiveSession(null);
        }
        return remaining;
      });
      // Clean up terminal instance
      if (terminalRefs.current[data.sessionId]) {
        terminalRefs.current[data.sessionId].dispose();
        delete terminalRefs.current[data.sessionId];
        delete fitAddons.current[data.sessionId];
      }
    });

    socket.on('terminal:error', (data) => {
      console.error('[Terminal] Error:', data.error);
      const term = terminalRefs.current[data.sessionId];
      if (term) {
        term.write(`\r\n\x1b[31mError: ${data.error}\x1b[0m\r\n`);
      }
    });

    // Periodic worker status check
    const interval = setInterval(() => {
      socket.emit('terminal:check-worker');
    }, 5000);

    return () => {
      socket.off('terminal:worker-status');
      socket.off('terminal:session-created');
      socket.off('terminal:output');
      socket.off('terminal:session-closed');
      socket.off('terminal:error');
      clearInterval(interval);
    };
  }, [socket, activeSession]);

  // Initialize terminal when session becomes active
  useEffect(() => {
    if (!activeSession || terminalRefs.current[activeSession]) return;

    const termContainer = document.getElementById(`terminal-${activeSession}`);
    if (!termContainer) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        cursorAccent: '#1a1b26',
        selection: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5'
      },
      allowTransparency: true,
      scrollback: 10000
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(termContainer);
    fitAddon.fit();

    terminalRefs.current[activeSession] = term;
    fitAddons.current[activeSession] = fitAddon;

    // Handle input - send each character/key to the PTY
    // Pasted text comes through here too, but PowerShell handles it correctly
    term.onData((data) => {
      socket.emit('terminal:input', {
        sessionId: activeSession,
        data
      });
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
      socket.emit('terminal:resize', {
        sessionId: activeSession,
        cols,
        rows
      });
    });

    // Initial resize
    setTimeout(() => fitAddon.fit(), 100);

    // Welcome message
    const session = sessions.find(s => s.id === activeSession);
    if (session?.preset) {
      term.write(`\x1b[36m[ATLAS Terminal] ${session.title}\x1b[0m\r\n`);
    } else {
      term.write('\x1b[36m[ATLAS Terminal] Connected to workstation\x1b[0m\r\n');
    }
    term.write('\x1b[90mDirect shell access - no API costs\x1b[0m\r\n\r\n');

    // Check for pending auto command and run it after shell is ready
    // Read from session object instead of ref to avoid timing issues
    const currentSession = sessions.find(s => s.id === activeSession);
    const autoCommand = currentSession?.autoCommand;
    console.log('[Terminal] Checking autoCommand for session:', activeSession, 'found:', autoCommand);
    if (autoCommand && !pendingAutoCommands.current[activeSession + '_sent']) {
      console.log('[Terminal] Will execute autoCommand in 2s:', autoCommand);
      pendingAutoCommands.current[activeSession + '_sent'] = true; // Mark as sent
      // Wait for shell prompt to be ready, then send command
      setTimeout(() => {
        console.log('[Terminal] Executing autoCommand now:', autoCommand);
        socket.emit('terminal:input', {
          sessionId: activeSession,
          data: autoCommand + '\r'
        });
      }, 2000); // Give PowerShell time to initialize
    }

  }, [activeSession, socket, sessions]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      Object.values(fitAddons.current).forEach(addon => {
        try {
          addon.fit();
        } catch (e) {}
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Refit terminal when active session changes or fullscreen toggles
  useEffect(() => {
    if (activeSession && fitAddons.current[activeSession]) {
      setTimeout(() => {
        try {
          fitAddons.current[activeSession].fit();
        } catch (e) {}
      }, 100);
    }
  }, [activeSession, isFullscreen]);

  const createSession = useCallback((preset = null) => {
    console.log('[Terminal] createSession called, workerConnected:', workerConnected, 'preset:', preset?.label);
    if (!workerConnected) {
      console.log('[Terminal] Worker not connected, aborting');
      return;
    }
    if (!socket) {
      console.log('[Terminal] Socket not available, aborting');
      return;
    }

    const options = {
      preset: preset?.id || null,
      cwd: preset?.cwd || null,
      title: preset?.label || null,
      autoCommand: preset?.autoCommand || null
    };

    console.log('[Terminal] Emitting terminal:create-session', options);
    socket.emit('terminal:create-session', options);
    setShowPresetDropdown(false);

    // Auto-fullscreen when opening preset terminals (not general)
    if (preset && preset.id !== 'general') {
      setIsFullscreen(true);
    }
  }, [socket, workerConnected]);

  const closeSession = useCallback((sessionId) => {
    socket.emit('terminal:close-session', { sessionId });
  }, [socket]);

  // Send a quick command to the active terminal
  const sendCommand = useCallback((command) => {
    if (!activeSession || !socket) {
      console.log('[Terminal] Cannot send command - no active session or socket');
      return;
    }
    console.log('[Terminal] Sending command:', command, 'to session:', activeSession);
    socket.emit('terminal:input', {
      sessionId: activeSession,
      data: command + '\r'
    });
  }, [activeSession, socket]);

  // No socket connection
  if (!socket) {
    return (
      <div className="flex-1 flex items-center justify-center bg-dark-900">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Not Connected</h2>
          <p className="text-gray-400">Socket connection required</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col bg-dark-900 ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <div className="bg-dark-800 border-b border-dark-700 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <TerminalIcon className="w-6 h-6 text-green-400" />
          <h1 className="text-xl font-bold text-white">Terminal</h1>
          <span className="text-sm text-gray-500">Direct workstation access</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Worker status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
            workerConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {workerConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span className="text-sm">{workerConnected ? 'Worker Online' : 'Worker Offline'}</span>
          </div>

          {/* Help button */}
          <button
            onClick={() => setShowHelp(true)}
            className="p-2 hover:bg-dark-700 rounded-lg text-gray-400 hover:text-white transition-colors"
            title="How to use Terminal"
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 hover:bg-dark-700 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>

          {/* New terminal dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowPresetDropdown(!showPresetDropdown)}
              disabled={!workerConnected}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                workerConnected
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-dark-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Plus className="w-4 h-4" />
              New Terminal
              <ChevronDown className="w-4 h-4" />
            </button>

            {showPresetDropdown && workerConnected && (
              <div className="absolute right-0 mt-2 w-56 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 overflow-hidden">
                {TERMINAL_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => createSession(preset)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dark-600 text-left transition-colors"
                  >
                    <FolderOpen className={`w-4 h-4 ${preset.color}`} />
                    <span className="text-white">{preset.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Terminal tabs */}
      {sessions.length > 0 && (
        <div className="bg-dark-800/50 border-b border-dark-700 px-2 py-1 flex items-center gap-1 overflow-x-auto shrink-0">
          {sessions.map((session) => {
            const preset = TERMINAL_PRESETS.find(p => p.id === session.preset);
            return (
              <div
                key={session.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors group ${
                  activeSession === session.id
                    ? 'bg-dark-600 text-white'
                    : 'text-gray-400 hover:bg-dark-700 hover:text-white'
                }`}
                onClick={() => setActiveSession(session.id)}
              >
                <TerminalIcon className={`w-4 h-4 ${preset?.color || ''}`} />
                <span className="text-sm whitespace-nowrap">{session.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(session.id);
                  }}
                  className="p-0.5 hover:bg-red-500/30 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick commands bar - only show when terminals exist */}
      {sessions.length > 0 && activeSession && (
        <div className="bg-dark-800/30 border-b border-dark-700 px-4 py-2 flex items-center gap-2 overflow-x-auto shrink-0">
          <span className="text-xs text-gray-500 mr-2">Quick:</span>
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd.label}
              onClick={() => sendCommand(cmd.command)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors ${cmd.color}`}
            >
              <cmd.icon className="w-3.5 h-3.5" />
              {cmd.label}
            </button>
          ))}

          {/* Separator */}
          <div className="w-px h-6 bg-dark-600 mx-2" />

          {/* Dev server links */}
          <span className="text-xs text-gray-500 mr-2">
            <Monitor className="w-3.5 h-3.5 inline mr-1" />
            Dev:
          </span>
          {DEV_SERVER_LINKS.map((link) => (
            <a
              key={link.port}
              href={`http://${WORKSTATION_IP}:${link.port}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-dark-600 hover:bg-dark-500 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {link.label}
            </a>
          ))}
        </div>
      )}

      {/* Terminal content */}
      <div className="flex-1 relative min-h-0">
        {sessions.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <TerminalIcon className="w-20 h-20 text-dark-600 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">No Active Terminals</h2>
              <p className="text-gray-400 mb-6">
                {workerConnected
                  ? 'Select a terminal preset to get started'
                  : 'Waiting for ralph-worker to connect...'}
              </p>

              {workerConnected && (
                <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
                  {TERMINAL_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => createSession(preset)}
                      className="flex items-center gap-3 px-4 py-3 bg-dark-700 hover:bg-dark-600 rounded-xl transition-colors text-left"
                    >
                      <FolderOpen className={`w-5 h-5 ${preset.color}`} />
                      <span className="text-white font-medium">{preset.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {!workerConnected && (
                <div className="text-sm text-gray-500 mt-4">
                  <p>Start ralph-worker on your workstation:</p>
                  <code className="bg-dark-700 px-3 py-1 rounded mt-2 inline-block">
                    node ralph-worker.js
                  </code>
                </div>
              )}
            </div>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              id={`terminal-${session.id}`}
              className={`absolute inset-0 p-2 ${
                activeSession === session.id ? 'block' : 'hidden'
              }`}
              style={{ backgroundColor: '#1a1b26' }}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="bg-dark-800 border-t border-dark-700 px-4 py-2 flex items-center justify-between text-sm text-gray-500 shrink-0">
        <div>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} active
        </div>
        <div className="flex items-center gap-4">
          <span>Ctrl+Shift+V paste | Ctrl+C cancel</span>
          <span>Direct shell - no API costs</span>
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-dark-600">
            <div className="sticky top-0 bg-dark-800 border-b border-dark-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-6 h-6 text-green-400" />
                Terminal Help
              </h2>
              <button
                onClick={() => setShowHelp(false)}
                className="p-2 hover:bg-dark-700 rounded-lg text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Remote Access */}
              <div>
                <h3 className="text-lg font-semibold text-green-400 mb-2">Remote Development</h3>
                <p className="text-gray-300 mb-3">
                  Access your home workstation from anywhere via Tailscale. Run dev servers,
                  use Claude Code, and test your apps remotely.
                </p>
                <div className="bg-dark-900 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Workstation IP:</span>
                    <code className="text-green-400">{WORKSTATION_IP}</code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">ATLAS Server:</span>
                    <code className="text-blue-400">100.117.103.53</code>
                  </div>
                </div>
              </div>

              {/* Presets */}
              <div>
                <h3 className="text-lg font-semibold text-purple-400 mb-2">Terminal Presets</h3>
                <div className="space-y-2 text-sm">
                  <div className="bg-dark-900 rounded-lg p-3">
                    <div className="text-white font-medium">Project Terminal</div>
                    <div className="text-gray-400">Opens terminal in project folder</div>
                  </div>
                  <div className="bg-dark-900 rounded-lg p-3">
                    <div className="text-white font-medium">+ Claude Code</div>
                    <div className="text-gray-400">Opens terminal and starts Claude Code CLI</div>
                  </div>
                  <div className="bg-dark-900 rounded-lg p-3">
                    <div className="text-white font-medium">+ Resume</div>
                    <div className="text-gray-400">Opens terminal and resumes last Claude session</div>
                  </div>
                  <div className="bg-dark-900 rounded-lg p-3">
                    <div className="text-white font-medium">Frontend / Backend</div>
                    <div className="text-gray-400">Starts dev server automatically</div>
                  </div>
                </div>
              </div>

              {/* Testing Remotely */}
              <div>
                <h3 className="text-lg font-semibold text-blue-400 mb-2">Test Apps Remotely</h3>
                <ol className="list-decimal list-inside space-y-2 text-gray-300">
                  <li>Click <span className="text-purple-400">"Blink Frontend"</span> preset</li>
                  <li>Wait for dev server to start (shows URL in terminal)</li>
                  <li>Click <span className="text-green-400">"Vite Dev"</span> button in toolbar</li>
                  <li>App opens in new tab at <code className="text-green-400">http://{WORKSTATION_IP}:5173</code></li>
                </ol>
              </div>

              {/* Quick Commands */}
              <div>
                <h3 className="text-lg font-semibold text-orange-400 mb-2">Quick Commands</h3>
                <p className="text-gray-300 mb-2">
                  Toolbar buttons send commands to the active terminal:
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-dark-900 rounded p-2">
                    <span className="text-blue-400">→ SlabTrack/Blink/ATLAS</span>
                    <span className="text-gray-500 ml-2">cd to project</span>
                  </div>
                  <div className="bg-dark-900 rounded p-2">
                    <span className="text-amber-400">Claude Code</span>
                    <span className="text-gray-500 ml-2">start claude</span>
                  </div>
                  <div className="bg-dark-900 rounded p-2">
                    <span className="text-orange-400">Start Dev</span>
                    <span className="text-gray-500 ml-2">npm run dev</span>
                  </div>
                  <div className="bg-dark-900 rounded p-2">
                    <span className="text-cyan-400">Git Status</span>
                    <span className="text-gray-500 ml-2">git status</span>
                  </div>
                </div>
              </div>

              {/* Tips */}
              <div>
                <h3 className="text-lg font-semibold text-yellow-400 mb-2">Tips</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-300">
                  <li>Use <code className="text-gray-400">Ctrl+Shift+V</code> to paste</li>
                  <li>Use <code className="text-gray-400">Ctrl+C</code> to cancel running commands</li>
                  <li>Multiple terminals can run simultaneously (tabs)</li>
                  <li>After ATLAS deploys, hard refresh (Ctrl+Shift+R) to reconnect</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TerminalPage;
