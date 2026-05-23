# Hosting Cost Analysis — mcpmyareareport

**App profile:** Stateless Node.js/ESM Express server. Serves MCP Streamable HTTP at `/mcp` and a static 350 KB asset. No database. Very low traffic. Needs public HTTPS and 24/7 uptime.

**Requirement: fixed monthly cost — no usage meters.**

---

## Fixed-cost options ranked

| # | Platform | $/mo (fixed) | RAM / vCPU | Managed? | Notes |
|---|---|---|---|---|---|
| 1 | Hetzner CAX11 + Cloudflare Tunnel | ~$4.20 | 4 GB / 2 vCPU ARM | No | Tunnel is free; no Caddy needed |
| 2 | Hetzner CAX11 (direct, no tunnel) | ~$4.20 | 4 GB / 2 vCPU ARM | No | Add Caddy for HTTPS |
| 3 | Cloudflare Workers Paid | $5 | 128 MB / shared | Yes | Minor code change required |
| 4 | DigitalOcean App Platform Starter | $5 | 512 MB / 1 vCPU | Yes | Zero ops, GitHub deploy |
| 5 | Akamai/Linode Nanode | $5 | 1 GB / 1 vCPU | No | Raw VPS |
| 6 | Vultr / DigitalOcean Droplet | $6 | 1 GB / 1 vCPU | No | Raw VPS |
| 7 | Render Starter | $7 | 512 MB / 0.5 vCPU | Yes | Zero ops, GitHub deploy |

> Fly.io and Railway are **excluded** — both bill by compute time, not a flat fee.

---

## Top picks

### 1. Hetzner CAX11 + Cloudflare Tunnel — ~$4.20/mo ★ Recommended

**This is essentially what `npm run start:cloud` already does — just on a server instead of your laptop.**

The repo already runs `cloudflared tunnel run <id>` in `start:cloud`. Move that to a Hetzner VM and you have 24/7 hosting with no HTTPS setup, no Caddy, no firewall rules. Cloudflare terminates TLS and proxies through the tunnel for free.

**One-time setup:**
```bash
# On a fresh Hetzner Ubuntu 24.04 ARM VM
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Deploy the app
git clone https://github.com/meabs/mcpmyareareport.git
cd mcpmyareareport && npm ci

# Run with PM2 (keeps it up after reboots)
npm i -g pm2
pm2 start "npm run start:cloud" --name mcpmyareareport
pm2 save && pm2 startup
```

That's it. The existing tunnel config (`7518a5d5-2c06-4a62-85ef-8dece49b1c55`) handles HTTPS and the public URL automatically.

**Specs:** 2 vCPU / 4 GB ARM (Ampere Altra), 20 TB traffic, EU datacenters (Germany/Finland).

---

### 2. Cloudflare Workers Paid — $5/mo (zero servers, fixed)

Workers now support Express.js via Node.js compatibility (September 2025+). The app needs one small change to the entry point — no rewrite of any logic.

**Required change to `src/index.js`:**
```js
// Add at the end of startStreamableHttpServer(), replace the app.listen() block:
import { httpServerHandler } from 'cloudflare:node';
export default httpServerHandler({ port: 3001 });
```

**`wrangler.toml`:**
```toml
name = "mcpmyareareport"
main = "src/index.js"
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]

[build]
command = "npm run build"
```

**Limitation — SSE idle timeout:** Cloudflare's proxy kills SSE connections silent for >100 seconds. MCP Streamable HTTP uses SSE for streaming responses. For short tool calls this is fine; for long-running operations the server needs to send a keepalive comment (`: keepalive\n\n`) every ~30s. Cloudflare's own MCP SDK (`createMcpHandler`) handles this — if the MCP SDK is updated to use it, Workers becomes seamless.

**Includes:** 10 million requests/month and 30 million CPU-ms/month — a demo app will use a tiny fraction of this.

---

### 3. DigitalOcean App Platform Starter — $5/mo (zero ops)

Flat $5/mo. Connect the GitHub repo, set build/run commands, done.

- Build command: `npm run build`
- Run command: `node src/index.js`
- `PORT` is injected automatically

No server management, auto-HTTPS, automatic restarts on crash.

---

## Verdict

| Goal | Pick | Cost |
|---|---|---|
| Cheapest, zero new config | **Hetzner + existing Cloudflare Tunnel** | ~$4.20/mo |
| Zero servers at all | **Cloudflare Workers Paid** | $5/mo |
| Zero ops, fully managed | **DigitalOcean App Platform** | $5/mo |

The Hetzner + tunnel path is the most natural evolution of the current setup — the `start:cloud` script already does exactly this, just running on your local machine today. Moving it to a €3.79/mo VM makes it 24/7.
