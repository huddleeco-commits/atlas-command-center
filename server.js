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

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    event_time TIME,
    event_type TEXT DEFAULT 'general',
    created_by TEXT DEFAULT 'prime',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Calendar endpoints
app.get('/api/calendar', authMiddleware, (req, res) => {
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date >= date('now')
    ORDER BY event_date ASC, event_time ASC
    LIMIT 20
  `).all();
  res.json(events);
});

app.post('/api/calendar', authMiddleware, (req, res) => {
  const { title, description, event_date, event_time, event_type, created_by } = req.body;
  const result = db.prepare(`
    INSERT INTO calendar_events (title, description, event_date, event_time, event_type, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, description || null, event_date, event_time || null, event_type || 'general', created_by || 'user');
  res.json({ id: result.lastInsertRowid, title, event_date, event_time, event_type });
});

app.delete('/api/calendar/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Helper: Query another agent (for agent-to-agent communication)
async function queryAgent(agentId, question, context = '') {
  const agent = agents.agents.find(a => a.id === agentId);
  if (!agent) return null;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: agent.prompt + '\n\nYou are being consulted by another agent. Provide a brief, focused response (2-3 sentences max).',
      messages: [{ role: 'user', content: context ? `Context: ${context}\n\nQuestion: ${question}` : question }]
    });

    const tokensIn = response.usage.input_tokens;
    const tokensOut = response.usage.output_tokens;
    const cost = (tokensIn * 0.003 + tokensOut * 0.015) / 1000;

    // Track usage
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`INSERT INTO api_usage (date, tokens_in, tokens_out, cost) VALUES (?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost = cost + ?`).run(today, tokensIn, tokensOut, cost, tokensIn, tokensOut, cost);

    return {
      agentId,
      agentName: agent.name,
      response: response.content[0].text,
      tokensUsed: tokensIn + tokensOut
    };
  } catch (error) {
    console.error(`Error querying agent ${agentId}:`, error);
    return null;
  }
}

// Helper: Parse calendar events from natural language
function parseCalendarEvent(text) {
  // Match patterns like "Add card show on Feb 15 at 10am" or "Schedule meeting on 2024-02-15 at 2pm"
  const patterns = [
    /(?:add|schedule|create)\s+(?:event[:\s]+)?(.+?)\s+(?:on|for)\s+(.+?)(?:\s+at\s+(.+?))?$/i,
    /(?:add|schedule)\s+(.+?)\s+(?:to calendar|to schedule)\s+(?:on|for)\s+(.+?)(?:\s+at\s+(.+?))?$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const title = match[1].trim();
      const dateStr = match[2].trim();
      const timeStr = match[3]?.trim();

      // Parse date (handle "Feb 15", "February 15", "2024-02-15", etc.)
      const parsedDate = parseNaturalDate(dateStr);
      const parsedTime = timeStr ? parseNaturalTime(timeStr) : null;

      if (parsedDate) {
        return { title, event_date: parsedDate, event_time: parsedTime };
      }
    }
  }
  return null;
}

function parseNaturalDate(dateStr) {
  const months = {
    'jan': '01', 'january': '01', 'feb': '02', 'february': '02', 'mar': '03', 'march': '03',
    'apr': '04', 'april': '04', 'may': '05', 'jun': '06', 'june': '06',
    'jul': '07', 'july': '07', 'aug': '08', 'august': '08', 'sep': '09', 'september': '09',
    'oct': '10', 'october': '10', 'nov': '11', 'november': '11', 'dec': '12', 'december': '12'
  };

  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // Try "Feb 15" or "February 15" format
  const monthDayMatch = dateStr.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/i);
  if (monthDayMatch) {
    const month = months[monthDayMatch[1].toLowerCase()];
    if (month) {
      const day = monthDayMatch[2].padStart(2, '0');
      const year = monthDayMatch[3] || new Date().getFullYear();
      return `${year}-${month}-${day}`;
    }
  }

  return null;
}

function parseNaturalTime(timeStr) {
  // Parse "10am", "2pm", "14:00", "2:30 PM"
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = match[2] || '00';
    const period = match[3]?.toLowerCase();

    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
  }
  return null;
}

// Helper: Get upcoming events for briefings
function getUpcomingEvents(days = 7) {
  return db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date >= date('now') AND event_date <= date('now', '+' || ? || ' days')
    ORDER BY event_date ASC, event_time ASC
  `).all(days);
}

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
      // Build enhanced system prompt with context
      let enhancedPrompt = agent.prompt;

      // Add upcoming calendar events for Prime
      if (agent_id === 'prime') {
        const upcomingEvents = getUpcomingEvents(7);
        if (upcomingEvents.length > 0) {
          enhancedPrompt += '\n\nUPCOMING EVENTS (next 7 days):\n';
          upcomingEvents.forEach(e => {
            const dateStr = new Date(e.event_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const timeStr = e.event_time ? ` at ${e.event_time.slice(0, 5)}` : '';
            enhancedPrompt += `- ${e.title} on ${dateStr}${timeStr}\n`;
          });
        }
      }

      // Check if user wants to add a calendar event
      const calendarEvent = parseCalendarEvent(content);
      if (calendarEvent) {
        db.prepare(`
          INSERT INTO calendar_events (title, event_date, event_time, created_by)
          VALUES (?, ?, ?, ?)
        `).run(calendarEvent.title, calendarEvent.event_date, calendarEvent.event_time, agent_id);

        enhancedPrompt += `\n\nSYSTEM: Calendar event "${calendarEvent.title}" has been added for ${calendarEvent.event_date}${calendarEvent.event_time ? ' at ' + calendarEvent.event_time : ''}. Confirm this to the user.`;
        io.emit('calendar_update', { action: 'added', event: calendarEvent });
      }

      // Check for @mentions or "check with" patterns for agent-to-agent communication
      const agentMentions = [];
      const mentionPatterns = [
        /@(flint-slabtrack|flint-blink|flint-commandcenter|prime|boardroom)/gi,
        /(?:check with|ask|consult|get input from)\s+(flint-slabtrack|flint-blink|flint-commandcenter|prime|boardroom)/gi
      ];

      for (const pattern of mentionPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const mentionedAgentId = match[1].toLowerCase();
          if (mentionedAgentId !== agent_id && !agentMentions.includes(mentionedAgentId)) {
            agentMentions.push(mentionedAgentId);
          }
        }
      }

      // Query mentioned agents
      const agentResponses = [];
      for (const mentionedAgentId of agentMentions) {
        io.emit('agent_consulting', { chat_id, agent_id, consulting: mentionedAgentId });
        const agentResponse = await queryAgent(mentionedAgentId, content, `${agent.name} is asking for your input.`);
        if (agentResponse) {
          agentResponses.push(agentResponse);
        }
      }

      // Add agent responses to context
      if (agentResponses.length > 0) {
        enhancedPrompt += '\n\nAGENT CONSULTATION RESPONSES:\n';
        agentResponses.forEach(r => {
          enhancedPrompt += `\n${r.agentName} says: "${r.response}"\n`;
        });
        enhancedPrompt += '\nIncorporate these responses into your answer, citing which agent said what.';
      }

      // Call Claude API
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: enhancedPrompt,
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

      // Emit assistant message with audio and consultation info
      io.emit('new_message', {
        chat_id,
        agent_id,
        role: 'assistant',
        content: assistantMessage,
        tokens_used: tokensIn + tokensOut,
        created_at: new Date().toISOString(),
        audio: audioBase64,
        consulted_agents: agentResponses.map(r => r.agentName)
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