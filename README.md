# Blackwell Bank MCP App Demo

An interactive credit card sales demo built with the [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps). The demo runs as a rich UI panel inside ChatGPT, Claude.ai, and Claude Desktop — showing card discovery, eligibility checks, and a full application journey.

The server exposes tools via both **Streamable HTTP** (for ChatGPT and Claude web) and **stdio** (for Claude Desktop), with a [Cloudflare Named Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) providing the public HTTPS endpoint.

---

## Quick start

```bash
git clone https://github.com/meabs/mcp-app-demo.git
cd mcp-app-demo
npm run setup
npm start
```

`npm run setup` installs dependencies, builds the UI bundle, installs `cloudflared` (via Homebrew on macOS), and wires up Claude Desktop automatically. After that, `npm start` serves the MCP endpoint at `http://localhost:3001/mcp`.

---

## Demo scenarios

Say any of the following phrases to an AI assistant connected to this server:

| What you say | Tool called | What renders |
|---|---|---|
| "Show me Blackwell Bank credit cards" | `blackwell-browse-cards` | Full catalogue — card list, card detail, eligibility form, application stepper |
| "Tell me about the Blackwell Rewards Card" | `blackwell-card-detail` | Card detail fragment — features, APR, eligibility CTA |
| "Check if I'm eligible for the Cashback Card" | `blackwell-check-eligibility` | Eligibility widget — pre-qualification result, credit limit, stats |
| "Apply for the Blackwell Rewards Card" | `blackwell-apply` | Application stepper — 5-step form with confirmation screen |
| *(click Expand in any panel)* | — | Panel expands to fullscreen mode |
| *(fill in the application form and submit)* | `blackwell-submit-application` *(app-only)* | Confirmation screen + model is notified |

### MCP Apps features demonstrated

| Feature | Where it appears |
|---|---|
| Rich interactive UI (HTML/CSS/JS) | All scenarios |
| Multiple fragment modes from one resource | card-detail, eligibility, application |
| App-only tools (hidden from LLM) | Card selection, form submission |
| `requestDisplayMode` — fullscreen | Expand button on every panel |
| `updateModelContext` — push context to model | After eligibility result |
| `sendMessage` — model notification | After application submitted |
| Streamable HTTP transport | `npm start` / `npm run start:cloud` |
| stdio transport | `npm run start:stdio` |

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18 + | `node --version` |
| npm | 9 + | Bundled with Node |
| cloudflared | any | Only needed for `start:cloud`; `setup` installs it via Homebrew |
| Homebrew | any | macOS only — for automatic cloudflared install |

---

## Setup

Run `npm run setup` once. It does the following automatically:

1. `npm install` — installs all dependencies
2. `vite build` — builds the single-file HTML bundle (`dist/mcp-app.html`)
3. **cloudflared** — installs via Homebrew if not already present
4. **~/.cloudflared/config.yml** — creates the tunnel config file if missing
5. **Claude Desktop** — adds the `blackwell-bank` MCP server to `claude_desktop_config.json` if Claude Desktop is installed

```bash
npm run setup
```

If Homebrew is not available (Linux, Windows), install `cloudflared` manually from the [Cloudflare downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) before running `start:cloud`.

---

## Running the server

### Local HTTP — for testing

```bash
npm start
```

Builds and starts the HTTP server at `http://localhost:3001/mcp`. Use this with the [basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) test client, or any MCP client that supports Streamable HTTP.

### Cloud (Cloudflare Tunnel) — for ChatGPT and Claude web

```bash
npm run start:cloud
```

Builds, starts the HTTP server, and opens the Cloudflare Named Tunnel simultaneously. The public endpoint is:

```
https://garry-demo.meaburn.com/mcp
```

> **DNS note:** The first time you use the tunnel, add a CNAME record in your Cloudflare dashboard for `meaburn.com`:
> - **Name:** `garry-demo`
> - **Target:** `7518a5d5-2c06-4a62-85ef-8dece49b1c55.cfargotunnel.com`
> - **Proxy status:** Proxied (orange cloud)

### stdio — for Claude Desktop

```bash
npm run start:stdio
```

Starts the server with stdio transport. Claude Desktop manages this process automatically once configured (see below).

### Development (watch mode)

```bash
npm run dev
```

Runs `vite build --watch` and `node --watch` in parallel. The UI bundle and server both reload on file changes.

---

## Connecting to AI assistants

### ChatGPT

1. Open a GPT or project → **Tools** → **+ Add** → **MCP Server**
2. MCP URL: `https://garry-demo.meaburn.com/mcp`
3. Save and start a conversation

### Claude.ai

1. Settings → **Integrations** → **Add integration**
2. MCP URL: `https://garry-demo.meaburn.com/mcp`
3. Start a conversation

### Claude Desktop (stdio)

`npm run setup` writes the Claude Desktop configuration automatically. To verify or set it up manually, edit:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "blackwell-bank": {
      "command": "bash",
      "args": ["-lc", "cd /path/to/mcp-app-demo && npm run start:stdio"]
    }
  }
}
```

Replace `/path/to/mcp-app-demo` with the absolute path to this project. Restart Claude Desktop after editing.

---

## Testing the server

Run unit tests:

```bash
npm test
```

Verify the MCP endpoint responds:

```bash
# Health check — returns serverInfo
curl -s http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}},"id":1}' \
  | grep '^data:' | cut -c7- | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).result?.serverInfo))"

# List tools — should show 4 model-visible tools
curl -s http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}' \
  | grep '^data:' | cut -c7- | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>JSON.parse(d).result?.tools?.forEach(t=>console.log(t.name)))"
```

---

## Scripts reference

| Script | Description |
|---|---|
| `npm run setup` | One-shot: install deps, build, configure cloudflared and Claude Desktop |
| `npm run build` | Build the Vite single-file bundle to `dist/mcp-app.html` |
| `npm start` | Build + start HTTP server at `http://localhost:3001/mcp` |
| `npm run start:cloud` | Build + start HTTP server + Cloudflare tunnel |
| `npm run start:stdio` | Build + start stdio server (for Claude Desktop) |
| `npm run dev` | Watch mode — rebuild UI and restart server on file changes |
| `npm test` | Run unit tests |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AI Host (ChatGPT / Claude.ai / Claude Desktop)             │
│                                                             │
│   LLM ──calls──▶ blackwell-browse-cards                    │
│        ◀── structuredContent { mode: "full", ... } ──      │
│        ◀── resource: ui://blackwell/app.html ──             │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Rendered UI (dist/mcp-app.html)                     │   │
│  │                                                      │   │
│  │  Card list  │  Card detail     ← mode: "full"        │   │
│  │  ─────────────────────────────────────────────────   │   │
│  │  Eligibility panel  │  Application stepper           │   │
│  │                                                      │   │
│  │  app.callServerTool("blackwell-select-card")         │   │
│  │  app.callServerTool("blackwell-submit-application")  │   │
│  │  app.requestDisplayMode({ mode: "fullscreen" })      │   │
│  │  app.updateModelContext({ content: [...] })          │   │
│  │  app.sendMessage({ role: "user", content: [...] })   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
            │ Streamable HTTP (start / start:cloud)
            │ stdio (start:stdio)
            ▼
┌──────────────────────────────────────────────────────┐
│  MCP Server  (src/server.js + src/index.js)          │
│                                                      │
│  Model-visible tools:                                │
│    blackwell-browse-cards      → mode: full          │
│    blackwell-card-detail       → mode: card-detail   │
│    blackwell-check-eligibility → mode: eligibility   │
│    blackwell-apply             → mode: application   │
│                                                      │
│  App-only tools (visibility: ["app"]):               │
│    blackwell-select-card                             │
│    blackwell-submit-application                      │
│                                                      │
│  Resource: ui://blackwell/app.html                   │
│    → serves dist/mcp-app.html (Vite single-file)     │
└──────────────────────────────────────────────────────┘
            │ Cloudflare Named Tunnel (start:cloud only)
            ▼
  https://garry-demo.meaburn.com/mcp
```

### Key files

| File | Purpose |
|---|---|
| `src/index.js` | Transport setup — Streamable HTTP (Express) and stdio |
| `src/server.js` | MCP tool and resource registrations |
| `src/demo-data.js` | Card data, eligibility logic, journey steps |
| `src/mcp-app.js` | Client-side app — mode routing, render functions, App SDK calls |
| `src/mcp-app.html` | HTML shell with four view containers |
| `src/mcp-app.css` | Blackwell Bank design system |
| `dist/mcp-app.html` | Vite single-file bundle (generated — not committed) |
| `scripts/setup.sh` | One-shot setup script |
| `test/demo-data.test.js` | Unit tests for business logic |

### Mode-driven rendering

All four scenarios share a single HTML resource. The tool result's `structuredContent.mode` field controls which view renders:

| Mode | View shown | Triggered by |
|---|---|---|
| `full` | Card catalogue + eligibility + application stepper | `blackwell-browse-cards` |
| `card-detail` | Single card spotlight | `blackwell-card-detail` |
| `eligibility` | Eligibility result widget | `blackwell-check-eligibility` |
| `application` | Application form stepper | `blackwell-apply` |

When the user is already in `full` mode, in-panel interactions (eligibility form submit, card selection) update state and re-render in place — they don't switch the view. Only explicit LLM tool calls change the mode.

---

## Cloudflare tunnel credentials

Credentials for the named tunnel live in:

```
~/.cloudflared/7518a5d5-2c06-4a62-85ef-8dece49b1c55.json   ← tunnel auth
~/.cloudflared/config.yml                                    ← ingress rules
```

If credentials are missing or you want to set up a different tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create blackwell-demo
# note the new tunnel ID, then update:
#   - the tunnel ID in ~/.cloudflared/config.yml
#   - the tunnel ID in the start:cloud script in package.json
```
