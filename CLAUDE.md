# Command Center

AI Agent Chat Interface with multi-agent support and voice synthesis.

## Tech Stack

- **Frontend**: Vite + React + Tailwind CSS
- **Backend**: Express.js + Socket.IO
- **Database**: SQLite (better-sqlite3)
- **AI**: Anthropic Claude API
- **Voice**: ElevenLabs TTS API

## Project Structure

```
command-center/
├── src/                  # Frontend React source
├── dist/                 # Built frontend (generated)
├── database/             # SQLite database files
├── server.js             # Express backend server
├── agents.json           # Agent configurations
├── package.json          # Dependencies
└── deploy.ps1            # Deployment script
```

## Development

```bash
# Install dependencies
npm install

# Run frontend dev server (hot reload)
npm run dev

# Run backend server
node server.js

# Build for production
npm run build
```

## Deployment

Deploy to production server via PowerShell:

```powershell
# Full deploy (build + copy + reminder to restart)
.\deploy.ps1

# Skip build (just copy existing dist)
.\deploy.ps1 -SkipBuild

# Skip PM2 restart reminder
.\deploy.ps1 -SkipRestart
```

### Server Details

- **Server IP**: 100.117.103.53 (Tailscale network)
- **Server Path**: C:\Users\Redhe\command-center\
- **PM2 Process**: command-center
- **Production URL**: http://100.117.103.53:3456

### Manual PM2 Restart

On the server, run:
```bash
pm2 restart command-center
```

## Environment Variables (.env)

```
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
JWT_SECRET=your-secret-key
PORT=3456
```

## Key Features

- Multi-agent chat system with configurable personas
- Real-time messaging via WebSocket
- ElevenLabs voice synthesis for agent responses
- JWT authentication
- SQLite for chat history persistence
- Token usage tracking

## Agent Configuration

Agents are defined in `agents.json`. Each agent has:
- `id`: Unique identifier
- `name`: Display name
- `description`: Short description
- `systemPrompt`: Claude system prompt
- `voiceId`: ElevenLabs voice ID (optional)
- `model`: Claude model to use
