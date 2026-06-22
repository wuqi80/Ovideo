from __future__ import annotations

from datetime import datetime

import pytest

from services import task_notification_service


class FakeTaskDAO:
    recent_args = None
    active_args = None
    terminal_args = None
    task_user_id = "user_1"

    @classmethod
    async def get_recent_completed_tasks(cls, user_id: str, hours: int):
        cls.recent_args = {"user_id": user_id, "hours": hours}
        return [{"task_id": "task_recent", "user_id": user_id}]

    @classmethod
    async def get_task(cls, task_id: str):
        if task_id == "missing":
            return None
        return {"task_id": task_id, "user_id": cls.task_user_id}

    @staticmethod
    async def get_task_files(task_id: str):
        return [{"file_id": "file_1", "task_id": task_id}]

    @classmethod
    async def get_active_tasks_for_user(cls, user_id: str, limit: int):
        cls.active_args = {"user_id": user_id, "limit": limit}
        return [{"task_id": "active_1", "user_id": user_id}]

    @classmethod
    async def get_terminal_tasks_for_notifications(cls, user_id: str, since_dt, limit: int):
        cls.terminal_args = {"user_id": user_id, "since_dt": since_dt, "limit": limit}
        return [
            {
                "task_id": "done_1",
                "user_id": user_id,
                "task_data": '{"entity_type": "shot", "entity_id": "sb_1", "file_role": "image", "episode_id": "ep_1"}',
            },
            {
                "task_id": "done_2",
                "user_id": user_id,
                "task_data": "bad-json",
            },
        ]


class FakeNotificationDAO:
    read = []
    dismissed = []

    @staticmethod
    async def get_unread_count(user_id: str):
        return 3

    @staticmethod
    async def get_unread(user_id: str, limit: int = 50):
        return [{"notification_id": "n_unread", "user_id": user_id, "limit": limit}]

    @staticmethod
    async def get_history(user_id: str, limit: int = 100, offset: int = 0):
        return [{"notification_id": "n_history", "user_id": user_id, "limit": limit, "offset": offset}]

    @classmethod
    async def mark_read(cls, notification_id: str, user_id: str):
        cls.read.append({"notification_id": notification_id, "user_id": user_id})
        return True

    @staticmethod
    async def mark_all_read(user_id: str):
        return 7

    @classmethod
    async def dismiss(cls, notification_id: str, user_id: str):
        cls.dismissed.append({"notification_id": notification_id, "user_id": user_id})
        return True


def setup_function():
    FakeTaskDAO.recent_args = None
    FakeTaskDAO.active_args = None
    FakeTaskDAO.terminal_args = None
    FakeTaskDAO.task_user_id = "user_1"
    FakeNotificationDAO.read = []
    FakeNotificationDAO.dismissed = []


async def test_get_recent_and_active_tasks_delegate_with_limits():
    recent = await task_notification_service.get_recent_tasks(
        user_id="user_1",
        hours=12,
        task_dao=FakeTaskDAO,
    )
    active = await task_notification_service.get_active_tasks(
        user_id="user_1",
        task_dao=FakeTaskDAO,
    )

    assert recent["tasks"] == [{"task_id": "task_recent", "user_id": "user_1"}]
    assert active["tasks"] == [{"task_id": "active_1", "user_id": "user_1"}]
    assert FakeTaskDAO.recent_args == {"user_id": "user_1", "hours": 12}
    assert FakeTaskDAO.active_args == {"user_id": "user_1", "limit": 50}


async def test_get_task_files_rejects_missing_or_foreign_task():
    result = await task_notification_service.get_task_files(
        task_id="task_1",
        user_id="user_1",
        task_dao=FakeTaskDAO,
    )

    assert result == {"success": True, "files": [{"file_id": "file_1", "task_id": "task_1"}]}

    FakeTaskDAO.task_user_id = "other"
    with pytest.raises(task_notification_service.TaskFileForbidden):
        await task_notification_service.get_task_files(
            task_id="task_1",
            user_id="user_1",
            task_dao=FakeTaskDAO,
        )

    with pytest.raises(task_notification_service.TaskFileForbidden):
        await task_notification_service.get_task_files(
            task_id="missing",
            user_id="user_1",
            task_dao=FakeTaskDAO,
        )


async def test_get_task_notifications_normalizes_task_data_and_since_ms():
    result = await task_notification_service.get_task_notifications(
        user_id="user_1",
        since=1710000000000,
        task_dao=FakeTaskDAO,
    )

    assert FakeTaskDAO.terminal_args["limit"] == 20
    assert isinstance(FakeTaskDAO.terminal_args["since_dt"], datetime)
    assert FakeTaskDAO.terminal_args["since_dt"].tzinfo is None
    assert result["notifications"][0]["entity_type"] == "shot"
    assert result["notifications"][0]["entity_id"] == "sb_1"
    assert result["notifications"][0]["file_role"] == "image"
    assert result["notifications"][0]["episode_id"] == "ep_1"
    assert result["notifications"][1]["entity_type"] == ""


async def test_notification_count_and_lists_delegate_to_notification_dao():
    unread_count = await task_notification_service.get_unread_notification_count(
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )
    unread = await task_notification_service.get_notifications(
        user_id="user_1",
        status="unread",
        limit=5,
        offset=9,
        notification_dao=FakeNotificationDAO,
    )
    history = await task_notification_service.get_notifications(
        user_id="user_1",
        status=None,
        limit=6,
        offset=2,
        notification_dao=FakeNotificationDAO,
    )

    assert unread_count == {"success": True, "count": 3}
    assert unread["notifications"][0]["notification_id"] == "n_unread"
    assert unread["notifications"][0]["limit"] == 5
    assert history["notifications"][0]["notification_id"] == "n_history"
    assert history["notifications"][0]["offset"] == 2


async def test_mark_and_dismiss_notifications_delegate_to_notification_dao():
    marked = await task_notification_service.mark_notification_read(
        notification_id="n_1",
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )
    all_marked = await task_notification_service.mark_all_notifications_read(
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )
    dismissed = await task_notification_service.dismiss_notification(
        notification_id="n_2",
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )

    assert marked == {"success": True}
    assert all_marked == {"success": True, "count": 7}
    assert dismissed == {"success": True}
    assert FakeNotificationDAO.read == [{"notification_id": "n_1", "user_id": "user_1"}]
    assert FakeNotificationDAO.dismissed == [{"notification_id": "n_2", "user_id": "user_1"}]
