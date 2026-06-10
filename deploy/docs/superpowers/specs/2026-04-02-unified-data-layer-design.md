# 统一数据层设计：后端 files 表 + React Query 前端缓存

## 问题

当前系统中，数据管理是碎片化的：

- **后端**：22 个生成 API 端点中，只有 ComfyUI Worker 路径会写 `files` 表，且 entity 关联字段为 NULL。Gemini、豆包、DeepSeek、MiniMax TTS 等路径完全不写 `files` 表。
- **前端**：每个页面自己管理数据获取、缓存、保存，模式各异。`useEntityFiles` hook 已存在但无人使用。EpisodeContext 提供 `loadSlices` 但没有缓存失效机制。
- **结果**：刷新丢数据、切换页面丢数据、生成结果不显示等反复出现。

## 目标

1. 所有生成结果在后端完成时已持久化到 `files` 表，包含正确的 entity 关联
2. 前端通过 React Query 统一获取数据，自动缓存、自动刷新
3. SSE 事件触发缓存失效，生成完成时所有相关页面自动更新
4. 新增功能时，只需调用标准 hook，自动获得持久化和缓存能力

## 架构总览

```
用户操作 → 前端调用后端 API → 后端生成 + 保存到 files 表
                                        ↓
                                   SSE 推送 task_complete（含 entity 信息）
                                        ↓
                              React Query invalidateQueries()
                                        ↓
                              useEntityFilesQuery 自动重新获取
                                        ↓
                                    页面显示最新数据
```

两层改造：

- 后端层：所有生成路径统一写入 `files` 表
- 前端层：引入 React Query 作为统一数据获取和缓存层

---

## 后端改造

### 通用保存函数

在 `file_service.py` 中新增 `save_generated_file_to_db()` 函数，各 API 路由 import 调用（不放在 `cluster_main.py` 中，避免该文件继续膨胀）：

```python
async def save_generated_file_to_db(
    content: bytes,
    file_type: str,           # 'image' | 'audio' | 'video' | 'text'
    user_id: str,
    source: str,              # 'gemini' | 'doubao' | 'minimax' | 'deepseek' | 'comfyui' | 'upload'
    entity_type: str = None,  # 'storyboard_item' | 'asset' | 'video_segment'
    entity_id: str = None,
    file_role: str = None,    # 'generated_image' | 'dialogue_audio' | 'generated_text' | ...
    original_ext: str = '.png',
    is_selected: bool = False,
) -> dict:  # { file_id, file_url, file_path }
```

逻辑：

- 图片：解码 → PIL 转 WebP（lossless）→ 存 `persistent_storage/image/{user}/{month}/`
- 音频：直接存 `persistent_storage/audio/{user}/{month}/`
- 视频：直接存 `persistent_storage/video/{user}/{month}/`
- 文本：存 `persistent_storage/text/{user}/{month}/`
- 调用 `FileDAO.create_file()` 写入 `files` 表，含 entity 关联
- 返回 `file_id` + `file_url`

### FileDAO 扩展

当前 `dao_file.py` 的 `FileDAO.create()` 方法的 INSERT 语句不包含 `entity_type`、`entity_id`、`file_role`、`is_selected` 字段。需要扩展：

```python
# dao_file.py - FileDAO.create() 增加参数
@staticmethod
async def create(
    # ... 现有参数 ...
    entity_type: str = None,
    entity_id: str = None,
    file_role: str = None,
    is_selected: bool = False,
) -> Optional[Dict[str, Any]]:
    # INSERT 语句增加 entity_type, entity_id, file_role, is_selected 四个字段
```

注意：`worker.py` 的 `_save_result_file` 方法当前使用的方法名是 `FileDAO.create_file()`（可能是别名或已重命名），需确认实际方法名并统一。

### 错误处理策略

`save_generated_file_to_db()` 的错误处理原则：

- **DB 写入失败时不丢弃生成结果**：API 端点应 `try/except` 包裹 save helper 调用。DB 失败时 log error 并降级返回（仍返回生成结果的 data_url，但 `file_id` 为 null），避免用户丢失生成结果
- **磁盘写入失败**：同上降级处理，返回 data_url 但无 file_url
- **孤立文件**（磁盘有文件但 DB 无记录）：通过已有的定期清理任务处理
- **Worker 路径**：`_save_result_file` 写入失败不 fail 整个 task，但在任务结果 metadata 中标记 `persist_failed: true`，前端可提示用户重试保存

### 需要改造的 API 端点

#### 图片生成（14 个端点）

**ComfyUI Worker 路径** — 任务提交时携带 entity 信息：

- `ComfyUIWorkflowRequest` 和 `GenerateRequest` 添加可选字段 `entity_type`、`entity_id`、`file_role`
- `generate_comfyui_workflow()` 等端点在构建 `task_data` 时写入这三个字段
- Worker `_save_result_file` 已有从 `task_data` 读取 entity 字段的逻辑，无需改动
- 涉及端点：`/api/generate/comfyui-workflow`、`/api/generate`、`/api/generate/angle-adjust`、`/api/generate/human-multi-angle`、`/api/generate/around-angle`、`/api/generate/matting`、`/api/generate/image-fusion`、`/api/generate/panorama-360`、`/api/generate/panorama-fusion`、`/api/generate/auto-storyboard`、`/api/materials/process`

**直连 API 路径** — 调用 save helper 保存结果：

- `/api/gemini/image`：`GeminiImageRequest` 增加 entity 字段，生成后调用 `save_generated_file_to_db()`，返回值增加 `file_id` + `file_url`
- `/api/materials/doubao`：同上
- `/api/generate/multi-grid-storyboard`：同上

#### 音频生成（5 个端点）

- `/api/minimax/tts`：TTS 完成后调用 `save_generated_file_to_db(file_type='audio')`，返回值增加 `file_id`
- `/api/audio/generate-speech`：同上
- `/api/audio/generate-sfx`：同上
- `/api/audio/generate-music`：同上
- `/api/minimax/music`：同上

#### 视频生成

- `/api/generate`（视频类任务）：`GenerateRequest` 已在图片部分添加 entity 字段，视频任务同样透传

#### 文本生成（2 个端点，可暂缓）

- `/api/deepseek/chat`：SSE 流完成后保存完整文本到 `files` 表
- `/api/gemini/text`：同上
- 优先级说明：文本已通过业务表持久化，不会丢失，此步骤主要为统一性

#### 新增端点

- `POST /api/entity-files/upload`：接受文件上传（multipart 或 base64）+ entity 信息，调用 save helper，返回 `file_id` + `file_url`。用于前端拖拽/本地上传场景。

### SSE 扩展

SSE 推送消息需增加 entity 信息，详见前端部分"SSE 推送消息扩展"节。

对于非 Worker 路径（Gemini、豆包等直连 API），API 端点保存文件后直接返回 `file_id`，前端收到响应后在 mutation 的 `onSuccess` 中调用 `queryClient.invalidateQueries()` 即可，不需要 SSE。

### 返回格式兼容

直连 API 端点的返回格式变更：

```json
// 旧格式（保留向后兼容）
{"images": ["data:image/png;base64,..."]}

// 新格式
{"images": [
  {"data_url": "data:image/png;base64,...", "file_id": "xxx", "file_url": "/storage/image/..."}
]}
```

后端同时返回两种格式（新旧并存），确保旧前端代码不会崩溃：

```json
{
  "images": ["data:image/png;base64,..."],
  "files": [
    {"data_url": "data:image/png;base64,...", "file_id": "xxx", "file_url": "/storage/image/..."}
  ]
}
```

- 旧代码读 `images` 数组（`string[]`），行为不变
- 新代码读 `files` 数组（`object[]`），获取 `file_id` + `file_url`
- 所有消费返回值的前端文件需审计并逐个迁移到读 `files` 数组
- 全部迁移完成后，`images` 字段降为可选/移除

---

## 前端改造

### 安装 TanStack Query

```bash
npm install @tanstack/react-query
```

### QueryClient 配置

在 App 根组件中配置 `QueryClientProvider`：

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // 30秒内数据视为新鲜
      gcTime: 5 * 60_000,       // 5分钟后垃圾回收
      refetchOnWindowFocus: true, // 切回浏览器自动刷新
      refetchOnReconnect: true,   // 网络恢复自动刷新
      retry: 2,                   // 失败重试 2 次
    },
  },
});
```

### 标准 Query Hook

#### 文件查询（核心 hook）

```typescript
// hooks/useEntityFilesQuery.ts
function useEntityFilesQuery(
  entityType: string,
  entityId: string | null,
  fileRole?: string,
) {
  return useQuery({
    queryKey: ['entityFiles', entityType, entityId, fileRole],
    queryFn: () => fetchEntityFiles(entityType, entityId!, fileRole),
    enabled: !!entityId,
    staleTime: 30_000,
  });
}
```

#### 文件操作 Mutation

```typescript
// hooks/useFilesMutation.ts
function useSelectFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileId: string; entityType: string; entityId: string; fileRole: string }) =>
      selectEntityFile(vars.fileId, vars.entityType, vars.entityId, vars.fileRole),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}

function useDeleteFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileId: string; entityType: string; entityId: string }) =>
      deleteEntityFile(vars.fileId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}

function useUploadFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File | string; entityType: string; entityId: string; fileRole: string }) =>
      uploadEntityFile(vars.file, vars.entityType, vars.entityId, vars.fileRole),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}
```

#### 业务数据 Query（替代 EpisodeContext loadSlices）

```typescript
// hooks/useEpisodeData.ts
function useStoryboardItems(episodeId: string | null) {
  return useQuery({
    queryKey: ['storyboardItems', episodeId],
    queryFn: () => getStoryboardItems(episodeId!).then(r => r.items.map(normalizeStoryboardItem)),
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

function useAssets(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: ['assets', projectId, episodeId],
    queryFn: () => getAssets(projectId!, episodeId!).then(r => r.items),
    enabled: !!projectId && !!episodeId,
    staleTime: 30_000,
  });
}

function useVideoSegments(episodeId: string | null) {
  return useQuery({
    queryKey: ['videoSegments', episodeId],
    queryFn: () => getVideoSegments(episodeId!).then(r => r.items),
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

function useScript(episodeId: string | null) {
  return useQuery({
    queryKey: ['script', episodeId],
    queryFn: () => getEpisodeScript(episodeId!).then(r => r.script),
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}
```

#### 业务数据 Mutation

```typescript
function useSaveStoryboardItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; data: Record<string, any>; episodeId: string }) =>
      apiUpdateStoryboardItem(vars.itemId, vars.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['storyboardItems', vars.episodeId] });
    },
  });
}
```

### SSE 缓存失效集成

全局 hook 挂载在 App 根组件，监听 SSE 事件自动刷新缓存。

注意：`globalTaskManager` 的实际 API 签名是 `addEventListener(callback: (type, data) => void): () => void`，回调接收 `(type, data)` 两个参数，没有事件类型过滤。`addEventListener` 返回 unsubscribe 函数，没有 `removeEventListener` 方法。

```typescript
// hooks/useSSEInvalidation.ts
function useSSEInvalidation() {
  const qc = useQueryClient();

  useEffect(() => {
    const unsubscribe = globalTaskManager.addEventListener((type, data) => {
      if (type === 'notification' && data.notification) {
        const n = data.notification as TaskNotification;
        if (n.entityType && n.entityId) {
          qc.invalidateQueries({
            queryKey: ['entityFiles', n.entityType, n.entityId],
          });
        }
        // 按 episodeId 精确失效，避免无差别刷新所有 episode 的数据
        if (n.episodeId) {
          qc.invalidateQueries({ queryKey: ['storyboardItems', n.episodeId] });
          qc.invalidateQueries({ queryKey: ['videoSegments', n.episodeId] });
        }
      }
    });
    return unsubscribe;
  }, [qc]);
}
```

效果：用户在页面 A 提交生成 → 切换到页面 B → 生成完成 → SSE 推送 → 缓存失效 → 切回页面 A 时数据自动是最新的。

### TaskNotification 类型扩展

`types.ts` 中的 `TaskNotification` 接口需要增加 entity 相关字段：

```typescript
export interface TaskNotification {
  // ... 现有字段 ...
  entityType?: string;   // 新增
  entityId?: string;     // 新增
  fileRole?: string;     // 新增
  episodeId?: string;    // 新增，用于精确限定缓存失效范围
}
```

### globalTaskManager 扩展

`globalTaskManager.ts` 的 `handleSSEMessage` 需要从 `task_complete` 消息中解析新字段，并传递给 notification：

```typescript
if (data.type === 'task_complete') {
  const notification: TaskNotification = {
    ...existingFields,
    entityType: data.entity_type,
    entityId: data.entity_id,
    fileRole: data.file_role,
    episodeId: data.episode_id,
  };
  this.emit('notification', { notification });
}
```

### SSE 推送消息扩展

后端 `task_queue.py` 的 `complete_task` 推送中需额外携带 `episode_id`，用于前端精确限定缓存失效范围。`episode_id` 可从 `task_data` 中获取（需要前端在提交任务时传入），或通过 entity_id 反查业务表获取。

```python
await redis.publish(f"task_complete:{username}", json.dumps({
    "type": "task_complete",
    "task_id": task_id,
    "task_type": task_type,
    "entity_type": task_data.get("entity_type"),
    "entity_id": task_data.get("entity_id"),
    "file_role": task_data.get("file_role"),
    "episode_id": task_data.get("episode_id"),  # 用于精确缓存失效
}))
```

### EpisodeContext 演进

EpisodeContext 不删除，而是变薄。数据获取职责交给 React Query，EpisodeContext 只保留上下文 ID：

```typescript
// 改造后的 EpisodeContext（约 30 行）
interface EpisodeContextValue {
  episodeId: string;
  projectId: string;
}
```

页面使用方式：

```typescript
function StoryboardGenPage() {
  const { episodeId, projectId } = useEpisode();                         // 只拿 ID
  const { data: items } = useStoryboardItems(episodeId);                 // React Query
  const { data: images } = useEntityFilesQuery('storyboard_item', shotId, 'generated_image');
  const selectFile = useSelectFileMutation();
  // ...
}
```

原有 EpisodeContext 的 `saveScript`、`saveStoryboardItem` 等方法改为独立的 mutation hook。

### 迁移过渡期共存策略

在阶段 3 逐页面迁移期间，React Query 和 EpisodeContext 会同时存在。为避免数据不一致：

**规则：共享同一 slice 的页面必须一起迁移。**

具体分组：
- **storyboardItems slice**：StoryboardGenPage + AudioStagePage + MaterialsPage + VideoGenPage 同时迁移
- **assets slice**：DesignPage + MaterialsPage 同时迁移
- **videoSegments slice**：GenerationPage（视频）同时迁移

如果无法一次迁移整组，过渡期内需在 mutation 的 `onSuccess` 中同时调用 `episodeContext.reload()` 保持 EpisodeContext 数据同步：

```typescript
function useSaveStoryboardItem() {
  const qc = useQueryClient();
  const { reload } = useEpisode();  // 过渡期使用
  return useMutation({
    mutationFn: (vars) => apiUpdateStoryboardItem(vars.itemId, vars.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['storyboardItems', vars.episodeId] });
      reload();  // 过渡期：同步 EpisodeContext，全部迁移后删除此行
    },
  });
}
```

### 前端 Service 层适配

各 service 文件适配新的后端返回格式：

- `geminiImageService.ts`：`generateGeminiImageViaProxy()` 返回类型从 `string[]` 改为 `GeneratedFileResult[]`（含 `url`、`fileId`、`fileUrl`）
- `geminiService.ts`：`generateFinalIllustration()` 增加 entity 参数，返回包含 `fileId`
- `geminiService.ts`：`generateWithComfyUIWorkflow/Queued()` 透传 entity 参数
- `doubaoService.ts`：适配新返回格式
- `entityFileService.ts`：新增 `uploadEntityFile()` 函数
- `apiService.ts`：TTS 相关函数适配新返回格式

### 删除前端 linkEntityFile 调用

后端保存时已直接写入 entity 关联，前端不再需要 `linkEntityFile` 做补丁：

- `GenerationPage.tsx` generateForShot ComfyUI 分支中的 `linkEntityFile` 调用全部删除
- `linkEntityFile` 函数本身保留在 `entityFileService.ts` 中作为迁移工具

---

## Legacy WorkspaceApp 迁移

WorkspaceApp.tsx（2661 行）不一次性重写，渐进迁移：

### 本次范围

- 在 WorkspaceApp 外层包裹 `QueryClientProvider`
- 生成结果相关逻辑接入 React Query
- `generation-save-trigger` 事件改为 mutation + invalidation

### 后续范围（独立计划）

- 逐步将 WorkspaceApp 内部的 `files` state、`materialLibrary` state 迁移到 React Query
- 最终 WorkspaceApp 只做 UI 布局和路由

---

## 各页面改造前后对比

### StoryboardGenPage

| 操作 | 改造前 | 改造后 |
|------|--------|--------|
| 加载图片 | 手动 `fetchEntityFiles` + `setEntityImages` | `useEntityFilesQuery('storyboard_item', shotId, 'generated_image')` |
| 选定图片 | 手动 `selectEntityFile` + 更新本地 state | `selectFile.mutate(...)` → 缓存自动刷新 |
| 删除图片 | 手动 `deleteEntityFile` + 更新本地 state | `deleteFile.mutate(...)` → 缓存自动刷新 |
| 生成完成 | `linkEntityFile`（可失败）+ 手动 setState | 后端已保存 + SSE → 缓存失效 → 自动刷新 |
| 切换页面 | 内存 state 丢失 | React Query 缓存保留，切回瞬间显示 |
| 刷新页面 | 依赖 `linkEntityFile` 是否成功 | `useQuery` 自动重新获取 |

### DesignPage

| 操作 | 改造前 | 改造后 |
|------|--------|--------|
| AI 生成图片 | Gemini/豆包返回 base64 → updateAsset JSONB | 后端保存到 files 表 → `useEntityFilesQuery('asset', assetId, 'reference_image')` |
| 上传图片 | 本地 Data URL → updateAsset JSONB | `uploadFile.mutate(...)` → files 表 |
| 删除图片 | 过滤 JSONB 数组 | `deleteFile.mutate(...)` |

### AudioStagePage

| 操作 | 改造前 | 改造后 |
|------|--------|--------|
| TTS 生成 | MiniMax 返回 audio_url → apiUpdateStoryboardItem | 后端保存到 files 表 → `useEntityFilesQuery('storyboard_item', itemId, 'dialogue_audio')` |
| 多版本配音 | 不支持（只存 1 个 URL） | files 表天然支持多版本，`is_selected` 标记当前版本 |

---

## 实施顺序

### 阶段 1：后端统一保存（不依赖 React Query）

1. 新增 `save_generated_file_to_db()` helper
2. 改造所有 22 个 API 端点
3. SSE 扩展 entity 信息
4. 新增 `/api/entity-files/upload` 端点

此阶段完成后，所有生成数据已持久化，即使前端未改造也不会丢数据。

### 阶段 2：前端引入 React Query

1. 安装 TanStack Query，配置 QueryClientProvider
2. 创建标准 hook 文件（`useEntityFilesQuery`、`useFilesMutation`、`useEpisodeData`）
3. 实现 `useSSEInvalidation` 全局 hook

### 阶段 3：逐页面迁移

按优先级逐页面迁移到 React Query hook：

1. StoryboardGenPage（最紧急，数据丢失最严重）
2. DesignPage
3. AudioStagePage
4. GenerationPage（视频）
5. VideoGenPage
6. WorkspaceApp（渐进）

每迁移一个页面，验证通过后再迁移下一个。

### 阶段 4：EpisodeContext 瘦身

所有页面迁移完成后，EpisodeContext 瘦身为仅提供 `episodeId` / `projectId` 上下文。

---

## 不在此设计范围内

- MinIO 对象存储迁移：当前 `persistent_storage/` 本地磁盘足够，后续需要横向扩展时再引入
- EnhancePage 持久化：当前无真实后端生成，需独立设计
- VideoPage TaskGroup.ids 不匹配问题：独立 bug，与数据层架构无关
