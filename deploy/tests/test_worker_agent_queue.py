import json

import pytest

from core.worker import Worker
from task_queue import Task, TaskStatus


class FakeRedis:
    def __init__(self):
        self.zadds = []

    async def zadd(self, key, mapping):
        self.zadds.append((key, mapping))


class FakeTaskQueue:
    def __init__(self):
        self.saved = []

    async def _save_task(self, task):
        self.saved.append(task.to_dict())


@pytest.mark.asyncio
async def test_lite_worker_requeues_comfyui_task_as_agent_json_member():
    redis = FakeRedis()
    queue = FakeTaskQueue()
    worker = Worker("lite-1", redis, None, queue)
    task = Task(
        task_id="task-agent-only",
        task_type="i2i_fj",
        data={"agent_files": ["input.png"], "_lite_bounce": 1},
        priority=2,
        user_id="user-1",
    )

    await worker._enqueue_for_gpu_agent(task)

    assert queue.saved[0]["status"] == TaskStatus.QUEUED.value
    assert len(redis.zadds) == 1
    _, mapping = redis.zadds[0]
    member = next(iter(mapping))
    assert member != task.task_id
    payload = json.loads(member)
    assert payload["task_id"] == task.task_id
    assert payload["task_type"] == "i2i_fj"
    assert payload["data"]["agent_files"] == ["input.png"]
