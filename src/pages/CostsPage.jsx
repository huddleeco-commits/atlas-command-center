import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Calendar, Filter, ArrowLeft, RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

function CostsPage({ token, onBack, embedded = false }) {
  const [summary, setSummary] = useState(null);
  const [detailed, setDetailed] = useState({ records: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    agent: '',
    type: ''
  });
  const [sort, setSort] = useState({ field: 'created_at', order: 'desc' });
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    fetchSummary();
    fetchDetailed();
  }, []);

  useEffect(() => {
    fetchDetailed();
  }, [filters, sort, page]);

  const fetchSummary = async () => {
    try {
      const res = await fetch('/api/costs/summary', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  };

  const fetchDetailed = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString(),
        sortField: sort.field,
        sortOrder: sort.order
      });
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.agent) params.append('agent', filters.agent);
      if (filters.type) params.append('type', filters.type);

      const res = await fetch(`/api/costs/detailed?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setDetailed(data);
    } catch (err) {
      console.error('Failed to fetch detailed:', err);
    }
    setLoading(false);
  };

  const formatCost = (cost) => {
    if (!cost) return '$0.0000';
    return `$${cost.toFixed(4)}`;
  };

  const formatTokens = (tokens) => {
    if (!tokens) return '0';
    return tokens.toLocaleString();
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getAgentColor = (agent) => {
    const colors = {
      'prime': 'text-yellow-400',
      'scout': 'text-cyan-400',
      'supplier': 'text-orange-400',
      'ads': 'text-pink-400',
      'content': 'text-lime-400',
      'support': 'text-indigo-400',
      'monitor': 'text-red-400',
      'optimizer': 'text-emerald-400',
      'flint-slabtrack': 'text-blue-400',
      'flint-blink': 'text-purple-400',
      'flint-atlas': 'text-green-400',
      'boardroom': 'text-amber-400',
      'townhall': 'text-rose-400'
    };
    return colors[agent] || 'text-gray-400';
  };

  const getTypeColor = (type) => {
    const colors = {
      'chat': 'bg-blue-500/20 text-blue-400',
      'townhall': 'bg-rose-500/20 text-rose-400',
      'boardroom': 'bg-amber-500/20 text-amber-400'
    };
    return colors[type] || 'bg-gray-500/20 text-gray-400';
  };

  const toggleSort = (field) => {
    if (sort.field === field) {
      setSort({ field, order: sort.order === 'desc' ? 'asc' : 'desc' });
    } else {
      setSort({ field, order: 'desc' });
    }
    setPage(0);
  };

  const SortIcon = ({ field }) => {
    if (sort.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    return sort.order === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />;
  };

  const totalPages = Math.ceil(detailed.total / limit);

  return (
    <div className={`${embedded ? 'flex-1 overflow-y-auto' : 'min-h-screen'} bg-dark-900 text-white`}>
      {/* Header - only shown when not embedded */}
      {!embedded && (
        <div className="bg-dark-800 border-b border-dark-600 p-4">
          <div className="max-w-7xl mx-auto flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-gold" />
              <h1 className="text-xl font-bold">API Costs</h1>
            </div>
            <button
              onClick={() => { fetchSummary(); fetchDetailed(); }}
              className="ml-auto p-2 hover:bg-dark-700 rounded-lg transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <div className={`${embedded ? 'max-w-3xl' : 'max-w-7xl'} mx-auto p-4 space-y-6`}>
        {/* Embedded header */}
        {embedded && (
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold">Costs</h1>
            <button
              onClick={() => { fetchSummary(); fetchDetailed(); }}
              className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        )}
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <p className="text-gray-400 text-sm">Today</p>
              <p className="text-2xl font-bold text-green-400">{formatCost(summary.today?.cost)}</p>
              <p className="text-xs text-gray-500">{formatTokens(summary.today?.tokens_in + summary.today?.tokens_out)} tokens</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <p className="text-gray-400 text-sm">This Week</p>
              <p className="text-2xl font-bold text-blue-400">{formatCost(summary.week?.cost)}</p>
              <p className="text-xs text-gray-500">{formatTokens(summary.week?.tokens_in + summary.week?.tokens_out)} tokens</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <p className="text-gray-400 text-sm">This Month</p>
              <p className="text-2xl font-bold text-purple-400">{formatCost(summary.month?.cost)}</p>
              <p className="text-xs text-gray-500">{formatTokens(summary.month?.tokens_in + summary.month?.tokens_out)} tokens</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <p className="text-gray-400 text-sm">All Time</p>
              <p className="text-2xl font-bold text-gold">{formatCost(summary.allTime?.cost)}</p>
              <p className="text-xs text-gray-500">{formatTokens(summary.allTime?.tokens_in + summary.allTime?.tokens_out)} tokens</p>
            </div>
          </div>
        )}

        {/* By Agent Breakdown */}
        {summary?.byAgent?.length > 0 && (
          <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-gold" />
              Cost by Agent
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {summary.byAgent.map(agent => (
                <div key={agent.agent} className="bg-dark-700 rounded-lg p-3">
                  <p className={`font-medium ${getAgentColor(agent.agent)}`}>
                    {agent.agent || 'Unknown'}
                  </p>
                  <p className="text-lg font-bold">{formatCost(agent.cost)}</p>
                  <p className="text-xs text-gray-500">{agent.calls} calls</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">Filters:</span>
            </div>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => { setFilters(f => ({ ...f, startDate: e.target.value })); setPage(0); }}
              className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm"
              placeholder="Start Date"
            />
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => { setFilters(f => ({ ...f, endDate: e.target.value })); setPage(0); }}
              className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm"
              placeholder="End Date"
            />
            <select
              value={filters.agent}
              onChange={(e) => { setFilters(f => ({ ...f, agent: e.target.value })); setPage(0); }}
              className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="">All Agents</option>
              <option value="prime">Prime</option>
              <option value="scout">Scout</option>
              <option value="supplier">Supplier</option>
              <option value="ads">Ads</option>
              <option value="content">Content</option>
              <option value="support">Support</option>
              <option value="monitor">Monitor</option>
              <option value="optimizer">Optimizer</option>
              <option value="flint-slabtrack">Flint-SlabTrack</option>
              <option value="flint-blink">Flint-Blink</option>
              <option value="flint-atlas">Flint-ATLAS</option>
              <option value="boardroom">Boardroom</option>
              <option value="townhall">Townhall</option>
            </select>
            <select
              value={filters.type}
              onChange={(e) => { setFilters(f => ({ ...f, type: e.target.value })); setPage(0); }}
              className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="">All Types</option>
              <option value="chat">Chat</option>
              <option value="townhall">Townhall</option>
              <option value="boardroom">Boardroom</option>
            </select>
            {(filters.startDate || filters.endDate || filters.agent || filters.type) && (
              <button
                onClick={() => { setFilters({ startDate: '', endDate: '', agent: '', type: '' }); setPage(0); }}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Detailed Table */}
        <div className="bg-dark-800 rounded-xl border border-dark-600 overflow-hidden">
          <div className="p-4 border-b border-dark-600">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-gold" />
              API Call History
              <span className="text-sm text-gray-400 font-normal">({detailed.total} total)</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-dark-700">
                <tr>
                  <th
                    className="text-left p-3 text-sm text-gray-400 cursor-pointer hover:text-white"
                    onClick={() => toggleSort('created_at')}
                  >
                    <div className="flex items-center gap-1">
                      Time <SortIcon field="created_at" />
                    </div>
                  </th>
                  <th className="text-left p-3 text-sm text-gray-400">Type</th>
                  <th
                    className="text-left p-3 text-sm text-gray-400 cursor-pointer hover:text-white"
                    onClick={() => toggleSort('agent')}
                  >
                    <div className="flex items-center gap-1">
                      Agent <SortIcon field="agent" />
                    </div>
                  </th>
                  <th className="text-right p-3 text-sm text-gray-400">In</th>
                  <th className="text-right p-3 text-sm text-gray-400">Out</th>
                  <th
                    className="text-right p-3 text-sm text-gray-400 cursor-pointer hover:text-white"
                    onClick={() => toggleSort('cost')}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      Cost <SortIcon field="cost" />
                    </div>
                  </th>
                  <th className="text-left p-3 text-sm text-gray-400">Description</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-400">Loading...</td>
                  </tr>
                ) : detailed.records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-400">No records found</td>
                  </tr>
                ) : (
                  detailed.records.map(record => (
                    <tr key={record.id} className="border-t border-dark-700 hover:bg-dark-700/50">
                      <td className="p-3 text-sm text-gray-300 whitespace-nowrap">
                        {formatDate(record.created_at)}
                      </td>
                      <td className="p-3 text-sm">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getTypeColor(record.call_type)}`}>
                          {record.call_type || 'chat'}
                        </span>
                      </td>
                      <td className={`p-3 text-sm font-medium ${getAgentColor(record.agent)}`}>
                        {record.agent}
                      </td>
                      <td className="p-3 text-sm text-right text-gray-300">
                        {formatTokens(record.tokens_in)}
                      </td>
                      <td className="p-3 text-sm text-right text-gray-300">
                        {formatTokens(record.tokens_out)}
                      </td>
                      <td className="p-3 text-sm text-right text-green-400 font-medium">
                        {formatCost(record.cost)}
                      </td>
                      <td className="p-3 text-sm text-gray-400 max-w-xs truncate">
                        {record.description}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-dark-600 flex items-center justify-between">
              <p className="text-sm text-gray-400">
                Page {page + 1} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-2 hover:bg-dark-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-2 hover:bg-dark-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Daily Breakdown Chart (simplified as table) */}
        {summary?.daily?.length > 0 && (
          <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
            <h2 className="text-lg font-semibold mb-3">Daily Breakdown (Last 30 Days)</h2>
            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-max">
                {summary.daily.slice().reverse().map(day => (
                  <div
                    key={day.date}
                    className="flex flex-col items-center"
                    title={`${day.date}: ${formatCost(day.cost)}`}
                  >
                    <div
                      className="w-6 bg-gold rounded-t"
                      style={{ height: `${Math.max(4, (day.cost / Math.max(...summary.daily.map(d => d.cost || 0.001))) * 100)}px` }}
                    ></div>
                    <span className="text-xs text-gray-500 mt-1 -rotate-45 origin-top-left w-12">
                      {day.date.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CostsPage;
