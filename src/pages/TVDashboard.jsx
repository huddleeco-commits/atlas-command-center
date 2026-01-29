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
    <div className="min-h-screen bg-dark-900 p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gold/20 rounded-xl flex items-center justify-center">
            <Zap className="w-7 h-7 text-gold" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">BE1st Command Center</h1>
            <p className="text-gray-400">AI-Powered Venture Studio</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold text-white font-mono">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-gray-400">
            {time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Agent Status Cards */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {agents.map(agent => (
          <div key={agent.id} className="bg-dark-800 rounded-2xl p-6 border border-dark-600">
            <div className="flex items-center justify-between mb-4">
              <span className="text-4xl">{agent.icon}</span>
              <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
            </div>
            <h3 className="text-xl font-semibold text-white mb-1">{agent.name}</h3>
            <p className="text-gray-400 text-sm">{agent.role}</p>
            <p className="text-green-400 text-sm mt-2">● Online</p>
          </div>
        ))}
        
        {/* Ralph Card */}
        <div className="bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div className="flex items-center justify-between mb-4">
            <span className="text-4xl">🔨</span>
            <span className="w-3 h-3 bg-yellow-500 rounded-full"></span>
          </div>
          <h3 className="text-xl font-semibold text-white mb-1">Ralph</h3>
          <p className="text-gray-400 text-sm">Autonomous Worker</p>
          <p className="text-yellow-400 text-sm mt-2">● Idle</p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-8">
        {/* Metrics */}
        <div className="bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div className="flex items-center gap-3 mb-6">
            <Target className="w-6 h-6 text-gold" />
            <h2 className="text-xl font-semibold text-white">Platform Metrics</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400">SlabTrack MRR</span>
              <span className="text-2xl font-bold text-green-400">$70</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400">SlabTrack Subscribers</span>
              <span className="text-2xl font-bold text-white">64</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400">Blink Modules</span>
              <span className="text-2xl font-bold text-white">102</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-dark-700 rounded-xl">
              <span className="text-gray-400">Blink Endpoints</span>
              <span className="text-2xl font-bold text-white">194</span>
            </div>
          </div>

          {/* Valuation Target */}
          <div className="mt-6 p-4 bg-gold/10 rounded-xl border border-gold/30">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gold font-semibold">$18M Target</span>
              <span className="text-gold">22%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-3">
              <div className="bg-gold h-3 rounded-full" style={{ width: '22%' }}></div>
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div className="flex items-center gap-3 mb-6">
            <Activity className="w-6 h-6 text-gold" />
            <h2 className="text-xl font-semibold text-white">Activity Feed</h2>
          </div>
          
          <div className="space-y-3">
            <div className="p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>👔</span>
                <span className="text-white font-medium">Prime</span>
                <span className="text-gray-500 text-sm ml-auto">8:09 AM</span>
              </div>
              <p className="text-gray-400 text-sm">Morning briefing delivered</p>
            </div>
            
            <div className="p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>⚡</span>
                <span className="text-white font-medium">Flint-SlabTrack</span>
                <span className="text-gray-500 text-sm ml-auto">8:10 AM</span>
              </div>
              <p className="text-gray-400 text-sm">Priority assessment completed</p>
            </div>

            <div className="p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>🏛️</span>
                <span className="text-white font-medium">Boardroom</span>
                <span className="text-gray-500 text-sm ml-auto">--:--</span>
              </div>
              <p className="text-gray-400 text-sm">Awaiting next session</p>
            </div>

            <div className="p-4 bg-dark-700 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span>🔨</span>
                <span className="text-white font-medium">Ralph</span>
                <span className="text-gray-500 text-sm ml-auto">--:--</span>
              </div>
              <p className="text-gray-400 text-sm">Idle - Awaiting PRD</p>
            </div>
          </div>
        </div>

        {/* API Usage & Ralph Status */}
        <div className="space-y-8">
          {/* API Usage */}
          <div className="bg-dark-800 rounded-2xl p-6 border border-dark-600">
            <div className="flex items-center gap-3 mb-6">
              <DollarSign className="w-6 h-6 text-gold" />
              <h2 className="text-xl font-semibold text-white">API Usage Today</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-dark-700 rounded-xl text-center">
                <p className="text-3xl font-bold text-white">{todayTokens.toLocaleString()}</p>
                <p className="text-gray-400 text-sm">Tokens</p>
              </div>
              <div className="p-4 bg-dark-700 rounded-xl text-center">
                <p className="text-3xl font-bold text-gold">${todayCost.toFixed(3)}</p>
                <p className="text-gray-400 text-sm">Cost</p>
              </div>
            </div>
          </div>

          {/* Ralph Status */}
          <div className="bg-dark-800 rounded-2xl p-6 border border-dark-600">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-2xl">🔨</span>
              <h2 className="text-xl font-semibold text-white">Ralph Workers</h2>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-dark-700 rounded-xl">
                <div>
                  <p className="text-white font-medium">SlabTrack</p>
                  <p className="text-gray-400 text-sm">Awaiting PRD</p>
                </div>
                <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-sm">Idle</span>
              </div>
              
              <div className="flex items-center justify-between p-4 bg-dark-700 rounded-xl">
                <div>
                  <p className="text-white font-medium">Blink</p>
                  <p className="text-gray-400 text-sm">Awaiting PRD</p>
                </div>
                <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-sm">Idle</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-gray-500 text-sm">
        🔒 Secured with Tailscale VPN • BE1st Venture Studio • Target: $18M Valuation
      </div>
    </div>
  );
}

export default TVDashboard;