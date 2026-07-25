"""Pydantic 请求/响应模型（按域分文件）。从巨石 cluster_main.py 抽离。
本包严禁 import cluster_main，否则触发其 sys.modules 半初始化循环。"""
from schemas.auth import LoginRequest
from schemas.generation import (
    GenerateRequest,
    DeepseekChatRequest,
    MinimaxChatRequest,
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
from schemas.video import CropVideoRequest, SaveVideoTaskRequest
from schemas.task import WorkspaceSessionRequest
from schemas.project import ProjectData, ExportToVideoRequest
from schemas.misc import PromptTemplate

__all__ = [
    "LoginRequest",
    "GenerateRequest",
    "DeepseekChatRequest",
    "MinimaxChatRequest",
    "DoubaoImageRequest",
    "GeminiTextRequest",
    "GeminiImageRequest",
    "GptImageRequest",
    "CropVideoRequest",
    "SaveVideoTaskRequest",
    "WorkspaceSessionRequest",
    "ProjectData",
    "ExportToVideoRequest",
    "ImageGenerationRequest",
    "ComfyUIWorkflowRequest",
    "AngleAdjustRequest",
    "HumanMultiAngleRequest",
    "AroundAngleRequest",
    "MattingRequest",
    "ImageFusionRequest",
    "Panorama360Request",
    "PanoramaFusionRequest",
    "AutoStoryboardRequest",
    "MultiGridStoryboardRequest",
    "MaterialProcessRequest",
    "PromptTemplate",
]
