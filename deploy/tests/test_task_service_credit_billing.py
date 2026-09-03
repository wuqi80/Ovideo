from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from services import credit_service
from services import task_credit_billing_service
from services.task_service import TaskService


class _Queue:
    def __init__(self, result=True):
        self.result = result
        self.tasks = []

    async def enqueue(self, task):
        self.tasks.append(task)
        return self.result

    async def reserve_local_user_slot(self, *_args, **_kwargs):
        return True

    async def release_local_user_slot(self, *_args, **_kwargs):
        return None

    async def reserve_daily_quota(self, *_args, **_kwargs):
        return True

    async def release_daily_quota(self, *_args, **_kwargs):
        return None


@pytest.mark.asyncio
async def test_submit_reserves_before_enqueue_and_persists_metadata(monkeypatch):
    events = []

    async def reserve(**kwargs):
        events.append("reserve")
        kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY] = {
            "feature_key": "video_generation",
            "owner_id": kwargs["user_id"],
        }
        return kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY]

    async def release(**_kwargs):
        events.append("release")

    monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)
    monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)

    service = TaskService(None)
    service.queue = _Queue()
    task_data = {"duration": 5}
    task_id = await service.submit(
        task_type="i2v",
        task_data=task_data,
        user_id="user-1",
        prepare=False,
        task_id="task-1",
    )

    assert task_id == "task-1"
    assert events == ["reserve"]
    assert service.queue.tasks[0].data is task_data
    assert task_credit_billing_service.BILLING_METADATA_KEY in service.queue.tasks[0].data


@pytest.mark.asyncio
async def test_submit_releases_reservation_when_enqueue_fails(monkeypatch):
    releases = []

    async def reserve(**kwargs):
        kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY] = {
            "feature_key": "video_generation",
            "owner_id": kwargs["user_id"],
        }
        return kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY]

    async def release(**kwargs):
        releases.append(kwargs)

    monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)
    monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)

    service = TaskService(None)
    service.queue = _Queue(result=False)
    with pytest.raises(HTTPException) as exc_info:
        await service.submit(
            task_type="i2v",
            task_data={"duration": 5},
            user_id="user-1",
            prepare=False,
            task_id="task-2",
        )

    assert exc_info.value.status_code == 500
    assert releases[0]["task_id"] == "task-2"
    assert releases[0]["reason"] == "enqueue_failed"


@pytest.mark.asyncio
async def test_submit_maps_insufficient_credits_to_payment_required(monkeypatch):
    async def reserve(**_kwargs):
        raise credit_service.InsufficientCreditsError("available=1 required=50")

    async def release(**_kwargs):
        raise AssertionError("no reservation exists")

    monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)
    monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)

    service = TaskService(None)
    service.queue = _Queue()
    with pytest.raises(HTTPException) as exc_info:
        await service.submit(
            task_type="i2v",
            task_data={"duration": 5},
            user_id="user-1",
            prepare=False,
            task_id="task-3",
        )

    assert exc_info.value.status_code == 402
    assert "创作点数不足" in str(exc_info.value.detail)
    assert service.queue.tasks == []


@pytest.mark.asyncio
async def test_submit_rejects_third_active_local_node_task_before_billing(monkeypatch):
    from dao_task import TaskDAO

    async def reserve_credits(**_kwargs):
        raise AssertionError("billing must not run after queue limit rejection")

    monkeypatch.setattr(
        TaskDAO,
        "get_active_tasks_for_user",
        AsyncMock(return_value=[
            {"task_id": "old-1", "task_type": "i2v"},
            {"task_id": "old-2", "task_type": "upscale"},
        ]),
    )
    monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve_credits)

    service = TaskService(object(), model_access_checker=AsyncMock(return_value={}))
    service.queue = _Queue()
    service.queue.reserve_local_user_slot = AsyncMock(return_value=False)

    with pytest.raises(HTTPException) as exc_info:
        await service.submit("i2v", {}, "user-1", prepare=False, task_id="new-local")

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail["code"] == "local_node_user_queue_limit"


@pytest.mark.asyncio
async def test_image_upscale_uses_an_independent_two_task_lane(monkeypatch):
    from dao_task import TaskDAO

    monkeypatch.setattr(
        TaskDAO,
        "get_active_tasks_for_user",
        AsyncMock(return_value=[
            {"task_id": "video-1", "task_type": "i2v", "task_data": {}},
            {"task_id": "video-2", "task_type": "upscale_hd", "task_data": {}},
        ]),
    )
    monkeypatch.setattr(
        task_credit_billing_service,
        "reserve_task_credits",
        AsyncMock(return_value=False),
    )

    service = TaskService(object(), model_access_checker=AsyncMock(return_value={}))
    service.queue = _Queue()
    service.queue.reserve_local_user_slot = AsyncMock(return_value=True)

    task_id = await service.submit(
        "image_upscale",
        {"requested_workflow_type": "image_upscale"},
        "user-1",
        prepare=False,
        task_id="image-1",
    )

    assert task_id == "image-1"
    assert service.queue.tasks[0].data["queue_lane"] == "image_upscale"
    reservation = service.queue.reserve_local_user_slot.await_args
    assert reservation.kwargs["lane"] == "image_upscale"
    assert reservation.kwargs["active_task_ids"] == []


@pytest.mark.asyncio
async def test_submit_rejects_third_image_upscale_without_counting_video_tasks(monkeypatch):
    from dao_task import TaskDAO

    async def reserve_credits(**_kwargs):
        raise AssertionError("billing must not run after image-upscale limit rejection")

    monkeypatch.setattr(
        TaskDAO,
        "get_active_tasks_for_user",
        AsyncMock(return_value=[
            {"task_id": "image-1", "task_type": "image_upscale", "task_data": {}},
            {"task_id": "image-2", "task_type": "image_upscale", "task_data": {}},
            {"task_id": "video-1", "task_type": "i2v", "task_data": {}},
            {"task_id": "video-2", "task_type": "upscale_hd", "task_data": {}},
        ]),
    )
    monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve_credits)

    service = TaskService(object(), model_access_checker=AsyncMock(return_value={}))
    service.queue = _Queue()
    service.queue.reserve_local_user_slot = AsyncMock(return_value=False)

    with pytest.raises(HTTPException) as exc_info:
        await service.submit(
            "image_upscale",
            {"requested_workflow_type": "image_upscale"},
            "user-1",
            prepare=False,
            task_id="image-3",
        )

    reservation = service.queue.reserve_local_user_slot.await_args
    assert reservation.kwargs["lane"] == "image_upscale"
    assert reservation.kwargs["active_task_ids"] == ["image-1", "image-2"]
    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == {
        "code": "image_upscale_user_queue_limit",
        "message": "图片放大任务每位用户最多同时排队或处理 2 个，请等待已有任务完成后再试",
    }


@pytest.mark.asyncio
async def test_submit_rejects_fourth_platform_hailuo_task_with_exact_message(monkeypatch):
    from unittest.mock import AsyncMock
    from dao_task import TaskDAO

    monkeypatch.setattr(
        TaskDAO,
        "get_task_ids_created_between",
        AsyncMock(return_value=["hailuo-1", "hailuo-2", "hailuo-3"]),
    )
    service = TaskService(object(), model_access_checker=AsyncMock(return_value={}))
    service.queue = _Queue()
    service.queue.reserve_daily_quota = AsyncMock(return_value=False)

    with pytest.raises(HTTPException) as exc_info:
        await service.submit("minimax_i2v", {}, "user-1", prepare=False, task_id="hailuo-4")

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == {
        "code": "minimax_hailuo_daily_limit",
        "message": "今日已达限额",
    }
