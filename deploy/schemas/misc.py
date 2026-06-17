# -*- coding: utf-8 -*-
"""其它请求模型（从 cluster_main.py 抽离，MVC增量1）。"""
from pydantic import BaseModel, Field


class PromptTemplate(BaseModel):
    """提示词模板"""
    template_type: str = Field(..., description="模板类型: rewrite/storyboard")
    content: str = Field(..., description="提示词内容")
