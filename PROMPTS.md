# MyAreaReport — Demo Runbook

UK Area Intelligence MCP App — real crime & flood data from UK government APIs.

**Server URL**
- Local: `http://localhost:3001/mcp`
- Production: `https://mcp.myareareport.com/mcp`

---

## Setup

```bash
npm install
npm run build
npm start          # or npm run start:cloud for public tunnel
```

Connect to Claude Desktop / Claude.ai / ChatGPT via the MCP server URL above.

Press **`Shift + D`** inside the panel to enable presenter mode (toolbar + model context inspector).

---

## Demo prompts

### Area overview

- *"Show me an area report for Westminster — SW1A 2AA"*
- *"What's going on in Leeds? LS1 1BA"*
- *"Area intelligence for York YO1 9RD"*
- *"Give me a full report for Bristol BS1 4ST"*
- *"What's it like in Chester?"* ← accepts place names too

### Crime deep dive

- *"What are the crime statistics for SW1A 2AA?"*
- *"Show me the detailed crime breakdown for Westminster"*
- *"What's the stop and search data for Leeds LS1 1BA?"*

### Flood risk

- *"What's the flood risk near York?"*
- *"Are there any flood warnings near BS1 4ST?"*
- *"Show me river monitoring data for Leeds"*

### House prices

- *"What are house prices like in Leeds?"*
- *"Show me property prices near Westminster"*
- *"What does a terraced house cost in York YO1?"*

### Road traffic

- *"What's the traffic like on roads near Leeds?"*
- *"Show me motorway traffic data near Bristol BS1 4ST"*
- *"How busy is the M62 near Leeds?"*

### Fuel prices

- *"Find the cheapest fuel near BS1 4ST"*
- *"Where is the cheapest diesel near SW1A 2AA?"*
- *"Show me nearby petrol prices for Leeds LS1 1BA"*

### Follow-up prompts (after panel renders)

- *"Which crime category is highest?"*
- *"Is that above or below average for the UK?"*
- *"Are there any active flood warnings?"*
- *"How does this area compare to a national average?"*
- *"What's the average house price here?"*
- *"How busy are the nearby motorways?"*

---

## What data is shown

| Panel | Data | Source |
|-------|------|--------|
| Crime categories | Street-level crimes by type, monthly | Police UK API |
| Crime trend | 3-month comparison chart | Police UK API |
| Stop & search | Recorded instances + reasons | Police UK API |
| Flood warnings | Active warnings & alerts by county | Environment Agency |
| Flood stations | Nearest river monitoring stations + readings | Environment Agency |
| House prices | Recent sales, avg/median by property type | Land Registry PPD |
| Road traffic | Nearby motorway/A-road sensor avg daily flow, HGV % | National Highways WebTRIS |
| Fuel prices | Nearby petrol and diesel prices within 20 km | GOV.UK Fuel Finder |
| Map | OSM base tiles, crime density markers, station pins | OpenStreetMap / EA |

---

## Demo mode toolbar

| Button | Action |
|--------|--------|
| **Westminster** | Load SW1A 2AA (high crime, London) |
| **Leeds** | Load LS1 1BA (city centre, Yorkshire) |
| **Crime tab** | Open crime detail for current area |
| **Flood tab** | Open flood detail for current area |
| **Reset** | Return to search |

---

## MCP Tools

| Tool | Visible to | Description |
|------|-----------|-------------|
| `area-search` | LLM | Full area dashboard (crime + flood + map) |
| `area-crime` | LLM | Detailed 3-month crime analysis |
| `area-flood` | LLM | Flood warnings + river monitoring |
| `area-property` | LLM | House prices from Land Registry |
| `area-roads` | LLM | Road traffic from National Highways WebTRIS |
| `area-fuel` | LLM | Nearby fuel prices from GOV.UK Fuel Finder |
| `area-app-search` | App only | Frontend search form (accepts postcode or place name) |
| `area-app-crime` | App only | Crime tab navigation |
| `area-app-flood` | App only | Flood tab navigation |
| `area-app-property` | App only | Property tab navigation |
| `area-app-roads` | App only | Roads tab navigation |
| `area-app-fuel` | App only | Fuel tab navigation |

---

## Data notes

- **Crime data** is published monthly by police forces — typically 2 months in arrears.
- **Flood data** is real-time from the Environment Agency monitoring API.
- **House price data** is from the Land Registry Price Paid dataset — typically 4-8 weeks in arrears. Queried via SPARQL by outcode (postcode district).
- **Traffic data** is from National Highways WebTRIS — monthly averages for motorway and A-road sensors. Some sites may not have data for the most recent month; the app falls back to 2 months prior automatically.
- **Fuel price data** is from GOV.UK Fuel Finder. Local and production servers need `FUEL_FINDER_CLIENT_ID` and `FUEL_FINDER_CLIENT_SECRET`.
- Crime locations are **anonymised** (snapped to nearest street node) per Police UK licence.
- All data is licensed under the **Open Government Licence v3.0**.
- **Place name search**: entering a place name (e.g. "Chester") resolves to the nearest representative postcode. Data accuracy is best with a full postcode.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Postcode not found | Use full postcode with space, e.g. `SW1A 2AA` not `SW1A2AA` |
| Crime total is 0 | Police data lags ~2 months — app auto-selects latest available month |
| Flood stations not shown | Some areas don't have EA monitoring stations within 12km |
| Map tiles not loading | Check CSP — add `tile.openstreetmap.org` to `resourceDomains` |
| Fuel prices unavailable | Confirm Fuel Finder credentials are present and valid; local scripts load `.env` automatically |
| Model context not updating | Host may not support `updateModelContext` — try Claude Desktop |
