"""Business helpers for ComfyUI file proxy and upload routes."""
from __future__ import annotations

import inspect
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Optional

import requests


class ComfyUIFileRequestError(RuntimeError):
    """Raised when a ComfyUI file transfer request cannot be completed."""


class ComfyUIVideoReuploadNotFound(RuntimeError):
    """Raised when a source video cannot be found in storage or ComfyUI."""


class ComfyUIVideoReuploadFailed(RuntimeError):
    """Raised when reuploading a source video to ComfyUI fails."""


@dataclass(frozen=True)
class ComfyUIUploadRecord:
    """Database record metadata returned after persisting a ComfyUI upload."""

    file_record: Dict[str, Any]
    file_id: str
    version_id: str
    file_url: str
    download_url: str


@dataclass(frozen=True)
class ReuploadVideoSource:
    content: bytes
    source_info: str


def _request(action: str, method, *args, **kwargs) -> requests.Response:
    try:
        return method(*args, **kwargs)
    except requests.RequestException as exc:
        raise ComfyUIFileRequestError(f"{action} failed: {exc}") from exc


def fetch_comfyui_view_response(
    url: str,
    *,
    params: Optional[Mapping[str, str]] = None,
    timeout: int = 60,
    stream: bool = False,
) -> requests.Response:
    """Fetch a ComfyUI /view response for proxy routes."""
    return _request("comfyui_view", requests.get, url, params=params, timeout=timeout, stream=stream)


def upload_comfyui_file_response(
    upload_url: str,
    filename: str,
    content: bytes,
    content_type: str,
    *,
    timeout: int = 60,
) -> requests.Response:
    """Upload a file to ComfyUI's image upload endpoint."""
    files = {"image": (filename, content, content_type)}
    data = {"overwrite": "true"}
    return _request("comfyui_upload", requests.post, upload_url, files=files, data=data, timeout=timeout)


async def _ensure_default_upload_version(
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


async def _set_redis_mapping(redis_client: Any, key: str, value: str, *, ex: int) -> None:
    result = redis_client.set(key, value, ex=ex)
    if inspect.isawaitable(result):
        await result


async def create_comfyui_upload_record(
    *,
    username: str,
    file_type: str,
    file_name: str,
    file_path: str,
    file_size_bytes: int,
    mime_type: str,
    metadata: Dict[str, Any],
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    file_url: Optional[str] = None,
    redis_client: Optional[Any] = None,
    redis_comfyui_filename: Optional[str] = None,
    redis_ttl_seconds: int = 86400,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
) -> ComfyUIUploadRecord:
    """Create the default project/version if needed and persist a ComfyUI upload file record."""

    file_id = f"file_{uuid_hex_provider()[:12]}"
    download_url = f"/api/files/{file_id}/download"
    resolved_file_url = file_url or download_url
    version_id = await _ensure_default_upload_version(
        username=username,
        project_dao=project_dao,
        version_dao=version_dao,
        uuid_hex_provider=uuid_hex_provider,
    )

    file_record = await file_dao.create_file(
        version_id=version_id,
        user_id=username,
        file_type=file_type,
        file_name=file_name,
        file_path=file_path,
        file_url=resolved_file_url,
        file_size_bytes=file_size_bytes,
        mime_type=mime_type,
        metadata=metadata,
        file_id=file_id,
    )

    if redis_client and redis_comfyui_filename:
        try:
            await _set_redis_mapping(
                redis_client,
                f"comfyui:file:{redis_comfyui_filename}",
                file_id,
                ex=redis_ttl_seconds,
            )
        except Exception as exc:
            logger.warning("[ComfyUpload] Redis缓存写入失败(非致命): %s", exc)

    return ComfyUIUploadRecord(
        file_record=file_record,
        file_id=file_id,
        version_id=version_id,
        file_url=resolved_file_url,
        download_url=download_url,
    )


def _rooted_path(storage_root: Path, path: str) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else storage_root / candidate


def _reupload_storage_candidates(filename: str, *, storage_root: Path = Path(".")) -> list[Path]:
    normalized = filename.replace("\\", "/")
    if normalized.startswith("video/") or normalized.startswith("admin/"):
        video_path_suffix = normalized.replace("video/", "", 1)
        return [
            _rooted_path(storage_root, os.path.join("temp", "uploads", "video", video_path_suffix)),
            _rooted_path(storage_root, os.path.join("persistent_storage", "video", video_path_suffix)),
            _rooted_path(storage_root, os.path.join("persistent_storage", "videos", video_path_suffix)),
        ]
    if normalized.startswith("uploads/video/") or normalized.startswith("temp/uploads/video/"):
        path_part = normalized.replace("uploads/video/", "", 1).replace("temp/uploads/video/", "", 1)
        return [_rooted_path(storage_root, os.path.join("persistent_storage", "videos", path_part))]
    if "persistent_storage" in normalized:
        return [_rooted_path(storage_root, normalized)]
    if "/" in normalized:
        return [_rooted_path(storage_root, os.path.join("persistent_storage", "videos", normalized))]
    return []


def resolve_reupload_video_source(
    *,
    filename: str,
    file_type: str,
    target_server: str,
    logger: Any,
    storage_root: Path = Path("."),
    fetch_view: Callable[..., requests.Response] = fetch_comfyui_view_response,
) -> ReuploadVideoSource:
    """Resolve reupload source bytes from persistent storage or ComfyUI."""

    for storage_path in _reupload_storage_candidates(filename, storage_root=storage_root):
        if storage_path.exists():
            logger.info("✅ 从持久化存储读取: %s", storage_path)
            return ReuploadVideoSource(
                content=storage_path.read_bytes(),
                source_info=f"persistent_storage:{storage_path}",
            )
        logger.debug("❌ 路径不存在: %s", storage_path)

    for try_type in [file_type, "temp", "output", "input"]:
        download_url = f"{target_server}/view?filename={filename}&type={try_type}"
        logger.info("尝试从ComfyUI下载: %s", download_url)
        response = fetch_view(download_url, timeout=30)

        if response.ok:
            content = response.content
            logger.info("✅ 从ComfyUI下载视频成功 (type=%s): %s, 大小: %s 字节", try_type, filename, len(content))
            return ReuploadVideoSource(content=content, source_info=f"comfyui:{try_type}:{download_url}")
        logger.warning("从ComfyUI %s 目录下载失败: %s", try_type, response.status_code)

    raise ComfyUIVideoReuploadNotFound(
        f"无法找到视频文件: {filename}。已尝试持久化存储和ComfyUI的 "
        f"{file_type}/temp/output/input 目录。该文件可能已被清理。请重新生成视频。"
    )


def reupload_comfyui_video_with_uuid(
    *,
    filename: str,
    file_type: str,
    target_server: str,
    logger: Any,
    storage_root: Path = Path("."),
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    fetch_view: Callable[..., requests.Response] = fetch_comfyui_view_response,
    upload_file: Callable[..., requests.Response] = upload_comfyui_file_response,
) -> Dict[str, Any]:
    """Download a video source and reupload it to ComfyUI with a fresh UUID filename."""

    source = resolve_reupload_video_source(
        filename=filename,
        file_type=file_type,
        target_server=target_server,
        logger=logger,
        storage_root=storage_root,
        fetch_view=fetch_view,
    )

    file_ext = os.path.splitext(filename)[1]
    unique_filename = f"{uuid_hex_provider()[:12]}_reuploaded{file_ext}"
    upload_url = f"{target_server}/upload/image"
    upload_response = upload_file(
        upload_url,
        unique_filename,
        source.content,
        "video/mp4",
        timeout=60,
    )

    if not upload_response.ok:
        raise ComfyUIVideoReuploadFailed("重新上传失败")

    result = upload_response.json()
    uploaded_filename = result.get("name", unique_filename) if isinstance(result, dict) else unique_filename
    logger.info("✅ 视频重新上传成功: %s -> %s", filename, uploaded_filename)

    return {
        "success": True,
        "original_filename": filename,
        "new_filename": uploaded_filename,
        "size": len(source.content),
        "server": target_server,
    }
