# -*- coding: utf-8 -*-
"""Unified entity file routes for storyboard items, assets, and video segments."""

import logging
from typing import Any, Callable, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from services.entity_file_service import (
    EntityFileBatchTooLarge,
    EntityFileMigrationFailed,
    EntityFileNotFound,
    hard_delete_entity_file as hard_delete_entity_file_service,
    hard_delete_entity_files_batch as hard_delete_entity_files_batch_service,
    link_entity_file as link_entity_file_service,
    list_entity_files,
    list_user_files,
    run_entity_file_migration as run_entity_file_migration_service,
    select_entity_file as select_entity_file_service,
    soft_delete_entity_file,
    upload_entity_file as upload_entity_file_service,
)


def create_entity_files_router(
    *,
    get_current_user_dependency: Any,
    file_dao: Any,
    entity_file_dao: Any,
    save_generated_file_to_db_provider: Callable[[], Callable[..., Any]],
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    FileDAO = file_dao
    EntityFileDAO = entity_file_dao

    async def save_generated_file_to_db(*args, **kwargs):
        return await save_generated_file_to_db_provider()(*args, **kwargs)

    class EntityFileLinkRequest(BaseModel):
        file_id: str
        entity_type: str
        entity_id: str
        file_role: str
        is_selected: bool = False

    class EntityFileSelectRequest(BaseModel):
        entity_type: str
        entity_id: str
        file_role: str

    class HardDeleteBatchRequest(BaseModel):
        file_ids: List[str]

    @router.get("/api/user-files")
    async def get_user_files(
        file_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        return await list_user_files(
            user_id=user_id,
            file_type=file_type,
            limit=limit,
            offset=offset,
            file_dao=FileDAO,
            entity_file_dao=EntityFileDAO,
        )

    @router.get("/api/entity-files")
    async def get_entity_files(
        entity_type: str,
        entity_id: str,
        file_role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        return await list_entity_files(
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            limit=limit,
            offset=offset,
            entity_file_dao=EntityFileDAO,
        )

    @router.post("/api/entity-files/link")
    async def link_entity_file(
        req: EntityFileLinkRequest,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await link_entity_file_service(
                file_id=req.file_id,
                entity_type=req.entity_type,
                entity_id=req.entity_id,
                file_role=req.file_role,
                is_selected=req.is_selected,
                entity_file_dao=EntityFileDAO,
            )
        except EntityFileNotFound as exc:
            raise HTTPException(404, "文件不存在或已删除") from exc

    @router.put("/api/entity-files/{file_id}/select")
    async def select_entity_file(
        file_id: str,
        req: EntityFileSelectRequest,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await select_entity_file_service(
                file_id=file_id,
                entity_type=req.entity_type,
                entity_id=req.entity_id,
                file_role=req.file_role,
                entity_file_dao=EntityFileDAO,
                logger=logger,
            )
        except EntityFileNotFound as exc:
            raise HTTPException(404, "文件不存在或不属于指定实体") from exc

    @router.post("/api/entity-files/upload")
    async def upload_entity_file(
        file: UploadFile = File(...),
        entity_type: str = Form(None),
        entity_id: str = Form(None),
        file_role: str = Form(None),
        episode_id: str = Form(None),
        user_id: str = Depends(get_current_user),
    ):
        content = await file.read()
        return await upload_entity_file_service(
            content=content,
            filename=file.filename,
            content_type=file.content_type,
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            episode_id=episode_id,
            user_id=user_id,
            save_generated_file_to_db=save_generated_file_to_db,
            logger=logger,
        )

    @router.delete("/api/entity-files/{file_id}")
    async def delete_entity_file(
        file_id: str,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await soft_delete_entity_file(file_id=file_id, entity_file_dao=EntityFileDAO)
        except EntityFileNotFound as exc:
            raise HTTPException(404, "文件不存在或已删除") from exc

    @router.delete("/api/entity-files/{file_id}/hard")
    async def hard_delete_entity_file(
        file_id: str,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await hard_delete_entity_file_service(file_id=file_id, entity_file_dao=EntityFileDAO)
        except EntityFileNotFound as exc:
            raise HTTPException(404, "文件不存在") from exc

    @router.post("/api/entity-files/hard-delete-batch")
    async def hard_delete_entity_files_batch(
        request: HardDeleteBatchRequest,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await hard_delete_entity_files_batch_service(
                file_ids=request.file_ids,
                entity_file_dao=EntityFileDAO,
            )
        except EntityFileBatchTooLarge as exc:
            raise HTTPException(400, "单次最多删除 200 个文件") from exc

    @router.post("/api/entity-files/migrate")
    async def run_entity_file_migration(user_id: str = Depends(get_current_user)):
        try:
            return await run_entity_file_migration_service()
        except EntityFileMigrationFailed as exc:
            raise HTTPException(500, f"迁移失败: {str(exc)}") from exc
        except Exception as exc:
            raise HTTPException(500, f"迁移失败: {str(exc)}")

    return router
