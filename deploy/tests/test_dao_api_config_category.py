"""ApiConfigDAO category 字段透传 mock 单测（本机 PG 不可用 → 纯 mock）。"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dao_api_config


@pytest.fixture
def mock_db(monkeypatch):
    db = MagicMock()
    db.fetchrow = AsyncMock(return_value={"config_id": "apicfg_test1"})
    db.execute = AsyncMock(return_value="UPDATE 1")
    monkeypatch.setattr(dao_api_config, "get_db_manager", lambda: db)
    return db


async def test_create_passes_category_to_sql(mock_db):
    await dao_api_config.ApiConfigDAO.create(
        name="飞升 Test",
        provider="seedance",
        endpoint="https://x",
        api_key="k",
        model_name="doubao-seedance-2-0",
        category="video",
    )
    # fetchrow 第一个位置参数是 SQL，其余按顺序是 bind values
    args = mock_db.fetchrow.await_args.args
    sql = args[0]
    assert "category" in sql, f"INSERT SQL 应包含 category 列: {sql}"
    # category 应在 bind 值里出现
    assert "video" in args, f"category 'video' 应作为 bind 参数传入: {args}"


async def test_create_defaults_category_to_empty_string(mock_db):
    await dao_api_config.ApiConfigDAO.create(
        name="未分类",
        provider="custom",
        endpoint="https://y",
        api_key="k2",
    )
    args = mock_db.fetchrow.await_args.args
    # category 不传时应默认 ''
    assert "" in args, "未传 category 时应默认 '' 作为 bind 值"


async def test_update_by_id_accepts_category(mock_db):
    """update_by_id 应允许 category 在 allowed 字段集合里。"""
    db = mock_db
    db.fetchrow = AsyncMock(return_value={"config_id": "apicfg_test1", "category": "audio"})
    await dao_api_config.ApiConfigDAO.update_by_id("apicfg_test1", {"category": "audio"})
    # 至少应调一次 fetchrow 或 execute（不能默默吞掉）
    assert db.fetchrow.await_count + db.execute.await_count >= 1
