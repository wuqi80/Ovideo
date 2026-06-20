from datetime import datetime
from types import SimpleNamespace

import pytest

from services import task_read_service as svc


class _Logger:
    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass

    def error(self, *_args, **_kwargs):
        pass


class _TaskDAO:
    def __init__(self, *, status_task=None, list_tasks=None, raise_on_list=False):
        self.status_task = status_task
        self.list_tasks = list_tasks or []
        self.raise_on_list = raise_on_list

    async def get_task_by_task_id(self, _task_id):
        return self.status_task

    async def get_user_tasks(self, _username, limit=100):
        if self.raise_on_list:
            raise RuntimeError("db down")
        return self.list_tasks[:limit]


class _Queue:
    def __init__(self, *, task=None, tasks=None):
        self.task = task
        self.tasks = tasks or []

    async def get_task(self, _task_id):
        return self.task

    async def get_user_tasks(self, _username, limit=100, status=None):
        rows = self.tasks
        if status:
            rows = [task for task in rows if task.status.value == status]
        return rows[:limit]


def _queue_task(task_id="task_redis", status="processing"):
    return SimpleNamespace(
        task_id=task_id,
        task_type="image",
        status=SimpleNamespace(value=status),
        progress=42,
        node_id="node-1",
        result={"image": "ok"},
        error=None,
        created_at="created",
        started_at="started",
        completed_at=None,
        data={"prompt": "hi"},
    )


def _db_available():
    return object()


def _db_missing():
    return None


@pytest.mark.asyncio
async def test_get_task_status_prefers_queue_task():
    result = await svc.get_task_status_response(
        task_id="task_1",
        task_queue=_Queue(task=_queue_task()),
        task_dao=_TaskDAO(status_task={"task_id": "task_db"}),
        get_db_manager=_db_available,
        logger=_Logger(),
    )

    assert result["task_id"] == "task_redis"
    assert result["status"] == "processing"
    assert "source" not in result


@pytest.mark.asyncio
async def test_get_task_status_falls_back_to_database():
    db_row = {
        "task_id": "task_db",
        "status": "completed",
        "result_data": '{"url": "/storage/out.png"}',
        "error_message": None,
        "created_at": datetime(2026, 1, 1, 1, 2, 3),
        "started_at": None,
        "completed_at": datetime(2026, 1, 1, 1, 3, 4),
    }
    result = await svc.get_task_status_response(
        task_id="task_db",
        task_queue=_Queue(task=None),
        task_dao=_TaskDAO(status_task=db_row),
        get_db_manager=_db_available,
        logger=_Logger(),
    )

    assert result["task_id"] == "task_db"
    assert result["status"] == "completed"
    assert result["progress"] == 100
    assert result["result"] == {"url": "/storage/out.png"}
    assert result["source"] == "database"


@pytest.mark.asyncio
async def test_list_user_tasks_formats_database_rows():
    db_row = {
        "task_id": "task_db",
        "task_type": "video",
        "status": "completed",
        "progress": 100,
        "result_data": '{"videos": []}',
        "task_data": '{"prompt": "scene"}',
        "error_message": None,
        "created_at": datetime(2026, 1, 1, 1, 2, 3),
        "completed_at": datetime(2026, 1, 1, 1, 3, 4),
    }
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status=None,
        task_queue=_Queue(tasks=[_queue_task()]),
        task_dao=_TaskDAO(list_tasks=[db_row]),
        get_db_manager=_db_available,
        logger=_Logger(),
    )

    assert result["success"] is True
    assert result["tasks"] == [
        {
            "task_id": "task_db",
            "task_type": "video",
            "status": "completed",
            "progress": 100,
            "result": {"videos": []},
            "error": None,
            "created_at": "2026-01-01T01:02:03",
            "completed_at": "2026-01-01T01:03:04",
            "data": {"prompt": "scene"},
        }
    ]


@pytest.mark.asyncio
async def test_list_user_tasks_falls_back_to_queue_when_database_fails():
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status="processing",
        task_queue=_Queue(tasks=[_queue_task(status="processing"), _queue_task("done", "completed")]),
        task_dao=_TaskDAO(raise_on_list=True),
        get_db_manager=_db_available,
        logger=_Logger(),
    )

    assert result["success"] is True
    assert [task["task_id"] for task in result["tasks"]] == ["task_redis"]


@pytest.mark.asyncio
async def test_list_user_tasks_uses_queue_when_database_missing():
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status=None,
        task_queue=_Queue(tasks=[_queue_task()]),
        task_dao=_TaskDAO(list_tasks=[]),
        get_db_manager=_db_missing,
        logger=_Logger(),
    )

    assert result["success"] is True
    assert result["tasks"][0]["task_id"] == "task_redis"
