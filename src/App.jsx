import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TVDashboard from './pages/TVDashboard';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [socket, setSocket] = useState(null);
  const [view, setView] = useState('chat'); // 'chat' or 'tv'

  useEffect(() => {
    // Check URL for TV mode
    if (window.location.pathname === '/tv') {
      setView('tv');
    }
  }, []);

  useEffect(() => {
    if (token) {
      const newSocket = io(window.location.origin, {
        auth: { token }
      });
      
      newSocket.on('connect', () => {
        console.log('Connected to server');
      });
      
      newSocket.on('connect_error', (err) => {
        console.error('Connection error:', err.message);
        if (err.message === 'Authentication error') {
          handleLogout();
        }
      });
      
      setSocket(newSocket);
      
      return () => newSocket.close();
    }
  }, [token]);

  const handleLogin = (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    if (socket) socket.close();
  };

  const toggleView = () => {
    setView(view === 'chat' ? 'tv' : 'chat');
  };

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  if (view === 'tv') {
    return (
      <div>
        <button 
          onClick={toggleView}
          className="fixed top-4 right-40 z-50 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg text-sm"
        >
          Switch to Chat
        </button>
        <TVDashboard token={token} />
      </div>
    );
  }

  return (
    <div>
      <button 
        onClick={toggleView}
        className="fixed top-4 right-40 z-50 px-4 py-2 bg-gold hover:bg-gold/90 text-black rounded-lg text-sm font-medium"
      >
        TV Dashboard
      </button>
      <Dashboard socket={socket} token={token} onLogout={handleLogout} />
    </div>
  );
}

export default App;