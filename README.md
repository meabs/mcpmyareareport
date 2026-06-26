# MyAreaReport MCP App

A UK and USA area intelligence tool built with the [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps). Runs as a rich interactive UI panel inside ChatGPT and Claude.ai, delivering public data for supported UK postcodes/places and USA ZIPs/city-state inputs.

---

## What it does

Enter a UK postcode/place or USA ZIP/city-state input and get an area report covering:

| Tab | Data source |
|---|---|
| Overview | Crime count & trend, flood warnings, quick stats |
| Crime | UK street-level crime, or USA reported crime trends where configured |
| Flood | UK Environment Agency flood data, or USA NWS alerts and USGS stations |
| Property | UK sale prices, or USA Census housing indicators where configured |
| Roads | UK traffic flow, or USA nearby major-road context |
| Fuel | UK petrol station prices, or USA EIA fuel indicators and NREL alternative-fuel stations where configured |

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

Optional USA API keys:

```
CENSUS_API_KEY=...
FBI_API_KEY=...
DATA_GOV_API_KEY=...
NREL_API_KEY=...
EIA_API_KEY=...
```

USA v1 is intentionally caveated: national public sources do not provide UK-style street-level crime, recent individual property sales, national live petrol station prices, or consistent traffic-count coverage.

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
| `area-search` | Opens the dashboard and returns an overview for a UK or USA area |
| `area-crime` | Detailed crime categories, outcomes, trend and stop-and-search data |
| `area-flood` | Active flood warnings, alerts and river station readings |
| `area-property` | UK Land Registry sales or USA housing indicators |
| `area-roads` | UK road traffic summaries or USA road context |
| `area-fuel` | UK petrol/diesel prices or USA fuel and alternative-fuel context |

### App-only tools

These tools are hidden from the model and are called by the embedded UI:

| Tool | Description |
|---|---|
| `area-app-search` | Resolve a UK postcode/place or USA ZIP/city-state/address and return area metadata for the search flow |
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
    │  fetches: UK official APIs and USA public data APIs
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

That script drives `infra/docker-compose.yml`, replaces old `infra-*` app containers, and runs only:

- `myareareport-mcp`
- `myareareport-caddy`

The USA expansion branch includes an isolated staging compose file:

```bash
scripts/deploy-us-staging.sh
```

It runs `myareareport-us-mcp` on `127.0.0.1:3004` with a separate `.env.us-staging` and usage stats volume. A public staging URL requires DNS for `us-staging.myareareport.com` and the Caddy host block in `infra/Caddyfile.us-staging-snippet`.

---

## Key files

| File | Purpose |
|---|---|
| `src/server.js` | MCP tool/resource registrations, output schemas and UI metadata |
| `src/area-data.js` | API calls — Police, EA Flood, Land Registry, Roads, Fuel Finder |
| `src/us-area-data.js` | USA adapters — Census, NWS, USGS, FBI, EIA, NREL, Overpass |
| `src/mcp-app.js` | Client app — tool result routing, state, view switching |
| `src/feature-views.js` | Per-tab render logic and UI wiring |
| `src/mcp-app.html` | HTML shell |
| `src/mcp-app.css` | Styles |
| `chatgpt-app-submission.json` | Draft ChatGPT app submission metadata and test prompts |
| `REVIEW_RECOMMENDATIONS.md` | Reliability, API readiness and day-one feature review |
