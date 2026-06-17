# -*- coding: utf-8 -*-
"""认证相关请求模型（从 cluster_main.py 抽离，MVC增量1）。"""
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False
