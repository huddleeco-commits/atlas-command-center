import React, { useState, useEffect } from 'react';
import { Zap, Hammer, MessageSquare, Loader2, CheckCircle, XCircle, X, Trash2, Brain, Save, RefreshCw } from 'lucide-react';

function QuickActionsPanel({ token, socket, onStartBoardroom }) {
  const [loading, setLoading] = useState({});
  const [ralphStatus, setRalphStatus] = useState({ isWorking: false, activeTasks: [], recentTasks: [] });
  const [showTaskInput, setShowTaskInput] = useState(null);
  const [taskInput, setTaskInput] = useState('');
  const [memoryStatus, setMemoryStatus] = useState({ lastSnapshot: null, contextLoaded: false });

  useEffect(() => {
    fetchRalphStatus();

    if (socket) {
      socket.on('ralph_update', (data) => {
        console.log('Ralph update:', data);
        fetchRalphStatus();

        // Clear loading state when task completes
        if (data.action === 'completed' || data.action === 'failed' || data.action === 'cancelled') {
          setLoading(prev => {
            const next = { ...prev };
            delete next[`ralph-${data.project}`];
            return next;
          });
        }
      });
    }

    return () => {
      if (socket) {
        socket.off('ralph_update');
      }
    };
  }, [socket]);

  const fetchRalphStatus = async () => {
    try {
      const res = await fetch('/api/ralph/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setRalphStatus(data);
    } catch (err) {
      console.error('Failed to fetch Ralph status:', err);
    }
  };

  const fetchMemoryStatus = async () => {
    try {
      const [snapshotRes, contextRes] = await Promise.all([
        fetch('/api/memory/snapshot', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/memory/prime-context', { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const snapshot = await snapshotRes.json();
      const context = await contextRes.json();
      setMemoryStatus({
        lastSnapshot: snapshot.success ? snapshot.snapshot.created_at : null,
        contextLoaded: context.hasContext
      });
    } catch (err) {
      console.error('Failed to fetch memory status:', err);
    }
  };

  const saveMemorySnapshot = async () => {
    setLoading(prev => ({ ...prev, 'memory-save': true }));
    try {
      const res = await fetch('/api/memory/snapshot', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setMemoryStatus(prev => ({ ...prev, lastSnapshot: data.snapshot.timestamp }));
      }
    } catch (err) {
      console.error('Failed to save memory:', err);
    }
    setLoading(prev => ({ ...prev, 'memory-save': false }));
  };

  const restoreMemory = async () => {
    setLoading(prev => ({ ...prev, 'memory-restore': true }));
    try {
      const res = await fetch('/api/memory/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setMemoryStatus(prev => ({ ...prev, contextLoaded: true }));
      }
    } catch (err) {
      console.error('Failed to restore memory:', err);
    }
    setLoading(prev => ({ ...prev, 'memory-restore': false }));
  };

  // Fetch memory status on mount
  useEffect(() => {
    fetchMemoryStatus();
  }, []);

  const triggerRalph = async (project) => {
    if (!taskInput.trim()) return;

    setLoading(prev => ({ ...prev, [`ralph-${project}`]: true }));
    setShowTaskInput(null);
    setTaskInput('');

    try {
      const res = await fetch('/api/ralph/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ project, task: taskInput.trim() })
      });
      const result = await res.json();
      if (!result.success) {
        alert(`Failed: ${result.error}`);
        setLoading(prev => {
          const next = { ...prev };
          delete next[`ralph-${project}`];
          return next;
        });
      }
    } catch (err) {
      alert('Failed to trigger Ralph');
      setLoading(prev => {
        const next = { ...prev };
        delete next[`ralph-${project}`];
        return next;
      });
    }
  };

  const cancelTask = async (taskId) => {
    try {
      await fetch(`/api/ralph/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchRalphStatus();
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  };

  const clearStuckTasks = async () => {
    if (!confirm('Clear all stuck/in-progress Ralph tasks?')) return;
    try {
      const res = await fetch('/api/ralph/clear-stuck', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.cleared > 0) {
        alert(`Cleared ${data.cleared} stuck task(s)`);
      }
      fetchRalphStatus();
      setLoading({});
    } catch (err) {
      console.error('Failed to clear stuck tasks:', err);
    }
  };

  const handleKeyPress = (e, project) => {
    if (e.key === 'Enter') {
      triggerRalph(project);
    } else if (e.key === 'Escape') {
      setShowTaskInput(null);
      setTaskInput('');
    }
  };

  const getProjectStatus = (project) => {
    const activeTask = ralphStatus.activeTasks?.find(t => t.project === project);
    const recentTask = ralphStatus.recentTasks?.find(t => t.project === project);

    if (loading[`ralph-${project}`] || activeTask) {
      return { status: 'working', task: activeTask };
    }
    if (recentTask?.status === 'completed') {
      return { status: 'completed', task: recentTask };
    }
    if (recentTask?.status === 'failed') {
      return { status: 'failed', task: recentTask };
    }
    return { status: 'idle' };
  };

  // All projects available on server
  const projects = [
    { id: 'slabtrack', name: 'SlabTrack', color: 'blue' },
    { id: 'blink', name: 'Blink', color: 'purple' },
    { id: 'command-center', name: 'CommandCenter', color: 'gold' }
  ];

  const hasStuckTasks = ralphStatus.recentTasks?.some(t => t.status === 'in_progress');

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-3">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-gold" />
        <h3 className="text-sm font-semibold text-white">Quick Actions</h3>
      </div>

      <div className="space-y-2">
        {/* Boardroom Button */}
        <button
          onClick={onStartBoardroom}
          className="w-full flex items-center gap-2 p-2 rounded-lg transition-colors bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="text-sm font-medium">Start Boardroom</span>
        </button>

        {/* Memory Section */}
        <div className="flex items-center gap-2 pt-2 border-t border-dark-600 mt-2">
          <Brain className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase">Memory</span>
          {memoryStatus.contextLoaded && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
              Loaded
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={saveMemorySnapshot}
            disabled={loading['memory-save']}
            className="flex-1 flex items-center justify-center gap-1.5 p-2 rounded-lg transition-colors bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50"
          >
            {loading['memory-save'] ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span className="text-xs font-medium">Save</span>
          </button>
          <button
            onClick={restoreMemory}
            disabled={loading['memory-restore']}
            className="flex-1 flex items-center justify-center gap-1.5 p-2 rounded-lg transition-colors bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50"
          >
            {loading['memory-restore'] ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="text-xs font-medium">Restore</span>
          </button>
        </div>

        {memoryStatus.lastSnapshot && (
          <p className="text-xs text-gray-500 text-center">
            Last save: {new Date(memoryStatus.lastSnapshot).toLocaleString()}
          </p>
        )}

        {/* Ralph Status Header */}
        <div className="flex items-center gap-2 pt-2 border-t border-dark-600 mt-2">
          <Hammer className="w-4 h-4 text-gold" />
          <span className="text-xs font-semibold text-gray-400 uppercase">Ralph</span>
          {ralphStatus.isWorking && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
              Working
            </span>
          )}
          {hasStuckTasks && (
            <button
              onClick={clearStuckTasks}
              className="ml-auto text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              title="Clear stuck tasks"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* Ralph Project Buttons */}
        {projects.map(project => {
          const status = getProjectStatus(project.id);
          const isWorking = status.status === 'working';
          const colorClasses = {
            blue: 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30',
            purple: 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30',
            gold: 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
          };

          return (
            <div key={project.id}>
              {showTaskInput === project.id ? (
                <div className={`p-2 rounded-lg ${colorClasses[project.color]}`}>
                  <input
                    type="text"
                    placeholder={`Task for ${project.name}...`}
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    onKeyDown={(e) => handleKeyPress(e, project.id)}
                    autoFocus
                    className="w-full px-2 py-1 bg-dark-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-current mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => triggerRalph(project.id)}
                      disabled={!taskInput.trim()}
                      className="flex-1 py-1 bg-dark-600 hover:bg-dark-500 rounded text-xs font-medium disabled:opacity-50"
                    >
                      Start
                    </button>
                    <button
                      onClick={() => { setShowTaskInput(null); setTaskInput(''); }}
                      className="px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => !isWorking && setShowTaskInput(project.id)}
                  disabled={isWorking}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${colorClasses[project.color]} ${isWorking ? 'cursor-default' : ''}`}
                >
                  {isWorking ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : status.status === 'completed' ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : status.status === 'failed' ? (
                    <XCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <Hammer className="w-4 h-4" />
                  )}
                  <span className="text-sm font-medium flex-1 text-left">
                    {project.name}
                  </span>
                  {isWorking && status.task && (
                    <span className="text-xs opacity-75">
                      {status.task.runningFor ? `${status.task.runningFor}s` : 'Starting...'}
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        })}

        {/* Recent Task Status */}
        {ralphStatus.recentTasks?.length > 0 && (
          <div className="pt-2 border-t border-dark-600 mt-2">
            <p className="text-xs text-gray-500 mb-1">Recent:</p>
            {ralphStatus.recentTasks.slice(0, 3).map(task => (
              <div key={task.id} className="flex items-center justify-between text-xs py-1 group">
                <span className="text-gray-400 truncate flex-1">{task.branch_name?.replace('ralph/', '')}</span>
                <div className="flex items-center gap-1">
                  <span className={`${
                    task.status === 'completed' ? 'text-green-400' :
                    task.status === 'in_progress' ? 'text-blue-400' :
                    task.status === 'failed' ? 'text-red-400' :
                    task.status === 'cancelled' ? 'text-gray-400' :
                    'text-yellow-400'
                  }`}>
                    {task.status}
                  </span>
                  {task.status === 'in_progress' && (
                    <button
                      onClick={() => cancelTask(task.id)}
                      className="p-0.5 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Cancel task"
                    >
                      <X className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default QuickActionsPanel;
