"""Read-side helpers for task routes.

Routers should not know whether task state came from Redis or PostgreSQL. This
module keeps DB availability checks, DAO fallbacks, and response normalization
in one place while preserving the existing route response shape.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Optional


def _jsonish(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return default
    return value


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    return str(value)


def database_available(get_db_manager: Callable[[], Any]) -> bool:
    try:
        return bool(get_db_manager())
    except Exception:
        return False


def format_queue_task_status(task: Any) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "status": task.status.value,
        "progress": task.progress,
        "node_id": task.node_id,
        "result": task.result,
        "error": task.error,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }


def format_db_task_status(task: dict[str, Any]) -> dict[str, Any]:
    result_data = _jsonish(task.get("result_data"), task.get("result_data"))
    return {
        "task_id": task["task_id"],
        "status": task["status"],
        "progress": 100 if task["status"] == "completed" else 0,
        "node_id": task.get("node_id"),
        "result": result_data,
        "error": task.get("error_message"),
        "created_at": str(task["created_at"]) if task.get("created_at") else None,
        "started_at": str(task["started_at"]) if task.get("started_at") else None,
        "completed_at": str(task["completed_at"]) if task.get("completed_at") else None,
        "source": "database",
    }


def format_db_task_summary(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_id": task.get("task_id"),
        "task_type": task.get("task_type"),
        "status": task.get("status", "unknown"),
        "progress": task.get("progress", 0),
        "result": _jsonish(task.get("result_data"), {}),
        "error": task.get("error_message"),
        "created_at": _iso(task.get("created_at")),
        "completed_at": _iso(task.get("completed_at")),
        "data": _jsonish(task.get("task_data"), {}),
    }


def format_queue_task_summary(task: Any) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "task_type": task.task_type,
        "status": task.status.value,
        "progress": task.progress,
        "result": task.result,
        "error": task.error,
        "created_at": task.created_at,
        "completed_at": task.completed_at,
        "data": task.data,
    }


async def get_task_status_response(
    *,
    task_id: str,
    task_queue: Any,
    task_dao: Any,
    get_db_manager: Callable[[], Any],
    logger: Any,
) -> Optional[dict[str, Any]]:
    task = await task_queue.get_task(task_id)
    if task:
        return format_queue_task_status(task)

    if not database_available(get_db_manager):
        return None
    try:
        db_task = await task_dao.get_task_by_task_id(task_id)
        return format_db_task_status(db_task) if db_task else None
    except Exception as exc:
        logger.warning("DB降级查询任务失败: %s", exc)
        return None


async def get_db_task_for_delete(
    *,
    task_id: str,
    task_dao: Any,
    get_db_manager: Callable[[], Any],
    logger: Any,
) -> Optional[dict[str, Any]]:
    if not database_available(get_db_manager):
        return None
    try:
        db_task = await task_dao.get_task(task_id)
        if db_task:
            logger.info("✅ 从数据库获取任务信息: %s", task_id)
        return db_task
    except Exception as exc:
        logger.warning("从数据库获取任务失败: %s", exc)
        return None


async def soft_delete_user_file_by_path_fragment(
    *,
    username: str,
    file_path: str,
    file_dao: Any,
    get_db_manager: Callable[[], Any],
    logger: Any,
) -> int:
    if not database_available(get_db_manager):
        return 0
    try:
        return int(await file_dao.soft_delete_user_files_by_path_fragment(username, file_path) or 0)
    except Exception as exc:
        logger.warning("数据库删除文件记录失败: %s", exc)
        return 0


async def delete_db_task(
    *,
    task_id: str,
    username: str,
    task_dao: Any,
    get_db_manager: Callable[[], Any],
    logger: Any,
) -> Optional[bool]:
    if not database_available(get_db_manager):
        logger.warning("⚠️ 数据库未连接，跳过数据库删除")
        return None
    try:
        logger.info("📞 调用 TaskDAO.delete_task(%s, %s)", task_id, username)
        deleted = bool(await task_dao.delete_task(task_id, username))
        logger.info("📋 TaskDAO.delete_task 返回结果: %s", deleted)
        return deleted
    except Exception as exc:
        logger.error("❌ 从数据库删除任务失败: %s", exc, exc_info=True)
        return False


async def list_user_tasks_response(
    *,
    username: str,
    limit: int,
    status: Optional[str],
    task_queue: Any,
    task_dao: Any,
    get_db_manager: Callable[[], Any],
    logger: Any,
) -> dict[str, Any]:
    if database_available(get_db_manager):
        try:
            db_tasks = await task_dao.get_user_tasks(username, limit=limit)
            task_list = [format_db_task_summary(task) for task in db_tasks]
            logger.info("✅ 从数据库加载了 %s 个任务", len(task_list))
            if task_list:
                logger.info(
                    "📋 示例任务数据: task_id=%s, type=%s, result=%s, data=%s",
                    task_list[0]["task_id"],
                    task_list[0]["task_type"],
                    type(task_list[0]["result"]),
                    type(task_list[0]["data"]),
                )
            return {"success": True, "tasks": task_list}
        except Exception as exc:
            logger.warning("⚠️ 数据库加载失败，降级到Redis: %s", exc)

    tasks = await task_queue.get_user_tasks(username, limit=limit, status=status)
    task_list = [format_queue_task_summary(task) for task in tasks]
    logger.info("✅ 从Redis加载了 %s 个任务", len(task_list))
    return {"success": True, "tasks": task_list}
