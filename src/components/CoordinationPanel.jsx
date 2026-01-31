import React, { useState, useEffect, useRef } from 'react';
import {
  Users, Play, Pause, X, Clock, DollarSign, MessageSquare,
  ChevronDown, ChevronRight, Settings, History, Zap, AlertCircle
} from 'lucide-react';

function CoordinationPanel({ token, socket }) {
  const [status, setStatus] = useState({ active: [], settings: {}, paused: false, activeCount: 0 });
  const [history, setHistory] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [triggerModal, setTriggerModal] = useState(false);
  const messagesEndRef = useRef(null);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
    fetchHistory();
  }, []);

  // Socket listeners for real-time updates
  useEffect(() => {
    if (!socket) return;

    const handleStarted = (data) => {
      console.log('[Coordination] Session started:', data);
      fetchStatus();
    };

    const handleMessage = (data) => {
      console.log('[Coordination] Message:', data);
      if (sessionDetails && data.sessionId === sessionDetails.session_id) {
        setSessionDetails(prev => ({
          ...prev,
          messages: [...(prev.messages || []), {
            from_agent: data.fromAgent,
            to_agent: data.toAgent,
            message_type: data.messageType,
            content: data.content,
            created_at: data.timestamp
          }]
        }));
      }
      fetchStatus();
    };

    const handleCompleted = (data) => {
      console.log('[Coordination] Session completed:', data);
      fetchStatus();
      fetchHistory();
      if (sessionDetails && data.sessionId === sessionDetails.session_id) {
        fetchSessionDetails(data.sessionId);
      }
    };

    const handleCancelled = (data) => {
      console.log('[Coordination] Session cancelled:', data);
      fetchStatus();
      fetchHistory();
    };

    const handlePaused = () => {
      setStatus(prev => ({ ...prev, paused: true }));
    };

    const handleResumed = () => {
      setStatus(prev => ({ ...prev, paused: false }));
    };

    socket.on('coordination_started', handleStarted);
    socket.on('coordination_message', handleMessage);
    socket.on('coordination_completed', handleCompleted);
    socket.on('coordination_cancelled', handleCancelled);
    socket.on('coordination_paused', handlePaused);
    socket.on('coordination_resumed', handleResumed);

    return () => {
      socket.off('coordination_started', handleStarted);
      socket.off('coordination_message', handleMessage);
      socket.off('coordination_completed', handleCompleted);
      socket.off('coordination_cancelled', handleCancelled);
      socket.off('coordination_paused', handlePaused);
      socket.off('coordination_resumed', handleResumed);
    };
  }, [socket, sessionDetails]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionDetails?.messages]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/coordination/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setStatus(data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch coordination status:', err);
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/coordination/history?limit=10', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error('Failed to fetch coordination history:', err);
    }
  };

  const fetchSessionDetails = async (sessionId) => {
    try {
      const res = await fetch(`/api/coordination/session/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setSessionDetails(data);
      setSelectedSession(sessionId);
    } catch (err) {
      console.error('Failed to fetch session details:', err);
    }
  };

  const togglePause = async () => {
    const endpoint = status.paused ? '/api/coordination/resume' : '/api/coordination/pause';
    await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchStatus();
  };

  const cancelSession = async (sessionId) => {
    await fetch(`/api/coordination/session/${sessionId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled by user' })
    });
    fetchStatus();
    fetchHistory();
    if (selectedSession === sessionId) {
      setSelectedSession(null);
      setSessionDetails(null);
    }
  };

  const getAgentIcon = (agentId) => {
    if (agentId === 'prime') return '👔';
    if (agentId?.includes('flint')) return '🔧';
    if (agentId === 'scout') return '🔍';
    if (agentId === 'supplier') return '📦';
    if (agentId === 'ralph') return '🔨';
    if (agentId === 'critic') return '⚖️';
    return '🤖';
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'task_delegation': return 'bg-blue-500';
      case 'team_meeting': return 'bg-purple-500';
      case 'handoff': return 'bg-orange-500';
      case 'consultation': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-400">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        <p className="mt-2 text-sm">Loading coordination...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-400" />
          <span className="font-semibold">Agent Coordination</span>
          {status.activeCount > 0 && (
            <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
              {status.activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded hover:bg-gray-700"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={togglePause}
            className={`p-1.5 rounded ${status.paused ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
            title={status.paused ? 'Resume Coordination' : 'Pause Coordination'}
          >
            {status.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Pause Warning */}
      {status.paused && (
        <div className="bg-yellow-900/50 border-b border-yellow-700 px-3 py-2 flex items-center gap-2 text-yellow-300 text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>Coordination is paused. Click resume to allow agent communication.</span>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-800 border-b border-gray-700 p-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Max messages per session:</span>
            <span className="text-white">{status.settings.max_messages_per_session || 20}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Max concurrent sessions:</span>
            <span className="text-white">{status.settings.max_concurrent_sessions || 3}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Max cost per session:</span>
            <span className="text-white">${status.settings.max_cost_per_session || '1.00'}</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {/* Active Sessions */}
        {status.active.length > 0 && (
          <div className="p-3 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4 text-green-400" />
              Active Sessions
            </h3>
            <div className="space-y-2">
              {status.active.map(session => (
                <div
                  key={session.session_id}
                  className={`bg-gray-800 rounded-lg p-3 cursor-pointer transition-colors ${
                    selectedSession === session.session_id ? 'ring-2 ring-blue-500' : 'hover:bg-gray-750'
                  }`}
                  onClick={() => fetchSessionDetails(session.session_id)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getTypeColor(session.type)}`}></span>
                      <span className="font-medium text-sm capitalize">{session.type.replace('_', ' ')}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelSession(session.session_id); }}
                      className="p-1 rounded hover:bg-red-600/50 text-red-400"
                      title="Cancel Session"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{session.objective}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />
                      {session.message_count}/{session.max_messages}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      ${(session.total_cost || 0).toFixed(4)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(session.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    {JSON.parse(session.participants).map(p => (
                      <span key={p} className="text-lg" title={p}>{getAgentIcon(p)}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Session Details / Messages */}
        {sessionDetails && (
          <div className="p-3 border-b border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-400">Session Messages</h3>
              <button
                onClick={() => { setSelectedSession(null); setSessionDetails(null); }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {sessionDetails.messages?.map((msg, i) => (
                <div key={i} className="bg-gray-800 rounded p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{getAgentIcon(msg.from_agent)}</span>
                    <span className="font-medium text-sm text-blue-400">{msg.from_agent}</span>
                    {msg.to_agent && (
                      <>
                        <span className="text-gray-500">→</span>
                        <span className="text-sm text-gray-400">{msg.to_agent}</span>
                      </>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      msg.message_type === 'request' ? 'bg-blue-600' :
                      msg.message_type === 'response' ? 'bg-green-600' :
                      msg.message_type === 'decision' ? 'bg-purple-600' :
                      'bg-gray-600'
                    }`}>
                      {msg.message_type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{msg.content}</p>
                  <div className="text-xs text-gray-500 mt-1">
                    {formatTime(msg.created_at)}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* History */}
        <div className="p-3">
          <h3 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
            <History className="w-4 h-4" />
            Recent Sessions
          </h3>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No coordination sessions yet</p>
          ) : (
            <div className="space-y-1">
              {history.map(session => (
                <div
                  key={session.session_id}
                  className="flex items-center justify-between py-2 px-2 rounded hover:bg-gray-800 cursor-pointer"
                  onClick={() => fetchSessionDetails(session.session_id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      session.status === 'completed' ? 'bg-green-500' :
                      session.status === 'cancelled' ? 'bg-red-500' :
                      'bg-yellow-500'
                    }`}></span>
                    <span className="text-sm capitalize">{session.type.replace('_', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{session.message_count} msgs</span>
                    <span>${(session.total_cost || 0).toFixed(4)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-3 border-t border-gray-700">
        <button
          onClick={() => setTriggerModal(true)}
          disabled={status.paused}
          className={`w-full py-2 rounded font-medium text-sm flex items-center justify-center gap-2 ${
            status.paused
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          <Zap className="w-4 h-4" />
          Trigger Coordination
        </button>
      </div>

      {/* Trigger Modal */}
      {triggerModal && (
        <TriggerModal
          token={token}
          onClose={() => setTriggerModal(false)}
          onTriggered={() => { setTriggerModal(false); fetchStatus(); }}
        />
      )}
    </div>
  );
}

function TriggerModal({ token, onClose, onTriggered }) {
  const [type, setType] = useState('task_delegation');
  const [objective, setObjective] = useState('');
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const agents = [
    { id: 'scout', name: 'Scout', icon: '🔍' },
    { id: 'supplier', name: 'Supplier', icon: '📦' },
    { id: 'flint-slabtrack', name: 'Flint-SlabTrack', icon: '🔧' },
    { id: 'flint-blink', name: 'Flint-Blink', icon: '🔧' },
    { id: 'flint-atlas', name: 'Flint-ATLAS', icon: '🔧' },
    { id: 'ads', name: 'Ads', icon: '📣' },
    { id: 'content', name: 'Content', icon: '✍️' },
    { id: 'support', name: 'Support', icon: '🎧' },
    { id: 'monitor', name: 'Monitor', icon: '📊' },
    { id: 'critic', name: 'Critic', icon: '⚖️' }
  ];

  const toggleParticipant = (id) => {
    setParticipants(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!objective.trim()) {
      setError('Please enter an objective');
      return;
    }
    if (participants.length === 0) {
      setError('Please select at least one participant');
      return;
    }
    if (type === 'handoff' && participants.length !== 2) {
      setError('Handoff requires exactly 2 participants');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/coordination/trigger', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ type, objective, participants })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to trigger coordination');
      }

      onTriggered();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-md p-4 m-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Trigger Coordination</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded p-2 mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Type Selection */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white"
            >
              <option value="task_delegation">Task Delegation</option>
              <option value="team_meeting">Team Meeting</option>
              <option value="handoff">Handoff</option>
            </select>
          </div>

          {/* Objective */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Objective</label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="What should the agents work on?"
              className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white h-20 resize-none"
            />
          </div>

          {/* Participants */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Participants ({participants.length} selected)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {agents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => toggleParticipant(agent.id)}
                  className={`flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${
                    participants.includes(agent.id)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <span>{agent.icon}</span>
                  <span>{agent.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Coordination'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CoordinationPanel;
