#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.us-staging}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/infra/docker-compose.us-staging.yml}"
PORT="${US_STAGING_PORT:-3004}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE" >&2
  echo "create it from .env with staging-safe values before deploying" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-myareareport-us-staging}"
export MCP_APP_UI_DOMAIN="${MCP_APP_UI_DOMAIN:-https://us-staging.myareareport.com}"
export US_STAGING_PORT="$PORT"

echo "Starting isolated USA staging stack on 127.0.0.1:$PORT"
docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
docker compose -f "$COMPOSE_FILE" up -d --build

echo "Waiting for staging readiness"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo
echo "-- containers --"
docker compose -f "$COMPOSE_FILE" ps

echo
echo "-- health --"
curl -fsS "http://127.0.0.1:$PORT/health"

echo
echo
echo "-- ready --"
curl -fsS "http://127.0.0.1:$PORT/ready"

echo
echo
echo "-- plugin manifest --"
curl -fsS "http://127.0.0.1:$PORT/.well-known/ai-plugin.json" | head -c 400
echo
echo
echo "Public staging review URL requires DNS for us-staging.myareareport.com and the Caddy host block in infra/Caddyfile.us-staging-snippet."
