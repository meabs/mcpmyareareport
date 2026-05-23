#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/infra/docker-compose.yml}"
DOMAIN="${DOMAIN:-}"

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
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

DOMAIN="${DOMAIN:-${MCP_DOMAIN:-${MCP_APP_DOMAIN:-mcp.myareareport.com}}}"
export DOMAIN
PUBLIC_BASE="https://$DOMAIN"
export MCP_APP_UI_DOMAIN="${MCP_APP_UI_DOMAIN:-https://$DOMAIN}"

required_vars=(
  FUEL_FINDER_CLIENT_ID
  FUEL_FINDER_CLIENT_SECRET
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "missing required env var: $var_name" >&2
    exit 1
  fi
done

old_containers=(
  infra-mcp
  infra-mcp-1
  infra-caddy-1
  infra-web-1
  infra-api-1
  infra-redis-1
  myareareport-mcp
  myareareport-caddy
)

for container in "${old_containers[@]}"; do
  docker rm -f "$container" >/dev/null 2>&1 || true
done

echo "Starting compose stack"
docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
docker compose -f "$COMPOSE_FILE" up -d --build

echo "Waiting for app readiness"
for _ in $(seq 1 30); do
  if curl -ksfS --resolve "$DOMAIN:443:127.0.0.1" "$PUBLIC_BASE/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo
echo "-- containers --"
docker compose -f "$COMPOSE_FILE" ps

echo
echo "-- health --"
curl -ksfS --resolve "$DOMAIN:443:127.0.0.1" "$PUBLIC_BASE/health"

echo
echo
echo "-- ready --"
curl -ksfS --resolve "$DOMAIN:443:127.0.0.1" "$PUBLIC_BASE/ready"

echo
echo
echo "-- plugin manifest --"
curl -ksfS --resolve "$DOMAIN:443:127.0.0.1" "$PUBLIC_BASE/.well-known/ai-plugin.json" | head -c 400
echo
