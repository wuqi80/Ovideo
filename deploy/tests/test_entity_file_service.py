from __future__ import annotations

from unittest.mock import Mock

import pytest

from services import entity_file_service


class FakeFileDAO:
    rows = [
        {"file_id": "file_1", "metadata": '{"a": 1}'},
        {"file_id": "file_2", "metadata": "bad-json"},
    ]
    calls = []

    @classmethod
    async def get_user_files(cls, user_id, file_type, limit, offset):
        cls.calls.append((user_id, file_type, limit, offset))
        return cls.rows


class FakeEntityFileDAO:
    linked = None
    selected = None
    synced = []
    soft_deleted = []
    hard_deleted = []
    batch_deleted = None
    raise_sync = False

    @staticmethod
    async def count_user_files(user_id, file_type):
        return 7

    @staticmethod
    async def get_entity_files(entity_type, entity_id, file_role, limit, offset):
        return {"items": [{"file_id": "file_1"}], "total": 1, "limit": limit}

    @classmethod
    async def link_file(cls, file_id, entity_type, entity_id, file_role, is_selected):
        if file_id == "missing":
            return None
        cls.linked = (file_id, entity_type, entity_id, file_role, is_selected)
        return {"file_id": file_id, "entity_id": entity_id}

    @classmethod
    async def select_file(cls, file_id, entity_type, entity_id, file_role):
        if file_id == "missing":
            return None
        cls.selected = (file_id, entity_type, entity_id, file_role)
        return {"file_id": file_id, "file_url": "/storage/a.webp"}

    @classmethod
    async def sync_legacy_url(cls, entity_type, entity_id, file_role, file_url):
        if cls.raise_sync:
            raise RuntimeError("sync failed")
        cls.synced.append((entity_type, entity_id, file_role, file_url))
        return True

    @classmethod
    async def soft_delete(cls, file_id):
        cls.soft_deleted.append(file_id)
        return file_id != "missing"

    @classmethod
    async def hard_delete(cls, file_id):
        cls.hard_deleted.append(file_id)
        if file_id == "missing":
            return None
        return {"file_id": file_id, "freed_bytes": 123}

    @classmethod
    async def hard_delete_batch(cls, file_ids):
        cls.batch_deleted = file_ids
        return {"deleted": len(file_ids), "freed_bytes": 456, "errors": []}


def setup_function():
    FakeFileDAO.calls = []
    FakeEntityFileDAO.linked = None
    FakeEntityFileDAO.selected = None
    FakeEntityFileDAO.synced = []
    FakeEntityFileDAO.soft_deleted = []
    FakeEntityFileDAO.hard_deleted = []
    FakeEntityFileDAO.batch_deleted = None
    FakeEntityFileDAO.raise_sync = False


async def test_list_user_files_caps_limit_and_normalizes_metadata():
    result = await entity_file_service.list_user_files(
        user_id="user_1",
        file_type="image",
        limit=999,
        offset=3,
        file_dao=FakeFileDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert FakeFileDAO.calls == [("user_1", "image", 500, 3)]
    assert result["items"][0]["metadata"] == {"a": 1}
    assert result["items"][1]["metadata"] == {}
    assert result["total"] == 7


async def test_list_entity_files_caps_limit():
    result = await entity_file_service.list_entity_files(
        entity_type="asset",
        entity_id="asset_1",
        file_role=None,
        limit=999,
        offset=0,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["limit"] == 200


async def test_link_entity_file_raises_when_missing():
    with pytest.raises(entity_file_service.EntityFileNotFound):
        await entity_file_service.link_entity_file(
            file_id="missing",
            entity_type="asset",
            entity_id="asset_1",
            file_role="reference_image",
            is_selected=False,
            entity_file_dao=FakeEntityFileDAO,
        )


async def test_select_entity_file_syncs_legacy_url():
    result = await entity_file_service.select_entity_file(
        file_id="file_1",
        entity_type="asset",
        entity_id="asset_1",
        file_role="reference_image",
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["file"]["file_id"] == "file_1"
    assert FakeEntityFileDAO.synced == [("asset", "asset_1", "reference_image", "/storage/a.webp")]


async def test_select_entity_file_keeps_success_when_legacy_sync_fails():
    FakeEntityFileDAO.raise_sync = True
    logger = Mock()

    result = await entity_file_service.select_entity_file(
        file_id="file_1",
        entity_type="asset",
        entity_id="asset_1",
        file_role="reference_image",
        entity_file_dao=FakeEntityFileDAO,
        logger=logger,
    )

    assert result["success"] is True
    logger.warning.assert_called_once()


async def test_upload_entity_file_saves_and_syncs_media_library():
    saved_calls = []
    media_calls = []

    async def fake_save_generated_file_to_db(**kwargs):
        saved_calls.append(kwargs)
        return {"file_id": "file_new", "file_url": "/storage/new.webp"}

    async def fake_create_from_file(**kwargs):
        media_calls.append(kwargs)
        return {"library_item_id": "lib_1"}

    result = await entity_file_service.upload_entity_file(
        content=b"abc",
        filename="cover.png",
        content_type="image/png",
        entity_type="asset",
        entity_id="asset_1",
        file_role="reference_image",
        episode_id="ep_1",
        user_id="user_1",
        save_generated_file_to_db=fake_save_generated_file_to_db,
        media_library_create_from_file=fake_create_from_file,
    )

    assert result == {"success": True, "file_id": "file_new", "file_url": "/storage/new.webp"}
    assert saved_calls[0]["file_type"] == "image"
    assert saved_calls[0]["original_ext"] == ".png"
    assert media_calls[0]["title"] == "cover.png"


async def test_hard_delete_batch_rejects_more_than_200_files():
    with pytest.raises(entity_file_service.EntityFileBatchTooLarge):
        await entity_file_service.hard_delete_entity_files_batch(
            file_ids=[f"file_{i}" for i in range(201)],
            entity_file_dao=FakeEntityFileDAO,
        )


async def test_soft_and_hard_delete_raise_when_missing():
    with pytest.raises(entity_file_service.EntityFileNotFound):
        await entity_file_service.soft_delete_entity_file(
            file_id="missing",
            entity_file_dao=FakeEntityFileDAO,
        )

    with pytest.raises(entity_file_service.EntityFileNotFound):
        await entity_file_service.hard_delete_entity_file(
            file_id="missing",
            entity_file_dao=FakeEntityFileDAO,
        )


async def test_run_entity_file_migration_uses_runner():
    async def fake_runner():
        return 3

    result = await entity_file_service.run_entity_file_migration(migration_runner=fake_runner)

    assert result == {"success": True, "recovered": 3}
