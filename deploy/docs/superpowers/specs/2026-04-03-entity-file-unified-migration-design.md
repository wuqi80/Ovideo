# Entity-File 统一迁移设计

## 背景

项目存在两套互相冲突的数据架构：

**架构 A（Entity-File，新，正确）**：生成内容写入 `files` 表并绑定 entity，前端通过 `useEntityFilesQuery` (React Query) 读取，SSE 通知自动 cache invalidation。已用于 StoryboardGenPage 主路径（ComfyUI + Gemini）和所有 upload 路径。

**架构 B（Legacy 字段，旧，有缺陷）**：生成内容写入 `files` 表但不绑定 entity（orphan 记录），前端手动维护 legacy 列（如 `asset.referenceImages`、`storyboardItem.dialogueAudioUrl`），用 `getAssets() → updateAsset()` 手动追加。已确认导致 DesignPage 生图替换 bug（snake_case/camelCase 不匹配导致旧图丢失）。

**后端能力**：所有生成 API（Gemini、Doubao、ComfyUI、TTS、视频）的 Request 模型都已包含 `entity_type`、`entity_id`、`file_role`、`episode_id` 可选字段。`save_generated_file_to_db()` 会将这些字段写入 `files` 表。问题主要在前端：大部分页面不传 entity 信息，且用 legacy 字段展示。VideoPage 的 `videoService.ts` 需补充 entity 字段透传。

## 目标

将所有内容生成路径统一到 Entity-File 架构，消除双源不同步问题。

## 审计结果

| 页面 | 生成路径 | 传 entity? | 展示来源 | 问题 |
|------|---------|-----------|---------|------|
| DesignPage | Gemini/Doubao AI 生图、角度调整、处理 | 不传 | `asset.referenceImages` | 已出现替换 bug |
| GenerationPage 工具链 | 多角度/抠图/融合/全景等 10+ 工具 | 不传 | 本地 state | orphan 文件 |
| MaterialPage | AI 素材/三视图/角度 | 不传 | 内存 `materialLibrary` | orphan 文件 |
| AudioStagePage | MiniMax TTS / Gemini Speech | 不传 | `storyboardItem.dialogueAudioUrl` | 双源不同步 |
| VideoPage | 视频生成 | 不传 | session + task 状态 | 独立体系 |
| StoryboardGenPage 主路径 | ComfyUI + Gemini | **传** | `useEntityFilesQuery` | 正常 (参照) |

---

## 统一数据流

迁移后所有生成路径遵循同一模式：

```
前端触发生成（传递 entityType + entityId + fileRole + episodeId）
  ↓
后端 API 处理
  ↓ save_generated_file_to_db() → files 表 INSERT（带 entity 绑定）
  ↓ 同步返回 {fileId, fileUrl} 或 异步 SSE 通知
前端接收
  ↓ queryClient.invalidateQueries({ queryKey: ['entityFiles', entityType, entityId] })
  ↓ 使用前缀匹配 invalidation：前三段 key 匹配即可刷新该 entity 下所有 fileRole
React Query 自动 refetch
  ↓ useEntityFilesQuery(entityType, entityId, fileRole) — queryKey 为四段
UI 自动更新（无需手动追加、无需 updateAsset）
```

---

## 共享基础设施

### useGenerateToEntity hook

新建 `new_html/hooks/useGenerateToEntity.ts`，统一封装生成调用：

```typescript
function useGenerateToEntity(entityType: string, entityId: string) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(async <T>(
    generatorFn: () => Promise<T>
  ): Promise<T> => {
    setIsGenerating(true);
    try {
      const result = await generatorFn();
      queryClient.invalidateQueries({ queryKey: ['entityFiles', entityType, entityId] });
      return result;
    } finally {
      setIsGenerating(false);
    }
  }, [entityType, entityId, queryClient]);

  return { generate, isGenerating };
}
```

### Entity 参数映射

| 页面 | entityType | entityId | fileRole |
|------|-----------|----------|----------|
| DesignPage | `'asset'` | assetId | `'reference_image'` |
| StoryboardGen 主路径 | `'storyboard_item'` | itemId | `'generated_image'` (已完成) |
| GenerationPage 工具链 | `'storyboard_item'` | itemId | `'generated_image'` |
| MaterialPage AI 生图 | `'asset'` | assetId | `'material_image'` |
| AudioStagePage | `'storyboard_item'` | itemId | `'dialogue_audio'` / `'narration_audio'` |
| VideoPage | `'video_segment'` | segmentId | `'video'` / `'video_thumbnail'` |

### file_role 与 `_sync_legacy_url` 对照表

后端 `_sync_legacy_url` 负责在 select 文件时同步更新旧业务表字段。以下对照确保 file_role 命名一致：

| entity_type | file_role | legacy 表.列 |
|-------------|-----------|-------------|
| `storyboard_item` | `generated_image` | `storyboard_items.generated_image_url` |
| `storyboard_item` | `dialogue_audio` | `storyboard_items.dialogue_audio_url` |
| `storyboard_item` | `narration_audio` | `storyboard_items.narration_audio_url` |
| `storyboard_item` | `sfx` | `storyboard_items.sfx_audio_url` |
| `asset` | `asset_thumbnail` | `assets.thumbnail_url` |
| `asset` | `reference_image` | 无 legacy 同步（新角色） |
| `asset` | `material_image` | 无 legacy 同步（新角色） |
| `video_segment` | `video` | `video_segments.video_url` |
| `video_segment` | `video_thumbnail` | `video_segments.thumbnail_url` |

> **约定**：文档中 API/DB 字段使用 `snake_case`，前端 JS 对象属性使用 `camelCase`。

### Legacy 字段迁移策略

- 迁移后**不再写入** legacy 字段（`referenceImages`、`generated_image_url`、`dialogue_audio_url` 等）
- 保留 legacy 字段读取作为**迁移过渡兜底**：如果 `useEntityFilesQuery` 返回空但 legacy 字段有值，显示 legacy 数据
- 编写数据库迁移脚本将现有 legacy 数据导入 files 表并绑定 entity
- `_sync_legacy_url` 继续运行，确保 `asset.thumbnailUrl` 等快速缩略图字段在 select 时同步

---

## Phase 1: DesignPage 迁移

**优先级**：最高（有活跃 bug）

### 当前问题

`handleAIGeneration` 流程：
1. 调用 `generateGeminiImageVariant()` — 不传 entity 信息
2. 手动 `getAssets()` → 读 `freshAsset.referenceImages`（snake_case bug）→ `updateAsset({reference_images: [...existing, ...urls]})`
3. 调用 `reload()` 刷新

### 迁移后流程

1. 调用 `generateGeminiImageVariant({..., entityType: 'asset', entityId: assetId, fileRole: 'reference_image', episodeId})`
2. 后端自动保存到 files 表并绑定 entity
3. `invalidateQueries(['entityFiles', 'asset', assetId])` → React Query 自动刷新
4. 不再调用 `updateAsset({reference_images: ...})`

### 改动文件

- `pages/DesignPage.tsx`
  - `handleAIGeneration`：传 entity 参数，移除 `getAssets()`/`updateAsset()` 逻辑
  - `handleCameraGenerate`：同上
  - `handleProcess`：同上
  - `handleUpload`：已传 entity（无需改）
  - 批量生成：传 entity 参数
  - 图片展示区：从 `asset.referenceImages` 改为 `useEntityFilesQuery('asset', assetId, 'reference_image')`
  - 选图：`useSelectFileMutation()`
  - 删图：`useDeleteFileMutation()`
  - 兜底：`asset.referenceImages` 有值但 files 表无数据时显示 legacy

---

## Phase 2: GenerationPage 工具链迁移

**优先级**：中

### 当前问题

`adjustImageAngleQueued`、`generateHumanMultiAngleQueued`、`generateMattingQueued`、`generateImageFusionQueued` 等 10+ 工具函数都不传 entity 信息，结果 orphan 在 files 表中。

### 迁移后流程

所有工具函数传递 `entityType: 'storyboard_item', entityId: itemId, fileRole: 'generated_image', episodeId`（`itemId` 即分镜项 ID，代码中有时也用 `shotId` 变量名指代）。结果自动通过 SSE → cache invalidation 或同步 invalidateQueries 刷新到 StoryboardGenPage 的图片列表。

### 本地缓存与 files 表的合并策略

- **即时显示保留**：生成触发后立即将临时 URL 加入 `localImagesRef`（本地缓存），用户无需等待 DB 查询
- **DB 刷新后合并**：`invalidateQueries` 触发 refetch 后，`useEntityFilesQuery` 返回的 files 表数据为权威来源
- **去重与替换**：当 files 表数据到达后，以 `fileUrl` 去重，丢弃本地缓存中已存在于 files 表的条目
- **最终状态**：UI 展示 = files 表数据（优先）+ 尚未入库的本地临时数据

### 改动文件

- `components/GenerationPage.tsx`
  - 所有 `*Queued` 函数增加 entity 参数透传
  - 本地缓存 `localImagesRef` 保留用于即时显示，但不再作为持久数据源
  - 移除手动写入 `storyboardItem` legacy 字段的逻辑
- `services/geminiService.ts`
  - `adjustImageAngle` 等函数的 request body 已有 entity 字段，只需前端传入

---

## Phase 3: MaterialPage 迁移

**优先级**：中

### 当前问题

MaterialPage 的 AI 素材生成（`handleMaterialAIGeneration`）、三视图、角度调整都不传 entity 信息。生成结果通过 `onUpdateLibrary` 写入内存的 `materialLibrary`，不持久化到 files 表。

### 迁移后流程

- AI 素材生成传递 `entityType: 'asset', entityId: assetId, fileRole: 'material_image'`
- 生成完成后 `invalidateQueries(['entityFiles', 'asset', assetId])`
- `materialLibrary` 的构建增加一个数据源：除了从 `asset.referenceImages` 读取外，也从 `useEntityFilesQuery('asset', assetId, 'material_image')` 读取
- 长期目标：`materialLibrary` 完全从 files 表构建

### 改动文件

- `components/MaterialPage.tsx`
  - `handleMaterialAIGeneration`：传 entity 参数
  - `handleThreeViewGeneration`：传 entity 参数
  - `handleCameraGeneration`：传 entity 参数
- `pages/MaterialsPage.tsx`
  - `materialLibrary` 构建逻辑增加 files 表数据源

---

## Phase 4: AudioStagePage 迁移

**优先级**：低

**范围**：本 Phase 仅覆盖对白（`dialogue_audio`）和旁白（`narration_audio`）。`sfx`（音效）和 `background_music`（背景音乐）如需接入，后续独立 Phase 处理。

### 当前问题

TTS 生成（`minimaxTTS`、`generateSpeech`）不传 entity 信息。结果通过 `setLocalAudio` 写入本地状态，然后 `apiUpdateStoryboardItem({dialogue_audio_url: url})` 写入 legacy 字段。

### 迁移后流程

- TTS 调用传递 `entityType: 'storyboard_item', entityId: itemId, fileRole: 'dialogue_audio'`（或 `narration_audio`）
- 后端自动保存到 files 表
- 播放 URL 从 `useEntityFilesQuery('storyboard_item', itemId, 'dialogue_audio')` 获取最新选定文件
- 保留 `storyboardItem.dialogueAudioUrl` 作为兜底

### 改动文件

- `pages/AudioStagePage.tsx`
  - TTS 调用增加 entity 参数
  - 播放 URL 读取逻辑改为优先从 files 表
- `components/audio/DubbingCard.tsx`
  - 播放 URL prop 来源变更

---

## Phase 5: VideoPage 迁移

**优先级**：低

### 当前问题

视频生成（`submitTask`）不传 entity 信息。结果通过 task 状态轮询 + session 管理展示。

### 迁移后流程

- `submitTask` 传递 `entityType: 'video_segment', entityId: segmentId, fileRole: 'video'`（缩略图使用 `'video_thumbnail'`，与后端 `_sync_legacy_url` field_map 一致）
- 视频结果展示来源优先级：
  1. `useEntityFilesQuery('video_segment', segmentId, 'video')` — files 表数据（权威）
  2. task 状态轮询返回的 URL — 即时显示（生成中/刚完成）
  3. session 存储 — 工作区状态保留（不冲突，用于 UI 布局恢复）
- 当 files 表有数据时，以 files 表为准；task/session 数据仅作为 files 入库前的临时展示

### 改动文件

- `components/VideoPage.tsx`
  - `submitTask` 增加 entity 参数（`entity_type`, `entity_id`, `file_role`, `episode_id`）
  - 视频结果展示逻辑改为三级优先级合并
- `services/videoService.ts`
  - request body 增加 entity 字段透传（当前 Request 模型已有可选字段，需前端实际传入）

---

## 数据库迁移脚本

**复用现有脚本** `migrate_existing_files.py`，该脚本已完整实现 legacy → Entity-File 迁移。

### 现有覆盖范围

| 函数 | 迁移来源 | entity_type | file_role |
|------|---------|-------------|-----------|
| `migrate_storyboard_items()` | `generated_image_url` | `storyboard_item` | `generated_image` |
| | `dialogue_audio_url` | `storyboard_item` | `dialogue_audio` |
| | `narration_audio_url` | `storyboard_item` | `narration_audio` |
| | `sfx_audio_url` | `storyboard_item` | `sfx` |
| `migrate_assets()` | `thumbnail_url` | `asset` | `asset_thumbnail` |
| | `reference_images[]` | `asset` | `reference_image` |
| `migrate_video_segments()` | `video_url` | `video_segment` | `video` |
| | `thumbnail_url` | `video_segment` | `video_thumbnail` |
| `recover_orphan_files()` | 无 entity 关联的 files 记录 | 从兄弟记录推断 | 从兄弟记录推断 |

### 幂等性与去重

脚本内置以下机制（`_link_url_to_entity()`）：

- **URL 去重**：先按 `split_part(file_url, '?', 1)` 查找已有 files 记录。找到则 UPDATE entity 信息，找不到才 INSERT
- **可重复执行**：UPDATE 操作幂等，不会产生重复记录
- **`is_selected` 策略**：`reference_images` 数组中第一张设为 `is_selected=true`，其余 `false`；其他字段默认 `true`
- **日志**：每类迁移完成后输出迁移数量

### 运行方式

```bash
python migrate_existing_files.py
```

### 回滚方案

- 迁移前备份 `files` 表：`CREATE TABLE files_backup_YYYYMMDD AS SELECT * FROM files`
- Legacy 字段**不会被修改**，只读保留
- 若需回滚，可按 `created_at` 时间范围筛选删除迁移脚本创建/更新的 files 记录
- 建议在低峰期执行，避免与正常写入冲突

---

## 执行顺序

1. **共享基础设施**：创建 `useGenerateToEntity` hook
2. **Phase 1: DesignPage** — 消除活跃 bug + 验证模式
3. **数据库迁移脚本** — 运行 `migrate_existing_files.py` 将 legacy 数据导入 files 表
4. **Phase 2: GenerationPage 工具链** — 消除 orphan 文件
5. **Phase 3: MaterialPage** — 统一素材管理
6. **Phase 4: AudioStagePage** — 统一音频管理
7. **Phase 5: VideoPage** — 统一视频管理

每个 Phase 独立可部署，完成后即可验证效果。

### 各 Phase 验收标准

| Phase | 验收标准 |
|-------|---------|
| 共享基础设施 | `useGenerateToEntity` hook 可被各页面正常调用；TypeScript 编译无错误 |
| Phase 1 DesignPage | AI 生图后旧图不丢失；图片列表来自 files 表；legacy 兜底正常工作 |
| DB 迁移 | 脚本幂等可重复执行；现有 legacy 数据在 files 表有对应记录；无重复行 |
| Phase 2 GenerationPage | 工具链生成结果自动出现在分镜图片列表中；无 orphan 文件 |
| Phase 3 MaterialPage | AI 素材生成后素材库自动刷新；files 表有对应记录 |
| Phase 4 AudioStagePage | TTS 生成后播放 URL 来自 files 表；Legacy 兜底正常 |
| Phase 5 VideoPage | 视频生成结果在 files 表有记录；视频列表正常展示 |

### 部署说明

每个 Phase 完成后需同步更新 `deploy/new_html` 目录并重新 build。流程：
1. 将修改的前端文件复制到 `deploy/new_html/` 对应路径
2. 在 `deploy/new_html` 下执行 `npm run build`
3. 构建产物输出到 `deploy/dist`

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| legacy 数据丢失 | 迁移脚本 + legacy 字段只读保留，不删除 |
| 迁移期间前后端不一致 | 每个 Phase 独立可部署，兜底读取 legacy |
| files 表查询性能 | 已有 entity_type + entity_id 索引 |
| materialLibrary 结构变化 | 渐进迁移，先增加 files 表数据源再废弃旧源 |
