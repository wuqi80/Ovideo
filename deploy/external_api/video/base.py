"""Shared helpers for external video API clients."""
from __future__ import annotations

import logging
from typing import Any, Dict, Mapping, Optional

import requests


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
