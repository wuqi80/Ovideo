# Slice 3 — Video Reverse Prompt

Goal: 用户上传 5–60s 视频 → 自动切分 + 抽帧 + 视觉分析 + 提示词生成；抽帧图自动进素材库；走积分预估→冻结→结算。

User-visible result:
- 新增 `/projects/:projectId/video-reverse` 工作台
- 上传视频 → 看到 estimate 弹窗 → 确认后任务进入队列 → 实时进度
- 完成后展示整体提示词 / 分镜提示词 / 结构化 JSON
- 抽帧图自动在素材库 `source='video_reverse_frame'`

## Existing system relationships

- Frontend pages/routes: new only.
- Frontend services: reuse polling pattern from `videoTaskPoller.ts` or `apiTaskQueue.ts`.
- Backend endpoints: new `video_reverse_routes.py` on `api_router`.
- Backend services: new `video_reverse_service.py`; reuse `file_service.save_generated_file_to_db`, `task_service.submit`, Slice 1 `media_library_service`, Slice 2 `credit_service`.
- Database tables: `tasks`, `files`, `media_library_items`, `credit_*`. New: `video_reverse_tasks`, `video_reverse_segments`.
- Storage: existing `persistent_storage/video/<user>/<yyyymm>/<file_id>.mp4`.
- Task/worker: existing `worker.py` Worker class. Need to add a branch for `task.task_type == 'video_reverse_prompt'`.
- Auth: existing JWT.
- Admin: covered in Slice 5.

## Reuse / extend / new decisions

- **Reuse**: `save_generated_file_to_db`, `task_service.submit`, `media_library_service`, `credit_service`, Worker scaffolding.
- **New**: `dao_video_reverse.py`, `video_reverse_service.py`, `video_reverse_routes.py`, `VideoReversePage.tsx`, `videoReverseService.ts`, new tables, new Worker handler branch.
- **Extend**: `worker.py` gets a new elif branch checking `task.task_type == 'video_reverse_prompt'`, delegating to the service.
- **Defer**: in-place prompt editing + persistence, retry-failed-segments-only, advanced cut detection beyond uniform.

## Database changes

- New migration `db_migration_video_reverse.sql` (+ deploy mirror).
- Tables (DDL per `MY2新功能数据库与接口接入方案.md §2.4`):
  - `video_reverse_tasks (reverse_task_id, task_id FK tasks, user_id, project_id, episode_id, video_file_id FK files, video_library_item_id, duration_seconds, status, progress, overall_*, structured_prompt JSONB, frame_file_ids JSONB, credit_cost, error_message)`
  - `video_reverse_segments (segment_id, reverse_task_id, sort_order, start_seconds, end_seconds, frame_file_ids JSONB, description, prompt_zh, prompt_en, camera_description, motion_description)`

## Backend changes

- `dao_video_reverse.py`:
  - `VideoReverseTaskDAO.create/get/list/update/update_status/update_progress`
  - `VideoReverseSegmentDAO.create_many/get_by_reverse_task`
- `video_reverse_service.py`:
  - `validate_video(file_record) -> (ok, error_msg)` — enforce 5 ≤ duration ≤ 60; mime in mp4/mov/webm; size ≤ env-configured cap.
  - `plan_segments(duration_seconds) -> list[(start, end)]` — uniform per design §5.5: 5–15s → 1–3 segments, 16–30 → 3–5, 31–60 → 5–8.
  - `extract_frames(file_path, segments, frames_per_segment=2) -> dict[seg_idx, list[path]]` — uses `ffmpeg` via `subprocess` or `imageio-ffmpeg`. Saves frames to a tmp dir.
  - `analyze_frames(frame_paths)` — calls existing vision model (Gemini or Doubao) per-frame to get a short description. If the project has no BE vision wrapper, ship a minimal one using `requests + base64` and the existing API key from `api_configurations`.
  - `build_prompts(segment_results) -> dict` — produces overall_zh / overall_en / negative / segments[] / structured.
  - `save_results(reverse_task_id, user_id, project_id, video_file_id, frames_per_segment_paths, prompts, credit_cost)`:
    1. For each frame path → read bytes → `save_generated_file_to_db(content, 'image', user_id, source='video_reverse_frame', entity_type='video_reverse', entity_id=reverse_task_id, file_role='frame', original_ext='.jpg')` → `media_library_service.create_from_file(..., source='video_reverse_frame', project_id, source_task_id=task_id)`.
    2. Insert `video_reverse_tasks` and `video_reverse_segments` rows.
  - `run_pipeline(task)` — top-level orchestrator called by worker.
- `video_reverse_routes.py`:
  - `POST /api/video-reverse/estimate {video_file_id?, duration_seconds, frame_count?, model?}` → `credit_service.estimate('video_reverse_prompt', {duration_seconds, frame_count})`
  - `POST /api/video-reverse/tasks {video_file_id, project_id?, episode_id?, frame_strategy?, language?}`:
    1. validate video file ownership
    2. compute estimate
    3. `credit_service.freeze`
    4. `task_service.submit('video_reverse_prompt', {video_file_id, project_id, episode_id, reverse_task_id, language, ...}, user_id)`
    5. `VideoReverseTaskDAO.create(reverse_task_id=uuid, task_id, user_id, project_id, video_file_id, status='pending', credit_cost=estimated)`
    6. return `{reverse_task_id, task_id, estimated_cost, status:'pending'}`
  - `GET /api/video-reverse/tasks` (paginated, scoped to user/project)
  - `GET /api/video-reverse/tasks/{reverse_task_id}` (joined segments)
  - `POST /api/video-reverse/tasks/{reverse_task_id}/cancel` — sets task status to `cancelled`, `credit_service.release`.
  - `POST /api/video-reverse/tasks/{reverse_task_id}/retry` — re-freezes credit, resubmits.
- Worker changes (`worker.py`):
  - In `process_task`, add an early branch (similar to MiniMax TTS handling): if `task.task_type == 'video_reverse_prompt'`, call `await video_reverse_service.run_pipeline(task)` and return without going to ComfyUI/cluster path.
  - Pipeline updates `tasks.status / progress / result_data` and `video_reverse_tasks.progress`.
  - On success: `credit_service.confirm(task.task_id, final_amount=credit_cost)`.
  - On failure: `credit_service.release(task.task_id)`, `video_reverse_tasks.status='failed'`, `error_message`.

## Frontend changes

- `new_html/services/videoReverseService.ts` — estimate / createTask / listTasks / getTask / cancel / retry.
- `new_html/pages/VideoReversePage.tsx`:
  - Layout: 左侧上传 / 选素材 → 中央 video player + timeline + segments → 右侧 result tabs (overall / segments / structured) → 底部 history table。
  - States per design §5.10.
  - Reuses `CreditEstimateModal` from Slice 2.
- `new_html/WorkspaceApp.tsx`: register `/projects/:projectId/video-reverse`.
- Polling: reuse existing pattern (`globalTaskManager` if applicable, else simple interval poll on `/tasks/{id}`).

## Admin changes

- None this slice (covered in Slice 5 via media + tasks management).

## Permission rules

- Owner: `video_reverse_tasks.user_id`.
- List: rows where `user_id=me` OR (`project_id` in me's `project_members` AND project visibility allows).
- Cancel/retry: only owner or project owner/admin.

## Credit/quota rules

- `feature_key='video_reverse_prompt'` (seeded in Slice 2).
- Estimate uses `duration_seconds` factor.
- Freeze at task creation; settle on success; release on failure/cancel.

## Execution steps

1. Write migration + deploy mirror.
2. Confirm ffmpeg availability (env / shell `ffmpeg -version`). If unavailable, document install step and fail loudly at task start.
3. Implement `dao_video_reverse.py`.
4. Implement `video_reverse_service.py`. For vision model, look for existing BE wrapper (`gemini_*` python file) and reuse; if missing, add a minimal Doubao or Gemini caller using `api_configurations`.
5. Implement `video_reverse_routes.py`; mount.
6. Modify `worker.py`: add `video_reverse_prompt` early branch.
7. Implement frontend service + page + route.
8. Wire into `WorkspaceApp.tsx`.
9. Mirror to `deploy/`.

## Verification

- Upload a 10-second mp4 → estimate returns ~20 credits → freeze on submit → task progresses pending → splitting → extracting_frames → analyzing → building_prompts → completed.
- DB: `video_reverse_tasks` row completed, segments count between 1 and 3, `frame_file_ids` non-empty.
- Media library shows the frames + the source video.
- Credit transaction `change_type='consume'` for ~20.
- On simulated worker failure: `release` runs, balance restored.

## Risks

- ffmpeg not installed on the worker host — pipeline fails. Mitigate by checking on start and surfacing a clear error.
- Vision API quotas. Mitigate by limiting frames per segment to 1–2 in default mode.
- Very long videos hitting the 60s cap edge case.
- File size limits via fastapi.

## Out of scope

- In-place editing of generated prompts
- Custom prompt templates per project
- Multi-language analysis beyond zh+en
- Webhook callbacks
