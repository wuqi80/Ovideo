# Slice 1 — Media Library MVP

Goal: 项目组任意成员可以在素材库页查看 / 上传 / 引用本项目下的图片、视频、抽帧图、生成图，并可标记私有/项目共享。

User-visible result:
- 新增 `/projects/:projectId/media-library` 页面，左侧分类 + 网格主区 + 右侧详情面板
- 上传图片/视频 → 同时入 `files` 和 `media_library_items`
- 生成图（GPT Image / ComfyUI / TTS 音频 / 视频）完成后自动出现在素材库
- 项目共享：`permission_scope='project'` 的素材对该 `project_members` 全部可见

## Existing system relationships

- Frontend pages/routes/components:
  - `new_html/WorkspaceApp.tsx` — react-router root, where new route is registered
  - `new_html/components/MaterialPage.tsx` / `new_html/pages/MaterialsPage.tsx` — UNTOUCHED (different feature)
- Frontend services/hooks:
  - `new_html/services/apiService.ts` — existing axios/fetch wrapper to reuse for typed client
- Backend endpoints:
  - `cluster_main.py` mounts `api_router` and `admin_api_router`. New router goes through `api_router`.
- Backend services/DAOs:
  - `dao_content.py:FileDAO.create_file` — write path used by `save_generated_file_to_db`
  - `dao_user.py` — for membership lookups
  - `dao_content.py:ProjectMemberDAO` — for project-scope visibility
- Database tables:
  - `files` (file_id, user_id, file_type, file_url, ...) — primary file index
  - `projects` (project_id, user_id)
  - `project_members` (project_id, user_id, role)
- Storage/file logic:
  - `file_service.py:save_generated_file_to_db(content, file_type, user_id, source, ...)` — canonical entry. Returns `{file_id, file_url, file_path}`.
- Task/worker logic: N/A this slice.
- Auth/permission logic: existing `jwt_auth.get_current_user` dependency.
- Admin pages: N/A this slice (see Slice 5).

## Reuse / extend / new decisions

- **Reuse**: `files` table, `save_generated_file_to_db`, `ProjectMemberDAO`, `jwt_auth.get_current_user`.
- **New**: `media_library_items`, `media_library_usages` tables, `dao_media_library.py`,
  `media_library_service.py`, `media_library_routes.py`, `MediaLibraryPage.tsx`,
  `mediaLibraryService.ts`.
- **Extend (business-layer only, NOT save_generated_file_to_db core)**: each generation
  call site that produces a user-visible image/video/audio gets one new line:
  `await media_library_service.create_from_file(db_record, source='...', project_id=..., source_task_id=...)`.
- **Rename/conflict avoidance**: do NOT use `assets` or `MaterialPage` names.
- **Defer**: folders, tags taxonomy admin, public-link sharing, team-level visibility,
  credit gating on upload, history backfill (Slice 6).

## Database changes

- New migration files: `db_migration_media_library.sql` (+ `deploy/sql/`).
- New tables: `media_library_items`, `media_library_usages` (DDL per design doc).
- Indexes: `(user_id)`, `(project_id)`, `(file_id)`, `(source)`, `(item_type)`,
  `(library_item_id)` unique.
- Backfill: none in this slice (Slice 6).

## Backend changes

- `dao_media_library.py`:
  - `MediaLibraryDAO.create(library_item_id, file_id, user_id, project_id, item_type, source, ...)`
  - `MediaLibraryDAO.get(library_item_id) -> dict`
  - `MediaLibraryDAO.list(user_id, project_id=None, filters) -> list[dict]` — joins `files`
  - `MediaLibraryDAO.update(library_item_id, fields)`
  - `MediaLibraryDAO.soft_delete(library_item_id, deleted_by=None, reason=None)`
  - `MediaLibraryUsageDAO.record(library_item_id, file_id, user_id, project_id, task_id, usage_context, target_entity_type, target_entity_id)`
- `media_library_service.py`:
  - `create_from_file(file_record, source, project_id=None, source_task_id=None, item_type=None, title=None, description=None, tags=None, permission_scope='private', extra=None)` — derives `item_type` from `file_record['file_type']` if not provided.
  - `list_items(user_id, project_id=None, filters)` — enforces permission via SQL: rows owned by `user_id` OR (`permission_scope='project'` AND `project_id` in user's `project_members`).
  - `update_item(library_item_id, user_id, fields)` — role check via `project_members`.
  - `record_usage(library_item_id, ...)` — increments `use_count`.
- `media_library_routes.py` mounted on `api_router` in `cluster_main.py`:
  - `GET /api/media-library/items` — query params `project_id, episode_id, item_type, source, tag, keyword, permission_scope, is_favorite, limit, offset`
  - `POST /api/media-library/upload` — multipart, `file` + optional `project_id, episode_id, permission_scope, tags, title, description`
  - `GET /api/media-library/items/{library_item_id}`
  - `PATCH /api/media-library/items/{library_item_id}` — `title, description, tags, permission_scope, is_favorite, folder_id`
  - `DELETE /api/media-library/items/{library_item_id}` — soft-delete the library row only; do NOT delete the file
  - `POST /api/media-library/items/{library_item_id}/use` — `{usage_context, task_id?, target_entity_type?, target_entity_id?}`
  - `POST /api/media-library/batch-download` — `{library_item_ids: []}` → zip stream
- Error handling: `404` on missing item, `403` on permission denied, `400` on invalid filter.
- Task/worker: N/A.

## Frontend changes

- `new_html/services/mediaLibraryService.ts` — typed client (`listItems`, `getItem`, `uploadItem`, `updateItem`, `deleteItem`, `useItem`, `batchDownload`).
- `new_html/pages/MediaLibraryPage.tsx`:
  - Layout: 顶部工具栏 (上传 / 批量下载 / 视图切换), 左侧分类 (全部 / 我的 / 项目共享 / 视频 / 抽帧 / 收藏), 主网格, 右侧详情。
  - States: empty / loading / error / processing / success.
  - Uses `useEpisode` or `useProject` context to get `projectId`.
- `new_html/WorkspaceApp.tsx`:
  - Register route `/projects/:projectId/media-library` → `<MediaLibraryPage />`
  - Add a left-nav entry in workflow shell (icon + label "素材库").
- State/query: simple `useEffect` + local state; no need for react-query.

## Admin changes

None this slice (covered in Slice 5).

## Permission rules

- Owner fields: `media_library_items.user_id`, `media_library_items.project_id`.
- Role checks:
  - List: rows where `user_id = me` OR (`permission_scope='project'` AND `project_id` IN me's `project_members.project_id`).
  - Mutations (rename/tag/delete): only owner OR project `owner`/`admin`/`member` (not `readonly`).
- Forbidden actions: `readonly` cannot upload, mutate, or use; can list+view.

## Credit/quota rules

- N/A this slice. Upload is free in Slice 1.

## Execution steps

1. Author migrations `db_migration_media_library.sql` and mirror to `deploy/sql/`.
2. Apply migration via existing `db_manager` startup hook (find how prior migrations are registered).
3. Implement `dao_media_library.py` + tests skipped this slice.
4. Implement `media_library_service.py`.
5. Implement `media_library_routes.py` and mount via `cluster_main.py`.
6. Implement `mediaLibraryService.ts` + `MediaLibraryPage.tsx`.
7. Register route in `WorkspaceApp.tsx`.
8. Enumerate generation call sites with `gitnexus_query` (`save_generated_file_to_db`).
   For each, add `media_library_service.create_from_file(...)` best-effort sync.
9. Mirror all new/modified files to `deploy/` counterparts.

## Verification

- Database: `SELECT count(*) FROM media_library_items;` increases by 1 after upload.
- API: `curl POST /api/media-library/upload` returns `library_item_id`; `GET /api/media-library/items?project_id=...` includes it.
- Frontend: open `/projects/<p>/media-library`, see uploaded item; click → details panel.
- Permission: user B (project member) sees user A's `permission_scope='project'` items; does not see `private` items.
- Generation sync: trigger a GPT image gen → after completion, item shows up in library with `source='generated_image_gpt'`.

## Acceptance criteria

- Upload + list + detail + delete works.
- Project sharing works (verified by two users).
- AI-generated images sync at least for GPT Image path.

## Risks

- The call-site list for `save_generated_file_to_db` is unknown; if huge, do generation sync as a phased follow-up. Start with GPT Image only.
- Migration must use `IF NOT EXISTS` to be idempotent.
- Soft-delete vs hard-delete decision: this slice = soft. `files` row stays.

## Out of scope

- Folders/tags admin
- Public sharing link
- Team-level visibility
- Credit gating
- History backfill (Slice 6)
- Storyboard auto-binding from library
