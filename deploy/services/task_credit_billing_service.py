# -*- coding: utf-8 -*-
"""Server-owned credit reservations for queued generation tasks.

The client may display estimates, but it never decides whether a queued task is
billable.  Billing is derived from the trusted task type and persisted entity
context, reserved before enqueue, settled on success, and released on a final
failure or cancellation.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from services import credit_service


logger = logging.getLogger(__name__)

BILLING_METADATA_KEY = "_credit_billing"

ENHANCEMENT_TASK_TYPES = frozenset({"upscale", "interpolate", "voice", "viedo_upscaler"})
VIDEO_TASK_TYPES = frozenset(
    {
        "i2v",
        "morph",
        "minimax_i2v",
        "minimax_morph",
        "sora2_i2v",
        "sora2_morph",
        "veo_i2v",
        "veo_morph",
        "wan2_i2v",
        "wan2_morph",
        "wan26_i2v",
    }
)
VIDEO_TASK_PREFIXES = ("seedance_", "kling_", "vidu_", "happyhorse_")

# Multi-angle already has its own fixed-output billing contract.  Keeping it
# out of generic storyboard billing prevents two independent charges.
STORYBOARD_BILLING_EXCLUDED_TASK_TYPES = frozenset({"i2i_human"})


def _non_negative_int(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError, OverflowError):
        return 0


def resolve_task_billing(task_type: str, task_data: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Return a trusted billing spec for supported queued workflow surfaces."""
    normalized_type = str(task_type or "").strip().lower()
    data = task_data if isinstance(task_data, dict) else {}

    if normalized_type == "minimax_tts":
        text = str(data.get("text") or "")
        return {
            "feature_key": "audio_generation_tts",
            "params": {"character_count": len(text)},
            "surface": "audio",
        }

    if normalized_type in ENHANCEMENT_TASK_TYPES:
        return {
            "feature_key": "video_enhancement",
            "params": {
                "operation": normalized_type,
                "duration_seconds": _non_negative_int(data.get("duration")),
                "target_fps": data.get("target_fps"),
                "resolution": data.get("resolution"),
            },
            "surface": "enhance",
        }

    if normalized_type in VIDEO_TASK_TYPES or normalized_type.startswith(VIDEO_TASK_PREFIXES):
        return {
            "feature_key": "video_generation",
            "params": {
                "task_type": normalized_type,
                "duration_seconds": _non_negative_int(
                    data.get("hh_duration") or data.get("duration")
                ),
                "resolution": (
                    data.get("hh_resolution")
                    or data.get("vidu_resolution")
                    or data.get("minimax_resolution")
                    or data.get("resolution")
                ),
                "model": data.get("model"),
                "sub_model": (
                    data.get("sub_model_vidu")
                    or data.get("sub_model_kling")
                    or data.get("sub_model")
                ),
                "minimax_model": data.get("minimax_model"),
                "minimax_resolution": data.get("minimax_resolution"),
                "hh_resolution": data.get("hh_resolution"),
                "vidu_resolution": data.get("vidu_resolution"),
                "audio": bool(data.get("vidu_audio") or data.get("audio")),
                "has_reference_video": any(
                    isinstance(item, dict) and item.get("kind") == "video"
                    for item in (data.get("media_inputs") or [])
                ),
            },
            "surface": "video",
        }

    if (
        normalized_type not in STORYBOARD_BILLING_EXCLUDED_TASK_TYPES
        and str(data.get("entity_type") or "") == "storyboard_item"
        and str(data.get("file_role") or "") == "generated_image"
    ):
        return {
            "feature_key": "image_generation",
            "params": {
                "image_count": 1,
                "model": data.get("model") or data.get("requested_workflow_type") or normalized_type,
            },
            "surface": "storyboard",
        }

    return None


async def reserve_task_credits(
    *,
    task_id: str,
    task_type: str,
    task_data: Dict[str, Any],
    user_id: str,
) -> Optional[Dict[str, Any]]:
    """Estimate and reserve credits before the task becomes visible to workers."""
    existing = task_data.get(BILLING_METADATA_KEY)
    if isinstance(existing, dict):
        return existing

    spec = resolve_task_billing(task_type, task_data)
    if not spec:
        return None

    quote = await credit_service.estimate(
        spec["feature_key"],
        spec["params"],
        owner_type="user",
        owner_id=user_id,
    )
    amount = int(quote.get("estimated_cost") or 0)
    if not quote.get("enabled") or amount <= 0:
        return None

    metadata = {
        "feature_key": spec["feature_key"],
        "amount": amount,
        "params": spec["params"],
        "surface": spec["surface"],
        "rule_version": quote.get("rule_version"),
        "owner_id": user_id,
        "project_id": task_data.get("project_id"),
    }
    await credit_service.freeze(
        "user",
        user_id,
        feature_key=spec["feature_key"],
        amount=amount,
        task_id=task_id,
        rule_version=quote.get("rule_version"),
        project_id=task_data.get("project_id"),
        metadata={
            "billing_params": spec["params"],
            "surface": spec["surface"],
            "task_type": task_type,
        },
    )
    task_data[BILLING_METADATA_KEY] = metadata
    return metadata


async def settle_task_credits(
    *,
    task_id: str,
    task_data: Optional[Dict[str, Any]],
    user_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Settle a successful task exactly once, including duplicate callbacks."""
    data = task_data if isinstance(task_data, dict) else {}
    billing = data.get(BILLING_METADATA_KEY)
    if not isinstance(billing, dict):
        return None

    owner_id = str(billing.get("owner_id") or user_id or "")
    if not owner_id:
        raise credit_service.CreditServiceError(f"Missing credit owner for task_id={task_id}")

    # consume_usage first checks the ledger for an existing consumption.  On
    # the first callback it confirms the reservation; duplicate callbacks are
    # therefore harmless.
    return await credit_service.consume_usage(
        "user",
        owner_id,
        feature_key=str(billing["feature_key"]),
        params=billing.get("params") or {},
        task_id=task_id,
        project_id=billing.get("project_id"),
        metadata={"surface": billing.get("surface"), "settlement": "task_terminal"},
    )


async def release_task_credits(
    *,
    task_id: str,
    task_data: Optional[Dict[str, Any]],
    user_id: Optional[str],
    reason: str,
) -> Optional[Dict[str, Any]]:
    """Release a reserved amount for terminal failure or cancellation."""
    data = task_data if isinstance(task_data, dict) else {}
    billing = data.get(BILLING_METADATA_KEY)
    if not isinstance(billing, dict):
        return None
    return await credit_service.release(
        task_id,
        operator=str(billing.get("owner_id") or user_id or "") or None,
        reason=reason,
        project_id=billing.get("project_id"),
    )
