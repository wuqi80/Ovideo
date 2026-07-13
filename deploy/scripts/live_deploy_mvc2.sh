#!/usr/bin/env bash
set -e

REMOTE="${REMOTE:-root@43.98.197.227}"
REMOTE_DIR="${REMOTE_DIR:-/home/Administrator/deploy}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/google_compute_engine}"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no)
SERVICE="${SERVICE:-drama.service}"
FRONTEND_TAR_REMOTE="/tmp/mecha-new_html-src.tgz"
FRONTEND_HASH_REMOTE="${FRONTEND_HASH_REMOTE:-$REMOTE_DIR/.new_html_build_source.sha256}"
FORCE_FRONTEND_BUILD="${FORCE_FRONTEND_BUILD:-0}"
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
  "cluster_config.py"
  "cluster_config_generated.py"
  "config.py"
  "auto_deploy_cluster.py"
  "compose_service.py"
  "admin_routes.py"
  "admin_api_config_routes.py"
  "admin_recycle_bin_routes.py"
  "api_routes.py"
  "ARCHITECTURE.md"
  "Agent.md"
  "login.html"
  "admin"
  "core"
  "dao"
  "docs"
  "routers"
  "schemas"
  "services"
  "sql"
  "utils"
  "workflows"
  "external_api/video/base.py"
  "external_api/video/dashscope.py"
  "external_api/video/minimax.py"
  "external_api/video/seedance.py"
  "external_api/video/sora2.py"
  "external_api/video/veo.py"
  "external_api/video/wan2.py"
  "external_api/audio/minimax_audio.py"
  "scripts/live_deploy_mvc2.sh"
  "scripts/audit_storage_manifest.py"
  "scripts/build_clean_migration_package.py"
  "scripts/package_storage_orphans.py"
  "scripts/restructure_storage_manifest.py"
  "scripts/register_gpu_agent.py"
  "scripts/windows_gpu_agent_runner.py"
  "scripts/windows_gpu_node_diagnose.cmd"
  "scripts/windows_gpu_node_diagnose.ps1"
  "scripts/windows_gpu_node_install.cmd"
  "scripts/windows_gpu_node_install.ps1"
  scripts/check_*.py
  tests/test_ai_proxy_image_persistence_service.py
  tests/test_ai_proxy_reference_service.py
  tests/test_ai_proxy_task_service.py
  tests/test_api_provider_runtime_model_env.py
  tests/test_admin_stats_logs.py
  tests/test_admin_compat_service.py
  tests/test_api_config_key_backup.py
  tests/test_asset_service.py
  tests/test_audio_provider.py
  tests/test_audio_generation_service.py
  tests/test_audio_minimax_content_service.py
  tests/test_audio_minimax_file_service.py
  tests/test_audio_minimax_voice_service.py
  tests/test_auth_user_service.py
  tests/test_canvas_service.py
  tests/test_comfyui_file_service.py
  tests/test_content_file_dao.py
  tests/test_content_version_service.py
  tests/test_dao_api_config_category.py
  tests/test_episode_compose_service.py
  tests/test_episode_service.py
  tests/test_episode_video_service.py
  tests/test_entity_file_service.py
  tests/test_file_route_service.py
  tests/test_legacy_file_service.py
  tests/test_minimax_tts_sync.py
  tests/test_minimax_audio_runtime.py
  tests/test_prompt_service.py
  tests/test_project_read_access.py
  tests/test_project_image_service.py
  tests/test_project_save_service.py
  tests/test_project_read_service.py
  tests/test_project_video_task_service.py
  tests/test_project_admin_service.py
  tests/test_project_core_service.py
  tests/test_script_timeline_service.py
  tests/test_storyboard_service.py
  tests/test_storyboard_stale_script_fallback.py
  tests/test_task_read_service.py
  tests/test_task_notification_service.py
  tests/test_user_session_service.py
  tests/test_user_dao_admin_delete.py
  tests/test_video_client_base.py
  tests/test_video_crop_service.py
  tests/test_video_capability_service.py
  "new_html/.env.example"
  "new_html/README.md"
  "new_html/GEMINI_API_CONFIG.md"
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

frontend_source_hash() {
  find new_html -type f \
    ! -path 'new_html/node_modules/*' \
    ! -path 'new_html/.env' \
    ! -path 'new_html/.env.*' \
    ! -path 'new_html/*.md' \
    ! -path 'new_html/coverage/*' \
    ! -path 'new_html/dist/*' \
    -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum \
    | sed -E 's/^([0-9a-f]+)[[:space:]]+\*?(.+)$/\1  \2/' \
    | sha256sum \
    | awk '{print $1}'
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

FRONTEND_SOURCE_HASH=$(frontend_source_hash)
REMOTE_FRONTEND_HASH=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
  if [ -f '$FRONTEND_HASH_REMOTE' ]; then
    cat '$FRONTEND_HASH_REMOTE'
  elif [ -d '$REMOTE_DIR'/new_html ]; then
    cd '$REMOTE_DIR'
    find new_html -type f \
      ! -path 'new_html/node_modules/*' \
      ! -path 'new_html/.env' \
      ! -path 'new_html/.env.*' \
      ! -path 'new_html/*.md' \
      ! -path 'new_html/coverage/*' \
      ! -path 'new_html/dist/*' \
      -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 sha256sum \
      | sed -E 's/^([0-9a-f]+)[[:space:]]+\*?(.+)$/\1  \2/' \
      | sha256sum \
      | awk '{print \$1}'
  fi
")
REMOTE_DIST_PRESENT=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "if [ -d '$REMOTE_DIR'/dist ]; then echo 1; else echo 0; fi")
BUILD_FRONTEND=0
if [ "$FORCE_FRONTEND_BUILD" = "1" ]; then
  BUILD_FRONTEND=1
  echo "Frontend build forced (FORCE_FRONTEND_BUILD=1)"
elif [ "$REMOTE_DIST_PRESENT" != "1" ]; then
  BUILD_FRONTEND=1
  echo "Frontend dist missing on remote; build required"
elif [ "$FRONTEND_SOURCE_HASH" != "$REMOTE_FRONTEND_HASH" ]; then
  BUILD_FRONTEND=1
  echo "Frontend source changed: local=$FRONTEND_SOURCE_HASH remote=${REMOTE_FRONTEND_HASH:-missing}"
else
  echo "Skipping frontend build: new_html source hash unchanged ($FRONTEND_SOURCE_HASH)"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "printf '%s\n' '$FRONTEND_SOURCE_HASH' > '$FRONTEND_HASH_REMOTE'"
fi

if [ "$BUILD_FRONTEND" = "1" ]; then
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
  printf '%s\n' '$FRONTEND_SOURCE_HASH' > '$FRONTEND_HASH_REMOTE'
"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: frontend build failed"
  exit 1
fi

if [ -n "$DIST_BACKUP_PATH" ]; then
echo "Preserving previous frontend assets..."
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
  if [ -d '$DIST_BACKUP_PATH'/assets ] && [ -d '$REMOTE_DIR'/dist/assets ]; then
    find '$DIST_BACKUP_PATH'/assets -maxdepth 1 -type f -exec cp -n {} '$REMOTE_DIR'/dist/assets/ \;
  fi
"; then
  rollback_remote
  echo "preserving frontend assets failed"
  exit 1
fi
fi
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
