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
from openai import OpenAI
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, File, UploadFile, Form, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse, HTMLResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field
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
from dao_content import FileDAO, ProjectDAO, VersionDAO, WorkspaceSessionDAO, PromptTemplateDAO
from dao_user import UserDAO

DB_AVAILABLE = True

# 🆕 导入管理后台模块
from agent_routes import router as agent_api_router
from admin_routes import router as admin_api_router
from api_router import set_redis_client as set_api_router_redis
from dao_api_config import ApiConfigDAO
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
# API 配置从数据库加载到环境变量
# ============================================

PROVIDER_ENV_MAP = {
    'gemini-text': 'GEMINI_TEXT_API_KEY',
    'gemini-image': 'GEMINI_IMAGE_API_KEY',
    'gemini-tts': 'GEMINI_API_KEY',
    'deepseek': 'DEEPSEEK_API_KEY',
    'doubao': 'ARK_API_KEY',
    'minimax': 'MINIMAX_API_KEY',
    'sora2': 'SORA2_API_KEY',
    'veo': 'VEO_API_KEY',
    'dashscope': 'DASHSCOPE_API_KEY',
    'seedance': 'SEEDANCE_API_KEY',
    # 2026-05-21：分镜页 GPT Image 2 系列
    # laozhang 网关同一基址 https://api.laozhang.ai/v1，但模型路由由【令牌分组】决定：
    # - laozhang-gpt-image  → 默认分组的 token，用于 gpt-image-2-vip（天劫一阶）+ Gemini 化神
    # - laozhang-sora2      → Sora2Official 分组的 token，用于 gpt-image-2 官方混合（天劫二阶）
    'laozhang-gpt-image': 'GPT_IMAGE_API_KEY',
    'laozhang-sora2': 'SORA2_GPT_IMAGE_API_KEY',
}

async def load_api_configs_to_env():
    """从数据库加载 API 配置并注入环境变量，同时更新模块级变量"""
    global DEEPSEEK_API_KEY, ARK_API_KEY, GEMINI_TEXT_API_KEY, GEMINI_IMAGE_API_KEY, deepseek_client
    global GPT_IMAGE_API_KEY, SORA2_GPT_IMAGE_API_KEY
    try:
        configs = await ApiConfigDAO.list_enabled()
        loaded = 0
        for config in configs:
            provider = (config.get('provider') or '').strip().lower()
            env_key = PROVIDER_ENV_MAP.get(provider)
            if not env_key:
                continue
            enc = config.get('api_key_encrypted')
            if not enc:
                continue
            api_key = ApiConfigDAO._decrypt_key(enc)
            if not api_key:
                continue
            os.environ[env_key] = api_key
            loaded += 1
            endpoint = config.get('endpoint', '')
            if endpoint:
                ep_env = env_key.replace('_API_KEY', '_ENDPOINT').replace('_KEY', '_ENDPOINT')
                os.environ[ep_env] = endpoint

        if loaded > 0:
            DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
            ARK_API_KEY = os.environ.get("ARK_API_KEY")
            GEMINI_TEXT_API_KEY = os.environ.get("GEMINI_TEXT_API_KEY")
            GEMINI_IMAGE_API_KEY = os.environ.get("GEMINI_IMAGE_API_KEY")
            GPT_IMAGE_API_KEY = os.environ.get("GPT_IMAGE_API_KEY")
            SORA2_GPT_IMAGE_API_KEY = os.environ.get("SORA2_GPT_IMAGE_API_KEY")

            if DEEPSEEK_API_KEY:
                try:
                    deepseek_client = OpenAI(
                        api_key=DEEPSEEK_API_KEY,
                        base_url="https://api.deepseek.com"
                    )
                    logger.info("✅ DeepSeek 客户端已初始化/刷新 (key=%s...)", DEEPSEEK_API_KEY[:8])
                except Exception as e:
                    deepseek_client = None
                    logger.warning(f"⚠️ DeepSeek 客户端初始化失败: {e}")

        logger.info(f"📦 从数据库加载了 {loaded} 个 API 配置到环境变量")
    except Exception as e:
        logger.warning(f"⚠️ 从数据库加载API配置失败（将使用.env）: {e}")

# ============================================
# 2026-05-21：API 配置幂等自检 + 升级
# ============================================
# 项目没有自动跑 SQL migration 的机制（init_db_manager 只连接，不读 sql 文件）。
# 为了让"分镜页 GPT Image 2 系列接入" 部署即生效（admin 后台直接看到占位卡片），
# 把占位入库逻辑搬到 Python 启动期 seed 函数里。两件事：
#   1) 缺失的 laozhang-gpt-image / laozhang-sora2 占位卡片 → 自动 create(enabled=False)
#   2) provider='gemini-image' 的现存卡片，若 model_name 仍是旧 nano3 字符串
#      → 自动 update 成 'gemini-3.1-flash-image-preview'（化神 nano3→nano2 in-place）
# 幂等：每次启动都跑，但 list_all + 字段判等保证不重复 create / 不反复 update。

_SEED_PROVIDERS = [
    {
        'provider': 'laozhang-gpt-image',
        'name': 'laozhang GPT Image (天劫一阶 / 化神)',
        'endpoint': 'https://api.laozhang.ai/v1',
        'model_name': 'gpt-image-2-vip',
    },
    {
        'provider': 'laozhang-sora2',
        'name': 'laozhang Sora2 分组 (天劫二阶 GPT Image 官方)',
        'endpoint': 'https://api.laozhang.ai/v1',
        'model_name': 'gpt-image-2',
    },
]

# 历史上分镜页 / 化神调用过这几个旧模型字符串，统一升级到 nano2
_GEMINI_IMAGE_LEGACY_MODELS = {
    'gemini-3-pro-image-preview',
    'gemini-3.0-pro-image',
    'nanobanana',
}
_GEMINI_IMAGE_NEW_MODEL = 'gemini-3.1-flash-image-preview'


async def seed_default_api_providers():
    """启动时幂等地保证 admin 后台能看到 GPT Image 系列占位 + 化神升级。"""
    try:
        existing = await ApiConfigDAO.list_all()
        existing_providers = {(r.get('provider') or '').strip().lower() for r in existing}

        # 1) 缺失的 GPT Image 占位 → create
        created = 0
        for spec in _SEED_PROVIDERS:
            if spec['provider'] not in existing_providers:
                row = await ApiConfigDAO.create(
                    name=spec['name'],
                    provider=spec['provider'],
                    endpoint=spec['endpoint'],
                    api_key='',  # 占位，管理员后台填
                    model_name=spec['model_name'],
                    proxy_mode='direct',
                )
                if row:
                    # 占位默认 enabled=False（admin 卡片显示 "需要填入 Key"，避免被 list_enabled 当成可用配置）
                    await ApiConfigDAO.update(row['config_id'], enabled=False)
                    created += 1
                    logger.info(f"🌱 已创建 API 配置占位：{spec['name']}（{spec['provider']}，enabled=False）")

        # 2) 化神 nano3→nano2 in-place 升级
        upgraded = 0
        for r in existing:
            provider = (r.get('provider') or '').strip().lower()
            if provider != 'gemini-image':
                continue
            model_name = (r.get('model_name') or '').strip()
            if model_name in _GEMINI_IMAGE_LEGACY_MODELS:
                # 名字里如果带 "Pro" 字样，一并替换为 "Flash 化神2阶"
                old_name = r.get('name') or ''
                new_name = old_name
                if 'Pro' in old_name or 'pro' in old_name:
                    new_name = old_name.replace('Gemini 3 Pro', 'Gemini 3.1 Flash 化神2阶')
                    new_name = new_name.replace('Gemini 3.0 Pro', 'Gemini 3.1 Flash 化神2阶')
                    new_name = new_name.replace('gemini-3-pro', 'gemini-3.1-flash')
                update_kwargs = {'model_name': _GEMINI_IMAGE_NEW_MODEL}
                if new_name != old_name:
                    update_kwargs['name'] = new_name
                await ApiConfigDAO.update(r['config_id'], **update_kwargs)
                upgraded += 1
                logger.info(
                    f"🔄 化神升级 {provider} 卡片：{old_name!r}（model {model_name!r} → {_GEMINI_IMAGE_NEW_MODEL!r}）"
                )

        if created or upgraded:
            logger.info(f"🌱 API 配置自检完成：新建 {created} 占位，升级 {upgraded} 化神")
        else:
            logger.debug("🌱 API 配置自检：无变更")
    except Exception as e:
        logger.warning(f"⚠️ API 配置自检失败（不影响启动）：{e}", exc_info=True)


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
    global redis_client, pubsub_redis_client, cluster_manager, image_cluster_manager, video_cluster_manager, workers, storage_manager, db_manager, MAIN_EVENT_LOOP

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
        await seed_default_api_providers()
        await seed_admin_roles()  # 初次部署：内置管理员 role 校正，后台开箱即用
        await load_api_configs_to_env()
    
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
# 🆕 主事件循环引用（用于在 anyio 工作线程中通过 run_coroutine_threadsafe
# 把协程调度回主循环）。Starlette 在 worker thread 里迭代同步生成器
# (StreamingResponse + sync generator)，那里没有事件循环；asyncpg 的连接池
# 又必须在创建它的同一个 loop 上使用，所以必须显式持有主 loop 引用。
MAIN_EVENT_LOOP: Optional[asyncio.AbstractEventLoop] = None
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
ARK_API_KEY = os.environ.get("ARK_API_KEY")
GEMINI_TEXT_API_KEY = os.environ.get("GEMINI_TEXT_API_KEY")
GEMINI_IMAGE_API_KEY = os.environ.get("GEMINI_IMAGE_API_KEY")
# 2026-05-21：分镜页 GPT Image 2 系列（laozhang 网关，按令牌分组分线路）
GPT_IMAGE_API_KEY = os.environ.get("GPT_IMAGE_API_KEY")            # 默认分组 → gpt-image-2-vip / 化神(gemini-3.1-flash)
SORA2_GPT_IMAGE_API_KEY = os.environ.get("SORA2_GPT_IMAGE_API_KEY")  # Sora2Official 分组 → 官方 gpt-image-2
deepseek_client: Optional[OpenAI] = None
if DEEPSEEK_API_KEY:
    try:
        deepseek_client = OpenAI(
            api_key=DEEPSEEK_API_KEY,
            base_url="https://api.deepseek.com"
        )
        logger.info("✅ DeepSeek 客户端已初始化")
    except Exception as e:
        logger.warning(f"⚠️ DeepSeek 客户端初始化失败: {e}")
else:
    logger.warning("未检测到 DEEPSEEK_API_KEY，DeepSeek 功能将不可用")

ARK_API_KEY = os.environ.get("ARK_API_KEY")
DOUBAO_MODEL = os.environ.get("DOUBAO_IMAGE_MODEL", "doubao-seedream-4-0-250828")
DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
if not ARK_API_KEY:
    logger.warning("未检测到 ARK_API_KEY，豆包图像生成功能不可用")

if not ARK_API_KEY:
    logger.warning("未检测到 ARK_API_KEY，豆包模型功能将不可用")

if not GEMINI_TEXT_API_KEY:
    logger.warning("未检测到 GEMINI_TEXT_API_KEY，Gemini文字生成功能将不可用")
if not GEMINI_IMAGE_API_KEY:
    logger.warning("未检测到 GEMINI_IMAGE_API_KEY，Gemini图像生成功能将不可用")

# 认证
security = HTTPBearer(auto_error=False)
import jwt_auth
jwt_auth.init()

# 在线用户追踪（仅用于 admin 面板显示，不用于认证）
_online_users: dict = {}

DEFAULT_USERS = {
    'admin': 'admin123',
    'user': 'user123',
    'demo': 'demo123',
    '米赛亚01': 'messiah2025@01',
    '米赛亚02': 'messiah2025@02',
    '米赛亚03': 'messiah2025@03',
    '米赛亚04': 'messiah2025@04',
    'lllsdhr': os.getenv('SUPER_ADMIN_PASSWORD', 'changeme')  # 🔐 超级管理员（对admin隐藏）
}

# 超级管理员账号（不显示在用户列表中）
SUPER_ADMIN = 'lllsdhr'

# Pydantic 模型
class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False

class GenerateRequest(BaseModel):
    # 2026-05-24 (DashScope cards 重设计 — silent-failure fix)：允许前端透传
    # kling_multi_shot / vidu_resolution / vidu_seed / hh_ratio / hh_seed 等新字段
    # 进入 task.data 而不被 Pydantic 默认的 extra='ignore' 静默丢弃。这是 §G
    # silent-failure trap 的根因：层间约定缺一道字段就在 POST → task.data 之间断链。
    # 后续新增 DashScope 子模型字段无需再改 schema，worker 直接从 task.data 读取。
    model_config = ConfigDict(extra='allow')

    task_type: str = Field(..., description="i2v, morph, upscale, voice, wan26_i2v, seedance_*, kling_*, vidu_*, happyhorse_r2v")
    model: str = Field("Wan2", description="模型名称")
    prompt: str = Field("", description="提示词")
    prompt_AU: Optional[str] = Field(None, description="配音提示词")
    negative_prompt: str = Field("bad quality", description="负面提示词")
    image_path: Optional[str] = Field(None, description="图片文件路径")
    image_path_end: Optional[str] = Field(None, description="结束帧路径（morph）")
    video_filename: Optional[str] = Field(None, description="视频文件名（upscale/voice）")
    audio_filename: Optional[str] = Field(None, description="音频文件名（voice）")
    seed: int = Field(-1, description="随机种子")
    steps: int = Field(20, description="步数")
    cfg: float = Field(7.5, description="CFG")
    priority: int = Field(2, description="优先级 1-3")
    # 🆕 Wan2.6-大能模型专用参数
    resolution: Optional[str] = Field("1080P", description="分辨率（720P, 1080P）")
    duration: Optional[int] = Field(5, description="视频时长（5, 10, 15秒）")
    shot_type: Optional[str] = Field("multi", description="镜头类型（multi多镜头, single单镜头）")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    # Seedance 2.0 (飞升/渡劫) 专用字段
    sub_model: Optional[str] = Field(None, description="Seedance 子型号: standard|fast")
    media_inputs: Optional[List[Dict[str, Any]]] = Field(None, description="Seedance 多模态输入: [{kind:image|video|audio, url, role?, file_id?}]")
    ratio: Optional[str] = Field("adaptive", description="Seedance 画面比例: adaptive|16:9|4:3|1:1|3:4|9:16|21:9")
    watermark: Optional[bool] = Field(False, description="Seedance 水印")
    generate_audio: Optional[bool] = Field(True, description="Seedance AI 配音")
    camera_fixed: Optional[bool] = Field(False, description="Seedance 1.5pro 专用，2.0 系列无效")
    draft_task_id: Optional[str] = Field(None, description="Seedance 1.5pro 样片任务 ID 复用，2.0 不支持")

class DeepseekChatRequest(BaseModel):
    prompt: str = Field(..., description="要发送给 DeepSeek 的提示词")
    response_format: str = Field("text", pattern="^(text|json)$")
    temperature: float = Field(0.2, ge=0, le=1)
    model: str = Field("deepseek-reasoner", description="DeepSeek模型名称: deepseek-reasoner 或 deepseek-chat")

class DoubaoImageRequest(BaseModel):
    prompt: str
    references: List[str] = Field(default_factory=list)
    size: str = Field("2K")
    sequential: str = Field("disabled", pattern="^(disabled|auto)$")
    count: int = Field(1, ge=1, le=15)
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)

class GeminiTextRequest(BaseModel):
    prompt: str
    system_prompt: Optional[str] = None
    temperature: float = Field(1.0, ge=0, le=2)

class GeminiImageRequest(BaseModel):
    prompt: str
    model: str = Field("gemini-2.5-flash-image")
    references: List[str] = Field(default_factory=list)
    aspectRatio: str = Field("1:1")
    imageSize: Optional[str] = None
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)

class GptImageRequest(BaseModel):
    """2026-05-21：分镜页 GPT Image 2 系列统一入口。
    
    tier 决定路由 → 模型 + laozhang 令牌分组：
    - "vip"      → gpt-image-2-vip   + GPT_IMAGE_API_KEY      （天劫一阶 / 默认分组）
    - "official" → gpt-image-2       + SORA2_GPT_IMAGE_API_KEY（天劫二阶 / Sora2Official 分组）
    
    references 为空 → /v1/images/generations（文生图，JSON）
    references 非空 → /v1/images/edits      （图改图，multipart/form-data）
    """
    prompt: str
    tier: str = Field("vip", description="vip | official")
    references: List[str] = Field(default_factory=list)
    size: str = Field("auto", description="1024x1024 / 1536x1024 / auto / etc，由前端按 ratio×K 推荐后透传")
    quality: str = Field("auto", description="auto | low | medium | high")
    n: int = Field(1, ge=1, le=4)
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)

class CropVideoRequest(BaseModel):
    video_filename: str
    start_time: float = 0
    end_time: float = 5

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

async def ensure_deepseek_client() -> bool:
    """确保 deepseek_client 可用：失效或未初始化时，从 DB / env 懒加载并重建。

    解决以下场景：
    1. 启动时无 DEEPSEEK_API_KEY 环境变量、且 DB 中也没有 enabled 配置 → 启动后管理员
       在后台添加配置，但服务进程未重启，client 仍为 None。
    2. 启动后管理员替换/轮换了 key，旧 client 被显式置 None。
    返回 True 表示 client 现在可用，False 表示仍不可用。
    """
    global DEEPSEEK_API_KEY, deepseek_client
    if deepseek_client:
        return True
    api_key = os.environ.get("DEEPSEEK_API_KEY") or DEEPSEEK_API_KEY
    if not api_key:
        try:
            configs = await ApiConfigDAO.list_enabled()
            for cfg in configs:
                if (cfg.get('provider') or '').strip().lower() != 'deepseek':
                    continue
                enc = cfg.get('api_key_encrypted')
                if not enc:
                    continue
                decoded = ApiConfigDAO._decrypt_key(enc)
                if decoded:
                    api_key = decoded
                    os.environ["DEEPSEEK_API_KEY"] = decoded
                    break
        except Exception as e:
            logger.warning(f"⚠️ 懒加载 DeepSeek 配置失败: {e}")
    if not api_key:
        return False
    try:
        DEEPSEEK_API_KEY = api_key
        deepseek_client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
        logger.info("✅ DeepSeek 客户端已懒加载初始化 (key=%s...)", api_key[:8])
        return True
    except Exception as e:
        deepseek_client = None
        logger.warning(f"⚠️ DeepSeek 客户端懒加载失败: {e}")
        return False


def call_deepseek(prompt: str, response_format: str = "text", temperature: float = 0.2, model: str = "deepseek-reasoner") -> str:
    """非流式调用（保留，用于不需要流式的场景）"""
    if not deepseek_client:
        raise HTTPException(status_code=503, detail="DeepSeek 服务未配置，请在管理后台添加 DEEPSEEK_API_KEY 或 deepseek 提供商配置后重试")
    completion = deepseek_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant for storyboard generation tasks."},
            {"role": "user", "content": prompt}
        ],
        stream=False,
        temperature=temperature,
        response_format={"type": "json_object"} if response_format == "json" else None
    )
    message = completion.choices[0].message
    content = message.get("content") if isinstance(message, dict) else getattr(message, "content", "")
    if not content:
        raise HTTPException(status_code=500, detail="AI服务返回空内容")
    return content

def call_deepseek_stream(prompt: str, response_format: str = "text", temperature: float = 0.2, model: str = "deepseek-reasoner", task_id: str = None):
    """流式调用DeepSeek（支持reasoning_content + content），完成后保存到数据库

    注意：此函数是生成器，被 StreamingResponse 包装后，HTTP 响应头已先于函数体执行而发出。
    任何 raise HTTPException 都会发生在 SSE 流中途，无法转换为干净的 HTTP 错误响应，
    会产生 anyio TaskGroup 嵌套异常链。所以这里改为 yield SSE error event。
    上游调用方（路由处理器）应在返回 StreamingResponse 前完成 client 可用性预检查。
    """
    if not deepseek_client:
        yield f"data: {json.dumps({'type': 'error', 'message': 'DeepSeek 服务未配置，请在管理后台添加 DEEPSEEK_API_KEY 或 deepseek 提供商配置'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    try:
        stream = deepseek_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant for storyboard generation tasks."},
                {"role": "user", "content": prompt}
            ],
            stream=True,
            temperature=temperature,
            response_format={"type": "json_object"} if response_format == "json" else None
        )
    except Exception as e:
        logger.error(f"⚠️ DeepSeek API 调用失败: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': f'DeepSeek API 调用失败: {str(e)[:200]}'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 🆕 拼接完整内容
    full_content = []

    # 🔧 返回生成器，yield SSE格式的数据
    try:
        for chunk in stream:
            # deepseek-reasoner 模型有 reasoning_content
            if hasattr(chunk.choices[0].delta, 'reasoning_content') and chunk.choices[0].delta.reasoning_content:
                yield f"data: {json.dumps({'type': 'reasoning', 'content': chunk.choices[0].delta.reasoning_content})}\n\n"
            elif chunk.choices[0].delta.content:
                content_piece = chunk.choices[0].delta.content
                full_content.append(content_piece)
                yield f"data: {json.dumps({'type': 'content', 'content': content_piece})}\n\n"
    except Exception as e:
        logger.error(f"⚠️ DeepSeek 流式读取失败: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': f'DeepSeek 流式读取失败: {str(e)[:200]}'})}\n\n"

    yield "data: [DONE]\n\n"

    # 🆕 流式完成后，把保存协程调度回主事件循环
    # 注意：本函数是 sync generator，被 StreamingResponse 在 anyio worker thread 中迭代，
    # 该线程没有 running loop。直接 asyncio.get_event_loop() 在 Python 3.10+ 是
    # DeprecationWarning，在新 Python 上抛 RuntimeError "There is no current event loop
    # in thread 'AnyIO worker thread'"。即使能拿到本线程的 loop，asyncpg 连接池也只能
    # 在创建它的主 loop 上使用 → 必须用 run_coroutine_threadsafe 调度回主 loop。
    if task_id and full_content:
        complete_text = ''.join(full_content)
        if MAIN_EVENT_LOOP is not None and not MAIN_EVENT_LOOP.is_closed():
            try:
                asyncio.run_coroutine_threadsafe(
                    _save_text_result(task_id, complete_text),
                    MAIN_EVENT_LOOP,
                )
            except Exception as e:
                logger.error(f"⚠️ 提交保存任务到主事件循环失败: {e}", exc_info=True)
        else:
            logger.warning("⚠️ MAIN_EVENT_LOOP 不可用，跳过 DeepSeek 文本结果持久化")

async def _save_text_result(task_id: str, text_content: str):
    """异步保存文本生成结果到数据库"""
    try:
        from dao_task import TaskDAO
        # 截取前2000字符保存（避免数据库存储过大）
        truncated_text = text_content[:2000] if len(text_content) > 2000 else text_content
        await TaskDAO.update_task_status(
            task_id=task_id,
            status="completed",
            result_data={"text": truncated_text, "full_length": len(text_content)}
        )
        logger.info(f"✅ 文本结果已保存到数据库: {task_id}, 长度: {len(text_content)}")
    except Exception as e:
        logger.error(f"⚠️ 保存文本结果失败: {e}", exc_info=True)

def data_url_to_base64(data_url: str) -> str:
    if not data_url:
        return ""
    if "base64," in data_url:
        return data_url.split("base64,", 1)[1]
    if data_url.startswith('/storage/'):
        file_path = Path('persistent_storage') / data_url.replace('/storage/', '', 1)
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
        file_path = Path("persistent_storage") / ref.replace("/storage/", "", 1)
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

# ============================================
# API 路由
# ============================================

# ==================== API 端点 ====================

@app.get("/")
async def root():
    """返回登录页面"""
    return FileResponse('login.html')

@app.get("/login")
async def login_page():
    """返回登录页面"""
    return FileResponse('login.html')

@app.get("/favicon.ico")
async def favicon():
    """返回favicon图标"""
    # 使用现有的图标文件
    favicon_path = Path("static/image_1ca1c5.png")
    if favicon_path.exists():
        return FileResponse(favicon_path)
    # 如果没有图标，返回204 No Content（正常情况）
    return Response(status_code=204)

@app.get("/favicon.png")
async def favicon_png():
    """返回favicon PNG图标"""
    return await favicon()

@app.get("/editor")
async def editor_page():
    """旧路由 → 重定向到项目管理"""
    return RedirectResponse("/projects", status_code=301)

@app.get("/materials")
async def materials_page():
    """旧路由 → 重定向到项目管理"""
    return RedirectResponse("/projects", status_code=301)

@app.get("/generation")
async def generation_page():
    """旧路由 → 重定向到项目管理"""
    return RedirectResponse("/projects", status_code=301)

@app.get("/workspace")
async def workspace_page():
    """旧路由 → 重定向到项目管理"""
    return RedirectResponse("/projects", status_code=301)

@app.get("/app")
async def app_page():
    """重定向到项目管理"""
    return RedirectResponse(url="/projects")

# ============================================
# React SPA 路由（项目中心化）
# ============================================

def _serve_spa():
    """返回 React SPA 入口文件（禁止缓存以确保获取最新构建哈希）"""
    dist_index = Path("dist/index.html")
    if dist_index.exists():
        return FileResponse(
            'dist/index.html',
            headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
        )
    return HTMLResponse("""
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>应用未构建</h1>
        <pre>cd new_html && npm run build</pre>
        </body></html>
    """)

@app.get("/projects")
async def projects_hub():
    """项目管理中心"""
    return _serve_spa()

@app.get("/projects/{path:path}")
async def projects_spa(path: str):
    """项目工作区 SPA catch-all（/projects/{id}/editor, /video 等）"""
    return _serve_spa()

@app.get("/canvas")
async def canvas_page():
    """无限画布页面"""
    return _serve_spa()

@app.get("/canvas/{path:path}")
async def canvas_spa(path: str):
    """画布 SPA catch-all"""
    return _serve_spa()

# ============================================
# 2026-05-26 React Admin Shell SPA 路由
#  - /admin / /admin/login / /admin/operations / /admin/settings 全部返回 dist/index.html
#  - 旧版 cluster_main 静态控制台已搬到 /admin-legacy/（见 app.mount("/admin-legacy", ...)）
#  - 注意：必须把 /admin/* 各个具体路径都显式枚举（包含子路径），否则 SPA 子路由刷新会 404
#  - 详见 docs/vertical-slices.md "Admin Shell（2026-05-26）" + docs/faq.md 2026-05-26 "/admin/login 404"
# ============================================

@app.get("/admin")
@app.get("/admin/")
async def admin_spa_root():
    return _serve_spa()

@app.get("/admin/login")
@app.get("/admin/operations")
@app.get("/admin/settings")
async def admin_spa_named():
    return _serve_spa()

@app.get("/admin/login/{path:path}")
@app.get("/admin/operations/{path:path}")
@app.get("/admin/settings/{path:path}")
async def admin_spa_subpath(path: str):
    return _serve_spa()

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

@app.post("/api/deepseek/chat")
async def deepseek_chat(request: DeepseekChatRequest, username: str = Depends(require_auth)):
    """DeepSeek流式聊天接口"""
    # 🛡️ 预检：在返回 StreamingResponse 之前确认 client 可用，否则懒加载。
    # 不在生成器内部 raise HTTPException —— 那样会发生在 SSE 流中途（响应头已发出），
    # 触发 anyio TaskGroup 异常链，前端只能看到连接断开。
    if not deepseek_client:
        ok = await ensure_deepseek_client()
        if not ok:
            raise HTTPException(
                status_code=503,
                detail="DeepSeek 服务未配置，请在管理后台 (Admin → API 配置) 添加 deepseek 提供商的 API Key 后重试"
            )
    try:
        # 🆕 保存任务到数据库（初始状态为processing，流式完成后更新）
        task_id = None
        try:
            from dao_task import TaskDAO
            task_id = f"deepseek_text_{int(time.time() * 1000)}"
            await TaskDAO.create_task(
                task_id=task_id,
                user_id=username,
                task_type="deepseek_text",
                task_data={
                    "prompt": request.prompt[:500],
                    "response_format": request.response_format,
                    "temperature": request.temperature
                }
            )
            logger.info(f"✅ DeepSeek文本生成任务已创建: {task_id}")
        except Exception as save_error:
            logger.error(f"⚠️ 保存DeepSeek任务失败: {save_error}", exc_info=True)
            task_id = None  # 保存失败时不传task_id
        
        # 🔧 返回流式响应（传入task_id以便完成后保存内容）
        return StreamingResponse(
            call_deepseek_stream(
                prompt=request.prompt,
                response_format=request.response_format,
                temperature=request.temperature,
                model=request.model,
                task_id=task_id  # 🆕 传递task_id用于保存结果
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"  # 禁用Nginx缓冲
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI服务请求失败: {e}")
        raise HTTPException(status_code=500, detail="AI服务请求失败，请稍后重试")

@app.post("/api/gemini/text")
async def gemini_text_chat(request: GeminiTextRequest, username: str = Depends(require_auth)):
    """Gemini文本生成接口（代理）"""
    if not GEMINI_TEXT_API_KEY:
        raise HTTPException(status_code=500, detail="文本生成服务未配置，请联系管理员")
    
    try:
        import requests
        
        url = "https://api.laozhang.ai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {GEMINI_TEXT_API_KEY}",
            "Content-Type": "application/json"
        }
        
        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.append({"role": "user", "content": request.prompt})
        
        payload = {
            "model": "gemini-2.5-flash",
            "messages": messages,
            "temperature": request.temperature
        }
        
        # 用线程池跑阻塞 requests，避免冻住 async 事件循环（单进程下会拖慢所有请求）
        response = await asyncio.to_thread(requests.post, url, headers=headers, json=payload, timeout=120)
        response.raise_for_status()
        
        result = response.json()
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        
        # 🆕 保存任务到数据库（包含完整文本内容）
        try:
            from dao_task import TaskDAO
            task_id = f"gemini_text_{int(time.time() * 1000)}"
            await TaskDAO.create_task(
                task_id=task_id,
                user_id=username,
                task_type="gemini_text",
                task_data={
                    "prompt": request.prompt[:500],
                    "system_prompt": request.system_prompt[:200] if request.system_prompt else None,
                    "temperature": request.temperature
                }
            )
            # 🆕 保存完整文本内容（截取前2000字符）
            truncated_text = content[:2000] if len(content) > 2000 else content
            await TaskDAO.update_task_status(
                task_id=task_id,
                status="completed",
                result_data={"text": truncated_text, "full_length": len(content)}
            )
            logger.info(f"✅ Gemini文本生成任务已保存: {task_id}, 长度: {len(content)}")
        except Exception as save_error:
            logger.error(f"⚠️ 保存Gemini文本任务失败: {save_error}", exc_info=True)
        
        return {"content": content}
        
    except Exception as e:
        # laozhang 返回的 4xx/5xx 响应体里才有真正原因（模型名无效 / token 分组无权限 / 配额等）。
        # 之前只记了 "400 Client Error" 把 body 丢了，导致无从定位。这里补回响应体并透传给前端。
        upstream = ""
        try:
            import requests as _rq
            if isinstance(e, _rq.HTTPError) and getattr(e, "response", None) is not None:
                upstream = (e.response.text or "")[:500]
        except Exception:
            pass
        logger.error(f"文本生成失败: {e} | laozhang响应: {upstream}")
        detail = f"文本生成失败：{upstream[:200]}" if upstream else "文本生成失败，请稍后重试"
        raise HTTPException(status_code=500, detail=detail)

@app.post("/api/gemini/image")
async def gemini_image_generate(request: GeminiImageRequest, username: str = Depends(require_auth)):
    """Gemini图像生成接口（代理）"""
    if not GEMINI_IMAGE_API_KEY:
        raise HTTPException(status_code=500, detail="图像生成服务未配置，请联系管理员")
    
    try:
        import requests
        import base64
        
        # 构建请求parts
        parts = []
        
        # 添加参考图片（支持 data: base64 和 /storage/ 路径）
        ref_count = 0
        for ref in request.references[:5]:
            try:
                if ref.startswith('data:'):
                    mime_type = ref.split(';')[0].split(':')[1]
                    b64_data = ref.split(',')[1] if ',' in ref else ref
                    parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
                    ref_count += 1
                elif ref.startswith('/storage/'):
                    file_path = Path('persistent_storage') / ref.replace('/storage/', '', 1)
                    if file_path.exists():
                        img_bytes = file_path.read_bytes()
                        ext = file_path.suffix.lower()
                        mime_map = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                                    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp'}
                        mime_type = mime_map.get(ext, 'image/png')
                        b64_data = base64.b64encode(img_bytes).decode('utf-8')
                        parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
                        ref_count += 1
                        logger.info(f"📷 从磁盘读取参考图: {file_path} ({len(img_bytes)} bytes)")
                    else:
                        logger.warning(f"⚠️ 参考图文件不存在: {file_path}")
                else:
                    logger.warning(f"⚠️ 不支持的参考图格式: {ref[:80]}")
            except Exception as ref_err:
                logger.warning(f"⚠️ 处理参考图失败: {ref_err}")
        
        # 🔧 增强提示词：明确要求参考图片
        enhanced_prompt = request.prompt
        if ref_count > 0:
            if ref_count == 1:
                enhanced_prompt = f"请严格参考上面提供的参考图片，{request.prompt}\n\n重要提示：请紧密遵循参考图的画风、构图、角色设计、色彩风格和视觉元素。在保持与参考图一致性的同时，融入描述中的变化。确保生成的图像在视觉风格上与参考图高度相似。"
            else:
                enhanced_prompt = f"请严格参考上面提供的{ref_count}张参考图片，{request.prompt}\n\n重要提示：请紧密遵循这些参考图的画风、构图、角色设计、色彩风格和视觉元素。在保持与参考图一致性的同时，融入描述中的变化。确保生成的图像在视觉风格上与参考图高度相似。"
        
        # 添加增强后的提示词
        parts.append({"text": enhanced_prompt})
        
        # 2026-05-21：nano3 → nano2 in-place 替换
        # 前端 'nanobanana' / 'gemini-3-pro-image-preview' 历史值都路由到新模型 gemini-3.1-flash-image-preview。
        # 旧 task 历史保留可追溯，但新生成统一走 nano2。
        _model_alias = {
            "gemini-3-pro-image-preview": "gemini-3.1-flash-image-preview",
            "nanobanana": "gemini-3.1-flash-image-preview",
        }
        _allowed_models = {"gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"}
        requested = _model_alias.get(request.model, request.model)
        model = requested if requested in _allowed_models else "gemini-2.5-flash-image"
        url = f"https://api.laozhang.ai/v1beta/models/{model}:generateContent"
        
        headers = {
            "Authorization": f"Bearer {GEMINI_IMAGE_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {
                    "aspectRatio": request.aspectRatio
                }
            }
        }
        
        # 化神(nano2 = gemini-3.1-flash-image-preview)支持 1K/2K/4K；
        # 旧 nano3(gemini-3-pro-image-preview) 也支持，统一放行。
        # gemini-2.5-flash-image 仅支持 1K，imageSize 不传给它。
        if model in ("gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview") and request.imageSize:
            payload["generationConfig"]["imageConfig"]["imageSize"] = request.imageSize
        
        # 用线程池跑阻塞 requests，避免冻住 async 事件循环（出图慢时尤其影响全站）
        response = await asyncio.to_thread(requests.post, url, headers=headers, json=payload, timeout=180)
        response.raise_for_status()
        
        result = response.json()
        images = []
        
        for candidate in result.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                if "inlineData" in part:
                    mime_type = part["inlineData"]["mimeType"]
                    data = part["inlineData"]["data"]
                    images.append(f"data:{mime_type};base64,{data}")
        
        if not images:
            raise HTTPException(status_code=500, detail="图像生成服务未返回结果")
        
        logger.info(f"✅ 图像生成成功: {len(images)} 张图片, 用户: {username}")
        
        # 🆕 保存任务到数据库
        try:
            from dao_task import TaskDAO
            task_id = f"gemini_img_{int(time.time() * 1000)}"
            await TaskDAO.create_task(
                task_id=task_id,
                user_id=username,
                task_type=f"gemini_image_{model.replace('gemini-', '').replace('-image', '')}",
                task_data={
                    "prompt": request.prompt,
                    "model": model,
                    "aspectRatio": request.aspectRatio,
                    "imageSize": request.imageSize
                }
            )
            # 立即更新为completed状态
            await TaskDAO.update_task_status(
                task_id=task_id,
                status="completed",
                result_data={"images_count": len(images)}
            )
            logger.info(f"✅ Gemini图像生成任务已保存: {task_id}")
        except Exception as save_error:
            logger.error(f"⚠️ 保存Gemini图像生成任务失败: {save_error}", exc_info=True)
        
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
                    file_role=request.file_role or 'generated_image',
                    original_ext='.png',
                    episode_id=request.episode_id,
                    extra_metadata={'prompt': request.prompt, 'model': model},
                )
                # 2026-05-26 Slice 1: 同步进通用素材库（best-effort）
                try:
                    import media_library_service
                    from dao_content import FileDAO as _FileDAO
                    _file_record = await _FileDAO.get_file(saved['file_id']) if saved.get('file_id') else None
                    if _file_record:
                        await media_library_service.create_from_file(
                            file_record=_file_record,
                            source='generated_image_gemini',
                            episode_id=request.episode_id,
                            source_task_id=task_id,
                            source_entity_type=request.entity_type,
                            source_entity_id=request.entity_id,
                            title=(request.prompt or '')[:80] or None,
                            metadata={'prompt': request.prompt, 'model': model},
                        )
                except Exception as _e:
                    logger.warning(f"media_library 同步失败 (Gemini): {_e}")
                files_result.append({
                    'data_url': img_data_url,
                    'file_id': saved['file_id'],
                    'file_url': saved['file_url'],
                })
            except Exception as e:
                logger.warning(f"保存图片到 files 表失败: {e}")
                files_result.append({'data_url': img_data_url, 'file_id': None, 'file_url': None})

        return {"success": True, "images": images, "files": files_result}
        
    except Exception as e:
        logger.error(f"图像生成失败: {e}")
        # 🔒 不暴露技术细节，只返回通用错误信息
        raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

@app.post("/api/gpt-image/generate")
async def gpt_image_generate(request: GptImageRequest, username: str = Depends(require_auth)):
    """2026-05-21：分镜页 GPT Image 2 系列统一网关（laozhang OpenAI Images 兼容协议）。
    
    自动按 references 分发：空 → text2img (/v1/images/generations)；非空 → img2img (/v1/images/edits)。
    """
    import base64
    import io
    import requests as http_requests
    from file_service import save_generated_file_to_db
    
    tier = (request.tier or "vip").strip().lower()
    if tier == "vip":
        model = "gpt-image-2-vip"
        api_key = GPT_IMAGE_API_KEY
        key_hint = "GPT_IMAGE_API_KEY (laozhang 默认分组)"
    elif tier == "official":
        model = "gpt-image-2"
        api_key = SORA2_GPT_IMAGE_API_KEY
        key_hint = "SORA2_GPT_IMAGE_API_KEY (laozhang Sora2Official 分组)"
    else:
        raise HTTPException(status_code=400, detail=f"不支持的 tier: {request.tier}（应为 vip|official）")
    
    if not api_key:
        raise HTTPException(status_code=500, detail=f"图像生成服务未配置 {key_hint}，请管理员在后台填入 API Key")
    
    if not request.prompt or not request.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    
    base_url = "https://api.laozhang.ai/v1"
    n = max(1, min(4, request.n or 1))
    
    try:
        if request.references:
            # ============ 图改图：multipart/form-data ============
            ref_files = []
            for idx, ref in enumerate(request.references[:8]):  # 最多 8 张参考图
                img_bytes = None
                ext = "png"
                if ref.startswith("data:"):
                    mime = ref.split(";")[0].split(":")[1] if ":" in ref.split(";")[0] else "image/png"
                    ext = "jpeg" if "jpeg" in mime or "jpg" in mime else ("webp" if "webp" in mime else "png")
                    b64_data = ref.split(",", 1)[1] if "," in ref else ref
                    img_bytes = base64.b64decode(b64_data)
                elif ref.startswith("/storage/"):
                    fp = Path("persistent_storage") / ref.replace("/storage/", "", 1)
                    if fp.exists():
                        img_bytes = fp.read_bytes()
                        ext = fp.suffix.lstrip(".").lower() or "png"
                        if ext == "jpg":
                            ext = "jpeg"
                if img_bytes is None:
                    logger.warning(f"⚠️ GPT Image edit 跳过无效参考图: {ref[:60]}...")
                    continue
                ref_files.append(("image[]", (f"ref_{idx}.{ext}", io.BytesIO(img_bytes), f"image/{ext}")))
            
            if not ref_files:
                raise HTTPException(status_code=400, detail="提供了 references 但全部无法读取，无法发起图改图")
            
            data = {
                "model": model,
                "prompt": request.prompt,
                "n": str(n),
                "size": request.size or "auto",
                "quality": request.quality or "auto",
            }
            headers = {"Authorization": f"Bearer {api_key}"}
            url = f"{base_url}/images/edits"
            logger.info(f"🎨 GPT Image edit → tier={tier} model={model} refs={len(ref_files)} size={data['size']} quality={data['quality']}")
            resp = await asyncio.to_thread(http_requests.post, url, headers=headers, data=data, files=ref_files, timeout=240)
        else:
            # ============ 文生图：JSON ============
            payload = {
                "model": model,
                "prompt": request.prompt,
                "n": n,
                "size": request.size or "auto",
                "quality": request.quality or "auto",
            }
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            url = f"{base_url}/images/generations"
            logger.info(f"🎨 GPT Image generate → tier={tier} model={model} size={payload['size']} quality={payload['quality']}")
            resp = await asyncio.to_thread(http_requests.post, url, headers=headers, json=payload, timeout=240)
        
        if resp.status_code >= 400:
            logger.error(f"GPT Image 失败 ({resp.status_code}): {resp.text[:500]}")
            raise HTTPException(status_code=502, detail=f"上游图像生成失败 ({resp.status_code})，请检查 API Key 或稍后重试")
        
        result = resp.json()
        images: List[str] = []
        for item in result.get("data", []) or []:
            if item.get("b64_json"):
                images.append(f"data:image/png;base64,{item['b64_json']}")
            elif item.get("url"):
                images.append(item["url"])
        
        if not images:
            raise HTTPException(status_code=500, detail="GPT Image 未返回图片")
        
        # 入库（沿用 Gemini 的入库管线）
        files_result = []
        for img in images:
            try:
                if img.startswith("data:"):
                    b64_data = img.split(",", 1)[1] if "," in img else img
                    content = base64.b64decode(b64_data)
                else:
                    # url 形式：拉一次落到本地
                    r2 = http_requests.get(img, timeout=60)
                    r2.raise_for_status()
                    content = r2.content
                saved = await save_generated_file_to_db(
                    content=content,
                    file_type="image",
                    user_id=username,
                    source=f"gpt-image-{tier}",
                    entity_type=request.entity_type,
                    entity_id=request.entity_id,
                    file_role=request.file_role or "generated_image",
                    original_ext=".png",
                    episode_id=request.episode_id,
                    extra_metadata={
                        "prompt": request.prompt,
                        "model": model,
                        "tier": tier,
                        "size": request.size,
                        "quality": request.quality,
                        "ref_count": len(request.references or []),
                    },
                )
                # 2026-05-26 Slice 1: 同步进通用素材库（best-effort）
                try:
                    import media_library_service
                    from dao_content import FileDAO as _FileDAO
                    _file_record = await _FileDAO.get_file(saved['file_id']) if saved.get('file_id') else None
                    if _file_record:
                        await media_library_service.create_from_file(
                            file_record=_file_record,
                            source='generated_image_gpt',
                            episode_id=request.episode_id,
                            source_entity_type=request.entity_type,
                            source_entity_id=request.entity_id,
                            title=(request.prompt or '')[:80] or None,
                            metadata={'prompt': request.prompt, 'model': model, 'tier': tier},
                        )
                except Exception as _e:
                    logger.warning(f"media_library 同步失败 (GPT Image): {_e}")
                files_result.append({
                    "data_url": img if img.startswith("data:") else None,
                    "url": None if img.startswith("data:") else img,
                    "file_id": saved["file_id"],
                    "file_url": saved["file_url"],
                })
            except Exception as e:
                logger.warning(f"GPT Image 保存到 files 表失败: {e}")
                files_result.append({"data_url": img if img.startswith("data:") else None, "url": img if not img.startswith("data:") else None, "file_id": None, "file_url": None})
        
        logger.info(f"✅ GPT Image {tier} 生成 {len(images)} 张, 用户: {username}")
        return {"success": True, "images": images, "files": files_result, "model": model, "tier": tier}
    except HTTPException:
        raise
    except http_requests.Timeout:
        raise HTTPException(status_code=504, detail="图像生成超时，请稍后重试")
    except Exception as e:
        logger.error(f"GPT Image 生成异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")


@app.post("/api/materials/doubao")
async def generate_doubao_images(request: DoubaoImageRequest, username: str = Depends(require_auth)):
    if not ARK_API_KEY:
        raise HTTPException(status_code=500, detail="未配置 ARK_API_KEY，无法调用豆包接口")
    try:
        payload = {
            "model": DOUBAO_MODEL,
            "prompt": request.prompt,
            "size": request.size,
            "sequential_image_generation": request.sequential,
            "stream": False,
            "response_format": "b64_json",
            "watermark": False,
        }

        ref_inputs: List[str] = []
        if request.references:
            for ref in request.references[:14]:
                s = to_doubao_image_input(ref)
                if s:
                    ref_inputs.append(s)
            if ref_inputs:
                payload["image"] = ref_inputs[0] if len(ref_inputs) == 1 else ref_inputs

        if request.sequential == "auto":
            requested = max(1, min(15, int(request.count or 1)))
            if ref_inputs:
                allowed = max(1, 15 - len(ref_inputs))
                requested = min(requested, allowed)
            payload["sequential_image_generation_options"] = {"max_images": requested}
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {ARK_API_KEY}"
        }
        resp = await asyncio.to_thread(requests.post, DOUBAO_ENDPOINT, headers=headers, json=payload, timeout=120)
        if resp.status_code != 200:
            logger.error(f"豆包生成失败: {resp.text}")
            raise HTTPException(status_code=500, detail=f"豆包生成失败: {resp.text[:200]}")
        
        resp_data = resp.json()
        images = []
        for item in resp_data.get("data", []):
            if item.get("b64_json"):
                images.append(f"data:image/png;base64,{item['b64_json']}")
            elif item.get("url"):
                images.append(item["url"])
        if not images:
            raise HTTPException(status_code=500, detail="豆包未返回图片")
        logger.info(f"✅ 豆包生成 {len(images)} 张图片, 用户: {username}")
        
        # 🆕 保存任务到数据库
        try:
            from dao_task import TaskDAO
            task_id = f"doubao_img_{int(time.time() * 1000)}"
            await TaskDAO.create_task(
                task_id=task_id,
                user_id=username,
                task_type="doubao_image",
                task_data={
                    "prompt": request.prompt,
                    "size": request.size,
                    "count": request.count,
                    "sequential": request.sequential
                }
            )
            # 立即更新为completed状态
            await TaskDAO.update_task_status(
                task_id=task_id,
                status="completed",
                result_data={"images_count": len(images)}
            )
            logger.info(f"✅ 豆包图像生成任务已保存: {task_id}")
        except Exception as save_error:
            logger.error(f"⚠️ 保存豆包图像生成任务失败: {save_error}", exc_info=True)
        
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
                    source='doubao',
                    entity_type=request.entity_type,
                    entity_id=request.entity_id,
                    file_role=request.file_role or 'generated_image',
                    original_ext='.png',
                    episode_id=request.episode_id,
                    extra_metadata={'prompt': request.prompt, 'model': 'doubao'},
                )
                # 2026-05-26 Slice 1: 同步进通用素材库（best-effort）
                try:
                    import media_library_service
                    from dao_content import FileDAO as _FileDAO
                    _file_record = await _FileDAO.get_file(saved['file_id']) if saved.get('file_id') else None
                    if _file_record:
                        await media_library_service.create_from_file(
                            file_record=_file_record,
                            source='generated_image_doubao',
                            episode_id=request.episode_id,
                            source_entity_type=request.entity_type,
                            source_entity_id=request.entity_id,
                            title=(request.prompt or '')[:80] or None,
                            metadata={'prompt': request.prompt, 'model': 'doubao'},
                        )
                except Exception as _e:
                    logger.warning(f"media_library 同步失败 (Doubao): {_e}")
                files_result.append({
                    'data_url': img_data_url,
                    'file_id': saved['file_id'],
                    'file_url': saved['file_url'],
                })
            except Exception as e:
                logger.warning(f"保存图片到 files 表失败: {e}")
                files_result.append({'data_url': img_data_url, 'file_id': None, 'file_url': None})

        return {"success": True, "images": images, "files": files_result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"豆包图像生成异常: {e}")
        raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

@app.post("/api/logout")
async def logout(username: str = Depends(require_auth)):
    _online_users.pop(username, None)
    return {"success": True, "message": "登出成功"}

@app.get("/api/user/info")
async def get_user_info(username: str = Depends(require_auth)):
    return {
        "username": username,
        "login_time": datetime.now().isoformat()
    }


# ============================================
# 2026-05-26 组织管理 MVP — 用户自服务
# 详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.2
# ============================================
@app.get("/api/me/organizations")
async def list_my_organizations(username: str = Depends(require_auth)):
    """返回当前用户加入的所有 active 组织（WorkspaceSwitcher 数据源）。

    user_id 在本系统中与 username 同值（cluster_main.require_auth 自动注册时
    user_id=username）。
    """
    try:
        from dao_organization import OrganizationMemberDAO
        orgs = await OrganizationMemberDAO.list_orgs_for_user(username)
    except Exception as e:
        logger.warning(f"list_my_organizations: DAO 调用失败 username={username} err={e}")
        return {"success": True, "organizations": []}

    def _serialize(o: dict) -> dict:
        out = {}
        for k, v in o.items():
            if hasattr(v, 'isoformat'):
                out[k] = v.isoformat()
            else:
                out[k] = v
        return out

    return {"success": True, "organizations": [_serialize(o) for o in orgs]}


@app.post("/api/me/organizations/{org_id}/leave")
async def leave_organization(org_id: str, username: str = Depends(require_auth)):
    """主动退出组织。owner 不能退（要先转让 owner 角色）。"""
    from dao_organization import OrganizationDAO, OrganizationMemberDAO
    org = await OrganizationDAO.get(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")
    if org.get('owner_user_id') == username:
        raise HTTPException(status_code=400, detail="owner 不能主动退出，请先转让 owner 角色")
    if not await OrganizationMemberDAO.is_member(org_id, username):
        raise HTTPException(status_code=400, detail="你不是该组织成员")
    await OrganizationMemberDAO.remove_member(org_id, username)
    return {"success": True}

@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...), 
    version_id: Optional[str] = Form(None),
    username: str = Depends(require_auth)
):
    """上传文件并保存到数据库（支持图片和视频）"""
    try:
        # 检查文件大小
        contents = await file.read()
        if len(contents) > SystemConfig.MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="文件太大")
        
        # 检查文件类型
        content_type = file.content_type or ''
        if content_type.startswith('image/'):
            file_type = "image"
        elif content_type.startswith('video/'):
            file_type = "video"
        else:
            # 通过扩展名判断
            ext = Path(file.filename).suffix.lower()
            if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']:
                file_type = "image"
            elif ext in ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv']:
                file_type = "video"
            else:
                raise HTTPException(status_code=400, detail=f"不支持的文件类型: {content_type}")
        
        # 生成文件路径
        file_id = f"file_{uuid.uuid4().hex[:12]}"
        ext = Path(file.filename).suffix
        year_month = datetime.now().strftime('%Y%m')
        storage_dir = Path("persistent_storage") / f"{file_type}s" / username / year_month
        storage_dir.mkdir(parents=True, exist_ok=True)
        file_path = storage_dir / f"{file_id}{ext}"
        
        # 保存物理文件
        file_path.write_bytes(contents)
        file_written = True
        
        # 如果没有提供version_id，获取或创建默认version
        if not version_id:
            # 查找或创建默认项目
            projects = await ProjectDAO.get_user_projects(username)
            if not projects:
                # 创建默认项目
                project_id = f"proj_{uuid.uuid4().hex[:12]}"
                await ProjectDAO.save_or_update_project(
                    user_id=username,
                    project_id=project_id,
                    project_name="默认项目",
                    project_data={},
                    description="自动创建的默认项目"
                )
            else:
                project_id = projects[0]['project_id']
            
            # 获取或创建版本
            versions = await VersionDAO.get_project_versions(project_id)
            if not versions:
                version = await VersionDAO.create_version(
                    project_id=project_id,
                    user_id=username,
                    version_name="默认版本",
                    description="自动创建"
                )
                version_id = version['version_id']
            else:
                version_id = versions[0]['version_id']
        
        # 创建数据库记录（DB失败则回滚物理文件）
        try:
            file_record = await FileDAO.create_file(
                version_id=version_id,
                user_id=username,
                file_type=file_type,
                file_name=file.filename,
                file_path=str(file_path),
                file_url=f"/api/files/{file_id}/download",
                file_size_bytes=len(contents),
                mime_type=content_type or f"{file_type}/*",
                metadata={'source': 'upload_api'},
                file_id=file_id
            )
        except Exception as db_err:
            if file_written:
                try:
                    file_path.unlink(missing_ok=True)
                    logger.info(f"🔄 DB失败，已回滚物理文件: {file_path}")
                except Exception:
                    logger.error(f"⚠️ 回滚物理文件失败: {file_path}")
            raise HTTPException(status_code=500, detail=f"保存文件记录失败: {db_err}")
        
        logger.info(f"✅ 用户 {username} 上传{file_type}: {file.filename}, 文件ID: {file_id}")
        
        return {
            "success": True,
            "file_id": file_record['file_id'],
            "filename": file_record['file_id'],  # 🔧 修复：返回file_id作为filename，Worker可以通过file_id查找文件
            "original_filename": file.filename,
            "storage_url": file_record['file_url'],
            "url": file_record['file_url'],
            "path": str(file_path),
            "file_type": file_type,
            "size": len(contents)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 上传文件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")

@app.post("/api/generate")
async def create_generate_task(request: GenerateRequest, username: str = Depends(require_auth)):
    """创建生成任务"""
    try:
        task_data = request.model_dump()
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
        task_id = await task_service.get().submit(
            request.task_type, task_data, username,
            priority=request.priority, prepare=False
        )
        logger.info(f"用户 {username} 创建任务 {task_id}")
        
        # 获取队列长度
        queue_length = await task_service.get_queue().get_queue_length()
        
        return {
            "success": True,
            "task_id": task_id,
            "message": "任务已加入队列",
            "queue_position": queue_length,
            "estimated_wait_time": queue_length * 60  # 估算等待时间（秒）
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=f"创建任务失败: {str(e)}")

@app.get("/api/task/{task_id}")
async def get_task_status(task_id: str, username: str = Depends(require_auth)):
    """获取任务状态（Redis优先，DB降级）"""
    task = await task_service.get_queue().get_task(task_id)
    
    if task:
        return {
            "task_id": task.task_id,
            "status": task.status.value,
            "progress": task.progress,
            "node_id": task.node_id,
            "result": task.result,
            "error": task.error,
            "created_at": task.created_at,
            "started_at": task.started_at,
            "completed_at": task.completed_at
        }
    
    # Redis无数据时降级查PostgreSQL（任务可能已过期但DB仍有记录）
    if DB_AVAILABLE:
        try:
            db_task = await TaskDAO.get_task_by_task_id(task_id)
            if db_task:
                import json
                result_data = db_task.get("result_data")
                if isinstance(result_data, str):
                    try:
                        result_data = json.loads(result_data)
                    except:
                        pass
                return {
                    "task_id": db_task["task_id"],
                    "status": db_task["status"],
                    "progress": 100 if db_task["status"] == "completed" else 0,
                    "node_id": db_task.get("node_id"),
                    "result": result_data,
                    "error": db_task.get("error_message"),
                    "created_at": str(db_task["created_at"]) if db_task.get("created_at") else None,
                    "started_at": str(db_task["started_at"]) if db_task.get("started_at") else None,
                    "completed_at": str(db_task["completed_at"]) if db_task.get("completed_at") else None,
                    "source": "database"
                }
        except Exception as e:
            logger.warning(f"DB降级查询任务失败: {e}")
    
    raise HTTPException(status_code=404, detail="任务不存在")

@app.delete("/api/task/{task_id}")
async def cancel_task(task_id: str, username: str = Depends(require_auth)):
    """取消任务"""
    success = await task_service.get_queue().cancel_task(task_id)
    
    if not success:
        raise HTTPException(status_code=400, detail="无法取消任务")
    
    logger.info(f"用户 {username} 取消任务 {task_id}")
    
    return {
        "success": True,
        "message": "任务已取消"
    }

@app.delete("/api/task/{task_id}/delete")
async def delete_task(task_id: str, username: str = Depends(require_auth)):
    """彻底删除任务（包括从Redis、数据库和硬盘中删除）"""
    try:
        # 获取任务信息（从Redis）
        task = await task_service.get_queue().get_task(task_id)
        
        # 🔧 如果Redis中没有任务，尝试从数据库获取任务信息
        task_data = None
        if not task and db_manager:
            try:
                from dao_task import TaskDAO
                db_task = await TaskDAO.get_task(task_id)
                if db_task:
                    logger.info(f"✅ 从数据库获取任务信息: {task_id}")
                    task_data = db_task
            except Exception as e:
                logger.warning(f"从数据库获取任务失败: {e}")
        
        # 🔧 从数据库和硬盘删除关联的文件
        deleted_files = []
        
        # 尝试从Redis任务或数据库任务中获取文件信息
        result_data = None
        if task and task.result and isinstance(task.result, dict):
            result_data = task.result
        elif task_data and task_data.get('result_data'):
            # 从数据库任务中获取result
            import json
            result_str = task_data.get('result_data')
            if isinstance(result_str, str):
                try:
                    result_data = json.loads(result_str)
                except:
                    pass
            elif isinstance(result_str, dict):
                result_data = result_str
        
        if result_data and isinstance(result_data, dict):
            videos = result_data.get('videos', [])
            
            for video_info in videos:
                if isinstance(video_info, dict):
                    video_url = video_info.get('url', '')
                    
                    # 从URL中提取文件路径
                    # 格式可能是: /uploads/video/admin/202512/xxx.mp4
                    if video_url.startswith('/uploads/'):
                        file_path = video_url.replace('/uploads/', '').split('?')[0]  # 移除query参数
                        
                        logger.info(f"🗑️ 尝试删除文件: {file_path}")
                        
                        # 1. 删除硬盘上的物理文件
                        possible_paths = [
                            os.path.join('temp', 'uploads', file_path),
                            os.path.join('persistent_storage', file_path),
                            os.path.join('persistent_storage', 'videos', file_path.replace('video/', '')),
                            os.path.join('uploads', file_path),
                        ]
                        
                        for physical_path in possible_paths:
                            if os.path.exists(physical_path):
                                try:
                                    os.remove(physical_path)
                                    logger.info(f"✅ 已删除物理文件: {physical_path}")
                                    deleted_files.append(physical_path)
                                    break
                                except Exception as file_err:
                                    logger.error(f"❌ 删除物理文件失败: {physical_path}, 错误: {file_err}")
                            else:
                                logger.debug(f"物理文件不存在: {physical_path}")
                        
                        # 2. 从数据库软删除文件记录
                        if db_manager:
                            try:
                                result = await db_manager.execute(
                                    """
                                    UPDATE files 
                                    SET is_deleted = TRUE, deleted_at = NOW()
                                    WHERE user_id = $1 
                                    AND file_path LIKE $2
                                    AND is_deleted = FALSE
                                    RETURNING file_id
                                    """,
                                    username,
                                    f"%{file_path}%"
                                )
                                if result:
                                    logger.info(f"✅ 已从数据库标记删除: {file_path}")
                            except Exception as db_err:
                                logger.warning(f"数据库删除文件记录失败: {db_err}")
            
            if deleted_files:
                logger.info(f"✅ 共删除 {len(deleted_files)} 个文件: {deleted_files}")
        
        # 🔧 从数据库删除任务记录（无论Redis中是否存在）
        logger.info(f"🗑️ 尝试从数据库删除任务: {task_id}, db_manager存在: {db_manager is not None}")
        if db_manager:
            try:
                from dao_task import TaskDAO
                logger.info(f"📞 调用 TaskDAO.delete_task({task_id}, {username})")
                db_deleted = await TaskDAO.delete_task(task_id, username)
                logger.info(f"📋 TaskDAO.delete_task 返回结果: {db_deleted}")
                if db_deleted:
                    logger.info(f"✅ 已从数据库删除任务: {task_id}")
                else:
                    logger.warning(f"⚠️ 数据库中未找到任务或无权删除: {task_id}")
            except Exception as db_err:
                logger.error(f"❌ 从数据库删除任务失败: {db_err}", exc_info=True)
        else:
            logger.warning(f"⚠️ 数据库未连接，跳过数据库删除")
        
        # 检查权限（只能删除自己的任务）
        task_owner = None
        if task:
            task_owner = task.user_id
        elif task_data:
            task_owner = task_data.get('user_id')
        
        if task_owner and task_owner != username:
            raise HTTPException(status_code=403, detail="无权删除此任务")
        
        if not task and not task_data:
            # Redis和数据库中都不存在任务，但已尝试从数据库删除
            logger.info(f"任务 {task_id} 不存在，已尝试从数据库删除")
            return {
                "success": True,
                "message": "任务不存在或已删除",
                "deleted_files_count": len(deleted_files)
            }
        
        # 从Redis删除任务（如果存在）
        if task:
            success = await task_service.get_queue().delete_task(task_id)
            if not success:
                logger.warning(f"从Redis删除任务失败，但继续返回成功: {task_id}")
        else:
            logger.info(f"任务在Redis中不存在，跳过Redis删除")
        
        logger.info(f"✅ 用户 {username} 删除任务 {task_id} 完成，共删除 {len(deleted_files)} 个文件")
        
        return {
            "success": True,
            "message": "任务已删除",
            "deleted_files_count": len(deleted_files)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

class SaveVideoTaskRequest(BaseModel):
    """保存视频任务请求"""
    uuid: str
    task_id: str
    task_type: str
    prompt: str
    videos: List[dict]  # [{"url": "...", "filename": "..."}]
    status: str = "completed"
    generate_time: Optional[int] = None  # 生成时间（秒）

class WorkspaceSessionRequest(BaseModel):
    """工作台会话数据请求"""
    task_groups: List[dict]  # TaskManager.taskGroups
    uploaded_images: List[dict]  # TaskManager.uploadedImages
    image_prompts: dict  # TaskManager.imagePrompts
    tasks_status: Optional[dict] = None  # TaskManager.tasksStatus (可选)
    scope: Optional[str] = None  # 会话作用域（如 episode_id:script_id）

@app.post("/api/workspace/save-task")
async def save_video_task(request: SaveVideoTaskRequest, username: str = Depends(require_auth)):
    """保存视频任务到数据库（已废弃，使用session保存）"""
    try:
        # 🔧 video_tasks表已废弃，所有数据都通过workspace/save-session保存
        # 这个接口保留是为了兼容性
        logger.info(f"⚠️ save-task已废弃，请使用save-session接口")
        return {
            "success": True,
            "message": "任务保存已迁移到session系统"
        }
    
    except Exception as e:
        logger.error(f"保存视频任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/workspace/tasks")
async def get_workspace_tasks(username: str = Depends(require_auth)):
    """获取用户的所有工作台任务（已废弃，数据迁移到projects.settings）"""
    try:
        # 🔧 video_tasks表已废弃，所有数据都保存在projects.settings的video_tasks字段中
        # 这个接口保留是为了兼容性，返回空列表
        logger.info(f"✅ workspace任务已迁移到项目系统（返回空列表）")
        return {"tasks": []}
    
    except Exception as e:
        logger.error(f"获取工作台任务失败: {e}")
        return {"tasks": []}

@app.post("/api/workspace/save-session")
async def save_workspace_session(request: WorkspaceSessionRequest, username: str = Depends(require_auth)):
    """保存workspace会话数据到数据库（任务组、上传的图片、提示词）"""
    try:
        session_data = {
            "task_groups": request.task_groups,
            "uploaded_images": request.uploaded_images,
            "image_prompts": request.image_prompts,
            "tasks_status": request.tasks_status or {},
            "updated_at": datetime.now().isoformat()
        }
        scope = request.scope or ""
        
        await WorkspaceSessionDAO.save_session(username, session_data, scope=scope)
        
        logger.info(f"✅ 保存workspace会话到数据库: {username}, scope={scope}, {len(request.task_groups)} 个任务组")
        
        return {
            "success": True,
            "message": "会话已保存"
        }
    
    except Exception as e:
        logger.error(f"保存workspace会话失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/workspace/save-beacon")
async def save_workspace_beacon(request: Request, token: str = Query(...)):
    """sendBeacon 保存端点（页面关闭时使用，比 fetch 更可靠）"""
    try:
        username = jwt_auth.verify_token(token)
        if not username:
            return {"success": False, "message": "token无效"}
        body = await request.json()
        
        # beacon保存项目数据（简化版，保留核心字段）
        if body.get('project_id'):
            project_data = {
                "original_content": body.get('original_content'),
                "script_content": body.get('script_content'),
                "storyboard": body.get('storyboard'),
                "material_library": body.get('material_library'),
            }
            await ProjectDAO.save_or_update_project(
                user_id=username,
                project_id=body['project_id'],
                project_name=body.get('name', '未命名'),
                project_data=project_data
            )
            logger.info(f"📡 Beacon保存项目成功: {username}/{body.get('project_id')}")
        
        return {"success": True}
    except Exception as e:
        logger.warning(f"Beacon保存失败: {e}")
        return {"success": False}

@app.get("/api/workspace/load-session")
async def load_workspace_session(username: str = Depends(require_auth), scope: str = ""):
    """从数据库加载workspace会话数据"""
    try:
        session_data = await WorkspaceSessionDAO.load_session(username, scope=scope)
        
        if not session_data:
            logger.info(f"📭 用户 {username} 没有workspace会话数据")
            return {
                "success": False,
                "session": None
            }
        
        session = {
            "task_groups": session_data.get("task_groups", []),
            "uploaded_images": session_data.get("uploaded_images", []),
            "image_prompts": session_data.get("image_prompts", {}),
            "tasks_status": session_data.get("tasks_status", {})
        }
        
        logger.info(f"✅ 从数据库加载workspace会话: {username}, {len(session['task_groups'])} 个任务组")
        
        return {
            "success": True,
            "session": session
        }
    
    except Exception as e:
        logger.error(f"加载workspace会话失败: {e}", exc_info=True)
        return {
            "success": False,
            "session": None
        }

@app.get("/api/tasks/stream")
async def task_event_stream(request: Request, token: str = Query(...)):
    """SSE 端点：订阅 Redis Pub/Sub 实时推送任务进度和完成/失败通知"""
    username = jwt_auth.verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="未认证")

    async def event_generator():
        # 2026-05-21：用独立 pubsub_redis_client（独立连接池），且把 pubsub 创建/订阅
        # 也包进 try/finally —— 否则 psubscribe 在连接池满时抛 ConnectionError，
        # finally 不会执行，连接泄漏 + 前端拿到 ERR_INCOMPLETE_CHUNKED_ENCODING。
        pubsub = None
        try:
            pubsub = pubsub_redis_client.pubsub()
            await pubsub.psubscribe("task_progress:*")
            await pubsub.subscribe(f"task_complete:{username}", f"task_failed:{username}")

            # 立即推送一个握手事件，让前端知道 SSE 已就绪（前端可据此收敛到 SSE 模式）
            yield "event: ready\ndata: {}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                except (redis.ConnectionError, asyncio.CancelledError):
                    # 连接被砍 / 任务取消 —— 直接退出，让 finally 走 cleanup
                    break
                except Exception as e:
                    logger.warning(f"SSE pubsub get_message 异常: {e}")
                    break

                if message and message['type'] in ('message', 'pmessage'):
                    raw = message['data']
                    if isinstance(raw, bytes):
                        raw = raw.decode('utf-8')
                    try:
                        parsed = json.loads(raw)
                        tid = parsed.get('task_id')
                        if tid:
                            channel = message.get('channel', b'')
                            if isinstance(channel, bytes):
                                channel = channel.decode('utf-8')
                            if channel.startswith(f"task_complete:{username}") or channel.startswith(f"task_failed:{username}"):
                                yield f"data: {raw}\n\n"
                            else:
                                t = await task_service.get_queue().get_task(tid)
                                if t and t.user_id == username:
                                    yield f"data: {raw}\n\n"
                    except Exception:
                        pass
                await asyncio.sleep(0.1)
        except redis.ConnectionError as e:
            # pubsub 连接池满 / Redis 断开 —— 给前端发结构化错误，让它显式降级
            logger.warning(f"SSE pubsub 连接异常（用户 {username}）：{e}")
            try:
                yield f"event: error\ndata: {json.dumps({'reason': 'pubsub_unavailable'})}\n\n"
            except Exception:
                pass
        except Exception as e:
            logger.error(f"SSE event_generator 未预期异常（用户 {username}）：{e}", exc_info=True)
        finally:
            # 任何异常都必须放回连接，否则池会持续泄漏
            if pubsub is not None:
                try:
                    await pubsub.punsubscribe()
                except Exception:
                    pass
                try:
                    await pubsub.unsubscribe()
                except Exception:
                    pass
                try:
                    await pubsub.close()
                except Exception:
                    pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
    )

@app.get("/api/tasks")
async def list_tasks(
    username: str = Depends(require_auth),
    limit: int = 100,
    status: Optional[str] = None
):
    """获取用户任务列表（优先从数据库，降级到Redis）"""
    try:
        # 🆕 优先从数据库获取任务
        if db_manager:
            try:
                from dao_task import TaskDAO
                db_tasks = await TaskDAO.get_user_tasks(username, limit=limit)
                
                # 转换为前端需要的格式
                task_list = []
                for task in db_tasks:
                    # 🆕 解析 JSONB 字段（如果是字符串则解析，如果已是dict则直接使用）
                    import json
                    
                    task_data = task.get('task_data', {})
                    if isinstance(task_data, str):
                        try:
                            task_data = json.loads(task_data)
                        except:
                            task_data = {}
                    
                    result_data = task.get('result_data', {})
                    if isinstance(result_data, str):
                        try:
                            result_data = json.loads(result_data)
                        except:
                            result_data = {}
                    
                    task_list.append({
                        "task_id": task.get('task_id'),
                        "task_type": task.get('task_type'),
                        "status": task.get('status', 'unknown'),
                        "progress": task.get('progress', 0),
                        "result": result_data,  # 🆕 使用解析后的数据
                        "error": task.get('error_message'),
                        "created_at": task.get('created_at').isoformat() if task.get('created_at') else None,
                        "completed_at": task.get('completed_at').isoformat() if task.get('completed_at') else None,
                        "data": task_data  # 🆕 使用解析后的数据
                    })
                
                logger.info(f"✅ 从数据库加载了 {len(task_list)} 个任务")
                
                # 🆕 调试：输出第一个任务的数据结构
                if task_list:
                    logger.info(f"📋 示例任务数据: task_id={task_list[0]['task_id']}, type={task_list[0]['task_type']}, result={type(task_list[0]['result'])}, data={type(task_list[0]['data'])}")
                
                return {
                    "success": True,
                    "tasks": task_list
                }
            except Exception as db_error:
                logger.warning(f"⚠️ 数据库加载失败，降级到Redis: {db_error}")
        
        # 降级到Redis
        tasks = await task_service.get_queue().get_user_tasks(username, limit=limit, status=status)
        
        # 转换为前端需要的格式
        task_list = []
        for task in tasks:
            task_list.append({
                "task_id": task.task_id,
                "task_type": task.task_type,
                "status": task.status.value,
                "progress": task.progress,
                "result": task.result,
                "error": task.error,
                "created_at": task.created_at,
                "completed_at": task.completed_at,
                "data": task.data
            })
        
        logger.info(f"✅ 从Redis加载了 {len(task_list)} 个任务")
        return {
            "success": True,
            "tasks": task_list
        }
    except Exception as e:
        logger.error(f"获取任务列表失败: {e}")
        return {
            "success": False,
            "tasks": []
        }

@app.get("/api/cluster/stats")
async def get_cluster_stats(username: str = Depends(require_auth)):
    """获取集群统计信息。
    2026-05-26 修复：AGENT_ONLY_MODE=true 时 cluster_manager 始终为 None（line 555），
      不做 None-safe 会 AttributeError → FastAPI 返回 plain text "Internal Server Error"
      → 前端 SyntaxError: Unexpected token 'I'。详见 docs/faq.md。
    """
    if cluster_manager is None:
        stats = {
            "nodes": [],
            "healthy_nodes": 0,
            "total_nodes": 0,
            "agent_only_mode": True,
        }
    else:
        stats = cluster_manager.get_cluster_stats()

    try:
        stats["queue_length"] = await task_service.get_queue().get_queue_length()
        stats["processing_count"] = await task_service.get_queue().get_processing_count()
    except Exception as e:
        logger.warning(f"get_cluster_stats: queue stats failed ({e})")
        stats.setdefault("queue_length", 0)
        stats.setdefault("processing_count", 0)
    stats["workers_count"] = len(workers)
    stats["workers_active"] = sum(1 for w in workers if w.current_task)

    return {
        "success": True,
        "stats": stats
    }

@app.get("/api/cluster/nodes")
async def list_nodes(username: str = Depends(require_auth)):
    """获取节点列表。AGENT_ONLY_MODE 下返回空数组（cluster_manager=None 是预期状态）。"""
    if cluster_manager is None:
        return {
            "success": True,
            "nodes": [],
            "agent_only_mode": True,
            "message": "Agent-Only 模式：本地无 ComfyUI 集群节点，任务由外部 Agent 处理",
        }
    stats = cluster_manager.get_cluster_stats()
    return {
        "success": True,
        "nodes": stats["nodes"]
    }

@app.get("/health")
async def health_check():
    """健康检查（AGENT_ONLY_MODE 下 cluster_manager=None 仍正常返回 healthy）"""
    try:
        await redis_client.ping()
        redis_status = "healthy"
    except:
        redis_status = "unhealthy"

    if cluster_manager is None:
        cluster_block = {"healthy_nodes": 0, "total_nodes": 0, "agent_only_mode": True}
    else:
        cs = cluster_manager.get_cluster_stats()
        cluster_block = {"healthy_nodes": cs["healthy_nodes"], "total_nodes": cs["total_nodes"]}

    return {
        "status": "healthy" if redis_status == "healthy" else "degraded",
        "service": SystemConfig.FRONTEND_CONFIG["title"],
        "version": SystemConfig.FRONTEND_CONFIG["version"],
        "redis": redis_status,
        "cluster": cluster_block,
        "workers": {
            "total": len(workers),
            "active": sum(1 for w in workers if w.current_task)
        }
    }

@app.post("/api/comfyui/upload")
async def comfyui_upload_proxy(
    image: UploadFile = File(...),
    node_type: Optional[str] = Form(None),  # 🔧 新增：节点类型参数 (image/video/all)
    comfyui_server: Optional[str] = None,
    username: str = Depends(require_auth)
):
    """
    上传图片：本地持久化(primary) + ComfyUI上传(optional) + SQL记录 + Redis缓存
    
    node_type: 指定上传到哪种类型的节点 (image/video/all)
               - 'video': 上传到video节点（视频生成任务用）
               - 'image': 上传到image节点（图像生成任务用）
               - None/其他: 自动选择可用节点
    """
    try:
        # 1. 读取上传文件
        file_content = await image.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="上传的是空文件")

        orig_filename = image.filename or "upload.png"
        file_ext = os.path.splitext(orig_filename)[1] or ".png"
        # 给这次上传生成一个逻辑上的唯一 ID，用于 SQL 记录
        logical_id = uuid.uuid4().hex[:12]
        unique_filename = f"{logical_id}_{orig_filename}"

        logger.info(
            f"[ComfyUpload] 用户={username}, 原文件={orig_filename}, "
            f"逻辑名={unique_filename}, 大小={len(file_content)} 字节, 节点类型={node_type}"
        )

        # 2. 本地持久化存储（PRIMARY — 始终执行）
        year_month = datetime.now().strftime('%Y%m')
        local_dir = Path('persistent_storage/image') / username / year_month
        local_dir.mkdir(parents=True, exist_ok=True)
        local_path = local_dir / unique_filename
        local_path.write_bytes(file_content)
        local_file_path = str(local_path)
        local_storage_url = f"/storage/image/{username}/{year_month}/{unique_filename}"
        comfyui_filename = unique_filename
        logger.info(f"💾 图片本地存储(primary): {local_path}")

        # 3. 选择 ComfyUI 节点（OPTIONAL — 失败不阻塞）
        target_server = None
        node_id = None

        if comfyui_server:
            target_server = comfyui_server.rstrip("/")
        elif cluster_manager or video_cluster_manager or image_cluster_manager:
            selected_cluster_manager = None
            if node_type == 'video':
                selected_cluster_manager = video_cluster_manager
                node = selected_cluster_manager.get_available_node() if selected_cluster_manager else None
            elif node_type == 'image':
                selected_cluster_manager = image_cluster_manager
                node = selected_cluster_manager.get_available_node() if selected_cluster_manager else None
            else:
                selected_cluster_manager = cluster_manager
                node = selected_cluster_manager.get_available_node() if selected_cluster_manager else None

            if node:
                target_server = node.base_url.rstrip("/")
                node_id = node.id
                logger.info(f"[ComfyUpload] 选择集群节点: {node_id} ({target_server}) [type={node_type}]")
            else:
                logger.warning(f"[ComfyUpload] 没有可用的 {node_type or 'any'} 类型 ComfyUI 节点，跳过上传")
        else:
            target_server = "http://127.0.0.1:8188"
            logger.info(f"[ComfyUpload] 使用默认 ComfyUI: {target_server}")

        # 4. 尝试上传到 ComfyUI（OPTIONAL — 失败仅记录警告）
        if target_server:
            try:
                upload_url = f"{target_server}/upload/image"
                logger.info(f"[ComfyUpload] 转发上传到 ComfyUI: {upload_url}")

                files = {
                    "image": (unique_filename, file_content, image.content_type or "image/png")
                }
                data = {"overwrite": "true"}

                resp = requests.post(upload_url, files=files, data=data, timeout=30)

                if resp.ok:
                    try:
                        rj = resp.json()
                    except Exception:
                        rj = {}

                    if isinstance(rj, dict):
                        if "name" in rj:
                            comfyui_filename = rj["name"]
                        elif "images" in rj and rj["images"]:
                            comfyui_filename = rj["images"][0].get("filename", comfyui_filename)

                    logger.info(
                        f"✅ ComfyUI 图片上传成功: comfyui_filename={comfyui_filename}, "
                        f"server={target_server}"
                    )
                else:
                    logger.warning(
                        f"[ComfyUpload] 上传到 ComfyUI 失败(非致命): {resp.status_code} {resp.text}"
                    )
            except Exception as e:
                logger.warning(f"[ComfyUpload] ComfyUI上传异常(非致命): {e}")
        else:
            logger.info("[ComfyUpload] 无可用ComfyUI节点，仅使用本地存储")

        # 5. 查/建 默认项目 & 版本（SQL，沿用你原来的逻辑）
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
            project_id = projects[0]["project_id"]

        versions = await VersionDAO.get_project_versions(project_id)
        if not versions:
            version = await VersionDAO.create_version(
                project_id=project_id,
                user_id=username,
                version_name="默认版本"
            )
            version_id = version["version_id"]
        else:
            version_id = versions[0]["version_id"]

        # 6. 在 SQL 里创建文件记录（不再有本地 file_path，只记录 ComfyUI 信息）
        file_id = f"file_{uuid.uuid4().hex[:12]}"

        # 如果你现在的 /api/files/{file_id}/download 依赖本地路径，那这个 URL 可以先留着占位，
        # 或者改成你之后要实现的“从 ComfyUI 拉图”的接口地址。
        storage_url = f"/api/files/{file_id}/download"

        file_record = await FileDAO.create_file(
            version_id=version_id,
            user_id=username,
            file_type="image",
            file_name=orig_filename,
            file_path=local_file_path,
            file_url=local_storage_url,
            file_size_bytes=len(file_content),
            mime_type=image.content_type or "image/*",
            metadata={
                "source": "comfyui_upload",
                "logical_id": logical_id,
                "comfyui_filename": comfyui_filename,
                "comfyui_server": target_server,
                "comfyui_node_id": node_id,
                "uploaded_at": datetime.utcnow().isoformat()
            },
            file_id=file_id  # 🔧 传入 file_id
        )

        # 6.5 缓存 filename→file_id 映射到 Redis
        if redis_client:
            try:
                await redis_client.set(f"comfyui:file:{comfyui_filename}", file_id, ex=86400)
            except Exception as e:
                logger.warning(f"[ComfyUpload] Redis缓存写入失败(非致命): {e}")

        logger.info(
            f"✅ 图片记录已写入 SQL: file_id={file_record['file_id']}, "
            f"comfyui_filename={comfyui_filename}"
        )

        # 7. 返回给前端 / 任务系统
        return {
            "success": True,
            # 这个是后续在 workflow 里给 LoadImage 节点用的名字
            "filename": comfyui_filename,
            "original_filename": orig_filename,
            "size": len(file_content),
            # 只是一个占位的下载 URL，看你后续要不要实现
            "storage_url": storage_url,
            "file_id": file_record["file_id"],
            "file_path": local_file_path,
            "comfyui_server": target_server,
            "comfyui_node_id": node_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 图片上传失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")

@app.post("/api/comfyui/upload/video")
async def comfyui_upload_video(
    video: UploadFile = File(...),
    comfyui_server: Optional[str] = None,
    username: str = Depends(require_auth)
):
    """
    上传视频到 ComfyUI + 数据库
    """
    try:
        # 1. 读取上传的文件
        file_content = await video.read()
        
        # 2. 为文件名添加UUID前缀，避免混淆
        file_ext = os.path.splitext(video.filename)[1]
        unique_filename = f"{uuid.uuid4().hex[:12]}_{video.filename}"
        
        logger.info(f"[ComfyUploadVideo] 用户={username}, 原文件={video.filename}, 唯一名={unique_filename}, 大小={len(file_content)} 字节")
        
        # 3. 选择 ComfyUI 节点
        target_server = None
        node_id = None
        
        if comfyui_server:
            target_server = comfyui_server.rstrip("/")
        elif "video_cluster_manager" in globals() and video_cluster_manager:
            # 🆕 视频文件需要视频节点处理，使用视频集群管理器
            node = video_cluster_manager.get_available_node(node_type='video')
            if not node:
                raise HTTPException(status_code=503, detail="没有可用的视频处理节点")
            target_server = node.base_url.rstrip("/")
            node_id = node.id
            logger.info(f"[ComfyUploadVideo] 选择视频集群节点: {node_id} ({target_server})")
        else:
            # 单机模式
            target_server = "http://127.0.0.1:8188"
            logger.info(f"[ComfyUploadVideo] 使用默认 ComfyUI: {target_server}")
        
        # 4. 上传到 ComfyUI 的 /upload/image 接口
        upload_url = f"{target_server}/upload/image"
        logger.info(f"[ComfyUploadVideo] 转发上传到 ComfyUI: {upload_url}")
        
        files = {
            "image": (unique_filename, file_content, video.content_type or "video/mp4")
        }
        data = {"overwrite": "true"}
        
        resp = requests.post(upload_url, files=files, data=data, timeout=60)
        
        if not resp.ok:
            logger.error(f"[ComfyUploadVideo] 上传到 ComfyUI 失败: {resp.status_code} {resp.text}")
            raise HTTPException(
                status_code=502,
                detail=f"上传到 ComfyUI 失败: {resp.status_code}"
            )
        
        # 5. 解析 ComfyUI 返回的文件名
        try:
            rj = resp.json()
        except Exception:
            rj = {}
        
        comfyui_filename = unique_filename  # 兜底
        if isinstance(rj, dict):
            if "name" in rj:
                comfyui_filename = rj["name"]
        
        logger.info(f"✅ ComfyUI 视频上传成功: comfyui_filename={comfyui_filename}, server={target_server}")
        
        # 6. 保存到本地持久化存储（用于备份）
        file_id = f"file_{uuid.uuid4().hex[:12]}"
        year_month = datetime.now().strftime('%Y%m')
        storage_dir = Path("persistent_storage/videos") / username / year_month
        storage_dir.mkdir(parents=True, exist_ok=True)
        file_path = storage_dir / unique_filename
        file_path.write_bytes(file_content)
        
        # 获取或创建默认version
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
            file_type='video',
            file_name=video.filename,
            file_path=str(file_path),
            file_url=f"/api/files/{file_id}/download",
            file_size_bytes=len(file_content),
            mime_type=video.content_type or 'video/*',
            metadata={'source': 'upload', 'physical_filename': unique_filename},
            file_id=file_id  # 🔧 传入 file_id
        )
        
        logger.info(f"✅ 视频已保存到数据库: {file_record['file_url']}, 文件ID: {file_record['file_id']}")
        
        return {
            "success": True,
            "filename": comfyui_filename,  # ComfyUI 中的文件名
            "unique_filename": unique_filename,  # 本地存储的文件名
            "storage_url": file_record['file_url'],
            "original_filename": video.filename,
            "size": len(file_content),
            "file_id": file_record['file_id'],
            "file_path": str(file_path),
            "server": target_server
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ ComfyUI 视频上传请求失败: {e}")
        raise HTTPException(status_code=503, detail=f"无法连接到 ComfyUI 服务器: {str(e)}")
    
    except HTTPException:
        raise
    
    except Exception as e:
        logger.error(f"❌ ComfyUI 视频上传代理失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"上传代理失败: {str(e)}")

@app.post("/api/comfyui/reupload/video")
async def reupload_video_with_uuid(
    filename: str,
    file_type: str = "output",  # output, temp, or input
    comfyui_server: Optional[str] = None,
    username: str = Depends(require_auth)
):
    """
    从ComfyUI或持久化存储下载视频文件，用新的UUID文件名重新上传到input目录
    用于配音、放大等需要引用之前生成的视频的场景
    """
    try:
        # 从集群中选择节点
        if not comfyui_server and video_cluster_manager:
            # 🆕 视频重新上传需要视频节点处理，使用视频集群管理器
            node = video_cluster_manager.get_available_node(node_type='video')
            if node:
                target_server = node.base_url
            else:
                raise HTTPException(status_code=503, detail="没有可用的视频处理节点")
        else:
            target_server = comfyui_server or "http://127.0.0.1:8188"
        
        logger.info(f"用户 {username} 请求重新上传视频: {filename} (从{file_type}目录)")
        
        file_content = None
        
        # 1. 判断文件来源（持久化存储 vs ComfyUI临时文件）
        storage_path = None
        
        # 解析文件路径（参考视频裁剪接口的逻辑）
        if filename.startswith('video/') or filename.startswith('admin/'):
            # video/admin/202512/xxx.mp4 或 admin/202512/xxx.mp4
            video_path_suffix = filename.replace('video/', '')  # 移除video/前缀
            
            possible_paths = [
                os.path.join('temp', 'uploads', 'video', video_path_suffix),
                os.path.join('persistent_storage', 'video', video_path_suffix),
                os.path.join('persistent_storage', 'videos', video_path_suffix),
            ]
            
            for path in possible_paths:
                if os.path.exists(path):
                    storage_path = path
                    logger.info(f"✅ 找到视频文件: {storage_path}")
                    break
                else:
                    logger.debug(f"❌ 路径不存在: {path}")
        
        elif filename.startswith('uploads/video/') or filename.startswith('temp/uploads/video/'):
            # uploads/video/admin/202512/xxx.mp4 -> persistent_storage/videos/admin/202512/xxx.mp4
            path_part = filename.replace('uploads/video/', '').replace('temp/uploads/video/', '')
            storage_path = os.path.join('persistent_storage', 'videos', path_part.replace('\\', '/'))
            logger.info(f"将uploads路径映射到: {storage_path}")
        
        elif 'persistent_storage' in filename:
            storage_path = filename.replace('\\', '/')
        
        elif '/' in filename:
            # 其他带路径的情况，尝试多种可能
            storage_path = os.path.join('persistent_storage', 'videos', filename.replace('\\', '/'))
        
        # 从持久化存储读取
        if storage_path and os.path.exists(storage_path):
            logger.info(f"✅ 从持久化存储读取: {storage_path}")
            with open(storage_path, 'rb') as f:
                file_content = f.read()
            logger.info(f"✅ 读取成功，大小: {len(file_content)} 字节")
        else:
            if storage_path:
                logger.warning(f"❌ 存储路径不存在: {storage_path}")
        
        # 2. 如果持久化存储没找到，尝试从ComfyUI下载
        if file_content is None:
            # 尝试多个目录类型
            for try_type in [file_type, 'temp', 'output', 'input']:
                download_url = f"{target_server}/view?filename={filename}&type={try_type}"
                logger.info(f"尝试从ComfyUI下载: {download_url}")
                response = requests.get(download_url, timeout=30)
                
                if response.ok:
                    file_content = response.content
                    logger.info(f"✅ 从ComfyUI下载视频成功 (type={try_type}): {filename}, 大小: {len(file_content)} 字节")
                    break
                else:
                    logger.warning(f"从ComfyUI {try_type} 目录下载失败: {response.status_code}")
            
            if file_content is None:
                error_msg = f"无法找到视频文件: {filename}。已尝试持久化存储和ComfyUI的 {file_type}/temp/output/input 目录。该文件可能已被清理。请重新生成视频。"
                logger.error(error_msg)
                raise HTTPException(status_code=404, detail=error_msg)
        
        # 2. 生成新的UUID文件名
        import uuid
        file_ext = os.path.splitext(filename)[1]
        unique_filename = f"{uuid.uuid4().hex[:12]}_reuploaded{file_ext}"
        
        # 3. 重新上传到input目录
        files = {
            'image': (unique_filename, file_content, 'video/mp4')
        }
        data = {
            'overwrite': 'true'
        }
        
        upload_url = f"{target_server}/upload/image"
        upload_response = requests.post(upload_url, files=files, data=data, timeout=60)
        
        if not upload_response.ok:
            raise HTTPException(status_code=500, detail="重新上传失败")
        
        result = upload_response.json()
        uploaded_filename = result.get('name', unique_filename)
        
        logger.info(f"✅ 视频重新上传成功: {filename} -> {uploaded_filename}")
        
        return {
            "success": True,
            "original_filename": filename,
            "new_filename": uploaded_filename,
            "size": len(file_content),
            "server": target_server
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 视频重新上传失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload/audio")
async def upload_audio(
    audio: UploadFile = File(...),
    start_time: float = Form(0),
    duration: float = Form(5),
    comfyui_server: Optional[str] = None,
    username: str = Depends(require_auth)
):
    """
    上传音频文件到 ComfyUI
    """
    try:
        # 1. 读取上传的文件
        file_content = await audio.read()
        
        # 2. 为文件名添加UUID前缀，避免混淆
        import uuid
        file_ext = os.path.splitext(audio.filename)[1]
        unique_filename = f"{uuid.uuid4().hex[:12]}_{audio.filename}"
        
        logger.info(
            f"[ComfyUploadAudio] 用户={username}, 原文件={audio.filename}, "
            f"唯一名={unique_filename}, 大小={len(file_content)} 字节, "
            f"剪裁={start_time}s-{start_time+duration}s"
        )
        
        # 3. 选择 ComfyUI 节点
        target_server = None
        node_id = None
        
        if comfyui_server:
            target_server = comfyui_server.rstrip("/")
        elif "video_cluster_manager" in globals() and video_cluster_manager:
            # 🆕 音频文件需要视频节点处理，使用视频集群管理器
            node = video_cluster_manager.get_available_node(node_type='video')
            if not node:
                raise HTTPException(status_code=503, detail="没有可用的视频处理节点")
            target_server = node.base_url.rstrip("/")
            node_id = node.id
            logger.info(f"[ComfyUploadAudio] 选择视频集群节点: {node_id} ({target_server})")
        else:
            # 单机模式
            target_server = "http://127.0.0.1:8188"
            logger.info(f"[ComfyUploadAudio] 使用默认 ComfyUI: {target_server}")
        
        # 4. 上传到 ComfyUI 的 /upload/image 接口
        upload_url = f"{target_server}/upload/image"
        logger.info(f"[ComfyUploadAudio] 转发上传到 ComfyUI: {upload_url}")
        
        files = {
            'image': (unique_filename, file_content, audio.content_type or 'audio/mpeg')
        }
        data = {
            'overwrite': 'true'
        }
        
        resp = requests.post(upload_url, files=files, data=data, timeout=60)
        
        if not resp.ok:
            logger.error(f"[ComfyUploadAudio] 上传到 ComfyUI 失败: {resp.status_code} {resp.text}")
            raise HTTPException(
                status_code=502,
                detail=f"上传到 ComfyUI 失败: {resp.status_code}"
            )
        
        # 5. 解析 ComfyUI 返回的文件名
        try:
            rj = resp.json()
        except Exception:
            rj = {}
        
        comfyui_filename = unique_filename  # 兜底
        if isinstance(rj, dict):
            if "name" in rj:
                comfyui_filename = rj["name"]
        
        logger.info(
            f"✅ ComfyUI 音频上传成功: comfyui_filename={comfyui_filename}, "
            f"原始名={audio.filename}, server={target_server}"
        )
        
        # 本地持久化备份（防止ComfyUI节点重启后文件丢失）
        try:
            year_month = datetime.now().strftime('%Y%m')
            backup_dir = Path('persistent_storage/audio') / username / year_month
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup_path = backup_dir / comfyui_filename
            backup_path.write_bytes(file_content)
            logger.info(f"💾 音频本地备份: {backup_path}")
        except Exception as e:
            logger.warning(f"⚠️ 音频本地备份失败（不影响上传）: {e}")
        
        return {
            "success": True,
            "filename": comfyui_filename,
            "original_filename": audio.filename,
            "size": len(file_content),
            "server": target_server,
            "start_time": start_time,
            "duration": duration
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ ComfyUI 音频上传请求失败: {e}")
        raise HTTPException(status_code=503, detail=f"无法连接到 ComfyUI 服务器: {str(e)}")
    
    except HTTPException:
        raise
    
    except Exception as e:
        logger.error(f"❌ ComfyUI 音频上传代理失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"上传代理失败: {str(e)}")

@app.post("/api/video/crop")
async def crop_video(
    request: CropVideoRequest,
    username: str = Depends(require_auth)
):
    """
    裁剪视频片段
    
    支持的video_filename格式:
    1. file_id: "file_abc123def456" - 从数据库查询文件
    2. ComfyUI文件名: "output.mp4" - 从ComfyUI获取
    3. 完整路径: "video/user/202501/xxx.mp4" - 从持久化存储获取（兼容旧格式）
    """
    import subprocess
    import tempfile
    import shutil
    
    try:
        video_filename = request.video_filename
        start_time = request.start_time
        end_time = request.end_time
        
        logger.info(f"用户 {username} 请求裁剪视频: {video_filename}, {start_time}s-{end_time}s")
        
        # 检查FFmpeg是否可用
        if not shutil.which('ffmpeg'):
            logger.error("FFmpeg未安装")
            raise HTTPException(status_code=500, detail="服务器未安装FFmpeg，无法进行视频剪辑")
        
        # 1. 获取视频文件内容
        file_content = None
        source_info = ""
        original_file_name = "video.mp4"
        
        # 🆕 方式1: 从数据库获取（优先，支持file_id格式）
        if video_filename and video_filename.startswith('file_'):
            # 这是一个file_id
            logger.info(f"从数据库查询文件: {video_filename}")
            file_record = await FileDAO.get_file(video_filename)
            
            if file_record:
                file_path = file_record['file_path']
                original_file_name = file_record['file_name']
                metadata = file_record.get('metadata', {})
                
                logger.info(f"文件记录: path={file_path}, metadata={metadata}")
                
                # 检查是否是ComfyUI存储格式
                if file_path.startswith('comfyui://'):
                    # 格式: comfyui://node_id/filename
                    parts = file_path.replace('comfyui://', '').split('/', 1)
                    comfyui_filename = parts[1] if len(parts) > 1 else metadata.get('comfyui_filename', video_filename)
                    target_server = metadata.get('comfyui_server', 'http://127.0.0.1:8188')
                    
                    logger.info(f"从ComfyUI获取文件: {comfyui_filename} @ {target_server}")
                    
                    # 尝试不同的文件类型
                    for file_type in ['output', 'temp', 'input']:
                        download_url = f"{target_server}/view?filename={comfyui_filename}&type={file_type}"
                        try:
                            response = requests.get(download_url, timeout=30)
                            if response.ok and len(response.content) > 0:
                                file_content = response.content
                                source_info = f"ComfyUI (from DB): {download_url}"
                                logger.info(f"✅ 从ComfyUI获取文件成功, type={file_type}, 大小: {len(file_content)}")
                                break
                        except Exception as e:
                            logger.warning(f"从ComfyUI获取失败 (type={file_type}): {e}")
                            continue
                else:
                    # 本地文件路径
                    if not os.path.isabs(file_path):
                        file_path = os.path.join(os.path.dirname(__file__), file_path)
                    
                    if os.path.exists(file_path):
                        with open(file_path, 'rb') as f:
                            file_content = f.read()
                        source_info = f"本地文件 (from DB): {file_path}"
                        logger.info(f"✅ 从本地文件获取成功, 大小: {len(file_content)}")
                    else:
                        logger.warning(f"文件路径不存在: {file_path}")
            else:
                logger.warning(f"数据库中未找到文件记录: {video_filename}")
        
        # 方式2: 从持久化存储获取（兼容旧格式）
        if file_content is None and video_filename and ('/' in video_filename or '\\' in video_filename):
            logger.info(f"尝试从持久化存储获取: {video_filename}")
            
            storage_path = None
            if video_filename.startswith('video/') or video_filename.startswith('video\\'):
                # 格式: video/admin/202512/xxx.mp4
                # 尝试多个可能的路径
                video_path_suffix = video_filename.replace('video/', '').replace('video\\', '').replace('\\', '/')
                
                possible_paths = [
                    os.path.join('temp', 'uploads', 'video', video_path_suffix),  # temp/uploads/video/admin/202512/xxx.mp4
                    os.path.join('persistent_storage', 'video', video_path_suffix),  # persistent_storage/video/admin/202512/xxx.mp4
                    os.path.join('persistent_storage', 'videos', video_path_suffix),  # persistent_storage/videos/admin/202512/xxx.mp4
                ]
                
                for path in possible_paths:
                    if os.path.exists(path):
                        storage_path = path
                        logger.info(f"✅ 找到视频文件: {storage_path}")
                        break
                    else:
                        logger.debug(f"❌ 路径不存在: {path}")
                
                if not storage_path:
                    logger.warning(f"所有可能的路径都不存在，尝试的路径: {possible_paths}")
            elif video_filename.startswith('uploads/video/') or video_filename.startswith('temp/uploads/video/'):
                # 🆕 兼容旧的uploads路径: uploads/video/admin/202512/xxx.mp4
                # 映射到: persistent_storage/videos/admin/202512/xxx.mp4
                path_part = video_filename.replace('uploads/video/', '').replace('temp/uploads/video/', '')
                storage_path = os.path.join('persistent_storage', 'videos', path_part.replace('\\', '/'))
                logger.info(f"将uploads路径映射到: {storage_path}")
            elif 'persistent_storage' in video_filename:
                storage_path = video_filename.replace('\\', '/')
            else:
                storage_path = os.path.join('persistent_storage', 'videos', video_filename.replace('\\', '/'))
            
            logger.info(f"尝试读取存储路径: {storage_path}")
            
            if storage_path and os.path.exists(storage_path):
                with open(storage_path, 'rb') as f:
                    file_content = f.read()
                source_info = f"持久化存储: {storage_path}"
                original_file_name = os.path.basename(storage_path)
                logger.info(f"✅ 从持久化存储获取成功, 大小: {len(file_content)}")
            else:
                logger.warning(f"存储路径不存在: {storage_path}")
        
        # 方式3: 直接从ComfyUI获取（兼容ComfyUI文件名）
        if file_content is None:
            logger.info(f"尝试直接从ComfyUI获取: {video_filename}")
            
            # 获取ComfyUI节点
            if video_cluster_manager:
                node = video_cluster_manager.get_available_node()
                target_server = node.base_url if node else "http://127.0.0.1:8188"
            elif cluster_manager:
                node = cluster_manager.get_available_node()
                target_server = node.base_url if node else "http://127.0.0.1:8188"
            else:
                target_server = "http://127.0.0.1:8188"
            
            # 从完整路径中提取文件名
            comfyui_filename = video_filename
            if '/' in video_filename or '\\' in video_filename:
                comfyui_filename = video_filename.replace('\\', '/').split('/')[-1]
            
            # 尝试不同的文件类型
            for file_type in ['output', 'temp', 'input']:
                download_url = f"{target_server}/view?filename={comfyui_filename}&type={file_type}"
                try:
                    response = requests.get(download_url, timeout=30)
                    if response.ok and len(response.content) > 0:
                        file_content = response.content
                        source_info = f"ComfyUI: {download_url}"
                        original_file_name = comfyui_filename
                        logger.info(f"✅ 从ComfyUI直接获取成功, type={file_type}, 大小: {len(file_content)}")
                        break
                except Exception as e:
                    logger.warning(f"从ComfyUI获取失败 (type={file_type}): {e}")
                    continue
        
        if file_content is None or len(file_content) == 0:
            logger.error(f"无法找到视频文件: {video_filename}")
            raise HTTPException(status_code=404, detail=f"无法找到视频文件: {video_filename}")
        
        # 2. 使用FFmpeg剪辑视频
        logger.info(f"开始剪辑视频，源文件: {source_info}, 大小: {len(file_content)} bytes")
        
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as input_temp:
            input_temp.write(file_content)
            input_path = input_temp.name
        
        # 从原文件名提取扩展名
        file_ext = '.mp4'
        if '.' in video_filename:
            file_ext = '.' + video_filename.split('.')[-1]
        
        output_filename = f"cropped_{uuid.uuid4().hex[:8]}{file_ext}"
        output_path = os.path.join(tempfile.gettempdir(), output_filename)
        
        try:
            # 使用FFmpeg剪辑
            cmd = [
                'ffmpeg',
                '-i', input_path,
                '-ss', str(start_time),
                '-to', str(end_time),
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-preset', 'fast',
                '-y',
                output_path
            ]
            
            logger.info(f"执行FFmpeg命令: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            
            if result.returncode != 0:
                logger.error(f"FFmpeg剪辑失败，返回码: {result.returncode}")
                logger.error(f"FFmpeg stderr: {result.stderr}")
                logger.error(f"FFmpeg stdout: {result.stdout}")
                raise Exception(f"FFmpeg执行失败 (返回码 {result.returncode}): {result.stderr[:500]}")
            
            # 检查输出文件是否存在
            if not os.path.exists(output_path):
                raise Exception("FFmpeg执行完成但未生成输出文件")
            
            output_size = os.path.getsize(output_path)
            if output_size == 0:
                raise Exception("FFmpeg生成的文件为空")
            
            logger.info(f"✅ FFmpeg剪辑成功，输出文件: {output_path}, 大小: {output_size} bytes")
            
            # 3. 保存剪辑后的视频到数据库
            with open(output_path, 'rb') as f:
                cropped_content = f.read()
            
            # 🆕 生成新的file_id和文件名
            new_file_id = f"file_{uuid.uuid4().hex[:12]}"
            year_month = datetime.now().strftime('%Y%m')
            
            # 保存到本地持久化存储
            storage_dir = Path("persistent_storage/videos") / username / year_month
            storage_dir.mkdir(parents=True, exist_ok=True)
            cropped_filename = f"cropped_{uuid.uuid4().hex[:8]}{file_ext}"
            storage_path = storage_dir / cropped_filename
            storage_path.write_bytes(cropped_content)
            
            logger.info(f"💾 裁剪后的视频已保存到本地: {storage_path}")
            
            # 🆕 获取或创建默认version
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
            
            # 🆕 创建数据库文件记录
            file_record = await FileDAO.create_file(
                version_id=version_id,
                user_id=username,
                file_type='video',
                file_name=cropped_filename,
                file_path=str(storage_path),
                file_url=f"/api/files/{new_file_id}/download",
                file_size_bytes=len(cropped_content),
                mime_type='video/mp4',
                metadata={
                    'source': 'video_crop',
                    'original_video': video_filename,
                    'start_time': start_time,
                    'end_time': end_time,
                    'duration': end_time - start_time,
                    'cropped_at': datetime.utcnow().isoformat()
                },
                file_id=new_file_id
            )
            
            logger.info(f"✅ 裁剪后的视频已保存到数据库: file_id={file_record['file_id']}")
            
            # 返回结果（包含数据库URL）
            return {
                "success": True,
                "file_id": file_record['file_id'],
                "filename": cropped_filename,
                "url": file_record['file_url'],
                "storage_path": str(storage_path),
                "start_time": start_time,
                "end_time": end_time,
                "duration": end_time - start_time,
                "size": len(cropped_content)
            }
            
        finally:
            # 清理临时文件
            try:
                if os.path.exists(input_path):
                    os.unlink(input_path)
                    logger.info(f"清理输入临时文件: {input_path}")
                if os.path.exists(output_path):
                    os.unlink(output_path)
                    logger.info(f"清理输出临时文件: {output_path}")
                temp_save_path_check = os.path.join(SystemConfig.TEMP_DIR, output_filename)
                if os.path.exists(temp_save_path_check):
                    os.unlink(temp_save_path_check)
                    logger.info(f"清理保存临时文件: {temp_save_path_check}")
            except Exception as cleanup_error:
                logger.warning(f"清理临时文件失败: {cleanup_error}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"视频裁剪失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"视频裁剪失败: {str(e)}")

# ⚠️ 已移除旧的 /uploads/{filename} 路由，因为我们使用 app.mount() 挂载静态文件目录
# 这样可以支持多层路径，如 /uploads/image/admin/202512/xxx.png

@app.get("/api/thumbnail")
async def get_thumbnail(
    url: str,
    width: int = 300,
    height: int = 200,
    token: Optional[str] = None,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """动态生成图片缩略图"""
    from PIL import Image
    import io
    
    try:
        username = None
        if credentials:
            username = jwt_auth.verify_token(credentials.credentials)
        if not username and token:
            username = jwt_auth.verify_token(token)
        if not username:
            raise HTTPException(status_code=401, detail="需要登录")
        
        # 解析URL，找到本地文件
        file_path = None
        
        # 处理不同格式的URL
        if url.startswith('/uploads/'):
            # /uploads/image/admin/202512/xxx.png -> temp/uploads/image/admin/202512/xxx.png
            relative_path = url.replace('/uploads/', '')
            file_path = os.path.join('temp', 'uploads', relative_path.split('?')[0])
        elif url.startswith('/storage/'):
            # /storage/images/admin/202512/xxx.png -> persistent_storage/images/admin/202512/xxx.png
            relative_path = url.replace('/storage/', '')
            file_path = os.path.join('persistent_storage', relative_path.split('?')[0])
        elif url.startswith('/api/files/'):
            # /api/files/{file_id}/download -> 从数据库获取文件路径
            parts = url.split('/')
            if len(parts) >= 4:
                file_id = parts[3]
                if db_manager:
                    try:
                        file_record = await FileDAO.get_file(file_id)
                        if file_record:
                            file_path = file_record.get('file_path')
                    except Exception as e:
                        logger.warning(f"从数据库获取文件失败: {e}")
        
        if not file_path or not os.path.exists(file_path):
            logger.warning(f"缩略图文件不存在: {file_path}")
            raise HTTPException(status_code=404, detail="文件不存在")
        
        # 读取并生成缩略图
        with Image.open(file_path) as img:
            # 转换为RGB模式（处理RGBA等）
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            
            # 保持宽高比缩放
            img.thumbnail((width, height), Image.Resampling.LANCZOS)
            
            # 输出为JPEG
            buffer = io.BytesIO()
            img.save(buffer, format='JPEG', quality=75, optimize=True)
            buffer.seek(0)
            
            return Response(
                content=buffer.read(),
                media_type="image/jpeg",
                headers={
                    "Cache-Control": "public, max-age=86400",  # 缓存1天
                    "Content-Disposition": "inline"
                }
            )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成缩略图失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成缩略图失败: {str(e)}")

@app.get("/api/proxy/comfyui/view")
async def proxy_comfyui_view(
    filename: str,
    subfolder: str = "",
    type: str = "output",
    node_id: Optional[str] = None,
    token: Optional[str] = None,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """代理ComfyUI的视频/图片查看接口，避免跨域问题"""
    try:
        username = None
        if credentials:
            username = jwt_auth.verify_token(credentials.credentials)
        if not username and token:
            username = jwt_auth.verify_token(token)
        if not username:
            raise HTTPException(status_code=401, detail="需要登录")
        
        # 优先使用指定的node_id（Worker在生成结果时绑定的节点）
        target_server = None
        if node_id and cluster_manager:
            for n in cluster_manager.nodes:
                if n.id == node_id:
                    target_server = n.base_url
                    logger.info(f"[Proxy] 使用绑定节点: {node_id} ({target_server})")
                    break
        
        if not target_server:
            if cluster_manager:
                node = cluster_manager.get_available_node()
                if node:
                    target_server = node.base_url
                else:
                    target_server = "http://127.0.0.1:8188"
            else:
                target_server = "http://127.0.0.1:8188"
        
        # 构建ComfyUI的URL
        url = f"{target_server}/view"
        params = {
            "filename": filename,
            "type": type
        }
        if subfolder:
            params["subfolder"] = subfolder
        
        logger.info(f"用户 {username} 代理访问ComfyUI文件: {url} params={params}")
        
        # 请求ComfyUI
        response = requests.get(url, params=params, timeout=60, stream=True)
        
        # 智能回退机制
        fallback_attempts = []
        
        # 如果当前类型找不到，依次尝试其他类型
        if response.status_code == 404:
            if params["type"] == "temp":
                fallback_attempts = ["output", "input"]
            elif params["type"] == "output":
                fallback_attempts = ["temp", "input"]
            elif params["type"] == "input":
                fallback_attempts = ["output", "temp"]
            
            for fallback_type in fallback_attempts:
                logger.warning(f"文件在 {params['type']} 中未找到，尝试在 {fallback_type} 中查找: {filename}")
                params["type"] = fallback_type
                response = requests.get(url, params=params, timeout=60, stream=True)
                if response.status_code == 200:
                    logger.info(f"✅ 在 {fallback_type} 中找到文件: {filename}")
                    break
        
        if not response.ok:
            logger.error(f"ComfyUI返回错误: {response.status_code} - {response.text}")
            raise HTTPException(status_code=response.status_code, detail=f"无法获取文件: {response.text}")
        
        # 确定content-type
        content_type = response.headers.get('content-type', 'application/octet-stream')
        logger.info(f"✅ 成功获取文件: {filename}, content-type: {content_type}, size: {response.headers.get('content-length', 'unknown')}")
        
        # 对文件名进行URL编码以支持中文
        from urllib.parse import quote
        encoded_filename = quote(filename)
        
        # 返回文件流
        return StreamingResponse(
            response.iter_content(chunk_size=8192),
            media_type=content_type,
            headers={
                'Content-Disposition': f'inline; filename*=UTF-8\'\'{encoded_filename}',
                'Accept-Ranges': 'bytes'
            }
        )
    
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logger.error(f"代理ComfyUI文件失败: {e}")
        raise HTTPException(status_code=503, detail=f"无法连接到ComfyUI: {str(e)}")
    except Exception as e:
        logger.error(f"代理ComfyUI文件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

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

class ProjectData(BaseModel):
    """项目数据模型 - 支持四个阶段的数据"""
    project_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    user_id: Optional[str] = None
    # 第一阶段：剧本与分镜
    original_content: Optional[str] = None
    script_content: Optional[str] = None
    storyboard: Optional[dict] = None
    extracted_characters: List[str] = Field(default_factory=list)
    extracted_scenes: List[str] = Field(default_factory=list)
    # 第二阶段：素材绑定
    material_selections: Optional[dict] = None
    material_library: Optional[dict] = None
    # 第三阶段：画面生成
    generated_images: Optional[dict] = None
    generation_engine: Optional[str] = "gemini"  # gemini | comfyui
    # 第四阶段：视频生成
    video_tasks: Optional[List[dict]] = None
    # 版本历史（所有阶段共享）
    versions: Optional[List[dict]] = Field(default_factory=list)
    # 元数据
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    stage: int = 1

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

class ExportToVideoRequest(BaseModel):
    """导出到视频生成阶段的请求"""
    selected_items: List[str]  # 选中的分镜ID

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

class ImageGenerationRequest(BaseModel):
    """图像生成请求"""
    engine: str = "gemini"  # gemini | comfyui
    prompt: str
    negative_prompt: Optional[str] = ""
    ref_images: List[str] = Field(default_factory=list)  # 参考图URL列表（最多6张）
    strength: float = 0.75  # 仅ComfyUI使用
    seed: int = -1
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class ComfyUIWorkflowRequest(BaseModel):
    workflow_type: str = Field(..., description="工作流类型: qwen/qwen_lora/kontext")
    prompt: str = Field(..., description="正面提示词")
    negative_prompt: str = Field(default="bad quality, worst quality", description="负面提示词")
    image_filenames: List[str] = Field(..., description="ComfyUI中的图片文件名列表（1-6张）")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class AngleAdjustRequest(BaseModel):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    prompt: str = Field(..., description="角度调整提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class HumanMultiAngleRequest(BaseModel):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class AroundAngleRequest(BaseModel):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    prompt: str = Field(..., description="角度描述提示词，如：front view, eye-level shot, medium shot")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class MattingRequest(BaseModel):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    matting_type: str = Field(..., description="抠图类型: subject(主体脱离)/split(主体背景分离)")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class ImageFusionRequest(BaseModel):
    fusion_type: str = Field(..., description="融合类型: fusion(图像融合)/transfer(迁移学习)/imitation(模仿学习)")
    image_bk: str = Field(..., description="底图/背景图文件名")
    image_hu: str = Field(..., description="人物图文件名")
    image_mb: Optional[str] = Field(default=None, description="蒙版图文件名（仅迁移学习需要）")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class Panorama360Request(BaseModel):
    image_filename: str = Field(..., description="场景素材图片文件名")
    prompt: str = Field(default="", description="全景描述提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class PanoramaFusionRequest(BaseModel):
    image_1: str = Field(..., description="人物/场景图1文件名")
    image_2: Optional[str] = Field(default=None, description="人物图2文件名（可选）")
    image_3: str = Field(..., description="全景截图背景文件名")
    prompt: str = Field(default="", description="融合提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class AutoStoryboardRequest(BaseModel):
    image_filename: str = Field(..., description="输入图片文件名")
    prompt: str = Field(..., description="分镜描述提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

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

class MultiGridStoryboardRequest(BaseModel):
    mode: str = Field(..., description="模式: multi_shot(多镜头分镜) / story(故事分镜)")
    user_prompt: str = Field(..., description="用户输入的提示词")
    reference_image: str = Field(..., description="参考图像（Base64格式，必须传入一张）")
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)

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
    import requests as http_requests
    import base64
    
    try:
        if request.mode not in ['multi_shot', 'story']:
            raise HTTPException(status_code=400, detail=f"不支持的模式: {request.mode}")
        
        if not request.reference_image:
            raise HTTPException(status_code=400, detail="必须传入一张参考图像")
        
        # 检查API Key配置
        if not GEMINI_IMAGE_API_KEY:
            raise HTTPException(status_code=500, detail="图像生成服务未配置，请联系管理员")
        
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
            file_path = Path('persistent_storage') / ref.replace('/storage/', '', 1)
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
        model = "gemini-3.1-flash-image-preview"
        url = f"https://api.laozhang.ai/v1beta/models/{model}:generateContent"
        
        headers = {
            "Authorization": f"Bearer {GEMINI_IMAGE_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {
                    "aspectRatio": "16:9"
                }
            }
        }
        
        response = http_requests.post(url, headers=headers, json=payload, timeout=180)
        response.raise_for_status()
        
        result = response.json()
        images = []
        
        for candidate in result.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                if "inlineData" in part:
                    mime_type = part["inlineData"]["mimeType"]
                    data = part["inlineData"]["data"]
                    images.append(f"data:{mime_type};base64,{data}")
        
        if not images:
            raise HTTPException(status_code=500, detail="多宫格分镜生成未返回结果")
        
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
                    extra_metadata={'prompt': full_prompt[:500], 'model': 'gemini-multi-grid'},
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
                            metadata={'prompt': full_prompt[:500], 'model': 'gemini-multi-grid'},
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
    except Exception as e:
        logger.error(f"多宫格分镜生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))



class MaterialProcessRequest(BaseModel):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    workflow_type: str = Field(..., description="工作流类型: upscale_hd/remove_watermark/three_view")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")

class PromptTemplate(BaseModel):
    """提示词模板"""
    template_type: str = Field(..., description="模板类型: rewrite/storyboard")
    content: str = Field(..., description="提示词内容")

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
# ==================== 提示词模板管理 API ====================

@app.get("/api/prompts/{template_type}")
async def get_prompt_template(template_type: str, username: str = Depends(require_auth)):
    """从数据库获取用户的自定义提示词模板"""
    try:
        # 从数据库加载用户自定义提示词
        custom_content = await PromptTemplateDAO.load_template(username, template_type)
        
        # 如果用户自定义提示词存在，返回自定义的
        if custom_content:
            logger.info(f"✅ 用户 {username} 加载自定义提示词: {template_type}")
            return {
                "success": True,
                "template_type": template_type,
                "content": custom_content,
                "is_custom": True
            }
        
        # 否则返回默认提示词
        default_prompts = {
            "rewrite": """你是一位专业的中文动画编剧。
请将以下小说/文本内容改写成符合行业标准的动画剧本格式。

要求：
1. 准确识别场景（Scene）、角色（Character）、对话（Dialogue）和动作（Action）。
2. 使用标准的剧本格式（场景标题加粗，角色名居中，对话清晰，包含必要的括弧指导）。
3. 增加适合动画制作的视觉描述（画面感）。
4. 保持原著的语气和情节，但要适应视听语言。
5. **必须使用中文输出剧本内容**。

输入文本:
{text}""",
            "storyboard": """请分析以下中文动画剧本，将其拆解为一系列关键镜头（Shot），并返回 JSON。

JSON 结构必须为 {"items": [ ... ]}
每个 item 需要包含以下字段：
- originalText: 对应的原文段落（从剧本中直接复制，用于高亮匹配）
- scriptSegment: AI提炼的场景描述（简洁的场景和动作描述，用于图像生成）
- imagePrompt: 图像生成提示词（英文，适合Stable Diffusion）
- videoPrompt: 视频生成提示词（中文，描述镜头运动和画面）
- dialogue: 人物台词（如果有）
- characters: 出现的角色列表（数组）
- scene: 场景位置（字符串）

重要：originalText 必须是剧本中的原始文本段落，scriptSegment 是你提炼的场景描述。

剧本:
{scriptText}"""
        }
        
        content = default_prompts.get(template_type, "")
        return {
            "success": True,
            "template_type": template_type,
            "content": content,
            "is_custom": False
        }
    
    except Exception as e:
        logger.error(f"获取提示词失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/prompts/{template_type}")
async def save_prompt_template(
    template_type: str, 
    request: PromptTemplate,
    username: str = Depends(require_auth)
):
    """保存用户的自定义提示词模板到数据库"""
    try:
        # 保存到数据库
        await PromptTemplateDAO.save_template(username, template_type, request.content)
        
        logger.info(f"✅ 用户 {username} 保存提示词模板到数据库: {template_type}")
        
        return {
            "success": True,
            "message": "提示词模板已保存",
            "template_type": template_type
        }
    
    except Exception as e:
        logger.error(f"保存提示词失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/prompts/{template_type}")
async def delete_prompt_template(template_type: str, username: str = Depends(require_auth)):
    """从数据库删除用户的自定义提示词模板（恢复默认）"""
    try:
        # 检查模板是否存在
        existing_content = await PromptTemplateDAO.load_template(username, template_type)
        
        if existing_content:
            # 从数据库删除
            await PromptTemplateDAO.delete_template(username, template_type)
            logger.info(f"✅ 用户 {username} 删除提示词模板: {template_type}")
            return {
                "success": True,
                "message": "提示词模板已删除，已恢复为默认"
            }
        else:
            return {
                "success": True,
                "message": "提示词模板不存在（已是默认）"
            }
    
    except Exception as e:
        logger.error(f"删除提示词失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ==================== 管理员API ====================

@app.get("/api/admin/users")
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

@app.put("/api/admin/users/{user_id}/permissions")
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


