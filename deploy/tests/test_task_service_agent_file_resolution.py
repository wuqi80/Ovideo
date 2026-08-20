# -*- coding: utf-8 -*-
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services.task_service import TaskService


class _Redis:
    async def get(self, _key):
        return None


class _FileDAO:
    record = None

    @classmethod
    async def get_file(cls, file_id):
        if cls.record and cls.record["file_id"] == file_id:
            return cls.record
        return None

    @classmethod
    async def get_file_by_name(cls, file_name):
        if cls.record and cls.record.get("file_name") == file_name:
            return cls.record
        return None

    @classmethod
    async def get_file_by_url(cls, file_url):
        if cls.record and cls.record.get("file_url") == file_url:
            return cls.record
        return None


class _WorkflowHandler:
    calls = []

    def resolve_workflow_name(self, task_type, _task_data):
        return {"upscale_hd": "upscale_hd"}.get(task_type, task_type)

    def build_workflow_for_task(self, task_type, task_data, workflow_override=None):
        self.calls.append((task_type, dict(task_data), workflow_override))
        if workflow_override is not None:
            return workflow_override
        return {"node": {"inputs": {"image": task_data.get("uploaded_image")}}}


class _WorkflowTemplateDAO:
    row = None

    @classmethod
    async def get_enabled_by_key(cls, workflow_key):
        if cls.row and cls.row.get("workflow_key") == workflow_key:
            return cls.row
        return None


@pytest.fixture(autouse=True)
def fake_dependencies(monkeypatch):
    handler = _WorkflowHandler()
    handler.calls = []
    monkeypatch.setitem(
        sys.modules,
        "workflow_handler",
        SimpleNamespace(get_workflow_handler=lambda: handler),
    )
    monkeypatch.setitem(sys.modules, "dao_content", SimpleNamespace(FileDAO=_FileDAO))
    monkeypatch.setitem(sys.modules, "dao_workflow_template", SimpleNamespace(WorkflowTemplateDAO=_WorkflowTemplateDAO))
    _FileDAO.record = None
    _WorkflowTemplateDAO.row = None
    return handler


@pytest.mark.asyncio
async def test_prepare_resolves_plain_file_id_to_download_url_and_extension(fake_dependencies):
    file_id = "file_d0b2371a362b"
    _FileDAO.record = {
        "file_id": file_id,
        "file_path": f"persistent_storage/images/admin/202607/{file_id}.png",
        "file_url": f"/api/files/{file_id}/download",
        "file_name": "upload.png",
        "mime_type": "image/png",
    }
    task_data = {"image_path": file_id, "prompt": "x"}

    await TaskService(_Redis())._prepare_for_agent("i2v", task_data, "admin")

    expected_name = f"{file_id}.png"
    assert task_data["image_path"] == expected_name
    assert task_data["uploaded_image"] == expected_name
    assert task_data["workflow_json"]["node"]["inputs"]["image"] == expected_name
    assert task_data["agent_files"] == [
        {
            "param": "image_path",
            "filename": expected_name,
            "url": f"/api/files/{file_id}/download",
        }
    ]


@pytest.mark.asyncio
async def test_prepare_resolves_nested_h3_long_video_frames(fake_dependencies, monkeypatch):
    service = TaskService(_Redis())

    async def resolve(param, value, _username):
        if not value:
            return None
        filename = f"{value}.png"
        return {"param": param, "filename": filename, "url": f"/files/{filename}"}

    monkeypatch.setattr(service, "_resolve_agent_file", resolve)
    task_data = {
        "image_path": "shot1",
        "model": "MiniMaxH3",
        "h3_long_video": True,
        "h3_long_video_segments": [
            {"prompt": "first", "duration": 5, "image_path": "shot1"},
            {
                "prompt": "second",
                "duration": 7,
                "image_path": "shot2",
                "image_path_end": "shot2_end",
            },
        ],
    }

    await service._prepare_for_agent("i2v", task_data, "admin")

    assert task_data["duration"] == 12
    assert task_data["h3_long_video_segments"][0]["image_path"] == "shot1.png"
    assert task_data["h3_long_video_segments"][1]["image_path_end"] == "shot2_end.png"
    assert {item["filename"] for item in task_data["agent_files"]} == {
        "shot1.png", "shot2.png", "shot2_end.png",
    }


@pytest.mark.asyncio
async def test_prepare_resolves_server_filename_to_authenticated_download_route(fake_dependencies):
    file_id = "file_9cf3de8c6079"
    _FileDAO.record = {
        "file_id": file_id,
        "file_path": f"persistent_storage/videos/admin/202607/{file_id}.mp4",
        "file_url": f"/api/files/{file_id}/download",
        "file_name": "uploaded-video.mp4",
        "mime_type": "video/mp4",
    }
    task_data = {"video_filename": f"{file_id}.mp4"}

    await TaskService(_Redis())._prepare_for_agent("interpolate", task_data, "admin")

    assert task_data["video_filename"] == f"{file_id}.mp4"
    assert task_data["agent_files"] == [
        {
            "param": "video_filename",
            "filename": f"{file_id}.mp4",
            "url": f"/api/files/{file_id}/download",
        }
    ]


@pytest.mark.asyncio
async def test_prepare_fallback_adds_extension_to_storage_url(fake_dependencies):
    task_data = {"image_path": "legacy_upload", "prompt": "x"}

    await TaskService(_Redis())._prepare_for_agent("i2v", task_data, "admin")

    agent_file = task_data["agent_files"][0]
    assert agent_file["filename"] == "legacy_upload.png"
    assert agent_file["url"].startswith("/storage/image/admin/")
    assert agent_file["url"].endswith("/legacy_upload.png")


@pytest.mark.asyncio
async def test_prepare_adds_extension_to_extensionless_storage_url(fake_dependencies):
    task_data = {"image_path": "/storage/image/admin/202607/file_d0b2371a362b", "prompt": "x"}

    await TaskService(_Redis())._prepare_for_agent("i2v", task_data, "admin")

    agent_file = task_data["agent_files"][0]
    assert agent_file["filename"] == "file_d0b2371a362b.png"
    assert agent_file["url"] == "/storage/image/admin/202607/file_d0b2371a362b.png"
    assert task_data["uploaded_image"] == "file_d0b2371a362b.png"


@pytest.mark.asyncio
async def test_prepare_resolves_storage_url_to_authenticated_download_route(fake_dependencies):
    file_id = "file_video123456"
    storage_url = "/storage/video/admin/202607/generated.mp4"
    _FileDAO.record = {
        "file_id": file_id,
        "file_path": "persistent_storage/video/admin/202607/generated.mp4",
        "file_url": storage_url,
        "file_name": "generated.mp4",
        "mime_type": "video/mp4",
    }
    task_data = {"video_filename": storage_url}

    await TaskService(_Redis())._prepare_for_agent("interpolate", task_data, "admin")

    assert task_data["video_filename"] == "generated.mp4"
    assert task_data["agent_files"][0] == {
        "param": "video_filename",
        "filename": "generated.mp4",
        "url": f"/api/files/{file_id}/download",
    }


@pytest.mark.asyncio
async def test_prepare_resolves_plain_filename_from_file_table(fake_dependencies):
    file_id = "file_storyboard123"
    _FileDAO.record = {
        "file_id": file_id,
        "file_path": "persistent_storage/image/admin/202607/file_storyboard123.png",
        "file_url": f"/api/files/{file_id}/download",
        "file_name": "storyboard_1.png",
        "mime_type": "image/png",
    }
    task_data = {"image_path": "storyboard_1.png", "prompt": "x"}

    await TaskService(_Redis())._prepare_for_agent("i2v", task_data, "admin")

    assert task_data["image_path"] == "file_storyboard123.png"
    assert task_data["agent_files"][0] == {
        "param": "image_path",
        "filename": "file_storyboard123.png",
        "url": f"/api/files/{file_id}/download",
    }


@pytest.mark.asyncio
async def test_prepare_rejects_storyboard_display_filename_without_file_record(fake_dependencies):
    task_data = {"image_path": "storyboard_1.png", "prompt": "x"}

    with pytest.raises(HTTPException) as exc:
        await TaskService(_Redis())._prepare_for_agent("i2v", task_data, "admin")

    assert "展示文件名" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_prepare_prefers_enabled_workflow_template(fake_dependencies):
    full_template = {
        "node_1": {"class_type": "LoadImage", "inputs": {"image": "{image}"}},
        "node_2": {"class_type": "SeedVR2", "inputs": {"images": ["node_1", 0]}},
    }
    _WorkflowTemplateDAO.row = {
        "workflow_key": "upscale_hd",
        "workflow_json": full_template,
    }
    task_data = {"image_path": "input.png", "seed_0": 123456}

    await TaskService(_Redis())._prepare_for_agent("upscale_hd", task_data, "admin")

    assert task_data["workflow_name"] == "upscale_hd"
    assert task_data["workflow_json"] is full_template
    assert fake_dependencies.calls[0][2] is full_template


@pytest.mark.asyncio
async def test_prepare_skips_placeholder_workflow_template(fake_dependencies):
    _WorkflowTemplateDAO.row = {
        "workflow_key": "upscale_hd",
        "workflow_json": {
            "placeholder_node": {
                "class_type": "PlaceholderNode",
                "inputs": {"image": "{image}"},
            }
        },
    }
    task_data = {"image_path": "input.png", "seed_0": 123456}

    await TaskService(_Redis())._prepare_for_agent("upscale_hd", task_data, "admin")

    assert task_data["workflow_name"] == "upscale_hd"
    assert fake_dependencies.calls[0][2] is None
