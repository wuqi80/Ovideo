# -*- coding: utf-8 -*-
"""图像/文本生成请求模型（从 cluster_main.py 抽离，MVC增量1）。"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict, Field


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
    target_fps: Optional[int] = Field(60, description="Target frame rate for interpolate tasks")
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
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    preferred_agent_id: Optional[str] = Field(None, description="指定处理该 ComfyUI 任务的 GPU Agent")
    preferred_node_id: Optional[str] = Field(None, description="指定处理该 ComfyUI 任务的集群节点")
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
    model: Optional[str] = Field(None, description="DeepSeek model override; omitted uses admin runtime config")


class DoubaoImageRequest(BaseModel):
    prompt: str
    model: Optional[str] = Field(None, description="Doubao image model override; omitted uses admin runtime config")
    references: List[str] = Field(default_factory=list)
    size: str = Field("2K")
    sequential: str = Field("disabled", pattern="^(disabled|auto)$")
    count: int = Field(1, ge=1, le=15)
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    project_id: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)


class GeminiTextRequest(BaseModel):
    prompt: str
    system_prompt: Optional[str] = None
    temperature: float = Field(1.0, ge=0, le=2)
    model: Optional[str] = Field(None, description="Gemini text model override; omitted uses admin runtime config")


class GeminiImageReferenceMetadata(BaseModel):
    type: str = Field("effect", description="character | scene | pose | prop | effect")
    name: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    isLocked: bool = False


class GeminiImageRequest(BaseModel):
    prompt: str
    model: Optional[str] = Field(None, description="Gemini image model override; omitted uses admin runtime config")
    references: List[str] = Field(default_factory=list)
    reference_metadata: List[GeminiImageReferenceMetadata] = Field(default_factory=list)
    aspectRatio: str = Field("1:1")
    imageSize: Optional[str] = None
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    project_id: Optional[str] = Field(None)
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
    project_id: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)


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
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    preferred_agent_id: Optional[str] = Field(None, description="指定处理该 ComfyUI 任务的 GPU Agent")
    preferred_node_id: Optional[str] = Field(None, description="指定处理该 ComfyUI 任务的集群节点")


class ComfyUIWorkflowRequest(BaseModel):
    workflow_type: str = Field(..., description="工作流类型: qwen/qwen_lora/kontext")
    prompt: str = Field(..., description="正面提示词")
    negative_prompt: str = Field(default="bad quality, worst quality", description="负面提示词")
    image_filenames: List[str] = Field(..., description="ComfyUI中的图片文件名列表（1-6张）")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
    preferred_agent_id: Optional[str] = Field(None, description="指定处理该 ComfyUI 任务的 GPU Agent")
    preferred_node_id: Optional[str] = Field(None, description="指定处理该 ComfyUI 任务的集群节点")


class ComfyUIRoutedRequest(BaseModel):
    preferred_agent_id: Optional[str] = Field(None, description="Preferred GPU Agent")
    preferred_node_id: Optional[str] = Field(None, description="Preferred cluster node")


class AngleAdjustRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    prompt: str = Field(..., description="角度调整提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class HumanMultiAngleRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class AroundAngleRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    prompt: str = Field(..., description="角度描述提示词，如：front view, eye-level shot, medium shot")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class MattingRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    matting_type: str = Field(..., description="抠图类型: subject(主体脱离)/split(主体背景分离)")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class ImageFusionRequest(ComfyUIRoutedRequest):
    fusion_type: str = Field(..., description="融合类型: fusion(图像融合)/transfer(迁移学习)/imitation(模仿学习)")
    image_bk: str = Field(..., description="底图/背景图文件名")
    image_hu: str = Field(..., description="人物图文件名")
    image_mb: Optional[str] = Field(default=None, description="蒙版图文件名（仅迁移学习需要）")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class Panorama360Request(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="场景素材图片文件名")
    prompt: str = Field(default="", description="全景描述提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class PanoramaFusionRequest(ComfyUIRoutedRequest):
    image_1: str = Field(..., description="人物/场景图1文件名")
    image_2: Optional[str] = Field(default=None, description="人物图2文件名（可选）")
    image_3: str = Field(..., description="全景截图背景文件名")
    prompt: str = Field(default="", description="融合提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class AutoStoryboardRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="输入图片文件名")
    prompt: str = Field(..., description="分镜描述提示词")
    seed: int = Field(default=-1, description="随机种子")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")


class MultiGridStoryboardRequest(ComfyUIRoutedRequest):
    mode: str = Field(..., description="模式: multi_shot(多镜头分镜) / story(故事分镜)")
    user_prompt: str = Field(..., description="用户输入的提示词")
    reference_image: str = Field(..., description="参考图像（Base64格式，必须传入一张）")
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    project_id: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)


class MaterialProcessRequest(ComfyUIRoutedRequest):
    image_filename: str = Field(..., description="ComfyUI中的图片文件名")
    workflow_type: str = Field(..., description="工作流类型: upscale_hd/remove_watermark/three_view")
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    project_id: Optional[str] = Field(None, description="项目ID，用于素材库归属")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
