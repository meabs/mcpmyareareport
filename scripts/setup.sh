#!/usr/bin/env bash
# Blackwell Bank MCP App — one-shot setup script
# Run from the project root: bash scripts/setup.sh
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

header() { echo -e "\n${CYAN}▸ $1${NC}"; }
ok()     { echo -e "  ${GREEN}✓ $1${NC}"; }
warn()   { echo -e "  ${YELLOW}⚠ $1${NC}"; }

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo -e "${CYAN}Blackwell Bank MCP App — Setup${NC}"
echo "Project: $PROJECT_DIR"

# ── 1. npm dependencies ───────────────────────────────────────────────────────
header "Installing npm dependencies"
npm install --silent
ok "Dependencies installed"

# ── 2. Build ──────────────────────────────────────────────────────────────────
header "Building UI bundle"
npm run build --silent
ok "Bundle built (dist/mcp-app.html)"

# ── 3. cloudflared ───────────────────────────────────────────────────────────
header "Checking cloudflared"
if command -v cloudflared &>/dev/null; then
  ok "cloudflared already installed ($(cloudflared --version 2>&1 | head -1))"
elif command -v brew &>/dev/null; then
  echo "  Installing cloudflared via Homebrew..."
  brew install cloudflare/cloudflare/cloudflared --quiet
  ok "cloudflared installed"
else
  warn "cloudflared not found and Homebrew unavailable."
  warn "Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  warn "Skipping tunnel setup — HTTP local mode will still work."
  SKIP_TUNNEL=1
fi

# ── 4. Verify tunnel credentials ─────────────────────────────────────────────
if [ -z "$SKIP_TUNNEL" ]; then
  TUNNEL_ID="7518a5d5-2c06-4a62-85ef-8dece49b1c55"
  CRED_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"
  CONFIG_FILE="$HOME/.cloudflared/config.yml"

  header "Checking Cloudflare tunnel credentials"

  if [ -f "$CRED_FILE" ]; then
    ok "Tunnel credentials found"
  else
    warn "Tunnel credentials not found at $CRED_FILE"
    warn "Log in with: cloudflared tunnel login"
    warn "Then create a tunnel or restore credentials before using start:cloud"
  fi

  if [ -f "$CONFIG_FILE" ]; then
    ok "Tunnel config found ($CONFIG_FILE)"
  else
    warn "~/.cloudflared/config.yml not found — creating it"
    cat > "$CONFIG_FILE" <<YAML
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: garry-demo.meaburn.com
    service: http://localhost:3001
  - service: http_status:404
YAML
    ok "Created ~/.cloudflared/config.yml"
  fi
fi

# ── 5. Claude Desktop ─────────────────────────────────────────────────────────
header "Claude Desktop configuration"
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_CONFIG="$CLAUDE_DIR/claude_desktop_config.json"

if [ ! -d "$CLAUDE_DIR" ]; then
  warn "Claude Desktop not found at '$CLAUDE_DIR' — skipping"
  warn "Install Claude Desktop from https://claude.ai/download to use stdio mode"
else
  SERVER_ENTRY="{ \"command\": \"bash\", \"args\": [\"-lc\", \"cd $PROJECT_DIR && npm run start:stdio\"] }"

  if [ -f "$CLAUDE_CONFIG" ]; then
    if node -e "const c=JSON.parse(require('fs').readFileSync('$CLAUDE_CONFIG','utf8')); process.exit(c.mcpServers?.['blackwell-bank'] ? 0 : 1)" 2>/dev/null; then
      ok "Claude Desktop already has blackwell-bank configured"
    else
      cp "$CLAUDE_CONFIG" "${CLAUDE_CONFIG}.bak"
      node -e "
        const fs = require('fs');
        const c = JSON.parse(fs.readFileSync('$CLAUDE_CONFIG', 'utf8'));
        c.mcpServers = c.mcpServers || {};
        c.mcpServers['blackwell-bank'] = $SERVER_ENTRY;
        fs.writeFileSync('$CLAUDE_CONFIG', JSON.stringify(c, null, 2));
      "
      ok "Added blackwell-bank to existing Claude Desktop config (backup at ${CLAUDE_CONFIG}.bak)"
    fi
  else
    node -e "
      const fs = require('fs');
      fs.mkdirSync('$CLAUDE_DIR', { recursive: true });
      fs.writeFileSync('$CLAUDE_CONFIG', JSON.stringify({
        mcpServers: { 'blackwell-bank': $SERVER_ENTRY }
      }, null, 2));
    "
    ok "Created Claude Desktop config with blackwell-bank"
  fi

  warn "Restart Claude Desktop to pick up the new MCP server"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Setup complete.${NC}"
echo ""
echo "  npm start              → http://localhost:3001/mcp  (local HTTP)"
echo "  npm run start:cloud    → https://garry-demo.meaburn.com/mcp  (Cloudflare)"
echo "  npm run start:stdio    → stdio mode for Claude Desktop"
echo ""
