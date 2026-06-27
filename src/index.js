import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import { getAreaReport } from "./area-data.js";
import { getUsAreaReport, isLikelyUsInput } from "./us-area-data.js";
import {
  averageMs,
  classifyInputType,
  getUsageStats,
  recordToolUsage,
} from "./usage-analytics.js";
import { getSystemMetrics } from "./system-metrics.js";

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

function usageDashboardAuth(req, res) {
  const password = process.env.USAGE_DASHBOARD_PASSWORD;
  if (!password) {
    res.status(404).end();
    return false;
  }
  const username = process.env.USAGE_DASHBOARD_USER || "admin";
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  let valid = false;
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const splitAt = decoded.indexOf(":");
    const suppliedUser = decoded.slice(0, splitAt);
    const suppliedPassword = decoded.slice(splitAt + 1);
    valid = suppliedUser === username && suppliedPassword === password;
  }
  if (!valid) {
    res.setHeader("WWW-Authenticate", 'Basic realm="MyAreaReport usage", charset="UTF-8"');
    res.status(401).send("Authentication required");
    return false;
  }
  return true;
}

function aggregateDays(days, dateKeys) {
  const result = {
    calls: 0,
    success: 0,
    error: 0,
    totalDurationMs: 0,
    byTool: {},
    byInputType: {},
    byHour: {},
  };
  for (const key of dateKeys) {
    const day = days[key];
    if (!day) continue;
    result.calls += day.calls || 0;
    result.success += day.success || 0;
    result.error += day.error || 0;
    result.totalDurationMs += day.totalDurationMs || 0;
    for (const [tool, counter] of Object.entries(day.byTool || {})) {
      result.byTool[tool] = mergeCounter(result.byTool[tool], counter);
    }
    for (const [type, counter] of Object.entries(day.byInputType || {})) {
      result.byInputType[type] = mergeCounter(result.byInputType[type], counter);
    }
    for (const [hour, counter] of Object.entries(day.byHour || {})) {
      result.byHour[hour] = mergeCounter(result.byHour[hour], counter);
    }
  }
  return result;
}

function mergeCounter(existing, counter) {
  const next = existing || { calls: 0, success: 0, error: 0, totalDurationMs: 0 };
  next.calls += counter.calls || 0;
  next.success += counter.success || 0;
  next.error += counter.error || 0;
  next.totalDurationMs += counter.totalDurationMs || 0;
  return next;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-GB");
}

function pct(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function escHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function rowsFromCounters(counters, limit = 12) {
  return Object.entries(counters || {})
    .sort((a, b) => (b[1].calls || 0) - (a[1].calls || 0))
    .slice(0, limit);
}

function renderUtilisationMetric(label, value, detail, percent) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return `
    <div class="metric util">
      <span>${escHtml(label)}</span>
      <strong>${escHtml(value)}</strong>
      ${detail ? `<em>${escHtml(detail)}</em>` : ""}
      <div class="bar"><i style="width:${safePercent}%"></i></div>
    </div>`;
}

function renderSystemPanel(system) {
  if (!system) return "";
  const memory = system.memory || {};
  const disk = system.disk || {};
  const load = system.load || {};
  return `
    <section class="panel system-panel">
      <h2>VPS Utilisation</h2>
      <div class="metric-grid system-grid">
        ${renderUtilisationMetric("CPU", system.cpu?.percent == null ? "n/a" : `${system.cpu.percent}%`, `${system.cpu?.cores || 0} cores`, system.cpu?.percent)}
        ${renderUtilisationMetric("Memory", memory.percent == null ? "n/a" : `${memory.percent}%`, `${formatBytes(memory.used)} / ${formatBytes(memory.total)}`, memory.percent)}
        ${renderUtilisationMetric("Disk", disk.percent == null ? "n/a" : `${disk.percent}%`, `${formatBytes(disk.used)} / ${formatBytes(disk.total)}`, disk.percent)}
        <div class="metric util">
          <span>Load</span>
          <strong>${formatNumber(load.one?.toFixed ? load.one.toFixed(2) : load.one || 0)}</strong>
          <em>5m ${formatNumber(load.five?.toFixed ? load.five.toFixed(2) : load.five || 0)} · 15m ${formatNumber(load.fifteen?.toFixed ? load.fifteen.toFixed(2) : load.fifteen || 0)}</em>
          <div class="bar"><i style="width:${Math.min(100, Math.round(((load.one || 0) / Math.max(1, system.cpu?.cores || 1)) * 100))}%"></i></div>
        </div>
        <div class="metric util">
          <span>Uptime</span>
          <strong>${escHtml(formatDuration(system.uptimeSeconds))}</strong>
          <em>Host uptime</em>
          <div class="bar"><i style="width:100%"></i></div>
        </div>
        <div class="metric util">
          <span>Captured</span>
          <strong>${escHtml(new Date(system.capturedAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London" }))}</strong>
          <em>Europe/London</em>
          <div class="bar"><i style="width:100%"></i></div>
        </div>
      </div>
    </section>`;
}

function renderCounterCards(title, counter) {
  const calls = counter.calls || 0;
  return `
    <section class="panel">
      <h2>${escHtml(title)}</h2>
      <div class="metric-grid">
        <div class="metric"><span>Calls</span><strong>${formatNumber(calls)}</strong></div>
        <div class="metric"><span>Success</span><strong>${pct(counter.success || 0, calls)}</strong></div>
        <div class="metric"><span>Errors</span><strong>${formatNumber(counter.error || 0)}</strong></div>
        <div class="metric"><span>Avg time</span><strong>${formatNumber(averageMs(counter))} ms</strong></div>
      </div>
    </section>`;
}

function renderTable(title, rows, empty = "No usage recorded yet.") {
  const body = rows.length
    ? rows.map(([label, counter]) => `
      <tr>
        <td>${escHtml(label)}</td>
        <td>${formatNumber(counter.calls)}</td>
        <td>${pct(counter.success || 0, counter.calls || 0)}</td>
        <td>${formatNumber(averageMs(counter))} ms</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="muted">${empty}</td></tr>`;
  return `
    <section class="panel">
      <h2>${escHtml(title)}</h2>
      <table>
        <thead><tr><th>Name</th><th>Calls</th><th>Success</th><th>Avg time</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

function renderHourlyBars(hours) {
  const entries = Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, "0");
    return [key, hours?.[key]?.calls || 0];
  });
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return `
    <section class="panel">
      <h2>Times Used Today</h2>
      <div class="hour-grid">
        ${entries.map(([hour, count]) => `
          <div class="hour">
            <span>${hour}</span>
            <div><i style="height:${Math.max(4, Math.round((count / max) * 82))}px"></i></div>
            <b>${formatNumber(count)}</b>
          </div>`).join("")}
      </div>
    </section>`;
}

function renderUsagePage(stats, system) {
  const dates = Object.keys(stats.days || {}).sort();
  const todayKey = dates.at(-1);
  const today = todayKey ? stats.days[todayKey] : { calls: 0, success: 0, error: 0, totalDurationMs: 0, byHour: {} };
  const week = aggregateDays(stats.days || {}, dates.slice(-7));
  const month = aggregateDays(stats.days || {}, dates.slice(-30));
  const lastDays = dates.slice(-30).reverse().map((date) => [date, stats.days[date]]);
  const updated = stats.updatedAt ? new Date(stats.updatedAt).toLocaleString("en-GB", { timeZone: stats.timeZone || "Europe/London" }) : "Never";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Usage — MyAreaReport</title>
  <style>
    :root { --navy:#0c2340; --blue:#1d4ed8; --bg:#eef3f8; --card:#fff; --text:#111827; --muted:#64748b; --border:#dbe3ee; --soft:#f8fafc; --green:#15803d; --red:#b91c1c; }
    * { box-sizing: border-box; }
    body { margin:0; background:linear-gradient(180deg,#f8fafc 0%,var(--bg) 100%); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; line-height:1.45; }
    main { width:min(1120px,calc(100% - 28px)); margin:0 auto; padding:34px 0 48px; }
    header { display:flex; justify-content:space-between; gap:20px; align-items:flex-end; margin-bottom:18px; }
    h1 { margin:0; color:var(--navy); font-size:clamp(2rem,5vw,3rem); letter-spacing:0; line-height:1.05; }
    .lede { margin:8px 0 0; color:var(--muted); max-width:680px; }
    .stamp { padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--muted); font-size:.86rem; white-space:nowrap; }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .panel { border:1px solid var(--border); border-radius:12px; background:var(--card); box-shadow:0 10px 28px rgba(12,35,64,.06); padding:18px; margin-bottom:14px; }
    h2 { margin:0 0 14px; color:var(--navy); font-size:1rem; }
    .metric-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .metric { border:1px solid var(--border); background:var(--soft); border-radius:8px; padding:12px; }
    .metric span { display:block; color:var(--muted); font-size:.78rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
    .metric strong { display:block; margin-top:4px; color:var(--navy); font-size:1.45rem; line-height:1.1; }
    .metric em { display:block; min-height:1.25rem; margin-top:4px; color:var(--muted); font-size:.78rem; font-style:normal; }
    .system-panel { height:100%; }
    .system-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .bar { height:7px; margin-top:10px; overflow:hidden; border-radius:999px; background:#e5eaf2; }
    .bar i { display:block; height:100%; min-width:2px; border-radius:999px; background:var(--blue); }
    table { width:100%; border-collapse:collapse; font-size:.92rem; }
    th,td { padding:10px 8px; border-bottom:1px solid var(--border); text-align:left; }
    th { color:var(--muted); font-size:.76rem; text-transform:uppercase; letter-spacing:.03em; }
    td:nth-child(n+2), th:nth-child(n+2) { text-align:right; }
    .muted { color:var(--muted); }
    .wide { grid-column:span 2; }
    .hour-grid { display:grid; grid-template-columns:repeat(24,minmax(24px,1fr)); gap:6px; align-items:end; min-height:142px; }
    .hour { display:grid; grid-template-rows:auto 90px auto; gap:6px; text-align:center; color:var(--muted); font-size:.7rem; }
    .hour div { display:flex; align-items:end; justify-content:center; border-bottom:1px solid var(--border); }
    .hour i { display:block; width:100%; max-width:18px; border-radius:4px 4px 0 0; background:var(--blue); opacity:.82; }
    .privacy-note { color:var(--muted); font-size:.86rem; margin-top:10px; }
    @media (max-width:860px) { header { display:block; } .stamp { display:inline-block; margin-top:12px; white-space:normal; } .grid { grid-template-columns:1fr; } .wide { grid-column:auto; } .system-grid { grid-template-columns:1fr; } .hour-grid { overflow-x:auto; grid-template-columns:repeat(24,28px); padding-bottom:8px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Usage</h1>
        <p class="lede">Aggregate MyAreaReport tool usage. No raw postcodes, place names, IP addresses, user IDs, coordinates, prompts, or report bodies are stored here.</p>
      </div>
      <div class="stamp">Last updated<br><strong>${escHtml(updated)}</strong></div>
    </header>
    <div class="grid">
      <div class="wide">${renderSystemPanel(system)}</div>
      ${renderCounterCards("Today", today)}
      ${renderCounterCards("Last 7 Days", week)}
      ${renderCounterCards("Last 30 Days", month)}
      <div class="wide">${renderHourlyBars(today.byHour || {})}</div>
      ${renderTable("Tool Usage, Last 30 Days", rowsFromCounters(month.byTool))}
      ${renderTable("Input Types, Last 30 Days", rowsFromCounters(month.byInputType))}
      ${renderTable("Daily Usage", lastDays)}
    </div>
    <p class="privacy-note">Retention: aggregate daily counters are retained for ${formatNumber(process.env.USAGE_STATS_RETAIN_DAYS || 400)} days by default. This page uses Basic Auth and sets no tracking cookie.</p>
  </main>
</body>
</html>`;
}

export async function startStreamableHttpServer(createMcpServer) {
  const port = Number(process.env.PORT ?? 3001);
  const publicBase = (process.env.MCP_APP_UI_DOMAIN || "https://mcp.myareareport.com").replace(/\/+$/, "");
  const mcpServerUrl = process.env.MCP_SERVER_URL || `${publicBase}/mcp`;
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

  app.get("/usage", async (req, res) => {
    if (!usageDashboardAuth(req, res)) return;
    try {
      const [stats, system] = await Promise.all([getUsageStats(), getSystemMetrics()]);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(renderUsagePage(stats, system));
    } catch (err) {
      console.error("[usage] dashboard error:", err.message);
      res.status(500).send("Usage dashboard unavailable");
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
      description_for_human: "UK and USA area intelligence — crime and safety trends, flood or weather alerts, housing, fuel, and road context from public data.",
      description_for_model: "Provides UK and USA area intelligence for supported postcodes, ZIP codes, addresses, and place names. UK results include street-level crime from Police UK, flood warnings and river levels from the Environment Agency, house prices from HM Land Registry, live fuel prices from GOV.UK Fuel Finder, and road traffic from National Highways and DfT. USA results use public sources such as U.S. Census geocoding and ACS indicators, National Weather Service alerts, USGS monitoring stations, FBI Crime Data where configured, EIA fuel price indicators, NREL alternative-fuel station locations, and OpenStreetMap road context. USA crime, property, roads, and fuel results include caveats because national USA coverage is not the same as UK street-level coverage. User-submitted lookup inputs are used only to retrieve requested public data and are not stored by MyAreaReport after the request completes.",
      auth: { type: "none" },
      api: { type: "mcp", url: mcpServerUrl },
      logo_url: `${publicBase}/logo.png`,
      contact_email: "garry@myareareport.com",
      legal_info_url: `${publicBase}/privacy`,
      terms_of_service_url: `${publicBase}/terms`,
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
      <p class="lede">How MyAreaReport handles UK and USA area lookups, public area data, AI-assistant context, retention, and user controls.</p>
      <div class="meta-grid">
        <div class="meta-card"><strong>Service</strong><a href="https://mcp.myareareport.com">mcp.myareareport.com</a></div>
        <div class="meta-card"><strong>Last updated and effective</strong>26 June 2026</div>
      </div>
    </header>
    <section class="policy-content">

  <h2>Who we are and what we do</h2>
  <p>MyAreaReport is a read-only UK and USA area information service operated by MyAreaReport. It runs as an MCP app for AI assistants such as ChatGPT and retrieves public area data for a UK postcode, UK place name, USA ZIP code, USA address, or USA city/state you provide. Contact: <a href="mailto:garry@myareareport.com">garry@myareareport.com</a>.</p>
  <p class="note">MyAreaReport does not provide user accounts, payments, newsletters, targeted advertising, or profiling.</p>

  <h2>Sources of information</h2>
  <p>MyAreaReport receives information directly from the user or AI assistant request, from public and official data sources, and from transient technical request data needed to operate the service.</p>

  <h2>Data collected or processed</h2>
  <p>Depending on the tool or app screen used, MyAreaReport may process the following data:</p>
  <ul>
    <li><strong>User inputs:</strong> UK postcode, UK outcode, UK place name, USA ZIP code, USA address, or USA city/state supplied to tools such as area-search, area-crime, area-flood, area-property, area-roads, area-fuel, and the app search form.</li>
    <li><strong>Resolved area data:</strong> postcode or ZIP, latitude/longitude, district, city, county, state, region, country, and approximate-place metadata returned by geocoding.</li>
    <li><strong>Public report outputs:</strong> crime categories, incident counts, outcomes, trends, stop-and-search summaries where available, flood warnings and alerts, weather alerts, monitoring station readings, UK Land Registry property summaries and recent sales, USA Census housing indicators, traffic counts where available, road sensor or road-context summaries, fuel station names, fuel prices or fuel price indicators, alternative-fuel station locations, distances, and map tile coordinates.</li>
    <li><strong>AI-assistant context:</strong> after a report loads, the app may send a concise summary of the selected area and report results back to the AI assistant so it can answer follow-up questions about the displayed report.</li>
    <li><strong>App interaction state:</strong> the app processes tab selections and app-only tool calls needed to load the selected view. In demo mode only, a local browser flag may be stored to remember demo mode on that device.</li>
    <li><strong>Technical and security data:</strong> IP addresses are held briefly in memory for rate limiting. The MyAreaReport application does not intentionally persist access logs, user lookup history, or generated reports.</li>
  </ul>

  <h2>How we use information</h2>
  <ul>
    <li>To resolve a UK postcode/place or USA ZIP/address/city-state input to an area.</li>
    <li>To retrieve and display the requested public crime, safety, flood, weather, housing, roads, fuel, alternative-fuel station, and map data.</li>
    <li>To return tool outputs and app summaries to the AI assistant you are using.</li>
    <li>To operate, secure, and rate-limit the service.</li>
    <li>To comply with legal, platform, and security obligations.</li>
  </ul>

  <h2>How we disclose information</h2>
  <p>MyAreaReport may send the postcode, ZIP code, address, place name, city/state, resolved coordinates, or derived search area to the following services when needed to answer your request:</p>
  <ul>
    <li><a href="https://data.police.uk">Police UK API</a> — crime data</li>
    <li><a href="https://environment.data.gov.uk">Environment Agency</a> — flood warnings and river levels</li>
    <li><a href="https://postcodes.io">Postcodes.io</a> — geocoding</li>
    <li><a href="https://landregistry.data.gov.uk">HM Land Registry</a> — house prices</li>
    <li><a href="https://www.developer.fuel-finder.service.gov.uk">GOV.UK Fuel Finder</a> — fuel prices</li>
    <li><a href="https://webtris.highwaysengland.co.uk">National Highways WebTRIS</a> — road traffic</li>
    <li>Department for Transport road traffic datasets — local A-road count-point data</li>
    <li><a href="https://geocoding.geo.census.gov">U.S. Census Geocoder</a> and Census TIGERweb — USA geocoding, ZIP, city, state, county, and coordinate metadata</li>
    <li><a href="https://api.census.gov/data.html">U.S. Census ACS API</a> — USA housing, population, tenure, rent, and related indicators when configured</li>
    <li><a href="https://api.weather.gov">National Weather Service API</a> — USA active weather, flood, and emergency alerts</li>
    <li><a href="https://waterservices.usgs.gov">USGS Water Data APIs</a> — USA nearby monitoring stations and water readings</li>
    <li><a href="https://api.usa.gov/crime/fbi/cde">FBI Crime Data API</a> — USA reported crime trend data where configured and available</li>
    <li><a href="https://www.eia.gov/opendata/">EIA Open Data</a> — USA regional or national fuel price indicators</li>
    <li><a href="https://developer.nrel.gov/docs/transportation/alt-fuel-stations-v1/">NREL Alternative Fuel Stations API</a> — USA alternative-fuel station locations where configured</li>
    <li><a href="https://www.openstreetmap.org">OpenStreetMap</a> and Overpass API — map tiles and nearby road context</li>
    <li>The AI assistant platform you use, such as OpenAI/ChatGPT — tool inputs, tool outputs, app UI data, and follow-up context needed to display and discuss the report</li>
    <li>Hosting and infrastructure providers used to run MyAreaReport — transient infrastructure and security data needed to operate the service</li>
  </ul>
  <p>MyAreaReport does not sell personal data and does not use your postcode or place lookup for advertising or profiling.</p>

  <h2>Cookies, analytics, and advertising</h2>
  <p>MyAreaReport does not set advertising cookies, does not use third-party analytics, and does not use targeted advertising. It records first-party aggregate usage counters, such as tool name, broad input type, success/error status, response time, day, and hour, so the operator can understand usage and reliability. These aggregate counters do not include raw postcodes, ZIP codes, addresses, place names, coordinates, prompts, user IDs, IP addresses, or generated reports. Demo mode may use local storage on your device to remember that demo mode is enabled; this is not used for advertising or profiling.</p>

  <h2>Data retention</h2>
  <ul>
    <li><strong>Postcodes, ZIP codes, addresses, place names, coordinates, prompts, and generated reports:</strong> not stored by MyAreaReport after the request completes.</li>
    <li><strong>In-memory rate limit data:</strong> IP-based counters are cleared approximately every 60 seconds.</li>
    <li><strong>Aggregate usage counters:</strong> daily and hourly counters are retained for the configured dashboard period, 400 days by default. They do not contain raw lookup inputs, prompts, coordinates, reports, IP addresses, or user IDs.</li>
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

  // ── Terms of service ──────────────────────────────────────────────────────
  app.get("/terms", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Terms of Service — MyAreaReport</title>
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

    .legal-shell {
      width: min(920px, calc(100% - 32px));
      margin: 0 auto;
      padding: 40px 0 56px;
    }

    .legal-hero {
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

    .legal-content {
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
      .legal-shell {
        width: min(100% - 20px, 920px);
        padding: 16px 0 32px;
      }

      .legal-hero,
      .legal-content {
        padding: 20px 18px;
        border-radius: 10px;
      }

      .meta-grid { grid-template-columns: 1fr; }
      h2 { margin-top: 24px; }
    }
  </style>
</head>
<body>
  <main class="legal-shell">
    <header class="legal-hero">
      <div class="brand-row"><span class="brand-mark">M</span><span>MyAreaReport</span></div>
      <h1>Terms of Service</h1>
      <p class="lede">The terms for using MyAreaReport to retrieve read-only UK and USA area intelligence from public and official data sources.</p>
      <div class="meta-grid">
        <div class="meta-card"><strong>Service</strong><a href="https://mcp.myareareport.com">mcp.myareareport.com</a></div>
        <div class="meta-card"><strong>Last updated and effective</strong>26 June 2026</div>
      </div>
    </header>
    <section class="legal-content">
      <h2>Use of the service</h2>
      <p>MyAreaReport provides read-only UK and USA area information from public and official data sources. You may use the service to look up area reports for UK postcodes, UK place names, USA ZIP codes, USA addresses, and USA city/state inputs.</p>

      <h2>Information only</h2>
      <p class="note">The service is provided for general information and convenience. It is not legal, financial, property, insurance, safety, emergency, or professional advice.</p>
      <p>You should verify important decisions using the original data source or a qualified professional.</p>

      <h2>Data sources and accuracy</h2>
      <p>Reports may include UK data from Police UK, the Environment Agency, Postcodes.io, HM Land Registry, National Highways, GOV.UK Fuel Finder, Department for Transport road traffic data, and OpenStreetMap.</p>
      <p>Reports may include USA data from U.S. Census geocoding, TIGERweb, and ACS APIs, National Weather Service alerts, USGS Water Data APIs, FBI Crime Data where configured, EIA Open Data, NREL Alternative Fuel Stations where configured, OpenStreetMap, and Overpass API.</p>
      <p>These sources may be delayed, incomplete, unavailable, or changed by their publishers. USA national data does not provide full UK-style parity: USA crime results are reported trend summaries rather than street-level incidents, USA housing results are indicators rather than recent individual sale prices, USA roads are nearby road context unless traffic counts are available, and USA fuel data is regional price or alternative-fuel context rather than live petrol station prices. MyAreaReport does not guarantee that any result is complete, current, or error-free.</p>

      <h2>No emergency use</h2>
      <p>Do not rely on MyAreaReport for emergency warnings or immediate safety decisions. For emergencies, contact the relevant emergency services or official authority.</p>

      <h2>Acceptable use</h2>
      <p>You must not misuse the service, attempt to disrupt it, bypass rate limits, reverse engineer private infrastructure, or use it for unlawful, harmful, or abusive activity.</p>

      <h2>Availability</h2>
      <p>The service is provided as available. It may be changed, interrupted, suspended, or discontinued without notice.</p>

      <h2>Limitation of liability</h2>
      <p>To the fullest extent permitted by law, MyAreaReport is not liable for losses arising from use of, inability to use, or reliance on the service or its results.</p>

      <h2>Privacy</h2>
      <p>Use of the service is also governed by the <a href="https://mcp.myareareport.com/privacy">Privacy Policy</a>.</p>

      <h2>Contact information</h2>
      <p>For questions about these terms, contact <a href="mailto:garry@myareareport.com">garry@myareareport.com</a>.</p>
    </section>
  </main>
</body>
</html>`);
  });

  // ── Fallback area endpoint for non-MCP-App hosts ──────────────────────────
  app.get("/api/area", async (req, res) => {
    const postcode = req.query.postcode || "SW1A 1AA";
    try {
      const payload = await (isLikelyUsInput(postcode) ? getUsAreaReport(postcode) : getAreaReport(postcode));
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
    const toolArgs = req.body?.params?.arguments || {};
    const startedAt = Date.now();
    if (method === "tools/call") {
      console.log(`[tool] ${toolName}`);
      const inputType = classifyInputType(toolArgs.postcode || toolArgs.query);
      res.on("finish", () => {
        recordToolUsage({
          tool: toolName,
          inputType,
          status: res.statusCode < 400 ? "success" : "error",
          durationMs: Date.now() - startedAt,
        }).catch((err) => console.error("[usage] record failed:", err.message));
      });
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
