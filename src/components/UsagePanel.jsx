import React from 'react';
import { BarChart3 } from 'lucide-react';

function UsagePanel({ usage }) {
  const todayCost = usage?.today?.cost || 0;
  const totalCost = usage?.total?.cost || 0;
  const todayTokens = (usage?.today?.tokens_in || 0) + (usage?.today?.tokens_out || 0);

  return (
    <div className="p-4 border-t border-dark-600 bg-dark-800">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-gold" />
        <span className="text-sm font-medium text-gray-400">API Usage</span>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-dark-700 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Today</p>
          <p className="text-lg font-semibold text-white">${todayCost.toFixed(3)}</p>
          <p className="text-xs text-gray-500">{todayTokens.toLocaleString()} tokens</p>
        </div>
        <div className="bg-dark-700 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Total</p>
          <p className="text-lg font-semibold text-gold">${totalCost.toFixed(2)}</p>
          <p className="text-xs text-gray-500">all time</p>
        </div>
      </div>
    </div>
  );
}

export default UsagePanel;