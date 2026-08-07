from unittest.mock import AsyncMock, call

import pytest

from task_queue import Task, TaskQueue, TaskStatus
from cluster_config import RedisConfig
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


@pytest.mark.asyncio
async def test_final_failure_removes_task_from_pending_and_processing_queues(monkeypatch):
    redis = AsyncMock()
    queue = TaskQueue(redis)
    task = Task('task-final-failure', 'i2v', {}, user_id='user-1')
    task.max_retries = 1
    queue.get_task = AsyncMock(return_value=task)
    queue._save_task = AsyncMock()
    legacy_member = '{"task_id":"task-final-failure","task_type":"i2v","data":{}}'

    async def matching_members(*_args, **_kwargs):
        yield legacy_member, 10.0

    redis.zscan_iter = matching_members

    from dao_task import TaskDAO
    from dao_notification import NotificationDAO
    import db_manager

    monkeypatch.setattr(db_manager, 'get_db_manager', lambda: object())
    monkeypatch.setattr(TaskDAO, 'update_task_status', AsyncMock())
    monkeypatch.setattr(NotificationDAO, 'create', AsyncMock())

    result = await queue.fail_task(task.task_id, 'terminal failure', retry=False)

    assert result is True
    assert task.status == TaskStatus.FAILED
    assert redis.zrem.await_args_list == [
        call(RedisConfig.TASK_QUEUE_KEY, task.task_id),
        call(RedisConfig.TASK_QUEUE_KEY, legacy_member),
        call(RedisConfig.PROCESSING_QUEUE_KEY, task.task_id),
    ]
