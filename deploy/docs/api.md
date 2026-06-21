# MY2 API Reference

Base URL: `http://<host>:8000`
Auth: JWT token in `Authorization: Bearer <token>` header (except login/register)

---

## 1. Auth

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/login` | `cluster_main.py` | Session login (cookie-based) |
| POST | `/api/logout` | `cluster_main.py` | Clear session |
| GET | `/api/user/info` | `cluster_main.py` | Current user info (session) |
| POST | `/api/auth/register` | `api_routes.py` | Register new user (JWT) |
| POST | `/api/auth/login` | `api_routes.py` | JWT login → `{token, user}` |
| GET | `/api/user/profile` | `api_routes.py` | Current user profile (JWT) |

---

## 2. Projects

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/projects` | `api_routes.py` | Create project |
| GET | `/api/projects` | `api_routes.py` | List user projects (`?include_archived=true`) |
| GET | `/api/projects/{project_id}` | `api_routes.py` | Get project detail |
| PUT | `/api/projects/{project_id}` | `api_routes.py` | Update project |
| POST | `/api/projects/{project_id}/archive` | `api_routes.py` | Archive project |
| POST | `/api/projects/{project_id}/unarchive` | `api_routes.py` | Unarchive project |
| POST | `/api/projects/{project_id}/export-to-video` | frontend ref | Export project to video |
| POST | `/api/projects/{project_id}/clear-video-tasks` | frontend ref | Clear video tasks |

### Members

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/projects/{project_id}/members` | `api_routes.py` | List members |
| POST | `/api/projects/{project_id}/members` | `api_routes.py` | Add member |
| PUT | `/api/projects/{project_id}/members/{user_id}` | `api_routes.py` | Update member role |
| DELETE | `/api/projects/{project_id}/members/{user_id}` | `api_routes.py` | Remove member |

---

## 3. Episodes

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/projects/{project_id}/episodes` | `api_routes.py` | List episodes |
| POST | `/api/projects/{project_id}/episodes` | `api_routes.py` | Create episode |
| POST | `/api/projects/{project_id}/episodes/reorder` | `api_routes.py` | Reorder episodes |
| GET | `/api/episodes/{episode_id}` | `api_routes.py` | Get episode |
| PUT | `/api/episodes/{episode_id}` | `api_routes.py` | Update episode |
| DELETE | `/api/episodes/{episode_id}` | `api_routes.py` | Delete episode |

### Script

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/episodes/{episode_id}/script` | `api_routes.py` | Get episode script |
| PUT | `/api/episodes/{episode_id}/script` | `api_routes.py` | Update episode script |
| POST | `/api/episodes/{episode_id}/export-script` | `api_routes.py` | Export script |

### Script Segments (三步生成中间产物，2026-05-29)

剧本分段（拆分→视频脚本→提取分镜）的 CRUD，落 `episode_script_segments` 表（DAO `dao_episode_script_segment.py`）。

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/episodes/{episode_id}/script-segments?script_id=...` | `api_routes.py` | List 某剧本文件的分段（按 `segment_order`） |
| PUT | `/api/episodes/{episode_id}/script-segments/batch` | `api_routes.py` | 批量 upsert 分段（拆分/视频脚本写回） |
| DELETE | `/api/episodes/{episode_id}/script-segments?script_id=...` | `api_routes.py` | 删除某剧本文件的全部分段 |

---

## 4. Versions

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/versions` | `api_routes.py` | Create version snapshot |
| GET | `/api/versions/{version_id}` | `api_routes.py` | Get version detail |
| POST | `/api/versions/{version_id}/restore` | `api_routes.py` | Restore version |
| DELETE | `/api/versions/{version_id}` | `api_routes.py` | Delete version |

---

## 5. Storyboard Items

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/episodes/{episode_id}/storyboard-items` | `api_routes.py` | List items |
| POST | `/api/episodes/{episode_id}/storyboard-items` | `api_routes.py` | Create item |
| POST | `/api/episodes/{episode_id}/storyboard-items/batch` | frontend ref | Batch create items；`items[]` 现支持三步生成字段 `script_segment_id / source_video_shot_no / video_script_block / shot_size / camera_angle` |
| POST | `/api/episodes/{episode_id}/storyboard-items/reorder` | `api_routes.py` | Reorder items |
| DELETE | `/api/episodes/{episode_id}/storyboard-items/all` | `api_routes.py` | Delete all items |
| PUT | `/api/storyboard-items/{item_id}` | `api_routes.py` | Update item |
| DELETE | `/api/storyboard-items/{item_id}` | `api_routes.py` | Delete item |
| POST | `/api/storyboard/mix-audio` | `api_routes.py` → `audio_mix_service.mix_storyboard_audio` | Mix dialogue/narration/sfx into one reference_audio; cached by sha1 |

### POST /api/storyboard/mix-audio

ffmpeg `amix` 把 dialogue / narration / sfx 三轨合一并落库。结果按 sha1(urls + gains) 缓存到 `storyboard_items.mixed_audio_url / mixed_audio_hash`，相同输入直接复用。

**Auth**: Bearer token（任何登录用户）。

**Request body**:
```json
{
  "item_id": "sb_xxx",
  "dialogue_url":  "/storage/audio/d.mp3",
  "narration_url": "/storage/audio/n.mp3",
  "sfx_url":       null,
  "dialogue_gain_db":  0.0,
  "narration_gain_db": -3.0,
  "sfx_gain_db":       -8.0
}
```

**Response (200)**:
```json
{ "success": true, "mixed_audio_url": "/storage/audio/mixed.mp3", "cached": false, "duration_ms": 4800 }
```

**Errors**: `400` 三个 url 全空；`404` 未知 `item_id`；`503` ffmpeg 不可用；`500` ffmpeg 执行失败。

调用方：`new_html/pages/VideoGenPage.handleImportAll`（导入完成后异步并发 ≤3 mix）。详细单测见 `tests/test_audio_mix_service.py`。

---

## 6. Assets

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/projects/{project_id}/assets` | `api_routes.py` | List assets (`?episode_id=&type=`) |
| POST | `/api/episodes/{episode_id}/extract-to-assets` | frontend ref | Extract storyboard to assets |
| POST | `/api/assets` | `api_routes.py` | Create asset |
| PUT | `/api/assets/{asset_id}` | `api_routes.py` | Update asset |
| DELETE | `/api/assets/{asset_id}` | `api_routes.py` | Delete asset |

---

## 7. Entity Files

Unified file management for storyboard items, assets, video segments.

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/entity-files` | `api_routes.py` | Query files (`?entity_type=&entity_id=&file_role=`) |
| POST | `/api/entity-files/upload` | `api_routes.py` | Upload + link to entity |
| POST | `/api/entity-files/link` | `api_routes.py` | Link existing file to entity (deprecated) |
| PUT | `/api/entity-files/{file_id}/select` | `api_routes.py` | Select file as active |
| DELETE | `/api/entity-files/{file_id}` | `api_routes.py` | Soft delete file |
| DELETE | `/api/entity-files/{file_id}/hard` | `api_routes.py` | Hard delete: 删除磁盘文件 + DB 记录 |
| POST | `/api/entity-files/hard-delete-batch` | `api_routes.py` | 批量硬删除（body: `{file_ids: [...]}`, 上限 200） |

### Raw Files

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/files/upload` | `api_routes.py` | Upload raw file |
| GET | `/api/files/{file_id}/download` | `api_routes.py` | Download file |
| DELETE | `/api/files/{file_id}` | `api_routes.py` | Delete file |
| POST | `/api/upload` | `cluster_main.py` | Upload file (legacy) |

---

## 8. Image Generation

### Direct API (synchronous response)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/gemini/image` | `cluster_main.py` | Gemini image generation (化神 nano2, `gemini-3.1-flash-image-preview`) → `{images, files}`。2026-05-21 nano3→nano2 in-place 升级；旧 model 字符串 `gemini-3-pro-image-preview` 经别名表自动重路由。Body: `{prompt, model, references[], aspectRatio, imageSize}`，`imageSize` 仅 `gemini-3.1-flash-image-preview` / 旧 pro 接受 `1K`/`2K`/`4K`。 |
| POST | `/api/gpt-image/generate` | `cluster_main.py` | **2026-05-21 新增**。OpenAI Images API 兼容网关（laozhang）。Body: `{tier, prompt, references[], size, quality, n}`。`tier='vip'` → `gpt-image-2-vip` + `GPT_IMAGE_API_KEY`（默认分组）；`tier='official'` → `gpt-image-2` + `SORA2_GPT_IMAGE_API_KEY`（Sora2Official 分组）。`references` 为空 → `/v1/images/generations` 文生图；非空 → `/v1/images/edits` 图改图（multipart）。返回 `{success, images, files, model, tier}`。 |
| POST | `/api/materials/doubao` | `cluster_main.py` | Doubao image generation → `{images, files}` |
| POST | `/api/generate/multi-grid-storyboard` | `cluster_main.py` | Multi-grid storyboard → `{images, files}` |

### ComfyUI Worker (async task queue)

| Method | Path | Handler | task_type |
|--------|------|---------|-----------|
| POST | `/api/generate` | `cluster_main.py` | i2v / morph / upscale / voice / wan26_i2v / sora2_t2v / sora2_i2v / veo_i2v / minimax_video / **seedance_t2v** / **seedance_i2v** / **seedance_morph** / **seedance_multi** / **seedance_draft** / **kling_t2v** / **kling_i2v** / **kling_morph** / **kling_refer** / **vidu_r2v** / **vidu_morph** / **happyhorse_r2v** / **minimax_tts** |
| POST | `/api/generate/comfyui-workflow` | `cluster_main.py` | qwen / kontext / custom workflows |
| POST | `/api/generate/image` | `cluster_main.py` | i2i_fj |
| POST | `/api/generate/angle-adjust` | `cluster_main.py` | i2i_fj (angle) |
| POST | `/api/generate/human-multi-angle` | `cluster_main.py` | i2i_human |
| POST | `/api/generate/around-angle` | `cluster_main.py` | i2i_around |
| POST | `/api/generate/matting` | `cluster_main.py` | matting_subject / matting_split |
| POST | `/api/generate/image-fusion` | `cluster_main.py` | image_fusion / image_transfer / pose_imitation |
| POST | `/api/generate/panorama-360` | `cluster_main.py` | panorama_360 |
| POST | `/api/generate/panorama-fusion` | `cluster_main.py` | panorama_fusion_1 / panorama_fusion_3 |
| POST | `/api/generate/auto-storyboard` | `cluster_main.py` | auto_storyboard |
| POST | `/api/materials/process` | `cluster_main.py` | upscale_hd / remove_watermark / three_view |
| POST | `/api/comfyui/upload` | `cluster_main.py` | Upload image to ComfyUI node |

All generation request bodies accept entity fields:
```
entity_type, entity_id, file_role, episode_id
```

---

## 9. Audio Generation

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/audio/generate-speech` | `api_routes.py` | Gemini TTS → `{audio_url: '/storage/audio/...', file_id, file_url}`。GEMINI_API_KEY 缺失返回 503。**配音页已切到 MiniMax，本接口仅作兜底**。 |
| POST | `/api/audio/generate-sfx` | `api_routes.py` | Sound effects → `{audio_url, file_id, file_url}` |
| POST | `/api/audio/generate-music` | `api_routes.py` | Music generation → `{audio_url, file_id, file_url}` |

### MiniMax Audio

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/minimax/tts` | `api_routes.py` | **2026-05-24 改异步**。`task_service.submit('minimax_tts', ...)` → 立即返回 `{success, task_id}`；前端用 `GET /api/task/{task_id}` 轮询 `result.audio_url` / `result.file_id`。详见下方 `POST /api/minimax/tts` 段。共用 `MINIMAX_API_KEY`（admin provider=minimax / Hailuo）。 |
| POST | `/api/minimax/tts/sync` | `api_routes.py` | **2026-05-25 新增 fast-path**。≤1000 字符短文本试听 handler 内同步调 `/v1/t2a_v2`（1-3s）→ 入库 → 返回 `{audio_url, file_id, duration_ms}`。绕开 worker / 队列 / 轮询。详见下方 `POST /api/minimax/tts/sync` 段。 |
| GET | `/api/minimax/tts/{task_id}` | `api_routes.py` | **【诊断用】** 直查 MiniMax 端任务（`task_id` 是 mx_task_id，非数据库 task_id）。正常路径用 `GET /api/task/{db_task_id}`。 |
| POST | `/api/minimax/voice-design` | `api_routes.py` | Body: `{prompt, preview_text, voice_id?}` → `{voice_id, trial_audio(hex)}` |
| POST | `/api/minimax/voice-clone` | `api_routes.py` | Body: `{file_id, voice_id?, demo_text?, voice_id_prefix?}` → `{voice_id, demo_audio?}` |
| GET | `/api/minimax/voices` | `api_routes.py` | Query `voice_type=all|system|voice_cloning|voice_generation` → 官方 get_voice 列表 |
| GET | `/api/minimax/voices/{voice_id}` | `api_routes.py` | 从 list 结果中查找单个 voice_id |
| DELETE | `/api/minimax/voices/{voice_id}` | `api_routes.py` | Query `voice_type=voice_cloning|voice_generation`，转发官方 delete_voice |
| POST | `/api/minimax/music` | `api_routes.py` | MiniMax music generation |
| POST | `/api/minimax/lyrics` | `api_routes.py` | MiniMax lyrics generation |
| POST | `/api/minimax/files/upload` | `api_routes.py` | Upload to MiniMax |
| GET | `/api/minimax/files/{file_id}` | `api_routes.py` | Get MiniMax file |
| DELETE | `/api/minimax/files/{file_id}` | `api_routes.py` | Delete MiniMax file |

### `POST /api/minimax/tts` — MiniMax TTS 异步入队（2026-05-24 改造）

**变更**: 原同步阻塞 300s 直接返回 audio_url。现立即返回数据库 task_id；前端通过
`GET /api/task/{task_id}` 轮询完成状态，从 `result.audio_url` / `result.file_id` 取结果。

**Worker 内部实现（2026-05-24 二次升级）**: worker 拉到任务 → 调 MiniMax `/v1/t2a_v2`
（同步，1 步）→ hex 解码 → 写盘 → 入库 → 完成任务。原 `t2a_async_v2` 三步链路
（签发 + `query/t2a_async_query_v2` 轮询 + 下载）因 MiniMax 自家 task queue 偶发
排队 30s ~ 5min+ 已下线；现走 `/v1/t2a_v2` 同步单次 HTTP，5-15s 典型返回；不受
MiniMax 自家 task queue 排队影响。文本 <10000 字符上限（试听 / 对白远低于该
上限）。旧 `tts_async + query 轮询` 客户端方法保留在 `minimax_audio.py` 作 >3000
字长文本未来 fallback，未挂载。详见 `recurring-pitfalls.md §R`。

**Request**:
```json
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
```

**Response (202-ish 但 status 200)**:
```json
{ "success": true, "task_id": "<数据库 task_id (uuid)>" }
```

**Errors**:
- 401: 未登录
- 503: MINIMAX_API_KEY 未配置 或 task_service 未初始化

**Polling**: `GET /api/task/{task_id}` 返回 `{status: pending|processing|completed|failed, result: {...}}`

**诊断**: 旧 `GET /api/minimax/tts/{mx_task_id}` 仍保留，直查 MiniMax 端任务状态（运维用）。

### `POST /api/minimax/tts/sync` — MiniMax TTS 同步 fast-path（2026-05-25 新增）

**短文本 TTS fast-path** —— handler 内直接 `await client.tts_sync(...)`，典型 1-3s
拿到音频字节 → 落盘 + 入库 → 直接返回 `audio_url + file_id`。**绕开 worker / Redis
队列 / 前端轮询四个环节**，试听几乎无感等待。

**适用场景（必须满足两条）**
- `text` ≤ **1000 字符**（远低于 MiniMax sync 上限 10000，留 buffer 给 autodl
  反代 5min idle timeout；典型试听文本仅几十字）
- 单次调用即可，不需要 worker 级 retry / 并发限流

**不适用 → 改用 worker 异步 `POST /api/minimax/tts`**
- 批量生成（一集 200 条对白 × 5-15s = 17-50min 远超反代边界）
- `text > 1000` 字符 — 后端直接返回 413，前端应 fallback 到 worker endpoint
- 偶发 502/限流时需要 retry 容错的场景

**Request**: 与 `POST /api/minimax/tts` 完全相同（`MinimaxTTSRequest`）：
```json
{
  "text": "你好，这是一段测试语音。",
  "voice_id": "female-shaonv",
  "model": "speech-2.8-hd",
  "speed": 1.0,
  "pitch": 0,
  "emotion": null,
  "entity_type": "storyboard_item",
  "entity_id": "item-uuid",
  "file_role": "dialogue_audio",
  "episode_id": "ep-uuid",
  "bind_to_character_voice_id": "voice-uuid (可选 — 试听场景传入，handler 完成时回写 character_voices.sample_audio_url)"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "audio_url": "/storage/audio/persisted.mp3",
  "file_id": "fid-...",
  "file_url": "/storage/audio/persisted.mp3",
  "duration_ms": 1234,
  "minimax_trace_id": "mx-..."
}
```

**Errors**
- `400`: `text` 空或纯空白
- `413`: `text > 1000` 字符（detail 文本提示「请改用 POST /api/minimax/tts」）
- `500`: MiniMax 配置缺失（`_require_minimax_client` 抛 HTTPException 503 透传） / DB 入库失败
- `502`: MiniMax 调用失败 / 返回空音频（detail 含 `minimax_trace_id` 方便排障）

**Tables touched**: `files`、`character_voices`（当 `bind_to_character_voice_id` 提供时）

**前端调用方**：`new_html/services/apiService.ts::minimaxTTSSync(payload, signal?)`，
返回 `Promise<{ success: true; audio_url; file_id; ... }>`。组件应传 `AbortSignal`
（如 Drawer 关闭 / 切换语音时取消），handler 端读不到信号但 fetch 会被中断。

**何时用 sync vs worker**

| 场景 | endpoint | 理由 |
|------|----------|------|
| VoiceSidebar 试听 | `POST /api/minimax/tts/sync` | 短文本、要快 |
| 单条对白手动生成 | `POST /api/minimax/tts/sync` 或 worker | <1000 字 sync 体验更直接 |
| 批量生成一集对白 | `POST /api/minimax/tts`（worker） | 200 条 × 5s = 17min，必须异步 |
| 长文本旁白 / 章节朗读 | `POST /api/minimax/tts`（worker） | >1000 字符 sync 会撞反代 |

详见 `recurring-pitfalls.md §R 子陷阱 4`（sync / async 双轨设计）+
`docs/superpowers/plans/2026-05-25-minimax-tts-fastpath.md`。

### Character Voices

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/projects/{project_id}/character-voices` | `api_routes.py` | List character voices for project (`project_id` is `proj_xxxx`, VARCHAR(50)) |
| POST | `/api/character-voices` | `api_routes.py` | Create character voice (Body: `{project_id, character_name, voice_provider='minimax', voice_model_id, voice_name, voice_params, ...}`) |
| PUT | `/api/character-voices/{voice_id}` | `api_routes.py` | Update voice (`voice_id` 是 UUID) |
| DELETE | `/api/character-voices/{voice_id}` | `api_routes.py` | Delete voice |

---

## 10. Video

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/episodes/{episode_id}/video-segments` | `api_routes.py` | List video segments |
| POST | `/api/episodes/{episode_id}/video-segments` | `api_routes.py` | Create video segment |
| PUT | `/api/video-segments/{segment_id}` | `api_routes.py` | Update segment |
| DELETE | `/api/video-segments/{segment_id}` | `api_routes.py` | Delete segment |
| POST | `/api/video/crop` | `cluster_main.py` | Crop video |

### Audio Tracks

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/episodes/{episode_id}/audio-tracks` | `api_routes.py` | List audio tracks |
| POST | `/api/episodes/{episode_id}/audio-tracks` | `api_routes.py` | Create audio track |
| DELETE | `/api/audio-tracks/{track_id}` | `api_routes.py` | Delete audio track |

### Timeline Tracks

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/episodes/{episode_id}/timeline-tracks` | `api_routes.py` | List timeline tracks |
| POST | `/api/episodes/{episode_id}/timeline-tracks` | `api_routes.py` | Create timeline track |
| DELETE | `/api/timeline-tracks/{track_id}` | `api_routes.py` | Delete timeline track |

### Seedance 2.0 (飞升 / 渡劫) — `POST /api/generate`

Volcengine Ark Doubao Seedance 2.0 视频生成。Worker 调 `seedance_api.SeedanceClient` 异步轮询。

| task_type | 场景 | 必填 |
|-----------|------|------|
| `seedance_t2v` | 文生视频 | `sub_model`, `prompt`, `ratio`, `duration` |
| `seedance_i2v` | 图生视频 | + `media_inputs[1]` (kind=image) |
| `seedance_morph` | 首尾帧 | + `media_inputs[2]` (role=first_frame + last_frame) |
| `seedance_multi` | 多模态参考 | + `media_inputs[0-9 image, 0-3 video, 0-3 audio]`，至少 1 图或 1 视频（不可仅音频） |
| `seedance_draft` | 1.5pro 样片复用 | + `draft_task_id` (**2.0 不支持，会被 ark 拒绝**) |

**Body 字段（GenerateRequest 扩展）**：
- `sub_model`: `"standard"` (飞升) 或 `"fast"` (渡劫，自动禁 1080p)
- `media_inputs`: `[{kind:"image"|"video"|"audio", url, role?, file_id?}]`
- `ratio`: `"adaptive"|"16:9"|"4:3"|"1:1"|"3:4"|"9:16"|"21:9"`
- `resolution`: `"480p"|"720p"|"1080p"`（fast 自动降 720p）
- `duration`: 秒数；`seed`: int（默认 -1 随机）
- `watermark`: bool；`generate_audio`: bool（AI 配音）
- `camera_fixed`: bool（仅 1.5pro 有效，2.0 系列无效）
- `draft_task_id`: 仅 1.5pro，2.0 系列前端灰显禁用

约束：图 ≤ 9 / 视频 ≤ 3 / 音频 ≤ 3（ark 硬限）；不可单独输入音频；首尾帧与 reference_image 角色互斥；contents 总大小 ≤ 64 MB；**Seedance 2.0 系列不支持直接上传含真人人脸的图/视频**（需用平台模型产物 / 预置虚拟人像 / 已授权真人素材）。

### DashScope 共享视频族 — 合体 (Kling) / 大乘 (Vidu) / 炼虚 (HappyHorse)

阿里云百炼共享 API（与 Wan2.6 同 `DASHSCOPE_API_KEY`）。Worker 统一调 `dashscope_video_api.DashScopeVideoClient` 异步轮询，10s 间隔，600s 上限。

| task_type | 场景 | 必填 | 关键参数 |
|-----------|------|------|---------|
| `kling_t2v` | Kling 文生视频 | `prompt` | `mode='std'/'pro'`、`aspect_ratio`、`duration`(3-15)、`audio`、`sub_model='standard'/'omni'` |
| `kling_i2v` | Kling 首帧生视频 | + `image_path` | 同上（aspect_ratio 以首帧为准忽略） |
| `kling_morph` | Kling 首尾帧 | + `image_path` + `image_path_end` | `mode`、`duration`、`audio` |
| `kling_refer` | Kling omni 多参考图 | + `media_inputs[1-7 image]` | 自动切到 `kling-v3-omni`，`sub_model='omni'` |
| `vidu_r2v` | Vidu 参考生视频 | + `media_inputs[1-7 image]` | `sub_model='q3-mix'/'q3'/'q3-turbo'/'q2-pro'/'q2'`、`resolution`、`size`(可选)、`audio`(仅 q3)、`duration`(1-16 for q3，1-10 for q2) |
| `vidu_morph` | Vidu 首尾帧 | + `image_path` + `image_path_end` | `sub_model='q3-pro'/'q3-turbo'/'q2-pro'/'q2-turbo'`、`resolution`、`audio`(仅 q3) |
| `happyhorse_r2v` | HappyHorse 多图参考 | + `media_inputs[1-9 image]` | `resolution='720P'/'1080P'`、`ratio`(9 档)、`duration`、`watermark`；prompt 中用 `[Image N]` 引用第 N 张图 |

**`media_inputs[].url` vs `.file_id` 优先级**：worker 优先取 `file_id`（数据库 ID → Base64 data URI），仅当无 file_id 才 fallback `url`。前端 picker 同时写两者时（url 是带 token 的预览 URL 不能给 DashScope server fetch），必须保留 file_id。

**Source 入库**：`_save_external_video(source='kling'|'vidu'|'happyhorse')`，文件名前缀如 `kling_<hex>.mp4`，自动 entity binding + video_segments.video_url 同步。

**Frontend 入口**：`new_html/services/videoService.ts` 提供：
- `submitTask(model='Kling'|'Vidu'|'HappyHorse', ...)`：0/1/2 张图简化分支
- `submitDashScopeVideoTask(params, entityOptions)`：完整多参考图 / 多 sub_model 入口（与 `submitSeedanceTask` 平行）

#### Submit payload 字段（DashScope 三家共用 `POST /api/generate`）

异步任务提交：前端 onChange 收集到 `DashScopeVideoParams` 后通过 `submitDashScopeVideoTask`
发到 `POST /api/generate`，后端按 `task_type` 前缀 + 模型字段映射到 DashScope SDK 的对应
payload 字段；worker 调 `dashscope_video_api.DashScopeVideoClient` 异步轮询。

参数（节选 2026-05-24 新增）：
- **Kling**：`kling_multi_shot` (bool)、`kling_shot_type` (`'intelligence'|'customize'`)、
  `kling_multi_prompt` (array of `{index, prompt, duration}`)、`kling_keep_original_sound` (`'yes'|'no'`)
- **Vidu**：`vidu_resolution`、`vidu_size`、`vidu_seed`、`vidu_audio`
- **HappyHorse**：`hh_resolution`、`hh_ratio`、`hh_duration`、`hh_watermark`、`hh_seed`

字段完整定义见 `new_html/services/videoService.ts::DashScopeVideoParams`；后端透传契约见
`cluster_main.py::GenerateRequest` (`extra='allow'`) + `worker.py` 各 DashScope 分支。

---

## 11. Text Generation

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/deepseek/chat` | `cluster_main.py` | DeepSeek chat (streaming SSE) |
| POST | `/api/gemini/text` | `cluster_main.py` | Gemini text generation |
| POST | `/api/texts` | `api_routes.py` | Save text content |
| GET | `/api/texts/{content_id}` | `api_routes.py` | Get text content |

---

## 12. Task Management

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/tasks` | `cluster_main.py` | List tasks (`?limit=100`) |
| GET | `/api/tasks/stream` | `cluster_main.py` | SSE task event stream |
| GET | `/api/tasks/active` | `api_routes.py` | Active tasks |
| GET | `/api/tasks/recent` | `api_routes.py` | Recent tasks |
| GET | `/api/tasks/notifications` | `api_routes.py` | Task notifications |
| GET | `/api/tasks/{task_id}/files` | `api_routes.py` | Task output files |
| GET | `/api/task/{task_id}` | `cluster_main.py` | Get task status |
| DELETE | `/api/task/{task_id}` | `cluster_main.py` | Cancel running task |
| DELETE | `/api/task/{task_id}/delete` | `cluster_main.py` | Delete task record |

### Workspace Sessions

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/workspace/save-session` | `cluster_main.py` | Save workspace state |
| POST | `/api/workspace/save-beacon` | `cluster_main.py` | Beacon save (beforeunload) |
| GET | `/api/workspace/load-session` | `cluster_main.py` | Load workspace state |
| POST | `/api/workspace/save-task` | `cluster_main.py` | Save video task |
| GET | `/api/workspace/tasks` | `cluster_main.py` | List workspace tasks |

---

## 13. Notifications

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/notifications` | `api_routes.py` | List notifications |
| GET | `/api/notifications/unread-count` | `api_routes.py` | Unread count |
| POST | `/api/notifications/{id}/read` | `api_routes.py` | Mark as read |
| POST | `/api/notifications/read-all` | `api_routes.py` | Mark all as read |
| DELETE | `/api/notifications/{id}` | `api_routes.py` | Dismiss notification |

---

## 14. Canvas

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/canvas/boards` | `api_routes.py` | Create board |
| GET | `/api/canvas/boards` | `api_routes.py` | List boards (`?project_id=`) |
| GET | `/api/canvas/boards/{board_id}` | `api_routes.py` | Get board detail |
| PUT | `/api/canvas/boards/{board_id}` | `api_routes.py` | Update board |
| DELETE | `/api/canvas/boards/{board_id}` | `api_routes.py` | Delete board |
| POST | `/api/canvas/nodes` | `api_routes.py` | Create node |
| PUT | `/api/canvas/nodes/{node_id}` | `api_routes.py` | Update node |
| DELETE | `/api/canvas/nodes/{node_id}` | `api_routes.py` | Delete node |
| POST | `/api/canvas/connections` | `api_routes.py` | Create connection |
| DELETE | `/api/canvas/connections/{id}` | `api_routes.py` | Delete connection |

---

## 15. Admin

Requires admin role. All prefixed with `/api/admin/`.

### User Management

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/admin/users` | `admin_routes.py` | List all users |
| POST | `/api/admin/users/create` | `admin_routes.py` | Create user |
| PUT | `/api/admin/users/{user_id}/permissions` | `admin_routes.py` | Update permissions |
| DELETE | `/api/admin/users/{user_id}` | `admin_routes.py` | Delete user |
| GET | `/api/admin/logs` | `admin_routes.py` | Activity logs (`?limit=`) |
| GET | `/api/admin/stats` | `admin_routes.py` | System stats |
| GET | `/api/admin/dashboard` | `admin_routes.py` | Dashboard summary |

### Workflow Templates

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/admin/workflows` | `admin_routes.py` | List workflows |
| POST | `/api/admin/workflows` | `admin_routes.py` | Create workflow |
| GET | `/api/admin/workflows/{template_id}` | `admin_routes.py` | Get workflow |
| PUT | `/api/admin/workflows/{template_id}` | `admin_routes.py` | Update workflow |
| DELETE | `/api/admin/workflows/{template_id}` | `admin_routes.py` | Delete workflow |
| POST | `/api/admin/workflows/parse-json` | `admin_routes.py` | Parse workflow JSON |
| GET | `/api/admin/workflows/scan-disk` | `admin_routes.py` | Scan disk for workflows |
| POST | `/api/admin/workflows/import-existing` | `admin_routes.py` | Import from disk |
| POST | `/api/admin/workflows/reload` | `admin_routes.py` | Reload workflow cache |

### API Configs

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/admin/api-configs` | `admin_routes.py` | List API configs |
| POST | `/api/admin/api-configs` | `admin_routes.py` | Create config |
| PUT | `/api/admin/api-configs/{config_id}` | `admin_routes.py` | Update config |
| DELETE | `/api/admin/api-configs/{config_id}` | `admin_routes.py` | Delete config |
| POST | `/api/admin/api-configs/{config_id}/test` | `admin_routes.py` | Test API config |
| POST | `/api/admin/api-configs/reload-env` | `admin_routes.py` | Reload DB-backed API configs into runtime env without restart |
| POST | `/api/admin/api-configs/health/sweep` | `admin_routes.py` | Sweep provider runtime health and cache results |
| GET | `/api/admin/api-configs/{provider_id}/health` | `admin_routes.py` | Check one provider runtime health and cache result |
| GET | `/api/admin/api-configs/presets` | `admin_routes.py` | List presets (含 `飞升 (Seedance 2.0)` `渡劫 (Seedance 2.0 Fast)`，provider=`seedance`，env=`SEEDANCE_API_KEY`) |
| POST | `/api/admin/api-configs/import-presets` | `admin_routes.py` | Import presets; default copies current runtime env keys into DB configs |

### System Settings

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/admin/settings` | `admin_routes.py` | Get settings |
| PUT | `/api/admin/settings` | `admin_routes.py` | Update settings |

### Organization Management (2026-05-26 Slice 2)

详见 `docs/superpowers/specs/2026-05-26-organization-management-design.md`。所有端点都走 `Depends(require_admin)`。

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/admin/organizations` | `admin_routes.py` | 列组织（`?status=&keyword=&limit=&offset=`，带 owner_name + member_count）|
| POST | `/api/admin/organizations` | `admin_routes.py` | 创建组织（自动把 owner 加成员） |
| GET | `/api/admin/organizations/{org_id}` | `admin_routes.py` | 组织详情 + 成员列表 |
| PUT | `/api/admin/organizations/{org_id}` | `admin_routes.py` | 更新组织（name/description/status/color/owner_user_id） |
| DELETE | `/api/admin/organizations/{org_id}` | `admin_routes.py` | 删组织（先清 share→org，再删 organizations；CASCADE 清 members）|
| GET | `/api/admin/organizations/{org_id}/members` | `admin_routes.py` | 成员列表（含 username/email）|
| POST | `/api/admin/organizations/{org_id}/members` | `admin_routes.py` | 加成员（owner/admin/member） |
| DELETE | `/api/admin/organizations/{org_id}/members/{user_id}` | `admin_routes.py` | 删成员（owner 不允许）|
| PUT | `/api/admin/organizations/{org_id}/members/{user_id}/role` | `admin_routes.py` | 改成员 role |

### User Self-Service (2026-05-26)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/me/organizations` | `cluster_main.py` | 我加入的 active 组织（WorkspaceSwitcher 数据源） |
| POST | `/api/me/organizations/{org_id}/leave` | `cluster_main.py` | 主动退出组织（owner 不能退）|

### Resource Sharing (2026-05-26 Slice 4)

详见 `docs/superpowers/specs/2026-05-26-organization-management-design.md` §5.3。普通用户必须是资源 owner；admin 不受限。

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/shares?resource_type=&resource_id=` | `share_routes.py` | 资源的全部共享目标 |
| POST | `/api/shares` | `share_routes.py` | 创建共享（body: `{resource_type, resource_id, share_target_type, share_target_id}`）|
| DELETE | `/api/shares/{share_id}` | `share_routes.py` | 取消共享 |

### List-API 加 org_id 参数（向后兼容）

| Method | Path | 含 org_id 时的语义 |
|--------|------|-------------------|
| GET | `/api/projects?org_id=X` | 组织 workspace：owner / project_members / share→org / group∈org |
| GET | `/api/projects/list?org_id=X` | 同上（简化版返回）|
| GET | `/api/media-library/items?org_id=X` | 组织 workspace：own + media share→org + project share→org |
| GET | `/api/admin/project-groups?org_id=X` | 仅返回该组织名下的分组 |

不传 `org_id` = 完全旧行为（个人 workspace），所有老前端 0 改动可用。

### 创建对话框 visibility（2026-05-26 Slice 5）

`POST /api/projects` 和 `POST /api/media-library/upload` 加 `visibility` 字段（`'private' | 'org-default'`，默认 `private`）：

- `visibility='private'` ⇒ 旧行为
- `visibility='org-default'` ⇒ 必须同时附带 `org_id`（媒体上传是 FormData 字段，项目创建走前端拿到 `project_id` 后再调 `POST /api/shares`）后端会做组织成员校验，媒体上传成功后自动 `INSERT INTO resource_shares (media→org)`。`visibility` 列只参与 UI badge 渲染，真实可见性始终走 `resource_shares`。

### 素材库文件夹（2026-05-30）

可嵌套的项目级素材文件夹（人物 / 场景 / 道具 …）。Handler：`media_library_routes.py`。文件夹操作需项目成员权限（`member+`），列出需 `readonly+`。

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/media-library/folders?project_id=` | 列出项目下全部文件夹（扁平，前端建树） |
| POST | `/api/media-library/folders` | 新建（body: `{project_id, name, parent_folder_id?, folder_order?}`）|
| PATCH | `/api/media-library/folders/{folder_id}` | 重命名 / 移动（body: `{name?, parent_folder_id?, folder_order?}`，移动时服务端做防环校验）|
| DELETE | `/api/media-library/folders/{folder_id}` | 删除（子文件夹级联删，夹内素材 `folder_id` 置 NULL）|

素材接口新增 `folder_id` 透传：

- `GET /api/media-library/items?folder_id=` —— 按文件夹过滤；传 `folder_id=__unfiled__` 只看未归类素材。
- `POST /api/media-library/upload` —— FormData 新增 `folder_id` 字段，指定上传落入的文件夹（服务端校验文件夹存在且属于同一 `project_id`）。
- `PATCH /api/media-library/items/{id}` —— body 加 `folder_id`（拖拽归类 / 移动）；传 `''` 或 `null` 表示移出文件夹（回到未归类）。

### Admin 统计按组分列（2026-05-26 Slice 6）

`GET /api/admin/stats?group_by=user|org|none` —— 在原有聚合数字基础上额外返回 `breakdown` 数组：

| group_by | breakdown 字段 |
|----------|----------------|
| `none` / 不传 | `[]`，纯旧行为 |
| `user` | `{ user_id, username, projects, images, videos, audios }` |
| `org`  | `{ org_id, name, member_count, projects, images, videos, audios }` |

口径：基于 `users` LEFT JOIN `files`(按 file_type) + `projects`(user_id) 聚合；admin（非超管）调用会过滤掉 SUPER_ADMIN。

### ComfyUI Agents

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/admin/agents` | `admin_routes.py` | Create agent |
| GET | `/api/admin/agents` | `admin_routes.py` | List agents |
| GET | `/api/admin/agents/{agent_id}` | `admin_routes.py` | Get agent |
| PUT | `/api/admin/agents/{agent_id}/toggle` | `admin_routes.py` | Enable/disable agent |
| DELETE | `/api/admin/agents/{agent_id}` | `admin_routes.py` | Delete agent |

---

## 16. Cluster / Agent

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/cluster/stats` | `cluster_main.py` | Cluster statistics |
| GET | `/api/cluster/nodes` | `cluster_main.py` | List cluster nodes |
| POST | `/api/agent/register` | `agent_routes.py` | Worker agent register |
| POST | `/api/agent/heartbeat` | `agent_routes.py` | Worker heartbeat |
| GET | `/api/agent/poll` | `agent_routes.py` | Poll for tasks |
| POST | `/api/agent/complete` | `agent_routes.py` | Report task completion |
| GET | `/api/agent/debug-queue` | `agent_routes.py` | Debug queue state |
| GET | `/health` | `cluster_main.py` | Health check |

---

## 17. Debug

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/debug/auth-status` | `api_routes.py` | Auth debug info |
| GET | `/api/debug/file/{file_id}` | `api_routes.py` | File debug info |

---

## 18. SSE Event Format

`GET /api/tasks/stream` — Server-Sent Events for real-time task updates.

```json
{
  "type": "task_complete",
  "task_id": "uuid",
  "status": "completed",
  "task_type": "qwen",
  "display_name": "...",
  "project_id": "uuid",
  "source_page": "generation",
  "entity_type": "storyboard_item",
  "entity_id": "uuid",
  "file_role": "generated_image",
  "episode_id": "uuid"
}
```

---

## 19. Handler File Summary

| File | Lines | Scope |
|------|-------|-------|
| `cluster_main.py` | 2000 | Main app: auth, generation, tasks, cluster, workspace |
| `api_routes.py` | 2000 | CRUD: projects, episodes, storyboards, assets, audio, entity files |
| `admin_routes.py` | 798 | Admin: users, workflows, API configs, settings |
| `agent_routes.py` | 302 | ComfyUI agent: register, heartbeat, poll, complete |
