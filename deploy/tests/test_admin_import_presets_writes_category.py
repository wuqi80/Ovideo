"""admin_import_preset_configs 应该把 PRESET 字典的 category 字段传给 DAO.create。"""
from unittest.mock import AsyncMock, patch

import pytest


async def test_import_presets_passes_category_for_video_preset():
    """飞升 (Seedance 2.0) preset 字典里 category=video；import 时必须传进 DAO。"""
    import admin_routes

    # 跑过 _require_db 校验（mock 数据库存在）
    fake_db = object()
    with patch.object(admin_routes, "get_db_manager", lambda: fake_db), \
         patch.object(admin_routes.ApiConfigDAO, "list_all", AsyncMock(return_value=[])), \
         patch.object(admin_routes.ApiConfigDAO, "create", AsyncMock(return_value={"config_id": "x"})) as mock_create:

        result = await admin_routes.admin_import_preset_configs()

    assert result["success"] is True
    # 至少有一次 create 调用传了 category='video'
    calls_with_video_category = [
        c for c in mock_create.await_args_list
        if c.kwargs.get("category") == "video"
    ]
    assert len(calls_with_video_category) >= 1, (
        f"应至少有一个 video preset (飞升/渡劫/Wan2.6/...) 把 category='video' 传给 DAO.create。"
        f" 实际 calls: {[c.kwargs for c in mock_create.await_args_list]}"
    )


async def test_import_presets_passes_category_for_audio_preset():
    """Gemini TTS / MiniMax preset 字典里 category=audio；import 时必须传进 DAO。"""
    import admin_routes

    fake_db = object()
    with patch.object(admin_routes, "get_db_manager", lambda: fake_db), \
         patch.object(admin_routes.ApiConfigDAO, "list_all", AsyncMock(return_value=[])), \
         patch.object(admin_routes.ApiConfigDAO, "create", AsyncMock(return_value={"config_id": "x"})) as mock_create:
        await admin_routes.admin_import_preset_configs()

    audio_calls = [c for c in mock_create.await_args_list if c.kwargs.get("category") == "audio"]
    assert len(audio_calls) >= 1, (
        f"应有 audio preset 把 category='audio' 传给 DAO.create。"
        f" 实际: {[c.kwargs for c in mock_create.await_args_list]}"
    )


async def test_create_api_config_body_accepts_category():
    """ApiConfigCreateBody Pydantic model 必须接受 category 字段。"""
    import admin_routes
    body = admin_routes.ApiConfigCreateBody(
        name="t", provider="seedance", endpoint="https://x", api_key="k",
        category="video",
    )
    assert body.category == "video"


async def test_create_api_config_body_defaults_category_empty():
    import admin_routes
    body = admin_routes.ApiConfigCreateBody(
        name="t", provider="x", endpoint="y", api_key="k",
    )
    assert body.category == ""
