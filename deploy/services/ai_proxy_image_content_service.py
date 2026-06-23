"""Content loading helpers for AI proxy generated images."""
from __future__ import annotations

import base64
import logging

import requests

from services.ai_proxy_types import AIProxyUpstreamError
from utils.net_guard import assert_public_http_url

logger = logging.getLogger(__name__)


def generated_image_content(image: str, *, timeout: int = 60) -> bytes:
    """Return bytes for a generated image data URL or provider-hosted public URL."""
    if image.startswith("data:"):
        b64_data = image.split(",", 1)[1] if "," in image else image
        return base64.b64decode(b64_data)

    assert_public_http_url(image)
    try:
        response = requests.get(image, timeout=timeout)
        response.raise_for_status()
        return response.content
    except requests.Timeout as exc:
        raise AIProxyUpstreamError("下载生成图片超时，请稍后重试", status_code=504) from exc
    except requests.RequestException as exc:
        logger.warning("Generated image download failed: %s", exc, exc_info=True)
        raise AIProxyUpstreamError(f"下载生成图片失败: {str(exc)[:200]}") from exc
