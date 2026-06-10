# -*- coding: utf-8 -*-
"""
POST /api/minimax/tts — 异步入队改造单元测试

2026-05-24 引入：MiniMax TTS 从 FastAPI handler 内同步阻塞 300s 改为 worker
异步任务。本测试验证 handler 的新职责：

  1. 立即调用 task_service.submit('minimax_tts', ...) 并返回 {success, task_id}
  2. 透传 bind_to_character_voice_id（试听场景，worker 完成时回写
     character_voices.sample_audio_url）
  3. _require_minimax_client 抛 HTTPException 时直接 503 返回，不入队

为什么用 stripped-down FastAPI 而非 cluster_main.app：
  Windows 开发机 Postgres 5432 不可达；cluster_main 在 import 时会跑
  validate_cluster_config / 加载环境变量 / 准备 DB 池等，TestClient 起不来。
  只 include_router(api_routes.router) + 覆盖 get_current_user 依赖即可。
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import api_routes


@pytest.fixture
def test_app():
    """构造仅挂载 api_routes 的最小 FastAPI app；旁路 JWT 认证。"""
    app = FastAPI()
    app.include_router(api_routes.router)
    # 旁路 get_current_user：注入固定 user_id，不查 JWT
    app.dependency_overrides[api_routes.get_current_user] = lambda: 'u-test'
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def client(test_app):
    return TestClient(test_app)


def test_post_minimax_tts_returns_task_id_immediately(client):
    """POST /api/minimax/tts 必须立刻返回 {success, task_id}，不能阻塞到下载完成。

    入队参数核对：task_type=='minimax_tts', task_data 含 text/voice_id,
    prepare=False（不走 ComfyUI workflow 预构建）。
    """
    with patch('api_routes.task_service.get') as mock_svc, \
         patch('api_routes._require_minimax_client'):
        svc = mock_svc.return_value
        svc.submit = AsyncMock(return_value='uuid-task-1')

        resp = client.post(
            "/api/minimax/tts",
            json={"text": "你好", "voice_id": "female-shaonv"},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body['success'] is True
    assert body['task_id'] == 'uuid-task-1'

    svc.submit.assert_awaited_once()
    call_kwargs = svc.submit.call_args.kwargs
    assert call_kwargs['task_type'] == 'minimax_tts'
    assert call_kwargs['task_data']['text'] == '你好'
    assert call_kwargs['task_data']['voice_id'] == 'female-shaonv'
    assert call_kwargs['prepare'] is False  # MiniMax TTS 不需要 ComfyUI workflow 预构建
    assert call_kwargs['user_id'] == 'u-test'


def test_post_minimax_tts_passes_bind_to_character_voice_id(client):
    """试听场景：bind_to_character_voice_id 必须透传给 worker，
    让 worker 完成时回写 character_voices.sample_audio_url。"""
    with patch('api_routes.task_service.get') as mock_svc, \
         patch('api_routes._require_minimax_client'):
        svc = mock_svc.return_value
        svc.submit = AsyncMock(return_value='uuid-task-2')

        resp = client.post(
            "/api/minimax/tts",
            json={
                "text": "试听文本",
                "voice_id": "female-shaonv",
                "bind_to_character_voice_id": "cv-99",
            },
        )

    assert resp.status_code == 200, resp.text
    call_kwargs = svc.submit.call_args.kwargs
    assert call_kwargs['task_data']['bind_to_character_voice_id'] == 'cv-99'


def test_post_minimax_tts_503_when_minimax_not_configured(client):
    """_require_minimax_client 抛 HTTPException(503) 时直接 503 返回，不入队。"""

    def fail_client():
        raise HTTPException(
            status_code=503,
            detail="MiniMax 未配置 — 请先在 admin 加 MINIMAX_API_KEY",
        )

    with patch('api_routes._require_minimax_client', side_effect=fail_client), \
         patch('api_routes.task_service.get') as mock_svc:
        svc = mock_svc.return_value
        svc.submit = AsyncMock()

        resp = client.post(
            "/api/minimax/tts",
            json={"text": "x", "voice_id": "v"},
        )

    assert resp.status_code == 503
    svc.submit.assert_not_awaited()
