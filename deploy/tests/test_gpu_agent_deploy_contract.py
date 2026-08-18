from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_live_deploy_publishes_gpu_agent_for_self_update():
    script = (
        DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh"
    ).read_text(encoding="utf-8")

    assert 'GPU_AGENT_SOURCE_DIR="pipeline"' in script
    assert 'GPU_AGENT_SOURCE_NAME="comfyui_agent.py"' in script
    assert 'GPU_AGENT_REMOTE_REL="persistent_storage/tools/$GPU_AGENT_SOURCE_NAME"' in script
    assert 'cp "$GPU_AGENT_SOURCE_DIR/$GPU_AGENT_SOURCE_NAME"' in script
    assert '"$STAGING_DIR/$GPU_AGENT_REMOTE_REL"' in script
    assert 'PROCESSING_AGENT_PUBLIC_NAME="processing_agent.py"' in script
    assert '"$STAGING_DIR/$PROCESSING_AGENT_REMOTE_REL"' in script
    assert 'GPU_AGENT_PUBLIC_TOOL_FILES=(' in script
    assert '"scripts/windows_gpu_agent_runner.py"' in script
    assert '"scripts/windows_gpu_resource_guard.py"' in script
    assert '"scripts/windows_gpu_cleanup_port.ps1"' in script
    assert '"scripts/windows_gpu_wait_for_dfs.ps1"' in script
    assert '"scripts/windows_gpu_wait_for_dfs.cmd"' in script
    assert '"scripts/windows_gpu_h3_setup.ps1"' in script
    assert '"scripts/windows_gpu_h3_smoke.py"' in script
    assert '"scripts/windows_gpu_h3_sage_verify.py"' in script
    assert '"scripts/windows_gpu_h3_long_video_verify.py"' in script
    assert '"scripts/windows_gpu_start_music3_comfyui.cmd"' in script
    assert '"scripts/windows_gpu_start_music3_comfyui.ps1"' in script
    assert '"scripts/windows_gpu_music3_compat_patch.py"' in script
    assert 'persistent_storage/tools/$tool_name' in script


def test_gpu_agent_version_keeps_control_capability_marker():
    source = (
        DEPLOY_DIR / "pipeline" / "comfyui_agent.py"
    ).read_text(encoding="utf-8")

    assert 'AGENT_VERSION = "2026-08-18-music3-v1"' in source
    assert "install_h3_sidecar" in source
    assert "minimax_h3_fl2va" in source
    assert "windows_gpu_start_music3_comfyui.cmd" in source
    assert "windows_gpu_start_music3_comfyui.ps1" in source
    assert "windows_gpu_music3_compat_patch.py" in source


def test_gpu2_runner_bootstraps_embedded_python_paths_before_guard_import():
    source = (
        DEPLOY_DIR / "scripts" / "windows_gpu_agent_runner.py"
    ).read_text(encoding="utf-8")

    bootstrap = source.index("_BOOTSTRAP_ROOT = Path")
    path_insert = source.index("sys.path.insert(0, _module_root_text)")
    guard_import = source.index("from scripts.windows_gpu_resource_guard import")

    assert bootstrap < path_insert < guard_import


def test_port_cleanup_matches_the_exact_listener_executable_path():
    source = (
        DEPLOY_DIR / "scripts" / "windows_gpu_cleanup_port.ps1"
    ).read_text(encoding="utf-8")

    assert "$proc.ExecutablePath" in source
    assert "[System.StringComparison]::OrdinalIgnoreCase" in source
    assert "if ($samePython -or" in source
    assert "foreach ($listenerPid in $pids)" in source
    assert "foreach ($pid in $pids)" not in source


def test_gpu_agent_heartbeats_on_a_background_thread_during_long_tasks():
    source = (
        DEPLOY_DIR / "pipeline" / "comfyui_agent.py"
    ).read_text(encoding="utf-8")

    assert "def _heartbeat_loop(self):" in source
    assert "self._start_heartbeat_thread()" in source
    assert 'name="mecha-agent-heartbeat"' in source
    assert "self._heartbeat_stop.wait(HEARTBEAT_INTERVAL)" in source


def test_h3_setup_updates_legacy_and_public_agent_start_commands():
    source = (
        DEPLOY_DIR / "scripts" / "windows_gpu_h3_setup.ps1"
    ).read_text(encoding="utf-8")

    assert "$LegacyAgentStartCmd" in source
    assert 'foreach ($candidate in @($AgentStartCmd, $LegacyAgentStartCmd))' in source
    assert "MECHA GPU ComfyUI H3 LAN" in source
    assert "RestartAgent" in source
    assert "-c $pythonScript" not in source
    assert "HuggingFaceEndpoint" in source
    assert "https://hf-mirror.com" in source
    assert 'h3-download.log' in source
    assert "Tee-Object" not in source
    assert "h3_model_downloader.py" in source
    assert "requests.get" in source
    assert "timeout=(30, 60)" in source
    assert "CHUNK_SIZE = 1 * 1024 * 1024" in source
    assert "CONNECT_FAILURE_LIMIT = 2" in source
    assert "skipping endpoint after repeated connection failures" in source
    assert "download connection failed" in source
    assert "for attempt in range(1, args.attempts + 1):" in source
    assert "for base in endpoints:" in source
    assert source.index('"https://huggingface.co"') < source.index('"https://hf-mirror.com"')
    assert '"Range"' in source
    assert '"Content-Range"' in source
    assert '"Content-Length"' in source
    assert "iter_content" in source
    assert "downloadArgs" in source
    assert 'part' in source
    assert 'ModelExpectedSizes' in source
    assert '20970379616' in source
    assert 'ComfyUI-ClipProj' in source
    assert 'e556987e6bbf9c6448dd5691fe29ce9a7a6970ae' in source
    assert 'qwen3vl_4b_fp8_scaled.safetensors' in source
    assert 'mmh3-4b-ClipProj-v3-mlp.safetensors' in source
    assert 'h3-mini-ready.json' in source


def test_h3_install_does_not_restart_or_start_a_runtime_by_default():
    setup = (
        DEPLOY_DIR / "scripts" / "windows_gpu_h3_setup.ps1"
    ).read_text(encoding="utf-8")
    agent = (
        DEPLOY_DIR / "pipeline" / "comfyui_agent.py"
    ).read_text(encoding="utf-8")

    assert "if ($RestartAgent)" in setup
    invocation_tail = setup.rsplit("Ensure-H3Python", 1)[-1]
    assert "Test-H3Readiness" not in invocation_tail
    assert '"restart_agent": bool(data.get("restart_agent", False))' in agent


def test_windows_gpu_install_defaults_agent_task_claims_to_maintenance():
    installer = (
        DEPLOY_DIR / "scripts" / "windows_gpu_node_install.ps1"
    ).read_text(encoding="utf-8")

    assert "set MECHA_GPU_AGENT_MAINTENANCE=1" in installer
