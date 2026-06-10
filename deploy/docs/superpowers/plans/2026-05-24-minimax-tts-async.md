# MiniMax TTS Async Overhaul + Preview Persistence Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MiniMax TTS 从"FastAPI handler 内同步阻塞 300s 直撞反代 idle timeout"改造为标准 task_queue 异步任务（与 wan26 / seedance / kling / vidu / happyhorse 一致），消除"试听一直 loading 拿不到结果"的体感卡死；同时核查试听音频全链路持久化（voicePreviewCache + character_voices.sample_audio_url + entity binding），确保下次打开不重复付费生成。

**Architecture:** POST `/api/minimax/tts` 不再调 `tts_wait_and_download`，改为 `task_service.submit('minimax_tts', ...)` 后立刻返回数据库 task_id；新增 `worker._process_minimax_tts_task` 在 worker 进程内跑完整 5-10 分钟轮询、入库、entity 同步、可选回写 `character_voices.sample_audio_url`；前端 `minimaxTTS()` 改为返回 task_id，`VoiceSidebar.handlePreview` 和 `AudioStagePage.runGenerate` 都接入与视频相同的 `/api/task/{task_id}` 轮询模式 + AbortController + 友好错误透传（504 detail dict 平铺到 Error）。

**Tech Stack:** FastAPI · `task_queue.TaskQueue` (Redis) · `task_service.TaskService` · `worker.Worker` · `file_service.save_generated_file_to_db` · `dao_character_voice.CharacterVoiceDAO` · React 18 · Vite · `voicePreviewCache` (module singleton + localStorage) · `taskRegistry` · `globalTaskManager` (SSE + polling fallback) · vitest

---

## File Structure

**Backend (modify):**
- `worker.py` — 新增 dispatch 分支 + `_process_minimax_tts_task` 方法
- `api_routes.py` — 重写 `POST /api/minimax/tts` 为入队，移除 `await tts_wait_and_download`
- `dao_character_voice.py` — 新增 `update_sample_audio_url(voice_id, url)` 单字段更新方法

**Backend (no change):**
- `minimax_audio.py` — `tts_async`/`tts_query`/`tts_wait_and_download` 保持原样（worker 直接调用）
- `cluster_main.py` — `GET /api/task/{task_id}` 已存在 (line 1879)，前端复用
- `task_service.py` — 调用即可，无需改

**Frontend (modify):**
- `new_html/services/apiService.ts` — `handleResponse` 504 detail 平铺 + `minimaxTTS` 返回 task_id + 删 `minimaxTTSQuery`
- `new_html/services/ttsTaskPoller.ts` — **新文件**，TTS 专用轻量轮询器（复用 `getTaskStatus` 模式）
- `new_html/components/audio/VoiceSidebar.tsx` — `handlePreview` 改 enqueue+poll，加 AbortController
- `new_html/pages/AudioStagePage.tsx` — `runGenerate` 改 enqueue+poll，与 taskRegistry 已有钩子打通

**Tests (new):**
- `tests/test_worker_minimax_tts.py` — backend 单测
- `new_html/__tests__/services/apiService.handleResponse.test.ts` — 504 detail 透传测试
- `new_html/__tests__/services/ttsTaskPoller.test.ts` — 轮询器测试

**Docs (update):**
- `docs/faq.md` — 新增 entry（Symptom + Root Cause + Fix + Files + Date + Lesson）
- `docs/api.md` — `minimax_tts` task_type 行 + POST `/api/minimax/tts` 异步语义说明
- `docs/conventions.md` — "长任务必须 worker 卸载"约束写入"task_type naming"段
- `.claude/skills/project-memory/references/recurring-pitfalls.md` — 新增 §Q「HTTP handler 阻塞超过反代 idle timeout」

**Mirror (after success):**
- `deploy/api_routes.py`, `deploy/worker.py`, `deploy/dao_character_voice.py`
- `deploy/new_html/services/apiService.ts`, `deploy/new_html/services/ttsTaskPoller.ts`
- `deploy/new_html/components/audio/VoiceSidebar.tsx`
- `deploy/new_html/pages/AudioStagePage.tsx`
- `deploy/new_html/dist/*` (full rebuild)
- `deploy/docs/*.md`

---

## Task 1: 后端 — `dao_character_voice.update_sample_audio_url` 单字段更新

**Files:**
- Modify: `dao_character_voice.py`
- Test: `tests/test_dao_character_voice_sample_audio.py`

- [ ] **Step 1.1: 读现状确认 sample_audio_url 字段位置**

Run: `python -c "import dao_character_voice; help(dao_character_voice.CharacterVoiceDAO.update)"`
Expected: 输出现有 `update` 方法签名包含 `sample_audio_url` 参数。如果已有 update 方法支持单字段，跳到 Step 1.4。

- [ ] **Step 1.2: 写失败测试**

```python
# tests/test_dao_character_voice_sample_audio.py
import pytest
from dao_character_voice import CharacterVoiceDAO

@pytest.mark.asyncio
async def test_update_sample_audio_url_only_changes_target_field(test_db, seeded_voice):
    """worker 回写试听 URL 必须只动 sample_audio_url，不影响 voice_params / voice_name 等"""
    voice_id = seeded_voice['voice_id']
    original_name = seeded_voice['voice_name']
    new_url = '/storage/audio/preview_xyz.mp3'

    await CharacterVoiceDAO.update_sample_audio_url(voice_id, new_url)

    row = await CharacterVoiceDAO.get_by_id(voice_id)
    assert row['sample_audio_url'] == new_url
    assert row['voice_name'] == original_name  # 别的字段不受影响
```

- [ ] **Step 1.3: 跑测试看 FAIL**

Run: `pytest tests/test_dao_character_voice_sample_audio.py -v`
Expected: FAIL with `AttributeError: type object 'CharacterVoiceDAO' has no attribute 'update_sample_audio_url'`

- [ ] **Step 1.4: 实现单字段更新方法**

加在 `dao_character_voice.py` 现有 update 方法附近：

```python
@classmethod
async def update_sample_audio_url(cls, voice_id: str, sample_audio_url: str) -> None:
    """单字段更新：worker 回写试听 URL 时使用，避免读改写竞态。

    2026-05-24 引入：MiniMax TTS 改异步后，worker 完成时若 task_data 携带
    bind_to_character_voice_id，直接 UPDATE 该 voice 的 sample_audio_url，
    让用户下次打开 VoiceSidebar 直接复用，不再重复付费生成试听。
    """
    db = await cls._db()
    await db.execute(
        "UPDATE character_voices SET sample_audio_url = $1, updated_at = NOW() WHERE voice_id = $2",
        sample_audio_url, voice_id,
    )
```

- [ ] **Step 1.5: 跑测试看 PASS**

Run: `pytest tests/test_dao_character_voice_sample_audio.py -v`
Expected: PASS

- [ ] **Step 1.6: Commit**

```bash
git add dao_character_voice.py tests/test_dao_character_voice_sample_audio.py
git commit -m "feat(dao): add CharacterVoiceDAO.update_sample_audio_url for single-field write back"
```

---

## Task 2: 后端 worker — 新增 `_process_minimax_tts_task` + dispatch 分支

**Files:**
- Modify: `worker.py` (lines 209-224 dispatch block + 新方法插入到 `_process_dashscope_video_task` 之后)
- Test: `tests/test_worker_minimax_tts.py`

- [ ] **Step 2.1: 写失败测试（happy path）**

```python
# tests/test_worker_minimax_tts.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from task_queue import Task
from worker import Worker

@pytest.fixture
def mock_worker():
    w = Worker.__new__(Worker)
    w.task_queue = MagicMock()
    w.task_queue.update_progress = AsyncMock()
    w.task_queue.complete_task = AsyncMock()
    w.task_queue.fail_task = AsyncMock()
    return w

@pytest.mark.asyncio
async def test_process_minimax_tts_happy_path(mock_worker, tmp_path):
    task = Task(
        task_id='uuid-1',
        task_type='minimax_tts',
        data={
            'text': '你好世界',
            'voice_id': 'female-shaonv',
            'model': 'speech-2.8-hd',
            'speed': 1.0, 'pitch': 0, 'emotion': None,
            'entity_type': 'storyboard_item',
            'entity_id': 'item-1',
            'file_role': 'dialogue_audio',
            'episode_id': 'ep-1',
        },
        priority=2, user_id='u1',
    )
    fake_audio = b'ID3' + b'\x00' * 1024
    fake_audio_path = tmp_path / 'tts_abc12345.mp3'
    fake_audio_path.write_bytes(fake_audio)

    with patch('worker.get_minimax_audio_client') as mc, \
         patch('worker.save_generated_file_to_db', new=AsyncMock(return_value={
            'file_id': 'fid-1', 'file_url': '/storage/audio/tts_abc12345.mp3'
         })):
        client = mc.return_value
        client.tts_async = AsyncMock(return_value={'task_id': 'mx-1'})
        client.tts_wait_and_download = AsyncMock(return_value={
            'audio_url': str(fake_audio_path),
            'duration_ms': 1500,
        })
        ok = await mock_worker._process_minimax_tts_task(task)

    assert ok is True
    mock_worker.task_queue.complete_task.assert_awaited_once()
    completed_result = mock_worker.task_queue.complete_task.call_args[0][1]
    assert completed_result['file_id'] == 'fid-1'
    assert completed_result['file_url'] == '/storage/audio/tts_abc12345.mp3'
    assert completed_result['duration_ms'] == 1500

@pytest.mark.asyncio
async def test_process_minimax_tts_writes_back_sample_audio_url(mock_worker, tmp_path):
    task = Task(
        task_id='uuid-2', task_type='minimax_tts',
        data={
            'text': '试听文本', 'voice_id': 'female-shaonv',
            'bind_to_character_voice_id': 'cv-99',
        },
        priority=2, user_id='u1',
    )
    fake_audio_path = tmp_path / 'tts_xyz.mp3'
    fake_audio_path.write_bytes(b'ID3' + b'\x00' * 100)

    with patch('worker.get_minimax_audio_client') as mc, \
         patch('worker.save_generated_file_to_db', new=AsyncMock(return_value={
            'file_id': 'fid-2', 'file_url': '/storage/audio/tts_xyz.mp3'
         })), \
         patch('worker.CharacterVoiceDAO.update_sample_audio_url', new=AsyncMock()) as upd:
        client = mc.return_value
        client.tts_async = AsyncMock(return_value={'task_id': 'mx-2'})
        client.tts_wait_and_download = AsyncMock(return_value={
            'audio_url': str(fake_audio_path), 'duration_ms': 2000,
        })
        await mock_worker._process_minimax_tts_task(task)

    upd.assert_awaited_once_with('cv-99', '/storage/audio/tts_xyz.mp3')

@pytest.mark.asyncio
async def test_process_minimax_tts_failure_calls_fail_task(mock_worker):
    task = Task(task_id='uuid-3', task_type='minimax_tts',
                data={'text': 'x', 'voice_id': 'female-shaonv'},
                priority=2, user_id='u1')
    with patch('worker.get_minimax_audio_client') as mc:
        client = mc.return_value
        client.tts_async = AsyncMock(side_effect=TimeoutError('TTS 任务超时: mx-3'))
        ok = await mock_worker._process_minimax_tts_task(task)
    assert ok is False
    mock_worker.task_queue.fail_task.assert_awaited_once()
    err_msg = mock_worker.task_queue.fail_task.call_args[0][1]
    assert 'TTS' in err_msg or '超时' in err_msg
```

- [ ] **Step 2.2: 跑测试看 FAIL**

Run: `pytest tests/test_worker_minimax_tts.py -v`
Expected: FAIL with `AttributeError: 'Worker' object has no attribute '_process_minimax_tts_task'`

- [ ] **Step 2.3: 实现 `_process_minimax_tts_task` 方法**

插入到 `worker.py` 在 `_process_dashscope_video_task` 方法之后（约 line 2170 附近 — 找 `# DashScope 共享视频族` 结束位置）。

先在 worker.py 顶部 import 段确认/添加：

```python
# worker.py 顶部 import 段（找 from file_service import 那一行附近）：
from file_service import save_generated_file_to_db
from dao_character_voice import CharacterVoiceDAO
from minimax_audio import get_minimax_audio_client  # 如果还没 import
```

新方法本体：

```python
    # ────────────────────────────────────────────────────────────────────
    # MiniMax TTS 异步任务
    # 2026-05-24：从 api_routes POST 同步阻塞改造为 worker 异步处理。
    # 原因：handler 内 await tts_wait_and_download(max_wait=300) 撞 autodl
    # 反代 idle ~5 分钟边界，前端 fetch hang。详见 recurring-pitfalls §Q。
    # ────────────────────────────────────────────────────────────────────

    async def _process_minimax_tts_task(self, task: Task) -> bool:
        """处理 MiniMax TTS 异步任务。

        task.data 字段约定：
          - text:              要合成的文本
          - voice_id:          MiniMax 官方音色 id 或克隆/设计的 voice_id
          - model:             默认 'speech-2.8-hd'
          - speed/pitch/emotion
          - entity_type/entity_id/file_role/episode_id:  files 表 entity binding
          - bind_to_character_voice_id (可选): worker 完成后回写 sample_audio_url
        """
        from pathlib import Path
        td = task.data or {}
        try:
            client = get_minimax_audio_client()
            if client is None:
                raise RuntimeError("MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY")

            text = td.get('text', '')
            voice_id = td.get('voice_id', '')
            if not text or not voice_id:
                raise ValueError("缺少 text 或 voice_id")

            logger.info(f"🎤 MiniMax TTS 任务启动: text_len={len(text)} voice_id={voice_id}")

            # 1. 签发 MiniMax 任务
            issue = await client.tts_async(
                text=text, voice_id=voice_id,
                model=td.get('model'),
                speed=td.get('speed'),
                pitch=td.get('pitch'),
                emotion=td.get('emotion'),
            )
            mx_task_id = issue.get('task_id')
            logger.info(f"✅ MiniMax TTS 已签发: mx_task_id={mx_task_id}")
            await self.task_queue.update_progress(task.task_id, 10)

            # 2. 轮询 + 下载（worker 进程内，不受反代约束）
            download_result = await client.tts_wait_and_download(
                mx_task_id, max_wait=600, poll_interval=3.0,
            )
            audio_local_path = download_result.get('audio_url', '')
            duration_ms = download_result.get('duration_ms')
            await self.task_queue.update_progress(task.task_id, 80)

            # 3. 入 files 表 + entity 同步
            audio_file_path = Path(audio_local_path)
            if not audio_file_path.exists():
                raise FileNotFoundError(f"TTS 输出文件不存在: {audio_file_path}")

            saved = await save_generated_file_to_db(
                content=audio_file_path.read_bytes(),
                file_type='audio',
                user_id=task.user_id,
                source='minimax',
                entity_type=td.get('entity_type'),
                entity_id=td.get('entity_id'),
                file_role=td.get('file_role') or 'dialogue_audio',
                original_ext=audio_file_path.suffix,
                episode_id=td.get('episode_id'),
            )
            file_id = saved['file_id']
            file_url = saved['file_url']
            logger.info(f"💾 TTS 文件入库: file_id={file_id} url={file_url}")

            # 4. 可选：回写 character_voices.sample_audio_url
            bind_voice_id = td.get('bind_to_character_voice_id')
            if bind_voice_id:
                try:
                    await CharacterVoiceDAO.update_sample_audio_url(bind_voice_id, file_url)
                    logger.info(f"🔗 已回写 character_voice {bind_voice_id} 的 sample_audio_url")
                except Exception as e:
                    logger.warning(f"⚠️ 回写 sample_audio_url 失败（不致命）: {e}")

            # 5. 完成
            await self.task_queue.complete_task(task.task_id, {
                "audio_url": file_url,
                "file_id": file_id,
                "file_url": file_url,
                "duration_ms": duration_ms,
                "minimax_task_id": mx_task_id,
            })
            logger.info(f"🎉 MiniMax TTS 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ MiniMax TTS 任务失败: {e}", exc_info=True)
            await self.task_queue.fail_task(task.task_id, str(e))
            return False
```

- [ ] **Step 2.4: 在 dispatch 块加分支**

编辑 `worker.py` 第 209-224 行 dispatch，紧接 `_process_dashscope_video_task` 分支后加一行：

```python
            elif task.task_type in ['minimax_i2v', 'minimax_morph']:
                return await self._process_minimax_task(task)
            elif task.task_type in ['sora2_i2v', 'sora2_morph']:
                return await self._process_sora2_task(task)
            elif task.task_type in ['veo_i2v', 'veo_morph']:
                return await self._process_veo_task(task)
            elif task.task_type in ['wan26_i2v']:
                return await self._process_wan26_task(task)
            elif task.task_type.startswith('seedance_'):
                return await self._process_seedance_task(task)
            elif (
                task.task_type.startswith('kling_')
                or task.task_type.startswith('vidu_')
                or task.task_type.startswith('happyhorse_')
            ):
                return await self._process_dashscope_video_task(task)
            elif task.task_type == 'minimax_tts':
                return await self._process_minimax_tts_task(task)
```

- [ ] **Step 2.5: 跑测试看 PASS**

Run: `pytest tests/test_worker_minimax_tts.py -v`
Expected: 3 PASS

- [ ] **Step 2.6: 给 worker.VIDEO_TASK_TYPES 不加 minimax_tts（它是音频）**

确认 [`worker.py:75`](../../worker.py) 的 `self.VIDEO_TASK_TYPES` **没有** 加 `'minimax_tts'`。它属于音频，分类应该不在视频族里。读后确认即可，无需改。

Run: `grep -n "VIDEO_TASK_TYPES" worker.py`
Expected: 列表内不含 `minimax_tts`

- [ ] **Step 2.7: Commit**

```bash
git add worker.py tests/test_worker_minimax_tts.py
git commit -m "feat(worker): handle minimax_tts as async task to escape 5min proxy idle timeout"
```

---

## Task 3: 后端 — `POST /api/minimax/tts` 改为入队立即返回 task_id

**Files:**
- Modify: `api_routes.py:2185-2232`
- Test: `tests/test_api_minimax_tts_enqueue.py`

- [ ] **Step 3.1: 写失败测试**

```python
# tests/test_api_minimax_tts_enqueue.py
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from cluster_main import app  # 或测试用 ASGI app

@pytest.mark.asyncio
async def test_post_minimax_tts_returns_task_id_immediately():
    """POST /api/minimax/tts 必须立刻返回 {success, task_id}，不能阻塞到下载完成"""
    with patch('api_routes.task_service.get') as mock_svc, \
         patch('api_routes._require_minimax_client'):
        svc = mock_svc.return_value
        svc.submit = AsyncMock(return_value='uuid-task-1')

        client = TestClient(app)
        # 注意：实际项目要 mock auth；下面给出 shape，具体按本项目 auth fixture 调整
        resp = client.post(
            "/api/minimax/tts",
            json={"text": "你好", "voice_id": "female-shaonv"},
            headers={"Authorization": "Bearer test-token"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body['success'] is True
        assert body['task_id'] == 'uuid-task-1'
        svc.submit.assert_awaited_once()
        call_kwargs = svc.submit.call_args.kwargs
        assert call_kwargs['task_type'] == 'minimax_tts'
        assert call_kwargs['task_data']['text'] == '你好'
        assert call_kwargs['task_data']['voice_id'] == 'female-shaonv'
        assert call_kwargs['prepare'] is False  # MiniMax TTS 不需要 ComfyUI workflow 预构建
```

- [ ] **Step 3.2: 跑测试看 FAIL**

Run: `pytest tests/test_api_minimax_tts_enqueue.py -v`
Expected: FAIL（当前实现 `await client.tts_wait_and_download` 而非 enqueue）

- [ ] **Step 3.3: 重写 handler**

替换 `api_routes.py:2185-2232` 整段。先确认顶部已 import：

```python
# api_routes.py 文件顶部 import 段（如已存在则跳过）：
import task_service
```

`POST /api/minimax/tts` 新实现替换原 2185-2232：

```python
@router.post("/api/minimax/tts")
async def minimax_tts(data: MinimaxTTSRequest, user_id: str = Depends(get_current_user)):
    """提交 MiniMax TTS 任务到队列，立即返回数据库 task_id。

    2026-05-24 改造：原同步阻塞 300s 改为异步入队。worker 进程在 600s 窗口内
    完成轮询+下载+入库+entity 同步，避开 autodl 反代 5min idle timeout 边界。
    前端通过 GET /api/task/{task_id} 轮询进度与最终 audio_url / file_id。
    """
    try:
        _require_minimax_client()  # 早 fail：未配置直接 503
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
    # 可选：前端在试听场景透传 bind_to_character_voice_id，
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
            prepare=False,  # 不走 ComfyUI workflow 预构建
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"MiniMax TTS 入队失败: text_len={len(data.text or '')} err={e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"TTS 入队失败: {e}")

    logger.info(f"📤 MiniMax TTS 已入队: task_id={task_id} voice_id={data.voice_id} text_len={len(data.text or '')}")
    return {"success": True, "task_id": task_id}
```

- [ ] **Step 3.4: `MinimaxTTSRequest` 加 `bind_to_character_voice_id` 字段**

找到 `MinimaxTTSRequest` Pydantic 定义（在 api_routes.py 中 grep）：

```bash
grep -n "class MinimaxTTSRequest" api_routes.py
```

在该 class 加一行：

```python
class MinimaxTTSRequest(BaseModel):
    text: str
    voice_id: str
    model: Optional[str] = None
    speed: Optional[float] = None
    pitch: Optional[float] = None
    emotion: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    file_role: Optional[str] = None
    episode_id: Optional[str] = None
    bind_to_character_voice_id: Optional[str] = None  # 2026-05-24 新增
```

- [ ] **Step 3.5: 保留 `GET /api/minimax/tts/{task_id}` 但加注释说明仅作诊断**

`api_routes.py:2235-2242` 不变，但在 handler 上方 docstring 加一行：

```python
@router.get("/api/minimax/tts/{task_id}")
async def minimax_tts_query(task_id: str, user_id: str = Depends(get_current_user)):
    """【诊断用】直查 MiniMax 端的任务状态（不是数据库 task_id，是 mx_task_id）。

    2026-05-24 后前端不再依赖此端点；正常路径用 GET /api/task/{db_task_id}
    通过数据库 task_id 查询 worker 的入库结果。此端点保留供运维排错。
    """
    try:
        client = _require_minimax_client()
        result = await client.tts_query(task_id)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 3.6: 跑测试看 PASS**

Run: `pytest tests/test_api_minimax_tts_enqueue.py -v`
Expected: PASS

- [ ] **Step 3.7: Commit**

```bash
git add api_routes.py tests/test_api_minimax_tts_enqueue.py
git commit -m "feat(api): POST /api/minimax/tts now enqueues + returns task_id immediately"
```

---

## Task 4: 前端 — `apiService.handleResponse` 504 detail dict 平铺 + `minimaxTTS` 返回 task_id

**Files:**
- Modify: `new_html/services/apiService.ts:10-49` (handleResponse) + `985-1001` (minimaxTTS / minimaxTTSQuery)
- Test: `new_html/__tests__/services/apiService.handleResponse.test.ts` (新建)

- [ ] **Step 4.1: 写失败测试**

```typescript
// new_html/__tests__/services/apiService.handleResponse.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 因为 handleResponse 不是 export，需要测试通过公开函数（minimaxTTS）间接测
// 但更简单：把 handleResponse 临时改为 export（也是合理重构），或写集成测试
// 这里假设 handleResponse 已 export 出来，否则在 Step 4.2 时把 export 加上
import { handleResponse } from '../../services/apiService';

function makeRes(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('handleResponse — 504 detail dict 平铺到 Error', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('当 504 detail 是 dict 时，task_id / error / message 应平铺到 Error 对象', async () => {
    const res = makeRes(504, {
      detail: {
        error: 'tts_timeout',
        task_id: '401652318130377',
        message: 'TTS 任务超时: 401652318130377',
        hint: 'MiniMax 端任务未在窗口内完成',
      },
    });
    await expect(handleResponse(res, 'minimaxTTS')).rejects.toMatchObject({
      message: expect.stringContaining('tts_timeout'),
      task_id: '401652318130377',
      error: 'tts_timeout',
      hint: expect.stringContaining('MiniMax'),
      status: 504,
    });
  });

  it('当 detail 是字符串时，行为不变（向后兼容）', async () => {
    const res = makeRes(500, { detail: 'something broke' });
    await expect(handleResponse(res, 'X')).rejects.toThrow(/something broke/);
  });

  it('200 OK 正常解析 JSON', async () => {
    const res = makeRes(200, { success: true, task_id: 'abc' });
    const data = await handleResponse(res, 'X');
    expect(data).toEqual({ success: true, task_id: 'abc' });
  });
});
```

- [ ] **Step 4.2: 跑测试看 FAIL**

Run: `cd new_html && npx vitest run __tests__/services/apiService.handleResponse.test.ts`
Expected: FAIL — 现版本只在 message 里序列化，未平铺字段

- [ ] **Step 4.3: 改 `handleResponse` 平铺逻辑 + export**

替换 `new_html/services/apiService.ts:10-50`：

```typescript
/**
 * 统一的响应处理函数
 * 2026-05-24：504 / 4xx / 5xx 的 detail 若是 dict，平铺到 Error 对象上，
 * 让上层能用 e.task_id / e.error 做精细处理（之前一律 [object Object]）。
 */
export async function handleResponse(response: Response, apiName: string = 'API'): Promise<any> {
    if (response.status === 401) {
        console.error(`${apiName} 返回401，token可能已失效，跳转到登录页`);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
        window.location.href = '/login';
        throw new Error('未授权，请重新登录');
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error(`${apiName} 返回非JSON响应 (${response.status}):`, text.substring(0, 200));
        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
            throw new Error(`${apiName} 返回了HTML页面而非JSON (${response.status})，可能是路由不存在或服务器错误`);
        }
        throw new Error(`${apiName} 返回了非JSON响应: ${text.substring(0, 100)}`);
    }

    let data: any;
    try {
        data = await response.json();
    } catch (e) {
        const text = await response.text();
        console.error(`${apiName} JSON解析失败:`, text.substring(0, 200));
        throw new Error(`${apiName} 返回的数据无法解析为JSON`);
    }

    if (!response.ok) {
        const detail = data?.detail ?? data?.message;
        // detail 是 dict：平铺有用字段到 Error 上
        if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
            const human =
                detail.message ||
                detail.error ||
                JSON.stringify(detail);
            console.error(`${apiName} 返回错误 (${response.status}):`, detail);
            const err: any = new Error(`${apiName} 失败 (${response.status}): ${human}`);
            err.status = response.status;
            // 平铺所有 detail 字段（task_id / error / hint / ...）
            Object.assign(err, detail);
            throw err;
        }
        const text = typeof detail === 'string' ? detail : JSON.stringify(data);
        console.error(`${apiName} 返回错误 (${response.status}):`, text);
        const err: any = new Error(`${apiName} 失败 (${response.status}): ${text}`);
        err.status = response.status;
        throw err;
    }

    return data;
}
```

- [ ] **Step 4.4: 重写 `minimaxTTS` 返回 task_id；删 `minimaxTTSQuery`**

替换 `new_html/services/apiService.ts:985-1002`：

```typescript
/**
 * 提交 MiniMax TTS 任务（异步）。
 *
 * 2026-05-24 改造：从"同步阻塞等 audio_url"改为"立即入队拿 task_id"。
 * 调用方需要用 getTaskStatus(task_id) 轮询，或用 ttsTaskPoller。
 *
 * @returns { success: true, task_id: <数据库 task_id> }
 */
export async function minimaxTTS(data: {
    text: string; voice_id: string; model?: string;
    speed?: number; pitch?: number; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; episode_id?: string;
    bind_to_character_voice_id?: string;  // 2026-05-24 新增：worker 完成后回写 sample_audio_url
}, signal?: AbortSignal): Promise<{ success: true; task_id: string }> {
    const response = await fetch(`${API_BASE}/api/minimax/tts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
        signal,
    });
    return handleResponse(response, 'minimaxTTS');
}

// 注意：legacy minimaxTTSQuery 已删除。
// 用 getTaskStatus(task_id) 通过数据库 task_id 查询，不再直查 MiniMax 端。
```

- [ ] **Step 4.5: 跑测试看 PASS**

Run: `cd new_html && npx vitest run __tests__/services/apiService.handleResponse.test.ts`
Expected: 3 PASS

- [ ] **Step 4.6: 全量 typecheck**

Run: `cd new_html && npx tsc --noEmit`
Expected: 0 error（如果有 error 提示 `minimaxTTSQuery` 找不到 — 找到调用方删掉；Task 5/6/7 会处理 minimaxTTS 调用方的返回类型变化）

如果 typecheck 报 `minimaxTTSQuery` 未定义，找到引用：
```bash
grep -rn "minimaxTTSQuery" new_html/
```
确认只有 `apiService.ts` 自己 export 它且没人调用，typecheck 应该自动通过。

- [ ] **Step 4.7: Commit**

```bash
git add new_html/services/apiService.ts new_html/__tests__/services/apiService.handleResponse.test.ts
git commit -m "feat(api): handleResponse spreads dict detail; minimaxTTS now returns task_id"
```

---

## Task 5: 前端 — 新增 `ttsTaskPoller.ts` 轻量轮询器

**Files:**
- Create: `new_html/services/ttsTaskPoller.ts`
- Test: `new_html/__tests__/services/ttsTaskPoller.test.ts`

**说明：** `videoTaskPoller` 与视频卡片状态深耦合（uuid groups, candidate UI, taskRegistry meta），TTS 场景更简单（每条 clip 一条任务，VoiceSidebar 是 modal），所以新建一个 50 行的薄壳轮询器更清晰。复用底层 `getTaskStatus(task_id)`。

- [ ] **Step 5.1: 写失败测试**

```typescript
// new_html/__tests__/services/ttsTaskPoller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollTtsTaskUntilDone } from '../../services/ttsTaskPoller';

describe('pollTtsTaskUntilDone', () => {
  beforeEach(() => vi.useFakeTimers());

  it('completed 状态返回 audio_url + file_id', async () => {
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'processing', progress: 50 })
      .mockResolvedValueOnce({
        status: 'completed',
        result: { audio_url: '/storage/audio/x.mp3', file_id: 'fid-1', duration_ms: 1200 },
      });
    const promise = pollTtsTaskUntilDone('task-1', { intervalMs: 100, timeoutMs: 60000, getStatus });
    await vi.advanceTimersByTimeAsync(250);
    const result = await promise;
    expect(result).toEqual({ audio_url: '/storage/audio/x.mp3', file_id: 'fid-1', duration_ms: 1200 });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('failed 状态抛错', async () => {
    const getStatus = vi.fn().mockResolvedValueOnce({
      status: 'failed', result: { error: 'TTS 任务超时: mx-1' },
    });
    const promise = pollTtsTaskUntilDone('task-2', { intervalMs: 100, timeoutMs: 60000, getStatus });
    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).rejects.toThrow(/TTS 任务超时/);
  });

  it('AbortSignal 取消时抛 AbortError', async () => {
    const ctrl = new AbortController();
    const getStatus = vi.fn().mockResolvedValue({ status: 'processing' });
    const promise = pollTtsTaskUntilDone('task-3', {
      intervalMs: 100, timeoutMs: 60000, getStatus, signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(), 50);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('timeout 抛 TtsTimeoutError', async () => {
    const getStatus = vi.fn().mockResolvedValue({ status: 'processing' });
    const promise = pollTtsTaskUntilDone('task-4', { intervalMs: 100, timeoutMs: 300, getStatus });
    await vi.advanceTimersByTimeAsync(400);
    await expect(promise).rejects.toThrow(/超时|timeout/i);
  });
});
```

- [ ] **Step 5.2: 跑测试看 FAIL**

Run: `cd new_html && npx vitest run __tests__/services/ttsTaskPoller.test.ts`
Expected: FAIL with "Cannot find module '../../services/ttsTaskPoller'"

- [ ] **Step 5.3: 实现 `ttsTaskPoller.ts`**

```typescript
// new_html/services/ttsTaskPoller.ts
/**
 * TTS Task Poller — 把 `POST /api/minimax/tts` 返回的 task_id 轮询到完成。
 *
 * 2026-05-24 引入：MiniMax TTS 改为 worker 异步任务后，前端用这个薄轮询器统一接管。
 * 不引入到 globalTaskManager / videoTaskPoller — 这俩绑定了视频卡片 UI，TTS 不需要。
 *
 * 设计：
 *   - intervalMs 默认 2000，timeoutMs 默认 480000（8 分钟兜底，超过就放弃）
 *   - 支持 AbortSignal —— Drawer 关闭 / 用户取消时立刻终止
 *   - status === 'completed' 时取 result 字段（audio_url, file_id, duration_ms）
 *   - status === 'failed' 抛 result.error 文本
 *   - 默认 getStatus 是 videoService.getTaskStatus；测试时可注入
 */
import { getTaskStatus as defaultGetStatus } from './videoService';

export interface TtsResult {
  audio_url: string;
  file_id?: string;
  duration_ms?: number;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  getStatus?: (taskId: string) => Promise<{
    status: string;
    progress?: number;
    result?: any;
  }>;
}

export class TtsTimeoutError extends Error {
  constructor(public taskId: string, public elapsedMs: number) {
    super(`TTS 轮询超时: task_id=${taskId} elapsed=${Math.round(elapsedMs / 1000)}s`);
    this.name = 'TtsTimeoutError';
  }
}

export async function pollTtsTaskUntilDone(
  taskId: string,
  opts: PollOptions = {},
): Promise<TtsResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 8 * 60 * 1000;
  const signal = opts.signal;
  const getStatus = opts.getStatus ?? (defaultGetStatus as any);
  const start = Date.now();

  while (true) {
    if (signal?.aborted) throw new DOMException('TTS poll aborted', 'AbortError');
    if (Date.now() - start > timeoutMs) throw new TtsTimeoutError(taskId, Date.now() - start);

    let s: any;
    try {
      s = await getStatus(taskId);
    } catch (e: any) {
      // 404 / 网络瞬断：等一拍再试，不立刻 fail（最多 timeoutMs 内）
      if (signal?.aborted) throw new DOMException('TTS poll aborted', 'AbortError');
      await sleep(intervalMs, signal);
      continue;
    }

    const status = s?.status;
    if (status === 'completed') {
      const result = s.result || {};
      return {
        audio_url: result.audio_url || result.file_url || '',
        file_id: result.file_id,
        duration_ms: result.duration_ms,
      };
    }
    if (status === 'failed') {
      throw new Error(s?.result?.error || 'TTS 任务失败');
    }
    await sleep(intervalMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('TTS poll aborted', 'AbortError'));
      }, { once: true });
    }
  });
}
```

- [ ] **Step 5.4: 跑测试看 PASS**

Run: `cd new_html && npx vitest run __tests__/services/ttsTaskPoller.test.ts`
Expected: 4 PASS

- [ ] **Step 5.5: Commit**

```bash
git add new_html/services/ttsTaskPoller.ts new_html/__tests__/services/ttsTaskPoller.test.ts
git commit -m "feat(audio): add ttsTaskPoller for polling minimax TTS async tasks"
```

---

## Task 6: 前端 `VoiceSidebar.handlePreview` — enqueue + poll + AbortController

**Files:**
- Modify: `new_html/components/audio/VoiceSidebar.tsx:281-341` (handlePreview)
- Test: `new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx` (新建)

- [ ] **Step 6.1: 写失败测试**

```typescript
// new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoiceSidebar } from '../../components/audio/VoiceSidebar';

vi.mock('../../services/apiService', () => ({
  minimaxTTS: vi.fn().mockResolvedValue({ success: true, task_id: 'task-99' }),
  minimaxVoiceDesign: vi.fn(),
  minimaxFileUpload: vi.fn(),
  minimaxVoiceClone: vi.fn(),
  createCharacterVoice: vi.fn(),
  updateCharacterVoice: vi.fn(),
  deleteCharacterVoice: vi.fn(),
}));

vi.mock('../../services/ttsTaskPoller', () => ({
  pollTtsTaskUntilDone: vi.fn().mockResolvedValue({
    audio_url: '/storage/audio/preview_x.mp3',
    file_id: 'fid-99',
    duration_ms: 1500,
  }),
  TtsTimeoutError: class extends Error {},
}));

describe('VoiceSidebar.handlePreview — 异步入队 + 轮询', () => {
  beforeEach(() => vi.clearAllMocks());

  it('点击试听后，先调 minimaxTTS 入队，再调 pollTtsTaskUntilDone，得到 audio_url', async () => {
    const { minimaxTTS } = await import('../../services/apiService');
    const { pollTtsTaskUntilDone } = await import('../../services/ttsTaskPoller');

    render(<VoiceSidebar role={MOCK_ROLE_NO_VOICE} open onClose={() => {}} onSaved={async () => {}} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: /试听/ }));

    await waitFor(() => {
      expect(minimaxTTS).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.any(String), voice_id: expect.any(String) }),
        expect.any(AbortSignal),
      );
      expect(pollTtsTaskUntilDone).toHaveBeenCalledWith('task-99', expect.any(Object));
    });

    // audio element 的 src 应被设置
    await waitFor(() => {
      const audio = document.querySelector('audio') as HTMLAudioElement;
      expect(audio.src).toContain('/storage/audio/preview_x.mp3');
    });
  });

  it('Drawer 关闭时 AbortController 必须取消进行中的轮询', async () => {
    const { pollTtsTaskUntilDone } = await import('../../services/ttsTaskPoller');
    let abortSignal: AbortSignal | undefined;
    (pollTtsTaskUntilDone as any).mockImplementation((_id: string, opts: any) => {
      abortSignal = opts.signal;
      return new Promise(() => {});  // 永不完成
    });

    const { rerender } = render(
      <VoiceSidebar role={MOCK_ROLE_NO_VOICE} open onClose={() => {}} onSaved={async () => {}} projectId="p1" />
    );
    fireEvent.click(screen.getByRole('button', { name: /试听/ }));
    await waitFor(() => expect(abortSignal).toBeDefined());

    rerender(
      <VoiceSidebar role={MOCK_ROLE_NO_VOICE} open={false} onClose={() => {}} onSaved={async () => {}} projectId="p1" />
    );
    expect(abortSignal?.aborted).toBe(true);
  });
});

const MOCK_ROLE_NO_VOICE = { name: '测试角色', voice: null, asset: null } as any;
```

- [ ] **Step 6.2: 跑测试看 FAIL**

Run: `cd new_html && npx vitest run __tests__/components/VoiceSidebar.handlePreview.test.tsx`
Expected: FAIL — 现版本同步等 audio_url，未调 pollTtsTaskUntilDone

- [ ] **Step 6.3: 改 `VoiceSidebar.tsx` import 头**

在 `new_html/components/audio/VoiceSidebar.tsx` 文件顶部 import 区加：

```typescript
import { pollTtsTaskUntilDone, TtsTimeoutError } from '../../services/ttsTaskPoller';
import { useRef as useReactRef } from 'react';  // 若已 import useRef 则跳过
```

- [ ] **Step 6.4: 在组件函数体内加 abort controller ref + 卸载清理 effect**

在 `previewLoading` state 旁边加：

```typescript
const previewAbortRef = useRef<AbortController | null>(null);

// 组件卸载 / open=false 时 abort 进行中的轮询（recurring-pitfalls §H）
useEffect(() => {
  if (!open && previewAbortRef.current) {
    previewAbortRef.current.abort();
    previewAbortRef.current = null;
  }
  return () => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }
  };
}, [open]);
```

- [ ] **Step 6.5: 改 `handlePreview` 的 system 分支为 enqueue + poll**

替换 `new_html/components/audio/VoiceSidebar.tsx:281-341` 整个 handlePreview 函数：

```typescript
  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);
    // 新 AbortController：每次点击试听都覆盖旧的（先 abort 旧的）
    if (previewAbortRef.current) previewAbortRef.current.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;

    try {
      if (voiceSource === 'design') {
        const key = designKey();
        const cached = getVoicePreview(key);
        if (cached?.audioUrl) {
          setPreviewUrl(cached.audioUrl);
          setPreviewIsPersisted(true);
          return;
        }
        const res = await minimaxVoiceDesign(buildVoiceDesignPrompt(designSetting), designText);
        const audioUrl = res.audio_url ? resolveUrl(res.audio_url)
          : res.trial_audio ? hexToAudioBlobUrl(res.trial_audio)
          : '';
        if (res.voice_id && audioUrl) {
          setVoicePreview(key, { voiceId: res.voice_id, audioUrl });
        }
        if (audioUrl) {
          setPreviewUrl(audioUrl);
          setPreviewIsPersisted(true);
        }
      } else if (voiceSource === 'system') {
        const key = systemKey();
        const cached = getVoicePreview(key);
        if (cached?.audioUrl) {
          setPreviewUrl(cached.audioUrl);
          setPreviewIsPersisted(true);
          return;
        }
        // 2026-05-24：异步入队 + 轮询。worker 完成后若 bind_to_character_voice_id
        // 已传则同时回写 character_voices.sample_audio_url 让下次直接命中。
        const existingVoiceId = role?.voice?.voiceId;
        const submitted = await minimaxTTS({
          text: '你好，这是一段测试语音。',
          voice_id: systemVoiceId,
          speed: 1.0, pitch: 0,
          bind_to_character_voice_id: existingVoiceId,
        }, controller.signal);
        const result = await pollTtsTaskUntilDone(submitted.task_id, {
          signal: controller.signal,
          intervalMs: 2000,
          timeoutMs: 8 * 60 * 1000,
        });
        if (result.audio_url) {
          const url = resolveUrl(result.audio_url);
          setVoicePreview(key, { voiceId: systemVoiceId, audioUrl: url });
          setPreviewUrl(url);
          setPreviewIsPersisted(true);
        }
      } else if (voiceSource === 'clone') {
        if (!previewUrl) {
          alert('请先选择并保存克隆音频，再试听');
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;  // 关 drawer 取消，不报错
      console.error('试听失败:', e);
      const msg = e?.message || '试听失败';
      const taskHint = e?.task_id ? `（task_id: ${e.task_id}）` : '';
      if (e instanceof TtsTimeoutError || /tts.*超时|timeout/i.test(msg)) {
        alert(`试听超时${taskHint}：MiniMax 端任务在 8 分钟内未完成。可稍后重试，或检查后台 worker 日志。`);
      } else if (/未配置|MINIMAX_API_KEY|503/.test(msg)) {
        alert(`试听失败：${msg}\n\n请联系管理员在后台 → API 配置 中添加 MINIMAX_API_KEY（与 Hailuo 视频共用）。`);
      } else {
        alert(`试听失败${taskHint}：${msg}`);
      }
    } finally {
      setPreviewLoading(false);
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
    }
  }, [voiceSource, designText, designSetting, systemVoiceId, designKey, systemKey, previewUrl, role]);
```

- [ ] **Step 6.6: 跑测试看 PASS**

Run: `cd new_html && npx vitest run __tests__/components/VoiceSidebar.handlePreview.test.tsx`
Expected: 2 PASS

- [ ] **Step 6.7: Commit**

```bash
git add new_html/components/audio/VoiceSidebar.tsx new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx
git commit -m "feat(audio): VoiceSidebar.handlePreview now enqueues + polls with AbortController"
```

---

## Task 7: 前端 `AudioStagePage.runGenerate` — enqueue + poll + taskRegistry 钩子

**Files:**
- Modify: `new_html/pages/AudioStagePage.tsx:154-247` (runGenerate)
- Test: `new_html/__tests__/pages/AudioStagePage.runGenerate.test.tsx` (新建)

- [ ] **Step 7.1: 写失败测试**

```typescript
// new_html/__tests__/pages/AudioStagePage.runGenerate.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/apiService', () => ({
  minimaxTTS: vi.fn().mockResolvedValue({ success: true, task_id: 'audio-task-1' }),
  updateStoryboardItem: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/ttsTaskPoller', () => ({
  pollTtsTaskUntilDone: vi.fn(),
  TtsTimeoutError: class extends Error {},
}));

vi.mock('../../services/taskRegistry', () => ({
  taskRegistry: {
    register: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    updateProgress: vi.fn(),
  },
}));

describe('AudioStagePage.runGenerate (轻量集成)', () => {
  // 由于完整的 EpisodeContext 较复杂，这里只验证关键的 enqueue+poll+complete 序列。
  // 实现策略：从 AudioStagePage 提取一个纯函数 runGenerateImpl 并对其做单测。
  it.todo('runGenerate 调用 minimaxTTS → pollTtsTaskUntilDone → updateStoryboardItem → taskRegistry.complete');
  it.todo('pollTtsTaskUntilDone 失败时 taskRegistry.fail 被调用');
  it.todo('生成中切换 episode 时 AbortController 被取消');
});
```

**说明：** 因 AudioStagePage 强依赖 EpisodeContext，做完整 component 测试成本高。这里建测试占位（it.todo）+ 在实际改完代码后人工浏览器冒烟测，并依赖 Task 5 的 ttsTaskPoller 单测保证核心逻辑。如未来 EpisodeContext 测试 fixture 完善，再补全。

- [ ] **Step 7.2: 改 `AudioStagePage.tsx` import**

在 `new_html/pages/AudioStagePage.tsx` 顶部 import 区加：

```typescript
import { pollTtsTaskUntilDone, TtsTimeoutError } from '../services/ttsTaskPoller';
```

- [ ] **Step 7.3: 加 abort controllers map（每 clip 一个）**

在 `generatingIds` state 附近加：

```typescript
const ttsAbortControllers = useRef<Map<string, AbortController>>(new Map());

// 卸载 / episode 切换时 abort 所有进行中的 TTS 轮询
useEffect(() => {
  return () => {
    ttsAbortControllers.current.forEach(c => c.abort());
    ttsAbortControllers.current.clear();
  };
}, [episodeId]);
```

- [ ] **Step 7.4: 改 `runGenerate` 走 enqueue + poll**

替换 `new_html/pages/AudioStagePage.tsx:154-247` 整个 runGenerate 函数：

```typescript
  const runGenerate = useCallback(async (clip: AudioClipInfo) => {
    const key = clipKey(clip);
    const override = localOverrides[key] || {};
    const voice = voiceMap.get(override.speaker ?? clip.characterName);

    setErrors(p => { const n = { ...p }; delete n[key]; return n; });
    setGeneratingIds(p => new Set(p).add(key));

    const registryTaskId = `tts:${clip.itemId}:${clip.type}`;
    const speakerLabel = override.speaker ?? clip.characterName ?? '配音';
    try {
      taskRegistry.register({
        taskId: registryTaskId,
        kind: 'minimax-tts',
        title: `${clip.type === 'narration' ? '旁白' : '对白'} · ${speakerLabel}`,
        targetPage: 'audio',
        initialStatus: 'running',
        progress: 0,
        targetEntityType: 'storyboard_item',
        targetEntityId: clip.itemId,
        targetItemId: clip.itemId,
        targetProjectId: projectId || undefined,
        episodeId: episodeId || undefined,
        fileRole: clip.type === 'narration' ? 'narration_audio' : 'dialogue_audio',
      });
    } catch { /* registry 失败不阻断业务 */ }

    // 先 abort 该 clip 已有的进行中任务（用户连点重试）
    const oldCtrl = ttsAbortControllers.current.get(key);
    if (oldCtrl) oldCtrl.abort();
    const controller = new AbortController();
    ttsAbortControllers.current.set(key, controller);

    try {
      const textToSpeak = override.text ?? clip.text;
      const vp = (voice?.voiceParams || {}) as any;
      const settingFromParams = (vp.setting || vp) as Record<string, any>;
      const emotion = override.emotion ?? settingFromParams.emotion;
      const speed = override.speed ?? settingFromParams.speed ?? 1.0;
      const pitch = override.pitch ?? settingFromParams.pitch ?? 0;
      const minimaxVoiceId = resolveMinimaxVoiceId(voice?.voiceModelId);

      // 1. 入队
      const submitted = await minimaxTTS({
        text: textToSpeak, voice_id: minimaxVoiceId, speed, emotion, pitch,
        entity_type: 'storyboard_item', entity_id: clip.itemId,
        file_role: clip.type === 'narration' ? 'narration_audio' : 'dialogue_audio',
        episode_id: episodeId,
      }, controller.signal);

      // 2. 轮询
      const result = await pollTtsTaskUntilDone(submitted.task_id, {
        signal: controller.signal,
        intervalMs: 2000,
        timeoutMs: 10 * 60 * 1000,
      });

      if (!result.audio_url) {
        try { taskRegistry.fail(registryTaskId, '后端未返回 audio_url'); } catch { /* noop */ }
        throw new Error('后端未返回 audio_url');
      }

      const url = result.audio_url;
      const durationMs = result.duration_ms;
      setLocalAudio(p => ({ ...p, [key]: { url: resolveUrl(url), durationMs } }));

      const updateFields: Record<string, any> = {};
      if (clip.type === 'narration') updateFields.narration_audio_url = url;
      else updateFields.dialogue_audio_url = url;
      if (durationMs != null && Number.isFinite(durationMs)) updateFields.audio_duration_ms = durationMs;

      try {
        await apiUpdateStoryboardItem(clip.itemId, updateFields);
        await loadSlices('storyboardItems');
        try { taskRegistry.complete(registryTaskId, { resultUrls: [resolveUrl(url)], progress: 1 }); } catch { /* noop */ }
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error('[AudioStagePage] 配音持久化失败', clip.itemId, msg);
        setErrors(p => ({ ...p, [key]: `已生成但保存失败：${msg}（请点击重新生成）` }));
        try { taskRegistry.fail(registryTaskId, `已生成但保存失败：${msg}`); } catch { /* noop */ }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 用户切 episode / 重新点 = 静默丢弃
        try { taskRegistry.fail(registryTaskId, '已取消'); } catch { /* noop */ }
        return;
      }
      const tail = e?.task_id ? `（task_id: ${e.task_id}）` : '';
      const msg = e instanceof TtsTimeoutError
        ? `TTS 超时${tail}：可能 MiniMax 端排队中，请稍后重试`
        : `${e?.message || String(e)}${tail}`;
      setErrors(p => ({ ...p, [key]: msg }));
      try { taskRegistry.fail(registryTaskId, msg); } catch { /* noop */ }
    } finally {
      setGeneratingIds(p => { const n = new Set(p); n.delete(key); return n; });
      if (ttsAbortControllers.current.get(key) === controller) {
        ttsAbortControllers.current.delete(key);
      }
    }
  }, [voiceMap, localOverrides, clipKey, episodeId, projectId, loadSlices]);
```

- [ ] **Step 7.5: typecheck**

Run: `cd new_html && npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 7.6: Commit**

```bash
git add new_html/pages/AudioStagePage.tsx new_html/__tests__/pages/AudioStagePage.runGenerate.test.tsx
git commit -m "feat(audio): AudioStagePage.runGenerate now enqueues + polls per clip"
```

---

## Task 8: 试听持久化全链路核查（Phase C — 用户明确要求）

**Files:**
- Read-only verification: `new_html/components/audio/VoiceSidebar.tsx`, `dao_character_voice.py`, `new_html/utils/voicePreviewCache.ts`
- 若发现 gap，按发现 fix 并补测试

- [ ] **Step 8.1: 核查 voicePreviewCache 三种 key 唯一性**

读 [`new_html/utils/voicePreviewCache.ts`](../../new_html/utils/voicePreviewCache.ts) line 91-99：

确认：
- `system:<voice_id>` — voice_id 已是 MiniMax 全局唯一 ID
- `design:<stableStringify(setting)>:<text>` — setting 是 JSON 对象，stableStringify 确保 key 顺序无关
- `clone:<file_id>` — file_id 是数据库 UUID

无冲突可能。

- [ ] **Step 8.2: 核查 VoiceSidebar.handleSave 是否把试听 URL 写到 sample_audio_url**

读 [`new_html/components/audio/VoiceSidebar.tsx:343-461`](../../new_html/components/audio/VoiceSidebar.tsx)。

确认：
- system 分支 (line 411-418): 取 `getVoicePreview(systemKey()).audioUrl` → 写入 `sampleUrl` → `updateCharacterVoice({ sample_audio_url: sampleUrl })` ✅
- design 分支 (line 384-410): cached.audioUrl → sampleUrl ✅
- clone 分支 (line 354-373): cloneRes.audio_url → sampleUrl ✅

**已经 OK**。无需改动。

- [ ] **Step 8.3: 核查 mount 初始化优先级（cache → DB sample_audio_url）**

读 [`new_html/components/audio/VoiceSidebar.tsx:248-258`](../../new_html/components/audio/VoiceSidebar.tsx)。

确认：
```typescript
const sampleAudioFromDb = role?.voice?.sampleAudioUrl ? resolveUrl(role.voice.sampleAudioUrl) : '';
const initialCached = getVoicePreview(currentInputKey);
const initialPreviewUrl = initialCached?.audioUrl || sampleAudioFromDb;
```

已经按 cache → DB 优先级。**已经 OK**。

- [ ] **Step 8.4: 写一个全链路冒烟测试脚本（手测剧本）**

新建 `docs/superpowers/plans/minimax-tts-smoke-test.md`：

```markdown
# MiniMax TTS 异步化 冒烟测试剧本

## 场景 1: 角色声音栏 — 系统音色试听
1. 打开任一角色的"角色声音"侧栏
2. 选"系统音色"，点选某个 voice
3. 点"试听" → 按钮变 loading
4. 等 5-30s（不应超过 8min）→ 听到合成语音
5. 关闭侧栏，再打开 → 应立刻显示同一段音频（来自 voicePreviewCache）
6. 点"保存配置" → 在数据库里查 character_voices.sample_audio_url 应已被设
7. 刷新浏览器（清 sessionStorage 但保留 localStorage）→ 再打开侧栏，音频仍在（cache）
8. 清 localStorage → 再打开侧栏，音频仍在（从 DB sample_audio_url 恢复）

## 场景 2: 配音页 — 旁白/对白生成
1. 进入某个 episode 的配音页
2. 点单条 clip 的"生成" → loading
3. 5-30s 后听到合成语音；铃铛通知"对白 · XX 完成"
4. 刷新页面 → 音频应仍存在（从 storyboard_items.dialogue_audio_url）
5. 在生成中途切换到另一个 episode → 旧任务的 abort，新 episode 不受干扰

## 场景 3: 错误处理
1. 后台 stop minimax worker → 点试听 → 8 分钟后看到友好 toast「TTS 轮询超时 task_id=...」
2. 后台 unset MINIMAX_API_KEY 重启 → 点试听 → 立刻看到 503 错误（早 fail）
3. 测 Drawer 关闭中断：点试听后立刻关 drawer → 控制台不应有未捕获的 AbortError
```

- [ ] **Step 8.5: Commit smoke test 文档**

```bash
git add docs/superpowers/plans/minimax-tts-smoke-test.md
git commit -m "docs: add smoke test script for minimax tts async overhaul"
```

---

## Task 9: 文档同步（recurring-pitfalls + faq + api + conventions）

**Files:**
- Modify: `.claude/skills/project-memory/references/recurring-pitfalls.md`
- Modify: `docs/faq.md`
- Modify: `docs/api.md`
- Modify: `docs/conventions.md`

- [ ] **Step 9.1: recurring-pitfalls.md 加 §Q**

在 [`.claude/skills/project-memory/references/recurring-pitfalls.md`](../../.claude/skills/project-memory/references/recurring-pitfalls.md) 末尾新增 §Q 章节（在 §P 之后、§Z 之前）：

```markdown
## Q. HTTP handler 内阻塞超过反代 idle timeout

**Why it bites repeatedly**: 长任务（>60s）写成 `async def handler(): await long_blocking_call()`
看起来代码很对，但 autodl / nginx / cloudfront 反代有 idle timeout（autodl ≈ 5min，
默认 nginx 60s），超过会**杀连接**，前端 fetch 收到的不是干净 504，而是 connection
reset / hang，体感"一直 loading"。

**Detection signals**
- handler 内有 `max_wait > 60` 的 poll loop
- 用户报"一直 loading"或"504"但 task_id 在 log 里正常签发
- 同一 endpoint 重复请求出现两个不同 task_id（log 里只看到旧 task_id 超时，新的还没结算）
- handler 等待时间正好在反代 idle 边界（300s 撞 5min, 60s 撞默认 nginx）

**Process discipline**
1. 任何 handler 内 `max_wait > 60s` 的轮询都必须挪到 worker / task_queue
2. handler 立刻返回 task_id，前端用 `/api/task/{id}` 轮询
3. handler 内只做 fail-fast 配置校验（如 `_require_minimax_client`）+ 入队
4. worker 进程不受反代约束，可以撑 10 分钟以上
5. **反指标自查**：grep `await.*tts_wait|await.*long|max_wait=` 排查所有 handler

**例子（2026-05-24）**：`POST /api/minimax/tts` 原 handler 内 `await tts_wait_and_download(max_wait=300)`
撞 autodl 5min 反代边界。改为 `task_service.submit('minimax_tts', ...)` + worker
`_process_minimax_tts_task` 后彻底消除。同样的范式适用于所有外部 API 长任务（wan26 / seedance /
kling / vidu / happyhorse 都已遵循）。
```

- [ ] **Step 9.2: faq.md 加 entry**

在 [`docs/faq.md`](../../docs/faq.md) 顶部（按时间倒序）加：

```markdown
## 2026-05-24 · MiniMax TTS 试听/配音一直 loading / `TTS 任务超时`

**Symptom**: 角色声音栏点试听、配音页点生成，按钮长时间 loading 后失败；后台 log:

\`\`\`
api_routes - INFO - MiniMax TTS 任务已签发: task_id=401653470724288 ...
api_routes - ERROR - MiniMax TTS 超时: task_id=401652318130377 ...
\`\`\`

签发和超时的 task_id 不同 — 因为多条任务 enqueue 在 handler 内排队等。

**Root Cause**: `POST /api/minimax/tts` handler 内 `await client.tts_wait_and_download(max_wait=300)`，
撞 autodl 反代 idle ~5min 边界 → 反代杀连接 → 前端 fetch hang。详见 recurring-pitfalls §Q。

**Fix (3-4 天工作量)**：
1. `worker.py`：新增 `_process_minimax_tts_task` + dispatch `elif task.task_type == 'minimax_tts'`
2. `api_routes.py`：`POST /api/minimax/tts` 改 `task_service.submit('minimax_tts', ...)`，立刻返回 task_id
3. `dao_character_voice.py`：新增 `update_sample_audio_url(voice_id, url)`，供 worker 回写
4. `new_html/services/apiService.ts`：`minimaxTTS` 返回 `{task_id}`；`handleResponse` 504 detail 平铺
5. `new_html/services/ttsTaskPoller.ts`（新）：薄轮询器
6. `new_html/components/audio/VoiceSidebar.tsx`：handlePreview 改 enqueue+poll，AbortController
7. `new_html/pages/AudioStagePage.tsx`：runGenerate 改 enqueue+poll，per-clip AbortController

**Files**: `worker.py`, `api_routes.py`, `dao_character_voice.py`, `new_html/services/apiService.ts`,
`new_html/services/ttsTaskPoller.ts`, `new_html/components/audio/VoiceSidebar.tsx`,
`new_html/pages/AudioStagePage.tsx`

**Lesson**:
- 长任务（>60s）一律 worker 卸载，handler 内只入队
- 504 detail 是 dict 时务必平铺到 Error 对象，否则前端拿不到 task_id 续轮询
- voicePreviewCache + character_voices.sample_audio_url 双层持久化策略验证 OK（无需变更）
- 上一轮 fix（status case + max_wait 120→300）只解决了"假超时"，没解决"真超时 + 反代撞墙"——
  pitfalls §A 警告的 mis-attribution
```

- [ ] **Step 9.3: api.md 更新**

在 [`docs/api.md`](../../docs/api.md) 找 `task_type` 表格，加一行：

```markdown
| `minimax_tts` | MiniMax 文本转语音（异步） | text, voice_id, model, speed, pitch, emotion, entity_type, entity_id, file_role, episode_id, bind_to_character_voice_id |
```

并在 `POST /api/minimax/tts` 段（如果有）改为：

```markdown
### `POST /api/minimax/tts` — MiniMax TTS 异步入队（2026-05-24 改造）

**变更**: 原同步阻塞 300s 直接返回 audio_url。现立即返回数据库 task_id；前端通过
`GET /api/task/{task_id}` 轮询完成状态，从 `result.audio_url` / `result.file_id` 取结果。

**Request**:
\`\`\`json
{
  "text": "你好世界",
  "voice_id": "female-shaonv",
  "model": "speech-2.8-hd",
  "speed": 1.0,
  "pitch": 0,
  "emotion": null,
  "entity_type": "storyboard_item",
  "entity_id": "item-uuid",
  "file_role": "dialogue_audio",
  "episode_id": "ep-uuid",
  "bind_to_character_voice_id": "voice-uuid (可选 — 试听场景传入，worker 完成时回写 character_voices.sample_audio_url)"
}
\`\`\`

**Response (202-ish 但 status 200)**:
\`\`\`json
{ "success": true, "task_id": "<数据库 task_id (uuid)>" }
\`\`\`

**Errors**:
- 401: 未登录
- 503: MINIMAX_API_KEY 未配置 或 task_service 未初始化

**Polling**: `GET /api/task/{task_id}` 返回 `{status: pending|processing|completed|failed, result: {...}}`

**诊断**: 旧 `GET /api/minimax/tts/{mx_task_id}` 仍保留，直查 MiniMax 端任务状态（运维用）。
```

- [ ] **Step 9.4: conventions.md 加约束**

在 [`docs/conventions.md`](../../docs/conventions.md) "task_type naming" 段后加：

```markdown
### 长任务必须 worker 卸载（2026-05-24 强制）

**规则**: 任何 handler 内 `max_wait > 60s` 的轮询都必须迁到 worker。

**原因**: autodl 反代 idle timeout ~5min，nginx 默认 60s。handler 内长 await 会被反代杀连接，前端体感卡死。

**模板**:
1. handler: `await task_service.get().submit(task_type, task_data, user_id, prepare=False)` → 立刻 return task_id
2. worker.py dispatch 分支: `elif task.task_type == '<your_type>': return await self._process_<your_type>_task(task)`
3. worker 方法内: 跑完整轮询 + 入库 + entity 同步 + `task_queue.complete_task(task_id, result)`
4. 前端: POST 拿 task_id → `getTaskStatus(task_id)` 轮询

详见 recurring-pitfalls §Q。
```

- [ ] **Step 9.5: Commit docs**

```bash
git add docs/faq.md docs/api.md docs/conventions.md .claude/skills/project-memory/references/recurring-pitfalls.md
git commit -m "docs: capture minimax tts async overhaul lessons (pitfalls §Q, faq, api, conventions)"
```

---

## Task 10: 镜像到 deploy/ + 构建 + sync_check

**Files:**
- Mirror: `api_routes.py` → `deploy/api_routes.py`
- Mirror: `worker.py` → `deploy/worker.py`
- Mirror: `dao_character_voice.py` → `deploy/dao_character_voice.py`
- Mirror: `new_html/services/apiService.ts` → `deploy/new_html/services/apiService.ts`
- Mirror: `new_html/services/ttsTaskPoller.ts` → `deploy/new_html/services/ttsTaskPoller.ts`
- Mirror: `new_html/components/audio/VoiceSidebar.tsx` → `deploy/new_html/components/audio/VoiceSidebar.tsx`
- Mirror: `new_html/pages/AudioStagePage.tsx` → `deploy/new_html/pages/AudioStagePage.tsx`
- Mirror: `docs/*.md` → `deploy/docs/*.md`
- Rebuild: `new_html/dist` → `deploy/new_html/dist`

- [ ] **Step 10.1: 镜像后端 Python 文件**

PowerShell:
```powershell
Copy-Item h:\MY2\api_routes.py h:\MY2\deploy\api_routes.py -Force
Copy-Item h:\MY2\worker.py h:\MY2\deploy\worker.py -Force
Copy-Item h:\MY2\dao_character_voice.py h:\MY2\deploy\dao_character_voice.py -Force
```

- [ ] **Step 10.2: 镜像前端 TS / TSX 源文件**

```powershell
Copy-Item h:\MY2\new_html\services\apiService.ts h:\MY2\deploy\new_html\services\apiService.ts -Force
Copy-Item h:\MY2\new_html\services\ttsTaskPoller.ts h:\MY2\deploy\new_html\services\ttsTaskPoller.ts -Force
Copy-Item h:\MY2\new_html\components\audio\VoiceSidebar.tsx h:\MY2\deploy\new_html\components\audio\VoiceSidebar.tsx -Force
Copy-Item h:\MY2\new_html\pages\AudioStagePage.tsx h:\MY2\deploy\new_html\pages\AudioStagePage.tsx -Force
```

- [ ] **Step 10.3: 镜像 docs**

```powershell
Copy-Item h:\MY2\docs\faq.md h:\MY2\deploy\docs\faq.md -Force
Copy-Item h:\MY2\docs\api.md h:\MY2\deploy\docs\api.md -Force
Copy-Item h:\MY2\docs\conventions.md h:\MY2\deploy\docs\conventions.md -Force
```

注意 `.claude/skills/project-memory/references/recurring-pitfalls.md` 是 dev-only 文件，**不镜像到 deploy**（与历史约定一致）。

- [ ] **Step 10.4: 重建前端 dist**

```powershell
cd h:\MY2\new_html
npm run build
```

Expected: `dist/index.html` + `dist/assets/index-*.js` 等正常生成，无 error。

警告 "Some chunks are larger than 500 KiB" 是已知 pre-existing，忽略。

- [ ] **Step 10.5: 镜像 dist**

```powershell
Remove-Item h:\MY2\deploy\new_html\dist -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item h:\MY2\new_html\dist h:\MY2\deploy\new_html\dist -Recurse -Force
```

- [ ] **Step 10.6: 跑 project-memory 扫描 + sync_check**

```powershell
cd h:\MY2
python .claude/skills/project-memory/scripts/scan_project.py .
python .claude/skills/project-memory/scripts/sync_check.py . --strict --levels ERROR
```

Expected: exit 0（pre-existing INFO/WARN OK，ERROR 必须为 0）

如果 sync_check 报 `route-undocumented`：检查 docs/api.md 是否漏写 `POST /api/minimax/tts` 异步语义；按提示补。

- [ ] **Step 10.7: Commit mirror + build**

```bash
git add deploy/ new_html/dist/
git commit -m "chore: mirror minimax tts async overhaul to deploy/ + rebuild dist"
```

---

## Task 11: 端到端冒烟测试 + 合并准备

- [ ] **Step 11.1: 后端单测全跑**

```powershell
cd h:\MY2
pytest tests/test_worker_minimax_tts.py tests/test_api_minimax_tts_enqueue.py tests/test_dao_character_voice_sample_audio.py -v
```

Expected: 全 PASS

- [ ] **Step 11.2: 前端单测全跑**

```powershell
cd h:\MY2\new_html
npx vitest run __tests__/services/apiService.handleResponse.test.ts __tests__/services/ttsTaskPoller.test.ts __tests__/components/VoiceSidebar.handlePreview.test.tsx
```

Expected: 全 PASS（AudioStagePage 测试是 it.todo，会显示 todo 但不 fail）

- [ ] **Step 11.3: 全量 typecheck**

```powershell
cd h:\MY2\new_html
npx tsc --noEmit
```

Expected: 0 error

- [ ] **Step 11.4: 启动服务，按 smoke test 剧本跑**

按 `docs/superpowers/plans/minimax-tts-smoke-test.md` 完整跑一遍（场景 1 + 2 + 3）。

Expected: 三个场景全部按预期表现；无控制台未捕获错误；无后端 traceback。

- [ ] **Step 11.5: 最终 commit（如有微调）+ 准备合并**

```powershell
git status
# 如果有 uncommitted 微调（typo、注释），单独提交
git log --oneline -15
```

Expected: 6-8 个原子 commit（每个 Task 对应 1-2 个 commit），干净可 revert。

---

## Self-Review Checklist

完成所有 Task 后，逐项核对：

- [ ] **Spec 覆盖**: 用户两条原诉求都被覆盖？
  - "语音页面一直 loading 拿不到结果" → Task 2/3/5/7 治本（worker + poller）；Task 6 同时支持 Drawer
  - "角色声音栏 看不到预览的音频" → Task 6（VoiceSidebar.handlePreview enqueue+poll）+ Task 8（持久化核查）
- [ ] **类型一致性**: `minimaxTTS()` 在 apiService 改为返回 `{task_id}` 后，**所有** 调用方都已更新？
  - VoiceSidebar.handlePreview ✓ (Task 6)
  - AudioStagePage.runGenerate ✓ (Task 7)
  - `grep -rn "minimaxTTS(" new_html/` 验证无其他调用方
- [ ] **No placeholders**: 全文搜 TBD / TODO（除 it.todo 测试占位外）/ "fill in" / "similar to" 应 0 命中
- [ ] **Recurring-pitfalls 命中**: 本次修复正面命中 §Q（HTTP handler 阻塞）、防范 §A（mis-attribution）、§H（state-coupled-to-lifecycle，VoiceSidebar drawer 关闭 abort）
- [ ] **Pre-claim-done §Z**: 用户报告的两条都跑了 smoke test 重现 + 验证；后端 log 不再出现"超时 task_id 与签发 task_id 不一致"

---

## 备注 / 不在范围内

- 不改 task_queue / Redis / cluster_main.py 任务调度基础设施
- 不动 Gemini TTS（用户在更早一轮明确要废弃，独立任务）
- 不动 MiniMax 视频任务（已经异步，正常工作）
- 不为 `minimaxTTSQuery` 写新文档，因为它已删
- 不批量回填历史试听到 sample_audio_url（可选脚本，未来需要时再做）
- 反指标排查（grep 其他可能存在的 handler 内 `max_wait > 60s`）建议作为独立 audit task 后续做

