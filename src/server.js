import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  getAreaReport,
  getCrimeDetail,
  getFloodDetail,
  getPropertyData,
  getHighwaysData,
  getFuelPrices,
  geocodePostcode,
  resolveInputToPostcode,
  formatToolResultText,
  warmupCaches,
} from "./area-data.js";

// Pre-warm caches on startup (non-blocking)
warmupCaches().catch(() => {});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const RESOURCE_URI = "ui://myareareport/app.html";

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const S_AREA = {
  type: "object",
  properties: {
    postcode:      { type: "string" },
    lat:           { type: "number" },
    lng:           { type: "number" },
    district:      { type: "string" },
    ward:          { type: "string" },
    county:        { type: "string" },
    region:        { type: "string" },
    country:       { type: "string" },
    pfa:           { type: "string" },
    isApproximate: { type: "boolean" },
    placeName:     { type: "string" },
    outcode:       { type: "string" },
    localType:     { type: "string" },
  },
  required: ["postcode", "lat", "lng", "district"],
};

const S_CRIME_CAT = {
  type: "object",
  properties: {
    id:    { type: "string" },
    label: { type: "string" },
    count: { type: "integer" },
    color: { type: "string" },
  },
  required: ["id", "label", "count"],
};

const S_CRIME_MARKER = {
  type: "object",
  properties: {
    lat:   { type: "number" },
    lng:   { type: "number" },
    cat:   { type: "string" },
    color: { type: "string" },
  },
};

const S_FLOOD_ITEM = {
  type: "object",
  properties: {
    id:            { type: "string" },
    area:          { type: "string" },
    severity:      { type: "integer" },
    severityLabel: { type: "string" },
    severityColor: { type: "string" },
    message:       { type: "string" },
    county:        { type: "string" },
    timeRaised:    { type: ["string", "null"] },
  },
};

const S_FUEL_STATION = {
  type: "object",
  properties: {
    nodeId:        { type: "string" },
    name:          { type: "string" },
    brand:         { type: ["string", "null"] },
    postcode:      { type: ["string", "null"] },
    phone:         { type: ["string", "null"] },
    lat:           { type: "number" },
    lng:           { type: "number" },
    distKm:        { type: "number" },
    prices: {
      type: "object",
      properties: {
        E10:        { type: "number" },
        E5:         { type: "number" },
        B7_STANDARD:{ type: "number" },
        B7_PREMIUM: { type: "number" },
        B10:        { type: "number" },
        HVO:        { type: "number" },
      },
    },
    updatedAt:     { type: ["string", "null"] },
    isSupermarket: { type: "boolean" },
  },
};

const S_CHEAPEST_ENTRY = {
  type: "object",
  properties: {
    name:   { type: "string" },
    price:  { type: "number" },
    distKm: { type: "number" },
  },
};

const S_FUEL_SUMMARY = {
  type: "object",
  required: ["kind", "stations"],
  properties: {
    kind:     { type: "string", const: "area-fuel" },
    area:     S_AREA,
    stations: { type: "array", items: S_FUEL_STATION },
    cheapest: {
      type: "object",
      properties: {
        E10:         S_CHEAPEST_ENTRY,
        E5:          S_CHEAPEST_ENTRY,
        B7_STANDARD: S_CHEAPEST_ENTRY,
        B7_PREMIUM:  S_CHEAPEST_ENTRY,
      },
    },
    error: { type: "string", enum: ["credentials_missing", "auth_failed", "unavailable"] },
  },
};

// ── Per-tool output schemas ───────────────────────────────────────────────────

const OUT_OVERVIEW = {
  type: "object",
  required: ["kind", "area", "month", "crime", "flood", "fuel"],
  properties: {
    kind:  { type: "string", const: "area-overview" },
    mode:  { type: "string" },
    area:  S_AREA,
    month: { type: "string", description: "YYYY-MM" },
    crime: {
      type: "object",
      required: ["total", "vsAvg", "categories"],
      properties: {
        total:       { type: "integer" },
        vsAvg:       { type: "integer", description: "% vs England & Wales monthly average" },
        nationalAvg: { type: "integer" },
        categories:  { type: "array", items: S_CRIME_CAT },
        stopSearch:  { type: "integer" },
        markers:     { type: "array", items: S_CRIME_MARKER },
      },
    },
    flood: {
      type: "object",
      required: ["riskLevel", "warnings", "alerts"],
      properties: {
        riskLevel: { type: "string", enum: ["none", "low", "medium", "high"] },
        warnings:  { type: "integer" },
        alerts:    { type: "integer" },
        total:     { type: "integer" },
        items:     { type: "array", items: S_FLOOD_ITEM },
        stations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }, name: { type: "string" },
              river: { type: "string" }, lat: { type: "number" }, lng: { type: "number" },
            },
          },
        },
      },
    },
    fuel: S_FUEL_SUMMARY,
  },
};

const OUT_CRIME = {
  type: "object",
  required: ["kind", "area", "month", "crime"],
  properties: {
    kind:  { type: "string", const: "area-crime" },
    area:  S_AREA,
    month: { type: "string" },
    crime: {
      type: "object",
      required: ["total", "vsAvg", "categories"],
      properties: {
        total:       { type: "integer" },
        vsAvg:       { type: "integer" },
        nationalAvg: { type: "integer" },
        categories:  { type: "array", items: S_CRIME_CAT },
        outcomes: {
          type: "array",
          items: { type: "object", properties: { label: { type: "string" }, count: { type: "integer" } } },
        },
        trend: {
          type: "array",
          items: { type: "object", properties: { month: { type: "string" }, total: { type: "integer" } } },
        },
        markers: { type: "array", items: S_CRIME_MARKER },
        stopSearch: {
          type: "object",
          properties: {
            total: { type: "integer" },
            reasons: {
              type: "array",
              items: { type: "object", properties: { reason: { type: "string" }, count: { type: "integer" } } },
            },
          },
        },
      },
    },
  },
};

const OUT_FLOOD = {
  type: "object",
  required: ["kind", "area", "flood"],
  properties: {
    kind: { type: "string", const: "area-flood" },
    area: S_AREA,
    flood: {
      type: "object",
      required: ["riskLevel", "warnings", "alerts"],
      properties: {
        riskLevel: { type: "string", enum: ["none", "low", "medium", "high"] },
        warnings:  { type: "integer" },
        alerts:    { type: "integer" },
        total:     { type: "integer" },
        items:     { type: "array", items: S_FLOOD_ITEM },
        stations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }, name: { type: "string" },
              river: { type: "string" }, lat: { type: "number" }, lng: { type: "number" },
              reading: {
                type: ["object", "null"],
                properties: {
                  value: { type: "string" }, unit: { type: "string" },
                  dateTime: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
  },
};

const OUT_PROPERTY = {
  type: "object",
  required: ["kind", "outcode"],
  properties: {
    kind:        { type: "string", const: "area-property" },
    outcode:     { type: "string" },
    area:        S_AREA,
    sales: {
      type: "array",
      items: {
        type: "object",
        properties: {
          price:   { type: "integer" }, date: { type: "string" },
          postcode:{ type: "string" }, type: { type: "string" },
          typeKey: { type: "string" }, tenure: { type: "string" },
        },
      },
    },
    totalCount:  { type: "integer" },
    avgPrice:    { type: ["integer", "null"] },
    medianPrice: { type: ["integer", "null"] },
    avgByType: {
      type: "array",
      items: {
        type: "object",
        properties: { type: { type: "string" }, avg: { type: "integer" }, count: { type: "integer" } },
      },
    },
    since: { type: "string" },
    error: { type: "string" },
  },
};

const OUT_ROADS = {
  type: "object",
  required: ["kind", "sites"],
  properties: {
    kind: { type: "string", const: "area-roads" },
    area: S_AREA,
    sites: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" },
          description: { type: "string" }, lat: { type: "number" }, lng: { type: "number" },
          distKm: { type: "number" },
          report: {
            type: ["object", "null"],
            properties: {
              month:              { type: "string" },
              avgDailyFlow:       { type: "integer" },
              avgLargeVehiclePct: { type: "number" },
              daysRecorded:       { type: "integer" },
              level: {
                type: ["object", "null"],
                properties: { label: { type: "string" }, color: { type: "string" } },
              },
            },
          },
        },
      },
    },
    reportMonth: { type: ["string", "null"] },
    note:        { type: "string" },
    error:       { type: "string", description: "Set when the upstream API failed, e.g. http_502" },
    localRoads: {
      type: "array",
      description: "DfT annual count-point survey locations for Principal A-roads (local authority managed) near the postcode",
      items: {
        type: "object",
        properties: {
          id:      { type: "integer" },
          road:    { type: "string" },
          category:{ type: "string", description: "PA=Principal A-road, TM=Motorway, TA=Trunk A" },
          from:    { type: "string" },
          to:      { type: "string" },
          distKm:  { type: "number" },
          year:    { type: ["integer", "null"] },
          linkKm:  { type: ["number", "null"] },
        },
      },
    },
  },
};

const OUT_FUEL = {
  type: "object",
  required: ["kind", "stations"],
  properties: {
    kind:     { type: "string", const: "area-fuel" },
    area:     S_AREA,
    stations: { type: "array", items: S_FUEL_STATION },
    cheapest: {
      type: "object",
      properties: {
        E10:        S_CHEAPEST_ENTRY,
        E5:         S_CHEAPEST_ENTRY,
        B7_STANDARD:S_CHEAPEST_ENTRY,
        B7_PREMIUM: S_CHEAPEST_ENTRY,
      },
    },
    error: { type: "string", enum: ["credentials_missing", "auth_failed", "unavailable"] },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBundledAppHtml() {
  for (const p of [
    path.join(DIST_DIR, "mcp-app.html"),
    path.join(DIST_DIR, "src", "mcp-app.html"),
  ]) {
    try { return await fs.readFile(p, "utf8"); } catch (e) {
      if (e?.code !== "ENOENT") throw e;
    }
  }
  throw new Error("Bundled HTML not found — run `npm run build` first.");
}

const HINTS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const UI_DOMAIN = process.env.MCP_APP_UI_DOMAIN || "https://mcp.myareareport.com";
const UI_CONNECT_DOMAINS = [...new Set(["https://mcp.myareareport.com", UI_DOMAIN])];
const UI_RESOURCE_META = {
  ui: {
    domain: UI_DOMAIN,
    csp: {
      connectDomains: UI_CONNECT_DOMAINS,
      resourceDomains: [],
    },
  },
  "openai/widgetDomain": UI_DOMAIN,
};

const Z_AREA = z.object({
  postcode: z.string(),
  lat: z.number(),
  lng: z.number(),
  district: z.string(),
}).passthrough();
const Z_CRIME_SUMMARY = z.object({
  total: z.number().int(),
  vsAvg: z.number().int(),
  categories: z.array(z.object({ id: z.string(), label: z.string(), count: z.number().int() }).passthrough()),
}).passthrough();
const Z_FLOOD_SUMMARY = z.object({
  riskLevel: z.enum(["none", "low", "medium", "high"]),
  warnings: z.number().int(),
  alerts: z.number().int(),
}).passthrough();
const Z_FUEL_SUMMARY = z.object({
  kind: z.literal("area-fuel"),
  stations: z.array(z.object({
    nodeId: z.string(),
    name: z.string(),
    distKm: z.number(),
    prices: z.record(z.string(), z.number()),
  }).passthrough()),
}).passthrough();

const Z_OUT_OVERVIEW = z.object({
  kind: z.literal("area-overview"),
  area: Z_AREA,
  month: z.string(),
  crime: Z_CRIME_SUMMARY,
  flood: Z_FLOOD_SUMMARY,
  fuel: Z_FUEL_SUMMARY,
}).passthrough();
const Z_OUT_CRIME = z.object({
  kind: z.literal("area-crime"),
  area: Z_AREA,
  month: z.string(),
  crime: Z_CRIME_SUMMARY,
}).passthrough();
const Z_OUT_FLOOD = z.object({
  kind: z.literal("area-flood"),
  area: Z_AREA,
  flood: Z_FLOOD_SUMMARY,
}).passthrough();
const Z_OUT_PROPERTY = z.object({
  kind: z.literal("area-property"),
  outcode: z.string(),
  sales: z.array(z.object({ price: z.number().int(), date: z.string() }).passthrough()),
  totalCount: z.number().int(),
}).passthrough();
const Z_OUT_ROADS = z.object({
  kind: z.literal("area-roads"),
  sites: z.array(z.object({ id: z.string() }).passthrough()),
}).passthrough();
const Z_OUT_FUEL = Z_FUEL_SUMMARY;
const Z_OUT_LOADING = z.object({
  kind: z.literal("area-loading"),
  area: Z_AREA,
}).passthrough();

async function resolveToolQueryToPostcode(query) {
  const resolved = await resolveInputToPostcode(query);
  return resolved.postcode;
}

export function createServer() {
  const server = new McpServer({ name: "MyAreaReport", version: "1.0.0" });

  // ── LLM-visible: area overview ────────────────────────────────────────────
  registerAppTool(
    server,
    "area-search",
    {
      title: "MyAreaReport: Area Overview",
      description:
        "Opens the MyAreaReport dashboard for a UK postcode, outcode, or place name. Shows real crime statistics from Police UK, flood risk from the Environment Agency, and area intelligence. " +
        "Use when the user asks about crime, safety, flood risk, or wants to explore a UK area. " +
        "Follow-up: summarise the key findings and ask if they want to drill into crime or flood details.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, outcode, or place name, e.g. SW1A 1AA, YO1, or Chester"),
      },
      outputSchema: Z_OUT_OVERVIEW,
      annotations: HINTS,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const resolvedPostcode = await resolveToolQueryToPostcode(postcode);
      const payload = await getAreaReport(resolvedPostcode);
      return {
        content: [{ type: "text", text: formatToolResultText("area-overview", payload) }],
        structuredContent: payload,
      };
    },
  );

  // ── LLM-visible: crime detail ─────────────────────────────────────────────
  registerAppTool(
    server,
    "area-crime",
    {
      title: "MyAreaReport: Crime Analysis",
      description:
        "Shows a detailed 3-month crime breakdown for a UK postcode, outcode, or place name — category analysis, outcomes, trends, and stop & search data from the Police UK API. " +
        "Use instead of area-search when the user specifically asks about crime, safety, or policing. " +
        "Follow-up: highlight the dominant crime category and trend direction.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, outcode, or place name"),
      },
      outputSchema: Z_OUT_CRIME,
      annotations: HINTS,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const resolvedPostcode = await resolveToolQueryToPostcode(postcode);
      const payload = await getCrimeDetail(resolvedPostcode);
      return {
        content: [{ type: "text", text: formatToolResultText("area-crime", payload) }],
        structuredContent: payload,
      };
    },
  );

  // ── LLM-visible: flood risk ───────────────────────────────────────────────
  registerAppTool(
    server,
    "area-flood",
    {
      title: "MyAreaReport: Flood Risk",
      description:
        "Shows flood warnings, alerts, and river monitoring station readings for a UK postcode, outcode, or place name from the Environment Agency. " +
        "Use when the user asks about flood risk, flooding, water levels, or the Environment Agency. " +
        "Follow-up: explain the current risk level and whether any active warnings apply.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, outcode, or place name"),
      },
      outputSchema: Z_OUT_FLOOD,
      annotations: HINTS,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const resolvedPostcode = await resolveToolQueryToPostcode(postcode);
      const payload = await getFloodDetail(resolvedPostcode);
      return {
        content: [{ type: "text", text: formatToolResultText("area-flood", payload) }],
        structuredContent: payload,
      };
    },
  );

  // ── LLM-visible: house prices ─────────────────────────────────────────────
  registerAppTool(
    server,
    "area-property",
    {
      title: "MyAreaReport: House Prices",
      description:
        "Shows recent house sale prices from the Land Registry for a UK postcode area, outcode, or place name — average and median prices, breakdown by property type (detached, semi, terraced, flat). " +
        "Use when the user asks about house prices, property values, or the housing market in an area. " +
        "Follow-up: highlight whether the area is above or below typical UK prices.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, outcode, or place name, e.g. SW1A 1AA, YO1, or Chester"),
      },
      outputSchema: Z_OUT_PROPERTY,
      annotations: HINTS,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const resolvedPostcode = await resolveToolQueryToPostcode(postcode);
      const geo = await geocodePostcode(resolvedPostcode);
      const outcode = resolvedPostcode.trim().toUpperCase().split(/\s+/)[0];
      const payload = await getPropertyData(outcode);
      payload.area = geo;
      return {
        content: [{ type: "text", text: formatToolResultText("area-property", payload) }],
        structuredContent: payload,
      };
    },
  );

  // ── LLM-visible: traffic / roads ──────────────────────────────────────────
  registerAppTool(
    server,
    "area-roads",
    {
      title: "MyAreaReport: Road Traffic",
      description:
        "Shows how busy the roads are near a UK postcode, outcode, or place name — average daily traffic counts, heavy vehicle percentages, and a traffic level indicator (Light/Moderate/Busy/Heavy/Very heavy) from National Highways motorway and A-road sensors. " +
        "Use when the user asks how busy the roads are, about traffic levels, congestion, road usage, or motorway data near an area.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, outcode, or place name"),
      },
      outputSchema: Z_OUT_ROADS,
      annotations: HINTS,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const resolvedPostcode = await resolveToolQueryToPostcode(postcode);
      const geo = await geocodePostcode(resolvedPostcode);
      const payload = await getHighwaysData(geo.lat, geo.lng);
      payload.area = geo;
      return {
        content: [{ type: "text", text: formatToolResultText("area-roads", payload) }],
        structuredContent: payload,
      };
    },
  );

  // ── LLM-visible: fuel prices ──────────────────────────────────────────────
  registerAppTool(
    server,
    "area-fuel",
    {
      title: "MyAreaReport: Fuel Prices",
      description:
        "Shows live petrol and diesel prices at filling stations within 20 km of a UK postcode, outcode, or place name from the GOV.UK Fuel Finder service. " +
        "Use when the user asks about petrol prices, diesel prices, cheap fuel, or nearby petrol stations. " +
        "Follow-up: highlight the cheapest unleaded and diesel station.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, outcode, or place name"),
      },
      outputSchema: Z_OUT_FUEL,
      annotations: HINTS,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const resolvedPostcode = await resolveToolQueryToPostcode(postcode);
      const geo = await geocodePostcode(resolvedPostcode);
      const payload = await getFuelPrices(geo.lat, geo.lng);
      payload.area = geo;
      return {
        content: [{ type: "text", text: formatToolResultText("area-fuel", payload) }],
        structuredContent: payload,
      };
    },
  );

  // ── App-only: search from frontend form ───────────────────────────────────
  registerAppTool(
    server,
    "area-app-search",
    {
      title: "Area search",
      description: "Resolve a postcode or place name entered in the search form and return area metadata for app bootstrap.",
      inputSchema: { query: z.string().describe("UK postcode or place name (e.g. 'Chester', 'SW1A 2AA')") },
      outputSchema: Z_OUT_LOADING,
      annotations: HINTS,
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ query }) => {
      const resolved = await resolveInputToPostcode(query);
      const area = await geocodePostcode(resolved.postcode);
      if (resolved.isApproximate) {
        area.isApproximate = true;
        area.placeName = resolved.placeName;
        area.outcode = resolved.outcode;
        area.localType = resolved.localType || '';
      }
      return {
        content: [{ type: "text", text: `Area loaded: ${area.postcode}` }],
        structuredContent: { kind: 'area-loading', area },
      };
    },
  );

  // ── App-only: load crime tab ──────────────────────────────────────────────
  registerAppTool(
    server,
    "area-app-crime",
    {
      title: "Load crime detail",
      description: "Fetch detailed crime data for the current area.",
      inputSchema: { postcode: z.string() },
      outputSchema: Z_OUT_CRIME,
      annotations: HINTS,
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ postcode }) => {
      const payload = await getCrimeDetail(postcode);
      return {
        content: [{ type: "text", text: `Crime detail loaded` }],
        structuredContent: payload,
      };
    },
  );

  // ── App-only: load flood tab ──────────────────────────────────────────────
  registerAppTool(
    server,
    "area-app-flood",
    {
      title: "Load flood detail",
      description: "Fetch detailed flood data for the current area.",
      inputSchema: { postcode: z.string() },
      outputSchema: Z_OUT_FLOOD,
      annotations: HINTS,
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ postcode }) => {
      const payload = await getFloodDetail(postcode);
      return {
        content: [{ type: "text", text: `Flood detail loaded` }],
        structuredContent: payload,
      };
    },
  );

  // ── App-only: load property tab ───────────────────────────────────────────
  registerAppTool(
    server,
    "area-app-property",
    {
      title: "Load property prices",
      description: "Fetch Land Registry house price data for the current area.",
      inputSchema: { postcode: z.string() },
      outputSchema: Z_OUT_PROPERTY,
      annotations: HINTS,
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ postcode }) => {
      const outcode = postcode.trim().toUpperCase().split(/\s+/)[0];
      const payload = await getPropertyData(outcode);
      return {
        content: [{ type: "text", text: `Property data loaded for ${outcode}` }],
        structuredContent: payload,
      };
    },
  );

  // ── App-only: load fuel tab ───────────────────────────────────────────────
  registerAppTool(
    server,
    "area-app-fuel",
    {
      title: "Load fuel prices",
      description: "Fetch GOV.UK Fuel Finder prices for petrol stations near the current area.",
      inputSchema: { postcode: z.string() },
      outputSchema: Z_OUT_FUEL,
      annotations: HINTS,
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ postcode }) => {
      const geo = await geocodePostcode(postcode);
      const payload = await getFuelPrices(geo.lat, geo.lng);
      payload.area = geo;
      return {
        content: [{ type: "text", text: `Fuel prices loaded` }],
        structuredContent: payload,
      };
    },
  );

  // ── App-only: load roads tab ──────────────────────────────────────────────
  registerAppTool(
    server,
    "area-app-roads",
    {
      title: "Load road traffic data",
      description: "Fetch National Highways traffic monitoring data for the current area.",
      inputSchema: { postcode: z.string() },
      outputSchema: Z_OUT_ROADS,
      annotations: HINTS,
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ postcode }) => {
      const geo = await geocodePostcode(postcode);
      const payload = await getHighwaysData(geo.lat, geo.lng);
      payload.area = geo;
      return {
        content: [{ type: "text", text: `Roads data loaded` }],
        structuredContent: payload,
      };
    },
  );

  // ── UI resource ───────────────────────────────────────────────────────────
  registerAppResource(
    server,
    "MyAreaReport UI",
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "MyAreaReport — UK area intelligence: crime, flood, and environment data from official government APIs.",
      _meta: UI_RESOURCE_META,
    },
    async () => {
      const html = await readBundledAppHtml();
      return {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: UI_RESOURCE_META,
        }],
      };
    },
  );

  return server;
}
