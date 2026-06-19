#!/usr/bin/env bash
set -e

REMOTE="Administrator@34.92.234.111"
REMOTE_DIR="/home/Administrator/deploy"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/google_compute_engine}"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no)
SERVICE="drama.service"

if [ ! -f "cluster_main.py" ] || [ ! -d "routers" ] || [ ! -d "schemas" ]; then
  echo "ERROR: run this script from the deploy/ directory"
  exit 1
fi

FILES=(
  "cluster_main.py"
  "admin_routes.py"
  "admin_api_config_routes.py"
  "api_routes.py"
  "routers"
  "schemas"
  "services/ai_proxy_service.py"
  "services/api_config_health_service.py"
  "services/api_config_import_service.py"
  "services/api_config_runtime_loader.py"
  "services/api_config_service.py"
  "services/api_provider_endpoints.py"
  "services/api_provider_health_monitor.py"
  "services/api_provider_registry.py"
  "services/api_provider_runtime.py"
  "utils/config_helpers.py"
  "external_api/video/dashscope.py"
  "external_api/video/minimax.py"
  "external_api/video/seedance.py"
  "external_api/video/sora2.py"
  "external_api/video/veo.py"
  "external_api/video/wan2.py"
  "external_api/audio/minimax_audio.py"
)

for path in "${FILES[@]}"; do
  if [ ! -e "$path" ]; then
    echo "ERROR: missing deploy file: $path"
    exit 1
  fi
done

echo "Creating remote cluster_main.py backup..."
BACKUP_PATH=$(
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    "set -e; ts=\$(date +%Y%m%d%H%M%S); bak=$REMOTE_DIR/cluster_main.py.bak.\$ts; cp $REMOTE_DIR/cluster_main.py \"\$bak\"; echo \"\$bak\""
)
echo "Backup: $BACKUP_PATH"

STAGING_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

for path in "${FILES[@]}"; do
  mkdir -p "$STAGING_DIR/$(dirname "$path")"
  cp -R "$path" "$STAGING_DIR/$path"
done

echo "Uploading MVC/API management files..."
scp -r "${SSH_OPTS[@]}" "$STAGING_DIR"/. "$REMOTE:$REMOTE_DIR/"

echo "Restarting $SERVICE..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo systemctl restart $SERVICE"

echo "Waiting for service..."
sleep 8
ACTIVE=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "systemctl is-active $SERVICE || true")
echo "Service status: $ACTIVE"

if [ "$ACTIVE" != "active" ]; then
  echo "Service is not active; rolling back cluster_main.py..."
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    "set -e; latest=\$(ls -1t $REMOTE_DIR/cluster_main.py.bak.* | head -n 1); cp \"\$latest\" $REMOTE_DIR/cluster_main.py; sudo systemctl restart $SERVICE"
  echo "⚠️ 部署失败，已回滚"
  exit 1
fi

echo "✅ 部署成功"
