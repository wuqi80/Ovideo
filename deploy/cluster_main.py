# -*- coding: utf-8 -*-
"""
ComfyUI 集群主程序
整合 FastAPI API、Worker、集群管理器、任务队列
"""
import sys
sys.modules.setdefault('cluster_main', sys.modules[__name__])

import asyncio
import logging
import os
import uuid
import time
import random
import requests
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field

# ── Pydantic 模型已抽离至 schemas/ 包（规范 §2.3 / §6，MVC增量1）。
#    下列导入同时作为对外 re-export：保持 `from cluster_main import <Model>`
#    与 `cluster_main.<Model>` 的历史引用零破坏（如 tests/test_dashscope_wiring_e2e.py）。
from schemas.generation import (
    GenerateRequest,
    DeepseekChatRequest,
    DoubaoImageRequest,
    GeminiTextRequest,
    GeminiImageRequest,
    GptImageRequest,
    ImageGenerationRequest,
    ComfyUIWorkflowRequest,
    AngleAdjustRequest,
    HumanMultiAngleRequest,
    AroundAngleRequest,
    MattingRequest,
    ImageFusionRequest,
    Panorama360Request,
    PanoramaFusionRequest,
    AutoStoryboardRequest,
    MultiGridStoryboardRequest,
    MaterialProcessRequest,
)
from schemas.project import ProjectData, ExportToVideoRequest
import redis.asyncio as redis

# 导入集群组件
from cluster_config import (
    ClusterConfig, RedisConfig, SystemConfig, WorkerConfig,
    validate_cluster_config
)
from cluster_manager import ClusterManager
from worker import Worker

# 🆕 导入数据库模块
from db_manager import init_db_manager, get_db_manager
from api_routes import router as api_router
from media_library_routes import router as media_library_router
from credit_routes import router as credit_router
from video_reverse_routes import router as video_reverse_router
from dao_task import TaskDAO
from dao_content import FileDAO, ProjectDAO, VersionDAO, WorkspaceSessionDAO
from dao_user import UserDAO

DB_AVAILABLE = True

# 🆕 导入管理后台模块
from agent_routes import router as agent_api_router
from admin_routes import router as admin_api_router
from api_router import set_redis_client as set_api_router_redis
from services.api_config_runtime_loader import (
    load_api_configs_to_env as _load_api_configs_to_env_service,
    runtime_api_key_globals,
    seed_default_api_providers as _seed_default_api_providers_service,
)
from services.api_provider_health_monitor import (
    provider_health_monitor_loop,
    set_provider_health_redis,
)
from services.ai_proxy_service import AIProxyError, generate_gemini_images
from services.api_provider_runtime import build_provider_runtime_status
from routers.ai_proxy import create_ai_proxy_router
from routers.admin_compat import create_admin_compat_router
from routers.auth import create_auth_router
from routers.cluster_status import create_cluster_status_router
from routers.comfyui_files import create_comfyui_files_router
from routers.fallback_static import create_fallback_static_router
from routers.files import cleanup_thumbnail_cache, create_files_router
from routers.frontend_pages import create_frontend_pages_router
from routers.generation import create_generation_router
from routers.projects import create_projects_router
from routers.prompts import create_prompt_router
from routers.tasks import create_task_router
from routers.user_session import create_user_session_router
from routers.video import create_video_router
from routers.workspace import create_workspace_router
import task_service




# 配置日志
os.makedirs("logs", exist_ok=True)
logging.basicConfig(
    level=getattr(logging, SystemConfig.LOG_LEVEL),
    format=SystemConfig.LOG_FORMAT,
    handlers=[
        logging.FileHandler(SystemConfig.LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_int_at_least(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        logger.warning("Invalid %s value, using default %s", name, default)
        return default


def task_stale_reaper_settings() -> dict[str, int | bool]:
    return {
        "enabled": _env_bool("TASK_STALE_REAPER_ENABLED", True),
        "hours": _env_int_at_least("TASK_STALE_REAPER_HOURS", 24, 1),
        "initial_delay_seconds": _env_int_at_least("TASK_STALE_REAPER_INITIAL_DELAY_SECONDS", 900, 0),
        "interval_seconds": _env_int_at_least("TASK_STALE_REAPER_INTERVAL_SECONDS", 3600, 60),
    }


async def run_task_stale_reaper_once(cleanup_fn=None) -> int:
    settings = task_stale_reaper_settings()
    if not settings["enabled"]:
        return 0
    cleanup = cleanup_fn or TaskDAO.cleanup_stale
    return int(await cleanup(int(settings["hours"])))

# 验证配置
config_errors = validate_cluster_config()
if config_errors:
    logger.error("配置验证失败:")
    for error in config_errors:
        logger.error(f"  - {error}")
    raise ValueError("配置错误")

# 初始化目录
for dir_path in [SystemConfig.UPLOAD_DIR, SystemConfig.OUTPUT_DIR, SystemConfig.TEMP_DIR]:
    Path(dir_path).mkdir(parents=True, exist_ok=True)

# ============================================
# API 配置从数据库加载到运行时环境变量
# ============================================


async def load_api_configs_to_env():
    """Compatibility wrapper for legacy cluster_main imports."""
    result = await _load_api_configs_to_env_service()
    globals().update(runtime_api_key_globals())
    return result

async def seed_default_api_providers():
    """Compatibility wrapper; implementation lives in api_config_runtime_loader."""
    return await _seed_default_api_providers_service()


def log_api_provider_runtime_summary() -> None:
    """Log resolver-backed provider readiness after DB configs have loaded."""
    try:
        statuses = build_provider_runtime_status()
    except Exception as exc:
        logger.warning("API provider runtime summary unavailable: %s", exc, exc_info=True)
        return

    ready = sum(1 for item in statuses if item.get("ready"))
    missing_key = sum(1 for item in statuses if "missing_key" in (item.get("issues") or []))
    incomplete = len(statuses) - ready - missing_key
    logger.info(
        "API provider runtime summary: total=%s ready=%s missing_key=%s incomplete=%s",
        len(statuses),
        ready,
        missing_key,
        incomplete,
    )


async def seed_admin_roles():
    """初次部署兜底：内置管理员账号首次登录时被懒创建，role 列默认 'user'，
    导致后台 /api/admin/* 一律 403。这里启动时幂等地把它们的 role 纠正为
    admin / super_admin，使后台开箱即用、且用户列表里角色显示正确。

    注意：require_admin 已对 {admin, lllsdhr} 做内置白名单兜底（即便此处尚未跑、
    或用户行还没创建，也能进后台）；本函数只负责让数据库的 role 列与之保持一致。
    """
    try:
        from dao_user import UserDAO
        # admin → 普通管理员；SUPER_ADMIN → 超级管理员
        targets = [('admin', 'admin'), (SUPER_ADMIN, 'super_admin')]
        for uname, want_role in targets:
            try:
                u = await UserDAO.get_user_by_username(uname)
            except Exception:
                u = None
            if not u:
                continue
            cur = (u.get('role') if isinstance(u, dict) else None) or 'user'
            # admin 只要已是 admin/super_admin 就不动；超管必须恰为 super_admin
            ok = (cur in ('admin', 'super_admin')) if want_role == 'admin' else (cur == 'super_admin')
            if not ok:
                uid = u.get('user_id') if isinstance(u, dict) else None
                if uid:
                    await UserDAO.set_role(uid, want_role)
                    logger.info(f"🌱 内置管理员角色校正：{uname} → {want_role}")
    except Exception as e:
        logger.warning(f"⚠️ seed_admin_roles 跳过（role 列可能尚未迁移，不影响启动）：{e}")


# ============================================
# Lifespan 事件处理
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 声明全局变量（在函数内部使用之前需要声明）
    global redis_client, pubsub_redis_client, cluster_manager, image_cluster_manager, video_cluster_manager, workers, storage_manager, db_manager, MAIN_EVENT_LOOP, provider_health_monitor_task

    # 🆕 捕获主事件循环：sync generator 流式响应在 anyio worker thread 中迭代，
    # 那里没有 running loop。任何需要触达 asyncpg 池的 fire-and-forget 协程
    # 必须通过 asyncio.run_coroutine_threadsafe(coro, MAIN_EVENT_LOOP) 调度回主 loop。
    MAIN_EVENT_LOOP = asyncio.get_running_loop()

    # ===== 启动事件 =====
    logger.info("=" * 60)
    logger.info(f"启动 {SystemConfig.FRONTEND_CONFIG['title']}")
    logger.info("=" * 60)

    # 🆕 初始化数据库
    try:
        db_manager = await init_db_manager()
        logger.info("✅ 数据库连接池已创建")
    except Exception as e:
        logger.error(f"❌ 数据库连接失败: {e}")
        logger.warning("系统将在没有数据库持久化的情况下运行")
        db_manager = None

    # 从数据库加载 API 配置到环境变量（必须在 Redis/Worker 初始化之前）
    if db_manager:
        # 2026-05-21：先做 GPT Image 占位 seed + 化神 nano3→nano2 in-place 升级，
        # 再 load_api_configs_to_env，确保升级后的 endpoint/key 一并被注入环境变量。
        await _seed_default_api_providers_service()
        await seed_admin_roles()  # 初次部署：内置管理员 role 校正，后台开箱即用
        await load_api_configs_to_env()
        log_api_provider_runtime_summary()

    # ✅ 移除storage_manager，改用数据库文件管理
    # 所有文件保存通过FileDAO进行
    storage_manager = None

    # 连接 Redis
    logger.info(f"连接 Redis: {RedisConfig.HOST}:{RedisConfig.PORT}")
    redis_client = redis.Redis(
        host=RedisConfig.HOST,
        port=RedisConfig.PORT,
        db=RedisConfig.DB,
        password=RedisConfig.PASSWORD,
        max_connections=RedisConfig.MAX_CONNECTIONS,
        decode_responses=True
    )

    # 🆕 2026-05-21：SSE pubsub 专用 Redis 客户端（独立连接池）
    # 根因：每个 /api/tasks/stream SSE 客户端会持有 1 个 pubsub 长连接（不归还），
    # 之前与业务 redis_client 共享 max_connections=50 的池，多 tab/重连风暴
    # 会让 pubsub 长连接挤占完业务连接，触发 redis.ConnectionError("Too many connections")
    # 直接报到 starlette stream_response，前端表现为 net::ERR_INCOMPLETE_CHUNKED_ENCODING。
    # 隔离到独立连接池后：① pubsub 池满只影响通知功能，业务 API 不受波及；② 池容量更大。
    pubsub_redis_client = redis.Redis(
        host=RedisConfig.HOST,
        port=RedisConfig.PORT,
        db=RedisConfig.DB,
        password=RedisConfig.PASSWORD,
        max_connections=200,
        decode_responses=True
    )

    try:
        await redis_client.ping()
        await pubsub_redis_client.ping()
        logger.info("✅ Redis 连接成功（业务池 + pubsub 专用池）")
    except Exception as e:
        logger.error(f"❌ Redis 连接失败: {e}")
        raise

    set_provider_health_redis(redis_client)

    # 🆕 注入 Redis 到智能 API 路由器
    set_api_router_redis(redis_client)

    # ✅ 始终初始化 TaskService（Agent 模式下 agent 通过 Redis 队列拉取任务）
    import task_service
    task_service.init(redis_client)

    if not SystemConfig.AGENT_ONLY_MODE:
        # 🆕 初始化图像集群管理器
        logger.info("初始化图像集群管理器...")
        image_cluster_manager = ClusterManager(redis_client, node_type="image")
        await image_cluster_manager.start()
        logger.info("✅ 图像集群管理器已启动")

        # 🆕 初始化视频集群管理器
        logger.info("初始化视频集群管理器...")
        video_cluster_manager = ClusterManager(redis_client, node_type="video")
        await video_cluster_manager.start()
        logger.info("✅ 视频集群管理器已启动")

        # 保留旧变量用于兼容性（指向图像集群）
        cluster_manager = image_cluster_manager

        # 启动 Workers（传入两个集群管理器）
        logger.info(f"启动 {WorkerConfig.NUM_WORKERS} 个 Workers...")
        for i in range(WorkerConfig.NUM_WORKERS):
            worker_id = f"{WorkerConfig.WORKER_ID_PREFIX}-{i+1}"
            # 🆕 Worker 需要能访问两个集群管理器
            worker = Worker(
                worker_id,
                redis_client,
                image_cluster_manager,  # 默认使用图像集群
                task_service.get_queue(),
                video_cluster_manager=video_cluster_manager  # 传入视频集群
            )
            workers.append(worker)
            asyncio.create_task(worker.start())
            logger.info(f"✅ Worker {worker_id} 已启动")

        logger.info("=" * 60)
        logger.info("系统启动完成！")
        logger.info(f"图像集群节点: {len(ClusterConfig.get_image_nodes())} 个")
        logger.info(f"视频集群节点: {len(ClusterConfig.get_video_nodes())} 个")
        logger.info(f"Workers: {WorkerConfig.NUM_WORKERS}")
        logger.info("=" * 60)
    else:
        # ============================================
        # 2026-05-26 Follow-up A：lite Worker 模式
        #   原行为：AGENT_ONLY_MODE=true 完全不起 Worker → minimax_tts/seedance/kling/vidu/
        #   happyhorse/sora2/veo/wan26/video_reverse_prompt 等外部 API 任务全部死在 Redis 队列。
        #   现行为：起 N 个 lite Worker（cluster_manager=None），只消费外部 API 任务；
        #   ComfyUI workflow 任务会被 worker._process_task 顶部守卫丢回队列让外部 agent 拿。
        #   详见 docs/faq.md 2026-05-26 "AGENT_ONLY_MODE 二选一陷阱" + worker.py is_external_api_task()。
        # ============================================
        lite_count = max(0, int(SystemConfig.LITE_WORKERS_COUNT))
        if lite_count > 0:
            logger.info(f"启动 {lite_count} 个 lite Worker（只消费外部 API 任务，ComfyUI 任务交给 agent）...")
            for i in range(lite_count):
                worker_id = f"{WorkerConfig.WORKER_ID_PREFIX}-lite-{i+1}"
                worker = Worker(
                    worker_id,
                    redis_client,
                    None,  # image cluster_manager — lite 模式不需要本地集群
                    task_service.get_queue(),
                    video_cluster_manager=None,  # 同上
                )
                workers.append(worker)
                asyncio.create_task(worker.start())
                logger.info(f"✅ lite Worker {worker_id} 已启动")
        else:
            logger.info("ℹ️ LITE_WORKERS_COUNT=0：不启动任何 lite Worker（外部 API 任务将无消费者）")

        logger.info("=" * 60)
        logger.info("ℹ️ AGENT_ONLY_MODE: 本地 ComfyUI 集群管理器未启动（任务交给外部 agent）")
        logger.info(f"ℹ️ AGENT_ONLY_MODE: {lite_count} 个 lite Worker 已就绪（外部 API 任务消费者）")
        logger.info("ℹ️ AGENT_ONLY_MODE: 集群健康检查为可选模式")
        logger.info("系统以Agent-Only + Lite Worker 模式启动完成！")
        logger.info("=" * 60)

    # P5-2: 创建路径兼容符号链接（videos -> video, images -> image）
    try:
        import platform
        storage_root = Path('persistent_storage')
        for plural, singular in [('videos', 'video'), ('images', 'image')]:
            target = storage_root / singular
            link = storage_root / plural
            if target.exists() and not link.exists():
                if platform.system() == 'Windows':
                    # Windows: 创建目录连接（不需要管理员权限）
                    import subprocess
                    subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(target)],
                                   capture_output=True, check=False)
                else:
                    link.symlink_to(singular)
                logger.info(f"✅ 路径兼容链接: {plural} -> {singular}")
    except Exception as e:
        logger.warning(f"⚠️ 创建路径兼容链接失败（不影响运行）: {e}")

    # P5-1: 启动文件健康检查后台任务
    async def file_health_checker():
        """每24小时扫描一次文件完整性"""
        await asyncio.sleep(300)  # 首次延迟5分钟启动
        while True:
            try:
                if DB_AVAILABLE:
                    files = await FileDAO.get_recent_files(limit=500)
                    missing_count = 0
                    for f in files:
                        file_path = f.get('file_path', '')
                        if file_path and not file_path.startswith('comfyui://'):
                            full_path = Path(file_path) if os.path.isabs(file_path) else Path(os.path.dirname(os.path.abspath(__file__))) / file_path
                            if not full_path.exists():
                                missing_count += 1
                                logger.warning(f"文件缺失: {f.get('file_id')} -> {file_path}")
                    if missing_count > 0:
                        logger.warning(f"文件健康检查: {missing_count}/{len(files)} 个文件缺失")
                    else:
                        logger.info(f"文件健康检查: {len(files)} 个文件全部正常")
            except Exception as e:
                logger.error(f"文件健康检查异常: {e}")
            await asyncio.sleep(86400)

    asyncio.create_task(file_health_checker())

    async def thumbnail_cache_cleaner():
        await asyncio.sleep(600)
        while True:
            try:
                stats = cleanup_thumbnail_cache()
                if stats.get("removed"):
                    logger.info(
                        "Thumbnail cache cleanup removed %s files, freed %.2f MB, remaining %.2f MB",
                        stats["removed"],
                        stats["bytes_removed"] / 1024 / 1024,
                        stats["bytes_after"] / 1024 / 1024,
                    )
            except Exception as e:
                logger.warning("Thumbnail cache cleanup failed: %s", e)
            await asyncio.sleep(86400)

    asyncio.create_task(thumbnail_cache_cleaner())

    async def task_stale_reaper():
        settings = task_stale_reaper_settings()
        if not settings["enabled"]:
            logger.info("Task stale reaper disabled by TASK_STALE_REAPER_ENABLED")
            return
        await asyncio.sleep(int(settings["initial_delay_seconds"]))
        while True:
            try:
                cleaned = await run_task_stale_reaper_once()
                if cleaned:
                    logger.warning(
                        "Task stale reaper marked %s stale tasks as failed (threshold=%sh)",
                        cleaned,
                        task_stale_reaper_settings()["hours"],
                    )
            except Exception as e:
                logger.error("Task stale reaper failed: %s", e, exc_info=True)
            await asyncio.sleep(int(task_stale_reaper_settings()["interval_seconds"]))

    asyncio.create_task(task_stale_reaper())

    provider_health_monitor_task = asyncio.create_task(provider_health_monitor_loop(redis_client))

    # 🆕 Agent 超时检测后台任务
    async def agent_stale_checker():
        """每30秒检查一次，将超时未心跳的Agent标记为离线"""
        await asyncio.sleep(30)
        while True:
            try:
                from dao_agent import AgentDAO
                count = await AgentDAO.mark_stale_offline(timeout_seconds=300)
                if count > 0:
                    logger.info(f"🔌 标记 {count} 个超时Agent为离线")
            except Exception as e:
                logger.error(f"Agent超时检测异常: {e}")
            await asyncio.sleep(30)

    asyncio.create_task(agent_stale_checker())

    yield  # 应用运行期间

    # ===== 关闭事件 =====
    logger.info("正在关闭系统...")

    if provider_health_monitor_task:
        provider_health_monitor_task.cancel()
        try:
            await provider_health_monitor_task
        except asyncio.CancelledError:
            pass

    # 停止 Workers（含 AGENT_ONLY_MODE=true 下启动的 lite Workers — 2026-05-26 Follow-up A）
    for worker in workers:
        await worker.stop()

    # 🆕 关闭数据库连接
    if db_manager:
        await db_manager.disconnect()
        logger.info("✅ 数据库连接已关闭")

    # 关闭 Redis 连接
    if redis_client:
        await redis_client.close()
    if pubsub_redis_client:
        try:
            await pubsub_redis_client.close()
        except Exception as e:
            logger.warning(f"关闭 pubsub_redis_client 失败: {e}")

    logger.info("系统已关闭")

# ============================================
# 创建 FastAPI 应用
# ============================================

app = FastAPI(
    title=SystemConfig.FRONTEND_CONFIG["title"],
    description=SystemConfig.FRONTEND_CONFIG["description"],
    version=SystemConfig.FRONTEND_CONFIG["version"],
    lifespan=lifespan  # 使用新的 lifespan 处理器
)

# CORS（需要在路由注册前设置）
app.add_middleware(
    CORSMiddleware,
    allow_origins=SystemConfig.ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态资源缓存头（文件名含UUID/hash，内容不变，长期缓存）
from starlette.middleware.base import BaseHTTPMiddleware

class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith('/storage/') or path.startswith('/uploads/'):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        elif path.startswith('/assets/'):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response

app.add_middleware(CacheControlMiddleware)

# 🆕 注册管理后台路由
app.include_router(agent_api_router)
app.include_router(admin_api_router)

# 挂载静态文件目录
import os
from fastapi.staticfiles import StaticFiles
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# 挂载临时上传目录（用于ComfyUI生成的文件）
temp_uploads_dir = os.path.join(os.path.dirname(__file__), "temp", "uploads")
if not os.path.exists(temp_uploads_dir):
    os.makedirs(temp_uploads_dir, exist_ok=True)
try:
    app.mount("/uploads", StaticFiles(directory=temp_uploads_dir), name="uploads")
    logger.info(f"✅ 已挂载临时上传目录: {temp_uploads_dir}")
except Exception as e:
    logger.warning(f"无法挂载temp/uploads目录: {e}")

# 挂载持久化存储目录（auto-create 确保 /storage mount 不会被静默跳过——
# 否则首次部署 persistent_storage/ 不存在 → 后续写入的音频/图片 URL 都会 404）
storage_dir = os.path.join(os.path.dirname(__file__), "persistent_storage")
os.makedirs(storage_dir, exist_ok=True)
os.makedirs(os.path.join(storage_dir, "audio"), exist_ok=True)
try:
    app.mount("/storage", StaticFiles(directory=storage_dir), name="storage")
    logger.info(f"✅ 已挂载持久化存储目录: {storage_dir}")
except Exception as e:
    logger.warning(f"无法挂载storage目录: {e}")

# 🆕 挂载旧版管理后台前端（Cluster Admin 静态控制台：仪表盘 / 集群管理 / 工作流管理 / API 密钥）
# 2026-05-26：mount path 从 /admin → /admin-legacy，把 /admin/* 完全让给新的 React Admin Shell。
#  - 历史问题：原来 mount("/admin", StaticFiles, html=True) 会拦截 /admin/login、/admin/operations 等，
#    使新版独立后台 React 路由永远 404（详见 docs/faq.md 2026-05-26 "/admin/login 404"）。
#  - 旧版 admin/index.html 用相对路径加载 style.css / app.js / 调用绝对路径 /api/admin/*，
#    搬到 /admin-legacy/ 后所有内部链接仍正常工作（相对路径自动变 /admin-legacy/style.css）。
#  - 新版 React Admin Shell 的外链由 AdminLayout / AdminHubPage / AdminSettingsPage 直接指向 /admin-legacy/。
admin_dir = os.path.join(os.path.dirname(__file__), "admin")
if os.path.exists(admin_dir):
    try:
        app.mount("/admin-legacy", StaticFiles(directory=admin_dir, html=True), name="admin-legacy")
        logger.info(f"✅ 已挂载旧版管理后台 (legacy): /admin-legacy → {admin_dir}")
    except Exception as e:
        logger.warning(f"无法挂载admin目录: {e}")

# 挂载构建后的前端文件（如果存在）
dist_dir = os.path.join(os.path.dirname(__file__), "dist")
if os.path.exists(dist_dir):
    try:
        app.mount("/assets", StaticFiles(directory=os.path.join(dist_dir, "assets")), name="assets")
        logger.info(f"✅ 已挂载构建后的前端资源: {dist_dir}")
    except Exception as e:
        logger.warning(f"无法挂载dist目录: {e}")

# 全局变量
redis_client: Optional[redis.Redis] = None
cluster_manager: Optional[ClusterManager] = None  # 保留用于兼容性（指向image_cluster）
image_cluster_manager: Optional[ClusterManager] = None  # 🆕 图像集群管理器
video_cluster_manager: Optional[ClusterManager] = None  # 🆕 视频集群管理器
workers: List[Worker] = []
db_manager = None  # 🆕 数据库管理器
storage_manager = None  # 存储管理器
provider_health_monitor_task: Optional[asyncio.Task] = None
# 🆕 主事件循环引用（用于在 anyio 工作线程中通过 run_coroutine_threadsafe
# 把协程调度回主循环）。Starlette 在 worker thread 里迭代同步生成器
# (StreamingResponse + sync generator)，那里没有事件循环；asyncpg 的连接池
# 又必须在创建它的同一个 loop 上使用，所以必须显式持有主 loop 引用。
MAIN_EVENT_LOOP: Optional[asyncio.AbstractEventLoop] = None
DOUBAO_MODEL = os.environ.get("DOUBAO_IMAGE_MODEL", "doubao-seedream-4-0-250828")

# 认证
security = HTTPBearer(auto_error=False)
import jwt_auth
jwt_auth.init()

# 在线用户追踪（仅用于 admin 面板显示，不用于认证）
_online_users: dict = {}

# 内置账号：仅保留 admin（DB 同步账号）。
# 生产应设强密码环境变量覆盖：ADMIN_PASSWORD。
DEFAULT_USERS = {
    'admin': os.getenv('ADMIN_PASSWORD', 'admin123'),
}

# 超级管理员账号（历史保留，不再注册内置密码）
SUPER_ADMIN = 'admin'


# 认证函数
def verify_credentials(username: str, password: str) -> bool:
    """验证用户凭证（仅用于硬编码用户）"""
    return username in DEFAULT_USERS and DEFAULT_USERS[username] == password

def create_session_token(username: str) -> str:
    _online_users[username] = datetime.now()
    return jwt_auth.create_token(username)

def verify_session(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[str]:
    if not credentials:
        return None
    username = jwt_auth.verify_token(credentials.credentials)
    if username:
        _online_users[username] = datetime.now()
    return username

async def require_auth(username: Optional[str] = Depends(verify_session)) -> str:
    """认证中间件：验证用户登录状态，并自动在数据库中创建用户记录"""
    if not username:
        raise HTTPException(status_code=401, detail="需要登录")

    # 🆕 自动创建数据库用户记录（如果不存在且数据库可用）
    if db_manager:
        try:
            from dao_user import UserDAO
            # 检查用户是否已存在于数据库（使用 user_id 或 username）
            existing_user = await UserDAO.get_user_by_id(username)
            if not existing_user:
                existing_user = await UserDAO.get_user_by_username(username)

            if not existing_user:
                # 自动创建用户记录
                logger.info(f"🔧 用户 {username} 不存在于数据库，自动创建...")
                created_user = await UserDAO.create_user(
                    username=username,
                    password="auto_created_placeholder",
                    email=f"{username}@system.local",
                    user_id=username,  # 使用 username 作为 user_id
                    password_hash="auto_created_placeholder_hash"
                )
                if created_user:
                    logger.info(f"✅ 自动创建数据库用户成功: {username} (ID: {created_user.get('user_id')})")
                else:
                    logger.error(f"❌ 自动创建用户失败，返回值为None")
        except Exception as e:
            logger.error(f"⚠️ 创建用户记录失败: {e}", exc_info=True)
            # 不抛出异常，允许继续（向后兼容）

    return username

app.include_router(
    create_ai_proxy_router(
        require_auth_dependency=require_auth,
        get_main_event_loop=lambda: MAIN_EVENT_LOOP,
        doubao_model_provider=lambda: DOUBAO_MODEL,
    )
)
logger.info("✅ AI Proxy API 路由已注册 (/api/deepseek, /api/gemini, /api/gpt-image, /api/materials/doubao)")

app.include_router(
    create_video_router(
        require_auth_dependency=require_auth,
        get_video_cluster_manager=lambda: video_cluster_manager,
        get_cluster_manager=lambda: cluster_manager,
    )
)
logger.info("✅ Video API 路由已注册 (/api/video/crop)")

app.include_router(
    create_comfyui_files_router(
        require_auth_dependency=require_auth,
        security_dependency=security,
        verify_token=jwt_auth.verify_token,
        get_cluster_manager=lambda: cluster_manager,
        get_video_cluster_manager=lambda: video_cluster_manager,
        get_image_cluster_manager=lambda: image_cluster_manager,
        get_redis_client=lambda: redis_client,
    )
)
logger.info("✅ ComfyUI File API 路由已注册 (/api/comfyui/upload, /api/proxy/comfyui/view, /api/comfyui/upload/video, /api/upload/audio, /api/comfyui/reupload/video)")

app.include_router(
    create_files_router(
        require_auth_dependency=require_auth,
        security_dependency=security,
        verify_token=jwt_auth.verify_token,
        get_db_manager=lambda: db_manager,
    )
)
logger.info("✅ File API 路由已注册 (/api/upload, /api/thumbnail)")

app.include_router(
    create_prompt_router(
        require_auth_dependency=require_auth,
    )
)
logger.info("✅ Prompt API 路由已注册 (/api/prompts)")

app.include_router(
    create_cluster_status_router(
        require_auth_dependency=require_auth,
        get_cluster_manager=lambda: cluster_manager,
        get_workers=lambda: workers,
        get_redis_client=lambda: redis_client,
    )
)
logger.info("✅ Cluster Status API 路由已注册 (/api/cluster/stats, /api/cluster/nodes, /health)")

app.include_router(create_frontend_pages_router())
logger.info("✅ Frontend Pages 路由已注册 (/, /projects, /admin shell)")

app.include_router(
    create_user_session_router(
        require_auth_dependency=require_auth,
        online_users=_online_users,
        logger=logger,
    )
)
logger.info("✅ User Session API 路由已注册 (/api/logout, /api/user/info, /api/me/organizations)")

app.include_router(
    create_workspace_router(
        require_auth_dependency=require_auth,
        jwt_auth_module=jwt_auth,
        project_dao=ProjectDAO,
        workspace_session_dao=WorkspaceSessionDAO,
        logger=logger,
    )
)
logger.info("✅ Workspace API 路由已注册 (/api/workspace)")

app.include_router(
    create_task_router(
        require_auth_dependency=require_auth,
        jwt_auth_module=jwt_auth,
        task_service_module=task_service,
        task_dao=TaskDAO,
        get_db_manager=lambda: db_manager,
        get_pubsub_redis_client=lambda: pubsub_redis_client,
        logger=logger,
    )
)
logger.info("✅ Task API 路由已注册 (/api/generate, /api/task, /api/tasks)")

app.include_router(
    create_generation_router(
        require_auth_dependency=require_auth,
        task_service_module=task_service,
        generate_gemini_images=generate_gemini_images,
        logger=logger,
    )
)
logger.info("✅ Generation API 路由已注册 (/api/generate/*, /api/materials/process)")

# ============================================
# API 路由
# ============================================

# ==================== API 端点 ====================

app.include_router(
    create_projects_router(
        require_auth_dependency=require_auth,
        project_dao=ProjectDAO,
        file_dao=FileDAO,
        version_dao=VersionDAO,
        logger=logger,
    )
)
logger.info("Project API routes registered (/api/projects/*)")

app.include_router(
    create_auth_router(
        verify_credentials=verify_credentials,
        create_session_token=create_session_token,
        get_db_manager=lambda: db_manager,
        logger=logger,
    )
)
logger.info("Auth API routes registered (/api/login)")

app.include_router(
    create_admin_compat_router(
        require_auth=require_auth,
        get_db_manager=lambda: db_manager,
        online_users=_online_users,
        default_users=DEFAULT_USERS,
        super_admin=SUPER_ADMIN,
        logger=logger,
    )
)
logger.info("Admin compatibility API routes registered (/api/admin/stats, /api/admin/logs, /api/admin/users/create)")

# ==================== 管理员API ====================







# ==================== 注册数据库API路由 ====================
# 🆕 在所有旧路由注册完成后，注册数据库API路由（避免路由冲突）
# api_routes 使用 jwt_auth 独立验证令牌，无需共享会话状态

app.include_router(api_router, prefix="", tags=["V2 API - Database"])
logger.info("✅ 数据库API路由已注册")

# 2026-05-26 Slice 1: Media Library 路由
# 详见 docs/superpowers/plans/2026-05-26-feature-rollout/01-media-library.md
app.include_router(media_library_router)
logger.info("✅ Media Library API 路由已注册 (/api/media-library)")

# 2026-05-26 组织管理 MVP Slice 4: 资源共享路由
# 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.3
try:
    from share_routes import router as share_router
    app.include_router(share_router)
    logger.info("✅ Resource Share API 路由已注册 (/api/shares)")
except Exception as e:
    logger.warning(f"⚠️ Resource Share 路由注册失败（不阻塞启动）: {e}")

# 2026-05-26 Slice 2: 积分系统路由
# 详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
app.include_router(credit_router)
logger.info("✅ Credits API 路由已注册 (/api/credits)")

# 2026-05-26 Slice 3: 视频反推提示词路由
# 详见 docs/superpowers/plans/2026-05-26-feature-rollout/03-video-reverse.md
app.include_router(video_reverse_router)
logger.info("✅ Video Reverse API 路由已注册 (/api/video-reverse)")

app.include_router(create_fallback_static_router(deploy_root=Path(__file__).resolve().parent, logger=logger))
logger.info("✅ Fallback Static 路由已注册 (legacy image + final 404 guard)")

# ==================== 主程序入口 ====================

if __name__ == "__main__":
    import uvicorn
    logger.info(f"启动服务器: {SystemConfig.HOST}:{SystemConfig.PORT}")
    uvicorn.run(
        app,
        host=SystemConfig.HOST,
        port=SystemConfig.PORT,
        log_level=SystemConfig.LOG_LEVEL.lower()
    )
