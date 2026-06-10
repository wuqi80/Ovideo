# 统一文件管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 files 表升级为所有生成内容的单一数据源，统一所有页面的文件管理（生成、展示、选定、删除），消除数据丢失问题。

**Architecture:** 在现有 `files` 表上新增 `entity_type`/`entity_id`/`file_role`/`is_selected` 四个字段，建立统一的 entity-files REST API，前端通过一个 `useEntityFiles` Hook 读写所有页面的生成文件。Worker 在保存文件时直接写入 entity 关联信息。向后兼容：新系统写入时同步更新旧 URL 字段。

**Tech Stack:** PostgreSQL, FastAPI (Python), React + TypeScript, asyncpg

**Spec:** `docs/superpowers/specs/2026-03-21-unified-file-management-design.md`

**分阶段交付：** 本计划为 **Phase 1**，覆盖基础设施（DB + DAO + API + Hook）+ StoryboardGenPage 迁移。Phase 2（DesignPage、AudioStagePage、pages/GenerationPage、EnhancePage、VideoGenPage 迁移）将在 Phase 1 验证通过后编写单独计划。

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `db_migration_unified_files.sql` | 创建 | ALTER TABLE files，添加 4 列 + 2 索引 |
| `dao_entity_file.py` | 创建 | Entity-files DAO：按实体查询、选定、软删除 |
| `api_routes.py` | 修改 | 添加 `/api/entity-files` 系列端点 |
| `worker.py` | 修改 | `_save_result_file` 写入 entity 信息 |
| `new_html/services/entityFileService.ts` | 创建 | 前端 entity-files API 封装 |
| `new_html/hooks/useEntityFiles.ts` | 创建 | 统一的 React Hook |
| `new_html/pages/StoryboardGenPage.tsx` | 修改 | 迁移到 useEntityFiles |
| `new_html/components/GenerationPage.tsx` | 修改 | 适配新的文件管理方式 |
| `migrate_existing_files.py` | 创建 | 数据迁移脚本 |

---

### Task 1: 数据库 Schema 变更

**Files:**
- Create: `db_migration_unified_files.sql`

- [ ] **Step 1: 创建迁移 SQL**

```sql
-- db_migration_unified_files.sql
-- 统一文件管理：为 files 表添加 entity 关联字段

ALTER TABLE files ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS entity_id VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS file_role VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS is_selected BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_files_entity
  ON files(entity_type, entity_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_files_entity_role
  ON files(entity_type, entity_id, file_role) WHERE is_deleted = FALSE;
```

- [ ] **Step 2: 在服务器上执行迁移**

Run: `psql -U my2_user -d my2_db -f db_migration_unified_files.sql`
Expected: 4 ALTER TABLE + 2 CREATE INDEX 成功

- [ ] **Step 3: 验证字段已添加**

Run: `psql -U my2_user -d my2_db -c "\d files"`
Expected: 表中出现 `entity_type`, `entity_id`, `file_role`, `is_selected` 四列

- [ ] **Step 4: Commit**

```bash
git add db_migration_unified_files.sql
git commit -m "feat(db): add entity columns to files table for unified file management"
```

---

### Task 2: Entity File DAO

**Files:**
- Create: `dao_entity_file.py`

- [ ] **Step 1: 创建 EntityFileDAO 类**

```python
# dao_entity_file.py
"""Entity File DAO — 按业务实体查询/管理 files 表"""
import json
import uuid
from typing import Any, Dict, List, Optional
from db_manager import get_db_manager


class EntityFileDAO:
    @staticmethod
    async def get_entity_files(
        entity_type: str,
        entity_id: str,
        file_role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        if not db:
            return {"items": [], "total": 0}

        conditions = [
            "entity_type = $1",
            "entity_id = $2",
            "is_deleted = FALSE",
        ]
        params: list = [entity_type, entity_id]
        idx = 3

        if file_role:
            conditions.append(f"file_role = ${idx}")
            params.append(file_role)
            idx += 1

        where = " AND ".join(conditions)

        count_q = f"SELECT COUNT(*) FROM files WHERE {where}"
        total = await db.fetchval(count_q, *params)

        params.extend([limit, offset])
        data_q = f"""
            SELECT * FROM files WHERE {where}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(data_q, *params)
        return {"items": [dict(r) for r in rows], "total": total or 0}

    @staticmethod
    async def link_file(
        file_id: str,
        entity_type: str,
        entity_id: str,
        file_role: str,
        is_selected: bool = False,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """UPDATE files
               SET entity_type = $2, entity_id = $3,
                   file_role = $4, is_selected = $5
               WHERE file_id = $1 AND is_deleted = FALSE
               RETURNING *""",
            file_id, entity_type, entity_id, file_role, is_selected,
        )
        return dict(row) if row else None

    @staticmethod
    async def select_file(
        file_id: str,
        entity_type: str,
        entity_id: str,
        file_role: str,
    ) -> Optional[Dict[str, Any]]:
        """在事务内完成 select：先取消同组选中，再选中目标。"""
        db = get_db_manager()
        if not db:
            return None

        async with db.pool.acquire() as conn:
            async with conn.transaction():
                target = await conn.fetchrow(
                    """SELECT * FROM files
                       WHERE file_id = $1
                         AND entity_type = $2
                         AND entity_id = $3
                         AND file_role = $4
                         AND is_deleted = FALSE
                       FOR UPDATE""",
                    file_id, entity_type, entity_id, file_role,
                )
                if not target:
                    return None

                await conn.execute(
                    """UPDATE files SET is_selected = FALSE
                       WHERE entity_type = $1 AND entity_id = $2
                         AND file_role = $3 AND is_deleted = FALSE""",
                    entity_type, entity_id, file_role,
                )
                row = await conn.fetchrow(
                    """UPDATE files SET is_selected = TRUE
                       WHERE file_id = $1 RETURNING *""",
                    file_id,
                )
                return dict(row) if row else None

    @staticmethod
    async def soft_delete(file_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        row = await db.fetchrow(
            """UPDATE files
               SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE file_id = $1 AND is_deleted = FALSE
               RETURNING file_id""",
            file_id,
        )
        return row is not None

    @staticmethod
    async def soft_delete_entity_files(
        entity_type: str, entity_id: str
    ) -> int:
        db = get_db_manager()
        if not db:
            return 0
        result = await db.execute(
            """UPDATE files
               SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE entity_type = $1 AND entity_id = $2
                 AND is_deleted = FALSE""",
            entity_type, entity_id,
        )
        return int(result.split()[-1]) if result else 0

    @staticmethod
    async def get_selected_file(
        entity_type: str, entity_id: str, file_role: str
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """SELECT * FROM files
               WHERE entity_type = $1 AND entity_id = $2
                 AND file_role = $3 AND is_selected = TRUE
                 AND is_deleted = FALSE""",
            entity_type, entity_id, file_role,
        )
        return dict(row) if row else None
```

- [ ] **Step 2: Commit**

```bash
git add dao_entity_file.py
git commit -m "feat(dao): add EntityFileDAO for unified entity-file queries"
```

---

### Task 3: 后端 API 端点

**Files:**
- Modify: `api_routes.py`

- [ ] **Step 1: 在 api_routes.py 顶部导入 EntityFileDAO**

在 import 区域（约第 21 行附近）追加：

```python
from dao_entity_file import EntityFileDAO
```

- [ ] **Step 2: 添加 Pydantic 模型**

在数据模型区域（约第 50 行之后）追加：

```python
class EntityFileLinkRequest(BaseModel):
    file_id: str
    entity_type: str
    entity_id: str
    file_role: str
    is_selected: bool = False

class EntityFileSelectRequest(BaseModel):
    entity_type: str
    entity_id: str
    file_role: str
```

- [ ] **Step 3: 添加 GET /api/entity-files 端点**

```python
@router.get("/api/entity-files")
async def get_entity_files(
    entity_type: str,
    entity_id: str,
    file_role: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
):
    if limit > 200:
        limit = 200
    result = await EntityFileDAO.get_entity_files(
        entity_type, entity_id, file_role, limit, offset
    )
    return {"success": True, **result}
```

- [ ] **Step 4: 添加 POST /api/entity-files/link 端点**

```python
@router.post("/api/entity-files/link")
async def link_entity_file(
    req: EntityFileLinkRequest,
    user_id: str = Depends(get_current_user),
):
    row = await EntityFileDAO.link_file(
        req.file_id, req.entity_type, req.entity_id,
        req.file_role, req.is_selected,
    )
    if not row:
        raise HTTPException(404, "文件不存在或已删除")
    return {"success": True, "file": row}
```

- [ ] **Step 5: 添加 PUT /api/entity-files/{file_id}/select 端点**

```python
@router.put("/api/entity-files/{file_id}/select")
async def select_entity_file(
    file_id: str,
    req: EntityFileSelectRequest,
    user_id: str = Depends(get_current_user),
):
    row = await EntityFileDAO.select_file(
        file_id, req.entity_type, req.entity_id, req.file_role,
    )
    if not row:
        raise HTTPException(404, "文件不存在或不属于指定实体")

    # 向后兼容：同步更新旧业务表
    await _sync_legacy_url(req.entity_type, req.entity_id, req.file_role, row["file_url"])

    return {"success": True, "file": row}


async def _sync_legacy_url(entity_type: str, entity_id: str, file_role: str, url: str):
    """向后兼容：选定文件后同步更新旧业务表的 URL 字段"""
    db = get_db_manager()
    if not db:
        return
    try:
        if entity_type == "storyboard_item":
            field_map = {
                "generated_image": "generated_image_url",
                "dialogue_audio": "dialogue_audio_url",
                "narration_audio": "narration_audio_url",
                "sfx": "sfx_audio_url",
            }
            col = field_map.get(file_role)
            if col:
                await db.execute(
                    f"UPDATE storyboard_items SET {col} = $1 WHERE item_id = $2",
                    url, entity_id,
                )
        elif entity_type == "asset":
            if file_role == "asset_thumbnail":
                await db.execute(
                    "UPDATE assets SET thumbnail_url = $1 WHERE asset_id = $2",
                    url, entity_id,
                )
        elif entity_type == "video_segment":
            if file_role == "video":
                await db.execute(
                    "UPDATE video_segments SET video_url = $1 WHERE segment_id = $2",
                    url, entity_id,
                )
            elif file_role == "video_thumbnail":
                await db.execute(
                    "UPDATE video_segments SET thumbnail_url = $1 WHERE segment_id = $2",
                    url, entity_id,
                )
    except Exception as e:
        logger.warning(f"同步旧URL字段失败: {e}")
```

- [ ] **Step 6: 添加 DELETE /api/entity-files/{file_id} 端点**

```python
@router.delete("/api/entity-files/{file_id}")
async def delete_entity_file(
    file_id: str,
    user_id: str = Depends(get_current_user),
):
    ok = await EntityFileDAO.soft_delete(file_id)
    if not ok:
        raise HTTPException(404, "文件不存在或已删除")
    return {"success": True}
```

- [ ] **Step 7: Commit**

```bash
git add api_routes.py
git commit -m "feat(api): add entity-files REST endpoints for unified file management"
```

---

### Task 4: Worker 写入 entity 信息

**Files:**
- Modify: `worker.py:1407-1432` (FileDAO.create_file 调用)
- Modify: `dao_content.py:296-330` (FileDAO.create_file 方法)

- [ ] **Step 1: 修改 dao_content.py 的 FileDAO.create_file，增加 entity 参数**

在 `dao_content.py` 的 `create_file` 方法中添加 `entity_type`, `entity_id`, `file_role`, `is_selected` 参数：

```python
@staticmethod
async def create_file(
    version_id: str,
    user_id: str,
    file_type: str,
    file_name: str,
    file_path: str,
    file_url: str,
    file_size_bytes: int,
    mime_type: str = "",
    metadata: Dict = None,
    file_id: str = None,
    entity_type: str = None,
    entity_id: str = None,
    file_role: str = None,
    is_selected: bool = False,
) -> Dict[str, Any]:
    """创建文件记录"""
    db = get_db_manager()
    if not file_id:
        file_id = f"file_{uuid.uuid4().hex[:12]}"
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
    query = """
        INSERT INTO files (
            file_id, version_id, user_id, file_type, file_name,
            file_path, file_url, file_size_bytes, mime_type, metadata,
            entity_type, entity_id, file_role, is_selected
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                $11, $12, $13, $14)
        RETURNING *
    """
    return await db.fetchrow(
        query, file_id, version_id, user_id, file_type, file_name,
        file_path, file_url, file_size_bytes, mime_type, metadata_json,
        entity_type, entity_id, file_role, is_selected,
    )
```

- [ ] **Step 2: 修改 worker.py 的 _save_result_file，从 task_data 提取 entity 信息**

在 `worker.py` 的 `_save_result_file` 方法中（约第 1408-1432 行），修改 `FileDAO.create_file` 调用：

```python
# 从当前任务的 task_data 中提取 entity 信息
entity_type = None
entity_id = None
file_role_val = None
if self.current_task and hasattr(self.current_task, 'data'):
    td = self.current_task.data or {}
    entity_type = td.get('entity_type')
    entity_id = td.get('entity_id')
    file_role_val = td.get('file_role', 'generated_image' if file_type == 'image' else 'video')

file_record = await FileDAO.create_file(
    version_id=version_id,
    user_id=user_id,
    file_type=file_type,
    file_name=unique_filename,
    file_path=str(local_path),
    file_url=file_url,
    file_size_bytes=len(file_content),
    mime_type='video/mp4' if file_type == 'video' else 'image/png',
    metadata={
        'task_id': task_id,
        'prompt_id': prompt_id,
        'original_filename': filename,
        'comfyui_subfolder': subfolder,
        'comfyui_type': downloaded_from
    },
    entity_type=entity_type,
    entity_id=entity_id,
    file_role=file_role_val,
)
```

**关于 task_data 中 entity 信息的策略：**
当前 `cluster_main.py` 的 `generate_comfyui_workflow` 端点在构造 `task_data` 时不包含 `entity_type`/`entity_id`/`file_role`。Phase 1 采用「先孤儿后 link」策略：worker 保存文件时 entity 字段为 NULL，前端在生成完成后通过 `linkEntityFile` API 补充关联。未来 Phase 2 可扩展 `ComfyUIWorkflowRequest` 使前端在提交任务时传入 entity 信息，worker 首次即带 entity。

- [ ] **Step 3: Commit**

```bash
git add dao_content.py worker.py
git commit -m "feat(worker): prepare entity columns in create_file for future use"
```

---

### Task 5: 前端 API 服务

**Files:**
- Create: `new_html/services/entityFileService.ts`

- [ ] **Step 1: 创建 entityFileService.ts**

```typescript
// new_html/services/entityFileService.ts
export interface EntityFile {
  fileId: string;
  fileUrl: string;
  fileType: string;
  fileRole: string;
  isSelected: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

function getHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function normalize(row: any): EntityFile {
  return {
    fileId: row.file_id ?? row.fileId ?? '',
    fileUrl: row.file_url ?? row.fileUrl ?? '',
    fileType: row.file_type ?? row.fileType ?? '',
    fileRole: row.file_role ?? row.fileRole ?? '',
    isSelected: !!(row.is_selected ?? row.isSelected),
    createdAt: row.created_at ?? row.createdAt ?? '',
    metadata: row.metadata,
  };
}

export async function fetchEntityFiles(
  entityType: string,
  entityId: string,
  fileRole?: string,
): Promise<{ items: EntityFile[]; total: number }> {
  const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
  if (fileRole) params.set('file_role', fileRole);
  const res = await fetch(`/api/entity-files?${params}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`fetchEntityFiles failed: ${res.status}`);
  const data = await res.json();
  return {
    items: (data.items || []).map(normalize),
    total: data.total ?? 0,
  };
}

export async function selectEntityFile(
  fileId: string,
  entityType: string,
  entityId: string,
  fileRole: string,
): Promise<EntityFile> {
  const res = await fetch(`/api/entity-files/${fileId}/select`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, file_role: fileRole }),
  });
  if (!res.ok) throw new Error(`selectEntityFile failed: ${res.status}`);
  const data = await res.json();
  return normalize(data.file);
}

export async function deleteEntityFile(fileId: string): Promise<void> {
  const res = await fetch(`/api/entity-files/${fileId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`deleteEntityFile failed: ${res.status}`);
}

export async function linkEntityFile(
  fileId: string,
  entityType: string,
  entityId: string,
  fileRole: string,
  isSelected: boolean = false,
): Promise<EntityFile> {
  const res = await fetch('/api/entity-files/link', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      file_id: fileId, entity_type: entityType,
      entity_id: entityId, file_role: fileRole, is_selected: isSelected,
    }),
  });
  if (!res.ok) throw new Error(`linkEntityFile failed: ${res.status}`);
  const data = await res.json();
  return normalize(data.file);
}
```

- [ ] **Step 2: Commit**

```bash
git add new_html/services/entityFileService.ts
git commit -m "feat(frontend): add entityFileService for unified file API"
```

---

### Task 6: 前端 useEntityFiles Hook

**Files:**
- Create: `new_html/hooks/useEntityFiles.ts`

- [ ] **Step 1: 创建 useEntityFiles Hook**

```typescript
// new_html/hooks/useEntityFiles.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  EntityFile,
  fetchEntityFiles,
  selectEntityFile,
  deleteEntityFile,
} from '../services/entityFileService';

export function useEntityFiles(
  entityType: string,
  entityId: string | undefined | null,
  fileRole?: string,
) {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!entityId) return;
    setIsLoading(true);
    try {
      const result = await fetchEntityFiles(entityType, entityId, fileRole);
      if (mountedRef.current) setFiles(result.items);
    } catch (e) {
      console.error('useEntityFiles refresh error:', e);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [entityType, entityId, fileRole]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedFile = files.find(f => f.isSelected) ?? null;

  const selectFile = useCallback(async (fileId: string) => {
    if (!entityId || !fileRole) return;
    try {
      await selectEntityFile(fileId, entityType, entityId, fileRole);
      setFiles(prev =>
        prev.map(f => ({ ...f, isSelected: f.fileId === fileId })),
      );
    } catch (e) {
      console.error('selectFile error:', e);
    }
  }, [entityType, entityId, fileRole]);

  const removeFile = useCallback(async (fileId: string) => {
    try {
      await deleteEntityFile(fileId);
      setFiles(prev => prev.filter(f => f.fileId !== fileId));
    } catch (e) {
      console.error('deleteFile error:', e);
    }
  }, []);

  return { files, selectedFile, isLoading, selectFile, deleteFile: removeFile, refresh };
}

export type { EntityFile };
```

- [ ] **Step 2: Commit**

```bash
git add new_html/hooks/useEntityFiles.ts
git commit -m "feat(frontend): add useEntityFiles hook for unified file management"
```

---

### Task 7: waitForComfyUITaskAllImages 返回 fileId

**Files:**
- Modify: `new_html/services/geminiService.ts:788-832`

当前 `waitForComfyUITaskAllImages` 返回 `string[]`（纯 URL），但 worker 的 `_save_result_file` 返回值中包含 `file_id`，且 task result 的 `images` 数组每个元素都有 `url` 和 `file_id`。我们需要同时提取 `file_id`，使前端能调用 `linkEntityFile`。

- [ ] **Step 1: 定义返回类型**

在 `geminiService.ts` 的 `waitForComfyUITaskAllImages` 函数上方添加类型：

```typescript
export interface GeneratedImageResult {
  url: string;
  fileId: string | null;
}
```

- [ ] **Step 2: 修改 waitForComfyUITaskAllImages 返回类型**

将签名从 `Promise<string[]>` 改为 `Promise<GeneratedImageResult[]>`，并修改提取逻辑（约第 804-815 行）：

```typescript
// 现有代码（替换）：
// const urls = images.map((img: any) => img.url).filter((url: string) => url);
// resolve(urls);
// 改为：
const results: GeneratedImageResult[] = images
  .filter((img: any) => img.url)
  .map((img: any) => ({
    url: img.url,
    fileId: img.file_id || null,
  }));

if (results.length === 0) {
    reject(new Error('未找到生成结果'));
    return;
}
resolve(results);
```

- [ ] **Step 3: 修改 generateComfyUIWorkflowQueued 的返回类型**

`generateComfyUIWorkflowQueued`（约第 868 行）当前返回 `Promise<string[]>`，改为 `Promise<GeneratedImageResult[]>`。内部调用 `waitForComfyUITaskAllImages` 已返回新类型，无需改逻辑。

- [ ] **Step 4: 更新其他使用 waitForComfyUITaskAllImages 的调用方**

`generateHumanMultiAngleQueued`、`generateAroundAngleQueued` 等也调用了 `waitForComfyUITaskAllImages`。将它们的返回类型同步改为 `Promise<GeneratedImageResult[]>`。

- [ ] **Step 5: Commit**

```bash
git add new_html/services/geminiService.ts
git commit -m "feat(frontend): waitForComfyUITaskAllImages returns fileId"
```

---

### Task 8: GenerationPage 组件适配 — 生成完成后 link entity files

**Files:**
- Modify: `new_html/components/GenerationPage.tsx:330-355`

当前 GenerationPage 在生成完成后调用 `onUpdateStoryboardItem` 存入内存。迁移的核心策略：

**保留 `onUpdateStoryboardItem` 和 `generatedImages` 的内存管理作为 UI 层**，在生成完成后**额外调用** `linkEntityFile` 将文件关联到 entity。这样改动范围最小，只需在 callback 中插入 link 逻辑，不需要大幅重构 GenerationPage。

`useEntityFiles` Hook 在 StoryboardGenPage 中使用，用于**初始加载时**从 DB 读取已持久化的文件，替代 `localImageOverrides` 的功能。

- [ ] **Step 1: 导入 entityFileService**

在 `GenerationPage.tsx` 顶部添加：

```typescript
import { linkEntityFile } from '../services/entityFileService';
```

- [ ] **Step 2: 修改生成完成回调，添加 link 逻辑**

在约第 330-348 行的生成完成处理中，`newImages` 创建后，添加 `linkEntityFile` 调用。
当前代码使用 `urls` (string[])，在 Task 7 修改后变为 `GeneratedImageResult[]`。
修改该部分，使 `newImages` 带上 `fileId`，并在 `onUpdateStoryboardItem` 后 link：

```typescript
const newImages: GeneratedImage[] = results
  .filter((r: GeneratedImageResult) => r.url)
  .map((r: GeneratedImageResult) => ({
    id: uuidv4(),
    url: r.url,
    thumbnail: r.url,
    timestamp: Date.now(),
    fileId: r.fileId || undefined,
  }));

if (newImages.length > 0) {
  onUpdateStoryboardItem(task.shotId, (currentItem: StoryboardItem) => {
    const existing = currentItem.generatedImages || [];
    const unique = newImages.filter(ni => !existing.some(ei => ei.url === ni.url));
    return {
      generatedImages: [...existing, ...unique],
      selectedImageId: newImages[0].id,
      generatedImage: newImages[0].url
    };
  });

  // 异步 link 到 entity（不阻塞 UI），首张自动选中
  for (let i = 0; i < newImages.length; i++) {
    const img = newImages[i];
    if (img.fileId) {
      linkEntityFile(
        img.fileId, 'storyboard_item', task.shotId, 'generated_image',
        i === 0,  // 首张 is_selected=true
      ).catch(e => console.warn('linkEntityFile:', e));
    }
  }
}
```

- [ ] **Step 3: 在 GeneratedImage 类型中添加 fileId**

在 `new_html/types.ts`（或 `types/index.ts`），为 `GeneratedImage` 接口添加可选的 `fileId` 字段：

```typescript
export interface GeneratedImage {
  id: string;
  url: string;
  thumbnail?: string;
  timestamp?: number;
  fileId?: string;  // 新增：files 表的 file_id
}
```

- [ ] **Step 4: 同步修改 recoverTasks 中的恢复路径**

`GenerationPage.tsx` 中约第 310-355 行有 `recoverTasks` 逻辑，它也调用 `waitForComfyUITaskAllImages` 和 `onUpdateStoryboardItem`。需要同样更新为使用 `GeneratedImageResult[]` 和 `linkEntityFile`，保持与主生成路径一致。

- [ ] **Step 5: Commit**

```bash
git add new_html/components/GenerationPage.tsx new_html/types.ts
git commit -m "feat(generation): link generated files to entity after completion"
```

---

### Task 9: StoryboardGenPage 迁移 — 用 entity files 替代 localImageOverrides

**Files:**
- Modify: `new_html/pages/StoryboardGenPage.tsx`

核心改动：页面加载时从 `GET /api/entity-files` 拉取每个镜头已关联的文件；用户选定/删除时调用 `selectEntityFile`/`deleteEntityFile`，实现选中/删除状态的持久化。

- [ ] **Step 1: 导入依赖**

```typescript
import { fetchEntityFiles, selectEntityFile, deleteEntityFile, EntityFile } from '../services/entityFileService';
```

- [ ] **Step 2: 删除 localImageOverrides state（第 38-40 行）**

删除：

```typescript
const [localImageOverrides, setLocalImageOverrides] = useState<
  Record<string, { generatedImages: GeneratedImage[]; selectedImageId?: string; generatedImage?: string }>
>({});
```

替换为：

```typescript
const [entityImages, setEntityImages] = useState<
  Record<string, GeneratedImage[]>
>({});
```

- [ ] **Step 3: 添加从 entity-files API 加载已有文件的逻辑**

```typescript
useEffect(() => {
  if (!storyboardItems.length) return;
  const loadAllEntityImages = async () => {
    const result: Record<string, GeneratedImage[]> = {};
    for (const item of storyboardItems) {
      try {
        const { items } = await fetchEntityFiles(
          'storyboard_item', item.itemId, 'generated_image'
        );
        if (items.length > 0) {
          result[item.itemId] = items.map(ef => ({
            id: ef.fileId,
            url: ef.fileUrl,
            thumbnail: ef.fileUrl,
            timestamp: new Date(ef.createdAt).getTime(),
            fileId: ef.fileId,
          }));
        }
      } catch (e) {
        console.warn(`加载镜头 ${item.itemId} 的图片失败:`, e);
      }
    }
    setEntityImages(result);
  };
  loadAllEntityImages();
}, [storyboardItems]);
```

- [ ] **Step 4: 重写 handleUpdateStoryboardItem（第 42-79 行）**

删除 `localImageOverrides` 相关逻辑。新版本：当收到 `generatedImages` 更新时，更新本地 `entityImages` state（用于即时 UI 渲染）。对于 DB 更新，写入**选中图**的 URL 到 `generated_image_url`（而非永远第一张）：

```typescript
const handleUpdateStoryboardItem = useCallback(
  (shotId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => {
    const currentShot = pseudoFile.storyboard?.items.find(i => i.id === shotId);
    if (!currentShot) return;
    const resolvedUpdates = typeof updates === 'function'
      ? updates(currentShot)
      : updates;

    if (resolvedUpdates.generatedImages) {
      setEntityImages(prev => ({
        ...prev,
        [shotId]: resolvedUpdates.generatedImages!,
      }));
    }

    const dbUpdates = storyboardItemToDbUpdate(resolvedUpdates);

    // 同步选中图的 URL 到旧字段（向后兼容）
    if (resolvedUpdates.selectedImageId && resolvedUpdates.generatedImages) {
      const selected = resolvedUpdates.generatedImages.find(
        img => img.id === resolvedUpdates.selectedImageId
      );
      if (selected) {
        dbUpdates.generated_image_url = selected.url;
        // 调 entity-files select API 持久化选中状态
        if (selected.fileId) {
          selectEntityFile(
            selected.fileId, 'storyboard_item', shotId, 'generated_image'
          ).catch(e => console.warn('selectEntityFile:', e));
        }
        // 同步更新本地 entityImages 的 isSelected
        setEntityImages(prev => {
          const images = prev[shotId];
          if (!images) return prev;
          return {
            ...prev,
            [shotId]: images.map(img => ({
              ...img,
              isSelected: img.id === resolvedUpdates.selectedImageId,
            })),
          };
        });
      }
    } else if (resolvedUpdates.generatedImages?.length) {
      dbUpdates.generated_image_url = resolvedUpdates.generatedImages[0].url;
    }

    // 处理删除：当 generatedImages 比本地少时，找出被删的并调 deleteEntityFile
    if (resolvedUpdates.generatedImages) {
      const prevImages = entityImages[shotId] || [];
      const newIds = new Set(resolvedUpdates.generatedImages.map(img => img.id));
      const removed = prevImages.filter(img => !newIds.has(img.id));
      for (const img of removed) {
        if (img.fileId) {
          deleteEntityFile(img.fileId).catch(e => console.warn('deleteEntityFile:', e));
        }
      }
    }

    if (Object.keys(dbUpdates).length > 0) {
      updateStoryboardItem(shotId, dbUpdates).catch(err => {
        console.error('更新分镜失败:', err);
      });
    }
  },
  [pseudoFile, entityImages],
);
```

- [ ] **Step 5: 修改 enhancedFile（第 97-111 行）使用 entityImages**

同时恢复 `selectedImageId` 和 `generatedImage`，使刷新后选中态正确：

```typescript
const enhancedFile = useMemo(() => {
  if (Object.keys(entityImages).length === 0) return pseudoFile;
  if (!pseudoFile.storyboard) return pseudoFile;
  const enhancedItems = pseudoFile.storyboard.items.map(item => {
    const images = entityImages[item.id];
    if (!images || images.length === 0) return item;
    const selected = images.find(img => (img as any).isSelected) || images[0];
    return {
      ...item,
      generatedImages: images,
      selectedImageId: selected.id,
      generatedImage: selected.url,
    };
  });
  return {
    ...pseudoFile,
    storyboard: { ...pseudoFile.storyboard, items: enhancedItems },
  };
}, [pseudoFile, entityImages]);
```

**注意：** 本地 `entityImages` 中每个 `GeneratedImage` 都携带 `isSelected` 字段（从 API 加载时带入，用户点选时本地同步更新），因此 `enhancedFile` 能在不重新请求 API 的情况下正确反映选中态。

- [ ] **Step 6: 在 entityImages 加载时保留 isSelected 信息**

修改 Step 3 的映射函数，使 `GeneratedImage` 保留 `isSelected`：

```typescript
result[item.itemId] = items.map(ef => ({
  id: ef.fileId,
  url: ef.fileUrl,
  thumbnail: ef.fileUrl,
  timestamp: new Date(ef.createdAt).getTime(),
  fileId: ef.fileId,
  isSelected: ef.isSelected,  // 保留选中态
}));
```

在 `GeneratedImage` 类型中添加 `isSelected?: boolean`（已在 Task 8 Step 3 的类型文件中操作）。

- [ ] **Step 7: 构建验证**

Run: `cd new_html && npm run build`
Expected: 构建成功

- [ ] **Step 8: 处理 link/select 竞态**

`linkEntityFile` 是异步 fire-and-forget，在 link 完成前 `selectEntityFile` 可能因文件尚未关联到 entity 而 404。处理策略：
- 生成完成后，`linkEntityFile` 对首张使用 `is_selected: true`，**不再额外调用 `selectEntityFile`**
- 用户后续手动选定时，文件一般已 link 完成，`selectEntityFile` 正常工作
- 若 `selectEntityFile` 返回 404，在 catch 中延迟 2 秒重试一次

```typescript
const trySelect = async (fileId: string, shotId: string) => {
  try {
    await selectEntityFile(fileId, 'storyboard_item', shotId, 'generated_image');
  } catch {
    setTimeout(async () => {
      try {
        await selectEntityFile(fileId, 'storyboard_item', shotId, 'generated_image');
      } catch (e) {
        console.warn('selectEntityFile retry failed:', e);
      }
    }, 2000);
  }
};
```

- [ ] **Step 9: Commit**

```bash
git add new_html/pages/StoryboardGenPage.tsx
git commit -m "feat(storyboard): replace localImageOverrides with entity files, persist select/delete state"
```

---

### Task 10: 数据迁移脚本

**Files:**
- Create: `migrate_existing_files.py`

- [ ] **Step 1: 创建数据迁移脚本**

```python
# migrate_existing_files.py
"""
将现有业务表中的 URL 字段迁移到 files 表的 entity 关联。
- 查找 storyboard_items, assets, video_segments 中的 URL
- 匹配或创建 files 记录
- 设置 entity_type, entity_id, file_role, is_selected
"""
import asyncio
import json
import uuid
import logging
from db_manager import get_db_manager

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


async def migrate_storyboard_items():
    db = get_db_manager()
    items = await db.fetch(
        "SELECT item_id, generated_image_url, dialogue_audio_url, "
        "narration_audio_url, sfx_audio_url FROM storyboard_items"
    )
    migrated = 0
    for item in items:
        item_id = item['item_id']
        fields = [
            ('generated_image_url', 'generated_image', 'image'),
            ('dialogue_audio_url', 'dialogue_audio', 'audio'),
            ('narration_audio_url', 'narration_audio', 'audio'),
            ('sfx_audio_url', 'sfx', 'audio'),
        ]
        for col, role, ftype in fields:
            url = item.get(col)
            if not url or url.startswith('data:'):
                continue
            ok = await _link_url_to_entity(
                url, 'storyboard_item', item_id, role, ftype
            )
            if ok:
                migrated += 1
    logger.info(f"storyboard_items: migrated {migrated} URLs")


async def migrate_assets():
    db = get_db_manager()
    assets = await db.fetch(
        "SELECT asset_id, thumbnail_url, reference_images FROM assets"
    )
    migrated = 0
    for asset in assets:
        aid = asset['asset_id']
        thumb = asset.get('thumbnail_url')
        if thumb and not thumb.startswith('data:'):
            ok = await _link_url_to_entity(
                thumb, 'asset', aid, 'asset_thumbnail', 'image'
            )
            if ok:
                migrated += 1

        refs = asset.get('reference_images')
        if isinstance(refs, str):
            try:
                refs = json.loads(refs)
            except Exception:
                refs = []
        if isinstance(refs, list):
            for i, url in enumerate(refs):
                if not url or url.startswith('data:'):
                    continue
                ok = await _link_url_to_entity(
                    url, 'asset', aid, 'reference_image', 'image',
                    is_selected=(i == 0),
                )
                if ok:
                    migrated += 1
    logger.info(f"assets: migrated {migrated} URLs")


async def migrate_video_segments():
    db = get_db_manager()
    segs = await db.fetch(
        "SELECT segment_id, video_url, thumbnail_url FROM video_segments"
    )
    migrated = 0
    for seg in segs:
        sid = seg['segment_id']
        for col, role, ftype in [
            ('video_url', 'video', 'video'),
            ('thumbnail_url', 'video_thumbnail', 'image'),
        ]:
            url = seg.get(col)
            if not url:
                continue
            ok = await _link_url_to_entity(url, 'video_segment', sid, role, ftype)
            if ok:
                migrated += 1
    logger.info(f"video_segments: migrated {migrated} URLs")


async def _link_url_to_entity(
    url: str, entity_type: str, entity_id: str,
    file_role: str, file_type: str, is_selected: bool = True,
) -> bool:
    db = get_db_manager()
    clean_url = url.split('?')[0]

    row = await db.fetchrow(
        """SELECT file_id FROM files
           WHERE split_part(file_url, '?', 1) = $1
             AND is_deleted = FALSE
           ORDER BY created_at DESC LIMIT 1""",
        clean_url,
    )
    if row:
        await db.execute(
            """UPDATE files
               SET entity_type = $2, entity_id = $3,
                   file_role = $4, is_selected = $5
               WHERE file_id = $1""",
            row['file_id'], entity_type, entity_id, file_role, is_selected,
        )
        return True

    # 从 URL 路径中提取 user_id（格式: /storage/{type}/{user_id}/{ym}/...）
    parts = clean_url.strip('/').split('/')
    real_user_id = parts[2] if len(parts) > 2 else None

    if not real_user_id:
        # 从业务实体链上查找真正的 user_id
        owner = None
        if entity_type == 'storyboard_item':
            owner = await db.fetchval(
                """SELECT p.user_id FROM storyboard_items si
                   JOIN episodes e ON si.episode_id = e.episode_id
                   JOIN projects p ON e.project_id = p.project_id
                   WHERE si.item_id = $1""",
                entity_id,
            )
        elif entity_type == 'asset':
            owner = await db.fetchval(
                """SELECT p.user_id FROM assets a
                   JOIN episodes e ON a.episode_id = e.episode_id
                   JOIN projects p ON e.project_id = p.project_id
                   WHERE a.asset_id = $1""",
                entity_id,
            )
        elif entity_type == 'video_segment':
            owner = await db.fetchval(
                """SELECT p.user_id FROM video_segments vs
                   JOIN episodes e ON vs.episode_id = e.episode_id
                   JOIN projects p ON e.project_id = p.project_id
                   WHERE vs.segment_id = $1""",
                entity_id,
            )
        if not owner:
            logger.warning(f"无法确定文件所属用户, 跳过: {url} -> {entity_type}/{entity_id}")
            return False
        real_user_id = owner

    fid = f"file_{uuid.uuid4().hex[:12]}"
    await db.execute(
        """INSERT INTO files (file_id, user_id, file_type, file_name,
              file_path, file_url, entity_type, entity_id, file_role, is_selected)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
        fid, real_user_id, file_type, clean_url.split('/')[-1], clean_url, url,
        entity_type, entity_id, file_role, is_selected,
    )
    return True


async def main():
    logger.info("=== 开始迁移 ===")
    await migrate_storyboard_items()
    await migrate_assets()
    await migrate_video_segments()
    logger.info("=== 迁移完成 ===")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: 执行迁移**

Run: `python migrate_existing_files.py`
Expected: 日志显示各表迁移的 URL 数量

- [ ] **Step 3: 验证迁移结果**

Run: `psql -U my2_user -d my2_db -c "SELECT entity_type, file_role, count(*) FROM files WHERE entity_type IS NOT NULL GROUP BY entity_type, file_role ORDER BY 1, 2"`
Expected: 能看到各 entity_type + file_role 的分组计数

- [ ] **Step 4: Commit**

```bash
git add migrate_existing_files.py
git commit -m "feat(migration): add script to migrate existing URLs to entity files"
```

---

### Task 11: 部署与验证

- [ ] **Step 1: 同步后端文件到服务器**

将以下文件复制到服务器部署目录：
- `db_migration_unified_files.sql`
- `dao_entity_file.py`
- `api_routes.py`（修改后）
- `dao_content.py`（修改后）
- `worker.py`（修改后）
- `migrate_existing_files.py`

- [ ] **Step 2: 在服务器上执行数据库迁移**

Run: `psql -U my2_user -d my2_db -f db_migration_unified_files.sql`

- [ ] **Step 3: 重启后端服务**

Run: `sudo systemctl restart my2` (或对应的服务重启命令)

- [ ] **Step 4: 执行数据迁移脚本**

Run: `python migrate_existing_files.py`

- [ ] **Step 5: 构建前端并部署**

Run: `cd new_html && npm run build`
将 `dist/` 目录部署到服务器

- [ ] **Step 6: 端到端测试**

验证清单：
1. 打开分镜页，生成图片 → 4 张图全部显示
2. 点击选定某张图 → 选定状态持久化
3. 刷新页面 → 4 张图仍在，选定状态正确
4. 切换到其他页面再回来 → 数据不丢失
5. 删除某张图 → 图片消失，其他图不受影响
6. 再次生成 → 新图追加到列表

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: deploy unified file management system"
```

---

## Phase 2 范围（本计划不含，Phase 1 验证后编写）

Phase 1 完成后，以下页面将通过独立计划逐步迁移到 `useEntityFiles`：

| 页面 | entity_type | file_role | 优先级 |
|------|-------------|-----------|--------|
| DesignPage | `asset` | `reference_image`, `asset_thumbnail` | P1 |
| AudioStagePage | `storyboard_item` | `dialogue_audio`, `narration_audio`, `sfx` | P1 |
| pages/GenerationPage（视频生成） | `video_segment` | `video`, `video_thumbnail` | P2 |
| EnhancePage | `video_segment` | `enhanced_video` | P2 |
| VideoGenPage | N/A (读取 `useEntityFiles` 数据) | N/A | P3 |

Phase 2 还将包含：
- `POST /api/entity-files/upload` 端点实现
- `cluster_main.py` 扩展 `ComfyUIWorkflowRequest`，在提交任务时传入 entity 信息
- 业务实体删除时联动软删文件的改造
- 完善权限校验（从 entity_id 反查 project 归属）
- TTS 生成后写入 entity 关联
