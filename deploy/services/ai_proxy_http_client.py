"""HTTP helpers shared by AI proxy provider services."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Dict, Optional

import requests

from services.ai_proxy_types import AIProxyError, AIProxyUpstreamError

logger = logging.getLogger(__name__)


def _default_upstream_detail(label: str) -> Callable[[str, int], str]:
    return lambda upstream, status_code: f"{label} API 调用失败: {upstream[:200] or status_code}"


def _read_post_json_response(
    *,
    label: str,
    response: Any,
    parse_error_message: str,
    expected_status: Optional[int] = None,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
    upstream_status_code: int = 502,
) -> Dict[str, Any]:
    failed = response.status_code >= 400 if expected_status is None else response.status_code != expected_status
    if failed:
        upstream = (response.text or "")[:500]
        logger.error("%s upstream failed: status=%s body=%s", label, response.status_code, upstream)
        detail_factory = upstream_detail or _default_upstream_detail(label)
        raise AIProxyUpstreamError(
            detail_factory(upstream, response.status_code),
            status_code=upstream_status_code,
            upstream=upstream,
        )
    try:
        return response.json()
    except ValueError as e:
        logger.error("%s response JSON parse failed: %s", label, e, exc_info=True)
        raise AIProxyUpstreamError(parse_error_message) from e


def _post_json_request(
    *,
    label: str,
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    timeout: Any,
    timeout_message: str,
    request_error_message: str,
    parse_error_message: str,
    request_kwargs: Optional[Dict[str, Any]] = None,
    expected_status: Optional[int] = None,
    timeout_status_code: int = 504,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
    upstream_status_code: int = 502,
) -> Dict[str, Any]:
    """POST provider JSON while keeping provider-specific detail at call sites."""
    try:
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=timeout,
            **(request_kwargs or {}),
        )
        return _read_post_json_response(
            label=label,
            response=response,
            parse_error_message=parse_error_message,
            expected_status=expected_status,
            upstream_detail=upstream_detail,
            upstream_status_code=upstream_status_code,
        )
    except AIProxyError:
        raise
    except requests.Timeout as e:
        raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
    except requests.RequestException as e:
        logger.error("%s request failed: %s", label, e, exc_info=True)
        raise AIProxyUpstreamError(request_error_message) from e


async def _post_json_request_async(**kwargs: Any) -> Dict[str, Any]:
    return await asyncio.to_thread(_post_json_request, **kwargs)


def _post_form_request(
    *,
    label: str,
    url: str,
    headers: Dict[str, str],
    data: Dict[str, str],
    files: Any,
    timeout: Any,
    timeout_message: str,
    request_error_message: str,
    parse_error_message: str,
    request_kwargs: Optional[Dict[str, Any]] = None,
    expected_status: Optional[int] = None,
    timeout_status_code: int = 504,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
    upstream_status_code: int = 502,
) -> Dict[str, Any]:
    """POST provider multipart/form-data while sharing upstream response handling."""
    try:
        response = requests.post(
            url,
            headers=headers,
            data=data,
            files=files,
            timeout=timeout,
            **(request_kwargs or {}),
        )
        return _read_post_json_response(
            label=label,
            response=response,
            parse_error_message=parse_error_message,
            expected_status=expected_status,
            upstream_detail=upstream_detail,
            upstream_status_code=upstream_status_code,
        )
    except AIProxyError:
        raise
    except requests.Timeout as e:
        raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
    except requests.RequestException as e:
        logger.error("%s request failed: %s", label, e, exc_info=True)
        raise AIProxyUpstreamError(request_error_message) from e


async def _post_form_request_async(**kwargs: Any) -> Dict[str, Any]:
    return await asyncio.to_thread(_post_form_request, **kwargs)


def _post_stream_request(
    *,
    label: str,
    url: str,
    payload: Dict[str, Any],
    timeout: Any,
    timeout_message: str,
    request_error_detail: Callable[[Exception], str],
    request_kwargs: Optional[Dict[str, Any]] = None,
    timeout_status_code: int = 504,
) -> Any:
    """POST a streaming provider request and normalize connection errors."""
    try:
        return requests.post(
            url,
            json=payload,
            stream=True,
            timeout=timeout,
            **(request_kwargs or {}),
        )
    except requests.Timeout as e:
        logger.error("%s stream request timeout: %s", label, e, exc_info=True)
        raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
    except requests.RequestException as e:
        logger.error("%s stream request failed: %s", label, e, exc_info=True)
        raise AIProxyUpstreamError(request_error_detail(e)) from e


def _ensure_stream_response_ok(
    *,
    label: str,
    response: Any,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
) -> None:
    if response.status_code < 400:
        return
    upstream = (response.text or "")[:500]
    logger.error("%s stream upstream failed: status=%s body=%s", label, response.status_code, upstream)
    detail_factory = upstream_detail or _default_upstream_detail(label)
    raise AIProxyUpstreamError(
        detail_factory(upstream, response.status_code),
        upstream=upstream,
    )
