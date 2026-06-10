# -*- coding: utf-8 -*-
"""
CharacterVoiceDAO.update_sample_audio_url 单字段更新 — 纯单元测试（mock db_manager）

2026-05-24 引入：MiniMax TTS 改为 worker 异步后，worker 完成时若 task_data
携带 bind_to_character_voice_id，需要把生成的试听 URL 回写到
character_voices.sample_audio_url。必须是单字段更新，避免与并发的
update() 通用调用产生读改写竞态、误覆盖 voice_params / voice_name 等。

本测试用 monkeypatch 替换 dao_character_voice.get_db_manager，只断言：
  1. 真的发了一条 UPDATE 语句
  2. SQL 形态包含单字段写入 + ::uuid 强转，没有 RETURNING 多列读回
  3. 位置参数顺序为 (sample_audio_url, voice_id)
  4. db_manager 不可用时（生产 cold start 之前）方法 graceful no-op 而不抛 AttributeError
不依赖真实 PostgreSQL（Windows 开发机上没有 5432）。
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

import dao_character_voice
from dao_character_voice import CharacterVoiceDAO


def _install_fake_db(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    fake_db = MagicMock()
    fake_db.execute = AsyncMock(return_value="UPDATE 1")
    fake_db.fetchrow = AsyncMock(return_value=None)
    monkeypatch.setattr(dao_character_voice, "get_db_manager", lambda: fake_db)
    return fake_db


async def test_update_sample_audio_url_issues_single_field_update(monkeypatch):
    fake_db = _install_fake_db(monkeypatch)
    voice_id = "11111111-2222-3333-4444-555555555555"
    new_url = "/storage/audio/preview_xyz.mp3"

    result = await CharacterVoiceDAO.update_sample_audio_url(voice_id, new_url)

    assert result is None, "single-field write back should not return a row"
    assert fake_db.execute.await_count == 1, "expected exactly one execute() call"
    assert fake_db.fetchrow.await_count == 0, (
        "should NOT use fetchrow/RETURNING — that re-reads other columns and "
        "defeats the point of a single-field write"
    )

    sql, *args = fake_db.execute.await_args.args
    normalized = " ".join(sql.split()).lower()

    assert "update character_voices" in normalized
    assert "set sample_audio_url = $1" in normalized
    assert "updated_at = now()" in normalized
    assert "where voice_id = $2::uuid" in normalized
    assert "voice_name" not in normalized, "must not touch voice_name"
    assert "voice_params" not in normalized, "must not touch voice_params"
    assert "returning" not in normalized, "should be a fire-and-forget UPDATE"

    assert args == [new_url, voice_id], (
        f"positional args must be (sample_audio_url, voice_id); got {args!r}"
    )


async def test_update_sample_audio_url_noop_when_db_unavailable(monkeypatch):
    """生产 cold start / 测试环境无 DB 时，与同模块其他方法一样 graceful no-op。"""
    monkeypatch.setattr(dao_character_voice, "get_db_manager", lambda: None)

    result = await CharacterVoiceDAO.update_sample_audio_url(
        "11111111-2222-3333-4444-555555555555",
        "/storage/audio/preview_xyz.mp3",
    )

    assert result is None
