#!/usr/bin/env bash
set -e

REMOTE="${REMOTE:-Administrator@34.92.234.111}"
REMOTE_DIR="${REMOTE_DIR:-/home/Administrator/deploy}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/google_compute_engine}"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no)
SERVICE="${SERVICE:-drama.service}"
FRONTEND_TAR_REMOTE="/tmp/mecha-new_html-src.tgz"
RUN_REMOTE_CONTRACTS="${RUN_REMOTE_CONTRACTS:-1}"
RUN_REMOTE_SMOKE="${RUN_REMOTE_SMOKE:-0}"
REQUIRE_REMOTE_SMOKE="${REQUIRE_REMOTE_SMOKE:-0}"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://mecha.one}"

if [ ! -f "cluster_main.py" ] || [ ! -d "routers" ] || [ ! -d "schemas" ] || [ ! -d "services" ] || [ ! -d "utils" ] || [ ! -d "new_html" ]; then
  echo "ERROR: run this script from the deploy/ directory"
  exit 1
fi

FILES=(
  "cluster_main.py"
  "admin_routes.py"
  "admin_api_config_routes.py"
  "api_routes.py"
  "ARCHITECTURE.md"
  "dao"
  "docs"
  "routers"
  "schemas"
  "services"
  "utils"
  "external_api/video/dashscope.py"
  "external_api/video/minimax.py"
  "external_api/video/seedance.py"
  "external_api/video/sora2.py"
  "external_api/video/veo.py"
  "external_api/video/wan2.py"
  "external_api/audio/minimax_audio.py"
  "scripts/live_deploy_mvc2.sh"
  scripts/check_*.py
  tests/test_admin_stats_logs.py
  tests/test_auth_user_service.py
  tests/test_content_file_dao.py
  tests/test_minimax_audio_runtime.py
  tests/test_project_read_access.py
  tests/test_storyboard_stale_script_fallback.py
  tests/test_task_read_service.py
  tests/test_user_dao_admin_delete.py
)

for path in "${FILES[@]}"; do
  if [ ! -e "$path" ]; then
    echo "ERROR: missing deploy file: $path"
    exit 1
  fi
done

STAGING_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

rollback_remote() {
  echo "Rolling back remote cluster_main.py and dist..."
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
    latest=\$(ls -1t '$REMOTE_DIR'/cluster_main.py.bak.* 2>/dev/null | head -n 1 || true)
    if [ -n \"\$latest\" ]; then
      cp \"\$latest\" '$REMOTE_DIR'/cluster_main.py
    fi
    if [ -n '${DIST_BACKUP_PATH:-}' ] && [ -d '${DIST_BACKUP_PATH:-}' ]; then
      rm -rf '$REMOTE_DIR'/dist
      cp -a '${DIST_BACKUP_PATH:-}' '$REMOTE_DIR'/dist
    fi
    sudo systemctl restart '$SERVICE'
  " || true
}

run_remote_architecture_contracts() {
  if [ "$RUN_REMOTE_CONTRACTS" != "1" ]; then
    echo "Skipping remote architecture contracts (RUN_REMOTE_CONTRACTS=$RUN_REMOTE_CONTRACTS)"
    return 0
  fi

  echo "Running remote architecture contracts..."
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
    cd '$REMOTE_DIR'
    .venv/bin/python scripts/check_architecture_contracts.py
  "
}

run_remote_smoke_test() {
  if [ "$RUN_REMOTE_SMOKE" != "1" ]; then
    echo "Skipping remote smoke test (RUN_REMOTE_SMOKE=$RUN_REMOTE_SMOKE)"
    return 0
  fi

  echo "Running remote smoke test..."
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
    if [ -z \"\${ADMIN_PASSWORD:-}\" ]; then
      if [ '$REQUIRE_REMOTE_SMOKE' = '1' ]; then
        echo 'ADMIN_PASSWORD is not set on remote; smoke test is required'
        exit 1
      fi
      echo 'Skipping remote smoke test: ADMIN_PASSWORD is not set on remote'
      exit 0
    fi
    if [ ! -f /tmp/smoke_test.py ]; then
      cp '$REMOTE_DIR'/scripts/smoke_test.py /tmp/smoke_test.py
    fi
    cd /home/Administrator
    python3 /tmp/smoke_test.py '$SMOKE_BASE_URL' \"\$ADMIN_PASSWORD\"
  "
}

echo "Creating remote backups..."
BACKUP_INFO=$(
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
    ts=\$(date +%Y%m%d%H%M%S)
    cluster_bak='$REMOTE_DIR'/cluster_main.py.bak.\$ts
    cp '$REMOTE_DIR'/cluster_main.py \"\$cluster_bak\"
    dist_bak=''
    if [ -d '$REMOTE_DIR'/dist ]; then
      dist_bak='$REMOTE_DIR'/dist.bak.\$ts
      cp -a '$REMOTE_DIR'/dist \"\$dist_bak\"
    fi
    printf '%s\n%s\n' \"\$cluster_bak\" \"\$dist_bak\"
  "
)
BACKUP_PATH=$(printf "%s\n" "$BACKUP_INFO" | sed -n '1p')
DIST_BACKUP_PATH=$(printf "%s\n" "$BACKUP_INFO" | sed -n '2p')
echo "cluster_main backup: $BACKUP_PATH"
if [ -n "$DIST_BACKUP_PATH" ]; then
  echo "dist backup: $DIST_BACKUP_PATH"
else
  echo "dist backup: skipped (remote dist missing)"
fi

for path in "${FILES[@]}"; do
  mkdir -p "$STAGING_DIR/$(dirname "$path")"
  cp -R "$path" "$STAGING_DIR/$path"
done

echo "Uploading MVC/API management files..."
if ! scp -r "${SSH_OPTS[@]}" "$STAGING_DIR"/. "$REMOTE:$REMOTE_DIR/"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: backend upload failed"
  exit 1
fi

ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -f '$REMOTE_DIR'/api_router.py"

echo "Packing frontend source..."
tar \
  --exclude='new_html/node_modules' \
  --exclude='new_html/.env' \
  --exclude='new_html/.env.*' \
  --exclude='new_html/coverage' \
  -czf "$STAGING_DIR/new_html-src.tgz" \
  new_html

echo "Uploading frontend source..."
if ! scp "${SSH_OPTS[@]}" "$STAGING_DIR/new_html-src.tgz" "$REMOTE:$FRONTEND_TAR_REMOTE"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: frontend upload failed"
  exit 1
fi

echo "Building frontend on remote..."
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
  mkdir -p '$REMOTE_DIR'/new_html
  tar -tzf '$FRONTEND_TAR_REMOTE' | awk -F/ '\$1 == \"new_html\" && NF > 1 {print \$2}' | sort -u | while read -r item; do
    case \"\$item\" in
      node_modules|.env|.env.*|'') ;;
      *) rm -rf '$REMOTE_DIR'/new_html/\"\$item\" ;;
    esac
  done
  tar -xzf '$FRONTEND_TAR_REMOTE' -C '$REMOTE_DIR'
  rm -f '$FRONTEND_TAR_REMOTE'
  cd '$REMOTE_DIR'/new_html
  npm run build || (npm ci && npm run build)
"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: frontend build failed"
  exit 1
fi

echo "Restarting $SERVICE..."
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo systemctl restart '$SERVICE'"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: service restart failed"
  exit 1
fi

echo "Waiting for service..."
sleep 8
ACTIVE=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "systemctl is-active '$SERVICE' || true")
echo "Service status: $ACTIVE"

if [ "$ACTIVE" != "active" ]; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: service inactive"
  exit 1
fi

if ! run_remote_architecture_contracts; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: remote architecture contracts failed"
  exit 1
fi

if ! run_remote_smoke_test; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: remote smoke test failed"
  exit 1
fi

echo "✅ 部署成功"
