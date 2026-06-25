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
      description_for_model: "Provides UK area intelligence for any postcode or place name: street-level crime statistics from Police UK, flood warnings and river levels from the Environment Agency, house prices from HM Land Registry, live fuel prices from GOV.UK Fuel Finder, and road traffic from National Highways. User-submitted postcodes and place names are used only to retrieve requested public data and are not stored by MyAreaReport after the request completes.",
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
    :root {
      color-scheme: light;
      --navy: #0c2340;
      --blue: #1d4ed8;
      --bg: #eef3f8;
      --card: #ffffff;
      --text: #111827;
      --muted: #64748b;
      --border: #dbe3ee;
      --soft: #f8fafc;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: linear-gradient(180deg, #f8fafc 0%, var(--bg) 100%);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.65;
    }

    .policy-shell {
      width: min(920px, calc(100% - 32px));
      margin: 0 auto;
      padding: 40px 0 56px;
    }

    .policy-hero {
      padding: 30px 32px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--card);
      box-shadow: 0 16px 40px rgba(12, 35, 64, 0.08);
      margin-bottom: 18px;
    }

    .brand-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
      color: var(--muted);
      font-size: 0.9rem;
      font-weight: 700;
    }

    .brand-mark {
      display: inline-flex;
      width: 34px;
      height: 34px;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: var(--navy);
      color: #fff;
      font-weight: 900;
    }

    h1 {
      margin: 0 0 10px;
      color: var(--navy);
      font-size: clamp(2rem, 5vw, 3.1rem);
      line-height: 1.05;
      letter-spacing: 0;
    }

    .lede {
      max-width: 720px;
      margin: 0;
      color: #475569;
      font-size: 1.02rem;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 22px;
    }

    .meta-card {
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--soft);
      color: var(--muted);
      font-size: 0.88rem;
    }

    .meta-card strong {
      display: block;
      color: var(--text);
      font-size: 0.95rem;
    }

    .policy-content {
      padding: 6px 32px 28px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--card);
      box-shadow: 0 10px 28px rgba(12, 35, 64, 0.05);
    }

    h2 {
      margin: 30px 0 10px;
      padding-top: 22px;
      border-top: 1px solid var(--border);
      color: var(--navy);
      font-size: 1.15rem;
      line-height: 1.25;
    }

    h2:first-child {
      border-top: 0;
      padding-top: 0;
    }

    p { margin: 0 0 12px; }

    ul {
      margin: 10px 0 0;
      padding-left: 1.25rem;
    }

    li { margin: 0 0 8px; }

    strong { color: var(--text); }

    a {
      color: var(--blue);
      text-decoration: none;
      font-weight: 650;
    }

    a:hover { text-decoration: underline; }

    .note {
      padding: 13px 15px;
      border-left: 4px solid var(--blue);
      border-radius: 8px;
      background: #eff6ff;
      color: #1e3a8a;
    }

    @media (max-width: 640px) {
      .policy-shell {
        width: min(100% - 20px, 920px);
        padding: 16px 0 32px;
      }

      .policy-hero,
      .policy-content {
        padding: 20px 18px;
        border-radius: 10px;
      }

      .meta-grid { grid-template-columns: 1fr; }
      h2 { margin-top: 24px; }
    }
  </style>
</head>
<body>
  <main class="policy-shell">
    <header class="policy-hero">
      <div class="brand-row"><span class="brand-mark">M</span><span>MyAreaReport</span></div>
      <h1>Privacy Policy</h1>
      <p class="lede">How MyAreaReport handles postcode lookups, public area data, AI-assistant context, retention, and user controls.</p>
      <div class="meta-grid">
        <div class="meta-card"><strong>Service</strong><a href="https://mcp.myareareport.com">mcp.myareareport.com</a></div>
        <div class="meta-card"><strong>Last updated and effective</strong>25 June 2026</div>
      </div>
    </header>
    <section class="policy-content">

  <h2>Who we are and what we do</h2>
  <p>MyAreaReport is a read-only UK area information service operated by MyAreaReport. It runs as an MCP app for AI assistants such as ChatGPT and retrieves public area data for a UK postcode, outcode, or place name you provide. Contact: <a href="mailto:garry@myareareport.com">garry@myareareport.com</a>.</p>
  <p class="note">MyAreaReport does not provide user accounts, payments, newsletters, targeted advertising, or profiling.</p>

  <h2>Sources of information</h2>
  <p>MyAreaReport receives information directly from the user or AI assistant request, from public and official data sources, and from transient technical request data needed to operate the service.</p>

  <h2>Data collected or processed</h2>
  <p>Depending on the tool or app screen used, MyAreaReport may process the following data:</p>
  <ul>
    <li><strong>User inputs:</strong> UK postcode, outcode, or place name supplied to tools such as area-search, area-crime, area-flood, area-property, area-roads, area-fuel, and the app search form.</li>
    <li><strong>Resolved area data:</strong> postcode, latitude/longitude, district, county, region, and approximate-place metadata returned by geocoding.</li>
    <li><strong>Public report outputs:</strong> crime categories, incident counts, outcomes, trends, stop-and-search summaries, flood warnings and alerts, monitoring station readings, Land Registry property summaries and recent sales, traffic counts, road sensor summaries, fuel station names, fuel prices, distances, and map tile coordinates.</li>
    <li><strong>AI-assistant context:</strong> after a report loads, the app may send a concise summary of the selected area and report results back to the AI assistant so it can answer follow-up questions about the displayed report.</li>
    <li><strong>App interaction state:</strong> the app processes tab selections and app-only tool calls needed to load the selected view. In demo mode only, a local browser flag may be stored to remember demo mode on that device.</li>
    <li><strong>Technical and security data:</strong> IP addresses are held briefly in memory for rate limiting. The MyAreaReport application does not intentionally persist access logs, user lookup history, or generated reports.</li>
  </ul>

  <h2>How we use information</h2>
  <ul>
    <li>To resolve a postcode, outcode, or place name to an area.</li>
    <li>To retrieve and display the requested public crime, flood, property, roads, fuel, and map data.</li>
    <li>To return tool outputs and app summaries to the AI assistant you are using.</li>
    <li>To operate, secure, and rate-limit the service.</li>
    <li>To comply with legal, platform, and security obligations.</li>
  </ul>

  <h2>How we disclose information</h2>
  <p>MyAreaReport may send the postcode, outcode, place name, resolved coordinates, or derived search area to the following services when needed to answer your request:</p>
  <ul>
    <li><a href="https://data.police.uk">Police UK API</a> — crime data</li>
    <li><a href="https://environment.data.gov.uk">Environment Agency</a> — flood warnings and river levels</li>
    <li><a href="https://postcodes.io">Postcodes.io</a> — geocoding</li>
    <li><a href="https://landregistry.data.gov.uk">HM Land Registry</a> — house prices</li>
    <li><a href="https://www.developer.fuel-finder.service.gov.uk">GOV.UK Fuel Finder</a> — fuel prices</li>
    <li><a href="https://webtris.highwaysengland.co.uk">National Highways WebTRIS</a> — road traffic</li>
    <li>Department for Transport road traffic datasets — local A-road count-point data</li>
    <li><a href="https://www.openstreetmap.org">OpenStreetMap</a> — map tiles, fetched server-side by MyAreaReport</li>
    <li>The AI assistant platform you use, such as OpenAI/ChatGPT — tool inputs, tool outputs, app UI data, and follow-up context needed to display and discuss the report</li>
    <li>Hosting and infrastructure providers used to run MyAreaReport — transient infrastructure and security data needed to operate the service</li>
  </ul>
  <p>MyAreaReport does not sell personal data and does not use your postcode or place lookup for advertising or profiling.</p>

  <h2>Cookies, analytics, and advertising</h2>
  <p>MyAreaReport does not set advertising cookies, does not use third-party analytics, and does not use targeted advertising. Demo mode may use local storage on your device to remember that demo mode is enabled; this is not used for advertising or profiling.</p>

  <h2>Data retention</h2>
  <ul>
    <li><strong>Postcodes, outcodes, place names, and generated reports:</strong> not stored by MyAreaReport after the request completes.</li>
    <li><strong>In-memory rate limit data:</strong> IP-based counters are cleared approximately every 60 seconds.</li>
    <li><strong>Application access and error logs:</strong> the MyAreaReport application does not intentionally persist access logs, error logs, user lookup history, or generated reports.</li>
    <li><strong>Public data caches:</strong> public fuel station, road count, and similar source datasets may be cached temporarily to improve performance. These caches do not contain user-submitted lookup history.</li>
    <li><strong>AI assistant history:</strong> conversation and tool output retention is controlled by the AI assistant platform and your settings with that platform.</li>
  </ul>

  <h2>How we protect information</h2>
  <p>MyAreaReport uses reasonable technical and organisational measures to operate the service securely, including server-side API calls, rate limiting, and transport security. No internet service can be guaranteed to be fully secure.</p>

  <h2>Third-party services and websites</h2>
  <p>The app links to and retrieves data from public third-party services. Those services and the AI assistant platform you use have their own privacy policies and are responsible for their own processing. MyAreaReport does not control their privacy practices.</p>

  <h2>Your choices and rights</h2>
  <ul>
    <li>You can choose not to provide a postcode, outcode, or place name.</li>
    <li>You can close or remove the app from your AI assistant session.</li>
    <li>You can clear the conversation or tool history using the controls provided by your AI assistant platform.</li>
    <li>If demo mode was enabled on your device, you can clear the browser/app local storage for this site.</li>
    <li>Depending on applicable law, you may have rights to access, delete, correct, object to, or restrict processing of personal information held by MyAreaReport.</li>
    <li>You can contact <a href="mailto:garry@myareareport.com">garry@myareareport.com</a> to ask about privacy rights or any privacy concern.</li>
  </ul>
  <p>If you are in the UK or EEA and are not satisfied with our response, you may have the right to complain to your local data protection authority, such as the UK Information Commissioner&apos;s Office.</p>

  <h2>Legal basis</h2>
  <p>Where privacy law requires a legal basis, MyAreaReport processes data to provide the requested service, to pursue legitimate interests in operating and securing the service, and to comply with applicable legal obligations.</p>

  <h2>International transfers</h2>
  <p>The service may be accessed through AI assistant platforms and infrastructure providers that process data in different countries. Those providers are responsible for their own processing under their privacy terms.</p>

  <h2>Children</h2>
  <p>MyAreaReport is not directed to children and should not be used to submit information about children.</p>

  <h2>Changes</h2>
  <p>We may update this policy as the app, tools, data sources, or legal requirements change. The current version is always available at this URL.</p>

  <h2>Contact information</h2>
  <p>For privacy questions, requests, or complaints, contact <a href="mailto:garry@myareareport.com">garry@myareareport.com</a>.</p>
    </section>
  </main>
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
