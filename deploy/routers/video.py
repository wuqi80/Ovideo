"""Video processing routes."""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException

from cluster_config import SystemConfig
from dao_content import FileDAO, ProjectDAO, VersionDAO
from schemas.video import CropVideoRequest

logger = logging.getLogger(__name__)


def create_video_router(
    *,
    require_auth_dependency,
    get_video_cluster_manager: Callable[[], object],
    get_cluster_manager: Callable[[], object],
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/video/crop")
    async def crop_video(
        request: CropVideoRequest,
        username: str = Depends(require_auth_dependency),
    ):
        """
        裁剪视频片段

        支持的video_filename格式:
        1. file_id: "file_abc123def456" - 从数据库查询文件
        2. ComfyUI文件名: "output.mp4" - 从ComfyUI获取
        3. 完整路径: "video/user/202501/xxx.mp4" - 从持久化存储获取（兼容旧格式）
        """
        try:
            video_filename = request.video_filename
            start_time = request.start_time
            end_time = request.end_time

            logger.info("用户 %s 请求裁剪视频: %s, %ss-%ss", username, video_filename, start_time, end_time)

            if not shutil.which("ffmpeg"):
                logger.error("FFmpeg未安装")
                raise HTTPException(status_code=500, detail="服务器未安装FFmpeg，无法进行视频剪辑")

            file_content = None
            source_info = ""
            original_file_name = "video.mp4"

            if video_filename and video_filename.startswith("file_"):
                logger.info("从数据库查询文件: %s", video_filename)
                file_record = await FileDAO.get_file(video_filename)

                if file_record:
                    file_path = file_record["file_path"]
                    original_file_name = file_record["file_name"]
                    metadata = file_record.get("metadata", {})

                    logger.info("文件记录: path=%s, metadata=%s", file_path, metadata)

                    if file_path.startswith("comfyui://"):
                        parts = file_path.replace("comfyui://", "").split("/", 1)
                        comfyui_filename = parts[1] if len(parts) > 1 else metadata.get("comfyui_filename", video_filename)
                        target_server = metadata.get("comfyui_server", "http://127.0.0.1:8188")

                        logger.info("从ComfyUI获取文件: %s @ %s", comfyui_filename, target_server)
                        for file_type in ["output", "temp", "input"]:
                            download_url = f"{target_server}/view?filename={comfyui_filename}&type={file_type}"
                            try:
                                response = requests.get(download_url, timeout=30)
                                if response.ok and len(response.content) > 0:
                                    file_content = response.content
                                    source_info = f"ComfyUI (from DB): {download_url}"
                                    logger.info("✅ 从ComfyUI获取文件成功, type=%s, 大小: %s", file_type, len(file_content))
                                    break
                            except Exception as e:
                                logger.warning("从ComfyUI获取失败 (type=%s): %s", file_type, e)
                                continue
                    else:
                        if not os.path.isabs(file_path):
                            file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), file_path)

                        if os.path.exists(file_path):
                            with open(file_path, "rb") as f:
                                file_content = f.read()
                            source_info = f"本地文件 (from DB): {file_path}"
                            logger.info("✅ 从本地文件获取成功, 大小: %s", len(file_content))
                        else:
                            logger.warning("文件路径不存在: %s", file_path)
                else:
                    logger.warning("数据库中未找到文件记录: %s", video_filename)

            if file_content is None and video_filename and ("/" in video_filename or "\\" in video_filename):
                logger.info("尝试从持久化存储获取: %s", video_filename)

                storage_path = None
                if video_filename.startswith("video/") or video_filename.startswith("video\\"):
                    video_path_suffix = video_filename.replace("video/", "").replace("video\\", "").replace("\\", "/")

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

                    if not storage_path:
                        logger.warning("所有可能的路径都不存在，尝试的路径: %s", possible_paths)
                elif video_filename.startswith("uploads/video/") or video_filename.startswith("temp/uploads/video/"):
                    path_part = video_filename.replace("uploads/video/", "").replace("temp/uploads/video/", "")
                    storage_path = os.path.join("persistent_storage", "videos", path_part.replace("\\", "/"))
                    logger.info("将uploads路径映射到: %s", storage_path)
                elif "persistent_storage" in video_filename:
                    storage_path = video_filename.replace("\\", "/")
                else:
                    storage_path = os.path.join("persistent_storage", "videos", video_filename.replace("\\", "/"))

                logger.info("尝试读取存储路径: %s", storage_path)

                if storage_path and os.path.exists(storage_path):
                    with open(storage_path, "rb") as f:
                        file_content = f.read()
                    source_info = f"持久化存储: {storage_path}"
                    original_file_name = os.path.basename(storage_path)
                    logger.info("✅ 从持久化存储获取成功, 大小: %s", len(file_content))
                else:
                    logger.warning("存储路径不存在: %s", storage_path)

            if file_content is None:
                logger.info("尝试直接从ComfyUI获取: %s", video_filename)

                video_cluster_manager = get_video_cluster_manager()
                cluster_manager = get_cluster_manager()
                if video_cluster_manager:
                    node = video_cluster_manager.get_available_node()
                    target_server = node.base_url if node else "http://127.0.0.1:8188"
                elif cluster_manager:
                    node = cluster_manager.get_available_node()
                    target_server = node.base_url if node else "http://127.0.0.1:8188"
                else:
                    target_server = "http://127.0.0.1:8188"

                comfyui_filename = video_filename
                if "/" in video_filename or "\\" in video_filename:
                    comfyui_filename = video_filename.replace("\\", "/").split("/")[-1]

                for file_type in ["output", "temp", "input"]:
                    download_url = f"{target_server}/view?filename={comfyui_filename}&type={file_type}"
                    try:
                        response = requests.get(download_url, timeout=30)
                        if response.ok and len(response.content) > 0:
                            file_content = response.content
                            source_info = f"ComfyUI: {download_url}"
                            original_file_name = comfyui_filename
                            logger.info("✅ 从ComfyUI直接获取成功, type=%s, 大小: %s", file_type, len(file_content))
                            break
                    except Exception as e:
                        logger.warning("从ComfyUI获取失败 (type=%s): %s", file_type, e)
                        continue

            if file_content is None or len(file_content) == 0:
                logger.error("无法找到视频文件: %s", video_filename)
                raise HTTPException(status_code=404, detail=f"无法找到视频文件: {video_filename}")

            logger.info("开始剪辑视频，源文件: %s, 大小: %s bytes", source_info, len(file_content))

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as input_temp:
                input_temp.write(file_content)
                input_path = input_temp.name

            file_ext = ".mp4"
            if "." in video_filename:
                file_ext = "." + video_filename.split(".")[-1]

            output_filename = f"cropped_{uuid.uuid4().hex[:8]}{file_ext}"
            output_path = os.path.join(tempfile.gettempdir(), output_filename)

            try:
                cmd = [
                    "ffmpeg",
                    "-i",
                    input_path,
                    "-ss",
                    str(start_time),
                    "-to",
                    str(end_time),
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-preset",
                    "fast",
                    "-y",
                    output_path,
                ]

                logger.info("执行FFmpeg命令: %s", " ".join(cmd))
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

                if result.returncode != 0:
                    logger.error("FFmpeg剪辑失败，返回码: %s", result.returncode)
                    logger.error("FFmpeg stderr: %s", result.stderr)
                    logger.error("FFmpeg stdout: %s", result.stdout)
                    raise Exception(f"FFmpeg执行失败 (返回码 {result.returncode}): {result.stderr[:500]}")

                if not os.path.exists(output_path):
                    raise Exception("FFmpeg执行完成但未生成输出文件")

                output_size = os.path.getsize(output_path)
                if output_size == 0:
                    raise Exception("FFmpeg生成的文件为空")

                logger.info("✅ FFmpeg剪辑成功，输出文件: %s, 大小: %s bytes", output_path, output_size)

                with open(output_path, "rb") as f:
                    cropped_content = f.read()

                new_file_id = f"file_{uuid.uuid4().hex[:12]}"
                year_month = datetime.now().strftime("%Y%m")

                storage_dir = Path("persistent_storage/videos") / username / year_month
                storage_dir.mkdir(parents=True, exist_ok=True)
                cropped_filename = f"cropped_{uuid.uuid4().hex[:8]}{file_ext}"
                storage_path = storage_dir / cropped_filename
                storage_path.write_bytes(cropped_content)

                logger.info("💾 裁剪后的视频已保存到本地: %s", storage_path)

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
                    file_name=cropped_filename,
                    file_path=str(storage_path),
                    file_url=f"/api/files/{new_file_id}/download",
                    file_size_bytes=len(cropped_content),
                    mime_type="video/mp4",
                    metadata={
                        "source": "video_crop",
                        "original_video": video_filename,
                        "start_time": start_time,
                        "end_time": end_time,
                        "duration": end_time - start_time,
                        "cropped_at": datetime.utcnow().isoformat(),
                    },
                    file_id=new_file_id,
                )

                logger.info("✅ 裁剪后的视频已保存到数据库: file_id=%s", file_record["file_id"])

                return {
                    "success": True,
                    "file_id": file_record["file_id"],
                    "filename": cropped_filename,
                    "url": file_record["file_url"],
                    "storage_path": str(storage_path),
                    "start_time": start_time,
                    "end_time": end_time,
                    "duration": end_time - start_time,
                    "size": len(cropped_content),
                }

            finally:
                try:
                    if os.path.exists(input_path):
                        os.unlink(input_path)
                        logger.info("清理输入临时文件: %s", input_path)
                    if os.path.exists(output_path):
                        os.unlink(output_path)
                        logger.info("清理输出临时文件: %s", output_path)
                    temp_save_path_check = os.path.join(SystemConfig.TEMP_DIR, output_filename)
                    if os.path.exists(temp_save_path_check):
                        os.unlink(temp_save_path_check)
                        logger.info("清理保存临时文件: %s", temp_save_path_check)
                except Exception as cleanup_error:
                    logger.warning("清理临时文件失败: %s", cleanup_error)

        except HTTPException:
            raise
        except Exception as e:
            logger.error("视频裁剪失败: %s", str(e), exc_info=True)
            raise HTTPException(status_code=500, detail=f"视频裁剪失败: {str(e)}")

    return router
