import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { shouldUseDemoFallback } from "./bootstrap-policy.js";
import { createFeatureViews } from "./feature-views.js";
import "./global.css";
import "./mcp-app.css";

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  mode: "search",          // search | full | crime | flood
  area: null,              // geocoded area object
  month: null,
  crime: null,             // crime summary (from overview)
  flood: null,             // flood summary (from overview)
  crimeDetail: null,       // detailed crime data (from area-crime tool)
  floodDetail: null,       // detailed flood data (from area-flood tool)
  propertyDetail: null,    // house price data (from area-property tool)
  roadsDetail: null,       // traffic data (from area-roads tool)
  fuelDetail: null,        // fuel prices (from area-fuel tool)
  activeTab: "overview",
  lastModelContext: null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const appRoot = document.getElementById("app-root");

// ─── App instance ─────────────────────────────────────────────────────────────

const app = new App(
  { name: "MyAreaReport", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);
let features;
let demoModeEnabled = false;
let bootstrapped = false;
let currentDisplayMode = "inline";

function updateDisplayModeButton() {
  const btn = document.getElementById("expand-btn");
  if (!btn) return;
  const isFullscreen = currentDisplayMode === "fullscreen";
  btn.textContent = isFullscreen ? "⤡" : "⤢";
  btn.title = isFullscreen ? "Exit fullscreen" : "Expand to fullscreen";
  btn.setAttribute("aria-label", btn.title);
}

// ─── Host context ─────────────────────────────────────────────────────────────

function applyHostContext(ctx) {
  if (ctx.displayMode) {
    currentDisplayMode = ctx.displayMode;
    updateDisplayModeButton();
  }
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets && appRoot) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    appRoot.style.setProperty("--host-safe-bottom", `${bottom}px`);
    appRoot.style.paddingTop    = `${top + 8}px`;
    appRoot.style.paddingRight  = `${right + 8}px`;
    appRoot.style.paddingBottom = `calc(${bottom + 8}px + var(--composer-reserve, 0px))`;
    appRoot.style.paddingLeft   = `${left + 8}px`;
  }
}

// ─── View switching ───────────────────────────────────────────────────────────

const VIEW_MAP = {
  loading: "view-loading",
  search:  "view-search",
  full:    "view-full",
  crime:   "view-crime",
  flood:   "view-flood",
};

function showView(viewKey) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const id = VIEW_MAP[viewKey] ?? "view-search";
  document.getElementById(id)?.classList.remove("hidden");
}

// ─── Tool calls ───────────────────────────────────────────────────────────────

async function callServerTool(name, args = {}) {
  try {
    const result = await app.callServerTool({ name, arguments: args });
    handleToolResult(result);
    return result;
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    return null;
  }
}

// ─── Model context ────────────────────────────────────────────────────────────

function pushModelContext(eventName, payload) {
  const lines = [];
  if (payload?.area) {
    lines.push(`Area: ${payload.area.postcode} — ${payload.area.district}, ${payload.area.county}`);
    if (payload.month) lines.push(`Data month: ${payload.month}`);
  }
  if (payload?.crime) {
    const pct = payload.crime.vsAvg;
    const vs = pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}% vs E&W avg)` : '';
    lines.push(`Crime: ${payload.crime.total} incidents${vs}`);
    if (payload.crime.categories?.length) {
      lines.push(`Top category: ${payload.crime.categories[0].label} (${payload.crime.categories[0].count})`);
    }
  }
  if (payload?.flood) {
    lines.push(`Flood: ${payload.flood.warnings} warnings, ${payload.flood.alerts} alerts`);
  }
  if (payload?.avgPrice) {
    lines.push(`Avg house price (${payload.outcode}): £${payload.avgPrice.toLocaleString('en-GB')}`);
  }
  if (payload?.sites?.length) {
    const s = payload.sites.find(s => s.report);
    if (s) lines.push(`Traffic: ${s.description} — ${s.report.avgDailyFlow?.toLocaleString()} vehicles/day`);
  }
  if (payload?.kind === "area-fuel") {
    const status = payload.status ?? (payload.error ? "unavailable" : "ok");
    const reason = payload.reason ?? payload.error;
    if (status === "unavailable") {
      lines.push(`Fuel: unavailable${reason ? ` (${reason})` : ""}`);
    } else if (status === "no_results") {
      lines.push(`Fuel: no stations found within radius${reason ? ` (${reason})` : ""}`);
    } else if (payload.cheapest) {
      const cheapest = Object.entries(payload.cheapest)[0]?.[1];
      if (cheapest) {
        lines.push(`Fuel: cheapest nearby is ${cheapest.name} at ${cheapest.price}p/litre (${cheapest.distKm} km)`);
      }
    } else {
      lines.push(`Fuel: ${payload.stations?.length ?? 0} nearby stations`);
    }
  }

  const text = `[MyAreaReport — ${eventName}]\n${lines.join('\n')}`;
  state.lastModelContext = { event: eventName, payload, text, at: new Date().toISOString() };

  try { app.updateModelContext({ content: [{ type: "text", text }] }); } catch { /* optional */ }

  const panel = document.getElementById("model-context-panel");
  const pre = document.getElementById("model-context-pre");
  if (panel && pre) {
    const show = demoModeEnabled && Boolean(state.lastModelContext);
    panel.classList.toggle("hidden", !show);
    if (show) pre.textContent = text;
  }
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function updateHeader() {
  const postcode = document.getElementById("header-postcode");
  const district = document.getElementById("header-district");
  if (postcode && state.area) postcode.textContent = state.area.postcode;
  if (district && state.area) district.textContent = `${state.area.district}${state.area.region ? ', ' + state.area.region : ''}`;

  // Fragment views
  const crimeHeader = document.getElementById("crime-header-area");
  if (crimeHeader && state.area) crimeHeader.textContent = `${state.area.postcode} · ${state.area.district}`;
  const floodHeader = document.getElementById("flood-header-area");
  if (floodHeader && state.area) floodHeader.textContent = `${state.area.postcode} · ${state.area.district}`;
}

// ─── Tool result routing ──────────────────────────────────────────────────────

function extractPayload(result) {
  if (!result || typeof result !== "object") return null;
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  if (result.params?.structuredContent && typeof result.params.structuredContent === "object") return result.params.structuredContent;
  if (result.kind) return result;
  return null;
}

function handleToolResult(result) {
  const payload = extractPayload(result);
  if (!payload?.kind) return false;

  if (payload.kind === "area-loading") {
    state.area    = payload.area;
    state.month   = null;
    state.crime   = null;
    state.flood   = null;
    state.mode    = "full";
    state.activeTab = "overview";
    state.crimeDetail = null;
    state.floodDetail = null;
    state.propertyDetail = null;
    state.roadsDetail = null;
    state.fuelDetail = null;
    showView("full");
    updateHeader();
    features?.renderOverview();
    bootstrapped = true;
    // auto-load crime and flood in parallel without blocking
    Promise.all([
      callServerTool("area-app-crime", { postcode: state.area.postcode }),
      callServerTool("area-app-flood", { postcode: state.area.postcode }),
      callServerTool("area-app-fuel", { postcode: state.area.postcode }),
    ]).catch(() => {});
    return true;
  }

  if (payload.kind === "area-overview") {
    state.area    = payload.area;
    state.month   = payload.month;
    state.crime   = payload.crime;
    state.flood   = payload.flood;
    state.fuelDetail = payload.fuel ?? null;
    state.mode    = "full";
    state.activeTab = "overview";
    state.crimeDetail = null;
    state.floodDetail = null;
    state.propertyDetail = null;
    state.roadsDetail = null;
    showView("full");
    updateHeader();
    features?.renderOverview();
    pushModelContext("area-overview", payload);
    bootstrapped = true;
    return true;
  }

  if (payload.kind === "area-crime") {
    state.area        = payload.area;
    state.month       = payload.month;
    state.crimeDetail = payload.crime;
    if (!state.crime) state.crime = payload.crime;
    if (state.mode === "full") {
      if (state.activeTab === "overview") {
        features?.renderOverview();
      } else {
        features?.showTab("crime");
        features?.renderCrimeDetail("crime-body");
      }
    } else {
      state.mode = "crime";
      showView("crime");
      updateHeader();
      features?.renderCrimeDetail("crime-fragment-body", "crime-fragment-map");
    }
    pushModelContext("area-crime", payload);
    bootstrapped = true;
    return true;
  }

  if (payload.kind === "area-flood") {
    state.area        = payload.area;
    state.floodDetail = payload.flood;
    if (!state.flood) state.flood = payload.flood;
    if (state.mode === "full") {
      if (state.activeTab === "overview") {
        features?.renderOverview();
      } else {
        features?.showTab("flood");
        features?.renderFloodDetail("flood-body");
      }
    } else {
      state.mode = "flood";
      showView("flood");
      updateHeader();
      features?.renderFloodDetail("flood-fragment-body", "flood-fragment-map");
    }
    pushModelContext("area-flood", payload);
    bootstrapped = true;
    return true;
  }

  if (payload.kind === "area-property") {
    state.propertyDetail = payload;
    if (payload.area && !state.area) { state.area = payload.area; }
    if (state.mode === "full") {
      features?.showTab("property");
      features?.renderPropertyDetail("property-body");
    } else {
      state.mode = "full";
      showView("full");
      updateHeader();
      features?.showTab("property");
      features?.renderPropertyDetail("property-body");
    }
    pushModelContext("area-property", payload);
    bootstrapped = true;
    return true;
  }

  if (payload.kind === "area-roads") {
    state.roadsDetail = payload;
    if (payload.area && !state.area) { state.area = payload.area; }
    if (state.mode === "full") {
      features?.showTab("roads");
      features?.renderRoadsDetail("roads-body");
    } else {
      state.mode = "full";
      showView("full");
      updateHeader();
      features?.showTab("roads");
      features?.renderRoadsDetail("roads-body");
    }
    pushModelContext("area-roads", payload);
    bootstrapped = true;
    return true;
  }

  if (payload.kind === "area-fuel") {
    state.fuelDetail = payload;
    if (payload.area && !state.area) { state.area = payload.area; }
    if (state.mode === "full") {
      features?.showTab("fuel");
      features?.renderFuelDetail("fuel-body");
    } else {
      state.mode = "full";
      showView("full");
      updateHeader();
      features?.showTab("fuel");
      features?.renderFuelDetail("fuel-body");
    }
    pushModelContext("area-fuel", payload);
    bootstrapped = true;
    return true;
  }

  return false;
}

// ─── Demo toolbar ──────────────────────────────────────────────────────────────

function setDemoMode(on) {
  demoModeEnabled = Boolean(on);
  const toolbar = document.getElementById("demo-toolbar");
  if (toolbar) toolbar.classList.toggle("hidden", !demoModeEnabled);
}

function wireDemoToolbar() {
  const hasParam = () => { try { return new URLSearchParams(window.location.search).get("demo") === "1"; } catch { return false; } };
  const stored   = () => { try { return localStorage.getItem("mar-demo") === "1"; } catch { return false; } };

  setDemoMode(hasParam() || stored());

  document.getElementById("demo-toolbar")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-demo]");
    if (!btn) return;
    const action = btn.dataset.demo;

    if (action === "westminster") { await callServerTool("area-app-search", { query: "SW1A 2AA" }); return; }
    if (action === "leeds")       { await callServerTool("area-app-search", { query: "LS1 1BA" }); return; }
    if (action === "crime" && state.area) {
      await callServerTool("area-app-crime", { postcode: state.area.postcode });
      return;
    }
    if (action === "flood" && state.area) {
      await callServerTool("area-app-flood", { postcode: state.area.postcode });
      return;
    }
    if (action === "reset") {
      state.area = null; state.crime = null; state.flood = null;
      state.crimeDetail = null; state.floodDetail = null;
      state.propertyDetail = null; state.roadsDetail = null; state.fuelDetail = null;
      state.mode = "search"; bootstrapped = false;
      showView("search");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!e.shiftKey || e.key.toLowerCase() !== "d") return;
    e.preventDefault();
    const next = !demoModeEnabled;
    setDemoMode(next);
    try { next ? localStorage.setItem("mar-demo","1") : localStorage.removeItem("mar-demo"); } catch {}
  });
}

// ─── Notify size ──────────────────────────────────────────────────────────────

function notifyHostSize() {
  try {
    const height = Math.ceil(Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      appRoot?.scrollHeight ?? 0,
      280,
    ));
    app.sendSizeChanged({ width: Math.ceil(document.documentElement.offsetWidth || 360), height });
  } catch { /* host not ready */ }
}

// ─── Bootstrap fallback ───────────────────────────────────────────────────────

async function bootstrapFromFallback() {
  if (!shouldUseDemoFallback({ bootstrapped, demoModeEnabled })) return bootstrapped;
  const urls = [
    "https://mcp.myareareport.com/api/area?postcode=SW1A%202AA",
    "http://localhost:3001/api/area?postcode=SW1A%202AA",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const payload = await res.json();
      if (handleToolResult({ structuredContent: payload })) return true;
    } catch { /* try next */ }
  }
  return false;
}

// ─── Wire global nav ──────────────────────────────────────────────────────────

function wireGlobalNav() {
  document.addEventListener("click", (e) => {
    const backBtn = e.target.closest("[data-nav]");
    if (backBtn) {
      const dest = backBtn.dataset.nav;
      if (dest === "full" && state.area) {
        state.mode = "full";
        showView("full");
        features?.renderOverview();
        notifyHostSize();
      }
    }

    const expandBtn = document.getElementById("expand-btn");
    if (e.target === expandBtn) {
      const targetMode = currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
      app.requestDisplayMode({ mode: targetMode })
        .then(result => {
          if (result?.mode) {
            currentDisplayMode = result.mode;
            updateDisplayModeButton();
            notifyHostSize();
          }
        })
        .catch(() => {});
    }

    const newSearchBtn = document.getElementById("new-search-btn");
    if (e.target === newSearchBtn) {
      showView("search");
      setTimeout(() => document.getElementById("search-input")?.focus(), 100);
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

app.onhostcontextchanged = ctx => applyHostContext(ctx);
app.ontoolresult = result => { if (handleToolResult(result)) bootstrapped = true; };
app.onerror = console.error;
app.onteardown = async () => ({});

wireDemoToolbar();

app.connect().catch(console.error).then(async () => {
  const ctx = app.getHostContext();
  if (ctx) applyHostContext(ctx);

  features = createFeatureViews({ state, app, callServerTool, notifyHostSize, pushModelContext });
  wireGlobalNav();
  features.wireSearchForm();

  showView("loading");

  for (const delay of [400, 1400, 3000]) {
    await new Promise(r => setTimeout(r, delay));
    if (bootstrapped) return;
    if (await bootstrapFromFallback()) return;
  }

  if (!bootstrapped) {
    showView("search");
    notifyHostSize();
  }
});
