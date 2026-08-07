import signal

import requests

from pipeline.comfyui_agent import ComfyUIAgent


def _agent(monkeypatch):
    monkeypatch.setattr(signal, "SIGINT", 2)
    monkeypatch.setattr(signal, "SIGTERM", 15)
    return ComfyUIAgent("https://example.test", "token", [8188])


def test_check_comfyui_falls_back_to_root(monkeypatch):
    agent = _agent(monkeypatch)
    calls = []

    class FakeResp:
        def __init__(self, status_code):
            self.status_code = status_code

    def fake_get(url, timeout):
        calls.append(url)
        if url.endswith("/system_stats"):
            return FakeResp(404)
        return FakeResp(200)

    monkeypatch.setattr(requests, "get", fake_get)

    assert agent._check_comfyui(8188) == "healthy"
    assert any(item.endswith("/system_stats") for item in calls)
    assert any(item.endswith("/") for item in calls)


def test_check_comfyui_returns_offline_on_network_errors(monkeypatch):
    agent = _agent(monkeypatch)

    def fake_get(*_args, **_kwargs):
        raise requests.exceptions.ConnectionError("network down")

    monkeypatch.setattr(requests, "get", fake_get)

    assert agent._check_comfyui(8188) == "offline"
