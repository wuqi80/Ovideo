# -*- coding: utf-8 -*-
"""
Admin panel CRUD API — agents, workflows, API configs, settings, dashboard.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from admin_api_config_routes import (
    ApiConfigBatchTestBody,
    ApiConfigCreateBody,
    ApiConfigHealthSweepBody,
    ApiConfigImportPresetsBody,
    ApiConfigRepairConflictsBody,
    ApiConfigUpdateBody,
    admin_check_provider_health,
    admin_create_api_config,
    admin_delete_api_config,
    admin_get_presets,
    admin_import_preset_configs,
    admin_list_api_configs,
    admin_reload_api_env,
    admin_repair_api_config_conflicts,
    admin_sweep_provider_health,
    admin_test_all_api_configs,
    admin_test_api_config,
    admin_update_api_config,
    router as api_config_router,
)
from admin_recycle_bin_routes import router as recycle_bin_router
from dao_agent import AgentDAO
from dao_system_settings import SystemSettingsDAO
from dao_task import TaskDAO
from dao_workflow_template import WorkflowTemplateDAO
from db_manager import get_db_manager

logger = logging.getLogger(__name__)


# ============================================
# 2026-05-26 Slice 4/5 收尾：管理员鉴权依赖
# 详见 docs/superpowers/plans/2026-05-26-feature-rollout/04-admin-users-project-groups.md §Permission
# ============================================
async def require_admin(request: Request) -> str:
    """
    依赖：所有 /api/admin/* 接口必须由 users.role ∈ {'admin','super_admin'} 触发。
    返回当前管理员 username（已校验）；失败抛 401/403。
    """
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权")
    import jwt_auth
    username = jwt_auth.verify_token(auth[7:])
    if not username:
        raise HTTPException(status_code=401, detail="Token 已失效或不存在")
    # 取用户 role
    try:
        from dao_user import UserDAO
        user = await UserDAO.get_user_by_username(username)
    except Exception as e:
        logger.error(f"require_admin: 查询用户失败 username={username} err={e}")
        raise HTTPException(status_code=500, detail="鉴权查询失败")
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    # 兼容旧库未 ALTER：默认 'user'
    role = (user.get('role') if isinstance(user, dict) else None) or 'user'
    if role not in ('admin', 'super_admin'):
        # 初次部署兜底：用户行是首次登录时懒创建的，role 列默认 'user'。
        # 内置管理员账号（admin / 超级管理员 lllsdhr）即便 role 尚未提升，也允许进入后台，
        # 保证开箱即用（登录密码本身才是安全边界）。可用 MY2_ADMIN_USERNAMES 追加白名单。
        # 详见 docs/superpowers/plans/2026-05-26-feature-rollout/04-admin-users-project-groups.md
        import os as _os
        allowed = {'admin'}
        boot = (_os.environ.get('MY2_ADMIN_USERNAMES') or '').strip()
        if boot:
            allowed |= {s.strip() for s in boot.split(',') if s.strip()}
        if username in allowed:
            return username
        raise HTTPException(status_code=403, detail=f"需要管理员权限（当前角色：{role}）")
    return username


# 安全(C3)：全部 /api/admin/* 强制 require_admin。
# 原先为兼容旧 /admin/app.js 控制台「无 JWT」而不挂全局鉴权，导致 POST /agents 造 token、
# api-configs 增删改等公网无鉴权可调（严重漏洞）。现旧控制台 app.js 已改为携带 admin JWT
# （读同源 iframe 共享的 sessionStorage.admin_session_token），故可安全挂全局鉴权。
router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])

_WORKFLOW_CATEGORY_MAP = {
    "image_upload": "image",
    "qwen": "image",
    "i2i": "image",
    "kontext": "image",
    "wan2": "video",
    "minimax": "video",
    "sora2": "video",
    "veo": "video",
    "dashscope": "video",
    "morph": "video",
    "infinitetalk": "video",
    "voice": "video",
    "upscale": "upscale",
    "remove_watermark": "tool",
    "matting": "tool",
    "panorama": "tool",
    "three_view": "tool",
    "storyboard": "tool",
    "pose": "tool",
    "transfer": "tool",
    "fusion": "tool",
}
_WORKFLOW_PLACEHOLDER_RE = re.compile(r"^\{([A-Za-z0-9_]+)\}$")


def _require_db() -> None:
    if not get_db_manager():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )


def _sync_workflow_to_disk(workflow_key: str, workflow_json: dict):
    """将工作流 JSON 写回 workflows/ 目录的磁盘文件"""
    if not workflow_key:
        return
    wf_dir = Path(__file__).resolve().parent / "workflows"
    wf_dir.mkdir(exist_ok=True)
    file_path = wf_dir / f"{workflow_key}.json"
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(workflow_json, f, ensure_ascii=False, indent=2)
        logger.info(f"✅ 工作流已写回磁盘: {file_path.name}")
    except OSError as e:
        logger.error(f"❌ 写回磁盘失败 {file_path}: {e}")


def _reload_workflow_cache():
    """重新加载所有工作流到内存缓存"""
    try:
        from workflow_handler import get_workflow_handler
        handler = get_workflow_handler()
        handler.load_workflows()
        logger.info(f"🔄 工作流缓存已重载，共 {len(handler.workflows)} 个")
    except Exception as e:
        logger.warning(f"⚠️ 重载工作流缓存失败: {e}")


def _delete_workflow_from_disk(workflow_key: str):
    """从磁盘删除工作流 JSON 文件"""
    if not workflow_key:
        return
    wf_dir = Path(__file__).resolve().parent / "workflows"
    file_path = wf_dir / f"{workflow_key}.json"
    if file_path.is_file():
        try:
            file_path.unlink()
            logger.info(f"🗑️ 已删除磁盘工作流: {file_path.name}")
        except OSError as e:
            logger.warning(f"⚠️ 删除磁盘文件失败 {file_path}: {e}")


def _jsonb_to_python(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            return val
    return val


def _parse_comfyui_instances(val: Any) -> List[Dict[str, Any]]:
    parsed = _jsonb_to_python(val)
    if isinstance(parsed, list):
        return [x for x in parsed if isinstance(x, dict)]
    return []


def _row_to_jsonable(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    d = dict(row)
    out: Dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        elif k in (
            "workflow_json",
            "placeholders",
            "params",
            "result",
            "stats",
            "system_info",
            "comfyui_instances",
            "request_template",
            "headers",
            "permissions",
        ):
            out[k] = _jsonb_to_python(v)
        else:
            out[k] = v
    return out


# 2026-05-26：admin 用户列表 / 详情的前端期望形状（camelCase + permissions 兜底 + stats stub）。
# 历史 AdminPage 走的是 generateLocalUsers() 的本地兜底数据，从未真正消费后端原始 snake_case；
# 把 AdminPage 提为独立 /admin 路由后第一次走 API，没人 normalize → 前端 `user.permissions.allowedModels` 崩溃。
_DEFAULT_USER_PERMISSIONS = {
    "allowedModels": [],
    "priority": "normal",
    "canExport": True,
}


def _normalize_admin_user(row: Any) -> Dict[str, Any]:
    """把 users 表行转换为 AdminPage 期望的 UserAccount 形状。

    Guarantees (即使数据库列缺失也兜底):
      - id, username, email, role, isActive, isOnline, lastLogin (ms epoch | 0)
      - permissions: { allowedModels: string[], priority: 'low'|'normal'|'high', canExport: bool }
      - stats: { todayCount: 0, totalCount: 0, byModel: {} }  (聚合数据由前端用 logs 计算，这里只占位)
    """
    if row is None:
        return {}
    d = _row_to_jsonable(row)

    raw_perm = d.get("permissions")
    if not isinstance(raw_perm, dict):
        raw_perm = {}
    perm = {
        "allowedModels": list(raw_perm.get("allowedModels") or raw_perm.get("allowed_models") or []),
        "priority": raw_perm.get("priority") or "normal",
        "canExport": bool(raw_perm.get("canExport") if raw_perm.get("canExport") is not None else raw_perm.get("can_export", True)),
    }

    last_login_iso = d.get("last_login_at") or d.get("lastLogin") or None
    last_login_ms = 0
    if isinstance(last_login_iso, str) and last_login_iso:
        try:
            last_login_ms = int(datetime.fromisoformat(last_login_iso).timestamp() * 1000)
        except Exception:
            last_login_ms = 0

    is_active = d.get("is_active")
    if is_active is None:
        # 兼容 status='active'/'disabled' 的新模式
        is_active = (str(d.get("status") or "").lower() != "disabled")

    return {
        "id": d.get("user_id") or d.get("id") or "",
        "username": d.get("username") or "",
        "email": d.get("email") or "",
        "role": d.get("role") or "editor",
        "isActive": bool(is_active),
        # 后端目前没有真实在线状态；用最近登录 5 分钟内作为近似（生产环境可换成 session/SSE 心跳）
        "isOnline": (last_login_ms > 0 and (datetime.utcnow().timestamp() * 1000 - last_login_ms) < 5 * 60 * 1000),
        "lastLogin": last_login_ms,
        "permissions": perm,
        "stats": {"todayCount": 0, "totalCount": 0, "byModel": {}},
        # 透传原始字段（前端可读 raw 字段做扩展，不强制依赖）
        "user_id": d.get("user_id"),
        "status": d.get("status"),
        "avatar_url": d.get("avatar_url"),
        "plan_tier": d.get("plan_tier"),
        "storage_quota_gb": d.get("storage_quota_gb"),
        "used_storage_bytes": d.get("used_storage_bytes"),
        "created_at": d.get("created_at"),
    }


def _instance_healthy(inst: Dict[str, Any]) -> bool:
    s = str(inst.get("status", "")).lower()
    if s in ("error", "offline", "down", "failed", "unhealthy"):
        return False
    return True


def _placeholders_from_workflow_config(cfg: Any) -> List[Dict[str, Any]]:
    raw = list(getattr(cfg, "placeholders", None) or [])
    defaults = getattr(cfg, "default_params", None) or {}
    return _placeholder_objects(raw, defaults)


def _placeholder_objects(raw: List[Any], defaults: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    defaults = defaults or {}
    out: List[Dict[str, Any]] = []
    for p in raw:
        key = str(p)
        out.append(
            {
                "key": key,
                "label": key,
                "type": "text",
                "required": False,
                "default": defaults.get(p, ""),
            }
        )
    return out


def _workflow_category_for(*parts: Any) -> str:
    key = " ".join(str(p or "") for p in parts).lower()
    for prefix, cat in _WORKFLOW_CATEGORY_MAP.items():
        if prefix in key:
            return cat
    return "other"


def _collect_workflow_placeholders(value: Any, out: set[str]) -> None:
    if isinstance(value, str):
        match = _WORKFLOW_PLACEHOLDER_RE.match(value)
        if match:
            out.add(match.group(1))
        return
    if isinstance(value, dict):
        for item in value.values():
            _collect_workflow_placeholders(item, out)
        return
    if isinstance(value, list):
        for item in value:
            _collect_workflow_placeholders(item, out)


def _placeholder_names_from_workflow_json(workflow_json: Dict[str, Any]) -> List[str]:
    names: set[str] = set()
    _collect_workflow_placeholders(workflow_json, names)
    return sorted(names)


def _workflow_executable_node_count(workflow_json: Any) -> int:
    if not isinstance(workflow_json, dict):
        return 0
    return sum(
        1
        for node in workflow_json.values()
        if isinstance(node, dict)
        and node.get("class_type")
        and str(node.get("class_type")).lower() not in {"placeholder_node", "placeholdernode"}
    )


def _workflow_is_executable(workflow_json: Any) -> bool:
    return _workflow_executable_node_count(workflow_json) > 0


# --- Agents ---


class AgentCreateBody(BaseModel):
    name: str = Field(..., min_length=1)


@router.post("/agents", status_code=status.HTTP_201_CREATED)
async def admin_create_agent(body: AgentCreateBody):
    _require_db()
    token = AgentDAO.generate_token()
    row = await AgentDAO.create(body.name.strip(), token)
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create agent")
    agent = _row_to_jsonable(row)
    return {"success": True, "agent": agent, "token": token}


@router.get("/agents")
async def admin_list_agents():
    _require_db()
    rows = await AgentDAO.list_all()
    return {"success": True, "agents": [_row_to_jsonable(r) for r in rows]}


@router.get("/agents/{agent_id}")
async def admin_get_agent(agent_id: str):
    _require_db()
    row = await AgentDAO.get_by_id(agent_id)
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "agent": _row_to_jsonable(row)}


@router.put("/agents/{agent_id}/toggle")
async def admin_toggle_agent(agent_id: str):
    _require_db()
    row = await AgentDAO.get_by_id(agent_id)
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    current = bool(row.get("enabled", True))
    updated = await AgentDAO.set_enabled(agent_id, not current)
    if not updated:
        raise HTTPException(status_code=500, detail="Toggle failed")
    return {"success": True, "agent": _row_to_jsonable(updated)}


@router.delete("/agents/{agent_id}")
async def admin_delete_agent(agent_id: str):
    _require_db()
    ok = await AgentDAO.delete(agent_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "deleted": True}


# --- Workflow templates (static paths before /{template_id}) ---


@router.post("/workflows/parse-json")
async def admin_parse_workflow_json(request: Request):
    """
    Parse ComfyUI workflow JSON from:
    - `application/json`: `{"workflow_json": {...}}` or a workflow object at root
    - `multipart/form-data`: field `file` — uploaded `.json` workflow file
    """
    workflow_dict: Optional[Dict[str, Any]] = None
    content_type = (request.headers.get("content-type") or "").lower()

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if upload is None:
            raise HTTPException(
                status_code=400, detail="Missing form field 'file' for multipart upload"
            )
        read_fn = getattr(upload, "read", None)
        if not callable(read_fn):
            raise HTTPException(status_code=400, detail="Invalid upload")
        raw = await read_fn()
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError) as e:
            raise HTTPException(
                status_code=400, detail=f"Invalid JSON in upload: {e}"
            ) from e
        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=400, detail="Uploaded workflow root must be a JSON object"
            )
        workflow_dict = parsed
    else:
        try:
            data = await request.json()
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail="Invalid JSON body") from e
        if not isinstance(data, dict):
            raise HTTPException(
                status_code=400, detail="JSON body must be an object"
            )
        workflow_dict = data.get("workflow_json", data)

    if not isinstance(workflow_dict, dict):
        raise HTTPException(status_code=400, detail="workflow_json must be an object")

    nodes = WorkflowTemplateDAO.parse_nodes(workflow_dict)
    return {"success": True, "nodes": nodes}


@router.get("/workflows/scan-disk")
async def admin_scan_disk_workflows():
    """Return configured workflows plus disk-only JSON workflows with DB import status."""
    from workflow_config import WORKFLOW_CONFIGS
    wf_dir = Path(__file__).resolve().parent / "workflows"

    _require_db()
    db_templates = await WorkflowTemplateDAO.list_all()
    db_names = {r.get("name", "") for r in db_templates}
    db_keys = {r.get("workflow_key", "") for r in db_templates}

    items: List[Dict[str, Any]] = []
    configured_files: set[str] = set()

    for key, cfg in WORKFLOW_CONFIGS.items():
        name = getattr(cfg, "name", None) or str(key)
        file_name = getattr(cfg, "file", None)
        desc = getattr(cfg, "description", "") or ""
        placeholders = getattr(cfg, "placeholders", []) or []
        has_file = bool(file_name and (wf_dir / file_name).is_file())
        is_api = file_name is None
        workflow_json: Dict[str, Any] = {}
        if has_file:
            try:
                parsed = json.loads((wf_dir / file_name).read_text(encoding="utf-8"))
                if isinstance(parsed, dict):
                    workflow_json = parsed
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("扫描磁盘工作流失败 %s: %s", file_name, exc)
        node_count = _workflow_executable_node_count(workflow_json)
        if file_name:
            configured_files.add(file_name)

        items.append({
            "key": key,
            "name": name,
            "file": file_name,
            "description": desc,
            "placeholders": placeholders,
            "category": _workflow_category_for(key, file_name, name),
            "has_file": has_file,
            "is_api": is_api,
            "node_count": node_count,
            "is_executable": node_count > 0,
            "can_import": bool(has_file and node_count > 0),
            "imported": key in db_keys or name in db_names,
        })

    for path in sorted(wf_dir.glob("*.json"), key=lambda p: p.name.lower()):
        if path.name in configured_files:
            continue
        key = path.stem
        workflow_json: Dict[str, Any] = {}
        placeholders: List[str] = []
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                workflow_json = parsed
                placeholders = _placeholder_names_from_workflow_json(workflow_json)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("扫描磁盘工作流失败 %s: %s", path.name, exc)

        items.append({
            "key": key,
            "name": key,
            "file": path.name,
            "description": f"磁盘工作流文件 {path.name}",
            "placeholders": placeholders,
            "category": _workflow_category_for(key, path.name),
            "has_file": True,
            "is_api": False,
            "node_count": _workflow_executable_node_count(workflow_json),
            "is_executable": _workflow_is_executable(workflow_json),
            "can_import": _workflow_is_executable(workflow_json),
            "imported": key in db_keys or key in db_names,
            "source": "disk",
        })

    return {"success": True, "workflows": items, "total": len(items)}


@router.post("/workflows/import-existing")
async def admin_import_workflows():
    _require_db()
    from workflow_config import WORKFLOW_CONFIGS

    wf_dir = Path(__file__).resolve().parent / "workflows"
    imported = 0
    skipped = 0
    repaired = 0
    disabled_empty = 0
    errors: List[str] = []
    configured_files: set[str] = set()

    for category_key, cfg in WORKFLOW_CONFIGS.items():
        name = getattr(cfg, "name", None) or str(category_key)
        file_name = getattr(cfg, "file", None)
        if not file_name:
            skipped += 1
            continue
        if file_name:
            configured_files.add(file_name)
        description = getattr(cfg, "description", "") or ""
        ph_objs = _placeholders_from_workflow_config(cfg)
        workflow_json: Dict[str, Any] = {}
        path = wf_dir / file_name
        if not path.is_file():
            errors.append(f"{name}: missing file workflows/{file_name}")
            continue
        try:
            workflow_json = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(workflow_json, dict):
                errors.append(f"{name}: workflow JSON root must be object")
                continue
        except (OSError, json.JSONDecodeError) as e:
            errors.append(f"{name}: read/parse error: {e}")
            continue

        existing = await WorkflowTemplateDAO.get_by_key(str(category_key))
        if not existing:
            existing = await WorkflowTemplateDAO.get_by_name(name)
        if existing:
            update_fields: Dict[str, Any] = {}
            if not existing.get("workflow_key"):
                update_fields["workflow_key"] = str(category_key)

            disk_placeholder_names = {str(p.get("key", "")) for p in ph_objs if isinstance(p, dict)}
            disk_workflow_placeholder_names = set(_placeholder_names_from_workflow_json(workflow_json))
            existing_placeholders = _jsonb_to_python(existing.get("placeholders")) or []
            existing_placeholder_names = {
                str(p.get("key", ""))
                for p in existing_placeholders
                if isinstance(p, dict)
            }
            existing_workflow_json = _jsonb_to_python(existing.get("workflow_json")) or {}
            existing_workflow_placeholders = set(_placeholder_names_from_workflow_json(existing_workflow_json))

            if disk_placeholder_names and existing_placeholder_names != disk_placeholder_names:
                update_fields["placeholders"] = ph_objs
            if disk_workflow_placeholder_names and not disk_workflow_placeholder_names.issubset(existing_workflow_placeholders):
                update_fields["workflow_json"] = workflow_json

            if update_fields:
                updated = await WorkflowTemplateDAO.update(existing["template_id"], **update_fields)
                if updated:
                    repaired += 1
            skipped += 1
            continue
        row = await WorkflowTemplateDAO.create(
            name=name,
            category=str(category_key),
            workflow_json=workflow_json,
            placeholders=ph_objs,
            description=description,
            node_type="any",
            estimated_time=30,
            workflow_key=str(category_key),
        )
        if not row:
            errors.append(f"{name}: database insert failed")
            continue
        imported += 1

    for path in sorted(wf_dir.glob("*.json"), key=lambda p: p.name.lower()):
        if path.name in configured_files:
            continue
        key = path.stem
        existing = await WorkflowTemplateDAO.get_by_key(key)
        if not existing:
            existing = await WorkflowTemplateDAO.get_by_name(key)
        if existing:
            if not existing.get("workflow_key"):
                updated = await WorkflowTemplateDAO.update(existing["template_id"], workflow_key=key)
                if updated:
                    repaired += 1
            skipped += 1
            continue
        try:
            workflow_json = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(workflow_json, dict):
                errors.append(f"{key}: workflow JSON root must be object")
                continue
        except (OSError, json.JSONDecodeError) as e:
            errors.append(f"{key}: read/parse error: {e}")
            continue

        placeholder_names = _placeholder_names_from_workflow_json(workflow_json)
        row = await WorkflowTemplateDAO.create(
            name=key,
            category=_workflow_category_for(key, path.name),
            workflow_json=workflow_json,
            placeholders=_placeholder_objects(placeholder_names),
            description=f"磁盘工作流文件 {path.name}",
            node_type="any",
            estimated_time=30,
            workflow_key=key,
        )
        if not row:
            errors.append(f"{key}: database insert failed")
            continue
        imported += 1

    valid_disk_workflows: Dict[str, Dict[str, Any]] = {}
    valid_disk_placeholders: Dict[str, List[Dict[str, Any]]] = {}
    configured_files_for_repair: set[str] = set()

    for category_key, cfg in WORKFLOW_CONFIGS.items():
        file_name = getattr(cfg, "file", None)
        if not file_name:
            continue
        configured_files_for_repair.add(file_name)
        path = wf_dir / file_name
        if not path.is_file():
            continue
        try:
            workflow_json = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not _workflow_is_executable(workflow_json):
            continue
        key = str(category_key)
        valid_disk_workflows[key] = workflow_json
        valid_disk_placeholders[key] = _placeholder_objects(
            _placeholder_names_from_workflow_json(workflow_json),
            getattr(cfg, "default_params", None) or {},
        )

    for path in sorted(wf_dir.glob("*.json"), key=lambda p: p.name.lower()):
        if path.name in configured_files_for_repair:
            continue
        try:
            workflow_json = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not _workflow_is_executable(workflow_json):
            continue
        key = path.stem
        valid_disk_workflows[key] = workflow_json
        valid_disk_placeholders[key] = _placeholder_objects(
            _placeholder_names_from_workflow_json(workflow_json)
        )

    for row in await WorkflowTemplateDAO.list_all():
        key = row.get("workflow_key") or row.get("category") or row.get("name") or ""
        workflow_json = _jsonb_to_python(row.get("workflow_json")) or {}
        if _workflow_is_executable(workflow_json):
            continue
        if key in valid_disk_workflows:
            updated = await WorkflowTemplateDAO.update(
                row["template_id"],
                workflow_json=valid_disk_workflows[key],
                placeholders=valid_disk_placeholders.get(key, []),
                enabled=True,
            )
            if updated:
                repaired += 1
            continue
        if bool(row.get("enabled", True)):
            updated = await WorkflowTemplateDAO.update(row["template_id"], enabled=False)
            if updated:
                repaired += 1
                disabled_empty += 1

    return {
        "success": True,
        "imported": imported,
        "skipped": skipped,
        "repaired": repaired,
        "disabled_empty": disabled_empty,
        "errors": errors,
    }


class WorkflowCreateBody(BaseModel):
    name: str = Field(..., min_length=1)
    category: str = Field(..., min_length=1)
    workflow_json: Dict[str, Any]
    placeholders: Optional[List[Any]] = None
    description: str = ""
    node_type: str = "any"
    estimated_time: int = 30
    workflow_key: str = ""


class WorkflowUpdateBody(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    workflow_json: Optional[Dict[str, Any]] = None
    placeholders: Optional[List[Any]] = None
    description: Optional[str] = None
    node_type: Optional[str] = None
    estimated_time: Optional[int] = None
    enabled: Optional[bool] = None
    workflow_key: Optional[str] = None


@router.get("/workflows")
async def admin_list_workflows():
    _require_db()
    rows = await WorkflowTemplateDAO.list_all()
    return {"success": True, "workflows": [_row_to_jsonable(r) for r in rows]}


@router.post("/workflows", status_code=status.HTTP_201_CREATED)
async def admin_create_workflow(body: WorkflowCreateBody):
    _require_db()
    row = await WorkflowTemplateDAO.create(
        name=body.name.strip(),
        category=body.category.strip(),
        workflow_json=body.workflow_json,
        placeholders=body.placeholders,
        description=body.description,
        node_type=body.node_type,
        estimated_time=body.estimated_time,
        workflow_key=body.workflow_key.strip(),
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create template")
    wf_key = body.workflow_key.strip() or body.category.strip()
    if wf_key and body.workflow_json:
        _sync_workflow_to_disk(wf_key, body.workflow_json)
        _reload_workflow_cache()
    return {"success": True, "workflow": _row_to_jsonable(row)}


@router.post("/workflows/reload")
async def admin_reload_workflows():
    """手动重载所有工作流到内存缓存"""
    _reload_workflow_cache()
    from workflow_handler import get_workflow_handler
    handler = get_workflow_handler()
    return {
        "success": True,
        "message": "Workflows reloaded",
        "count": len(handler.workflows),
        "names": sorted(handler.workflows.keys()),
    }


@router.get("/workflows/{template_id}")
async def admin_get_workflow(template_id: str):
    _require_db()
    row = await WorkflowTemplateDAO.get_by_id(template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"success": True, "workflow": _row_to_jsonable(row)}


@router.put("/workflows/{template_id}")
async def admin_update_workflow(template_id: str, body: WorkflowUpdateBody):
    _require_db()
    data = body.model_dump(exclude_unset=True)
    if not data:
        row = await WorkflowTemplateDAO.get_by_id(template_id)
        if not row:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"success": True, "workflow": _row_to_jsonable(row)}
    updated = await WorkflowTemplateDAO.update(template_id, **data)
    if not updated:
        raise HTTPException(status_code=404, detail="Template not found")
    wf_key = updated.get("workflow_key") or updated.get("category") or ""
    if wf_key and "workflow_json" in data:
        wf_json = updated.get("workflow_json")
        if isinstance(wf_json, str):
            wf_json = json.loads(wf_json)
        _sync_workflow_to_disk(wf_key, wf_json)
        _reload_workflow_cache()
    return {"success": True, "workflow": _row_to_jsonable(updated)}


@router.delete("/workflows/{template_id}")
async def admin_delete_workflow(template_id: str):
    _require_db()
    row = await WorkflowTemplateDAO.get_by_id(template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    wf_key = row.get("workflow_key") or row.get("category") or ""
    ok = await WorkflowTemplateDAO.delete(template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    if wf_key:
        _delete_workflow_from_disk(wf_key)
        _reload_workflow_cache()
    return {"success": True, "deleted": True}


# --- API configurations ---


router.include_router(api_config_router)
router.include_router(recycle_bin_router)


# --- System settings ---


class SettingsUpdateBody(BaseModel):
    settings: Dict[str, Any] = Field(default_factory=dict)


@router.get("/settings")
async def admin_get_settings():
    _require_db()
    rows = await SystemSettingsDAO.get_all()
    return {"success": True, "settings": [_row_to_jsonable(r) for r in rows]}


@router.put("/settings")
async def admin_put_settings(body: SettingsUpdateBody):
    _require_db()
    for key, value in body.settings.items():
        skey = str(key)
        sval = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        await SystemSettingsDAO.set(skey, sval, "")
    rows = await SystemSettingsDAO.get_all()
    return {"success": True, "settings": [_row_to_jsonable(r) for r in rows]}


# --- Dashboard ---


@router.get("/dashboard")
async def admin_dashboard():
    _require_db()
    agents = await AgentDAO.list_all()
    agents_total = len(agents)
    agents_online = sum(
        1
        for a in agents
        if str(a.get("status", "")).lower() == "online"
        and bool(a.get("enabled", True))
    )

    instances_total = 0
    instances_healthy = 0
    for a in agents:
        if not bool(a.get("enabled", True)):
            continue
        for inst in _parse_comfyui_instances(a.get("comfyui_instances")):
            instances_total += 1
            if _instance_healthy(inst):
                instances_healthy += 1

    queue_stats = await TaskDAO.get_stats()
    recent = await TaskDAO.get_recent(20)

    return {
        "success": True,
        "dashboard": {
            "agents_online": agents_online,
            "agents_total": agents_total,
            "instances_healthy": instances_healthy,
            "instances_total": instances_total,
            "queue_stats": queue_stats,
            "recent_tasks": [_row_to_jsonable(t) for t in recent],
        },
    }


@router.post("/tasks/cleanup")
async def cleanup_stale_tasks(hours: int = 24):
    """清理超时的僵尸任务（pending/queued/processing 超过指定小时数）"""
    _require_db()
    cleaned = await TaskDAO.cleanup_stale(hours)
    return {"success": True, "cleaned": cleaned}


# ============================================
# 2026-05-26 Slice 2: 积分规则 CRUD
# 详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
# ============================================
from dao_credit import CreditRuleDAO  # noqa: E402


class CreditRuleCreateBody(BaseModel):
    feature_key: str
    feature_name: str
    base_cost: int
    billing_unit: str = 'task'
    factors: List[Dict[str, Any]] = Field(default_factory=list)
    min_cost: int = 0
    max_cost: Optional[int] = None
    enabled: bool = True
    rule_version: Optional[str] = None
    description: str = ''


class CreditRuleUpdateBody(BaseModel):
    feature_key: Optional[str] = None
    feature_name: Optional[str] = None
    base_cost: Optional[int] = None
    billing_unit: Optional[str] = None
    factors: Optional[List[Dict[str, Any]]] = None
    min_cost: Optional[int] = None
    max_cost: Optional[int] = None
    enabled: Optional[bool] = None
    rule_version: Optional[str] = None
    description: Optional[str] = None


@router.get("/credit-rules", dependencies=[Depends(require_admin)])
async def admin_list_credit_rules():
    _require_db()
    rules = await CreditRuleDAO.list_all()
    return {"success": True, "rules": rules}


@router.post("/credit-rules", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def admin_create_credit_rule(body: CreditRuleCreateBody, request: Request):
    _require_db()
    rule = await CreditRuleDAO.create(
        feature_key=body.feature_key,
        feature_name=body.feature_name,
        base_cost=body.base_cost,
        billing_unit=body.billing_unit,
        factors=body.factors,
        min_cost=body.min_cost,
        max_cost=body.max_cost,
        enabled=body.enabled,
        rule_version=body.rule_version,
        description=body.description,
    )
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='credit_rule_create', target_type='credit_rule',
        target_id=rule.get('rule_id') if isinstance(rule, dict) else None,
        after=body.dict(),
    )
    return {"success": True, "rule": rule}


@router.put("/credit-rules/{rule_id}", dependencies=[Depends(require_admin)])
async def admin_update_credit_rule(rule_id: str, body: CreditRuleUpdateBody, request: Request):
    _require_db()
    before = await CreditRuleDAO.get(rule_id)
    fields = body.model_dump(exclude_unset=True)
    rule = await CreditRuleDAO.update(rule_id, fields)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='credit_rule_update', target_type='credit_rule', target_id=rule_id,
        before=before if isinstance(before, dict) else None,
        after=fields,
    )
    return {"success": True, "rule": rule}


@router.delete("/credit-rules/{rule_id}", dependencies=[Depends(require_admin)])
async def admin_delete_credit_rule(rule_id: str, request: Request):
    _require_db()
    before = await CreditRuleDAO.get(rule_id)
    await CreditRuleDAO.delete(rule_id)
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='credit_rule_delete', target_type='credit_rule', target_id=rule_id,
        before=before if isinstance(before, dict) else None,
    )
    return {"success": True}


# ============================================
# 2026-05-26 Slice 4: 用户管理 + 项目分组
# 详见 docs/superpowers/plans/2026-05-26-feature-rollout/04-admin-users-project-groups.md
# ============================================
from dao_user import UserDAO  # noqa: E402
from dao_project_group import ProjectGroupDAO  # noqa: E402


class AdminUserCreateBody(BaseModel):
    username: str
    password: str = Field(..., min_length=8)
    email: Optional[str] = None
    role: str = 'user'


class AdminUserUpdateBody(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    plan_tier: Optional[str] = None
    avatar_url: Optional[str] = None


class AdminDisableBody(BaseModel):
    reason: Optional[str] = None


class AdminResetPasswordBody(BaseModel):
    new_password: str = Field(..., min_length=8)


class AdminPermissionsBody(BaseModel):
    permissions: Dict[str, Any] = Field(default_factory=dict)


@router.get("/users", dependencies=[Depends(require_admin)])
async def admin_list_users(
    keyword: Optional[str] = None,
    role: Optional[str] = None,
    status_filter: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    _require_db()
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    users = await UserDAO.admin_list_users(
        keyword=keyword, role=role, status_filter=status_filter,
        limit=limit, offset=offset,
    )
    total = await UserDAO.admin_count_users(
        keyword=keyword, role=role, status_filter=status_filter,
    )
    # 2026-05-26：转换为前端 UserAccount 形状（permissions 兜底 + camelCase）
    return {"success": True, "users": [_normalize_admin_user(u) for u in users], "total": total, "limit": limit, "offset": offset}


@router.post("/users", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def admin_create_user(body: AdminUserCreateBody, request: Request):
    _require_db()
    existing = await UserDAO.get_user_by_username(body.username)
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")
    # user_id 必须 == username：全站约定如此（get_current_user 返回用户名，
    # projects/episodes 等资源表 user_id 外键按用户名存）。登录自动建号路径也传
    # user_id=username。若此处不传，DAO 会生成 user_xxx，导致该用户建项目等
    # 写库时外键冲突 → 500（前端表现为「新建项目按钮无效」）。
    user = await UserDAO.create_user(
        username=body.username, password=body.password, email=body.email,
        user_id=body.username,
    )
    if body.role and body.role != 'user':
        await UserDAO.set_role(user['user_id'], body.role)
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='user_create', target_type='user',
        target_id=user.get('user_id') if isinstance(user, dict) else None,
        after={'username': body.username, 'email': body.email, 'role': body.role},
    )
    return {"success": True, "user": _row_to_jsonable(user)}


@router.get("/users/{user_id}", dependencies=[Depends(require_admin)])
async def admin_get_user(user_id: str):
    _require_db()
    user = await UserDAO.admin_get_user_detail(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # Keep the detail response shape aligned with the admin user list.
    # 2026-05-26：与 admin_list_users 保持同一形状
    return {"success": True, "user": _normalize_admin_user(user)}


@router.put("/users/{user_id}", dependencies=[Depends(require_admin)])
async def admin_update_user(user_id: str, body: AdminUserUpdateBody, request: Request):
    _require_db()
    user = await UserDAO.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    fields = body.model_dump(exclude_unset=True)
    if 'role' in fields:
        await UserDAO.set_role(user_id, fields.pop('role'))
    if fields:
        await UserDAO.update_user_profile(user_id, **fields)
    # 2026-05-26 Slice 5: 审计
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='user_update', target_type='user', target_id=user_id,
        before=user, after=body.dict(exclude_none=True),
    )
    return {"success": True}


@router.post("/users/{user_id}/disable", dependencies=[Depends(require_admin)])
async def admin_disable_user(user_id: str, body: AdminDisableBody, request: Request):
    _require_db()
    user = await UserDAO.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    ok = await UserDAO.set_status(user_id, 'disabled', disabled_reason=body.reason or '管理员禁用')
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='user_disable', target_type='user', target_id=user_id,
        before={'status': user.get('status') if isinstance(user, dict) else None},
        after={'status': 'disabled', 'reason': body.reason},
        notes=body.reason or '',
    )
    return {"success": ok}


@router.post("/users/{user_id}/enable", dependencies=[Depends(require_admin)])
async def admin_enable_user(user_id: str, request: Request):
    _require_db()
    user = await UserDAO.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    ok = await UserDAO.set_status(user_id, 'active')
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='user_enable', target_type='user', target_id=user_id,
        before={'status': user.get('status') if isinstance(user, dict) else None},
        after={'status': 'active'},
    )
    return {"success": ok}


@router.post("/users/{user_id}/reset-password", dependencies=[Depends(require_admin)])
async def admin_reset_password(user_id: str, body: AdminResetPasswordBody, request: Request):
    _require_db()
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="new_password 至少 8 位")
    ok = await UserDAO.reset_password(user_id, body.new_password)
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='user_reset_password', target_type='user', target_id=user_id,
    )
    return {"success": ok}


@router.put("/users/{user_id}/permissions", dependencies=[Depends(require_admin)])
async def admin_update_permissions(user_id: str, body: AdminPermissionsBody, request: Request):
    _require_db()
    ok = await UserDAO.update_user_permissions(user_id, body.permissions)
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='user_update_permissions', target_type='user', target_id=user_id,
        after={'permissions': body.permissions},
    )
    return {"success": ok}


# ============================================
# 项目分组
# ============================================
class ProjectGroupCreateBody(BaseModel):
    user_id: str
    group_name: str
    description: str = ''
    color: Optional[str] = None
    sort_order: int = 0


class ProjectGroupUpdateBody(BaseModel):
    group_name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class ProjectMoveBody(BaseModel):
    group_id: Optional[str] = None  # None 移出分组


@router.get("/project-groups", dependencies=[Depends(require_admin)])
async def admin_list_project_groups(
    user_id: Optional[str] = None,
    org_id: Optional[str] = None,
):
    """2026-05-26 Slice 3 加 org_id 过滤。"""
    _require_db()
    if user_id:
        groups = await ProjectGroupDAO.list_for_user(user_id)
    else:
        groups = await ProjectGroupDAO.list_all()
    if org_id:
        groups = [g for g in groups if (g.get('organization_id') if isinstance(g, dict) else None) == org_id]
    return {"success": True, "groups": [_row_to_jsonable(g) for g in groups]}


@router.post("/project-groups", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def admin_create_project_group(body: ProjectGroupCreateBody, request: Request):
    _require_db()
    # 2026-05-26：归属用户必须存在（FK→users.user_id），否则 PostgreSQL 抛 FK violation。
    # 早些版本没 catch → 500 裸抛，前端只能拿到无意义 stack。这里改成 400 + 中文提示。
    target_user = await UserDAO.get_user_by_id(body.user_id)
    if not target_user:
        raise HTTPException(status_code=400, detail=f"归属用户不存在：{body.user_id}")
    if not body.group_name or not body.group_name.strip():
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    try:
        group = await ProjectGroupDAO.create(
            user_id=body.user_id, group_name=body.group_name.strip(),
            description=body.description or '', color=body.color, sort_order=body.sort_order or 0,
        )
    except Exception as e:
        msg = str(e)
        if 'foreign key' in msg.lower() or 'violates' in msg.lower():
            raise HTTPException(status_code=400, detail=f"创建分组失败（外键约束）：{msg}")
        raise HTTPException(status_code=500, detail=f"创建分组失败：{msg}")
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='project_group_create', target_type='project_group',
        target_id=group.get('group_id') if isinstance(group, dict) else None,
        after=body.dict(),
    )
    return {"success": True, "group": _row_to_jsonable(group)}


@router.put("/project-groups/{group_id}", dependencies=[Depends(require_admin)])
async def admin_update_project_group(group_id: str, body: ProjectGroupUpdateBody, request: Request):
    _require_db()
    before = await ProjectGroupDAO.get(group_id)
    fields = body.model_dump(exclude_unset=True)
    group = await ProjectGroupDAO.update(group_id, fields)
    if not group:
        raise HTTPException(status_code=404, detail="分组不存在")
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='project_group_update', target_type='project_group', target_id=group_id,
        before=_row_to_jsonable(before) if before else None,
        after=fields,
    )
    return {"success": True, "group": _row_to_jsonable(group)}


@router.delete("/project-groups/{group_id}", dependencies=[Depends(require_admin)])
async def admin_delete_project_group(group_id: str, request: Request):
    _require_db()
    before = await ProjectGroupDAO.get(group_id)
    await ProjectGroupDAO.delete(group_id)
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='project_group_delete', target_type='project_group', target_id=group_id,
        before=_row_to_jsonable(before) if before else None,
    )
    return {"success": True}


@router.post("/projects/{project_id}/move", dependencies=[Depends(require_admin)])
async def admin_move_project(project_id: str, body: ProjectMoveBody, request: Request):
    _require_db()
    await ProjectGroupDAO.move_project(project_id, body.group_id)
    import admin_audit_service
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='project_move', target_type='project', target_id=project_id,
        after={'group_id': body.group_id},
    )
    return {"success": True}


# ============================================
# 2026-05-26 Slice 5: 管理员素材库 / 积分账户 / 积分流水 / 审计日志
# 详见 docs/superpowers/plans/2026-05-26-feature-rollout/05-admin-media-credit-audit.md
# ============================================
from dao_media_library import MediaLibraryDAO  # noqa: E402
from dao_credit import CreditAccountDAO, CreditTransactionDAO  # noqa: E402
from dao_admin_audit import AdminAuditLogDAO  # noqa: E402
import admin_audit_service  # noqa: E402
import credit_service  # noqa: E402


@router.get("/media-library/items", dependencies=[Depends(require_admin)])
async def admin_list_media_items(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    item_type: Optional[str] = None,
    source: Optional[str] = None,
    keyword: Optional[str] = None,
    is_deleted: Optional[bool] = False,
    limit: int = 50,
    offset: int = 0,
):
    _require_db()
    items = await MediaLibraryDAO.list_admin(
        user_id=user_id,
        project_id=project_id,
        item_type=item_type,
        source=source,
        keyword=keyword,
        is_deleted=is_deleted,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "items": [_row_to_jsonable(it) for it in items]}


class AdminMediaUpdateBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    permission_scope: Optional[str] = None
    is_favorite: Optional[bool] = None


@router.patch("/media-library/items/{library_item_id}", dependencies=[Depends(require_admin)])
async def admin_update_media_item(
    library_item_id: str,
    body: AdminMediaUpdateBody,
    request: Request,
):
    _require_db()
    before = await MediaLibraryDAO.get(library_item_id)
    if not before:
        raise HTTPException(status_code=404, detail="素材不存在")
    fields = body.model_dump(exclude_unset=True)
    if fields:
        await MediaLibraryDAO.update(library_item_id, fields)
    after = await MediaLibraryDAO.get(library_item_id)
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='media_update', target_type='media_library_item', target_id=library_item_id,
        before=_row_to_jsonable(before), after=fields,
    )
    return {"success": True, "item": _row_to_jsonable(after)}


@router.delete("/media-library/items/{library_item_id}", dependencies=[Depends(require_admin)])
async def admin_delete_media_item(
    library_item_id: str,
    request: Request,
    reason: Optional[str] = None,
):
    _require_db()
    item = await MediaLibraryDAO.get(library_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="素材不存在")
    admin_id = admin_audit_service.caller_admin_id(request)
    reason = reason or '管理员删除'
    await MediaLibraryDAO.soft_delete(library_item_id, deleted_by=admin_id, deleted_reason=reason)
    await admin_audit_service.record(
        request,
        admin_user_id=admin_id,
        action='media_delete', target_type='media_library_item', target_id=library_item_id,
        before=_row_to_jsonable(item),
        after={'deleted_by': admin_id, 'deleted_reason': reason},
        notes=reason,
    )
    return {"success": True}


@router.get("/credit-accounts", dependencies=[Depends(require_admin)])
async def admin_list_credit_accounts(limit: int = 50, offset: int = 0, search: Optional[str] = None):
    _require_db()
    rows = await CreditAccountDAO.list_all(limit=limit, offset=offset, search=search)
    return {"success": True, "accounts": [_row_to_jsonable(r) for r in rows]}


class AdminCreditAdjustBody(BaseModel):
    delta: int  # 正/负，单位：积分（最小单位）
    reason: str = ''
    business_id: Optional[str] = None


@router.post("/credit-accounts/{user_id}/adjust", dependencies=[Depends(require_admin)])
async def admin_credit_adjust(user_id: str, body: AdminCreditAdjustBody, request: Request):
    _require_db()
    admin_id = admin_audit_service.caller_admin_id(request)
    # user_id → account_id（自动创建账户）
    account = await CreditAccountDAO.get_or_create(owner_type='user', owner_id=user_id)
    if not account:
        raise HTTPException(status_code=404, detail="无法定位用户账户")
    try:
        result = await credit_service.admin_adjust(
            account_id=account['account_id'],
            amount=int(body.delta),
            reason=body.reason or '',
            operator=admin_id,
            feature_key=body.business_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    await admin_audit_service.record(
        request,
        admin_user_id=admin_id,
        action='credit_adjust', target_type='credit_account', target_id=user_id,
        after={'delta': body.delta, 'reason': body.reason, 'business_id': body.business_id, 'account_id': account['account_id']},
        notes=body.reason or '',
    )
    return {"success": True, **(result or {})}


@router.get("/credit-transactions", dependencies=[Depends(require_admin)])
async def admin_list_credit_transactions(
    user_id: Optional[str] = None,
    tx_type: Optional[str] = None,
    operated_by: Optional[str] = None,
    business_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    _require_db()
    rows = await CreditTransactionDAO.list_admin(
        user_id=user_id,
        tx_type=tx_type,
        operated_by=operated_by,
        business_type=business_type,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "transactions": [_row_to_jsonable(r) for r in rows]}


@router.get("/audit-logs", dependencies=[Depends(require_admin)])
async def admin_list_audit_logs(
    admin_user_id: Optional[str] = None,
    action: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    from_dt: Optional[str] = None,
    to_dt: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    _require_db()
    rows = await AdminAuditLogDAO.list(
        admin_user_id=admin_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        from_dt=from_dt,
        to_dt=to_dt,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "logs": [_row_to_jsonable(r) for r in rows]}


# ============================================
# 2026-05-26 组织管理 MVP — Slice 2: Admin Org CRUD + Members
# 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.1
# ============================================
from dao_organization import OrganizationDAO, OrganizationMemberDAO  # noqa: E402


class OrganizationCreateBody(BaseModel):
    name: str
    owner_user_id: str
    description: str = ''
    color: Optional[str] = None


class OrganizationUpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None       # active | archived
    color: Optional[str] = None
    owner_user_id: Optional[str] = None


class OrganizationMemberAddBody(BaseModel):
    user_id: str
    role: str = 'member'               # owner | admin | member


class OrganizationMemberRoleBody(BaseModel):
    role: str                          # owner | admin | member


@router.get("/organizations", dependencies=[Depends(require_admin)])
async def admin_list_organizations(
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    _require_db()
    rows = await OrganizationDAO.list_all(
        status=status, keyword=keyword, limit=limit, offset=offset,
    )
    total = await OrganizationDAO.count_all(status=status, keyword=keyword)
    return {
        "success": True,
        "organizations": [_row_to_jsonable(r) for r in rows],
        "total": total,
    }


@router.post("/organizations", status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_admin)])
async def admin_create_organization(body: OrganizationCreateBody, request: Request):
    _require_db()
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=400, detail="组织名称不能为空")
    target_user = await UserDAO.get_user_by_id(body.owner_user_id)
    if not target_user:
        raise HTTPException(status_code=400, detail=f"owner 用户不存在：{body.owner_user_id}")
    try:
        org = await OrganizationDAO.create(
            name=body.name.strip(),
            owner_user_id=body.owner_user_id,
            description=body.description or '',
            color=body.color,
            created_by=admin_audit_service.caller_admin_id(request),
        )
    except Exception as e:
        msg = str(e)
        if 'foreign key' in msg.lower() or 'violates' in msg.lower():
            raise HTTPException(status_code=400, detail=f"创建组织失败（外键约束）：{msg}")
        logger.exception("admin_create_organization 失败")
        raise HTTPException(status_code=500, detail=f"创建组织失败：{msg}")
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='organization_create', target_type='organization',
        target_id=org.get('org_id') if isinstance(org, dict) else None,
        after=body.dict(),
    )
    return {"success": True, "organization": _row_to_jsonable(org)}


@router.get("/organizations/{org_id}", dependencies=[Depends(require_admin)])
async def admin_get_organization(org_id: str):
    _require_db()
    org = await OrganizationDAO.get(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")
    members = await OrganizationMemberDAO.list_members(org_id)
    return {
        "success": True,
        "organization": _row_to_jsonable(org),
        "members": [_row_to_jsonable(m) for m in members],
    }


@router.put("/organizations/{org_id}", dependencies=[Depends(require_admin)])
async def admin_update_organization(org_id: str, body: OrganizationUpdateBody, request: Request):
    _require_db()
    before = await OrganizationDAO.get(org_id)
    if not before:
        raise HTTPException(status_code=404, detail="组织不存在")
    fields = body.model_dump(exclude_unset=True)
    if 'owner_user_id' in fields:
        target = await UserDAO.get_user_by_id(fields['owner_user_id'])
        if not target:
            raise HTTPException(status_code=400, detail="新 owner 用户不存在")
        # 自动把新 owner 加成员（role=owner）
        await OrganizationMemberDAO.add_member(
            org_id, fields['owner_user_id'], role='owner',
            added_by=admin_audit_service.caller_admin_id(request),
        )
    try:
        org = await OrganizationDAO.update(org_id, fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='organization_update', target_type='organization', target_id=org_id,
        before=_row_to_jsonable(before), after=fields,
    )
    return {"success": True, "organization": _row_to_jsonable(org)}


@router.delete("/organizations/{org_id}", dependencies=[Depends(require_admin)])
async def admin_delete_organization(org_id: str, request: Request):
    _require_db()
    before = await OrganizationDAO.get(org_id)
    if not before:
        raise HTTPException(status_code=404, detail="组织不存在")
    await OrganizationDAO.delete(org_id)
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='organization_delete', target_type='organization', target_id=org_id,
        before=_row_to_jsonable(before),
    )
    return {"success": True}


@router.get("/organizations/{org_id}/members", dependencies=[Depends(require_admin)])
async def admin_list_members(org_id: str):
    _require_db()
    org = await OrganizationDAO.get(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")
    members = await OrganizationMemberDAO.list_members(org_id)
    return {"success": True, "members": [_row_to_jsonable(m) for m in members]}


@router.post("/organizations/{org_id}/members", status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_admin)])
async def admin_add_member(org_id: str, body: OrganizationMemberAddBody, request: Request):
    _require_db()
    org = await OrganizationDAO.get(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")
    user = await UserDAO.get_user_by_id(body.user_id)
    if not user:
        raise HTTPException(status_code=400, detail=f"用户不存在：{body.user_id}")
    try:
        member = await OrganizationMemberDAO.add_member(
            org_id, body.user_id, role=body.role,
            added_by=admin_audit_service.caller_admin_id(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='organization_member_add', target_type='organization', target_id=org_id,
        after={'user_id': body.user_id, 'role': body.role},
    )
    return {"success": True, "member": _row_to_jsonable(member)}


@router.delete("/organizations/{org_id}/members/{user_id}",
               dependencies=[Depends(require_admin)])
async def admin_remove_member(org_id: str, user_id: str, request: Request):
    _require_db()
    org = await OrganizationDAO.get(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")
    if org.get('owner_user_id') == user_id:
        raise HTTPException(status_code=400, detail="不能删除 owner，请先转让 owner 角色")
    await OrganizationMemberDAO.remove_member(org_id, user_id)
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='organization_member_remove', target_type='organization', target_id=org_id,
        before={'user_id': user_id},
    )
    return {"success": True}


@router.put("/organizations/{org_id}/members/{user_id}/role",
            dependencies=[Depends(require_admin)])
async def admin_set_member_role(org_id: str, user_id: str,
                                body: OrganizationMemberRoleBody, request: Request):
    _require_db()
    org = await OrganizationDAO.get(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")
    try:
        member = await OrganizationMemberDAO.set_role(org_id, user_id, body.role)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not member:
        raise HTTPException(status_code=404, detail="该用户不是组织成员")
    await admin_audit_service.record(
        request,
        admin_user_id=admin_audit_service.caller_admin_id(request),
        action='organization_member_set_role', target_type='organization', target_id=org_id,
        after={'user_id': user_id, 'role': body.role},
    )
    return {"success": True, "member": _row_to_jsonable(member)}

# 用户自服务端点 `/api/me/organizations` 见 cluster_main.py:list_my_organizations
