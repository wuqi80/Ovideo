#!/usr/bin/env bash
set -e

REMOTE="${REMOTE:-root@43.98.197.227}"
REMOTE_DIR="${REMOTE_DIR:-/home/Administrator/deploy}"
REMOTE_PARENT_DIR="${REMOTE_PARENT_DIR:-$(dirname "$REMOTE_DIR")}"
STUDIO_LOCAL_DIR="${STUDIO_LOCAL_DIR:-../studio}"
STUDIO_REMOTE_DIR="${STUDIO_REMOTE_DIR:-$(dirname "$REMOTE_DIR")/studio}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/google_compute_engine}"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no)
SERVICE="${SERVICE:-drama.service}"
DEPLOY_RUN_ID="${DEPLOY_RUN_ID:-$(date +%Y%m%d%H%M%S)-$$}"
FRONTEND_TAR_REMOTE="${FRONTEND_TAR_REMOTE:-/tmp/mecha-new_html-src-$DEPLOY_RUN_ID.tgz}"
STUDIO_TAR_REMOTE="${STUDIO_TAR_REMOTE:-/tmp/mecha-studio-src-$DEPLOY_RUN_ID.tgz}"
BACKEND_TAR_REMOTE="${BACKEND_TAR_REMOTE:-/tmp/mecha-backend-src-$DEPLOY_RUN_ID.tgz}"
FRONTEND_HASH_REMOTE="${FRONTEND_HASH_REMOTE:-$REMOTE_DIR/.new_html_build_source.sha256}"
FRONTEND_DIST_HASH_REMOTE="${FRONTEND_DIST_HASH_REMOTE:-$REMOTE_DIR/dist/.new_html_build_source.sha256}"
STUDIO_HASH_REMOTE="${STUDIO_HASH_REMOTE:-$STUDIO_REMOTE_DIR/.studio_build_source.sha256}"
STUDIO_DIST_HASH_REMOTE="${STUDIO_DIST_HASH_REMOTE:-$STUDIO_REMOTE_DIR/dist/.studio_build_source.sha256}"
RELEASE_METADATA_REMOTE_CANDIDATE="${RELEASE_METADATA_REMOTE_CANDIDATE:-/tmp/mecha-release-metadata-$DEPLOY_RUN_ID.json}"
FORCE_FRONTEND_BUILD="${FORCE_FRONTEND_BUILD:-0}"
FORCE_STUDIO_BUILD="${FORCE_STUDIO_BUILD:-0}"
RUN_REMOTE_CONTRACTS="${RUN_REMOTE_CONTRACTS:-1}"
RUN_REMOTE_SMOKE="${RUN_REMOTE_SMOKE:-1}"
REQUIRE_REMOTE_SMOKE="${REQUIRE_REMOTE_SMOKE:-1}"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://spti.ai}"
GPU_AGENT_SOURCE_DIR="pipeline"
GPU_AGENT_SOURCE_NAME="comfyui_agent.py"
GPU_AGENT_REMOTE_REL="persistent_storage/tools/$GPU_AGENT_SOURCE_NAME"
PROCESSING_AGENT_PUBLIC_NAME="processing_agent.py"
PROCESSING_AGENT_REMOTE_REL="persistent_storage/tools/$PROCESSING_AGENT_PUBLIC_NAME"
GPU_AGENT_PUBLIC_TOOL_FILES=(
  "scripts/windows_gpu_agent_runner.py"
  "scripts/windows_gpu_resource_guard.py"
  "scripts/windows_gpu_cleanup_port.ps1"
  "scripts/windows_gpu_wait_for_dfs.ps1"
  "scripts/windows_gpu_wait_for_dfs.cmd"
  "scripts/windows_gpu_h3_setup.ps1"
  "scripts/windows_gpu_h3_setup.cmd"
  "scripts/windows_gpu_h3_smoke.py"
  "scripts/windows_gpu_h3_smoke.cmd"
  "scripts/windows_gpu_start_h3_comfyui.cmd"
  "scripts/windows_gpu_start_agent.cmd"
)

if [ ! -f "cluster_main.py" ] || [ ! -d "routers" ] || [ ! -d "schemas" ] || [ ! -d "services" ] || [ ! -d "utils" ] || [ ! -d "new_html" ]; then
  echo "ERROR: run this script from the deploy/ directory"
  exit 1
fi
if [ ! -f "$STUDIO_LOCAL_DIR/package.json" ] || [ ! -f "$STUDIO_LOCAL_DIR/vite.config.ts" ]; then
  echo "ERROR: sibling Studio source is missing: $STUDIO_LOCAL_DIR"
  exit 1
fi

FILES=(
  # Keep root-level compatibility modules and route entrypoints in lockstep.
  # New modules must not require a manual deploy-list update.
  *.py
  "cluster_main.py"
  "cluster_config.py"
  "cluster_config_generated.py"
  "config.py"
  "auto_deploy_cluster.py"
  "auto_deploy.sh"
  "agent_routes.py"
  "audio_mix_service.py"
  "compose_service.py"
  "admin_routes.py"
  "admin_api_config_routes.py"
  "admin_recycle_bin_routes.py"
  "api_routes.py"
  "dao_character_voice.py"
  "dao_episode_script_conversation.py"
  "media_library_routes.py"
  "video_reverse_routes.py"
  "dao_video_voice_reference.py"
  "ARCHITECTURE.md"
  "Agent.md"
  "login.html"
  db_migration_*.sql
  "admin"
  "static"
  "core"
  "dao"
  "docs"
  "routers"
  "schemas"
  "services"
  "pipeline"
  "db_build"
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
  "scripts/apply_migrations.py"
  "scripts/repair_verified_workflow_templates.py"
  "scripts/smoke_test.py"
  "scripts/audit_storage_manifest.py"
  "scripts/build_clean_migration_package.py"
  "scripts/package_storage_orphans.py"
  "scripts/restructure_storage_manifest.py"
  "scripts/register_gpu_agent.py"
  "scripts/test_gpu2_end_to_end.py"
  "scripts/windows_gpu_agent_runner.py"
  "scripts/windows_gpu_resource_guard.py"
  "scripts/windows_gpu_cleanup_port.ps1"
  "scripts/windows_gpu_wait_for_dfs.ps1"
  "scripts/windows_gpu_wait_for_dfs.cmd"
  "scripts/windows_gpu_node_diagnose.cmd"
  "scripts/windows_gpu_node_diagnose.ps1"
  "scripts/windows_gpu_node_install.cmd"
  "scripts/windows_gpu_node_install.ps1"
  "scripts/windows_gpu_node_schedule_install.cmd"
  "scripts/windows_gpu_node_status.cmd"
  "scripts/windows_gpu_node_verify.cmd"
  "scripts/windows_gpu_node_install_vc_runtime.cmd"
  "scripts/windows_gpu_node_fix_seedvr.cmd"
  "scripts/windows_gpu_seedvr_smoke.py"
  "scripts/windows_gpu_seedvr_smoke.cmd"
  "scripts/windows_gpu_seedvr_smoke_schedule.cmd"
  "scripts/windows_gpu_seedvr_tuning_smoke.cmd"
  "scripts/windows_gpu_seedvr_tuning_schedule.cmd"
  "scripts/windows_gpu_monitor.cmd"
  "scripts/windows_gpu_start_comfyui.cmd"
  "scripts/windows_gpu_start_agent.cmd"
  "scripts/windows_gpu_start_h3_comfyui.cmd"
  "scripts/windows_gpu_enable_lan.cmd"
  "scripts/windows_gpu_h3_setup.ps1"
  "scripts/windows_gpu_h3_setup.cmd"
  "scripts/windows_gpu_h3_smoke.py"
  "scripts/windows_gpu_h3_smoke.cmd"
  "scripts/windows_gpu_qwen_setup.ps1"
  "scripts/windows_gpu_qwen_setup.cmd"
  "scripts/windows_gpu_qwen_schedule.cmd"
  "scripts/windows_gpu_qwen_smoke.py"
  "scripts/windows_gpu_qwen_smoke.cmd"
  "scripts/windows_gpu_video_setup.ps1"
  "scripts/windows_gpu_video_setup.cmd"
  "scripts/windows_gpu_video_schedule.cmd"
  "scripts/windows_gpu_video_smoke.py"
  "scripts/windows_gpu_video_smoke.cmd"
  "scripts/windows_gpu_wan_setup.ps1"
  "scripts/windows_gpu_wan_setup.cmd"
  "scripts/windows_gpu_wan_install_task.cmd"
  "scripts/windows_gpu_wan_smoke.py"
  "scripts/windows_gpu_wan_smoke.cmd"
  "scripts/windows_gpu_wan_smoke_task.cmd"
  "scripts/windows_gpu_task_repair.cmd"
  "scripts/windows_gpu_task_repair.ps1"
  scripts/*.mjs
  scripts/*.py
  scripts/check_*.py
  tests/*.py
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
  tests/test_cluster_node_service.py
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
  tests/test_video_interpolation_service.py
  tests/test_video_capability_service.py
  tests/test_windows_gpu_agent_runner.py
  tests/test_windows_gpu_resource_guard.py
  tests/test_generation_workflow_fallback.py
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
if [ ! -f "$GPU_AGENT_SOURCE_DIR/$GPU_AGENT_SOURCE_NAME" ]; then
  echo "ERROR: missing GPU agent source"
  exit 1
fi

STAGING_DIR=$(mktemp -d)
BACKEND_TAR_LOCAL="${STAGING_DIR}.tgz"
RELEASE_METADATA_LOCAL=""
cleanup() {
  rm -rf "$STAGING_DIR"
  rm -f "$BACKEND_TAR_LOCAL"
  if [ -n "$RELEASE_METADATA_LOCAL" ]; then
    rm -f "$RELEASE_METADATA_LOCAL"
  fi
}
trap cleanup EXIT

rollback_remote() {
  echo "Rolling back remote cluster_main.py, workflows, main dist, and Studio dist..."
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
    latest=\$(ls -1t '$REMOTE_DIR'/cluster_main.py.bak.* 2>/dev/null | head -n 1 || true)
    if [ -n \"\$latest\" ]; then
      cp \"\$latest\" '$REMOTE_DIR'/cluster_main.py
    fi
    if [ -n '${DIST_BACKUP_PATH:-}' ] && [ -d '${DIST_BACKUP_PATH:-}' ]; then
      rm -rf '$REMOTE_DIR'/dist
      cp -a '${DIST_BACKUP_PATH:-}' '$REMOTE_DIR'/dist
    fi
    if [ -n '${STUDIO_DIST_BACKUP_PATH:-}' ] && [ -d '${STUDIO_DIST_BACKUP_PATH:-}' ]; then
      rm -rf '$STUDIO_REMOTE_DIR'/dist
      cp -a '${STUDIO_DIST_BACKUP_PATH:-}' '$STUDIO_REMOTE_DIR'/dist
    elif [ -d '$STUDIO_REMOTE_DIR'/dist ]; then
      rm -rf '$STUDIO_REMOTE_DIR'/dist
    fi
    if [ -n '${WORKFLOWS_BACKUP_PATH:-}' ] && [ -d '${WORKFLOWS_BACKUP_PATH:-}' ]; then
      mkdir -p '$REMOTE_DIR'/workflows
      find '$REMOTE_DIR'/workflows -mindepth 1 -maxdepth 1 -type f -delete
      cp -a '${WORKFLOWS_BACKUP_PATH:-}'/. '$REMOTE_DIR'/workflows
    fi
    if [ -n '${TESTS_BACKUP_PATH:-}' ] && [ -d '${TESTS_BACKUP_PATH:-}' ]; then
      rm -rf '$REMOTE_DIR'/tests
      cp -a '${TESTS_BACKUP_PATH:-}' '$REMOTE_DIR'/tests
    fi
    rm -f '$FRONTEND_HASH_REMOTE' '$RELEASE_METADATA_REMOTE_CANDIDATE'
    rm -f '$STUDIO_HASH_REMOTE'
    chown Administrator:Administrator '$REMOTE_DIR'
    chmod 755 '$REMOTE_DIR'
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

studio_source_hash() {
  (
    cd "$STUDIO_LOCAL_DIR"
    find . -type f \
      ! -path './node_modules/*' \
      ! -path './.env' \
      ! -path './.env.*' \
      ! -path './coverage/*' \
      ! -path './dist/*' \
      -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 sha256sum \
      | sed -E 's/^([0-9a-f]+)[[:space:]]+\*?\.\/(.+)$/\1  \2/' \
      | sha256sum \
      | awk '{print $1}'
  )
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
    cp '$REMOTE_DIR'/scripts/smoke_test.py /tmp/smoke_test.py
    cd /home/Administrator
    if [ -z \"\${ADMIN_PASSWORD:-}\" ]; then
      echo 'ADMIN_PASSWORD is not set on remote; running required public/security smoke checks'
      PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python3 /tmp/smoke_test.py '$SMOKE_BASE_URL' --public-only
      exit \$?
    fi
    PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python3 /tmp/smoke_test.py '$SMOKE_BASE_URL' \"\$ADMIN_PASSWORD\"
  "
}

run_remote_db_migrations() {
  echo "Running remote database migrations..."
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
    cd '$REMOTE_DIR'
    set -a
    . configs/runtime.env
    set +a
    setfacl -m u:postgres:--x /home/Administrator
    sudo -u postgres env \
      DB_HOST=/tmp \
      DB_PORT=\"\${DB_PORT:-5432}\" \
      DB_NAME=\"\${DB_NAME:-my2_db}\" \
      DB_USER=postgres \
      DB_PASSWORD= \
      GIT_SHA='$RELEASE_GIT_SHA' \
      '$REMOTE_DIR'/.venv/bin/python scripts/apply_migrations.py \
        --root . \
        --manifest db_build/manifest.txt
    sudo -u postgres env \
      DB_HOST=/tmp \
      DB_PORT=\"\${DB_PORT:-5432}\" \
      DB_NAME=\"\${DB_NAME:-my2_db}\" \
      DB_USER=postgres \
      DB_PASSWORD= \
      '$REMOTE_DIR'/.venv/bin/python scripts/repair_verified_workflow_templates.py
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
    studio_dist_bak=''
    if [ -d '$STUDIO_REMOTE_DIR'/dist ]; then
      studio_dist_bak='$STUDIO_REMOTE_DIR'/dist.bak.\$ts
      cp -a '$STUDIO_REMOTE_DIR'/dist \"\$studio_dist_bak\"
    fi
    workflows_bak=''
    if [ -d '$REMOTE_DIR'/workflows ]; then
      workflows_bak='$REMOTE_DIR'/workflows.bak.\$ts
      cp -a '$REMOTE_DIR'/workflows \"\$workflows_bak\"
    fi
    tests_bak=''
    if [ -d '$REMOTE_DIR'/tests ]; then
      tests_bak='$REMOTE_PARENT_DIR'/deploy-tests.bak.\$ts
      cp -a '$REMOTE_DIR'/tests \"\$tests_bak\"
    fi
    printf '%s\n%s\n%s\n%s\n%s\n' \"\$cluster_bak\" \"\$dist_bak\" \"\$studio_dist_bak\" \"\$workflows_bak\" \"\$tests_bak\"
  "
)
BACKUP_PATH=$(printf "%s\n" "$BACKUP_INFO" | sed -n '1p')
DIST_BACKUP_PATH=$(printf "%s\n" "$BACKUP_INFO" | sed -n '2p')
STUDIO_DIST_BACKUP_PATH=$(printf "%s\n" "$BACKUP_INFO" | sed -n '3p')
WORKFLOWS_BACKUP_PATH=$(printf "%s\n" "$BACKUP_INFO" | sed -n '4p')
TESTS_BACKUP_PATH=$(printf "%s\n" "$BACKUP_INFO" | sed -n '5p')
echo "cluster_main backup: $BACKUP_PATH"
if [ -n "$DIST_BACKUP_PATH" ]; then
  echo "dist backup: $DIST_BACKUP_PATH"
else
  echo "dist backup: skipped (remote dist missing)"
fi
if [ -n "$STUDIO_DIST_BACKUP_PATH" ]; then
  echo "Studio dist backup: $STUDIO_DIST_BACKUP_PATH"
else
  echo "Studio dist backup: skipped (remote Studio dist missing)"
fi
if [ -n "$WORKFLOWS_BACKUP_PATH" ]; then
  echo "workflows backup: $WORKFLOWS_BACKUP_PATH"
else
  echo "workflows backup: skipped (remote workflows missing)"
fi
if [ -n "$TESTS_BACKUP_PATH" ]; then
  echo "tests backup: $TESTS_BACKUP_PATH"
else
  echo "tests backup: skipped (remote tests missing)"
fi

for path in "${FILES[@]}"; do
  mkdir -p "$STAGING_DIR/$(dirname "$path")"
  cp -R "$path" "$STAGING_DIR/$path"
done
mkdir -p "$STAGING_DIR/$(dirname "$GPU_AGENT_REMOTE_REL")"
cp "$GPU_AGENT_SOURCE_DIR/$GPU_AGENT_SOURCE_NAME" \
  "$STAGING_DIR/$GPU_AGENT_REMOTE_REL"
cp "$GPU_AGENT_SOURCE_DIR/$GPU_AGENT_SOURCE_NAME" \
  "$STAGING_DIR/$PROCESSING_AGENT_REMOTE_REL"
for tool_path in "${GPU_AGENT_PUBLIC_TOOL_FILES[@]}"; do
  tool_name="$(basename "$tool_path")"
  tool_remote_rel="persistent_storage/tools/$tool_name"
  mkdir -p "$STAGING_DIR/$(dirname "$tool_remote_rel")"
  cp "$tool_path" "$STAGING_DIR/$tool_remote_rel"
done

BACKEND_SOURCE_HASH=$(
  find "$STAGING_DIR" -type f -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum \
    | sed -E "s#^([0-9a-f]+)[[:space:]]+\*?$STAGING_DIR/#\1  #" \
    | sha256sum \
    | awk '{print $1}'
)
RELEASE_GIT_SHA=$(git rev-parse HEAD 2>/dev/null || printf 'unknown')
RELEASE_GIT_DIRTY=false
# The Windows working tree is sometimes deployed from WSL/bash. In that view
# git status can report hundreds of CRLF/LF-only changes even when Windows git
# and the actual deploy source are clean. Release metadata should only mark a
# build dirty for real tracked content changes, not line-ending noise.
if ! git -c core.filemode=false diff --quiet --ignore-space-at-eol --no-ext-diff -- . 2>/dev/null || \
   ! git -c core.filemode=false diff --cached --quiet --ignore-space-at-eol --no-ext-diff -- . 2>/dev/null; then
  RELEASE_GIT_DIRTY=true
fi

echo "Uploading MVC/API management files..."
tar -C "$STAGING_DIR" -czf "$BACKEND_TAR_LOCAL" .
if ! scp "${SSH_OPTS[@]}" "$BACKEND_TAR_LOCAL" "$REMOTE:$BACKEND_TAR_REMOTE"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: backend upload failed"
  exit 1
fi

if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
  mkdir -p '$REMOTE_DIR'
  mkdir -p '$REMOTE_DIR'/workflows
  find '$REMOTE_DIR' -mindepth 1 -maxdepth 1 -type d -name 'tests.bak.*' -exec rm -rf -- {} +
  rm -rf '$REMOTE_DIR'/tests
  # Overlay versioned workflows without deleting valid templates uploaded from
  # the admin console. The remote backup remains available for rollback.
  tar -xzf '$BACKEND_TAR_REMOTE' -C '$REMOTE_DIR'
  rm -f '$BACKEND_TAR_REMOTE'
"; then
  rollback_remote
  echo "Deployment rolled back: backend extract failed"
  exit 1
fi

# scp preserves the 0700 mode of mktemp's staging root when copying `.`.
# Restore the application root traversal permission required by the service user.
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
  chown Administrator:Administrator '$REMOTE_DIR'
  chmod 755 '$REMOTE_DIR'
  mkdir -p '$REMOTE_DIR/persistent_storage/tools'
  find '$REMOTE_DIR/persistent_storage/tools' -maxdepth 1 -type f -exec chown Administrator:Administrator {} +
  find '$REMOTE_DIR/persistent_storage/tools' -maxdepth 1 -type f -exec chmod 644 {} +
"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: application root permissions failed"
  exit 1
fi

ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -f '$REMOTE_DIR'/api_router.py"

if ! run_remote_db_migrations; then
  rollback_remote
  echo "鈿狅笍 閮ㄧ讲澶辫触锛屽凡鍥炴粴: database migrations failed"
  exit 1
fi

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
REMOTE_DIST_HASH=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "if [ -f '$FRONTEND_DIST_HASH_REMOTE' ]; then cat '$FRONTEND_DIST_HASH_REMOTE'; fi")
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
elif [ "$FRONTEND_SOURCE_HASH" != "$REMOTE_DIST_HASH" ]; then
  BUILD_FRONTEND=1
  echo "Frontend dist marker missing or stale: local=$FRONTEND_SOURCE_HASH dist=${REMOTE_DIST_HASH:-missing}"
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
  printf '%s\n' '$FRONTEND_SOURCE_HASH' > '$FRONTEND_DIST_HASH_REMOTE'
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

STUDIO_SOURCE_HASH=$(studio_source_hash)
REMOTE_STUDIO_HASH=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "if [ -f '$STUDIO_HASH_REMOTE' ]; then cat '$STUDIO_HASH_REMOTE'; fi")
REMOTE_STUDIO_DIST_PRESENT=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "if [ -d '$STUDIO_REMOTE_DIR'/dist ]; then echo 1; else echo 0; fi")
REMOTE_STUDIO_DIST_HASH=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "if [ -f '$STUDIO_DIST_HASH_REMOTE' ]; then cat '$STUDIO_DIST_HASH_REMOTE'; fi")
BUILD_STUDIO=0
if [ "$FORCE_STUDIO_BUILD" = "1" ]; then
  BUILD_STUDIO=1
  echo "Studio build forced (FORCE_STUDIO_BUILD=1)"
elif [ "$REMOTE_STUDIO_DIST_PRESENT" != "1" ]; then
  BUILD_STUDIO=1
  echo "Studio dist missing on remote; build required"
elif [ "$STUDIO_SOURCE_HASH" != "$REMOTE_STUDIO_HASH" ]; then
  BUILD_STUDIO=1
  echo "Studio source changed: local=$STUDIO_SOURCE_HASH remote=${REMOTE_STUDIO_HASH:-missing}"
elif [ "$STUDIO_SOURCE_HASH" != "$REMOTE_STUDIO_DIST_HASH" ]; then
  BUILD_STUDIO=1
  echo "Studio dist marker missing or stale"
else
  echo "Skipping Studio build: source hash unchanged ($STUDIO_SOURCE_HASH)"
fi

if [ "$BUILD_STUDIO" = "1" ]; then
  tar \
    --exclude='./node_modules' \
    --exclude='./.env' \
    --exclude='./.env.*' \
    --exclude='./coverage' \
    --exclude='./dist' \
    -C "$STUDIO_LOCAL_DIR" \
    -czf "$STAGING_DIR/studio-src.tgz" \
    .

  if ! scp "${SSH_OPTS[@]}" "$STAGING_DIR/studio-src.tgz" "$REMOTE:$STUDIO_TAR_REMOTE"; then
    rollback_remote
    echo "Deployment rolled back: Studio upload failed"
    exit 1
  fi

  if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
    mkdir -p '$STUDIO_REMOTE_DIR'
    find '$STUDIO_REMOTE_DIR' -mindepth 1 -maxdepth 1 \
      ! -name node_modules \
      ! -name .env \
      ! -name '.env.*' \
      -exec rm -rf -- {} +
    tar -xzf '$STUDIO_TAR_REMOTE' -C '$STUDIO_REMOTE_DIR'
    rm -f '$STUDIO_TAR_REMOTE'
    cd '$STUDIO_REMOTE_DIR'
    npm run build || (npm ci && npm run build)
    printf '%s\n' '$STUDIO_SOURCE_HASH' > '$STUDIO_HASH_REMOTE'
    printf '%s\n' '$STUDIO_SOURCE_HASH' > '$STUDIO_DIST_HASH_REMOTE'
  "; then
    rollback_remote
    echo "Deployment rolled back: Studio build failed"
    exit 1
  fi

  if [ -n "$STUDIO_DIST_BACKUP_PATH" ]; then
    if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
      if [ -d '$STUDIO_DIST_BACKUP_PATH'/assets ] && [ -d '$STUDIO_REMOTE_DIR'/dist/assets ]; then
        find '$STUDIO_DIST_BACKUP_PATH'/assets -maxdepth 1 -type f -exec cp -n {} '$STUDIO_REMOTE_DIR'/dist/assets/ \;
      fi
    "; then
      rollback_remote
      echo "preserving previous Studio assets failed"
      exit 1
    fi
  fi
fi

RELEASED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RELEASE_METADATA_LOCAL=$(mktemp)
printf '%s\n' \
  "{\"git_sha\":\"$RELEASE_GIT_SHA\",\"git_dirty\":$RELEASE_GIT_DIRTY,\"backend_source_sha256\":\"$BACKEND_SOURCE_HASH\",\"frontend_source_sha256\":\"$FRONTEND_SOURCE_HASH\",\"studio_source_sha256\":\"$STUDIO_SOURCE_HASH\",\"released_at\":\"$RELEASED_AT\"}" \
  > "$RELEASE_METADATA_LOCAL"
if ! scp "${SSH_OPTS[@]}" "$RELEASE_METADATA_LOCAL" "$REMOTE:$RELEASE_METADATA_REMOTE_CANDIDATE"; then
  rollback_remote
  echo "ERROR: release metadata upload failed"
  exit 1
fi

echo "Restarting $SERVICE..."
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo systemctl restart '$SERVICE'"; then
  rollback_remote
  echo "⚠️ 部署失败，已回滚: service restart failed"
  exit 1
fi

echo "Waiting for service..."
ACTIVE=""
for _ in $(seq 1 20); do
  sleep 3
  ACTIVE=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "systemctl is-active '$SERVICE' || true")
  if [ "$ACTIVE" = "active" ]; then
    break
  fi
done
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

if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -e
  mv '$RELEASE_METADATA_REMOTE_CANDIDATE' '$REMOTE_DIR/release_metadata.json'
  chown Administrator:Administrator '$REMOTE_DIR/release_metadata.json'
  chmod 644 '$REMOTE_DIR/release_metadata.json'
"; then
  echo "ERROR: deployment succeeded but release metadata activation failed"
  exit 1
fi

echo "✅ 部署成功"
