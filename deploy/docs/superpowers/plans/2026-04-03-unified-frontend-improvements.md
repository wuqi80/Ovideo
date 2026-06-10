# 前端统一改进 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三合一：HistoryPage 数据源统一到 files 表 + 素材绑定级联同步 + 时间轴折叠画面预览

**Architecture:** Part A（后端1个新端点 + 前端 HistoryPage 重写）和 Part B/C（纯前端逻辑修改）完全独立，可并行开发。所有改动不影响数据库 schema。

**Tech Stack:** FastAPI, React, TypeScript, React Query, Tailwind CSS

---

## Task 1: 后端新增 `GET /api/user-files` 端点

**Files:**
- Modify: `api_routes.py` (在 `@router.get("/api/entity-files")` 附近，约 L2370)
- Read: `dao_content.py` L404-429（`FileDAO.get_user_files` 已存在）

- [ ] **Step 1: 在 `api_routes.py` 中添加端点**

在 `@router.get("/api/entity-files")` 前面（约 L2369）插入：

```python
@router.get("/api/user-files")
async def get_user_files(
    file_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
):
    """获取当前用户所有文件（支持 file_type 过滤）"""
    if limit > 500:
        limit = 500
    rows = await FileDAO.get_user_files(user_id, file_type, limit, offset)
    items = []
    for r in rows:
        item = dict(r)
        if isinstance(item.get("metadata"), str):
            try:
                item["metadata"] = json.loads(item["metadata"])
            except Exception:
                item["metadata"] = {}
        items.append(item)
    count_query = "SELECT COUNT(*) FROM files WHERE user_id = $1 AND is_deleted = FALSE"
    args = [user_id]
    if file_type:
        count_query += " AND file_type = $2"
        args.append(file_type)
    db = get_db_manager()
    total_row = await db.fetchrow(count_query, *args)
    total = total_row[0] if total_row else len(items)
    return {"success": True, "items": items, "total": total}
```

- [ ] **Step 2: 验证端点可用**

手动测试或 curl：
```bash
curl -H "Authorization: Bearer <token>" "http://localhost:8000/api/user-files?file_type=image&limit=10"
```
Expected: 返回 `{"success": true, "items": [...], "total": N}`

---

## Task 2: 前端 `entityFileService.ts` 新增 `fetchUserFiles`

**Files:**
- Modify: `new_html/services/entityFileService.ts`

- [ ] **Step 1: 扩展 `EntityFile` 接口**

在 `EntityFile` 接口（L1-9）中增加可选字段：

```typescript
export interface EntityFile {
  fileId: string;
  fileUrl: string;
  fileType: string;
  fileRole: string;
  isSelected: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}
```

- [ ] **Step 2: 更新 `normalize` 函数**

在 `normalize`（L18-28）中增加两个字段的映射：

```typescript
function normalize(row: any): EntityFile {
  return {
    fileId: row.file_id ?? row.fileId ?? '',
    fileUrl: row.file_url ?? row.fileUrl ?? '',
    fileType: row.file_type ?? row.fileType ?? '',
    fileRole: row.file_role ?? row.fileRole ?? '',
    isSelected: !!(row.is_selected ?? row.isSelected),
    createdAt: row.created_at ?? row.createdAt ?? '',
    metadata: row.metadata,
    entityType: row.entity_type ?? row.entityType,
    entityId: row.entity_id ?? row.entityId,
  };
}
```

- [ ] **Step 3: 新增 `fetchUserFiles` 函数**

在 `fetchEntityFiles` 后面添加：

```typescript
export async function fetchUserFiles(
  fileType?: string,
  limit: number = 100,
  offset: number = 0,
): Promise<{ items: EntityFile[]; total: number }> {
  const params = new URLSearchParams();
  if (fileType) params.set('file_type', fileType);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const res = await fetch(`/api/user-files?${params}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`fetchUserFiles failed: ${res.status}`);
  const data = await res.json();
  return {
    items: (data.items || []).map(normalize),
    total: data.total ?? 0,
  };
}
```

---

## Task 3: HistoryPage 数据层重写

**Files:**
- Modify: `new_html/components/HistoryPage.tsx`

- [ ] **Step 1: 替换数据接口和加载逻辑**

替换顶部的 `HistoryTask` 接口和 `loadHistory` 函数。

将 `HistoryTask`（L4-20）替换为：

```typescript
import { fetchUserFiles, deleteEntityFile, EntityFile } from '../services/entityFileService';

interface HistoryFile extends EntityFile {
  // EntityFile 已包含所有需要的字段
}
```

将 state 改为：

```typescript
const [files, setFiles] = useState<HistoryFile[]>([]);
```

将 `loadHistory`（L44-73）替换为：

```typescript
const loadHistory = useCallback(async () => {
  setIsLoading(true);
  try {
    const data = await fetchUserFiles('image', 200, 0);
    setFiles(data.items);
  } catch (error) {
    console.error('加载历史记录失败:', error);
  } finally {
    setIsLoading(false);
  }
}, []);
```

- [ ] **Step 2: 替换 `deleteTask` 和 `deleteSelected`**

将 `deleteTask`（L101-123）替换为：

```typescript
const deleteFile = async (fileId: string) => {
  if (!confirm('确定要删除此文件吗？')) return;
  try {
    await deleteEntityFile(fileId);
    setFiles(prev => prev.filter(f => f.fileId !== fileId));
    selectedTasks.delete(fileId);
    setSelectedTasks(new Set(selectedTasks));
  } catch (error) {
    console.error('删除文件失败:', error);
    alert('删除失败');
  }
};
```

将 `deleteSelected`（L126-152）替换为：

```typescript
const deleteSelected = async () => {
  if (selectedTasks.size === 0) {
    alert('请先选择要删除的文件');
    return;
  }
  if (!confirm(`确定要删除选中的 ${selectedTasks.size} 个文件吗？`)) return;
  let successCount = 0;
  for (const fileId of selectedTasks) {
    try {
      await deleteEntityFile(fileId);
      successCount++;
    } catch (error) {
      console.error('删除文件失败:', fileId, error);
    }
  }
  alert(`成功删除 ${successCount} 个文件`);
  setSelectedTasks(new Set());
  loadHistory();
};
```

- [ ] **Step 3: 替换 `getMediaUrl` 和 `getThumbnailUrl`**

将 `getMediaUrl`（L190-214）替换为：

```typescript
const getMediaUrl = (file: HistoryFile): string | null => {
  if (!file.fileUrl) return null;
  const baseUrl = file.fileUrl.startsWith('http')
    ? file.fileUrl
    : `${getApiBaseUrl()}${file.fileUrl}`;
  if (!baseUrl.includes('token=')) {
    return baseUrl + (baseUrl.includes('?') ? '&' : '?') + `token=${getToken()}`;
  }
  return baseUrl;
};

const getThumbnailUrl = (file: HistoryFile): string | null => {
  return getMediaUrl(file);
};

const isVideo = (file: HistoryFile): boolean => {
  return file.fileType === 'video';
};
```

- [ ] **Step 4: 更新 JSX 中所有 `task` 引用为 `file` 引用**

全局搜索替换（在此文件内）：
- `task.task_id` → `file.fileId`
- `task.status === 'completed'` → `true`（files 表只有已完成的）
- `task.status` 状态判断 → 移除或简化
- `task.data?.prompt` → `(file.metadata as any)?.prompt || ''`
- `task.data?.model` → `(file.metadata as any)?.model || ''`
- `task.created_at` → `file.createdAt`
- `task.result?.videos` → 改用 `isVideo(file)`
- `deleteTask(task.task_id)` → `deleteFile(file.fileId)`
- `toggleSelect(task.task_id)` → `toggleSelect(file.fileId)`
- `getMediaUrl(task)` → `getMediaUrl(file)`
- `getThumbnailUrl(task)` → `getThumbnailUrl(file)`

注意：`toggleSelectAll` 中的过滤条件从 `t.status === 'completed' && getMediaUrl(t)` 改为 `getMediaUrl(f)`。

---

## Task 4: HistoryPage 顶部增加"进行中任务"模块

**Files:**
- Modify: `new_html/components/HistoryPage.tsx`

- [ ] **Step 1: 添加进行中任务 state 和加载**

在 `loadHistory` 后面增加：

```typescript
const [activeTasks, setActiveTasks] = useState<Array<{
  task_id: string;
  status: string;
  task_type: string;
  created_at: string;
}>>([]);

const loadActiveTasks = useCallback(async () => {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/tasks?status=processing,queued&limit=20`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!response.ok) return;
    const data = await response.json();
    setActiveTasks((data.tasks || []).filter((t: any) =>
      t.status === 'processing' || t.status === 'queued'
    ));
  } catch { /* ignore */ }
}, []);

useEffect(() => {
  loadActiveTasks();
  const interval = setInterval(loadActiveTasks, 10000);
  return () => clearInterval(interval);
}, [loadActiveTasks]);
```

- [ ] **Step 2: 在文件列表上方渲染进行中任务**

在主列表 JSX 前（return 中，工具栏下面）插入：

```tsx
{activeTasks.length > 0 && (
  <div className="mb-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
    <h4 className="text-xs font-bold text-blue-400 mb-2 flex items-center gap-1">
      <Clock className="w-3.5 h-3.5 animate-spin" />
      进行中 ({activeTasks.length})
    </h4>
    <div className="flex flex-wrap gap-2">
      {activeTasks.map(t => (
        <div key={t.task_id} className="px-3 py-1.5 bg-blue-950/50 border border-blue-500/20 rounded text-xs text-blue-300">
          {t.task_type} - {t.status === 'processing' ? '处理中' : '排队中'}
        </div>
      ))}
    </div>
  </div>
)}
```

---

## Task 5: 素材绑定级联 — `handleBindMaterial`

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx` L150-174

- [ ] **Step 1: 重写 `handleBindMaterial` 增加级联**

替换整个 `handleBindMaterial`（L150-174）为：

```typescript
const handleBindMaterial = useCallback(async (shotId: string, tagName: string, materialId: string) => {
  const currentIndex = storyboardItems.findIndex(si => si.itemId === shotId);
  const item = storyboardItems[currentIndex];
  if (!item || currentIndex < 0) return;

  const asset = assets.find(a => a.name === tagName);
  const prefix = asset?.assetType === 'scene' ? 'scene' : 'char';
  const tagEntry = `${prefix}:${tagName}`;

  // 绑定当前镜头
  const buildBoundAssets = (si: typeof item) => {
    const currentBound = Array.isArray(si.boundAssets) ? [...si.boundAssets] : [];
    if (!currentBound.includes(tagEntry)) {
      currentBound.push(tagEntry);
    }
    const rawId = assetNameToId[tagName];
    const cleaned = currentBound.filter(id =>
      !id.startsWith(`sel:${tagName}:`) && id !== rawId && id !== `nosel:${tagName}`
    );
    cleaned.push(`sel:${tagName}:${materialId}`);
    return cleaned;
  };

  try {
    const cleaned = buildBoundAssets(item);
    await saveStoryboardItem(shotId, { bound_assets: cleaned, boundAssets: cleaned });
  } catch (e) {
    console.error('绑定素材失败:', e);
    return;
  }

  // 向后级联：遍历后续镜头
  let cascadeCount = 0;
  for (let i = currentIndex + 1; i < storyboardItems.length; i++) {
    const si = storyboardItems[i];
    const bound = Array.isArray(si.boundAssets) ? si.boundAssets : [];
    const hasTag = bound.some((b: string) => b === `char:${tagName}` || b === `scene:${tagName}`);
    if (!hasTag) continue;
    const alreadyBound = bound.some((b: string) => b.startsWith(`sel:${tagName}:`));
    if (alreadyBound) continue;

    try {
      const newBound = buildBoundAssets(si);
      await saveStoryboardItem(si.itemId, { bound_assets: newBound, boundAssets: newBound });
      cascadeCount++;
    } catch (e) {
      console.error(`级联绑定镜头${i + 1}失败:`, e);
    }
  }

  if (cascadeCount > 0) {
    reload();
  }

  return cascadeCount;
}, [storyboardItems, assets, assetNameToId, saveStoryboardItem, reload]);
```

---

## Task 6: 素材解绑级联 — `handleUnbindMaterial`

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx` L176-194

- [ ] **Step 1: 重写 `handleUnbindMaterial` 增加弹窗确认**

替换整个 `handleUnbindMaterial`（L176-194）为：

```typescript
const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
  const currentIndex = storyboardItems.findIndex(si => si.itemId === shotId);
  const item = storyboardItems[currentIndex];
  if (!item || currentIndex < 0) return;

  // 统计后续有多少镜头绑定了同一 tag
  let cascadeTargets: typeof storyboardItems = [];
  for (let i = currentIndex + 1; i < storyboardItems.length; i++) {
    const si = storyboardItems[i];
    const bound = Array.isArray(si.boundAssets) ? si.boundAssets : [];
    if (bound.some((b: string) => b.startsWith(`sel:${tagName}:`))) {
      cascadeTargets.push(si);
    }
  }

  let cascadeUnbind = false;
  if (cascadeTargets.length > 0) {
    cascadeUnbind = window.confirm(
      `后续还有 ${cascadeTargets.length} 个镜头绑定了「${tagName}」，是否一起解绑？\n\n点击"确定"全部解绑，点击"取消"仅解绑当前镜头。`
    );
  }

  const unbindItem = async (si: typeof item) => {
    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(si.boundAssets) ? si.boundAssets : [];
    const filtered = currentBound.filter((id: string) =>
      id !== assetId &&
      !id.startsWith(`sel:${tagName}:`) &&
      id !== `nosel:${tagName}`
    );
    filtered.push(`nosel:${tagName}`);
    await saveStoryboardItem(si.itemId, { bound_assets: filtered, boundAssets: filtered });
  };

  try {
    await unbindItem(item);
    if (cascadeUnbind) {
      for (const si of cascadeTargets) {
        try {
          await unbindItem(si);
        } catch (e) {
          console.error(`级联解绑镜头失败:`, e);
        }
      }
    }
    if (cascadeUnbind && cascadeTargets.length > 0) {
      reload();
    }
  } catch (e) {
    console.error('解绑素材失败:', e);
  }
}, [storyboardItems, assetNameToId, saveStoryboardItem, reload]);
```

---

## Task 7: Toast 通知组件

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx`
- Modify: `new_html/components/MaterialPage.tsx`

- [ ] **Step 1: MaterialsPage 增加 toast state 和 callback**

在 `MaterialsPage` 组件内（`handleUnbindMaterial` 后面）增加：

```typescript
const [toastMsg, setToastMsg] = useState<string | null>(null);
const toastTimer = useRef<number>(0);

const showToast = useCallback((msg: string) => {
  setToastMsg(msg);
  window.clearTimeout(toastTimer.current);
  toastTimer.current = window.setTimeout(() => setToastMsg(null), 3000);
}, []);
```

修改 `handleBindMaterial` 的末尾，在 `return cascadeCount;` 前加：

```typescript
if (cascadeCount > 0) {
  showToast(`已同步绑定到后续 ${cascadeCount} 个镜头`);
}
```

- [ ] **Step 2: 在 MaterialPage 渲染下方加 toast 渲染**

在 `MaterialsPage` 的 `return` JSX 中，在 `<MaterialPage ... />` 后面加：

```tsx
{toastMsg && (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-green-600 text-white text-sm rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2">
    {toastMsg}
  </div>
)}
```

注意：需要在文件顶部 import 中增加 `useState, useRef`（`useState` 已有，只需确认 `useRef` 已导入）。

---

## Task 8: 时间轴折叠功能

**Files:**
- Modify: `new_html/pages/StoryboardGenPage.tsx` L237-308

- [ ] **Step 1: 添加折叠状态**

在 `StoryboardGenPage` 组件中，`const showTimeline = ...`（L237）后面加：

```typescript
const [timelineCollapsed, setTimelineCollapsed] = React.useState(false);
```

- [ ] **Step 2: 替换时间轴渲染块**

将 L300-305 替换为：

```tsx
{showTimeline && (
  <div className="shrink-0 border-t border-gray-800 bg-gray-950">
    <div
      className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-900/50 transition-colors"
      onClick={() => setTimelineCollapsed(c => !c)}
    >
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
        {timelineCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        图 + 音联合时间轴
      </h4>
      <span className="text-[10px] text-gray-600">
        {fmtTimeSimple(timelineTotalMs)} | {timelineClips.filter(c => c.track === 'image').length} 个镜头
      </span>
    </div>
    {!timelineCollapsed && (
      <div className="px-4 pb-4">
        <TimelineTrack mode="combined" clips={timelineClips} totalDurationMs={timelineTotalMs} showPreview />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: 添加辅助函数和 import**

在 `StoryboardGenPage` 文件顶部的 lucide-react import 中追加 `ChevronDown, ChevronRight`：

```typescript
import { LayoutGrid, Loader, ChevronDown, ChevronRight } from 'lucide-react';
```

在组件外部（import 后）添加工具函数：

```typescript
function fmtTimeSimple(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const sec = ms / 1000;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
```

---

## Task 9: TimelineTrack 画面预览区

**Files:**
- Modify: `new_html/components/TimelineTrack.tsx`

- [ ] **Step 1: 扩展 Props 接口**

在 `TimelineTrackProps`（L16-21）中增加：

```typescript
export interface TimelineTrackProps {
  mode: 'audio-only' | 'combined';
  clips: TimelineClip[];
  totalDurationMs: number;
  onClipClick?: (clip: TimelineClip) => void;
  showPreview?: boolean;
}
```

- [ ] **Step 2: 解构新 prop**

修改组件参数解构（L48-49）：

```typescript
export const TimelineTrack: React.FC<TimelineTrackProps> = ({
  mode, clips, totalDurationMs, onClipClick, showPreview = false,
}) => {
```

- [ ] **Step 3: 添加当前帧查找逻辑**

在 `const playheadPct = ...`（L157）后面加：

```typescript
const currentImageClip = useMemo(() => {
  if (!showPreview) return null;
  return clips.find(c =>
    c.track === 'image' &&
    currentTimeMs >= c.startMs &&
    currentTimeMs < c.startMs + c.durationMs
  ) || clips.find(c => c.track === 'image') || null;
}, [showPreview, clips, currentTimeMs]);
```

- [ ] **Step 4: 修改渲染布局**

将 `return` 中最外层的 `<div>` 内容（L159-259）改为带预览的 flex 布局。

把 `<div className="bg-gray-900 rounded-xl border border-gray-800 p-4">`（L160）改为：

```tsx
<div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
  <div className={showPreview ? 'flex gap-4' : ''}>
    {/* 左侧预览区 */}
    {showPreview && (
      <div className="shrink-0 w-[200px]">
        <div className="w-[200px] h-[120px] bg-black rounded-lg overflow-hidden border border-gray-700 flex items-center justify-center">
          {currentImageClip?.imageUrl ? (
            <img
              src={currentImageClip.imageUrl}
              alt={currentImageClip.label}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-gray-600 text-xs">无画面</span>
          )}
        </div>
        <p className="text-[10px] text-gray-500 mt-1 truncate text-center">
          {currentImageClip?.label || '—'}
        </p>
      </div>
    )}

    {/* 右侧：控制 + 轨道 */}
    <div className="flex-1 min-w-0">
```

然后在原来的 `{/* Hidden audio elements */}` 前面关闭 flex 容器：

```tsx
    </div>{/* end flex-1 */}
  </div>{/* end flex */}

  {/* Hidden audio elements */}
```

注意：需要在 import 中添加 `useMemo`（已经在导入列表中，无需添加）。

---

## Task 10: 构建验证 + 文档更新

**Files:**
- Run: `npm run build` (in `new_html/`)
- Modify: `docs/faq.md`
- Modify: `docs/data-layer-reference.md`

- [ ] **Step 1: 构建前端**

```bash
cd new_html && npm run build
```

Expected: 编译成功无错误

- [ ] **Step 2: 修复可能的 lint/type 错误**

根据构建输出逐一修复。

- [ ] **Step 3: 更新 `docs/faq.md`**

新增条目：

```markdown
## 素材绑定级联不生效
- 症状：在镜头2绑定角色后，后续镜头没有自动跟随
- 原因：后续镜头已有该角色的绑定（不覆盖已有绑定）
- 解决：手动解绑后续镜头的旧绑定，再重新绑定当前镜头

## HistoryPage 不显示历史生成图片
- 症状：历史记录为空
- 原因：HistoryPage 已迁移到 files 表读取，确认文件已通过 save_generated_file_to_db 入库
- 解决：检查 files 表是否有该用户的记录
```

- [ ] **Step 4: 更新 `docs/data-layer-reference.md`**

在 HistoryPage 相关章节中更新数据源说明：
- 数据来源：`GET /api/user-files` → `files` 表
- 删除：`deleteEntityFile(fileId)` → 软删除 files 记录
- 进行中任务：独立模块仍从 `GET /api/tasks?status=processing,queued` 读取

在素材绑定章节中新增级联说明：
- 绑定操作：`handleBindMaterial` 自动向后级联到未绑定的镜头
- 解绑操作：弹窗确认是否级联解绑
