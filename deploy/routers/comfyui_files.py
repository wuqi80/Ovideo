"""ComfyUI file proxy routes."""
from __future__ import annotations

import logging
from typing import Callable, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials

from dao_content import FileDAO, ProjectDAO, VersionDAO
from services.comfyui_file_service import (
    ComfyUIFileAccessDenied,
    ComfyUIFileRequestError,
    ComfyUIMediaUploadFailed,
    ComfyUIVideoReuploadFailed,
    ComfyUIVideoReuploadNotFound,
    ComfyUIViewFetchFailed,
    fetch_comfyui_view_with_fallback,
    require_comfyui_file_access,
    reupload_comfyui_video_with_uuid,
    upload_audio_file_to_comfyui,
    upload_image_file_to_comfyui,
    upload_video_file_to_comfyui,
)

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

    def registered_comfyui_servers() -> dict[str, Optional[str]]:
        servers: dict[str, Optional[str]] = {}
        for manager_getter in (get_cluster_manager, get_video_cluster_manager, get_image_cluster_manager):
            manager = manager_getter()
            nodes = getattr(manager, "nodes", []) if manager else []
            if isinstance(nodes, dict):
                nodes = nodes.values()
            for node in nodes or []:
                base_url = str(getattr(node, "base_url", "") or "").rstrip("/")
                if base_url:
                    servers[base_url] = getattr(node, "id", None)
        return servers

    def require_registered_comfyui_server(comfyui_server: str) -> tuple[str, Optional[str]]:
        requested = str(comfyui_server or "").rstrip("/")
        servers = registered_comfyui_servers()
        if requested not in servers:
            raise HTTPException(status_code=400, detail="Unknown processing node")
        return requested, servers[requested]

    def select_video_comfyui_server(comfyui_server: Optional[str] = None) -> tuple[str, Optional[str]]:
        if comfyui_server:
            return require_registered_comfyui_server(comfyui_server)

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

            await require_comfyui_file_access(
                filename=filename,
                identity=username,
                file_dao=FileDAO,
                redis_client=get_redis_client(),
            )

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
            logger.info("用户 %s 代理访问ComfyUI文件: %s filename=%s type=%s subfolder=%s", username, url, filename, type, subfolder)
            response = fetch_comfyui_view_with_fallback(
                url=url,
                filename=filename,
                file_type=type,
                subfolder=subfolder,
                logger=logger,
                timeout=60,
                stream=True,
            )

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
        except ComfyUIFileAccessDenied as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ComfyUIViewFetchFailed as e:
            raise HTTPException(status_code=e.status_code, detail=str(e))
        except ComfyUIFileRequestError as e:
            logger.error("代理ComfyUI文件失败: %s", e)
            raise HTTPException(status_code=503, detail="无法连接到处理节点，请稍后重试")
        except Exception as e:
            logger.error("代理ComfyUI文件失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/comfyui/upload")
    async def comfyui_upload_proxy(
        image: UploadFile = File(...),
        node_type: Optional[str] = Form(None),
        standalone: bool = Form(False),
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

            logger.info(
                "[ComfyUpload] 用户=%s, 原文件=%s, 大小=%s 字节, 节点类型=%s",
                username,
                image.filename,
                len(file_content),
                node_type,
            )

            target_server = None
            node_id = None

            if comfyui_server:
                target_server, node_id = require_registered_comfyui_server(comfyui_server)
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

            return await upload_image_file_to_comfyui(
                username=username,
                file_dao=FileDAO,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                original_filename=image.filename or "upload.png",
                content=file_content,
                content_type=image.content_type or "image/png",
                target_server=target_server,
                comfyui_node_id=node_id,
                logger=logger,
                redis_client=get_redis_client(),
                attach_default_version=not standalone,
            )

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

            logger.info(
                "[ComfyUploadVideo] 用户=%s, 原文件=%s, 大小=%s 字节",
                username,
                video.filename,
                len(file_content),
            )

            target_server, node_id = select_video_comfyui_server(comfyui_server)
            if node_id:
                logger.info("[ComfyUploadVideo] 选择视频集群节点: %s (%s)", node_id, target_server)
            elif comfyui_server:
                logger.info("[ComfyUploadVideo] 使用指定 ComfyUI: %s", target_server)
            else:
                logger.info("[ComfyUploadVideo] 使用默认 ComfyUI: %s", target_server)

            return await upload_video_file_to_comfyui(
                username=username,
                file_dao=FileDAO,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                original_filename=video.filename or "video.mp4",
                content=file_content,
                content_type=video.content_type or "video/mp4",
                target_server=target_server,
                logger=logger,
            )

        except ComfyUIMediaUploadFailed as e:
            raise HTTPException(status_code=502, detail=str(e))
        except ComfyUIFileRequestError as e:
            logger.error("❌ ComfyUI 视频上传请求失败: %s", e)
            raise HTTPException(status_code=503, detail="无法连接到处理节点，请稍后重试")
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

            logger.info(
                "[ComfyUploadAudio] 用户=%s, 原文件=%s, 大小=%s 字节, 剪裁=%ss-%ss",
                username,
                audio.filename,
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

            return upload_audio_file_to_comfyui(
                username=username,
                original_filename=audio.filename or "audio.mp3",
                content=file_content,
                content_type=audio.content_type or "audio/mpeg",
                start_time=start_time,
                duration=duration,
                target_server=target_server,
                logger=logger,
            )

        except ComfyUIMediaUploadFailed as e:
            raise HTTPException(status_code=502, detail=str(e))
        except ComfyUIFileRequestError as e:
            logger.error("❌ ComfyUI 音频上传请求失败: %s", e)
            raise HTTPException(status_code=503, detail="无法连接到处理节点，请稍后重试")
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
            await require_comfyui_file_access(
                filename=filename,
                identity=username,
                file_dao=FileDAO,
                redis_client=get_redis_client(),
            )
            logger.info("用户 %s 请求重新上传视频: %s (从%s目录)", username, filename, file_type)

            return reupload_comfyui_video_with_uuid(
                filename=filename,
                file_type=file_type,
                target_server=target_server,
                logger=logger,
            )

        except ComfyUIFileAccessDenied as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ComfyUIVideoReuploadNotFound as e:
            logger.error("%s", e)
            raise HTTPException(status_code=404, detail=str(e))
        except ComfyUIVideoReuploadFailed as e:
            logger.error("❌ 视频重新上传失败: %s", e)
            raise HTTPException(status_code=500, detail=str(e))
        except HTTPException:
            raise
        except Exception as e:
            logger.error("❌ 视频重新上传失败: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    return router
