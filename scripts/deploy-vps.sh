#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/parthik}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
ENV_FILE="$APP_DIR/.env.production"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and fill production values." >&2
  exit 1
fi

cd "$APP_DIR"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/api/v1/health >/dev/null; then
    echo "Parthik is healthy."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
    exit 0
  fi
  sleep 5
done

echo "Health check failed." >&2
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps >&2
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 app caddy postgres >&2
exit 1
