# -*- coding: utf-8 -*-
"""任务/工作区请求模型（从 cluster_main.py 抽离，MVC增量1）。"""
from typing import Optional, List
from pydantic import BaseModel


class WorkspaceSessionRequest(BaseModel):
    """工作台会话数据请求"""
    task_groups: List[dict]  # TaskManager.taskGroups
    uploaded_images: List[dict]  # TaskManager.uploadedImages
    image_prompts: dict  # TaskManager.imagePrompts
    tasks_status: Optional[dict] = None  # TaskManager.tasksStatus (可选)
    scope: Optional[str] = None  # 会话作用域（如 episode_id:script_id）
