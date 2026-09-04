"""Business helpers for ComfyUI file proxy and upload routes."""
from __future__ import annotations

import inspect
import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Optional

import requests

from services.entity_access_service import EntityAccessDenied, require_file_access


class ComfyUIFileRequestError(RuntimeError):
    """Raised when a ComfyUI file transfer request cannot be completed."""


class ComfyUIViewFetchFailed(RuntimeError):
    """Raised when ComfyUI returns a non-success file view response."""

    def __init__(self, message: str, *, status_code: int):
        super().__init__(message)
        self.status_code = status_code


class ComfyUIVideoReuploadNotFound(RuntimeError):
    """Raised when a source video cannot be found in storage or ComfyUI."""


class ComfyUIVideoReuploadFailed(RuntimeError):
    """Raised when reuploading a source video to ComfyUI fails."""


class ComfyUIMediaUploadFailed(RuntimeError):
    """Raised when ComfyUI rejects an upload request."""

    def __init__(self, message: str, *, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class ComfyUIFileAccessDenied(LookupError):
    pass


class _ComfyUIFileAccessDAO:
    def __init__(self, file_dao: Any):
        self.file_dao = file_dao

    async def get_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        return await self.file_dao.get_file(file_id)


async def require_comfyui_file_access(
    *,
    filename: str,
    identity: str,
    file_dao: Any,
    redis_client: Any = None,
    file_access_checker: Callable[..., Any] = require_file_access,
) -> Dict[str, Any]:
    file_id: Optional[str] = None
    if redis_client is not None:
        value = redis_client.get(f"comfyui:file:{filename}")
        if inspect.isawaitable(value):
            value = await value
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="ignore")
        file_id = str(value or "") or None

    record = await file_dao.get_file(file_id) if file_id else None
    if not record and hasattr(file_dao, "get_file_by_comfyui_filename"):
        record = await file_dao.get_file_by_comfyui_filename(filename)
    if not record or not record.get("file_id"):
        raise ComfyUIFileAccessDenied("处理文件不存在或无权访问")

    try:
        await file_access_checker(
            str(record["file_id"]),
            identity,
            "readonly",
            file_dao=_ComfyUIFileAccessDAO(file_dao),
        )
    except EntityAccessDenied as exc:
        raise ComfyUIFileAccessDenied("处理文件不存在或无权访问") from exc
    return dict(record)


@dataclass(frozen=True)
class ComfyUIUploadRecord:
    """Database record metadata returned after persisting a ComfyUI upload."""

    file_record: Dict[str, Any]
    file_id: str
    version_id: Optional[str]
    file_url: str
    download_url: str


@dataclass(frozen=True)
class ReuploadVideoSource:
    content: bytes
    source_info: str


@dataclass(frozen=True)
class ComfyUIAudioUploadResult:
    filename: str
    original_filename: str
    size: int
    server: str
    start_time: float
    duration: float

    def as_response(self) -> Dict[str, Any]:
        return {
            "success": True,
            "filename": self.filename,
            "original_filename": self.original_filename,
            "size": self.size,
            "server": self.server,
            "start_time": self.start_time,
            "duration": self.duration,
        }


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


def _view_fallback_types(file_type: str) -> list[str]:
    if file_type == "temp":
        return ["output", "input"]
    if file_type == "output":
        return ["temp", "input"]
    if file_type == "input":
        return ["output", "temp"]
    return []


def fetch_comfyui_view_with_fallback(
    *,
    url: str,
    filename: str,
    file_type: str = "output",
    subfolder: str = "",
    logger: Any,
    timeout: int = 60,
    stream: bool = True,
    fetch_view: Callable[..., requests.Response] = fetch_comfyui_view_response,
) -> requests.Response:
    """Fetch a ComfyUI /view response and try compatible storage types after a 404."""

    base_params: Dict[str, str] = {"filename": filename}
    if subfolder:
        base_params["subfolder"] = subfolder

    params = {**base_params, "type": file_type}
    response = fetch_view(url, params=params, timeout=timeout, stream=stream)
    if response.status_code == 404:
        last_type = file_type
        for fallback_type in _view_fallback_types(file_type):
            logger.warning("文件在 %s 中未找到，尝试在 %s 中查找: %s", last_type, fallback_type, filename)
            fallback_params = {**base_params, "type": fallback_type}
            response = fetch_view(url, params=fallback_params, timeout=timeout, stream=stream)
            if response.status_code == 200:
                logger.info("✅ 在 %s 中找到文件: %s", fallback_type, filename)
                break
            last_type = fallback_type

    if not response.ok:
        logger.error("ComfyUI返回错误: %s - %s", response.status_code, response.text)
        raise ComfyUIViewFetchFailed("处理节点暂时无法读取文件", status_code=response.status_code)
    return response


def _extract_uploaded_filename(response: requests.Response, default_filename: str) -> str:
    try:
        response_json = response.json()
    except Exception:
        response_json = {}

    if not isinstance(response_json, dict):
        return default_filename
    if response_json.get("name"):
        return response_json["name"]
    images = response_json.get("images")
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, dict) and first.get("filename"):
            return first["filename"]
    return default_filename


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
    attach_default_version: bool = True,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
) -> ComfyUIUploadRecord:
    """Persist a ComfyUI upload, optionally attaching it to a default project version."""

    file_id = f"file_{uuid_hex_provider()[:12]}"
    download_url = f"/api/files/{file_id}/download"
    resolved_file_url = file_url or download_url
    version_id = None
    if attach_default_version:
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


async def upload_image_file_to_comfyui(
    *,
    username: str,
    original_filename: str,
    content: bytes,
    content_type: str,
    target_server: Optional[str],
    comfyui_node_id: Optional[str],
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    redis_client: Optional[Any] = None,
    storage_root: Path = Path("persistent_storage"),
    now_provider: Callable[[], datetime] = datetime.now,
    utc_now_provider: Callable[[], datetime] = datetime.utcnow,
    attach_default_version: bool = True,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    upload_file: Callable[..., requests.Response] = upload_comfyui_file_response,
) -> Dict[str, Any]:
    """Persist an uploaded image locally, optionally forward it to ComfyUI, and create a file record."""

    safe_filename = original_filename or "upload.png"
    logical_id = uuid_hex_provider()[:12]
    unique_filename = f"{logical_id}_{safe_filename}"
    year_month = now_provider().strftime("%Y%m")
    local_dir = storage_root / "image" / username / year_month
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / unique_filename
    local_path.write_bytes(content)
    local_file_path = str(local_path)
    local_storage_url = f"/storage/image/{username}/{year_month}/{unique_filename}"
    comfyui_filename = unique_filename
    logger.info("💾 图片本地存储(primary): %s", local_path)

    if target_server:
        try:
            upload_url = f"{target_server}/upload/image"
            logger.info("[ComfyUpload] 转发上传到 ComfyUI: %s", upload_url)

            response = upload_file(
                upload_url,
                unique_filename,
                content,
                content_type or "image/png",
                timeout=30,
            )

            if response.ok:
                comfyui_filename = _extract_uploaded_filename(response, unique_filename)
                logger.info("✅ ComfyUI 图片上传成功: comfyui_filename=%s, server=%s", comfyui_filename, target_server)
            else:
                logger.warning("[ComfyUpload] 上传到 ComfyUI 失败(非致命): %s %s", response.status_code, response.text)
        except Exception as exc:
            logger.warning("[ComfyUpload] ComfyUI上传异常(非致命): %s", exc)
    else:
        logger.info("[ComfyUpload] 无可用ComfyUI节点，仅使用本地存储")

    record_result = await create_comfyui_upload_record(
        username=username,
        file_type="image",
        file_name=safe_filename,
        file_path=local_file_path,
        file_url=local_storage_url,
        file_size_bytes=len(content),
        mime_type=content_type or "image/*",
        metadata={
            "source": "comfyui_upload",
            "logical_id": logical_id,
            "comfyui_filename": comfyui_filename,
            "comfyui_server": target_server,
            "comfyui_node_id": comfyui_node_id,
            "uploaded_at": utc_now_provider().isoformat(),
        },
        file_dao=file_dao,
        project_dao=project_dao,
        version_dao=version_dao,
        logger=logger,
        redis_client=redis_client,
        redis_comfyui_filename=comfyui_filename,
        attach_default_version=attach_default_version,
        uuid_hex_provider=uuid_hex_provider,
    )
    file_record = record_result.file_record

    logger.info("✅ 图片记录已写入 SQL: file_id=%s, comfyui_filename=%s", file_record["file_id"], comfyui_filename)

    return {
        "success": True,
        "filename": comfyui_filename,
        "original_filename": safe_filename,
        "size": len(content),
        "storage_url": record_result.download_url,
        "file_id": file_record["file_id"],
        "file_path": local_file_path,
        "comfyui_server": target_server,
        "comfyui_node_id": comfyui_node_id,
    }


def upload_audio_file_to_comfyui(
    *,
    username: str,
    original_filename: str,
    content: bytes,
    content_type: str,
    start_time: float,
    duration: float,
    target_server: str,
    logger: Any,
    storage_root: Path = Path("persistent_storage"),
    now_provider: Callable[[], datetime] = datetime.now,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    upload_file: Callable[..., requests.Response] = upload_comfyui_file_response,
) -> Dict[str, Any]:
    """Upload audio to ComfyUI and keep a best-effort local backup."""

    safe_filename = original_filename or "audio.mp3"
    unique_filename = f"{uuid_hex_provider()[:12]}_{safe_filename}"
    upload_url = f"{target_server}/upload/image"
    logger.info("[ComfyUploadAudio] 转发上传到 ComfyUI: %s", upload_url)

    response = upload_file(
        upload_url,
        unique_filename,
        content,
        content_type or "audio/mpeg",
        timeout=60,
    )

    if not response.ok:
        logger.error("[ComfyUploadAudio] 上传到 ComfyUI 失败: %s %s", response.status_code, response.text)
        raise ComfyUIMediaUploadFailed(f"上传到处理节点失败: {response.status_code}", status_code=response.status_code)

    comfyui_filename = _extract_uploaded_filename(response, unique_filename)
    logger.info(
        "✅ ComfyUI 音频上传成功: comfyui_filename=%s, 原始名=%s, server=%s",
        comfyui_filename,
        safe_filename,
        target_server,
    )

    try:
        year_month = now_provider().strftime("%Y%m")
        backup_dir = storage_root / "audio" / username / year_month
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / comfyui_filename
        backup_path.write_bytes(content)
        logger.info("💾 音频本地备份: %s", backup_path)
    except Exception as exc:
        logger.warning("⚠️ 音频本地备份失败（不影响上传）: %s", exc)

    return ComfyUIAudioUploadResult(
        filename=comfyui_filename,
        original_filename=safe_filename,
        size=len(content),
        server=target_server,
        start_time=start_time,
        duration=duration,
    ).as_response()


async def upload_video_file_to_comfyui(
    *,
    username: str,
    original_filename: str,
    content: bytes,
    content_type: str,
    target_server: str,
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    storage_root: Path = Path("persistent_storage"),
    now_provider: Callable[[], datetime] = datetime.now,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    upload_file: Callable[..., requests.Response] = upload_comfyui_file_response,
) -> Dict[str, Any]:
    """Upload a video to ComfyUI, persist a local copy, and create a file record."""

    safe_filename = original_filename or "video.mp4"
    unique_filename = f"{uuid_hex_provider()[:12]}_{safe_filename}"
    upload_url = f"{target_server}/upload/image"
    logger.info("[ComfyUploadVideo] 转发上传到 ComfyUI: %s", upload_url)

    response = upload_file(
        upload_url,
        unique_filename,
        content,
        content_type or "video/mp4",
        timeout=60,
    )

    if not response.ok:
        logger.error("[ComfyUploadVideo] 上传到 ComfyUI 失败: %s %s", response.status_code, response.text)
        raise ComfyUIMediaUploadFailed(f"上传到处理节点失败: {response.status_code}", status_code=response.status_code)

    comfyui_filename = _extract_uploaded_filename(response, unique_filename)
    logger.info("✅ ComfyUI 视频上传成功: comfyui_filename=%s, server=%s", comfyui_filename, target_server)

    year_month = now_provider().strftime("%Y%m")
    storage_dir = storage_root / "videos" / username / year_month
    storage_dir.mkdir(parents=True, exist_ok=True)
    file_path = storage_dir / unique_filename
    file_path.write_bytes(content)

    record_result = await create_comfyui_upload_record(
        username=username,
        file_type="video",
        file_name=safe_filename,
        file_path=str(file_path),
        file_size_bytes=len(content),
        mime_type=content_type or "video/*",
        metadata={"source": "upload", "physical_filename": unique_filename},
        file_dao=file_dao,
        project_dao=project_dao,
        version_dao=version_dao,
        logger=logger,
        uuid_hex_provider=uuid_hex_provider,
    )
    file_record = record_result.file_record

    logger.info("✅ 视频已保存到数据库: %s, 文件ID: %s", file_record["file_url"], file_record["file_id"])

    return {
        "success": True,
        "filename": comfyui_filename,
        "unique_filename": unique_filename,
        "storage_url": file_record["file_url"],
        "original_filename": safe_filename,
        "size": len(content),
        "file_id": file_record["file_id"],
        "file_path": str(file_path),
        "server": target_server,
    }


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
        f"无法找到视频文件: {filename}。已尝试持久化存储和处理节点的 "
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
