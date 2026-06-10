"""Wiring chain: GenerateRequest → task.data → worker → client kwargs.

Goal: catch silent-failure regressions where new payload fields get dropped
between layers (recurring-pitfalls.md §G).

The Task 5 DashScope cards redesign added new request fields
(`kling_multi_shot`, `vidu_resolution`, `hh_ratio`, ...) on the frontend, but
the chain was broken in two places:

  1. `GenerateRequest` (cluster_main.py) had Pydantic's default
     `extra='ignore'` — silently dropping unknown fields before `task.data`.
  2. `_process_dashscope_video_task` (worker.py) didn't forward the new fields
     to `client.<model>_submit(...)` even after task.data carried them.

Mock-only — no real DB, no real HTTP. Each test isolates one layer's link.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import cluster_main


# ─── Layer 1: GenerateRequest must accept extras (extra='allow') ───────────


def test_generate_request_accepts_kling_multi_shot_extras():
    """Pydantic GenerateRequest must NOT drop kling_multi_shot via extra='ignore'."""
    body = cluster_main.GenerateRequest(
        task_type='kling_t2v', prompt='x',
        kling_multi_shot=True, kling_shot_type='customize',
        kling_multi_prompt=[{'index': 1, 'prompt': 'a', 'duration': 5}],
    )
    dumped = body.model_dump()
    assert dumped.get('kling_multi_shot') is True
    assert dumped.get('kling_shot_type') == 'customize'
    assert dumped.get('kling_multi_prompt') == [{'index': 1, 'prompt': 'a', 'duration': 5}]


def test_generate_request_accepts_vidu_resolution_and_seed():
    body = cluster_main.GenerateRequest(
        task_type='vidu_r2v', prompt='x',
        vidu_resolution='1080P', vidu_size='1920*1080', vidu_seed=42, vidu_audio=True,
    )
    dumped = body.model_dump()
    assert dumped.get('vidu_resolution') == '1080P'
    assert dumped.get('vidu_size') == '1920*1080'
    assert dumped.get('vidu_seed') == 42
    assert dumped.get('vidu_audio') is True


def test_generate_request_accepts_hh_ratio_and_seed():
    body = cluster_main.GenerateRequest(
        task_type='happyhorse_r2v', prompt='x',
        hh_resolution='720P', hh_ratio='9:21', hh_duration=7, hh_seed=42, hh_watermark=False,
    )
    dumped = body.model_dump()
    assert dumped.get('hh_ratio') == '9:21'
    assert dumped.get('hh_resolution') == '720P'
    assert dumped.get('hh_seed') == 42
    assert dumped.get('hh_duration') == 7
    assert dumped.get('hh_watermark') is False


# ─── Layer 2: worker → client kwargs propagation ───────────────────────────


async def test_worker_passes_kling_multi_shot_to_client():
    """worker._process_dashscope_video_task must propagate kling_multi_shot to client.kling_submit.

    Strategy: bypass __init__ heavy deps via __new__, stub task_queue, and make
    `extract_video_url` return None so the inner code path short-circuits with
    ValueError BEFORE attempting an aiohttp download. The outer except in
    `_process_dashscope_video_task` swallows the ValueError and calls
    `task_queue.fail_task` — fine for our purposes, we only need to prove
    `kling_submit` was called with `multi_shot=True` BEFORE the short-circuit.
    """
    import worker as worker_mod
    from worker import Worker  # class is named `Worker` in this codebase (not TaskWorker)

    fake_task = MagicMock()
    fake_task.task_id = 't-1'
    fake_task.task_type = 'kling_t2v'
    fake_task.data = {
        'prompt': 'multi-scene story',
        'kling_multi_shot': True,
        'kling_shot_type': 'customize',
        'kling_multi_prompt': [
            {'index': 1, 'prompt': 'shot1', 'duration': 5},
            {'index': 2, 'prompt': 'shot2', 'duration': 5},
        ],
        'duration': 10,
        'aspect_ratio': '9:16',
    }

    fake_client = MagicMock()
    fake_client.kling_submit = AsyncMock(
        return_value={'output': {'task_id': 'ds-1', 'task_status': 'PENDING'}}
    )
    fake_client.query_task = AsyncMock(
        return_value={'output': {'task_status': 'SUCCEEDED'}}
    )
    # Force the worker's `if not video_url: raise ValueError` short-circuit:
    fake_client.extract_video_url = MagicMock(return_value=None)

    # patch the dashscope_video_api factory (imported inside the worker fn)
    with patch('dashscope_video_api.get_dashscope_video_client', return_value=fake_client):
        # Bypass __init__ heavy deps (redis, cluster_manager, ...)
        tw = Worker.__new__(Worker)
        tw.task_queue = MagicMock()
        tw.task_queue.update_progress = AsyncMock()
        tw.task_queue.complete_task = AsyncMock()
        tw.task_queue.fail_task = AsyncMock()
        # Defensive: kling_t2v with empty media_inputs won't call this, but stub anyway.
        tw._file_id_to_dashscope_url = AsyncMock(
            side_effect=lambda src, label='x': src or ''
        )

        # _process_dashscope_video_task wraps everything in try/except and returns
        # False on failure (e.g. our forced "no video_url" ValueError). Either way,
        # kling_submit was called before the failure point — that's what we assert.
        result = await tw._process_dashscope_video_task(fake_task)
        # Result is False because we deliberately starved video_url; that's fine.
        assert result is False

    # Verify kling_submit was called with the new kwargs that prove the wiring works.
    assert fake_client.kling_submit.await_count >= 1, "kling_submit was never awaited"
    call_kwargs = fake_client.kling_submit.await_args.kwargs
    assert call_kwargs.get('multi_shot') is True, (
        f"Expected multi_shot=True in kling_submit kwargs, got: {call_kwargs}"
    )
    assert call_kwargs.get('shot_type') == 'customize'
    assert isinstance(call_kwargs.get('multi_prompt'), list)
    assert len(call_kwargs['multi_prompt']) == 2
    assert call_kwargs['multi_prompt'][0]['prompt'] == 'shot1'
