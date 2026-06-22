"""Helpers for resolving video source bytes before local processing."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable, Optional
from urllib.parse import urlencode

import requests

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ComfyUIFileFetchResult:
    content: bytes
    source_info: str
    file_type: str
    url: str


def get_comfyui_view_response(url: str, *, timeout: int = 30) -> requests.Response:
    """Fetch a ComfyUI /view response for route code that still streams/falls back."""
    return requests.get(url, timeout=timeout)


def fetch_comfyui_file_bytes(
    target_server: str,
    filename: str,
    *,
    file_types: Iterable[str] = ("output", "temp", "input"),
    timeout: int = 30,
    source_label: str = "ComfyUI",
) -> Optional[ComfyUIFileFetchResult]:
    """Try ComfyUI /view locations and return the first non-empty file."""
    base_url = f"{target_server.rstrip('/')}/view"
    for file_type in file_types:
        params = {"filename": filename, "type": file_type}
        display_url = f"{base_url}?{urlencode(params)}"
        try:
            response = requests.get(base_url, params=params, timeout=timeout)
            if response.ok and response.content:
                return ComfyUIFileFetchResult(
                    content=response.content,
                    source_info=f"{source_label}: {getattr(response, 'url', display_url) or display_url}",
                    file_type=file_type,
                    url=getattr(response, "url", display_url) or display_url,
                )
        except Exception as exc:
            logger.warning("ComfyUI file fetch failed (type=%s): %s", file_type, exc)
            continue
    return None
