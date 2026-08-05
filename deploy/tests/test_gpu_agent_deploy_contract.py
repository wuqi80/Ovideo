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
    assert '"scripts/windows_gpu_h3_setup.ps1"' in script
    assert '"scripts/windows_gpu_h3_smoke.py"' in script
    assert 'persistent_storage/tools/$tool_name' in script


def test_gpu_agent_version_keeps_control_capability_marker():
    source = (
        DEPLOY_DIR / "pipeline" / "comfyui_agent.py"
    ).read_text(encoding="utf-8")

    assert 'AGENT_VERSION = "2026-08-05-agent-control-h3-bootstrap-v1"' in source
    assert "install_h3_sidecar" in source
    assert "minimax_h3_fl2va" in source


def test_h3_setup_updates_legacy_and_public_agent_start_commands():
    source = (
        DEPLOY_DIR / "scripts" / "windows_gpu_h3_setup.ps1"
    ).read_text(encoding="utf-8")

    assert "$LegacyAgentStartCmd" in source
    assert 'foreach ($candidate in @($AgentStartCmd, $LegacyAgentStartCmd))' in source
    assert "MECHA GPU ComfyUI H3 LAN" in source
    assert "NoAgentRestart" in source
    assert "-c $pythonScript" not in source
    assert "HuggingFaceEndpoint" in source
    assert "https://hf-mirror.com" in source
    assert 'h3-download.log' in source
    assert "Tee-Object" not in source
    assert "h3_model_downloader.py" in source
    assert "requests.get" in source
    assert "timeout=(30, 60)" in source
    assert '"Range"' in source
    assert '"Content-Range"' in source
    assert '"Content-Length"' in source
    assert "iter_content" in source
    assert "downloadArgs" in source
    assert 'part' in source
    assert 'ModelExpectedSizes' in source
    assert '20970379616' in source
