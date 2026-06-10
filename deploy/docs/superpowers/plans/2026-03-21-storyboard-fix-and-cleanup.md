# 分镜页面修复 + 旧系统清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 StoryboardGenPage 图片不显示的 bug，同时删除旧系统路由和无用文件。

**Architecture:** StoryboardGenPage 的 `handleUpdateStoryboardItem` 只调 API 不更新本地状态，导致 GenerationPage 永远收不到新图片。修复方案是在 StoryboardGenPage 中维护 `localImageOverrides` 本地状态，合并到 `pseudoFile` 后传给 GenerationPage。旧系统路由全部删除，WorkspaceApp 仅保留供 ScriptPage 使用。

**Tech Stack:** React, TypeScript, Vite

---

## GitNexus 影响分析结果

使用 `gitnexus_impact` 和 `gitnexus_cypher` 对所有候选文件进行了影响范围分析：

**可安全删除（0 上游依赖，LOW 风险）：**
- `MediaVideo.tsx` — impact: 0 dependents, risk: LOW
- `InfiniteCanvasPage.tsx` — impact: 0 dependents, risk: LOW
- `MultiAnglePanel.tsx` — impact: 0 dependents, risk: LOW (GitNexus 未索引)
- `testGeminiProxyConnection` — impact: 0 dependents, risk: LOW
- `AudioStagePage.old.tsx` — Cypher 确认无任何 IMPORTS 入边

**WorkspaceApp 专用组件（0 上游依赖，但因 ScriptPage 保留 WorkspaceApp 而不可删）：**
- `AdminPage.tsx` — only imported by WorkspaceApp, risk: LOW
- `FileColumn.tsx` — only imported by WorkspaceApp, risk: LOW
- `Header.tsx` — only imported by WorkspaceApp, risk: LOW
- `LoadingOverlay.tsx` — only imported by WorkspaceApp, risk: LOW
- `ScriptColumn.tsx` — only imported by WorkspaceApp, risk: LOW
- `SkeletonScreen.tsx` — only imported by WorkspaceApp, risk: LOW
- `StoryboardColumn.tsx` — only imported by WorkspaceApp, risk: LOW
- `ViewerColumn.tsx` — only imported by WorkspaceApp, risk: LOW

**共享组件（新旧系统共用，保留）：**
- `GenerationPage.tsx` — imported by WorkspaceApp + StoryboardGenPage
- `MaterialPage.tsx` — imported by WorkspaceApp + MaterialsPage
- `VideoPage.tsx` — imported by WorkspaceApp + VideoGenPage
- `HistoryPage.tsx` — imported by WorkspaceApp + HistoryPage (re-export)

**WorkspaceApp 本身：**
- `WorkspaceApp.tsx` — imported by `App.tsx` + `ScriptPage.tsx`
- Cypher 确认仅此 2 个文件引用。删除 App.tsx 中的旧路由后，仅剩 ScriptPage 依赖。

**PostProcessPage.tsx：**
- impact: 0 upstream dependents, risk: LOW
- 仅由 App.tsx 路由引用，导航指向旧路由 `/projects/${projectId}/video`，需更新

---

## 文件变更总览

**修改:**
- `new_html/pages/StoryboardGenPage.tsx` - 添加本地状态覆盖 + 重写回调
- `new_html/App.tsx` - 删除旧路由、更新 GlobalToastWithNav
- `new_html/components/GenerationPage.tsx` - 清理诊断日志
- `new_html/WorkspaceApp.tsx` - 清理诊断日志 + 删除 testGeminiProxy 导入
- `new_html/components/PostProcessPage.tsx` - 导航改为新路由

**删除:**
- `new_html/components/MediaVideo.tsx` - 无任何引用
- `new_html/components/InfiniteCanvasPage.tsx` - 无任何引用
- `new_html/components/MultiAnglePanel.tsx` - 无任何引用
- `new_html/pages/AudioStagePage.old.tsx` - 旧版备份文件
- `new_html/services/testGeminiProxy.ts` - 调试用工具，仅 WorkspaceApp 引用

**保留（仅供 ScriptPage 使用）:**
- `new_html/WorkspaceApp.tsx` 及其依赖组件（Header, FileColumn, ViewerColumn, ScriptColumn, StoryboardColumn, AdminPage, LoadingOverlay, SkeletonScreen）

---

### Task 1: 修复 StoryboardGenPage — 本地状态覆盖

**核心 bug:** `handleUpdateStoryboardItem` 只做 API 调用，不更新 React 本地状态。GenerationPage 通过 `files` prop 读取图片，但 `pseudoFile` 从 `useEpisode()` context 来，API 调用后 context 不会立刻刷新，导致图片永远不显示。

**Files:**
- Modify: `new_html/pages/StoryboardGenPage.tsx`

- [ ] **Step 1: 添加 localImageOverrides state**

在 `StoryboardGenPage` 组件中，`pseudoFile` memo 之后添加：

```tsx
const [localImageOverrides, setLocalImageOverrides] = useState<
  Record<string, { generatedImages: GeneratedImage[]; selectedImageId?: string; generatedImage?: string }>
>({});
```

需要在文件顶部 import 中添加 `useState`（已有）和 `GeneratedImage` 类型：

```tsx
import type { StoryboardItem, FileVersion, GeneratedImage } from '../types';
```

- [ ] **Step 2: 重写 handleUpdateStoryboardItem**

替换现有的 `handleUpdateStoryboardItem`（第 38-67 行）为：

```tsx
const handleUpdateStoryboardItem = useCallback(
  (shotId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => {
    const currentShot = pseudoFile.storyboard?.items.find(i => i.id === shotId);
    if (!currentShot) return;

    const overridden = localImageOverrides[shotId];
    const mergedShot = overridden
      ? { ...currentShot, ...overridden }
      : currentShot;

    const resolvedUpdates = typeof updates === 'function'
      ? updates(mergedShot)
      : updates;

    if (resolvedUpdates.generatedImages) {
      setLocalImageOverrides(prev => ({
        ...prev,
        [shotId]: {
          generatedImages: resolvedUpdates.generatedImages!,
          selectedImageId: resolvedUpdates.selectedImageId,
          generatedImage: resolvedUpdates.generatedImage,
        },
      }));
    }

    const dbUpdates = storyboardItemToDbUpdate(resolvedUpdates);
    if (resolvedUpdates.generatedImages && resolvedUpdates.generatedImages.length > 0) {
      dbUpdates.generated_image_url = resolvedUpdates.generatedImages[0].url;
    }

    if (Object.keys(dbUpdates).length > 0) {
      updateStoryboardItem(shotId, dbUpdates).catch(err => {
        console.error('更新分镜失败:', err);
      });
    }
  },
  [pseudoFile, localImageOverrides]
);
```

关键变化：
1. 对于函数式更新，先合并 `localImageOverrides` 再调用更新函数，确保闭包内数据是最新的
2. `setLocalImageOverrides` 立即更新本地 UI
3. API 调用变为异步 fire-and-forget（不阻塞 UI）
4. DB 只存第一张图片的 URL（DB schema 限制）

- [ ] **Step 3: 创建 enhancedFile 并传给 GenerationPage**

在 `pseudoFile` memo 和 `return` 之间添加：

```tsx
const enhancedFile = useMemo(() => {
  if (Object.keys(localImageOverrides).length === 0) return pseudoFile;
  if (!pseudoFile.storyboard) return pseudoFile;

  const enhancedItems = pseudoFile.storyboard.items.map(item => {
    const override = localImageOverrides[item.id];
    if (!override) return item;
    return { ...item, ...override };
  });

  return {
    ...pseudoFile,
    storyboard: { ...pseudoFile.storyboard, items: enhancedItems },
  };
}, [pseudoFile, localImageOverrides]);
```

然后将 JSX 中的 `<GenerationPage files={[pseudoFile]} ...` 改为 `<GenerationPage files={[enhancedFile]} ...`。

- [ ] **Step 4: 验证构建无错误**

Run: `npx vite build` (in `new_html` directory)
Expected: 构建成功，无 TypeScript 错误

---

### Task 2: 清理诊断日志

**Files:**
- Modify: `new_html/components/GenerationPage.tsx`
- Modify: `new_html/WorkspaceApp.tsx`

- [ ] **Step 1: 清理 GenerationPage.tsx 中的 DIAG 日志**

删除以下代码块：

1. 第 748-752 行的 `[DIAG-CP1]` 日志（6 行）
2. 第 783-787 行的 `[DIAG-CP1] (NanoBanana)` 日志（6 行）
3. 第 1647-1659 行的 `DIAG-CP5` 监控块（含 `prevImgCountRef` 定义，共 13 行）

- [ ] **Step 2: 清理 WorkspaceApp.tsx 中的 DIAG 日志**

将 `updateStoryboardItemRef.current` 赋值（第 1367-1398 行）恢复为无诊断日志版本：

```tsx
updateStoryboardItemRef.current = (itemId, updates) => {
    if (!selectedFileId) return;
    updateFileWithHistory(selectedFileId, (f) => {
        if (!f.storyboard) return f;
        const newItems = f.storyboard.items.map(item => {
            if (item.id !== itemId) return item;
            const actualUpdates = typeof updates === 'function' ? updates(item) : updates;
            return { ...item, ...actualUpdates };
        });
        return { ...f, storyboard: { ...f.storyboard, items: newItems } };
    });
};
```

将 `handleUpdateStoryboardItem`（第 1400-1413 行）恢复为无诊断日志版本：

```tsx
const handleUpdateStoryboardItem = useCallback(
    (itemId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => {
        flushSync(() => {
            updateStoryboardItemRef.current?.(itemId, updates);
        });
    },
    []
);
```

---

### Task 3: 删除旧路由 + 更新导航

**Files:**
- Modify: `new_html/App.tsx`
- Modify: `new_html/components/PostProcessPage.tsx`

- [ ] **Step 1: 删除 App.tsx 中的旧路由**

删除第 112-118 行（6 行）：

```tsx
{/* ========== 旧路由兼容 ========== */}
<Route path="editor" element={<Navigate to="episodes" replace />} />
<Route path="materials" element={<WorkspaceApp />} />
<Route path="generation" element={<WorkspaceApp />} />
<Route path="video" element={<WorkspaceApp />} />
<Route path="history" element={<WorkspaceApp />} />
<Route path="admin" element={<WorkspaceApp />} />
```

保留 `postprocess` 路由。将 `editor` 重定向改为放在分集路由之后。

- [ ] **Step 2: 删除 WorkspaceApp 的 import**

删除 App.tsx 第 43 行：

```tsx
import WorkspaceApp from './WorkspaceApp';
```

- [ ] **Step 3: 更新 GlobalToastWithNav**

将 `GlobalToastWithNav`（第 46-69 行）中的旧 pageMap 改为新系统路由。旧的 `navigate('/projects/${projectId}/materials')` 应改为包含 episodeId 的新路由格式，或者简化为只跳转到项目页面（因为没有 episodeId 上下文）：

```tsx
const GlobalToastWithNav: React.FC = () => {
    const navigate = useNavigate();
    return (
        <GlobalToast onNavigate={(view, projectId) => {
            if (projectId) {
                navigate(`/projects/${projectId}/episodes`);
            }
        }} />
    );
};
```

- [ ] **Step 4: 更新 PostProcessPage 导航**

`PostProcessPage.tsx` 第 20 行的 `navigate('/projects/${projectId}/video')` 改为跳转到新路由或项目页面：

```tsx
onClick={() => navigate(`/projects/${projectId}/episodes`)}
```

---

### Task 4: 删除死代码文件

**Files:**
- Delete: `new_html/components/MediaVideo.tsx`
- Delete: `new_html/components/InfiniteCanvasPage.tsx`
- Delete: `new_html/components/MultiAnglePanel.tsx`
- Delete: `new_html/pages/AudioStagePage.old.tsx`
- Delete: `new_html/services/testGeminiProxy.ts`

- [ ] **Step 1: 删除无引用组件文件**

删除以下 3 个组件文件（经静态分析确认无任何 import 引用）：

```
new_html/components/MediaVideo.tsx
new_html/components/InfiniteCanvasPage.tsx
new_html/components/MultiAnglePanel.tsx
```

- [ ] **Step 2: 删除旧版备份和调试文件**

```
new_html/pages/AudioStagePage.old.tsx
new_html/services/testGeminiProxy.ts
```

- [ ] **Step 3: 删除 WorkspaceApp 中的 testGeminiProxy 导入**

删除 `WorkspaceApp.tsx` 第 26 行：

```tsx
import './services/testGeminiProxy';
```

---

### Task 5: 构建验证

- [ ] **Step 1: 运行 vite build**

Run: `npx vite build` (working directory: `h:\MY2\new_html`)
Expected: 构建成功，无错误

- [ ] **Step 2: 验证构建产物**

确认 `dist/assets/index-*.js` 文件存在，且不包含 `DIAG-CP` 字符串。

Run: `rg "DIAG-CP" dist/assets/`
Expected: 无匹配结果
