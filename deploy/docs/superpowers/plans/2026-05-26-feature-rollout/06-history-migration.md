# Slice 6 — History migration

Goal: 一次性把现有 `files` 表里的图片/视频/音频补充进 `media_library_items`，让历史资产在素材库可见。

User-visible result:
- 运行一次脚本后，所有现存图片/视频/音频都出现在素材库
- 默认 `permission_scope='private'`，不会泄漏到他人

## Existing system relationships

- Tables: existing `files`, `versions`, `projects`. New: `media_library_items` from Slice 1.
- DAOs: `dao_content.FileDAO`, `dao_media_library.py`.
- Frontend: nothing in this slice.
- Admin: nothing in this slice.

## Reuse / extend / new decisions

- **Reuse**: `FileDAO` for reads; `MediaLibraryDAO` for writes.
- **New**: `scripts/migrate_files_to_media_library.py` (+ deploy mirror).
- **Defer**: re-tagging based on metadata.source is best-effort; manual cleanup can follow later.

## Database changes

None (script-only).

## Execution

- Script flow:
  1. Connect to PG using existing `db_manager`.
  2. Query files: `SELECT file_id, user_id, version_id, file_type, file_url, metadata, mime_type, created_at FROM files WHERE file_type IN ('image','video','audio') AND is_deleted=FALSE AND NOT EXISTS (SELECT 1 FROM media_library_items m WHERE m.file_id = files.file_id);`
  3. For each row:
     - `project_id = (SELECT project_id FROM versions WHERE version_id = files.version_id)` or NULL.
     - `source`:
       - If `metadata->>'source' = 'gpt_image'` → `'generated_image_gpt'`
       - elif `metadata->>'source' = 'comfyui'` → `'generated_image_comfyui'`
       - elif `metadata->>'source'` starts with `'video'` → `'generated_video_'+source`
       - else if `file_type='audio'` → `'generated_audio'`
       - else → `'upload_history'`
     - `item_type` = `file_type` (image|video|audio).
     - `permission_scope = 'private'`.
     - `source_task_id = metadata->>'task_id'` if present.
     - Insert into `media_library_items`.
  4. Commit in batches of 500.
- Idempotent via the NOT EXISTS clause.
- CLI flags: `--dry-run`, `--limit N`, `--user USER_ID`, `--project PROJECT_ID`, `--verbose`.

## Verification

- Dry-run: prints summary "would insert N items".
- Real run: same count appears in `media_library_items`.
- Spot-check: pick 5 user IDs, ensure their old uploads now appear in the library API.
- Idempotent: rerun = 0 new items.

## Risks

- Wrong `project_id` inference if `versions.project_id` is NULL. Acceptable — those will be private-no-project items.
- Source taxonomy isn't perfect; can be refined later with manual UPDATE.

## Out of scope

- Re-tagging by smart heuristics
- Public-link sharing of legacy items
- File optimization (thumbnail generation) — done lazily on first view
