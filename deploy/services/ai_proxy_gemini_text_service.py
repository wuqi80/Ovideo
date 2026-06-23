"""Gemini text/chat helpers for AI proxy routes."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from services.api_provider_runtime import resolve_provider
from services.ai_proxy_chat_service import _post_chat_completion_result, build_chat_payload, resolve_ai_proxy_provider
from services.ai_proxy_types import TextGenerationResult


async def generate_gemini_text_result(
    *,
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 1.0,
    model: Optional[str] = None,
) -> TextGenerationResult:
    config, failover = await resolve_ai_proxy_provider(
        "gemini-text",
        model,
    )
    payload = build_chat_payload(
        model=config.model_name or model or "gemini-2.5-flash",
        prompt=prompt,
        system_prompt=system_prompt,
        temperature=temperature,
    )

    return await _post_chat_completion_result(
        config=config,
        failover=failover,
        messages=payload["messages"],
        temperature=temperature,
        requested_model=model,
        default_model="gemini-2.5-flash",
        label="Gemini text",
    )


async def generate_gemini_chat_result(
    *,
    messages: List[Dict[str, Any]],
    temperature: float = 1.0,
    model: Optional[str] = None,
    allow_failover: bool = True,
    label: str = "Gemini chat",
) -> TextGenerationResult:
    if allow_failover:
        config, failover = await resolve_ai_proxy_provider(
            "gemini-text",
            model,
        )
    else:
        config = resolve_provider("gemini-text", model)
        failover = {
            "active": False,
            "requested_provider": "gemini-text",
            "selected_provider": config.provider,
            "reason": None,
        }

    return await _post_chat_completion_result(
        config=config,
        failover=failover,
        messages=messages,
        temperature=temperature,
        requested_model=model,
        default_model="gemini-2.5-flash",
        label=label,
    )


async def generate_gemini_text(
    *,
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 1.0,
    model: Optional[str] = None,
) -> str:
    result = await generate_gemini_text_result(
        prompt=prompt,
        system_prompt=system_prompt,
        temperature=temperature,
        model=model,
    )
    return result.content


