"""Cluster node presentation helpers for local nodes and external GPU agents."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _jsonish(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return fallback
    return fallback


def _agent_node(row: Dict[str, Any]) -> Dict[str, Any]:
    agent_id = str(row.get("agent_id") or row.get("id") or "")
    instances = _jsonish(row.get("comfyui_instances"), [])
    system_info = _jsonish(row.get("system_info"), {})
    stats = _jsonish(row.get("stats"), {})
    first_instance = instances[0] if isinstance(instances, list) and instances else {}
    if not isinstance(first_instance, dict):
        first_instance = {}

    host = (
        system_info.get("hostname")
        or system_info.get("host")
        or system_info.get("ip")
        or first_instance.get("host")
        or "GPU Agent"
    )
    port = first_instance.get("port")
    return {
        "id": agent_id,
        "node_id": agent_id,
        "agent_id": agent_id,
        "name": row.get("name") or agent_id,
        "status": row.get("status") or "online",
        "kind": "agent",
        "type": "agent",
        "enabled": bool(row.get("enabled", True)),
        "host": host,
        "url": first_instance.get("url") or (f"http://{host}:{port}" if port else ""),
        "last_heartbeat": str(row.get("last_heartbeat") or ""),
        "tasks": int(system_info.get("current_tasks") or stats.get("current_tasks") or 0),
        "max_concurrent": max(1, len(instances) if isinstance(instances, list) and instances else 1),
        "gpu_usage": stats.get("gpu_usage") or system_info.get("gpu_usage"),
    }


async def list_agent_nodes() -> List[Dict[str, Any]]:
    """Return enabled online/busy GPU agents in the same shape as cluster nodes."""
    try:
        from dao_agent import AgentDAO

        rows = await AgentDAO.list_all()
    except Exception as exc:
        logger.warning("list cluster agent nodes failed: %s", exc)
        return []

    nodes: List[Dict[str, Any]] = []
    for row in rows or []:
        data = dict(row)
        status = str(data.get("status") or "").lower()
        if not data.get("enabled", True):
            continue
        if status not in {"online", "busy", "healthy"}:
            continue
        nodes.append(_agent_node(data))
    return nodes
