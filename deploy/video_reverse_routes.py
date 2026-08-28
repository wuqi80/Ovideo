# -*- coding: utf-8 -*-
"""
Video Reverse Prompt API Routes
=================================
/api/video-reverse/* — 视频反推提示词的预估 / 提交 / 列表 / 详情 / 取消 / 重试。

"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import credit_service
import task_service
import video_reverse_service
from api_routes import get_current_user
from dao_content import FileDAO
from dao_task import TaskDAO
from dao_video_reverse import VideoReverseSegmentDAO, VideoReverseTaskDAO
from services.project_access_service import (
    ProjectAccessDenied,
    require_project_access,
    resolve_user_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video-reverse", tags=["video-reverse"])

_REVERSE_TERMINAL_STATUSES = {'completed', 'failed', 'cancelled'}


async def _require_video_file_access(file_record: Dict[str, Any], user_id: str) -> None:
    """Allow the owner or a current project member without leaking file existence."""
    canonical_user_id = await resolve_user_id(user_id)
    file_owner = str(file_record.get('user_id') or '')
    if file_owner and file_owner in {str(user_id), str(canonical_user_id or '')}:
        return

    project_id = str(file_record.get('project_id') or '').strip()
    if project_id:
        try:
            await require_project_access(project_id, user_id, 'readonly')
            return
        except ProjectAccessDenied as exc:
            logger.warning(
                "video_reverse project permission check failed: project=%s user=%s error=%s",
                project_id,
                user_id,
                exc,
            )

    raise HTTPException(status_code=404, detail='视频文件不存在')


async def _freeze_and_submit_reverse_task(
    *,
    svc: Any,
    task_id: str,
    reverse_task_id: str,
    task_data: Dict[str, Any],
    user_id: str,
    estimate: Dict[str, Any],
    project_id: Optional[str] = None,
) -> None:
    """Freeze credits before enqueueing and compensate every partial failure."""
    estimated_cost = int(estimate.get('estimated_cost') or 0)
    frozen = False
    try:
        if estimate.get('enabled') and estimated_cost > 0:
            await credit_service.freeze(
                'user', user_id,
                feature_key=video_reverse_service.VIDEO_REVERSE_FEATURE_KEY,
                amount=estimated_cost,
                task_id=task_id,
                rule_version=estimate.get('rule_version'),
                project_id=project_id,
            )
            frozen = True

        submitted_task_id = await svc.submit(
            task_type='video_reverse_prompt',
            task_data=task_data,
            user_id=user_id,
            prepare=False,
            task_id=task_id,
        )
        if submitted_task_id != task_id:
            raise RuntimeError('任务服务未使用预分配的 task_id')
    except credit_service.InsufficientCreditsError as exc:
        await VideoReverseTaskDAO.update_status(
            reverse_task_id, 'failed', progress=100,
            error_message=str(exc)[:500], completed=True,
        )
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except Exception as exc:
        if frozen:
            try:
                await credit_service.release(
                    task_id,
                    reason='任务入队失败，退回预冻结创作点数',
                    operator=user_id,
                    project_id=project_id,
                )
            except Exception as release_exc:
                logger.error(
                    'video_reverse enqueue compensation failed: task=%s error=%s',
                    task_id,
                    release_exc,
                    exc_info=True,
                )
        await VideoReverseTaskDAO.update_status(
            reverse_task_id, 'failed', progress=100,
            error_message=str(exc)[:500], completed=True,
        )
        raise


async def _reconcile_terminal_task(task: Dict[str, Any]) -> Dict[str, Any]:
    """Keep the video-reverse row aligned with its generic queue task."""
    if not task or task.get('status') in _REVERSE_TERMINAL_STATUSES:
        return task
    task_id = task.get('task_id')
    if not task_id:
        return task

    generic_task = await TaskDAO.get_task(task_id)
    generic_status = str((generic_task or {}).get('status') or '')
    if generic_status not in _REVERSE_TERMINAL_STATUSES:
        return task

    if generic_status == 'cancelled':
        reverse_status = 'cancelled'
        error_message = (generic_task or {}).get('error_message') or 'Task was cancelled.'
    else:
        reverse_status = 'failed'
        error_message = (generic_task or {}).get('error_message')
        if not error_message:
            error_message = (
                'Video reverse task ended before its analysis results were persisted.'
                if generic_status == 'completed'
                else 'Video reverse task failed before processing started.'
            )

    await VideoReverseTaskDAO.update_status(
        task['reverse_task_id'],
        reverse_status,
        progress=100,
        error_message=str(error_message)[:500],
        completed=True,
    )
    try:
        await credit_service.release(task_id, reason=str(error_message)[:200])
    except Exception as exc:
        logger.warning("video_reverse reconcile credit release failed: %s", exc)

    refreshed = await VideoReverseTaskDAO.get(task['reverse_task_id'])
    return refreshed or {
        **task,
        'status': reverse_status,
        'progress': 100,
        'error_message': str(error_message)[:500],
    }


def _coerce_frame_file_ids(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, str):
        try:
            import json
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(item) for item in parsed if item]
        except Exception:
            return [value] if value else []
    return []


async def _attach_frame_file_details_to_segments(segments: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    """Expose frame URLs beside persisted frame ids without changing the DB schema."""
    frame_ids: list[str] = []
    for segment in segments:
        for file_id in _coerce_frame_file_ids(segment.get('frame_file_ids')):
            if file_id not in frame_ids:
                frame_ids.append(file_id)

    file_rows: Dict[str, Dict[str, Any]] = {}
    for file_id in frame_ids:
        try:
            row = await FileDAO.get_file(file_id)
        except Exception as exc:
            logger.warning("video_reverse frame lookup failed: file_id=%s error=%s", file_id, exc)
            row = None
        if row:
            file_rows[file_id] = {
                'file_id': row.get('file_id') or file_id,
                'file_url': row.get('file_url') or '',
                'thumbnail_url': row.get('thumbnail_url'),
                'file_name': row.get('file_name') or '',
            }

    enriched: list[Dict[str, Any]] = []
    for segment in segments:
        ids = _coerce_frame_file_ids(segment.get('frame_file_ids'))
        frame_files = [file_rows[file_id] for file_id in ids if file_id in file_rows]
        keyframe = frame_files[0] if frame_files else {}
        enriched.append({
            **dict(segment),
            'frame_file_ids': ids,
            'frame_files': frame_files,
            'keyframe_file_id': keyframe.get('file_id') or (ids[0] if ids else ''),
            'keyframe_file_url': keyframe.get('file_url') or '',
        })
    return enriched


# ============================================
# 请求模型
# ============================================
class VideoReverseEstimateRequest(BaseModel):
    video_file_id: Optional[str] = None
    duration_seconds: Optional[float] = None
    frame_count: Optional[int] = None
    model: Optional[str] = None


class VideoReverseCreateRequest(BaseModel):
    video_file_id: str
    project_id: Optional[str] = None
    episode_id: Optional[str] = None
    frame_strategy: str = 'uniform'
    frames_per_segment: int = 2
    language: str = 'zh'


# ============================================
# 路由
# ============================================

@router.post("/estimate")
async def estimate_video_reverse(
    payload: VideoReverseEstimateRequest,
    user_id: str = Depends(get_current_user),
):
    """估算视频反推的创作点数消耗。优先用 video_file_id 反查时长。"""
    duration = payload.duration_seconds
    if payload.video_file_id:
        file_record = await FileDAO.get_file(payload.video_file_id)
        if not file_record:
            raise HTTPException(status_code=404, detail='视频文件不存在')
        await _require_video_file_access(file_record, user_id)
        if duration is None or duration <= 0:
            duration = float(file_record.get('duration_seconds') or 0)
            if duration <= 0 and file_record.get('file_path'):
                try:
                    duration = await video_reverse_service.probe_duration(file_record['file_path'])
                except Exception:
                    duration = 0
    if duration is None or duration <= 0:
        raise HTTPException(status_code=400, detail='请提供 duration_seconds 或有效的 video_file_id')

    params: Dict[str, Any] = {'duration_seconds': duration}
    if payload.frame_count:
        params['frame_count'] = payload.frame_count
    try:
        result = await credit_service.estimate(
            video_reverse_service.VIDEO_REVERSE_FEATURE_KEY,
            params,
            owner_type='user',
            owner_id=user_id,
        )
        return {"success": True, **result, 'duration_seconds': duration}
    except Exception as e:
        logger.error(f"video_reverse estimate 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tasks")
async def create_video_reverse_task(
    payload: VideoReverseCreateRequest,
    user_id: str = Depends(get_current_user),
):
    """提交视频反推任务。"""
    file_record = await FileDAO.get_file(payload.video_file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail='视频文件不存在')
    await _require_video_file_access(file_record, user_id)

    ok, err = await video_reverse_service.validate_video(file_record)
    if not ok:
        raise HTTPException(status_code=400, detail=err)

    duration = float(file_record.get('duration_seconds') or 0)
    if duration <= 0:
        try:
            duration = await video_reverse_service.probe_duration(file_record['file_path'])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'无法探测视频时长: {e}')

    # 估算 + 冻结
    estimate = await credit_service.estimate(
        video_reverse_service.VIDEO_REVERSE_FEATURE_KEY,
        {'duration_seconds': duration},
        owner_type='user',
        owner_id=user_id,
    )
    estimated_cost = int(estimate.get('estimated_cost') or 0)
    if estimate.get('enabled') and not estimate.get('enough'):
        raise HTTPException(status_code=402, detail=f'创作点数不足，需要 {estimated_cost}')

    # 提交异步任务
    try:
        svc = task_service.get()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    task_id = task_service.allocate_task_id()

    # 先创建 reverse_task 占位，并提前关联唯一的通用 task_id。
    task_record = await VideoReverseTaskDAO.create(
        user_id=user_id,
        video_file_id=payload.video_file_id,
        task_id=task_id,
        project_id=payload.project_id,
        episode_id=payload.episode_id,
        duration_seconds=duration,
        frame_strategy=payload.frame_strategy,
        language=payload.language,
        credit_cost=estimated_cost,
    )
    reverse_task_id = task_record['reverse_task_id']

    task_data = {
        'reverse_task_id': reverse_task_id,
        'video_file_id': payload.video_file_id,
        'project_id': payload.project_id,
        'episode_id': payload.episode_id,
        'language': payload.language,
        'frames_per_segment': payload.frames_per_segment,
        'duration_seconds': duration,
    }

    await _freeze_and_submit_reverse_task(
        svc=svc,
        task_id=task_id,
        reverse_task_id=reverse_task_id,
        task_data=task_data,
        user_id=user_id,
        estimate=estimate,
        project_id=payload.project_id,
    )

    return {
        "success": True,
        "reverse_task_id": reverse_task_id,
        "task_id": task_id,
        "estimated_cost": estimated_cost,
        "duration_seconds": duration,
        "status": "pending",
    }


@router.get("/tasks")
async def list_video_reverse_tasks(
    user_id: str = Depends(get_current_user),
    project_id: Optional[str] = None,
    episode_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    rows = await VideoReverseTaskDAO.list_for_user(
        user_id,
        project_id=project_id,
        episode_id=episode_id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "tasks": rows, "limit": limit, "offset": offset}


@router.get("/tasks/{reverse_task_id}")
async def get_video_reverse_task(
    reverse_task_id: str,
    user_id: str = Depends(get_current_user),
):
    task = await VideoReverseTaskDAO.get(reverse_task_id)
    if not task:
        raise HTTPException(status_code=404, detail='任务不存在')
    if task.get('user_id') != user_id:
        # TODO Slice 4: 走 project 共享判断
        raise HTTPException(status_code=403, detail='无权访问')
    task = await _reconcile_terminal_task(task)
    segments = await VideoReverseSegmentDAO.list_for_task(reverse_task_id)
    segments = await _attach_frame_file_details_to_segments(segments)
    return {"success": True, "task": task, "segments": segments}


@router.post("/tasks/{reverse_task_id}/cancel")
async def cancel_video_reverse_task(
    reverse_task_id: str,
    user_id: str = Depends(get_current_user),
):
    task = await VideoReverseTaskDAO.get(reverse_task_id)
    if not task:
        raise HTTPException(status_code=404, detail='任务不存在')
    if task.get('user_id') != user_id:
        raise HTTPException(status_code=403, detail='无权操作')
    if task.get('status') in ('completed', 'failed', 'cancelled'):
        return {"success": True, "task": task, "note": "任务已结束"}

    if task.get('task_id'):
        try:
            queue = task_service.get_queue()
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        cancelled = await queue.cancel_task(task['task_id'])
        if not cancelled:
            generic_task = await TaskDAO.get_task(task['task_id'])
            generic_status = str((generic_task or {}).get('status') or '')
            if generic_status in _REVERSE_TERMINAL_STATUSES:
                task = await _reconcile_terminal_task(task)
                return {"success": True, "task": task, "note": "任务已结束，未执行退款"}
            raise HTTPException(status_code=409, detail='底层任务未能取消，创作点数尚未退回，请稍后重试')

    await VideoReverseTaskDAO.update_status(
        reverse_task_id, 'cancelled', progress=100,
        error_message='用户取消', completed=True,
    )
    if task.get('task_id'):
        try:
            await credit_service.release(task['task_id'], reason='用户取消', operator=user_id)
        except Exception as exc:
            logger.warning(f"取消时释放创作点数失败: {exc}")
    return {"success": True}


@router.post("/tasks/{reverse_task_id}/retry")
async def retry_video_reverse_task(
    reverse_task_id: str,
    user_id: str = Depends(get_current_user),
):
    task = await VideoReverseTaskDAO.get(reverse_task_id)
    if not task:
        raise HTTPException(status_code=404, detail='任务不存在')
    if task.get('user_id') != user_id:
        raise HTTPException(status_code=403, detail='无权操作')
    if task.get('status') not in ('failed', 'cancelled'):
        raise HTTPException(status_code=400, detail='仅失败/取消的任务可重试')

    # 直接以原有 reverse_task_id 重新提交一个新的 task
    try:
        svc = task_service.get()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    duration = float(task.get('duration_seconds') or 0)
    estimate = await credit_service.estimate(
        video_reverse_service.VIDEO_REVERSE_FEATURE_KEY,
        {'duration_seconds': duration},
        owner_type='user',
        owner_id=user_id,
    )
    estimated_cost = int(estimate.get('estimated_cost') or 0)
    if estimate.get('enabled') and not estimate.get('enough'):
        raise HTTPException(status_code=402, detail=f'创作点数不足，需要 {estimated_cost}')

    task_id = task_service.allocate_task_id()
    task_data = {
        'reverse_task_id': reverse_task_id,
        'video_file_id': task['video_file_id'],
        'project_id': task.get('project_id'),
        'episode_id': task.get('episode_id'),
        'language': task.get('language', 'zh'),
        'frames_per_segment': 2,
        'duration_seconds': duration,
    }

    db = await _get_db()
    await db.execute(
        "UPDATE video_reverse_tasks SET task_id=$2, status='pending', progress=0, error_message=NULL, completed_at=NULL, credit_cost=$3 WHERE reverse_task_id=$1",
        reverse_task_id, task_id, estimated_cost,
    )

    await _freeze_and_submit_reverse_task(
        svc=svc,
        task_id=task_id,
        reverse_task_id=reverse_task_id,
        task_data=task_data,
        user_id=user_id,
        estimate=estimate,
        project_id=task.get('project_id'),
    )

    return {"success": True, "reverse_task_id": reverse_task_id, "task_id": task_id}


async def _get_db():
    from db_manager import get_db_manager
    return get_db_manager()
