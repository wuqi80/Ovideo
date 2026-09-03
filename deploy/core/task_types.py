# -*- coding: utf-8 -*-
"""Shared task-type policy for routing and worker dispatch."""

EXTERNAL_API_TASK_TYPES_EXACT = frozenset(
    {
        "minimax_i2v",
        "minimax_morph",
        "minimax_tts",
        "sora2_i2v",
        "sora2_morph",
        "veo_i2v",
        "veo_morph",
        "wan26_i2v",
        "video_reverse_prompt",
    }
)
EXTERNAL_API_TASK_TYPE_PREFIXES = ("seedance_", "kling_", "vidu_", "happyhorse_")


def is_external_api_task(task_type: str) -> bool:
    """Return True for tasks handled by external APIs instead of ComfyUI."""
    if not task_type:
        return False
    if task_type in EXTERNAL_API_TASK_TYPES_EXACT:
        return True
    return any(task_type.startswith(prefix) for prefix in EXTERNAL_API_TASK_TYPE_PREFIXES)


def is_local_node_task(task_type: str) -> bool:
    """Return True for work that must occupy the shared local GPU node."""
    return bool(task_type) and not is_external_api_task(task_type)


def local_node_queue_lane(task_type: str, task_data: dict | None = None) -> str:
    """Return the per-user concurrency lane for a local-node task.

    Image upscaling has its own two-task allowance so it does not consume the
    user's local video-generation allowance. All other local-node work keeps
    the established shared lane.
    """
    requested_type = str((task_data or {}).get("requested_workflow_type") or "")
    return "image_upscale" if task_type == "image_upscale" or requested_type == "image_upscale" else "default"
