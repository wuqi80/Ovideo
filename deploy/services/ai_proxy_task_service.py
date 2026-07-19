"""Task persistence helpers for AI proxy routes."""
from __future__ import annotations

import time
from typing import Any, Callable, Dict, Optional


TimestampMsProvider = Callable[[], int]


def _default_timestamp_ms() -> int:
    return int(time.time() * 1000)


def _truncate_text(text: str, *, limit: int = 2000) -> str:
    return text[:limit] if len(text) > limit else text


async def _default_task_dao() -> Any:
    from dao_task import TaskDAO

    return TaskDAO


async def create_ai_proxy_task(
    *,
    task_id_prefix: str,
    user_id: str,
    task_type: str,
    task_data: Dict[str, Any],
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    """Create an AI proxy task row as best-effort bookkeeping."""

    try:
        dao = task_dao or await _default_task_dao()
        task_id = f"{task_id_prefix}_{timestamp_ms_provider()}"
        await dao.create_task(
            task_id=task_id,
            user_id=user_id,
            task_type=task_type,
            task_data=task_data,
        )
        logger.info("AI proxy task created: %s", task_id)
        return task_id
    except Exception as exc:
        logger.error("AI proxy task create failed: %s", exc, exc_info=True)
        return None


async def complete_ai_proxy_text_task(
    *,
    task_id: str,
    text_content: str,
    logger: Any,
    task_dao: Optional[Any] = None,
) -> bool:
    """Persist a completed streaming/text result back to the task table."""

    try:
        dao = task_dao or await _default_task_dao()
        await dao.update_task_status(
            task_id=task_id,
            status="completed",
            result_data={"text": _truncate_text(text_content), "full_length": len(text_content)},
        )
        logger.info("AI proxy text task completed: %s length=%s", task_id, len(text_content))
        return True
    except Exception as exc:
        logger.error("AI proxy text task completion failed: %s", exc, exc_info=True)
        return False


async def start_ai_proxy_task(
    *,
    task_id_prefix: str,
    user_id: str,
    task_type: str,
    task_data: Dict[str, Any],
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    """Create an AI proxy task and mark it processing immediately."""

    task_id = await create_ai_proxy_task(
        task_id_prefix=task_id_prefix,
        user_id=user_id,
        task_type=task_type,
        task_data=task_data,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )
    if not task_id:
        return None

    try:
        dao = task_dao or await _default_task_dao()
        await dao.update_task_status(task_id=task_id, status="processing")
        logger.info("AI proxy task started: %s", task_id)
    except Exception as exc:
        logger.error("AI proxy task start failed: %s", exc, exc_info=True)
    return task_id


async def complete_ai_proxy_image_task(
    *,
    task_id: Optional[str],
    images_count: int,
    reference_snapshot: Optional[list[dict[str, Any]]] = None,
    logger: Any,
    task_dao: Optional[Any] = None,
) -> bool:
    """Persist a completed image generation task."""

    if not task_id:
        return False
    try:
        dao = task_dao or await _default_task_dao()
        result_data: Dict[str, Any] = {"images_count": images_count}
        if reference_snapshot is not None:
            result_data["reference_snapshot"] = reference_snapshot
        await dao.update_task_status(
            task_id=task_id,
            status="completed",
            result_data=result_data,
        )
        logger.info("AI proxy image task completed: %s images=%s", task_id, images_count)
        return True
    except Exception as exc:
        logger.error("AI proxy image task completion failed: %s", exc, exc_info=True)
        return False


async def fail_ai_proxy_task(
    *,
    task_id: Optional[str],
    error_message: str,
    logger: Any,
    task_dao: Optional[Any] = None,
) -> bool:
    """Persist a failed AI proxy task without masking the original error."""

    if not task_id:
        return False
    try:
        dao = task_dao or await _default_task_dao()
        await dao.update_task_status(
            task_id=task_id,
            status="failed",
            error_message=error_message[:1000],
        )
        logger.info("AI proxy task failed: %s", task_id)
        return True
    except Exception as exc:
        logger.error("AI proxy task failure persistence failed: %s", exc, exc_info=True)
        return False


async def create_deepseek_text_task(
    *,
    user_id: str,
    prompt: str,
    response_format: Optional[str],
    temperature: float,
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    return await create_ai_proxy_task(
        task_id_prefix="deepseek_text",
        user_id=user_id,
        task_type="deepseek_text",
        task_data={
            "prompt": prompt[:500],
            "response_format": response_format,
            "temperature": temperature,
        },
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )


async def create_completed_gemini_text_task(
    *,
    user_id: str,
    prompt: str,
    system_prompt: Optional[str],
    temperature: float,
    model: Optional[str],
    content: str,
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    task_id = await create_ai_proxy_task(
        task_id_prefix="gemini_text",
        user_id=user_id,
        task_type="gemini_text",
        task_data={
            "prompt": prompt[:500],
            "system_prompt": system_prompt[:200] if system_prompt else None,
            "temperature": temperature,
            "model": model,
        },
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )
    if task_id:
        await complete_ai_proxy_text_task(
            task_id=task_id,
            text_content=content,
            logger=logger,
            task_dao=task_dao,
        )
    return task_id


async def create_completed_image_task(
    *,
    task_id_prefix: str,
    user_id: str,
    task_type: str,
    task_data: Dict[str, Any],
    images_count: int,
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    task_id = await create_ai_proxy_task(
        task_id_prefix=task_id_prefix,
        user_id=user_id,
        task_type=task_type,
        task_data=task_data,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )
    if task_id:
        await complete_ai_proxy_image_task(
            task_id=task_id,
            images_count=images_count,
            logger=logger,
            task_dao=task_dao,
        )
    return task_id
