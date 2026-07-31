from datetime import datetime

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


def test_fetch_comfyui_view_with_fallback_tries_compatible_locations():
    calls = []

    class MissingResponse:
        ok = False
        status_code = 404
        text = "not found"

    class HitResponse:
        ok = True
        status_code = 200
        text = ""
        headers = {"content-type": "video/mp4"}

    def fake_fetch(url, **kwargs):
        calls.append((url, kwargs))
        return MissingResponse() if len(calls) == 1 else HitResponse()

    response = comfyui_file_service.fetch_comfyui_view_with_fallback(
        url="http://node/view",
        filename="clip.mp4",
        file_type="output",
        subfolder="drafts",
        logger=_Logger,
        timeout=17,
        stream=True,
        fetch_view=fake_fetch,
    )

    assert response.status_code == 200
    assert calls == [
        (
            "http://node/view",
            {"params": {"filename": "clip.mp4", "type": "output", "subfolder": "drafts"}, "timeout": 17, "stream": True},
        ),
        (
            "http://node/view",
            {"params": {"filename": "clip.mp4", "type": "temp", "subfolder": "drafts"}, "timeout": 17, "stream": True},
        ),
    ]


def test_fetch_comfyui_view_with_fallback_raises_with_status():
    class MissingResponse:
        ok = False
        status_code = 404
        text = "not found"

    def fake_fetch(*_args, **_kwargs):
        return MissingResponse()

    with pytest.raises(comfyui_file_service.ComfyUIViewFetchFailed) as exc:
        comfyui_file_service.fetch_comfyui_view_with_fallback(
            url="http://node/view",
            filename="missing.mp4",
            file_type="unknown",
            logger=_Logger,
            fetch_view=fake_fetch,
        )

    assert exc.value.status_code == 404
    assert "处理节点暂时无法读取文件" in str(exc.value)


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
    records = {}

    @classmethod
    async def create_file(cls, **kwargs):
        cls.created.append(kwargs)
        row = {"file_id": kwargs["file_id"], "file_url": kwargs["file_url"], **kwargs}
        cls.records[row["file_id"]] = row
        return row

    @classmethod
    async def get_file(cls, file_id):
        return cls.records.get(file_id)

    @classmethod
    async def get_file_by_comfyui_filename(cls, filename):
        return next(
            (
                row for row in cls.records.values()
                if row.get("metadata", {}).get("comfyui_filename") == filename
            ),
            None,
        )


class _Redis:
    def __init__(self):
        self.calls = []
        self.values = {}

    async def set(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        self.values[args[0]] = args[1]

    async def get(self, key):
        return self.values.get(key)


class _Logger:
    warnings = []
    infos = []
    debugs = []
    errors = []

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def debug(cls, *args, **kwargs):
        cls.debugs.append((args, kwargs))

    @classmethod
    def error(cls, *args, **kwargs):
        cls.errors.append((args, kwargs))


def _reset_fakes():
    _ProjectDAO.projects = []
    _ProjectDAO.saved = []
    _VersionDAO.versions = []
    _VersionDAO.created = []
    _FileDAO.created = []
    _FileDAO.records = {}
    _Logger.warnings = []
    _Logger.infos = []
    _Logger.debugs = []
    _Logger.errors = []


@pytest.mark.asyncio
async def test_require_comfyui_file_access_resolves_redis_mapping_and_checks_acl():
    _reset_fakes()
    _FileDAO.records["file_1"] = {"file_id": "file_1", "user_id": "yuan"}
    redis = _Redis()
    redis.values["comfyui:file:node_file.png"] = b"file_1"
    checked = []

    async def checker(file_id, identity, role, **_kwargs):
        checked.append((file_id, identity, role))
        return _FileDAO.records[file_id]

    row = await comfyui_file_service.require_comfyui_file_access(
        filename="node_file.png",
        identity="yuan",
        file_dao=_FileDAO,
        redis_client=redis,
        file_access_checker=checker,
    )

    assert row["file_id"] == "file_1"
    assert checked == [("file_1", "yuan", "readonly")]


@pytest.mark.asyncio
async def test_require_comfyui_file_access_rejects_unknown_filename():
    _reset_fakes()
    with pytest.raises(comfyui_file_service.ComfyUIFileAccessDenied):
        await comfyui_file_service.require_comfyui_file_access(
            filename="foreign.mp4",
            identity="yuan",
            file_dao=_FileDAO,
        )


class _Response:
    def __init__(self, *, ok=True, content=b"", status_code=200, payload=None, text=""):
        self.ok = ok
        self.content = content
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


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


@pytest.mark.asyncio
async def test_upload_image_file_to_comfyui_uploads_saves_record_and_redis(tmp_path):
    _reset_fakes()
    _ProjectDAO.projects = [{"project_id": "proj_existing"}]
    _VersionDAO.versions = [{"version_id": "ver_existing"}]
    redis = _Redis()
    upload_calls = []
    uuid_values = iter(["img123456789", "fil123456789"])

    def fake_upload(*args, **kwargs):
        upload_calls.append((args, kwargs))
        return _Response(payload={"images": [{"filename": "image_from_node.png"}]})

    result = await comfyui_file_service.upload_image_file_to_comfyui(
        username="yuan",
        original_filename="shot.png",
        content=b"image-bytes",
        content_type="image/png",
        target_server="http://node:8188",
        comfyui_node_id="node-1",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        redis_client=redis,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        utc_now_provider=lambda: datetime(2026, 6, 23, 1, 2, 3),
        uuid_hex_provider=lambda: next(uuid_values),
        upload_file=fake_upload,
    )

    expected_path = tmp_path / "image" / "yuan" / "202606" / "img123456789_shot.png"
    assert result == {
        "success": True,
        "filename": "image_from_node.png",
        "original_filename": "shot.png",
        "size": len(b"image-bytes"),
        "storage_url": "/api/files/file_fil123456789/download",
        "file_id": "file_fil123456789",
        "file_path": str(expected_path),
        "comfyui_server": "http://node:8188",
        "comfyui_node_id": "node-1",
    }
    assert expected_path.read_bytes() == b"image-bytes"
    assert upload_calls == [
        (
            ("http://node:8188/upload/image", "img123456789_shot.png", b"image-bytes", "image/png"),
            {"timeout": 30},
        )
    ]
    assert _FileDAO.created[0]["file_url"] == "/storage/image/yuan/202606/img123456789_shot.png"
    assert _FileDAO.created[0]["metadata"] == {
        "source": "comfyui_upload",
        "logical_id": "img123456789",
        "comfyui_filename": "image_from_node.png",
        "comfyui_server": "http://node:8188",
        "comfyui_node_id": "node-1",
        "uploaded_at": "2026-06-23T01:02:03",
    }
    assert redis.calls == [(("comfyui:file:image_from_node.png", "file_fil123456789"), {"ex": 86400})]


@pytest.mark.asyncio
async def test_upload_image_file_to_comfyui_keeps_local_record_when_comfyui_upload_fails(tmp_path):
    _reset_fakes()
    _ProjectDAO.projects = [{"project_id": "proj_existing"}]
    _VersionDAO.versions = [{"version_id": "ver_existing"}]
    uuid_values = iter(["img123456789", "fil123456789"])

    def fake_upload(*_args, **_kwargs):
        return _Response(ok=False, status_code=502, text="bad gateway")

    result = await comfyui_file_service.upload_image_file_to_comfyui(
        username="yuan",
        original_filename="shot.png",
        content=b"image-bytes",
        content_type="image/png",
        target_server="http://node:8188",
        comfyui_node_id=None,
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        utc_now_provider=lambda: datetime(2026, 6, 23, 1, 2, 3),
        uuid_hex_provider=lambda: next(uuid_values),
        upload_file=fake_upload,
    )

    assert result["success"] is True
    assert result["filename"] == "img123456789_shot.png"
    assert result["file_id"] == "file_fil123456789"
    assert _FileDAO.created[0]["metadata"]["comfyui_filename"] == "img123456789_shot.png"
    assert _Logger.warnings


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


def test_upload_audio_file_to_comfyui_uploads_and_keeps_backup(tmp_path):
    upload_calls = []

    def fake_upload(*args, **kwargs):
        upload_calls.append((args, kwargs))
        return _Response(payload={"name": "voice_from_node.mp3"})

    result = comfyui_file_service.upload_audio_file_to_comfyui(
        username="yuan",
        original_filename="voice.mp3",
        content=b"audio-bytes",
        content_type="audio/mpeg",
        start_time=1.5,
        duration=3.0,
        target_server="http://node:8188",
        logger=_Logger,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: "abc123def456",
        upload_file=fake_upload,
    )

    assert result == {
        "success": True,
        "filename": "voice_from_node.mp3",
        "original_filename": "voice.mp3",
        "size": len(b"audio-bytes"),
        "server": "http://node:8188",
        "start_time": 1.5,
        "duration": 3.0,
    }
    assert upload_calls == [
        (
            ("http://node:8188/upload/image", "abc123def456_voice.mp3", b"audio-bytes", "audio/mpeg"),
            {"timeout": 60},
        )
    ]
    assert (tmp_path / "audio" / "yuan" / "202606" / "voice_from_node.mp3").read_bytes() == b"audio-bytes"


def test_upload_audio_file_to_comfyui_raises_on_rejected_upload(tmp_path):
    def fake_upload(*_args, **_kwargs):
        return _Response(ok=False, status_code=502, text="bad gateway")

    with pytest.raises(comfyui_file_service.ComfyUIMediaUploadFailed) as exc:
        comfyui_file_service.upload_audio_file_to_comfyui(
            username="yuan",
            original_filename="voice.mp3",
            content=b"audio-bytes",
            content_type="audio/mpeg",
            start_time=0,
            duration=5,
            target_server="http://node:8188",
            logger=_Logger,
            storage_root=tmp_path,
            upload_file=fake_upload,
        )

    assert exc.value.status_code == 502
    assert "上传到处理节点失败: 502" in str(exc.value)


@pytest.mark.asyncio
async def test_upload_video_file_to_comfyui_uploads_saves_and_creates_record(tmp_path):
    _reset_fakes()
    _ProjectDAO.projects = [{"project_id": "proj_existing"}]
    _VersionDAO.versions = [{"version_id": "ver_existing"}]
    upload_calls = []
    uuid_values = iter(["vid123456789", "fil123456789"])

    def fake_upload(*args, **kwargs):
        upload_calls.append((args, kwargs))
        return _Response(payload={"name": "clip_from_node.mp4"})

    result = await comfyui_file_service.upload_video_file_to_comfyui(
        username="yuan",
        original_filename="clip.mp4",
        content=b"video-bytes",
        content_type="video/mp4",
        target_server="http://node:8188",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: next(uuid_values),
        upload_file=fake_upload,
    )

    expected_path = tmp_path / "videos" / "yuan" / "202606" / "vid123456789_clip.mp4"
    assert result == {
        "success": True,
        "filename": "clip_from_node.mp4",
        "unique_filename": "vid123456789_clip.mp4",
        "storage_url": "/api/files/file_fil123456789/download",
        "original_filename": "clip.mp4",
        "size": len(b"video-bytes"),
        "file_id": "file_fil123456789",
        "file_path": str(expected_path),
        "server": "http://node:8188",
    }
    assert expected_path.read_bytes() == b"video-bytes"
    assert upload_calls == [
        (
            ("http://node:8188/upload/image", "vid123456789_clip.mp4", b"video-bytes", "video/mp4"),
            {"timeout": 60},
        )
    ]
    assert _FileDAO.created[0]["version_id"] == "ver_existing"
    assert _FileDAO.created[0]["file_path"] == str(expected_path)
    assert _FileDAO.created[0]["metadata"] == {"source": "upload", "physical_filename": "vid123456789_clip.mp4"}


@pytest.mark.asyncio
async def test_upload_video_file_to_comfyui_raises_on_rejected_upload(tmp_path):
    _reset_fakes()

    def fake_upload(*_args, **_kwargs):
        return _Response(ok=False, status_code=502, text="bad gateway")

    with pytest.raises(comfyui_file_service.ComfyUIMediaUploadFailed) as exc:
        await comfyui_file_service.upload_video_file_to_comfyui(
            username="yuan",
            original_filename="clip.mp4",
            content=b"video-bytes",
            content_type="video/mp4",
            target_server="http://node:8188",
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            logger=_Logger,
            storage_root=tmp_path,
            upload_file=fake_upload,
        )

    assert exc.value.status_code == 502
    assert "上传到处理节点失败: 502" in str(exc.value)
    assert _FileDAO.created == []
