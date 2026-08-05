"""Cluster node presentation helpers for local nodes and external GPU agents."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _public_node_name(value: Any) -> str:
    raw = str(value or "").strip()
    match = re.fullmatch(r"(?:gpu|agent[_\s-]*gpu|gpu[_\s-]*agent)[_\s-]*(\d+)", raw, re.IGNORECASE)
    if match:
        return f"处理节点{match.group(1)}"
    public_name = re.sub(r"comfyui", "处理服务", raw, flags=re.IGNORECASE)
    return re.sub(r"gpu", "处理节点", public_name, flags=re.IGNORECASE) or "处理节点"


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
        or "处理节点"
    )
    port = first_instance.get("port")
    status = str(row.get("status") or "offline").lower()
    instance_states = {
        str(instance.get("status") or "").lower()
        for instance in instances
        if isinstance(instance, dict)
    }
    if instances and "healthy" not in instance_states:
        status = "unavailable"
    current_tasks = int(
        row.get("active_tasks")
        or system_info.get("current_tasks")
        or stats.get("current_tasks")
        or 0
    )
    if current_tasks > 0:
        status = "busy"
    elif status == "busy":
        current_tasks = max(1, current_tasks)

    return {
        "id": agent_id,
        "node_id": agent_id,
        "agent_id": agent_id,
        "name": _public_node_name(row.get("display_name") or row.get("name") or agent_id),
        "routing_name": row.get("name") or agent_id,
        "status": status,
        "kind": "agent",
        "type": "agent",
        "enabled": bool(row.get("enabled", True)),
        "host": host,
        "url": first_instance.get("url") or (f"http://{host}:{port}" if port else ""),
        "last_heartbeat": str(row.get("last_heartbeat") or ""),
        "tasks": current_tasks,
        # The current Agent loop executes one task at a time even when it monitors multiple ports.
        "max_concurrent": 1,
        "gpu_usage": stats.get("gpu_usage") or system_info.get("gpu_usage"),
    }


def _row_active_tasks(row: Dict[str, Any], system_info: Dict[str, Any], stats: Dict[str, Any]) -> int:
    return int(
        row.get("active_tasks")
        or system_info.get("current_tasks")
        or stats.get("current_tasks")
        or 0
    )


async def list_agent_nodes(*, include_offline: bool = False) -> List[Dict[str, Any]]:
    """Return enabled GPU agents in the same shape as cluster nodes."""
    try:
        from dao_agent import AgentDAO

        rows = await AgentDAO.list_all_with_active_task_counts()
    except Exception as exc:
        logger.warning("list cluster agent nodes failed: %s", exc)
        return []

    nodes: List[Dict[str, Any]] = []
    for row in rows or []:
        data = dict(row)
        if not data.get("enabled", True):
            continue
        node = _agent_node(data)
        if not include_offline and node["status"] not in {"online", "busy", "healthy"}:
            continue
        nodes.append(node)
    return nodes


async def list_agent_instances(*, include_offline: bool = False) -> List[Dict[str, Any]]:
    """Return per-port processing-service instances exposed by enabled GPU agents."""
    try:
        from dao_agent import AgentDAO

        rows = await AgentDAO.list_all_with_active_task_counts()
    except Exception as exc:
        logger.warning("list cluster agent instances failed: %s", exc)
        return []

    instances_out: List[Dict[str, Any]] = []
    for row in rows or []:
        data = dict(row)
        if not data.get("enabled", True):
            continue
        agent_id = str(data.get("agent_id") or data.get("id") or "")
        system_info = _jsonish(data.get("system_info"), {})
        stats = _jsonish(data.get("stats"), {})
        instances = _jsonish(data.get("comfyui_instances"), [])
        if not isinstance(instances, list):
            instances = []

        row_status = str(data.get("status") or "offline").lower()
        active_tasks = _row_active_tasks(data, system_info, stats)
        public_name = _public_node_name(data.get("display_name") or data.get("name") or agent_id)
        routing_name = data.get("name") or agent_id

        if not instances and include_offline:
            instances = [{}]

        for instance in instances:
            if not isinstance(instance, dict):
                continue
            instance_status = str(instance.get("status") or "").lower()
            host = (
                system_info.get("hostname")
                or system_info.get("host")
                or system_info.get("ip")
                or instance.get("host")
                or "处理节点"
            )
            port = instance.get("port")
            is_healthy = row_status in {"online", "busy", "healthy"} and instance_status == "healthy"
            if not include_offline and not is_healthy:
                continue
            instances_out.append(
                {
                    "id": f"{agent_id}:{port}" if port else agent_id,
                    "node_id": agent_id,
                    "agent_id": agent_id,
                    "name": public_name,
                    "routing_name": routing_name,
                    "kind": "agent_instance",
                    "type": "agent_instance",
                    "enabled": True,
                    "host": host,
                    "port": port,
                    "url": instance.get("url") or (f"http://{host}:{port}" if port else ""),
                    "status": "busy" if active_tasks > 0 and is_healthy else row_status,
                    "instance_status": instance_status or row_status,
                    "healthy": is_healthy,
                    "last_heartbeat": str(data.get("last_heartbeat") or ""),
                    "tasks": active_tasks,
                    "max_concurrent": 1,
                    "capabilities": _jsonish(instance.get("capabilities"), {}),
                    "metadata": _jsonish(instance.get("metadata"), {}),
                }
            )
    return instances_out
