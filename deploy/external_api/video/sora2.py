"""
Sora2 API 客户端
用于调用老张 Sora2 异步视频生成 API
"""

import requests
import time
import logging
from typing import Optional, Dict, Any
from PIL import Image
import io
from external_api.video.base import download_streaming_video, request_json
from services.api_provider_registry import (
    SORA2_DEFAULT_VIDEO_MODEL,
    normalize_sora2_video_model,
    sora2_runtime_model_override,
)
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)

DEFAULT_SORA2_VIDEO_MODEL = SORA2_DEFAULT_VIDEO_MODEL


class Sora2Client:
    """Sora2 API 客户端"""
    
    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = api_key or ""
        self.base_url = ""
        self.model_name = DEFAULT_SORA2_VIDEO_MODEL
        self._request_kwargs: Dict[str, Any] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("⚠️ SORA2_API_KEY 未设置")

    def _refresh_runtime_config(self, model: Optional[str] = None):
        model_override = sora2_runtime_model_override(model)
        config = resolve_provider("sora2", model_override)
        self.api_key = self._explicit_api_key or config.api_key
        self.base_url = config.endpoint.rstrip("/")
        self.model_name = normalize_sora2_video_model(config.model_name or model_override)
        self._request_kwargs = config.requests_kwargs()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
    
    def merge_images_vertical(self, image1_path: str, image2_path: str) -> bytes:
        """
        垂直拼合两张图片（上下拼合），并缩放到长边1280
        
        Args:
            image1_path: 首帧图片路径
            image2_path: 尾帧图片路径
        
        Returns:
            拼合后的图片bytes
        """
        try:
            # 打开两张图片
            img1 = Image.open(image1_path)
            img2 = Image.open(image2_path)
            
            # 确保两张图片宽度一致（以第一张为准）
            if img1.width != img2.width:
                # 调整第二张图片宽度
                new_height = int(img2.height * (img1.width / img2.width))
                img2 = img2.resize((img1.width, new_height), Image.Resampling.LANCZOS)
            
            # 创建新图片（上下拼合）
            merged_height = img1.height + img2.height
            merged_img = Image.new('RGB', (img1.width, merged_height))
            
            # 粘贴两张图片
            merged_img.paste(img1, (0, 0))
            merged_img.paste(img2, (0, img1.height))
            
            # 缩放到长边1280
            width, height = merged_img.size
            if width > height:
                # 横向为长边
                new_width = 1280
                new_height = int(height * (1280 / width))
            else:
                # 纵向为长边
                new_height = 1280
                new_width = int(width * (1280 / height))
            
            merged_img = merged_img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # 转换为bytes
            img_byte_arr = io.BytesIO()
            merged_img.save(img_byte_arr, format='PNG')
            img_bytes = img_byte_arr.getvalue()
            
            logger.info(f"✅ 图片拼合完成: {new_width}x{new_height}")
            return img_bytes
        
        except Exception as e:
            logger.error(f"❌ 图片拼合失败: {e}")
            raise
    
    def create_video_task(
        self,
        prompt: str,
        image_path: Optional[str] = None,
        size: str = "1280x704",
        seconds: str = "15",
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        创建视频生成任务
        
        Args:
            prompt: 提示词
            image_path: 图片路径（可选，用于图生视频）
            size: 分辨率（默认1280x704）
            seconds: 时长（默认15秒）
        
        Returns:
            包含task_id的响应
        """
        self._refresh_runtime_config(model)
        resolved_model = self.model_name or DEFAULT_SORA2_VIDEO_MODEL
        url = f"{self.base_url}/videos"
        
        try:
            if image_path:
                # 图生视频 - 使用multipart/form-data
                logger.info(f"🎬 Sora2 创建图生视频任务: {seconds}s, {size}")
                
                with open(image_path, 'rb') as image_file:
                    files = {
                        'input_reference': ('image.png', image_file, 'image/png')
                    }
                    data = {
                        'model': resolved_model,
                        'prompt': prompt,
                        'size': size,
                        'seconds': seconds
                    }
                    response = requests.post(url, headers=self.headers, files=files, data=data, timeout=30, **self._request_kwargs)
            else:
                # 文生视频 - 使用JSON
                logger.info(f"🎬 Sora2 创建文生视频任务: {seconds}s, {size}")
                
                headers = {**self.headers, "Content-Type": "application/json"}
                data = {
                    "model": resolved_model,
                    "prompt": prompt,
                    "size": size,
                    "seconds": seconds
                }
                response = requests.post(url, headers=headers, json=data, timeout=30, **self._request_kwargs)
            
            response.raise_for_status()
            result = response.json()
            logger.info(f"✅ Sora2 任务创建成功: {result.get('id')}")
            return result
        
        except Exception as e:
            logger.error(f"❌ Sora2 任务创建失败: {e}")
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
            return request_json(
                "GET",
                url,
                headers=self.headers,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Sora2 query",
            )
        
        except Exception as e:
            logger.error(f"❌ Sora2 查询任务失败: {e}")
            raise
    
    def download_video(self, video_id: str) -> bytes:
        """
        下载生成的视频
        
        Args:
            video_id: 视频任务ID
        
        Returns:
            视频文件内容（bytes）
        """
        self._refresh_runtime_config()
        url = f"{self.base_url}/videos/{video_id}/content"
        
        try:
            logger.info(f"📥 Sora2 下载视频: {video_id}")
            return download_streaming_video(
                url,
                headers=self.headers,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Sora2 video",
            )
        except Exception as e:
            logger.error(f"❌ Sora2 下载视频失败: {e}")
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
                progress = result.get('progress', 0)
                
                if status == 'completed':
                    logger.info(f"✅ Sora2 任务完成: {video_id}")
                    return result
                elif status == 'failed':
                    error = result.get('error', {})
                    error_msg = error.get('message', '未知错误')
                    raise RuntimeError(f"Sora2 任务失败: {error_msg}")
                else:
                    logger.info(f"⏳ Sora2 任务处理中: {status}, 进度: {progress}%")
                
                time.sleep(poll_interval)
            
            except Exception as e:
                logger.error(f"❌ Sora2 轮询失败: {e}")
                time.sleep(poll_interval)
        
        raise TimeoutError(f"Sora2 任务超时: {video_id}")


# 全局客户端实例
_sora2_client = None

def get_sora2_client() -> Sora2Client:
    """获取全局 Sora2 客户端实例"""
    global _sora2_client
    if _sora2_client is None:
        _sora2_client = Sora2Client()
    return _sora2_client

