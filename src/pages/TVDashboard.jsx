import React, { useState, useEffect } from 'react';
import { Zap, Activity, DollarSign, Target } from 'lucide-react';

function TVDashboard({ token }) {
  const [agents, setAgents] = useState([]);
  const [usage, setUsage] = useState({ today: { tokens_in: 0, tokens_out: 0, cost: 0 }, total: {} });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    fetchAgents();
    fetchUsage();
    
    const timer = setInterval(() => setTime(new Date()), 1000);
    const dataTimer = setInterval(() => {
      fetchAgents();
      fetchUsage();
    }, 30000);

    return () => {
      clearInterval(timer);
      clearInterval(dataTimer);
    };
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    }
  };

  const fetchUsage = async () => {
    try {
      const res = await fetch('/api/usage', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setUsage(data);
    } catch (err) {
      console.error('Failed to fetch usage:', err);
    }
  };

  const todayTokens = (usage?.today?.tokens_in || 0) + (usage?.today?.tokens_out || 0);
  const todayCost = usage?.today?.cost || 0;

  return (
    <div className="min-h-screen bg-dark-900 p-3 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 lg:mb-8">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gold/20 rounded-xl flex items-center justify-center">
            <Zap className="w-5 sm:w-7 h-5 sm:h-7 text-gold" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">BE1st Command Center</h1>
            <p className="text-gray-400 text-xs sm:text-sm lg:text-base">AI-Powered Venture Studio</p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white font-mono">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-gray-400 text-xs sm:text-sm">
            {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Agent Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 lg:gap-4 mb-4 sm:mb-6 lg:mb-8">
        {agents.map(agent => (
          <div key={agent.id} className="bg-dark-800 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-6 border border-dark-600">
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <span className="text-2xl sm:text-3xl lg:text-4xl">{agent.icon}</span>
              <span className="w-2 sm:w-3 h-2 sm:h-3 bg-green-500 rounded-full animate-pulse"></span>
            </div>
            <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-white mb-0.5 sm:mb-1 truncate">{agent.name}</h3>
            <p className="text-gray-400 text-xs sm:text-sm truncate">{agent.role}</p>
            <p className="text-green-400 text-xs sm:text-sm mt-1 sm:mt-2">● Online</p>
          </div>
        ))}

        {/* Ralph Card */}
        <div className="bg-dark-800 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-6 border border-dark-600">
          <div className="flex items-center justify-between mb-2 sm:mb-4">
            <span className="text-2xl sm:text-3xl lg:text-4xl">🔨</span>
            <span className="w-2 sm:w-3 h-2 sm:h-3 bg-yellow-500 rounded-full"></span>
          </div>
          <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-white mb-0.5 sm:mb-1">Ralph</h3>
          <p className="text-gray-400 text-xs sm:text-sm">Autonomous Worker</p>
          <p className="text-yellow-400 text-xs sm:text-sm mt-1 sm:mt-2">● Idle</p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        {/* Metrics */}
        <div className="bg-dark-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-dark-600">
          <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
            <Target className="w-5 sm:w-6 h-5 sm:h-6 text-gold" />
            <h2 className="text-base sm:text-xl font-semibold text-white">Platform Metrics</h2>
          </div>

          <div className="space-y-2 sm:space-y-4">
            <div className="flex justify-between items-center p-3 sm:p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400 text-sm sm:text-base">SlabTrack MRR</span>
              <span className="text-xl sm:text-2xl font-bold text-green-400">$70</span>
            </div>
            <div className="flex justify-between items-center p-3 sm:p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400 text-sm sm:text-base">SlabTrack Subscribers</span>
              <span className="text-xl sm:text-2xl font-bold text-white">64</span>
            </div>
            <div className="flex justify-between items-center p-3 sm:p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400 text-sm sm:text-base">Blink Modules</span>
              <span className="text-xl sm:text-2xl font-bold text-white">102</span>
            </div>
            <div className="flex justify-between items-center p-3 sm:p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400 text-sm sm:text-base">Blink Endpoints</span>
              <span className="text-xl sm:text-2xl font-bold text-white">194</span>
            </div>
          </div>

          {/* Valuation Target */}
          <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-gold/10 rounded-xl border border-gold/30">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gold font-semibold text-sm sm:text-base">$18M Target</span>
              <span className="text-gold text-sm sm:text-base">22%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2 sm:h-3">
              <div className="bg-gold h-2 sm:h-3 rounded-full" style={{ width: '22%' }}></div>
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-dark-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-dark-600">
          <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
            <Activity className="w-5 sm:w-6 h-5 sm:h-6 text-gold" />
            <h2 className="text-base sm:text-xl font-semibold text-white">Activity Feed</h2>
          </div>

          <div className="space-y-2 sm:space-y-3">
            <div className="p-3 sm:p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>👔</span>
                <span className="text-white font-medium text-sm sm:text-base">Prime</span>
                <span className="text-gray-500 text-xs sm:text-sm ml-auto">8:09 AM</span>
              </div>
              <p className="text-gray-400 text-xs sm:text-sm">Morning briefing delivered</p>
            </div>

            <div className="p-3 sm:p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>⚡</span>
                <span className="text-white font-medium text-sm sm:text-base">Flint-SlabTrack</span>
                <span className="text-gray-500 text-xs sm:text-sm ml-auto">8:10 AM</span>
              </div>
              <p className="text-gray-400 text-xs sm:text-sm">Priority assessment completed</p>
            </div>

            <div className="p-3 sm:p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>🏛️</span>
                <span className="text-white font-medium text-sm sm:text-base">Boardroom</span>
                <span className="text-gray-500 text-xs sm:text-sm ml-auto">--:--</span>
              </div>
              <p className="text-gray-400 text-xs sm:text-sm">Awaiting next session</p>
            </div>

            <div className="p-3 sm:p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>🔨</span>
                <span className="text-white font-medium text-sm sm:text-base">Ralph</span>
                <span className="text-gray-500 text-xs sm:text-sm ml-auto">--:--</span>
              </div>
              <p className="text-gray-400 text-xs sm:text-sm">Idle - Awaiting PRD</p>
            </div>
          </div>
        </div>

        {/* API Usage & Ralph Status */}
        <div className="space-y-4 sm:space-y-6 lg:space-y-8">
          {/* API Usage */}
          <div className="bg-dark-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-dark-600">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
              <DollarSign className="w-5 sm:w-6 h-5 sm:h-6 text-gold" />
              <h2 className="text-base sm:text-xl font-semibold text-white">API Usage Today</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="p-3 sm:p-4 bg-dark-700 rounded-xl text-center">
                <p className="text-xl sm:text-3xl font-bold text-white">{todayTokens.toLocaleString()}</p>
                <p className="text-gray-400 text-xs sm:text-sm">Tokens</p>
              </div>
              <div className="p-3 sm:p-4 bg-dark-700 rounded-xl text-center">
                <p className="text-xl sm:text-3xl font-bold text-gold">${todayCost.toFixed(3)}</p>
                <p className="text-gray-400 text-xs sm:text-sm">Cost</p>
              </div>
            </div>
          </div>

          {/* Ralph Status */}
          <div className="bg-dark-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-dark-600">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
              <span className="text-xl sm:text-2xl">🔨</span>
              <h2 className="text-base sm:text-xl font-semibold text-white">Ralph Workers</h2>
            </div>

            <div className="space-y-2 sm:space-y-3">
              <div className="flex items-center justify-between p-3 sm:p-4 bg-dark-700 rounded-xl">
                <div>
                  <p className="text-white font-medium text-sm sm:text-base">SlabTrack</p>
                  <p className="text-gray-400 text-xs sm:text-sm">Awaiting PRD</p>
                </div>
                <span className="px-2 sm:px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-xs sm:text-sm">Idle</span>
              </div>

              <div className="flex items-center justify-between p-3 sm:p-4 bg-dark-700 rounded-xl">
                <div>
                  <p className="text-white font-medium text-sm sm:text-base">Blink</p>
                  <p className="text-gray-400 text-xs sm:text-sm">Awaiting PRD</p>
                </div>
                <span className="px-2 sm:px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-xs sm:text-sm">Idle</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 sm:mt-6 lg:mt-8 text-center text-gray-500 text-xs sm:text-sm">
        🔒 Secured with Tailscale VPN • BE1st Venture Studio
      </div>
    </div>
  );
}

export default TVDashboard;