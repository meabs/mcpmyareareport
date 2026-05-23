// UK Government Open APIs

const POSTCODES_BASE = 'https://api.postcodes.io';
const POLICE_BASE = 'https://data.police.uk/api';
const EA_BASE = 'https://environment.data.gov.uk/flood-monitoring';
const LR_SPARQL = 'https://landregistry.data.gov.uk/landregistry/query';
const WEBTRIS_BASE = 'https://webtris.highwaysengland.co.uk/api/v1.0';
const DFT_API_BASE = 'https://roadtraffic.dft.gov.uk/api';
const FUEL_AUTH_URL = 'https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token';
const FUEL_API_BASE = 'https://www.fuel-finder.service.gov.uk/api';
const DEFAULT_TIMEOUT_MS = 10000;

// Cache the available month so we only query it once per process
let _policeLatestMonth = null;
// Cache WebTRIS sites so we only fetch once per process
let _webtrisSites = null;
// DfT count-points cache (46k local road sensors, national coverage, TTL 24h)
let _dftCountPoints = null;
let _dftCountPointsExpiry = 0;
let _dftLoadPromise = null;
// Fuel Finder OAuth token cache
let _fuelToken = null;
let _fuelTokenExpiry = 0;
let _fuelAuthError = null;
// Fuel station database cache (location + prices joined, TTL 1 hour)
let _fuelDb = null;
let _fuelDbExpiry = 0;
let _fuelDbPromise = null;

async function getLatestPoliceMonth() {
  if (_policeLatestMonth) return _policeLatestMonth;
  try {
    const res = await fetch(`${POLICE_BASE}/crime-last-updated`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (res.ok) {
      const { date } = await res.json();
      // date is "YYYY-MM-DD" — extract YYYY-MM
      _policeLatestMonth = date.slice(0, 7);
      return _policeLatestMonth;
    }
  } catch { /* fall through */ }
  // Fallback: 2 months ago
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthOffset(base, offset) {
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m - 1 - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function geocodePostcode(postcode) {
  const clean = encodeURIComponent(postcode.replace(/\s+/g, '').toUpperCase());
  const res = await fetch(`${POSTCODES_BASE}/postcodes/${clean}`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Postcode not found: ${postcode}`);
  const { result: r } = await res.json();
  return {
    postcode: r.postcode,
    lat: r.latitude,
    lng: r.longitude,
    district: r.admin_district || 'Unknown',
    ward: r.admin_ward || '',
    county: r.admin_county || r.admin_district || '',
    region: r.region || '',
    country: r.country || 'England',
    pfa: r.pfa || '',
  };
}

export const CRIME_LABELS = {
  'anti-social-behaviour': 'Anti-social behaviour',
  'bicycle-theft': 'Bicycle theft',
  'burglary': 'Burglary',
  'criminal-damage-arson': 'Criminal damage & arson',
  'drugs': 'Drugs',
  'other-theft': 'Other theft',
  'possession-of-weapons': 'Weapons possession',
  'public-order': 'Public order',
  'robbery': 'Robbery',
  'shoplifting': 'Shoplifting',
  'theft-from-the-person': 'Theft from person',
  'vehicle-crime': 'Vehicle crime',
  'violent-crime': 'Violence & sexual offences',
  'other-crime': 'Other crime',
};

export const CRIME_COLORS = {
  'violent-crime': '#ef4444',
  'robbery': '#dc2626',
  'anti-social-behaviour': '#f97316',
  'public-order': '#fb923c',
  'drugs': '#a855f7',
  'possession-of-weapons': '#7c3aed',
  'burglary': '#f59e0b',
  'criminal-damage-arson': '#eab308',
  'vehicle-crime': '#3b82f6',
  'theft-from-the-person': '#6366f1',
  'bicycle-theft': '#8b5cf6',
  'shoplifting': '#06b6d4',
  'other-theft': '#64748b',
  'other-crime': '#94a3b8',
};

function crimeColor(cat) { return CRIME_COLORS[cat] || '#94a3b8'; }

async function safeJson(res) {
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function fetchCrimes(lat, lng, month) {
  const res = await fetch(`${POLICE_BASE}/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${month}`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) }).catch(() => null);
  return (res && await safeJson(res)) || [];
}

async function fetchStopSearch(lat, lng, month) {
  const res = await fetch(`${POLICE_BASE}/stops-street?lat=${lat}&lng=${lng}&date=${month}`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) }).catch(() => null);
  return (res && await safeJson(res)) || [];
}

async function fetchFloodAlerts(county) {
  const q = county ? `?county=${encodeURIComponent(county)}` : '';
  const res = await fetch(`${EA_BASE}/id/floods${q}`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) }).catch(() => null);
  const data = (res && await safeJson(res));
  return data?.items || [];
}

async function fetchFloodStations(lat, lng) {
  const res = await fetch(`${EA_BASE}/id/stations?lat=${lat}&long=${lng}&dist=12&_limit=8`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) }).catch(() => null);
  const data = (res && await safeJson(res));
  return data?.items || [];
}

async function fetchStationReading(stationRef) {
  const res = await fetch(`${EA_BASE}/id/stations/${stationRef}/readings?latest`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) }).catch(() => null);
  const data = (res && await safeJson(res));
  const item = data?.items?.[0];
  if (!item) return null;
  return {
    value: typeof item.value === 'number' ? item.value.toFixed(3) : String(item.value),
    unit: item.unitName || 'm',
    dateTime: item.dateTime || null,
  };
}

function categorizeCrimes(crimes) {
  const counts = {};
  for (const c of crimes) counts[c.category] = (counts[c.category] || 0) + 1;
  return Object.entries(counts)
    .map(([id, count]) => ({ id, label: CRIME_LABELS[id] || id, count, color: crimeColor(id) }))
    .sort((a, b) => b.count - a.count);
}

// England & Wales monthly average for a 1-mile radius Police UK query (~6M crimes/yr ÷ 12 ÷ 16k areas)
const NATIONAL_AVG_MONTHLY = 30;

function crimeVsAvg(total) {
  if (total === 0) return 0;
  return Math.round(((total - NATIONAL_AVG_MONTHLY) / NATIONAL_AVG_MONTHLY) * 100);
}

function trafficLevel(avgDailyFlow) {
  if (!avgDailyFlow) return null;
  if (avgDailyFlow >= 70000) return { label: 'Very heavy', color: '#7f1d1d' };
  if (avgDailyFlow >= 40000) return { label: 'Heavy',      color: '#dc2626' };
  if (avgDailyFlow >= 15000) return { label: 'Busy',       color: '#f59e0b' };
  if (avgDailyFlow >= 5000)  return { label: 'Moderate',   color: '#3b82f6' };
  return                              { label: 'Light',     color: '#16a34a' };
}

function floodRisk(warnings, alerts) {
  if (warnings > 0) return 'high';
  if (alerts > 1) return 'medium';
  if (alerts === 1) return 'low';
  return 'none';
}

function severityLabel(severity) {
  return { 1: 'Severe warning', 2: 'Flood warning', 3: 'Flood alert', 4: 'No longer in force' }[severity] || 'Unknown';
}

function severityColor(severity) {
  return { 1: '#7f1d1d', 2: '#dc2626', 3: '#f59e0b', 4: '#94a3b8' }[severity] || '#94a3b8';
}

function toMarkers(crimes) {
  return crimes.slice(0, 120).map(c => ({
    lat: parseFloat(c.location?.latitude),
    lng: parseFloat(c.location?.longitude),
    cat: c.category,
    color: crimeColor(c.category),
  })).filter(m => !isNaN(m.lat) && !isNaN(m.lng));
}

export async function getAreaReport(postcode) {
  const area = await geocodePostcode(postcode);
  const latest = await getLatestPoliceMonth();

  const [crimes0, stopSearch0, floodAlerts, stations, fuel] = await Promise.all([
    fetchCrimes(area.lat, area.lng, latest),
    fetchStopSearch(area.lat, area.lng, latest),
    fetchFloodAlerts(area.county),
    fetchFloodStations(area.lat, area.lng),
    getFuelPrices(area.lat, area.lng).catch(() => ({ kind: 'area-fuel', stations: [], error: 'unavailable' })),
  ]);

  // Sparse-data fallback: try older months in parallel if latest has very few crimes
  let crimes = crimes0;
  let stopSearch = stopSearch0;
  let month = latest;
  if (crimes.length < 10) {
    const extras = await Promise.all(
      [1, 2, 3, 4, 5].map(i => fetchCrimes(area.lat, area.lng, monthOffset(latest, i)))
    );
    const all = [crimes0, ...extras];
    const allMonths = [latest, ...[1,2,3,4,5].map(i => monthOffset(latest, i))];
    const bestIdx = all.reduce((bi, c, i) => c.length > all[bi].length ? i : bi, 0);
    if (bestIdx > 0) {
      crimes = all[bestIdx];
      month = allMonths[bestIdx];
      stopSearch = await fetchStopSearch(area.lat, area.lng, month);
    }
  }

  const categories = categorizeCrimes(crimes);
  const activeWarnings = floodAlerts.filter(f => f.severity === 2 || f.severity === 1).length;
  const activeAlerts = floodAlerts.filter(f => f.severity === 3).length;

  return {
    kind: 'area-overview',
    mode: 'full',
    area,
    month,
    crime: {
      total: crimes.length,
      vsAvg: crimeVsAvg(crimes.length),
      nationalAvg: NATIONAL_AVG_MONTHLY,
      categories: categories.slice(0, 10),
      stopSearch: stopSearch.length,
      markers: toMarkers(crimes),
    },
    flood: {
      riskLevel: floodRisk(activeWarnings, activeAlerts),
      warnings: activeWarnings,
      alerts: activeAlerts,
      total: activeWarnings + activeAlerts,
      items: floodAlerts.slice(0, 8).map(f => ({
        id: f['@id'] || String(Math.random()),
        area: f.description || f.eaAreaName || 'Unknown area',
        severity: f.severity,
        severityLabel: f.severityLevel || severityLabel(f.severity),
        severityColor: severityColor(f.severity),
        message: (f.message || '').slice(0, 240),
        county: f.eaAreaName || '',
        timeRaised: f.timeRaised || null,
      })),
      stations: stations.slice(0, 5).map(s => ({
        id: s.stationReference,
        name: s.label,
        river: s.riverName || 'Unknown river',
        lat: s.lat,
        lng: s.long,
      })),
    },
    fuel,
  };
}

export async function getCrimeDetail(postcode) {
  const area = await geocodePostcode(postcode);
  const latest = await getLatestPoliceMonth();
  const months = [latest, monthOffset(latest, 1), monthOffset(latest, 2)];

  let [m0, m1, m2, stopSearch] = await Promise.all([
    fetchCrimes(area.lat, area.lng, months[0]),
    fetchCrimes(area.lat, area.lng, months[1]),
    fetchCrimes(area.lat, area.lng, months[2]),
    fetchStopSearch(area.lat, area.lng, months[0]),
  ]);

  // Some forces (e.g. GMP) have sparse recent data. Try older months if the latest 3 look empty.
  if (m0.length < 10 && m1.length < 10 && m2.length < 10) {
    const extra = await Promise.all([
      fetchCrimes(area.lat, area.lng, monthOffset(latest, 3)),
      fetchCrimes(area.lat, area.lng, monthOffset(latest, 4)),
      fetchCrimes(area.lat, area.lng, monthOffset(latest, 5)),
    ]);
    const all6 = [m0, m1, m2, ...extra];
    const allMonths6 = [months[0], months[1], months[2],
      monthOffset(latest, 3), monthOffset(latest, 4), monthOffset(latest, 5)];
    // Pick the month with most data as the primary; keep prev/next for trend
    const bestIdx = all6.reduce((bi, arr, i) => arr.length > all6[bi].length ? i : bi, 0);
    const prevIdx = bestIdx > 0 ? bestIdx - 1 : 0;
    const prev2Idx = bestIdx > 1 ? bestIdx - 2 : 0;
    m0 = all6[bestIdx];
    m1 = all6[prevIdx];
    m2 = all6[prev2Idx];
    months[0] = allMonths6[bestIdx];
    months[1] = allMonths6[prevIdx];
    months[2] = allMonths6[prev2Idx];
    stopSearch = await fetchStopSearch(area.lat, area.lng, months[0]);
  }

  const outcomes = {};
  for (const c of m0) {
    const k = c.outcome_status?.category || 'Under investigation';
    outcomes[k] = (outcomes[k] || 0) + 1;
  }

  const stopReasons = {};
  for (const s of stopSearch) {
    const k = s.object_of_search || 'Unknown';
    stopReasons[k] = (stopReasons[k] || 0) + 1;
  }

  return {
    kind: 'area-crime',
    mode: 'crime',
    area,
    month: months[0],
    crime: {
      total: m0.length,
      vsAvg: crimeVsAvg(m0.length),
      nationalAvg: NATIONAL_AVG_MONTHLY,
      categories: categorizeCrimes(m0),
      outcomes: Object.entries(outcomes)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      trend: [
        { month: months[2], total: m2.length },
        { month: months[1], total: m1.length },
        { month: months[0], total: m0.length },
      ],
      markers: toMarkers(m0),
      stopSearch: {
        total: stopSearch.length,
        reasons: Object.entries(stopReasons)
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      },
    },
  };
}

export async function getFloodDetail(postcode) {
  const area = await geocodePostcode(postcode);

  const [floodAlerts, stations] = await Promise.all([
    fetchFloodAlerts(area.county),
    fetchFloodStations(area.lat, area.lng),
  ]);

  const stationsWithReadings = await Promise.all(
    stations.slice(0, 4).map(async s => {
      const reading = await fetchStationReading(s.stationReference).catch(() => null);
      return {
        id: s.stationReference,
        name: s.label,
        river: s.riverName || 'Unknown river',
        lat: s.lat,
        lng: s.long,
        reading,
      };
    })
  );

  const warnings = floodAlerts.filter(f => f.severity <= 2).length;
  const alerts = floodAlerts.filter(f => f.severity === 3).length;

  return {
    kind: 'area-flood',
    mode: 'flood',
    area,
    flood: {
      riskLevel: floodRisk(warnings, alerts),
      warnings,
      alerts,
      total: warnings + alerts,
      items: floodAlerts.map(f => ({
        id: f['@id'] || String(Math.random()),
        area: f.description || f.eaAreaName || 'Unknown area',
        severity: f.severity,
        severityLabel: f.severityLevel || severityLabel(f.severity),
        severityColor: severityColor(f.severity),
        message: (f.message || '').slice(0, 300),
        county: f.eaAreaName || '',
        timeRaised: f.timeRaised || null,
      })),
      stations: stationsWithReadings,
    },
  };
}

// ── Place name / postcode resolution ──────────────────────────────────────────

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE_RE  = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

export async function resolveInputToPostcode(input) {
  const trimmed = input.trim();

  if (POSTCODE_RE.test(trimmed.replace(/\s+/g, ' '))) {
    return { postcode: trimmed.toUpperCase(), isApproximate: false };
  }

  if (OUTCODE_RE.test(trimmed)) {
    try {
      const res = await fetch(`${POSTCODES_BASE}/random/postcodes?outcode=${encodeURIComponent(trimmed.toUpperCase())}`);
      if (res.ok) {
        const { result } = await res.json();
        if (result?.postcode) {
          return { postcode: result.postcode, isApproximate: true, placeName: trimmed.toUpperCase(), outcode: trimmed.toUpperCase() };
        }
      }
    } catch { /* fall through */ }
  }

  // Try as a place name
  try {
    const res = await fetch(`${POSTCODES_BASE}/places?q=${encodeURIComponent(trimmed)}&limit=5`);
    if (res.ok) {
      const { result } = await res.json();
      if (result?.length) {
        const place = result[0];
        const outcode = place.outcode;
        const pcRes = await fetch(`${POSTCODES_BASE}/random/postcodes?outcode=${encodeURIComponent(outcode)}`);
        if (pcRes.ok) {
          const pcData = await pcRes.json();
          if (pcData.result?.postcode) {
            return {
              postcode: pcData.result.postcode,
              isApproximate: true,
              placeName: place.name_1,
              localType: place.local_type || '',
              outcode,
            };
          }
        }
      }
    }
  } catch { /* fall through */ }

  return { postcode: trimmed, isApproximate: false };
}

// ── House price data (Land Registry Price Paid SPARQL) ────────────────────────

const PROP_TYPE_LABELS = {
  'detached': 'Detached',
  'semi-detached': 'Semi-detached',
  'terraced': 'Terraced',
  'flat-maisonette': 'Flat/Maisonette',
  'otherPropertyType': 'Other',
};

function propTypeFromUri(uri) {
  for (const [key, label] of Object.entries(PROP_TYPE_LABELS)) {
    if (uri.includes(key)) return { key, label };
  }
  return { key: 'other', label: 'Other' };
}

export async function getPropertyData(outcode) {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 2);
  const sinceStr = since.toISOString().slice(0, 10);

  const sparql = `PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?price ?date ?postcode ?propType ?tenure
WHERE {
  ?transaction lrppi:pricePaid ?price ;
               lrppi:transactionDate ?date ;
               lrppi:propertyType ?propType ;
               lrppi:estateType ?tenure ;
               lrppi:propertyAddress ?addr .
  ?addr lrcommon:postcode ?postcode .
  FILTER(?date >= "${sinceStr}"^^xsd:date)
  FILTER(STRSTARTS(STR(?postcode), "${outcode}"))
}
ORDER BY DESC(?date)
LIMIT 60`;

  const res = await fetch(LR_SPARQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json' },
    body: sparql,
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);

  if (!res?.ok) return { kind: 'area-property', outcode, sales: [], totalCount: 0, avgPrice: null, medianPrice: null, avgByType: [], since: sinceStr, error: 'unavailable' };

  const data = await res.json().catch(() => null);
  const bindings = data?.results?.bindings || [];

  const sales = bindings.map(b => {
    const pt = propTypeFromUri(b.propType?.value || '');
    return {
      price: parseInt(b.price?.value || '0', 10),
      date: b.date?.value || '',
      postcode: b.postcode?.value || '',
      type: pt.label,
      typeKey: pt.key,
      tenure: (b.tenure?.value || '').includes('leasehold') ? 'Leasehold' : 'Freehold',
    };
  }).filter(s => s.price > 1000);

  const byType = {};
  for (const s of sales) {
    if (!byType[s.type]) byType[s.type] = { total: 0, count: 0 };
    byType[s.type].total += s.price;
    byType[s.type].count++;
  }
  const avgByType = Object.entries(byType)
    .map(([type, d]) => ({ type, avg: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => b.avg - a.avg);

  const prices = sales.map(s => s.price).sort((a, b) => a - b);
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const avgPrice = sales.length ? Math.round(sales.reduce((s, t) => s + t.price, 0) / sales.length) : null;

  return {
    kind: 'area-property',
    outcode,
    sales: sales.slice(0, 20),
    totalCount: sales.length,
    avgPrice,
    medianPrice,
    avgByType,
    since: sinceStr,
  };
}

// ── WebTRIS Highways England traffic data ─────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── DfT road count-points (local A-roads, national, annual AADF survey locations) ──

async function loadDftCountPoints() {
  if (_dftCountPoints && Date.now() < _dftCountPointsExpiry) return _dftCountPoints;
  // deduplicate concurrent calls
  if (_dftLoadPromise) return _dftLoadPromise;

  _dftLoadPromise = (async () => {
    try {
      console.log('[dft-roads] Loading count-points database...');
      // Fetch first page to get total pages
      const first = await fetch(`${DFT_API_BASE}/count-points?per_page=250&page=1`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!first?.ok) return [];
      const firstData = await first.json().catch(() => null);
      if (!firstData?.data) return [];

      const lastPage = firstData.last_page || 1;
      const all = [...firstData.data];

      // Fetch remaining pages in parallel chunks of 20
      const CHUNK = 20;
      for (let start = 2; start <= lastPage; start += CHUNK) {
        const end = Math.min(start + CHUNK - 1, lastPage);
        const pages = await Promise.all(
          Array.from({ length: end - start + 1 }, (_, i) =>
            fetch(`${DFT_API_BASE}/count-points?per_page=250&page=${start + i}`, { signal: AbortSignal.timeout(15000) })
              .then(r => r.ok ? r.json() : null).catch(() => null)
          )
        );
        for (const p of pages) if (p?.data) all.push(...p.data);
      }

      _dftCountPoints = all.map(r => ({
        id: r.count_point_id,
        road: r.road_name,
        category: r.road_category, // PA=Principal A, TM=Motorway, TA=Trunk A
        roadType: r.road_type,
        from: r.start_junction_road_name || '',
        to: r.end_junction_road_name || '',
        lat: parseFloat(r.latitude),
        lng: parseFloat(r.longitude),
        year: r.aadf_year,
        linkKm: parseFloat(r.link_length_km) || null,
      })).filter(r => !isNaN(r.lat) && !isNaN(r.lng));

      _dftCountPointsExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h
      console.log(`[dft-roads] ${_dftCountPoints.length} count-points loaded`);
    } catch (err) {
      console.error('[dft-roads] Load failed:', err.message);
      _dftCountPoints = [];
    } finally {
      _dftLoadPromise = null;
    }
    return _dftCountPoints || [];
  })();

  return _dftLoadPromise;
}

function getDftRoadsNear(lat, lng, radiusKm = 15) {
  if (!_dftCountPoints?.length) return [];
  return _dftCountPoints
    .map(r => ({ ...r, distKm: haversineKm(lat, lng, r.lat, r.lng) }))
    .filter(r => r.distKm <= radiusKm && r.category === 'PA') // PA = local A-roads not in WebTRIS
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 8);
}

function fmtWebtrisDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}${mon}${d.getFullYear()}`;
}

async function fetchWebtrisSites() {
  if (_webtrisSites) return { sites: _webtrisSites };
  const res = await fetch(`${WEBTRIS_BASE}/sites`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res) return { error: 'network', sites: [] };
  if (!res.ok) return { error: `http_${res.status}`, sites: [] };
  const body = await res.json().catch(() => ({ sites: [] }));
  _webtrisSites = (body.sites || []).filter(s => s.Status === 'Active' && s.Latitude && s.Longitude);
  return { sites: _webtrisSites };
}

async function fetchMonthlyReports(nearby, monthOffset) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 0);
  const start = fmtWebtrisDate(monthStart);
  const end   = fmtWebtrisDate(monthEnd);

  return Promise.all(nearby.map(async s => {
    try {
      const url = `${WEBTRIS_BASE}/reports/${start}/to/${end}/Monthly?sites=${s.Id}&page=1&page_size=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!res?.ok) return { site: s, report: null };
      const data = await res.json().catch(() => null);
      const month = data?.MonthCollection?.[0];
      if (!month) return { site: s, report: null };
      const days = (month.Days || []).filter(d => d.FlowValue && !isNaN(parseInt(d.FlowValue)));
      if (!days.length) return { site: s, report: null };
      const avgFlow = Math.round(days.reduce((t, d) => t + parseInt(d.FlowValue), 0) / days.length);
      const avgLarge = parseFloat((days.reduce((t, d) => t + parseFloat(d.LargeVehiclePercentage || 0), 0) / days.length).toFixed(1));
      return { site: s, report: { month: month.Month, avgDailyFlow: avgFlow, avgLargeVehiclePct: avgLarge, daysRecorded: days.length, level: trafficLevel(avgFlow) } };
    } catch { return { site: s, report: null }; }
  }));
}

export async function getHighwaysData(lat, lng) {
  const { sites, error: sitesError } = await fetchWebtrisSites();

  if (sitesError) {
    const status = sitesError.startsWith('http_') ? sitesError.slice(5) : null;
    return {
      kind: 'area-roads', sites: [], reportMonth: null, error: sitesError,
      note: status
        ? `National Highways traffic data service is temporarily unavailable (HTTP ${status}). Please try again later.`
        : 'Could not reach the National Highways traffic data service. Please check your connection and try again.',
    };
  }

  // Try within 50km, take up to 15 candidates (many urban sites have no data so we need more to try)
  let nearby = sites
    .map(s => ({ ...s, distKm: haversineKm(lat, lng, s.Latitude, s.Longitude) }))
    .filter(s => s.distKm <= 50)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 15);

  if (!nearby.length) {
    nearby = sites
      .map(s => ({ ...s, distKm: haversineKm(lat, lng, s.Latitude, s.Longitude) }))
      .filter(s => s.distKm <= 100)
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 10);
  }

  // Always fetch DfT local A-roads in parallel (cached after first load)
  const dftPromise = loadDftCountPoints().then(() => getDftRoadsNear(lat, lng, 15));

  if (!nearby.length) {
    const localRoads = await dftPromise;
    return {
      kind: 'area-roads', sites: [], reportMonth: null,
      localRoads,
      note: 'No National Highways motorway sensors within 100 km. Showing local A-road network from DfT annual survey.',
    };
  }

  // Try last 3 months until we find data (many sites have delayed or missing reports)
  let reports = await fetchMonthlyReports(nearby, 1);
  if (!reports.some(r => r.report)) reports = await fetchMonthlyReports(nearby, 2);
  if (!reports.some(r => r.report)) reports = await fetchMonthlyReports(nearby, 3);

  // Return only sites that have data, up to 6
  const withData = reports.filter(r => r.report);
  const finalReports = withData.length ? withData.slice(0, 6) : reports.slice(0, 6);
  const localRoads = await dftPromise;

  return {
    kind: 'area-roads',
    sites: finalReports.map(r => ({
      id: r.site.Id,
      name: r.site.Name,
      description: r.site.Description,
      lat: r.site.Latitude,
      lng: r.site.Longitude,
      distKm: parseFloat(r.site.distKm.toFixed(1)),
      report: r.report,
    })),
    reportMonth: finalReports.find(r => r.report)?.report?.month || null,
    localRoads,
  };
}

// ── GOV.UK Fuel Finder ───────────────────────────────────────────────────────

async function getFuelToken() {
  if (_fuelToken && Date.now() < _fuelTokenExpiry - 30000) return _fuelToken;
  _fuelAuthError = null;
  const clientId = process.env.FUEL_FINDER_CLIENT_ID;
  const clientSecret = process.env.FUEL_FINDER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch(FUEL_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(10000),
  }).catch(err => { console.error('[fuel-auth] fetch error:', err.message); return null; });

  if (!res) { console.error('[fuel-auth] no response'); return null; }
  if (res.status === 400 || res.status === 401) _fuelAuthError = 'auth_failed';
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[fuel-auth] HTTP ${res.status}:`, body.slice(0, 300));
    return null;
  }
  const json = await res.json().catch(err => { console.error('[fuel-auth] json error:', err.message); return {}; });
  const errorCode = Number(json?.error?.code ?? json?.data?.error?.code ?? json?.message?.code ?? NaN);
  const errorMessage = String(
    json?.message ??
    json?.data?.message ??
    json?.error?.message ??
    json?.data?.error?.message ??
    ''
  ).toLowerCase();
  if (errorCode === 400 || errorCode === 401 || errorMessage.includes('invalid client')) {
    _fuelAuthError = 'auth_failed';
  }
  // Response wrapped: { success, data: { access_token, expires_in, ... } }
  const payload = json.data ?? json;
  const { access_token, expires_in } = payload;
  if (!access_token) { console.error('[fuel-auth] no access_token:', JSON.stringify(json).slice(0, 200)); return null; }
  _fuelToken = access_token;
  _fuelTokenExpiry = Date.now() + (expires_in || 3600) * 1000;
  return _fuelToken;
}

function unwrapFuelData(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  return null;
}

async function fetchFuelBatches(path, token, maxBatches = 30) {
  const results = [];
  for (let batch = 1; batch <= maxBatches; batch++) {
    const res = await fetch(`${FUEL_API_BASE}/v1/${path}?batch-number=${batch}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!res?.ok) {
      if (res?.status && res.status !== 404) {
        const body = await res.text().catch(() => '');
        console.error(`[fuel-api] ${path} batch ${batch} HTTP ${res.status}:`, body.slice(0, 200));
      }
      break;
    }
    const json = await res.json().catch(() => null);
    const data = unwrapFuelData(json);
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 500) break; // last batch
  }
  return results;
}

async function loadFuelDb(token) {
  if (_fuelDb && Date.now() < _fuelDbExpiry) return _fuelDb;
  if (_fuelDbPromise) return _fuelDbPromise;

  _fuelDbPromise = (async () => {
    try {
      console.log('[fuel] Loading station database...');
      const [pfsData, priceData] = await Promise.all([
        fetchFuelBatches('pfs', token),
        fetchFuelBatches('pfs/fuel-prices', token),
      ]);

      if (!pfsData.length || !priceData.length) {
        console.error(`[fuel] Empty upstream response: pfs=${pfsData.length}, prices=${priceData.length}`);
        _fuelDb = null;
        return _fuelDb;
      }

      const locationMap = new Map(pfsData.map(s => [s.node_id, s]));
      const joined = [];
      for (const p of priceData) {
        const info = locationMap.get(p.node_id);
        const lat = parseFloat(info?.location?.latitude);
        const lng = parseFloat(info?.location?.longitude);
        if (!info || isNaN(lat) || isNaN(lng)) continue;
        joined.push({ ...info, _lat: lat, _lng: lng, fuel_prices: p.fuel_prices });
      }

      console.log(`[fuel] ${joined.length} stations loaded`);
      _fuelDb = joined;
      _fuelDbExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
    } catch (err) {
      console.error('[fuel-db] Load failed:', err.message);
      _fuelDb = _fuelDb || null; // keep previous cache if available
    } finally {
      _fuelDbPromise = null;
    }
    return _fuelDb;
  })();

  return _fuelDbPromise;
}

export async function getFuelPrices(lat, lng) {
  const clientId = process.env.FUEL_FINDER_CLIENT_ID;
  const clientSecret = process.env.FUEL_FINDER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { kind: 'area-fuel', stations: [], error: 'credentials_missing' };

  const token = await getFuelToken();
  if (!token) return { kind: 'area-fuel', stations: [], error: _fuelAuthError || 'unavailable' };

  const db = await loadFuelDb(token).catch(err => { console.error('[fuel-db]', err.message); return null; });
  if (!db?.length) return { kind: 'area-fuel', stations: [], error: 'unavailable' };

  const canonicalFuelType = (fuelType) => {
    const key = String(fuelType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const compact = key.replace(/_/g, '');
    if (['E10', 'UNLEADED', 'PETROL', 'REGULAR_UNLEADED', 'STANDARD_UNLEADED'].includes(key)) return 'E10';
    if (['E5', 'SUPER_UNLEADED', 'PREMIUM_UNLEADED', 'SUPER', 'PREMIUM_PETROL'].includes(key)) return 'E5';
    if (['B7', 'B7_STANDARD', 'STANDARD_DIESEL', 'DIESEL'].includes(key) || compact === 'B7STANDARD') return 'B7_STANDARD';
    if (['B7_PREMIUM', 'PREMIUM_DIESEL'].includes(key) || compact === 'B7PREMIUM') return 'B7_PREMIUM';
    if (key === 'B10') return 'B10';
    if (key === 'HVO') return 'HVO';
    return key;
  };

  function parsePrices(fuelPricesArr) {
    if (!Array.isArray(fuelPricesArr)) return {};
    const map = {};
    for (const fp of fuelPricesArr) {
      if (fp.fuel_type && fp.price != null) map[canonicalFuelType(fp.fuel_type)] = Number(fp.price);
    }
    return map;
  }

  function latestUpdate(fuelPricesArr) {
    if (!Array.isArray(fuelPricesArr)) return null;
    return fuelPricesArr.reduce((latest, fp) => {
      const ts = fp.price_last_updated || fp.price_change_effective_timestamp;
      return (!latest || ts > latest) ? ts : latest;
    }, null);
  }

  const SUPERMARKET_NAMES = ['TESCO', 'ASDA', 'SAINSBURY', 'MORRISONS', 'ALDI', 'LIDL', 'COSTCO'];
  const FUEL_TYPES = ['E10', 'E5', 'B7_STANDARD', 'B7_PREMIUM', 'B10', 'HVO'];

  const nearby = db
    .map(s => ({ ...s, distKm: haversineKm(lat, lng, s._lat, s._lng) }))
    .filter(s => s.distKm <= 20)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 20);

  const stations = nearby.map(s => {
    const prices = parsePrices(s.fuel_prices);
    const name = s.trading_name || s.brand_name || 'Unknown';
    const isSupermarket = s.is_supermarket_service_station ||
      SUPERMARKET_NAMES.some(sup => name.toUpperCase().includes(sup));
    return {
      nodeId: s.node_id,
      name,
      brand: s.brand_name || null,
      postcode: s.location?.postcode || null,
      phone: s.public_phone_number || null,
      lat: s._lat,
      lng: s._lng,
      distKm: parseFloat(s.distKm.toFixed(2)),
      prices: Object.fromEntries(
        FUEL_TYPES.filter(ft => prices[ft] != null).map(ft => [ft, prices[ft]])
      ),
      updatedAt: latestUpdate(s.fuel_prices),
      isSupermarket,
    };
  });

  const cheapest = {};
  for (const ft of FUEL_TYPES) {
    const withPrice = stations.filter(s => s.prices[ft] != null);
    if (withPrice.length) {
      const best = withPrice.reduce((a, b) => a.prices[ft] < b.prices[ft] ? a : b);
      cheapest[ft] = { name: best.name, price: best.prices[ft], distKm: best.distKm };
    }
  }

  return { kind: 'area-fuel', stations, cheapest };
}

export function formatToolResultText(kind, payload) {
  if (kind === 'area-overview') {
    const { area, crime, flood, month } = payload;
    const lines = [
      `MyAreaReport — ${area.postcode} (${area.district}) · ${month}`,
      `Crime: ${crime.total} incidents · ${crime.vsAvg >= 0 ? '+' : ''}${crime.vsAvg}% vs E&W avg`,
      `Flood: ${flood.warnings} warnings, ${flood.alerts} alerts`,
      `Top crimes: ${crime.categories.slice(0, 3).map(c => `${c.label} (${c.count})`).join(', ')}`,
    ];
    if (area.isApproximate) lines.push(`Note: Results use nearest postcode for ${area.placeName}.`);
    return lines.join('\n');
  }
  if (kind === 'area-crime') {
    const { area, crime, month } = payload;
    return [
      `Crime analysis — ${area.postcode} (${month}): ${crime.total} incidents`,
      ...crime.categories.slice(0, 5).map(c => `• ${c.label}: ${c.count}`),
      `Stop & search: ${crime.stopSearch?.total ?? 0}`,
    ].join('\n');
  }
  if (kind === 'area-flood') {
    const { area, flood } = payload;
    return [
      `Flood status — ${area.postcode}: ${flood.warnings} warnings, ${flood.alerts} alerts`,
      `${flood.warnings} warnings · ${flood.alerts} alerts`,
      `${flood.stations.length} monitoring stations nearby`,
    ].join('\n');
  }
  if (kind === 'area-property') {
    const { outcode, avgPrice, medianPrice, totalCount, avgByType, since } = payload;
    const fmtPrice = p => p ? `£${p.toLocaleString('en-GB')}` : 'n/a';
    return [
      `House prices — ${outcode} (since ${since})`,
      `Average: ${fmtPrice(avgPrice)} · Median: ${fmtPrice(medianPrice)} · ${totalCount} sales`,
      ...avgByType.slice(0, 4).map(t => `• ${t.type}: ${fmtPrice(t.avg)} (${t.count} sales)`),
    ].join('\n');
  }
  if (kind === 'area-roads') {
    const { sites, reportMonth } = payload;
    const activeSites = sites.filter(s => s.report);
    return [
      `National Highways traffic — ${reportMonth || 'latest month'}`,
      `${sites.length} monitoring sites within 25 km`,
      ...activeSites.slice(0, 3).map(s => `• ${s.description}: ${s.report.avgDailyFlow?.toLocaleString() || 'n/a'} vehicles/day · ${s.report.avgLargeVehiclePct}% HGV`),
    ].join('\n');
  }
  if (kind === 'area-fuel') {
    const { stations, cheapest, error } = payload;
    if (error === 'credentials_missing') return 'Fuel price data: API credentials not configured.';
    if (error === 'auth_failed') return 'Fuel price data: API credentials were rejected by Fuel Finder.';
    if (error === 'unavailable') return 'Fuel price data temporarily unavailable.';
    if (!stations.length) return 'No petrol stations found within 20 km.';
    const lines = [`Fuel prices — ${stations.length} stations within 5 km`];
    if (cheapest?.E10) lines.push(`Cheapest unleaded (E10): ${cheapest.E10.price}p — ${cheapest.E10.name} (${cheapest.E10.distKm} km)`);
    if (cheapest?.B7_STANDARD) lines.push(`Cheapest diesel (B7): ${cheapest.B7_STANDARD.price}p — ${cheapest.B7_STANDARD.name} (${cheapest.B7_STANDARD.distKm} km)`);
    return lines.join('\n');
  }
  return '';
}

// ── Cache warmup (call on server start to avoid cold-start latency) ───────────

export async function warmupCaches() {
  // Fuel DB: ~3s cold load, cached 1h — pre-warm so first user call is instant
  try {
    const token = await getFuelToken();
    if (token) {
      console.log('[warmup] Pre-loading fuel station database...');
      await loadFuelDb(token);
    }
  } catch (err) {
    console.error('[warmup] Fuel pre-load failed:', err.message);
  }
  // DfT roads: ~10s cold load, cached 24h
  loadDftCountPoints().catch(err => console.error('[warmup] DfT roads pre-load failed:', err.message));
}
