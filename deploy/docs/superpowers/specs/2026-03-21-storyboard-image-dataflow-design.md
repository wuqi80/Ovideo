# 分镜画面生成 — 数据流设计文档

> 日期: 2026-03-21  
> 状态: Draft  
> 范围: 分镜图片的生成、保存、展示、选定、删除的完整数据流

---

## 1. 问题陈述

分镜页面（StoryboardGenPage → GenerationPage）的"生成-展示-保存-删除"功能存在三个核心缺陷：

1. **选定不生效** — 点击"选定"按钮无反应
2. **刷新丢数据** — 页面刷新或切换后，生成的 4 张图片只剩 1 张
3. **删除无效** — 删除后刷新，被删图片重新出现

## 2. 现有架构分析

### 2.1 已有的统一数据流（正常工作的部分）

```
ComfyUI 生成图片
    ↓
worker._save_result_file()    [worker.py:1326-1465]
    ├─ 💾 磁盘: persistent_storage/image/{user}/{yyyyMM}/{uuid}.png
    ├─ 📊 files 表: FileDAO.create(file_id, file_url, metadata={task_id})
    └─ 返回: {filename, file_id, url, thumbnail_url, size}
    ↓
task_queue.complete_task(task_id, result)    [task_queue.py:231-269]
    ├─ Redis: task.result = {images: [{url, file_id, ...}], videos: []}
    └─ DB tasks 表: result_data JSONB = 同上
    ↓
前端轮询: GET /api/task/{task_id}    [cluster_main.py:1338-1383]
    └─ 返回 task.result (Redis 优先, DB 降级)
    ↓
geminiService.waitForComfyUITaskAllImages()    [geminiService.ts:788-832]
    └─ 提取 result.images[].url → 返回 string[]
    ↓
GenerationPage.generateForShot()    [GenerationPage.tsx:666-795]
    └─ 创建 GeneratedImage[] → 调 onUpdateStoryboardItem()
```

**以上链路正常工作**：图片生成后正确保存到磁盘和 `files` 表，前端正确接收到 URL。

### 2.2 断裂点

```
GenerationPage.onUpdateStoryboardItem(shotId, {generatedImages, selectedImageId, generatedImage})
    ↓
StoryboardGenPage.handleUpdateStoryboardItem()    [StoryboardGenPage.tsx:42-79]
    ├─ ✅ setLocalImageOverrides(React内存态) → 前端即时显示 4 张
    ├─ ❌ storyboardItemToDbUpdate() → 只提取 generatedImage → {generated_image_url: "1个URL"}
    └─ ❌ API PUT /api/storyboard-items/{id} → 只保存了 1 个 URL 到 DB
    ↓
页面刷新
    ├─ localImageOverrides 清空 (React state 丢失)
    ├─ EpisodeContext.reload() → GET storyboard items → generated_image_url = "1个URL"
    ├─ dbItemToStoryboardItem() → generatedImages: [{只有1张}]
    └─ 结果: 4 张图变 1 张
```

**根本原因：`storyboard_items` 表和 `files`/`tasks` 表之间没有任何关联。**

- `storyboard_items.generated_image_url`：TEXT 类型，只能存 1 个 URL
- `localImageOverrides`：纯 React state，刷新即失
- 生成的图片虽然已经持久化在 `files` 表中，但 storyboard_items 不知道

### 2.3 各操作的具体断裂

| 操作 | 调用链 | 问题 |
|------|--------|------|
| **选定** | `handleSelectResult` → `onUpdateStoryboardItem({selectedImageId, generatedImage})` | `handleUpdateStoryboardItem` 只在有 `generatedImages` 时更新 `localImageOverrides`，选定不含 `generatedImages`，所以被忽略 |
| **删除** | `handleDeleteResult` → `onUpdateStoryboardItem({generatedImages: filtered, ...})` | 本地生效（有 `generatedImages`），但 DB 只存 `generated_image_url=第一张`，刷新后被删图片可能复活 |
| **刷新** | `EpisodeContext.loadSlices()` → `dbItemToStoryboardItem()` | 从 DB 只能恢复 1 个 URL，其余全丢 |

## 3. 已有基础设施

| 组件 | 位置 | 作用 |
|------|------|------|
| `files` 表 | `database_schema.sql:62-82` | 统一文件记录，含 `file_id`, `file_url`, `metadata` (含 `task_id`) |
| `task_files` 关联表 | `database_schema.sql:139-149` | `task_id ↔ file_id` 多对多关联 |
| `tasks` 表 | `database_schema.sql:112-131` | 含 `result_data JSONB`，存完整的 `{images: [...]}` |
| `FileDAO` | `dao_file.py` | files 表 CRUD，含 `get_by_task_id()` 方法 |
| `FileService` | `file_service.py` | 统一文件注册入口（已定义，待接入） |
| `worker._save_result_file()` | `worker.py:1326-1465` | 生成结果自动存 files + 磁盘 |
| `taskRecovery.ts` | `services/taskRecovery.ts` | localStorage 存 `{taskId, shotId}` 映射（瞬态） |

## 4. 设计方案

### 方案: 新建 `storyboard_item_files` 关联表

跟已有的 `task_files` 完全一致的模式。

#### 4.1 数据库

```sql
CREATE TABLE IF NOT EXISTS storyboard_item_files (
    id SERIAL PRIMARY KEY,
    item_id VARCHAR(50) NOT NULL REFERENCES storyboard_items(item_id) ON DELETE CASCADE,
    file_id VARCHAR(50) NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    is_selected BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(item_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_sif_item_id ON storyboard_item_files(item_id);
CREATE INDEX IF NOT EXISTS idx_sif_file_id ON storyboard_item_files(file_id);
```

#### 4.2 后端 API

**新增 DAO: `dao_storyboard_item_files.py`**

```python
class StoryboardItemFileDAO:
    @staticmethod
    async def add_file(item_id: str, file_id: str, is_selected: bool = False) -> dict
    
    @staticmethod
    async def remove_file(item_id: str, file_id: str) -> bool
    
    @staticmethod
    async def set_selected(item_id: str, file_id: str) -> bool
        # UPDATE SET is_selected = FALSE WHERE item_id = ?
        # UPDATE SET is_selected = TRUE WHERE item_id = ? AND file_id = ?
    
    @staticmethod
    async def get_files(item_id: str) -> list[dict]
        # SELECT f.* FROM files f
        #   JOIN storyboard_item_files sif ON f.file_id = sif.file_id
        #   WHERE sif.item_id = ?
        #   ORDER BY sif.sort_order
    
    @staticmethod
    async def get_files_by_episode(episode_id: str) -> dict[str, list]
        # 批量查询一集所有分镜的图片，避免 N+1 查询
```

**修改 API 路由 (api_routes.py)**

```python
# 新增: 分镜图片关联
POST   /api/storyboard-items/{item_id}/files          → 添加图片
DELETE /api/storyboard-items/{item_id}/files/{file_id} → 删除图片  
PUT    /api/storyboard-items/{item_id}/files/{file_id}/select → 选定图片

# 修改: 获取分镜列表时附带图片
GET /api/episodes/{episode_id}/storyboard-items → 返回每个 item 的 files 列表
```

#### 4.3 前端改动

**EpisodeContext.tsx**:
- `normalizeStoryboardItem()` 增加读取 `generated_files` 字段
- `loadSlices('storyboardItems')` 后端返回含 files 的完整数据

**episodeAdapters.ts**:
- `dbItemToStoryboardItem()` 从 `item.generated_files[]` 构建 `generatedImages[]`
- 不再依赖单个 `generatedImageUrl` 字段（保留兼容但不作为主数据源）

**StoryboardGenPage.tsx**:
- 删除 `localImageOverrides` 状态（不再需要临时覆盖层）
- `handleUpdateStoryboardItem()` 改为调用新的关联 API：
  - 生成完 → `POST /storyboard-items/{id}/files` 批量添加
  - 选定 → `PUT /storyboard-items/{id}/files/{fileId}/select`
  - 删除 → `DELETE /storyboard-items/{id}/files/{fileId}`
  - 每个操作完成后 `reload()` 刷新数据

**GenerationPage.tsx**:
- 生成完成后，`onUpdateStoryboardItem` 传递 `file_id`（从 `task.result.images[].file_id` 获得）
- 或者由 StoryboardGenPage 通过 `task_id` 查 `files` 表获取 `file_id` 列表

#### 4.4 修正后的完整数据流

```
[生成]
ComfyUI → worker 存 files 表 (file_id, url)
    → task.result = {images: [{file_id, url}]}
    → 前端收到 url[] 和 file_id[]
    → POST /storyboard-items/{item_id}/files → INSERT storyboard_item_files
    → reload() 刷新

[展示]
GET /episodes/{ep}/storyboard-items
    → 后端 JOIN storyboard_item_files + files
    → 返回每个 item 的完整 files 列表
    → 前端渲染全部图片

[选定]
PUT /storyboard-items/{item_id}/files/{file_id}/select
    → UPDATE storyboard_item_files SET is_selected
    → 同时更新 storyboard_items.generated_image_url (兼容)
    → reload()

[删除]
DELETE /storyboard-items/{item_id}/files/{file_id}
    → DELETE FROM storyboard_item_files
    → 可选: FileDAO.soft_delete(file_id)
    → reload()

[刷新/切换页面/重新登录]
    → 与 [展示] 相同，从 DB 完整恢复
    → 无数据丢失
```

## 5. 注意事项

- **向后兼容**: 保留 `generated_image_url` 字段作为"选定的封面图"，新老数据并存
- **前端去除 localImageOverrides**: 这个临时状态是所有 bug 的根源，彻底删除
- **file_id 的获取**: 目前 `waitForComfyUITaskAllImages` 只提取 `url`，需要同时提取 `file_id`
- **N+1 查询**: `get_files_by_episode()` 批量查询，避免每个分镜单独查一次
- **磁盘清理**: `storyboard_item_files` 的 DELETE 不自动删磁盘文件，需要定期清理 `files.is_deleted = TRUE` 的文件

## 6. 关键文件清单

| 层 | 文件 | 改动 |
|----|------|------|
| DB | `db_migration_storyboard_item_files.sql` | 新建关联表 |
| 后端 DAO | `dao_storyboard_item_files.py` | 新建 |
| 后端 API | `api_routes.py` | 新增 3 个路由，修改 GET storyboard-items |
| 前端 Context | `EpisodeContext.tsx` | normalizeStoryboardItem 读 files |
| 前端 Adapter | `episodeAdapters.ts` | 从 files 构建 generatedImages |
| 前端页面 | `StoryboardGenPage.tsx` | 删除 localImageOverrides，调用新 API |
| 前端服务 | `geminiService.ts` | waitForComfyUITaskAllImages 返回 file_id |
| 前端组件 | `GenerationPage.tsx` | 传递 file_id 给回调 |
