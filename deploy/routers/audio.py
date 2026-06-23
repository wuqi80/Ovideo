# -*- coding: utf-8 -*-
"""Audio track, generated audio, MiniMax, and character voice routes."""

import logging
import os
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from services.audio_generation_service import attach_local_generated_audio_file


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
            client = _require_minimax_client()
            result = await client.voice_design(
                prompt=data.prompt,
                preview_text=data.preview_text,
                voice_id=data.voice_id,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MiniMax voice_design 失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/voice-clone")
    async def minimax_voice_clone(data: MinimaxVoiceCloneRequest, user_id: str = Depends(get_current_user)):
        try:
            client = _require_minimax_client()
            result = await client.voice_clone(
                file_id=data.file_id,
                voice_id=data.voice_id,
                demo_text=data.demo_text,
                model=data.model,
                voice_id_prefix=data.voice_id_prefix,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MiniMax voice_clone 失败: {e}")
            raise HTTPException(status_code=502, detail=str(e))


    @router.get("/api/minimax/voices")
    async def minimax_list_voices(voice_type: str = "all", user_id: str = Depends(get_current_user)):
        try:
            client = _require_minimax_client()
            result = await client.list_voices(voice_type)
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.get("/api/minimax/voices/{voice_id}")
    async def minimax_get_voice(voice_id: str, user_id: str = Depends(get_current_user)):
        try:
            client = _require_minimax_client()
            result = await client.get_voice(voice_id)
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.delete("/api/minimax/voices/{voice_id}")
    async def minimax_delete_voice(
        voice_id: str,
        voice_type: str = "voice_cloning",
        user_id: str = Depends(get_current_user),
    ):
        try:
            client = _require_minimax_client()
            result = await client.delete_voice(voice_id, voice_type=voice_type)
            return {"success": True, **result}
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
        """同步 MiniMax TTS — 短文本试听 fast-path（绕开 worker / 队列 / 轮询）。

        2026-05-25 引入：原 POST /api/minimax/tts 走 worker 异步,对短文本试听
        场景过重——前端要走「入队 → 轮询 GET /api/task → worker 拉队列 → 调 sync
        → 入库 → 完成 → 前端再 fetch audio_url」5 个环节,任何一环卡死用户都是
        几十秒到分钟级 loading。

        本 endpoint 在 handler 内 await client.tts_sync(...)（典型 1-15s,远低于
        autodl 反代 5min idle timeout）,同步入库并直接返回 audio_url + file_id。

        适用场景（必须满足）：
          - text ≤ 1000 字符（MiniMax sync 接口上限 10000,但我们留 buffer 给反代）
          - 单次调用即可,不需要 worker 级 retry / 并发限流

        不适用（去走 POST /api/minimax/tts 走 worker）：
          - 批量生成（一集 200 条对白）
          - text > 1000 字符
          - 需要 worker 的失败重试

        详见 recurring-pitfalls.md §R + §R 子陷阱 4「sync/async 双轨」。
        """
        if not data.text or not data.text.strip():
            raise HTTPException(status_code=400, detail="text 不能为空")
        if len(data.text) > 1000:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"text 过长 ({len(data.text)} > 1000),"
                    "请改用 POST /api/minimax/tts（走 worker 异步路径,支持长文本）"
                ),
            )

        client = _require_minimax_client()

        kwargs = {
            'text': data.text,
            'voice_id': data.voice_id,
            'model': data.model,
            'speed': data.speed,
            'pitch': data.pitch,
        }
        if data.emotion:
            kwargs['emotion'] = data.emotion

        try:
            result = await client.tts_sync(**kwargs) or {}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                f"MiniMax TTS sync handler 调用失败: text_len={len(data.text)} err={e}",
                exc_info=True,
            )
            raise HTTPException(status_code=502, detail=f"MiniMax TTS 调用失败: {e}")

        audio_bytes = result.get('audio_bytes')
        if not audio_bytes:
            raise HTTPException(
                status_code=502,
                detail=f"MiniMax 未返回音频字节, trace_id={result.get('trace_id')}",
            )

        saved = await save_generated_file_to_db(
            content=audio_bytes,
            file_type='audio',
            user_id=user_id,
            source='minimax',
            entity_type=data.entity_type,
            entity_id=data.entity_id,
            file_role=data.file_role or 'dialogue_audio',
            original_ext='.mp3',
            episode_id=data.episode_id,
        )
        file_id = saved['file_id']
        file_url = saved['file_url']

        # 2026-05-26 Slice 1 收尾：同步进通用素材库
        try:
            import media_library_service
            await media_library_service.create_from_file(
                file_record=saved, source='generated_audio_minimax',
                episode_id=data.episode_id,
                source_entity_type=data.entity_type,
                source_entity_id=data.entity_id,
                title=(getattr(data, 'text', '') or '')[:80] or None,
            )
        except Exception as _e:
            logger.warning(f"media_library 同步失败 (minimax sync TTS): {_e}")

        if data.bind_to_character_voice_id:
            try:
                await CharacterVoiceDAO.update_sample_audio_url(
                    data.bind_to_character_voice_id, file_url,
                )
            except Exception as e:
                logger.warning(
                    f"sync TTS 回写 sample_audio_url 失败（不致命）: "
                    f"voice_id={data.bind_to_character_voice_id} err={e}"
                )

        logger.info(
            f"✅ MiniMax TTS sync 完成: voice_id={data.voice_id} "
            f"text_len={len(data.text)} duration_ms={result.get('duration_ms')} "
            f"trace_id={result.get('trace_id')} file_id={file_id}"
        )

        return {
            "success": True,
            "audio_url": file_url,
            "file_id": file_id,
            "file_url": file_url,
            "duration_ms": result.get('duration_ms'),
            "minimax_trace_id": result.get('trace_id'),
        }


    @router.get("/api/minimax/tts/{task_id}")
    async def minimax_tts_query(task_id: str, user_id: str = Depends(get_current_user)):
        """【诊断用】直查 MiniMax 端任务状态（task_id 是 mx_task_id，不是数据库 task_id）。

        2026-05-24 改造后前端不再依赖此端点；正常路径用 GET /api/task/{db_task_id}
        通过数据库 task_id 查询 worker 的入库结果。此端点保留供运维排错（例如
        判断 MiniMax 端是否在 5min 保留窗口内仍有该 task）。
        """
        try:
            client = _require_minimax_client()
            result = await client.tts_query(task_id)
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/music")
    async def minimax_music(data: MinimaxMusicRequest, user_id: str = Depends(get_current_user)):
        try:
            client = _require_minimax_client()
            result = await client.music_generate(
                lyrics=data.lyrics,
                refer_voice=data.refer_voice,
                refer_instrumental=data.refer_instrumental,
            )
            resp = {
                "success": True,
                "audio_url": result.get("audio_url", ""),
                "duration_ms": result.get("duration_ms", 0),
            }
            resp = await attach_local_generated_audio_file(
                resp,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                user_id=user_id,
                source='minimax',
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                file_role=data.file_role or 'background_music',
                episode_id=data.episode_id,
                media_source='generated_audio_minimax_music',
                title=(getattr(data, 'lyrics', '') or '')[:80] or None,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
            return resp
        except Exception as e:
            logger.error("MiniMax music failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/minimax/lyrics")
    async def minimax_lyrics(data: MinimaxLyricsRequest, user_id: str = Depends(get_current_user)):
        try:
            client = _require_minimax_client()
            result = await client.lyrics_generate(text=data.text, language=data.language)
            return {"success": True, "lyrics": result.get("data", {}).get("lyrics", "")}
        except Exception as e:
            logger.error(f"MiniMax lyrics 失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/files/upload")
    async def minimax_file_upload(
        file: UploadFile = File(...),
        purpose: str = Form("voice_clone"),
        user_id: str = Depends(get_current_user),
    ):
        tmp_path: Optional[Path] = None
        try:
            original_filename = Path(file.filename or "audio").name
            ext = Path(original_filename).suffix.lower()
            if ext not in {".mp3", ".m4a", ".wav"}:
                raise HTTPException(status_code=400, detail="声音克隆仅支持 mp3、m4a、wav 格式")

            content = await file.read()
            if len(content) > 20 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="声音克隆音频不能超过 20MB")

            tmp_dir = Path(AUDIO_UPLOAD_DIR)
            tmp_dir.mkdir(parents=True, exist_ok=True)
            tmp_path = tmp_dir / f"upload_{uuid.uuid4().hex[:8]}_{original_filename}"
            with open(tmp_path, "wb") as f:
                f.write(content)
            client = _require_minimax_client()
            result = await client.file_upload(str(tmp_path), purpose=purpose)
            return {"success": True, "file_id": result.get("file", {}).get("file_id", result.get("file_id", ""))}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MiniMax file upload 失败: {e}")
            raise HTTPException(status_code=502, detail=str(e))
        finally:
            if tmp_path is not None:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


    @router.get("/api/minimax/files/{file_id}")
    async def minimax_file_retrieve(file_id: str, user_id: str = Depends(get_current_user)):
        try:
            client = _require_minimax_client()
            result = await client.file_retrieve(file_id)
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.delete("/api/minimax/files/{file_id}")
    async def minimax_file_delete(file_id: str, user_id: str = Depends(get_current_user)):
        try:
            client = _require_minimax_client()
            result = await client.file_delete(file_id)
            return {"success": True, **result}
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
