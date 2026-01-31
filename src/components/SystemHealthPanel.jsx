import React, { useState, useEffect } from 'react';
import { Activity, AlertTriangle, CheckCircle, Server, Cpu, Clock } from 'lucide-react';

function SystemHealthPanel({ token }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/system/health', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setHealth(data);
    } catch (err) {
      console.error('Failed to fetch health:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-dark-600 rounded w-1/3"></div>
          <div className="h-8 bg-dark-600 rounded"></div>
          <div className="h-8 bg-dark-600 rounded"></div>
        </div>
      </div>
    );
  }

  const getTotalErrors = () => {
    if (!health?.sentry) return 0;
    return Object.values(health.sentry).reduce((sum, p) => sum + (p.errorCount || 0), 0);
  };

  const getHealthStatus = () => {
    const errors = getTotalErrors();
    if (errors === 0) return { status: 'healthy', color: 'text-green-400', bg: 'bg-green-500/20' };
    if (errors < 5) return { status: 'warning', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    return { status: 'critical', color: 'text-red-400', bg: 'bg-red-500/20' };
  };

  const healthStatus = getHealthStatus();

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-gold" />
          <h3 className="text-sm font-semibold text-white">System Health</h3>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs ${healthStatus.bg} ${healthStatus.color}`}>
          {healthStatus.status}
        </span>
      </div>

      {/* Server Stats */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="p-2 bg-dark-700 rounded-lg">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-400">Uptime</span>
          </div>
          <p className="text-sm font-medium text-white">{health?.server?.uptimeFormatted || '--'}</p>
        </div>
        <div className="p-2 bg-dark-700 rounded-lg">
          <div className="flex items-center gap-1.5 mb-1">
            <Cpu className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-400">Memory</span>
          </div>
          <p className="text-sm font-medium text-white">
            {health?.server?.memory ? `${health.server.memory.used}/${health.server.memory.total}MB` : '--'}
          </p>
        </div>
      </div>

      {/* Sentry Errors by Platform */}
      <div className="space-y-2 mb-4">
        <h4 className="text-xs font-medium text-gray-400 uppercase">Platform Errors</h4>
        {health?.sentry && Object.entries(health.sentry).map(([platform, data]) => (
          <div key={platform} className="flex items-center justify-between p-2 bg-dark-700 rounded-lg">
            <div className="flex items-center gap-2">
              {data.errorCount === 0 ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              )}
              <span className="text-sm text-white capitalize">{platform.replace('-', ' ')}</span>
            </div>
            <span className={`text-sm font-medium ${data.errorCount > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
              {data.errorCount} errors
            </span>
          </div>
        ))}
      </div>

      {/* Recent Errors */}
      {health?.sentry && Object.values(health.sentry).some(p => p.recentIssues?.length > 0) && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase">Recent Issues</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {Object.entries(health.sentry).map(([platform, data]) =>
              data.recentIssues?.map((issue, i) => (
                <div key={`${platform}-${i}`} className="p-2 bg-dark-700 rounded text-xs">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-gray-400 capitalize">{platform}:</span>
                    <span className="text-white truncate">{issue.title}</span>
                  </div>
                  <span className="text-gray-500">{issue.count}x - {issue.culprit?.slice(0, 30)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Ralph Status */}
      {health?.ralph && (
        <div className="mt-4 pt-4 border-t border-dark-600">
          <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">Ralph Status</h4>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-green-400" />
              <span className="text-xs text-gray-400">Active: {health.ralph.activeTasks}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-yellow-400" />
              <span className="text-xs text-gray-400">Pending: {health.ralph.pendingTasks}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SystemHealthPanel;
