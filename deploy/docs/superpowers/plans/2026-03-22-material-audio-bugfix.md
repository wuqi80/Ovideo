# 素材绑定 + 配音页面 5 Bug 修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复素材绑定页 3 个 bug（解除锁定、多图切换、剧本描述）和配音页 2 个 bug（头像为空、台词编辑持久化），所有修复零后端改动。

**Architecture:** `bound_assets` JSONB 数组新增 `sel:tagName:materialId` 前缀条目记录图片选择，`parseBoundAssetTags` 扩展返回值向后兼容。配音页通过 `EpisodeContext.saveStoryboardItem` 将台词编辑持久化到 DB `dialogue` 字段。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + PostgreSQL (JSONB)

---

## 文件结构

| 文件 | 修改类型 | 职责 |
|------|----------|------|
| `new_html/utils/episodeAdapters.ts` | 修改 | Bug 2: parseBoundAssetTags + dbItemToStoryboardItem |
| `new_html/pages/MaterialsPage.tsx` | 修改 | Bug 1 + 2: handleUnbindMaterial + handleBindMaterial |
| `new_html/components/MaterialPage.tsx` | 修改 | Bug 3: 剧本描述数据源 |
| `new_html/components/audio/DubbingCard.tsx` | 修改 | Bug 4 + 5: resolveUrl + 头像 + 编辑 UI + 持久化回调 |
| `new_html/pages/AudioStagePage.tsx` | 修改 | Bug 4 + 5: resolveUrl + handleTextPersist |
| `new_html/components/audio/DubbingPanel.tsx` | 修改 | Bug 5: 透传 onTextPersist prop |

---

### Task 1: parseBoundAssetTags 扩展 + dbItemToStoryboardItem 修复

**Files:**
- Modify: `new_html/utils/episodeAdapters.ts:15-33` (parseBoundAssetTags)
- Modify: `new_html/utils/episodeAdapters.ts:86-110` (materialSelections 构建)

- [ ] **Step 1: 扩展 parseBoundAssetTags 返回 selections**

将当前代码（L15-33）：

```typescript
export function parseBoundAssetTags(boundAssets: string[]): {
  charNames: string[];
  sceneName: string;
  assetIds: string[];
} {
  const charNames: string[] = [];
  let sceneName = '';
  const assetIds: string[] = [];
  for (const entry of boundAssets) {
    if (entry.startsWith(CHAR_PREFIX)) {
      charNames.push(entry.slice(CHAR_PREFIX.length));
    } else if (entry.startsWith(SCENE_PREFIX)) {
      sceneName = entry.slice(SCENE_PREFIX.length);
    } else {
      assetIds.push(entry);
    }
  }
  return { charNames, sceneName, assetIds };
}
```

替换为：

```typescript
const SEL_PREFIX = 'sel:';

export function parseBoundAssetTags(boundAssets: string[]): {
  charNames: string[];
  sceneName: string;
  assetIds: string[];
  selections: Record<string, string>;
} {
  const charNames: string[] = [];
  let sceneName = '';
  const assetIds: string[] = [];
  const selections: Record<string, string> = {};
  for (const entry of boundAssets) {
    if (entry.startsWith(CHAR_PREFIX)) {
      charNames.push(entry.slice(CHAR_PREFIX.length));
    } else if (entry.startsWith(SCENE_PREFIX)) {
      sceneName = entry.slice(SCENE_PREFIX.length);
    } else if (entry.startsWith(SEL_PREFIX)) {
      const rest = entry.slice(SEL_PREFIX.length);
      const idx = rest.indexOf(':');
      if (idx > 0) {
        selections[rest.slice(0, idx)] = rest.slice(idx + 1);
      }
    } else {
      assetIds.push(entry);
    }
  }
  return { charNames, sceneName, assetIds, selections };
}
```

**关键点**：新增 `selections` 字段是向后兼容的 — 所有现有调用方使用解构赋值 `{ charNames, sceneName }` 或 `{ charNames }`，不受影响。

- [ ] **Step 2: dbItemToStoryboardItem 用 selections 填充 materialSelections**

将当前 materialSelections 构建逻辑（L86-110）：

```typescript
  const materialSelections: Record<string, string> = {};
  if (assets) {
    for (const charName of characters) {
      const asset = assets.find(a => a.assetType === 'character' && a.name === charName);
      if (asset) {
        const imgs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
        if (imgs.length > 0) {
          materialSelections[charName] = `${asset.assetId}_0`;
        } else if (asset.thumbnailUrl) {
          materialSelections[charName] = asset.assetId;
        }
      }
    }
    if (scene) {
      const sceneAsset = assets.find(a => a.assetType === 'scene' && a.name === scene);
      if (sceneAsset) {
        const sImgs = Array.isArray(sceneAsset.referenceImages) ? sceneAsset.referenceImages.filter(Boolean) : [];
        if (sImgs.length > 0) {
          materialSelections[scene] = `${sceneAsset.assetId}_0`;
        } else if (sceneAsset.thumbnailUrl) {
          materialSelections[scene] = sceneAsset.assetId;
        }
      }
    }
  }
```

替换为（注意前面 L37 的解构也要更新）：

先改 L37，把 `const { charNames, sceneName, assetIds } = parseBoundAssetTags(boundAssets);` 改为：

```typescript
  const { charNames, sceneName, assetIds, selections } = parseBoundAssetTags(boundAssets);
```

然后替换 materialSelections 块：

```typescript
  const materialSelections: Record<string, string> = {};
  if (assets) {
    for (const charName of characters) {
      if (selections[charName]) {
        materialSelections[charName] = selections[charName];
        continue;
      }
      const asset = assets.find(a => a.assetType === 'character' && a.name === charName);
      if (asset) {
        const imgs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
        if (imgs.length > 0) {
          materialSelections[charName] = `${asset.assetId}_0`;
        } else if (asset.thumbnailUrl) {
          materialSelections[charName] = asset.assetId;
        }
      }
    }
    if (scene) {
      if (selections[scene]) {
        materialSelections[scene] = selections[scene];
      } else {
        const sceneAsset = assets.find(a => a.assetType === 'scene' && a.name === scene);
        if (sceneAsset) {
          const sImgs = Array.isArray(sceneAsset.referenceImages) ? sceneAsset.referenceImages.filter(Boolean) : [];
          if (sImgs.length > 0) {
            materialSelections[scene] = `${sceneAsset.assetId}_0`;
          } else if (sceneAsset.thumbnailUrl) {
            materialSelections[scene] = sceneAsset.assetId;
          }
        }
      }
    }
  }
```

- [ ] **Step 3: 验证构建**

运行 `npx vite build`（在 `new_html` 目录），确认无 TypeScript 错误。

---

### Task 2: handleUnbindMaterial 修复（Bug 1: 解除锁定）

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx:168-183`

- [ ] **Step 1: 替换 handleUnbindMaterial**

将当前代码（L168-183）：

```typescript
  const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
    const item = storyboardItems.find(si => si.itemId === shotId);
    if (!item) return;

    const assetId = assetNameToId[tagName];
    if (!assetId) return;

    const currentBound = Array.isArray(item.boundAssets) ? item.boundAssets.filter(id => id !== assetId) : [];

    try {
      await apiUpdateStoryboardItem(shotId, { bound_assets: currentBound });
      reload();
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [storyboardItems, assetNameToId, reload]);
```

替换为：

```typescript
  const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
    const item = storyboardItems.find(si => si.itemId === shotId);
    if (!item) return;

    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(item.boundAssets) ? item.boundAssets : [];
    const filtered = currentBound.filter(id =>
      id !== `char:${tagName}` &&
      id !== `scene:${tagName}` &&
      id !== assetId &&
      !id.startsWith(`sel:${tagName}:`)
    );

    try {
      await apiUpdateStoryboardItem(shotId, { bound_assets: filtered });
      reload();
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [storyboardItems, assetNameToId, reload]);
```

**改动说明**：
- 删除 `if (!assetId) return;` — 即使 assetNameToId 没有映射也不应 bail out
- filter 同时匹配 `char:tagName`、`scene:tagName`、raw assetId、`sel:tagName:*` 四种格式

---

### Task 3: handleBindMaterial 修复（Bug 2: 多图切换）

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx:150-166`

- [ ] **Step 1: 替换 handleBindMaterial**

将当前代码（L150-166）：

```typescript
  const handleBindMaterial = useCallback(async (shotId: string, tagName: string, materialId: string) => {
    const item = storyboardItems.find(si => si.itemId === shotId);
    if (!item) return;

    const assetId = assetNameToId[tagName] || materialId;
    const currentBound = Array.isArray(item.boundAssets) ? [...item.boundAssets] : [];
    if (!currentBound.includes(assetId)) {
      currentBound.push(assetId);
    }

    try {
      await apiUpdateStoryboardItem(shotId, { bound_assets: currentBound });
      reload();
    } catch (e) {
      console.error('绑定素材失败:', e);
    }
  }, [storyboardItems, assetNameToId, reload]);
```

替换为：

```typescript
  const handleBindMaterial = useCallback(async (shotId: string, tagName: string, materialId: string) => {
    const item = storyboardItems.find(si => si.itemId === shotId);
    if (!item) return;

    const currentBound = Array.isArray(item.boundAssets) ? [...item.boundAssets] : [];
    const asset = assets.find(a => a.name === tagName);
    const prefix = asset?.assetType === 'scene' ? 'scene' : 'char';
    const tagEntry = `${prefix}:${tagName}`;

    if (!currentBound.includes(tagEntry)) {
      currentBound.push(tagEntry);
    }

    const rawId = assetNameToId[tagName];
    const cleaned = currentBound.filter(id =>
      !id.startsWith(`sel:${tagName}:`) && id !== rawId
    );
    cleaned.push(`sel:${tagName}:${materialId}`);

    try {
      await apiUpdateStoryboardItem(shotId, { bound_assets: cleaned });
      reload();
    } catch (e) {
      console.error('绑定素材失败:', e);
    }
  }, [storyboardItems, assets, assetNameToId, reload]);
```

**改动说明**：
- 不再把 raw assetId 当作 binding 条目 push，而是用 `char:/scene:` 标签
- 每次绑定时清除旧的 `sel:tagName:*` 和 raw assetId，写入新的 `sel:tagName:materialId`
- 依赖数组新增 `assets`

- [ ] **Step 2: 验证构建**

运行 `npx vite build`。

---

### Task 4: 剧本描述改用 originalText（Bug 3）

**Files:**
- Modify: `new_html/components/MaterialPage.tsx:945`

- [ ] **Step 1: 替换数据源**

将 L945：

```typescript
                                 {selectedShot.scriptSegment || '无'}
```

替换为：

```typescript
                                 {selectedShot.originalText || '无'}
```

**就这一行**。`originalText` 存储的是完整原始分镜文本（含标签如 `取景：中景\n摄像机角度：俯视\n...`），与 `imagePrompt` 完全不同。

---

### Task 5: DubbingCard resolveUrl + 头像修复（Bug 4）

**Files:**
- Modify: `new_html/components/audio/DubbingCard.tsx:18-22` (resolveUrl)
- Modify: `new_html/components/audio/DubbingCard.tsx:87-93` (头像 fallback)
- Modify: `new_html/pages/AudioStagePage.tsx:15-19` (resolveUrl)

- [ ] **Step 1: DubbingCard.tsx 修复 resolveUrl**

将 L18-22：

```typescript
function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/')) return path;
  return `/${path}`;
}
```

替换为：

```typescript
function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/') || path.startsWith('data:')) return path;
  return `/${path}`;
}
```

- [ ] **Step 2: AudioStagePage.tsx 同样修复 resolveUrl**

将 L15-19 同样替换（加入 `|| path.startsWith('data:')`）：

```typescript
function resolveUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/') || path.startsWith('data:')) return path;
  return `/${path}`;
}
```

- [ ] **Step 3: DubbingCard 头像 fallback 改为角色名首字符**

将 L87-93：

```tsx
        {thumb ? (
          <img src={thumb} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
            <User size={14} className="text-gray-500" />
          </div>
        )}
```

替换为：

```tsx
        {thumb ? (
          <img src={thumb} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-gray-600" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-indigo-600/80 flex items-center justify-center shrink-0 text-white text-xs font-bold">
            {displaySpeaker.charAt(0)}
          </div>
        )}
```

---

### Task 6: 台词编辑增加视觉提示 + 持久化到 DB（Bug 5）

**Files:**
- Modify: `new_html/components/audio/DubbingCard.tsx:41-57` (Props 接口)
- Modify: `new_html/components/audio/DubbingCard.tsx:59-63` (解构)
- Modify: `new_html/components/audio/DubbingCard.tsx:75-81` (handleTextBlur)
- Modify: `new_html/components/audio/DubbingCard.tsx:107-127` (编辑区 UI)
- Modify: `new_html/components/audio/DubbingPanel.tsx:12-29` (Props 接口)
- Modify: `new_html/components/audio/DubbingPanel.tsx:31-38` (解构)
- Modify: `new_html/components/audio/DubbingPanel.tsx:141-158` (传递 prop)
- Modify: `new_html/pages/AudioStagePage.tsx:1-13` (imports)
- Modify: `new_html/pages/AudioStagePage.tsx:21-26` (解构 useEpisode)
- Add code: `new_html/pages/AudioStagePage.tsx` (handleTextPersist 回调)
- Modify: `new_html/pages/AudioStagePage.tsx:237-255` (传递 prop)

- [ ] **Step 1: DubbingCard — 新增 onTextPersist prop**

在 `DubbingCardProps` 接口（L41-57）末尾、`allCharNames` 后面加一行：

```typescript
  onTextPersist?: (itemId: string, speaker: string, newText: string) => void;
```

在组件解构（L59-63）中加入 `onTextPersist`：

```typescript
export const DubbingCard: React.FC<DubbingCardProps> = ({
  clip, clipKey, voice, charAsset, override, onOverrideChange,
  audioUrl, audioDurationMs, isGenerating, error, isPlaying,
  onGenerate, onTogglePlay, plannedDurationMs, allCharNames,
  onTextPersist,
}) => {
```

- [ ] **Step 2: DubbingCard — handleTextBlur 增加持久化调用**

将 L75-81：

```typescript
  const handleTextBlur = useCallback(() => {
    setEditing(false);
    const val = editRef.current?.value.trim();
    if (val && val !== clip.text) {
      onOverrideChange(clipKey, { text: val });
    }
  }, [clip.text, clipKey, onOverrideChange]);
```

替换为：

```typescript
  const handleTextBlur = useCallback(() => {
    setEditing(false);
    const val = editRef.current?.value.trim();
    if (val && val !== clip.text) {
      onOverrideChange(clipKey, { text: val });
      onTextPersist?.(clip.itemId, displaySpeaker, val);
    }
  }, [clip.text, clip.itemId, clipKey, onOverrideChange, onTextPersist, displaySpeaker]);
```

- [ ] **Step 3: DubbingCard — 编辑区 UI 改为单击进入编辑 + 铅笔提示**

将 L107-127（`<div className="flex-1 min-w-0">` 内部）：

```tsx
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              ref={editRef}
              defaultValue={displayText}
              onBlur={handleTextBlur}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextBlur(); } }}
              autoFocus
              rows={2}
              className="w-full bg-gray-900 border border-indigo-500/50 rounded px-2 py-1 text-sm text-gray-200 resize-none focus:outline-none"
            />
          ) : (
            <p
              className="text-sm text-gray-300 truncate cursor-text"
              onDoubleClick={() => setEditing(true)}
              title="双击编辑台词"
            >
              {displayText}
            </p>
          )}
          {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
        </div>
```

替换为：

```tsx
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              ref={editRef}
              defaultValue={displayText}
              onBlur={handleTextBlur}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextBlur(); } }}
              autoFocus
              rows={2}
              className="w-full bg-gray-900 border border-indigo-500/50 rounded px-2 py-1 text-sm text-gray-200 resize-none focus:outline-none"
            />
          ) : (
            <p
              className="text-sm text-gray-300 truncate cursor-text hover:text-gray-100 hover:bg-gray-700/50 rounded px-1 -mx-1 transition-colors group/edit"
              onClick={() => setEditing(true)}
              title="点击编辑台词"
            >
              {displayText}
              <span className="invisible group-hover/edit:visible text-gray-500 ml-1 text-[10px]">✎</span>
            </p>
          )}
          {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
        </div>
```

**改动说明**：
- `onDoubleClick` → `onClick`：降低编辑门槛
- hover 时背景高亮 + 显示 ✎ 图标：让用户知道可以编辑
- 加 `group/edit` 实现 hover 铅笔可见性切换

- [ ] **Step 4: DubbingCard — 移除不再使用的 User import**

如果 `User` 不再被使用（头像改为首字符后），从 import 中删除：

将 L2-4：
```typescript
import {
  Play, Pause, Mic, RefreshCw, Loader, User, ChevronDown,
} from 'lucide-react';
```

替换为：
```typescript
import {
  Play, Pause, Mic, RefreshCw, Loader, ChevronDown,
} from 'lucide-react';
```

- [ ] **Step 5: DubbingPanel — 透传 onTextPersist**

在 `DubbingPanelProps` 接口（L12-29）的 `clipKeyFn` 后面加一行：

```typescript
  onTextPersist?: (itemId: string, speaker: string, newText: string) => void;
```

在组件解构（L32-38）中加入 `onTextPersist`：

```typescript
  const {
    storyboardItems, clips, voiceMap, charAssetMap,
    localOverrides, setLocalOverrides,
    localAudio, generatingIds, errors, playingKey,
    onGenerate, onTogglePlay, onBatchGenerate, batchRunning,
    allCharNames, clipKeyFn, onTextPersist,
  } = props;
```

在 `<DubbingCard>` 渲染处（L141-158），在 `allCharNames={allCharNames}` 后面加一行：

```tsx
                        onTextPersist={onTextPersist}
```

即：
```tsx
                      <DubbingCard
                        key={key}
                        clip={clip}
                        clipKey={key}
                        voice={voiceMap.get(clip.characterName)}
                        charAsset={charAssetMap.get(clip.characterName)}
                        override={localOverrides[key] || {}}
                        onOverrideChange={handleOverrideChange}
                        audioUrl={audio?.url || (clip.audioUrl ? (clip.audioUrl.startsWith('/') ? clip.audioUrl : `/${clip.audioUrl}`) : '')}
                        audioDurationMs={audio?.durationMs || clip.durationMs}
                        isGenerating={generatingIds.has(key)}
                        error={errors[key] || null}
                        isPlaying={playingKey === key}
                        onGenerate={() => onGenerate(clip)}
                        onTogglePlay={() => onTogglePlay(key)}
                        plannedDurationMs={item.plannedDurationMs}
                        allCharNames={allCharNames}
                        onTextPersist={onTextPersist}
                      />
```

- [ ] **Step 6: AudioStagePage — 新增 handleTextPersist 并传递**

在 `AudioStagePage.tsx` 的 useEpisode 解构（L23-26）中加入 `saveStoryboardItem`：

```typescript
  const {
    storyboardItems, assets, characterVoices, audioTracks,
    projectId, episodeId, script, isLoading, error, reload, loadSlices,
    saveStoryboardItem,
  } = useEpisode();
```

在 `handleBatchGenerate` 之后（约 L166），`togglePlay` 之前，添加：

```typescript
  const handleTextPersist = useCallback(async (itemId: string, speaker: string, newText: string) => {
    const fullDialogue = speaker ? `${speaker}：${newText}` : newText;
    try {
      await saveStoryboardItem(itemId, { dialogue: fullDialogue });
    } catch (e) {
      console.error('持久化台词失败:', e);
    }
  }, [saveStoryboardItem]);
```

在 `<DubbingPanel>` 传参处（L237-255），在 `clipKeyFn={clipKey}` 后面加一行：

```tsx
          onTextPersist={handleTextPersist}
```

- [ ] **Step 7: 验证构建**

运行 `npx vite build`，确认无 TypeScript 错误。

---

### Task 7: 同步到 deploy 并构建验证

**Files:**
- Sync: `new_html/utils/episodeAdapters.ts` → `deploy/new_html/utils/episodeAdapters.ts`
- Sync: `new_html/pages/MaterialsPage.tsx` → `deploy/new_html/pages/MaterialsPage.tsx`
- Sync: `new_html/components/MaterialPage.tsx` → `deploy/new_html/components/MaterialPage.tsx`
- Sync: `new_html/components/audio/DubbingCard.tsx` → `deploy/new_html/components/audio/DubbingCard.tsx`
- Sync: `new_html/components/audio/DubbingPanel.tsx` → `deploy/new_html/components/audio/DubbingPanel.tsx`
- Sync: `new_html/pages/AudioStagePage.tsx` → `deploy/new_html/pages/AudioStagePage.tsx`

- [ ] **Step 1: 复制 6 个修改文件到 deploy**

```powershell
Copy-Item H:\MY2\new_html\utils\episodeAdapters.ts H:\MY2\deploy\new_html\utils\episodeAdapters.ts -Force
Copy-Item H:\MY2\new_html\pages\MaterialsPage.tsx H:\MY2\deploy\new_html\pages\MaterialsPage.tsx -Force
Copy-Item H:\MY2\new_html\components\MaterialPage.tsx H:\MY2\deploy\new_html\components\MaterialPage.tsx -Force
Copy-Item H:\MY2\new_html\components\audio\DubbingCard.tsx H:\MY2\deploy\new_html\components\audio\DubbingCard.tsx -Force
Copy-Item H:\MY2\new_html\components\audio\DubbingPanel.tsx H:\MY2\deploy\new_html\components\audio\DubbingPanel.tsx -Force
Copy-Item H:\MY2\new_html\pages\AudioStagePage.tsx H:\MY2\deploy\new_html\pages\AudioStagePage.tsx -Force
```

- [ ] **Step 2: 本地构建验证**

```powershell
cd H:\MY2\new_html
npx vite build
```

预期：`vite build` 成功，无错误。

- [ ] **Step 3: 同步 dist 到 deploy**

```powershell
Copy-Item H:\MY2\new_html\dist\* H:\MY2\deploy\new_html\dist\ -Recurse -Force
```

---

## 端到端验证清单

完成所有 Task 后，在远程服务器执行以下验证：

1. **解除锁定**：进入素材绑定页 → 选择已绑定的角色 → 点击"解除锁定 (及后续)" → 绿色边框消失，状态变为"请选择素材"
2. **多图切换**：上传/生成多张角色素材 → 点击第 2 张图 → 绿色边框移到第 2 张 → 刷新页面 → 绿色边框仍在第 2 张
3. **剧本描述**：进入素材绑定页 → 查看"剧本描述"区域 → 内容应为带标签的原始分镜文本，与"画面提示词"不同
4. **配音头像**：进入声音与配音页 → 有素材的角色应显示小圆形头像 → 无素材的角色/旁白显示紫色首字符圆形
5. **台词编辑**：点击台词文本 → 进入编辑模式 → 修改后点击外部 → 编辑保留 → 刷新页面 → 编辑仍在 → 点击"生成"使用修改后的台词
