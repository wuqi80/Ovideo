# -*- coding: utf-8 -*-
"""
MiniMax 音频 API 客户端
支持声音设计、声音克隆、异步 TTS、音乐生成、歌词生成、文件管理
API 文档: https://platform.minimaxi.com/document/
"""

import os
import re
import time
import uuid
import logging
import asyncio
import aiohttp
from typing import Optional, Dict, Any, List
from pathlib import Path

from services.api_provider_registry import MINIMAX_DEFAULT_PROVIDER_MODEL
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)

AUDIO_UPLOAD_DIR = os.getenv("AUDIO_UPLOAD_DIR", "persistent_storage/audio")

# MiniMax t2a_async_query_v2 status：文档 enum 为小写，示例偶发 PascalCase
_TTS_TERMINAL_SUCCESS = frozenset({"success"})
_TTS_TERMINAL_FAILED = frozenset({"failed", "expired"})
_TTS_SUPPORTED_EMOTIONS = frozenset(
    {
        "happy",
        "sad",
        "angry",
        "fearful",
        "disgusted",
        "surprised",
        "calm",
        "fluent",
        "whipser",
    }
)
_TTS_EMOTION_ALIASES = {
    "excited": "happy",
    "whisper": "whipser",
    "兴奋": "happy",
    "快乐": "happy",
    "开心": "happy",
    "高兴": "happy",
    "悲伤": "sad",
    "难过": "sad",
    "愤怒": "angry",
    "生气": "angry",
    "恐惧": "fearful",
    "害怕": "fearful",
    "厌恶": "disgusted",
    "惊讶": "surprised",
    "吃惊": "surprised",
    "平静": "calm",
    "冷静": "calm",
    "流畅": "fluent",
    "耳语": "whipser",
    "低语": "whipser",
}


def _is_token_plan_access(api_key: str, access_mode: str = "") -> bool:
    """MiniMax Token Plan keys must not be paired with the legacy GroupId."""
    normalized_mode = re.sub(r"[\s_-]+", "", str(access_mode or "").strip().lower())
    return str(api_key or "").strip().lower().startswith("sk-cp-") or normalized_mode == "tokenplan"


def _normalize_task_status(result: Dict[str, Any]) -> str:
    return str(result.get("status") or "").strip().lower()


def _generate_voice_id(prefix: str = "clone") -> str:
    """MiniMax voice_id: 8-256 字符，首字符英文字母，允许字母数字-_"""
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", prefix or "voice")
    if not safe or not safe[0].isalpha():
        safe = f"voice_{safe}"
    vid = f"{safe}_{uuid.uuid4().hex[:8]}"
    return vid[:256].rstrip("-_")


def _map_emotion_for_tts(emotion: Optional[str]) -> Optional[str]:
    """Normalize UI and legacy values to MiniMax's supported emotion enum."""
    normalized = str(emotion or "").strip().lower()
    if normalized in ("", "neutral", "auto", "中性", "默认"):
        return None
    mapped = _TTS_EMOTION_ALIASES.get(normalized, normalized)
    if mapped in _TTS_SUPPORTED_EMOTIONS:
        return mapped
    logger.warning("Ignoring unsupported MiniMax TTS emotion: %r", emotion)
    return None


def _raise_for_minimax_response(action: str, http_status: int, data: Dict[str, Any]) -> None:
    """Raise a diagnostic error for MiniMax responses without leaking API keys."""
    base_resp = data.get("base_resp") if isinstance(data, dict) else {}
    if not isinstance(base_resp, dict):
        base_resp = {}
    status_code = base_resp.get("status_code", 0)
    if http_status == 200 and status_code == 0:
        return

    parts = [f"http_status={http_status}", f"status_code={status_code}"]
    status_msg = base_resp.get("status_msg")
    if status_msg:
        parts.append(f"status_msg={status_msg}")
    trace_id = data.get("trace_id") if isinstance(data, dict) else None
    if trace_id:
        parts.append(f"trace_id={trace_id}")
    parts.append(f"body={str(data)[:300]}")
    raise RuntimeError(f"{action} failed: " + " ".join(parts))


class MinimaxAudioClient:
    """MiniMax 音频 API 客户端"""

    def __init__(self, api_key: Optional[str] = None, group_id: Optional[str] = None):
        self._explicit_api_key = api_key
        self._explicit_group_id = group_id
        self.api_key = ""
        self.group_id = ""
        self.provider_access_mode = ""
        self.base_url = ""
        self.headers: Dict[str, str] = {}
        self._runtime_config = None
        self._aiohttp_proxy: Optional[str] = None
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("MINIMAX_API_KEY 未设置，音频功能不可用")

    def _refresh_runtime_config(self) -> None:
        config = resolve_provider("minimax", MINIMAX_DEFAULT_PROVIDER_MODEL)
        self._runtime_config = config
        self.api_key = self._explicit_api_key or config.api_key or ""
        extra = getattr(config, "extra", {}) or {}
        self.group_id = self._explicit_group_id or extra.get("group_id") or ""
        self.provider_access_mode = str(extra.get("provider_access_mode") or "")
        self.base_url = config.endpoint.rstrip("/")
        self._aiohttp_proxy = config.aiohttp_proxy()
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def _aiohttp_kwargs(self) -> Dict[str, Any]:
        return {"proxy": self._aiohttp_proxy} if self._aiohttp_proxy else {}

    def _group_params(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        out = dict(params or {})
        if self.group_id and not _is_token_plan_access(self.api_key, self.provider_access_mode):
            out.setdefault("GroupId", self.group_id)
        return out

    def _url(self, operation: str) -> str:
        self._refresh_runtime_config()
        if not self._runtime_config:
            raise RuntimeError("MiniMax runtime config is not available")
        url = self._runtime_config.url_for_operation(operation)
        if not url or url.rstrip("/") == self.base_url.rstrip("/"):
            raise RuntimeError(f"MiniMax API operation is not registered: {operation}")
        return url

    async def _request_json(
        self,
        method: str,
        operation: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        action: Optional[str] = None,
        timeout: Optional[aiohttp.ClientTimeout] = None,
        attempts: int = 1,
        retry_delay: float = 0.0,
        raise_http_text: bool = False,
    ) -> Dict[str, Any]:
        """Run a MiniMax JSON request through the resolved runtime config."""
        url = self._url(operation)
        request_kwargs: Dict[str, Any] = {
            "params": self._group_params(params),
            "headers": headers or self.headers,
            **self._aiohttp_kwargs(),
        }
        if json is not None:
            request_kwargs["json"] = json

        label = action or f"{method.upper()} {operation}"
        last_err: Optional[BaseException] = None
        for attempt in range(max(1, attempts)):
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    request = getattr(session, method.lower())
                    async with request(url, **request_kwargs) as resp:
                        if raise_http_text and resp.status != 200:
                            body = await resp.text()
                            raise RuntimeError(
                                f"{label} failed: http_status={resp.status} body={body[:300]}"
                            )
                        data = await resp.json()
                        if action:
                            _raise_for_minimax_response(action, resp.status, data)
                        return data
            except (asyncio.TimeoutError, aiohttp.ClientError) as e:
                last_err = e
                logger.warning(
                    "%s attempt %d failed: %s (%s)",
                    label,
                    attempt + 1,
                    type(e).__name__,
                    str(e)[:200],
                )
                if attempt + 1 < max(1, attempts):
                    if retry_delay > 0:
                        await asyncio.sleep(retry_delay)
                    continue
                raise RuntimeError(
                    f"{label} failed: consecutive {max(1, attempts)} network errors "
                    f"last_err={type(e).__name__}: {e}"
                ) from e

        raise RuntimeError(f"{label} failed: no response last_err={last_err}")

    async def _download_bytes(self, url: str, *, action: str) -> bytes:
        """Download binary audio with the current runtime proxy settings."""
        self._refresh_runtime_config()
        async with aiohttp.ClientSession() as session:
            async with session.get(url, **self._aiohttp_kwargs()) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(
                        f"{action} failed: http_status={resp.status} body={body[:300]}"
                    )
                return await resp.read()

    async def _request_form_json(
        self,
        operation: str,
        form: aiohttp.FormData,
        *,
        headers: Dict[str, str],
        action: str,
    ) -> Dict[str, Any]:
        """Run a MiniMax multipart form request through the resolved runtime config."""
        async with aiohttp.ClientSession() as session:
            async with session.post(
                self._url(operation),
                params=self._group_params(),
                data=form,
                headers=headers,
                **self._aiohttp_kwargs(),
            ) as resp:
                data = await resp.json()
                _raise_for_minimax_response(action, resp.status, data)
                return data

    # ------------------------------------------------------------------
    # 声音设计  POST /v1/voice_design
    # ------------------------------------------------------------------
    async def voice_design(
        self,
        prompt: str,
        preview_text: str,
        voice_id: Optional[str] = None,
        aigc_watermark: bool = False,
    ) -> Dict[str, Any]:
        """
        音色设计 POST /v1/voice_design
        - prompt: 音色描述文本
        - preview_text: 试听合成文本（≤500 字符）
        返回 { voice_id, trial_audio(hex), audio_url, duration_ms, base_resp }

        额外行为：把 trial_audio hex 写到本地 AUDIO_UPLOAD_DIR 并附加
        audio_url（/storage/audio/voice_design_xxx.mp3），让前端能跟 system
        TTS / clone demo 一样直接 <audio> 播放并持久化到 sample_audio_url。
        """
        payload: Dict[str, Any] = {
            "prompt": prompt,
            "preview_text": preview_text,
        }
        if voice_id:
            payload["voice_id"] = voice_id
        if aigc_watermark:
            payload["aigc_watermark"] = aigc_watermark
        data = await self._request_json(
            "post",
            "voice_design",
            json=payload,
            action="voice_design",
        )

        trial_hex = data.get("trial_audio") or ""
        if trial_hex:
            try:
                audio_bytes = bytes.fromhex(trial_hex)
                Path(AUDIO_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
                filename = f"voice_design_{uuid.uuid4().hex[:8]}.mp3"
                filepath = os.path.join(AUDIO_UPLOAD_DIR, filename)
                with open(filepath, "wb") as f:
                    f.write(audio_bytes)
                data["audio_url"] = f"/storage/audio/{filename}"
                data["duration_ms"] = self._estimate_mp3_duration(len(audio_bytes))
            except Exception as e:
                logger.warning(f"voice_design 试听音频保存失败: {e}")
        return data

    # ------------------------------------------------------------------
    # 声音克隆  POST /v1/voice_clone
    # ------------------------------------------------------------------
    async def voice_clone(
        self,
        file_id: str,
        voice_id: Optional[str] = None,
        model: str = "speech-2.8-hd",
        demo_text: Optional[str] = "你好，这是一段测试语音。",
        voice_id_prefix: str = "clone",
    ) -> Dict[str, Any]:
        """
        音色快速复刻 POST /v1/voice_clone
        - file_id: 上传音频的 file_id（purpose=voice_clone）
        - voice_id: 必填；未传则自动生成符合 MiniMax 规则的 id
        - demo_text: 传入时触发试听合成，需同时传 model

        返回 { voice_id, demo_audio?, audio_url?, base_resp }。如果 MiniMax
        返回 demo_audio（临时 URL），会自动下载到 AUDIO_UPLOAD_DIR 并附加
        audio_url，避免外链失效。
        """
        resolved_voice_id = voice_id or _generate_voice_id(voice_id_prefix)
        payload: Dict[str, Any] = {
            "file_id": int(file_id) if str(file_id).isdigit() else file_id,
            "voice_id": resolved_voice_id,
        }
        if demo_text:
            payload["text"] = demo_text
            payload["model"] = model
        data = await self._request_json(
            "post",
            "voice_clone",
            json=payload,
            action="voice_clone",
        )
        data.setdefault("voice_id", resolved_voice_id)

        demo_url = data.get("demo_audio") or ""
        if demo_url and demo_url.startswith("http"):
            try:
                audio_bytes = await self._download_bytes(demo_url, action="voice_clone_demo")
                Path(AUDIO_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
                filename = f"voice_clone_{uuid.uuid4().hex[:8]}.mp3"
                filepath = os.path.join(AUDIO_UPLOAD_DIR, filename)
                with open(filepath, "wb") as f:
                    f.write(audio_bytes)
                data["audio_url"] = f"/storage/audio/{filename}"
                data["duration_ms"] = self._estimate_mp3_duration(len(audio_bytes))
            except Exception as e:
                logger.warning(f"voice_clone 试听音频下载失败: {e}")
        return data

    # ------------------------------------------------------------------
    # 获取声音  GET /v1/get_voice
    # ------------------------------------------------------------------
    async def list_voices(self, voice_type: str = "all") -> Dict[str, Any]:
        """查询可用音色 POST /v1/get_voice"""
        payload = {"voice_type": voice_type}
        return await self._request_json(
            "post",
            "get_voice",
            json=payload,
            action="list_voices",
        )

    async def get_voice(self, voice_id: str) -> Dict[str, Any]:
        """从 list_voices(all) 结果中查找单个 voice_id"""
        data = await self.list_voices("all")
        for bucket in ("system_voice", "voice_cloning", "voice_generation"):
            for item in data.get(bucket) or []:
                if item.get("voice_id") == voice_id:
                    return {"voice": item, "bucket": bucket, **data}
        return {"voice": None, "voice_id": voice_id, **data}

    # ------------------------------------------------------------------
    # 删除声音  POST /v1/delete_voice
    # ------------------------------------------------------------------
    async def delete_voice(
        self, voice_id: str, voice_type: str = "voice_cloning"
    ) -> Dict[str, Any]:
        payload = {"voice_type": voice_type, "voice_id": voice_id}
        return await self._request_json(
            "post",
            "delete_voice",
            json=payload,
            action="delete_voice",
        )

    # ------------------------------------------------------------------
    # 同步 TTS  POST /v1/t2a_v2
    # ------------------------------------------------------------------
    # 2026-05-24：从 t2a_async_v2 切回 t2a_v2。MiniMax 自家 async 队列偶发排队
    # 30s ~ 5min+，触发我们的 worker 端 TimeoutError。
    # sync 接口典型 5-15s 返回 hex 音频，文本 <10000 字符（试听 12 字 / 配音
    # 对白通常 <500 字均远低于上限）。
    # 详见 recurring-pitfalls.md §R（外部 API async/sync 选择）。
    # ------------------------------------------------------------------
    async def tts_sync(
        self,
        text: str,
        voice_id: str,
        model: str = "speech-2.8-hd",
        speed: float = 1.0,
        pitch: int = 0,
        emotion: str = "neutral",
        audio_format: str = "mp3",
        sample_rate: int = 32000,
        bitrate: int = 128000,
        language_boost: str = "auto",
    ) -> Dict[str, Any]:
        """同步 TTS：单次 HTTP POST 拿到 hex 音频，本地落盘。

        返回 { audio_url, duration_ms, trace_id, mime }。
        失败抛 RuntimeError / ValueError，调用方（worker）捕获后写到任务表。
        """
        if not text or not text.strip():
            raise ValueError("tts_sync: text 不能为空")
        if len(text) > 10000:
            raise ValueError(f"tts_sync: text 超长 ({len(text)} > 10000)，请改用流式或拆段")

        voice_setting: Dict[str, Any] = {
            "voice_id": voice_id,
            "speed": speed,
            "pitch": pitch,
        }
        mapped_emotion = _map_emotion_for_tts(emotion)
        if mapped_emotion:
            voice_setting["emotion"] = mapped_emotion

        payload = {
            "model": model,
            "text": text,
            "stream": False,
            "output_format": "hex",
            "voice_setting": voice_setting,
            "audio_setting": {
                "format": audio_format,
                "sample_rate": sample_rate,
                "bitrate": bitrate,
            },
        }
        if language_boost and language_boost != "auto":
            payload["language_boost"] = language_boost
        elif language_boost == "auto":
            payload["language_boost"] = "auto"

        # 2026-05-25：显式 ClientTimeout + 1 次重试。
        # 原实现用默认 timeout（aiohttp 默认 total=5min），MiniMax 偶发慢响应
        # 会让单个 worker 被一条请求挂死 5min，期间该 worker 不消费新任务，
        # 用户体感"一直 loading"但 worker 端无任何日志（卡在 socket 上）。
        # 详见 recurring-pitfalls.md §R / §G。
        timeout = aiohttp.ClientTimeout(total=60, connect=10, sock_read=45)
        data = await self._request_json(
            "post",
            "tts_sync",
            json=payload,
            action="tts_sync",
            timeout=timeout,
            attempts=2,
            retry_delay=1.0,
            raise_http_text=True,
        )

        base_resp = data.get("base_resp") or {}
        base_code = base_resp.get("status_code", 0)
        if base_code != 0:
            raise RuntimeError(
                f"tts_sync 失败: status_code={base_code} msg={base_resp.get('status_msg')} "
                f"trace_id={data.get('trace_id')}"
            )

        audio_hex = (data.get("data") or {}).get("audio")
        if not audio_hex:
            raise RuntimeError(
                f"tts_sync 失败: 响应里没有 data.audio  trace_id={data.get('trace_id')}"
            )

        try:
            audio_bytes = bytes.fromhex(audio_hex)
        except ValueError as e:
            raise RuntimeError(f"tts_sync 失败: hex 解码错误 {e}") from e

        Path(AUDIO_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
        ext = audio_format if audio_format in ("mp3", "wav", "flac") else "mp3"
        filename = f"tts_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = os.path.join(AUDIO_UPLOAD_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(audio_bytes)

        extra_info = data.get("extra_info") or {}
        duration_ms = extra_info.get("audio_length")
        if not isinstance(duration_ms, int) or duration_ms <= 0:
            # MiniMax 没回 audio_length 时退回到 bitrate 估算
            duration_ms = self._estimate_mp3_duration(len(audio_bytes), bitrate=bitrate)

        mime = {
            "mp3": "audio/mpeg", "wav": "audio/wav", "flac": "audio/flac",
        }.get(ext, "audio/mpeg")

        logger.info(
            "MiniMax TTS sync 完成: bytes=%d duration_ms=%d trace_id=%s file=%s",
            len(audio_bytes), duration_ms, data.get("trace_id"), filename,
        )

        # 2026-05-25：明确分开 web URL 和磁盘路径两个字段，根治 §F 命名空间错乱
        # （worker._process_minimax_tts_task 之前把 audio_url 当磁盘路径用导致
        # FileNotFoundError）。新调用方约定：
        #   - audio_url:  给前端 / DB / 外部回写用的 web URL（持久化形态）
        #   - local_path: 给 worker / 后台进程读取文件字节用的磁盘绝对路径
        #   - audio_bytes:已经在内存中的字节，调用方可直接交给入库函数避免再读一次
        return {
            "audio_url": f"/storage/audio/{filename}",
            "local_path": filepath,
            "audio_bytes": audio_bytes,
            "duration_ms": duration_ms,
            "trace_id": data.get("trace_id"),
            "mime": mime,
        }

    # ------------------------------------------------------------------
    # 异步 TTS  POST /v1/t2a_async_v2
    # ------------------------------------------------------------------
    async def tts_async(
        self,
        text: str,
        voice_id: str,
        model: str = "speech-2.8-hd",
        speed: float = 1.0,
        pitch: int = 0,
        emotion: str = "neutral",
        audio_format: str = "mp3",
        sample_rate: int = 32000,
        bitrate: int = 128000,
        language_boost: str = "auto",
    ) -> Dict[str, Any]:
        """
        创建异步 TTS 任务，返回 task_id。
        """
        voice_setting: Dict[str, Any] = {
            "voice_id": voice_id,
            "speed": speed,
            "pitch": pitch,
        }
        mapped_emotion = _map_emotion_for_tts(emotion)
        if mapped_emotion:
            voice_setting["emotion"] = mapped_emotion

        payload = {
            "model": model,
            "text": text,
            "voice_setting": voice_setting,
            "audio_setting": {
                "format": audio_format,
                "audio_sample_rate": sample_rate,
                "bitrate": bitrate,
            },
            "language_boost": language_boost,
        }
        return await self._request_json(
            "post",
            "tts_async",
            json=payload,
            action="tts_async",
        )

    # ------------------------------------------------------------------
    # 查询 TTS 任务  GET /v1/query/t2a_async_query_v2
    # ------------------------------------------------------------------
    async def tts_query(self, task_id: str) -> Dict[str, Any]:
        params = {"task_id": task_id}
        return await self._request_json(
            "get",
            "tts_query",
            params=params,
        )

    async def tts_wait_and_download(
        self,
        task_id: str,
        max_wait: int = 300,
        poll_interval: float = 3.0,
    ) -> Dict[str, Any]:
        """
        轮询 TTS 任务直到完成，然后下载音频文件并保存到本地。
        返回 { audio_url, duration_ms, file_id }

        默认 max_wait=300s（5 分钟）：MiniMax t2a_async_v2 对长旁白
        （>500 字）或服务排队期偶发耗时 60-180s，120s 临界容易超时。
        autodl 反代 idle timeout 约 5 分钟，再大就会被反代截断。
        """
        start = time.time()
        file_id = None
        while time.time() - start < max_wait:
            result = await self.tts_query(task_id)
            base_code = result.get("base_resp", {}).get("status_code", 0)
            if base_code not in (0, None):
                raise RuntimeError(f"TTS 查询失败: {result}")
            status = _normalize_task_status(result)
            logger.debug(
                "MiniMax TTS poll task_id=%s status=%s raw=%s elapsed=%.1fs",
                task_id, status, result.get("status"), time.time() - start,
            )
            if status in _TTS_TERMINAL_SUCCESS:
                file_id = result.get("file_id")
                break
            if status in _TTS_TERMINAL_FAILED:
                raise RuntimeError(f"TTS 任务失败: {result}")
            await asyncio.sleep(poll_interval)
        else:
            raise TimeoutError(f"TTS 任务超时: {task_id}")

        if not file_id:
            raise RuntimeError(f"TTS 完成但无 file_id: {task_id}")

        file_info = await self.file_retrieve(file_id)
        download_url = file_info.get("file", {}).get("download_url")
        if not download_url:
            raise RuntimeError(f"未获取到 TTS 下载 URL: {file_id}")

        Path(AUDIO_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
        filename = f"tts_{uuid.uuid4().hex[:8]}.mp3"
        filepath = os.path.join(AUDIO_UPLOAD_DIR, filename)

        content = await self._download_bytes(download_url, action="tts_download")
        with open(filepath, "wb") as f:
            f.write(content)

        duration_ms = self._estimate_mp3_duration(len(content))

        return {
            "audio_url": f"/storage/audio/{filename}",
            "duration_ms": duration_ms,
            "file_id": file_id,
        }

    @staticmethod
    def _estimate_mp3_duration(byte_length: int, bitrate: int = 128000) -> int:
        """Rough mp3 duration estimate from file size."""
        if byte_length <= 0:
            return 0
        return int(byte_length * 8 / bitrate * 1000)

    # ------------------------------------------------------------------
    # 音乐生成  POST /v1/music_generation
    # ------------------------------------------------------------------
    async def music_generate(
        self,
        lyrics: str = "",
        refer_voice: str = "",
        refer_instrumental: str = "",
        model: str = "music-01",
        audio_format: str = "mp3",
        sample_rate: int = 44100,
        bitrate: int = 256000,
    ) -> Dict[str, Any]:
        """
        生成音乐，返回含 audio (hex) 的结果。
        lyrics: 歌词文本
        refer_voice: 参考演唱音频 (file_id)
        refer_instrumental: 参考伴奏 (file_id)
        """
        payload = {
            "model": model,
            "audio_setting": {
                "format": audio_format,
                "sample_rate": sample_rate,
                "bitrate": bitrate,
            },
        }
        if lyrics:
            payload["lyrics"] = lyrics
        if refer_voice:
            payload["refer_voice"] = refer_voice
        if refer_instrumental:
            payload["refer_instrumental"] = refer_instrumental

        data = await self._request_json(
            "post",
            "music_generation",
            json=payload,
            action="music_generate",
        )

        audio_hex = data.get("data", {}).get("audio", "")
        if audio_hex:
            Path(AUDIO_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
            filename = f"music_{uuid.uuid4().hex[:8]}.mp3"
            filepath = os.path.join(AUDIO_UPLOAD_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(bytes.fromhex(audio_hex))
            data["audio_url"] = f"/storage/audio/{filename}"
            data["duration_ms"] = self._estimate_mp3_duration(
                len(audio_hex) // 2, bitrate
            )

        return data

    # ------------------------------------------------------------------
    # 歌词生成  POST /v1/lyrics_generation
    # ------------------------------------------------------------------
    async def lyrics_generate(
        self,
        text: str,
        language: str = "zh",
    ) -> Dict[str, Any]:
        # Current MiniMax lyrics API uses mode + prompt.  Keep ``language`` in
        # the public client signature for callers that still pass it, but do
        # not send the removed legacy field to the provider.
        del language
        payload = {
            "mode": "write_full_song",
            "prompt": text,
        }
        return await self._request_json(
            "post",
            "lyrics_generation",
            json=payload,
            action="lyrics_generate",
        )

    # ------------------------------------------------------------------
    # 文件上传  POST /v1/files/upload
    # ------------------------------------------------------------------
    async def file_upload(
        self, file_path: str, purpose: str = "voice_clone"
    ) -> Dict[str, Any]:
        """
        上传文件到 MiniMax，返回 { file_id, ... }
        purpose: voice_clone / refer_voice / refer_instrumental
        """
        self._refresh_runtime_config()
        headers = {"Authorization": f"Bearer {self.api_key}"}
        form = aiohttp.FormData()
        form.add_field("purpose", purpose)
        with open(file_path, "rb") as file_obj:
            form.add_field(
                "file",
                file_obj,
                filename=os.path.basename(file_path),
            )
            return await self._request_form_json(
                "files_upload",
                form,
                headers=headers,
                action="file_upload",
            )

    # ------------------------------------------------------------------
    # 文件查询  GET /v1/files/retrieve
    # ------------------------------------------------------------------
    async def file_retrieve(self, file_id: str) -> Dict[str, Any]:
        params = {"file_id": file_id}
        return await self._request_json("get", "files_retrieve", params=params)

    # ------------------------------------------------------------------
    # 文件删除  DELETE /v1/files/delete
    # ------------------------------------------------------------------
    async def file_delete(self, file_id: str) -> Dict[str, Any]:
        payload = {"file_id": file_id}
        return await self._request_json("delete", "files_delete", json=payload)


# 全局单例
_minimax_audio_client: Optional[MinimaxAudioClient] = None


def get_minimax_audio_client() -> MinimaxAudioClient:
    global _minimax_audio_client
    if _minimax_audio_client is None:
        _minimax_audio_client = MinimaxAudioClient()
    else:
        _minimax_audio_client._refresh_runtime_config()
    return _minimax_audio_client
