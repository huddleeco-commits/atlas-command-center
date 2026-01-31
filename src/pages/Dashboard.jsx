import React, { useState, useEffect, useRef } from 'react';
import {
  Send, LogOut, Zap, MessageSquare, Menu, X, Trash2, Users,
  DollarSign, ChevronDown, ChevronRight, BookOpen, ExternalLink,
  Calendar, Settings, Plus, Target, CheckCircle, Circle, AlertTriangle,
  Clock, Activity, TrendingUp, PlayCircle, FileText, Loader2, BarChart2, Wrench,
  Terminal, GitBranch, RefreshCw, Monitor
} from 'lucide-react';
import CostsPage from './CostsPage';
import TerminalPage from './TerminalPage';
import RalphVisualizer from '../components/RalphVisualizer';

// Central Time formatting helper
const formatCentralTime = (dateStr, options = {}) => {
  const defaultOptions = {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };
  return new Date(dateStr).toLocaleString('en-US', { ...defaultOptions, ...options });
};

const formatCentralDate = (dateStr) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

// ==================== MAIN DASHBOARD ====================
function Dashboard({ socket, token, onLogout, onSwitchToTV }) {
  // Core state
  const [agents, setAgents] = useState([]);
  const [categories, setCategories] = useState({});
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState({});
  const [usage, setUsage] = useState({ today: { tokens_in: 0, tokens_out: 0, cost: 0 }, total: { tokens_in: 0, tokens_out: 0, cost: 0 } });
  const [consulting, setConsulting] = useState(null);

  // UI state
  const [activeTab, setActiveTab] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [wikiPages, setWikiPages] = useState([]);
  const [showTownhall, setShowTownhall] = useState(false);
  const [townhallParticipants, setTownhallParticipants] = useState([]);
  const [wikiSaveNotification, setWikiSaveNotification] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [sentryErrors, setSentryErrors] = useState([]);
  const [showRalphVisualizer, setShowRalphVisualizer] = useState(false);

  // Git sync state
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncNotification, setSyncNotification] = useState(null);

  const messagesEndRef = useRef(null);

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ==================== DATA FETCHING ====================
  useEffect(() => {
    fetchAgents();
    fetchChats();
    fetchUsage();
    fetchWikiPages();
    fetchCalendarEvents();
    fetchRecentActivity();
    fetchSentryErrors();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!socket) return;

    socket.on('new_message', (message) => {
      if (message.chat_id === activeChat?.id) {
        // Mark as new (received live) - should be expanded by default
        const newMessage = { ...message, isNew: true };
        setMessages(prev => [...prev, newMessage]);
        setConsulting(null);
      }
      fetchChats();
      fetchRecentActivity();
    });

    socket.on('agent_typing', ({ chat_id, agent_id, typing: isTyping }) => {
      if (chat_id === activeChat?.id) {
        setTyping(prev => ({ ...prev, [agent_id]: isTyping }));
      }
    });

    socket.on('usage_update', () => fetchUsage());

    socket.on('agent_consulting', ({ chat_id, consulting: consultingAgent }) => {
      if (chat_id === activeChat?.id) setConsulting(consultingAgent);
    });

    socket.on('wiki_saved', ({ title, path, agent }) => {
      setWikiSaveNotification({ title, path, agent });
      fetchWikiPages();
      setTimeout(() => setWikiSaveNotification(null), 5000);
    });

    // Auto-open Ralph visualizer when task dispatched or starts
    socket.on('ralph:dispatched', () => {
      setShowRalphVisualizer(true);
    });

    socket.on('ralph:start', () => {
      setShowRalphVisualizer(true);
    });

    socket.on('ralph:no_worker', () => {
      setShowRalphVisualizer(true);
    });

    socket.on('calendar_event_created', ({ title, event_date }) => {
      console.log(`[Calendar] Event created: "${title}" on ${event_date}`);
      fetchCalendarEvents();
    });

    return () => {
      socket.off('new_message');
      socket.off('agent_typing');
      socket.off('usage_update');
      socket.off('agent_consulting');
      socket.off('wiki_saved');
      socket.off('calendar_event_created');
      socket.off('ralph:dispatched');
      socket.off('ralph:start');
      socket.off('ralph:no_worker');
    };
  }, [socket, activeChat]);

  const fetchAgents = async () => {
    const res = await fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    // Deduplicate agents by id
    const uniqueAgents = (data.agents || []).filter((agent, index, self) =>
      index === self.findIndex(a => a.id === agent.id)
    );
    setAgents(uniqueAgents);
    setCategories(data.categories || {});
    const defaultParticipants = uniqueAgents
      .filter(a => a.id === 'prime' || a.category === 'advisors')
      .map(a => a.id);
    setTownhallParticipants(defaultParticipants);
  };

  const fetchChats = async () => {
    const res = await fetch('/api/chats', { headers: { Authorization: `Bearer ${token}` } });
    setChats(await res.json());
  };

  const fetchMessages = async (chatId) => {
    const res = await fetch(`/api/chats/${chatId}/messages`, { headers: { Authorization: `Bearer ${token}` } });
    const loadedMessages = await res.json();
    // Mark all loaded messages as historical (not new) - should be condensed by default
    setMessages(loadedMessages.map(msg => ({ ...msg, isNew: false })));
  };

  const fetchUsage = async () => {
    const res = await fetch('/api/usage', { headers: { Authorization: `Bearer ${token}` } });
    setUsage(await res.json());
  };

  const fetchWikiPages = async () => {
    try {
      const res = await fetch('/api/wiki/recent', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setWikiPages((await res.json()).pages || []);
    } catch (err) { console.error('Failed to fetch wiki pages:', err); }
  };

  const fetchCalendarEvents = async () => {
    try {
      const res = await fetch('/api/calendar', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setCalendarEvents(await res.json());
    } catch (err) { console.error('Failed to fetch calendar:', err); }
  };

  const fetchRecentActivity = async () => {
    try {
      const res = await fetch('/api/activity', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setRecentActivity(await res.json());
    } catch (err) { console.error('Failed to fetch activity:', err); }
  };

  const fetchSentryErrors = async () => {
    try {
      const res = await fetch('/api/sentry/errors', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setSentryErrors(await res.json());
    } catch (err) { /* Sentry may not be configured */ }
  };

  // ==================== GIT SYNC ====================
  const checkSyncStatus = async () => {
    try {
      const res = await fetch('/api/git/sync/status', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const status = await res.json();
        setSyncStatus(status);
        return status;
      }
    } catch (err) { console.error('Failed to check sync status:', err); }
    return null;
  };

  const performSync = async (showNotification = true) => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/git/sync', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const result = await res.json();
        setSyncResult(result);
        setSyncStatus({ lastSync: result.currentSync, lastCommitsFound: result.totalCommits, needsSync: false });

        if (showNotification && result.totalCommits > 0) {
          setSyncNotification({
            message: `Found ${result.totalCommits} new commits`,
            details: Object.entries(result.projects)
              .filter(([_, data]) => data.count > 0)
              .map(([project, data]) => `${project}: ${data.count}`)
              .join(', ')
          });
          setTimeout(() => setSyncNotification(null), 5000);
        }

        // Refresh activity feed to show git activity
        fetchRecentActivity();
        return result;
      }
    } catch (err) {
      console.error('Failed to sync:', err);
      setSyncNotification({ message: 'Sync failed', details: err.message, isError: true });
      setTimeout(() => setSyncNotification(null), 5000);
    } finally {
      setIsSyncing(false);
    }
    return null;
  };

  // Auto-sync on dashboard load if needed
  useEffect(() => {
    const autoSync = async () => {
      const status = await checkSyncStatus();
      if (status?.needsSync) {
        console.log('[GitSync] Auto-syncing (last sync > 1 hour ago)');
        performSync(true);
      }
    };
    autoSync();
  }, []);

  // ==================== ACTIONS ====================
  const startNewChat = async (agentId) => {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ agent_id: agentId })
    });
    const chat = await res.json();
    setChats(prev => [chat, ...prev]);
    selectChat(chat);
    setSidebarOpen(false);
    setActiveTab('chat');
  };

  const startTownhallChat = async () => {
    if (townhallParticipants.length === 0) return;
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ agent_id: 'townhall', participants: townhallParticipants })
    });
    const chat = await res.json();
    setChats(prev => [chat, ...prev]);
    selectChat(chat);
    setShowTownhall(false);
    setSidebarOpen(false);
    setActiveTab('chat');
  };

  const selectChat = (chat) => {
    setActiveChat(chat);
    setMessages([]);
    fetchMessages(chat.id);
    setActiveTab('chat');
  };

  const deleteChat = async (e, chatId) => {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    await fetch(`/api/chats/${chatId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (activeChat?.id === chatId) { setActiveChat(null); setMessages([]); }
  };

  const sendMessage = () => {
    if (!input.trim() || !activeChat || !socket) return;

    // Mark all previous messages as historical (condense them) when sending new message
    setMessages(prev => prev.map(msg => ({ ...msg, isNew: false })));

    socket.emit('send_message', {
      chat_id: activeChat.id,
      agent_id: activeChat.agent_id,
      content: input.trim(),
      participants: activeChat.participants
    });
    setInput('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const askPrimeForBriefing = async () => {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ agent_id: 'prime' })
    });
    const chat = await res.json();
    setChats(prev => [chat, ...prev]);
    setActiveChat(chat);
    setMessages([]);
    setActiveTab('chat');
    setSidebarOpen(false);

    // Send briefing request after a short delay
    setTimeout(() => {
      if (socket) {
        socket.emit('send_message', {
          chat_id: chat.id,
          agent_id: 'prime',
          content: 'Give me a quick morning briefing. What should I focus on today?'
        });
      }
    }, 300);
  };

  // ==================== HELPERS ====================
  const toggleCategory = (catId) => setCollapsedCategories(prev => ({ ...prev, [catId]: !prev[catId] }));
  const toggleParticipant = (id) => setTownhallParticipants(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const getAgent = (id) => agents.find(a => a.id === id);
  const activeChatAgent = activeChat ? getAgent(activeChat.agent_id) : null;

  const agentsByCategory = agents.reduce((acc, agent) => {
    const cat = agent.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(agent);
    return acc;
  }, {});

  const sortedCategories = Object.entries(categories).sort(([, a], [, b]) => (a.order || 99) - (b.order || 99));

  // Get recent decisions from Wiki
  const recentDecisions = wikiPages
    .filter(p => p.path?.includes('decision') || p.title?.toLowerCase().includes('decision') || p.title?.toLowerCase().includes('approved'))
    .slice(0, 3);

  // Get agent's last activity
  const getAgentLastActivity = (agentId) => {
    const activity = recentActivity.find(a => a.agent === agentId);
    if (!activity) return null;
    const mins = Math.floor((Date.now() - new Date(activity.timestamp).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // ==================== RENDER ====================
  return (
    <div className="h-screen bg-dark-900 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="h-14 bg-dark-800 border-b border-dark-600 flex items-center px-4 shrink-0">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-dark-700 rounded-lg lg:hidden mr-2">
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mr-6">
          <Zap className="w-6 h-6 text-gold" />
          <span className="font-bold text-lg hidden sm:block">ATLAS</span>
        </div>

        {/* Desktop Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1">
          {[
            { id: 'home', icon: Target, label: 'Home' },
            { id: 'chat', icon: MessageSquare, label: 'Chats' },
            { id: 'terminal', icon: Terminal, label: 'Terminal' },
            { id: 'calendar', icon: Calendar, label: 'Calendar' },
            { id: 'wiki', icon: BookOpen, label: 'Wiki' },
            { id: 'costs', icon: DollarSign, label: 'Costs' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); if (tab.id !== 'chat') setActiveChat(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                activeTab === tab.id ? 'bg-gold/20 text-gold' : 'text-gray-400 hover:text-white hover:bg-dark-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="text-sm font-medium">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Centered: TV Dashboard Toggle */}
        {onSwitchToTV && (
          <div className="flex-1 flex justify-center">
            <button
              onClick={onSwitchToTV}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-black rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Monitor className="w-4 h-4" />
              TV Dashboard
            </button>
          </div>
        )}

        {/* Usage, Sync & Logout */}
        <div className="flex items-center gap-3 ml-auto">
          <div className="hidden sm:flex items-center gap-2 text-sm text-gray-400">
            <span className="text-gold font-medium">${usage.today?.cost?.toFixed(4) || '0.00'}</span>
            <span>today</span>
          </div>

          {/* Git Sync Button */}
          <button
            onClick={() => performSync(true)}
            disabled={isSyncing}
            className={`p-2 rounded-lg transition-colors relative group ${
              isSyncing ? 'bg-dark-600' : 'hover:bg-dark-700'
            }`}
            title={syncStatus?.lastSync ? `Last sync: ${new Date(syncStatus.lastSync).toLocaleString()}` : 'Sync all projects'}
          >
            <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin text-blue-400' : 'text-gray-400 group-hover:text-blue-400'}`} />
            {syncStatus?.needsSync && !isSyncing && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />
            )}
          </button>

          {/* Sync Details Button */}
          {syncResult && syncResult.totalCommits > 0 && (
            <button
              onClick={() => setShowSyncModal(true)}
              className="hidden sm:flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded-lg text-xs hover:bg-blue-500/30 transition-colors"
            >
              <GitBranch className="w-3 h-3" />
              {syncResult.totalCommits} commits
            </button>
          )}

          <button onClick={onLogout} className="p-2 hover:bg-dark-700 rounded-lg" title="Logout">
            <LogOut className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </header>

      {/* Sync Notification Toast */}
      {syncNotification && (
        <div className={`fixed top-16 right-4 z-50 p-4 rounded-xl shadow-xl animate-slide-in ${
          syncNotification.isError ? 'bg-red-900/90 border border-red-700' : 'bg-dark-800/95 border border-blue-500/30'
        }`}>
          <div className="flex items-center gap-3">
            <GitBranch className={`w-5 h-5 ${syncNotification.isError ? 'text-red-400' : 'text-blue-400'}`} />
            <div>
              <p className="font-medium text-sm">{syncNotification.message}</p>
              {syncNotification.details && (
                <p className="text-xs text-gray-400 mt-0.5">{syncNotification.details}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Details Modal */}
      {showSyncModal && syncResult && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowSyncModal(false)}>
          <div className="bg-dark-800 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-dark-600 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-blue-400" />
                Git Sync Summary
              </h2>
              <button onClick={() => setShowSyncModal(false)} className="p-1 hover:bg-dark-700 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-gray-400 mb-4">
                Synced at {new Date(syncResult.currentSync).toLocaleString()} -
                {syncResult.lastSync ? ` Changes since ${new Date(syncResult.lastSync).toLocaleString()}` : ' First sync'}
              </p>

              {Object.entries(syncResult.projects).map(([project, data]) => (
                <div key={project} className="mb-6">
                  <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      project === 'slabtrack' ? 'bg-blue-400' :
                      project === 'blink' ? 'bg-purple-400' : 'bg-green-400'
                    }`} />
                    {project.charAt(0).toUpperCase() + project.slice(1)}
                    <span className="text-sm font-normal text-gray-400">({data.count || 0} commits)</span>
                  </h3>

                  {data.commits && data.commits.length > 0 ? (
                    <div className="space-y-2">
                      {data.commits.map((commit, i) => (
                        <div key={i} className="flex items-start gap-3 p-2 bg-dark-700/50 rounded-lg">
                          <code className="text-xs font-mono text-blue-400 shrink-0">{commit.hash}</code>
                          <p className="text-sm flex-1">{commit.message}</p>
                          <span className="text-xs text-gray-500 shrink-0">{commit.relative}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No new commits</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar Overlay (Mobile) */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar - Agents Only */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-30 w-72 bg-dark-800 border-r border-dark-600
          flex flex-col transform transition-transform lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="p-4 border-b border-dark-600 flex items-center justify-between lg:hidden">
            <span className="font-bold">Agents</span>
            <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-dark-700 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Townhall Button */}
          <div className="p-4">
            <button
              onClick={() => setShowTownhall(true)}
              className="w-full p-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 rounded-xl flex items-center justify-center gap-2 font-medium transition-all shadow-lg"
            >
              <Users className="w-5 h-5" />
              <span>Townhall Meeting</span>
            </button>
          </div>

          {/* Agent Categories */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
            {sortedCategories.map(([catId, catInfo]) => {
              const catAgents = agentsByCategory[catId] || [];
              if (catAgents.length === 0) return null;
              const isCollapsed = collapsedCategories[catId];

              return (
                <div key={catId} className="rounded-xl overflow-hidden bg-dark-700/30">
                  <button
                    onClick={() => toggleCategory(catId)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-dark-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{catInfo.icon}</span>
                      <span className="font-medium" style={{ color: catInfo.color }}>{catInfo.name}</span>
                      <span className="text-xs text-gray-500 bg-dark-600 px-2 py-0.5 rounded-full">{catAgents.length}</span>
                    </div>
                    {isCollapsed ? <ChevronRight className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>

                  {!isCollapsed && (
                    <div className="px-2 pb-2 space-y-1">
                      {catAgents.map(agent => {
                        const lastActivity = getAgentLastActivity(agent.id);
                        return (
                          <button
                            key={agent.id}
                            onClick={() => startNewChat(agent.id)}
                            className="w-full p-3 rounded-lg bg-dark-600/50 hover:bg-dark-600 transition-colors text-left flex items-center gap-3 group"
                          >
                            <span className="text-2xl">{agent.icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-white truncate">{agent.name}</p>
                              <p className="text-xs text-gray-500 truncate">
                                {lastActivity ? `Active ${lastActivity}` : agent.role}
                              </p>
                            </div>
                            <Plus className="w-4 h-4 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-dark-900">
          {/* HOME TAB */}
          {activeTab === 'home' && (
            <HomeView
              atlasProgress={atlasProgress}
              recentDecisions={recentDecisions}
              sentryErrors={sentryErrors}
              calendarEvents={calendarEvents}
              onAskPrime={askPrimeForBriefing}
              onStartTownhall={() => setShowTownhall(true)}
              onViewWiki={() => setActiveTab('wiki')}
              onStartChat={startNewChat}
            />
          )}

          {/* CHAT TAB */}
          {activeTab === 'chat' && (
            activeChat ? (
              <ChatView
                chat={activeChat}
                agent={activeChatAgent}
                agents={agents}
                messages={messages}
                typing={typing}
                consulting={consulting}
                input={input}
                setInput={setInput}
                sendMessage={sendMessage}
                handleKeyPress={handleKeyPress}
                messagesEndRef={messagesEndRef}
                wikiSaveNotification={wikiSaveNotification}
                onBack={() => setActiveChat(null)}
              />
            ) : (
              <ChatsListView
                chats={chats}
                agents={agents}
                onSelectChat={selectChat}
                onDeleteChat={deleteChat}
                onNewChat={() => setSidebarOpen(true)}
              />
            )
          )}

          {/* CALENDAR TAB */}
          {activeTab === 'calendar' && (
            <CalendarView events={calendarEvents} token={token} onRefresh={fetchCalendarEvents} />
          )}

          {/* WIKI TAB */}
          {activeTab === 'wiki' && (
            <WikiView pages={wikiPages} onRefresh={fetchWikiPages} token={token} />
          )}

          {/* TERMINAL TAB */}
          {activeTab === 'terminal' && (
            <TerminalPage socket={socket} />
          )}

          {/* COSTS TAB */}
          {activeTab === 'costs' && (
            <CostsPage token={token} onBack={() => setActiveTab('home')} embedded />
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden h-16 bg-dark-800 border-t border-dark-600 flex items-center justify-around shrink-0 safe-area-bottom">
        {[
          { id: 'home', icon: Target, label: 'Home' },
          { id: 'chat', icon: MessageSquare, label: 'Chats' },
          { id: 'terminal', icon: Terminal, label: 'Term' },
          { id: 'calendar', icon: Calendar, label: 'Cal' },
          { id: 'wiki', icon: BookOpen, label: 'Wiki' },
          { id: 'costs', icon: DollarSign, label: 'Costs' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); if (tab.id !== 'chat') setActiveChat(null); }}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
              activeTab === tab.id ? 'text-gold' : 'text-gray-500'
            }`}
          >
            <tab.icon className="w-5 h-5" />
            <span className="text-xs">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Townhall Modal */}
      {showTownhall && (
        <TownhallModal
          agents={agents}
          categories={categories}
          agentsByCategory={agentsByCategory}
          sortedCategories={sortedCategories}
          participants={townhallParticipants}
          onToggle={toggleParticipant}
          onSelectAll={() => setTownhallParticipants(agents.map(a => a.id))}
          onDeselectAll={() => setTownhallParticipants([])}
          onStart={startTownhallChat}
          onClose={() => setShowTownhall(false)}
        />
      )}

      {/* Ralph Visualizer */}
      <RalphVisualizer
        socket={socket}
        isOpen={showRalphVisualizer}
        onClose={() => setShowRalphVisualizer(false)}
        onMinimize={(minimized) => console.log('Ralph minimized:', minimized)}
      />
    </div>
  );
}

// ==================== HOME VIEW ====================
function HomeView({ atlasProgress, recentDecisions, sentryErrors, calendarEvents, onAskPrime, onStartTownhall, onViewWiki, onStartChat }) {
  const progressPercent = (atlasProgress.day / atlasProgress.totalDays) * 100;
  const completedMilestones = atlasProgress.milestones.filter(m => m.done).length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, Founder</h1>
            <p className="text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={onAskPrime}
            className="p-4 bg-gradient-to-br from-gold/20 to-gold/5 border border-gold/30 rounded-xl hover:border-gold/50 transition-all text-left"
          >
            <div className="w-10 h-10 bg-gold/20 rounded-lg flex items-center justify-center mb-3">
              <span className="text-xl">👔</span>
            </div>
            <p className="font-medium">Ask Prime</p>
            <p className="text-xs text-gray-400">Get a briefing</p>
          </button>

          <button
            onClick={onStartTownhall}
            className="p-4 bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-amber-500/30 rounded-xl hover:border-amber-500/50 transition-all text-left"
          >
            <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center mb-3">
              <Users className="w-5 h-5 text-amber-400" />
            </div>
            <p className="font-medium">Townhall</p>
            <p className="text-xs text-gray-400">Team meeting</p>
          </button>

          <button
            onClick={onViewWiki}
            className="p-4 bg-gradient-to-br from-blue-500/20 to-blue-500/5 border border-blue-500/30 rounded-xl hover:border-blue-500/50 transition-all text-left"
          >
            <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5 text-blue-400" />
            </div>
            <p className="font-medium">Wiki</p>
            <p className="text-xs text-gray-400">View decisions</p>
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* ATLAS Progress Tracker */}
          <div className="bg-dark-800 rounded-xl p-5 border border-dark-600">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Target className="w-5 h-5 text-gold" />
                ATLAS Proof of Concept
              </h2>
              <span className="text-sm text-gold font-medium">Day {atlasProgress.day}/{atlasProgress.totalDays}</span>
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="h-3 bg-dark-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-gold to-amber-400 rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>{completedMilestones}/{atlasProgress.milestones.length} milestones</span>
                <span>{Math.round(progressPercent)}% complete</span>
              </div>
            </div>

            {/* Milestones */}
            <div className="space-y-2">
              {atlasProgress.milestones.map(milestone => (
                <div key={milestone.id} className="flex items-center gap-3">
                  {milestone.done ? (
                    <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-gray-500 shrink-0" />
                  )}
                  <span className={milestone.done ? 'text-gray-400 line-through' : 'text-white'}>
                    {milestone.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Today's Priorities */}
          <div className="bg-dark-800 rounded-xl p-5 border border-dark-600">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-green-400" />
              Today's Priorities
            </h2>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-dark-700/50 rounded-lg">
                <span className="w-6 h-6 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center text-sm font-bold shrink-0">1</span>
                <div>
                  <p className="font-medium">Test Supplier agent</p>
                  <p className="text-xs text-gray-400">Validate dropship supplier research flow</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-dark-700/50 rounded-lg">
                <span className="w-6 h-6 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center text-sm font-bold shrink-0">2</span>
                <div>
                  <p className="font-medium">Scout market research</p>
                  <p className="text-xs text-gray-400">Run dropship niche analysis</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-dark-700/50 rounded-lg">
                <span className="w-6 h-6 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center text-sm font-bold shrink-0">3</span>
                <div>
                  <p className="font-medium">Review ATLAS architecture</p>
                  <p className="text-xs text-gray-400">Prep for Townhall discussion</p>
                </div>
              </div>
            </div>

            <button
              onClick={onAskPrime}
              className="w-full mt-4 p-2 text-sm text-gold hover:bg-gold/10 rounded-lg transition-colors"
            >
              Ask Prime to update priorities
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Recent Decisions */}
          <div className="bg-dark-800 rounded-xl p-5 border border-dark-600">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-blue-400" />
              Recent Decisions
            </h2>

            {recentDecisions.length === 0 ? (
              <p className="text-gray-500 text-sm">No recent decisions found</p>
            ) : (
              <div className="space-y-2">
                {recentDecisions.map((decision, i) => (
                  <a
                    key={i}
                    href={`http://100.117.103.53:3003/${decision.locale}/${decision.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-dark-700/50 hover:bg-dark-700 rounded-lg transition-colors"
                  >
                    <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                    <span className="flex-1 truncate">{decision.title}</span>
                    <ExternalLink className="w-4 h-4 text-gray-500" />
                  </a>
                ))}
              </div>
            )}

            <button
              onClick={onViewWiki}
              className="w-full mt-4 p-2 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
            >
              View all Wiki pages
            </button>
          </div>

          {/* Platform Health / Sentry Errors */}
          <div className="bg-dark-800 rounded-xl p-5 border border-dark-600">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-emerald-400" />
              Platform Health
            </h2>

            {sentryErrors.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-green-400 font-medium">All Systems Healthy</p>
                <p className="text-xs text-gray-500 mt-1">No errors in the last 24h</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sentryErrors.slice(0, 3).map((error, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-red-400 truncate">{error.title}</p>
                      <p className="text-xs text-gray-400">{error.project} - {error.count} occurrences</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Upcoming Events */}
            {calendarEvents.length > 0 && (
              <div className="mt-4 pt-4 border-t border-dark-600">
                <p className="text-xs text-gray-500 uppercase mb-2">Upcoming</p>
                {calendarEvents.slice(0, 2).map((event, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span>{event.title}</span>
                    <span className="text-gray-500">- {event.date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== CHAT VIEW ====================
function ChatView({ chat, agent, agents, messages, typing, consulting, input, setInput, sendMessage, handleKeyPress, messagesEndRef, wikiSaveNotification, onBack, token }) {
  const isTownhall = chat.agent_id === 'townhall';
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);

  // Check if this is a multi-agent chat (any response has multiple agents)
  const isMultiAgentChat = isTownhall || messages.some(msg =>
    msg.role === 'assistant' && (
      msg.content?.includes('**TOWNHALL MEETING RESPONSE**') ||
      (msg.content?.match(/\*\*[^\*]+\*\*\s*\([^)]+\):/g)?.length > 1)
    )
  );

  // Handle agent selection for follow-up
  const handleSelectAgent = (agentName) => {
    setSelectedAgents(prev =>
      prev.includes(agentName) ? prev.filter(a => a !== agentName) : [...prev, agentName]
    );
  };

  // Handle reply to specific agent
  const handleReply = (agentName) => {
    setReplyingTo(agentName);
    setInput(`@${agentName.toLowerCase().replace(/\s+/g, '-')}: `);
  };

  // Handle summarize request
  // Handle summarize all - sends entire discussion to Summarizer
  const handleSummarizeAll = async (fullContent) => {
    // Send directly to Summarizer (don't just populate input - actually send it)
    const summaryRequest = `@summarizer Please provide an executive summary of this discussion`;
    setInput(summaryRequest);
    // Trigger send after a brief delay to allow input update
    setTimeout(() => {
      sendMessage();
    }, 100);
  };

  // Handle save to wiki
  const handleSaveToWiki = async (response) => {
    try {
      const isSummarizer = response.name === 'Summarizer';
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      // Check if content has a suggested wiki path
      const wikiPathMatch = response.content?.match(/Save to Wiki:\s*(.+?)(?:\n|$)/i);
      let suggestedPath = wikiPathMatch ? wikiPathMatch[1].trim() : null;

      // Build title and category
      let title, category;
      if (isSummarizer) {
        // Summarizer: use summaries/[date]-[topic] format
        if (suggestedPath) {
          title = suggestedPath.split('/').pop() || `${today}-summary`;
        } else {
          title = `${today}-executive-summary`;
        }
        category = 'summaries';
      } else {
        // Other agents: use agent name and date
        title = `${response.name} - ${today}`;
        category = 'townhall';
      }

      // Clean content (remove "Save to Wiki:" line)
      let cleanContent = response.content;
      if (wikiPathMatch) {
        cleanContent = response.content.replace(/Save to Wiki:\s*.+?(?:\n|$)/gi, '').trim();
      }

      const wikiContent = `# ${response.name} (${response.role})\n\n${cleanContent}`;

      await fetch('/api/wiki/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          content: wikiContent,
          agentId: isSummarizer ? 'summarizer' : 'townhall',
          category
        })
      });
    } catch (err) {
      console.error('Failed to save to wiki:', err);
    }
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedAgents([]);
    setReplyingTo(null);
  };

  // Send to selected agents only
  const sendToSelected = () => {
    if (selectedAgents.length > 0 && input.trim()) {
      const prefix = selectedAgents.map(a => `@${a.toLowerCase().replace(/\s+/g, '-')}`).join(' ');
      const fullMessage = input.startsWith('@') ? input : `${prefix}: ${input}`;
      setInput(fullMessage);
      sendMessage();
      clearSelection();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-16 border-b border-dark-600 flex items-center px-4 shrink-0">
        <button onClick={onBack} className="p-2 hover:bg-dark-700 rounded-lg mr-3">
          <ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <span className="text-3xl mr-3">{isTownhall ? '🏛️' : agent?.icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-lg truncate">{isTownhall ? 'Townhall' : agent?.name}</h2>
          <p className="text-sm text-gray-400 truncate">
            {isTownhall ? `${(chat.participants || []).length} participants` : agent?.role}
          </p>
        </div>
      </div>

      {wikiSaveNotification && (
        <div className="bg-green-900/30 border-b border-green-800 px-4 py-2 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-green-400" />
          <span className="text-green-300 text-sm">Saved: <strong>{wikiSaveNotification.title}</strong></span>
          <a href={`http://100.117.103.53:3003/en/${wikiSaveNotification.path}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300 ml-auto flex items-center gap-1 text-sm">
            View <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Selected agents bar - shows for any multi-agent chat */}
      {isMultiAgentChat && selectedAgents.length > 0 && (
        <div className="bg-gold/10 border-b border-gold/30 px-4 py-2 flex items-center gap-3">
          <span className="text-sm text-gold">
            <strong>{selectedAgents.length}</strong> agent{selectedAgents.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-1">
            {selectedAgents.map(name => (
              <span key={name} className="px-2 py-0.5 bg-dark-700 rounded text-xs">{name}</span>
            ))}
          </div>
          <button onClick={clearSelection} className="text-xs text-gray-400 hover:text-white ml-auto">
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <span className="text-6xl mb-4 block">{isTownhall ? '🏛️' : agent?.icon}</span>
              <h3 className="text-xl font-semibold mb-2">
                {isTownhall ? 'Start a Townhall Meeting' : `Chat with ${agent?.name}`}
              </h3>
              <p className="text-gray-400">{isTownhall ? 'All selected agents will participate' : agent?.role}</p>
              {isTownhall && (
                <p className="text-xs text-gray-500 mt-2">Select agent panels to send follow-up to specific agents</p>
              )}
            </div>
          </div>
        ) : isMultiAgentChat ? (
          // Multi-agent chat - use question-based section layout with horizontal panels
          <>
            {groupMessagesIntoSections(messages).map((section, i, arr) => (
              <QuestionSection
                key={i}
                question={section.question}
                responses={section.responses}
                agents={agents}
                selectedAgents={selectedAgents}
                onSelectAgent={handleSelectAgent}
                onReply={handleReply}
                onSummarizeAll={handleSummarizeAll}
                onSaveToWiki={handleSaveToWiki}
                isLast={i === arr.length - 1}
              />
            ))}
            {/* Summarize All button at very end */}
            {messages.length > 2 && (
              <div className="flex justify-center pt-4 pb-2">
                <button
                  onClick={() => handleSummarizeAll(messages.filter(m => m.role === 'assistant').map(m => m.content).join('\n\n---\n\n'))}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 rounded-xl text-sm font-medium text-black transition-all shadow-lg shadow-amber-500/20"
                >
                  <span>📋</span> Summarize Entire Discussion
                </button>
              </div>
            )}

            {/* AI Handoff Section */}
            {messages.length > 0 && (
              <AIHandoffSection messages={messages} agents={agents} />
            )}
          </>
        ) : (
          // Single-agent chat - use regular bubble layout
          messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              agent={agent}
              isTownhall={false}
              agents={agents}
              selectedAgents={selectedAgents}
              onSelectAgent={handleSelectAgent}
              onReply={handleReply}
              onSummarizeAll={handleSummarizeAll}
              onSaveToWiki={handleSaveToWiki}
            />
          ))
        )}

        {(typing[chat.agent_id] || consulting) && (
          <div className="flex items-center gap-3 text-gray-400">
            <span className="text-xl">{isTownhall ? '🏛️' : agent?.icon}</span>
            <span className="text-sm">{consulting ? `Consulting ${consulting}...` : 'Typing...'}</span>
            <span className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-dark-600 shrink-0">
        {/* Reply indicator */}
        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 text-sm text-gray-400">
            <span>Replying to <strong className="text-white">{replyingTo}</strong></span>
            <button onClick={() => { setReplyingTo(null); setInput(''); }} className="text-xs text-red-400 hover:text-red-300">
              Cancel
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-end gap-3 bg-dark-700 rounded-xl p-2">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize textarea
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={selectedAgents.length > 0 ? `Message ${selectedAgents.length} selected agent(s)...` : "Type a message... (Shift+Enter for new line)"}
              className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none px-2 resize-none min-h-[40px] max-h-[200px] overflow-y-auto leading-relaxed"
              rows={1}
              style={{ height: 'auto' }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="p-2.5 bg-gold hover:bg-gold/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <Send className="w-5 h-5 text-black" />
            </button>
          </div>

          {/* Send to selected button - shows for any multi-agent chat */}
          {isMultiAgentChat && selectedAgents.length > 0 && (
            <button
              onClick={sendToSelected}
              disabled={!input.trim()}
              className="px-3 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium whitespace-nowrap shrink-0"
            >
              Send to {selectedAgents.length}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== DATA VISUALIZATION COMPONENTS ====================

// Bar Chart - for comparisons
function BarChartViz({ data, title }) {
  if (!data || data.length === 0) return null;
  const maxValue = Math.max(...data.map(d => d.value));

  return (
    <div className="bg-dark-600/50 rounded-lg p-3 my-2">
      {title && <h4 className="text-xs font-medium text-gray-400 mb-2">{title}</h4>}
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-24 truncate">{item.label}</span>
            <div className="flex-1 h-5 bg-dark-800 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-gold to-amber-500 rounded transition-all duration-500"
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium text-gold w-12 text-right">
              {typeof item.value === 'number' && item.value < 1 ? `${(item.value * 100).toFixed(0)}%` : item.display || item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Progress Bar - for sprint/goal tracking
function ProgressViz({ current, total, label, sublabel }) {
  const percentage = Math.min(100, Math.round((current / total) * 100));

  return (
    <div className="bg-dark-600/50 rounded-lg p-3 my-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{label || `Day ${current} of ${total}`}</span>
        <span className="text-xs text-gold font-medium">{percentage}%</span>
      </div>
      <div className="h-3 bg-dark-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {sublabel && <p className="text-xs text-gray-400 mt-1">{sublabel}</p>}
    </div>
  );
}

// KPI Metrics Cards
function MetricsViz({ metrics }) {
  if (!metrics || metrics.length === 0) return null;

  const getMetricColor = (label) => {
    const l = label.toLowerCase();
    if (l.includes('mrr') || l.includes('revenue')) return 'text-green-400';
    if (l.includes('subscriber') || l.includes('user')) return 'text-blue-400';
    if (l.includes('arpu') || l.includes('avg')) return 'text-purple-400';
    if (l.includes('churn') || l.includes('cancel')) return 'text-red-400';
    if (l.includes('growth') || l.includes('increase')) return 'text-emerald-400';
    return 'text-gold';
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-2">
      {metrics.map((metric, i) => (
        <div key={i} className="bg-dark-600/50 rounded-lg p-3 text-center">
          <p className={`text-lg font-bold ${getMetricColor(metric.label)}`}>{metric.value}</p>
          <p className="text-xs text-gray-400">{metric.label}</p>
        </div>
      ))}
    </div>
  );
}

// Pie Chart (using CSS conic-gradient)
function PieChartViz({ data, title }) {
  if (!data || data.length === 0) return null;

  const colors = ['#EAB308', '#22C55E', '#3B82F6', '#A855F7', '#EF4444', '#06B6D4'];
  const total = data.reduce((sum, d) => sum + d.value, 0);

  let currentAngle = 0;
  const segments = data.map((d, i) => {
    const angle = (d.value / total) * 360;
    const segment = { ...d, startAngle: currentAngle, angle, color: colors[i % colors.length] };
    currentAngle += angle;
    return segment;
  });

  const gradient = segments.map(s => `${s.color} ${s.startAngle}deg ${s.startAngle + s.angle}deg`).join(', ');

  return (
    <div className="bg-dark-600/50 rounded-lg p-3 my-2">
      {title && <h4 className="text-xs font-medium text-gray-400 mb-2">{title}</h4>}
      <div className="flex items-center gap-4">
        <div
          className="w-20 h-20 rounded-full shrink-0"
          style={{ background: `conic-gradient(${gradient})` }}
        />
        <div className="flex-1 space-y-1">
          {segments.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-gray-300 flex-1 truncate">{s.label}</span>
              <span className="text-gray-400">{Math.round((s.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Timeline visualization
function TimelineViz({ events }) {
  if (!events || events.length === 0) return null;

  return (
    <div className="bg-dark-600/50 rounded-lg p-3 my-2">
      <div className="relative pl-4 border-l-2 border-gold/30 space-y-3">
        {events.map((event, i) => (
          <div key={i} className="relative">
            <div className="absolute -left-[21px] w-3 h-3 rounded-full bg-gold" />
            <p className="text-xs text-gold font-medium">{event.date}</p>
            <p className="text-sm text-gray-300">{event.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Parse message content for visualizations
function parseMessageForVisuals(content) {
  if (!content) return { text: content, visuals: [] };

  const visuals = [];
  let text = content;

  // Pattern 1: [CHART:BAR]...[/CHART]
  const barChartRegex = /\[CHART:BAR\]([^[]+)\[\/CHART\]/gi;
  let match;
  while ((match = barChartRegex.exec(content)) !== null) {
    const lines = match[1].trim().split('\n').filter(l => l.trim());
    const data = lines.map(line => {
      const parts = line.split(':').map(p => p.trim());
      if (parts.length >= 2) {
        const value = parseFloat(parts[1].replace(/[%$,]/g, '')) || 0;
        return { label: parts[0], value, display: parts[1] };
      }
      return null;
    }).filter(Boolean);

    if (data.length > 0) {
      visuals.push({ type: 'bar', data });
      text = text.replace(match[0], '');
    }
  }

  // Pattern 2: [CHART:PIE]...[/CHART]
  const pieChartRegex = /\[CHART:PIE\]([^[]+)\[\/CHART\]/gi;
  while ((match = pieChartRegex.exec(content)) !== null) {
    const lines = match[1].trim().split('\n').filter(l => l.trim());
    const data = lines.map(line => {
      const parts = line.split(':').map(p => p.trim());
      if (parts.length >= 2) {
        const value = parseFloat(parts[1].replace(/[%$,]/g, '')) || 0;
        return { label: parts[0], value };
      }
      return null;
    }).filter(Boolean);

    if (data.length > 0) {
      visuals.push({ type: 'pie', data });
      text = text.replace(match[0], '');
    }
  }

  // Pattern 3: [CHART:PROGRESS]...[/CHART]
  const progressRegex = /\[CHART:PROGRESS\]\s*(?:Day\s+)?(\d+)\s+(?:of|\/)\s+(\d+)(?:\s*[-–]\s*(.+?))?\s*\[\/CHART\]/gi;
  while ((match = progressRegex.exec(content)) !== null) {
    visuals.push({
      type: 'progress',
      current: parseInt(match[1]),
      total: parseInt(match[2]),
      label: `Day ${match[1]} of ${match[2]}`,
      sublabel: match[3]?.trim()
    });
    text = text.replace(match[0], '');
  }

  // Pattern 4: [METRICS]...[/METRICS]
  const metricsRegex = /\[METRICS\]([^[]+)\[\/METRICS\]/gi;
  while ((match = metricsRegex.exec(content)) !== null) {
    const lines = match[1].trim().split('\n').filter(l => l.trim());
    const metrics = lines.map(line => {
      const parts = line.split(':').map(p => p.trim());
      if (parts.length >= 2) {
        return { label: parts[0], value: parts[1] };
      }
      return null;
    }).filter(Boolean);

    if (metrics.length > 0) {
      visuals.push({ type: 'metrics', metrics });
      text = text.replace(match[0], '');
    }
  }

  // Pattern 5: [TIMELINE]...[/TIMELINE]
  const timelineRegex = /\[TIMELINE\]([^[]+)\[\/TIMELINE\]/gi;
  while ((match = timelineRegex.exec(content)) !== null) {
    const lines = match[1].trim().split('\n').filter(l => l.trim());
    const events = lines.map(line => {
      const parts = line.split(/[-–:]/).map(p => p.trim());
      if (parts.length >= 2) {
        return { date: parts[0], title: parts.slice(1).join(' - ') };
      }
      return null;
    }).filter(Boolean);

    if (events.length > 0) {
      visuals.push({ type: 'timeline', events });
      text = text.replace(match[0], '');
    }
  }

  // Auto-detect: "Day X of Y" progress pattern in text
  const dayOfRegex = /Day (\d+) of (\d+)(?:\s*[-–]\s*(.+?))?(?:\.|,|\n|$)/i;
  const dayMatch = text.match(dayOfRegex);
  if (dayMatch && !visuals.some(v => v.type === 'progress')) {
    visuals.push({
      type: 'progress',
      current: parseInt(dayMatch[1]),
      total: parseInt(dayMatch[2]),
      label: `Day ${dayMatch[1]} of ${dayMatch[2]}`,
      sublabel: dayMatch[3]?.trim()
    });
  }

  // Auto-detect: Multiple "Label: $XX" or "Label: XX%" patterns (metrics)
  const metricPatterns = text.match(/(?:^|\n)\s*(?:\*\*)?([A-Za-z][A-Za-z\s]+)(?:\*\*)?:\s*(\$[\d,.]+|[\d,.]+%|[\d,.]+\s*(?:users?|subscribers?|customers?)?)/gim);
  if (metricPatterns && metricPatterns.length >= 2 && !visuals.some(v => v.type === 'metrics')) {
    const metrics = metricPatterns.slice(0, 6).map(m => {
      const parts = m.split(':').map(p => p.replace(/\*\*/g, '').trim());
      return { label: parts[0], value: parts[1] };
    });
    if (metrics.length >= 2) {
      visuals.push({ type: 'metrics', metrics });
    }
  }

  return { text: text.trim(), visuals };
}

// Render visuals
function MessageVisuals({ visuals }) {
  if (!visuals || visuals.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {visuals.map((visual, i) => {
        switch (visual.type) {
          case 'bar':
            return <BarChartViz key={i} data={visual.data} title={visual.title} />;
          case 'pie':
            return <PieChartViz key={i} data={visual.data} title={visual.title} />;
          case 'progress':
            return <ProgressViz key={i} current={visual.current} total={visual.total} label={visual.label} sublabel={visual.sublabel} />;
          case 'metrics':
            return <MetricsViz key={i} metrics={visual.metrics} />;
          case 'timeline':
            return <TimelineViz key={i} events={visual.events} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// ==================== MULTI-AGENT VERTICAL LAYOUT ====================

// Get LEFT BORDER color by agent category for easy scanning
function getAgentCategoryStyle(category) {
  // Color-coded LEFT BORDERS for easy visual scanning
  const styles = {
    leadership: { leftBorder: 'border-l-4 border-l-amber-500', bg: 'bg-dark-800/50', accent: 'text-amber-400' },
    advisors: { leftBorder: 'border-l-4 border-l-orange-500', bg: 'bg-dark-800/50', accent: 'text-orange-400' },
    revenue: { leftBorder: 'border-l-4 border-l-green-500', bg: 'bg-dark-800/50', accent: 'text-green-400' },
    operations: { leftBorder: 'border-l-4 border-l-blue-500', bg: 'bg-dark-800/50', accent: 'text-blue-400' },
    infrastructure: { leftBorder: 'border-l-4 border-l-purple-500', bg: 'bg-dark-800/50', accent: 'text-purple-400' }
  };
  return styles[category] || styles.operations;
}

// Parse Townhall response into individual agent responses with Prime as moderator
function parseTownhallResponse(content) {
  if (!content) return { responses: [], wrapUp: null, primeOpening: null };

  // Pattern: **👔 Prime** (Chief of Staff):
  const agentPattern = /\*\*([^\*]+)\*\*\s*\(([^)]+)\):\s*/g;
  const responses = [];

  const matches = [];
  let match;
  while ((match = agentPattern.exec(content)) !== null) {
    matches.push({ index: match.index, length: match[0].length, header: match[1].trim(), role: match[2].trim() });
  }

  let wrapUp = null;
  let primeOpening = null;

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = matches[i + 1]?.index || content.length;
    const responseText = content.slice(current.index + current.length, nextIndex).trim();

    // Parse icon and name from header (e.g., "👔 Prime")
    const iconMatch = current.header.match(/^(\S+)\s+(.+)$/);
    const icon = iconMatch ? iconMatch[1] : '🤖';
    const name = iconMatch ? iconMatch[2] : current.header;
    const contentLower = responseText.toLowerCase();

    // Check if this is Prime
    const isPrime = name === 'Prime';

    // Prime's OPENING (first Prime, calls on agents with @mentions)
    const isPrimeOpening = isPrime && i === 0 && matches.length > 1 &&
      (responseText.includes('@') || contentLower.includes('thoughts') || contentLower.includes('input') ||
       contentLower.includes('let me get') || contentLower.includes('team'));

    // Prime's WRAP-UP (last Prime, contains summary/recommendation keywords)
    const isPrimeWrapUp = isPrime && i === matches.length - 1 && matches.length > 1 &&
      (contentLower.includes('summary') || contentLower.includes('recommendation') ||
       contentLower.includes('wrap') || contentLower.includes('conclusion') ||
       contentLower.includes('next step') || contentLower.includes('action') ||
       contentLower.includes('proceed') || contentLower.includes('should we') ||
       contentLower.includes('founder'));

    if (isPrimeOpening) {
      primeOpening = { icon, name, role: current.role, content: responseText, type: 'opening' };
    } else if (isPrimeWrapUp) {
      wrapUp = { icon, name, role: current.role, content: responseText, type: 'wrapup' };
    } else {
      responses.push({
        icon,
        name,
        role: current.role,
        content: responseText,
        isPrime
      });
    }
  }

  return { responses, wrapUp, primeOpening };
}

// Group messages into question-response sections
function groupMessagesIntoSections(messages) {
  const sections = [];
  let currentSection = null;

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Start a new section with this user question
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        question: msg,
        responses: []
      };
    } else if (currentSection) {
      // Add assistant response to current section
      currentSection.responses.push(msg);
    } else {
      // Orphan response without a question - create section
      currentSection = {
        question: null,
        responses: [msg]
      };
    }
  }

  // Push final section
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

// Individual Agent Response Panel - VERTICAL layout with colored left border
function AgentResponsePanel({ response, agents, isSelected, onSelect, onReply, onSaveToWiki, timestamp, autoExpand = false }) {
  // autoExpand: true for new/live messages, false for historical messages
  const [expanded, setExpanded] = useState(autoExpand);

  // Find agent data for category styling
  const agentData = agents?.find(a => a.name === response.name || a.icon === response.icon);
  const categoryStyle = getAgentCategoryStyle(agentData?.category);

  // Get the FULL raw content - no parsing that might truncate
  const fullContent = response.content || '';

  // Parse content for visualizations
  const { text, visuals } = parseMessageForVisuals(fullContent);

  // Check if content is long (show first ~300 chars when collapsed)
  const COLLAPSED_LENGTH = 300;
  const isLong = fullContent.length > COLLAPSED_LENGTH;

  // When expanded, show 100% of the FULL content - absolutely no truncation
  const displayText = expanded ? fullContent : (isLong ? fullContent.slice(0, COLLAPSED_LENGTH) + '...' : fullContent);

  return (
    <div className={`rounded-r-lg ${categoryStyle.leftBorder} ${categoryStyle.bg} overflow-hidden transition-all ${isSelected ? 'ring-2 ring-gold' : ''}`}>
      {/* Header with agent info */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-dark-600/30">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(response.name)}
          className="w-4 h-4 rounded border-dark-500 bg-dark-700 text-gold focus:ring-gold cursor-pointer"
        />
        <span className="text-xl">{response.icon}</span>
        <div className="flex-1 min-w-0">
          <span className={`font-semibold text-sm ${categoryStyle.accent}`}>{response.name}</span>
          <span className="text-gray-500 text-xs ml-2">• {response.role}</span>
        </div>
        {timestamp && (
          <span className="text-xs text-gray-500">{timestamp}</span>
        )}
      </div>

      {/* Body - full width, no height limit when expanded */}
      <div className="px-4 py-3">
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{displayText}</div>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gold hover:text-gold/80 mt-3 font-medium block"
          >
            {expanded ? '▲ Show less' : '▼ Show more...'}
          </button>
        )}
        <MessageVisuals visuals={visuals} />
      </div>

      {/* Footer Actions */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-dark-600/30 bg-dark-900/30">
        <button
          onClick={() => onReply(response.name)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-dark-600 rounded-lg transition-colors"
        >
          <Send className="w-3 h-3" /> Reply
        </button>
        <button
          onClick={() => onSaveToWiki(response)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-dark-600 rounded-lg transition-colors"
        >
          <BookOpen className="w-3 h-3" /> Wiki
        </button>
      </div>
    </div>
  );
}

// Prime's Opening Panel - distinct gold styling with MODERATING label
function PrimeOpeningPanel({ response, timestamp, autoExpand = false }) {
  const [expanded, setExpanded] = useState(autoExpand);
  const fullContent = response.content || '';
  const COLLAPSED_LENGTH = 300;
  const isLong = fullContent.length > COLLAPSED_LENGTH;
  const displayText = expanded ? fullContent : (isLong ? fullContent.slice(0, COLLAPSED_LENGTH) + '...' : fullContent);

  return (
    <div className="rounded-r-lg border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-500/10 to-transparent">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-500/20">
        <span className="text-xl">{response.icon}</span>
        <div className="flex-1">
          <span className="font-semibold text-sm text-amber-400">{response.name}</span>
          <span className="text-gray-500 text-xs ml-2">• {response.role}</span>
        </div>
        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs font-medium rounded">MODERATING</span>
        {timestamp && <span className="text-xs text-gray-500">{timestamp}</span>}
      </div>
      <div className="px-4 py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{displayText}</p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-gold hover:text-gold/80 mt-2 font-medium block">
            {expanded ? '▲ Show less' : '▼ Show more...'}
          </button>
        )}
      </div>
    </div>
  );
}

// Prime's Wrap-Up Panel - gold background with RECOMMENDATION label
function PrimeWrapUpPanel({ response, autoExpand = false }) {
  const [expanded, setExpanded] = useState(autoExpand);
  const fullContent = response.content || '';
  const COLLAPSED_LENGTH = 400;
  const isLong = fullContent.length > COLLAPSED_LENGTH;
  const displayText = expanded ? fullContent : (isLong ? fullContent.slice(0, COLLAPSED_LENGTH) + '...' : fullContent);

  return (
    <div className="rounded-xl border-2 border-amber-500/50 bg-gradient-to-br from-amber-500/15 via-amber-500/10 to-transparent overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-500/30 bg-amber-500/10">
        <span className="text-xl">{response.icon}</span>
        <div className="flex-1">
          <span className="font-semibold text-sm text-amber-400">{response.name}</span>
          <span className="text-gray-400 text-xs ml-2">• {response.role}</span>
        </div>
        <span className="px-2 py-1 bg-amber-500 text-black text-xs font-bold rounded">📋 RECOMMENDATION</span>
      </div>
      <div className="px-4 py-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-100">{displayText}</p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-gold hover:text-gold/80 mt-3 font-medium block">
            {expanded ? '▲ Show less' : '▼ Show more...'}
          </button>
        )}
      </div>
    </div>
  );
}

// Multi-Agent Response Component - VERTICAL layout with Prime as moderator
function MultiAgentResponse({ message, agents, selectedAgents, onSelectAgent, onReply, onSummarizeAll, onSaveToWiki }) {
  // Check if this has agent headers (single or multiple)
  const agentHeaderMatches = message.content?.match(/\*\*[^\*]+\*\*\s*\([^)]+\):/g) || [];
  const hasAgentHeaders = agentHeaderMatches.length > 0;
  const isMultiAgent = message.content?.includes('**TOWNHALL MEETING RESPONSE**') || agentHeaderMatches.length > 1;

  // Auto-expand new (live) messages, condense historical messages
  const autoExpand = message.isNew === true;

  // If no agent headers at all, show as simple bubble (rare case)
  if (!hasAgentHeaders) {
    const { text, visuals } = parseMessageForVisuals(message.content);
    return (
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center shrink-0">
          <span className="text-xl">🏛️</span>
        </div>
        <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-dark-700 text-white">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
          <MessageVisuals visuals={visuals} />
          {message.tokens_used > 0 && (
            <p className="text-xs text-gray-500 mt-2">{message.tokens_used.toLocaleString()} tokens</p>
          )}
        </div>
      </div>
    );
  }

  const { responses, wrapUp, primeOpening } = parseTownhallResponse(message.content);
  const timestamp = message.created_at ? new Date(message.created_at).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }) : null;

  return (
    <div className="space-y-3">
      {/* Prime's Opening (if present) - MODERATING */}
      {primeOpening && (
        <PrimeOpeningPanel response={primeOpening} timestamp={timestamp} autoExpand={autoExpand} />
      )}

      {/* VERTICAL Agent Panels - stacked with colored left borders */}
      {responses.map((response, i) => (
        <AgentResponsePanel
          key={i}
          response={response}
          agents={agents}
          isSelected={selectedAgents?.includes(response.name)}
          onSelect={onSelectAgent}
          onReply={onReply}
          onSaveToWiki={onSaveToWiki}
          timestamp={!primeOpening && i === 0 ? timestamp : null}
          autoExpand={autoExpand}
        />
      ))}

      {/* Prime's Wrap-Up (if present) - RECOMMENDATION */}
      {wrapUp && (
        <PrimeWrapUpPanel response={wrapUp} autoExpand={autoExpand} />
      )}

      {/* Token count */}
      {message.tokens_used > 0 && (
        <div className="text-xs text-gray-500 text-right pr-2">
          {message.tokens_used.toLocaleString()} tokens total
        </div>
      )}
    </div>
  );
}

// Participants Sidebar Component
function ParticipantsSidebar({ participants, agents, respondedAgents }) {
  return (
    <div className="w-40 shrink-0 hidden lg:block">
      <div className="sticky top-4 rounded-lg border border-dark-500 bg-dark-800/50 p-3">
        <h4 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">Participants</h4>
        <div className="space-y-2">
          {participants.map((name, i) => {
            const agent = agents?.find(a => a.name === name);
            const hasResponded = respondedAgents.includes(name);
            const categoryStyle = getAgentCategoryStyle(agent?.category);
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm">{agent?.icon || '🤖'}</span>
                <span className={`text-xs truncate ${hasResponded ? categoryStyle.accent : 'text-gray-500'}`}>
                  {name}
                </span>
                {hasResponded && (
                  <CheckCircle className="w-3 h-3 text-green-500 ml-auto shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Question Section Component - groups user question with agent responses
function QuestionSection({ question, responses, agents, selectedAgents, onSelectAgent, onReply, onSummarizeAll, onSaveToWiki, isLast }) {
  // Get list of responding agents from the responses
  const getRespondingAgents = (content) => {
    if (!content) return [];
    const { responses: parsed, primeOpening, wrapUp } = parseTownhallResponse(content);
    const names = parsed.map(r => r.name);
    if (primeOpening) names.unshift(primeOpening.name);
    if (wrapUp) names.push(wrapUp.name);
    return names;
  };

  const allResponders = responses.flatMap(r => getRespondingAgents(r.content));
  const uniqueResponders = [...new Set(allResponders)];

  // Get all potential participants (agents that might respond)
  const potentialParticipants = ['Prime', ...uniqueResponders.filter(n => n !== 'Prime')];

  return (
    <div className="space-y-4">
      {/* User Question - Full Width */}
      {question && (
        <div className="rounded-xl border border-dark-500 bg-dark-800/50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-gold flex items-center justify-center shrink-0">
              <span className="text-black text-sm font-bold">👤</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gold text-sm">YOU</span>
                {question.created_at && (
                  <span className="text-xs text-gray-500">
                    {new Date(question.created_at).toLocaleTimeString('en-US', {
                      timeZone: 'America/Chicago',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">{question.content}</p>
              {uniqueResponders.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                  <span>Responding:</span>
                  <span className="text-gray-400">{uniqueResponders.join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main content with optional sidebar */}
      <div className="flex gap-4">
        {/* Agent Responses - vertical stack */}
        <div className="flex-1 space-y-3">
          {responses.map((msg, i) => (
            <MultiAgentResponse
              key={i}
              message={msg}
              agents={agents}
              selectedAgents={selectedAgents}
              onSelectAgent={onSelectAgent}
              onReply={onReply}
              onSummarizeAll={onSummarizeAll}
              onSaveToWiki={onSaveToWiki}
            />
          ))}
        </div>

        {/* Participants Sidebar - visible on large screens */}
        {uniqueResponders.length > 1 && (
          <ParticipantsSidebar
            participants={potentialParticipants}
            agents={agents}
            respondedAgents={uniqueResponders}
          />
        )}
      </div>

      {/* Summarize Responses Button - after all responses in this section */}
      {responses.length > 0 && (
        <div className="flex justify-center py-2">
          <button
            onClick={() => onSummarizeAll(responses.map(r => r.content).join('\n\n'))}
            className="flex items-center gap-2 px-4 py-2 bg-dark-700 hover:bg-dark-600 border border-dark-500 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            <span>📋</span> Summarize Responses Above
          </button>
        </div>
      )}

      {/* Section Divider (if not last) */}
      {!isLast && (
        <div className="flex items-center gap-4 py-3">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-dark-500 to-transparent"></div>
        </div>
      )}
    </div>
  );
}

// Townhall Message Component - backwards compatible wrapper
function TownhallMessage({ message, agents, selectedAgents, onSelectAgent, onReply, onSummarizeAll, onSaveToWiki }) {
  const isUser = message.role === 'user';

  if (isUser) {
    // User messages are handled by QuestionSection, but keep for backwards compat
    return (
      <div className="flex gap-3 flex-row-reverse">
        <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-gold text-black">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  // Use the new MultiAgentResponse for assistant messages
  return (
    <MultiAgentResponse
      message={message}
      agents={agents}
      selectedAgents={selectedAgents}
      onSelectAgent={onSelectAgent}
      onReply={onReply}
      onSummarizeAll={onSummarizeAll}
      onSaveToWiki={onSaveToWiki}
    />
  );
}

// ==================== AI HANDOFF SECTION ====================
function AIHandoffSection({ messages, agents }) {
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef(null);

  // Format ENTIRE conversation for handoff - NO TRUNCATION
  const formatFullTranscript = () => {
    let output = '=== ATLAS CONVERSATION TRANSCRIPT ===\n\n';

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        output += `USER:\n${msg.content}\n\n---\n\n`;
      } else {
        // Parse multi-agent responses to get full content
        const { responses, wrapUp } = parseTownhallResponse(msg.content);
        if (responses.length > 0) {
          responses.forEach(r => {
            // Include the FULL content - no slicing
            output += `${r.icon} ${r.name} (${r.role}):\n${r.content}\n\n`;
          });
          if (wrapUp) {
            output += `${wrapUp.icon} ${wrapUp.name} WRAP-UP:\n${wrapUp.content}\n\n`;
          }
          output += '---\n\n';
        } else {
          // Single response - include full content
          output += `ASSISTANT:\n${msg.content}\n\n---\n\n`;
        }
      }
    });

    return output.trim();
  };

  // Select all text in textarea when clicked
  const handleTextareaFocus = () => {
    if (textareaRef.current) {
      textareaRef.current.select();
    }
  };

  const fullTranscript = formatFullTranscript();

  return (
    <div className="mt-6 border border-dark-500 rounded-xl overflow-hidden">
      {/* Collapsed Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-dark-800/50 hover:bg-dark-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-medium text-gray-300">AI Handoff</span>
          <span className="text-xs text-gray-500">• Full transcript for another AI</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded Content - Full Transcript */}
      {expanded && (
        <div className="p-4 bg-dark-800/30 border-t border-dark-600">
          <p className="text-xs text-gray-500 mb-2">
            Click the text below to select all, then Ctrl+C / Cmd+C to copy:
          </p>

          {/* Full Transcript Textarea - ENTIRE conversation, easily selectable */}
          <textarea
            ref={textareaRef}
            readOnly
            value={fullTranscript}
            onFocus={handleTextareaFocus}
            onClick={handleTextareaFocus}
            className="w-full h-[400px] bg-dark-900 text-gray-300 text-xs font-mono p-4 rounded-lg border border-dark-600 focus:border-gold focus:outline-none resize-y leading-relaxed"
            style={{ minHeight: '200px', maxHeight: '600px' }}
          />

          <p className="text-xs text-gray-600 mt-2">
            {fullTranscript.length.toLocaleString()} characters • Paste into ChatGPT, Claude, Gemini, etc.
          </p>
        </div>
      )}
    </div>
  );
}

// ==================== MESSAGE BUBBLE ====================
function MessageBubble({ message, agent, isTownhall, agents, selectedAgents, onSelectAgent, onReply, onSummarizeAll, onSaveToWiki }) {
  const isUser = message.role === 'user';

  // For Townhall, use the special component
  if (isTownhall && !isUser) {
    return (
      <TownhallMessage
        message={message}
        agents={agents}
        selectedAgents={selectedAgents}
        onSelectAgent={onSelectAgent}
        onReply={onReply}
        onSummarizeAll={onSummarizeAll}
        onSaveToWiki={onSaveToWiki}
      />
    );
  }

  // Parse message for visualizations (only for assistant messages)
  const { text, visuals } = isUser ? { text: message.content, visuals: [] } : parseMessageForVisuals(message.content);

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center shrink-0">
          <span className="text-xl">{isTownhall ? '🏛️' : agent?.icon || '🤖'}</span>
        </div>
      )}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${isUser ? 'bg-gold text-black' : 'bg-dark-700 text-white'}`}>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        {!isUser && <MessageVisuals visuals={visuals} />}
        {message.tokens_used > 0 && !isUser && (
          <p className="text-xs text-gray-500 mt-2">{message.tokens_used.toLocaleString()} tokens</p>
        )}
      </div>
    </div>
  );
}

// ==================== CHATS LIST VIEW ====================
function ChatsListView({ chats, agents, onSelectChat, onDeleteChat, onNewChat }) {
  const getAgent = (id) => agents.find(a => a.id === id);

  // Format date safely
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric'
    });
  };

  // Render participant icons for townhall (compact)
  const renderParticipants = (participantIds) => {
    if (!participantIds || participantIds.length === 0) return null;
    const maxShow = 6;
    const shown = participantIds.slice(0, maxShow);
    const remaining = participantIds.length - maxShow;

    return (
      <span className="flex items-center gap-0.5 text-xs">
        {shown.map(id => {
          const agent = getAgent(id);
          return <span key={id} title={agent?.name || id}>{agent?.icon || '👤'}</span>;
        })}
        {remaining > 0 && <span className="text-gray-500 ml-0.5">+{remaining}</span>}
      </span>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Chats</h1>
          <button onClick={onNewChat} className="px-3 py-1.5 bg-gold hover:bg-gold/90 text-black rounded-lg text-sm font-medium flex items-center gap-1.5 md:hidden">
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>

        {chats.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <h2 className="text-lg font-semibold mb-1">No conversations yet</h2>
            <p className="text-gray-400 text-sm">Start a chat from the sidebar</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {chats.map(chat => {
              const chatAgent = getAgent(chat.agent_id);
              const isTownhall = chat.agent_id === 'townhall';
              const participants = chat.participants || [];
              const summary = chat.summary || (chat.last_message ? chat.last_message.slice(0, 80) + '...' : null);

              return (
                <div
                  key={chat.id}
                  onClick={() => onSelectChat(chat)}
                  className={`px-3 py-2.5 rounded-lg cursor-pointer transition-all group flex items-center gap-3 ${
                    isTownhall
                      ? 'bg-amber-900/20 border-l-2 border-amber-500 hover:bg-amber-900/30'
                      : 'bg-dark-800/50 hover:bg-dark-700/70'
                  }`}
                >
                  {/* Icon */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isTownhall ? 'bg-amber-500/20' : 'bg-dark-600/50'
                  }`}>
                    <span className="text-lg">{isTownhall ? '🏛️' : chatAgent?.icon || '💬'}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{isTownhall ? 'Townhall' : chatAgent?.name || 'Chat'}</span>
                      {isTownhall && participants.length > 0 && (
                        <>
                          <span className="text-gray-600">·</span>
                          {renderParticipants(participants)}
                        </>
                      )}
                      <span className="text-[11px] text-gray-500 ml-auto">
                        {formatDate(chat.updated_at)}
                      </span>
                    </div>

                    {/* Summary */}
                    {summary ? (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{summary}</p>
                    ) : (
                      <p className="text-xs text-gray-500 italic mt-0.5">New conversation</p>
                    )}
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => onDeleteChat(e, chat.id)}
                    className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== CALENDAR VIEW ====================
function CalendarView({ events, token, onRefresh }) {
  const [viewMode, setViewMode] = useState('month'); // 'month' or 'week'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', date: '', time: '', color: 'blue' });
  const [todayEvents, setTodayEvents] = useState([]);
  const [weekEvents, setWeekEvents] = useState([]);

  // Fetch today's and this week's events
  useEffect(() => {
    fetchTodayEvents();
    fetchWeekEvents();
  }, []);

  const fetchTodayEvents = async () => {
    try {
      const res = await fetch('/api/calendar/today', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setTodayEvents(await res.json());
    } catch (err) { console.error('Failed to fetch today events:', err); }
  };

  const fetchWeekEvents = async () => {
    try {
      const res = await fetch('/api/calendar/week', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setWeekEvents(await res.json());
    } catch (err) { console.error('Failed to fetch week events:', err); }
  };

  const colorClasses = {
    blue: { bg: 'bg-blue-500/20', border: 'border-blue-500', text: 'text-blue-400', dot: 'bg-blue-500' },
    green: { bg: 'bg-green-500/20', border: 'border-green-500', text: 'text-green-400', dot: 'bg-green-500' },
    yellow: { bg: 'bg-yellow-500/20', border: 'border-yellow-500', text: 'text-yellow-400', dot: 'bg-yellow-500' },
    red: { bg: 'bg-red-500/20', border: 'border-red-500', text: 'text-red-400', dot: 'bg-red-500' },
    purple: { bg: 'bg-purple-500/20', border: 'border-purple-500', text: 'text-purple-400', dot: 'bg-purple-500' }
  };

  const colorLabels = {
    blue: '🔵 Check-in/Follow-up',
    green: '🟢 Milestone',
    yellow: '🟡 Meeting',
    red: '🔴 Deadline',
    purple: '🟣 ATLAS POC'
  };

  const addEvent = async () => {
    if (!newEvent.title || !newEvent.date) return;
    await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: newEvent.title,
        event_date: newEvent.date,
        event_time: newEvent.time || null,
        color: newEvent.color
      })
    });
    setNewEvent({ title: '', date: '', time: '', color: 'blue' });
    setShowAddForm(false);
    onRefresh();
    fetchTodayEvents();
    fetchWeekEvents();
  };

  const deleteEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    await fetch(`/api/calendar/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    onRefresh();
    fetchTodayEvents();
    fetchWeekEvents();
  };

  // Calendar grid helpers
  const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const formatDateKey = (date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  // Group events by date
  const eventsByDate = {};
  events.forEach(event => {
    const dateKey = event.event_date;
    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(event);
  });

  const navigateMonth = (direction) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1));
  };

  const renderMonthGrid = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Empty cells for days before the 1st
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-20 bg-dark-800/30 rounded" />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
      const dateKey = formatDateKey(date);
      const dayEvents = eventsByDate[dateKey] || [];
      const isCurrentDay = isToday(date);
      const isSelected = selectedDate === dateKey;

      days.push(
        <div
          key={day}
          onClick={() => setSelectedDate(isSelected ? null : dateKey)}
          className={`h-20 p-1 rounded cursor-pointer transition-all ${
            isCurrentDay ? 'bg-gold/20 ring-2 ring-gold' :
            isSelected ? 'bg-dark-600 ring-1 ring-dark-400' :
            'bg-dark-800/50 hover:bg-dark-700/50'
          }`}
        >
          <div className={`text-xs font-medium mb-1 ${isCurrentDay ? 'text-gold' : 'text-gray-400'}`}>
            {day}
          </div>
          <div className="space-y-0.5 overflow-hidden">
            {dayEvents.slice(0, 3).map((event, i) => (
              <div
                key={i}
                className={`text-[10px] px-1 py-0.5 rounded truncate ${colorClasses[event.color || 'blue'].bg} ${colorClasses[event.color || 'blue'].text}`}
              >
                {event.title}
              </div>
            ))}
            {dayEvents.length > 3 && (
              <div className="text-[10px] text-gray-500">+{dayEvents.length - 3} more</div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="bg-dark-800 rounded-xl p-4">
        {/* Month header */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigateMonth(-1)} className="p-2 hover:bg-dark-700 rounded-lg">
            <ChevronRight className="w-5 h-5 rotate-180" />
          </button>
          <h2 className="font-semibold">
            {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={() => navigateMonth(1)} className="p-2 hover:bg-dark-700 rounded-lg">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day names */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {dayNames.map(day => (
            <div key={day} className="text-center text-xs text-gray-500 font-medium py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {days}
        </div>
      </div>
    );
  };

  const renderEventList = (eventsList, title) => (
    <div className="bg-dark-800 rounded-xl p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-gold" />
        {title}
      </h3>
      {eventsList.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No events</p>
      ) : (
        <div className="space-y-2">
          {eventsList.map(event => {
            const colors = colorClasses[event.color || 'blue'];
            return (
              <div
                key={event.id}
                className={`p-2 rounded-lg border-l-2 ${colors.border} ${colors.bg} flex items-center gap-3 group`}
              >
                <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{event.title}</p>
                  <p className="text-xs text-gray-400">
                    {event.event_date} {event.event_time && `at ${event.event_time.slice(0, 5)}`}
                  </p>
                </div>
                <button
                  onClick={() => deleteEvent(event.id)}
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all"
                >
                  <Trash2 className="w-3 h-3 text-red-400" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Calendar</h1>
          <div className="flex items-center gap-2">
            <div className="flex bg-dark-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('month')}
                className={`px-3 py-1 text-sm rounded ${viewMode === 'month' ? 'bg-dark-600 text-white' : 'text-gray-400'}`}
              >
                Month
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-1 text-sm rounded ${viewMode === 'week' ? 'bg-dark-600 text-white' : 'text-gray-400'}`}
              >
                Week
              </button>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-3 py-1.5 bg-gold hover:bg-gold/90 text-black rounded-lg text-sm font-medium flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>

        {/* Color Legend */}
        <div className="flex flex-wrap gap-3 mb-4 text-xs">
          {Object.entries(colorLabels).map(([color, label]) => (
            <div key={color} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${colorClasses[color].dot}`} />
              <span className="text-gray-400">{label}</span>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Main calendar - 2 cols */}
          <div className="lg:col-span-2">
            {viewMode === 'month' ? renderMonthGrid() : (
              <div className="bg-dark-800 rounded-xl p-4">
                <h2 className="font-semibold mb-4">This Week</h2>
                {weekEvents.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No events this week</p>
                ) : (
                  <div className="space-y-2">
                    {weekEvents.map(event => {
                      const colors = colorClasses[event.color || 'blue'];
                      const eventDate = new Date(event.event_date + 'T00:00:00');
                      return (
                        <div key={event.id} className={`p-3 rounded-lg border-l-2 ${colors.border} ${colors.bg} group`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{event.title}</span>
                            <button
                              onClick={() => deleteEvent(event.id)}
                              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded"
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </button>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            {eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            {event.event_time && ` at ${event.event_time.slice(0, 5)}`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Selected date events */}
            {selectedDate && eventsByDate[selectedDate] && (
              <div className="mt-4 bg-dark-800 rounded-xl p-4">
                <h3 className="font-semibold mb-3">
                  Events on {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                </h3>
                <div className="space-y-2">
                  {eventsByDate[selectedDate].map(event => {
                    const colors = colorClasses[event.color || 'blue'];
                    return (
                      <div key={event.id} className={`p-3 rounded-lg border-l-2 ${colors.border} ${colors.bg} group`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{event.title}</span>
                          <button
                            onClick={() => deleteEvent(event.id)}
                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded"
                          >
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        </div>
                        {event.event_time && (
                          <p className="text-sm text-gray-400 mt-1">at {event.event_time.slice(0, 5)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar - Today & Upcoming */}
          <div className="space-y-4">
            {renderEventList(todayEvents, "Today's Events")}
            {renderEventList(weekEvents.filter(e => e.event_date !== new Date().toISOString().split('T')[0]), 'This Week')}
          </div>
        </div>
      </div>

      {/* Add Event Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 rounded-xl w-full max-w-md p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Add Event</h2>
              <button onClick={() => setShowAddForm(false)} className="p-2 hover:bg-dark-700 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                placeholder="Event title"
                value={newEvent.title}
                onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-dark-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gold"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={newEvent.date}
                  onChange={(e) => setNewEvent(prev => ({ ...prev, date: e.target.value }))}
                  className="bg-dark-700 rounded-lg px-4 py-2 text-white"
                />
                <input
                  type="time"
                  value={newEvent.time}
                  onChange={(e) => setNewEvent(prev => ({ ...prev, time: e.target.value }))}
                  className="bg-dark-700 rounded-lg px-4 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Event Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(colorLabels).map(([color, label]) => (
                    <button
                      key={color}
                      onClick={() => setNewEvent(prev => ({ ...prev, color }))}
                      className={`p-2 rounded-lg text-left text-sm flex items-center gap-2 transition-all ${
                        newEvent.color === color
                          ? `${colorClasses[color].bg} ring-2 ${colorClasses[color].border.replace('border', 'ring')}`
                          : 'bg-dark-700 hover:bg-dark-600'
                      }`}
                    >
                      <div className={`w-3 h-3 rounded-full ${colorClasses[color].dot}`} />
                      <span className="truncate">{label.split(' ').slice(1).join(' ')}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={addEvent}
                disabled={!newEvent.title || !newEvent.date}
                className="w-full py-2.5 bg-gold hover:bg-gold/90 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-medium rounded-lg"
              >
                Add Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== WIKI VIEW ====================
function WikiView({ pages, onRefresh, token }) {
  const [selectedPage, setSelectedPage] = useState(null);
  const [pageContent, setPageContent] = useState(null);
  const [loading, setLoading] = useState(false);

  const openPageViewer = async (page) => {
    setSelectedPage(page);
    setLoading(true);
    try {
      const res = await fetch(`/api/wiki/page/${page.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPageContent(data);
      }
    } catch (err) {
      console.error('Failed to fetch page content:', err);
    }
    setLoading(false);
  };

  const closeViewer = () => {
    setSelectedPage(null);
    setPageContent(null);
  };

  // Generate AI-style summary bullets from content
  const generateSummary = (content) => {
    if (!content) return [];
    // Extract headers, key points, or first few paragraphs
    const lines = content.split('\n').filter(l => l.trim());
    const bullets = [];

    // Look for headers (## or ###)
    const headers = lines.filter(l => l.match(/^#{2,3}\s+/));
    if (headers.length > 0) {
      headers.slice(0, 4).forEach(h => {
        bullets.push(h.replace(/^#+\s*/, ''));
      });
    }

    // If no headers, extract key sentences
    if (bullets.length === 0) {
      const sentences = content.replace(/[#*_`]/g, '').split(/[.!?]+/).filter(s => s.trim().length > 20);
      sentences.slice(0, 4).forEach(s => {
        bullets.push(s.trim().slice(0, 80) + (s.length > 80 ? '...' : ''));
      });
    }

    return bullets.slice(0, 5);
  };

  // Get category icon based on path
  const getCategoryIcon = (path) => {
    if (path?.includes('decision')) return '⚖️';
    if (path?.includes('research')) return '🔍';
    if (path?.includes('learning')) return '💡';
    if (path?.includes('general')) return '📄';
    return '📝';
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Wiki</h1>
          <a
            href="http://100.117.103.53:3003"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg flex items-center gap-2 text-sm"
          >
            Open Wiki.js <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        <div className="space-y-3">
          {pages.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No Wiki pages yet</p>
            </div>
          ) : (
            pages.map((page, i) => (
              <button
                key={i}
                onClick={() => openPageViewer(page)}
                className="w-full text-left p-4 bg-dark-800 hover:bg-dark-700 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center text-xl">
                    {getCategoryIcon(page.path)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{page.title}</h3>
                    <p className="text-sm text-gray-400 truncate">{page.path}</p>
                  </div>
                  <FileText className="w-4 h-4 text-gray-500" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Wiki Page Viewer Modal */}
      {selectedPage && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-dark-600 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-xl shrink-0">
                  {getCategoryIcon(selectedPage.path)}
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold truncate">{selectedPage.title}</h2>
                  <p className="text-xs text-gray-400 truncate">{selectedPage.path}</p>
                </div>
              </div>
              <button onClick={closeViewer} className="p-2 hover:bg-dark-700 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                </div>
              ) : pageContent ? (
                <>
                  {/* AI Summary */}
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-4">
                    <h3 className="font-medium text-blue-400 mb-2 flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Key Points
                    </h3>
                    <ul className="space-y-1">
                      {generateSummary(pageContent.content).map((point, i) => (
                        <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                          <span className="text-blue-400 mt-0.5">•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Full Content with Chart Rendering */}
                  {(() => {
                    const { text, visuals } = parseMessageForVisuals(pageContent.content);
                    return (
                      <div className="space-y-4">
                        {/* Render any charts/visuals from the content */}
                        {visuals.length > 0 && (
                          <div className="bg-dark-700/50 rounded-xl p-4 border border-dark-600">
                            <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                              <BarChart2 className="w-4 h-4" />
                              Visualizations
                            </h3>
                            <MessageVisuals visuals={visuals} />
                          </div>
                        )}

                        {/* Cleaned text content (chart tags removed) */}
                        <div className="prose prose-invert prose-sm max-w-none">
                          <div className="bg-dark-700 rounded-lg p-4 text-sm text-gray-300 leading-relaxed overflow-x-auto">
                            {text.split('\n').map((line, i) => {
                              // Render headers with proper styling
                              if (line.match(/^#{1,3}\s+/)) {
                                const level = line.match(/^(#+)/)[1].length;
                                const content = line.replace(/^#+\s*/, '');
                                if (level === 1) return <h1 key={i} className="text-xl font-bold text-white mb-2">{content}</h1>;
                                if (level === 2) return <h2 key={i} className="text-lg font-semibold text-white mb-2 mt-4">{content}</h2>;
                                return <h3 key={i} className="text-md font-medium text-gray-200 mb-1 mt-3">{content}</h3>;
                              }
                              // Render bullet points
                              if (line.match(/^\s*[-*]\s+/)) {
                                return (
                                  <div key={i} className="flex items-start gap-2 ml-2">
                                    <span className="text-blue-400 mt-1">•</span>
                                    <span>{line.replace(/^\s*[-*]\s+/, '')}</span>
                                  </div>
                                );
                              }
                              // Render bold text inline
                              if (line.includes('**')) {
                                const parts = line.split(/\*\*(.+?)\*\*/g);
                                return (
                                  <p key={i} className="mb-1">
                                    {parts.map((part, j) =>
                                      j % 2 === 1 ? <strong key={j} className="text-white">{part}</strong> : part
                                    )}
                                  </p>
                                );
                              }
                              // Empty lines become spacing
                              if (!line.trim()) return <div key={i} className="h-2" />;
                              // Regular text
                              return <p key={i} className="mb-1">{line}</p>;
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Metadata */}
                  {pageContent.updatedAt && (
                    <p className="text-xs text-gray-500 mt-4">
                      Last updated: {formatCentralTime(pageContent.updatedAt)}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-center py-8">Failed to load page content</p>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-dark-600 flex justify-between shrink-0">
              <button
                onClick={closeViewer}
                className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm"
              >
                Close
              </button>
              <a
                href={`http://100.117.103.53:3003/${selectedPage.locale}/${selectedPage.path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-2"
              >
                Open in Wiki.js <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== TOWNHALL MODAL ====================
function TownhallModal({ agents, sortedCategories, agentsByCategory, participants, onToggle, onSelectAll, onDeselectAll, onStart, onClose }) {
  const estimatedCost = (participants.length * 0.01).toFixed(2);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-dark-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-dark-600 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-400" />
            <h2 className="text-lg font-semibold">Townhall Meeting</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-dark-700 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-dark-600 flex items-center justify-between shrink-0">
          <div className="flex gap-2">
            <button onClick={onSelectAll} className="px-3 py-1.5 text-sm bg-dark-700 hover:bg-dark-600 rounded-lg">Select All</button>
            <button onClick={onDeselectAll} className="px-3 py-1.5 text-sm bg-dark-700 hover:bg-dark-600 rounded-lg">Deselect All</button>
          </div>
          <div className="text-sm text-gray-400">~${estimatedCost}/msg</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {sortedCategories.map(([catId, catInfo]) => {
            const catAgents = agentsByCategory[catId] || [];
            if (catAgents.length === 0) return null;

            return (
              <div key={catId}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{catInfo.icon} {catInfo.name}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {catAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => onToggle(agent.id)}
                      className={`p-3 rounded-lg text-left transition-all ${
                        participants.includes(agent.id)
                          ? 'bg-amber-600/20 ring-2 ring-amber-500'
                          : 'bg-dark-700 hover:bg-dark-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{agent.icon}</span>
                        <span className="text-sm font-medium truncate">{agent.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-dark-600 shrink-0">
          <button
            onClick={onStart}
            disabled={participants.length === 0}
            className="w-full py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:from-gray-600 disabled:to-gray-600 rounded-xl font-semibold transition-all disabled:cursor-not-allowed"
          >
            Start Meeting ({participants.length} participants)
          </button>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
