import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, X } from 'lucide-react';

function CalendarPanel({ token, socket }) {
  const [events, setEvents] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', event_date: '', event_time: '' });

  useEffect(() => {
    fetchEvents();

    // Listen for calendar updates from agents
    if (socket) {
      socket.on('calendar_update', (data) => {
        if (data.action === 'added') {
          fetchEvents();
        }
      });
    }

    return () => {
      if (socket) {
        socket.off('calendar_update');
      }
    };
  }, [socket]);

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/calendar', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setEvents(data);
    } catch (err) {
      console.error('Failed to fetch calendar:', err);
    }
  };

  const addEvent = async (e) => {
    e.preventDefault();
    if (!newEvent.title || !newEvent.event_date) return;

    try {
      await fetch('/api/calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(newEvent)
      });
      setNewEvent({ title: '', event_date: '', event_time: '' });
      setShowAddForm(false);
      fetchEvents();
    } catch (err) {
      console.error('Failed to add event:', err);
    }
  };

  const deleteEvent = async (id) => {
    try {
      await fetch(`/api/calendar/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchEvents();
    } catch (err) {
      console.error('Failed to delete event:', err);
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.getTime() === today.getTime()) return 'Today';
    if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${period}`;
  };

  const getEventTypeColor = (type) => {
    const colors = {
      'meeting': 'bg-blue-500/20 text-blue-400',
      'deadline': 'bg-red-500/20 text-red-400',
      'event': 'bg-purple-500/20 text-purple-400',
      'general': 'bg-gray-500/20 text-gray-400'
    };
    return colors[type] || colors.general;
  };

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gold" />
          <h3 className="text-sm font-semibold text-white">Upcoming</h3>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="p-1 hover:bg-dark-600 rounded transition-colors"
        >
          {showAddForm ? <X className="w-4 h-4 text-gray-400" /> : <Plus className="w-4 h-4 text-gray-400" />}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={addEvent} className="mb-3 p-2 bg-dark-700 rounded-lg space-y-2">
          <input
            type="text"
            placeholder="Event title"
            value={newEvent.title}
            onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
            className="w-full px-2 py-1.5 bg-dark-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-gold"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={newEvent.event_date}
              onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })}
              className="flex-1 px-2 py-1.5 bg-dark-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-gold"
            />
            <input
              type="time"
              value={newEvent.event_time}
              onChange={(e) => setNewEvent({ ...newEvent, event_time: e.target.value })}
              className="w-24 px-2 py-1.5 bg-dark-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
          <button
            type="submit"
            className="w-full py-1.5 bg-gold hover:bg-gold/90 text-black text-sm font-medium rounded transition-colors"
          >
            Add Event
          </button>
        </form>
      )}

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-2">No upcoming events</p>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-2 p-2 bg-dark-700 rounded-lg group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{event.title}</p>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{formatDate(event.event_date)}</span>
                  {event.event_time && <span>{formatTime(event.event_time)}</span>}
                </div>
              </div>
              <button
                onClick={() => deleteEvent(event.id)}
                className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all"
              >
                <Trash2 className="w-3 h-3 text-red-400" />
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-gray-500 mt-2 text-center">
        Tip: Tell Prime "Add meeting on Feb 15 at 2pm"
      </p>
    </div>
  );
}

export default CalendarPanel;
