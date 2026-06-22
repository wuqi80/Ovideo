"""Video crop business logic for the `/api/video/crop` route."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from services.video_source_service import fetch_comfyui_file_bytes


class VideoCropServiceError(RuntimeError):
    pass


class FfmpegUnavailable(VideoCropServiceError):
    pass


class VideoSourceNotFound(VideoCropServiceError):
    pass


class FfmpegCropFailed(VideoCropServiceError):
    pass


@dataclass(frozen=True)
class VideoSource:
    content: bytes
    source_info: str
    original_file_name: str


def _read_file_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _node_base_url(manager: Any) -> Optional[str]:
    if not manager:
        return None
    node = manager.get_available_node()
    return node.base_url if node else None


def _select_comfyui_server(
    *,
    get_video_cluster_manager: Callable[[], Any],
    get_cluster_manager: Callable[[], Any],
) -> str:
    return (
        _node_base_url(get_video_cluster_manager())
        or _node_base_url(get_cluster_manager())
        or "http://127.0.0.1:8188"
    )


async def _resolve_db_file_source(
    video_filename: str,
    *,
    deploy_root: Path,
    file_dao: Any,
    logger: Any,
) -> Optional[VideoSource]:
    if not video_filename or not video_filename.startswith("file_"):
        return None

    logger.info("Query video file record: %s", video_filename)
    file_record = await file_dao.get_file(video_filename)
    if not file_record:
        logger.warning("Video file record not found: %s", video_filename)
        return None

    file_path = file_record["file_path"]
    original_file_name = file_record.get("file_name") or "video.mp4"
    metadata = file_record.get("metadata", {})

    if file_path.startswith("comfyui://"):
        parts = file_path.replace("comfyui://", "").split("/", 1)
        comfyui_filename = parts[1] if len(parts) > 1 else metadata.get("comfyui_filename", video_filename)
        target_server = metadata.get("comfyui_server", "http://127.0.0.1:8188")
        result = fetch_comfyui_file_bytes(
            target_server,
            comfyui_filename,
            source_label="ComfyUI (from DB)",
        )
        if result:
            logger.info("Fetched DB ComfyUI video source type=%s size=%s", result.file_type, len(result.content))
            return VideoSource(result.content, result.source_info, original_file_name)
        return None

    local_path = file_path if os.path.isabs(file_path) else str(deploy_root / file_path)
    if os.path.exists(local_path):
        content = _read_file_bytes(local_path)
        logger.info("Read DB local video source size=%s path=%s", len(content), local_path)
        return VideoSource(content, f"local file (from DB): {local_path}", original_file_name)

    logger.warning("DB video path does not exist: %s", local_path)
    return None


def _persistent_storage_candidates(video_filename: str) -> list[str]:
    normalized = video_filename.replace("\\", "/")
    if normalized.startswith("video/"):
        suffix = normalized.replace("video/", "", 1)
        return [
            os.path.join("temp", "uploads", "video", suffix),
            os.path.join("persistent_storage", "video", suffix),
            os.path.join("persistent_storage", "videos", suffix),
        ]
    if normalized.startswith("uploads/video/") or normalized.startswith("temp/uploads/video/"):
        path_part = normalized.replace("uploads/video/", "", 1).replace("temp/uploads/video/", "", 1)
        return [os.path.join("persistent_storage", "videos", path_part)]
    if "persistent_storage" in normalized:
        return [normalized]
    return [os.path.join("persistent_storage", "videos", normalized)]


def _resolve_storage_file_source(video_filename: str, *, logger: Any) -> Optional[VideoSource]:
    if not video_filename or ("/" not in video_filename and "\\" not in video_filename):
        return None

    for storage_path in _persistent_storage_candidates(video_filename):
        if os.path.exists(storage_path):
            content = _read_file_bytes(storage_path)
            logger.info("Read persistent video source size=%s path=%s", len(content), storage_path)
            return VideoSource(content, f"persistent storage: {storage_path}", os.path.basename(storage_path))
        logger.debug("Video storage path does not exist: %s", storage_path)
    return None


def _resolve_direct_comfyui_source(
    video_filename: str,
    *,
    get_video_cluster_manager: Callable[[], Any],
    get_cluster_manager: Callable[[], Any],
    logger: Any,
) -> Optional[VideoSource]:
    target_server = _select_comfyui_server(
        get_video_cluster_manager=get_video_cluster_manager,
        get_cluster_manager=get_cluster_manager,
    )
    comfyui_filename = video_filename.replace("\\", "/").split("/")[-1] if ("/" in video_filename or "\\" in video_filename) else video_filename
    result = fetch_comfyui_file_bytes(target_server, comfyui_filename)
    if result:
        logger.info("Fetched direct ComfyUI video source type=%s size=%s", result.file_type, len(result.content))
        return VideoSource(result.content, result.source_info, comfyui_filename)
    return None


async def resolve_video_source(
    video_filename: str,
    *,
    deploy_root: Path,
    file_dao: Any,
    get_video_cluster_manager: Callable[[], Any],
    get_cluster_manager: Callable[[], Any],
    logger: Any,
) -> VideoSource:
    source = await _resolve_db_file_source(
        video_filename,
        deploy_root=deploy_root,
        file_dao=file_dao,
        logger=logger,
    )
    if source:
        return source

    source = _resolve_storage_file_source(video_filename, logger=logger)
    if source:
        return source

    source = _resolve_direct_comfyui_source(
        video_filename,
        get_video_cluster_manager=get_video_cluster_manager,
        get_cluster_manager=get_cluster_manager,
        logger=logger,
    )
    if source:
        return source

    raise VideoSourceNotFound(f"无法找到视频文件: {video_filename}")


def _output_extension(video_filename: str) -> str:
    return "." + video_filename.split(".")[-1] if "." in video_filename else ".mp4"


def _run_ffmpeg_crop(
    *,
    source: VideoSource,
    video_filename: str,
    start_time: float,
    end_time: float,
    ffmpeg_runner: Callable[..., Any],
    uuid_hex_provider: Callable[[], str],
    logger: Any,
) -> tuple[bytes, str]:
    input_path: Optional[str] = None
    output_path: Optional[str] = None
    output_filename = f"cropped_{uuid_hex_provider()[:8]}{_output_extension(video_filename)}"

    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as input_temp:
            input_temp.write(source.content)
            input_path = input_temp.name

        output_path = os.path.join(tempfile.gettempdir(), output_filename)
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
        logger.info("Run FFmpeg crop: %s", " ".join(cmd))
        result = ffmpeg_runner(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise FfmpegCropFailed(f"FFmpeg执行失败 (返回码 {result.returncode}): {result.stderr[:500]}")
        if not os.path.exists(output_path):
            raise FfmpegCropFailed("FFmpeg执行完成但未生成输出文件")
        if os.path.getsize(output_path) == 0:
            raise FfmpegCropFailed("FFmpeg生成的文件为空")
        return _read_file_bytes(output_path), output_filename
    finally:
        for path in [input_path, output_path]:
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except Exception as exc:
                    logger.warning("Failed to clean temp video file %s: %s", path, exc)


async def _ensure_video_version(
    *,
    username: str,
    project_dao: Any,
    version_dao: Any,
    uuid_hex_provider: Callable[[], str],
) -> str:
    projects = await project_dao.get_user_projects(username)
    if not projects:
        project_id = f"proj_{uuid_hex_provider()[:12]}"
        await project_dao.save_or_update_project(
            user_id=username,
            project_id=project_id,
            project_name="默认项目",
            project_data={},
            description="自动创建",
        )
    else:
        project_id = projects[0]["project_id"]

    versions = await version_dao.get_project_versions(project_id)
    if not versions:
        version = await version_dao.create_version(
            project_id=project_id,
            user_id=username,
            version_name="默认版本",
        )
        return version["version_id"]
    return versions[0]["version_id"]


async def crop_video_file(
    *,
    video_filename: str,
    start_time: float,
    end_time: float,
    username: str,
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    get_video_cluster_manager: Callable[[], Any],
    get_cluster_manager: Callable[[], Any],
    logger: Any,
    deploy_root: Path,
    storage_root: Path = Path("persistent_storage"),
    ffmpeg_available: Callable[[str], Optional[str]] = shutil.which,
    ffmpeg_runner: Callable[..., Any] = subprocess.run,
    now_provider: Callable[[], datetime] = datetime.now,
    utc_now_provider: Callable[[], datetime] = lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
) -> Dict[str, Any]:
    if not ffmpeg_available("ffmpeg"):
        raise FfmpegUnavailable("服务器未安装FFmpeg，无法进行视频剪辑")

    source = await resolve_video_source(
        video_filename,
        deploy_root=deploy_root,
        file_dao=file_dao,
        get_video_cluster_manager=get_video_cluster_manager,
        get_cluster_manager=get_cluster_manager,
        logger=logger,
    )
    if not source.content:
        raise VideoSourceNotFound(f"无法找到视频文件: {video_filename}")

    cropped_content, output_filename = _run_ffmpeg_crop(
        source=source,
        video_filename=video_filename,
        start_time=start_time,
        end_time=end_time,
        ffmpeg_runner=ffmpeg_runner,
        uuid_hex_provider=uuid_hex_provider,
        logger=logger,
    )

    new_file_id = f"file_{uuid_hex_provider()[:12]}"
    year_month = now_provider().strftime("%Y%m")
    storage_dir = storage_root / "videos" / username / year_month
    storage_dir.mkdir(parents=True, exist_ok=True)
    cropped_filename = f"cropped_{uuid_hex_provider()[:8]}{_output_extension(video_filename)}"
    storage_path = storage_dir / cropped_filename
    storage_path.write_bytes(cropped_content)

    version_id = await _ensure_video_version(
        username=username,
        project_dao=project_dao,
        version_dao=version_dao,
        uuid_hex_provider=uuid_hex_provider,
    )

    file_record = await file_dao.create_file(
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
            "source_info": source.source_info,
            "start_time": start_time,
            "end_time": end_time,
            "duration": end_time - start_time,
            "cropped_at": utc_now_provider().isoformat(),
        },
        file_id=new_file_id,
    )

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
