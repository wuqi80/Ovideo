from __future__ import annotations

from unittest.mock import Mock

import pytest

from services import asset_service


class FakeAssetDAO:
    rows = [
        {"asset_id": "asset_1", "project_id": "proj_1", "asset_type": "character", "name": "主角"},
        {"asset_id": "asset_2", "project_id": "proj_1", "asset_type": "scene", "name": "教室"},
    ]
    created = None
    updated = None
    deleted = []
    copied = None

    @classmethod
    async def get_by_project(cls, project_id, episode_id=None, asset_type=None, script_id=None):
        return [
            row
            for row in cls.rows
            if row["project_id"] == project_id
            and (asset_type is None or row["asset_type"] == asset_type)
        ]

    @classmethod
    async def create(cls, **kwargs):
        cls.created = kwargs
        return {"asset_id": "asset_new", **kwargs}

    @classmethod
    async def update(cls, asset_id, **kwargs):
        cls.updated = {"asset_id": asset_id, **kwargs}
        if asset_id == "missing":
            return None
        return cls.updated

    @classmethod
    async def delete(cls, asset_id):
        cls.deleted.append(asset_id)
        return asset_id != "missing"

    @classmethod
    async def copy_to(cls, **kwargs):
        cls.copied = kwargs
        if kwargs["asset_id"] == "missing":
            return None
        return {
            "asset_id": "asset_copy",
            "project_id": "proj_1",
            "asset_type": "character",
            "name": "主角",
        }


class FakeEntityFileDAO:
    copied = []
    raise_on_get = False

    @classmethod
    async def get_files_for_entities(cls, entity_type, entity_ids):
        return {
            "asset_1": [{"file_id": "file_1", "entity_type": entity_type}],
        }

    @classmethod
    async def get_entity_files(cls, entity_type, entity_id):
        if cls.raise_on_get:
            raise RuntimeError("copy source unavailable")
        return {
            "items": [
                {"file_id": "file_1", "file_role": "reference_image"},
                {"file_id": "file_2"},
            ],
        }

    @classmethod
    async def copy_file(cls, source_file_id, target_entity_type, target_entity_id, file_role):
        cls.copied.append(
            {
                "source_file_id": source_file_id,
                "target_entity_type": target_entity_type,
                "target_entity_id": target_entity_id,
                "file_role": file_role,
            }
        )
        return {"file_id": f"{source_file_id}_copy"}


def setup_function():
    FakeAssetDAO.created = None
    FakeAssetDAO.updated = None
    FakeAssetDAO.deleted = []
    FakeAssetDAO.copied = None
    FakeEntityFileDAO.copied = []
    FakeEntityFileDAO.raise_on_get = False


async def test_list_assets_attaches_entity_files():
    result = await asset_service.list_assets(
        "proj_1",
        episode_id="ep_1",
        asset_type=None,
        script_id="script_1",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["assets"][0]["entity_files"] == [{"file_id": "file_1", "entity_type": "asset"}]
    assert result["assets"][1]["entity_files"] == []


async def test_create_asset_passes_expected_fields():
    result = await asset_service.create_asset(
        project_id="proj_1",
        asset_type="character",
        name="主角",
        user_id="user_1",
        episode_id="ep_1",
        script_id="script_1",
        description=None,
        reference_images=["/ref.png"],
        asset_dao=FakeAssetDAO,
    )

    assert result["asset"]["asset_id"] == "asset_new"
    assert FakeAssetDAO.created == {
        "project_id": "proj_1",
        "asset_type": "character",
        "name": "主角",
        "created_by": "user_1",
        "episode_id": "ep_1",
        "description": "",
        "reference_images": ["/ref.png"],
        "script_id": "script_1",
    }


async def test_update_asset_raises_when_missing():
    with pytest.raises(asset_service.AssetNotFound):
        await asset_service.update_asset("missing", {"name": "新名"}, asset_dao=FakeAssetDAO)


async def test_delete_asset_returns_success():
    result = await asset_service.delete_asset("asset_1", asset_dao=FakeAssetDAO)

    assert result == {"success": True}
    assert FakeAssetDAO.deleted == ["asset_1"]


async def test_share_asset_copies_linked_files():
    result = await asset_service.share_asset(
        "asset_1",
        target_episode_id="ep_2",
        target_script_id="script_2",
        user_id="user_1",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["asset"]["asset_id"] == "asset_copy"
    assert result["copied_files"] == 2
    assert FakeAssetDAO.copied == {
        "asset_id": "asset_1",
        "target_episode_id": "ep_2",
        "target_script_id": "script_2",
        "created_by": "user_1",
    }
    assert FakeEntityFileDAO.copied[1]["file_role"] == "reference_image"


async def test_share_asset_keeps_asset_when_file_copy_fails():
    FakeEntityFileDAO.raise_on_get = True
    logger = Mock()

    result = await asset_service.share_asset(
        "asset_1",
        target_episode_id="ep_2",
        target_script_id="script_2",
        user_id="user_1",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
        logger=logger,
    )

    assert result["success"] is True
    assert result["copied_files"] == 0
    logger.warning.assert_called_once()


async def test_share_asset_raises_when_source_missing():
    with pytest.raises(asset_service.AssetNotFound):
        await asset_service.share_asset(
            "missing",
            target_episode_id="ep_2",
            target_script_id="script_2",
            user_id="user_1",
            asset_dao=FakeAssetDAO,
            entity_file_dao=FakeEntityFileDAO,
        )
