"""
任务提交服务 — 统一封装任务准备、创建、入队
所有运行模式下都初始化（包括 AGENT_ONLY_MODE）
"""
import uuid
import logging
import re
from pathlib import Path
from typing import Optional
from datetime import datetime
from urllib.parse import urlparse

from fastapi import HTTPException

from task_queue import TaskQueue, Task

logger = logging.getLogger(__name__)

_service: Optional['TaskService'] = None


MIME_EXTENSION_MAP = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}

DISPLAY_ONLY_FILE_REF_RE = re.compile(r"^(?:storyboard_\d+\.[A-Za-z0-9]+|placeholder_\d+|空卡片)$", re.IGNORECASE)


def _file_type_for_agent_param(param: str) -> str:
    if param == "video_filename":
        return "video"
    if param == "audio_filename":
        return "audio"
    return "image"


def _default_extension_for_file_type(file_type: str) -> str:
    return {"video": ".mp4", "audio": ".mp3"}.get(file_type, ".png")


def _extract_file_id(ref: str) -> Optional[str]:
    if not ref:
        return None
    path = urlparse(ref).path or ref.split("?", 1)[0]
    parts = [part for part in path.split("/") if part]
    if len(parts) >= 3 and parts[0] == "api" and parts[1] == "files":
        return parts[2]
    basename = Path(path).name
    if basename.startswith("file_") and not Path(basename).suffix:
        return basename
    return None


def _filename_from_file_record(file_record: dict, fallback: str, file_type: str) -> str:
    for key in ("file_path", "file_url"):
        value = file_record.get(key)
        if value:
            name = Path(urlparse(str(value)).path).name
            if Path(name).suffix:
                return name

    file_id = file_record.get("file_id")
    mime_type = (file_record.get("mime_type") or "").split(";", 1)[0].lower()
    ext = MIME_EXTENSION_MAP.get(mime_type)

    original_name = file_record.get("file_name")
    if original_name and Path(str(original_name)).suffix:
        if file_id and ext:
            return f"{file_id}{ext}"
        return Path(str(original_name)).name

    if not ext:
        ext = _default_extension_for_file_type(file_type)
    return f"{file_id or Path(fallback).stem}{ext}"


def _ensure_filename_extension(filename: str, file_type: str) -> str:
    if Path(filename).suffix:
        return filename
    return f"{filename}{_default_extension_for_file_type(file_type)}"


def _ensure_url_extension(url: str, filename: str) -> str:
    path = urlparse(url).path
    if Path(path).suffix:
        return url
    suffix = Path(filename).suffix
    if not suffix:
        return url
    if "?" in url:
        base, query = url.split("?", 1)
        return f"{base}{suffix}?{query}"
    return f"{url}{suffix}"


def _is_display_only_file_ref(ref: str) -> bool:
    value = (ref or "").strip()
    if not value or value.startswith("http") or value.startswith("/"):
        return False
    return bool(DISPLAY_ONLY_FILE_REF_RE.match(value))


def _workflow_executable_node_count(workflow_json) -> int:
    if not isinstance(workflow_json, dict):
        return 0
    return sum(
        1
        for node in workflow_json.values()
        if isinstance(node, dict)
        and node.get("class_type")
        and str(node.get("class_type")).lower() not in {"placeholder_node", "placeholdernode"}
    )


def init(redis_client):
    """应用启动时调用，Redis 连接后、AGENT_ONLY_MODE 判断前"""
    global _service
    _service = TaskService(redis_client)
    logger.info("✅ TaskService 已初始化")


def get() -> 'TaskService':
    """获取 TaskService 单例，未初始化时抛出明确错误"""
    if _service is None:
        raise RuntimeError("TaskService 未初始化，请先调用 task_service.init(redis_client)")
    return _service


def get_queue() -> TaskQueue:
    """快捷方式：获取底层 TaskQueue（用于 get_task / cancel / delete 等查询操作）"""
    return get().queue


class TaskService:
    def __init__(self, redis_client):
        self.queue = TaskQueue(redis_client)
        self.redis = redis_client

    async def submit(
        self,
        task_type: str,
        task_data: dict,
        user_id: str,
        priority: int = 2,
        prepare: bool = True,
    ) -> str:
        """
        提交任务到队列，返回 task_id。

        Args:
            task_type: 工作流类型，如 "qwen_2", "i2i_fj", "panorama_360" 等
            task_data: 任务参数字典（图片路径、提示词、种子等）
            user_id:   触发用户
            priority:  优先级（默认 2）
            prepare:   是否调用 _prepare_for_agent 构建工作流 JSON 和文件下载列表
        """
        task_id = str(uuid.uuid4())

        if prepare:
            await self._prepare_for_agent(task_type, task_data, user_id)

        task = Task(
            task_id=task_id,
            task_type=task_type,
            data=task_data,
            priority=priority,
            user_id=user_id,
        )

        success = await self.queue.enqueue(task)
        if not success:
            raise HTTPException(status_code=500, detail="任务入队失败")

        logger.info(f"✅ 任务已提交: {task_id} (type={task_type}, user={user_id})")
        return task_id

    async def _prepare_for_agent(self, task_type: str, task_data: dict, username: str):
        """
        Pre-build workflow JSON and resolve agent file download URLs.
        搬自 cluster_main.py 的 prepare_task_for_agent 函数。
        """
        try:
            from workflow_handler import get_workflow_handler

            file_params = (
                ["image_path", "image_path_end", "video_filename", "audio_filename"]
                + [f"image_path_{i}" for i in range(1, 7)]
                + [f"image_{s}" for s in ("BK", "HU", "MB")]
            )
            agent_files = []
            for param in file_params:
                resolved = await self._resolve_agent_file(param, task_data.get(param), username)
                if not resolved:
                    continue
                task_data[param] = resolved["filename"]
                agent_files.append(resolved)

            if "image_path" in task_data:
                task_data["uploaded_image"] = task_data["image_path"]
            if "image_path_end" in task_data:
                task_data["uploaded_image_end"] = task_data["image_path_end"]
            for i in range(1, 7):
                src = f"image_path_{i}"
                if src in task_data:
                    task_data[f"uploaded_image_{i}"] = task_data[src]
            for suffix in ("BK", "HU", "MB"):
                src = f"image_{suffix}"
                if src in task_data:
                    task_data[f"uploaded_image_{suffix}"] = task_data[src]

            wh = get_workflow_handler()
            workflow_name = wh.resolve_workflow_name(task_type, task_data)
            workflow_override = await self._load_workflow_template(task_type, workflow_name)
            workflow_json = wh.build_workflow_for_task(
                task_type,
                task_data,
                workflow_override=workflow_override,
            )
            task_data["workflow_json"] = workflow_json
            task_data.setdefault("workflow_name", workflow_name)

            task_data["agent_files"] = agent_files
            logger.info(f"✅ Pre-built workflow for {task_type}, {len(agent_files)} agent files")
        except ValueError as e:
            logger.warning("prepare_task_for_agent rejected %s: %s", task_type, e)
            raise HTTPException(status_code=400, detail=f"任务预处理失败: {e}")
        except Exception as e:
            logger.exception(f"prepare_task_for_agent failed for {task_type}: {e}")
            raise HTTPException(status_code=500, detail=f"任务预处理失败: {e}")

    async def _load_workflow_template(self, task_type: str, workflow_name: str) -> Optional[dict]:
        try:
            from dao_workflow_template import WorkflowTemplateDAO

            get_enabled_by_key = getattr(WorkflowTemplateDAO, "get_enabled_by_key", None)
            if not get_enabled_by_key:
                return None
            seen = set()
            for key in (task_type, workflow_name):
                if not key or key in seen:
                    continue
                seen.add(key)
                row = await get_enabled_by_key(key)
                workflow_json = row.get("workflow_json") if row else None
                node_count = _workflow_executable_node_count(workflow_json)
                if node_count > 0:
                    logger.info("✅ 使用后台工作流模板: %s -> %s (%s nodes)", key, workflow_name, node_count)
                    return workflow_json
                if isinstance(workflow_json, dict) and workflow_json:
                    logger.warning("后台工作流模板不可执行，回退磁盘: %s -> %s", key, workflow_name)
        except Exception as exc:
            logger.warning("加载后台工作流模板失败，回退磁盘工作流 %s: %s", workflow_name, exc)
        return None

    async def resolve_agent_file(self, param: str, file_ref, username: str) -> Optional[dict]:
        """Resolve a stored file reference for download by a GPU Agent."""
        return await self._resolve_agent_file(param, file_ref, username)

    async def _resolve_agent_file(self, param: str, file_ref, username: str) -> Optional[dict]:
        if not file_ref or not isinstance(file_ref, str) or not file_ref.strip():
            return None

        original_ref = file_ref.strip()
        file_type = _file_type_for_agent_param(param)
        file_record = None
        file_id = _extract_file_id(original_ref)

        if file_id:
            try:
                from dao_content import FileDAO

                file_record = await FileDAO.get_file(file_id)
            except Exception as exc:
                logger.warning("Failed to resolve file_id %s for agent transfer: %s", file_id, exc)

        if file_record:
            resolved_file_id = file_record.get("file_id") or file_id
            filename = _filename_from_file_record(file_record, original_ref, file_type)
            return {"param": param, "filename": filename, "url": f"/api/files/{resolved_file_id}/download"}

        if "/" not in original_ref and "\\" not in original_ref:
            try:
                from dao_content import FileDAO

                get_file_by_name = getattr(FileDAO, "get_file_by_name", None)
                if get_file_by_name:
                    file_record = await get_file_by_name(original_ref)
            except Exception as exc:
                logger.warning("Failed to resolve file name %s for agent transfer: %s", original_ref, exc)

        if file_record:
            resolved_file_id = file_record.get("file_id")
            filename = _filename_from_file_record(file_record, original_ref, file_type)
            if resolved_file_id:
                return {"param": param, "filename": filename, "url": f"/api/files/{resolved_file_id}/download"}

        if _is_display_only_file_ref(original_ref):
            raise ValueError(f"{param} 缺少真实存储地址，收到的是展示文件名: {original_ref}")

        if self.redis:
            try:
                mapped_file_id = await self.redis.get(f"comfyui:file:{original_ref}")
                if mapped_file_id:
                    if isinstance(mapped_file_id, bytes):
                        mapped_file_id = mapped_file_id.decode()
                    filename = original_ref
                    try:
                        from dao_content import FileDAO

                        file_record = await FileDAO.get_file(mapped_file_id)
                        if file_record:
                            filename = _filename_from_file_record(file_record, original_ref, file_type)
                    except Exception as exc:
                        logger.warning("Failed to load Redis-mapped file %s: %s", mapped_file_id, exc)
                    return {
                        "param": param,
                        "filename": _ensure_filename_extension(filename, file_type),
                        "url": f"/api/files/{mapped_file_id}/download",
                    }
            except Exception as exc:
                logger.warning("Failed to resolve Redis file mapping for %s: %s", original_ref, exc)

        filename = Path(urlparse(original_ref).path).name or original_ref
        filename = _ensure_filename_extension(filename, file_type)
        if original_ref.startswith("http") or original_ref.startswith("/"):
            download_url = _ensure_url_extension(original_ref, filename)
        else:
            year_month = datetime.now().strftime("%Y%m")
            download_url = f"/storage/{file_type}/{username}/{year_month}/{filename}"
        return {"param": param, "filename": filename, "url": download_url}

