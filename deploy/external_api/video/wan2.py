"""
Wan2.6 DashScope API 客户端
用于调用阿里云 DashScope Wan2.6-i2v 视频生成 API
"""

import requests
import time
import logging
from typing import Optional, Dict, Any

from services.api_provider_endpoints import derive_dashscope_video_urls
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)


class Wan26Client:
    """Wan2.6 DashScope API 客户端"""
    
    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = ""
        self.base_url = ""
        self.create_endpoint = ""
        self._requests_kwargs: Dict[str, Any] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("⚠️ DASHSCOPE_API_KEY 未设置")

    def _refresh_runtime_config(self) -> None:
        config = resolve_provider("dashscope", "wan2.6-i2v")
        self.api_key = self._explicit_api_key or config.api_key or ""
        self.base_url, self.create_endpoint = derive_dashscope_video_urls(config.endpoint)
        self._requests_kwargs = config.requests_kwargs()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable"
        }
    
    def create_video_task(
        self,
        prompt: str,
        img_url: str,
        audio_url: Optional[str] = None,
        resolution: str = "1080P",
        duration: int = 5,
        prompt_extend: bool = True,
        shot_type: str = "multi",
        audio: bool = True,
        watermark: bool = False,
        seed: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        创建视频生成任务
        
        Args:
            prompt: 文本提示词（最多1500字符）
            img_url: 首帧图片的URL或Base64
            audio_url: 音频文件URL（可选）
            resolution: 分辨率（720P, 1080P）
            duration: 视频时长（5, 10, 15秒）
            prompt_extend: 是否开启prompt智能改写
            shot_type: 镜头类型（single单镜头, multi多镜头）
            audio: 是否自动添加音频
            watermark: 是否添加水印
            seed: 随机数种子（可选）
        
        Returns:
            包含task_id的响应
        """
        self._refresh_runtime_config()
        url = self.create_endpoint
        
        try:
            # 构建请求数据
            data = {
                "model": "wan2.6-i2v",
                "input": {
                    "prompt": prompt,
                    "img_url": img_url
                },
                "parameters": {
                    "resolution": resolution,
                    "duration": duration,
                    "prompt_extend": prompt_extend,
                    "shot_type": shot_type,
                    "audio": audio,
                    "watermark": watermark
                }
            }
            
            # 添加音频URL（如果提供）
            if audio_url:
                data["input"]["audio_url"] = audio_url
            
            # 添加随机种子（如果提供）
            if seed is not None:
                data["parameters"]["seed"] = seed
            
            logger.info(f"🎬 Wan2.6 创建任务: {duration}s, {resolution}, shot_type={shot_type}")
            
            headers = {**self.headers, "Content-Type": "application/json"}
            response = requests.post(url, headers=headers, json=data, timeout=30, **self._requests_kwargs)
            response.raise_for_status()
            
            result = response.json()
            task_id = result.get('output', {}).get('task_id')
            task_status = result.get('output', {}).get('task_status')
            
            logger.info(f"✅ Wan2.6 任务创建成功: {task_id}, 状态: {task_status}")
            return result
        
        except Exception as e:
            logger.error(f"❌ Wan2.6 任务创建失败: {e}")
            raise
    
    def query_task(self, task_id: str) -> Dict[str, Any]:
        """
        查询任务状态
        
        Args:
            task_id: 任务ID
        
        Returns:
            任务状态信息
        """
        self._refresh_runtime_config()
        url = f"{self.base_url}/tasks/{task_id}"
        
        try:
            response = requests.get(url, headers=self.headers, timeout=30, **self._requests_kwargs)
            response.raise_for_status()
            return response.json()
        
        except Exception as e:
            logger.error(f"❌ Wan2.6 查询任务失败: {e}")
            raise
    
    def download_video(self, video_url: str) -> bytes:
        """
        下载生成的视频
        
        Args:
            video_url: 视频URL
        
        Returns:
            视频文件内容（bytes）
        """
        try:
            self._refresh_runtime_config()
            logger.info(f"📥 Wan2.6 下载视频: {video_url}")
            response = requests.get(video_url, stream=True, timeout=120, **self._requests_kwargs)
            response.raise_for_status()
            
            video_bytes = b''
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    video_bytes += chunk
            
            logger.info(f"✅ Wan2.6 视频下载完成: {len(video_bytes)} bytes")
            return video_bytes
        
        except Exception as e:
            logger.error(f"❌ Wan2.6 下载视频失败: {e}")
            raise
    
    def wait_for_completion(
        self,
        task_id: str,
        max_wait: int = 600,
        poll_interval: int = 10
    ) -> Dict[str, Any]:
        """
        等待任务完成
        
        Args:
            task_id: 任务ID
            max_wait: 最大等待时间（秒）
            poll_interval: 轮询间隔（秒）
        
        Returns:
            完成的任务信息
        """
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            try:
                result = self.query_task(task_id)
                output = result.get('output', {})
                status = output.get('task_status', '')
                
                if status == 'SUCCEEDED':
                    video_url = output.get('video_url')
                    logger.info(f"✅ Wan2.6 任务完成: {task_id}, URL: {video_url}")
                    return result
                elif status == 'FAILED':
                    code = result.get('code', 'Unknown')
                    message = result.get('message', '未知错误')
                    raise RuntimeError(f"Wan2.6 任务失败: {code} - {message}")
                elif status == 'UNKNOWN':
                    raise RuntimeError(f"Wan2.6 任务不存在或已过期: {task_id}")
                else:
                    # PENDING 或 RUNNING
                    logger.info(f"⏳ Wan2.6 任务处理中: {status}")
                
                time.sleep(poll_interval)
            
            except Exception as e:
                if "任务失败" in str(e) or "任务不存在" in str(e):
                    raise
                logger.error(f"❌ Wan2.6 轮询失败: {e}")
                time.sleep(poll_interval)
        
        raise TimeoutError(f"Wan2.6 任务超时: {task_id}")


# 全局客户端实例
_wan26_client = None

def get_wan26_client() -> Wan26Client:
    """获取全局 Wan2.6 客户端实例"""
    global _wan26_client
    if _wan26_client is None:
        _wan26_client = Wan26Client()
    return _wan26_client

