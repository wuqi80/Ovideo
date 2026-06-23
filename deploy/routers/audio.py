# -*- coding: utf-8 -*-
"""Audio track, generated audio, MiniMax, and character voice routes."""

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from services.audio_generation_service import (
    AudioGenerationMissingAudioError,
    AudioGenerationProviderError,
    AudioGenerationValidationError,
    attach_local_generated_audio_file,
    generate_minimax_tts_sync_response,
)
from services.audio_minimax_content_service import (
    generate_minimax_lyrics_response,
    generate_minimax_music_response,
    query_minimax_tts_response,
)
from services.audio_minimax_file_service import (
    MiniMaxFileProviderError,
    MiniMaxFileValidationError,
    delete_minimax_file_response,
    retrieve_minimax_file_response,
    upload_minimax_file_response,
)
from services.audio_minimax_voice_service import (
    clone_minimax_voice_response,
    delete_minimax_voice_response,
    design_minimax_voice_response,
    get_minimax_voice_response,
    list_minimax_voices_response,
)


def create_audio_router(
    *,
    get_current_user_dependency: Any,
    audio_track_dao: Any,
    character_voice_dao: Any,
    get_audio_provider_func: Callable[[str], Any],
    audio_upload_dir: str,
    require_minimax_client: Callable[[], Any],
    task_service_module: Any,
    save_generated_file_to_db_provider: Callable[[], Callable[..., Any]],
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    AudioTrackDAO = audio_track_dao
    CharacterVoiceDAO = character_voice_dao
    get_audio_provider = get_audio_provider_func
    AUDIO_UPLOAD_DIR = audio_upload_dir
    task_service = task_service_module

    def _require_minimax_client():
        return require_minimax_client()

    async def save_generated_file_to_db(*args, **kwargs):
        return await save_generated_file_to_db_provider()(*args, **kwargs)

    # ============================================

    class AudioTrackCreate(BaseModel):
        track_type: str
        name: str = ''
        audio_url: Optional[str] = None
        duration_ms: Optional[int] = None
        start_item_id: Optional[str] = None
        end_item_id: Optional[str] = None
        generation_params: Optional[dict] = None


    @router.get("/api/episodes/{episode_id}/audio-tracks")
    async def get_audio_tracks(episode_id: str, user_id: str = Depends(get_current_user)):
        tracks = await AudioTrackDAO.get_by_episode(episode_id)
        return {"success": True, "tracks": [dict(t) for t in tracks]}


    @router.post("/api/episodes/{episode_id}/audio-tracks")
    async def create_audio_track(episode_id: str, data: AudioTrackCreate, user_id: str = Depends(get_current_user)):
        track = await AudioTrackDAO.create(
            episode_id=episode_id, track_type=data.track_type, name=data.name,
            audio_url=data.audio_url, duration_ms=data.duration_ms,
            start_item_id=data.start_item_id, end_item_id=data.end_item_id,
            generation_params=data.generation_params
        )
        if not track:
            raise HTTPException(status_code=500, detail="创建音频轨失败")
        return {"success": True, "track": dict(track)}


    @router.delete("/api/audio-tracks/{track_id}")
    async def delete_audio_track(track_id: str, user_id: str = Depends(get_current_user)):
        ok = await AudioTrackDAO.delete(track_id)
        if not ok:
            raise HTTPException(status_code=404, detail="音频轨不存在")
        return {"success": True}


    # ============================================
    # 音频生成 API
    # ============================================

    class SpeechGenRequest(BaseModel):
        text: str
        persona: str = 'narrator'
        emotion: str = 'neutral'
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        episode_id: Optional[str] = None

    class SFXGenRequest(BaseModel):
        description: str
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        episode_id: Optional[str] = None

    class MusicGenRequest(BaseModel):
        description: str
        duration_ms: Optional[int] = None
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        episode_id: Optional[str] = None


    @router.post("/api/audio/generate-speech")
    async def gen_speech(data: SpeechGenRequest, user_id: str = Depends(get_current_user)):
        try:
            provider = get_audio_provider('gemini')
            result = await provider.generate_speech(data.text, persona=data.persona, emotion=data.emotion)
            result = await attach_local_generated_audio_file(
                result,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                user_id=user_id,
                source='gemini',
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                file_role=data.file_role or 'dialogue_audio',
                episode_id=data.episode_id,
                media_source='generated_audio_gemini_speech',
                title=(getattr(data, 'text', '') or '')[:80] or None,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except RuntimeError as e:
            msg = str(e)
            if 'GEMINI_API_KEY' in msg or '\u672a\u914d\u7f6e' in msg:
                raise HTTPException(status_code=503, detail=msg)
            logger.error("generate_speech failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=msg)
        except Exception as e:
            msg = str(e)
            if 'Missing key inputs' in msg or 'api_key' in msg:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "GEMINI_API_KEY \u672a\u914d\u7f6e: \u8bf7\u5728\u7ba1\u7406\u5458\u540e\u53f0 -> API \u914d\u7f6e "
                        "\u4e2d\u6dfb\u52a0 provider=gemini-tts \u7684\u5bc6\u94a5; \u4fdd\u5b58\u540e\u4f1a\u5b9e\u65f6\u5237\u65b0."
                    ),
                )
            logger.error("generate_speech failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=msg)

    @router.post("/api/audio/generate-sfx")
    async def gen_sfx(data: SFXGenRequest, user_id: str = Depends(get_current_user)):
        try:
            _require_minimax_client()
            provider = get_audio_provider('minimax')
            result = await provider.generate_sfx(data.description)
            result = await attach_local_generated_audio_file(
                result,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                user_id=user_id,
                source='minimax',
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                file_role=data.file_role or 'sfx_audio',
                episode_id=data.episode_id,
                media_source='generated_audio_minimax_sfx',
                title=(getattr(data, 'description', '') or '')[:80] or None,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except Exception as e:
            logger.error("generate_sfx failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/audio/generate-music")
    async def gen_music(data: MusicGenRequest, user_id: str = Depends(get_current_user)):
        try:
            _require_minimax_client()
            provider = get_audio_provider('minimax')
            result = await provider.generate_music(data.description, duration_ms=data.duration_ms)
            result = await attach_local_generated_audio_file(
                result,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                user_id=user_id,
                source='minimax',
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                file_role=data.file_role or 'background_music',
                episode_id=data.episode_id,
                media_source='generated_audio_minimax_music',
                title=(getattr(data, 'description', '') or '')[:80] or None,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except Exception as e:
            logger.error("generate_music failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    # ============================================
    # MiniMax 音频 API
    # ============================================

    class MinimaxVoiceDesignRequest(BaseModel):
        prompt: str
        preview_text: str
        voice_id: Optional[str] = None

    class MinimaxVoiceCloneRequest(BaseModel):
        file_id: str
        voice_id: Optional[str] = None
        demo_text: Optional[str] = "你好，这是一段测试语音。"
        model: str = "speech-2.8-hd"
        voice_id_prefix: str = "clone"

    class MinimaxTTSRequest(BaseModel):
        text: str
        voice_id: str
        model: str = "speech-2.8-hd"
        speed: float = 1.0
        pitch: int = 0
        emotion: Optional[str] = None
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        episode_id: Optional[str] = None
        # 2026-05-24 新增：试听场景透传，worker 完成后回写 character_voices.sample_audio_url，
        # 让用户下次打开 VoiceSidebar 直接复用同一段试听，避免重复付费。
        bind_to_character_voice_id: Optional[str] = None

    class MinimaxMusicRequest(BaseModel):
        lyrics: str = ""
        refer_voice: str = ""
        refer_instrumental: str = ""
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        episode_id: Optional[str] = None

    class MinimaxLyricsRequest(BaseModel):
        text: str
        language: str = "zh"


    @router.post("/api/minimax/voice-design")
    async def minimax_voice_design(data: MinimaxVoiceDesignRequest, user_id: str = Depends(get_current_user)):
        try:
            return await design_minimax_voice_response(
                client=_require_minimax_client(),
                prompt=data.prompt,
                preview_text=data.preview_text,
                voice_id=data.voice_id,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MiniMax voice_design 失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/voice-clone")
    async def minimax_voice_clone(data: MinimaxVoiceCloneRequest, user_id: str = Depends(get_current_user)):
        try:
            return await clone_minimax_voice_response(
                client=_require_minimax_client(),
                file_id=data.file_id,
                voice_id=data.voice_id,
                demo_text=data.demo_text,
                model=data.model,
                voice_id_prefix=data.voice_id_prefix,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MiniMax voice_clone 失败: {e}")
            raise HTTPException(status_code=502, detail=str(e))


    @router.get("/api/minimax/voices")
    async def minimax_list_voices(voice_type: str = "all", user_id: str = Depends(get_current_user)):
        try:
            return await list_minimax_voices_response(client=_require_minimax_client(), voice_type=voice_type)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.get("/api/minimax/voices/{voice_id}")
    async def minimax_get_voice(voice_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await get_minimax_voice_response(client=_require_minimax_client(), voice_id=voice_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.delete("/api/minimax/voices/{voice_id}")
    async def minimax_delete_voice(
        voice_id: str,
        voice_type: str = "voice_cloning",
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await delete_minimax_voice_response(
                client=_require_minimax_client(),
                voice_id=voice_id,
                voice_type=voice_type,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/tts")
    async def minimax_tts(data: MinimaxTTSRequest, user_id: str = Depends(get_current_user)):
        """提交 MiniMax TTS 任务到队列，立即返回数据库 task_id。

        2026-05-24 改造：原同步阻塞 300s 改为异步入队。worker 进程在 600s 窗口内
        完成轮询+下载+入库+entity 同步，避开 autodl 反代 5min idle timeout 边界。
        前端通过 GET /api/task/{task_id} 轮询进度与最终 audio_url / file_id。

        详见 recurring-pitfalls §Q「HTTP handler 阻塞超过反代 idle timeout」。
        """
        # 早 fail：MiniMax 未配置直接 503/501，不浪费一次入队
        try:
            _require_minimax_client()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        task_data = {
            "text": data.text,
            "voice_id": data.voice_id,
            "model": data.model,
            "speed": data.speed,
            "pitch": data.pitch,
            "emotion": data.emotion,
            "entity_type": data.entity_type,
            "entity_id": data.entity_id,
            "file_role": data.file_role,
            "episode_id": data.episode_id,
        }
        # 可选：试听场景透传 bind_to_character_voice_id，
        # 让 worker 完成时回写 character_voices.sample_audio_url
        bind = getattr(data, 'bind_to_character_voice_id', None)
        if bind:
            task_data['bind_to_character_voice_id'] = bind

        try:
            svc = task_service.get()
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=f"任务服务未就绪: {e}")

        try:
            task_id = await svc.submit(
                task_type='minimax_tts',
                task_data=task_data,
                user_id=user_id,
                priority=2,
                prepare=False,  # MiniMax TTS 不走 ComfyUI workflow 预构建
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                f"MiniMax TTS 入队失败: text_len={len(data.text or '')} err={e}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"TTS 入队失败: {e}")

        logger.info(
            f"📤 MiniMax TTS 已入队: task_id={task_id} voice_id={data.voice_id} "
            f"text_len={len(data.text or '')}"
        )
        return {"success": True, "task_id": task_id}


    @router.post("/api/minimax/tts/sync")
    async def minimax_tts_sync(
        data: MinimaxTTSRequest,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await generate_minimax_tts_sync_response(
                data,
                user_id=user_id,
                client=_require_minimax_client(),
                character_voice_dao=CharacterVoiceDAO,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
        except AudioGenerationValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except (AudioGenerationProviderError, AudioGenerationMissingAudioError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @router.get("/api/minimax/tts/{task_id}")
    async def minimax_tts_query(task_id: str, user_id: str = Depends(get_current_user)):
        """【诊断用】直查 MiniMax 端任务状态（task_id 是 mx_task_id，不是数据库 task_id）。

        2026-05-24 改造后前端不再依赖此端点；正常路径用 GET /api/task/{db_task_id}
        通过数据库 task_id 查询 worker 的入库结果。此端点保留供运维排错（例如
        判断 MiniMax 端是否在 5min 保留窗口内仍有该 task）。
        """
        try:
            return await query_minimax_tts_response(client=_require_minimax_client(), task_id=task_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/music")
    async def minimax_music(data: MinimaxMusicRequest, user_id: str = Depends(get_current_user)):
        try:
            return await generate_minimax_music_response(
                data,
                user_id=user_id,
                client=_require_minimax_client(),
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
        except Exception as e:
            logger.error("MiniMax music failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/minimax/lyrics")
    async def minimax_lyrics(data: MinimaxLyricsRequest, user_id: str = Depends(get_current_user)):
        try:
            return await generate_minimax_lyrics_response(
                client=_require_minimax_client(),
                text=data.text,
                language=data.language,
            )
        except Exception as e:
            logger.error(f"MiniMax lyrics 失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/files/upload")
    async def minimax_file_upload(
        file: UploadFile = File(...),
        purpose: str = Form("voice_clone"),
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await upload_minimax_file_response(
                upload_file=file,
                purpose=purpose,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                client=_require_minimax_client(),
                logger=logger,
            )
        except MiniMaxFileValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except MiniMaxFileProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


    @router.get("/api/minimax/files/{file_id}")
    async def minimax_file_retrieve(file_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await retrieve_minimax_file_response(file_id=file_id, client=_require_minimax_client())
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.delete("/api/minimax/files/{file_id}")
    async def minimax_file_delete(file_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await delete_minimax_file_response(file_id=file_id, client=_require_minimax_client())
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # ============================================
    # 剧本 API


    # ============================================

    class CharacterVoiceCreate(BaseModel):
        project_id: str
        character_name: str
        asset_id: Optional[str] = None
        voice_provider: Optional[str] = None
        voice_model_id: Optional[str] = None
        voice_name: Optional[str] = None
        voice_params: Optional[dict] = None
        sample_audio_url: Optional[str] = None

    class CharacterVoiceUpdate(BaseModel):
        character_name: Optional[str] = None
        asset_id: Optional[str] = None
        voice_provider: Optional[str] = None
        voice_model_id: Optional[str] = None
        voice_name: Optional[str] = None
        voice_params: Optional[dict] = None
        sample_audio_url: Optional[str] = None


    @router.post("/api/character-voices")
    async def create_character_voice(data: CharacterVoiceCreate, user_id: str = Depends(get_current_user)):
        voice = await CharacterVoiceDAO.create(
            project_id=data.project_id, character_name=data.character_name,
            asset_id=data.asset_id, voice_provider=data.voice_provider,
            voice_model_id=data.voice_model_id, voice_name=data.voice_name,
            voice_params=data.voice_params, sample_audio_url=data.sample_audio_url,
        )
        if not voice:
            raise HTTPException(status_code=500, detail="创建音色失败")
        return {"success": True, "voice": dict(voice)}


    @router.get("/api/projects/{project_id}/character-voices")
    async def get_character_voices(project_id: str, user_id: str = Depends(get_current_user)):
        voices = await CharacterVoiceDAO.get_by_project(project_id)
        return {"success": True, "voices": [dict(v) for v in voices]}


    @router.put("/api/character-voices/{voice_id}")
    async def update_character_voice(voice_id: str, data: CharacterVoiceUpdate, user_id: str = Depends(get_current_user)):
        voice = await CharacterVoiceDAO.update(voice_id, **data.dict(exclude_none=True))
        if not voice:
            raise HTTPException(status_code=404, detail="音色不存在")
        return {"success": True, "voice": dict(voice)}


    @router.delete("/api/character-voices/{voice_id}")
    async def delete_character_voice(voice_id: str, user_id: str = Depends(get_current_user)):
        ok = await CharacterVoiceDAO.delete(voice_id)
        if not ok:
            raise HTTPException(status_code=404, detail="音色不存在")
        return {"success": True}


    # ============================================
    # 批量操作 API

    return router
