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


class _ProjectDAO:
    projects = []
    saved = []

    @classmethod
    async def get_user_projects(cls, username):
        return cls.projects

    @classmethod
    async def save_or_update_project(cls, **kwargs):
        cls.saved.append(kwargs)


class _VersionDAO:
    versions = []
    created = []

    @classmethod
    async def get_project_versions(cls, project_id):
        return cls.versions

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created.append(kwargs)
        return {"version_id": "ver_created"}


class _FileDAO:
    created = []

    @classmethod
    async def create_file(cls, **kwargs):
        cls.created.append(kwargs)
        return {"file_id": kwargs["file_id"], "file_url": kwargs["file_url"], **kwargs}


class _Redis:
    def __init__(self):
        self.calls = []

    async def set(self, *args, **kwargs):
        self.calls.append((args, kwargs))


class _Logger:
    warnings = []
    infos = []
    debugs = []

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def debug(cls, *args, **kwargs):
        cls.debugs.append((args, kwargs))


def _reset_fakes():
    _ProjectDAO.projects = []
    _ProjectDAO.saved = []
    _VersionDAO.versions = []
    _VersionDAO.created = []
    _FileDAO.created = []
    _Logger.warnings = []
    _Logger.infos = []
    _Logger.debugs = []


@pytest.mark.asyncio
async def test_create_comfyui_upload_record_creates_default_version_and_redis_mapping():
    _reset_fakes()
    redis = _Redis()
    hex_values = iter(["fileid000000", "projectabcde"])

    result = await comfyui_file_service.create_comfyui_upload_record(
        username="yuan",
        file_type="image",
        file_name="shot.png",
        file_path="persistent_storage/image/yuan/202606/file.png",
        file_url="/storage/image/yuan/202606/file.png",
        file_size_bytes=42,
        mime_type="image/png",
        metadata={"source": "comfyui_upload"},
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        redis_client=redis,
        redis_comfyui_filename="node_file.png",
        uuid_hex_provider=lambda: next(hex_values),
    )

    assert result.file_id == "file_fileid000000"
    assert result.version_id == "ver_created"
    assert result.file_url == "/storage/image/yuan/202606/file.png"
    assert result.download_url == "/api/files/file_fileid000000/download"
    assert _ProjectDAO.saved[0]["project_id"] == "proj_projectabcde"
    assert _VersionDAO.created[0]["project_id"] == "proj_projectabcde"
    assert _FileDAO.created[0]["version_id"] == "ver_created"
    assert _FileDAO.created[0]["file_url"] == "/storage/image/yuan/202606/file.png"
    assert redis.calls == [(("comfyui:file:node_file.png", "file_fileid000000"), {"ex": 86400})]


@pytest.mark.asyncio
async def test_create_comfyui_upload_record_uses_existing_version_and_download_url():
    _reset_fakes()
    _ProjectDAO.projects = [{"project_id": "proj_existing"}]
    _VersionDAO.versions = [{"version_id": "ver_existing"}]

    result = await comfyui_file_service.create_comfyui_upload_record(
        username="yuan",
        file_type="video",
        file_name="clip.mp4",
        file_path="persistent_storage/videos/yuan/202606/clip.mp4",
        file_size_bytes=100,
        mime_type="video/mp4",
        metadata={"source": "upload"},
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        uuid_hex_provider=lambda: "videoid00000",
    )

    assert result.file_id == "file_videoid00000"
    assert result.version_id == "ver_existing"
    assert result.file_url == "/api/files/file_videoid00000/download"
    assert _ProjectDAO.saved == []
    assert _VersionDAO.created == []
    assert _FileDAO.created[0]["version_id"] == "ver_existing"
    assert _FileDAO.created[0]["file_type"] == "video"


class _Response:
    def __init__(self, *, ok=True, content=b"", status_code=200, payload=None):
        self.ok = ok
        self.content = content
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def test_reupload_comfyui_video_with_uuid_reads_persistent_storage(tmp_path):
    source_path = tmp_path / "persistent_storage" / "videos" / "scene" / "clip.mp4"
    source_path.parent.mkdir(parents=True)
    source_path.write_bytes(b"local-video")
    upload_calls = []

    def fake_fetch(*_args, **_kwargs):
        raise AssertionError("storage hit should not fetch ComfyUI")

    def fake_upload(*args, **kwargs):
        upload_calls.append((args, kwargs))
        return _Response(payload={"name": "uploaded.mp4"})

    result = comfyui_file_service.reupload_comfyui_video_with_uuid(
        filename="scene/clip.mp4",
        file_type="output",
        target_server="http://node:8188",
        logger=_Logger,
        storage_root=tmp_path,
        uuid_hex_provider=lambda: "abcdef123456",
        fetch_view=fake_fetch,
        upload_file=fake_upload,
    )

    assert result == {
        "success": True,
        "original_filename": "scene/clip.mp4",
        "new_filename": "uploaded.mp4",
        "size": len(b"local-video"),
        "server": "http://node:8188",
    }
    assert upload_calls == [
        (
            ("http://node:8188/upload/image", "abcdef123456_reuploaded.mp4", b"local-video", "video/mp4"),
            {"timeout": 60},
        )
    ]


def test_reupload_comfyui_video_with_uuid_fetches_from_comfyui_then_uploads(tmp_path):
    fetch_calls = []
    upload_calls = []

    def fake_fetch(url, **kwargs):
        fetch_calls.append((url, kwargs))
        if len(fetch_calls) == 1:
            return _Response(ok=False, status_code=404)
        return _Response(ok=True, content=b"remote-video")

    def fake_upload(*args, **kwargs):
        upload_calls.append((args, kwargs))
        return _Response(payload={})

    result = comfyui_file_service.reupload_comfyui_video_with_uuid(
        filename="clip.mp4",
        file_type="output",
        target_server="http://node:8188",
        logger=_Logger,
        storage_root=tmp_path,
        uuid_hex_provider=lambda: "fedcba654321",
        fetch_view=fake_fetch,
        upload_file=fake_upload,
    )

    assert result["new_filename"] == "fedcba654321_reuploaded.mp4"
    assert result["size"] == len(b"remote-video")
    assert fetch_calls == [
        ("http://node:8188/view?filename=clip.mp4&type=output", {"timeout": 30}),
        ("http://node:8188/view?filename=clip.mp4&type=temp", {"timeout": 30}),
    ]
    assert upload_calls[0][0][2] == b"remote-video"


def test_reupload_comfyui_video_with_uuid_raises_when_source_missing(tmp_path):
    def fake_fetch(*_args, **_kwargs):
        return _Response(ok=False, status_code=404)

    with pytest.raises(comfyui_file_service.ComfyUIVideoReuploadNotFound) as exc:
        comfyui_file_service.reupload_comfyui_video_with_uuid(
            filename="clip.mp4",
            file_type="output",
            target_server="http://node:8188",
            logger=_Logger,
            storage_root=tmp_path,
            fetch_view=fake_fetch,
        )

    assert "无法找到视频文件: clip.mp4" in str(exc.value)


def test_reupload_comfyui_video_with_uuid_raises_when_upload_fails(tmp_path):
    def fake_fetch(*_args, **_kwargs):
        return _Response(ok=True, content=b"remote-video")

    def fake_upload(*_args, **_kwargs):
        return _Response(ok=False, status_code=500)

    with pytest.raises(comfyui_file_service.ComfyUIVideoReuploadFailed):
        comfyui_file_service.reupload_comfyui_video_with_uuid(
            filename="clip.mp4",
            file_type="output",
            target_server="http://node:8188",
            logger=_Logger,
            storage_root=tmp_path,
            uuid_hex_provider=lambda: "fedcba654321",
            fetch_view=fake_fetch,
            upload_file=fake_upload,
        )
