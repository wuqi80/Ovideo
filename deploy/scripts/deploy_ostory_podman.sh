#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-/opt/ostory/source}"
ENV_FILE="${2:-/opt/ostory/.env}"
POD_NAME="ostory-pod"
SERVICE_NAME="ostory-pod.service"

if ! command -v podman >/dev/null 2>&1; then
  echo "podman is required" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing environment file: $ENV_FILE" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_DIR/deploy/containers/app.Dockerfile" ]]; then
  echo "invalid source directory: $SOURCE_DIR" >&2
  exit 1
fi
if grep -q 'change-me-' "$ENV_FILE"; then
  echo "replace all change-me values in $ENV_FILE before deployment" >&2
  exit 1
fi

chmod 600 "$ENV_FILE"
GIT_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
IMAGE="localhost/ostory-app:${GIT_SHA}"
RELEASED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

podman build \
  --ulimit nofile=1048576:1048576 \
  --file "$SOURCE_DIR/deploy/containers/app.Dockerfile" \
  --build-arg "GIT_SHA=$GIT_SHA" \
  --tag "$IMAGE" \
  "$SOURCE_DIR"

systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
podman pod rm --force "$POD_NAME" >/dev/null 2>&1 || true

for volume in ostory-postgres ostory-redis ostory-storage ostory-temp ostory-uploads ostory-outputs ostory-logs ostory-history ostory-caddy-data ostory-caddy-config; do
  podman volume exists "$volume" || podman volume create "$volume" >/dev/null
done

podman pod create \
  --name "$POD_NAME" \
  --hostname tv.ostory.ai \
  --publish 80:80 \
  --publish 443:443 >/dev/null

podman run --detach \
  --pod "$POD_NAME" \
  --name ostory-db \
  --restart always \
  --env-file "$ENV_FILE" \
  --volume ostory-postgres:/var/lib/postgresql/data:Z \
  docker.io/library/postgres:16-alpine >/dev/null

podman run --detach \
  --pod "$POD_NAME" \
  --name ostory-redis \
  --restart always \
  --volume ostory-redis:/data:Z \
  docker.io/library/redis:7-alpine \
  redis-server --appendonly yes >/dev/null

install -d -m 0755 /opt/ostory
printf '{"git_sha":"%s","released_at":"%s"}\n' "$GIT_SHA" "$RELEASED_AT" > /opt/ostory/release_metadata.json
chmod 0644 /opt/ostory/release_metadata.json

podman run --detach \
  --pod "$POD_NAME" \
  --name ostory-app \
  --restart always \
  --env-file "$ENV_FILE" \
  --env "GIT_SHA=$GIT_SHA" \
  --env "RELEASED_AT=$RELEASED_AT" \
  --volume ostory-storage:/app/persistent_storage:Z \
  --volume ostory-temp:/app/temp:Z \
  --volume ostory-uploads:/app/uploads:Z \
  --volume ostory-outputs:/app/outputs:Z \
  --volume ostory-logs:/app/logs:Z \
  --volume ostory-history:/app/history:Z \
  --volume /opt/ostory/release_metadata.json:/app/release_metadata.json:ro,Z \
  "$IMAGE" >/dev/null

podman run --detach \
  --pod "$POD_NAME" \
  --name ostory-caddy \
  --restart always \
  --volume "$SOURCE_DIR/deploy/containers/Caddyfile:/etc/caddy/Caddyfile:ro,Z" \
  --volume ostory-caddy-data:/data:Z \
  --volume ostory-caddy-config:/config:Z \
  docker.io/library/caddy:2-alpine >/dev/null

install -m 0644 "$SOURCE_DIR/deploy/containers/ostory-pod.service" "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
podman pod stop --time 30 "$POD_NAME" >/dev/null
systemctl enable --now "$SERVICE_NAME" >/dev/null

for attempt in $(seq 1 60); do
  if podman exec ostory-app curl -fsS http://127.0.0.1:6006/health >/dev/null 2>&1; then
    echo "Ostory application is healthy at git $GIT_SHA"
    exit 0
  fi
  app_state="$(podman inspect --format '{{.State.Status}}' ostory-app 2>/dev/null || true)"
  if [[ "$app_state" == "exited" || "$app_state" == "dead" ]]; then
    podman logs --tail 120 ostory-app >&2 || true
    echo "ostory-app container exited before health verification" >&2
    exit 1
  fi
  sleep 3
done

podman logs --tail 120 ostory-app >&2 || true
echo "Ostory application did not become healthy" >&2
exit 1
