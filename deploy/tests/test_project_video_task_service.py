from datetime import datetime
from types import SimpleNamespace

import pytest

from services import project_video_task_service as svc


class _ProjectDAO:
    row = None
    saved = []

    @classmethod
    async def get_project(cls, project_id):
        if cls.row is None:
            return None
        return {**cls.row, "project_id": project_id}

    @classmethod
    async def save_or_update_project(cls, **kwargs):
        cls.saved.append(kwargs)
        return kwargs


class _VersionDAO:
    versions = []
    created = []

    @classmethod
    async def get_project_versions(cls, project_id):
        cls.last_project_id = project_id
        return cls.versions

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created.append(kwargs)
        return {"version_id": "ver_created"}


class _FileDAO:
    pass


class _Logger:
    infos = []
    warnings = []
    errors = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))

    @classmethod
    def error(cls, *args, **kwargs):
        cls.errors.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_fakes():
    _ProjectDAO.row = {
        "user_id": "yuan",
        "project_name": "Demo",
        "description": "desc",
        "settings": {
            "storyboard": {
                "items": [
                    {
                        "id": "shot_1",
                        "videoPrompt": "move camera",
                        "dialogue": "hello",
                        "characters": ["A"],
                        "scene": "Opening",
                    },
                    {
                        "id": "shot_2",
                        "videoPrompt": "wide shot",
                        "dialogue": "",
                        "characters": [],
                        "scene": "Room",
                    },
                ]
            },
            "generated_images": {
                "shot_1": {
                    "selectedImageId": "img_2",
                    "images": [
                        {"id": "img_1", "url": "/api/files/first/download"},
                        {"id": "img_2", "thumbnail": "/storage/selected-thumb.webp"},
                    ],
                },
                "shot_2": {
                    "images": [
                        {
                            "id": "img_3",
                            "url": "data:image/png;base64,ZmFrZQ==",
                        }
                    ]
                },
            },
            "video_tasks": [{"storyboard_id": "old"}],
            "stage": 3,
        },
    }
    _ProjectDAO.saved = []
    _VersionDAO.versions = [{"version_id": "ver_existing"}]
    _VersionDAO.created = []
    _Logger.infos = []
    _Logger.warnings = []
    _Logger.errors = []


@pytest.mark.asyncio
async def test_export_project_to_video_response_uses_selected_images_and_saves_stage():
    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_1"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        now_provider=lambda: datetime(2026, 6, 23, 1, 2, 3),
    )

    assert result == {
        "success": True,
        "exported_count": 1,
        "video_tasks": [
            {
                "storyboard_id": "shot_1",
                "image_url": "/storage/selected-thumb.webp",
                "video_prompt": "move camera",
                "dialogue": "hello",
                "characters": ["A"],
                "scene": "Opening",
            }
        ],
    }
    saved = _ProjectDAO.saved[0]
    assert saved["project_id"] == "proj_1"
    assert saved["project_name"] == "Demo"
    assert saved["description"] == "desc"
    assert saved["project_data"]["stage"] == 4
    assert saved["project_data"]["updated_at"] == "2026-06-23T01:02:03"
    assert saved["project_data"]["video_tasks"] == result["video_tasks"]
    assert _VersionDAO.created == []


@pytest.mark.asyncio
async def test_export_project_to_video_response_persists_base64_and_creates_version():
    _VersionDAO.versions = []
    persist_calls = []

    async def fake_persist(**kwargs):
        persist_calls.append(kwargs)
        return SimpleNamespace(file_id="file_new", file_url="/api/files/file_new/download")

    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_2"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        now_provider=lambda: datetime(2026, 6, 23),
        persist_image=fake_persist,
    )

    assert result["video_tasks"][0]["image_url"] == "/api/files/file_new/download"
    assert _VersionDAO.created[0]["project_id"] == "proj_1"
    assert _VersionDAO.created[0]["version_name"] == "\u5bfc\u51fa\u7248\u672c"
    assert persist_calls[0]["version_id"] == "ver_created"
    assert persist_calls[0]["storyboard_item"]["id"] == "shot_2"


@pytest.mark.asyncio
async def test_export_project_to_video_response_falls_back_to_base64_when_persist_fails():
    async def broken_persist(**_kwargs):
        raise RuntimeError("convert failed")

    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_2"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        persist_image=broken_persist,
    )

    assert result["video_tasks"][0]["image_url"].startswith("data:image/png;base64,")
    assert _Logger.errors
    assert _Logger.warnings


@pytest.mark.asyncio
async def test_clear_project_video_tasks_response_saves_empty_tasks():
    result = await svc.clear_project_video_tasks_response(
        "proj_1",
        username="yuan",
        project_dao=_ProjectDAO,
        logger=_Logger,
    )

    assert result == {"success": True, "cleared_count": 1}
    assert _ProjectDAO.saved[0]["project_data"]["video_tasks"] == []


@pytest.mark.asyncio
async def test_video_task_service_handles_missing_and_forbidden_project():
    _ProjectDAO.row = None
    with pytest.raises(svc.ProjectVideoTaskNotFound):
        await svc.clear_project_video_tasks_response(
            "proj_missing",
            username="yuan",
            project_dao=_ProjectDAO,
            logger=_Logger,
        )

    _ProjectDAO.row = {"user_id": "owner", "settings": {}}
    with pytest.raises(svc.ProjectVideoTaskForbidden):
        await svc.export_project_to_video_response(
            "proj_1",
            selected_items=[],
            username="visitor",
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            file_dao=_FileDAO,
            logger=_Logger,
        )
