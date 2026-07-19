from datetime import datetime
from pathlib import Path

import pytest

from services import file_route_service as svc


class _Logger:
    def __init__(self):
        self.warnings = []
        self.errors = []
        self.infos = []

    def warning(self, *args, **_kwargs):
        self.warnings.append(args)

    def error(self, *args, **_kwargs):
        self.errors.append(args)

    def info(self, *args, **_kwargs):
        self.infos.append(args)


class _FileDAO:
    records = {}
    created = []
    raise_on_create = False

    @classmethod
    def reset(cls):
        cls.records = {}
        cls.created = []
        cls.raise_on_create = False

    @classmethod
    async def get_file(cls, file_id):
        return cls.records.get(file_id)

    @classmethod
    async def get_file_by_url(cls, url):
        return next((row for row in cls.records.values() if row.get("file_url") == url), None)

    @classmethod
    async def create_file(cls, **kwargs):
        if cls.raise_on_create:
            raise RuntimeError("db write failed")
        cls.created.append(kwargs)
        record = {"file_id": kwargs["file_id"], **kwargs}
        cls.records[record["file_id"]] = record
        return record


class _ProjectDAO:
    projects = []
    saved = []

    @classmethod
    def reset(cls):
        cls.projects = []
        cls.saved = []

    @classmethod
    async def get_user_projects(cls, _username):
        return cls.projects

    @classmethod
    async def save_or_update_project(cls, **kwargs):
        cls.saved.append(kwargs)


class _VersionDAO:
    versions = []
    created = []
    records = {}

    @classmethod
    def reset(cls):
        cls.versions = []
        cls.created = []
        cls.records = {
            "ver_existing": {"version_id": "ver_existing", "user_id": "yuan", "project_id": "proj_1"},
            "v1": {"version_id": "v1", "user_id": "yuan", "project_id": "proj_1"},
        }

    @classmethod
    async def get_version(cls, version_id):
        return cls.records.get(version_id)

    @classmethod
    async def get_project_versions(cls, _project_id):
        return cls.versions

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created.append(kwargs)
        return {"version_id": "ver_created", **kwargs}


@pytest.fixture(autouse=True)
def _reset_fakes(monkeypatch, tmp_path):
    _FileDAO.reset()
    _ProjectDAO.reset()
    _VersionDAO.reset()
    monkeypatch.chdir(tmp_path)


def _create_png(path: Path):
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (20, 20), color=(255, 0, 0)).save(path)


@pytest.mark.asyncio
async def test_thumbnail_source_access_checks_registered_file_acl():
    _FileDAO.records["file_1"] = {
        "file_id": "file_1",
        "file_url": "/storage/images/yuan/shot.png",
    }
    checked = []

    async def checker(file_id, identity, role, **_kwargs):
        checked.append((file_id, identity, role))
        return _FileDAO.records[file_id]

    row = await svc.require_thumbnail_source_access(
        "/storage/images/yuan/shot.png",
        "yuan",
        file_dao=_FileDAO,
        file_access_checker=checker,
    )

    assert row["file_id"] == "file_1"
    assert checked == [("file_1", "yuan", "readonly")]


@pytest.mark.asyncio
async def test_thumbnail_source_access_rejects_unregistered_path():
    with pytest.raises(svc.ThumbnailFileNotFound):
        await svc.require_thumbnail_source_access(
            "/uploads/another-user/private.png",
            "yuan",
            file_dao=_FileDAO,
        )


@pytest.mark.asyncio
async def test_build_thumbnail_file_from_upload_url_uses_cache(tmp_path):
    source = tmp_path / "temp" / "uploads" / "shot.png"
    _create_png(source)
    cache_dir = tmp_path / "cache"

    first = await svc.build_thumbnail_file(
        url="/uploads/shot.png",
        width=10,
        height=10,
        file_dao=_FileDAO,
        logger=_Logger(),
        cache_dir=cache_dir,
        uuid_hex_provider=lambda: "tmp",
    )
    second = await svc.build_thumbnail_file(
        url="/uploads/shot.png",
        width=10,
        height=10,
        file_dao=_FileDAO,
        logger=_Logger(),
        cache_dir=cache_dir,
        uuid_hex_provider=lambda: "tmp2",
    )

    assert first.path.exists()
    assert first.path == second.path
    assert first.headers["Cache-Control"] == "public, max-age=86400"


@pytest.mark.asyncio
async def test_build_thumbnail_file_uses_file_record_and_missing_raises(tmp_path):
    source = tmp_path / "stored.png"
    _create_png(source)
    _FileDAO.records["file_1"] = {"file_id": "file_1", "file_path": str(source)}

    result = await svc.build_thumbnail_file(
        url="/api/files/file_1/download",
        width=12,
        height=12,
        file_dao=_FileDAO,
        logger=_Logger(),
        cache_dir=tmp_path / "cache",
    )

    assert result.path.exists()

    with pytest.raises(svc.ThumbnailFileNotFound):
        await svc.build_thumbnail_file(
            url="/api/files/missing/download",
            width=12,
            height=12,
            file_dao=_FileDAO,
            logger=_Logger(),
            cache_dir=tmp_path / "cache",
        )


@pytest.mark.asyncio
async def test_upload_generic_file_creates_default_project_version_and_record(tmp_path):
    result = await svc.upload_generic_file(
        filename="shot.png",
        content_type="image/png",
        content=b"image-bytes",
        version_id=None,
        username="yuan",
        max_upload_size=1024,
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger(),
        storage_root=tmp_path / "storage",
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: "abcdef1234567890",
    )

    assert result["success"] is True
    assert result["file_id"] == "file_abcdef123456"
    assert result["filename"] == "file_abcdef123456.png"
    assert result["server_filename"] == "file_abcdef123456.png"
    assert result["original_filename"] == "shot.png"
    assert result["file_type"] == "image"
    assert Path(result["path"]).read_bytes() == b"image-bytes"
    assert _ProjectDAO.saved[0]["project_id"] == "proj_abcdef123456"
    assert _VersionDAO.created[0]["project_id"] == "proj_abcdef123456"
    assert _FileDAO.created[0]["version_id"] == "ver_created"


@pytest.mark.asyncio
async def test_upload_generic_file_uses_existing_version_and_video_type(tmp_path):
    result = await svc.upload_generic_file(
        filename="clip.bin",
        content_type="video/mp4",
        content=b"video-bytes",
        version_id="ver_existing",
        username="yuan",
        max_upload_size=1024,
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger(),
        storage_root=tmp_path / "storage",
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: "111111111111",
    )

    assert result["file_type"] == "video"
    assert result["file_id"] == "file_111111111111"
    assert result["filename"] == "file_111111111111.mp4"
    assert result["server_filename"] == "file_111111111111.mp4"
    assert _ProjectDAO.saved == []
    assert _VersionDAO.created == []
    assert _FileDAO.created[0]["version_id"] == "ver_existing"


@pytest.mark.asyncio
async def test_upload_generic_file_rejects_foreign_version_before_writing(tmp_path):
    _VersionDAO.records["ver_foreign"] = {
        "version_id": "ver_foreign",
        "user_id": "other",
        "project_id": "proj_other",
    }

    async def deny_project(*_args, **_kwargs):
        raise svc.ProjectAccessDenied("denied")

    with pytest.raises(svc.UploadVersionAccessDenied):
        await svc.upload_generic_file(
            filename="shot.png",
            content_type="image/png",
            content=b"image-bytes",
            version_id="ver_foreign",
            username="yuan",
            max_upload_size=1024,
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            logger=_Logger(),
            storage_root=tmp_path / "storage",
            project_access_checker=deny_project,
        )

    assert list((tmp_path / "storage").rglob("*")) == []
    assert _FileDAO.created == []


@pytest.mark.asyncio
async def test_upload_generic_file_adds_extension_from_mime_type(tmp_path):
    result = await svc.upload_generic_file(
        filename="clipboard",
        content_type="image/png",
        content=b"image-bytes",
        version_id="ver_existing",
        username="yuan",
        max_upload_size=1024,
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger(),
        storage_root=tmp_path / "storage",
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: "222222222222",
    )

    assert result["filename"] == "file_222222222222.png"
    assert result["server_filename"] == "file_222222222222.png"
    assert Path(result["path"]).suffix == ".png"


@pytest.mark.asyncio
async def test_upload_generic_file_validates_size_and_type(tmp_path):
    with pytest.raises(svc.UploadFileTooLarge):
        await svc.upload_generic_file(
            filename="shot.png",
            content_type="image/png",
            content=b"too-large",
            version_id="v1",
            username="yuan",
            max_upload_size=1,
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            logger=_Logger(),
            storage_root=tmp_path / "storage",
        )

    with pytest.raises(svc.UnsupportedUploadFileType):
        await svc.upload_generic_file(
            filename="doc.txt",
            content_type="text/plain",
            content=b"text",
            version_id="v1",
            username="yuan",
            max_upload_size=1024,
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            logger=_Logger(),
            storage_root=tmp_path / "storage",
        )


@pytest.mark.asyncio
async def test_upload_generic_file_rolls_back_disk_file_on_record_error(tmp_path):
    _FileDAO.raise_on_create = True
    storage_root = tmp_path / "storage"

    with pytest.raises(svc.UploadFileRecordError):
        await svc.upload_generic_file(
            filename="shot.png",
            content_type="image/png",
            content=b"image-bytes",
            version_id="v1",
            username="yuan",
            max_upload_size=1024,
            file_dao=_FileDAO,
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            logger=_Logger(),
            storage_root=storage_root,
            now_provider=lambda: datetime(2026, 6, 23),
            uuid_hex_provider=lambda: "abcdef123456",
        )

    assert list(storage_root.rglob("*.*")) == []
