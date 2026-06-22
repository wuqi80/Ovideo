"""Seedance video API client for Volcengine Ark content-generation tasks."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from external_api.video.base import download_streaming_video, request_json
from services.api_provider_registry import SEEDANCE_DEFAULT_MODEL_MAP, normalize_seedance_sub_model
from services.api_provider_runtime import resolve_provider, resolve_seedance_model_name

logger = logging.getLogger(__name__)


class SeedanceClient:
    """Volcengine Ark Seedance client.

    `MODEL_MAP` is kept as a compatibility surface for older callers and the
    capability endpoint. Runtime model selection is resolved per request.
    """

    MODEL_MAP = dict(SEEDANCE_DEFAULT_MODEL_MAP)

    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = api_key or ""
        self.base_url = ""
        self._runtime_config = None
        self._request_kwargs: Dict[str, Any] = {}
        self.headers: Dict[str, str] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("SEEDANCE_API_KEY and ARK_API_KEY are both missing")

    def _refresh_runtime_config(self, model_name: Optional[str] = None) -> None:
        config = resolve_provider("seedance", model_name)
        self._runtime_config = config
        self.api_key = self._explicit_api_key or config.api_key
        self.base_url = config.endpoint.rstrip("/")
        self._request_kwargs = config.requests_kwargs()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _url_for_operation(self, operation: str, **path_params: Any) -> str:
        if not self._runtime_config:
            self._refresh_runtime_config()
        return self._runtime_config.url_for_operation(operation, **path_params)

    def create_video_task(
        self,
        sub_model: str,
        contents: List[Dict[str, Any]],
        resolution: Optional[str] = None,
        ratio: Optional[str] = "adaptive",
        duration: Optional[int] = None,
        seed: Optional[int] = -1,
        watermark: bool = False,
        generate_audio: bool = True,
        camera_fixed: bool = False,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """Create a Seedance generation task and return the provider task id."""
        normalized_sub_model = normalize_seedance_sub_model(sub_model)
        model_name = resolve_seedance_model_name(normalized_sub_model)
        self._refresh_runtime_config(model_name)

        payload: Dict[str, Any] = {
            "model": model_name,
            "content": contents,
        }
        if resolution:
            payload["resolution"] = resolution
        if ratio:
            payload["ratio"] = ratio
        if duration is not None:
            payload["duration"] = duration
        if seed is not None:
            payload["seed"] = seed
        payload["watermark"] = watermark
        payload["generate_audio"] = generate_audio
        payload["camera_fixed"] = camera_fixed
        if tools:
            payload["tools"] = tools

        logger.info(
            "Seedance create task: sub_model=%s model=%s contents=%s",
            normalized_sub_model,
            model_name,
            len(contents),
        )
        try:
            data = request_json(
                "POST",
                self.base_url,
                headers=self.headers,
                json=payload,
                timeout=180,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Seedance create",
            )
            task_id = data.get("id")
            if not task_id:
                raise ValueError(f"Seedance response missing task id: {data}")
            logger.info("Seedance task created: %s", task_id)
            return task_id
        except Exception as exc:
            logger.error("Seedance task create failed: %s", exc)
            raise

    def query_task(self, task_id: str) -> Dict[str, Any]:
        """Poll a Seedance task status."""
        self._refresh_runtime_config()
        url = self._url_for_operation("task", task_id=task_id)
        try:
            return request_json(
                "GET",
                url,
                headers=self.headers,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Seedance query",
            )
        except Exception as exc:
            logger.error("Seedance query failed: %s", exc)
            raise

    def download_video(self, video_url: str) -> bytes:
        """Download a generated Seedance video."""
        try:
            logger.info("Seedance download video: %s...", video_url[:80])
            self._refresh_runtime_config()
            return download_streaming_video(
                video_url,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Seedance video",
            )
        except Exception as exc:
            logger.error("Seedance video download failed: %s", exc)
            raise


_seedance_client: Optional[SeedanceClient] = None


def get_seedance_client() -> SeedanceClient:
    global _seedance_client
    if _seedance_client is None:
        _seedance_client = SeedanceClient()
    return _seedance_client
