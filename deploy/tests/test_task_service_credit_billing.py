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
