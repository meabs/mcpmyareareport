import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATS_FILE = path.resolve(__dirname, "..", "data", "usage-stats.json");
const STATS_FILE = process.env.USAGE_STATS_FILE || DEFAULT_STATS_FILE;
const RETAIN_DAYS = Number(process.env.USAGE_STATS_RETAIN_DAYS || 400);
const TIME_ZONE = process.env.USAGE_STATS_TIME_ZONE || "Europe/London";
const TOOL_NAMES = [
  "area-search",
  "area-crime",
  "area-flood",
  "area-property",
  "area-roads",
  "area-fuel",
  "area-app-search",
  "area-app-crime",
  "area-app-flood",
  "area-app-property",
  "area-app-roads",
  "area-app-fuel",
];
const LATENCY_BUCKETS = [
  ["under_500ms", 500],
  ["500ms_1s", 1000],
  ["1s_3s", 3000],
  ["3s_10s", 10000],
  ["over_10s", Infinity],
];

let store;
let loadPromise;
let writePromise = Promise.resolve();

function emptyStats() {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    timeZone: TIME_ZONE,
    totals: emptyCounter(),
    days: {},
  };
}

function emptyCounter() {
  return {
    calls: 0,
    success: 0,
    error: 0,
    totalDurationMs: 0,
    latencyBuckets: {},
  };
}

function addCounter(target, status, durationMs) {
  target.calls += 1;
  if (status === "success") target.success += 1;
  else target.error += 1;
  target.totalDurationMs += durationMs;
  const bucket = latencyBucket(durationMs);
  target.latencyBuckets[bucket] = (target.latencyBuckets[bucket] || 0) + 1;
}

function latencyBucket(durationMs) {
  for (const [name, maxMs] of LATENCY_BUCKETS) {
    if (durationMs < maxMs) return name;
  }
  return "over_10s";
}

function getLocalParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: values.hour,
  };
}

function normaliseToolName(tool) {
  return TOOL_NAMES.includes(tool) ? tool : "unknown";
}

export function classifyInputType(value) {
  const input = String(value || "").trim().toUpperCase();
  if (!input) return "unknown";
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(input)) return "postcode";
  if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(input)) return "outcode";
  if (/^\d{5}(?:-\d{4})?$/.test(input)) return "zip";
  if (/\d+\s+.+,\s*[A-Z]{2}\s+\d{5}/.test(input)) return "address";
  return "place";
}

async function loadStats() {
  if (store) return store;
  if (!loadPromise) {
    loadPromise = fs.readFile(STATS_FILE, "utf8")
      .then((raw) => JSON.parse(raw))
      .catch((err) => {
        if (err?.code === "ENOENT") return emptyStats();
        console.error("[usage] failed to read stats file:", err.message);
        return emptyStats();
      })
      .then((stats) => {
        store = normaliseStats(stats);
        return store;
      });
  }
  return loadPromise;
}

function normaliseStats(stats) {
  const next = {
    ...emptyStats(),
    ...stats,
    totals: { ...emptyCounter(), ...(stats?.totals || {}) },
    days: stats?.days && typeof stats.days === "object" ? stats.days : {},
  };
  for (const day of Object.values(next.days)) normaliseDay(day);
  return next;
}

function normaliseDay(day) {
  Object.assign(day, {
    ...emptyCounter(),
    ...day,
    latencyBuckets: day.latencyBuckets || {},
    byTool: day.byTool || {},
    byInputType: day.byInputType || {},
    byStatus: day.byStatus || {},
    byHour: day.byHour || {},
  });
  for (const key of Object.keys(day.byTool)) day.byTool[key] = { ...emptyCounter(), ...day.byTool[key] };
  for (const key of Object.keys(day.byInputType)) day.byInputType[key] = { ...emptyCounter(), ...day.byInputType[key] };
  for (const key of Object.keys(day.byHour)) day.byHour[key] = { ...emptyCounter(), ...day.byHour[key] };
}

function pruneOldDays(stats) {
  if (!Number.isFinite(RETAIN_DAYS) || RETAIN_DAYS <= 0) return;
  const cutoff = Date.now() - (RETAIN_DAYS * 24 * 60 * 60 * 1000);
  for (const dateKey of Object.keys(stats.days)) {
    if (Date.parse(`${dateKey}T00:00:00Z`) < cutoff) delete stats.days[dateKey];
  }
}

async function persistStats(stats) {
  writePromise = writePromise.then(async () => {
    await fs.mkdir(path.dirname(STATS_FILE), { recursive: true });
    const tmp = `${STATS_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
    await fs.rename(tmp, STATS_FILE);
  }).catch((err) => {
    console.error("[usage] failed to write stats file:", err.message);
  });
  return writePromise;
}

export async function recordToolUsage({ tool, inputType, status, durationMs }) {
  const stats = await loadStats();
  const now = new Date();
  const { date, hour } = getLocalParts(now);
  const safeTool = normaliseToolName(tool);
  const safeInputType = ["postcode", "outcode", "zip", "address", "place", "unknown"].includes(inputType) ? inputType : "unknown";
  const safeStatus = status === "success" ? "success" : "error";
  const safeDuration = Math.max(0, Math.round(Number(durationMs) || 0));

  stats.updatedAt = now.toISOString();
  stats.timeZone = TIME_ZONE;
  addCounter(stats.totals, safeStatus, safeDuration);

  const day = stats.days[date] || {
    ...emptyCounter(),
    byTool: {},
    byInputType: {},
    byStatus: {},
    byHour: {},
  };
  stats.days[date] = day;
  normaliseDay(day);
  addCounter(day, safeStatus, safeDuration);
  day.byStatus[safeStatus] = (day.byStatus[safeStatus] || 0) + 1;

  day.byTool[safeTool] = day.byTool[safeTool] || emptyCounter();
  addCounter(day.byTool[safeTool], safeStatus, safeDuration);

  day.byInputType[safeInputType] = day.byInputType[safeInputType] || emptyCounter();
  addCounter(day.byInputType[safeInputType], safeStatus, safeDuration);

  day.byHour[hour] = day.byHour[hour] || emptyCounter();
  addCounter(day.byHour[hour], safeStatus, safeDuration);

  pruneOldDays(stats);
  await persistStats(stats);
}

export async function getUsageStats() {
  const stats = await loadStats();
  return JSON.parse(JSON.stringify(stats));
}

export function averageMs(counter) {
  return counter?.calls ? Math.round(counter.totalDurationMs / counter.calls) : 0;
}
