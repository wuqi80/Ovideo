"""Cluster status and health routes."""
from __future__ import annotations

import logging
import os
from typing import Callable, Iterable, Optional

from fastapi import APIRouter, Depends

from cluster_config import SystemConfig
import task_service
from services.cluster_node_service import list_agent_nodes
from services.runtime_health_service import (
    collect_database_health,
    collect_provider_health,
    read_release_metadata,
)

logger = logging.getLogger(__name__)


def _worker_count(workers: Iterable[object]) -> tuple[int, int]:
    worker_list = list(workers or [])
    active = sum(1 for worker in worker_list if getattr(worker, "current_task", None))
    return len(worker_list), active


def _cluster_stats(cluster_manager: Optional[object]) -> dict:
    if cluster_manager is None:
        return {
            "nodes": [],
            "healthy_nodes": 0,
            "total_nodes": 0,
            "agent_only_mode": True,
        }
    return cluster_manager.get_cluster_stats()


def _positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _queue_health_status(queue: dict) -> str:
    if queue.get("redis_status") != "healthy":
        return "unavailable"
    redis_queued = int(queue.get("redis_queued") or 0)
    database_pending = int(queue.get("database_pending") or 0)
    pending_age = queue.get("oldest_pending_age_seconds")
    processing_age = queue.get("oldest_processing_age_seconds")
    if redis_queued == 0 and database_pending > 0:
        return "inconsistent"
    if redis_queued > 0 and pending_age is not None:
        if pending_age > _positive_int_env("HEALTH_QUEUE_MAX_AGE_SECONDS", 3600):
            return "stalled"
    if processing_age is not None:
        if processing_age > _positive_int_env("HEALTH_PROCESSING_MAX_AGE_SECONDS", 7200):
            return "stalled"
    return "active" if redis_queued or int(queue.get("redis_processing") or 0) else "healthy"


def create_cluster_status_router(
    *,
    require_auth_dependency,
    get_cluster_manager: Callable[[], Optional[object]],
    get_workers: Callable[[], Iterable[object]],
    get_redis_client: Callable[[], Optional[object]],
    get_db_manager: Callable[[], Optional[object]],
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/cluster/stats")
    async def get_cluster_stats(username: str = Depends(require_auth_dependency)):
        """Return cluster and task queue statistics."""
        stats = _cluster_stats(get_cluster_manager())

        try:
            stats["queue_length"] = await task_service.get_queue().get_queue_length()
            stats["processing_count"] = await task_service.get_queue().get_processing_count()
        except Exception as exc:
            logger.warning("get_cluster_stats: queue stats failed (%s)", exc)
            stats.setdefault("queue_length", 0)
            stats.setdefault("processing_count", 0)

        total_workers, active_workers = _worker_count(get_workers())
        stats["workers_count"] = total_workers
        stats["workers_active"] = active_workers

        return {
            "success": True,
            "stats": stats,
        }

    @router.get("/api/cluster/nodes")
    async def list_nodes(username: str = Depends(require_auth_dependency)):
        """Return local cluster nodes plus online external GPU agents."""
        cluster_manager = get_cluster_manager()
        agent_nodes = await list_agent_nodes(include_offline=True)
        online_agent_nodes = [
            node for node in agent_nodes
            if str(node.get("status") or "").lower() in {"online", "busy", "healthy"}
        ]
        if cluster_manager is None:
            message = (
                f"已检测到 {len(online_agent_nodes)} 个在线 GPU Agent，可由集群节点处理 ComfyUI 任务。"
                if online_agent_nodes
                else "Agent-Only 模式：当前没有在线 GPU Agent，ComfyUI 任务会等待 Agent 上线。"
            )
            return {
                "success": True,
                "nodes": agent_nodes,
                "agent_only_mode": True,
                "message": message,
            }
        stats = cluster_manager.get_cluster_stats()
        return {
            "success": True,
            "nodes": [*(stats.get("nodes") or []), *agent_nodes],
            "agent_only_mode": False,
        }

    @router.get("/health")
    async def health_check():
        """Return process, dependency, migration, and release health."""
        redis_client = get_redis_client()
        try:
            await redis_client.ping()
            redis_status = "healthy"
        except Exception:
            redis_status = "unhealthy"

        database = await collect_database_health(get_db_manager())
        providers = await collect_provider_health()
        release = read_release_metadata()
        database_queue = database.pop("task_queue", {})
        try:
            queue = task_service.get_queue()
            redis_queued = await queue.get_queue_length()
            redis_processing = await queue.get_processing_count()
            queue_redis_status = "healthy"
        except Exception as exc:
            logger.warning("health_check: queue stats failed (%s)", exc)
            redis_queued = None
            redis_processing = None
            queue_redis_status = "unhealthy"
        queue_health = {
            "redis_status": queue_redis_status,
            "redis_queued": redis_queued,
            "redis_processing": redis_processing,
            "database_pending": database_queue.get("pending_count"),
            "database_processing": database_queue.get("processing_count"),
            "oldest_pending_at": database_queue.get("oldest_pending_at"),
            "oldest_pending_age_seconds": database_queue.get("oldest_pending_age_seconds"),
            "oldest_processing_at": database_queue.get("oldest_processing_at"),
            "oldest_processing_age_seconds": database_queue.get("oldest_processing_age_seconds"),
        }
        queue_health["status"] = _queue_health_status(queue_health)

        cluster_manager = get_cluster_manager()
        if cluster_manager is None:
            cluster_block = {"healthy_nodes": 0, "total_nodes": 0, "agent_only_mode": True}
        else:
            stats = cluster_manager.get_cluster_stats()
            cluster_block = {
                "healthy_nodes": stats["healthy_nodes"],
                "total_nodes": stats["total_nodes"],
            }

        agent_nodes = await list_agent_nodes(include_offline=True)
        available_agent_states = {"online", "busy", "healthy"}
        available_agents = sum(
            1 for node in agent_nodes if str(node.get("status") or "").lower() in available_agent_states
        )
        gpu_agents = {
            "status": (
                "not_configured"
                if not agent_nodes
                else "healthy" if available_agents else "unavailable"
            ),
            "configured": len(agent_nodes),
            "available": available_agents,
            "busy": sum(1 for node in agent_nodes if node.get("status") == "busy"),
            "unavailable": len(agent_nodes) - available_agents,
        }

        total_workers, active_workers = _worker_count(get_workers())
        return {
            "status": (
                "healthy"
                if (
                    redis_status == "healthy"
                    and database["status"] == "healthy"
                    and queue_health["status"] not in {"unavailable", "inconsistent", "stalled"}
                    and providers["status"] not in {"unhealthy", "unavailable"}
                    and gpu_agents["status"] != "unavailable"
                )
                else "degraded"
            ),
            "service": SystemConfig.FRONTEND_CONFIG["title"],
            "version": SystemConfig.FRONTEND_CONFIG["version"],
            "redis": redis_status,
            "database": database,
            "queue": queue_health,
            "release": release,
            "providers": providers,
            "cluster": cluster_block,
            "gpu_agents": gpu_agents,
            "workers": {
                "total": total_workers,
                "active": active_workers,
            },
        }

    return router
