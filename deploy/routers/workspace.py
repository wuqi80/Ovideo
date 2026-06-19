"""Workspace compatibility/session routes."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from schemas.task import WorkspaceSessionRequest
from schemas.video import SaveVideoTaskRequest


def create_workspace_router(
    *,
    require_auth_dependency: Any,
    jwt_auth_module: Any,
    project_dao: Any,
    workspace_session_dao: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/workspace/save-task")
    async def save_video_task(request: SaveVideoTaskRequest, username: str = Depends(require_auth_dependency)):
        """保存视频任务到数据库（已废弃，使用session保存）"""
        try:
            logger.info("⚠️ save-task已废弃，请使用save-session接口")
            return {
                "success": True,
                "message": "任务保存已迁移到session系统",
            }
        except Exception as exc:
            logger.error("保存视频任务失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.get("/api/workspace/tasks")
    async def get_workspace_tasks(username: str = Depends(require_auth_dependency)):
        """获取用户的所有工作台任务（已废弃，数据迁移到projects.settings）"""
        try:
            logger.info("✅ workspace任务已迁移到项目系统（返回空列表）")
            return {"tasks": []}
        except Exception as exc:
            logger.error("获取工作台任务失败: %s", exc)
            return {"tasks": []}

    @router.post("/api/workspace/save-session")
    async def save_workspace_session(
        request: WorkspaceSessionRequest,
        username: str = Depends(require_auth_dependency),
    ):
        """保存workspace会话数据到数据库（任务组、上传的图片、提示词）"""
        try:
            session_data = {
                "task_groups": request.task_groups,
                "uploaded_images": request.uploaded_images,
                "image_prompts": request.image_prompts,
                "tasks_status": request.tasks_status or {},
                "updated_at": datetime.now().isoformat(),
            }
            scope = request.scope or ""

            await workspace_session_dao.save_session(username, session_data, scope=scope)

            logger.info(
                "✅ 保存workspace会话到数据库: %s, scope=%s, %s 个任务组",
                username,
                scope,
                len(request.task_groups),
            )

            return {
                "success": True,
                "message": "会话已保存",
            }
        except Exception as exc:
            logger.error("保存workspace会话失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/api/workspace/save-beacon")
    async def save_workspace_beacon(request: Request, token: str = Query(...)):
        """sendBeacon 保存端点（页面关闭时使用，比 fetch 更可靠）"""
        try:
            username = jwt_auth_module.verify_token(token)
            if not username:
                return {"success": False, "message": "token无效"}
            body = await request.json()

            if body.get("project_id"):
                project_data = {
                    "original_content": body.get("original_content"),
                    "script_content": body.get("script_content"),
                    "storyboard": body.get("storyboard"),
                    "material_library": body.get("material_library"),
                }
                await project_dao.save_or_update_project(
                    user_id=username,
                    project_id=body["project_id"],
                    project_name=body.get("name", "未命名"),
                    project_data=project_data,
                )
                logger.info("📡 Beacon保存项目成功: %s/%s", username, body.get("project_id"))

            return {"success": True}
        except Exception as exc:
            logger.warning("Beacon保存失败: %s", exc)
            return {"success": False}

    @router.get("/api/workspace/load-session")
    async def load_workspace_session(username: str = Depends(require_auth_dependency), scope: str = ""):
        """从数据库加载workspace会话数据"""
        try:
            session_data = await workspace_session_dao.load_session(username, scope=scope)

            if not session_data:
                logger.info("📭 用户 %s 没有workspace会话数据", username)
                return {
                    "success": False,
                    "session": None,
                }

            session = {
                "task_groups": session_data.get("task_groups", []),
                "uploaded_images": session_data.get("uploaded_images", []),
                "image_prompts": session_data.get("image_prompts", {}),
                "tasks_status": session_data.get("tasks_status", {}),
            }

            logger.info("✅ 从数据库加载workspace会话: %s, %s 个任务组", username, len(session["task_groups"]))

            return {
                "success": True,
                "session": session,
            }
        except Exception as exc:
            logger.error("加载workspace会话失败: %s", exc, exc_info=True)
            return {
                "success": False,
                "session": None,
            }

    return router
