import React, { useState, useEffect, useRef } from 'react';
import {
  X, Minimize2, Maximize2, Play, Square, FileText, Edit3,
  FilePlus, Search, Terminal, Clock, DollarSign, Zap,
  CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp,
  FolderOpen, Activity, Cpu
} from 'lucide-react';

function RalphVisualizer({ socket, isOpen, onClose, onMinimize }) {
  const [taskState, setTaskState] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showFullLog, setShowFullLog] = useState(false);
  const activityRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    // Task dispatched to worker (waiting for worker to start)
    socket.on('ralph:dispatched', (data) => {
      setTaskState({
        taskId: data.taskId,
        project: data.project,
        task: data.task,
        startTime: Date.now(),
        status: 'dispatched',
        workerHostname: data.workerHostname,
        sessionId: null,
        model: null,
        turns: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        filesRead: [],
        filesWritten: [],
        filesEdited: [],
        toolCalls: [],
        thoughts: [],
        git: null
      });
      setActivityLog([{
        type: 'dispatch',
        time: 0,
        content: `Task dispatched to worker: ${data.workerHostname}`
      }]);
    });

    // No worker available
    socket.on('ralph:no_worker', (data) => {
      setTaskState({
        taskId: data.taskId,
        project: data.project,
        task: data.task,
        startTime: Date.now(),
        status: 'failed',
        error: 'No worker connected. Run ralph-worker.js on your local machine.'
      });
      setActivityLog([{
        type: 'error',
        time: 0,
        content: 'No Ralph worker connected. Start ralph-worker.js locally.'
      }]);
    });

    // Task started (worker began execution)
    socket.on('ralph:start', (data) => {
      setTaskState(prev => ({
        ...(prev || {}),
        taskId: data.taskId,
        project: data.project,
        task: data.task || prev?.task,
        startTime: data.startTime,
        status: 'running',
        workerHostname: prev?.workerHostname || data.workerHostname,
        sessionId: null,
        model: null,
        turns: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        filesRead: [],
        filesWritten: [],
        filesEdited: [],
        toolCalls: [],
        thoughts: [],
        git: null
      }));
      setActivityLog(prev => [...prev, {
        type: 'start',
        time: 0,
        content: `Worker started execution`
      }]);
    });

    // Initialization
    socket.on('ralph:init', (data) => {
      setTaskState(prev => prev ? {
        ...prev,
        sessionId: data.sessionId,
        model: data.model
      } : null);
      addActivity('init', `Session initialized (${data.model})`);
    });

    // Tool usage
    socket.on('ralph:tool', (data) => {
      setTaskState(prev => {
        if (!prev) return null;
        const newToolCalls = [...prev.toolCalls, { tool: data.tool, file: data.file, time: data.elapsed }];

        // Track files
        let filesRead = [...prev.filesRead];
        let filesWritten = [...prev.filesWritten];
        let filesEdited = [...prev.filesEdited];

        if (data.file) {
          if (data.tool === 'Read' && !filesRead.includes(data.file)) {
            filesRead.push(data.file);
          } else if (data.tool === 'Write' && !filesWritten.includes(data.file)) {
            filesWritten.push(data.file);
          } else if (data.tool === 'Edit' && !filesEdited.includes(data.file)) {
            filesEdited.push(data.file);
          }
        }

        return { ...prev, toolCalls: newToolCalls, filesRead, filesWritten, filesEdited };
      });

      const icon = getToolIcon(data.tool);
      const fileName = data.file ? data.file.split(/[/\\]/).pop() : null;
      addActivity('tool', `${icon} ${data.tool}${fileName ? `: ${fileName}` : ''}`, data.elapsed);
    });

    // Progress update
    socket.on('ralph:progress', (data) => {
      setTaskState(prev => prev ? {
        ...prev,
        turns: data.turns,
        tokensIn: data.tokensIn,
        tokensOut: data.tokensOut
      } : null);
    });

    // Claude's thoughts/responses
    socket.on('ralph:thought', (data) => {
      setTaskState(prev => {
        if (!prev) return null;
        const newThoughts = [...prev.thoughts, { content: data.content, time: data.elapsed }];
        return { ...prev, thoughts: newThoughts };
      });
      // Only add to activity if it's meaningful
      if (data.content.length > 20) {
        addActivity('thought', data.content.slice(0, 100) + (data.content.length > 100 ? '...' : ''), data.elapsed);
      }
    });

    // File touched
    socket.on('ralph:file', (data) => {
      addActivity('file', `${data.action}: ${data.path.split(/[/\\]/).pop()} (${data.lines} lines)`, data.elapsed);
    });

    // Task complete
    socket.on('ralph:complete', (data) => {
      setTaskState(prev => prev ? {
        ...prev,
        status: data.success ? 'completed' : 'failed',
        duration: data.duration,
        turns: data.turns,
        cost: data.cost,
        filesRead: data.filesRead || prev.filesRead,
        filesWritten: data.filesWritten || prev.filesWritten,
        filesEdited: data.filesEdited || prev.filesEdited,
        git: data.git || null
      } : null);

      // Build completion message with git status
      let completeMsg = data.success ? `Completed in ${data.duration}s` : 'Task failed';
      if (data.git?.pushed) {
        completeMsg += ' | Changes pushed to git (auto-deploy triggered)';
      } else if (data.git?.committed) {
        completeMsg += ' | Changes committed (not pushed)';
      }

      addActivity(data.success ? 'complete' : 'error', completeMsg, data.duration);

      // Add git activity if relevant
      if (data.git?.pushed) {
        addActivity('git', '🚀 Changes pushed to origin/main - Auto-deploy triggered!', data.duration);
      }
    });

    // Error
    socket.on('ralph:error', (data) => {
      setTaskState(prev => prev ? { ...prev, status: 'failed' } : null);
      addActivity('error', data.error);
    });

    // Log messages
    socket.on('ralph:log', (data) => {
      addActivity('log', data.content, null, data.type);
    });

    return () => {
      socket.off('ralph:dispatched');
      socket.off('ralph:no_worker');
      socket.off('ralph:start');
      socket.off('ralph:init');
      socket.off('ralph:tool');
      socket.off('ralph:progress');
      socket.off('ralph:thought');
      socket.off('ralph:file');
      socket.off('ralph:complete');
      socket.off('ralph:error');
      socket.off('ralph:log');
    };
  }, [socket]);

  // Auto-scroll activity log
  useEffect(() => {
    if (activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight;
    }
  }, [activityLog]);

  const addActivity = (type, content, elapsed = null, subtype = null) => {
    setActivityLog(prev => [...prev, { type, content, time: elapsed, subtype, timestamp: Date.now() }].slice(-100));
  };

  const getToolIcon = (tool) => {
    switch (tool) {
      case 'Read': return '📖';
      case 'Write': return '📝';
      case 'Edit': return '✏️';
      case 'Grep': return '🔍';
      case 'Glob': return '📁';
      case 'Bash': return '💻';
      case 'WebFetch': return '🌐';
      case 'WebSearch': return '🔎';
      default: return '🔧';
    }
  };

  const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getElapsed = () => {
    if (!taskState?.startTime) return 0;
    return Math.round((Date.now() - taskState.startTime) / 1000);
  };

  // Update elapsed time every second
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (taskState?.status === 'running') {
      const interval = setInterval(() => {
        setElapsed(getElapsed());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [taskState?.status, taskState?.startTime]);

  // Don't render if no task or closed
  if (!isOpen || !taskState) return null;

  const handleMinimize = () => {
    setIsMinimized(!isMinimized);
    if (onMinimize) onMinimize(!isMinimized);
  };

  const handleClose = () => {
    if (taskState.status === 'running') {
      if (!confirm('Ralph is still working. Close anyway?')) return;
    }
    setTaskState(null);
    setActivityLog([]);
    if (onClose) onClose();
  };

  const statusColors = {
    running: 'text-blue-400',
    completed: 'text-green-400',
    failed: 'text-red-400'
  };

  const statusBg = {
    running: 'bg-blue-500/20 border-blue-500/50',
    completed: 'bg-green-500/20 border-green-500/50',
    failed: 'bg-red-500/20 border-red-500/50'
  };

  // Minimized view
  if (isMinimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 bg-dark-800 border border-dark-600 rounded-xl p-3 shadow-2xl cursor-pointer hover:bg-dark-700 transition-colors"
        onClick={handleMinimize}
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${taskState.status === 'running' ? 'bg-blue-500 animate-pulse' : taskState.status === 'completed' ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm font-medium text-white">Ralph: {taskState.project}</span>
          <span className="text-xs text-gray-400">{formatTime(elapsed)}</span>
          <Maximize2 className="w-4 h-4 text-gray-400" />
        </div>
      </div>
    );
  }

  // Full view
  return (
    <div className="fixed inset-4 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-dark-900 border border-dark-600 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`p-4 border-b ${statusBg[taskState.status]} flex items-center justify-between shrink-0`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${taskState.status === 'running' ? 'bg-blue-500/30' : taskState.status === 'completed' ? 'bg-green-500/30' : 'bg-red-500/30'} flex items-center justify-center`}>
              {taskState.status === 'running' ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : taskState.status === 'completed' ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                🔧 RALPH {taskState.status === 'running' ? 'ACTIVE' : taskState.status.toUpperCase()}
              </h2>
              <p className="text-sm text-gray-400">{taskState.project} • {taskState.task?.slice(0, 50)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleMinimize} className="p-2 hover:bg-dark-600 rounded-lg transition-colors">
              <Minimize2 className="w-5 h-5 text-gray-400" />
            </button>
            <button onClick={handleClose} className="p-2 hover:bg-red-500/20 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-4 py-3 bg-dark-800 border-b border-dark-700 flex items-center gap-6 shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-white font-mono">{formatTime(elapsed)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-white">{taskState.turns} turns</span>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            <span className="text-sm text-white">${taskState.cost?.toFixed(4) || '0.0000'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-gray-400">{(taskState.tokensIn + taskState.tokensOut).toLocaleString()} tokens</span>
          </div>
          {taskState.model && (
            <div className="ml-auto text-xs text-gray-500">
              {taskState.model}
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: Activity Stream */}
          <div className="flex-1 border-r border-dark-700 flex flex-col">
            <div className="px-4 py-2 bg-dark-800/50 border-b border-dark-700 flex items-center gap-2 shrink-0">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-gray-300">Live Activity</span>
            </div>
            <div ref={activityRef} className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {activityLog.map((item, i) => (
                <div
                  key={i}
                  className={`text-sm px-3 py-1.5 rounded-lg ${
                    item.type === 'error' ? 'bg-red-500/10 text-red-400' :
                    item.type === 'complete' ? 'bg-green-500/10 text-green-400' :
                    item.type === 'thought' ? 'bg-purple-500/10 text-purple-300' :
                    item.type === 'tool' ? 'bg-blue-500/10 text-blue-300' :
                    'bg-dark-700 text-gray-300'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {item.time !== null && (
                      <span className="text-xs text-gray-500 font-mono shrink-0 mt-0.5">
                        {formatTime(item.time)}
                      </span>
                    )}
                    <span className="flex-1">{item.content}</span>
                  </div>
                </div>
              ))}
              {taskState.status === 'running' && (
                <div className="flex items-center gap-2 px-3 py-2 text-blue-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Working...</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Files Panel */}
          <div className="w-72 flex flex-col shrink-0">
            <div className="px-4 py-2 bg-dark-800/50 border-b border-dark-700 flex items-center gap-2 shrink-0">
              <FolderOpen className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-gray-300">Files Touched</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Files Read */}
              {taskState.filesRead.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 uppercase mb-1.5">
                    <FileText className="w-3 h-3" />
                    Read ({taskState.filesRead.length})
                  </div>
                  {taskState.filesRead.map((file, i) => (
                    <div key={i} className="text-xs text-gray-400 truncate pl-5 py-0.5" title={file}>
                      📖 {file.split(/[/\\]/).pop()}
                    </div>
                  ))}
                </div>
              )}

              {/* Files Edited */}
              {taskState.filesEdited.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 uppercase mb-1.5">
                    <Edit3 className="w-3 h-3" />
                    Edited ({taskState.filesEdited.length})
                  </div>
                  {taskState.filesEdited.map((file, i) => (
                    <div key={i} className="text-xs text-amber-400 truncate pl-5 py-0.5" title={file}>
                      ✏️ {file.split(/[/\\]/).pop()}
                    </div>
                  ))}
                </div>
              )}

              {/* Files Written */}
              {taskState.filesWritten.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 uppercase mb-1.5">
                    <FilePlus className="w-3 h-3" />
                    Created ({taskState.filesWritten.length})
                  </div>
                  {taskState.filesWritten.map((file, i) => (
                    <div key={i} className="text-xs text-green-400 truncate pl-5 py-0.5" title={file}>
                      📝 {file.split(/[/\\]/).pop()}
                    </div>
                  ))}
                </div>
              )}

              {/* Tool Chain */}
              {taskState.toolCalls.length > 0 && (
                <div className="pt-3 border-t border-dark-700">
                  <div className="flex items-center gap-2 text-xs text-gray-500 uppercase mb-2">
                    <Terminal className="w-3 h-3" />
                    Tool Chain ({taskState.toolCalls.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {taskState.toolCalls.slice(-20).map((call, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 bg-dark-700 rounded text-xs text-gray-400"
                        title={call.file || call.tool}
                      >
                        {getToolIcon(call.tool)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {taskState.filesRead.length === 0 &&
               taskState.filesEdited.length === 0 &&
               taskState.filesWritten.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">
                  No files touched yet...
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Latest Thought */}
        {taskState.thoughts.length > 0 && (
          <div className="px-4 py-3 bg-purple-500/10 border-t border-purple-500/30 shrink-0">
            <div className="flex items-start gap-2">
              <span className="text-purple-400 text-sm shrink-0">💭</span>
              <p className="text-sm text-purple-200 line-clamp-2">
                {taskState.thoughts[taskState.thoughts.length - 1].content}
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 bg-dark-800 border-t border-dark-700 flex items-center justify-between shrink-0">
          <div className="text-xs text-gray-500">
            Session: {taskState.sessionId?.slice(0, 8) || '---'}
          </div>
          <div className="flex items-center gap-2">
            {taskState.status === 'running' && (
              <button className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-lg flex items-center gap-1.5 transition-colors">
                <Square className="w-3 h-3" />
                Cancel
              </button>
            )}
            <button
              onClick={() => setShowFullLog(!showFullLog)}
              className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-gray-300 text-sm rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Terminal className="w-3 h-3" />
              Full Log
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RalphVisualizer;
