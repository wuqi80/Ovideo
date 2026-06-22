"""
MiniMax API 客户端
用于调用 MiniMax-Hailuo 视频生成 API
"""

import time
import logging
from typing import Optional, Dict, Any
from external_api.video.base import download_streaming_video, request_json
from services.api_provider_registry import (
    MINIMAX_DEFAULT_VIDEO_MODEL,
    minimax_runtime_model_override,
    normalize_minimax_video_model,
)
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)

DEFAULT_MINIMAX_VIDEO_MODEL = MINIMAX_DEFAULT_VIDEO_MODEL


class MinimaxClient:
    """MiniMax API 客户端"""
    
    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = api_key or ""
        self.base_url = ""
        self.model_name = DEFAULT_MINIMAX_VIDEO_MODEL
        self._runtime_config = None
        self._request_kwargs: Dict[str, Any] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("⚠️ MINIMAX_API_KEY 未设置")

    def _refresh_runtime_config(self, model: Optional[str] = None):
        model_override = minimax_runtime_model_override(model)
        config = resolve_provider("minimax", model_override)
        self._runtime_config = config
        self.api_key = self._explicit_api_key or config.api_key
        self.base_url = config.endpoint.rstrip("/")
        self.model_name = normalize_minimax_video_model(config.model_name or model_override)
        self._request_kwargs = config.requests_kwargs()
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

    def _url_for_operation(self, operation: str, **path_params: Any) -> str:
        if not self._runtime_config:
            self._refresh_runtime_config()
        return self._runtime_config.url_for_operation(operation, **path_params)
    
    def generate_video(
        self,
        first_frame_image: str,
        prompt: str,
        last_frame_image: Optional[str] = None,
        model: Optional[str] = None,
        duration: int = 6,
        resolution: str = "720P",
        prompt_optimizer: bool = True
    ) -> Dict[str, Any]:
        """
        创建视频生成任务
        
        Args:
            first_frame_image: 首帧图片URL或Base64
            prompt: 文本提示词
            last_frame_image: 尾帧图片URL或Base64（可选，用于首尾帧模式）
            model: 模型名称
            duration: 视频时长（秒）
            resolution: 分辨率
            prompt_optimizer: 是否优化prompt
        
        Returns:
            包含task_id的响应
        """
        self._refresh_runtime_config(model)
        resolved_model = self.model_name or DEFAULT_MINIMAX_VIDEO_MODEL
        url = self._url_for_operation("video_generation")
        
        payload = {
            "model": resolved_model,
            "first_frame_image": first_frame_image,
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "prompt_optimizer": prompt_optimizer,
            "aigc_watermark": False
        }
        
        # 如果有尾帧，添加到请求中
        if last_frame_image:
            payload["last_frame_image"] = last_frame_image
        
        try:
            logger.info(f"🎬 MiniMax 创建任务: {resolved_model}, {duration}s, {resolution}")
            result = request_json(
                "POST",
                url,
                headers=self.headers,
                json=payload,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="MiniMax create",
            )
            logger.info(f"✅ MiniMax 任务创建成功: {result.get('task_id')}")
            return result
        
        except Exception as e:
            logger.error(f"❌ MiniMax 任务创建失败: {e}")
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
        url = self._url_for_operation("query_video_generation")
        params = {"task_id": task_id}
        
        try:
            return request_json(
                "GET",
                url,
                headers=self.headers,
                params=params,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="MiniMax query",
            )
        
        except Exception as e:
            logger.error(f"❌ MiniMax 查询任务失败: {e}")
            raise
    
    def download_video(self, file_id: str) -> bytes:
        """
        下载生成的视频
        
        Args:
            file_id: 文件ID
        
        Returns:
            视频文件内容（bytes）
        """
        self._refresh_runtime_config()
        url = self._url_for_operation("files_retrieve")
        params = {"file_id": file_id}
        
        try:
            result = request_json(
                "GET",
                url,
                headers=self.headers,
                params=params,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="MiniMax retrieve file",
            )
            download_url = result.get('file', {}).get('download_url')
            
            if not download_url:
                raise ValueError("未获取到下载URL")
            
            # 下载视频文件
            logger.info(f"📥 MiniMax 下载视频: {download_url}")
            return download_streaming_video(
                download_url,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="MiniMax video",
            )
            
        except Exception as e:
            logger.error(f"❌ MiniMax 下载视频失败: {e}")
            raise
    
    def wait_for_completion(
        self,
        task_id: str,
        max_wait: int = 600,
        poll_interval: int = 5
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
                status = result.get('status', '').lower()
                
                if status == 'success':
                    logger.info(f"✅ MiniMax 任务完成: {task_id}")
                    return result
                elif status == 'failed':
                    error_msg = result.get('base_resp', {}).get('status_msg', '未知错误')
                    raise RuntimeError(f"MiniMax 任务失败: {error_msg}")
                elif status == 'processing':
                    logger.info(f"⏳ MiniMax 任务处理中: {task_id}")
                else:
                    logger.info(f"📊 MiniMax 任务状态: {status}")
                
                time.sleep(poll_interval)
            
            except Exception as e:
                logger.error(f"❌ MiniMax 轮询失败: {e}")
                time.sleep(poll_interval)
        
        raise TimeoutError(f"MiniMax 任务超时: {task_id}")


# 全局客户端实例
_minimax_client = None

def get_minimax_client() -> MinimaxClient:
    """获取全局 MiniMax 客户端实例"""
    global _minimax_client
    if _minimax_client is None:
        _minimax_client = MinimaxClient()
    return _minimax_client

