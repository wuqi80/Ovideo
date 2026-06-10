# -*- coding: utf-8 -*-
"""
worker._process_minimax_tts_task — 纯单元测试（mock 外部依赖）

2026-05-24 引入：MiniMax TTS 从 FastAPI handler 内同步阻塞 300s 改为 worker
异步任务。worker 完成完整的"签发 → 轮询 → 下载 → 入库 → entity 同步 →
可选回写 character_voices.sample_audio_url"链路。

本测试覆盖：
  1. happy path — 完成时调用 complete_task 并写入 file_id / file_url / duration_ms
  2. bind_to_character_voice_id 透传 — worker 必须用单字段 DAO 回写 sample_audio_url
  3. 失败路径 — 抛错时调用 fail_task 而非 complete_task

不依赖真实 Redis / Postgres / MiniMax — Windows 开发机 5432 不可达，
所以全部走 unittest.mock.AsyncMock + MagicMock。
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from task_queue import Task
from worker import Worker


@pytest.fixture
def mock_worker():
    """构造一个不调 __init__ 的 Worker；只挂 task_queue 三件套。"""
    w = Worker.__new__(Worker)
    w.task_queue = MagicMock()
    w.task_queue.update_progress = AsyncMock()
    w.task_queue.complete_task = AsyncMock()
    w.task_queue.fail_task = AsyncMock()
    return w


async def test_process_minimax_tts_happy_path(mock_worker, tmp_path):
    task = Task(
        task_id='uuid-1',
        task_type='minimax_tts',
        data={
            'text': '你好世界',
            'voice_id': 'female-shaonv',
            'model': 'speech-2.8-hd',
            'speed': 1.0, 'pitch': 0, 'emotion': None,
            'entity_type': 'storyboard_item',
            'entity_id': 'item-1',
            'file_role': 'dialogue_audio',
            'episode_id': 'ep-1',
        },
        priority=2, user_id='u1',
    )
    fake_audio = b'ID3' + b'\x00' * 1024
    fake_audio_path = tmp_path / 'tts_abc12345.mp3'
    fake_audio_path.write_bytes(fake_audio)

    with patch('worker.get_minimax_audio_client') as mc, \
         patch('worker.save_generated_file_to_db', new=AsyncMock(return_value={
            'file_id': 'fid-1', 'file_url': '/storage/audio/tts_abc12345.mp3'
         })):
        client = mc.return_value
        client.tts_async = AsyncMock(return_value={'task_id': 'mx-1'})
        client.tts_wait_and_download = AsyncMock(return_value={
            'audio_url': str(fake_audio_path),
            'duration_ms': 1500,
        })
        # 2026-05-25: tts_sync 新合约——web URL 用 audio_url，磁盘路径用 local_path，
        # 内存字节用 audio_bytes（worker 优先消费 audio_bytes）。详见
        # recurring-pitfalls.md §R 子陷阱 3。
        client.tts_sync = AsyncMock(return_value={
            'audio_url': '/storage/audio/tts_abc12345.mp3',
            'local_path': str(fake_audio_path),
            'audio_bytes': fake_audio,
            'duration_ms': 1500,
            'trace_id': 'trace-xyz-1',
            'mime': 'audio/mpeg',
        })
        ok = await mock_worker._process_minimax_tts_task(task)

    assert ok is True
    mock_worker.task_queue.complete_task.assert_awaited_once()
    completed_result = mock_worker.task_queue.complete_task.call_args[0][1]
    assert completed_result['file_id'] == 'fid-1'
    assert completed_result['file_url'] == '/storage/audio/tts_abc12345.mp3'
    assert completed_result['duration_ms'] == 1500
    client.tts_sync.assert_awaited_once()
    assert client.tts_async.await_count == 0
    assert client.tts_wait_and_download.await_count == 0


async def test_process_minimax_tts_writes_back_sample_audio_url(mock_worker, tmp_path):
    """task_data 带 bind_to_character_voice_id 时必须回写 sample_audio_url。"""
    task = Task(
        task_id='uuid-2', task_type='minimax_tts',
        data={
            'text': '试听文本', 'voice_id': 'female-shaonv',
            'bind_to_character_voice_id': 'cv-99',
        },
        priority=2, user_id='u1',
    )
    fake_audio = b'ID3' + b'\x00' * 100
    fake_audio_path = tmp_path / 'tts_xyz.mp3'
    fake_audio_path.write_bytes(fake_audio)

    with patch('worker.get_minimax_audio_client') as mc, \
         patch('worker.save_generated_file_to_db', new=AsyncMock(return_value={
            'file_id': 'fid-2', 'file_url': '/storage/audio/tts_xyz.mp3'
         })), \
         patch('worker.CharacterVoiceDAO.update_sample_audio_url', new=AsyncMock()) as upd:
        client = mc.return_value
        client.tts_async = AsyncMock(return_value={'task_id': 'mx-2'})
        client.tts_wait_and_download = AsyncMock(return_value={
            'audio_url': str(fake_audio_path), 'duration_ms': 2000,
        })
        # 2026-05-25: 新合约——见上 happy_path 测试的注释。
        client.tts_sync = AsyncMock(return_value={
            'audio_url': '/storage/audio/tts_xyz.mp3',
            'local_path': str(fake_audio_path),
            'audio_bytes': fake_audio,
            'duration_ms': 2000,
            'trace_id': 'trace-xyz-2',
            'mime': 'audio/mpeg',
        })
        await mock_worker._process_minimax_tts_task(task)

    upd.assert_awaited_once_with('cv-99', '/storage/audio/tts_xyz.mp3')
    client.tts_sync.assert_awaited_once()
    assert client.tts_async.await_count == 0
    assert client.tts_wait_and_download.await_count == 0


async def test_process_minimax_tts_failure_calls_fail_task(mock_worker):
    """tts_sync 抛错时必须走 fail_task，不能 complete_task。"""
    task = Task(
        task_id='uuid-3', task_type='minimax_tts',
        data={'text': 'x', 'voice_id': 'female-shaonv'},
        priority=2, user_id='u1',
    )
    with patch('worker.get_minimax_audio_client') as mc:
        client = mc.return_value
        client.tts_async = AsyncMock(return_value={'task_id': 'mx-3'})
        client.tts_wait_and_download = AsyncMock()
        client.tts_sync = AsyncMock(
            side_effect=RuntimeError('tts_sync 失败: status_code=1004')
        )
        ok = await mock_worker._process_minimax_tts_task(task)

    assert ok is False
    mock_worker.task_queue.fail_task.assert_awaited_once()
    err_msg = mock_worker.task_queue.fail_task.call_args[0][1]
    assert 'tts_sync' in err_msg or 'status_code' in err_msg
    mock_worker.task_queue.complete_task.assert_not_awaited()
    client.tts_sync.assert_awaited_once()
    assert client.tts_async.await_count == 0
    assert client.tts_wait_and_download.await_count == 0
