import React, { useState, useEffect } from 'react';
import { Zap, Activity, DollarSign, Target, Server, AlertTriangle, CheckCircle, Rocket, MessageSquare } from 'lucide-react';

function TVDashboard({ token, socket, onSwitchToChat }) {
  const [agents, setAgents] = useState([]);
  const [usage, setUsage] = useState({ today: { tokens_in: 0, tokens_out: 0, cost: 0 }, total: {} });
  const [time, setTime] = useState(new Date());
  const [health, setHealth] = useState(null);
  const [activities, setActivities] = useState([]);
  const [ralphTasks, setRalphTasks] = useState([]);

  // ATLAS Progress data
  const atlasProgress = {
    day: 2,
    totalDays: 60,
    milestones: [
      { id: 1, label: 'Scout agent built', done: true },
      { id: 2, label: 'Supplier agent tested', done: false },
      { id: 3, label: 'Ads agent tested', done: false },
      { id: 4, label: 'Dropship store live', done: false },
      { id: 5, label: 'First autonomous sale', done: false },
    ]
  };

  useEffect(() => {
    fetchAll();
    const timer = setInterval(() => setTime(new Date()), 1000);
    const dataTimer = setInterval(fetchAll, 30000);

    if (socket) {
      socket.on('activity_update', (activity) => {
        setActivities(prev => [activity, ...prev].slice(0, 10));
      });
      socket.on('ralph_update', () => fetchRalphTasks());
    }

    return () => {
      clearInterval(timer);
      clearInterval(dataTimer);
      if (socket) {
        socket.off('activity_update');
        socket.off('ralph_update');
      }
    };
  }, [socket]);

  const fetchAll = () => {
    fetchAgents();
    fetchUsage();
    fetchHealth();
    fetchActivities();
    fetchRalphTasks();
  };

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const filtered = (data.agents || [])
        .filter(a => a.id !== 'ralph')
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
      setRalphTasks(await res.json());
    } catch (err) { console.error('Failed to fetch ralph tasks:', err); }
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

  const getAgentIcon = (source) => {
    const agent = agents.find(a => a.id === source);
    return agent?.icon || '💬';
  };

  return (
    <div className="h-screen bg-dark-900 p-4 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="relative flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gold/20 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6 text-gold" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">ATLAS</h1>
            <p className="text-gray-400 text-sm">AI Business Orchestration by BE1st</p>
          </div>
        </div>

        {/* Center - Switch to Chat (absolutely positioned) */}
        {onSwitchToChat && (
          <button
            onClick={onSwitchToChat}
            className="absolute left-1/2 -translate-x-1/2 px-5 py-2.5 bg-dark-700 hover:bg-dark-600 border border-dark-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            Switch to Chat
          </button>
        )}

        <div className="flex items-center gap-6">
          <div className={`px-4 py-1.5 rounded-full text-sm font-medium ${
            totalErrors === 0 ? 'bg-green-500/20 text-green-400' :
            totalErrors < 5 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {totalErrors === 0 ? 'All Systems Healthy' : `${totalErrors} Errors`}
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-white font-mono">
              {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-gray-400 text-sm">
              {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* ATLAS Progress Tracker */}
      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-xl p-4 border border-purple-500/30 mb-4 shrink-0">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
              <Rocket className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">ATLAS Proof of Concept</h2>
              <p className="text-purple-300 text-sm">Day {atlasProgress.day} of {atlasProgress.totalDays}</p>
            </div>
          </div>
          <div className="flex-1 max-w-sm">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Progress</span>
              <span>{Math.round((atlasProgress.day / atlasProgress.totalDays) * 100)}%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2.5">
              <div
                className="bg-gradient-to-r from-purple-500 to-blue-500 h-2.5 rounded-full"
                style={{ width: `${(atlasProgress.day / atlasProgress.totalDays) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {atlasProgress.milestones.map(m => (
              <div
                key={m.id}
                className={`px-3 py-1 rounded text-xs ${
                  m.done ? 'bg-green-500/20 text-green-400' : 'bg-dark-700 text-gray-400'
                }`}
              >
                {m.done ? '✓' : '○'} {m.label.split(' ').slice(0, 2).join(' ')}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Agent Grid - 2 rows of 6 (11 agents + Ralph = 12 cards) */}
      <div className="grid grid-cols-6 gap-3 mb-4 shrink-0">
        {agents.slice(0, 11).map(agent => (
          <div key={agent.id} className="bg-dark-800 rounded-xl p-3 border border-dark-600">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{agent.icon}</span>
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></span>
            </div>
            <h3 className="text-sm font-semibold text-white truncate">{agent.name}</h3>
            <p className="text-gray-400 text-xs truncate">{agent.role}</p>
          </div>
        ))}

        {/* Ralph Card */}
        <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xl">🔧</span>
            <span className={`w-2.5 h-2.5 rounded-full ${
              ralphTasks.some(t => t.status === 'in_progress') ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
            }`}></span>
          </div>
          <h3 className="text-sm font-semibold text-white">Ralph</h3>
          <p className="text-gray-400 text-xs">
            {ralphTasks.filter(t => t.status === 'in_progress').length > 0 ? 'Code Execution' : 'Idle'}
          </p>
        </div>
      </div>

      {/* Main Content - 4 Column Grid */}
      <div className="flex-1 grid grid-cols-4 gap-4 min-h-0">
        {/* Platform Metrics */}
        <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-5 h-5 text-gold" />
            <h2 className="text-base font-semibold text-white">Platform Metrics</h2>
          </div>

          <div className="space-y-2 flex-1">
            <div className="flex justify-between items-center p-3 bg-dark-700 rounded-xl">
              <span className="text-gray-400 text-sm">SlabTrack MRR</span>
              <span className="text-lg font-bold text-green-400">$70</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-dark-700 rounded-xl">
              <span className="text-gray-400 text-sm">Subscribers</span>
              <span className="text-lg font-bold text-white">64</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-dark-700 rounded-xl">
              <span className="text-gray-400 text-sm">Blink Modules</span>
              <span className="text-lg font-bold text-white">102</span>
            </div>
          </div>

          <div className="mt-3 p-3 bg-gold/10 rounded-xl border border-gold/30">
            <div className="flex justify-between items-center mb-1">
              <span className="text-gold font-semibold text-sm">$18M Target</span>
              <span className="text-gold text-sm">22%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2">
              <div className="bg-gold h-2 rounded-full" style={{ width: '22%' }}></div>
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-5 h-5 text-gold" />
            <h2 className="text-base font-semibold text-white">Activity Feed</h2>
          </div>

          <div className="space-y-2 flex-1 overflow-hidden">
            {activities.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No recent activity</p>
            ) : (
              activities.slice(0, 3).map((activity, i) => (
                <div key={i} className="p-3 bg-dark-700 rounded-xl">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{getAgentIcon(activity.source)}</span>
                    <span className="text-white font-medium text-sm truncate flex-1">{activity.title}</span>
                    <span className="text-gray-500 text-xs">{formatTime(activity.created_at)}</span>
                  </div>
                  {activity.description && (
                    <p className="text-gray-400 text-xs truncate">{activity.description}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* System Health */}
        <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-5 h-5 text-gold" />
            <h2 className="text-base font-semibold text-white">System Health</h2>
          </div>

          <div className="space-y-2 flex-1">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-dark-700 rounded-xl text-center">
                <p className="text-sm font-medium text-white">{health?.server?.uptimeFormatted || '--'}</p>
                <p className="text-xs text-gray-400">Uptime</p>
              </div>
              <div className="p-3 bg-dark-700 rounded-xl text-center">
                <p className="text-sm font-medium text-white">
                  {health?.server?.memory ? `${health.server.memory.used}MB` : '--'}
                </p>
                <p className="text-xs text-gray-400">Memory</p>
              </div>
            </div>

            {health?.sentry && Object.entries(health.sentry).map(([platform, data]) => (
              <div key={platform} className="flex items-center justify-between p-3 bg-dark-700 rounded-xl">
                <div className="flex items-center gap-2">
                  {data.errorCount === 0 ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  )}
                  <span className="text-sm text-white capitalize">{platform.replace('-', ' ')}</span>
                </div>
                <span className={`text-sm ${data.errorCount > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {data.errorCount}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* API Usage + Ralph Tasks */}
        <div className="flex flex-col gap-4">
          {/* API Usage */}
          <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-5 h-5 text-gold" />
              <h2 className="text-base font-semibold text-white">API Usage</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-dark-700 rounded-xl text-center">
                <p className="text-xl font-bold text-white">{todayTokens.toLocaleString()}</p>
                <p className="text-gray-400 text-xs">Tokens</p>
              </div>
              <div className="p-3 bg-dark-700 rounded-xl text-center">
                <p className="text-xl font-bold text-gold">${todayCost.toFixed(3)}</p>
                <p className="text-gray-400 text-xs">Cost</p>
              </div>
            </div>
          </div>

          {/* Ralph Tasks */}
          <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🔧</span>
              <h2 className="text-base font-semibold text-white">Ralph Tasks</h2>
            </div>

            <div className="space-y-2">
              {ralphTasks.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-2">No tasks</p>
              ) : (
                ralphTasks.slice(0, 3).map((task) => (
                  <div key={task.id} className="flex items-center justify-between p-3 bg-dark-700 rounded-xl">
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium text-sm capitalize truncate">{task.project}</p>
                      <p className="text-gray-400 text-xs truncate">{task.branch_name}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      task.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      task.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 text-center text-gray-500 text-xs shrink-0">
        🔒 Secured with Tailscale VPN • ATLAS by BE1st • Target: $18M Valuation
      </div>
    </div>
  );
}

export default TVDashboard;
