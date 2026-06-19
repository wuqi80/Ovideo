# -*- coding: utf-8 -*-
"""
音频服务抽象层 - 支持多 Provider (Gemini, Minimax, Doubao 等)
"""
import os
import uuid
import logging
from typing import Dict, Any, Optional
from pathlib import Path

from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)

AUDIO_UPLOAD_DIR = os.getenv("AUDIO_UPLOAD_DIR", "persistent_storage/audio")
DEFAULT_GEMINI_API_VERSION = "v1beta"


def _derive_gemini_sdk_endpoint(endpoint: str) -> tuple[str, str]:
    """Convert admin endpoint config into google-genai http_options pieces."""
    value = (endpoint or "").strip().rstrip("/")
    if not value:
        return "", DEFAULT_GEMINI_API_VERSION

    parts = value.split("/")
    api_version = DEFAULT_GEMINI_API_VERSION
    version_index = -1
    for idx, part in enumerate(parts):
        if part in {"v1", "v1beta"}:
            api_version = part
            version_index = idx
            break

    if version_index >= 0:
        base_url = "/".join(parts[:version_index]).rstrip("/")
    else:
        base_url = value

    if base_url.endswith("/openai"):
        base_url = base_url[: -len("/openai")]
    return base_url, api_version


def _build_gemini_http_options(config: Any) -> Optional[dict]:
    base_url, api_version = _derive_gemini_sdk_endpoint(getattr(config, "endpoint", ""))
    options: dict[str, Any] = {}
    if base_url:
        options["baseUrl"] = base_url
    if api_version:
        options["apiVersion"] = api_version

    proxy = config.aiohttp_proxy() if hasattr(config, "aiohttp_proxy") else None
    if proxy:
        # google-genai uses httpx by default; pass both sync and async client args.
        options["clientArgs"] = {"proxy": proxy}
        options["asyncClientArgs"] = {"proxy": proxy}
    return options or None


class AudioProvider:
    """音频服务基类 - 所有 provider 必须实现这些方法"""

    async def generate_speech(
        self, text: str, persona: str = 'narrator', emotion: str = 'neutral',
        **kwargs
    ) -> Dict[str, Any]:
        raise NotImplementedError("Subclass must implement generate_speech")

    async def generate_sfx(self, description: str, **kwargs) -> Dict[str, Any]:
        raise NotImplementedError("Subclass must implement generate_sfx")

    async def generate_music(
        self, description: str, duration_ms: Optional[int] = None, **kwargs
    ) -> Dict[str, Any]:
        raise NotImplementedError("Subclass must implement generate_music")


class GeminiAudioProvider(AudioProvider):
    """Gemini API 音频实现"""

    def __init__(self):
        self.api_key = ""
        self.endpoint = ""
        self._genai_http_options: Optional[dict] = None
        self._refresh_runtime_config()

    def _refresh_runtime_config(self) -> None:
        config = resolve_provider("gemini-tts", "gemini-2.0-flash")
        self.api_key = config.api_key
        self.endpoint = config.endpoint
        self._genai_http_options = _build_gemini_http_options(config)

    async def _call_gemini(self, prompt: str, audio_type: str = 'speech') -> Dict[str, Any]:
        """调用 Gemini TTS 朗读文本（仅配音/语音）。

        2026-06-10：本方法写死用 TTS 模型 gemini-2.5-flash-preview-tts，
        只能"朗读文本"，不能生成音效或音乐。因此只有 generate_speech 调用它；
        音效/音乐请走 MiniMax（见 MinimaxAudioProvider）。
        """
        self._refresh_runtime_config()
        if not self.api_key:
            raise RuntimeError(
                "GEMINI_API_KEY 未配置：请在管理员后台 → API 配置 中添加 provider=gemini-tts 的密钥，"
                "保存后会实时刷新；如仍未生效，请在后台点击“刷新运行时”。"
            )
        try:
            from google import genai
            client = genai.Client(api_key=self.api_key, http_options=self._genai_http_options)

            Path(AUDIO_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
            filename = f"{audio_type}_{uuid.uuid4().hex[:8]}.wav"
            filepath = os.path.join(AUDIO_UPLOAD_DIR, filename)

            response = await client.aio.models.generate_content(
                # 2026-06-10：原 gemini-2.0-flash 不支持 AUDIO 输出（实测 400），
                # 改为官方 TTS 模型 gemini-2.5-flash-preview-tts。
                model="gemini-2.5-flash-preview-tts",
                contents=prompt,
                config=genai.types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=genai.types.SpeechConfig(
                        voice_config=genai.types.VoiceConfig(
                            prebuilt_voice_config=genai.types.PrebuiltVoiceConfig(
                                voice_name="Kore"
                            )
                        )
                    )
                )
            )

            audio_data = response.candidates[0].content.parts[0].inline_data.data
            # 2026-06-10：genai 返回的是裸 PCM（audio/L16, 24kHz, 单声道 16bit），
            # 原代码直接写入 .wav 会缺 RIFF 头导致无法播放。用 wave 封装正确的头。
            import wave
            with wave.open(filepath, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(24000)
                wf.writeframes(audio_data)

            duration_ms = int(len(audio_data) / (24000 * 2) * 1000)

            return {
                "audio_url": f"/storage/audio/{filename}",
                "duration_ms": duration_ms,
            }
        except Exception as e:
            logger.error(f"Gemini audio generation failed: {e}")
            raise

    async def generate_speech(
        self, text: str, persona: str = 'narrator', emotion: str = 'neutral',
        **kwargs
    ) -> Dict[str, Any]:
        # 2026-06-10：TTS 模型要求"只朗读"，原 [Voice:..] 标签式会触发
        # "Model tried to generate text" 400。改为指令式提示词。
        prompt = f"Read the following line aloud as {persona}, in a {emotion} tone: {text}"
        return await self._call_gemini(prompt, audio_type='speech')

    async def generate_sfx(self, description: str, **kwargs) -> Dict[str, Any]:
        # 2026-06-10：Gemini generate_content 只有 TTS 一个音频模型（朗读文本），
        # 没有音效生成能力。原实现把描述丢给 TTS 只会"朗读这句描述"。
        # 音效请走 MiniMax provider（库内唯一可用的音频生成后端）。
        raise NotImplementedError(
            "Gemini 无音效生成能力（generate_content 仅 TTS 朗读文本）；"
            "请改用 MinimaxAudioProvider.generate_sfx"
        )

    async def generate_music(
        self, description: str, duration_ms: Optional[int] = None, **kwargs
    ) -> Dict[str, Any]:
        # 2026-06-10：同 generate_sfx，Gemini 这里做不了音乐生成。
        raise NotImplementedError(
            "Gemini 无音乐生成能力（generate_content 仅 TTS 朗读文本）；"
            "请改用 MinimaxAudioProvider.generate_music"
        )


class MinimaxAudioProvider(AudioProvider):
    """MiniMax 音频实现 — 同步 TTS（/v1/t2a_v2） + 音乐生成

    2026-05-25 修：§R 修复时只改了 `worker.py::_process_minimax_tts_task`，
    漏了本 provider 路径。虽然 `api_routes.py` 目前所有 `get_audio_provider`
    调用都传 'gemini'（即未真正调用本 provider），但保留 async 调用是
    §B 链式回归的下一颗雷——一旦有调用方切回 'minimax'，就会立刻撞回
    MiniMax 端 async 队列排队 5min+ 的老问题。
    """

    def __init__(self):
        pass

    @staticmethod
    def _client():
        from minimax_audio import get_minimax_audio_client
        return get_minimax_audio_client()

    async def generate_speech(
        self, text: str, persona: str = 'narrator', emotion: str = 'neutral',
        **kwargs
    ) -> Dict[str, Any]:
        voice_id = kwargs.get('voice_id', '')
        if not voice_id:
            raise ValueError("MinimaxAudioProvider.generate_speech 需要 voice_id 参数")

        speed = kwargs.get('speed', 1.0)
        pitch = kwargs.get('pitch', 0)

        return await self._client().tts_sync(
            text=text,
            voice_id=voice_id,
            speed=speed,
            pitch=pitch,
            emotion=emotion,
        )

    async def generate_sfx(self, description: str, **kwargs) -> Dict[str, Any]:
        # 2026-06-10：MiniMax 没有专门的音效（SFX）API。库内唯一的"文本→音频生成"
        # 后端是 music_generate（music-01）。这里把音效描述当作生成提示丢给它，
        # 是当前可用的最接近方案——产出的是一段音频而非严格意义的音效片段，
        # 质量/贴合度有限。若后续接入专门 SFX 模型，应在此替换。
        result = await self._client().music_generate(
            lyrics=description,
            refer_voice=kwargs.get('refer_voice', ''),
            refer_instrumental=kwargs.get('refer_instrumental', ''),
        )
        return {
            "audio_url": result.get("audio_url", ""),
            "duration_ms": result.get("duration_ms", 0),
        }

    async def generate_music(
        self, description: str, duration_ms: Optional[int] = None, **kwargs
    ) -> Dict[str, Any]:
        lyrics = kwargs.get('lyrics', description)
        refer_voice = kwargs.get('refer_voice', '')
        refer_instrumental = kwargs.get('refer_instrumental', '')
        result = await self._client().music_generate(
            lyrics=lyrics,
            refer_voice=refer_voice,
            refer_instrumental=refer_instrumental,
        )
        return {
            "audio_url": result.get("audio_url", ""),
            "duration_ms": result.get("duration_ms", 0),
        }


def get_audio_provider(provider_name: str = 'gemini') -> AudioProvider:
    """工厂方法 - 根据名称返回 provider 实例"""
    providers = {
        'gemini': GeminiAudioProvider,
        'minimax': MinimaxAudioProvider,
    }
    cls = providers.get(provider_name)
    if not cls:
        raise ValueError(f"Unknown audio provider: {provider_name}")
    return cls()
