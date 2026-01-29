import React from 'react';

function AgentCard({ agent, typing, onClick }) {
  return (
    <button
      onClick={onClick}
      className="p-3 bg-dark-700 hover:bg-dark-600 rounded-xl transition-all border border-dark-600 hover:border-gold/50 text-left"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{agent.icon}</span>
        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
      </div>
      <p className="text-sm font-medium text-white truncate">{agent.name}</p>
      <p className="text-xs text-gray-500 truncate">
        {typing ? 'Typing...' : agent.role}
      </p>
    </button>
  );
}

export default AgentCard;