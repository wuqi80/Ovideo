from unittest.mock import AsyncMock

import pytest

from task_queue import Task, TaskQueue, TaskStatus
from task_service import TaskService


@pytest.mark.asyncio
async def test_task_service_uses_preallocated_task_id():
    service = TaskService(AsyncMock())
    service.queue.enqueue = AsyncMock(return_value=True)

    task_id = await service.submit(
        task_type='video_reverse_prompt',
        task_data={'value': 1},
        user_id='user-1',
        prepare=False,
        task_id='task-reserved',
    )

    assert task_id == 'task-reserved'
    enqueued = service.queue.enqueue.await_args.args[0]
    assert enqueued.task_id == 'task-reserved'


@pytest.mark.asyncio
@pytest.mark.parametrize('method_name', ['complete_task', 'fail_task'])
async def test_cancelled_task_rejects_late_terminal_write(method_name):
    redis = AsyncMock()
    queue = TaskQueue(redis)
    task = Task('task-cancelled', 'video_reverse_prompt', {}, user_id='user-1')
    task.status = TaskStatus.CANCELLED
    queue.get_task = AsyncMock(return_value=task)
    queue._save_task = AsyncMock()

    if method_name == 'complete_task':
        result = await queue.complete_task(task.task_id, {'result': True})
    else:
        result = await queue.fail_task(task.task_id, 'late failure')

    assert result is False
    queue._save_task.assert_not_awaited()
    redis.zrem.assert_awaited_once()
