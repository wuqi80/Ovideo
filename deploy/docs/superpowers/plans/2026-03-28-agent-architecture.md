# Agent-Only Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all ComfyUI task execution from Cluster direct-HTTP to Agent pull model, enabling cross-cloud GPU deployment.

**Architecture:** Server pre-builds workflow JSON + stores files locally. Agent polls, downloads files, uploads to local ComfyUI, submits pre-built workflow. Filename consistency ensures zero replacement needed.

**Tech Stack:** Python/FastAPI (backend), Redis (queue), PostgreSQL (file records), JavaScript (admin UI)

**Spec:** `docs/superpowers/specs/2026-03-28-agent-architecture-design.md`

---

### Task 1: Upload Path — Local Storage First

**Files:**
- Modify: `cluster_main.py:1886-2083` (function `comfyui_upload_proxy`)

The upload handler currently raises 503 when no ComfyUI node is available. Change to save locally first, then optionally upload to ComfyUI.

- [ ] **Step 1: Restructure upload flow — local storage becomes primary**

In `cluster_main.py`, function `comfyui_upload_proxy` (line 1886), restructure the logic:

```python
# BEFORE (line 1918-1951): Select ComfyUI node FIRST, fail if none
# AFTER: Save locally FIRST, then try ComfyUI optionally

@app.post("/api/comfyui/upload")
async def comfyui_upload_proxy(
    image: UploadFile = File(...),
    node_type: Optional[str] = Form(None),
    comfyui_server: Optional[str] = None,
    username: str = Depends(require_auth)
):
    try:
        file_content = await image.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="上传的是空文件")

        orig_filename = image.filename or "upload.png"
        file_ext = os.path.splitext(orig_filename)[1] or ".png"
        logical_id = uuid.uuid4().hex[:12]
        unique_filename = f"{logical_id}_{orig_filename}"

        logger.info(f"[ComfyUpload] 用户={username}, 原文件={orig_filename}, "
                     f"逻辑名={unique_filename}, 大小={len(file_content)} 字节")

        # === PRIMARY: Save to persistent_storage ===
        year_month = datetime.now().strftime('%Y%m')
        storage_dir = Path('persistent_storage/image') / username / year_month
        storage_dir.mkdir(parents=True, exist_ok=True)
        local_path = storage_dir / unique_filename
        local_path.write_bytes(file_content)
        local_file_path = str(local_path)
        local_storage_url = f"/storage/image/{username}/{year_month}/{unique_filename}"
        logger.info(f"💾 图片已保存: {local_path}")

        # === OPTIONAL: Upload to ComfyUI if node available ===
        comfyui_filename = unique_filename  # Default to our unique name
        target_server = None
        node_id = None

        try:
            if comfyui_server:
                target_server = comfyui_server.rstrip("/")
            elif cluster_manager or video_cluster_manager or image_cluster_manager:
                selected_cm = (video_cluster_manager if node_type == 'video'
                              else image_cluster_manager if node_type == 'image'
                              else cluster_manager)
                node = selected_cm.get_available_node() if selected_cm else None
                if node:
                    target_server = node.base_url.rstrip("/")
                    node_id = node.id

            if target_server:
                upload_url = f"{target_server}/upload/image"
                files = {"image": (unique_filename, file_content, image.content_type or "image/png")}
                resp = requests.post(upload_url, files=files, data={"overwrite": "true"}, timeout=30)
                if resp.ok:
                    rj = resp.json() if resp.text else {}
                    comfyui_filename = rj.get("name", unique_filename) if isinstance(rj, dict) else unique_filename
                    logger.info(f"✅ 也上传到ComfyUI: {comfyui_filename} @ {target_server}")
                else:
                    logger.warning(f"⚠️ ComfyUI上传失败({resp.status_code})，已有本地存储，继续")
            else:
                logger.info(f"ℹ️ 无可用ComfyUI节点，仅使用本地存储")
        except Exception as e:
            logger.warning(f"⚠️ ComfyUI上传异常: {e}，已有本地存储，继续")

        # === Create file record ===
        # ... (existing project/version logic lines 2006-2029 unchanged) ...

        file_id = f"file_{uuid.uuid4().hex[:12]}"
        storage_url = f"/api/files/{file_id}/download"

        file_record = await FileDAO.create_file(
            version_id=version_id, user_id=username,
            file_type="image", file_name=orig_filename,
            file_path=local_file_path,
            file_url=local_storage_url,
            file_size_bytes=len(file_content),
            mime_type=image.content_type or "image/*",
            metadata={
                "source": "comfyui_upload",
                "logical_id": logical_id,
                "comfyui_filename": comfyui_filename,
                "comfyui_server": target_server,
                "comfyui_node_id": node_id,
                "uploaded_at": datetime.utcnow().isoformat()
            },
            file_id=file_id
        )

        # === Cache filename -> file_id in Redis for agent downloads ===
        if redis_client:
            try:
                await redis_client.set(
                    f"comfyui:file:{comfyui_filename}", file_id, ex=86400
                )
            except Exception:
                pass

        return {
            "success": True,
            "filename": comfyui_filename,
            "original_filename": orig_filename,
            "size": len(file_content),
            "storage_url": storage_url,
            "file_id": file_record["file_id"],
            "file_path": f"comfyui://{node_id or 'default'}/{comfyui_filename}",
            "comfyui_server": target_server,
            "comfyui_node_id": node_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 图片上传失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")
```

- [ ] **Step 2: Verify upload works without ComfyUI node**

Test: stop all ComfyUI instances, call upload endpoint, confirm file saved and 200 returned.

- [ ] **Step 3: Commit**

```bash
git add cluster_main.py
git commit -m "feat: upload saves to local storage first, ComfyUI optional"
```

---

### Task 2: Workflow Pre-build Helper

**Files:**
- Modify: `cluster_main.py` (add helper function near top, before routes)

Create a helper that pre-builds workflow JSON and resolves agent file URLs, mimicking what the Worker does before calling workflow_handler.

- [ ] **Step 1: Add `prepare_task_for_agent` helper function**

Add this function in `cluster_main.py` after imports/init, before routes:

```python
async def prepare_task_for_agent(task_type: str, task_data: dict, username: str):
    """
    Pre-build workflow JSON and resolve agent file download URLs.
    Mimics Worker's pre-upload mapping + workflow_handler call.
    """
    from workflow_handler import get_workflow_handler

    # Step 1: Map image_path -> uploaded_image (Worker mapping)
    if "image_path" in task_data:
        task_data["uploaded_image"] = task_data["image_path"]
    if "image_path_end" in task_data:
        task_data["uploaded_image_end"] = task_data["image_path_end"]
    for i in range(1, 7):
        src = f"image_path_{i}"
        if src in task_data:
            task_data[f"uploaded_image_{i}"] = task_data[src]
    # Fusion images
    for suffix in ("BK", "HU", "MB"):
        src = f"image_{suffix}"
        if src in task_data:
            task_data[f"uploaded_image_{suffix}"] = task_data[src]

    # Step 2: Build workflow JSON
    try:
        wh = get_workflow_handler()
        workflow_json = wh.build_workflow_for_task(task_type, task_data)
        task_data["workflow_json"] = workflow_json
    except Exception as e:
        logger.warning(f"Pre-build workflow failed for {task_type}: {e}")
        # Don't fail — Worker can still build if running

    # Step 3: Resolve file download URLs for agent
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
        # Try Redis cache first
        if redis_client:
            try:
                file_id = await redis_client.get(f"comfyui:file:{filename}")
                if file_id:
                    if isinstance(file_id, bytes):
                        file_id = file_id.decode()
                    download_url = f"/api/files/{file_id}/download"
            except Exception:
                pass

        if not download_url:
            # Fallback: construct /storage/ URL (may not have auth)
            year_month = datetime.now().strftime('%Y%m')
            download_url = f"/storage/image/{username}/{year_month}/{filename}"

        agent_files.append({
            "param": param,
            "filename": filename,
            "url": download_url,
        })

    task_data["agent_files"] = agent_files
    return task_data
```

- [ ] **Step 2: Commit**

```bash
git add cluster_main.py
git commit -m "feat: add prepare_task_for_agent helper for workflow pre-build"
```

---

### Task 3: Apply Pre-build to Generate Endpoints

**Files:**
- Modify: `cluster_main.py:3942-4012` (`generate_comfyui_workflow`) + 10 other generate endpoints

Add `await prepare_task_for_agent(...)` call before `task_queue.enqueue(task)` in each generate endpoint.

- [ ] **Step 1: Update `generate_comfyui_workflow` (line 3942)**

Insert before `task = Task(...)` (line 3986):

```python
        # Pre-build workflow for agent execution
        await prepare_task_for_agent(actual_workflow_type, task_data, username)
        
        task = Task(
            task_id=task_id,
            task_type=actual_workflow_type,
            data=task_data,
            priority=2,
            user_id=username
        )
```

- [ ] **Step 2: Update all other generate endpoints**

Apply the same pattern to each endpoint. Insert `await prepare_task_for_agent(task_type, task_data, username)` before `Task(...)` construction:

1. `generate_comfyui_workflow` (L3986) — task_type = `actual_workflow_type`
2. `adjust_image_angle` (L4033) — task_type = `"i2i_fj"`
3. `generate_human_multi_angle` (L4082) — task_type = `"i2i_human"`
4. `generate_around_angle` (~L4117) — task_type = `"i2i_around"`
5. `generate_matting` (~L4168) — task_type from request
6. `generate_image_fusion` (~L4223) — task_type from request
7. `generate_panorama_360` (~L4295) — task_type = `"panorama_360"`
8. `generate_panorama_fusion` (~L4345) — task_type from request
9. `generate_auto_storyboard` (~L4411) — task_type = `"auto_storyboard"`
10. `generate_multi_grid_storyboard` (~L4459) — check specific type
11. `generate_image` (L3870) — i2v/morph task types

For each, the pattern is identical:
```python
        task_data = { ... }  # existing
        await prepare_task_for_agent(task_type_str, task_data, username)  # ADD THIS
        task = Task(task_id=..., task_type=..., data=task_data, ...)  # existing
```

- [ ] **Step 3: Commit**

```bash
git add cluster_main.py
git commit -m "feat: pre-build workflow in all generate endpoints for agent consumption"
```

---

### Task 4: Agent Poll — Handle Both Queue Formats

**Files:**
- Modify: `agent_routes.py:72-127` (function `agent_poll`)

The ZSET has two member formats: TaskQueue pushes `task_id` strings, SmartApiRouter pushes full JSON. Agent poll must handle both.

- [ ] **Step 1: Rewrite agent_poll to handle dual format**

Replace lines 87-127 in `agent_routes.py`:

```python
    # Pop lowest-score item from ZSET
    members = await redis_client.zpopmin(RedisConfig.TASK_QUEUE_KEY)
    if not members:
        return {"task": None}

    raw_member = members[0][0] if isinstance(members[0], (list, tuple)) else members[0]
    if isinstance(raw_member, bytes):
        raw_member = raw_member.decode()
    if not raw_member:
        return {"task": None}

    # Detect format: JSON object (api_call from SmartApiRouter) vs task_id string (TaskQueue)
    task_info = None
    try:
        parsed = json.loads(raw_member)
        if isinstance(parsed, dict) and "task_id" in parsed:
            # SmartApiRouter format: full JSON task
            task_info = parsed
    except (json.JSONDecodeError, TypeError):
        pass

    if task_info is None:
        # TaskQueue format: raw_member is a task_id, load from Redis hash
        task_id = raw_member
        task_hash_key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
        task_hash = await redis_client.hgetall(task_hash_key)
        if not task_hash:
            logger.warning(f"Task {task_id} not found in Redis hash, skipping")
            return {"task": None}
        # Decode bytes keys/values
        decoded = {}
        for k, v in task_hash.items():
            dk = k.decode() if isinstance(k, bytes) else k
            dv = v.decode() if isinstance(v, bytes) else v
            decoded[dk] = dv
        data = json.loads(decoded.get("data", "{}"))
        task_info = {
            "task_id": task_id,
            "task_type": decoded.get("task_type", "comfyui"),
            "data": data,
        }

    task_id = task_info["task_id"]
    data = task_info.get("data", {})

    # Update task status
    await TaskHistoryDAO.update_status(task_id, "processing", agent_id=agent["agent_id"])
    key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
    await redis_client.hset(key, mapping={
        "status": "processing",
        "node_id": agent["agent_id"],
        "started_at": datetime.now().isoformat()
    })

    # Build file download list from agent_files (pre-built) or legacy params
    files_to_download = []
    if "agent_files" in data:
        for af in data["agent_files"]:
            files_to_download.append({
                "param": af["param"],
                "filename": af.get("filename", ""),
                "url": af["url"],
            })
    else:
        # Legacy: scan for URL-like params
        for param_key in ("image", "image_end", "video"):
            val = data.get(param_key)
            if val and isinstance(val, str) and (val.startswith("http") or val.startswith("/")):
                files_to_download.append({"param": param_key, "url": val})

    return {
        "task": {
            "task_id": task_id,
            "task_type": task_info.get("task_type", "comfyui"),
            "workflow_name": data.get("workflow_name", ""),
            "workflow_json": data.get("workflow_json"),
            "params": data,
            "files": files_to_download,
        }
    }
```

- [ ] **Step 2: Commit**

```bash
git add agent_routes.py
git commit -m "feat: agent_poll handles both task_id and JSON ZSET members"
```

---

### Task 5: Agent Client — Use Pre-built Workflow

**Files:**
- Modify: `comfyui_agent.py:114-152` (function `execute_comfyui_task`)
- Modify: `comfyui_agent.py:212-221` (function `_download_file`)
- Modify: `comfyui_agent.py:223-237` (function `_upload_to_comfyui`)

- [ ] **Step 1: Update `_download_file` to use auth headers and preserve filenames**

Replace lines 212-221:

```python
    def _download_file(self, url, expected_filename=None):
        local_dir = Path("/tmp/agent_downloads")
        local_dir.mkdir(parents=True, exist_ok=True)
        # Use expected_filename if provided, else extract from URL
        if expected_filename:
            filename = expected_filename
        else:
            filename = url.split("/")[-1].split("?")[0] or "download"
        local_path = local_dir / filename
        # Use auth headers for server downloads
        headers = self._headers() if self.server_url and not url.startswith("http://127.0.0.1") else {}
        full_url = url if url.startswith("http") else f"{self.server_url}{url}"
        resp = requests.get(full_url, headers=headers, timeout=120, stream=True)
        resp.raise_for_status()
        local_path.write_bytes(resp.content)
        logger.info(f"Downloaded {full_url} -> {local_path} ({len(resp.content)} bytes)")
        return str(local_path)
```

- [ ] **Step 2: Update `_upload_to_comfyui` to send overwrite:true**

Replace lines 223-237:

```python
    def _upload_to_comfyui(self, port, local_path):
        try:
            with open(local_path, "rb") as f:
                resp = requests.post(
                    f"http://127.0.0.1:{port}/upload/image",
                    files={"image": (os.path.basename(local_path), f)},
                    data={"overwrite": "true"},
                    timeout=30
                )
            resp.raise_for_status()
            name = resp.json().get("name", os.path.basename(local_path))
            logger.info(f"Uploaded to ComfyUI:{port} as {name}")
            return name
        except Exception as e:
            logger.error(f"Upload to ComfyUI failed: {e}")
            return None
```

- [ ] **Step 3: Rewrite `execute_comfyui_task` to use pre-built workflow**

Replace lines 114-152:

```python
    def execute_comfyui_task(self, task):
        port = self._pick_healthy_port()
        if not port:
            return {"status": "failed", "error": "No healthy ComfyUI instance", "output_files": []}

        workflow_json = task.get("workflow_json")
        if not workflow_json:
            # Fallback: try params
            params = task.get("params", {})
            workflow_json = params.get("workflow_json")
        if not workflow_json:
            return {"status": "failed", "error": "No workflow_json in task", "output_files": []}

        # Download input files and upload to local ComfyUI
        filename_map = {}  # old_name -> comfyui_name (for fallback replacement)
        for file_info in task.get("files", []):
            url = file_info.get("url", "")
            expected = file_info.get("filename", "")
            if not url:
                continue
            try:
                local_path = self._download_file(url, expected_filename=expected)
                comfyui_name = self._upload_to_comfyui(port, local_path)
                if comfyui_name and comfyui_name != expected:
                    filename_map[expected] = comfyui_name
            except Exception as e:
                logger.error(f"File transfer failed for {expected}: {e}")

        # Apply filename replacements if ComfyUI returned different names
        workflow_str = json.dumps(workflow_json)
        for old_name, new_name in filename_map.items():
            if old_name and new_name:
                workflow_str = workflow_str.replace(old_name, new_name)
                logger.info(f"Replaced filename in workflow: {old_name} -> {new_name}")
        final_workflow = json.loads(workflow_str)

        # Submit to local ComfyUI
        resp = requests.post(
            f"http://127.0.0.1:{port}/prompt",
            json={"prompt": final_workflow},
            timeout=30
        )
        resp.raise_for_status()
        prompt_id = resp.json().get("prompt_id")
        if not prompt_id:
            return {"status": "failed", "error": "No prompt_id returned", "output_files": []}

        output_files = self._wait_for_completion(port, prompt_id)
        return {"status": "completed", "output_files": output_files}
```

- [ ] **Step 4: Commit**

```bash
git add comfyui_agent.py
git commit -m "feat: agent uses pre-built workflow, auth downloads, filename fallback"
```

---

### Task 6: Result Return — Persistent Storage

**Files:**
- Modify: `agent_routes.py:130-174` (function `agent_complete`)

- [ ] **Step 1: Update agent_complete to save to persistent_storage**

Replace lines 140-174:

```python
    # Determine file type from task or default to image
    file_type = "image"  # Could be enhanced to detect from extension
    year_month = datetime.now().strftime('%Y%m')
    output_dir = Path("persistent_storage") / f"{file_type}s" / "agent" / year_month
    output_dir.mkdir(parents=True, exist_ok=True)

    saved_files = []
    for f in files:
        out_filename = f"{task_id}_{f.filename}"
        file_path = output_dir / out_filename
        content = await f.read()
        file_path.write_bytes(content)

        # Create FileDAO record for frontend access
        file_id = None
        try:
            from dao_file import FileDAO as FD
            fid = f"file_{uuid.uuid4().hex[:12]}"
            await FD.create_file(
                version_id="agent_output",
                user_id=agent_id,
                file_type=file_type,
                file_name=f.filename,
                file_path=str(file_path),
                file_url=f"/storage/{file_type}s/agent/{year_month}/{out_filename}",
                file_size_bytes=len(content),
                mime_type=f.content_type or "application/octet-stream",
                metadata={"source": "agent_complete", "task_id": task_id},
                file_id=fid,
            )
            file_id = fid
        except Exception as e:
            logger.warning(f"Failed to create file record: {e}")

        saved_files.append({
            "filename": f.filename,
            "path": str(file_path),
            "size": len(content),
            "file_id": file_id,
            "url": f"/storage/{file_type}s/agent/{year_month}/{out_filename}",
        })

    result = {"output_files": saved_files, "duration": duration}
    await TaskHistoryDAO.update_status(
        task_id, status, agent_id=agent_id,
        result=result, error_message=error_message
    )

    # Update Redis for SSE notification
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
        key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
        update_data = {
            "status": status,
            "completed_at": datetime.now().isoformat(),
        }
        if saved_files:
            update_data["result"] = json.dumps(result)
        await redis_client.hset(key, mapping=update_data)

        # Publish completion event for SSE
        task_hash = await redis_client.hgetall(key)
        user_id = None
        if task_hash:
            uid = task_hash.get(b"user_id") or task_hash.get("user_id")
            if uid:
                user_id = uid.decode() if isinstance(uid, bytes) else uid
        if user_id:
            await redis_client.publish(f"task_complete:{user_id}", json.dumps({
                "task_id": task_id, "status": status, "result": result
            }))
    except Exception as e:
        logger.warning(f"Failed to update Redis: {e}")

    return {"success": True, "task_id": task_id, "files_saved": len(saved_files)}
```

- [ ] **Step 2: Add uuid import at top of agent_routes.py**

```python
import uuid
```

- [ ] **Step 3: Commit**

```bash
git add agent_routes.py
git commit -m "feat: agent_complete saves to persistent_storage with FileDAO records"
```

---

### Task 7: Admin UI — Show Agent Token & Command

**Files:**
- Modify: `admin/app.js:175-204` (function `fetchAgents`, agent card rendering)

- [ ] **Step 1: Add "查看命令" toggle to agent cards**

Replace agent card rendering (lines 181-203) in `fetchAgents`:

```javascript
    return `
      <div class="agent-card">
        <div class="agent-left">
          <span class="dot ${dotClass}"></span>
          <span class="agent-name">${a.name}</span>
          <span class="badge ${statusBadge}">${a.status}</span>
          ${!a.enabled ? '<span class="badge badge-red">暂停</span>' : ''}
        </div>
        <div class="agent-mid">
          ${instances.map(i =>
            `<span class="port-tag ${i.status === 'healthy' ? 'healthy' : 'unhealthy'}">:${i.port} ${i.status === 'healthy' ? '✓' : '✗'}</span>`
          ).join('')}
        </div>
        <div class="agent-stats">
          <span>完成 <b style="color:var(--text-0)">${stats.tasks_completed || 0}</b></span>
          <span>失败 <b style="color:var(--text-0)">${stats.tasks_failed || 0}</b></span>
          ${a.last_heartbeat ? `<span style="font-family:var(--font-mono);font-size:11px">${new Date(a.last_heartbeat).toLocaleTimeString('zh-CN')}</span>` : ''}
        </div>
        <div class="agent-actions">
          <button class="btn btn-ghost btn-xs" onclick="showAgentCommand('${a.agent_id}')">命令</button>
          <button class="btn btn-ghost btn-xs" onclick="toggleAgent('${a.agent_id}')">${a.enabled ? '暂停' : '启用'}</button>
          <button class="btn btn-danger btn-xs" onclick="deleteAgent('${a.agent_id}')">移除</button>
        </div>
        <div id="cmd-${a.agent_id}" class="agent-command hidden" style="grid-column:1/-1;margin-top:8px;padding:10px;background:var(--bg-0);border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">Token:</div>
          <code style="font-size:11px;color:var(--accent);word-break:break-all">${a.token}</code>
          <div style="font-size:11px;color:var(--text-3);margin-top:8px;margin-bottom:4px">启动命令:</div>
          <pre style="font-size:11px;color:var(--text-1);white-space:pre-wrap;margin:0">python comfyui_agent.py \\
  --server ${location.origin} \\
  --token ${a.token} \\
  --ports 8188</pre>
          <button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="navigator.clipboard.writeText('python comfyui_agent.py --server ${location.origin} --token ${a.token} --ports 8188');showToast('已复制','success')">复制命令</button>
        </div>
      </div>`;
```

- [ ] **Step 2: Add `showAgentCommand` function**

Add after `deleteAgent` function (line 217):

```javascript
function showAgentCommand(id) {
  const el = document.getElementById('cmd-' + id);
  if (el) el.classList.toggle('hidden');
}
```

- [ ] **Step 3: Commit**

```bash
git add admin/app.js
git commit -m "feat: admin UI shows agent token and startup command"
```

---

### Task 8: Configuration — AGENT_ONLY_MODE

**Files:**
- Modify: `cluster_config.py` (add `AGENT_ONLY_MODE` to `SystemConfig`)
- Modify: `cluster_main.py` (conditional worker startup and health checks)

- [ ] **Step 1: Add AGENT_ONLY_MODE config**

In `cluster_config.py`, find `SystemConfig` class and add:

```python
class SystemConfig:
    AGENT_ONLY_MODE = os.environ.get("AGENT_ONLY_MODE", "true").lower() == "true"
```

- [ ] **Step 2: Guard worker startup**

In `cluster_main.py`, find where workers are started (search for `Worker` or `_process_loop` initialization). Wrap with:

```python
if not SystemConfig.AGENT_ONLY_MODE:
    # Start worker processes
    ...
else:
    logger.info("ℹ️ AGENT_ONLY_MODE: Worker进程已禁用，任务由Agent执行")
```

- [ ] **Step 3: Guard ClusterManager health check errors**

In `cluster_main.py`, where cluster managers are initialized, make failure non-fatal:

```python
if SystemConfig.AGENT_ONLY_MODE:
    logger.info("ℹ️ AGENT_ONLY_MODE: 集群健康检查为可选模式")
```

- [ ] **Step 4: Commit**

```bash
git add cluster_config.py cluster_main.py
git commit -m "feat: add AGENT_ONLY_MODE config, disable worker when using agents"
```

---

### Task 9: Frontend Regression Fixes

**Files:**
- Modify: `new_html/types.ts`
- Modify: `new_html/utils/episodeAdapters.ts`
- Modify: `new_html/components/audio/DubbingPanel.tsx`

These are carried over from the previous conversation's pending fixes.

- [ ] **Step 1: Add boundCharNames/boundSceneName to StoryboardItem type**

In `new_html/types.ts`, find the `StoryboardItem` interface and add:

```typescript
  boundCharNames?: string[];
  boundSceneName?: string;
  isConfigConfirmed?: boolean;
```

- [ ] **Step 2: Restore materialSelections wide range in episodeAdapters.ts**

In `dbItemToStoryboardItem`, ensure `materialSelections` iterates all `characters` and `scene` (not just `charNames`). Also add `boundCharNames` and `boundSceneName` to the returned object.

- [ ] **Step 3: Add isConfigConfirmed mapping in storyboardItemToDbUpdate**

In `storyboardItemToDbUpdate`, add:

```typescript
if (item.isConfigConfirmed !== undefined) {
  update.is_config_confirmed = item.isConfigConfirmed;
}
```

- [ ] **Step 4: Make empty DubbingPanel cards interactive**

In `DubbingPanel.tsx`, change empty-dialogue placeholder to a clickable "+ 添加台词" area that switches to edit mode.

- [ ] **Step 5: Commit**

```bash
git add new_html/types.ts new_html/utils/episodeAdapters.ts new_html/components/audio/DubbingPanel.tsx
git commit -m "fix: restore materialSelections, add isConfigConfirmed, interactive empty cards"
```

---

### Task 10: Build & Deploy

- [ ] **Step 1: Frontend build**

```bash
cd new_html && npm run build
```

Fix any build errors.

- [ ] **Step 2: Sync to deploy directory**

Copy modified backend files to deploy folder:
- `cluster_main.py`
- `agent_routes.py`
- `comfyui_agent.py`
- `cluster_config.py`
- `admin/app.js`

Copy built frontend assets.

- [ ] **Step 3: End-to-end test**

1. Start server with `AGENT_ONLY_MODE=true`
2. Create agent via admin UI
3. Start `comfyui_agent.py` on GPU machine with the token
4. Upload an image → confirm 200 (no 503)
5. Generate a ComfyUI workflow → confirm task enqueued
6. Confirm agent picks up task, downloads files, executes, reports result
7. Confirm frontend shows the generated image

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: build artifacts and deploy sync"
```
