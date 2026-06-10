# Workflow Hot Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理页面更新工作流后无需重启即刻生效，通过写回磁盘 JSON + 内存重载实现。

**Architecture:** 方案 B — 保持磁盘 `workflows/*.json` 为运行时数据源。管理页面更新工作流时，在同一个 endpoint 里完成三步：写 DB + 写磁盘 + 调用 `handler.load_workflows()` 重载内存缓存。`WorkflowHandler` 本身零改动。

**Tech Stack:** Python / FastAPI / PostgreSQL / asyncpg

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `db_migration_admin.sql` | Modify | 添加 `workflow_key` 列 + 索引 |
| `dao_workflow_template.py` | Modify | `create()` / `update()` 支持 `workflow_key` |
| `admin_routes.py` | Modify | 更新/创建/删除后写磁盘 + 重载；导入填 `workflow_key`；新增 `/reload` |
| `workflow_handler.py` | No change | — |
| `task_service.py` | No change | — |
| `worker.py` | No change | — |

---

## Task 1: DB Schema — 添加 `workflow_key` 列

**Files:**
- Modify: `db_migration_admin.sql:22-36`

- [ ] **Step 1: 修改迁移 SQL**

在 `db_migration_admin.sql` 末尾（第 146 行之后）追加 `workflow_key` 列和唯一索引：

```sql
-- Workflow hot-reload: add workflow_key column
ALTER TABLE workflow_templates
  ADD COLUMN IF NOT EXISTS workflow_key VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_key
  ON workflow_templates(workflow_key) WHERE workflow_key IS NOT NULL;
```

- [ ] **Step 2: 验证 SQL 语法**

在本地 PostgreSQL 上执行迁移脚本，确认无报错。如果表已存在，`ADD COLUMN IF NOT EXISTS` 和 `CREATE INDEX IF NOT EXISTS` 确保幂等。

---

## Task 2: DAO — `create` / `update` 支持 `workflow_key`

**Files:**
- Modify: `dao_workflow_template.py:18-53` (create) 和 `dao_workflow_template.py:96-149` (update)

- [ ] **Step 1: 修改 `create()` 签名和 SQL**

在 `dao_workflow_template.py` 的 `create()` 方法中：

1. 签名增加 `workflow_key: str = ""` 参数
2. INSERT 语句增加 `workflow_key` 列
3. VALUES 增加对应参数

修改后的 `create()` 方法：

```python
@staticmethod
async def create(
    name: str,
    category: str,
    workflow_json: dict,
    placeholders: Optional[list] = None,
    description: str = "",
    node_type: str = "any",
    estimated_time: int = 30,
    workflow_key: str = "",
) -> Optional[Dict[str, Any]]:
    db = get_db_manager()
    if not db:
        return None
    template_id = f"wft_{uuid.uuid4().hex[:12]}"
    wf_s = json.dumps(workflow_json, ensure_ascii=False)
    ph = placeholders if placeholders is not None else []
    ph_s = json.dumps(ph, ensure_ascii=False)
    query = """
        INSERT INTO workflow_templates (
            template_id, name, category, description,
            workflow_json, placeholders, node_type, estimated_time, enabled,
            workflow_key
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, TRUE, $9)
        RETURNING *
    """
    return await db.fetchrow(
        query,
        template_id,
        name,
        category,
        description,
        wf_s,
        ph_s,
        node_type,
        estimated_time,
        workflow_key or None,
    )
```

- [ ] **Step 2: 修改 `update()` 的 `allowed` 集合**

在 `dao_workflow_template.py` 的 `update()` 方法中，将 `"workflow_key"` 加入 `allowed` 集合：

```python
allowed = {
    "name",
    "category",
    "description",
    "workflow_json",
    "placeholders",
    "node_type",
    "estimated_time",
    "enabled",
    "workflow_key",
}
```

无需其他改动 — `update()` 的通用逻辑已经能处理新增的字符串字段。

---

## Task 3: Admin Routes — 写磁盘 + 重载 + 导入填 key

**Files:**
- Modify: `admin_routes.py:289-336` (import)
- Modify: `admin_routes.py:339-357` (create body model)
- Modify: `admin_routes.py:367-381` (create endpoint)
- Modify: `admin_routes.py:393-405` (update endpoint)
- Modify: `admin_routes.py:408-414` (delete endpoint)
- Add new endpoint: `/api/admin/workflows/reload`
- Add new helper: `_sync_workflow_to_disk()`

### Step 1: 添加辅助函数和导入

- [ ] **Step 1a: 在文件顶部（`_reload_api_env` 函数之后，约第 38 行）添加磁盘同步辅助函数**

```python
def _sync_workflow_to_disk(workflow_key: str, workflow_json: dict):
    """将工作流 JSON 写回 workflows/ 目录的磁盘文件"""
    if not workflow_key:
        return
    wf_dir = Path(__file__).resolve().parent / "workflows"
    wf_dir.mkdir(exist_ok=True)
    file_path = wf_dir / f"{workflow_key}.json"
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(workflow_json, f, ensure_ascii=False, indent=2)
        logger.info(f"✅ 工作流已写回磁盘: {file_path.name}")
    except OSError as e:
        logger.error(f"❌ 写回磁盘失败 {file_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to sync workflow to disk: {e}")


def _reload_workflow_cache():
    """重新加载所有工作流到内存缓存"""
    try:
        from workflow_handler import get_workflow_handler
        handler = get_workflow_handler()
        handler.load_workflows()
        logger.info(f"🔄 工作流缓存已重载，共 {len(handler.workflows)} 个")
    except Exception as e:
        logger.warning(f"⚠️ 重载工作流缓存失败: {e}")


def _delete_workflow_from_disk(workflow_key: str):
    """从磁盘删除工作流 JSON 文件"""
    if not workflow_key:
        return
    wf_dir = Path(__file__).resolve().parent / "workflows"
    file_path = wf_dir / f"{workflow_key}.json"
    if file_path.is_file():
        try:
            file_path.unlink()
            logger.info(f"🗑️ 已删除磁盘工作流: {file_path.name}")
        except OSError as e:
            logger.warning(f"⚠️ 删除磁盘文件失败 {file_path}: {e}")
```

### Step 2: 修改 WorkflowCreateBody 和创建端点

- [ ] **Step 2a: `WorkflowCreateBody` 增加 `workflow_key` 字段**

在 `admin_routes.py` 约第 339 行的 `WorkflowCreateBody` 中添加：

```python
class WorkflowCreateBody(BaseModel):
    name: str = Field(..., min_length=1)
    category: str = Field(..., min_length=1)
    workflow_json: Dict[str, Any]
    placeholders: Optional[List[Any]] = None
    description: str = ""
    node_type: str = "any"
    estimated_time: int = 30
    workflow_key: str = ""
```

- [ ] **Step 2b: `WorkflowUpdateBody` 增加 `workflow_key` 字段**

在 `admin_routes.py` 约第 349 行的 `WorkflowUpdateBody` 中添加：

```python
class WorkflowUpdateBody(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    workflow_json: Optional[Dict[str, Any]] = None
    placeholders: Optional[List[Any]] = None
    description: Optional[str] = None
    node_type: Optional[str] = None
    estimated_time: Optional[int] = None
    enabled: Optional[bool] = None
    workflow_key: Optional[str] = None
```

### Step 3: 修改创建端点

- [ ] **Step 3: `admin_create_workflow` 增加写磁盘 + 重载**

修改 `admin_routes.py` 约第 367-381 行：

```python
@router.post("/workflows", status_code=status.HTTP_201_CREATED)
async def admin_create_workflow(body: WorkflowCreateBody):
    _require_db()
    row = await WorkflowTemplateDAO.create(
        name=body.name.strip(),
        category=body.category.strip(),
        workflow_json=body.workflow_json,
        placeholders=body.placeholders,
        description=body.description,
        node_type=body.node_type,
        estimated_time=body.estimated_time,
        workflow_key=body.workflow_key.strip(),
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create template")
    wf_key = body.workflow_key.strip()
    if wf_key and body.workflow_json:
        _sync_workflow_to_disk(wf_key, body.workflow_json)
        _reload_workflow_cache()
    return {"success": True, "workflow": _row_to_jsonable(row)}
```

### Step 4: 修改更新端点

- [ ] **Step 4: `admin_update_workflow` 增加写磁盘 + 重载**

修改 `admin_routes.py` 约第 393-405 行：

```python
@router.put("/workflows/{template_id}")
async def admin_update_workflow(template_id: str, body: WorkflowUpdateBody):
    _require_db()
    data = body.model_dump(exclude_unset=True)
    if not data:
        row = await WorkflowTemplateDAO.get_by_id(template_id)
        if not row:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"success": True, "workflow": _row_to_jsonable(row)}
    updated = await WorkflowTemplateDAO.update(template_id, **data)
    if not updated:
        raise HTTPException(status_code=404, detail="Template not found")
    wf_key = updated.get("workflow_key") or ""
    if wf_key and "workflow_json" in data:
        wf_json = updated.get("workflow_json")
        if isinstance(wf_json, str):
            wf_json = json.loads(wf_json)
        _sync_workflow_to_disk(wf_key, wf_json)
        _reload_workflow_cache()
    return {"success": True, "workflow": _row_to_jsonable(updated)}
```

### Step 5: 修改删除端点

- [ ] **Step 5: `admin_delete_workflow` 增加删除磁盘文件 + 重载**

修改 `admin_routes.py` 约第 408-414 行：

```python
@router.delete("/workflows/{template_id}")
async def admin_delete_workflow(template_id: str):
    _require_db()
    row = await WorkflowTemplateDAO.get_by_id(template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    wf_key = row.get("workflow_key") or ""
    ok = await WorkflowTemplateDAO.delete(template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    if wf_key:
        _delete_workflow_from_disk(wf_key)
        _reload_workflow_cache()
    return {"success": True, "deleted": True}
```

### Step 6: 修改导入端点

- [ ] **Step 6: `admin_import_workflows` 填充 `workflow_key`**

修改 `admin_routes.py` 约第 289-336 行的导入端点，在 `WorkflowTemplateDAO.create()` 调用中添加 `workflow_key=category_key`（`category_key` 就是 `WORKFLOW_CONFIGS` 的字典 key，如 `wan2_i2v`）：

将第 322-329 行的 `create` 调用改为：

```python
        row = await WorkflowTemplateDAO.create(
            name=name,
            category=str(category_key),
            workflow_json=workflow_json,
            placeholders=ph_objs,
            description=description,
            node_type="any",
            estimated_time=30,
            workflow_key=str(category_key),
        )
```

### Step 7: 新增手动重载端点

- [ ] **Step 7: 在删除端点之后添加 `/reload` 端点**

在 `admin_routes.py` 约第 415 行（delete 端点之后）添加：

```python
@router.post("/workflows/reload")
async def admin_reload_workflows():
    """手动重载所有工作流到内存缓存（应急用）"""
    _reload_workflow_cache()
    from workflow_handler import get_workflow_handler
    handler = get_workflow_handler()
    return {
        "success": True,
        "message": "Workflows reloaded",
        "count": len(handler.workflows),
        "names": sorted(handler.workflows.keys()),
    }
```

**注意路由顺序**：这个 `/workflows/reload` 路由必须放在 `/workflows/{template_id}` 路由之前，否则 FastAPI 会把 `"reload"` 当作 `template_id` 参数。具体实现时，需要确保在 `admin_get_workflow`（GET `/workflows/{template_id}`）之前声明此路由。

---

## Task 4: Deploy 同步

**Files:**
- Copy: `db_migration_admin.sql` → `deploy/db_migration_admin.sql`
- Copy: `dao_workflow_template.py` → `deploy/dao_workflow_template.py`
- Copy: `admin_routes.py` → `deploy/admin_routes.py`

- [ ] **Step 1: 同步所有修改过的文件到 deploy/ 目录**

```powershell
Copy-Item h:\MY2\db_migration_admin.sql h:\MY2\deploy\db_migration_admin.sql
Copy-Item h:\MY2\dao_workflow_template.py h:\MY2\deploy\dao_workflow_template.py
Copy-Item h:\MY2\admin_routes.py h:\MY2\deploy\admin_routes.py
```

---

## 部署步骤

用户拿到 `deploy/` 目录中的文件后，需要在服务器上执行：

1. **执行迁移 SQL**（添加 `workflow_key` 列）：
   ```bash
   psql -U your_user -d your_db -f db_migration_admin.sql
   ```
   幂等的，可以重复执行不会报错。

2. **替换 Python 文件**并重启服务器

3. **在管理页面点击"导入"**，将现有工作流重新导入 DB（这次会填充 `workflow_key`）。对于已存在的记录，可以手动 UPDATE 补填 `workflow_key`：
   ```sql
   UPDATE workflow_templates SET workflow_key = 'wan2_i2v' WHERE name = 'Wan2 图片转视频';
   -- 或者清空后重新导入
   ```

4. 之后在管理页面更新任何工作流，都会立即生效，无需重启。
