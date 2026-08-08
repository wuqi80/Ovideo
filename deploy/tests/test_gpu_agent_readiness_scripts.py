import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


queue_agent_control = importlib.import_module("queue_agent_control")
check_gpu_agent_readiness = importlib.import_module("check_gpu_agent_readiness")


def test_windows_gpu_task_repair_registers_all_startup_services_safely():
    repair_script = (SCRIPTS_DIR / "windows_gpu_task_repair.ps1").read_text(encoding="utf-8")
    launcher = (SCRIPTS_DIR / "windows_gpu_task_repair.cmd").read_text(encoding="utf-8")

    assert repair_script.lstrip().startswith("param(")
    assert repair_script.count("function Register-MechaTaskCom") == 1
    assert repair_script.count("function Ensure-AgentComfyUIPorts") == 1
    assert "-LogonType ServiceAccount" in repair_script
    assert 'Name = "MECHA-GPU-ComfyUI"' in repair_script
    assert '\n        Name = "MECHA-GPU-ComfyUI-H3"' not in repair_script
    assert 'Name = "MECHA-GPU-Agent"' in repair_script
    assert 'Disable-ScheduledTask -TaskName $legacyH3TaskName' in repair_script
    assert 'Ensure-AgentComfyUIPorts -Path $startAgentPath' in repair_script
    assert 'Ensure-AgentComfyUIPorts -Path $startAgentScriptPath' in repair_script
    assert 'Delay = "PT1M30S"' in repair_script
    assert "-RestartCount 999" in repair_script
    assert "without stopping running processes" in repair_script
    assert "https://spti.ai" in launcher
    assert "https://192.168.31.134" not in launcher


def test_windows_gpu_agent_start_defaults_to_public_backend_and_both_gpu2_ports():
    launcher = (SCRIPTS_DIR / "windows_gpu_start_agent.cmd").read_text(encoding="utf-8")

    assert 'MECHA_SERVER_URL=https://spti.ai' in launcher
    assert 'MECHA_COMFYUI_PORTS=8188' in launcher
    assert 'MECHA_COMFYUI_PORTS=8188,8189' not in launcher


@pytest.mark.asyncio
async def test_queue_agent_control_rejects_legacy_agent(monkeypatch):
    async def fake_fetch_online_agents():
        return [
            {
                "agent_id": "agent_1",
                "name": "GPU1",
                "status": "online",
                "agent_version": "legacy",
                "hostname": "gpu-host",
            }
        ]

    monkeypatch.setattr(queue_agent_control, "fetch_online_agents", fake_fetch_online_agents)

    with pytest.raises(RuntimeError) as exc:
        await queue_agent_control.ensure_control_supported(force=False)

    assert "does not support agent_control" in str(exc.value)
    assert "GPU1=legacy" in str(exc.value)


@pytest.mark.asyncio
async def test_queue_agent_control_allows_agent_control_version(monkeypatch):
    async def fake_fetch_online_agents():
        return [
            {
                "agent_id": "agent_1",
                "name": "GPU1",
                "status": "online",
                "agent_version": "2026-07-01-agent-control-v3",
                "hostname": "gpu-host",
            }
        ]

    monkeypatch.setattr(queue_agent_control, "fetch_online_agents", fake_fetch_online_agents)

    await queue_agent_control.ensure_control_supported(force=False)


@pytest.mark.asyncio
async def test_readiness_reports_legacy_agent_next_step(monkeypatch, capsys):
    monkeypatch.setattr(
        check_gpu_agent_readiness,
        "public_script_versions",
        lambda: {
            "public_storage": "2026-07-01-agent-control-v3",
            "pipeline": "2026-07-01-agent-control-v3",
        },
    )

    async def fake_check_agents():
        return [
            {
                "agent_id": "agent_1",
                "name": "GPU1",
                "status": "online",
                "agent_version": "legacy",
                "hostname": "gpu-host",
                "supports_agent_control": False,
            }
        ]

    monkeypatch.setattr(check_gpu_agent_readiness, "check_agents", fake_check_agents)

    code = await check_gpu_agent_readiness.main_async(SimpleNamespace(prebuild=False))
    out = capsys.readouterr().out

    assert code == 2
    assert "ready=false" in out
    assert "GPU Agent is still legacy" in out
    assert "curl -fsSL https://192.168.31.134/storage/tools/comfyui_agent.py" in out


@pytest.mark.asyncio
async def test_readiness_reports_ready_for_supported_agent(monkeypatch, capsys):
    monkeypatch.setattr(
        check_gpu_agent_readiness,
        "public_script_versions",
        lambda: {
            "public_storage": "2026-07-01-agent-control-v3",
            "pipeline": "2026-07-01-agent-control-v3",
        },
    )

    async def fake_check_agents():
        return [
            {
                "agent_id": "agent_1",
                "name": "GPU1",
                "status": "online",
                "agent_version": "2026-07-01-agent-control-v3",
                "hostname": "gpu-host",
                "supports_agent_control": True,
            }
        ]

    monkeypatch.setattr(check_gpu_agent_readiness, "check_agents", fake_check_agents)

    code = await check_gpu_agent_readiness.main_async(SimpleNamespace(prebuild=False))
    out = capsys.readouterr().out

    assert code == 0
    assert "ready=true" in out
    assert "diagnose_gpu_agent_workflows.py --qwen-branch-probes" in out
