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
import json
import base64
import time
import random
import requests
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field

# ── Pydantic 模型已抽离至 schemas/ 包（规范 §2.3 / §6，MVC增量1）。
#    下列导入同时作为对外 re-export：保持 `from cluster_main import <Model>`
#    与 `cluster_main.<Model>` 的历史引用零破坏（如 tests/test_dashscope_wiring_e2e.py）。
from schemas.auth import LoginRequest
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
from routers.cluster_status import create_cluster_status_router
from routers.comfyui_files import create_comfyui_files_router
from routers.files import cleanup_thumbnail_cache, create_files_router
from routers.frontend_pages import create_frontend_pages_router
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


# 辅助函数：解析JSONB字段
def parse_jsonb_field(value):
    """解析JSONB字段，处理字符串和字典两种情况"""
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            return json.loads(value)
        except:
            return {}
    return value

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

from utils.net_guard import safe_storage_path as _safe_storage_path  # 安全：/storage 路径收敛防遍历
_CM_ROOT = os.path.dirname(os.path.abspath(__file__))


def _storage_path_safe(url: str) -> Path:
    """把 /storage/... 安全解析为磁盘 Path，强制收敛在 persistent_storage 内。
    越界(路径遍历 ../)时返回一个保证不存在的路径，使下游 .exists() 判定为"未找到"，
    既堵 LFI 又不改动原有控制流。"""
    try:
        return Path(_safe_storage_path(url, _CM_ROOT))
    except ValueError:
        logger.warning(f"拒绝越界 /storage 路径: {url!r}")
        return Path(_CM_ROOT) / "persistent_storage" / "__blocked_nonexistent__"


def data_url_to_base64(data_url: str) -> str:
    if not data_url:
        return ""
    if "base64," in data_url:
        return data_url.split("base64,", 1)[1]
    if data_url.startswith('/storage/'):
        file_path = _storage_path_safe(data_url)
        if file_path.exists():
            return base64.b64encode(file_path.read_bytes()).decode('utf-8')
        logger.warning(f"data_url_to_base64: file not found: {file_path}")
        return ""
    if "," in data_url:
        return data_url.split(",", 1)[1]
    return data_url


def to_doubao_image_input(ref: str) -> str:
    """
    将各种来源的图片标识转成豆包 Ark images/generations 接口接受的 image 参数：
      - 已是 data:image/<fmt>;base64,<b64> → 直接返回（仅小写 fmt 校正）
      - /storage/... 路径 → 读文件转 data URL
      - http(s)://... → 直接返回（豆包必须能外网访问该 URL）
      - 其他 → 当作裸 base64，包成 data:image/png;base64,xxx
    """
    if not ref:
        return ""
    if ref.startswith("data:image/"):
        try:
            head, body = ref.split(";base64,", 1)
            fmt = head.split("/", 1)[1].lower()
            if fmt == "jpg":
                fmt = "jpeg"
            return f"data:image/{fmt};base64,{body}"
        except Exception:
            return ref
    if ref.startswith("/storage/"):
        file_path = _storage_path_safe(ref)
        if not file_path.exists():
            logger.warning(f"to_doubao_image_input: file not found: {file_path}")
            return ""
        ext = file_path.suffix.lower().lstrip(".")
        if ext == "jpg":
            ext = "jpeg"
        if ext not in ("jpeg", "png", "webp", "bmp", "tiff", "gif"):
            ext = "png"
        b64 = base64.b64encode(file_path.read_bytes()).decode("utf-8")
        return f"data:image/{ext};base64,{b64}"
    if ref.startswith(("http://", "https://")):
        return ref
    return f"data:image/png;base64,{ref}"


app.include_router(
    create_ai_proxy_router(
        require_auth_dependency=require_auth,
        storage_path_safe=_storage_path_safe,
        to_doubao_image_input=to_doubao_image_input,
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
        storage_path_safe=_storage_path_safe,
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

# ============================================
# API 路由
# ============================================

# ==================== API 端点 ====================

@app.post("/api/login")
async def login(request: LoginRequest):
    """用户登录（支持硬编码用户 + 数据库用户）"""
    is_valid = False

    # 1. 先检查硬编码用户（快速路径）
    if verify_credentials(request.username, request.password):
        is_valid = True
        logger.info(f"用户 {request.username} 通过硬编码验证")

    # 2. 如果硬编码验证失败，尝试数据库验证
    db_user_record: Optional[Dict[str, Any]] = None
    if not is_valid and db_manager:
        try:
            from dao_user import UserDAO
            user = await UserDAO.verify_password(request.username, request.password)
            if user:
                is_valid = True
                db_user_record = user
                logger.info(f"用户 {request.username} 通过数据库验证")
        except Exception as e:
            logger.error(f"数据库验证失败: {e}")

    # 3. 验证失败
    if not is_valid:
        logger.warning(f"用户 {request.username} 登录失败：用户名或密码错误")
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    # 2026-05-26 Slice 4: 管理员禁用的账号不允许登录
    # 详见 docs/superpowers/plans/2026-05-26-feature-rollout/04-admin-users-project-groups.md
    if db_user_record and isinstance(db_user_record, dict):
        u_status = db_user_record.get('status')
        if u_status and u_status != 'active':
            reason = db_user_record.get('disabled_reason') or '账户已被管理员禁用'
            logger.warning(f"用户 {request.username} 登录被拒：{u_status} - {reason}")
            raise HTTPException(status_code=403, detail=f"账户已被禁用：{reason}")

    # 4. 创建会话token
    token = create_session_token(request.username)
    logger.info(f"用户 {request.username} 登录成功")

    # 5. 自动同步用户到数据库（如果数据库可用且用户不存在）
    if db_manager:
        try:
            from dao_user import UserDAO

            logger.info(f"🔍 检查用户 {request.username} 是否存在于数据库...")

            # 检查用户是否已存在
            existing_user = await UserDAO.get_user_by_username(request.username)

            if not existing_user:
                logger.info(f"📝 用户 {request.username} 不存在，开始创建...")
                # 创建数据库用户记录 ⭐ 使用 username 作为 user_id（向后兼容）
                user = await UserDAO.create_user(
                    username=request.username,
                    password=request.password,
                    email=f"{request.username}@local.com",  # 默认邮箱
                    user_id=request.username  # ⭐ 关键：使用 username 作为 user_id
                )
                if user:
                    logger.info(f"✅ 用户 {request.username} 已同步到数据库（ID: {user['user_id']}）")

                    # 🆕 为新用户设置默认权限（所有模型可用）
                    default_permissions = {
                        "allowedModels": [
                            "gemini-2.5-flash",
                            "gemini-2.5-flash-image",
                            "wan2-i2v",
                            "wan2-morph",
                            "wan26-i2v",
                            "sora2-i2v",
                            "veo-i2v",
                            "minimax-i2v"
                        ],
                        "priority": "normal",
                        "canExport": True
                    }
                    await UserDAO.update_user_permissions(request.username, default_permissions)
                    logger.info(f"✅ 已为用户 {request.username} 设置默认权限")
                else:
                    logger.error(f"❌ 创建用户记录失败，返回值为None")
            else:
                logger.info(f"✅ 用户 {request.username} 已存在于数据库（ID: {existing_user['user_id']}）")

                # 🔧 检查是否需要更新权限字段（迁移旧用户）
                user_permissions = existing_user.get('permissions')
                if not user_permissions or not isinstance(user_permissions, dict):
                    logger.info(f"⚠️ 用户 {request.username} 权限字段为空，设置默认权限...")
                    default_permissions = {
                        "allowedModels": [
                            "gemini-2.5-flash",
                            "gemini-2.5-flash-image",
                            "wan2-i2v",
                            "wan2-morph",
                            "wan26-i2v",
                            "sora2-i2v",
                            "veo-i2v",
                            "minimax-i2v"
                        ],
                        "priority": "normal",
                        "canExport": True
                    }
                    await UserDAO.update_user_permissions(request.username, default_permissions)
                    logger.info(f"✅ 已为现有用户 {request.username} 设置默认权限")
        except Exception as e:
            # 数据库同步失败不影响登录，但需要记录详细错误
            logger.error(f"❌ 用户同步到数据库失败: {e}", exc_info=True)
    else:
        logger.warning(f"⚠️ 数据库未连接，跳过用户同步")

    return {
        "success": True,
        "message": "登录成功",
        "token": token,
        "username": request.username
    }

# ⚠️ 已移除旧的 /uploads/{filename} 路由，因为我们使用 app.mount() 挂载静态文件目录
# 这样可以支持多层路径，如 /uploads/image/admin/202512/xxx.png

# ==================== 静态文件路由（必须放在最后） ====================

@app.get("/{filename}")
async def serve_image_files(filename: str, request: Request):
    """提供图片文件 - 此路由必须放在最后"""
    import os

    # 排除 API 路径
    if filename.startswith('api'):
        raise HTTPException(status_code=404, detail="Not Found")

    # 🔧 对于非图片文件，检查是否是React路由，返回index.html
    if not any(filename.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']):
        # React路由：返回index.html让前端路由处理
        index_path = os.path.join(os.path.dirname(__file__), "new_html", "dist", "index.html")
        if os.path.exists(index_path):
            logger.info(f"🔀 React路由: /{filename}, 返回 index.html")
            return FileResponse(index_path, media_type="text/html")
        else:
            raise HTTPException(status_code=404, detail="Not Found")

    # 处理图片文件
    possible_paths = [
        f"/root/{filename}",
        filename,
        f"static/{filename}",
        f"uploads/{filename}",
    ]

    for path in possible_paths:
        if os.path.exists(path):
            logger.info(f"✅ 找到图片: {path}")
            ext = filename.lower().split('.')[-1]
            if ext == 'jpg':
                media_type = "image/jpeg"
            elif ext == 'svg':
                media_type = "image/svg+xml"
            else:
                media_type = f"image/{ext}"
            return FileResponse(path, media_type=media_type)

    logger.warning(f"❌ 图片未找到: {filename}")
    raise HTTPException(status_code=404, detail=f"图片未找到: {filename}")

# ==================== 项目数据管理 API（四阶段数据打通） ====================

async def convert_base64_images_in_project(project_data: dict, username: str) -> dict:
    """将项目中的所有Base64图片转换为数据库文件URL"""

    async def convert_base64_to_url(base64_data: str, context: str = "") -> str:
        """转换单个Base64图片为URL"""
        # 🔧 如果不是Base64数据，直接返回（已经是URL）
        if not base64_data:
            return base64_data

        # 🔧 检查是否已经是持久化的文件URL（避免重复转换）
        if base64_data.startswith('/api/files/'):
            return base64_data

        # 🔧 检查是否是HTTP URL（远程图片）
        if base64_data.startswith('http://') or base64_data.startswith('https://'):
            return base64_data

        # 🔧 只转换Base64数据
        if not base64_data.startswith('data:image'):
            return base64_data

        try:
            # 提取Base64数据
            base64_str = base64_data.split(',')[1] if ',' in base64_data else base64_data
            image_bytes = base64.b64decode(base64_str)

            # 生成文件路径
            file_id = f"file_{uuid.uuid4().hex[:12]}"
            year_month = datetime.now().strftime('%Y%m')
            clean_context = context.replace('/', '_').replace('\\', '_').replace(':', '_')[:30]

            # 保存物理文件
            storage_dir = Path("persistent_storage/images") / username / year_month
            storage_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{file_id}_{clean_context}.webp"
            file_path = storage_dir / filename

            # 转为WebP格式保存
            from image_webp_service import WebPImageService
            webp_bytes = WebPImageService.bytes_to_webp(image_bytes, quality=100)
            if webp_bytes:
                file_path.write_bytes(webp_bytes)
                file_size = len(webp_bytes)
            else:
                # 降级：直接保存原始数据
                file_path.write_bytes(image_bytes)
                file_size = len(image_bytes)

            # 获取或创建默认版本
            projects = await ProjectDAO.get_user_projects(username)
            if not projects:
                project_id = f"proj_{uuid.uuid4().hex[:12]}"
                await ProjectDAO.save_or_update_project(
                    user_id=username,
                    project_id=project_id,
                    project_name="默认项目",
                    project_data={},
                    description="自动创建"
                )
            else:
                project_id = projects[0]['project_id']

            versions = await VersionDAO.get_project_versions(project_id)
            if not versions:
                version = await VersionDAO.create_version(
                    project_id=project_id,
                    user_id=username,
                    version_name="默认版本"
                )
                version_id = version['version_id']
            else:
                version_id = versions[0]['version_id']

            # 创建数据库记录
            file_record = await FileDAO.create_file(
                version_id=version_id,
                user_id=username,
                file_type='image',
                file_name=f"{context}.webp",
                file_path=str(file_path),
                file_url=f"/api/files/{file_id}/download",
                file_size_bytes=file_size,
                mime_type='image/webp',
                metadata={'source': 'base64_convert', 'context': context},
                file_id=file_id  # 🔧 传入预先生成的 file_id
            )

            url = file_record['file_url']
            logger.info(f"✅ Base64图片已转换为数据库URL: {context} -> {url}")
            return url

        except Exception as e:
            logger.error(f"❌ Base64转换失败: {context} - {e}")
            return base64_data  # 失败则保持原样

    # 处理素材库中的图片
    if project_data.get('material_library'):
        for tag_name, materials in project_data['material_library'].items():
            if isinstance(materials, list):
                for idx, material in enumerate(materials):
                    if isinstance(material, dict):
                        # 转换原图 URL
                        if 'url' in material:
                            material['url'] = await convert_base64_to_url(
                                material['url'],
                                f"material_{tag_name}_{idx}_full"
                            )
                        # 转换缩略图 URL
                        if 'thumbnail' in material:
                            material['thumbnail'] = await convert_base64_to_url(
                                material['thumbnail'],
                                f"material_{tag_name}_{idx}_thumb"
                            )

    # 处理生成的图片
    if project_data.get('generated_images'):
        for shot_id, images in project_data['generated_images'].items():
            if isinstance(images, dict) and 'images' in images:
                # 新格式：{images: [...], selectedImageId: ...}
                for idx, img_data in enumerate(images['images']):
                    if isinstance(img_data, dict):
                        # 转换原图 URL
                        if 'url' in img_data:
                            images['images'][idx]['url'] = await convert_base64_to_url(
                                img_data['url'],
                                f"generated_{shot_id}_{idx}_full"
                            )
                        # 转换缩略图 URL
                        if 'thumbnail' in img_data:
                            images['images'][idx]['thumbnail'] = await convert_base64_to_url(
                                img_data['thumbnail'],
                                f"generated_{shot_id}_{idx}_thumb"
                            )
            elif isinstance(images, list):
                # 旧格式：直接是数组
                for idx, img_data in enumerate(images):
                    if isinstance(img_data, dict):
                        # 转换原图 URL
                        if 'url' in img_data:
                            images[idx]['url'] = await convert_base64_to_url(
                                img_data['url'],
                                f"generated_{shot_id}_{idx}_full"
                            )
                        # 转换缩略图 URL
                        if 'thumbnail' in img_data:
                            images[idx]['thumbnail'] = await convert_base64_to_url(
                                img_data['thumbnail'],
                                f"generated_{shot_id}_{idx}_thumb"
                            )
                    elif isinstance(img_data, str):
                        # 直接是URL字符串
                        project_data['generated_images'][shot_id][idx] = await convert_base64_to_url(
                            img_data,
                            f"generated_{shot_id}_{idx}"
                        )

    # 处理分镜中的参考图片
    if project_data.get('storyboard') and project_data['storyboard'].get('items'):
        for item in project_data['storyboard']['items']:
            if 'references' in item and isinstance(item['references'], list):
                for idx, ref in enumerate(item['references']):
                    if isinstance(ref, dict):
                        # 转换原图 URL
                        if 'url' in ref:
                            ref['url'] = await convert_base64_to_url(
                                ref['url'],
                                f"ref_{item.get('id', 'unknown')}_{idx}_full"
                            )
                        # 转换缩略图 URL
                        if 'thumbnail' in ref:
                            ref['thumbnail'] = await convert_base64_to_url(
                                ref['thumbnail'],
                                f"ref_{item.get('id', 'unknown')}_{idx}_thumb"
                            )
            # 处理生成的图片（generatedImages）
            if 'generatedImages' in item and isinstance(item['generatedImages'], list):
                for idx, gen_img in enumerate(item['generatedImages']):
                    if isinstance(gen_img, dict):
                        # 转换原图 URL
                        if 'url' in gen_img:
                            gen_img['url'] = await convert_base64_to_url(
                                gen_img['url'],
                                f"item_{item.get('id', 'unknown')}_gen_{idx}_full"
                            )
                        # 转换缩略图 URL
                        if 'thumbnail' in gen_img:
                            gen_img['thumbnail'] = await convert_base64_to_url(
                                gen_img['thumbnail'],
                                f"item_{item.get('id', 'unknown')}_gen_{idx}_thumb"
                            )
                    elif isinstance(gen_img, str):
                        item['generatedImages'][idx] = await convert_base64_to_url(
                            gen_img,
                            f"item_{item.get('id', 'unknown')}_gen_{idx}"
                        )

    # 处理版本历史中的图片
    if project_data.get('versions') and isinstance(project_data['versions'], list):
        for version_idx, version in enumerate(project_data['versions']):
            if isinstance(version, dict) and 'data' in version:
                version_data = version['data']

                # 递归处理版本数据中的图片（素材库、生成图片、分镜）
                if version_data.get('materialLibrary'):
                    for tag_name, materials in version_data['materialLibrary'].items():
                        if isinstance(materials, list):
                            for idx, material in enumerate(materials):
                                if isinstance(material, dict) and 'url' in material:
                                    material['url'] = await convert_base64_to_url(
                                        material['url'],
                                        f"v{version_idx}_material_{tag_name}_{idx}"
                                    )

                if version_data.get('storyboard') and version_data['storyboard'].get('items'):
                    for item in version_data['storyboard']['items']:
                        if 'references' in item and isinstance(item['references'], list):
                            for idx, ref in enumerate(item['references']):
                                if isinstance(ref, dict) and 'url' in ref:
                                    ref['url'] = await convert_base64_to_url(
                                        ref['url'],
                                        f"v{version_idx}_ref_{item.get('id', 'unknown')}_{idx}"
                                    )
                        if 'generatedImages' in item and isinstance(item['generatedImages'], list):
                            for idx, gen_img in enumerate(item['generatedImages']):
                                if isinstance(gen_img, dict) and 'url' in gen_img:
                                    gen_img['url'] = await convert_base64_to_url(
                                        gen_img['url'],
                                        f"v{version_idx}_gen_{item.get('id', 'unknown')}_{idx}"
                                    )

    return project_data


@app.post("/api/projects/save")
async def save_project(project: ProjectData, username: str = Depends(require_auth)):
    """保存项目数据到数据库（自动将Base64图片转换为持久化URL）"""
    try:
        # username 就是 user_id（系统设计）
        project.user_id = username
        project.updated_at = datetime.now().isoformat()
        if not project.created_at:
            project.created_at = project.updated_at

        # 转换项目数据为字典
        project_dict = project.model_dump()

        # Read existing project data ONCE (not 3 times)
        existing_data = {}
        if project.project_id:
            try:
                db_project = await ProjectDAO.get_project(project.project_id)
                if db_project and db_project.get('settings'):
                    existing_data = parse_jsonb_field(db_project['settings'])
            except Exception as e:
                logger.warning(f"⚠️ 读取现有项目数据失败: {e}")

        if 'video_tasks' not in project_dict or project_dict['video_tasks'] is None:
            existing_video_tasks = existing_data.get('video_tasks')
            if existing_video_tasks and len(existing_video_tasks) > 0:
                project_dict['video_tasks'] = existing_video_tasks
                logger.info(f"🔒 保留现有的 {len(existing_video_tasks)} 个 video_tasks")

        if 'generated_images' not in project_dict or project_dict['generated_images'] is None:
            existing_generated_images = existing_data.get('generated_images')
            if existing_generated_images and len(existing_generated_images) > 0:
                project_dict['generated_images'] = existing_generated_images
                logger.info(f"🔒 保留现有的 {len(existing_generated_images)} 个 generated_images")

        if project_dict.get('generated_images'):
            try:
                existing_generated_images = existing_data.get('generated_images', {})

                recovered_count = 0
                thumbnail_fallback_count = 0

                # 遍历所有镜头的图片
                for shot_id, img_data in project_dict['generated_images'].items():
                    if isinstance(img_data, dict) and 'images' in img_data:
                        existing_shot_data = existing_generated_images.get(shot_id, {})
                        existing_images_list = []
                        if isinstance(existing_shot_data, dict) and 'images' in existing_shot_data:
                            existing_images_list = existing_shot_data['images']
                        elif isinstance(existing_shot_data, list):
                            existing_images_list = existing_shot_data

                        # 处理每张图片
                        for idx, img in enumerate(img_data['images']):
                            if not img.get('url'):
                                # 尝试从数据库恢复URL
                                if idx < len(existing_images_list):
                                    existing_img = existing_images_list[idx]
                                    if existing_img.get('url'):
                                        img['url'] = existing_img['url']
                                        recovered_count += 1
                                        continue

                                # 回退：使用缩略图作为完整图片
                                if img.get('thumbnail'):
                                    img['url'] = img['thumbnail']
                                    thumbnail_fallback_count += 1

                if recovered_count > 0:
                    logger.info(f"✅ 从数据库恢复了 {recovered_count} 张图片的原图URL")
                if thumbnail_fallback_count > 0:
                    logger.info(f"📋 使用缩略图作为完整图片: {thumbnail_fallback_count} 张")

            except Exception as e:
                logger.error(f"❌ 恢复原图URL失败: {e}")

        # 🔍 调试：打印 generated_images 的数据（只打印前3个）
        if project_dict.get('generated_images'):
            for shot_id, img_data in list(project_dict['generated_images'].items())[:3]:
                if isinstance(img_data, dict) and 'images' in img_data:
                    url_count = sum(1 for img in img_data['images'] if img.get('url'))
                    logger.info(f"📦 保存镜头 {shot_id}: {len(img_data['images'])} 张图片, 有URL: {url_count}, 选中: {img_data.get('selectedImageId')}")

        # 将所有Base64图片转换为持久化URL
        project_dict = await convert_base64_images_in_project(project_dict, username)

        # 🔍 调试：转换后再次检查
        if project_dict.get('generated_images'):
            for shot_id, img_data in list(project_dict['generated_images'].items())[:3]:
                if isinstance(img_data, dict) and 'images' in img_data:
                    logger.info(f"💾 转换后镜头 {shot_id}: {len(img_data['images'])} 张图片")

        # 💾 保存到数据库（使用JSONB字段存储完整项目数据）
        result = await ProjectDAO.save_or_update_project(
            user_id=username,
            project_id=project.project_id,
            project_name=project.name,
            project_data=project_dict,
            description=project_dict.get('description', '')
        )

        if result:
            logger.info(f"✅ 保存项目到数据库: {project.name} ({project.project_id})")

        # 🔧 返回转换后的素材库URL，供前端更新本地state
        return {
            "success": True,
            "project_id": project.project_id,
            "message": "项目保存成功",
            "material_library": project_dict.get('material_library', {})  # 返回转换后的URL
        }
    except Exception as e:
        logger.error(f"保存项目失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects/list")
async def list_projects(
    username: str = Depends(require_auth),
    limit: int = 100,
    org_id: Optional[str] = None,
):
    """从数据库获取项目列表。

    org_id=None：旧行为（user_id=me）
    org_id=X：组织 workspace — owner=me 或 项目/分组被 share 给 X
    详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.4
    """
    try:
        if org_id:
            from dao_organization import OrganizationMemberDAO
            if not await OrganizationMemberDAO.is_member(org_id, username):
                raise HTTPException(status_code=403, detail="不是该组织成员")
            db_projects = await ProjectDAO.get_projects_for_org(
                user_id=username, org_id=org_id, include_archived=False,
            )
        else:
            db_projects = await ProjectDAO.get_user_projects(
                user_id=username, include_archived=False,
            )

        projects = []
        for proj in db_projects[:limit]:
            project_data = parse_jsonb_field(proj.get('settings'))
            projects.append({
                "project_id": proj.get("project_id"),
                "name": proj.get("project_name"),
                "stage": project_data.get("stage", 1),
                "created_at": proj.get("created_at").isoformat() if proj.get("created_at") else None,
                "updated_at": proj.get("updated_at").isoformat() if proj.get("updated_at") else None,
                "owner_user_id": proj.get("user_id"),
                "group_id": proj.get("group_id"),
                "visibility": proj.get("visibility"),
            })

        return {"success": True, "projects": projects}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取项目列表失败: {e}", exc_info=True)
        return {"success": False, "projects": []}

@app.get("/api/projects/{project_id}")
async def get_project(
    project_id: str,
    thumbnail_only: bool = True,
    username: str = Depends(require_auth)
):
    """从数据库获取项目详情"""
    try:
        logger.info(f"📂 读取项目: {project_id} (用户: {username}, 缩略图模式: {thumbnail_only})")

        # 从数据库读取项目
        db_project = await ProjectDAO.get_project(project_id)

        if not db_project:
            raise HTTPException(status_code=404, detail="项目不存在")

        # 验证项目所有权
        if db_project.get('user_id') != username:
            raise HTTPException(status_code=403, detail="无权访问此项目")

        # 从settings JSONB字段中获取完整的项目数据
        data = parse_jsonb_field(db_project.get('settings'))

        # 🎯 如果只需要缩略图，精简图片数据
        if thumbnail_only and data.get('generated_images'):
            thumbnail_data = {}
            for shot_id, img_data in data['generated_images'].items():
                if isinstance(img_data, dict) and 'images' in img_data:
                    # 只保留缩略图信息，不包含完整图片URL
                    thumbnail_images = []
                    for img in img_data['images']:
                        # 🔧 如果有缩略图但没有完整URL，标记为有完整图片（实际使用缩略图）
                        has_url = bool(img.get('url')) or bool(img.get('thumbnail'))
                        thumbnail_images.append({
                            'id': img.get('id'),
                            'thumbnail': img.get('thumbnail'),  # 只保留缩略图
                            'timestamp': img.get('timestamp'),
                            'hasFullImage': has_url  # 标记是否有原图
                        })
                    thumbnail_data[shot_id] = {
                        'images': thumbnail_images,
                        'selectedImageId': img_data.get('selectedImageId'),
                        'count': len(thumbnail_images)
                    }
                elif isinstance(img_data, list):
                    # 兼容旧格式
                    thumbnail_images = []
                    for img in img_data:
                        has_url = bool(img.get('url')) or bool(img.get('thumbnail'))
                        thumbnail_images.append({
                            'id': img.get('id'),
                            'thumbnail': img.get('thumbnail'),
                            'timestamp': img.get('timestamp'),
                            'hasFullImage': has_url
                        })
                    thumbnail_data[shot_id] = thumbnail_images

            data['generated_images'] = thumbnail_data
            logger.info(f"✂️ 缩略图模式: 精简了 {len(thumbnail_data)} 个镜头的图片数据")

        # 🔍 调试：打印读取的数据
        logger.info(f"📦 项目数据keys: {list(data.keys())}")
        logger.info(f"📦 项目stage: {data.get('stage')}")

        video_tasks = data.get('video_tasks')
        if video_tasks and isinstance(video_tasks, list) and len(video_tasks) > 0:
            logger.info(f"📦 项目包含 {len(video_tasks)} 个视频任务")
            for task in video_tasks[:3]:
                logger.info(f"   - 镜头: {task.get('storyboard_id')}, 图片: {task.get('image_url', '')[:50]}...")
        else:
            # 新项目没有视频任务是正常的
            logger.debug(f"📝 项目暂无视频任务（新项目或第一阶段）")

        if data.get('generated_images'):
            img_count = len(data['generated_images'])
            logger.info(f"🖼️ 项目包含 {img_count} 个镜头的生成图片")
            for shot_id, img_data in list(data['generated_images'].items())[:3]:
                if isinstance(img_data, dict) and 'images' in img_data:
                    logger.debug(f"   - 镜头 {shot_id}: {len(img_data['images'])} 张图片")

        # 更新项目访问时间
        await ProjectDAO.update_project_access(project_id)

        return {"success": True, "project": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取项目失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, username: str = Depends(require_auth)):
    """从数据库删除项目"""
    try:
        # 验证项目存在且属于当前用户
        db_project = await ProjectDAO.get_project(project_id)

        if not db_project:
            raise HTTPException(status_code=404, detail="项目不存在")

        if db_project.get('user_id') != username:
            raise HTTPException(status_code=403, detail="无权删除此项目")

        # 从数据库删除项目（会级联删除相关版本、文件、文本）
        await ProjectDAO.delete_project(project_id, username)
        logger.info(f"✅ 删除项目: {project_id}")

        return {"success": True, "message": "项目删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除项目失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects/{project_id}/images/{shot_id}")
async def get_shot_images(
    project_id: str,
    shot_id: str,
    username: str = Depends(require_auth)
):
    """获取指定镜头的完整图片数据（按需加载）"""
    try:
        logger.info(f"🖼️ 按需加载镜头图片: 项目={project_id}, 镜头={shot_id}")

        # 从数据库读取项目
        db_project = await ProjectDAO.get_project(project_id)

        if not db_project:
            raise HTTPException(status_code=404, detail="项目不存在")

        # 验证项目所有权
        if db_project.get('user_id') != username:
            raise HTTPException(status_code=403, detail="无权访问此项目")

        # 从settings JSONB字段中获取项目数据
        data = parse_jsonb_field(db_project.get('settings'))

        # 🔧 防御性编程：确保data不为None
        if not data:
            logger.warning(f"⚠️ 项目 {project_id} 的settings为空")
            return {"success": True, "images": []}

        # 提取指定镜头的图片数据
        generated_images = data.get('generated_images')

        # 🔧 防御性编程：确保generated_images不为None
        if not generated_images or not isinstance(generated_images, dict):
            logger.warning(f"⚠️ 项目 {project_id} 的generated_images为空或格式错误")
            return {"success": True, "images": []}

        shot_data = generated_images.get(shot_id)

        if not shot_data:
            return {"success": True, "images": []}

        # 🔧 智能修复：如果只有缩略图没有完整URL，自动补全
        def fix_image_urls(images_list):
            """修复图片数据，确保每张图片都有url字段"""
            fixed_images = []
            for img in images_list:
                if isinstance(img, dict):
                    # 如果有缩略图但没有完整图片URL，使用缩略图作为完整图片
                    if 'thumbnail' in img and not img.get('url'):
                        img['url'] = img['thumbnail']
                        logger.debug(f"🔧 补全缺失的URL: {img.get('id', 'unknown')}")
                    fixed_images.append(img)
                else:
                    fixed_images.append(img)
            return fixed_images

        # 返回完整图片数据
        if isinstance(shot_data, dict) and 'images' in shot_data:
            fixed_images = fix_image_urls(shot_data['images'])
            logger.info(f"✅ 返回镜头 {shot_id} 的 {len(fixed_images)} 张完整图片")
            return {
                "success": True,
                "images": fixed_images,
                "selectedImageId": shot_data.get('selectedImageId')
            }
        elif isinstance(shot_data, list):
            # 兼容旧格式
            fixed_images = fix_image_urls(shot_data)
            logger.info(f"✅ 返回镜头 {shot_id} 的 {len(fixed_images)} 张完整图片（旧格式）")
            return {
                "success": True,
                "images": fixed_images
            }

        return {"success": True, "images": []}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取镜头图片失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/projects/{project_id}/export-to-video")
async def export_to_video(
    project_id: str,
    request: ExportToVideoRequest,
    username: str = Depends(require_auth)
):
    """第三阶段 -> 第四阶段数据传递"""
    try:
        # 从数据库读取项目
        db_project = await ProjectDAO.get_project(project_id)

        if not db_project:
            raise HTTPException(status_code=404, detail="项目不存在")

        if db_project.get('user_id') != username:
            raise HTTPException(status_code=403, detail="无权访问此项目")

        # 获取或创建导出版本
        versions = await VersionDAO.get_project_versions(project_id)
        if versions:
            export_version = versions[0]  # 使用最新版本
            version_id = export_version['version_id']
            logger.info(f"📦 使用现有版本: {version_id}")
        else:
            # 创建新版本
            export_version = await VersionDAO.create_version(
                project_id=project_id,
                user_id=username,
                version_name="导出版本",
                description="画面分镜导出到视频生成"
            )
            version_id = export_version['version_id']
            logger.info(f"📦 创建新版本: {version_id}")

        # 从settings JSONB字段中获取完整的项目数据
        data = parse_jsonb_field(db_project.get('settings'))

        # 提取选中分镜的生成结果
        storyboard = data.get("storyboard", {})
        items = storyboard.get("items", [])
        generated_images_data = data.get("generated_images", {})  # 🔧 从正确的位置读取

        logger.info(f"📦 导出数据检查: storyboard有 {len(items)} 个镜头, generated_images有 {len(generated_images_data)} 个条目")

        video_tasks = []
        for item in items:
            if item.get("id") in request.selected_items:
                item_id = item.get("id")

                # 🔧 从 generated_images 对象中获取该镜头的图片数据
                shot_images_data = generated_images_data.get(item_id, {})
                generated_images = shot_images_data.get("images", [])
                selected_image_id = shot_images_data.get("selectedImageId")

                logger.info(f"📸 镜头 {item_id}: {len(generated_images)} 张图片, 选中ID: {selected_image_id}")

                # 找到选中的图片
                image_url = ""
                selected_img = None
                if selected_image_id and generated_images:
                    selected_img = next((img for img in generated_images if img.get("id") == selected_image_id), None)
                    if selected_img:
                        # 🔧 优先使用 url，如果没有则使用 thumbnail
                        image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
                        if image_url:
                            logger.info(f"✅ 找到选中图片: {image_url[:50]}...")
                        else:
                            logger.warning(f"⚠️ 选中的图片没有 url 或 thumbnail")

                # 如果没找到，使用第一张图片
                if not selected_img and generated_images:
                    selected_img = generated_images[0]
                    # 🔧 优先使用 url，如果没有则使用 thumbnail
                    image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
                    if image_url:
                        logger.info(f"⚠️ 未找到选中图片，使用第一张: {image_url[:50]}...")
                    else:
                        logger.warning(f"⚠️ 第一张图片也没有 url 或 thumbnail")

                # 🔧 处理图片URL（如果有的话）
                if image_url and image_url.startswith('data:image'):
                    logger.info(f"🔄 检测到Base64图片，开始转换: {image_url[:50]}...")
                    try:
                        # 提取Base64数据
                        base64_data = image_url.split(',')[1] if ',' in image_url else image_url
                        image_bytes = base64.b64decode(base64_data)
                        logger.info(f"📊 Base64解码成功，大小: {len(image_bytes)} bytes")

                        # 生成文件名和路径
                        file_ext = '.png'
                        timestamp = int(time.time())
                        filename = f"exported_{item['id']}_{timestamp}{file_ext}"
                        year_month = datetime.now().strftime('%Y%m')

                        # 生成 file_id
                        file_id = f"file_{uuid.uuid4().hex[:12]}"

                        # ✅ 保存到持久化存储（供FileDAO使用）
                        storage_dir = Path("persistent_storage/images") / username / year_month
                        storage_dir.mkdir(parents=True, exist_ok=True)
                        final_file = storage_dir / filename
                        final_file.write_bytes(image_bytes)

                        file_size = len(image_bytes)

                        # ✅ 创建数据库文件记录
                        file_record = await FileDAO.create_file(
                            version_id=version_id,
                            user_id=username,
                            file_type='image',
                            file_name=f"{item.get('scene', 'shot')}_{item['id']}.png",
                            file_path=str(final_file),
                            file_url=f"/api/files/{file_id}/download",  # 🔧 使用正确的 file_id
                            file_size_bytes=file_size,
                            mime_type='image/png',
                            metadata={
                                'source': 'export_to_video',
                                'storyboard_id': item['id'],
                                'scene': item.get('scene', ''),
                                'shot_number': item.get('shotNumber', '')
                            },
                            file_id=file_id  # 🔧 传入 file_id
                        )
                        # 使用数据库文件ID作为URL
                        image_url = f"/api/files/{file_record['file_id']}/download"
                        logger.info(f"✅ Base64图片已保存到数据库, 文件ID: {file_record['file_id']}")

                    except Exception as e:
                        logger.error(f"❌ Base64转换失败: {e}", exc_info=True)
                        # 继续使用原始Base64（作为fallback）
                        logger.warning(f"⚠️ 使用Base64作为fallback")
                elif image_url:
                    logger.info(f"✅ 图片已是URL格式: {image_url[:100]}")
                else:
                    logger.warning(f"⚠️ 镜头 {item_id} 没有图片")

                # 🔍 调试：打印镜头的详细信息
                logger.info(f"📝 镜头 {item_id} 详细信息:")
                logger.info(f"   - image_url: {image_url[:50] if image_url else '(无)'}...")
                logger.info(f"   - videoPrompt: {item.get('videoPrompt', '(无)')[:50] if item.get('videoPrompt') else '(无)'}...")
                logger.info(f"   - dialogue: {item.get('dialogue', '(无)')[:30] if item.get('dialogue') else '(无)'}...")
                logger.info(f"   - characters: {item.get('characters', [])}")
                logger.info(f"   - scene: {item.get('scene', '(无)')}")

                # 🔧 无论是否有图片都添加到video_tasks（至少导出提示词）
                video_tasks.append({
                    "storyboard_id": item["id"],
                "image_url": image_url or "",  # 可能为空
                    "video_prompt": item.get("videoPrompt", ""),
                    "dialogue": item.get("dialogue", ""),
                    "characters": item.get("characters", []),
                    "scene": item.get("scene", "")
                })
                logger.info(f"✅ 已添加镜头 {item_id} 到导出列表")

        # 更新项目数据
        data["video_tasks"] = video_tasks
        data["stage"] = 4
        data["updated_at"] = datetime.now().isoformat()

        # 保存到数据库
        await ProjectDAO.save_or_update_project(
            user_id=username,
            project_id=project_id,
            project_name=db_project.get('project_name', 'Untitled'),
            project_data=data,
            description=db_project.get('description', '')
        )

        logger.info(f"✅ 导出 {len(video_tasks)} 个分镜到视频生成（已保存到数据库）")

        return {
            "success": True,
            "exported_count": len(video_tasks),
            "video_tasks": video_tasks
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects/{project_id}/clear-video-tasks")
async def clear_video_tasks(
    project_id: str,
    username: str = Depends(require_auth)
):
    """清除项目中的video_tasks，避免重复导入"""
    try:
        # 从数据库读取项目
        db_project = await ProjectDAO.get_project(project_id)

        if not db_project:
            raise HTTPException(status_code=404, detail="项目不存在")

        if db_project.get('user_id') != username:
            raise HTTPException(status_code=403, detail="无权访问此项目")

        # 从settings JSONB字段中获取完整的项目数据
        data = parse_jsonb_field(db_project.get('settings'))

        # 清除video_tasks
        if 'video_tasks' in data:
            cleared_count = len(data['video_tasks'])
            data['video_tasks'] = []

            # 保存到数据库
            await ProjectDAO.save_or_update_project(
                user_id=username,
                project_id=project_id,
                project_name=db_project.get('project_name', 'Untitled'),
                project_data=data,
                description=db_project.get('description', '')
            )

            logger.info(f"✅ 已清除项目 {project_id} 的 {cleared_count} 个video_tasks（已保存到数据库）")

            return {
                "success": True,
                "cleared_count": cleared_count
            }

        return {
            "success": True,
            "cleared_count": 0
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"清除video_tasks失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== 图像生成 API（支持Gemini和ComfyUI双引擎） ====================


@app.post("/api/generate/image")
async def generate_image(
    request: ImageGenerationRequest,
    username: str = Depends(require_auth)
):
    """
    图像生成接口（双引擎）
    - engine="gemini": 调用Gemini API生成
    - engine="comfyui": 调用ComfyUI I2I_FJ工作流
    """
    try:
        if request.engine == "gemini":
            # Gemini引擎 - 保留原有逻辑，由前端直接调用
            return {
                "success": False,
                "message": "Gemini引擎请在前端直接调用，无需通过后端"
            }

        elif request.engine == "comfyui":
            # ComfyUI引擎 - 使用I2I_FJ工作流
            if not request.ref_images:
                raise HTTPException(status_code=400, detail="ComfyUI引擎至少需要1张参考图")

            task_data = {
                "image": request.ref_images[0],
                "ref_images": request.ref_images[1:6],
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt or "bad quality, worst quality",
                "seed": request.seed,
                "strength": request.strength
            }
            if request.entity_type:
                task_data['entity_type'] = request.entity_type
            if request.entity_id:
                task_data['entity_id'] = request.entity_id
            if request.file_role:
                task_data['file_role'] = request.file_role
            if request.episode_id:
                task_data['episode_id'] = request.episode_id
            task_id = await task_service.get().submit("i2i_fj", task_data, username)
            logger.info(f"✅ 创建I2I图像生成任务: {task_id}")

            return {
                "success": True,
                "task_id": task_id,
                "engine": "comfyui",
                "message": "图像生成任务已提交"
            }

        else:
            raise HTTPException(status_code=400, detail=f"不支持的引擎: {request.engine}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"图像生成失败: {e}")
        # 🔒 不暴露技术细节
        raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")


@app.post("/api/generate/comfyui-workflow")
async def generate_comfyui_workflow(
    request: ComfyUIWorkflowRequest,
    username: str = Depends(require_auth)
):
    """
    使用指定ComfyUI工作流生成图像
    - workflow_type="qwen": 使用Qwen工作流
    - workflow_type="qwen_lora": 使用Qwen LoRA工作流
    - workflow_type="kontext": 使用Kontext工作流
    前端需先调用 /api/comfyui/upload 批量上传图片获取filenames
    """
    try:
        if request.workflow_type not in ['qwen', 'qwen_lora', 'kontext', 'qwenN', 'qwenN_lora']:
            raise HTTPException(status_code=400, detail=f"不支持的工作流类型: {request.workflow_type}")

        # 对于Qwen、Qwen_lora、qwenN、qwenN_lora工作流，根据图片数量选择对应的工作流
        actual_workflow_type = request.workflow_type
        if request.workflow_type in ['qwen', 'qwen_lora', 'qwenN', 'qwenN_lora']:
            total_images = len(request.image_filenames)
            total_images = max(1, min(6, total_images))
            actual_workflow_type = f'{request.workflow_type}_{total_images}'

            logger.info(f"📊 {request.workflow_type}工作流: 共{total_images}张参考图，使用 {actual_workflow_type}")

        task_data = {
            "prompt": request.prompt,
            "seed": request.seed
        }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id

        if request.workflow_type in ['qwen', 'qwen_lora', 'qwenN', 'qwenN_lora']:
            for i, filename in enumerate(request.image_filenames[:6], 1):
                task_data[f"image_path_{i}"] = filename
        else:
            if len(request.image_filenames) > 0:
                task_data["image_path"] = request.image_filenames[0]
            task_data["negative_prompt"] = request.negative_prompt

        task_id = await task_service.get().submit(actual_workflow_type, task_data, username)
        logger.info(f"✅ 创建{actual_workflow_type}工作流任务: {task_id}")

        return {
            "success": True,
            "task_id": task_id,
            "workflow_type": actual_workflow_type,
            "message": f"{request.workflow_type}工作流任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"{request.workflow_type}工作流生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/angle-adjust")
async def adjust_image_angle(
    request: AngleAdjustRequest,
    username: str = Depends(require_auth)
):
    """
    图像角度调整接口（使用i2i_fj工作流）
    专门用于素材绑定和画面分镜页的角度调整功能
    前端需先调用 /api/comfyui/upload 上传图片获取filename
    """
    try:
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit("i2i_fj", task_data, username)
        logger.info(f"✅ 创建角度调整任务: {task_id} (图片: {request.image_filename})")

        return {
            "success": True,
            "task_id": task_id,
            "message": "角度调整任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"角度调整失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/human-multi-angle")
async def generate_human_multi_angle(
    request: HumanMultiAngleRequest,
    username: str = Depends(require_auth)
):
    """
    多角度人物生成接口（使用I2I_HUMAN工作流）
    基于单张图片生成多角度人物图
    前端需先调用 /api/comfyui/upload 上传图片获取filename
    """
    try:
        task_data = {
            "image_path": request.image_filename,
            "seed": request.seed
        }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit("i2i_human", task_data, username)
        logger.info(f"✅ 创建多角度人物生成任务: {task_id} (图片: {request.image_filename})")

        return {
            "success": True,
            "task_id": task_id,
            "message": "多角度人物生成任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"多角度人物生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/around-angle")
async def generate_around_angle(
    request: AroundAngleRequest,
    username: str = Depends(require_auth)
):
    """
    全景角度生成接口（使用I2I_Around工作流）
    基于单张图片和角度描述生成对应视角的图像
    前端需先调用 /api/comfyui/upload 上传图片获取filename
    """
    try:
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit("i2i_around", task_data, username)
        logger.info(f"✅ 创建全景角度生成任务: {task_id} (图片: {request.image_filename}, 提示词: {request.prompt[:50]}...)")

        return {
            "success": True,
            "task_id": task_id,
            "message": "全景角度生成任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"全景角度生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== 抠图 API ====================


@app.post("/api/generate/matting")
async def generate_matting(
    request: MattingRequest,
    username: str = Depends(require_auth)
):
    """
    抠图接口（主体脱离/主体背景分离）
    前端需先调用 /api/comfyui/upload 上传图片获取filename
    """
    try:
        if request.matting_type not in ['subject', 'split']:
            raise HTTPException(status_code=400, detail=f"不支持的抠图类型: {request.matting_type}")

        task_type = f"matting_{request.matting_type}"

        task_data = {
            "image_path": request.image_filename,
            "seed": request.seed
        }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit(task_type, task_data, username)
        logger.info(f"✅ 创建抠图任务: {task_id} (类型: {task_type}, 图片: {request.image_filename})")

        return {
            "success": True,
            "task_id": task_id,
            "message": f"抠图任务({request.matting_type})已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"抠图失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== 融合 API ====================


@app.post("/api/generate/image-fusion")
async def generate_image_fusion(
    request: ImageFusionRequest,
    username: str = Depends(require_auth)
):
    """
    图像融合接口（图像融合/迁移学习/模仿学习）
    前端需先调用 /api/comfyui/upload 上传图片获取filename
    """
    try:
        valid_types = ['fusion', 'transfer', 'imitation']
        if request.fusion_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"不支持的融合类型: {request.fusion_type}")

        # 迁移学习需要蒙版图
        if request.fusion_type == 'transfer' and not request.image_mb:
            raise HTTPException(status_code=400, detail="迁移学习需要提供蒙版图(image_mb)")

        workflow_map = {
            'fusion': 'image_fusion',
            'transfer': 'image_transfer',
            'imitation': 'pose_imitation'
        }
        task_type = workflow_map[request.fusion_type]

        task_data = {
            "image_BK": request.image_bk,
            "image_HU": request.image_hu,
            "seed": request.seed
        }

        if request.fusion_type == 'transfer':
            task_data["image_MB"] = request.image_mb
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id

        task_id = await task_service.get().submit(task_type, task_data, username)
        logger.info(f"✅ 创建融合任务: {task_id} (类型: {task_type})")

        return {
            "success": True,
            "task_id": task_id,
            "message": f"融合任务({request.fusion_type})已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"融合失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== 分镜弹窗 API ====================


@app.post("/api/generate/panorama-360")
async def generate_panorama_360(
    request: Panorama360Request,
    username: str = Depends(require_auth)
):
    """
    360度全景生成接口
    基于场景素材生成360度全景照片
    """
    try:
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit("panorama_360", task_data, username)
        logger.info(f"✅ 创建360度全景生成任务: {task_id}")

        return {
            "success": True,
            "task_id": task_id,
            "message": "360度全景生成任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"360度全景生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/panorama-fusion")
async def generate_panorama_fusion(
    request: PanoramaFusionRequest,
    username: str = Depends(require_auth)
):
    """
    全景场景融合接口
    根据输入图片数量自动选择panorama_fusion_1~3工作流
    """
    try:
        # 根据输入图片数量选择工作流
        if request.image_2:
            # 有2张人物图 + 1张背景 = 3张输入
            task_type = "panorama_fusion_3"
            task_data = {
                "image_1": request.image_1,
                "image_2": request.image_2,
                "image_3": request.image_3,
                "prompt": request.prompt,
                "seed": request.seed
            }
        else:
            # 1张人物/场景 + 1张背景 = 使用panorama_fusion_1
            task_type = "panorama_fusion_1"
            task_data = {
                "image_1": request.image_1,
                "image_3": request.image_3,
                "prompt": request.prompt,
                "seed": request.seed
            }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id

        task_id = await task_service.get().submit(task_type, task_data, username)
        logger.info(f"✅ 创建全景融合任务: {task_id} (工作流: {task_type})")

        return {
            "success": True,
            "task_id": task_id,
            "workflow_type": task_type,
            "message": "全景融合任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"全景融合失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/auto-storyboard")
async def generate_auto_storyboard(
    request: AutoStoryboardRequest,
    username: str = Depends(require_auth)
):
    """
    自动分镜生成接口
    基于图像和提示词生成分镜结果
    """
    try:
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit("auto_storyboard", task_data, username)
        logger.info(f"✅ 创建自动分镜任务: {task_id}")

        return {
            "success": True,
            "task_id": task_id,
            "message": "自动分镜任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"自动分镜失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/multi-grid-storyboard")
async def generate_multi_grid_storyboard(
    request: MultiGridStoryboardRequest,
    username: str = Depends(require_auth)
):
    """
    多宫格分镜生成接口
    使用化神（Gemini）图像生成API，和分镜页面的化神模型一样
    需要传入：提示词 + 一张参考图像
    - multi_shot: 多镜头分镜，拼合 "{用户输入}+AI+分镜"
    - story: 故事分镜，拼合 "{用户输入}+AI+分镜1"
    """
    import base64

    try:
        if request.mode not in ['multi_shot', 'story']:
            raise HTTPException(status_code=400, detail=f"不支持的模式: {request.mode}")

        if not request.reference_image:
            raise HTTPException(status_code=400, detail="必须传入一张参考图像")

        # 根据模式拼合提示词（用户可在后端修改这里）
        if request.mode == 'multi_shot':
            full_prompt = f"{request.user_prompt}+AI+分镜"
        else:
            full_prompt = f"{request.user_prompt}+AI+分镜1"

        logger.info(f"📷 多宫格分镜请求 - 模式: {request.mode}, 提示词: {full_prompt[:50]}...")

        # 复用和 /api/gemini/image 一样的Gemini图像生成逻辑
        parts = []

        # 添加参考图片（支持 data: 和 /storage/ 路径）
        ref = request.reference_image
        if ref.startswith('data:'):
            mime_type = ref.split(';')[0].split(':')[1]
            b64_data = ref.split(',')[1] if ',' in ref else ref
            parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
        elif ref.startswith('/storage/'):
            file_path = _storage_path_safe(ref)
            if file_path.exists():
                img_bytes = file_path.read_bytes()
                ext = file_path.suffix.lower()
                mime_map = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                            '.webp': 'image/webp', '.gif': 'image/gif'}
                mime_type = mime_map.get(ext, 'image/png')
                b64_data = base64.b64encode(img_bytes).decode('utf-8')
                parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
            else:
                logger.warning(f"⚠️ 多宫格参考图不存在: {file_path}")

        # 增强提示词
        enhanced_prompt = f"请严格参考上面提供的参考图片，{full_prompt}\n\n重要提示：请紧密遵循参考图的画风、构图、角色设计、色彩风格和视觉元素。在保持与参考图一致性的同时，融入描述中的变化。确保生成的图像在视觉风格上与参考图高度相似。"
        parts.append({"text": enhanced_prompt})

        # 2026-05-21：化神升级到 nano2（gemini-3.1-flash-image-preview）
        images, model = await generate_gemini_images(
            parts=parts,
            requested_model="gemini-3.1-flash-image-preview",
            aspect_ratio="16:9",
        )

        logger.info(f"✅ 多宫格分镜生成成功 (模式: {request.mode})，图片数量: {len(images)}")

        from file_service import save_generated_file_to_db
        import base64 as b64mod

        files_result = []
        for img_data_url in images:
            try:
                b64_data = img_data_url.split(',')[1] if ',' in img_data_url else img_data_url
                img_content = b64mod.b64decode(b64_data)
                saved = await save_generated_file_to_db(
                    content=img_content,
                    file_type='image',
                    user_id=username,
                    source='gemini',
                    entity_type=request.entity_type,
                    entity_id=request.entity_id,
                    file_role=request.file_role or 'storyboard',
                    original_ext='.png',
                    episode_id=request.episode_id,
                    extra_metadata={'prompt': full_prompt[:500], 'model': model, 'feature': 'gemini-multi-grid'},
                )
                # 2026-05-26 Slice 1: 同步进通用素材库（best-effort）
                try:
                    import media_library_service
                    from dao_content import FileDAO as _FileDAO
                    _file_record = await _FileDAO.get_file(saved['file_id']) if saved.get('file_id') else None
                    if _file_record:
                        await media_library_service.create_from_file(
                            file_record=_file_record,
                            source='generated_storyboard_gemini',
                            episode_id=request.episode_id,
                            source_entity_type=request.entity_type,
                            source_entity_id=request.entity_id,
                            title=full_prompt[:80] or None,
                            metadata={'prompt': full_prompt[:500], 'model': model, 'feature': 'gemini-multi-grid'},
                        )
                except Exception as _e:
                    logger.warning(f"media_library 同步失败 (storyboard): {_e}")
                files_result.append({
                    'data_url': img_data_url,
                    'file_id': saved['file_id'],
                    'file_url': saved['file_url'],
                })
            except Exception as e:
                logger.warning(f"保存图片到 files 表失败: {e}")
                files_result.append({'data_url': img_data_url, 'file_id': None, 'file_url': None})

        return {
            "success": True,
            "mode": request.mode,
            "prompt": full_prompt,
            "images": images,
            "files": files_result,
            "message": f"多宫格分镜({request.mode})生成成功"
        }

    except HTTPException:
        raise
    except AIProxyError as e:
        logger.error("多宫格分镜 Gemini 生成失败: %s | upstream: %s", e, e.upstream)
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception as e:
        logger.error(f"多宫格分镜生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))





@app.post("/api/materials/process")
async def process_material(
    request: MaterialProcessRequest,
    username: str = Depends(require_auth)
):
    """
    素材处理接口（高清放大、去水印、三视图）
    前端需先调用 /api/comfyui/upload 上传图片获取filename
    """
    try:
        if request.workflow_type not in ['upscale_hd', 'remove_watermark', 'three_view']:
            raise HTTPException(status_code=400, detail=f"不支持的工作流类型: {request.workflow_type}")

        if request.workflow_type == 'upscale_hd':
            seed = random.randint(100000, 999999)
            seed_key = 'seed_0'
        else:
            seed = random.randint(100000000000000, 999999999999999)
            seed_key = 'seed'

        task_data = {"image_path": request.image_filename, seed_key: seed}
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit(
            request.workflow_type, task_data, username, prepare=False
        )

        workflow_names = {
            'upscale_hd': '高清放大',
            'remove_watermark': '去水印',
            'three_view': '三视图'
        }

        logger.info(f"✅ 创建{workflow_names[request.workflow_type]}任务: {task_id} (图片: {request.image_filename})")

        return {
            "success": True,
            "task_id": task_id,
            "message": f"{workflow_names[request.workflow_type]}任务已提交"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"素材处理失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
# ==================== 管理员API ====================

# Legacy implementation kept for reference only. The live route is provided by admin_routes.py.
async def get_admin_users(username: str = Depends(require_auth)):
    """获取用户列表（仅管理员）"""
    # 🔐 权限检查：只有admin和超级管理员可以访问
    if username not in ['admin', SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

    try:
        users_list = []

        # 🔧 如果数据库可用，从数据库获取用户
        if db_manager:
            try:
                from dao_user import UserDAO
                # 确保permissions字段存在
                try:
                    await db_manager.execute("""
                        ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb
                    """)
                except Exception:
                    pass  # 字段可能已存在

                db_users = await db_manager.fetch(
                    """
                    SELECT user_id, username, email, created_at, last_login_at, is_active, permissions
                    FROM users
                    WHERE is_active = TRUE
                    ORDER BY created_at DESC
                    """
                )

                for user in db_users:
                    # 🆕 获取用户总生成次数（从tasks表统计所有已完成任务）
                    total_count = await db_manager.fetchval(
                        "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'completed'",
                        user['user_id']
                    ) or 0

                    # 🆕 获取用户今日生成次数
                    today_count = await db_manager.fetchval(
                        """
                        SELECT COUNT(*) FROM tasks
                        WHERE user_id = $1
                        AND status = 'completed'
                        AND DATE(completed_at) = CURRENT_DATE
                        """,
                        user['user_id']
                    ) or 0

                    logger.info(f"📊 用户 {user['username']} 统计: 今日={today_count}, 总计={total_count}")

                    # 🆕 按模型统计
                    model_stats = await db_manager.fetch(
                        """
                        SELECT task_type, COUNT(*) as count
                        FROM tasks
                        WHERE user_id = $1 AND status = 'completed'
                        GROUP BY task_type
                        ORDER BY count DESC
                        LIMIT 10
                        """,
                        user['user_id']
                    )
                    by_model = {}
                    for stat in model_stats:
                        task_type = stat['task_type']
                        model_name = task_type.replace('_', '-')
                        by_model[model_name] = stat['count']

                    # 🔐 权限过滤：admin看不到超级管理员
                    if username == 'admin' and user['username'] == SUPER_ADMIN:
                        continue  # 跳过超级管理员

                    # 获取用户权限（从数据库读取，如果没有则使用默认）
                    user_permissions = user.get('permissions')
                    if isinstance(user_permissions, str):
                        try:
                            import json
                            user_permissions = json.loads(user_permissions)
                        except:
                            user_permissions = None

                    # 如果数据库没有权限配置，使用默认权限
                    if not user_permissions or not user_permissions.get('allowedModels'):
                        if user['username'] == 'admin':
                            user_permissions = {
                                'allowedModels': [
                                    'gemini-2.5-flash', 'deepseek-reasoner',
                                    'gemini-2.5-flash-image', 'doubao-image', 'qwen', 'qwen-lora', 'kontext',
                                    'wan2-i2v', 'wan2-morph', 'sora2-i2v', 'sora2-morph', 'veo-i2v', 'veo-morph',
                                    'upscale-hd', 'remove-watermark', 'three-view'
                                ],
                                'priority': 'high',
                                'canExport': True
                            }
                        else:
                            # 普通用户默认权限
                            user_permissions = {
                                'allowedModels': [
                                    'gemini-2.5-flash', 'gemini-2.5-flash-image',
                                    'wan2-i2v', 'wan2-morph'
                                ],
                                'priority': 'normal',
                                'canExport': True
                            }

                    users_list.append({
                        'id': user['user_id'],
                        'username': user['username'],
                        'email': user['email'] or f"{user['username']}@studio.com",
                        'role': 'admin' if user['username'] == 'admin' else 'editor',
                        'isActive': user['is_active'],
                        'isOnline': user['username'] in _online_users and (datetime.now() - _online_users[user['username']]).seconds < 1800,
                        'lastLogin': int(user['last_login_at'].timestamp() * 1000) if user['last_login_at'] else 0,
                        'permissions': user_permissions,
                        'stats': {
                            'todayCount': today_count,
                            'totalCount': total_count,
                            'byModel': by_model
                        }
                    })

                logger.info(f"✅ 从数据库获取到 {len(users_list)} 个用户")
                if users_list:
                    logger.info(f"📋 示例用户数据: {users_list[0]['username']}, 今日={users_list[0]['stats']['todayCount']}, 总计={users_list[0]['stats']['totalCount']}")

            except Exception as e:
                logger.error(f"❌ 从数据库获取用户失败: {e}", exc_info=True)
                # 降级到内存session

        # 降级：从内存session获取用户
        if not users_list:
            logger.warning("⚠️ 数据库用户列表为空，使用在线用户降级数据")
            session_usernames = list(_online_users.keys())
            for uname in session_usernames:
                # 🔐 权限过滤：admin看不到超级管理员
                if username == 'admin' and uname == SUPER_ADMIN:
                    continue
                # 根据用户名设置权限
                if uname == 'admin':
                    allowed_models = [
                        'gemini-2.5-flash', 'deepseek-reasoner',
                        'gemini-2.5-flash-image', 'doubao-image', 'qwen', 'qwen-lora', 'kontext',
                        'wan2-i2v', 'wan2-morph', 'sora2-i2v', 'sora2-morph', 'veo-i2v', 'veo-morph',
                        'upscale-hd', 'remove-watermark', 'three-view'
                    ]
                    priority = 'high'
                else:
                    allowed_models = [
                        'gemini-2.5-flash', 'gemini-2.5-flash-image',
                        'wan2-i2v', 'wan2-morph'
                    ]
                    priority = 'normal'

                users_list.append({
                    'id': uname,
                    'username': uname,
                    'email': f'{uname}@studio.com',
                    'role': 'admin' if uname == 'admin' else 'editor',
                    'isActive': True,
                    'isOnline': True,
                    'lastLogin': int(time.time() * 1000),
                    'permissions': {
                        'allowedModels': allowed_models,
                        'priority': priority,
                        'canExport': True
                    },
                    'stats': {
                        'todayCount': 0,
                        'totalCount': 0,
                        'byModel': {}
                    }
                })

        return {
            "success": True,
            "users": users_list
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取用户列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/admin/stats")
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

@app.get("/api/admin/logs")
async def get_admin_logs(username: str = Depends(require_auth), limit: int = 100):
    """获取生成日志（仅管理员）"""
    # 🔐 权限检查：允许admin和超级管理员访问
    if username not in ['admin', SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

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

@app.post("/api/admin/users/create")
async def create_user(
    user_data: dict,
    request: Request,
    username: str = Depends(require_auth)
):
    """创建新用户（仅管理员）"""
    # 🔐 权限检查
    if username not in ['admin', SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

    try:
        new_username = user_data.get('username')
        password = user_data.get('password')
        email = user_data.get('email') or f"{new_username}@studio.com"
        role = user_data.get('role', 'editor')

        if not new_username or not password:
            raise HTTPException(status_code=400, detail="用户名和密码为必填项")

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

# Legacy implementation kept for reference only. The live route is provided by admin_routes.py.
async def update_user_permissions(
    user_id: str,
    permissions: dict,
    username: str = Depends(require_auth)
):
    """更新用户权限（仅管理员）"""
    # 🔐 权限检查：允许admin和超级管理员访问
    if username not in ['admin', SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

    try:
        from dao_user import UserDAO

        logger.info(f"管理员 {username} 更新用户 {user_id} 的权限: {permissions}")

        # 更新用户权限到数据库
        success = await UserDAO.update_user_permissions(user_id, permissions)

        if success:
            logger.info(f"✅ 用户 {user_id} 权限更新成功")
            return {
                "success": True,
                "message": "权限更新成功"
            }
        else:
            logger.warning(f"⚠️ 用户 {user_id} 权限更新失败：用户不存在")
            raise HTTPException(status_code=404, detail="用户不存在")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新用户权限失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/admin/users/{user_id}")
async def delete_user(
    user_id: str,
    username: str = Depends(require_auth)
):
    """删除用户（仅管理员）"""
    # 🔐 权限检查：只有admin和超级管理员可以删除用户
    if username not in ['admin', SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

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


# ============================================
# 🛡️ 安全：捕获所有未定义路由（必须放在最后）
#  - 注意：旧版 `@app.get("/admin")` 显式路由已删除（2026-05-26）
#    — 原本被 line 533 `app.mount("/admin", StaticFiles)` 拦截，是死代码
#  - 新版 React Admin Shell 走上方的 admin_spa_root / admin_spa_named / admin_spa_subpath
# ============================================

@app.get("/{path:path}")
async def catch_scanner_requests(path: str):
    """
    捕获常见的扫描器和恶意请求，静默返回404避免日志污染
    此路由必须放在所有其他路由之后
    """
    # 常见的扫描器/攻击路径模式
    scanner_patterns = [
        'wp-admin', 'wp-login', 'wp-content', 'wordpress', 'wp-includes',
        'phpmyadmin', 'phpMyAdmin', 'pma', 'mysql',
        'administrator', 'login.asp', 'login.php', 'admin.php',
        'setup-config.php', 'config.php', 'configuration.php',
        'geoserver', 'wfs', 'ows', 'wms',
        'webui', 'console', 'manager',
        '.env', '.git', '.svn', '.htaccess',
        'shell', 'cmd', 'exec',
        'XDEBUG_SESSION'
    ]

    path_lower = path.lower()

    # 如果是扫描器路径，静默返回404（不记录日志）
    if any(pattern in path_lower for pattern in scanner_patterns):
        return Response(status_code=404)

    # 其他未知路径，记录警告日志
    logger.warning(f"⚠️ 未知路径访问: /{path}")
    return Response(status_code=404)
