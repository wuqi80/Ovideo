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

from core.task_types import is_external_api_task
from schemas.generation import GenerateRequest
from services.task_read_service import (
    delete_db_task,
    get_db_task_for_delete,
    get_task_status_response,
    list_user_tasks_response,
    soft_delete_user_file_by_path_fragment,
)
from services.video_enhancement_service import (
    prepare_video_upscale_task,
    prepare_video_voice_task,
)
from services.video_interpolation_service import prepare_video_interpolation_task
from services.video_capability_service import resolve_minimax_h3_agent_target
from services.video_credit_pricing import validate_seedance_generation_options
from external_api.video.minimax import normalize_minimax_generation_options
from services.generation_access_service import (
    GenerationAccessDenied,
    require_generation_request_access,
)


def _should_prepare_workflow(task_type: str) -> bool:
    """Return whether /api/generate should attach a ComfyUI workflow."""
    normalized = str(task_type or "").strip().lower()
    return normalized != "minimax_music3" and not is_external_api_task(task_type)


def _is_minimax_music3_request(request: GenerateRequest) -> bool:
    return str(getattr(request, "task_type", "") or "").strip().lower() == "minimax_music3"


def _is_minimax_h3_request(request: GenerateRequest) -> bool:
    model = str(getattr(request, "model", "") or "").strip().lower()
    task_type = str(getattr(request, "task_type", "") or "").strip().lower()
    return task_type in {"i2v", "morph"} and model in {
        "minimaxh3",
        "minimax-h3",
        "minimax_h3",
        "minimaxh3fast",
        "minimax-h3-fast",
        "minimax_h3_fast",
        "minimaxh3mini",
        "minimax-h3-mini",
        "minimax_h3_mini",
    }


def _runtime_profile(request: GenerateRequest) -> str:
    if _is_minimax_music3_request(request):
        return "music"
    return "h3" if _is_minimax_h3_request(request) else "wan"


def _local_gpu_maintenance() -> dict[str, Any]:
    enabled = str(os.environ.get("OSTORY_LOCAL_GPU_MAINTENANCE", "1")).strip().lower() in {
        "1", "true", "yes", "on",
    }
    message = str(
        os.environ.get(
            "OSTORY_LOCAL_GPU_MAINTENANCE_MESSAGE",
            "本地 GPU 正在维护，当前不会接收新任务；外部 API 模型不受影响。",
        )
    ).strip()
    resume_at = str(os.environ.get("OSTORY_LOCAL_GPU_MAINTENANCE_RESUME_AT", "")).strip()
    return {
        "enabled": enabled,
        "message": message,
        "estimated_resume_at": resume_at or None,
    }


async def _gpu_queue_snapshot(task_queue: Any, request: GenerateRequest) -> dict[str, Any]:
    """Return anonymous queue counts only; never disclose another user's task data."""
    if is_external_api_task(request.task_type):
        return {
            "queue_mode": "external",
            "runtime_profile": None,
            "tasks_ahead": 0,
            "estimated_wait_seconds": 0,
            "requires_confirmation": False,
            "can_cancel_before_submit": True,
            "accepting_submissions": True,
        }
    maintenance = _local_gpu_maintenance()
    if maintenance["enabled"]:
        return {
            "queue_mode": "maintenance",
            "runtime_profile": _runtime_profile(request),
            "public_comfyui_port": 8188,
            "tasks_ahead": 0,
            "estimated_wait_seconds": 0,
            "estimated_wait_time": 0,
            "requires_confirmation": False,
            "can_cancel_before_submit": True,
            "accepting_submissions": False,
            "maintenance_message": maintenance["message"],
            "estimated_resume_at": maintenance["estimated_resume_at"],
        }
    queued = int(await task_queue.get_queue_length())
    processing = 0
    try:
        processing = int(await task_queue.get_processing_count())
    except (AttributeError, TypeError):
        processing = 0
    tasks_ahead = max(0, queued) + max(0, processing)
    profile = _runtime_profile(request)
    seconds_per_task = {"h3": 900, "music": 720}.get(profile, 480)
    switch_seconds = {"h3": 120, "music": 90}.get(profile, 45)
    estimated_wait = tasks_ahead * seconds_per_task + (switch_seconds if tasks_ahead else 0)
    return {
        "queue_mode": "gpu2_serial",
        "runtime_profile": profile,
        "public_comfyui_port": 8188,
        "tasks_ahead": tasks_ahead,
        "estimated_wait_seconds": estimated_wait,
        "estimated_wait_time": estimated_wait,
        "requires_confirmation": tasks_ahead > 0,
        "can_cancel_before_submit": True,
        "accepting_submissions": True,
    }


def create_task_router(
    *,
    require_auth_dependency: Any,
    jwt_auth_module: Any,
    task_service_module: Any,
    task_dao: Any,
    file_dao: Any,
    get_pubsub_redis_client: Any,
    logger: logging.Logger,
    generation_access_checker: Any = require_generation_request_access,
) -> APIRouter:
    router = APIRouter()
    FileDAO = file_dao

    @router.post("/api/generate/preflight")
    async def generate_queue_preflight(
        request: GenerateRequest,
        username: str = Depends(require_auth_dependency),
    ):
        del username
        return {
            "success": True,
            **await _gpu_queue_snapshot(task_service_module.get_queue(), request),
        }

    @router.post("/api/generate")
    async def create_generate_task(request: GenerateRequest, username: str = Depends(require_auth_dependency)):
        """创建生成任务"""
        try:
            maintenance = _local_gpu_maintenance()
            if not is_external_api_task(request.task_type) and maintenance["enabled"]:
                raise HTTPException(
                    status_code=503,
                    detail={
                        "code": "local_gpu_maintenance",
                        "message": maintenance["message"],
                        "estimated_resume_at": maintenance["estimated_resume_at"],
                    },
                )
            if str(request.file_role or "").startswith("studio_"):
                references = [
                    str(value)
                    for value in (
                        request.image_path,
                        request.image_path_end,
                        request.video_filename,
                        request.audio_filename,
                    )
                    if value
                ]
                references.extend(
                    str(item.get("url"))
                    for item in (request.media_inputs or [])
                    if isinstance(item, dict) and item.get("url")
                )
                try:
                    await generation_access_checker(
                        request,
                        username,
                        references,
                        file_dao=FileDAO,
                    )
                except GenerationAccessDenied as exc:
                    raise HTTPException(status_code=404, detail="Studio scope or source not found") from exc
            task_data = request.model_dump()
            if request.entity_type:
                task_data["entity_type"] = request.entity_type
            if request.entity_id:
                task_data["entity_id"] = request.entity_id
            if request.file_role:
                task_data["file_role"] = request.file_role
            if request.project_id:
                task_data["project_id"] = request.project_id
            if request.episode_id:
                task_data["episode_id"] = request.episode_id
            if _is_minimax_h3_request(request) or _is_minimax_music3_request(request):
                target = await resolve_minimax_h3_agent_target()
                if not target.get("preferred_agent_id"):
                    label = "MiniMax Music 3" if _is_minimax_music3_request(request) else "MiniMax H3"
                    raise HTTPException(status_code=503, detail=f"{label} 本地模型仅部署在集群节点2，当前节点不可用")
                task_data.update(target)
            task_service = task_service_module.get()
            prepare_workflow = _should_prepare_workflow(request.task_type)
            explicit_preparers = {
                "interpolate": prepare_video_interpolation_task,
                "upscale": prepare_video_upscale_task,
                "voice": prepare_video_voice_task,
            }
            explicit_preparer = explicit_preparers.get(request.task_type)
            if explicit_preparer:
                try:
                    await explicit_preparer(task_data, username, task_service)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc
                prepare_workflow = False
            if request.task_type in {"minimax_i2v", "minimax_morph"}:
                try:
                    normalize_minimax_generation_options(
                        task_data.get("duration"),
                        task_data.get("minimax_resolution"),
                    )
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc
            try:
                validate_seedance_generation_options(task_data)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            queue_snapshot = await _gpu_queue_snapshot(task_service_module.get_queue(), request)
            task_id = await task_service.submit(
                request.task_type,
                task_data,
                username,
                priority=request.priority,
                prepare=prepare_workflow,
            )
            logger.info("用户 %s 创建任务 %s", username, task_id)

            return {
                "success": True,
                "task_id": task_id,
                "message": "任务已加入队列",
                "queue_position": queue_snapshot["tasks_ahead"] + 1,
                **queue_snapshot,
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("创建任务失败: %s", exc)
            raise HTTPException(status_code=500, detail=f"创建任务失败: {str(exc)}")

    @router.get("/api/task/{task_id}")
    async def get_task_status(task_id: str, username: str = Depends(require_auth_dependency)):
        """获取任务状态（Redis优先，DB降级）"""
        response = await get_task_status_response(
            task_id=task_id,
            task_queue=task_service_module.get_queue(),
            task_dao=task_dao,
            logger=logger,
            username=username,
        )
        if response:
            return response

        raise HTTPException(status_code=404, detail="任务不存在")

    @router.delete("/api/task/{task_id}")
    async def cancel_task(task_id: str, username: str = Depends(require_auth_dependency)):
        """取消任务"""
        visible_task = await get_task_status_response(
            task_id=task_id,
            task_queue=task_service_module.get_queue(),
            task_dao=task_dao,
            logger=logger,
            username=username,
        )
        if not visible_task:
            raise HTTPException(status_code=404, detail="任务不存在")

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

            task_data = None
            if not task:
                task_data = await get_db_task_for_delete(
                    task_id=task_id,
                    task_dao=task_dao,
                    logger=logger,
                )

            task_owner = None
            if task:
                task_owner = task.user_id
            elif task_data:
                task_owner = task_data.get("user_id")

            if not task_owner or str(task_owner) != str(username):
                raise HTTPException(status_code=404, detail="任务不存在")

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

                            deleted_count = await soft_delete_user_file_by_path_fragment(
                                username=username,
                                file_path=file_path,
                                file_dao=FileDAO,
                                logger=logger,
                            )
                            if deleted_count:
                                logger.info("✅ 已从数据库标记删除: %s", file_path)

                if deleted_files:
                    logger.info("✅ 共删除 %s 个文件: %s", len(deleted_files), deleted_files)

            db_deleted = await delete_db_task(
                task_id=task_id,
                username=username,
                task_dao=task_dao,
                logger=logger,
            )
            if db_deleted:
                logger.info("✅ 已从数据库删除任务: %s", task_id)
            elif db_deleted is False:
                logger.warning("⚠️ 数据库中未找到任务或无权删除: %s", task_id)

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
            return await list_user_tasks_response(
                username=username,
                limit=limit,
                status=status,
                task_queue=task_service_module.get_queue(),
                task_dao=task_dao,
                logger=logger,
            )
        except Exception as exc:
            logger.error("获取任务列表失败: %s", exc)
            return {
                "success": False,
                "tasks": [],
            }

    return router
