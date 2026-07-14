# -*- coding: utf-8 -*-
"""
Video Reverse Prompt API Routes
=================================
/api/video-reverse/* — 视频反推提示词的预估 / 提交 / 列表 / 详情 / 取消 / 重试。

详见 docs/superpowers/plans/2026-05-26-feature-rollout/03-video-reverse.md
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video-reverse", tags=["video-reverse"])

_REVERSE_TERMINAL_STATUSES = {'completed', 'failed', 'cancelled'}


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
    """估算视频反推的积分消耗。优先用 video_file_id 反查时长。"""
    duration = payload.duration_seconds
    if (duration is None or duration <= 0) and payload.video_file_id:
        file_record = await FileDAO.get_file(payload.video_file_id)
        if file_record:
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
    if file_record.get('user_id') != user_id:
        # 项目内成员也可以用（最小化校验）；正式版应基于 media_library_service.can_view
        pass

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
        raise HTTPException(status_code=402, detail=f'积分不足，需要 {estimated_cost}')

    # 提交异步任务
    try:
        svc = task_service.get()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # 先创建 reverse_task 占位（占用一个 reverse_task_id）
    task_record = await VideoReverseTaskDAO.create(
        user_id=user_id,
        video_file_id=payload.video_file_id,
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

    task_id = await svc.submit(
        task_type='video_reverse_prompt',
        task_data=task_data,
        user_id=user_id,
        prepare=False,  # 不走 ComfyUI prepare
    )

    # 把 task_id 回填到 video_reverse_tasks
    db = (await _get_db())
    await db.execute(
        "UPDATE video_reverse_tasks SET task_id = $2 WHERE reverse_task_id = $1",
        reverse_task_id, task_id,
    )

    # 冻结积分（在最后做，避免 task 入队失败时空冻结）
    if estimate.get('enabled') and estimated_cost > 0:
        try:
            await credit_service.freeze(
                'user', user_id,
                feature_key=video_reverse_service.VIDEO_REVERSE_FEATURE_KEY,
                amount=estimated_cost,
                task_id=task_id,
                rule_version=estimate.get('rule_version'),
                project_id=payload.project_id,
            )
        except credit_service.InsufficientCreditsError as e:
            # 罕见竞态：估算时够，提交时不够 —— 撤销任务
            await VideoReverseTaskDAO.update_status(reverse_task_id, 'failed', error_message=str(e), completed=True)
            raise HTTPException(status_code=402, detail=str(e))

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
    status_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    rows = await VideoReverseTaskDAO.list_for_user(
        user_id, project_id=project_id, status=status_filter, limit=limit, offset=offset,
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

    await VideoReverseTaskDAO.update_status(
        reverse_task_id, 'cancelled', progress=100,
        error_message='用户取消', completed=True,
    )
    if task.get('task_id'):
        try:
            await credit_service.release(task['task_id'], reason='用户取消', operator=user_id)
        except Exception as _e:
            logger.warning(f"取消时释放积分失败: {_e}")
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
        raise HTTPException(status_code=402, detail=f'积分不足，需要 {estimated_cost}')

    task_id = await svc.submit(
        task_type='video_reverse_prompt',
        task_data={
            'reverse_task_id': reverse_task_id,
            'video_file_id': task['video_file_id'],
            'project_id': task.get('project_id'),
            'episode_id': task.get('episode_id'),
            'language': task.get('language', 'zh'),
            'frames_per_segment': 2,
            'duration_seconds': duration,
        },
        user_id=user_id,
        prepare=False,
    )

    db = await _get_db()
    await db.execute(
        "UPDATE video_reverse_tasks SET task_id=$2, status='pending', progress=0, error_message=NULL, credit_cost=$3 WHERE reverse_task_id=$1",
        reverse_task_id, task_id, estimated_cost,
    )

    if estimate.get('enabled') and estimated_cost > 0:
        try:
            await credit_service.freeze(
                'user', user_id,
                feature_key=video_reverse_service.VIDEO_REVERSE_FEATURE_KEY,
                amount=estimated_cost,
                task_id=task_id,
                rule_version=estimate.get('rule_version'),
            )
        except credit_service.InsufficientCreditsError as e:
            raise HTTPException(status_code=402, detail=str(e))

    return {"success": True, "reverse_task_id": reverse_task_id, "task_id": task_id}


async def _get_db():
    from db_manager import get_db_manager
    return get_db_manager()
