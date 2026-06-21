from external_api.video import base


class FakeStreamResponse:
    def __init__(self, chunks):
        self._chunks = chunks
        self.raise_for_status_called = False

    def raise_for_status(self):
        self.raise_for_status_called = True

    def iter_content(self, chunk_size):
        assert chunk_size == 4
        return iter(self._chunks)


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
