# -*- coding: utf-8 -*-
"""Legacy file upload/download routes.

These routes back older project/version file flows. Newer entity-bound uploads
live in routers/entity_files.py, but this API surface is still public and must
keep its existing path contract.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse


def create_legacy_files_router(
    *,
    get_current_user_dependency: Any,
    user_dao: Any,
    version_dao: Any,
    file_dao: Any,
    activity_log_dao: Any,
    file_optimization_service: Any,
    file_deduplication_service: Any,
    jwt_auth_module: Any,
    logger: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    UserDAO = user_dao
    VersionDAO = version_dao
    FileDAO = file_dao
    ActivityLogDAO = activity_log_dao
    FileOptimizationService = file_optimization_service
    FileDeduplicationService = file_deduplication_service
    jwt_auth = jwt_auth_module

    def deploy_root() -> Path:
        return Path(__file__).resolve().parents[1]

    @router.post("/api/files/upload")
    async def upload_file(
        version_id: str = Form(...),
        file: UploadFile = File(...),
        user_id: str = Depends(get_current_user)
    ):
        """Upload a version-scoped legacy file."""
        try:
            version = await VersionDAO.get_version(version_id)
            if not version or version['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="无权操作")

            user = await UserDAO.get_user_by_id(user_id)
            if user['used_storage_bytes'] >= user['storage_quota_gb'] * 1024 * 1024 * 1024:
                raise HTTPException(status_code=507, detail="存储空间不足")

            file_id = f"file_{uuid.uuid4().hex[:12]}"
            file_ext = Path(file.filename or "").suffix
            file_type = 'image' if file_ext.lower() in ['.jpg', '.jpeg', '.png', '.gif', '.webp'] else \
                       'video' if file_ext.lower() in ['.mp4', '.avi', '.mov', '.mkv'] else 'other'

            storage_month = datetime.now().strftime("%Y%m")
            storage_base = Path("persistent_storage") / f"{file_type}s" / user_id / storage_month
            storage_base.mkdir(parents=True, exist_ok=True)

            file_path = storage_base / f"{file_id}{file_ext}"

            content = await file.read()
            async with aiofiles.open(file_path, 'wb') as f:
                await f.write(content)

            file_size = len(content)
            file_url = f"/storage/{file_type}s/{user_id}/{storage_month}/{file_id}{file_ext}"

            file_hash = await FileOptimizationService.calculate_file_hash(str(file_path))

            duplicate = await FileDeduplicationService.check_duplicate(file_hash, user_id)
            if duplicate:
                file_record = await FileDeduplicationService.link_duplicate_file(
                    duplicate, version_id, user_id
                )
            else:
                file_record = await FileDAO.create_file(
                    version_id=version_id,
                    user_id=user_id,
                    file_type=file_type,
                    file_name=file.filename,
                    file_path=str(file_path),
                    file_url=file_url,
                    file_size_bytes=file_size,
                    mime_type=file.content_type,
                    metadata={'file_hash': file_hash}
                )

                if file_type == 'image':
                    thumbnail_path = storage_base / f"{file_id}_thumb.jpg"
                    await FileOptimizationService.create_thumbnail(
                        str(file_path), str(thumbnail_path)
                    )

            await ActivityLogDAO.log_activity(
                user_id=user_id,
                action='upload_file',
                resource_type='file',
                resource_id=file_record['file_id']
            )

            return {
                "success": True,
                "file": file_record
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/files/{file_id}/download")
    async def download_file(file_id: str, request: Request, token: Optional[str] = None):
        """Download a legacy file with range support for audio/video."""
        try:
            logger.info(f"📥 文件下载请求: file_id={file_id}, has_token={token is not None}")

            file_record = await FileDAO.get_file(file_id)
            if not file_record:
                logger.error(f"❌ 文件记录不存在: file_id={file_id}")
                raise HTTPException(status_code=404, detail="文件不存在")

            if token:
                username = jwt_auth.verify_token(token)
                if username:
                    file_owner = file_record.get('user_id')
                    if username and file_owner and username != file_owner:
                        logger.warning(f"⚠️ 用户 {username} 尝试访问 {file_owner} 的文件 {file_id}")

            logger.info(f"📄 找到文件: user={file_record['user_id']}, path={file_record['file_path']}")

            file_path = file_record['file_path']
            base_dir = str(deploy_root())

            possible_paths: list[str] = []
            if os.path.isabs(file_path):
                possible_paths.append(file_path)
            else:
                possible_paths.append(os.path.join(base_dir, file_path))

                if 'persistent_storage' in file_path:
                    temp_path = file_path.replace('persistent_storage/', 'temp/uploads/')
                    possible_paths.append(os.path.join(base_dir, temp_path))

                    temp_path2 = file_path.replace('persistent_storage/videos/', 'temp/uploads/video/')
                    possible_paths.append(os.path.join(base_dir, temp_path2))

                    temp_path3 = file_path.replace('persistent_storage/images/', 'temp/uploads/images/')
                    possible_paths.append(os.path.join(base_dir, temp_path3))

            actual_file_path = None
            for path in possible_paths:
                if os.path.exists(path):
                    actual_file_path = path
                    logger.info(f"✅ 找到文件: {path}")
                    break
                logger.debug(f"❌ 路径不存在: {path}")

            if not actual_file_path:
                logger.error("文件不存在于磁盘，尝试的路径:")
                for path in possible_paths:
                    logger.error(f"  - {path}")
                logger.error(f"当前工作目录: {os.getcwd()}")
                logger.error(f"legacy_files.py deploy root: {base_dir}")
                raise HTTPException(status_code=404, detail="文件不存在")

            logger.info(f"✅ 开始传输文件: {actual_file_path}")

            filename = file_record.get('file_name', 'download')
            encoded_filename = quote(filename)
            mime_type = file_record['mime_type'] or 'application/octet-stream'
            file_size = os.path.getsize(actual_file_path)

            range_header = request.headers.get('range')

            if range_header and ('video' in mime_type or 'audio' in mime_type):
                range_spec = range_header.replace('bytes=', '')
                parts = range_spec.split('-')
                start = int(parts[0]) if parts[0] else 0
                end = int(parts[1]) if parts[1] else file_size - 1
                end = min(end, file_size - 1)
                content_length = end - start + 1

                async def ranged_reader():
                    async with aiofiles.open(actual_file_path, 'rb') as f:
                        await f.seek(start)
                        remaining = content_length
                        while remaining > 0:
                            chunk_size = min(65536, remaining)
                            chunk = await f.read(chunk_size)
                            if not chunk:
                                break
                            remaining -= len(chunk)
                            yield chunk

                return StreamingResponse(
                    ranged_reader(),
                    status_code=206,
                    media_type=mime_type,
                    headers={
                        'Content-Range': f'bytes {start}-{end}/{file_size}',
                        'Accept-Ranges': 'bytes',
                        'Content-Length': str(content_length),
                        'Content-Disposition': f"inline; filename*=UTF-8''{encoded_filename}",
                    }
                )

            return StreamingResponse(
                FileOptimizationService.file_chunked_reader(actual_file_path),
                media_type=mime_type,
                headers={
                    'Content-Disposition': f"inline; filename*=UTF-8''{encoded_filename}",
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(file_size),
                }
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"下载文件失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/files/{file_id}")
    async def delete_file(
        file_id: str,
        user_id: str = Depends(get_current_user)
    ):
        """Delete a legacy file record."""
        try:
            file_record = await FileDAO.get_file(file_id)
            if not file_record or file_record['user_id'] != user_id:
                raise HTTPException(status_code=403, detail="无权操作")

            await FileDAO.delete_file(file_id)

            await ActivityLogDAO.log_activity(
                user_id=user_id,
                action='delete_file',
                resource_type='file',
                resource_id=file_id
            )

            return {
                "success": True,
                "message": "文件已删除"
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router
