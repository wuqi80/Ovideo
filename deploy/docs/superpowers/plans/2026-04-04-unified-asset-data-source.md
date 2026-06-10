# 统一资产图片数据源 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除资产图片的双数据源问题，让所有页面统一从 `EpisodeContext.assets`（含内嵌 entity files）获取图片数据。

**Architecture:** 后端 `GET /api/projects/{pid}/assets` 在返回 assets 时批量 JOIN `files` 表，将 entity files 内嵌到每个 asset 中。前端 `normalizeAsset` 解析 `entity_files`，`assetsToMaterialLibrary` 优先使用 entity files 构建素材库。DesignPage 移除独立的 `useEntityFilesQuery` 调用，所有页面通过 EpisodeContext 统一消费。

**Tech Stack:** Python/FastAPI, PostgreSQL, React/TypeScript, React Query

**Spec:** `docs/superpowers/specs/2026-04-04-unified-asset-data-source-design.md`

---

### Task 1: 修复 `_sync_legacy_on_file_create` import

**Files:**
- Modify: `file_service.py:239`
- Modify: `deploy/file_service.py:239`

- [ ] **Step 1: 修复 import 路径**

`file_service.py` 第 239 行，将错误的 import 改为正确的模块：

```python
# 修复前（第 239 行）:
    from database_config import get_db_manager
# 修复后:
    from db_manager import get_db_manager
```

- [ ] **Step 2: 同步 deploy 版本**

对 `deploy/file_service.py` 做完全相同的修改。

- [ ] **Step 3: Commit**

```bash
git add file_service.py deploy/file_service.py
git commit -m "fix: correct import path in _sync_legacy_on_file_create

Was importing get_db_manager from database_config (which doesn't export
it), causing silent ImportError every time. This broke legacy field sync
so assets.reference_images was never updated after AI generation."
```

---

### Task 2: EntityFileDAO 新增批量查询方法

**Files:**
- Modify: `dao_entity_file.py`
- Modify: `deploy/dao_entity_file.py`

- [ ] **Step 1: 在 `EntityFileDAO` 类末尾添加 `get_files_for_entities` 方法**

在 `dao_entity_file.py` 的 `EntityFileDAO` 类末尾（第 154 行 `return dict(row) if row else None` 之后）添加：

```python
    @staticmethod
    async def get_files_for_entities(
        entity_type: str,
        entity_ids: list,
        file_role: str = None,
    ) -> dict:
        """批量获取多个实体的文件，返回 {entity_id: [file_record, ...]}"""
        if not entity_ids:
            return {}
        db = get_db_manager()
        if not db:
            return {}

        conditions = [
            "entity_type = $1",
            "entity_id = ANY($2)",
            "is_deleted = FALSE",
        ]
        params: list = [entity_type, entity_ids]
        if file_role:
            conditions.append(f"file_role = ${len(params) + 1}")
            params.append(file_role)

        rows = await db.fetch(
            f"SELECT * FROM files WHERE {' AND '.join(conditions)} ORDER BY created_at",
            *params,
        )
        result: dict = {}
        for row in rows:
            eid = row["entity_id"]
            if eid not in result:
                result[eid] = []
            result[eid].append(dict(row))
        return result
```

- [ ] **Step 2: 同步 deploy 版本**

对 `deploy/dao_entity_file.py` 做完全相同的修改。

- [ ] **Step 3: Commit**

```bash
git add dao_entity_file.py deploy/dao_entity_file.py
git commit -m "feat: add EntityFileDAO.get_files_for_entities batch query

Single SQL query to fetch entity files for multiple assets at once,
grouped by entity_id. Used by the assets API to embed entity files."
```

---

### Task 3: Assets API 路由内嵌 entity files

**Files:**
- Modify: `api_routes.py:1524-1532`
- Modify: `deploy/api_routes.py` (同位置)

- [ ] **Step 1: 修改 `get_assets` 路由处理函数**

找到 `api_routes.py` 中的 `GET /api/projects/{project_id}/assets` 路由（约第 1524 行），将：

```python
@router.get("/api/projects/{project_id}/assets")
async def get_assets(
    project_id: str,
    episode_id: Optional[str] = None,
    asset_type: Optional[str] = None,
    user_id: str = Depends(get_current_user)
):
    assets = await AssetDAO.get_by_project(project_id, episode_id, asset_type)
    return {"success": True, "assets": [dict(a) for a in assets]}
```

替换为：

```python
@router.get("/api/projects/{project_id}/assets")
async def get_assets(
    project_id: str,
    episode_id: Optional[str] = None,
    asset_type: Optional[str] = None,
    user_id: str = Depends(get_current_user)
):
    assets = await AssetDAO.get_by_project(project_id, episode_id, asset_type)
    assets_list = [dict(a) for a in assets]

    asset_ids = [a["asset_id"] for a in assets_list]
    if asset_ids:
        from dao_entity_file import EntityFileDAO
        files_map = await EntityFileDAO.get_files_for_entities("asset", asset_ids)
        for asset in assets_list:
            asset["entity_files"] = files_map.get(asset["asset_id"], [])
    else:
        for asset in assets_list:
            asset["entity_files"] = []

    return {"success": True, "assets": assets_list}
```

- [ ] **Step 2: 同步 deploy 版本**

对 `deploy/api_routes.py` 的同一路由做完全相同的修改。

- [ ] **Step 3: 验证**

启动服务后用浏览器或 curl 访问 assets API，确认每个 asset 对象中包含 `entity_files` 数组。

- [ ] **Step 4: Commit**

```bash
git add api_routes.py deploy/api_routes.py
git commit -m "feat: embed entity files in assets API response

GET /api/projects/{pid}/assets now includes entity_files[] on each
asset, fetched via a single batch query. This eliminates the need for
per-asset useEntityFilesQuery calls on the frontend."
```

---

### Task 4: 前端类型与 Context 层改造

**Files:**
- Modify: `new_html/types.ts:340-353`
- Modify: `new_html/contexts/EpisodeContext.tsx:52-66`

- [ ] **Step 1: 扩展 `AssetItem` 类型**

在 `new_html/types.ts` 第 340-353 行的 `AssetItem` 接口中，在 `createdAt` 之后添加 `entityFiles` 字段：

```typescript
export interface AssetItem {
  assetId: string;
  projectId: string;
  episodeId: string | null;
  assetType: 'character' | 'scene' | 'prop';
  name: string;
  description: string;
  thumbnailUrl: string | null;
  referenceImages: string[];
  styleParams: Record<string, any>;
  tags: string[];
  createdBy: string;
  createdAt: string;
  entityFiles?: Array<{
    fileId: string;
    fileUrl: string;
    fileType: string;
    fileRole: string;
    isSelected: boolean;
    createdAt: string;
  }>;
}
```

- [ ] **Step 2: 修改 `normalizeAsset` 函数**

在 `new_html/contexts/EpisodeContext.tsx` 第 52-66 行的 `normalizeAsset` 函数中，在 `tags` 行之后、`createdBy` 行之前，添加 `entityFiles` 映射：

```typescript
function normalizeAsset(r: any): AssetItem {
  return {
    assetId: String(r.asset_id ?? r.assetId ?? ''),
    projectId: String(r.project_id ?? r.projectId ?? ''),
    episodeId: r.episode_id ?? r.episodeId ?? null,
    assetType: (r.asset_type ?? r.assetType ?? 'character') as AssetItem['assetType'],
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    thumbnailUrl: r.thumbnail_url ?? r.thumbnailUrl ?? null,
    referenceImages: safeArr(r.reference_images ?? r.referenceImages),
    styleParams: safeObj(r.style_params ?? r.styleParams),
    tags: safeArr(r.tags),
    entityFiles: Array.isArray(r.entity_files)
      ? r.entity_files.map((f: any) => ({
          fileId: String(f.file_id ?? f.fileId ?? ''),
          fileUrl: String(f.file_url ?? f.fileUrl ?? ''),
          fileType: String(f.file_type ?? f.fileType ?? ''),
          fileRole: String(f.file_role ?? f.fileRole ?? ''),
          isSelected: !!(f.is_selected ?? f.isSelected),
          createdAt: String(f.created_at ?? f.createdAt ?? ''),
        }))
      : [],
    createdBy: String(r.created_by ?? r.createdBy ?? ''),
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add new_html/types.ts new_html/contexts/EpisodeContext.tsx
git commit -m "feat: add entityFiles to AssetItem type and normalizeAsset

AssetItem now carries entity files from the backend API response.
All pages consuming assets via EpisodeContext automatically get
entity file data without additional queries."
```

---

### Task 5: episodeAdapters 数据转换层改造

**Files:**
- Modify: `new_html/utils/episodeAdapters.ts:100-131` (dbItemToStoryboardItem 中的 materialSelections)
- Modify: `new_html/utils/episodeAdapters.ts:216-240` (assetsToMaterialLibrary)

- [ ] **Step 1: 添加 `assetHasImages` 辅助函数**

在 `new_html/utils/episodeAdapters.ts` 的 `parseBoundAssetTags` 函数之后（第 47 行后），添加辅助函数：

```typescript
function assetHasImages(asset: AssetItem): boolean {
  const ef = (asset.entityFiles || []).filter(f => f.fileRole === 'reference_image');
  if (ef.length > 0) return true;
  const refs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
  return refs.length > 0 || !!asset.thumbnailUrl;
}
```

- [ ] **Step 2: 修改 `dbItemToStoryboardItem` 中的 materialSelections 逻辑**

在 `dbItemToStoryboardItem` 函数中（约第 100-131 行），将角色和场景的默认 materialSelections 逻辑改为优先使用 entity files。

找到第 108-116 行的角色 materialSelections：

```typescript
      const asset = assets.find(a => a.assetType === 'character' && a.name === charName);
      if (asset) {
        const imgs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
        if (imgs.length > 0) {
          materialSelections[charName] = `${asset.assetId}_0`;
        } else if (asset.thumbnailUrl) {
          materialSelections[charName] = asset.assetId;
        }
      }
```

替换为：

```typescript
      const asset = assets.find(a => a.assetType === 'character' && a.name === charName);
      if (asset && assetHasImages(asset)) {
        materialSelections[charName] = `${asset.assetId}_0`;
      }
```

找到第 124-131 行的场景 materialSelections 中类似的逻辑：

```typescript
        const sceneAsset = assets.find(a => a.assetType === 'scene' && a.name === scene);
        if (sceneAsset) {
          const sImgs = Array.isArray(sceneAsset.referenceImages) ? sceneAsset.referenceImages.filter(Boolean) : [];
          if (sImgs.length > 0) {
            materialSelections[scene] = `${sceneAsset.assetId}_0`;
          } else if (sceneAsset.thumbnailUrl) {
            materialSelections[scene] = sceneAsset.assetId;
          }
        }
```

替换为：

```typescript
        const sceneAsset = assets.find(a => a.assetType === 'scene' && a.name === scene);
        if (sceneAsset && assetHasImages(sceneAsset)) {
          materialSelections[scene] = `${sceneAsset.assetId}_0`;
        }
```

- [ ] **Step 3: 重写 `assetsToMaterialLibrary` 函数**

将第 216-240 行的 `assetsToMaterialLibrary` 整体替换为：

```typescript
export function assetsToMaterialLibrary(assets: AssetItem[]): Record<string, Array<{ id: string; url: string; thumbnail?: string; name: string; source: string }>> {
  const lib: Record<string, Array<{ id: string; url: string; thumbnail?: string; name: string; source: string }>> = {};
  for (const asset of assets) {
    const key = asset.name;
    if (!lib[key]) lib[key] = [];

    const efImages = (asset.entityFiles || [])
      .filter(f => f.fileRole === 'reference_image')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (efImages.length > 0) {
      efImages.forEach((f, i) => {
        lib[key].push({
          id: `${asset.assetId}_${i}`,
          url: f.fileUrl,
          thumbnail: i === 0 ? (asset.thumbnailUrl || f.fileUrl) : f.fileUrl,
          name: asset.name,
          source: 'entity_file',
        });
      });
    } else {
      const refs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
      const allUrls = [...refs];
      if (asset.thumbnailUrl && !allUrls.includes(asset.thumbnailUrl)) {
        allUrls.unshift(asset.thumbnailUrl);
      }
      if (allUrls.length > 0) {
        allUrls.forEach((url, i) => {
          lib[key].push({
            id: `${asset.assetId}_${i}`,
            url,
            thumbnail: i === 0 ? (asset.thumbnailUrl || url) : url,
            name: asset.name,
            source: 'asset',
          });
        });
      }
    }
  }
  return lib;
}
```

- [ ] **Step 4: Commit**

```bash
git add new_html/utils/episodeAdapters.ts
git commit -m "feat: assetsToMaterialLibrary uses entity files as primary source

Both assetsToMaterialLibrary and dbItemToStoryboardItem now check
asset.entityFiles first, falling back to legacy referenceImages for
old data without entity files."
```

---

### Task 6: DesignPage 重构 — 移除独立 entity file 查询

**Files:**
- Modify: `new_html/pages/DesignPage.tsx`

这是改动最大的文件，分多个 step。

- [ ] **Step 1: 修改 `AssetImageRow` 组件 — 移除 `useEntityFilesQuery`**

将第 117-164 行的 `AssetImageRow` 组件整体替换为（直接从 props 接收 entity files 而非独立查询）：

```typescript
const AssetImageRow: React.FC<{
  assetId: string;
  entityFiles: Array<{ fileId: string; fileUrl: string; fileRole: string; createdAt: string }>;
  legacyImages: string[];
  onLightbox: (url: string) => void;
  onDeleteImage: (assetId: string, imageUrl: string, fileId?: string) => void;
  busy: boolean;
}> = ({ assetId, entityFiles, legacyImages, onLightbox, onDeleteImage, busy }) => {
  const efRefs = useMemo(() =>
    entityFiles
      .filter(f => f.fileRole === 'reference_image')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [entityFiles],
  );

  const images: { key: string; displayUrl: string; rawUrl: string; fileId?: string }[] = useMemo(() => {
    if (efRefs.length > 0) {
      return efRefs.map(f => ({
        key: f.fileId,
        displayUrl: secureMediaUrl(f.fileUrl) || '',
        rawUrl: f.fileUrl,
        fileId: f.fileId,
      })).filter(i => i.displayUrl);
    }
    return legacyImages.map((url, i) => ({
      key: `${assetId}_legacy_${i}`,
      displayUrl: secureMediaUrl(url) || '',
      rawUrl: url,
    })).filter(i => i.displayUrl);
  }, [efRefs, legacyImages, assetId]);

  if (images.length === 0) return null;
  return (
    <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
      {images.map(img => (
        <div key={img.key} className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-gray-700 hover:border-indigo-500 transition-colors group relative">
          <button type="button" onClick={() => onLightbox(img.displayUrl)} className="w-full h-full">
            <img src={img.displayUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none"><ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" /></div>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeleteImage(assetId, img.rawUrl, img.fileId); }}
            disabled={busy}
            className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: 修改 `AssetImageRow` 的调用处**

找到约第 454 行的 `<AssetImageRow` 调用，将：

```tsx
                      <AssetImageRow
                        assetId={asset.assetId}
                        legacyImages={legacyImgs}
                        onLightbox={setLightboxUrl}
```

替换为：

```tsx
                      <AssetImageRow
                        assetId={asset.assetId}
                        entityFiles={asset.entityFiles || []}
                        legacyImages={legacyImgs}
                        onLightbox={setLightboxUrl}
```

- [ ] **Step 3: 修改 `assetToMaterials` 函数使用 entity files**

将第 96-101 行的 `assetToMaterials` 函数替换为：

```typescript
function assetToMaterials(asset: AssetItem): ModalMaterial[] {
  const mats: ModalMaterial[] = [];
  const efRefs = (asset.entityFiles || [])
    .filter(f => f.fileRole === 'reference_image')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (efRefs.length > 0) {
    efRefs.forEach((f, i) => { mats.push({ id: `${asset.assetId}_${i}`, url: f.fileUrl, name: asset.name }); });
  } else {
    const allImages = [...(asset.referenceImages || [])];
    if (asset.thumbnailUrl && !allImages.includes(asset.thumbnailUrl)) allImages.unshift(asset.thumbnailUrl);
    allImages.forEach((url, i) => { if (url) mats.push({ id: `${asset.assetId}_${i}`, url, name: asset.name }); });
  }
  return mats;
}
```

- [ ] **Step 4: 修改"已设计"计数逻辑**

找到第 193-194 行：

```typescript
  const totalDesignedCount = assets.filter(a => a.thumbnailUrl || (a.referenceImages?.length > 0)).length;
  const tabDesignedCount = filtered.filter(a => a.thumbnailUrl || (a.referenceImages?.length > 0)).length;
```

替换为：

```typescript
  const hasDesign = (a: AssetItem) => (a.entityFiles || []).some(f => f.fileRole === 'reference_image') || a.thumbnailUrl || (a.referenceImages?.length > 0);
  const totalDesignedCount = assets.filter(hasDesign).length;
  const tabDesignedCount = filtered.filter(hasDesign).length;
```

同时修改第 199 行 `selectUndesigned`：

```typescript
  // 修改前:
  const selectUndesigned = () => setSelectedIds(new Set(filtered.filter(a => !a.thumbnailUrl && !(a.referenceImages?.length > 0)).map(a => a.assetId)));
  // 修改后:
  const selectUndesigned = () => setSelectedIds(new Set(filtered.filter(a => !hasDesign(a)).map(a => a.assetId)));
```

- [ ] **Step 5: 修改 `handleAIGeneration` — 添加 `reload()`，移除 `invalidateQueries`**

将第 270 行的：

```typescript
      queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', payload.assetId] });
```

替换为：

```typescript
      await reload();
```

- [ ] **Step 6: 修改 `handleCameraGenerate` — 移除 `invalidateQueries`**

将第 291 行的：

```typescript
      queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', payload.assetId] });
      await reload();
```

替换为：

```typescript
      await reload();
```

- [ ] **Step 7: 修改 `handleProcessSubmit` — 移除 `invalidateQueries`**

将第 307 行的：

```typescript
      queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', processModal.asset.assetId] });
      await reload();
```

替换为：

```typescript
      await reload();
```

- [ ] **Step 8: 修改 `handleBatchGenerate` — 移除 `invalidateQueries`，添加 `reload()`**

将第 344 行的：

```typescript
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', asset.assetId] });
```

删除。

然后在第 347 行 `setBusyAssetId(null);` 之前添加 `await reload();`。

同时将 `useCallback` 的依赖数组（第 348 行）更新，添加 `reload`：

```typescript
  }, [assets, scriptText, episodeId, queryClient, reload]);
```

- [ ] **Step 9: 简化 `handleUploadImage`**

将第 224-237 行的 `handleUploadImage` 替换为：

```typescript
  const handleUploadImage = useCallback(async (assetId: string, file: File) => {
    setUploadingId(assetId);
    try {
      const { uploadEntityFile } = await import('../services/entityFileService');
      await uploadEntityFile(file, 'asset', assetId, 'reference_image', episodeId);
      await reload();
    } catch (err) { console.error('上传失败:', err); }
    finally { setUploadingId(null); }
  }, [episodeId, reload]);
```

- [ ] **Step 10: 修改 `handleDeleteImage` — 确保 entity file 删除后 reload**

将第 239-252 行的 `handleDeleteImage` 替换为：

```typescript
  const handleDeleteImage = useCallback(async (assetId: string, imageUrl: string, fileId?: string) => {
    if (fileId) {
      const { deleteEntityFile } = await import('../services/entityFileService');
      try {
        await deleteEntityFile(fileId);
        await reload();
      } catch (err) { console.error('删除图片失败:', err); }
      return;
    }
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

- [ ] **Step 11: 清理 imports**

在文件顶部的 import 中：
- 移除 `useEntityFilesQuery` 和 `EntityFile` 的 import（第 11 行 `import { useEntityFilesQuery, EntityFile } from '../hooks/useEntityFilesQuery';`）
- 移除 `useDeleteFileMutation` 的 import（第 12 行 `import { useDeleteFileMutation } from '../hooks/useFilesMutation';`）
- 在组件内移除 `const deleteFileMutation = useDeleteFileMutation();`（第 170 行）

如果 `useQueryClient` / `queryClient` 仅用于 `invalidateQueries`（现已移除），也可移除。但 `queryClient` 可能在其他地方使用，需确认后决定。

- [ ] **Step 12: Commit**

```bash
git add new_html/pages/DesignPage.tsx
git commit -m "refactor: DesignPage uses context entity files instead of per-asset queries

- AssetImageRow receives entityFiles via props instead of useEntityFilesQuery
- All handlers use reload() instead of queryClient.invalidateQueries
- handleUploadImage simplified (no manual legacy field sync)
- handleDeleteImage uses entity file API + reload
- Removed useEntityFilesQuery and useDeleteFileMutation imports"
```

---

### Task 7: MaterialPage 清理

**Files:**
- Modify: `new_html/components/MaterialPage.tsx`

- [ ] **Step 1: 移除 3 处 `invalidateQueries` 调用**

在 `MaterialPage.tsx` 中找到以下 3 处代码块并移除：

第一处（约 452-454 行）— 删除这 3 行：

```typescript
        if (targetAssetId) {
            queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', targetAssetId] });
        }
```

第二处（约 620-622 行）— 删除这 3 行：

```typescript
        if (targetAssetId) {
            queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', targetAssetId] });
        }
```

第三处（约 671-673 行）— 删除这 3 行：

```typescript
        if (targetAssetId) {
            queryClient.invalidateQueries({ queryKey: ['entityFiles', 'asset', targetAssetId] });
        }
```

- [ ] **Step 2: 清理 `queryClient` 引用**

如果移除上述代码后 `queryClient` 不再被使用，移除相关 import 和声明：
- 顶部 `import { useQueryClient } from '@tanstack/react-query';`
- 组件内 `const queryClient = useQueryClient();`

需搜索文件确认是否有其他使用处。

- [ ] **Step 3: Commit**

```bash
git add new_html/components/MaterialPage.tsx
git commit -m "cleanup: remove entityFiles invalidateQueries from MaterialPage

MaterialPage no longer needs to invalidate entity file queries since
all data now flows through EpisodeContext assets with embedded entity
files. Refresh happens via reload() in upstream handlers."
```

---

### Task 8: Audio 组件 `getAssetThumb` 升级

**Files:**
- Modify: `new_html/components/audio/VoiceSidebar.tsx:18-28`
- Modify: `new_html/components/audio/DubbingCard.tsx:29-38`

- [ ] **Step 1: 修改 `VoiceSidebar.tsx` 的 `getAssetThumb`**

将第 18-28 行替换为：

```typescript
function getAssetThumb(asset: AssetItem | undefined): string {
  if (!asset) return '';
  const ef = (asset.entityFiles || []).find(f => f.fileRole === 'reference_image');
  if (ef) return resolveUrl(ef.fileUrl);
  const t = (asset as any).thumbnailUrl || (asset as any).thumbnail_url || '';
  if (t) return resolveUrl(t);
  const refs = (asset as any).referenceImages || (asset as any).reference_images || [];
  if (Array.isArray(refs) && refs.length > 0) {
    const first = typeof refs[0] === 'string' ? refs[0] : refs[0]?.url || '';
    return resolveUrl(first);
  }
  return '';
}
```

- [ ] **Step 2: 修改 `DubbingCard.tsx` 的 `getAssetThumb`**

将第 29-38 行替换为完全相同的实现：

```typescript
export function getAssetThumb(asset: AssetItem | undefined): string {
  if (!asset) return '';
  const ef = (asset.entityFiles || []).find(f => f.fileRole === 'reference_image');
  if (ef) return resolveUrl(ef.fileUrl);
  const t = (asset as any).thumbnailUrl || (asset as any).thumbnail_url || '';
  if (t) return resolveUrl(t);
  const refs = (asset as any).referenceImages || (asset as any).reference_images || [];
  if (Array.isArray(refs) && refs.length > 0) {
    const first = typeof refs[0] === 'string' ? refs[0] : refs[0]?.url || '';
    return resolveUrl(first);
  }
  return '';
}
```

- [ ] **Step 3: Commit**

```bash
git add new_html/components/audio/VoiceSidebar.tsx new_html/components/audio/DubbingCard.tsx
git commit -m "feat: getAssetThumb checks entity files first

Audio components now show the correct thumbnail when images come
from entity files instead of legacy referenceImages."
```

---

### Task 9: Deploy 目录同步

**Files:**
- Modify: `deploy/new_html/pages/DesignPage.tsx`
- Modify: `deploy/new_html/components/MaterialPage.tsx` (如果存在)
- Modify: `deploy/new_html/utils/episodeAdapters.ts` (如果存在)
- Modify: `deploy/new_html/types.ts` (如果存在)
- Modify: `deploy/new_html/contexts/EpisodeContext.tsx` (如果存在)

- [ ] **Step 1: 复制修改后的前端文件到 deploy**

对 Task 1-3 的后端文件已在各 Task 中同步。此 Task 同步前端文件：

```bash
# 逐个对比并同步（deploy 可能不包含所有前端文件，只同步存在的）
# 检查 deploy/new_html 下存在哪些文件：
ls deploy/new_html/pages/DesignPage.tsx
ls deploy/new_html/components/MaterialPage.tsx
ls deploy/new_html/utils/episodeAdapters.ts
ls deploy/new_html/types.ts
ls deploy/new_html/contexts/EpisodeContext.tsx
ls deploy/new_html/components/audio/VoiceSidebar.tsx
ls deploy/new_html/components/audio/DubbingCard.tsx
```

对存在的文件，应用与根目录相同的修改。

- [ ] **Step 2: Commit**

```bash
git add deploy/
git commit -m "sync: mirror all unified data source changes to deploy/"
```

---

### Task 10: 文档更新

**Files:**
- Modify: `docs/data-layer-reference.md`
- Modify: `docs/database.md`
- Modify: `docs/faq.md`

- [ ] **Step 1: 更新 `docs/data-layer-reference.md` 顶部状态**

将第 6-13 行的状态块替换为：

```markdown
> **状态**：Phase 1-3 已实施完成（2026-04-02），所有 API 端点已添加 entity 字段，
> 前端已迁移到 React Query + SSE 自动失效机制。
>
> **Entity-File 统一迁移**（2026-04-03）：所有生成路径已统一传递
> `entityType/entityId/fileRole/episodeId` 到后端。
>
> **数据源统一**（2026-04-04）：Assets API 响应内嵌 entity files，所有页面通过
> `EpisodeContext.assets`（含 `entityFiles[]`）统一消费图片数据。DesignPage 不再
> 使用独立的 `useEntityFilesQuery`。`assetsToMaterialLibrary` 优先从 entity files
> 构建素材库，legacy `referenceImages` 作为降级。
```

- [ ] **Step 2: 更新 `docs/data-layer-reference.md` 的 assets 表部分**

在 assets 表部分（约第 69-86 行），在 `tags` 行之后添加：

```markdown
| entity_files | (API 内嵌) | 非数据库列。`GET /api/.../assets` 通过 JOIN files 表动态填充。含 `file_id`, `file_url`, `file_type`, `file_role`, `is_selected`, `created_at` |
```

- [ ] **Step 3: 在 `docs/data-layer-reference.md` 中添加数据流说明**

在 assets 表部分之后，添加新章节：

```markdown
### 资产图片数据流（2026-04-04 统一后）

```
写入链路（AI 生图 / 上传）:
  cluster_main.py (Gemini/Doubao)
    → file_service.save_generated_file_to_db()
    → files 表写入 (entity_type=asset, file_role=reference_image)
    → _sync_legacy_on_file_create() → assets.reference_images 追加 URL
  前端 → await reload() → EpisodeContext 刷新 assets（含 entity_files）

读取链路（所有页面统一）:
  GET /api/projects/{pid}/assets
    → AssetDAO.get_by_project() + EntityFileDAO.get_files_for_entities()
    → 返回 assets[] 每个含 entity_files[]
  EpisodeContext.loadSlices('assets')
    → normalizeAsset() → AssetItem { entityFiles: [...] }
    → assetsToMaterialLibrary(assets)
        → 优先 entityFiles.filter(role=reference_image)
        → 降级 referenceImages[]
    → MaterialPage / GenerationPage / DesignPage / AudioStage 统一消费
```
```

- [ ] **Step 4: 更新 `docs/database.md` 的 assets 表部分**

找到 `docs/database.md` 中 assets 相关的表格，在表格下方添加说明：

```markdown
**API 内嵌字段**：`GET /api/projects/{pid}/assets` 返回的每个 asset 对象包含
`entity_files` 数组（非数据库列），通过 `EntityFileDAO.get_files_for_entities()`
从 `files` 表 JOIN 而来。结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| file_id | VARCHAR | 文件唯一 ID |
| file_url | VARCHAR | HTTP 访问路径 `/storage/...` |
| file_type | VARCHAR | image / audio / video |
| file_role | VARCHAR | reference_image / asset_thumbnail / ... |
| is_selected | BOOLEAN | 是否选中 |
| created_at | TIMESTAMP | 创建时间 |

前端通过 `AssetItem.entityFiles` 消费此数据，`assetsToMaterialLibrary()` 优先
使用 entity files 构建素材库，`assets.reference_images` 列作为老数据降级。
```

- [ ] **Step 5: 更新 `docs/faq.md` — 添加本次问题的 FAQ 条目**

在 `docs/faq.md` 末尾追加：

```markdown
### Q: 设计页面 AI 生图后，素材页面看不到新图片

**Symptom**: 在设计页面用 AI 生成了图片，点击"导出到素材绑定"后，素材页面的角色/场景素材仍显示旧数据。

**Root Cause**: 双数据源问题。设计页面从 `files` 表（entity files）展示图片，素材页面从 `assets.reference_images`（legacy JSON 字段）展示图片。两者的同步函数 `_sync_legacy_on_file_create`（`file_service.py`）存在 import 路径错误（`from database_config import get_db_manager`，`database_config` 模块无此函数），导致同步每次静默失败。

**Fix**: 
1. 修复 import 路径：`from db_manager import get_db_manager`
2. 统一数据源：Assets API 内嵌 entity files，所有页面通过 `EpisodeContext.assets`（含 `entityFiles[]`）统一消费

**Files**: `file_service.py`, `api_routes.py`, `dao_entity_file.py`, `new_html/utils/episodeAdapters.ts`, `new_html/pages/DesignPage.tsx`, `new_html/contexts/EpisodeContext.tsx`, `new_html/types.ts`

**Date**: 2026-04-04
```

- [ ] **Step 6: Commit**

```bash
git add docs/data-layer-reference.md docs/database.md docs/faq.md
git commit -m "docs: update data layer docs for unified asset data source

- data-layer-reference.md: updated status, added entity_files to assets
  table, added unified data flow diagram
- database.md: documented API-embedded entity_files structure
- faq.md: added root cause analysis for design→material sync bug"
```
