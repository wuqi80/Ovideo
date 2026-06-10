# 素材页体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复素材页面绑定/解绑操作引起的页面闪烁，用暗色主题自定义弹窗替换原生 `window.confirm()`，更新 project-memory 文档，并将变更部署到 deploy 文件夹。

**Architecture:** 闪烁根因是 `handleBindMaterial`/`handleUnbindMaterial` 级联操作后调用 `reload()`，而 `reload()` 触发 `setIsLoading(true)` 导致整页被骨架屏替换。由于 `saveStoryboardItem()` 已逐项更新本地状态，`reload()` 完全多余——直接移除即可。自定义弹窗复用项目现有 Modal 模式（`fixed inset-0 z-50 bg-black/80 backdrop-blur-sm`）。

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, Lucide Icons

---

### Task 1: 移除多余的 reload() 调用（修复闪烁）

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx:153-259`

**根因链路：**
```
handleBindMaterial L202 → reload() → loadSlices() → setIsLoading(true)
                                                       ↓
MaterialsPage L270: if (isLoading) return <Spinner/>  → 页面消失
                                                       ↓
loadSlices 完成 → setIsLoading(false) → 页面重现       → 闪烁
```

但 `saveStoryboardItem()` (EpisodeContext L282-291) 已经在每次调用后执行 `setStoryboardItems(prev => prev.map(...))` 更新本地状态。级联循环中每个 shot 都通过 `saveStoryboardItem` 逐个更新了，`reload()` 完全多余。

- [ ] **Step 1: 修改 handleBindMaterial — 移除 reload()**

将 L201-206:
```typescript
    if (cascadeCount > 0) {
      reload();
      setToastMsg(`已同步绑定到后续 ${cascadeCount} 个镜头`);
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToastMsg(null), 3000);
    }
```

替换为（移除 `reload()` 行，保留 toast）:
```typescript
    if (cascadeCount > 0) {
      setToastMsg(`已同步绑定到后续 ${cascadeCount} 个镜头`);
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToastMsg(null), 3000);
    }
```

- [ ] **Step 2: 修改 handleUnbindMaterial — 移除 reload()**

将 L253-255:
```typescript
      if (cascadeUnbind && cascadeTargets.length > 0) {
        reload();
      }
```

替换为（删除整个 if 块）:
```typescript
      // reload() removed - saveStoryboardItem already updates local state
```

- [ ] **Step 3: 清理依赖数组中的 reload 引用**

handleBindMaterial 依赖数组 (L207):
```typescript
  }, [storyboardItems, assets, assetNameToId, saveStoryboardItem, reload]);
```
改为:
```typescript
  }, [storyboardItems, assets, assetNameToId, saveStoryboardItem]);
```

handleUnbindMaterial 依赖数组 (L259):
```typescript
  }, [storyboardItems, assetNameToId, saveStoryboardItem, reload]);
```
改为:
```typescript
  }, [storyboardItems, assetNameToId, saveStoryboardItem]);
```

---

### Task 2: 创建 ConfirmDialog 自定义确认弹窗组件

**Files:**
- Create: `new_html/components/ConfirmDialog.tsx`

设计参考现有 Modal 模式 (`MattingModal.tsx`, `ImageFusionModal.tsx`)。

- [ ] **Step 1: 创建 ConfirmDialog.tsx**

```tsx
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  detail?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  detail,
  confirmText = '确定',
  cancelText = '取消',
  variant = 'warning',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const variantStyles = {
    danger: {
      icon: 'text-red-400',
      confirmBtn: 'bg-red-600 hover:bg-red-500 text-white',
      detailBg: 'bg-red-950/30 border-red-500/20',
    },
    warning: {
      icon: 'text-amber-400',
      confirmBtn: 'bg-amber-600 hover:bg-amber-500 text-white',
      detailBg: 'bg-amber-950/30 border-amber-500/20',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-2">
          <div className={`p-2 rounded-xl bg-gray-800 ${styles.icon}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-white flex-1">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-sm text-gray-300 leading-relaxed">{message}</p>
          {detail && (
            <div className={`mt-3 p-3 rounded-xl border ${styles.detailBg}`}>
              {detail}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-600 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${styles.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
```

---

### Task 3: 在 MaterialsPage 中集成 ConfirmDialog

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx:1-16` (imports)
- Modify: `new_html/pages/MaterialsPage.tsx:209-259` (handleUnbindMaterial)
- Modify: `new_html/pages/MaterialsPage.tsx` (JSX, 在 return 中添加弹窗)

- [ ] **Step 1: 添加 import 和状态类型**

在文件顶部 imports 中添加:
```typescript
import { ConfirmDialog } from '../components/ConfirmDialog';
```

在 `MaterialsPage` 组件内 (L150 附近，toastMsg 旁) 添加解绑弹窗状态:
```typescript
  const [unbindDialog, setUnbindDialog] = useState<{
    shotId: string;
    tagName: string;
    cascadeTargets: typeof storyboardItems;
  } | null>(null);
```

- [ ] **Step 2: 重写 handleUnbindMaterial — 改用弹窗状态**

将 L209-259 的 `handleUnbindMaterial` 重写为：

```typescript
  const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
    const currentIndex = storyboardItems.findIndex(si => si.itemId === shotId);
    const item = storyboardItems[currentIndex];
    if (!item || currentIndex < 0) return;

    let cascadeTargets: typeof storyboardItems = [];
    for (let i = currentIndex + 1; i < storyboardItems.length; i++) {
      const si = storyboardItems[i];
      const bound = Array.isArray(si.boundAssets) ? si.boundAssets : [];
      if (bound.some((b: string) => b.startsWith(`sel:${tagName}:`))) {
        cascadeTargets.push(si);
      }
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

    if (cascadeTargets.length > 0) {
      setUnbindDialog({ shotId, tagName, cascadeTargets });
      return;
    }

    try {
      await unbindItem(item);
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [storyboardItems, assetNameToId, saveStoryboardItem]);
```

- [ ] **Step 3: 添加弹窗确认/取消回调**

在 `handleUnbindMaterial` 后添加:

```typescript
  const handleUnbindConfirm = useCallback(async () => {
    if (!unbindDialog) return;
    const { shotId, tagName, cascadeTargets } = unbindDialog;
    setUnbindDialog(null);

    const unbindItem = async (itemId: string, boundAssets: string[]) => {
      const assetId = assetNameToId[tagName];
      const filtered = boundAssets.filter((id: string) =>
        id !== assetId &&
        !id.startsWith(`sel:${tagName}:`) &&
        id !== `nosel:${tagName}`
      );
      filtered.push(`nosel:${tagName}`);
      await saveStoryboardItem(itemId, { bound_assets: filtered, boundAssets: filtered });
    };

    try {
      const currentItem = storyboardItems.find(si => si.itemId === shotId);
      if (currentItem) {
        await unbindItem(currentItem.itemId, Array.isArray(currentItem.boundAssets) ? currentItem.boundAssets : []);
      }
      for (const si of cascadeTargets) {
        try {
          await unbindItem(si.itemId, Array.isArray(si.boundAssets) ? si.boundAssets : []);
        } catch (e) {
          console.error('级联解绑镜头失败:', e);
        }
      }
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [unbindDialog, storyboardItems, assetNameToId, saveStoryboardItem]);

  const handleUnbindCancel = useCallback(async () => {
    if (!unbindDialog) return;
    const { shotId, tagName } = unbindDialog;
    setUnbindDialog(null);

    const currentItem = storyboardItems.find(si => si.itemId === shotId);
    if (!currentItem) return;

    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(currentItem.boundAssets) ? currentItem.boundAssets : [];
    const filtered = currentBound.filter((id: string) =>
      id !== assetId &&
      !id.startsWith(`sel:${tagName}:`) &&
      id !== `nosel:${tagName}`
    );
    filtered.push(`nosel:${tagName}`);

    try {
      await saveStoryboardItem(shotId, { bound_assets: filtered, boundAssets: filtered });
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [unbindDialog, storyboardItems, assetNameToId, saveStoryboardItem]);
```

- [ ] **Step 4: 在 JSX 中渲染 ConfirmDialog**

在 `MaterialsPage` 的 return JSX 末尾（`</div>` 闭合前）添加:

```tsx
      {unbindDialog && (
        <ConfirmDialog
          open={!!unbindDialog}
          onConfirm={handleUnbindConfirm}
          onCancel={handleUnbindCancel}
          title="解除素材绑定"
          message={`确定要解除当前镜头「${unbindDialog.tagName}」的素材绑定吗？`}
          detail={
            <div className="space-y-2">
              <p className="text-xs text-amber-300/80 font-medium">
                后续还有 {unbindDialog.cascadeTargets.length} 个镜头绑定了同一素材
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unbindDialog.cascadeTargets.slice(0, 8).map((si, i) => (
                  <span key={si.itemId} className="text-[10px] bg-amber-900/30 text-amber-200/70 px-2 py-0.5 rounded-md">
                    镜头 {storyboardItems.indexOf(si) + 1}
                  </span>
                ))}
                {unbindDialog.cascadeTargets.length > 8 && (
                  <span className="text-[10px] text-amber-200/50">
                    +{unbindDialog.cascadeTargets.length - 8} 个
                  </span>
                )}
              </div>
            </div>
          }
          confirmText="全部解绑"
          cancelText="仅当前镜头"
          variant="warning"
        />
      )}
```

---

### Task 4: 更新 project-memory 文档

**Files:**
- Modify: `docs/frontend.md:159-186` (MaterialsPage, StoryboardGenPage, HistoryPage 描述)
- Modify: `docs/flow.md:185-191` (Timeline View 描述)
- Modify: `docs/faq.md` (新增条目)

- [ ] **Step 1: 更新 frontend.md — MaterialsPage 描述**

将 L159-161:
```markdown
### MaterialsPage (`new_html/pages/MaterialsPage.tsx`)

Wrapper for `MaterialPage` component. Bridges EpisodeContext data to the material binding UI.
```

替换为:
```markdown
### MaterialsPage (`new_html/pages/MaterialsPage.tsx`)

Wrapper for `MaterialPage` component. Bridges EpisodeContext data to the material binding UI.

Features:
- **素材绑定级联**: 锁定某镜头的角色/场景素材时，自动向后级联到后续未绑定的同 tag 镜头。通过 `handleBindMaterial` 循环调用 `saveStoryboardItem()` 实现。
- **解绑确认弹窗**: 解除绑定时，若后续镜头存在同素材绑定，弹出 `ConfirmDialog` 让用户选择"仅当前镜头"或"全部解绑"。
- **无 reload 闪烁**: 绑定/解绑操作不调用 `reload()`，通过 `saveStoryboardItem()` 的本地状态更新避免页面闪烁。
```

- [ ] **Step 2: 更新 frontend.md — StoryboardGenPage 描述**

将 L163-165:
```markdown
### StoryboardGenPage (`new_html/pages/StoryboardGenPage.tsx`)

Wraps `GenerationPage`. Converts episode data to legacy `ProjectFile` format via `scriptToProjectFile()`. Handles per-shot entity file queries for generated images. Timeline track at bottom.
```

替换为:
```markdown
### StoryboardGenPage (`new_html/pages/StoryboardGenPage.tsx`)

Wraps `GenerationPage`. Converts episode data to legacy `ProjectFile` format via `scriptToProjectFile()`. Handles per-shot entity file queries for generated images.

Features:
- **时间轴折叠**: 底部 TimelineTrack 支持折叠/展开（`timelineCollapsed` 状态），折叠时仅显示展开按钮。
- **画面预览**: 展开时间轴时显示当前镜头的分镜图片 + 音频同步播放预览。
```

- [ ] **Step 3: 更新 frontend.md — HistoryPage 描述**

将 L183-185:
```markdown
### HistoryPage (`new_html/pages/HistoryPage.tsx`)

Task history viewer. Filters by status, type, time range.
```

替换为:
```markdown
### HistoryPage (`new_html/pages/HistoryPage.tsx`)

Unified file history viewer. Data source: `GET /api/user-files` (files 表) + active tasks from `/api/tasks`.

Features:
- **统一数据源**: 所有历史生成文件从 `files` 表读取，不再依赖 `tasks` 表的 result 字段。
- **软删除**: 删除操作调用 `deleteEntityFile()`，仅软删除 files 记录。
- **进行中任务**: 顶部展示当前活跃的生成任务及进度。
- **筛选**: 按文件类型、时间范围筛选。
```

- [ ] **Step 4: 更新 frontend.md — 新增 ConfirmDialog 到组件表**

在 L211 (`StoryboardToolModal`) 后添加一行:

```markdown
| ConfirmDialog | `new_html/components/ConfirmDialog.tsx` | Reusable confirmation dialog with dark theme, keyboard support, variant styles. |
```

- [ ] **Step 5: 更新 faq.md — 新增闪烁修复条目**

在 `docs/faq.md` 顶部（最新条目之后）添加:

```markdown
### Q: 素材页面绑定/解绑时页面闪烁消失再出现

**症状**: 在素材绑定页面锁定或解除锁定素材时，整个页面会短暂消失（显示加载动画），然后重新出现。

**根因**: `handleBindMaterial` 和 `handleUnbindMaterial` 在级联操作后调用 `reload()`。`reload()` → `loadSlices()` → `setIsLoading(true)` → MaterialsPage L270 渲染骨架屏。但 `saveStoryboardItem()` 已经逐项更新了本地状态，`reload()` 完全多余。

**修复**: 移除两个函数中的 `reload()` 调用和依赖数组中的 `reload` 引用。

**文件**: `new_html/pages/MaterialsPage.tsx`

---
```

---

### Task 5: 构建验证 + 复制到 deploy 文件夹

**Files:**
- Build: `new_html/` → `dist/`
- Copy: `dist/` → `deploy/dist/`
- Copy: `new_html/pages/MaterialsPage.tsx` → `deploy/new_html/pages/MaterialsPage.tsx`
- Copy: `new_html/components/ConfirmDialog.tsx` → `deploy/new_html/components/ConfirmDialog.tsx`

- [ ] **Step 1: 构建前端**

```bash
cd h:\MY2\new_html && npm run build
```

Expected: `Build completed` 无错误，产物输出到 `h:\MY2\dist/`

- [ ] **Step 2: 复制构建产物到 deploy**

```powershell
# 复制 dist 构建产物
xcopy /E /Y /I "h:\MY2\dist" "h:\MY2\deploy\dist"

# 复制修改的源文件
copy /Y "h:\MY2\new_html\pages\MaterialsPage.tsx" "h:\MY2\deploy\new_html\pages\MaterialsPage.tsx"
copy /Y "h:\MY2\new_html\components\ConfirmDialog.tsx" "h:\MY2\deploy\new_html\components\ConfirmDialog.tsx"
```

- [ ] **Step 3: 验证 deploy 目录**

```powershell
dir "h:\MY2\deploy\dist\index.html"
dir "h:\MY2\deploy\new_html\components\ConfirmDialog.tsx"
```

Expected: 两个文件都存在，时间戳为最新。
