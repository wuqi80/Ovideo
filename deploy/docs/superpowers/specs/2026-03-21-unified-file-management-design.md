# 统一文件管理设计

## 问题

当前系统中，生成内容（图片、音频、视频）的 URL 散落在各个业务表的独立字段里。每个页面用不同方式存储，导致：

1. **分镜页**：生成 4 张图只能存 1 张 URL（`storyboard_items.generated_image_url` TEXT），其余存在内存中，刷新/切换页面即丢失
2. **配音页**：每条台词只能存 1 个音频版本，无法对比多个配音效果
3. **视频生成页**：每个片段只能存 1 个视频版本，无法"抽卡"选最好的
4. **增强页**：编辑状态纯内存，刷新全部丢失
5. **设计页**：虽然用 JSONB 存多张图（`assets.reference_images`），但与其他页面不统一

核心矛盾：**每个生成步骤都可能产出多个结果供用户选择，但大部分业务表只有单个 URL 字段。**

## 现有架构分析

### 各页面当前数据存储

| 页面 | 业务表 | 存储字段 | 能存多个？ | 刷新丢？ |
|------|--------|---------|-----------|---------|
| Script 剧本 | `episode_scripts` | TEXT | N/A | 不丢 |
| Design 设计 | `assets` | `reference_images` JSONB, `thumbnail_url` TEXT | ✅ | 不丢 |
| Materials 素材 | `assets` + `storyboard_items` | `bound_assets` JSONB | N/A | 不丢 |
| Audio 配音 | `storyboard_items` | `dialogue_audio_url` TEXT, `narration_audio_url` TEXT | ❌ | 不丢(只存1个) |
| Storyboard 分镜 | `storyboard_items` | `generated_image_url` TEXT + `localImageOverrides`(内存) | ❌ | **丢** |
| Generation 视频 | `video_segments` | `video_url` TEXT | ❌ | 不丢(只存1个) |
| Video 工作台 | workspace session | 会话存储 | 部分 | 部分丢 |
| Enhance 增强 | 无 | 纯内存 | N/A | **全丢** |

### 已有的 files 表

`files` 表已存在且 Worker 已经往里写数据（每次 ComfyUI 生成图片/视频，Worker 的 `_save_result_file` 都会创建 files 记录）。但前端从未读过 `files` 表——生成物的 URL 直接写入各业务表。

## 设计方案：统一 files 表管理

### 核心思路

`files` 表成为所有生成内容的**单一数据源**。通过 `entity_type` + `entity_id` + `file_role` 三个字段，每个文件知道自己属于哪个业务实体。所有页面通过同一套 API 和同一个前端 Hook 来读写文件。

### 数据库变更

在 `files` 表上新增 4 个字段：

```sql
ALTER TABLE files ADD COLUMN entity_type VARCHAR(50);
-- 'storyboard_item' | 'asset' | 'video_segment'

ALTER TABLE files ADD COLUMN entity_id VARCHAR(50);
-- 业务实体 ID，即各业务表的主键值 (item_id, asset_id, segment_id)

ALTER TABLE files ADD COLUMN file_role VARCHAR(50);
-- 'generated_image' | 'reference_image' | 'dialogue_audio' | 'narration_audio'
-- | 'sfx' | 'video' | 'video_thumbnail' | 'asset_thumbnail' | 'enhanced_video'

ALTER TABLE files ADD COLUMN is_selected BOOLEAN DEFAULT FALSE;
-- 用户选定的版本

CREATE INDEX idx_files_entity ON files(entity_type, entity_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_files_entity_role ON files(entity_type, entity_id, file_role) WHERE is_deleted = FALSE;
```

**约束：同一 (entity_type, entity_id, file_role) 组内至多一个 `is_selected = TRUE`。** Select 操作在事务内执行，使用 `SELECT ... FOR UPDATE` 锁行防止并发冲突。

**与 `version_id` 的关系：** 本系统中 entity 文件不依赖 `version_id`。`files.version_id` 保持可选（NULL），entity 文件通过 `entity_type` + `entity_id` 关联到业务实体，业务实体自身挂在 `episode_id` 下。版本管理由业务层决定，files 表不做版本过滤。

**与 `task_files.file_role` 的区别：** `task_files.file_role` 表示文件在任务中的角色（input/output/intermediate），`files.file_role` 表示文件在业务实体中的用途（generated_image/dialogue_audio 等），两者含义不同，互不影响。

查询示例：
```sql
-- 获取某分镜的所有生成图片
SELECT * FROM files
WHERE entity_type = 'storyboard_item'
  AND entity_id = 'sb_xxx'
  AND file_role = 'generated_image'
  AND is_deleted = FALSE
ORDER BY created_at;

-- 获取选定的那张
SELECT * FROM files
WHERE entity_type = 'storyboard_item'
  AND entity_id = 'sb_xxx'
  AND file_role = 'generated_image'
  AND is_selected = TRUE
  AND is_deleted = FALSE;
```

### 后端 API

统一的文件管理端点：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/entity-files` | GET | 获取实体的文件列表（支持 entity_type, entity_id, file_role 过滤） |
| `/api/entity-files/link` | POST | 关联已有文件到实体 |
| `/api/entity-files/{file_id}/select` | PUT | 选定文件（取消同实体同角色的其他选定） |
| `/api/entity-files/{file_id}` | DELETE | 软删除文件 |
| `/api/entity-files/upload` | POST | 上传文件并关联到实体 |

#### Select 逻辑

```
PUT /api/entity-files/{file_id}/select
Body: { entity_type, entity_id, file_role }

后端执行 (在单个事务内):
0. 校验: 查询 files WHERE file_id = :file_id，确认:
   - 该文件的 entity_type, entity_id, file_role 与请求体一致
   - 该文件的 user_id 与当前登录用户一致（或属于用户的项目）
   - 文件未被软删除 (is_deleted = FALSE)
   → 不匹配则返回 403/404
1. SELECT ... FOR UPDATE: 锁定同组所有文件
2. UPDATE files SET is_selected = FALSE
   WHERE entity_type = :type AND entity_id = :id AND file_role = :role;
3. UPDATE files SET is_selected = TRUE WHERE file_id = :file_id;
4. 向后兼容: 更新旧业务表的 URL 字段
   例: UPDATE storyboard_items SET generated_image_url = (选定文件的URL)
       WHERE item_id = :entity_id;
```

#### GET 端点分页

```
GET /api/entity-files?entity_type=X&entity_id=Y&file_role=Z&limit=50&offset=0
- 默认 limit=50, 最大 200
- 默认排序: created_at DESC
- 返回 { items: EntityFile[], total: number }
```

#### 权限校验

所有 entity-files 端点需校验当前用户有权访问该 entity：
- 从 entity_id 反查业务表 → 获取 project_id/episode_id
- 校验 project.user_id = 当前用户
- `files.user_id` 在创建时写入当前用户 ID

#### 文件来源与 entity 写入时机

| 文件来源 | 谁写 entity 信息 | 时机 | task_data 中的必填键 |
|----------|-----------------|------|---------------------|
| Worker 生成（ComfyUI 图片/视频） | Worker 的 `_save_result_file` | 保存时 | `entity_type`, `entity_id`, `file_role`（缺失时 entity 字段留 NULL，成为孤儿文件） |
| TTS 音频 | 后端 TTS API | 生成完成后 | N/A（由 API 路由参数确定） |
| 用户上传（DesignPage 上传图片） | 前端调 `/api/entity-files/upload` | 上传时 | N/A（由请求体传入） |

#### 实体删除时的文件处理

当业务实体被删除时（如删除分镜、删除资产），关联文件的处理规则：

- `files` 表通过 `entity_id` 字符串关联，无外键约束
- 业务表删除时，**不自动级联删除 files**
- 由后端的删除 API 负责：删除业务实体时，同时将其关联的 files 软删除（`is_deleted = TRUE`）
- 孤儿文件（entity 被删但 file 未清理）通过定期清理任务处理

### 前端架构

#### 核心 Hook: `useEntityFiles`

```typescript
function useEntityFiles(entityType: string, entityId: string, fileRole?: string) {
  return {
    files: EntityFile[],
    selectedFile: EntityFile | null,
    isLoading: boolean,

    selectFile(fileId: string): Promise<void>,
    deleteFile(fileId: string): Promise<void>,
    refresh(): Promise<void>,
  };
}

interface EntityFile {
  fileId: string;
  fileUrl: string;
  fileType: string;
  isSelected: boolean;
  createdAt: string;
  metadata?: Record<string, any>;
}
```

#### 各页面调用方式

| 页面 | Hook 调用 | 替代的旧逻辑 |
|------|----------|------------|
| StoryboardGenPage | `useEntityFiles('storyboard_item', shotId, 'generated_image')` | `localImageOverrides` + `generated_image_url` |
| DesignPage | `useEntityFiles('asset', assetId, 'reference_image')` | `asset.referenceImages` JSONB |
| AudioStagePage | `useEntityFiles('storyboard_item', itemId, 'dialogue_audio')` | `item.dialogueAudioUrl` |
| GenerationPage | `useEntityFiles('video_segment', segId, 'video')` | `segment.videoUrl` |
| EnhancePage | `useEntityFiles('video_segment', segId, 'enhanced_video')` | 纯内存 state |

#### 核心改变

1. **删除 `localImageOverrides`** — 数据全在 DB，不需要内存临时状态
2. **删除各页面的 URL 字段直接读取** — 改为 `useEntityFiles`
3. **页面刷新/切换** — Hook 重新从 API 拉取，数据永不丢失
4. **选定/删除** — 调 Hook 方法，后端同步更新

### 数据迁移

#### 迁移映射表

| 旧位置 | → files 的 entity_type | → file_role | is_selected |
|--------|----------------------|-------------|-------------|
| `storyboard_items.generated_image_url` | `storyboard_item` | `generated_image` | `true` |
| `storyboard_items.dialogue_audio_url` | `storyboard_item` | `dialogue_audio` | `true` |
| `storyboard_items.narration_audio_url` | `storyboard_item` | `narration_audio` | `true` |
| `storyboard_items.sfx_audio_url` | `storyboard_item` | `sfx` | `true` |
| `assets.reference_images[0..n]` | `asset` | `reference_image` | 首张 `true`（最佳努力，用户可重选） |
| `assets.thumbnail_url` | `asset` | `asset_thumbnail` | `true` |
| `video_segments.video_url` | `video_segment` | `video` | `true` |
| `video_segments.thumbnail_url` | `video_segment` | `video_thumbnail` | `true` |

#### 迁移逻辑

1. 遍历各业务表中的 URL 字段
2. 对每个 URL，优先通过 `task_files` + `files.file_url` 匹配（精确），其次通过 URL 路径部分匹配（去除 query 参数、token 等）
3. 已存在 → 更新 `entity_type`, `entity_id`, `file_role`, `is_selected`
4. 不存在（用户上传的 base64、外部 URL）→ 创建新 files 记录
5. base64 数据 URL → 解码为文件 → 存到 `persistent_storage` → 创建 files 记录
6. 同一 URL 在 files 表中有多条记录时，取最新的（`created_at DESC LIMIT 1`）

#### 向后兼容策略

- 迁移期间：旧 URL 字段保留，新系统写入时同步更新旧字段
- 已迁移页面：从 `useEntityFiles` 读取
- 未迁移页面：仍从旧字段读取
- 全部页面迁移完成后：旧 URL 字段降为只读冗余

### 页面迁移顺序

1. **StoryboardGenPage**（最紧急，核心 bug）
2. **DesignPage**（已有多图支持，切换到统一 API）
3. **AudioStagePage**（增加多版本配音支持）
4. **GenerationPage**（增加多视频"抽卡"支持）
5. **EnhancePage**（从纯内存改为持久化）
6. **VideoGenPage**（间接受益，读取统一数据）

### 不涉及的页面

- **ScriptPage**：文本编辑，不涉及文件管理
- **MaterialsPage**：素材绑定逻辑（`bound_assets`），不直接管理文件；读取 assets 的参考图会通过 `useEntityFiles` 间接受益
- **HistoryPage**：只读展示
- **CanvasPage**：独立功能

### VideoGenPage 与会话存储

VideoGenPage 通过 `videoService.saveWorkspaceSession` 管理工作区会话，导入的分镜图 URL 来自 `storyboard_items.generated_image_url`。迁移后，VideoGenPage 读取选定图片时走 `useEntityFiles` 获取 `is_selected = true` 的文件 URL，会话数据仅缓存 UI 状态（分组、排序等），不再缓存文件 URL。

### file_role 枚举说明

| file_role | 含义 | 使用场景 |
|-----------|------|---------|
| `generated_image` | AI 生成的分镜图片 | StoryboardGenPage |
| `reference_image` | 素材参考图 | DesignPage |
| `asset_thumbnail` | 资产封面缩略图 | DesignPage |
| `dialogue_audio` | 台词配音 | AudioStagePage |
| `narration_audio` | 旁白配音 | AudioStagePage |
| `sfx` | 音效 | AudioStagePage |
| `video` | 生成的视频片段 | GenerationPage |
| `video_thumbnail` | 视频缩略图 | GenerationPage |
| `enhanced_video` | 增强后的视频 | EnhancePage |
