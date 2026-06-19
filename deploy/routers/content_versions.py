# -*- coding: utf-8 -*-
"""Version and text-content route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


class VersionCreate(BaseModel):
    project_id: str
    version_name: Optional[str] = ""
    description: Optional[str] = ""


class TextContentCreate(BaseModel):
    version_id: str
    content_type: str
    title: Optional[str] = ""
    content: str


def create_content_versions_router(
    *,
    get_current_user_dependency: Any,
    project_dao: Any,
    version_dao: Any,
    file_dao: Any,
    text_content_dao: Any,
    activity_log_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    ProjectDAO = project_dao
    VersionDAO = version_dao
    FileDAO = file_dao
    TextContentDAO = text_content_dao
    ActivityLogDAO = activity_log_dao

    @router.post("/api/versions")
    async def create_version(
        version_data: VersionCreate,
        user_id: str = Depends(get_current_user)
    ):
        """鍒涘缓鏂扮増鏈?"""
        try:
            project = await ProjectDAO.get_project(version_data.project_id)
            if not project or project['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="鏃犳潈鎿嶄綔")

            current_version = await VersionDAO.get_current_version(version_data.project_id)
            parent_version_id = current_version['version_id'] if current_version else None

            version = await VersionDAO.create_version(
                project_id=version_data.project_id,
                user_id=user_id,
                version_name=version_data.version_name,
                description=version_data.description,
                parent_version_id=parent_version_id
            )

            await ActivityLogDAO.log_activity(
                user_id=user_id,
                action='create_version',
                resource_type='version',
                resource_id=version['version_id']
            )

            return {
                "success": True,
                "version": version
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/versions/{version_id}")
    async def get_version_detail(
        version_id: str,
        user_id: str = Depends(get_current_user)
    ):
        """鑾峰彇鐗堟湰璇︽儏"""
        try:
            version = await VersionDAO.get_version(version_id)
            if not version:
                raise HTTPException(status_code=404, detail="鐗堟湰涓嶅瓨鍦?")

            if version['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="鏃犳潈璁块棶")

            files = await FileDAO.get_version_files(version_id)
            texts = await TextContentDAO.get_version_texts(version_id)

            return {
                "success": True,
                "version": version,
                "files": files,
                "texts": texts
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/versions/{version_id}/restore")
    async def restore_version(
        version_id: str,
        user_id: str = Depends(get_current_user)
    ):
        """鎭㈠鍒版寚瀹氱増鏈?"""
        try:
            version = await VersionDAO.get_version(version_id)
            if not version or version['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="鏃犳潈鎿嶄綔")

            await VersionDAO.set_current_version(version_id)

            await ActivityLogDAO.log_activity(
                user_id=user_id,
                action='restore_version',
                resource_type='version',
                resource_id=version_id
            )

            return {
                "success": True,
                "message": "鐗堟湰宸叉仮澶?"
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/versions/{version_id}")
    async def delete_version(
        version_id: str,
        user_id: str = Depends(get_current_user)
    ):
        """鍒犻櫎鐗堟湰"""
        try:
            version = await VersionDAO.get_version(version_id)
            if not version or version['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="鏃犳潈鎿嶄綔")

            if version['is_current']:
                raise HTTPException(status_code=400, detail="鏃犳硶鍒犻櫎褰撳墠鐗堟湰")

            await VersionDAO.delete_version(version_id)

            await ActivityLogDAO.log_activity(
                user_id=user_id,
                action='delete_version',
                resource_type='version',
                resource_id=version_id
            )

            return {
                "success": True,
                "message": "鐗堟湰宸插垹闄?"
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/texts")
    async def create_text(
        text_data: TextContentCreate,
        user_id: str = Depends(get_current_user)
    ):
        """鍒涘缓鏂囨湰鍐呭"""
        try:
            version = await VersionDAO.get_version(text_data.version_id)
            if not version or version['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="鏃犳潈鎿嶄綔")

            text = await TextContentDAO.create_text_content(
                version_id=text_data.version_id,
                user_id=user_id,
                content_type=text_data.content_type,
                content=text_data.content,
                title=text_data.title
            )

            await ActivityLogDAO.log_activity(
                user_id=user_id,
                action='create_text',
                resource_type='text',
                resource_id=text['content_id']
            )

            return {
                "success": True,
                "text": text
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/texts/{content_id}")
    async def get_text(
        content_id: str,
        user_id: str = Depends(get_current_user)
    ):
        """鑾峰彇鏂囨湰鍐呭"""
        try:
            text = await TextContentDAO.get_text_content(content_id)
            if not text:
                raise HTTPException(status_code=404, detail="鏂囨湰涓嶅瓨鍦?")

            if text['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="鏃犳潈璁块棶")

            return {
                "success": True,
                "text": text
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router
