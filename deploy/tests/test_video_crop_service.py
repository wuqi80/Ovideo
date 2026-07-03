from datetime import datetime
from pathlib import Path

import pytest

from services import video_crop_service as svc
from services.video_source_service import ComfyUIFileFetchResult


class _Logger:
    def __init__(self):
        self.warnings = []
        self.errors = []
        self.infos = []

    def debug(self, *_args, **_kwargs):
        pass

    def info(self, *args, **_kwargs):
        self.infos.append(args)

    def warning(self, *args, **_kwargs):
        self.warnings.append(args)

    def error(self, *args, **_kwargs):
        self.errors.append(args)


class _FileDAO:
    records = {}
    created = []

    @classmethod
    def reset(cls):
        cls.records = {}
        cls.created = []

    @classmethod
    async def get_file(cls, file_id):
        return cls.records.get(file_id)

    @classmethod
    async def create_file(cls, **kwargs):
        cls.created.append(kwargs)
        return {"file_id": kwargs["file_id"], "file_url": kwargs["file_url"], **kwargs}


class _ProjectDAO:
    projects = [{"project_id": "proj_existing"}]
    saved = []

    @classmethod
    def reset(cls):
        cls.projects = [{"project_id": "proj_existing"}]
        cls.saved = []

    @classmethod
    async def get_user_projects(cls, _username):
        return cls.projects

    @classmethod
    async def save_or_update_project(cls, **kwargs):
        cls.saved.append(kwargs)


class _VersionDAO:
    versions = [{"version_id": "ver_existing"}]
    created = []

    @classmethod
    def reset(cls):
        cls.versions = [{"version_id": "ver_existing"}]
        cls.created = []

    @classmethod
    async def get_project_versions(cls, _project_id):
        return cls.versions

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created.append(kwargs)
        return {"version_id": "ver_created", **kwargs}


class _Node:
    base_url = "http://node:8188"


class _Manager:
    def get_available_node(self):
        return _Node()


class _RunResult:
    def __init__(self, returncode=0, stderr=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = ""


@pytest.fixture(autouse=True)
def _reset_fakes(monkeypatch, tmp_path):
    _FileDAO.reset()
    _ProjectDAO.reset()
    _VersionDAO.reset()
    monkeypatch.chdir(tmp_path)


def _uuid_sequence(*values):
    iterator = iter(values)
    return lambda: next(iterator)


def _fake_ffmpeg_runner(output_bytes: bytes = b"cropped"):
    def run(cmd, **_kwargs):
        Path(cmd[-1]).write_bytes(output_bytes)
        return _RunResult()

    return run


@pytest.mark.asyncio
async def test_crop_video_file_from_storage_creates_record(tmp_path):
    source = tmp_path / "persistent_storage" / "videos" / "input.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source-video")

    result = await svc.crop_video_file(
        video_filename="persistent_storage/videos/input.mp4",
        start_time=1.0,
        end_time=3.5,
        username="yuan",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        get_video_cluster_manager=lambda: None,
        get_cluster_manager=lambda: None,
        logger=_Logger(),
        deploy_root=tmp_path,
        storage_root=tmp_path / "out",
        ffmpeg_available=lambda _name: "ffmpeg",
        ffmpeg_runner=_fake_ffmpeg_runner(b"cropped-video"),
        now_provider=lambda: datetime(2026, 6, 23),
        utc_now_provider=lambda: datetime(2026, 6, 23, 8, 0),
        uuid_hex_provider=_uuid_sequence("aaaaaaaa", "bbbbbbbbbbbb", "cccccccc"),
    )

    assert result["success"] is True
    assert result["file_id"] == "file_bbbbbbbbbbbb"
    assert result["filename"] == "cropped_cccccccc.mp4"
    assert Path(result["storage_path"]).read_bytes() == b"cropped-video"
    assert _FileDAO.created[0]["version_id"] == "ver_existing"
    assert _FileDAO.created[0]["metadata"]["duration"] == 2.5
    assert _ProjectDAO.saved == []


@pytest.mark.asyncio
async def test_crop_video_file_creates_default_project_and_version(tmp_path):
    source = tmp_path / "persistent_storage" / "videos" / "input.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source-video")
    _ProjectDAO.projects = []
    _VersionDAO.versions = []

    await svc.crop_video_file(
        video_filename="persistent_storage/videos/input.mp4",
        start_time=0,
        end_time=1,
        username="yuan",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        get_video_cluster_manager=lambda: None,
        get_cluster_manager=lambda: None,
        logger=_Logger(),
        deploy_root=tmp_path,
        storage_root=tmp_path / "out",
        ffmpeg_available=lambda _name: "ffmpeg",
        ffmpeg_runner=_fake_ffmpeg_runner(),
        uuid_hex_provider=_uuid_sequence("aaaaaaaa", "bbbbbbbbbbbb", "cccccccc", "dddddddddddd"),
    )

    assert _ProjectDAO.saved[0]["project_id"] == "proj_dddddddddddd"
    assert _VersionDAO.created[0]["project_id"] == "proj_dddddddddddd"
    assert _FileDAO.created[0]["version_id"] == "ver_created"


@pytest.mark.asyncio
async def test_crop_video_file_raises_when_ffmpeg_missing(tmp_path):
    with pytest.raises(svc.FfmpegUnavailable):
        await svc.crop_video_file(
            video_filename="missing.mp4",
            start_time=0,
            end_time=1,
            username="yuan",
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            get_video_cluster_manager=lambda: None,
            get_cluster_manager=lambda: None,
            logger=_Logger(),
            deploy_root=tmp_path,
            ffmpeg_available=lambda _name: None,
            ffmpeg_runner=_fake_ffmpeg_runner(),
        )


@pytest.mark.asyncio
async def test_resolve_video_source_from_db_comfyui(monkeypatch, tmp_path):
    _FileDAO.records["file_1"] = {
        "file_id": "file_1",
        "file_path": "comfyui://output/clip.mp4",
        "file_name": "original.mp4",
        "metadata": {"comfyui_server": "http://db-node:8188"},
    }
    calls = []

    def fake_fetch(server, filename, **kwargs):
        calls.append((server, filename, kwargs))
        return ComfyUIFileFetchResult(
            content=b"video",
            source_info="ComfyUI (from DB): http://db-node/view",
            file_type="output",
            url="http://db-node/view",
        )

    monkeypatch.setattr(svc, "fetch_comfyui_file_bytes", fake_fetch)

    source = await svc.resolve_video_source(
        "file_1",
        deploy_root=tmp_path,
        file_dao=_FileDAO,
        get_video_cluster_manager=lambda: None,
        get_cluster_manager=lambda: None,
        logger=_Logger(),
    )

    assert source.content == b"video"
    assert source.original_file_name == "original.mp4"
    assert calls == [("http://db-node:8188", "clip.mp4", {"source_label": "ComfyUI (from DB)"})]


@pytest.mark.asyncio
async def test_resolve_video_source_extracts_file_id_from_download_url(tmp_path):
    local_file = tmp_path / "persistent_storage" / "videos" / "admin" / "202607" / "clip.mp4"
    local_file.parent.mkdir(parents=True)
    local_file.write_bytes(b"video-from-db")
    _FileDAO.records["file_video123"] = {
        "file_id": "file_video123",
        "file_path": str(local_file),
        "file_name": "clip.mp4",
        "metadata": {},
    }

    source = await svc.resolve_video_source(
        "/api/files/file_video123/download",
        deploy_root=tmp_path,
        file_dao=_FileDAO,
        get_video_cluster_manager=lambda: None,
        get_cluster_manager=lambda: None,
        logger=_Logger(),
    )

    assert source.content == b"video-from-db"
    assert source.original_file_name == "clip.mp4"


@pytest.mark.asyncio
async def test_resolve_video_source_reads_storage_url(tmp_path):
    local_file = tmp_path / "persistent_storage" / "video" / "admin" / "202607" / "clip.mp4"
    local_file.parent.mkdir(parents=True)
    local_file.write_bytes(b"video-from-storage")

    source = await svc.resolve_video_source(
        "/storage/video/admin/202607/clip.mp4",
        deploy_root=tmp_path,
        file_dao=_FileDAO,
        get_video_cluster_manager=lambda: None,
        get_cluster_manager=lambda: None,
        logger=_Logger(),
    )

    assert source.content == b"video-from-storage"
    assert source.original_file_name == "clip.mp4"


@pytest.mark.asyncio
async def test_resolve_video_source_falls_back_to_direct_comfyui(monkeypatch, tmp_path):
    calls = []

    def fake_fetch(server, filename, **_kwargs):
        calls.append((server, filename))
        return ComfyUIFileFetchResult(
            content=b"video",
            source_info="ComfyUI: http://node/view",
            file_type="output",
            url="http://node/view",
        )

    monkeypatch.setattr(svc, "fetch_comfyui_file_bytes", fake_fetch)

    source = await svc.resolve_video_source(
        "folder/clip.mp4",
        deploy_root=tmp_path,
        file_dao=_FileDAO,
        get_video_cluster_manager=lambda: _Manager(),
        get_cluster_manager=lambda: None,
        logger=_Logger(),
    )

    assert source.content == b"video"
    assert calls == [("http://node:8188", "clip.mp4")]


@pytest.mark.asyncio
async def test_crop_video_file_raises_when_source_missing(tmp_path):
    with pytest.raises(svc.VideoSourceNotFound):
        await svc.crop_video_file(
            video_filename="missing.mp4",
            start_time=0,
            end_time=1,
            username="yuan",
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            get_video_cluster_manager=lambda: None,
            get_cluster_manager=lambda: None,
            logger=_Logger(),
            deploy_root=tmp_path,
            ffmpeg_available=lambda _name: "ffmpeg",
            ffmpeg_runner=_fake_ffmpeg_runner(),
        )


@pytest.mark.asyncio
async def test_crop_video_file_raises_on_ffmpeg_error(tmp_path):
    source = tmp_path / "persistent_storage" / "videos" / "input.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source-video")

    def failed_runner(_cmd, **_kwargs):
        return _RunResult(returncode=1, stderr="bad input")

    with pytest.raises(svc.FfmpegCropFailed):
        await svc.crop_video_file(
            video_filename="persistent_storage/videos/input.mp4",
            start_time=0,
            end_time=1,
            username="yuan",
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            get_video_cluster_manager=lambda: None,
            get_cluster_manager=lambda: None,
            logger=_Logger(),
            deploy_root=tmp_path,
            ffmpeg_available=lambda _name: "ffmpeg",
            ffmpeg_runner=failed_runner,
        )
