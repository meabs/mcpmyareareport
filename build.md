# MyAreaReport Build, Test and Submission Guide

This guide covers the current MyAreaReport MCP App. It replaces the old Blackwell/Card Hub proof-of-concept notes.

## Local Setup

```bash
npm install
cp .env.example .env
```

Set these values in `.env`:

```bash
FUEL_FINDER_CLIENT_ID=...
FUEL_FINDER_CLIENT_SECRET=...
PORT=3001
MCP_APP_UI_DOMAIN=https://mcp.myareareport.com
```

`npm run dev`, `npm start`, and `npm run start:stdio` use `node --env-file-if-exists=.env`, so local Fuel Finder credentials are loaded automatically when `.env` exists.

## Build and Run

```bash
npm run build
npm start
```

Local endpoints:

| Endpoint | Purpose |
|---|---|
| `http://localhost:3001/mcp` | MCP Streamable HTTP endpoint |
| `http://localhost:3001/health` | Process health |
| `http://localhost:3001/ready` | Build artifact and Fuel Finder configuration readiness |
| `http://localhost:3001/privacy` | Privacy policy |
| `http://localhost:3001/logo.png` | App logo |

## Test

```bash
npm test
```

The test suite includes:

- existing demo-data tests
- Fuel Finder regression tests for JSON OAuth, wrapped batch responses, canonical E10/B7 fuel keys, auth failures and empty upstream responses
- Apps SDK metadata tests for output schemas, widget domain and production CSP

## Fuel Finder Verification

Do not commit credentials. Use `.env` locally or inject environment variables from your host/process manager.

Expected behavior for a successful live call:

- OAuth request posts JSON to `/api/v1/oauth/generate_access_token`
- PFS location batches are read from `/api/v1/pfs?batch-number=1`
- price batches are read from `/api/v1/pfs/fuel-prices?batch-number=1`
- wrapped `{ data: [...] }` and raw array responses are both accepted
- fuel types are normalized to `E10`, `E5`, `B7_STANDARD`, `B7_PREMIUM`, `B10`, and `HVO`

## Production Deployment

```bash
docker build -t myareareport .
docker run -p 3001:3001 --env-file .env myareareport
```

Production requirements:

- public HTTPS MCP endpoint, currently expected at `https://mcp.myareareport.com/mcp`
- stable UI widget origin via `MCP_APP_UI_DOMAIN`
- valid Fuel Finder credentials
- privacy policy reachable at `https://mcp.myareareport.com/privacy`
- logo reachable at `https://mcp.myareareport.com/logo.png`
- monitoring for `/health`, `/ready`, upstream API failures and 429 rates

## ChatGPT App Submission Checklist

- Confirm `chatgpt-app-submission.json` matches the deployed tool names and endpoint.
- Verify all 12 registered tools expose `outputSchema`.
- Verify the resource metadata contains `_meta.ui.domain` and the `openai/widgetDomain` compatibility key.
- Keep production CSP narrow: the widget should connect to the MCP app origin and load OSM tile resources only.
- Run direct, indirect and negative prompt tests in Developer Mode.
- Capture screenshots after a clean production build.
- Confirm the privacy policy matches actual logging behavior. Tool arguments are not logged by the MCP route.
- Rotate any temporary Fuel Finder credentials used during development before final submission.

## Model-Visible Tools

| Tool | Purpose |
|---|---|
| `area-search` | Overview dashboard and crime/flood summary |
| `area-crime` | Crime and policing detail |
| `area-flood` | Flood warnings, alerts and river readings |
| `area-property` | House price summaries |
| `area-roads` | Road traffic summaries |
| `area-fuel` | Nearby fuel prices |

## App-Only Tools

| Tool | Purpose |
|---|---|
| `area-app-search` | Search form resolution |
| `area-app-crime` | Crime tab loading |
| `area-app-flood` | Flood tab loading |
| `area-app-property` | Property tab loading |
| `area-app-roads` | Roads tab loading |
| `area-app-fuel` | Fuel tab loading |

