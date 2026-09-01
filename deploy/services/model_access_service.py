"""Account-level model access policy shared by every generation path."""
from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Set

from fastapi import HTTPException


ACCESS_INHERIT = "inherit"
ACCESS_RESTRICTED = "restricted"
ACCESS_BLOCKED = "blocked"
VALID_ACCESS_MODES = {ACCESS_INHERIT, ACCESS_RESTRICTED, ACCESS_BLOCKED}


def _model_key(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def normalize_model_access_permissions(raw: Any) -> Dict[str, Any]:
    """Normalize legacy permission JSON without changing existing accounts.

    Historical rows stored only ``allowedModels``. An empty or missing list did
    not actually restrict generation, so it must mean ``inherit``. A non-empty
    legacy list keeps its intended meaning and becomes ``restricted``.
    """
    source = raw if isinstance(raw, dict) else {}
    allowed = source.get("allowedModels")
    if not isinstance(allowed, list):
        allowed = source.get("allowed_models")
    allowed_models = [str(item).strip() for item in (allowed or []) if str(item).strip()]

    requested_mode = str(source.get("accessMode") or source.get("access_mode") or "").strip().lower()
    if requested_mode not in VALID_ACCESS_MODES:
        requested_mode = ACCESS_RESTRICTED if allowed_models else ACCESS_INHERIT

    return {
        "accessMode": requested_mode,
        "allowedModels": allowed_models,
        "priority": str(source.get("priority") or "normal"),
        "canExport": bool(
            source.get("canExport")
            if source.get("canExport") is not None
            else source.get("can_export", True)
        ),
    }


def validate_model_access_permissions(raw: Any) -> Dict[str, Any]:
    normalized = normalize_model_access_permissions(raw)
    mode = normalized["accessMode"]
    if mode == ACCESS_RESTRICTED and not normalized["allowedModels"]:
        raise ValueError("restricted 模式至少需要选择一个模型")
    return normalized


def _candidate_model_keys(
    *,
    model: Optional[str],
    task_type: Optional[str],
    task_data: Optional[Dict[str, Any]],
) -> Set[str]:
    data = task_data or {}
    candidates = {
        _model_key(model),
        _model_key(task_type),
        _model_key(data.get("model")),
        _model_key(data.get("model_name")),
        _model_key(data.get("sub_model")),
        _model_key(data.get("provider")),
        _model_key(data.get("workflow_type")),
        _model_key(data.get("requested_workflow_type")),
    }
    candidates.discard("")
    expanded = set(candidates)
    for value in tuple(candidates):
        expanded.update(part for part in value.split("-") if part)
    return expanded


def _is_allowed(allowed_models: Iterable[str], candidates: Set[str]) -> bool:
    allowed = {_model_key(item) for item in allowed_models if _model_key(item)}
    for item in allowed:
        if item in candidates:
            return True
        if any(item.startswith(candidate + "-") or candidate.startswith(item + "-") for candidate in candidates):
            return True
    return False


async def require_user_model_access(
    user_id: str,
    *,
    user_dao: Any,
    model: Optional[str] = None,
    task_type: Optional[str] = None,
    task_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    permissions = normalize_model_access_permissions(await user_dao.get_user_permissions(user_id))
    mode = permissions["accessMode"]
    if mode == ACCESS_BLOCKED:
        raise HTTPException(status_code=403, detail="该账号已被禁止使用生成模型")
    if mode == ACCESS_RESTRICTED:
        candidates = _candidate_model_keys(model=model, task_type=task_type, task_data=task_data)
        if not _is_allowed(permissions["allowedModels"], candidates):
            raise HTTPException(status_code=403, detail="该账号无权使用当前模型")
    return permissions
