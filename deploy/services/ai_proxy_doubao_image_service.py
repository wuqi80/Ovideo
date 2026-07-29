"""Doubao image provider helpers for AI proxy calls."""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from typing import Any, Dict, List, Optional

import requests

from services.api_provider_registry import (
    DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    DOUBAO_IMAGE_DEFAULT_MODEL,
    doubao_image_access_mode,
    normalize_doubao_image_model_for_endpoint,
)
from services.api_provider_runtime import resolve_provider
from services.ai_proxy_http_client import _post_json_request_async
from services.ai_proxy_openai_image_service import parse_openai_image_response
from services.ai_proxy_types import AIProxyConfigError, AIProxyUpstreamError

logger = logging.getLogger(__name__)

DOUBAO_IMAGE_TASK_PENDING_STATUSES = {"queued", "pending", "running", "processing", "in_progress"}
DOUBAO_IMAGE_TASK_SUCCESS_STATUSES = {"succeeded", "success", "completed", "done"}
DOUBAO_IMAGE_TASK_FAILED_STATUSES = {"failed", "error", "cancelled", "canceled", "expired"}


def normalize_doubao_image_size(size: str, *, minimum_square: Optional[int] = None) -> str:
    value = (size or "").strip().lower().replace("×", "x").replace("*", "x")
    value = re.sub(r"\s+", "", value)

    if value == "1k":
        if minimum_square and minimum_square > 1024:
            return f"{minimum_square}x{minimum_square}"
        return "1024x1024"
    if value in {"2k", "3k", "4k"}:
        return value

    match = re.fullmatch(r"(\d+)x(\d+)", value)
    if match:
        width = int(match.group(1))
        height = int(match.group(2))
        if minimum_square and width * height < minimum_square * minimum_square:
            scale = math.sqrt((minimum_square * minimum_square) / (width * height))
            width = math.ceil((width * scale) / 16) * 16
            height = math.ceil((height * scale) / 16) * 16
        return f"{width}x{height}"

    if minimum_square:
        return f"{minimum_square}x{minimum_square}"
    return "1024x1024"


def build_doubao_image_payload(
    *,
    prompt: str,
    model: str,
    size: str,
    sequential: str,
    count: int,
    reference_inputs: List[str],
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "size": normalize_doubao_image_size(size),
        "sequential_image_generation": sequential,
        "stream": False,
        "response_format": "b64_json",
        "watermark": False,
    }
    if reference_inputs:
        payload["image"] = reference_inputs[0] if len(reference_inputs) == 1 else reference_inputs
    if sequential == "auto":
        requested = max(1, min(15, int(count or 1)))
        if reference_inputs:
            requested = min(requested, max(1, 15 - len(reference_inputs)))
        payload["sequential_image_generation_options"] = {"max_images": requested}
    return payload


def parse_doubao_image_response(result: Dict[str, Any]) -> List[str]:
    return parse_openai_image_response(result)


def _is_image_value(value: str) -> bool:
    return value.startswith(("http://", "https://", "data:image/"))


def _collect_image_outputs(value: Any, images: List[str]) -> None:
    if isinstance(value, str):
        if _is_image_value(value):
            images.append(value)
        return
    if isinstance(value, list):
        for item in value:
            _collect_image_outputs(item, images)
        return
    if not isinstance(value, dict):
        return

    b64_value = value.get("b64_json") or value.get("image_base64")
    if isinstance(b64_value, str) and b64_value:
        prefix = "" if b64_value.startswith("data:image/") else "data:image/png;base64,"
        images.append(f"{prefix}{b64_value}")

    for key in (
        "url",
        "image_url",
        "image_urls",
        "image",
        "images",
        "output",
        "outputs",
        "result",
        "results",
        "data",
        "content",
    ):
        if key in value:
            _collect_image_outputs(value.get(key), images)


def parse_doubao_image_task_response(result: Dict[str, Any]) -> List[str]:
    images = parse_doubao_image_response(result)
    for key in ("content", "output", "result", "data"):
        _collect_image_outputs(result.get(key), images)

    deduped: List[str] = []
    seen = set()
    for image in images:
        if image and image not in seen:
            seen.add(image)
            deduped.append(image)
    return deduped


def _extract_task_id(result: Dict[str, Any]) -> Optional[str]:
    for key in ("id", "task_id"):
        value = result.get(key)
        if value:
            return str(value)
    for container_key in ("data", "output", "result"):
        container = result.get(container_key)
        if isinstance(container, dict):
            for key in ("id", "task_id"):
                value = container.get(key)
                if value:
                    return str(value)
    return None


def _task_status(result: Dict[str, Any]) -> str:
    for key in ("status", "task_status"):
        value = result.get(key)
        if value:
            return str(value).strip().lower()
    for container_key in ("data", "output", "result"):
        container = result.get(container_key)
        if isinstance(container, dict):
            for key in ("status", "task_status"):
                value = container.get(key)
                if value:
                    return str(value).strip().lower()
    return ""


def _task_error(result: Dict[str, Any]) -> str:
    for key in ("error", "message", "status_message", "task_status_msg"):
        value = result.get(key)
        if value:
            return str(value)
    for container_key in ("data", "output", "result"):
        container = result.get(container_key)
        if isinstance(container, dict):
            nested = _task_error(container)
            if nested:
                return nested
    return str(result)[:500]


def _get_json_request(
    *,
    label: str,
    url: str,
    headers: Dict[str, str],
    timeout: int,
    request_kwargs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        response = requests.get(
            url,
            headers=headers,
            timeout=timeout,
            **(request_kwargs or {}),
        )
        if response.status_code >= 400:
            upstream = (response.text or "")[:500]
            logger.error("%s upstream failed: status=%s body=%s", label, response.status_code, upstream)
            raise AIProxyUpstreamError(
                f"Doubao image task query failed: {upstream[:200] or response.status_code}",
                status_code=502,
                upstream=upstream,
            )
        try:
            return response.json()
        except ValueError as exc:
            raise AIProxyUpstreamError("Doubao image task response is not valid JSON") from exc
    except AIProxyUpstreamError:
        raise
    except requests.Timeout as exc:
        raise AIProxyUpstreamError("Doubao image task query timed out", status_code=504) from exc
    except requests.RequestException as exc:
        logger.error("%s request failed: %s", label, exc, exc_info=True)
        raise AIProxyUpstreamError("Doubao image task query failed") from exc


async def _get_json_request_async(**kwargs: Any) -> Dict[str, Any]:
    return await asyncio.to_thread(_get_json_request, **kwargs)


def _normalize_agent_plan_size(size: str) -> str:
    return normalize_doubao_image_size(size, minimum_square=2048)


def build_doubao_agent_plan_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    content: List[Dict[str, Any]] = []
    if prompt:
        content.append({"type": "text", "text": prompt})

    reference_inputs = payload.get("image")
    if isinstance(reference_inputs, str):
        reference_values = [reference_inputs]
    elif isinstance(reference_inputs, list):
        reference_values = [item for item in reference_inputs if isinstance(item, str) and item.strip()]
    else:
        reference_values = []

    for image_url in reference_values:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": image_url},
                "role": "reference_image",
            }
        )

    if not content:
        content.append({"type": "text", "text": "Generate a simple image."})

    requested_model = str(payload.get("model") or "").strip()
    if requested_model and requested_model != DOUBAO_IMAGE_AGENT_PLAN_MODEL:
        logger.info(
            "Doubao Agent Plan image model forced: requested=%s effective=%s",
            requested_model,
            DOUBAO_IMAGE_AGENT_PLAN_MODEL,
        )

    task_payload: Dict[str, Any] = {
        # Agent Plan content generation only supports the lite model. Keep this
        # guard inside the payload builder so stale DB rows or direct callers
        # cannot submit an incompatible SeedDream model.
        "model": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
        "content": content,
        "size": _normalize_agent_plan_size(str(payload.get("size") or "")),
        "response_format": "url",
        "watermark": bool(payload.get("watermark", False)),
    }
    return {key: value for key, value in task_payload.items() if value is not None}


async def _poll_doubao_image_task(
    *,
    config: Any,
    task_id: str,
    headers: Dict[str, str],
    max_wait: int = 180,
    interval: float = 3.0,
) -> List[str]:
    task_url = config.url_for_operation("task", task_id=task_id)
    deadline = time.monotonic() + max_wait
    last_payload: Dict[str, Any] = {}

    while time.monotonic() < deadline:
        payload = await _get_json_request_async(
            label="Doubao image task query",
            url=task_url,
            headers=headers,
            timeout=30,
            request_kwargs=config.requests_kwargs(),
        )
        last_payload = payload
        images = parse_doubao_image_task_response(payload)
        if images:
            return images

        status = _task_status(payload)
        if status in DOUBAO_IMAGE_TASK_FAILED_STATUSES:
            raise AIProxyUpstreamError(f"Doubao image task failed: {_task_error(payload)[:200]}")
        await asyncio.sleep(interval)

    raise AIProxyUpstreamError(
        f"Doubao image task timed out: task_id={task_id} last_status={_task_status(last_payload) or 'unknown'}",
        status_code=504,
    )


async def _post_doubao_image_task_generation(
    *,
    config: Any,
    payload: Dict[str, Any],
) -> List[str]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.api_key}",
    }
    logger.info(
        "Doubao image task create: endpoint=%s model=%s content_items=%s",
        config.url_for(),
        payload.get("model"),
        len(payload.get("content", [])) if isinstance(payload.get("content"), list) else 0,
    )
    result = await _post_json_request_async(
        label="Doubao image task create",
        url=config.url_for(),
        headers=headers,
        payload=payload,
        timeout=120,
        timeout_message="Doubao image task submission timed out, please try again later",
        timeout_status_code=504,
        request_error_message="Doubao image task submission failed, please try again later",
        parse_error_message="Doubao image task response is not valid JSON",
        request_kwargs=config.requests_kwargs(),
        expected_status=200,
        upstream_detail=lambda upstream, _status_code: f"Doubao image task submission failed: {upstream[:200]}",
        upstream_status_code=500,
    )
    direct_images = parse_doubao_image_task_response(result)
    if direct_images:
        return direct_images
    task_id = _extract_task_id(result)
    if not task_id:
        raise AIProxyUpstreamError(f"Doubao image task response did not include task id: {str(result)[:200]}")
    return await _poll_doubao_image_task(config=config, task_id=task_id, headers=headers)


async def _post_doubao_image_generation(
    *,
    config: Any,
    payload: Dict[str, Any],
) -> List[str]:
    if not config.api_key:
        raise AIProxyConfigError("未配置 ARK_API_KEY，无法调用豆包图片接口")
    if not config.endpoint:
        raise AIProxyConfigError("未配置豆包 endpoint，无法调用豆包图片接口")

    if doubao_image_access_mode(config.endpoint) == "agent_plan":
        payload = {
            **payload,
            # Agent Plan image generation only supports the lite model. Force this
            # at the final send boundary so stale DB rows or UI payloads cannot leak
            # a non-compatible SeedDream model into the upstream request.
            "model": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
            "size": _normalize_agent_plan_size(str(payload.get("size") or "")),
            "response_format": "url",
        }
    else:
        payload = {
            **payload,
            "size": normalize_doubao_image_size(str(payload.get("size") or "")),
        }

    result = await _post_json_request_async(
        label="Doubao image",
        url=config.url_for(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.api_key}",
        },
        payload=payload,
        timeout=120,
        timeout_message="图片生成超时，请稍后重试",
        timeout_status_code=500,
        request_error_message="图片生成失败，请稍后重试",
        parse_error_message="豆包响应格式异常",
        request_kwargs=config.requests_kwargs(),
        expected_status=200,
        upstream_detail=lambda upstream, _status_code: f"豆包生成失败: {upstream[:200]}",
        upstream_status_code=500,
    )
    return parse_doubao_image_response(result)


async def generate_doubao_images(
    *,
    prompt: str,
    reference_inputs: List[str],
    size: str,
    sequential: str,
    count: int,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> List[str]:
    config = (
        resolve_provider("doubao", model, usage_scope=usage_scope)
        if usage_scope is not None
        else resolve_provider("doubao", model)
    )
    resolved_model = normalize_doubao_image_model_for_endpoint(
        config.model_name or model or DOUBAO_IMAGE_DEFAULT_MODEL,
        config.endpoint,
    )
    resolved_size = (
        _normalize_agent_plan_size(size)
        if doubao_image_access_mode(config.endpoint) == "agent_plan"
        else normalize_doubao_image_size(size)
    )
    payload = build_doubao_image_payload(
        prompt=prompt,
        model=resolved_model,
        size=resolved_size,
        sequential=sequential,
        count=count,
        reference_inputs=reference_inputs,
    )
    images = await _post_doubao_image_generation(
        config=config,
        payload=payload,
    )
    if not images:
        raise AIProxyUpstreamError("豆包未返回图片")
    return images
