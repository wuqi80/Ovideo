from __future__ import annotations

from services import ai_proxy_image_content_service as content_service


class _GeneratedImageDownloadResponse:
    status_code = 200
    text = ""
    content = b"remote-image"

    def raise_for_status(self):
        return None


def test_generated_image_content_decodes_data_url():
    content = content_service.generated_image_content("data:image/png;base64,ZGF0YS1pbWFnZQ==")

    assert content == b"data-image"


def test_generated_image_content_downloads_public_url(monkeypatch):
    checks = []
    calls = []

    def fake_assert_public_http_url(url):
        checks.append(url)

    def fake_get(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _GeneratedImageDownloadResponse()

    monkeypatch.setattr(content_service, "assert_public_http_url", fake_assert_public_http_url)
    monkeypatch.setattr(content_service.requests, "get", fake_get)

    content = content_service.generated_image_content("https://images.example.test/generated.png", timeout=12)

    assert content == b"remote-image"
    assert checks == ["https://images.example.test/generated.png"]
    assert calls == [{"url": "https://images.example.test/generated.png", "timeout": 12}]
