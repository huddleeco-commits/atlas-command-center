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
    return <TVDashboard token={token} socket={socket} onSwitchToChat={toggleView} />;
  }

  return <Dashboard socket={socket} token={token} onLogout={handleLogout} onSwitchToTV={toggleView} />;
}

export default App;