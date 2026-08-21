#!/bin/sh
set -eu

attempt=1
until python db_build/build_fresh_db.py; do
  if [ "$attempt" -ge 30 ]; then
    echo "Database migrations did not become ready after 30 attempts" >&2
    exit 1
  fi
  echo "Database is not ready; retrying migration in 2 seconds ($attempt/30)" >&2
  attempt=$((attempt + 1))
  sleep 2
done

# Verified workflow repair is idempotent and runs only after the schema is ready.
# It restores canonical templates without deleting administrator-uploaded files.
python scripts/repair_verified_workflow_templates.py

# GPU workers update themselves from these published, version-matched tools. The
# allowlist is intentionally explicit: adding a runtime helper requires review
# and a deploy-contract test.
install -d -m 0755 persistent_storage/tools
cp pipeline/comfyui_agent.py persistent_storage/tools/processing_agent.py
for tool_name in \
  windows_gpu_agent_runner.py \
  windows_gpu_resource_guard.py \
  windows_gpu_cleanup_port.ps1 \
  windows_gpu_wait_for_dfs.ps1 \
  windows_gpu_wait_for_dfs.cmd \
  windows_gpu_h3_setup.ps1 \
  windows_gpu_h3_smoke.py \
  windows_gpu_h3_sage_verify.py \
  windows_gpu_h3_long_video_verify.py \
  windows_gpu_start_music3_comfyui.cmd \
  windows_gpu_start_music3_comfyui.ps1 \
  windows_gpu_music3_compat_patch.py
do
  cp "scripts/$tool_name" "persistent_storage/tools/$tool_name"
done

exec python cluster_main.py
