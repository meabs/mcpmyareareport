import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default icon paths for Vite bundling
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIconUrl, iconRetinaUrl: markerIconRetinaUrl, shadowUrl: markerShadowUrl });

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Map instances keyed by container id
const maps = {};

function getOrCreateMap(containerId, lat, lng, zoom = 14) {
  if (maps[containerId]) {
    maps[containerId].setView([lat, lng], zoom);
    return maps[containerId];
  }
  const el = document.getElementById(containerId);
  if (!el) return null;
  el.innerHTML = "";
  const map = L.map(containerId, { zoomControl: true, attributionControl: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);
  map.setView([lat, lng], zoom);
  maps[containerId] = map;
  return map;
}

function clearMapLayers(map) {
  map.eachLayer(layer => {
    if (layer instanceof L.CircleMarker || layer instanceof L.Marker) {
      map.removeLayer(layer);
    }
  });
}

function addCrimeMarkers(map, markers) {
  if (!markers?.length) return;
  // Group by ~50m grid for performance
  const step = 0.0005;
  const grid = {};
  for (const m of markers) {
    const gLat = Math.round(m.lat / step) * step;
    const gLng = Math.round(m.lng / step) * step;
    const key = `${gLat.toFixed(4)},${gLng.toFixed(4)}`;
    if (!grid[key]) grid[key] = { lat: gLat, lng: gLng, count: 0, color: m.color };
    grid[key].count++;
  }
  for (const g of Object.values(grid)) {
    const r = Math.min(4 + g.count * 1.5, 14);
    L.circleMarker([g.lat, g.lng], {
      radius: r,
      fillColor: g.color,
      color: "rgba(0,0,0,0.2)",
      weight: 1,
      fillOpacity: 0.72,
    }).addTo(map);
  }
}

function addFloodStationMarkers(map, stations) {
  for (const s of stations || []) {
    if (!s.lat || !s.lng) continue;
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:20px;height:20px;border-radius:50%;background:#1d4ed8;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff">💧</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    L.marker([s.lat, s.lng], { icon })
      .bindTooltip(`${s.name}<br><small>${s.river}</small>`, { sticky: true })
      .addTo(map);
  }
}

function addCentreMarker(map, lat, lng, postcode) {
  const icon = L.divIcon({
    className: "",
    html: `<div style="background:#0c2340;color:#fff;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;font-family:system-ui;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35)">${postcode}</div>`,
    iconSize: [null, null],
    iconAnchor: [0, 0],
  });
  L.marker([lat, lng], { icon }).addTo(map);
}

function riskColor(level) {
  return { none: "#16a34a", low: "#16a34a", medium: "#d97706", high: "#dc2626", "very-high": "#7f1d1d" }[level] || "#64748b";
}

function riskLabel(level) {
  return { none: "No active warnings", low: "Low", medium: "Medium", high: "High", "very-high": "Very high" }[level] || level;
}

function crimeAvgChip(crime) {
  if (crime?.vsAvg == null) return '';
  const pct = crime.vsAvg;
  const sign = pct >= 0 ? '+' : '';
  const cls = pct > 30 ? 'crime-above' : pct < -30 ? 'crime-below' : 'crime-near';
  const label = pct > 30 ? 'above' : pct < -30 ? 'below' : 'near';
  return `<span class="crime-avg-chip ${cls}" title="England &amp; Wales monthly average ≈ ${crime.nationalAvg || 30} incidents">${sign}${pct}% vs E&amp;W avg (${label})</span>`;
}

function fmtMonth(yyyymm) {
  if (!yyyymm) return "";
  const [y, m] = yyyymm.split("-");
  return new Date(+y, +m - 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function createFeatureViews({ state, app, callServerTool, notifyHostSize, pushModelContext }) {

  // ── Tab switching ─────────────────────────────────────────────────────────

  function showTab(tab) {
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    });
    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.classList.remove("hidden");
    state.activeTab = tab;
    notifyHostSize();
  }

  // ── Crime category bars ───────────────────────────────────────────────────

  function renderCrimeBars(categories, containerId) {
    const el = document.getElementById(containerId);
    if (!el || !categories?.length) return;
    const max = categories[0].count;
    el.innerHTML = categories.map(c => `
      <div class="crime-bar-item">
        <span class="crime-bar-label" title="${c.label}">${c.label}</span>
        <div class="crime-bar-track">
          <div class="crime-bar-fill" style="width:${Math.round((c.count/max)*100)}%;background:${c.color}"></div>
        </div>
        <span class="crime-bar-count">${c.count}</span>
      </div>
    `).join("");
  }

  // ── Trend chart ───────────────────────────────────────────────────────────

  function renderTrendChart(trend, containerId) {
    const el = document.getElementById(containerId);
    if (!el || !trend?.length) return;
    const max = Math.max(...trend.map(t => t.total), 1);
    el.innerHTML = trend.map((t, i) => `
      <div class="trend-bar-wrap">
        <span class="trend-count">${t.total}</span>
        <div class="trend-bar ${i === trend.length - 1 ? 'current' : ''}" style="height:${Math.round((t.total/max)*50)+4}px"></div>
        <span class="trend-label">${fmtMonth(t.month).replace(' ', '\n').split(' ').map(p => p.slice(0,3)).join("' ")}</span>
      </div>
    `).join("");
  }

  // ── Flood items ───────────────────────────────────────────────────────────

  function renderFloodItems(items, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!items?.length) {
      el.innerHTML = `<div class="empty-state">No active flood warnings or alerts for this area.</div>`;
      return;
    }
    el.innerHTML = items.map(f => `
      <div class="flood-item" style="border-left-color:${f.severityColor}">
        <div class="flood-item-header">
          <p class="flood-item-name">${f.area}</p>
          <span class="flood-severity-pill" style="background:${f.severityColor}1a;color:${f.severityColor}">${f.severityLabel}</span>
        </div>
        ${f.message ? `<p class="flood-item-message">${f.message}</p>` : ''}
        ${f.timeRaised ? `<p class="flood-item-message" style="margin-top:4px;font-size:0.7rem">Raised: ${new Date(f.timeRaised).toLocaleString('en-GB')}</p>` : ''}
      </div>
    `).join("");
  }

  // ── Station cards ─────────────────────────────────────────────────────────

  function renderStationCards(stations, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!stations?.length) {
      el.innerHTML = `<div class="empty-state">No monitoring stations found within 12 km.</div>`;
      return;
    }
    el.innerHTML = stations.map(s => `
      <div class="station-card">
        <div class="station-info">
          <div class="station-name">${s.name}</div>
          <div class="station-river">💧 ${s.river}</div>
        </div>
        <div class="station-reading">
          ${s.reading
            ? `<div class="station-value">${s.reading.value}</div><div class="station-unit">${s.reading.unit}</div>`
            : `<div class="station-unit">No reading</div>`}
        </div>
      </div>
    `).join("");
  }

  // ── Map legend ────────────────────────────────────────────────────────────

  function renderLegend(categories) {
    const el = document.getElementById("map-legend");
    if (!el || !categories?.length) return;
    el.innerHTML = categories.slice(0, 6).map(c => `
      <span class="legend-item">
        <span class="legend-dot" style="background:${c.color}"></span>
        ${c.label}
      </span>
    `).join("") + `<span class="legend-item"><span class="legend-dot" style="background:#1d4ed8"></span>Flood station</span>`;
  }

  // ── Stat row ──────────────────────────────────────────────────────────────

  function renderStatRow() {
    const el = document.getElementById("stat-row");
    if (!el || !state.area) return;
    const { crime, flood, month } = state;
    const crimeBg = { none:"#dcfce7", low:"#dcfce7", medium:"#fef3c7", high:"#fee2e2", "very-high":"#fee2e2" };
    el.innerHTML = `
      <div class="stat-card" data-action="tab-crime" title="View crime details">
        <div class="stat-card-icon">🔎</div>
        <div class="stat-card-label">Total crimes</div>
        <div class="stat-card-value">${crime?.total ?? "—"}</div>
        <div class="stat-card-sub">${crimeAvgChip(crime)}</div>
      </div>
      <div class="stat-card" data-action="tab-flood" title="View flood details">
        <div class="stat-card-icon">🌊</div>
        <div class="stat-card-label">Flood status</div>
        <div class="stat-card-value">${flood?.warnings ?? 0} <span style="font-size:0.9rem;font-weight:500">warnings</span></div>
        <div class="stat-card-sub">
          <span class="risk-badge ${flood?.riskLevel ?? 'none'}">
            <span class="risk-dot"></span>${riskLabel(flood?.riskLevel)}
          </span>
        </div>
      </div>
      <div class="stat-card" style="cursor:default">
        <div class="stat-card-icon">📅</div>
        <div class="stat-card-label">Data month</div>
        <div class="stat-card-value" style="font-size:1rem">${fmtMonth(month)}</div>
        <div class="stat-card-sub">Police UK · EA</div>
      </div>
      <div class="stat-card" style="cursor:default">
        <div class="stat-card-icon">📍</div>
        <div class="stat-card-label">Area</div>
        <div class="stat-card-value" style="font-size:0.95rem">${state.area.district}</div>
        <div class="stat-card-sub">${state.area.county || state.area.region}</div>
      </div>
    `;
    el.querySelectorAll("[data-action]").forEach(card => {
      card.addEventListener("click", () => {
        const action = card.dataset.action;
        if (action === "tab-crime") { showTab("crime"); loadCrimeDetail(); }
        if (action === "tab-flood") { showTab("flood"); loadFloodDetail(); }
      });
    });
  }

  // ── Overview crime section ────────────────────────────────────────────────

  function renderOverviewCrime() {
    const el = document.getElementById("overview-crime");
    if (!el || !state.crime) return;
    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Crime by category</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="month-badge">${fmtMonth(state.month)}</span>
          ${crimeAvgChip(state.crime)}
        </div>
      </div>
      <div class="section-body">
        <div id="overview-crime-bars" class="crime-bar-list"></div>
        <p style="margin:12px 0 0;font-size:0.72rem;color:var(--muted)">
          ${state.crime.stopSearch} stop & search recorded this month.
          <button class="hint-chip" style="margin-left:6px" id="crime-detail-link">Full analysis →</button>
        </p>
      </div>
    `;
    renderCrimeBars(state.crime.categories, "overview-crime-bars");
    document.getElementById("crime-detail-link")?.addEventListener("click", () => {
      showTab("crime");
      loadCrimeDetail();
    });
  }

  // ── Overview flood section ────────────────────────────────────────────────

  function renderOverviewFlood() {
    const el = document.getElementById("overview-flood");
    if (!el || !state.flood) return;
    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Flood risk</h2>
        <span class="risk-badge ${state.flood.riskLevel}">
          <span class="risk-dot"></span>${riskLabel(state.flood.riskLevel)}
        </span>
      </div>
      <div class="section-body">
        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div class="info-pill ${state.flood.warnings > 0 ? 'red' : 'green'}">⚠ ${state.flood.warnings} warning${state.flood.warnings !== 1 ? 's' : ''}</div>
          <div class="info-pill ${state.flood.alerts > 0 ? 'amber' : 'green'}">🔔 ${state.flood.alerts} alert${state.flood.alerts !== 1 ? 's' : ''}</div>
          <div class="info-pill blue">📡 ${state.flood.stations?.length ?? 0} stations</div>
        </div>
        <div id="overview-flood-list" class="flood-list"></div>
        ${state.flood.total === 0
          ? `<div class="empty-state" style="padding:12px 0">No active flood warnings or alerts in ${state.area?.county || 'this area'}.</div>`
          : `<button class="hint-chip" style="margin-top:8px" id="flood-detail-link">Full flood report →</button>`}
      </div>
    `;
    renderFloodItems(state.flood.items?.slice(0, 3), "overview-flood-list");
    document.getElementById("flood-detail-link")?.addEventListener("click", () => {
      showTab("flood");
      loadFloodDetail();
    });
  }

  // ── Overview (main render) ────────────────────────────────────────────────

  function renderOverview() {
    if (!state.area) return;
    renderStatRow();
    renderOverviewCrime();
    renderOverviewFlood();
    showApproximateNotice(state.area);

    // Map
    const map = getOrCreateMap("map-container", state.area.lat, state.area.lng, 14);
    if (map) {
      clearMapLayers(map);
      addCrimeMarkers(map, state.crime?.markers);
      addFloodStationMarkers(map, state.flood?.stations);
      addCentreMarker(map, state.area.lat, state.area.lng, state.area.postcode);
      setTimeout(() => map.invalidateSize(), 100);
    }
    renderLegend(state.crime?.categories);
    notifyHostSize();
  }

  // ── Crime detail (tab or fragment) ────────────────────────────────────────

  async function loadCrimeDetail() {
    if (state.crimeDetail) { renderCrimeDetail("crime-body"); return; }
    if (!state.area) return;
    document.getElementById("crime-loading")?.classList.remove("hidden");
    await callServerTool("area-app-crime", { postcode: state.area.postcode });
    document.getElementById("crime-loading")?.classList.add("hidden");
  }

  function renderCrimeDetail(bodyId, mapId) {
    const el = document.getElementById(bodyId);
    const crime = state.crimeDetail || state.crime;
    if (!el || !crime || !state.area) return;

    el.innerHTML = `
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Crime trend</h2>
          ${crimeAvgChip(crime)}
        </div>
        <div class="section-body">
          <div id="${bodyId}-trend" class="trend-chart"></div>
          <p style="font-size:0.72rem;color:var(--muted);margin-top:8px">
            ${crime.total} incidents in ${fmtMonth(state.month)}
            ${crime.trend ? ` · 3-month view` : ''}
          </p>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title">By category</h2>
          <span class="month-badge">${fmtMonth(state.month)}</span>
        </div>
        <div class="section-body">
          <div id="${bodyId}-bars" class="crime-bar-list"></div>
        </div>
      </div>

      ${crime.outcomes?.length ? `
      <div class="section">
        <div class="section-header"><h2 class="section-title">Outcomes</h2></div>
        <div class="section-body">
          <div id="${bodyId}-outcomes" class="outcome-list"></div>
        </div>
      </div>` : ''}

      ${crime.stopSearch ? `
      <div class="section">
        <div class="section-header"><h2 class="section-title">Stop & search</h2></div>
        <div class="section-body">
          <div class="ss-stat">
            <div class="ss-number">${crime.stopSearch.total}</div>
            <div class="ss-label">Stop and search records this month in this area</div>
          </div>
          ${crime.stopSearch.reasons?.length ? `
          <p style="font-size:0.78rem;font-weight:600;color:var(--muted);margin:0 0 6px;text-transform:uppercase;letter-spacing:0.04em">By object of search</p>
          <div class="outcome-list" id="${bodyId}-ss-reasons"></div>` : ''}
        </div>
      </div>` : ''}

      <p style="font-size:0.7rem;color:var(--muted);padding:4px 0">
        Source: Police UK API · Data is anonymised and location-snapped to the nearest street node.
      </p>
    `;

    if (crime.trend) renderTrendChart(crime.trend, `${bodyId}-trend`);
    renderCrimeBars(crime.categories, `${bodyId}-bars`);

    if (crime.outcomes?.length) {
      const maxOut = crime.outcomes[0].count;
      document.getElementById(`${bodyId}-outcomes`).innerHTML = crime.outcomes.map(o => `
        <div class="outcome-item">
          <span class="outcome-label">${o.label}</span>
          <span class="outcome-count">${o.count}</span>
        </div>
      `).join("");
    }

    if (crime.stopSearch?.reasons?.length) {
      const rsEl = document.getElementById(`${bodyId}-ss-reasons`);
      if (rsEl) {
        rsEl.innerHTML = crime.stopSearch.reasons.map(r => `
          <div class="outcome-item">
            <span class="outcome-label">${r.reason}</span>
            <span class="outcome-count">${r.count}</span>
          </div>
        `).join("");
      }
    }

    // Fragment map
    if (mapId) {
      const map = getOrCreateMap(mapId, state.area.lat, state.area.lng, 14);
      if (map) {
        clearMapLayers(map);
        addCrimeMarkers(map, crime.markers || state.crime?.markers);
        addCentreMarker(map, state.area.lat, state.area.lng, state.area.postcode);
        setTimeout(() => map.invalidateSize(), 100);
      }
    }

    notifyHostSize();
  }

  // ── Flood detail (tab or fragment) ────────────────────────────────────────

  async function loadFloodDetail() {
    if (state.floodDetail) { renderFloodDetail("flood-body"); return; }
    if (!state.area) return;
    document.getElementById("flood-loading")?.classList.remove("hidden");
    await callServerTool("area-app-flood", { postcode: state.area.postcode });
    document.getElementById("flood-loading")?.classList.add("hidden");
  }

  function renderFloodDetail(bodyId, mapId) {
    const el = document.getElementById(bodyId);
    const flood = state.floodDetail || state.flood;
    if (!el || !flood || !state.area) return;

    el.innerHTML = `
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Flood status — ${state.area.county || state.area.district}</h2>
          <span class="risk-badge ${flood.riskLevel}"><span class="risk-dot"></span>${riskLabel(flood.riskLevel)}</span>
        </div>
        <div class="section-body">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            <div class="info-pill ${flood.warnings > 0 ? 'red' : 'green'}">⚠ ${flood.warnings} flood warning${flood.warnings !== 1 ? 's' : ''}</div>
            <div class="info-pill ${flood.alerts > 0 ? 'amber' : 'green'}">🔔 ${flood.alerts} flood alert${flood.alerts !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header"><h2 class="section-title">Active warnings & alerts</h2></div>
        <div class="section-body">
          <div id="${bodyId}-flood-list" class="flood-list"></div>
        </div>
      </div>

      <div class="section">
        <div class="section-header"><h2 class="section-title">Nearby monitoring stations</h2></div>
        <div class="section-body">
          <div id="${bodyId}-stations" class="station-grid"></div>
        </div>
      </div>

      <p style="font-size:0.7rem;color:var(--muted);padding:4px 0">
        Source: Environment Agency Flood Monitoring API · Real-time data. Warnings apply to ${state.area.county || state.area.district} county area.
      </p>
    `;

    renderFloodItems(flood.items, `${bodyId}-flood-list`);
    renderStationCards(flood.stations, `${bodyId}-stations`);

    // Fragment map with station markers
    if (mapId) {
      const map = getOrCreateMap(mapId, state.area.lat, state.area.lng, 11);
      if (map) {
        clearMapLayers(map);
        addFloodStationMarkers(map, flood.stations);
        addCentreMarker(map, state.area.lat, state.area.lng, state.area.postcode);
        setTimeout(() => map.invalidateSize(), 100);
      }
    }

    notifyHostSize();
  }

  // ── Property detail (tab) ─────────────────────────────────────────────────

  async function loadPropertyDetail() {
    if (state.propertyDetail) { renderPropertyDetail("property-body"); return; }
    if (!state.area) return;
    document.getElementById("property-loading")?.classList.remove("hidden");
    const outcode = state.area.postcode.split(/\s+/)[0];
    await callServerTool("area-app-property", { postcode: state.area.postcode });
    document.getElementById("property-loading")?.classList.add("hidden");
    if (!state.propertyDetail) {
      const el = document.getElementById("property-body");
      if (el) el.innerHTML = `<div class="empty-state">Property data unavailable for ${outcode}.</div>`;
    }
  }

  function renderPropertyDetail(bodyId) {
    const el = document.getElementById(bodyId);
    const data = state.propertyDetail;
    if (!el || !data) return;

    const fmtPrice = p => p ? `£${p.toLocaleString('en-GB')}` : 'n/a';
    const maxAvg = data.avgByType?.[0]?.avg || 1;

    el.innerHTML = `
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">House prices — ${data.outcode}</h2>
          <span class="month-badge">Since ${data.since?.slice(0, 7)}</span>
        </div>
        <div class="section-body">
          <div class="price-summary-row">
            <div class="price-summary-card">
              <div class="price-summary-label">Average</div>
              <div class="price-summary-value">${fmtPrice(data.avgPrice)}</div>
            </div>
            <div class="price-summary-card">
              <div class="price-summary-label">Median</div>
              <div class="price-summary-value">${fmtPrice(data.medianPrice)}</div>
            </div>
            <div class="price-summary-card">
              <div class="price-summary-label">Sales recorded</div>
              <div class="price-summary-value">${data.totalCount}</div>
            </div>
          </div>
        </div>
      </div>

      ${data.avgByType?.length ? `
      <div class="section">
        <div class="section-header"><h2 class="section-title">Average by property type</h2></div>
        <div class="section-body">
          <div class="crime-bar-list">
            ${data.avgByType.map(t => `
              <div class="crime-bar-item">
                <span class="crime-bar-label">${t.type}</span>
                <div class="crime-bar-track">
                  <div class="crime-bar-fill" style="width:${Math.round((t.avg / maxAvg) * 100)}%;background:var(--blue)"></div>
                </div>
                <span class="crime-bar-count" style="width:80px;text-align:right;font-size:0.72rem">${fmtPrice(t.avg)}</span>
              </div>
            `).join('')}
          </div>
          <p style="font-size:0.72rem;color:var(--muted);margin-top:10px">Based on ${data.totalCount} sales</p>
        </div>
      </div>` : ''}

      ${data.sales?.length ? `
      <div class="section">
        <div class="section-header"><h2 class="section-title">Recent sales</h2></div>
        <div class="section-body" style="padding:0">
          <div class="sales-table">
            <div class="sales-header-row">
              <span>Postcode</span><span>Date</span><span>Type</span><span>Tenure</span><span>Price</span>
            </div>
            ${data.sales.map(s => `
              <div class="sales-row">
                <span class="sales-pc">${s.postcode}</span>
                <span class="sales-date">${s.date}</span>
                <span class="sales-type">${s.type}</span>
                <span class="sales-tenure">${s.tenure}</span>
                <span class="sales-price">${fmtPrice(s.price)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>` : `<div class="empty-state">No property sales found for ${data.outcode} in the last 2 years.</div>`}

      <p style="font-size:0.7rem;color:var(--muted);padding:4px 0">
        Source: HM Land Registry Price Paid Data · Open Government Licence v3.0
      </p>
    `;

    notifyHostSize();
  }

  // ── Roads detail (tab) ────────────────────────────────────────────────────

  async function loadRoadsDetail() {
    if (state.roadsDetail) { renderRoadsDetail("roads-body"); return; }
    if (!state.area) return;
    document.getElementById("roads-loading")?.classList.remove("hidden");
    await callServerTool("area-app-roads", { postcode: state.area.postcode });
    document.getElementById("roads-loading")?.classList.add("hidden");
    if (!state.roadsDetail) {
      const el = document.getElementById("roads-body");
      if (el) el.innerHTML = `<div class="empty-state">Traffic data unavailable for this area.</div>`;
    }
  }

  function renderRoadsDetail(bodyId) {
    const el = document.getElementById(bodyId);
    const data = state.roadsDetail;
    if (!el || !data) return;

    if (!data.sites?.length) {
      const isError = Boolean(data.error);
      el.innerHTML = `<div class="empty-state${isError ? ' empty-state-error' : ''}">${data.note || 'No National Highways monitoring sites found within 25 km.'}</div>`;
      notifyHostSize();
      return;
    }

    const maxFlow = Math.max(...data.sites.filter(s => s.report?.avgDailyFlow).map(s => s.report.avgDailyFlow), 1);

    el.innerHTML = `
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Nearby road monitoring sites</h2>
          ${data.reportMonth ? `<span class="month-badge">${data.reportMonth}</span>` : ''}
        </div>
        <div class="section-body" style="padding:0">
          ${data.sites.map(s => `
            <div class="road-site-card">
              <div class="road-site-header">
                <div class="road-site-desc">${s.description}</div>
                <span class="road-dist-pill">${s.distKm} km</span>
              </div>
              <div class="road-site-name">${s.name.replace(/^MIDAS site at /, '').replace(/; GPS Ref:.*$/, '')}</div>
              ${s.report ? `
              <div class="road-site-meta">
                ${s.report.level ? `<span class="traffic-level-badge" style="background:${s.report.level.color}1a;color:${s.report.level.color};border:1px solid ${s.report.level.color}40">${s.report.level.label}</span>` : ''}
                <span class="road-data-note">avg. ${s.report.month} — historical</span>
              </div>
              <div class="road-stats-row">
                <div class="road-stat">
                  <div class="road-stat-value">${s.report.avgDailyFlow?.toLocaleString('en-GB') || '—'}</div>
                  <div class="road-stat-label">vehicles/day</div>
                </div>
                <div class="road-stat">
                  <div class="road-stat-value">${s.report.avgLargeVehiclePct ?? '—'}%</div>
                  <div class="road-stat-label">heavy vehicles</div>
                </div>
                <div class="road-stat">
                  <div class="road-stat-value">${s.report.daysRecorded}</div>
                  <div class="road-stat-label">days recorded</div>
                </div>
              </div>
              <div class="road-flow-bar-track">
                <div class="road-flow-bar-fill" style="width:${Math.round((s.report.avgDailyFlow || 0) / maxFlow * 100)}%;background:${s.report.level?.color || 'var(--blue)'}"></div>
              </div>` : `<div class="road-no-data">No traffic data available for this site this month.</div>`}
            </div>
          `).join('')}
        </div>
      </div>

      <p style="font-size:0.7rem;color:var(--muted);padding:4px 0">
        Source: National Highways WebTRIS · Motorway and major A-road sensors only. Data is monthly averages.
      </p>
    `;

    notifyHostSize();
  }

  // ── Fuel prices ───────────────────────────────────────────────────────────

  async function loadFuelDetail() {
    if (state.fuelDetail) { renderFuelDetail("fuel-body"); return; }
    if (!state.area) return;
    document.getElementById("fuel-loading")?.classList.remove("hidden");
    await callServerTool("area-app-fuel", { postcode: state.area.postcode });
    document.getElementById("fuel-loading")?.classList.add("hidden");
    if (!state.fuelDetail) {
      state.fuelDetail = { kind: 'area-fuel', stations: [], error: 'unavailable' };
      renderFuelDetail("fuel-body");
    }
  }

  const FUEL_LABELS = { E10: 'Unleaded E10', E5: 'Premium E5', B7_Standard: 'Diesel', B7_Premium: 'Premium Diesel', B10: 'B10 Bio', HVO: 'HVO' };

  function renderFuelDetail(bodyId) {
    const el = document.getElementById(bodyId);
    const data = state.fuelDetail;
    if (!el || !data) return;

    if (data.error) {
      const msg = data.error === 'credentials_missing'
        ? 'Fuel price data is not configured on this server.'
        : 'Fuel price data is temporarily unavailable — the GOV.UK Fuel Finder API is not yet live. Check back soon.';
      el.innerHTML = `<div class="empty-state">${msg}</div>`;
      notifyHostSize();
      return;
    }

    if (!data.stations?.length) {
      el.innerHTML = `<div class="empty-state">No petrol stations found within 20 km of this postcode.</div>`;
      notifyHostSize();
      return;
    }

    const fuelTypes = ['E10', 'E5', 'B7_Standard', 'B7_Premium'];
    const available = fuelTypes.filter(ft => data.stations.some(s => s.prices[ft] != null));

    const cheapestRow = available.map(ft => {
      const c = data.cheapest?.[ft];
      if (!c) return '';
      return `
        <div class="fuel-cheapest-card">
          <div class="fuel-cheapest-label">Cheapest ${FUEL_LABELS[ft] || ft}</div>
          <div class="fuel-cheapest-price">${c.price}<span class="fuel-cheapest-unit">p/litre</span></div>
          <div class="fuel-cheapest-station">${escHtml(c.name)} · ${c.distKm} km</div>
        </div>
      `;
    }).join('');

    const rows = data.stations.map(s => {
      const prices = available.map(ft =>
        s.prices[ft] != null
          ? `<td class="fuel-price-cell">${s.prices[ft]}p</td>`
          : `<td class="fuel-price-cell fuel-price-na">—</td>`
      ).join('');
      return `
        <tr class="fuel-station-row">
          <td class="fuel-station-name">
            ${escHtml(s.name)}
            ${s.isSupermarket ? '<span class="fuel-badge">Supermarket</span>' : ''}
          </td>
          <td class="fuel-dist">${s.distKm} km</td>
          ${prices}
        </tr>
      `;
    }).join('');

    const headers = available.map(ft => `<th>${FUEL_LABELS[ft] || ft}</th>`).join('');

    el.innerHTML = `
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Cheapest nearby</h2>
        </div>
        <div class="fuel-cheapest-row">${cheapestRow}</div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title">All stations within 5 km</h2>
          <span class="month-badge">${data.stations.length} stations within 20 km</span>
        </div>
        <div class="section-body" style="padding:0;overflow-x:auto">
          <table class="fuel-table">
            <thead>
              <tr>
                <th>Station</th>
                <th>Dist</th>
                ${headers}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <p style="font-size:0.7rem;color:var(--muted);padding:4px 0">
        Source: GOV.UK Fuel Finder · Motor Fuel Price (Open Data) Regulations 2025. Prices in pence per litre.
      </p>
    `;
    notifyHostSize();
  }

  // ── Tab wiring ────────────────────────────────────────────────────────────

  function wireTabNav() {
    document.getElementById("tab-nav")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn[data-tab]");
      if (!btn) return;
      const tab = btn.dataset.tab;
      showTab(tab);
      if (tab === "crime") loadCrimeDetail();
      if (tab === "flood") loadFloodDetail();
      if (tab === "property") loadPropertyDetail();
      if (tab === "roads") loadRoadsDetail();
      if (tab === "fuel") loadFuelDetail();
    });
  }

  // ── Approximate location notice ───────────────────────────────────────────

  function showApproximateNotice(area) {
    let notice = document.getElementById("approximate-notice");
    if (!area?.isApproximate) {
      notice?.remove();
      return;
    }
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "approximate-notice";
      notice.className = "approximate-notice";
      document.getElementById("tab-overview")?.prepend(notice);
    }
    notice.innerHTML = `
      <span class="approx-icon">📍</span>
      <span>Showing results for <strong>${area.placeName}</strong> using nearby postcode <strong>${area.postcode}</strong>
      ${area.localType ? `(${area.localType})` : ''}.
      For precise data, enter a full postcode.</span>
    `;
  }

  // ── Search form ───────────────────────────────────────────────────────────

  function wireSearchForm() {
    const form   = document.getElementById("search-form");
    const input  = document.getElementById("search-input");
    const errEl  = document.getElementById("search-error");
    const submitBtn = form?.querySelector(".search-btn");

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = input?.value?.trim();
      if (!raw) return;
      if (errEl) errEl.classList.add("hidden");
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Searching…"; }

      const result = await app.callServerTool({ name: "area-app-search", arguments: { query: raw } }).catch(() => {
        if (errEl) { errEl.textContent = `Could not find "${raw}". Try a UK postcode (e.g. SW1A 2AA) or place name.`; errEl.classList.remove("hidden"); }
        return null;
      });

      if (result) {
        const payload = result.structuredContent || result.params?.structuredContent;
        if (payload?.kind === "area-overview" && payload.area?.isApproximate) {
          showApproximateNotice(payload.area);
        }
      }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Search"; }
    });

    // Hint chips
    document.querySelectorAll(".hint-chip[data-postcode]").forEach(chip => {
      chip.addEventListener("click", () => {
        if (input) input.value = chip.dataset.postcode;
        form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    });

    wireTabNav();
  }

  return {
    renderOverview,
    renderCrimeDetail,
    renderFloodDetail,
    renderPropertyDetail,
    renderRoadsDetail,
    renderFuelDetail,
    loadCrimeDetail,
    loadFloodDetail,
    loadPropertyDetail,
    loadRoadsDetail,
    loadFuelDetail,
    wireSearchForm,
    showTab,
  };
}
