# -*- coding: utf-8 -*-
"""
分镜 DAO 测试
"""
import pytest


async def test_create_storyboard_item(test_db):
    from dao_storyboard import StoryboardDAO
    result = await StoryboardDAO.create(
        episode_id="ep_test1", sort_order=1,
        dialogue="你好世界", image_prompt="一个少年站在阳光下"
    )
    assert result is not None
    assert result["item_id"].startswith("sb_")
    assert result["dialogue"] == "你好世界"
    assert result["audio_duration_ms"] is None


async def test_get_items_by_episode_sorted(test_db):
    from dao_storyboard import StoryboardDAO
    await StoryboardDAO.create(episode_id="ep_1", sort_order=2, dialogue="第二")
    await StoryboardDAO.create(episode_id="ep_1", sort_order=1, dialogue="第一")
    items = await StoryboardDAO.get_by_episode("ep_1")
    assert len(items) >= 2
    assert items[0]["sort_order"] <= items[1]["sort_order"]


async def test_update_audio_duration_writes_back(test_db):
    from dao_storyboard import StoryboardDAO
    created = await StoryboardDAO.create(
        episode_id="ep_1", sort_order=1, dialogue="测试"
    )
    updated = await StoryboardDAO.update(
        created["item_id"], audio_duration_ms=3200
    )
    assert updated["audio_duration_ms"] == 3200


async def test_reorder_items(test_db):
    from dao_storyboard import StoryboardDAO
    a = await StoryboardDAO.create(episode_id="ep_1", sort_order=1, dialogue="A")
    b = await StoryboardDAO.create(episode_id="ep_1", sort_order=2, dialogue="B")
    await StoryboardDAO.reorder("ep_1", [b["item_id"], a["item_id"]])
    items = await StoryboardDAO.get_by_episode("ep_1")
    ids_ordered = [i["item_id"] for i in items]
    assert ids_ordered.index(b["item_id"]) < ids_ordered.index(a["item_id"])


async def test_delete_item(test_db):
    from dao_storyboard import StoryboardDAO
    created = await StoryboardDAO.create(
        episode_id="ep_1", sort_order=1, dialogue="删除我"
    )
    await StoryboardDAO.delete(created["item_id"])
    result = await StoryboardDAO.get_by_id(created["item_id"])
    assert result is None
