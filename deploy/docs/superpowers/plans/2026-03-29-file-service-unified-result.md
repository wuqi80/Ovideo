# File Service + 统一任务结果契约 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建统一的文件服务层 (`file_service.py`) 和文件 DAO (`dao_file.py`)，使 Agent 模式和单机模式产出标准化的任务结果格式 (`result.images` / `result.videos`)，解决前端"未找到生成结果"的问题。

**Architecture:** 抽出 `file_service.py` 作为文件注册的唯一入口，它内部使用 `dao_file.py` 操作数据库 `files` 表（已存在于 `database_schema.sql`）。`agent_routes.py` 和 `comfyui_main.py` 都通过 `file_service` 注册输出文件，自动获得标准化的结果对象。前端无需修改。

**Tech Stack:** Python / FastAPI / asyncpg / PostgreSQL (`files` 表) / Redis

---

## 统一结果契约 (Result Contract)

任务完成后，`result` 字段必须符合以下格式（前端已期望此格式）：

```python
{
    "images": [
        {"file_id": "file_abc123", "url": "/storage/images/agent/202603/xxx.png", "filename": "xxx.png", "size": 123456}
    ],
    "videos": [
        {"file_id": "file_def456", "url": "/storage/videos/agent/202603/xxx.mp4", "filename": "xxx.mp4", "size": 789012}
    ],
    "duration": 56.3
}
```

- `images` 和 `videos` 可以为空数组 `[]`，但键必须存在
- 每个条目必须有 `url`（可直接访问的路径），`file_id` 可选但推荐
- 前端 `geminiService.ts:waitForComfyUITaskAllImages` 使用 `result.images[].url` 提取图片

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `dao_file.py` | `files` 表 CRUD |
| 创建 | `file_service.py` | 统一文件注册入口 |
| 修改 | `comfyui_agent.py:276-285` | 修复文件名丢失 bug |
| 修改 | `agent_routes.py:198-282` | 使用 `file_service` + 标准化 result |
| 修改 | `comfyui_main.py:353-417` | 使用 `file_service` + 标准化 result |
| 复制 | `deploy/` | 同步所有改动文件 |

---

### Task 1: 创建 `dao_file.py` — files 表 DAO

**Files:**
- Create: `dao_file.py`

遵循 `dao_task_history.py` 的模式，为 `database_schema.sql` 中已定义的 `files` 表提供 DAO。

- [ ] **Step 1: 创建 `dao_file.py`**

```python
# -*- coding: utf-8 -*-
"""
File DAO -- files 表的增删改查
"""
import json
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


class FileDAO:
    @staticmethod
    def generate_file_id() -> str:
        return f"file_{uuid.uuid4().hex[:12]}"

    @staticmethod
    async def create(
        file_id: str,
        user_id: str,
        file_type: str,
        file_name: str,
        file_path: str,
        file_url: str,
        file_size_bytes: int = 0,
        mime_type: str = "application/octet-stream",
        version_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        query = """
            INSERT INTO files (
                file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            ON CONFLICT (file_id) DO NOTHING
            RETURNING *
        """
        return await db.fetchrow(
            query,
            file_id, version_id, user_id, file_type, file_name,
            file_path, file_url, file_size_bytes, mime_type, meta_json,
        )

    @staticmethod
    async def get_by_id(file_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM files WHERE file_id = $1 AND is_deleted = FALSE",
            file_id,
        )

    @staticmethod
    async def get_by_task_id(task_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """SELECT * FROM files
               WHERE metadata->>'task_id' = $1 AND is_deleted = FALSE
               ORDER BY created_at""",
            task_id,
        )

    @staticmethod
    async def soft_delete(file_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        row = await db.fetchrow(
            """UPDATE files SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE file_id = $1 RETURNING file_id""",
            file_id,
        )
        return row is not None
```

- [ ] **Step 2: 验证 `files` 表已存在**

登录数据库，确认 `files` 表已创建。如果未创建，执行 `database_schema.sql` 中对应的建表语句：

```sql
-- 检查表是否存在
SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'files');
```

如不存在，需执行 `database_schema.sql` 第 62-88 行的建表 + 索引语句。

- [ ] **Step 3: Commit**

```bash
git add dao_file.py
git commit -m "feat: add dao_file.py for files table CRUD"
```

---

### Task 2: 创建 `file_service.py` — 统一文件注册服务

**Files:**
- Create: `file_service.py`

这是所有文件操作的唯一入口。任何需要保存生成文件的地方都调用这个服务。

- [ ] **Step 1: 创建 `file_service.py`**

```python
# -*- coding: utf-8 -*-
"""
Unified file service — single entry point for registering output files.

Usage:
    from file_service import FileService
    result_entry = await FileService.register_output(
        content=raw_bytes,
        original_filename="ComfyUI_00001_.png",
        content_type="image/png",
        task_id="abc-123",
        user_id="admin",
        source="agent_complete",
    )
    # result_entry = {"file_id": "file_xxx", "url": "/storage/...", "filename": "...", "size": 123}
"""
import logging
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dao_file import FileDAO

logger = logging.getLogger(__name__)

STORAGE_ROOT = Path("persistent_storage")

MIME_TO_CATEGORY = {
    "image": "image",
    "video": "video",
    "audio": "audio",
}

MIME_FALLBACK_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "application/octet-stream": ".bin",
}


class FileService:

    @staticmethod
    def _detect_category(content_type: str) -> str:
        """image/png -> 'image', video/mp4 -> 'video', etc."""
        major = content_type.split("/")[0] if content_type else "other"
        return MIME_TO_CATEGORY.get(major, "other")

    @staticmethod
    def _ensure_extension(filename: str, content_type: str) -> str:
        """Ensure filename has a proper extension based on content_type."""
        p = Path(filename)
        if p.suffix and len(p.suffix) <= 5:
            return filename
        ext = MIME_FALLBACK_EXT.get(content_type)
        if not ext:
            ext = mimetypes.guess_extension(content_type) or ".bin"
        return f"{filename}{ext}"

    @staticmethod
    async def register_output(
        content: bytes,
        original_filename: str,
        content_type: str,
        task_id: str,
        user_id: str = "system",
        source: str = "agent_complete",
    ) -> Dict[str, Any]:
        """
        Save a generated file to disk and register it in the database.

        Returns a standardized entry:
            {"file_id": "file_xxx", "url": "/storage/...", "filename": "...", "size": 123}
        """
        category = FileService._detect_category(content_type)
        safe_filename = FileService._ensure_extension(original_filename, content_type)

        year_month = datetime.now().strftime("%Y%m")
        file_id = FileDAO.generate_file_id()
        disk_filename = f"{task_id}_{safe_filename}"

        sub_dir = f"{category}s" if not category.endswith("s") else category
        rel_dir = Path(sub_dir) / source / year_month
        output_dir = STORAGE_ROOT / rel_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        file_path = output_dir / disk_filename
        file_path.write_bytes(content)

        file_url = f"/storage/{rel_dir}/{disk_filename}"

        try:
            await FileDAO.create(
                file_id=file_id,
                user_id=user_id,
                file_type=category,
                file_name=safe_filename,
                file_path=str(file_path),
                file_url=file_url,
                file_size_bytes=len(content),
                mime_type=content_type,
                metadata={"task_id": task_id, "source": source},
            )
        except Exception as e:
            logger.warning(f"Failed to create file DB record (non-fatal): {e}")

        return {
            "file_id": file_id,
            "url": file_url,
            "filename": safe_filename,
            "size": len(content),
        }

    @staticmethod
    def build_result(
        file_entries: List[Dict[str, Any]],
        duration: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Build a standardized task result from a list of file entries.
        Splits into images / videos based on URL extension.
        """
        images = []
        videos = []
        for entry in file_entries:
            fname = entry.get("filename", "").lower()
            if any(fname.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".avi")):
                videos.append(entry)
            else:
                images.append(entry)
        return {
            "images": images,
            "videos": videos,
            "output_files": file_entries,
            "duration": duration,
        }
```

- [ ] **Step 2: Commit**

```bash
git add file_service.py
git commit -m "feat: add file_service.py — unified file registration service"
```

---

### Task 3: 修复 `comfyui_agent.py` — 文件名丢失 bug

**Files:**
- Modify: `comfyui_agent.py:276-285`

**根因**：`_download_comfyui_output` 调用 `_download_file(url)` 时不传 `expected_filename`。URL 是 `http://127.0.0.1:8188/view?filename=ComfyUI_00001_.png&...`，`url.split("/")[-1].split("?")[0]` 解析出来是 `"view"` 而非真实文件名。

- [ ] **Step 1: 修改 `_download_comfyui_output`，传递正确的文件名**

将 `comfyui_agent.py` 第 282 行从：

```python
            return self._download_file(url)
```

改为：

```python
            return self._download_file(url, expected_filename=fname)
```

完整方法改动后：

```python
    def _download_comfyui_output(self, port, file_info):
        fname = file_info.get("filename", "")
        subfolder = file_info.get("subfolder", "")
        ftype = file_info.get("type", "output")
        url = f"http://127.0.0.1:{port}/view?filename={fname}&subfolder={subfolder}&type={ftype}"
        try:
            return self._download_file(url, expected_filename=fname)
        except Exception as e:
            logger.error(f"Failed to download output {fname}: {e}")
            return None
```

- [ ] **Step 2: Commit**

```bash
git add comfyui_agent.py
git commit -m "fix: pass actual filename to _download_file in comfyui_agent"
```

---

### Task 4: 修改 `agent_routes.py` — 使用 file_service + 标准化 result

**Files:**
- Modify: `agent_routes.py:198-282`

这是最关键的改动。将 `agent_complete` 端点从内联文件处理改为使用 `file_service.register_output()`，并产出标准化的 result。

- [ ] **Step 1: 替换 `agent_complete` 函数体**

将 `agent_routes.py` 第 198-282 行的 `agent_complete` 函数替换为：

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

    from file_service import FileService

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

        entry = await FileService.register_output(
            content=content,
            original_filename=original_name,
            content_type=f.content_type or "application/octet-stream",
            task_id=task_id,
            user_id=agent_id,
            source="agent",
        )
        file_entries.append(entry)

    result = FileService.build_result(file_entries, duration)

    await TaskHistoryDAO.update_status(
        task_id, status, agent_id=agent_id,
        result=result, error_message=error_message
    )

    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
        key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
        update_data = {
            "status": status,
            "completed_at": datetime.now().isoformat()
        }
        if file_entries:
            update_data["result"] = json.dumps(result)
        await redis_client.hset(key, mapping=update_data)
        if status == "completed" and file_entries:
            try:
                task_hash = await redis_client.hgetall(key)
                user_id_val = task_hash.get(b"user_id") or task_hash.get("user_id")
                if user_id_val:
                    uid = user_id_val.decode() if isinstance(user_id_val, bytes) else user_id_val
                    await redis_client.publish(f"task_complete:{uid}", json.dumps({
                        "task_id": task_id, "status": status, "result": result
                    }))
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"Failed to update Redis task status: {e}")

    return {"success": True, "task_id": task_id, "files_saved": len(file_entries)}
```

关键改进：
1. 使用 `FileService.register_output()` 替代内联文件处理
2. 使用 `FileService.build_result()` 产出标准化 result（包含 `images` / `videos`）
3. 通过 `seen_filenames` 去重（修复 agent 发送 4 个同名文件的问题）

- [ ] **Step 2: Commit**

```bash
git add agent_routes.py
git commit -m "refactor: agent_complete uses file_service for unified result format"
```

---

### Task 5: 修改 `comfyui_main.py` — 使用 file_service + 标准化 result

**Files:**
- Modify: `comfyui_main.py:353-417`（`fetch_result` 方法）
- Modify: `comfyui_main.py:636-645`（`get_task_status` API 响应）

将单机模式的结果也统一为标准格式。

- [ ] **Step 1: 修改 `fetch_result` 方法**

将 `comfyui_main.py` 第 353-417 行的 `fetch_result` 方法替换为：

```python
    async def fetch_result(self, prompt_id: str, task_id: str):
        """获取任务结果"""
        try:
            from file_service import FileService

            history = await self.get_history(prompt_id)

            if not history:
                logger.error(f"无法获取任务 {task_id} 的历史记录")
                task_storage[task_id]['status'] = 'failed'
                task_storage[task_id]['error'] = '无法获取结果'
                return

            outputs = history.get('outputs', {})
            file_entries = []
            user_id = task_storage[task_id].get('user', 'system')

            for node_id, node_output in outputs.items():
                for image_info in node_output.get('images', []):
                    filename = image_info['filename']
                    subfolder = image_info.get('subfolder', '')
                    data = await self.get_image(filename, subfolder)
                    if data:
                        entry = await FileService.register_output(
                            content=data,
                            original_filename=filename,
                            content_type="image/png",
                            task_id=task_id,
                            user_id=user_id,
                            source="comfyui_local",
                        )
                        file_entries.append(entry)

                for video_info in node_output.get('videos', []):
                    filename = video_info['filename']
                    subfolder = video_info.get('subfolder', '')
                    data = await self.get_image(filename, subfolder)
                    if data:
                        entry = await FileService.register_output(
                            content=data,
                            original_filename=filename,
                            content_type="video/mp4",
                            task_id=task_id,
                            user_id=user_id,
                            source="comfyui_local",
                        )
                        file_entries.append(entry)

            if file_entries:
                task_storage[task_id]['result'] = FileService.build_result(file_entries)
                first_url = file_entries[0]['url']
                task_storage[task_id]['result_url'] = first_url
                logger.info(f"任务 {task_id} 结果已保存: {len(file_entries)} 个文件")
            else:
                task_storage[task_id]['status'] = 'failed'
                task_storage[task_id]['error'] = '未获取到输出文件'

        except Exception as e:
            logger.error(f"获取任务结果时发生错误: {e}")
            task_storage[task_id]['status'] = 'failed'
            task_storage[task_id]['error'] = str(e)
```

- [ ] **Step 2: 修改 `get_task_status` 响应**

将 `comfyui_main.py` 第 636-645 行改为：

```python
    return {
        "task_id": task['task_id'],
        "status": task['status'],
        "progress": task['progress'],
        "message": task['message'],
        "result_url": task.get('result_url'),
        "result": task.get('result'),
        "error": task.get('error'),
        "created_at": task['created_at'].isoformat(),
        "updated_at": task['updated_at'].isoformat()
    }
```

仅添加了 `"result": task.get('result')` 一行，让前端能读到标准化的 `result.images`。

- [ ] **Step 3: Commit**

```bash
git add comfyui_main.py
git commit -m "refactor: comfyui_main uses file_service for unified result format"
```

---

### Task 6: 同步到 deploy/ 目录

**Files:**
- Copy: `dao_file.py` → `deploy/dao_file.py`
- Copy: `file_service.py` → `deploy/file_service.py`
- Copy: `agent_routes.py` → `deploy/agent_routes.py`
- Copy: `comfyui_agent.py` → `deploy/comfyui_agent.py`
- Copy: `comfyui_main.py` → `deploy/comfyui_main.py`

- [ ] **Step 1: 复制所有改动文件到 deploy/**

```bash
cp dao_file.py deploy/dao_file.py
cp file_service.py deploy/file_service.py
cp agent_routes.py deploy/agent_routes.py
cp comfyui_agent.py deploy/comfyui_agent.py
cp comfyui_main.py deploy/comfyui_main.py
```

- [ ] **Step 2: Commit**

```bash
git add deploy/
git commit -m "deploy: sync file_service and unified result changes"
```

---

### Task 7: 部署验证清单

- [ ] **Step 1: 确认 `files` 表存在**

在 API 服务器的 PostgreSQL 中运行：

```sql
SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'files');
```

如果返回 `false`，执行 `database_schema.sql` 中第 62-88 行的建表语句。

- [ ] **Step 2: 部署 API 服务器**

将以下文件部署到 API 服务器并重启：
- `deploy/dao_file.py`
- `deploy/file_service.py`
- `deploy/agent_routes.py`
- `deploy/comfyui_main.py`

- [ ] **Step 3: 部署 GPU Agent**

将以下文件部署到 GPU 服务器：
- `deploy/comfyui_agent.py`

重启 agent 进程。

- [ ] **Step 4: 端到端验证**

1. 打开前端，触发一个分镜生成任务
2. 观察后端日志：
   - 应看到 `file_service` 注册文件的日志（非 `Failed to create file record: No module named 'dao_file'`）
   - Agent 上传的文件应有正确的扩展名（如 `.png` 而非无扩展名的 `view`）
3. 观察前端：
   - 任务完成后应正确显示生成的图片
   - 控制台中 `📦 获取到 N 张图片` 的 N 应 > 0
4. 验证数据库：
   ```sql
   SELECT file_id, file_name, file_url, file_type FROM files ORDER BY created_at DESC LIMIT 5;
   ```
   应能看到新注册的文件记录

---

## 变更影响总结

| 文件 | 变更类型 | 影响范围 |
|------|----------|----------|
| `dao_file.py` | 新建 | 无（新模块） |
| `file_service.py` | 新建 | 无（新模块） |
| `comfyui_agent.py` | 1 行修改 | GPU Agent 端，修复文件名 |
| `agent_routes.py` | `agent_complete` 函数重写 | API 服务器，Agent 完成任务的唯一入口 |
| `comfyui_main.py` | `fetch_result` 重写 + 响应加 `result` 字段 | 单机模式（如在用） |
| 前端 | **无修改** | — |
