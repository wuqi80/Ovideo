# -*- coding: utf-8 -*-
"""
ComfyUI API 配置文件
"""
import os
from typing import Dict, List, Optional


DEFAULT_CORS_ALLOW_ORIGINS = (
    "https://spti.ai,"
    "http://localhost:6006,"
    "http://127.0.0.1:6006,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173"
)


def parse_cors_allow_origins(value: Optional[str] = None) -> List[str]:
    raw = value if value is not None else os.getenv("CORS_ALLOW_ORIGINS", DEFAULT_CORS_ALLOW_ORIGINS)
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


class ComfyUIConfig:
    """ComfyUI 连接配置"""
    # ComfyUI 服务器地址
    COMFYUI_HOST = os.getenv("COMFYUI_HOST", "127.0.0.1")
    COMFYUI_PORT = int(os.getenv("COMFYUI_PORT", "8188"))
    COMFYUI_BASE_URL = f"http://{COMFYUI_HOST}:{COMFYUI_PORT}"
    
    # WebSocket 连接配置
    COMFYUI_WS_URL = f"ws://{COMFYUI_HOST}:{COMFYUI_PORT}/ws"
    
    # API 端点
    PROMPT_ENDPOINT = "/prompt"
    HISTORY_ENDPOINT = "/history"
    VIEW_ENDPOINT = "/view"
    UPLOAD_ENDPOINT = "/upload/image"
    QUEUE_ENDPOINT = "/queue"
    
    # 超时设置（秒）
    REQUEST_TIMEOUT = 30
    GENERATION_TIMEOUT = 300  # 5分钟
    
    # 轮询间隔（秒）
    POLL_INTERVAL = 2

class SystemConfig:
    """系统配置"""
    # 服务器配置
    HOST = "0.0.0.0"
    PORT = 6006
    
    # 日志配置
    LOG_LEVEL = "INFO"
    LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    
    # 前端配置
    FRONTEND_CONFIG = {
        "title": "ComfyUI 图像生成平台",
        "description": "基于 ComfyUI 的智能图像生成服务",
        "version": "1.0.0"
    }
    
    # CORS 配置：默认包含正式域名和本地开发地址，可用 CORS_ALLOW_ORIGINS 覆盖。
    ALLOW_ORIGINS = parse_cors_allow_origins()
    
    # 会话配置
    SESSION_TIMEOUT = 86400  # 24小时

class WorkflowConfig:
    """ComfyUI 工作流配置"""
    
    # 默认工作流模板
    DEFAULT_I2V_WORKFLOW = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 0,
                "steps": 20,
                "cfg": 8.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "sd_xl_base_1.0.safetensors"
            }
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": 1024,
                "height": 1024,
                "batch_size": 1
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "",
                "clip": ["4", 1]
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "nsfw, bad quality, worst quality",
                "clip": ["4", 1]
            }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "ComfyUI",
                "images": ["8", 0]
            }
        }
    }
    
    # 图生图工作流
    IMG2IMG_WORKFLOW = {
        # 这里可以添加 img2img 的工作流配置
        # 根据你的 ComfyUI 工作流进行配置
    }
    
    # 视频生成工作流 (Morph/I2V)
    VIDEO_WORKFLOW = {
        # 这里可以添加视频生成的工作流配置
        # 根据你的 ComfyUI 工作流进行配置
    }
    
    @staticmethod
    def get_workflow_template(workflow_type: str = "i2v") -> Dict:
        """获取工作流模板"""
        if workflow_type == "i2v":
            return WorkflowConfig.DEFAULT_I2V_WORKFLOW.copy()
        elif workflow_type == "img2img":
            return WorkflowConfig.IMG2IMG_WORKFLOW.copy()
        elif workflow_type == "video":
            return WorkflowConfig.VIDEO_WORKFLOW.copy()
        else:
            return WorkflowConfig.DEFAULT_I2V_WORKFLOW.copy()

class StorageConfig:
    """存储配置"""
    # 本地存储目录
    UPLOAD_DIR = "uploads"
    OUTPUT_DIR = "outputs"
    TEMP_DIR = "temp"
    HISTORY_DIR = "history"
    
    # 文件大小限制（字节）
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB
    
    # 支持的文件类型
    ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]
    ALLOWED_VIDEO_TYPES = ["video/mp4", "video/avi", "video/mov", "video/webm"]

class ModelConfig:
    """模型配置"""
    # 可用的模型列表
    AVAILABLE_MODELS = {
        "Wan2": {
            "name": "Wan2",
            "description": "快速生成模型",
            "checkpoint": "sd_xl_base_1.0.safetensors",
            "steps": 20,
            "cfg": 7.5
        },
        "Sora2": {
            "name": "Sora2", 
            "description": "高质量生成模型",
            "checkpoint": "sd_xl_refiner_1.0.safetensors",
            "steps": 30,
            "cfg": 8.5
        }
    }
    
    # 默认生成参数
    DEFAULT_PARAMS = {
        "width": 1024,
        "height": 1024,
        "steps": 20,
        "cfg": 7.5,
        "sampler": "euler",
        "scheduler": "normal",
        "denoise": 1.0,
        "seed": -1  # -1 表示随机
    }
    
    @staticmethod
    def get_model_config(model_name: str) -> Dict:
        """获取模型配置"""
        return ModelConfig.AVAILABLE_MODELS.get(
            model_name, 
            ModelConfig.AVAILABLE_MODELS["Wan2"]
        )

def validate_config() -> List[str]:
    """验证配置"""
    errors = []
    
    # 验证 ComfyUI 连接
    if not ComfyUIConfig.COMFYUI_HOST:
        errors.append("COMFYUI_HOST 未设置")
    
    if not ComfyUIConfig.COMFYUI_PORT:
        errors.append("COMFYUI_PORT 未设置")
    
    return errors

def init_directories():
    """初始化必要的目录"""
    import os
    dirs = [
        StorageConfig.UPLOAD_DIR,
        StorageConfig.OUTPUT_DIR,
        StorageConfig.TEMP_DIR,
        StorageConfig.HISTORY_DIR
    ]
    
    for dir_path in dirs:
        os.makedirs(dir_path, exist_ok=True)

if __name__ == "__main__":
    # 测试配置
    errors = validate_config()
    if errors:
        print("配置错误:")
        for error in errors:
            print(f"  - {error}")
    else:
        print("✅ 配置验证通过")
        print(f"ComfyUI 地址: {ComfyUIConfig.COMFYUI_BASE_URL}")
        print(f"WebSocket 地址: {ComfyUIConfig.COMFYUI_WS_URL}")
        
    init_directories()
    print("✅ 目录初始化完成")

