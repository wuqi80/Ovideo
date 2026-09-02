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
