# -*- coding: utf-8 -*-
"""
音频 Provider 测试
"""
import pytest
from unittest.mock import AsyncMock, patch


async def test_provider_interface_contract():
    from audio_provider import AudioProvider
    provider = AudioProvider()
    with pytest.raises(NotImplementedError):
        await provider.generate_speech("text", persona="narrator")
    with pytest.raises(NotImplementedError):
        await provider.generate_sfx("explosion")
    with pytest.raises(NotImplementedError):
        await provider.generate_music("sad piano")


async def test_gemini_generate_speech_returns_audio():
    from audio_provider import GeminiAudioProvider
    with patch.object(GeminiAudioProvider, '_call_gemini', new_callable=AsyncMock) as mock:
        mock.return_value = {"audio_url": "/storage/audio/speech_test.wav", "duration_ms": 3200}
        provider = GeminiAudioProvider()
        result = await provider.generate_speech("你好世界", persona="narrator", emotion="neutral")
        assert result["audio_url"].endswith(".wav")
        assert result["duration_ms"] == 3200
        mock.assert_called_once()


async def test_gemini_sfx_music_not_supported():
    # 2026-06-10：Gemini generate_content 只有 TTS（朗读），做不了音效/音乐，
    # 应明确报错而不是用 TTS 朗读描述。配音 generate_speech 不受影响。
    from audio_provider import GeminiAudioProvider
    provider = GeminiAudioProvider()
    with pytest.raises(NotImplementedError):
        await provider.generate_sfx("explosion")
    with pytest.raises(NotImplementedError):
        await provider.generate_music("紧张悬疑的背景音乐", duration_ms=30000)


async def test_minimax_generate_music_via_music_generate():
    from audio_provider import MinimaxAudioProvider
    with patch('minimax_audio.get_minimax_audio_client') as get_client:
        client = get_client.return_value
        client.music_generate = AsyncMock(return_value={
            "audio_url": "/storage/audio/music_test.mp3", "duration_ms": 30000,
        })
        provider = MinimaxAudioProvider()
        result = await provider.generate_music("紧张悬疑的背景音乐", duration_ms=30000)
        assert result["audio_url"].endswith(".mp3")
        assert result["duration_ms"] == 30000
        client.music_generate.assert_awaited_once()


async def test_minimax_generate_sfx_via_music_generate():
    from audio_provider import MinimaxAudioProvider
    with patch('minimax_audio.get_minimax_audio_client') as get_client:
        client = get_client.return_value
        client.music_generate = AsyncMock(return_value={
            "audio_url": "/storage/audio/music_sfx.mp3", "duration_ms": 1200,
        })
        provider = MinimaxAudioProvider()
        result = await provider.generate_sfx("explosion")
        assert result["audio_url"].endswith(".mp3")
        client.music_generate.assert_awaited_once()


async def test_get_audio_provider_factory():
    from audio_provider import get_audio_provider, GeminiAudioProvider
    provider = get_audio_provider('gemini')
    assert isinstance(provider, GeminiAudioProvider)


async def test_get_audio_provider_unknown_raises():
    from audio_provider import get_audio_provider
    with pytest.raises(ValueError, match="Unknown audio provider"):
        get_audio_provider('nonexistent')
