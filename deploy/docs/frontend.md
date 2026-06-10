# Frontend Architecture — MY2 Storyboard Copilot

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Data | TanStack React Query v5 |
| Routing | React Router v6 (nested) |
| Styling | Tailwind CSS + custom classes |
| Icons | Lucide React |

Source root: `new_html/`

---

## Route Tree

```
/projects                                                → ProjectHub
/projects/:projectId                                     → ProjectWorkspace (Outlet)
  /episodes                                              → EpisodeHubPage
  /media-library                                         → MediaLibraryPage   (项目级，2026-05-26 Slice 1)
  /video-reverse                                         → VideoReversePage   (项目级，2026-05-26 Slice 3)
  /ep/:episodeId
    /workflow                                             → WorkflowLayout (顶部导航 + EpisodeProvider)
      /script                                            → ScriptPage → WorkspaceApp
      /video-reverse                                     → VideoReversePage   (复用顶栏，2026-05-26)
      /design                                            → DesignPage (asset CRUD + AI image gen)
      /materials                                         → MaterialsPage → MaterialPage
      /audio                                             → AudioStagePage (TTS + dubbing)
      /storyboard                                        → StoryboardGenPage → GenerationPage
      /video                                             → VideoGenPage → VideoPage
      /enhance                                           → EnhancePage
      /media-library                                     → MediaLibraryPage   (复用顶栏，2026-05-26)
      /history                                           → HistoryPage
    /canvas                                              → CanvasPage (infinite canvas)
  /postprocess                                           → PostProcessPage
/credits                                                 → CreditsPage        (用户积分账户，2026-05-26 Slice 2)

# 2026-05-26：独立 Admin Shell（token 与主站隔离，sessionStorage.admin_session_token）
/admin/login                                             → AdminLoginPage    (独立账号密码登录，cluster_main 风格)
/admin                                                   → AdminLayout (Outlet) → AdminHubPage  (总览 + 导航 Hub)
/admin/settings                                          → AdminLayout (Outlet) → AdminSettingsPage (系统设置)
/admin/operations                                        → AdminOperationsRoute → AdminPage 全屏 (5 tab：用户/统计/审计/集群/新功能)
/admin-legacy/                                           → cluster_main 旧版静态控制台（仪表盘/集群/工作流/API 密钥）
```

> **后端契约**：`cluster_main.py` 必须为 `/admin/*` 每个 React 子路由都注册显式 `_serve_spa()` handler，否则刷新会 404。旧版静态后台 mount path 强制为 `/admin-legacy`，**禁止**与 SPA 共用 `/admin/` 前缀。详见 `vertical-slices.md` "Admin Shell（2026-05-26）" 与 `faq.md` 2026-05-26 "/admin/login 404"。

Defined in `new_html/App.tsx`. Legacy redirects: `/` → `/projects`, `/canvas` → `/projects`.

> **2026-05-26 顶栏导航统一**：`WorkflowLayout` 的顶部导航顺序固化为
> `剧本 → 视频反推 → 设计 → 素材 → 配音 → 分镜 → 视频 → 美化 → 素材库 → 历史`，
> 右侧依次为 `自由创作`、`管理`（admin only）、通知铃铛、退出。
> `素材库 / 视频反推` 本身是项目级页面，但同时挂在 `workflow/` 子路由下以复用顶栏。

---

## App Shell

```
QueryClientProvider          (new_html/App.tsx:29-39)
  SSEInvalidationProvider    (new_html/App.tsx:41-44)
    BrowserRouter
      TaskProvider           (new_html/contexts/TaskContext.tsx)
        GlobalToast
        Routes
```

---

## React Query Config

File: `new_html/App.tsx:29-39`

| Setting | Value |
|---------|-------|
| staleTime | 30 000 ms |
| gcTime | 300 000 ms (5 min) |
| refetchOnWindowFocus | true |
| refetchOnReconnect | true |
| retry | 2 |

---

## Context Providers

### EpisodeContext (`new_html/contexts/EpisodeContext.tsx`)

Injected by `WorkflowLayout`. Provides episode-scoped data with lazy-loading slices.

| Field | Type | Loaded By |
|-------|------|-----------|
| script | EpisodeScript \| null | `loadSlices('script')` |
| storyboardItems | StoryboardItemDB[] | `loadSlices('storyboardItems')` |
| assets | AssetItem[] | `loadSlices('assets')` |
| audioTracks | AudioTrack[] | `loadSlices('audioTracks')` |
| videoSegments | VideoSegment[] | `loadSlices('videoSegments')` |
| characterVoices | CharacterVoice[] | `loadSlices('characterVoices')` |

Mutation helpers: `saveScript()`, `saveStoryboardItem()`, `createStoryboardItems()`, `extractToAssets()`, `updateStoryboardDuration()`, `reload()`.

All raw API responses are normalized from snake_case to camelCase via `normalize*()` functions.

### TaskContext (`new_html/contexts/TaskContext.tsx`)

Wraps `globalTaskManager` lifecycle (start/stop). Provides active task list to the UI.

### ProjectContext (`new_html/contexts/ProjectContext.tsx`)

Current project metadata.

---

## React Query Hooks

### Query Hooks (`new_html/hooks/useEpisodeData.ts`)

| Hook | queryKey | API Function | Returns |
|------|----------|-------------|---------|
| useStoryboardItems(episodeId) | `['storyboardItems', episodeId]` | getStoryboardItems() | StoryboardItemDB[] |
| useAssets(projectId, episodeId) | `['assets', projectId, episodeId]` | getAssets() | AssetItem[] |
| useVideoSegments(episodeId) | `['videoSegments', episodeId]` | getVideoSegments() | VideoSegment[] |
| useScript(episodeId) | `['script', episodeId]` | getEpisodeScript() | string |
| useSaveStoryboardItem() | invalidates `storyboardItems` | updateStoryboardItem() | Mutation |

### Entity File Hook (`new_html/hooks/useEntityFilesQuery.ts`)

| Hook | queryKey | API Function |
|------|----------|-------------|
| useEntityFilesQuery(entityType, entityId, fileRole?) | `['entityFiles', entityType, entityId, fileRole]` | fetchEntityFiles() |

### Mutation Hooks (`new_html/hooks/useFilesMutation.ts`)

| Hook | Action | Invalidates |
|------|--------|-------------|
| useSelectFileMutation() | selectEntityFile() | `['entityFiles', entityType, entityId]` |
| useDeleteFileMutation() | deleteEntityFile() | `['entityFiles', entityType, entityId]` |
| useUploadFileMutation() | uploadEntityFile() | `['entityFiles', entityType, entityId]` |

### SSE → Cache Bridge (`new_html/hooks/useSSEInvalidation.ts`)

Listens to `globalTaskManager` events. On `notification`:
- If `entityType + entityId` present → invalidates `['entityFiles', entityType, entityId]`
- If `episodeId` present → invalidates `['storyboardItems', episodeId]` + `['videoSegments', episodeId]`

### Legacy Hook (`new_html/hooks/useEntityFiles.ts`)

useState-based alternative to useEntityFilesQuery. Not connected to React Query cache. Being phased out.

---

## Pages

### ProjectHub (`new_html/components/ProjectHub.tsx`)

Project list CRUD. API: `listProjects()`, `saveProject()`, `deleteProject()`.

### EpisodeHubPage (`new_html/pages/EpisodeHubPage.tsx`)

Episode list for a project. CRUD operations on episodes.

### ScriptPage (`new_html/pages/ScriptPage.tsx`)

Thin wrapper，从 URL params 提取 `episodeId`，传递给 `WorkspaceApp`（`hideHeader` + `episodeId`）。

WorkspaceApp 只加载当前分集的剧本和分镜数据（通过 `getEpisodeScript` + `getStoryboardItems`），保存走分集 API（`updateEpisodeScript` + `batchCreateStoryboardItems`），文件列表只显示当前分集。`episodeId` 为必传 prop。

**三步生成面板**（2026-05-29）：在剧本基础上引导「拆分 → 视频脚本 → 提取分镜」三阶段流程。① 把原始剧本拆分为多个分段并落 `episode_script_segments`（`script-segments/batch`）；② 逐段生成视频脚本写回同表 `video_script`；③ 从视频脚本提取分镜，批量写入 `storyboard_items`（含 `script_segment_id / source_video_shot_no / video_script_block / shot_size / camera_angle`，回链来源分段）。解析逻辑见 `new_html/utils/scriptPipelineParsers.ts`，prompt 见 `aiModelService`。

### DesignPage (`new_html/pages/DesignPage.tsx`)

Three tabs: character / scene / prop. Per-tab:
- CRUD assets via `createAsset()`, `updateAsset()`, `deleteAsset()`
- Upload reference images via `uploadEntityFile()`
- AI generation via Doubao (`generateDoubaoImages()`) or Gemini (`generateGeminiImageVariant()`)
- Multi-angle / three-view generation
- Style presets: anime, realistic, watercolor, 3D render, high-quality

### MaterialsPage (`new_html/pages/MaterialsPage.tsx`)

Wrapper for `MaterialPage` component. Bridges EpisodeContext data to the material binding UI.

Features:
- **素材绑定级联**: 锁定某镜头的角色/场景素材时，自动向后级联到后续未绑定的同 tag 镜头。通过 `handleBindMaterial` 循环调用 `saveStoryboardItem()` 实现。
- **解绑确认弹窗**: 解除绑定时，若后续镜头存在同素材绑定，弹出 `ConfirmDialog` 让用户选择"仅当前镜头"或"全部解绑"。
- **无 reload 闪烁**: 绑定/解绑操作不调用 `reload()`，通过 `saveStoryboardItem()` 的本地状态更新避免页面闪烁。

### StoryboardGenPage (`new_html/pages/StoryboardGenPage.tsx`)

Wraps `GenerationPage`. Converts episode data to legacy `ProjectFile` format via `scriptToProjectFile()`. Handles per-shot entity file queries for generated images.

Features:
- **时间轴折叠**: 底部 TimelineTrack 支持折叠/展开（`timelineCollapsed` 状态），折叠时仅显示展开按钮。
- **画面预览**: 展开时间轴时显示当前镜头的分镜图片 + 音频同步播放预览。

### AudioStagePage (`new_html/pages/AudioStagePage.tsx`)

Three-panel layout: VoiceSidebar | DubbingPanel | MultiTrackTimeline.
- TTS provider 路由：`voice.voiceProvider === 'minimax'` → `minimaxTTS()`，否则兜底 `generateSpeech()` (Gemini)。
- Voice mapping per character via `characterVoices`（DB 表 `character_voices`，由 VoiceSidebar 写入）
- Per-clip overrides (emotion, speed, pitch, text)
- Batch generation support

**VoiceSidebar (`new_html/components/audio/VoiceSidebar.tsx`)**:
- 三种声源 Tab：`系统预设 / 声音克隆 / 声音设计` —— **全部走 MiniMax 海螺**（不再用 Gemini TTS）。
- 系统预设 = 17 个 MiniMax T2A 官方 voice_id（按 男声/女声/主持/童声 分组渲染）：
  - 男声: `male-qn-qingse / -jingying / -badao / -daxuesheng`
  - 女声: `female-shaonv / -yujie / -chengshu / -tianmei`
  - 主持: `presenter_male / presenter_female / audiobook_male_1/2 / audiobook_female_1/2`
  - 童声: `clever_boy / cute_boy / lovely_girl`
- 默认 voice = `presenter_male`。
- `LEGACY_VOICE_ALIAS` 兼容旧记录（`narrator → presenter_male` 等），打开 drawer 时自动映射，不会丢配置。
- `handleSave` 系统预设分支写 `voice_provider='minimax'`，`AudioStagePage` 批量生成会自动走 MiniMax 路径。

### VideoGenPage (`new_html/pages/VideoGenPage.tsx`) + VideoPage (`new_html/components/VideoPage.tsx`)

Wraps `VideoPage`. `handleImportAll` 导入 episode 全部 storyboard_items（含空分镜 + 已生图 + 仅有音频），构造 `WorkspaceSession` 并触发 `POST /api/storyboard/mix-audio` 异步混音（concurrency=3）。

**关键导入行为（2026-05-17 改造后）**：
- 不再用 `generated_image_url` 过滤；空分镜 → `UploadedImage.isPlaceholder=true`，`SeedanceParams.prompt='@'` 引导用户用 `@` 选首帧。
- 默认模型 `Seedance2`（飞升），duration 由 `computeReactiveDurationFromMeta(meta)` 给出（音频 > 计划 > 默认 5s）。
- 后台 mix-audio 完成后通过 `videoService.patchWorkspaceSession` 把 `mixed_audio_url` 加进 `seedance_params.media_inputs` 作为 `reference_audio`。

**新组件层（`new_html/components/video/`）**：
- `VideoCard.tsx` — `SeedancePanelWithCandidates` / `DurationFieldForGroup` / `StoryboardImageArea` / `AudioBadgesRow` / `VideoCard` 5 个可独立复用的小积木。
- `CardDurationField.tsx` — 卡片时长输入（响应式 + ↺ 清除手动）。
- `StoryboardSyncModal.tsx` — 三模式同步：`add_new` / `overwrite_unmodified` / `full_reset`（实现在 `utils/storyboardSync.ts:applySyncStrategy`）。
- `MediaBadges.tsx`（2026-05-17）— 列表行紧凑徽章 `[图N][视N][音N]`，0 时弱化样式；hover 显示 tooltip。
- `SeedanceDetailModal.tsx`（2026-05-17）— 包装 `<SeedanceMultimodalPanel>` 的 Modal，点列表行 ⚙ 打开；body lock + X / Esc / 点空白关闭；onChange 实时回写父 state。

**列表视图（2026-05-17 重设计）**：从"每行直接渲染完整 SeedanceMultimodalPanel"改为 `h-16` 固定行 mission-bus 布局：thumbnail · model · 一行 textarea · `<MediaBadges>` · 状态 · `[▶ 🗑 ⚙]`。点 ⚙ 打开 `SeedanceDetailModal` 编辑完整参数。详见 conventions §"列表模式不要复用卡片模式的全功能面板"。

**卡片视图固定行高（2026-05-17）**：`COMPACT_CARD_HEIGHT_CLASS = h-[400px] overflow-y-auto` / `SEEDANCE_CARD_HEIGHT_CLASS = h-[720px] overflow-y-auto`，左右两列严格对齐，内部 overflow scroll。

**排序与导入默认**（2026-05-17）：
- `sortedTaskGroups` 强制按 `uploadedImages[i].sortOrder` 升序（来自 `storyboard_items.sort_order`），删除 `sortOrder` state + `最新/最早` toolbar。
- `handleImportAll` / `buildArtifacts` 默认 `role: 'reference_image'`（全能参考），不再写死 `first_frame`。
- `video_prompt` 导入优先：`storyboard_items.video_prompt` > `image_prompt` > 兜底空串。

**Seedance prompt 输入**：所有 SeedanceParams.prompt 输入框统一用 `SeedanceMentionPromptEditor`（`@` 触发 popover，支持 7 组候选 + token 自动维护）。Backspace 在光标前匹配 `(图片|视频|音频)\d+$` 时整块删除 token 并同步 `removeMediaInput`（2026-05-17）。详见 conventions §"Seedance prompt 输入"。

旧 ComfyUI i2v/morph 工作流路径保留（通过 model 选择切换）。

### EnhancePage (`new_html/pages/EnhancePage.tsx`)

Video enhancement workflow. Upscaling, style transfer, frame interpolation.

### HistoryPage (`new_html/pages/HistoryPage.tsx`)

Unified file history viewer. Data source: `GET /api/user-files` (files 表) + active tasks from `/api/tasks`.

Features:
- **统一数据源**: 所有历史生成文件从 `files` 表读取，不再依赖 `tasks` 表的 result 字段。
- **软删除**: 删除操作调用 `deleteEntityFile()`，仅软删除 files 记录。
- **进行中任务**: 顶部展示当前活跃的生成任务及进度。
- **筛选**: 按文件类型、时间范围筛选。

### CanvasPage (`new_html/pages/CanvasPage.tsx`)

Infinite canvas node editor. Node types: text, image, video, storyboard, prompt, group. Connections between nodes.

> 历史备注：`deploy/new_html/components/InfiniteCanvasPage.tsx`（早期独立版本，无 route 挂载）已于 2026-05-05 删除。

### MediaLibraryPage (`new_html/pages/MediaLibraryPage.tsx`) — 2026-05-26 Slice 1

项目级通用素材库（图片 / 视频 / 音频 / 抽帧 / 收藏 / 项目共享），与既有 `files` 表共存：
- 左侧分类（8 类）、顶部上传 + 批量下载 + 视图切换、主区网格/列表、右侧详情面板
- 数据由 `services/mediaLibraryService.ts` 调用 `/api/media-library/*` 维护
- Worker / 同步生成路径在落库时会 best-effort 调用 `media_library_service.create_from_file` 自动入库
- 既挂在 `/projects/:pid/media-library`（项目入口），也挂在 `/projects/:pid/ep/:eid/workflow/media-library`（workflow 顶栏入口，URL 多出来的 episodeId 不参与查询）
- **2026-05-30 文件夹**：左侧分类下新增可嵌套的「文件夹」树（人物 / 场景 / 道具 等自定义分类），支持新建/重命名/删除子文件夹、点击筛选（含「未归类」伪条目）、顶栏「上传目标文件夹」下拉、把素材卡片拖拽到文件夹归类，以及详情面板的「所在文件夹」下拉。树构建/扁平化在 `new_html/utils/mediaFolderTree.ts`（`buildFolderTree` / `flattenForSelect`），文件夹 CRUD 走 `mediaLibraryService.ts` 的 `listMediaFolders/createMediaFolder/updateMediaFolder/deleteMediaFolder`。

### VideoReversePage (`new_html/pages/VideoReversePage.tsx`) — 2026-05-26 Slice 3

视频反推工作台：上传视频 → 切分 → 抽帧 → 视觉分析 → 生成 storyboard prompt。
- 状态机：`pending → splitting → extracting_frames → analyzing → building_prompts → completed`
- 服务：`services/videoReverseService.ts`（estimate / create / list / get / cancel / retry）
- 与 `CreditEstimateModal` 联动，先冻结积分再排队
- 同时挂在项目级 `/projects/:pid/video-reverse` 与 workflow 顶栏 `/workflow/video-reverse`

### CreditsPage (`new_html/pages/CreditsPage.tsx`) — 2026-05-26 Slice 2

用户级积分账户主页（全站独立路由 `/credits`）：余额 + 冻结明细 + 流水分页 + 规则查询。

> **2026-05-26 Slice 5 — AdminPage 增强**：`components/AdminFeatureTabs.tsx` 集中托管账号管理 / 项目分组 / 积分调整 / 素材审计 / 操作审计五大 admin 工作流，作为 `AdminPage` 第 5 个 Tab（`features`）。

> **2026-05-26 — 独立 Admin Shell**：管理后台抽离成与主站完全独立的 Shell。
>  - 入口：`/admin/login`（独立账号密码登录，凭据写入 `sessionStorage.admin_session_token`，与主站 `localStorage.auth_token` 完全隔离 — 双方互不影响）
>  - 视觉：cluster_main 风格的"舰桥控制台"暗黑工业风（zinc-950 / emerald accent / JetBrains Mono ID），不复用主站 indigo
>  - 三层：`AdminLayout`（左 sidebar + topbar + Outlet）/ `AdminHubPage`（导航 Hub：生成管理 / 系统设置）/ `AdminPage` 全屏（5 tab）
>  - `WorkflowLayout` 顶部不再含"管理"按钮 — 流程化页面与后台彻底分离
>  - 前端白名单兜底（admin / lllsdhr）+ 后端 `require_admin` 双闸门
>  - 详见 `docs/vertical-slices.md` "Admin Shell（2026-05-26）"

---

## Major Components

| Component | File | Responsibility |
|-----------|------|---------------|
| GenerationPage | `new_html/components/GenerationPage.tsx` | Multi-engine image generation. 8 个模型: 化神(Gemini nano2) / 练气一阶/二阶 / 筑基一阶/二阶 / K神 (ComfyUI) / 天劫一阶 (gpt-image-2-vip) / 天劫二阶 (gpt-image-2 官方混合)。化神 + 天劫系列 UI 暴露比例 / 1K-2K-4K / quality 参数；ratio×K → size 像素映射在 `utils/gptImageSizeMap.ts`。Shot-by-shot workflow with reference image binding. |
| MaterialPage | `new_html/components/MaterialPage.tsx` | Asset ↔ storyboard binding. Import shots, attach character/scene references. |
| VideoPage | `new_html/components/VideoPage.tsx` | Video segment management. Upload start/end frames, select model, queue ComfyUI tasks. |
| WorkspaceApp | `new_html/WorkspaceApp.tsx` | 四栏编辑器: FileColumn + ViewerColumn + ScriptColumn + StoryboardColumn。`episodeId` 必传，只加载/保存当前分集数据。 |
| AdminPage | `new_html/components/AdminPage.tsx` | User management, server nodes, generation logs. 在 `/admin/operations` 全屏渲染；通过浮层"返回 Hub"按钮回到 AdminLayout。|
| AdminLayout | `new_html/admin/AdminLayout.tsx` | 2026-05-26 独立后台 Shell（左 sidebar + topbar + Outlet），暗黑工业风。 |
| AdminLoginPage | `new_html/admin/AdminLoginPage.tsx` | 2026-05-26 后台独立登录页；调用 `/api/auth/login` 后写 `sessionStorage.admin_session_token`。|
| AdminHubPage | `new_html/admin/AdminHubPage.tsx` | 2026-05-26 后台总览 Hub（KPI 条 + 生成管理 / 系统设置 / 集群仪表盘三入口）。|
| AdminSettingsPage | `new_html/admin/AdminSettingsPage.tsx` | 2026-05-26 系统设置入口列表（API / 模型路由 / 通知 / 集群节点 / 工作流模板 / 速率限制）。|
| HistoryPage | `new_html/components/HistoryPage.tsx` | Task history table with filtering. |
| Header | `new_html/components/Header.tsx` | Top navigation bar. |
| ProjectHub | `new_html/components/ProjectHub.tsx` | Project cards grid with create/delete. |
| ProjectWorkspace | `new_html/components/ProjectWorkspace.tsx` | Outlet wrapper for project-level routes. |
| ScriptColumn | `new_html/components/ScriptColumn.tsx` | Script text editor with AI rewrite. |
| StoryboardColumn | `new_html/components/StoryboardColumn.tsx` | Storyboard item list with drag-reorder. |
| GlobalToast | `new_html/components/GlobalToast.tsx` | Toast notifications from task events. |
| ImageFusionModal | `new_html/components/ImageFusionModal.tsx` | Merge multiple images via ComfyUI. |
| MattingModal | `new_html/components/MattingModal.tsx` | Background removal / matting. |
| StoryboardToolModal | `new_html/components/StoryboardToolModal.tsx` | Batch storyboard operations. |
| ConfirmDialog | `new_html/components/ConfirmDialog.tsx` | Reusable confirmation dialog with dark theme, keyboard support, variant styles. |
| MultiAngle3DController | `new_html/components/MultiAngle3DController.tsx` | 3D rotation preview for multi-angle generation. |
| MediaImage | `new_html/components/MediaImage.tsx` | Secure image renderer (token injection). |
| TimelineTrack | `new_html/components/TimelineTrack.tsx` | Horizontal timeline clip display. |
| SkeletonScreen | `new_html/components/SkeletonScreen.tsx` | Loading placeholder. |
| LoadingOverlay | `new_html/components/LoadingOverlay.tsx` | Full-screen loading spinner. |

### Audio Sub-components (`new_html/components/audio/`)

| Component | Responsibility |
|-----------|---------------|
| DubbingPanel | Per-shot dubbing cards with generate/play controls |
| DubbingCard | Single shot: text edit, voice select, generate, playback |
| VoiceSidebar | Character voice assignment panel |
| MultiTrackTimeline | Multi-track audio timeline visualization |

---

## Services

### apiService (`new_html/services/apiService.ts`)

Core HTTP client. All requests use JWT from `localStorage('auth_token')`. Auto-redirect to `/login` on 401.

| Category | Functions |
|----------|----------|
| Projects | saveProject, listProjects, getProject, deleteProject |
| Episodes | getEpisodes, createEpisode, updateEpisode, deleteEpisode |
| Script | getEpisodeScript, updateEpisodeScript |
| Storyboard | getStoryboardItems, updateStoryboardItem, batchCreateStoryboardItems, deleteStoryboardItem |
| Assets | getAssets, createAsset, updateAsset, deleteAsset, extractToAssets |
| Video | getVideoSegments, exportToVideo |
| Audio | getAudioTracks, getCharacterVoices, minimaxTTS, generateSpeech |
| ComfyUI | uploadImageToComfyUI, processMaterial |
| Tasks | getActiveTasks, getTaskNotifications |
| Members | getProjectMembers, addProjectMember, updateProjectMember |

### geminiService (`new_html/services/geminiService.ts`)

Text generation: `rewriteNovelToScript()`, `extractStoryboard()`, `generateShotDetails()`.
Image generation: `generateGeminiImageVariant()` (proxied), `adjustImageAngle()`, `processMaterialImage()`, `generateHumanMultiAngleQueued()`.
Queue integration: `waitForComfyUITask()`, `enqueueComfyUITask()`.

### geminiImageService (`new_html/services/geminiImageService.ts`)

Direct Gemini image generation via proxy API. `generateGeminiImageViaProxy()`.

### doubaoService (`new_html/services/doubaoService.ts`)

Doubao (豆包) image generation. `generateDoubaoImages()` → `POST /api/materials/doubao`.
Options: prompt, references, size (1K/2K/4K), count, entity binding.

### deepseekService (`new_html/services/deepseekService.ts`)

DeepSeek LLM calls with streaming. `callDeepseekWithRetry()` (reasoner model), `callDeepseekChatWithRetry()` (chat model).
Proxied via `POST /api/deepseek/chat`.

### videoService (`new_html/services/videoService.ts`)

Video generation pipeline. ComfyUI models (Wan2, 一阶–七阶) vs external API models (MINI, Sora2, Veo, 大能, **飞升 (Seedance2)**, **渡劫 (Seedance2Fast)**).
`isComfyUIModel()` determines queue routing. Uses `enqueueComfyUITask()` for local GPU tasks.

**Seedance 2.0 专用 API:**
- `submitSeedanceTask(params: SeedanceParams, entityOptions?, draftTaskId?)` — 提交多模态任务，自动调 `inferSeedanceTaskType` 推断 task_type（`seedance_t2v` / `seedance_i2v` / `seedance_morph` / `seedance_multi` / `seedance_draft`）。fast 子型号 + 1080p 自动降级 720p。
- `inferSeedanceTaskType(media, hasDraftId?)` — 根据 media_inputs 角色与数量、是否带 draft_task_id 推断场景。
- 类型：`SeedanceMediaKind` `SeedanceMediaRole` `SeedanceMediaInput` `SeedanceParams`。
- `getModelDisplayName('Seedance2')` 返回 `"飞升"`，`'Seedance2Fast'` 返回 `"渡劫"`。

### Seedance 多模态面板 (`new_html/components/SeedanceMultimodalPanel.tsx`)

VideoPage 在选中 `Seedance2` / `Seedance2Fast` 时，列表视图的 prompt textarea 会切换为本面板。

**模式切换（2026-05-17 新增）**：面板顶部有 `[全能参考 | 首尾帧]` segmented control。
- **全能参考**：图片 role 可以是 `reference_image`；视频/音频 section active，可上传 reference_video / reference_audio。
- **首尾帧**：第 1 张图自动改为 `first_frame`，第 2 张图自动改为 `last_frame`；视频/音频 section 整体 `opacity-30 pointer-events-none`，并显示 `(跳过)` 角标；`VideoPage.runTask` 在 submit 前 `media_inputs.filter(m => m.kind === 'image')`，跳过视频/音频不发给 ark。
- mode 不是新增的持久化字段，**从已存在的 `media_inputs[].role` 推导**：含 `first_frame` 或 `last_frame` ⇒ 首尾帧模式；否则 ⇒ 全能参考模式。切换 mode = 批量 rewrite role（不引入 `seedance_mode` 字段）。理由见 `docs/conventions.md` §"Seedance 媒体模式必须从 role 推导"。

- **媒体上传**：图片 0-9（可选 role: 首帧 / 尾帧 / 参考图）+ 视频 0-3（role=reference_video）+ 音频 0-3（role=reference_audio），集成 `videoService.uploadImage` / `uploadVideoFile` / `uploadAudio`
- **互斥校验**（useMemo 实时显示红字）：
  - 首尾帧 与 参考图（reference_image） 不能同时使用
  - 首帧 / 尾帧 必须成对出现
  - 至少提供 1 个媒体或非空 prompt
  - **不可单独输入音频**：必须至少包含 1 张图或 1 段视频（ark 硬限）
  - fast 子型号 + 1080p 不允许（自动禁用 1080p 选项）
  - 数量上限：图 ≤ 9 / 视频 ≤ 3 / 音频 ≤ 3
- **真人脸来源约束**（UI hint，Seedance 2.0 系列硬限）：不支持直接上传含真人人脸的图/视频；如需人物请用：本平台模型生成的产物 / 预置虚拟人像 / 已授权真人素材
- **输出参数默认全部展开**：`resolution` / `ratio` / `duration` / `seed` / `watermark` / `generate_audio` / `camera_fixed`（2.0 系列灰显）直接可见，不再默认藏在“高级设置”折叠里。
- **Seedance 专用大卡片**：VideoPage card 视图中，普通模型保持 `min-h-[380px] max-h-[420px]`；`Seedance2` / `Seedance2Fast` 使用 `min-h-[620px] max-h-[760px]`。左右配置卡 / 结果卡通过 `getCardHeightClass(model)` 使用同一高度策略。
- **媒体列表局部滚动**：参数控件必须可见；图片/视频/音频缩略列表可以在各自区域内 `max-height + overflow-y-auto`，避免 9 张图撑破卡片。
- **视觉层级**：核心参数（分辨率、比例、时长、AI 配音）优先显示；次要参数（seed、水印、camera_fixed）弱化显示；camera_fixed 明确标注仅 1.5pro。

VideoPage 集成约定：
- 用 `seedanceParamsByUuid` state 按 `group.uuid` 索引参数（不污染 `TaskGroup` 类型）
- `runTask` 早期分支：检测到 `Seedance2` / `Seedance2Fast` 直接调 `submitSeedanceTask` + `startPolling`，跳过 `prepareImage` / `submitTaskQueued`
- entity-aware 落库：传 `entity_type=video_segment, entity_id=group.uuid, file_role=video`，worker `_save_external_video` 自动联动 `video_segments.video_url` 同步
- **VideoPage 有 card / list 两种视图模式**（`viewMode` state，默认 `'card'`），SeedanceMultimodalPanel 必须在**两种视图都条件渲染**（renderTaskCard line 1958-1976 + renderTaskListItem line 1744 附近），只改一种视图会让默认进来的用户看不到面板。新功能涉及任何 prompt 输入区改造时同样的双视图覆盖原则适用。

### DashScope 三家视频模型卡片（2026-05-24 重设计）

合体(Kling) / 大乘(Vidu) / 炼虚(HappyHorse) 卡片，统一以下结构：

#### 排版
- 外层：`min-h-[420px] h-full flex flex-col`（不再写死 px 高度）
- Shell：theme 色 header + 内部 `flex-1 min-h-0 overflow-y-auto p-3` 主体
- 内部分段：mode toggle → prompt → 媒体槽 → 核心参数 → `<details open>` 高级参数

#### 参数完整暴露清单

**合体 (Kling, kling-v3-* )**：
- prompt（多镜头自定义模式下置灰）
- mode（5 个）：T2V / I2V / Morph / Omni (refer) / Multi (智能或自定义多镜头)
- media：first_frame / last_frame / refer×7
- multi_shot + shot_type（intelligence / customize）+ multi_prompt[1-6]
- mode（std 720P / pro 1080P）、duration（3-15s）、aspect_ratio、audio、watermark

**大乘 (Vidu, viduq3/q2 子模型)**：
- prompt + media（image×1-7, video×0-2 视子模型）
- 子模型：q3-mix / q3 / q3-turbo / q2-pro / q2
- duration（q3: 1-16s; q2: 1-10s）、resolution（540/720/1080P）、size（auto 衍生可改）
- 高级：seed、audio（仅 q3 子模型可开）、watermark

**炼虚 (HappyHorse, happyhorse-1.0-r2v)**：
- prompt（用 `[Image N]` 引用 media 数组）
- media：1-9 张 reference_image（**必须**）
- duration（3-15s）、resolution（720/1080P）、ratio（9 种）
- 高级：watermark（默认 true）、seed

#### 三家共有 + 各自独有
| 参数 | Kling | Vidu | HappyHorse |
|---|:---:|:---:|:---:|
| prompt | ✓ | ✓ | ✓ |
| seed | ❌ | ✓ | ✓ |
| audio | ✓ | ✓ (q3) | ❌ |
| watermark | ✓ | ✓ | ✓ |
| 多镜头 | ✓ (独有) | ❌ | ❌ |
| 比例数量 | 3 | (用 size) | 9 |

#### 类型来源
`new_html/services/videoService.ts::DashScopeVideoParams` 是单一可信源。

#### 卡片高度策略
见 `.claude/skills/project-memory/references/recurring-pitfalls.md §T`。

### globalTaskManager (`new_html/services/globalTaskManager.ts`)

Singleton `GlobalTaskManager`. SSE-first with HTTP polling fallback.
- SSE endpoint: `GET /api/tasks/stream?token=...`
- Handles `task_complete` / `task_failed` → emits `notification` event
- Handles progress updates → emits `progress` event
- Polling fallback: `getActiveTasks()` + `getTaskNotifications()` every 5s
- Auto-reconnect SSE after 10s on disconnect

### entityFileService (`new_html/services/entityFileService.ts`)

Entity-file binding CRUD.

| Function | Method | Endpoint |
|----------|--------|----------|
| fetchEntityFiles | GET | /api/entity-files?entity_type=&entity_id=&file_role= |
| selectEntityFile | PUT | /api/entity-files/:fileId/select |
| deleteEntityFile | DELETE | /api/entity-files/:fileId |
| linkEntityFile | POST | /api/entity-files/link |
| uploadEntityFile | POST | /api/entity-files/upload (multipart) |

### Other Services

| Service | File | Purpose |
|---------|------|---------|
| aiService | `new_html/services/aiService.ts` | Unified `callAI()` dispatcher across models |
| aiModelService | `new_html/services/aiModelService.ts` | Model registry and capability detection |
| comfyuiTaskQueue | `new_html/services/comfyuiTaskQueue.ts` | ComfyUI job queue with concurrency control |
| apiTaskQueue | `new_html/services/apiTaskQueue.ts` | External API rate-limited queue |
| imageLoaderService | `new_html/services/imageLoaderService.ts` | Image preloading + in-memory LRU cache |
| geminiProxyService | `new_html/services/geminiProxyService.ts` | Proxy routing for Gemini API calls |
| geminiProxyTextService | `new_html/services/geminiProxyTextService.ts` | Text generation via Gemini proxy |
| taskRecovery | `new_html/services/taskRecovery.ts` | Recover interrupted tasks on page reload |

---

## Key Types (`new_html/types.ts`)

### Domain Models

| Type | Key Fields |
|------|-----------|
| ProjectInfo | projectId, projectName, description, tags, memberCount |
| Episode | episodeId, projectId, episodeNumber, status (draft/in_progress/completed/published) |
| EpisodeScript | scriptId, episodeId, originalContent, adaptedScript, metadata |
| StoryboardItemDB | itemId, episodeId, sortOrder, sceneHeading, actionText, dialogue, imagePrompt, videoPrompt, generatedImageUrl, boundAssets, dialogueAudioUrl |
| AssetItem | assetId, projectId, assetType (character/scene/prop), name, referenceImages, styleParams |
| VideoSegment | segmentId, episodeId, storyboardItemId, generationMode, model, videoUrl, status |
| AudioTrack | trackId, episodeId, trackType (bgm/sfx_global/narration_global), audioUrl |
| CharacterVoice | voiceId, projectId, characterName, voiceProvider, voiceModelId |
| EntityFile | fileId, fileUrl, fileType, fileRole, isSelected |

### Task System

| Type | Key Fields |
|------|-----------|
| GlobalTask | id, category (api_text/api_image/api_video/comfyui), status, displayName, progress |
| TaskNotification | id, type, status, message, entityType, entityId, fileRole, episodeId |

### Canvas

| Type | Key Fields |
|------|-----------|
| CanvasBoard | id, projectId, episodeId, nodes[], connections[] |
| CanvasNode | id, type (text/image/video/storyboard/prompt/group), x, y, data |
| CanvasConnection | id, sourceNodeId, targetNodeId |

### Enums

| Enum | Values |
|------|--------|
| AppView | ProjectHub, EpisodeHub, Editor, Design, Materials, AudioStage, Generation, Video, Enhance, PostProcess, History, Canvas, Admin |
| AiModel | gemini, deepseek, deepseek-chat |
| TaskCategory | api_text, api_image, api_video, comfyui |
| GlobalTaskStatus | queued, running, completed, failed, cancelled |

---

## Layouts

### WorkflowLayout (`new_html/layouts/WorkflowLayout.tsx`)

Top navigation bar with step tabs (2026-05-26 顺序):
`剧本 → 视频反推 → 设计 → 素材 → 配音 → 分镜 → 视频 → 美化 → 素材库 → 历史`，
右侧依次为 `自由创作`、`管理`（admin only）、通知铃铛、退出。
Wraps children in `EpisodeProvider`. Uses `NavLink` with active state styling.

---

## Tests

测试文件位于 `new_html/__tests__/`（Vitest + React Testing Library）。
扫描器会把 `__tests__/pages/*.test.tsx` 识别成"page"，但它们不是真实路由 ——
本节集中列出，避免 sync_check 报 `page-undocumented`：

| Test file | Covers |
|-----------|--------|
| `__tests__/pages/AudioStagePage.runGenerate.test.tsx` | AudioStagePage 的 `runGenerate` 入口（TTS 触发链路） |
| `__tests__/hooks/usePersistedPageState.test.tsx` | 通用 hook（任意页面均使用） |
| `__tests__/services/*` | 各 service 单测（mediaLibrary / gptImage / videoTaskPoller / taskRegistry / notificationMapping / comfyuiTaskQueueRegistry / waitForComfyUITaskRegistry / durationMapping） |
| `__tests__/utils/*` | 工具函数单测（gptImageSizeMap / promptHighlight / seedanceCandidateBuilder / seedanceMedia / durationMapping） |
| `__tests__/components/SeedanceMentionPromptEditor.test.tsx` | Seedance 提示词组件 |
| `__tests__/components/SeedanceMentionTokensRow.test.tsx` | 同上 token 行 |

---

## Data Flow: SSE → UI Refresh

```
Backend (task worker completes)
  ↓
SSE push: { type: "task_complete", entity_type, entity_id, episode_id }
  ↓
globalTaskManager.handleSSEMessage()
  ↓
emit('notification', { notification })
  ↓
useSSEInvalidation() listener
  ↓
queryClient.invalidateQueries(['entityFiles', entityType, entityId])
queryClient.invalidateQueries(['storyboardItems', episodeId])
queryClient.invalidateQueries(['videoSegments', episodeId])
  ↓
React Query auto-refetch → UI updates
```

Fallback: HTTP polling every 5s via `getActiveTasks()` + `getTaskNotifications()`.
