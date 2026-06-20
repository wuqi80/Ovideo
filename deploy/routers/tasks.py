"""Task creation, status, deletion, and event-stream routes."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from schemas.generation import GenerateRequest


def create_task_router(
    *,
    require_auth_dependency: Any,
    jwt_auth_module: Any,
    task_service_module: Any,
    task_dao: Any,
    file_dao: Any,
    get_db_manager: Any,
    get_pubsub_redis_client: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()
    FileDAO = file_dao

    @router.post("/api/generate")
    async def create_generate_task(request: GenerateRequest, username: str = Depends(require_auth_dependency)):
        """创建生成任务"""
        try:
            task_data = request.model_dump()
            if request.entity_type:
                task_data["entity_type"] = request.entity_type
            if request.entity_id:
                task_data["entity_id"] = request.entity_id
            if request.file_role:
                task_data["file_role"] = request.file_role
            if request.episode_id:
                task_data["episode_id"] = request.episode_id
            task_id = await task_service_module.get().submit(
                request.task_type,
                task_data,
                username,
                priority=request.priority,
                prepare=False,
            )
            logger.info("用户 %s 创建任务 %s", username, task_id)

            queue_length = await task_service_module.get_queue().get_queue_length()

            return {
                "success": True,
                "task_id": task_id,
                "message": "任务已加入队列",
                "queue_position": queue_length,
                "estimated_wait_time": queue_length * 60,
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("创建任务失败: %s", exc)
            raise HTTPException(status_code=500, detail=f"创建任务失败: {str(exc)}")

    @router.get("/api/task/{task_id}")
    async def get_task_status(task_id: str, username: str = Depends(require_auth_dependency)):
        """获取任务状态（Redis优先，DB降级）"""
        task = await task_service_module.get_queue().get_task(task_id)

        if task:
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

        if get_db_manager():
            try:
                db_task = await task_dao.get_task_by_task_id(task_id)
                if db_task:
                    result_data = db_task.get("result_data")
                    if isinstance(result_data, str):
                        try:
                            result_data = json.loads(result_data)
                        except Exception:
                            pass
                    return {
                        "task_id": db_task["task_id"],
                        "status": db_task["status"],
                        "progress": 100 if db_task["status"] == "completed" else 0,
                        "node_id": db_task.get("node_id"),
                        "result": result_data,
                        "error": db_task.get("error_message"),
                        "created_at": str(db_task["created_at"]) if db_task.get("created_at") else None,
                        "started_at": str(db_task["started_at"]) if db_task.get("started_at") else None,
                        "completed_at": str(db_task["completed_at"]) if db_task.get("completed_at") else None,
                        "source": "database",
                    }
            except Exception as exc:
                logger.warning("DB降级查询任务失败: %s", exc)

        raise HTTPException(status_code=404, detail="任务不存在")

    @router.delete("/api/task/{task_id}")
    async def cancel_task(task_id: str, username: str = Depends(require_auth_dependency)):
        """取消任务"""
        success = await task_service_module.get_queue().cancel_task(task_id)

        if not success:
            raise HTTPException(status_code=400, detail="无法取消任务")

        logger.info("用户 %s 取消任务 %s", username, task_id)

        return {
            "success": True,
            "message": "任务已取消",
        }

    @router.delete("/api/task/{task_id}/delete")
    async def delete_task(task_id: str, username: str = Depends(require_auth_dependency)):
        """彻底删除任务（包括从Redis、数据库和硬盘中删除）"""
        try:
            task = await task_service_module.get_queue().get_task(task_id)

            db = get_db_manager()
            task_data = None
            if not task and db:
                try:
                    db_task = await task_dao.get_task(task_id)
                    if db_task:
                        logger.info("✅ 从数据库获取任务信息: %s", task_id)
                        task_data = db_task
                except Exception as exc:
                    logger.warning("从数据库获取任务失败: %s", exc)

            deleted_files = []

            result_data = None
            if task and task.result and isinstance(task.result, dict):
                result_data = task.result
            elif task_data and task_data.get("result_data"):
                result_str = task_data.get("result_data")
                if isinstance(result_str, str):
                    try:
                        result_data = json.loads(result_str)
                    except Exception:
                        pass
                elif isinstance(result_str, dict):
                    result_data = result_str

            if result_data and isinstance(result_data, dict):
                videos = result_data.get("videos", [])

                for video_info in videos:
                    if isinstance(video_info, dict):
                        video_url = video_info.get("url", "")

                        if video_url.startswith("/uploads/"):
                            file_path = video_url.replace("/uploads/", "").split("?")[0]

                            logger.info("🗑️ 尝试删除文件: %s", file_path)

                            possible_paths = [
                                os.path.join("temp", "uploads", file_path),
                                os.path.join("persistent_storage", file_path),
                                os.path.join("persistent_storage", "videos", file_path.replace("video/", "")),
                                os.path.join("uploads", file_path),
                            ]

                            for physical_path in possible_paths:
                                if os.path.exists(physical_path):
                                    try:
                                        os.remove(physical_path)
                                        logger.info("✅ 已删除物理文件: %s", physical_path)
                                        deleted_files.append(physical_path)
                                        break
                                    except Exception as file_err:
                                        logger.error("❌ 删除物理文件失败: %s, 错误: %s", physical_path, file_err)
                                else:
                                    logger.debug("物理文件不存在: %s", physical_path)

                            if db:
                                try:
                                    deleted_count = await FileDAO.soft_delete_user_files_by_path_fragment(
                                        username,
                                        file_path,
                                    )
                                    if deleted_count:
                                        logger.info("✅ 已从数据库标记删除: %s", file_path)
                                except Exception as db_err:
                                    logger.warning("数据库删除文件记录失败: %s", db_err)

                if deleted_files:
                    logger.info("✅ 共删除 %s 个文件: %s", len(deleted_files), deleted_files)

            logger.info("🗑️ 尝试从数据库删除任务: %s, db_manager存在: %s", task_id, db is not None)
            if db:
                try:
                    logger.info("📞 调用 TaskDAO.delete_task(%s, %s)", task_id, username)
                    db_deleted = await task_dao.delete_task(task_id, username)
                    logger.info("📋 TaskDAO.delete_task 返回结果: %s", db_deleted)
                    if db_deleted:
                        logger.info("✅ 已从数据库删除任务: %s", task_id)
                    else:
                        logger.warning("⚠️ 数据库中未找到任务或无权删除: %s", task_id)
                except Exception as db_err:
                    logger.error("❌ 从数据库删除任务失败: %s", db_err, exc_info=True)
            else:
                logger.warning("⚠️ 数据库未连接，跳过数据库删除")

            task_owner = None
            if task:
                task_owner = task.user_id
            elif task_data:
                task_owner = task_data.get("user_id")

            if task_owner and task_owner != username:
                raise HTTPException(status_code=403, detail="无权删除此任务")

            if not task and not task_data:
                logger.info("任务 %s 不存在，已尝试从数据库删除", task_id)
                return {
                    "success": True,
                    "message": "任务不存在或已删除",
                    "deleted_files_count": len(deleted_files),
                }

            if task:
                success = await task_service_module.get_queue().delete_task(task_id)
                if not success:
                    logger.warning("从Redis删除任务失败，但继续返回成功: %s", task_id)
            else:
                logger.info("任务在Redis中不存在，跳过Redis删除")

            logger.info("✅ 用户 %s 删除任务 %s 完成，共删除 %s 个文件", username, task_id, len(deleted_files))

            return {
                "success": True,
                "message": "任务已删除",
                "deleted_files_count": len(deleted_files),
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("删除任务失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.get("/api/tasks/stream")
    async def task_event_stream(request: Request, token: str = Query(...)):
        """SSE 端点：订阅 Redis Pub/Sub 实时推送任务进度和完成/失败通知"""
        username = jwt_auth_module.verify_token(token)
        if not username:
            raise HTTPException(status_code=401, detail="未认证")

        async def event_generator():
            pubsub = None
            try:
                pubsub_redis_client = get_pubsub_redis_client()
                pubsub = pubsub_redis_client.pubsub()
                await pubsub.psubscribe("task_progress:*")
                await pubsub.subscribe(f"task_complete:{username}", f"task_failed:{username}")

                yield "event: ready\ndata: {}\n\n"

                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    except (redis.ConnectionError, asyncio.CancelledError):
                        break
                    except Exception as exc:
                        logger.warning("SSE pubsub get_message 异常: %s", exc)
                        break

                    if message and message["type"] in ("message", "pmessage"):
                        raw = message["data"]
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8")
                        try:
                            parsed = json.loads(raw)
                            tid = parsed.get("task_id")
                            if tid:
                                channel = message.get("channel", b"")
                                if isinstance(channel, bytes):
                                    channel = channel.decode("utf-8")
                                if channel.startswith(f"task_complete:{username}") or channel.startswith(
                                    f"task_failed:{username}"
                                ):
                                    yield f"data: {raw}\n\n"
                                else:
                                    t = await task_service_module.get_queue().get_task(tid)
                                    if t and t.user_id == username:
                                        yield f"data: {raw}\n\n"
                        except Exception:
                            pass
                    await asyncio.sleep(0.1)
            except redis.ConnectionError as exc:
                logger.warning("SSE pubsub 连接异常（用户 %s）：%s", username, exc)
                try:
                    yield f"event: error\ndata: {json.dumps({'reason': 'pubsub_unavailable'})}\n\n"
                except Exception:
                    pass
            except Exception as exc:
                logger.error("SSE event_generator 未预期异常（用户 %s）：%s", username, exc, exc_info=True)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.punsubscribe()
                    except Exception:
                        pass
                    try:
                        await pubsub.unsubscribe()
                    except Exception:
                        pass
                    try:
                        await pubsub.close()
                    except Exception:
                        pass

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
        )

    @router.get("/api/tasks")
    async def list_tasks(
        username: str = Depends(require_auth_dependency),
        limit: int = 100,
        status: Optional[str] = None,
    ):
        """获取用户任务列表（优先从数据库，降级到Redis）"""
        try:
            if get_db_manager():
                try:
                    db_tasks = await task_dao.get_user_tasks(username, limit=limit)

                    task_list = []
                    for task in db_tasks:
                        task_data = task.get("task_data", {})
                        if isinstance(task_data, str):
                            try:
                                task_data = json.loads(task_data)
                            except Exception:
                                task_data = {}

                        result_data = task.get("result_data", {})
                        if isinstance(result_data, str):
                            try:
                                result_data = json.loads(result_data)
                            except Exception:
                                result_data = {}

                        task_list.append(
                            {
                                "task_id": task.get("task_id"),
                                "task_type": task.get("task_type"),
                                "status": task.get("status", "unknown"),
                                "progress": task.get("progress", 0),
                                "result": result_data,
                                "error": task.get("error_message"),
                                "created_at": task.get("created_at").isoformat() if task.get("created_at") else None,
                                "completed_at": task.get("completed_at").isoformat()
                                if task.get("completed_at")
                                else None,
                                "data": task_data,
                            }
                        )

                    logger.info("✅ 从数据库加载了 %s 个任务", len(task_list))

                    if task_list:
                        logger.info(
                            "📋 示例任务数据: task_id=%s, type=%s, result=%s, data=%s",
                            task_list[0]["task_id"],
                            task_list[0]["task_type"],
                            type(task_list[0]["result"]),
                            type(task_list[0]["data"]),
                        )

                    return {
                        "success": True,
                        "tasks": task_list,
                    }
                except Exception as db_error:
                    logger.warning("⚠️ 数据库加载失败，降级到Redis: %s", db_error)

            tasks = await task_service_module.get_queue().get_user_tasks(username, limit=limit, status=status)

            task_list = []
            for task in tasks:
                task_list.append(
                    {
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
                )

            logger.info("✅ 从Redis加载了 %s 个任务", len(task_list))
            return {
                "success": True,
                "tasks": task_list,
            }
        except Exception as exc:
            logger.error("获取任务列表失败: %s", exc)
            return {
                "success": False,
                "tasks": [],
            }

    return router
