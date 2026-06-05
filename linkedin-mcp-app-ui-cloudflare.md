# Building a Real MCP App UI: MyAreaReport, ChatGPT, Claude, and a Cloudflare Tunnel

I have been building **MyAreaReport**, a UK area intelligence MCP App that takes a postcode or place name and returns a rich interactive dashboard inside ChatGPT and Claude.

The interesting part is not just the data. The useful part is the architecture:

- the assistant gets model-readable tool results
- the embedded app gets structured data
- the UI renders inside the host as a sandboxed MCP App
- the public endpoint is exposed from a VPS through Cloudflare Tunnel
- no local LLM is required

The LLM already exists in the host. The MCP server's job is to provide reliable tools, typed data, and a UI resource the host can render.

## What the App Does

MyAreaReport aggregates UK local-area data for a postcode, outcode, or place:

- crime data from Police UK
- flood data from the Environment Agency
- property prices from HM Land Registry
- roads and traffic data
- nearby fuel prices
- map rendering through Leaflet and OpenStreetMap tiles

A user can ask:

> Tell me about DL14 8HJ

The assistant calls the MCP server, receives structured area data, and renders the MyAreaReport UI panel.

## The Core MCP Shape

The public endpoint is:

```text
https://mcp.myareareport.com/mcp
```

Locally the server listens on:

```text
http://localhost:3001/mcp
```

The Node service uses:

- `@modelcontextprotocol/sdk`
- `@modelcontextprotocol/ext-apps`
- Express
- Vite
- Leaflet

At runtime, the server exposes an MCP Streamable HTTP endpoint. Express owns the HTTP layer, and each `/mcp` request is passed through the MCP transport.

The high-level flow is:

```text
User
  -> ChatGPT / Claude
  -> MCP tool call over /mcp
  -> Node MCP server
  -> UK public APIs
  -> structuredContent + text content
  -> embedded app UI resource
  -> interactive dashboard in the host
```

## Model Tools vs App Tools

One pattern that made the app much cleaner was separating model-visible tools from app-only tools.

Model-visible tools are things the assistant should be allowed to choose:

- `area-search`
- `area-crime`
- `area-flood`
- `area-property`
- `area-roads`
- `area-fuel`

App-only tools are hidden from the model and used by the embedded UI:

- `area-app-search`
- `area-app-crime`
- `area-app-flood`
- `area-app-property`
- `area-app-roads`
- `area-app-fuel`

That keeps the assistant's tool list simple while still letting the UI progressively load tabs, refresh data, and call narrower endpoints.

In practice, this means the model can say, "I need an area overview", while the UI can later say, "load the fuel tab for this same area".

## The Tool Result Contract

Each MCP handler returns two things:

```js
return {
  content: [
    {
      type: "text",
      text: "Area summary text for the assistant"
    }
  ],
  structuredContent: payload
};
```

The `content` field is for the assistant and transcript.

The `structuredContent` field is for the app UI.

Every major payload has a `kind` discriminator:

```text
area-overview
area-crime
area-flood
area-property
area-roads
area-fuel
```

The frontend routes on `kind`. It does not scrape assistant text, and it does not depend on prompt wording.

That is the main reliability rule: **natural language is for the user; structured payloads are for the UI**.

## How the MCP App UI Works

The UI is a normal Vite-built HTML/JS app, but it is registered as an MCP app resource.

The resource URI is:

```text
ui://myareareport/app.html
```

The production build outputs a single bundled HTML file:

```text
dist/src/mcp-app.html
```

The MCP server reads that file and returns it through resource metadata. When a tool result includes the UI resource URI, the host knows it can render the embedded app.

The UI then uses the MCP Apps bridge to communicate back to the server. In simple terms:

```text
Tool result arrives
  -> app reads structuredContent
  -> app updates local state
  -> app renders the selected tab
  -> user clicks another tab
  -> app calls an app-only MCP tool
  -> app receives another structured payload
  -> app updates the view
```

The app itself is deliberately small-state. It tracks:

- selected area
- active tab
- loaded domain payloads
- loading/error states
- host safe-area information

The view layer is deterministic. If it receives an `area-fuel` payload, it renders the fuel view. If it receives an `area-property` payload, it renders the property view.

## Host Metadata Matters

The hardest bugs were not the data APIs. They were host metadata details.

ChatGPT and Claude both support MCP Apps, but they care about slightly different UI domain metadata.

The app now separates:

```js
const PUBLIC_UI_DOMAIN = "https://mcp.myareareport.com";
const CLAUDE_UI_DOMAIN = "<hash>.claudemcpcontent.com";
```

The resource metadata exposes:

```js
{
  ui: {
    domain: CLAUDE_UI_DOMAIN,
    csp: {
      connectDomains: ["https://mcp.myareareport.com"],
      resourceDomains: ["https://mcp.myareareport.com"]
    }
  },
  "openai/widgetDomain": PUBLIC_UI_DOMAIN
}
```

That avoids a common Claude error:

```text
Invalid ui.domain format: expected "{hash}.claudemcpcontent.com"
```

For ChatGPT, the stable public widget domain remains:

```text
https://mcp.myareareport.com
```

For Claude, the `ui.domain` must be the expected `claudemcpcontent.com` sandbox domain.

## Maps Inside an MCP App

Leaflet works, but the tile loading needs care.

Instead of letting the embedded iframe load arbitrary map tile URLs directly, the app routes tiles through its own endpoint:

```text
/api/tiles/{z}/{x}/{y}.png
```

The server validates tile coordinates, forwards the request to OpenStreetMap, and the app CSP only needs to allow the MCP app origin.

That keeps the UI resource policy narrow and avoids host-specific iframe restrictions.

## Why No Local LLM Is Needed

This app does not run a local model.

That is intentional.

The assistant host is already the model runtime. MCP provides the bridge between the model and external capability.

The server should be good at:

- fetching data
- validating inputs
- normalising public APIs
- returning typed payloads
- serving the UI resource
- enforcing a narrow CSP

The host model should be good at:

- deciding which tool to call
- explaining the result
- comparing areas
- turning structured data into natural language

This keeps the deployment small and cheap. The Node process is stateless and does not need GPU, vector search, or a model server.

## Exposing the MCP Endpoint With Cloudflare Tunnel

For a public MCP App, the endpoint must be reachable over HTTPS.

The simplest deployment path is:

```text
Cloudflare
  -> private tunnel
  -> cloudflared on the VPS
  -> localhost:3001
  -> Node MCP app
```

That means the VPS does not need to expose inbound HTTP/HTTPS ports directly. `cloudflared` creates an outbound connection to Cloudflare, and Cloudflare routes public traffic through that tunnel.

The project has a tunnel-oriented start script:

```json
{
  "scripts": {
    "start:cloud": "npm run build && (node --env-file-if-exists=.env src/index.js & cloudflared tunnel run <tunnel-id>)"
  }
}
```

On the VPS, the app listens locally:

```text
localhost:3001
```

Cloudflare Tunnel ingress maps:

```text
https://mcp.myareareport.com -> http://localhost:3001
```

A typical `cloudflared` ingress config looks like:

```yaml
tunnel: myareareport
credentials-file: /root/.cloudflared/myareareport.json

ingress:
  - hostname: mcp.myareareport.com
    service: http://localhost:3001
  - service: http_status:404
```

For production, I would normally run the app and tunnel under systemd rather than in an interactive shell:

```ini
[Unit]
Description=MyAreaReport MCP App
After=network.target

[Service]
WorkingDirectory=/opt/myareareport
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

And a separate service for the tunnel:

```ini
[Unit]
Description=Cloudflare Tunnel for MyAreaReport
After=network.target

[Service]
ExecStart=/usr/local/bin/cloudflared tunnel run myareareport
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

The important deployment checks are:

```bash
curl https://mcp.myareareport.com/health
curl https://mcp.myareareport.com/ready
curl https://mcp.myareareport.com/.well-known/ai-plugin.json
```

And for MCP itself, test that the host can connect to:

```text
https://mcp.myareareport.com/mcp
```

## Direct VPS Proxy vs Cloudflare Tunnel

The repo also supports a Docker/Caddy deployment:

```text
Cloudflare DNS
  -> VPS port 443
  -> Caddy
  -> Node MCP app on port 3001
```

That works, but Cloudflare Tunnel is often simpler for an early MCP App release:

- no public inbound ports required
- no manual TLS certificate management
- Cloudflare handles the public HTTPS edge
- the VPS only needs outbound connectivity
- easy to move the service to another host

The trade-off is that tunnel lifecycle and monitoring become part of production operations. If `cloudflared` stops, the public MCP endpoint is down even if the Node app is healthy.

## What I Learned

The biggest implementation lesson is that MCP Apps are not just "tools plus an iframe".

They are a contract between three things:

1. the assistant model
2. the MCP server
3. the embedded app UI

The stable approach is:

- keep tools typed
- keep result payloads structured
- give the UI discriminated `kind` values
- keep model-visible tools separate from app-only tools
- keep CSP and UI domains explicit
- deploy the endpoint exactly where the metadata says it lives

When those pieces line up, the experience feels native: the user talks to ChatGPT or Claude, the model calls tools, and the app appears as a focused interactive interface instead of a pasted wall of JSON.

That is the part I find most promising about MCP Apps: they let a conversational assistant become the front door to real software, while the software still keeps proper APIs, schemas, deployment boundaries, and UI state.

