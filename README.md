# mcp-app-demo

Verdant Bank embedded sales demo built as an MCP App for ChatGPT and Claude.

## What it includes

- Embedded sales as the primary production use case
- Embedded acquisition architecture and capability-domain mockups
- Card discovery flow with Lloyds-inspired green styling under a different brand
- Eligibility-check orchestration demo with simulated decisioning
- Embedded application journey mockup with onboarding and fulfilment stages
- MCP server support for both stdio and streamable HTTP transports

## Quick start

```bash
npm install
npm run build
```

### Run as an MCP server over stdio

```bash
npm run start:stdio
```

Use this mode for local MCP clients that launch a server process directly from your machine.

### Run as an MCP server over HTTP

```bash
npm start
```

The HTTP endpoint is:

```text
http://localhost:3001/mcp
```

## Present it to the internet

If you want ChatGPT or Claude to reach the HTTP transport from outside your machine, expose `http://localhost:3001/mcp` through a public HTTPS URL.

### Option 1: run on a public host

Deploy the app to a VM, container host or platform service that can run Node.js, then:

```bash
npm install
npm run build
npm start
```

Expose port `3001` through your reverse proxy and publish a public HTTPS endpoint such as:

```text
https://your-domain.example/mcp
```

### Option 2: use a tunnel during demos

For a quick live demo from your laptop, start the server locally:

```bash
npm start
```

Then tunnel port `3001` with your preferred tool, for example:

```bash
ngrok http 3001
```

or:

```bash
cloudflared tunnel --url http://localhost:3001
```

Use the public HTTPS URL from the tunnel and append `/mcp` if needed.

### Internet presentation checklist

- Keep the server running with `npm start`
- Confirm the public URL forwards traffic to local port `3001`
- Verify the final public MCP endpoint resolves to `/mcp`
- Share the HTTPS MCP URL with the client or host configuration
- Rebuild with `npm run build` after any UI change before re-presenting the demo

## MCP tools

- `embedded-sales-demo` — launches the full UI demo
- `recommend-embedded-card` — refreshes card discovery recommendations
- `run-eligibility-check` — simulates eligibility orchestration
- `prepare-application-journey` — prepares onboarding and fulfilment steps

## Local client wiring

For local stdio-based testing, point your MCP client at this repository and run:

```json
{
  "mcpServers": {
    "verdant-sales-demo": {
      "command": "bash",
      "args": [
        "-lc",
        "cd /path/to/mcp-app-demo && npm run start:stdio"
      ]
    }
  }
}
```

That pattern works for clients that support local MCP servers, including Claude and ChatGPT environments that allow stdio-backed MCP connections.
