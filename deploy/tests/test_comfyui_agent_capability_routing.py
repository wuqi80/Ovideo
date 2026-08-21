import signal
import threading

import requests

import pipeline.comfyui_agent as comfyui_agent_module
from pipeline.comfyui_agent import ComfyUIAgent


def _agent(monkeypatch):
    monkeypatch.setattr(signal, "signal", lambda *_args, **_kwargs: None)
    agent = ComfyUIAgent("https://example.test", "token", [8188, 8288])
    agent.agent_id = "agent_test"
    return agent


def test_pick_healthy_port_honors_strict_preferred_port(monkeypatch):
    agent = _agent(monkeypatch)
    monkeypatch.setattr(
        agent,
        "_check_comfyui",
        lambda port: "healthy" if port == 8188 else "offline",
    )

    assert agent._pick_healthy_port(preferred_port=8288, strict_preferred=True) is None
    assert agent._pick_healthy_port(preferred_port=8288, strict_preferred=False) == 8188
    assert agent._truthy("false") is False
    assert agent._truthy("true") is True


def test_pick_healthy_port_uses_preferred_port_when_available(monkeypatch):
    agent = _agent(monkeypatch)
    monkeypatch.setattr(
        agent,
        "_check_comfyui",
        lambda port: "healthy" if port == 8288 else "healthy",
    )

    assert agent._pick_healthy_port(preferred_port=8288, strict_preferred=True) == 8288


def test_capability_probe_reports_minimax_h3_only_when_all_nodes_exist(monkeypatch):
    agent = _agent(monkeypatch)

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {
                "MiniMaxH3ImageToVideo": {},
                "UNETLoader": {},
                "CLIPLoader": {},
                "VAELoader": {},
                "VAEDecode": {},
                "VAEDecodeAudio": {},
                "BasicScheduler": {},
                "KSamplerSelect": {},
                "SamplerCustomAdvanced": {},
                "BasicGuider": {},
                "RandomNoise": {},
                "CreateVideo": {},
                "SaveVideo": {},
                "PathchSageAttentionKJ": {},
                "MiniMaxH3MemoryEfficientSageAttentionPatch": {},
                "ClipProjApply": {},
            }

    monkeypatch.setattr(requests, "get", lambda *_args, **_kwargs: Response())

    capabilities = agent._probe_comfyui_capabilities(8288, "healthy")

    assert capabilities["minimax_h3_fl2va"] is True
    assert capabilities["minimax_h3_required_nodes"]["MiniMaxH3ImageToVideo"] is True
    assert capabilities["minimax_h3_fast"] is True
    assert capabilities["minimax_h3_mini"] is True


def test_background_heartbeat_continues_independently_of_task_loop(monkeypatch):
    agent = _agent(monkeypatch)
    heartbeat_seen = threading.Event()
    monkeypatch.setattr(agent, "heartbeat", heartbeat_seen.set)

    agent._start_heartbeat_thread()
    try:
        assert heartbeat_seen.wait(timeout=1)
        assert agent._heartbeat_thread.is_alive()
    finally:
        agent.running = False
        agent._stop_heartbeat_thread()

    assert not agent._heartbeat_thread.is_alive()


def test_sync_runtime_tools_updates_only_runner_and_cleanup(tmp_path, monkeypatch):
    monkeypatch.setenv("OSTORY_GPU_ROOT", str(tmp_path))
    monkeypatch.setattr(comfyui_agent_module.platform, "system", lambda: "Windows")
    agent = _agent(monkeypatch)
    sources = {
        "windows_gpu_agent_runner.py": "GPU2_H3_PORT = GPU2_COMFYUI_PORT\nclass Gpu2RuntimeManager: pass\n",
        "windows_gpu_cleanup_port.ps1": "param($WaitTimeoutSeconds, $CommandMatch)\n",
    }
    monkeypatch.setattr(
        agent,
        "_download_text_tool",
        lambda filename, _markers: (f"https://example.test/storage/tools/{filename}", sources[filename]),
    )

    result = agent._sync_runtime_tools()

    assert result["action"] == "sync_runtime_tools"
    assert result["restart"] is True
    assert (tmp_path / "agent" / "windows_gpu_agent_runner.py").read_text(encoding="utf-8") == sources[
        "windows_gpu_agent_runner.py"
    ]
    assert (tmp_path / "scripts" / "windows_gpu_cleanup_port.ps1").read_text(encoding="utf-8") == sources[
        "windows_gpu_cleanup_port.ps1"
    ]
    assert sorted(path.name for path in tmp_path.rglob("*.*")) == [
        "windows_gpu_agent_runner.py",
        "windows_gpu_cleanup_port.ps1",
    ]
