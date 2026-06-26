const CENSUS_TIGER_BASE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
const CENSUS_GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder/geographies";
const NWS_BASE = "https://api.weather.gov";
const USGS_BASE = "https://waterservices.usgs.gov/nwis";
const CENSUS_ACS_BASE = "https://api.census.gov/data/2023/acs/acs5";
const FBI_BASE = "https://api.usa.gov/crime/fbi/cde";
const NREL_BASE = "https://developer.nrel.gov/api/alt-fuel-stations/v1";
const EIA_BASE = "https://api.eia.gov/v2/petroleum/pri/gnd/data";
const DEFAULT_TIMEOUT_MS = 10000;

const STATE_ABBR_TO_FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12",
  GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23",
  MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33",
  NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44",
  SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};
const FIPS_TO_STATE_ABBR = Object.fromEntries(Object.entries(STATE_ABBR_TO_FIPS).map(([abbr, fips]) => [fips, abbr]));

const US_ZIP_RE = /^\d{5}(?:-\d{4})?$/;
const CITY_STATE_RE = /^(.+?),\s*([A-Z]{2})$/i;
const CITY_STATE_SPACE_RE = /^([A-Za-z][A-Za-z .'-]+?)\s+([A-Z]{2})$/i;

function fetchOptions(timeout = DEFAULT_TIMEOUT_MS) {
  return {
    signal: AbortSignal.timeout(timeout),
    headers: { "User-Agent": "MyAreaReport/1.0 (garry@myareareport.com)" },
  };
}

async function safeJson(res) {
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function encodeWhere(where) {
  return encodeURIComponent(where);
}

function cleanZip(input) {
  return String(input || "").trim().match(/\d{5}/)?.[0] || "";
}

export function isLikelyUsInput(input) {
  const value = String(input || "").trim();
  if (US_ZIP_RE.test(value)) return true;
  if (CITY_STATE_RE.test(value)) return true;
  const cityStateSpace = value.match(CITY_STATE_SPACE_RE);
  if (cityStateSpace && STATE_ABBR_TO_FIPS[cityStateSpace[2].toUpperCase()]) return true;
  if (/\b(USA|United States)\b/i.test(value)) return true;
  return /\d+\s+.+,\s*[A-Z]{2}\s+\d{5}/i.test(value);
}

async function queryTiger(service, layer, params) {
  const url = `${CENSUS_TIGER_BASE}/${service}/MapServer/${layer}/query?${new URLSearchParams({ f: "json", ...params })}`;
  const res = await fetch(url, fetchOptions()).catch(() => null);
  return safeJson(res);
}

async function countyForPoint(lat, lng) {
  const data = await queryTiger("State_County", "1", {
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NAME,STATE,COUNTY,GEOID",
    returnGeometry: "false",
  });
  const attrs = data?.features?.[0]?.attributes || {};
  return {
    county: attrs.NAME || "",
    stateFips: attrs.STATE || "",
    countyFips: attrs.COUNTY || "",
    countyGeoId: attrs.GEOID || "",
    state: FIPS_TO_STATE_ABBR[attrs.STATE] || "",
  };
}

async function geocodeZip(zip) {
  const data = await queryTiger("tigerWMS_Current", "2", {
    where: `ZCTA5='${zip}'`,
    outFields: "ZCTA5,GEOID,INTPTLAT,INTPTLON",
    returnGeometry: "false",
  });
  const attrs = data?.features?.[0]?.attributes;
  if (!attrs) throw new Error(`US ZIP not found: ${zip}`);
  const lat = Number(attrs.INTPTLAT);
  const lng = Number(attrs.INTPTLON);
  const county = await countyForPoint(lat, lng);
  return usArea({
    label: attrs.ZCTA5,
    lat,
    lng,
    district: attrs.ZCTA5,
    county: county.county,
    region: county.state,
    state: county.state,
    stateFips: county.stateFips,
    countyFips: county.countyFips,
    countyGeoId: county.countyGeoId,
    zip: attrs.ZCTA5,
    source: "Census TIGERweb ZCTA",
  });
}

async function geocodeCityState(city, stateAbbr) {
  const state = stateAbbr.toUpperCase();
  const stateFips = STATE_ABBR_TO_FIPS[state];
  if (!stateFips) throw new Error(`Unsupported US state: ${stateAbbr}`);
  const baseWhere = `UPPER(BASENAME)=UPPER('${city.replace(/'/g, "''")}') AND STATE='${stateFips}'`;
  let data = await queryTiger("Places_CouSub_ConCity_SubMCD", "4", {
    where: baseWhere,
    outFields: "NAME,BASENAME,STATE,PLACE,GEOID,INTPTLAT,INTPTLON",
    returnGeometry: "false",
  });
  if (!data?.features?.length) {
    data = await queryTiger("Places_CouSub_ConCity_SubMCD", "5", {
      where: baseWhere,
      outFields: "NAME,BASENAME,STATE,PLACE,GEOID,INTPTLAT,INTPTLON",
      returnGeometry: "false",
    });
  }
  const attrs = data?.features?.[0]?.attributes;
  if (!attrs) throw new Error(`US place not found: ${city}, ${state}`);
  const lat = Number(attrs.INTPTLAT);
  const lng = Number(attrs.INTPTLON);
  const county = await countyForPoint(lat, lng);
  return usArea({
    label: `${attrs.BASENAME || city}, ${state}`,
    lat,
    lng,
    district: attrs.NAME || attrs.BASENAME || city,
    county: county.county,
    region: state,
    state,
    stateFips,
    countyFips: county.countyFips,
    countyGeoId: county.countyGeoId,
    placeGeoId: attrs.GEOID,
    placeName: attrs.BASENAME || city,
    isApproximate: true,
    localType: "US place centroid",
    source: "Census TIGERweb Places",
  });
}

async function geocodeAddress(input) {
  const url = `${CENSUS_GEOCODER_BASE}/onelineaddress?${new URLSearchParams({
    address: input,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  })}`;
  const res = await fetch(url, fetchOptions()).catch(() => null);
  const data = await safeJson(res);
  const match = data?.result?.addressMatches?.[0];
  if (!match) throw new Error(`US address not found: ${input}`);
  const lat = Number(match.coordinates?.y);
  const lng = Number(match.coordinates?.x);
  const county = await countyForPoint(lat, lng);
  const zip = match.addressComponents?.zip || cleanZip(input);
  return usArea({
    label: zip || match.matchedAddress,
    lat,
    lng,
    district: match.addressComponents?.city || match.matchedAddress,
    county: county.county,
    region: county.state,
    state: county.state,
    stateFips: county.stateFips,
    countyFips: county.countyFips,
    countyGeoId: county.countyGeoId,
    zip,
    source: "U.S. Census Geocoder",
  });
}

function usArea(data) {
  return {
    postcode: data.label,
    lat: data.lat,
    lng: data.lng,
    district: data.district || data.label,
    ward: "",
    county: data.county || "",
    region: data.region || data.state || "",
    country: "United States",
    countryCode: "US",
    pfa: "",
    state: data.state || data.region || "",
    stateFips: data.stateFips || "",
    countyFips: data.countyFips || "",
    countyGeoId: data.countyGeoId || "",
    placeGeoId: data.placeGeoId || "",
    zip: data.zip || cleanZip(data.label),
    isApproximate: Boolean(data.isApproximate),
    placeName: data.placeName || "",
    outcode: data.zip || cleanZip(data.label),
    localType: data.localType || "",
    source: data.source,
  };
}

export async function resolveUsInput(input) {
  const value = String(input || "").trim();
  if (US_ZIP_RE.test(value)) return geocodeZip(cleanZip(value));
  const cityState = value.match(CITY_STATE_RE);
  if (cityState) return geocodeCityState(cityState[1].trim(), cityState[2].trim());
  const cityStateSpace = value.match(CITY_STATE_SPACE_RE);
  if (cityStateSpace && STATE_ABBR_TO_FIPS[cityStateSpace[2].toUpperCase()]) {
    return geocodeCityState(cityStateSpace[1].trim(), cityStateSpace[2].trim());
  }
  return geocodeAddress(value);
}

function usFuelUnavailable(reason = "credentials_missing") {
  return { kind: "area-fuel", status: "unavailable", reason, stations: [], cheapest: {}, error: reason };
}

async function getNwsAlerts(area) {
  const res = await fetch(`${NWS_BASE}/alerts/active?point=${area.lat},${area.lng}`, fetchOptions()).catch(() => null);
  const data = await safeJson(res);
  const features = data?.features || [];
  return features.slice(0, 10).map((f, index) => ({
    id: f.id || f.properties?.id || `nws-${index}`,
    area: f.properties?.areaDesc || f.properties?.event || "NWS alert",
    severity: f.properties?.severity === "Extreme" ? 1 : f.properties?.severity === "Severe" ? 2 : 3,
    severityLabel: f.properties?.event || f.properties?.severity || "Weather alert",
    severityColor: f.properties?.severity === "Extreme" ? "#7f1d1d" : f.properties?.severity === "Severe" ? "#dc2626" : "#f59e0b",
    message: String(f.properties?.description || f.properties?.headline || "").slice(0, 300),
    county: area.county || "",
    timeRaised: f.properties?.sent || f.properties?.effective || null,
  }));
}

function parseRdb(text) {
  const lines = String(text || "").split(/\r?\n/).filter(line => line && !line.startsWith("#"));
  if (lines.length < 3) return [];
  const header = lines[0].split("\t");
  return lines.slice(2).map(line => {
    const cols = line.split("\t");
    return Object.fromEntries(header.map((key, i) => [key, cols[i] || ""]));
  });
}

async function getUsgsStations(area) {
  const delta = 0.22;
  const bbox = `${area.lng - delta},${area.lat - delta},${area.lng + delta},${area.lat + delta}`;
  const url = `${USGS_BASE}/site/?${new URLSearchParams({
    format: "rdb",
    bBox: bbox,
    siteType: "ST",
    hasDataTypeCd: "iv",
    parameterCd: "00065,00060",
    siteStatus: "active",
  })}`;
  const res = await fetch(url, fetchOptions(15000)).catch(() => null);
  if (!res?.ok) return [];
  const rows = parseRdb(await res.text());
  return rows
    .map(row => ({
      id: row.site_no,
      name: row.station_nm,
      river: row.station_nm,
      lat: Number(row.dec_lat_va),
      lng: Number(row.dec_long_va),
      distKm: haversineKm(area.lat, area.lng, Number(row.dec_lat_va), Number(row.dec_long_va)),
    }))
    .filter(s => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 5);
}

async function addUsgsReadings(stations) {
  return Promise.all(stations.map(async station => {
    const url = `${USGS_BASE}/iv/?${new URLSearchParams({
      format: "json",
      sites: station.id,
      parameterCd: "00065,00060",
      siteStatus: "active",
    })}`;
    const res = await fetch(url, fetchOptions()).catch(() => null);
    const data = await safeJson(res);
    const series = data?.value?.timeSeries || [];
    const latest = series.flatMap(s => s.values?.[0]?.value || [])[0];
    return {
      ...station,
      reading: latest ? {
        value: latest.value,
        unit: series[0]?.variable?.unit?.unitCode || "",
        dateTime: latest.dateTime || null,
      } : null,
    };
  }));
}

export async function getUsFloodDetail(input) {
  const area = typeof input === "object" ? input : await resolveUsInput(input);
  const [alerts, stationBase] = await Promise.all([getNwsAlerts(area), getUsgsStations(area)]);
  const stations = await addUsgsReadings(stationBase);
  const warnings = alerts.filter(a => a.severity <= 2).length;
  const alertCount = alerts.length - warnings;
  return {
    kind: "area-flood",
    mode: "flood",
    area,
    flood: {
      riskLevel: warnings ? "high" : alertCount ? "medium" : "none",
      warnings,
      alerts: alertCount,
      total: alerts.length,
      items: alerts,
      stations,
      source: "National Weather Service and USGS Water Data",
      caveat: "NWS alerts are current watches, warnings, and advisories. USGS readings are monitoring-station observations, not forecasts.",
    },
  };
}

function blankCrime(area, reason = "credentials_missing") {
  return {
    kind: "area-crime",
    mode: "crime",
    area,
    month: String(new Date().getFullYear() - 1),
    crime: {
      total: 0,
      vsAvg: 0,
      nationalAvg: 0,
      categories: [],
      outcomes: [],
      trend: [],
      markers: [],
      stopSearch: { total: 0, reasons: [] },
      status: "unavailable",
      reason,
      source: "FBI Crime Data API",
      caveat: "USA crime data is reported by agency/city/county/state and is not UK-style street-level incident data.",
    },
  };
}

export async function getUsCrimeDetail(input) {
  const area = typeof input === "object" ? input : await resolveUsInput(input);
  const key = process.env.FBI_API_KEY || process.env.DATA_GOV_API_KEY || "";
  if (!key || !area.state) return blankCrime(area);
  const end = new Date().getFullYear() - 1;
  const start = end - 4;
  const res = await fetch(`${FBI_BASE}/estimates/states/${area.state}?from=${start}&to=${end}&API_KEY=${encodeURIComponent(key)}`, fetchOptions()).catch(() => null);
  const data = await safeJson(res);
  const rows = data?.results || data?.data || [];
  if (!rows.length) return blankCrime(area, "upstream_unavailable");
  const latest = rows[rows.length - 1] || {};
  const categories = [
    ["violent-crime", "Violent crime", latest.violent_crime],
    ["burglary", "Burglary", latest.burglary],
    ["vehicle-crime", "Motor vehicle theft", latest.motor_vehicle_theft],
    ["robbery", "Robbery", latest.robbery],
    ["other-theft", "Larceny theft", latest.larceny],
  ].map(([id, label, count]) => ({ id, label, count: Number(count || 0), color: "#64748b" })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
  return {
    kind: "area-crime",
    mode: "crime",
    area,
    month: String(latest.year || end),
    crime: {
      total: Number(latest.violent_crime || 0) + Number(latest.property_crime || 0),
      vsAvg: 0,
      nationalAvg: 0,
      categories,
      outcomes: [],
      trend: rows.slice(-5).map(r => ({ month: String(r.year), total: Number(r.violent_crime || 0) + Number(r.property_crime || 0) })),
      markers: [],
      stopSearch: { total: 0, reasons: [] },
      source: "FBI Crime Data API",
      caveat: "State-level FBI reported crime trends; not street-level incident data.",
    },
  };
}

async function getAcsHousing(area) {
  const key = process.env.CENSUS_API_KEY || "";
  if (!key || !area.zip) return null;
  const params = new URLSearchParams({
    get: "NAME,B25077_001E,B25064_001E,B01003_001E,B25003_002E,B25003_003E",
    for: `zip code tabulation area:${area.zip}`,
    key,
  });
  const res = await fetch(`${CENSUS_ACS_BASE}?${params}`, fetchOptions()).catch(() => null);
  const data = await safeJson(res);
  if (!Array.isArray(data) || data.length < 2) return null;
  const [headers, values] = data;
  const row = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  return {
    name: row.NAME,
    medianHomeValue: Number(row.B25077_001E) || null,
    medianRent: Number(row.B25064_001E) || null,
    population: Number(row.B01003_001E) || null,
    ownerOccupied: Number(row.B25003_002E) || null,
    renterOccupied: Number(row.B25003_003E) || null,
  };
}

export async function getUsPropertyData(input) {
  const area = typeof input === "object" ? input : await resolveUsInput(input);
  const acs = await getAcsHousing(area);
  return {
    kind: "area-property",
    mode: "property",
    area,
    outcode: area.zip || area.postcode,
    sales: [],
    totalCount: acs?.population || 0,
    avgPrice: acs?.medianHomeValue || null,
    medianPrice: acs?.medianHomeValue || null,
    avgByType: [
      acs?.medianHomeValue ? { type: "Median home value", avg: acs.medianHomeValue, count: 1 } : null,
      acs?.medianRent ? { type: "Median gross rent", avg: acs.medianRent, count: 1 } : null,
    ].filter(Boolean),
    since: "ACS 5-year",
    source: "U.S. Census ACS 5-year",
    caveat: "USA housing figures are Census indicators, not recent individual sale records.",
    error: acs ? undefined : "credentials_missing",
  };
}

export async function getUsRoadsData(input) {
  const area = typeof input === "object" ? input : await resolveUsInput(input);
  const query = `[out:json][timeout:10];(way(around:8000,${area.lat},${area.lng})[\"highway\"~\"^(motorway|trunk|primary|secondary)$\"];);out center tags 20;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MyAreaReport/1.0 (garry@myareareport.com)" },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const data = await safeJson(res);
  const sites = (data?.elements || []).slice(0, 8).map((el, index) => ({
    id: String(el.id || index),
    name: el.tags?.name || el.tags?.ref || "Nearby road",
    description: [el.tags?.ref, el.tags?.name, el.tags?.highway].filter(Boolean).join(" · "),
    lat: el.center?.lat,
    lng: el.center?.lon,
    distKm: el.center ? Number(haversineKm(area.lat, area.lng, el.center.lat, el.center.lon).toFixed(1)) : 0,
    report: null,
  })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  return {
    kind: "area-roads",
    mode: "roads",
    area,
    sites,
    reportMonth: null,
    localRoads: [],
    source: "OpenStreetMap Overpass API",
    note: "USA v1 shows nearby major-road context. National traffic counts are not yet available with UK-style consistency.",
  };
}

export async function getUsFuelData(input) {
  const area = typeof input === "object" ? input : await resolveUsInput(input);
  const eiaKey = process.env.EIA_API_KEY || "DEMO_KEY";
  const nrelKey = process.env.NREL_API_KEY || "";
  let fuelPrice = null;
  const eiaRes = await fetch(`${EIA_BASE}?${new URLSearchParams({
    api_key: eiaKey,
    frequency: "weekly",
    "data[0]": "value",
    "facets[series][]": "EMM_EPM0_PTE_NUS_DPG",
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "1",
  })}`, fetchOptions()).catch(() => null);
  const eiaData = await safeJson(eiaRes);
  const eiaRow = eiaData?.response?.data?.[0];
  if (eiaRow?.value) fuelPrice = { name: "U.S. weekly average gasoline", price: Number(eiaRow.value), period: eiaRow.period, distKm: 0 };

  let stations = [];
  if (nrelKey) {
    const nrelRes = await fetch(`${NREL_BASE}/nearest.json?${new URLSearchParams({
      api_key: nrelKey,
      latitude: String(area.lat),
      longitude: String(area.lng),
      radius: "10",
      limit: "10",
    })}`, fetchOptions()).catch(() => null);
    const nrelData = await safeJson(nrelRes);
    stations = (nrelData?.fuel_stations || []).map(s => ({
      nodeId: String(s.id),
      name: s.station_name || "Alternative fuel station",
      brand: s.fuel_type_code || null,
      postcode: s.zip || null,
      phone: s.station_phone || null,
      lat: Number(s.latitude),
      lng: Number(s.longitude),
      distKm: Number(s.distance || 0),
      prices: {},
      updatedAt: s.updated_at || null,
      isSupermarket: false,
      fuelTypes: s.fuel_type_code || "",
    }));
  }

  if (!fuelPrice && !stations.length) return usFuelUnavailable("credentials_missing");
  return {
    kind: "area-fuel",
    mode: "fuel",
    area,
    status: "ok",
    stations,
    cheapest: fuelPrice ? { E10: fuelPrice } : {},
    source: "EIA Open Data and NREL Alternative Fuel Stations",
    caveat: "USA v1 shows regional gasoline price trends and alternative-fuel station locations, not live petrol station prices.",
  };
}

export async function getUsAreaReport(input) {
  const area = await resolveUsInput(input);
  const [flood, crime, fuel] = await Promise.all([
    getUsFloodDetail(area).catch(() => ({ flood: { riskLevel: "none", warnings: 0, alerts: 0, total: 0, items: [], stations: [] } })),
    getUsCrimeDetail(area).catch(() => blankCrime(area)),
    getUsFuelData(area).catch(() => usFuelUnavailable("upstream_unavailable")),
  ]);
  return {
    kind: "area-overview",
    mode: "full",
    area,
    month: crime.month || String(new Date().getFullYear()),
    crime: crime.crime,
    flood: flood.flood,
    fuel,
    sources: ["U.S. Census", "National Weather Service", "USGS", "FBI Crime Data API", "EIA", "NREL", "OpenStreetMap"],
    caveat: "USA data sources are national summaries/alerts and do not always match UK street-level coverage.",
  };
}

export function formatUsToolResultText(kind, payload) {
  if (kind === "area-overview") {
    const { area, crime, flood } = payload;
    return [
      `MyAreaReport USA — ${area.postcode} (${area.district}, ${area.region})`,
      `Weather/flood alerts: ${flood.warnings} warnings, ${flood.alerts} advisories`,
      `Crime: ${crime.status === "unavailable" ? "reported crime trend unavailable without FBI API key" : `${crime.total.toLocaleString("en-US")} reported state-level crimes`}`,
      `Fuel/charging: ${payload.fuel?.status === "ok" ? "regional fuel or alternative-fuel data available" : "data unavailable"}`,
      "Note: USA data is not UK-style street-level coverage.",
    ].join("\n");
  }
  if (kind === "area-crime") {
    const { area, crime, month } = payload;
    return [
      `USA crime trends — ${area.postcode} (${area.district}, ${area.region}) · ${month}`,
      crime.status === "unavailable"
        ? "Reported crime trend data is unavailable without an FBI/data.gov API key or for this geography."
        : `${crime.total.toLocaleString("en-US")} reported state-level records in the latest year.`,
      ...(crime.categories || []).slice(0, 5).map(c => `• ${c.label}: ${c.count.toLocaleString("en-US")}`),
      crime.caveat || "USA crime data is not UK-style street-level incident data.",
    ].join("\n");
  }
  if (kind === "area-flood") {
    const { area, flood } = payload;
    return [
      `USA weather/flood status — ${area.postcode} (${area.district}, ${area.region})`,
      `${flood.warnings} severe/extreme warnings · ${flood.alerts} other active advisories`,
      `${flood.stations?.length ?? 0} nearby USGS monitoring stations`,
      flood.caveat || "Use official NWS/USGS sources for safety-critical decisions.",
    ].join("\n");
  }
  if (kind === "area-property") {
    const { area, avgPrice, totalCount, source, caveat } = payload;
    return [
      `USA housing indicators — ${area.postcode} (${area.district}, ${area.region})`,
      avgPrice ? `Median home value indicator: $${avgPrice.toLocaleString("en-US")}` : "Housing value indicator unavailable without Census API key or for this geography.",
      totalCount ? `Population indicator: ${totalCount.toLocaleString("en-US")}` : "",
      `Source: ${source || "U.S. Census"}`,
      caveat || "USA housing figures are Census indicators, not recent individual sale records.",
    ].filter(Boolean).join("\n");
  }
  if (kind === "area-roads") {
    const { area, sites = [], note } = payload;
    return [
      `USA road context — ${area.postcode} (${area.district}, ${area.region})`,
      `${sites.length} nearby major-road features from public mapping data`,
      ...sites.slice(0, 3).map(s => `• ${s.description || s.name}: ${s.distKm} km`),
      note || "USA v1 does not provide national UK-style traffic counts.",
    ].join("\n");
  }
  if (kind === "area-fuel") {
    const latest = payload.cheapest?.E10;
    return [
      `USA fuel/charging context — ${payload.area?.postcode || "area"}`,
      latest ? `Latest EIA gasoline indicator: $${latest.price}/gal (${latest.period || "latest"})` : "Regional gasoline price unavailable.",
      `${payload.stations?.length ?? 0} alternative-fuel stations returned where NREL API key is configured.`,
      payload.caveat || "USA v1 does not provide live station-level petrol prices.",
    ].join("\n");
  }
  return "";
}
