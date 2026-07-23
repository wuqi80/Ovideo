import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

import agent_routes
import services.legacy_file_service as legacy_file_service


class _FakeRedis:
    def __init__(self, task_hash):
        self.task_hash = task_hash

    async def hgetall(self, _key):
        return self.task_hash


@pytest.fixture
def agent_file_dependencies(monkeypatch, tmp_path):
    source = tmp_path / "input.png"
    source.write_bytes(b"png")
    task_hash = {
        "node_id": "agent_gpu2",
        "user_id": "Yuan",
        "data": json.dumps(
            {
                "agent_files": [
                    {
                        "filename": "input.png",
                        "url": "/api/files/file_allowed/download",
                    }
                ]
            }
        ),
    }
    fake_redis = _FakeRedis(task_hash)
    monkeypatch.setitem(sys.modules, "cluster_main", SimpleNamespace(redis_client=fake_redis))
    monkeypatch.setitem(
        sys.modules,
        "cluster_config",
        SimpleNamespace(RedisConfig=SimpleNamespace(TASK_STATUS_PREFIX="task:")),
    )
    monkeypatch.setattr(
        agent_routes.AgentDAO,
        "get_by_token",
        AsyncMock(return_value={"agent_id": "agent_gpu2", "enabled": True}),
    )
    monkeypatch.setattr(agent_routes.TaskDAO, "get_task", AsyncMock(return_value=None))

    async def fake_download_info(**kwargs):
        assert kwargs["identity"] == "Yuan"
        assert kwargs["file_id"] == "file_allowed"
        return SimpleNamespace(
            file_path=str(source),
            mime_type="image/png",
            filename="input.png",
        )

    monkeypatch.setattr(legacy_file_service, "get_legacy_download_info", fake_download_info)
    return source


@pytest.mark.asyncio
async def test_claimed_agent_can_download_declared_task_file(agent_file_dependencies):
    response = await agent_routes.agent_download_task_file(
        "task_1",
        "file_allowed",
        authorization="Bearer agent-token",
    )

    assert Path(response.path) == agent_file_dependencies
    assert response.media_type == "image/png"


@pytest.mark.asyncio
async def test_claimed_agent_cannot_download_undeclared_file(agent_file_dependencies):
    with pytest.raises(HTTPException) as exc:
        await agent_routes.agent_download_task_file(
            "task_1",
            "file_other",
            authorization="Bearer agent-token",
        )

    assert exc.value.status_code == 404
    assert exc.value.detail == "Task input file not found"


@pytest.mark.asyncio
async def test_other_agent_cannot_download_declared_task_file(
    agent_file_dependencies,
    monkeypatch,
):
    monkeypatch.setattr(
        agent_routes.AgentDAO,
        "get_by_token",
        AsyncMock(return_value={"agent_id": "agent_other", "enabled": True}),
    )

    with pytest.raises(HTTPException) as exc:
        await agent_routes.agent_download_task_file(
            "task_1",
            "file_allowed",
            authorization="Bearer other-agent-token",
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "Task is assigned to another agent"
