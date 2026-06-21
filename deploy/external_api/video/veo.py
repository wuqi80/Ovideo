"""
Veo-3.1 API 客户端
用于调用老张 Veo-3.1 视频生成 API
"""

import requests
import time
import logging
from typing import Optional, Dict, Any, List
from services.api_provider_registry import VEO_DEFAULT_VIDEO_MODEL
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)

DEFAULT_VEO_VIDEO_MODEL = VEO_DEFAULT_VIDEO_MODEL
LEGACY_VEO_VIDEO_MODELS = {"veo-3", "veo-3.1"}


def _runtime_model_override(model: Optional[str]) -> Optional[str]:
    """Treat legacy/default names as fallback so admin runtime config can win."""
    normalized = (model or "").strip()
    if not normalized or normalized == DEFAULT_VEO_VIDEO_MODEL or normalized in LEGACY_VEO_VIDEO_MODELS:
        return None
    return normalized


def _normalize_veo_model(model: Optional[str]) -> str:
    normalized = (model or "").strip()
    if not normalized or normalized in LEGACY_VEO_VIDEO_MODELS:
        return DEFAULT_VEO_VIDEO_MODEL
    return normalized


class VeoClient:
    """Veo-3.1 API 客户端"""
    
    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = api_key or ""
        self.base_url = ""
        self.model_name = DEFAULT_VEO_VIDEO_MODEL
        self._request_kwargs: Dict[str, Any] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("⚠️ VEO_API_KEY 未设置")

    def _refresh_runtime_config(self, model: Optional[str] = None) -> None:
        model_override = _runtime_model_override(model)
        config = resolve_provider("veo", model_override)
        self.api_key = self._explicit_api_key or config.api_key
        self.base_url = config.endpoint.rstrip("/")
        self.model_name = _normalize_veo_model(config.model_name or model_override)
        self._request_kwargs = config.requests_kwargs()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    def create_video_task(
        self,
        prompt: str,
        image_urls: Optional[List[str]] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        创建视频生成任务
        
        Args:
            prompt: 提示词
            image_urls: 图片URL列表（可选，1-2张）
            model: 模型名称
        
        Returns:
            包含task_id的响应
        """
        self._refresh_runtime_config(model)
        resolved_model = self.model_name or DEFAULT_VEO_VIDEO_MODEL
        url = f"{self.base_url}/chat/completions"
        
        try:
            # 构建消息内容
            content = [{"type": "text", "text": prompt}]
            
            # 添加图片
            if image_urls:
                for img_url in image_urls[:2]:  # 最多2张
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": img_url}
                    })
            
            data = {
                "model": resolved_model,
                "messages": [{
                    "role": "user",
                    "content": content
                }],
                "stream": False
            }
            
            logger.info(f"🎬 Veo 创建任务: {model}, {len(image_urls) if image_urls else 0}张图片")
            response = requests.post(url, headers=self.headers, json=data, timeout=30, **self._request_kwargs)
            response.raise_for_status()
            
            result = response.json()
            logger.info(f"✅ Veo 任务创建成功: {result.get('id')}")
            return result
        
        except Exception as e:
            logger.error(f"❌ Veo 任务创建失败: {e}")
            raise
    
    def query_task(self, video_id: str) -> Dict[str, Any]:
        """
        查询任务状态
        
        Args:
            video_id: 视频任务ID
        
        Returns:
            任务状态信息
        """
        self._refresh_runtime_config()
        url = f"{self.base_url}/videos/{video_id}"
        
        try:
            response = requests.get(url, headers=self.headers, timeout=30, **self._request_kwargs)
            response.raise_for_status()
            return response.json()
        
        except Exception as e:
            logger.error(f"❌ Veo 查询任务失败: {e}")
            raise
    
    def get_video_content(self, video_id: str) -> Dict[str, Any]:
        """
        获取视频内容和URL
        
        Args:
            video_id: 视频任务ID
        
        Returns:
            包含video_url的响应
        """
        self._refresh_runtime_config()
        url = f"{self.base_url}/videos/{video_id}/content"
        
        try:
            response = requests.get(url, headers=self.headers, timeout=30, **self._request_kwargs)
            response.raise_for_status()
            return response.json()
        
        except Exception as e:
            logger.error(f"❌ Veo 获取视频内容失败: {e}")
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
            logger.info(f"📥 Veo 下载视频: {video_url}")
            self._refresh_runtime_config()
            response = requests.get(video_url, stream=True, timeout=120, **self._request_kwargs)
            response.raise_for_status()
            
            video_bytes = b''
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    video_bytes += chunk
            
            logger.info(f"✅ Veo 视频下载完成: {len(video_bytes)} bytes")
            return video_bytes
        
        except Exception as e:
            logger.error(f"❌ Veo 下载视频失败: {e}")
            raise
    
    def wait_for_completion(
        self,
        video_id: str,
        max_wait: int = 600,
        poll_interval: int = 5
    ) -> Dict[str, Any]:
        """
        等待任务完成
        
        Args:
            video_id: 视频任务ID
            max_wait: 最大等待时间（秒）
            poll_interval: 轮询间隔（秒）
        
        Returns:
            完成的任务信息
        """
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            try:
                result = self.query_task(video_id)
                status = result.get('status', '')
                
                if status == 'completed':
                    logger.info(f"✅ Veo 任务完成: {video_id}")
                    return result
                elif status == 'failed':
                    error = result.get('error', {})
                    error_msg = error.get('message', '未知错误')
                    raise RuntimeError(f"Veo 任务失败: {error_msg}")
                else:
                    logger.info(f"⏳ Veo 任务处理中: {status}")
                
                time.sleep(poll_interval)
            
            except Exception as e:
                logger.error(f"❌ Veo 轮询失败: {e}")
                time.sleep(poll_interval)
        
        raise TimeoutError(f"Veo 任务超时: {video_id}")


# 全局客户端实例
_veo_client = None

def get_veo_client() -> VeoClient:
    """获取全局 Veo 客户端实例"""
    global _veo_client
    if _veo_client is None:
        _veo_client = VeoClient()
    return _veo_client

