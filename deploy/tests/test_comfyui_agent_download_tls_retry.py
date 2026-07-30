from __future__ import annotations

import requests

from pipeline.comfyui_agent import ComfyUIAgent, PLATFORM_DOWNLOAD_RETRIES


class _Response:
    content = b"ok"
    text = "ok"

    def raise_for_status(self):
        return None


def _agent(tmp_path, monkeypatch):
    monkeypatch.setenv("MECHA_AGENT_STATE_DIR", str(tmp_path))
    return ComfyUIAgent("https://spti.ai", "token", [8188])


def test_platform_download_retries_verified_request_before_fallback(tmp_path, monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        if len(calls) < 3:
            raise requests.exceptions.SSLError("hostname mismatch")
        return _Response()

    monkeypatch.setattr(requests, "get", fake_get)
    agent = _agent(tmp_path, monkeypatch)

    response = agent._get_platform_download(
        "https://spti.ai/api/agent/tasks/task-1/files/file-1",
        headers={"Authorization": "Bearer token"},
        timeout=10,
        stream=True,
    )

    assert response.content == b"ok"
    assert len(calls) == 3
    assert all(call[1].get("verify", True) is True for call in calls)


def test_platform_download_tls_fallback_is_limited_to_same_origin_files(tmp_path, monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        if kwargs.get("verify") is False:
            return _Response()
        raise requests.exceptions.SSLError("hostname mismatch")

    monkeypatch.setattr(requests, "get", fake_get)
    agent = _agent(tmp_path, monkeypatch)

    response = agent._get_platform_download(
        "https://spti.ai/storage/video/admin/input.mp4",
        headers={},
        timeout=10,
        stream=True,
    )

    assert response.content == b"ok"
    assert len(calls) == PLATFORM_DOWNLOAD_RETRIES + 1
    assert calls[-1][1]["verify"] is False


def test_platform_download_never_disables_tls_for_external_url(tmp_path, monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        raise requests.exceptions.SSLError("hostname mismatch")

    monkeypatch.setattr(requests, "get", fake_get)
    agent = _agent(tmp_path, monkeypatch)

    try:
        agent._get_platform_download(
            "https://files.example.test/storage/input.mp4",
            headers={},
            timeout=10,
        )
    except requests.exceptions.SSLError:
        pass
    else:
        raise AssertionError("external TLS error must be preserved")

    assert len(calls) == PLATFORM_DOWNLOAD_RETRIES
    assert all(call[1].get("verify", True) is True for call in calls)
