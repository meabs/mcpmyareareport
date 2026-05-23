# MyAreaReport MCP App

A UK area intelligence tool built with the [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps). Runs as a rich interactive UI panel inside ChatGPT and Claude.ai, delivering the latest available official data for UK postcodes and places.

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
npm start
```

The MCP endpoint is served at `http://localhost:3001/mcp`.

### Environment variables

Create a `.env` file (never commit to git):

```
FUEL_FINDER_CLIENT_ID=...
FUEL_FINDER_CLIENT_SECRET=...
PORT=3001
MCP_APP_UI_DOMAIN=https://mcp.myareareport.com
```

Fuel Finder credentials are obtained from the GOV.UK Fuel Finder API programme.
Local `npm run dev`, `npm start`, and `npm run start:stdio` load `.env` automatically when it exists.

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

### Model-visible tools

These tools can be selected by the assistant in normal chat:

| Tool | Description |
|---|---|
| `area-search` | Opens the dashboard and returns a crime/flood overview for a UK postcode |
| `area-crime` | Detailed crime categories, outcomes, trend and stop-and-search data |
| `area-flood` | Active flood warnings, alerts and river station readings |
| `area-property` | Recent Land Registry sales and price summaries for a postcode area |
| `area-roads` | National Highways and DfT traffic monitoring summaries |
| `area-fuel` | Nearby petrol and diesel prices from GOV.UK Fuel Finder |

### App-only tools

These tools are hidden from the model and are called by the embedded UI:

| Tool | Description |
|---|---|
| `area-app-search` | Resolve a postcode, outcode or place name entered in the search form |
| `area-app-crime` | Load the crime tab for the current area |
| `area-app-flood` | Load the flood tab for the current area |
| `area-app-property` | Load the property tab for the current area |
| `area-app-roads` | Load the roads tab for the current area |
| `area-app-fuel` | Load the fuel tab for the current area |

---

## Development

```bash
npm run dev        # Vite dev server for the UI (hot reload)
npm run build      # Production bundle → dist/src/mcp-app.html
npm test           # Node test suite
```

---

## Architecture

```
AI assistant
    │  calls tool (e.g. area-search "SW1A 2AA")
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

For a clean VPS deploy with only the required production containers, use:

```bash
chmod +x scripts/deploy-vps.sh
scripts/deploy-vps.sh
```

That script drives [infra/docker-compose.yml](/Users/garry/code/street/mcp-app-demo/infra/docker-compose.yml:1), replaces old `infra-*` app containers, and runs only:

- `myareareport-mcp`
- `myareareport-caddy`

---

## Key files

| File | Purpose |
|---|---|
| `src/server.js` | MCP tool/resource registrations, output schemas and UI metadata |
| `src/area-data.js` | API calls — Police, EA Flood, Land Registry, Roads, Fuel Finder |
| `src/mcp-app.js` | Client app — tool result routing, state, view switching |
| `src/feature-views.js` | Per-tab render logic and UI wiring |
| `src/mcp-app.html` | HTML shell |
| `src/mcp-app.css` | Styles |
| `chatgpt-app-submission.json` | Draft ChatGPT app submission metadata and test prompts |
| `REVIEW_RECOMMENDATIONS.md` | Reliability, API readiness and day-one feature review |
