# HistoryPage 删除确认弹窗 + 磁盘硬删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `/api/user-files` 500 错误，然后将 HistoryPage 的删除按钮改为弹出确认弹窗（替代 browser confirm），后端增加硬删除功能同时删除磁盘文件和 DB 记录。

**Architecture:** 先修复 `api_routes.py` 中 `fetchrow` 返回 dict 却用 `[0]` 索引导致 `KeyError` 的 bug。然后新增后端硬删除 DAO 方法 + API 端点，前端在 HistoryPage 内联一个 DeleteConfirmModal 组件替代所有 `window.confirm()` 调用。弹窗显示待删除文件的预览、信息，并提供"同时删除磁盘文件"选项来决定走硬删除还是软删除。

**Tech Stack:** Python/FastAPI (后端), React/TypeScript/Tailwind (前端), PostgreSQL (数据库)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `api_routes.py:2409-2410` | **[BUG FIX]** 修复 `total_row[0]` KeyError 导致 500 |
| Modify | `dao_entity_file.py` | 新增 `hard_delete` 静态方法 |
| Modify | `api_routes.py` | 新增 `DELETE /api/entity-files/{file_id}/hard` 端点 + `POST /api/entity-files/hard-delete-batch` 端点 |
| Modify | `new_html/services/entityFileService.ts` | 新增 `hardDeleteEntityFile` 和 `hardDeleteEntityFiles` 前端函数 |
| Modify | `new_html/components/HistoryPage.tsx` | 内联 `DeleteConfirmModal` 组件，替换所有 `confirm()` 调用 |

---

### Task 0: **[CRITICAL BUG FIX]** 修复 `/api/user-files` 500 错误

**Root Cause:**

`api_routes.py` 第 2409-2410 行：

```python
total_row = await db.fetchrow(count_query, *args)
total = total_row[0] if total_row else len(items)
```

`db.fetchrow()` (在 `db_manager.py:82-86`) 把 `asyncpg.Record` 转成了 **Python dict**。
`SELECT COUNT(*)` 返回列名 `count`，所以 `total_row = {'count': N}`。
`total_row[0]` 用整数 `0` 查字典 → **`KeyError: 0`** → 500 Internal Server Error。

之前未暴露因为 HistoryPage 以前用 `/api/tasks` 端点，最近重写才切到 `/api/user-files`。

**Files:**
- Modify: `api_routes.py:2408-2410`

- [ ] **Step 1: 替换 `fetchrow` + `[0]` 为 `fetchval`**

将 `api_routes.py` 第 2408-2410 行：

```python
    db = get_db_manager()
    total_row = await db.fetchrow(count_query, *args)
    total = total_row[0] if total_row else len(items)
```

替换为：

```python
    db = get_db_manager()
    total = await db.fetchval(count_query, *args) or 0
```

- [ ] **Step 2: 同步到 deploy**

```powershell
copy api_routes.py deploy\api_routes.py
```

- [ ] **Step 3: Commit**

```bash
git add api_routes.py deploy/api_routes.py
git commit -m "fix: KeyError on /api/user-files — fetchrow returns dict, not Record"
```

---

### Task 1: 后端 — DAO 硬删除方法

**Files:**
- Modify: `dao_entity_file.py:110-122` (在 `soft_delete` 方法之后添加)

- [ ] **Step 1: 在 `EntityFileDAO` 类中添加 `hard_delete` 方法**

在 `dao_entity_file.py` 的 `soft_delete` 方法（第 122 行）后面，添加：

```python
    @staticmethod
    async def hard_delete(file_id: str) -> Optional[Dict[str, Any]]:
        """硬删除：删除磁盘文件 + 数据库记录。返回被删文件信息或 None。"""
        import os
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            "SELECT file_id, file_path, file_size_bytes FROM files WHERE file_id = $1",
            file_id,
        )
        if not row:
            return None

        file_path = row["file_path"]
        freed_bytes = row["file_size_bytes"] or 0

        if file_path:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except OSError as e:
                import logging
                logging.getLogger(__name__).warning(f"磁盘文件删除失败 {file_path}: {e}")

        await db.execute("DELETE FROM files WHERE file_id = $1", file_id)
        return {"file_id": file_id, "freed_bytes": freed_bytes}
```

- [ ] **Step 2: 在 `EntityFileDAO` 类中添加 `hard_delete_batch` 方法**

紧接着 `hard_delete` 方法后面添加：

```python
    @staticmethod
    async def hard_delete_batch(file_ids: list) -> Dict[str, Any]:
        """批量硬删除多个文件。返回 {deleted: int, freed_bytes: int, errors: [...]}。"""
        import os
        import logging
        logger = logging.getLogger(__name__)
        db = get_db_manager()
        if not db:
            return {"deleted": 0, "freed_bytes": 0, "errors": ["DB 不可用"]}

        rows = await db.fetch(
            "SELECT file_id, file_path, file_size_bytes FROM files WHERE file_id = ANY($1)",
            file_ids,
        )

        deleted = 0
        freed_bytes = 0
        errors = []

        for row in rows:
            fid = row["file_id"]
            fpath = row["file_path"]
            if fpath:
                try:
                    if os.path.exists(fpath):
                        os.remove(fpath)
                except OSError as e:
                    logger.warning(f"磁盘文件删除失败 {fpath}: {e}")
                    errors.append(f"{fid}: {e}")

            await db.execute("DELETE FROM files WHERE file_id = $1", fid)
            deleted += 1
            freed_bytes += row["file_size_bytes"] or 0

        return {"deleted": deleted, "freed_bytes": freed_bytes, "errors": errors}
```

- [ ] **Step 3: 确认 import 完整**

`dao_entity_file.py` 文件头部已有 `from typing import Any, Dict, List, Optional`，无需修改。`os` 和 `logging` 在方法内部 import，无需修改文件头。

- [ ] **Step 4: Commit**

```bash
git add dao_entity_file.py
git commit -m "feat: add hard_delete and hard_delete_batch to EntityFileDAO"
```

---

### Task 2: 后端 — API 硬删除端点

**Files:**
- Modify: `api_routes.py:2556` (在现有 `delete_entity_file` 端点之后)

- [ ] **Step 1: 在 `api_routes.py` 的 `delete_entity_file` 函数后（第 2556 行之后）添加两个新端点**

```python
@router.delete("/api/entity-files/{file_id}/hard")
async def hard_delete_entity_file(
    file_id: str,
    user_id: str = Depends(get_current_user),
):
    """硬删除：同时删除磁盘文件和数据库记录"""
    result = await EntityFileDAO.hard_delete(file_id)
    if not result:
        raise HTTPException(404, "文件不存在")
    return {"success": True, "freed_bytes": result["freed_bytes"]}


class HardDeleteBatchRequest(BaseModel):
    file_ids: List[str]


@router.post("/api/entity-files/hard-delete-batch")
async def hard_delete_entity_files_batch(
    request: HardDeleteBatchRequest,
    user_id: str = Depends(get_current_user),
):
    """批量硬删除：同时删除磁盘文件和数据库记录"""
    if len(request.file_ids) > 200:
        raise HTTPException(400, "单次最多删除 200 个文件")
    result = await EntityFileDAO.hard_delete_batch(request.file_ids)
    return {"success": True, **result}
```

- [ ] **Step 2: 确认 import**

`api_routes.py` 文件头部已有 `from pydantic import BaseModel` 和 `from typing import List`，以及 `from dao_entity_file import EntityFileDAO`。无需新增 import。

- [ ] **Step 3: Commit**

```bash
git add api_routes.py
git commit -m "feat: add hard delete API endpoints for entity files"
```

---

### Task 3: 前端 — entityFileService 新增硬删除函数

**Files:**
- Modify: `new_html/services/entityFileService.ts:89` (在 `deleteEntityFile` 函数之后)

- [ ] **Step 1: 在 `deleteEntityFile` 函数（第 90 行）之后添加两个新函数**

```typescript
export async function hardDeleteEntityFile(fileId: string): Promise<{ freed_bytes: number }> {
  const res = await fetch(`/api/entity-files/${fileId}/hard`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`hardDeleteEntityFile failed: ${res.status}`);
  return res.json();
}

export async function hardDeleteEntityFiles(fileIds: string[]): Promise<{ deleted: number; freed_bytes: number; errors: string[] }> {
  const res = await fetch('/api/entity-files/hard-delete-batch', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ file_ids: fileIds }),
  });
  if (!res.ok) throw new Error(`hardDeleteEntityFiles failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add new_html/services/entityFileService.ts
git commit -m "feat: add hardDeleteEntityFile and hardDeleteEntityFiles to entityFileService"
```

---

### Task 4: 前端 — HistoryPage 删除确认弹窗

**Files:**
- Modify: `new_html/components/HistoryPage.tsx` (整体重构删除逻辑 + 新增内联 Modal)

这是最大的一个任务。分为 4 个子步骤。

- [ ] **Step 1: 在 HistoryPage.tsx 顶部更新 import**

将第 2-3 行替换为：

```typescript
import { History, Download, Trash2, RefreshCw, CheckSquare, Square, Film, Image as ImageIcon, Play, Clock, AlertTriangle, X, HardDrive, ShieldAlert } from 'lucide-react';
import { fetchUserFiles, deleteEntityFile, hardDeleteEntityFile, hardDeleteEntityFiles, type EntityFile } from '../services/entityFileService';
```

- [ ] **Step 2: 添加 DeleteConfirmModal 状态和类型**

在 `export const HistoryPage` 组件内部，在现有 state 声明之后（`previewType` 之后），添加：

```typescript
  const [deleteModal, setDeleteModal] = useState<{
    mode: 'single' | 'batch';
    files: EntityFile[];
  } | null>(null);
  const [hardDelete, setHardDelete] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
```

- [ ] **Step 3: 替换 `deleteFile` 和 `deleteSelected` 函数**

将现有的 `deleteFile` 函数（约第 127-138 行）替换为：

```typescript
  const openDeleteModal = (file: EntityFile) => {
    setDeleteModal({ mode: 'single', files: [file] });
    setHardDelete(true);
    setDeleteProgress(null);
  };

  const openBatchDeleteModal = () => {
    if (selectedTasks.size === 0) return;
    const selected = files.filter(f => selectedTasks.has(f.fileId));
    setDeleteModal({ mode: 'batch', files: selected });
    setHardDelete(true);
    setDeleteProgress(null);
  };

  const executeDelete = async () => {
    if (!deleteModal) return;
    setIsDeleting(true);
    const ids = deleteModal.files.map(f => f.fileId);
    const total = ids.length;

    try {
      if (hardDelete) {
        if (ids.length === 1) {
          await hardDeleteEntityFile(ids[0]);
        } else {
          await hardDeleteEntityFiles(ids);
        }
      } else {
        let done = 0;
        for (const id of ids) {
          await deleteEntityFile(id);
          done++;
          setDeleteProgress({ done, total });
        }
      }
      setSelectedTasks(new Set());
      setDeleteModal(null);
      loadHistory();
    } catch (error: any) {
      console.error('删除失败:', error);
      alert(`删除失败: ${error?.message || '未知错误'}`);
    } finally {
      setIsDeleting(false);
      setDeleteProgress(null);
    }
  };
```

同时删除旧的 `deleteFile` 和 `deleteSelected` 函数（约第 127-158 行整段）。

- [ ] **Step 4: 更新按钮绑定**

4a) 找到卡片中的删除按钮（约第 424-430 行），将 `onClick` 从 `() => deleteFile(file.fileId)` 改为 `() => openDeleteModal(file)`：

```typescript
                      <button
                        onClick={() => openDeleteModal(file)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-medium transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
```

4b) 找到顶栏的批量删除按钮（约第 270-277 行），将 `onClick` 从 `deleteSelected` 改为 `openBatchDeleteModal`：

```typescript
          <button
            onClick={openBatchDeleteModal}
            disabled={selectedTasks.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            批量删除
          </button>
```

- [ ] **Step 5: 在预览弹窗之前添加 DeleteConfirmModal 渲染**

在 `{/* 预览弹窗 */}` 注释之前，添加整个弹窗 JSX：

```tsx
      {/* 删除确认弹窗 */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => !isDeleting && setDeleteModal(null)}>
          <div
            className="relative w-full max-w-lg mx-4 bg-gray-900 border border-red-500/20 rounded-2xl shadow-2xl shadow-red-950/30 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* 顶部红色警告条 */}
            <div className="h-1 bg-gradient-to-r from-red-600 via-red-500 to-orange-500" />

            {/* 头部 */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-100">
                    {deleteModal.mode === 'single' ? '确认删除' : `批量删除 ${deleteModal.files.length} 个文件`}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">此操作不可撤销</p>
                </div>
              </div>
              {!isDeleting && (
                <button onClick={() => setDeleteModal(null)} className="w-8 h-8 rounded-lg hover:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* 文件预览区 */}
            <div className="px-6 py-3">
              {deleteModal.mode === 'single' ? (
                <div className="flex gap-4 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
                  <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0">
                    {deleteModal.files[0]?.fileUrl ? (
                      <img src={getMediaUrl(deleteModal.files[0]) || ''} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-gray-600" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 truncate">{meta(deleteModal.files[0])?.model || '未知模型'}</p>
                    <p className="text-xs text-gray-500 mt-1">{formatTime(deleteModal.files[0]?.createdAt || '')}</p>
                    <p className="text-xs text-gray-500 mt-2 line-clamp-2">{meta(deleteModal.files[0])?.prompt || '无提示词'}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    {deleteModal.files.slice(0, 8).map(f => (
                      <div key={f.fileId} className="aspect-square rounded-lg overflow-hidden bg-gray-800 border border-gray-700/50">
                        {f.fileUrl ? (
                          <img src={getMediaUrl(f) || ''} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-gray-600" /></div>
                        )}
                      </div>
                    ))}
                  </div>
                  {deleteModal.files.length > 8 && (
                    <p className="text-xs text-gray-500 text-center">...还有 {deleteModal.files.length - 8} 个文件</p>
                  )}
                </div>
              )}
            </div>

            {/* 磁盘删除选项 */}
            <div className="px-6 py-3">
              <label className="flex items-center gap-3 p-3 rounded-xl bg-gray-800/30 border border-gray-700/30 cursor-pointer hover:bg-gray-800/50 transition-colors">
                <input
                  type="checkbox"
                  checked={hardDelete}
                  onChange={e => setHardDelete(e.target.checked)}
                  disabled={isDeleting}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-red-500 focus:ring-red-500 focus:ring-offset-0"
                />
                <HardDrive className="w-4 h-4 text-gray-400" />
                <div>
                  <span className="text-sm text-gray-300">同时删除磁盘文件</span>
                  <p className="text-[10px] text-gray-500 mt-0.5">勾选后将永久释放存储空间，文件无法恢复</p>
                </div>
              </label>
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-800/20 border-t border-gray-800">
              {deleteProgress && (
                <div className="flex-1 text-xs text-gray-500">
                  正在删除 {deleteProgress.done}/{deleteProgress.total}...
                </div>
              )}
              <button
                onClick={() => setDeleteModal(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={executeDelete}
                disabled={isDeleting}
                className="px-5 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    删除中...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    {hardDelete ? '永久删除' : '删除记录'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Commit**

```bash
git add new_html/components/HistoryPage.tsx
git commit -m "feat: replace confirm() with DeleteConfirmModal in HistoryPage"
```

---

### Task 5: 同步 deploy + 构建 + 复制 dist

**Files:**
- `deploy/dao_entity_file.py`
- `deploy/api_routes.py`
- `deploy/new_html/services/entityFileService.ts`
- `deploy/new_html/components/HistoryPage.tsx`
- `deploy/dist/`

- [ ] **Step 1: 同步源文件到 deploy**

```powershell
copy dao_entity_file.py deploy\dao_entity_file.py
copy api_routes.py deploy\api_routes.py
copy new_html\services\entityFileService.ts deploy\new_html\services\entityFileService.ts
copy new_html\components\HistoryPage.tsx deploy\new_html\components\HistoryPage.tsx
```

- [ ] **Step 2: 构建前端**

```powershell
cd new_html
npm run build
```

预期输出包含 `built in X.XXs`，无 error。

- [ ] **Step 3: 复制 dist 到 deploy**

```powershell
xcopy /E /Y /I dist deploy\dist
```

- [ ] **Step 4: Commit**

```bash
git add deploy/
git commit -m "sync: mirror hard delete + modal changes to deploy"
```
