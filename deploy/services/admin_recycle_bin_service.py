"""Admin recycle-bin service for soft-deleted files."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from dao.admin.recycle_bin import AdminRecycleBinDAO


DEPLOY_ROOT = Path(__file__).resolve().parents[1]
PURGE_ROOT = DEPLOY_ROOT / "persistent_storage"


class RecycleBinNotFound(RuntimeError):
    pass


class RecycleBinRiskNotAcknowledged(RuntimeError):
    pass


class RecycleBinUnsafePath(RuntimeError):
    pass


def _jsonable_file(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    for key in ("created_at", "updated_at", "deleted_at"):
        value = out.get(key)
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
    return out


def _resolve_purge_path(file_path: Optional[str]) -> Optional[Path]:
    if not file_path:
        return None
    candidate = Path(file_path)
    if not candidate.is_absolute():
        candidate = DEPLOY_ROOT / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(PURGE_ROOT.resolve())
    except ValueError as exc:
        raise RecycleBinUnsafePath(f"Refusing to purge path outside persistent_storage: {resolved}") from exc
    return resolved


def _attach_disk_state(row: Dict[str, Any]) -> Dict[str, Any]:
    item = _jsonable_file(row)
    try:
        path = _resolve_purge_path(item.get("file_path"))
    except RecycleBinUnsafePath:
        item["disk_exists"] = False
        item["purge_eligible"] = False
        item["purge_blocked_reason"] = "unsafe_path"
        return item

    item["purge_eligible"] = bool(path)
    item["disk_path"] = str(path) if path else ""
    if path and path.exists() and path.is_file():
        item["disk_exists"] = True
        item["disk_size_bytes"] = path.stat().st_size
    else:
        item["disk_exists"] = False
        item["disk_size_bytes"] = 0
    return item


async def list_recycle_bin_files(
    *,
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    file_type: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    result = await AdminRecycleBinDAO.list_deleted_files(
        user_id=user_id,
        project_id=project_id,
        file_type=file_type,
        keyword=keyword,
        limit=max(1, min(int(limit or 50), 200)),
        offset=max(0, int(offset or 0)),
    )
    items = [_attach_disk_state(row) for row in result.get("items", [])]
    return {
        "success": True,
        "items": items,
        "total": result.get("total", 0),
        "limit": limit,
        "offset": offset,
        "disk_bytes": sum(int(item.get("disk_size_bytes") or 0) for item in items),
    }


async def restore_recycle_bin_file(file_id: str) -> Dict[str, Any]:
    row = await AdminRecycleBinDAO.restore_file(file_id)
    if not row:
        raise RecycleBinNotFound("Deleted file not found")
    return {"success": True, "file": _attach_disk_state(row)}


async def purge_recycle_bin_file(
    file_id: str,
    *,
    risk_ack: bool,
    delete_db_record: bool = True,
) -> Dict[str, Any]:
    if not risk_ack:
        raise RecycleBinRiskNotAcknowledged("risk_ack is required")

    row = await AdminRecycleBinDAO.get_file_any(file_id)
    if not row or row.get("is_deleted") is not True:
        raise RecycleBinNotFound("Deleted file not found")

    path = _resolve_purge_path(row.get("file_path"))
    disk_exists = bool(path and path.exists() and path.is_file())
    freed_bytes = int(path.stat().st_size) if disk_exists and path else 0
    removed_disk = False
    disk_error: Optional[str] = None
    if disk_exists and path:
        try:
            os.remove(path)
            removed_disk = True
        except OSError as exc:
            disk_error = str(exc)
            await AdminRecycleBinDAO.mark_file_purge_failed(file_id, disk_error)

    if disk_error:
        return {
            "success": False,
            "file_id": file_id,
            "removed_disk": False,
            "deleted_db_record": False,
            "freed_bytes": 0,
            "error": disk_error,
        }

    await AdminRecycleBinDAO.clear_legacy_references(str(row.get("file_url") or ""))
    deleted_db_record = False
    if delete_db_record:
        deleted_db_record = await AdminRecycleBinDAO.delete_file_record(file_id)

    return {
        "success": True,
        "file_id": file_id,
        "removed_disk": removed_disk,
        "deleted_db_record": deleted_db_record,
        "freed_bytes": freed_bytes,
        "disk_existed": disk_exists,
    }


async def purge_recycle_bin_files(
    file_ids: List[str],
    *,
    risk_ack: bool,
    delete_db_record: bool = True,
) -> Dict[str, Any]:
    if not risk_ack:
        raise RecycleBinRiskNotAcknowledged("risk_ack is required")
    unique_ids = [file_id for file_id in dict.fromkeys(file_ids or []) if file_id]
    if len(unique_ids) > 200:
        raise ValueError("Batch purge accepts at most 200 files")

    results = []
    freed_bytes = 0
    purged = 0
    errors = []
    for file_id in unique_ids:
        try:
            result = await purge_recycle_bin_file(
                file_id,
                risk_ack=True,
                delete_db_record=delete_db_record,
            )
            results.append(result)
            if result.get("success"):
                purged += 1
                freed_bytes += int(result.get("freed_bytes") or 0)
            else:
                errors.append({"file_id": file_id, "error": result.get("error")})
        except Exception as exc:
            errors.append({"file_id": file_id, "error": str(exc)})
    return {
        "success": not errors,
        "requested": len(unique_ids),
        "purged": purged,
        "freed_bytes": freed_bytes,
        "errors": errors,
        "results": results,
    }
