"""Task recovery and notification business logic."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional


class TaskNotificationServiceError(RuntimeError):
    pass


class TaskFileForbidden(TaskNotificationServiceError):
    pass


def _row_to_dict(row: Any) -> Dict[str, Any]:
    return dict(row)


def _rows_to_dicts(rows: Any) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


def _normalize_task_data(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _since_ms_to_naive_utc(since: Optional[int]) -> Optional[datetime]:
    if not since:
        return None
    return datetime.fromtimestamp(since / 1000, tz=timezone.utc).replace(tzinfo=None)


async def get_recent_tasks(
    *,
    user_id: str,
    hours: int,
    task_dao: Any,
) -> Dict[str, Any]:
    tasks = await task_dao.get_recent_completed_tasks(user_id, hours)
    return {"success": True, "tasks": _rows_to_dicts(tasks)}


async def get_task_files(
    *,
    task_id: str,
    user_id: str,
    task_dao: Any,
) -> Dict[str, Any]:
    task = await task_dao.get_task(task_id)
    if not task or task["user_id"] != user_id:
        raise TaskFileForbidden("Task files are not accessible")
    files = await task_dao.get_task_files(task_id)
    return {"success": True, "files": _rows_to_dicts(files)}


async def get_active_tasks(
    *,
    user_id: str,
    task_dao: Any,
) -> Dict[str, Any]:
    tasks = await task_dao.get_active_tasks_for_user(user_id, limit=50)
    return {"success": True, "tasks": _rows_to_dicts(tasks)}


async def get_task_notifications(
    *,
    user_id: str,
    since: Optional[int],
    task_dao: Any,
) -> Dict[str, Any]:
    since_dt = _since_ms_to_naive_utc(since)
    tasks = await task_dao.get_terminal_tasks_for_notifications(user_id, since_dt, limit=20)

    notifications = []
    for task in tasks:
        row = _row_to_dict(task)
        task_data = _normalize_task_data(row.pop("task_data", None) or {})
        row["entity_type"] = task_data.get("entity_type", "")
        row["entity_id"] = task_data.get("entity_id", "")
        row["file_role"] = task_data.get("file_role", "")
        row["episode_id"] = task_data.get("episode_id", "")
        notifications.append(row)

    return {"success": True, "notifications": notifications}


async def get_unread_notification_count(
    *,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    count = await notification_dao.get_unread_count(user_id)
    return {"success": True, "count": count}


async def get_notifications(
    *,
    user_id: str,
    status: Optional[str],
    limit: int,
    offset: int,
    notification_dao: Any,
) -> Dict[str, Any]:
    if status == "unread":
        items = await notification_dao.get_unread(user_id, limit=limit)
    else:
        items = await notification_dao.get_history(user_id, limit=limit, offset=offset)
    return {"success": True, "notifications": _rows_to_dicts(items)}


async def mark_notification_read(
    *,
    notification_id: str,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    await notification_dao.mark_read(notification_id, user_id)
    return {"success": True}


async def mark_all_notifications_read(
    *,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    count = await notification_dao.mark_all_read(user_id)
    return {"success": True, "count": count}


async def dismiss_notification(
    *,
    notification_id: str,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    await notification_dao.dismiss(notification_id, user_id)
    return {"success": True}
