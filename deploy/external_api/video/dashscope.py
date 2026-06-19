"""
DashScope 视频生成共享异步客户端
=====================================

驱动阿里云百炼 DashScope 上的全部视频模型：
  - Kling (kling-v3-video-generation / kling-v3-omni-video-generation)
  - Vidu  (viduq3-* 参考生视频 / viduq3-* 首尾帧生视频)
  - HappyHorse (happyhorse-1.0-r2v 多参考图)
  - (Wan2.6 现已有专用客户端 wan2_dashscope_api.py，本模块不重复)

三家完全共享：
  - Endpoint: https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
  - Auth:     Authorization: Bearer $DASHSCOPE_API_KEY  +  X-DashScope-Async: enable
  - 异步轮询: POST 创建 task_id → GET /api/v1/tasks/{task_id}
  - 状态:     PENDING → RUNNING → SUCCEEDED / FAILED / CANCELED / UNKNOWN
  - task_id 有效期 24h

设计原则：
  - aiohttp 异步（匹配 minimax_audio.py 范式，不堵塞 FastAPI event loop）
  - 各家 schema 差异封装在专属 *_submit 方法，create_task / query_task / wait_for_completion 通用
  - 状态码大写枚举（DashScope 用 PascalCase / UPPER 不规律，统一 _normalize_status 转 lower）

Date: 2026-05-24
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import aiohttp

from services.api_provider_endpoints import derive_dashscope_video_urls
from services.api_provider_runtime import resolve_dashscope_model_name, resolve_provider

logger = logging.getLogger(__name__)


# 终态判定（大小写不敏感，DashScope 返回 PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED/UNKNOWN）
_TERMINAL_SUCCESS = {"succeeded"}
_TERMINAL_FAILED = {"failed", "canceled", "unknown"}
DEFAULT_KLING_STANDARD_MODEL = "kling/kling-v3-video-generation"
DEFAULT_KLING_OMNI_MODEL = "kling/kling-v3-omni-video-generation"


def _normalize_status(s: Optional[str]) -> str:
    return (s or "").strip().lower()


class DashScopeVideoError(RuntimeError):
    """统一异常：携带 code / message / task_id 便于上层路由返回结构化错误"""

    def __init__(
        self,
        message: str,
        *,
        code: Optional[str] = None,
        task_id: Optional[str] = None,
        http_status: Optional[int] = None,
    ):
        super().__init__(message)
        self.code = code
        self.task_id = task_id
        self.http_status = http_status


class DashScopeVideoClient:
    """阿里云百炼 DashScope 视频生成共享客户端（Kling / Vidu / HappyHorse）。"""

    def __init__(self, api_key: Optional[str] = None, timeout: int = 30):
        self._explicit_api_key = api_key
        self.api_key = ""
        self.base_url = ""
        self.create_endpoint = ""
        self._aiohttp_proxy: Optional[str] = None
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("⚠️ DASHSCOPE_API_KEY 未设置，DashScope 视频生成将失败")

    def _refresh_runtime_config(self, model: Optional[str] = None) -> None:
        config = resolve_provider("dashscope", model)
        self.api_key = self._explicit_api_key or config.api_key or ""
        self.base_url, self.create_endpoint = derive_dashscope_video_urls(config.endpoint)
        self._aiohttp_proxy = config.aiohttp_proxy()

    @property
    def _create_url(self) -> str:
        return self.create_endpoint

    def _query_url(self, task_id: str) -> str:
        return f"{self.base_url}/tasks/{task_id}"

    @property
    def _headers_create(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable",
            "Content-Type": "application/json",
        }

    @property
    def _headers_query(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    # ─── 通用 create / query / wait ─────────────────────────────────────

    async def create_task(
        self,
        model: str,
        input_payload: Dict[str, Any],
        parameters: Dict[str, Any],
    ) -> Dict[str, Any]:
        """通用任务创建。三家共用此入口。"""
        self._refresh_runtime_config(model)
        if not self.api_key:
            raise DashScopeVideoError("DASHSCOPE_API_KEY 未配置", code="MissingApiKey")

        body = {"model": model, "input": input_payload, "parameters": parameters}
        logger.info(f"🎬 DashScope 创建任务: model={model}, params={parameters}")

        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            async with session.post(
                self._create_url,
                headers=self._headers_create,
                json=body,
                proxy=self._aiohttp_proxy,
            ) as resp:
                data = await resp.json(content_type=None)
                if resp.status >= 400:
                    code = data.get("code") if isinstance(data, dict) else None
                    msg = data.get("message", f"HTTP {resp.status}") if isinstance(data, dict) else f"HTTP {resp.status}"
                    raise DashScopeVideoError(msg, code=code, http_status=resp.status)
                if not isinstance(data, dict):
                    raise DashScopeVideoError("响应格式异常", http_status=resp.status)
                task_id = data.get("output", {}).get("task_id")
                if not task_id:
                    raise DashScopeVideoError(
                        f"创建任务未返回 task_id: {data}", code="NoTaskId", http_status=resp.status
                    )
                logger.info(f"✅ DashScope 任务创建: task_id={task_id}, status={data.get('output', {}).get('task_status')}")
                return data

    async def query_task(self, task_id: str) -> Dict[str, Any]:
        """单次查询任务状态。"""
        self._refresh_runtime_config()
        if not self.api_key:
            raise DashScopeVideoError("DASHSCOPE_API_KEY 未配置", code="MissingApiKey")

        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            async with session.get(
                self._query_url(task_id),
                headers=self._headers_query,
                proxy=self._aiohttp_proxy,
            ) as resp:
                data = await resp.json(content_type=None)
                if resp.status >= 400:
                    code = data.get("code") if isinstance(data, dict) else None
                    msg = data.get("message", f"HTTP {resp.status}") if isinstance(data, dict) else f"HTTP {resp.status}"
                    raise DashScopeVideoError(msg, code=code, task_id=task_id, http_status=resp.status)
                return data if isinstance(data, dict) else {}

    async def wait_for_completion(
        self,
        task_id: str,
        *,
        max_wait: int = 600,
        poll_interval: int = 10,
    ) -> Dict[str, Any]:
        """异步轮询直到任务达到终态。"""
        elapsed = 0
        last: Dict[str, Any] = {}
        while elapsed < max_wait:
            last = await self.query_task(task_id)
            status = _normalize_status(last.get("output", {}).get("task_status"))
            logger.debug(f"⏳ DashScope task_id={task_id} status={status} elapsed={elapsed}s")
            if status in _TERMINAL_SUCCESS:
                logger.info(f"✅ DashScope 任务完成: {task_id}")
                return last
            if status in _TERMINAL_FAILED:
                out = last.get("output", {})
                raise DashScopeVideoError(
                    out.get("message") or f"任务终止({status})",
                    code=out.get("code") or status,
                    task_id=task_id,
                )
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        raise TimeoutError(f"DashScope 任务超时 ({max_wait}s): {task_id}")

    # ─── 统一派发入口（2026-05-24 新增） ──────────────────────────────────

    async def submit(
        self,
        *,
        model_name: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """按 model_name 把前端 DashScopeVideoParams dict 派发到对应 *_submit。

        作为 frontend → backend payload 透传的统一入口。前端 onChange 把
        DashScopeVideoParams 拼成 dict（含 kling_*/vidu_*/hh_* 前缀字段）后，
        直接调用 client.submit(model_name='...', params={...})；本方法负责把
        前缀字段映射到各 *_submit 的具名参数，避免 worker 层为新字段反复改 if/elif。

        Args:
            model_name: 前端使用的中文模型名——
                '合体' → Kling (kling_submit)
                '大乘' → Vidu (vidu_reference_submit / vidu_startend_submit，依 media 组合)
                '炼虚' → HappyHorse (happyhorse_submit)
            params: 前端 DashScopeVideoParams dict，字段命名见
                `new_html/services/videoService.ts::DashScopeVideoParams`
        """
        prompt = params.get("prompt") or ""
        media_inputs = params.get("media_inputs") or []
        duration = int(params.get("duration") or 5)
        audio = bool(params.get("audio") or False)
        watermark = bool(params.get("watermark") or False)

        def _urls_by_role(role: str) -> List[str]:
            return [
                m.get("url")
                for m in media_inputs
                if (m.get("role") or "").lower() == role and m.get("url")
            ]

        def _urls_by_kind(kind: str) -> List[str]:
            return [
                m.get("url")
                for m in media_inputs
                if (m.get("kind") or "").lower() == kind and m.get("url")
            ]

        if model_name == "合体":
            sub_kling = (params.get("sub_model_kling") or "standard").lower()
            kling_sub_model = "kling-omni" if sub_kling == "omni" else "kling-standard"
            kling_model = resolve_dashscope_model_name(kling_sub_model)
            first = (_urls_by_role("first_frame") or [None])[0]
            last = (_urls_by_role("last_frame") or [None])[0]
            refs = _urls_by_role("reference_image") or None
            return await self.kling_submit(
                prompt=prompt,
                model=kling_model,
                first_frame_url=first,
                last_frame_url=last,
                reference_image_urls=refs,
                mode=(params.get("mode") or "std"),
                duration=duration,
                aspect_ratio=params.get("aspect_ratio"),
                audio=audio,
                watermark=watermark,
                seed=None,  # Kling 文档明确不支持 seed
                multi_shot=bool(params.get("kling_multi_shot")),
                shot_type=params.get("kling_shot_type"),
                multi_prompt=params.get("kling_multi_prompt"),
                keep_original_sound=params.get("kling_keep_original_sound"),
            )

        if model_name == "大乘":
            sub_vidu = (params.get("sub_model_vidu") or "q3").lower()
            first = (_urls_by_role("first_frame") or [None])[0]
            last = (_urls_by_role("last_frame") or [None])[0]
            vidu_resolution = params.get("vidu_resolution") or "720P"
            vidu_audio = (
                bool(params["vidu_audio"]) if params.get("vidu_audio") is not None else audio
            )
            vidu_seed = params.get("vidu_seed")
            if vidu_seed is not None:
                vidu_seed = int(vidu_seed)
            # 首尾帧
            if first and last:
                startend_map = {
                    "q3-pro": "vidu/viduq3-pro_start-end2video",
                    "q3-turbo": "vidu/viduq3-turbo_start-end2video",
                    "q2-pro": "vidu/viduq2-pro_start-end2video",
                    "q2-turbo": "vidu/viduq2-turbo_start-end2video",
                }
                return await self.vidu_startend_submit(
                    prompt=prompt,
                    model=startend_map.get(sub_vidu, "vidu/viduq3-turbo_start-end2video"),
                    first_frame_url=first,
                    last_frame_url=last,
                    resolution=vidu_resolution,
                    duration=duration,
                    audio=vidu_audio,
                    watermark=watermark,
                    seed=vidu_seed,
                )
            # 参考生
            r2v_map = {
                "q3-mix": "vidu/viduq3-mix_reference2video",
                "q3": "vidu/viduq3_reference2video",
                "q3-turbo": "vidu/viduq3-turbo_reference2video",
                "q2-pro": "vidu/viduq2-pro_reference2video",
                "q2": "vidu/viduq2_reference2video",
            }
            ref_imgs = _urls_by_role("reference_image") or _urls_by_kind("image") or None
            ref_videos = _urls_by_kind("video") or None
            return await self.vidu_reference_submit(
                prompt=prompt,
                model=r2v_map.get(sub_vidu, "vidu/viduq3_reference2video"),
                reference_image_urls=ref_imgs,
                reference_video_urls=ref_videos,
                resolution=vidu_resolution,
                size=params.get("vidu_size"),
                duration=duration,
                audio=vidu_audio,
                watermark=watermark,
                seed=vidu_seed,
            )

        if model_name == "炼虚":
            ref_imgs = _urls_by_kind("image")
            hh_watermark = params.get("hh_watermark")
            hh_seed = params.get("hh_seed")
            if hh_seed is not None:
                hh_seed = int(hh_seed)
            return await self.happyhorse_submit(
                prompt=prompt,
                reference_image_urls=ref_imgs,
                resolution=params.get("hh_resolution") or "1080P",
                ratio=params.get("hh_ratio") or "16:9",
                duration=int(params.get("hh_duration") or duration),
                watermark=bool(hh_watermark) if hh_watermark is not None else True,
                seed=hh_seed,
            )

        raise DashScopeVideoError(
            f"未知 model_name: {model_name!r}（应为 '合体'/'大乘'/'炼虚'）",
            code="UnknownModel",
        )

    # ─── Kling (kling/kling-v3-*) ───────────────────────────────────────

    async def kling_submit(
        self,
        prompt: str,
        *,
        model: str = "kling/kling-v3-video-generation",
        first_frame_url: Optional[str] = None,
        last_frame_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        video_url: Optional[str] = None,
        mode: str = "std",
        duration: int = 5,
        aspect_ratio: Optional[str] = None,
        audio: bool = False,
        watermark: bool = False,
        seed: Optional[int] = None,
        # 2026-05-24：多镜头能力（kling-v3-* 独有，文生/参考生均可）
        multi_shot: bool = False,
        shot_type: Optional[str] = None,           # 'intelligence' | 'customize'
        multi_prompt: Optional[List[Dict[str, Any]]] = None,
        # omni 模式下 type=base/feature 视频是否保留原声 ('yes' | 'no')
        keep_original_sound: Optional[str] = None,
    ) -> Dict[str, Any]:
        """提交 Kling 视频生成任务（文生/首帧/首尾帧/参考生）。

        模式判定（按 media 组合）：
          - 无 media + prompt only:          文生视频
          - first_frame only:                图生视频-基于首帧
          - first_frame + last_frame:        图生视频-基于首尾帧
          - reference (omni only):           参考生视频（refer 1-7 张）
          - video_url (omni only):           参考生视频（base/feature）

        2026-05-24 新增多镜头：multi_shot=True 时把 shot_type/(customize 时)multi_prompt
        塞进 input 顶层；shot_type=intelligence 由 Kling 自动切分，customize 由
        前端传入 1-6 段分镜（{index, prompt, duration}）。
        """
        media: List[Dict[str, Any]] = []
        if first_frame_url:
            media.append({"type": "first_frame", "url": first_frame_url})
        if last_frame_url:
            media.append({"type": "last_frame", "url": last_frame_url})
        if reference_image_urls:
            for u in reference_image_urls:
                media.append({"type": "refer", "url": u})
        if video_url:
            base_entry: Dict[str, Any] = {"type": "base", "url": video_url}
            if keep_original_sound:
                base_entry["keep_original_sound"] = keep_original_sound
            media.append(base_entry)

        input_payload: Dict[str, Any] = {"prompt": prompt}
        if media:
            input_payload["media"] = media

        # 2026-05-24：多镜头模式塞 input 顶层（与 prompt/media 同级）
        if multi_shot:
            input_payload["multi_shot"] = True
            input_payload["shot_type"] = shot_type or "intelligence"
            if input_payload["shot_type"] == "customize" and multi_prompt:
                input_payload["multi_prompt"] = multi_prompt

        params: Dict[str, Any] = {
            "mode": mode,
            "duration": duration,
            "audio": audio,
            "watermark": watermark,
        }
        # aspect_ratio: 文生 / 仅参考必填；首帧/首尾帧以图为基准不传
        if aspect_ratio and not first_frame_url:
            params["aspect_ratio"] = aspect_ratio
        if seed is not None:
            params["seed"] = seed

        if model == DEFAULT_KLING_OMNI_MODEL:
            model = resolve_dashscope_model_name("kling-omni")
        elif model == DEFAULT_KLING_STANDARD_MODEL:
            model = resolve_dashscope_model_name("kling-standard")

        return await self.create_task(model, input_payload, params)

    # ─── Vidu (vidu/viduq3-*) ───────────────────────────────────────────

    async def vidu_reference_submit(
        self,
        prompt: str,
        *,
        model: str = "vidu/viduq3_reference2video",
        reference_image_urls: Optional[List[str]] = None,
        reference_video_urls: Optional[List[str]] = None,
        resolution: str = "720P",
        size: Optional[str] = None,
        duration: int = 5,
        audio: bool = False,
        watermark: bool = False,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Vidu 参考生视频：1-7 张参考图（部分模型支持 + 1-2 段参考视频）"""
        if not reference_image_urls and not reference_video_urls:
            raise DashScopeVideoError("Vidu 参考生视频至少需要 1 张参考图或视频", code="InvalidParameter")

        media: List[Dict[str, str]] = []
        for u in (reference_video_urls or []):
            media.append({"type": "video", "url": u})
        for u in (reference_image_urls or []):
            media.append({"type": "image", "url": u})

        input_payload = {"prompt": prompt, "media": media}
        params: Dict[str, Any] = {
            "duration": duration,
            "resolution": resolution,
            "audio": audio,
            "watermark": watermark,
        }
        if size:
            params["size"] = size
        if seed is not None:
            params["seed"] = seed
        return await self.create_task(model, input_payload, params)

    async def vidu_startend_submit(
        self,
        prompt: str,
        *,
        model: str = "vidu/viduq3-turbo_start-end2video",
        first_frame_url: str,
        last_frame_url: str,
        resolution: str = "720P",
        duration: int = 5,
        audio: bool = False,
        watermark: bool = False,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Vidu 首尾帧生视频：media 顺序固定 [首帧, 尾帧]，两图分辨率比 0.8~1.25"""
        if not first_frame_url or not last_frame_url:
            raise DashScopeVideoError("Vidu 首尾帧必须同时提供首帧和尾帧", code="InvalidParameter")

        input_payload = {
            "prompt": prompt,
            "media": [
                {"type": "image", "url": first_frame_url},
                {"type": "image", "url": last_frame_url},
            ],
        }
        params: Dict[str, Any] = {
            "resolution": resolution,
            "duration": duration,
            "audio": audio,
            "watermark": watermark,
        }
        if seed is not None:
            params["seed"] = seed
        return await self.create_task(model, input_payload, params)

    # ─── HappyHorse (happyhorse-1.0-r2v) ────────────────────────────────

    async def happyhorse_submit(
        self,
        prompt: str,
        *,
        reference_image_urls: List[str],
        resolution: str = "720P",
        ratio: str = "16:9",
        duration: int = 5,
        watermark: bool = False,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:
        """HappyHorse 多图参考生视频（1-9 张），prompt 可用 [Image 1]/[Image 2]/... 引用。"""
        if not reference_image_urls:
            raise DashScopeVideoError("HappyHorse 至少需要 1 张参考图", code="InvalidParameter")
        if len(reference_image_urls) > 9:
            raise DashScopeVideoError("HappyHorse 最多支持 9 张参考图", code="InvalidParameter")

        input_payload = {
            "prompt": prompt,
            "media": [{"type": "reference_image", "url": u} for u in reference_image_urls],
        }
        params: Dict[str, Any] = {
            "resolution": resolution,
            "ratio": ratio,
            "duration": duration,
            "watermark": watermark,
        }
        if seed is not None:
            params["seed"] = seed
        return await self.create_task("happyhorse-1.0-r2v", input_payload, params)

    # ─── 视频结果提取助手 ─────────────────────────────────────────────────

    @staticmethod
    def extract_video_url(task_result: Dict[str, Any], prefer_watermark: bool = False) -> Optional[str]:
        """从 query_task / wait_for_completion 的返回里抽取视频 URL。
        Kling 同时返回 video_url 和 watermark_video_url；
        Vidu / HappyHorse 仅 video_url。
        """
        out = task_result.get("output", {}) if isinstance(task_result, dict) else {}
        if prefer_watermark:
            return out.get("watermark_video_url") or out.get("video_url")
        return out.get("video_url") or out.get("watermark_video_url")


# 模块级单例（按需 lazy init）
_default_client: Optional[DashScopeVideoClient] = None


def get_dashscope_video_client() -> DashScopeVideoClient:
    """获取共享客户端实例（每次读取最新 env，免重启刷 admin Key）"""
    global _default_client
    if _default_client is None:
        _default_client = DashScopeVideoClient()
    return _default_client
