"""Service helpers for external AI proxy calls.

This module keeps provider resolution and HTTP request details out of route
handlers. The routers keep auth, task persistence, and response shaping.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from services.api_provider_runtime import resolve_provider
from services.ai_proxy_chat_service import provider_health_scope_for_failover
from services.ai_proxy_deepseek_service import (
    DEEPSEEK_SYSTEM_PROMPT,
    build_deepseek_payload,
    ensure_deepseek_configured,
    generate_deepseek_text,
    stream_deepseek_chat,
)
from services.ai_proxy_gemini_text_service import (
    generate_gemini_chat_result,
    generate_gemini_text,
    generate_gemini_text_result,
)
from services.ai_proxy_gemini_image_service import (
    build_gemini_image_payload,
    generate_gemini_images,
    parse_gemini_image_response,
)
from services.ai_proxy_http_client import _post_json_request_async
from services.ai_proxy_types import AIProxyConfigError, AIProxyUpstreamError

from services.ai_proxy_gpt_image_service import (
    build_gpt_image_edit_data,
    build_gpt_image_generation_payload,
    generate_gpt_images,
    normalize_gpt_image_tier,
    resolve_gpt_image_tier_config,
)
from services.ai_proxy_openai_image_service import parse_openai_image_response


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
        "size": size,
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


async def _post_doubao_image_generation(
    *,
    config: Any,
    payload: Dict[str, Any],
) -> List[str]:
    if not config.api_key:
        raise AIProxyConfigError("未配置 ARK_API_KEY，无法调用豆包接口")
    if not config.endpoint:
        raise AIProxyConfigError("未配置豆包 endpoint，无法调用豆包接口")

    result = await _post_json_request_async(
        label="Doubao image",
        url=config.url_for(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.api_key}",
        },
        payload=payload,
        timeout=120,
        timeout_message="图像生成失败，请稍后重试",
        timeout_status_code=500,
        request_error_message="图像生成失败，请稍后重试",
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
) -> List[str]:
    config = resolve_provider("doubao", model)
    payload = build_doubao_image_payload(
        prompt=prompt,
        model=config.model_name or model or "doubao-seedream-4-0-250828",
        size=size,
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
