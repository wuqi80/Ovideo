# MY2 Backend Architecture

## 1. Stack

| Component | Technology |
|-----------|-----------|
| Framework | FastAPI (Python 3.9+) |
| Database | PostgreSQL via asyncpg pool |
| Cache/Queue | Redis (task queue + SSE pub/sub) |
| Auth | JWT (api_routes) + session cookie (cluster_main) |
| File Storage | Local disk `persistent_storage/` |
| Worker | Subprocess + WebSocket to ComfyUI |
| Image APIs | Gemini, Doubao (Volcengine), ComfyUI |
| Audio APIs | MiniMax, Gemini |
| Video APIs | Sora2, Veo, WAN2.6 (DashScope) |
| Text APIs | DeepSeek, Gemini |

---

## 2. Core Files

### Application Layer

| File | Lines | Description |
|------|-------|-------------|
| `cluster_main.py` | 2000 | FastAPI main app — auth, image/text/video generation, task management, SSE, cluster, workspace, static serving |
| `api_routes.py` | 2000 | RESTful CRUD — projects, episodes, storyboards, assets, audio gen, entity files, minimax, canvas, notifications, members |
| `admin_routes.py` | 798 | Admin panel — user CRUD, workflow templates, API config management, system settings, dashboard |
| `agent_routes.py` | 302 | ComfyUI agent protocol — register, heartbeat, poll tasks, report completion |
| `routers/` | — | MVC route modules owned by domain |
| `comfyui_main.py` | 1198 | Standalone ComfyUI server (single-node mode) — auth, generate, task polling, workflow CRUD |

### Worker System

| File | Lines | Description |
|------|-------|-------------|
| `worker.py` | 1784 | Worker class — picks tasks from Redis queue, dispatches to ComfyUI via WebSocket, handles result files, reports completion |
| `task_queue.py` | 674 | TaskQueue + Task — Redis-backed queue with status tracking, SSE pub/sub, file result management |
| `task_service.py` | 134 | TaskService singleton — init/get helpers for TaskQueue |

### External API Clients

| File | Lines | Description |
|------|-------|-------------|
| `minimax_api.py` | 192 | MinimaxClient — voice clone, voice design, TTS |
| `minimax_audio.py` | 384 | MinimaxAudioClient — music, lyrics, file upload/download |
| `sora2_api.py` | 246 | Sora2Client — video generation via Sora 2 |
| `veo_api.py` | 201 | VeoClient — Google Veo video generation |
| `wan2_dashscope_api.py` | 212 | Wan26Client — WAN2.6 i2v via DashScope |
| `seedance_api.py` | ~210 | SeedanceClient — Volcengine Ark Doubao Seedance 2.0 (飞升/渡劫) — `create_video_task` / `query_task` / `download_video`，API key fallback `SEEDANCE_API_KEY` → `ARK_API_KEY` |
| `audio_provider.py` | 158 | AudioProvider abstraction — GeminiAudioProvider, MinimaxAudioProvider |

### Workflow Engine

| File | Lines | Description |
|------|-------|-------------|
| `workflow_config.py` | 1211 | WorkflowConfig — all ComfyUI workflow type definitions, param mapping, validation |
| `workflow_handler.py` | 308 | WorkflowHandler — build ComfyUI prompt from template + params |
| `workflow_manager.py` | 530 | WorkflowManager — load/save workflow JSON files, template CRUD |

### Data Access (DAO)

| File | Lines | Entity |
|------|-------|--------|
| `dao_content.py` | 714 | ProjectDAO, VersionDAO, FileDAO, WorkspaceSessionDAO, PromptTemplateDAO, ProjectMemberDAO, TextContentDAO |
| `dao_task.py` | 345 | TaskDAO, ActivityLogDAO |
| `dao_storyboard.py` | 180 | StoryboardDAO |
| `dao_workflow_template.py` | 199 | WorkflowTemplateDAO |
| `dao_user.py` | 184 | UserDAO |
| `dao_api_config.py` | 182 | ApiConfigDAO |
| `dao_canvas.py` | 177 | CanvasBoardDAO, CanvasNodeDAO, CanvasConnectionDAO |
| `dao_agent.py` | 170 | AgentDAO |
| `dao_entity_file.py` | 154 | EntityFileDAO |
| `dao_episode.py` | 137 | EpisodeDAO |
| `dao_task_history.py` | 138 | TaskHistoryDAO |
| `dao_notification.py` | 118 | NotificationDAO |
| `dao_asset.py` | 114 | AssetDAO |
| `dao_character_voice.py` | 98 | CharacterVoiceDAO |
| `dao_audio_track.py` | 92 | AudioTrackDAO |
| `dao_video_segment.py` | 91 | VideoSegmentDAO |
| `dao_timeline.py` | 87 | TimelineDAO |
| `dao_episode_script.py` | 85 | EpisodeScriptDAO |
| `dao_file.py` | 81 | FileDAO (legacy, prefer `dao_content.py FileDAO`) |
| `dao_system_settings.py` | 63 | SystemSettingsDAO |

### File & Storage

| File | Lines | Description |
|------|-------|-------------|
| `file_service.py` | 227 | FileService — `save_generated_file_to_db()` helper, auto WebP conversion |
| `storage_manager.py` | 306 | StorageManager — file path resolution, persistent storage CRUD |
| `image_processor.py` | 324 | ImageProcessor — resize, crop, thumbnail, format conversion |
| `image_webp_service.py` | 306 | WebPImageService — lossless WebP conversion for storage optimization |
| `file_optimization.py` | 290 | FileOptimizationService, FileDeduplicationService |

### Configuration

| File | Lines | Description |
|------|-------|-------------|
| `config.py` | 238 | ComfyUIConfig, SystemConfig, WorkflowConfig, StorageConfig, ModelConfig |
| `database_config.py` | 55 | DatabaseConfig, JWTConfig, StorageConfig |
| `db_manager.py` | 112 | DatabaseManager — asyncpg connection pool lifecycle |
| `jwt_auth.py` | 64 | JWT init, create_token, verify_token |
| `cluster_config.py` | 200 | Cluster deployment config — nodes, Redis, queue, worker settings |
| `cluster_manager.py` | 260 | ClusterManager — node status tracking, health monitoring |
| `comfyui_agent.py` | 382 | ComfyUIAgent — worker process that connects to cluster |

### Migration & Utility Scripts

| File | Lines | Description |
|------|-------|-------------|
| `auto_deploy_cluster.py` | 706 | Cluster auto-deployment script |
| `db_tool.py` | 326 | CLI database admin tool |
| `migrate_existing_files.py` | 182 | Migrate files to entity_file schema |
| `migrate_temp_to_persistent.py` | 164 | Move temp files to persistent storage |
| `migrate_to_project_hub.py` | 83 | Migrate to project hub structure |
| `sync_users_to_db.py` | 139 | Sync config users to database |
| `fix_user_ids.py` | 152 | Fix user ID inconsistencies |
| `init_user_permissions.py` | 100 | Initialize user permission records |

### SQL Schemas

| File | Lines | Description |
|------|-------|-------------|
| `database_schema.sql` | 286 | Core schema — users, projects, versions, files, tasks |
| `db_migration_project_hub.sql` | 109 | Project hub tables |
| `db_migration_admin.sql` | 152 | Admin tables — users, logs, settings |
| `db_migration_storyboard_items.sql` | 45 | Storyboard items table |
| `db_migration_audio_tracks.sql` | 42 | Audio tracks table |
| `db_migration_episodes.sql` | 37 | Episodes table |
| `db_migration_assets.sql` | 39 | Assets table |
| `db_migration_video_segments.sql` | 39 | Video segments table |
| `db_migration_timeline_tracks.sql` | 32 | Timeline tracks table |
| `db_migration_episode_scripts.sql` | 31 | Episode scripts table |
| `db_migration_notifications.sql` | 31 | Notifications table |
| `db_migration_character_voices.sql` | 24 | Character voices table |
| `db_migration_unified_files.sql` | 12 | Entity file columns (entity_type, entity_id, file_role, is_selected) |

---

## 3. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)  new_html/                         │
│  Services: apiService, geminiService, entityFileService     │
│  Hooks: useEntityFilesQuery, useEpisodeData, useSSEInval.   │
└─────────┬──────────────────────────────────────┬────────────┘
          │ REST API                             │ SSE
          ▼                                      ▼
┌─────────────────────────────────────────────────────────────┐
│  FastAPI App (cluster_main.py)                              │
│  ├── api_routes.py (CRUD)                                   │
│  ├── admin_routes.py (admin panel)                          │
│  ├── agent_routes.py (worker protocol)                      │
│  └── routers/ (domain route modules)                        │
└─────┬────────────────────┬──────────────────────┬───────────┘
      │                    │                      │
      ▼                    ▼                      ▼
┌───────────┐   ┌──────────────────┐   ┌──────────────────┐
│ PostgreSQL │   │ Redis            │   │ persistent_storage│
│ (asyncpg)  │   │ ├── task queue   │   │ ├── images/       │
│ ├── files  │   │ ├── task status  │   │ ├── audio/        │
│ ├── tasks  │   │ └── SSE pub/sub  │   │ └── video/        │
│ └── ...    │   └───────┬──────────┘   └──────────────────┘
└───────────┘            │
                         ▼
              ┌──────────────────────┐
              │  Worker (worker.py)   │
              │  ├── poll Redis queue │
              │  ├── dispatch to      │
              │  │   ComfyUI (WS)     │
              │  ├── save results     │
              │  └── publish SSE      │
              └──────────┬───────────┘
                         │ WebSocket
                         ▼
              ┌──────────────────────┐
              │  ComfyUI Server(s)   │
              │  (image/video gen)   │
              └──────────────────────┘
```

---

## 4. Request Lifecycle

### Synchronous Generation (Gemini/Doubao)

```
POST /api/gemini/image
  → cluster_main.gemini_image_generate()
  → call Gemini API directly
  → file_service.save_generated_file_to_db()
    → WebP conversion → disk write → FileDAO.create_file()
  → return {images: [dataURL], files: [{file_id, file_url}]}
```

### Async Generation (ComfyUI Worker)

```
POST /api/generate/comfyui-workflow
  → cluster_main.create_generate_task()
  → TaskQueue.submit(task_type, params, entity_fields)
  → Redis LPUSH task → return {taskId}

Worker loop:
  → Redis BRPOP → Worker.process_task()
  → build ComfyUI prompt (workflow_handler.py)
  → WebSocket → ComfyUI → wait for completion
  → download outputs → WebP → save to disk
  → FileDAO.create_file(entity_type, entity_id, file_role)
  → TaskQueue.complete_task() → Redis PUBLISH "task_complete:{user}"

Frontend:
  → SSE listener receives event
  → useSSEInvalidation → queryClient.invalidateQueries()
  → React Query refetch → UI updates
```

---

## 5. Key Patterns

### Save Helper

All generated files route through `file_service.save_generated_file_to_db()`:

```python
async def save_generated_file_to_db(
    content, file_type, user_id, source,
    entity_type=None, entity_id=None, file_role=None,
    original_ext='.png', is_selected=False, episode_id=None
) -> dict  # {file_id, file_url, file_path}
```

### Entity File System

Files are linked to entities via columns on the `files` table:

| Field | Values |
|-------|--------|
| `entity_type` | `storyboard_item`, `asset`, `video_segment` |
| `file_role` | `generated_image`, `reference_image`, `dialogue_audio`, `narration_audio`, `sfx_audio` |
| `is_selected` | Single active file per entity+role |

### SSE Pub/Sub

```
Redis channel: "task_complete:{username}"
Payload: {type, task_id, status, task_type, entity_type, entity_id, file_role, episode_id}
```

### Dual Auth

| System | Mechanism | Used By |
|--------|-----------|---------|
| Session cookie | `verify_session()` in cluster_main.py | Legacy pages, generation endpoints |
| JWT Bearer | `get_current_user()` in api_routes.py | CRUD endpoints, admin routes |

---

## 6. Database Connection

```python
# db_manager.py
pool = asyncpg.create_pool(
    host, port, database, user, password,
    min_size=2, max_size=10
)
```

All DAOs use `pool.acquire()` for connections, returning `asyncpg.Record` objects.

---

## 7. File Storage Layout

```
persistent_storage/
├── images/
│   ├── {uuid}.webp          # Generated images (auto-converted)
│   └── {uuid}.png           # Uploaded images
├── audio/
│   ├── {uuid}.mp3           # TTS / speech / music
│   └── {uuid}.wav           # Raw audio
├── video/
│   └── {uuid}.mp4           # Generated / uploaded videos
└── uploads/
    └── {original_name}      # Raw uploads
```

URL pattern: `/storage/{subdir}/{filename}` → served via static mount.

---

## 8. External API Config

API keys stored in `api_configs` table, loaded to env at startup via `load_api_configs_to_env()`.

| Provider | Env Variable | Used By |
|----------|-------------|---------|
| Gemini (text) | `GEMINI_TEXT_API_KEY` | 剧本生成、AI 润色 |
| Gemini (image) | `GEMINI_IMAGE_API_KEY` | 设计页"化神进阶"AI 生图 |
| MiniMax TTS | `MINIMAX_API_KEY` | `/api/audio/generate-speech`、配音页和自由创作语音 |
| DeepSeek | `DEEPSEEK_API_KEY` | 文本聊天 / 剧本生成 |
| Doubao Seedream | `ARK_API_KEY` | 设计页"筑基境界"AI 生图（Volcengine Ark） |
| MiniMax 海螺 | `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID` | **同时驱动**：Hailuo 视频 + 配音页全部三种模式 (TTS / voice_design / voice_clone) |
| ComfyUI | cluster_config nodes | Image/video gen via workflows |
| Sora2 | `SORA2_API_KEY` | Video gen |
| Veo | `VEO_API_KEY` | Video gen |
| WAN2.6 | `DASHSCOPE_API_KEY` | Video gen (i2v) |
| Seedance 2.0 (飞升/渡劫) | `SEEDANCE_API_KEY` (fallback `ARK_API_KEY`) | Video gen (5 场景: t2v/i2v/morph/multi/draft) via Volcengine Ark `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`，model `doubao-seedance-2-0-260128` / `doubao-seedance-2-0-fast-260128` |

**MiniMax TTS 默认模型**: `speech-2.8-hd`（在 `minimax_audio.py:tts_async/voice_design/voice_clone` + `api_routes.MinimaxTTSRequest/MinimaxVoiceDesignRequest` 各自的默认参数中）。如果 token plan 不支持可改为 `speech-01-hd / speech-02-turbo` 等档位。

**音频文件 URL 规则**: 所有 audio provider 写盘到 `persistent_storage/audio/{filename}`，返回的 URL **必须**是 `/storage/audio/{filename}`（对齐 `app.mount("/storage", ...)`）；写错成 `/uploads/audio/...` 会 404 但 `<audio>` 元素静默不报错（曾踩坑，见 faq 2026-05-04）。

---

## 9. Startup Sequence

```python
# cluster_main.py lifespan()
1. init_db_manager()         # asyncpg pool
2. load_api_configs_to_env() # DB → env vars
3. jwt_auth.init()           # JWT secret
4. init_storage_manager()    # persistent_storage dirs
5. TaskService.init()        # Redis task queue
6. mount static files        # /storage/, /new_html/dist/
7. include routers           # api_routes, admin_routes, agent_routes
```
