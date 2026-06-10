# 数据加载架构优化 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `loadSlices` 默认跳过已加载的 slice，避免每次页面切换都重新请求 API；新增 `forceReloadSlices` 供写操作后强制刷新。

**Architecture:** 在 `EpisodeContext` 中拆分出两个加载函数：`loadSlices`（skip-if-loaded）和内部 `fetchSlices`（始终请求）。`reload()` 和 `selectedScriptId` 切换 effect 使用 `fetchSlices`。各页面的调用代码无需修改。

**Tech Stack:** React 18, TypeScript, useCallback/useRef

---

### Task 1: 重构 loadSlices — 加 skip-if-loaded + 抽出 fetchSlices

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx:209-259`

- [ ] **Step 1: 抽出内部 `fetchSlices` 函数**

将当前 `loadSlices` 的加载逻辑抽出为独立的 `fetchSlices`（始终发请求、不做 skip 判断）：

```typescript
const fetchSlices = useCallback(async (...slices: DataSlice[]) => {
    if (!episodeId || slices.length === 0) return;
    setIsLoading(true);
    setError(null);

    slices.forEach(s => loadedSlicesRef.current.add(s));

    const loaders: Record<DataSlice, () => Promise<void>> = {
      script: async () => {
        const res = await getEpisodeScript(episodeId).catch(() => ({ success: false, script: null }));
        if (res.success && res.script) setScript(normalizeEpisodeScript(res.script));
      },
      storyboardItems: async () => {
        const sid = selectedScriptIdRef.current || undefined;
        const res = await getStoryboardItems(episodeId, sid).catch(() => ({ success: false, items: [] }));
        if (res.success) setStoryboardItems((res.items || []).map(normalizeStoryboardItem));
      },
      assets: async () => {
        const sid = selectedScriptIdRef.current || undefined;
        const res = await getAssets(projectId, episodeId, undefined, sid).catch(() => ({ success: false, assets: [] }));
        if (res.success) setAssets((res.assets || []).map(normalizeAsset));
      },
      audioTracks: async () => {
        const res = await getAudioTracks(episodeId).catch(() => ({ success: false, tracks: [] }));
        if (res.success) setAudioTracks((res.tracks || []).map(normalizeAudioTrack));
      },
      videoSegments: async () => {
        const res = await getVideoSegments(episodeId).catch(() => ({ success: false, segments: [] }));
        if (res.success) setVideoSegments((res.segments || []).map(normalizeVideoSegment));
      },
      characterVoices: async () => {
        const res = await getCharacterVoices(projectId).catch((e) => {
          console.warn('character_voices 加载失败:', e);
          return { success: false, voices: [] };
        });
        if (res.success && Array.isArray(res.voices)) {
          setCharacterVoices(res.voices.map(normalizeCharacterVoice));
        } else {
          setCharacterVoices([]);
        }
      },
    };

    try {
      await Promise.all(slices.map(s => loaders[s]()));
    } catch (e: any) {
      setError(e.message || '加载集数据失败');
    } finally {
      setIsLoading(false);
    }
  }, [episodeId, projectId]);
```

- [ ] **Step 2: 重写 `loadSlices` — 过滤已加载的 slice**

```typescript
const loadSlices = useCallback(async (...slices: DataSlice[]) => {
    const newSlices = slices.filter(s => !loadedSlicesRef.current.has(s));
    if (newSlices.length === 0) return;
    await fetchSlices(...newSlices);
  }, [fetchSlices]);
```

- [ ] **Step 3: 验证 — 检查 linter**

运行 linter 确认无类型错误。

---

### Task 2: reload() 改用 fetchSlices

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx:261-266`

- [ ] **Step 1: 修改 `reload` 函数**

```typescript
const reload = useCallback(async () => {
    const slices = Array.from(loadedSlicesRef.current) as DataSlice[];
    if (slices.length > 0) {
      await fetchSlices(...slices);
    }
  }, [fetchSlices]);
```

这确保 `reload()` 始终强制刷新，不被 skip 逻辑拦截。各页面中已有的 `await reload()` 调用无需修改。

---

### Task 3: selectedScriptId 变化 effect 改用 fetchSlices

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx:281-296`

- [ ] **Step 1: 修改 effect 中的调用**

```typescript
const prevScriptIdRef = useRef<string | null>(null);
useEffect(() => {
    if (!selectedScriptId) return;
    if (prevScriptIdRef.current === null) {
      prevScriptIdRef.current = selectedScriptId;
      return;
    }
    if (prevScriptIdRef.current === selectedScriptId) return;
    prevScriptIdRef.current = selectedScriptId;
    const slicesToReload: DataSlice[] = [];
    if (loadedSlicesRef.current.has('storyboardItems')) slicesToReload.push('storyboardItems');
    if (loadedSlicesRef.current.has('assets')) slicesToReload.push('assets');
    if (slicesToReload.length > 0) {
      fetchSlices(...slicesToReload);
    }
  }, [selectedScriptId, fetchSlices]);
```

关键变化：`loadSlices` → `fetchSlices`，并将 `fetchSlices` 加入依赖数组。

---

### Task 4: Context Provider value 暴露 forceReloadSlices

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx:138-180` (interface + default + provider)

- [ ] **Step 1: 更新 `EpisodeContextValue` 接口**

在 interface 中新增：

```typescript
interface EpisodeContextValue {
  // ... existing fields ...
  loadSlices: (...slices: DataSlice[]) => Promise<void>;
  forceReloadSlices: (...slices: DataSlice[]) => Promise<void>;
  reload: () => Promise<void>;
  // ... rest ...
}
```

- [ ] **Step 2: 更新 default context value**

```typescript
const EpisodeContext = createContext<EpisodeContextValue>({
  // ... existing defaults ...
  loadSlices: async () => {},
  forceReloadSlices: async () => {},
  reload: async () => {},
  // ... rest ...
});
```

- [ ] **Step 3: 更新 Provider value**

```typescript
<EpisodeContext.Provider value={{
    // ... existing fields ...
    loadSlices,
    forceReloadSlices: fetchSlices,
    reload,
    // ... rest ...
  }}>
```

---

### Task 5: 同步 deploy + 构建

**Files:**
- Copy: `new_html/contexts/EpisodeContext.tsx` → `deploy/new_html/contexts/EpisodeContext.tsx`
- Build: `npm run build` in `new_html/`
- Copy: `dist/*` → `deploy/dist/`

- [ ] **Step 1: 同步源文件到 deploy**

```powershell
Copy-Item "h:\MY2\new_html\contexts\EpisodeContext.tsx" "h:\MY2\deploy\new_html\contexts\EpisodeContext.tsx" -Force
```

- [ ] **Step 2: 构建前端**

```powershell
cd h:\MY2\new_html
npm run build
```

- [ ] **Step 3: 同步构建产物到 deploy**

```powershell
Copy-Item "h:\MY2\dist\*" "h:\MY2\deploy\dist\" -Recurse -Force
```

---

### Task 6: 更新 FAQ 文档

**Files:**
- Modify: `docs/faq.md`

- [ ] **Step 1: 追加 FAQ 条目**

```markdown
### Q: 每次切换页面都重新请求 API，导致加载慢

**Symptom**: 在工作流页面之间切换（如剧本→设计→素材→分镜），每次切换都会重新从 API 加载数据，即使数据已经在内存中。

**Root Cause**: `EpisodeContext.loadSlices()` 不检查数据是否已加载，每次调用都直接发 API 请求。由于 React Router 的 `<Outlet />` 在路由切换时卸载旧组件、挂载新组件，每个页面的 `useEffect(() => { loadSlices(...) }, [loadSlices])` 在每次挂载时都会触发。

**Fix**: 将 `loadSlices` 拆分为两个函数：
1. `loadSlices`（供页面 mount 时调用）：过滤掉 `loadedSlicesRef` 中已有的 slice，只请求未加载的数据
2. `fetchSlices` / `forceReloadSlices`（供写操作后调用）：始终发 API 请求，不做 skip 判断
3. `reload()` 和 `selectedScriptId` 变化 effect 使用 `fetchSlices`，确保数据变更后能正确刷新

**Files**: `new_html/contexts/EpisodeContext.tsx`
**Date**: 2026-04-15
```
