"""
Seedance 2.0 API 客户端（火山方舟 Ark）
对应官方 API: POST /api/v3/contents/generations/tasks
"""
import os
import logging
import requests
from typing import Optional, Dict, Any, List
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)


class SeedanceClient:
    # 2026-06-15：账号 2101702750 未开通 Seedance 2.0（doubao-seedance-2-0-260128 实测
    # ModelNotOpen 404），但已开通 Seedance 1.0 Pro（doubao-seedance-1-0-pro-250528 实测 200）。
    # 默认指向 1.0 Pro 让飞升/渡劫可用；后续若在火山方舟开通 2.0，设 env
    # SEEDANCE_MODEL_STANDARD / SEEDANCE_MODEL_FAST 覆盖即可，无需改代码。
    MODEL_MAP = {
        'standard': os.getenv('SEEDANCE_MODEL_STANDARD', 'doubao-seedance-1-0-pro-250528'),
        'fast':     os.getenv('SEEDANCE_MODEL_FAST', 'doubao-seedance-1-0-pro-250528'),
    }

    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = api_key or ""
        self.base_url = ""
        self._request_kwargs: Dict[str, Any] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("SEEDANCE_API_KEY 与 ARK_API_KEY 均未设置")

    def _refresh_runtime_config(self, model_name: Optional[str] = None) -> None:
        config = resolve_provider("seedance", model_name)
        self.api_key = self._explicit_api_key or config.api_key
        self.base_url = config.endpoint.rstrip("/")
        self._request_kwargs = config.requests_kwargs()
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
        model_name = self.MODEL_MAP[sub_model]
        self._refresh_runtime_config(model_name)

        payload: Dict[str, Any] = {
            "model": model_name,
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
            # 单一 180s 超时（不用元组）：图片以 base64 内联进 body，常达数 MB，ARK 在
            # 中国大陆、本服务在 GCP 香港，跨境上传慢。实测 urllib3 用元组 (connect, read)
            # 时，body 上传(write)受 connect 值约束——(15,180) 下 3.3MB 图仍在 15s 触发
            # 'write operation timed out'。改单值让整个 socket（含 write）都有 180s。
            resp = requests.post(self.base_url, headers=self.headers, json=payload, timeout=180, **self._request_kwargs)
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
        self._refresh_runtime_config()
        url = f"{self.base_url.rstrip('/')}/{task_id}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=30, **self._request_kwargs)
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
            self._refresh_runtime_config()
            resp = requests.get(video_url, stream=True, timeout=120, **self._request_kwargs)
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
