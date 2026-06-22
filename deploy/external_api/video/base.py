"""Shared helpers for external video API clients."""
from __future__ import annotations

import logging
from typing import Any, Dict, Mapping, Optional

import requests


def request_json(
    method: str,
    url: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    timeout: int = 30,
    request_kwargs: Optional[Dict[str, Any]] = None,
    logger: Optional[logging.Logger] = None,
    label: str = "video api",
    **kwargs: Any,
) -> Any:
    """Send an HTTP request and return a JSON response with shared runtime kwargs."""
    log = logger or logging.getLogger(__name__)
    options = dict(request_kwargs or {})
    options.update(kwargs)
    response = requests.request(
        method.upper(),
        url,
        headers=dict(headers or {}),
        timeout=timeout,
        **options,
    )
    if not getattr(response, "ok", True):
        log.error(
            "%s JSON request failed: HTTP %s body=%s",
            label,
            getattr(response, "status_code", "?"),
            str(getattr(response, "text", ""))[:500],
        )
    response.raise_for_status()
    data = response.json()
    log.debug("%s JSON request complete: %s %s", label, method.upper(), url)
    return data


def request_multipart_json(
    method: str,
    url: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    files: Optional[Mapping[str, Any]] = None,
    data: Optional[Mapping[str, Any]] = None,
    timeout: int = 30,
    request_kwargs: Optional[Dict[str, Any]] = None,
    logger: Optional[logging.Logger] = None,
    label: str = "video api",
) -> Any:
    """Send a multipart request and return a JSON response with shared runtime kwargs."""
    log = logger or logging.getLogger(__name__)
    options = dict(request_kwargs or {})
    response = requests.request(
        method.upper(),
        url,
        headers=dict(headers or {}),
        files=files,
        data=data,
        timeout=timeout,
        **options,
    )
    if not getattr(response, "ok", True):
        log.error(
            "%s multipart request failed: HTTP %s body=%s",
            label,
            getattr(response, "status_code", "?"),
            str(getattr(response, "text", ""))[:500],
        )
    response.raise_for_status()
    result = response.json()
    log.debug("%s multipart request complete: %s %s", label, method.upper(), url)
    return result


def download_streaming_video(
    url: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    timeout: int = 120,
    request_kwargs: Optional[Dict[str, Any]] = None,
    logger: Optional[logging.Logger] = None,
    label: str = "video",
    chunk_size: int = 8192,
) -> bytes:
    """Download a video URL with shared streaming/chunk handling."""
    log = logger or logging.getLogger(__name__)
    kwargs = request_kwargs or {}
    response = requests.get(
        url,
        headers=dict(headers or {}),
        stream=True,
        timeout=timeout,
        **kwargs,
    )
    response.raise_for_status()

    chunks = [chunk for chunk in response.iter_content(chunk_size=chunk_size) if chunk]
    data = b"".join(chunks)
    log.info("%s download complete: %s bytes", label, len(data))
    return data
