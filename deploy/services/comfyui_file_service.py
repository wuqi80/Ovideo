"""HTTP helpers for ComfyUI file proxy and upload routes."""
from __future__ import annotations

from typing import Mapping, Optional

import requests


class ComfyUIFileRequestError(RuntimeError):
    """Raised when a ComfyUI file transfer request cannot be completed."""


def _request(action: str, method, *args, **kwargs) -> requests.Response:
    try:
        return method(*args, **kwargs)
    except requests.RequestException as exc:
        raise ComfyUIFileRequestError(f"{action} failed: {exc}") from exc


def fetch_comfyui_view_response(
    url: str,
    *,
    params: Optional[Mapping[str, str]] = None,
    timeout: int = 60,
    stream: bool = False,
) -> requests.Response:
    """Fetch a ComfyUI /view response for proxy routes."""
    return _request("comfyui_view", requests.get, url, params=params, timeout=timeout, stream=stream)


def upload_comfyui_file_response(
    upload_url: str,
    filename: str,
    content: bytes,
    content_type: str,
    *,
    timeout: int = 60,
) -> requests.Response:
    """Upload a file to ComfyUI's image upload endpoint."""
    files = {"image": (filename, content, content_type)}
    data = {"overwrite": "true"}
    return _request("comfyui_upload", requests.post, upload_url, files=files, data=data, timeout=timeout)
