#!/usr/bin/env node
/**
 * SUPPLIER WORKER - Card Inventory Management Agent
 *
 * Runs on your local machine where card images are uploaded.
 * Connects to ATLAS server via WebSocket.
 * Monitors folder for card images, identifies them, researches pricing,
 * and imports to SlabTrack database.
 *
 * Usage: node supplier-worker.js
 * PM2: pm2 start supplier-worker.js --name supplier-worker
 */

const { spawn, execSync } = require('child_process');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const express = require('express');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');

// ==================== CONFIGURATION ====================
const CONFIG = {
  // ATLAS server URL
  atlasUrl: process.env.ATLAS_URL || 'http://100.117.103.53:3002',

  // Authentication token
  authToken: process.env.ATLAS_TOKEN || 'atlas-supplier-worker-2026',

  // Worker identification
  workerName: 'Supplier',
  workerType: 'supplier',

  // Folder paths
  watchFolder: 'C:/Users/huddl/card-uploads',
  processedFolder: 'C:/Users/huddl/card-uploads/processed',
  pendingFolder: 'C:/Users/huddl/card-uploads/pending',

  // SlabTrack database
  slabtrackDb: 'C:/Users/huddl/OneDrive/Desktop/GitHub/slabtrack/backend/database/slabtrack.db',
  defaultUserId: 1, // Admin user for imported cards

  // Email configuration
  email: {
    recipient: 'huddleeco@gmail.com',
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    }
  },

  // Webhook server
  webhookPort: 3005,
  webhookHost: '0.0.0.0',

  // Image pair detection patterns
  pairPatterns: [
    { front: /(.+)\(1\)\./, back: /(.+)\(2\)\./ },           // name(1).jpg / name(2).jpg
    { front: /(.+)-1\./, back: /(.+)-2\./ },                 // name-1.jpg / name-2.jpg
    { front: /(.+)_a\./, back: /(.+)_b\./ },                 // name_a.jpg / name_b.jpg
    { front: /(.+)\./, back: /(.+)b\./ },                    // name.jpg / nameb.jpg
    { front: /(.+)_front\./, back: /(.+)_back\./ },          // name_front.jpg / name_back.jpg
    { front: /(.+)-front\./, back: /(.+)-back\./ },          // name-front.jpg / name-back.jpg
  ],

  // Supported image extensions
  imageExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.heic']
};

// ==================== STATE ====================
let socket = null;
let emailTransporter = null;
let db = null;
const pendingIdentifications = new Map(); // sessionId -> card data
const pendingPricing = new Map();         // sessionId -> card data
const processedFiles = new Set();         // Track processed files to avoid duplicates

// ==================== LOGGING ====================
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [Supplier] [${level.toUpperCase()}]`;

  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }

  // Emit to ATLAS if connected
  if (socket?.connected) {
    socket.emit('supplier:log', { level, message, data, timestamp });
  }
}

// ==================== FOLDER SETUP ====================
function ensureFolders() {
  const folders = [CONFIG.watchFolder, CONFIG.processedFolder, CONFIG.pendingFolder];

  folders.forEach(folder => {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      log('info', `Created folder: ${folder}`);
    }
  });

  log('info', 'Folder structure verified');
}

// ==================== EMAIL SETUP ====================
function setupEmail() {
  if (!CONFIG.email.smtp.auth.user) {
    log('warn', 'SMTP not configured - email features disabled. Set SMTP_USER and SMTP_PASS environment variables.');
    return false;
  }

  emailTransporter = nodemailer.createTransport(CONFIG.email.smtp);

  emailTransporter.verify((error, success) => {
    if (error) {
      log('error', 'SMTP configuration error:', error.message);
    } else {
      log('info', 'SMTP server ready');
    }
  });

  return true;
}

// ==================== DATABASE SETUP ====================
function setupDatabase() {
  try {
    db = new Database(CONFIG.slabtrackDb);
    log('info', `Connected to SlabTrack database: ${CONFIG.slabtrackDb}`);
    return true;
  } catch (error) {
    log('error', 'Failed to connect to SlabTrack database:', error.message);
    return false;
  }
}

// ==================== IMAGE PAIR DETECTION ====================
function findImagePairs(files) {
  const pairs = [];
  const used = new Set();

  // Filter to only image files
  const imageFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return CONFIG.imageExtensions.includes(ext);
  });

  for (const file of imageFiles) {
    if (used.has(file)) continue;

    const baseName = path.basename(file);
    const ext = path.extname(file);
    const nameWithoutExt = baseName.slice(0, -ext.length);

    // Try each pattern
    for (const pattern of CONFIG.pairPatterns) {
      const frontMatch = baseName.match(pattern.front);
      if (frontMatch) {
        // Found potential front image, look for back
        const baseId = frontMatch[1];

        for (const otherFile of imageFiles) {
          if (used.has(otherFile) || otherFile === file) continue;

          const otherBase = path.basename(otherFile);
          const backMatch = otherBase.match(pattern.back);

          if (backMatch && backMatch[1] === baseId) {
            pairs.push({
              front: file,
              back: otherFile,
              baseName: baseId
            });
            used.add(file);
            used.add(otherFile);
            break;
          }
        }
        break;
      }
    }

    // If no pair found, treat as single card (front only)
    if (!used.has(file)) {
      pairs.push({
        front: file,
        back: null,
        baseName: nameWithoutExt
      });
      used.add(file);
    }
  }

  return pairs;
}

// ==================== CLAUDE CODE CLI IDENTIFICATION ====================
async function identifyCard(imagePair) {
  const { front, back, baseName } = imagePair;

  log('info', `Identifying card: ${baseName}`);

  const frontPath = path.join(CONFIG.watchFolder, front);
  const backPath = back ? path.join(CONFIG.watchFolder, back) : null;

  // Build Claude Code prompt
  let prompt = `Analyze this sports card image and provide detailed identification.

Front image: ${frontPath}
${backPath ? `Back image: ${backPath}` : 'No back image provided.'}

Please identify and provide the following information in JSON format:
{
  "player": "Player full name",
  "year": 2024,
  "set_name": "Full set name (e.g., Topps Chrome, Panini Prizm)",
  "card_number": "Card number if visible",
  "parallel": "Parallel type if any (e.g., Refractor, Silver, Gold)",
  "numbered": "Serial numbering if any (e.g., /99, /25)",
  "team": "Team name",
  "sport": "Sport (baseball, basketball, football, hockey, soccer)",
  "is_graded": false,
  "grading_company": null,
  "grade": null,
  "cert_number": null,
  "condition": "estimated condition (mint, near_mint, excellent, good, fair, poor)",
  "confidence": "high/medium/low",
  "notes": "Any additional observations"
}

If this is a graded card (in a PSA, BGS, SGC, etc. slab), set is_graded to true and fill in grading details.

Return ONLY the JSON object, no additional text.`;

  return new Promise((resolve, reject) => {
    // Use Claude Code CLI for identification (FREE with Pro subscription)
    const claudeProcess = spawn('claude', ['-p', prompt, '--no-input'], {
      cwd: CONFIG.watchFolder,
      shell: true
    });

    let output = '';
    let errorOutput = '';

    claudeProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    claudeProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    claudeProcess.on('close', (code) => {
      if (code !== 0) {
        log('error', `Claude CLI exited with code ${code}`, errorOutput);
        reject(new Error(`Claude CLI failed: ${errorOutput}`));
        return;
      }

      try {
        // Extract JSON from output
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in Claude output');
        }

        const cardData = JSON.parse(jsonMatch[0]);
        cardData.front_image = front;
        cardData.back_image = back;
        cardData.baseName = baseName;

        log('info', `Card identified: ${cardData.player} - ${cardData.year} ${cardData.set_name}`);
        resolve(cardData);
      } catch (parseError) {
        log('error', 'Failed to parse Claude output:', output);
        reject(parseError);
      }
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      claudeProcess.kill();
      reject(new Error('Claude CLI timeout'));
    }, 120000);
  });
}

// ==================== EBAY PRICING RESEARCH ====================
async function researchPricing(cardData) {
  log('info', `Researching eBay pricing for: ${cardData.player}`);

  // Build search string
  const searchParts = [
    cardData.year,
    cardData.set_name,
    cardData.player,
    cardData.parallel,
    cardData.numbered,
    cardData.is_graded ? `${cardData.grading_company} ${cardData.grade}` : null
  ].filter(Boolean);

  const searchString = searchParts.join(' ');

  // Use Claude Code to research eBay sold listings
  const prompt = `Research eBay SOLD listings for this sports card:

Search: "${searchString}"

Find recent sold listings and provide pricing data in JSON format:
{
  "search_string": "${searchString}",
  "ebay_low": lowest sold price,
  "ebay_avg": average sold price,
  "ebay_high": highest sold price,
  "sample_size": number of sold listings found,
  "recent_sales": [
    { "price": 25.00, "date": "2026-01-15", "condition": "description" }
  ],
  "notes": "Market observations, trends, etc."
}

Focus on SOLD listings from the past 90 days. Return ONLY the JSON object.`;

  return new Promise((resolve, reject) => {
    const claudeProcess = spawn('claude', ['-p', prompt, '--no-input'], {
      shell: true
    });

    let output = '';

    claudeProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    claudeProcess.on('close', (code) => {
      try {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          // Return empty pricing if no data found
          resolve({
            search_string: searchString,
            ebay_low: null,
            ebay_avg: null,
            ebay_high: null,
            sample_size: 0,
            notes: 'No pricing data found'
          });
          return;
        }

        const pricingData = JSON.parse(jsonMatch[0]);
        log('info', `Pricing found: $${pricingData.ebay_low} - $${pricingData.ebay_high} (${pricingData.sample_size} sales)`);
        resolve(pricingData);
      } catch (parseError) {
        log('warn', 'Failed to parse pricing data, returning empty');
        resolve({
          search_string: searchString,
          ebay_low: null,
          ebay_avg: null,
          ebay_high: null,
          sample_size: 0,
          notes: 'Pricing research failed'
        });
      }
    });

    setTimeout(() => {
      claudeProcess.kill();
      resolve({
        search_string: searchString,
        ebay_low: null,
        ebay_avg: null,
        ebay_high: null,
        sample_size: 0,
        notes: 'Pricing research timeout'
      });
    }, 120000);
  });
}

// ==================== EMAIL REPORTS ====================
function generateSessionId() {
  return `sup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function sendIdentificationEmail(cardData, sessionId) {
  if (!emailTransporter) {
    log('warn', 'Email not configured, skipping identification email');
    return false;
  }

  pendingIdentifications.set(sessionId, cardData);

  const approvalUrl = `http://100.91.205.101:${CONFIG.webhookPort}/approve-identification?session=${sessionId}`;
  const rejectUrl = `http://100.91.205.101:${CONFIG.webhookPort}/reject-identification?session=${sessionId}`;

  const html = `
    <h2>🃏 Card Identification Report</h2>
    <p>A new card has been identified and needs your approval.</p>

    <h3>Card Details:</h3>
    <table border="1" cellpadding="8" style="border-collapse: collapse;">
      <tr><td><strong>Player</strong></td><td>${cardData.player}</td></tr>
      <tr><td><strong>Year</strong></td><td>${cardData.year}</td></tr>
      <tr><td><strong>Set</strong></td><td>${cardData.set_name}</td></tr>
      <tr><td><strong>Card #</strong></td><td>${cardData.card_number || 'N/A'}</td></tr>
      <tr><td><strong>Parallel</strong></td><td>${cardData.parallel || 'Base'}</td></tr>
      <tr><td><strong>Numbered</strong></td><td>${cardData.numbered || 'N/A'}</td></tr>
      <tr><td><strong>Team</strong></td><td>${cardData.team}</td></tr>
      <tr><td><strong>Sport</strong></td><td>${cardData.sport}</td></tr>
      <tr><td><strong>Graded</strong></td><td>${cardData.is_graded ? `${cardData.grading_company} ${cardData.grade}` : 'Raw'}</td></tr>
      <tr><td><strong>Condition</strong></td><td>${cardData.condition}</td></tr>
      <tr><td><strong>Confidence</strong></td><td>${cardData.confidence}</td></tr>
      <tr><td><strong>Notes</strong></td><td>${cardData.notes || 'None'}</td></tr>
    </table>

    <h3>Images:</h3>
    <p>Front: ${cardData.front_image}</p>
    ${cardData.back_image ? `<p>Back: ${cardData.back_image}</p>` : '<p>Back: Not provided</p>'}

    <h3>Actions:</h3>
    <p>
      <a href="${approvalUrl}" style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-right: 10px;">
        ✅ Approve & Research Pricing
      </a>
      <a href="${rejectUrl}" style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        ❌ Reject
      </a>
    </p>

    <hr>
    <p style="color: #888; font-size: 12px;">Session ID: ${sessionId}<br>Generated by ATLAS Supplier Worker</p>
  `;

  try {
    await emailTransporter.sendMail({
      from: CONFIG.email.from,
      to: CONFIG.email.recipient,
      subject: `🃏 Card ID: ${cardData.player} - ${cardData.year} ${cardData.set_name}`,
      html
    });

    log('info', `Identification email sent for session ${sessionId}`);
    return true;
  } catch (error) {
    log('error', 'Failed to send identification email:', error.message);
    return false;
  }
}

async function sendPricingEmail(cardData, pricingData, sessionId) {
  if (!emailTransporter) {
    log('warn', 'Email not configured, skipping pricing email');
    return false;
  }

  const combined = { ...cardData, pricing: pricingData };
  pendingPricing.set(sessionId, combined);

  const approvalUrl = `http://100.91.205.101:${CONFIG.webhookPort}/approve-pricing?session=${sessionId}`;
  const rejectUrl = `http://100.91.205.101:${CONFIG.webhookPort}/reject-pricing?session=${sessionId}`;

  const html = `
    <h2>💰 Card Pricing Report</h2>
    <p>Pricing research complete for your card.</p>

    <h3>Card:</h3>
    <p><strong>${cardData.player}</strong> - ${cardData.year} ${cardData.set_name} ${cardData.parallel || ''}</p>

    <h3>eBay Sold Pricing:</h3>
    <table border="1" cellpadding="8" style="border-collapse: collapse;">
      <tr style="background: #f5f5f5;">
        <td><strong>Low</strong></td>
        <td><strong>Average</strong></td>
        <td><strong>High</strong></td>
        <td><strong>Sample Size</strong></td>
      </tr>
      <tr>
        <td style="color: #22c55e; font-size: 18px;">$${pricingData.ebay_low?.toFixed(2) || 'N/A'}</td>
        <td style="color: #3b82f6; font-size: 18px; font-weight: bold;">$${pricingData.ebay_avg?.toFixed(2) || 'N/A'}</td>
        <td style="color: #ef4444; font-size: 18px;">$${pricingData.ebay_high?.toFixed(2) || 'N/A'}</td>
        <td>${pricingData.sample_size || 0} sales</td>
      </tr>
    </table>

    ${pricingData.recent_sales?.length > 0 ? `
    <h3>Recent Sales:</h3>
    <ul>
      ${pricingData.recent_sales.slice(0, 5).map(sale =>
        `<li>$${sale.price?.toFixed(2)} - ${sale.date} (${sale.condition || 'N/A'})</li>`
      ).join('')}
    </ul>
    ` : ''}

    <p><strong>Notes:</strong> ${pricingData.notes || 'None'}</p>

    <h3>Actions:</h3>
    <p>
      <a href="${approvalUrl}" style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-right: 10px;">
        ✅ Approve & Import to SlabTrack
      </a>
      <a href="${rejectUrl}" style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        ❌ Reject
      </a>
    </p>

    <hr>
    <p style="color: #888; font-size: 12px;">Session ID: ${sessionId}<br>Search: ${pricingData.search_string}<br>Generated by ATLAS Supplier Worker</p>
  `;

  try {
    await emailTransporter.sendMail({
      from: CONFIG.email.from,
      to: CONFIG.email.recipient,
      subject: `💰 Pricing: ${cardData.player} - $${pricingData.ebay_avg?.toFixed(2) || 'N/A'} avg`,
      html
    });

    log('info', `Pricing email sent for session ${sessionId}`);
    return true;
  } catch (error) {
    log('error', 'Failed to send pricing email:', error.message);
    return false;
  }
}

// ==================== SLABTRACK IMPORT ====================
function importToSlabTrack(cardData, pricingData) {
  if (!db) {
    log('error', 'Database not connected, cannot import');
    return null;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO cards (
        user_id, player, year, set_name, card_number, parallel, numbered,
        team, sport, is_graded, grading_company, grade, cert_number,
        condition, ebay_search_string, ebay_low, ebay_avg, ebay_high,
        ebay_sample_size, ebay_last_checked, source, owner_notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, datetime('now'), 'supplier-worker', ?
      )
    `);

    const result = stmt.run(
      CONFIG.defaultUserId,
      cardData.player,
      cardData.year,
      cardData.set_name,
      cardData.card_number || null,
      cardData.parallel || null,
      cardData.numbered || null,
      cardData.team,
      cardData.sport,
      cardData.is_graded ? 1 : 0,
      cardData.grading_company || null,
      cardData.grade || null,
      cardData.cert_number || null,
      cardData.condition,
      pricingData.search_string,
      pricingData.ebay_low,
      pricingData.ebay_avg,
      pricingData.ebay_high,
      pricingData.sample_size || 0,
      `Imported via Supplier Worker. Confidence: ${cardData.confidence}. ${cardData.notes || ''}`
    );

    log('info', `Card imported to SlabTrack with ID: ${result.lastInsertRowid}`);
    return result.lastInsertRowid;
  } catch (error) {
    log('error', 'Failed to import card to SlabTrack:', error.message);
    return null;
  }
}

// ==================== FILE PROCESSING ====================
function moveToProcessed(files) {
  files.forEach(file => {
    if (!file) return;

    const sourcePath = path.join(CONFIG.watchFolder, file);
    const destPath = path.join(CONFIG.processedFolder, file);

    try {
      if (fs.existsSync(sourcePath)) {
        fs.renameSync(sourcePath, destPath);
        log('info', `Moved to processed: ${file}`);
      }
    } catch (error) {
      log('error', `Failed to move file ${file}:`, error.message);
    }
  });
}

function moveToPending(files) {
  files.forEach(file => {
    if (!file) return;

    const sourcePath = path.join(CONFIG.watchFolder, file);
    const destPath = path.join(CONFIG.pendingFolder, file);

    try {
      if (fs.existsSync(sourcePath)) {
        fs.renameSync(sourcePath, destPath);
        log('info', `Moved to pending: ${file}`);
      }
    } catch (error) {
      log('error', `Failed to move file ${file}:`, error.message);
    }
  });
}

// ==================== WEBHOOK SERVER ====================
function startWebhookServer() {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', worker: CONFIG.workerName });
  });

  // Approve identification -> research pricing
  app.get('/approve-identification', async (req, res) => {
    const sessionId = req.query.session;
    const cardData = pendingIdentifications.get(sessionId);

    if (!cardData) {
      return res.status(404).send(`
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2>❌ Session Not Found</h2>
          <p>This approval link may have expired or already been used.</p>
        </body></html>
      `);
    }

    log('info', `Identification approved for session ${sessionId}`);
    pendingIdentifications.delete(sessionId);

    // Emit to ATLAS
    if (socket?.connected) {
      socket.emit('supplier:identification_approved', { sessionId, cardData });
    }

    res.send(`
      <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2>✅ Identification Approved</h2>
        <p>Researching eBay pricing for <strong>${cardData.player}</strong>...</p>
        <p>You'll receive another email with pricing data shortly.</p>
      </body></html>
    `);

    // Research pricing
    try {
      const pricingData = await researchPricing(cardData);
      const pricingSessionId = generateSessionId();
      await sendPricingEmail(cardData, pricingData, pricingSessionId);

      // Move files to pending while awaiting final approval
      moveToPending([cardData.front_image, cardData.back_image]);
    } catch (error) {
      log('error', 'Pricing research failed:', error.message);
    }
  });

  // Reject identification
  app.get('/reject-identification', (req, res) => {
    const sessionId = req.query.session;
    const cardData = pendingIdentifications.get(sessionId);

    if (!cardData) {
      return res.status(404).send(`
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2>❌ Session Not Found</h2>
        </body></html>
      `);
    }

    log('info', `Identification rejected for session ${sessionId}`);
    pendingIdentifications.delete(sessionId);

    // Move to processed anyway (rejected)
    moveToProcessed([cardData.front_image, cardData.back_image]);

    if (socket?.connected) {
      socket.emit('supplier:identification_rejected', { sessionId, cardData });
    }

    res.send(`
      <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2>❌ Identification Rejected</h2>
        <p>The card has been skipped and images moved to processed folder.</p>
      </body></html>
    `);
  });

  // Approve pricing -> import to SlabTrack
  app.get('/approve-pricing', async (req, res) => {
    const sessionId = req.query.session;
    const data = pendingPricing.get(sessionId);

    if (!data) {
      return res.status(404).send(`
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2>❌ Session Not Found</h2>
        </body></html>
      `);
    }

    log('info', `Pricing approved for session ${sessionId}`);
    pendingPricing.delete(sessionId);

    // Import to SlabTrack
    const cardId = importToSlabTrack(data, data.pricing);

    // Move files from pending to processed
    const frontInPending = path.join(CONFIG.pendingFolder, data.front_image);
    const backInPending = data.back_image ? path.join(CONFIG.pendingFolder, data.back_image) : null;

    [frontInPending, backInPending].forEach(file => {
      if (file && fs.existsSync(file)) {
        const dest = path.join(CONFIG.processedFolder, path.basename(file));
        fs.renameSync(file, dest);
      }
    });

    if (socket?.connected) {
      socket.emit('supplier:card_imported', { sessionId, cardId, cardData: data });
    }

    res.send(`
      <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2>✅ Card Imported to SlabTrack</h2>
        <p><strong>${data.player}</strong> - ${data.year} ${data.set_name}</p>
        <p>Card ID: ${cardId || 'Import failed'}</p>
        <p>Value: $${data.pricing?.ebay_avg?.toFixed(2) || 'N/A'}</p>
      </body></html>
    `);
  });

  // Reject pricing
  app.get('/reject-pricing', (req, res) => {
    const sessionId = req.query.session;
    const data = pendingPricing.get(sessionId);

    if (!data) {
      return res.status(404).send(`
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2>❌ Session Not Found</h2>
        </body></html>
      `);
    }

    log('info', `Pricing rejected for session ${sessionId}`);
    pendingPricing.delete(sessionId);

    // Move files from pending to processed
    const frontInPending = path.join(CONFIG.pendingFolder, data.front_image);
    const backInPending = data.back_image ? path.join(CONFIG.pendingFolder, data.back_image) : null;

    [frontInPending, backInPending].forEach(file => {
      if (file && fs.existsSync(file)) {
        const dest = path.join(CONFIG.processedFolder, path.basename(file));
        fs.renameSync(file, dest);
      }
    });

    if (socket?.connected) {
      socket.emit('supplier:pricing_rejected', { sessionId, cardData: data });
    }

    res.send(`
      <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2>❌ Pricing Rejected</h2>
        <p>The card was not imported. Images moved to processed folder.</p>
      </body></html>
    `);
  });

  // Start server
  app.listen(CONFIG.webhookPort, CONFIG.webhookHost, () => {
    log('info', `Webhook server running on port ${CONFIG.webhookPort}`);
  });

  return app;
}

// ==================== FOLDER WATCHER ====================
function startFolderWatcher() {
  log('info', `Starting folder watcher on: ${CONFIG.watchFolder}`);

  const watcher = chokidar.watch(CONFIG.watchFolder, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    depth: 0, // only watch root folder, not subfolders
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  // Debounce to batch files added at the same time
  let pendingFiles = [];
  let debounceTimer = null;

  const processPendingFiles = async () => {
    if (pendingFiles.length === 0) return;

    const files = [...pendingFiles];
    pendingFiles = [];

    // Filter out already processed files
    const newFiles = files.filter(f => !processedFiles.has(f));
    if (newFiles.length === 0) return;

    newFiles.forEach(f => processedFiles.add(f));

    log('info', `Processing ${newFiles.length} new files`);

    // Find pairs
    const pairs = findImagePairs(newFiles);
    log('info', `Found ${pairs.length} card(s) to process`);

    // Process each pair
    for (const pair of pairs) {
      try {
        // Identify card
        const cardData = await identifyCard(pair);

        // Generate session and send email
        const sessionId = generateSessionId();
        await sendIdentificationEmail(cardData, sessionId);

        // Emit to ATLAS
        if (socket?.connected) {
          socket.emit('supplier:card_detected', {
            sessionId,
            cardData,
            files: [pair.front, pair.back].filter(Boolean)
          });
        }
      } catch (error) {
        log('error', `Failed to process card ${pair.baseName}:`, error.message);

        // Move failed files to processed to avoid reprocessing
        moveToProcessed([pair.front, pair.back]);
      }
    }
  };

  watcher.on('add', (filePath) => {
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    // Only process image files
    if (!CONFIG.imageExtensions.includes(ext)) return;

    log('info', `New file detected: ${fileName}`);
    pendingFiles.push(fileName);

    // Debounce - wait for more files
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processPendingFiles, 3000);
  });

  watcher.on('error', (error) => {
    log('error', 'Watcher error:', error.message);
  });

  return watcher;
}

// ==================== ATLAS CONNECTION ====================
function connectToAtlas() {
  log('info', `Connecting to ATLAS: ${CONFIG.atlasUrl}`);

  socket = io(CONFIG.atlasUrl, {
    auth: {
      token: CONFIG.authToken,
      workerType: CONFIG.workerType
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
  });

  socket.on('connect', () => {
    log('info', 'Connected to ATLAS');

    // Register worker
    socket.emit('supplier:worker:register', {
      hostname: require('os').hostname(),
      workerName: CONFIG.workerName,
      watchFolder: CONFIG.watchFolder,
      webhookPort: CONFIG.webhookPort
    });
  });

  socket.on('disconnect', (reason) => {
    log('warn', `Disconnected from ATLAS: ${reason}`);
  });

  socket.on('connect_error', (err) => {
    log('error', 'ATLAS connection error:', err.message);
  });

  socket.on('reconnect', (attemptNumber) => {
    log('info', `Reconnected to ATLAS after ${attemptNumber} attempts`);
  });

  // Handle manual card submission from ATLAS UI
  socket.on('supplier:process_card', async (data) => {
    const { front, back } = data;
    log('info', 'Manual card submission received from ATLAS');

    try {
      const pair = { front, back, baseName: path.basename(front, path.extname(front)) };
      const cardData = await identifyCard(pair);
      const sessionId = generateSessionId();
      await sendIdentificationEmail(cardData, sessionId);

      socket.emit('supplier:card_detected', { sessionId, cardData });
    } catch (error) {
      socket.emit('supplier:error', { message: error.message });
    }
  });

  return socket;
}

// ==================== MAIN ====================
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           SUPPLIER WORKER - Card Inventory Agent          ║
║                    ATLAS by BE1st                         ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Setup
  ensureFolders();
  setupEmail();
  setupDatabase();

  // Start services
  startWebhookServer();
  connectToAtlas();
  startFolderWatcher();

  log('info', 'Supplier Worker started successfully');
  log('info', `Watching folder: ${CONFIG.watchFolder}`);
  log('info', `Webhook server: http://localhost:${CONFIG.webhookPort}`);

  // Handle shutdown
  process.on('SIGINT', () => {
    log('info', 'Shutting down Supplier Worker...');
    if (socket) socket.close();
    if (db) db.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('info', 'Shutting down Supplier Worker...');
    if (socket) socket.close();
    if (db) db.close();
    process.exit(0);
  });
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
