# -*- coding: utf-8 -*-
"""项目请求模型（从 cluster_main.py 抽离，MVC增量1）。"""
import uuid
from typing import Optional, List
from pydantic import BaseModel, Field


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


class ExportToVideoRequest(BaseModel):
    """导出到视频生成阶段的请求"""
    selected_items: List[str]  # 选中的分镜ID
