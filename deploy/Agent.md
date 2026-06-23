# MECHA Deploy Agent Notes

## 2026-06-21 Video Provider Default Model Registry Move

### Changes

- Added registry-owned default video model constants for MiniMax, Sora2, and Veo in `services/api_provider_registry.py`.
- Reused the existing DashScope default model map for Wan2.6 presets and client defaults.
- Updated MiniMax, Sora2, Veo, and Wan2.6 video clients so their `DEFAULT_*` constants are compatibility aliases sourced from the registry.
- Updated MiniMax audio runtime resolution to use the registry-backed MiniMax default model as the preset anchor.
- Updated Sora2/Veo legacy model upgrade constants in `services/api_config_runtime_loader.py` to reuse registry constants.
- Strengthened `scripts/check_provider_contract.py` and `scripts/check_route_contract.py` so default video model literals cannot drift back into external API clients.

### Verification

- Local `py_compile` passed for registry, runtime loader, affected audio/video clients, and provider contract.
- Local `scripts/check_provider_contract.py`: passed with `video_default_model_checks=18`.
- Local targeted pytest: `tests/test_api_provider_runtime_model_env.py` and `tests/test_minimax_audio_runtime.py` passed `31/31`.
- Local `scripts/check_route_contract.py`: passed.
- Local `scripts/check_architecture_contracts.py`: passed `10/10`.
- Live deploy to `https://mecha.one/`: remote Vite build completed, `drama.service` stayed `active`, and the script printed `✅ 部署成功`.
- Server-side architecture contracts: 10/10 passed during deployment.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-21 Live Deploy Remote Validation

### Changes

- Updated `scripts/live_deploy_mvc2.sh` to run server-side architecture contracts after `drama.service` is confirmed active.
- Changed the deployment file set to sync full `services`, `utils`, and `dao` directories so newly added service, helper, and DAO modules cannot be omitted from the server.
- Contract failures now use the existing rollback path for `cluster_main.py` and frontend `dist`, so a bad deploy does not stop at a merely active process.
- Added optional remote smoke execution controlled by `RUN_REMOTE_SMOKE`; the script reads `ADMIN_PASSWORD` from the remote environment and does not hardcode credentials.
- Strengthened `scripts/check_route_contract.py` so future deploy-script edits keep the remote validation hooks.

### Verification Plan

- Local shell syntax check for `scripts/live_deploy_mvc2.sh`.
- Local route/architecture contract suite.
- Live deploy through `scripts/live_deploy_mvc2.sh`, followed by server-side architecture contracts and the existing online smoke test.

### Verification

- Local `git diff --check`: passed.
- Local shell syntax check for `scripts/live_deploy_mvc2.sh`: passed.
- Local `scripts/check_route_contract.py`: passed with `live_deploy_frontend_checks=33`.
- Live deploy to `https://mecha.one/`: remote Vite build completed, `drama.service` stayed `active`, and the script printed `✅ 部署成功`.
- Server-side architecture contracts: 10/10 passed during deployment.
- Server file verification:
  - `cluster_main.py`: 985 lines.
  - `admin_routes.py`: 1502 lines.
  - `dao/`: 36 Python files recursively.
  - Local/remote SHA-256 matched for `cluster_main.py`, `admin_routes.py`, and `scripts/live_deploy_mvc2.sh`.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-21 Video Preload Guard

### Changes

- Added explicit video preload behavior across workflow media previews:
  - Dense video cards/lists use `LazyVideo preload="none"`.
  - Workflow preview panes that should not auto-fetch media use raw `<video preload="none">`.
  - User-opened modal/canvas video players use explicit `preload="metadata"`.
- Strengthened `scripts/check_route_contract.py` with `check_frontend_video_preload_contract` so future raw `<video>` tags must declare preload and dense lists keep `preload="none"`.

### Verification

- Local `py_compile` for `scripts/check_route_contract.py`: passed.
- Local `scripts/check_route_contract.py`: passed, including `frontend_video_preload_checks=13`.
- Local `scripts/check_architecture_contracts.py`: 10/10 passed.
- `scripts/live_deploy_mvc2.sh`: deployed to `https://mecha.one/`; remote Vite build passed and `drama.service` stayed active.
- Server `scripts/check_architecture_contracts.py`: 10/10 passed, including `frontend_video_preload_checks=13`.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-21 API Config Endpoint Diagnostics

### Changes

- Enhanced admin API config health test results with safe endpoint diagnostics:
  - `endpoint_source`
  - `used_runtime_endpoint`
  - `runtime_endpoint`
  - `runtime_endpoint_source`
  - `runtime_endpoint_env`
  - `endpoint_matches_runtime`
- Updated `new_html/admin/AdminSettingsPage.tsx` so advanced config diagnostics clearly show when a DB config endpoint differs from the runtime endpoint that real generation calls use.
- Strengthened `scripts/check_admin_api_config_crud.py` with `health_wrapper_endpoint_diagnostics`.

### Verification

- Local `py_compile` for `services/api_config_service.py` and `scripts/check_admin_api_config_crud.py`: passed.
- Local `scripts/check_admin_api_config_crud.py`: passed.
- Local `scripts/check_architecture_contracts.py`: 10/10 passed.
- `scripts/live_deploy_mvc2.sh`: deployed to `https://mecha.one/`; remote Vite build passed and `drama.service` stayed active.
- Server `scripts/check_architecture_contracts.py`: 10/10 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Local Vite build is still blocked by the existing missing Rollup optional package `@rollup/rollup-win32-x64-msvc`.
- Local `tsc --noEmit` is still blocked by existing project-wide TypeScript debt outside this API config change.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-21 Service/DAO Boundary Contract

### Changes

- Added `scripts/check_service_dao_boundary.py` to keep business services persistence-agnostic:
  - Services may not import direct database primitives such as `asyncpg` or `get_db_manager()`.
  - Services may not call raw DB methods such as `execute()`, `fetchrow()`, or `fetchval()`.
  - Services may not contain raw SQL strings; persistence logic should live in DAO modules.
- Added the new contract to `scripts/check_architecture_contracts.py` so the architecture suite guards this boundary on future refactors.
- This is a runtime-neutral architecture guard for the Mapper/DAO purity direction.

### Verification

- Local scan found no raw SQL or direct DB connection access in `services/`.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-21 Provider Endpoint Single-Source Contract

### Changes

- Updated stale provider docs in:
  - `external_api/video/dashscope.py`
  - `services/video_reverse_service.py`
- Strengthened `scripts/check_route_contract.py` with `provider_endpoint_single_source_checks`:
  - Third-party provider hostnames such as laozhang, DeepSeek, Gemini, Volcengine Ark, DashScope, and MiniMax must be centralized in `services/api_provider_registry.py`.
  - Runtime clients, routers, and services are blocked from reintroducing hardcoded provider endpoint domains.
- This supports the upcoming self-hosted API replacement work: switching providers should happen through the registry/admin runtime config instead of scattered URL edits.

### Verification

- Local `git diff --check`: passed.
- Local `py_compile` for `scripts/check_route_contract.py`: passed.
- Local `scripts/check_route_contract.py`: passed, including `provider_endpoint_single_source_checks`.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-21 Frontend Network Boundary Contract

### Changes

- Strengthened `scripts/check_route_contract.py` so frontend direct network calls are guarded beyond `fetch()`:
  - `fetch()` remains allowed only in `services/httpClient.ts`.
  - `XMLHttpRequest` is now allowed only in `services/videoMediaService.ts`, where upload progress needs XHR events.
  - The allowed XHR path must continue to use `buildAuthHeaders()` and `handleUnauthorized()` from the shared http client.
- This closes the remaining frontend request-boundary gap from the API/platform cleanup plan without changing runtime behavior.

### Verification

- Local `git diff --check`: passed.
- Local `py_compile` for `scripts/check_route_contract.py`: passed.
- Local `scripts/check_route_contract.py`: passed, including the expanded `frontend_http_client_checks`.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-21 Storyboard Thumbnail Delivery Optimization

### Changes

- Added `getImageThumbnailUrl()` in `new_html/services/imageLoaderService.ts` to route local file/storage/upload image previews through the existing cached `/api/thumbnail` backend endpoint.
- Updated the storyboard workflow list in `new_html/components/GenerationPage.tsx` so shot cards and generated-image result cards render cached thumbnails instead of full-size files.
- Updated `new_html/pages/StoryboardGenPage.tsx` so the bottom image/audio timeline uses cached thumbnail URLs for image preview clips.
- Strengthened `scripts/check_route_contract.py` with `frontend_thumbnail_checks` to keep small workflow preview surfaces from regressing to direct full-image downloads.

### Verification

- Local `git diff --check`: passed.
- Local `py_compile` for `scripts/check_route_contract.py`: passed.
- Local `scripts/check_route_contract.py`: passed, including `frontend_thumbnail_checks=7`.
- Local Vite build cannot run on the Windows workspace because `node_modules` is missing Rollup's optional `@rollup/rollup-win32-x64-msvc` package.
- Local `tsc --noEmit` is still blocked by existing project-wide TypeScript debt outside this thumbnail change.
- `scripts/live_deploy_mvc2.sh`: deployed successfully; remote Vite build passed and `drama.service` stayed active.
- Server `scripts/check_route_contract.py`: passed, including `frontend_thumbnail_checks=7`.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Production thumbnail probe for `ep_2fc899a228f5` returned `200 image/jpeg` for a storyboard image thumbnail (`3401` bytes at `144x96`).
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Task Route Read Service Extraction

### Changes

- Added `services/task_read_service.py` to own task read-side fallback behavior:
  - Redis task status formatting.
  - PostgreSQL task status fallback formatting.
  - user task list DB-first / Redis fallback behavior.
  - generated-file DB soft-delete helper.
  - task DB deletion helper.
- Simplified `routers/tasks.py` so task routes no longer call `get_db_manager()` or task DAO read/delete methods directly.
- Strengthened `scripts/check_route_contract.py` mapper-purity checks so task routes must delegate DB fallback/read helpers to `task_read_service`.
- Added `tests/test_task_read_service.py` and included the new service/test in `scripts/live_deploy_mvc2.sh`.

### Verification

- Local `pytest tests/test_task_read_service.py`: 5/5 passed.
- Local `py_compile` for `services/task_read_service.py`, `routers/tasks.py`, and `scripts/check_route_contract.py`: passed.
- Local `scripts/check_route_contract.py`: passed with `service_mapper_purity_checks=557`.
- Local `scripts/check_architecture_contracts.py`: 9/9 passed.
- `scripts/live_deploy_mvc2.sh`: deployed successfully; remote Vite build passed and `drama.service` stayed active.
- Server `pytest tests/test_task_read_service.py`: 5/5 passed.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Storyboard Recovery Probe

### Changes

- Added `scripts/check_storyboard_recovery.py`, a read-only incident probe for "storyboard disappeared" reports.
- The probe logs in, verifies optional project detail access, lists episode scripts, checks episode-level storyboard count, checks each script's storyboard count, and verifies stale script-id fallback returns episode storyboard rows.
- The script is parameterized by `--base-url`, `--username`, `--password`, `--project-id`, and `--episode-id`; it does not hardcode credentials or write data.

### Verification

- Local `py_compile` for `scripts/check_storyboard_recovery.py`: passed.
- Production probe against `https://mecha.one`, project `proj_05d34fc535e2`, episode `ep_2fc899a228f5`: passed.
- Server copy at `/home/Administrator/deploy/scripts/check_storyboard_recovery.py`: ran successfully against `https://mecha.one`.
- Probe result: `script_count=1`, episode storyboard `items=10`, `total=152`; current script `script_a7314932ac1b` has `total=152`; stale script fallback returned `items=5`, `total=152`, `fallback_reason=stale_script_storyboard`.
- Conclusion: the reported missing storyboard is not data loss for this target episode; data and fallback are present server-side.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Storyboard/Video Bounded Loading Follow-up

### Changes

- Reduced legacy `WorkspaceApp` storyboard boot loading from unbounded full-episode fetches to the current script's first 10 storyboard rows with `include_total=true`.
- Added a legacy workspace load-more bridge so `GenerationPage` can request additional storyboard rows by visible count instead of forcing all rows up front.
- Changed generic `EpisodeContext` storyboard slice loading to default to 10 rows plus total, covering post-export refreshes and script-scope reloads.
- Updated the old React Query storyboard hook to use the same bounded initial load.
- Changed video import's full-storyboard fallback fetch to request only the lightweight `video` storyboard field set.
- Strengthened route/frontend contracts to reject shared storyboard loaders that regress to unbounded fetches.

### Follow-up

- User reported that storyboard content appeared missing yesterday; keep a dedicated storyboard recovery/verification pass queued after this bounded-loading deploy. Re-check project `proj_05d34fc535e2`, episode `ep_2fc899a228f5`, selected script scope, fallback metadata, and visible-count behavior.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

### Verification

- Local `git diff --check`: passed.
- Local `scripts/check_route_contract.py`: passed, including `storyboard_paged_reload_checks=29`.
- Local `scripts/check_architecture_contracts.py`: 9/9 passed.
- Local Vitest could not run because Windows `node_modules` is still missing Rollup's optional `@rollup/rollup-win32-x64-msvc` package; this is the existing local frontend dependency issue.
- `scripts/live_deploy_mvc2.sh`: deployed successfully; remote Vite build passed and `drama.service` stayed active.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Production storyboard probe for `ep_2fc899a228f5` returned `items=10`, `total=152`, `fallback=null`.

## 2026-06-20 Provider Health Monitor Observability

### Changes

- Added observable monitor state to the API provider health monitor:
  - `enabled`, `loop_running`, `loop_started_at`, and Redis cache availability.
  - last sweep source (`background` or `manual`), start/end timestamps, duration, summary, and last error.
- Exposed `monitor_state` from:
  - `GET /api/admin/api-configs`
  - `GET /api/admin/api-configs/health/cache`
  - `POST /api/admin/api-configs/health/sweep`
- Manual health sweeps now record `last_sweep_source=manual`; background sweeps record `last_sweep_source=background`.
- Updated the native admin API config page with a compact provider-health monitor strip so admins can see whether automatic provider health checks are enabled/running, when the last sweep completed, and whether Redis health cache is available.
- Strengthened provider-health and route/UI contracts to require the new monitor state and admin display.

### Verification

- Local `py_compile` for changed backend scripts: passed.
- Local `scripts/check_provider_health_monitor.py`: passed, including `provider_monitor_state=1`.
- Local `scripts/check_route_contract.py`: passed, including `admin_api_config_ui_checks=13`.
- Local `scripts/check_architecture_contracts.py`: 9/9 passed.
- Local `tsc --noEmit` still fails on existing project-wide TypeScript debt outside this change; it reported no new `AdminSettingsPage.tsx` errors.
- `scripts/live_deploy_mvc2.sh`: deployed successfully; remote Vite build passed and `drama.service` stayed active.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Production API probes:
  - `GET /api/admin/api-configs` returned `monitor_state` with `enabled=true` and `redis_configured=true`.
  - `GET /api/admin/api-configs/health/cache` returned provider health cache rows and `monitor_state`.
  - `POST /api/admin/api-configs/health/sweep` for `deepseek` returned `ok=1` and `monitor_state.last_sweep_source=manual`.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 MiniMax Voice Clone Runtime Guardrails

### Changes

- Audited current architecture-debt checkpoints:
  - `new_html` direct `fetch()` calls are now confined to `services/httpClient.ts`.
  - `services/` no longer contains direct SQL usage in the current scan.
  - `_config_get` is centralized in `utils/config_helpers.py`.
- Tightened MiniMax audio API diagnostics in `external_api/audio/minimax_audio.py`:
  - Added `_raise_for_minimax_response()` so voice-design, voice-clone, async TTS, music, lyrics, voice list/delete, and file upload failures include `http_status`, MiniMax `status_code`, `status_msg`, and `trace_id` when available.
  - Kept API key values out of error text.
  - Wrapped MiniMax file upload's file handle in `with open(...)` to avoid leaking descriptors.
- Added MiniMax runtime regression tests for voice clone and file upload:
  - voice clone uses runtime endpoint, proxy, and `GroupId`.
  - file upload uses runtime endpoint, proxy, and `GroupId`.
  - voice clone failures surface actionable diagnostics.
- Strengthened `scripts/check_route_contract.py` so the MiniMax audio runtime tests and diagnostic helper are contract-checked.
- Added `tests/test_minimax_audio_runtime.py` to `scripts/live_deploy_mvc2.sh` so server-side contracts see the updated test file after deployment.

### Verification

- Local `pytest tests/test_minimax_audio_runtime.py tests/test_minimax_tts_sync.py`: 11/11 passed.
- Local `py_compile` for `external_api/audio/minimax_audio.py` and `scripts/check_route_contract.py`: passed.
- Local `scripts/check_route_contract.py`: passed.
- Local `scripts/check_architecture_contracts.py`: 9/9 passed.
- `scripts/live_deploy_mvc2.sh`: deployed successfully; remote Vite build passed and `drama.service` stayed active.
- Server `pytest tests/test_minimax_audio_runtime.py tests/test_minimax_tts_sync.py`: 11/11 passed.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Storyboard Admin Read Access Recovery

### Changes

- Verified the target production episode `ep_2fc899a228f5` still has `152` storyboard rows for project `proj_05d34fc535e2`; the storyboard data was not deleted.
- Root cause: the admin user could log in, but opening Yuan's private project hit `GET /api/projects/{project_id}` first and received `403`, so the workflow page stopped before requesting storyboard items.
- Added `UserDAO.is_admin_user()` so platform-admin checks are centralized and reusable.
- Updated legacy project read routes in `routers/projects.py` so owners, project members, and platform admins can read project detail and legacy shot-image metadata.
- Updated DAO-backed project detail in `routers/project_core.py` with the same platform-admin read allowance.
- Added `tests/test_project_read_access.py` to cover admin read, project-member read, unauthorized read denial, and legacy shot-image reads.
- Added the new project read-access test to `scripts/live_deploy_mvc2.sh` so it is copied during live deployment.

### Verification

- Local `pytest tests/test_project_read_access.py`: 4/4 passed.
- Local `scripts/check_architecture_contracts.py`: 9/9 passed.
- `scripts/live_deploy_mvc2.sh`: deployed successfully; remote Vite build passed and `drama.service` stayed active.
- Server `pytest tests/test_project_read_access.py`: 4/4 passed.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Production API probe after deploy:
  - `GET /api/projects/proj_05d34fc535e2` as admin returned 200.
  - `GET /api/episodes/ep_2fc899a228f5/storyboard-items?limit=10&include_total=true` as admin returned `10` rows with `total=152`.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Admin API Config UI Clarification

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so provider quick cards separate three different operations:
  - `编辑当前配置` opens the active DB config editor when a provider already has a saved config.
  - `测试 DB 配置` calls `POST /api/admin/api-configs/{config_id}/test` for the selected DB row and displays its latency/status/error on the quick card.
  - `刷新生效健康` calls `GET /api/admin/api-configs/{provider_id}/health` for the actual runtime provider health.
- Providers without saved config now show `新增配置`, making the manual API key/endpoint entry path explicit.
- The legacy API editor button now navigates directly to `/admin-legacy/?page=apiconfig` instead of first forcing `/admin/login`, which could bounce back into the new admin shell.
- Strengthened `scripts/check_route_contract.py` so the quick-card DB test/edit/runtime-health controls and direct legacy navigation are contract-checked.

### Verification

- `scripts/check_route_contract.py`: passed locally.
- `scripts/check_architecture_contracts.py`: 9/9 passed locally.
- `git diff --check`: passed locally.
- Local `tsc --noEmit` still reports existing project-wide TypeScript debt outside this change.
- Local Vite build still cannot run because the Windows `node_modules` tree is missing Rollup's `@rollup/rollup-win32-x64-msvc` optional package; server Linux build remains the frontend bundle authority.
- Server deploy refreshed `/home/Administrator/deploy/dist` from `new_html` and `drama.service` was manually restarted after the long frontend build fallback finished.
- Server build artifact `dist/assets/AdminSettingsPage-*.js` contains `编辑当前配置`, `测试 DB 配置`, and `刷新生效健康`.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Server probes returned 200 for both `/admin/settings?item=apiconfig` and `/admin-legacy/?page=apiconfig`.
- Recent `drama.service` logs showed a clean restart at `2026-06-20 12:43:23 UTC` and the service remained active.

### Follow-up

- User reported storyboard rows appeared missing yesterday; keep storyboard recovery/verification as the next workflow item after this admin API UI fix is deployed and smoke-tested.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Workflow Workbench Chunk Split

### Changes

- Deferred heavy workflow workbench components behind route-shell `React.lazy()` boundaries:
  - `StoryboardGenPage.tsx` now lazy-loads `components/GenerationPage`.
  - `VideoGenPage.tsx` now lazy-loads `components/VideoPage`.
- Added lightweight in-page fallbacks so the route shell can render while the heavy workbench chunk downloads.
- Strengthened `scripts/check_route_contract.py` with `frontend_workflow_chunk_checks` to prevent static imports of those heavy workbench components from returning.

### Verification

- `py_compile`: passed for `scripts/check_route_contract.py`.
- `scripts/check_architecture_contracts.py`: 9/9 passed locally, including `frontend_workflow_chunk_checks=6`.
- `scripts/smoke_test.py`: 9/9 passed locally.
- Server deploy completed; Vite build passed and `drama.service` stayed active.
- Server Vite build confirmed route shell/workbench split:
  - `StoryboardGenPage-*.js`: about 23 KB
  - `VideoGenPage-*.js`: about 13 KB
  - `GenerationPage-*.js` and `VideoPage-*.js` remain separate heavy chunks loaded by the lazy boundaries.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed, including `frontend_workflow_chunk_checks=6`.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Recent `drama.service` logs showed no errors after deployment.

### Notes

- `MultiAngle3DController` was already lazy-loaded and is a separate large chunk; this pass focused on route-level workflow shells that still statically imported heavier workbench components.
- Local Vite/Vitest still cannot run because the Windows workspace `node_modules` is missing Rollup's `@rollup/rollup-win32-x64-msvc` optional package. Server build remains the frontend bundling authority.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Storyboard Script Scope Recovery

### Changes

- Verified the target episode `ep_2fc899a228f5` on `https://mecha.one` still has `152` storyboard rows, including the current script scope.
- Updated `new_html/contexts/EpisodeContext.tsx` so script-scope changes always refresh loaded script-scoped slices:
  - the first non-null script selection now reloads storyboard/assets instead of only recording `prevScriptIdRef`.
  - when stale storyboard fallback clears `selectedScriptId`, already loaded storyboard/assets slices are quietly refreshed with episode scope.
- Added EpisodeContext regression tests for first script selection reload and stale fallback reload of loaded script-scoped slices.
- Strengthened `scripts/check_route_contract.py` so the script-scope recovery behavior is contract-checked.

### Verification

- Server data probe before the fix:
  - `/api/episodes/ep_2fc899a228f5/storyboard-items?limit=10&include_total=true`: `total=152`
  - same endpoint with `script_id=script_a7314932ac1b`: `total=152`
  - same endpoint with stale script probe: `fallback_reason=stale_script_storyboard`, `total=152`
- `py_compile`: passed for `scripts/check_route_contract.py`.
- `scripts/check_architecture_contracts.py`: 9/9 passed locally.
- `scripts/smoke_test.py`: 9/9 passed locally.
- Local Vitest could not run because the Windows workspace `node_modules` is missing Rollup's `@rollup/rollup-win32-x64-msvc` optional package; run the frontend test on the Linux server after deploy.
- Server deploy completed; `drama.service` stayed active and Vite build artifacts refreshed.
- Server `npm run test:run -- --pool=threads __tests__/contexts/EpisodeContext.test.tsx`: 8 passed.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Server storyboard probes for episode scope, current script scope, and stale script scope all returned 200; stale script still returned `fallback_reason=stale_script_storyboard` with `total=152`.
- Recent `drama.service` logs showed no storyboard/fallback errors after deployment.

### Notes

- This addresses the class of "storyboard disappeared" issue where existing storyboard rows are hidden by a stale or newly selected script scope in frontend state.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Admin Logs DAO Move

### Changes

- Moved `/api/admin/logs` database queries and log-entry shaping out of `routers/admin_compat.py` and into `dao/admin/admin_stats.py`.
- Added `AdminStatsDAO.get_generation_logs()` for the legacy storyboard JSON log rows and completed task log rows.
- Kept the existing frontend response shape: `id`, `userId`, `username`, `timestamp`, `type`, `model`, `status`, `prompt`, `params`, timing fields, and result preview/video/text fields.
- Strengthened `scripts/check_route_contract.py` so project/task log SQL and local model/type mapping blocks cannot be reintroduced into `routers/admin_compat.py`.
- Added `tests/test_admin_stats_logs.py` for task log formatting and legacy storyboard/image log formatting.
- Updated `scripts/live_deploy_mvc2.sh` so the new admin stats log test is shipped to the server.

### Verification

- `py_compile`: passed for `dao/admin/admin_stats.py`, `routers/admin_compat.py`, and `scripts/check_route_contract.py`.
- `pytest tests/test_admin_stats_logs.py -q`: 2 passed locally.
- `scripts/check_route_contract.py`: passed locally.
- `scripts/check_architecture_contracts.py`: 9/9 passed locally.
- `scripts/smoke_test.py`: 9/9 passed locally.
- Server deploy completed; `drama.service` stayed active and Vite build artifacts refreshed.
- Server `pytest tests/test_admin_stats_logs.py -q`: 2 passed.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Server probe for `/api/admin/logs?limit=5`: returned 200 with the expected log field shape.
- Recent `drama.service` logs showed no admin log errors after deployment.

### Follow-up

- `routers/admin_compat.py` is now much thinner for stats/logs, but user-create still touches in-memory `DEFAULT_USERS` plus DAO sync; later admin-user cleanup can make this fully DAO/service backed.
- User reported seeing storyboard data disappear yesterday; keep that as a separate restore/verification task after this admin compatibility cleanup lands.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Admin Stats Summary DAO Move

### Changes

- Moved `/api/admin/stats` summary aggregation out of `routers/admin_compat.py` and into `dao/admin/admin_stats.py`.
- Added `AdminStatsDAO.get_summary_stats()` to own project totals, legacy storyboard JSON counts, modern table counts, video-generation counts, and storage estimate calculation.
- Kept `routers/admin_compat.py` focused on admin auth, `group_by` validation, DAO calls, and response shaping.
- Strengthened `scripts/check_route_contract.py` so admin stats summary SQL cannot be reintroduced into `routers/admin_compat.py`.

### Verification

- `py_compile`: passed for `dao/admin/admin_stats.py`, `routers/admin_compat.py`, and `scripts/check_route_contract.py`.
- `scripts/check_route_contract.py`: passed locally.
- `scripts/check_architecture_contracts.py`: 9/9 passed locally.
- `scripts/smoke_test.py`: 9/9 passed locally.
- Server deploy completed; `drama.service` stayed active and Vite build artifacts refreshed.
- Server `scripts/check_architecture_contracts.py`: 9/9 passed.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Server probes for `/api/admin/stats`, `/api/admin/stats?group_by=user`, and `/api/admin/stats?group_by=org`: all returned 200 with `source=backend`.
- Recent `drama.service` logs showed no admin stats errors after deployment.

### Follow-up

- `/api/admin/logs` in `routers/admin_compat.py` still contains legacy direct SQL and should be the next admin compatibility mapper-purity target.
- User reported seeing storyboard data disappear yesterday; keep that as a separate restore/verification task after this DAO cleanup lands.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Frontend Direct Fetch Consolidation

### Changes

- Added `publicFetch()` / `publicBlob()` to `new_html/services/httpClient.ts` for unauthenticated public resource downloads.
- Moved the remaining direct `fetch()` calls in `new_html/services/apiService.ts` image upload preparation through `publicBlob()`:
  - `blob:` URL downloads no longer call `fetch()` directly.
  - External image downloads no longer call `fetch()` directly and still avoid sending the local Authorization header.
  - Same-origin images continue to use the authenticated `apiBlob()` path with `secureApiUrl()`.
- Strengthened `scripts/check_route_contract.py` so frontend source files outside `services/httpClient.ts` cannot reintroduce direct `fetch(` calls.
- Added frontend service tests for public blob/external image download auth behavior.

### Verification

- `rg "\bfetch\s*\(" new_html`: only `services/httpClient.ts` contains direct `fetch(` in source.
- `scripts/check_architecture_contracts.py`: passed 9/9 locally.
- `scripts/smoke_test.py`: 9/9 passed locally.
- Server deploy via `scripts/live_deploy_mvc2.sh`: Vite production build passed and `drama.service` stayed active.
- Server `npm run test:run -- --pool=threads __tests__/services/apiService.test.ts`: 20 passed.
- Server `scripts/check_architecture_contracts.py`: passed 9/9.
- Server smoke test against `https://mecha.one`: 9/9 passed.
- Server direct fetch scan: `direct_fetch_violations=0`.
- `tsc --noEmit`: still fails on existing unrelated project-wide TypeScript debt (missing Seedance fixtures, several legacy prop/type mismatches); no new direct-fetch issue surfaced by the architecture contract.

### Notes

- Local Vite/Vitest could not run before reinstalling dependencies because the Windows workspace `node_modules` is missing Rollup's Windows optional native package and only contains Linux Rollup optional packages. Server build remains the deployment authority for frontend bundling.

## 2026-06-20 Storyboard Partial Stale Script Fallback

### Changes

- Confirmed `ep_2fc899a228f5` on `https://mecha.one` still has 152 storyboard rows under `script_a7314932ac1b`; the reported missing storyboard was not a hard data loss for that episode.
- Strengthened `/api/episodes/{episode_id}/storyboard-items` fallback:
  - If a requested `script_id` no longer belongs to the episode, compare script-scoped and episode-scoped storyboard counts.
  - If the episode has more storyboard rows than the stale script scope, return the episode storyboard page with `fallback_reason=stale_script_storyboard`.
  - Valid scripts still keep their own empty or partial storyboard rows, so multi-script workflows are not collapsed accidentally.
- Added regression coverage for partial stale script rows and valid partial script rows.

### Verification

- `pytest tests/test_storyboard_stale_script_fallback.py -q`: 4 passed.
- `scripts/check_architecture_contracts.py`: passed 9/9.
- `scripts/smoke_test.py`: 9/9 passed locally.
- Server probe confirmed:
  - no `script_id`: `total=152`
  - current `script_id=script_a7314932ac1b`: `total=152`
  - stale script probe: `fallback_reason=stale_script_storyboard`, `total=152`

### Notes

- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Architecture Contract Suite Runner

### Changes

- Added `scripts/check_architecture_contracts.py` as the single pre-refactor contract runner for API management and architecture work.
- The runner executes these existing focused checks in order:
  - `check_api_config_runtime_loader.py`
  - `check_admin_api_config_crud.py`
  - `check_admin_api_config_import.py`
  - `check_admin_api_config_health.py`
  - `check_provider_contract.py`
  - `check_provider_health_monitor.py`
  - `check_ai_proxy_failover.py`
  - `check_audio_provider_runtime.py`
  - `check_route_contract.py`
- Updated `scripts/check_route_contract.py` so the runner itself is contract-checked and cannot silently drop provider/API-management guardrails.

### Verification

- `check_architecture_contracts.py --list`: listed 9 contracts.
- `check_architecture_contracts.py`: passed 9/9, elapsed about 5 seconds.
- `check_route_contract.py`: passed with `architecture_contract_runner_checks=11`.
- `py_compile` passed for the new runner and route contract.

### Notes

- This is a developer-safety improvement for the ongoing API replacement and MVC work. It does not change runtime behavior.
- `scripts/live_deploy_mvc2.sh` now ships itself, `dao/`, `scripts/check_*.py`, and `tests/test_storyboard_stale_script_fallback.py`; the server contract runner had failed when newer router checks were deployed without the matching DAO mapper files or the updated deploy script.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Storyboard Stale Script Backend Fallback

### Changes

- Verified the reported target episode still has storyboard data on the server:
  - `ep_2fc899a228f5` has `152` storyboard rows.
  - current script `script_a7314932ac1b` also has `152` storyboard rows.
- Updated `routers/storyboard.py` so `GET /api/episodes/{episode_id}/storyboard-items` handles stale `script_id` values at the backend layer:
  - first queries the requested script-scoped storyboard rows
  - if empty, checks whether the requested script still belongs to the episode through `EpisodeScriptDAO.get_by_id()`
  - only stale/foreign script ids fall back to the episode-level storyboard rows
  - valid existing scripts with no storyboard still return an empty result
- Added `tests/test_storyboard_stale_script_fallback.py` coverage for stale-script fallback and valid-empty-script non-fallback.
- Extended `scripts/check_route_contract.py` so the backend stale-script fallback markers are contract-checked.

### Verification

- `pytest tests/test_storyboard_stale_script_fallback.py -q`: `2 passed`.
- `scripts/check_route_contract.py`: passed with `storyboard_paged_reload_checks=10`.
- Local smoke test passed: `9/9`.
- Server deploy passed: `drama.service` active.
- Server smoke test passed: `9/9`.
- Server stale-script probe returned `stale_items=3`, `stale_total=152`, `fallback_reason=stale_script_storyboard`.

### Notes

- This addresses the class of issue where a browser/session carries an old selected script id and the storyboard page appears empty even though the episode still has storyboard rows.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 API Service Image Download HttpClient Cleanup

### Changes

- Audited `deploy/services/` for direct SQL and did not find service-layer SQL calls that need DAO migration in this pass.
- Updated `new_html/services/apiService.ts` so same-origin image downloads inside `uploadImageToComfyUI()` use the shared HTTP client path:
  - `secureApiUrl()` keeps tokenized local media access consistent
  - `apiBlob()` centralizes auth/error handling for binary downloads
  - external image URLs still use native `fetch()` without local auth headers
- Added `new_html/__tests__/services/apiService.test.ts` coverage for same-origin authenticated blob downloads and external unauthenticated image downloads.
- Extended `scripts/check_route_contract.py` so this behavior is covered by `frontend_http_client_checks`.

### Verification

- Local route contract passed with `frontend_http_client_checks=6655`.
- Local smoke test passed: `9/9`.
- Server deploy verification passed: `drama.service` is active.
- Server smoke test passed: `9/9`.
- Server frontend test passed: `apiService.test.ts` `19/19`.

### Follow-up

- User reported that storyboard items disappeared yesterday. Track this as a separate restore task before the next storyboard workflow release.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Storyboard Visible Refresh Guard

### Changes

- Updated `new_html/pages/StoryboardGenPage.tsx` so force-save/refresh no longer calls the episode-wide `reload()` path.
- The page now refreshes only:
  - the current visible storyboard page via `loadStoryboardItemsPage({ limit: visibleEntityShotCount })`
  - the script slice
  - assets in the quiet/idle path
- Extended `scripts/check_route_contract.py` so `StoryboardGenPage.tsx` cannot regress to full `reload();` or force-reload all storyboard items.

### Notes

- This preserves the existing 10-shot initial render and prevents later save/refresh actions from undoing storyboard pagination on large episodes.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Admin API Config Runtime Test Alignment

### Changes

- Updated `services/api_config_service.py` so config-level connection tests use the DB-saved key first, then fall back to the runtime resolver key when the DB row has no key.
  - Returned diagnostics include `key_source`, `key_env`, and `used_runtime_key` only; API key values are never returned.
- Updated `new_html/admin/AdminSettingsPage.tsx` to make the operational flow clearer:
  - primary actions are now `新增 / 修改厂商 API` and `配置 / 修改 API Key`
  - `测试连通性` checks the effective runtime provider config used by generation
  - `高级诊断` is reserved for testing a specific DB row
  - stale `no_key` health data no longer paints a provider red when runtime status already has a key
- Updated `scripts/check_route_contract.py` to lock these API-management UI semantics.
- Extended `scripts/check_admin_api_config_crud.py` so the runtime-key fallback is covered by the service contract.

### Notes

- This addresses the server symptom where a DB-row test could show `未配置` while provider health was `ok` because the real key came from the hot-reloaded runtime environment.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Video Page Project Task Request Consolidation

### Changes

- Added `new_html/services/videoService.ts` helpers for video-page project imports:
  - `secureMediaUrl()` centralizes tokenized media URL handling
  - `getProjectVideoTasks()` reads exported storyboard-to-video tasks through the shared HTTP client
  - `clearProjectVideoTasks()` clears imported project video tasks through the shared HTTP client
- Updated `new_html/components/VideoPage.tsx` so project video-task loading, cleanup, restored media URLs, completed video URLs, and cropped video URLs use `videoService` instead of direct `fetch()` / local `auth_token` reads.
- Extended `scripts/check_route_contract.py` so `VideoPage.tsx` cannot regress to direct `fetch(`, manual `Authorization`/`Bearer`, or local `auth_token` access for these paths.

### Notes

- This keeps the video workflow page focused on state transitions while request/auth/media URL mechanics stay in the service layer.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Frontend Video Service Http Client Consolidation

### Changes

- Migrated `new_html/services/videoService.ts` away from duplicated auth/request helpers:
  - removed the local `getAuthToken()` and `getHeaders()` implementations
  - replaced direct JSON `fetch()` calls with shared `apiFetch()` / `apiJson()`
  - kept `XMLHttpRequest` uploads for progress/cancel support, but now builds auth headers through `buildAuthHeaders()`
- Covered `videoService.ts` in `scripts/check_route_contract.py` so the file cannot regress to direct `fetch(`, local auth token reads, manual `Bearer` headers, or duplicate response handling.

### Notes

- This moves the video-generation frontend path closer to the same request/auth layer used by the API provider management UI and other migrated services.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Admin API Config UI Follow-up

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so a freshly checked provider health result takes precedence over stale runtime `no_key` diagnostics. This prevents the UI from showing `未配置` when the latest runtime health check is `ok`.
- Renamed API-management actions to make scopes explicit:
  - `测试运行时` checks the effective provider key/endpoint used by generation calls.
  - `测试 DB 记录` checks only the selected database row's saved key/endpoint.
  - `新增 API 配置 / 填写 Key`, `填写 / 修改 Key`, and `修改 Key / Endpoint` make manual key editing easier to find.
- Added a second `新增自定义 API` button beside the provider quick cards so manual configuration is not hidden in the crowded header toolbar.
- Fixed the legacy editor link to open `/admin-legacy/?page=apiconfig` directly instead of routing back into the new settings page.

### Notes

- The confusing server behavior came from mixing DB-row tests with runtime provider health. A provider can be healthy from runtime/env while a preset DB row still has no saved key.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Frontend Admin/User Service Http Client Consolidation

### Changes

- Migrated more frontend JSON services to `new_html/services/httpClient.ts`:
  - `new_html/services/creditService.ts`
  - `new_html/services/organizationService.ts`
- Extended `scripts/check_route_contract.py` so these services are covered by `frontend_http_client_checks` and cannot regress to direct `fetch()`, local `getHeaders()`, manual `Authorization`, or duplicated `handleResponse` plumbing.

### Notes

- This continues the frontend request-layer consolidation across user and admin workflows. Credit and organization APIs now share the same path-aware auth handling as the newer API-management UI.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Frontend Service Http Client Consolidation

### Changes

- Extended `new_html/services/httpClient.ts`:
  - added `buildAuthHeaders()` for shared authenticated headers
  - added `includeContentType: false` support so FormData uploads keep the browser-generated multipart boundary
  - added `apiBlob()` for authenticated binary downloads
- Migrated additional frontend business services to the shared client:
  - `new_html/services/videoReverseService.ts`
  - `new_html/services/shareService.ts`
  - `new_html/services/entityFileService.ts`
  - `new_html/services/mediaLibraryService.ts`
- Updated `scripts/check_route_contract.py` with `frontend_http_client_checks` so migrated services cannot regress to local token reads, manual `Authorization` headers, direct `fetch()`, or duplicate `handleResponse` plumbing.

### Notes

- This continues reducing frontend API-call sprawl before provider/API replacement work. JSON calls, FormData uploads, and Blob downloads now share the same auth/error path for these services.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Frontend AI Provider Http Client Consolidation

### Changes

- Added `new_html/services/httpClient.ts`:
  - reuses the existing `apiService.getHeaders()` auth behavior
  - reuses `apiService.handleResponse()` for JSON error handling and 401 redirect semantics
  - exposes `apiJson()` for normal JSON APIs and `apiFetch()` for streaming responses
- Migrated frontend AI provider services to the shared client:
  - `new_html/services/deepseekService.ts`
  - `new_html/services/geminiProxyService.ts`
  - `new_html/services/geminiImageService.ts`
  - `new_html/services/doubaoService.ts`
  - `new_html/services/gptImageService.ts`
- Updated `scripts/check_route_contract.py` so these provider services cannot regress to duplicated `localStorage` token reads, manual `Authorization` headers, or direct `fetch()` calls.

### Notes

- This keeps external AI calls routed through backend provider management while reducing the number of frontend places that know about auth header construction.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Admin API Config Status Clarification

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so API provider cards clearly expose the main action as `配置 / 修改 API Key`.
- Renamed connection tests to separate their scopes:
  - `测试生效配置` checks the provider runtime config used by real generation calls.
  - `测试此条记录` checks only that specific DB config row.
- Added `Key 来源` display to show whether a provider is using a DB-saved key, a runtime environment key, or no key.
- Changed DB-row `No API key configured` test results from red error styling to yellow warning styling when the runtime provider still has a key.
- Updated `scripts/check_route_contract.py` so these API-management UI semantics are covered by contract checks.

### Notes

- The backend API-management CRUD, provider health, and hot-reload interfaces already exist; this fixes the confusing frontend state where a DB-row test could show `未配置` while the runtime provider health was `ok`.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Shared Lazy Video Component

### Changes

- Added `new_html/components/LazyVideo.tsx`:
  - uses `IntersectionObserver`
  - does not attach `src` until the video is near the viewport
  - keeps `preload="none"` before entry and switches to metadata/selected preload after entry
  - supports hover preview for card thumbnails and normal controlled playback for detail players
- Replaced eager video previews with `LazyVideo` in:
  - `new_html/components/VideoPage.tsx`
  - `new_html/pages/FinalProductPage.tsx`
  - `new_html/components/HistoryPage.tsx`
  - `new_html/pages/MediaLibraryPage.tsx`
  - `new_html/pages/VideoReversePage.tsx`
- Kept user-opened modal/lightbox players as native eager `<video>` where immediate playback or direct element refs are required.
- Updated `scripts/check_route_contract.py` with `frontend_lazy_video_checks` so bulk video previews do not regress back to eager `src` loading.

### Notes

- This addresses the "many shots / many generated videos" loading bottleneck without changing backend APIs.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Frontend Gemini SDK Decommission

### Changes

- Updated `new_html/services/geminiService.ts`:
  - removed the browser-side `@google/genai` / `GoogleGenAI` client
  - kept legacy exported function names, but routed text and JSON generation through `/api/gemini/text` via `callGeminiProxyWithRetry`
  - added `callGeminiText()` as the compatibility text entrypoint
- Updated `new_html/services/promptRewriter.ts`:
  - kept `geminiSDK` as a legacy UI/backend option id
  - changed it into a backend-managed Gemini Text alias instead of dynamically importing the old direct SDK path
  - updated labels so the UI no longer claims a local/client key is needed
- Updated `new_html/components/AIRewritePromptModal.tsx` comments and `new_html/vite.config.ts` safety comment.
- Updated `scripts/check_route_contract.py` with `frontend_ai_proxy_checks`:
  - fails if frontend business code reintroduces `@google/genai`, `GoogleGenAI`, `process.env.*` provider keys, or dynamic SDK import paths

### Notes

- This moves another legacy frontend AI path under the backend provider resolver/API management platform.
- Vite still defines disabled placeholder `process.env.API_KEY`/`process.env.GEMINI_API_KEY` values as a defensive guard only; business code no longer reads them.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-20 Provider Quick API Configuration

### Changes

- Extended `services/api_provider_registry.py` so `get_api_provider_catalog()` now exposes provider-level defaults:
  - `default_config_name`
  - `default_endpoint`
  - `default_model_name`
  - `default_category`
  - `default_proxy_mode`
- Updated `new_html/admin/AdminSettingsPage.tsx` with a provider-level "厂商快速配置" section:
  - renders every provider from the registry, even if no DB config row exists yet
  - shows runtime health, latency, checked time, endpoint, model, and config counts
  - opens the editor prefilled from registry defaults for new providers
  - edits the currently effective provider config when one already exists
- Updated contract scripts:
  - `scripts/check_provider_contract.py` verifies provider catalog defaults match presets
  - `scripts/check_route_contract.py` verifies the quick configuration UI remains present

### Notes

- This makes the admin API management surface registry-driven instead of forcing administrators to understand individual DB rows first.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

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

## 2026-06-19 API Provider Runtime Model Hot Update

### Changes

- Added provider-scoped model env projection:
  - registry helper: `get_model_env_key()`
  - examples: `GEMINI_TEXT_API_KEY` -> `GEMINI_TEXT_MODEL`, `DEEPSEEK_API_KEY` -> `DEEPSEEK_MODEL`
  - provider catalog now exposes `model_env_key`
- Updated `load_api_configs_to_env()` so enabled keyed DB rows project `model_name` into the matching `*_MODEL` env key in the same atomic env refresh pass as key/endpoint/proxy.
- Updated `resolve_provider()` priority for model selection:
  - explicit request model
  - DB/env runtime model (`*_MODEL`)
  - registry preset model
- Updated provider runtime status payload and admin API config cards:
  - new status fields: `runtime_model_name`, `model_env`, `model_source`
  - admin cards now display the actual runtime model and source.
- Updated `/api/gemini/text`:
  - `GeminiTextRequest` accepts optional `model`
  - route passes it into `generate_gemini_text_result()`
  - omitted model now uses the admin runtime config before falling back to preset.
- Fixed the API config "old editor" entry:
  - the button now requires `admin_session_token`
  - it no longer treats the main-site `auth_token` as sufficient for entering the legacy admin iframe.
- Extended contracts/tests:
  - new `tests/test_api_provider_runtime_model_env.py`
  - `check_route_contract.py` now enforces `api_provider_runtime_model_checks=7`
  - API config/import/health/failover contracts now include `*_MODEL` in managed env isolation.

### Verification

- Local checks passed:
  - `python -m py_compile` for updated backend services, schema, route, and contract scripts
  - `deploy/.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `2/2`
  - `deploy/.venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - `deploy/.venv/Scripts/python.exe scripts/check_ai_proxy_failover.py`
  - `deploy/.venv/Scripts/python.exe scripts/check_provider_contract.py`
  - `deploy/.venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=7`
- Local frontend limitation:
  - `vite build` and Vitest are still blocked locally by missing Rollup optional dependency `@rollup/rollup-win32-x64-msvc`
  - full `tsc --noEmit` still reports pre-existing type errors in tests/admin/features/material/video/workspace modules; no remaining errors mention `AdminSettingsPage.tsx` or `geminiProxyService.ts`.

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_api_runtime_model_20260619_205330/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/new_html/admin/AdminSettingsPage.tsx`
  - `/home/Administrator/deploy/new_html/services/geminiProxyService.ts`
  - `/home/Administrator/deploy/routers/ai_proxy.py`
  - `/home/Administrator/deploy/schemas/generation.py`
  - `/home/Administrator/deploy/scripts/check_admin_api_config_health.py`
  - `/home/Administrator/deploy/scripts/check_admin_api_config_import.py`
  - `/home/Administrator/deploy/scripts/check_ai_proxy_failover.py`
  - `/home/Administrator/deploy/scripts/check_api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_provider_contract.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
  - `/home/Administrator/deploy/services/ai_proxy_service.py`
  - `/home/Administrator/deploy/services/api_config_runtime_loader.py`
  - `/home/Administrator/deploy/services/api_provider_registry.py`
  - `/home/Administrator/deploy/services/api_provider_runtime.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile services/api_provider_registry.py services/api_config_runtime_loader.py services/api_provider_runtime.py services/ai_proxy_service.py schemas/generation.py routers/ai_proxy.py scripts/check_route_contract.py scripts/check_provider_contract.py scripts/check_api_config_runtime_loader.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `2/2`
  - `.venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `.venv/bin/python scripts/check_ai_proxy_failover.py`
  - `.venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `GEMINI_TEXT_MODEL` -> `gemini-runtime-model-smoke`, source `GEMINI_TEXT_MODEL`

### Notes

- This closes a gap in the API management plan: DB `api_configs.model_name` now affects runtime calls without code changes or restart after env reload.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Gemini Image Runtime Model Hot Update

### Changes

- Updated `GeminiImageRequest.model` from a hard default to an optional override:
  - omitted `model` now means "use admin runtime config"
  - explicit frontend model selections still override runtime config
- Updated `generate_gemini_images()`:
  - no longer clamps unknown/custom image models back to `gemini-2.5-flash-image`
  - only keeps legacy aliases such as `gemini-3-pro-image-preview` -> `gemini-3.1-flash-image-preview`
  - calls `resolve_provider("gemini-image", explicit_model)` so DB/env `GEMINI_IMAGE_MODEL` can drive the actual upstream model when no explicit request model is sent
- Extended `tests/test_api_provider_runtime_model_env.py`:
  - runtime `GEMINI_IMAGE_MODEL` is used when request omits model
  - explicit request model still wins and legacy aliases still normalize
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `7` to `11`
  - contract now protects Gemini image schema/service/test wiring, not only Gemini text.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/services/ai_proxy_service.py deploy/schemas/generation.py deploy/routers/ai_proxy.py deploy/scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `4/4`
  - `deploy/.venv/Scripts/python.exe scripts/check_provider_contract.py`
  - `deploy/.venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=11`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_gemini_image_runtime_model_20260619_210042/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/schemas/generation.py`
  - `/home/Administrator/deploy/services/ai_proxy_service.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile services/ai_proxy_service.py schemas/generation.py routers/ai_proxy.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `4/4`
  - `.venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `GEMINI_IMAGE_MODEL` -> `gemini-runtime-image-model-smoke`, source `GEMINI_IMAGE_MODEL`

### Notes

- This fixes the same class of issue as Gemini text for the image provider: a schema-level default was making the request look explicit, so admin model changes could not become the runtime default.
- No frontend source change is required for this increment; existing pages that send a selected model keep that explicit behavior.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Video Reverse Gemini Text Runtime Model

### Changes

- Updated `deploy/services/video_reverse_service.py` so video reverse frame analysis no longer calls `resolve_provider("gemini-text", "gemini-2.5-flash")`.
- The service now calls `resolve_provider("gemini-text")`, allowing `GEMINI_TEXT_MODEL` from the admin API config runtime projection to become the default model for video reverse analysis.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with `test_video_reverse_uses_runtime_gemini_text_model`.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `11` to `13`
  - contract now protects video reverse Gemini text runtime-model wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/services/video_reverse_service.py deploy/tests/test_api_provider_runtime_model_env.py deploy/scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `5/5`
  - `deploy/.venv/Scripts/python.exe scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe scripts/check_provider_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=13`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_video_reverse_runtime_model_20260619_210619/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/services/video_reverse_service.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile services/video_reverse_service.py tests/test_api_provider_runtime_model_env.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `5/5`
  - `.venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `GEMINI_TEXT_MODEL` -> `gemini-video-reverse-runtime-model-smoke`, source `GEMINI_TEXT_MODEL`

### Notes

- This removes another hidden hardcoded-model override from a runtime path that already used the provider resolver.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 DeepSeek Runtime Model Default

### Changes

- Updated `deploy/schemas/generation.py` so `DeepseekChatRequest.model` is optional.
- Updated `deploy/services/ai_proxy_service.py` so DeepSeek chat resolves the runtime provider first, then writes the resolved model into the upstream payload.
- Admin-configured `DEEPSEEK_MODEL` now becomes the default when the request omits `model`; explicit request models still override the runtime default.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with DeepSeek runtime-model coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `13` to `16`
  - contract now protects DeepSeek schema/service/test runtime-model wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/services/ai_proxy_service.py deploy/schemas/generation.py deploy/routers/ai_proxy.py deploy/tests/test_api_provider_runtime_model_env.py deploy/scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `7/7`
  - `deploy/.venv/Scripts/python.exe scripts/check_provider_contract.py`
  - `deploy/.venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=16`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_deepseek_runtime_model_20260619_211338/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/schemas/generation.py`
  - `/home/Administrator/deploy/services/ai_proxy_service.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile services/ai_proxy_service.py schemas/generation.py routers/ai_proxy.py tests/test_api_provider_runtime_model_env.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `7/7`
  - `.venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `DEEPSEEK_MODEL` -> `deepseek-runtime-model-smoke`, source `DEEPSEEK_MODEL`

### Notes

- This fixes the same hidden-default class as Gemini image and video reverse: schema/service defaults made admin model changes ineffective unless callers explicitly sent the new model.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Global Failure Toast Burst Folding

### Changes

- Updated `deploy/new_html/components/GlobalToast.tsx` so terminal failure notifications are rate-folded in the floating toast layer.
- Behavior:
  - first 2 failures within a 10 second window still show as individual toasts
  - later failures in the same window update one synthetic `failure-burst-*` summary toast
  - the notification panel and task registry still retain the full per-task failure list
  - clicking the synthetic summary toast only closes it; it does not navigate to one arbitrary failed task
- Added `deploy/new_html/__tests__/components/GlobalToast.test.tsx` for failure-burst folding.
- Extended `deploy/scripts/check_route_contract.py`:
  - `task_notification_toast_dedupe_checks` increased from `7` to `10`
  - contract now protects both historical-failure baseline dedupe and burst-folded failure toasts.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `task_notification_toast_dedupe_checks=10`
- Local frontend test/build could not run because local `deploy/new_html/node_modules` is missing Rollup's Windows optional dependency `@rollup/rollup-win32-x64-msvc`; attempted `pnpm install --no-lockfile`, but Windows symlink permissions blocked it. No lockfile or source file was generated by that attempt.

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_failure_toast_fold_20260619_212500/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/new_html/components/GlobalToast.tsx`
  - `/home/Administrator/deploy/new_html/__tests__/components/GlobalToast.test.tsx`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `cd /home/Administrator/deploy/new_html && npm run test:run -- GlobalToast.test.tsx globalTaskManager.test.ts` -> `3/3`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python -m py_compile scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`

### Notes

- This addresses the user-observed burst of many "model generation failed" floating notifications without hiding actual task failures from the notification panel.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Gemini TTS Runtime Model Wiring

### Changes

- Updated `deploy/services/audio_provider.py` so Gemini TTS resolves `provider=gemini-tts` without passing a hardcoded model override.
- Gemini TTS generation now sends `provider.model_name` from the runtime resolver into `google-genai` instead of hardcoding `gemini-2.5-flash-preview-tts` at the SDK call site.
- Updated `deploy/services/api_provider_registry.py` so the Gemini TTS preset default model is `gemini-2.5-flash-preview-tts`, matching the audio-capable TTS model already required by the implementation.
- Updated `deploy/services/api_config_runtime_loader.py` so old DB configs using `gemini-2.0-flash` for `gemini-tts` are upgraded to `gemini-2.5-flash-preview-tts` during default provider seeding.
- Extended `deploy/scripts/check_audio_provider_runtime.py` to verify endpoint, proxy, and runtime model wiring.
- Extended `deploy/tests/test_audio_provider.py` with a no-network fake `google.genai` test proving `_call_gemini()` uses the resolved runtime model.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile services/audio_provider.py services/api_provider_registry.py services/api_config_runtime_loader.py scripts/check_audio_provider_runtime.py tests/test_audio_provider.py`
  - `deploy/.venv/Scripts/python.exe -m pytest tests/test_audio_provider.py -q` -> `8/8`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe scripts/check_audio_provider_runtime.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - audio runtime contract now reports `gemini_tts_model_wired=1`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_gemini_tts_runtime_model_20260619_213253/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/services/audio_provider.py`
  - `/home/Administrator/deploy/services/api_provider_registry.py`
  - `/home/Administrator/deploy/services/api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_audio_provider_runtime.py`
  - `/home/Administrator/deploy/tests/test_audio_provider.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile services/audio_provider.py services/api_provider_registry.py services/api_config_runtime_loader.py scripts/check_audio_provider_runtime.py tests/test_audio_provider.py`
  - `.venv/bin/python -m pytest tests/test_audio_provider.py -q` -> `8/8`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_audio_provider_runtime.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `GEMINI_MODEL` -> `gemini-runtime-tts-model-smoke`, source `GEMINI_MODEL`

### Notes

- This continues the API management platform goal: Gemini TTS model selection is now controlled by the same backend API config/runtime resolver path as text/image providers.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Doubao Image Runtime Model Wiring

### Changes

- Updated `deploy/schemas/generation.py` so `DoubaoImageRequest.model` is optional and can explicitly override the runtime model when needed.
- Updated `deploy/services/ai_proxy_service.py` so Doubao image generation resolves `provider=doubao` with `model=None` by default, allowing `ARK_MODEL` from admin API config runtime projection to become the default image model.
- Updated `deploy/routers/ai_proxy.py` so `/api/materials/doubao` passes `request.model` instead of an injected model provider.
- Removed `DOUBAO_MODEL = os.environ.get("DOUBAO_IMAGE_MODEL", ...)` from `deploy/cluster_main.py`; Doubao no longer caches its model at import time.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with Doubao runtime-model default and explicit override coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `16` to `21`
  - contract now protects Doubao schema/service/test wiring and fails if `DOUBAO_MODEL`/`doubao_model_provider` returns.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile cluster_main.py routers/ai_proxy.py services/ai_proxy_service.py schemas/generation.py tests/test_api_provider_runtime_model_env.py scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `9/9`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 deploy/.venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=21`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_doubao_runtime_model_20260619_213908/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/cluster_main.py`
  - `/home/Administrator/deploy/routers/ai_proxy.py`
  - `/home/Administrator/deploy/services/ai_proxy_service.py`
  - `/home/Administrator/deploy/schemas/generation.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile cluster_main.py routers/ai_proxy.py services/ai_proxy_service.py schemas/generation.py tests/test_api_provider_runtime_model_env.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `9/9`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `ARK_MODEL` -> `doubao-runtime-image-model-smoke`, source `ARK_MODEL`

### Notes

- This removes another startup-time model cache and moves Doubao image selection into the same hot-reloadable admin API config/runtime resolver path.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 MiniMax Video Runtime Model Wiring

### Changes

- Updated `deploy/external_api/video/minimax.py` so MiniMax video creation resolves `provider=minimax` through `resolve_provider()` without forcing `MiniMax-Hailuo-02` as a request override.
- Added `DEFAULT_MINIMAX_VIDEO_MODEL` as a fallback only. The old worker path still passes `MiniMax-Hailuo-02`, but the client treats that legacy default as "no explicit override", allowing admin/DB/env `MINIMAX_MODEL` to take effect without touching the redline `core/worker.py`.
- Kept explicit non-default request models working: a caller-provided model other than the legacy default still overrides runtime config.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with MiniMax video payload coverage for runtime-model defaulting and explicit override behavior.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `21` to `26`
  - contract now protects MiniMax video runtime model wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/external_api/video/minimax.py deploy/tests/test_api_provider_runtime_model_env.py deploy/scripts/check_route_contract.py`
  - From `deploy/`: `.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `11/11`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=26`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_minimax_runtime_model_20260619_134737/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/external_api/video/minimax.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile external_api/video/minimax.py tests/test_api_provider_runtime_model_env.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `11/11`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `MINIMAX_MODEL` -> `minimax-runtime-video-model-smoke`, source `MINIMAX_MODEL`

### Notes

- This moves MiniMax video selection into the same hot-reloadable admin API config/runtime resolver path used by text, image, Doubao, Gemini TTS, and video reverse.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Sora2 Video Runtime Model Wiring

### Changes

- Updated `deploy/external_api/video/sora2.py` so Sora2 video creation resolves `provider=sora2` through `resolve_provider()` and sends the resolved runtime model in both JSON and multipart payloads.
- Added `DEFAULT_SORA2_VIDEO_MODEL = "sora_video2-landscape-15s"` and maps legacy `sora-2` values to that callable model, preserving the previously working request payload while allowing admin/DB/env `SORA2_MODEL` to override it.
- Updated `deploy/services/api_provider_registry.py` so the Sora2 preset imports the actual callable model `sora_video2-landscape-15s` instead of the old alias `sora-2`.
- Updated `deploy/services/api_config_runtime_loader.py` so existing DB rows with `provider=sora2` and `model_name=sora-2` are upgraded to `sora_video2-landscape-15s` during idempotent provider seeding.
- Extended `deploy/scripts/check_api_config_runtime_loader.py` with Sora2 legacy model upgrade coverage.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with Sora2 runtime-model default, explicit override, and legacy alias normalization coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `26` to `33`
  - contract now protects Sora2 preset/client/loader/test runtime model wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile external_api/video/sora2.py services/api_provider_registry.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - From `deploy/`: `.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `14/14`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=33`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_sora2_runtime_model_20260619_135505/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/external_api/video/sora2.py`
  - `/home/Administrator/deploy/services/api_provider_registry.py`
  - `/home/Administrator/deploy/services/api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile external_api/video/sora2.py services/api_provider_registry.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `14/14`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `SORA2_MODEL` -> `sora2-runtime-video-model-smoke`, source `SORA2_MODEL`

### Notes

- This removes the Sora2 registry/payload model mismatch and moves Sora2 video selection into the same hot-reloadable admin API config/runtime resolver path.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Veo Video Runtime Model Wiring

### Changes

- Updated `deploy/external_api/video/veo.py` so Veo video creation resolves `provider=veo` through `resolve_provider()` and sends the resolved runtime model in the chat-completions payload.
- Added `DEFAULT_VEO_VIDEO_MODEL = "veo-3.1-landscape-fast-fl"` and maps legacy `veo-3` / `veo-3.1` values to that callable model, preserving the previously working request payload while allowing admin/DB/env `VEO_MODEL` to override it.
- Updated `deploy/services/api_provider_registry.py` so the Veo preset imports the actual callable model `veo-3.1-landscape-fast-fl` instead of the old alias `veo-3.1`.
- Updated `deploy/services/api_config_runtime_loader.py` so existing DB rows with `provider=veo` and `model_name in {"veo-3", "veo-3.1"}` are upgraded to `veo-3.1-landscape-fast-fl` during idempotent provider seeding.
- Extended `deploy/scripts/check_api_config_runtime_loader.py` with Veo legacy model upgrade coverage.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with Veo runtime-model default, explicit override, and legacy alias normalization coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `33` to `40`
  - contract now protects Veo preset/client/loader/test runtime model wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile external_api/video/veo.py services/api_provider_registry.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - From `deploy/`: `.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `17/17`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=40`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_veo_runtime_model_20260619_140146/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/external_api/video/veo.py`
  - `/home/Administrator/deploy/services/api_provider_registry.py`
  - `/home/Administrator/deploy/services/api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile external_api/video/veo.py services/api_provider_registry.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `17/17`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime resolver check: `VEO_MODEL` -> `veo-runtime-video-model-smoke`, source `VEO_MODEL`

### Notes

- This removes the Veo registry/payload model mismatch and moves Veo video selection into the same hot-reloadable admin API config/runtime resolver path.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Seedance Runtime Sub-Model Wiring

### Changes

- Updated `deploy/services/api_provider_registry.py` with Seedance sub-model metadata:
  - `SEEDANCE_MODEL_STANDARD`
  - `SEEDANCE_MODEL_FAST`
  - current callable fallback model map for standard/fast.
- Updated `deploy/services/api_provider_runtime.py` with `resolve_seedance_model_name()`, which resolves Seedance models per request with priority:
  - explicit model
  - sub-model env (`SEEDANCE_MODEL_STANDARD` / `SEEDANCE_MODEL_FAST`)
  - generic provider env (`SEEDANCE_MODEL`)
  - current callable fallback (`doubao-seedance-1-0-pro-250528`).
- Updated `deploy/services/api_config_runtime_loader.py` so enabled DB rows for `provider=seedance` project model names into the matching standard/fast env key, preserving hot reload for both Seedance cards.
- Rewrote `deploy/external_api/video/seedance.py` as an ASCII equivalent client that no longer reads/caches model env at import time. It resolves the sub-model dynamically before calling `resolve_provider("seedance", model)`.
- Updated `deploy/routers/video_capabilities.py` so `seedance_omni` also uses runtime model resolution instead of the old static `SeedanceClient.MODEL_MAP`.
- Extended `deploy/scripts/check_api_config_runtime_loader.py` with Seedance standard/fast DB-to-env projection coverage.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with Seedance standard env, fast env, and callable-default fallback payload coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `40` to `49`
  - contract now rejects direct `os.getenv` / `import os` usage in `external_api/video/seedance.py`.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile external_api/video/seedance.py routers/video_capabilities.py services/api_provider_registry.py services/api_provider_runtime.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - From `deploy/`: `.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `20/20`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=49`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_seedance_runtime_submodels_20260619_141104/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/external_api/video/seedance.py`
  - `/home/Administrator/deploy/routers/video_capabilities.py`
  - `/home/Administrator/deploy/services/api_provider_registry.py`
  - `/home/Administrator/deploy/services/api_provider_runtime.py`
  - `/home/Administrator/deploy/services/api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile external_api/video/seedance.py routers/video_capabilities.py services/api_provider_registry.py services/api_provider_runtime.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `20/20`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime helper check: `SEEDANCE_MODEL_STANDARD` -> `seedance-standard-smoke`, `SEEDANCE_MODEL_FAST` -> `seedance-fast-smoke`

### Notes

- This makes Seedance standard/fast model selection hot-reloadable while preserving the current account-compatible 1.0 Pro fallback when no admin model is configured.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Wan2.6 Runtime Model Wiring

### Changes

- Updated `deploy/services/api_provider_registry.py` with DashScope sub-model metadata:
  - `DASHSCOPE_MODEL_WAN26`
  - current callable fallback model `wan2.6-i2v`.
- Updated `deploy/services/api_provider_runtime.py` with `resolve_dashscope_model_name()`, allowing DashScope family clients to resolve model names per sub-model without sharing one generic `DASHSCOPE_MODEL`.
- Updated `deploy/services/api_config_runtime_loader.py` so enabled DB rows for `provider=dashscope` and Wan2.6 model names project into `DASHSCOPE_MODEL_WAN26`.
- Rewrote `deploy/external_api/video/wan2.py` as an ASCII equivalent client that resolves Wan2.6 model names dynamically before calling `resolve_provider("dashscope", model)`.
- Extended `deploy/scripts/check_api_config_runtime_loader.py` with Wan2.6 DB-to-env projection coverage.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with Wan2.6 runtime model and callable-default payload coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `49` to `55`
  - contract now protects Wan2.6 DashScope sub-model env wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile external_api/video/wan2.py services/api_provider_registry.py services/api_provider_runtime.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - From `deploy/`: `.venv/Scripts/python.exe -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `22/22`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=55`

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_wan26_runtime_model_20260619_141802/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/external_api/video/wan2.py`
  - `/home/Administrator/deploy/services/api_provider_registry.py`
  - `/home/Administrator/deploy/services/api_provider_runtime.py`
  - `/home/Administrator/deploy/services/api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile external_api/video/wan2.py services/api_provider_registry.py services/api_provider_runtime.py services/api_config_runtime_loader.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_api_provider_runtime_model_env.py -q` -> `22/22`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime helper check: `DASHSCOPE_MODEL_WAN26` -> `wan26-runtime-smoke`

### Notes

- This starts the DashScope shared-provider split by making Wan2.6 model selection hot-reloadable without forcing the same runtime model onto Kling/Vidu/HappyHorse.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 Kling Runtime Model Wiring

### Changes

- Extended `deploy/services/api_provider_registry.py` with DashScope Kling sub-model metadata:
  - `DASHSCOPE_MODEL_KLING_STANDARD`
  - `DASHSCOPE_MODEL_KLING_OMNI`
  - default models `kling/kling-v3-video-generation` and `kling/kling-v3-omni-video-generation`.
- Added DashScope model-family matching so a generic `DASHSCOPE_MODEL` value is only used when it belongs to the requested sub-model family. This prevents Wan2.6 generic model values from being borrowed by Kling.
- Updated `deploy/services/api_config_runtime_loader.py` so enabled DB rows for `provider=dashscope` and Kling standard/omni model names project into their dedicated runtime env keys.
- Updated `deploy/external_api/video/dashscope.py`:
  - the unified `"合体"` submit path now resolves `sub_model_kling=standard|omni` through `resolve_dashscope_model_name()`.
  - direct `kling_submit()` calls with legacy default hardcoded model names now defer to runtime env, preserving old worker compatibility without touching `core/worker.py`.
- Extended `deploy/scripts/check_api_config_runtime_loader.py` with Kling standard/omni DB-to-env projection coverage.
- Extended `deploy/tests/test_dashscope_video_payload_extension.py` and `deploy/tests/test_api_provider_runtime_model_env.py` with Kling runtime model payload and anti-cross-family coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `55` to `67`
  - contract now protects Kling DashScope sub-model env wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile external_api/video/dashscope.py services/api_provider_registry.py services/api_provider_runtime.py services/api_config_runtime_loader.py tests/test_dashscope_video_payload_extension.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - From `deploy/`: `.venv/Scripts/python.exe -m pytest tests/test_dashscope_video_payload_extension.py tests/test_api_provider_runtime_model_env.py -q` -> `30/30`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=67`

### Notes

- This continues the DashScope shared-provider split by making Kling standard/omni model selection hot-reloadable without forcing the same runtime model onto Wan2.6, Vidu, or HappyHorse.
- `deploy/scripts/smoke_test.py` still has a pre-existing local modification and should not be staged with this change.

## 2026-06-19 MVC2 Live Deploy Script and Admin Health UI

### Changes

- Added `deploy/scripts/live_deploy_mvc2.sh` for the MVC2/API-management deployment bundle.
  - Uses `Administrator@34.92.234.111`.
  - Uses SSH/SCP key `~/.ssh/google_compute_engine` with `StrictHostKeyChecking=no`.
  - Backs up `/home/Administrator/deploy/cluster_main.py` to `cluster_main.py.bak.$(date +%Y%m%d%H%M%S)`.
  - Uploads the requested backend route/schema/service/external API files while preserving directory structure.
  - Restarts `drama.service`, waits 8 seconds, checks `systemctl is-active drama.service`, and restores the latest `cluster_main.py.bak.*` if the service is not active.
  - Does not contain API keys or passwords.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` API provider cards:
  - status indicator now follows the requested rule: green when keyed and health `ok`, yellow when keyed but unknown/unchecked, red when missing key or error.
  - main card action is now `测试连通性`, calling `POST /api/admin/api-configs/{id}/test`.
  - provider runtime status refresh remains available as `刷新健康`, calling `GET /api/admin/api-configs/{provider_id}/health`.
  - `/test` results now show local response latency in milliseconds and immediately update the visible status dot.

### Verification

- Local checks:
  - `C:\Program Files\Git\usr\bin\chmod.exe +x scripts/live_deploy_mvc2.sh`
  - `C:\Program Files\Git\bin\bash.exe -n scripts/live_deploy_mvc2.sh`
  - `node node_modules/typescript/bin/tsc --noEmit --pretty false | Select-String AdminSettingsPage.tsx` -> no `AdminSettingsPage.tsx` errors.
- Local Vite build could not run because the Windows `node_modules` tree is missing Rollup optional package `@rollup/rollup-win32-x64-msvc`; this is an existing local dependency install issue, not caused by the code change.

### Server Deployment

- Executed from local `deploy/`:
  - `scripts/live_deploy_mvc2.sh`
- Script result:
  - backup created: `/home/Administrator/deploy/cluster_main.py.bak.20260619154743`
  - `drama.service` status: `active`
  - deployment result: success
- Server smoke:
  - `/tmp/smoke_test.py` exists on server.
  - The server `ADMIN_PASSWORD` environment variable did not match the current online admin password and returned HTTP `401`.
  - Running smoke with the current online admin password succeeded: `9/9`.

### Notes

- The Admin health UI was synced to `/home/Administrator/deploy/new_html/admin/AdminSettingsPage.tsx` and built on the server into `/home/Administrator/deploy/dist`.
- Post-build checks passed:
  - `GET https://mecha.one/health` -> HTTP `200`
  - `GET https://mecha.one/admin/settings?item=legacy-apiconfig` -> HTTP `200`
  - `/tmp/smoke_test.py https://mecha.one <current-admin-password>` -> `9/9`

## 2026-06-20 Vidu/HappyHorse Runtime Model Wiring

### Changes

- Extended `deploy/services/api_provider_registry.py` with the remaining DashScope shared-provider sub-model metadata:
  - Vidu reference models:
    - `DASHSCOPE_MODEL_VIDU_REFERENCE_Q3_MIX`
    - `DASHSCOPE_MODEL_VIDU_REFERENCE_Q3`
    - `DASHSCOPE_MODEL_VIDU_REFERENCE_Q3_TURBO`
    - `DASHSCOPE_MODEL_VIDU_REFERENCE_Q2_PRO`
    - `DASHSCOPE_MODEL_VIDU_REFERENCE_Q2`
  - Vidu start/end models:
    - `DASHSCOPE_MODEL_VIDU_STARTEND_Q3_PRO`
    - `DASHSCOPE_MODEL_VIDU_STARTEND_Q3_TURBO`
    - `DASHSCOPE_MODEL_VIDU_STARTEND_Q2_PRO`
    - `DASHSCOPE_MODEL_VIDU_STARTEND_Q2_TURBO`
  - HappyHorse:
    - `DASHSCOPE_MODEL_HAPPYHORSE`
- Added `dashscope_sub_model_for_model()` so runtime DB rows can be projected to the right sub-model env without a growing if/else chain.
- Updated `deploy/services/api_config_runtime_loader.py` so all registered DashScope sub-model defaults project from DB into their dedicated runtime env keys.
- Updated `deploy/external_api/video/dashscope.py`:
  - unified `"大乘"` Vidu submit path now resolves Vidu reference/start-end sub-models through `resolve_dashscope_model_name()`.
  - direct `vidu_reference_submit()` and `vidu_startend_submit()` calls with legacy default hardcoded model names now defer to runtime env, preserving `core/worker.py` compatibility without touching the redline worker file.
  - unified and direct HappyHorse calls now resolve `DASHSCOPE_MODEL_HAPPYHORSE`.
- Extended `deploy/scripts/check_api_config_runtime_loader.py` with all Vidu/HappyHorse DB-to-env projection coverage.
- Extended `deploy/tests/test_dashscope_video_payload_extension.py` and `deploy/tests/test_api_provider_runtime_model_env.py` with Vidu/HappyHorse runtime model and anti-cross-family coverage.
- Extended `deploy/scripts/check_route_contract.py`:
  - `api_provider_runtime_model_checks` increased from `67` to `81`
  - contract now protects Vidu/HappyHorse DashScope sub-model env wiring.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile external_api/video/dashscope.py services/api_provider_registry.py services/api_provider_runtime.py services/api_config_runtime_loader.py tests/test_dashscope_video_payload_extension.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - From `deploy/`: `.venv/Scripts/python.exe -m pytest tests/test_dashscope_video_payload_extension.py tests/test_api_provider_runtime_model_env.py -q` -> `36/36`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - From `deploy/`: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - new contract line: `api_provider_runtime_model_checks=81`

### Notes

- This completes the current DashScope shared-provider split for Wan2.6, Kling, Vidu, and HappyHorse model-name selection. Endpoint/key are still shared at the `dashscope` provider level, while model names are now sub-model-specific and hot-reloadable.

### Server Deployment

- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_vidu_happyhorse_runtime_model_20260620_000749/files.tgz`
- Uploaded to server:
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/deploy/external_api/video/dashscope.py`
  - `/home/Administrator/deploy/services/api_provider_registry.py`
  - `/home/Administrator/deploy/services/api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_api_config_runtime_loader.py`
  - `/home/Administrator/deploy/scripts/check_route_contract.py`
  - `/home/Administrator/deploy/tests/test_dashscope_video_payload_extension.py`
  - `/home/Administrator/deploy/tests/test_api_provider_runtime_model_env.py`
- Server checks passed:
  - `.venv/bin/python -m py_compile external_api/video/dashscope.py services/api_provider_registry.py services/api_config_runtime_loader.py tests/test_dashscope_video_payload_extension.py tests/test_api_provider_runtime_model_env.py scripts/check_api_config_runtime_loader.py scripts/check_route_contract.py`
  - `.venv/bin/python -m pytest tests/test_dashscope_video_payload_extension.py tests/test_api_provider_runtime_model_env.py -q` -> `36/36`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/bin/python scripts/check_route_contract.py`
  - `sudo systemctl restart drama`
  - `systemctl is-active drama` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python /tmp/smoke_test.py https://mecha.one Liu3753650@` -> `9/9`
  - runtime helper check:
    - `DASHSCOPE_MODEL_VIDU_REFERENCE_Q3` -> `vidu-reference-smoke`
    - `DASHSCOPE_MODEL_VIDU_STARTEND_Q3_TURBO` -> `vidu-startend-smoke`
    - `DASHSCOPE_MODEL_HAPPYHORSE` -> `happyhorse-smoke`

## 2026-06-20 MiniMax Audio Runtime Extra Config

### Changes

- Added provider extra-env metadata in `deploy/services/api_provider_registry.py`:
  - `minimax.group_id` -> `MINIMAX_GROUP_ID`
- Updated `deploy/services/api_provider_runtime.py` so `resolve_provider("minimax")` exposes `config.extra["group_id"]` and reports the source env key without caching.
- Updated `deploy/services/api_config_runtime_loader.py`:
  - `MINIMAX_GROUP_ID` is now part of managed API env keys.
  - `api_configurations.request_template.group_id` projects to `MINIMAX_GROUP_ID` during DB -> env hot reload.
  - failed reloads still leave existing env values untouched.
- Updated `deploy/services/api_config_import_service.py`:
  - preset import with `copy_runtime_env_keys=true` can copy the current MiniMax runtime `group_id` into `request_template`.
  - import diagnostics only expose copied extra field names, not values.
- Updated `deploy/external_api/audio/minimax_audio.py`:
  - MiniMax audio no longer reads `MINIMAX_GROUP_ID` directly.
  - voice design, voice clone, TTS, music, lyrics, file upload/retrieve/delete now include `GroupId` query params when a group id is configured.
  - explicit `MinimaxAudioClient(group_id=...)` still overrides runtime config.
- Added `deploy/tests/test_minimax_audio_runtime.py`.
- Extended:
  - `deploy/scripts/check_audio_provider_runtime.py`
  - `deploy/scripts/check_api_config_runtime_loader.py`
  - `deploy/scripts/check_provider_contract.py`
  - `deploy/scripts/check_route_contract.py`

### Verification

- Local checks passed:
  - `.venv/Scripts/python.exe -m py_compile services/api_provider_registry.py services/api_provider_runtime.py services/api_config_runtime_loader.py services/api_config_import_service.py external_api/audio/minimax_audio.py tests/test_minimax_audio_runtime.py scripts/check_audio_provider_runtime.py scripts/check_api_config_runtime_loader.py scripts/check_provider_contract.py scripts/check_route_contract.py`
  - `.venv/Scripts/python.exe -m pytest tests/test_minimax_audio_runtime.py tests/test_minimax_tts_sync.py -q` -> `8/8`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_audio_provider_runtime.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_api_config_runtime_loader.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 PYTHONUTF8=1 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - route contract remains `openapi_paths=231`, `openapi_operations=287`
  - loader contract now reports `minimax_extra_env_projection=1`
  - audio runtime contract now reports `minimax_audio_group_id_wired=1`

### Notes

- To manage MiniMax group id through the API platform, store it on the MiniMax API config row:
  - `request_template: {"group_id": "<MiniMax group id>"}`
- Existing server/systemd `MINIMAX_GROUP_ID` remains the baseline fallback when DB does not provide a group id.

## 2026-06-20 Admin API Config UI Status Split

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` API provider cards:
  - separated "single DB config test" from "runtime provider health".
  - `POST /api/admin/api-configs/{config_id}/test` no longer overwrites provider health state.
  - card status dot now remains based on runtime health/cache from `/health` and `/api-configs`.
  - single-config test result is shown only in the card's config-test block.
- Renamed controls to make the two test paths explicit:
  - card: `测试本配置` for saved DB row key/endpoint.
  - card: `测试运行时` for currently effective provider runtime key/endpoint.
  - top toolbar: `手动添加 API`, `导入预设模型`, `刷新健康缓存`, `测试全部配置`.
- Made key editing more discoverable:
  - card edit action now shows `配置 Key` when the DB row has no saved key.
  - card edit action shows `编辑 Key` when the row already has a saved key.
  - cards distinguish `本配置无 Key` from `运行时有 Key`, which explains env/baseline-backed providers.

### Verification

- Local check:
  - `node node_modules/typescript/bin/tsc --noEmit --pretty false | Select-String AdminSettingsPage` -> no `AdminSettingsPage.tsx` errors.
  - The full local TypeScript command still exits non-zero because of existing unrelated project errors.

## 2026-06-20 Admin API Config Advanced Fields

### Changes

- Updated backend API config create path:
  - `deploy/admin_api_config_routes.py` `ApiConfigCreateBody` now accepts `request_template` and `headers`.
  - `deploy/services/api_config_service.py` passes those fields through to `ApiConfigDAO.create()`.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` editor modal:
  - added `MiniMax Group ID` field when provider is `minimax`.
  - added `Request Template JSON` editor.
  - added `Headers JSON` editor.
  - save validates both JSON fields before calling backend.
  - MiniMax Group ID is merged into `request_template.group_id`, which then hot-reloads through `MINIMAX_GROUP_ID`.
- Extended checks:
  - `deploy/tests/test_admin_import_presets_writes_category.py`
  - `deploy/scripts/check_admin_api_config_crud.py`

### Usage

- MiniMax clone/TTS group id can now be configured in the new admin UI:
  - `/admin/settings?item=apiconfig`
  - open/create MiniMax config
  - fill `MiniMax Group ID`
  - save
- Equivalent raw JSON:
  - `request_template: {"group_id": "<MiniMax GroupId>"}`

## 2026-06-20 Provider Extra Fields Registry

### Changes

- Moved provider-specific advanced fields into the provider registry:
  - `deploy/services/api_provider_registry.py`
  - `PROVIDER_EXTRA_FIELD_CATALOG`
  - `get_provider_extra_fields(provider)`
- `get_api_provider_catalog()` now exposes `extra_fields` metadata for the admin UI.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx`:
  - removed hardcoded MiniMax-specific form state.
  - renders advanced provider fields dynamically from `ProviderMeta.extra_fields`.
  - saves dynamic field values back into `request_template` or `headers` based on registry metadata.
- Extended contracts:
  - `deploy/scripts/check_provider_contract.py`
  - `deploy/scripts/check_route_contract.py`

### Notes

- MiniMax `group_id` remains the first registered extra field.
- Future provider-specific fields should be added to `PROVIDER_EXTRA_FIELD_CATALOG` instead of hardcoding new inputs in the admin page.

## 2026-06-20 P0/P1 Deployment And Security Fixes

### Changes

- P0 deployment path completed with `scripts/live_deploy_mvc2.sh`:
  - remote `cluster_main.py` backup is created before upload.
  - MVC/API management files are synced to `/home/Administrator/deploy`.
  - `drama.service` is restarted and checked for `active`.
- Fixed API env reload observability:
  - `admin_api_config_routes._reload_api_env()` now logs failures with `exc_info=True` and raises instead of returning `False`.
  - manual `/api/admin/api-configs/reload-env` now returns HTTP 500 on reload failure instead of a 200 response with `success=false`.
  - API config write handlers naturally surface reload failures as HTTP 500 through the shared callback.
- Raised new-password minimum length to 8 characters:
  - admin user create body.
  - admin reset-password body and explicit guard.
  - legacy public registration handler, after the public-registration-disabled guard so closed registration still returns 403.
  - legacy admin-compatible user create endpoint.
- Added contracts:
  - `scripts/check_provider_contract.py` checks reload failures are not swallowed.
  - `scripts/check_route_contract.py` checks password minimum enforcement cannot regress to 4 characters.

### Verification

- Local checks passed:
  - `python -m py_compile admin_api_config_routes.py admin_routes.py routers/auth_legacy.py routers/admin_compat.py scripts/check_provider_contract.py scripts/check_route_contract.py`
  - `python scripts/check_provider_contract.py`
  - `.venv/Scripts/python.exe scripts/check_route_contract.py`
  - `python scripts/smoke_test.py` -> `9/9`
- Server checks passed after final P1 redeploy:
  - `scripts/live_deploy_mvc2.sh` -> `✅ 部署成功`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend API Service Canvas HTTP Client Migration

### Changes

- Migrated `new_html/services/apiService.ts` Canvas API helpers from local `fetch()` / `getHeaders()` calls to shared `apiJson()`:
  - canvas board create/list/detail/update/delete
  - canvas node create/update/delete
  - canvas connection create/delete
- Extended `scripts/check_route_contract.py` so the migrated Canvas endpoints cannot reintroduce direct `fetch()` calls.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_api_service_canvas_httpclient_20260620141926.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend API Service HTTP Client Core Migration

### Changes

- Moved core frontend request primitives into `new_html/services/httpClient.ts`:
  - `handleResponse()`
  - `getAuthToken()`
  - `getHeaders()`
- Kept compatibility exports from `new_html/services/apiService.ts` so existing imports and tests can continue to use `apiService.handleResponse`.
- Migrated `apiService.ts` task and notification endpoints from local `fetch()` / `getHeaders()` calls to shared `apiJson()`:
  - active tasks
  - task notifications
  - unread notification count
  - notification list
  - mark read / mark all read / dismiss
- Extended `scripts/check_route_contract.py` so the core request primitives live in `httpClient.ts` and the migrated task/notification endpoints cannot reintroduce direct fetches.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Local targeted Vitest is blocked by the existing Windows Rollup optional dependency issue (`@rollup/rollup-win32-x64-msvc` missing); server Node validation is used below.
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_api_service_httpclient_core_20260620141102.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `npm run test:run -- __tests__/services/apiService.handleResponse.test.ts` -> `3 passed`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Gemini Service HTTP Client Migration

### Changes

- Migrated `new_html/services/geminiService.ts` internal generation requests from repeated local `fetch()` / `auth_token` / Authorization handling to shared `apiJson()`.
- Added a small `postGenerationTask()` helper for `/api/generate/*` task submission responses that return `task_id`.
- Migrated `/api/task/{taskId}` polling and multi-grid storyboard generation to shared response/error handling.
- Extended `scripts/check_route_contract.py` so `geminiService.ts` cannot reintroduce service-local `fetch()` or duplicated Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_gemini_service_httpclient_20260620140110.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Image Loader HTTP Client Migration

### Changes

- Migrated `new_html/services/imageLoaderService.ts` from local `fetch()` / `getHeaders()` calls to shared `apiJson()`, `secureApiUrl()`, and `apiBlob()`.
- Preserved the existing image cache, loading promise de-duplication, Blob URL cache, and fallback behavior for failed authenticated image conversion.
- Extended `scripts/check_route_contract.py` so `imageLoaderService.ts` cannot reintroduce service-local `fetch()` or duplicated Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_image_loader_httpclient_20260620135156.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Generation Page HTTP Client Migration

### Changes

- Migrated `new_html/components/GenerationPage.tsx` full-image preview and image-to-DataURL download paths from local `fetch()` / `auth_token` / Authorization handling to shared `secureApiUrl()` and `apiBlob()`.
- Removed an unused intermediate image URL variable in the PNG conversion helper while preserving the existing data/blob URL behavior.
- Extended `scripts/check_route_contract.py` so `GenerationPage.tsx` cannot reintroduce page-local `fetch()` or duplicated Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_generation_page_httpclient_20260620134353.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Material Page HTTP Client Migration

### Changes

- Migrated `new_html/components/MaterialPage.tsx` image download helpers from local `fetch()` / `auth_token` / Authorization handling to shared `secureApiUrl()` and `apiBlob()`.
- Kept local Blob URL and authenticated media URL downloads on the same shared request path.
- Extended `scripts/check_route_contract.py` so `MaterialPage.tsx` cannot reintroduce page-local `fetch()` or duplicated Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_material_page_httpclient_20260620133150.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Admin Login And Design HTTP Client Migration

### Changes

- Migrated `new_html/admin/AdminLoginPage.tsx` login submit from local `fetch()` to shared `apiJson()` with `requireAuth: false`.
- Migrated `new_html/pages/DesignPage.tsx` secured image URL creation and blob download from local `auth_token`/Authorization handling to shared `secureApiUrl()` and `apiBlob()`.
- Extended `scripts/check_route_contract.py` so both files cannot reintroduce page-local `fetch()` or duplicated Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_admin_login_design_httpclient_20260620132534.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `.venv/bin/python scripts/check_provider_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
- Smoke caught and fixed one regression before final deploy:
  - public registration is disabled, so `/api/auth/register` must return HTTP `403` before any password-length validation returns `422`.

### Remaining Gap

- Server SSH port `22` is still publicly exposed. This is outside the app code path and should be handled in GCP firewall/IAP or host SSH policy.

## 2026-06-20 Frontend Project/Episode HTTP Client Migration

### Changes

- Migrated `new_html/components/ProjectHub.tsx` from page-local `fetch()` + `getHeaders()` to shared `apiJson()`:
  - project list
  - project create
  - project delete
  - project archive
  - project unarchive
- Migrated `new_html/pages/EpisodeHubPage.tsx` from page-local `fetch()` + `getHeaders()` to shared `apiJson()`:
  - episode list
  - episode create
  - episode delete
  - episode duplicate
  - episode rename
- Extended `scripts/check_route_contract.py` so these two high-traffic entry pages cannot reintroduce duplicated request/auth handling.

### Notes

- This is P2 frontend request consolidation work. The large historical `new_html/services/apiService.ts` still owns many direct `fetch()` calls and should be split/migrated by domain in later steps.

### Verification

- Local checks passed:
  - targeted TypeScript check for `ProjectHub.tsx` and `EpisodeHubPage.tsx`
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_hub_httpclient_20260620120800.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Project Context HTTP Client Migration

### Changes

- Migrated `new_html/contexts/ProjectContext.tsx` project-detail loading from page-local `fetch()` / `getHeaders()` to shared `apiJson()`.
- Preserved explicit 403/404 project-access messages via the shared httpClient error status.
- Extended `scripts/check_route_contract.py` so `ProjectContext.tsx` cannot reintroduce page-local `fetch()` or duplicated Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_project_context_httpclient_20260620131808.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Admin Settings HTTP Client Migration

### Changes

- Migrated `new_html/admin/AdminSettingsPage.tsx` API-management requests from a local `getHeaders()` + `fetch()` wrapper to shared `apiJson()`.
- Removed direct dependency on `pickTokenForCurrentRoute()` from the settings page; `/admin` token selection now flows through shared `httpClient` / `apiService`.
- Extended `scripts/check_route_contract.py` so the API configuration page cannot reintroduce page-local `fetch()` / Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_admin_settings_httpclient_20260620130937.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend Admin Hub HTTP Client Migration

### Changes

- Migrated `new_html/admin/AdminHubPage.tsx` KPI preview calls from page-local `fetch()` and manual token headers to shared `apiJson()`.
- Migrated `new_html/components/AdminPage.tsx` cluster-node loading from page-local `fetch()` and manual Authorization headers to shared `apiJson()`.
- Extended `scripts/check_route_contract.py` so both admin entry pages cannot reintroduce page-local `fetch()` / Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Local targeted TypeScript check is still blocked by pre-existing admin table `never` type errors in `AdminFeatureTabs.tsx` / `AdminOrganizationsTab.tsx`.
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_admin_hub_httpclient_20260620125804.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Frontend History/Header HTTP Client Migration

### Changes

- Extended `new_html/services/httpClient.ts` with:
  - `authTokenFromHeaders()` to reuse the shared auth header source without direct localStorage reads in pages.
  - `secureApiUrl()` to append the runtime auth token to media URLs consistently.
- Migrated `new_html/components/HistoryPage.tsx`:
  - fallback task image query now uses `apiJson()`.
  - active task polling now uses `apiJson()`.
  - media/thumbnail URLs now use `secureApiUrl()` instead of page-local token handling.
- Migrated `new_html/components/Header.tsx` logout request to `apiFetch()`.
- Extended `scripts/check_route_contract.py` so `HistoryPage.tsx` and `Header.tsx` cannot reintroduce page-local `fetch()` / Authorization logic.

### Notes

- The next frontend HTTP client section closes the `AdminFeatureTabs.tsx` admin-session-token helper gap.

### Verification

- Local checks passed:
  - targeted TypeScript check for `HistoryPage.tsx` and `httpClient.ts`
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_history_header_httpclient_20260620121626.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Mapper Purity Audit And Entity File Legacy Sync

### Changes

- Audited direct SQL in `services/`:
  - `services/file_service.py` had direct legacy URL sync SQL.
  - `services/credit_service.py` still has direct row-lock SQL for credit account transactions.
- Moved entity-file legacy URL sync into `dao/content/entity_file.py`:
  - new `EntityFileDAO.sync_legacy_url(entity_type, entity_id, file_role, file_url)`.
  - `services/file_service.py` now calls the DAO method instead of writing SQL.
  - `routers/entity_files.py` now calls the DAO method instead of maintaining a duplicated route-local SQL helper.
- Extended `scripts/check_route_contract.py`:
  - prevents direct SQL/connection operations from reappearing in `services/` outside the tracked `credit_service.py` exception.
  - checks that file-service and entity-file route legacy sync go through `EntityFileDAO.sync_legacy_url()`.

### Follow-Up

- The next section closes the `services/credit_service.py` direct-SQL exception with a transaction-oriented DAO design.

## 2026-06-20 Credit Ledger Mapper Purity

### Changes

- Closed the remaining direct-SQL service gap in `services/credit_service.py`.
- Added transaction-oriented ledger methods in `dao/business/credit.py`:
  - `CreditLedgerDAO.freeze_credits()`
  - `CreditLedgerDAO.confirm_task_freeze()`
  - `CreditLedgerDAO.release_task_freeze()`
  - `CreditLedgerDAO.admin_adjust_account()`
- Moved account row-locking, freeze records, and transaction ledger writes into DAO-managed transactions.
- Rewrote `services/credit_service.py` so it only handles cost calculation, public API shape, logging, and DAO error translation.
- Tightened `scripts/check_route_contract.py`:
  - `services/credit_service.py` is no longer an allowed direct-SQL exception.
  - the route contract now asserts the new credit ledger DAO methods exist and are used by the service layer.

### Verification

- Local checks passed:
  - `python -m py_compile deploy/dao/business/credit.py deploy/services/credit_service.py deploy/scripts/check_route_contract.py`
  - service direct-SQL scan -> clean
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/credit_ledger_mapper_20260620043627.tgz`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`
  - `.venv/bin/python -m py_compile dao/business/credit.py services/credit_service.py scripts/check_route_contract.py`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - temporary credit ledger probe -> `credit_ledger_mapper_smoke_ok` and cleanup completed

## 2026-06-20 Frontend Admin Feature HTTP Client Migration

### Changes

- Migrated `new_html/components/AdminFeatureTabs.tsx` from a local admin-token `fetch()` wrapper to shared `apiJson()`:
  - users
  - project groups
  - credit accounts
  - credit transactions
  - admin media library
  - audit logs
- Migrated `new_html/admin/AdminOrganizationsTab.tsx` admin-user lookup to `apiJson()`.
- Extended `scripts/check_route_contract.py` so both admin panels cannot reintroduce page-local `fetch()` / Authorization handling.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `python deploy/scripts/smoke_test.py` -> `9/9`
- Local Vite build is blocked by a missing Windows Rollup optional package in `node_modules`; server build was used as the authoritative frontend build check.
- Server checks passed:
  - backup: `/home/Administrator/deploy_backups/frontend_admin_features_httpclient_20260620124827.tgz`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `.venv/bin/python scripts/check_route_contract.py`
  - `/tmp/smoke_test.py https://mecha.one <admin-password>` -> `9/9`
  - `drama.service` -> `active`
  - `GET https://mecha.one/health` -> HTTP `200`

## 2026-06-20 Mapper Purity Contract Expansion

### Changes

- Re-audited `services/` for direct SQL, database pool access, connection operations, and `conn=` plumbing; no service-layer SQL or connection ownership remains.
- Expanded `scripts/check_route_contract.py` so Mapper purity is enforced by contract:
  - blocks service-layer `db.acquire()`, `pool.acquire()`, `conn.fetch/execute`, direct database imports, `get_pool()`, `get_connection()`, and local DB handle assignments.
  - blocks DAO code from adding public connection/pool getters or returning DB handles.
- Kept the scope intentionally narrow: existing DAO-internal transaction helpers were not refactored in this pass, but service-layer transaction leakage is now guarded.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `service_mapper_purity_checks=438`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/smoke_test.py` -> `9/9`

## 2026-06-20 Frontend API Service Project HTTP Client Migration

### Changes

- Migrated the project-main-flow helpers in `new_html/services/apiService.ts` from local `fetch()` / `getHeaders()` calls to shared `apiJson()`:
  - project save/list/detail/delete/update/export
  - project member list/create/update/delete
  - episode list/create/update/delete
  - material processing
  - asset list/create/update/delete
  - storyboard item list/create/update/delete/reorder/bulk-delete
- Extended `scripts/check_route_contract.py` so these migrated endpoints cannot reintroduce direct `fetch()` calls.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `frontend_http_client_checks=328`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/smoke_test.py` -> `9/9`
- Local frontend build remains blocked by the existing missing Rollup optional package `@rollup/rollup-win32-x64-msvc`.
- `tsc --noEmit` still fails on existing baseline fixture/component type errors, but the `apiService` migration no longer leaks `unknown` return types because migrated calls use `apiJson<any>()`.

## 2026-06-20 Frontend API Service Episode Production HTTP Client Migration

### Changes

- Migrated another `new_html/services/apiService.ts` JSON batch from local `fetch()` / `getHeaders()` calls to shared `apiJson<any>()`:
  - video segments
  - audio tracks
  - video capability checks
  - video takes and compose status
  - speech/SFX/music generation
  - episode script and multi-script CRUD
  - script segments and timeline tracks
  - character voices
  - storyboard batch create, extract-to-assets, asset sharing
  - MiniMax voice/tts/music/lyrics/file metadata JSON APIs
  - export script
- Left special binary/FormData flows untouched for a focused follow-up:
  - image/blob downloads
  - ComfyUI image upload
  - MiniMax file upload
- Left legacy admin helpers untouched; newer admin UI pages already route through `httpClient`.
- Extended `scripts/check_route_contract.py` so the migrated episode-production and MiniMax JSON endpoints cannot reintroduce direct `fetch()` calls.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `frontend_http_client_checks=396`
  - `PYTHONIOENCODING=utf-8 python deploy/scripts/smoke_test.py` -> `9/9`
- Local frontend build remains blocked by the existing missing Rollup optional package `@rollup/rollup-win32-x64-msvc`.
- `tsc --noEmit` still fails on existing baseline fixture/component type errors, with no new `apiService` unknown-return regressions observed.

## 2026-06-20 Frontend API Service Upload And Legacy Admin HTTP Client Migration

### Changes

- Migrated the remaining backend API calls in `new_html/services/apiService.ts` to shared `apiJson<any>()`:
  - ComfyUI image upload FormData request (`includeContentType: false`)
  - legacy admin user/log/stat helpers
  - MiniMax file upload FormData request (`includeContentType: false`)
- Removed the now-unused `API_BASE` constant.
- Left the two remaining native `fetch()` calls in `apiService.ts` intentionally:
  - one reads a browser `blob:` URL.
  - one downloads an already-secured image URL before re-uploading to ComfyUI.
- Extended `scripts/check_route_contract.py` so `apiService.ts` cannot reintroduce `API_BASE`, direct backend API `fetch()`, or local auth-token reads.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `frontend_http_client_checks=408`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`
- Local frontend build remains blocked by the existing missing Rollup optional package `@rollup/rollup-win32-x64-msvc`.
- `tsc --noEmit` still fails on existing baseline fixture/component type errors, with the temporary `apiService.ts` `downloadedBlob` regression fixed and no remaining `apiService` type errors in the latest run.

## 2026-06-20 Frontend Auth Token Read Consolidation

### Changes

- Consolidated remaining direct frontend `auth_token` reads through shared auth helpers:
  - `services/httpClient.ts` now delegates `getAuthToken()` to `admin/adminAuth.ts`'s route-aware token picker.
  - `WorkspaceApp.tsx` uses `getAuthToken()` for login-state checks before saving episode scripts.
  - `services/globalTaskManager.ts` uses `authTokenFromHeaders()` for SSE token setup.
  - `pages/GenerationPage.tsx`, `pages/VideoGenPage.tsx`, and `components/video/DashScopeCards.tsx` use `secureApiUrl()` for authenticated media URLs.
- Extended `scripts/check_route_contract.py` with a global frontend guard:
  - `localStorage.getItem('auth_token')` is only allowed in `admin/adminAuth.ts` (tests excluded).
  - newly migrated pages/services are covered by required `httpClient` snippets.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `frontend_http_client_checks=6639`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`
- Direct `auth_token` reads in production frontend code now resolve to `admin/adminAuth.ts` only.
- Local frontend build remains blocked by the existing missing Rollup optional package `@rollup/rollup-win32-x64-msvc`.
- `tsc --noEmit` still fails on existing baseline fixture/component type errors; no new changed-file auth helper type errors appeared in the latest run.

## 2026-06-20 Frontend Video Service API Base Cleanup

### Changes

- Removed the empty `API_BASE` constant from `new_html/services/videoService.ts`.
- Replaced legacy `${API_BASE}/api/...` and `${API_BASE}/uploads/...` string templates with explicit root-relative paths.
- Added `API_BASE` to the shared frontend service contract forbidden snippets so migrated service files cannot reintroduce the old base-url shim.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `frontend_http_client_checks=6649`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`
  - `rg -n "API_BASE" deploy/new_html --glob "*.ts" --glob "*.tsx"` -> no production frontend matches
- `tsc --noEmit` still fails on existing baseline fixture/component type errors; this cleanup did not add new `videoService.ts` type errors in the latest run.

## 2026-06-20 Entity Files Router Mapper Cleanup

### Changes

- Moved the `/api/user-files` total-count SQL out of `routers/entity_files.py` into `EntityFileDAO.count_user_files()`.
- Kept the router behavior unchanged: rows still come from `FileDAO.get_user_files()`, and total count now comes from the DAO semantic method.
- Extended `scripts/check_route_contract.py` so `routers/entity_files.py` cannot reintroduce the old `count_query` / direct `fetchval` path.

### Verification

- Local checks passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `service_mapper_purity_checks=443`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/routers/entity_files.py deploy/dao/content/entity_file.py deploy/scripts/check_route_contract.py`

## 2026-06-20 Task Notifications Router Mapper Cleanup

### Changes

- Moved `/api/tasks/active` task lookup into `TaskDAO.get_active_tasks_for_user()`.
- Moved `/api/tasks/notifications` terminal task lookup into `TaskDAO.get_terminal_tasks_for_notifications()`.
- Kept stale-task auto-cleanup suppression in the DAO notification query.
- Extended `scripts/check_route_contract.py` so task notification routes cannot reintroduce direct task SQL or `db.fetch()` lookups.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/routers/task_notifications.py deploy/dao/business/task.py deploy/scripts/check_route_contract.py`
  - `rg -n "\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b|db\.(fetch|fetchrow|fetchval|execute)|conn\.(fetch|fetchrow|fetchval|execute)" deploy/routers/task_notifications.py` -> no matches
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `service_mapper_purity_checks=450`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`

## 2026-06-20 Episode Video Router Mapper Cleanup

### Changes

- Added `EpisodeDAO.get_project_id()` as a semantic mapper method for episode-to-project resolution.
- Moved `/api/episodes/{episode_id}/compose` project lookup out of `routers/episode_video.py` and into `EpisodeDAO`.
- Removed unused `get_db_manager_func` injection from `create_task_notifications_router()` after its SQL was moved to `TaskDAO`.
- Updated `api_routes.py` wiring so episode video routes receive `episode_dao` instead of raw DB access.
- Extended `scripts/check_route_contract.py` so `episode_video.py` cannot reintroduce direct `episodes` SQL or DB fetch calls.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/api_routes.py deploy/routers/episode_video.py deploy/routers/task_notifications.py deploy/dao/creative/episode.py deploy/scripts/check_route_contract.py`
  - `rg -n "SELECT project_id FROM episodes|get_db_manager_func|db\.fetchrow\(" deploy/routers/episode_video.py deploy/routers/task_notifications.py` -> no matches
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `service_mapper_purity_checks=456`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`

## 2026-06-20 Task Generated File Delete Mapper Cleanup

### Changes

- Added `FileDAO.soft_delete_user_files_by_path_fragment()` for the generated-file cleanup path used when deleting tasks.
- Moved the `UPDATE files ... file_path LIKE ...` soft-delete SQL out of `routers/tasks.py`.
- Updated `create_task_router()` wiring so the task router receives `FileDAO` instead of executing file-record SQL directly.
- Extended `scripts/check_route_contract.py` so `routers/tasks.py` cannot reintroduce direct generated-file soft-delete SQL.

### Follow-Up

- User reported that storyboards disappeared during testing. Need to restore/diagnose later by checking whether the issue is frontend pagination/lazy-load display, `storyboard_items` data, or legacy `projects.storyboard` migration/compatibility.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/cluster_main.py deploy/routers/tasks.py deploy/dao/content/content.py deploy/scripts/check_route_contract.py`
  - `rg -n "UPDATE files|RETURNING file_id|result = await db\.execute\(" deploy/routers/tasks.py` -> no matches
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `service_mapper_purity_checks=461`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`

## 2026-06-20 Storyboard Stale Script Fallback

### Diagnosis

- Server data for `ep_2fc899a228f5` is intact: unfiltered storyboard endpoint returns 152 items; paged mode returns 10 items with total 152.
- A stale or mismatched `selectedScriptId` can make the same storyboard endpoint return `items=[]` and `total=0`, which appears in the UI as "storyboards disappeared".
- Verified the behavior by comparing the target episode endpoint with and without a missing `script_id` filter.

### Changes

- Added a read-only fallback in `getStoryboardItems()`: if a script-filtered storyboard GET succeeds but returns no rows, retry once without `script_id`.
- Preserved pagination and lightweight `fields` options during fallback.
- Returned `fallbackScriptId` and `fallbackReason='empty_script_storyboard'` for observability.
- Added unit coverage and extended the route contract so the stale-script fallback cannot be accidentally removed.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `storyboard_paged_reload_checks=5`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`
- Frontend Vitest run is blocked locally by the existing missing optional Rollup package `@rollup/rollup-win32-x64-msvc`.

## 2026-06-20 Frontend-Aware Live Deploy and API Health UX

### Changes

- Updated `scripts/live_deploy_mvc2.sh` so live deployment also ships `new_html` source, excludes local `.env*` and `node_modules`, builds Vite on the server, and backs up/restores `dist`.
- Added `live_deploy_frontend_checks` to `scripts/check_route_contract.py` so the frontend build path cannot be silently removed from the live deploy script.
- Adjusted `AdminSettingsPage.tsx` provider health test feedback to use the fresh health endpoint result directly instead of a stale `runtimeMap` snapshot.

### Verification

- Deployed the frontend-aware script to `https://mecha.one`; remote Vite build completed and `drama.service` stayed `active`.
- Remote smoke test passed:
  - `/tmp/smoke_test.py https://mecha.one <service ADMIN_PASSWORD>` -> `9/9`
- Remote API health spot-check:
  - `gemini-text` -> `ok`, HTTP 200
  - `laozhang-gpt-image` -> `no_key` (expected until a key is configured)
- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/scripts/check_route_contract.py`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `live_deploy_frontend_checks=8`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`

## 2026-06-20 Admin API Runtime Status Model Matching

### Changes

- Updated `AdminSettingsPage.tsx` so individual API config cards resolve runtime diagnostics by `provider + model_name` first, then fall back to provider-level status.
- Kept quick provider cards on provider-level status because those cards are summary/configure entry points.
- Added `admin_api_config_ui_checks` to `scripts/check_route_contract.py` to guard the fresh health result path and model-aware runtime mapping.

### Verification

- Provider/API contracts passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_provider_contract.py`
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `admin_api_config_ui_checks=7`
- Local smoke passed:
  - `PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`
- Deployed to `https://mecha.one`; remote Vite build completed, `drama.service` stayed `active`, and remote smoke passed `9/9`.

## 2026-06-20 Project Admin Mapper Purity

### Changes

- Moved the project metadata update SQL out of `routers/project_admin.py`.
- Added `ProjectDAO.update_project_metadata()` so the router delegates project name, description, cover, and tag updates through a business DAO method.
- Removed the project-admin router dependency on `get_db_manager_func`.
- Extended `scripts/check_route_contract.py` so `routers/project_admin.py` cannot reintroduce direct `UPDATE projects`, `db.execute`, or `get_db_manager_func` usage.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/dao/content/content.py deploy/routers/project_admin.py deploy/api_routes.py deploy/scripts/check_route_contract.py`
  - `PYTHONUTF8=1 PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/check_architecture_contracts.py` -> `9/9`
  - `service_mapper_purity_checks=466`
  - `PYTHONUTF8=1 PYTHONIOENCODING=utf-8 deploy/.venv/Scripts/python.exe deploy/scripts/smoke_test.py` -> `9/9`

## 2026-06-20 Storyboard Export Mapper Purity

### Changes

- Moved the cross-table export-script transaction out of `routers/storyboard.py`.
- Added `StoryboardDAO.export_script_transaction()` to own the episode-script upsert, storyboard replacement, and asset extraction transaction.
- Added `AssetDAO.create_missing_episode_assets_transactional()` so character/scene asset dedupe and inserts stay in the DAO layer.
- Removed the storyboard router dependency on `get_db_manager_func`.
- Extended `scripts/check_route_contract.py` so `routers/storyboard.py` cannot reintroduce the export-script DB handle, direct storyboard deletion SQL, or direct asset insert SQL.

### Verification

- Local checks passed:
  - `deploy/.venv/Scripts/python.exe -m py_compile deploy/dao/creative/asset.py deploy/dao/creative/storyboard.py deploy/routers/storyboard.py deploy/api_routes.py deploy/scripts/check_route_contract.py deploy/tests/test_storyboard_stale_script_fallback.py`
  - `cd deploy && PYTHONUTF8=1 PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m pytest tests/test_storyboard_stale_script_fallback.py -q` -> `4 passed`
  - `cd deploy && PYTHONUTF8=1 PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/check_route_contract.py`
  - `service_mapper_purity_checks=479`

## 2026-06-20 Storyboard Stale Script UI Recovery

### Diagnosis

- `https://mecha.one` target episode `ep_2fc899a228f5` returns intact storyboard data:
  - paged endpoint: `items=10`, `total=152`
  - `fields=video`: `items=10`, `total=152`
  - bogus stale `script_id`: `items=10`, `total=152`, `fallback_reason=stale_script_storyboard`
- Backend fallback restored the visible storyboard list, but the frontend context could still keep the stale `selectedScriptId`, causing later asset loads or writes to keep using the dead script scope.

### Changes

- Normalized backend `fallback_script_id` / `fallback_reason` to frontend `fallbackScriptId` / `fallbackReason` in `getStoryboardItems()`.
- Updated `EpisodeContext` to clear stale `selectedScriptId` when storyboard loading falls back to episode scope.
- Updated `EpisodeContext` tests to reflect the current lazy-loading contract: pages explicitly request slices instead of the provider loading everything on mount.
- Extended `scripts/check_route_contract.py` with fallback metadata and context-cleanup guards.

### Verification

- Server deployment completed; Vite production build passed and `drama.service` stayed `active`.
- Server smoke passed:
  - `/tmp/smoke_test.py https://mecha.one <admin password>` -> `9/9`
- Server API spot-check for `ep_2fc899a228f5` passed:
  - `GET /api/episodes/ep_2fc899a228f5/storyboard-items?limit=10&include_total=true` -> `items=10`, `total=152`
  - `GET /api/episodes/ep_2fc899a228f5/storyboard-items?fields=video&limit=10&include_total=true` -> `items=10`, `total=152`
  - stale script probe -> `items=10`, `total=152`, `fallback_reason=stale_script_storyboard`
- Server frontend tests passed:
  - `npm run test:run -- --pool=threads __tests__/contexts/EpisodeContext.test.tsx` -> `6 passed`
  - `npm run test:run -- --pool=threads __tests__/services/apiService.test.ts` -> `21 passed`
- Server architecture contracts passed:
  - `scripts/check_architecture_contracts.py` -> `9/9`
  - `storyboard_paged_reload_checks=16`

## 2026-06-20 Frontend AI Chunk Split

### Changes

- Removed the top-level `aiModelService` static import from `new_html/WorkspaceApp.tsx`.
- Added `loadAiModelService()` so script/storyboard AI helpers are loaded only when the user triggers AI operations.
- Added `frontend_ai_chunk_split_checks` to `scripts/check_route_contract.py` to prevent future static `aiModelService` imports from merging the AI service/prompts layer back into the initial script workspace chunk.

### Follow-up

- User reported seeing storyboard content disappear yesterday. Keep this as a dedicated recovery item after the current performance pass; do not mix that investigation into unrelated bundle-splitting edits.

## 2026-06-20 App Shell CRM Host Deferral

### Changes

- Removed the eager `CrmHost` import from `new_html/App.tsx`.
- Added `DeferredCrmHost` so the CRM-style message/dialog host loads after browser idle instead of being parsed in the first app shell chunk.
- Added `frontend_app_shell_chunk_checks` to `scripts/check_route_contract.py` to keep `admin/crmUI` out of the App static import path.

### Expected Impact

- Keeps nonessential global admin/CRM UI code off the initial route shell.
- `crmMessage`, `crmConfirm`, and `crmPrompt` still use the same module and state; messages triggered before the idle host mounts are retained and render once the host loads.

## 2026-06-20 Admin Compat User Delete Mapper Purity

### Changes

- Added `UserDAO.delete_user_by_id()` for the legacy admin user delete endpoint.
- Replaced `routers/admin_compat.py` direct `DELETE FROM users` with the DAO method.
- Strengthened `service_mapper_purity_checks` so `services/` SQL literals are caught case-insensitively and `routers/admin_compat.py` cannot reintroduce direct user-delete SQL.

### Follow-up

- `routers/admin_compat.py` still contains larger admin statistics/reporting SQL blocks. Treat those as a later DAO/reporting-service extraction, not as general service-layer code.

## 2026-06-20 Admin Stats Breakdown Mapper Purity

### Changes

- Added `dao/admin/admin_stats.py` with `AdminStatsDAO`.
- Moved `/api/admin/stats?group_by=user|org` breakdown SQL and org aggregation support out of `routers/admin_compat.py`.
- Updated `routers/admin_compat.py` so the route delegates breakdown generation through `AdminStatsDAO.get_stats_breakdown()`.
- Extended `service_mapper_purity_checks` to guard this extraction and prevent the legacy `WITH u_files` / `organization_members` SQL from returning to the route.

### Follow-up

- The aggregate totals and generation logs in `routers/admin_compat.py` still contain direct reporting SQL. Continue extracting them into admin DAO/reporting helpers in small slices.

## 2026-06-20 Generation Workflow Bounded Storyboard Video Fields

### Changes

- Updated `new_html/pages/GenerationPage.tsx` so the generation workflow requests storyboard video fields with `limit` and `include_total=true` instead of loading every shot's video metadata up front.
- Load-more now increases the backend query limit by 10 shots at a time, using the backend `total` count for the button state.
- Added `visibleVideoSegments` so timeline duration and video track rendering only use video segments whose storyboard rows are currently loaded. This avoids placing unloaded-shot segments at `0s`.
- Strengthened `scripts/check_route_contract.py` so `GenerationPage` cannot return to the old unbounded `fields=video` request shape.

### Verification

- Local checks passed:
  - `git diff --check`
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_route_contract.py`
  - `deploy/.venv/Scripts/python.exe deploy/scripts/check_architecture_contracts.py`
- Route contract remains:
  - `openapi_paths=231`
  - `openapi_operations=287`
  - `generation_lightweight_storyboard_checks=11`

### Follow-up

- User reported that storyboard content disappeared yesterday. Keep this as the next dedicated recovery investigation: verify whether the rows still exist in DB, whether the selected script scope is stale, and whether frontend fallback clears the script selection correctly on the affected project/episode.

## 2026-06-20 Admin Compat User Route DB Plumbing Cleanup

### Changes

- Removed the `get_db_manager` dependency from `routers/admin_compat.py` and from its `cluster_main.py` registration.
- Kept legacy admin user create/delete routes on `UserDAO` business methods instead of route-local DB availability checks.
- Updated `UserDAO.delete_user_by_id()` to return `None` when the database manager is unavailable, preserving the old simulated-delete fallback without exposing connection plumbing to the router.
- Added `tests/test_user_dao_admin_delete.py` for the DB-unavailable and DB-backed delete paths.
- Strengthened `check_admin_compat_routes_extracted()` so admin compat routes cannot receive or reference DB plumbing again.
- Added the new DAO test to `scripts/live_deploy_mvc2.sh`.

### Verification

- Local checks passed:
  - `py_compile` for `routers/admin_compat.py`, `dao/user/user.py`, `cluster_main.py`, and `scripts/check_route_contract.py`
  - `pytest tests/test_user_dao_admin_delete.py tests/test_admin_stats_logs.py tests/test_project_read_access.py`
  - `scripts/check_route_contract.py`
  - `scripts/check_architecture_contracts.py`
- Route contract remains:
  - `openapi_paths=231`
  - `openapi_operations=287`
  - `admin_compat_route_handlers=7` including the new DB-plumbing purity guards.

## 2026-06-20 Admin API Provider Card Status Clarity

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` provider cards so every provider has an obvious `配置 / 修改 API Key` primary action.
- Split provider card status text into `生效 Key` and `DB Key`, making it clear when real generation calls are using a runtime/env key while the DB row itself has no saved key.
- Labeled provider health badges as `生效状态` so `/api/admin/api-configs/{provider}/health` is visually separated from per-row DB diagnostics.
- Expanded DB config test feedback to show when a test borrowed the effective runtime key instead of using a saved DB key.
- Strengthened `scripts/check_route_contract.py` so the admin API config UI keeps these runtime-vs-DB status cues.

### Follow-up

- Still need a browser pass on `https://mecha.one/admin` after deployment to verify the revised labels remove the previous red `未配置` vs green health confusion for the real server data.

## 2026-06-20 Admin Runtime Key Migration Entry

### Findings

- A server dry-run showed runtime/env has importable keys while DB rows were still empty-key rows:
  - `env_keys_imported=10`
  - `env_keys_skipped_provider_claimed=5`
  - `env_keys_missing=2`
  - `updated_existing=10`
- This explains why API health could be green while DB config diagnostics showed no saved key.

### Changes

- Added a dedicated `迁移运行时 Key` action to `new_html/admin/AdminSettingsPage.tsx`.
- The action first calls `POST /api/admin/api-configs/import-presets` with `dry_run=true`, shows a confirmation with importable/skipped/missing counts, then writes runtime keys into DB only after confirmation.
- Added a warning band when providers are using runtime/env keys but have no DB-saved key, so the API management platform clearly shows it has not fully taken over those providers yet.
- Strengthened `scripts/check_route_contract.py` to keep the dry-run migration path and runtime-only key warning in place.

## 2026-06-20 Task Read Service DB Plumbing Cleanup

### Changes

- Removed `get_db_manager` plumbing from `services/task_read_service.py` and its `routers/tasks.py` call sites.
- Let `TaskDAO` and `FileDAO` own DB-unavailable fallbacks for task read/delete and generated-file soft delete helpers.
- Kept the existing Redis fallback behavior for task status/list endpoints: DAO returning `None` now triggers queue fallback in the service.
- Strengthened `scripts/check_route_contract.py` so task routes and task read service cannot reintroduce DB connection plumbing.

### Verification

- Local `py_compile` passed for the touched task router/service/DAO files.
- Local `pytest tests/test_task_read_service.py -q` passed `5/5`.

## 2026-06-21 Auth User Service DB Plumbing Cleanup

### Changes

- Added `services/auth_user_service.py` to own DB password verification, login user-row sync, default permission assignment, and token-authenticated user-row auto-creation.
- Removed the `get_db_manager` parameter from `routers/auth.py` and from the `cluster_main.py` `create_auth_router(...)` registration.
- Replaced the inline `require_auth` DB user auto-create block with `ensure_authenticated_user_record(...)`.
- Added DB-unavailable fallbacks to the `UserDAO` auth-facing methods used by the new service.
- Strengthened `scripts/check_route_contract.py` so auth routes cannot reintroduce DB connection plumbing.
- Added `tests/test_auth_user_service.py` and expanded `tests/test_user_dao_admin_delete.py`.
- Added the new service and test to `scripts/live_deploy_mvc2.sh`.

### Verification

- Local `py_compile` passed for auth router/service, `dao/user/user.py`, `cluster_main.py`, and the route contract script.
- Local `pytest tests/test_auth_user_service.py tests/test_user_dao_admin_delete.py -q` passed `10/10`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `auth_route_handlers=8`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.

## 2026-06-21 Files Router DB Plumbing Cleanup

### Changes

- Removed the `get_db_manager` dependency from `routers/files.py` and its `cluster_main.py` registration.
- Let the thumbnail `/api/thumbnail` `/api/files/{file_id}` path resolve through `FileDAO.get_file()` directly.
- Added a DB-unavailable fallback to `FileDAO.get_file()` so routes receive `None` instead of connection plumbing exceptions.
- Added `tests/test_content_file_dao.py` for the DB-unavailable and query-shape paths.
- Strengthened `scripts/check_route_contract.py` so `routers/files.py` cannot receive or call DB connection plumbing again.
- Added the new DAO test to `scripts/live_deploy_mvc2.sh`.

### Verification

- Local `py_compile` passed for `routers/files.py`, `dao/content/content.py`, `cluster_main.py`, and the route contract script.
- Local `pytest tests/test_content_file_dao.py tests/test_task_read_service.py -q` passed `7/7`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `service_mapper_purity_checks=587`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.

## 2026-06-21 Entity Files Router DB Plumbing Cleanup

### Changes

- Removed the unused `get_db_manager_func` dependency from `routers/entity_files.py`.
- Removed the `db_manager.get_db_manager` import and entity-file router DB plumbing pass-through from `api_routes.py`.
- Added a DB-unavailable fallback to `FileDAO.get_user_files()` so `/api/user-files` returns an empty list instead of requiring route-level connection checks.
- Expanded `tests/test_content_file_dao.py` to cover `FileDAO.get_user_files()` DB-unavailable and query-shape paths.
- Strengthened `scripts/check_route_contract.py` so `api_routes.py` and `routers/entity_files.py` cannot reintroduce entity-file DB plumbing.

### Verification

- Local `py_compile` passed for `api_routes.py`, `routers/entity_files.py`, `dao/content/content.py`, and the route contract script.
- Local `pytest tests/test_content_file_dao.py tests/test_project_read_access.py -q` passed `8/8`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `entity_file_route_handlers=13` including purity guards.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Runtime route/service DB plumbing search now only finds `cluster_main.py` DB lifecycle initialization/shutdown.

## 2026-06-21 Three.js Chunk Split

### Changes

- Added a dedicated Vite `three-vendor` manual chunk so the optional 3D angle controller no longer carries Three.js inside its business component chunk.
- Added `check_frontend_three_chunk_contract()` to keep Three.js imports limited to the optional 3D controller boundary and to preserve the `three-vendor` split.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_three_chunk_checks=3`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local frontend build could not run because the Windows `node_modules` tree is missing Rollup's optional native package and this shell has no npm/corepack; server build is authoritative for this change.
- Server `live_deploy_mvc2.sh` built successfully.
- Server build output split:
  - `MultiAngle3DController-*.js`: 11.46 kB build output, 12K on disk
  - `three-vendor-*.js`: 512.05 kB build output, 501K on disk
- Server route contract and architecture contract passed.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 React Flow Chunk Split

### Changes

- Added a dedicated Vite `flow-vendor` manual chunk so the Canvas route no longer carries React Flow inside its business page chunk.
- Added `check_frontend_flow_chunk_contract()` to keep `@xyflow/react` imports scoped to `CanvasPage` and the `canvas/` node boundary, and to preserve the `flow-vendor` split.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_flow_chunk_checks=4`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `live_deploy_mvc2.sh` built successfully.
- Server build output split:
  - `CanvasPage-*.js`: 7.39 kB build output, 7.3K on disk
  - `flow-vendor-*.js`: 181.80 kB build output, 178K on disk
- Server route contract and architecture contract passed.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Core Frontend Vendor Split

### Changes

- Added dedicated Vite `router-vendor` and `query-vendor` manual chunks for `react-router-dom` and `@tanstack/react-query`.
- Added `check_frontend_core_vendor_chunk_contract()` to preserve the app infrastructure chunk split.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_core_vendor_chunk_checks=2`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `live_deploy_mvc2.sh` built successfully.
- Server build output split:
  - `index-*.js`: 250.74 kB build output, 245K on disk
  - `router-vendor-*.js`: 37.78 kB build output, 37K on disk
  - `query-vendor-*.js`: 45.77 kB build output, 45K on disk
- Server route contract and architecture contract passed.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Utility Frontend Vendor Split

### Changes

- Replaced the mixed Vite `utils` manual chunk with dedicated `icons-vendor` and `id-vendor` chunks for `lucide-react` and `uuid`.
- Added `check_frontend_utility_vendor_chunk_contract()` to preserve the explicit utility vendor split.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_utility_vendor_chunk_checks=4`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `live_deploy_mvc2.sh` built successfully.
- Server build output split:
  - `icons-vendor-*.js`: 61.64 kB build output, 61K on disk
  - `id-vendor-*.js`: 0.94 kB build output, 941 bytes on disk
  - `index-*.js`: 250.80 kB build output, 245K on disk
- Server route contract and architecture contract passed.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Legacy Workspace Lazy Views

### Changes

- Converted `WorkspaceApp` legacy Materials, Generation, Video, History, and Admin views from static imports to `React.lazy()` boundaries.
- Added local Suspense fallbacks for those legacy views so the script workflow no longer directly imports non-script workspaces.
- Expanded `check_frontend_workflow_chunk_contract()` to preserve the legacy lazy-view boundary.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_workflow_chunk_checks=17`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `live_deploy_mvc2.sh` built and restarted successfully.
- Server build output kept legacy view chunks separate:
  - `ScriptPage-*.js`: 141.58 kB build output, 139K on disk
  - `MaterialPage-*.js`: 58K on disk
  - `GenerationPage-*.js`: 89K on disk for the legacy component chunk
  - `VideoPage-*.js`: 149K on disk
  - `AdminPage-*.js`: 54K on disk
  - `HistoryPage-*.js`: 14K on disk
- Server route contract and architecture contract passed.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 API Provider Health Model Targeting

### Changes

- Added optional `model_name` targeting to `GET /api/admin/api-configs/{provider_id}/health`.
- Extended provider health sweeps to accept `targets=[{provider, model_name}]`, so batch health checks can test the active provider/model pair instead of only the provider default.
- Updated `new_html/admin/AdminSettingsPage.tsx` so provider cards and batch health refresh pass the primary DB config/runtime model name.
- Added contract coverage for model-aware provider health checks and model-aware health sweep targets.

### Verification

- Local `py_compile` passed for touched backend scripts/services.
- Local `scripts/check_admin_api_config_health.py` passed with `provider_runtime_health=2`.
- Local `scripts/check_provider_health_monitor.py` passed with `sweep_target_model_checks=2`.
- Local `scripts/check_route_contract.py` passed with `admin_api_config_route_handlers=17` and `admin_api_config_ui_checks=17`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `live_deploy_mvc2.sh` built and restarted successfully.
- Server route contract and architecture contract passed.
- Online smoke test against `https://mecha.one` passed `9/9`.
- Authenticated online check `GET /api/admin/api-configs/deepseek/health?model_name=deepseek-reasoner` returned 200 with `model_name=deepseek-reasoner`.

## 2026-06-21 API Runtime Status Model Targeting

### Changes

- Updated `build_provider_runtime_status()` so every API preset row resolves with `resolve_provider(provider, model_name)`.
- Passed the same row-level `model_name` into failover diagnostics, keeping admin runtime status aligned with the provider/model shown on each card.
- Tightened provider and route contracts so runtime status rows must report `runtime_model_name == model_name` with `model_source=request`.

### Verification

- Local `py_compile` passed for `api_provider_runtime.py` and the touched contract scripts.
- Local `scripts/check_provider_contract.py` passed with `runtime_status_rows=17`.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=123`.

## 2026-06-21 API Provider Health Cache Model Keys

### Changes

- Changed provider health normalization, runtime diagnostics, Redis cache keys, and admin UI state maps to prefer `provider + model_name` health rows.
- Kept provider-only health rows as a fallback for legacy/background checks while preventing same-provider models from overwriting each other.
- Updated health sweeps to dedupe by provider/model target, and made `/api/admin/api-configs` include cached health for DB custom model rows.
- Added frontend and backend contracts for model-specific health cache behavior.

### Verification

- Local `py_compile` passed for touched backend services and contract scripts.
- Local `scripts/check_provider_contract.py` passed with `health_map_checks=1`.
- Local `scripts/check_provider_health_monitor.py` passed with `sweep_target_model_checks=4`.
- Local `scripts/check_route_contract.py` passed with `admin_api_config_ui_checks=23`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `live_deploy_mvc2.sh` built frontend and restarted `drama.service` successfully.
- Server architecture contract suite passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.
- Authenticated online check confirmed `deepseek / deepseek-reasoner` health is cached and returned by `/api/admin/api-configs`.

## 2026-06-21 API Provider Health Default Model Sweep

### Changes

- Updated the default/background provider health sweep to expand registry presets into provider/model targets.
- Kept explicit `providers=[...]` sweeps provider-only for quick targeted checks and backward compatibility.
- Added contract coverage proving default sweeps cache model-specific rows such as `deepseek / deepseek-reasoner`.

### Verification

- Local `py_compile` passed for `api_provider_health_monitor.py` and `check_provider_health_monitor.py`.
- Local `scripts/check_provider_health_monitor.py` passed with `default_model_sweep_checks=3`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `live_deploy_mvc2.sh` built frontend and restarted `drama.service` successfully.
- Server `scripts/check_provider_health_monitor.py` passed with `default_model_sweep_checks=3`.
- Server architecture contract suite passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 AI Proxy Model Health Failover Contract

### Changes

- Added a contract case proving Gemini text generation honors model-specific health cache rows during call-level failover.
- Covered the case where `gemini-text` provider-level health is `ok`, but `gemini-2.5-flash` health is `error`, and the actual text call selects DeepSeek.
- No runtime code changed; this protects the existing model-aware resolver behavior from regressing to provider-only health checks.

### Verification

- Local `py_compile` passed for `check_ai_proxy_failover.py`.
- Local `scripts/check_ai_proxy_failover.py` passed with `gemini_text_model_health_failover=1`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.

## 2026-06-21 Frontend Markdown Dependency Cleanup

### Changes

- Removed unused `react-markdown` and `remark-gfm` from `new_html/package.json`.
- Regenerated `new_html/package-lock.json` with the server npm result, pruning the unused Markdown renderer packages and their unreachable dependency tree.
- Added `check_frontend_dependency_contract()` to `scripts/check_route_contract.py` so those packages cannot be reintroduced through dependencies, lockfile entries, or frontend source imports.

### Verification

- Deployed the cleanup build with `scripts/live_deploy_mvc2.sh`; server Vite build passed and `drama.service` stayed `active`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`, including `frontend_dependency_checks=11`.
- Online smoke test against `https://mecha.one` passed `9/9`.
- Local exact search found no `react-markdown`, `remark-gfm`, `ReactMarkdown`, or `remarkGfm` references in frontend source/config after cleanup.
- Server npm lockfile verification passed with `npm install --package-lock-only --ignore-scripts`; npm normalized the lockfile to 241 package entries.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_dependency_checks=11`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Note: server npm audit still reports existing dependency audit findings (`1 low`, `2 moderate`, `6 high`); this cleanup removes unused packages but does not attempt a broad dependency upgrade.

## 2026-06-21 Task Notification Service Split

### Changes

- Extracted task polling and persistent notification API helpers from `new_html/services/apiService.ts` into `new_html/services/taskNotificationService.ts`.
- Updated `globalTaskManager` and `TaskContext` to import task/notification APIs from the new service directly.
- Kept `apiService.ts` compatibility re-exports so older imports continue to work while new task code has a clear ownership boundary.
- Strengthened `scripts/check_route_contract.py` so task notification endpoints are checked against `taskNotificationService.ts` and `globalTaskManager` cannot drift back to the monolithic service.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6829`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.

## 2026-06-21 Video Workspace Service Split

### Changes

- Extracted pure video task/session types into `new_html/services/videoTaskTypes.ts`.
- Extracted workspace session persistence, storyboard metadata, and reactive duration mapping into `new_html/services/videoWorkspaceService.ts`.
- Kept `new_html/services/videoService.ts` as a compatibility re-export while removing duplicated task/session type and workspace API implementations from it.
- Updated `VideoGenPage`, `VideoPage`, `VideoCard`, `storyboardSync`, `useReactiveDuration`, `StoryboardSyncModal`, and `videoTaskInsert` to consume the narrower type/workspace services directly.
- Strengthened `scripts/check_route_contract.py` to guard `videoTaskTypes.ts`, `videoWorkspaceService.ts`, and the direct workspace-service imports.
- Updated `DashScopeCards.test.tsx` to match the current Kling mode toggle behavior: `Omni` / `Multi`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7125`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local UTF-8 scan passed for `new_html/**/*.ts*`.
- Local npm was unavailable on Windows PATH, so frontend build/tests were verified on the server.
- Server `scripts/live_deploy_mvc2.sh` timed out locally while remote build was still running; the remote build was completed manually with `npm run build`, then `drama.service` was restarted and reported `active`.
- Server build emitted a standalone `videoWorkspaceService-*.js` chunk at `1.11 kB`; app shell `index-*.js` is `236.01 kB`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=5993`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Server Vitest subset passed `56/56`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Task Service Split

### Changes

- Extracted video generation task submission, task status/history/cancel/delete APIs, queued ComfyUI task wrappers, Seedance/DashScope task submitters, storyboard audio mixing, UUID helpers, and bounded concurrency helper from `new_html/services/videoService.ts` into `new_html/services/videoTaskService.ts`.
- Reduced `new_html/services/videoService.ts` to a 66-line compatibility facade that re-exports the focused video services.
- Updated `VideoPage`, `VideoGenPage`, `EnhancePage`, `videoTaskPoller`, `ttsTaskPoller`, `TaskContext`, `storyboardSync`, and `videoTaskInsert` to import task APIs/helpers directly from `videoTaskService.ts`.
- Kept the existing compatibility import test in `videoMediaService.test.ts` so legacy `videoService` callers remain covered.
- Strengthened `scripts/check_route_contract.py` to guard `videoTaskService.ts` ownership and direct task-service imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7145`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local UTF-8 scan passed for `new_html/**/*.ts*`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build kept app shell `index-*.js` at `236.01 kB` and `VideoPage-*.js` at `154.53 kB`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6013`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Server Vitest subset passed `56/56`.
- Online smoke test against `https://mecha.one` passed `9/9`.
- Server build split `apiService-*.js` into a separate 10.29 kB chunk and reduced the main `index-*.js` chunk from about 250.7 kB to 240.4 kB.
- Server `npm run test:run -- --pool=forks __tests__/services/globalTaskManager.test.ts` passed `2/2`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Task Service Split

### Changes

- Extracted video generation task submission, task status/history/cancel/delete APIs, queued ComfyUI task wrappers, Seedance/DashScope task submitters, storyboard audio mixing, UUID helpers, and bounded concurrency helper from `new_html/services/videoService.ts` into `new_html/services/videoTaskService.ts`.
- Reduced `new_html/services/videoService.ts` to a 66-line compatibility facade that re-exports the focused video services.
- Updated `VideoPage`, `VideoGenPage`, `EnhancePage`, `videoTaskPoller`, `ttsTaskPoller`, `TaskContext`, `storyboardSync`, and `videoTaskInsert` to import task APIs/helpers directly from `videoTaskService.ts`.
- Kept the existing compatibility import test in `videoMediaService.test.ts` so legacy `videoService` callers remain covered.
- Strengthened `scripts/check_route_contract.py` to guard `videoTaskService.ts` ownership and direct task-service imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7145`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local UTF-8 scan passed for `new_html/**/*.ts*`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build kept app shell `index-*.js` at `236.01 kB` and `VideoPage-*.js` at `154.53 kB`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6013`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Server Vitest subset passed `56/56`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Model Service Split

### Changes

- Extracted pure video model names/types, Seedance media params, DashScope params/defaults, model display names, selectable model list, and task-type inference helpers from `new_html/services/videoService.ts` into `new_html/services/videoModelService.ts`.
- Kept `videoService.ts` compatibility re-exports while task submission remains in the generation service.
- Updated DashScope cards/tests, Seedance helper components, video card layout helpers, and `VideoPage.tsx` imports to use `videoModelService.ts` directly.
- Strengthened `scripts/check_route_contract.py` so pure model-service ownership and the production `SELECTABLE_MODELS` whitelist stay guarded.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7091`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.

## 2026-06-21 Episode Data Service Split

### Changes

- Extracted episode storyboard/assets/audio/video/script/character data helpers from `new_html/services/apiService.ts` into `new_html/services/episodeDataService.ts`.
- Kept `apiService.ts` compatibility re-exports so older imports continue to work.
- Updated `EpisodeContext` and `useEpisodeData` to import the episode data helpers directly from the new service.
- Moved storyboard fallback and lightweight-field contract checks to the new service owner.
- Moved episode data URL/fallback unit coverage from `apiService.test.ts` to `episodeDataService.test.ts`; kept `apiService.test.ts` focused on APIs still owned by the monolithic compatibility layer.
- Updated routing tests to assert the current workflow labels and page headings.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6853`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `episodeDataService-*.js` as a separate 2.26 kB chunk and kept `apiService-*.js` at 8.26 kB.
- Server `npm run test:run -- --pool=forks __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts` passed `37/37`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Audio Generation Service Split

### Changes

- Extracted audio track writes, audio generation, character voice writes, and MiniMax audio helpers from `new_html/services/apiService.ts` into `new_html/services/audioGenerationService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing the duplicated audio/Minimax endpoint implementations from the monolithic file.
- Updated `AudioStagePage`, `VoiceSidebar`, `MusicModal`, and MiniMax TTS tests to import audio APIs directly from the new service.
- Moved remaining storyboard/video read helpers in workflow pages and `WorkspaceApp` to `episodeDataService.ts`.
- Added `audioGenerationService.test.ts` and strengthened `scripts/check_route_contract.py` so audio endpoint ownership stays in the new service.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6881`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build kept `apiService-*.js` at 8.26 kB and `index-*.js` at 240.50 kB after the service-boundary split.
- Server `npm run test:run -- --pool=forks __tests__/services/apiService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/services/minimaxTTSSync.test.ts __tests__/components/VoiceSidebar.handlePreview.test.tsx __tests__/services/episodeDataService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `51/51`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Workflow Service Split

### Changes

- Extracted video segment writes, Seedance/ComfyUI capability probes, video takes, and final compose helpers from `new_html/services/apiService.ts` into `new_html/services/videoWorkflowService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing the duplicated video workflow implementation from the monolithic file.
- Updated `FinalProductPage`, `EnhancePage`, `GenerationPage`, `VideoPage`, and `SeedanceMultimodalPanel` to import video workflow APIs directly from the new service.
- Added `videoWorkflowService.test.ts` and strengthened `scripts/check_route_contract.py` so video workflow endpoint ownership stays in the new service.

### Verification

- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6904`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vitest could not run because the Windows `node_modules` is missing Rollup optional dependency `@rollup/rollup-win32-x64-msvc`; server tests below are authoritative.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `videoWorkflowService-*.js` as a separate `0.94 kB` chunk and reduced the built `apiService-*.js` chunk to `7.49 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `52/52`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Asset and Storyboard Mutation Service Split

### Changes

- Extracted asset create/update/delete/share helpers from `new_html/services/apiService.ts` into `new_html/services/assetMutationService.ts`.
- Extracted storyboard create/delete/delete-all/reorder/export helpers from `new_html/services/apiService.ts` into `new_html/services/storyboardMutationService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing duplicated asset/storyboard mutation implementations from the monolithic file.
- Updated `DesignPage`, `MaterialsPage`, `StoryboardGenPage`, `AudioStagePage`, and `WorkspaceApp` to import these mutations directly from the new services.
- Added focused `assetMutationService.test.ts` and `storyboardMutationService.test.ts`, and strengthened `scripts/check_route_contract.py` so these endpoint families stay with their new owners.

### Verification

- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6946`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local `tsc --noEmit` remains blocked by existing project TS debt unrelated to this split, including missing Seedance test fixtures and legacy Workspace/App prop/type mismatches.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `assetMutationService-*.js` (`0.35 kB`) and `storyboardMutationService-*.js` (`0.63 kB`) as separate chunks, reducing the built `apiService-*.js` chunk to `5.36 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `59/59`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Script Timeline Service Split

### Changes

- Extracted multi-script CRUD, script segment batch operations, and timeline track helpers from `new_html/services/apiService.ts` into `new_html/services/scriptTimelineService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing duplicated script/timeline implementations from the monolithic file.
- Updated `WorkspaceApp` to import script/timeline APIs directly from the new service.
- Added `scriptTimelineService.test.ts` and strengthened `scripts/check_route_contract.py` so script/timeline endpoint ownership stays in the new service.

### Verification

- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6965`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `scriptTimelineService-*.js` (`0.82 kB`) as a separate chunk and reduced the built `apiService-*.js` chunk to `4.73 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `64/64`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Admin Compatibility Service Split

### Changes

- Extracted legacy admin users, stats, and generation log helpers from `new_html/services/apiService.ts` into `new_html/services/adminCompatService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing duplicated admin endpoint implementations from the monolithic file.
- Updated `AdminPage` to import admin compatibility APIs directly from the new service.
- Added `adminCompatService.test.ts` and strengthened `scripts/check_route_contract.py` so these legacy admin endpoint helpers stay with their new owner.

### Verification

- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6984`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `adminCompatService-*.js` (`0.70 kB`) as a separate chunk and reduced the built `apiService-*.js` chunk to `4.20 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/adminCompatService.test.ts __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `70/70`.
- Server `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6588`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 ComfyUI Bridge Service Split

### Changes

- Extracted `uploadImageToComfyUI` and `processMaterial` from `new_html/services/apiService.ts` into `new_html/services/comfyuiBridgeService.ts`.
- Updated `geminiService.ts` dynamic imports to load the smaller ComfyUI bridge chunk instead of the full `apiService.ts` compatibility layer.
- Kept `apiService.ts` compatibility re-exports while removing duplicated ComfyUI/material-processing implementations from the monolithic file.
- Moved upload coverage from `apiService.test.ts` to `comfyuiBridgeService.test.ts` and strengthened `scripts/check_route_contract.py` to keep this boundary from regressing.

### Verification

- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=7004`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `comfyuiBridgeService-*.js` (`1.83 kB`) as a separate chunk, reduced `apiService-*.js` to `2.76 kB`, and reduced `geminiService-*.js` to `14.90 kB`.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/comfyuiBridgeService.test.ts __tests__/services/adminCompatService.test.ts __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `70/70`.
- Server `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6608`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Project Workflow Service Split

### Changes

- Extracted project CRUD, project member management, episode management, and export-to-video helpers from `new_html/services/apiService.ts` into `new_html/services/projectWorkflowService.ts`.
- Updated `new_html/components/ShareResourceDialog.tsx` and `new_html/WorkspaceApp.tsx` to import the project workflow API directly from the new service.
- Kept `apiService.ts` compatibility re-exports while removing duplicated project and episode implementations from the monolithic file.
- Added `projectWorkflowService.test.ts` and strengthened `scripts/check_route_contract.py` so project workflow endpoint ownership stays with the new service.

### Verification

- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=7026`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `projectWorkflowService-*.js` (`0.58 kB`) as a separate chunk and no longer emitted a separate built `apiService-*.js` business chunk for this path.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/projectWorkflowService.test.ts __tests__/services/comfyuiBridgeService.test.ts __tests__/services/adminCompatService.test.ts __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `75/75`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6630`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Canvas Service Split

### Changes

- Extracted canvas board, node, and connection helpers from `new_html/services/apiService.ts` into `new_html/services/canvasService.ts`.
- Kept `apiService.ts` as a thin compatibility re-export layer; it no longer imports `apiJson` or contains `/api/canvas/*` calls.
- Added `canvasService.test.ts` for board/node/connection request contracts.
- Strengthened `scripts/check_route_contract.py` so canvas endpoint ownership stays in `canvasService.ts`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=7046`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vitest was unavailable because `npm` was not on the Windows PATH.
- Server build completed successfully after the initial live deploy command timed out while `npm run build` was still running; the build was completed manually, then `drama.service` was restarted and reported `active`.
- Server production assets no longer include `apiService-*.js` or `canvasService-*.js`; the compatibility layer is tree-shaken for this path.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/canvasService.test.ts __tests__/services/apiService.handleResponse.test.ts` passed `6/6`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6650`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Media Service Split

### Changes

- Extracted media URL signing, image/audio/video upload, project video task import cleanup, crop, and reupload helpers from `new_html/services/videoService.ts` into `new_html/services/videoMediaService.ts`.
- Kept `videoService.ts` compatibility re-exports while removing duplicated media/upload implementations from the larger video generation service.
- Updated `new_html/components/SeedanceMultimodalPanel.tsx` to import upload helpers directly from `videoMediaService.ts`.
- Added `videoMediaService.test.ts` for media URL tokenization, project video task import cleanup, crop, and reupload request contracts.
- Strengthened `scripts/check_route_contract.py` so media/upload endpoint ownership stays in `videoMediaService.ts`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=7075`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vitest was unavailable because `npm` was not on the Windows PATH.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `index-DrKLO5Y8.js` at `237.88 kB`, down from the prior `240.51 kB` app shell build; `VideoPage` remains the next large target at `154.44 kB`.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/videoMediaService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/canvasService.test.ts __tests__/routing/routing.test.tsx` passed `23/23`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6679`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 ComfyUI Generation Service Split

### Changes

- Extracted ComfyUI generation task submission, task polling, task registry synchronization, queued wrappers, material processing, matting, image fusion, panorama, auto-storyboard, and multi-grid storyboard helpers from `new_html/services/geminiService.ts` into `new_html/services/comfyuiGenerationService.ts`.
- Reduced `new_html/services/geminiService.ts` to Gemini text/proxy image helpers plus a compatibility re-export for existing imports.
- Updated `GenerationPage`, `MaterialPage`, and `DesignPage` to import ComfyUI generation helpers directly from `comfyuiGenerationService.ts`.
- Strengthened `scripts/check_route_contract.py` so ComfyUI generation endpoint ownership and direct page imports stay guarded.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7153`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local npm remains unavailable on Windows PATH, so frontend build was verified on the server.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `geminiService-*.js` at `15.60 kB`; app shell `index-*.js` stayed at `236.01 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6021`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 ComfyUI Task Wait Service Split

### Changes

- Extracted ComfyUI task status polling, wait helpers, queue status export, queue metadata conversion, and task registry synchronization from `new_html/services/comfyuiGenerationService.ts` into `new_html/services/comfyuiTaskWaitService.ts`.
- Kept `new_html/services/comfyuiGenerationService.ts` focused on generation task submission, queued wrapper orchestration, and ComfyUI workflow calls.
- Updated `GenerationPage`, `MaterialPage`, and `DesignPage` to import wait/status helpers directly from `comfyuiTaskWaitService.ts`.
- Strengthened `scripts/check_route_contract.py` so task polling ownership stays in the wait service and page imports stay explicit.
- During deployment, repaired the server frontend dependency state by rebuilding `new_html/node_modules` with `npm ci` after an interrupted build left dependency resolution inconsistent.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7205`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server frontend build passed after dependency refresh; emitted `comfyuiGenerationService-KPusP5yP.js` at `14.48 kB` and app shell `index-C8C0dirM.js` at `236.02 kB`.
- Server `drama.service` restarted successfully and reported `active`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6073`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Gemini/ComfyUI Chunk Decoupling

### Changes

- Removed the broad `export * from './comfyuiGenerationService'` compatibility export from `new_html/services/geminiService.ts`.
- Kept current callers explicit: Gemini image/text helpers continue to import from `geminiService.ts`, while ComfyUI generation helpers import from `comfyuiGenerationService.ts`.
- Strengthened `scripts/check_route_contract.py` to fail if `geminiService.ts` imports or re-exports `comfyuiGenerationService.ts` again.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7156`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted a standalone `comfyuiGenerationService-*.js` chunk at `15.00 kB`, with app shell `index-*.js` at `236.02 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6024`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Gemini Image Generation Service Split

### Changes

- Extracted Gemini image generation helpers from `new_html/services/geminiService.ts` into `new_html/services/geminiImageGenerationService.ts`.
- Updated `GenerationPage`, `MaterialPage`, and `DesignPage` to import Gemini image helpers directly from `geminiImageGenerationService.ts`.
- Kept `geminiService.ts` as a smaller text/compatibility layer that re-exports the image helpers for legacy callers.
- Strengthened `scripts/check_route_contract.py` so image-heavy pages cannot regress back to importing `geminiService.ts` for Gemini image generation.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7179`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build no longer emitted a standalone `geminiService-*.js` chunk for the image-heavy pages; app shell `index-*.js` stayed at `236.02 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6047`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Provider Panel Chunk Split

### Changes

- Split `new_html/components/video/SeedancePanelWithCandidates.tsx` and `new_html/components/video/DashScopeCardWithCandidates.tsx` out of `new_html/components/video/VideoCard.tsx`.
- Converted `VideoPage` provider panels to `React.lazy` chunks with stable-height fallbacks, so Seedance/DashScope UI loads only for cards that need those provider controls.
- Kept `VideoCard.tsx` as a lightweight shared primitive module for duration fields, audio badges, and storyboard image display.
- Strengthened `scripts/check_route_contract.py` so `VideoCard.tsx` cannot regress to statically importing `SeedanceMultimodalPanel`, `DashScopeCards`, `DashScopeVideoCard`, or `SeedanceMentionPromptEditor`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7223`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `VideoPage-pELF8rue.js` at `136.13 kB`, down from the prior `VideoPage-CDrwW23j.js` at `154.53 kB`; provider panels split into `DashScopeCardWithCandidates-BO6mW1KA.js` at `20.31 kB` and `SeedancePanelWithCandidates-C63PjtFh.js` at `0.94 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6091`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Modal Chunk Split

### Changes

- Converted the `SeedanceDetailModal` and `StoryboardSyncModal` paths in `new_html/components/VideoPage.tsx` to `React.lazy` chunks.
- Kept `SyncMode` as a type-only import so the storyboard sync modal module is not loaded before the user opens it.
- Added a full-screen modal fallback for lazy video modals and guarded `StoryboardSyncModal` rendering behind `syncModalOpen`, preventing open=false modals from triggering lazy chunk loads.
- Strengthened `scripts/check_route_contract.py` so VideoPage cannot regress to static modal imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7230`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `VideoPage-CG5hoBqM.js` at `96.59 kB`, down from the prior `VideoPage-pELF8rue.js` at `136.13 kB`.
- Server build split lazy chunks: `SeedanceMultimodalPanel-DCi4iMPb.js` at `17.78 kB`, `SeedanceMentionPromptEditor-KAqryN0u.js` at `19.39 kB`, `SeedanceDetailModal-CIv0Cr22.js` at `1.95 kB`, and `StoryboardSyncModal-BtIw91QI.js` at `2.74 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6098`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Script Route Workspace Chunk Split

### Changes

- Converted `new_html/pages/ScriptPage.tsx` from a static `WorkspaceApp` import to a `React.lazy` route shell.
- Added `ScriptWorkspaceFallback` so the workflow shell can render immediately while the legacy workspace chunk loads.
- Strengthened `scripts/check_route_contract.py` so `ScriptPage` must lazy-load `WorkspaceApp` and cannot regress to a static import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=20`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `ScriptPage-jGEDm0NN.js` at `1.56 kB`, down from the prior script route chunk around `142.57 kB`; `WorkspaceApp-4C9Q9N6Y.js` is now an independent `142.14 kB` lazy chunk.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=20`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Workspace Editor Column Chunk Split

### Changes

- Converted the legacy editor columns in `new_html/WorkspaceApp.tsx` (`FileColumn`, `ViewerColumn`, `ScriptColumn`, `StoryboardColumn`) from static imports to `React.lazy` chunks.
- Added `LegacyColumnFallback` so each old editor column can load independently without changing props, resize state, or editor workflow behavior.
- Strengthened `scripts/check_route_contract.py` so `WorkspaceApp` must lazy-load editor columns and cannot regress to static imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=29`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `WorkspaceApp-BbSuuWpT.js` at `67.71 kB`, down from the prior `WorkspaceApp-4C9Q9N6Y.js` at `142.14 kB`.
- Server build split editor columns into `FileColumn-C1r1P__t.js` at `14.15 kB`, `ViewerColumn-CXj8ZXoL.js` at `3.74 kB`, `ScriptColumn-CuUAcLga.js` at `30.24 kB`, and `StoryboardColumn-Do3vooFZ.js` at `28.28 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=29`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 App Shell Video Task Chunk Split

### Changes

- Removed the static `videoTaskService` import from `new_html/contexts/TaskContext.tsx`.
- Converted backend task cancellation to a dynamic `import('../services/videoTaskService')`, keeping the optimistic local cancel behavior unchanged while avoiding video task submission/model code in the app shell.
- Strengthened `scripts/check_route_contract.py` so `TaskContext` must lazy-load `videoTaskService` and cannot regress to a static app-shell import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=7230`, and `frontend_app_shell_chunk_checks=11`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-DvjkqY_w.js` at `223.32 kB`, down from the prior `index-Dt9pk4qe.js` at `236.00 kB`.
- Server build split `videoTaskService-D_YRmEfM.js` at `9.69 kB`, loaded only when the global task context needs backend cancellation.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=6098`, and `frontend_app_shell_chunk_checks=11`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Task Control Service Split

### Changes

- Added `new_html/services/taskControlService.ts` for lightweight task control calls (`cancelTask`, `deleteTask`).
- Updated `new_html/contexts/TaskContext.tsx` to dynamically import `taskControlService` instead of `videoTaskService` when cancelling a task.
- Kept `new_html/services/videoTaskService.ts` backward-compatible by re-exporting `cancelTask` and `deleteTask`, while removing the direct implementations from the video generation service.
- Strengthened `scripts/check_route_contract.py` so task control ownership stays in `taskControlService`, and the app shell cannot regress to loading `videoTaskService` for cancellation.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=7251`, and `frontend_app_shell_chunk_checks=12`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `taskControlService-boNdFV2m.js` at `0.50 kB`, replacing the cancellation-time load of the full `videoTaskService` chunk.
- Server build emitted `videoTaskService-1SkFLo-c.js` at `9.19 kB`, down from the prior `videoTaskService-D_YRmEfM.js` at `9.69 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=6119`, and `frontend_app_shell_chunk_checks=12`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Gemini Image Alias Registry Move

### Changes

- Moved Gemini image model aliases from `services/ai_proxy_service.py` into `services/api_provider_registry.py`.
- Added registry-owned `normalize_gemini_image_model()` so AI proxy handlers consume provider/model metadata from the provider registry.
- Strengthened `scripts/check_provider_contract.py` so `GEMINI_IMAGE_MODEL_ALIASES` and `normalize_gemini_image_model()` cannot drift back into `ai_proxy_service.py`.

### Verification

- Local `diff --check` passed.
- Local `scripts/check_provider_contract.py` passed with `providers=12`, `presets=17`, and `gemini_image_alias_checks=5`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=12`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-DZIRn4Bt.js` at `223.36 kB`, `WorkspaceApp-WwKkM-rG.js` at `67.79 kB`, and `videoTaskService-1SkFLo-c.js` at `9.19 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=12`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Task Runtime App Shell Split

### Changes

- Removed the top-level `useSSEInvalidation` wrapper from `new_html/App.tsx`.
- Moved task notification query invalidation into `new_html/contexts/TaskContext.tsx`, so task events are handled by one runtime owner.
- Converted `globalTaskManager`, `taskNotificationService`, and `notificationMapping` from static `TaskContext` imports into dynamic runtime chunks.
- Deleted `new_html/hooks/useSSEInvalidation.ts` to prevent task transport from drifting back into the app shell.
- Strengthened `scripts/check_route_contract.py` so app shell chunk contracts reject static task runtime imports and require the new dynamic wiring.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=22`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vite build could not run because the Windows `node_modules` tree is missing Rollup optional package `@rollup/rollup-win32-x64-msvc`; no package files were changed for this local environment issue.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-B2nTUbrg.js` at `216.45 kB`, down from the prior `index-DZIRn4Bt.js` at `223.36 kB`.
- Server build split task runtime chunks: `globalTaskManager-DwHjopXU.js` at `4.98 kB`, `taskNotificationService-D9URRPBR.js` at `1.18 kB`, and `notificationMapping-D7Y2oSEc.js` at `2.31 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=22`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Global Toast App Shell Split

### Changes

- Converted `new_html/components/GlobalToast.tsx` from a static `App.tsx` import to a `React.lazy` chunk.
- Added `DeferredGlobalToastWithNav` so the toast host mounts after idle time and skips `/admin/*` routes.
- Strengthened `scripts/check_route_contract.py` so `GlobalToast` cannot regress to an eager app-shell import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=27`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-bLIzdp-w.js` at `212.30 kB`, down from the prior `index-B2nTUbrg.js` at `216.45 kB`.
- Server build split `GlobalToast-DK-5BwzP.js` at `4.82 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=27`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Workspace Organization Service Runtime Split

### Changes

- Converted `new_html/contexts/WorkspaceContext.tsx` to import `Organization` as type-only and load `listMyOrganizations()` via dynamic `import('../services/organizationService')`.
- Kept `/admin/*` workspace skip behavior unchanged while removing user/admin organization service code from the app shell.
- Strengthened `scripts/check_route_contract.py` so `WorkspaceContext` cannot regress to a static `listMyOrganizations` import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=30`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-Cp3pjs-n.js` at `206.53 kB`, down from the prior `index-bLIzdp-w.js` at `212.30 kB`.
- Server build split `organizationService-B_RBM9-T.js` at `1.46 kB` and `httpClient-DncKv2Q5.js` at `3.99 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=30`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 External API Runtime Refresh Contract

### Changes

- Added `external_runtime_refresh_checks` to `scripts/check_provider_contract.py`.
- The contract verifies shared external API clients refresh runtime provider config before request methods use API keys, endpoints, model names, or proxy settings.
- Covered MiniMax audio plus MiniMax, Seedance, DashScope, Wan2, Sora2, and Veo video clients.
- Allowed MiniMax audio's `_url()` helper as an indirect refresh path and verified `_url()` itself calls `_refresh_runtime_config()`.

### Deployment/Config Gap Covered

- Admin API config writes are designed to hot-update provider keys/endpoints without restarting `drama.service`.
- This guardrail prevents future provider-client refactors from silently reusing stale API keys, stale endpoints, model overrides, or proxy config after runtime config reloads.

### Verification

- Local `py_compile` passed for `scripts/check_provider_contract.py`.
- Local `scripts/check_provider_contract.py` passed with `external_runtime_refresh_checks=31`.

## 2026-06-21 Frontend Unauthorized Handling Consolidation

### Changes

- Added `handleUnauthorized()` to `new_html/services/httpClient.ts` as the shared 401/session-expiry handler for both normal fetch clients and special transports.
- Updated `new_html/services/videoMediaService.ts` so XHR uploads keep upload progress support but reuse the shared 401 redirect/session cleanup behavior.
- Updated `new_html/services/videoTaskService.ts` so historical task loading no longer clears auth state directly.
- Strengthened `scripts/check_route_contract.py` so migrated frontend services cannot reintroduce direct `localStorage.removeItem('auth_token')` cleanup and must use the shared unauthorized handler.

### Verification

- Local `diff --check` passed.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=7299`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Local targeted Vitest could not run because the Windows `node_modules` tree is still missing Rollup's optional `@rollup/rollup-win32-x64-msvc` package; pnpm execution was also blocked by a local symlink permission error.

## 2026-06-21 Materials/Audio Progressive Storyboard Field Loading

### Changes

- Changed `new_html/pages/MaterialsPage.tsx` to request only the first 20 `fields=materials` storyboard rows with `include_total=true`, then fill the rest in idle-time background pages of 80 rows.
- Changed `new_html/pages/AudioStagePage.tsx` to use the same first-screen limit and idle background paging for `fields=audio_stage`.
- Kept existing bounded rendering in `MaterialPage` and `DubbingPanel`; this change reduces the initial data request instead of only hiding already-loaded cards.
- Updated the material auto-binding patcher to track checked storyboard item ids so rows loaded later in background pages are still eligible for `char:/scene:` tag patching.
- Strengthened `scripts/check_route_contract.py` so both pages must keep limit, total, offset, and idle background paging.

### Verification

- Local `git diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`, including `audio_stage_lightweight_storyboard_checks=15` and `materials_lightweight_storyboard_checks=15`.
- Local `vite build` could not run because the Windows `node_modules` tree is still missing Rollup's optional `@rollup/rollup-win32-x64-msvc` package.
- Local `tsc --noEmit` still reports pre-existing project type errors outside this change; the new progressive loading code was not listed.

## 2026-06-21 Frontend Idle Scheduler Consolidation

### Changes

- Added `new_html/utils/idleScheduler.ts` with shared `runWhenIdle()` and `waitForIdle()` helpers.
- Replaced duplicated `requestIdleCallback` fallback logic in `new_html/App.tsx`, `VideoGenPage.tsx`, `StoryboardGenPage.tsx`, `MaterialsPage.tsx`, and `AudioStagePage.tsx`.
- `StoryboardGenPage` now cancels the idle asset preload if the page unmounts before the deferred callback runs.
- Strengthened `scripts/check_route_contract.py` so App shell, storyboard, video, material, and audio workflows keep using the shared idle scheduler.

### Verification

- Local `git diff --check` passed.
- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `storyboard_paged_reload_checks=33`, `frontend_app_shell_chunk_checks=36`, and `materials/audio lightweight checks=15/15`.

## 2026-06-21 Image Preload Idle Scheduler Completion

### Changes

- Updated `new_html/services/imageLoaderService.ts` so image preloading also uses `runWhenIdle()` instead of touching `requestIdleCallback` directly.
- Strengthened `scripts/check_route_contract.py` so production frontend code can only use `requestIdleCallback` / `cancelIdleCallback` inside `new_html/utils/idleScheduler.ts`.
- Added explicit contract coverage that `imageLoaderService.ts` keeps both shared `httpClient` and shared `idleScheduler` integration.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile scripts/check_route_contract.py` passed.
- Local `scripts/check_route_contract.py` passed with `storyboard_paged_reload_checks=33`, `frontend_http_client_checks=7304`, `frontend_dependency_checks=349`, and `frontend_app_shell_chunk_checks=36`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Admin API Settings Runtime/DB Status Split

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so provider cards treat "生效健康" as the primary runtime status and "高级诊断" as the separate DB-record test.
- When a DB record has no saved key but runtime/env key still works, the card and toast now show a yellow warning instead of a green DB success or red provider failure.
- Removed the legacy API edit button that routed users back to `/admin-legacy/?page=apiconfig`; the new `/admin/settings?item=legacy-apiconfig` API management panel is now the self-contained edit path.
- Strengthened `scripts/check_route_contract.py` to require the new runtime/DB wording and forbid routing API editing back to the legacy console.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile scripts/check_route_contract.py` passed.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=124`, `frontend_http_client_checks=7304`, `frontend_dependency_checks=349`, and `frontend_app_shell_chunk_checks=36`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Admin API Settings Legacy Parameter Compatibility

### Changes

- Changed `new_html/admin/AdminSettingsPage.tsx` so `/admin/settings?item=legacy-apiconfig` now renders the native API provider management panel instead of the old `/admin-legacy` iframe.
- Updated `new_html/admin/adminMenu.ts` so legacy API config bookmarks keep the normal `系统设置 / API 厂商配置` breadcrumb rather than advertising an old edit surface.
- Strengthened `scripts/check_route_contract.py` so `legacy-apiconfig` cannot be mapped back to the legacy iframe and old edit labels cannot reappear.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile scripts/check_route_contract.py` passed.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=127`, `frontend_http_client_checks=7304`, `frontend_dependency_checks=349`, and `admin_api_config_ui_checks=23`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 SmartApiRouter Dead Code Removal

### Changes

- Deleted `api_router.py`, the unused `SmartApiRouter` skeleton that still suggested a separate API dispatch path outside `services.ai_proxy_service` and `services.api_provider_runtime`.
- Removed the no-op Redis injection from `cluster_main.py`.
- Updated `scripts/live_deploy_mvc2.sh` to remove stale `api_router.py` from the server during deployment.
- Updated current architecture docs to list `routers/` as the route split owner instead of the removed file.
- Strengthened `scripts/check_route_contract.py` so `api_router.py` stays deleted and `cluster_main.py` cannot inject it again.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile cluster_main.py scripts/check_route_contract.py` passed.
- Local Git Bash `bash -n scripts/live_deploy_mvc2.sh` passed.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=127`, `frontend_http_client_checks=7304`, and `live_deploy_frontend_checks=13`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Current Architecture Docs API Runtime Refresh

### Changes

- Updated `ARCHITECTURE.md` so the current backend map points to `routers/` and no longer lists the deleted `api_router.py` as entry-level infrastructure.
- Updated `docs/安全加固清单.md` so the old SmartApiRouter custom-proxy risk is marked closed rather than active.
- Updated `docs/架构审计与重构计划.md` to reflect the current provider registry/runtime/API proxy baseline, mark DB endpoint hot-update as live, and move the next API replacement step to self-hosted provider adapters.
- Strengthened `scripts/check_route_contract.py` with a current-docs contract so active architecture docs cannot drift back to the removed SmartApiRouter model.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile scripts/check_route_contract.py` passed.
- Local `scripts/check_route_contract.py` passed with `current_architecture_docs_checks=12`, `api_provider_runtime_model_checks=127`, and `live_deploy_frontend_checks=13`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Live Deploy Current Docs Sync

### Changes

- Updated `scripts/live_deploy_mvc2.sh` so current architecture docs (`ARCHITECTURE.md` and `docs/`) are uploaded with each live deployment.
- Strengthened `scripts/check_route_contract.py` so future deployments keep those docs in the synced file set.
- This keeps the server-side route/architecture contracts aligned with the current provider-runtime documentation.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile scripts/check_route_contract.py` passed.
- Local Git Bash `bash -n scripts/live_deploy_mvc2.sh` passed.
- Local `scripts/check_route_contract.py` passed with `current_architecture_docs_checks=12` and `live_deploy_frontend_checks=15`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Video Legacy Model Alias Registry

### Changes

- Moved Sora2/Veo legacy video model alias handling into `services/api_provider_registry.py`.
- Updated `external_api/video/sora2.py` and `external_api/video/veo.py` to call registry helpers instead of defining local alias normalization functions.
- Updated `services/api_config_runtime_loader.py` so default provider seeding checks Sora2/Veo legacy model names through registry constants.
- Strengthened `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, and `tests/test_api_provider_runtime_model_env.py` so future clients cannot drift back to local hardcoded legacy aliases.
- Updated `scripts/live_deploy_mvc2.sh` to sync the runtime model env test to the server with live deployments.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile` passed for the changed Python modules and contract scripts.
- Local `scripts/check_provider_contract.py` passed with `video_default_model_checks=38`.
- Local targeted pytest passed: `tests/test_api_provider_runtime_model_env.py` + `tests/test_minimax_audio_runtime.py`, 32 passed.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=139`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `0b839e3` (`refactor(api-provider): centralize video legacy model aliases`) to `origin/refactor/v2`.
- Ran `scripts/live_deploy_mvc2.sh`; the local wrapper timed out after service restart, then manual verification confirmed the server was active and the updated files were present.
- Remote file sync check passed: `cluster_main.py` 985 lines, `admin_routes.py` 1502 lines, `dao/` 72 files.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 MiniMax Video Runtime Model Registry

### Changes

- Moved MiniMax video runtime model override and normalization helpers into `services/api_provider_registry.py`.
- Updated `external_api/video/minimax.py` so it no longer defines local runtime-model override logic.
- Extended `scripts/check_provider_contract.py` and `scripts/check_route_contract.py` to keep MiniMax/Sora2/Veo video model rules registry-owned.
- Extended `tests/test_api_provider_runtime_model_env.py` with registry helper coverage for MiniMax.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile` passed for the changed Python modules and contract scripts.
- Local `scripts/check_provider_contract.py` passed with `video_default_model_checks=50`.
- Local targeted pytest passed: `tests/test_api_provider_runtime_model_env.py` + `tests/test_minimax_audio_runtime.py`, 32 passed.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=144`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `d0a9901` (`refactor(api-provider): centralize minimax video model resolution`) to `origin/refactor/v2`.
- Ran `scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote file check confirmed `minimax_runtime_model_override` and `normalize_minimax_video_model` are present in the deployed registry/client path.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 DashScope Vidu Model Registry

### Changes

- Moved DashScope Vidu reference/start-end sub-model maps into `services/api_provider_registry.py`.
- Added `resolve_dashscope_default_model_name()` in `services/api_provider_runtime.py` so default DashScope model names resolve through runtime sub-model env values outside the client.
- Updated `external_api/video/dashscope.py` to call registry/runtime helpers instead of defining local Vidu maps or default-model reverse lookup.
- Strengthened `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, and `tests/test_api_provider_runtime_model_env.py` so DashScope model rules stay centralized.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile` passed for the changed Python modules and contract scripts.
- Local `scripts/check_provider_contract.py` passed with `video_default_model_checks=65`.
- Local targeted pytest passed: `tests/test_api_provider_runtime_model_env.py` + `tests/test_dashscope_video_payload_extension.py`, 39 passed.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=151`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `1d12d32` (`refactor(api-provider): centralize dashscope video model mapping`) to `origin/refactor/v2`.
- Ran `scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote file check confirmed `DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP`, `resolve_dashscope_default_model_name`, and `dashscope_vidu_reference_sub_model` are present in deployed registry/runtime/client paths.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 MiniMax Provider Default Registry Alias

### Changes

- Added `MINIMAX_DEFAULT_PROVIDER_MODEL` in `services/api_provider_registry.py` as the provider-level default alias for the shared MiniMax API provider.
- Updated `external_api/audio/minimax_audio.py` so audio runtime config resolves MiniMax through the provider-level alias instead of a video-named constant.
- Strengthened `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, and `tests/test_minimax_audio_runtime.py` so MiniMax audio stays wired to the provider-level default.
- Verified `scripts/live_deploy_mvc2.sh` already syncs directory-level `dao`, `services`, `utils`, `routers`, and `schemas`; no `pipeline/`, `agent_routes.py`, or `workflows/` entries are present.

### Verification

- Local `git diff --check` passed.
- Local `scripts/check_provider_contract.py` passed with `video_default_model_checks=68`.
- Local targeted pytest passed: `tests/test_minimax_audio_runtime.py` + `tests/test_api_provider_runtime_model_env.py`, 34 passed.
- Local `scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=152`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `4e9eeca` (`refactor(api-provider): clarify minimax provider default model`) to `origin/refactor/v2`.
- Ran `scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote file sync check: `cluster_main.py` 985 lines, `admin_routes.py` 1502 lines, `dao/` 72 files recursively.
- Remote file check confirmed `MINIMAX_DEFAULT_PROVIDER_MODEL` is present in deployed registry and MiniMax audio client paths.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 Frontend Local Tailwind Build

### Changes

- Replaced the production `new_html/index.html` Tailwind CDN runtime config with local Tailwind/PostCSS build files.
- Added `new_html/tailwind.config.cjs` and `new_html/postcss.config.cjs`, moving the Atlassian color, font, and shadow tokens into the build pipeline.
- Added Tailwind directives to `new_html/styles/design-tokens.css` and moved the existing animation/scrollbar helper CSS out of inline HTML.
- Removed the unused importmap CDN block for React, uuid, lucide, and Google GenAI from the Vite entry HTML.
- Extended `scripts/check_route_contract.py` so frontend dependency contracts reject runtime Tailwind/importmap CDN regressions and require local Tailwind lockfile/config wiring.

### Verification

- Remote temporary build with `npm ci && npm run build` passed before deployment.
- Production build output changed from runtime Tailwind CDN to a local CSS asset: `index-D1kXhn4K.css` 90.52 KB, gzip 15.64 KB.
- Built `dist/index.html` and assets were checked for `cdn.tailwindcss.com`, `aistudiocdn.com`, and `importmap`; no matches.
- Local `package.json` and `package-lock.json` parse check passed.
- Local `scripts/check_route_contract.py` passed with `frontend_dependency_checks=371`.
- Local `scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `976f179` (`perf(frontend): build tailwind locally instead of runtime CDN`) to `origin/refactor/v2`.
- Ran `scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote frontend build recovered as expected after `npm ci` installed the new Tailwind dependencies, then produced the local CSS asset.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote dist check confirmed no Tailwind/importmap CDN strings and `dist/assets/index-D1kXhn4K.css` is 89 KB on disk.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-22 Runtime CDN/WebFont Removal

### Changes

- Removed runtime Google Fonts links from `new_html/index.html`.
- Switched Tailwind, CSS design tokens, and admin mono labels to system font stacks.
- Rebuilt `login.html` as a self-contained static page with inline CSS/SVG icons instead of Tailwind CDN, Google Fonts, and jsDelivr lucide.
- Removed Google Fonts `@import` from `admin/style.css`.
- Updated `scripts/live_deploy_mvc2.sh` to sync `login.html`, the legacy `admin` directory, and this `Agent.md` file.
- Strengthened `scripts/check_route_contract.py` to reject runtime CDN/importmap/webfont dependencies in the Vite app shell, static login page, and legacy admin CSS.

### Verification

- Local `py_compile` for `scripts/check_route_contract.py`: passed.
- Local `scripts/check_route_contract.py`: passed with `frontend_dependency_checks=395` and `live_deploy_frontend_checks=37`.
- Local `scripts/check_architecture_contracts.py`: 10/10 passed.
- Server temporary `new_html` build passed after `npm ci`; generated `dist/index.html` is 811 bytes.
- Live deploy to `https://mecha.one/`: remote Vite build completed, `drama.service` stayed `active`, and server architecture contracts passed 10/10.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server grep found no `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.tailwindcss.com`, `cdn.jsdelivr.net`, `unpkg.com`, `aistudiocdn.com`, or `importmap` in deployed app shell/login/admin CSS assets.

## 2026-06-22 Self-contained Static Login

### Changes

- Removed the remaining `/static/js/auth.js` dependency from `login.html`.
- The static `/login` page now performs its own minimal unauthenticated `POST /api/login`, writes `auth_token` and `username` to `localStorage`, and redirects to `/projects`.
- Strengthened `scripts/check_route_contract.py` so `login.html` must contain the inline login/token path and must not depend on `/static/js/auth.js`, `/static/js/api.js`, `Auth.login`, or runtime CDN/webfont snippets.

### Verification

- Local HTML parse for `login.html` and `new_html/index.html`: passed.
- Local `git diff --check`: passed.
- Local `scripts/check_route_contract.py`: passed with `frontend_dependency_checks=406`.
- Local `scripts/check_architecture_contracts.py`: 10/10 passed.
- Live deploy to `https://mecha.one/`: remote Vite build completed, `drama.service` stayed `active`, and server architecture contracts passed 10/10.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Live `/login` HTML contains `fetch('/api/login')` and `localStorage.setItem(TOKEN_KEY)`, with no `/static/js/auth.js`, `Auth.login`, Tailwind CDN, Google Fonts, or jsDelivr references.

## 2026-06-22 Admin Cluster Node Metrics + Deploy Sync Contract

### Changes

- Removed the fake `Local-Node-01` fallback and random storage/GPU numbers from `new_html/components/AdminPage.tsx`.
- The admin cluster node view now accepts both list and map responses from `/api/cluster/nodes`, shows backend messages for agent-only or empty states, and displays `未上报` when storage/GPU metrics are not provided.
- Node cards now use responsive columns instead of forcing four columns on narrow admin layouts.
- Strengthened `scripts/check_route_contract.py` so AdminPage cannot reintroduce fake/random cluster node metrics.
- Strengthened the deploy script contract so `scripts/live_deploy_mvc2.sh` must continue syncing `dao`, `routers`, `schemas`, `services`, and `utils` as directories, while rejecting `pipeline/`, `agent_routes.py`, `workflows/`, and old one-file `services/*.py` sync entries.

### Verification

- Live deploy to `https://mecha.one/`: remote Vite build passed, `drama.service` stayed `active`, and server architecture contracts passed 10/10.
- Server sync check matched current local code: `cluster_main.py` 985 lines, `admin_routes.py` 1502 lines, `dao/` 36 recursive Python files plus 28 legacy root `dao_*.py` files.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Built-in Admin Password Hardening

### Changes

- Removed the implicit `admin / admin123` fallback from `cluster_main.py`; built-in admin login now requires an explicit `ADMIN_PASSWORD`.
- Added an explicit local-development escape hatch: `ALLOW_DEV_ADMIN_PASSWORD=true` enables the temporary `admin / admin123` password only for development/test environments.
- Built-in admin password values shorter than 8 characters now disable the built-in login path instead of silently accepting a weak password.
- Updated local/test verification scripts and deployment docs to prefer `ADMIN_PASSWORD` and describe the development-only fallback.
- Strengthened `scripts/check_route_contract.py` so `ADMIN_PASSWORD` cannot regain an `admin123` default.

### Verification

- Local route contract, architecture contract, targeted auth pytest, and script py_compile passed.
- Runtime matrix confirmed: no env rejects `admin123`; dev flag accepts it; strong `ADMIN_PASSWORD` works; short `ADMIN_PASSWORD` is disabled.
- Live deploy to `https://mecha.one/` passed; `drama.service` stayed `active`, remote architecture contracts passed 10/10, online smoke passed 9/9, and `admin / admin123` returned 401.

## 2026-06-22 CORS Allowlist Defaults

### Changes

- Unified CORS defaults in `cluster_config.py` and legacy `config.py` around an explicit allowlist: `https://mecha.one`, backend local dev, and Vite local dev origins.
- Aligned `cluster_config_generated.py` and the config template emitted by `auto_deploy_cluster.py` to the same allowlist helper, so generated configs cannot drift back to local-only defaults.
- Added `parse_cors_allow_origins()` so `CORS_ALLOW_ORIGINS` remains the single runtime override mechanism.
- Updated `scripts/live_deploy_mvc2.sh` to sync `cluster_config.py` and `config.py`; otherwise server deployments could miss security/config changes.
- Updated `scripts/live_deploy_mvc2.sh` to also sync `cluster_config_generated.py` and `auto_deploy_cluster.py`.
- Updated `docs/deployment.md` to remove the obsolete `ALLOW_ORIGINS = ["*"]` guidance.
- Strengthened `scripts/check_route_contract.py` with a CORS allowlist contract that rejects wildcard CORS defaults and requires the official domain.

### Verification

- Local CORS parser check confirmed active config modules, generated config, and auto-deploy template default to the explicit origin list and contain no wildcard CORS default.
- Local `git diff --check`, deploy script syntax check, route contract, and architecture contract passed.
- Live deploy to `https://mecha.one/` passed; remote architecture contracts passed 10/10 and online smoke passed 9/9.
- Remote sync check: `cluster_main.py` has 999 lines, `admin_routes.py` has 1502 lines, and `dao/` contains 36 Python files recursively.
- Remote generated CORS check confirmed `cluster_config_generated.py` reports the explicit origin list without wildcard CORS, and `auto_deploy_cluster.py` contains `https://mecha.one` without the old local-only default.

## 2026-06-22 Admin API Runtime Model Selection

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so provider quick cards and manual provider sweeps select runtime status by `provider + model`, not by provider alone.
- This keeps multi-model providers such as DashScope and Seedance from showing the first provider runtime row when the card is actually displaying another preset/model.
- Strengthened `scripts/check_route_contract.py` so the admin API config UI must keep the model-aware runtime helper and cannot regress to the old provider-only quick-card lookup.

### Verification

- Local `py_compile`, `check_route_contract.py`, `check_architecture_contracts.py`, and `git diff --check` passed.
- Local Vite build remains blocked by the known missing Windows Rollup optional package `@rollup/rollup-win32-x64-msvc`; local `tsc --noEmit` remains blocked by existing project-wide TypeScript debt outside `AdminSettingsPage.tsx`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, remote architecture contracts passed 10/10, and online smoke passed 9/9.

## 2026-06-22 API Health Cache Invalidation Precision

### Changes

- Added exact provider/model health cache clearing in `services/api_provider_health_monitor.py`.
- Updated `services/api_config_service.py` so API config create/update/delete and conflict repair invalidate both provider-level health and affected provider/model rows, including custom models and automatically disabled conflicting configs.
- Added prefix-level health cache clearing for `reload-env`, so full runtime reloads also remove custom provider/model cache entries that are not present in the registry preset list.
- Strengthened `scripts/check_provider_health_monitor.py` and `scripts/check_admin_api_config_crud.py` to cover exact model cache deletion and CRUD-triggered provider/model invalidation.

### Verification

- Local `py_compile`, targeted health monitor contract, targeted admin API config CRUD contract, full architecture contracts, and `git diff --check` passed.
- Health monitor contract covers global prefix cache clearing and admin reload fallback behavior.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, remote architecture contracts passed 10/10, and online smoke passed 9/9.
- Follow-up deploy for global reload cache clearing passed remote Vite build, remote architecture contracts 10/10, and online smoke 9/9.

## 2026-06-22 Admin API Health Cache UI Reset

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so provider health cache payloads are normalized through `buildProviderHealthMap()`.
- The "refresh status" action now replaces the local health map from `/api/admin/api-configs/health/cache` instead of merging into stale React state.
- This keeps the native API management page from showing old green/error indicators after backend cache clears from runtime reloads, preset imports, or provider config changes.
- Strengthened `scripts/check_route_contract.py` so `refreshHealthCache` cannot regress to merging stale `healthMap` state.

### Verification

- Local `py_compile` passed for `scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `admin_api_config_ui_checks=33`.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local TypeScript filter check reported no `AdminSettingsPage.tsx` errors.
- Local `git diff --check` passed.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Video Client Shared Download Base

### Changes

- Added `external_api/video/base.py` with `download_streaming_video()` as the shared streaming download helper for synchronous external video clients.
- Updated `external_api/video/seedance.py`, `sora2.py`, `veo.py`, and `wan2.py` to use the shared helper instead of duplicating `requests.get(..., stream=True)` and chunk-join loops.
- Updated `scripts/live_deploy_mvc2.sh` to deploy the new video helper and its focused unit test.
- Strengthened `scripts/check_route_contract.py` with `video_client_base_checks` so these clients cannot regress to duplicated streaming download code.
- Added `tests/test_video_client_base.py` to pin header/timeout/proxy forwarding and chunk concatenation behavior.

### Verification

- Local `pytest tests/test_video_client_base.py -q` passed.
- Local `py_compile` passed for the new helper, updated clients, and route contract script.
- Local `scripts/check_route_contract.py` passed with `video_client_base_checks=29`.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local `git diff --check` passed.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=29`.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Video Client Shared JSON Request Base

### Changes

- Extended `external_api/video/base.py` with `request_json()` to centralize synchronous video-provider JSON requests.
- Updated `external_api/video/seedance.py`, `sora2.py`, `veo.py`, and `wan2.py` task-query/content-query paths to use `request_json()` while preserving provider-specific URLs, headers, runtime proxy kwargs, and timeout behavior.
- Moved non-2xx response-body logging into the shared helper so provider query failures stay diagnosable.
- Extended `tests/test_video_client_base.py` to cover method normalization, params/header/timeout/proxy forwarding, `raise_for_status()`, and JSON return behavior.
- Strengthened `scripts/check_route_contract.py` so these synchronous video clients must use both shared JSON request and streaming download helpers.

### Verification

- Local `pytest tests/test_video_client_base.py -q` passed with 2 tests.
- Local `py_compile` passed for the helper, updated clients, and route contract script.
- Local `scripts/check_route_contract.py` passed with `video_client_base_checks=45`.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local `git diff --check` passed.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=45`.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Minimax Video Client Base Alignment

### Changes

- Updated `external_api/video/minimax.py` so Hailuo/MiniMax video task creation, task query, file retrieval, and final video download all use the shared `external_api.video.base` helpers.
- Kept Minimax-specific payload, model resolution, file-retrieve URL, and worker-facing return shapes unchanged.
- Updated `tests/test_api_provider_runtime_model_env.py` so Minimax runtime-model tests patch the shared request helper path instead of the old direct `requests.post` call.
- Extended `scripts/check_route_contract.py` so `MinimaxClient` is included in `video_client_base_checks`.

### Verification

- Local `pytest tests/test_video_client_base.py tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
- Local `py_compile` passed for `external_api/video/minimax.py`, the runtime-model tests, and the route contract script.
- Local `scripts/check_route_contract.py` passed with `video_client_base_checks=54`.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local `git diff --check` passed.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=54`.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Live Deploy Directory Sync + Video Create Requests

### Changes

- Verified `scripts/live_deploy_mvc2.sh` now syncs the whole `dao`, `services`, and `utils` directories instead of relying on an old partial service-file list.
- Confirmed the deploy script still avoids the red-zone `pipeline/`, `agent_routes.py`, and `workflows/*.json` paths.
- Updated `external_api/video/seedance.py`, `veo.py`, and `wan2.py` so pure JSON task-creation requests use shared `external_api.video.base.request_json()`.
- Left `external_api/video/sora2.py` direct POST handling in place for its multipart upload branch.
- Strengthened `scripts/check_route_contract.py` so JSON-only synchronous video clients cannot reintroduce direct `requests.*` calls.
- Updated `tests/test_api_provider_runtime_model_env.py` to patch the shared request path for Seedance, Veo, and Wan2.6 create-task tests.

### Verification

- Local `pytest tests/test_video_client_base.py tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
- Local `py_compile`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, and `git diff --check` passed.
- Local route contract passed with `video_client_base_checks=58`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=58`.
- Server sync check: local and remote SHA256 hashes match for `cluster_main.py`, `admin_routes.py`, and `scripts/live_deploy_mvc2.sh`.
- `dao/` recursive file count matches locally and remotely at 72 files; the top-level `ls dao | wc -l` count is 8 because DAO files are grouped under subdirectories.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 MiniMax Audio Runtime Request Consolidation

### Changes

- Added `_request_json()` and `_download_bytes()` inside `external_api/audio/minimax_audio.py` so MiniMax audio JSON calls and binary demo/TTS downloads share runtime endpoint, proxy, headers, and GroupId handling.
- Updated voice design, voice clone, voice list/delete, async TTS create/query, music generation, lyrics generation, file retrieve, and file delete to use the shared helpers.
- Kept `tts_sync` on its dedicated timeout/retry path and `file_upload` on its multipart form path.
- Updated `scripts/check_provider_contract.py` so provider runtime refresh checks understand shared helper refresh paths and still verify `_request_json()` calls `_url()` and `_download_bytes()` refreshes runtime config.
- Strengthened `scripts/check_route_contract.py` so the MiniMax audio client cannot drift back to scattered JSON request sessions.

### Verification

- Local `pytest tests/test_minimax_audio_runtime.py tests/test_audio_provider.py -q` passed with 15 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_audio_provider_runtime.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- First live deploy attempt hit a transient SCP connection reset during backend upload; rollback ran and `drama.service` stayed `active`.
- Retry live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=160`.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Sora2 JSON Create Request Consolidation

### Changes

- Updated `external_api/video/sora2.py` so text-to-video task creation uses shared `external_api.video.base.request_json()`.
- Kept the Sora2 image-to-video multipart upload branch on direct `requests.post()`, because it carries file upload semantics.
- Updated Sora2 runtime-model tests to patch the shared video request helper instead of the old direct `requests.post()` path.
- Strengthened `scripts/check_route_contract.py` so Sora2 must use the shared helper for JSON create requests and can keep only one direct `requests.post()` for multipart upload.

### Verification

- Local `pytest tests/test_video_client_base.py tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
- Local `py_compile`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `video_client_base_checks=60`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=60`.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 DashScope Video Runtime Request Consolidation

### Changes

- Added `_request_json()` in `external_api/video/dashscope.py` so DashScope task creation and query share aiohttp timeout, proxy, JSON parsing, and error handling.
- Kept per-call runtime config refresh in `create_task()` and `query_task()`, preserving hot provider endpoint/key/model behavior.
- Strengthened `scripts/check_route_contract.py` so DashScope create/query must continue routing through the shared async helper.
- Reconfirmed `scripts/live_deploy_mvc2.sh` already syncs directory-level `dao`, `services`, `utils`, `routers`, and `schemas` entries and has no `pipeline/` entry.

### Verification

- Local `pytest tests/test_dashscope_video_payload_extension.py -q` passed with 12 tests.
- Local `py_compile`, `scripts/check_route_contract.py`, `scripts/check_provider_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `api_provider_runtime_model_checks=164`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=164`.
- Server sync check: local and remote SHA256 hashes match for `cluster_main.py`, `admin_routes.py`, `scripts/live_deploy_mvc2.sh`, `external_api/video/dashscope.py`, and `scripts/check_route_contract.py`.
- Same-counter line check is `cluster_main.py=999`, `admin_routes.py=1502`; the older `846/1289` expectation is stale for this branch.
- `dao/` recursive file count matches locally and remotely at 72 files; top-level `ls dao | wc -l` remains 8 because DAO files are grouped under subdirectories.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Video Card Lazy Image Binding

### Changes

- Added `new_html/components/LazyImage.tsx`, mirroring the existing `LazyVideo` pattern for images: keep layout mounted, but do not bind `src` until the element is near the viewport.
- Updated `new_html/components/video/VideoCard.tsx` so storyboard preview images use `LazyImage` instead of eager `<img src={image.url}>`.
- Added `new_html/__tests__/components/LazyImage.test.tsx` to prove `src` remains unset before the intersection observer fires.
- Strengthened `scripts/check_route_contract.py` with `frontend_lazy_image_checks` so the shared card cannot drift back to eager image loading.

### Verification

- Local `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local TypeScript output has no `LazyImage` errors after the test cast fix; full `tsc --noEmit` still reports unrelated pre-existing project errors.
- Local frontend `vitest`/`vite build` is blocked by missing Windows Rollup optional package `@rollup/rollup-win32-x64-msvc` in `new_html/node_modules`; use remote Linux build during deploy for final frontend verification.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `frontend_lazy_image_checks=9`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `new_html/components/LazyImage.tsx` exists on `/home/Administrator/deploy`.

## 2026-06-22 AI Proxy JSON Request Consolidation

### Changes

- Added `_post_json_request()` and `_post_json_request_async()` in `services/ai_proxy_service.py` so provider JSON calls share POST, proxy kwargs, timeout, upstream-body logging, HTTP status, and JSON parse handling.
- Routed DeepSeek non-stream chat, Gemini text, Gemini image, and Doubao image generation through the shared helper while keeping provider-specific config resolution, model selection, expected status, and user-facing error messages at call sites.
- Left DeepSeek streaming and GPT Image multipart/generation paths unchanged for a later focused cut.
- Strengthened `scripts/check_route_contract.py` so these AI proxy JSON providers must keep using the shared helper and direct `requests.post` usage cannot creep upward.

### Verification

- Local `pytest tests/test_api_provider_runtime_model_env.py -q` passed with 27 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `api_provider_runtime_model_checks=171`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=171`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `_post_json_request()` is present and called by DeepSeek, Gemini text, Gemini image, and Doubao image paths.

## 2026-06-22 GPT Image Proxy Request Consolidation

### Changes

- Added shared response parsing and `_post_form_request()` / `_post_form_request_async()` in `services/ai_proxy_service.py` so GPT Image multipart edit requests use the same timeout, proxy kwargs, upstream logging, HTTP status, and JSON parse handling as JSON provider calls.
- Routed GPT Image generation through `_post_json_request_async()` and GPT Image edits through `_post_form_request_async()`, preserving tier/provider resolution, request model, endpoint/key lookup, and returned image parsing.
- Added runtime tests for GPT Image VIP generation and official edit paths in `tests/test_api_provider_runtime_model_env.py`.
- Strengthened `scripts/check_route_contract.py` so direct `requests.post` in AI proxy stays limited to JSON helper, form helper, and DeepSeek streaming.

### Verification

- Local `pytest tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `api_provider_runtime_model_checks=175`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=175`.
- Server sync check: `cluster_main.py=999` lines, `admin_routes.py=1502` lines, and `dao/` contains 72 recursive files; top-level `ls dao | wc -l` is 8 because DAO files are grouped under subdirectories.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 DeepSeek Stream Request Consolidation

### Changes

- Added `_post_stream_request()` and `_ensure_stream_response_ok()` in `services/ai_proxy_service.py` so DeepSeek streaming calls share request timeout, proxy kwargs, upstream logging, and connection-error handling with the rest of the AI proxy layer.
- Kept `stream_deepseek_chat()` focused on SSE parsing, reasoning/content event emission, response closing, and completion callbacks.
- Added `test_deepseek_stream_uses_shared_runtime_request` to prove streaming still resolves endpoint/key/model through provider runtime env and sends `stream=True`.
- Strengthened `scripts/check_route_contract.py` so AI proxy provider calls must keep JSON, form, and stream helpers.

### Verification

- Local `pytest tests/test_api_provider_runtime_model_env.py -q` passed with 30 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, and `scripts/smoke_test.py` passed.
- Local route contract passed with `api_provider_runtime_model_checks=178`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=178`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `_post_stream_request()` and the `DeepSeek stream` call label are present on `/home/Administrator/deploy/services/ai_proxy_service.py`.

## 2026-06-22 Video Reverse Gemini Request Delegation

### Changes

- Added `generate_gemini_chat_result()` in `services/ai_proxy_service.py` for OpenAI-compatible Gemini chat payloads that need shared runtime endpoint/key/model, proxy kwargs, timeout, upstream logging, and JSON parse handling.
- Updated `services/video_reverse_service.py` so frame analysis delegates Gemini vision/chat calls to `ai_proxy_service` instead of importing `requests` and posting directly.
- Kept video reverse visual analysis on `allow_failover=False`, because image-bearing prompts should not silently fail over to text-only DeepSeek.
- Updated provider/route contracts so video reverse must stay on delegated runtime wiring and cannot reintroduce direct `requests.post`.

### Verification

- Local `pytest tests/test_api_provider_runtime_model_env.py -q` passed with 30 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `api_provider_runtime_model_checks=180`.
- Local provider contract passed with `resolve_provider_references=24` and delegated video reverse runtime wiring.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=180`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `video_reverse_service.py` imports/calls `generate_gemini_chat_result()` and has no `requests.post` or `import requests`.

## 2026-06-22 GPT Image Result Download Delegation

### Changes

- Added `generated_image_content()` in `services/ai_proxy_service.py` so generated image data URLs and provider-hosted image URLs are decoded/downloaded through the AI proxy service layer.
- Remote generated-image URLs now pass `assert_public_http_url()` before download, keeping SSRF protection with the provider result save path.
- Updated `routers/ai_proxy.py` so GPT Image result saving delegates image bytes extraction to `ai_proxy_service` instead of importing `requests` in the route layer.
- Strengthened route contracts so `routers/ai_proxy.py` cannot reintroduce direct HTTP requests and must keep using `generated_image_content()`.

### Verification

- Local `pytest tests/test_api_provider_runtime_model_env.py -q` passed with 32 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `api_provider_runtime_model_checks=183`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=183`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `routers/ai_proxy.py` calls `generated_image_content()` and has no direct `requests` import/calls.

## 2026-06-22 Video Crop ComfyUI Fetch Delegation

### Changes

- Added `services/video_source_service.py` as the shared service boundary for fetching video bytes from ComfyUI `/view` endpoints.
- Updated `routers/video.py` so the crop route delegates ComfyUI fetches to `get_comfyui_view_response()` instead of importing `requests` directly in the route layer.
- Added focused tests in `tests/test_video_client_base.py` for ComfyUI view response forwarding and output/temp/input fallback byte selection.
- Strengthened route contracts so `routers/video.py` cannot reintroduce direct HTTP requests and the video source helper remains deployed.

### Verification

- Local `pytest tests/test_video_client_base.py -q` passed with 4 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `video_client_base_checks=65` and `service_mapper_purity_checks=607`.
- Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=65`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `routers/video.py` calls `get_comfyui_view_response()` and has no direct `requests` import/calls.

## 2026-06-22 ComfyUI File Route Transport Delegation

### Changes

- Added `services/comfyui_file_service.py` as the shared transport boundary for ComfyUI `/view` proxying and `/upload/image` multipart uploads.
- Updated `routers/comfyui_files.py` so preview proxy, image upload, video upload, audio upload, and video reupload delegate HTTP requests to the service layer instead of importing `requests` in the route layer.
- Added `tests/test_comfyui_file_service.py` to cover GET options forwarding, multipart upload payload forwarding, and wrapped request exceptions.
- Strengthened `scripts/check_route_contract.py` with `comfyui_file_service_checks=10`; `routers/comfyui_files.py` is now contract-protected from reintroducing direct HTTP requests.

### Verification

- Local `pytest tests/test_comfyui_file_service.py tests/test_video_client_base.py -q` passed with 7 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `comfyui_file_service_checks=10` and `service_mapper_purity_checks=627`.
- Live files synced to `https://mecha.one/`; `drama.service` was manually restarted after the frontend build step exceeded the local command timeout, then stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`, with `comfyui_file_service_checks=10`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `admin_routes.py=1502` lines, `cluster_main.py=999` lines, `dao/` has 72 recursive files, password fields use `min_length=8`, API env reload errors are logged, `env_refreshed` is returned, and `routers/comfyui_files.py` has no direct `requests` import/calls.

## 2026-06-22 Sora2 Multipart Video Request Consolidation

### Changes

- Added `request_multipart_json()` to `external_api/video/base.py` so multipart video provider requests share the same endpoint, proxy kwargs, HTTP status logging, and JSON response handling as the existing JSON helper.
- Updated `external_api/video/sora2.py` so image-to-video creation delegates multipart upload to `request_multipart_json()` instead of importing and calling `requests.post` directly.
- Added focused tests for multipart helper forwarding and Sora2 image-to-video runtime wiring in `tests/test_video_client_base.py` and `tests/test_api_provider_runtime_model_env.py`.
- Strengthened `scripts/check_route_contract.py` so Sora2 text-to-video must use `request_json()`, image-to-video must use `request_multipart_json()`, and Sora2 cannot reintroduce direct `requests` imports/calls.

### Verification

- Local `pytest tests/test_video_client_base.py tests/test_api_provider_runtime_model_env.py -q` passed with 38 tests.
- Local `py_compile`, `scripts/check_provider_contract.py`, `scripts/check_route_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local route contract passed with `video_client_base_checks=69`.
- Live files synced to `https://mecha.one/`; `drama.service` was manually restarted after `live_deploy_mvc2.sh` exceeded the local command timeout, then stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`, with `video_client_base_checks=69`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `external_api/video/sora2.py` has no direct `requests` import/calls and the route contract contains `request_multipart_json` checks.

## 2026-06-22 Deployment Frontend Build Skip

### Changes

- Updated `scripts/live_deploy_mvc2.sh` so backend/API-only deploys no longer rebuild the Vite frontend when `new_html` source is unchanged.
- Added `frontend_source_hash()` with normalized `sha256sum` output so Windows Git Bash and Linux produce the same `new_html` source fingerprint.
- Added remote marker support via `/home/Administrator/deploy/.new_html_source.sha256`; when the marker or remote source hash matches and `dist/` exists, the script prints `Skipping frontend build` and goes straight to service restart and contracts.
- Added `FORCE_FRONTEND_BUILD=1` for explicit frontend rebuilds, and kept the existing tar/upload/build path for real frontend changes.
- Added `tests/test_comfyui_file_service.py` to the deploy file list so the latest service-boundary tests are synced with the rest of the test set.
- Strengthened `scripts/check_route_contract.py` with deployment-script checks for hash skip, force rebuild, hash normalization, and the additional synced test.

### Verification

- Local `bash -n scripts/live_deploy_mvc2.sh`, `scripts/check_route_contract.py`, `scripts/check_provider_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local and remote normalized `new_html` hashes matched: `9db167248502ecc442d58544715c73d61de887e58fe83deb65191ac4130d9623`.
- One manual remote `npm run build` completed successfully with `2080 modules transformed`; the marker was then written.
- A real `live_deploy_mvc2.sh` run printed `Skipping frontend build: new_html source hash unchanged (...)`, restarted `drama.service`, and passed remote architecture contracts 10/10 with `live_deploy_frontend_checks=61`.
- Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 MiniMax Audio Request Helper Consolidation

### Changes

- Updated `external_api/audio/minimax_audio.py` so `tts_sync()` now reuses `_request_json()` with timeout, retry, proxy, group-id, and HTTP-body error handling instead of opening its own `aiohttp.ClientSession`.
- Added `_request_form_json()` and moved `file_upload()` multipart transport through that helper, leaving MiniMax audio with exactly three session boundaries: JSON requests, binary downloads, and form uploads.
- Strengthened `tests/test_minimax_tts_sync.py` to assert the shared helper still sends the expected `/t2a_v2` URL, payload, auth header, and 60 second timeout.
- Updated `scripts/check_route_contract.py` so MiniMax audio is contract-protected against reintroducing direct sessions outside the three helpers.
- Added `tests/test_minimax_tts_sync.py` to `scripts/live_deploy_mvc2.sh` sync coverage.

### Verification

- Local `pytest tests/test_minimax_tts_sync.py tests/test_minimax_audio_runtime.py -q` passed with 11 tests.
- Local `scripts/check_route_contract.py`, `scripts/check_provider_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, `bash -n scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
- Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` printed `Skipping frontend build`, restarted `drama.service`, and left it `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `cluster_main.py=999` lines, `admin_routes.py=1502` lines, `dao/` has 36 Python files, `tests/test_minimax_tts_sync.py` is present, and `external_api/audio/minimax_audio.py` contains exactly 3 `aiohttp.ClientSession` helper sites.

## 2026-06-22 Cluster Main Direct HTTP Guard

### Changes

- Removed the unused `requests` import from `cluster_main.py`, keeping the startup/composition entrypoint free of direct outbound HTTP transport.
- Strengthened `scripts/check_route_contract.py` so `cluster_main.py` now fails the route contract if `requests`, `aiohttp.ClientSession`, or `httpx` transport code is reintroduced.

### Verification

- Local `py_compile` for `cluster_main.py` and `scripts/check_route_contract.py` passed.
- Local `scripts/check_route_contract.py`, `scripts/check_provider_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` printed `Skipping frontend build`, restarted `drama.service`, and left it `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `cluster_main.py=998` lines, `admin_routes.py=1502` lines, and `grep requests ~/deploy/cluster_main.py` returned no matches.

## 2026-06-22 Episode Compose Service DAO Boundary

### Changes

- Split final episode composition out of the legacy root `compose_service.py` into `services/episode_compose_service.py`.
- Added `dao/creative/episode_compose.py` so video-take listing and final-cut `files` + `media_library_items` writes now live behind `EpisodeComposeDAO`.
- Kept `compose_service.py` as a 2-line compatibility shim for older imports while `routers/episode_video.py` now explicitly calls `services.episode_compose_service`.
- The final-cut file and media-library inserts now run inside one DAO-owned transaction.
- Added `tests/test_episode_compose_service.py` for take grouping, duplicate segment dedupe, selected-take handling, and latest-take fallback.
- Strengthened `scripts/check_route_contract.py` so episode compose routes cannot reintroduce legacy `compose_service` calls and the root shim cannot regain DB logic.
- Added `compose_service.py` and the new compose test to `scripts/live_deploy_mvc2.sh`.

### Verification

- Local `py_compile` for compose DAO/service/router/contract files passed.
- Local `pytest tests/test_episode_compose_service.py tests/test_video_client_base.py -q` passed with 7 tests.
- Local `scripts/check_route_contract.py`, `scripts/check_provider_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, `bash -n scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
- Local architecture contract reported `service_files=24`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=668`.
- Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` printed `Skipping frontend build`, restarted `drama.service`, and left it `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `compose_service.py=2` lines, `services/episode_compose_service.py=328` lines, `dao/creative/episode_compose.py=95` lines, and `tests/test_episode_compose_service.py` is present.

## 2026-06-22 Admin User Detail DAO Boundary

### Changes

- Moved the admin user detail lookup SQL out of `admin_routes.py` into `dao/user/user.py` as `UserDAO.admin_get_user_detail()`.
- Preserved the previous tolerant behavior: if the full admin-column query fails because a deployment schema is missing optional columns, the DAO falls back to the base `get_user_by_id()` result instead of breaking the admin page.
- Strengthened `tests/test_user_dao_admin_delete.py` with coverage for full admin-field lookup, base-user fallback, and DB-unavailable behavior.
- Strengthened `scripts/check_route_contract.py` so `admin_routes.py` must call `UserDAO.admin_get_user_detail()` and cannot reintroduce the user-detail `fetchrow` SQL block.

### Verification

- Local `pytest tests/test_user_dao_admin_delete.py tests/test_admin_stats_logs.py -q` passed with 7 tests.
- Local `scripts/check_provider_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, and `git diff --check` passed.
- Local architecture contract reported `service_files=24`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=673`.
- Live deploy to `https://mecha.one/` synced the DAO and admin route changes; `drama.service` stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `dao/user/user.py` contains `admin_get_user_detail()`, `admin_routes.py` calls it, and the old user-detail SQL snippets are absent from `admin_routes.py`.

## 2026-06-22 MiniMax Audio Import Boundary

### Changes

- Updated non-red-zone callers to import MiniMax audio runtime from `external_api/audio/minimax_audio.py` directly instead of the root `minimax_audio.py` compatibility shim.
- Kept the legacy shim available for `core/worker.py` and older imports; `core/worker.py` remains untouched because it is in the red-line list.
- Updated `tests/test_audio_provider.py` patch paths to target `external_api.audio.minimax_audio.get_minimax_audio_client`.
- Added route-contract checks so `api_routes.py` and `services/audio_provider.py` cannot reintroduce `from minimax_audio import get_minimax_audio_client`.
- Added `tests/test_audio_provider.py` to `scripts/live_deploy_mvc2.sh` so remote architecture contracts receive the test file they inspect.

### Verification

- Local `pytest tests/test_audio_provider.py tests/test_minimax_audio_runtime.py tests/test_minimax_tts_sync.py -q` passed with 19 tests.
- Local `scripts/check_audio_provider_runtime.py`, `scripts/check_route_contract.py`, `scripts/check_provider_contract.py`, `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, `bash -n scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
- Local route contract reported `api_provider_runtime_model_checks=188` and `live_deploy_frontend_checks=65`.
- Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` skipped the unchanged frontend build, restarted `drama.service`, and left it `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed `api_routes.py`, `services/audio_provider.py`, and `tests/test_audio_provider.py` reference `external_api.audio.minimax_audio`; only red-line `core/worker.py` still imports the legacy shim.

## 2026-06-22 API Config Canonical DAO Imports

### Changes

- Updated API management services to depend on canonical DAO package modules:
  - `services/api_config_service.py`
  - `services/api_config_runtime_loader.py`
  - `services/api_config_import_service.py`
  - `services/api_config_health_service.py`
- Kept top-level compatibility shims such as `dao_api_config.py` and `dao_system_settings.py` available for older callers, while the API management path now uses `dao.admin.*` directly.
- Updated `tests/test_dao_api_config_category.py` to patch `dao.admin.api_config.get_db_manager`, matching the real implementation module and avoiding accidental real DB connections in mock-only tests.
- Strengthened `scripts/check_provider_contract.py` with `api_config_dao_import_checks=20` so API config services cannot reintroduce `dao_api_config` or `dao_system_settings` shim imports.
- Added `tests/test_dao_api_config_category.py` to `scripts/live_deploy_mvc2.sh` and the deployment contract so server-side checks receive the test file.

### Verification

- Local API config contracts passed: runtime loader, CRUD, import, health, and provider contract.
- Local `pytest tests/test_admin_import_presets_writes_category.py tests/test_minimax_audio_runtime.py tests/test_dao_api_config_category.py -q` passed with 15 tests.
- Local `scripts/check_architecture_contracts.py`, `scripts/smoke_test.py`, `bash -n scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
- Local route contract reported `live_deploy_frontend_checks=66`.
- Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server sync check confirmed API config services import `dao.admin.api_config` / `dao.admin.system_settings`, and `tests/test_dao_api_config_category.py` is included in the live deploy file list.

## 2026-06-22 API Config Reload Service Boundary

### Changes

- Moved API config runtime reload orchestration and optional global provider-health cache clearing into `services/api_config_service.py`:
  - `reload_api_env_runtime()`
  - `clear_all_provider_health_cache()`
  - `ApiConfigReloadFailed`
- Kept `admin_api_config_routes.py` as the HTTP boundary: write endpoints and the manual reload endpoint now delegate to the service, preserve `env_refreshed` response fields, and map reload failures to HTTP 500 instead of silently reporting success.
- Strengthened `scripts/check_provider_contract.py` so `admin_api_config_routes.py` cannot reintroduce direct `load_api_configs_to_env`, provider registry, or provider-health cache implementation details.
- Strengthened `scripts/check_admin_api_config_crud.py` with dynamic success/failure checks for `reload_api_env_runtime(clear_health_cache=True)`.
- Updated `scripts/check_provider_health_monitor.py` to verify global provider-health clearing through the service helper instead of a route-private helper.

### Verification

- Local `py_compile` for API config route/service/contract files passed using `deploy/.venv`.
- Local API config CRUD, provider health monitor, provider contract, architecture contracts, and smoke test passed; smoke reported 9/9.
- Live deploy to `https://mecha.one/` synced the service-boundary changes, restarted `drama.service`, and left it `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server grep confirmed `admin_api_config_routes.py` now only references `reload_api_env_runtime`, while loader, registry, and provider-health cache internals live in `services/api_config_service.py` and contract scripts.

## 2026-06-22 API Config Write Reload Ownership

### Changes

- Removed the private `_reload_api_env()` callback from `admin_api_config_routes.py`.
- Made write services own their default runtime reload behavior:
  - `services/api_config_service.py` now uses `_reload_api_env_after_write()` for create/update/delete/repair when no test callback is injected.
  - `services/api_config_import_service.py` now uses `_reload_api_env_after_import()` for preset imports when no test callback is injected.
- Kept callback injection available at the service layer for pure contract tests, but the HTTP route no longer passes `reload_api_env=` into write services.
- Strengthened `scripts/check_provider_contract.py` so API config routes cannot reintroduce private reload callbacks or reload callback wiring.
- Strengthened `scripts/check_admin_api_config_crud.py` with a dynamic default-service-reload check.
- Updated `tests/test_admin_import_presets_writes_category.py` to patch the import-service reload helper instead of a route-private helper.

### Verification

- Local `py_compile` for API config route/service/import/contract files passed.
- Local API config CRUD/import/provider contracts passed; provider contract now reports `api_config_env_refresh_checks=20`.
- Local `pytest tests/test_admin_import_presets_writes_category.py tests/test_dao_api_config_category.py -q` passed with 8 tests.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local `scripts/smoke_test.py` passed 9/9.
- Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server grep confirmed `admin_api_config_routes.py` only keeps the manual `admin_reload_api_env()` endpoint; write reload helpers live in `services/api_config_service.py` and `services/api_config_import_service.py`.

## 2026-06-22 API Config Health Cache Service Boundary

### Changes

- Added `services/api_config_health_cache_service.py` as the single helper layer for provider-health cache invalidation caused by API config writes.
- Moved provider/model cache target derivation and global provider-health cache clearing out of `services/api_config_service.py`.
- Updated `services/api_config_import_service.py` to clear provider/model health cache targets through the shared helper instead of directly calling provider-health monitor delete functions.
- Strengthened contracts:
  - `scripts/check_provider_contract.py` now requires API config CRUD/import services to use `api_config_health_cache_service` and forbids direct bottom-level health-cache delete calls there.
  - `scripts/check_admin_api_config_import.py` now verifies import invalidates model-specific provider health targets.
  - `scripts/check_provider_health_monitor.py` now validates global cache clearing through the dedicated helper service.

### Verification

- Local `py_compile` for API config services and contracts passed.
- Local API config CRUD/import/provider/provider-health contracts passed; provider contract now reports `api_config_env_refresh_checks=28`.
- Local `pytest tests/test_admin_import_presets_writes_category.py tests/test_dao_api_config_category.py -q` passed with 8 tests.
- Local architecture contracts passed 10/10; `service_files=25`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=693`.
- Local smoke test passed 9/9.
- Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server grep confirmed bottom-level provider-health cache delete calls now live in `services/api_config_health_cache_service.py`, while CRUD/import services import only the helper.

## 2026-06-22 API Config Import Row Helper Cleanup

### Changes

- Updated `services/api_config_import_service.py` to use the shared `utils.config_helpers._config_get()` helper instead of maintaining a local `_row_get()` copy.
- Strengthened `scripts/check_provider_contract.py` so `api_config_import_service.py` must import the shared helper and cannot reintroduce local `_row_get()`.

### Verification

- Local `py_compile` for `services/api_config_import_service.py` and `scripts/check_provider_contract.py` passed.
- Local `scripts/check_admin_api_config_import.py` and `scripts/check_provider_contract.py` passed; provider contract now reports `api_config_env_refresh_checks=30`.
- Local `pytest tests/test_admin_import_presets_writes_category.py tests/test_dao_api_config_category.py -q` passed with 8 tests.
- Local architecture contracts passed 10/10.
- Local smoke test passed 9/9.
- Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server grep confirmed `services/api_config_import_service.py` imports `_config_get` and has no local `_row_get()` definition.

## 2026-06-22 API Config Service Row Helper Cleanup

### Changes

- Updated `services/api_config_service.py` row access helpers (`_row_provider`, `_row_model_name`, `_row_config_id`, `_row_enabled`, `_row_has_key`) to use the shared `utils.config_helpers._config_get()` helper.
- Strengthened `scripts/check_provider_contract.py` so those API config row helpers must use `_config_get`.

### Verification

- Local `py_compile` for `services/api_config_service.py` and `scripts/check_provider_contract.py` passed.
- Local `scripts/check_admin_api_config_crud.py` and `scripts/check_provider_contract.py` passed; provider contract now reports `api_config_env_refresh_checks=36`.
- Local `pytest tests/test_admin_import_presets_writes_category.py tests/test_dao_api_config_category.py -q` passed with 8 tests.
- Local architecture contracts passed 10/10.
- Local smoke test passed 9/9.
- Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
- Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
- Online smoke test against `https://mecha.one`: 9/9 passed.
- Server grep confirmed `api_config_service.py` imports `_config_get` and all `_row_*` helpers use it.

## 2026-06-22 API Config Reload Service Boundary

### Changes

- Added `services/api_config_reload_service.py` as the single service boundary for API config runtime reload orchestration.
- Moved `reload_api_env_runtime()`, `reload_api_env_after_config_change()`, `ReloadCallback`, and `ApiConfigReloadFailed` out of `services/api_config_service.py`.
- Updated API config CRUD, preset import, and admin manual reload routes to depend on the reload service instead of cross-importing CRUD service internals.
- Removed the lazy `from services.api_config_service import reload_api_env_runtime` import from `services/api_config_import_service.py`.
- Strengthened `scripts/check_provider_contract.py` so:
  - runtime loader access belongs to `api_config_reload_service.py`;
  - import service must not import CRUD service;
  - admin manual reload imports runtime reload from `api_config_reload_service.py`.

### Verification

- Local `py_compile` for admin API config route, reload service, CRUD service, import service, and contracts passed.
- Local API config CRUD/import/provider contracts passed; provider contract now reports `api_config_env_refresh_checks=39`.
- Local `pytest tests/test_admin_import_presets_writes_category.py tests/test_dao_api_config_category.py -q` passed with 8 tests.
- Local architecture contracts passed 10/10; `service_files=26`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=713`.
- Local smoke test passed 9/9.

## 2026-06-22 Admin API Config Status UX

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so saved-config test results from `POST /api/admin/api-configs/{id}/test` participate in the provider card's primary status.
- This prevents a provider from staying red/no-key after the DB config test proves runtime key fallback is usable.
- Renamed the old "advanced diagnostic" action to "test connectivity"; runtime provider checks remain available as "refresh effective health".
- Updated `scripts/check_route_contract.py` to enforce the merged API config health status path.

### Verification

- `scripts/check_route_contract.py` passed.
- `scripts/check_architecture_contracts.py` passed 10/10.
- `new_html` Vite production build passed using the bundled Node runtime.
- Local smoke test passed 9/9.

## 2026-06-22 Provider Credential Links

### Changes

- Added `docs_url`, `console_url`, and `key_help` metadata to `services/api_provider_registry.py` for every managed provider.
- Backend provider catalog now exposes credential acquisition links for DeepSeek, Google Gemini, Volcengine Ark/Seedance, Alibaba DashScope, MiniMax, and LaoZhang gateway providers.
- Updated `new_html/admin/AdminSettingsPage.tsx` to render provider credential links in the API config quick cards, detail cards, and editor modal.
- Updated provider and route contracts so credential metadata and the admin UI rendering path cannot silently regress.

### Verification

- `scripts/check_provider_contract.py` passed.
- `scripts/check_route_contract.py` passed.
- `scripts/check_architecture_contracts.py` passed 10/10.
- `new_html` Vite production build passed.
- Local smoke test passed 9/9.

## 2026-06-22 Gemini TTS Default Model Registry Cleanup

### Changes

- Added `GEMINI_TTS_DEFAULT_MODEL` to `services/api_provider_registry.py`.
- Updated the Gemini TTS preset, API config legacy-model upgrade target, and `GeminiAudioProvider` fallback model to read the same registry constant.
- Updated `scripts/check_provider_contract.py` so `audio_provider.py` and `api_config_runtime_loader.py` cannot reintroduce local Gemini TTS default-model literals.

### Verification

- Local `py_compile` for provider registry, runtime loader, audio provider, and provider contract passed.
- Local `scripts/check_provider_contract.py` passed; provider contract now reports `video_default_model_checks=74`.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local smoke test passed 9/9.

## 2026-06-22 API Config Audit Logging

### Changes

- Added best-effort audit logging to `admin_api_config_routes.py` for API config create, update, delete, preset import, runtime env reload, and conflict repair.
- Added audit summaries that record provider/model/endpoint metadata and reload status while redacting API keys, custom proxy values, header contents, and request-template values.
- Updated `scripts/check_route_contract.py` so API config audit hooks and sensitive-field redaction markers cannot silently regress.
- Updated `scripts/check_provider_contract.py` so manual reload responses may be validated through a constructed response object, not only a direct return dict.
- Added tests covering import route compatibility and audit redaction behavior.

### Verification

- Local `py_compile` for API config routes, route/provider contracts, and updated tests passed.
- Local `scripts/check_admin_api_config_crud.py`, `scripts/check_admin_api_config_import.py`, `scripts/check_provider_contract.py`, and `scripts/check_route_contract.py` passed.
- Local `pytest tests/test_admin_import_presets_writes_category.py -q` passed with 7 tests.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local smoke test passed 9/9.

## 2026-06-22 Provider Health URL Derivation

### Changes

- Removed the duplicate `PROVIDER_HEALTH_CHECK_URLS` table from `services/api_provider_registry.py`.
- API provider preset and catalog health-check URLs are now derived from each preset endpoint through `services.api_provider_endpoints.derive_models_health_urls()`.
- DashScope still derives the special compatible-mode `/models` URL from the video synthesis endpoint, so health checks keep the old behavior without maintaining a second URL source.
- Strengthened `scripts/check_provider_contract.py` so health URLs must be endpoint-derived and `PROVIDER_HEALTH_CHECK_URLS` cannot be reintroduced.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py` and `scripts/check_admin_api_config_health.py` passed.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local smoke test passed 9/9.

## 2026-06-22 Provider Default Endpoint Registry

### Changes

- Added `PROVIDER_DEFAULT_ENDPOINTS` to `services/api_provider_registry.py` as the single provider-level source for default upstream endpoints.
- Removed repeated `endpoint` literals from raw `API_MODEL_PRESETS`; `get_api_model_presets()` now enriches presets with `get_provider_default_endpoint(provider)`.
- External preset/catalog responses remain unchanged: all 17 enriched presets still include endpoint and endpoint-derived health-check URL.
- Strengthened `scripts/check_provider_contract.py` so:
  - every provider must have exactly one default endpoint;
  - raw presets cannot carry endpoint values;
  - enriched preset and catalog endpoints must match `PROVIDER_DEFAULT_ENDPOINTS`.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.
- Local `scripts/check_architecture_contracts.py` passed 10/10.
- Local smoke test passed 9/9.

## 2026-06-22 Provider Default Proxy Mode Registry

### Changes

- Removed repeated `proxy_mode` literals from raw `API_MODEL_PRESETS`.
- `get_api_model_presets()` now enriches each preset from `PROVIDER_CATALOG[provider].default_proxy_mode`, defaulting to `direct`.
- External preset/catalog responses remain unchanged: all 17 enriched presets still include `proxy_mode=direct`.
- Strengthened `scripts/check_provider_contract.py` so raw presets cannot carry `proxy_mode`, and enriched presets must match the provider catalog default.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py` passed.
- Local `scripts/check_admin_api_config_import.py` passed.

## 2026-06-22 Provider Default Category Registry

### Changes

- Added `get_provider_default_category()` to `services/api_provider_registry.py`.
- Removed repeated default `category` literals from raw `API_MODEL_PRESETS`; `get_api_model_presets()` now enriches each preset from `PROVIDER_CATALOG[provider].capabilities[0]`.
- Model-specific category overrides remain possible when a future preset genuinely differs from the provider default capability.
- External preset/catalog responses remain unchanged: all 17 enriched presets still include category values (`video=9`, `image=5`, `text=2`, `audio=1`).
- Strengthened `scripts/check_provider_contract.py` so raw presets cannot repeat provider default categories, and enriched presets must match the provider capability default or an explicit valid override.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Proxy Metadata Defaults

### Changes

- Added `DEFAULT_PROVIDER_PROXY_MODE` and `DEFAULT_PROVIDER_SUPPORTS_PROXY` to `services/api_provider_registry.py`.
- Removed repeated provider-level `default_proxy_mode=direct` and `supports_proxy=True` literals from all 12 `PROVIDER_CATALOG` entries.
- Provider metadata now applies those values through a single post-catalog `setdefault()` pass, so future providers only need explicit overrides when they differ from the default.
- External provider catalog and preset responses remain unchanged: 12 catalog entries still report `default_proxy_mode=direct` and `supports_proxy=True`; 17 enriched presets still report `proxy_mode=direct` and `supports_proxy=True`.
- Strengthened `scripts/check_provider_contract.py` so default proxy/supports metadata must be centralized and enriched presets must match provider metadata.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Health Check Metadata Defaults

### Changes

- Replaced the generated `PROVIDER_HEALTH_CHECKS` table in `services/api_provider_registry.py` with `DEFAULT_PROVIDER_HEALTH_CHECK` plus `PROVIDER_HEALTH_CHECK_OVERRIDES`.
- DashScope now only overrides the health-check path (`/compatible-mode/v1/models`); method and billable status inherit from the shared default.
- Provider metadata still exposes identical health-check results: 11 providers use `/models`, DashScope uses `/compatible-mode/v1/models`, all use `GET` and `billable=False`.
- Strengthened `scripts/check_provider_contract.py` so health-check metadata must be produced from the shared default plus explicit provider overrides.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_health.py`, and `scripts/check_admin_api_config_import.py` passed.

## 2026-06-22 Provider Required Env Single Source

### Changes

- Removed repeated `required_env` lists from all 12 `PROVIDER_CATALOG` entries in `services/api_provider_registry.py`.
- Provider metadata now derives `required_env` from `PROVIDER_ENV_MAP` during the same post-catalog initialization pass used for defaults.
- External provider catalog responses remain unchanged: every provider still exposes its primary API-key env in `required_env`.
- Strengthened `scripts/check_provider_contract.py` so provider catalog entries cannot repeat `required_env`, and initialized metadata must match `PROVIDER_ENV_MAP`.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Fallback Env Overrides

### Changes

- Added `DEFAULT_PROVIDER_FALLBACK_ENV` and `PROVIDER_FALLBACK_ENV_OVERRIDES` to `services/api_provider_registry.py`.
- Removed repeated `fallback_env` lists from all 12 `PROVIDER_CATALOG` entries.
- Provider metadata now derives fallback API-key borrowing from a default empty list plus explicit overrides (`seedance -> ARK_API_KEY`, `veo -> SORA2_API_KEY`).
- External provider catalog responses remain unchanged: 10 providers still have no fallback env, Seedance can borrow `ARK_API_KEY`, and Veo can borrow `SORA2_API_KEY`.
- Strengthened `scripts/check_provider_contract.py` so catalog entries cannot repeat `fallback_env`, and initialized metadata must match the override map.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Credential Link Defaults

### Changes

- Replaced provider-level `PROVIDER_CREDENTIAL_LINKS` in `services/api_provider_registry.py` with `VENDOR_CREDENTIAL_LINKS` plus `PROVIDER_KEY_HELP`.
- Docs and console URLs now derive from provider `vendor`, while provider-specific help text remains keyed by provider id.
- External provider catalog responses remain unchanged: every provider still exposes `docs_url`, `console_url`, and `key_help` for the admin API configuration UI.
- Strengthened `scripts/check_provider_contract.py` so docs/console links must come from vendor credential metadata and key help must come from provider-specific help text.

### Verification

- Local `py_compile` for provider registry and provider contract passed.
- Local `scripts/check_provider_contract.py` and `scripts/check_admin_api_config_import.py` passed.

## 2026-06-22 Provider API Operation Paths

### Changes

- Added `PROVIDER_API_PATHS` and `get_provider_api_path()` to `services/api_provider_registry.py`.
- Added `ResolvedProviderConfig.url_for_operation()` to `services/api_provider_runtime.py`.
- Updated `services/ai_proxy_service.py` so DeepSeek/Gemini text, Gemini image, and GPT Image calls resolve provider operation URLs through registry metadata instead of hardcoding path strings in business functions.
- External request URLs remain unchanged, including OpenAI-compatible `chat/completions`, Gemini `models/{model}:generateContent`, and GPT Image `images/generations` / `images/edits`.
- Strengthened `scripts/check_provider_contract.py` so AI proxy code must use `url_for_operation()` for registered provider paths.

### Verification

- Local `py_compile` for provider registry, runtime, AI proxy service, and provider contract passed.
- Local `scripts/check_provider_contract.py` and `scripts/check_ai_proxy_failover.py` passed.
- Local `pytest tests/test_api_provider_runtime_model_env.py -q` passed with 33 tests.

## 2026-06-22 External Video/Audio Operation Paths

### Changes

- Extended `PROVIDER_API_PATHS` for MiniMax, Sora2, Veo, and Seedance runtime operations.
- Updated MiniMax video, Sora2 video, Veo video, Seedance query, and MiniMax audio clients so provider API paths resolve through `ResolvedProviderConfig.url_for_operation()` instead of client-local `base_url + path` construction.
- MiniMax audio keeps the shared `_request_json()` / `_request_form_json()` helpers; those helpers now accept operation ids such as `voice_clone`, `tts_sync`, and `files_upload`.
- External request URLs remain unchanged, including MiniMax `/video_generation`, `/voice_clone`, `/t2a_v2`, Sora2 `/videos`, Veo `/chat/completions`, and Seedance task polling.
- Strengthened `scripts/check_provider_contract.py` and `scripts/check_route_contract.py` so these clients cannot regress to direct provider path construction.

### Verification

- Local `py_compile` for changed registry, client, and contract files passed.
- Local `scripts/check_provider_contract.py`, `scripts/check_audio_provider_runtime.py`, and `scripts/check_route_contract.py` passed.
- Local `scripts/check_architecture_contracts.py` passed with 10/10 contracts.
- Local `pytest tests/test_minimax_audio_runtime.py tests/test_minimax_tts_sync.py tests/test_api_provider_runtime_model_env.py -q` passed with 44 tests.

## 2026-06-22 Admin Provider Operation Path Visibility

### Changes

- Added `get_provider_operation_paths()` to `services/api_provider_registry.py`.
- Provider catalog and provider status now expose `operation_paths` derived from `PROVIDER_API_PATHS`.
- Updated `new_html/admin/AdminSettingsPage.tsx` so API provider/config cards show the registered operation paths used by runtime calls.
- Strengthened provider and route contracts so the admin API config UI and catalog must keep exposing these paths.

### Verification

- Local `py_compile` for changed Python files passed.
- Local `scripts/check_provider_contract.py` and `scripts/check_route_contract.py` passed.
- Local frontend production build passed via bundled Node/Vite.

## 2026-06-22 Admin Provider Operation URL Templates

### Changes

- Added `build_provider_operation_url_templates()` to `services/api_provider_registry.py`.
- Provider catalog now exposes `default_operation_url_templates` from each provider default endpoint plus registered operation paths.
- Runtime status now exposes `operation_urls` from the resolved endpoint, so admin can see the actual URL templates that will be used after DB/env overrides.
- Updated `new_html/admin/AdminSettingsPage.tsx` so API provider cards prefer runtime-resolved operation URLs and fall back to default templates/path metadata.
- Strengthened provider and route contracts so catalog/runtime/UI metadata cannot regress to path-only visibility.

### Verification

- Local `py_compile` for changed Python files passed.
- Local `scripts/check_provider_contract.py` and `scripts/check_route_contract.py` passed.
- Local frontend production build passed via bundled Node/Vite.

## 2026-06-23 Admin API Health Status Clarity

### Changes

- Updated `new_html/admin/AdminSettingsPage.tsx` so DB config tests no longer mark the main provider card red when a runtime key is available; the primary status now reflects the effective runtime config.
- Renamed ambiguous card actions from generic connection testing to `测试 DB 配置` and `测试生效配置`.
- Renamed card status labels to `生效配置状态` and result blocks to `DB 配置测试` so DB-row validation and real generation runtime health are visibly separate.
- Strengthened `scripts/check_route_contract.py` so the UI cannot regress to the ambiguous `测试连通性` wording or let DB no-key/error override runtime status when an effective key exists.

### Verification

- Local `py_compile` for route contract passed.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local frontend production build passed via bundled Node/Vite.

## 2026-06-23 Frontend Provider Key Documentation Cleanup

### Changes

- Replaced stale AI Studio frontend key instructions in `new_html/.env.example`, `new_html/README.md`, and `new_html/GEMINI_API_CONFIG.md`.
- Frontend docs now state that third-party provider keys must be configured server-side through `/admin/settings?item=apiconfig`, not through Vite env vars or browser localStorage.
- Gemini docs now describe the backend provider ids (`gemini-text`, `gemini-image`, `gemini-tts`), runtime key names, and backend proxy call path without exposing browser-side key setup.
- Strengthened `scripts/check_route_contract.py` so frontend docs cannot reintroduce `VITE_GEMINI_*_API_KEY`, browser Gemini key storage, or direct LaoZhang Gemini model endpoint instructions.

### Verification

- Local `py_compile` for route contract passed.
- Local `scripts/check_route_contract.py` passed.
- Local frontend production build passed via bundled Node/Vite.

## 2026-06-23 Deploy Frontend Build Hash Cleanup

### Changes

- Updated `scripts/live_deploy_mvc2.sh` so frontend Markdown docs are synced as ordinary deploy files instead of forcing a full `new_html` source tar/build.
- Changed the frontend build hash marker to `.new_html_build_source.sha256` and excluded `new_html/*.md` from the build-source hash.
- Added `new_html/.env.example`, `new_html/README.md`, and `new_html/GEMINI_API_CONFIG.md` to the deploy file list so docs still reach the server when needed.
- Strengthened `scripts/check_route_contract.py` so the deploy script must keep doc sync, the build hash marker, and Markdown exclusion.

### Verification

- Local `bash -n scripts/live_deploy_mvc2.sh` passed.
- Local `py_compile` for route contract passed.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- A temporary `new_html/*.md` probe did not change the frontend build hash.

## 2026-06-23 Frontend Direct Fetch Guardrail

### Changes

- Audited production frontend code for direct `fetch()` calls; only `new_html/services/httpClient.ts` still uses the browser primitive.
- Strengthened `scripts/check_route_contract.py` so production `.ts/.tsx` files must route HTTP through `services/httpClient.ts`.
- The guard excludes tests, Vite config, and the shared `httpClient` implementation itself.

### Verification

- Local `py_compile` for route contract passed.
- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=12864`.
- Local `rg "\bfetch\(" new_html` confirmed only `services/httpClient.ts` has direct fetch calls outside excluded folders.

## 2026-06-23 Video Capability Service Boundary

### Changes

- Moved `/api/video/capabilities` business checks from `routers/video_capabilities.py` into `services/video_capability_service.py`.
- The router now only owns the HTTP route and delegates Seedance runtime model and ComfyUI agent availability checks to the service layer.
- Added `tests/test_video_capability_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so this route cannot regress to direct `AgentDAO` or Seedance runtime calls in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_video_capability_service.py -q` passed with 2 tests.
- Local `scripts/check_route_contract.py` passed.

## 2026-06-23 Prompt Service Boundary

### Changes

- Moved `/api/prompts/{template_type}` business logic from `routers/prompts.py` into `services/prompt_service.py`.
- Replaced the mojibake bundled rewrite/storyboard prompts with readable Chinese defaults while preserving `{text}` and `{scriptText}` placeholders.
- Added `tests/test_prompt_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so prompt routes cannot regress to direct `PromptTemplateDAO` calls or route-local default prompts.

### Verification

- Local `py_compile` for changed prompt route/service/contract/test files passed.
- Local `pytest tests/test_prompt_service.py -q` passed with 5 tests.
- Local `scripts/check_route_contract.py` passed.

## 2026-06-23 Episode Video Service Boundary

### Changes

- Moved episode video segment and composition business logic from `routers/episode_video.py` into `services/episode_video_service.py`.
- The router still owns the 7 HTTP endpoints, but now delegates segment list/create/update/delete, video takes, compose start, and compose status to the service layer.
- Added `tests/test_episode_video_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so episode video routes cannot regress to direct `VideoSegmentDAO`, `EpisodeDAO`, or compose-service calls in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_episode_video_service.py -q` passed with 6 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Asset Service Boundary

### Changes

- Moved project asset list/create/update/delete/share logic from `routers/assets.py` into `services/asset_service.py`.
- The router still owns the 5 asset HTTP endpoints, but now delegates asset DAO orchestration and linked entity-file copy handling to the service layer.
- Added `tests/test_asset_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so asset routes cannot regress to direct `AssetDAO` or `EntityFileDAO` orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_asset_service.py -q` passed with 7 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Script Timeline Service Boundary

### Changes

- Moved script segment, multi-script, and timeline track business logic from `routers/script_timeline.py` into `services/script_timeline_service.py`.
- The router still owns the 12 script/timeline HTTP endpoints, but now delegates `EpisodeScriptSegmentDAO`, `EpisodeScriptDAO`, and `TimelineDAO` orchestration to the service layer.
- Added `tests/test_script_timeline_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so script/timeline routes cannot regress to direct DAO orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_script_timeline_service.py -q` passed with 9 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Canvas Service Boundary

### Changes

- Moved canvas board, node, and connection business logic from `routers/canvas.py` into `services/canvas_service.py`.
- The router still owns the 10 canvas HTTP endpoints, but now delegates project permission checks and canvas DAO orchestration to the service layer.
- Added `tests/test_canvas_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so canvas routes cannot regress to direct permission checks or canvas DAO orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_canvas_service.py -q` passed with 9 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Entity File Service Boundary

### Changes

- Moved user file listing, entity file linking/selection, upload media sync, deletion, batch deletion, and migration orchestration from `routers/entity_files.py` into `services/entity_file_service.py`.
- The router still owns the 9 entity-file HTTP endpoints, but now delegates `FileDAO`, `EntityFileDAO`, media-library sync, and migration orchestration to the service layer.
- Added `tests/test_entity_file_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so entity-file routes cannot regress to direct DAO/media/migration orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_entity_file_service.py -q` passed with 9 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Content Version Service Boundary

### Changes

- Moved version and text-content business logic from `routers/content_versions.py` into `services/content_version_service.py`.
- The router still owns the 6 version/text HTTP endpoints, but now delegates project ownership checks, parent-version resolution, version restore/delete, text creation/read, and activity logging to the service layer.
- Added `tests/test_content_version_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so content version routes cannot regress to direct DAO or activity-log orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_content_version_service.py -q` passed with 8 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Episode Service Boundary

### Changes

- Moved episode list/create/read/update/delete/duplicate/reorder business logic from `routers/episodes.py` into `services/episode_service.py`.
- The router still owns the 7 episode HTTP endpoints, but now delegates episode numbering, default names, duplication metadata parsing, script copy orchestration, and reorder updates to the service layer.
- Added `tests/test_episode_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so episode routes cannot regress to direct `EpisodeDAO` or `EpisodeScriptDAO` orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_episode_service.py -q` passed with 8 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Storyboard Service Boundary

### Changes

- Moved storyboard list/create/update/delete/delete-all/export/reorder/mix-audio/batch/extract-to-assets business logic from `routers/storyboard.py` into `services/storyboard_service.py`.
- The router still owns the 10 storyboard HTTP endpoints, but now delegates stale script fallback, bounded field-set reads, bound asset normalization, script export transaction calls, audio mix orchestration, and asset extraction dedupe to the service layer.
- Added `tests/test_storyboard_service.py` and kept `tests/test_storyboard_stale_script_fallback.py` green with the new service boundary.
- Included `tests/test_storyboard_service.py` in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so storyboard routes cannot regress to direct `StoryboardDAO`, `EpisodeScriptDAO`, `AssetDAO`, or `EpisodeDAO` orchestration in the router while preserving the paged/lazy storyboard loading contracts.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_storyboard_service.py tests/test_storyboard_stale_script_fallback.py -q` passed with 14 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Project Core Service Boundary

### Changes

- Moved DAO-backed project create/list/detail business logic from `routers/project_core.py` into `services/project_core_service.py`.
- The router still owns the 3 core project HTTP endpoints, but now delegates initial version creation, owner membership creation, activity logging, organization-scoped list authorization, project access checks, last-access update, and detail aggregation to the service layer.
- Removed the route-local dynamic `dao_organization` import by injecting `OrganizationMemberDAO` through `api_routes.py`.
- Added `tests/test_project_core_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so project core routes cannot regress to direct `ProjectDAO`, `VersionDAO`, `ProjectMemberDAO`, `UserDAO`, `ActivityLogDAO`, or `OrganizationMemberDAO` orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_project_core_service.py -q` passed with 7 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Project Admin Service Boundary

### Changes

- Moved project settings, archive/unarchive, and membership management business logic from `routers/project_admin.py` into `services/project_admin_service.py`.
- The router still owns the 7 project admin HTTP endpoints, but now delegates admin/readonly permission checks, metadata updates, project archive state changes, member listing/add/update/remove, target-user validation, and owner removal protection to the service layer.
- Added `tests/test_project_admin_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so project admin routes cannot regress to direct `ProjectDAO`, `ProjectMemberDAO`, or `UserDAO` orchestration in the router.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_project_admin_service.py -q` passed with 7 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Task Notification Service Boundary

### Changes

- Moved task recovery, terminal task notification formatting, task-file access checks, and persisted notification CRUD from `routers/task_notifications.py` into `services/task_notification_service.py`.
- The router still owns the 9 task/notification HTTP endpoints, but now delegates task ownership checks, active/recent task reads, terminal task `task_data` normalization, unread-count/history reads, mark-read/read-all, and dismiss operations to the service layer.
- Injected `NotificationDAO` through `api_routes.py` so the router no longer imports notification persistence directly.
- Added `tests/test_task_notification_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so task notification routes cannot regress to direct `TaskDAO`/`NotificationDAO` orchestration or route-local `task_data` parsing.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_task_notification_service.py -q` passed with 5 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 User Session Service Boundary

### Changes

- Moved current-user session and organization self-service business logic from `routers/user_session.py` into `services/user_session_service.py`.
- The router still owns the 4 HTTP endpoints, but now delegates logout state cleanup, user-info timestamp formatting, organization list serialization, organization membership checks, owner-leave protection, and member removal to the service layer.
- Injected `OrganizationDAO` and `OrganizationMemberDAO` through `cluster_main.py` so the router no longer imports organization persistence directly.
- Added `tests/test_user_session_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so user session routes cannot regress to direct organization DAO calls, route-local serialization, or route-local time formatting.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_user_session_service.py -q` passed with 6 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Admin Compatibility Service Boundary

### Changes

- Moved legacy admin compatibility stats/logs/user-create/user-delete business logic from `routers/admin_compat.py` into `services/admin_compat_service.py`.
- The router still owns the 4 compatibility HTTP endpoints, but now delegates admin permission checks, `group_by` validation, stats/log DAO reads, password length validation, legacy in-memory user map updates, DB user sync, audit recording, and delete guards to the service layer.
- Injected `AdminStatsDAO`, `UserDAO`, and `admin_audit_service.record` through `cluster_main.py` so the router no longer imports admin reporting or user persistence directly.
- Added `tests/test_admin_compat_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so admin compatibility routes cannot regress to direct `AdminStatsDAO`/`UserDAO` calls, route-local password checks, route-local legacy user map mutation, or route-local audit recording.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_admin_compat_service.py tests/test_admin_stats_logs.py tests/test_user_dao_admin_delete.py -q` passed with 15 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Legacy File Service Boundary

### Changes

- Moved legacy version-scoped file upload/download/delete business logic from `routers/legacy_files.py` into `services/legacy_file_service.py`.
- The router still owns the 3 legacy HTTP endpoints, but now delegates version ownership checks, storage quota checks, file type/storage path generation, hash and duplicate handling, file record creation, download path fallback, range parsing, delete authorization, and activity logging to the service layer.
- Added `tests/test_legacy_file_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so legacy file routes cannot regress to direct DAO/storage/optimization/deduplication orchestration.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_legacy_file_service.py -q` passed with 6 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Generic File Route Service Boundary

### Changes

- Moved generic `/api/upload` and `/api/thumbnail` business logic from `routers/files.py` into `services/file_route_service.py`.
- The router still owns the 2 HTTP endpoints and auth/HTTP response wrapping, but now delegates thumbnail source resolution, cache key generation, thumbnail rendering, cache cleanup, upload type detection, default project/version creation, file storage, DB file record creation, and DB-failure rollback to the service layer.
- Added `tests/test_file_route_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so generic file routes cannot regress to direct `FileDAO`/`ProjectDAO`/`VersionDAO`, PIL, storage path, hashing, or upload persistence orchestration.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_file_route_service.py -q` passed with 6 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Video Crop Service Boundary

### Changes

- Moved `/api/video/crop` source resolution, FFmpeg execution, cropped-file storage, default project/version resolution, and DB file record creation from `routers/video.py` into `services/video_crop_service.py`.
- The router still owns the single crop HTTP endpoint and HTTP error mapping, but now delegates DB/local/ComfyUI source lookup, persistent-storage fallback paths, ComfyUI node selection, temp-file cleanup, FFmpeg command execution, output validation, and cropped file persistence to the service layer.
- Added `tests/test_video_crop_service.py` and included it in `scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `scripts/check_route_contract.py` so video crop routes cannot regress to direct ComfyUI fetches, FFmpeg/subprocess/tempfile orchestration, DAO method calls, or route-local storage writes.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_video_crop_service.py tests/test_video_client_base.py -q` passed with 12 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 ComfyUI Upload Record Service Boundary

### Changes

- Moved ComfyUI image/video upload DB persistence from `routers/comfyui_files.py` into `services/comfyui_file_service.py`.
- The router still owns HTTP upload handling, node selection, local file writes, and ComfyUI forwarding, but now delegates default project/version creation, `FileDAO.create_file`, download URL construction, and Redis filename mapping to `create_comfyui_upload_record()`.
- Extended `tests/test_comfyui_file_service.py` to cover default project/version creation, existing-version reuse, DB file URL behavior, and Redis mapping preservation.
- Strengthened `scripts/check_route_contract.py` so ComfyUI file routes cannot regress to direct upload persistence DAO calls.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_comfyui_file_service.py -q` passed with 5 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `be7aef9`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Video Reupload Service Boundary

### Changes

- Moved `/api/comfyui/reupload/video` source resolution and reupload workflow from `routers/comfyui_files.py` into `services/comfyui_file_service.py`.
- The router still owns auth, target ComfyUI node selection, and HTTP error mapping, but now delegates persistent-storage path resolution, ComfyUI fallback downloads, UUID reupload filename generation, upload failure handling, and response shaping to `reupload_comfyui_video_with_uuid()`.
- Extended `tests/test_comfyui_file_service.py` to cover storage-hit reupload, ComfyUI fallback reupload, missing source errors, and upload failure errors.
- Strengthened `scripts/check_route_contract.py` so the reupload route cannot regress to route-local storage path parsing, ComfyUI fallback loops, or `_reuploaded` filename generation.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_comfyui_file_service.py -q` passed with 9 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `c83992c`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh` sync/restart, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Audio Upload Service Boundary

### Changes

- Moved `/api/upload/audio` ComfyUI upload workflow from `routers/comfyui_files.py` into `services/comfyui_file_service.py`.
- The router still owns auth, request body reading, target video-node selection, and HTTP error mapping, but now delegates UUID upload filename generation, ComfyUI upload calls, response filename parsing, best-effort local audio backup, upload rejection handling, and response shaping to `upload_audio_file_to_comfyui()`.
- Extended `tests/test_comfyui_file_service.py` to cover audio upload success, backup persistence, ComfyUI filename parsing, and rejected-upload errors.
- Strengthened `scripts/check_route_contract.py` so the audio upload route cannot regress to route-local ComfyUI upload calls, response JSON parsing, or audio backup writes.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_comfyui_file_service.py -q` passed with 11 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `3e74fbf`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI View Fallback Service Boundary

### Changes

- Moved `/api/proxy/comfyui/view` fallback-fetch behavior from `routers/comfyui_files.py` into `services/comfyui_file_service.py`.
- The router still owns auth, target node selection, and `StreamingResponse` construction, but now delegates ComfyUI `/view` params, 404 fallback ordering, non-OK response handling, and status-bearing view errors to `fetch_comfyui_view_with_fallback()`.
- Extended `tests/test_comfyui_file_service.py` to cover output->temp fallback and status-preserving fetch failures.
- Strengthened `scripts/check_route_contract.py` so the proxy route cannot regress to route-local fallback lists, status-code 404 loops, or direct `fetch_comfyui_view_response()` calls.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_comfyui_file_service.py -q` passed with 13 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `04038a4`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Video Upload Service Boundary

### Changes

- Moved `/api/comfyui/upload/video` ComfyUI upload, local video persistence, and DB file record creation from `routers/comfyui_files.py` into `services/comfyui_file_service.py`.
- The router still owns auth, upload body reading, target video-node selection, and HTTP error mapping, but now delegates UUID filename generation, ComfyUI upload calls, response filename parsing, local video storage, `create_comfyui_upload_record()`, and response shaping to `upload_video_file_to_comfyui()`.
- Extended `tests/test_comfyui_file_service.py` to cover video upload success, local save, DB record creation, and rejected-upload errors.
- Strengthened `scripts/check_route_contract.py` so the video upload route cannot regress to route-local ComfyUI upload calls, response JSON parsing, local video writes, or DB record creation.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_comfyui_file_service.py -q` passed with 15 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `3874959`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Image Upload Service Boundary

### Changes

- Moved `/api/comfyui/upload` image upload persistence, optional ComfyUI forwarding, DB file record creation, Redis filename mapping, and response shaping from `routers/comfyui_files.py` into `services/comfyui_file_service.py`.
- The router still owns auth, empty-file validation, target ComfyUI node selection, and HTTP error mapping, but now delegates UUID filename generation, local image storage, ComfyUI upload calls, response filename parsing, `create_comfyui_upload_record()`, Redis mapping, and response shaping to `upload_image_file_to_comfyui()`.
- Extended `tests/test_comfyui_file_service.py` to cover image upload success, local save, DB record creation, Redis mapping, and nonfatal ComfyUI forwarding failures.
- Strengthened `scripts/check_route_contract.py` so the image upload route cannot regress to route-local ComfyUI upload calls, response JSON parsing, local image writes, UUID generation, timestamp generation, or DB record creation.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_comfyui_file_service.py -q` passed with 17 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `3bcb7b0`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh` sync/restart, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.
- Note: local deployment wrapper hit the 300s command timeout after the server restart; manual server checks confirmed synced files, active service, remote contracts, and online smoke success.

## 2026-06-23 Project Image Persistence Service Boundary

### Changes

- Moved project-embedded base64 image persistence and export-to-video storyboard image persistence from `routers/projects.py` into `services/project_image_service.py`.
- The legacy project router still owns project JSON traversal, selected storyboard-image choice, access checks, and project stage updates, but now delegates base64 decoding, local image storage, WebP conversion, default project/version fallback, `FileDAO.create_file()`, and image file URL shaping to the service layer.
- Added `tests/test_project_image_service.py` to cover embedded project image persistence, default project/version creation, existing-version reuse with raw fallback, and export storyboard image persistence.
- Strengthened `scripts/check_route_contract.py` so `routers/projects.py` cannot regress to route-local base64 decoding, UUID/timestamp generation, `persistent_storage/images` writes, WebP conversion, or direct `FileDAO.create_file()` calls.
- Added the new project image service test to `scripts/live_deploy_mvc2.sh` so server sync includes it.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_project_image_service.py tests/test_project_read_access.py -q` passed with 7 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `59cd115`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Project Read Service Boundary

### Changes

- Moved legacy project detail read shaping and per-shot image loading from `routers/projects.py` into `services/project_read_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates project read permission checks, JSON settings parsing, thumbnail-only generated-image thinning, shot image URL backfill, and project access timestamp updates to the service layer.
- Added `tests/test_project_read_service.py` to cover thumbnail-mode payload thinning, full-mode URL preservation, member/visitor access behavior, shot image URL backfill, and missing/empty image cases.
- Strengthened `scripts/check_route_contract.py` so project detail and shot-image routes cannot regress to route-local JSON parsing, thumbnail shaping, URL backfill, permission helper definitions, or `ProjectDAO.update_project_access()` calls.
- Added the new project read service test to `scripts/live_deploy_mvc2.sh` so server sync includes it.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_project_read_service.py tests/test_project_read_access.py -q` passed with 9 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `4d2a571`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Project Video Task Service Boundary

### Changes

- Moved `/api/projects/{project_id}/export-to-video` and `/api/projects/{project_id}/clear-video-tasks` workflow from `routers/projects.py` into `services/project_video_task_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates owner validation, export version resolution/creation, project settings parsing, selected/first image resolution, base64 image persistence fallback, `video_tasks` construction, stage update, and project save to the service layer.
- Added `tests/test_project_video_task_service.py` to cover selected-image export, base64 persistence with version creation, persistence failure fallback, clearing existing tasks, and missing/forbidden project errors.
- Strengthened `scripts/check_route_contract.py` so export/clear routes cannot regress to route-local version creation, JSON parsing, selected-image selection, base64 persistence, `video_tasks` mutation, or `ProjectDAO.save_or_update_project()`.
- Added the new project video task service test to `scripts/live_deploy_mvc2.sh` so server sync includes it.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_project_video_task_service.py tests/test_project_read_access.py -q` passed with 9 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `4b3a08e`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Project Save Service Boundary

### Changes

- Moved `/api/projects/save` workflow from `routers/projects.py` into `services/project_save_service.py`.
- The router still owns route registration, auth dependency, and HTTP error mapping, but now delegates timestamp/user stamping, existing project data loading, `video_tasks` and `generated_images` preservation, generated-image URL recovery, nested Base64 image persistence, and `ProjectDAO.save_or_update_project()` to the service layer.
- Rewrote `routers/projects.py` as a thin ASCII route module, removing the legacy route-local Base64 conversion helper and preserving the existing 7 project route registrations.
- Added `tests/test_project_save_service.py` to cover existing collection preservation, generated-image URL recovery, nested Base64 conversion across project payload sections, and persistence failure fallback.
- Strengthened `scripts/check_route_contract.py` so `/api/projects/save` cannot regress to route-local JSON parsing, timestamping, old-data recovery, Base64 persistence, or direct project DAO save calls.
- Added the new project save service test to `scripts/live_deploy_mvc2.sh` so server sync includes it.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_project_save_service.py tests/test_project_image_service.py tests/test_project_read_access.py -q` passed with 10 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `fb2296f`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Audio Generation Persistence Service Boundary

### Changes

- Moved generated-audio file registration and media-library sync tail work from `routers/audio.py` into `services/audio_generation_service.py`.
- The affected routes still own provider selection and HTTP error mapping, but now delegate local `audio_url` basename resolution, generated audio file reads, `save_generated_file_to_db()` calls, `file_id`/`file_url` response enrichment, and best-effort media-library indexing to `attach_local_generated_audio_file()`.
- Updated `/api/audio/generate-speech`, `/api/audio/generate-sfx`, `/api/audio/generate-music`, and `/api/minimax/music` to use the shared service. `/api/minimax/tts/sync` remains route-local for now because it also performs character voice sample URL write-back.
- Added `tests/test_audio_generation_service.py` to cover local file save/media sync, basename-only URL handling, missing local files, save failure fallback, and media-library failure fallback.
- Strengthened `scripts/check_route_contract.py` so these generated-audio routes cannot regress to route-local `AUDIO_UPLOAD_DIR` path assembly, local byte reads, or direct `media_library_service.create_from_file()` calls.
- Added the new audio generation service test to `scripts/live_deploy_mvc2.sh` so server sync includes it.

### Verification

- Local `py_compile` for changed route/service/contract/test files passed.
- Local `pytest tests/test_audio_generation_service.py tests/test_audio_provider.py tests/test_minimax_audio_runtime.py -q` passed with 18 tests.
- Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
- Local `scripts/smoke_test.py` passed 9/9.
- Commit `7bacc11`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.
