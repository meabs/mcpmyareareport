import fs from "node:fs/promises";
import os from "node:os";

const PROC_ROOT = process.env.HOST_PROC_PATH || "/proc";
const DISK_PATH = process.env.USAGE_DISK_PATH || process.env.USAGE_STATS_FILE?.replace(/\/[^/]+$/, "") || "/";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readText(file) {
  return fs.readFile(file, "utf8");
}

function parseCpuStat(raw) {
  const line = raw.split("\n").find((row) => row.startsWith("cpu "));
  if (!line) return null;
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (values[3] || 0) + (values[4] || 0);
  const total = values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return { idle, total };
}

async function getCpuPercent() {
  try {
    const first = parseCpuStat(await readText(`${PROC_ROOT}/stat`));
    await wait(120);
    const second = parseCpuStat(await readText(`${PROC_ROOT}/stat`));
    if (!first || !second) return null;
    const totalDelta = second.total - first.total;
    const idleDelta = second.idle - first.idle;
    if (totalDelta <= 0) return null;
    return Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
  } catch {
    const cpus = os.cpus();
    if (!cpus.length) return null;
    return null;
  }
}

async function getMemory() {
  try {
    const raw = await readText(`${PROC_ROOT}/meminfo`);
    const values = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^([^:]+):\s+(\d+)/);
      if (match) values[match[1]] = Number(match[2]) * 1024;
    }
    const total = values.MemTotal || os.totalmem();
    const available = values.MemAvailable || os.freemem();
    const used = Math.max(0, total - available);
    return {
      total,
      used,
      available,
      percent: total ? Math.round((used / total) * 100) : null,
    };
  } catch {
    const total = os.totalmem();
    const available = os.freemem();
    const used = Math.max(0, total - available);
    return { total, used, available, percent: total ? Math.round((used / total) * 100) : null };
  }
}

async function getLoadAverage() {
  try {
    const raw = await readText(`${PROC_ROOT}/loadavg`);
    const [one, five, fifteen] = raw.trim().split(/\s+/).map(Number);
    return { one, five, fifteen };
  } catch {
    const [one, five, fifteen] = os.loadavg();
    return { one, five, fifteen };
  }
}

async function getUptimeSeconds() {
  try {
    const raw = await readText(`${PROC_ROOT}/uptime`);
    return Math.floor(Number(raw.trim().split(/\s+/)[0]) || 0);
  } catch {
    return Math.floor(os.uptime());
  }
}

async function getDisk() {
  try {
    const stat = await fs.statfs(DISK_PATH);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    const used = Math.max(0, total - free);
    return {
      path: DISK_PATH,
      total,
      used,
      free,
      percent: total ? Math.round((used / total) * 100) : null,
    };
  } catch {
    return null;
  }
}

export async function getSystemMetrics() {
  const [cpuPercent, memory, load, uptimeSeconds, disk] = await Promise.all([
    getCpuPercent(),
    getMemory(),
    getLoadAverage(),
    getUptimeSeconds(),
    getDisk(),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    cpu: {
      percent: cpuPercent,
      cores: os.cpus().length,
    },
    memory,
    load,
    uptimeSeconds,
    disk,
  };
}
