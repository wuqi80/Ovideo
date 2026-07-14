# -*- coding: utf-8 -*-
"""
新增API路由 - 用户管理、项目、版本、文件
这个文件应该被导入到cluster_main.py中
"""
from fastapi import APIRouter, HTTPException, Depends, Request
import logging

from dao_user import UserDAO
from dao_content import ProjectDAO, VersionDAO, FileDAO, TextContentDAO, ProjectMemberDAO
from dao_task import TaskDAO, ActivityLogDAO
from dao_notification import NotificationDAO
from dao_canvas import CanvasBoardDAO, CanvasNodeDAO, CanvasConnectionDAO
from dao_asset import AssetDAO
from dao_storyboard import StoryboardDAO
from dao_episode_script import EpisodeScriptDAO
from dao_episode_script_segment import EpisodeScriptSegmentDAO
from dao_video_segment import VideoSegmentDAO
from dao_entity_file import EntityFileDAO
from dao_timeline import TimelineDAO
from dao_audio_track import AudioTrackDAO
from dao_character_voice import CharacterVoiceDAO
from dao_video_voice_reference import VideoVoiceReferenceDAO
from dao_organization import OrganizationMemberDAO
from audio_provider import get_audio_provider, AUDIO_UPLOAD_DIR

try:
    from external_api.audio.minimax_audio import get_minimax_audio_client
except ImportError:
    get_minimax_audio_client = None
    logging.getLogger(__name__).warning("external_api.audio.minimax_audio 模块不可用，MiniMax 音频端点将返回 501")
from file_optimization import FileOptimizationService, FileDeduplicationService

# 2026-05-25：MiniMax TTS 短文本试听 fast-path 需要在模块顶部 import
# save_generated_file_to_db，使其成为 api_routes 命名空间属性，
# 让 tests 可以 patch('api_routes.save_generated_file_to_db', ...)。
# 详见 docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md
from file_service import save_generated_file_to_db
from routers.auth_legacy import create_auth_legacy_router
from routers.assets import create_assets_router
from routers.audio import create_audio_router
from routers.canvas import create_canvas_router
from routers.content_versions import create_content_versions_router
from routers.entity_files import create_entity_files_router
from routers.episode_video import create_episode_video_router
from routers.episodes import create_episodes_router
from routers.legacy_files import create_legacy_files_router
from routers.project_core import create_project_core_router
from routers.project_admin import create_project_admin_router
from routers.script_timeline import create_script_timeline_router
from routers.storyboard import create_storyboard_router
from routers.task_notifications import create_task_notifications_router
from routers.video_capabilities import create_video_capabilities_router
from routers.video_voice_references import create_video_voice_references_router

# 2026-05-24：MiniMax TTS 改异步入队，handler 调 task_service.submit
import task_service

# 配置日志
logger = logging.getLogger(__name__)

# 创建路由
router = APIRouter()

# ============================================
# JWT 令牌认证
# ============================================
import jwt_auth

# ============================================
# 依赖项 - 获取当前用户
# ============================================

async def get_current_user(request: Request) -> str:
    """从请求的 JWT 令牌中获取当前用户ID"""
    authorization = request.headers.get("Authorization")
    if not authorization:
        raise HTTPException(status_code=401, detail="未授权")
    
    token = authorization.replace("Bearer ", "")
    username = jwt_auth.verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Token已失效或不存在，请重新登录")
    return username


def _require_minimax_client():
    if get_minimax_audio_client is None:
        raise HTTPException(status_code=501, detail="MiniMax audio module is unavailable; deploy minimax_audio.py")
    client = get_minimax_audio_client()
    refresh = getattr(client, "_refresh_runtime_config", None)
    if callable(refresh):
        refresh()
    if not getattr(client, 'api_key', None):
        raise HTTPException(
            status_code=503,
            detail=(
                "MINIMAX_API_KEY is not configured. Add provider=minimax in Admin API config, "
                "save it, and refresh runtime if it still does not take effect."
            )
        )
    return client


router.include_router(
    create_audio_router(
        get_current_user_dependency=get_current_user,
        audio_track_dao=AudioTrackDAO,
        character_voice_dao=CharacterVoiceDAO,
        get_audio_provider_func=get_audio_provider,
        audio_upload_dir=AUDIO_UPLOAD_DIR,
        require_minimax_client=lambda: _require_minimax_client(),
        task_service_module=task_service,
        save_generated_file_to_db_provider=lambda: save_generated_file_to_db,
        logger=logger,
    )
)

router.include_router(
    create_script_timeline_router(
        get_current_user_dependency=get_current_user,
        episode_script_dao=EpisodeScriptDAO,
        episode_script_segment_dao=EpisodeScriptSegmentDAO,
        timeline_dao=TimelineDAO,
    )
)

router.include_router(
    create_canvas_router(
        get_current_user_dependency=get_current_user,
        project_member_dao=ProjectMemberDAO,
        canvas_board_dao=CanvasBoardDAO,
        canvas_node_dao=CanvasNodeDAO,
        canvas_connection_dao=CanvasConnectionDAO,
    )
)

router.include_router(
    create_task_notifications_router(
        get_current_user_dependency=get_current_user,
        task_dao=TaskDAO,
        notification_dao=NotificationDAO,
        get_task_queue=lambda: task_service.get_queue(),
    )
)

router.include_router(
    create_project_admin_router(
        get_current_user_dependency=get_current_user,
        user_dao=UserDAO,
        project_dao=ProjectDAO,
        project_member_dao=ProjectMemberDAO,
    )
)

router.include_router(
    create_content_versions_router(
        get_current_user_dependency=get_current_user,
        project_dao=ProjectDAO,
        version_dao=VersionDAO,
        file_dao=FileDAO,
        text_content_dao=TextContentDAO,
        activity_log_dao=ActivityLogDAO,
    )
)

try:
    from dao_episode import EpisodeDAO
except ImportError:
    EpisodeDAO = None

if EpisodeDAO is not None:
    router.include_router(
        create_episodes_router(
            get_current_user_dependency=get_current_user,
            episode_dao=EpisodeDAO,
            episode_script_dao=EpisodeScriptDAO,
        )
    )

router.include_router(
    create_episode_video_router(
        get_current_user_dependency=get_current_user,
        video_segment_dao=VideoSegmentDAO,
        episode_dao=EpisodeDAO,
    )
)

router.include_router(create_video_capabilities_router())

router.include_router(
    create_video_voice_references_router(
        get_current_user_dependency=get_current_user,
        video_voice_reference_dao=VideoVoiceReferenceDAO,
        episode_dao=EpisodeDAO,
    )
)

router.include_router(
    create_storyboard_router(
        get_current_user_dependency=get_current_user,
        storyboard_dao=StoryboardDAO,
        episode_script_dao=EpisodeScriptDAO,
        asset_dao=AssetDAO,
        episode_dao=EpisodeDAO,
        logger=logger,
    )
)

router.include_router(
    create_assets_router(
        get_current_user_dependency=get_current_user,
        asset_dao=AssetDAO,
        entity_file_dao=EntityFileDAO,
        episode_dao=EpisodeDAO,
        logger=logger,
    )
)

router.include_router(
    create_entity_files_router(
        get_current_user_dependency=get_current_user,
        file_dao=FileDAO,
        entity_file_dao=EntityFileDAO,
        save_generated_file_to_db_provider=lambda: save_generated_file_to_db,
        logger=logger,
    )
)

router.include_router(
    create_legacy_files_router(
        get_current_user_dependency=get_current_user,
        user_dao=UserDAO,
        version_dao=VersionDAO,
        file_dao=FileDAO,
        activity_log_dao=ActivityLogDAO,
        file_optimization_service=FileOptimizationService,
        file_deduplication_service=FileDeduplicationService,
        jwt_auth_module=jwt_auth,
        logger=logger,
    )
)

router.include_router(
    create_auth_legacy_router(
        get_current_user_dependency=get_current_user,
        user_dao=UserDAO,
        activity_log_dao=ActivityLogDAO,
    )
)

router.include_router(
    create_project_core_router(
        get_current_user_dependency=get_current_user,
        project_dao=ProjectDAO,
        version_dao=VersionDAO,
        project_member_dao=ProjectMemberDAO,
        user_dao=UserDAO,
        activity_log_dao=ActivityLogDAO,
        organization_member_dao=OrganizationMemberDAO,
    )
)
