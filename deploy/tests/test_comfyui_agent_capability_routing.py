import signal
import threading

import requests

from pipeline.comfyui_agent import ComfyUIAgent


def _agent(monkeypatch):
    monkeypatch.setattr(signal, "signal", lambda *_args, **_kwargs: None)
    agent = ComfyUIAgent("https://example.test", "token", [8188, 8189])
    agent.agent_id = "agent_test"
    return agent


def test_pick_healthy_port_honors_strict_preferred_port(monkeypatch):
    agent = _agent(monkeypatch)
    monkeypatch.setattr(
        agent,
        "_check_comfyui",
        lambda port: "healthy" if port == 8188 else "offline",
    )

    assert agent._pick_healthy_port(preferred_port=8189, strict_preferred=True) is None
    assert agent._pick_healthy_port(preferred_port=8189, strict_preferred=False) == 8188
    assert agent._truthy("false") is False
    assert agent._truthy("true") is True


def test_pick_healthy_port_uses_preferred_port_when_available(monkeypatch):
    agent = _agent(monkeypatch)
    monkeypatch.setattr(
        agent,
        "_check_comfyui",
        lambda port: "healthy" if port == 8189 else "healthy",
    )

    assert agent._pick_healthy_port(preferred_port=8189, strict_preferred=True) == 8189


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
            }

    monkeypatch.setattr(requests, "get", lambda *_args, **_kwargs: Response())

    capabilities = agent._probe_comfyui_capabilities(8189, "healthy")

    assert capabilities["minimax_h3_fl2va"] is True
    assert capabilities["minimax_h3_required_nodes"]["MiniMaxH3ImageToVideo"] is True


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
