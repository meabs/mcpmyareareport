import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import { getAreaReport } from "./area-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple in-memory rate limiter for /mcp: 60 req/min per IP
const _rateCounts = new Map();
setInterval(() => _rateCounts.clear(), 60000);
function checkRateLimit(ip) {
  const count = (_rateCounts.get(ip) || 0) + 1;
  _rateCounts.set(ip, count);
  return count <= 60;
}

export async function startStreamableHttpServer(createMcpServer) {
  const port = Number(process.env.PORT ?? 3001);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "MyAreaReport MCP" }));
  app.get("/ready", async (_req, res) => {
    try {
      await fs.access(path.resolve(__dirname, "..", "dist"));
      res.json({
        status: "ready",
        service: "MyAreaReport MCP",
        fuelConfigured: Boolean(process.env.FUEL_FINDER_CLIENT_ID && process.env.FUEL_FINDER_CLIENT_SECRET),
      });
    } catch {
      res.status(503).json({ status: "not_ready", service: "MyAreaReport MCP", reason: "dist_missing" });
    }
  });

  // ── Logo ──────────────────────────────────────────────────────────────────
  app.get("/logo.png", async (_req, res) => {
    try {
      const logo = await fs.readFile(path.resolve(__dirname, "..", "logo.png"));
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(logo);
    } catch { res.status(404).end(); }
  });

  // ── ChatGPT plugin manifest ───────────────────────────────────────────────
  app.get("/.well-known/ai-plugin.json", (_req, res) => {
    res.json({
      schema_version: "v1",
      name_for_human: "MyAreaReport",
      name_for_model: "myareareport",
      description_for_human: "UK area intelligence — crime statistics, flood warnings, house prices, fuel prices and road traffic from official government data.",
      description_for_model: "Provides UK area intelligence for any postcode or place name: street-level crime statistics from Police UK, flood warnings and river levels from the Environment Agency, house prices from HM Land Registry, live fuel prices from GOV.UK Fuel Finder, and road traffic from National Highways. All data is real-time from official open government APIs. No user data is stored.",
      auth: { type: "none" },
      api: { type: "mcp", url: "https://mcp.myareareport.com/mcp" },
      logo_url: "https://mcp.myareareport.com/logo.png",
      contact_email: "garry@myareareport.com",
      legal_info_url: "https://mcp.myareareport.com/privacy",
    });
  });

  // ── Privacy policy ────────────────────────────────────────────────────────
  app.get("/privacy", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy Policy — MyAreaReport</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.6; }
    h1 { color: #0c2340; } h2 { color: #1d4ed8; margin-top: 2em; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p><strong>Service:</strong> MyAreaReport &mdash; <a href="https://mcp.myareareport.com">mcp.myareareport.com</a><br>
  <strong>Last updated:</strong> May 2026</p>

  <h2>What we do</h2>
  <p>MyAreaReport is a read-only information service. It retrieves publicly available UK government data (crime statistics, flood warnings, house prices, fuel prices, road traffic) for a postcode or place name you provide, and returns that data to the AI assistant you are using.</p>

  <h2>Data we process</h2>
  <ul>
    <li><strong>Postcode or place name</strong> you enter — used solely to query government APIs. It is not stored, logged, or shared beyond the API calls required to serve your request.</li>
    <li><strong>Server logs</strong> — standard web server access logs (IP address, timestamp, HTTP method, path) are retained for up to 30 days for security and debugging purposes only.</li>
  </ul>

  <h2>Third-party APIs called</h2>
  <p>Your postcode is passed to these official UK government APIs to retrieve area data:</p>
  <ul>
    <li><a href="https://data.police.uk">Police UK API</a> — crime data</li>
    <li><a href="https://environment.data.gov.uk">Environment Agency</a> — flood warnings and river levels</li>
    <li><a href="https://postcodes.io">Postcodes.io</a> — geocoding</li>
    <li><a href="https://landregistry.data.gov.uk">HM Land Registry</a> — house prices</li>
    <li><a href="https://www.developer.fuel-finder.service.gov.uk">GOV.UK Fuel Finder</a> — fuel prices</li>
    <li><a href="https://webtris.highwaysengland.co.uk">National Highways WebTRIS</a> — road traffic</li>
    <li><a href="https://www.openstreetmap.org">OpenStreetMap</a> — map tiles</li>
  </ul>
  <p>All data returned is published under the Open Government Licence v3.0 and is available publicly. No personal data is sent to these APIs.</p>

  <h2>Cookies and tracking</h2>
  <p>This service sets no cookies and uses no analytics or tracking technologies.</p>

  <h2>Data retention</h2>
  <p>We do not store, retain, or process any user-submitted data beyond the immediate API request. Server access logs are automatically deleted after 30 days.</p>

  <h2>Your rights</h2>
  <p>As we hold no personal data about you, there is nothing to access, correct, or delete. For questions, contact us at <a href="mailto:garry@myareareport.com">garry@myareareport.com</a>.</p>

  <h2>Changes</h2>
  <p>We may update this policy. The current version is always available at this URL.</p>
</body>
</html>`);
  });

  // ── Fallback area endpoint for non-MCP-App hosts ──────────────────────────
  app.get("/api/area", async (req, res) => {
    const postcode = req.query.postcode || "SW1A 1AA";
    try {
      const payload = await getAreaReport(postcode);
      res.json(payload);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // OSM tile proxy — served from localhost so it works within CSP connect-src
  app.get("/api/tiles/:z/:x/:y", async (req, res) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const maxTile = 2 ** z;
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) ||
        z < 0 || z > 19 || x < 0 || y < 0 || x >= maxTile || y >= maxTile) {
      res.status(400).json({ error: "invalid_tile" });
      return;
    }
    try {
      const upstream = await fetch(
        `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        { headers: { "User-Agent": "MyAreaReport-Demo/1.0 (opensource-demo)" } }
      );
      if (!upstream.ok) { res.status(upstream.status).end(); return; }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

  app.all("/mcp", async (req, res) => {
    const ip = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;
    if (!checkRateLimit(ip)) {
      res.status(429).json({ jsonrpc: "2.0", error: { code: -32000, message: "Rate limit exceeded" }, id: null });
      return;
    }
    const method = req.body?.method;
    const toolName = req.body?.params?.name;
    if (method === "tools/call") {
      console.log(`[tool] ${toolName}`);
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, (error) => {
    if (error) {
      console.error("Failed to start HTTP transport:", error);
      process.exit(1);
    }
    console.log(`MCP server listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(createMcpServer) {
  await createMcpServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
    return;
  }

  await startStreamableHttpServer(createServer);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
