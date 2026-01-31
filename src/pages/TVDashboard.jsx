import React, { useState, useEffect, useRef } from 'react';
import { Zap, Activity, DollarSign, Target, Server, AlertTriangle, CheckCircle, Rocket, MessageSquare, GitBranch, Calendar, Radio, Volume2, VolumeX } from 'lucide-react';

function TVDashboard({ token, socket, onSwitchToChat }) {
  const [agents, setAgents] = useState([]);
  const [usage, setUsage] = useState({ today: { tokens_in: 0, tokens_out: 0, cost: 0 }, total: {} });
  const [time, setTime] = useState(new Date());
  const [health, setHealth] = useState(null);
  const [activities, setActivities] = useState([]);
  const [ralphTasks, setRalphTasks] = useState([]);
  const [gitSync, setGitSync] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [alertBanner, setAlertBanner] = useState(null);
  const [activeAgents, setActiveAgents] = useState(new Set());
  const [ralphActive, setRalphActive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const alertAudio = useRef(null);

  // ATLAS Progress data
  const atlasProgress = {
    day: 2,
    totalDays: 60,
    milestones: [
      { id: 1, label: 'Scout agent', done: true },
      { id: 2, label: 'Supplier agent', done: false },
      { id: 3, label: 'Ads agent', done: false },
      { id: 4, label: 'Dropship store', done: false },
      { id: 5, label: 'First sale', done: false },
    ]
  };

  useEffect(() => {
    fetchAll();
    const timer = setInterval(() => setTime(new Date()), 1000);
    const dataTimer = setInterval(fetchAll, 30000);

    if (socket) {
      // Activity updates
      socket.on('activity_update', (activity) => {
        setActivities(prev => [activity, ...prev].slice(0, 10));
        showAlert(activity.title, activity.source, 'activity');
      });

      // Ralph events
      socket.on('ralph:start', (data) => {
        setRalphActive(true);
        showAlert(`Ralph started: ${data.project}`, 'ralph', 'info');
      });
      socket.on('ralph:complete', (data) => {
        setRalphActive(false);
        fetchRalphTasks();
        showAlert(`Ralph completed: ${data.project}`, 'ralph', 'success');
        playSound();
      });
      socket.on('ralph:error', () => {
        setRalphActive(false);
        showAlert('Ralph task failed', 'ralph', 'error');
      });
      socket.on('ralph_update', () => fetchRalphTasks());

      // Agent typing/activity
      socket.on('agent_typing', ({ agent_id, typing }) => {
        setActiveAgents(prev => {
          const next = new Set(prev);
          if (typing) next.add(agent_id);
          else next.delete(agent_id);
          return next;
        });
      });

      // Wiki saves
      socket.on('wiki_saved', ({ title }) => {
        showAlert(`Saved to Wiki: ${title}`, 'wiki', 'success');
      });

      // Git sync
      socket.on('git_synced', (data) => {
        if (data.totalCommits > 0) {
          showAlert(`Git: ${data.totalCommits} new commits`, 'git', 'info');
        }
      });
    }

    return () => {
      clearInterval(timer);
      clearInterval(dataTimer);
      if (socket) {
        socket.off('activity_update');
        socket.off('ralph:start');
        socket.off('ralph:complete');
        socket.off('ralph:error');
        socket.off('ralph_update');
        socket.off('agent_typing');
        socket.off('wiki_saved');
        socket.off('git_synced');
      }
    };
  }, [socket]);

  const showAlert = (message, source, type = 'info') => {
    setAlertBanner({ message, source, type, time: new Date() });
    setTimeout(() => setAlertBanner(null), 5000);
  };

  const playSound = () => {
    if (soundEnabled && alertAudio.current) {
      alertAudio.current.play().catch(() => {});
    }
  };

  const fetchAll = () => {
    fetchAgents();
    fetchUsage();
    fetchHealth();
    fetchActivities();
    fetchRalphTasks();
    fetchGitSync();
    fetchCalendar();
  };

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const filtered = (data.agents || [])
        .filter(a => !['ralph', 'summarizer', 'optimizer', 'monitor'].includes(a.id))
        .filter((agent, index, self) => index === self.findIndex(a => a.id === agent.id));
      setAgents(filtered);
    } catch (err) { console.error('Failed to fetch agents:', err); }
  };

  const fetchUsage = async () => {
    try {
      const res = await fetch('/api/usage', { headers: { Authorization: `Bearer ${token}` } });
      setUsage(await res.json());
    } catch (err) { console.error('Failed to fetch usage:', err); }
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/system/health', { headers: { Authorization: `Bearer ${token}` } });
      setHealth(await res.json());
    } catch (err) { console.error('Failed to fetch health:', err); }
  };

  const fetchActivities = async () => {
    try {
      const res = await fetch('/api/activity?limit=10', { headers: { Authorization: `Bearer ${token}` } });
      setActivities(await res.json());
    } catch (err) { console.error('Failed to fetch activities:', err); }
  };

  const fetchRalphTasks = async () => {
    try {
      const res = await fetch('/api/ralph/tasks?limit=5', { headers: { Authorization: `Bearer ${token}` } });
      const tasks = await res.json();
      setRalphTasks(tasks);
      setRalphActive(tasks.some(t => t.status === 'in_progress'));
    } catch (err) { console.error('Failed to fetch ralph tasks:', err); }
  };

  const fetchGitSync = async () => {
    try {
      const res = await fetch('/api/git/sync/status', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const status = await res.json();
        // Also get recent sync data
        const historyRes = await fetch('/api/git/sync/history?limit=1', { headers: { Authorization: `Bearer ${token}` } });
        if (historyRes.ok) {
          const history = await historyRes.json();
          setGitSync({ ...status, lastData: history[0]?.sync_data });
        } else {
          setGitSync(status);
        }
      }
    } catch (err) { console.error('Failed to fetch git sync:', err); }
  };

  const fetchCalendar = async () => {
    try {
      const res = await fetch('/api/calendar/today', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setCalendarEvents(await res.json());
    } catch (err) { console.error('Failed to fetch calendar:', err); }
  };

  const todayTokens = (usage?.today?.tokens_in || 0) + (usage?.today?.tokens_out || 0);
  const todayCost = usage?.today?.cost || 0;
  const totalErrors = health?.sentry ? Object.values(health.sentry).reduce((sum, p) => sum + (p.errorCount || 0), 0) : 0;

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--';
    return new Date(timestamp).toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const getRelativeTime = (timestamp) => {
    if (!timestamp) return '';
    const mins = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Get commits from last sync
  const getRecentCommits = () => {
    if (!gitSync?.lastData) return [];
    const commits = [];
    Object.entries(gitSync.lastData).forEach(([project, data]) => {
      if (data?.commits) {
        data.commits.slice(0, 2).forEach(c => {
          commits.push({ ...c, project });
        });
      }
    });
    return commits.slice(0, 4);
  };

  const recentCommits = getRecentCommits();
  const isNowHappening = ralphActive || activeAgents.size > 0;

  return (
    <div className="h-screen bg-dark-900 p-3 flex flex-col overflow-hidden">
      {/* Audio element for alerts */}
      <audio ref={alertAudio} src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU..." preload="auto" />

      {/* Alert Banner */}
      {alertBanner && (
        <div className={`absolute top-0 left-0 right-0 z-50 p-3 text-center font-medium animate-pulse ${
          alertBanner.type === 'success' ? 'bg-green-600' :
          alertBanner.type === 'error' ? 'bg-red-600' :
          'bg-blue-600'
        }`}>
          {alertBanner.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gold/20 rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">ATLAS</h1>
            <p className="text-gray-400 text-xs">AI Business Orchestration</p>
          </div>
        </div>

        {/* NOW HAPPENING Indicator */}
        {isNowHappening && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg animate-pulse">
            <Radio className="w-4 h-4 text-red-400" />
            <span className="text-red-400 font-medium text-sm">
              {ralphActive ? 'Ralph Executing...' : `${activeAgents.size} Agent(s) Active`}
            </span>
          </div>
        )}

        <div className="flex items-center gap-4">
          {onSwitchToChat && (
            <button
              onClick={onSwitchToChat}
              className="px-4 py-2 bg-dark-700 hover:bg-dark-600 border border-dark-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
          )}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg ${soundEnabled ? 'bg-green-500/20 text-green-400' : 'bg-dark-700 text-gray-400'}`}
            title={soundEnabled ? 'Sound On' : 'Sound Off'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${
            totalErrors === 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {totalErrors === 0 ? 'Healthy' : `${totalErrors} Errors`}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white font-mono">
              {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-gray-400 text-xs">
              {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* Progress + Milestones (compact) */}
      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-xl p-3 border border-purple-500/30 mb-3 shrink-0">
        <div className="flex items-center gap-4">
          <Rocket className="w-5 h-5 text-purple-400 shrink-0" />
          <span className="text-sm font-medium text-white">Day {atlasProgress.day}/{atlasProgress.totalDays}</span>
          <div className="flex-1 bg-dark-700 rounded-full h-2 max-w-xs">
            <div className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full" style={{ width: `${(atlasProgress.day / atlasProgress.totalDays) * 100}%` }} />
          </div>
          <div className="flex gap-2">
            {atlasProgress.milestones.map(m => (
              <span key={m.id} className={`px-2 py-0.5 rounded text-xs ${m.done ? 'bg-green-500/20 text-green-400' : 'bg-dark-700 text-gray-500'}`}>
                {m.done ? '✓' : '○'} {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Agent Strip (single row, compact) */}
      <div className="flex gap-2 mb-3 shrink-0 overflow-hidden">
        {agents.slice(0, 10).map(agent => (
          <div
            key={agent.id}
            className={`flex items-center gap-2 px-3 py-2 bg-dark-800 rounded-lg border ${
              activeAgents.has(agent.id) ? 'border-green-500 ring-1 ring-green-500/50' : 'border-dark-600'
            }`}
          >
            <span className="text-lg">{agent.icon}</span>
            <span className="text-xs text-white font-medium">{agent.name.replace('Flint-', '')}</span>
            {activeAgents.has(agent.id) && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
          </div>
        ))}
        {/* Ralph */}
        <div className={`flex items-center gap-2 px-3 py-2 bg-dark-800 rounded-lg border ${
          ralphActive ? 'border-blue-500 ring-1 ring-blue-500/50 animate-pulse' : 'border-dark-600'
        }`}>
          <span className="text-lg">🔧</span>
          <span className="text-xs text-white font-medium">Ralph</span>
          {ralphActive && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
        </div>
      </div>

      {/* Main Grid - 5 columns */}
      <div className="flex-1 grid grid-cols-5 gap-3 min-h-0">

        {/* Column 1: Metrics */}
        <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-gold" />
            <h2 className="text-sm font-semibold text-white">Metrics</h2>
          </div>
          <div className="space-y-2 flex-1">
            <div className="flex justify-between items-center p-2 bg-dark-700 rounded-lg">
              <span className="text-gray-400 text-xs">SlabTrack MRR</span>
              <span className="text-sm font-bold text-green-400">$70</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-dark-700 rounded-lg">
              <span className="text-gray-400 text-xs">Subscribers</span>
              <span className="text-sm font-bold text-white">64</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-dark-700 rounded-lg">
              <span className="text-gray-400 text-xs">Blink Modules</span>
              <span className="text-sm font-bold text-white">102</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-dark-700 rounded-lg">
              <span className="text-gray-400 text-xs">API Today</span>
              <span className="text-sm font-bold text-gold">${todayCost.toFixed(2)}</span>
            </div>
          </div>
          <div className="mt-2 p-2 bg-gold/10 rounded-lg border border-gold/30">
            <div className="flex justify-between items-center">
              <span className="text-gold text-xs font-medium">$18M Target</span>
              <span className="text-gold text-xs">22%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-1.5 mt-1">
              <div className="bg-gold h-1.5 rounded-full" style={{ width: '22%' }}></div>
            </div>
          </div>
        </div>

        {/* Column 2: Activity Feed */}
        <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-gold" />
            <h2 className="text-sm font-semibold text-white">Activity</h2>
          </div>
          <div className="space-y-1.5 flex-1 overflow-hidden">
            {activities.slice(0, 5).map((activity, i) => (
              <div key={i} className="p-2 bg-dark-700 rounded-lg">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-white text-xs font-medium truncate flex-1">{activity.title}</span>
                  <span className="text-gray-500 text-[10px] ml-1">{getRelativeTime(activity.created_at)}</span>
                </div>
                {activity.description && (
                  <p className="text-gray-400 text-[10px] truncate">{activity.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Git Commits */}
        <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <GitBranch className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Git Activity</h2>
            {gitSync?.lastSync && (
              <span className="text-[10px] text-gray-500 ml-auto">{getRelativeTime(gitSync.lastSync)}</span>
            )}
          </div>
          <div className="space-y-1.5 flex-1 overflow-hidden">
            {recentCommits.length === 0 ? (
              <p className="text-gray-500 text-xs text-center py-4">No recent commits</p>
            ) : (
              recentCommits.map((commit, i) => (
                <div key={i} className="p-2 bg-dark-700 rounded-lg">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      commit.project === 'slabtrack' ? 'bg-blue-400' :
                      commit.project === 'blink' ? 'bg-purple-400' : 'bg-green-400'
                    }`} />
                    <span className="text-[10px] text-gray-400 capitalize">{commit.project}</span>
                    <span className="text-[10px] text-gray-500 ml-auto">{commit.relative}</span>
                  </div>
                  <p className="text-white text-xs truncate">{commit.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 4: Calendar + System */}
        <div className="flex flex-col gap-3">
          {/* Today's Schedule */}
          <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-gold" />
              <h2 className="text-sm font-semibold text-white">Today</h2>
            </div>
            <div className="space-y-1.5">
              {calendarEvents.length === 0 ? (
                <p className="text-gray-500 text-xs text-center py-2">No events today</p>
              ) : (
                calendarEvents.slice(0, 3).map((event, i) => (
                  <div key={i} className="p-2 bg-dark-700 rounded-lg">
                    <p className="text-white text-xs truncate">{event.title}</p>
                    {event.event_time && (
                      <p className="text-gray-400 text-[10px]">{event.event_time.slice(0, 5)}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* System Health */}
          <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
            <div className="flex items-center gap-2 mb-2">
              <Server className="w-4 h-4 text-gold" />
              <h2 className="text-sm font-semibold text-white">System</h2>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 bg-dark-700 rounded-lg">
                <span className="text-xs text-gray-400">Server</span>
                <span className="text-xs text-green-400">{health?.server?.uptimeFormatted || 'Online'}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-dark-700 rounded-lg">
                <span className="text-xs text-gray-400">Memory</span>
                <span className="text-xs text-white">{health?.server?.memory ? `${health.server.memory.used}MB` : '--'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 5: Ralph Tasks */}
        <div className={`bg-dark-800 rounded-xl p-3 border flex flex-col ${
          ralphActive ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-dark-600'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔧</span>
            <h2 className="text-sm font-semibold text-white">Ralph</h2>
            {ralphActive && (
              <span className="ml-auto px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full animate-pulse">
                RUNNING
              </span>
            )}
          </div>
          <div className="space-y-1.5 flex-1 overflow-hidden">
            {ralphTasks.length === 0 ? (
              <p className="text-gray-500 text-xs text-center py-4">No tasks</p>
            ) : (
              ralphTasks.slice(0, 4).map((task) => (
                <div key={task.id} className={`p-2 rounded-lg ${
                  task.status === 'in_progress' ? 'bg-blue-500/20 border border-blue-500/30' : 'bg-dark-700'
                }`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-white text-xs font-medium capitalize">{task.project}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      task.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      task.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {task.status === 'in_progress' ? 'running' : task.status}
                    </span>
                  </div>
                  <p className="text-gray-400 text-[10px] truncate">{task.branch_name}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-2 text-center text-gray-500 text-[10px] shrink-0">
        🔒 Tailscale VPN • ATLAS by BE1st • $18M Target
      </div>
    </div>
  );
}

export default TVDashboard;
