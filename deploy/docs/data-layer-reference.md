# 统一数据层 — 数据结构与 API 映射参考

本文档汇总了项目中所有与数据生成、保存、传输相关的结构和 API。
后续修改时可直接查阅此文档，无需从头分析代码。

> **状态**：Phase 1-3 已实施完成（2026-04-02），所有 API 端点已添加 entity 字段，
> 前端已迁移到 React Query + SSE 自动失效机制。
>
> **Entity-File 统一迁移**（2026-04-03）：所有生成路径已统一传递
> `entityType/entityId/fileRole/episodeId` 到后端。
>
> **数据源统一**（2026-04-04）：Assets API 响应内嵌 entity files，所有页面通过
> `EpisodeContext.assets`（含 `entityFiles[]`）统一消费图片数据。DesignPage 不再
> 使用独立的 `useEntityFilesQuery`。`assetsToMaterialLibrary` 优先从 entity files
> 构建素材库，legacy `referenceImages` 作为降级。

---

## 1. 数据库核心表

### files 表（统一文件存储）

**DAO 位置**: `dao_content.py` L293-335 (`FileDAO.create_file`)

| 列名 | 类型 | 说明 |
|------|------|------|
| file_id | VARCHAR PK | UUID 格式 |
| version_id | VARCHAR | 可为 NULL |
| user_id | VARCHAR | 所属用户 |
| file_type | VARCHAR | image / audio / video / text |
| file_name | VARCHAR | 存储文件名 |
| file_path | VARCHAR | 磁盘绝对路径 |
| file_url | VARCHAR | HTTP 访问路径 `/storage/...` |
| file_size_bytes | INT | 文件大小 |
| mime_type | VARCHAR | MIME 类型 |
| metadata | JSONB | 扩展字段 {source, task_id, episode_id, ...} |
| entity_type | VARCHAR | storyboard_item / asset / video_segment |
| entity_id | VARCHAR | 关联实体 ID |
| file_role | VARCHAR | generated_image / reference_image / dialogue_audio / ... |
| is_selected | BOOLEAN | 是否被选定 |
| created_at | TIMESTAMP | 自动生成 |
| is_deleted | BOOLEAN | 软删除标记 |

**两个 DAO 的区别**:
- `dao_file.py FileDAO.create()` — 不支持 entity_type/entity_id/file_role/is_selected
- `dao_content.py FileDAO.create_file()` — 支持全部字段（**推荐使用**）

### storyboard_items 表

**API**: `GET /api/episodes/{episode_id}/storyboard-items` → `{ success, items: [...] }`
**DAO**: `dao_storyboard.py`

| 关键字段 | 说明 |
|----------|------|
| item_id | PK |
| episode_id | 所属集 |
| sort_order | 排序号 |
| scene_heading | 场景标题 |
| action_text | 动作描述 |
| dialogue | 对话文本 |
| camera_movement | 镜头运动 |
| image_prompt | 画面描述 |
| video_prompt | 视频描述 |
| bound_assets | 绑定资产 |
| generated_image_url | 选定画面 URL（legacy 单图，新流程通过 files 表管理） |
| dialogue_audio_url | 配音 URL |
| narration_audio_url | 旁白 URL |
| sfx_audio_url | 音效 URL |
| audio_duration_ms | 音频时长 |

### assets 表

**API**: `GET /api/projects/{project_id}/assets` → `{ success, assets: [...] }`
**DAO**: `dao_asset.py`

| 关键字段 | 说明 |
|----------|------|
| asset_id | PK |
| project_id | 所属项目 |
| episode_id | 所属集 |
| asset_type | character / scene / prop |
| name | 资产名 |
| description | 描述 |
| thumbnail_url | 缩略图（**必须是 `/storage/...` 路径，禁止 data URL**） |
| reference_images | JSONB 参考图列表（**必须是 `/storage/...` 路径，禁止 data URL**） |
| style_params | JSONB 风格参数 |
| tags | 标签 |
| entity_files | (API 内嵌) | 非数据库列。`GET /api/.../assets` 通过 JOIN files 表动态填充。含 `file_id`, `file_url`, `file_type`, `file_role`, `is_selected`, `created_at` |

### 资产图片数据流（2026-04-04 统一后）

```
写入链路（AI 生图 / 上传）:
  cluster_main.py (Gemini/Doubao)
    → file_service.save_generated_file_to_db()
    → files 表写入 (entity_type=asset, file_role=reference_image)
    → _sync_legacy_on_file_create() → assets.reference_images 追加 URL
  前端 → await reload() → EpisodeContext 刷新 assets（含 entity_files）

读取链路（所有页面统一）:
  GET /api/projects/{pid}/assets
    → AssetDAO.get_by_project() + EntityFileDAO.get_files_for_entities()
    → 返回 assets[] 每个含 entity_files[]
  EpisodeContext.loadSlices('assets')
    → normalizeAsset() → AssetItem { entityFiles: [...] }
    → assetsToMaterialLibrary(assets)
        → 优先 entityFiles.filter(role=reference_image)
        → 降级 referenceImages[]
    → MaterialPage / GenerationPage / DesignPage / AudioStage 统一消费
```

---

## 2. 后端 API 端点映射

### 2.1 图片生成 — 直连 API（✅ 已调用 save helper）

| 路径 | Request 模型 | 返回格式 |
|------|-------------|----------|
| `POST /api/gemini/image` | `GeminiImageRequest` + entity 字段 | `{images: [dataURL], files: [{data_url, file_id, file_url}]}` |
| `POST /api/materials/doubao` | `DoubaoImageRequest` + entity 字段 | `{success, images: [...], files: [{data_url, file_id, file_url}]}` |
| `POST /api/generate/multi-grid-storyboard` | `MultiGridStoryboardRequest` + entity 字段 | `{success, images: [...], files: [{data_url, file_id, file_url}]}` |

> 返回双格式：`images` 保持向后兼容（data URL），`files` 包含持久化 file_id/file_url。

### 2.2 图片/视频生成 — ComfyUI Worker 路径（✅ 已透传 entity 字段）

| 路径 | Request 模型 | task_type |
|------|-------------|-----------|
| `POST /api/generate/comfyui-workflow` | `ComfyUIWorkflowRequest` | qwen/kontext/qwenN/... |
| `POST /api/generate` | `GenerateRequest` | i2v/morph/upscale/voice/wan26_i2v |
| `POST /api/generate/image` | `ImageGenerationRequest` | i2i_fj |
| `POST /api/generate/angle-adjust` | `AngleAdjustRequest` | i2i_fj |
| `POST /api/generate/human-multi-angle` | `HumanMultiAngleRequest` | i2i_human |
| `POST /api/generate/around-angle` | `AroundAngleRequest` | i2i_around |
| `POST /api/generate/matting` | `MattingRequest` | matting_subject/matting_split |
| `POST /api/generate/image-fusion` | `ImageFusionRequest` | image_fusion/image_transfer/pose_imitation |
| `POST /api/generate/panorama-360` | `Panorama360Request` | panorama_360 |
| `POST /api/generate/panorama-fusion` | `PanoramaFusionRequest` | panorama_fusion_1/3 |
| `POST /api/generate/auto-storyboard` | `AutoStoryboardRequest` | auto_storyboard |
| `POST /api/materials/process` | `MaterialProcessRequest` | upscale_hd/remove_watermark/three_view |

**所有 Request 模型已包含的 entity 字段**:
```python
entity_type: Optional[str] = Field(None)
entity_id: Optional[str] = Field(None)
file_role: Optional[str] = Field(None)
episode_id: Optional[str] = Field(None)
```

**Worker 保存链**:
```
ComfyUI 完成 → worker._save_result_file()
  → 下载文件 → WebP 无损转换 → 本地持久化
  → FileDAO.create_file(entity_type, entity_id, file_role) → files 表
  → 返回 {filename, file_id, url, size}
```

### 2.3 音频生成（✅ 已调用 save helper）

| 路径 | Request 模型 | 说明 | 返回新增字段 |
|------|-------------|------|-------------|
| `POST /api/minimax/tts` | `MinimaxTTSRequest` + entity 字段 | TTS 配音 | `file_id, file_url` |
| `POST /api/audio/generate-speech` | `SpeechGenRequest` + entity 字段 | Gemini 语音 | `file_id, file_url` |
| `POST /api/audio/generate-sfx` | `SFXGenRequest` + entity 字段 | 音效 | `file_id, file_url` |
| `POST /api/audio/generate-music` | `MusicGenRequest` + entity 字段 | 音乐 | `file_id, file_url` |
| `POST /api/minimax/music` | `MinimaxMusicRequest` + entity 字段 | MiniMax 音乐 | `file_id, file_url` |

### 2.4 Entity Files API

| 路径 | 方法 | 说明 |
|------|------|------|
| `GET /api/entity-files` | GET | 查询实体关联文件 |
| `POST /api/entity-files/link` | POST | 关联文件到实体（逐步废弃） |
| `PUT /api/entity-files/{file_id}/select` | PUT | 选定文件 |
| `DELETE /api/entity-files/{file_id}` | DELETE | 删除文件 |
| `POST /api/entity-files/upload` | POST | 上传文件 + 关联实体（✅ 新增） |
| `POST /api/entity-files/migrate` | POST | 一键迁移孤儿文件到 entity 关联 |
| `GET /api/user-files` | GET | 按当前用户列举 `files` 表（`file_type` / `limit` / `offset` 查询参数；HistoryPage 列表） |

### 2.5 SSE 推送（✅ 已包含 entity 信息）

```
Redis Pub/Sub "task_complete:{username}" payload:
{
  type, task_id, status, task_type, display_name, project_id, source_page,
  entity_type, entity_id, file_role, episode_id   ← 已添加
}
```

---

## 3. 前端 Service 层映射

### 3.1 service → API 调用（✅ 已完成改造）

| Service 文件 | 函数 | 调用 API | 返回类型 |
|-------------|------|---------|----------|
| `geminiImageService.ts` | `generateGeminiImageViaProxy` | POST `/api/gemini/image` | `GeneratedFileResult[]` |
| `doubaoService.ts` | `generateDoubaoImages` | POST `/api/materials/doubao` | `GeneratedFileResult[]` |
| `geminiService.ts` | `generateWithComfyUIWorkflow` | POST `/api/generate/comfyui-workflow` | `{taskId}` + entity 透传 |
| `geminiService.ts` | `generateWithComfyUIWorkflowQueued` | 同上（队列封装） | `GeneratedImageResult[]` |
| `geminiService.ts` | `generateFinalIllustration` | 经 `geminiImageService` | `string`（URL） |
| `geminiService.ts` | `generateMultiGridStoryboard` | POST `/api/generate/multi-grid-storyboard` | `GeneratedFileResult[]` |
| `entityFileService.ts` | `fetchEntityFiles` | GET `/api/entity-files` | `{items: EntityFile[], total}` |
| `entityFileService.ts` | `selectEntityFile` | PUT `/api/entity-files/{id}/select` | `EntityFile` |
| `entityFileService.ts` | `deleteEntityFile` | DELETE `/api/entity-files/{id}` | void |
| `entityFileService.ts` | `linkEntityFile` | POST `/api/entity-files/link` | `EntityFile`（逐步废弃） |
| `entityFileService.ts` | `uploadEntityFile` | POST `/api/entity-files/upload` | `{fileId, fileUrl}` |
| `entityFileService.ts` | `fetchUserFiles` | GET `/api/user-files` | `{items: EntityFile[], total}` |

### 3.2 GeneratedFileResult 标准类型

```typescript
interface GeneratedFileResult {
    url: string;       // 可显示的 URL（data URL 或 file URL）
    fileId?: string;   // files 表 ID（后端已保存）
    fileUrl?: string;  // 持久化 file URL（/storage/...）
}
```

### 3.3 GeneratedImageResult（ComfyUI Worker 返回）

```typescript
interface GeneratedImageResult {
    url: string;       // /storage/... 持久化路径
    fileId: string | null;  // files 表 ID
}
```

### 3.4 EntityFile 类型

```typescript
interface EntityFile {
    fileId: string;
    fileUrl: string;
    fileType: string;      // image / audio / video
    fileRole: string;      // generated_image / reference_image / dialogue_audio
    isSelected: boolean;
    createdAt: string;
    metadata?: Record<string, unknown>;
}
```

---

## 4. 页面 → Service → API 数据流

### StoryboardGenPage（画面分镜）

```
用户点击"生成" → GenerationPage.generateForShot()
  → geminiService.generateWithComfyUIWorkflowQueued(
      workflowType, prompt, images, refs, seed, onTaskId,
      { entityType: 'storyboard_item', entityId: shot.id, fileRole: 'generated_image', episodeId }
    )
  → POST /api/generate/comfyui-workflow（body 含 entity 字段）
  → Worker 生成 → _save_result_file → FileDAO.create_file (含 entity 关联)
  → SSE task_complete {entity_type, entity_id, episode_id}
  → useSSEInvalidation → invalidateQueries(['entityFiles', 'storyboard_item', entityId])
  → StoryboardGenPage.useQueries 自动重新获取 → entityImages 更新 → enhancedFile 重算 → 渲染
```

**StoryboardGenPage 关键数据结构**:
```typescript
// useQueries 为每个分镜条获取 entity files
const entityImageQueries = useQueries({
  queries: storyboardItems.map(item => ({
    queryKey: ['entityFiles', 'storyboard_item', item.itemId, 'generated_image'],
    queryFn: () => fetchEntityFiles('storyboard_item', item.itemId, 'generated_image'),
  })),
});

// entityImages: Record<itemId, GeneratedImage[]>
// enhancedFile: pseudoFile + entityImages 合并显示
```

### DesignPage（角色/场景设计）

```
用户上传图片 → handleUploadImage()
  → uploadEntityFile(file, 'asset', assetId, 'reference_image', episodeId)
  → POST /api/entity-files/upload → save_generated_file_to_db → files 表
  → 返回 {fileId, fileUrl}（/storage/... 路径）
  → getAssets() 获取最新数据 → updateAsset({ reference_images: [...existing, fileUrl] })

用户 AI 生成 → handleAIGeneration()
  → doubaoService / geminiService
  → 后端 save_generated_file_to_db → files 表
  → 返回 GeneratedFileResult[] → 使用 r.fileUrl || r.url（优先持久化路径）
  → getAssets() 获取最新数据 → updateAsset({ reference_images: [...existing, ...urls] })
```

### AudioStagePage（配音）

```
用户点击"配音" → apiService.minimaxTTS()
  → POST /api/minimax/tts {entity_type: 'storyboard_item', entity_id, file_role: 'dialogue_audio'}
  → save_generated_file_to_db(file_type='audio') → files 表
  → 返回 {audio_url, file_id, file_url}

用户点击"添加台词" → onTextPersist(itemId, speaker, '（请输入台词）')
  → 保存占位文本（非空字符串，确保 clips 构建器能识别并渲染输入框）
```

### HistoryPage（历史生成图片）

- **数据来源**：`fetchUserFiles()` → `GET /api/user-files` → `files` 表（按当前用户筛选）。
- **删除**：`deleteEntityFile(fileId)` → `DELETE /api/entity-files/{file_id}` → 软删除 `files` 记录（`is_deleted`）。
- **进行中任务**：与上述列表解耦；独立模块仍从 `GET /api/tasks?status=processing,queued` 读取。

---

## 5. React Query 标准 Hooks

| Hook | queryKey | 数据源 | 文件位置 |
|------|----------|--------|---------|
| `useEntityFilesQuery(entityType, entityId, fileRole)` | `['entityFiles', entityType, entityId, fileRole]` | `fetchEntityFiles()` | `hooks/useEntityFilesQuery.ts` |
| `useStoryboardItems(episodeId)` | `['storyboardItems', episodeId]` | `getStoryboardItems()` | `hooks/useEpisodeData.ts` |
| `useAssets(projectId, episodeId)` | `['assets', projectId, episodeId]` | `getAssets()` | `hooks/useEpisodeData.ts` |
| `useVideoSegments(episodeId)` | `['videoSegments', episodeId]` | `getVideoSegments()` | `hooks/useEpisodeData.ts` |
| `useScript(episodeId)` | `['script', episodeId]` | `getEpisodeScript()` | `hooks/useEpisodeData.ts` |

| Mutation Hook | 操作 | 自动失效 queryKey | 文件位置 |
|--------------|------|------------------|---------|
| `useSelectFileMutation` | 选定文件 | `['entityFiles', entityType, entityId]` | `hooks/useFilesMutation.ts` |
| `useDeleteFileMutation` | 删除文件 | `['entityFiles', entityType, entityId]` | `hooks/useFilesMutation.ts` |
| `useUploadFileMutation` | 上传文件 | `['entityFiles', entityType, entityId]` | `hooks/useFilesMutation.ts` |
| `useSaveStoryboardItem` | 更新分镜 | `['storyboardItems', episodeId]` | `hooks/useEpisodeData.ts` |

**QueryClient 配置**（`App.tsx`）:
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: true, retry: 2 },
  },
});
// 外层: QueryClientProvider → SSEInvalidationProvider → BrowserRouter → TaskProvider
```

---

## 6. SSE → 缓存失效流

```
后端 task_queue.complete_task()
  → redis.publish("task_complete:{username}", {
      type, task_id, task_type, display_name,
      entity_type, entity_id, file_role, episode_id
    })
  → SSE stream → 前端 globalTaskManager.handleSSEMessage()
  → TaskNotification {entityType, entityId, fileRole, episodeId}
  → useSSEInvalidation hook 监听 (hooks/useSSEInvalidation.ts)
  → queryClient.invalidateQueries(['entityFiles', entityType, entityId])
  → queryClient.invalidateQueries(['storyboardItems', episodeId])
  → queryClient.invalidateQueries(['videoSegments', episodeId])
  → 页面自动刷新
```

**SSE 路径**和**HTTP 轮询降级路径**均已支持 entity 字段。
轮询路径：后端 `/api/tasks/notifications` 从 `task_data` 提取 entity 字段返回；
前端 `globalTaskManager.ts` 构建 notification 时包含 `entityType/entityId/fileRole/episodeId`。

---

## 7. Agent 完成路径（远程 ComfyUI Agent）

```
ComfyUI Agent (comfyui_agent.py) 远程处理任务
  → POST /api/agent/complete (agent_routes.py)
  → save_output_file() 保存到磁盘
  → _persist_to_db() 调用 FileDAO.create_file() 关联 entity
  → build_task_result() 构建结果（含 file_id）
  → Redis 更新 + SSE publish（含 entity_type/entity_id/file_role/episode_id）
```

**关键函数**：`agent_routes.py::_persist_to_db(entries, task_id, task_data, user_id)`
- 从 Redis 中读取 task_data 获得 entity_type/entity_id/file_role
- 调用 `dao_content.FileDAO.create_file()` 为每个文件创建 DB 记录
- 更新 entry dict 添加 `file_id` 字段

**与 Worker 路径的一致性**：Worker (`worker.py::_save_result_file`) 和 Agent (`agent_routes.py::_persist_to_db`) 
现在都使用 `dao_content.FileDAO.create_file()` 保存文件，确保 entity 关联一致。

---

## 8. 通用 Save Helper 签名（file_service.py）

```python
# file_service.py
async def save_generated_file_to_db(
    content: bytes,
    file_type: str,           # 'image' | 'audio' | 'video' | 'text'
    user_id: str,
    source: str,              # 'gemini' | 'doubao' | 'minimax' | 'comfyui' | 'upload'
    entity_type: str = None,  # 'storyboard_item' | 'asset' | 'video_segment'
    entity_id: str = None,
    file_role: str = None,    # 'generated_image' | 'dialogue_audio' | ...
    original_ext: str = '.png',
    is_selected: bool = False,
    episode_id: str = None,
) -> dict:  # { file_id, file_url, file_path }
```

- 使用 `dao_content.FileDAO.create_file()`（已支持 entity 字段）
- 图片自动转 WebP（lossless）
- DB 写入失败时降级返回（file_id=None，文件仍在磁盘）

---

## 9. Base64 Data URL 规范

### 原则

**不存储 base64 data URL 到数据库**。所有图片/音频/视频必须先上传到服务器，获得 `/storage/...` 路径后再存储。

### 已修复的 data URL 入口点

| 位置 | 原行为 | 修复后 |
|------|--------|--------|
| `DesignPage.handleUpload` | `readAsDataURL(file)` → 存入 `reference_images` | 调用 `uploadEntityFile()` → 存 `/storage/...` URL |
| `DesignPage.handleAIGeneration` | `r.url`（可能为 data URL） | `r.fileUrl \|\| r.url` 优先使用持久化 URL |
| `DesignPage.handleBatchGenerate` | 同上 | 同上 |
| `DesignPage.handleCameraGenerate` | 闭包中 `assets` 可能过时 | 更新前 `getAssets()` 获取最新数据 |
| `DesignPage.handleProcessSubmit` | 同上 | 同上 |
| `HistoryPage` | 列表：`fetchUserFiles` → `GET /api/user-files` → `files` 表；缩略图曾用 `GET /api/thumbnail?url=${data:image...}` 导致 414 | data URL 直接返回不走缩略图代理；删除用 `deleteEntityFile` → 软删除 `files` |

### 仍使用 data URL 的合法场景（无需修改）

| 场景 | 说明 |
|------|------|
| ComfyUI 上传链 | `ensureDataUrl()` → `uploadImageToComfyUI()` → 转为 filename 后才发送 |
| Gemini/Doubao `references` 参数 | POST body 中发送，无 URL 长度限制 |
| 前端 `<img src>` 临时显示 | 仅用于预览，不持久化 |
| `generateThumbnail()` 内存压缩 | webp data URL 用于快速预览（不再存入 DB） |

### GeneratedFileResult 使用规则

```typescript
// 存储到数据库时：优先使用 fileUrl
const urlToStore = result.fileUrl || result.url;

// 前端展示时：可使用任一
const urlToDisplay = result.url;
```

### assets 更新模式

```typescript
// DesignPage 更新 reference_images 前，始终获取最新数据（避免闭包覆盖）
const freshData = await getAssets(projectId!, episodeId);
const freshAsset = freshData.assets.find(a => a.assetId === targetId);
const existing = freshAsset?.referenceImages || [];
await updateAsset(targetId, { reference_images: [...existing, newUrl] });
```

---

## 10. 前端关键约定

### GeneratedImage ID 规则

```typescript
// GenerationPage 创建 GeneratedImage 时，id 必须使用 fileId
const newImage: GeneratedImage = {
    id: r.fileId || uuidv4(),   // ← 优先使用 fileId，确保与 entity files 查询结果一致
    url: r.url,
    thumbnail: r.url,
    timestamp: Date.now(),
    fileId: r.fileId || undefined,
};
```

**原因**：StoryboardGenPage 的 `entityImages` 中图片使用 `id: ef.fileId`。
如果 GenerationPage 使用 `id: uuidv4()`，删除逻辑会因 ID 不匹配而误删所有 entity files。

### StoryboardGenPage 删除逻辑

```typescript
// 自动删除已移除（2026-04-03），改为 GenerationPage 手动删除：
// handleDeleteResult(imgId) → deleteEntityFile(fileId) → DB 软删除
// 不再在 handleUpdateStoryboardItem 中自动比对删除
```

### GenerationPage → StoryboardGenPage 回调模式

```typescript
// 追加生成：合并已有图片 + 新图片（不替换）
const existingImages = shot.generatedImages || [];
const mergedImages = [...existingImages, ...newImages];
onUpdateStoryboardItem(shot.id, {
    generatedImages: mergedImages,
    selectedImageId: newImages[0].id,
    generatedImage: resultUrl,
});
// handleUpdateStoryboardItem 内部:
// 1. 立即存入 localImagesRef（本地缓存）→ 图片马上显示
// 2. invalidateQueries 触发 entity files 异步刷新
// 3. 当 DB 数据到达后，enhancedFile 优先使用 DB 数据，清除本地缓存

// 删除：调用 deleteEntityFile(fileId) → DB 软删除 + 前端状态移除
```

### StoryboardGenPage 图片三源合并（安全网）

```typescript
// enhancedFile 合并优先级（三源去重，按 URL 去重）:
//   1. entityImages (DB entity files, 来自 React Query) ← 首选
//   2. localImagesRef (本地缓存) ← DB 未同步时的安全网
//   3. item.generatedImage (generated_image_url 历史兜底) ← 旧图最后防线
// localImagesRef 仅在 DB 数据量 >= 本地缓存时才清除
```

### GenerationPage 上传图片

```typescript
// 必须使用 uploadEntityFile 而非 readAsDataURL
const saved = await uploadEntityFile(file, 'storyboard_item', shotId, 'generated_image', episodeId);
const newImage: GeneratedImage = {
    id: saved.fileId || uuidv4(),
    url: saved.fileUrl,
    fileId: saved.fileId || undefined,
};
// 不允许: reader.readAsDataURL(file) → url: dataUrl
```

### Base64 与 URL 路径策略（2026-04-02 更新）

| 场景 | 前端传什么 | 后端做什么 |
|------|-----------|-----------|
| 参考图片上传 | `uploadEntityFile()` → `/storage/...` URL | 存储文件，返回路径 |
| Gemini API 生图 | 传 `/storage/...` URL | 后端从磁盘读取 → base64 → 发给 Gemini |
| Doubao API 生图 | 传 `/storage/...` URL | `data_url_to_base64()` 从磁盘读取 → base64 |
| ComfyUI 上传 | 传 `/storage/...` URL | `uploadImageToComfyUI` 下载 blob → FormData |

**核心规则**：前端永远不传 base64 字符串（太大，可能截断）。需要 base64 的 API（Gemini/Doubao）由后端自行从磁盘读取转换。

```python
# cluster_main.py: data_url_to_base64 支持 /storage/ 路径
def data_url_to_base64(data_url: str) -> str:
    if data_url.startswith('/storage/'):
        file_path = Path('persistent_storage') / data_url.replace('/storage/', '', 1)
        return base64.b64encode(file_path.read_bytes()).decode('utf-8')
    # ... 原有 data: 处理逻辑

# cluster_main.py: /api/gemini/image 参考图处理
for ref in request.references[:5]:
    if ref.startswith('data:'):  # 兼容旧格式
        ...
    elif ref.startswith('/storage/'):  # 新格式：从磁盘读取
        file_path = Path('persistent_storage') / ref.replace('/storage/', '', 1)
        img_bytes = file_path.read_bytes()
        b64_data = base64.b64encode(img_bytes).decode('utf-8')
```

**已清理的前端函数**：
- `DesignPage.ensureDataUrl()` — 不再调用，参考图直接传 URL
- `MaterialPage.ensureDataUrl()` — 不再调用
- `MaterialPage.downloadImageAsDataUrl()` — 不再调用
- `GenerationPage.handleFileUpload` — 改用 `uploadEntityFile()`
- `MaterialPage.handleFileUpload` — 改用 `uploadEntityFile()`

### 跨页面数据联通链路（2026-04-03 审计）

| # | 转换 | 数据 | 写入方式 | 读取方式 | 同步机制 | 状态 |
|---|------|------|---------|---------|---------|------|
| 1 | 剧本→设计 | script文本→assets | `episode_scripts`表 | `assets`表 via Context | 无关(纯文本) | 正常 |
| 2 | 设计→素材 | 参考图片 | `files`表(entity绑定) | `asset.referenceImages`(旧字段) | `_sync_legacy_on_file_create` 自动追加 | **已修复** |
| 3 | 素材→配音 | bound_assets标签 | `storyboard_items` | 同字段 via Context | 同字段 | 正常 |
| 4 | 配音→分镜 | 音频URL | 双写(files+legacy) | 旧字段 + entity files | `_sync_legacy_url` + `_sync_legacy_on_file_create` | 正常 |
| 5 | 分镜→视频 | 生成图+prompt | 双写(files+legacy) | 旧字段 | `_sync_legacy_url` | 正常 |
| 6 | 视频→美化 | 视频文件 | workspace session | `video_segments`表 | `_sync_legacy_on_file_create` (需传entity) | 待验证 |

**`_sync_legacy_on_file_create`**（`file_service.py`）：文件创建时自动同步旧字段，覆盖：
- `asset` + `reference_image` → 追加到 `assets.reference_images` JSON数组
- `storyboard_item` + `generated_image`/`dialogue_audio`/`narration_audio`/`sfx` → 更新对应 URL 字段
- `video_segment` + `video`/`video_thumbnail` → 更新对应 URL 字段

### assetsToMaterialLibrary 素材合并

```typescript
// episodeAdapters.ts — 合并 referenceImages + thumbnailUrl（去重）
// 与 DesignPage 显示逻辑一致，避免 DesignPage 显示2张而 MaterialPage 只显示1张
const allUrls = [...refs];
if (asset.thumbnailUrl && !allUrls.includes(asset.thumbnailUrl)) {
    allUrls.unshift(asset.thumbnailUrl);
}
```

### 素材绑定级联（MaterialPage / `bound_assets`）

- **绑定**：`handleBindMaterial` 会**自动向后级联**到尚未绑定该素材的后续镜头；若某镜头**已有**该角色的绑定则**不覆盖**（表现为「绑了镜头2但后面镜头没跟」时，需先解绑后续镜头上的旧绑定）。
- **解绑**：弹窗确认是否**级联解绑**（用户选择是否一并清除后续镜头上的同素材绑定）。

### DubbingPanel 添加台词

```typescript
// 点击"添加台词"时保存占位文本，避免空文本导致的死循环
onTextPersist(item.itemId, speaker, '（请输入台词）');
// 空文本 → clips 构建器跳过 → DubbingCard 不渲染 → 无输入框 → 死循环
```
