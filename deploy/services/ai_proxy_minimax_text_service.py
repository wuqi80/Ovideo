"""MiniMax M3 streaming helpers for AI proxy routes."""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, Iterator, List, Optional

from services.ai_proxy_http_client import _ensure_stream_response_ok, _post_stream_request
from services.ai_proxy_types import AIProxyConfigError, AIProxyError, AIProxyUpstreamError
from services.api_provider_registry import MINIMAX_M3_MODEL, MINIMAX_M3_OPERATION
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)


MINIMAX_SYSTEM_PROMPT = "You are a helpful assistant for storyboard generation tasks."


def _resolve_minimax_config(model: Optional[str] = None) -> Any:
    config = resolve_provider("minimax", model or MINIMAX_M3_OPERATION)
    if not config.api_key:
        raise AIProxyConfigError(
            "MiniMax 服务未配置，请在管理后台 (Admin → API 配置) 添加 minimax 提供商的 API Key 后重试",
            status_code=503,
        )
    if not config.endpoint:
        raise AIProxyConfigError("MiniMax 服务 endpoint 未配置，请联系管理员", status_code=503)
    return config


def ensure_minimax_configured(model: Optional[str] = None) -> None:
    _resolve_minimax_config(model)


def build_minimax_payload(
    *,
    prompt: str,
    model: str,
    temperature: float = 0.2,
    stream: bool = True,
) -> Dict[str, Any]:
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": MINIMAX_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": stream,
        "temperature": temperature,
        "thinking": {"type": "adaptive"},
        "reasoning_split": True,
    }


def _sse_event(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _minimax_chat_url(model: Optional[str]) -> tuple[str, Dict[str, Any], str]:
    config = _resolve_minimax_config(model)
    resolved_model = config.model_name or MINIMAX_M3_MODEL
    return config.url_for_operation("chat_completions"), {
        "headers": {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        **config.requests_kwargs(),
    }, resolved_model


def stream_minimax_chat(
    *,
    prompt: str,
    response_format: str = "text",
    temperature: float = 0.2,
    model: Optional[str] = None,
    on_complete: Optional[Callable[[str], None]] = None,
    on_error: Optional[Callable[[str], None]] = None,
) -> Iterator[str]:
    """Yield MiniMax M3 chunks in the text route's shared SSE event format."""
    del response_format  # The script prompts already enforce JSON where required.
    try:
        url, request_kwargs, resolved_model = _minimax_chat_url(model)
        payload = build_minimax_payload(
            prompt=prompt,
            model=resolved_model,
            temperature=temperature,
        )
    except AIProxyError as exc:
        if on_error:
            on_error(exc.detail)
        yield _sse_event({"type": "error", "message": exc.detail})
        yield "data: [DONE]\n\n"
        return

    try:
        response = _post_stream_request(
            label="MiniMax M3 stream",
            url=url,
            payload=payload,
            timeout=(20, 180),
            timeout_message="MiniMax API 调用超时，请稍后重试",
            request_error_detail=lambda exc: f"MiniMax API 调用失败: {str(exc)[:200]}",
            request_kwargs=request_kwargs,
        )
    except AIProxyUpstreamError as exc:
        if on_error:
            on_error(exc.detail)
        yield _sse_event({"type": "error", "message": exc.detail})
        yield "data: [DONE]\n\n"
        return

    full_content: List[str] = []
    stream_error: Optional[str] = None
    try:
        _ensure_stream_response_ok(
            label="MiniMax",
            response=response,
            upstream_detail=lambda upstream, status_code: (
                f"MiniMax API 调用失败: {upstream[:200] or status_code}"
            ),
        )

        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            line = (
                raw_line.decode("utf-8", errors="ignore")
                if isinstance(raw_line, bytes)
                else raw_line
            )
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
            except Exception as exc:
                logger.warning(
                    "MiniMax stream chunk parse failed: %s | data=%s",
                    exc,
                    data[:200],
                )
                continue

            reasoning_content = delta.get("reasoning_content")
            if isinstance(reasoning_content, str) and reasoning_content:
                yield _sse_event({"type": "reasoning", "content": reasoning_content})

            content_piece = delta.get("content")
            if isinstance(content_piece, str) and content_piece:
                full_content.append(content_piece)
                yield _sse_event({"type": "content", "content": content_piece})
    except AIProxyUpstreamError as exc:
        stream_error = exc.detail
        yield _sse_event({"type": "error", "message": exc.detail})
    except GeneratorExit:
        if on_error:
            on_error("客户端中断 MiniMax 流式连接")
        raise
    except Exception as exc:
        logger.error("MiniMax stream read failed: %s", exc, exc_info=True)
        stream_error = f"MiniMax 流式读取失败: {str(exc)[:200]}"
        yield _sse_event({"type": "error", "message": stream_error})
    finally:
        response.close()

    if on_complete and full_content:
        on_complete("".join(full_content))
    elif on_error:
        on_error(stream_error or "MiniMax 返回空内容")

    yield "data: [DONE]\n\n"
