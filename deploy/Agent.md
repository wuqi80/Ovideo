# MECHA Deploy Agent Notes

## 2026-06-19 Storyboard Paged Mutation Reload Fix

### Incident

- The workflow storyboard page was optimized to initially load only 10 shots, but some mutations could still break the paged state.
- Deleting one or more shots called `forceReloadSlices('storyboardItems')`, which uses the full storyboard API without `limit`.
- On large episodes, one delete operation could therefore reload every shot and make the page slow again.

### Changes

- Updated `deploy/new_html/pages/StoryboardGenPage.tsx`:
  - added `reloadVisibleStoryboardPage()`
  - single delete and batch delete now reload only the current visible storyboard page
  - current visible count and total count are still preserved through `loadStoryboardItemsPage({ limit, includeTotal: true })`
- Updated `deploy/scripts/check_route_contract.py`:
  - added `storyboard_paged_reload_checks=2`
  - contract fails if `StoryboardGenPage` reintroduces `forceReloadSlices('storyboardItems')`

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `git diff --check -- deploy/new_html/pages/StoryboardGenPage.tsx deploy/scripts/check_route_contract.py`
- Frontend build notes:
  - `npm run build` could not run because `npm` is not on the local PATH.
  - direct Vite build could not run because local `node_modules` is missing Rollup optional package `@rollup/rollup-win32-x64-msvc`.
  - `tsc --noEmit` currently fails on pre-existing project-wide type issues outside this change.
- Server deploy checks passed:
  - synced `StoryboardGenPage.tsx`, `check_route_contract.py`, and `Agent.md` to `/home/Administrator/deploy`
  - server `cd /home/Administrator/deploy/new_html && npm run build` succeeded
  - generated deployed chunk `../dist/assets/StoryboardGenPage-DbNBvXf8.js`
  - server `scripts/check_route_contract.py` reports `storyboard_paged_reload_checks=2`
  - server `scripts/check_provider_contract.py` passed
  - server smoke `/tmp/smoke_test.py https://mecha.one Liu3753650@` passed `9/9`

### Notes

- This change is deployed on `https://mecha.one/`.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Graceful Restart Timeout Fix

### Incident

- `systemctl restart drama` repeatedly waited for the systemd 90 second stop timeout before SIGKILL.
- During that window `https://mecha.one/` could briefly return 502 while the service was being replaced.
- Investigation showed two separate shutdown risks:
  - `core.worker.Worker.start()` registers process-level `SIGINT`/`SIGTERM` handlers from worker tasks.
  - uvicorn then waited on active HTTP tasks before entering FastAPI lifespan shutdown.

### Changes

- Updated `deploy/cluster_main.py` without modifying redline worker files:
  - tracks background tasks and worker tasks created during lifespan startup
  - temporarily suppresses worker process signal registration so uvicorn remains the service shutdown owner
  - cancels background tasks and worker tasks with bounded timeouts during lifespan shutdown
  - keeps worker shutdown concurrent and clears the worker registry
- Updated `deploy/scripts/check_route_contract.py`:
  - added `lifespan_shutdown_checks=12`
  - contract verifies signal-guard, task tracking, and bounded shutdown snippets remain present
- Added server-only systemd drop-in:
  - `/etc/systemd/system/drama.service.d/90-graceful-timeout.conf`
  - `ExecStart` now includes `--timeout-graceful-shutdown 8`
  - `TimeoutStopSec=30`

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `scripts/check_route_contract.py` reports `lifespan_shutdown_checks=12`
  - `scripts/check_provider_contract.py` passed
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` passed `9/9`
- Restart verification:
  - before fix: `RESTART_COMMAND_SECONDS=90`, `HEALTHY_SECONDS=92`
  - after systemd graceful timeout: `RESTART_COMMAND_SECONDS=8`, `HEALTHY_SECONDS=10`
  - logs now show `Waiting for application shutdown`, worker stop, and `Application shutdown complete`

### Notes

- `deploy/pipeline/**`, `deploy/agent_routes.py`, `deploy/workflows/*.json`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, and `deploy/core/worker.py` were not modified.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Stale Task Notification Storm Fix

### Incident

- A production user observed many model generation failure notifications appearing at once.
- Server logs showed the direct cause:
  - `2026-06-19 09:56:50 UTC`
  - `Task stale reaper marked 131 stale tasks as failed (threshold=24h)`
- The cleanup set old task `completed_at` to `NOW()`, so `/api/tasks/notifications` treated historical stale tasks as fresh failures.

### Changes

- Updated `deploy/dao/business/task.py`:
  - `TaskDAO.cleanup_stale()` now runs in bounded batches (`limit=50`, capped at 500)
  - auto-cleaned stale tasks keep an old completion timestamp via `COALESCE(started_at, created_at)` instead of `NOW()`
- Updated `deploy/routers/task_notifications.py`:
  - `/api/tasks/notifications` filters `Auto-cleanup: stale task exceeded timeout` rows from both initial and incremental notification queries
- Updated `deploy/scripts/check_route_contract.py`:
  - added `task_stale_cleanup_checks=2`
  - contract prevents reintroducing recent-notification bursts from stale cleanup

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/dao/business/task.py deploy/routers/task_notifications.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - redline diff check confirmed no changes under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py`

### Notes

- `cluster_main.py` was intentionally not changed for the stale-notification fix. The stale reaper startup loop remains there for now; this fix changes the DAO cleanup semantics and notification filtering.
- Follow-up resolved above: `systemctl restart drama` no longer waits for the 90 second systemd timeout in normal verification.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Gemini Text Failover Response Metadata

### Changes

- Added `TextGenerationResult` and `generate_gemini_text_result()` in `deploy/services/ai_proxy_service.py`.
- Kept the old `generate_gemini_text()` string-return wrapper for compatibility.
- Updated `POST /api/gemini/text` in `deploy/routers/ai_proxy.py` to keep returning `content` and additionally expose:
  - `provider`
  - `model`
  - `failover`
- Updated `deploy/scripts/check_ai_proxy_failover.py` to verify call-level metadata:
  - missing/error `gemini-text` falls back to `deepseek`
  - healthy primary stays on `gemini-text`
  - response metadata matches the selected provider/model

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/services/ai_proxy_service.py deploy/routers/ai_proxy.py deploy/scripts/check_ai_proxy_failover.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_ai_proxy_failover.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - redline diff check confirmed no changes under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, `core/worker.py`, or `cluster_main.py`

### Notes

- This does not change frontend behavior because existing callers read `data.content`; the extra fields are diagnostic and backward-compatible.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 API Config Hot-Reload Observability Contract

### Changes

- Extended `deploy/scripts/check_provider_contract.py` with an API config write contract:
  - `create_api_config`, `update_api_config`, `delete_api_config`, `repair_api_config_provider_conflicts`, and `import_preset_api_configs` must expose `env_refreshed` in write responses
  - admin write routes must pass `_reload_api_env` into the service layer
  - manual reload response must also expose `env_refreshed`
- This protects the admin API platform behavior where key/endpoint changes should be visible to callers immediately, without pretending a DB save automatically means runtime reload succeeded.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - provider contract now reports `api_config_env_refresh_checks=11`
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/scripts/check_provider_contract.py`
  - `git diff --check -- deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - redline diff check confirmed no changes under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, `core/worker.py`, or `cluster_main.py`

### Notes

- No runtime Python handlers changed in this increment; it is a regression guard for the API management platform.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Provider Runtime Contract Guardrails

### Changes

- Extended `deploy/scripts/check_provider_contract.py` with two API management guardrails:
  - runtime/business Python code may not read managed provider env vars such as `*_API_KEY` or `*_ENDPOINT` directly
  - runtime/business Python code may not hardcode third-party provider endpoint literals outside provider configuration authority modules
- Allowed direct provider configuration only in:
  - `services/api_provider_registry.py`
  - `services/api_provider_runtime.py`
  - `services/api_config_runtime_loader.py`
  - `services/api_config_health_service.py`
  - `services/api_config_import_service.py`
- Skipped non-runtime folders for this contract check: `scripts`, `tests`, `docs`, and `__pycache__`.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/scripts/check_provider_contract.py`
  - `git diff --check -- deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - redline diff check confirmed no changes under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, `core/worker.py`, or `cluster_main.py`

### Notes

- `cluster_main.py` was intentionally left unchanged. It is now mainly startup, middleware, global exception handling, and router assembly, so further shrinking should only happen for concrete defects or ownership problems.
- This guardrail protects the API management platform goal: provider keys/endpoints stay centralized in registry/runtime config instead of reappearing in business handlers.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 API Routes Assembly-Only Increment

### Changes

- Extracted the final direct handlers from `deploy/api_routes.py`:
  - `deploy/routers/auth_legacy.py`
    - `POST /api/auth/register`
    - `POST /api/auth/login`
    - `GET /api/user/profile`
  - `deploy/routers/project_core.py`
    - `POST /api/projects`
    - `GET /api/projects`
    - `GET /api/projects/{project_id}`
- Converted `api_routes.py` into an assembly-only router module:
  - no direct `@router.*` route handlers remain
  - it keeps shared auth dependency wiring and router registration
- Updated `scripts/check_route_contract.py`:
  - verifies `api_routes_direct_handlers=0`
  - verifies `auth_legacy_route_handlers=3`
  - verifies `project_core_route_handlers=3`
  - keeps the known duplicate `GET /api/projects/{project_id}` explicit and reported

### Verification

- Local checks passed:
  - `py_compile` for touched Python files
  - `scripts/check_route_contract.py` -> `openapi_paths=231`, `openapi_operations=287`, `api_routes_direct_handlers=0`
  - `git diff --check`
  - redline diff check confirmed no changes under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, `core/worker.py`, or `cluster_main.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_api_routes_assembly_20260619-173858`
- Server checks passed:
  - `py_compile` for deployed files
  - `scripts/check_route_contract.py` -> `openapi_paths=231`, `openapi_operations=287`, `api_routes_direct_handlers=0`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
  - `POST /api/auth/register` with public registration disabled -> HTTP `403`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- `cluster_main.py` was intentionally not modified. Its current role as startup/middleware/global exception wiring is a reasonable boundary and should not be split merely to reduce line count.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Legacy File Router Extraction

### Changes

- Extracted the remaining legacy file routes from `deploy/api_routes.py` into `deploy/routers/legacy_files.py`:
  - `POST /api/files/upload`
  - `GET /api/files/{file_id}/download`
  - `DELETE /api/files/{file_id}`
- Registered the new router through `create_legacy_files_router(...)`.
- Added route-contract coverage so these routes must stay in `routers.legacy_files`.
- Fixed the legacy upload storage path construction while moving the code:
  - old expression could evaluate as `Path + str`
  - new path uses `Path("persistent_storage") / f"{file_type}s" / user_id / YYYYMM`
- Adjusted legacy download path resolution for the new module location so relative DB paths still resolve from the `deploy/` root.

### Verification

- Local checks passed:
  - `py_compile` for `api_routes.py`, `routers/legacy_files.py`, and `scripts/check_route_contract.py`
  - `scripts/check_route_contract.py`
  - `git diff --check`
  - redline diff check confirmed no changes under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_legacy_files_router_20260619-172539`
- Server checks passed:
  - `py_compile` for deployed files
  - `scripts/check_route_contract.py` -> `openapi_paths=231`, `openapi_operations=287`, `legacy_file_route_handlers=3`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
  - `GET /api/files/file_nonexistent_smoke/download` -> HTTP `404`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- Public API route counts stayed unchanged.
- `api_routes.py` now has 6 direct route handlers left: auth/register/login, user profile, and DAO-backed project create/list/detail.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin Legacy API Editor Redirect Fix

### Changes

- Fixed the native admin API provider page "旧版编辑" entry so it uses the same route-aware token selection as admin API requests before redirecting to login.
- Bumped the legacy admin cache version from `20260619b` to `20260619c`.
- Added a legacy iframe token sync fallback in `deploy/admin/app.js`:
  - reads `admin_session_token` from the same-origin parent shell when available
  - mirrors `admin_session_username` and `admin_session_login_at`
  - then falls back to `localStorage.auth_token` for compatibility

### Verification

- Local checks:
  - `node --check deploy/admin/app.js` passed.
  - Single-file TypeScript check for `deploy/new_html/admin/AdminSettingsPage.tsx` passed.
  - `git diff --check` passed for touched files.
  - Local full Vite build is still blocked by the existing Windows Rollup optional dependency issue: missing `@rollup/rollup-win32-x64-msvc`.
  - Local full TypeScript check still reports unrelated pre-existing project errors.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_legacy_redirect_20260619-171502`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server checks passed:
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
  - built `AdminSettingsPage` asset contains `20260619c`
  - `/home/Administrator/deploy/admin/app.js` contains `syncLegacyAdminSessionFromParent()` and `getLegacyAdminToken()`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No backend route behavior changed.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 API Config Quality Fix Verification

### Changes

- Fixed admin update payload handling so explicit `False`, `0`, and `None` values are preserved with `model_dump(exclude_unset=True)`.
- Fixed provider health normalization so mixed health maps keep valid provider dict rows instead of dropping all health data.
- Removed shared `GEMINI_API_KEY` fallback from `gemini-text` and `gemini-image`; both now require dedicated keys.
- Made DB-to-env API config reload atomic by building the full environment projection before resetting managed env keys.
- Added and used the public `ApiConfigDAO.decrypt_key()` wrapper instead of calling the private decrypt method from the runtime loader.
- Updated API config reload callbacks so write responses expose `env_refreshed`.
- Moved duplicated `_config_get` helper into `deploy/utils/config_helpers.py`.

### Verification

- Local checks passed:
  - `py_compile` for touched Python files
  - `scripts/check_provider_contract.py`
  - `scripts/check_api_config_runtime_loader.py`
  - `scripts/check_admin_api_config_crud.py`
  - `scripts/check_admin_api_config_health.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_api_quality_fixes_20260618-164830`
- Server checks passed:
  - `py_compile` for touched Python files
  - `scripts/check_route_contract.py` -> `openapi_paths=228`, `openapi_operations=284`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke tests passed:
  - `deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Workflow Media Lazy Decode Increment

### Changes

- Added `loading="lazy"` and `decoding="async"` to remaining heavy workflow images in:
  - `deploy/new_html/components/GenerationPage.tsx`
  - `deploy/new_html/components/VideoPage.tsx`
  - `deploy/new_html/pages/VideoGenPage.tsx`
- Added lazy/async image decoding and metadata-only video preload to the media library preview/detail surfaces:
  - `deploy/new_html/pages/MediaLibraryPage.tsx`
- Kept the existing first-screen batching behavior:
  - storyboard list renders the first 10 shots by default
  - video task groups render the first 10 groups by default
  - video results continue using `LazyVideo` with `IntersectionObserver`

### Verification

- Local checks:
  - `git diff --check` passed for touched frontend files.
  - Local Vite build is blocked by the existing Windows Rollup optional dependency issue: missing `@rollup/rollup-win32-x64-msvc`.
  - Local full TypeScript check still reports unrelated pre-existing project errors, including missing test fixtures and old `VideoPage` task-status typing issues.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_media_lazy_decode_20260618-165652`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server checks passed:
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Built asset verification passed:
  - generated JS contains lazy/async image decode attributes and metadata video preload.
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This is a low-risk rendering increment. It reduces eager image decode/network pressure in visible workflow/media surfaces without changing API calls or persisted data.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Route-Level Lazy Chunk Increment

### Changes

- Converted route page imports in `deploy/new_html/App.tsx` from static imports to `React.lazy()` dynamic imports.
- Added a single `React.Suspense` boundary around the route tree with a lightweight loading fallback.
- Preserved existing route paths and component behavior; this only changes when route code is downloaded and parsed.

### Performance Effect

- Before this increment, the production build emitted a single large app entry chunk:
  - `index-*.js`: about `2,255 KB` minified (`596 KB` gzip)
- After route-level lazy loading, the main app entry is much smaller and page code is split into route chunks:
  - `index-D4I_AtZ6.js`: `321.16 KB` minified (`100.84 KB` gzip)
  - route/page chunks now include `ProjectHub`, `StoryboardGenPage`, `VideoGenPage`, `VideoPage`, `AdminSettingsPage`, etc.
- Remaining large chunk:
  - `GenerationPage-BQY_wV5G.js`: `651.87 KB` minified (`166.54 KB` gzip)
  - This is now isolated to the workflow pages that actually need it and is a good next target for internal component splitting.

### Verification

- Local checks:
  - `git diff --check` passed for `deploy/new_html/App.tsx`.
  - Local full TypeScript check still reports unrelated pre-existing project errors; no new `App.tsx` errors were reported.
  - Local Vite build is still blocked by the existing Windows Rollup optional dependency issue: missing `@rollup/rollup-win32-x64-msvc`.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_route_lazy_chunks_20260618-170558`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server checks passed:
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
  - built main entry asset is now about `314K` on disk
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This improves first-route load and parse time without touching backend APIs or data contracts.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Generation Tool Modal Chunk Increment

### Changes

- Converted low-frequency heavy tools inside `deploy/new_html/components/GenerationPage.tsx` to lazy chunks:
  - `MattingModal`
  - `ImageFusionModal`
  - `StoryboardToolModal`
  - `MultiAngle3DController`
- Added Suspense fallbacks for tool modals and the 3D controller area.
- Kept the main Generation workflow behavior unchanged; tools still load when the user opens the relevant modal.

### Performance Effect

- Before this increment, the main generation workflow chunk was:
  - `GenerationPage-BQY_wV5G.js`: `651.87 KB` minified (`166.54 KB` gzip)
- After lazy-loading low-frequency tools, the generation workflow is split into:
  - `GenerationPage-DA8kw22X.js`: `91.61 KB` minified (`24.14 KB` gzip)
  - `MattingModal-BYCcRAFb.js`: `4.02 KB` minified (`1.35 KB` gzip)
  - `ImageFusionModal-DM7Ke4gH.js`: `13.50 KB` minified (`4.15 KB` gzip)
  - `StoryboardToolModal-Brw5Qr-X.js`: `19.13 KB` minified (`4.90 KB` gzip)
  - `MultiAngle3DController-BpKFsaX6.js`: `523.88 KB` minified (`134.49 KB` gzip), now loaded only when opening the 3D image editor.

### Verification

- Local checks:
  - `git diff --check` passed for `deploy/new_html/App.tsx` and `deploy/new_html/components/GenerationPage.tsx`.
  - Local full TypeScript check still reports unrelated pre-existing project errors; no new `App.tsx` or `components/GenerationPage.tsx` errors were reported.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_generation_modal_chunks_20260618-171251`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server checks passed:
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
  - built assets confirmed:
    - `GenerationPage-DA8kw22X.js` around `90K` on disk
    - `MultiAngle3DController-BpKFsaX6.js` around `512K` on disk
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This materially reduces the load/parse cost of entering the generation workflow while preserving the heavy 3D tool for users who actually open it.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Audio Provider Runtime Refresh Messaging Increment

### Changes

- Updated `deploy/services/audio_provider.py` so `GeminiAudioProvider` refreshes `resolve_provider("gemini-tts")` immediately before each Gemini TTS request.
- Updated missing-key messages in `deploy/services/audio_provider.py` and `deploy/api_routes.py` so admin users are directed to the API config page and the runtime refresh action, not a backend restart.
- Kept MiniMax audio's existing runtime refresh call path intact.

### Verification

- Local checks passed:
  - `py_compile` for `deploy/services/audio_provider.py` and `deploy/api_routes.py`
  - `deploy/scripts/check_provider_contract.py`
  - `deploy/scripts/check_admin_api_config_crud.py`
  - `deploy/scripts/check_api_config_runtime_loader.py`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_audio_runtime_messages_20260618-172221`
- Server checks passed:
  - `py_compile` for `api_routes.py` and `services/audio_provider.py`
  - `scripts/check_route_contract.py` -> `228` paths / `284` operations
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This aligns Gemini TTS behavior with the provider registry/runtime model: admin config changes can take effect without requiring a service restart.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 MiniMax Audio Runtime Refresh Increment

### Changes

- Updated `deploy/external_api/audio/minimax_audio.py` so `get_minimax_audio_client()` refreshes the existing singleton from `resolve_provider("minimax")` before returning it.
- Updated `deploy/services/audio_provider.py` so `MinimaxAudioProvider` fetches the current MiniMax client at call time instead of holding a stale instance reference.
- Replaced the root compatibility shim `deploy/minimax_audio.py` with a module alias to `external_api.audio.minimax_audio`, preventing duplicated module-level state such as `AUDIO_UPLOAD_DIR`.

### Verification

- Local checks passed:
  - `py_compile` for `minimax_audio.py`, `external_api/audio/minimax_audio.py`, `services/audio_provider.py`, and `api_routes.py`
  - `tests/test_audio_provider.py` -> `7/7`
  - `tests/test_minimax_tts_sync.py` -> `4/4`
  - `scripts/check_provider_contract.py`
  - `scripts/check_route_contract.py` -> `228` paths / `284` operations
  - `scripts/check_api_config_runtime_loader.py`
- Local runtime probe passed:
  - a live singleton picked up changed `MINIMAX_API_KEY` and `MINIMAX_ENDPOINT` without being recreated.
- Local known test environment issue:
  - `tests/test_api_minimax_tts_enqueue.py` is currently blocked by the existing local `starlette.testclient` / `httpx` incompatibility: `Client.__init__() got an unexpected keyword argument 'app'`.
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_minimax_audio_runtime_refresh_20260618-173003`
- Server checks passed:
  - `py_compile` for `minimax_audio.py`, `external_api/audio/minimax_audio.py`, and `services/audio_provider.py`
  - `scripts/check_route_contract.py` -> `228` paths / `284` operations
  - MiniMax runtime refresh probe
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This tightens the no-restart API management path for MiniMax audio features: voice design, voice clone, sync TTS, music, lyrics, and file operations share the same refreshed provider runtime.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin API Config Layout Increment

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` API config editor:
  - widened the modal from `max-w-2xl` to `max-w-3xl`
  - changed `Endpoint` from a single-line input to a wrapping textarea
  - changed `自定义代理` from a single-line input to a wrapping textarea
  - forced the modal body to hide horizontal overflow while keeping vertical scrolling
- Updated API config cards so long config names wrap naturally instead of being truncated.

### Verification

- Local checks:
  - `git diff --check` passed for `deploy/new_html/admin/AdminSettingsPage.tsx`
  - local Vite build is still blocked by the existing Windows Rollup optional dependency issue: missing `@rollup/rollup-win32-x64-msvc`
  - local `tsc --noEmit` still has unrelated pre-existing project errors; no `AdminSettingsPage.tsx` errors were reported
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_api_config_layout_20260618-173714`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-B2Oxjze4.js`
- Server checks passed:
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This is a UI ergonomics increment for the API management platform. It reduces horizontal scrolling when viewing or editing long endpoints and proxy URLs.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 API Provider Health Cache Invalidation Increment

### Changes

- Added provider health cache deletion helpers in `deploy/services/api_provider_health_monitor.py`.
- Updated `deploy/services/api_config_service.py` so API config create/update/delete invalidates cached provider health for affected providers.
- Updated `deploy/services/api_config_import_service.py` so preset import invalidates provider health cache for all providers it creates or updates.
- Updated `deploy/admin_routes.py` so manual runtime reload clears cached health for the full provider catalog and returns `health_cache_invalidated`.
- Updated contract scripts to cover health cache invalidation:
  - `deploy/scripts/check_admin_api_config_crud.py`
  - `deploy/scripts/check_admin_api_config_import.py`
  - `deploy/scripts/check_provider_health_monitor.py`

### Verification

- Local checks passed:
  - `py_compile` for touched Python files and scripts
  - `scripts/check_admin_api_config_crud.py`
  - `scripts/check_admin_api_config_import.py`
  - `scripts/check_provider_health_monitor.py`
  - `scripts/check_route_contract.py` -> `228` paths / `284` operations
  - `scripts/check_provider_contract.py`
  - `scripts/check_api_config_runtime_loader.py`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_api_health_cache_invalidation_20260618-174415`
- Server checks passed:
  - `py_compile` for touched Python files and scripts
  - `scripts/check_admin_api_config_crud.py`
  - `scripts/check_admin_api_config_import.py`
  - `scripts/check_provider_health_monitor.py`
  - `scripts/check_api_config_runtime_loader.py`
  - `scripts/check_provider_contract.py`
  - `scripts/check_route_contract.py` -> `228` paths / `284` operations
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Live endpoint check passed:
  - `POST /api/admin/api-configs/reload-env`
  - HTTP `200`
  - response included `health_cache_invalidated` with `12` providers
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This prevents stale green/red status badges after changing an API key or endpoint in the admin API management platform.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin API Failover Diagnostics Increment

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` runtime diagnostics:
  - added typed failover/fallback metadata from backend runtime status
  - translated failover reasons such as `missing_key` and `health_error` into Chinese
  - shows inactive fallback chains as `备用链路`
  - shows active fallback selection as `已切换备用` with selected provider/model and reason
- Added `health_cache_invalidated` to the reload-env response type used by the admin UI.

### Verification

- Local checks:
  - `git diff --check` passed for `deploy/new_html/admin/AdminSettingsPage.tsx`
  - local `tsc --noEmit` still has unrelated pre-existing project errors; no `AdminSettingsPage.tsx` errors were reported
  - local Vite build remains blocked by the existing Windows Rollup optional dependency issue: missing `@rollup/rollup-win32-x64-msvc`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_failover_diagnostics_20260618-175153`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-CLajXhE6.js`
- Server checks passed:
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This makes the provider registry failover behavior visible in the API management UI before swapping providers or moving traffic to self-hosted APIs.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin API Config Row Test Increment

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so each API config row now has two distinct checks:
  - `测运行时`: calls `GET /api/admin/api-configs/{provider}/health` and reports provider runtime health.
  - `测配置`: calls `POST /api/admin/api-configs/{config_id}/test` and reports the saved row's direct endpoint/key validation result.
- Added per-row display for config test status, HTTP status, checked time, tested endpoint label, and error message.
- Clear stale row test result after save, toggle, or delete operations for that API config.

### Verification

- Local checks:
  - `git diff --check` passed for `deploy/new_html/admin/AdminSettingsPage.tsx`
  - local `tsc --noEmit` still has unrelated pre-existing project errors; no `AdminSettingsPage.tsx` errors were reported
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_config_row_test_20260618-175628`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-WeZPlu5O.js`
- Server checks passed:
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Live endpoint check passed:
  - `GET /api/admin/api-configs` -> HTTP `200`, `17` configs returned
  - `POST /api/admin/api-configs/apicfg_b87253712b90/test` -> HTTP `200`, response included `checked_at`
  - sampled config currently reports `No API key configured`, which is handled by the UI warning branch
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This separates "provider runtime health" from "this exact saved config row works", making the API management page easier to diagnose.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin API Config Batch Test Increment

### Changes

- Added `POST /api/admin/api-configs/test-all` to batch-test saved API config rows without returning API keys.
- Added `test_all_saved_api_config_health()` and `summarize_config_test_results()` in `deploy/services/api_config_service.py`.
- Added a `测全部配置` button to `deploy/new_html/admin/AdminSettingsPage.tsx`.
  - The existing provider sweep still checks runtime/provider health.
  - The new button checks each saved config row and writes results back into the cards.
- Updated `deploy/scripts/check_route_contract.py` for the intentional route increase:
  - `229` OpenAPI paths
  - `285` OpenAPI operations
- Extended `deploy/scripts/check_admin_api_config_health.py` with batch summary contract coverage.

### Verification

- Local checks passed:
  - `py_compile` for touched Python files and scripts
  - `scripts/check_admin_api_config_health.py`
  - `scripts/check_route_contract.py` -> `229` paths / `285` operations
  - `git diff --check` for touched files
- Local frontend TypeScript check could not run because this Windows shell has no `npm` on PATH; server build was used as the frontend gate.
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_config_batch_test_20260618-181020`
- Server checks passed:
  - `py_compile` for touched Python files and scripts
  - `scripts/check_admin_api_config_health.py`
  - `scripts/check_route_contract.py` -> `229` paths / `285` operations
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-CRfEcQry.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Live endpoint check passed:
  - `POST /api/admin/api-configs/test-all` with one selected config id
  - HTTP `200`
  - summary returned `total=1`, `no_key=1`
  - row result included `checked_at`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- First external health probe immediately after restart briefly returned `502`; local backend was already healthy on `127.0.0.1:6006`, and a retry returned external HTTP `200` with smoke `9/9`.
- This makes provider replacement safer because the admin can now test exact saved rows in bulk, not only the effective runtime provider.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Cluster API Runtime Summary Increment

### Changes

- Updated `deploy/cluster_main.py` startup behavior:
  - removed legacy module-level caching of provider API key env vars such as `DEEPSEEK_API_KEY`, `ARK_API_KEY`, `GEMINI_TEXT_API_KEY`, `GEMINI_IMAGE_API_KEY`, `GPT_IMAGE_API_KEY`, and `SORA2_GPT_IMAGE_API_KEY`
  - removed import-time "missing key" warnings that ran before DB-backed API configs were loaded
  - added resolver-backed startup summary after `load_api_configs_to_env()`
- Updated `deploy/scripts/check_provider_contract.py`:
  - added `cluster_main_env_cache_checks`
  - contract now fails if `cluster_main.py` directly reads managed provider API key/endpoint/proxy env vars instead of using the runtime loader/resolver path

### Verification

- Local checks passed:
  - `py_compile` for `deploy/cluster_main.py` and `deploy/scripts/check_provider_contract.py`
  - `scripts/check_provider_contract.py`
  - `scripts/check_route_contract.py` -> `229` paths / `285` operations
  - `git diff --check` for touched files
  - direct grep found no legacy provider API key env reads in `cluster_main.py`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_cluster_provider_runtime_summary_20260618-182020`
- Server checks passed:
  - `py_compile` for touched files
  - `scripts/check_provider_contract.py`
  - `scripts/check_route_contract.py` -> `229` paths / `285` operations
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Runtime log evidence:
  - `logs/backend.log` and `logs/cluster.log` include `API provider runtime summary: total=17 ready=15 missing_key=2 incomplete=0`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This removes another legacy source of misleading API configuration state. Startup no longer reports provider keys as missing before DB configs have had a chance to load into runtime env.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin Runtime Diagnostics Refresh Increment

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so provider health actions refresh runtime diagnostics without showing the full-page loading state.
- `loadConfigs()` now accepts `{ showLoading: false }` for silent refreshes.
- After `测运行时` and provider `测试全部`/health sweep:
  - provider health cache updates as before
  - the page immediately reloads `runtime_status`
  - failover/备用链路 diagnostics no longer require a manual refresh to become accurate

### Verification

- Local checks passed:
  - `git diff --check` for `deploy/new_html/admin/AdminSettingsPage.tsx`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_runtime_refresh_after_health_20260618-183045`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-C52CLYf4.js`
- Server source check:
  - confirmed `loadConfigs({ showLoading: false })` exists after single provider health and provider health sweep
- Server checks passed:
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This keeps the API management UI honest after health checks: health status and failover diagnostics now update together.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin Import Clears Config Tests Increment

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so `导入预设` clears all cached per-row config test results before reloading API configs.
- This prevents stale `No API key configured` or previous error results from staying visible after preset import copies runtime env keys or updates existing empty-key rows.

### Verification

- Local checks passed:
  - `git diff --check` for `deploy/new_html/admin/AdminSettingsPage.tsx`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_import_clear_config_tests_20260618-184020`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-DkYU5_78.js`
- Server source check:
  - confirmed `setConfigTestMap({})` in the preset import callback
- Server checks passed:
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This keeps the admin API config page from showing stale direct-config test results after a batch import/update.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Route Contract API Config Test Coverage Increment

### Changes

- Updated `deploy/scripts/check_route_contract.py` so the route contract explicitly pins the API config direct-test endpoints:
  - `POST /api/admin/api-configs/{config_id}/test` -> `admin_routes.admin_test_api_config`
  - `POST /api/admin/api-configs/test-all` -> `admin_routes.admin_test_all_api_configs`
- No route count change: expected contract remains `229` OpenAPI paths and `285` operations.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/check_route_contract.py`
  - result: `Route contract OK`, `openapi_paths=229`, `openapi_operations=285`
  - `git diff --check` for `deploy/scripts/check_route_contract.py`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, or `deploy/workflows`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_route_contract_api_config_tests_20260619-023207`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - result: `Route contract OK`, `openapi_paths=229`, `openapi_operations=285`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This prevents future router refactors from accidentally dropping either direct API config test endpoint.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Provider Fallback Env Key-Only Increment

### Changes

- Updated `deploy/services/api_provider_runtime.py` so `fallback_env` only borrows API key material.
- Endpoint/proxy resolution now remains provider-scoped:
  - `SEEDANCE_ENDPOINT`, `SEEDANCE_PROXY_MODE`, `SEEDANCE_CUSTOM_PROXY` for Seedance
  - `VEO_ENDPOINT`, `VEO_PROXY_MODE`, `VEO_CUSTOM_PROXY` for Veo
  - fallback key envs such as `ARK_API_KEY` or `SORA2_API_KEY` no longer cause `ARK_ENDPOINT` / `SORA2_ENDPOINT` / proxy settings to be inherited by the requesting provider
- Added provider contract coverage in `deploy/scripts/check_provider_contract.py`:
  - Seedance can borrow `ARK_API_KEY` but must keep its own preset video endpoint
  - Veo can borrow `SORA2_API_KEY` but must keep its own preset endpoint
  - fallback envs must not borrow custom proxy settings from the fallback provider

### Verification

- Local checks passed:
  - `python -m py_compile deploy/services/api_provider_runtime.py deploy/scripts/check_provider_contract.py`
  - `python deploy/scripts/check_provider_contract.py`
  - result includes `fallback_env_key_only_checks=2`
  - `python deploy/scripts/check_api_config_runtime_loader.py`
  - `python deploy/scripts/check_ai_proxy_failover.py`
  - `python deploy/scripts/check_route_contract.py`
  - route contract remains `229` OpenAPI paths and `285` operations
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_provider_fallback_key_only_20260619-023727`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile services/api_provider_runtime.py scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - result includes `fallback_env_key_only_checks=2`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_ai_proxy_failover.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - route contract remains `229` OpenAPI paths and `285` operations
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This closes the generic version of the earlier Gemini fallback bug: shared/fallback credentials no longer drag another provider's endpoint into the active provider.
- This is especially important for Seedance because `ARK_ENDPOINT` may point at the Doubao image-generation API while Seedance video must use the contents/generation task endpoint.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 External API Endpoint Registry-Only Increment

### Changes

- Removed duplicated third-party default endpoint literals from runtime clients under `deploy/external_api/`:
  - `external_api/video/minimax.py`
  - `external_api/audio/minimax_audio.py`
  - `external_api/video/sora2.py`
  - `external_api/video/veo.py`
  - `external_api/video/seedance.py`
  - `external_api/video/dashscope.py`
  - `external_api/video/wan2.py`
- These clients now rely on `resolve_provider()` for endpoint defaults. `resolve_provider()` reads admin DB-projected env first, then registry presets.
- DashScope/Wan2 URL derivation now starts from the configured endpoint:
  - full `/services/aigc/video-generation/video-synthesis` endpoint is used directly
  - `/api/v1` endpoint appends the video synthesis path
  - `/compatible-mode/v1` endpoint derives the same host's `/api/v1` root
- Added provider contract coverage in `deploy/scripts/check_provider_contract.py`:
  - `external_api/` runtime code must not contain non-docstring third-party endpoint URL literals
  - current result: `external_endpoint_literal_checks=10`

### Verification

- Local checks passed:
  - `python -m py_compile` for all touched external API clients and `scripts/check_provider_contract.py`
  - `python deploy/scripts/check_provider_contract.py`
  - result includes `external_endpoint_literal_checks=10`
  - `python deploy/scripts/check_api_config_runtime_loader.py`
  - `python deploy/scripts/check_ai_proxy_failover.py`
  - `python deploy/scripts/check_route_contract.py`
  - route contract remains `229` OpenAPI paths and `285` operations
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_external_api_endpoint_registry_only_20260619-024550`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile ...`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - result includes `external_endpoint_literal_checks=10`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_ai_proxy_failover.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - route contract remains `229` OpenAPI paths and `285` operations
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This makes the registry/admin configuration the single runtime source for third-party endpoint defaults in `external_api/`.
- Future provider swaps to self-hosted endpoints should not require editing these clients if the admin config/registry preset is updated.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 API Config Single Active Provider Increment

### Changes

- Updated `deploy/services/api_config_service.py` so API config CRUD enforces one active keyed runtime config per provider.
- When a config becomes enabled and has a key, the service automatically disables other enabled keyed rows with the same provider.
- Write responses now include:
  - `disabled_conflicting_config_ids`
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so save/toggle toast messages mention when same-provider conflicts were automatically disabled.
- Updated `deploy/scripts/check_admin_api_config_crud.py` to contract-test both create and update conflict disabling.

### Why

- Runtime env has one key/endpoint slot per provider.
- Before this change, multiple enabled keyed rows for one provider could appear active in the admin UI, but only one row actually won when projected to env.
- The admin UI already diagnosed this as `db_multiple_keyed_enabled_configs`; this change prevents new conflicts from being introduced through CRUD.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/services/api_config_service.py deploy/scripts/check_admin_api_config_crud.py`
  - `python deploy/scripts/check_admin_api_config_crud.py`
  - result includes `same_provider_conflict_disabled=1`
  - `python deploy/scripts/check_provider_contract.py`
  - `python deploy/scripts/check_route_contract.py`
  - route contract remains `229` OpenAPI paths and `285` operations
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Local frontend build note:
  - local PowerShell has no global `npm`
  - direct Vite invocation failed because local `node_modules` is missing Rollup's Windows optional package `@rollup/rollup-win32-x64-msvc`
  - server build is the authoritative frontend build for this deployment and passed
- Redline check passed:
  - no diff under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_api_config_single_active_provider_20260619-025347`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile services/api_config_service.py scripts/check_admin_api_config_crud.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_admin_api_config_crud.py`
  - result includes `same_provider_conflict_disabled=1`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - route contract remains `229` OpenAPI paths and `285` operations
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-J6euWVkz.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- Existing historical duplicate enabled keyed rows are still reported by runtime diagnostics; CRUD now prevents adding or re-enabling a new conflict.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 Admin/API Config Quality Fix Increment

### Changes

- Fixed five admin update handlers in `deploy/admin_routes.py` to use `body.model_dump(exclude_unset=True)` so explicit `False`, `0`, and `None` updates are preserved.
- Fixed `normalize_provider_health_map()` in `deploy/services/api_provider_runtime.py` so mixed health payload maps only skip non-dict entries instead of dropping every provider health row.
- Removed shared `GEMINI_API_KEY` fallback from `gemini-text` and `gemini-image` in `deploy/services/api_provider_registry.py`; these providers now require their own keys and no longer inherit a Gemini TTS endpoint.
- Made `deploy/services/api_config_runtime_loader.py` build a complete env projection first, then atomically reset/write env only after decrypt/projection succeeds.
- Added public `ApiConfigDAO.decrypt_key()` in `deploy/dao/admin/api_config.py` and switched runtime loading away from direct private `_decrypt_key()` calls.
- Moved duplicated `_config_get()` helper to `deploy/utils/config_helpers.py`.
- Updated API config write responses to expose `env_refreshed` and added backend repair support for historical duplicate enabled keyed provider rows:
  - `POST /api/admin/api-configs/repair-conflicts`
  - dry-run mode returns `would_disable`
  - real run disables older duplicate rows and preserves the current runtime winner

### Verification

- Local checks passed:
  - `python -m py_compile ...`
  - `git diff --check ...`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_crud.py`
  - result includes `historical_conflict_repair=1` and `provider_health_invalidations=4`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_provider_contract.py`
  - result includes `health_map_checks=1` and `fallback_env_key_only_checks=2`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_route_contract.py`
  - route contract is now `230` OpenAPI paths and `286` operations because of the new repair endpoint
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_quality_fixes_20260618-190348`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile ...`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_admin_api_config_crud.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - route contract: `230` OpenAPI paths and `286` operations
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend files were changed in this increment, so no frontend rebuild was required.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 API Config Conflict Repair UI Increment

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` to expose the backend historical conflict repair endpoint in the native API config page.
- Added a `修复冲突` toolbar action beside provider health/testing controls.
- The action first calls:
  - `POST /api/admin/api-configs/repair-conflicts` with `{"dry_run": true}`
- If no duplicate enabled keyed provider configs are found, it shows a no-op success message.
- If conflicts are found, it opens a CRM confirm dialog showing:
  - number of affected providers
  - number of old duplicate configs that will be disabled
  - that the current runtime winner will be preserved
- On confirmation it calls the same endpoint with `{"dry_run": false}`, clears stale config test badges, refreshes the list, and reports whether env refresh succeeded.

### Verification

- Local checks passed:
  - `git diff --check -- deploy/new_html/admin/AdminSettingsPage.tsx`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Local frontend build note:
  - local Vite build is still blocked by Rollup's missing Windows optional package `@rollup/rollup-win32-x64-msvc`
  - server build remains the authoritative frontend build for this project
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_api_conflict_repair_ui_20260618-191029`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - built admin settings chunk: `AdminSettingsPage-BFI2DBeS.js`
- Server runtime checks passed:
  - `https://mecha.one/health` -> HTTP `200`
  - `https://mecha.one/admin?item=apiconfig` -> HTTP `200`
  - `POST /api/admin/api-configs/repair-conflicts {"dry_run": true}` -> HTTP `200`, no current conflicts
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This was frontend-only plus static build output, so no service restart was required.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 DashScope Endpoint Helper Increment

### Changes

- Added `deploy/services/api_provider_endpoints.py` as the shared home for provider-specific endpoint URL derivation.
- Moved DashScope video endpoint derivation out of individual clients into:
  - `derive_dashscope_video_urls(endpoint)`
- Updated both clients to use the shared helper:
  - `deploy/external_api/video/dashscope.py`
  - `deploy/external_api/video/wan2.py`
- Supported admin-configured DashScope endpoint shapes now remain consistent across both clients:
  - `.../compatible-mode/v1`
  - `.../api/v1`
  - full `.../api/v1/services/aigc/video-generation/video-synthesis`
  - self-hosted roots following the same task URL contract
- Updated `deploy/scripts/check_provider_contract.py` to prevent reintroducing duplicate DashScope URL derivation inside external clients.

### Verification

- Local checks passed:
  - `python -m py_compile services/api_provider_endpoints.py external_api/video/dashscope.py external_api/video/wan2.py scripts/check_provider_contract.py`
  - `git diff --check ...`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 python scripts/check_provider_contract.py`
  - result includes `endpoint_helper_checks=4`
  - `PYTHONIOENCODING=utf-8 python scripts/check_route_contract.py`
  - route contract remains `230` OpenAPI paths and `286` operations
  - `PYTHONIOENCODING=utf-8 python -m pytest tests/test_dashscope_video_payload_extension.py tests/test_dashscope_wiring_e2e.py -q`
  - result: `8 passed`
  - `python scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_dashscope_endpoint_helper_20260618-191635`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile ...`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - result includes `endpoint_helper_checks=4`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python -m pytest tests/test_dashscope_video_payload_extension.py tests/test_dashscope_wiring_e2e.py -q`
  - result: `8 passed`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This reduces drift between DashScope shared video and Wan2.6 clients while preserving the same runtime behavior.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 Provider Health Endpoint Helper Increment

### Changes

- Extended `deploy/services/api_provider_endpoints.py` with shared health-check URL helpers:
  - `dedupe_urls(urls)`
  - `derive_models_health_urls(endpoint, provider)`
- Updated `deploy/services/api_config_health_service.py` so admin provider health checks reuse the shared endpoint helper instead of maintaining local `/models` derivation rules.
- Kept the old `models_url_from_endpoint()` function as a compatibility wrapper around the shared helper.
- Added health URL derivation coverage in `deploy/scripts/check_admin_api_config_health.py` for:
  - DeepSeek/base endpoints
  - OpenAI-compatible `chat/completions`
  - Ark image generation endpoint
  - Seedance task endpoint
  - self-hosted OpenAI-compatible roots

### Verification

- Local checks passed:
  - `python -m py_compile services/api_provider_endpoints.py services/api_config_health_service.py scripts/check_admin_api_config_health.py scripts/check_provider_contract.py`
  - `git diff --check ...`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 python scripts/check_admin_api_config_health.py`
  - result includes `derived_health_url_cases=5`
  - `PYTHONIOENCODING=utf-8 python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 python scripts/check_route_contract.py`
  - route contract remains `230` OpenAPI paths and `286` operations
  - `python scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_health_endpoint_helper_20260618-192247`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile ...`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_admin_api_config_health.py`
  - result includes `derived_health_url_cases=5`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- Provider endpoint shape handling now lives in one helper module for both runtime clients and admin health checks.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 Cluster Main AI Proxy Decoupling Increment

### Changes

- Updated `deploy/cluster_main.py` so `/api/generate/multi-grid-storyboard` no longer calls `resolve_provider()` or builds Gemini HTTP requests directly.
- The route now reuses `services.ai_proxy_service.generate_gemini_images()`, keeping provider resolution, endpoint selection, proxy config, and upstream request handling in the AI proxy service layer.
- Updated saved metadata for multi-grid storyboard output to record the actual resolved Gemini image model plus `feature=gemini-multi-grid`.
- Updated `deploy/services/ai_proxy_service.py` module comment to reflect the current router/service split.
- Updated `deploy/scripts/check_provider_contract.py` with a `cluster_main_resolver_checks` guard so `cluster_main.py` cannot reintroduce direct provider runtime resolver calls.

### Verification

- Local checks passed:
  - `python -m py_compile cluster_main.py services/ai_proxy_service.py scripts/check_provider_contract.py`
  - `git diff --check ...`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 python scripts/check_provider_contract.py`
  - result includes `cluster_main_resolver_checks=1`
  - `PYTHONIOENCODING=utf-8 python scripts/check_route_contract.py`
  - route contract remains `230` OpenAPI paths and `286` operations
  - `python scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_cluster_main_ai_proxy_decouple_20260618-192922`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py services/ai_proxy_service.py scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - result includes `cluster_main_resolver_checks=1`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- `cluster_main.py` no longer directly calls provider runtime resolvers; provider HTTP details are centralized in service/router layers.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 Admin API Config Routes Split Increment

### Changes

- Added `deploy/admin_api_config_routes.py` to own the admin API provider configuration route set.
- Moved 12 `/api/admin/api-configs*` handlers out of `deploy/admin_routes.py`; the public paths and handler names remain unchanged.
- Kept compatibility exports in `admin_routes.py` for legacy scripts/tests that import API config body models or handler functions from the old module.
- Updated `deploy/scripts/check_route_contract.py` so the expected API config endpoints now resolve to `admin_api_config_routes`, and added a guard preventing `/api-configs` route decorators from returning to `admin_routes.py`.
- Updated `deploy/scripts/check_admin_api_config_import.py` to verify the import-presets HTTP body default in `admin_api_config_routes.py`.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/admin_routes.py deploy/admin_api_config_routes.py deploy/scripts/check_route_contract.py deploy/scripts/check_admin_api_config_import.py`
  - `git diff --check ...`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_route_contract.py`
  - route contract remains `230` OpenAPI paths and `286` operations
  - result includes `admin_api_config_route_handlers=12`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_crud.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_health.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_import.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_api_config_routes_split_20260619-100405`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile admin_routes.py admin_api_config_routes.py scripts/check_route_contract.py scripts/check_admin_api_config_import.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - route contract remains `230` OpenAPI paths and `286` operations
  - result includes `admin_api_config_route_handlers=12`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_admin_api_config_crud.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_admin_api_config_health.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_admin_api_config_import.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This is an MVC cleanup increment only; it does not change provider resolution behavior or API key semantics.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 Provider Health Cache Endpoint Increment

### Changes

- Added `GET /api/admin/api-configs/health/cache` in `deploy/admin_api_config_routes.py`.
- The new endpoint is admin-authenticated, read-only, and returns cached provider health rows from Redis without calling external providers.
- Added `summarize_provider_health_results()` in `deploy/services/api_provider_health_monitor.py` so manual sweeps and cache reads share the same summary fields: `total`, `ok`, `error`, `no_key`, `unknown`.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` with a lightweight "刷新状态" action that refreshes health indicators from the cache endpoint without reloading the full API config list.
- Fixed the API config toolbar's `loadConfigs` click handler to avoid passing the click event as loader options.
- Updated `deploy/scripts/check_route_contract.py` for the new public API surface:
  - OpenAPI paths: `231`
  - OpenAPI operations: `287`
  - admin API config handlers: `13`
- Extended `deploy/scripts/check_provider_health_monitor.py` to call the new admin health cache handler with fake Redis and verify summary/settings output.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/admin_api_config_routes.py deploy/services/api_provider_health_monitor.py deploy/scripts/check_route_contract.py deploy/scripts/check_provider_health_monitor.py`
  - `git diff --check ...`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_route_contract.py`
  - result: `openapi_paths=231`, `openapi_operations=287`, `admin_api_config_route_handlers=13`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_provider_health_monitor.py`
  - result includes `admin_health_cache_endpoint=1`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_health.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_crud.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_import.py`
- Local frontend build note:
  - `vite build` could not be used as local proof because the Windows node_modules install is missing Rollup's optional package `@rollup/rollup-win32-x64-msvc`.
  - `tsc --noEmit` still reports unrelated existing project-wide type errors; after the local fix, it reports no `AdminSettingsPage.tsx` errors.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_provider_health_cache_endpoint_20260619-101334`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile admin_api_config_routes.py services/api_provider_health_monitor.py scripts/check_route_contract.py scripts/check_provider_health_monitor.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - result: `openapi_paths=231`, `openapi_operations=287`, `admin_api_config_route_handlers=13`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_health_monitor.py`
  - result includes `admin_health_cache_endpoint=1`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_admin_api_config_health.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - server build emitted `dist/assets/AdminSettingsPage-BJG9uMJv.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Smoke and endpoint checks passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
  - `GET https://mecha.one/api/admin/api-configs/health/cache` with admin token -> HTTP `200`
  - response includes `success=True`, summary keys `error/no_key/ok/total/unknown`, monitor settings keys, and `provider_health_count=12`

### Notes

- This improves the API management platform's status refresh path and reduces unnecessary full config reloads in the admin UI.
- No external provider calls are made by the new cache endpoint.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 AI Proxy Failover Helper Increment

### Changes

- Added reusable failover helpers in `deploy/services/ai_proxy_service.py`:
  - `provider_health_scope_for_failover(provider)`
  - `resolve_ai_proxy_provider(provider, model)`
- The helper derives health-cache scope from the registry fallback chain instead of hardcoding provider pairs in each handler.
- Updated `generate_gemini_text()` to use `resolve_ai_proxy_provider("gemini-text", model)` while preserving existing Gemini-text-to-DeepSeek behavior.
- Updated `deploy/scripts/check_ai_proxy_failover.py` to verify:
  - failover health scope is derived from the registry (`gemini-text` -> `deepseek`)
  - Gemini text still falls back to DeepSeek when Gemini is unhealthy/missing key
  - Gemini text stays on primary when Gemini is healthy
- Updated `deploy/scripts/check_provider_contract.py` so static runtime wiring recognizes `resolve_ai_proxy_provider()` as a provider resolver entrypoint.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/services/ai_proxy_service.py deploy/scripts/check_ai_proxy_failover.py deploy/scripts/check_provider_contract.py`
  - `git diff --check ...`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_provider_contract.py`
  - result includes `resolve_provider_references=19`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_ai_proxy_failover.py`
  - result includes `failover_health_scope_from_registry=1`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_route_contract.py`
  - route contract remains `231` OpenAPI paths and `287` operations
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_admin_api_config_health.py`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/check_provider_health_monitor.py`
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_ai_proxy_failover_helper_20260619-102313`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile services/ai_proxy_service.py scripts/check_ai_proxy_failover.py scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_provider_contract.py`
  - result includes `resolve_provider_references=19`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_ai_proxy_failover.py`
  - result includes `failover_health_scope_from_registry=1`
  - `PYTHONIOENCODING=utf-8 .venv/bin/python scripts/check_route_contract.py`
  - route contract remains `231` OpenAPI paths and `287` operations
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This is a service-layer refactor only; it does not change public API routes, request payloads, response payloads, or provider registry data.
- Future compatible provider substitutions can now share one health-aware resolver path instead of duplicating failover logic per handler.
- No files under `pipeline/`, `agent_routes.py`, `workflows/*.json`, `services/task_service.py`, `core/task_queue.py`, or `core/worker.py` were modified.

## 2026-06-19 Prompt Router Extraction Increment

### Changes

- Extracted the prompt template endpoints from `deploy/cluster_main.py` into `deploy/routers/prompts.py`.
- Registered the new router through `create_prompt_router(require_auth_dependency=require_auth)`.
- Preserved the existing public API surface:
  - `GET /api/prompts/{template_type}`
  - `POST /api/prompts/{template_type}`
  - `DELETE /api/prompts/{template_type}`
- Removed direct `PromptTemplate` / `PromptTemplateDAO` imports from `cluster_main.py`.
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - the three prompt endpoints belong to `routers.prompts`
  - `cluster_main.py` does not re-register `/api/prompts/*`
  - `routers/prompts.py` owns exactly 3 prompt handlers

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/prompts.py deploy/scripts/check_route_contract.py`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `prompt_route_handlers=3`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_prompt_router_extraction_20260619-025530`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/prompts.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/prompts.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `prompt_route_handlers=3`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
  - `GET https://mecha.one/api/prompts/rewrite` with admin token -> HTTP `200`, `success=True`, `template_type=rewrite`, `content_len=229`

### Notes

- The route count and request/response behavior stayed unchanged.

## 2026-06-19 Legacy API Edit Link Fix

### Changes

- Fixed the API config page's "旧版编辑" action in `deploy/new_html/admin/AdminSettingsPage.tsx`.
- The link now stays inside the React admin shell at `/admin/settings?item=legacy-apiconfig` instead of opening top-level `/admin-legacy/`.
- `AdminSettingsPage` maps `item=legacy-apiconfig` to the legacy iframe source:
  - `/admin-legacy/?embed=1&v=20260618h&page=apiconfig#apiconfig`
- Updated `AdminLayout` login guard to preserve `pathname + search + hash` in the login redirect state, so deep links such as `/admin/settings?item=legacy-apiconfig` return to the intended page after login.
- Updated `AdminSidebar` and `adminMenu` so the legacy API config view keeps the System Settings / API Config navigation context active.

### Verification

- Local checks:
  - TypeScript filter check reported no errors for `AdminSettingsPage.tsx`, `AdminLayout.tsx`, `AdminSidebar.tsx`, or `adminMenu.ts`.
  - Local Vite build could not run because the Windows node_modules install is missing Rollup optional package `@rollup/rollup-win32-x64-msvc`; server build was used as authoritative build proof.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_legacy_api_edit_link_20260619-030322`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - emitted `dist/assets/AdminSettingsPage-BwBr8hXR.js` and `dist/assets/AdminLayout-DdzrevSc.js`
- Online build checks passed:
  - `/admin/settings?item=apiconfig` loads `index-BSMP4Ry0.js`
  - `AdminSettingsPage-BwBr8hXR.js` contains `legacy-apiconfig`
  - `AdminSettingsPage-BwBr8hXR.js` contains `/admin/settings?item=legacy-apiconfig`
  - `AdminSettingsPage-BwBr8hXR.js` contains `/admin-legacy/?embed=1`
  - `AdminSettingsPage-BwBr8hXR.js` no longer contains the top-level `/admin-legacy/?v=` edit link
  - Source check confirms `AdminLayout.tsx` preserves `location.search` and `location.hash` in login redirect state
- Smoke test passed:
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This fixes the observed loop where the old edit link returned to the login page and then back to the same native API config page.
- No backend route changes were required.

## 2026-06-19 Cluster Status Router Extraction Increment

### Changes

- Extracted cluster status endpoints from `deploy/cluster_main.py` into `deploy/routers/cluster_status.py`.
- Preserved the existing public API surface:
  - `GET /api/cluster/stats`
  - `GET /api/cluster/nodes`
  - `GET /health`
- Registered the router through `create_cluster_status_router(...)`, passing runtime dependencies from `cluster_main.py`:
  - `require_auth`
  - `cluster_manager`
  - `workers`
  - `redis_client`
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - the three status endpoints belong to `routers.cluster_status`
  - `cluster_main.py` does not re-register those paths
  - `routers/cluster_status.py` owns exactly 3 route handlers

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/cluster_status.py deploy/scripts/check_route_contract.py`
  - redline diff check: no modified files under `deploy/pipeline`, `deploy/agent_routes.py`, `deploy/workflows`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `cluster_status_route_handlers=3`
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_cluster_status_router_20260619-031131`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/cluster_status.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/cluster_status.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `cluster_status_route_handlers=3`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `GET https://mecha.one/health` -> HTTP `200`, `status=healthy`, `redis=healthy`, `agent_only_mode=True`
  - `GET https://mecha.one/api/cluster/stats` with admin token -> HTTP `200`, `success=True`
  - `GET https://mecha.one/api/cluster/nodes` with admin token -> HTTP `200`, `success=True`, `nodes=list`
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; the work reduces `cluster_main.py` ownership and adds a route-contract guard for this domain.

## 2026-06-19 Frontend Pages Router Extraction Increment

### Changes

- Extracted frontend shell/page routes from `deploy/cluster_main.py` into `deploy/routers/frontend_pages.py`.
- Preserved the existing public page surface:
  - `GET /`, `/login`, `/favicon.ico`, `/favicon.png`
  - legacy redirects: `/editor`, `/materials`, `/generation`, `/workspace`, `/app`
  - SPA entries: `/projects`, `/projects/{path:path}`, `/canvas`, `/canvas/{path:path}`
  - React Admin shell entries: `/admin`, `/admin/`, `/admin/login`, `/admin/operations`, `/admin/settings` and their subpaths
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - these 21 frontend page registrations belong to `routers.frontend_pages`
  - `cluster_main.py` no longer registers those page decorators
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/frontend_pages.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `frontend_page_route_handlers=21`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_frontend_pages_router_20260619-032334`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/frontend_pages.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/frontend_pages.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `frontend_page_route_handlers=21`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `GET https://mecha.one/login` -> HTTP `200`
  - `GET https://mecha.one/projects` -> HTTP `200`
  - `GET https://mecha.one/admin/settings?item=apiconfig` -> HTTP `200`
  - `GET https://mecha.one/admin/settings?item=legacy-apiconfig` -> HTTP `200`
  - `GET https://mecha.one/favicon.ico` -> HTTP `200`
  - `GET https://mecha.one/editor` -> HTTP `301`, `Location=/projects`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; this only continues the MVC/router extraction and keeps the admin shell routes explicit so deep refreshes still return the React SPA entry.

## 2026-06-19 User Session Router Extraction Increment

### Changes

- Extracted current-user session/self-service endpoints from `deploy/cluster_main.py` into `deploy/routers/user_session.py`.
- Preserved the existing public API surface:
  - `POST /api/logout`
  - `GET /api/user/info`
  - `GET /api/me/organizations`
  - `POST /api/me/organizations/{org_id}/leave`
- Kept `/api/login` in `cluster_main.py` for now because it is still coupled to hardcoded-user fallback and DB user auto-provisioning; this should be split into an auth service before moving.
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - these 4 current-user endpoints belong to `routers.user_session`
  - `cluster_main.py` no longer registers those route decorators
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/user_session.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `user_session_route_handlers=4`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_user_session_router_20260619-033339`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/user_session.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/user_session.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `user_session_route_handlers=4`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `POST https://mecha.one/api/login` -> HTTP `200`, token returned
  - `GET https://mecha.one/api/user/info` -> HTTP `200`, `username=admin`
  - `GET https://mecha.one/api/me/organizations` -> HTTP `200`, `organizations=list`
  - `POST https://mecha.one/api/logout` -> HTTP `200`, `message=登出成功`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; this is a low-coupling MVC extraction step that makes auth/user self-service ownership explicit while leaving the more coupled login path for a later service extraction.

## 2026-06-19 Workspace Router Extraction Increment

### Changes

- Extracted workspace compatibility/session endpoints from `deploy/cluster_main.py` into `deploy/routers/workspace.py`.
- Preserved the existing public API surface:
  - `POST /api/workspace/save-task`
  - `GET /api/workspace/tasks`
  - `POST /api/workspace/save-session`
  - `POST /api/workspace/save-beacon`
  - `GET /api/workspace/load-session`
- Injected existing runtime dependencies into the router instead of reading hidden globals:
  - `require_auth`
  - `jwt_auth`
  - `ProjectDAO`
  - `WorkspaceSessionDAO`
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - these 5 workspace endpoints belong to `routers.workspace`
  - `cluster_main.py` no longer registers those route decorators
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/workspace.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `workspace_route_handlers=5`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_workspace_router_20260619-034121`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/workspace.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/workspace.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `workspace_route_handlers=5`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `POST https://mecha.one/api/login` -> HTTP `200`, token returned
  - `GET https://mecha.one/api/workspace/tasks` -> HTTP `200`, `tasks=list`
  - `POST https://mecha.one/api/workspace/save-session` -> HTTP `200`, `message=会话已保存`
  - `GET https://mecha.one/api/workspace/load-session?scope=codex-smoke-workspace-router` -> HTTP `200`, `session=dict`
  - `POST https://mecha.one/api/workspace/save-task` with a valid compatibility payload -> HTTP `200`, `message=任务保存已迁移到session系统`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; `save-task` and `workspace/tasks` remain compatibility endpoints while active session persistence stays on `WorkspaceSessionDAO`.

## 2026-06-19 Task Router Extraction Increment

### Changes

- Extracted task creation/status/deletion/list/SSE endpoints from `deploy/cluster_main.py` into `deploy/routers/tasks.py`.
- Preserved the existing public API surface:
  - `POST /api/generate`
  - `GET /api/task/{task_id}`
  - `DELETE /api/task/{task_id}`
  - `DELETE /api/task/{task_id}/delete`
  - `GET /api/tasks/stream`
  - `GET /api/tasks`
- Injected existing runtime dependencies into the router instead of reading hidden globals:
  - `require_auth`
  - `jwt_auth`
  - `task_service`
  - `TaskDAO`
  - `db_manager`
  - `pubsub_redis_client`
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - these 6 task endpoints belong to `routers.tasks`
  - `cluster_main.py` no longer registers those route decorators
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/tasks.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `task_route_handlers=6`
  - `cluster_main.py` line count reduced to `3541`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_task_router_20260619-035235`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/tasks.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/tasks.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `task_route_handlers=6`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `POST https://mecha.one/api/login` -> HTTP `200`, token returned
  - `GET https://mecha.one/api/tasks?limit=3` -> HTTP `200`, `tasks=list`
  - `GET https://mecha.one/api/task/codex-missing-task-router-check` -> HTTP `404`, `detail=任务不存在`
  - `GET https://mecha.one/api/tasks/stream?token=...` -> HTTP `200`, `event: ready`, `data: {}`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; this only moves the FastAPI handlers. The task queue/core/worker redline files were not modified.

## 2026-06-19 Fallback Static Router Extraction Increment

### Changes

- Extracted legacy one-segment static image serving and final unknown-path guard from `deploy/cluster_main.py` into `deploy/routers/fallback_static.py`.
- Preserved the existing public route surface:
  - `GET /{filename}`
  - `GET /{path:path}`
- Registered `create_fallback_static_router(...)` after all API routers so `/{path:path}` remains the final HTTP route.
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - the two fallback routes belong to `routers.fallback_static`
  - `cluster_main.py` no longer registers those route decorators
  - `/{path:path}` is the last HTTP route at runtime
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/fallback_static.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `fallback_static_route_handlers=2`
  - `cluster_main.py` line count reduced to `3460`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_fallback_static_router_20260619-040227`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/fallback_static.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/fallback_static.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `fallback_static_route_handlers=2`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `GET https://mecha.one/login` -> HTTP `200`
  - `GET https://mecha.one/projects` -> HTTP `200`
  - `GET https://mecha.one/favicon.ico` -> HTTP `200`, `content-type=image/png`
  - `GET https://mecha.one/wp-login.php` -> HTTP `404`
  - `GET https://mecha.one/codex-definitely-missing-route` -> HTTP `404`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; the final 404/scanner guard is now contract-protected against accidental route-order regressions.

## 2026-06-19 Generation Router Extraction Increment

### Changes

- Extracted image/material generation endpoints from `deploy/cluster_main.py` into `deploy/routers/generation.py`.
- Preserved the existing public API surface:
  - `POST /api/generate/image`
  - `POST /api/generate/comfyui-workflow`
  - `POST /api/generate/angle-adjust`
  - `POST /api/generate/human-multi-angle`
  - `POST /api/generate/around-angle`
  - `POST /api/generate/matting`
  - `POST /api/generate/image-fusion`
  - `POST /api/generate/panorama-360`
  - `POST /api/generate/panorama-fusion`
  - `POST /api/generate/auto-storyboard`
  - `POST /api/generate/multi-grid-storyboard`
  - `POST /api/materials/process`
- Injected existing runtime dependencies into the router:
  - `require_auth`
  - `task_service`
  - `_storage_path_safe`
  - `generate_gemini_images`
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - these 12 generation endpoints belong to `routers.generation`
  - `cluster_main.py` no longer registers those route decorators
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/generation.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `generation_route_handlers=12`
  - `cluster_main.py` line count reduced to `2802`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_generation_router_20260619-041449`
- Uploaded to server:
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/generation.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/generation.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `generation_route_handlers=12`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `POST https://mecha.one/api/login` -> HTTP `200`, token returned
  - `POST https://mecha.one/api/generate/image` with `engine=gemini` -> HTTP `200`, existing frontend-direct message
  - `POST https://mecha.one/api/generate/image` with `engine=comfyui` and no refs -> HTTP `400`, existing validation detail
  - `POST https://mecha.one/api/generate/comfyui-workflow` with invalid workflow -> HTTP `400`
  - `POST https://mecha.one/api/generate/matting` with invalid matting type -> HTTP `400`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; this moves the generation task HTTP handlers only. Redline task queue/core/worker/pipeline files were not modified.

## 2026-06-19 Admin Legacy API Editor Redirect Fix

### Changes

- Fixed the API provider management page's `旧版编辑` action so it uses React Router navigation instead of a full-page anchor reload.
- Admin auth redirects now preserve the attempted admin URL in `/admin/login?redirect=...`.
- Admin login now reads `redirect` from the URL before falling back to React Router state, so deep links survive refreshes and expired sessions.
- Shared admin 401 handling in `new_html/services/apiService.ts` now redirects to `/admin/login?redirect=...` instead of dropping the user at a generic admin login page.

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_legacy_redirect_20260619-042502`
- Uploaded to server:
  - `/home/Administrator/deploy/new_html/admin/AdminSettingsPage.tsx`
  - `/home/Administrator/deploy/new_html/admin/AdminLayout.tsx`
  - `/home/Administrator/deploy/new_html/admin/AdminLoginPage.tsx`
  - `/home/Administrator/deploy/new_html/services/apiService.ts`
- Server frontend build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - result: `vite build` completed successfully
- Online checks passed:
  - `GET https://mecha.one/admin/settings?item=apiconfig` -> HTTP `200`
  - `GET https://mecha.one/admin/settings?item=legacy-apiconfig` -> HTTP `200`
  - `GET https://mecha.one/admin/login?redirect=%2Fadmin%2Fsettings%3Fitem%3Dlegacy-apiconfig` -> HTTP `200`
  - Built assets contain the new `redirect=` login flow and `legacy-apiconfig` navigation path.
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- Local Vite build could not run because this Windows workspace is missing Rollup's optional native package `@rollup/rollup-win32-x64-msvc`; the production Linux server build passed.

## 2026-06-19 Project Router Extraction Increment

### Changes

- Extracted legacy project compatibility endpoints from `deploy/cluster_main.py` into `deploy/routers/projects.py`.
- Preserved the existing public API surface:
  - `POST /api/projects/save`
  - `GET /api/projects/list`
  - `GET /api/projects/{project_id}`
  - `DELETE /api/projects/{project_id}`
  - `GET /api/projects/{project_id}/images/{shot_id}`
  - `POST /api/projects/{project_id}/export-to-video`
  - `POST /api/projects/{project_id}/clear-video-tasks`
- Moved the project Base64 image persistence helper with the save route so project storage behavior remains colocated with project HTTP handlers.
- Injected existing dependencies into the router:
  - `require_auth`
  - `ProjectDAO`
  - `FileDAO`
  - `VersionDAO`
  - `parse_jsonb_field`
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - these 7 project endpoints belong to `routers.projects`
  - `cluster_main.py` no longer registers those project route decorators
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/projects.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `project_route_handlers=7`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_projects_router_20260619-043900`
- Uploaded to server:
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/projects.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/projects.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `project_route_handlers=7`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `POST https://mecha.one/api/login` -> token returned
  - `GET https://mecha.one/api/projects/list` -> success, project list returned
  - `GET https://mecha.one/api/projects/list?limit=1` -> success
  - `GET https://mecha.one/api/projects/{project_id}?thumbnail_only=true` -> success
  - `GET https://mecha.one/api/projects/{project_id}?thumbnail_only=false` -> success
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; this moves project HTTP handlers only. Redline task queue/core/worker/pipeline/agent/workflow files were not modified.

## 2026-06-19 Auth Router Extraction Increment

### Changes

- Extracted the public login endpoint from `deploy/cluster_main.py` into `deploy/routers/auth.py`.
- Preserved the existing public API surface:
  - `POST /api/login`
- Kept the existing login flow:
  - built-in credential validation first
  - database user/password validation fallback
  - disabled account rejection
  - session token creation through the existing `create_session_token`
  - best-effort DB user sync/default permission assignment
- Injected existing runtime dependencies into the router:
  - `verify_credentials`
  - `create_session_token`
  - `db_manager` via `get_db_manager`
  - `logger`
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - `/api/login` belongs to `routers.auth`
  - `cluster_main.py` no longer registers the login route decorator
  - OpenAPI route counts remain unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/auth.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `auth_route_handlers=1`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_auth_router_20260619-044956`
- Uploaded to server:
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/auth.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/auth.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `auth_route_handlers=1`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online endpoint checks passed:
  - `POST https://mecha.one/api/login` with valid admin credentials -> HTTP `200`, token returned
  - `POST https://mecha.one/api/login` with invalid password -> HTTP `401`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No behavior change is intended; this moves the login HTTP handler only. Redline task queue/core/worker/pipeline/agent/workflow files were not modified.

## 2026-06-19 Legacy API Editor Redirect Fix

### Changes

- Fixed the legacy admin API editor fallback route:
  - direct `/admin-legacy/?page=apiconfig#apiconfig` access now folds into `/admin/settings?item=legacy-apiconfig`
  - it no longer folds back into the native `/admin/settings?item=apiconfig` page
- Added a legacy admin API 401 handler:
  - clears stale `admin_session_*` values
  - redirects the top-level window to `/admin/login`
  - preserves the intended legacy admin shell target
- Bumped legacy admin cache keys:
  - `/admin-legacy/app.js?v=20260619a`
  - `/admin-legacy/style.css?v=20260619a`
  - React iframe `LEGACY_VER=20260619a`

### Verification

- Local checks:
  - `node --check deploy/admin/app.js` passed with bundled Node
  - single-file TypeScript JSX transpile for `deploy/new_html/admin/AdminSettingsPage.tsx` passed
- Full local `new_html` build could not run because local `node_modules` is missing Rollup's Windows optional package `@rollup/rollup-win32-x64-msvc`; this is an environment dependency issue. Server build is required for final verification.

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_legacy_api_editor_redirect_20260619-055655`
- Uploaded to server:
  - `/home/Administrator/deploy/admin/app.js`
  - `/home/Administrator/deploy/admin/index.html`
  - `/home/Administrator/deploy/new_html/admin/AdminSettingsPage.tsx`
  - `/home/Administrator/Agent.md`
  - `/home/Administrator/deploy/Agent.md`
- Server checks passed:
  - `node --check admin/app.js`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online checks passed:
  - built React asset contains `LEGACY_VER=20260619a`
  - legacy static `admin/app.js` contains `legacyShellItem()` mapping `apiconfig` to `legacy-apiconfig`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No redline files were modified.

## 2026-06-19 Admin Compatibility Router Extraction

### Changes

- Extracted the remaining live `cluster_main.py` admin compatibility endpoints into `deploy/routers/admin_compat.py`:
  - `GET /api/admin/stats`
  - `GET /api/admin/logs`
  - `POST /api/admin/users/create`
  - `DELETE /api/admin/users/{user_id}`
- Preserved the legacy API surface used by the React admin shell.
- `cluster_main.py` now has no direct `@app.get/post/put/delete/patch` route decorators.
- Injected runtime dependencies into the router instead of importing global state:
  - `require_auth`
  - dynamic `get_db_manager()`
  - `_online_users`
  - `DEFAULT_USERS`
  - `SUPER_ADMIN`
  - `logger`
- Updated `deploy/scripts/check_route_contract.py` to assert:
  - the 4 compatibility endpoints belong to `routers.admin_compat`
  - `cluster_main.py` no longer owns those route decorators
  - OpenAPI route counts stay unchanged

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/admin_compat.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py --show-routes`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `admin_compat_route_handlers=4`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_compat_router_20260619-060713`
- Uploaded to server:
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/admin_compat.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py routers/admin_compat.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`, `admin_compat_route_handlers=4`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
- Online checks passed:
  - `POST https://mecha.one/api/login` -> HTTP `200`, token returned
  - `GET https://mecha.one/api/admin/stats` -> HTTP `200`
  - `GET https://mecha.one/api/admin/logs?limit=1` -> HTTP `200`
  - `POST https://mecha.one/api/admin/users/create` without token -> HTTP `401`
  - `DELETE https://mecha.one/api/admin/users/codex_should_not_delete` without token -> HTTP `401`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required; this increment only moves backend route ownership.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Cluster Main Legacy Admin Cleanup

### Changes

- Removed two non-routed legacy reference functions from `deploy/cluster_main.py`:
  - `get_admin_users`
  - `update_user_permissions`
- Kept the live admin behavior unchanged; the active implementations remain in `deploy/admin_routes.py`.
- Reduced `cluster_main.py` to 845 lines.
- Strengthened `deploy/scripts/check_route_contract.py` with a new guard:
  - `cluster_main.py` must not define direct `@app.get/post/put/delete/patch` HTTP route decorators
  - `cluster_main.py` must not keep the legacy admin reference functions above

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_cluster_main_legacy_cleanup_20260619-061444`
- Uploaded to server:
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy && .venv/bin/python -m py_compile cluster_main.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - result remains `openapi_paths=231`, `openapi_operations=287`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- First smoke immediately after restart saw a transient HTTP `502` during service warm-up; `/health` returned `200` after a short wait, and the subsequent smoke passed `9/9`.
- No frontend build was required.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Admin Legacy API Editor Cache Refresh

### Changes

- Bumped the legacy API editor embed version in `deploy/new_html/admin/AdminSettingsPage.tsx` from `20260619a` to `20260619b`.
- Bumped legacy static admin asset versions in `deploy/admin/index.html`:
  - `style.css?v=20260619b`
  - `app.js?v=20260619b`
- Added no-cache headers for `/admin-legacy*` responses in `deploy/cluster_main.py` so cached legacy HTML/JS cannot keep sending users back through the old login flow.

### Verification

- Local backend compile passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py`
- Local frontend build was not usable because the local Windows `node_modules` is missing Rollup's optional `@rollup/rollup-win32-x64-msvc` package; server build was used instead.

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_legacy_cache_20260619-070923`
- Uploaded to server:
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/admin/index.html`
  - `/home/Administrator/deploy/new_html/admin/AdminSettingsPage.tsx`
- Server checks passed:
  - `.venv/bin/python -m py_compile cluster_main.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - emitted `dist/assets/AdminSettingsPage-K3xr03qi.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `GET https://mecha.one/admin/settings?item=legacy-apiconfig` -> HTTP `200`
  - `HEAD https://mecha.one/admin-legacy/?v=check` returns `cache-control: no-cache, no-store, must-revalidate`
  - `AdminSettingsPage-K3xr03qi.js` contains `20260619b`, `/admin/settings?item=legacy-apiconfig`, and `/admin-legacy/?embed=1`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This is a cache hardening patch for the already-correct admin shell redirect path; it prevents stale legacy chunks from keeping the old behavior alive in browsers.
- The first external `/health` check immediately after restart briefly returned `502`; a retry returned HTTP `200`.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Episode Router Extraction

### Changes

- Extracted 7 episode route handlers from `deploy/api_routes.py` into `deploy/routers/episodes.py`:
  - episode list/create/detail/update/delete
  - episode duplicate
  - episode reorder
- Kept `api_routes.py` as the compatibility registration point so the public API surface remains unchanged.
- Reduced `api_routes.py` to 1485 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - runtime endpoints must resolve to `routers.episodes`
  - `api_routes.py` must not reintroduce direct handlers for the 7 migrated routes
  - `routers/episodes.py` must own exactly 7 route registrations

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/episodes.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`, `episode_route_handlers=7`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_episodes_router_20260619_074417`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/episodes.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/episodes.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `GET https://mecha.one/api/projects/{project_id}/episodes` with admin token -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required.
- The first external `/health` check immediately after restart briefly returned `502`; a retry returned HTTP `200`.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Content Version Router Extraction

### Changes

- Extracted 6 version and text-content route handlers from `deploy/api_routes.py` into `deploy/routers/content_versions.py`:
  - version create/detail/restore/delete
  - text create/detail
- Kept `api_routes.py` as the compatibility registration point so the public API surface remains unchanged.
- Reduced `api_routes.py` to 1619 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - runtime endpoints must resolve to `routers.content_versions`
  - `api_routes.py` must not reintroduce direct handlers for the 6 migrated routes
  - `routers/content_versions.py` must own exactly 6 route registrations

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/content_versions.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`, `content_version_route_handlers=6`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_content_versions_router_20260619_073512`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/content_versions.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/content_versions.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required.
- No existing version record was available during the live read-only endpoint probe, so `/api/versions/{version_id}` runtime behavior is covered by the route contract and smoke coverage rather than a specific version-detail response.
- The first external `/health` check immediately after restart briefly returned `502`; a retry returned HTTP `200`.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Project Admin Router Extraction

### Changes

- Extracted 7 project settings and membership route handlers from `deploy/api_routes.py` into `deploy/routers/project_admin.py`:
  - project update
  - archive / unarchive
  - project members list/add/update/remove
- Kept `api_routes.py` as the compatibility registration point so the public API surface remains unchanged.
- Reduced `api_routes.py` to 1827 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - runtime endpoints must resolve to `routers.project_admin`
  - `api_routes.py` must not reintroduce direct handlers for the 7 migrated routes
  - `routers/project_admin.py` must own exactly 7 route registrations

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/project_admin.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`, `project_admin_route_handlers=7`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_project_admin_router_20260619_072734`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/project_admin.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/project_admin.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `GET https://mecha.one/api/projects/{project_id}/members` with admin token -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required.
- The first external `/health` check immediately after restart briefly returned `502`; a retry returned HTTP `200`.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Task Notification Router Extraction

### Changes

- Extracted 9 task recovery and notification route handlers from `deploy/api_routes.py` into `deploy/routers/task_notifications.py`:
  - recent task recovery and task files
  - active task list and task completion notifications
  - persisted notification count/list/read/read-all/dismiss
- Kept `api_routes.py` as the compatibility registration point so the public API surface remains unchanged.
- Reduced `api_routes.py` to 2005 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - runtime endpoints must resolve to `routers.task_notifications`
  - `api_routes.py` must not reintroduce direct handlers for the 9 migrated routes
  - `routers/task_notifications.py` must own exactly 9 route registrations

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/task_notifications.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`, `task_notification_route_handlers=9`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_task_notifications_router_20260619_071926`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/task_notifications.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/task_notifications.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `GET https://mecha.one/api/tasks/active` with admin token -> HTTP `200`
  - `GET https://mecha.one/api/notifications/unread-count` with admin token -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required.
- The first external `/health` check immediately after restart briefly returned `502`; a retry returned HTTP `200`.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Canvas Router Extraction

### Changes

- Extracted 10 canvas route handlers from `deploy/api_routes.py` into `deploy/routers/canvas.py`:
  - canvas board CRUD
  - canvas node CRUD
  - canvas connection create/delete
- Kept `api_routes.py` as the compatibility registration point so the public API surface remains unchanged.
- Reduced `api_routes.py` to 2178 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - runtime endpoints must resolve to `routers.canvas`
  - `api_routes.py` must not reintroduce direct `/api/canvas/*` handlers
  - `routers/canvas.py` must own exactly 10 route registrations

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/canvas.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_audio_provider_runtime.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`, `canvas_route_handlers=10`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_canvas_router_20260619_070025`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/canvas.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/canvas.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_audio_provider_runtime.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Admin Legacy API Config Redirect Fix

### Changes

- Fixed the `/admin/settings?item=apiconfig` "legacy edit" entry so it no longer loses the intended target when admin login is required.
- Added a small admin-only post-login redirect handoff in `deploy/new_html/admin/adminAuth.ts`.
- Updated `deploy/new_html/admin/AdminLoginPage.tsx` to accept same-origin admin redirects and fall back to the saved redirect target.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so the legacy API config button saves `/admin/settings?item=legacy-apiconfig` before redirecting to login.
- Updated `deploy/admin/app.js` so legacy iframe 401 redirects also save the same target before sending the top window to `/admin/login`.

### Verification

- Local focused TypeScript check passed for:
  - `admin/AdminSettingsPage.tsx`
  - `admin/AdminLoginPage.tsx`
  - `admin/adminAuth.ts`
- Local full Vite build was blocked because this Windows workspace is missing Rollup's optional native package; server build was used as the deploy validation.
- Server `npm run build` in `/home/Administrator/deploy/new_html` passed.
- Server `sudo systemctl restart drama` completed.
- `systemctl is-active drama` -> `active`
- `GET https://mecha.one/health` -> HTTP `200`
- `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_legacy_redirect_20260619_155541`
- Uploaded to server:
  - `/home/Administrator/deploy/admin/app.js`
  - `/home/Administrator/deploy/new_html/admin/AdminLoginPage.tsx`
  - `/home/Administrator/deploy/new_html/admin/AdminSettingsPage.tsx`
  - `/home/Administrator/deploy/new_html/admin/adminAuth.ts`

### Notes

- No backend routes or redline files were modified for this fix.
- Existing unrelated local changes remain in `deploy/api_routes.py`, `deploy/routers/episode_video.py`, and `deploy/scripts/smoke_test.py`.

## 2026-06-19 Script Timeline Router Extraction

### Changes

- Extracted 12 script/timeline route handlers from `deploy/api_routes.py` into `deploy/routers/script_timeline.py`:
  - script segments
  - single episode script
  - multi-script CRUD
  - timeline tracks
- Kept `api_routes.py` as the compatibility registration point so the public API surface remains unchanged.
- Reduced `api_routes.py` to 2375 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - runtime endpoints must resolve to `routers.script_timeline`
  - `api_routes.py` must not reintroduce direct script/timeline handlers
  - `routers/script_timeline.py` must own exactly 12 route registrations

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/script_timeline.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_audio_provider_runtime.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`, `script_timeline_route_handlers=12`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_script_timeline_router_20260619_065323`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/script_timeline.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/script_timeline.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_audio_provider_runtime.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Audio Router Extraction

### Changes

- Extracted 23 audio-related route handlers from `deploy/api_routes.py` into `deploy/routers/audio.py`:
  - audio tracks
  - generated speech/SFX/music
  - MiniMax voice design, voice clone, TTS, music, lyrics, file APIs
  - character voice CRUD
- Kept `api_routes.py` as the compatibility registration point so existing callers and tests that include `api_routes.router` continue to see the same routes.
- Preserved the historical patch hooks used by MiniMax TTS tests:
  - `api_routes._require_minimax_client`
  - `api_routes.task_service.get`
  - `api_routes.save_generated_file_to_db`
- Reduced `api_routes.py` to 2526 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - runtime endpoints must resolve to `routers.audio`
  - `api_routes.py` must not reintroduce direct audio/MiniMax/character-voice route handlers
  - `routers/audio.py` must own exactly 23 route registrations

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/audio.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_audio_provider_runtime.py`
  - direct MiniMax TTS endpoint compatibility probe passed
  - route result remains `openapi_paths=231`, `openapi_operations=287`, `audio_route_handlers=23`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_audio_router_20260619_064648`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/audio.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/audio.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_audio_provider_runtime.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- The legacy `pytest tests/test_api_minimax_tts_enqueue.py` path is currently blocked locally by a Starlette `TestClient` / httpx version mismatch (`Client.__init__() got an unexpected keyword argument 'app'`), before it reaches application code.
- No frontend build was required.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Gemini TTS Runtime Endpoint Wiring

### Changes

- Updated `deploy/services/audio_provider.py` so `GeminiAudioProvider` now uses the full runtime config from `resolve_provider("gemini-tts")`:
  - API key
  - endpoint
  - custom proxy
- Added endpoint normalization for Google GenAI SDK calls:
  - admin endpoints like `https://generativelanguage.googleapis.com/v1beta/openai/` are converted to `baseUrl=https://generativelanguage.googleapis.com`, `apiVersion=v1beta`
  - custom endpoints with `/v1` or `/v1beta` are converted into SDK `http_options`
- Added `deploy/scripts/check_audio_provider_runtime.py` to verify Gemini TTS endpoint/proxy wiring without calling external APIs.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/services/audio_provider.py deploy/scripts/check_audio_provider_runtime.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_audio_provider_runtime.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_audio_provider_runtime_20260619_063649`
- Uploaded to server:
  - `/home/Administrator/deploy/services/audio_provider.py`
  - `/home/Administrator/deploy/scripts/check_audio_provider_runtime.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile services/audio_provider.py scripts/check_audio_provider_runtime.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_audio_provider_runtime.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This closes a runtime gap where Gemini TTS used the managed key but ignored the managed endpoint/proxy.
- No frontend build was required.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Shared Helper Extraction

### Changes

- Moved shared helper logic out of `deploy/cluster_main.py`:
  - JSON/JSONB parsing now lives in `deploy/utils/json_helpers.py`
  - safe `/storage/...` resolution and image-reference conversion now live in `deploy/utils/image_reference.py`
- Updated these routers to import the shared helpers directly instead of receiving them from `cluster_main.py`:
  - `deploy/routers/ai_proxy.py`
  - `deploy/routers/files.py`
  - `deploy/routers/generation.py`
  - `deploy/routers/projects.py`
- Reduced `cluster_main.py` by another 85 lines.
- Strengthened `deploy/scripts/check_route_contract.py`:
  - `cluster_main.py` must not reintroduce `_storage_path_safe`, `data_url_to_base64`, `parse_jsonb_field`, or `to_doubao_image_input`

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/ai_proxy.py deploy/routers/files.py deploy/routers/generation.py deploy/routers/projects.py deploy/utils/json_helpers.py deploy/utils/image_reference.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`
  - provider result remains `providers=12`, `presets=17`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_helper_extraction_20260619_062823`
- Uploaded to server:
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/ai_proxy.py`
  - `/home/Administrator/deploy/routers/files.py`
  - `/home/Administrator/deploy/routers/generation.py`
  - `/home/Administrator/deploy/routers/projects.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
  - `/home/Administrator/deploy/utils/image_reference.py`
  - `/home/Administrator/deploy/utils/json_helpers.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile ...`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No frontend build was required.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Episode Video Router Extraction

### Changes

- Added `deploy/routers/episode_video.py` and moved 7 episode video/composition handlers out of `deploy/api_routes.py`:
  - `GET /api/episodes/{episode_id}/video-segments`
  - `GET /api/episodes/{episode_id}/video-takes`
  - `POST /api/episodes/{episode_id}/compose`
  - `GET /api/episodes/{episode_id}/compose/status`
  - `POST /api/episodes/{episode_id}/video-segments`
  - `PUT /api/video-segments/{segment_id}`
  - `DELETE /api/video-segments/{segment_id}`
- Fixed a deletion-boundary regression in `mix_storyboard_audio_endpoint`; it now returns `MixAudioResponse` again.
- Updated `deploy/scripts/check_route_contract.py`:
  - expected endpoint ownership now points the 7 routes at `routers.episode_video`
  - added `check_episode_video_routes_extracted()`
  - contract output now reports `episode_video_route_handlers=7`
- `deploy/api_routes.py` is now 1261 lines, down from 1327 at the previous committed baseline.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/episode_video.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `git diff --check -- deploy/api_routes.py deploy/routers/episode_video.py deploy/scripts/check_route_contract.py`
  - route result remains `openapi_paths=231`, `openapi_operations=287`
  - provider result remains `providers=12`, `presets=17`
- Redline diff check passed:
  - no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_episode_video_router_20260619_160357`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/episode_video.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/episode_video.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
  - live read-only endpoint check: `GET /api/episodes/ep_2fc899a228f5/video-segments` -> HTTP `200`, `segments=58`

### Notes

- No frontend build was required.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Storyboard Paged Initial Load

### Changes

- Added backend pagination support for `GET /api/episodes/{episode_id}/storyboard-items`:
  - optional `limit`
  - optional `offset`
  - optional `include_total=true`
  - default behavior remains full-list compatible when no pagination params are passed
- Extended `StoryboardDAO.get_by_episode()` with bounded `limit/offset` and added `count_by_episode()`.
- Updated `getStoryboardItems()` in `deploy/new_html/services/apiService.ts` to pass pagination query params.
- Updated `EpisodeContext` with:
  - `storyboardTotalCount`
  - `loadStoryboardItemsPage()`
- Updated `StoryboardGenPage` so `/workflow/storyboard` initially loads only the first 10 shots and fetches larger prefixes when the user expands more shots.
- Added an `apiService` unit test for storyboard pagination URL construction.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/dao/creative/storyboard.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `git diff --check -- ...changed files...`
- Local frontend TS/Vitest checks were blocked by the existing missing Rollup optional package in this Windows workspace (`@rollup/rollup-win32-x64-msvc`); server build was used as the authoritative frontend validation.
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py dao/creative/storyboard.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - provider contract remains `providers=12`, `presets=17`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - live paged endpoint check: `GET /api/episodes/ep_2fc899a228f5/storyboard-items?limit=10&include_total=true` -> HTTP `200`, `items=10`, `total=152`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_storyboard_paged_load_20260619_161634`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/dao/creative/storyboard.py`
  - `/home/Administrator/deploy/new_html/services/apiService.ts`
  - `/home/Administrator/deploy/new_html/contexts/EpisodeContext.tsx`
  - `/home/Administrator/deploy/new_html/pages/StoryboardGenPage.tsx`
  - `/home/Administrator/deploy/new_html/__tests__/services/apiService.test.ts`

### Notes

- This directly reduces storyboard first-screen data volume for large episodes while keeping full-list behavior available to other pages.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Video Page Deferred Storyboard Load

### Changes

- Updated `deploy/new_html/pages/VideoGenPage.tsx` so `/workflow/video` no longer force-loads all storyboard items, audio tracks, character voices, and assets during the first render.
- Video page now loads only the first 10 storyboard items for the import preview via `loadStoryboardItemsPage({ limit: 10, includeTotal: true })`.
- Audio tracks, character voices, and assets are deferred with `requestIdleCallback`/`setTimeout` so they do not block first paint.
- Manual "导入全部分镜到视频工作区" still imports the full episode: it fetches the unpaginated storyboard list only when the user actually imports.
- Large episodes no longer auto-import/rebuild the whole video workspace immediately when only a partial storyboard page is loaded; the panel now tells the user how many shots are previewed and waits for explicit import.

### Verification

- Local checks passed:
  - redline diff check: no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
  - `git diff --check -- deploy/new_html/pages/VideoGenPage.tsx`
- Local `npm run build` could not run because `npm` is not exposed in this Windows shell; server build was used as the frontend validation.
- Server checks passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_video_paged_load_20260619_083110`
- Uploaded to server:
  - `/home/Administrator/deploy/new_html/pages/VideoGenPage.tsx`

### Notes

- This is frontend-only and does not change backend routes or API contracts.
- A health check immediately after restart briefly returned `502` while the service was still coming up; a retry returned HTTP `200`, then smoke passed.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Video Capabilities Router Extraction

### Changes

- Extracted `GET /api/video/capabilities` from `deploy/api_routes.py` into `deploy/routers/video_capabilities.py`.
- Registered the new router from `api_routes.py` while keeping the public path and response shape unchanged.
- Extended `deploy/scripts/check_route_contract.py` to verify:
  - `/api/video/capabilities` is served by `routers.video_capabilities.video_capabilities`
  - `routers/video_capabilities.py` owns exactly 1 route
  - `api_routes.py` no longer owns the video capabilities handler

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/video_capabilities.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - `video_capability_route_handlers=1`
  - redline diff check: no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/video_capabilities.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `GET https://mecha.one/api/video/capabilities` -> HTTP `200`, `{"seedance_omni":false,"comfyui_available":false}`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_video_capabilities_router_20260619_083818`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/video_capabilities.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- No frontend build was required.
- This is a router-composition refactor only; it keeps the API surface stable while shrinking the remaining mixed V2 route file.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Storyboard Router Extraction

### Changes

- Extracted 10 storyboard-related route handlers from `deploy/api_routes.py` into `deploy/routers/storyboard.py`:
  - `GET/POST /api/episodes/{episode_id}/storyboard-items`
  - `PUT/DELETE /api/storyboard-items/{item_id}`
  - `DELETE /api/episodes/{episode_id}/storyboard-items/all`
  - `POST /api/episodes/{episode_id}/export-script`
  - `POST /api/episodes/{episode_id}/storyboard-items/reorder`
  - `POST /api/storyboard/mix-audio`
  - `POST /api/episodes/{episode_id}/storyboard-items/batch`
  - `POST /api/episodes/{episode_id}/extract-to-assets`
- `api_routes.py` now composes `create_storyboard_router(...)` and no longer owns the storyboard handler bodies.
- Extended `deploy/scripts/check_route_contract.py` to verify:
  - all 10 storyboard endpoints resolve to `routers.storyboard`
  - `routers/storyboard.py` owns exactly 10 routes
  - `api_routes.py` does not reintroduce those storyboard route decorators

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/storyboard.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - `storyboard_route_handlers=10`
  - redline diff check: no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/storyboard.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - paged storyboard endpoint check: `GET /api/episodes/ep_2fc899a228f5/storyboard-items?limit=10&include_total=true` -> HTTP `200`, `items=10`, `total=152`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_storyboard_router_20260619_084653`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/storyboard.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- No frontend build was required.
- This keeps the large-episode storyboard pagination behavior intact while moving the high-traffic storyboard domain out of the mixed V2 route file.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Assets Router Extraction

### Changes

- Extracted 5 asset-related route handlers from `deploy/api_routes.py` into `deploy/routers/assets.py`:
  - `GET /api/projects/{project_id}/assets`
  - `POST /api/assets`
  - `PUT /api/assets/{asset_id}`
  - `DELETE /api/assets/{asset_id}`
  - `POST /api/assets/{asset_id}/share`
- `api_routes.py` now composes `create_assets_router(...)` and no longer owns asset CRUD/share handler bodies.
- Extended `deploy/scripts/check_route_contract.py` to verify:
  - all 5 asset endpoints resolve to `routers.assets`
  - `routers/assets.py` owns exactly 5 routes
  - `api_routes.py` does not reintroduce those asset route decorators

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/assets.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - `asset_route_handlers=5`
  - redline diff check: no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/assets.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - live asset endpoint check: `GET /api/projects/proj_05d34fc535e2/assets?episode_id=ep_2fc899a228f5` -> HTTP `200`, `assets=20`, `success=True`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_assets_router_20260619_085535`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/assets.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- No frontend build was required.
- This moves another high-use project loading domain out of the mixed V2 route file while preserving public API behavior.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Entity Files Router Extraction

### Changes

- Extracted 9 entity-file routes from `deploy/api_routes.py` into `deploy/routers/entity_files.py`:
  - `GET /api/user-files`
  - `GET /api/entity-files`
  - `POST /api/entity-files/link`
  - `PUT /api/entity-files/{file_id}/select`
  - `POST /api/entity-files/upload`
  - `DELETE /api/entity-files/{file_id}`
  - `DELETE /api/entity-files/{file_id}/hard`
  - `POST /api/entity-files/hard-delete-batch`
  - `POST /api/entity-files/migrate`
- Moved the legacy URL sync helper (`storyboard_item` / `asset` / `video_segment` URL backfill) into the entity-files router.
- `api_routes.py` now composes `create_entity_files_router(...)` and no longer owns entity-file handler bodies.
- Extended `deploy/scripts/check_route_contract.py` to verify:
  - all 9 entity-file endpoints resolve to `routers.entity_files`
  - `routers/entity_files.py` owns exactly 9 routes
  - `api_routes.py` does not reintroduce those entity-file route decorators

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/entity_files.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - `entity_file_route_handlers=9`
  - redline diff check: no changes under `deploy/pipeline/`, `deploy/agent_routes.py`, `deploy/workflows/`, `deploy/services/task_service.py`, `deploy/core/task_queue.py`, or `deploy/core/worker.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile api_routes.py routers/entity_files.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - live entity-files endpoint check: `GET /api/entity-files?entity_type=asset&entity_id=asset_nonexistent_smoke` -> HTTP `200`, `success=True`, `items=0`, `total=0`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_entity_files_router_20260619_090412`
- Uploaded to server:
  - `/home/Administrator/deploy/api_routes.py`
  - `/home/Administrator/deploy/routers/entity_files.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- No frontend build was required.
- This moves the cross-domain file binding layer out of the mixed V2 route file, making later media loading and file-management optimization safer to work on.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Enhance Page Lightweight Storyboard Audio Loading

### Changes

- Added an optional lightweight storyboard field set for `GET /api/episodes/{episode_id}/storyboard-items`:
  - new query parameter: `fields=audio`
  - allowed field set is server-side whitelisted in `deploy/dao/creative/storyboard.py`
  - returned fields are limited to IDs, ordering, dialogue, audio URLs, duration, planned duration, script ID, and status
- Updated `deploy/new_html/pages/EnhancePage.tsx` so the video enhancement workflow:
  - loads only `videoSegments` from the episode context on mount
  - fetches storyboard audio metadata directly through `getStoryboardItems(..., { fields: 'audio' })`
  - refreshes the lightweight audio metadata when the page refresh button is clicked
- Extended `deploy/new_html/services/apiService.ts` and its unit test coverage for the new `fields` query option.
- Extended `deploy/scripts/check_route_contract.py` with `enhance_lightweight_storyboard_checks=5` to prevent `EnhancePage` from regressing to full storyboard loading on mount.

### Verification

- Local checks:
  - `python -m py_compile deploy/dao/creative/storyboard.py deploy/routers/storyboard.py deploy/scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `enhance_lightweight_storyboard_checks=5`
- Local frontend limitations:
  - local Vitest/build could not run because Windows `node_modules` is missing Rollup optional package `@rollup/rollup-win32-x64-msvc`
  - targeted `tsc` check was blocked by a pre-existing imported error in `services/videoService.ts`
- Server checks passed:
  - `.venv/bin/python -m py_compile dao/creative/storyboard.py routers/storyboard.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - generated frontend asset: `../dist/assets/EnhancePage-DtAfO5ge.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - live lightweight endpoint check:
    - `GET /api/episodes/ep_2fc899a228f5/storyboard-items?fields=audio&limit=1&include_total=true`
    - HTTP `200`, `success=True`, `total=152`
    - returned keys: `audio_duration_ms`, `dialogue`, `dialogue_audio_url`, `episode_id`, `item_id`, `narration_audio_url`, `planned_duration_ms`, `script_id`, `sfx_audio_url`, `sort_order`, `status`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_enhance_lightweight_storyboard_20260619_120244/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/dao/creative/storyboard.py`
  - `/home/Administrator/deploy/routers/storyboard.py`
  - `/home/Administrator/deploy/new_html/services/apiService.ts`
  - `/home/Administrator/deploy/new_html/pages/EnhancePage.tsx`
  - `/home/Administrator/deploy/new_html/__tests__/services/apiService.test.ts`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- This does not change full storyboard behavior for pages that need image prompts, generated images, or bound assets.
- The main remaining heavy workflow pages to audit next are `GenerationPage`, `MaterialsPage`, and `AudioStagePage`, which still have full-slice loading paths in some flows.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Generation Page Lightweight Storyboard Video Loading

### Changes

- Added a second optional lightweight storyboard field set for `GET /api/episodes/{episode_id}/storyboard-items`:
  - new query parameter value: `fields=video`
  - allowed field set remains server-side whitelisted in `deploy/dao/creative/storyboard.py`
  - returned fields are limited to IDs, ordering, dialogue, video prompt, selected/generated image URL, duration, planned duration, script ID, and status
- Updated `deploy/new_html/pages/GenerationPage.tsx` so the video generation workflow:
  - loads only `audioTracks` and `videoSegments` from `EpisodeContext`
  - fetches storyboard video metadata directly through `getStoryboardItems(..., { fields: 'video' })`
  - keeps full lightweight metadata for timeline math, but renders only the first 10 storyboard cards initially
  - adds a "加载更多镜头" control that reveals 10 more cards per click
  - marks storyboard thumbnails with `loading="lazy"` and `decoding="async"`
- Extended `deploy/new_html/services/apiService.ts` and the API service test for the `video` field set.
- Extended `deploy/scripts/check_route_contract.py` with `generation_lightweight_storyboard_checks=7` to prevent the video generation page from regressing to full storyboard loading and unbounded card/image rendering.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/dao/creative/storyboard.py deploy/routers/storyboard.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `generation_lightweight_storyboard_checks=7`
  - targeted TypeScript check:
    - `node node_modules/typescript/bin/tsc --noEmit ... pages/GenerationPage.tsx services/apiService.ts __tests__/services/apiService.test.ts`
- Server checks passed:
  - `.venv/bin/python -m py_compile dao/creative/storyboard.py routers/storyboard.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - generated frontend asset: `../dist/assets/GenerationPage-BfYzee_X.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - live lightweight endpoint check:
    - `GET /api/episodes/ep_2fc899a228f5/storyboard-items?fields=video&limit=1&include_total=true`
    - HTTP `200`, `success=True`, `total=152`
    - returned keys: `audio_duration_ms`, `dialogue`, `episode_id`, `generated_image_url`, `item_id`, `planned_duration_ms`, `script_id`, `sort_order`, `status`, `video_prompt`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_generation_lightweight_storyboard_20260619_121215/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/dao/creative/storyboard.py`
  - `/home/Administrator/deploy/routers/storyboard.py`
  - `/home/Administrator/deploy/new_html/services/apiService.ts`
  - `/home/Administrator/deploy/new_html/pages/GenerationPage.tsx`
  - `/home/Administrator/deploy/new_html/__tests__/services/apiService.test.ts`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- This does not change full storyboard behavior for pages that need full text, asset bindings, generated-image history, or prompt editing.
- The main remaining heavy workflow pages to audit next are `MaterialsPage` and `AudioStagePage`, both of which still force full storyboard refreshes for their specialized workflows.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Audio Stage Lightweight Storyboard Loading

### Changes

- Added a third optional lightweight storyboard field set for `GET /api/episodes/{episode_id}/storyboard-items`:
  - new query parameter value: `fields=audio_stage`
  - allowed field set remains server-side whitelisted in `deploy/dao/creative/storyboard.py`
  - returned fields are limited to IDs, ordering, dialogue, asset bindings, audio URLs, duration, planned duration, script ID, status, and the text/prompt fields needed by "导出到分镜"
- Updated `deploy/new_html/pages/AudioStagePage.tsx` so the audio workflow:
  - no longer calls `forceReloadSlices('storyboardItems', ...)`
  - force-refreshes only `assets`, `characterVoices`, `script`, and `audioTracks` from `EpisodeContext`
  - fetches storyboard rows directly through `getStoryboardItems(..., { fields: 'audio_stage' })`
  - keeps storyboard rows in page-local state
  - patches page-local storyboard state after dialogue edits and TTS audio persistence, instead of reloading full storyboard rows after each generated clip
- Updated `deploy/new_html/components/audio/DubbingPanel.tsx` so dubbing cards:
  - render only the first 20 storyboard groups initially
  - reveal 20 more groups per "加载更多台词" click
  - automatically reveal hidden groups when the timeline asks the panel to scroll to a hidden item
- Extended `deploy/new_html/services/apiService.ts` and the API service test for the `audio_stage` field set.
- Extended `deploy/scripts/check_route_contract.py` with `audio_stage_lightweight_storyboard_checks=9` to prevent the audio page from regressing to full storyboard loading and unbounded dubbing-card rendering.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/dao/creative/storyboard.py deploy/routers/storyboard.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `audio_stage_lightweight_storyboard_checks=9`
- Local frontend limitation:
  - targeted TypeScript check was blocked by pre-existing errors in `services/videoService.ts` and `utils/episodeAdapters.ts`; neither error points at this increment's edited files.
- Server checks passed:
  - `.venv/bin/python -m py_compile dao/creative/storyboard.py routers/storyboard.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - generated frontend asset: `../dist/assets/AudioStagePage-Bkqbeq8K.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - live lightweight endpoint check:
    - `GET /api/episodes/ep_2fc899a228f5/storyboard-items?fields=audio_stage&limit=1&include_total=true`
    - HTTP `200`, `success=True`, `total=152`
    - returned keys: `action_text`, `audio_duration_ms`, `bound_assets`, `camera_movement`, `dialogue`, `dialogue_audio_url`, `episode_id`, `image_prompt`, `item_id`, `narration_audio_url`, `planned_duration_ms`, `scene_heading`, `script_id`, `sfx_audio_url`, `sort_order`, `status`, `video_prompt`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_audio_stage_lightweight_storyboard_20260619_122002/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/dao/creative/storyboard.py`
  - `/home/Administrator/deploy/routers/storyboard.py`
  - `/home/Administrator/deploy/new_html/services/apiService.ts`
  - `/home/Administrator/deploy/new_html/pages/AudioStagePage.tsx`
  - `/home/Administrator/deploy/new_html/components/audio/DubbingPanel.tsx`
  - `/home/Administrator/deploy/new_html/__tests__/services/apiService.test.ts`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- This reduces initial audio-page storyboard payload and avoids a full storyboard reload after each TTS clip persistence.
- `MaterialsPage` remains the main workflow page with full storyboard refresh behavior; it likely needs a separate binding-focused field set because it genuinely depends on `bound_assets` and asset/name matching.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Materials Page Lightweight Storyboard Loading

### Changes

- Added a fourth optional lightweight storyboard field set for `GET /api/episodes/{episode_id}/storyboard-items`:
  - new query parameter value: `fields=materials`
  - returned fields are limited to IDs, ordering, text/prompt fields, generated image URL, `bound_assets`, script ID, and status
  - the route whitelist now allows only `audio`, `video`, `audio_stage`, and `materials`
- Updated `deploy/new_html/pages/MaterialsPage.tsx` so the material binding workflow:
  - no longer refreshes `storyboardItems` through `EpisodeContext`
  - force-refreshes only `assets` and `script`
  - fetches storyboard rows directly through `getStoryboardItems(..., { fields: 'materials' })`
  - keeps storyboard rows in page-local state
  - patches page-local storyboard state after bind/unbind/cascade/auto-patch operations instead of reloading full storyboard rows
- Updated `deploy/new_html/components/MaterialPage.tsx` so the left storyboard list:
  - renders only the first 20 shots initially
  - reveals 20 more shots per "加载更多镜头" click
  - keeps binding and cascade logic operating on the full storyboard array
- Extended `deploy/new_html/services/apiService.ts` and the API service test for the `materials` field set.
- Extended `deploy/scripts/check_route_contract.py` with `materials_lightweight_storyboard_checks=9` to prevent material binding from regressing to full storyboard loading and unbounded shot-card rendering.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/dao/creative/storyboard.py deploy/routers/storyboard.py deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `materials_lightweight_storyboard_checks=9`
- Local frontend limitation:
  - `vitest` and `vite build` were blocked by missing local Rollup optional dependency `@rollup/rollup-win32-x64-msvc` in `deploy/new_html/node_modules`
  - targeted TypeScript check was blocked by pre-existing errors:
    - `components/MaterialPage.tsx` imports non-exported `getAuthToken`
    - material objects are missing `type/source/timestamp` fields in existing type contracts
    - `utils/episodeAdapters.ts` emits `status` on `StoryboardItem`
- Server checks passed:
  - `.venv/bin/python -m py_compile dao/creative/storyboard.py routers/storyboard.py scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - generated frontend assets:
    - `../dist/assets/MaterialsPage-BIDO7lcQ.js`
    - `../dist/assets/MaterialPage-DRO8-j2E.js`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - live lightweight endpoint check:
    - `GET /api/episodes/ep_2fc899a228f5/storyboard-items?fields=materials&limit=1&include_total=true`
    - HTTP `200`, `success=True`, `total=152`
    - returned keys: `action_text`, `bound_assets`, `camera_movement`, `dialogue`, `episode_id`, `generated_image_url`, `image_prompt`, `item_id`, `scene_heading`, `script_id`, `sort_order`, `status`, `video_prompt`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_materials_lightweight_storyboard_20260619_123222/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/dao/creative/storyboard.py`
  - `/home/Administrator/deploy/routers/storyboard.py`
  - `/home/Administrator/deploy/new_html/services/apiService.ts`
  - `/home/Administrator/deploy/new_html/pages/MaterialsPage.tsx`
  - `/home/Administrator/deploy/new_html/components/MaterialPage.tsx`
  - `/home/Administrator/deploy/new_html/__tests__/services/apiService.test.ts`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- This completes the first pass over the main workflow storyboard-loading hot spots: storyboard, enhance, generation, audio, and materials now all have bounded or specialized loading paths.
- API provider replacement/management work is still ongoing and separate from this workflow performance increment.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.

## 2026-06-19 Task Notification Toast Deduplication

### Changes

- Fixed a notification burst issue in `deploy/new_html/services/globalTaskManager.ts`:
  - initial HTTP polling now establishes a notification timestamp baseline instead of calling `/api/tasks/notifications` with `since=undefined`
  - the baseline poll records terminal task IDs but does not emit toast notifications
  - later polling emits only terminal task IDs that are new after the baseline
  - SSE and polling notifications share a small remembered-ID set to avoid duplicate terminal-task toast events during reconnects
- Added a second dedupe layer in `deploy/new_html/contexts/TaskContext.tsx`:
  - repeated notification events with the same `id`/`taskId` no longer inflate unread count
  - the notification panel can still show persisted history; only immediate toast/audio/browser notifications are suppressed for historical rows
- Added `deploy/new_html/__tests__/services/globalTaskManager.test.ts`:
  - covers "first poll does not toast historical failures"
  - covers "only new notification IDs are emitted after baseline"
- Extended `deploy/scripts/check_route_contract.py` with `task_notification_toast_dedupe_checks=7`.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `node node_modules/typescript/bin/tsc --noEmit ... services/globalTaskManager.ts __tests__/services/globalTaskManager.test.ts`
- Local frontend limitation:
  - running Vitest locally is still blocked by the missing Rollup optional dependency `@rollup/rollup-win32-x64-msvc` in `deploy/new_html/node_modules`
  - targeted TypeScript including `TaskContext.tsx` is still blocked by the pre-existing `services/videoService.ts` result type error
- Server checks passed:
  - `.venv/bin/python -m py_compile scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run test:run -- __tests__/services/globalTaskManager.test.ts` -> `2/2`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_notification_toast_dedupe_20260619_124028/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/new_html/services/globalTaskManager.ts`
  - `/home/Administrator/deploy/new_html/contexts/TaskContext.tsx`
  - `/home/Administrator/deploy/new_html/__tests__/services/globalTaskManager.test.ts`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`

### Notes

- The live `/api/tasks/notifications` endpoint returned 20 historical terminal tasks before this fix. The UI should still show these in history, but they should no longer play as a burst of new toast notifications when SSE falls back to polling or the page reloads.
- This does not hide real new failures; new terminal tasks after the polling baseline still emit notifications.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and was intentionally not staged.
