import pytest
import requests

from services import comfyui_file_service


def test_fetch_comfyui_view_response_forwards_request_options(monkeypatch):
    calls = {}
    fake_response = object()

    def fake_get(url, **kwargs):
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(comfyui_file_service.requests, "get", fake_get)

    response = comfyui_file_service.fetch_comfyui_view_response(
        "http://127.0.0.1:8188/view",
        params={"filename": "clip.mp4", "type": "output"},
        timeout=17,
        stream=True,
    )

    assert response is fake_response
    assert calls["url"] == "http://127.0.0.1:8188/view"
    assert calls["kwargs"]["params"] == {"filename": "clip.mp4", "type": "output"}
    assert calls["kwargs"]["timeout"] == 17
    assert calls["kwargs"]["stream"] is True


def test_upload_comfyui_file_response_forwards_multipart_payload(monkeypatch):
    calls = {}
    fake_response = object()

    def fake_post(url, **kwargs):
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(comfyui_file_service.requests, "post", fake_post)

    response = comfyui_file_service.upload_comfyui_file_response(
        "http://127.0.0.1:8188/upload/image",
        "clip.mp4",
        b"video-bytes",
        "video/mp4",
        timeout=23,
    )

    assert response is fake_response
    assert calls["url"] == "http://127.0.0.1:8188/upload/image"
    assert calls["kwargs"]["files"] == {"image": ("clip.mp4", b"video-bytes", "video/mp4")}
    assert calls["kwargs"]["data"] == {"overwrite": "true"}
    assert calls["kwargs"]["timeout"] == 23


def test_comfyui_request_error_wraps_requests_exception(monkeypatch):
    def fake_get(*_args, **_kwargs):
        raise requests.Timeout("slow node")

    monkeypatch.setattr(comfyui_file_service.requests, "get", fake_get)

    with pytest.raises(comfyui_file_service.ComfyUIFileRequestError) as exc:
        comfyui_file_service.fetch_comfyui_view_response("http://127.0.0.1:8188/view")

    assert "comfyui_view failed" in str(exc.value)
