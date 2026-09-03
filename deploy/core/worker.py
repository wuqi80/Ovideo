# -*- coding: utf-8 -*-
"""
Worker - 任务处理器
从 Redis 队列获取任务，分配到 ComfyUI 节点执行
"""
import asyncio
import aiohttp
import websockets
import json
import uuid
import logging
import signal
import sys
import os
import base64
import tempfile
import time
from pathlib import Path
from typing import Optional
from datetime import datetime

# 确保能导入当前目录的模块
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from cluster_config import WorkerConfig, ClusterConfig, ComfyUINode, RedisConfig
from cluster_manager import ClusterManager
from task_types import is_external_api_task as shared_is_external_api_task
from task_queue import TaskQueue, Task, TaskStatus

# Long-running TTS polling belongs in the worker so an HTTP proxy timeout cannot
# orphan a provider task owned by the queue.
from minimax_audio import get_minimax_audio_client
from file_service import save_generated_file_to_db
from dao_character_voice import CharacterVoiceDAO

logger = logging.getLogger(__name__)


# Keep provider-backed task ownership centralized. In lite mode these exact
# task families are consumed locally; workflow tasks are requeued for external
# agents. Every new provider task family must extend this catalog and its tests.
EXTERNAL_API_TASK_TYPES_EXACT = frozenset({
    'minimax_i2v', 'minimax_morph', 'minimax_tts',
    'sora2_i2v', 'sora2_morph',
    'veo_i2v', 'veo_morph',
    'wan26_i2v',
    'video_reverse_prompt',
})
EXTERNAL_API_TASK_TYPE_PREFIXES = ('seedance_', 'kling_', 'vidu_', 'happyhorse_')


def is_external_api_task(task_type: str) -> bool:
    """判断是否为外部 API 任务（不需要本地 ComfyUI 节点，由 Worker 直接 HTTP 调用）。

    每次 worker._process_task 调度 + lite-worker 拦截 ComfyUI 任务时都会用到，
    任何新增的外部 API 任务族都必须加进 EXTERNAL_API_TASK_TYPES_EXACT 或 _PREFIXES，
    否则在 AGENT_ONLY_MODE=true（默认）下会被错误地丢回队列给 agent。
    """
    return shared_is_external_api_task(task_type)

# 🆕 导入数据库DAO
try:
    from dao_task import TaskDAO
    from dao_content import FileDAO
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False
    logger.warning("数据库模块未找到，任务将不会持久化到数据库")

class Worker:
    """Worker 任务处理器"""
    
    def __init__(self, worker_id: str, redis_client, cluster_manager: Optional[ClusterManager], task_queue: TaskQueue, video_cluster_manager: Optional[ClusterManager] = None):
        """
        初始化Worker
        :param worker_id: Worker ID
        :param redis_client: Redis客户端
        :param cluster_manager: 默认集群管理器（图像）。AGENT_ONLY_MODE=true 下传 None（lite 模式）。
        :param task_queue: 任务队列
        :param video_cluster_manager: 视频集群管理器（可选）。lite 模式下传 None。

        2026-05-26 Follow-up A：cluster_manager 允许 None — 标记 lite Worker 模式，
        只消费外部 API 任务，ComfyUI workflow 任务会在 _process_task 顶部被重新入队
        让外部 ComfyUI agent 通过 /api/agent/poll 取走。
        """
        self.worker_id = worker_id
        self.redis = redis_client
        # 注意：lite 模式（cluster_manager=None）下，video_cluster_manager 也保持 None，
        # 不再 `or cluster_manager` 兜底 — 否则 self.video_cluster_manager=None 会被静默掩盖。
        self.cluster_manager = cluster_manager  # 默认（图像）集群，可能 None
        self.image_cluster_manager = cluster_manager  # 🆕 图像集群，可能 None
        self.video_cluster_manager = video_cluster_manager if video_cluster_manager is not None else cluster_manager  # 🆕 视频集群（lite 模式两者都 None）
        self.task_queue = task_queue
        # 2026-05-26 lite 模式标识：cluster_manager is None → 只跑外部 API 任务
        self.is_lite = (cluster_manager is None)
        
        self.running = False
        self.current_task: Optional[Task] = None
        self.current_node: Optional[ComfyUINode] = None
        self.current_cluster_manager: Optional[ClusterManager] = None  # 🆕 当前使用的集群管理器
        
        # 集群主节点URL（用于下载持久化存储文件）
        self.cluster_url = os.getenv("CLUSTER_URL", "http://localhost:8000")
        
        # 统计信息
        self.tasks_processed = 0
        self.tasks_failed = 0
        self.start_time = datetime.now()
        
        # 🆕 视频任务类型列表
        self.VIDEO_TASK_TYPES = [
            'i2v',           # 图生视频
            'morph',         # 视频过渡
            'upscale',       # 视频放大
            'voice',         # 配音
            'viedo_upscaler', # 视频放大（拼写变体）
            # 2026-05-24 新增 DashScope 共享视频族（Kling / Vidu / HappyHorse）
            'kling_t2v', 'kling_i2v', 'kling_morph', 'kling_refer',
            'vidu_r2v', 'vidu_morph',
            'happyhorse_r2v',
        ]
    
    async def start(self):
        """启动 Worker"""
        self.running = True
        logger.info(f"Worker {self.worker_id} 启动")
        
        # 注册信号处理
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        # 启动心跳
        asyncio.create_task(self._heartbeat_loop())
        
        # 主循环
        await self._process_loop()
    
    def _signal_handler(self, signum, frame):
        """信号处理"""
        logger.info(f"Worker {self.worker_id} 收到停止信号")
        self.running = False
    
    async def stop(self):
        """停止 Worker"""
        self.running = False
        
        # 等待当前任务完成
        if self.current_task:
            logger.info(f"等待当前任务 {self.current_task.task_id} 完成...")
            await asyncio.sleep(WorkerConfig.GRACEFUL_SHUTDOWN_TIMEOUT)
        
        logger.info(f"Worker {self.worker_id} 已停止")
    
    async def _heartbeat_loop(self):
        """心跳循环"""
        while self.running:
            try:
                await self._send_heartbeat()
                await asyncio.sleep(WorkerConfig.WORKER_HEARTBEAT_INTERVAL)
            except Exception as e:
                logger.error(f"心跳发送失败: {e}")
    
    async def _send_heartbeat(self):
        """发送心跳"""
        try:
            await self.redis.hset(
                WorkerConfig.WORKER_STATUS_KEY,
                self.worker_id,
                json.dumps({
                    "last_heartbeat": datetime.now().isoformat(),
                    "current_task": self.current_task.task_id if self.current_task else None,
                    "tasks_processed": self.tasks_processed,
                    "tasks_failed": self.tasks_failed,
                    "uptime": (datetime.now() - self.start_time).total_seconds()
                })
            )
            await self.redis.expire(WorkerConfig.WORKER_STATUS_KEY, WorkerConfig.WORKER_TIMEOUT)
        except Exception as e:
            logger.error(f"发送心跳失败: {e}")
    
    async def _enqueue_for_gpu_agent(self, task: Task) -> None:
        """Requeue a ComfyUI workflow as an agent-only queue member."""
        task.status = TaskStatus.QUEUED
        task.started_at = None
        task.data = task.data or {}
        await self.task_queue._save_task(task)

        member = json.dumps(
            {
                "task_id": task.task_id,
                "task_type": task.task_type,
                "data": task.data,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        priority_score = task.priority * 1000000 + int(time.time())
        await self.redis.zadd(RedisConfig.TASK_QUEUE_KEY, {member: priority_score})
        logger.info(
            "Lite worker handed ComfyUI task %s to GPU agent queue member (type=%s)",
            task.task_id,
            task.task_type,
        )

    def _get_cluster_manager_for_task(self, task: Task) -> ClusterManager:
        """
        根据任务类型选择集群管理器
        :param task: 任务对象
        :return: 对应的集群管理器
        """
        if task.task_type in self.VIDEO_TASK_TYPES:
            logger.debug(f"任务 {task.task_id} 是视频任务，使用视频集群")
            return self.video_cluster_manager
        else:
            logger.debug(f"任务 {task.task_id} 是图像任务，使用图像集群")
            return self.image_cluster_manager
    
    async def _process_loop(self):
        """处理循环"""
        while self.running:
            try:
                # API Worker 和本地节点 Worker 使用完全独立的 Redis 通道。
                task = await self.task_queue.dequeue(
                    timeout=5,
                    external_only=self.is_lite,
                )
                
                if not task:
                    await asyncio.sleep(1)
                    continue
                
                self.current_task = task
                logger.info(f"Worker {self.worker_id} 开始处理任务 {task.task_id}")
                
                # 处理任务
                success = await self._process_task(task)
                
                if success:
                    self.tasks_processed += 1
                else:
                    self.tasks_failed += 1
                
                self.current_task = None
            
            except Exception as e:
                logger.error(f"处理循环错误: {e}", exc_info=True)
                if self.current_task:
                    await self.task_queue.fail_task(self.current_task.task_id, str(e))
                    self.current_task = None
    
    async def _process_task(self, task: Task) -> bool:
        """处理单个任务"""
        try:
            # ============================================
            # 2026-05-26 Follow-up A: lite Worker 守卫
            #   lite 模式（cluster_manager=None, 由 AGENT_ONLY_MODE=true 启动）
            #   只跑外部 API 任务；ComfyUI workflow 任务必须被丢回队列让外部 agent 取走。
            #   注意：dequeue 已经 zpopmin 把任务取走 + processing 队列 + DB 状态置 processing，
            #   所以这里要"完整放回"：重写 enqueue 走标准 task_queue.enqueue 路径，
            #   不能只 zadd 队列、不然 processing 队列 / DB 状态会 stale。
            # ============================================
            if self.is_lite and not is_external_api_task(task.task_type):
                # 2026-06-15：防死循环。无 ComfyUI agent 在线时，lite worker 会反复
                # 「弹回队列→3s 后又自己取回」无限循环（刷爆日志、空耗 CPU）。这里给任务
                # 记弹回次数，超过阈值（≈60s 仍无 agent 接管）即判失败并给可执行提示，
                # 而不是无限重投。有 agent 时它会在前几次 poll 内取走，计数到不了阈值。
                task.data = task.data or {}
                bounces = int(task.data.get('_lite_bounce', 0)) + 1
                try:
                    await self.redis.zrem(RedisConfig.PROCESSING_QUEUE_KEY, task.task_id)
                except Exception as e:
                    logger.warning(f"清理 processing 队列残留失败 {task.task_id}: {e}")
                task.data['_lite_bounce'] = bounces
                logger.info(
                    f"🪶 lite Worker {self.worker_id} 跳过非外部 API 任务 {task.task_id} "
                    f"(type={task.task_type})，丢回队列由 ComfyUI agent 接管 [{bounces}]"
                )
                await self._enqueue_for_gpu_agent(task)
                # 给 agent 留出 poll 窗口（agent 3s 间隔 poll）；避免 worker 抢回同一个任务造成抖动
                await asyncio.sleep(3)
                return True

            # 🆕 任务开始时记录到数据库
            if DB_AVAILABLE:
                try:
                    await TaskDAO.create_task(
                        task_id=task.task_id,
                        user_id=task.user_id,
                        task_type=task.task_type,
                        task_data=task.data
                    )
                    await TaskDAO.update_task_status(
                        task_id=task.task_id,
                        status='processing'
                    )
                    logger.debug(f"✅ 任务 {task.task_id} 已记录到数据库")
                except Exception as e:
                    logger.warning(f"记录任务到数据库失败: {e}")
            
            # 检查是否为外部 API 任务（不需要ComfyUI节点）
            if task.task_type in ['minimax_i2v', 'minimax_morph']:
                return await self._process_minimax_task(task)
            elif task.task_type in ['sora2_i2v', 'sora2_morph']:
                return await self._process_sora2_task(task)
            elif task.task_type in ['veo_i2v', 'veo_morph']:
                return await self._process_veo_task(task)
            elif task.task_type in ['wan26_i2v']:
                return await self._process_wan26_task(task)
            elif task.task_type.startswith('seedance_'):
                return await self._process_seedance_task(task)
            elif (
                task.task_type.startswith('kling_')
                or task.task_type.startswith('vidu_')
                or task.task_type.startswith('happyhorse_')
            ):
                return await self._process_dashscope_video_task(task)
            elif task.task_type == 'minimax_tts':
                return await self._process_minimax_tts_task(task)
            elif task.task_type == 'video_reverse_prompt':
                # 2026-05-26 Slice 3: 视频反推走自己的流水线（ffmpeg + Vision LLM）
                return await self._process_video_reverse_task(task)
            
            # 🆕 根据任务类型选择集群管理器
            cluster_mgr = self._get_cluster_manager_for_task(task)
            self.current_cluster_manager = cluster_mgr  # 保存用于释放
            
            # 获取可用节点（支持等待队列）
            # 🔧 等待可用节点，最多尝试30次（约60秒）
            max_wait_attempts = 30
            wait_interval = 2  # 每次等待2秒
            node = None
            
            for attempt in range(max_wait_attempts):
                node = cluster_mgr.get_available_node()
                if node:
                    break
                
                if attempt == 0:
                    task_category = "视频" if task.task_type in self.VIDEO_TASK_TYPES else "图像"
                    logger.info(f"⏳ 没有空闲的{task_category}节点，任务 {task.task_id} 等待中... (最多等待{max_wait_attempts * wait_interval}秒)")
                    # 更新任务状态为等待中
                    task.progress = 0.0
                    await self.task_queue.update_progress(task.task_id, 0.0, "等待可用节点...")
                
                await asyncio.sleep(wait_interval)
            
            if not node:
                task_category = "视频" if task.task_type in self.VIDEO_TASK_TYPES else "图像"
                logger.info(f"🔄 等待超时，任务 {task.task_id} 放回队列稍后重试...")
                await self.task_queue.requeue_task(task.task_id)
                return True  # 返回True表示处理成功（任务已放回队列），不增加失败计数
            
            # 获取节点
            if not cluster_mgr.acquire_node(node.id):
                logger.info(f"🔄 节点 {node.id} 刚被占用，任务 {task.task_id} 放回队列等待...")
                await self.task_queue.requeue_task(task.task_id)
                return True
            
            self.current_node = node
            task.node_id = node.id
            
            try:
                # 处理图片：从SQL/本地文件读取并上传到ComfyUI
                # 🔧 跳过已经在ComfyUI中的文件（i2i_fj, i2i_human, i2i_around, upscale_hd等任务）
                skip_upload_tasks = ['i2i_fj', 'i2i_human', 'i2i_around', 'upscale_hd', 'image_upscale', 'remove_watermark', 'three_view']
                should_skip = task.task_type in skip_upload_tasks or task.task_type.startswith('qwen_') or task.task_type.startswith('qwenN_') or task.task_type.startswith('kontext')
                
                if "image_path" in task.data and not should_skip:
                    image_path = task.data["image_path"]
                    uploaded_filename = await self._upload_file_to_comfyui(image_path, node)
                    if uploaded_filename:
                        task.data["uploaded_image"] = uploaded_filename
                        logger.info(f"✅ 首帧图片已上传到ComfyUI: {uploaded_filename}")
                    else:
                        logger.warning(f"⚠️ 图片上传失败，使用原路径: {image_path}")
                        task.data["uploaded_image"] = image_path
                
                if "image_path_end" in task.data:
                    image_path_end = task.data["image_path_end"]
                    uploaded_filename_end = await self._upload_file_to_comfyui(image_path_end, node)
                    if uploaded_filename_end:
                        task.data["uploaded_image_end"] = uploaded_filename_end
                        logger.info(f"✅ 尾帧图片已上传到ComfyUI: {uploaded_filename_end}")
                    else:
                        logger.warning(f"⚠️ 尾帧上传失败，使用原路径: {image_path_end}")
                        task.data["uploaded_image_end"] = image_path_end
                
                # 处理视频放大任务 - 从本地文件读取并上传到 ComfyUI input
                if task.task_type == "upscale" and "video_filename" in task.data:
                    video_filename = task.data['video_filename']
                    logger.info(f"📹 视频放大任务，文件名: {video_filename}")
                    
                    uploaded_name = await self._upload_file_to_comfyui(video_filename, node, is_video=True)
                    if uploaded_name:
                        task.data['video_filename'] = uploaded_name
                        logger.info(f"✅ 视频已上传到ComfyUI: {uploaded_name}")
                    else:
                        # 如果上传失败，尝试从ComfyUI下载（提取纯文件名）
                        logger.warning(f"⚠️ 从本地上传失败，尝试从ComfyUI获取")
                        import requests, tempfile, os
                        
                        # 🆕 提取纯文件名（去除路径前缀）
                        pure_filename = video_filename
                        if '/' in video_filename or '\\' in video_filename:
                            pure_filename = video_filename.replace('\\', '/').split('/')[-1]
                        
                        file_content = None
                        for file_type in ['output', 'temp', 'input']:
                            try:
                                download_url = f"{node.base_url}/view?filename={pure_filename}&type={file_type}"
                                response = requests.get(download_url, timeout=60)
                                if response.status_code == 200 and len(response.content) > 0:
                                    file_content = response.content
                                    logger.info(f"✅ 从ComfyUI下载成功: {pure_filename} (type={file_type})")
                                    break
                            except Exception as e:
                                logger.warning(f"从{file_type}下载失败: {e}")
                        
                        if not file_content:
                            raise FileNotFoundError(
                                f"无法获取视频: {video_filename}\n"
                                f"  - 本地路径查找失败\n"
                                f"  - ComfyUI查找失败 (尝试了文件名: {pure_filename})"
                            )
                        
                        # 重新上传到ComfyUI
                        temp_path = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
                        temp_path.write(file_content)
                        temp_path.close()
                        
                        try:
                            with open(temp_path.name, 'rb') as f:
                                files = {'image': (pure_filename, f, 'video/mp4')}
                                response = requests.post(f"{node.base_url}/upload/image", files=files, timeout=60)
                                if response.status_code == 200:
                                    task.data['video_filename'] = response.json().get('name', pure_filename)
                                    logger.info(f"✅ 视频重新上传成功: {task.data['video_filename']}")
                        finally:
                            os.unlink(temp_path.name)
                
                # i2i_fj 图像角度调整任务：使用ComfyUI中已有的文件名
                if task.task_type == "i2i_fj":
                    if "image_path" in task.data:
                        # image_path就是ComfyUI中的文件名，直接使用
                        task.data["uploaded_image"] = task.data["image_path"]
                        logger.info(f"✅ i2i_fj使用ComfyUI文件: {task.data['image_path']}")
                    else:
                        raise ValueError("i2i_fj任务缺少image_path参数")

                # 🆕 i2i_human 多角度人物生成任务：使用ComfyUI中已有的文件名
                if task.task_type == "i2i_human":
                    if "image_path" in task.data:
                        # image_path就是ComfyUI中的文件名，直接使用
                        task.data["uploaded_image"] = task.data["image_path"]
                        logger.info(f"✅ i2i_human使用ComfyUI文件: {task.data['image_path']}")
                    else:
                        raise ValueError("i2i_human任务缺少image_path参数")

                # 🆕 i2i_around 全景角度生成任务：使用ComfyUI中已有的文件名
                if task.task_type == "i2i_around":
                    if "image_path" in task.data:
                        task.data["uploaded_image"] = task.data["image_path"]
                        logger.info(f"✅ i2i_around使用ComfyUI文件: {task.data['image_path']}")
                    else:
                        raise ValueError("i2i_around任务缺少image_path参数")

                # 素材处理任务（高清放大、去水印、三视图）
                if task.task_type in ['upscale_hd', 'image_upscale', 'remove_watermark', 'three_view']:
                    if "image_path" in task.data:
                        task.data["uploaded_image"] = task.data["image_path"]
                        logger.info(f"✅ {task.task_type}使用ComfyUI文件: {task.data['image_path']}")
                    else:
                        raise ValueError(f"{task.task_type}任务缺少image_path参数")

                # qwen/qwen_lora/kontext/qwenN/qwenN_lora 系列任务：使用ComfyUI中已有的文件名
                if (task.task_type.startswith('qwen_') or 
                    task.task_type.startswith('qwenN_') or 
                    task.task_type.startswith('qwenN_lora_') or
                    task.task_type.startswith('kontext')):
                    # 处理 image_path_1 ~ image_path_6（都是ComfyUI中的文件名）
                    for i in range(1, 7):
                        path_key = f'image_path_{i}'
                        if path_key in task.data and task.data[path_key]:
                            # 直接使用文件名，不需要再上传
                            task.data[f'uploaded_image_{i}'] = task.data[path_key]
                            logger.info(f"✅ {task.task_type} - image_{i} 使用ComfyUI文件: {task.data[path_key]}")
                    
                    # 如果有单个image_path字段（kontext可能用这个）
                    if 'image_path' in task.data and task.data['image_path']:
                        task.data['uploaded_image'] = task.data['image_path']
                        logger.info(f"✅ {task.task_type} - image 使用ComfyUI文件: {task.data['image_path']}")

                # 🆕 抠图任务
                if task.task_type in ['matting_subject', 'matting_split']:
                    if "image_path" in task.data:
                        task.data["uploaded_image"] = task.data["image_path"]
                        logger.info(f"✅ {task.task_type}使用ComfyUI文件: {task.data['image_path']}")
                    else:
                        raise ValueError(f"{task.task_type}任务缺少image_path参数")

                # 🆕 融合任务（image_fusion, image_transfer, pose_imitation）
                if task.task_type in ['image_fusion', 'image_transfer', 'pose_imitation']:
                    if "image_BK" in task.data:
                        task.data["uploaded_image_BK"] = task.data["image_BK"]
                        logger.info(f"✅ {task.task_type} - image_BK: {task.data['image_BK']}")
                    if "image_HU" in task.data:
                        task.data["uploaded_image_HU"] = task.data["image_HU"]
                        logger.info(f"✅ {task.task_type} - image_HU: {task.data['image_HU']}")
                    if "image_MB" in task.data:
                        task.data["uploaded_image_MB"] = task.data["image_MB"]
                        logger.info(f"✅ {task.task_type} - image_MB: {task.data['image_MB']}")

                # 🆕 分镜弹窗任务（panorama_360, panorama_fusion, auto_storyboard）
                if task.task_type == 'panorama_360':
                    if "image_path" in task.data:
                        task.data["uploaded_image"] = task.data["image_path"]
                        logger.info(f"✅ panorama_360使用ComfyUI文件: {task.data['image_path']}")
                    else:
                        raise ValueError("panorama_360任务缺少image_path参数")

                if task.task_type.startswith('panorama_fusion'):
                    for i in range(1, 4):
                        key = f'image_{i}'
                        if key in task.data:
                            task.data[f'uploaded_image_{i}'] = task.data[key]
                            logger.info(f"✅ {task.task_type} - image_{i}: {task.data[key]}")

                if task.task_type == 'auto_storyboard':
                    if "image_path" in task.data:
                        task.data["uploaded_image"] = task.data["image_path"]
                        logger.info(f"✅ auto_storyboard使用ComfyUI文件: {task.data['image_path']}")

                # 🔧 调试：打印 task.data 中的图片相关字段
                image_fields = {k: v for k, v in task.data.items() if 'image' in k.lower()}
                logger.info(f"🔍 构建工作流前 task.data 图片字段: {image_fields}")
                
                # 构建工作流
                workflow = self._build_workflow(task)
                
                # 提交工作流
                prompt_id = await self._submit_workflow(node, workflow)
                task.prompt_id = prompt_id
                
                logger.info(f"任务 {task.task_id} 已提交到节点 {node.id}, prompt_id: {prompt_id}")
                
                # 监控进度
                result = await self._monitor_progress(node, prompt_id, task)
                
                if result:
                    # 任务成功
                    await self.task_queue.complete_task(task.task_id, result)
                    logger.info(f"任务 {task.task_id} 完成")
                    return True
                else:
                    # 任务失败
                    await self.task_queue.fail_task(task.task_id, "生成失败", retry=True)
                    return False
            
            finally:
                # 🆕 使用正确的集群管理器释放节点
                if hasattr(self, 'current_cluster_manager') and self.current_cluster_manager:
                    self.current_cluster_manager.release_node(node.id)
                else:
                    # 回退到默认集群管理器
                    self.cluster_manager.release_node(node.id)
                self.current_node = None
                self.current_cluster_manager = None
        
        except Exception as e:
            logger.error(f"处理任务 {task.task_id} 失败: {e}", exc_info=True)
            await self.task_queue.fail_task(task.task_id, str(e), retry=True)
            return False
    
    async def _upload_image(self, node: ComfyUINode, image_path: str) -> str:
        """上传图片到 ComfyUI 节点"""
        try:
            url = f"{node.base_url}/upload/image"
            
            # 读取图片文件
            file_path = Path(image_path)
            if not file_path.exists():
                raise FileNotFoundError(f"图片文件不存在: {image_path}")
            
            # 使用 multipart/form-data 上传
            data = aiohttp.FormData()
            data.add_field('image',
                          open(file_path, 'rb'),
                          filename=file_path.name,
                          content_type='image/png')
            data.add_field('overwrite', 'true')
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, data=data, timeout=30) as response:
                    if response.status == 200:
                        result = await response.json()
                        filename = result.get('name', file_path.name)
                        logger.info(f"图片上传成功: {filename}")
                        return filename
                    else:
                        error = await response.text()
                        raise Exception(f"上传失败: {error}")
        
        except Exception as e:
            logger.error(f"上传图片失败: {e}")
            raise

    async def _prepare_comfy_image(self, node: ComfyUINode, image_value: str) -> str:
        """根据值（base64或文件名）准备可供工作流使用的图片"""
        if not image_value:
            raise ValueError("缺少参考图")
        if image_value.startswith('data:'):
            return await self._upload_base64_image(node, image_value)
        return image_value

    async def _upload_base64_image(self, node: ComfyUINode, data_url: str) -> str:
        """将Base64图片上传到ComfyUI并返回文件名"""
        try:
            if ',' in data_url:
                header, encoded = data_url.split(',', 1)
                mime = header.split(':')[1].split(';')[0] if ':' in header else 'image/png'
            else:
                encoded = data_url
                mime = 'image/png'
            suffix = f".{mime.split('/')[-1] or 'png'}"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(base64.b64decode(encoded))
            tmp.flush()
            tmp.close()
            try:
                return await self._upload_image(node, tmp.name)
            finally:
                if os.path.exists(tmp.name):
                    os.unlink(tmp.name)
        except Exception as e:
            logger.error(f"Base64 图片上传失败: {e}")
            raise
    
    def _build_workflow(self, task: Task) -> dict:
        """构建 ComfyUI 工作流"""
        from workflow_handler import get_workflow_handler
        
        workflow_handler = get_workflow_handler()
        
        # 使用工作流处理器构建工作流
        # 工作流会自动替换 {prompt}, {seed}, {seed_1}, {image} 等占位符
        workflow = workflow_handler.build_workflow_for_task(task.task_type, task.data)
        
        logger.info(f"✅ 工作流构建完成: task_type={task.task_type}")
        return workflow
    
    async def _submit_workflow(self, node: ComfyUINode, workflow: dict) -> str:
        """提交工作流到 ComfyUI"""
        try:
            url = f"{node.base_url}/prompt"
            
            payload = {
                "prompt": workflow,
                "client_id": self.worker_id
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, timeout=30) as response:
                    if response.status == 200:
                        result = await response.json()
                        prompt_id = result.get('prompt_id')
                        return prompt_id
                    else:
                        error = await response.text()
                        raise Exception(f"提交工作流失败: {error}")
        
        except Exception as e:
            logger.error(f"提交工作流失败: {e}")
            raise
    
    async def _monitor_progress(self, node: ComfyUINode, prompt_id: str, task: Task, timeout: int = 600) -> Optional[dict]:
        """监控任务进度（通过 WebSocket）"""
        try:
            ws_url = f"{node.ws_url}?clientId={self.worker_id}"
            
            # 跟踪采样节点进度
            sampler_nodes = {}  # {node_id: {"current": 0, "total": 0, "max_progress": 0}}
            sampler_order = []  # 记录采样节点的执行顺序
            max_total_progress = 10.0  # 全局最大进度，确保只增不减
            
            async with websockets.connect(ws_url) as websocket:
                start_time = asyncio.get_event_loop().time()
                
                # 初始设置为 10% 进度
                await self.task_queue.update_progress(task.task_id, 10.0, "正在加载模型...")
                max_total_progress = 10.0
                
                while True:
                    # 检查超时
                    if asyncio.get_event_loop().time() - start_time > timeout:
                        logger.warning(f"任务 {task.task_id} 超时")
                        return None
                    
                    # 检查任务是否被取消
                    current_task = await self.task_queue.get_task(task.task_id)
                    if current_task and current_task.status == TaskStatus.CANCELLED:
                        logger.info(f"任务 {task.task_id} 已取消，中断执行")
                        await self._interrupt_task(node, prompt_id)
                        return None
                    
                    try:
                        # 接收消息
                        message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                        
                        # 跳过二进制消息
                        if isinstance(message, bytes):
                            continue
                        
                        data = json.loads(message)
                        msg_type = data.get('type')
                        
                        # 处理节点执行消息
                        if msg_type == 'executing':
                            node_id = data.get('data', {}).get('node')
                            
                            if node_id is None:
                                # 执行完成
                                logger.info(f"任务 {task.task_id} 执行完成，获取结果...")
                                await self.task_queue.update_progress(task.task_id, 95.0, "正在保存结果...")
                                result = await self._get_result(node, prompt_id)
                                return result
                        
                        # 处理进度消息（核心）
                        elif msg_type == 'progress':
                            progress_data = data.get('data', {})
                            value = progress_data.get('value', 0)
                            max_value = progress_data.get('max', 100)
                            node_id = progress_data.get('node')
                            
                            if max_value > 0 and node_id:
                                # 第一次遇到这个采样节点
                                if node_id not in sampler_nodes:
                                    sampler_nodes[node_id] = {
                                        "current": 0,
                                        "total": max_value,
                                        "max_progress": 0
                                    }
                                    sampler_order.append(node_id)
                                    logger.info(f"检测到采样节点 #{len(sampler_order)}: {node_id}, 总步数: {max_value}")
                                
                                # 更新当前节点进度
                                sampler_nodes[node_id]["current"] = value
                                
                                # 找到当前节点的索引
                                try:
                                    current_sampler_index = sampler_order.index(node_id)
                                except ValueError:
                                    current_sampler_index = 0
                                
                                # 计算总进度（假设最多2个采样节点）
                                # 进度分配：10% (开始) + 80% (采样) + 10% (保存)
                                # 如果有2个采样节点，每个占40%
                                
                                total_samplers = max(len(sampler_order), 2)
                                progress_per_sampler = 80.0 / total_samplers
                                
                                # 计算已完成的采样节点的进度
                                completed_progress = current_sampler_index * progress_per_sampler
                                
                                # 计算当前节点的进度
                                current_node_progress = (value / max_value) * progress_per_sampler
                                
                                # 总进度 = 10% (初始) + 已完成节点 + 当前节点进度
                                total_progress = 10.0 + completed_progress + current_node_progress
                                
                                # 确保进度只增不减
                                if total_progress > max_total_progress:
                                    max_total_progress = total_progress
                                    sampler_nodes[node_id]["max_progress"] = current_node_progress
                                    
                                    # 限制最大90%
                                    total_progress = min(90.0, total_progress)
                                    
                                    message_text = f"采样器 {current_sampler_index + 1}/{total_samplers} - 步骤 {value}/{max_value}"
                                    
                                    await self.task_queue.update_progress(task.task_id, total_progress, message_text)
                                    logger.info(f"任务 {task.task_id} 进度: {total_progress:.1f}% - {message_text}")
                        
                        # 执行成功
                        elif msg_type == 'execution_success':
                            logger.info(f"任务 {task.task_id} 执行成功")
                        
                        # 执行错误
                        elif msg_type == 'execution_error':
                            error_data = data.get('data', {})
                            error_msg = error_data.get('exception_message', '未知错误')
                            logger.error(f"任务 {task.task_id} 执行错误: {error_msg}")
                            return None
                    
                    except asyncio.TimeoutError:
                        continue
                    except Exception as e:
                        logger.error(f"处理 WebSocket 消息失败: {e}")
                        continue
        
        except Exception as e:
            logger.error(f"监控进度失败: {e}")
            return None
    
    async def _get_result(self, node: ComfyUINode, prompt_id: str) -> Optional[dict]:
        """获取任务结果"""
        try:
            url = f"{node.base_url}/history/{prompt_id}"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=30) as response:
                    if response.status == 200:
                        history = await response.json()
                        
                        if prompt_id not in history:
                            return None
                        
                        outputs = history[prompt_id].get('outputs', {})
                        
                        # 查找输出
                        result = {
                            "images": [],
                            "videos": []
                        }
                        
                        for node_id, node_output in outputs.items():
                            # 处理图片
                            if 'images' in node_output:
                                for img in node_output['images']:
                                    filename = img['filename']
                                    subfolder = img.get('subfolder', '')
                                    
                                    # 保存图片到本地和SQL
                                    saved_info = await self._save_result_file(
                                        node=node,
                                        filename=filename,
                                        subfolder=subfolder,
                                        file_type='image',
                                        prompt_id=prompt_id
                                    )
                                    
                                    if saved_info:
                                        result["images"].append(saved_info)
                                    else:
                                        proxy_url = f"/api/proxy/comfyui/view?filename={filename}&subfolder={subfolder}&type=output&node_id={node.id}"
                                        result["images"].append({
                                            "filename": filename,
                                            "subfolder": subfolder,
                                            "url": proxy_url
                                        })
                            
                            # 处理视频（videos）
                            if 'videos' in node_output:
                                for vid in node_output['videos']:
                                    filename = vid['filename']
                                    subfolder = vid.get('subfolder', '')
                                    file_type = vid.get('type', 'output')
                                    
                                    # 保存视频到本地和SQL
                                    saved_info = await self._save_result_file(
                                        node=node,
                                        filename=filename,
                                        subfolder=subfolder,
                                        file_type='video',
                                        prompt_id=prompt_id,
                                        comfyui_file_type=file_type
                                    )
                                    
                                    if saved_info:
                                        result["videos"].append(saved_info)
                                    else:
                                        proxy_url = f"/api/proxy/comfyui/view?filename={filename}&subfolder={subfolder}&type={file_type}&node_id={node.id}"
                                        result["videos"].append({
                                            "filename": filename,
                                            "subfolder": subfolder,
                                            "url": proxy_url
                                        })
                            
                            # 处理GIF/视频（gifs）- ComfyUI的VHS节点使用gifs字段
                            if 'gifs' in node_output:
                                for vid in node_output['gifs']:
                                    filename = vid['filename']
                                    subfolder = vid.get('subfolder', '')
                                    
                                    # 保存视频到本地和SQL（尝试output和temp两种类型）
                                    saved_info = await self._save_result_file(
                                        node=node,
                                        filename=filename,
                                        subfolder=subfolder,
                                        file_type='video',
                                        prompt_id=prompt_id,
                                        comfyui_file_type='output',
                                        try_types=['output', 'temp']
                                    )
                                    
                                    if saved_info:
                                        result["videos"].append(saved_info)
                                    else:
                                        proxy_url = f"/api/proxy/comfyui/view?filename={filename}&subfolder={subfolder}&type=output&node_id={node.id}"
                                        result["videos"].append({
                                            "filename": filename,
                                            "subfolder": subfolder,
                                            "url": proxy_url
                                        })
                        
                        logger.info(f"✅ 获取结果成功: {len(result['images'])} 张图片, {len(result['videos'])} 个视频")
                        
                        # 如果没有结果，记录详细信息
                        if not result["images"] and not result["videos"]:
                            logger.warning(f"⚠️ 任务完成但没有输出结果。outputs: {outputs}")
                        
                        return result
                    else:
                        return None
        
        except Exception as e:
            logger.error(f"获取结果失败: {e}")
            return None
    
    async def _interrupt_task(self, node: ComfyUINode, prompt_id: str):
        """中断 ComfyUI 任务"""
        try:
            url = f"{node.base_url}/interrupt"
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, timeout=10) as response:
                    if response.status == 200:
                        logger.info(f"已中断任务 {prompt_id}")
                    else:
                        logger.warning(f"中断任务失败: {response.status}")
        
        except Exception as e:
            logger.error(f"中断任务失败: {e}")
    
    async def _process_minimax_task(self, task: Task) -> bool:
        """处理 MiniMax API 任务"""
        try:
            from minimax_api import get_minimax_client
            from external_api.video.minimax import normalize_minimax_generation_options, normalize_minimax_status
            
            minimax_client = get_minimax_client()
            
            # 提取参数
            first_frame_image = task.data.get('first_frame_image')
            prompt = task.data.get('prompt', '')
            last_frame_image = task.data.get('last_frame_image')  # 仅morph模式有此参数
            
            requested_model = task.data.get('minimax_model') or task.data.get('model_name') or None
            requested_duration, requested_resolution = normalize_minimax_generation_options(
                task.data.get('duration'),
                task.data.get('minimax_resolution'),
            )
            requested_prompt_optimizer = task.data.get('minimax_prompt_optimizer')
            if isinstance(requested_prompt_optimizer, str):
                requested_prompt_optimizer = requested_prompt_optimizer.strip().lower() not in {'0', 'false', 'no', 'off'}
            elif requested_prompt_optimizer is None:
                requested_prompt_optimizer = True
            else:
                requested_prompt_optimizer = bool(requested_prompt_optimizer)

            if not first_frame_image:
                raise ValueError("缺少 first_frame_image 参数")

            first_frame_image = await self._file_id_to_dashscope_url(
                first_frame_image,
                label="minimax_first_frame",
            )
            if last_frame_image:
                last_frame_image = await self._file_id_to_dashscope_url(
                    last_frame_image,
                    label="minimax_last_frame",
                )
            
            # 创建视频生成任务
            logger.info(f"🎬 创建 MiniMax 任务: {task.task_type}")
            create_result = minimax_client.generate_video(
                first_frame_image=first_frame_image,
                prompt=prompt,
                last_frame_image=last_frame_image,
                model=requested_model,
                duration=requested_duration,
                resolution=requested_resolution,
                prompt_optimizer=requested_prompt_optimizer,
            )
            
            minimax_task_id = create_result.get('task_id')
            if not minimax_task_id:
                raise ValueError("未获取到 MiniMax task_id")
            
            logger.info(f"✅ MiniMax 任务已创建: {minimax_task_id}")
            
            # 等待任务完成（带进度更新）
            logger.info(f"⏳ 等待 MiniMax 任务完成...")
            start_time = time.time()
            max_wait = 600
            poll_interval = 5
            
            while time.time() - start_time < max_wait:
                try:
                    result = minimax_client.query_task(minimax_task_id)
                    status = normalize_minimax_status(result)
                    
                    if status in {'success', 'succeeded'}:
                        logger.info(f"✅ MiniMax 任务完成: {minimax_task_id}")
                        complete_result = result
                        break
                    elif status in {'fail', 'failed', 'expired'}:
                        if result.get('error_message'):
                            raise RuntimeError(f"MiniMax task failed: {result.get('error_message')}")
                        error_msg = result.get('base_resp', {}).get('status_msg', '未知错误')
                        raise RuntimeError(f"MiniMax 任务失败: {error_msg}")
                    elif status == 'processing':
                        # 更新进度到Redis
                        progress = min(int((time.time() - start_time) / max_wait * 90), 90)
                        await self.task_queue.update_progress(task.task_id, progress)
                        logger.info(f"⏳ MiniMax 任务处理中: {minimax_task_id}, 进度: {progress}%")
                    
                    await asyncio.sleep(poll_interval)
                except RuntimeError:
                    raise
                except Exception as e:
                    logger.error(f"❌ MiniMax 轮询失败: {e}")
                    await asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"MiniMax 任务超时: {minimax_task_id}")
            
            file_id = complete_result.get('file_id')
            if not file_id:
                raise ValueError("未获取到 file_id")
            
            # 下载视频
            logger.info(f"📥 下载 MiniMax 视频: {file_id}")
            video_content = minimax_client.download_video(str(file_id))
            
            # 保存视频到本地和SQL
            logger.info(f"💾 保存MiniMax视频...")
            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source='minimax'
            )
            
            if saved_info:
                result = {
                    "videos": [saved_info],
                    "images": []
                }
                await self.task_queue.complete_task(task.task_id, result)
                logger.info(f"✅ MiniMax 任务完成: {task.task_id}")
                return True
            else:
                raise Exception("保存视频失败")
        
        except Exception as e:
            logger.error(f"❌ MiniMax 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "minimax")
                task_error = vendor_user_facing_error(e, "minimax")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "MiniMax non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        str(getattr(response, "text", "") or "")[:300],
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, str(e))
            return False
    
    async def _process_sora2_task(self, task: Task) -> bool:
        """处理 Sora2 API 任务"""
        try:
            from sora2_api import get_sora2_client
            import tempfile
            from pathlib import Path
            
            sora2_client = get_sora2_client()
            
            # 提取参数
            image_path = task.data.get('image_path')
            image_path_end = task.data.get('image_path_end')  # 仅morph模式有此参数
            prompt = task.data.get('prompt', '')
            
            if not image_path:
                raise ValueError("缺少 image_path 参数")
            
            # 从uploads或ComfyUI下载图片到临时文件
            temp_image_path = None
            temp_image_path_end = None
            
            try:
                # 下载首帧图片
                logger.info(f"📥 下载首帧图片: {image_path}")
                temp_image_path = await self._download_image_to_temp(image_path)
                
                # 如果是首尾帧模式，处理两张图片
                if task.task_type == 'sora2_morph' and image_path_end:
                    logger.info(f"📥 下载尾帧图片: {image_path_end}")
                    temp_image_path_end = await self._download_image_to_temp(image_path_end)
                    
                    # 拼合两张图片
                    logger.info(f"🔄 拼合首尾帧图片...")
                    merged_bytes = sora2_client.merge_images_vertical(temp_image_path, temp_image_path_end)
                    
                    # 保存拼合后的图片
                    merged_temp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
                    merged_temp.write(merged_bytes)
                    merged_temp.close()
                    temp_image_path = merged_temp.name
                    logger.info(f"✅ 图片拼合完成: {temp_image_path}")
                
                # 创建视频生成任务
                logger.info(f"🎬 创建 Sora2 任务: {task.task_type}")
                create_result = sora2_client.create_video_task(
                    prompt=prompt,
                    image_path=temp_image_path,
                    size="1280x704",
                    seconds="15"
                )
                
                sora2_video_id = create_result.get('id')
                if not sora2_video_id:
                    raise ValueError("未获取到 Sora2 video_id")
                
                logger.info(f"✅ Sora2 任务已创建: {sora2_video_id}")
                
                # 等待任务完成（带进度更新）
                logger.info(f"⏳ 等待 Sora2 任务完成...")
                start_time = time.time()
                max_wait = 600
                poll_interval = 5
                
                while time.time() - start_time < max_wait:
                    try:
                        result = sora2_client.query_task(sora2_video_id)
                        status = result.get('status', '')
                        progress_value = result.get('progress', 0)
                        
                        if status == 'completed':
                            logger.info(f"✅ Sora2 任务完成: {sora2_video_id}")
                            complete_result = result
                            break
                        elif status == 'failed':
                            error = result.get('error', {})
                            error_msg = error.get('message', '未知错误')
                            raise RuntimeError(f"Sora2 任务失败: {error_msg}")
                        else:
                            # 更新进度到Redis
                            progress = max(progress_value, int((time.time() - start_time) / max_wait * 90))
                            await self.task_queue.update_progress(task.task_id, min(progress, 90))
                            logger.info(f"⏳ Sora2 任务处理中: {status}, 进度: {progress}%")
                        
                        await asyncio.sleep(poll_interval)
                    except Exception as e:
                        logger.error(f"❌ Sora2 轮询失败: {e}")
                        await asyncio.sleep(poll_interval)
                else:
                    raise TimeoutError(f"Sora2 任务超时: {sora2_video_id}")
                
                # 下载视频
                logger.info(f"📥 下载 Sora2 视频: {sora2_video_id}")
                video_content = sora2_client.download_video(sora2_video_id)
                
                # 保存到持久化存储
                temp_file = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False)
                temp_file.write(video_content)
                temp_file.close()
                
                # 保存视频到本地和SQL
                logger.info(f"💾 保存Sora2视频...")
                saved_info = await self._save_external_video(
                    video_content=video_content,
                    task=task,
                    source='sora2'
                )
                
                if saved_info:
                    result = {
                        "videos": [saved_info],
                        "images": []
                    }
                    await self.task_queue.complete_task(task.task_id, result)
                    logger.info(f"✅ Sora2 任务完成: {task.task_id}")
                    return True
                else:
                    # 没有持久化存储，返回临时路径
                    result = {
                        "videos": [{
                            "url": f"/temp/{Path(temp_path).name}",
                            "filename": Path(temp_path).name
                        }],
                        "images": []
                    }
                    await self.task_queue.complete_task(task.task_id, result)
                    logger.info(f"✅ Sora2 任务完成（临时存储）: {task.task_id}")
                    return True
            
            finally:
                # 清理临时图片文件
                for temp_path in [temp_image_path, temp_image_path_end]:
                    if temp_path:
                        try:
                            import os
                            os.unlink(temp_path)
                        except:
                            pass
        
        except Exception as e:
            logger.error(f"❌ Sora2 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "sora2")
                task_error = vendor_user_facing_error(e, "sora2")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "Sora2 non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        str(getattr(response, "text", "") or "")[:300],
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, str(e))
            return False

    async def _process_seedance_task(self, task: Task) -> bool:
        """
        处理 Seedance 2.0 任务，task_type ∈ {seedance_t2v, _i2v, _morph, _multi, _draft}。
        从 task.data 取 sub_model / media_inputs / 7 参数 / prompt，组装 contents 数组提交。
        """
        try:
            from seedance_api import get_seedance_client
            client = get_seedance_client()

            sub_model = task.data.get('sub_model', 'standard')
            model_scope = task.data.get('model_scope') or 'workflow'
            prompt = task.data.get('prompt') or ''
            media_inputs = task.data.get('media_inputs') or []

            # 组装 contents 数组（火山官方约定：text + image_url/video_url/audio_url）
            contents = []
            if prompt:
                contents.append({"type": "text", "text": prompt})

            for idx, m in enumerate(media_inputs):
                kind = (m.get('kind') or '').lower()
                role = m.get('role')  # None / first_frame / last_frame / reference_image / reference_video / reference_audio
                # 火山 Ark 服务端会主动 fetch image_url/video_url/audio_url，无法访问内网
                # /storage?token= 预览 URL（会 400 InvalidParameter）。复用 DashScope 同款解析器
                # 把本地文件 / 分镜图(sb_) / token URL 还原成 Base64 data URI；公网 URL 透传。
                src = m.get('file_id') or m.get('url')
                if not src:
                    continue
                resolved = await self._file_id_to_dashscope_url(src, label=f"seedance_{kind or 'media'}_{idx}")
                if kind == 'image':
                    item = {"type": "image_url", "image_url": {"url": resolved}}
                elif kind == 'video':
                    item = {"type": "video_url", "video_url": {"url": resolved}}
                elif kind == 'audio':
                    item = {"type": "audio_url", "audio_url": {"url": resolved}}
                else:
                    logger.warning(f"⚠️ Seedance 未知 media kind: {kind}, skip")
                    continue
                if role:
                    item["role"] = role
                contents.append(item)

            # 样片任务 ID（draft）—— 仅 1.5pro 支持，2.0 调用会被服务端拒绝；保留代码路径
            if task.task_type == 'seedance_draft':
                draft_id = task.data.get('draft_task_id')
                if draft_id:
                    contents.append({"type": "draft_task", "draft_task": {"id": draft_id}})

            if not contents:
                raise ValueError("Seedance 任务无任何 prompt 或 media，无法生成")

            # Validate again at execution time for legacy/imported queue items.
            # Unsupported specifications must never be silently downgraded after
            # the user has accepted a price for a different resolution.
            from services.video_credit_pricing import validate_seedance_generation_options
            validate_seedance_generation_options(task.data)

            # 7 参数
            kwargs = dict(
                resolution=task.data.get('resolution'),
                ratio=task.data.get('ratio') or 'adaptive',
                duration=task.data.get('duration'),
                seed=task.data.get('seed', -1),
                watermark=bool(task.data.get('watermark', False)),
                generate_audio=bool(task.data.get('generate_audio', True)),
                camera_fixed=bool(task.data.get('camera_fixed', False)),
                tools=task.data.get('tools') or None,
            )
            ark_task_id = client.create_video_task(sub_model, contents, usage_scope=model_scope, **kwargs)
            await self.task_queue.update_progress(task.task_id, 5, "Seedance 任务已创建")

            # 轮询任务状态（最长 600s）
            start_time = time.time()
            max_wait = 600
            poll_interval = 5
            video_url = None
            last_status = ''
            while time.time() - start_time < max_wait:
                try:
                    result = client.query_task(ark_task_id)
                    status = (result.get('status') or '').lower()
                    last_status = status
                    if status == 'succeeded':
                        content = result.get('content') or {}
                        video_url = content.get('video_url')
                        if not video_url:
                            raise ValueError(f"Seedance 任务成功但缺 video_url: {result}")
                        break
                    elif status in ('failed', 'cancelled'):
                        err = result.get('error') or {}
                        raise RuntimeError(f"Seedance 任务{status}: {err.get('message') or err}")
                    else:
                        progress = int((time.time() - start_time) / max_wait * 90)
                        await self.task_queue.update_progress(task.task_id, min(progress, 90), f"Seedance: {status}")
                        logger.info(f"⏳ Seedance 任务 {ark_task_id} 状态: {status}")
                except (ValueError, RuntimeError):
                    raise
                except Exception as e:
                    logger.error(f"❌ Seedance 轮询失败: {e}")
                await asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"Seedance 任务超时: {ark_task_id} (last_status={last_status})")

            # 下载视频并保存（_save_external_video 已经 entity-aware）
            video_content = client.download_video(video_url)
            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source='seedance',
            )
            if not saved_info:
                raise RuntimeError("Seedance 视频保存失败")

            await self.task_queue.complete_task(task.task_id, {
                "videos": [saved_info],
                "images": [],
            })
            logger.info(f"✅ Seedance 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Seedance 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    seedance_error_is_non_retryable,
                    seedance_user_facing_error,
                )

                non_retryable = seedance_error_is_non_retryable(e)
                task_error = seedance_user_facing_error(e)
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "Seedance non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        str(getattr(response, "text", "") or "")[:300],
                    )
                    try:
                        from services.api_provider_health_monitor import cache_provider_health_result
                        from services.api_provider_runtime import resolve_seedance_model_name

                        failed_model = resolve_seedance_model_name(
                            task.data.get("sub_model", "standard"),
                            usage_scope=task.data.get("model_scope") or "workflow",
                        )
                        await cache_provider_health_result(
                            {
                                "provider": "seedance",
                                "model_name": failed_model,
                                "status": "error",
                                "success": False,
                                "message": task_error,
                                "health": {
                                    "ok": False,
                                    "real_generation": True,
                                    "error": task_error,
                                },
                            }
                        )
                    except Exception as cache_error:
                        logger.debug("Seedance provider health cache update skipped: %s", cache_error)
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, str(e))
            return False

    async def _download_image_to_temp(self, image_path: str) -> str:
        """
        下载图片到临时文件
        
        Args:
            image_path: 图片路径（uploads文件名或ComfyUI文件名）
        
        Returns:
            临时文件路径
        """
        import tempfile
        import requests
        
        # 尝试从uploads目录下载
        try:
            if '/' not in image_path:
                # 简单文件名，尝试从uploads下载
                url = f"{self.cluster_url}/uploads/{image_path}"
                logger.info(f"从uploads下载: {url}")
                response = requests.get(url, timeout=30)
                if response.status_code == 200:
                    temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
                    temp_file.write(response.content)
                    temp_file.close()
                    return temp_file.name
        except Exception as e:
            logger.warning(f"从uploads下载失败: {e}")
        
        # 尝试从ComfyUI下载
        try:
            node = self.cluster_manager.get_available_node() if self.cluster_manager else None
            if node:
                url = f"{node.base_url}/view?filename={image_path}&type=input"
                logger.info(f"从ComfyUI下载: {url}")
                response = requests.get(url, timeout=30)
                if response.status_code == 200:
                    temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
                    temp_file.write(response.content)
                    temp_file.close()
                    return temp_file.name
        except Exception as e:
            logger.warning(f"从ComfyUI下载失败: {e}")

        # 作为 file_id 从数据库解析（外部 API 模型 sora2/veo 前端传的是 file_id 而非
        # uploads 文件名；本函数原只认 uploads/ComfyUI，导致 sora2/veo i2v 永远
        # "无法下载图片"。与 wan26/dashscope 对齐，用 FileDAO 还原本地物理文件）
        try:
            rec = await FileDAO.get_file(image_path)
            if not rec:
                rec = await FileDAO.get_file_by_name(image_path)
            fp = Path(rec['file_path']) if rec and rec.get('file_path') else None
            if fp and fp.exists():
                temp_file = tempfile.NamedTemporaryFile(suffix=(fp.suffix or '.png'), delete=False)
                temp_file.write(fp.read_bytes())
                temp_file.close()
                logger.info(f"✅ 从 file_id 解析图片: {image_path} -> {fp.name}")
                return temp_file.name
        except Exception as e:
            logger.warning(f"file_id 解析图片失败: {e}")

        raise FileNotFoundError(f"无法下载图片: {image_path}")
    
    async def _process_veo_task(self, task: Task) -> bool:
        """处理 Veo API 任务"""
        try:
            from veo_api import get_veo_client
            import tempfile
            from pathlib import Path
            
            veo_client = get_veo_client()
            
            # 提取参数
            image_path = task.data.get('image_path')
            image_path_end = task.data.get('image_path_end')
            prompt = task.data.get('prompt', '')
            
            # 构建图片URL列表（base64 data URI，不依赖公网地址。
            # 旧实现用 cluster_url/uploads/<临时文件名> 拼 URL，但临时文件在系统
            # Temp 目录而非 uploads，外部网关 fetch 必 404 → 任务静默失败）
            import base64
            image_urls = []

            def _temp_to_data_uri(path: str) -> str:
                with open(path, 'rb') as f:
                    return f"data:image/png;base64,{base64.b64encode(f.read()).decode('utf-8')}"

            if image_path:
                # 下载首帧图片到临时文件，转 base64 data URI
                temp_image_path = await self._download_image_to_temp(image_path)
                image_urls.append(_temp_to_data_uri(temp_image_path))

            if task.task_type == 'veo_morph' and image_path_end:
                # 下载尾帧
                temp_image_path_end = await self._download_image_to_temp(image_path_end)
                image_urls.append(_temp_to_data_uri(temp_image_path_end))
            
            # 创建视频生成任务
            logger.info(f"🎬 创建 Veo 任务: {task.task_type}, {len(image_urls)}张图片")
            create_result = veo_client.create_video_task(
                prompt=prompt,
                image_urls=image_urls if image_urls else None,
                model="veo-3.1-landscape-fast-fl"
            )
            
            veo_video_id = create_result.get('id')
            if not veo_video_id:
                raise ValueError("未获取到 Veo video_id")
            
            logger.info(f"✅ Veo 任务已创建: {veo_video_id}")
            
            # 等待任务完成（带进度更新）
            logger.info(f"⏳ 等待 Veo 任务完成...")
            start_time = time.time()
            max_wait = 600
            poll_interval = 5
            
            while time.time() - start_time < max_wait:
                try:
                    result = veo_client.query_task(veo_video_id)
                    status = result.get('status', '')
                    
                    if status == 'completed':
                        logger.info(f"✅ Veo 任务完成: {veo_video_id}")
                        complete_result = result
                        break
                    elif status == 'failed':
                        error = result.get('error', {})
                        error_msg = error.get('message', '未知错误')
                        raise RuntimeError(f"Veo 任务失败: {error_msg}")
                    else:
                        # 更新进度到Redis
                        progress = min(int((time.time() - start_time) / max_wait * 90), 90)
                        await self.task_queue.update_progress(task.task_id, progress)
                        logger.info(f"⏳ Veo 任务处理中: {status}, 进度: {progress}%")
                    
                    await asyncio.sleep(poll_interval)
                except Exception as e:
                    logger.error(f"❌ Veo 轮询失败: {e}")
                    await asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"Veo 任务超时: {veo_video_id}")
            
            # 获取视频内容
            logger.info(f"📥 获取 Veo 视频内容...")
            content_result = veo_client.get_video_content(veo_video_id)
            video_url = content_result.get('url')
            
            if not video_url:
                raise ValueError("未获取到视频URL")
            
            # 下载视频
            logger.info(f"📥 下载 Veo 视频: {video_url}")
            video_content = veo_client.download_video(video_url)
            
            # 保存到持久化存储
            temp_file = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False)
            temp_file.write(video_content)
            temp_file.close()
            
            # 保存视频到本地和SQL
            logger.info(f"💾 保存Veo视频...")
            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source='veo'
            )
            
            if saved_info:
                result = {
                    "videos": [saved_info],
                    "images": []
                }
                await self.task_queue.complete_task(task.task_id, result)
                logger.info(f"✅ Veo 任务完成: {task.task_id}")
                return True
            else:
                result = {
                    "videos": [{
                        "url": f"/temp/{Path(temp_path).name}",
                        "filename": Path(temp_path).name
                    }],
                    "images": []
                }
                await self.task_queue.complete_task(task.task_id, result)
                logger.info(f"✅ Veo 任务完成（临时存储）: {task.task_id}")
                return True
        
        except Exception as e:
            logger.error(f"❌ Veo 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "veo")
                task_error = vendor_user_facing_error(e, "veo")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "Veo non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        str(getattr(response, "text", "") or "")[:300],
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, str(e))
            return False


    async def _save_external_video(
        self,
        video_content: bytes,
        task: Task,
        source: str,
    ):
        """
        保存外部 API（MiniMax/Sora2/Veo/Wan26/Seedance）下载的视频到本地和 SQL。

        Entity-aware 改造：从 task.data 取 entity_type / entity_id / file_role / episode_id
        （由 cluster_main /api/generate 路由透传），传给 FileDAO.create_file 完成 entity
        绑定后再调 _sync_legacy_on_file_create，自动把 video_url 同步到 video_segments
        表，修复 sora2/veo/minimax/wan26 任务完成后 video_segments.video_url 永远不更新
        的历史漏洞。
        """
        import os
        import uuid
        from pathlib import Path
        from datetime import datetime

        try:
            user_id = task.user_id if task else "system"
            task_id = task.task_id if task else f"{source}_{uuid.uuid4().hex[:8]}"

            # 创建目录结构: persistent_storage/video/{user_id}/{year_month}/
            year_month = datetime.now().strftime('%Y%m')
            upload_dir = Path('persistent_storage/video') / user_id / year_month
            upload_dir.mkdir(parents=True, exist_ok=True)

            # 生成唯一文件名
            unique_filename = f"{source}_{uuid.uuid4().hex[:12]}.mp4"
            local_path = upload_dir / unique_filename

            # 写入文件
            local_path.write_bytes(video_content)
            logger.info(f"💾 视频已保存到本地: {local_path}, 大小: {len(video_content)} bytes")

            # 构建访问URL（持久化存储）
            file_url = f"/storage/video/{user_id}/{year_month}/{unique_filename}"

            # 从 task.data 提取 entity 绑定参数（由前端透传到 cluster_main 再到 worker）
            task_data = (task.data or {}) if task else {}
            entity_type = task_data.get('entity_type')
            entity_id = task_data.get('entity_id')
            file_role = task_data.get('file_role') or 'video'
            project_id = task_data.get('project_id')

            # 保存到数据库
            file_record = None
            if DB_AVAILABLE:
                try:
                    version_id = task_data.get('version_id') if task else None
                    file_record = await FileDAO.create_file(
                        version_id=version_id,
                        user_id=user_id,
                        file_type='video',
                        file_name=unique_filename,
                        file_path=str(local_path),
                        file_url=file_url,
                        file_size_bytes=len(video_content),
                        mime_type='video/mp4',
                        metadata={
                            'task_id': task_id,
                            'source': source,
                            'task_type': task.task_type if task else source,
                            'project_id': project_id,
                            'episode_id': task_data.get('episode_id'),
                        },
                        entity_type=entity_type,
                        entity_id=entity_id,
                        file_role=file_role,
                    )
                    logger.info(
                        f"📝 文件已记录到数据库: file_id={file_record['file_id']} "
                        f"entity={entity_type}/{entity_id}/{file_role}"
                    )

                    # 关键：触发 legacy 字段同步（自动 UPDATE video_segments.video_url）
                    if entity_type and entity_id and file_role:
                        try:
                            from file_service import _sync_legacy_on_file_create
                            await _sync_legacy_on_file_create(entity_type, entity_id, file_role, file_url)
                            logger.info(f"🔁 legacy 字段已同步: {entity_type}/{entity_id}/{file_role}")
                        except Exception as e:
                            logger.warning(f"⚠️ legacy 字段同步失败（不致命）: {e}")

                    # 2026-05-26 Slice 1 收尾：同步进通用素材库（best-effort）
                    try:
                        import media_library_service
                        # source 推断：task.task_type 已是 comfyui_video / dashscope_video / seedance_video 等
                        ttype = (task.task_type if task else (source or 'video')).lower()
                        if 'comfy' in ttype:
                            mlib_source = 'generated_video_comfyui'
                        elif 'dashscope' in ttype or 'wanx' in ttype:
                            mlib_source = 'generated_video_dashscope'
                        elif 'seedance' in ttype:
                            mlib_source = 'generated_video_seedance'
                        elif 'doubao' in ttype:
                            mlib_source = 'generated_video_doubao'
                        else:
                            mlib_source = f"generated_video_{ttype.replace('_video','') or 'unknown'}"
                        await media_library_service.create_from_file(
                            file_record=file_record,
                            source=mlib_source,
                            project_id=project_id,
                            episode_id=task_data.get('episode_id'),
                            source_task_id=task_id,
                            source_entity_type=entity_type,
                            source_entity_id=entity_id,
                            title=(task_data.get('prompt') or task_data.get('text_prompt') or '')[:80] or None,
                            metadata={'task_type': task.task_type if task else None, 'source': source},
                        )
                    except Exception as _e:
                        logger.warning(f"media_library 同步失败 (video worker): {_e}")
                except Exception as e:
                    logger.error(f"保存文件记录到数据库失败: {e}", exc_info=True)

            # 生成视频缩略图
            thumb_url = None
            try:
                thumb_dir = Path('persistent_storage/thumbnails')
                thumb_dir.mkdir(parents=True, exist_ok=True)
                thumb_filename = f"{Path(unique_filename).stem}.jpg"
                thumb_path = thumb_dir / thumb_filename
                from file_optimization import FileOptimizationService
                result_thumb = await FileOptimizationService.create_video_thumbnail(str(local_path), str(thumb_path))
                if result_thumb and result_thumb.get('success'):
                    thumb_url = f"/storage/thumbnails/{thumb_filename}"
                    logger.info(f"🖼️ 视频缩略图已生成: {thumb_url}")

                    # 缩略图也走 entity-aware 同步（更新 video_segments.thumbnail_url）
                    if DB_AVAILABLE and entity_type and entity_id:
                        try:
                            from file_service import _sync_legacy_on_file_create
                            await _sync_legacy_on_file_create(entity_type, entity_id, 'video_thumbnail', thumb_url)
                        except Exception as te:
                            logger.debug(f"缩略图 legacy 同步失败(不影响结果): {te}")
            except Exception as te:
                logger.debug(f"视频缩略图生成失败(不影响结果): {te}")

            # 返回文件信息
            return {
                'filename': unique_filename,
                'file_id': file_record['file_id'] if file_record else None,
                'url': file_url,
                'thumbnail_url': thumb_url,
                'size': len(video_content),
                'file_path': str(local_path)
            }

        except Exception as e:
            logger.error(f"保存外部视频失败: {e}", exc_info=True)
            return None
    
    async def _save_result_file(
        self, 
        node: ComfyUINode, 
        filename: str, 
        subfolder: str, 
        file_type: str, 
        prompt_id: str,
        comfyui_file_type: str = 'output',
        try_types: list = None
    ):
        """
        从ComfyUI下载文件并保存到本地和SQL
        :param node: ComfyUI节点
        :param filename: 文件名
        :param subfolder: 子目录
        :param file_type: 文件类型（image/video）
        :param prompt_id: 任务prompt_id
        :param comfyui_file_type: ComfyUI的文件类型（output/temp/input）
        :param try_types: 尝试的ComfyUI文件类型列表
        :return: 保存后的文件信息或None
        """
        import requests
        import os
        import uuid
        from pathlib import Path
        from datetime import datetime
        
        try:
            # 如果没有指定try_types，使用默认值
            if try_types is None:
                try_types = [comfyui_file_type]
            
            file_content = None
            downloaded_from = None
            
            # 尝试从不同的ComfyUI目录下载
            for try_type in try_types:
                try:
                    download_url = f"{node.base_url}/view"
                    params = {'filename': filename, 'type': try_type}
                    if subfolder:
                        params['subfolder'] = subfolder
                    
                    logger.info(f"📥 尝试从ComfyUI下载: {download_url} params={params}")
                    response = requests.get(download_url, params=params, timeout=60)
                    
                    if response.ok:
                        file_content = response.content
                        downloaded_from = try_type
                        logger.info(f"✅ 从ComfyUI下载成功 (type={try_type}): {filename}, 大小: {len(file_content)} bytes")
                        break
                    else:
                        logger.warning(f"从ComfyUI {try_type} 下载失败: {response.status_code}")
                except Exception as e:
                    logger.warning(f"从ComfyUI {try_type} 下载失败: {e}")
            
            if not file_content:
                logger.error(f"❌ 无法从ComfyUI下载文件: {filename}")
                return None
            
            # 保存到本地
            user_id = self.current_task.user_id if self.current_task else "system"
            task_id = self.current_task.task_id if self.current_task else prompt_id
            
            # 创建目录结构: persistent_storage/{file_type}/{user_id}/{year_month}/
            year_month = datetime.now().strftime('%Y%m')
            upload_dir = Path('persistent_storage') / file_type / user_id / year_month
            upload_dir.mkdir(parents=True, exist_ok=True)
            
            # 生成唯一文件名
            ext = Path(filename).suffix or ('.mp4' if file_type == 'video' else '.png')
            unique_filename = f"{uuid.uuid4().hex[:12]}{ext}"
            local_path = upload_dir / unique_filename
            
            if file_type == 'image' and ext.lower() in ('.png', '.jpg', '.jpeg'):
                try:
                    from PIL import Image
                    import io
                    original_size = len(file_content)
                    img = Image.open(io.BytesIO(file_content))
                    buf = io.BytesIO()
                    img.save(buf, format='WEBP', lossless=True)
                    file_content = buf.getvalue()
                    ext = '.webp'
                    unique_filename = f"{uuid.uuid4().hex[:12]}.webp"
                    local_path = upload_dir / unique_filename
                    saved = original_size - len(file_content)
                    logger.info(f"🗜️ 转换为WebP无损: {original_size} -> {len(file_content)} bytes (节省 {saved} bytes)")
                except Exception as e:
                    logger.debug(f"WebP转换跳过: {e}")

            local_path.write_bytes(file_content)
            logger.info(f"💾 文件已保存到本地: {local_path}")
            
            # 构建访问URL（持久化存储）
            file_url = f"/storage/{file_type}/{user_id}/{year_month}/{unique_filename}"
            
            # 保存到数据库
            file_record = None
            if DB_AVAILABLE:
                try:
                    # 获取version_id（如果任务中有）
                    version_id = self.current_task.data.get('version_id') if self.current_task else None
                    # 如果没有version_id，设置为None而不是创建假的version_id
                    # 因为files表的version_id是外键，必须引用存在的version记录
                    
                    entity_type = None
                    entity_id_val = None
                    file_role_val = None
                    if self.current_task and hasattr(self.current_task, 'data'):
                        td = self.current_task.data or {}
                        entity_type = td.get('entity_type')
                        entity_id_val = td.get('entity_id')
                        file_role_val = td.get('file_role', 'generated_image' if file_type == 'image' else 'video')

                    MIME_MAP = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4'}
                    mime_type = MIME_MAP.get(ext.lower(), f'{file_type}/{ext.lstrip(".")}')
                    result_metadata = {
                        'task_id': task_id,
                        'prompt_id': prompt_id,
                        'original_filename': filename,
                        'comfyui_subfolder': subfolder,
                        'comfyui_type': downloaded_from,
                    }
                    if self.current_task and hasattr(self.current_task, 'data'):
                        for metadata_key in (
                            'requested_workflow_type',
                            'display_name',
                            'source_page',
                            'source_file_id',
                        ):
                            metadata_value = (self.current_task.data or {}).get(metadata_key)
                            if metadata_value is not None and metadata_value != '':
                                result_metadata[metadata_key] = metadata_value

                    file_record = await FileDAO.create_file(
                        version_id=version_id,
                        user_id=user_id,
                        file_type=file_type,
                        file_name=unique_filename,
                        file_path=str(local_path),
                        file_url=file_url,
                        file_size_bytes=len(file_content),
                        mime_type=mime_type,
                        metadata=result_metadata,
                        entity_type=entity_type,
                        entity_id=entity_id_val,
                        file_role=file_role_val,
                    )
                    logger.info(f"📝 文件已记录到数据库: file_id={file_record['file_id']}")
                    if entity_type and entity_id_val and file_role_val:
                        try:
                            from file_service import _sync_legacy_on_file_create
                            await _sync_legacy_on_file_create(entity_type, entity_id_val, file_role_val, file_url)
                        except Exception as sync_err:
                            logger.warning(f"Legacy field sync failed (non-fatal): {sync_err}")
                except Exception as e:
                    logger.error(f"保存文件记录到数据库失败: {e}", exc_info=True)
            
            # 视频文件自动生成缩略图
            thumb_url = None
            if file_type == 'video':
                try:
                    thumb_dir = Path('persistent_storage/thumbnails')
                    thumb_dir.mkdir(parents=True, exist_ok=True)
                    thumb_filename = f"{Path(unique_filename).stem}.jpg"
                    thumb_path = thumb_dir / thumb_filename
                    from file_optimization import FileOptimizationService
                    result_thumb = await FileOptimizationService.create_video_thumbnail(str(local_path), str(thumb_path))
                    if result_thumb and result_thumb.get('success'):
                        thumb_url = f"/storage/thumbnails/{thumb_filename}"
                        logger.info(f"🖼️ 视频缩略图已生成: {thumb_url}")
                except Exception as te:
                    logger.debug(f"视频缩略图生成失败(不影响结果): {te}")

            # 返回文件信息
            return {
                'filename': unique_filename,
                'file_id': file_record['file_id'] if file_record else None,
                'url': file_url,
                'thumbnail_url': thumb_url,
                'size': len(file_content),
                'file_path': str(local_path)
            }
            
        except Exception as e:
            logger.error(f"保存结果文件失败: {e}", exc_info=True)
            return None
    
    async def _upload_file_to_comfyui(self, file_path_or_id: str, node, is_video: bool = False):
        """
        从SQL/本地文件读取并上传到ComfyUI
        :param file_path_or_id: 文件路径或file_id
        :param node: ComfyUI节点
        :param is_video: 是否为视频文件
        :return: ComfyUI中的文件名
        """
        import requests, os, uuid
        from pathlib import Path
        
        try:
            logger.info(f'📤 准备上传文件到ComfyUI: {file_path_or_id}')
            
            # 🔧 处理None值
            if not file_path_or_id:
                logger.warning(f"⚠️ 文件路径为空，跳过上传")
                return None
            
            file_content = None
            original_filename = None
            
            # 1. 尝试作为file_id从数据库读取
            if DB_AVAILABLE and isinstance(file_path_or_id, str) and file_path_or_id.startswith('file_'):
                try:
                    file_record = await FileDAO.get_file(file_path_or_id)
                    if file_record:
                        file_path = file_record['file_path']
                        original_filename = file_record['file_name']
                        
                        # 处理绝对路径和相对路径
                        if not os.path.isabs(file_path):
                            file_path = os.path.join(os.path.dirname(__file__), file_path)
                        
                        if os.path.exists(file_path):
                            with open(file_path, 'rb') as f:
                                file_content = f.read()
                            logger.info(f"✅ 从数据库读取文件: {file_path}, 大小: {len(file_content)} bytes")
                        else:
                            logger.warning(f"⚠️ 数据库中的文件路径不存在: {file_path}")
                except Exception as e:
                    logger.warning(f"从数据库读取文件失败: {e}")
            
            # 1.5 🆕 如果不是file_id格式，尝试从数据库按文件名查找
            if file_content is None and DB_AVAILABLE and isinstance(file_path_or_id, str) and not file_path_or_id.startswith('file_'):
                try:
                    # 查找最近上传的同名文件
                    file_record = await FileDAO.get_file_by_name(file_path_or_id)
                    if file_record:
                        file_path = file_record['file_path']
                        original_filename = file_record['file_name']
                        
                        if not os.path.isabs(file_path):
                            file_path = os.path.join(os.path.dirname(__file__), file_path)
                        
                        if os.path.exists(file_path):
                            with open(file_path, 'rb') as f:
                                file_content = f.read()
                            logger.info(f"✅ 从数据库按文件名找到: {file_path}, 大小: {len(file_content)} bytes")
                except Exception as e:
                    logger.debug(f"按文件名查找失败: {e}")
            
            # 2. 尝试作为本地路径读取（支持多种路径格式）
            if file_content is None and isinstance(file_path_or_id, str):
                # 尝试多个可能的路径
                possible_paths = []
                
                # 2.1 原始路径
                possible_paths.append(Path(file_path_or_id))
                
                # 2.2 如果是video/xxx格式，尝试添加persistent_storage前缀
                if file_path_or_id.startswith('video/') or file_path_or_id.startswith('image/'):
                    possible_paths.append(Path('persistent_storage') / file_path_or_id)
                    possible_paths.append(Path('persistent_storage') / 'videos' / file_path_or_id.replace('video/', ''))
                
                # 2.3 如果是相对路径，尝试从多个基础目录查找
                if not os.path.isabs(file_path_or_id):
                    base_dirs = [
                        Path('.'),
                        Path('persistent_storage'),
                        Path('persistent_storage/images'),
                        Path('uploads'),
                        Path('temp/uploads')
                    ]
                    for base_dir in base_dirs:
                        possible_paths.append(base_dir / file_path_or_id)
                    
                    # 2.4 🆕 搜索 persistent_storage/images 下所有子目录
                    images_dir = Path('persistent_storage/images')
                    if images_dir.exists():
                        for subdir in images_dir.iterdir():
                            if subdir.is_dir():
                                possible_paths.append(subdir / file_path_or_id)
                
                # 尝试所有可能的路径
                for local_path in possible_paths:
                    if local_path.exists():
                        file_content = local_path.read_bytes()
                        original_filename = local_path.name
                        logger.info(f"✅ 从本地路径读取文件: {local_path}, 大小: {len(file_content)} bytes")
                        break
            
            # 3. 如果还是没有找到，返回None
            if file_content is None:
                logger.warning(f"⚠️ 无法找到文件: {file_path_or_id}")
                logger.warning(f"   尝试的路径包括: persistent_storage/{file_path_or_id}, {file_path_or_id} 等")
                return None
            
            # 4. 上传到ComfyUI
            ext = Path(original_filename or file_path_or_id).suffix or ('.mp4' if is_video else '.png')
            unique_filename = f'{uuid.uuid4().hex[:12]}_uploaded{ext}'
            
            mime_type = 'video/mp4' if is_video else 'image/png'
            files = {'image': (unique_filename, file_content, mime_type)}
            data = {'overwrite': 'true'}
            
            upload_resp = requests.post(
                f'{node.base_url}/upload/image',
                files=files,
                data=data,
                timeout=60
            )
            
            if upload_resp.status_code == 200:
                filename = upload_resp.json().get('name', unique_filename)
                logger.info(f'✅ 上传到ComfyUI成功: {filename}')
                return filename
            else:
                logger.error(f'❌ 上传失败: {upload_resp.status_code} - {upload_resp.text}')
                return None
                
        except Exception as e:
            logger.error(f'❌ 文件上传失败: {e}', exc_info=True)
            return None
    
    async def _process_wan26_task(self, task: Task) -> bool:
        """处理 Wan2.6 DashScope API 任务"""
        try:
            from wan2_dashscope_api import get_wan26_client
            import tempfile
            from pathlib import Path
            
            wan26_client = get_wan26_client()
            
            # 提取参数
            image_path = task.data.get('image_path')
            prompt = task.data.get('prompt', '')
            negative_prompt = task.data.get('negative_prompt', '')
            resolution = task.data.get('resolution', '1080P')  # 720P, 1080P
            duration = task.data.get('duration', 5)  # 5, 10, 15
            shot_type = task.data.get('shot_type', 'multi')  # 🆕 multi(智能多镜头) / single(单镜头)
            seed = task.data.get('seed', -1)
            
            if not image_path:
                raise ValueError("缺少 image_path 参数")
            
            # 从uploads或ComfyUI下载图片到临时文件
            temp_image_path = None
            
            try:
                # 后端从数据库查询文件并转Base64
                logger.info(f"📥 准备Wan2.6图片，file_id: {image_path}")
                
                # 从数据库查询文件记录（使用file_id）
                file_record = await FileDAO.get_file(image_path)
                if not file_record:
                    raise FileNotFoundError(f"数据库中未找到文件，file_id: {image_path}")
                
                # 读取物理文件
                from pathlib import Path
                file_path = Path(file_record['file_path'])
                if not file_path.exists():
                    raise FileNotFoundError(f"物理文件不存在: {file_path}")
                
                # 转换为Base64
                with open(file_path, 'rb') as f:
                    import base64
                    image_data = f.read()
                    
                    # 检查文件大小（DashScope限制10MB）
                    if len(image_data) > 10 * 1024 * 1024:
                        raise ValueError(f"图片文件过大: {len(image_data)} bytes (限制10MB)")
                    
                    # 根据MIME类型确定Base64前缀
                    mime_type = file_record.get('mime_type') or 'image/png'
                    base64_str = base64.b64encode(image_data).decode('utf-8')
                    img_url = f"data:{mime_type};base64,{base64_str}"
                    
                    logger.info(f"✅ 图片已转Base64: {len(image_data)} bytes → {len(img_url)} 字符")
                
                # 创建视频生成任务
                logger.info(f"🎬 创建 Wan2.6 任务: {duration}s, {resolution}, shot_type={shot_type}")
                create_result = wan26_client.create_video_task(
                    prompt=prompt,
                    img_url=img_url,
                    resolution=resolution,
                    duration=duration,
                    prompt_extend=True,
                    shot_type=shot_type,  # 🆕 使用用户选择的镜头类型
                    audio=True,
                    watermark=False,
                    seed=seed if seed >= 0 else None
                )
                
                wan26_task_id = create_result.get('output', {}).get('task_id')
                if not wan26_task_id:
                    raise ValueError("未获取到 Wan2.6 task_id")
                
                # 🆕 输出完整创建响应
                logger.info(f"✅ Wan2.6 任务已创建: {wan26_task_id}")
                logger.info(f"📋 完整响应: {json.dumps(create_result, ensure_ascii=False, indent=2)}")
                
                # 等待任务完成（带进度更新）
                logger.info(f"⏳ 等待 Wan2.6 任务完成...")
                start_time = time.time()
                max_wait = 600
                poll_interval = 10
                
                while time.time() - start_time < max_wait:
                    try:
                        result = wan26_client.query_task(wan26_task_id)
                        output = result.get('output', {})
                        status = output.get('task_status', '')
                        
                        if status == 'SUCCEEDED':
                            logger.info(f"✅ Wan2.6 任务完成: {wan26_task_id}")
                            # 🆕 输出完整响应信息（包含request_id, orig_prompt, usage等）
                            logger.info(f"📋 完整响应: {json.dumps(result, ensure_ascii=False, indent=2)}")
                            complete_result = result
                            break
                        elif status == 'FAILED':
                            code = result.get('code', 'Unknown')
                            message = result.get('message', '未知错误')
                            raise RuntimeError(f"Wan2.6 任务失败: {code} - {message}")
                        elif status == 'UNKNOWN':
                            raise RuntimeError(f"Wan2.6 任务不存在或已过期: {wan26_task_id}")
                        else:
                            # PENDING 或 RUNNING - 更新进度到Redis
                            elapsed_time = time.time() - start_time
                            progress = min(int((elapsed_time / max_wait) * 90), 90)
                            await self.task_queue.update_progress(task.task_id, progress)
                            logger.info(f"⏳ Wan2.6 任务处理中: {status}, 进度: {progress}%")
                        
                        await asyncio.sleep(poll_interval)
                    except Exception as e:
                        if "任务失败" in str(e) or "任务不存在" in str(e):
                            raise
                        logger.error(f"❌ Wan2.6 轮询失败: {e}")
                        await asyncio.sleep(poll_interval)
                else:
                    raise TimeoutError(f"Wan2.6 任务超时: {wan26_task_id}")
                
                # 获取视频URL
                video_url = complete_result.get('output', {}).get('video_url')
                if not video_url:
                    raise ValueError("未获取到视频URL")
                
                # 下载视频
                logger.info(f"📥 下载 Wan2.6 视频: {video_url}")
                video_content = wan26_client.download_video(video_url)
                
                # 保存视频到本地和SQL
                logger.info(f"💾 保存Wan2.6视频...")
                saved_info = await self._save_external_video(
                    video_content=video_content,
                    task=task,
                    source='wan26'
                )
                
                if saved_info:
                    result = {
                        "videos": [saved_info],
                        "images": []
                    }
                    await self.task_queue.complete_task(task.task_id, result)
                    logger.info(f"✅ Wan2.6 任务完成: {task.task_id}")
                    return True
                else:
                    raise Exception("保存视频失败")
            
            finally:
                # 清理临时文件（仅清理实际临时文件）
                pass  # Base64模式不需要清理临时文件
        
        except Exception as e:
            logger.error(f"❌ Wan2.6 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "wan26")
                task_error = vendor_user_facing_error(e, "wan26")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "Wan2.6 non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        str(getattr(response, "text", "") or "")[:300],
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, str(e))
            return False

    # ────────────────────────────────────────────────────────────────────
    # DashScope 共享视频族（Kling / Vidu / HappyHorse）
    # 一个统一处理器，按 task_type 前缀派发到 client 的对应方法。
    # 三家共享同一份 DASHSCOPE_API_KEY、同一异步轮询机制。
    # 2026-05-24 新增。
    # ────────────────────────────────────────────────────────────────────

    def _record_to_base64(self, file_record: dict, label: str) -> str:
        """把 files 记录读成 DashScope 可接受的 Base64 data URI。"""
        fp = Path(file_record['file_path'])
        if not fp.exists():
            raise FileNotFoundError(f"{label} 物理文件不存在: {fp}")
        data = fp.read_bytes()
        mime = file_record.get('mime_type') or 'image/png'
        # 大图压缩：图片以 base64 内联进请求体，跨境上传 ARK/百炼时体积是瓶颈
        # （3-6MB 常触发 write timeout / 批量更慢）。缩到长边≤1536 并重压 JPEG，
        # 体积降到几百 KB，上传快且稳；视频首帧/参考图这个分辨率足够。失败则用原图。
        if mime.startswith('image/') and len(data) > 800 * 1024:
            try:
                from PIL import Image
                import io as _io
                img = Image.open(_io.BytesIO(data)).convert('RGB')
                w, h = img.size
                longest = max(w, h)
                if longest > 1536:
                    scale = 1536 / longest
                    img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
                buf = _io.BytesIO()
                img.save(buf, format='JPEG', quality=85)
                new_data = buf.getvalue()
                if new_data and len(new_data) < len(data):
                    logger.info(f"📦 {label} 压缩 {len(data)}→{len(new_data)} bytes (长边≤1536/JPEG)")
                    data, mime = new_data, 'image/jpeg'
            except Exception as e:
                logger.warning(f"{label} 图片压缩失败，用原图: {e}")
        if len(data) > 20 * 1024 * 1024:
            raise ValueError(f"{label} 过大 {len(data)} bytes (DashScope 限制 20MB)")
        b64 = base64.b64encode(data).decode('utf-8')
        logger.info(f"📦 DashScope {label}: {fp.name} → Base64 {len(data)} bytes")
        return f"data:{mime};base64,{b64}"

    async def _file_id_to_dashscope_url(self, ref: str, *, label: str = "image") -> str:
        """把一个引用（file_id / URL / 分镜项 ID）转成 DashScope 接受的值。

        DashScope 视频 endpoint 接受公网 HTTPS URL 或 Base64 data URI。但分镜图的
        generated_image_url 带 ?token=，服务端 fetch 会 401，必须还原本地文件转 Base64。

        分派：
          - data:URI            → 透传
          - http(s)/相对 URL    → get_file_by_url 命中则转 Base64；未命中且为公网 http → 透传
          - sb_ 分镜项 ID       → StoryboardDAO 取 generated_image_url 再转 Base64（防御）
          - 其余                → 当 file_id：get_file → 转 Base64
        """
        if not ref:
            raise ValueError(f"DashScope 任务缺少 {label}")
        # 1) data URI 直接透传
        if ref.startswith("data:"):
            return ref
        # 2) URL（绝对或相对）：优先还原本地文件转 Base64
        if ref.startswith(("http://", "https://", "/")):
            rec = await FileDAO.get_file_by_url(ref, include_deleted=True)
            if rec:
                return self._record_to_base64(rec, label)
            if ref.startswith(("http://", "https://")):
                return ref  # 本地查不到 → 视为公网 URL 透传
            raise FileNotFoundError(f"{label} 无法解析本地文件: {ref}")
        # 3) 分镜项 ID（误把 sb_xxx 当 file_id 传进来）：按分镜图还原
        if ref.startswith("sb_"):
            from dao_storyboard import StoryboardDAO
            item = await StoryboardDAO.get_by_id(ref)
            img_url = (item or {}).get('generated_image_url')
            if not img_url:
                raise FileNotFoundError(f"{label} 分镜 {ref} 无 generated_image_url")
            rec = await FileDAO.get_file_by_url(img_url, include_deleted=True)
            if not rec:
                raise FileNotFoundError(f"{label} 分镜 {ref} 图片未入库: {img_url}")
            return self._record_to_base64(rec, label)
        # 4) 其余 → 当 file_id
        file_record = await FileDAO.get_file(ref)
        if not file_record:
            raise FileNotFoundError(f"数据库未找到 {label} file_id={ref}")
        return self._record_to_base64(file_record, label)

    async def _process_dashscope_video_task(self, task: Task) -> bool:
        """处理 Kling / Vidu / HappyHorse 任务（共享 DashScope endpoint + Key）。

        task_type 派发：
          - kling_t2v       → kling_submit(prompt only)
          - kling_i2v       → kling_submit(first_frame)
          - kling_morph     → kling_submit(first_frame + last_frame)
          - kling_refer     → kling_submit(reference_image_urls, omni-only)
          - vidu_r2v        → vidu_reference_submit
          - vidu_morph      → vidu_startend_submit
          - happyhorse_r2v  → happyhorse_submit

        task.data 字段约定：
          - prompt, image_path, image_path_end           ← 复用现有约定
          - media_inputs: [{kind:image, url|file_id, role?}]  ← 多参考图（happyhorse/vidu/kling-refer）
          - sub_model    ← Kling: 'standard'(kling-v3) / 'omni' / Vidu: 'q3'/'q3-mix'/'q3-turbo'/'q2'/'q2-pro'
          - mode/resolution/aspect_ratio/ratio/duration/audio/watermark/seed
        """
        try:
            from dashscope_video_api import get_dashscope_video_client, DashScopeVideoError
            client = get_dashscope_video_client()

            task_type = task.task_type
            data = task.data or {}
            prompt = data.get('prompt') or ''
            sub_model = (data.get('sub_model') or '').strip().lower()
            duration = int(data.get('duration') or 5)
            seed = data.get('seed')
            seed = int(seed) if seed is not None and int(seed) >= 0 else None
            watermark = bool(data.get('watermark', False))
            audio = bool(data.get('audio', False))

            # 收集多张参考图（kling_refer / vidu_r2v / happyhorse_r2v 共用）
            # 2026-05-24 (Phase 2 修复)：优先 file_id 再 fallback url——前端 picker 写的 url
            # 是带 token 的预览 URL（/uploads/...?token=...），DashScope server 端 fetch 会
            # 401；必须走 file_id → _file_id_to_dashscope_url 转 Base64 路径。
            ref_urls: list[str] = []
            media_inputs = data.get('media_inputs') or []
            for idx, m in enumerate(media_inputs):
                if (m.get('kind') or '').lower() != 'image':
                    continue
                # 关键：file_id 优先，仅当无 file_id 时才尝试 url（适配老调用方）
                src = m.get('file_id') or m.get('url')
                if not src:
                    continue
                ref_urls.append(await self._file_id_to_dashscope_url(src, label=f"ref_image_{idx}"))

            await self.task_queue.update_progress(task.task_id, 5, "DashScope 任务准备中…")

            # ─── 派发到各家 client ───────────────────────────────────────
            # 2026-05-24 (silent-failure fix §G)：前端 DashScopeCards 重设计后，
            # 新增 kling_*/vidu_*/hh_* 前缀字段会先经 GenerateRequest(extra='allow')
            # 入 task.data；此处必须显式 .get() 并透传至 client.*_submit()，
            # 否则字段会在 worker 层再次断链。每个分支同时保留通用 seed/audio/
            # watermark/resolution/ratio/duration 作为 fallback，让旧调用方仍可用。
            if task_type.startswith('kling_'):
                model = "kling/kling-v3-omni-video-generation" if sub_model == "omni" else "kling/kling-v3-video-generation"
                first_url = await self._file_id_to_dashscope_url(data.get('image_path'), label='first_frame') if data.get('image_path') else None
                last_url = await self._file_id_to_dashscope_url(data.get('image_path_end'), label='last_frame') if data.get('image_path_end') else None
                create_result = await client.kling_submit(
                    prompt=prompt,
                    model=model,
                    first_frame_url=first_url,
                    last_frame_url=last_url,
                    reference_image_urls=ref_urls or None,
                    mode=(data.get('mode') or 'std').lower(),
                    duration=duration,
                    aspect_ratio=data.get('aspect_ratio'),
                    audio=audio,
                    watermark=watermark,
                    seed=seed,
                    multi_shot=bool(data.get('kling_multi_shot')),
                    shot_type=data.get('kling_shot_type'),
                    multi_prompt=data.get('kling_multi_prompt'),
                    keep_original_sound=data.get('kling_keep_original_sound'),
                )
                source_tag = 'kling'

            elif task_type == 'vidu_morph':
                # Vidu 首尾帧
                first_url = await self._file_id_to_dashscope_url(data.get('image_path'), label='first_frame')
                last_url = await self._file_id_to_dashscope_url(data.get('image_path_end'), label='last_frame')
                # sub_model 可选 q3-pro / q3-turbo / q2-pro / q2-turbo，默认 q3-turbo
                vidu_sub = sub_model or 'q3-turbo'
                model_map = {
                    'q3-pro': 'vidu/viduq3-pro_start-end2video',
                    'q3-turbo': 'vidu/viduq3-turbo_start-end2video',
                    'q2-pro': 'vidu/viduq2-pro_start-end2video',
                    'q2-turbo': 'vidu/viduq2-turbo_start-end2video',
                }
                model = model_map.get(vidu_sub, 'vidu/viduq3-turbo_start-end2video')
                # Vidu 专属覆盖：vidu_seed / vidu_audio 优先于通用 seed / audio
                vidu_seed_override = data.get('vidu_seed')
                vidu_seed_final = int(vidu_seed_override) if vidu_seed_override is not None else seed
                vidu_audio_final = data.get('vidu_audio') if data.get('vidu_audio') is not None else audio
                create_result = await client.vidu_startend_submit(
                    prompt=prompt,
                    model=model,
                    first_frame_url=first_url,
                    last_frame_url=last_url,
                    resolution=(data.get('vidu_resolution') or data.get('resolution') or '720P'),
                    duration=duration,
                    audio=bool(vidu_audio_final),
                    watermark=watermark,
                    seed=vidu_seed_final,
                )
                source_tag = 'vidu'

            elif task_type == 'vidu_r2v':
                # Vidu 参考生视频
                vidu_sub = sub_model or 'q3'
                model_map = {
                    'q3-mix': 'vidu/viduq3-mix_reference2video',
                    'q3': 'vidu/viduq3_reference2video',
                    'q3-turbo': 'vidu/viduq3-turbo_reference2video',
                    'q2-pro': 'vidu/viduq2-pro_reference2video',
                    'q2': 'vidu/viduq2_reference2video',
                }
                model = model_map.get(vidu_sub, 'vidu/viduq3_reference2video')
                # Vidu 专属覆盖：vidu_seed / vidu_audio / vidu_resolution / vidu_size
                vidu_seed_override = data.get('vidu_seed')
                vidu_seed_final = int(vidu_seed_override) if vidu_seed_override is not None else seed
                vidu_audio_final = data.get('vidu_audio') if data.get('vidu_audio') is not None else audio
                create_result = await client.vidu_reference_submit(
                    prompt=prompt,
                    model=model,
                    reference_image_urls=ref_urls or None,
                    resolution=(data.get('vidu_resolution') or data.get('resolution') or '720P'),
                    size=(data.get('vidu_size') or data.get('size')),
                    duration=duration,
                    audio=bool(vidu_audio_final),
                    watermark=watermark,
                    seed=vidu_seed_final,
                )
                source_tag = 'vidu'

            elif task_type == 'happyhorse_r2v':
                if not ref_urls:
                    raise ValueError("HappyHorse 至少需要 1 张参考图（media_inputs 中 kind=image）")
                # HappyHorse 专属覆盖：hh_* 字段优先于通用字段
                hh_watermark_override = data.get('hh_watermark')
                hh_watermark_final = hh_watermark_override if hh_watermark_override is not None else watermark
                hh_seed_override = data.get('hh_seed')
                hh_seed_final = int(hh_seed_override) if hh_seed_override is not None else seed
                # GenerateRequest.ratio 默认 'adaptive'（Seedance 专用），会泄漏进来盖过
                # happyhorse 的 '16:9'，而 DashScope 拒绝 'adaptive'。视作未设、回落 '16:9'。
                hh_ratio_final = data.get('hh_ratio') or data.get('ratio') or '16:9'
                if hh_ratio_final == 'adaptive':
                    hh_ratio_final = '16:9'
                create_result = await client.happyhorse_submit(
                    prompt=prompt,
                    reference_image_urls=ref_urls,
                    resolution=(data.get('hh_resolution') or data.get('resolution') or '720P'),
                    ratio=hh_ratio_final,
                    duration=int(data.get('hh_duration') or duration),
                    watermark=bool(hh_watermark_final),
                    seed=hh_seed_final,
                )
                source_tag = 'happyhorse'

            else:
                raise ValueError(f"未知 DashScope 视频 task_type: {task_type}")

            ds_task_id = create_result.get('output', {}).get('task_id')
            logger.info(f"✅ DashScope({source_tag}) 任务已创建: {ds_task_id}")
            await self.task_queue.update_progress(task.task_id, 10, f"{source_tag} 任务已创建，等待处理…")

            # ─── 轮询（10s 间隔，最长 600s）+ 进度更新 ───────────────────
            max_wait = 600
            poll_interval = 10
            elapsed = 0
            final_result: dict = {}
            while elapsed < max_wait:
                try:
                    q = await client.query_task(ds_task_id)
                    status = (q.get('output', {}).get('task_status') or '').lower()
                    if status == 'succeeded':
                        final_result = q
                        logger.info(f"✅ DashScope({source_tag}) 完成: {ds_task_id}")
                        break
                    if status in ('failed', 'canceled', 'unknown'):
                        out = q.get('output', {})
                        raise DashScopeVideoError(
                            out.get('message') or f"任务终止({status})",
                            code=out.get('code') or status,
                            task_id=ds_task_id,
                        )
                    # PENDING / RUNNING
                    progress = min(int(elapsed / max_wait * 90), 90)
                    await self.task_queue.update_progress(task.task_id, progress, f"{source_tag}: {status or 'running'}")
                except DashScopeVideoError:
                    raise
                except Exception as poll_err:
                    logger.warning(f"⚠️ DashScope({source_tag}) 轮询临时失败，{poll_interval}s 后重试: {poll_err}")
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
            else:
                raise TimeoutError(f"DashScope({source_tag}) 任务超时: {ds_task_id}")

            video_url = client.extract_video_url(final_result, prefer_watermark=False)
            if not video_url:
                raise ValueError(f"DashScope({source_tag}) 任务完成但未返回 video_url: {final_result}")

            # ─── 下载视频 + 入库 ────────────────────────────────────────
            logger.info(f"📥 下载 DashScope({source_tag}) 视频: {video_url}")
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as session:
                async with session.get(video_url) as resp:
                    resp.raise_for_status()
                    video_content = await resp.read()
            logger.info(f"✅ DashScope({source_tag}) 视频下载完成: {len(video_content)} bytes")

            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source=source_tag,
            )
            if not saved_info:
                raise RuntimeError(f"DashScope({source_tag}) 视频保存失败")

            await self.task_queue.complete_task(task.task_id, {
                "videos": [saved_info],
                "images": [],
            })
            logger.info(f"✅ DashScope({source_tag}) 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ DashScope 视频任务失败: {e}", exc_info=True)
            code = str(getattr(e, "code", "") or "")
            http_status = getattr(e, "http_status", None)
            non_retryable = code in {"InvalidApiKey", "MissingApiKey"} or http_status == 401
            if non_retryable:
                logger.error(
                    "DashScope non-retryable auth/config error: task=%s code=%s http_status=%s",
                    task.task_id,
                    code or "-",
                    http_status or "-",
                )
            await self.task_queue.fail_task(task.task_id, str(e), retry=not non_retryable)
            return False

    # ────────────────────────────────────────────────────────────────────
    # MiniMax TTS 异步任务
    # 2026-05-24：从 api_routes POST 同步阻塞改造为 worker 异步处理。
    # 原因：handler 内 await tts_wait_and_download(max_wait=300) 撞 autodl
    # 反代 idle ~5 分钟边界，前端 fetch hang。详见 recurring-pitfalls §Q。
    # ────────────────────────────────────────────────────────────────────

    async def _process_minimax_tts_task(self, task: Task) -> bool:
        """处理 MiniMax TTS 异步任务。

        task.data 字段约定：
          - text:              要合成的文本
          - voice_id:          MiniMax 官方音色 id 或克隆/设计的 voice_id
          - model:             默认 'speech-2.8-hd'
          - speed/pitch/emotion
          - entity_type/entity_id/file_role/episode_id:  files 表 entity binding
          - bind_to_character_voice_id (可选): worker 完成后回写 sample_audio_url
        """
        td = task.data or {}
        try:
            client = get_minimax_audio_client()
            if client is None:
                raise RuntimeError("MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY")

            text = td.get('text', '')
            voice_id = td.get('voice_id', '')
            if not text or not voice_id:
                raise ValueError("缺少 text 或 voice_id")

            logger.info(f"🎤 MiniMax TTS 任务启动: text_len={len(text)} voice_id={voice_id}")

            # 1. 构造 TTS 参数
            tts_kwargs = {
                'text': text,
                'voice_id': voice_id,
            }
            if td.get('model') is not None:
                tts_kwargs['model'] = td['model']
            if td.get('speed') is not None:
                tts_kwargs['speed'] = td['speed']
            if td.get('pitch') is not None:
                tts_kwargs['pitch'] = td['pitch']
            if td.get('emotion') is not None:
                tts_kwargs['emotion'] = td['emotion']

            # 2026-05-24：切回 sync /v1/t2a_v2 单次 HTTP，根治 MiniMax 自家 async 队列
            # 排队 5min+ 导致的 worker TimeoutError。文本 <10000 字符即可（试听 12 字 /
            # 配音对白通常 <500 字均远低于上限）。详见 recurring-pitfalls.md §R。
            await self.task_queue.update_progress(task.task_id, 10)
            download_result = await client.tts_sync(**tts_kwargs) or {}
            # 2026-05-25：用 tts_sync 新合约的 local_path / audio_bytes 字段，
            # 不再把 audio_url（web URL）误当磁盘路径。详见 recurring-pitfalls §F + §R 子陷阱 3。
            audio_local_path = download_result.get('local_path') or ''
            audio_bytes = download_result.get('audio_bytes')
            duration_ms = download_result.get('duration_ms')
            mx_trace_id = download_result.get('trace_id')
            logger.info(
                f"✅ MiniMax TTS sync 完成: trace_id={mx_trace_id} "
                f"local_path={audio_local_path} bytes={len(audio_bytes) if audio_bytes else 0} "
                f"duration_ms={duration_ms}"
            )
            await self.task_queue.update_progress(task.task_id, 80)

            # 3. 入 files 表 + entity 同步
            audio_file_path = Path(audio_local_path) if audio_local_path else None
            # 优先使用内存里的 bytes，避免「写文件 → 立刻再读」的多余 IO 且可绕过 §C 路径漂移。
            if audio_bytes is None:
                if not audio_file_path or not audio_file_path.exists():
                    raise FileNotFoundError(
                        f"TTS 输出文件不存在: {audio_file_path} (tts_sync 返回字段: "
                        f"{list(download_result.keys())})"
                    )
                audio_bytes = audio_file_path.read_bytes()

            ext_suffix = audio_file_path.suffix if audio_file_path else '.mp3'
            saved = await save_generated_file_to_db(
                content=audio_bytes,
                file_type='audio',
                user_id=task.user_id,
                source='minimax',
                entity_type=td.get('entity_type'),
                entity_id=td.get('entity_id'),
                file_role=td.get('file_role') or 'dialogue_audio',
                original_ext=ext_suffix,
                project_id=td.get('project_id'),
                episode_id=td.get('episode_id'),
                extra_metadata={
                    'storyboard_lineage_id': td.get('storyboard_lineage_id'),
                    'requested_entity_id': td.get('entity_id'),
                    'task_id': task.task_id,
                },
            )
            file_id = saved['file_id']
            file_url = saved['file_url']
            logger.info(f"💾 TTS 文件入库: file_id={file_id} url={file_url}")

            # 2026-05-26 Slice 1: 同步进通用素材库（best-effort）
            try:
                import media_library_service
                from dao_content import FileDAO as _FileDAO
                _file_record = await _FileDAO.get_file(file_id) if file_id else None
                if _file_record:
                    await media_library_service.create_from_file(
                        file_record=_file_record,
                        source='generated_audio_minimax',
                        project_id=td.get('project_id'),
                        episode_id=td.get('episode_id'),
                        source_task_id=task.task_id,
                        source_entity_type=td.get('entity_type'),
                        source_entity_id=td.get('entity_id'),
                        title=(td.get('text') or '')[:80] or None,
                    )
            except Exception as _e:
                logger.warning(f"media_library 同步失败 (TTS): {_e}")

            # 4. 可选：回写 character_voices.sample_audio_url（试听场景）
            bind_voice_id = td.get('bind_to_character_voice_id')
            if bind_voice_id:
                try:
                    await CharacterVoiceDAO.update_sample_audio_url(bind_voice_id, file_url)
                    logger.info(f"🔗 已回写 character_voice {bind_voice_id} 的 sample_audio_url")
                except Exception as e:
                    logger.warning(f"⚠️ 回写 sample_audio_url 失败（不致命）: {e}")

            # 5. 完成
            await self.task_queue.complete_task(task.task_id, {
                "audio_url": file_url,
                "file_id": file_id,
                "file_url": file_url,
                "duration_ms": duration_ms,
                "minimax_trace_id": mx_trace_id,
            })
            logger.info(f"🎉 MiniMax TTS 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ MiniMax TTS 任务失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "minimax_tts")
                task_error = vendor_user_facing_error(e, "minimax_tts")
                if non_retryable:
                    logger.error(
                        "MiniMax TTS non-retryable auth/config error: task=%s err=%s",
                        task.task_id,
                        str(e)[:300],
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, str(e))
            return False

    async def _process_video_reverse_task(self, task) -> bool:
        """2026-05-26 Slice 3: 视频反推提示词
        """
        try:
            import video_reverse_service
            logger.info(f"🎬 视频反推任务开始: {task.task_id}")
            result = await video_reverse_service.run_pipeline(task)
            await self.task_queue.complete_task(task.task_id, result)
            logger.info(f"🎉 视频反推任务完成: {task.task_id}")
            return True
        except Exception as e:
            logger.error(f"❌ 视频反推任务失败: {e}", exc_info=True)
            await self.task_queue.fail_task(task.task_id, str(e))
            return False
