# -*- coding: utf-8 -*-
"""
Video Reverse Prompt Service
=============================
视频反推提示词流水线：
    validate -> plan_segments -> extract_frames -> analyze_frames -> build_prompts -> save_results

外部依赖：
- ffmpeg 命令行（系统 PATH，或环境变量 FFMPEG_BIN 指定）
- GEMINI_TEXT_API_KEY（用于视觉理解；缺失时回退为只生成结构化骨架，不调用大模型）

详见 docs/superpowers/plans/2026-05-26-feature-rollout/03-video-reverse.md
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


VIDEO_REVERSE_FEATURE_KEY = 'video_reverse_prompt'
FFMPEG_BIN = os.getenv('FFMPEG_BIN', 'ffmpeg')
FFPROBE_BIN = os.getenv('FFPROBE_BIN', 'ffprobe')

MIN_DURATION = 5.0
MAX_DURATION = 60.0
ALLOWED_MIME_PREFIXES = ('video/',)


# ============================================
# 1. validate
# ============================================
async def validate_video(file_record: Dict[str, Any]) -> Tuple[bool, str]:
    if not file_record:
        return False, '视频文件不存在'
    if (file_record.get('file_type') or '').lower() != 'video':
        return False, f"文件类型必须为视频，当前: {file_record.get('file_type')}"

    file_path = file_record.get('file_path')
    if not file_path or not Path(file_path).is_file():
        return False, f"视频文件路径不存在: {file_path}"

    duration = file_record.get('duration_seconds')
    if duration is None:
        # 用 ffprobe 探测
        try:
            duration = await probe_duration(file_path)
        except Exception as e:
            return False, f"ffprobe 探测视频时长失败: {e}"

    duration = float(duration or 0)
    if duration <= 0:
        return False, '视频时长无效'
    if duration < MIN_DURATION:
        return False, f"视频时长过短（{duration:.1f}s），最少 {MIN_DURATION}s"
    if duration > MAX_DURATION:
        return False, f"视频时长过长（{duration:.1f}s），最多 {MAX_DURATION}s"

    return True, ''


async def probe_duration(file_path: str) -> float:
    """通过 ffprobe 获取视频时长（秒）"""
    proc = await asyncio.create_subprocess_exec(
        FFPROBE_BIN, '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        file_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode(errors='ignore'))
    return float(stdout.decode().strip() or 0)


def ffmpeg_available() -> bool:
    return shutil.which(FFMPEG_BIN) is not None and shutil.which(FFPROBE_BIN) is not None


# ============================================
# 2. plan_segments (uniform)
# ============================================
def plan_segments(duration_seconds: float) -> List[Tuple[float, float]]:
    """
    根据视频时长生成均匀分段（uniform）：
      5–15s   → 1–3 段
      16–30s  → 3–5 段
      31–60s  → 5–8 段
    """
    d = float(duration_seconds)
    if d < MIN_DURATION:
        return [(0.0, d)]
    if d <= 15:
        n = max(1, min(3, int(round(d / 5))))
    elif d <= 30:
        n = max(3, min(5, int(round(d / 6))))
    else:
        n = max(5, min(8, int(round(d / 7))))

    step = d / n
    segments = []
    for i in range(n):
        start = i * step
        end = (i + 1) * step if i < n - 1 else d
        segments.append((round(start, 3), round(end, 3)))
    return segments


# ============================================
# 3. extract_frames
# ============================================
async def extract_frames(
    file_path: str,
    segments: List[Tuple[float, float]],
    frames_per_segment: int = 2,
    output_dir: Optional[str] = None,
) -> Dict[int, List[str]]:
    """
    用 ffmpeg 在每个分段内抽取 frames_per_segment 张图片。
    返回 {segment_index: [absolute_image_path, ...]}.
    """
    if not ffmpeg_available():
        raise RuntimeError(f"ffmpeg/ffprobe 不可用 (FFMPEG_BIN={FFMPEG_BIN})")

    out_dir = Path(output_dir) if output_dir else Path(tempfile.mkdtemp(prefix='video_reverse_'))
    out_dir.mkdir(parents=True, exist_ok=True)

    result: Dict[int, List[str]] = {}
    for idx, (start, end) in enumerate(segments):
        seg_dir = out_dir / f"segment_{idx:02d}"
        seg_dir.mkdir(exist_ok=True)
        frames: List[str] = []
        # 在 [start, end] 区间内均匀取 frames_per_segment 张
        for f in range(frames_per_segment):
            if frames_per_segment == 1:
                t = start + (end - start) * 0.5
            else:
                t = start + (end - start) * (f + 1) / (frames_per_segment + 1)
            out_path = seg_dir / f"frame_{f:02d}.jpg"
            proc = await asyncio.create_subprocess_exec(
                FFMPEG_BIN, '-y',
                '-ss', f"{t:.3f}",
                '-i', file_path,
                '-vframes', '1',
                '-q:v', '3',
                str(out_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(
                    "ffmpeg 抽帧失败 segment=%d frame=%d t=%.3f stderr=%s",
                    idx, f, t, stderr.decode(errors='ignore')[:300],
                )
                continue
            if out_path.is_file() and out_path.stat().st_size > 0:
                frames.append(str(out_path))
        result[idx] = frames
    return result


# ============================================
# 4. analyze_frames (Gemini Vision via laozhang.ai)
# ============================================
async def analyze_segment_frames(
    frame_paths: List[str],
    *,
    language: str = 'zh',
) -> Dict[str, str]:
    """
    给定一个分段的若干抽帧，调用视觉模型生成 description / camera / motion 文字。
    回退：API 不可用时返回结构化空字符串。
    """
    api_key = os.getenv('GEMINI_TEXT_API_KEY') or os.getenv('GEMINI_API_KEY')
    if not api_key or not frame_paths:
        return {'description': '', 'camera_description': '', 'motion_description': ''}

    try:
        content_parts: List[Dict[str, Any]] = []
        prompt = (
            "你是专业的视频反推提示词师。基于以下连续帧画面，输出 JSON 字段：\n"
            "{\n"
            '  "description": "整体场景和主体的中文描述",\n'
            '  "camera_description": "镜头机位、运动、景别（中文）",\n'
            '  "motion_description": "主体运动方式（中文）"\n'
            "}\n"
            "只输出 JSON，不要任何额外文字。"
        ) if language == 'zh' else (
            "You are a professional video reverse prompt engineer. Based on the consecutive frames, output JSON:\n"
            '{"description": "...", "camera_description": "...", "motion_description": "..."}'
        )
        content_parts.append({'type': 'text', 'text': prompt})
        for fp in frame_paths[:3]:  # 最多 3 张/段，控制 token
            try:
                with open(fp, 'rb') as fh:
                    b64 = base64.b64encode(fh.read()).decode('ascii')
                content_parts.append({
                    'type': 'image_url',
                    'image_url': {'url': f'data:image/jpeg;base64,{b64}'},
                })
            except Exception as e:
                logger.warning(f"读取抽帧 {fp} 失败: {e}")

        payload = {
            'model': 'gemini-2.5-flash',
            'messages': [{'role': 'user', 'content': content_parts}],
            'temperature': 0.3,
        }

        # 用 requests 同步 + run_in_executor，避免引入额外依赖
        import requests
        def _do_post():
            return requests.post(
                'https://api.laozhang.ai/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json',
                },
                json=payload,
                timeout=120,
            )
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(None, _do_post)
        resp.raise_for_status()
        result = resp.json()
        content = result.get('choices', [{}])[0].get('message', {}).get('content', '')

        # 尝试解析 JSON（模型可能多输出```json fence）
        content_stripped = content.strip()
        if content_stripped.startswith('```'):
            content_stripped = content_stripped.split('```', 2)[1]
            if content_stripped.startswith('json'):
                content_stripped = content_stripped[4:]
            content_stripped = content_stripped.rsplit('```', 1)[0].strip()
        try:
            obj = json.loads(content_stripped)
        except Exception:
            return {'description': content[:500], 'camera_description': '', 'motion_description': ''}

        return {
            'description': str(obj.get('description', ''))[:1500],
            'camera_description': str(obj.get('camera_description', ''))[:500],
            'motion_description': str(obj.get('motion_description', ''))[:500],
        }
    except Exception as e:
        logger.warning(f"视觉分析失败，降级返回空: {e}")
        return {'description': '', 'camera_description': '', 'motion_description': ''}


# ============================================
# 5. build_prompts
# ============================================
def build_prompts(segment_results: List[Dict[str, Any]], *, language: str = 'zh') -> Dict[str, Any]:
    """
    把所有分段的 description / camera / motion 组合成 overall_*  + structured 输出。
    overall_prompt_en 简单做一下兜底：若分段里没有 prompt_en，则空。
    """
    descs = [s.get('description', '') for s in segment_results if s.get('description')]
    cams  = [s.get('camera_description', '') for s in segment_results if s.get('camera_description')]
    motns = [s.get('motion_description', '') for s in segment_results if s.get('motion_description')]

    overall_zh_parts: List[str] = []
    if descs:
        overall_zh_parts.append('画面：' + '；'.join(descs))
    if cams:
        overall_zh_parts.append('镜头：' + '；'.join(cams))
    if motns:
        overall_zh_parts.append('运动：' + '；'.join(motns))
    overall_zh = ' | '.join(overall_zh_parts)

    structured = {
        'language': language,
        'segments': segment_results,
        'overall': {
            'description': '；'.join(descs),
            'camera_description': '；'.join(cams),
            'motion_description': '；'.join(motns),
        },
    }

    return {
        'overall_prompt_zh': overall_zh,
        'overall_prompt_en': '',
        'overall_negative_prompt': 'low quality, blurry, distorted, watermark',
        'structured_prompt': structured,
    }


# ============================================
# 6. orchestrator: run_pipeline (called by worker)
# ============================================
async def run_pipeline(task) -> Dict[str, Any]:
    """
    Worker 调用入口。task 是 task_queue.Task。
    task.data 必须包含: reverse_task_id, video_file_id, language(optional), frame_strategy(optional)

    返回 worker 期望的 result dict（同时已经把所有结果落库）。
    """
    from dao_content import FileDAO
    from dao_video_reverse import VideoReverseSegmentDAO, VideoReverseTaskDAO
    from file_service import save_generated_file_to_db
    import credit_service
    import media_library_service

    td = task.data or {}
    reverse_task_id = td.get('reverse_task_id')
    video_file_id = td.get('video_file_id')
    language = td.get('language', 'zh')
    frames_per_segment = int(td.get('frames_per_segment', 2))
    user_id = task.user_id
    project_id = td.get('project_id')
    episode_id = td.get('episode_id')

    if not reverse_task_id or not video_file_id:
        raise ValueError('task.data 缺少 reverse_task_id 或 video_file_id')

    try:
        # 1) validate
        await VideoReverseTaskDAO.update_status(reverse_task_id, 'splitting', progress=5)
        file_record = await FileDAO.get_file(video_file_id)
        if not file_record:
            raise ValueError(f"视频文件不存在: {video_file_id}")
        ok, err = await validate_video(file_record)
        if not ok:
            raise ValueError(f"视频校验失败: {err}")

        duration = float(file_record.get('duration_seconds') or 0)
        if duration <= 0:
            duration = await probe_duration(file_record['file_path'])

        # 2) plan segments
        segments_boundaries = plan_segments(duration)
        logger.info(f"video_reverse {reverse_task_id}: {duration:.1f}s -> {len(segments_boundaries)} 段")

        # 3) extract frames
        await VideoReverseTaskDAO.update_status(reverse_task_id, 'extracting_frames', progress=20)
        frames_map = await extract_frames(
            file_record['file_path'],
            segments_boundaries,
            frames_per_segment=frames_per_segment,
        )

        # 把每个抽帧落入 files 表 + media_library
        saved_frame_file_ids: Dict[int, List[str]] = {}
        all_frame_file_ids: List[str] = []
        for idx, fps in frames_map.items():
            saved_frame_file_ids[idx] = []
            for fp in fps:
                with open(fp, 'rb') as fh:
                    content = fh.read()
                saved = await save_generated_file_to_db(
                    content=content,
                    file_type='image',
                    user_id=user_id,
                    source='video_reverse_frame',
                    entity_type='video_reverse',
                    entity_id=reverse_task_id,
                    file_role='frame',
                    original_ext='.jpg',
                    episode_id=episode_id,
                    extra_metadata={
                        'reverse_task_id': reverse_task_id,
                        'segment_index': idx,
                        'video_file_id': video_file_id,
                    },
                )
                fid = saved.get('file_id')
                if fid:
                    saved_frame_file_ids[idx].append(fid)
                    all_frame_file_ids.append(fid)
                    # 同步进通用素材库（best-effort）
                    try:
                        _fr = await FileDAO.get_file(fid)
                        if _fr:
                            await media_library_service.create_from_file(
                                file_record=_fr,
                                source='video_reverse_frame',
                                project_id=project_id,
                                episode_id=episode_id,
                                source_task_id=task.task_id,
                                source_entity_type='video_reverse',
                                source_entity_id=reverse_task_id,
                                title=f"分段{idx}抽帧",
                                permission_scope='project' if project_id else 'private',
                            )
                    except Exception as _e:
                        logger.warning(f"抽帧入库 media_library 失败: {_e}")

        # 4) analyze frames (per segment)
        await VideoReverseTaskDAO.update_status(reverse_task_id, 'analyzing', progress=55)
        segment_results: List[Dict[str, Any]] = []
        for idx, (start, end) in enumerate(segments_boundaries):
            local_frames = frames_map.get(idx, [])
            analysis = await analyze_segment_frames(local_frames, language=language)
            segment_results.append({
                'sort_order': idx,
                'start_seconds': start,
                'end_seconds': end,
                'frame_file_ids': saved_frame_file_ids.get(idx, []),
                'description': analysis.get('description', ''),
                'camera_description': analysis.get('camera_description', ''),
                'motion_description': analysis.get('motion_description', ''),
                'prompt_zh': analysis.get('description', ''),
                'prompt_en': '',
            })
            # 进度滚动
            await VideoReverseTaskDAO.update_status(
                reverse_task_id, 'analyzing',
                progress=55 + (40 * (idx + 1) / max(1, len(segments_boundaries))),
            )

        # 5) build prompts
        await VideoReverseTaskDAO.update_status(reverse_task_id, 'building_prompts', progress=95)
        prompts = build_prompts(segment_results, language=language)

        # 6) save results
        await VideoReverseTaskDAO.update_results(
            reverse_task_id,
            overall_prompt_zh=prompts['overall_prompt_zh'],
            overall_prompt_en=prompts['overall_prompt_en'],
            overall_negative_prompt=prompts['overall_negative_prompt'],
            structured_prompt=prompts['structured_prompt'],
            frame_file_ids=all_frame_file_ids,
        )
        await VideoReverseSegmentDAO.delete_all_for_task(reverse_task_id)
        await VideoReverseSegmentDAO.create_many(reverse_task_id, segment_results)
        await VideoReverseTaskDAO.update_status(
            reverse_task_id, 'completed', progress=100, completed=True,
        )

        # 7) settle credits
        cost_row = await VideoReverseTaskDAO.get(reverse_task_id)
        final_cost = int(cost_row.get('credit_cost') or 0)
        try:
            await credit_service.confirm(task.task_id, final_amount=final_cost)
        except Exception as _e:
            logger.warning(f"credit_service.confirm 失败 (task={task.task_id}): {_e}")

        # 清理临时帧目录（可选）
        # 注释掉 —— 保留临时文件方便调试；files 表中的本体是另一份拷贝

        return {
            'reverse_task_id': reverse_task_id,
            'segments_count': len(segment_results),
            'overall_prompt_zh': prompts['overall_prompt_zh'],
            'final_cost': final_cost,
        }
    except Exception as e:
        logger.error(f"video_reverse 任务失败 (reverse_task_id={reverse_task_id}): {e}", exc_info=True)
        try:
            await VideoReverseTaskDAO.update_status(
                reverse_task_id, 'failed',
                progress=100, error_message=str(e)[:500], completed=True,
            )
        except Exception:
            pass
        try:
            import credit_service
            await credit_service.release(task.task_id, reason=str(e)[:200])
        except Exception as _e:
            logger.warning(f"credit_service.release 失败: {_e}")
        raise
