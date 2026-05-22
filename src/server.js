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
} from "./area-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const RESOURCE_URI = "ui://myareareport/app.html";

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

export function createServer() {
  const server = new McpServer({ name: "MyAreaReport", version: "1.0.0" });

  // ── LLM-visible: area overview ────────────────────────────────────────────
  registerAppTool(
    server,
    "area-search",
    {
      title: "MyAreaReport: Area Overview",
      description:
        "Opens the MyAreaReport dashboard for a UK postcode. Shows real crime statistics from Police UK, flood risk from the Environment Agency, and area intelligence. " +
        "Use when the user asks about crime, safety, flood risk, or wants to explore a UK area. " +
        "Follow-up: summarise the key findings and ask if they want to drill into crime or flood details.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, e.g. SW1A 1AA or CH1 1AA"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const payload = await getAreaReport(postcode);
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
        "Shows a detailed 3-month crime breakdown for a UK area — category analysis, outcomes, trends, and stop & search data from the Police UK API. " +
        "Use instead of area-search when the user specifically asks about crime, safety, or policing. " +
        "Follow-up: highlight the dominant crime category and trend direction.",
      inputSchema: {
        postcode: z.string().describe("UK postcode"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const payload = await getCrimeDetail(postcode);
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
        "Shows flood warnings, alerts, and river monitoring station readings for a UK area from the Environment Agency. " +
        "Use when the user asks about flood risk, flooding, water levels, or the Environment Agency. " +
        "Follow-up: explain the current risk level and whether any active warnings apply.",
      inputSchema: {
        postcode: z.string().describe("UK postcode"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const payload = await getFloodDetail(postcode);
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
        "Shows recent house sale prices from the Land Registry for a UK postcode area — average and median prices, breakdown by property type (detached, semi, terraced, flat). " +
        "Use when the user asks about house prices, property values, or the housing market in an area. " +
        "Follow-up: highlight whether the area is above or below typical UK prices.",
      inputSchema: {
        postcode: z.string().describe("UK postcode, e.g. SW1A 1AA — the outcode (district) is used for the property search"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const geo = await geocodePostcode(postcode);
      const outcode = postcode.trim().toUpperCase().split(/\s+/)[0];
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
        "Shows National Highways traffic monitoring data for roads near a UK postcode — average daily traffic counts and heavy vehicle percentages from motorway and A-road sensors. " +
        "Use when the user asks about traffic, congestion, road usage, or motorway data near an area.",
      inputSchema: {
        postcode: z.string().describe("UK postcode"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const geo = await geocodePostcode(postcode);
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
        "Shows live petrol and diesel prices at filling stations within 5 km of a UK postcode from the GOV.UK Fuel Finder service. " +
        "Use when the user asks about petrol prices, diesel prices, cheap fuel, or nearby petrol stations. " +
        "Follow-up: highlight the cheapest unleaded and diesel station.",
      inputSchema: {
        postcode: z.string().describe("UK postcode"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ postcode }) => {
      const geo = await geocodePostcode(postcode);
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
      description: "Fetch area overview for a postcode or place name entered in the search form.",
      inputSchema: { query: z.string().describe("UK postcode or place name (e.g. 'Chester', 'SW1A 2AA')") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ query }) => {
      const resolved = await resolveInputToPostcode(query);
      const payload = await getAreaReport(resolved.postcode);
      if (resolved.isApproximate) {
        payload.area.isApproximate = true;
        payload.area.placeName = resolved.placeName;
        payload.area.outcode = resolved.outcode;
        payload.area.localType = resolved.localType || '';
      }
      return {
        content: [{ type: "text", text: `Area loaded: ${payload.area.postcode}` }],
        structuredContent: payload,
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
    },
    async () => {
      const html = await readBundledAppHtml();
      return {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              csp: {
                connectDomains: [
                  "https://mcp.myareareport.com",
                  "http://localhost:3001",
                  "https://api.postcodes.io",
                  "https://data.police.uk",
                  "https://environment.data.gov.uk",
                  "https://landregistry.data.gov.uk",
                  "https://webtris.highwaysengland.co.uk",
                  "https://auth.fuelfinder.service.gov.uk",
                  "https://api.fuelfinder.service.gov.uk",
                ],
                resourceDomains: [
                  "https://tile.openstreetmap.org",
                ],
              },
            },
          },
        }],
      };
    },
  );

  return server;
}
