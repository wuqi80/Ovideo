# Business Flows — MY2 Storyboard Copilot

## Overview

Six core production flows, each corresponding to a workflow step in the UI.
All flows operate within a project/episode scope and share the entity-file system for persistent storage.

---

## Flow 1: Script Creation

```
User opens ScriptPage
  ↓
ScriptPage extracts episodeId from URL params
  → new_html/pages/ScriptPage.tsx
  ↓
ScriptPage renders WorkspaceApp (hideHeader, episodeId)
  → new_html/WorkspaceApp.tsx
  ↓
WorkspaceApp loadEpisodeData():
  → apiService :: getEpisodeScript(episodeId)
  → apiService :: getStoryboardItems(episodeId)
  → 转换为单个 ProjectFile (id=episodeId)
  → 文件列表只显示当前分集
  ↓
User pastes/types novel text into editor
  → ScriptColumn (new_html/components/ScriptColumn.tsx)
  ↓
User clicks "改写为剧本" (rewrite to script)
  ↓
callAI() dispatcher → deepseekService or geminiService
  → new_html/services/aiService.ts
  → new_html/services/deepseekService.ts :: callDeepseekWithRetry()
  OR
  → new_html/services/geminiService.ts :: rewriteNovelToScript()
  ↓
Streaming response displayed in real-time
  ↓
User clicks "提取分镜" (extract storyboard)
  → geminiService :: extractStoryboard()
  ↓
Storyboard items created + Script saved:
  saveEpisodeToBackend():
    → updateEpisodeScript(episodeId, { original_content, adapted_script })
    → batchCreateStoryboardItems(episodeId, dbItems)
```

### Key Data

- Input: raw novel text (originalContent)
- Output: adapted script (adaptedScript) + StoryboardItemDB[] in DB
- Models: DeepSeek Reasoner / DeepSeek Chat / Gemini 2.5 Flash
- WorkspaceApp props: `hideHeader`, `episodeId`（必传）

---

## Flow 2: Character / Scene Design

```
User opens DesignPage
  → new_html/pages/DesignPage.tsx
  → EpisodeContext :: loadSlices('assets')
  ↓
User selects tab: 人物 / 场景 / 道具
  ↓
User clicks "新建" (create asset)
  → apiService :: createAsset(projectId, episodeId, { name, assetType, description })
  → POST /api/assets
  ↓
User uploads reference image
  → entityFileService :: uploadEntityFile(file, 'asset', assetId, 'reference')
  → POST /api/entity-files/upload (multipart)
  → File saved to files table, linked to asset
  ↓
OR User clicks AI generate
  ↓
  ┌── Engine: Doubao ──────────────────────────────────────────┐
  │ doubaoService :: generateDoubaoImages({                    │
  │   prompt, references, size, entityType, entityId, fileRole │
  │ })                                                         │
  │ → POST /api/materials/doubao                               │
  │ → Backend generates + saves to files table                 │
  │ → Returns { files: [{ file_id, file_url }] }              │
  └────────────────────────────────────────────────────────────┘
  ┌── Engine: Gemini ──────────────────────────────────────────┐
  │ geminiService :: generateGeminiImageVariant({              │
  │   prompt, referenceImages, entityType, entityId, fileRole  │
  │ })                                                         │
  │ → geminiImageService :: generateGeminiImageViaProxy()      │
  │ → POST /api/gemini/image                                   │
  │ → Backend saves to files table via save_generated_file     │
  └────────────────────────────────────────────────────────────┘
  ↓
Generated files auto-linked to asset entity
  → entity_files table: (file_id, entity_type='asset', entity_id=assetId, file_role='reference')
  ↓
User selects best image
  → useSelectFileMutation() → selectEntityFile(fileId, 'asset', assetId, 'reference')
  → PUT /api/entity-files/{fileId}/select
  ↓
Asset thumbnailUrl updated
  → apiService :: updateAsset(assetId, { thumbnail_url })
  → PUT /api/assets/{assetId}
```

### Multi-Angle / Three-View

```
User clicks "三视图" or "多角度"
  ↓
geminiService :: generateHumanMultiAngleQueued() or adjustImageAngle()
  → ComfyUI workflow queued via enqueueComfyUITask()
  → POST /api/comfyui/queue
  ↓
Worker processes → saves result to files table
  ↓
SSE notification → useSSEInvalidation → cache refresh
```

---

## Flow 3: Image Generation (Storyboard)

```
User opens StoryboardGenPage
  → new_html/pages/StoryboardGenPage.tsx
  → EpisodeContext :: loadSlices('storyboardItems', 'assets', 'script')
  ↓
Page converts episode data to legacy format
  → episodeAdapters :: scriptToProjectFile()
  → episodeAdapters :: assetsToMaterialLibrary()
  ↓
Renders GenerationPage component
  → new_html/components/GenerationPage.tsx
  ↓
Per-shot workflow:
  1. User reviews imagePrompt (auto-generated or manual)
  2. User binds character/scene references from MaterialLibrary
  3. User selects engine: ComfyUI / Gemini / Doubao
  4. User clicks "生成" (generate)
  ↓
  ┌── ComfyUI Path ────────────────────────────────────────────┐
  │ Upload reference images                                     │
  │   → apiService :: uploadImageToComfyUI(imageUrl)            │
  │   → POST /api/comfyui/upload                                │
  │ Queue workflow                                              │
  │   → comfyuiTaskQueue :: enqueueComfyUITask({                │
  │       workflow, images, entityType, entityId, fileRole       │
  │     })                                                      │
  │   → POST /api/comfyui/queue                                 │
  │ Worker executes on GPU server                               │
  │   → Result saved to files table by backend worker           │
  │   → SSE: { type: 'task_complete', entity_type, entity_id }  │
  └─────────────────────────────────────────────────────────────┘
  ┌── Gemini Path ─────────────────────────────────────────────┐
  │ geminiService :: generateGeminiImageVariant({               │
  │   prompt, referenceImages, entityType, entityId, fileRole   │
  │ })                                                          │
  │ → POST /api/gemini/image                                    │
  │ → Synchronous: returns generated image immediately          │
  └─────────────────────────────────────────────────────────────┘
  ┌── Doubao Path ─────────────────────────────────────────────┐
  │ doubaoService :: generateDoubaoImages({                     │
  │   prompt, references, entityType, entityId, fileRole        │
  │ })                                                          │
  │ → POST /api/materials/doubao                                │
  │ → Synchronous: returns generated image immediately          │
  └─────────────────────────────────────────────────────────────┘
  ↓
SSE notification received (for async ComfyUI tasks)
  → globalTaskManager :: handleSSEMessage()
  → emit('notification', { notification })
  ↓
useSSEInvalidation hook
  → queryClient.invalidateQueries(['entityFiles', entityType, entityId])
  → queryClient.invalidateQueries(['storyboardItems', episodeId])
  ↓
React Query auto-refetch → UI shows new image
  ↓
User selects best image
  → useSelectFileMutation() → PUT /api/entity-files/{fileId}/select
  ↓
Storyboard item updated with selected image
  → useSaveStoryboardItem()
  → apiService :: updateStoryboardItem(itemId, { generated_image_url })
  → PUT /api/storyboard-items/{itemId}
```

### Timeline View

```
StoryboardGenPage renders TimelineTrack at bottom
  → new_html/components/TimelineTrack.tsx
  → Shows sequence of shots with thumbnails + duration
```

---

## Flow 4: Audio / Dubbing

```
User opens AudioStagePage
  → new_html/pages/AudioStagePage.tsx
  → EpisodeContext :: loadSlices('storyboardItems', 'assets', 'characterVoices', 'script', 'audioTracks')
  ↓
Three-panel layout:
  [VoiceSidebar]  [DubbingPanel]  [MultiTrackTimeline]
  ↓
VoiceSidebar: assign voice per character
  → new_html/components/audio/VoiceSidebar.tsx
  → Maps character name → CharacterVoice (voiceProvider, voiceModelId)
  ↓
DubbingPanel: per-shot audio generation
  → new_html/components/audio/DubbingPanel.tsx
  → new_html/components/audio/DubbingCard.tsx
  ↓
Per clip (narration or dialogue line):
  1. Text displayed from storyboard item (actionText / dialogue)
  2. User can override: emotion, speed, pitch, text, speaker
  3. User clicks "生成语音" (generate speech)
  ↓
  ┌── MiniMax TTS ─────────────────────────────────────────────┐
  │ apiService :: minimaxTTS({                                  │
  │   text, voiceId, speed, pitch, emotion                     │
  │ })                                                          │
  │ → POST /api/tts/minimax                                    │
  │ → Returns { audio_url, duration_ms }                       │
  └─────────────────────────────────────────────────────────────┘
  ┌── Gemini Speech ───────────────────────────────────────────┐
  │ apiService :: generateSpeech({                              │
  │   text, voiceName, ...params                               │
  │ })                                                          │
  │ → POST /api/tts/gemini                                     │
  │ → Returns { audio_url, duration_ms }                       │
  └─────────────────────────────────────────────────────────────┘
  ↓
Audio URL saved to storyboard item
  → apiUpdateStoryboardItem(itemId, {
      dialogue_audio_url: audioUrl,
      audio_duration_ms: durationMs
    })
  → PUT /api/storyboard-items/{itemId}
  ↓
MultiTrackTimeline updates with audio clips
  → new_html/components/audio/MultiTrackTimeline.tsx
```

### Batch Generation

```
User clicks "批量生成" in DubbingPanel
  → Iterates all clips without audio
  → Sequential TTS calls per clip
  → Progress shown per-card
```

---

## Flow 5: Video Generation

```
User opens VideoGenPage
  → new_html/pages/VideoGenPage.tsx
  → EpisodeContext :: loadSlices('storyboardItems')
  ↓
Import panel: select storyboard items with generated images
  → Filter items where generatedImageUrl exists
  → User clicks "导入到视频" (import to video)
  ↓
VideoPage component handles generation
  → new_html/components/VideoPage.tsx
  → new_html/services/videoService.ts
  ↓
Per video segment:
  1. Start frame: from storyboard generatedImageUrl
  2. End frame: optional (user upload or next shot)
  3. Select model + generation mode
  ↓
Model routing:
  ┌── ComfyUI Models (Wan2, 一阶–七阶) ───────────────────────┐
  │ videoService :: isComfyUIModel() → true                     │
  │ Upload images to ComfyUI                                    │
  │   → apiService :: uploadImageToComfyUI()                    │
  │ Queue i2v / morph workflow                                  │
  │   → comfyuiTaskQueue :: enqueueComfyUITask()                │
  │   → POST /api/comfyui/queue                                 │
  │ Worker processes on GPU                                     │
  │   → Result saved to files table                             │
  │   → SSE: { type: 'task_complete', episode_id }              │
  └─────────────────────────────────────────────────────────────┘
  ┌── External API Models (MINI, Sora2, Veo, 大能) ────────────┐
  │ videoService :: isComfyUIModel() → false                    │
  │ Direct API call to external service                         │
  │   → POST /api/video/generate                                │
  │ Async: backend polls external API for completion            │
  │   → SSE notification when done                              │
  └─────────────────────────────────────────────────────────────┘
  ↓
SSE notification → useSSEInvalidation
  → queryClient.invalidateQueries(['videoSegments', episodeId])
  ↓
VideoPage refreshes → shows generated video
  ↓
Video segment record updated
  → videoSegments table: { video_url, status: 'completed', duration_ms }
```

---

## Flow 6: Material Binding

```
User opens MaterialsPage
  → new_html/pages/MaterialsPage.tsx
  → Wraps MaterialPage component
  → new_html/components/MaterialPage.tsx
  ↓
MaterialPage loads:
  → EpisodeContext :: storyboardItems (shots)
  → EpisodeContext :: assets (characters, scenes, props)
  → Per-asset entity files via useEntityFilesQuery('asset', assetId, 'reference')
  ↓
Left panel: asset list grouped by type (character / scene / prop)
  → Each asset shows reference images from entity files
  ↓
Right panel: storyboard items
  → Each shot shows bound assets (boundAssets field)
  ↓
Binding workflow:
  1. User selects a storyboard item (shot)
  2. User drags/clicks an asset to bind
  3. Asset bound to shot
     → apiService :: updateStoryboardItem(itemId, {
         bound_assets: [...existing, assetId]
       })
     → PUT /api/storyboard-items/{itemId}
  ↓
Per-shot material selection:
  1. For each bound asset, show its generated images
  2. User selects which image to use for this shot
  3. Selection stored in materialSelections field
  ↓
Result: each storyboard item has:
  - boundAssets: ['asset-char-1', 'asset-scene-2']
  - reference images resolved from entity files per asset
  - These references feed into image generation (Flow 3)
```

---

## Cross-Flow: Entity File System

All binary assets (images, audio, video) are stored via the unified entity-file system.

```
Upload / AI Generate
  ↓
Backend saves file to storage + files table
  → save_generated_file_to_db() (同步 API)
  → OR worker._persist_file() (ComfyUI 异步任务)
  ↓
files 表记录创建
  → { file_id, file_url, entity_type, entity_id, file_role }
  ↓
⚡ _sync_legacy_on_file_create() — 自动同步旧字段
  → asset + reference_image → 追加到 assets.reference_images
  → storyboard_item + generated_image → 更新 generated_image_url
  → storyboard_item + dialogue_audio → 更新 dialogue_audio_url
  → video_segment + video → 更新 video_url
  ↓
Frontend queries (两种方式共存)
  → 新: useEntityFilesQuery('asset', id, 'reference_image') — DesignPage
  → 旧: asset.referenceImages via EpisodeContext — MaterialsPage
  ↓
Selection
  → PUT /api/entity-files/{fileId}/select
  → Sets is_selected=true
  → _sync_legacy_url() — 同步选中的 URL 到旧字段
```

Entity types used across flows:

| entity_type | entity_id | file_role | Used In |
|-------------|-----------|-----------|---------|
| asset | assetId | reference_image | Flow 2 (Design), Flow 6 (Materials) |
| asset | assetId | material_image | Flow 6 (Materials) AI 生成素材 |
| asset | assetId | asset_thumbnail | Flow 2 (Design) 缩略图 |
| storyboard_item | itemId | generated_image | Flow 3 (Image Gen) |
| storyboard_item | itemId | dialogue_audio | Flow 4 (Audio) |
| storyboard_item | itemId | narration_audio | Flow 4 (Audio) |
| storyboard_item | itemId | sfx | Flow 4 (Audio) |
| video_segment | segmentId/uuid | video | Flow 5 (Video) |
| video_segment | segmentId/uuid | video_thumbnail | Flow 5 (Video) |

### ⚠️ 跨页面数据联通关键规则

**所有生成 API 调用必须传递 entity 参数**，否则 `_sync_legacy_on_file_create` 无法将文件 URL 同步到旧业务表字段，导致下游页面（仍读旧字段的）看不到数据。

```
❌ 错误: generateGeminiImageVariant({ prompt, references })
   → 文件保存到 files 表但无 entity 绑定 → 旧字段不更新 → 下游页面看不到

✅ 正确: generateGeminiImageVariant({ prompt, references, entityType: 'asset', entityId, fileRole: 'reference_image', episodeId })
   → 文件保存到 files 表 + entity 绑定 → _sync_legacy_on_file_create 自动追加到 assets.reference_images → 下游正常
```

已完成 entity 参数传递的页面/函数：
- DesignPage: `handleAIGeneration`, `handleBatchGenerate`, `handleCameraGenerate`, `handleProcessSubmit`
- GenerationPage: 8 个 ComfyUI 工具函数
- MaterialPage: `handleMaterialAIGeneration`, `handleThreeViewGenerate`, `handleCameraGenerate`
- AudioStagePage: `minimaxTTS`, `generateSpeech`
- VideoPage: `submitTaskQueued`

---

## Cross-Flow: SSE Task Notification

```
Backend worker completes task
  ↓
SSE push via /api/tasks/stream
  → { type: 'task_complete', task_id, entity_type, entity_id, episode_id, ... }
  ↓
globalTaskManager.handleSSEMessage()
  → new_html/services/globalTaskManager.ts
  ↓
Emits 'notification' event to all listeners
  ↓
┌── useSSEInvalidation (React Query cache) ─────────────────┐
│ Invalidates relevant query keys:                           │
│   ['entityFiles', entityType, entityId]                    │
│   ['storyboardItems', episodeId]                           │
│   ['videoSegments', episodeId]                             │
│ → React Query auto-refetches → UI updates                  │
└────────────────────────────────────────────────────────────┘
┌── GlobalToast (user notification) ────────────────────────┐
│ Shows toast: "xxx 已完成" / "xxx 失败"                      │
│ Click navigates to relevant page                           │
└────────────────────────────────────────────────────────────┘
```

Fallback: if SSE disconnects, polling every 5s via `getActiveTasks()` + `getTaskNotifications()`.
