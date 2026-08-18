import signal
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import requests

import agent_routes
from agent_routes import ProgressRequest
from pipeline.comfyui_agent import ComfyUIAgent


class _Response:
    def raise_for_status(self):
        return None


def _agent(monkeypatch):
    monkeypatch.setattr(signal, "signal", lambda *_args, **_kwargs: None)
    agent = ComfyUIAgent("https://example.test", "token", [8188])
    agent.agent_id = "agent-1"
    return agent


def test_progress_callback_is_task_scoped_and_capped(monkeypatch):
    agent = _agent(monkeypatch)
    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return _Response()

    monkeypatch.setattr(requests, "post", fake_post)

    assert agent._report_progress("task-1", 99, "saving") is True
    assert calls[0][0] == "https://example.test/api/agent/progress"
    assert calls[0][1]["json"] == {
        "task_id": "task-1",
        "agent_id": "agent-1",
        "progress": 95.0,
        "message": "saving",
    }


def test_comfyui_event_progress_reserves_completion_range():
    assert ComfyUIAgent._progress_from_comfyui_event({"value": 0, "max": 20}) == 10
    assert ComfyUIAgent._progress_from_comfyui_event({"value": 10, "max": 20}) == 50
    assert ComfyUIAgent._progress_from_comfyui_event({"value": 20, "max": 20}) == 90
    assert ComfyUIAgent._progress_from_comfyui_event({"value": 1, "max": 0}) is None


def test_progress_request_rejects_completion_percentage():
    with pytest.raises(ValueError):
        ProgressRequest(
            task_id="task-1",
            agent_id="agent-1",
            progress=100,
        )


@pytest.mark.asyncio
async def test_agent_progress_updates_owned_live_task(monkeypatch):
    redis = SimpleNamespace(
        hgetall=AsyncMock(
            return_value={
                "status": "processing",
                "node_id": "agent-1",
                "user_id": "user-1",
            }
        )
    )
    queue = SimpleNamespace(update_progress=AsyncMock(return_value=True))
    monkeypatch.setitem(sys.modules, "cluster_main", SimpleNamespace(redis_client=redis))
    monkeypatch.setitem(
        sys.modules,
        "cluster_config",
        SimpleNamespace(RedisConfig=SimpleNamespace(TASK_STATUS_PREFIX="task:")),
    )
    monkeypatch.setitem(
        sys.modules,
        "task_service",
        SimpleNamespace(get_queue=lambda: queue),
    )
    monkeypatch.setattr(
        agent_routes,
        "_verify_agent_token",
        AsyncMock(return_value={"agent_id": "agent-1"}),
    )
    monkeypatch.setattr(
        agent_routes.TaskDAO,
        "get_task_by_task_id",
        AsyncMock(return_value={"task_id": "task-1", "node_id": "agent-1"}),
    )
    persist = AsyncMock()
    monkeypatch.setattr(agent_routes.TaskDAO, "update_task_progress", persist)

    result = await agent_routes.agent_progress(
        ProgressRequest(
            task_id="task-1",
            agent_id="agent-1",
            progress=42,
            message="step 8/20",
        ),
        authorization="Bearer token",
    )

    assert result["progress"] == 42
    queue.update_progress.assert_awaited_once_with("task-1", 42, "step 8/20")
    persist.assert_awaited_once_with("task-1", 42, "step 8/20")
