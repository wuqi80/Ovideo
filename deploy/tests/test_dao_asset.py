# -*- coding: utf-8 -*-
"""
资产 DAO 测试
"""
import pytest


async def test_create_asset_returns_complete_record(test_db):
    from dao_asset import AssetDAO
    result = await AssetDAO.create(
        project_id="proj_test1", episode_id=None,
        asset_type="character", name="主角",
        description="黑发少年", created_by="user_test"
    )
    assert result is not None
    assert result["asset_id"].startswith("asset_")
    assert result["name"] == "主角"
    assert result["asset_type"] == "character"
    assert result["episode_id"] is None


async def test_get_project_assets_includes_shared(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="scene", name="学校", created_by="u1")
    await AssetDAO.create(project_id="proj_1", episode_id="ep_1",
                          asset_type="scene", name="教室", created_by="u1")
    results = await AssetDAO.get_by_project("proj_1", episode_id="ep_1")
    names = [r["name"] for r in results]
    assert "学校" in names
    assert "教室" in names


async def test_get_assets_filters_by_project(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_A", episode_id=None,
                          asset_type="prop", name="剑", created_by="u1")
    results = await AssetDAO.get_by_project("proj_B")
    assert len(results) == 0


async def test_update_asset_name(test_db):
    from dao_asset import AssetDAO
    created = await AssetDAO.create(project_id="proj_1", episode_id=None,
                                     asset_type="character", name="旧名", created_by="u1")
    updated = await AssetDAO.update(created["asset_id"], name="新名")
    assert updated["name"] == "新名"


async def test_delete_asset(test_db):
    from dao_asset import AssetDAO
    created = await AssetDAO.create(project_id="proj_1", episode_id=None,
                                     asset_type="prop", name="盾牌", created_by="u1")
    await AssetDAO.delete(created["asset_id"])
    result = await AssetDAO.get_by_id(created["asset_id"])
    assert result is None


async def test_filter_assets_by_type(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="character", name="人物A", created_by="u1")
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="scene", name="场景A", created_by="u1")
    chars = await AssetDAO.get_by_project("proj_1", asset_type="character")
    assert all(r["asset_type"] == "character" for r in chars)
