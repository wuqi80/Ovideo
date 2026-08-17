# agent_routes.py
import json
import logging
import re
from typing import Optional, List
from datetime import datetime
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Header, File, UploadFile, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from dao_agent import AgentDAO
from pathlib import Path
from dao_task import TaskDAO
from core.task_types import is_external_api_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])

LEGACY_FILE_DOWNLOAD_RE = re.compile(r"^/api/files/([A-Za-z0-9_-]+)/download/?$")

MIME_MAP = {
    ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
    ".ogg": "audio/ogg", ".opus": "audio/opus", ".m4a": "audio/mp4",
    ".aac": "audio/aac",
}


def save_output_file(content: bytes, task_id: str, filename: str, content_type: str) -> dict:
    """Save file to disk and return entry dict (file_id added later by _persist_to_db)."""
    ext = Path(filename).suffix.lower()
    IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}
    VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}
    AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac"}
    if ext in IMAGE_EXTS:
        category = "images"
    elif ext in VIDEO_EXTS:
        category = "videos"
    elif ext in AUDIO_EXTS:
        category = "audios"
    else:
        major = content_type.split("/")[0] if content_type else "other"
        category = {"image": "images", "video": "videos", "audio": "audios"}.get(major, "others")
    year_month = datetime.now().strftime("%Y%m")
    disk_name = f"{task_id}_{filename}"
    rel_path = f"{category}/{year_month}/{disk_name}"
    full_path = Path("persistent_storage") / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    ext_lower = ext.lower()
    if ext_lower in VIDEO_EXTS:
        file_type = "video"
    elif ext_lower in AUDIO_EXTS:
        file_type = "audio"
    else:
        file_type = "image"
    return {
        "url": f"/storage/{rel_path}",
        "filename": filename,
        "size": len(content),
        "file_type": file_type,
        "file_path": str(full_path),
        "mime_type": MIME_MAP.get(ext_lower, content_type or "application/octet-stream"),
    }


async def _persist_to_db(entries: list, task_id: str, task_data: dict, user_id: str):
    """Save file entries to DB with entity linkage (mirrors worker._save_result_file)."""
    try:
        from dao_content import FileDAO
    except ImportError:
        logger.error("❌ _persist_to_db: dao_content import failed — files will NOT be linked to entities")
        return

    entity_type = task_data.get("entity_type")
    entity_id = task_data.get("entity_id")
    file_role = task_data.get("file_role")

    if not user_id:
        logger.error(f"❌ _persist_to_db: user_id is empty for task {task_id}, skipping DB persist")
        return

    logger.info(f"📦 _persist_to_db: task={task_id}, user={user_id}, entity={entity_type}/{entity_id}, role={file_role}, files={len(entries)}")

    for entry in entries:
        try:
            ft = entry.get("file_type", "image")
            role = file_role or {
                "image": "generated_image",
                "audio": "generated_audio",
            }.get(ft, "video")
            record = await FileDAO.create_file(
                version_id=None,
                user_id=user_id,
                file_type=ft,
                file_name=entry["filename"],
                file_path=entry.get("file_path", ""),
                file_url=entry["url"],
                file_size_bytes=entry["size"],
                mime_type=entry.get("mime_type", ""),
                metadata={"task_id": task_id, "source": "comfyui_agent"},
                entity_type=entity_type,
                entity_id=entity_id,
                file_role=role,
            )
            entry["file_id"] = record["file_id"]
            logger.info(f"✅ Agent file persisted: file_id={record['file_id']}, entity={entity_type}/{entity_id}")

            # Agent-completed tasks persist the canonical entity file directly.
            # Keep legacy URL columns synchronized for compatibility consumers.
            if entity_type and entity_id and role:
                try:
                    from file_service import _sync_legacy_on_file_create

                    await _sync_legacy_on_file_create(
                        entity_type,
                        entity_id,
                        role,
                        entry["url"],
                    )
                except Exception as sync_error:
                    logger.warning(
                        "Agent file legacy URL sync failed for %s/%s/%s: %s",
                        entity_type,
                        entity_id,
                        role,
                        sync_error,
                    )
        except Exception as e:
            logger.error(f"❌ _persist_to_db FAILED for {entry['filename']}: {e}", exc_info=True)


def build_task_result(file_entries: list, duration: float = 0.0) -> dict:
    """Build standardized result dict from file entries."""
    images, videos, audios = [], [], []
    for entry in file_entries:
        fname = entry.get("filename", "").lower()
        if any(fname.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".avi")):
            videos.append(entry)
        elif any(fname.endswith(ext) for ext in (".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac")):
            audios.append(entry)
        else:
            images.append(entry)
    return {
        "images": images,
        "videos": videos,
        "audios": audios,
        "output_files": file_entries,
        "duration": duration,
    }


class RegisterRequest(BaseModel):
    system_info: dict = Field(default_factory=dict)
    comfyui_ports: List[int] = Field(default_factory=list)


class HeartbeatRequest(BaseModel):
    agent_id: str
    comfyui_instances: list = Field(default_factory=list)
    system_info: dict = Field(default_factory=dict)
    current_tasks: int = 0


async def _verify_agent_token(authorization: str = Header(...)) -> dict:
    """Verify Agent token from Authorization header"""
    token = authorization.replace("Bearer ", "").strip()
    agent = await AgentDAO.get_by_token(token)
    if not agent or not agent.get("enabled", True):
        raise HTTPException(status_code=401, detail="Invalid or disabled agent token")
    return agent


def _existing_terminal_task_status(task_hash: dict, db_task: dict | None) -> str:
    status = str(
        (task_hash or {}).get("status")
        or (db_task or {}).get("status")
        or ""
    ).strip().lower()
    return status if status in {"completed", "failed", "cancelled", "timeout"} else ""


def _assert_agent_completion_scope(
    authenticated_agent: dict,
    submitted_agent_id: str,
    task_id: str,
    task_hash: dict,
    db_task: Optional[dict],
) -> str:
    """Require the callback token to own the task claimed by this agent."""
    token_agent_id = str(authenticated_agent.get("agent_id") or "").strip()
    submitted = str(submitted_agent_id or "").strip()
    if not token_agent_id or submitted != token_agent_id:
        raise HTTPException(status_code=403, detail="Agent ID mismatch")

    redis_row = task_hash if isinstance(task_hash, dict) else {}
    database_row = dict(db_task or {})
    if not redis_row and not database_row:
        raise HTTPException(status_code=404, detail="Task not found")

    assigned_agent_id = str(
        redis_row.get("node_id")
        or database_row.get("node_id")
        or ""
    ).strip()
    if not assigned_agent_id:
        raise HTTPException(status_code=409, detail="Task has not been assigned to an agent")
    if assigned_agent_id != token_agent_id:
        logger.warning(
            "agent completion denied: task=%s assigned=%s token_agent=%s",
            task_id,
            assigned_agent_id,
            token_agent_id,
        )
        raise HTTPException(status_code=403, detail="Task is assigned to another agent")
    return token_agent_id


def _preferred_agent_id_from_task_info(task_info: dict) -> str:
    data = task_info.get("data") if isinstance(task_info, dict) else {}
    if not isinstance(data, dict):
        return ""
    for key in ("preferred_agent_id", "target_agent_id"):
        value = data.get(key)
        if value:
            return str(value).strip()
    return ""


def _legacy_file_id_from_download_url(url: str) -> str:
    """Return a file ID only for the authenticated legacy download route."""
    path = urlparse(str(url or "").strip()).path
    match = LEGACY_FILE_DOWNLOAD_RE.fullmatch(path)
    return match.group(1) if match else ""


def _scope_agent_file_download_urls(task_id: str, files: list) -> list:
    """Route task-owned legacy files through the Agent-authenticated endpoint."""
    scoped_files = []
    for raw_file in files or []:
        file_info = dict(raw_file) if isinstance(raw_file, dict) else {}
        file_id = _legacy_file_id_from_download_url(file_info.get("url", ""))
        if file_id:
            file_info["url"] = f"/api/agent/tasks/{task_id}/files/{file_id}"
        scoped_files.append(file_info)
    return scoped_files


def _task_references_legacy_file(task_data: dict, file_id: str) -> bool:
    agent_files = task_data.get("agent_files", []) if isinstance(task_data, dict) else []
    for file_info in agent_files:
        if not isinstance(file_info, dict):
            continue
        if _legacy_file_id_from_download_url(file_info.get("url", "")) == file_id:
            return True
    return False


def _decode_task_hash(raw_hash: dict) -> dict:
    return {
        (key.decode("utf-8") if isinstance(key, bytes) else key):
        (value.decode("utf-8") if isinstance(value, bytes) else value)
        for key, value in (raw_hash or {}).items()
    }


def _task_data_from_rows(task_hash: dict, db_task: Optional[dict]) -> dict:
    raw_data = task_hash.get("data")
    if raw_data:
        try:
            return json.loads(raw_data) if isinstance(raw_data, str) else dict(raw_data)
        except (json.JSONDecodeError, TypeError, ValueError):
            return {}

    raw_data = dict(db_task or {}).get("task_data") or {}
    try:
        return json.loads(raw_data) if isinstance(raw_data, str) else dict(raw_data)
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}


async def _task_info_from_queue_member(redis_client, task_status_prefix: str, raw_member):
    """Load task metadata without removing the queue member."""
    if isinstance(raw_member, bytes):
        raw_member = raw_member.decode("utf-8")

    try:
        parsed = json.loads(raw_member)
        if isinstance(parsed, dict) and parsed.get("task_id"):
            raw_hash = await redis_client.hgetall(
                f"{task_status_prefix}{parsed['task_id']}"
            )
            task_hash = _decode_task_hash(raw_hash)
            if str(task_hash.get("status") or "").lower() in {
                "completed", "failed", "cancelled", "timeout"
            }:
                return None
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass

    task_id = str(raw_member or "").strip()
    if not task_id:
        return None

    raw_hash = await redis_client.hgetall(f"{task_status_prefix}{task_id}")
    if not raw_hash:
        return None
    task_hash = {
        (key.decode("utf-8") if isinstance(key, bytes) else key):
        (value.decode("utf-8") if isinstance(value, bytes) else value)
        for key, value in raw_hash.items()
    }
    try:
        data = json.loads(task_hash.get("data", "{}"))
    except (json.JSONDecodeError, TypeError):
        data = {}
    return {
        "task_id": task_id,
        "task_type": task_hash.get("task_type", "comfyui"),
        "data": data if isinstance(data, dict) else {},
    }


async def _claim_next_agent_task(redis_client, redis_config, agent_id: str, scan_limit: int = 100):
    """Atomically claim a GPU task while leaving external API tasks untouched."""
    members = await redis_client.zrange(
        redis_config.TASK_QUEUE_KEY,
        0,
        max(0, scan_limit - 1),
        withscores=True,
    )
    for raw_member, score in members:
        task_info = await _task_info_from_queue_member(
            redis_client,
            redis_config.TASK_STATUS_PREFIX,
            raw_member,
        )
        if not task_info:
            await redis_client.zrem(redis_config.TASK_QUEUE_KEY, raw_member)
            logger.warning("poll: removed orphan queue member %r", raw_member)
            continue

        task_type = str(task_info.get("task_type") or "")
        if is_external_api_task(task_type):
            continue

        preferred_agent_id = _preferred_agent_id_from_task_info(task_info)
        if preferred_agent_id and preferred_agent_id != str(agent_id):
            continue

        removed = await redis_client.zrem(redis_config.TASK_QUEUE_KEY, raw_member)
        if removed:
            return task_info, raw_member, score
    return None


@router.post("/register")
async def register_agent(request: RegisterRequest, authorization: str = Header(...)):
    token = authorization.replace("Bearer ", "").strip()
    agent = await AgentDAO.get_by_token(token)
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid token")
    instances = [{"port": p, "status": "unknown"} for p in request.comfyui_ports]
    updated = await AgentDAO.update_heartbeat(
        agent["agent_id"], status="online",
        comfyui_instances=instances, system_info=request.system_info
    )
    return {
        "success": True, "agent_id": agent["agent_id"],
        "name": agent["name"],
        "message": f"Registered with {len(request.comfyui_ports)} ComfyUI instances"
    }


@router.post("/heartbeat")
async def agent_heartbeat(request: HeartbeatRequest, authorization: str = Header(...)):
    agent = await _verify_agent_token(authorization)
    if agent["agent_id"] != request.agent_id:
        raise HTTPException(status_code=403, detail="Agent ID mismatch")
    status = "busy" if request.current_tasks > 0 else "online"
    await AgentDAO.update_heartbeat(
        request.agent_id, status=status,
        comfyui_instances=request.comfyui_instances,
        system_info=request.system_info
    )
    return {"success": True, "status": status}


@router.get("/poll")
async def agent_poll(authorization: str = Header(...)):
    """Agent pulls a pending task from the Redis queue"""
    agent = await _verify_agent_token(authorization)
    
    # Get redis_client from cluster_main (lazy import to avoid circular)
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
    except ImportError:
        logger.warning("poll: ImportError - cluster_main/cluster_config not available")
        return {"task": None}
    
    if not redis_client:
        logger.warning("poll: redis_client is None")
        return {"task": None}

    queue_len = await redis_client.zcard(RedisConfig.TASK_QUEUE_KEY)
    logger.info(f"poll: agent={agent['agent_id']}, queue_len={queue_len}, key={RedisConfig.TASK_QUEUE_KEY}")

    claimed = await _claim_next_agent_task(
        redis_client,
        RedisConfig,
        str(agent["agent_id"]),
    )
    logger.info("poll: claimed=%s", claimed[:1] if claimed else None)
    if not claimed:
        return {"task": None}
    task_info, claimed_member, claimed_score = claimed
    members = [(claimed_member, claimed_score)]

    raw_member = members[0][0] if isinstance(members[0], (list, tuple)) else members[0]
    if not raw_member:
        return {"task": None}
    if isinstance(raw_member, bytes):
        raw_member = raw_member.decode("utf-8")

    # Determine format: JSON dict (SmartApiRouter) or plain task_id (TaskQueue)
    task_info = None
    try:
        parsed = json.loads(raw_member)
        if isinstance(parsed, dict) and "task_id" in parsed:
            task_info = parsed
    except (json.JSONDecodeError, TypeError):
        pass

    if task_info is None:
        # raw_member is a plain task_id — load full task from Redis hash
        task_id_str = raw_member
        hash_key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id_str}"
        raw_hash = await redis_client.hgetall(hash_key)
        if not raw_hash:
            logger.warning(f"No Redis hash found for task {task_id_str}")
            return {"task": None}
        task_hash = {
            (k.decode("utf-8") if isinstance(k, bytes) else k):
            (v.decode("utf-8") if isinstance(v, bytes) else v)
            for k, v in raw_hash.items()
        }
        data_raw = task_hash.get("data", "{}")
        try:
            data_parsed = json.loads(data_raw)
        except (json.JSONDecodeError, TypeError):
            data_parsed = {}
        task_info = {
            "task_id": task_id_str,
            "task_type": task_hash.get("task_type", "comfyui"),
            "data": data_parsed,
        }

    preferred_agent_id = _preferred_agent_id_from_task_info(task_info)
    if preferred_agent_id and preferred_agent_id != str(agent["agent_id"]):
        score = members[0][1] if isinstance(members[0], (list, tuple)) and len(members[0]) > 1 else 0
        retry_score = max(float(score) + 0.001, datetime.now().timestamp())
        await redis_client.zadd(RedisConfig.TASK_QUEUE_KEY, {raw_member: retry_score})
        logger.info(
            "poll: task=%s pinned to %s, current agent=%s, requeued with score=%s",
            task_info.get("task_id"),
            preferred_agent_id,
            agent["agent_id"],
            retry_score,
        )
        return {"task": None}

    task_id = task_info.get("task_id")

    try:
        await TaskDAO.update_task_status(task_id, "processing", node_id=agent["agent_id"])
    except Exception as e:
        logger.warning(f"DB status update failed for {task_id} (non-fatal): {e}")

    # Update Redis task status hash
    key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
    await redis_client.hset(key, mapping={
        "status": "processing",
        "node_id": agent["agent_id"],
        "started_at": datetime.now().isoformat()
    })

    # Build file download list from task params
    data = task_info.get("data", {})
    files_to_download = []
    if "agent_files" in data:
        files_to_download = data["agent_files"]
    else:
        for param_key in ("image", "image_end", "video"):
            val = data.get(param_key)
            if val and isinstance(val, str) and (val.startswith("http") or val.startswith("/")):
                files_to_download.append({"param": param_key, "url": val})
    files_to_download = _scope_agent_file_download_urls(task_id, files_to_download)

    return {
        "task": {
            "task_id": task_id,
            "task_type": task_info.get("task_type", "comfyui"),
            "workflow_name": data.get("workflow_name", ""),
            "workflow_json": data.get("workflow_json"),
            "params": data,
            "files": files_to_download,
        }
    }


@router.get("/tasks/{task_id}/files/{file_id}")
async def agent_download_task_file(
    task_id: str,
    file_id: str,
    authorization: str = Header(...),
):
    """Download one input file that belongs to the task claimed by this Agent."""
    agent = await _verify_agent_token(authorization)
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Task storage is unavailable") from exc

    raw_hash = (
        await redis_client.hgetall(f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}")
        if redis_client
        else {}
    )
    task_hash = _decode_task_hash(raw_hash)
    db_task = await TaskDAO.get_task(task_id)
    _assert_agent_completion_scope(
        agent,
        str(agent.get("agent_id") or ""),
        task_id,
        task_hash,
        db_task,
    )

    task_data = _task_data_from_rows(task_hash, db_task)
    if not _task_references_legacy_file(task_data, file_id):
        raise HTTPException(status_code=404, detail="Task input file not found")

    user_id = str(task_hash.get("user_id") or dict(db_task or {}).get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=409, detail="Task input owner is unavailable")

    from dao_content import FileDAO
    from services.legacy_file_service import LegacyFileNotFound, get_legacy_download_info

    try:
        download = await get_legacy_download_info(
            file_id=file_id,
            range_header=None,
            identity=user_id,
            deploy_root=Path(__file__).resolve().parent,
            file_dao=FileDAO,
            logger=logger,
        )
    except LegacyFileNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return FileResponse(
        path=download.file_path,
        media_type=download.mime_type,
        filename=download.filename,
    )


@router.get("/debug-queue")
async def debug_queue(authorization: str = Header(...)):
    """Read-only view of Redis task queue status (no consumption)"""
    await _verify_agent_token(authorization)
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
    except ImportError:
        return {"error": "Cannot import cluster_main"}

    if not redis_client:
        return {"error": "redis_client is None"}

    queue_len = await redis_client.zcard(RedisConfig.TASK_QUEUE_KEY)
    members = await redis_client.zrange(
        RedisConfig.TASK_QUEUE_KEY, 0, 4, withscores=True
    )
    return {
        "queue_length": queue_len,
        "top_5": [{"task_id": m, "score": s} for m, s in members],
        "redis_info": str(redis_client.connection_pool),
    }


@router.post("/complete")
async def agent_complete(
    task_id: str = Form(...),
    agent_id: str = Form(...),
    status: str = Form("completed"),
    duration: float = Form(0.0),
    error_message: str = Form(""),
    result_json: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    authorization: str = Header(...)
):
    agent = await _verify_agent_token(authorization)
    normalized_status = str(status or "").strip().lower()
    if normalized_status not in {"completed", "failed"}:
        raise HTTPException(status_code=400, detail="Unsupported agent completion status")
    status = normalized_status

    # ---- 0. Retrieve task data from Redis for entity fields ----
    task_data: dict = {}
    user_id: str = ""
    task_hash: dict = {}
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
        key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
        task_hash = await redis_client.hgetall(key)
        user_id = task_hash.get("user_id", "")
        raw_data = task_hash.get("data", "{}")
        task_data = json.loads(raw_data) if raw_data else {}
    except Exception as e:
        logger.warning(f"Failed to retrieve task data for {task_id}: {e}")

    db_task = None
    try:
        db_row = await TaskDAO.get_task_by_task_id(task_id)
        db_task = dict(db_row) if db_row else None
    except Exception as e:
        logger.warning("Failed to retrieve DB task assignment for %s: %s", task_id, e)

    _assert_agent_completion_scope(agent, agent_id, task_id, task_hash, db_task)

    existing_status = _existing_terminal_task_status(task_hash, db_task)
    if existing_status:
        logger.info(
            "agent_complete: task=%s already terminal (%s), acknowledging retry",
            task_id,
            existing_status,
        )
        return {
            "success": True,
            "task_id": task_id,
            "files_saved": 0,
            "already_terminal": True,
            "status": existing_status,
        }

    if not user_id and db_task:
        user_id = str(db_task.get("user_id") or "")
    if not task_data and db_task:
        raw_db_data = db_task.get("task_data") or {}
        if isinstance(raw_db_data, str):
            try:
                raw_db_data = json.loads(raw_db_data)
            except (json.JSONDecodeError, TypeError):
                raw_db_data = {}
        task_data = raw_db_data if isinstance(raw_db_data, dict) else {}

    # ---- 1. Save files to disk ----
    file_entries = []
    seen_filenames = set()
    for f in files:
        content = await f.read()
        if not content:
            continue
        original_name = f.filename or "output"
        if original_name in seen_filenames:
            continue
        seen_filenames.add(original_name)
        entry = save_output_file(content, task_id, original_name,
                                 f.content_type or "application/octet-stream")
        file_entries.append(entry)

    # ---- 1b. Persist to DB with entity linkage ----
    if file_entries and status == "completed":
        await _persist_to_db(file_entries, task_id, task_data, user_id)

    result = build_task_result(file_entries, duration) if file_entries else None
    result_payload = None
    if result_json:
        try:
            result_payload = json.loads(result_json)
        except Exception as e:
            logger.warning(f"agent_complete: invalid result_json for {task_id}: {e}")
    if result_payload:
        if result:
            result.update(result_payload)
        else:
            result = result_payload
    logger.info(f"agent_complete: task={task_id}, status={status}, files={len(file_entries)}")

    # ---- 2. Update Redis (critical path — unblocks frontend) ----
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
        key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
        update_data = {
            "status": status,
            "completed_at": datetime.now().isoformat(),
        }
        if result:
            update_data["result"] = json.dumps(result)
        if error_message:
            update_data["error"] = error_message
        await redis_client.hset(key, mapping=update_data)
        logger.info(f"agent_complete: Redis updated for {task_id}")

        if status == "completed" and result:
            try:
                if not user_id:
                    refreshed = await redis_client.hgetall(key)
                    user_id = refreshed.get("user_id", "")
                if user_id:
                    task_type = task_data.get("task_type", task_hash.get("task_type", ""))
                    display_name = task_hash.get("display_name", task_type)
                    await redis_client.publish(f"task_complete:{user_id}", json.dumps({
                        "type": "task_complete",
                        "task_id": task_id,
                        "status": status,
                        "task_type": task_type,
                        "display_name": display_name,
                        "entity_type": task_data.get("entity_type", ""),
                        "entity_id": task_data.get("entity_id", ""),
                        "file_role": task_data.get("file_role", ""),
                        "episode_id": task_data.get("episode_id", ""),
                    }))
            except Exception:
                pass
    except Exception as e:
        logger.error(f"CRITICAL: Redis update failed for {task_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update task status in Redis")

    # ---- 3. Update DB best-effort ----
    try:
        await TaskDAO.update_task_status(
            task_id, status,
            result_data=result,
            error_message=error_message or None,
        )
        logger.info(f"agent_complete: DB updated for {task_id}")
    except Exception as e:
        logger.warning(f"DB update failed for {task_id} (non-fatal): {e}")

    return {"success": True, "task_id": task_id, "files_saved": len(file_entries)}
