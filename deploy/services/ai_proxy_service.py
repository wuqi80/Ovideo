"""Service helpers for external AI proxy calls.

This module keeps provider resolution and HTTP request details out of route
handlers. The routers keep auth, task persistence, and response shaping.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterator, List, Optional

import requests

from services.api_provider_health_monitor import list_cached_provider_health
from services.api_provider_registry import (
    get_gpt_image_tier,
    get_gpt_image_tiers,
    normalize_gemini_image_model,
)
from services.api_provider_runtime import (
    provider_fallback_chain,
    resolve_provider,
    resolve_provider_with_failover,
)

logger = logging.getLogger(__name__)


class AIProxyError(RuntimeError):
    def __init__(
        self,
        detail: str,
        *,
        status_code: int = 500,
        upstream: str = "",
    ):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.upstream = upstream


class AIProxyConfigError(AIProxyError):
    pass


class AIProxyUpstreamError(AIProxyError):
    pass


@dataclass(frozen=True)
class GptImageReferenceInput:
    filename: str
    content: bytes
    mime_type: str


@dataclass(frozen=True)
class TextGenerationResult:
    content: str
    provider: str
    model_name: str
    failover: Dict[str, Any]


DEEPSEEK_SYSTEM_PROMPT = "You are a helpful assistant for storyboard generation tasks."


def _unique_provider_ids(items: List[Optional[str]]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for item in items:
        provider = str(item or "").strip().lower()
        if not provider or provider in seen:
            continue
        seen.add(provider)
        out.append(provider)
    return out


def provider_health_scope_for_failover(provider: str) -> List[str]:
    return _unique_provider_ids(
        [
            provider,
            *[entry.get("provider") for entry in provider_fallback_chain(provider)],
        ]
    )


async def resolve_ai_proxy_provider(
    provider: str,
    model: Optional[str] = None,
    *,
    health_providers: Optional[List[str]] = None,
) -> tuple[Any, Dict[str, Any]]:
    """Resolve a provider with registry-declared failover and cached health.

    Health checks are best effort: if Redis/cache is unavailable, resolver still
    falls back only for static reasons such as missing key/endpoint.
    """
    providers = health_providers or provider_health_scope_for_failover(provider)
    try:
        provider_health = await list_cached_provider_health(providers)
    except Exception as health_error:
        logger.warning("%s failover health cache unavailable: %s", provider, health_error)
        provider_health = []

    config, failover = resolve_provider_with_failover(
        provider,
        model,
        provider_health=provider_health,
    )
    if failover.get("active"):
        logger.warning(
            "AI provider failover active: requested=%s selected=%s reason=%s",
            failover.get("requested_provider"),
            failover.get("selected_provider"),
            failover.get("reason"),
        )
    return config, failover


def build_chat_payload(
    *,
    model: str,
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 1.0,
) -> Dict[str, Any]:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    return {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }


def ensure_deepseek_configured(model: Optional[str] = None) -> None:
    config = resolve_provider("deepseek", model)
    if not config.api_key:
        raise AIProxyConfigError(
            "DeepSeek 服务未配置，请在管理后台 (Admin → API 配置) 添加 deepseek 提供商的 API Key 后重试",
            status_code=503,
        )
    if not config.endpoint:
        raise AIProxyConfigError("DeepSeek 服务 endpoint 未配置，请联系管理员", status_code=503)


def build_deepseek_payload(
    *,
    prompt: str,
    model: str,
    response_format: str = "text",
    temperature: float = 0.2,
    stream: bool = False,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": DEEPSEEK_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": stream,
        "temperature": temperature,
    }
    if response_format == "json":
        payload["response_format"] = {"type": "json_object"}
    return payload


def _sse_event(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _deepseek_chat_url(model: Optional[str]) -> tuple[str, Dict[str, Any], str]:
    config = resolve_provider("deepseek", model)
    if not config.api_key:
        raise AIProxyConfigError(
            "DeepSeek 服务未配置，请在管理后台 (Admin → API 配置) 添加 deepseek 提供商的 API Key 后重试",
            status_code=503,
        )
    if not config.endpoint:
        raise AIProxyConfigError("DeepSeek 服务 endpoint 未配置，请联系管理员", status_code=503)
    resolved_model = config.model_name or model or "deepseek-reasoner"
    return config.url_for("chat/completions"), {
        "headers": {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        **config.requests_kwargs(),
    }, resolved_model


def generate_deepseek_text(
    *,
    prompt: str,
    response_format: str = "text",
    temperature: float = 0.2,
    model: Optional[str] = None,
) -> str:
    url, request_kwargs, resolved_model = _deepseek_chat_url(model)
    payload = build_deepseek_payload(
        prompt=prompt,
        model=resolved_model,
        response_format=response_format,
        temperature=temperature,
        stream=False,
    )
    try:
        response = requests.post(
            url,
            json=payload,
            timeout=180,
            **request_kwargs,
        )
        if response.status_code >= 400:
            upstream = (response.text or "")[:500]
            logger.error("DeepSeek upstream failed: status=%s body=%s", response.status_code, upstream)
            raise AIProxyUpstreamError(
                f"DeepSeek API 调用失败: {upstream[:200] or response.status_code}",
                status_code=502,
                upstream=upstream,
            )
        result = response.json()
    except AIProxyError:
        raise
    except requests.Timeout as e:
        raise AIProxyUpstreamError("DeepSeek API 调用超时，请稍后重试", status_code=504) from e
    except requests.RequestException as e:
        logger.error("DeepSeek request failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("DeepSeek API 调用失败，请稍后重试") from e
    except ValueError as e:
        logger.error("DeepSeek response JSON parse failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("DeepSeek 响应格式异常") from e

    message = (result.get("choices") or [{}])[0].get("message") or {}
    content = message.get("content", "")
    if not content:
        raise AIProxyUpstreamError("AI服务返回空内容")
    return content


def stream_deepseek_chat(
    *,
    prompt: str,
    response_format: str = "text",
    temperature: float = 0.2,
    model: Optional[str] = None,
    on_complete: Optional[Callable[[str], None]] = None,
) -> Iterator[str]:
    """Yield DeepSeek chat chunks in the route's existing SSE event format."""
    try:
        url, request_kwargs, resolved_model = _deepseek_chat_url(model)
        payload = build_deepseek_payload(
            prompt=prompt,
            model=resolved_model,
            response_format=response_format,
            temperature=temperature,
            stream=True,
        )
    except AIProxyError as e:
        yield _sse_event({"type": "error", "message": e.detail})
        yield "data: [DONE]\n\n"
        return

    try:
        response = requests.post(
            url,
            json=payload,
            stream=True,
            timeout=(20, 600),
            **request_kwargs,
        )
    except requests.Timeout as e:
        logger.error("DeepSeek stream request timeout: %s", e, exc_info=True)
        yield _sse_event({"type": "error", "message": "DeepSeek API 调用超时，请稍后重试"})
        yield "data: [DONE]\n\n"
        return
    except requests.RequestException as e:
        logger.error("DeepSeek stream request failed: %s", e, exc_info=True)
        yield _sse_event({"type": "error", "message": f"DeepSeek API 调用失败: {str(e)[:200]}"})
        yield "data: [DONE]\n\n"
        return

    full_content: List[str] = []
    try:
        if response.status_code >= 400:
            upstream = (response.text or "")[:500]
            logger.error("DeepSeek stream upstream failed: status=%s body=%s", response.status_code, upstream)
            yield _sse_event({"type": "error", "message": f"DeepSeek API 调用失败: {upstream[:200] or response.status_code}"})
            yield "data: [DONE]\n\n"
            return

        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            line = raw_line.decode("utf-8", errors="ignore") if isinstance(raw_line, bytes) else raw_line
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data:
                continue
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
                choices = chunk.get("choices") or []
                delta = (choices[0].get("delta") or {}) if choices else {}
            except Exception as e:
                logger.warning("DeepSeek stream chunk parse failed: %s | data=%s", e, data[:200])
                continue

            reasoning_content = delta.get("reasoning_content")
            if reasoning_content:
                yield _sse_event({"type": "reasoning", "content": reasoning_content})

            content_piece = delta.get("content")
            if content_piece:
                full_content.append(content_piece)
                yield _sse_event({"type": "content", "content": content_piece})
    except Exception as e:
        logger.error("DeepSeek stream read failed: %s", e, exc_info=True)
        yield _sse_event({"type": "error", "message": f"DeepSeek 流式读取失败: {str(e)[:200]}"})
    finally:
        response.close()

    yield "data: [DONE]\n\n"

    if on_complete and full_content:
        on_complete("".join(full_content))


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

    if not config.api_key:
        raise AIProxyConfigError("文本生成服务未配置，请联系管理员")
    if not config.endpoint:
        raise AIProxyConfigError("文本生成服务 endpoint 未配置，请联系管理员")

    url = config.url_for("chat/completions")
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    payload = build_chat_payload(
        model=config.model_name or model or "gemini-2.5-flash",
        prompt=prompt,
        system_prompt=system_prompt,
        temperature=temperature,
    )

    try:
        response = await asyncio.to_thread(
            requests.post,
            url,
            headers=headers,
            json=payload,
            timeout=120,
            **config.requests_kwargs(),
        )
        response.raise_for_status()
        result = response.json()
    except requests.HTTPError as e:
        upstream = ""
        if getattr(e, "response", None) is not None:
            upstream = (e.response.text or "")[:500]
        logger.error("Gemini text upstream HTTP error: %s | upstream=%s", e, upstream)
        detail = f"文本生成失败：{upstream[:200]}" if upstream else "文本生成失败，请稍后重试"
        raise AIProxyUpstreamError(detail, upstream=upstream) from e
    except requests.RequestException as e:
        logger.error("Gemini text request failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("文本生成失败，请稍后重试") from e
    except ValueError as e:
        logger.error("Gemini text response JSON parse failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("文本生成服务响应格式异常") from e

    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    return TextGenerationResult(
        content=content,
        provider=config.provider,
        model_name=config.model_name or model or "gemini-2.5-flash",
        failover=failover,
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


def build_gemini_image_payload(
    *,
    parts: List[Dict[str, Any]],
    model: str,
    aspect_ratio: str,
    image_size: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
            },
        },
    }
    if model == "gemini-3.1-flash-image-preview" and image_size:
        payload["generationConfig"]["imageConfig"]["imageSize"] = image_size
    return payload


async def generate_gemini_images(
    *,
    parts: List[Dict[str, Any]],
    requested_model: Optional[str],
    aspect_ratio: str,
    image_size: Optional[str] = None,
) -> tuple[List[str], str]:
    explicit_model = normalize_gemini_image_model(requested_model)
    config = resolve_provider("gemini-image", explicit_model)
    model = config.model_name or explicit_model or "gemini-2.5-flash-image"
    if not config.api_key:
        raise AIProxyConfigError("图像生成服务未配置，请联系管理员")
    if not config.endpoint:
        raise AIProxyConfigError("图像生成服务 endpoint 未配置，请联系管理员")

    url = config.url_for(f"models/{model}:generateContent")
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    payload = build_gemini_image_payload(
        parts=parts,
        model=model,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
    )

    try:
        response = await asyncio.to_thread(
            requests.post,
            url,
            headers=headers,
            json=payload,
            timeout=180,
            **config.requests_kwargs(),
        )
        response.raise_for_status()
        result = response.json()
    except requests.HTTPError as e:
        upstream = ""
        if getattr(e, "response", None) is not None:
            upstream = (e.response.text or "")[:500]
        logger.error("Gemini image upstream HTTP error: %s | upstream=%s", e, upstream)
        detail = f"图像生成失败：{upstream[:200]}" if upstream else "图像生成失败，请稍后重试"
        raise AIProxyUpstreamError(detail, upstream=upstream) from e
    except requests.RequestException as e:
        logger.error("Gemini image request failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("图像生成失败，请稍后重试") from e
    except ValueError as e:
        logger.error("Gemini image response JSON parse failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("图像生成服务响应格式异常") from e

    images: List[str] = []
    for candidate in result.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "inlineData" in part:
                mime_type = part["inlineData"]["mimeType"]
                data = part["inlineData"]["data"]
                images.append(f"data:{mime_type};base64,{data}")
    if not images:
        raise AIProxyUpstreamError("图像生成服务未返回结果")
    return images, model


def resolve_gpt_image_tier_config(tier: Optional[str]) -> tuple[str, Dict[str, Any]]:
    try:
        return get_gpt_image_tier(tier)
    except KeyError as exc:
        expected = "|".join(sorted(get_gpt_image_tiers()))
        raise AIProxyError(f"Unsupported tier: {tier} (expected {expected})", status_code=400) from exc


def normalize_gpt_image_tier(tier: Optional[str]) -> str:
    resolved_tier, _ = resolve_gpt_image_tier_config(tier)
    return resolved_tier


def build_gpt_image_generation_payload(
    *,
    model: str,
    prompt: str,
    n: int,
    size: Optional[str],
    quality: Optional[str],
) -> Dict[str, Any]:
    return {
        "model": model,
        "prompt": prompt,
        "n": max(1, min(4, n or 1)),
        "size": size or "auto",
        "quality": quality or "auto",
    }


def build_gpt_image_edit_data(
    *,
    model: str,
    prompt: str,
    n: int,
    size: Optional[str],
    quality: Optional[str],
) -> Dict[str, str]:
    payload = build_gpt_image_generation_payload(
        model=model,
        prompt=prompt,
        n=n,
        size=size,
        quality=quality,
    )
    return {key: str(value) for key, value in payload.items()}


def parse_openai_image_response(result: Dict[str, Any]) -> List[str]:
    images: List[str] = []
    for item in result.get("data", []) or []:
        if item.get("b64_json"):
            images.append(f"data:image/png;base64,{item['b64_json']}")
        elif item.get("url"):
            images.append(item["url"])
    return images


async def generate_gpt_images(
    *,
    tier: Optional[str],
    prompt: str,
    references: List[GptImageReferenceInput],
    n: int,
    size: Optional[str] = "auto",
    quality: Optional[str] = "auto",
) -> tuple[List[str], str, str]:
    resolved_tier, tier_config = resolve_gpt_image_tier_config(tier)
    provider = tier_config["provider"]
    model = tier_config["model"]
    key_hint = tier_config["key_hint"]

    config = resolve_provider(provider, model)
    if not config.api_key:
        raise AIProxyConfigError(f"图像生成服务未配置 {key_hint}，请管理员在后台填入 API Key")
    if not config.endpoint:
        raise AIProxyConfigError(f"图像生成服务 endpoint 未配置 {key_hint}，请管理员在后台填入 endpoint")

    try:
        if references:
            data = build_gpt_image_edit_data(
                model=model,
                prompt=prompt,
                n=n,
                size=size,
                quality=quality,
            )
            files = [
                ("image[]", (ref.filename, io.BytesIO(ref.content), ref.mime_type))
                for ref in references
            ]
            headers = {"Authorization": f"Bearer {config.api_key}"}
            url = config.url_for("images/edits")
            logger.info(
                "GPT Image edit -> tier=%s model=%s refs=%s size=%s quality=%s",
                resolved_tier,
                model,
                len(references),
                data["size"],
                data["quality"],
            )
            response = await asyncio.to_thread(
                requests.post,
                url,
                headers=headers,
                data=data,
                files=files,
                timeout=240,
                **config.requests_kwargs(),
            )
        else:
            payload = build_gpt_image_generation_payload(
                model=model,
                prompt=prompt,
                n=n,
                size=size,
                quality=quality,
            )
            headers = {
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
            }
            url = config.url_for("images/generations")
            logger.info(
                "GPT Image generate -> tier=%s model=%s size=%s quality=%s",
                resolved_tier,
                model,
                payload["size"],
                payload["quality"],
            )
            response = await asyncio.to_thread(
                requests.post,
                url,
                headers=headers,
                json=payload,
                timeout=240,
                **config.requests_kwargs(),
            )

        if response.status_code >= 400:
            upstream = (response.text or "")[:500]
            logger.error("GPT Image upstream failed: status=%s body=%s", response.status_code, upstream)
            raise AIProxyUpstreamError(
                f"上游图像生成失败 ({response.status_code})，请检查 API Key 或稍后重试",
                status_code=502,
                upstream=upstream,
            )
        result = response.json()
    except AIProxyError:
        raise
    except requests.Timeout as e:
        logger.error("GPT Image request timeout: %s", e, exc_info=True)
        raise AIProxyUpstreamError("图像生成超时，请稍后重试", status_code=504) from e
    except requests.RequestException as e:
        logger.error("GPT Image request failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("图像生成失败，请稍后重试") from e
    except ValueError as e:
        logger.error("GPT Image response JSON parse failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("GPT Image 响应格式异常") from e

    images = parse_openai_image_response(result)
    if not images:
        raise AIProxyUpstreamError("GPT Image 未返回图片")
    return images, model, resolved_tier


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
    if not config.api_key:
        raise AIProxyConfigError("未配置 ARK_API_KEY，无法调用豆包接口")
    if not config.endpoint:
        raise AIProxyConfigError("未配置豆包 endpoint，无法调用豆包接口")

    payload = build_doubao_image_payload(
        prompt=prompt,
        model=config.model_name or model or "doubao-seedream-4-0-250828",
        size=size,
        sequential=sequential,
        count=count,
        reference_inputs=reference_inputs,
    )
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.api_key}",
    }
    try:
        response = await asyncio.to_thread(
            requests.post,
            config.url_for(),
            headers=headers,
            json=payload,
            timeout=120,
            **config.requests_kwargs(),
        )
        if response.status_code != 200:
            upstream = (response.text or "")[:500]
            logger.error("Doubao image upstream failed: status=%s body=%s", response.status_code, upstream)
            raise AIProxyUpstreamError(f"豆包生成失败: {upstream[:200]}", upstream=upstream)
        result = response.json()
    except AIProxyError:
        raise
    except requests.RequestException as e:
        logger.error("Doubao image request failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("图像生成失败，请稍后重试") from e
    except ValueError as e:
        logger.error("Doubao image response JSON parse failed: %s", e, exc_info=True)
        raise AIProxyUpstreamError("豆包响应格式异常") from e

    images: List[str] = []
    for item in result.get("data", []):
        if item.get("b64_json"):
            images.append(f"data:image/png;base64,{item['b64_json']}")
        elif item.get("url"):
            images.append(item["url"])
    if not images:
        raise AIProxyUpstreamError("豆包未返回图片")
    return images
