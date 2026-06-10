# 极简任务数据架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 3 张任务相关表（tasks + task_history + files）简化为 1 张（tasks）+ Redis，消除外键冲突和表不同步导致的 "任务永远 loading" bug。

**Architecture:** Redis 作为实时主数据源（前端轮询 Redis），`tasks` 表作为持久化备份（Redis 过期后的降级查询）。文件存磁盘、URL 存在 task result JSON 中，不再经过 files 表。`agent_complete` 流程改为 Redis-first：先更新 Redis 解锁前端，再 best-effort 写 DB。

**Tech Stack:** Python/FastAPI, Redis, PostgreSQL (asyncpg), existing `tasks` table with `result_data JSONB` column.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `agent_routes.py` | **Modify** (lines 1-264) | 重写 `agent_complete`；修改 `agent_poll` 中 TaskHistoryDAO 调用；新增 `save_output_file` / `build_result` 工具函数 |
| `comfyui_main.py` | **Modify** (lines 353-413) | `fetch_result` 改用 `save_output_file` |
| `dao_task.py` | **Modify** (append) | 新增 `get_stats()` 和 `get_recent()` 静态方法 |
| `admin_routes.py` | **Modify** (lines 21, 785-786) | 引用从 TaskHistoryDAO 改为 TaskDAO |
| `api_router.py` | **Modify** (lines 14, 87) | 引用从 TaskHistoryDAO.create 改为 TaskDAO.create_task |
| `cluster_main.py` | **Modify** (line 296) | 心跳超时 15→300 |
| `deploy/*.py` | **Copy** | 同步以上所有修改到 deploy 目录 |

---

### Task 1: agent_routes.py — 新增工具函数 + 重写 agent_complete

**Files:**
- Modify: `agent_routes.py`

- [ ] **Step 1: 替换 import 和新增工具函数**

将 `agent_routes.py` 顶部的 import 从：
```python
from dao_task_history import TaskHistoryDAO
```
改为：
```python
from pathlib import Path
from dao_task import TaskDAO
```

在 `_verify_agent_token` 函数之前，新增两个模块级工具函数：

```python
def save_output_file(content: bytes, task_id: str, filename: str, content_type: str) -> dict:
    """Save file to disk, return URL. Zero DB dependency."""
    major = content_type.split("/")[0] if content_type else "other"
    category = {"image": "images", "video": "videos"}.get(major, "others")
    year_month = datetime.now().strftime("%Y%m")
    disk_name = f"{task_id}_{filename}"
    rel_path = f"{category}/{year_month}/{disk_name}"
    full_path = Path("persistent_storage") / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return {"url": f"/storage/{rel_path}", "filename": filename, "size": len(content)}


def build_task_result(file_entries: list, duration: float = 0.0) -> dict:
    """Build standardized result dict from file entries."""
    images, videos = [], []
    for entry in file_entries:
        fname = entry.get("filename", "").lower()
        if any(fname.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".avi")):
            videos.append(entry)
        else:
            images.append(entry)
    return {"images": images, "videos": videos, "output_files": file_entries, "duration": duration}
```

- [ ] **Step 2: 重写 agent_complete 端点**

替换 `agent_routes.py` 第 195-264 行（整个 `agent_complete` 函数）为：

```python
@router.post("/complete")
async def agent_complete(
    task_id: str = Form(...),
    agent_id: str = Form(...),
    status: str = Form("completed"),
    duration: float = Form(0.0),
    error_message: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    authorization: str = Header(...)
):
    await _verify_agent_token(authorization)

    # ---- 1. Save files to disk (no DB) ----
    file_entries = []
    seen_filenames = set()
    for f in files:
        content = await f.read()
        if not content:
            continue
        original_name = f.filename or "output"
        if original_name in seen_filenames:
            continue
        seen_filenames.add(original_name)
        entry = save_output_file(content, task_id, original_name,
                                 f.content_type or "application/octet-stream")
        file_entries.append(entry)

    result = build_task_result(file_entries, duration) if file_entries else None
    logger.info(f"agent_complete: task={task_id}, status={status}, files={len(file_entries)}")

    # ---- 2. Update Redis FIRST (critical path — unblocks frontend) ----
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
        key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
        update_data = {
            "status": status,
            "completed_at": datetime.now().isoformat(),
        }
        if result:
            update_data["result"] = json.dumps(result)
        if error_message:
            update_data["error"] = error_message
        await redis_client.hset(key, mapping=update_data)
        logger.info(f"agent_complete: Redis updated for {task_id}")

        # Publish notification for SSE listeners
        if status == "completed" and result:
            try:
                task_hash = await redis_client.hgetall(key)
                uid = task_hash.get("user_id", "")
                if uid:
                    await redis_client.publish(f"task_complete:{uid}", json.dumps({
                        "task_id": task_id, "status": status, "result": result
                    }))
            except Exception:
                pass
    except Exception as e:
        logger.error(f"CRITICAL: Redis update failed for {task_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update task status in Redis")

    # ---- 3. Update DB best-effort ----
    try:
        await TaskDAO.update_task_status(
            task_id, status,
            result_data=result,
            error_message=error_message or None,
        )
        logger.info(f"agent_complete: DB updated for {task_id}")
    except Exception as e:
        logger.warning(f"DB update failed for {task_id} (non-fatal): {e}")

    return {"success": True, "task_id": task_id, "files_saved": len(file_entries)}
```

- [ ] **Step 3: 修改 agent_poll 中的 TaskHistoryDAO 调用**

`agent_routes.py` 第 138 行：
```python
    await TaskHistoryDAO.update_status(task_id, "processing", agent_id=agent["agent_id"])
```
替换为：
```python
    try:
        await TaskDAO.update_task_status(task_id, "processing", node_id=agent["agent_id"])
    except Exception as e:
        logger.warning(f"DB status update failed for {task_id} (non-fatal): {e}")
```

- [ ] **Step 4: 验证 agent_routes.py 无语法错误**

Run: `python -c "import ast; ast.parse(open('agent_routes.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add agent_routes.py
git commit -m "refactor: simplify agent_complete — Redis-first, remove FileService/TaskHistoryDAO"
```

---

### Task 2: comfyui_main.py — fetch_result 改用 save_output_file

**Files:**
- Modify: `comfyui_main.py` (lines 353-413)

- [ ] **Step 1: 替换 fetch_result 方法**

将 `comfyui_main.py` 第 353-413 行（整个 `fetch_result` 方法）替换为：

```python
    async def fetch_result(self, prompt_id: str, task_id: str):
        """获取任务结果"""
        try:
            history = await self.get_history(prompt_id)

            if not history:
                logger.error(f"无法获取任务 {task_id} 的历史记录")
                task_storage[task_id]['status'] = 'failed'
                task_storage[task_id]['error'] = '无法获取结果'
                return

            outputs = history.get('outputs', {})
            file_entries = []

            for node_id, node_output in outputs.items():
                for image_info in node_output.get('images', []):
                    filename = image_info['filename']
                    subfolder = image_info.get('subfolder', '')
                    data = await self.get_image(filename, subfolder)
                    if data:
                        entry = _save_output_file(data, task_id, filename, "image/png")
                        file_entries.append(entry)

                for video_info in node_output.get('videos', []):
                    filename = video_info['filename']
                    subfolder = video_info.get('subfolder', '')
                    data = await self.get_image(filename, subfolder)
                    if data:
                        entry = _save_output_file(data, task_id, filename, "video/mp4")
                        file_entries.append(entry)

            if file_entries:
                task_storage[task_id]['result'] = _build_task_result(file_entries)
                task_storage[task_id]['result_url'] = file_entries[0]['url']
                logger.info(f"任务 {task_id} 结果已保存: {len(file_entries)} 个文件")
            else:
                task_storage[task_id]['status'] = 'failed'
                task_storage[task_id]['error'] = '未获取到输出文件'

        except Exception as e:
            logger.error(f"获取任务结果时发生错误: {e}")
            task_storage[task_id]['status'] = 'failed'
            task_storage[task_id]['error'] = str(e)
```

- [ ] **Step 2: 在 comfyui_main.py 顶层添加工具函数**

在 `comfyui_main.py` 的 import 区之后、class 定义之前，添加模块级函数（与 agent_routes.py 中逻辑相同，用下划线前缀表示模块私有）：

```python
def _save_output_file(content: bytes, task_id: str, filename: str, content_type: str) -> dict:
    major = content_type.split("/")[0] if content_type else "other"
    category = {"image": "images", "video": "videos"}.get(major, "others")
    year_month = datetime.now().strftime("%Y%m")
    disk_name = f"{task_id}_{filename}"
    rel_path = f"{category}/{year_month}/{disk_name}"
    full_path = Path("persistent_storage") / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return {"url": f"/storage/{rel_path}", "filename": filename, "size": len(content)}


def _build_task_result(file_entries: list, duration: float = 0.0) -> dict:
    images, videos = [], []
    for entry in file_entries:
        fname = entry.get("filename", "").lower()
        if any(fname.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".avi")):
            videos.append(entry)
        else:
            images.append(entry)
    return {"images": images, "videos": videos, "output_files": file_entries, "duration": duration}
```

- [ ] **Step 3: 删除 comfyui_main.py 中的 `from file_service import FileService`**

搜索整个文件，删除所有 `from file_service import FileService` 行。该 import 只在 `fetch_result` 中使用，已被替换。

- [ ] **Step 4: 验证无语法错误**

Run: `python -c "import ast; ast.parse(open('comfyui_main.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add comfyui_main.py
git commit -m "refactor: comfyui_main fetch_result uses save_output_file, removes FileService"
```

---

### Task 3: dao_task.py — 新增统计方法

**Files:**
- Modify: `dao_task.py` (append methods to TaskDAO class)

- [ ] **Step 1: 新增 get_stats 和 get_recent 方法**

在 `dao_task.py` 的 `TaskDAO` class 最后（`cleanup_old_tasks` 方法之后），追加：

```python
    @staticmethod
    async def get_stats() -> Dict[str, Any]:
        """任务统计（替代 TaskHistoryDAO.get_stats）"""
        db = get_db_manager()
        if not db:
            return {"total": 0, "completed": 0, "failed": 0, "queued": 0,
                    "processing": 0, "avg_duration": 0.0, "today_completed": 0}
        row = await db.fetchrow("""
            SELECT
                COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
                COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                COUNT(*) FILTER (WHERE status IN ('pending', 'queued'))::bigint AS queued,
                COUNT(*) FILTER (WHERE status = 'processing')::bigint AS processing,
                AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
                    FILTER (WHERE status = 'completed'
                            AND started_at IS NOT NULL
                            AND completed_at IS NOT NULL) AS avg_duration,
                COUNT(*) FILTER (WHERE status = 'completed'
                                 AND completed_at >= (NOW() - INTERVAL '24 hours'))::bigint AS today_completed
            FROM tasks
        """)
        if not row:
            return {"total": 0, "completed": 0, "failed": 0, "queued": 0,
                    "processing": 0, "avg_duration": 0.0, "today_completed": 0}
        avg = row["avg_duration"]
        return {
            "total": int(row["total"] or 0),
            "completed": int(row["completed"] or 0),
            "failed": int(row["failed"] or 0),
            "queued": int(row["queued"] or 0),
            "processing": int(row["processing"] or 0),
            "avg_duration": float(avg) if avg is not None else 0.0,
            "today_completed": int(row["today_completed"] or 0),
        }

    @staticmethod
    async def get_recent(limit: int = 50) -> List[Dict[str, Any]]:
        """最近任务列表（替代 TaskHistoryDAO.get_recent）"""
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1",
            limit,
        )
```

- [ ] **Step 2: 验证无语法错误**

Run: `python -c "import ast; ast.parse(open('dao_task.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add dao_task.py
git commit -m "feat: add get_stats/get_recent to TaskDAO (replaces TaskHistoryDAO)"
```

---

### Task 4: admin_routes.py — 迁移到 TaskDAO

**Files:**
- Modify: `admin_routes.py` (lines 21, 785-786)

- [ ] **Step 1: 替换 import**

`admin_routes.py` 第 21 行：
```python
from dao_task_history import TaskHistoryDAO
```
替换为：
```python
from dao_task import TaskDAO
```

- [ ] **Step 2: 替换统计调用**

`admin_routes.py` 第 785-786 行：
```python
    queue_stats = await TaskHistoryDAO.get_stats()
    recent = await TaskHistoryDAO.get_recent(20)
```
替换为：
```python
    queue_stats = await TaskDAO.get_stats()
    recent = await TaskDAO.get_recent(20)
```

- [ ] **Step 3: Commit**

```bash
git add admin_routes.py
git commit -m "refactor: admin dashboard uses TaskDAO instead of TaskHistoryDAO"
```

---

### Task 5: api_router.py — 迁移到 TaskDAO

**Files:**
- Modify: `api_router.py` (lines 14, 87)

- [ ] **Step 1: 替换 import**

`api_router.py` 第 14 行：
```python
from dao_task_history import TaskHistoryDAO
```
替换为：
```python
from dao_task import TaskDAO
```

- [ ] **Step 2: 替换任务创建调用**

`api_router.py` 第 87 行：
```python
        await TaskHistoryDAO.create(task_id=task_id, task_type="api_call", params=task_data["data"])
```
替换为：
```python
        await TaskDAO.create_task(task_id=task_id, user_id="system", task_type="api_call", task_data=task_data["data"])
```

注意：`TaskDAO.create_task` 需要 `user_id` 参数。API call 任务使用 `"system"` 作为用户 ID。需确认 `users` 表中有 `system` 用户，如果没有需要用实际的请求用户。检查 `api_router.py` 上下文确认是否有 user_id 可用。

- [ ] **Step 3: Commit**

```bash
git add api_router.py
git commit -m "refactor: api_router uses TaskDAO.create_task instead of TaskHistoryDAO"
```

---

### Task 6: cluster_main.py — 修复心跳超时

**Files:**
- Modify: `cluster_main.py` (line 296)

- [ ] **Step 1: 增加超时时间**

`cluster_main.py` 第 296 行：
```python
                count = await AgentDAO.mark_stale_offline(timeout_seconds=15)
```
替换为：
```python
                count = await AgentDAO.mark_stale_offline(timeout_seconds=300)
```

这允许 Agent 在处理 ComfyUI 任务时有 5 分钟的心跳间隔。

- [ ] **Step 2: Commit**

```bash
git add cluster_main.py
git commit -m "fix: increase agent heartbeat timeout from 15s to 300s"
```

---

### Task 7: 同步到 deploy 目录

**Files:**
- Copy: `agent_routes.py` → `deploy/agent_routes.py`
- Copy: `comfyui_main.py` → `deploy/comfyui_main.py`
- Copy: `dao_task.py` → `deploy/dao_task.py`
- Copy: `admin_routes.py` → `deploy/admin_routes.py`
- Copy: `api_router.py` → `deploy/api_router.py`
- Copy: `cluster_main.py` → `deploy/cluster_main.py`

- [ ] **Step 1: 复制所有修改的文件到 deploy/**

```bash
cp agent_routes.py deploy/agent_routes.py
cp comfyui_main.py deploy/comfyui_main.py
cp dao_task.py deploy/dao_task.py
cp admin_routes.py deploy/admin_routes.py
cp api_router.py deploy/api_router.py
cp cluster_main.py deploy/cluster_main.py
```

- [ ] **Step 2: 验证 deploy 目录文件一致**

```bash
diff agent_routes.py deploy/agent_routes.py
diff comfyui_main.py deploy/comfyui_main.py
diff dao_task.py deploy/dao_task.py
diff admin_routes.py deploy/admin_routes.py
diff api_router.py deploy/api_router.py
diff cluster_main.py deploy/cluster_main.py
```

Expected: 全部无差异

- [ ] **Step 3: Commit**

```bash
git add deploy/
git commit -m "deploy: sync simplified task architecture to deploy folder"
```

---

## 验证清单

部署后验证：

1. **提交任务** — 前端点击"开始生成"，后端日志应显示 `✅ 任务已提交`
2. **Agent 拉取** — GPU Agent 日志应显示任务被拉取
3. **Agent 完成** — API 服务器日志应显示 `agent_complete: Redis updated for {task_id}` 和 `agent_complete: DB updated for {task_id}`
4. **前端接收** — 轮询应在 Agent 完成后的下一个 2 秒周期内看到 `status=completed`，图片 URL 可访问
5. **刷新后恢复** — 刷新页面后，如果 Redis 数据尚在，任务状态仍可查询；Redis 过期后降级到 `tasks` 表查询

## 回滚方案

如果出现问题：
- `file_service.py` 和 `dao_file.py` 和 `dao_task_history.py` 文件未删除，仍在磁盘上
- 回滚只需恢复 git 到前一个 commit：`git revert HEAD~N`
