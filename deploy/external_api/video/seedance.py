"""Seedance video API client for Volcengine Ark content-generation tasks."""

import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from external_api.video.base import download_streaming_video, request_json
from services.api_provider_registry import (
    SEEDANCE_DEFAULT_MODEL_MAP,
    normalize_seedance_sub_model,
)
from services.api_provider_runtime import resolve_provider, resolve_seedance_model_name

logger = logging.getLogger(__name__)

SEEDANCE_AGENT_PLAN_MODEL = "doubao-seedance-1.5-pro"
SEEDANCE_AGENT_PLAN_MAX_DURATION = 11
SEEDANCE_PAYG_MODELS = frozenset(
    {
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-0-fast-260128",
        "doubao-seedance-2.0",
        "doubao-seedance-2.0-fast",
    }
)
SEEDANCE_MODEL_AVAILABILITY_MARKERS = (
    "unsupportedmodel",
    "modelnotopen",
    "does not support",
    "model does not exist",
    "model not found",
    "not activated the model",
    "do not have access to it",
)
SEEDANCE_DURATION_ERROR_MARKERS = (
    "parameter duration",
    "duration specified",
    "duration is not valid",
)


def _is_agent_plan_endpoint(endpoint: str) -> bool:
    try:
        return "/api/plan/" in urlsplit(endpoint).path.lower()
    except ValueError:
        return "/api/plan/" in (endpoint or "").lower()


def _provider_error_text(exc: BaseException) -> str:
    response = getattr(exc, "response", None)
    return f"{exc} {getattr(response, 'text', '')}".casefold()


def _is_model_availability_error(exc: BaseException) -> bool:
    error_text = _provider_error_text(exc)
    return any(marker in error_text for marker in SEEDANCE_MODEL_AVAILABILITY_MARKERS)


def _is_duration_parameter_error(exc: BaseException) -> bool:
    error_text = _provider_error_text(exc)
    return any(marker in error_text for marker in SEEDANCE_DURATION_ERROR_MARKERS)


def _duration_rejection_message(payload: Dict[str, Any]) -> str:
    duration = payload.get("duration")
    model = payload.get("model") or "-"
    return (
        f"Seedance 当前通道拒绝 duration={duration}（model={model}），"
        "已停止自动降级为默认 5 秒；请改用供应商支持的时长，或切换支持该时长的通道。"
    )


def _agent_plan_duration_limit_message(duration: int) -> str:
    return (
        f"Seedance 当前 Agent Plan / 1.5-pro 通道最多支持 {SEEDANCE_AGENT_PLAN_MAX_DURATION} 秒，"
        f"当前请求为 {duration} 秒；请设置为 {SEEDANCE_AGENT_PLAN_MAX_DURATION} 秒以内，"
        "避免供应商回退为默认 5 秒。"
    )


def _validate_payload_duration(payload: Dict[str, Any]) -> None:
    if payload.get("model") != SEEDANCE_AGENT_PLAN_MODEL:
        return
    raw_duration = payload.get("duration")
    if raw_duration is None:
        return
    try:
        duration = int(raw_duration)
    except (TypeError, ValueError):
        return
    if duration > SEEDANCE_AGENT_PLAN_MAX_DURATION:
        raise ValueError(_agent_plan_duration_limit_message(duration))


def _has_content_type(contents: List[Dict[str, Any]], content_type: str) -> bool:
    if not isinstance(contents, list):
        return False
    return any(isinstance(item, dict) and item.get("type") == content_type for item in contents)


def _image_contents(contents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(contents, list):
        return []
    return [
        item
        for item in contents
        if isinstance(item, dict) and item.get("type") == "image_url"
    ]


def _normalize_agent_plan_image_roles(payload: Dict[str, Any]) -> None:
    if payload.get("model") != SEEDANCE_AGENT_PLAN_MODEL:
        return
    contents = payload.get("content") or []
    if _has_content_type(contents, "video_url") or _has_content_type(contents, "audio_url"):
        return

    images = _image_contents(contents)
    if len(images) == 1:
        current_role = images[0].get("role")
        if current_role != "first_frame":
            logger.info(
                "Seedance Agent Plan compatibility: mapping single image role=%s to first_frame",
                current_role or "-",
            )
            images[0]["role"] = "first_frame"
        return

    if len(images) == 2:
        has_first = any(item.get("role") == "first_frame" for item in images)
        has_last = any(item.get("role") == "last_frame" for item in images)
        if not (has_first and has_last):
            logger.info("Seedance Agent Plan compatibility: mapping two images to first/last frame")
            images[0]["role"] = "first_frame"
            images[1]["role"] = "last_frame"


def _apply_model_payload_compatibility(payload: Dict[str, Any]) -> None:
    _normalize_agent_plan_image_roles(payload)


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
        if _is_agent_plan_endpoint(self.base_url):
            if model_name != SEEDANCE_AGENT_PLAN_MODEL:
                logger.info(
                    "Seedance Agent Plan model override: sub_model=%s requested=%s selected=%s",
                    normalized_sub_model,
                    model_name,
                    SEEDANCE_AGENT_PLAN_MODEL,
                )
            model_name = SEEDANCE_AGENT_PLAN_MODEL

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
        _apply_model_payload_compatibility(payload)
        _validate_payload_duration(payload)

        logger.info(
            "Seedance create task: sub_model=%s model=%s contents=%s duration=%s",
            normalized_sub_model,
            model_name,
            len(contents),
            payload.get("duration"),
        )
        try:
            try:
                data = self._submit_create_request(payload)
            except Exception as exc:
                should_fallback = (
                    not _is_agent_plan_endpoint(self.base_url)
                    and model_name in SEEDANCE_PAYG_MODELS
                    and _is_model_availability_error(exc)
                )
                if not should_fallback:
                    raise
                logger.warning(
                    "Seedance pay-as-you-go model unavailable; retrying with %s: requested=%s error=%s",
                    SEEDANCE_AGENT_PLAN_MODEL,
                    model_name,
                    exc,
                )
                model_name = SEEDANCE_AGENT_PLAN_MODEL
                payload["model"] = model_name
                _apply_model_payload_compatibility(payload)
                _validate_payload_duration(payload)
                data = self._submit_create_request(payload)
            task_id = data.get("id")
            if not task_id:
                raise ValueError(f"Seedance response missing task id: {data}")
            logger.info("Seedance task created: %s model=%s", task_id, model_name)
            return task_id
        except Exception as exc:
            logger.error("Seedance task create failed: %s", exc)
            if _is_model_availability_error(exc):
                raise RuntimeError(
                    "ModelNotOpen: the configured Seedance model is not supported by the active channel."
                ) from exc
            raise

    def _submit_create_request(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return request_json(
                "POST",
                self.base_url,
                headers=self.headers,
                json=payload,
                timeout=180,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Seedance create",
            )
        except Exception as exc:
            if "duration" not in payload or not _is_duration_parameter_error(exc):
                raise
            message = _duration_rejection_message(payload)
            logger.error(
                "%s provider_error=%s",
                message,
                exc,
            )
            raise ValueError(message) from exc

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
