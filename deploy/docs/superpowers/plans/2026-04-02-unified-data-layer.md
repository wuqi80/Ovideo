# 统一数据层实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有生成路径（图片/音频/视频）统一保存到 files 表 + 前端引入 React Query 统一数据层，彻底消除刷新/切换页面数据丢失问题。

**Architecture:** 后端新增通用 `save_generated_file_to_db()` 函数保存所有生成结果到 files 表（复用 `dao_content.FileDAO.create_file()` 而非 `dao_file.FileDAO.create()`，因为前者已支持 entity_type/entity_id/file_role/is_selected 字段）。前端引入 TanStack Query 提供统一缓存/自动刷新。SSE 事件携带 entity 信息触发缓存失效。

**Tech Stack:** Python/FastAPI, PostgreSQL, React 19, TanStack Query v5, SSE/Redis Pub-Sub

**Spec:** [docs/superpowers/specs/2026-04-02-unified-data-layer-design.md](../specs/2026-04-02-unified-data-layer-design.md)

**与 Spec 的偏差说明：**
- Spec 提出扩展 `dao_file.py` 的 `FileDAO.create()`。实际发现 `dao_content.py` 的 `FileDAO.create_file()` 已支持全部 entity 字段，`worker.py` 也使用它。本计划直接复用 `dao_content.FileDAO.create_file()`，无需修改 `dao_file.py`。
- `save_generated_file_to_db()` 增加了 `episode_id` 参数（spec 未提及），用于 SSE 精确缓存失效。

---

## 文件结构

### 后端新建/修改

- Modify: `file_service.py` — 新增 `save_generated_file_to_db()` 通用函数（使用 `dao_content.FileDAO.create_file()`）
- Modify: `cluster_main.py` — ComfyUI/Gemini/豆包/多宫格端点增加 entity 字段 + 调用 save helper
- Modify: `api_routes.py` — 音频端点调用 save helper + 新增 `/api/entity-files/upload`
- Modify: `task_queue.py` — SSE 推送增加 entity 信息

### 前端新建/修改

- Modify: `new_html/package.json` — 添加 @tanstack/react-query 依赖
- Modify: `new_html/App.tsx` — 添加 QueryClientProvider + SSEInvalidationProvider
- Create: `new_html/hooks/useEntityFilesQuery.ts` — 文件查询 hook
- Create: `new_html/hooks/useFilesMutation.ts` — 文件操作 mutation hooks（select/delete/upload）
- Create: `new_html/hooks/useEpisodeData.ts` — 业务数据 query + mutation hooks
- Create: `new_html/hooks/useSSEInvalidation.ts` — SSE 缓存失效 hook
- Modify: `new_html/types.ts` (L275-286) — TaskNotification 增加 entity 字段
- Modify: `new_html/services/globalTaskManager.ts` (L91-113) — 解析 SSE entity 字段
- Modify: `new_html/services/geminiImageService.ts` — 适配新返回格式 + entity 参数
- Modify: `new_html/services/geminiService.ts` — 透传 entity 参数
- Modify: `new_html/services/doubaoService.ts` — 适配新返回格式 + entity 参数
- Modify: `new_html/services/entityFileService.ts` — 新增 `uploadEntityFile()` 函数
- Modify: `new_html/components/GenerationPage.tsx` — 删除 linkEntityFile，传 entity 参数
- Modify: `new_html/pages/StoryboardGenPage.tsx` — 迁移到 React Query hooks

### FileDAO 对照表

| 位置 | 类 | 方法 | 支持 entity 字段 | 本计划使用 |
|------|----|------|-------------------|-----------|
| `dao_file.py` | `FileDAO` | `create()` | 否 | 否 |
| `dao_content.py` | `FileDAO` | `create_file()` | 是 | 是 |
| `file_service.py` (现有) | 引用 `dao_file.FileDAO` | `create()` | 否 | 不动 |
| `worker.py` | `from dao_content import FileDAO` | `create_file()` | 是 | 已在用 |

---

## 阶段 1：后端统一保存

### Task 1: 新增 save_generated_file_to_db() 通用函数

**Files:**
- Modify: `file_service.py` (末尾追加，约 L144 之后)

**关键：** `file_service.py` 顶部已有 `from dao_file import FileDAO`（L23），新函数使用 `dao_content.FileDAO` 需要用别名避免冲突。

- [ ] **Step 1: 在 file_service.py 末尾追加 save_generated_file_to_db 函数**

```python
from dao_content import FileDAO as ContentFileDAO

async def save_generated_file_to_db(
    content: bytes,
    file_type: str,
    user_id: str,
    source: str,
    entity_type: str = None,
    entity_id: str = None,
    file_role: str = None,
    original_ext: str = '.png',
    is_selected: bool = False,
    episode_id: str = None,
) -> dict:
    """
    统一的生成文件保存入口。
    将文件保存到 persistent_storage 并写入 files 表（含 entity 关联）。
    """
    from datetime import datetime
    from pathlib import Path
    import io
    import uuid

    year_month = datetime.now().strftime('%Y%m')
    file_id = str(uuid.uuid4())

    # 图片转 WebP（lossless）
    if file_type == 'image' and original_ext.lower() in ('.png', '.jpg', '.jpeg'):
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(content))
            buf = io.BytesIO()
            img.save(buf, format='WEBP', lossless=True)
            content = buf.getvalue()
            original_ext = '.webp'
        except Exception as e:
            logger.warning(f"WebP 转换失败，使用原始格式: {e}")

    safe_filename = f"{file_id}{original_ext}"
    sub_dir = Path(f"persistent_storage/{file_type}/{user_id}/{year_month}")
    sub_dir.mkdir(parents=True, exist_ok=True)
    local_path = sub_dir / safe_filename
    local_path.write_bytes(content)

    file_url = f"/storage/{file_type}/{user_id}/{year_month}/{safe_filename}"

    MIME_MAP = {
        '.webp': 'image/webp', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4', '.txt': 'text/plain',
    }
    mime_type = MIME_MAP.get(original_ext.lower(), f'{file_type}/{original_ext.lstrip(".")}')

    db_record = None
    try:
        db_record = await ContentFileDAO.create_file(
            version_id=None,
            user_id=user_id,
            file_type=file_type,
            file_name=safe_filename,
            file_path=str(local_path),
            file_url=file_url,
            file_size_bytes=len(content),
            mime_type=mime_type,
            metadata={'source': source, 'episode_id': episode_id},
            file_id=file_id,
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            is_selected=is_selected,
        )
    except Exception as e:
        logger.error(f"save_generated_file_to_db DB 写入失败: {e}", exc_info=True)

    return {
        'file_id': db_record['file_id'] if db_record else None,
        'file_url': file_url,
        'file_path': str(local_path),
    }
```

- [ ] **Step 2: 验证函数可 import**

```bash
cd h:\MY2 && python -c "from file_service import save_generated_file_to_db; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add file_service.py && git commit -m "feat: add save_generated_file_to_db() unified save helper"
```

---

### Task 2: ComfyUIWorkflowRequest + GenerateRequest 添加 entity 字段

**Files:**
- Modify: `cluster_main.py` L3898-3903 (`ComfyUIWorkflowRequest`), L479-496 (`GenerateRequest`)

- [ ] **Step 1: ComfyUIWorkflowRequest 添加 entity 字段**

在 `cluster_main.py` L3903（`seed` 字段）之后添加 4 行：

```python
    entity_type: Optional[str] = Field(None, description="实体类型: storyboard_item/asset/video_segment")
    entity_id: Optional[str] = Field(None, description="实体ID")
    file_role: Optional[str] = Field(None, description="文件角色: generated_image/reference_image/...")
    episode_id: Optional[str] = Field(None, description="集ID，用于缓存失效")
```

- [ ] **Step 2: GenerateRequest 添加 entity 字段**

在 `cluster_main.py` L496（`shot_type` 字段）之后添加同样 4 行。

- [ ] **Step 3: generate_comfyui_workflow 透传 entity 到 task_data**

在 L3930 附近 `task_data` 构建后追加：

```python
        if request.entity_type:
            task_data['entity_type'] = request.entity_type
        if request.entity_id:
            task_data['entity_id'] = request.entity_id
        if request.file_role:
            task_data['file_role'] = request.file_role
        if request.episode_id:
            task_data['episode_id'] = request.episode_id
```

- [ ] **Step 4: /api/generate 路由同样透传 entity 到 task_data**

找到 `/api/generate` 的路由函数中 `task_data` 构建位置，添加同样的 4 行 entity 透传逻辑。

- [ ] **Step 5: Commit**

```bash
git add cluster_main.py && git commit -m "feat: ComfyUIWorkflowRequest/GenerateRequest accept entity fields"
```

---

### Task 3: 其他 ComfyUI 端点添加 entity 字段（Part A）

**Files:**
- Modify: `cluster_main.py` — 以下 5 个端点的 Request model + task_data

对以下端点，每个 Request model 添加 4 个可选 entity 字段，task_data 构建处添加透传逻辑：

- [ ] **Step 1: `/api/generate/angle-adjust`**

找到 `AngleAdjustRequest` model（或该路由使用的 Request class），添加 entity_type/entity_id/file_role/episode_id 可选字段。在路由函数的 task_data 构建后添加透传。

- [ ] **Step 2: `/api/generate/human-multi-angle`**

同上模式。

- [ ] **Step 3: `/api/generate/around-angle`**

同上模式。

- [ ] **Step 4: `/api/generate/matting`**

同上模式。

- [ ] **Step 5: `/api/generate/image-fusion`**

同上模式。

- [ ] **Step 6: Commit**

```bash
git add cluster_main.py && git commit -m "feat: angle/matting/fusion endpoints accept entity fields"
```

---

### Task 4: 其他 ComfyUI 端点添加 entity 字段（Part B）

**Files:**
- Modify: `cluster_main.py` — 以下端点

- [ ] **Step 1: `/api/generate/panorama-360`**

Request model + task_data 透传 entity 字段。

- [ ] **Step 2: `/api/generate/panorama-fusion`**

同上。

- [ ] **Step 3: `/api/generate/auto-storyboard`**

同上。

- [ ] **Step 4: `/api/materials/process`**

同上。

- [ ] **Step 5: Commit**

```bash
git add cluster_main.py && git commit -m "feat: panorama/auto-storyboard/materials endpoints accept entity fields"
```

---

### Task 5: Gemini/豆包/多宫格端点调用 save helper

**Files:**
- Modify: `cluster_main.py` — `GeminiImageRequest` (L516-521), `gemini_image_generate` (L995), `DoubaoImageRequest` (L504-509), `generate_doubao_images` (L1107)

- [ ] **Step 1: GeminiImageRequest 添加 entity 字段**

在 L521 (`imageSize` 字段) 之后添加 4 个可选字段：

```python
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)
```

- [ ] **Step 2: /api/gemini/image 端点保存到 files 表**

在 `gemini_image_generate` 函数中，找到构建 `images` 列表并返回的位置。在 `return` 之前插入保存逻辑：

```python
        from file_service import save_generated_file_to_db
        import base64 as b64mod

        files_result = []
        for img_data_url in images:
            try:
                b64_data = img_data_url.split(',')[1] if ',' in img_data_url else img_data_url
                content = b64mod.b64decode(b64_data)
                saved = await save_generated_file_to_db(
                    content=content,
                    file_type='image',
                    user_id=username,
                    source='gemini',
                    entity_type=request.entity_type,
                    entity_id=request.entity_id,
                    file_role=request.file_role or 'generated_image',
                    original_ext='.png',
                    episode_id=request.episode_id,
                )
                files_result.append({
                    'data_url': img_data_url,
                    'file_id': saved['file_id'],
                    'file_url': saved['file_url'],
                })
            except Exception as e:
                logger.warning(f"保存 Gemini 图片到 files 表失败: {e}")
                files_result.append({'data_url': img_data_url, 'file_id': None, 'file_url': None})

        return {"success": True, "images": images, "files": files_result}
```

- [ ] **Step 3: DoubaoImageRequest 添加 entity 字段**

在 L509 (`count` 字段) 之后添加同样 4 个可选字段。

- [ ] **Step 4: /api/materials/doubao 端点保存到 files 表**

在 `generate_doubao_images` 函数返回前，对每张生成的 base64 图片调用 `save_generated_file_to_db()`，返回增加 `files` 数组。逻辑同 Step 2。

- [ ] **Step 5: /api/generate/multi-grid-storyboard 端点同样处理**

找到该端点，生成 base64 后调用 save helper，返回增加 `files` 数组。

- [ ] **Step 6: Commit**

```bash
git add cluster_main.py && git commit -m "feat: Gemini/Doubao/multi-grid save results to files table"
```

- [ ] **Step 7: 验证**

手动调用 Gemini 图片生成端点，检查 `files` 表中是否有新记录且包含正确的 `entity_type`：

```bash
cd h:\MY2 && python -c "
import asyncio
from db_manager import get_db_manager
async def check():
    db = get_db_manager()
    row = await db.fetchrow('SELECT * FROM files ORDER BY created_at DESC LIMIT 1')
    print(row)
asyncio.run(check())
"
```

---

### Task 6: 音频端点调用 save helper

**Files:**
- Modify: `api_routes.py` (minimax/tts, audio/generate-speech, audio/generate-sfx, audio/generate-music, minimax/music)

- [ ] **Step 1: /api/minimax/tts 端点保存到 files 表**

找到 TTS 端点函数中音频文件保存成功后的位置。在返回 `audio_url` 前，调用 save helper：

```python
from file_service import save_generated_file_to_db
from pathlib import Path

# 已有逻辑保存音频后得到 audio_path
if Path(audio_path).exists():
    try:
        entity_type = request_body.get('entity_type') if isinstance(request_body, dict) else getattr(request, 'entity_type', None)
        entity_id = request_body.get('entity_id') if isinstance(request_body, dict) else getattr(request, 'entity_id', None)
        file_role = request_body.get('file_role', 'dialogue_audio') if isinstance(request_body, dict) else getattr(request, 'file_role', 'dialogue_audio')
        episode_id = request_body.get('episode_id') if isinstance(request_body, dict) else getattr(request, 'episode_id', None)

        saved = await save_generated_file_to_db(
            content=Path(audio_path).read_bytes(),
            file_type='audio',
            user_id=username,
            source='minimax',
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            original_ext=Path(audio_path).suffix,
            episode_id=episode_id,
        )
        result['file_id'] = saved['file_id']
        result['file_url'] = saved['file_url']
    except Exception as e:
        logger.warning(f"保存 TTS 音频到 files 表失败: {e}")
```

注意：需要确认 TTS 端点的请求体是 Pydantic model 还是 dict。如果是 Pydantic model，需先添加 entity 可选字段。

- [ ] **Step 2: /api/audio/generate-speech 同样处理**

- [ ] **Step 3: /api/audio/generate-sfx, /api/audio/generate-music, /api/minimax/music 同样处理**

- [ ] **Step 4: Commit**

```bash
git add api_routes.py && git commit -m "feat: audio generation endpoints save to files table"
```

---

### Task 7: SSE 推送增加 entity 信息

**Files:**
- Modify: `task_queue.py` (L277-288, complete_task redis.publish)

- [ ] **Step 1: complete_task 的 Redis publish 增加 entity 字段**

修改 `task_queue.py` L277-288，在 `json.dumps` dict 中追加 4 个字段：

```python
                    json.dumps({
                        "type": "task_complete",
                        "task_id": task_id,
                        "status": "completed",
                        "task_type": task_type,
                        "display_name": display_name,
                        "project_id": project_id,
                        "source_page": source_page,
                        # 统一数据层: entity 信息用于前端缓存失效
                        "entity_type": task.data.get("entity_type", "") if task.data else "",
                        "entity_id": task.data.get("entity_id", "") if task.data else "",
                        "file_role": task.data.get("file_role", "") if task.data else "",
                        "episode_id": task.data.get("episode_id", "") if task.data else "",
                    })
```

- [ ] **Step 2: Commit**

```bash
git add task_queue.py && git commit -m "feat: SSE task_complete includes entity info for cache invalidation"
```

---

### Task 8: 新增 /api/entity-files/upload 端点

**Files:**
- Modify: `api_routes.py`

- [ ] **Step 1: 新增上传端点**

在 `api_routes.py` 中添加：

```python
from fastapi import File, UploadFile, Form

@app.post("/api/entity-files/upload")
async def upload_entity_file(
    file: UploadFile = File(...),
    entity_type: str = Form(None),
    entity_id: str = Form(None),
    file_role: str = Form(None),
    episode_id: str = Form(None),
    username: str = Depends(require_auth),
):
    """上传文件并关联到实体"""
    content = await file.read()
    ext = Path(file.filename).suffix if file.filename else '.bin'
    file_type = 'image' if file.content_type and file.content_type.startswith('image') else \
                'audio' if file.content_type and file.content_type.startswith('audio') else \
                'video' if file.content_type and file.content_type.startswith('video') else 'other'

    from file_service import save_generated_file_to_db
    saved = await save_generated_file_to_db(
        content=content,
        file_type=file_type,
        user_id=username,
        source='upload',
        entity_type=entity_type,
        entity_id=entity_id,
        file_role=file_role,
        original_ext=ext,
        episode_id=episode_id,
    )
    return {"success": True, "file_id": saved['file_id'], "file_url": saved['file_url']}
```

- [ ] **Step 2: Commit**

```bash
git add api_routes.py && git commit -m "feat: add POST /api/entity-files/upload endpoint"
```

---

## 阶段 2：前端 React Query 基础设施

### Task 9: 安装 TanStack Query + QueryClientProvider

**Files:**
- Modify: `new_html/package.json`
- Modify: `new_html/App.tsx` (L56-106)

- [ ] **Step 1: 安装依赖**

```bash
cd h:\MY2\new_html && npm install @tanstack/react-query
```

- [ ] **Step 2: App.tsx 添加 QueryClientProvider**

在 `new_html/App.tsx` 顶部添加 import：

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```

在组件定义前添加 queryClient 实例：

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});
```

修改 App 组件（L56-106），在 `BrowserRouter` 外层包裹 `QueryClientProvider`：

```typescript
const App: React.FC = () => {
    return (
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <TaskProvider>
                    <GlobalToastWithNav />
                    <Routes>
                        {/* ... 现有路由不变 ... */}
                    </Routes>
                </TaskProvider>
            </BrowserRouter>
        </QueryClientProvider>
    );
};
```

- [ ] **Step 3: 验证构建通过**

```bash
cd h:\MY2\new_html && npx tsc --noEmit
```

Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
cd h:\MY2 && git add new_html/package.json new_html/App.tsx && git commit -m "feat: install TanStack Query and add QueryClientProvider"
```

---

### Task 10: 创建 Query/Mutation Hooks

**Files:**
- Create: `new_html/hooks/useEntityFilesQuery.ts`
- Create: `new_html/hooks/useFilesMutation.ts`
- Create: `new_html/hooks/useEpisodeData.ts`

- [ ] **Step 1: 创建 useEntityFilesQuery.ts**

```typescript
import { useQuery } from '@tanstack/react-query';
import { fetchEntityFiles } from '../services/entityFileService';
import type { EntityFile } from '../services/entityFileService';

export { type EntityFile };

export function useEntityFilesQuery(
  entityType: string,
  entityId: string | null | undefined,
  fileRole?: string,
) {
  return useQuery<{ items: EntityFile[]; total: number }>({
    queryKey: ['entityFiles', entityType, entityId, fileRole],
    queryFn: () => fetchEntityFiles(entityType, entityId!, fileRole),
    enabled: !!entityId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: 创建 useFilesMutation.ts（含 select/delete/upload）**

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { selectEntityFile, deleteEntityFile } from '../services/entityFileService';
import { uploadEntityFile } from '../services/entityFileService';

export function useSelectFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileId: string; entityType: string; entityId: string; fileRole: string }) =>
      selectEntityFile(vars.fileId, vars.entityType, vars.entityId, vars.fileRole),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}

export function useDeleteFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileId: string; entityType: string; entityId: string }) =>
      deleteEntityFile(vars.fileId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}

export function useUploadFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; entityType: string; entityId: string; fileRole: string; episodeId?: string }) =>
      uploadEntityFile(vars.file, vars.entityType, vars.entityId, vars.fileRole, vars.episodeId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}
```

- [ ] **Step 3: 创建 useEpisodeData.ts（含 query + mutation）**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getStoryboardItems, getAssets, getVideoSegments, getEpisodeScript, updateStoryboardItem } from '../services/apiService';

export function useStoryboardItems(episodeId: string | null) {
  return useQuery({
    queryKey: ['storyboardItems', episodeId],
    queryFn: async () => {
      const r = await getStoryboardItems(episodeId!);
      return r.items || [];
    },
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

export function useAssets(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: ['assets', projectId, episodeId],
    queryFn: async () => {
      const r = await getAssets(projectId!, episodeId);
      return r.assets || [];
    },
    enabled: !!projectId && !!episodeId,
    staleTime: 30_000,
  });
}

export function useVideoSegments(episodeId: string | null) {
  return useQuery({
    queryKey: ['videoSegments', episodeId],
    queryFn: async () => {
      const r = await getVideoSegments(episodeId!);
      return r.segments || [];
    },
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

export function useScript(episodeId: string | null) {
  return useQuery({
    queryKey: ['script', episodeId],
    queryFn: async () => {
      const r = await getEpisodeScript(episodeId!);
      return r.script || '';
    },
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

export function useSaveStoryboardItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; data: Record<string, any>; episodeId: string }) =>
      updateStoryboardItem(vars.itemId, vars.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['storyboardItems', vars.episodeId] });
    },
  });
}
```

注：
- `handleResponse` 在非 2xx 或非 JSON 时直接 throw Error，正常时返回解析后的 JSON 对象。
- `getStoryboardItems` 返回 `{ items: [...] }`，`getAssets` 返回 `{ assets: [...] }`，`getVideoSegments` 返回 `{ segments: [...] }`——字段名各不相同，以实际 API 为准。
- Spec 中的 `normalizeStoryboardItem` 在此处省略。实施时需确认 API 返回的字段名是否需要 camelCase 转换（如 `shot_number` → `shotNumber`）。如果 API 已返回前端所需格式则无需 normalize；如果需要，在 queryFn 中添加 `.map(normalizeStoryboardItem)`。

- [ ] **Step 4: Commit**

```bash
cd h:\MY2 && git add new_html/hooks/ && git commit -m "feat: create React Query hooks for entity files and episode data"
```

---

### Task 11: entityFileService 新增 uploadEntityFile

**Files:**
- Modify: `new_html/services/entityFileService.ts` (末尾追加)

- [ ] **Step 1: 在 entityFileService.ts 末尾添加 uploadEntityFile 函数**

在 L88（`linkEntityFile` 之后）追加：

```typescript
export async function uploadEntityFile(
  file: File,
  entityType: string,
  entityId: string,
  fileRole: string,
  episodeId?: string,
): Promise<{ fileId: string; fileUrl: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (entityType) formData.append('entity_type', entityType);
  if (entityId) formData.append('entity_id', entityId);
  if (fileRole) formData.append('file_role', fileRole);
  if (episodeId) formData.append('episode_id', episodeId);

  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/entity-files/upload', {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`uploadEntityFile failed: ${res.status}`);
  const data = await res.json();
  return { fileId: data.file_id, fileUrl: data.file_url };
}
```

- [ ] **Step 2: Commit**

```bash
cd h:\MY2 && git add new_html/services/entityFileService.ts && git commit -m "feat: add uploadEntityFile to entityFileService"
```

---

### Task 12: SSE 缓存失效集成

**Files:**
- Modify: `new_html/types.ts` (L275-286)
- Modify: `new_html/services/globalTaskManager.ts` (L91-113)
- Create: `new_html/hooks/useSSEInvalidation.ts`
- Modify: `new_html/App.tsx`

- [ ] **Step 1: TaskNotification 增加 entity 字段**

在 `types.ts` L285（`taskId?: string;` 行之后、`}` 之前）添加：

```typescript
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  episodeId?: string;
```

- [ ] **Step 2: globalTaskManager handleSSEMessage 解析新字段**

修改 `globalTaskManager.ts` L93-104 的 notification 构建，在 `taskId: data.task_id` 行后添加：

```typescript
                entityType: data.entity_type || undefined,
                entityId: data.entity_id || undefined,
                fileRole: data.file_role || undefined,
                episodeId: data.episode_id || undefined,
```

- [ ] **Step 3: 创建 useSSEInvalidation.ts**

```typescript
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { globalTaskManager } from '../services/globalTaskManager';
import type { TaskEventType } from '../services/globalTaskManager';
import type { TaskNotification } from '../types';

export function useSSEInvalidation() {
  const qc = useQueryClient();

  useEffect(() => {
    const unsubscribe = globalTaskManager.addEventListener((
      type: TaskEventType,
      data: { notification?: TaskNotification },
    ) => {
      if (type === 'notification' && data.notification) {
        const n = data.notification;
        if (n.entityType && n.entityId) {
          qc.invalidateQueries({
            queryKey: ['entityFiles', n.entityType, n.entityId],
          });
        }
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

- [ ] **Step 4: App.tsx 挂载 useSSEInvalidation**

在 `App.tsx` 中新增一个 Provider 组件来调用 hook：

```typescript
import { useSSEInvalidation } from './hooks/useSSEInvalidation';

function SSEInvalidationProvider({ children }: { children: React.ReactNode }) {
  useSSEInvalidation();
  return <>{children}</>;
}
```

将 App 组件修改为：

```typescript
const App: React.FC = () => {
    return (
        <QueryClientProvider client={queryClient}>
            <SSEInvalidationProvider>
                <BrowserRouter>
                    <TaskProvider>
                        <GlobalToastWithNav />
                        <Routes>
                            {/* ... 现有路由不变 ... */}
                        </Routes>
                    </TaskProvider>
                </BrowserRouter>
            </SSEInvalidationProvider>
        </QueryClientProvider>
    );
};
```

- [ ] **Step 5: 验证构建通过**

```bash
cd h:\MY2\new_html && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd h:\MY2 && git add new_html/types.ts new_html/services/globalTaskManager.ts new_html/hooks/useSSEInvalidation.ts new_html/App.tsx
git commit -m "feat: SSE events trigger React Query cache invalidation with entity info"
```

---

## 阶段 3：前端 Service + 页面迁移

### Task 13: doubaoService.ts 适配新返回格式

**Files:**
- Modify: `new_html/services/doubaoService.ts` (39 行)

当前 `generateDoubaoImages` 返回 `Promise<string[]>`（L9），只读 `data.images`（L37）。

- [ ] **Step 1: 新增 GeneratedFileResult 类型 + 适配双格式**

```typescript
export interface GeneratedFileResult {
    url: string;
    fileId?: string;
    fileUrl?: string;
}

export interface DoubaoGenerationOptions {
    prompt: string;
    references?: string[];
    size?: '1K' | '2K' | '4K';
    sequential?: 'disabled' | 'auto';
    count?: number;
    entityType?: string;
    entityId?: string;
    fileRole?: string;
    episodeId?: string;
}

export const generateDoubaoImages = async (options: DoubaoGenerationOptions): Promise<GeneratedFileResult[]> => {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('未登录，无法调用AI生成服务');

    const response = await fetch('/api/materials/doubao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            prompt: options.prompt,
            references: options.references || [],
            size: options.size || '2K',
            sequential: options.sequential || 'disabled',
            count: options.count || 1,
            entity_type: options.entityType,
            entity_id: options.entityId,
            file_role: options.fileRole,
            episode_id: options.episodeId,
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || '图像生成失败，请稍后再试');

    // 新格式优先
    if (data.files && data.files.length > 0) {
        return data.files.map((f: any) => ({
            url: f.file_url || f.data_url,
            fileId: f.file_id,
            fileUrl: f.file_url,
        }));
    }
    // 旧格式兼容
    if (!data.images || data.images.length === 0) {
        throw new Error('图像生成失败，未返回任何图片');
    }
    return data.images.map((img: string) => ({ url: img }));
};
```

- [ ] **Step 2: 更新 doubaoService 的消费者**

grep `generateDoubaoImages` 的消费者（`MaterialPage.tsx`, `DesignPage.tsx`），确认它们当前期望 `string[]` 返回值。在 import 处更新类型，调用处改为读取 `result[i].url`。

具体：
- `new_html/components/MaterialPage.tsx`: `import { generateDoubaoImages } from '../services/doubaoService'` — 找到调用处，将 `result[i]`（字符串）改为 `result[i].url`
- `new_html/pages/DesignPage.tsx`: 同上

- [ ] **Step 3: Commit**

```bash
cd h:\MY2 && git add new_html/services/doubaoService.ts new_html/components/MaterialPage.tsx new_html/pages/DesignPage.tsx
git commit -m "feat: doubaoService returns GeneratedFileResult[], update consumers"
```

---

### Task 14: geminiImageService + geminiService 适配

**Files:**
- Modify: `new_html/services/geminiImageService.ts`
- Modify: `new_html/services/geminiService.ts`

- [ ] **Step 1: geminiImageService 适配双格式返回**

修改 `generateGeminiImageViaProxy()`：
1. Options 类型增加 `entityType?`, `entityId?`, `fileRole?`, `episodeId?`
2. 请求 body 增加 `entity_type`, `entity_id`, `file_role`, `episode_id`
3. 返回类型改为 `GeneratedFileResult[]`
4. 返回值解析逻辑：优先读 `result.files`，兜底读 `result.images`

- [ ] **Step 2: geminiService 透传 entity 参数**

修改 `generateWithComfyUIWorkflow` 和 `generateWithComfyUIWorkflowQueued` 的签名，增加 entity 参数，写入请求 body。

修改 `generateFinalIllustration` 的签名，增加 entity 参数，传给 `generateGeminiImageVariant`。

- [ ] **Step 3: 审计其他消费 `images` 数组的前端文件**

搜索所有读取 `.images` 返回值的前端文件：

```bash
cd h:\MY2\new_html && rg "\.images\b" --glob "*.{ts,tsx}" -l
```

对每个消费者确认是否需要适配新格式。本阶段仅修改主要消费者（GenerationPage, StoryboardGenPage），其余在后续迁移中处理。

- [ ] **Step 4: Commit**

```bash
cd h:\MY2 && git add new_html/services/geminiImageService.ts new_html/services/geminiService.ts
git commit -m "feat: frontend services pass entity params and handle new return format"
```

---

### Task 15: GenerationPage.tsx 删除 linkEntityFile + 传 entity 参数

**Files:**
- Modify: `new_html/components/GenerationPage.tsx`

- [ ] **Step 1: generateForShot ComfyUI 分支传 entity 参数**

找到 `generateForShot` 函数中调用 `generateWithComfyUIWorkflowQueued` 的位置，添加 entity 参数：

```typescript
const resultUrls = await generateWithComfyUIWorkflowQueued(
    workflowType, promptToUse, mainImage, refImages.slice(1), -1,
    (taskId) => { /* ... */ },
    'storyboard_item', shot.id, 'generated_image', episodeId,
);
```

- [ ] **Step 2: 删除 linkEntityFile 调用**

搜索 `linkEntityFile` 在 GenerationPage.tsx 中的所有调用，删除对应的 for 循环或 await 调用。

- [ ] **Step 3: NanoBanana 分支适配 GeneratedFileResult**

修改 NanoBanana 分支的 `generateFinalIllustration` 调用，传入 entity 参数：

```typescript
const result = await generateFinalIllustration(
    promptToUse, refImages,
    'storyboard_item', shot.id, 'generated_image', episodeId,
);
resultUrl = result.url;
```

- [ ] **Step 4: Commit**

```bash
cd h:\MY2 && git add new_html/components/GenerationPage.tsx
git commit -m "feat: GenerationPage passes entity params, removes linkEntityFile"
```

---

### Task 16: StoryboardGenPage 迁移到 React Query

**Files:**
- Modify: `new_html/pages/StoryboardGenPage.tsx`

- [ ] **Step 1: 添加 React Query hook imports**

```typescript
import { useEntityFilesQuery } from '../hooks/useEntityFilesQuery';
import { useSelectFileMutation, useDeleteFileMutation } from '../hooks/useFilesMutation';
```

- [ ] **Step 2: 查找并替换手动 entity file 管理**

搜索以下模式并替换：

1. `fetchEntityFiles` 手动调用 + `setEntityImages` state setter → 替换为 `useEntityFilesQuery` hook
2. `useState` 管理 `entityImages` → 删除该 state，用 `entityFilesData?.items` 代替
3. `selectEntityFile` 手动调用 + `setEntityImages` 更新 → 替换为 `selectFile.mutate({...})`
4. `deleteEntityFile` 手动调用 + `setEntityImages` 过滤 → 替换为 `deleteFile.mutate({...})`

在组件内添加：

```typescript
const { data: entityFilesData, isLoading: filesLoading } = useEntityFilesQuery(
    'storyboard_item', selectedShotId, 'generated_image'
);
const entityFiles = entityFilesData?.items || [];
const selectFile = useSelectFileMutation();
const deleteFile = useDeleteFileMutation();
```

- [ ] **Step 3: 替换事件处理函数**

选定图片：
```typescript
// 旧: await selectEntityFile(fileId, ...); setEntityImages(prev => ...)
// 新:
selectFile.mutate({ fileId, entityType: 'storyboard_item', entityId: selectedShotId!, fileRole: 'generated_image' });
```

删除图片：
```typescript
// 旧: await deleteEntityFile(fileId); setEntityImages(prev => prev.filter(...))
// 新:
deleteFile.mutate({ fileId, entityType: 'storyboard_item', entityId: selectedShotId! });
```

- [ ] **Step 4: 迁移共存处理**

在 Step 2-3 的 mutation hooks 中临时保留 `episodeContext.reload()` 调用，确保其他仍依赖 EpisodeContext 的页面不会数据不一致：

```typescript
const selectFile = useSelectFileMutation();
// 过渡期：mutation 成功后同步 EpisodeContext
const handleSelect = async (fileId: string) => {
    await selectFile.mutateAsync({
        fileId,
        entityType: 'storyboard_item',
        entityId: selectedShotId!,
        fileRole: 'generated_image'
    });
    // 过渡期同步，全部页面迁移后删除
    episodeContext.reload?.();
};
```

- [ ] **Step 5: 验证构建通过**

```bash
cd h:\MY2\new_html && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd h:\MY2 && git add new_html/pages/StoryboardGenPage.tsx
git commit -m "feat: StoryboardGenPage migrated to React Query hooks"
```

---

## 阶段 4：构建部署 + 验证

### Task 17: 前端构建 + deploy 同步

**Files:**
- Build: `new_html/` → `dist/`
- Sync: `deploy/`

- [ ] **Step 1: 前端构建**

```bash
cd h:\MY2\new_html && npm run build
```

Expected: 构建成功，无错误

- [ ] **Step 2: 同步 dist 到 deploy**

```bash
xcopy /E /Y h:\MY2\dist h:\MY2\deploy\dist\
copy /Y h:\MY2\file_service.py h:\MY2\deploy\
copy /Y h:\MY2\cluster_main.py h:\MY2\deploy\
copy /Y h:\MY2\api_routes.py h:\MY2\deploy\
copy /Y h:\MY2\task_queue.py h:\MY2\deploy\
```

- [ ] **Step 3: 端到端验证**

在部署环境中执行以下验证：

1. **Gemini 图片生成**: 调用 `/api/gemini/image` → 检查返回值包含 `files` 数组 → 检查 `files` 表有对应记录
2. **ComfyUI 生成**: 提交任务 → 完成后检查 SSE 消息包含 `entity_type` → 检查 `files` 表有记录
3. **StoryboardGenPage**: 生成图片 → 页面显示 → 刷新页面 → 图片仍在 → 切换到其他页面再切回 → 图片仍在
4. **选定/删除**: 选定一张图片 → 刷新 → 选定状态保持 → 删除一张 → 刷新 → 已删除

- [ ] **Step 4: Commit**

```bash
cd h:\MY2 && git add deploy/ dist/ && git commit -m "build: sync frontend build + updated backend to deploy"
```

---

## 后续计划（本次不实施）

以下工作在本次计划验证通过后，作为独立计划实施：

- **DesignPage 迁移到 React Query** — 替换 JSONB 读取为 useEntityFilesQuery
- **AudioStagePage 迁移** — TTS 使用 useEntityFilesQuery 读取
- **其他页面迁移** — GenerationPage (视频)、VideoGenPage
- **EpisodeContext 瘦身** — 所有页面迁移完成后，保留仅 episodeId/projectId
- **Legacy WorkspaceApp 渐进迁移** — 生成相关逻辑接入 React Query
- **前端返回值消费者全面审计** — 审计所有读取 `.images` 返回值的文件并迁移到 `.files` 格式
