# 数据流全链路修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复人物/场景信息在 WorkspaceApp→DB→下游页面 的传递链中丢失的问题，同时修复 DesignPage 已设计计数 bug。

**Architecture:** 利用已有的 `storyboard_items.bound_assets` JSONB 列，用前缀标签 `char:名字` / `scene:名字` 存储人物场景元数据。DAO `create` 方法扩展接收该字段，前端适配层解析标签、兜底文本匹配。不需要 DB 迁移。

**Tech Stack:** Python (asyncpg), TypeScript (React), PostgreSQL JSONB

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `dao_storyboard.py` | Modify | DAO create/batch_create 支持 bound_assets 写入 |
| `deploy/dao_storyboard.py` | Sync | 同上 |
| `new_html/WorkspaceApp.tsx` | Modify | 导出时编码 char:/scene: 到 bound_assets |
| `deploy/new_html/WorkspaceApp.tsx` | Sync | 同上 |
| `new_html/utils/episodeAdapters.ts` | Modify | 解析标签 + 持久化 characters/scene 变更 |
| `deploy/new_html/utils/episodeAdapters.ts` | Sync | 同上 |
| `new_html/pages/DesignPage.tsx` | Modify | designedCount 统计全部资产 |
| `deploy/new_html/pages/DesignPage.tsx` | Sync | 同上 |
| `new_html/pages/MaterialsPage.tsx` | Modify | bind/unbind 保护前缀标签 |
| `deploy/new_html/pages/MaterialsPage.tsx` | Sync | 同上 |

---

### Task 1: DAO — create/batch_create 支持 bound_assets

**Files:**
- Modify: `dao_storyboard.py:14-62`
- Sync: `deploy/dao_storyboard.py`

- [ ] **Step 1: Modify `create` method — add `bound_assets` parameter**

```python
@staticmethod
async def create(
    episode_id: str,
    sort_order: int,
    scene_heading: str = '',
    action_text: str = '',
    dialogue: str = '',
    camera_movement: str = '',
    image_prompt: str = '',
    video_prompt: str = '',
    bound_assets: list = None,
) -> Optional[Dict[str, Any]]:
    db = get_db_manager()
    if not db:
        return None
    item_id = f"sb_{uuid.uuid4().hex[:12]}"
    query = """
        INSERT INTO storyboard_items
            (item_id, episode_id, sort_order, scene_heading, action_text,
             dialogue, camera_movement, image_prompt, video_prompt, bound_assets)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        RETURNING *
    """
    return await db.fetchrow(
        query, item_id, episode_id, sort_order,
        scene_heading, action_text, dialogue,
        camera_movement, image_prompt, video_prompt,
        json.dumps(bound_assets or [], ensure_ascii=False)
    )
```

- [ ] **Step 2: Modify `batch_create` — pass through `bound_assets`**

```python
@staticmethod
async def batch_create(episode_id: str, items: list) -> List[Dict[str, Any]]:
    """批量创建分镜。每个 item dict 至少需要 sort_order。"""
    db = get_db_manager()
    if not db:
        return []
    results = []
    for item in items:
        row = await StoryboardDAO.create(
            episode_id=episode_id,
            sort_order=item.get('sort_order', 0),
            scene_heading=item.get('scene_heading', ''),
            action_text=item.get('action_text', ''),
            dialogue=item.get('dialogue', ''),
            camera_movement=item.get('camera_movement', ''),
            image_prompt=item.get('image_prompt', ''),
            video_prompt=item.get('video_prompt', ''),
            bound_assets=item.get('bound_assets'),
        )
        if row:
            results.append(dict(row))
    return results
```

- [ ] **Step 3: Sync to deploy**

```bash
Copy-Item -Force dao_storyboard.py deploy/dao_storyboard.py
```

---

### Task 2: WorkspaceApp — 导出时编码 characters/scene 到 bound_assets

**Files:**
- Modify: `new_html/WorkspaceApp.tsx:1766-1779`
- Sync: `deploy/new_html/WorkspaceApp.tsx`

- [ ] **Step 1: Add bound_assets encoding in handleExportStoryboards**

在 `dbItems` 映射中，已有 `characters` 和 `scene` 字段，需要新增 `bound_assets` 字段将它们编码为前缀标签：

```typescript
const dbItems = selectedFile.storyboard.items.map((item, idx) => ({
  sort_order: idx,
  scene_heading: item.originalText || item.scene || '',
  action_text: item.scriptSegment || '',
  dialogue: item.dialogue || '',
  camera_movement: item.cameraMovement || '',
  image_prompt: item.imagePrompt || '',
  video_prompt: item.videoPrompt || '',
  bound_assets: [
    ...(item.characters || []).map((c: string) => `char:${c}`),
    ...(item.scene ? [`scene:${item.scene}`] : []),
  ],
  characters: item.characters || [],
  scene: item.scene || '',
  status: 'draft',
}));
```

- [ ] **Step 2: Sync to deploy**

```bash
Copy-Item -Force new_html/WorkspaceApp.tsx deploy/new_html/WorkspaceApp.tsx
```

---

### Task 3: episodeAdapters — 解析 bound_assets 标签

**Files:**
- Modify: `new_html/utils/episodeAdapters.ts:12-90`
- Sync: `deploy/new_html/utils/episodeAdapters.ts`

- [ ] **Step 1: Add helper to parse prefixed tags from boundAssets**

在文件顶部（import 后）新增辅助函数：

```typescript
const CHAR_PREFIX = 'char:';
const SCENE_PREFIX = 'scene:';

function parseBoundAssetTags(boundAssets: string[]): {
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

- [ ] **Step 2: Rewrite `dbItemToStoryboardItem` to use tags first, text fallback second**

```typescript
export function dbItemToStoryboardItem(item: StoryboardItemDB, assets?: AssetItem[]): StoryboardItem {
  const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
  const { charNames, sceneName, assetIds } = parseBoundAssetTags(boundAssets);

  // 1) 从标签获取（最可靠）
  let characters = charNames;
  let scene = sceneName;

  // 2) 从 asset ID 绑定获取（用户手动绑定）
  if (assets && assetIds.length > 0) {
    const boundChars = assets
      .filter(a => assetIds.includes(a.assetId) && a.assetType === 'character')
      .map(a => a.name);
    if (boundChars.length > 0) {
      const merged = new Set([...characters, ...boundChars]);
      characters = Array.from(merged);
    }
    if (!scene) {
      scene = assets.find(a => assetIds.includes(a.assetId) && a.assetType === 'scene')?.name || '';
    }
  }

  // 3) 文本匹配兜底
  if (assets && (characters.length === 0 || !scene)) {
    const searchText = [item.sceneHeading, item.actionText, item.dialogue].filter(Boolean).join(' ');
    if (searchText && characters.length === 0) {
      characters = assets
        .filter(a => a.assetType === 'character' && a.name && searchText.includes(a.name))
        .map(a => a.name);
    }
    if (searchText && !scene) {
      scene = assets
        .find(a => a.assetType === 'scene' && a.name && searchText.includes(a.name))
        ?.name || '';
    }
  }

  const generatedImages: GeneratedImage[] = item.generatedImageUrl
    ? [{ id: `gen_${item.itemId}`, url: item.generatedImageUrl, timestamp: Date.now() }]
    : [];

  return {
    id: item.itemId,
    originalText: item.sceneHeading || '',
    scriptSegment: item.actionText || '',
    characters,
    scene,
    dialogue: item.dialogue || '',
    imagePrompt: item.imagePrompt || '',
    videoPrompt: item.videoPrompt || '',
    cameraMovement: item.cameraMovement,
    generatedImage: item.generatedImageUrl || undefined,
    generatedImages,
    selectedImageId: generatedImages.length > 0 ? generatedImages[0].id : undefined,
    materialSelections: {},
    isLocked: item.status === 'locked',
    status: item.status,
  };
}
```

- [ ] **Step 3: Extend `storyboardItemToDbUpdate` to persist characters/scene changes**

```typescript
export function storyboardItemToDbUpdate(updates: Partial<StoryboardItem>): Record<string, any> {
  const result: Record<string, any> = {};
  if (updates.originalText !== undefined) result.scene_heading = updates.originalText;
  if (updates.scriptSegment !== undefined) result.action_text = updates.scriptSegment;
  if (updates.dialogue !== undefined) result.dialogue = updates.dialogue;
  if (updates.imagePrompt !== undefined) result.image_prompt = updates.imagePrompt;
  if (updates.videoPrompt !== undefined) result.video_prompt = updates.videoPrompt;
  if (updates.isLocked !== undefined) result.status = updates.isLocked ? 'locked' : 'draft';
  if (updates.generatedImage !== undefined) result.generated_image_url = updates.generatedImage;
  if ((updates as any).cameraMovement !== undefined) result.camera_movement = (updates as any).cameraMovement;
  return result;
}
```

(此函数不改，因为 characters/scene 通过 bound_assets 持久化，而非独立字段。更新绑定走 MaterialsPage 的 bind/unbind 路径。)

- [ ] **Step 4: Extend `newShotToDbFields` to include bound_assets**

```typescript
export function newShotToDbFields(shot: Omit<StoryboardItem, 'id'>, sortOrder: number): Record<string, any> {
  return {
    sort_order: sortOrder,
    scene_heading: shot.originalText || '',
    action_text: shot.scriptSegment || '',
    dialogue: shot.dialogue || '',
    camera_movement: (shot as any).cameraMovement || '',
    image_prompt: shot.imagePrompt || '',
    video_prompt: shot.videoPrompt || '',
    bound_assets: [
      ...(shot.characters || []).map((c: string) => `char:${c}`),
      ...(shot.scene ? [`scene:${shot.scene}`] : []),
    ],
  };
}
```

- [ ] **Step 5: Sync to deploy**

```bash
Copy-Item -Force new_html/utils/episodeAdapters.ts deploy/new_html/utils/episodeAdapters.ts
```

---

### Task 4: DesignPage — 计数修复

**Files:**
- Modify: `new_html/pages/DesignPage.tsx:154`
- Sync: `deploy/new_html/pages/DesignPage.tsx`

- [ ] **Step 1: Change designedCount to count all assets, update display**

将第 154 行:

```typescript
const designedCount = filtered.filter(a => a.thumbnailUrl || (a.referenceImages?.length > 0)).length;
```

改为:

```typescript
const totalDesignedCount = assets.filter(a => a.thumbnailUrl || (a.referenceImages?.length > 0)).length;
const tabDesignedCount = filtered.filter(a => a.thumbnailUrl || (a.referenceImages?.length > 0)).length;
```

- [ ] **Step 2: Update display to show both total and tab count**

将第 314-318 行:

```html
<p className="text-sm text-gray-500 mt-1">
  AI 辅助设计人物、场景、道具 ·
  <span className="text-emerald-400 ml-1">{designedCount} 已设计</span>
  {filtered.length - designedCount > 0 && <span className="text-amber-400 ml-2">{filtered.length - designedCount} 待设计</span>}
</p>
```

改为:

```html
<p className="text-sm text-gray-500 mt-1">
  AI 辅助设计人物、场景、道具 ·
  <span className="text-emerald-400 ml-1">共 {totalDesignedCount}/{assets.length} 已设计</span>
  {filtered.length - tabDesignedCount > 0 && <span className="text-amber-400 ml-2">当前分类 {tabDesignedCount}/{filtered.length}</span>}
</p>
```

- [ ] **Step 3: Sync to deploy**

```bash
Copy-Item -Force new_html/pages/DesignPage.tsx deploy/new_html/pages/DesignPage.tsx
```

---

### Task 5: MaterialsPage — bind/unbind 保护前缀标签

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx:101-134`
- Sync: `deploy/new_html/pages/MaterialsPage.tsx`

- [ ] **Step 1: Modify handleBindMaterial — preserve char:/scene: tags**

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

绑定操作已经安全：它向数组追加无前缀的 asset ID，不会影响 `char:`/`scene:` 条目。

- [ ] **Step 2: Modify handleUnbindMaterial — only remove non-prefixed entries**

```typescript
const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
  const item = storyboardItems.find(si => si.itemId === shotId);
  if (!item) return;

  const assetId = assetNameToId[tagName];
  if (!assetId) return;

  const currentBound = Array.isArray(item.boundAssets)
    ? item.boundAssets.filter(id => id !== assetId)
    : [];

  try {
    await apiUpdateStoryboardItem(shotId, { bound_assets: currentBound });
    reload();
  } catch (e) {
    console.error('解绑素材失败:', e);
  }
}, [storyboardItems, assetNameToId, reload]);
```

解绑操作也已安全：它只移除匹配的 asset ID。`assetNameToId[tagName]` 是真实的 asset UUID，不会匹配 `char:` / `scene:` 前缀条目。

结论：**MaterialsPage 的 bind/unbind 无需修改**，前缀标签自动被保护。

- [ ] **Step 3: Sync to deploy (if any changes)**

如果无实际修改，跳过此步。

---

### Task 6: 最终验证

- [ ] **Step 1: Run linter check on all modified files**
- [ ] **Step 2: Verify deploy sync is complete**
