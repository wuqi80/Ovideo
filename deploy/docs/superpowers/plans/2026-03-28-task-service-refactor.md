# TaskService 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 创建 `task_service.py` 模块，将 `cluster_main.py` 中 12 处任务提交的重复样板代码和 9 处队列查询调用收拢为统一服务，同时修复 AGENT_ONLY_MODE 下 `task_queue` 为 None 的 bug。

**Architecture:** 新建 `task_service.py` 作为任务提交和队列操作的唯一入口。`TaskService` 类封装 `TaskQueue` 初始化、`prepare_task_for_agent` 工作流准备、以及 `Task` 对象创建与入队。所有端点通过 `task_service.get().submit()` 提交任务，通过 `task_service.get_queue()` 访问队列查询功能。在 `cluster_main.py` 的 startup 中，Redis 连接成功后立即调用 `task_service.init(redis_client)`（在 `AGENT_ONLY_MODE` 判断之前），确保任何运行模式下队列都可用。

**Tech Stack:** Python 3.9+, FastAPI, Redis (aioredis), 现有 `task_queue.py` 中的 `TaskQueue` 和 `Task` 类

---

## File Map

**Create:**
- `task_service.py` — 任务提交服务模块（单例模式 + submit + prepare_for_agent）

**Modify:**
- `cluster_main.py` — 删除 `prepare_task_for_agent` 函数，删除 `task_queue` 全局变量，替换 12 个端点的样板代码和 9 处队列调用

**Copy (deploy sync):**
- `deploy/task_service.py` — 新文件复制
- `deploy/cluster_main.py` — 同步修改

---

## Task 1: 创建 task_service.py 模块

**Files:**
- Create: `task_service.py`

- [x] **Step 1: 创建 task_service.py 基础结构**

```python
"""
任务提交服务 — 统一封装任务准备、创建、入队
所有运行模式下都初始化（包括 AGENT_ONLY_MODE）
"""
import uuid
import logging
from typing import Optional
from datetime import datetime

from fastapi import HTTPException

from task_queue import TaskQueue, Task
from cluster_config import RedisConfig

logger = logging.getLogger(__name__)

_service: Optional['TaskService'] = None


def init(redis_client):
    """应用启动时调用，Redis 连接后、AGENT_ONLY_MODE 判断前"""
    global _service
    _service = TaskService(redis_client)
    logger.info("✅ TaskService 已初始化")


def get() -> 'TaskService':
    """获取 TaskService 单例，未初始化时抛出明确错误"""
    if _service is None:
        raise RuntimeError("TaskService 未初始化，请先调用 task_service.init(redis_client)")
    return _service


def get_queue() -> TaskQueue:
    """快捷方式：获取底层 TaskQueue（用于 get_task / cancel / delete 等查询操作）"""
    return get().queue


class TaskService:
    def __init__(self, redis_client):
        self.queue = TaskQueue(redis_client)
        self.redis = redis_client

    async def submit(
        self,
        task_type: str,
        task_data: dict,
        user_id: str,
        priority: int = 2,
        prepare: bool = True,
    ) -> str:
        """
        提交任务到队列，返回 task_id。

        Args:
            task_type: 工作流类型，如 "qwen_2", "i2i_fj", "panorama_360" 等
            task_data: 任务参数字典（图片路径、提示词、种子等）
            user_id:   触发用户
            priority:  优先级（默认 2）
            prepare:   是否调用 _prepare_for_agent 构建工作流 JSON 和文件下载列表
        """
        task_id = str(uuid.uuid4())

        if prepare:
            await self._prepare_for_agent(task_type, task_data, user_id)

        task = Task(
            task_id=task_id,
            task_type=task_type,
            data=task_data,
            priority=priority,
            user_id=user_id,
        )

        success = await self.queue.enqueue(task)
        if not success:
            raise HTTPException(status_code=500, detail="任务入队失败")

        logger.info(f"✅ 任务已提交: {task_id} (type={task_type}, user={user_id})")
        return task_id

    async def _prepare_for_agent(self, task_type: str, task_data: dict, username: str):
        """
        Pre-build workflow JSON and resolve agent file download URLs.
        搬自 cluster_main.py 的 prepare_task_for_agent 函数。
        """
        try:
            from workflow_handler import get_workflow_handler

            if "image_path" in task_data:
                task_data["uploaded_image"] = task_data["image_path"]
            if "image_path_end" in task_data:
                task_data["uploaded_image_end"] = task_data["image_path_end"]
            for i in range(1, 7):
                src = f"image_path_{i}"
                if src in task_data:
                    task_data[f"uploaded_image_{i}"] = task_data[src]
            for suffix in ("BK", "HU", "MB"):
                src = f"image_{suffix}"
                if src in task_data:
                    task_data[f"uploaded_image_{suffix}"] = task_data[src]

            wh = get_workflow_handler()
            workflow_json = wh.build_workflow_for_task(task_type, task_data)
            task_data["workflow_json"] = workflow_json

            agent_files = []
            file_params = (
                ["image_path", "image_path_end", "video_filename", "audio_filename"]
                + [f"image_path_{i}" for i in range(1, 7)]
                + [f"image_{s}" for s in ("BK", "HU", "MB")]
            )
            for param in file_params:
                filename = task_data.get(param)
                if not filename or not isinstance(filename, str) or not filename.strip():
                    continue
                download_url = None
                if self.redis:
                    try:
                        file_id = await self.redis.get(f"comfyui:file:{filename}")
                        if file_id:
                            if isinstance(file_id, bytes):
                                file_id = file_id.decode()
                            download_url = f"/api/files/{file_id}/download"
                    except Exception:
                        pass
                if not download_url:
                    year_month = datetime.now().strftime('%Y%m')
                    download_url = f"/storage/image/{username}/{year_month}/{filename}"
                agent_files.append({"param": param, "filename": filename, "url": download_url})

            task_data["agent_files"] = agent_files
            logger.info(f"✅ Pre-built workflow for {task_type}, {len(agent_files)} agent files")
        except Exception as e:
            logger.warning(f"⚠️ prepare_task_for_agent failed for {task_type}: {e}")
```

- [x] **Step 2: 验证文件可导入**

Run: `python -c "import task_service; print('OK')"`
Expected: `OK`（无导入错误）

---

## Task 2: cluster_main.py — 启动函数修改

**Files:**
- Modify: `cluster_main.py:189-240`（startup 函数）
- Modify: `cluster_main.py:415`（全局变量声明）
- Modify: `cluster_main.py:686-736`（删除 prepare_task_for_agent）

- [x] **Step 1: 在 startup 函数中添加 TaskService 初始化**

在 `cluster_main.py` 的 `set_api_router_redis(redis_client)` 之后、`if not SystemConfig.AGENT_ONLY_MODE:` 之前，添加：

```python
    # ✅ 始终初始化 TaskService（Agent 模式下 agent 通过 Redis 队列拉取任务）
    import task_service
    task_service.init(redis_client)
```

位置：L189 行 `set_api_router_redis(redis_client)` 之后。

- [x] **Step 2: 删除全局变量 task_queue**

删除 `cluster_main.py` L415 行：
```python
task_queue: Optional[TaskQueue] = None
```

- [x] **Step 3: 删除 if 块内的 task_queue 初始化**

删除 `cluster_main.py` L207-210 行（在 `if not SystemConfig.AGENT_ONLY_MODE:` 块内）：
```python
        # 初始化任务队列
        logger.info("初始化任务队列...")
        task_queue = TaskQueue(redis_client)
        logger.info("✅ 任务队列已初始化")
```

注意：Worker 初始化也使用了 `task_queue` 参数（L221），需要改为 `task_service.get_queue()`：
```python
            worker = Worker(
                worker_id,
                redis_client,
                image_cluster_manager,
                task_service.get_queue(),  # 改为从 TaskService 获取
                video_cluster_manager=video_cluster_manager
            )
```

- [x] **Step 4: 删除 prepare_task_for_agent 函数**

删除 `cluster_main.py` L686-736 行的 `prepare_task_for_agent` 函数（已搬入 `task_service.py`）。

- [x] **Step 5: 删除不再需要的 import**

`cluster_main.py` 顶部的 `from task_queue import TaskQueue, Task` 中 `Task` 不再需要（但 `TaskQueue` 可能仍被 Worker 类型注解使用，检查后决定是否保留）。确保添加 `import task_service`。

---

## Task 3: cluster_main.py — 12 个提交端点重构

**Files:**
- Modify: `cluster_main.py`

每个端点的改造模式相同：删除 `task_id = str(uuid.uuid4())` + `await prepare_task_for_agent(...)` + `task = Task(...)` + `success = await task_queue.enqueue(task)` + `if not success:` 这段代码，替换为单行 `task_id = await task_service.get().submit(...)`。

### 端点 1: `/api/generate`（L1366-1405）— 通用生成

**特殊**：使用 `request.model_dump()` 作为 data，使用 `request.priority`，不调用 prepare。还查询 queue_length。

改前（L1370-1391）：
```python
        task_id = str(uuid.uuid4())
        task = Task(
            task_id=task_id,
            task_type=request.task_type,
            data=request.model_dump(),
            priority=request.priority,
            user_id=username
        )
        success = await task_queue.enqueue(task)
        if not success:
            raise HTTPException(status_code=500, detail="任务入队失败")
        logger.info(f"用户 {username} 创建任务 {task_id}")
        queue_length = await task_queue.get_queue_length()
```

改后：
```python
        task_id = await task_service.get().submit(
            request.task_type, request.model_dump(), username,
            priority=request.priority, prepare=False
        )
        logger.info(f"用户 {username} 创建任务 {task_id}")
        queue_length = await task_service.get_queue().get_queue_length()
```

---

### 端点 2: `/api/generate/image`（L3916-3982）— ComfyUI i2i_fj

改前（L3940-3965）：
```python
            task_id = str(uuid.uuid4())
            task_data = { ... }
            await prepare_task_for_agent("i2i_fj", task_data, username)
            task = Task(task_id=task_id, task_type="i2i_fj", data=task_data, priority=2, user_id=username)
            success = await task_queue.enqueue(task)
            if not success: ...
```

改后：
```python
            task_data = {
                "image": request.ref_images[0],
                "ref_images": request.ref_images[1:6],
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt or "bad quality, worst quality",
                "seed": request.seed,
                "strength": request.strength
            }
            task_id = await task_service.get().submit("i2i_fj", task_data, username)
```

---

### 端点 3: `/api/generate/comfyui-workflow`（L3991-4063）— qwen/kontext 工作流

改前（L4017-4050）：
```python
        task_id = str(uuid.uuid4())
        task_data = { ... }
        await prepare_task_for_agent(actual_workflow_type, task_data, username)
        task = Task(...)
        success = await task_queue.enqueue(task)
        if not success: ...
```

改后：
```python
        task_data = {
            "prompt": request.prompt,
            "seed": request.seed
        }
        # ... image_path 赋值逻辑不变 ...
        task_id = await task_service.get().submit(actual_workflow_type, task_data, username)
```

---

### 端点 4: `/api/generate/angle-adjust`（L4065-4113）

改前（L4082-4104）：14 行样板
改后：
```python
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        task_id = await task_service.get().submit("i2i_fj", task_data, username)
```

---

### 端点 5: `/api/generate/human-multiangle`（L4118-4167）

改后：
```python
        task_data = {
            "image_path": request.image_filename,
            "seed": request.seed
        }
        task_id = await task_service.get().submit("i2i_human", task_data, username)
```

---

### 端点 6: `/api/generate/around-view`（L4170-4217）

改后：
```python
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        task_id = await task_service.get().submit("i2i_around", task_data, username)
```

---

### 端点 7: `/api/generate/matting`（L4223-4273）

改后：
```python
        task_data = {
            "image_path": request.image_filename,
            "seed": request.seed
        }
        task_id = await task_service.get().submit(task_type, task_data, username)
```

---

### 端点 8: `/api/generate/fusion`（L4288-4343）

改后：
```python
        # ... task_data 构造逻辑不变（根据 fusion_type 决定内容）...
        task_id = await task_service.get().submit(task_type, task_data, username)
```

---

### 端点 9: `/api/generate/panorama-360`（L4356-4399）

改后：
```python
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        task_id = await task_service.get().submit("panorama_360", task_data, username)
```

---

### 端点 10: `/api/generate/panorama-fusion`（L4413-4474）

改后：
```python
        # ... task_data 构造逻辑不变（根据 image_2 是否存在选择 task_type）...
        task_id = await task_service.get().submit(task_type, task_data, username)
```

---

### 端点 11: `/api/generate/auto-storyboard`（L4475-4525）

改后：
```python
        task_data = {
            "image_path": request.image_filename,
            "prompt": request.prompt,
            "seed": request.seed
        }
        task_id = await task_service.get().submit("auto_storyboard", task_data, username)
```

---

### 端点 12: `/api/materials/process`（L4647-4705）— 素材处理

**特殊**：不调用 prepare_task_for_agent，有自定义 seed 逻辑（不同工作流用不同种子格式）。

改前（L4661-4682）：
```python
        task_id = str(uuid.uuid4())
        if request.workflow_type == 'upscale_hd':
            seed = random.randint(100000, 999999)
            seed_key = 'seed_0'
        else:
            seed = random.randint(100000000000000, 999999999999999)
            seed_key = 'seed'
        task = Task(task_id=task_id, task_type=request.workflow_type,
                    data={"image_path": request.image_filename, seed_key: seed},
                    priority=2, user_id=username)
        success = await task_queue.enqueue(task)
        if not success: ...
```

改后：
```python
        if request.workflow_type == 'upscale_hd':
            seed = random.randint(100000, 999999)
            seed_key = 'seed_0'
        else:
            seed = random.randint(100000000000000, 999999999999999)
            seed_key = 'seed'
        task_data = {"image_path": request.image_filename, seed_key: seed}
        task_id = await task_service.get().submit(
            request.workflow_type, task_data, username, prepare=False
        )
```

---

## Task 4: cluster_main.py — 9 处队列查询调用替换

**Files:**
- Modify: `cluster_main.py`

将所有 `task_queue.xxx()` 调用替换为 `task_service.get_queue().xxx()`。

| 行号 | 原代码 | 替换为 |
|------|--------|--------|
| L1391 | `await task_queue.get_queue_length()` | `await task_service.get_queue().get_queue_length()` |
| L1410 | `await task_queue.get_task(task_id)` | `await task_service.get_queue().get_task(task_id)` |
| L1457 | `await task_queue.cancel_task(task_id)` | `await task_service.get_queue().cancel_task(task_id)` |
| L1474 | `await task_queue.get_task(task_id)` | `await task_service.get_queue().get_task(task_id)` |
| L1602 | `await task_queue.delete_task(task_id)` | `await task_service.get_queue().delete_task(task_id)` |
| L1788 | `await task_queue.get_task(tid)` | `await task_service.get_queue().get_task(tid)` |
| L1865 | `await task_queue.get_user_tasks(...)` | `await task_service.get_queue().get_user_tasks(...)` |
| L1900 | `await task_queue.get_queue_length()` | `await task_service.get_queue().get_queue_length()` |
| L1901 | `await task_queue.get_processing_count()` | `await task_service.get_queue().get_processing_count()` |

- [x] **Step 1: 在文件顶部添加 import**

确保 `cluster_main.py` 顶部有：
```python
import task_service
```

- [x] **Step 2: 逐一替换 9 处调用**

使用全局替换 `task_queue.` → `task_service.get_queue().`（注意：只替换还未被 Task 3 处理的行）。

- [x] **Step 3: 确认无残留引用**

搜索 `cluster_main.py` 中是否还有 `task_queue` 的引用。应该只剩：
- 已删除的全局变量声明（L415）
- Worker 初始化已在 Task 2 Step 3 中改为 `task_service.get_queue()`

---

## Task 5: Deploy 同步

**Files:**
- Copy: `task_service.py` → `deploy/task_service.py`
- Sync: `cluster_main.py` → `deploy/cluster_main.py`

- [x] **Step 1: 复制新文件**

```bash
cp task_service.py deploy/task_service.py
```

- [x] **Step 2: 同步 cluster_main.py**

```bash
cp cluster_main.py deploy/cluster_main.py
```

- [x] **Step 3: 验证 deploy 目录中 import 可用**

```bash
cd deploy && python -c "import task_service; print('OK')"
```

---

## 变更总结

| 指标 | 改前 | 改后 |
|------|------|------|
| 样板代码行数 | 12 × 14 行 = ~168 行 | 12 × 1 行 = 12 行 |
| 全局变量 | `task_queue: Optional[TaskQueue] = None` | 无（由 TaskService 管理） |
| AGENT_ONLY_MODE | task_queue = None → 报错 | TaskService 始终初始化 → 正常工作 |
| prepare_task_for_agent 位置 | cluster_main.py 全局函数，依赖全局 redis_client | TaskService 方法，使用 self.redis |
| 新增任务端点时 | 复制 14 行样板 | 1 行 submit() 调用 |
