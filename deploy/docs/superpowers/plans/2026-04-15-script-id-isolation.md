# Script-ID 数据隔离 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让分集内每个文件（script_id）拥有独立的分镜、资产、视频、音频数据，所有工作流页面跟随文件切换联动。

**Architecture:** 给 `storyboard_items` 和 `assets` 表加 `script_id` 外键列。`video_segments`、`audio_tracks`、`files` 通过引用 `storyboard_item_id` 隐式归属。前端通过 `EpisodeContext.selectedScriptId` 共享当前选中文件，所有页面的数据加载和写入均携带 `script_id`。

**Tech Stack:** PostgreSQL, Python FastAPI, React 18, TypeScript, react-router-dom, Vite

---

## 文件变更清单

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `db_migration_script_id.sql` | DB 迁移：加列、回填、索引 |
| Modify | `dao_storyboard.py` | 分镜 DAO 所有方法支持 script_id |
| Modify | `dao_asset.py` | 资产 DAO 所有方法支持 script_id |
| Modify | `api_routes.py` | API 端点加 script_id 参数 + 共享 API |
| Modify | `new_html/services/apiService.ts` | 前端 API 调用加 script_id |
| Modify | `new_html/contexts/EpisodeContext.tsx` | 新增 selectedScriptId + 过滤 |
| Modify | `new_html/WorkspaceApp.tsx` | 同步 selectedFileId 到 context |
| Modify | `new_html/pages/ScriptPage.tsx` | 桥接 WorkspaceApp 和 EpisodeContext |
| Modify | `new_html/pages/DesignPage.tsx` | 创建资产时传 script_id |
| Modify | `new_html/pages/MaterialsPage.tsx` | selectedFileId 改用 selectedScriptId |
| Modify | `new_html/pages/AudioStagePage.tsx` | 数据已从 context 过滤 |
| Modify | `new_html/pages/StoryboardGenPage.tsx` | selectedFileId 改用 selectedScriptId |
| Modify | `new_html/pages/GenerationPage.tsx` | 数据已从 context 过滤 |

---

### Task 1: 数据库迁移

**Files:**
- Create: `db_migration_script_id.sql`
- Create: `deploy/sql/db_migration_script_id.sql`

- [ ] **Step 1: 创建迁移脚本**

```sql
-- db_migration_script_id.sql
-- 为 storyboard_items 和 assets 添加 script_id 列
-- 支持按文件（script_id）隔离数据

-- 1. storyboard_items 加 script_id
ALTER TABLE storyboard_items ADD COLUMN IF NOT EXISTS script_id VARCHAR(50);

-- 2. assets 加 script_id
ALTER TABLE assets ADD COLUMN IF NOT EXISTS script_id VARCHAR(50);

-- 3. 回填：将现有数据的 script_id 设为所属 episode 下第一个 script
UPDATE storyboard_items si
SET script_id = (
    SELECT script_id FROM episode_scripts es
    WHERE es.episode_id = si.episode_id
    ORDER BY sort_order, created_at LIMIT 1
)
WHERE si.script_id IS NULL;

UPDATE assets a
SET script_id = (
    SELECT script_id FROM episode_scripts es
    WHERE es.episode_id = a.episode_id
    ORDER BY sort_order, created_at LIMIT 1
)
WHERE a.script_id IS NULL AND a.episode_id IS NOT NULL;

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_storyboard_items_script ON storyboard_items(script_id);
CREATE INDEX IF NOT EXISTS idx_assets_script ON assets(script_id);
```

- [ ] **Step 2: 复制到 deploy 目录**

```bash
cp db_migration_script_id.sql deploy/sql/db_migration_script_id.sql
```

- [ ] **Step 3: Commit**

```bash
git add db_migration_script_id.sql deploy/sql/db_migration_script_id.sql
git commit -m "feat(db): add script_id column to storyboard_items and assets"
```

---

### Task 2: 后端 DAO — dao_storyboard.py

**Files:**
- Modify: `dao_storyboard.py`

需要修改 4 个方法：`create`、`batch_create`、`batch_create_transactional`、`get_by_episode`。

- [ ] **Step 1: 修改 `create` 方法 — 接受 script_id 参数**

在 `create` 方法签名中，在 `episode_id` 后加 `script_id: Optional[str] = None`。
SQL INSERT 加 `script_id` 列。

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
    script_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    db = get_db_manager()
    if not db:
        return None
    item_id = f"sb_{uuid.uuid4().hex[:12]}"
    query = """
        INSERT INTO storyboard_items
            (item_id, episode_id, script_id, sort_order, scene_heading, action_text,
             dialogue, camera_movement, image_prompt, video_prompt, bound_assets)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        RETURNING *
    """
    return await db.fetchrow(
        query, item_id, episode_id, script_id, sort_order,
        scene_heading, action_text, dialogue,
        camera_movement, image_prompt, video_prompt,
        json.dumps(bound_assets or [], ensure_ascii=False)
    )
```

- [ ] **Step 2: 修改 `batch_create` — 传递 script_id**

```python
@staticmethod
async def batch_create(episode_id: str, items: list, script_id: Optional[str] = None) -> List[Dict[str, Any]]:
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
            script_id=script_id or item.get('script_id'),
        )
        if row:
            results.append(dict(row))
    return results
```

- [ ] **Step 3: 修改 `batch_create_transactional` — 写入 script_id**

```python
@staticmethod
async def batch_create_transactional(conn, episode_id: str, items: list, script_id: Optional[str] = None) -> int:
    count = 0
    for item in items:
        item_id = f"sb_{uuid.uuid4().hex[:12]}"
        sid = script_id or item.get('script_id')
        await conn.execute("""
            INSERT INTO storyboard_items
                (item_id, episode_id, script_id, sort_order, scene_heading, action_text,
                 dialogue, camera_movement, image_prompt, video_prompt,
                 bound_assets, planned_duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
        """,
            item_id, episode_id, sid,
            item.get('sort_order', 0),
            item.get('scene_heading', ''),
            item.get('action_text', ''),
            item.get('dialogue', ''),
            item.get('camera_movement', ''),
            item.get('image_prompt', ''),
            item.get('video_prompt', ''),
            json.dumps(item.get('bound_assets', []), ensure_ascii=False),
            item.get('planned_duration_ms'),
        )
        count += 1
    return count
```

- [ ] **Step 4: 修改 `get_by_episode` — 支持 script_id 过滤**

```python
@staticmethod
async def get_by_episode(episode_id: str, script_id: Optional[str] = None) -> List[Dict[str, Any]]:
    db = get_db_manager()
    if not db:
        return []
    if script_id:
        return await db.fetch(
            "SELECT * FROM storyboard_items WHERE episode_id = $1 AND script_id = $2 ORDER BY sort_order ASC",
            episode_id, script_id
        )
    return await db.fetch(
        "SELECT * FROM storyboard_items WHERE episode_id = $1 ORDER BY sort_order ASC",
        episode_id
    )
```

- [ ] **Step 5: 修改 `delete_by_episode` — 支持 script_id 过滤**

```python
@staticmethod
async def delete_by_episode(episode_id: str, script_id: Optional[str] = None) -> int:
    db = get_db_manager()
    if not db:
        return 0
    if script_id:
        result = await db.execute(
            "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
            episode_id, script_id
        )
    else:
        result = await db.execute(
            "DELETE FROM storyboard_items WHERE episode_id = $1", episode_id
        )
    try:
        return int(result.split()[-1])
    except Exception:
        return 0
```

- [ ] **Step 6: Commit**

```bash
git add dao_storyboard.py
git commit -m "feat(dao): add script_id support to StoryboardDAO"
```

---

### Task 3: 后端 DAO — dao_asset.py

**Files:**
- Modify: `dao_asset.py`

- [ ] **Step 1: 修改 `create` — 接受 script_id**

在参数列表 `tags` 后加 `script_id: Optional[str] = None`。
SQL INSERT 加 `script_id` 列。

```python
@staticmethod
async def create(
    project_id: str,
    asset_type: str,
    name: str,
    created_by: str,
    episode_id: Optional[str] = None,
    description: str = '',
    thumbnail_url: Optional[str] = None,
    reference_images: Optional[list] = None,
    style_params: Optional[dict] = None,
    tags: Optional[list] = None,
    script_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    db = get_db_manager()
    if not db:
        return None
    aid = f"asset_{uuid.uuid4().hex[:12]}"
    query = """
        INSERT INTO assets
            (asset_id, project_id, episode_id, script_id, asset_type, name, description,
             thumbnail_url, reference_images, style_params, tags, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
        RETURNING *
    """
    return await db.fetchrow(
        query, aid, project_id, episode_id, script_id, asset_type, name, description,
        thumbnail_url,
        json.dumps(reference_images or [], ensure_ascii=False),
        json.dumps(style_params or {}, ensure_ascii=False),
        json.dumps(tags or [], ensure_ascii=False),
        created_by
    )
```

- [ ] **Step 2: 修改 `get_by_project` — 支持 script_id 过滤**

```python
@staticmethod
async def get_by_project(
    project_id: str,
    episode_id: Optional[str] = None,
    asset_type: Optional[str] = None,
    script_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    db = get_db_manager()
    if not db:
        return []
    conditions = ["project_id = $1"]
    args: list = [project_id]
    idx = 2

    if episode_id:
        conditions.append(f"(episode_id IS NULL OR episode_id = ${idx})")
        args.append(episode_id)
        idx += 1

    if script_id:
        conditions.append(f"script_id = ${idx}")
        args.append(script_id)
        idx += 1

    if asset_type:
        conditions.append(f"asset_type = ${idx}")
        args.append(asset_type)
        idx += 1

    where = " AND ".join(conditions)
    query = f"SELECT * FROM assets WHERE {where} ORDER BY created_at DESC"
    return await db.fetch(query, *args)
```

- [ ] **Step 3: 修改 `update` — allowed 加入 script_id**

在 `update` 方法的 `allowed` set 中加入 `'script_id'`：

```python
allowed = {'name', 'description', 'thumbnail_url', 'reference_images',
            'style_params', 'tags', 'episode_id', 'script_id'}
```

- [ ] **Step 4: 新增 `copy_to` — 复制资产到目标（共享功能）**

```python
@staticmethod
async def copy_to(
    asset_id: str,
    target_episode_id: str,
    target_script_id: str,
    created_by: str,
) -> Optional[Dict[str, Any]]:
    """复制资产到目标 episode/script，返回新资产"""
    source = await AssetDAO.get_by_id(asset_id)
    if not source:
        return None
    return await AssetDAO.create(
        project_id=source['project_id'],
        asset_type=source['asset_type'],
        name=source['name'],
        created_by=created_by,
        episode_id=target_episode_id,
        description=source.get('description', ''),
        thumbnail_url=source.get('thumbnail_url'),
        reference_images=source.get('reference_images'),
        style_params=source.get('style_params'),
        tags=source.get('tags'),
        script_id=target_script_id,
    )
```

- [ ] **Step 5: Commit**

```bash
git add dao_asset.py
git commit -m "feat(dao): add script_id support and copy_to to AssetDAO"
```

---

### Task 4: 后端 API — api_routes.py

**Files:**
- Modify: `api_routes.py`

- [ ] **Step 1: 修改 GET storyboard-items — 加 script_id 查询参数**

替换 `get_storyboard_items` 函数（约行 1610）：

```python
@router.get("/api/episodes/{episode_id}/storyboard-items")
async def get_storyboard_items(episode_id: str, script_id: Optional[str] = None, user_id: str = Depends(get_current_user)):
    items = await StoryboardDAO.get_by_episode(episode_id, script_id=script_id)
    return {"success": True, "items": [dict(i) for i in items]}
```

- [ ] **Step 2: 修改 StoryboardItemCreate 模型 — 加 script_id**

```python
class StoryboardItemCreate(BaseModel):
    sort_order: int = 0
    scene_heading: Optional[str] = ''
    dialogue: Optional[str] = ''
    action_text: Optional[str] = ''
    camera_movement: Optional[str] = ''
    image_prompt: Optional[str] = ''
    video_prompt: Optional[str] = ''
    script_id: Optional[str] = None
```

- [ ] **Step 3: 修改 POST 单条创建 — 传 script_id**

替换 `create_storyboard_item` 函数（约行 1616）：

```python
@router.post("/api/episodes/{episode_id}/storyboard-items")
async def create_storyboard_item(episode_id: str, data: StoryboardItemCreate, user_id: str = Depends(get_current_user)):
    item = await StoryboardDAO.create(
        episode_id=episode_id, sort_order=data.sort_order,
        scene_heading=data.scene_heading, dialogue=data.dialogue,
        action_text=data.action_text, camera_movement=data.camera_movement,
        image_prompt=data.image_prompt, video_prompt=data.video_prompt,
        script_id=data.script_id,
    )
    if not item:
        raise HTTPException(status_code=500, detail="创建分镜失败")
    return {"success": True, "item": dict(item)}
```

- [ ] **Step 4: 修改 BatchStoryboardCreate — 加 script_id**

```python
class BatchStoryboardCreate(BaseModel):
    items: list
    script_id: Optional[str] = None
```

替换 `batch_create_storyboard_items` 函数（约行 2385）：

```python
@router.post("/api/episodes/{episode_id}/storyboard-items/batch")
async def batch_create_storyboard_items(
    episode_id: str, data: BatchStoryboardCreate,
    user_id: str = Depends(get_current_user)
):
    items = await StoryboardDAO.batch_create(episode_id, data.items, script_id=data.script_id)
    return {"success": True, "items": items}
```

- [ ] **Step 5: 修改 DELETE all — 支持 script_id**

替换 `delete_all_storyboard_items`（约行 1645）：

```python
@router.delete("/api/episodes/{episode_id}/storyboard-items/all")
async def delete_all_storyboard_items(episode_id: str, script_id: Optional[str] = None, user_id: str = Depends(get_current_user)):
    count = await StoryboardDAO.delete_by_episode(episode_id, script_id=script_id)
    return {"success": True, "deleted": count}
```

- [ ] **Step 6: 修改 GET assets — 加 script_id 查询参数**

替换 `get_assets`（约行 1524）：

```python
@router.get("/api/projects/{project_id}/assets")
async def get_assets(
    project_id: str,
    episode_id: Optional[str] = None,
    asset_type: Optional[str] = None,
    script_id: Optional[str] = None,
    user_id: str = Depends(get_current_user)
):
    assets = await AssetDAO.get_by_project(project_id, episode_id, asset_type, script_id=script_id)
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

- [ ] **Step 7: 修改 AssetCreate — 加 script_id**

```python
class AssetCreate(BaseModel):
    project_id: str
    asset_type: str
    name: str
    episode_id: Optional[str] = None
    description: Optional[str] = ''
    reference_images: Optional[list] = None
    script_id: Optional[str] = None
```

替换 `create_asset`（约行 1547）：

```python
@router.post("/api/assets")
async def create_asset(data: AssetCreate, user_id: str = Depends(get_current_user)):
    asset = await AssetDAO.create(
        project_id=data.project_id, asset_type=data.asset_type,
        name=data.name, created_by=user_id,
        episode_id=data.episode_id, description=data.description or '',
        reference_images=data.reference_images,
        script_id=data.script_id,
    )
    if not asset:
        raise HTTPException(status_code=500, detail="创建资产失败")
    return {"success": True, "asset": dict(asset)}
```

- [ ] **Step 8: 修改 ExtractToAssetsRequest + extract_to_assets — 加 script_id**

```python
class ExtractToAssetsRequest(BaseModel):
    characters: list
    scenes: list
    script_id: Optional[str] = None
```

在 `extract_to_assets` 函数中，`AssetDAO.create` 调用加 `script_id=data.script_id`：

将两处 `AssetDAO.create(...)` 调用都加上 `script_id=data.script_id` 参数。

- [ ] **Step 9: 修改 export_script — 事务中传 script_id**

在 `export_script` 函数中：
- `ExportScriptRequest` 加 `script_id: Optional[str] = None`
- `StoryboardDAO.batch_create_transactional(conn, episode_id, req.storyboard_items)` 改为 `StoryboardDAO.batch_create_transactional(conn, episode_id, req.storyboard_items, script_id=req.script_id)`
- 两处 `INSERT INTO assets` 的 SQL 加 `script_id` 列和 `req.script_id` 值

- [ ] **Step 10: 新增共享 API**

在资产 API 区域末尾新增：

```python
class ShareAssetRequest(BaseModel):
    target_episode_id: str
    target_script_id: str

@router.post("/api/assets/{asset_id}/share")
async def share_asset(asset_id: str, data: ShareAssetRequest, user_id: str = Depends(get_current_user)):
    new_asset = await AssetDAO.copy_to(
        asset_id=asset_id,
        target_episode_id=data.target_episode_id,
        target_script_id=data.target_script_id,
        created_by=user_id,
    )
    if not new_asset:
        raise HTTPException(status_code=404, detail="源资产不存在")
    # 复制关联的 entity files
    from dao_entity_file import EntityFileDAO
    source_files = await EntityFileDAO.get_by_entity("asset", asset_id)
    for f in source_files:
        await EntityFileDAO.copy_file(f['file_id'], "asset", new_asset['asset_id'])
    return {"success": True, "asset": dict(new_asset)}
```

注意：`EntityFileDAO.copy_file` 可能不存在，需要在 Task 4 Step 10 实现前检查 `dao_entity_file.py` 是否有此方法，没有则需新增。如果不存在，简化为只复制资产记录（不复制图片文件），后续迭代再补。

- [ ] **Step 11: Commit**

```bash
git add api_routes.py
git commit -m "feat(api): add script_id to storyboard/asset endpoints + share API"
```

---

### Task 5: 前端 API Service — apiService.ts

**Files:**
- Modify: `new_html/services/apiService.ts`

- [ ] **Step 1: 修改 `getStoryboardItems` — 加 script_id 参数**

```typescript
export async function getStoryboardItems(episodeId: string, scriptId?: string) {
    const params = new URLSearchParams();
    if (scriptId) params.set('script_id', scriptId);
    const qs = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items${qs}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getStoryboardItems');
}
```

- [ ] **Step 2: 修改 `batchCreateStoryboardItems` — 加 script_id**

```typescript
export async function batchCreateStoryboardItems(episodeId: string, items: any[], scriptId?: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/batch`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ items, script_id: scriptId })
    });
    return handleResponse(response, 'batchCreateStoryboardItems');
}
```

- [ ] **Step 3: 修改 `getAssets` — 加 script_id**

```typescript
export async function getAssets(projectId: string, episodeId?: string, assetType?: string, scriptId?: string) {
    const params = new URLSearchParams();
    if (episodeId) params.set('episode_id', episodeId);
    if (assetType) params.set('asset_type', assetType);
    if (scriptId) params.set('script_id', scriptId);
    const qs = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/assets${qs}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getAssets');
}
```

- [ ] **Step 4: 修改 `createAsset` — data 类型加 script_id**

```typescript
export async function createAsset(data: {
    project_id: string; asset_type: string; name: string;
    episode_id?: string; description?: string;
    reference_images?: string[];
    script_id?: string;
}) {
    const response = await fetch(`${API_BASE}/api/assets`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createAsset');
}
```

- [ ] **Step 5: 修改 `extractToAssets` — 加 script_id**

```typescript
export async function extractToAssets(episodeId: string, characters: any[], scenes: any[], scriptId?: string) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/extract-to-assets`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ characters, scenes, script_id: scriptId })
    });
    return handleResponse(response, 'extractToAssets');
}
```

- [ ] **Step 6: 新增 `shareAsset`**

在资产 API 区域末尾新增：

```typescript
export async function shareAsset(assetId: string, targetEpisodeId: string, targetScriptId: string) {
    const response = await fetch(`${API_BASE}/api/assets/${assetId}/share`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ target_episode_id: targetEpisodeId, target_script_id: targetScriptId })
    });
    return handleResponse(response, 'shareAsset');
}
```

- [ ] **Step 7: Commit**

```bash
git add new_html/services/apiService.ts
git commit -m "feat(frontend): add script_id to all storyboard/asset API calls"
```

---

### Task 6: 前端 EpisodeContext — 新增 selectedScriptId

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx`

- [ ] **Step 1: 新增 selectedScriptId 到接口和默认值**

在 `EpisodeContextValue` 接口中加：

```typescript
selectedScriptId: string | null;
setSelectedScriptId: (id: string | null) => void;
```

在 `createContext` 默认值中加：

```typescript
selectedScriptId: null,
setSelectedScriptId: () => {},
```

- [ ] **Step 2: 在 EpisodeProvider 中声明 state**

在其他 `useState` 声明之后加：

```typescript
const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
```

- [ ] **Step 3: 修改 loadSlices 的 storyboardItems loader**

将 storyboardItems loader 改为：

```typescript
storyboardItems: async () => {
    const res = await getStoryboardItems(episodeId, selectedScriptId || undefined).catch(() => ({ success: false, items: [] }));
    if (res.success) setStoryboardItems((res.items || []).map(normalizeStoryboardItem));
},
```

- [ ] **Step 4: 修改 loadSlices 的 assets loader**

将 assets loader 改为：

```typescript
assets: async () => {
    const res = await getAssets(projectId, episodeId, undefined, selectedScriptId || undefined).catch(() => ({ success: false, assets: [] }));
    if (res.success) setAssets((res.assets || []).map(normalizeAsset));
},
```

- [ ] **Step 5: loadSlices 依赖加上 selectedScriptId**

`loadSlices` 的 `useCallback` 依赖数组从 `[episodeId, projectId]` 改为 `[episodeId, projectId, selectedScriptId]`。

- [ ] **Step 6: 修改写入方法传 script_id**

`createStoryboardItems` 改为：

```typescript
const createStoryboardItems = useCallback(async (items: any[]) => {
    try {
        await apiBatchCreateStoryboardItems(episodeId, items, selectedScriptId || undefined);
        await reload();
    } catch (e: any) {
        console.error('Failed to batch create storyboard items:', e);
    }
}, [episodeId, selectedScriptId, reload]);
```

`extractToAssetsFn` 改为：

```typescript
const extractToAssetsFn = useCallback(async (characters: any[], scenes: any[]) => {
    try {
        await apiExtractToAssets(episodeId, characters, scenes, selectedScriptId || undefined);
        await reload();
    } catch (e: any) {
        console.error('Failed to extract to assets:', e);
    }
}, [episodeId, selectedScriptId, reload]);
```

- [ ] **Step 7: episodeId 变化时重置 selectedScriptId**

在 `useEffect` 中加 `setSelectedScriptId(null);`。

- [ ] **Step 8: Provider value 传出新字段**

在 `<EpisodeContext.Provider value={{...}}>` 中加入 `selectedScriptId, setSelectedScriptId`。

- [ ] **Step 9: 更新 import**

确保文件顶部的 `import` 包含修改后的 `getStoryboardItems`、`getAssets`、`batchCreateStoryboardItems`、`extractToAssets` 函数签名兼容新参数。这些函数新参数都是可选的，无需修改 import 语句。

- [ ] **Step 10: Commit**

```bash
git add new_html/contexts/EpisodeContext.tsx
git commit -m "feat(context): add selectedScriptId to EpisodeContext"
```

---

### Task 7: 前端 WorkspaceApp + ScriptPage — 同步 selectedFileId

**Files:**
- Modify: `new_html/pages/ScriptPage.tsx`
- Modify: `new_html/WorkspaceApp.tsx`

- [ ] **Step 1: ScriptPage — 取 setSelectedScriptId 传给 WorkspaceApp**

```typescript
import React from 'react';
import { useParams } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import WorkspaceApp from '../WorkspaceApp';

export const ScriptPage: React.FC = () => {
  const { episodeId } = useParams<{ episodeId: string }>();
  const { setSelectedScriptId } = useEpisode();
  return (
    <div className="h-full w-full overflow-hidden">
      <WorkspaceApp hideHeader episodeId={episodeId} onScriptSelect={setSelectedScriptId} />
    </div>
  );
};
```

- [ ] **Step 2: WorkspaceApp — 接受 onScriptSelect prop**

在 `WorkspaceAppProps` 接口加：

```typescript
interface WorkspaceAppProps {
  hideHeader?: boolean;
  episodeId: string;
  onScriptSelect?: (scriptId: string | null) => void;
}
```

解构加 `onScriptSelect`：

```typescript
const WorkspaceApp: React.FC<WorkspaceAppProps> = ({ hideHeader = false, episodeId: propEpisodeId, onScriptSelect }) => {
```

- [ ] **Step 3: WorkspaceApp — selectedFileId 变化时通知 context**

在 `handleFileSelect` 函数中加：

```typescript
const handleFileSelect = (id: string) => {
    setSelectedFileId(id);
    onScriptSelect?.(id);
    setHighlightedScriptSegments(new Set());
    setHighlightedStoryboardItemIds(new Set());
};
```

- [ ] **Step 4: WorkspaceApp — 初始加载完成后同步初始选中**

在 `loadEpisodeData` 函数末尾，`setSelectedFileId` 之后加：

```typescript
onScriptSelect?.(projectFiles[0]?.id || null);
```

- [ ] **Step 5: WorkspaceApp — saveEpisodeToBackend 传 script_id**

修改 `saveEpisodeToBackend` 中的 `batchCreateStoryboardItems` 调用：

```typescript
await batchCreateStoryboardItems(propEpisodeId, dbItems, primaryFile.id);
```

- [ ] **Step 6: WorkspaceApp — handleExportStoryboards 传 script_id**

在 `exportScript` 调用中加 `script_id: selectedFileId`：

```typescript
await exportScript(eid, {
    project_id: pid,
    original_content: selectedFile.originalContent || '',
    script_content: selectedFile.scriptContent || '',
    storyboard_items: dbItems,
    characters: charNames.map(n => ({ name: n, description: '' })),
    scenes: sceneNames.map(n => ({ name: n, description: '' })),
    script_id: selectedFileId,
});
```

注意：需确保 `exportScript` 函数的 TypeScript 签名支持 `script_id` 字段。如果它的 data 参数是 `any` 类型则无需修改；否则需加 `script_id?: string`。

- [ ] **Step 7: Commit**

```bash
git add new_html/pages/ScriptPage.tsx new_html/WorkspaceApp.tsx
git commit -m "feat(frontend): sync selectedFileId to EpisodeContext via onScriptSelect"
```

---

### Task 8: 前端工作流页面适配

**Files:**
- Modify: `new_html/pages/DesignPage.tsx`
- Modify: `new_html/pages/MaterialsPage.tsx`
- Modify: `new_html/pages/StoryboardGenPage.tsx`

这些页面需要从 context 取 `selectedScriptId`，并在创建/加载数据时使用。

- [ ] **Step 1: DesignPage — createAsset 传 script_id**

在 `DesignPage.tsx` 中，找到所有 `createAsset({...})` 调用（约有 1-2 处），在参数对象中加 `script_id: selectedScriptId`：

```typescript
const { selectedScriptId } = useEpisode();
// ...
const asset = await createAsset({
    project_id: projectId,
    asset_type: activeTab,
    name: newName,
    episode_id: episodeId,
    script_id: selectedScriptId || undefined,
});
```

同时在 `export_script` 内的 `INSERT INTO assets` 调用（如果 DesignPage 直接操作的话）也要传 script_id。根据代码分析，DesignPage 用的是 `createAsset` API，所以只需改这一处。

- [ ] **Step 2: MaterialsPage — selectedFileId 改用 selectedScriptId**

找到 `selectedFileId={episodeId}` 的位置（约行 350），改为：

```typescript
const { selectedScriptId } = useEpisode();
// ... 在 JSX 中：
selectedFileId={selectedScriptId || episodeId}
```

- [ ] **Step 3: StoryboardGenPage — selectedFileId 改用 selectedScriptId**

找到 `selectedFileId={episodeId}` 的位置（约行 296），改为：

```typescript
const { selectedScriptId } = useEpisode();
// ... 在 JSX 中：
selectedFileId={selectedScriptId || episodeId}
```

- [ ] **Step 4: 其他页面（AudioStagePage, GenerationPage, VideoGenPage, EnhancePage）**

这些页面不传 `selectedFileId`，它们的数据直接来自 `useEpisode()` 返回的 `storyboardItems`（已在 EpisodeContext 中按 script_id 过滤）。
**无需修改代码。**

但有一个前提：这些页面在 mount 时会调用 `loadSlices()`。如果 `selectedScriptId` 在它们 mount 之后才被设置（例如用户从剧本页切过来），`loadSlices` 已经执行过了，数据没有按 script_id 过滤。

解决方案：在 `EpisodeContext` 中，当 `selectedScriptId` 变化时自动 reload 已加载的 slices。

在 `EpisodeContext.tsx` 的 `EpisodeProvider` 中加入：

```typescript
useEffect(() => {
    if (selectedScriptId && loadedSlicesRef.current.size > 0) {
        const slicesToReload = Array.from(loadedSlicesRef.current).filter(
            s => s === 'storyboardItems' || s === 'assets'
        ) as DataSlice[];
        if (slicesToReload.length > 0) {
            loadSlices(...slicesToReload);
        }
    }
}, [selectedScriptId]);
```

- [ ] **Step 5: Commit**

```bash
git add new_html/pages/DesignPage.tsx new_html/pages/MaterialsPage.tsx new_html/pages/StoryboardGenPage.tsx new_html/contexts/EpisodeContext.tsx
git commit -m "feat(pages): all workflow pages use selectedScriptId for data isolation"
```

---

### Task 9: 构建与部署

**Files:**
- 同步所有后端文件到 deploy/
- 构建前端 dist

- [ ] **Step 1: 同步后端文件到 deploy**

```bash
cp dao_storyboard.py deploy/dao_storyboard.py
cp dao_asset.py deploy/dao_asset.py
cp api_routes.py deploy/api_routes.py
```

- [ ] **Step 2: 构建前端**

```bash
cd new_html && npm run build
```

- [ ] **Step 3: 复制 dist 到 deploy**

```bash
cp -r dist deploy/dist
```

（Windows 上用 `Copy-Item -Recurse`）

- [ ] **Step 4: 验证构建无错误**

确认 `npm run build` 输出无 TypeScript 错误（warning 可忽略）。

- [ ] **Step 5: Commit**

```bash
git add deploy/
git commit -m "build: sync backend + rebuild dist for script_id isolation"
```

---

## 部署清单

1. **先跑数据库迁移**：`psql -f db_migration_script_id.sql`
2. **更新后端文件**：`dao_storyboard.py`、`dao_asset.py`、`api_routes.py`
3. **更新前端 dist**：替换 `deploy/dist`
4. **重启后端服务**
5. **验证**：在浏览器中创建分集、新建多个文件、在不同文件间切换，确认各页面数据独立
