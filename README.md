# MyAreaReport MCP App

A UK area intelligence tool built with the [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps). Runs as a rich interactive UI panel inside ChatGPT and Claude.ai, delivering real-time local data for any UK postcode.

---

## What it does

Enter a UK postcode and get a live area report covering:

| Tab | Data source |
|---|---|
| Overview | Crime count & trend, flood warnings, quick stats |
| Crime | Detailed breakdown by category with map (Police API) |
| Flood | Active warnings and alerts with severity map (Environment Agency) |
| Property | Average sale prices by property type (Land Registry) |
| Roads | Traffic flow and road conditions (Highways England) |
| Fuel | Nearby petrol station prices (GOV.UK Fuel Finder) |

---

## Quick start

```bash
git clone https://github.com/meabs/mcpmyareareport.git
cd mcpmyareareport
npm install
npm run build
npm start
```

The MCP endpoint is served at `http://localhost:3001/mcp`.

### Environment variables

Create a `.env` file (never commit to git):

```
FUEL_FINDER_CLIENT_ID=...
FUEL_FINDER_CLIENT_SECRET=...
PORT=3001
```

Fuel Finder credentials are obtained from the GOV.UK Fuel Finder API programme.

---

## Connecting to AI assistants

### ChatGPT

1. Open a GPT or project → **Tools** → **+ Add** → **MCP Server**
2. MCP URL: `https://mcp.myareareport.com/mcp`
3. Start a conversation — ask *"What's the crime rate near SW1A 2AA?"*

### Claude.ai

1. Settings → **Integrations** → **Add integration**
2. MCP URL: `https://mcp.myareareport.com/mcp`

---

## MCP tools

| Tool | Description |
|---|---|
| `area-app-search` | Geocode a postcode and return overview (crime + flood summary) |
| `area-app-crime` | Detailed crime breakdown for a postcode |
| `area-app-flood` | Active flood warnings and alerts near a postcode |
| `area-app-property` | House price data for the outcode |
| `area-app-roads` | Nearby traffic monitoring sites |
| `area-app-fuel` | Petrol station prices within 20 km |

---

## Development

```bash
npm run dev        # Vite dev server for the UI (hot reload)
npm run build      # Production bundle → dist/src/mcp-app.html
npm test           # Jest unit tests
```

---

## Architecture

```
AI assistant
    │  calls tool (e.g. area-app-search "SW1A 2AA")
    ▼
MCP server  (src/server.js)
    │  fetches: Police API, Environment Agency, Land Registry,
    │           Highways England, GOV.UK Fuel Finder
    ▼
structuredContent result  →  triggers UI render in-chat
```

### MCP Apps SDK features

| Feature | Where |
|---|---|
| Rich interactive HTML/CSS/JS UI | All views |
| Multiple tool entry points | Each tab (crime, flood, property, roads, fuel) |
| App-only tools (hidden from LLM) | Tab navigation, search form |
| `requestDisplayMode` — fullscreen | Expand button |
| `updateModelContext` — push context back to model | After each tool result |

---

## Deployment

The app is containerised. Build and run with Docker:

```bash
docker build -t myareareport .
docker run -p 3001:3001 --env-file .env myareareport
```

---

## Key files

| File | Purpose |
|---|---|
| `src/server.js` | MCP tool registrations and data fetching |
| `src/area-data.js` | API calls — Police, EA Flood, Land Registry, Roads, Fuel Finder |
| `src/mcp-app.js` | Client app — tool result routing, state, view switching |
| `src/feature-views.js` | Per-tab render logic and UI wiring |
| `src/mcp-app.html` | HTML shell |
| `src/mcp-app.css` | Styles |
