"""ComfyUI file proxy routes."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import quote

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials

from dao_content import FileDAO, ProjectDAO, VersionDAO

logger = logging.getLogger(__name__)


def create_comfyui_files_router(
    *,
    require_auth_dependency,
    security_dependency,
    verify_token: Callable[[str], Optional[str]],
    get_cluster_manager: Callable[[], object],
    get_video_cluster_manager: Callable[[], object],
    get_image_cluster_manager: Callable[[], object],
    get_redis_client: Callable[[], object],
) -> APIRouter:
    router = APIRouter()

    def select_video_comfyui_server(comfyui_server: Optional[str] = None) -> tuple[str, Optional[str]]:
        if comfyui_server:
            return comfyui_server.rstrip("/"), None

        video_cluster_manager = get_video_cluster_manager()
        if video_cluster_manager:
            node = video_cluster_manager.get_available_node(node_type="video")
            if not node:
                raise HTTPException(status_code=503, detail="没有可用的视频处理节点")
            return node.base_url.rstrip("/"), node.id

        return "http://127.0.0.1:8188", None

    @router.get("/api/proxy/comfyui/view")
    async def proxy_comfyui_view(
        filename: str,
        subfolder: str = "",
        type: str = "output",
        node_id: Optional[str] = None,
        token: Optional[str] = None,
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_dependency),
    ):
        """代理ComfyUI的视频/图片查看接口，避免跨域问题"""
        try:
            username = None
            if credentials:
                username = verify_token(credentials.credentials)
            if not username and token:
                username = verify_token(token)
            if not username:
                raise HTTPException(status_code=401, detail="需要登录")

            cluster_manager = get_cluster_manager()
            target_server = None
            if node_id and cluster_manager:
                for node in getattr(cluster_manager, "nodes", []):
                    if node.id == node_id:
                        target_server = node.base_url
                        logger.info("[Proxy] 使用绑定节点: %s (%s)", node_id, target_server)
                        break

            if not target_server:
                if cluster_manager:
                    node = cluster_manager.get_available_node()
                    if node:
                        target_server = node.base_url
                    else:
                        target_server = "http://127.0.0.1:8188"
                else:
                    target_server = "http://127.0.0.1:8188"

            url = f"{target_server}/view"
            params = {
                "filename": filename,
                "type": type,
            }
            if subfolder:
                params["subfolder"] = subfolder

            logger.info("用户 %s 代理访问ComfyUI文件: %s params=%s", username, url, params)
            response = requests.get(url, params=params, timeout=60, stream=True)

            fallback_attempts = []
            if response.status_code == 404:
                if params["type"] == "temp":
                    fallback_attempts = ["output", "input"]
                elif params["type"] == "output":
                    fallback_attempts = ["temp", "input"]
                elif params["type"] == "input":
                    fallback_attempts = ["output", "temp"]

                for fallback_type in fallback_attempts:
                    logger.warning("文件在 %s 中未找到，尝试在 %s 中查找: %s", params["type"], fallback_type, filename)
                    params["type"] = fallback_type
                    response = requests.get(url, params=params, timeout=60, stream=True)
                    if response.status_code == 200:
                        logger.info("✅ 在 %s 中找到文件: %s", fallback_type, filename)
                        break

            if not response.ok:
                logger.error("ComfyUI返回错误: %s - %s", response.status_code, response.text)
                raise HTTPException(status_code=response.status_code, detail=f"无法获取文件: {response.text}")

            content_type = response.headers.get("content-type", "application/octet-stream")
            logger.info(
                "✅ 成功获取文件: %s, content-type: %s, size: %s",
                filename,
                content_type,
                response.headers.get("content-length", "unknown"),
            )

            encoded_filename = quote(filename)
            return StreamingResponse(
                response.iter_content(chunk_size=8192),
                media_type=content_type,
                headers={
                    "Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}",
                    "Accept-Ranges": "bytes",
                },
            )

        except HTTPException:
            raise
        except requests.exceptions.RequestException as e:
            logger.error("代理ComfyUI文件失败: %s", e)
            raise HTTPException(status_code=503, detail=f"无法连接到ComfyUI: {str(e)}")
        except Exception as e:
            logger.error("代理ComfyUI文件失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/comfyui/upload")
    async def comfyui_upload_proxy(
        image: UploadFile = File(...),
        node_type: Optional[str] = Form(None),
        comfyui_server: Optional[str] = None,
        username: str = Depends(require_auth_dependency),
    ):
        """
        上传图片：本地持久化(primary) + ComfyUI上传(optional) + SQL记录 + Redis缓存

        node_type: 指定上传到哪种类型的节点 (image/video/all)
        """
        try:
            file_content = await image.read()
            if not file_content:
                raise HTTPException(status_code=400, detail="上传的是空文件")

            orig_filename = image.filename or "upload.png"
            logical_id = uuid.uuid4().hex[:12]
            unique_filename = f"{logical_id}_{orig_filename}"

            logger.info(
                "[ComfyUpload] 用户=%s, 原文件=%s, 逻辑名=%s, 大小=%s 字节, 节点类型=%s",
                username,
                orig_filename,
                unique_filename,
                len(file_content),
                node_type,
            )

            year_month = datetime.now().strftime("%Y%m")
            local_dir = Path("persistent_storage/image") / username / year_month
            local_dir.mkdir(parents=True, exist_ok=True)
            local_path = local_dir / unique_filename
            local_path.write_bytes(file_content)
            local_file_path = str(local_path)
            local_storage_url = f"/storage/image/{username}/{year_month}/{unique_filename}"
            comfyui_filename = unique_filename
            logger.info("💾 图片本地存储(primary): %s", local_path)

            target_server = None
            node_id = None

            if comfyui_server:
                target_server = comfyui_server.rstrip("/")
            else:
                cluster_manager = get_cluster_manager()
                video_cluster_manager = get_video_cluster_manager()
                image_cluster_manager = get_image_cluster_manager()

                if cluster_manager or video_cluster_manager or image_cluster_manager:
                    if node_type == "video":
                        selected_cluster_manager = video_cluster_manager
                    elif node_type == "image":
                        selected_cluster_manager = image_cluster_manager
                    else:
                        selected_cluster_manager = cluster_manager

                    node = selected_cluster_manager.get_available_node() if selected_cluster_manager else None
                    if node:
                        target_server = node.base_url.rstrip("/")
                        node_id = node.id
                        logger.info("[ComfyUpload] 选择集群节点: %s (%s) [type=%s]", node_id, target_server, node_type)
                    else:
                        logger.warning("[ComfyUpload] 没有可用的 %s 类型 ComfyUI 节点，跳过上传", node_type or "any")
                else:
                    target_server = "http://127.0.0.1:8188"
                    logger.info("[ComfyUpload] 使用默认 ComfyUI: %s", target_server)

            if target_server:
                try:
                    upload_url = f"{target_server}/upload/image"
                    logger.info("[ComfyUpload] 转发上传到 ComfyUI: %s", upload_url)

                    files = {
                        "image": (unique_filename, file_content, image.content_type or "image/png"),
                    }
                    data = {"overwrite": "true"}

                    response = requests.post(upload_url, files=files, data=data, timeout=30)

                    if response.ok:
                        try:
                            response_json = response.json()
                        except Exception:
                            response_json = {}

                        if isinstance(response_json, dict):
                            if "name" in response_json:
                                comfyui_filename = response_json["name"]
                            elif "images" in response_json and response_json["images"]:
                                comfyui_filename = response_json["images"][0].get("filename", comfyui_filename)

                        logger.info(
                            "✅ ComfyUI 图片上传成功: comfyui_filename=%s, server=%s",
                            comfyui_filename,
                            target_server,
                        )
                    else:
                        logger.warning(
                            "[ComfyUpload] 上传到 ComfyUI 失败(非致命): %s %s",
                            response.status_code,
                            response.text,
                        )
                except Exception as e:
                    logger.warning("[ComfyUpload] ComfyUI上传异常(非致命): %s", e)
            else:
                logger.info("[ComfyUpload] 无可用ComfyUI节点，仅使用本地存储")

            projects = await ProjectDAO.get_user_projects(username)
            if not projects:
                project_id = f"proj_{uuid.uuid4().hex[:12]}"
                await ProjectDAO.save_or_update_project(
                    user_id=username,
                    project_id=project_id,
                    project_name="默认项目",
                    project_data={},
                    description="自动创建",
                )
            else:
                project_id = projects[0]["project_id"]

            versions = await VersionDAO.get_project_versions(project_id)
            if not versions:
                version = await VersionDAO.create_version(
                    project_id=project_id,
                    user_id=username,
                    version_name="默认版本",
                )
                version_id = version["version_id"]
            else:
                version_id = versions[0]["version_id"]

            file_id = f"file_{uuid.uuid4().hex[:12]}"
            storage_url = f"/api/files/{file_id}/download"

            file_record = await FileDAO.create_file(
                version_id=version_id,
                user_id=username,
                file_type="image",
                file_name=orig_filename,
                file_path=local_file_path,
                file_url=local_storage_url,
                file_size_bytes=len(file_content),
                mime_type=image.content_type or "image/*",
                metadata={
                    "source": "comfyui_upload",
                    "logical_id": logical_id,
                    "comfyui_filename": comfyui_filename,
                    "comfyui_server": target_server,
                    "comfyui_node_id": node_id,
                    "uploaded_at": datetime.utcnow().isoformat(),
                },
                file_id=file_id,
            )

            redis_client = get_redis_client()
            if redis_client:
                try:
                    await redis_client.set(f"comfyui:file:{comfyui_filename}", file_id, ex=86400)
                except Exception as e:
                    logger.warning("[ComfyUpload] Redis缓存写入失败(非致命): %s", e)

            logger.info("✅ 图片记录已写入 SQL: file_id=%s, comfyui_filename=%s", file_record["file_id"], comfyui_filename)

            return {
                "success": True,
                "filename": comfyui_filename,
                "original_filename": orig_filename,
                "size": len(file_content),
                "storage_url": storage_url,
                "file_id": file_record["file_id"],
                "file_path": local_file_path,
                "comfyui_server": target_server,
                "comfyui_node_id": node_id,
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error("❌ 图片上传失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")

    @router.post("/api/comfyui/upload/video")
    async def comfyui_upload_video(
        video: UploadFile = File(...),
        comfyui_server: Optional[str] = None,
        username: str = Depends(require_auth_dependency),
    ):
        """上传视频到 ComfyUI + 数据库"""
        try:
            file_content = await video.read()
            unique_filename = f"{uuid.uuid4().hex[:12]}_{video.filename}"

            logger.info(
                "[ComfyUploadVideo] 用户=%s, 原文件=%s, 唯一名=%s, 大小=%s 字节",
                username,
                video.filename,
                unique_filename,
                len(file_content),
            )

            target_server, node_id = select_video_comfyui_server(comfyui_server)
            if node_id:
                logger.info("[ComfyUploadVideo] 选择视频集群节点: %s (%s)", node_id, target_server)
            elif comfyui_server:
                logger.info("[ComfyUploadVideo] 使用指定 ComfyUI: %s", target_server)
            else:
                logger.info("[ComfyUploadVideo] 使用默认 ComfyUI: %s", target_server)

            upload_url = f"{target_server}/upload/image"
            logger.info("[ComfyUploadVideo] 转发上传到 ComfyUI: %s", upload_url)

            files = {
                "image": (unique_filename, file_content, video.content_type or "video/mp4"),
            }
            data = {"overwrite": "true"}

            response = requests.post(upload_url, files=files, data=data, timeout=60)

            if not response.ok:
                logger.error("[ComfyUploadVideo] 上传到 ComfyUI 失败: %s %s", response.status_code, response.text)
                raise HTTPException(status_code=502, detail=f"上传到 ComfyUI 失败: {response.status_code}")

            try:
                response_json = response.json()
            except Exception:
                response_json = {}

            comfyui_filename = unique_filename
            if isinstance(response_json, dict) and "name" in response_json:
                comfyui_filename = response_json["name"]

            logger.info("✅ ComfyUI 视频上传成功: comfyui_filename=%s, server=%s", comfyui_filename, target_server)

            file_id = f"file_{uuid.uuid4().hex[:12]}"
            year_month = datetime.now().strftime("%Y%m")
            storage_dir = Path("persistent_storage/videos") / username / year_month
            storage_dir.mkdir(parents=True, exist_ok=True)
            file_path = storage_dir / unique_filename
            file_path.write_bytes(file_content)

            projects = await ProjectDAO.get_user_projects(username)
            if not projects:
                project_id = f"proj_{uuid.uuid4().hex[:12]}"
                await ProjectDAO.save_or_update_project(
                    user_id=username,
                    project_id=project_id,
                    project_name="默认项目",
                    project_data={},
                    description="自动创建",
                )
            else:
                project_id = projects[0]["project_id"]

            versions = await VersionDAO.get_project_versions(project_id)
            if not versions:
                version = await VersionDAO.create_version(
                    project_id=project_id,
                    user_id=username,
                    version_name="默认版本",
                )
                version_id = version["version_id"]
            else:
                version_id = versions[0]["version_id"]

            file_record = await FileDAO.create_file(
                version_id=version_id,
                user_id=username,
                file_type="video",
                file_name=video.filename,
                file_path=str(file_path),
                file_url=f"/api/files/{file_id}/download",
                file_size_bytes=len(file_content),
                mime_type=video.content_type or "video/*",
                metadata={"source": "upload", "physical_filename": unique_filename},
                file_id=file_id,
            )

            logger.info("✅ 视频已保存到数据库: %s, 文件ID: %s", file_record["file_url"], file_record["file_id"])

            return {
                "success": True,
                "filename": comfyui_filename,
                "unique_filename": unique_filename,
                "storage_url": file_record["file_url"],
                "original_filename": video.filename,
                "size": len(file_content),
                "file_id": file_record["file_id"],
                "file_path": str(file_path),
                "server": target_server,
            }

        except requests.exceptions.RequestException as e:
            logger.error("❌ ComfyUI 视频上传请求失败: %s", e)
            raise HTTPException(status_code=503, detail=f"无法连接到 ComfyUI 服务器: {str(e)}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error("❌ ComfyUI 视频上传代理失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"上传代理失败: {str(e)}")

    @router.post("/api/upload/audio")
    async def upload_audio(
        audio: UploadFile = File(...),
        start_time: float = Form(0),
        duration: float = Form(5),
        comfyui_server: Optional[str] = None,
        username: str = Depends(require_auth_dependency),
    ):
        """上传音频文件到 ComfyUI"""
        try:
            file_content = await audio.read()
            unique_filename = f"{uuid.uuid4().hex[:12]}_{audio.filename}"

            logger.info(
                "[ComfyUploadAudio] 用户=%s, 原文件=%s, 唯一名=%s, 大小=%s 字节, 剪裁=%ss-%ss",
                username,
                audio.filename,
                unique_filename,
                len(file_content),
                start_time,
                start_time + duration,
            )

            target_server, node_id = select_video_comfyui_server(comfyui_server)
            if node_id:
                logger.info("[ComfyUploadAudio] 选择视频集群节点: %s (%s)", node_id, target_server)
            elif comfyui_server:
                logger.info("[ComfyUploadAudio] 使用指定 ComfyUI: %s", target_server)
            else:
                logger.info("[ComfyUploadAudio] 使用默认 ComfyUI: %s", target_server)

            upload_url = f"{target_server}/upload/image"
            logger.info("[ComfyUploadAudio] 转发上传到 ComfyUI: %s", upload_url)

            files = {
                "image": (unique_filename, file_content, audio.content_type or "audio/mpeg"),
            }
            data = {"overwrite": "true"}

            response = requests.post(upload_url, files=files, data=data, timeout=60)

            if not response.ok:
                logger.error("[ComfyUploadAudio] 上传到 ComfyUI 失败: %s %s", response.status_code, response.text)
                raise HTTPException(status_code=502, detail=f"上传到 ComfyUI 失败: {response.status_code}")

            try:
                response_json = response.json()
            except Exception:
                response_json = {}

            comfyui_filename = unique_filename
            if isinstance(response_json, dict) and "name" in response_json:
                comfyui_filename = response_json["name"]

            logger.info(
                "✅ ComfyUI 音频上传成功: comfyui_filename=%s, 原始名=%s, server=%s",
                comfyui_filename,
                audio.filename,
                target_server,
            )

            try:
                year_month = datetime.now().strftime("%Y%m")
                backup_dir = Path("persistent_storage/audio") / username / year_month
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_path = backup_dir / comfyui_filename
                backup_path.write_bytes(file_content)
                logger.info("💾 音频本地备份: %s", backup_path)
            except Exception as e:
                logger.warning("⚠️ 音频本地备份失败（不影响上传）: %s", e)

            return {
                "success": True,
                "filename": comfyui_filename,
                "original_filename": audio.filename,
                "size": len(file_content),
                "server": target_server,
                "start_time": start_time,
                "duration": duration,
            }

        except requests.exceptions.RequestException as e:
            logger.error("❌ ComfyUI 音频上传请求失败: %s", e)
            raise HTTPException(status_code=503, detail=f"无法连接到 ComfyUI 服务器: {str(e)}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error("❌ ComfyUI 音频上传代理失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"上传代理失败: {str(e)}")

    @router.post("/api/comfyui/reupload/video")
    async def reupload_video_with_uuid(
        filename: str,
        file_type: str = "output",
        comfyui_server: Optional[str] = None,
        username: str = Depends(require_auth_dependency),
    ):
        """从ComfyUI或持久化存储下载视频文件，用新的UUID文件名重新上传到input目录"""
        try:
            target_server, _node_id = select_video_comfyui_server(comfyui_server)
            logger.info("用户 %s 请求重新上传视频: %s (从%s目录)", username, filename, file_type)

            file_content = None
            storage_path = None

            if filename.startswith("video/") or filename.startswith("admin/"):
                video_path_suffix = filename.replace("video/", "")
                possible_paths = [
                    os.path.join("temp", "uploads", "video", video_path_suffix),
                    os.path.join("persistent_storage", "video", video_path_suffix),
                    os.path.join("persistent_storage", "videos", video_path_suffix),
                ]

                for path in possible_paths:
                    if os.path.exists(path):
                        storage_path = path
                        logger.info("✅ 找到视频文件: %s", storage_path)
                        break
                    logger.debug("❌ 路径不存在: %s", path)

            elif filename.startswith("uploads/video/") or filename.startswith("temp/uploads/video/"):
                path_part = filename.replace("uploads/video/", "").replace("temp/uploads/video/", "")
                storage_path = os.path.join("persistent_storage", "videos", path_part.replace("\\", "/"))
                logger.info("将uploads路径映射到: %s", storage_path)

            elif "persistent_storage" in filename:
                storage_path = filename.replace("\\", "/")

            elif "/" in filename:
                storage_path = os.path.join("persistent_storage", "videos", filename.replace("\\", "/"))

            if storage_path and os.path.exists(storage_path):
                logger.info("✅ 从持久化存储读取: %s", storage_path)
                with open(storage_path, "rb") as f:
                    file_content = f.read()
                logger.info("✅ 读取成功，大小: %s 字节", len(file_content))
            elif storage_path:
                logger.warning("❌ 存储路径不存在: %s", storage_path)

            if file_content is None:
                for try_type in [file_type, "temp", "output", "input"]:
                    download_url = f"{target_server}/view?filename={filename}&type={try_type}"
                    logger.info("尝试从ComfyUI下载: %s", download_url)
                    response = requests.get(download_url, timeout=30)

                    if response.ok:
                        file_content = response.content
                        logger.info(
                            "✅ 从ComfyUI下载视频成功 (type=%s): %s, 大小: %s 字节",
                            try_type,
                            filename,
                            len(file_content),
                        )
                        break
                    logger.warning("从ComfyUI %s 目录下载失败: %s", try_type, response.status_code)

                if file_content is None:
                    error_msg = (
                        f"无法找到视频文件: {filename}。已尝试持久化存储和ComfyUI的 "
                        f"{file_type}/temp/output/input 目录。该文件可能已被清理。请重新生成视频。"
                    )
                    logger.error(error_msg)
                    raise HTTPException(status_code=404, detail=error_msg)

            file_ext = os.path.splitext(filename)[1]
            unique_filename = f"{uuid.uuid4().hex[:12]}_reuploaded{file_ext}"

            files = {
                "image": (unique_filename, file_content, "video/mp4"),
            }
            data = {"overwrite": "true"}

            upload_url = f"{target_server}/upload/image"
            upload_response = requests.post(upload_url, files=files, data=data, timeout=60)

            if not upload_response.ok:
                raise HTTPException(status_code=500, detail="重新上传失败")

            result = upload_response.json()
            uploaded_filename = result.get("name", unique_filename)

            logger.info("✅ 视频重新上传成功: %s -> %s", filename, uploaded_filename)

            return {
                "success": True,
                "original_filename": filename,
                "new_filename": uploaded_filename,
                "size": len(file_content),
                "server": target_server,
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error("❌ 视频重新上传失败: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    return router
