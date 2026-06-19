"""Cluster status and health routes."""
from __future__ import annotations

import logging
from typing import Callable, Iterable, Optional

from fastapi import APIRouter, Depends

from cluster_config import SystemConfig
import task_service

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


def create_cluster_status_router(
    *,
    require_auth_dependency,
    get_cluster_manager: Callable[[], Optional[object]],
    get_workers: Callable[[], Iterable[object]],
    get_redis_client: Callable[[], Optional[object]],
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
        """Return cluster node list; agent-only mode has no local nodes."""
        cluster_manager = get_cluster_manager()
        if cluster_manager is None:
            return {
                "success": True,
                "nodes": [],
                "agent_only_mode": True,
                "message": "Agent-Only 模式：本地无 ComfyUI 集群节点，任务由外部 Agent 处理",
            }
        stats = cluster_manager.get_cluster_stats()
        return {
            "success": True,
            "nodes": stats["nodes"],
        }

    @router.get("/health")
    async def health_check():
        """Return process health; agent-only mode is still a healthy state."""
        redis_client = get_redis_client()
        try:
            await redis_client.ping()
            redis_status = "healthy"
        except Exception:
            redis_status = "unhealthy"

        cluster_manager = get_cluster_manager()
        if cluster_manager is None:
            cluster_block = {"healthy_nodes": 0, "total_nodes": 0, "agent_only_mode": True}
        else:
            stats = cluster_manager.get_cluster_stats()
            cluster_block = {
                "healthy_nodes": stats["healthy_nodes"],
                "total_nodes": stats["total_nodes"],
            }

        total_workers, active_workers = _worker_count(get_workers())
        return {
            "status": "healthy" if redis_status == "healthy" else "degraded",
            "service": SystemConfig.FRONTEND_CONFIG["title"],
            "version": SystemConfig.FRONTEND_CONFIG["version"],
            "redis": redis_status,
            "cluster": cluster_block,
            "workers": {
                "total": total_workers,
                "active": active_workers,
            },
        }

    return router
