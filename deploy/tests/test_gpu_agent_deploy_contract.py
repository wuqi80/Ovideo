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


def test_gpu_agent_version_keeps_control_capability_marker():
    source = (
        DEPLOY_DIR / "pipeline" / "comfyui_agent.py"
    ).read_text(encoding="utf-8")

    assert 'AGENT_VERSION = "2026-07-24-agent-control-completion-recovery-v1"' in source
