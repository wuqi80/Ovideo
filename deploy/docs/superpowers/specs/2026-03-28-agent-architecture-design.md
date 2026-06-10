# Agent-Only Architecture Design

## Summary

Migrate all ComfyUI task execution from direct-HTTP Cluster model to Agent pull model. The server becomes the "brain" (workflow building, file storage, task queuing) and Agents become the "hands" (file download, local ComfyUI execution, result upload).

## Constraints

- GPU machines and main server are on **different networks** (cross-cloud: Alibaba Cloud + AutoDL)
- Only public internet connectivity (no intranet IP reachability)
- File sizes: images 1-10MB, short videos 10-50MB
- Multiple GPU machines, each with multiple ComfyUI instances
- **Only ComfyUI tasks** use the Agent path; `api_call` tasks stay as-is

## Architecture

### Current (Broken for Remote GPU)

```
Frontend → Upload → [Direct HTTP to ComfyUI] → 503 (unreachable)
Frontend → Generate → TaskQueue → Worker → [Direct HTTP to ComfyUI] → 503
```

### New (Agent Pull)

```
Frontend → Upload → Server persistent_storage (primary)
Frontend → Generate → Server builds workflow → TaskQueue (with workflow_json)
Agent → Poll → Download files → Upload to local ComfyUI → Submit workflow → Report results
```

### Key Invariant

Filenames remain consistent throughout the entire flow:
- Server generates unique name: `{uuid12}_{original}.png`
- Stored in `persistent_storage/image/{user}/{YYYYMM}/`
- Workflow JSON references this exact name
- Agent downloads file, uploads to local ComfyUI with `overwrite:true`
- ComfyUI preserves the name → workflow references match automatically

## Component Changes

### 1. Upload Path (`cluster_main.py`)

`comfyui_upload_proxy` changes from "must have ComfyUI node" to "local storage first, ComfyUI optional":

1. Save file to `persistent_storage/image/{user}/{YYYYMM}/{unique_filename}` (promoted from backup to primary)
2. Cache filename→file_id in Redis: `SET comfyui:file:{filename} {file_id} EX 86400`
3. Create FileDAO record
4. Optionally upload to ComfyUI if a node is available
5. Return filename + file_id + storage_url

### 2. Workflow Pre-building (`cluster_main.py`)

New helper function `prepare_task_for_agent(task_type, task_data, username)`:

1. Map `image_path` → `uploaded_image`, `image_path_N` → `uploaded_image_N` (mimicking Worker's pre-upload step)
2. Call `workflow_handler.build_workflow_for_task(task_type, task_data)` → full workflow JSON
3. Resolve file download URLs via Redis lookup (`comfyui:file:{filename}` → file_id)
4. Store `workflow_json` and `agent_files` list in `task_data`

Applied to all 11 generate endpoints that use `task_queue.enqueue`.

### 3. Agent Poll (`agent_routes.py`)

`agent_poll` adapts to handle both ZSET member formats:

- Try `json.loads(member)` → SmartApiRouter's api_call format (existing)
- On failure: treat as `task_id` string → load full task from Redis hash → build response

Response always includes: `task_id`, `task_type`, `workflow_json`, `params`, `files[]`

### 4. Agent Client (`comfyui_agent.py`)

`execute_comfyui_task` simplified:

1. Download files from authenticated URLs (adds Bearer token)
2. Upload to local ComfyUI with same filename (`overwrite:true`)
3. If ComfyUI returns different name → `workflow_str.replace(old, new)` fallback
4. Submit pre-built workflow directly via `POST /prompt`
5. Wait for completion, download outputs

### 5. Result Return (`agent_routes.py`)

`agent_complete` enhanced:

1. Save output files to `persistent_storage/{type}/{YYYYMM}/` (not `outputs/agent/`)
2. Create FileDAO records for each output
3. Update TaskHistory with file_ids for frontend access
4. Publish completion to Redis for SSE notification

### 6. Admin UI (`admin/app.js`)

Each agent card gains a "查看命令" toggle showing:
- Token (copyable)
- Startup command: `python comfyui_agent.py --server ... --token ... --ports ...`

### 7. Configuration (`cluster_config.py`)

New `AGENT_ONLY_MODE = True`:
- Worker startup skipped
- ClusterManager health checks optional (no error on no nodes)
- Upload doesn't require ComfyUI node

## Security

- Agent file downloads use `/api/files/{file_id}/download` (authenticated)
- Not the public `/storage/` static mount
- All agent API calls require Bearer token validation

## Error Handling

- Agent execution timeout: 600s → mark task as failed, available for retry
- File download failure: skip task, mark error, return to queue
- ComfyUI crash during execution: agent reports failure, task can be retried
- Agent goes offline: stale heartbeat detection marks agent offline after 15s

## Migration

- `AGENT_ONLY_MODE` config flag controls behavior
- Worker code preserved but not started in agent-only mode
- Existing `ClusterManager` kept for optional local-ComfyUI fallback
