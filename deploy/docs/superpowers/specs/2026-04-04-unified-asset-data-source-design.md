# 统一资产图片数据源设计

**日期**: 2026-04-04
**状态**: 已批准
**范围**: 后端 assets API + 前端全页面数据消费层

## 问题

资产（角色/场景）图片存在两套数据源，导致设计页面生图后素材页面看不到新图：

1. **Entity files（新）**：`files` 表，通过 `entity_type=asset` + `entity_id` 关联。DesignPage 用 `useEntityFilesQuery` 逐个 asset 查询。
2. **Legacy 字段（旧）**：`assets.reference_images`（JSON 数组）+ `assets.thumbnail_url`。其余所有页面通过 `assetsToMaterialLibrary(assets)` 消费。

两者之间的同步函数 `_sync_legacy_on_file_create`（`file_service.py`）存在 import 错误（`from database_config import get_db_manager`，正确应为 `from db_manager import ...`），导致每次调用静默失败。结果：entity files 有新图，legacy 字段永远不更新。

## 方案

在 Assets API 响应中内嵌 entity files，让 `EpisodeContext.assets` 成为全局唯一数据源。

```
后端: GET /api/projects/{pid}/assets
  ↓ SQL: SELECT assets LEFT JOIN files
  ↓ 返回: assets[] 每个含 entity_files[]
  
前端: EpisodeContext.loadSlices('assets')
  ↓ normalizeAsset → AssetItem { entityFiles: EntityFile[] }
  ↓ 所有页面通过 assets 统一消费
```

## 后端改造

### 1. EntityFileDAO 新增批量查询

文件：`dao_entity_file.py`

```python
@staticmethod
async def get_files_for_entities(
    entity_type: str,
    entity_ids: list[str],
    file_role: str = None
) -> dict[str, list]:
    """
    批量获取多个实体的文件。
    返回 {entity_id: [file_record, ...]}
    """
    if not entity_ids:
        return {}
    db = get_db_manager()
    conditions = [
        "entity_type = $1",
        "entity_id = ANY($2)",
        "is_deleted = FALSE",
    ]
    params = [entity_type, entity_ids]
    if file_role:
        conditions.append(f"file_role = ${len(params) + 1}")
        params.append(file_role)
    
    rows = await db.fetch(
        f"SELECT * FROM files WHERE {' AND '.join(conditions)} ORDER BY created_at",
        *params,
    )
    result = {}
    for row in rows:
        eid = row['entity_id']
        if eid not in result:
            result[eid] = []
        result[eid].append(dict(row))
    return result
```

### 2. Assets API 路由合并 entity files

文件：`api_routes.py`，`GET /api/projects/{project_id}/assets` 路由

在返回 assets 之前，批量查询 entity files 并合并：

```python
assets = result_assets  # 原有查询结果
asset_ids = [a['asset_id'] for a in assets]
if asset_ids:
    files_map = await EntityFileDAO.get_files_for_entities('asset', asset_ids)
    for asset in assets:
        asset['entity_files'] = files_map.get(asset['asset_id'], [])
```

### 3. 修复 _sync_legacy_on_file_create import

文件：`file_service.py` 第 239 行

```python
# 修复前
from database_config import get_db_manager
# 修复后
from db_manager import get_db_manager
```

## 前端改造

### 1. 类型扩展

文件：`new_html/types.ts`

`AssetItem` 新增字段：

```typescript
entityFiles?: EntityFile[];
```

### 2. normalizeAsset 映射

文件：`new_html/contexts/EpisodeContext.tsx`

在 `normalizeAsset` 中增加 `entityFiles` 字段映射：

```typescript
entityFiles: Array.isArray(r.entity_files)
  ? r.entity_files.map((f: any) => ({
      fileId: f.file_id ?? f.fileId ?? '',
      fileUrl: f.file_url ?? f.fileUrl ?? '',
      fileType: f.file_type ?? f.fileType ?? '',
      fileRole: f.file_role ?? f.fileRole ?? '',
      isSelected: f.is_selected ?? f.isSelected ?? false,
      createdAt: f.created_at ?? f.createdAt ?? '',
      metadata: f.metadata ?? {},
    }))
  : [],
```

### 3. assetsToMaterialLibrary 改造

文件：`new_html/utils/episodeAdapters.ts`

优先从 `asset.entityFiles` 构建素材库，无 entity files 时降级到 `referenceImages`：

```typescript
export function assetsToMaterialLibrary(assets: AssetItem[]): MaterialLibrary {
  const lib: MaterialLibrary = {};
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
      const refs = Array.isArray(asset.referenceImages)
        ? asset.referenceImages.filter(Boolean) : [];
      const allUrls = [...refs];
      if (asset.thumbnailUrl && !allUrls.includes(asset.thumbnailUrl)) {
        allUrls.unshift(asset.thumbnailUrl);
      }
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
  return lib;
}
```

### 4. dbItemToStoryboardItem 改造

文件：`new_html/utils/episodeAdapters.ts`

计算默认 `materialSelections` 时，优先检查 `asset.entityFiles`：

```typescript
// 在 "为角色/场景生成默认 materialSelections" 的逻辑中：
const efRefs = (asset.entityFiles || []).filter(f => f.fileRole === 'reference_image');
if (efRefs.length > 0) {
  materialSelections[charName] = `${asset.assetId}_0`;
} else {
  const imgs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
  if (imgs.length > 0) {
    materialSelections[charName] = `${asset.assetId}_0`;
  } else if (asset.thumbnailUrl) {
    materialSelections[charName] = asset.assetId;
  }
}
```

### 5. DesignPage 改造

文件：`new_html/pages/DesignPage.tsx`

- 移除 `AssetImageRow` 中的 `useEntityFilesQuery` 调用
- 改用 `asset.entityFiles`（从 EpisodeContext 传入）构建图片列表
- 所有写操作（`handleAIGeneration`、`handleCameraGenerate`、`handleProcessSubmit`、`handleBatchGenerate`）成功后统一调用 `await reload()`
- 移除所有 `queryClient.invalidateQueries({ queryKey: ['entityFiles', ...] })` 调用

### 6. MaterialPage 清理

文件：`new_html/components/MaterialPage.tsx`

- 移除 `queryClient.invalidateQueries({ queryKey: ['entityFiles', ...] })` 调用
- 写操作成功后依赖上层 `onUpdateLibrary` → `reload()` 链路刷新数据

### 7. getAssetThumb 升级

文件：`new_html/components/audio/VoiceSidebar.tsx`、`DubbingCard.tsx`

```typescript
function getAssetThumb(asset: AssetItem): string {
  const ef = (asset.entityFiles || []).find(f => f.fileRole === 'reference_image');
  if (ef) return ef.fileUrl;
  return asset.thumbnailUrl || asset.thumbnail_url
    || (asset.referenceImages?.[0]) || (asset.reference_images?.[0]) || '';
}
```

## 兼容性

- `assets.reference_images` 和 `thumbnail_url` 字段保留不删
- `_sync_legacy_on_file_create` 修复后继续运行，保持 legacy 字段同步
- `bound_assets` 中 `sel:` 绑定的 ID 格式 `${assetId}_${index}` 不变，无需数据迁移
- Entity files 按 `created_at` 排序取索引，与 legacy 追加顺序自然对齐
- 无 entity files 的老 asset 通过 fallback 分支正常工作

## 可移除的代码

| 文件 | 移除内容 |
|------|---------|
| `DesignPage.tsx` | `useEntityFilesQuery` 调用、`AssetImageRow` 独立查询逻辑 |
| `DesignPage.tsx` | 所有 `queryClient.invalidateQueries(['entityFiles', ...])` |
| `MaterialPage.tsx` | `queryClient.invalidateQueries(['entityFiles', ...])` |

## 保留不动的文件

| 文件 | 原因 |
|------|------|
| `useEntityFilesQuery.ts` | 其他 entity type（`storyboard_item`）仍在用 |
| `entityFileService.ts` | 上传/删除/选中操作仍需要 |
| `useFilesMutation.ts` | mutation hooks 仍需要 |

## 改动文件清单

| 文件 | 改动类型 |
|------|---------|
| `dao_entity_file.py` | 新增 `get_files_for_entities` |
| `api_routes.py` | assets 路由合并 entity files |
| `file_service.py` | 修复 import |
| `new_html/types.ts` | AssetItem 增加 entityFiles |
| `new_html/contexts/EpisodeContext.tsx` | normalizeAsset 增加映射 |
| `new_html/utils/episodeAdapters.ts` | assetsToMaterialLibrary + dbItemToStoryboardItem 改用 entity files |
| `new_html/pages/DesignPage.tsx` | 移除独立查询，统一用 context + reload |
| `new_html/components/MaterialPage.tsx` | 移除 entityFiles invalidate |
| `new_html/components/audio/VoiceSidebar.tsx` | getAssetThumb 升级 |
| `new_html/components/audio/DubbingCard.tsx` | getAssetThumb 升级 |
| `deploy/` 目录下对应文件 | 同步所有改动 |
