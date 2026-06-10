# Vertical Slices — MY2

每个 page → FE → BE → DB 的完整切片映射。**调试任何"保存失败 / 数据不显示 / 接口报错"问题时，先查这里**——找到对应 page，立刻知道要同时打开哪些 FE/BE/SQL 文件。

> **数据来源**：本文档由 `context/cross_refs.json` 派生（`scan_project.py` 自动生成）。
> 修改了页面/路由/表后，重跑 `scan_project.py` + `sync_check.py` 并更新本文。

---

## How to read

每个页面包含三栏：

- **Files** — FE 入口和关键组件
- **Backend routes** — FE → BE 的端点 + 真实处理函数 + 触达的表
- **Tables** — 该页面通过路由实际写/读的 SQL 表（per-handler 精准追溯）

> ⚠️ 共享文件 `apiService.ts` 被几乎所有 page 引用，导致"该 page 可能调用的全部
> API 列表"会膨胀。本文档只列每个 page **真正负责**的核心切片；如需全量列表查
> `context/cross_refs.json -> by_page`。

---

## ScriptPage — 剧本

**Path**: `/projects/:projectId/ep/:episodeId/workflow/script`

**Files**:
- `new_html/pages/ScriptPage.tsx` → 渲染 `WorkspaceApp.tsx`
- `new_html/WorkspaceApp.tsx` — 三栏剧本编辑器 + AI 续写

**Routes**:

| Method | Path | Handler | File | Tables |
|--------|------|---------|------|--------|
| GET    | `/api/episodes/{episode_id}/script`         | `get_script_legacy`           | api_routes.py | `episode_scripts` |
| PUT    | `/api/episodes/{episode_id}/script`         | `update_script_legacy`        | api_routes.py | `episode_scripts` |
| GET    | `/api/episodes/{episode_id}/scripts`        | `list_scripts`                | api_routes.py | `episode_scripts` |
| POST   | `/api/episodes/{episode_id}/scripts`        | `create_script`               | api_routes.py | `episode_scripts` |
| PUT    | `/api/episodes/{episode_id}/scripts/{id}`   | `update_script`               | api_routes.py | `episode_scripts` |
| DELETE | `/api/episodes/{episode_id}/scripts/{id}`   | `delete_script`               | api_routes.py | `episode_scripts` |
| POST   | `/api/episodes/{episode_id}/export-script`  | `export_script_to_storyboard` | api_routes.py | `episode_scripts`, `storyboard_items` |

**Tables**: `episode_scripts`, `storyboard_items`

---

## DesignPage — 设计 / 角色资产

**Path**: `/projects/:projectId/ep/:episodeId/workflow/design`

**Files**:
- `new_html/pages/DesignPage.tsx`

**Routes**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET    | `/api/projects/{project_id}/assets`        | `list_assets`              | `assets` |
| POST   | `/api/assets`                              | `create_asset`             | `assets` |
| PUT    | `/api/assets/{asset_id}`                   | `update_asset`             | `assets` |
| DELETE | `/api/assets/{asset_id}`                   | `delete_asset`             | `assets` |
| POST   | `/api/assets/{asset_id}/share`             | `share_asset`              | `assets` |
| POST   | `/api/episodes/{episode_id}/extract-to-assets` | `extract_to_assets`    | `assets`, `storyboard_items` |

**Tables**: `assets` (含 `reference_images` legacy + entity_files 同步)

---

## MaterialsPage / MaterialPage — 素材处理

**Files**:
- `new_html/pages/MaterialsPage.tsx`
- `new_html/components/MaterialPage.tsx`

**Routes**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| POST   | `/api/materials/process`               | `process_materials`     | `assets`, `files` |
| POST   | `/api/comfyui/upload`                  | `comfyui_upload`        | `files` |
| GET / POST / PUT / DELETE on `/api/entity-files/...`     | entity-files CRUD       | `files` |

**Tables**: `assets`, `files`

---

## AudioStagePage — 配音 ★ (用户最近调试集中)

**Path**: `/projects/:projectId/ep/:episodeId/workflow/audio`

**Files**:
- `new_html/pages/AudioStagePage.tsx` — 主页面
- `new_html/components/audio/VoiceSidebar.tsx` — 角色音色配置（系统预置 / 克隆 / 设计）
- `new_html/components/audio/DubbingPanel.tsx` — 逐句生成 + 试听
- `new_html/components/audio/MultiTrackTimeline.tsx` — 多轨时间线

**Routes**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET    | `/api/projects/{project_id}/character-voices` | `get_character_voices`   | `character_voices` |
| POST   | `/api/character-voices`                       | `create_character_voice` | `character_voices` |
| PUT    | `/api/character-voices/{voice_id}`            | `update_character_voice` | `character_voices` |
| DELETE | `/api/character-voices/{voice_id}`            | `delete_character_voice` | `character_voices` |
| GET    | `/api/episodes/{episode_id}/audio-tracks`     | `get_audio_tracks`       | `audio_tracks` |
| POST   | `/api/episodes/{episode_id}/audio-tracks`     | `create_audio_track`     | `audio_tracks` |
| DELETE | `/api/audio-tracks/{track_id}`                | `delete_audio_track`     | `audio_tracks` |
| POST   | `/api/audio/generate-speech`                  | `generate_speech`        | (file system + storage; provider in `audio_provider.py`) |
| POST   | `/api/minimax/tts`                            | minimax voice TTS         | (file system) |
| POST   | `/api/minimax/voice-clone`                    | voice clone               | (file system) |
| POST   | `/api/minimax/voice-design`                   | voice design              | (file system) |

**Tables**: `character_voices`, `audio_tracks`

**Schema gotchas** (see `docs/database.md`):
- `character_voices.project_id` 是 **VARCHAR(50)**（`proj_xxxx`），**不是** UUID。DAO 不要加 `::uuid` cast。
- `character_voices.voice_id` 是 UUID（DAO 用 `$N::uuid`）。
- `character_voices.asset_id` 是 VARCHAR(50)，可空，asset 删除时 SET NULL。

**Audio URL 规约**：MiniMax / Gemini 返回的 `audio_url` 必须是 `/storage/audio/...` 前缀（FastAPI mount 在 `cluster_main.py`）。**禁止** `/uploads/audio/...`。

**Common bugs** (faq.md anchors):
- "保存音色失败 invalid UUID 'proj_xxx'" — DAO 残留 `::uuid` cast
- "试听播放器空白 + 404 /uploads/audio" — provider 用了 `/uploads/` 而非 `/storage/`
- "speech-02-hd 不支持" — 默认 model 应是 `speech-2.8-hd`

---

## StoryboardGenPage / GenerationPage — 分镜生成

**Path**: `/projects/:projectId/ep/:episodeId/workflow/storyboard`

**Files**:
- `new_html/pages/StoryboardGenPage.tsx` → `new_html/components/GenerationPage.tsx`

**Routes**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET    | `/api/episodes/{episode_id}/storyboard-items`            | `get_storyboard_items`     | `storyboard_items` |
| POST   | `/api/episodes/{episode_id}/storyboard-items`            | `create_storyboard_item`   | `storyboard_items` |
| POST   | `/api/episodes/{episode_id}/storyboard-items/batch`      | `batch_create_storyboards` | `storyboard_items` |
| POST   | `/api/episodes/{episode_id}/storyboard-items/reorder`    | `reorder_storyboards`      | `storyboard_items` |
| PUT    | `/api/storyboard-items/{item_id}`                        | `update_storyboard_item`   | `storyboard_items` |
| DELETE | `/api/storyboard-items/{item_id}`                        | `delete_storyboard_item`   | `storyboard_items` |
| DELETE | `/api/episodes/{episode_id}/storyboard-items/all`        | `clear_storyboards`        | `storyboard_items` |
| GET    | `/api/tasks/active`                                      | `get_active_tasks`         | `tasks` |

**Tables**: `storyboard_items`, `tasks`

---

## VideoGenPage / VideoPage — 视频生成

**Files**:
- `new_html/pages/VideoGenPage.tsx`
- `new_html/components/VideoPage.tsx`
- `new_html/components/video/{CardDurationField,VideoCard,StoryboardSyncModal}.tsx`
- `new_html/utils/storyboardSync.ts`
- `new_html/components/{SeedanceMentionPromptEditor,SeedanceAssetPickerModal,SeedanceMultimodalPanel}.tsx`
- `new_html/hooks/{useReactiveDuration,useSeedanceCandidates}.ts`
- `new_html/utils/{durationMapping,seedanceMedia,seedanceCandidateBuilder}.ts`

**Routes**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET    | `/api/episodes/{episode_id}/storyboard-items`      | `get_storyboard_items`   | `storyboard_items` (read at import time) |
| POST   | `/api/storyboard/mix-audio`                        | `mix_storyboard_audio`   | `storyboard_items` (write `mixed_audio_url/_hash`) |
| GET    | `/api/episodes/{episode_id}/video-segments`        | `get_video_segments`     | `video_segments` |
| POST   | `/api/episodes/{episode_id}/video-segments`        | `create_video_segment`   | `video_segments` |
| PUT    | `/api/video-segments/{segment_id}`                 | `update_video_segment`   | `video_segments` |
| DELETE | `/api/video-segments/{segment_id}`                 | `delete_video_segment`   | `video_segments` |
| GET    | `/api/episodes/{episode_id}/timeline-tracks`       | `get_timeline_tracks`    | `timeline_tracks` |
| POST   | `/api/episodes/{episode_id}/timeline-tracks`       | `create_timeline_track`  | `timeline_tracks` |
| PUT    | `/api/timeline-tracks/{track_id}`                  | `update_timeline_track`  | `timeline_tracks` |
| POST   | `/api/projects/{project_id}/export-to-video`       | `export_to_video`        | `video_segments`, `audio_tracks`, `timeline_tracks` |
| GET/POST | `/api/system-configs/*`                          | system config DAO        | `system_configs` (R/W: `workspace_session_*` keys) |

**Tables**: `storyboard_items` (read 全部 + 写 `mixed_audio_url/_hash`), `video_segments`, `timeline_tracks`, `system_configs`

**Hooks 链 (per card)**:
- `useReactiveDuration(group, meta, currentDuration)` → 自动更新 group.duration（除非 `durationUserOverride=true`）
- `useSeedanceCandidates({ currentParams })` → 7 组候选（current_card / storyboard_data / assets / audio / video_segments / user_files / ark_asset_id），喂给 `SeedanceMentionPromptEditor` 与 `SeedanceAssetPickerModal`

**导入完成度（2026-05-17 重写）**：
- `handleImportAll` 不再过滤 `generated_image_url`，导入 ALL items（空分镜 → `isPlaceholder=true`，prompt='@' 触发首次聚焦自动开 popover）
- `storyboard_meta[itemId]` 持久化 `audioUrls / plannedDurationMs / audioDurationMs / mixedAudioUrl / mixedAudioHash / lastSyncedAt`
- 异步并发 mix-audio（≤3）；mix 完成 patch 进 `seedance_params.media_inputs` 作为 `reference_audio`
- 同步模态（`StoryboardSyncModal`）三模式：仅添加 / 覆盖未编辑（保留用户改动）/ 全量重置

### Seedance 2.0 (飞升 / 渡劫) 5 场景端到端 trace

每条 trace：FE `submitSeedanceTask` → `cluster_main.py /api/generate` → `worker._process_seedance_task` → `seedance_api.SeedanceClient` → ark API → poll → `download_video` → `_save_external_video` (`files` + `video_segments.video_url` + `thumbnail_url`)

| task_type | FE 触发 | media_inputs | worker 组装 contents | ark 行为 |
|-----------|---------|--------------|---------------------|----------|
| `seedance_t2v` | 仅 prompt | `[]` | `[{type:'text', text}]` | 文生视频 |
| `seedance_i2v` | 1 张图 + prompt | `[{kind:image, url}]` | `[{type:'text', text}, {type:'image_url', image_url:{url}}]` | 图生视频 |
| `seedance_morph` | 2 张图 (first+last) | `[{kind:image, url, role:first_frame}, {role:last_frame}]` | text + 2 image_url（带 role） | 首尾帧驱动 |
| `seedance_multi` | 0-9 image + 0-3 video + 0-3 audio（至少 1 图或 1 视频，仅音频会被拒） | 多种 kind 混合 | text + N image_url + M video_url + K audio_url | 多模态参考 |
| `seedance_draft` | UI **灰显禁用**（2.0 不支持） | — | — | **2.0 系列拒绝**，仅 1.5pro 走得通 |

**关键约束（FE + BE 双层校验）**：
- `fast` 子型号 + `1080p` → FE 自动降 720p（`submitSeedanceTask`），BE 二次保护（`_process_seedance_task`）
- 首尾帧 与 reference_image 互斥（`SeedanceMultimodalPanel.validation`）
- 数量上限（ark 硬限）：图 ≤ 9 / 视频 ≤ 3 / 音频 ≤ 3
- 不可单独输入音频：必须至少包含 1 张图或 1 段视频
- 真人脸来源限制（Seedance 2.0 系列）：不支持直接上传含真人人脸素材，需用本平台模型产物 / 预置虚拟人像 / 已授权真人素材
- contents 总大小 ≤ 64 MB（ark 硬限）

**entity-aware 落库**（修补 4 家旧 API 历史漏洞）：
- FE 提交时传 `entity_type=video_segment, entity_id=group.uuid, file_role=video`
- worker `_save_external_video` 调 `FileDAO.create_file(entity_type, entity_id, file_role)` + `_sync_legacy_on_file_create`
- 同一个调用栈也修复了 sora2 / veo / minimax / wan26 旧 API 的 `video_segments.video_url` 不自动写入问题

---

## CanvasPage — 无限画布

**Files**:
- `new_html/pages/CanvasPage.tsx`
- 早期 `deploy/new_html/components/InfiniteCanvasPage.tsx` 已于 2026-05-05 删除（独立精简版，未挂 route）。

**Routes**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET    | `/api/canvas/boards`                                    | `list_canvas_boards`         | `canvas_boards` |
| POST   | `/api/canvas/boards`                                    | `create_canvas_board`        | `canvas_boards` |
| GET    | `/api/canvas/boards/{board_id}`                         | `get_canvas_board`           | `canvas_boards`, `canvas_nodes`, `canvas_connections` |
| PUT    | `/api/canvas/boards/{board_id}`                         | `update_canvas_board`        | `canvas_boards` |
| DELETE | `/api/canvas/boards/{board_id}`                         | `delete_canvas_board`        | `canvas_boards` |
| POST   | `/api/canvas/nodes`                                     | `create_canvas_node`         | `canvas_nodes` |
| PUT    | `/api/canvas/nodes/{node_id}`                           | `update_canvas_node`         | `canvas_nodes` |
| DELETE | `/api/canvas/nodes/{node_id}`                           | `delete_canvas_node`         | `canvas_nodes` |
| POST   | `/api/canvas/connections`                               | `create_canvas_connection`   | `canvas_connections` |
| DELETE | `/api/canvas/connections/{connection_id}`               | `delete_canvas_connection`   | `canvas_connections` |

**Tables**: `canvas_boards`, `canvas_nodes`, `canvas_connections`

**Schema reminder**: `canvas_nodes.x` / `.y` 是 **FLOAT**，`viewport` 是 JSONB（在 `canvas_boards`）。

---

## EpisodeHubPage — 剧集列表

**Files**:
- `new_html/pages/EpisodeHubPage.tsx`

**Routes**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET    | `/api/projects/{project_id}/episodes`           | `list_episodes`        | `episodes` |
| POST   | `/api/projects/{project_id}/episodes`           | `create_episode`       | `episodes` |
| POST   | `/api/projects/{project_id}/episodes/reorder`   | `reorder_episodes`     | `episodes` |
| PUT    | `/api/episodes/{episode_id}`                    | `update_episode`       | `episodes` |
| DELETE | `/api/episodes/{episode_id}`                    | `delete_episode`       | `episodes` |

**Tables**: `episodes`

---

## PostProcessPage / EnhancePage — 后处理 / 增强

**Files**:
- `new_html/components/PostProcessPage.tsx`
- `new_html/pages/EnhancePage.tsx`

主要复用 `assets` / `files` 端点，无独有路由组。

**Tables**: `assets`, `files`

---

## MediaLibraryPage — 通用素材库（2026-05-26 Slice 1）

**Paths**:
- `/projects/:projectId/media-library`（项目级）
- `/projects/:projectId/ep/:episodeId/workflow/media-library`（workflow 顶栏复用）

**Files**:
- `new_html/pages/MediaLibraryPage.tsx`
- `new_html/services/mediaLibraryService.ts`
- `new_html/utils/voicePreviewCache.ts`（与音频条目缓存协作）

**Routes**:

| Method | Path | Handler | File | Tables |
|--------|------|---------|------|--------|
| GET    | `/api/media-library`                         | `list_media_items`             | media_library_routes.py | `media_library_items`, `media_library_usages` |
| POST   | `/api/media-library/upload`                  | `upload_media_item`            | media_library_routes.py | `media_library_items`, `files` |
| PATCH  | `/api/media-library/{id}`                    | `update_media_item`            | media_library_routes.py | `media_library_items` |
| DELETE | `/api/media-library/{id}`                    | `delete_media_item`            | media_library_routes.py | `media_library_items` |
| POST   | `/api/media-library/batch-download`          | `batch_download`               | media_library_routes.py | `media_library_items` |
| GET    | `/api/admin/media-library`                   | `admin_list_media`             | admin_routes.py         | `media_library_items` |
| DELETE | `/api/admin/media-library/{id}`              | `admin_soft_delete_media`      | admin_routes.py         | `media_library_items`, `admin_audit_logs` |
| GET    | `/api/media-library/folders`                 | `list_folders`                 | media_library_routes.py | `media_library_folders` |
| POST   | `/api/media-library/folders`                 | `create_folder`                | media_library_routes.py | `media_library_folders` |
| PATCH  | `/api/media-library/folders/{folder_id}`     | `update_folder`                | media_library_routes.py | `media_library_folders` |
| DELETE | `/api/media-library/folders/{folder_id}`     | `delete_folder`                | media_library_routes.py | `media_library_folders`, `media_library_items` |

**生成同步入口**（best-effort 自动入库）：

- `worker.py` — ComfyUI / DashScope / Seedance / Doubao 视频任务完成后
- `api_routes.py` — Gemini speech / sfx / music + MiniMax sync TTS + `/api/entity-files/upload`
- `audio_mix_service.py` — 混音输出落盘后

**Files（2026-05-30 文件夹）**: `new_html/utils/mediaFolderTree.ts`, `dao_media_library_folder.py`, `db_migration_media_library_folders.sql`

**Tables**: `media_library_items`, `media_library_usages`, `media_library_folders`, `files`

---

## VideoReversePage — 视频反推（2026-05-26 Slice 3）

**Paths**:
- `/projects/:projectId/video-reverse`
- `/projects/:projectId/ep/:episodeId/workflow/video-reverse`

**Files**:
- `new_html/pages/VideoReversePage.tsx`
- `new_html/services/videoReverseService.ts`
- `new_html/components/CreditEstimateModal.tsx`（与 Slice 2 共用）

**Routes**:

| Method | Path | Handler | File | Tables |
|--------|------|---------|------|--------|
| POST   | `/api/video-reverse/estimate`                | `estimate_cost`                | video_reverse_routes.py | `credit_rules` |
| POST   | `/api/video-reverse`                         | `create_task`                  | video_reverse_routes.py | `video_reverse_tasks`, `credit_freezes` |
| GET    | `/api/video-reverse`                         | `list_tasks`                   | video_reverse_routes.py | `video_reverse_tasks` |
| GET    | `/api/video-reverse/{task_id}`               | `get_task`                     | video_reverse_routes.py | `video_reverse_tasks`, `video_reverse_segments` |
| POST   | `/api/video-reverse/{task_id}/cancel`        | `cancel_task`                  | video_reverse_routes.py | `video_reverse_tasks`, `credit_freezes` |
| POST   | `/api/video-reverse/{task_id}/retry`         | `retry_task`                   | video_reverse_routes.py | `video_reverse_tasks` |

**状态机**：`pending → splitting → extracting_frames → analyzing → building_prompts → completed`，失败/取消进入 `failed`/`cancelled`。

**Tables**: `video_reverse_tasks`, `video_reverse_segments`, `credit_accounts`, `credit_freezes`, `credit_transactions`

---

## CreditsPage — 用户积分账户（2026-05-26 Slice 2）

**Path**: `/credits`（全站独立）

**Files**:
- `new_html/pages/CreditsPage.tsx`
- `new_html/services/creditService.ts`
- `new_html/components/CreditEstimateModal.tsx`（被各生成页调用）

**Routes**:

| Method | Path | Handler | File | Tables |
|--------|------|---------|------|--------|
| GET    | `/api/credits/account`                       | `get_my_account`               | credit_routes.py | `credit_accounts`, `credit_freezes` |
| GET    | `/api/credits/transactions`                  | `list_my_transactions`         | credit_routes.py | `credit_transactions` |
| GET    | `/api/credits/rules`                         | `list_rules`                   | credit_routes.py | `credit_rules` |
| POST   | `/api/credits/estimate`                      | `estimate`                     | credit_routes.py | `credit_rules` |

**Tables**: `credit_accounts`, `credit_freezes`, `credit_transactions`, `credit_rules`

---

## Admin Shell — 独立管理后台（2026-05-26 重组）

**架构概念**：管理后台从主站抽离成独立 Shell，与主站会话隔离、视觉隔离、入口隔离。

**Paths**:

| Path | Layout | 用途 |
|------|--------|------|
| `/admin/login` | 独立（无 Shell） | 后台账号密码登录页（凭据写 `sessionStorage.admin_session_token`） |
| `/admin` (index) | `AdminLayout` (Outlet) | `AdminHubPage` — KPI 条 + 三入口 tile |
| `/admin/settings` | `AdminLayout` (Outlet) | `AdminSettingsPage` — 系统设置入口列表 |
| `/admin/operations` | 独立全屏（AdminOperationsRoute 包装） | 渲染 `AdminPage` 完整 5 tab + 浮层"返回 Hub" |
| `/admin-legacy/` | (cluster_main 静态 mount) | **旧版** cluster_main 仪表盘 / 集群管理 / 工作流 / API 密钥 |

**后端路由契约（cluster_main.py，2026-05-26 修订）**：

| 路径 | 处理 | 说明 |
|------|------|------|
| `app.mount("/admin-legacy", StaticFiles, html=True)` | 静态 mount | 旧版控制台搬到 legacy 前缀，避免劫持 `/admin/*` |
| `@app.get("/admin")` / `@app.get("/admin/")` | `_serve_spa()` | React Hub |
| `@app.get("/admin/login")` / `/admin/operations` / `/admin/settings` | `_serve_spa()` | React 子路由 |
| `@app.get("/admin/login/{path:path}")` 等 | `_serve_spa()` | 刷新子路径仍命中 SPA |

> **历史教训**（详见 `faq.md` 2026-05-26 "/admin/login 404"）：早期 `app.mount("/admin", StaticFiles)` 把 `/admin/*` 整个前缀劫持给旧版静态控制台，导致 React 路由 `/admin/login` 永远 404；`/admin/index.html` 又能直接打开旧版绕过登录。**任何 SPA + StaticFiles 共用前缀的设计都是反模式 — mount 与 SPA fallback 必须用不重叠的前缀**。

**入口策略（2026-05-26 修订）**：

- `WorkflowLayout` 顶栏**不再**含"管理"按钮 —— 流程化页面与后台彻底分离
- 管理员通过书签 / 直接 URL 进入 `/admin/login`
- 主站任意页面均不向普通用户暴露后台入口

**Files**:

| File | 职责 |
|------|------|
| `new_html/admin/adminAuth.ts` | sessionStorage 凭据存取（独立 key）+ 路径感知 token 选择器 `pickTokenForCurrentRoute` |
| `new_html/admin/AdminLayout.tsx` | Shell：左 sidebar（emerald accent）+ topbar（时钟 / 状态灯）+ Outlet |
| `new_html/admin/AdminLoginPage.tsx` | 独立登录页（暗黑工业风，背景径向辉光 + 网格 + JetBrains Mono UI）— **登录 URL：`POST /api/login`**（2026-05-26 修正：旧实现写成 `/api/auth/login` 是 404，详见 faq.md "第 4 层"） |
| `new_html/admin/AdminHubPage.tsx` | 总览 Hub（KPI 卡 + 生成管理 / 系统设置 / 集群仪表盘三入口 tile） |
| `new_html/admin/AdminSettingsPage.tsx` | 系统设置入口列表（READY / PLANNED 双状态） |
| `new_html/components/AdminPage.tsx` | 旧版"5 tab"主页（在 `/admin/operations` 全屏渲染） |
| `new_html/components/AdminFeatureTabs.tsx` | AdminPage 第 5 个 Tab（账号 / 分组 / 积分 / 素材 / 审计） |

**Token 隔离契约（2026-05-26 二次回归修订）**：

- 主站登录：`localStorage.auth_token`（持久 / 跨标签）
- 后台登录：`sessionStorage.admin_session_token`（仅当前标签页）
- `apiService.getAuthToken()` 检测 `location.pathname.startsWith('/admin')` 时：
  - sessionStorage 有 token → 返回它
  - sessionStorage **无** token → **返回 null**（严格模式，**不 fallthrough** localStorage）
  - 旧实现 fallthrough 主站 token 会导致用主站普通用户 token 打 admin API → 401 → 拦截器死循环（详见 faq.md "/admin/login 反被弹到 /projects"）
- `apiService.handleResponse` 401 处理路径感知：
  - `/admin/*` → 清 sessionStorage admin session → `window.location.href = '/admin/login'`
  - 其他 → 清 localStorage 主站 token → `window.location.href = '/login'`
  - login 页本身上 401 不再跳转（防死循环）
- `TaskProvider.useEffect` mount 时 path guard：`/admin/*` 路径下直接 return，不触发主站 `getNotifications` / `getUnreadCount` / `globalTaskManager.start`
- `AdminFeatureTabs.getHeaders()` 同样规则
- AdminPage 终端调用 line 273 同样规则
- 后端 `require_admin` 不区分 token 来源 — 真正的闸门由后端 role 校验完成

**视觉 DNA**（参考 cluster_main 舰桥控制台）：

- 主背景 `bg-zinc-950`，卡片 `bg-zinc-900`，边框 `border-zinc-800`
- 状态色：`emerald-400/500`（健康）/ `amber-400`（待处理）/ `rose-400`（异常）/ `cyan-400`（信息）
- 字体：中文 PingFang/Source Han；ID / 时间戳 / 状态 tag 用 `'JetBrains Mono'`
- 不使用主站的 `indigo`，确保视觉上"换了一个 app"

**Routes — 原 admin 套件**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET    | `/api/admin/users`                          | `admin_list_users`        | `users` |
| POST   | `/api/admin/users/create`                   | `admin_create_user`       | `users`, `admin_audit_logs` |
| PUT    | `/api/admin/users/{user_id}/permissions`    | `admin_update_perms`      | `users`, `admin_audit_logs` |
| PUT    | `/api/admin/users/{user_id}/disable`        | `admin_disable_user`      | `users`, `admin_audit_logs` |
| PUT    | `/api/admin/users/{user_id}/enable`         | `admin_enable_user`       | `users`, `admin_audit_logs` |
| PUT    | `/api/admin/users/{user_id}/reset-password` | `admin_reset_password`    | `users`, `admin_audit_logs` |
| DELETE | `/api/admin/users/{user_id}`                | `admin_delete_user`       | `users`, `admin_audit_logs` |
| GET    | `/api/admin/stats`                          | `admin_stats`             | (聚合) |
| GET    | `/api/admin/logs`                           | `admin_logs`              | `activity_logs` |

**Routes — Slice 4 / 5 新增（每个端点都挂 `Depends(require_admin)`）**:

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| GET / POST / PUT / DELETE | `/api/admin/project-groups[/{id}[/move]]`    | `admin_*_group`           | `project_groups`, `projects`, `admin_audit_logs` |
| 注：`POST /api/admin/project-groups` 2026-05-26 修正：先 `UserDAO.get_user_by_id` 校验 FK，再 try/except `ForeignKey` 抛 400 友好错误（详见 faq.md） | | | |
| GET / POST / PUT / DELETE | `/api/admin/credit-rules[/{key}]`            | `admin_*_credit_rule`     | `credit_rules`, `admin_audit_logs` |
| GET                       | `/api/admin/credit-accounts`                 | `admin_list_credit_accounts` | `credit_accounts` |
| GET                       | `/api/admin/credit-transactions`             | `admin_list_credit_tx`    | `credit_transactions` |
| POST                      | `/api/admin/credit-adjust`                   | `admin_credit_adjust`     | `credit_accounts`, `credit_transactions`, `admin_audit_logs` |
| GET / DELETE              | `/api/admin/media-library[/{id}]`            | `admin_*_media`           | `media_library_items`, `admin_audit_logs` |
| GET                       | `/api/admin/audit-logs`                      | `admin_list_audit`        | `admin_audit_logs` |

**鉴权策略（2026-05-26 修订）**：

- `admin_router` **不再**全局挂 `Depends(require_admin)`（曾导致老版静态 admin 控制台 `/admin/app.js` 401）
- 每个新端点单独 `dependencies=[Depends(require_admin)]`
- `require_admin` 用 `jwt_auth.verify_token` → `UserDAO.get_user_by_username` 校验 role；
  bootstrap 兜底读 `MY2_ADMIN_USERNAMES` 环境变量（逗号分隔）

**Normalize 契约（2026-05-26 修订）**：

| Endpoint | Backend normalize fn | Frontend normalize fn |
|----------|----------------------|------------------------|
| `GET /api/admin/users` | `admin_routes._normalize_admin_user` | `AdminPage.normalizeUserRow` |
| `GET /api/admin/users/{id}` | `admin_routes._normalize_admin_user` | `AdminPage.normalizeUserRow` |

返回形状（双方都保证字段一定存在）：

```ts
{
  id: string;
  username: string; email: string;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean; isOnline: boolean;
  lastLogin: number;  // ms epoch, 0 = never
  permissions: { allowedModels: string[]; priority: 'low'|'normal'|'high'; canExport: boolean };
  stats: { todayCount: number; totalCount: number; byModel: Record<string, number> };
}
```

> **历史教训**（详见 `faq.md` 2026-05-26 条）：原 `admin_list_users` 直接 `_row_to_jsonable(row)` 出，导致 snake_case + 缺 `permissions` 列。AdminPage 从 view 模式抽出独立路由后立即触发 `Cannot read properties of undefined (reading 'allowedModels')`。任何新增的 admin API 都必须按本节模式提供 backend + frontend 双 normalize。

**Tables**: `users`, `activity_logs`, `admin_audit_logs`, `project_groups`, `projects`, `credit_accounts`, `credit_freezes`, `credit_transactions`, `credit_rules`, `media_library_items`

---

## WorkspaceApp / App — Shell

**Files**:
- `new_html/App.tsx` — Router + Provider 装配
- `new_html/WorkspaceApp.tsx` — 工作台主壳，被 ScriptPage 复用

**Routes** (基础设施类，所有页面共享):

| Method | Path | Handler | Tables |
|--------|------|---------|--------|
| POST   | `/api/auth/login`                          | login                | `users` |
| POST   | `/api/auth/register`                       | register             | `users` |
| GET    | `/api/notifications`                       | list_notifications   | `notifications` |
| GET    | `/api/notifications/unread-count`          | unread_count         | `notifications` |
| POST   | `/api/notifications/{id}/read`             | mark_read            | `notifications` |
| GET    | `/api/projects` / `/api/projects/list`     | list_projects        | `projects`, `project_members` |
| POST   | `/api/projects`                            | create_project       | `projects`, `project_members` |
| GET / POST on `/api/projects/{id}/members`         | members CRUD         | `project_members`, `users` |

**Tables**: `users`, `projects`, `project_members`, `notifications`

---

## Cross-page data flow

完整的页面间数据传递（参考 `docs/flow.md`）:

```
Script  ─┐
         ├→ Storyboard ─┐
Design ──┤               ├→ Video ─→ Enhance
         │               │
Material ┤               │
         │               │
Audio ───┴───────────────┘
```

详细字段映射见 `docs/database.md` § 9 跨页面数据传输链路。

---

## 调试如何使用本文档

1. 用户报告 bug 涉及某个页面 → 找到本文该 page 的 section
2. 列出 Files + Routes + Tables → 这就是要读的文件清单
3. 按 `references/debug-vertical.md` 的 5 步法做边界诊断
4. 修复后：scan + sync_check + 更新本表 + 加 faq 条目
