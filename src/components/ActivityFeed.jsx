import React, { useState, useEffect } from 'react';
import { Activity, MessageSquare, Calendar, Hammer, FileText, AlertCircle } from 'lucide-react';

function ActivityFeed({ token, socket }) {
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    fetchActivities();

    if (socket) {
      socket.on('activity_update', (activity) => {
        setActivities(prev => [activity, ...prev].slice(0, 20));
      });

      socket.on('ralph_update', (data) => {
        const activity = {
          type: 'ralph',
          source: data.project,
          title: `Ralph ${data.action}: ${data.task?.slice(0, 30) || data.branchName}`,
          created_at: new Date().toISOString()
        };
        setActivities(prev => [activity, ...prev].slice(0, 20));
      });
    }

    return () => {
      if (socket) {
        socket.off('activity_update');
        socket.off('ralph_update');
      }
    };
  }, [socket]);

  const fetchActivities = async () => {
    try {
      const res = await fetch('/api/activity?limit=20', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setActivities(data);
    } catch (err) {
      console.error('Failed to fetch activities:', err);
    }
  };

  const getIcon = (type) => {
    const icons = {
      'chat': MessageSquare,
      'calendar': Calendar,
      'ralph': Hammer,
      'wiki': FileText,
      'error': AlertCircle,
      'default': Activity
    };
    return icons[type] || icons.default;
  };

  const getIconColor = (type) => {
    const colors = {
      'chat': 'text-blue-400',
      'calendar': 'text-green-400',
      'ralph': 'text-yellow-400',
      'wiki': 'text-purple-400',
      'error': 'text-red-400',
      'default': 'text-gray-400'
    };
    return colors[type] || colors.default;
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-3">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-gold" />
        <h3 className="text-sm font-semibold text-white">Activity Feed</h3>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {activities.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4">No recent activity</p>
        ) : (
          activities.map((activity, i) => {
            const Icon = getIcon(activity.type);
            return (
              <div key={i} className="flex items-start gap-2 p-2 bg-dark-700 rounded-lg">
                <Icon className={`w-4 h-4 mt-0.5 ${getIconColor(activity.type)}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-white truncate">{activity.title}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">{formatTime(activity.created_at)}</span>
                  </div>
                  {activity.description && (
                    <p className="text-xs text-gray-400 truncate mt-0.5">{activity.description}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ActivityFeed;
