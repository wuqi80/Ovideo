# -*- coding: utf-8 -*-
"""视频请求模型（从 cluster_main.py 抽离，MVC增量1）。"""
from typing import Optional, List
from pydantic import BaseModel


class CropVideoRequest(BaseModel):
    video_filename: str
    start_time: float = 0
    end_time: float = 5


class SaveVideoTaskRequest(BaseModel):
    """保存视频任务请求"""
    uuid: str
    task_id: str
    task_type: str
    prompt: str
    videos: List[dict]  # [{"url": "...", "filename": "..."}]
    status: str = "completed"
    generate_time: Optional[int] = None  # 生成时间（秒）
