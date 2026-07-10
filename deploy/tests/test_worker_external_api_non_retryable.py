# -*- coding: utf-8 -*-
"""
worker._process_*_task（5 家视频/音频）失败路径的"非重试错误"集成测试。

每个 _process_*_task 失败时，必须调用
  task_queue.fail_task(task_id, error, retry=False)
对"鉴权/Key 无效/余额/模型未开通"类错误。
对其他错误（超时、临时网络错），仍走 retry=True。
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import requests

from task_queue import Task
from worker import Worker


# ──────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def mock_worker():
    """构造一个不调 __init__ 的 Worker；只挂 task_queue 三件套。"""
    w = Worker.__new__(Worker)
    w.task_queue = MagicMock()
    w.task_queue.update_progress = AsyncMock()
    w.task_queue.complete_task = AsyncMock()
    w.fail_task = AsyncMock()  # 防止真正调用 task_queue
    w.task_queue.fail_task = AsyncMock()
    return w


def _http_error(status_code: int, body: str = "") -> requests.HTTPError:
    """构造带 .response.status_code / .response.text 的 requests.HTTPError。"""
    response = requests.Response()
    response.status_code = status_code
    response._content = body.encode("utf-8")
    err = requests.HTTPError(f"{status_code} Client Error")
    err.response = response
    return err


# ──────────────────────────────────────────────────────────────────────
# 5 个 _process_*_task 抛 HTTP 401 → 必须 fail_task(retry=False)
# ──────────────────────────────────────────────────────────────────────


async def test_minimax_task_401_fails_without_retry(mock_worker):
    task = Task(task_id='m-1', task_type='minimax_i2v', data={'first_frame_image': 'fake-id'}, priority=2, user_id='u1')
    fake_client = MagicMock()
    fake_client.generate_video = MagicMock(side_effect=_http_error(401, '{"error": "unauthorized"}'))
    # 4 家（minimax/sora2/veo/wan26）在 worker.py 里是 lazy import，
    # patch 模块路径而非 worker 符号表
    with patch('minimax_api.get_minimax_client', return_value=fake_client):
        ok = await mock_worker._process_minimax_task(task)
    assert ok is False
    mock_worker.task_queue.fail_task.assert_awaited_once()
    args = mock_worker.task_queue.fail_task.call_args[0]
    kwargs = mock_worker.task_queue.fail_task.call_args[1]
    assert args[0] == 'm-1'
    assert kwargs['retry'] is False
    assert 'MiniMax' in args[1]


async def test_sora2_task_401_fails_without_retry(mock_worker, tmp_path):
    task = Task(task_id='s-1', task_type='sora2_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
    fake_client = MagicMock()
    fake_client.create_video_task = MagicMock(side_effect=_http_error(401, 'Unauthorized'))
    # _download_image_to_temp 内部走 FileDAO（需 DB）；用真实临时文件绕过
    tmp_img = tmp_path / 'src.png'
    tmp_img.write_bytes(b'fake-image-bytes')
    with patch('sora2_api.get_sora2_client', return_value=fake_client), \
         patch.object(mock_worker, '_download_image_to_temp', AsyncMock(return_value=str(tmp_img))):
        ok = await mock_worker._process_sora2_task(task)
    assert ok is False
    args = mock_worker.task_queue.fail_task.call_args[0]
    kwargs = mock_worker.task_queue.fail_task.call_args[1]
    assert args[0] == 's-1'
    assert kwargs['retry'] is False
    assert 'Sora2' in args[1]


async def test_veo_task_401_fails_without_retry(mock_worker, tmp_path):
    task = Task(task_id='v-1', task_type='veo_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
    fake_client = MagicMock()
    fake_client.create_video_task = MagicMock(side_effect=_http_error(401, 'Unauthorized'))
    tmp_img = tmp_path / 'src.png'
    tmp_img.write_bytes(b'fake-image-bytes')
    with patch('veo_api.get_veo_client', return_value=fake_client), \
         patch.object(mock_worker, '_download_image_to_temp', AsyncMock(return_value=str(tmp_img))):
        ok = await mock_worker._process_veo_task(task)
    assert ok is False
    args = mock_worker.task_queue.fail_task.call_args[0]
    kwargs = mock_worker.task_queue.fail_task.call_args[1]
    assert args[0] == 'v-1'
    assert kwargs['retry'] is False
    assert 'Veo' in args[1]


async def test_wan26_task_invalid_api_key_fails_without_retry(mock_worker, tmp_path):
    """Wan2.6 走 FileDAO.get_file 查 image_path，再走 create_video_task。
    测试不需 DB，patch 掉 FileDAO；让 create_video_task 抛 InvalidApiKey。
    """
    task = Task(task_id='w-1', task_type='wan26_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
    fake_client = MagicMock()
    fake_client.create_video_task = MagicMock(side_effect=RuntimeError('Wan2.6 失败: code=InvalidApiKey'))
    fake_file_record = {
        'file_path': str(tmp_path / 'src.png'),
        'mime_type': 'image/png',
    }
    (tmp_path / 'src.png').write_bytes(b'fake-image-bytes')
    with patch('wan2_dashscope_api.get_wan26_client', return_value=fake_client), \
         patch('core.worker.FileDAO') as FakeFileDAO:
        FakeFileDAO.get_file = AsyncMock(return_value=fake_file_record)
        ok = await mock_worker._process_wan26_task(task)
    assert ok is False
    args = mock_worker.task_queue.fail_task.call_args[0]
    kwargs = mock_worker.task_queue.fail_task.call_args[1]
    assert args[0] == 'w-1'
    assert kwargs['retry'] is False
    assert 'Wan2.6' in args[1]


async def test_minimax_tts_network_error_still_retries(mock_worker):
    """TTS 网络错（'consecutive N network errors'）→ 可重试。

    minimax_audio 模块用 global 单例缓存 _minimax_audio_client，测试间
    必须强制重置；否则前序测试可能留下 stale 实例。
    Worker 类实际定义在 core.worker（worker.py 是 shim），函数体 __globals__
    是 core.worker.__dict__——必须 patch 'core.worker.get_minimax_audio_client'
    才能拦到。
    """
    import minimax_audio
    minimax_audio._minimax_audio_client = None
    task = Task(task_id='t-2', task_type='minimax_tts', data={'text': 'hi', 'voice_id': 'female-shaonv'}, priority=2, user_id='u1')
    fake_client = MagicMock()
    fake_client.tts_sync = AsyncMock(side_effect=RuntimeError('tts_sync 失败: consecutive 3 network errors last_err=Timeout'))
    with patch('core.worker.get_minimax_audio_client', return_value=fake_client):
        ok = await mock_worker._process_minimax_tts_task(task)
    assert ok is False
    kwargs = mock_worker.task_queue.fail_task.call_args[1]
    assert kwargs['retry'] is True


async def test_minimax_tts_business_code_1004_fails_without_retry(mock_worker):
    """TTS 路径业务码 1004（余额不足）→ 非重试。"""
    import minimax_audio
    minimax_audio._minimax_audio_client = None
    task = Task(task_id='t-1', task_type='minimax_tts', data={'text': 'hi', 'voice_id': 'female-shaonv'}, priority=2, user_id='u1')
    fake_client = MagicMock()
    fake_client.tts_sync = AsyncMock(side_effect=RuntimeError('tts_sync 失败: status_code=1004 msg=insufficient balance'))
    with patch('core.worker.get_minimax_audio_client', return_value=fake_client):
        ok = await mock_worker._process_minimax_tts_task(task)
    assert ok is False
    args = mock_worker.task_queue.fail_task.call_args[0]
    kwargs = mock_worker.task_queue.fail_task.call_args[1]
    assert args[0] == 't-1'
    assert kwargs['retry'] is False
    assert 'TTS' in args[1] or 'MiniMax' in args[1]


async def test_minimax_terminal_failed_status_fails_without_retry(mock_worker):
    task = Task(
        task_id='m-2',
        task_type='minimax_i2v',
        data={'first_frame_image': 'fake-id', 'prompt': 'hello'},
        priority=2,
        user_id='u1',
    )
    fake_client = MagicMock()
    fake_client.generate_video = MagicMock(return_value={'task_id': 'remote-1'})
    fake_client.query_task = MagicMock(return_value={
        'status': 'failed',
        'base_resp': {'status_msg': 'insufficient balance'},
    })
    with patch('minimax_api.get_minimax_client', return_value=fake_client):
        ok = await mock_worker._process_minimax_task(task)
    assert ok is False
    args = mock_worker.task_queue.fail_task.call_args[0]
    kwargs = mock_worker.task_queue.fail_task.call_args[1]
    assert args[0] == 'm-2'
    assert kwargs['retry'] is False
