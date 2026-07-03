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


class _WorkflowHandler:
    calls = []

    def build_workflow_for_task(self, task_type, task_data):
        self.calls.append((task_type, dict(task_data)))
        return {"node": {"inputs": {"image": task_data.get("uploaded_image")}}}


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
    _FileDAO.record = None
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
