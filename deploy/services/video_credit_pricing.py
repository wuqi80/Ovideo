# -*- coding: utf-8 -*-
"""Authoritative video-generation credit pricing.

The browser may request a preview, but queued-task billing always calls this
module again with the persisted task payload.  Never accept a caller supplied
credit amount.

The external-API conversion is anchored to the product decision that a
5-second HappyHorse 1.0 1080P request costs 160 credits. HappyHorse's public
list price is CNY 1.60/second. External API prices use the product-friendly
conversion of 20 credits/CNY.
Local workflows have no per-call provider fee and use the product minimum of
10 credits per completed task.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Mapping, Tuple


VIDEO_PRICING_VERSION = "2026-08-19-video-cost-v1"
CREDITS_PER_CNY = Decimal("20")
LOCAL_VIDEO_CREDITS = 10

LOCAL_MODELS = frozenset(
    {
        "wan2",
        "ltxnode1",
        "wannode2",
        "一阶",
        "二阶",
        "三阶",
        "四阶",
        "五阶",
        "六阶",
        "七阶",
        "minimaxh3",
        "minimaxh3fast",
        "minimaxh3mini",
    }
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _lower(value: Any) -> str:
    return _text(value).lower()


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError, OverflowError):
        return default
    return parsed if parsed > 0 else default


def _resolution(params: Mapping[str, Any], default: str = "720P") -> str:
    raw = (
        params.get("hh_resolution")
        or params.get("vidu_resolution")
        or params.get("minimax_resolution")
        or params.get("resolution")
        or default
    )
    value = _text(raw).upper().replace(" ", "")
    aliases = {
        "480": "480P",
        "480P": "480P",
        "540": "540P",
        "540P": "540P",
        "720": "720P",
        "720P": "720P",
        "768": "768P",
        "768P": "768P",
        "1080": "1080P",
        "1080P": "1080P",
        "1280X704": "720P",
        "1280*704": "720P",
    }
    return aliases.get(value, default)


def _credits_from_cny_per_second(rate: str, duration: int) -> Tuple[int, Decimal]:
    provider_cost = Decimal(rate) * Decimal(duration)
    credits = int((provider_cost * CREDITS_PER_CNY).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return max(LOCAL_VIDEO_CREDITS, credits), provider_cost


def _fixed_quote(credits: int, profile: str, **extra: Any) -> Dict[str, Any]:
    return {
        "credits": max(LOCAL_VIDEO_CREDITS, int(credits)),
        "profile": profile,
        "pricing_version": VIDEO_PRICING_VERSION,
        **extra,
    }


def _per_second_quote(rate: str, duration: int, profile: str, resolution: str) -> Dict[str, Any]:
    credits, provider_cost = _credits_from_cny_per_second(rate, duration)
    return _fixed_quote(
        credits,
        profile,
        duration_seconds=duration,
        resolution=resolution,
        provider_cost_cny=str(provider_cost.normalize()),
        conversion_credits_per_cny=str(CREDITS_PER_CNY),
    )


def _infer_family(params: Mapping[str, Any]) -> str:
    task_type = _lower(params.get("task_type"))
    model = _lower(params.get("model") or params.get("video_model"))

    if task_type.startswith("happyhorse_") or model == "happyhorse":
        return "happyhorse"
    if task_type.startswith("vidu_") or model == "vidu":
        return "vidu"
    if task_type.startswith("kling_") or model == "kling":
        return "kling"
    if task_type == "wan26_i2v" or model == "大能":
        return "wan26"
    if task_type.startswith("seedance_") or model.startswith("seedance"):
        return "seedance"
    if task_type.startswith("minimax_") or model == "mini":
        return "minimax-api"
    if task_type.startswith("sora2_") or model == "sora2":
        return "sora2"
    if task_type.startswith("veo_") or model == "veo":
        return "veo"
    if model in LOCAL_MODELS or task_type in {"i2v", "morph"}:
        return "local"
    return "unknown"


def _quote_minimax(params: Mapping[str, Any]) -> Dict[str, Any]:
    model = _lower(params.get("minimax_model") or params.get("model_name") or params.get("model"))
    fast = "fast" in model
    duration = _positive_int(params.get("duration_seconds") or params.get("duration"), 6)
    resolution = _resolution(params, "768P")
    key = (resolution, 10 if duration == 10 else 6)
    standard = {("768P", 6): 40, ("768P", 10): 80, ("1080P", 6): 70}
    fast_prices = {("768P", 6): 27, ("768P", 10): 45, ("1080P", 6): 46}
    table = fast_prices if fast else standard
    normalized_key = key if key in table else ("768P", 6)
    return _fixed_quote(
        table[normalized_key],
        "minimax-hailuo-fast" if fast else "minimax-hailuo",
        duration_seconds=normalized_key[1],
        resolution=normalized_key[0],
    )


def _quote_seedance(params: Mapping[str, Any]) -> Dict[str, Any]:
    model = _lower(params.get("model"))
    sub_model = _lower(params.get("sub_model"))
    if "mini" in model or sub_model == "mini":
        tier = "mini"
    elif "fast" in model or sub_model == "fast":
        tier = "fast"
    elif model == "seedance15":
        tier = "1.5"
    else:
        tier = "standard"
    resolution = _resolution(params, "720P")
    duration = _positive_int(params.get("duration_seconds") or params.get("duration"), 5)
    # Product tiers derived from the active Ark/package cost order.  They stay
    # below HappyHorse for the same duration and are intentionally explicit
    # because Seedance is billed in video tokens rather than CNY/second.
    five_second_credits = {
        "mini": {"480P": 35, "720P": 50, "1080P": 70},
        "fast": {"480P": 50, "720P": 75, "1080P": 105},
        "1.5": {"480P": 55, "720P": 80, "1080P": 115},
        "standard": {"480P": 65, "720P": 95, "1080P": 135},
    }
    base = five_second_credits[tier].get(resolution, five_second_credits[tier]["720P"])
    credits = int((Decimal(base) * Decimal(duration) / Decimal(5)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return _fixed_quote(
        credits,
        f"seedance-{tier}",
        duration_seconds=duration,
        resolution=resolution,
        basis="ark-video-token-tier",
    )


def _quote_vidu(params: Mapping[str, Any]) -> Dict[str, Any]:
    task_type = _lower(params.get("task_type"))
    sub_model = _lower(params.get("sub_model") or "q3")
    resolution = _resolution(params, "720P")
    duration = _positive_int(params.get("duration_seconds") or params.get("duration"), 5)
    reference = task_type != "vidu_morph"

    if reference:
        rates = {
            "q3-mix": {"720P": "0.78125", "1080P": "0.9375"},
            "q3": {"540P": "0.3125", "720P": "0.625", "1080P": "0.78125"},
            "q3-turbo": {"540P": "0.15625", "720P": "0.3125", "1080P": "0.40625"},
            "q2-pro": {"540P": "0.25", "720P": "0.3125", "1080P": "0.78125"},
            "q2": {"540P": "0.21875", "720P": "0.28125", "1080P": "0.71875"},
            "q2-turbo": {"540P": "0.0875", "720P": "0.25", "1080P": "0.46875"},
        }
    else:
        rates = {
            "q3-pro": {"540P": "0.3125", "720P": "0.78125", "1080P": "0.9375"},
            "q3": {"540P": "0.3125", "720P": "0.78125", "1080P": "0.9375"},
            "q3-turbo": {"540P": "0.25", "720P": "0.375", "1080P": "0.4375"},
            "q2-pro": {"540P": "0.15625", "720P": "0.34375", "1080P": "0.71875"},
            "q2": {"540P": "0.15625", "720P": "0.34375", "1080P": "0.71875"},
            "q2-turbo": {"540P": "0.0875", "720P": "0.25", "1080P": "0.46875"},
        }
    model_rates = rates.get(sub_model) or rates.get("q3") or next(iter(rates.values()))
    rate = model_rates.get(resolution) or model_rates.get("720P") or next(iter(model_rates.values()))
    return _per_second_quote(rate, duration, f"vidu-{sub_model}-{'reference' if reference else 'start-end'}", resolution)


def quote_video_credits(params: Mapping[str, Any] | None) -> Dict[str, Any]:
    """Return the server-owned quote for one video generation task."""
    data: Mapping[str, Any] = params or {}
    family = _infer_family(data)

    if family == "local":
        return _fixed_quote(LOCAL_VIDEO_CREDITS, "local", duration_seconds=_positive_int(data.get("duration_seconds"), 5))
    if family == "minimax-api":
        return _quote_minimax(data)
    if family == "seedance":
        return _quote_seedance(data)

    duration_defaults = {"sora2": 15, "veo": 8}
    duration = _positive_int(data.get("duration_seconds") or data.get("duration"), duration_defaults.get(family, 5))
    if family == "happyhorse":
        resolution = _resolution(data, "1080P")
        rate = "1.6" if resolution == "1080P" else "0.9"
        return _per_second_quote(rate, duration, "happyhorse-1.0-r2v", resolution)
    resolution = _resolution(data, "1080P" if family == "wan26" else "720P")
    if family == "kling":
        has_reference = bool(data.get("has_reference_video"))
        with_audio = bool(data.get("audio"))
        expensive = has_reference or with_audio
        rate = ("1.2" if expensive else "0.8") if resolution == "1080P" else ("0.9" if expensive else "0.6")
        return _per_second_quote(rate, duration, "kling-v3", resolution)
    if family == "vidu":
        return _quote_vidu(data)
    if family == "wan26":
        rate = "1.0" if resolution == "1080P" else "0.6"
        return _per_second_quote(rate, duration, "wan2.6-i2v", resolution)
    if family == "sora2":
        # Active gateway model is a fixed 15-second landscape SKU.  The tier is
        # kept below same-duration HappyHorse while remaining above local/API
        # economy models.
        return _fixed_quote(120, "sora2-gateway-15s", duration_seconds=duration, resolution=resolution)
    if family == "veo":
        return _fixed_quote(110, "veo-3.1-fast-gateway", duration_seconds=duration, resolution=resolution)

    # Unknown legacy video task: charge the local minimum rather than making a
    # generation free or trusting a caller-provided price.
    return _fixed_quote(LOCAL_VIDEO_CREDITS, "legacy-unknown", duration_seconds=duration, resolution=resolution)
