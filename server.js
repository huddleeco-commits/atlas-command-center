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
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Sentry initialization
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
  console.log('Sentry initialized');
}

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

  CREATE TABLE IF NOT EXISTS api_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    description TEXT,
    call_type TEXT DEFAULT 'chat',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  CREATE TABLE IF NOT EXISTS activity_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ralph_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    prd_content TEXT,
    progress INTEGER DEFAULT 0,
    result TEXT,
    triggered_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    phone TEXT,
    carrier TEXT,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memory_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS git_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    last_sync DATETIME DEFAULT CURRENT_TIMESTAMP,
    commits_found INTEGER DEFAULT 0,
    sync_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Add call_type column to api_calls if it doesn't exist
try {
  db.prepare('SELECT call_type FROM api_calls LIMIT 1').get();
} catch (e) {
  db.prepare('ALTER TABLE api_calls ADD COLUMN call_type TEXT DEFAULT "chat"').run();
  console.log('Added call_type column to api_calls table');
}

// ==================== API USAGE LOGGING FUNCTION ====================
function logApiUsage(tokensIn, tokensOut, cost, agent, description, callType = 'chat') {
  const today = new Date().toISOString().split('T')[0];

  // Update daily totals
  db.prepare(`INSERT INTO api_usage (date, tokens_in, tokens_out, cost) VALUES (?, ?, ?, ?)
              ON CONFLICT(date) DO UPDATE SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost = cost + ?`)
    .run(today, tokensIn, tokensOut, cost, tokensIn, tokensOut, cost);

  // Log individual call with type
  db.prepare(`INSERT INTO api_calls (agent, tokens_in, tokens_out, cost, description, call_type) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(agent, tokensIn, tokensOut, cost, description, callType);

  console.log(`[API Cost] ${callType.toUpperCase()} - ${agent}: $${cost.toFixed(4)} (${tokensIn}/${tokensOut} tokens) - ${description}`);
}

// Create default admin user if not exists
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('be1st2026', 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashedPassword);
  console.log('Default admin user created (admin / be1st2026)');
}

// Pre-seed contacts
const preseedContacts = [
  { name: 'Sherwin', phone: '4692199735', carrier: 'tmobile', email: 'huddleeco@gmail.com' },
  { name: 'Sean', phone: '2485340253', carrier: 'att', email: null }
];

preseedContacts.forEach(contact => {
  const existing = db.prepare('SELECT id FROM contacts WHERE name = ?').get(contact.name);
  if (!existing) {
    db.prepare('INSERT INTO contacts (name, phone, carrier, email) VALUES (?, ?, ?, ?)').run(contact.name, contact.phone, contact.carrier, contact.email);
    console.log(`[Contact] Pre-seeded contact: ${contact.name} (${contact.carrier})`);
  }
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500
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

// ==================== WIKI.JS INTEGRATION ====================
const WIKI_URL = process.env.WIKIJS_URL || process.env.WIKI_URL || 'http://100.117.103.53:3003';
const WIKI_API_KEY = process.env.WIKIJS_API_KEY || process.env.WIKI_API_KEY;

console.log('[Wiki.js] URL:', WIKI_URL);
console.log('[Wiki.js] API Key configured:', WIKI_API_KEY ? 'Yes' : 'No');

async function wikiGraphQL(query, variables = {}) {
  if (!WIKI_API_KEY) {
    console.log('[Wiki.js] Skipping - no API key configured');
    return null;
  }
  try {
    console.log('[Wiki.js] Making GraphQL request to:', `${WIKI_URL}/graphql`);
    const response = await fetch(`${WIKI_URL}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WIKI_API_KEY}`
      },
      body: JSON.stringify({ query, variables })
    });
    const data = await response.json();
    console.log('[Wiki.js] Response:', JSON.stringify(data, null, 2));
    if (data.errors) {
      console.error('[Wiki.js] GraphQL errors:', data.errors);
    }
    return data.data;
  } catch (error) {
    console.error('[Wiki.js] Request error:', error.message);
    return null;
  }
}

async function wikiCreatePage(path, title, content, description = '') {
  const query = `
    mutation CreatePage($content: String!, $description: String!, $editor: String!, $isPublished: Boolean!, $isPrivate: Boolean!, $locale: String!, $path: String!, $tags: [String]!, $title: String!) {
      pages {
        create(content: $content, description: $description, editor: $editor, isPublished: $isPublished, isPrivate: $isPrivate, locale: $locale, path: $path, tags: $tags, title: $title) {
          responseResult { succeeded, message }
          page { id, path }
        }
      }
    }
  `;
  return wikiGraphQL(query, {
    content,
    description,
    editor: 'markdown',
    isPublished: true,
    isPrivate: false,
    locale: 'en',
    path,
    tags: ['command-center', 'auto-generated'],
    title
  });
}

async function wikiSearch(query, limit = 5) {
  const gqlQuery = `
    query SearchPages($query: String!) {
      pages {
        search(query: $query) {
          results { id, title, path, description }
        }
      }
    }
  `;
  const result = await wikiGraphQL(gqlQuery, { query });
  return result?.pages?.search?.results?.slice(0, limit) || [];
}

async function searchWikiPages(query = '', limit = 20) {
  if (!WIKI_API_KEY) return [];

  // List all pages ordered by most recently updated
  const gqlQuery = `
    query ListPages {
      pages {
        list(orderBy: UPDATED, orderByDirection: DESC) {
          id
          path
          title
          description
          locale
        }
      }
    }
  `;

  const result = await wikiGraphQL(gqlQuery);
  let pages = result?.pages?.list || [];

  // If query provided, filter by title/path containing query
  if (query) {
    const q = query.toLowerCase();
    pages = pages.filter(p =>
      p.title?.toLowerCase().includes(q) ||
      p.path?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  }

  return pages.slice(0, limit);
}

async function getWikiPageContent(pageId) {
  if (!WIKI_API_KEY) return null;

  const gqlQuery = `
    query GetPage($id: Int!) {
      pages {
        single(id: $id) {
          id
          path
          title
          description
          content
          createdAt
          updatedAt
        }
      }
    }
  `;

  const result = await wikiGraphQL(gqlQuery, { id: parseInt(pageId) });
  return result?.pages?.single || null;
}

// Generic Wiki save function that emits socket events
async function saveToWiki(title, content, agentId, category = 'general') {
  console.log(`[Wiki.js] Saving ${category} from ${agentId}:`, title);
  const date = new Date().toISOString().split('T')[0];
  const safePath = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 50);
  const path = `${category}/${date}-${safePath}`;

  const fullContent = `# ${title}\n\n**Date:** ${date}\n**Agent:** ${agentId}\n\n${content}\n\n---\n*Auto-generated by ${agentId} via ATLAS*`;

  console.log('[Wiki.js] Creating page at path:', path);
  const result = await wikiCreatePage(path, title, fullContent, `${category} by ${agentId}`);

  if (result?.pages?.create?.responseResult?.succeeded) {
    logActivity('wiki', agentId, `${category} saved: ${title}`, `Saved to Wiki at /${path}`);
    console.log('[Wiki.js] Saved successfully');
    // Emit socket event for UI notification
    if (typeof io !== 'undefined') {
      io.emit('wiki_saved', { title, path, agent: agentId, category });
    }
  } else {
    console.error('[Wiki.js] Failed to save:', result?.pages?.create?.responseResult?.message);
  }
  return { result, path, title };
}

async function saveBoardroomDecision(topic, decision, reasoning) {
  console.log('[Wiki.js] Saving Boardroom decision:', topic);
  const date = new Date().toISOString().split('T')[0];
  const path = `decisions/${date}-${topic.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`;
  const content = `# Boardroom Decision: ${topic}\n\n**Date:** ${date}\n\n## Decision\n${decision}\n\n## Reasoning\n${reasoning}\n\n---\n*Auto-generated by Command Center*`;

  console.log('[Wiki.js] Creating page at path:', path);
  const result = await wikiCreatePage(path, `Decision: ${topic}`, content, `Boardroom decision on ${topic}`);
  console.log('[Wiki.js] Create result:', result);
  if (result?.pages?.create?.responseResult?.succeeded) {
    logActivity('wiki', 'boardroom', `Decision saved: ${topic}`, `Saved to Wiki at /${path}`);
    console.log('[Wiki.js] Decision saved successfully');
    // Emit socket event
    if (typeof io !== 'undefined') {
      io.emit('wiki_saved', { title: `Decision: ${topic}`, path, agent: 'boardroom', category: 'decisions' });
    }
  } else {
    console.error('[Wiki.js] Failed to save decision:', result?.pages?.create?.responseResult?.message);
  }
  return result;
}

async function saveRalphLearning(project, learning, context) {
  const date = new Date().toISOString().split('T')[0];
  const path = `learnings/${project}/${date}-${learning.slice(0, 30).toLowerCase().replace(/\s+/g, '-')}`;
  const content = `# Ralph Learning: ${learning}\n\n**Project:** ${project}\n**Date:** ${date}\n\n## Context\n${context}\n\n## Learning\n${learning}\n\n---\n*Auto-generated by Ralph via ATLAS*`;

  return wikiCreatePage(path, `Learning: ${learning.slice(0, 50)}`, content, `Ralph learning from ${project}`);
}

// Save Ralph code changes to Wiki - called after Ralph completes a task
async function saveRalphCodeChanges(data) {
  if (!WIKI_API_KEY) {
    console.log('[Wiki.js] Skipping code changes save - no API key');
    return null;
  }

  const { project, task, filesChanged, summary, git, duration, turns, cost } = data;
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Create a clean task title for the path
  const taskSlug = (task || 'code-update').slice(0, 40)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

  const path = `development/${project}/${date}-${taskSlug}`;

  // Build the content with nice formatting
  let content = `# Code Changes: ${project.toUpperCase()}\n\n`;
  content += `## Overview\n\n`;
  content += `| Field | Value |\n|-------|-------|\n`;
  content += `| **Date** | ${date} ${time} |\n`;
  content += `| **Project** | ${project} |\n`;
  content += `| **Duration** | ${duration || 'N/A'}s |\n`;
  content += `| **Turns** | ${turns || 'N/A'} |\n`;
  content += `| **Cost** | $${cost?.toFixed(4) || '0.0000'} |\n`;
  if (git?.pushed) {
    content += `| **Git** | Pushed to ${git.branch || 'main'} |\n`;
  }
  content += `\n## Task\n\n${task || 'No task description'}\n\n`;

  if (summary) {
    content += `## Summary\n\n${summary}\n\n`;
  }

  if (filesChanged && filesChanged.length > 0) {
    content += `## Files Changed\n\n`;
    filesChanged.forEach(file => {
      content += `- \`${file}\`\n`;
    });
    content += '\n';
  }

  content += `---\n*Auto-generated by Ralph via ATLAS*`;

  console.log('[Wiki.js] Saving Ralph code changes:', path);
  const result = await wikiCreatePage(
    path,
    `${project}: ${taskSlug}`,
    content,
    `Code changes for ${project} - ${task?.slice(0, 50) || 'update'}`
  );

  if (result?.pages?.create?.responseResult?.succeeded) {
    logActivity('wiki', 'ralph', `Code changes saved: ${project}`, `Saved to Wiki at /${path}`);
    console.log('[Wiki.js] Code changes saved successfully to:', path);
    if (typeof io !== 'undefined') {
      io.emit('wiki_saved', {
        title: `Code: ${project}`,
        path,
        agent: 'ralph',
        category: 'development'
      });
    }
  } else {
    console.error('[Wiki.js] Failed to save code changes:', result?.pages?.create?.responseResult?.message);
  }

  return result;
}

async function saveScoutResearch(title, findings, agentId = 'scout') {
  console.log('[Wiki.js] Saving Scout research:', title);
  const date = new Date().toISOString().split('T')[0];
  const safePath = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 50);
  const path = `research/${date}-${safePath}`;

  const content = `# Research: ${title}\n\n**Date:** ${date}\n**Agent:** ${agentId}\n\n## Findings\n\n${findings}\n\n---\n*Auto-generated by ${agentId} via ATLAS*`;

  console.log('[Wiki.js] Creating research page at path:', path);
  const result = await wikiCreatePage(path, `Research: ${title}`, content, `Market research by ${agentId}`);

  if (result?.pages?.create?.responseResult?.succeeded) {
    logActivity('wiki', agentId, `Research saved: ${title}`, `Saved to Wiki at /${path}`);
    console.log('[Wiki.js] Research saved successfully');
    // Emit socket event
    if (typeof io !== 'undefined') {
      io.emit('wiki_saved', { title: `Research: ${title}`, path, agent: agentId, category: 'research' });
    }
  } else {
    console.error('[Wiki.js] Failed to save research:', result?.pages?.create?.responseResult?.message);
  }
  return result;
}

// ==================== SENTRY INTEGRATION ====================
const SENTRY_API_TOKEN = process.env.SENTRY_API_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG || 'be1st';
const SENTRY_PROJECTS = {
  'command-center': process.env.SENTRY_PROJECT_CC || 'command-center',
  'slabtrack': process.env.SENTRY_PROJECT_ST || 'slabtrack',
  'blink': process.env.SENTRY_PROJECT_BLINK || 'blink'
};

async function getSentryIssues(project, limit = 5) {
  if (!SENTRY_API_TOKEN) return [];
  try {
    const projectSlug = SENTRY_PROJECTS[project] || project;
    const response = await fetch(
      `https://sentry.io/api/0/projects/${SENTRY_ORG}/${projectSlug}/issues/?query=is:unresolved&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${SENTRY_API_TOKEN}` } }
    );
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error('Sentry API error:', error);
    return [];
  }
}

async function getSentryStats(project) {
  if (!SENTRY_API_TOKEN) return null;
  try {
    const projectSlug = SENTRY_PROJECTS[project] || project;
    const response = await fetch(
      `https://sentry.io/api/0/projects/${SENTRY_ORG}/${projectSlug}/stats/`,
      { headers: { 'Authorization': `Bearer ${SENTRY_API_TOKEN}` } }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Sentry stats error:', error);
    return null;
  }
}

async function getAllPlatformHealth() {
  const health = {};
  for (const [name, slug] of Object.entries(SENTRY_PROJECTS)) {
    const issues = await getSentryIssues(name, 10);
    health[name] = {
      errorCount: issues.length,
      criticalCount: issues.filter(i => i.level === 'error' || i.level === 'fatal').length,
      recentIssues: issues.slice(0, 3).map(i => ({
        title: i.title,
        culprit: i.culprit,
        count: i.count,
        lastSeen: i.lastSeen
      }))
    };
  }
  return health;
}

// ==================== SMS/EMAIL INTEGRATION ====================
// Carrier MMS gateways (cleaner than SMS gateways - no "no subject" issues)
const CARRIER_GATEWAYS = {
  'verizon': 'vtext.com',         // SMS gateway
  'att': 'txt.att.net',           // SMS gateway
  'tmobile': 'tmomail.net',       // SMS gateway (works for both)
  't-mobile': 'tmomail.net',      // SMS gateway
  'sprint': 'messaging.sprintpcs.com', // SMS gateway
  'cricket': 'sms.cricketwireless.net', // SMS gateway
  'metro': 'mymetropcs.com',      // SMS gateway
  'boost': 'sms.myboostmobile.com', // SMS gateway
  'uscellular': 'email.uscc.net'  // SMS gateway
};

// Setup nodemailer transporter
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Verify email config on startup
if (process.env.SMTP_USER) {
  emailTransporter.verify((error, success) => {
    if (error) {
      console.error('[Email] SMTP configuration error:', error.message);
    } else {
      console.log('[Email] SMTP server ready');
    }
  });
} else {
  console.log('[Email] SMTP not configured - set SMTP_USER and SMTP_PASS');
}

// Get contact by name (case-insensitive)
function getContact(name) {
  return db.prepare('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?)').get(name);
}

// Send SMS via carrier gateway
async function sendSMS(contactName, message, sender = 'Prime') {
  console.log(`[SMS] === START sendSMS ===`);
  console.log(`[SMS] Contact name: "${contactName}"`);
  console.log(`[SMS] Sender: "${sender}"`);

  const contact = getContact(contactName);
  console.log(`[SMS] Contact lookup result:`, contact ? JSON.stringify(contact) : 'NOT FOUND');

  if (!contact) {
    console.log(`[SMS] ERROR: Contact not found`);
    return { success: false, error: `Contact "${contactName}" not found` };
  }
  if (!contact.phone || !contact.carrier) {
    console.log(`[SMS] ERROR: Missing phone (${contact.phone}) or carrier (${contact.carrier})`);
    return { success: false, error: `Contact "${contactName}" missing phone or carrier` };
  }

  const carrierKey = contact.carrier.toLowerCase().replace('-', '');
  const gateway = CARRIER_GATEWAYS[carrierKey];
  console.log(`[SMS] Carrier key: "${carrierKey}", Gateway: "${gateway}"`);

  if (!gateway) {
    console.log(`[SMS] ERROR: Unknown carrier`);
    return { success: false, error: `Unknown carrier: ${contact.carrier}` };
  }

  const smsEmail = `${contact.phone.replace(/\D/g, '')}@${gateway}`;
  const subject = '';  // Empty subject - carriers may filter branded subjects as spam
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER;

  const mailOptions = {
    from: fromAddr,
    to: smsEmail,
    subject: subject,
    text: message
  };

  console.log(`[SMS] Mail options:`, JSON.stringify(mailOptions, null, 2));

  try {
    console.log(`[SMS] Calling emailTransporter.sendMail()...`);
    const result = await emailTransporter.sendMail(mailOptions);
    console.log(`[SMS] sendMail result:`, JSON.stringify(result, null, 2));

    logActivity('sms', sender.toLowerCase(), `SMS sent to ${contactName}`, message.slice(0, 100));
    console.log(`[SMS] === SUCCESS ===`);
    return { success: true, to: contactName, via: smsEmail };
  } catch (error) {
    console.error(`[SMS] === FAILED ===`);
    console.error(`[SMS] Error name:`, error.name);
    console.error(`[SMS] Error message:`, error.message);
    console.error(`[SMS] Error stack:`, error.stack);
    console.error(`[SMS] Full error:`, error);
    return { success: false, error: error.message };
  }
}

// Send Email
async function sendEmail(contactName, message, subject = 'Message from Prime') {
  const contact = getContact(contactName);
  if (!contact) {
    return { success: false, error: `Contact "${contactName}" not found` };
  }
  if (!contact.email) {
    return { success: false, error: `Contact "${contactName}" has no email` };
  }

  console.log(`[Email] Sending to ${contactName} at ${contact.email}`);

  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: contact.email,
      subject: subject,
      text: message,
      html: `<p>${message.replace(/\n/g, '<br>')}</p><hr><p><small>Sent by Prime - ATLAS by BE1st</small></p>`
    });

    logActivity('email', 'prime', `Email sent to ${contactName}`, message.slice(0, 100));
    console.log(`[Email] Sent successfully to ${contactName}`);
    return { success: true, to: contactName, email: contact.email };
  } catch (error) {
    console.error(`[Email] Failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// Parse message for SMS/Email commands and execute
async function processMessagingCommands(content, sender = 'Prime') {
  const results = [];

  // Match "Text [Name]: [message]" pattern
  const textMatch = content.match(/(?:text|sms|message)\s+(\w+):\s*(.+?)(?=(?:text|sms|message|email)\s+\w+:|$)/gi);
  if (textMatch) {
    for (const match of textMatch) {
      const parsed = match.match(/(?:text|sms|message)\s+(\w+):\s*(.+)/i);
      if (parsed) {
        const [, name, msg] = parsed;
        const result = await sendSMS(name.trim(), msg.trim(), sender);
        results.push({ type: 'sms', ...result });
      }
    }
  }

  // Match "Email [Name]: [message]" pattern
  const emailMatch = content.match(/email\s+(\w+):\s*(.+?)(?=(?:text|sms|message|email)\s+\w+:|$)/gi);
  if (emailMatch) {
    for (const match of emailMatch) {
      const parsed = match.match(/email\s+(\w+):\s*(.+)/i);
      if (parsed) {
        const [, name, msg] = parsed;
        const result = await sendEmail(name.trim(), msg.trim());
        results.push({ type: 'email', ...result });
      }
    }
  }

  return results;
}

// ==================== RALPH INTEGRATION ====================
// Project configurations with detailed structure for Claude Code execution
const RALPH_PROJECTS = {
  'slabtrack': {
    path: process.env.RALPH_SLABTRACK_PATH || 'C:/Users/huddl/OneDrive/Desktop/GitHub/slabtrack',
    ralphDir: 'scripts/ralph',
    structure: {
      description: 'Sports card collection management platform',
      frontendEntry: 'frontend/src/App.jsx',
      backendEntry: 'backend/server.js',
      keyPaths: {
        pages: 'frontend/src/pages/',
        components: 'frontend/src/components/',
        routes: 'backend/routes/',
        services: 'backend/services/'
      },
      criticalFiles: {
        'QuickActions': 'frontend/src/pages/QuickActions.jsx',
        'Scanner Service': 'backend/services/claude-scanner.js',
        'Scanner Routes': 'backend/routes/scanner.routes.js',
        'Continuous Scan': 'frontend/src/components/scanning/ContinuousScanMode.jsx',
        'AR Price Check': 'frontend/src/components/scanning/ARPriceCheck.jsx'
      },
      warnings: ['QuickActions is QuickActions.jsx NOT QuickActionsPage.jsx']
    }
  },
  'blink': {
    path: process.env.RALPH_BLINK_PATH || 'C:/Users/huddl/OneDrive/Desktop/module-library',
    ralphDir: 'module-assembler-ui/scripts/ralph',
    structure: {
      description: 'Genetic assembly platform for full-stack web applications',
      primaryApp: 'module-assembler-ui/',
      serverEntry: 'module-assembler-ui/server.cjs',
      frontendEntry: 'module-assembler-ui/src/App.jsx',
      keyPaths: {
        screens: 'module-assembler-ui/src/screens/',
        admin: 'module-assembler-ui/src/admin/',
        components: 'module-assembler-ui/src/components/',
        agents: 'module-assembler-ui/lib/agents/',
        services: 'module-assembler-ui/lib/services/',
        routes: 'module-assembler-ui/lib/routes/',
        generators: 'module-assembler-ui/lib/generators/',
        backendModules: 'backend/'
      },
      criticalFiles: {
        'Main Server': 'module-assembler-ui/server.cjs',
        'Main React': 'module-assembler-ui/src/App.jsx',
        'React Entry': 'module-assembler-ui/src/main.jsx',
        'Master Agent': 'module-assembler-ui/lib/agents/master-agent.cjs',
        'AI Pipeline': 'module-assembler-ui/lib/services/ai-pipeline.cjs'
      },
      warnings: ['Primary app is in module-assembler-ui/, NOT root level']
    }
  },
  'command-center': {
    path: process.env.RALPH_COMMANDCENTER_PATH || 'C:/Users/huddl/command-center',
    ralphDir: 'scripts/ralph',
    structure: {
      description: 'ATLAS - AI Business Orchestration Platform',
      serverEntry: 'server.js',
      frontendEntry: 'src/App.jsx',
      keyPaths: {
        pages: 'src/pages/',
        components: 'src/components/'
      },
      criticalFiles: {
        'Main Server': 'server.js',
        'Dashboard': 'src/pages/Dashboard.jsx',
        'TV Dashboard': 'src/pages/TVDashboard.jsx',
        'Ralph Visualizer': 'src/components/RalphVisualizer.jsx',
        'Quick Actions': 'src/components/QuickActionsPanel.jsx',
        'Agents Config': 'agents.json'
      },
      warnings: ['Single-level structure, server.js at root']
    }
  }
};

console.log('[Ralph] Configured projects:');
Object.entries(RALPH_PROJECTS).forEach(([name, config]) => {
  console.log(`  - ${name}: ${config.path}`);
});

// ==================== MEMORY PERSISTENCE ====================
// Fetch recent Wiki.js decisions for Prime's context
async function getRecentWikiDecisions(limit = 5) {
  if (!WIKI_API_KEY) return [];

  // Use pages.list to get all pages, then filter for Boardroom decisions
  const gqlQuery = `
    query ListPages {
      pages {
        list(orderBy: UPDATED, orderByDirection: DESC) {
          id
          path
          title
          description
          updatedAt
          createdAt
        }
      }
    }
  `;

  try {
    const result = await wikiGraphQL(gqlQuery);
    console.log('[Memory] Wiki pages.list result:', result?.pages?.list?.length || 0, 'pages');

    if (result?.pages?.list) {
      // Filter for decision pages (in decisions/ path or with decision in title)
      const boardroomPages = result.pages.list.filter(page =>
        page.title?.toLowerCase().includes('decision') ||
        page.description?.toLowerCase().includes('boardroom') ||
        page.path?.toLowerCase().includes('decisions')
      );

      console.log('[Memory] Found', boardroomPages.length, 'decision pages');

      // Return the most recent ones
      return boardroomPages.slice(0, limit).map(page => ({
        id: page.id,
        title: page.title,
        path: page.path,
        description: page.description,
        updatedAt: page.updatedAt
      }));
    }
  } catch (error) {
    console.error('[Memory] Failed to fetch Wiki decisions:', error.message);
  }
  return [];
}

// Create a memory snapshot of current system state
async function createMemorySnapshot() {
  console.log('[Memory] Creating snapshot...');

  const snapshot = {
    timestamp: new Date().toISOString(),
    version: '1.0',

    // Recent activity
    recentActivity: db.prepare(`
      SELECT * FROM activity_feed
      ORDER BY created_at DESC LIMIT 20
    `).all(),

    // Recent Ralph tasks
    recentTasks: db.prepare(`
      SELECT * FROM ralph_tasks
      WHERE created_at > datetime('now', '-7 days')
      ORDER BY created_at DESC LIMIT 10
    `).all(),

    // Calendar events (upcoming)
    upcomingEvents: db.prepare(`
      SELECT * FROM calendar_events
      WHERE event_date >= date('now')
      ORDER BY event_date ASC LIMIT 10
    `).all(),

    // API usage stats
    usageStats: db.prepare(`
      SELECT date, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost
      FROM api_usage
      WHERE date >= date('now', '-7 days')
      GROUP BY date
      ORDER BY date DESC
    `).all(),

    // Contacts
    contacts: db.prepare('SELECT name, phone, carrier, email FROM contacts').all(),

    // Wiki decisions (async)
    wikiDecisions: await getRecentWikiDecisions(5),

    // Git status for all projects
    projectStatus: {
      slabtrack: getProjectStatus('slabtrack'),
      blink: getProjectStatus('blink'),
      'command-center': getProjectStatus('command-center')
    }
  };

  // Save to database
  db.prepare(`
    INSERT INTO memory_snapshots (snapshot_type, data)
    VALUES (?, ?)
  `).run('full', JSON.stringify(snapshot));

  console.log('[Memory] Snapshot created successfully');
  return snapshot;
}

// Get the most recent memory snapshot
function getLatestSnapshot() {
  const row = db.prepare(`
    SELECT * FROM memory_snapshots
    WHERE snapshot_type = 'full'
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  if (row) {
    return {
      id: row.id,
      created_at: row.created_at,
      data: JSON.parse(row.data)
    };
  }
  return null;
}

// Build Prime's startup context from memory
async function buildPrimeStartupContext() {
  const context = [];

  // Load recent Wiki decisions
  const decisions = await getRecentWikiDecisions(5);
  if (decisions.length > 0) {
    context.push('=== RECENT BOARDROOM DECISIONS ===');
    decisions.forEach(d => {
      context.push(`• ${d.title} (${d.path}): ${d.description || 'No description'}`);
    });
  }

  // Load latest snapshot if available
  const snapshot = getLatestSnapshot();
  if (snapshot) {
    context.push(`\n=== LAST MEMORY SNAPSHOT (${snapshot.created_at}) ===`);

    if (snapshot.data.recentActivity?.length > 0) {
      context.push('Recent Activity:');
      snapshot.data.recentActivity.slice(0, 5).forEach(a => {
        context.push(`  • [${a.type}] ${a.action}`);
      });
    }

    if (snapshot.data.recentTasks?.length > 0) {
      context.push('Recent Ralph Tasks:');
      snapshot.data.recentTasks.slice(0, 3).forEach(t => {
        context.push(`  • ${t.project}: ${t.branch_name} (${t.status})`);
      });
    }

    if (snapshot.data.upcomingEvents?.length > 0) {
      context.push('Upcoming Events:');
      snapshot.data.upcomingEvents.slice(0, 3).forEach(e => {
        context.push(`  • ${e.title} on ${e.event_date}`);
      });
    }
  }

  return context.join('\n');
}

// Store Prime's startup context in memory for injection
let primeStartupContext = '';

// Initialize Prime's context on startup
(async () => {
  try {
    primeStartupContext = await buildPrimeStartupContext();
    if (primeStartupContext) {
      console.log('[Memory] Prime startup context loaded');
    }
  } catch (error) {
    console.error('[Memory] Failed to load Prime context:', error.message);
  }
})();

// ==================== SCHEDULED REPORTS ====================
const REPORT_EMAIL = process.env.REPORT_EMAIL || 'huddleeco@gmail.com';

// Central Time formatting helper
const formatCentralTime = (date, options = {}) => {
  const defaultOptions = { timeZone: 'America/Chicago' };
  return new Date(date).toLocaleString('en-US', { ...defaultOptions, ...options });
};

// Generate chat summary from conversation
function generateChatSummary(chatId, agentId, participants = []) {
  try {
    // Get all messages for this chat
    const messages = db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chatId);
    if (messages.length === 0) return null;

    // Get the last assistant message for context
    const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
    const lastUser = messages.filter(m => m.role === 'user').pop();

    if (!lastAssistant) return null;

    const content = lastAssistant.content;
    const userQuery = lastUser?.content || '';

    // Different summary strategies based on agent type
    let summary = '';

    if (agentId === 'townhall') {
      // Townhall: Focus on team alignment and decisions
      const participantCount = participants.length || 'multiple';
      if (content.includes('RECOMMENDATION') || content.includes('recommend')) {
        summary = `Team discussion with ${participantCount} agents - recommendations provided`;
      } else if (content.includes('approved') || content.includes('Approved')) {
        summary = `Team alignment meeting - ${participantCount} agents confirmed approach`;
      } else if (content.includes('decision') || content.includes('Decision')) {
        summary = `Strategic discussion with ${participantCount} agents - decisions made`;
      } else {
        summary = `Townhall meeting with ${participantCount} agents`;
      }
      // Add topic hint from user query
      if (userQuery.length > 10) {
        const topic = userQuery.slice(0, 50).replace(/[?!.,]/g, '').trim();
        summary += ` on "${topic}"`;
      }
    } else if (agentId === 'boardroom') {
      // Boardroom: Focus on strategic decisions
      if (content.includes('BOARD RECOMMENDATION')) {
        const match = content.match(/BOARD RECOMMENDATION[:\s]*([^\n]+)/i);
        summary = match ? `Decision: ${match[1].slice(0, 60)}` : 'Strategic decision made';
      } else if (content.includes('approved') || content.includes('Approved')) {
        summary = 'Strategic proposal approved';
      } else {
        summary = 'Strategic discussion conducted';
      }
    } else if (agentId === 'prime') {
      // Prime: Focus on briefings, context, priorities
      if (content.includes('briefing') || userQuery.includes('briefing')) {
        summary = 'Daily briefing and priorities discussed';
      } else if (content.includes('priorities') || content.includes('focus on')) {
        summary = 'Strategic priorities and focus areas defined';
      } else if (content.includes('Wiki') || content.includes('saved')) {
        summary = 'Context saved to Wiki for team reference';
      } else {
        summary = 'Executive strategy discussion';
      }
    } else if (agentId === 'scout') {
      // Scout: Focus on market research
      if (content.includes('RESEARCH REPORT') || content.includes('research')) {
        const topic = userQuery.slice(0, 40).replace(/[?!.,]/g, '').trim() || 'market analysis';
        summary = `Market research: ${topic}`;
      } else {
        summary = 'Market research and analysis conducted';
      }
    } else if (agentId === 'supplier') {
      summary = 'Supplier research and sourcing analysis';
    } else if (agentId === 'ads') {
      summary = 'Advertising strategy and campaign planning';
    } else if (agentId === 'content') {
      summary = 'Content creation and copywriting';
    } else if (agentId.startsWith('flint-')) {
      // Flint agents: Focus on platform-specific advice
      const platform = agentId.replace('flint-', '').toUpperCase();
      if (content.includes('PRD') || content.includes('product requirement')) {
        summary = `${platform} PRD and product planning`;
      } else if (content.includes('feature') || content.includes('build')) {
        summary = `${platform} feature discussion and planning`;
      } else {
        summary = `${platform} platform strategy discussion`;
      }
    } else {
      // Generic summary
      const topic = userQuery.slice(0, 50).replace(/[?!.,]/g, '').trim();
      summary = topic ? `Discussion: ${topic}` : `Conversation with ${agentId}`;
    }

    // Update the chat with the summary
    db.prepare('UPDATE chats SET summary = ? WHERE id = ?').run(summary, chatId);

    return summary;
  } catch (err) {
    console.error('[Summary] Failed to generate:', err.message);
    return null;
  }
}

// Auto-detect and create calendar events from agent messages
function detectAndCreateCalendarEvents(message, agentId) {
  try {
    const eventsCreated = [];

    // Month names for parsing
    const months = {
      'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
      'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
      'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8, 'october': 9, 'oct': 9,
      'november': 10, 'nov': 10, 'december': 11, 'dec': 11
    };

    // Pattern 1: "Month Day, Year at Time - Title" or "Month Day, Year - Title"
    // E.g., "January 31, 2026 at 9:00 AM - Check Scout competitor pricing research"
    const datePatterns = [
      // Full date with optional time: "January 31, 2026 at 9:00 AM - Event title"
      /\*?\*?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\s*(?:at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\s*[-–:]\s*(.+?)(?:\n|$)/gi,
      // Bullet format: "• January 31 - Event title"
      /[•\-\*]\s*\*?\*?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\s*(?:at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\s*[-–:]\s*(.+?)(?:\n|$)/gi,
      // "Add to calendar" format
      /add(?:ed)?\s+to\s+calendar[:\s]+(.+?)(?:\n|$)/gi,
      // Emoji format: "📅 Event on date"
      /📅\s*(.+?)(?:\n|$)/gi
    ];

    // Process each pattern
    for (const pattern of datePatterns) {
      let match;
      pattern.lastIndex = 0; // Reset regex

      while ((match = pattern.exec(message)) !== null) {
        let eventDate = null;
        let eventTime = null;
        let title = null;

        // Check if this is a date-based pattern (has month capture group)
        if (match.length >= 7 && months[match[1]?.toLowerCase()] !== undefined) {
          const monthNum = months[match[1].toLowerCase()];
          const day = parseInt(match[2]);
          const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();

          eventDate = `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

          // Parse time if present
          if (match[4]) {
            let hours = parseInt(match[4]);
            const minutes = match[5] || '00';
            const period = match[6]?.toLowerCase();

            if (period === 'pm' && hours < 12) hours += 12;
            if (period === 'am' && hours === 12) hours = 0;

            eventTime = `${String(hours).padStart(2, '0')}:${minutes}`;
          }

          title = match[7]?.trim();
        } else {
          // Generic pattern - try to parse the full text
          const eventText = match[1]?.trim();
          if (eventText) {
            const parsed = parseCalendarText(eventText);
            if (parsed) {
              eventDate = parsed.event_date;
              eventTime = parsed.event_time;
              title = parsed.title;
            }
          }
        }

        // Clean up title
        if (title) {
          title = title.replace(/^\*+|\*+$/g, '').trim(); // Remove markdown bold
          title = title.replace(/^[-–:]\s*/, '').trim(); // Remove leading dashes
        }

        if (eventDate && title && title.length > 3) {
          // Check if similar event already exists
          const existing = db.prepare(`
            SELECT id FROM calendar_events
            WHERE event_date = ? AND LOWER(title) = LOWER(?)
          `).get(eventDate, title);

          if (!existing) {
            const eventColor = getEventColor(title, null);
            const result = db.prepare(`
              INSERT INTO calendar_events (title, event_date, event_time, event_type, color, created_by)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(title, eventDate, eventTime, 'general', eventColor, agentId);

            console.log(`[Calendar] Auto-created event: "${title}" on ${eventDate}${eventTime ? ' at ' + eventTime : ''} by ${agentId}`);

            // Emit socket event to refresh calendar
            if (typeof io !== 'undefined') {
              io.emit('calendar_event_created', { id: result.lastInsertRowid, title, event_date: eventDate, event_time: eventTime, color: eventColor });
            }

            eventsCreated.push({ id: result.lastInsertRowid, title, event_date: eventDate, event_time: eventTime, color: eventColor });
          }
        }
      }
    }

    if (eventsCreated.length > 0) {
      console.log(`[Calendar] Created ${eventsCreated.length} events from agent ${agentId}`);
    }

    return eventsCreated;
  } catch (err) {
    console.error('[Calendar] Failed to detect events:', err.message);
    return [];
  }
}

// Generate Morning Briefing content
async function generateMorningBriefing() {
  const today = formatCentralTime(new Date(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Get overnight activity (last 12 hours)
  const recentActivity = db.prepare(`
    SELECT * FROM activity_feed
    WHERE created_at > datetime('now', '-12 hours')
    ORDER BY created_at DESC LIMIT 10
  `).all();

  // Get today's calendar events
  const todayEvents = db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date = date('now')
    ORDER BY event_time ASC
  `).all();

  // Get upcoming events (next 3 days)
  const upcomingEvents = db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date > date('now') AND event_date <= date('now', '+3 days')
    ORDER BY event_date ASC, event_time ASC
  `).all();

  // Get Wiki decisions
  const decisions = await getRecentWikiDecisions(3);

  // Get project status
  const projects = ['slabtrack', 'blink', 'command-center'];
  const projectStatus = {};
  for (const proj of projects) {
    try {
      projectStatus[proj] = getProjectStatus(proj);
    } catch (e) { /* ignore */ }
  }

  // Get yesterday's API costs
  const yesterdayCost = db.prepare(`
    SELECT SUM(cost) as cost, SUM(tokens_in + tokens_out) as tokens
    FROM api_usage WHERE date = date('now', '-1 day')
  `).get();

  // NEW: Get system health
  const health = await getSystemHealth();

  // NEW: Get pending/failed Ralph tasks from yesterday
  const pendingRalphTasks = db.prepare(`
    SELECT * FROM ralph_tasks
    WHERE status IN ('pending', 'failed', 'in_progress')
    AND created_at < datetime('now', '-12 hours')
    ORDER BY created_at DESC LIMIT 5
  `).all();

  // NEW: Get yesterday's agent usage breakdown
  const yesterdayAgentUsage = db.prepare(`
    SELECT agent, COUNT(*) as calls, SUM(cost) as cost
    FROM api_calls
    WHERE date(timestamp) = date('now', '-1 day')
    GROUP BY agent
    ORDER BY calls DESC
    LIMIT 5
  `).all();

  // NEW: Get yesterday's conversation count
  const yesterdayConversations = db.prepare(`
    SELECT COUNT(DISTINCT chat_id) as chats, COUNT(*) as messages
    FROM messages
    WHERE date(created_at) = date('now', '-1 day')
  `).get();

  // NEW: Generate dynamic greeting based on activity
  let greeting = '☀️ Good Morning, Founder!';
  let subtitle = '';
  if (recentActivity.length === 0 && !yesterdayCost?.cost) {
    subtitle = 'Quiet night - systems running smoothly.';
  } else if (recentActivity.length > 5) {
    subtitle = `Busy overnight! ${recentActivity.length} events recorded.`;
  } else if (pendingRalphTasks.length > 0) {
    subtitle = `${pendingRalphTasks.length} task(s) need your attention.`;
  } else {
    subtitle = 'Ready to tackle the day.';
  }

  let content = `<h2>${greeting}</h2>`;
  content += `<p style="color: #666;">Today is ${today}</p>`;
  content += `<p style="color: #888; font-style: italic;">${subtitle}</p>`;

  // NEW: System Health Status
  content += `<h3>🖥️ System Health</h3>`;
  const healthIcon = health.status === 'healthy' ? '🟢' : health.status === 'degraded' ? '🟡' : '🔴';
  content += `<p>${healthIcon} <strong>${health.status?.toUpperCase() || 'UNKNOWN'}</strong></p>`;
  content += `<ul>`;
  content += `<li>Server: ${health.server || 'N/A'}</li>`;
  content += `<li>Database: ${health.database?.status || 'N/A'} (${health.database?.chats || 0} chats, ${health.database?.messages || 0} messages)</li>`;
  content += `<li>Agents: ${health.agents?.total || 0} configured, ${health.agents?.online || 0} online</li>`;
  if (health.ralph) {
    content += `<li>Ralph Worker: ${health.ralph.connected ? '🟢 Connected' : '🔴 Disconnected'}</li>`;
  }
  content += `</ul>`;

  // NEW: Pending/Failed Tasks needing attention
  if (pendingRalphTasks.length > 0) {
    content += `<h3>⚠️ Tasks Needing Attention</h3><ul>`;
    pendingRalphTasks.forEach(t => {
      const icon = t.status === 'failed' ? '❌' : '🔄';
      const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60));
      content += `<li>${icon} <strong>${t.project}</strong>: ${t.task?.slice(0, 40) || t.branch_name} <span style="color: #888;">(${age}h ago)</span></li>`;
    });
    content += `</ul>`;
  }

  // Today's Calendar
  if (todayEvents.length > 0) {
    content += `<h3>📅 Today's Schedule</h3><ul>`;
    todayEvents.forEach(e => {
      content += `<li><strong>${e.event_time || 'All day'}</strong> - ${e.title}</li>`;
    });
    content += `</ul>`;
  } else {
    content += `<h3>📅 Today's Schedule</h3><p style="color: #888;">No events scheduled - open day for deep work.</p>`;
  }

  // Upcoming (next 3 days)
  if (upcomingEvents.length > 0) {
    content += `<h3>📆 Coming Up (Next 3 Days)</h3><ul>`;
    upcomingEvents.slice(0, 5).forEach(e => {
      const dateStr = formatCentralTime(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' });
      content += `<li><strong>${dateStr}</strong> ${e.event_time || ''} - ${e.title}</li>`;
    });
    content += `</ul>`;
  }

  // Overnight Activity
  if (recentActivity.length > 0) {
    content += `<h3>🌙 Overnight Activity</h3><ul>`;
    recentActivity.slice(0, 5).forEach(a => {
      content += `<li><strong>[${a.type}]</strong> ${a.action}</li>`;
    });
    content += `</ul>`;
  }

  // Platform Status with more detail
  content += `<h3>🚀 Platform Status</h3>`;
  let hasProjectActivity = false;
  for (const [proj, status] of Object.entries(projectStatus)) {
    if (status.recentCommits?.length > 0) {
      hasProjectActivity = true;
      content += `<p><strong>${proj}</strong> (${status.currentBranch || 'main'})</p><ul>`;
      status.recentCommits.slice(0, 2).forEach(c => {
        content += `<li style="color: #666;">${c}</li>`;
      });
      content += `</ul>`;
    }
  }
  if (!hasProjectActivity) {
    content += `<p style="color: #888;">No recent commits across projects.</p>`;
  }

  // NEW: Yesterday's Agent Usage
  if (yesterdayAgentUsage.length > 0) {
    content += `<h3>🤖 Yesterday's Agent Activity</h3>`;
    content += `<p>${yesterdayConversations?.chats || 0} conversations, ${yesterdayConversations?.messages || 0} messages</p>`;
    content += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
    content += `<tr style="background: #f5f5f5;"><th style="padding: 5px; text-align: left;">Agent</th><th style="padding: 5px;">Calls</th><th style="padding: 5px;">Cost</th></tr>`;
    yesterdayAgentUsage.forEach(a => {
      content += `<tr><td style="padding: 5px;">${a.agent}</td><td style="padding: 5px; text-align: center;">${a.calls}</td><td style="padding: 5px; text-align: right;">$${(a.cost || 0).toFixed(4)}</td></tr>`;
    });
    content += `</table>`;
  }

  // Top Priorities (from recent decisions)
  if (decisions.length > 0) {
    content += `<h3>🎯 Recent Decisions</h3><ul>`;
    decisions.forEach(d => {
      content += `<li><strong>${d.title}</strong>: ${d.description || 'See Wiki'}</li>`;
    });
    content += `</ul>`;
  }

  // Yesterday's Costs Summary
  content += `<h3>💰 Yesterday's API Usage</h3>`;
  if (yesterdayCost?.cost) {
    content += `<p><strong>$${yesterdayCost.cost.toFixed(4)}</strong> (${yesterdayCost.tokens?.toLocaleString() || 0} tokens)</p>`;
  } else {
    content += `<p style="color: #888;">No API usage recorded yesterday.</p>`;
  }

  content += `<hr><p style="color: #888; font-size: 12px;">Generated by ATLAS at ${formatCentralTime(new Date(), { hour: 'numeric', minute: '2-digit' })}</p>`;

  return content;
}

// Generate Evening Summary content
async function generateEveningSummary() {
  const today = formatCentralTime(new Date(), { weekday: 'long', month: 'long', day: 'numeric' });

  // Get today's activity
  const todayActivity = db.prepare(`
    SELECT * FROM activity_feed
    WHERE date(created_at) = date('now')
    ORDER BY created_at DESC
  `).all();

  // Get today's API costs
  const todayCost = db.prepare(`
    SELECT SUM(cost) as cost, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out
    FROM api_usage WHERE date = date('now')
  `).get();

  // Get today's Ralph tasks
  const ralphTasks = db.prepare(`
    SELECT * FROM ralph_tasks
    WHERE date(created_at) = date('now')
    ORDER BY created_at DESC
  `).all();

  // Get tomorrow's events
  const tomorrowEvents = db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date = date('now', '+1 day')
    ORDER BY event_time ASC
  `).all();

  // NEW: Get today's agent usage with details
  const todayAgentUsage = db.prepare(`
    SELECT agent, COUNT(*) as calls, SUM(cost) as cost, SUM(tokens_in + tokens_out) as tokens
    FROM api_calls
    WHERE date(timestamp) = date('now')
    GROUP BY agent
    ORDER BY calls DESC
  `).all();

  // NEW: Get today's conversation count and unique chats
  const todayConversations = db.prepare(`
    SELECT COUNT(DISTINCT chat_id) as chats, COUNT(*) as messages
    FROM messages
    WHERE date(created_at) = date('now')
  `).get();

  // NEW: Get today's Wiki pages created
  const todayWikiPages = await getRecentWikiDecisions(5);
  const todayDecisions = todayWikiPages.filter(d => {
    // Check if created today (approximate - Wiki API may not give exact timestamps)
    return d.createdAt && new Date(d.createdAt).toDateString() === new Date().toDateString();
  });

  // NEW: Get pending tasks that need follow-up
  const pendingTasks = db.prepare(`
    SELECT * FROM ralph_tasks
    WHERE status IN ('pending', 'in_progress')
    ORDER BY created_at DESC LIMIT 5
  `).all();

  // NEW: Get week's running cost total for comparison
  const weekCost = db.prepare(`
    SELECT SUM(cost) as cost FROM api_usage WHERE date >= date('now', '-7 days')
  `).get();

  // NEW: Get commits made today across projects
  const projects = ['slabtrack', 'blink', 'command-center'];
  const todayCommits = [];
  for (const proj of projects) {
    try {
      const status = getProjectStatus(proj);
      if (status.recentCommits?.length > 0) {
        // Check if any commits are from today (heuristic based on commit message recency)
        status.recentCommits.slice(0, 3).forEach(c => {
          todayCommits.push({ project: proj, commit: c });
        });
      }
    } catch (e) { /* ignore */ }
  }

  // Dynamic greeting based on productivity
  let greeting = '🌙 Good Evening, Founder!';
  let subtitle = '';
  const completedRalph = ralphTasks.filter(t => t.status === 'completed').length;
  const failedRalph = ralphTasks.filter(t => t.status === 'failed').length;

  if (completedRalph >= 3) {
    subtitle = `Productive day! ${completedRalph} tasks completed.`;
  } else if (todayActivity.length > 10) {
    subtitle = `Busy day with ${todayActivity.length} activities logged.`;
  } else if (failedRalph > 0) {
    subtitle = `${failedRalph} task(s) failed - may need review.`;
  } else if (todayConversations?.chats > 5) {
    subtitle = `${todayConversations.chats} conversations across agents.`;
  } else {
    subtitle = 'Day complete. Time to recharge.';
  }

  let content = `<h2>${greeting}</h2>`;
  content += `<p style="color: #666;">${today} Summary</p>`;
  content += `<p style="color: #888; font-style: italic;">${subtitle}</p>`;

  // NEW: Quick Stats Dashboard
  content += `<h3>📊 Today at a Glance</h3>`;
  content += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">`;
  content += `<tr>`;
  content += `<td style="text-align: center; padding: 10px; background: #f0f7ff; border-radius: 8px;">`;
  content += `<div style="font-size: 24px; font-weight: bold; color: #2563eb;">${todayConversations?.chats || 0}</div>`;
  content += `<div style="font-size: 12px; color: #666;">Conversations</div></td>`;
  content += `<td style="text-align: center; padding: 10px; background: #f0fdf4; border-radius: 8px;">`;
  content += `<div style="font-size: 24px; font-weight: bold; color: #16a34a;">${completedRalph}</div>`;
  content += `<div style="font-size: 12px; color: #666;">Tasks Done</div></td>`;
  content += `<td style="text-align: center; padding: 10px; background: #fefce8; border-radius: 8px;">`;
  content += `<div style="font-size: 24px; font-weight: bold; color: #ca8a04;">$${(todayCost?.cost || 0).toFixed(2)}</div>`;
  content += `<div style="font-size: 12px; color: #666;">API Cost</div></td>`;
  content += `<td style="text-align: center; padding: 10px; background: #fdf2f8; border-radius: 8px;">`;
  content += `<div style="font-size: 24px; font-weight: bold; color: #db2777;">${todayActivity.length}</div>`;
  content += `<div style="font-size: 12px; color: #666;">Activities</div></td>`;
  content += `</tr></table>`;

  // NEW: Agent Usage Breakdown
  if (todayAgentUsage.length > 0) {
    content += `<h3>🤖 Agent Conversations</h3>`;
    content += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
    content += `<tr style="background: #f5f5f5;"><th style="padding: 8px; text-align: left;">Agent</th><th style="padding: 8px; text-align: center;">Calls</th><th style="padding: 8px; text-align: right;">Cost</th></tr>`;
    todayAgentUsage.forEach(a => {
      const agentIcon = a.agent === 'prime' ? '👔' : a.agent?.includes('flint') ? '🔧' : a.agent === 'ralph' ? '🔨' : '🤖';
      content += `<tr><td style="padding: 8px;">${agentIcon} ${a.agent}</td><td style="padding: 8px; text-align: center;">${a.calls}</td><td style="padding: 8px; text-align: right;">$${(a.cost || 0).toFixed(4)}</td></tr>`;
    });
    content += `</table>`;
  }

  // Ralph Tasks with more detail
  if (ralphTasks.length > 0) {
    content += `<h3>🔨 Ralph Development Tasks</h3><ul>`;
    ralphTasks.forEach(t => {
      const status = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '🔄';
      const duration = t.completed_at && t.created_at ?
        Math.round((new Date(t.completed_at) - new Date(t.created_at)) / (1000 * 60)) + ' min' : '';
      content += `<li>${status} <strong>${t.project}</strong>: ${t.task?.slice(0, 50) || t.branch_name}`;
      if (duration) content += ` <span style="color: #888;">(${duration})</span>`;
      content += `</li>`;
    });
    content += `</ul>`;
  }

  // NEW: Today's Code Changes
  if (todayCommits.length > 0) {
    content += `<h3>💻 Recent Code Changes</h3><ul>`;
    todayCommits.slice(0, 5).forEach(c => {
      content += `<li><strong>${c.project}</strong>: ${c.commit}</li>`;
    });
    content += `</ul>`;
  }

  // NEW: Decisions Made Today
  if (todayDecisions.length > 0) {
    content += `<h3>📋 Decisions Documented</h3><ul>`;
    todayDecisions.forEach(d => {
      content += `<li><strong>${d.title}</strong></li>`;
    });
    content += `</ul>`;
  }

  // NEW: Pending Items
  if (pendingTasks.length > 0) {
    content += `<h3>⏳ Pending Tasks</h3><ul>`;
    pendingTasks.forEach(t => {
      const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60));
      content += `<li><strong>${t.project}</strong>: ${t.task?.slice(0, 40) || 'In progress'} <span style="color: #888;">(${age}h)</span></li>`;
    });
    content += `</ul>`;
  }

  // API Costs with comparison
  content += `<h3>💰 Today's API Usage</h3>`;
  if (todayCost?.cost) {
    content += `<p><strong>$${todayCost.cost.toFixed(4)}</strong></p>`;
    content += `<p>Input: ${todayCost.tokens_in?.toLocaleString() || 0} tokens | Output: ${todayCost.tokens_out?.toLocaleString() || 0} tokens</p>`;
    if (weekCost?.cost) {
      const weeklyAvg = weekCost.cost / 7;
      const comparison = todayCost.cost > weeklyAvg ?
        `📈 ${((todayCost.cost / weeklyAvg - 1) * 100).toFixed(0)}% above weekly avg` :
        `📉 ${((1 - todayCost.cost / weeklyAvg) * 100).toFixed(0)}% below weekly avg`;
      content += `<p style="color: #888; font-size: 12px;">${comparison} ($${weeklyAvg.toFixed(4)}/day)</p>`;
    }
  } else {
    content += `<p style="color: #888;">No API usage recorded today.</p>`;
  }

  // Tomorrow's Focus
  content += `<h3>📅 Tomorrow's Schedule</h3>`;
  if (tomorrowEvents.length > 0) {
    content += `<ul>`;
    tomorrowEvents.forEach(e => {
      content += `<li><strong>${e.event_time || 'All day'}</strong> - ${e.title}</li>`;
    });
    content += `</ul>`;
  } else {
    content += `<p style="color: #888;">No events scheduled - clear day ahead.</p>`;
  }

  content += `<hr><p style="color: #888; font-size: 12px;">Generated by ATLAS at ${formatCentralTime(new Date(), { hour: 'numeric', minute: '2-digit' })}</p>`;

  return content;
}

// Generate Weekly Review content
async function generateWeeklyReview() {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekLabel = formatCentralTime(weekStart, { month: 'long', day: 'numeric' });
  const weekEnd = formatCentralTime(new Date(), { month: 'long', day: 'numeric' });

  // Get week's API costs by day
  const weekCost = db.prepare(`
    SELECT date, SUM(cost) as cost, SUM(tokens_in + tokens_out) as tokens
    FROM api_usage
    WHERE date >= date('now', '-7 days')
    GROUP BY date
    ORDER BY date DESC
  `).all();

  const totalCost = weekCost.reduce((sum, d) => sum + (d.cost || 0), 0);

  // Get previous week's cost for comparison
  const prevWeekCost = db.prepare(`
    SELECT SUM(cost) as cost FROM api_usage
    WHERE date >= date('now', '-14 days') AND date < date('now', '-7 days')
  `).get();

  // Get week's activity by type
  const weekActivity = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM activity_feed
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY type
    ORDER BY count DESC
  `).all();

  const totalActivity = weekActivity.reduce((sum, a) => sum + a.count, 0);

  // Get week's Ralph tasks
  const weekRalph = db.prepare(`
    SELECT project, status, COUNT(*) as count
    FROM ralph_tasks
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY project, status
  `).all();

  // Get week's Ralph summary
  const ralphCompleted = weekRalph.filter(r => r.status === 'completed').reduce((sum, r) => sum + r.count, 0);
  const ralphFailed = weekRalph.filter(r => r.status === 'failed').reduce((sum, r) => sum + r.count, 0);
  const ralphTotal = weekRalph.reduce((sum, r) => sum + r.count, 0);

  // Get week's agent usage
  const weekAgentUsage = db.prepare(`
    SELECT agent, COUNT(*) as calls, SUM(cost) as cost
    FROM api_calls
    WHERE date(timestamp) >= date('now', '-7 days')
    GROUP BY agent
    ORDER BY calls DESC
  `).all();

  // Get week's conversation stats
  const weekConversations = db.prepare(`
    SELECT COUNT(DISTINCT chat_id) as chats, COUNT(*) as messages
    FROM messages
    WHERE date(created_at) >= date('now', '-7 days')
  `).get();

  // Get busiest day
  const busiestDay = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM activity_feed
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY count DESC
    LIMIT 1
  `).get();

  // Get all decisions
  const decisions = await getRecentWikiDecisions(10);

  // Get next week's events
  const nextWeekEvents = db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date >= date('now') AND event_date <= date('now', '+7 days')
    ORDER BY event_date ASC, event_time ASC
  `).all();

  // Get project commits this week
  const projects = ['slabtrack', 'blink', 'command-center'];
  const projectCommits = {};
  for (const proj of projects) {
    try {
      const status = getProjectStatus(proj);
      projectCommits[proj] = status.recentCommits?.length || 0;
    } catch (e) { /* ignore */ }
  }

  // Dynamic intro
  let weekSummary = '';
  if (ralphCompleted >= 10) {
    weekSummary = `Exceptional week with ${ralphCompleted} development tasks completed!`;
  } else if (totalActivity > 50) {
    weekSummary = `High-activity week with ${totalActivity} events across all systems.`;
  } else if (totalCost > (prevWeekCost?.cost || 0) * 1.5) {
    weekSummary = 'Increased AI usage this week - lots of strategic discussions.';
  } else {
    weekSummary = 'Steady progress across all projects.';
  }

  let content = `<h2>📊 Weekly Review</h2>`;
  content += `<p style="color: #666;">Week of ${weekLabel} - ${weekEnd}</p>`;
  content += `<p style="color: #888; font-style: italic;">${weekSummary}</p>`;

  // Week at a Glance - Stats Dashboard
  content += `<h3>📈 Week at a Glance</h3>`;
  content += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">`;
  content += `<tr>`;
  content += `<td style="text-align: center; padding: 15px; background: #f0f7ff; border-radius: 8px;">`;
  content += `<div style="font-size: 28px; font-weight: bold; color: #2563eb;">${weekConversations?.chats || 0}</div>`;
  content += `<div style="font-size: 12px; color: #666;">Conversations</div></td>`;
  content += `<td style="text-align: center; padding: 15px; background: #f0fdf4; border-radius: 8px;">`;
  content += `<div style="font-size: 28px; font-weight: bold; color: #16a34a;">${ralphCompleted}</div>`;
  content += `<div style="font-size: 12px; color: #666;">Tasks Done</div></td>`;
  content += `<td style="text-align: center; padding: 15px; background: #fefce8; border-radius: 8px;">`;
  content += `<div style="font-size: 28px; font-weight: bold; color: #ca8a04;">$${totalCost.toFixed(2)}</div>`;
  content += `<div style="font-size: 12px; color: #666;">API Spend</div></td>`;
  content += `<td style="text-align: center; padding: 15px; background: #fdf2f8; border-radius: 8px;">`;
  content += `<div style="font-size: 28px; font-weight: bold; color: #db2777;">${totalActivity}</div>`;
  content += `<div style="font-size: 12px; color: #666;">Activities</div></td>`;
  content += `</tr></table>`;

  // Cost Comparison
  if (prevWeekCost?.cost) {
    const costChange = ((totalCost / prevWeekCost.cost) - 1) * 100;
    const changeIcon = costChange > 0 ? '📈' : '📉';
    const changeColor = costChange > 20 ? '#dc2626' : costChange < -20 ? '#16a34a' : '#888';
    content += `<p style="color: ${changeColor};">${changeIcon} ${costChange > 0 ? '+' : ''}${costChange.toFixed(1)}% vs previous week ($${prevWeekCost.cost.toFixed(2)})</p>`;
  }

  // Agent Usage Ranking
  if (weekAgentUsage.length > 0) {
    content += `<h3>🤖 Agent Leaderboard</h3>`;
    content += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
    content += `<tr style="background: #f5f5f5;"><th style="padding: 8px; text-align: left;">Agent</th><th style="padding: 8px; text-align: center;">Calls</th><th style="padding: 8px; text-align: right;">Cost</th><th style="padding: 8px; text-align: right;">% of Total</th></tr>`;
    weekAgentUsage.slice(0, 8).forEach((a, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
      const pct = totalCost > 0 ? ((a.cost || 0) / totalCost * 100).toFixed(1) : '0';
      content += `<tr><td style="padding: 8px;">${medal} ${a.agent}</td><td style="padding: 8px; text-align: center;">${a.calls}</td><td style="padding: 8px; text-align: right;">$${(a.cost || 0).toFixed(4)}</td><td style="padding: 8px; text-align: right;">${pct}%</td></tr>`;
    });
    content += `</table>`;
  }

  // Daily Cost Breakdown
  content += `<h3>💰 Daily API Costs</h3>`;
  if (weekCost.length > 0) {
    content += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
    content += `<tr style="background: #f5f5f5;"><th style="padding: 8px; text-align: left;">Date</th><th style="padding: 8px; text-align: right;">Cost</th><th style="padding: 8px; text-align: right;">Tokens</th></tr>`;
    weekCost.forEach(d => {
      const dayName = formatCentralTime(d.date, { weekday: 'short' });
      content += `<tr><td style="padding: 8px;">${dayName} ${d.date}</td><td style="padding: 8px; text-align: right;">$${d.cost?.toFixed(4) || '0.00'}</td><td style="padding: 8px; text-align: right;">${d.tokens?.toLocaleString() || 0}</td></tr>`;
    });
    content += `</table>`;
  }

  // Project Development Summary
  content += `<h3>💻 Development Summary</h3>`;
  const totalCommits = Object.values(projectCommits).reduce((sum, c) => sum + c, 0);
  content += `<p>${totalCommits} commits across ${Object.keys(projectCommits).length} projects</p>`;
  content += `<ul>`;
  for (const [proj, commits] of Object.entries(projectCommits)) {
    if (commits > 0) {
      content += `<li><strong>${proj}</strong>: ${commits} recent commits</li>`;
    }
  }
  content += `</ul>`;

  // Ralph Development Tasks
  if (ralphTotal > 0) {
    content += `<h3>🔨 Ralph Development Tasks</h3>`;
    content += `<p>Total: ${ralphTotal} tasks | ✅ ${ralphCompleted} completed | ❌ ${ralphFailed} failed</p>`;

    // Group by project
    const byProject = {};
    weekRalph.forEach(r => {
      if (!byProject[r.project]) byProject[r.project] = { completed: 0, failed: 0, pending: 0 };
      byProject[r.project][r.status] = r.count;
    });

    content += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
    content += `<tr style="background: #f5f5f5;"><th style="padding: 8px; text-align: left;">Project</th><th style="padding: 8px; text-align: center;">✅</th><th style="padding: 8px; text-align: center;">❌</th><th style="padding: 8px; text-align: center;">🔄</th></tr>`;
    for (const [proj, stats] of Object.entries(byProject)) {
      content += `<tr><td style="padding: 8px;">${proj}</td><td style="padding: 8px; text-align: center;">${stats.completed || 0}</td><td style="padding: 8px; text-align: center;">${stats.failed || 0}</td><td style="padding: 8px; text-align: center;">${stats.pending || stats.in_progress || 0}</td></tr>`;
    }
    content += `</table>`;
  }

  // Activity Breakdown
  if (weekActivity.length > 0) {
    content += `<h3>📊 Activity Breakdown</h3>`;
    content += `<ul>`;
    weekActivity.forEach(a => {
      const pct = ((a.count / totalActivity) * 100).toFixed(0);
      content += `<li><strong>${a.type}</strong>: ${a.count} (${pct}%)</li>`;
    });
    content += `</ul>`;
    if (busiestDay) {
      const dayName = formatCentralTime(busiestDay.date, { weekday: 'long', month: 'short', day: 'numeric' });
      content += `<p style="color: #888;">Busiest day: ${dayName} with ${busiestDay.count} events</p>`;
    }
  }

  // Boardroom Decisions
  if (decisions.length > 0) {
    content += `<h3>📋 Strategic Decisions</h3><ul>`;
    decisions.slice(0, 5).forEach(d => {
      content += `<li><strong>${d.title}</strong>${d.description ? ': ' + d.description.slice(0, 60) + '...' : ''}</li>`;
    });
    content += `</ul>`;
  }

  // Next Week Preview
  content += `<h3>📅 Looking Ahead</h3>`;
  if (nextWeekEvents.length > 0) {
    content += `<ul>`;
    nextWeekEvents.forEach(e => {
      const dateStr = formatCentralTime(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' });
      content += `<li><strong>${dateStr}</strong> ${e.event_time || ''} - ${e.title}</li>`;
    });
    content += `</ul>`;
  } else {
    content += `<p style="color: #888;">No scheduled events - week open for focused work.</p>`;
  }

  content += `<hr><p style="color: #888; font-size: 12px;">Generated by ATLAS at ${formatCentralTime(new Date(), { hour: 'numeric', minute: '2-digit' })} CT</p>`;

  return content;
}

// Send scheduled report email
async function sendScheduledReport(type, subject, content) {
  if (!process.env.SMTP_USER) {
    console.log(`[Reports] Skipping ${type} - no SMTP configured`);
    return;
  }

  try {
    console.log(`[Reports] Generating ${type} report...`);

    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: REPORT_EMAIL,
      subject: subject,
      html: content
    });

    // Log the report
    logActivity('report', 'system', `${type} report sent`, `To: ${REPORT_EMAIL}`);
    console.log(`[Reports] ${type} report sent to ${REPORT_EMAIL}`);

  } catch (error) {
    console.error(`[Reports] Failed to send ${type}:`, error.message);
  }
}

// Schedule reports using node-cron
// Morning Briefing: 6:00 AM Central Time daily
cron.schedule('0 6 * * *', async () => {
  const today = formatCentralTime(new Date(), { month: 'short', day: 'numeric' });
  const content = await generateMorningBriefing();
  await sendScheduledReport('Morning Briefing', `☀️ ATLAS Morning Briefing - ${today}`, content);
}, { timezone: 'America/Chicago' });

// Evening Summary: 10:00 PM Central Time daily
cron.schedule('0 22 * * *', async () => {
  const today = formatCentralTime(new Date(), { month: 'short', day: 'numeric' });
  const content = await generateEveningSummary();
  await sendScheduledReport('Evening Summary', `🌙 ATLAS Evening Summary - ${today}`, content);
}, { timezone: 'America/Chicago' });

// Weekly Review: Sunday 8:00 PM Central Time
cron.schedule('0 20 * * 0', async () => {
  const weekOf = formatCentralTime(new Date(), { month: 'short', day: 'numeric' });
  const content = await generateWeeklyReview();
  await sendScheduledReport('Weekly Review', `📊 ATLAS Weekly Review - Week of ${weekOf}`, content);
}, { timezone: 'America/Chicago' });

// Midnight memory snapshot (Central Time)
cron.schedule('0 0 * * *', async () => {
  console.log('[Memory] Midnight auto-save triggered');
  try {
    await createMemorySnapshot();
  } catch (err) {
    console.error('[Memory] Auto-save failed:', err.message);
  }
});

console.log('[Reports] Scheduled reports configured:');
console.log('  - Morning Briefing: 6:00 AM daily');
console.log('  - Evening Summary: 10:00 PM daily');
console.log('  - Weekly Review: Sunday 8:00 PM');
console.log('  - Memory Snapshot: Midnight daily');

// ==================== GIT AWARENESS FOR FLINTS ====================
const { execSync } = require('child_process');

// Get recent git commits for a project
function getGitLog(project, count = 5) {
  const projectConfig = RALPH_PROJECTS[project];
  if (!projectConfig) return { success: false, error: `Unknown project: ${project}` };

  try {
    const result = execSync(`git log -${count} --oneline`, {
      cwd: projectConfig.path,
      encoding: 'utf8',
      timeout: 10000
    });
    return { success: true, commits: result.trim().split('\n') };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get current branch and list of branches
function getGitBranches(project) {
  const projectConfig = RALPH_PROJECTS[project];
  if (!projectConfig) return { success: false, error: `Unknown project: ${project}` };

  try {
    const current = execSync('git branch --show-current', {
      cwd: projectConfig.path,
      encoding: 'utf8',
      timeout: 10000
    }).trim();

    const branches = execSync('git branch -a --format="%(refname:short)"', {
      cwd: projectConfig.path,
      encoding: 'utf8',
      timeout: 10000
    }).trim().split('\n').filter(b => b && !b.includes('HEAD'));

    // Find in-progress branches (feature/, fix/, ralph/)
    const inProgress = branches.filter(b =>
      b.startsWith('feature/') || b.startsWith('fix/') || b.startsWith('ralph/')
    );

    return { success: true, current, branches, inProgress };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Search for TODO comments in codebase
function getGitTodos(project) {
  const projectConfig = RALPH_PROJECTS[project];
  if (!projectConfig) return { success: false, error: `Unknown project: ${project}` };

  try {
    // Use git grep to find TODOs (faster and respects .gitignore)
    // Windows-compatible: use try/catch instead of shell redirection
    let result = '';
    try {
      result = execSync('git grep -n -E "TODO|FIXME|HACK|XXX" -- "*.js" "*.jsx" "*.ts" "*.tsx"', {
        cwd: projectConfig.path,
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'] // Suppress stderr
      });
    } catch (grepError) {
      // git grep returns exit code 1 when no matches found - that's OK
      if (grepError.status === 1) {
        return { success: true, todos: [], count: 0 };
      }
      throw grepError;
    }
    const todos = result.trim().split('\n').filter(l => l).slice(0, 20); // Limit to 20
    return { success: true, todos, count: todos.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Read ROADMAP.md or TODO.md if exists
function getRoadmap(project) {
  const projectConfig = RALPH_PROJECTS[project];
  if (!projectConfig) return { success: false, error: `Unknown project: ${project}` };

  const fs = require('fs');
  const possibleFiles = ['ROADMAP.md', 'TODO.md', 'roadmap.md', 'todo.md'];

  for (const file of possibleFiles) {
    const filePath = path.join(projectConfig.path, file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return { success: true, file, content: content.slice(0, 2000) }; // Limit size
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }
  return { success: false, error: 'No ROADMAP.md or TODO.md found' };
}

// Get full project status for a Flint
function getProjectStatus(project) {
  const log = getGitLog(project, 5);
  const branches = getGitBranches(project);
  const todos = getGitTodos(project);
  const roadmap = getRoadmap(project);

  return {
    project,
    recentCommits: log.success ? log.commits : [],
    currentBranch: branches.success ? branches.current : 'unknown',
    inProgressBranches: branches.success ? branches.inProgress : [],
    todos: todos.success ? todos.todos : [],
    roadmap: roadmap.success ? { file: roadmap.file, content: roadmap.content } : null
  };
}

// Track active Ralph processes
const activeRalphProcesses = new Map();
const ralphWorkers = new Map(); // Connected Ralph workers (from ralph-worker.js)

async function triggerRalph(project, task, prdContent, triggeredBy = 'user') {
  // Validate project name (not path - paths are on the worker)
  const projectConfig = RALPH_PROJECTS[project];
  if (!projectConfig) {
    return { success: false, error: `Unknown project: ${project}. Valid: ${Object.keys(RALPH_PROJECTS).join(', ')}` };
  }

  // Check if any workers are connected FIRST
  if (ralphWorkers.size === 0) {
    return {
      success: false,
      error: 'No Ralph workers connected. Start ralph-worker.js on your workstation where the code lives.'
    };
  }

  // Check if a worker supports this project
  let hasWorkerForProject = false;
  for (const worker of ralphWorkers.values()) {
    if (worker.projects.includes(project) && !worker.activeTask) {
      hasWorkerForProject = true;
      break;
    }
  }

  if (!hasWorkerForProject) {
    const availableProjects = [...new Set([...ralphWorkers.values()].flatMap(w => w.projects))];
    const busyWorkers = [...ralphWorkers.values()].filter(w => w.activeTask);
    if (busyWorkers.length > 0) {
      return { success: false, error: `Worker is busy with another task. Try again shortly.` };
    }
    return { success: false, error: `No worker supports ${project}. Workers support: ${availableProjects.join(', ')}` };
  }

  const branchName = `ralph/${task.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`;

  // Create Ralph task in database
  const result = db.prepare(`
    INSERT INTO ralph_tasks (project, branch_name, prd_content, triggered_by, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(project, branchName, prdContent || task, triggeredBy);

  const taskId = result.lastInsertRowid;

  console.log(`[Ralph] Task ${taskId} created for ${project}: ${task.slice(0, 50)}...`);
  logActivity('ralph', project, `Ralph task created: ${task.slice(0, 50)}`, `Task ID: ${taskId}`);

  // Update status to dispatching
  db.prepare('UPDATE ralph_tasks SET status = ? WHERE id = ?').run('dispatching', taskId);

  // Dispatch to worker (worker handles all local file operations)
  startRalphWorker(taskId, project, task, projectConfig);

  return { success: true, taskId, branchName };
}

function startRalphWorker(taskId, project, task, projectConfig) {
  const structure = projectConfig?.structure || {};

  // Build context-aware prompt with project structure hints
  let structureHints = '';
  if (structure.warnings?.length > 0) {
    structureHints = `\n\nCRITICAL PATH REMINDERS:\n${structure.warnings.map(w => `- ${w}`).join('\n')}`;
  }
  if (structure.criticalFiles) {
    const files = Object.entries(structure.criticalFiles).map(([name, p]) => `- ${name}: ${p}`).join('\n');
    structureHints += `\n\nKEY FILES:\n${files}`;
  }

  // Build the task prompt
  const prompt = `${task}${structureHints}`;

  console.log(`[Ralph] Dispatching task ${taskId} to worker for ${project}`);

  // Find an available worker that supports this project
  let targetWorker = null;
  for (const [socketId, worker] of ralphWorkers) {
    if (worker.projects.includes(project) && !worker.activeTask) {
      targetWorker = worker;
      break;
    }
  }

  if (!targetWorker) {
    // This shouldn't happen since we check in triggerRalph, but handle it anyway
    console.error(`[Ralph] No worker found for ${project} (should have been caught earlier)`);
    db.prepare('UPDATE ralph_tasks SET status = ?, result = ? WHERE id = ?')
      .run('failed', 'No worker available', taskId);
    io.emit('ralph:error', { taskId, project, error: 'No worker available' });
    io.emit('ralph:no_worker', { taskId, project, task });
    return;
  }

  // Mark worker as busy
  targetWorker.activeTask = taskId;

  // Dispatch task to worker - worker handles all local operations
  console.log(`[Ralph] Dispatching to worker: ${targetWorker.hostname}`);
  targetWorker.socket.emit('ralph:task', {
    taskId,
    project,
    prompt,
    task,
    structure
  });

  // Track the pending task
  activeRalphProcesses.set(taskId, {
    project,
    task,
    workerId: targetWorker.socket.id,
    workerHostname: targetWorker.hostname,
    startTime: Date.now()
  });

  // Emit that task was dispatched (not started yet - worker will emit ralph:start)
  io.emit('ralph:dispatched', {
    taskId,
    project,
    task,
    workerId: targetWorker.socket.id,
    workerHostname: targetWorker.hostname
  });

  logActivity('ralph', project, `Task dispatched to worker: ${targetWorker.hostname}`, task.slice(0, 100));
}

// Process streaming JSON events from Claude Code
function processRalphEvent(taskId, project, event, taskState) {
  const elapsed = Math.round((Date.now() - taskState.startTime) / 1000);

  switch (event.type) {
    case 'system':
      // Initialization event
      taskState.sessionId = event.session_id;
      taskState.model = event.model;
      console.log(`[Ralph ${project}] Session: ${event.session_id}, Model: ${event.model}`);

      io.emit('ralph:init', {
        taskId,
        project,
        sessionId: event.session_id,
        model: event.model,
        tools: event.tools,
        cwd: event.cwd
      });
      break;

    case 'assistant':
      // Claude's response - check for tool use
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const input = block.input || {};
            const filePath = input.file_path || input.path || input.pattern || null;

            taskState.toolCalls.push({ tool: toolName, file: filePath, time: elapsed });

            // Track file operations
            if (filePath) {
              if (toolName === 'Read') {
                if (!taskState.filesRead.includes(filePath)) {
                  taskState.filesRead.push(filePath);
                }
              } else if (toolName === 'Write') {
                if (!taskState.filesWritten.includes(filePath)) {
                  taskState.filesWritten.push(filePath);
                }
              } else if (toolName === 'Edit') {
                if (!taskState.filesEdited.includes(filePath)) {
                  taskState.filesEdited.push(filePath);
                }
              }
            }

            io.emit('ralph:tool', {
              taskId,
              project,
              tool: toolName,
              file: filePath,
              input: input,
              elapsed
            });

            console.log(`[Ralph ${project}] Tool: ${toolName}${filePath ? ` → ${filePath}` : ''}`);
          } else if (block.type === 'text' && block.text) {
            io.emit('ralph:thought', {
              taskId,
              project,
              content: block.text,
              elapsed
            });
          }
        }
      }

      // Track usage from assistant messages
      if (event.message?.usage) {
        const usage = event.message.usage;
        taskState.tokensIn += usage.input_tokens || 0;
        taskState.tokensOut += usage.output_tokens || 0;
      }
      break;

    case 'user':
      // Tool result
      taskState.turns++;

      if (event.tool_use_result?.file) {
        const file = event.tool_use_result.file;
        io.emit('ralph:file', {
          taskId,
          project,
          action: 'read',
          path: file.filePath,
          lines: file.numLines || file.totalLines,
          elapsed
        });
      }

      // Emit progress update
      io.emit('ralph:progress', {
        taskId,
        project,
        turns: taskState.turns,
        tokensIn: taskState.tokensIn,
        tokensOut: taskState.tokensOut,
        filesRead: taskState.filesRead.length,
        filesWritten: taskState.filesWritten.length,
        filesEdited: taskState.filesEdited.length,
        elapsed
      });
      break;

    case 'result':
      // Final result
      taskState.cost = event.total_cost_usd || 0;
      taskState.turns = event.num_turns || taskState.turns;

      if (event.usage) {
        taskState.tokensIn = event.usage.input_tokens || taskState.tokensIn;
        taskState.tokensOut = event.usage.output_tokens || taskState.tokensOut;
      }

      console.log(`[Ralph ${project}] Result: ${event.duration_ms}ms, ${event.num_turns} turns, $${taskState.cost.toFixed(4)}`);
      break;

    default:
      // Unknown event type
      console.log(`[Ralph ${project}] Event: ${event.type}`);
  }
}

// Get current Ralph status
function getRalphStatus() {
  const activeTasks = [];
  for (const [taskId, info] of activeRalphProcesses) {
    activeTasks.push({
      taskId,
      project: info.project,
      runningFor: Math.round((Date.now() - info.startTime) / 1000)
    });
  }
  return {
    isWorking: activeTasks.length > 0,
    activeTasks,
    activeCount: activeTasks.length
  };
}

function getRalphTasks(project = null, limit = 10) {
  if (project) {
    return db.prepare(`
      SELECT * FROM ralph_tasks WHERE project = ? ORDER BY created_at DESC LIMIT ?
    `).all(project, limit);
  }
  return db.prepare(`
    SELECT * FROM ralph_tasks ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

function updateRalphTask(taskId, status, progress = null, result = null) {
  const updates = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const params = [status];

  if (progress !== null) {
    updates.push('progress = ?');
    params.push(progress);
  }
  if (result !== null) {
    updates.push('result = ?');
    params.push(result);
  }
  params.push(taskId);

  db.prepare(`UPDATE ralph_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  if (status === 'completed') {
    const task = db.prepare('SELECT * FROM ralph_tasks WHERE id = ?').get(taskId);
    logActivity('ralph', task.project, `Ralph completed: ${task.branch_name}`, result || 'Task finished');
  }
}

// ==================== ACTIVITY FEED ====================
function logActivity(type, source, title, description = '', metadata = {}) {
  db.prepare(`
    INSERT INTO activity_feed (type, source, title, description, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(type, source, title, description, JSON.stringify(metadata));

  // Emit to connected clients
  io.emit('activity_update', { type, source, title, description, metadata, created_at: new Date().toISOString() });
}

function getActivityFeed(limit = 20) {
  return db.prepare(`
    SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT ?
  `).all(limit);
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
  res.json({
    agents: agents.agents,
    categories: agents.categories || {}
  });
});

app.get('/api/chats', authMiddleware, (req, res) => {
  const chats = db.prepare('SELECT * FROM chats ORDER BY updated_at DESC').all();
  // Parse participants JSON and add last message preview
  const enrichedChats = chats.map(chat => {
    const lastMsg = db.prepare('SELECT content, tokens_used FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').get(chat.id);
    const totalTokens = db.prepare('SELECT SUM(tokens_used) as total FROM messages WHERE chat_id = ?').get(chat.id);
    return {
      ...chat,
      participants: chat.participants ? JSON.parse(chat.participants) : [],
      last_message: lastMsg?.content?.slice(0, 100) || null,
      summary: chat.summary || null,
      tokens_used: totalTokens?.total || 0
    };
  });
  res.json(enrichedChats);
});

app.post('/api/chats', authMiddleware, (req, res) => {
  const { agent_id, participants } = req.body;
  const agent = agents.agents.find(a => a.id === agent_id);
  const id = 'chat_' + Date.now();
  const isTownhall = agent_id === 'townhall';
  const name = isTownhall ? 'Townhall Meeting' : (agent ? `Chat with ${agent.name}` : 'New Chat');
  const participantsJson = participants ? JSON.stringify(participants) : null;

  // Ensure participants column exists
  try {
    db.prepare('ALTER TABLE chats ADD COLUMN participants TEXT').run();
  } catch (e) {
    // Column already exists
  }
  try {
    db.prepare('ALTER TABLE chats ADD COLUMN last_message TEXT').run();
  } catch (e) {
    // Column already exists
  }
  try {
    db.prepare('ALTER TABLE chats ADD COLUMN tokens_used INTEGER DEFAULT 0').run();
  } catch (e) {
    // Column already exists
  }
  try {
    db.prepare('ALTER TABLE chats ADD COLUMN summary TEXT').run();
  } catch (e) {
    // Column already exists
  }

  db.prepare('INSERT INTO chats (id, name, agent_id, participants) VALUES (?, ?, ?, ?)').run(id, name, agent_id, participantsJson);
  res.json({ id, name, agent_id, participants: participants || [] });
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

// Calendar endpoints - ensure color column exists
try {
  db.prepare('ALTER TABLE calendar_events ADD COLUMN color TEXT DEFAULT "blue"').run();
} catch (e) { /* Column already exists */ }

// Auto-assign color based on event type/keywords
function getEventColor(title, eventType) {
  const titleLower = (title || '').toLowerCase();
  const type = (eventType || '').toLowerCase();

  // Check keywords for auto-coloring
  if (titleLower.includes('deadline') || titleLower.includes('due') || titleLower.includes('launch')) return 'red';
  if (titleLower.includes('milestone') || titleLower.includes('checkpoint') || titleLower.includes('review')) return 'green';
  if (titleLower.includes('meeting') || titleLower.includes('sync') || titleLower.includes('townhall') || titleLower.includes('standup')) return 'yellow';
  if (titleLower.includes('atlas') || titleLower.includes('poc') || titleLower.includes('proof of concept')) return 'purple';
  if (titleLower.includes('check') || titleLower.includes('follow') || titleLower.includes('research')) return 'blue';

  // Check event_type
  if (type === 'deadline') return 'red';
  if (type === 'milestone') return 'green';
  if (type === 'meeting') return 'yellow';
  if (type === 'atlas') return 'purple';

  return 'blue'; // default
}

// Get all events (with optional date range)
app.get('/api/calendar', authMiddleware, (req, res) => {
  const { start, end, upcoming } = req.query;
  let events;

  if (start && end) {
    // Get events in date range (for calendar grid)
    events = db.prepare(`
      SELECT * FROM calendar_events
      WHERE event_date >= ? AND event_date <= ?
      ORDER BY event_date ASC, event_time ASC
    `).all(start, end);
  } else if (upcoming === 'true') {
    // Get upcoming events only
    events = db.prepare(`
      SELECT * FROM calendar_events
      WHERE event_date >= date('now')
      ORDER BY event_date ASC, event_time ASC
      LIMIT 50
    `).all();
  } else {
    // Get all events
    events = db.prepare(`
      SELECT * FROM calendar_events
      ORDER BY event_date ASC, event_time ASC
    `).all();
  }
  res.json(events);
});

// Get today's events
app.get('/api/calendar/today', authMiddleware, (req, res) => {
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date = date('now')
    ORDER BY event_time ASC
  `).all();
  res.json(events);
});

// Get this week's events
app.get('/api/calendar/week', authMiddleware, (req, res) => {
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE event_date >= date('now') AND event_date <= date('now', '+7 days')
    ORDER BY event_date ASC, event_time ASC
  `).all();
  res.json(events);
});

// Create event
app.post('/api/calendar', authMiddleware, (req, res) => {
  const { title, description, event_date, event_time, event_type, color, created_by } = req.body;

  // Validate required fields
  if (!title || !event_date) {
    return res.status(400).json({ error: 'Title and event_date are required' });
  }

  // Auto-assign color if not provided
  const eventColor = color || getEventColor(title, event_type);

  const result = db.prepare(`
    INSERT INTO calendar_events (title, description, event_date, event_time, event_type, color, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, description || null, event_date, event_time || null, event_type || 'general', eventColor, created_by || 'user');

  console.log(`[Calendar] Event created: "${title}" on ${event_date} (${eventColor})`);

  const event = { id: result.lastInsertRowid, title, event_date, event_time, event_type, color: eventColor, created_by };
  res.json(event);
});

// Parse natural language date and create event (for agents)
app.post('/api/calendar/parse', authMiddleware, (req, res) => {
  const { text, created_by } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const parsed = parseCalendarText(text);

  if (!parsed) {
    return res.status(400).json({ error: 'Could not parse calendar event from text' });
  }

  const eventColor = getEventColor(parsed.title, parsed.event_type);

  const result = db.prepare(`
    INSERT INTO calendar_events (title, description, event_date, event_time, event_type, color, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(parsed.title, parsed.description || null, parsed.event_date, parsed.event_time || null, parsed.event_type || 'general', eventColor, created_by || 'agent');

  console.log(`[Calendar] Parsed event created: "${parsed.title}" on ${parsed.event_date}`);

  res.json({
    id: result.lastInsertRowid,
    ...parsed,
    color: eventColor,
    created_by: created_by || 'agent'
  });
});

// Parse natural language calendar text
function parseCalendarText(text) {
  if (!text) return null;

  const today = new Date();
  let eventDate = null;
  let eventTime = null;
  let title = text;

  // Month names
  const months = {
    'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
    'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
    'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8, 'october': 9, 'oct': 9,
    'november': 10, 'nov': 10, 'december': 11, 'dec': 11
  };

  // Remove common prefixes
  title = title.replace(/^(add to calendar|calendar|schedule|event|reminder)[:\s]*/i, '').trim();

  // Parse relative dates
  const lowerText = text.toLowerCase();

  // Try month name format first: "January 31, 2026" or "Feb 14"
  const monthMatch = lowerText.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i);
  if (monthMatch) {
    const monthNum = months[monthMatch[1].toLowerCase()];
    const day = parseInt(monthMatch[2]);
    let year = monthMatch[3] ? parseInt(monthMatch[3]) : today.getFullYear();

    // If date is in the past and no year specified, use next year
    const testDate = new Date(year, monthNum, day);
    if (testDate < today && !monthMatch[3]) {
      year++;
    }

    eventDate = `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    title = title.replace(monthMatch[0], '').trim();
  } else if (lowerText.includes('today')) {
    eventDate = today.toISOString().split('T')[0];
    title = title.replace(/today/i, '').trim();
  } else if (lowerText.includes('tomorrow')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    eventDate = tomorrow.toISOString().split('T')[0];
    title = title.replace(/tomorrow/i, '').trim();
  } else if (lowerText.match(/next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const match = lowerText.match(/next (\w+)/i);
    if (match) {
      const targetDay = days.indexOf(match[1].toLowerCase());
      if (targetDay !== -1) {
        const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7;
        const nextDay = new Date(today);
        nextDay.setDate(today.getDate() + daysUntil);
        eventDate = nextDay.toISOString().split('T')[0];
        title = title.replace(/next \w+/i, '').trim();
      }
    }
  } else if (lowerText.match(/in (\d+) days?/i)) {
    const match = lowerText.match(/in (\d+) days?/i);
    if (match) {
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + parseInt(match[1]));
      eventDate = futureDate.toISOString().split('T')[0];
      title = title.replace(/in \d+ days?/i, '').trim();
    }
  } else if (lowerText.match(/(\d{1,2})\/(\d{1,2})/)) {
    // MM/DD or M/D format
    const match = lowerText.match(/(\d{1,2})\/(\d{1,2})/);
    if (match) {
      const month = parseInt(match[1]) - 1;
      const day = parseInt(match[2]);
      const year = today.getFullYear();
      const parsedDate = new Date(year, month, day);
      if (parsedDate < today) {
        parsedDate.setFullYear(year + 1);
      }
      eventDate = parsedDate.toISOString().split('T')[0];
      title = title.replace(/\d{1,2}\/\d{1,2}/i, '').trim();
    }
  } else if (lowerText.match(/(\d{4})-(\d{2})-(\d{2})/)) {
    // ISO date format
    const match = lowerText.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      eventDate = match[0];
      title = title.replace(/\d{4}-\d{2}-\d{2}/i, '').trim();
    }
  }

  // Parse time - check multiple formats
  const timeMatch = text.match(/(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2];
    const period = timeMatch[3]?.toLowerCase();

    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    eventTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
    title = title.replace(/(?:at\s+)?\d{1,2}:\d{2}\s*(am|pm)?/i, '').trim();
  } else if (lowerText.match(/at (\d{1,2})\s*(am|pm)/i)) {
    const match = lowerText.match(/at (\d{1,2})\s*(am|pm)/i);
    if (match) {
      let hours = parseInt(match[1]);
      const period = match[2].toLowerCase();
      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      eventTime = `${hours.toString().padStart(2, '0')}:00`;
      title = title.replace(/at \d{1,2}\s*(am|pm)/i, '').trim();
    }
  }

  // Clean up title
  title = title.replace(/^[-:\s]+/, '').replace(/[-:\s]+$/, '').trim();

  // If no date found, default to tomorrow
  if (!eventDate) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    eventDate = tomorrow.toISOString().split('T')[0];
  }

  if (!title) {
    return null;
  }

  // Determine event type
  let eventType = 'general';
  if (title.toLowerCase().includes('deadline') || title.toLowerCase().includes('due')) eventType = 'deadline';
  else if (title.toLowerCase().includes('meeting') || title.toLowerCase().includes('sync')) eventType = 'meeting';
  else if (title.toLowerCase().includes('milestone') || title.toLowerCase().includes('checkpoint')) eventType = 'milestone';
  else if (title.toLowerCase().includes('check') || title.toLowerCase().includes('follow')) eventType = 'followup';

  return {
    title,
    event_date: eventDate,
    event_time: eventTime,
    event_type: eventType
  };
}

app.put('/api/calendar/:id', authMiddleware, (req, res) => {
  const { title, event_date, event_time, color, event_type } = req.body;
  db.prepare(`
    UPDATE calendar_events
    SET title = ?, event_date = ?, event_time = ?, color = COALESCE(?, color), event_type = COALESCE(?, event_type)
    WHERE id = ?
  `).run(title, event_date, event_time || null, color, event_type, req.params.id);
  res.json({ success: true });
});

app.delete('/api/calendar/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Seed calendar with Prime's requested events
app.post('/api/calendar/seed', authMiddleware, (req, res) => {
  const events = [
    { title: 'Check Scout competitor pricing research', date: '2026-01-31', time: '09:00', color: 'blue' },
    { title: 'Review Optimizer conversion metrics', date: '2026-02-02', time: '10:00', color: 'blue' },
    { title: 'Weekly SlabTrack sync - review progress against MRR targets', date: '2026-02-03', time: '09:00', color: 'yellow' },
    { title: 'Check Flint-SlabTrack PRD for Premium Analytics feature', date: '2026-02-07', time: '10:00', color: 'blue' },
    { title: '2-week checkpoint - Short-term actions due', date: '2026-02-14', time: '09:00', color: 'green' },
    { title: '30-day checkpoint - Medium-term review', date: '2026-03-01', time: '09:00', color: 'green' }
  ];

  const created = [];
  for (const event of events) {
    // Check if already exists
    const existing = db.prepare(`
      SELECT id FROM calendar_events WHERE event_date = ? AND LOWER(title) = LOWER(?)
    `).get(event.date, event.title);

    if (!existing) {
      const result = db.prepare(`
        INSERT INTO calendar_events (title, event_date, event_time, event_type, color, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(event.title, event.date, event.time, 'general', event.color, 'prime');

      console.log(`[Calendar] Seeded event: "${event.title}" on ${event.date}`);
      created.push({ id: result.lastInsertRowid, ...event });
    }
  }

  res.json({ success: true, created: created.length, events: created });
});

// ==================== SENTRY API ENDPOINTS ====================
app.get('/api/sentry/health', authMiddleware, async (req, res) => {
  const health = await getAllPlatformHealth();
  res.json(health);
});

app.get('/api/sentry/:project/issues', authMiddleware, async (req, res) => {
  const issues = await getSentryIssues(req.params.project, parseInt(req.query.limit) || 10);
  res.json(issues);
});

// Aggregated errors endpoint for Dashboard
app.get('/api/sentry/errors', authMiddleware, async (req, res) => {
  const health = await getAllPlatformHealth();
  const errors = [];
  for (const [project, data] of Object.entries(health)) {
    for (const issue of data.recentIssues || []) {
      errors.push({
        title: issue.title,
        project: project,
        count: issue.count,
        lastSeen: issue.lastSeen
      });
    }
  }
  // Sort by count descending and return top errors
  errors.sort((a, b) => b.count - a.count);
  res.json(errors.slice(0, 10));
});

// ==================== WIKI.JS API ENDPOINTS ====================
app.get('/api/wiki/test', authMiddleware, async (req, res) => {
  console.log('[Wiki.js] Testing connection...');
  const testQuery = `
    query {
      site {
        config {
          title
        }
      }
    }
  `;
  const result = await wikiGraphQL(testQuery);
  res.json({
    configured: !!WIKI_API_KEY,
    url: WIKI_URL,
    connected: !!result,
    siteTitle: result?.site?.config?.title || null,
    result
  });
});

app.get('/api/wiki/search', authMiddleware, async (req, res) => {
  const results = await wikiSearch(req.query.q, parseInt(req.query.limit) || 5);
  res.json(results);
});

app.get('/api/wiki/page/:id', authMiddleware, async (req, res) => {
  try {
    const page = await getWikiPageContent(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    res.json(page);
  } catch (err) {
    console.error('Failed to fetch wiki page:', err);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

app.post('/api/wiki/decision', authMiddleware, async (req, res) => {
  const { topic, decision, reasoning } = req.body;
  const result = await saveBoardroomDecision(topic, decision, reasoning);
  res.json({ success: !!result, result });
});

app.post('/api/wiki/learning', authMiddleware, async (req, res) => {
  const { project, learning, context } = req.body;
  const result = await saveRalphLearning(project, learning, context);
  res.json({ success: !!result, result });
});

app.post('/api/wiki/research', authMiddleware, async (req, res) => {
  const { title, findings, agent } = req.body;
  const result = await saveScoutResearch(title, findings, agent || 'scout');
  res.json({ success: !!result, result });
});

app.get('/api/wiki/recent', authMiddleware, async (req, res) => {
  try {
    const pages = await searchWikiPages('', 20); // Get recent pages
    res.json({ pages });
  } catch (err) {
    console.error('Failed to fetch wiki pages:', err);
    res.json({ pages: [] });
  }
});

// ==================== MEMORY API ENDPOINTS ====================
// Create a new memory snapshot
app.post('/api/memory/snapshot', authMiddleware, async (req, res) => {
  try {
    const snapshot = await createMemorySnapshot();
    res.json({ success: true, snapshot });
  } catch (error) {
    console.error('[Memory] Snapshot failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get the latest memory snapshot
app.get('/api/memory/snapshot', authMiddleware, (req, res) => {
  const snapshot = getLatestSnapshot();
  if (snapshot) {
    res.json({ success: true, snapshot });
  } else {
    res.json({ success: false, error: 'No snapshot available' });
  }
});

// List all memory snapshots
app.get('/api/memory/snapshots', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const snapshots = db.prepare(`
    SELECT id, snapshot_type, created_at
    FROM memory_snapshots
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  res.json(snapshots);
});

// Restore memory from snapshot (reloads Prime's context)
app.post('/api/memory/restore', authMiddleware, async (req, res) => {
  try {
    // Rebuild Prime's startup context
    primeStartupContext = await buildPrimeStartupContext();
    console.log('[Memory] Prime context restored');

    // Get latest snapshot for response
    const snapshot = getLatestSnapshot();

    res.json({
      success: true,
      message: 'Memory restored successfully',
      snapshotDate: snapshot?.created_at,
      contextLength: primeStartupContext.length
    });
  } catch (error) {
    console.error('[Memory] Restore failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Prime's current startup context
app.get('/api/memory/prime-context', authMiddleware, (req, res) => {
  res.json({
    hasContext: !!primeStartupContext,
    length: primeStartupContext.length,
    preview: primeStartupContext.slice(0, 500)
  });
});

// ==================== REPORTS API ENDPOINTS ====================
// Trigger manual report
app.post('/api/reports/trigger', authMiddleware, async (req, res) => {
  const { type } = req.body;
  try {
    let content, subject;
    const today = formatCentralTime(new Date(), { month: 'short', day: 'numeric' });

    switch (type) {
      case 'morning':
        content = await generateMorningBriefing();
        subject = `☀️ ATLAS Morning Briefing - ${today}`;
        break;
      case 'evening':
        content = await generateEveningSummary();
        subject = `🌙 ATLAS Evening Summary - ${today}`;
        break;
      case 'weekly':
        content = await generateWeeklyReview();
        subject = `📊 ATLAS Weekly Review - Week of ${today}`;
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid report type' });
    }

    await sendScheduledReport(type, subject, content);
    res.json({ success: true, type, sentTo: REPORT_EMAIL });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Preview report (without sending)
app.get('/api/reports/preview/:type', authMiddleware, async (req, res) => {
  const { type } = req.params;
  try {
    let content;
    switch (type) {
      case 'morning':
        content = await generateMorningBriefing();
        break;
      case 'evening':
        content = await generateEveningSummary();
        break;
      case 'weekly':
        content = await generateWeeklyReview();
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid report type' });
    }
    res.json({ success: true, type, content });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== COST TRACKING API ENDPOINTS ====================
// Get detailed API calls with filters, sorting, and type filtering
app.get('/api/costs/detailed', authMiddleware, (req, res) => {
  const { startDate, endDate, agent, type, sortField = 'created_at', sortOrder = 'desc', limit = 100, offset = 0 } = req.query;

  // Validate sort field to prevent SQL injection
  const allowedSortFields = ['created_at', 'agent', 'cost', 'tokens_in', 'tokens_out'];
  const validSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';
  const validSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

  let query = `SELECT * FROM api_calls WHERE 1=1`;
  const params = [];

  if (startDate) {
    query += ` AND date(created_at) >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    query += ` AND date(created_at) <= ?`;
    params.push(endDate);
  }
  if (agent) {
    query += ` AND agent = ?`;
    params.push(agent);
  }
  if (type) {
    query += ` AND call_type = ?`;
    params.push(type);
  }

  query += ` ORDER BY ${validSortField} ${validSortOrder} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const records = db.prepare(query).all(...params);

  // Get total count for pagination
  let countQuery = `SELECT COUNT(*) as total FROM api_calls WHERE 1=1`;
  const countParams = [];
  if (startDate) { countQuery += ` AND date(created_at) >= ?`; countParams.push(startDate); }
  if (endDate) { countQuery += ` AND date(created_at) <= ?`; countParams.push(endDate); }
  if (agent) { countQuery += ` AND agent = ?`; countParams.push(agent); }
  if (type) { countQuery += ` AND call_type = ?`; countParams.push(type); }

  const total = db.prepare(countQuery).get(...countParams);

  res.json({ records, total: total.total, limit: parseInt(limit), offset: parseInt(offset) });
});

// Get cost summary
app.get('/api/costs/summary', authMiddleware, (req, res) => {
  // Today
  const today = db.prepare(`
    SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost, COUNT(*) as calls
    FROM api_usage WHERE date = date('now')
  `).get();

  // This week
  const week = db.prepare(`
    SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost, COUNT(*) as calls
    FROM api_usage WHERE date >= date('now', '-7 days')
  `).get();

  // This month
  const month = db.prepare(`
    SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost, COUNT(*) as calls
    FROM api_usage WHERE date >= date('now', 'start of month')
  `).get();

  // All time
  const allTime = db.prepare(`
    SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost, COUNT(*) as calls
    FROM api_usage
  `).get();

  // By agent (from api_calls table)
  const byAgent = db.prepare(`
    SELECT agent, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost, COUNT(*) as calls
    FROM api_calls GROUP BY agent ORDER BY cost DESC
  `).all();

  // Daily breakdown (last 30 days)
  const daily = db.prepare(`
    SELECT date, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost, COUNT(*) as calls
    FROM api_usage WHERE date >= date('now', '-30 days')
    GROUP BY date ORDER BY date DESC
  `).all();

  // Recent calls (last 20)
  const recentCalls = db.prepare(`
    SELECT * FROM api_calls ORDER BY id DESC LIMIT 20
  `).all();

  res.json({
    today: today || { tokens_in: 0, tokens_out: 0, cost: 0, calls: 0 },
    week: week || { tokens_in: 0, tokens_out: 0, cost: 0, calls: 0 },
    month: month || { tokens_in: 0, tokens_out: 0, cost: 0, calls: 0 },
    allTime: allTime || { tokens_in: 0, tokens_out: 0, cost: 0, calls: 0 },
    byAgent,
    daily,
    recentCalls
  });
});

// ==================== RALPH API ENDPOINTS ====================
app.get('/api/ralph/tasks', authMiddleware, (req, res) => {
  const tasks = getRalphTasks(req.query.project, parseInt(req.query.limit) || 10);
  res.json(tasks);
});

app.post('/api/ralph/trigger', authMiddleware, async (req, res) => {
  const { project, task, prd } = req.body;
  const result = await triggerRalph(project, task, prd, req.user.username);
  res.json(result);
});

app.put('/api/ralph/tasks/:id', authMiddleware, (req, res) => {
  const { status, progress, result } = req.body;
  updateRalphTask(req.params.id, status, progress, result);
  res.json({ success: true });
});

app.get('/api/ralph/status', authMiddleware, (req, res) => {
  const status = getRalphStatus();
  const recentTasks = getRalphTasks(null, 5);

  // Include worker status (ralphWorkers is defined in socket handler)
  const workers = typeof ralphWorkers !== 'undefined' ? [...ralphWorkers.values()].map(w => ({
    hostname: w.hostname,
    projects: w.projects,
    activeTask: w.activeTask,
    connectedAt: w.connectedAt
  })) : [];

  res.json({
    ...status,
    recentTasks,
    workers,
    workersOnline: workers.length
  });
});

app.get('/api/ralph/projects', authMiddleware, (req, res) => {
  const projects = Object.keys(RALPH_PROJECTS).map(key => ({
    id: key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    path: RALPH_PROJECTS[key].path
  }));
  res.json(projects);
});

// ==================== GIT AWARENESS API ====================
// Get recent commits for a project
app.get('/api/git/:project/log', authMiddleware, (req, res) => {
  const { project } = req.params;
  const count = parseInt(req.query.count) || 5;
  const result = getGitLog(project, count);
  res.json(result);
});

// Get branches for a project
app.get('/api/git/:project/branches', authMiddleware, (req, res) => {
  const { project } = req.params;
  const result = getGitBranches(project);
  res.json(result);
});

// Get TODOs for a project
app.get('/api/git/:project/todos', authMiddleware, (req, res) => {
  const { project } = req.params;
  const result = getGitTodos(project);
  res.json(result);
});

// Get roadmap for a project
app.get('/api/git/:project/roadmap', authMiddleware, (req, res) => {
  const { project } = req.params;
  const result = getRoadmap(project);
  res.json(result);
});

// Get full project status (combines all git info)
app.get('/api/git/:project/status', authMiddleware, (req, res) => {
  const { project } = req.params;
  const result = getProjectStatus(project);
  res.json(result);
});

// ==================== GIT SYNC API ====================

// Get commits since a specific date for a project
function getCommitsSince(project, sinceDate) {
  const projectConfig = RALPH_PROJECTS[project];
  if (!projectConfig) return { success: false, error: `Unknown project: ${project}` };

  try {
    const since = sinceDate ? `--since="${sinceDate}"` : '-10';
    const result = execSync(`git log ${since} --pretty=format:"%h|%s|%cr|%an" --no-merges`, {
      cwd: projectConfig.path,
      encoding: 'utf8',
      timeout: 15000
    });

    const commits = result.trim().split('\n').filter(l => l).map(line => {
      const [hash, message, relative, author] = line.split('|');
      return { hash, message, relative, author };
    });

    return { success: true, commits, count: commits.length };
  } catch (error) {
    if (error.status === 128 || error.message.includes('does not have any commits')) {
      return { success: true, commits: [], count: 0 };
    }
    return { success: false, error: error.message };
  }
}

// Get last sync timestamp
function getLastSync() {
  try {
    const row = db.prepare('SELECT last_sync, commits_found, sync_data FROM git_sync ORDER BY id DESC LIMIT 1').get();
    return row || null;
  } catch (e) {
    return null;
  }
}

// Save sync result
function saveSyncResult(commitsFound, syncData) {
  db.prepare('INSERT INTO git_sync (last_sync, commits_found, sync_data) VALUES (CURRENT_TIMESTAMP, ?, ?)')
    .run(commitsFound, JSON.stringify(syncData));
}

// Sync all projects
app.get('/api/git/sync', authMiddleware, (req, res) => {
  const lastSync = getLastSync();
  const sinceDate = lastSync?.last_sync || null;

  const projects = Object.keys(RALPH_PROJECTS);
  const results = {};
  let totalCommits = 0;

  for (const project of projects) {
    const result = getCommitsSince(project, sinceDate);
    results[project] = result;
    if (result.success) {
      totalCommits += result.count;
    }
  }

  // Save sync result
  saveSyncResult(totalCommits, results);

  // Log activity if commits found
  if (totalCommits > 0) {
    const summary = projects.map(p => `${p}: ${results[p]?.count || 0}`).join(', ');
    logActivity('git', 'system', `Git sync: ${totalCommits} new commits`, summary);
  }

  res.json({
    success: true,
    lastSync: sinceDate,
    currentSync: new Date().toISOString(),
    totalCommits,
    projects: results
  });
});

// Get sync status (for checking if auto-sync needed)
app.get('/api/git/sync/status', authMiddleware, (req, res) => {
  const lastSync = getLastSync();
  const now = new Date();
  const lastSyncDate = lastSync?.last_sync ? new Date(lastSync.last_sync) : null;
  const hoursSinceSync = lastSyncDate ? (now - lastSyncDate) / (1000 * 60 * 60) : null;

  res.json({
    lastSync: lastSync?.last_sync || null,
    lastCommitsFound: lastSync?.commits_found || 0,
    hoursSinceSync: hoursSinceSync ? Math.round(hoursSinceSync * 10) / 10 : null,
    needsSync: !lastSyncDate || hoursSinceSync > 1
  });
});

// Get sync history
app.get('/api/git/sync/history', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const rows = db.prepare('SELECT * FROM git_sync ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows.map(row => ({
    ...row,
    sync_data: row.sync_data ? JSON.parse(row.sync_data) : null
  })));
});

// Cancel a specific Ralph task
app.post('/api/ralph/tasks/:id/cancel', authMiddleware, (req, res) => {
  const taskId = parseInt(req.params.id);
  console.log(`[Ralph] Cancelling task ${taskId}`);

  // Kill the process if it's running
  const activeTask = activeRalphProcesses.get(taskId);
  if (activeTask?.process) {
    console.log(`[Ralph] Killing process PID ${activeTask.pid}`);
    activeTask.process.kill('SIGTERM');
  }
  activeRalphProcesses.delete(taskId);

  // Update database
  db.prepare('UPDATE ralph_tasks SET status = ?, result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('cancelled', 'Task cancelled by user', taskId);

  logActivity('ralph', 'system', `Ralph task cancelled`, `Task ID: ${taskId}`);

  io.emit('ralph_update', { action: 'cancelled', taskId });

  res.json({ success: true });
});

// Clear all stuck tasks (in_progress for more than 30 minutes)
app.post('/api/ralph/clear-stuck', authMiddleware, (req, res) => {
  console.log(`[Ralph] Clearing stuck tasks`);

  // Kill all active processes
  for (const [taskId, info] of activeRalphProcesses) {
    console.log(`[Ralph] Killing stuck process for task ${taskId}`);
    info.process?.kill('SIGTERM');
  }
  activeRalphProcesses.clear();

  // Mark old in_progress tasks as failed
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const result = db.prepare(`
    UPDATE ralph_tasks
    SET status = 'failed', result = 'Task timed out or was cleared', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'in_progress' AND updated_at < ?
  `).run(thirtyMinutesAgo);

  // Also clear any remaining in_progress tasks
  const result2 = db.prepare(`
    UPDATE ralph_tasks
    SET status = 'failed', result = 'Task cleared by user', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'in_progress'
  `).run();

  const cleared = (result.changes || 0) + (result2.changes || 0);
  console.log(`[Ralph] Cleared ${cleared} stuck tasks`);

  logActivity('ralph', 'system', `Cleared ${cleared} stuck Ralph tasks`, 'Manual cleanup');

  io.emit('ralph_update', { action: 'cleared', count: cleared });

  res.json({ success: true, cleared });
});

// ==================== CONTACTS API ENDPOINTS ====================
app.get('/api/contacts', authMiddleware, (req, res) => {
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY name').all();
  res.json(contacts);
});

app.get('/api/contacts/:name', authMiddleware, (req, res) => {
  const contact = getContact(req.params.name);
  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  res.json(contact);
});

app.post('/api/contacts', authMiddleware, (req, res) => {
  const { name, phone, carrier, email } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO contacts (name, phone, carrier, email)
      VALUES (?, ?, ?, ?)
    `).run(name, phone || null, carrier || null, email || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Contact with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/contacts/:id', authMiddleware, (req, res) => {
  const { name, phone, carrier, email } = req.body;
  db.prepare(`
    UPDATE contacts SET name = ?, phone = ?, carrier = ?, email = ?
    WHERE id = ?
  `).run(name, phone || null, carrier || null, email || null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/contacts/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Test SMS/Email sending
app.post('/api/contacts/test-sms', authMiddleware, async (req, res) => {
  const { name, message, sender } = req.body;
  const result = await sendSMS(name, message || 'Test message from ATLAS', sender || 'System');
  res.json(result);
});

app.post('/api/contacts/test-email', authMiddleware, async (req, res) => {
  const { name, message, subject } = req.body;
  const result = await sendEmail(name, message || 'Test message from ATLAS', subject);
  res.json(result);
});

// ==================== ACTIVITY FEED ENDPOINTS ====================
app.get('/api/activity', authMiddleware, (req, res) => {
  const feed = getActivityFeed(parseInt(req.query.limit) || 20);
  res.json(feed);
});

// ==================== SYSTEM HEALTH ENDPOINT ====================
app.get('/api/system/health', authMiddleware, async (req, res) => {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  const sentryHealth = await getAllPlatformHealth();
  const ralphTasks = getRalphTasks(null, 5);
  const recentActivity = getActivityFeed(10);

  res.json({
    server: {
      uptime: Math.floor(uptime),
      uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024)
      },
      nodeVersion: process.version
    },
    sentry: sentryHealth,
    ralph: {
      activeTasks: ralphTasks.filter(t => t.status === 'in_progress').length,
      pendingTasks: ralphTasks.filter(t => t.status === 'pending').length,
      recentTasks: ralphTasks.slice(0, 3)
    },
    recentActivity
  });
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

    // Log API usage
    logApiUsage(tokensIn, tokensOut, cost, agentId, `Agent consultation: ${question.slice(0, 100)}`, 'chat');

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
// Ralph worker token for authentication
const RALPH_WORKER_TOKEN = process.env.RALPH_WORKER_TOKEN || 'atlas-ralph-worker-2026';

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const workerType = socket.handshake.auth.workerType;
  const workerName = socket.handshake.auth.workerName;

  // Check if this is a Ralph worker connection
  if (workerType === 'ralph') {
    if (token === RALPH_WORKER_TOKEN) {
      socket.user = { username: `ralph-worker:${workerName || 'unknown'}`, isWorker: true };
      socket.isRalphWorker = true;
      console.log(`[Ralph] Worker authenticating: ${workerName || 'unknown'}`);
      next();
    } else {
      console.log(`[Ralph] Worker auth failed - invalid token`);
      next(new Error('Invalid worker token'));
    }
    return;
  }

  // Regular user JWT authentication
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

  // ==================== RALPH WORKER HANDLING ====================
  // Workers connect with auth.workerType === 'ralph'
  socket.on('ralph:worker:register', (data) => {
    console.log(`[Ralph] Worker registered: ${data.hostname} (projects: ${data.projects.join(', ')})`);
    ralphWorkers.set(socket.id, {
      socket,
      hostname: data.hostname,
      projects: data.projects,
      capabilities: data.capabilities,
      activeTask: null,
      connectedAt: Date.now()
    });

    // Notify UI that a worker is available
    io.emit('ralph:worker:online', {
      workerId: socket.id,
      hostname: data.hostname,
      projects: data.projects
    });
  });

  // Worker starting a task
  socket.on('ralph:worker:start', (data) => {
    console.log(`[Ralph] Worker started task ${data.taskId} for ${data.project}`);
    const worker = ralphWorkers.get(socket.id);
    if (worker) worker.activeTask = data.taskId;

    // Relay to UI - include task for visualizer
    io.emit('ralph:start', {
      taskId: data.taskId,
      project: data.project,
      task: data.task,
      startTime: data.startTime,
      workerId: socket.id,
      workerHostname: worker?.hostname
    });
  });

  // Worker initialized Claude session
  socket.on('ralph:worker:init', (data) => {
    io.emit('ralph:init', data);
  });

  // Worker tool usage
  socket.on('ralph:worker:tool', (data) => {
    console.log(`[Ralph] Tool: ${data.tool}${data.file ? ` -> ${data.file}` : ''}`);
    io.emit('ralph:tool', data);
  });

  // Worker progress
  socket.on('ralph:worker:progress', (data) => {
    io.emit('ralph:progress', data);
  });

  // Worker thought/text
  socket.on('ralph:worker:thought', (data) => {
    io.emit('ralph:thought', data);
  });

  // Worker log
  socket.on('ralph:worker:log', (data) => {
    io.emit('ralph:log', data);
  });

  // Worker task complete
  socket.on('ralph:worker:complete', (data) => {
    console.log(`[Ralph] Task ${data.taskId} complete: ${data.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`[Ralph] Duration: ${data.duration}s, Turns: ${data.turns}, Cost: $${data.cost?.toFixed(4) || '0'}`);

    if (data.git) {
      console.log(`[Ralph] Git: staged=${data.git.staged}, committed=${data.git.committed}, pushed=${data.git.pushed}`);
    }

    const worker = ralphWorkers.get(socket.id);
    if (worker) worker.activeTask = null;

    // Update database
    const status = data.success ? 'completed' : 'failed';
    const resultData = JSON.stringify({
      duration: data.duration,
      turns: data.turns,
      cost: data.cost,
      filesRead: data.filesRead,
      filesWritten: data.filesWritten,
      filesEdited: data.filesEdited,
      git: data.git
    }).slice(0, 5000);

    db.prepare('UPDATE ralph_tasks SET status = ?, result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, resultData, data.taskId);

    logActivity('ralph', data.project, `Ralph ${status}: task ${data.taskId}`,
      `${data.duration}s | ${data.turns} turns | $${data.cost?.toFixed(4) || '0'}${data.git?.pushed ? ' | pushed' : ''}`);

    // Relay to UI
    io.emit('ralph:complete', data);

    // Save code changes to Wiki.js (async, don't wait)
    if (data.success && WIKI_API_KEY) {
      const filesChanged = [
        ...(data.filesWritten || []),
        ...(data.filesEdited || [])
      ].filter(Boolean);

      saveRalphCodeChanges({
        project: data.project,
        task: data.task || `Task ${data.taskId}`,
        filesChanged,
        summary: data.summary || null,
        git: data.git,
        duration: data.duration,
        turns: data.turns,
        cost: data.cost
      }).catch(err => {
        console.error('[Wiki.js] Failed to save Ralph code changes:', err.message);
      });
    }
  });

  // Worker error
  socket.on('ralph:worker:error', (data) => {
    console.error(`[Ralph] Worker error for task ${data.taskId}:`, data.error);

    const worker = ralphWorkers.get(socket.id);
    if (worker) worker.activeTask = null;

    db.prepare('UPDATE ralph_tasks SET status = ?, result = ? WHERE id = ?')
      .run('failed', data.error, data.taskId);

    io.emit('ralph:error', data);
  });

  // Worker busy
  socket.on('ralph:worker:busy', (data) => {
    console.log(`[Ralph] Worker busy, cannot accept task ${data.taskId}`);
    io.emit('ralph:busy', data);
  });

  // ==================== TERMINAL HANDLERS ====================
  // Check if worker is connected for terminal
  socket.on('terminal:check-worker', () => {
    const hasWorker = ralphWorkers.size > 0;
    socket.emit('terminal:worker-status', { connected: hasWorker });
  });

  // Create new terminal session - relay to worker
  socket.on('terminal:create-session', (options = {}) => {
    const worker = [...ralphWorkers.values()][0]; // Get first available worker
    if (!worker) {
      socket.emit('terminal:error', { error: 'No worker connected' });
      return;
    }
    const sessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { preset, cwd, title, autoCommand } = options;
    console.log(`[Terminal] Creating session ${sessionId}`, preset ? `(${preset})` : '', autoCommand ? `[auto: ${autoCommand}]` : '');
    worker.socket.emit('terminal:create', {
      sessionId,
      requesterId: socket.id,
      cwd: cwd || null,
      title: title || null,
      preset: preset || null,
      autoCommand: autoCommand || null
    });
  });

  // Terminal input from browser - relay to worker
  socket.on('terminal:input', (data) => {
    const worker = [...ralphWorkers.values()][0];
    if (worker) {
      worker.socket.emit('terminal:input', data);
    }
  });

  // Terminal resize from browser - relay to worker
  socket.on('terminal:resize', (data) => {
    const worker = [...ralphWorkers.values()][0];
    if (worker) {
      worker.socket.emit('terminal:resize', data);
    }
  });

  // Close terminal session - relay to worker
  socket.on('terminal:close-session', (data) => {
    const worker = [...ralphWorkers.values()][0];
    if (worker) {
      worker.socket.emit('terminal:close', data);
    }
  });

  // Worker sends terminal output - relay to browser
  socket.on('terminal:output', (data) => {
    io.emit('terminal:output', data);
  });

  // Worker created terminal session - relay to browser
  socket.on('terminal:created', (data) => {
    console.log(`[Terminal] Session created: ${data.sessionId}`, data.title ? `(${data.title})` : '');
    io.emit('terminal:session-created', {
      sessionId: data.sessionId,
      title: data.title || null,
      preset: data.preset || null,
      autoCommand: data.autoCommand || null
    });
  });

  // Worker closed terminal session - relay to browser
  socket.on('terminal:closed', (data) => {
    console.log(`[Terminal] Session closed: ${data.sessionId}`);
    io.emit('terminal:session-closed', data);
  });

  // ==================== END TERMINAL HANDLERS ====================

  // Worker disconnected
  socket.on('disconnect', () => {
    if (ralphWorkers.has(socket.id)) {
      const worker = ralphWorkers.get(socket.id);
      console.log(`[Ralph] Worker disconnected: ${worker.hostname}`);
      ralphWorkers.delete(socket.id);
      io.emit('ralph:worker:offline', { workerId: socket.id, hostname: worker.hostname });
    }
  });

  // ==================== END RALPH WORKER HANDLING ====================

  socket.on('send_message', async (data) => {
    const { chat_id, agent_id, content, participants } = data;

    // Handle Townhall multi-agent chat
    if (agent_id === 'townhall') {
      // Get participants from data or from the chat record
      let townhallParticipants = participants || [];
      if (townhallParticipants.length === 0) {
        const chat = db.prepare('SELECT participants FROM chats WHERE id = ?').get(chat_id);
        if (chat?.participants) {
          townhallParticipants = JSON.parse(chat.participants);
        }
      }

      if (townhallParticipants.length === 0) {
        socket.emit('error', { message: 'No participants in Townhall' });
        return;
      }

      // Save user message
      db.prepare('INSERT INTO messages (chat_id, agent_id, role, content) VALUES (?, ?, ?, ?)').run(chat_id, 'townhall', 'user', content);
      db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(chat_id);
      io.emit('new_message', { chat_id, agent_id: 'townhall', role: 'user', content, created_at: new Date().toISOString() });

      // Get conversation history
      const history = db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chat_id);
      const messages = history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

      io.emit('agent_typing', { chat_id, agent_id: 'townhall', typing: true });

      // SPECIAL HANDLING: @summarizer is a utility agent, NOT a discussant
      // When @summarizer is mentioned, ONLY Summarizer responds (not all participants)
      const isSummarizerRequest = content.toLowerCase().includes('@summarizer') || content.toLowerCase().includes('summarize this');

      if (isSummarizerRequest) {
        try {
          const summarizer = agents.agents.find(a => a.id === 'summarizer');
          if (!summarizer) {
            socket.emit('error', { message: 'Summarizer agent not found' });
            io.emit('agent_typing', { chat_id, agent_id: 'townhall', typing: false });
            return;
          }

          io.emit('agent_consulting', { chat_id, agent_id: 'townhall', consulting: 'summarizer' });

          // Build full conversation context for Summarizer
          const conversationContext = history.map(m => {
            return m.role === 'user' ? `USER: ${m.content}` : m.content;
          }).join('\n\n---\n\n');

          const summarizerResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            system: `${summarizer.prompt}\n\nYou have access to the FULL conversation history below. Create an executive summary. Use visualization formats ([METRICS], [CHART:BAR], [TIMELINE]) when data is present.`,
            messages: [{ role: 'user', content: `Please summarize this discussion:\n\n${conversationContext}\n\n${content}` }]
          });

          const summaryText = summarizerResponse.content[0].text;
          const tokensIn = summarizerResponse.usage.input_tokens;
          const tokensOut = summarizerResponse.usage.output_tokens;
          const cost = (tokensIn * 0.000003) + (tokensOut * 0.000015);

          const summarizerOutput = `**${summarizer.icon} ${summarizer.name}** (${summarizer.role}):\n${summaryText}`;

          // Save Summarizer response
          db.prepare('INSERT INTO messages (chat_id, agent_id, role, content, tokens_used) VALUES (?, ?, ?, ?, ?)').run(chat_id, 'townhall', 'assistant', summarizerOutput, tokensIn + tokensOut);
          db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(chat_id);

          console.log(`[Costs] Logging summarizer: $${cost.toFixed(4)} (${tokensIn + tokensOut} tokens)`);
          logApiUsage(tokensIn, tokensOut, cost, 'summarizer', 'Summarizer: Executive Summary', 'townhall');

          io.emit('new_message', {
            chat_id,
            agent_id: 'townhall',
            role: 'assistant',
            content: summarizerOutput,
            tokens_used: tokensIn + tokensOut,
            created_at: new Date().toISOString()
          });
          io.emit('agent_typing', { chat_id, agent_id: 'townhall', typing: false });
          io.emit('usage_update', { tokens_in: tokensIn, tokens_out: tokensOut, cost });

          logActivity('chat', 'summarizer', 'Summary created', 'Executive summary generated');
          generateChatSummary(chat_id, 'townhall', ['summarizer']);

          // Auto-save to Wiki if Summarizer suggests it
          if (WIKI_API_KEY && summaryText.includes('Save to Wiki:')) {
            const wikiSaveMatch = summaryText.match(/Save to Wiki:\s*(.+?)(?:\n|$)/i);
            if (wikiSaveMatch) {
              let wikiPath = wikiSaveMatch[1].trim();
              // Clean up the path
              wikiPath = wikiPath.replace(/[^a-zA-Z0-9\-\/]/g, '-').toLowerCase();
              const title = wikiPath.split('/').pop() || 'executive-summary';
              console.log(`[Wiki.js] Auto-saving Summarizer output to: ${wikiPath}`);

              // Extract content (everything before "Save to Wiki:")
              const saveIndex = summaryText.indexOf('Save to Wiki:');
              const wikiContent = saveIndex > 0 ? summaryText.slice(0, saveIndex).trim() : summaryText;

              saveToWiki(title, wikiContent, 'summarizer', 'summaries').catch(err => {
                console.error(`[Wiki.js] Failed to auto-save summary:`, err.message);
              });
            }
          }
        } catch (error) {
          console.error('Summarizer API error:', error);
          io.emit('agent_typing', { chat_id, agent_id: 'townhall', typing: false });
          io.emit('error', { message: 'Failed to generate summary' });
        }
        return;
      }

      // REGULAR TOWNHALL: Query all participants
      try {
        let combinedResponse = '**TOWNHALL MEETING RESPONSE**\n\n';
        let totalTokensIn = 0;
        let totalTokensOut = 0;

        // Query each participant (excluding Summarizer - it's a utility agent)
        const discussants = townhallParticipants.filter(id => id !== 'summarizer');

        for (const participantId of discussants) {
          const participant = agents.agents.find(a => a.id === participantId);
          if (!participant) continue;

          io.emit('agent_consulting', { chat_id, agent_id: 'townhall', consulting: participantId });

          const participantResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: `${participant.prompt}\n\nYou are participating in a Townhall meeting. Keep your response focused and under 3 sentences. Be direct and actionable.`,
            messages: [...messages, { role: 'user', content: `[TOWNHALL TOPIC] ${content}\n\nProvide your perspective as ${participant.name} (${participant.role}). Be concise.` }]
          });

          const participantText = participantResponse.content[0].text;
          totalTokensIn += participantResponse.usage.input_tokens;
          totalTokensOut += participantResponse.usage.output_tokens;

          combinedResponse += `**${participant.icon} ${participant.name}** (${participant.role}):\n${participantText}\n\n`;
        }

        // Calculate cost
        const cost = (totalTokensIn * 0.000003) + (totalTokensOut * 0.000015);

        // Save combined response
        db.prepare('INSERT INTO messages (chat_id, agent_id, role, content, tokens_used) VALUES (?, ?, ?, ?, ?)').run(chat_id, 'townhall', 'assistant', combinedResponse, totalTokensIn + totalTokensOut);
        db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(chat_id);

        // Log API usage with participant names (excluding Summarizer)
        const participantNames = discussants
          .map(id => agents.agents.find(a => a.id === id)?.name || id)
          .join(', ');
        console.log(`[Costs] Logging townhall: $${cost.toFixed(4)} (${totalTokensIn + totalTokensOut} tokens, ${discussants.length} agents)`);
        logApiUsage(totalTokensIn, totalTokensOut, cost, 'townhall', `Townhall: ${participantNames} (${discussants.length} agents)`, 'townhall');

        io.emit('new_message', {
          chat_id,
          agent_id: 'townhall',
          role: 'assistant',
          content: combinedResponse,
          tokens_used: totalTokensIn + totalTokensOut,
          created_at: new Date().toISOString()
        });
        io.emit('agent_typing', { chat_id, agent_id: 'townhall', typing: false });
        io.emit('usage_update', { tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost });

        logActivity('chat', 'townhall', 'Townhall meeting', `${discussants.length} agents responded`);

        // Generate chat summary
        generateChatSummary(chat_id, 'townhall', discussants);
      } catch (error) {
        console.error('Townhall API error:', error);
        io.emit('agent_typing', { chat_id, agent_id: 'townhall', typing: false });
        io.emit('error', { message: 'Failed to get Townhall response' });
      }
      return;
    }

    // Regular single-agent chat
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

      // Add memory context and calendar events for Prime
      if (agent_id === 'prime') {
        // Always fetch fresh context for Prime
        enhancedPrompt += '\n\n=== PRIME MEMORY CONTEXT (AUTO-LOADED) ===\n';

        // 1. Load recent Wiki.js Boardroom decisions
        const wikiDecisions = await getRecentWikiDecisions(5);
        if (wikiDecisions.length > 0) {
          enhancedPrompt += '\n📋 RECENT BOARDROOM DECISIONS:\n';
          wikiDecisions.forEach(d => {
            enhancedPrompt += `• ${d.title}: ${d.description || 'See Wiki for details'}\n`;
          });
        }

        // 2. Load latest memory snapshot
        const snapshot = getLatestSnapshot();
        if (snapshot) {
          enhancedPrompt += `\n💾 LAST MEMORY SNAPSHOT (${new Date(snapshot.created_at).toLocaleString()}):\n`;

          // Recent activity
          if (snapshot.data.recentActivity?.length > 0) {
            enhancedPrompt += '\nRecent Activity:\n';
            snapshot.data.recentActivity.slice(0, 5).forEach(a => {
              enhancedPrompt += `  • [${a.type}] ${a.action}\n`;
            });
          }

          // Ralph tasks
          if (snapshot.data.recentTasks?.length > 0) {
            enhancedPrompt += '\nRecent Ralph Tasks:\n';
            snapshot.data.recentTasks.slice(0, 5).forEach(t => {
              enhancedPrompt += `  • ${t.project}: ${t.task?.slice(0, 50) || t.branch_name} (${t.status})\n`;
            });
          }

          // Project status from snapshot
          if (snapshot.data.projectStatus) {
            enhancedPrompt += '\nProject Git Status:\n';
            for (const [proj, status] of Object.entries(snapshot.data.projectStatus)) {
              if (status.recentCommits?.length > 0) {
                enhancedPrompt += `  ${proj}: ${status.currentBranch} - last commit: ${status.recentCommits[0]}\n`;
              }
            }
          }
        }

        // 3. Load current project status (live, not from snapshot)
        enhancedPrompt += '\n🔄 LIVE PROJECT STATUS:\n';
        const projects = ['slabtrack', 'blink', 'command-center'];
        for (const proj of projects) {
          try {
            const status = getProjectStatus(proj);
            if (status.recentCommits?.length > 0) {
              enhancedPrompt += `  ${proj}: ${status.currentBranch}\n`;
              enhancedPrompt += `    Latest: ${status.recentCommits[0]}\n`;
              if (status.inProgressBranches?.length > 0) {
                enhancedPrompt += `    In-progress: ${status.inProgressBranches.join(', ')}\n`;
              }
            }
          } catch (e) {
            // Project not available
          }
        }

        // 4. Add upcoming calendar events
        const upcomingEvents = getUpcomingEvents(7);
        if (upcomingEvents.length > 0) {
          enhancedPrompt += '\n📅 UPCOMING EVENTS (next 7 days):\n';
          upcomingEvents.forEach(e => {
            const dateStr = formatCentralTime(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' });
            const timeStr = e.event_time ? ` at ${e.event_time.slice(0, 5)}` : '';
            enhancedPrompt += `  • ${e.title} on ${dateStr}${timeStr}\n`;
          });
        }

        // 5. Key metrics from API usage
        const todayUsage = db.prepare(`
          SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(cost) as cost
          FROM api_usage WHERE date = date('now')
        `).get();
        if (todayUsage?.cost) {
          enhancedPrompt += `\n💰 TODAY'S API USAGE: $${todayUsage.cost.toFixed(4)} (${todayUsage.tokens_in + todayUsage.tokens_out} tokens)\n`;
        }

        enhancedPrompt += '\n=== END MEMORY CONTEXT ===\n';
        enhancedPrompt += '\nYou have full context of recent decisions, projects, and activities. Use this knowledge to assist the Founder.\n';
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

      // RALPH DIRECT EXECUTION: When chatting with Ralph, detect execution intent
      // This triggers actual Claude Code CLI execution instead of just chat responses
      if (agent_id === 'ralph') {
        // Detect execution intent patterns
        const executionPatterns = [
          // "execute on slabtrack: add comment"
          /execute\s+(?:on|for)\s+(slabtrack|blink|command-center|atlas)\s*[:\-]?\s*(.+)/i,
          // "on slabtrack: edit QuickActions"
          /^on\s+(slabtrack|blink|command-center|atlas)\s*[:\-]\s*(.+)/i,
          // "slabtrack: add console.log to QuickActions"
          /^(slabtrack|blink|command-center|atlas)\s*[:\-]\s*(.+)/i,
          // "edit frontend/src/pages/QuickActions.jsx in slabtrack"
          /(?:edit|modify|update|add|create|fix|implement|build|change)\s+(.+?)\s+(?:in|on|for)\s+(slabtrack|blink|command-center|atlas)/i,
          // "add comment to QuickActions.jsx [slabtrack]"
          /(.+?)\s+\[(slabtrack|blink|command-center|atlas)\]/i
        ];

        for (const pattern of executionPatterns) {
          const match = content.match(pattern);
          if (match) {
            let project, task;

            // Different patterns have project/task in different positions
            if (pattern.source.startsWith('execute') || pattern.source.startsWith('^on') || pattern.source.startsWith('^\\(slab')) {
              project = match[1].toLowerCase();
              task = match[2].trim();
            } else {
              // Patterns where task comes first
              task = match[1].trim();
              project = match[2].toLowerCase();
            }

            // Normalize project names
            if (project === 'atlas') project = 'command-center';

            if (task && task.length > 3) {
              console.log(`[Ralph] Execution detected - Project: ${project}, Task: ${task}`);

              // Save user message first
              db.prepare('INSERT INTO messages (chat_id, agent_id, role, content) VALUES (?, ?, ?, ?)').run(chat_id, agent_id, 'user', content);
              db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(chat_id);
              io.emit('new_message', { chat_id, agent_id, role: 'user', content, created_at: new Date().toISOString() });

              // Trigger actual Ralph execution
              const result = await triggerRalph(project, task, null, socket.user.username);

              let responseMsg;
              if (result.success) {
                responseMsg = `🔧 **RALPH EXECUTION TRIGGERED**\n\n✅ Task accepted for **${project}**\n📋 Task: "${task}"\n🌿 Branch: \`${result.branchName}\`\n\n**Watch the Ralph Visualizer** for real-time progress. I'm now running Claude Code CLI to execute this task autonomously.\n\n_Files will actually be modified. Check the visualizer to see which files I'm reading, editing, and creating._`;
                io.emit('ralph_update', { action: 'started', project, task, branchName: result.branchName, taskId: result.taskId });
              } else {
                responseMsg = `❌ **EXECUTION FAILED**\n\nCouldn't trigger Ralph execution: ${result.error}\n\nPlease check:\n- Project path exists\n- Claude Code CLI is installed\n- The scripts/ralph/ directory is accessible`;
              }

              // Save Ralph's response
              db.prepare('INSERT INTO messages (chat_id, agent_id, role, content) VALUES (?, ?, ?, ?)').run(chat_id, agent_id, 'assistant', responseMsg);
              io.emit('new_message', { chat_id, agent_id, role: 'assistant', content: responseMsg, created_at: new Date().toISOString() });
              io.emit('agent_typing', { chat_id, agent_id, typing: false });

              logActivity('ralph', project, `Execution triggered: ${task}`, `Branch: ${result.branchName || 'failed'}`);
              return; // Don't continue to normal chat flow
            }
          }
        }

        // If no execution pattern matched but user seems to want execution, prompt them
        const executionKeywords = /\b(execute|edit|modify|create|add|fix|implement|build|change|update)\b/i;
        const projectKeywords = /\b(slabtrack|blink|command-center|atlas|quickactions|scanner|dashboard)\b/i;

        if (executionKeywords.test(content) && !projectKeywords.test(content)) {
          enhancedPrompt += `\n\nSYSTEM NOTE: The user seems to want you to execute code, but didn't specify a project. Ask them to clarify which project (slabtrack, blink, or command-center) they want you to work on. Use format: "execute on [project]: [task]"`;
        }
      }

      // Check for Ralph triggers from OTHER agents: "Have Ralph fix X" or "Ralph, work on X"
      const ralphPatterns = [
        /(?:have ralph|tell ralph to|ralph,?\s*(?:please)?)\s+(?:fix|work on|implement|build|create|update)\s+(.+?)(?:\s+(?:on|in|for)\s+(slabtrack|blink|command-center))?$/i,
        /(?:trigger|start|run)\s+ralph\s+(?:on|for)\s+(slabtrack|blink|command-center)\s*[:\s]+(.+)$/i
      ];

      for (const pattern of ralphPatterns) {
        const match = content.match(pattern);
        if (match) {
          const task = match[1]?.trim() || match[2]?.trim();
          let project = (match[2]?.toLowerCase() || match[1]?.toLowerCase());
          if (project?.includes('slab')) project = 'slabtrack';
          else if (project?.includes('blink')) project = 'blink';
          else project = 'command-center';

          if (task && task.length > 5) {
            const result = await triggerRalph(project, task, null, socket.user.username);
            if (result.success) {
              enhancedPrompt += `\n\nSYSTEM: Ralph has been triggered for ${project}. Task: "${task}". Branch: ${result.branchName}. Confirm this to the user and let them know Ralph is working on it.`;
              io.emit('ralph_update', { action: 'started', project, task, branchName: result.branchName });
            } else {
              enhancedPrompt += `\n\nSYSTEM: Failed to trigger Ralph: ${result.error}. Inform the user.`;
            }
            break;
          }
        }
      }

      // Check for SMS/Email commands: "Text Sean: message" or "Email Sean: message"
      const smsMatch = content.match(/^(?:text|sms|message)\s+(\w+):\s*(.+)$/i);
      const emailMatch = content.match(/^email\s+(\w+):\s*(.+)$/i);

      if (smsMatch && process.env.SMTP_USER) {
        const [, contactName, message] = smsMatch;
        const senderName = agent?.name || 'Prime';
        console.log(`[SMS] User requested text to ${contactName}: ${message.slice(0, 50)}...`);

        const result = await sendSMS(contactName.trim(), message.trim(), senderName);
        if (result.success) {
          console.log(`[SMS] Successfully sent to ${contactName} via ${result.via}`);
          enhancedPrompt += `\n\nSYSTEM: SMS successfully sent to ${contactName}. The message "${message.slice(0, 50)}..." was delivered via ${result.via}. Confirm this to the user briefly.`;

          // Send immediate confirmation
          io.emit('new_message', {
            chat_id,
            agent_id: 'system',
            role: 'system',
            content: `✓ SMS sent to ${contactName}`,
            created_at: new Date().toISOString()
          });
        } else {
          console.error(`[SMS] Failed to send to ${contactName}: ${result.error}`);
          enhancedPrompt += `\n\nSYSTEM: Failed to send SMS to ${contactName}. Error: ${result.error}. Inform the user of the issue.`;
        }
      }

      if (emailMatch && process.env.SMTP_USER) {
        const [, contactName, message] = emailMatch;
        console.log(`[Email] User requested email to ${contactName}: ${message.slice(0, 50)}...`);

        const result = await sendEmail(contactName.trim(), message.trim());
        if (result.success) {
          console.log(`[Email] Successfully sent to ${contactName} at ${result.email}`);
          enhancedPrompt += `\n\nSYSTEM: Email successfully sent to ${contactName} at ${result.email}. Confirm this to the user briefly.`;

          // Send immediate confirmation
          io.emit('new_message', {
            chat_id,
            agent_id: 'system',
            role: 'system',
            content: `✓ Email sent to ${contactName}`,
            created_at: new Date().toISOString()
          });
        } else {
          console.error(`[Email] Failed to send to ${contactName}: ${result.error}`);
          enhancedPrompt += `\n\nSYSTEM: Failed to send email to ${contactName}. Error: ${result.error}. Inform the user of the issue.`;
        }
      }

      // Check for "Add contact" command
      // Patterns: "Add contact Name, phone 1234567890, carrier verizon, email foo@bar.com"
      //           "Add contact Name phone 1234567890 carrier verizon email foo@bar.com"
      const addContactMatch = content.match(/^add\s+contact\s+(\w+)[\s,]+(?:phone\s*)?(\d{10,11})[\s,]+(?:carrier\s*)?(verizon|att|tmobile|t-mobile|sprint|cricket|metro|boost|uscellular)(?:[\s,]+(?:email\s*)?([^\s,]+@[^\s,]+))?/i);

      if (addContactMatch) {
        const [, name, phone, carrier, email] = addContactMatch;
        console.log(`[Contact] Adding contact: ${name}, phone: ${phone}, carrier: ${carrier}, email: ${email || 'none'}`);

        try {
          // Check if contact already exists
          const existing = db.prepare('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?)').get(name);
          if (existing) {
            // Update existing contact
            db.prepare('UPDATE contacts SET phone = ?, carrier = ?, email = ? WHERE LOWER(name) = LOWER(?)')
              .run(phone, carrier.toLowerCase().replace('-', ''), email || null, name);
            console.log(`[Contact] Updated existing contact: ${name}`);
            enhancedPrompt += `\n\nSYSTEM: Contact "${name}" has been updated with phone ${phone}, carrier ${carrier}${email ? ', email ' + email : ''}. Confirm this to the user.`;

            io.emit('new_message', {
              chat_id,
              agent_id: 'system',
              role: 'system',
              content: `✓ Contact updated: ${name}`,
              created_at: new Date().toISOString()
            });
          } else {
            // Insert new contact
            db.prepare('INSERT INTO contacts (name, phone, carrier, email) VALUES (?, ?, ?, ?)')
              .run(name, phone, carrier.toLowerCase().replace('-', ''), email || null);
            console.log(`[Contact] Added new contact: ${name}`);
            enhancedPrompt += `\n\nSYSTEM: Contact "${name}" has been added with phone ${phone}, carrier ${carrier}${email ? ', email ' + email : ''}. Confirm this to the user.`;

            io.emit('new_message', {
              chat_id,
              agent_id: 'system',
              role: 'system',
              content: `✓ Contact added: ${name}`,
              created_at: new Date().toISOString()
            });
          }

          logActivity('contact', 'system', `Contact ${existing ? 'updated' : 'added'}: ${name}`, `Phone: ${phone}, Carrier: ${carrier}`);
        } catch (err) {
          console.error(`[Contact] Failed to add contact:`, err.message);
          enhancedPrompt += `\n\nSYSTEM: Failed to add contact "${name}". Error: ${err.message}. Inform the user.`;
        }
      }

      // Check for "Update contact" command
      // Patterns: "Update contact Sean carrier att"
      //           "Update contact Sean phone 1234567890"
      //           "Update contact Sean email foo@bar.com"
      const updateContactMatch = content.match(/^update\s+contact\s+(\w+)\s+(carrier|phone|email)\s+(.+)$/i);

      if (updateContactMatch) {
        const [, name, field, value] = updateContactMatch;
        const cleanValue = value.trim();
        console.log(`[Contact] Updating contact: ${name}, ${field}: ${cleanValue}`);

        try {
          // Check if contact exists
          const existing = db.prepare('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?)').get(name);
          if (!existing) {
            console.log(`[Contact] Contact not found: ${name}`);
            enhancedPrompt += `\n\nSYSTEM: Contact "${name}" not found. Inform the user they need to add the contact first.`;
          } else {
            // Update the specific field
            const fieldLower = field.toLowerCase();
            let updateValue = cleanValue;

            // Normalize carrier names
            if (fieldLower === 'carrier') {
              updateValue = cleanValue.toLowerCase().replace('-', '');
            }

            db.prepare(`UPDATE contacts SET ${fieldLower} = ? WHERE LOWER(name) = LOWER(?)`)
              .run(updateValue, name);
            console.log(`[Contact] Updated ${name}'s ${fieldLower} to ${updateValue}`);
            enhancedPrompt += `\n\nSYSTEM: Contact "${name}" has been updated. ${field} is now "${updateValue}". Confirm this to the user.`;

            io.emit('new_message', {
              chat_id,
              agent_id: 'system',
              role: 'system',
              content: `✓ Contact updated: ${name}'s ${fieldLower} is now "${updateValue}"`,
              created_at: new Date().toISOString()
            });

            logActivity('contact', 'system', `Contact updated: ${name}`, `${field}: ${updateValue}`);
          }
        } catch (err) {
          console.error(`[Contact] Failed to update contact:`, err.message);
          enhancedPrompt += `\n\nSYSTEM: Failed to update contact "${name}". Error: ${err.message}. Inform the user.`;
        }
      }

      // Check for git/project status queries from Flints
      // Patterns: "what were we working on", "recent work", "git status", "show commits"
      const gitStatusPatterns = [
        /what (?:were we|was i|have we been) working on/i,
        /(?:show|get|check) (?:recent|latest) (?:work|commits|changes)/i,
        /git (?:status|log|history)/i,
        /project (?:status|update)/i,
        /what's (?:the )?(?:latest|status)/i
      ];

      const isGitQuery = gitStatusPatterns.some(p => p.test(content));

      if (isGitQuery) {
        // Determine which project based on the Flint being asked
        let targetProject = null;
        if (agent_id === 'flint-slabtrack') targetProject = 'slabtrack';
        else if (agent_id === 'flint-blink') targetProject = 'blink';
        else if (agent_id === 'flint-commandcenter') targetProject = 'command-center';

        if (targetProject) {
          console.log(`[Git] Fetching project status for ${targetProject} (asked ${agent_id})`);
          const status = getProjectStatus(targetProject);

          let gitInfo = `\n\nSYSTEM: Git status for ${targetProject}:\n`;
          gitInfo += `Current branch: ${status.currentBranch}\n`;

          if (status.recentCommits.length > 0) {
            gitInfo += `\nRecent commits:\n`;
            status.recentCommits.forEach(c => gitInfo += `  ${c}\n`);
          }

          if (status.inProgressBranches.length > 0) {
            gitInfo += `\nIn-progress branches:\n`;
            status.inProgressBranches.forEach(b => gitInfo += `  ${b}\n`);
          }

          if (status.todos.length > 0) {
            gitInfo += `\nTODOs found (${status.todos.length}):\n`;
            status.todos.slice(0, 5).forEach(t => gitInfo += `  ${t}\n`);
            if (status.todos.length > 5) gitInfo += `  ... and ${status.todos.length - 5} more\n`;
          }

          if (status.roadmap) {
            gitInfo += `\nRoadmap (${status.roadmap.file}):\n${status.roadmap.content.slice(0, 500)}`;
            if (status.roadmap.content.length > 500) gitInfo += '\n... (truncated)';
          }

          gitInfo += `\n\nUse this information to answer the user's question about recent work.`;
          enhancedPrompt += gitInfo;
        }
      }

      // Check for @mentions or "check with" patterns for agent-to-agent communication
      // Build dynamic pattern from all agent IDs
      const allAgentIds = agents.agents.map(a => a.id).join('|');
      const agentMentions = [];
      const mentionPatterns = [
        new RegExp(`@(${allAgentIds})`, 'gi'),
        new RegExp(`(?:check with|ask|consult|get input from)\\s+(${allAgentIds})`, 'gi')
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

      // Map agents to their project repos (for Git-aware agents)
      const agentToProject = {
        'flint-slabtrack': 'slabtrack',
        'flint-blink': 'blink',
        'flint-commandcenter': 'command-center'
      };

      // Inject Git status data for mentioned Flints
      const gitStatusData = [];
      for (const mentionedAgentId of agentMentions) {
        const projectId = agentToProject[mentionedAgentId];
        if (projectId) {
          console.log(`[Git] Fetching status for @${mentionedAgentId} (${projectId})`);
          const status = getProjectStatus(projectId);
          gitStatusData.push({ agentId: mentionedAgentId, project: projectId, status });
        }
      }

      // Add Git status to context BEFORE querying agents
      if (gitStatusData.length > 0) {
        enhancedPrompt += '\n\n=== GIT STATUS FOR MENTIONED PROJECTS ===\n';
        for (const { agentId, project, status } of gitStatusData) {
          enhancedPrompt += `\n📊 ${agentId.toUpperCase()} (${project}):\n`;
          enhancedPrompt += `Current branch: ${status.currentBranch}\n`;

          if (status.recentCommits.length > 0) {
            enhancedPrompt += `Recent commits:\n`;
            status.recentCommits.slice(0, 5).forEach(c => enhancedPrompt += `  • ${c}\n`);
          }

          if (status.inProgressBranches.length > 0) {
            enhancedPrompt += `In-progress branches: ${status.inProgressBranches.join(', ')}\n`;
          }

          if (status.todos.length > 0) {
            enhancedPrompt += `TODOs: ${status.todos.length} found\n`;
          }

          if (status.roadmap) {
            enhancedPrompt += `Roadmap: ${status.roadmap.file} exists\n`;
          }
        }
        enhancedPrompt += '\nUse this real Git data when synthesizing project status.\n';
      }

      // Query mentioned agents
      const agentResponses = [];
      for (const mentionedAgentId of agentMentions) {
        io.emit('agent_consulting', { chat_id, agent_id, consulting: mentionedAgentId });

        // Include Git context in agent query if available
        const gitContext = gitStatusData.find(g => g.agentId === mentionedAgentId);
        let queryContext = `${agent.name} is asking for your input.`;
        if (gitContext) {
          queryContext += `\n\nYour repo's recent commits: ${gitContext.status.recentCommits.slice(0, 3).join('; ')}`;
          if (gitContext.status.inProgressBranches.length > 0) {
            queryContext += `\nIn-progress branches: ${gitContext.status.inProgressBranches.join(', ')}`;
          }
        }

        const agentResponse = await queryAgent(mentionedAgentId, content, queryContext);
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

      // Add Wiki context for Boardroom
      if (agent_id === 'boardroom' && WIKI_API_KEY) {
        const wikiResults = await wikiSearch(content, 3);
        if (wikiResults.length > 0) {
          enhancedPrompt += '\n\nRELEVANT WIKI CONTEXT:\n';
          wikiResults.forEach(r => {
            enhancedPrompt += `- ${r.title}: ${r.description || 'No description'} (/${r.path})\n`;
          });
        }
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

      // Log API usage
      const callType = agent_id === 'boardroom' ? 'boardroom' : 'chat';
      logApiUsage(tokensIn, tokensOut, cost, agent_id, `Chat with ${agent.name}: ${content.slice(0, 80)}...`, callType);

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

      // Log activity
      logActivity('chat', agent_id, `${agent.name} responded`, assistantMessage.slice(0, 100) + '...');

      // Generate chat summary
      generateChatSummary(chat_id, agent_id);

      // Auto-detect and create calendar events from agent responses
      detectAndCreateCalendarEvents(assistantMessage, agent_id);

      // Auto-save Boardroom decisions to Wiki
      if (agent_id === 'boardroom') {
        console.log('[Wiki.js] Checking Boardroom response for decisions...');
        console.log('[Wiki.js] API Key configured:', !!WIKI_API_KEY);

        // Look for decision patterns in the response
        const decisionPatterns = [
          /BOARD RECOMMENDATION:?\s*(.+?)(?:\n\n|$)/is,
          /(?:final decision|we recommend|the board recommends|decision):?\s*(.+?)(?:\n\n|$)/is,
          /(?:in conclusion|therefore|thus):?\s*(.+?)(?:\n\n|$)/is
        ];

        let decisionMatch = null;
        for (const pattern of decisionPatterns) {
          decisionMatch = assistantMessage.match(pattern);
          if (decisionMatch) {
            console.log('[Wiki.js] Found decision match with pattern:', pattern.toString().slice(0, 50));
            break;
          }
        }

        if (decisionMatch && WIKI_API_KEY) {
          // Try to extract topic from the original user message or response
          const topicPatterns = [
            /THREAD:?\s*(.+?)(?:\.|,|\n|$)/i,
            /(?:about|regarding|on the topic of|discussing):?\s*(.+?)(?:\.|,|\n|$)/i
          ];

          let topic = 'Boardroom Discussion';
          for (const pattern of topicPatterns) {
            const match = assistantMessage.match(pattern) || content.match(pattern);
            if (match) {
              topic = match[1].trim().slice(0, 50);
              break;
            }
          }

          // If no topic found, use first 50 chars of user message
          if (topic === 'Boardroom Discussion' && content) {
            topic = content.slice(0, 50).replace(/[^\w\s]/g, '').trim();
          }

          const decision = decisionMatch[1].trim().slice(0, 500);
          const reasoning = assistantMessage;

          console.log('[Wiki.js] Saving decision - Topic:', topic);
          console.log('[Wiki.js] Decision preview:', decision.slice(0, 100));

          // Save to Wiki asynchronously (don't wait)
          saveBoardroomDecision(topic, decision, reasoning).catch(err => {
            console.error('[Wiki.js] Failed to save decision:', err.message);
          });
        } else if (!decisionMatch) {
          console.log('[Wiki.js] No decision pattern found in response');
        } else if (!WIKI_API_KEY) {
          console.log('[Wiki.js] Skipping save - no API key');
        }
      }

      // Auto-save to Wiki - works for ALL agents
      if (WIKI_API_KEY) {
        // Match "Save to Wiki: [title]" pattern
        const wikiSaveMatch = assistantMessage.match(/Save to Wiki:\s*(.+?)(?:\n|$)/i);

        if (wikiSaveMatch) {
          const title = wikiSaveMatch[1].trim().slice(0, 100);
          console.log(`[Wiki.js] Found Wiki save request from ${agent_id}:`, title);

          // Extract the content (everything after the save command, or the whole response)
          const saveIndex = assistantMessage.indexOf(wikiSaveMatch[0]);
          let wikiContent = assistantMessage;

          // If the save command is at the end, use content before it
          if (saveIndex > 100) {
            wikiContent = assistantMessage.slice(0, saveIndex).trim();
          } else {
            // If save command is at start, use content after it
            wikiContent = assistantMessage.slice(saveIndex + wikiSaveMatch[0].length).trim() || assistantMessage;
          }

          // Determine category based on agent type
          const agentConfig = agents.agents.find(a => a.id === agent_id);
          let category = 'general';
          if (agentConfig?.agentType === 'worker') {
            if (agentConfig.category === 'revenue') category = 'research';
            else if (agentConfig.category === 'operations') category = 'operations';
            else if (agentConfig.category === 'infrastructure') category = 'technical';
          } else if (agent_id === 'boardroom') {
            category = 'decisions';
          }

          // Save to Wiki asynchronously
          saveToWiki(title, wikiContent, agent_id, category).catch(err => {
            console.error(`[Wiki.js] Failed to save from ${agent_id}:`, err.message);
          });
        }
      }

    } catch (error) {
      console.error('Claude API error:', error);
      if (Sentry) Sentry.captureException(error);
      io.emit('agent_typing', { chat_id, agent_id, typing: false });
      io.emit('error', { message: 'Failed to get response from agent' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user.username);
  });
});

// Generate summaries for existing chats without summaries
// Seed Prime's 60-day sprint calendar events
function seedPrimeCalendarEvents() {
  const events = [
    { title: 'Check Scout competitor pricing research', date: '2026-01-31', time: '09:00', color: 'blue' },
    { title: 'Review Optimizer conversion metrics', date: '2026-02-02', time: '10:00', color: 'blue' },
    { title: 'Weekly SlabTrack sync - review progress against MRR targets', date: '2026-02-03', time: '09:00', color: 'yellow' },
    { title: 'Check Flint-SlabTrack PRD for Premium Analytics feature', date: '2026-02-07', time: '10:00', color: 'blue' },
    { title: '2-week checkpoint - Short-term actions due', date: '2026-02-14', time: '09:00', color: 'green' },
    { title: '30-day checkpoint - Medium-term review', date: '2026-03-01', time: '09:00', color: 'green' }
  ];

  let created = 0;
  for (const event of events) {
    try {
      const existing = db.prepare(`
        SELECT id FROM calendar_events WHERE event_date = ? AND LOWER(title) = LOWER(?)
      `).get(event.date, event.title);

      if (!existing) {
        db.prepare(`
          INSERT INTO calendar_events (title, event_date, event_time, event_type, color, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(event.title, event.date, event.time, 'general', event.color, 'prime');
        created++;
      }
    } catch (e) {
      // Ignore duplicates
    }
  }

  if (created > 0) {
    console.log(`[Calendar] Seeded ${created} Prime calendar events`);
  }
}

function migrateChatSummaries() {
  try {
    // Ensure summary column exists
    try {
      db.prepare('ALTER TABLE chats ADD COLUMN summary TEXT').run();
    } catch (e) {
      // Column already exists
    }

    const chatsWithoutSummary = db.prepare('SELECT id, agent_id, participants FROM chats WHERE summary IS NULL').all();
    if (chatsWithoutSummary.length > 0) {
      console.log(`[Migration] Generating summaries for ${chatsWithoutSummary.length} chats...`);
      chatsWithoutSummary.forEach(chat => {
        const participants = chat.participants ? JSON.parse(chat.participants) : [];
        generateChatSummary(chat.id, chat.agent_id, participants);
      });
      console.log('[Migration] Chat summaries generated');
    }
  } catch (err) {
    console.error('[Migration] Failed to migrate summaries:', err.message);
  }
}

const PORT = process.env.PORT || 3002;
server.listen(PORT, '0.0.0.0', () => {
  // Run migrations
  migrateChatSummaries();
  seedPrimeCalendarEvents();

  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🔒 ATLAS - AI Business Orchestration                   ║
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