import React, { useState, useEffect, useRef } from 'react';
import { Send, LogOut, Zap, MessageSquare, Smile, Menu, X, Trash2 } from 'lucide-react';
import AgentCard from '../components/AgentCard';
import ChatMessage from '../components/ChatMessage';
import UsagePanel from '../components/UsagePanel';

function Dashboard({ socket, token, onLogout }) {
  const [agents, setAgents] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState({});
  const [usage, setUsage] = useState({ today: { tokens_in: 0, tokens_out: 0, cost: 0 }, total: { tokens_in: 0, tokens_out: 0, cost: 0 } });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    fetchAgents();
    fetchChats();
    fetchUsage();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!socket) return;

    socket.on('new_message', (message) => {
      if (message.chat_id === activeChat?.id) {
        setMessages(prev => [...prev, message]);
      }
      updateChatTimestamp(message.chat_id);
    });

    socket.on('agent_typing', ({ chat_id, agent_id, typing: isTyping }) => {
      if (chat_id === activeChat?.id) {
        setTyping(prev => ({ ...prev, [agent_id]: isTyping }));
      }
    });

    socket.on('usage_update', (data) => {
      fetchUsage();
    });

    return () => {
      socket.off('new_message');
      socket.off('agent_typing');
      socket.off('usage_update');
    };
  }, [socket, activeChat]);

  const fetchAgents = async () => {
    const res = await fetch('/api/agents', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setAgents(data.agents || []);
  };

  const fetchChats = async () => {
    const res = await fetch('/api/chats', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setChats(data);
  };

  const fetchMessages = async (chatId) => {
    const res = await fetch(`/api/chats/${chatId}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setMessages(data);
  };

  const fetchUsage = async () => {
    const res = await fetch('/api/usage', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setUsage(data);
  };

  const updateChatTimestamp = (chatId) => {
    setChats(prev => prev.map(c => 
      c.id === chatId ? { ...c, updated_at: new Date().toISOString() } : c
    ).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)));
  };

  const startNewChat = async (agentId) => {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ agent_id: agentId })
    });
    const chat = await res.json();
    setChats(prev => [chat, ...prev]);
    selectChat(chat);
    setSidebarOpen(false); // Close sidebar on mobile after starting chat
  };

  const selectChat = (chat) => {
    setActiveChat(chat);
    setMessages([]);
    fetchMessages(chat.id);
    setSidebarOpen(false); // Close sidebar on mobile after selecting chat
  };

  const deleteChat = async (e, chatId) => {
    e.stopPropagation(); // Prevent selecting the chat when clicking delete
    if (!confirm('Delete this chat? This cannot be undone.')) return;

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (activeChat?.id === chatId) {
        setActiveChat(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || !activeChat || !socket) return;

    socket.emit('send_message', {
      chat_id: activeChat.id,
      agent_id: activeChat.agent_id,
      content: input.trim()
    });

    setInput('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getAgent = (agentId) => agents.find(a => a.id === agentId);
  const activeChatAgent = activeChat ? getAgent(activeChat.agent_id) : null;

  return (
    <div className="min-h-screen bg-dark-900 flex">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-30
        w-72 sm:w-80 bg-dark-800 border-r border-dark-600 flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-dark-600">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 sm:w-6 h-5 sm:h-6 text-gold" />
              <span className="font-bold text-base sm:text-lg">BE1st</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={onLogout} className="p-2 hover:bg-dark-700 rounded-lg transition-colors">
                <LogOut className="w-4 sm:w-5 h-4 sm:h-5 text-gray-400" />
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 hover:bg-dark-700 rounded-lg transition-colors lg:hidden"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Agent Cards */}
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                typing={typing[agent.id]}
                onClick={() => startNewChat(agent.id)}
              />
            ))}
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 py-2">Recent Chats</h3>
            {chats.map(chat => {
              const agent = getAgent(chat.agent_id);
              return (
                <div
                  key={chat.id}
                  onClick={() => selectChat(chat)}
                  className={`w-full p-2.5 sm:p-3 rounded-lg text-left transition-colors mb-1 cursor-pointer group ${
                    activeChat?.id === chat.id ? 'bg-dark-600' : 'hover:bg-dark-700'
                  }`}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-lg sm:text-xl">{agent?.icon || '💬'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{agent?.name || 'Chat'}</p>
                      <p className="text-xs text-gray-500 truncate">{new Date(chat.updated_at).toLocaleDateString()}</p>
                    </div>
                    <button
                      onClick={(e) => deleteChat(e, chat.id)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all"
                      title="Delete chat"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Usage Panel */}
        <UsagePanel usage={usage} />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="h-14 sm:h-16 border-b border-dark-600 flex items-center px-3 sm:px-6">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 hover:bg-dark-700 rounded-lg transition-colors mr-2 lg:hidden"
              >
                <Menu className="w-5 h-5 text-gray-400" />
              </button>
              <span className="text-xl sm:text-2xl mr-2 sm:mr-3">{activeChatAgent?.icon}</span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-white text-sm sm:text-base truncate">{activeChatAgent?.name}</h2>
                <p className="text-xs text-gray-400 truncate">{activeChatAgent?.role}</p>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 ml-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span className="text-xs sm:text-sm text-gray-400 hidden sm:inline">Online</span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 chat-container">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <span className="text-6xl mb-4 block">{activeChatAgent?.icon}</span>
                    <h3 className="text-xl font-semibold text-white mb-2">Start a conversation with {activeChatAgent?.name}</h3>
                    <p className="text-gray-400">{activeChatAgent?.role}</p>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg, i) => (
                    <ChatMessage key={i} message={msg} agent={activeChatAgent} />
                  ))}
                  {typing[activeChat.agent_id] && (
                    <div className="flex items-center gap-2 text-gray-400 py-2">
                      <span className="text-xl">{activeChatAgent?.icon}</span>
                      <span className="text-sm">typing...</span>
                      <span className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input */}
            <div className="p-2 sm:p-4 border-t border-dark-600">
              <div className="flex items-center gap-2 sm:gap-3 bg-dark-700 rounded-xl p-1.5 sm:p-2">
                <button className="p-1.5 sm:p-2 hover:bg-dark-600 rounded-lg transition-colors hidden sm:block">
                  <Smile className="w-5 h-5 text-gray-400" />
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm sm:text-base px-2"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="p-2 sm:p-2.5 bg-gold hover:bg-gold/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 sm:w-5 h-4 sm:h-5 text-black" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Mobile header when no chat selected */}
            <div className="h-14 sm:h-16 border-b border-dark-600 flex items-center px-3 sm:px-6 lg:hidden">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
              >
                <Menu className="w-5 h-5 text-gray-400" />
              </button>
              <div className="flex items-center gap-2 ml-2">
                <Zap className="w-5 h-5 text-gold" />
                <span className="font-bold">BE1st</span>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center">
                <MessageSquare className="w-12 sm:w-16 h-12 sm:h-16 text-gray-600 mx-auto mb-3 sm:mb-4" />
                <h2 className="text-lg sm:text-xl font-semibold text-white mb-2">Welcome to Command Center</h2>
                <p className="text-gray-400 mb-4 sm:mb-6 text-sm sm:text-base">Select an agent to start a conversation</p>
                <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => startNewChat(agent.id)}
                      className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-dark-700 hover:bg-dark-600 rounded-lg transition-colors text-sm sm:text-base"
                    >
                      <span>{agent.icon}</span>
                      <span>{agent.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;