"""Compatibility admin routes still used by the React admin shell.

These endpoints preserve legacy `/api/admin/*` URLs while moving their handlers
out of cluster_main.py. New admin functionality should live in admin_routes.py
or a focused admin router instead of growing this compatibility module.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request


def create_admin_compat_router(
    *,
    require_auth: Callable[..., Any],
    get_db_manager: Callable[[], Any],
    online_users: Dict[str, Any],
    default_users: Dict[str, str],
    super_admin: str,
    logger: Any,
) -> APIRouter:
    router = APIRouter()
    SUPER_ADMIN = super_admin
    _online_users = online_users
    DEFAULT_USERS = default_users

    @router.get("/api/admin/stats")
    async def get_admin_stats(
        username: str = Depends(require_auth),
        group_by: Optional[str] = None,
    ):
        """获取系统统计（仅管理员）

        2026-05-26 组织管理 MVP — Slice 6: 新增 group_by 参数
            - 不传 / 'none': 旧行为，返回聚合数字
            - 'user': 额外返回 breakdown=[{user_id, username, projects, images, videos, text}]
            - 'org':  额外返回 breakdown=[{org_id, name, member_count, projects, images, videos, text}]
        """
        # 🔐 权限检查：允许admin和超级管理员访问
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")
        if group_by not in (None, 'none', 'user', 'org'):
            raise HTTPException(status_code=400, detail="group_by 必须是 'none'|'user'|'org'")

        db_manager = get_db_manager()

        try:
            stats = {
                'totalProjects': 0,
                'totalStoryboards': 0,
                'totalImages': 0,
                'totalVideos': 0,
                'totalText': 0,
                'totalMaterials': 0,
                'storageUsedMB': 0,
                'activeUsers': len(_online_users),
                'source': 'memory'
            }

            # 🔧 如果数据库可用，从数据库获取统计
            if db_manager:
                try:
                    # 项目总数
                    stats['totalProjects'] = await db_manager.fetchval(
                        "SELECT COUNT(*) FROM projects"
                    ) or 0

                    # 检查projects表是否有storyboard列（兼容新旧数据库）
                    try:
                        # 尝试查询storyboard列
                        projects = await db_manager.fetch(
                            "SELECT storyboard, generated_images FROM projects WHERE storyboard IS NOT NULL OR generated_images IS NOT NULL LIMIT 1"
                        )
                        has_storyboard_column = True
                    except Exception as col_error:
                        logger.warning(f"⚠️ projects表没有storyboard列，跳过统计: {col_error}")
                        has_storyboard_column = False

                    total_storyboards = 0
                    total_images = 0
                    total_text = 0

                    if has_storyboard_column:
                        # 使用旧表结构（直接存储storyboard）
                        # 🔐 如果是admin请求，过滤掉超级管理员的数据
                        if username == 'admin':
                            # 获取超级管理员的user_id
                            super_admin_user = await db_manager.fetchrow(
                                "SELECT user_id FROM users WHERE username = $1",
                                SUPER_ADMIN
                            )
                            super_admin_id = super_admin_user['user_id'] if super_admin_user else None

                            if super_admin_id:
                                projects = await db_manager.fetch(
                                    "SELECT storyboard, generated_images FROM projects WHERE (storyboard IS NOT NULL OR generated_images IS NOT NULL) AND user_id != $1",
                                    super_admin_id
                                )
                            else:
                                projects = await db_manager.fetch(
                                    "SELECT storyboard, generated_images FROM projects WHERE storyboard IS NOT NULL OR generated_images IS NOT NULL"
                                )
                        else:
                            # 超级管理员可以看到所有数据
                            projects = await db_manager.fetch(
                                "SELECT storyboard, generated_images FROM projects WHERE storyboard IS NOT NULL OR generated_images IS NOT NULL"
                            )

                        for project in projects:
                            storyboard = project.get('storyboard')
                            if storyboard and 'items' in storyboard:
                                total_storyboards += len(storyboard['items'])
                                total_text += len(storyboard['items'])

                                for item in storyboard['items']:
                                    if item.get('generatedImages'):
                                        total_images += len(item['generatedImages'])

                            generated_images = project.get('generated_images')
                            if generated_images:
                                for shot_id, images in generated_images.items():
                                    if isinstance(images, list):
                                        total_images += len(images)
                    else:
                        # 使用新表结构（从text_contents, files, 和 tasks统计）
                        try:
                            # 统计文本生成数（从tasks表中统计所有已完成的任务）
                            total_text = await db_manager.fetchval(
                                """
                                SELECT COUNT(*) FROM tasks
                                WHERE status = 'completed'
                                """
                            ) or 0

                            # 如果tasks表为空，从text_contents统计
                            if total_text == 0:
                                total_text = await db_manager.fetchval(
                                    "SELECT COUNT(*) FROM text_contents WHERE is_deleted = FALSE"
                                ) or 0

                            # 统计分镜数（从storyboard_items表）
                            try:
                                total_storyboards = await db_manager.fetchval(
                                    "SELECT COUNT(*) FROM storyboard_items"
                                ) or 0
                            except:
                                total_storyboards = total_text

                            # 🆕 统计图片数（从tasks表统计已完成的图片生成任务，不包括缩略图）
                            # 只统计ComfyUI和AI生成的图片任务
                            total_images = await db_manager.fetchval(
                                """
                                SELECT COUNT(*) FROM tasks
                                WHERE status = 'completed'
                                AND (task_type LIKE '%qwen%'
                                     OR task_type LIKE '%kontext%'
                                     OR task_type LIKE '%gemini_image%'
                                     OR task_type LIKE '%doubao_image%'
                                     OR task_type = 'three_view'
                                     OR task_type = 'i2i_fj')
                                """
                            ) or 0

                        except Exception as e:
                            logger.warning(f"⚠️ 从新表结构统计失败: {e}")

                    # 统计视频生成任务（从tasks表统计completed的视频任务）
                    try:
                        total_videos = await db_manager.fetchval(
                            """
                            SELECT COUNT(*) FROM tasks
                            WHERE status = 'completed'
                            AND task_type IN ('i2v', 'morph', 'upscale', 'minimax_i2v', 'minimax_morph',
                                             'sora2_i2v', 'sora2_morph', 'veo_i2v', 'veo_morph',
                                             'wan2_i2v', 'wan2_morph', 'wan26_i2v',
                                             'kling_t2v', 'kling_i2v', 'kling_morph', 'kling_refer',
                                             'vidu_r2v', 'vidu_morph', 'happyhorse_r2v',
                                             'seedance_t2v', 'seedance_i2v', 'seedance_morph', 'seedance_multi', 'seedance_draft')
                            """
                        ) or 0

                        # 如果tasks表为空，尝试从files表统计
                        if total_videos == 0:
                            total_videos = await db_manager.fetchval(
                                """
                                SELECT COUNT(*) FROM files
                                WHERE file_type = 'video'
                                AND is_deleted = FALSE
                                """
                            ) or 0
                    except Exception as e:
                        logger.warning(f"⚠️ 统计视频失败: {e}")
                        total_videos = 0

                    # 估算存储使用
                    storage_used = (total_images * 0.5) + (total_videos * 10)

                    stats['totalStoryboards'] = total_storyboards
                    stats['totalImages'] = total_images
                    stats['totalVideos'] = total_videos
                    stats['totalText'] = total_text
                    stats['storageUsedMB'] = round(storage_used, 2)
                    stats['source'] = 'backend'

                    logger.info(f"✅ 从数据库获取统计: Text={total_text}, Images={total_images}, Videos={total_videos}, Projects={stats['totalProjects']}")

                except Exception as e:
                    logger.warning(f"⚠️ 从数据库获取统计失败: {e}")

            # 2026-05-26 Slice 6: 按 user / org 分组的明细
            breakdown: List[Dict[str, Any]] = []
            if group_by in ('user', 'org') and db_manager:
                try:
                    # 公共子查询：每个 user 各项资产计数
                    # （complete = files 表过滤已删除；保留与上面一致的视频任务白名单也可，但太复杂；
                    #  这里按 files 表 file_type 简单聚合，保证表能跑）
                    per_user_sql = """
                        WITH u_files AS (
                            SELECT user_id,
                                SUM(CASE WHEN file_type='image' THEN 1 ELSE 0 END) AS img_cnt,
                                SUM(CASE WHEN file_type='video' THEN 1 ELSE 0 END) AS vid_cnt,
                                SUM(CASE WHEN file_type='audio' THEN 1 ELSE 0 END) AS aud_cnt
                            FROM files WHERE is_deleted = FALSE
                            GROUP BY user_id
                        ),
                        u_proj AS (
                            SELECT user_id, COUNT(*) AS proj_cnt
                            FROM projects
                            GROUP BY user_id
                        )
                        SELECT u.user_id, u.username,
                            COALESCE(p.proj_cnt, 0) AS projects,
                            COALESCE(f.img_cnt, 0) AS images,
                            COALESCE(f.vid_cnt, 0) AS videos,
                            COALESCE(f.aud_cnt, 0) AS audios
                        FROM users u
                        LEFT JOIN u_files f ON f.user_id = u.user_id
                        LEFT JOIN u_proj  p ON p.user_id = u.user_id
                        WHERE u.is_deleted = FALSE
                    """
                    # admin（非超管）过滤掉超管行
                    if username == 'admin':
                        per_user_sql += " AND u.username <> $1 "
                        rows = await db_manager.fetch(per_user_sql, SUPER_ADMIN)
                    else:
                        rows = await db_manager.fetch(per_user_sql)
                    user_rows = [dict(r) for r in rows]

                    if group_by == 'user':
                        breakdown = sorted(
                            user_rows,
                            key=lambda r: (r['projects'] + r['images'] + r['videos']),
                            reverse=True,
                        )
                    else:  # 'org'
                        members = await db_manager.fetch(
                            """
                            SELECT om.org_id, o.name, om.user_id
                            FROM organization_members om
                            JOIN organizations o ON o.org_id = om.org_id
                            WHERE o.status = 'active'
                            """
                        )
                        user_idx = {r['user_id']: r for r in user_rows}
                        agg: Dict[str, Dict[str, Any]] = {}
                        for m in members:
                            oid = m['org_id']
                            if oid not in agg:
                                agg[oid] = {
                                    'org_id': oid, 'name': m['name'],
                                    'member_count': 0,
                                    'projects': 0, 'images': 0, 'videos': 0, 'audios': 0,
                                }
                            agg[oid]['member_count'] += 1
                            u = user_idx.get(m['user_id'])
                            if u:
                                agg[oid]['projects'] += u['projects']
                                agg[oid]['images']   += u['images']
                                agg[oid]['videos']   += u['videos']
                                agg[oid]['audios']   += u['audios']
                        breakdown = sorted(
                            agg.values(),
                            key=lambda r: (r['projects'] + r['images'] + r['videos']),
                            reverse=True,
                        )
                except Exception as e:
                    logger.warning(f"⚠️ stats breakdown 失败 group_by={group_by}: {e}")
                    breakdown = []

            return {
                "success": True,
                "stats": stats,
                "group_by": group_by or 'none',
                "breakdown": breakdown,
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"获取系统统计失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/admin/logs")
    async def get_admin_logs(username: str = Depends(require_auth), limit: int = 100):
        """获取生成日志（仅管理员）"""
        # 🔐 权限检查：允许admin和超级管理员访问
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

        db_manager = get_db_manager()

        try:
            logs = []

            # 🔧 如果数据库可用，从数据库获取生成记录
            if db_manager:
                try:
                    # 检查projects表是否有storyboard列
                    has_storyboard_column = False
                    try:
                        test_query = await db_manager.fetch(
                            "SELECT storyboard FROM projects LIMIT 1"
                        )
                        has_storyboard_column = True
                    except Exception:
                        logger.warning("⚠️ projects表没有storyboard列，使用新表结构")

                    if has_storyboard_column:
                        # 使用旧表结构
                        # 🔐 如果是admin请求，过滤掉超级管理员的数据
                        if username == 'admin':
                            projects = await db_manager.fetch(
                                """
                                SELECT p.project_id, p.user_id, u.username, p.storyboard, p.generated_images, p.updated_at
                                FROM projects p
                                LEFT JOIN users u ON p.user_id = u.user_id
                                WHERE (p.storyboard IS NOT NULL OR p.generated_images IS NOT NULL)
                                AND u.username != $1
                                ORDER BY p.updated_at DESC
                                LIMIT $2
                                """,
                                SUPER_ADMIN,
                                limit * 2
                            )
                        else:
                            # 超级管理员可以看到所有数据
                            projects = await db_manager.fetch(
                                """
                                SELECT p.project_id, p.user_id, u.username, p.storyboard, p.generated_images, p.updated_at
                                FROM projects p
                                LEFT JOIN users u ON p.user_id = u.user_id
                                WHERE p.storyboard IS NOT NULL OR p.generated_images IS NOT NULL
                                ORDER BY p.updated_at DESC
                                LIMIT $1
                                """,
                                limit * 2
                            )

                        for project in projects:
                            user_id = project['user_id']
                            username_val = project['username'] or 'unknown'

                            storyboard = project.get('storyboard')
                            if storyboard and 'items' in storyboard:
                                for item in storyboard['items']:
                                    # 文本生成记录
                                    logs.append({
                                        'id': f"text_{project['project_id']}_{item.get('id', 'unknown')}",
                                        'userId': user_id,
                                        'username': username_val,
                                        'timestamp': int(project['updated_at'].timestamp() * 1000),
                                        'type': 'text',
                                        'model': 'gemini-2.5-flash',
                                        'status': 'success',
                                        'prompt': item.get('scriptSegment', '')[:100] or 'Storyboard generation',
                                        'params': '{"temperature": 0.7}',
                                        'executionTimeMs': 2000,
                                        'queueTimeMs': 100,
                                    })

                                    # 图片生成记录
                                    if item.get('generatedImages'):
                                        for idx, img in enumerate(item['generatedImages']):
                                            logs.append({
                                                'id': f"img_{project['project_id']}_{item.get('id', 'unknown')}_{idx}",
                                                'userId': user_id,
                                                'username': username_val,
                                                'timestamp': img.get('timestamp', int(project['updated_at'].timestamp() * 1000)),
                                                'type': 'image',
                                                'model': 'gemini-2.5-flash-image',
                                                'status': 'success',
                                                'prompt': item.get('imagePrompt', '')[:100] or 'Image generation',
                                                'params': '{"temperature": 0.7}',
                                                'executionTimeMs': 5000,
                                                'queueTimeMs': 300,
                                                'resultPreview': img.get('url')
                                            })
                    else:
                        # 使用新表结构 - 从text_contents和files统计（先跳过，主要从tasks获取）
                        logger.info("使用新表结构，从tasks表获取所有记录")

                    # 从tasks表获取所有生成任务记录（包括视频、图片等）
                    # 🔐 如果是admin请求，过滤掉超级管理员的数据
                    if username == 'admin':
                        all_tasks = await db_manager.fetch(
                            """
                            SELECT t.task_id, t.user_id, u.username, t.status, t.created_at, t.completed_at,
                                   t.task_data, t.result_data, t.task_type
                            FROM tasks t
                            LEFT JOIN users u ON t.user_id = u.user_id
                            WHERE t.status = 'completed'
                            AND u.username != $1
                            ORDER BY t.completed_at DESC
                            LIMIT $2
                            """,
                            SUPER_ADMIN,
                            limit
                        )
                    else:
                        # 超级管理员可以看到所有数据
                        all_tasks = await db_manager.fetch(
                            """
                            SELECT t.task_id, t.user_id, u.username, t.status, t.created_at, t.completed_at,
                                   t.task_data, t.result_data, t.task_type
                            FROM tasks t
                            LEFT JOIN users u ON t.user_id = u.user_id
                            WHERE t.status = 'completed'
                            ORDER BY t.completed_at DESC
                            LIMIT $1
                            """,
                            limit
                        )

                    logger.info(f"📊 从tasks表查询到 {len(all_tasks)} 个已完成任务")

                    for task in all_tasks:
                        execution_time = (task['completed_at'] - task['created_at']).total_seconds() * 1000 if task.get('completed_at') else 0

                        # 🆕 从task_data中提取prompt（task_data可能是JSON字符串）
                        task_data = task.get('task_data') or {}
                        if isinstance(task_data, str):
                            try:
                                import json
                                task_data = json.loads(task_data)
                            except:
                                task_data = {}
                        prompt = task_data.get('prompt', '')

                        # 根据task_type确定任务类型和模型名称
                        task_type = task.get('task_type') or 'unknown'

                        # 视频任务类型
                        video_types = ['i2v', 'morph', 'upscale', 'voice', 'minimax_i2v', 'minimax_morph',
                                       'wan2_i2v', 'wan2_morph', 'sora2_i2v', 'sora2_morph', 'veo_i2v', 'veo_morph',
                                       'video_crop', 'video_magnify',  # 视频裁剪和放大
                                       # 2026-05-24 DashScope 共享视频族
                                       'kling_t2v', 'kling_i2v', 'kling_morph', 'kling_refer',
                                       'vidu_r2v', 'vidu_morph',
                                       'happyhorse_r2v']
                        # 图片任务类型
                        image_types = ['qwen', 'qwen_lora', 'qwen_1', 'qwen_2', 'qwen_3', 'qwen_4', 'qwen_5',
                                      'qwen_lora_1', 'qwen_lora_2', 'qwen_lora_3', 'qwen_lora_4', 'qwen_lora_5',
                                      'kontext', 'upscale_hd', 'remove_watermark', 'three_view',
                                      'gemini_image', 'doubao_image', 'i2i_fj']  # 🆕 添加所有图像生成类型
                        # 文本任务类型
                        text_types = ['deepseek_text', 'gemini_text']  # 🆕 添加文本生成类型

                        # 判断任务类型
                        if any(vt in task_type for vt in video_types):
                            log_type = 'video'
                        elif any(it in task_type for it in image_types):
                            log_type = 'image'
                        elif any(tt in task_type for tt in text_types):
                            log_type = 'text'
                        else:
                            # 默认根据名称猜测
                            if 'video' in task_type.lower():
                                log_type = 'video'
                            elif 'image' in task_type.lower() or 'img' in task_type.lower():
                                log_type = 'image'
                            else:
                                log_type = 'text'

                        # 模型名称映射
                        model_name_map = {
                            'wan2_i2v': 'wan2-i2v',
                            'wan2_morph': 'wan2-morph',
                            'wan26_i2v': 'wan26-i2v',
                            # 2026-05-24 DashScope 共享视频族
                            'kling_t2v': 'kling-t2v',
                            'kling_i2v': 'kling-i2v',
                            'kling_morph': 'kling-morph',
                            'kling_refer': 'kling-refer',
                            'vidu_r2v': 'vidu-r2v',
                            'vidu_morph': 'vidu-morph',
                            'happyhorse_r2v': 'happyhorse-r2v',
                            'sora2_i2v': 'sora2-i2v',
                            'sora2_morph': 'sora2-morph',
                            'veo_i2v': 'veo-i2v',
                            'veo_morph': 'veo-morph',
                            'minimax_i2v': 'minimax-i2v',
                            'minimax_morph': 'minimax-morph',
                            'upscale_hd': 'upscale-hd',
                            'remove_watermark': 'remove-watermark',
                            'three_view': 'three-view',
                            'qwen': 'qwen',
                            'qwen_lora': 'qwen-lora',
                            'qwen_1': 'qwen',
                            'qwen_2': 'qwen',
                            'qwen_3': 'qwen',
                            'qwen_4': 'qwen',
                            'qwen_5': 'qwen',
                            'qwen_lora_1': 'qwen-lora',
                            'qwen_lora_2': 'qwen-lora',
                            'qwen_lora_3': 'qwen-lora',
                            'qwen_lora_4': 'qwen-lora',
                            'qwen_lora_5': 'qwen-lora',
                            'kontext': 'kontext',
                            'i2v': 'i2v',
                            'morph': 'morph',
                            'upscale': 'upscale',
                            'voice': 'voice',
                            'gemini_image_2.5-flash': 'gemini-2.5-flash-image',
                            'gemini_image_3-pro': 'gemini-3-pro-image',
                            'doubao_image': 'doubao-image',
                            'deepseek_text': 'deepseek-r1',  # 🆕 DeepSeek文本
                            'gemini_text': 'gemini-2.5-flash-text',  # 🆕 Gemini文本
                            'i2i_fj': 'comfyui-i2i',  # 🆕 ComfyUI图生图
                            'video_crop': 'video-crop',  # 🆕 视频裁剪
                            'video_magnify': 'video-magnify',  # 🆕 视频放大
                        }
                        model_name = model_name_map.get(task_type, task_type)

                        # 🆕 提取结果（根据类型区分：图片、视频、文本）
                        result_preview = None  # 图片预览URL
                        result_video = None    # 视频URL
                        result_text = None     # 文本结果

                        result_data = task.get('result_data') or {}
                        if isinstance(result_data, str):
                            try:
                                import json
                                result_data = json.loads(result_data)
                            except:
                                result_data = {}

                        # 🆕 调试：记录result_data结构
                        if not result_data:
                            logger.debug(f"⚠️ 任务 {task['task_id']} result_data为空")
                        else:
                            logger.debug(f"🔍 任务 {task['task_id']} type={task_type}, result_data keys: {list(result_data.keys())}, 前10字符: {str(result_data)[:100]}")

                        # 根据类型提取不同的结果
                        if log_type == 'image':
                            if result_data.get('images') and len(result_data['images']) > 0:
                                img = result_data['images'][0]
                                if isinstance(img, dict):
                                    result_preview = img.get('url') or img.get('filename')
                                elif isinstance(img, str):
                                    result_preview = img
                        elif log_type == 'video':
                            if result_data.get('videos') and len(result_data['videos']) > 0:
                                vid = result_data['videos'][0]
                                if isinstance(vid, dict):
                                    result_video = vid.get('url') or vid.get('filename')
                                elif isinstance(vid, str):
                                    result_video = vid
                        elif log_type == 'text':
                            # 文本任务：从result_data中提取保存的文本内容
                            if result_data.get('text'):
                                result_text = result_data['text']
                            else:
                                result_text = "（文本内容未保存）"

                        logs.append({
                            'id': f"{log_type}_{task['task_id']}",
                            'userId': task['user_id'],
                            'username': task['username'] or 'unknown',
                            'timestamp': int(task['completed_at'].timestamp() * 1000) if task.get('completed_at') else int(task['created_at'].timestamp() * 1000),
                            'type': log_type,
                            'model': model_name,
                            'status': 'success' if task['status'] == 'completed' else 'failed',
                            'prompt': (prompt or '')[:100] or f'{log_type.capitalize()} generation',
                            'params': f'{{"workflow": "{task_type}"}}',
                            'executionTimeMs': int(execution_time),
                            'queueTimeMs': 500,
                            'resultPreview': result_preview,  # 图片预览URL
                            'resultVideo': result_video,      # 视频URL
                            'resultText': result_text         # 文本结果
                        })

                    # 按时间倒序排列（不再二次限制数量）
                    logs.sort(key=lambda x: x['timestamp'], reverse=True)

                    logger.info(f"✅ 从数据库获取到 {len(logs)} 条生成日志")

                    # 🆕 调试：输出日志类型统计
                    if logs:
                        type_counts = {'text': 0, 'image': 0, 'video': 0}
                        for log in logs:
                            type_counts[log['type']] = type_counts.get(log['type'], 0) + 1
                        logger.info(f"📊 日志类型分布: Text={type_counts.get('text', 0)}, Image={type_counts.get('image', 0)}, Video={type_counts.get('video', 0)}")
                    else:
                        logger.warning(f"⚠️ 数据库中没有任何日志记录！检查：1) all_tasks查询是否返回数据 2) 任务是否正确保存")

                except Exception as e:
                    logger.warning(f"⚠️ 从数据库获取日志失败: {e}")

            return {
                "success": True,
                "logs": logs
            }
        except Exception as e:
            logger.error(f"获取生成日志失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/admin/users/create")
    async def create_user(
        user_data: dict,
        request: Request,
        username: str = Depends(require_auth)
    ):
        """创建新用户（仅管理员）"""
        # 🔐 权限检查
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

        db_manager = get_db_manager()

        try:
            new_username = user_data.get('username')
            password = user_data.get('password')
            email = user_data.get('email') or f"{new_username}@studio.com"
            role = user_data.get('role', 'editor')

            if not new_username or not password:
                raise HTTPException(status_code=400, detail="用户名和密码为必填项")
            if len(str(password)) < 8:
                raise HTTPException(status_code=400, detail="密码至少 8 位")

            # 检查用户名是否已存在
            if new_username in DEFAULT_USERS:
                raise HTTPException(status_code=400, detail="用户名已存在")

            # 添加到DEFAULT_USERS（内存）
            DEFAULT_USERS[new_username] = password

            # 如果数据库可用，同步到数据库
            if db_manager:
                try:
                    from dao_user import UserDAO
                    user = await UserDAO.create_user(
                        username=new_username,
                        password=password,
                        email=email,
                        user_id=new_username,  # user_id 必须 == username（全站资源表外键约定）
                    )
                    logger.info(f"✅ 用户 {new_username} 已创建（ID: {user['user_id'][:12]}...）")
                except Exception as e:
                    logger.warning(f"⚠️ 同步用户到数据库失败: {e}")

            # 审计留痕：新建用户（best-effort，失败不影响主流程）
            try:
                import admin_audit_service
                await admin_audit_service.record(
                    request,
                    admin_user_id=username,
                    action='user_create', target_type='user', target_id=new_username,
                    after={'username': new_username, 'email': email, 'role': role},
                )
            except Exception as _audit_e:
                logger.warning(f"⚠️ 审计记录失败(user_create): {_audit_e}")

            return {
                "success": True,
                "message": "用户创建成功",
                "user": {
                    "username": new_username,
                    "email": email,
                    "role": role
                }
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"创建用户失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/admin/users/{user_id}")
    async def delete_user(
        user_id: str,
        username: str = Depends(require_auth)
    ):
        """删除用户（仅管理员）"""
        # 🔐 权限检查：只有admin和超级管理员可以删除用户
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

        db_manager = get_db_manager()

        try:
            # 防止删除自己
            if user_id == username:
                raise HTTPException(status_code=400, detail="不能删除自己的账号")

            # 防止删除admin和超级管理员
            if user_id in ['admin', SUPER_ADMIN]:
                raise HTTPException(status_code=400, detail="不能删除系统管理员账号")

            # 如果数据库可用，从数据库删除
            if db_manager:
                try:
                    # 删除用户记录（使用user_id字段，不是username）
                    result = await db_manager.execute(
                        "DELETE FROM users WHERE user_id = $1",
                        user_id
                    )

                    logger.info(f"✅ 管理员 {username} 删除了用户: {user_id}，影响行数: {result}")
                    return {
                        "success": True,
                        "message": f"用户 {user_id} 已从数据库删除"
                    }
                except Exception as db_error:
                    logger.error(f"数据库删除用户失败: {db_error}")
                    raise HTTPException(status_code=500, detail=f"数据库删除失败: {str(db_error)}")
            else:
                # 如果没有数据库，只返回成功（前端会从列表移除）
                logger.warning(f"⚠️ 数据库未连接，无法真正删除用户 {user_id}")
                return {
                    "success": True,
                    "message": f"用户 {user_id} 已删除（模拟）"
                }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"删除用户失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
