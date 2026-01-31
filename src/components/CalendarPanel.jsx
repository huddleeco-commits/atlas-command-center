import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, X, ChevronLeft, ChevronRight, Maximize2, Edit2 } from 'lucide-react';

function CalendarPanel({ token, socket }) {
  const [events, setEvents] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [newEvent, setNewEvent] = useState({ title: '', event_date: '', event_time: '' });

  useEffect(() => {
    fetchEvents();

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
      setSelectedDate(null);
      fetchEvents();
    } catch (err) {
      console.error('Failed to add event:', err);
    }
  };

  const updateEvent = async (e) => {
    e.preventDefault();
    if (!editingEvent || !editingEvent.title) return;

    try {
      await fetch(`/api/calendar/${editingEvent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: editingEvent.title,
          event_date: editingEvent.event_date,
          event_time: editingEvent.event_time
        })
      });
      setEditingEvent(null);
      fetchEvents();
    } catch (err) {
      console.error('Failed to update event:', err);
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

  // Calendar grid helpers
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    return { daysInMonth, startingDay };
  };

  const getEventsForDate = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return events.filter(e => e.event_date === dateStr);
  };

  const isToday = (date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const handleDateClick = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    setSelectedDate(dateStr);
    setNewEvent({ ...newEvent, event_date: dateStr });
    setShowAddForm(true);
  };

  const renderCalendarGrid = () => {
    const { daysInMonth, startingDay } = getDaysInMonth(currentMonth);
    const days = [];
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Week day headers
    const headers = weekDays.map(day => (
      <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
        {day}
      </div>
    ));

    // Empty cells for days before the first day of the month
    for (let i = 0; i < startingDay; i++) {
      days.push(<div key={`empty-${i}`} className="p-1 sm:p-2"></div>);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
      const dayEvents = getEventsForDate(date);
      const isCurrentDay = isToday(date);
      const dateStr = date.toISOString().split('T')[0];
      const isSelected = selectedDate === dateStr;

      days.push(
        <div
          key={day}
          onClick={() => handleDateClick(date)}
          className={`
            p-1 sm:p-2 min-h-[60px] sm:min-h-[80px] lg:min-h-[100px] border border-dark-600 cursor-pointer
            transition-colors hover:bg-dark-600
            ${isCurrentDay ? 'bg-gold/10 border-gold/30' : 'bg-dark-700'}
            ${isSelected ? 'ring-2 ring-gold' : ''}
          `}
        >
          <div className={`text-xs sm:text-sm font-medium mb-1 ${isCurrentDay ? 'text-gold' : 'text-white'}`}>
            {day}
          </div>
          <div className="space-y-0.5">
            {dayEvents.slice(0, 3).map((event) => (
              <div
                key={event.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingEvent(event);
                }}
                className="text-xs bg-blue-500/20 text-blue-400 rounded px-1 py-0.5 truncate cursor-pointer hover:bg-blue-500/30"
                title={event.title}
              >
                {event.event_time && <span className="hidden sm:inline">{formatTime(event.event_time)} </span>}
                {event.title}
              </div>
            ))}
            {dayEvents.length > 3 && (
              <div className="text-xs text-gray-500">+{dayEvents.length - 3} more</div>
            )}
          </div>
        </div>
      );
    }

    return { headers, days };
  };

  const { headers, days } = renderCalendarGrid();

  // Compact sidebar view
  const CompactView = () => (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gold" />
          <h3 className="text-sm font-semibold text-white">Upcoming</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFullscreen(true)}
            className="p-1 hover:bg-dark-600 rounded transition-colors"
            title="Fullscreen calendar"
          >
            <Maximize2 className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1 hover:bg-dark-600 rounded transition-colors"
          >
            {showAddForm ? <X className="w-4 h-4 text-gray-400" /> : <Plus className="w-4 h-4 text-gray-400" />}
          </button>
        </div>
      </div>

      {showAddForm && !showFullscreen && (
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
          events.slice(0, 5).map((event) => (
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

  // Fullscreen modal
  const FullscreenModal = () => (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-dark-800 rounded-2xl w-full max-w-6xl max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-dark-600">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={prevMonth}
              className="p-1.5 sm:p-2 hover:bg-dark-600 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-4 sm:w-5 h-4 sm:h-5 text-gray-400" />
            </button>
            <h2 className="text-lg sm:text-xl font-bold text-white min-w-[140px] sm:min-w-[180px] text-center">
              {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <button
              onClick={nextMonth}
              className="p-1.5 sm:p-2 hover:bg-dark-600 rounded-lg transition-colors"
            >
              <ChevronRight className="w-4 sm:w-5 h-4 sm:h-5 text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentMonth(new Date())}
              className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm bg-dark-600 hover:bg-dark-500 rounded-lg transition-colors text-white"
            >
              Today
            </button>
            <button
              onClick={() => {
                setShowFullscreen(false);
                setSelectedDate(null);
                setShowAddForm(false);
                setEditingEvent(null);
              }}
              className="p-1.5 sm:p-2 hover:bg-dark-600 rounded-lg transition-colors"
            >
              <X className="w-5 sm:w-6 h-5 sm:h-6 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 overflow-auto p-2 sm:p-4">
          <div className="grid grid-cols-7 gap-0">
            {headers}
            {days}
          </div>
        </div>

        {/* Add Event Form (shown when date selected) */}
        {showAddForm && selectedDate && (
          <div className="border-t border-dark-600 p-3 sm:p-4 bg-dark-700">
            <form onSubmit={addEvent} className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Event title"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gold"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newEvent.event_date}
                  onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })}
                  className="px-3 py-2 bg-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <input
                  type="time"
                  value={newEvent.event_time}
                  onChange={(e) => setNewEvent({ ...newEvent, event_time: e.target.value })}
                  className="px-3 py-2 bg-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-gold hover:bg-gold/90 text-black font-medium rounded-lg transition-colors"
                >
                  Add Event
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setSelectedDate(null);
                  }}
                  className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Edit Event Modal */}
        {editingEvent && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-10">
            <div className="bg-dark-800 rounded-xl p-4 sm:p-6 w-full max-w-md border border-dark-600">
              <h3 className="text-lg font-semibold text-white mb-4">Edit Event</h3>
              <form onSubmit={updateEvent} className="space-y-3">
                <input
                  type="text"
                  placeholder="Event title"
                  value={editingEvent.title}
                  onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gold"
                  autoFocus
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={editingEvent.event_date}
                    onChange={(e) => setEditingEvent({ ...editingEvent, event_date: e.target.value })}
                    className="flex-1 px-3 py-2 bg-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold"
                  />
                  <input
                    type="time"
                    value={editingEvent.event_time || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, event_time: e.target.value })}
                    className="px-3 py-2 bg-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-gold hover:bg-gold/90 text-black font-medium rounded-lg transition-colors"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Delete this event?')) {
                        deleteEvent(editingEvent.id);
                        setEditingEvent(null);
                      }
                    }}
                    className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingEvent(null)}
                    className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <CompactView />
      {showFullscreen && <FullscreenModal />}
    </>
  );
}

export default CalendarPanel;
