const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Anthropic = require('@anthropic-ai/sdk');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Database setup
const db = new Database(path.join(__dirname, 'database', 'command-center.db'));

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    UNIQUE(date)
  );
`);

// Create default admin user if not exists
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('be1st2026', 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashedPassword);
  console.log('Default admin user created (admin / be1st2026)');
}

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'be1st-secret-change-me';

// Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ElevenLabs setup
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_IDS = {
  'prime': 'Rachel',           // Professional, clear
  'flint-slabtrack': 'Josh',   // Energetic
  'flint-blink': 'Bella',      // Young, energetic  
  'boardroom': 'Adam'          // Deep, authoritative
};

// Text-to-speech function
async function textToSpeech(text, agentId) {
  if (!ELEVENLABS_API_KEY) return null;
  
  const voiceName = VOICE_IDS[agentId] || 'Rachel';
  
  // ElevenLabs voice IDs (these are the actual IDs)
  const voiceIdMap = {
    'Rachel': '21m00Tcm4TlvDq8ikWAM',
    'Josh': 'TxGEqnHWrfWFTfGW9XjX', 
    'Bella': 'EXAVITQu4vr4xnSDxMaL',
    'Adam': 'pNInz6obpgDQGcFmaJgB'
  };
  
  const voiceId = voiceIdMap[voiceName] || voiceIdMap['Rachel'];
  
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text.substring(0, 500), // Limit to 500 chars for free tier
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });
    
    if (!response.ok) {
      console.error('ElevenLabs error:', response.status);
      return null;
    }
    
    const audioBuffer = await response.arrayBuffer();
    return Buffer.from(audioBuffer).toString('base64');
  } catch (error) {
    console.error('TTS error:', error);
    return null;
  }
}

// Load agents config
const agents = require('./agents.json');

// Auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.get('/api/agents', authMiddleware, (req, res) => {
  res.json(agents);
});

app.get('/api/chats', authMiddleware, (req, res) => {
  const chats = db.prepare('SELECT * FROM chats ORDER BY updated_at DESC').all();
  res.json(chats);
});

app.post('/api/chats', authMiddleware, (req, res) => {
  const { agent_id } = req.body;
  const agent = agents.agents.find(a => a.id === agent_id);
  const id = 'chat_' + Date.now();
  const name = agent ? `Chat with ${agent.name}` : 'New Chat';
  db.prepare('INSERT INTO chats (id, name, agent_id) VALUES (?, ?, ?)').run(id, name, agent_id);
  res.json({ id, name, agent_id });
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const messages = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(req.params.chatId);
  res.json(messages);
});

app.delete('/api/chats/:chatId', authMiddleware, (req, res) => {
  const { chatId } = req.params;
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
  db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
  res.json({ success: true });
});

app.get('/api/usage', authMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const usage = db.prepare('SELECT * FROM api_usage WHERE date = ?').get(today) || { tokens_in: 0, tokens_out: 0, cost: 0 };
  const total = db.prepare('SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost FROM api_usage').get();
  res.json({ today: usage, total });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Socket.IO for real-time chat
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.user.username);

  socket.on('send_message', async (data) => {
    const { chat_id, agent_id, content } = data;
    const agent = agents.agents.find(a => a.id === agent_id);
    
    if (!agent) {
      socket.emit('error', { message: 'Agent not found' });
      return;
    }

    // Save user message
    db.prepare('INSERT INTO messages (chat_id, agent_id, role, content) VALUES (?, ?, ?, ?)').run(chat_id, agent_id, 'user', content);
    
    // Update chat timestamp
    db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(chat_id);

    // Emit user message to all clients
    io.emit('new_message', { chat_id, agent_id, role: 'user', content, created_at: new Date().toISOString() });

    // Get conversation history
    const history = db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chat_id);
    const messages = history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

    // Emit typing indicator
    io.emit('agent_typing', { chat_id, agent_id, typing: true });

    try {
      // Call Claude API
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: agent.prompt,
        messages: messages
      });

      const assistantMessage = response.content[0].text;
      const tokensIn = response.usage.input_tokens;
      const tokensOut = response.usage.output_tokens;
      const cost = (tokensIn * 0.003 + tokensOut * 0.015) / 1000;

      // Save assistant message
      db.prepare('INSERT INTO messages (chat_id, agent_id, role, content, tokens_used) VALUES (?, ?, ?, ?, ?)').run(chat_id, agent_id, 'assistant', assistantMessage, tokensIn + tokensOut);

      // Update usage
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`INSERT INTO api_usage (date, tokens_in, tokens_out, cost) VALUES (?, ?, ?, ?)
                  ON CONFLICT(date) DO UPDATE SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost = cost + ?`).run(today, tokensIn, tokensOut, cost, tokensIn, tokensOut, cost);

      // Generate audio
      const audioBase64 = await textToSpeech(assistantMessage, agent_id);

      // Emit assistant message with audio
      io.emit('new_message', { 
        chat_id, 
        agent_id, 
        role: 'assistant', 
        content: assistantMessage, 
        tokens_used: tokensIn + tokensOut, 
        created_at: new Date().toISOString(),
        audio: audioBase64
      });
      io.emit('agent_typing', { chat_id, agent_id, typing: false });
      io.emit('usage_update', { tokens_in: tokensIn, tokens_out: tokensOut, cost });

    } catch (error) {
      console.error('Claude API error:', error);
      io.emit('agent_typing', { chat_id, agent_id, typing: false });
      io.emit('error', { message: 'Failed to get response from agent' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user.username);
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🔒 BE1st Command Center                                ║
║                                                          ║
║   Server:  http://localhost:${PORT}                       ║
║   Status:  Running                                       ║
║                                                          ║
║   Default Login:                                         ║
║   Username: admin                                        ║
║   Password: be1st2026                                    ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});