from external_api.video import base
from services import video_source_service


class FakeJsonResponse:
    def __init__(self, data):
        self._data = data
        self.raise_for_status_called = False

    def raise_for_status(self):
        self.raise_for_status_called = True

    def json(self):
        return self._data


class FakeStreamResponse:
    def __init__(self, chunks):
        self._chunks = chunks
        self.raise_for_status_called = False

    def raise_for_status(self):
        self.raise_for_status_called = True

    def iter_content(self, chunk_size):
        assert chunk_size == 4
        return iter(self._chunks)


def test_request_json_forwards_runtime_request_kwargs(monkeypatch):
    calls = {}
    fake_response = FakeJsonResponse({"ok": True})

    def fake_request(method, url, **kwargs):
        calls["method"] = method
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(base.requests, "request", fake_request)

    data = base.request_json(
        "get",
        "https://example.test/tasks/task-1",
        headers={"Authorization": "Bearer token"},
        params={"task_id": "task-1"},
        timeout=17,
        request_kwargs={"proxies": {"https": "http://proxy.local"}},
    )

    assert data == {"ok": True}
    assert fake_response.raise_for_status_called
    assert calls["method"] == "GET"
    assert calls["url"] == "https://example.test/tasks/task-1"
    assert calls["kwargs"]["headers"] == {"Authorization": "Bearer token"}
    assert calls["kwargs"]["params"] == {"task_id": "task-1"}
    assert calls["kwargs"]["timeout"] == 17
    assert calls["kwargs"]["proxies"] == {"https": "http://proxy.local"}


def test_request_multipart_json_forwards_runtime_request_kwargs(monkeypatch):
    calls = {}
    fake_response = FakeJsonResponse({"id": "video-1"})
    image_handle = object()

    def fake_request(method, url, **kwargs):
        calls["method"] = method
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(base.requests, "request", fake_request)

    data = base.request_multipart_json(
        "post",
        "https://example.test/videos",
        headers={"Authorization": "Bearer token"},
        files={"input_reference": ("image.png", image_handle, "image/png")},
        data={"model": "sora2", "prompt": "move"},
        timeout=31,
        request_kwargs={"proxies": {"https": "http://proxy.local"}},
    )

    assert data == {"id": "video-1"}
    assert fake_response.raise_for_status_called
    assert calls["method"] == "POST"
    assert calls["url"] == "https://example.test/videos"
    assert calls["kwargs"]["headers"] == {"Authorization": "Bearer token"}
    assert calls["kwargs"]["files"] == {"input_reference": ("image.png", image_handle, "image/png")}
    assert calls["kwargs"]["data"] == {"model": "sora2", "prompt": "move"}
    assert calls["kwargs"]["timeout"] == 31
    assert calls["kwargs"]["proxies"] == {"https": "http://proxy.local"}


def test_download_streaming_video_forwards_runtime_request_kwargs(monkeypatch):
    calls = {}
    fake_response = FakeStreamResponse([b"aa", b"", b"bb"])

    def fake_get(url, **kwargs):
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(base.requests, "get", fake_get)

    data = base.download_streaming_video(
        "https://example.test/video.mp4",
        headers={"Authorization": "Bearer token"},
        timeout=99,
        request_kwargs={"proxies": {"https": "http://proxy.local"}},
        chunk_size=4,
    )

    assert data == b"aabb"
    assert fake_response.raise_for_status_called
    assert calls["url"] == "https://example.test/video.mp4"
    assert calls["kwargs"]["headers"] == {"Authorization": "Bearer token"}
    assert calls["kwargs"]["stream"] is True
    assert calls["kwargs"]["timeout"] == 99
    assert calls["kwargs"]["proxies"] == {"https": "http://proxy.local"}


def test_get_comfyui_view_response_forwards_timeout(monkeypatch):
    calls = {}
    fake_response = object()

    def fake_get(url, **kwargs):
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(video_source_service.requests, "get", fake_get)

    response = video_source_service.get_comfyui_view_response(
        "http://127.0.0.1:8188/view?filename=clip.mp4&type=output",
        timeout=23,
    )

    assert response is fake_response
    assert calls["url"] == "http://127.0.0.1:8188/view?filename=clip.mp4&type=output"
    assert calls["kwargs"]["timeout"] == 23


def test_fetch_comfyui_file_bytes_tries_locations(monkeypatch):
    calls = []

    class EmptyResponse:
        ok = True
        content = b""
        url = "http://node/view?filename=clip.mp4&type=output"

    class HitResponse:
        ok = True
        content = b"video-bytes"
        url = "http://node/view?filename=clip.mp4&type=temp"

    def fake_get(url, **kwargs):
        calls.append({"url": url, "kwargs": kwargs})
        return EmptyResponse() if len(calls) == 1 else HitResponse()

    monkeypatch.setattr(video_source_service.requests, "get", fake_get)

    result = video_source_service.fetch_comfyui_file_bytes("http://node/", "clip.mp4")

    assert result is not None
    assert result.content == b"video-bytes"
    assert result.file_type == "temp"
    assert result.source_info == "ComfyUI: http://node/view?filename=clip.mp4&type=temp"
    assert calls[0]["url"] == "http://node/view"
    assert calls[0]["kwargs"]["params"] == {"filename": "clip.mp4", "type": "output"}
    assert calls[1]["kwargs"]["params"] == {"filename": "clip.mp4", "type": "temp"}
