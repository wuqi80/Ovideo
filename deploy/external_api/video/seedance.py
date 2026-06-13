"""
Seedance 2.0 API 客户端（火山方舟 Ark）
对应官方 API: POST /api/v3/contents/generations/tasks
"""
import os
import logging
import requests
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


class SeedanceClient:
    BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"

    MODEL_MAP = {
        'standard': 'doubao-seedance-2-0-260128',
        'fast':     'doubao-seedance-2-0-fast-260128',
    }

    def __init__(self, api_key: Optional[str] = None):
        # SEEDANCE_API_KEY 优先；缺省回落 ARK_API_KEY（同 veo_api 模式）
        self.api_key = api_key or os.getenv('SEEDANCE_API_KEY') or os.getenv('ARK_API_KEY')
        if not self.api_key:
            logger.warning("SEEDANCE_API_KEY 与 ARK_API_KEY 均未设置")
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def create_video_task(
        self,
        sub_model: str,
        contents: List[Dict[str, Any]],
        resolution: Optional[str] = None,
        ratio: Optional[str] = "adaptive",
        duration: Optional[int] = None,
        # seed: -1 = 随机种子（API 默认）；None = 不发送 seed 字段
        seed: Optional[int] = -1,
        watermark: bool = False,
        generate_audio: bool = True,
        camera_fixed: bool = False,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """
        创建视频生成任务，返回 task_id（ark 侧 id）。
        contents: 形如 [{"type":"text","text":"..."},{"type":"image_url","image_url":{"url":"..."},"role":"first_frame"}]
        """
        if sub_model not in self.MODEL_MAP:
            raise ValueError(f"不支持的子型号: {sub_model}")

        payload: Dict[str, Any] = {
            "model": self.MODEL_MAP[sub_model],
            "content": contents,
        }
        if resolution:
            payload["resolution"] = resolution
        if ratio:
            payload["ratio"] = ratio
        if duration is not None:
            payload["duration"] = duration
        if seed is not None:
            payload["seed"] = seed
        payload["watermark"] = watermark
        payload["generate_audio"] = generate_audio
        payload["camera_fixed"] = camera_fixed
        if tools:
            payload["tools"] = tools

        logger.info(f"Seedance 创建任务: sub_model={sub_model}, contents={len(contents)} 项")
        try:
            resp = requests.post(self.BASE_URL, headers=self.headers, json=payload, timeout=30)
            if not resp.ok:
                # 关键：raise_for_status() 只携带 URL，会丢掉 Ark 的错误体。
                # Ark(OpenAI 兼容)对“模型未开通/无权限/模型名不存在”返回 404 NotFound，
                # 对鉴权失败返回 401，对参数错误返回 400 —— 必须打出 body 才能区分。
                logger.error(
                    f"Seedance 任务创建失败: HTTP {resp.status_code} model={payload['model']} "
                    f"body={resp.text[:1000]}"
                )
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get('id')
            if not task_id:
                raise ValueError(f"Seedance 未返回 task id: {data}")
            logger.info(f"Seedance 任务已创建: {task_id}")
            return task_id
        except Exception as e:
            logger.error(f"Seedance 任务创建失败: {e}")
            raise

    def query_task(self, task_id: str) -> Dict[str, Any]:
        """轮询任务状态。返回 {status: queued/running/succeeded/failed/cancelled, content: {video_url, ...}, ...}"""
        url = f"{self.BASE_URL}/{task_id}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=30)
            if not resp.ok:
                logger.error(f"Seedance 查询失败: HTTP {resp.status_code} body={resp.text[:500]}")
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Seedance 查询失败: {e}")
            raise

    def download_video(self, video_url: str) -> bytes:
        """下载已生成的视频。"""
        try:
            logger.info(f"Seedance 下载视频: {video_url[:80]}...")
            resp = requests.get(video_url, stream=True, timeout=120)
            resp.raise_for_status()
            chunks: List[bytes] = []
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    chunks.append(chunk)
            buf = b''.join(chunks)
            logger.info(f"Seedance 视频下载完成: {len(buf)} bytes")
            return buf
        except Exception as e:
            logger.error(f"Seedance 视频下载失败: {e}")
            raise


_seedance_client: Optional[SeedanceClient] = None


def get_seedance_client() -> SeedanceClient:
    global _seedance_client
    if _seedance_client is None:
        _seedance_client = SeedanceClient()
    return _seedance_client
