# 全页面数据持久化修复 — 详细实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复所有页面的数据持久化 bug，统一素材 ID 格式，将后端生成图片转为 WebP 无损格式

**Architecture:** 前端修复集中在 3 个页面组件（AudioStagePage、MaterialsPage、DesignPage）和 1 个适配器（episodeAdapters.ts）；后端修复在 worker.py、comfyui_agent.py、api_routes.py。所有改动互相独立，可按 Task 顺序逐个提交。

**Tech Stack:** React/TypeScript (Vite)、Python (FastAPI)、PIL/Pillow (WebP)、PostgreSQL

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `new_html/components/audio/DubbingCard.tsx` | 配音卡片组件 | 修改 |
| `new_html/pages/AudioStagePage.tsx` | 配音页面 | 修改 |
| `new_html/pages/MaterialsPage.tsx` | 素材绑定路由页 | 修改 |
| `new_html/utils/episodeAdapters.ts` | 数据适配层 | 修改 |
| `new_html/pages/DesignPage.tsx` | 角色/场景设计页 | 修改 |
| `new_html/components/MaterialPage.tsx` | 素材绑定 UI 组件 | 修改 |
| `worker.py` | 后端任务 worker | 修改 |
| `comfyui_agent.py` | ComfyUI 代理 | 修改 |
| `api_routes.py` | 后端路由 | 修改 |

---

### Task 1: DubbingCard 空文本保存修复 (A1)

**Files:**
- Modify: `new_html/components/audio/DubbingCard.tsx:77-84`

**问题**: `handleTextBlur` 中 `if (val && val !== clip.text)` — 空字符串是 falsy，清空文本后不触发保存，UI 刷新后回退到原始文本。

- [ ] **Step 1: 修改 `handleTextBlur` 逻辑**

将 `DubbingCard.tsx` 第 77-84 行从：

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

改为：

```typescript
const handleTextBlur = useCallback(() => {
    setEditing(false);
    const trimmed = editRef.current?.value.trim() ?? '';
    if (trimmed !== clip.text) {
      onOverrideChange(clipKey, { text: trimmed });
      onTextPersist?.(clip.itemId, displaySpeaker, trimmed);
    }
  }, [clip.text, clip.itemId, clipKey, onOverrideChange, onTextPersist, displaySpeaker]);
```

关键变化：用 `trimmed !== clip.text` 替代 `val && val !== clip.text`，允许空字符串通过。

- [ ] **Step 2: 验证改动**

检查 linter 无报错。

---

### Task 2: AudioStagePage 空文本拼接角色名修复 (A2)

**Files:**
- Modify: `new_html/pages/AudioStagePage.tsx:169-173`

**问题**: `handleTextPersist` 中 `speaker ? \`${speaker}：${newText}\` : newText` — 当 `newText` 为空时，保存为 `"旁白："` 而非空字符串。

- [ ] **Step 1: 修改 `handleTextPersist` 逻辑**

将 `AudioStagePage.tsx` 第 169-173 行从：

```typescript
const handleTextPersist = useCallback(async (itemId: string, speaker: string, newText: string) => {
    const fullDialogue = speaker ? `${speaker}：${newText}` : newText;
    try {
      await saveStoryboardItem(itemId, { dialogue: fullDialogue });
```

改为：

```typescript
const handleTextPersist = useCallback(async (itemId: string, speaker: string, newText: string) => {
    const fullDialogue = newText ? (speaker ? `${speaker}：${newText}` : newText) : '';
    try {
      await saveStoryboardItem(itemId, { dialogue: fullDialogue });
```

关键变化：`newText` 为空时直接保存空字符串，不拼接角色名前缀。

- [ ] **Step 2: 验证改动**

检查 linter 无报错。

---

### Task 3: AudioStagePage duration_ms=0 不更新修复 (A5)

**Files:**
- Modify: `new_html/pages/AudioStagePage.tsx:149`

**问题**: `if (durationMs && Number.isFinite(durationMs))` — `0` 是 falsy，时长为 0 时不写入数据库。

- [ ] **Step 1: 修改条件判断**

将 `AudioStagePage.tsx` 第 149 行从：

```typescript
if (durationMs && Number.isFinite(durationMs)) updateFields.audio_duration_ms = durationMs;
```

改为：

```typescript
if (durationMs != null && Number.isFinite(durationMs)) updateFields.audio_duration_ms = durationMs;
```

关键变化：`durationMs &&` → `durationMs != null &&`，允许 `0` 通过。

- [ ] **Step 2: 验证改动**

检查 linter 无报错。

---

### Task 4: 素材解绑 bug 修复 (B1 修订)

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx:176-194`
- Modify: `new_html/utils/episodeAdapters.ts:14,16-42,95-127`

**问题**: 用户点击"解除锁定"按钮后，`handleUnbindMaterial` 把 `char:女主` 和 `sel:女主:xxx` 全部从 `boundAssets` 中移除。但 `dbItemToStoryboardItem` 在重新计算时，文本匹配把角色加回 `characters` 列表，然后 `materialSelections` 的自动回退逻辑（line 106: `materialSelections[charName] = \`${asset.assetId}_0\``）又自动绑回第一张图。用户看到的效果是点了没反应。

**修复策略**:  引入 `nosel:tagName` 显式标记来区分三种状态：
- `["char:女主"]` — auto-patch 初始状态 → 自动选第一张图 ✓
- `["char:女主", "sel:女主:abc"]` — 用户显式绑定 → 用选定的图 ✓
- `["char:女主", "nosel:女主"]` — 用户显式解绑 → 不选任何图 ✓

这避免了「解绑」与「auto-patch 初始」状态的冲突。

- [ ] **Step 1: 在 `episodeAdapters.ts` 中添加 `NOSEL_PREFIX` 并解析**

在 `episodeAdapters.ts` 第 14 行，紧接 `SEL_PREFIX` 后添加常量：

```typescript
const NOSEL_PREFIX = 'nosel:';
```

然后修改 `parseBoundAssetTags` 函数，在返回类型和逻辑中加入 `noSelections`：

将现有的：

```typescript
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

改为：

```typescript
export function parseBoundAssetTags(boundAssets: string[]): {
  charNames: string[];
  sceneName: string;
  assetIds: string[];
  selections: Record<string, string>;
  noSelections: Set<string>;
} {
  const charNames: string[] = [];
  let sceneName = '';
  const assetIds: string[] = [];
  const selections: Record<string, string> = {};
  const noSelections = new Set<string>();
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
    } else if (entry.startsWith(NOSEL_PREFIX)) {
      noSelections.add(entry.slice(NOSEL_PREFIX.length));
    } else {
      assetIds.push(entry);
    }
  }
  return { charNames, sceneName, assetIds, selections, noSelections };
}
```

关键变化：增加 `noSelections: Set<string>` 返回值，解析 `nosel:tagName` 标签。

- [ ] **Step 2: 修改 `handleUnbindMaterial` — 写入 `nosel:` 标记**

将 `MaterialsPage.tsx` 第 176-194 行的 `handleUnbindMaterial` 从：

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
      await saveStoryboardItem(shotId, { bound_assets: filtered, boundAssets: filtered });
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [storyboardItems, assetNameToId, saveStoryboardItem]);
```

改为：

```typescript
const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
    const item = storyboardItems.find(si => si.itemId === shotId);
    if (!item) return;

    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(item.boundAssets) ? item.boundAssets : [];
    const filtered = currentBound.filter(id =>
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
  }, [storyboardItems, assetNameToId, saveStoryboardItem]);
```

关键变化：
- 保留 `char:tagName` / `scene:tagName`（不再过滤它们）
- 移除旧的 `sel:tagName:...` 和旧的 `nosel:tagName`（防重复）
- 追加 `nosel:tagName` 显式解绑标记

- [ ] **Step 3: 修改 `dbItemToStoryboardItem` 的 materialSelections 逻辑**

将 `episodeAdapters.ts` 第 46 行解构更新为包含 `noSelections`：

```typescript
const { charNames, sceneName, assetIds, selections, noSelections } = parseBoundAssetTags(boundAssets);
```

然后将第 95-127 行的 `materialSelections` 构建逻辑从：

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

改为：

```typescript
const materialSelections: Record<string, string> = {};
  if (assets) {
    for (const charName of characters) {
      if (selections[charName]) {
        materialSelections[charName] = selections[charName];
        continue;
      }
      if (noSelections.has(charName)) continue;
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
      } else if (noSelections.has(scene)) {
        // 用户已显式解绑此场景，不自动回退
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

关键变化：
- 角色：增加 `if (noSelections.has(charName)) continue;` — 如果存在 `nosel:charName` 标记，跳过自动回退。
- 场景：增加 `else if (noSelections.has(scene))` 分支 + 注释 — 同理。
- Auto-patch 初始状态（只有 `char:X`，无 `nosel:X`）不受影响，仍然自动选第一张图。

- [ ] **Step 4: 修改 `handleBindMaterial` — 绑定时清除 `nosel:` 标记**

在 `MaterialsPage.tsx` 的 `handleBindMaterial`（约第 150-174 行）中，确保绑定时移除 `nosel:tagName`。当前的 `cleaned` 过滤逻辑需要增加一个条件：

将现有的：

```typescript
const cleaned = currentBound.filter(id =>
      !id.startsWith(`sel:${tagName}:`) && id !== rawId
    );
```

改为：

```typescript
const cleaned = currentBound.filter(id =>
      !id.startsWith(`sel:${tagName}:`) && id !== rawId && id !== `nosel:${tagName}`
    );
```

关键变化：重新绑定素材时，移除之前的 `nosel:tagName` 标记。

- [ ] **Step 5: 验证改动**

检查 linter 无报错。确认：
- `parseBoundAssetTags` 的新返回类型不影响其他调用点（在 `episodeAdapters.ts` 中 `dbItemToStoryboardItem` 第 46 行是主要消费者）
- `noSelections` 是 `Set<string>` 类型，`has()` 方法正确
- 解绑 → 绑定 → 解绑的循环操作不会残留无效标记

---

### Task 5: DesignPage 单图删除 (B2)

**Files:**
- Modify: `new_html/pages/DesignPage.tsx:397-405`

**问题**: 设计页面可以给角色上传/生成多张参考图，但没有删除单张图的入口。

- [ ] **Step 1: 改为按 `rawImgs` 遍历并添加删除按钮**

`allImages` 由 `rawImgs.map(secureMediaUrl).filter(Boolean)` 生成，`filter(Boolean)` 可能移除空值导致索引与 `rawImgs` 错位。修复方案：改为按 `rawImgs` 遍历，内联计算 displayUrl，仅在有效时渲染。

将 `DesignPage.tsx` 第 397-406 行的图片网格从：

```typescript
{allImages.length > 0 && (
  <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
    {allImages.map((url, i) => (
      <button key={i} onClick={() => setLightboxUrl(url)} className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-gray-700 hover:border-indigo-500 transition-colors group relative">
        <img src={url} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center"><ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" /></div>
      </button>
    ))}
  </div>
)}
```

改为：

```typescript
{allImages.length > 0 && (
  <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
    {rawImgs.map((rawUrl, i) => {
      const displayUrl = secureMediaUrl(rawUrl);
      if (!displayUrl) return null;
      return (
        <div key={rawUrl} className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-gray-700 hover:border-indigo-500 transition-colors group relative">
          <button onClick={() => setLightboxUrl(displayUrl)} className="w-full h-full">
            <img src={displayUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center"><ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" /></div>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteImage(asset.assetId, rawUrl); }}
            disabled={busy}
            className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
          >
            <X size={10} />
          </button>
        </div>
      );
    })}
  </div>
)}
```

关键变化：
- 遍历 `rawImgs` 而非 `allImages`，保证删除回调传入的 `rawUrl` 与 `referenceImages` 中的原始值一致
- 内联调用 `secureMediaUrl(rawUrl)` 得到 `displayUrl`，空值时 `return null` 跳过渲染
- `key={rawUrl}` 使用 URL 作为稳定 key

- [ ] **Step 2: 添加 `handleDeleteImage` 函数**

在 `DesignPage.tsx` 中 `handleUploadImage` 函数附近（约第 167 行后）添加：

```typescript
const handleDeleteImage = useCallback(async (assetId: string, imageUrl: string) => {
    const asset = assets.find(a => a.assetId === assetId);
    if (!asset) return;
    const newRefs = (asset.referenceImages || []).filter(u => u !== imageUrl);
    const newThumb = asset.thumbnailUrl === imageUrl ? (newRefs[0] || '') : asset.thumbnailUrl;
    try {
      await updateAsset(assetId, { reference_images: newRefs, thumbnail_url: newThumb });
      await reload();
    } catch (err) { console.error('删除图片失败:', err); }
  }, [assets, reload]);
```

逻辑说明：
- 按 URL 匹配（而非索引），避免 `allImages = rawImgs.map(secureMediaUrl).filter(Boolean)` 与 `rawImgs` 索引不一致的问题
- 从 `referenceImages` 中过滤掉该 URL
- 如果删除的正好是 `thumbnailUrl`，则用剩余图片的第一张替代

- [ ] **Step 3: 验证改动**

检查 linter 无报错。确认 `X` 图标已在文件顶部导入。

---

### Task 6: 素材 ID 格式统一 (B6)

**Files:**
- Modify: `new_html/pages/DesignPage.tsx:97`

**问题**: `assetToMaterials` 函数生成 ID 格式为 `${assetId}_img_${i}`（如 `abc123_img_0`），但 `episodeAdapters.ts` 中 `assetsToMaterialLibrary` 和 `materialSelections` 使用 `${assetId}_${i}`（如 `abc123_0`）。ID 不一致导致素材绑定后从设计页面选择的素材无法在素材绑定页面被正确识别。

- [ ] **Step 1: 修改 `assetToMaterials` 的 ID 格式**

将 `DesignPage.tsx` 第 97 行从：

```typescript
allImages.forEach((url, i) => { if (url) mats.push({ id: `${asset.assetId}_img_${i}`, url, name: asset.name }); });
```

改为：

```typescript
allImages.forEach((url, i) => { if (url) mats.push({ id: `${asset.assetId}_${i}`, url, name: asset.name }); });
```

关键变化：`_img_` → `_`，与 `episodeAdapters.ts:217` 的格式统一。

**数据兼容说明**: 数据库中 `bound_assets` 可能已存有旧格式 `sel:角色:assetId_img_0` 的条目。这些条目在 `parseBoundAssetTags` 中仍会被解析为 `selections["角色"] = "assetId_img_0"`，而 `materialSelections` 中比对时找不到匹配的素材 ID（因为素材库现在生成 `assetId_0`），会回退到自动选择。用户重新绑定后即会写入新格式，不需要数据迁移。

- [ ] **Step 2: 验证改动**

检查 linter 无报错。

---

### Task 7: 视频段删除 API (B3)

**Files:**
- Modify: `api_routes.py`（在 `update_video_segment` 路由后添加）

**问题**: `VideoSegmentDAO.delete` 方法已存在，但没有暴露 HTTP 端点。前端无法删除视频段。

- [ ] **Step 1: 在 `api_routes.py` 中添加删除端点**

在 `update_video_segment` 路由（约第 1748 行）之后添加：

```python
@router.delete("/api/video-segments/{segment_id}")
async def delete_video_segment(segment_id: str, user_id: str = Depends(get_current_user)):
    ok = await VideoSegmentDAO.delete(segment_id)
    if not ok:
        raise HTTPException(404, "视频段不存在")
    return {"success": True}
```

- [ ] **Step 2: 同步到 `deploy/api_routes.py`**

将相同改动同步到 `deploy/api_routes.py` 对应位置。

- [ ] **Step 3: 验证改动**

检查 Python 语法无误。

---

### Task 8: MaterialPage 误导文案清理 + 版本存档 UI 隐藏 (B5)

**Files:**
- Modify: `new_html/components/MaterialPage.tsx`

**问题**: 
1. 页面上有 "数据库实时同步中" 等文案，但实际上 MaterialsPage 路由下的版本存档回调都是 no-op（空函数），可能误导用户。
2. 版本存档相关按钮（保存版本、恢复版本等）在 MaterialsPage 路由下全部是空操作。

- [ ] **Step 1: 查找并确认误导文案**

在 `MaterialPage.tsx` 中搜索 "数据库实时同步" 或 "实时同步" 文案，确认其位置。

- [ ] **Step 2: 移除或修改误导文案**

如果找到，将其替换为准确描述（如 "素材绑定数据已自动保存"），或直接移除。

- [ ] **Step 3: 隐藏版本存档相关 UI**

给 `MaterialPage` 添加可选 prop `hideVersionArchive?: boolean`，当为 `true` 时隐藏版本存档的保存/恢复/删除按钮区块。

在 `MaterialsPage.tsx` 传入 `hideVersionArchive={true}`。

这样 MaterialPage 在其他上下文中仍可使用版本存档功能（如果将来需要），但在 MaterialsPage 路由下不展示无效按钮。

- [ ] **Step 4: 验证改动**

检查 linter 无报错。

---

### Task 9: worker.py — 生成图片转 WebP 无损 (C1)

**Files:**
- Modify: `worker.py:1400-1414`

**问题**: 当前仅剥离 PNG tEXt 元数据，仍然保存为 PNG 格式，文件体积大。

- [ ] **Step 1: 替换 PNG 元数据剥离为 WebP 无损转换**

将 `worker.py` 第 1400-1414 行从：

```python
            # 剥离 PNG 工作流元数据（ComfyUI 在 tEXt 块嵌入完整工作流 JSON）
            if file_type == 'image' and ext.lower() == '.png':
                try:
                    from PIL import Image
                    import io
                    original_size = len(file_content)
                    img = Image.open(io.BytesIO(file_content))
                    buf = io.BytesIO()
                    img.save(buf, format='PNG')
                    file_content = buf.getvalue()
                    saved = original_size - len(file_content)
                    if saved > 0:
                        logger.info(f"🗜️ PNG元数据已剥离: {original_size} -> {len(file_content)} bytes (节省 {saved} bytes)")
                except Exception as strip_err:
                    logger.debug(f"PNG元数据剥离跳过: {strip_err}")
```

改为：

```python
            if file_type == 'image' and ext.lower() in ('.png', '.jpg', '.jpeg'):
                try:
                    from PIL import Image
                    import io
                    original_size = len(file_content)
                    img = Image.open(io.BytesIO(file_content))
                    buf = io.BytesIO()
                    img.save(buf, format='WEBP', lossless=True)
                    file_content = buf.getvalue()
                    ext = '.webp'
                    unique_filename = f"{uuid.uuid4().hex[:12]}.webp"
                    local_path = upload_dir / unique_filename
                    saved = original_size - len(file_content)
                    logger.info(f"🗜️ 转换为WebP无损: {original_size} -> {len(file_content)} bytes (节省 {saved} bytes)")
                except Exception as e:
                    logger.debug(f"WebP转换跳过: {e}")
```

关键变化：
- 扩展范围：`.png` → `.png, .jpg, .jpeg`
- 输出格式：`PNG` → `WEBP` + `lossless=True`
- 更新文件名和扩展名为 `.webp`
- 重新计算 `local_path`（因为文件名变了）

- [ ] **Step 2: 更新 mime_type**

在 `_save_result_file` 中构建 `file_url` 后、保存到数据库时（约第 1440-1450 行），确认 `mime_type` 取决于实际扩展名。如果当前是硬编码为 `'image/png'`，需改为根据 `ext` 动态判断：

```python
MIME_MAP = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4'}
mime_type = MIME_MAP.get(ext.lower(), f'{file_type}/{ext.lstrip(".")}')
```

检查 `FileDAO.create_file` 调用处传入的 `mime_type` 参数，确保使用上面的 `mime_type` 变量而非硬编码值。注意：WebP 转换在 `try` 块内，失败时 `ext` 保持原值（`.png`/`.jpg`），`MIME_MAP` 同样能正确映射。

- [ ] **Step 3: 同步到 `deploy/worker.py`**

将 Step 1 和 Step 2 的改动同步到 `deploy/worker.py` 对应位置。

- [ ] **Step 4: 验证改动**

检查 Python 语法无误。确认 `uuid` 已在文件顶部导入（已有）。

---

### Task 10: comfyui_agent.py — 下载输出转 WebP 无损 (C2)

**Files:**
- Modify: `comfyui_agent.py:276-303`

**问题**: 当前仅剥离 PNG 元数据，保存为 PNG。需改为 WebP 无损转换。

- [ ] **Step 1: 替换 `_strip_png_metadata` 为 `_convert_to_webp_lossless`**

将 `comfyui_agent.py` 第 290-303 行的 `_strip_png_metadata` 静态方法替换为：

```python
@staticmethod
    def _convert_to_webp_lossless(path):
        """将 PNG/JPG 转换为 WebP 无损格式"""
        try:
            from PIL import Image
            original_size = os.path.getsize(path)
            img = Image.open(path)
            webp_path = str(Path(path).with_suffix('.webp'))
            img.save(webp_path, format='WEBP', lossless=True)
            new_size = os.path.getsize(webp_path)
            os.remove(path)
            logger.info(f"PNG→WebP lossless: {original_size} -> {new_size} bytes (saved {original_size - new_size})")
            return webp_path
        except Exception as e:
            logger.debug(f"WebP conversion skipped: {e}")
            return path
```

- [ ] **Step 2: 更新 `_download_comfyui_output` 调用**

将 `comfyui_agent.py` 第 276-288 行从：

```python
def _download_comfyui_output(self, port, file_info):
        fname = file_info.get("filename", "")
        subfolder = file_info.get("subfolder", "")
        ftype = file_info.get("type", "output")
        url = f"http://127.0.0.1:{port}/view?filename={fname}&subfolder={subfolder}&type={ftype}"
        try:
            local_path = self._download_file(url, expected_filename=fname)
            if local_path and fname.lower().endswith('.png'):
                self._strip_png_metadata(local_path)
            return local_path
        except Exception as e:
            logger.error(f"Failed to download output {fname}: {e}")
            return None
```

改为：

```python
def _download_comfyui_output(self, port, file_info):
        fname = file_info.get("filename", "")
        subfolder = file_info.get("subfolder", "")
        ftype = file_info.get("type", "output")
        url = f"http://127.0.0.1:{port}/view?filename={fname}&subfolder={subfolder}&type={ftype}"
        try:
            local_path = self._download_file(url, expected_filename=fname)
            if local_path and fname.lower().endswith(('.png', '.jpg', '.jpeg')):
                return self._convert_to_webp_lossless(local_path)
            return local_path
        except Exception as e:
            logger.error(f"Failed to download output {fname}: {e}")
            return None
```

关键变化：
- `fname.lower().endswith('.png')` → `fname.lower().endswith(('.png', '.jpg', '.jpeg'))`
- `self._strip_png_metadata(local_path)` → `return self._convert_to_webp_lossless(local_path)`
- 返回 WebP 路径（文件名已变）

- [ ] **Step 3: 确认 `Path` 和 `os` 已导入**

检查文件顶部是否有 `from pathlib import Path` 和 `import os`。

- [ ] **Step 4: 同步到 `deploy/comfyui_agent.py`**

将相同改动同步到 `deploy/comfyui_agent.py` 对应位置。

- [ ] **Step 5: 验证改动**

检查 Python 语法无误。

---

### Task 11: 前端构建 + deploy 同步

**Files:**
- Build: `new_html/` → `dist/`
- Copy: `dist/` → `deploy/dist/`

- [ ] **Step 1: 构建前端**

Run: `npm run build` (in `new_html/`)
Expected: 构建成功，输出到 `dist/` 目录

- [ ] **Step 2: 同步 dist 到 deploy**

将构建产物复制到 `deploy/dist/` 目录。

- [ ] **Step 3: 同步后端文件到 deploy**

确认以下文件与源文件一致：
- `deploy/worker.py` ← `worker.py`
- `deploy/comfyui_agent.py` ← `comfyui_agent.py`
- `deploy/api_routes.py` ← `api_routes.py`

---

## 不修改项（说明理由）

| 项 | 理由 |
|----|------|
| B4 情绪/语速参数 | TTS 生成参数不需要跨会话保存，保持本地状态即可 |
| B7 同名资产处理 | 经确认，当前代码已是合并逻辑（`push`），不是覆盖，无需修改 |
| L1-L4 | 低优先级功能缺失，不影响核心数据流 |
| EnhancePage 全部 | 需独立设计文档，不在本期范围 |

---

## 执行顺序与依赖

```
Task 1 ─┐
Task 2 ─┼─ Phase A (互相独立) ─→ Task 11 (构建)
Task 3 ─┘
Task 4 ──── Phase B 核心 (解绑 bug) ─→ Task 11
Task 5 ──── Phase B (单图删除，独立) ─→ Task 11
Task 6 ──── Phase B (ID 统一，独立) ─→ Task 11
Task 7 ──── Phase B (后端 API，独立) ─→ Task 11
Task 8 ──── Phase B (文案，独立) ─→ Task 11
Task 9 ─┬── Phase C (WebP，互相独立) ─→ Task 11
Task 10 ┘
```

**总计**: 11 个 Task，预估 ~60 min
