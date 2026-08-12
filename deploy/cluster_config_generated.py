# -*- coding: utf-8 -*-
"""
ComfyUI 集群配置 - 自动生成
生成时间: 2025-12-14 22:11:25
生成自: servers_config.yaml

节点总数: 4
"""
import os
from typing import List
from dataclasses import dataclass

@dataclass
class ComfyUINode:
    """ComfyUI 节点配置"""
    id: str
    host: str
    port: int
    node_type: str = "all"
    priority: int = 1
    max_concurrent: int = 1
    enabled: bool = True
    
    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"
    
    @property
    def ws_url(self) -> str:
        return f"ws://{self.host}:{self.port}/ws"

class ClusterConfig:
    """集群配置"""
    
    # 🤖 自动生成的节点配置（共 4 个节点）
    NODES: List[ComfyUINode] = [
        ComfyUINode(
            id="local-gpu0-gpu0-image",
            host="127.0.0.1",
            port=8188,
            node_type="image",
            priority=3,
            max_concurrent=1,
            enabled=True
        ),
        ComfyUINode(
            id="local-gpu0-video-gpu0-video",
            host="127.0.0.1",
            port=8188,
            node_type="video",
            priority=2,
            max_concurrent=1,
            enabled=True
        ),
    ]
    
    # 负载均衡策略
    LOAD_BALANCE_STRATEGY = "priority"
    
    # 健康检查
    HEALTH_CHECK_INTERVAL = 30
    HEALTH_CHECK_TIMEOUT = 10
    NODE_FAILURE_THRESHOLD = 3
    
    @classmethod
    def get_enabled_nodes(cls, node_type: str = None) -> List[ComfyUINode]:
        """获取启用的节点"""
        nodes = [node for node in cls.NODES if node.enabled]
        if node_type:
            nodes = [node for node in nodes if node.node_type == node_type or node.node_type == "all"]
        return nodes
    
    @classmethod
    def get_node_by_id(cls, node_id: str) -> ComfyUINode:
        """根据ID获取节点"""
        for node in cls.NODES:
            if node.id == node_id:
                return node
        return None
    
    @classmethod
    def get_image_nodes(cls) -> List[ComfyUINode]:
        """获取图像处理节点"""
        return cls.get_enabled_nodes(node_type="image")
    
    @classmethod
    def get_video_nodes(cls) -> List[ComfyUINode]:
        """获取视频处理节点"""
        return cls.get_enabled_nodes(node_type="video")

# ========== 其他配置类（保持原有配置）==========

class RedisConfig:
    HOST = os.getenv("REDIS_HOST", "localhost")
    PORT = int(os.getenv("REDIS_PORT", "6379"))
    DB = int(os.getenv("REDIS_DB", "0"))
    PASSWORD = os.getenv("REDIS_PASSWORD", None)
    MAX_CONNECTIONS = 50
    DECODE_RESPONSES = True
    TASK_QUEUE_KEY = "comfyui:task_queue"
    PROCESSING_QUEUE_KEY = "comfyui:processing"
    COMPLETED_QUEUE_KEY = "comfyui:completed"
    FAILED_QUEUE_KEY = "comfyui:failed"
    TASK_STATUS_PREFIX = "comfyui:task:"
    TASK_RESULT_PREFIX = "comfyui:result:"
    NODE_STATUS_PREFIX = "comfyui:node:"
    NODE_LOCK_PREFIX = "comfyui:lock:"
    TASK_EXPIRE_TIME = 15552000    # 180天（确保历史任务长期可查）
    RESULT_EXPIRE_TIME = 15552000  # 180天
    QUEUE_BLOCK_TIMEOUT = 5
    MAX_RETRIES = 3
    RETRY_DELAY = 10

class QueueConfig:
    PRIORITY_HIGH = 3
    PRIORITY_NORMAL = 2
    PRIORITY_LOW = 1
    QUEUE_BLOCK_TIMEOUT = 5
    TASK_TIMEOUT = 600
    TASK_HEARTBEAT_INTERVAL = 5
    MAX_RETRIES = 3
    RETRY_DELAY = 10
    BATCH_SIZE = 10
    DEAD_LETTER_QUEUE = "comfyui:dead_letter"
    MAX_DEAD_LETTER_SIZE = 1000

class WorkerConfig:
    NUM_WORKERS = 4
    WORKER_ID_PREFIX = "worker"
    WORKER_STATUS_KEY = "comfyui:workers"
    WORKER_HEARTBEAT_INTERVAL = 10
    WORKER_TIMEOUT = 30
    TASK_PREFETCH_COUNT = 1
    GRACEFUL_SHUTDOWN_TIMEOUT = 30

class MonitorConfig:
    METRICS_ENABLED = True
    METRICS_INTERVAL = 60
    STATS_KEY = "comfyui:stats"
    METRICS = [
        "tasks_total",
        "tasks_completed",
        "tasks_failed",
        "tasks_cancelled",
        "avg_processing_time",
        "queue_length",
        "workers_active",
        "nodes_active"
    ]

DEFAULT_CORS_ALLOW_ORIGINS = (
    "https://spti.ai,"
    "http://localhost:6006,"
    "http://127.0.0.1:6006,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173"
)


def parse_cors_allow_origins(value: str | None = None) -> list[str]:
    raw = value if value is not None else os.getenv("CORS_ALLOW_ORIGINS", DEFAULT_CORS_ALLOW_ORIGINS)
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


class SystemConfig:
    HOST = "0.0.0.0"
    PORT = 6006
    LOG_LEVEL = "INFO"
    LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    LOG_FILE = "logs/cluster.log"
    FRONTEND_CONFIG = {
        "title": "ComfyUI 集群管理平台",
        "description": "分布式图像生成服务",
        "version": "2.0.0"
    }
    ALLOW_ORIGINS = parse_cors_allow_origins()
    SESSION_TIMEOUT = 86400
    UPLOAD_DIR = "uploads"
    OUTPUT_DIR = "outputs"
    TEMP_DIR = "temp"
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024
    ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"]

def validate_cluster_config() -> list:
    """验证集群配置"""
    errors = []
    if not ClusterConfig.NODES:
        errors.append("至少需要配置一个 ComfyUI 节点")
    if not RedisConfig.HOST:
        errors.append("Redis HOST 未配置")
    node_ids = [node.id for node in ClusterConfig.NODES]
    if len(node_ids) != len(set(node_ids)):
        errors.append("节点ID必须唯一")
    return errors
