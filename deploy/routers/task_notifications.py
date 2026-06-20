# -*- coding: utf-8 -*-
"""Task recovery, task notification, and persisted notification routes."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from dao_notification import NotificationDAO


def create_task_notifications_router(
    *,
    get_current_user_dependency: Any,
    task_dao: Any,
    get_db_manager_func: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    TaskDAO = task_dao

    @router.get("/api/tasks/recent")
    async def get_recent_tasks(
        hours: int = 24,
        user_id: str = Depends(get_current_user)
    ):
        """鑾峰彇鏈€杩戝畬鎴愮殑浠诲姟(鐢ㄤ簬鎭㈠涓㈠け鐨勪换鍔?"""
        try:
            tasks = await TaskDAO.get_recent_completed_tasks(user_id, hours)
            return {
                "success": True,
                "tasks": tasks
            }

        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/tasks/{task_id}/files")
    async def get_task_files(
        task_id: str,
        user_id: str = Depends(get_current_user)
    ):
        """鑾峰彇浠诲姟鐩稿叧鐨勬枃浠?"""
        try:
            task = await TaskDAO.get_task(task_id)
            if not task or task['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="鏃犳潈璁块棶")

            files = await TaskDAO.get_task_files(task_id)
            return {
                "success": True,
                "files": files
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/tasks/active")
    async def get_active_tasks(
        user_id: str = Depends(get_current_user)
    ):
        """鑾峰彇鐢ㄦ埛鎵€鏈夋椿璺冧换鍔★紙running + queued锛?"""
        try:
            tasks = await TaskDAO.get_active_tasks_for_user(user_id, limit=50)
            return {"success": True, "tasks": tasks}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/tasks/notifications")
    async def get_task_notifications(
        since: Optional[int] = None,
        user_id: str = Depends(get_current_user)
    ):
        """鑾峰彇鏈€杩戝畬鎴?澶辫触鐨勪换鍔￠€氱煡"""
        try:
            since_dt = None
            if since:
                # tasks.completed_at is a naive UTC timestamp; strip tzinfo before comparing.
                since_dt = datetime.fromtimestamp(since / 1000, tz=timezone.utc).replace(tzinfo=None)
            tasks = await TaskDAO.get_terminal_tasks_for_notifications(user_id, since_dt, limit=20)

            notifications = []
            for t in tasks:
                row = dict(t)
                td = row.pop("task_data", None) or {}
                if isinstance(td, str):
                    try:
                        td = json.loads(td)
                    except Exception:
                        td = {}
                row["entity_type"] = td.get("entity_type", "")
                row["entity_id"] = td.get("entity_id", "")
                row["file_role"] = td.get("file_role", "")
                row["episode_id"] = td.get("episode_id", "")
                notifications.append(row)

            return {"success": True, "notifications": notifications}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/notifications/unread-count")
    async def get_unread_notification_count(user_id: str = Depends(get_current_user)):
        try:
            count = await NotificationDAO.get_unread_count(user_id)
            return {"success": True, "count": count}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/notifications")
    async def get_notifications(
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        user_id: str = Depends(get_current_user)
    ):
        try:
            if status == 'unread':
                items = await NotificationDAO.get_unread(user_id, limit=limit)
            else:
                items = await NotificationDAO.get_history(user_id, limit=limit, offset=offset)
            return {"success": True, "notifications": items}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/notifications/{notification_id}/read")
    async def mark_notification_read(notification_id: str, user_id: str = Depends(get_current_user)):
        try:
            await NotificationDAO.mark_read(notification_id, user_id)
            return {"success": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/notifications/read-all")
    async def mark_all_notifications_read(user_id: str = Depends(get_current_user)):
        try:
            count = await NotificationDAO.mark_all_read(user_id)
            return {"success": True, "count": count}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/notifications/{notification_id}")
    async def dismiss_notification(notification_id: str, user_id: str = Depends(get_current_user)):
        try:
            await NotificationDAO.dismiss(notification_id, user_id)
            return {"success": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router
