# Agent.md - 本地部署记录

## 2026-07-10 Doubao SeedDream Agent Plan

- Added pay-as-you-go and Agent Plan access modes to the Doubao image provider card.
- Agent Plan normalizes the endpoint to `/api/plan/v3/images/generations` and always submits `doubao-seedream-5.0-lite`.
- Existing pay-as-you-go SeedDream models remain unchanged; admin tests and production generation share the same endpoint-aware model resolver.

## 2026-07-10 Seedance Plan Guard And Stale Tasks

- Confirmed historical successful `seedance_i2v` tasks used Seedance 1.0 Pro on the standard pay-as-you-go endpoint, not Seedance 2.0.
- Agent Plan now maps both Seedance Standard and Fast operations to the supported `doubao-seedance-1.5-pro` model; pay-as-you-go keeps Seedance 2.0.
- Pay-as-you-go retries once with `doubao-seedance-1.5-pro` only when Seedance 2.0 or 2.0 Fast returns a model-availability error.
- Unsupported channel/model responses are converted to the existing non-retryable `ModelNotOpen` error.
- Active tasks stuck for one hour are now marked failed; four existing stale server tasks were cleaned.

## 2026-07-10 Endpoint-Aware Provider Links

- Admin provider console, API documentation, and key-help links now follow the effective endpoint hostname instead of the static model vendor.
- LaoZhang-backed Gemini cards now open LaoZhang resources rather than Google AI Studio.

## 2026-07-10 Storyboard Timeline Audio Actions

- The storyboard combined timeline now exposes BGM and sound-effect upload/AI-generation actions matching the dubbing timeline.
- Existing episode audio tracks are rendered and played through the same shared data source.
- Added `TimelineTrack.actions.test.tsx` coverage for the four new controls.

## 2026-07-10 Minimum-Cost Real Generation Tests

- Admin image verification now uses explicit minimum-cost payloads: one SeedDream 1024x1024 image, Gemini 3.1 at 512, and one GPT Image 1024x1024 low-quality image.
- Gemini TTS verification uses the short phrase `OK.`.
- Admin video verification remains non-billable/unsupported until provider-specific minimum task contracts are implemented.

## 2026-07-10 Doubao Provider Health Semantics

- Added the missing Doubao image-generation API path metadata.
- Changed lightweight Doubao health checks to `connectivity_ok`; only a successful real-generation test can establish green ready status.
- Added admin health contract coverage for both behaviors.
- Provider-level health checks now follow the runtime-effective model, preventing a disabled legacy preset from being probed instead.

## 2026-07-10 Preserve Verified Provider Health

- Updated the API provider admin UI so DB connectivity tests cannot downgrade a successful real-generation verification.
- Connectivity-only DB tests now render as a warning that Key and Endpoint are reachable, not as a configuration error.
- Added frontend regression coverage in `deploy/new_html/__tests__/utils/apiConfigTestState.test.ts`.

## 2026-07-10 DeepSeek Real Generation Verification

- Fixed `deploy/services/api_config_health_service.py` so DeepSeek Reasoner real-generation tests accept `reasoning_content` and allow enough output tokens for reasoning plus a final answer.
- Added `deploy/tests/test_api_config_health_service.py` regression coverage for the response parser and request payload.

## 2026-06-29 API Health Connectivity Semantics

- Fixed a misleading admin API health result for gateway providers such as laozhang: a successful lightweight metadata request now reports `connectivity_ok` instead of green `ok` when real generation was not executed.
- Added structured `test.status` to `/api/admin/api-configs/{id}/test` results and kept provider runtime health aligned with the same `connectivity_ok` state.
- Added saved-config diagnostics for `config_enabled`, `is_runtime_effective`, and the currently effective DB config id/name so the admin UI can explain "DB test passed but real calls do not use this row."
- Updated the new admin API settings panel and legacy admin panel so DB config tests, runtime health refreshes, and batch summaries show these cases as yellow "reachable, generation not verified" instead of success or hard error.
- Added contract coverage for laozhang metadata-only success on both saved-config health and runtime provider health.
- Deployment note: Hong Kong to mainland-China providers can remain slow even when connectivity is valid. Use the existing provider-level `proxy_mode=custom` / `custom_proxy` or global system proxy to route selected providers through a mainland VPS; do not hard-code proxy behavior in generation handlers.

## 2026-06-29 Enhance Preview Lazy Video

- Updated `deploy/new_html/pages/EnhancePage.tsx` to render the main video preview with `LazyVideo` instead of binding the video `src` immediately.
- Kept hover auto-preview disabled for the main preview so the page's existing play/edit behavior is unchanged while offscreen metadata requests are avoided.
- Local verification passed: targeted LazyVideo Vitest `3/3`, Vite production build, and `git diff --check`.

## 2026-06-29 LazyVideo Source Rebind

- Updated `deploy/new_html/components/LazyVideo.tsx` so videos that have already entered the viewport keep their source bound when `src` changes, matching the existing `LazyImage` behavior.
- This avoids a blank/unloaded frame when generated video URLs, signed media URLs, or restored task results refresh after the card is already visible.
- Added `deploy/new_html/__tests__/components/LazyVideo.test.tsx` to cover deferred binding, first-frame fragments, and in-view source replacement.
- Local verification passed: targeted LazyImage/LazyVideo Vitest `5/5`, Vite production build, and `git diff --check`.

## 2026-06-23 Demo Stabilization Wrap-up

- Updated Gemini TTS API health semantics so admin health can distinguish `blocked_region` and `connectivity_ok` from hard failures.
- Updated legacy and new admin API settings UI to display those two warning states instead of showing everything as a generic red error.
- Cached Gemini TTS generation failures into provider health so region-blocked generation errors become visible in API management.
- Updated provider contract scanning to ignore `.codex_backups` backup directories, preventing server-side backups from failing deployment contracts.
- Local verification passed: architecture contracts `10/10`, `py_compile`, and `git diff --check`.

## 2026-06-23 Provider Endpoint Single Source Contract

- Moved Gemini TTS runtime-loader endpoint upgrade logic to read the default endpoint from `deploy/services/api_provider_registry.py` instead of duplicating the Google endpoint literal.
- Updated API config health checks to decide Gemini TTS `x-goog-api-key` headers from the registered provider endpoint, keeping provider domains centralized in the registry.
- Preserved Gemini TTS health URL derivation for old `/openai` endpoints through `deploy/services/api_provider_endpoints.py`.
- Local verification passed: architecture contracts `10/10`, targeted provider/audio pytest `47/47`, admin health contract, audio runtime contract, `py_compile`, and `git diff --check`.

## 2026-06-23 Video Task Import Boundary

- Added `deploy/new_html/utils/videoTaskImport.ts` to convert exported `project.video_tasks` into video workspace images, task groups, prompts, and skipped-item diagnostics in one pure function.
- Updated `deploy/new_html/components/VideoPage.tsx` so initial session loading owns the first `video_tasks` check, while the active-page effect only checks after the initial load completes. This avoids duplicate first-entry requests and duplicate import work.
- Replaced the two duplicated in-component conversion blocks with `buildVideoTaskImport()` and kept clearing `project.video_tasks` whenever the backend returned pending tasks, including all-skipped invalid queues.
- Added `deploy/new_html/__tests__/utils/videoTaskImport.test.ts` for successful conversion and missing-image skip behavior.
- Local verification passed: targeted Vitest `7/7`, Vite production build, and `git diff --check`.

## 2026-06-23 AI Proxy Router Provider Imports

- Updated `deploy/routers/ai_proxy.py` to import DeepSeek, Gemini text, Gemini image, GPT Image, and Doubao provider calls directly from their dedicated provider service modules.
- Stopped routing provider calls in the AI proxy router through the `deploy/services/ai_proxy_service.py` compatibility aggregation layer.
- Kept `deploy/services/ai_proxy_service.py` available as a compatibility re-export layer for existing tests and remaining legacy callers.
- Strengthened `deploy/scripts/check_route_contract.py` so AI proxy routes must import provider calls from dedicated services and cannot reintroduce `from services.ai_proxy_service import (...)`.
- Local verification passed: `py_compile`, targeted image content/reference/provider runtime pytest `47/47`, provider contract, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, online smoke passed `9/9`, and the server router shows direct provider imports.

## 2026-06-23 AI Proxy Doubao Image Provider Service Boundary

- Added `deploy/services/ai_proxy_doubao_image_service.py` for Doubao image payload construction, runtime provider resolution, HTTP generation calls, and response parsing.
- Moved `build_doubao_image_payload()`, `parse_doubao_image_response()`, `_post_doubao_image_generation()`, and `generate_doubao_images()` out of `deploy/services/ai_proxy_service.py`.
- Kept the same public Doubao image entrypoints re-exported from `deploy/services/ai_proxy_service.py` for existing routers and tests.
- Updated route/provider contracts so `resolve_provider("doubao")` ownership lives in the new service and cannot drift back into the provider aggregation file.
- Local verification passed: `py_compile`, targeted image content/reference/provider runtime pytest `47/47`, provider contract, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy GPT Image Provider Service Boundary

- Added `deploy/services/ai_proxy_gpt_image_service.py` for GPT Image tier resolution, key/endpoint validation, multipart edit calls, generation calls, and result shaping.
- Added `deploy/services/ai_proxy_openai_image_service.py` for shared OpenAI-compatible image response parsing used by GPT Image and Doubao.
- Moved `resolve_gpt_image_tier_config()`, `normalize_gpt_image_tier()`, GPT Image payload builders, `_post_gpt_image_edit_request()`, `_post_gpt_image_generation_request()`, and `generate_gpt_images()` out of `deploy/services/ai_proxy_service.py`.
- Kept the same public GPT Image and OpenAI-compatible parser entrypoints re-exported from `deploy/services/ai_proxy_service.py` for existing routers and tests.
- Updated route/provider contracts so GPT Image dynamic tier provider resolution and OpenAI image parsing ownership cannot drift back into the provider aggregation file.
- Local verification passed: `py_compile`, targeted image content/reference/provider runtime pytest `47/47`, provider contract, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy Gemini Image Provider Service Boundary

- Added `deploy/services/ai_proxy_gemini_image_service.py` for Gemini image payload construction, runtime provider resolution, HTTP generation calls, and inline image response parsing.
- Moved `build_gemini_image_payload()`, `parse_gemini_image_response()`, `_post_gemini_image_generation()`, and `generate_gemini_images()` out of `deploy/services/ai_proxy_service.py`.
- Kept the same public Gemini image entrypoints re-exported from `deploy/services/ai_proxy_service.py` for existing routers and tests.
- Updated route/provider contracts so `resolve_provider("gemini-image")` ownership lives in the new service and cannot drift back into the provider aggregation file.
- Local verification passed: `py_compile`, targeted image content/reference/provider runtime pytest `47/47`, provider contract, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy Gemini Text Provider Boundary

- Added `deploy/services/ai_proxy_gemini_text_service.py` for Gemini text generation, Gemini chat generation, failover-aware runtime resolution, and text result shaping.
- Moved `generate_gemini_text_result()`, `generate_gemini_chat_result()`, and `generate_gemini_text()` out of `deploy/services/ai_proxy_service.py`.
- Kept the same public Gemini text entrypoints available from `deploy/services/ai_proxy_service.py` for existing routers, `video_reverse_service.py`, and tests.
- Updated provider/runtime contracts so `resolve_provider("gemini-text")` ownership lives in the new service and cannot drift back into the provider aggregation file.
- Local verification passed: `py_compile`, provider runtime pytest `39/39`, targeted image content/reference/provider runtime pytest `47/47`, route contract, provider contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy DeepSeek Provider Boundary

- Added `deploy/services/ai_proxy_deepseek_service.py` for DeepSeek configuration resolution, non-streaming text generation, SSE payload building, and streaming response parsing.
- Moved `DEEPSEEK_SYSTEM_PROMPT`, `ensure_deepseek_configured()`, `build_deepseek_payload()`, `generate_deepseek_text()`, and `stream_deepseek_chat()` out of `deploy/services/ai_proxy_service.py`.
- Kept the same public DeepSeek entrypoints available from `deploy/services/ai_proxy_service.py` for existing routers and tests.
- Updated provider/runtime contracts so DeepSeek `resolve_provider("deepseek")` ownership lives in the new service and cannot drift back into the provider aggregation file.
- Local verification passed: `py_compile`, provider runtime pytest `39/39`, targeted image content/reference/provider runtime pytest `47/47`, route contract, provider contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy Chat Completion Boundary

- Added `deploy/services/ai_proxy_chat_service.py` for OpenAI-compatible chat payload construction, provider failover resolution, and text completion result shaping.
- Moved `provider_health_scope_for_failover()`, `resolve_ai_proxy_provider()`, `build_chat_payload()`, `_post_chat_completion_result_sync()`, and `_post_chat_completion_result()` out of `deploy/services/ai_proxy_service.py`.
- Updated the AI proxy failover contract to patch health checks through `services.ai_proxy_chat_service` while preserving `ai_proxy_service.py` public entrypoints.
- Strengthened `deploy/scripts/check_route_contract.py` so chat completion/failover helpers cannot drift back into the provider service.
- Local verification passed: `py_compile`, provider runtime pytest `39/39`, targeted image content/reference/provider runtime pytest `47/47`, failover contract, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy HTTP Client Boundary

- Added `deploy/services/ai_proxy_http_client.py` for shared AI proxy JSON, form, and streaming HTTP request handling.
- Moved direct `requests.post` usage and upstream response normalization out of `deploy/services/ai_proxy_service.py`.
- Updated AI proxy provider tests and the failover contract to patch the HTTP client boundary instead of `ai_proxy_service.requests`.
- Strengthened `deploy/scripts/check_route_contract.py` so provider logic cannot reintroduce direct `requests.post` or local request helper definitions.
- Local verification passed: `py_compile`, targeted image content/reference/provider runtime pytest `47/47`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy Shared Types Boundary

- Added `deploy/services/ai_proxy_types.py` for shared AI proxy exceptions and lightweight result/reference dataclasses.
- Moved `AIProxyError`, `AIProxyConfigError`, `AIProxyUpstreamError`, `GptImageReferenceInput`, and `TextGenerationResult` out of `deploy/services/ai_proxy_service.py`.
- Updated `cluster_main.py`, AI proxy/generation routers, image content service, reference service, and provider tests to import shared types from `services.ai_proxy_types`.
- Strengthened `deploy/scripts/check_route_contract.py` so non-provider code cannot import shared AI proxy types from the provider service.
- Local verification passed: `py_compile`, targeted image content/reference/provider runtime pytest `47/47`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy Generated Image Content Boundary

- Added `deploy/services/ai_proxy_image_content_service.py` to own generated image content loading from data URLs and provider-hosted public URLs.
- Updated `deploy/services/ai_proxy_image_persistence_service.py` to use the new content loader service instead of importing from `ai_proxy_service.py`.
- Removed generated image content decoding/downloading, `base64`, and public URL guard imports from `deploy/services/ai_proxy_service.py`.
- Added `deploy/tests/test_ai_proxy_image_content_service.py` for data URL decoding and public URL download behavior.
- Strengthened `deploy/scripts/check_route_contract.py` so provider service cannot reintroduce generated image content loading.
- Local verification passed: `py_compile`, targeted image content/persistence/provider runtime pytest `44/44`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 Doubao Image Provider Boundary

- Refactored `deploy/services/ai_proxy_service.py` so `generate_doubao_images()` delegates provider HTTP handling to `_post_doubao_image_generation()`.
- Added `parse_doubao_image_response()` to centralize Doubao image response extraction while preserving `b64_json` and URL handling.
- Strengthened `deploy/tests/test_api_provider_runtime_model_env.py` with Doubao parser coverage for base64 images, URL images, and empty responses.
- Strengthened `deploy/scripts/check_route_contract.py` so `generate_doubao_images()` cannot reintroduce direct HTTP calls or response parsing.
- Local verification passed: `py_compile`, targeted provider runtime pytest `41/41`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 GPT Image Provider Boundary

- Refactored `deploy/services/ai_proxy_service.py` so `generate_gpt_images()` delegates edit and generation provider requests to `_post_gpt_image_edit_request()` and `_post_gpt_image_generation_request()`.
- Added `_ensure_gpt_image_config()` and `_gpt_image_upstream_detail()` so GPT Image key/endpoint validation and upstream error shaping are centralized.
- Strengthened `deploy/tests/test_api_provider_runtime_model_env.py` with OpenAI image response parser coverage for `b64_json`, URL images, and empty image responses.
- Strengthened `deploy/scripts/check_route_contract.py` so `generate_gpt_images()` cannot reintroduce direct HTTP, endpoint, or multipart handling.
- Local verification passed: `py_compile`, targeted provider runtime pytest `39/39`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 Gemini Image Provider Boundary

- Refactored `deploy/services/ai_proxy_service.py` so `generate_gemini_images()` delegates provider HTTP handling to `_post_gemini_image_generation()`.
- Added `parse_gemini_image_response()` to centralize Gemini inline image extraction from `candidates[].content.parts[].inlineData`.
- Strengthened `deploy/tests/test_api_provider_runtime_model_env.py` with parser coverage for inline images and empty image responses.
- Strengthened `deploy/scripts/check_route_contract.py` so `generate_gemini_images()` cannot reintroduce direct `_post_json_request_async()` calls or inlineData parsing.
- Local verification passed: `py_compile`, targeted provider runtime pytest `37/37`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 DeepSeek Shared Chat Completion Helper

- Refactored `deploy/services/ai_proxy_service.py` so non-streaming DeepSeek text generation uses `_post_chat_completion_result_sync()`.
- The sync helper now owns OpenAI-compatible chat-completions payload construction, endpoint resolution, request handling, response parsing, empty-content handling, and `TextGenerationResult` shaping.
- `ensure_deepseek_configured()` and streaming DeepSeek URL resolution now share `_resolve_deepseek_config()`, removing duplicated key/endpoint validation.
- Strengthened `deploy/tests/test_api_provider_runtime_model_env.py` for DeepSeek message payloads, `stream=false`, runtime model selection, and JSON response format preservation.
- Strengthened `deploy/scripts/check_route_contract.py` so `generate_deepseek_text()` cannot reintroduce direct `_post_json_request()` handling.
- Local verification passed: `py_compile`, targeted provider runtime pytest `35/35`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy Shared Chat Completion Helper

- Refactored `deploy/services/ai_proxy_service.py` so Gemini text generation and Gemini chat generation share `_post_chat_completion_result()`.
- The helper centralizes OpenAI-compatible chat completion URL resolution, runtime key/endpoint usage, request error handling, response parsing, and `TextGenerationResult` shaping.
- Added runtime-provider tests in `deploy/tests/test_api_provider_runtime_model_env.py` for both Gemini text and chat paths, covering runtime endpoint/model selection and payload shape.
- Strengthened `deploy/scripts/check_route_contract.py` so these entrypoints cannot reintroduce duplicated `_post_json_request_async()` handling.
- Local verification passed: `py_compile`, targeted provider runtime pytest `35/35`, route contract, architecture contracts `10/10`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 API Config Health Test Helper

- Refactored `deploy/services/api_config_service.py` so single-config and batch API config health tests share `_test_api_config_row_health()`.
- The shared helper now owns runtime resolution, DB key decryption, runtime key fallback, endpoint source diagnostics, and test annotation.
- Strengthened `deploy/scripts/check_admin_api_config_crud.py` so future changes cannot re-duplicate key/runtime/endpoint test shaping in separate entrypoints.
- Local verification passed: `py_compile`, `check_admin_api_config_crud.py`, architecture contracts, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 Admin API Runtime Endpoint Display

- Updated the admin API configuration UI so runtime cards prefer the actual `runtime.endpoint` over the saved DB endpoint.
- When the saved DB endpoint differs from the runtime endpoint, the card now shows a separate `DB Endpoint` line instead of silently presenting the DB value as the live runtime value.
- Strengthened `deploy/scripts/check_route_contract.py` to keep this display contract from regressing.
- Local verification passed: `py_compile`, route contract, architecture contracts, `git diff --check`, and local smoke `9/9`.
- Local frontend build could not run because this Windows environment has no `npm` on PATH and bundled `pnpm` blocks `esbuild` build scripts; live deploy used the server Node/npm build path successfully.
- Deployed to `https://mecha.one/`; remote Vite build completed, `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-23 AI Proxy Reference Preparation Boundary

- Added `deploy/services/ai_proxy_reference_service.py` to own reference-image preparation for AI proxy calls.
- `deploy/routers/ai_proxy.py` now delegates Gemini image parts, GPT Image multipart references, and Doubao reference inputs to the service layer.
- Added `deploy/tests/test_ai_proxy_reference_service.py` for data URL references, `/storage/` references, invalid reference skipping, prompt enhancement, and Doubao conversion.
- Strengthened `deploy/scripts/check_route_contract.py` so the AI proxy router cannot grow direct `base64`, `read_bytes()`, `storage_path_safe()`, or `GptImageReferenceInput` handling again.
- Local verification passed: `py_compile`, targeted AI proxy/provider pytest `47/47`, route contract, architecture contracts, `bash -n scripts/live_deploy_mvc2.sh`, `git diff --check`, and local smoke `9/9`.
- Deployed to `https://mecha.one/`; `drama.service` stayed `active`, remote architecture contracts passed `10/10`, and online smoke passed `9/9`.

## 2026-06-21 Video Provider Default Model Registry Move

- MiniMax, Sora2, Veo, and Wan2.6 video default model names now live in `deploy/services/api_provider_registry.py`.
- Video clients keep their historical `DEFAULT_*` constants only as compatibility aliases backed by registry constants.
- MiniMax audio runtime resolution also uses the registry MiniMax default model as its provider preset anchor.
- Legacy Sora2/Veo model upgrade constants in `deploy/services/api_config_runtime_loader.py` now reuse registry constants.
- Added provider-contract coverage so these default video model literals cannot drift back into external API clients.
- Deployed to `https://mecha.one/`; remote Vite build completed, `drama.service` stayed active, remote architecture contracts passed 10/10, and online smoke passed 9/9.

## 2026-06-21 Live Deploy Remote Validation

- `deploy/scripts/live_deploy_mvc2.sh` now runs remote architecture contracts after `drama.service` is confirmed active.
- The same script now syncs the full `services` and `utils` directories, plus the full `dao` directory, so new service/DAO/helper files are not missed on server deploys.
- Remote contract failure triggers the existing rollback path for `cluster_main.py` and frontend `dist`.
- The script can also run remote smoke tests through `RUN_REMOTE_SMOKE=1`; it reads `ADMIN_PASSWORD` from the remote environment and skips with a clear message if that variable is absent.
- No API keys, passwords, or secrets are hardcoded in the deployment script.
- `deploy/scripts/check_route_contract.py` now guards these deploy-script validation hooks.
- Deployed to `https://mecha.one/`; remote Vite build completed, `drama.service` stayed active, remote architecture contracts passed 10/10, and online smoke passed 9/9.
- Verified local and remote SHA-256 match for `cluster_main.py`, `admin_routes.py`, and `scripts/live_deploy_mvc2.sh`; remote `dao/` contains 36 Python files.

更新时间：2026-06-07  
工作目录：`D:\Codex\Drama`  
应用代码目录：`D:\Codex\Drama\deploy`

## 2026-06-21 API Provider 架构守卫记录

- Provider endpoint 单一来源补强：
  - 第三方 provider 域名（laozhang、DeepSeek、Gemini、火山 Ark、DashScope、MiniMax）只允许集中出现在 `deploy/services/api_provider_registry.py`。
  - `deploy/scripts/check_route_contract.py` 新增 `provider_endpoint_single_source_checks`，阻止 runtime 客户端、路由或服务重新硬编码外部 API 域名。
- 清理了 `deploy/external_api/video/dashscope.py` 与 `deploy/services/video_reverse_service.py` 中过期的 provider endpoint/key 文档描述。
- 这个变更不改变运行时行为，用于支持后续把第三方 API 切换成自建 API 时只改注册表/后台配置。

## 2026-06-21 视频预加载性能记录

- 视频工作流和相关页面的默认视频预览不再依赖浏览器默认 preload 行为：
  - 高密度视频列表/卡片的 `LazyVideo` 改为 `preload="none"`。
  - 视频预览区、美化时间轴预览区使用 `preload="none"`，点击播放时再加载。
  - 弹窗/画布里的用户主动打开视频预览显式使用 `preload="metadata"`。
- `deploy/scripts/check_route_contract.py` 新增 `check_frontend_video_preload_contract`：
  - 所有裸 `<video>` 必须显式声明 `preload`。
  - 高密度视频列表必须保留 `preload="none"`。
- 验证：`py_compile`、`check_route_contract.py` 和 `check_architecture_contracts.py` 均通过，新增 `frontend_video_preload_checks=13`。
- 已部署到 `https://mecha.one/`：
  - 服务器远端 Vite build 通过，`drama.service` 为 `active`。
  - 服务器 `scripts/check_architecture_contracts.py` 10/10 通过，包含 `frontend_video_preload_checks=13`。
  - 线上 smoke test 9/9 通过。

## 2026-06-21 API 配置诊断增强记录

- 后台 API 配置的“高级诊断”返回值补充 Endpoint 来源信息：
  - `key_source/key_env/used_runtime_key` 继续说明 Key 来自 DB、运行时或缺失。
  - 新增 `endpoint_source/used_runtime_endpoint/runtime_endpoint/runtime_endpoint_source/runtime_endpoint_env/endpoint_matches_runtime`。
  - 当 DB 配置测试借用了运行时 Key，但 DB endpoint 与实际 runtime endpoint 不一致时，前端会明确显示“与运行时 Endpoint 不一致”。
- `deploy/new_html/admin/AdminSettingsPage.tsx` 已在单配置卡片和 provider 快速卡片中显示该差异，减少“DB 配置测试异常，但刷新生效健康正常”的排查成本。
- `deploy/scripts/check_admin_api_config_crud.py` 增加 `health_wrapper_endpoint_diagnostics` 契约，防止诊断字段回退。
- 已部署到 `https://mecha.one/`：
  - 服务器远端 Vite build 通过，`drama.service` 为 `active`。
  - 服务器 `scripts/check_architecture_contracts.py` 10/10 通过。
  - 线上 smoke test 9/9 通过。

## 2026-06-21 Service/DAO 分层守卫记录

- 新增 `deploy/scripts/check_service_dao_boundary.py`：
  - 禁止 `deploy/services/` 直接 import `asyncpg`、数据库连接模块或 `get_db_manager()`。
  - 禁止 service 层直接调用 `execute/fetch/fetchrow/fetchval` 等原始 DB 方法。
  - 禁止 service 层出现原始 SQL 字符串，数据库持久化需要下沉到 DAO。
- 已接入 `deploy/scripts/check_architecture_contracts.py`，后续架构契约会自动检查这条边界。
- 当前扫描结果：`deploy/services/` 未发现直接 SQL 或直接连接池访问；本轮不改变运行时行为。

## 2026-06-21 架构守卫记录

- 前端网络请求边界补强：
  - `deploy/scripts/check_route_contract.py` 继续禁止业务文件直接 `fetch()`，只能通过 `deploy/new_html/services/httpClient.ts`。
  - 新增 `XMLHttpRequest` 边界：只允许 `deploy/new_html/services/videoMediaService.ts` 因上传进度事件使用 XHR。
  - 允许的 XHR 上传路径必须继续复用 `buildAuthHeaders()` 和 `handleUnauthorized()`。
- 该变更不改变运行时行为，用于防止后续开发把认证、错误处理和请求逻辑重新散落到页面/业务服务里。

## 2026-06-21 本轮性能/部署记录

- 分镜工作流的小图加载改为使用后端缓存缩略图：`/api/thumbnail`。
- 涉及文件：
  - `deploy/new_html/services/imageLoaderService.ts`
  - `deploy/new_html/components/GenerationPage.tsx`
  - `deploy/new_html/pages/StoryboardGenPage.tsx`
  - `deploy/scripts/check_route_contract.py`
  - `deploy/Agent.md`
- 影响范围：
  - 分镜左侧镜头卡片缩略图。
  - 当前镜头生成结果网格的小图。
  - 底部图音联合时间轴预览图。
- 原图 URL 不写回数据库，仍用于高清预览、选图和导出，缩略图只在渲染阶段派生。
- 验证：
  - `git diff --check` 通过。
  - `python -m py_compile deploy/scripts/check_route_contract.py` 通过。
  - `deploy/scripts/check_route_contract.py` 通过，包含 `frontend_thumbnail_checks=7`。
  - Windows 本地 Vite 构建仍受 Rollup 可选依赖 `@rollup/rollup-win32-x64-msvc` 缺失影响，服务器 Linux 构建仍作为前端上线验证准则。
  - `deploy/scripts/live_deploy_mvc2.sh` 已部署成功，远端 Vite 构建通过，`drama.service` 为 `active`。
  - 服务器 `check_route_contract.py`、`check_architecture_contracts.py` 和线上 smoke test 均通过。
  - 线上缩略图探测：目标剧集分镜图片经 `/api/thumbnail` 返回 `200 image/jpeg`，`144x96` 缩略图约 `3401` 字节。

## 当前本地部署状态

本地部署已跑通，访问地址：

```text
http://localhost:6006/projects
```

基础账号：

```text
admin / admin123
```

当前运行组件：

| 组件 | 本地形态 | 状态 |
| --- | --- | --- |
| PostgreSQL | Docker 容器 `drama-postgres`，端口 `5432` | 已启动 |
| Redis | Docker 容器 `drama-redis`，端口 `6379` | 已启动 |
| FastAPI 后端 | `deploy/.venv` + `uvicorn cluster_main:app`，端口 `6006` | 已启动 |
| React 前端 | `deploy/new_html` 构建到 `deploy/dist`，由后端托管 | 已构建并可访问 |

## 部署相关新增文件

以下文件是为了让本地部署可重复执行而新增：

| 文件 | 说明 |
| --- | --- |
| `deploy/local_start.ps1` | 本地启动脚本：启动/复用 PostgreSQL、Redis，准备 Python 虚拟环境，按需构建前端并启动后端 |
| `deploy/local_verify.ps1` | 本地验证脚本：检查健康接口、登录、项目列表和浏览器渲染 |
| `deploy/local_stop.ps1` | 本地停止脚本：停止 `6006` 后端进程；加 `-StopInfra` 可停止数据库和 Redis 容器 |
| `deploy/scripts/verify_local_browser.mjs` | Edge 无头浏览器验证脚本：登录后打开项目页、确认页面文本、生成截图 |
| `Agent.md` | 本文件，记录部署缺失项、补齐项和验证结论 |

运行脚本时如遇到 Windows 脚本执行策略限制，使用：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\local_start.ps1
powershell.exe -ExecutionPolicy Bypass -File .\local_verify.ps1
```

## 部署相关生成目录和产物

以下目录/文件是本地部署过程中生成或刷新出来的运行产物：

| 路径 | 说明 |
| --- | --- |
| `deploy/.venv` | 后端 Python 虚拟环境 |
| `deploy/new_html/node_modules` | 前端依赖目录，由 Docker `node:20-alpine` 执行 `npm ci` 生成 |
| `deploy/dist` | 前端生产构建目录，已从 `deploy/new_html` 重新构建 |
| `deploy/dist/assets/index-DAEewdMq.js` | 当前前端主 bundle |
| `deploy/dist/assets/utils-CeXEL_Kc.js` | 当前前端工具 chunk |
| `deploy/logs/local-backend.out.log` | 后端标准输出日志 |
| `deploy/logs/local-backend.err.log` | 后端启动和访问日志 |
| `deploy/logs/projects-auth-page.png` | 已登录项目页浏览器验证截图 |
| `deploy/uploads`、`deploy/outputs`、`deploy/temp`、`deploy/history` | 后端运行所需本地目录 |
| `deploy/persistent_storage` | 后端持久化存储目录 |

## 数据库补齐情况

本地数据库使用容器 `drama-postgres`，数据库已执行主 schema 和所有本地迁移 SQL。

已确认：

```text
public schema 表数量：44
```

关键迁移范围包括：

| 迁移类别 | 状态 |
| --- | --- |
| 基础项目/文件/任务/用户表 | 已执行 |
| Project Hub / Episodes / Assets / Storyboard / Timeline / Audio | 已执行 |
| Admin / Agent / API 配置 / 系统设置 | 已执行 |
| 组织、项目组、资源分享 | 已执行 |
| Credits 积分系统 | 已执行 |
| Media Library 和 folders | 已执行 |
| Video Reverse | 已执行 |
| Episode script segments / storyboard pipeline fields / audio mix | 已执行 |

数据库里保留了一个部署自测项目：

```text
local-deploy-smoke-20260607-114540
```

之前因 PowerShell 编码导致名称变成问号的测试项目已归档，默认项目列表不会显示。

## 已发现并处理的部署缺失

| 缺失/问题 | 处理方式 |
| --- | --- |
| 系统 PATH 中没有可用 `python` | 使用 Codex 内置 Python 创建 `deploy/.venv` |
| 系统 PATH 中没有可用 `npm/pnpm/corepack` | 使用 Docker `node:20-alpine` 在 `deploy/new_html` 内安装依赖和构建 |
| 后端启动依赖 Redis，缺失时会退出 | 新建并启动 `drama-redis` 容器 |
| 后端需要 PostgreSQL，数据库本身不会自动迁移 | 新建 `drama-postgres` 容器并手动执行 schema/migrations |
| 部分 SQL 迁移存在顺序依赖 | 按依赖顺序执行，先创建 `credits`、`media_library_items` 等被依赖表，再执行扩展迁移 |
| `deploy/new_html/vite.config.ts` 开发代理指向 `localhost:8000`，而后端实际端口是 `6006` | 本地部署使用生产构建 `deploy/dist` 并由 FastAPI `6006` 托管，绕开开发代理不一致问题 |
| Windows 控制台 GBK 对后端 emoji 日志会报编码噪音 | 启动脚本设置 `PYTHONUTF8=1` 和 `PYTHONIOENCODING=utf-8` |
| Edge/Node 对 `localhost` 偶发解析或 CDP 初始化不稳定 | 浏览器验证脚本默认使用 `127.0.0.1:6006`，CDP 端口随机化并增加重试 |

## 仍缺失或待生产配置的部分

这些不是本地基础部署阻断项，但会影响完整生成能力或生产可用性：

| 缺失项 | 影响 |
| --- | --- |
| AI API Key 未配置：`DEEPSEEK_API_KEY`、`ARK_API_KEY`、`GEMINI_TEXT_API_KEY`、`GEMINI_IMAGE_API_KEY`、`MINIMAX_API_KEY` 等 | 文本生成、图像生成、TTS、视频生成等外部 AI 功能不可用或只能显示占位 |
| ComfyUI / 外部 Agent 未接入 | 本地部署以 `AGENT_ONLY_MODE=true`、`LITE_WORKERS_COUNT=0` 启动，ComfyUI 工作流任务不会被本机执行 |
| 生产 `.env` 尚未标准化 | 当前本地脚本直接设置运行环境变量；上云或服务器部署时应整理 `.env` 或进程管理配置 |
| 前端完整 Vitest 套件存在既有失败 | 部署级 smoke 通过，但完整测试有 fixture 缺失、旧文案断言、mock 未同步等问题，需要另行修测试 |
| npm audit 报 11 个依赖漏洞 | 不阻塞本地部署；生产前建议单独评估并升级依赖 |
| `deploy/DEPLOY_GUIDE.md` 和部分 shell 脚本偏 Linux/旧端口说明 | 本地 Windows 部署以本文件和 `local_*.ps1` 为准；后续可统一文档 |

## 已完成自测

部署级自测结果：

| 检查项 | 结果 |
| --- | --- |
| 后端依赖导入 | 通过 |
| 后端 smoke：`pytest tests/test_smoke.py -q` | `2 passed` |
| 前端 smoke：`vitest run __tests__/smoke.test.ts` | `2 passed` |
| 前端生产构建：`npm run build` | 通过 |
| `/health` | `healthy` |
| `/projects` | 返回前端 HTML，引用当前构建产物 |
| `/assets/index-DAEewdMq.js` | `200 OK` |
| `/api/login` | 登录成功，返回 token |
| `/api/user/info` | 鉴权成功 |
| `/api/projects` 创建和列表读取 | 成功 |
| Edge 无头浏览器已登录项目页渲染 | 成功，截图见 `deploy/logs/projects-auth-page.png` |

## 常用命令

启动本地部署：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_start.ps1
```

启动并重新构建前端：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_start.ps1 -BuildFrontend
```

验证本地部署：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_verify.ps1
```

停止后端：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_stop.ps1
```

停止后端并停止本地基础设施容器：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_stop.ps1 -StopInfra
```

## 2026-06-18 本轮部署/重构记录

### 已修改内容

- 分镜页性能：
  - `deploy/new_html/pages/StoryboardGenPage.tsx`
    - 分镜首屏默认只处理 10 个镜头。
    - `entityFiles` 查询只针对当前可见镜头发起，避免一次性拉取全部镜头图片。
    - `assets` slice 改为首屏后 `requestIdleCallback`/`setTimeout` 静默加载，避免阻塞分镜主体加载。
    - 时间线预览只取当前可见镜头。
  - `deploy/new_html/components/GenerationPage.tsx`
    - 支持 `shotPageSize`、`totalShotCount`、`onVisibleShotCountChange`。
    - 缩略图生成只处理当前可见镜头。
    - 镜头列表默认 10 个，按需“展开更多”。
  - `deploy/new_html/contexts/EpisodeContext.tsx`
    - 新增 `loadSlicesQuiet()`，用于后台静默加载非首屏数据。
  - `deploy/new_html/components/TimelineTrack.tsx`
    - 预览图片增加 `loading="lazy"`。

- 视频页性能：
  - `deploy/new_html/components/VideoPage.tsx`
    - 视频任务默认只渲染前 10 组。
    - 已生成视频卡片使用 `LazyVideo`，仅进入视口附近后才设置 `src` 和 `preload="metadata"`。
  - `deploy/new_html/pages/VideoGenPage.tsx`
    - 导入面板图片增加 `loading="lazy"`。

- API 配置管理：
  - 新增 `deploy/services/api_provider_registry.py`
    - 统一维护 provider -> env key、endpoint env key、预设模型、fallback key 和能力目录。
  - `deploy/admin_routes.py`
    - `/api/admin/api-configs/presets` 现在返回 `presets` + `providers`。
    - 导入预设模型继续使用同一份 registry 数据。
  - `deploy/cluster_main.py`
    - `load_api_configs_to_env()` 改为从 registry 解析 env key，避免 provider 映射散落。
  - `deploy/admin/app.js`
    - 旧后台 API 密钥页读取 provider catalog。
    - 卡片显示 vendor、key、endpoint env、fallback、capability。
    - Provider 下拉会根据后端 catalog 自动补选项。
  - `deploy/admin/index.html`
    - 静态脚本版本更新为 `app.js?v=20260618a`，避免浏览器缓存旧后台脚本。

### 验证结果

- 后端语法：
  - `python -m py_compile deploy/services/api_provider_registry.py deploy/admin_routes.py deploy/cluster_main.py` 通过。
- 旧后台 JS：
  - `node --check deploy/admin/app.js` 通过。
- Provider registry 抽查：
  - 12 个 provider，15 个预设。
  - 已确认 `deepseek`、`gemini-text`、`seedance`、`dashscope`、`laozhang-gpt-image` 能返回对应 env key/fallback 信息。
- 前端 TypeScript：
  - `GenerationPage.tsx` 本轮相关的 `shotId` / `Material.name` 两处类型问题已修正。
  - 全项目 `tsc --noEmit` 仍失败，剩余为既有旧债：测试 fixture 缺失、Admin tabs never 类型、VideoPage 旧 TaskGroup/TaskStatus 类型不一致、部分 WorkspaceApp props 不完整等。

### 仍需生产部署处理

- 服务器上线需要同步本轮修改文件到 `/home/Administrator/deploy`。
- 同步后在服务器执行：
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `python /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 若服务器仍感觉卡顿，下一步建议做真正的列表虚拟化：
  - 分镜左侧列表替换为虚拟滚动窗口。
  - 图片/视频卡片统一使用 IntersectionObserver 挂载媒体源。
  - 后端 `entityFiles` 增加批量接口，首屏一次取 10 个镜头的图片元数据，而不是 10 个并发请求。

### 生产服务器部署结果

- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_patch_20260618-043122`。
- 已在服务器执行：
  - `python3 -m py_compile /home/Administrator/deploy/services/api_provider_registry.py /home/Administrator/deploy/admin_routes.py /home/Administrator/deploy/cluster_main.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - 前端生产构建通过，产物 `../dist/assets/index-WQcuv05j.js`。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 API 管理平台增强记录

### 已修改内容

- `deploy/services/api_provider_registry.py`
  - 新增 `summarize_api_provider_configs()`。
  - 输出 provider 级别的 `ready` / `missing_key` / `disabled` / `not_imported` 状态。
  - 输出配置数量、启用数量、已填 key 数量、缺 key 数量、重复模型、共享 env key、endpoint 冲突等摘要。
  - 不返回任何明文密钥。
- `deploy/admin_routes.py`
  - `/api/admin/api-configs` 保持原路由不变，新增返回字段：
    - `providers`
    - `provider_status`
  - 未新增路由，避免影响路由数量约束。
- `deploy/admin/app.js`
  - API 密钥页读取 provider 状态摘要。
  - 顶部摘要显示 provider ready / missing / disabled / not imported。
  - 每张模型卡显示 provider-level readiness badge。
  - 继续显示 env key、endpoint env、fallback、capability 和 issues。
- `deploy/admin/index.html`
  - 旧后台脚本版本更新到 `app.js?v=20260618b`。
- `deploy/new_html/admin/AdminSettingsPage.tsx`
  - iframe 缓存版本更新到 `20260618b`。

### 验证结果

- 本地：
  - `node --check deploy/admin/app.js` 通过。
  - `python -m py_compile deploy/services/api_provider_registry.py deploy/admin_routes.py deploy/cluster_main.py` 通过。
- 服务器：
  - 备份目录：`/home/Administrator/deploy_backups/mecha_api_mgmt_20260618-044213`。
  - `cd /home/Administrator/deploy/new_html && npm run build` 通过，产物 `../dist/assets/index-C1DsCoqt.js`。
  - `sudo systemctl restart drama` 后服务状态 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`：`9/9` 通过。
  - 线上抽查：
    - `/api/admin/api-configs` 返回 `api_configs=2`、`providers=12`、`provider_status=12`。
    - `seedance` 当前状态为 `not_imported`，预设数量 `2`。
    - `/admin-legacy/` 已引用 `app.js?v=20260618b`。

## 2026-06-18 Provider Resolver 增量记录

### 已修改内容
- `deploy/services/api_provider_registry.py`
  - 预设模型现在会统一补充 `supports_proxy`、`health_check_url`、`required_key`。
  - 新增 `get_api_model_preset()`，供运行时按 `provider + model` 查默认 endpoint/model。
  - 新增 endpoint/proxy 对应 env key helper：`get_endpoint_env_key()`、`get_proxy_mode_env_key()`、`get_custom_proxy_env_key()`。
  - `gemini-text` 默认 endpoint 调整为当前线上实际使用的 `https://api.laozhang.ai/v1`，避免 resolver 接入后无 DB endpoint 时改变现有行为。
- 新增 `deploy/services/api_provider_runtime.py`
  - 新增 `resolve_provider(provider, model)`。
  - 每次调用实时读取 `os.getenv()`，不缓存 key，支持后台保存后热更新。
  - 返回 key、endpoint、model、proxy_config、来源信息；不读取数据库，不暴露明文密钥。
- `deploy/cluster_main.py`
  - `load_api_configs_to_env()` 继续作为 DB -> env 的唯一入口。
  - DB 配置加载前会把受管理 API env 恢复到 systemd/env 启动基线，再叠加 DB 配置，符合“DB 优先，删除/禁用 DB 配置后回退 env”的规则。
  - DB 的 `endpoint`、`proxy_mode`、`custom_proxy` 现在也会注入对应 env。
  - `/api/gemini/text` 已从硬编码 `https://api.laozhang.ai/v1/chat/completions` 改为 `resolve_provider("gemini-text", "gemini-2.5-flash")`。
  - DeepSeek client 初始化和懒加载已改为 `resolve_provider("deepseek", "deepseek-reasoner")`，不再在 handler 侧重复查 DB/解密，也不再写死 base_url。
- `deploy/admin_routes.py`
  - 删除旧 `_LEGACY_PRESET_API_MODELS` 影子列表，预设导入只使用 registry。

### 仍未接入 resolver 的范围
- `cluster_main.py` 内以下外部模型 handler 仍有独立硬编码 endpoint/key 逻辑，待后续按同一模式逐个替换：
  - `/api/video/*` 相关 MiniMax / Seedance / DashScope / Sora2 / Veo 逻辑
- `agent_routes.py` 和 ComfyUI provider 配置未触碰，继续保持红线约束。

### 本地验证结果
- `python -m py_compile deploy/services/api_provider_registry.py deploy/services/api_provider_runtime.py deploy/admin_routes.py deploy/cluster_main.py` 通过。
- resolver 抽查通过：
  - `GEMINI_TEXT_API_KEY` 无 `GEMINI_TEXT_ENDPOINT` 时，默认解析到 `https://api.laozhang.ai/v1/chat/completions`。
  - 设置 `GEMINI_TEXT_ENDPOINT=https://self.example/v1` 后，解析到 `https://self.example/v1/chat/completions`。
  - `DEEPSEEK_ENDPOINT` 可覆盖 DeepSeek base_url。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_resolver_20260618-130032`。
- 已在服务器执行：
  - `python3 -m py_compile services/api_provider_registry.py services/api_provider_runtime.py admin_routes.py cluster_main.py`
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 图像 API Resolver 增量记录

### 已修改内容
- `deploy/services/api_provider_registry.py`
  - `gemini-image` 预设 model/endpoint 对齐当前运行时实际调用：`gemini-2.5-flash-image`、`gemini-3.1-flash-image-preview`，endpoint 为 `https://api.laozhang.ai/v1beta`。
  - 新增 `laozhang-gpt-image` / `laozhang-sora2` 两个 GPT Image preset，避免仅通过 systemd env 注入 key 时 resolver 缺少默认 endpoint。
- `deploy/cluster_main.py`
  - `/api/gemini/image` 已改为 `resolve_provider("gemini-image", request.model)`，不再直接读取 `GEMINI_IMAGE_API_KEY` 或硬编码 laozhang `v1beta` URL。
  - `/api/gpt-image/generate` 已按 `tier` 映射到 `laozhang-gpt-image` / `laozhang-sora2`，key 和 base_url 都由 resolver 返回。
  - `/api/materials/doubao` 已改为 `resolve_provider("doubao", DOUBAO_MODEL)`，并移除旧的 `DOUBAO_ENDPOINT` 常量使用。
  - `/api/generate/multi-grid-storyboard` 已改为复用 Gemini Image resolver。
  - 各调用保留原 payload、入库、素材库同步逻辑，只替换 key/endpoint/proxy 来源。

### 仍未接入 resolver 的范围
- `/api/video/*` 相关 MiniMax / Seedance / DashScope / Sora2 / Veo 逻辑仍待下一轮替换。
- `agent_routes.py` 和 ComfyUI provider 配置未触碰，继续保持红线约束。

### 本地验证结果
- `python -m py_compile deploy/services/api_provider_registry.py deploy/services/api_provider_runtime.py deploy/admin_routes.py deploy/cluster_main.py` 通过。
- resolver 抽查通过：
  - `GEMINI_IMAGE_ENDPOINT` 可覆盖 Gemini Image `generateContent` base。
  - `GPT_IMAGE_ENDPOINT` 可覆盖 `laozhang-gpt-image` base。
  - `SORA2_GPT_IMAGE_ENDPOINT` 可覆盖 official GPT Image base。
  - `ARK_ENDPOINT` 可覆盖 Doubao image endpoint。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_image_resolver_20260618-130923`。
- 已在服务器执行：
  - `python3 -m py_compile services/api_provider_registry.py services/api_provider_runtime.py admin_routes.py cluster_main.py`
  - resolver 图像 provider 抽查。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - 登录后读取 `/api/admin/api-configs/presets`。
- 结果：
  - Python 编译通过。
  - resolver 解析通过：Gemini Image、GPT Image VIP、GPT Image Official、Doubao 均有默认 endpoint。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。
  - 线上 presets：`17` 条，已包含 `gemini-image`、`laozhang-gpt-image`、`laozhang-sora2`、`doubao`。

## 2026-06-18 视频 Client Resolver 增量记录

### 已修改内容
- `deploy/external_api/video/minimax.py`
  - `MinimaxClient` 改为通过 `resolve_provider("minimax", "MiniMax-Hailuo-02")` 获取 key、endpoint、proxy。
  - 每次 `generate_video()`、`query_task()`、`download_video()` 前都会刷新 runtime 配置，避免全局 client 缓存导致后台 key/endpoint 更新不生效。
- `deploy/external_api/video/sora2.py`
  - `Sora2Client` 改为通过 `resolve_provider("sora2", "sora-2")` 获取 key、endpoint、proxy。
- `deploy/external_api/video/veo.py`
  - `VeoClient` 改为通过 `resolve_provider("veo", model)` 获取 key、endpoint、proxy。
  - 保留 `VEO_API_KEY` 缺省回退 `SORA2_API_KEY` 的语义，由 registry fallback 统一承载。
- `deploy/external_api/video/seedance.py`
  - `SeedanceClient` 改为通过 `resolve_provider("seedance", model_name)` 获取 key、endpoint、proxy。
  - 保留 `SEEDANCE_API_KEY` 缺省回退 `ARK_API_KEY` 的语义，由 registry fallback 统一承载。
- 本轮没有修改 `core/worker.py`、`agent_routes.py`、ComfyUI pipeline 或 Redis 任务契约。

### 仍未接入 resolver 的范围
- `deploy/external_api/video/dashscope.py`
- `deploy/wan2_dashscope_api.py`
- `deploy/external_api/audio/minimax_audio.py` 和 `deploy/minimax_audio.py`
- `deploy/services/video_reverse_service.py` 中的 laozhang 文本代理调用。

### 本地验证结果
- `python -m py_compile deploy/external_api/video/minimax.py deploy/external_api/video/sora2.py deploy/external_api/video/veo.py deploy/external_api/video/seedance.py deploy/services/api_provider_registry.py deploy/services/api_provider_runtime.py deploy/cluster_main.py` 通过。
- 使用 `deploy/.venv/Scripts/python.exe` 构造 client 并设置 endpoint env 覆盖，确认：
  - `MINIMAX_ENDPOINT` 可覆盖 MiniMax base。
  - `SORA2_ENDPOINT` 可覆盖 Sora2 base。
  - `VEO_ENDPOINT` 可覆盖 Veo base。
  - `SEEDANCE_ENDPOINT` 可覆盖 Seedance task endpoint。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_video_clients_20260618-131741`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile external_api/video/minimax.py external_api/video/sora2.py external_api/video/veo.py external_api/video/seedance.py services/api_provider_registry.py services/api_provider_runtime.py`
  - 使用服务同款 venv 构造 MiniMax/Sora2/Veo/Seedance client，并验证 endpoint env 覆盖。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - client resolver 覆盖检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 DashScope / Audio / Reverse Resolver 增量记录

### 已修改内容
- `deploy/external_api/video/dashscope.py`
  - `DashScopeVideoClient` 改为通过 `resolve_provider("dashscope", model)` 获取 key、endpoint、proxy。
  - 全局单例不再按 env key 重建；每次 `create_task()` / `query_task()` 前刷新 runtime 配置，支持后台热更新。
  - 新增 DashScope video endpoint 归一化：
    - 旧 `https://dashscope.aliyuncs.com/compatible-mode/v1` 自动落回当前可用的 `api/v1/services/aigc/video-generation/video-synthesis`。
    - 自定义 root endpoint 会自动拼接 video-synthesis 路径。
    - 自定义完整 `/services/.../video-synthesis` endpoint 会保留原值，并推导查询任务用的 `/tasks/{task_id}` root。
  - aiohttp 请求接入 resolver 返回的 custom proxy。
- `deploy/external_api/video/wan2.py`
  - `Wan26Client` 改为通过 `resolve_provider("dashscope", "wan2.6-i2v")` 获取 key、endpoint、proxy。
  - 保留旧 compatible-mode endpoint 的兼容落回逻辑，避免旧 DB 预设导致 Wan2.6 任务接口失效。
  - `create_video_task()`、`query_task()`、`download_video()` 均刷新 runtime 配置并透传 requests proxy。
- `deploy/external_api/audio/minimax_audio.py`
  - `MinimaxAudioClient` 改为通过 `resolve_provider("minimax", "MiniMax-Hailuo-02")` 获取 key、endpoint、proxy。
  - voice design / voice clone / list voices / delete voice / TTS / music / lyrics / files upload-retrieve-delete 等调用点均使用最新 runtime 配置。
  - 保留 `MINIMAX_GROUP_ID` 的现有 env 逻辑。
- `deploy/services/video_reverse_service.py`
  - 视频反推视觉理解从硬编码 `https://api.laozhang.ai/v1/chat/completions` 改为 `resolve_provider("gemini-text", "gemini-2.5-flash")`。
  - 请求 URL、key、proxy 均由 resolver 返回。
- `deploy/services/audio_provider.py`
  - `GeminiAudioProvider` 至少从 `resolve_provider("gemini-tts", "gemini-2.0-flash")` 取 key。
  - Google SDK 路径暂未强接 endpoint，避免破坏 SDK 默认调用方式。
- `deploy/services/api_provider_registry.py`
  - Wan2.6 DashScope 预设 endpoint 调整为当前代码实际使用的 video-synthesis 任务端点。

### 本地验证结果
- `python -m py_compile deploy/services/api_provider_registry.py deploy/services/api_provider_runtime.py deploy/external_api/video/dashscope.py deploy/external_api/video/wan2.py deploy/external_api/audio/minimax_audio.py deploy/services/video_reverse_service.py deploy/services/audio_provider.py` 通过。
- 使用 `deploy/.venv/Scripts/python.exe` 运行 runtime 检查通过：
  - DashScope 默认 endpoint、旧 `compatible-mode/v1` endpoint、自定义 root endpoint 均能解析。
  - DashScope custom proxy 能传入 aiohttp。
  - Wan2.6 custom endpoint/proxy 能传入 requests。
  - MiniMax 音频 custom endpoint/proxy 能解析。
  - Gemini Text `chat/completions` URL 由 resolver 生成。

### 本轮仍未处理或需后续观察
- `cluster_main.py` 顶部仍保留少量历史全局变量和启动期 warning，用于兼容现有启动流程；实际已迁移的 handler/client 不再依赖硬编码调用 URL。
- `agent_routes.py` 与 ComfyUI provider 配置未修改，继续遵守红线。
- Google Gemini TTS SDK 尚未接入自定义 endpoint，仅统一 key 来源；如后续改成自建兼容端点，需要单独替换 SDK 调用层。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_dashscope_audio_resolver_20260618-053919`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/api_provider_registry.py services/api_provider_runtime.py external_api/video/dashscope.py external_api/video/wan2.py external_api/audio/minimax_audio.py services/video_reverse_service.py services/audio_provider.py`
  - resolver runtime 检查：DashScope / Wan2.6 / MiniMax Audio / Gemini Text endpoint-proxy 覆盖均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - 服务器 resolver runtime 检查通过。
  - `drama` 服务状态：`active`。
  - 首次 smoke 在重启窗口期登录接口短暂 `502`；等待服务稳定后重跑，线上 smoke：`9/9` 通过。

## 2026-06-18 API 配置健康检查增强记录

### 已修改内容
- `deploy/admin_routes.py`
  - 保持原有 `/api/admin/api-configs/{config_id}/test` 路径不变，升级返回语义。
  - 新增 provider/model/endpoint 对应的健康检查 URL 派生逻辑：
    - `doubao` / `seedance` 从具体生成任务 endpoint 派生到 Ark `/api/v3/models`。
    - `dashscope` 从 video-synthesis endpoint 派生到 `/compatible-mode/v1/models`。
    - OpenAI-compatible base endpoint 统一尝试 `/models`。
    - 同时融合 registry preset / provider catalog 的 `health_check_url`。
  - 2xx 才算 `test.ok=true`；401/403 明确返回 `auth_ok=false`；404/405 等返回 `reachable=true` 但 `ok=false`。
  - 返回体新增 `reachable`、`auth_ok`、`provider`、`model_name`、`urls_tried`、`checked_at`，不返回明文 key。
- `deploy/admin/app.js`
  - API 卡片按钮从“测试”调整为“健康”。
  - Toast 区分：
    - 健康检查通过
    - 认证失败
    - 端点可达但校验未通过
    - 健康检查失败
- `deploy/admin/index.html`
  - 旧后台脚本版本更新到 `app.js?v=20260618c`。
- `deploy/new_html/admin/AdminSettingsPage.tsx`
  - legacy iframe 版本更新到 `20260618c`，避免继续使用旧缓存。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_provider_registry.py` 通过。
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。
- 使用 `deploy/.venv/Scripts/python.exe` 验证健康检查 URL 派生通过：
  - Doubao image endpoint → `https://ark.cn-beijing.volces.com/api/v3/models`
  - Seedance task endpoint → `https://ark.cn-beijing.volces.com/api/v3/models`
  - DashScope video-synthesis endpoint → `https://dashscope.aliyuncs.com/compatible-mode/v1/models`
  - Gemini / laozhang v1 endpoint → `/models`

### 本轮仍未处理或需后续观察
- 当前健康检查仍是轻量 GET 模型/健康端点，不会发起真实生成任务；部分第三方网关可能没有标准 `/models`，这类情况会显示“端点可达但校验未通过”，后续可为 provider 增加专用 check adapter。
- 本轮未拆分 `cluster_main.py` 路由；原因是当前 AI proxy 路由仍依赖主文件内的 auth、DeepSeek 流式生成器和保存逻辑。后续建议先抽 service 层，再抽 `routers/ai_proxy.py`。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_api_healthcheck_20260618-055032`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_provider_registry.py`
  - `node --check admin/app.js`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - 管理员登录后调用 `/api/admin/api-configs/{config_id}/test`，确认返回 `ok/reachable/auth_ok/provider/model_name/urls_tried/checked_at`。
- 结果：
  - Python 编译通过。
  - 旧后台 JS 语法检查通过。
  - 前端构建通过，产物 `../dist/assets/index-ZSqlaURx.js`。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。
  - 健康检查接口结构验证通过。

## 2026-06-18 AI Proxy Service 抽取增量记录

### 已修改内容
- 新增 `deploy/services/ai_proxy_service.py`
  - 新增 `generate_gemini_text()`，负责 Gemini Text 的 provider resolver、HTTP 请求、proxy 透传、上游错误提取。
  - 新增 `build_chat_payload()`，集中构造 OpenAI-compatible chat payload。
  - 新增 `AIProxyError` / `AIProxyConfigError` / `AIProxyUpstreamError`，供路由层映射 HTTP 响应。
- `deploy/cluster_main.py`
  - `/api/gemini/text` 不再直接拼 headers/payload/url，也不再直接 `requests.post`。
  - handler 仅保留鉴权后的业务壳、任务入库和返回格式，外部 API 调用改为 `generate_gemini_text()`。
  - 保留原有 `/api/gemini/text` 路由路径和响应 `{content}`，未新增/删除路由。

### 本地验证结果
- `python -m py_compile deploy/services/ai_proxy_service.py deploy/cluster_main.py` 通过。
- 使用 `deploy/.venv/Scripts/python.exe` 进行 mock 检查通过：
  - 缺少 `GEMINI_TEXT_API_KEY` 时抛出 `AIProxyConfigError`。
  - `GEMINI_TEXT_ENDPOINT=https://example.test/v1` 时请求 URL 为 `/chat/completions`。
  - `GEMINI_TEXT_PROXY_MODE=custom` + `GEMINI_TEXT_CUSTOM_PROXY` 能传入 requests `proxies`。
  - payload 中 system/user messages、temperature、model 均按预期生成。
- 路由 decorator 扫描当前为 `282` 条；本轮没有新增或删除路由 decorator。

### 本轮仍未处理或需后续观察
- DeepSeek 流式调用仍留在 `cluster_main.py`，因为它涉及 sync generator、SSE、`MAIN_EVENT_LOOP` 回调保存任务。建议下一轮先抽 `DeepSeekTextService`，保留 generator 行为后再迁 router。
- Gemini Image / GPT Image / Doubao 已接 resolver，但仍在 `cluster_main.py` handler 内；后续可按同样方式迁入 `ai_proxy_service.py`，再整体拆到 `routers/ai_proxy.py`。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_ai_proxy_service_20260618-055735`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/ai_proxy_service.py cluster_main.py`
  - 使用服务器 venv 进行 mock 行为检查：缺 key 抛错、endpoint 拼接、custom proxy 透传、payload 构造均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - `generate_gemini_text()` runtime mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 Gemini Image / Doubao AI Proxy Service 抽取增量记录

### 已修改内容
- `deploy/services/ai_proxy_service.py`
  - 新增 `normalize_gemini_image_model()`，集中处理历史模型别名：`nanobanana` / `gemini-3-pro-image-preview` 统一路由到 `gemini-3.1-flash-image-preview`。
  - 新增 `build_gemini_image_payload()` / `generate_gemini_images()`，负责 Gemini Image 的 provider resolver、payload 构造、HTTP 请求、proxy 透传和返回图片解析。
  - 新增 `build_doubao_image_payload()` / `generate_doubao_images()`，负责 Doubao/Ark 图像生成的 provider resolver、参考图限制、顺序生成参数、HTTP 请求、proxy 透传和返回图片解析。
- `deploy/cluster_main.py`
  - `/api/gemini/image` 不再直接拼 laozhang URL、headers、payload，也不再直接调用 `requests.post`；外部调用改为 `proxy_generate_gemini_images()`。
  - `/api/materials/doubao` 不再直接拼 Ark URL、headers、payload，也不再直接调用 `requests.post`；外部调用改为 `proxy_generate_doubao_images()`。
  - 两个 handler 保留原有鉴权、参考图读取、任务入库、素材库写入和响应格式；未新增或删除路由。

### 本地验证结果
- `python -m py_compile deploy/services/ai_proxy_service.py deploy/cluster_main.py` 通过。
- 使用 `deploy/.venv/Scripts/python.exe` 进行 mock 检查通过：
  - Gemini Image 历史模型别名归一、未知模型 fallback、3.1 模型 `imageSize` 传递逻辑均符合预期。
  - 缺少 `GEMINI_IMAGE_API_KEY` 时抛出 `AIProxyConfigError`。
  - Gemini Image endpoint 拼接为 `.../models/{model}:generateContent`，custom proxy 能透传到 requests。
  - Doubao 参考图和 `sequential_image_generation_options.max_images` 限制逻辑符合旧 handler 行为。
  - Doubao endpoint、Authorization、payload、custom proxy 均按 resolver 返回值使用。
- 路由 decorator 扫描当前为 `282` 条；本轮没有新增或删除路由 decorator。

### 本轮仍未处理或需后续观察
- GPT Image handler 目前已经接入 resolver，但还没有迁入 `ai_proxy_service.py`；建议下一轮继续迁移 GPT Image，之后再处理 DeepSeek 流式 generator。
- `agent_routes.py` 和 ComfyUI provider 配置未修改，继续遵守红线。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器回滚备份目录（首次替换前）：`/home/Administrator/deploy_backups/mecha_image_ai_proxy_service_20260618-060654`。
- 成功部署脚本备份目录：`/home/Administrator/deploy_backups/mecha_image_ai_proxy_service_20260618-060835`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/ai_proxy_service.py cluster_main.py`
  - 使用服务器 venv 进行 mock 行为检查：Gemini Image 模型归一、payload 构造、缺 key 抛错、endpoint 拼接、custom proxy 透传、Doubao 参考图和顺序生成参数均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - `generate_gemini_images()` / `generate_doubao_images()` runtime mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 GPT Image AI Proxy Service 抽取增量记录

### 已修改内容
- `deploy/services/ai_proxy_service.py`
  - 新增 `GptImageReferenceInput`，用于把路由层读取到的参考图二进制传入 service。
  - 新增 `normalize_gpt_image_tier()`，集中处理 `vip` / `official` 到 provider、model、key hint 的映射。
  - 新增 `build_gpt_image_generation_payload()` / `build_gpt_image_edit_data()`，集中构造 OpenAI Images-compatible 文生图和图改图 payload。
  - 新增 `generate_gpt_images()`，负责 GPT Image 的 provider resolver、endpoint 拼接、JSON/multipart 请求、proxy 透传、上游错误映射和返回图片解析。
- `deploy/cluster_main.py`
  - `/api/gpt-image/generate` 不再直接拼 laozhang URL、headers、JSON/multipart payload，也不再直接调用 `requests.post`。
  - handler 保留鉴权、prompt 校验、参考图读取、文件入库、素材库同步和响应格式；外部模型调用改为 `proxy_generate_gpt_images()`。
  - 原有路由路径、入参和返回结构保持不变；未新增或删除路由 decorator。

### 本地验证结果
- `python -m py_compile deploy/services/ai_proxy_service.py deploy/cluster_main.py` 通过。
- `git diff --check -- deploy/services/ai_proxy_service.py deploy/cluster_main.py Agent.md` 通过。
- 使用 `deploy/.venv/Scripts/python.exe` 进行 mock 检查通过：
  - `vip` 文生图走 `/images/generations`，model 为 `gpt-image-2-vip`。
  - `official` 图改图走 `/images/edits`，model 为 `gpt-image-2`，multipart 字段为 `image[]`。
  - `GPT_IMAGE_*` / `SORA2_GPT_IMAGE_*` endpoint、custom proxy 均按 resolver 返回值透传。
  - 缺 key 抛出 `AIProxyConfigError`，无效 tier 返回 400，上游 401 映射为 502。
- `git diff -U0 -- deploy/cluster_main.py deploy/services/ai_proxy_service.py | rg "^[+-]@(app|router)\."` 未发现路由 decorator 变化。

### 本轮仍未处理或需后续观察
- DeepSeek 流式调用仍在 `cluster_main.py`，下一步建议抽 `DeepSeekTextService`，重点保持 SSE generator、任务保存回调和错误透传不变。
- `agent_routes.py` 和 ComfyUI provider 配置未修改，继续遵守红线。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_gpt_image_ai_proxy_service_20260618-061813`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/ai_proxy_service.py cluster_main.py`
  - 使用服务器 venv 进行 mock 行为检查：VIP 文生图、Official 图改图、endpoint 拼接、multipart 字段、custom proxy、缺 key、无效 tier、上游 401 映射均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - `generate_gpt_images()` runtime mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 DeepSeek AI Proxy Service 抽取增量记录

### 已修改内容
- `deploy/services/ai_proxy_service.py`
  - 新增 `ensure_deepseek_configured()`，用于路由返回 `StreamingResponse` 前做配置预检。
  - 新增 `build_deepseek_payload()` / `generate_deepseek_text()`，集中构造 DeepSeek OpenAI-compatible payload 和非流式调用。
  - 新增 `stream_deepseek_chat()`，使用 resolver 返回的 key、endpoint、proxy 发起 DeepSeek SSE 流式请求，并保持原有前端事件格式：`reasoning` / `content` / `error` / `[DONE]`。
  - DeepSeek 调用不再依赖模块级 OpenAI client；每次调用都会重新通过 `resolve_provider("deepseek", model)` 读取当前 env/DB 合并后的配置，支持后台热更新。
- `deploy/cluster_main.py`
  - 移除 `OpenAI` SDK client 初始化和 `deepseek_client` 全局缓存。
  - `load_api_configs_to_env()` 仅刷新 env 和日志，不再构造 DeepSeek client。
  - `/api/deepseek/chat` 保留原有路由、鉴权、任务入库、`StreamingResponse`、Nginx 禁缓冲 header 和完成后保存任务结果逻辑。
  - 旧 helper 名 `ensure_deepseek_client()` / `call_deepseek()` / `call_deepseek_stream()` 保留为薄包装，内部转调 `ai_proxy_service.py`，降低文件内历史引用风险。

### 本地验证结果
- `python -m py_compile deploy/services/ai_proxy_service.py deploy/cluster_main.py` 通过。
- `git diff --check -- deploy/services/ai_proxy_service.py deploy/cluster_main.py Agent.md` 通过。
- 使用 `deploy/.venv/Scripts/python.exe` 进行 mock 检查通过：
  - 缺少 `DEEPSEEK_API_KEY` 时 `ensure_deepseek_configured()` 返回 503 配置错误。
  - 非流式请求走 `{endpoint}/chat/completions`，payload 中 `stream=false`，custom proxy 透传到 requests。
  - 流式请求走 `{endpoint}/chat/completions`，payload 中 `stream=true`，`response_format=json_object` 仅在 JSON 模式传递。
  - DeepSeek SSE 中 `reasoning_content` 仍映射为前端 `reasoning` 事件，`content` 仍映射为前端 `content` 事件。
  - 流式完成后 `on_complete` 收到拼接后的正文，用于沿用原有任务结果保存逻辑。
  - 上游 401 映射为 SSE `error` 事件并正常输出 `[DONE]`。
- `git diff -U0 -- deploy/cluster_main.py deploy/services/ai_proxy_service.py | rg "^[+-]@(app|router)\."` 未发现路由 decorator 变化。

### 本轮仍未处理或需后续观察
- `/api/deepseek/chat` 仍留在 `cluster_main.py`，但外部调用已经抽到 service；下一步可在路由更薄后迁入 `routers/ai_proxy.py`。
- `agent_routes.py` 和 ComfyUI provider 配置未修改，继续遵守红线。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_deepseek_ai_proxy_service_20260618-062746`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/ai_proxy_service.py cluster_main.py`
  - 使用服务器 venv 进行 mock 行为检查：缺 key 配置错误、非流式请求、SSE reasoning/content、完整文本回调、custom proxy、上游 401 SSE 错误事件均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - `generate_deepseek_text()` / `stream_deepseek_chat()` runtime mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 AI Proxy Router 拆分增量记录

### 已修改内容
- 新增 `deploy/routers/__init__.py`。
- 新增 `deploy/routers/ai_proxy.py`
  - 新增 `create_ai_proxy_router()` router factory，避免 router 反向 import `cluster_main.py` 造成循环依赖。
  - 迁入 5 个现有 AI proxy 路由：
    - `POST /api/deepseek/chat`
    - `POST /api/gemini/text`
    - `POST /api/gemini/image`
    - `POST /api/gpt-image/generate`
    - `POST /api/materials/doubao`
  - 路由层继续负责鉴权、任务入库、参考图读取、文件入库、素材库同步、SSE header 和响应结构。
  - 外部 provider 调用继续统一走 `services/ai_proxy_service.py`。
- `deploy/cluster_main.py`
  - 移除上述 5 个 AI proxy handler 及已无外部引用的 DeepSeek helper 包装。
  - 在 `to_doubao_image_input()` 后注册 `create_ai_proxy_router()`，向 router 注入：
    - `require_auth`
    - `_storage_path_safe`
    - `to_doubao_image_input`
    - `MAIN_EVENT_LOOP` getter
    - `DOUBAO_MODEL` getter
  - 保留原有 URL、入参、返回格式；未修改 `agent_routes.py` 和 ComfyUI pipeline 红线文件。

### 本地验证结果
- `python -m py_compile deploy/routers/ai_proxy.py deploy/services/ai_proxy_service.py deploy/cluster_main.py` 通过。
- `git diff --check -- deploy/cluster_main.py deploy/routers/ai_proxy.py Agent.md` 通过。
- 源码扫描确认 5 个目标路由只在 `deploy/routers/ai_proxy.py` 中注册。
- 加载 `cluster_main.app` 后检查：
  - `/api/deepseek/chat` 注册数为 1。
  - `/api/gemini/text` 注册数为 1。
  - `/api/gemini/image` 注册数为 1。
  - `/api/gpt-image/generate` 注册数为 1。
  - `/api/materials/doubao` 注册数为 1。
- 使用 `httpx.ASGITransport` 进行 router 行为 mock 检查通过：
  - `POST /api/gemini/text` 在 mock service 下返回 `{content}`。
  - `POST /api/deepseek/chat` 在 mock stream 下返回 SSE `[DONE]`，并保留 `X-Accel-Buffering: no`。
- 当前源码路由 decorator 宽口径扫描为 `311` 条；本轮对 5 个 AI proxy 路由做迁移，未引入重复注册。

### 本轮仍未处理或需后续观察
- `cluster_main.py` 仍包含大量项目、素材、视频、管理类旧路由；本轮只完成开发计划中的 MVC 增量2首批 AI proxy 路由迁移。
- 后续建议继续按计划抽 `routers/video.py` 或把剩余 AI proxy 相关工具函数进一步归并到 service/helper 层。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_ai_proxy_router_20260618-063917`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/ai_proxy.py services/ai_proxy_service.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 5 个目标路由均为单一注册。
  - 使用服务器 venv + `httpx.ASGITransport` 进行 router mock：`/api/gemini/text` 返回 `{content}`，`/api/deepseek/chat` 返回 SSE `[DONE]` 且保留 `X-Accel-Buffering: no`。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - AI Proxy router 路由唯一性检查通过。
  - AI Proxy router 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 Video Router 拆分增量记录

### 已修改内容
- 新增 `deploy/routers/video.py`
  - 新增 `create_video_router()` router factory，避免 router 反向 import `cluster_main.py`。
  - 迁入 `POST /api/video/crop` 视频裁剪路由。
  - 路由层保留原有 FFmpeg 剪辑、文件查找、临时文件清理、数据库文件记录、返回结构。
  - 通过 factory 注入 `require_auth`、`video_cluster_manager` getter、`cluster_manager` getter。
- `deploy/cluster_main.py`
  - 注册 `create_video_router()`。
  - 删除旧的 `@app.post("/api/video/crop")` handler，避免重复注册。
  - 不修改 worker、任务队列、ComfyUI pipeline 或 `agent_routes.py` 红线文件。

### 本地验证结果
- `python -m py_compile deploy/routers/video.py deploy/cluster_main.py` 通过。
- `git diff --check -- deploy/cluster_main.py deploy/routers/video.py Agent.md` 通过。
- 源码扫描确认 `POST /api/video/crop` 只在 `deploy/routers/video.py` 中注册。
- 加载 `cluster_main.app` 后检查 `/api/video/crop` 注册数为 1。
- 使用 `httpx.ASGITransport` 进行 router 行为 mock 检查通过：
  - 模拟 FFmpeg 不存在时，`POST /api/video/crop` 返回 500，错误语义仍为“服务器未安装FFmpeg，无法进行视频剪辑”。
- 当前源码路由 decorator 宽口径扫描为 `311` 条；本轮为一进一出迁移，未引入重复注册。

### 本轮仍未处理或需后续观察
- `GET /api/proxy/comfyui/view`、`POST /api/comfyui/upload/video` 和 `POST /api/comfyui/reupload/video` 已由后续章节补齐迁移。
- 视频生成任务调度和 worker/Redis 契约未修改。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_video_router_20260618-064712`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 `/api/video/crop` 为单一注册。
  - 使用服务器 venv + `httpx.ASGITransport` 进行 video router mock：模拟 FFmpeg 不存在时，`/api/video/crop` 返回 500 且保留原错误语义。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - Video router 路由唯一性检查通过。
  - Video router 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 Video Router ComfyUI View 代理拆分增量记录

### 已修改内容
- `deploy/routers/video.py`
  - 将 `GET /api/proxy/comfyui/view` 从 `cluster_main.py` 迁入 `create_video_router()`。
  - 保留原有 query token / Bearer token 双入口鉴权逻辑。
  - 保留按 `node_id` 命中绑定 ComfyUI 节点的逻辑；未指定或未命中时继续使用可用节点或 `http://127.0.0.1:8188`。
  - 保留 `output` / `temp` / `input` 的 404 fallback 顺序。
  - 保留 `StreamingResponse` 文件流返回、`Content-Disposition` UTF-8 文件名和 `Accept-Ranges` header。
- `deploy/cluster_main.py`
  - `create_video_router()` 注入 `security`、`jwt_auth.verify_token`、`video_cluster_manager` getter 和 `cluster_manager` getter。
  - 删除旧的 `@app.get("/api/proxy/comfyui/view")` handler，避免重复注册。
  - `POST /api/comfyui/upload/video` 和 `POST /api/comfyui/reupload/video` 已由后续章节迁入 video router。

### 本地验证结果
- `python -m py_compile deploy/routers/video.py deploy/cluster_main.py` 通过。
- 加载 `cluster_main.app` 后检查：
  - `/api/video/crop` 注册数为 1。
  - `/api/proxy/comfyui/view` 注册数为 1。
- 使用项目 venv 直接调用 router endpoint 进行 mock 检查通过：
  - 模拟 FFmpeg 不存在时，`POST /api/video/crop` 仍返回 500 且错误包含 `FFmpeg`。
  - `GET /api/proxy/comfyui/view` 在 `output` 返回 404 时会 fallback 到 `temp`。
  - 成功响应保留 `video/mp4`、`inline; filename*=UTF-8''x.mp4` 和 `Accept-Ranges: bytes`。
  - 无效 token 返回 401。

### 本轮仍未处理或需后续观察
- ComfyUI 视频上传和重传路由仍在 `cluster_main.py`。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_video_view_router_20260618-065843`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 `/api/video/crop` 和 `/api/proxy/comfyui/view` 均为单一注册。
  - 使用服务器 venv 直接调用 video router endpoint mock：FFmpeg 缺失分支、ComfyUI `output` -> `temp` fallback、流式响应 header、无效 token 401 均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - Video router ComfyUI view 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 Video Router 上传/重传代理拆分增量记录

### 已修改内容
- `deploy/routers/video.py`
  - 将 `POST /api/comfyui/upload/video` 从 `cluster_main.py` 迁入 `create_video_router()`。
  - 将 `POST /api/comfyui/reupload/video` 从 `cluster_main.py` 迁入 `create_video_router()`。
  - 新增内部 `select_video_comfyui_server()` helper，统一处理指定 `comfyui_server`、视频集群节点和单机默认 `http://127.0.0.1:8188`。
  - 上传视频继续保留 ComfyUI `/upload/image` 转发、本地 `persistent_storage/videos` 备份、默认项目/版本创建、`FileDAO.create_file()` 入库和原返回字段。
  - 重传视频继续保留持久化存储优先读取、ComfyUI `file_type/temp/output/input` 轮询下载、UUID 新文件名和重新上传到 input 的逻辑。
- `deploy/cluster_main.py`
  - 删除旧的两个 video upload/reupload handler，避免重复注册。
  - `create_video_router()` 注册日志补充到 4 条视频路由。
  - 移除已不再使用的 `CropVideoRequest` 导入。

### 本地验证结果
- `python -m py_compile deploy/routers/video.py deploy/cluster_main.py` 通过。
- `git diff --check -- deploy/cluster_main.py deploy/routers/video.py Agent.md` 通过。
- 加载 `cluster_main.app` 后检查 4 条路由均为单一注册：
  - `/api/video/crop`
  - `/api/proxy/comfyui/view`
  - `/api/comfyui/upload/video`
  - `/api/comfyui/reupload/video`
- 使用项目 venv 直接调用 router endpoint mock 检查通过：
  - 上传视频会选择视频节点、转发到 `{server}/upload/image`、保留 `overwrite=true`、写入数据库记录并返回原结构。
  - 重传视频在 `output` 下载 404 时会 fallback 到 `temp`，随后重新上传并返回原结构。

### 本轮仍未处理或需后续观察
- 通用图片上传 `POST /api/comfyui/upload` 已由后续章节迁入 `routers/comfyui_files.py`。
- 音频上传 `POST /api/upload/audio` 已由后续章节迁入 video router。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_video_upload_router_20260618-070822`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 4 条 video router 路由均为单一注册。
  - 使用服务器 venv 直接调用 video router endpoint mock：上传视频节点选择、ComfyUI `/upload/image` 转发、数据库入库字段、重传视频 `output` -> `temp` fallback 和重新上传均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - Video upload/reupload router 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 Video Router 音频上传代理拆分增量记录

### 已修改内容
- `deploy/routers/video.py`
  - 将 `POST /api/upload/audio` 从 `cluster_main.py` 迁入 `create_video_router()`。
  - 复用 `select_video_comfyui_server()`，保持指定 `comfyui_server`、视频集群节点和单机默认节点逻辑一致。
  - 保留 ComfyUI `/upload/image` 转发、`overwrite=true`、音频本地 `persistent_storage/audio` 备份、`start_time` / `duration` 返回字段和原错误语义。
- `deploy/cluster_main.py`
  - 删除旧的 `@app.post("/api/upload/audio")` handler，避免重复注册。
  - `create_video_router()` 注册日志补充 `/api/upload/audio`。

### 本地验证结果
- `python -m py_compile deploy/routers/video.py deploy/cluster_main.py` 通过。
- 加载 `cluster_main.app` 后检查 5 条 video router 路由均为单一注册：
  - `/api/video/crop`
  - `/api/proxy/comfyui/view`
  - `/api/comfyui/upload/video`
  - `/api/upload/audio`
  - `/api/comfyui/reupload/video`
- 使用项目 venv 直接调用 router endpoint mock 检查通过：
  - 音频上传会选择视频节点、转发到 `{server}/upload/image`、保留 `overwrite=true`。
  - multipart 字段继续使用 ComfyUI 兼容的 `image` 字段，mime type 保持 `audio/mpeg`。
  - 本地备份写入被调用，返回结构保持 `success`、`filename`、`original_filename`、`size`、`server`、`start_time`、`duration`。

### 本轮仍未处理或需后续观察
- 通用图片上传 `POST /api/comfyui/upload` 已由后续章节迁入 `routers/comfyui_files.py`。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_audio_upload_router_20260618-071517`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 5 条 video router 路由均为单一注册。
  - 使用服务器 venv 直接调用 `/api/upload/audio` endpoint mock：视频节点选择、ComfyUI `/upload/image` 转发、音频 mime type、`overwrite=true`、本地备份写入和返回结构均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - Audio upload router 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 ComfyUI File Router 通用上传拆分增量记录

### 已修改内容
- 新增 `deploy/routers/comfyui_files.py`
  - 新增 `create_comfyui_files_router()` router factory。
  - 将 `POST /api/comfyui/upload` 从 `cluster_main.py` 迁入新 router。
  - 通过 getter 注入 default/image/video cluster manager 和 redis client，避免 router 反向 import `cluster_main.py`。
  - 保留本地 `persistent_storage/image` primary 持久化、可选 ComfyUI `/upload/image` 转发、SQL 文件记录、Redis `comfyui:file:{filename}` 映射和原返回字段。
- `deploy/cluster_main.py`
  - 注册 `create_comfyui_files_router()`。
  - 删除旧的 `@app.post("/api/comfyui/upload")` handler，避免重复注册。
  - 保留前端和现有工作流调用 URL 不变。

### 本地验证结果
- `python -m py_compile deploy/routers/comfyui_files.py deploy/routers/video.py deploy/cluster_main.py` 通过。
- 加载 `cluster_main.app` 后检查以下路由均为单一注册：
  - `/api/comfyui/upload`
  - `/api/video/crop`
  - `/api/proxy/comfyui/view`
  - `/api/comfyui/upload/video`
  - `/api/upload/audio`
  - `/api/comfyui/reupload/video`
- 使用项目 venv 直接调用 `/api/comfyui/upload` endpoint mock 检查通过：
  - `node_type=image` 会选择 image cluster 节点。
  - ComfyUI `/upload/image` 转发保留 `overwrite=true` 和 multipart `image` 字段。
  - SQL `FileDAO.create_file()` 写入 `file_url=/storage/image/...`、`metadata.source=comfyui_upload`、`comfyui_filename/server/node_id`。
  - Redis `comfyui:file:{filename}` 映射写入并设置 `ex=86400`。
  - 空文件返回 400 `上传的是空文件`。

### 本轮仍未处理或需后续观察
- `routers/video.py` 中仍包含视频/音频 ComfyUI 文件代理；后续可继续迁入 `routers/comfyui_files.py`，让 `routers/video.py` 只保留视频裁剪等视频处理路由。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_comfyui_files_router_20260618-072537`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/comfyui_files.py routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 `/api/comfyui/upload` 和 5 条 video router 路由均为单一注册。
  - 使用服务器 venv 直接调用 `/api/comfyui/upload` endpoint mock：image 节点选择、ComfyUI `/upload/image` 转发、SQL 入库字段、Redis 映射和空文件 400 均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - ComfyUI upload router 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 ComfyUI File Router View 代理归并增量记录

### 已修改内容
- `deploy/routers/comfyui_files.py`
  - 将 `GET /api/proxy/comfyui/view` 从 `routers/video.py` 迁入 `create_comfyui_files_router()`。
  - 新增 `security_dependency` 和 `verify_token` 注入，保留 query token / Bearer token 双入口鉴权。
  - 保留原有按 `node_id` 命中绑定节点、默认 cluster node fallback、`output/temp/input` 404 fallback、`StreamingResponse`、UTF-8 文件名和 `Accept-Ranges` header。
- `deploy/routers/video.py`
  - 删除 `GET /api/proxy/comfyui/view` handler。
  - 删除不再需要的 `security_dependency`、`verify_token`、`HTTPAuthorizationCredentials`、`StreamingResponse` 和 `quote` 依赖。
  - `create_video_router()` 现在只保留视频处理和视频/音频上传重传相关参数。
- `deploy/cluster_main.py`
  - `create_comfyui_files_router()` 注入 `security` 和 `jwt_auth.verify_token`。
  - `create_video_router()` 不再接收 view 代理的鉴权依赖。
  - 启动日志按真实职责拆分为 `Video API` 和 `ComfyUI File API`。

### 本地验证结果
- `python -m py_compile deploy/routers/comfyui_files.py deploy/routers/video.py deploy/cluster_main.py` 通过。
- 加载 `cluster_main.app` 后检查以下路由均为单一注册：
  - `/api/proxy/comfyui/view`
  - `/api/comfyui/upload`
  - `/api/video/crop`
  - `/api/comfyui/upload/video`
  - `/api/upload/audio`
  - `/api/comfyui/reupload/video`
- 使用项目 venv 直接调用 router endpoint mock 检查通过：
  - `/api/proxy/comfyui/view` 无效 token 返回 401。
  - `output` 返回 404 时会 fallback 到 `temp`。
  - 成功响应保留 `video/mp4`、`inline; filename*=UTF-8''x.mp4` 和 `Accept-Ranges: bytes`。
  - `/api/video/crop` 在 FFmpeg 缺失时仍返回 500 且错误包含 `FFmpeg`。

### 本轮仍未处理或需后续观察
- `POST /api/comfyui/upload/video`、`POST /api/upload/audio` 和 `POST /api/comfyui/reupload/video` 已由后续章节迁入 `routers/comfyui_files.py`。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_comfyui_view_router_20260618-073306`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/comfyui_files.py routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 `/api/proxy/comfyui/view`、`/api/comfyui/upload` 和 video router 路由均为单一注册。
  - 使用服务器 venv 直接调用 `/api/proxy/comfyui/view` endpoint mock：无效 token 401、`output` -> `temp` fallback、流式响应 header 均通过。
  - 同时验证 `/api/video/crop` FFmpeg 缺失分支仍返回 500 且错误包含 `FFmpeg`。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - ComfyUI view router 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 ComfyUI File Router 上传/重传归并增量记录

### 已修改内容
- `deploy/routers/comfyui_files.py`
  - 将 `POST /api/comfyui/upload/video` 从 `routers/video.py` 迁入 `create_comfyui_files_router()`。
  - 将 `POST /api/upload/audio` 从 `routers/video.py` 迁入 `create_comfyui_files_router()`。
  - 将 `POST /api/comfyui/reupload/video` 从 `routers/video.py` 迁入 `create_comfyui_files_router()`。
  - 新增 `select_video_comfyui_server()` helper，统一处理指定 `comfyui_server`、视频集群节点和单机默认节点。
  - 保留视频上传入库、音频本地备份、视频重传 `file_type/temp/output/input` fallback 和原返回结构。
- `deploy/routers/video.py`
  - 删除上述三个文件代理 handler。
  - 删除不再使用的 `File`、`Form`、`UploadFile` 和视频节点选择 helper。
  - 当前只保留 `POST /api/video/crop` 视频处理路由。
- `deploy/cluster_main.py`
  - 启动日志调整为 `Video API` 只注册 `/api/video/crop`。
  - `ComfyUI File API` 日志列出 `/api/comfyui/upload`、`/api/proxy/comfyui/view`、`/api/comfyui/upload/video`、`/api/upload/audio`、`/api/comfyui/reupload/video`。

### 本地验证结果
- `python -m py_compile deploy/routers/comfyui_files.py deploy/routers/video.py deploy/cluster_main.py` 通过。
- 加载 `cluster_main.app` 后检查以下路由均为单一注册：
  - `/api/video/crop`
  - `/api/proxy/comfyui/view`
  - `/api/comfyui/upload`
  - `/api/comfyui/upload/video`
  - `/api/upload/audio`
  - `/api/comfyui/reupload/video`
- 使用项目 venv 直接调用 router endpoint mock 检查通过：
  - 视频上传会选择视频节点、转发到 `{server}/upload/image`、保留 `overwrite=true`、写入数据库记录并返回原结构。
  - 音频上传会选择视频节点、保留 `audio/mpeg`、写入本地备份并返回原结构。
  - 视频重传在 `output` 下载 404 时 fallback 到 `temp`，随后重新上传并返回原结构。
  - `/api/video/crop` 在 FFmpeg 缺失时仍返回 500 且错误包含 `FFmpeg`。

### 本轮仍未处理或需后续观察
- `routers/video.py` 已基本收敛到视频处理；后续可继续拆 `cluster_main.py` 中其他视频生成/任务调度类路由，但需避开 worker、Redis 和 agent 红线。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_comfyui_file_proxy_20260618-074228`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/comfyui_files.py routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 6 条目标路由均为单一注册。
  - 使用服务器 venv 直接调用 router endpoint mock：视频上传、音频上传、视频重传 `output` -> `temp` fallback 和 `/api/video/crop` FFmpeg 缺失分支均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - ComfyUI file proxy consolidation 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 Files Router 通用上传拆分增量记录

### 已修改内容
- 新增 `deploy/routers/files.py`
  - 新增 `create_files_router()` router factory。
  - 将 `POST /api/upload` 从 `cluster_main.py` 迁入新 router。
  - 保留图片/视频类型判断、`SystemConfig.MAX_UPLOAD_SIZE` 限制、本地 `persistent_storage/{images|videos}` 写入、默认项目/版本创建、`FileDAO.create_file()` 入库和 DB 失败回滚物理文件逻辑。
  - 保留原返回字段：`success`、`file_id`、`filename`、`original_filename`、`storage_url`、`url`、`path`、`file_type`、`size`。
- `deploy/cluster_main.py`
  - 注册 `create_files_router()`。
  - 删除旧的 `@app.post("/api/upload")` handler，避免重复注册。
  - 删除已不再使用的 `File`、`UploadFile`、`Form` 顶层导入。

### 本地验证结果
- `python -m py_compile deploy/routers/files.py deploy/routers/comfyui_files.py deploy/routers/video.py deploy/cluster_main.py` 通过。
- 加载 `cluster_main.app` 后检查以下路由均为单一注册：
  - `/api/upload`
  - `/api/video/crop`
  - `/api/comfyui/upload`
- 使用项目 venv 直接调用 `/api/upload` endpoint mock 检查通过：
  - 图片上传会写入本地路径、创建/使用默认 version、调用 `FileDAO.create_file()` 并返回原结构。
  - 不支持的 `text/plain` 文件会返回 400 `不支持的文件类型`。

### 本轮仍未处理或需后续观察
- `cluster_main.py` 仍保留任务、工作区、项目、生成和旧 admin 路由；后续建议继续按低耦合优先迁移。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_files_router_20260618-075045`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/files.py routers/comfyui_files.py routers/video.py cluster_main.py`
  - 加载 `cluster_main.app` 检查 `/api/upload`、`/api/video/crop`、`/api/comfyui/upload` 均为单一注册。
  - 使用服务器 venv 直接调用 `/api/upload` endpoint mock：图片上传入库字段和不支持类型 400 均通过。
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - Files router 行为 mock 检查通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 声音克隆功能修复记录

### 问题判断
- 线上日志中有 MiniMax TTS 和 voice-design 成功记录，但没有真实的 `/api/minimax/files/upload` 或 `/api/minimax/voice-clone` 请求记录。
- 前端 `VoiceSidebar` 的 clone 模式原逻辑是：点击“试听”只提示“先选择并保存克隆音频”，真正上传和克隆藏在“保存配置”里；这会让用户在测试声音克隆时感觉功能不可用。
- 后端 MiniMax 路由会把 `_require_minimax_client()` 抛出的 `HTTPException` 包进普通 500，导致 key 缺失或上游错误在前端表现不清楚。

### 已修改内容
- `deploy/new_html/components/audio/VoiceSidebar.tsx`
  - clone 模式新增 `generateClonePreview()`：选择音频后点击“生成试听”会先调用 `/api/minimax/files/upload`，再调用 `/api/minimax/voice-clone`。
  - 克隆成功后把 `voice_id`、`file_id`、试听音频 URL 暂存在 `cloneDraft`，保存配置时直接复用本次克隆结果，避免重复上传和重复克隆。
  - 切换/重新选择克隆音频时清空旧预览，避免用户看到旧音频误判。
  - 文件选择限制为 MiniMax 支持的 `mp3/m4a/wav`。
  - 试听和保存按钮互斥 loading，防止并发提交。
- `deploy/new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx`
  - 新增 clone 分支测试：选择音频后点击“生成试听”必须调用 `minimaxFileUpload()` 和 `minimaxVoiceClone()`，并把返回音频放进 `<audio>`。
- `deploy/api_routes.py`
  - `_require_minimax_client()` 在检查 key 前刷新 resolver，兼容后台热更新后的 env 注入。
  - `voice-design`、`voice-clone`、`files/upload` 保留 `HTTPException` 原状态码，不再误包装成 500。
  - `voice-clone` 和上传上游异常返回 502，前端能看到更准确的上游失败原因。
  - `/api/minimax/files/upload` 增加格式和大小早期校验：仅支持 `mp3/m4a/wav`，不超过 20MB。
  - 上传到 MiniMax 的临时音频无论成功或失败都会清理。

### 本地验证结果
- `python -m py_compile deploy/api_routes.py deploy/external_api/audio/minimax_audio.py` 通过。
- `git diff --check -- deploy/api_routes.py deploy/new_html/components/audio/VoiceSidebar.tsx deploy/new_html/__tests__/components/VoiceSidebar.handlePreview.test.tsx Agent.md` 通过。
- 本地 `vite build` / `vitest` 未能执行完成，原因是本机 `deploy/new_html/node_modules` 缺少 Rollup Windows 可选原生包 `@rollup/rollup-win32-x64-msvc`；需在服务器 Linux Node 环境继续验证。
- `tsc --noEmit` 仍有项目既有类型错误，但没有指向本次修改的 `VoiceSidebar.tsx`。

### 本轮仍未处理或需后续观察
- 未修改 MiniMax API key 配置本身；当前线上 TTS 和 voice-design 已可调用，说明运行中的 uvicorn 进程能从 DB/env 拿到 MiniMax 配置。
- 声音克隆仍依赖 MiniMax 官方限制：上传音频格式 `mp3/m4a/wav`，时长 10 秒到 5 分钟，大小不超过 20MB。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器：`drama-project`，zone `asia-east2-c`，project `drama-project-499403`。
- 服务器备份目录：`/home/Administrator/deploy_backups/mecha_voice_clone_fix_20260618-080947`。
- 已在服务器执行：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile api_routes.py external_api/audio/minimax_audio.py cluster_main.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
  - `npx vitest run __tests__/components/VoiceSidebar.handlePreview.test.tsx __tests__/services/minimaxTTSSync.test.ts`
  - `sudo systemctl restart drama`
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
- 结果：
  - Python 编译通过。
  - Vite production build 通过。
  - 目标 Vitest：`2` 个测试文件、`6` 个测试全部通过。
  - `drama` 服务状态：`active`。
  - 线上 smoke：`9/9` 通过。

## 2026-06-18 Files Router Thumbnail 拆分增量记录

### 已修改内容
- `deploy/routers/files.py`
  - 将 `GET /api/thumbnail` 从 `cluster_main.py` 迁入 `create_files_router()`。
  - 保留原鉴权兼容：支持 `Authorization: Bearer ...` 和 query `token` 两种方式。
  - 保留原 URL 解析分支：
    - `/uploads/...` -> `temp/uploads/...`
    - `/storage/...` -> 注入的 `storage_path_safe()`
    - `/api/files/{file_id}/download` -> `FileDAO.get_file(file_id)` 查询数据库文件路径
  - 保留 PIL 缩略图逻辑：RGBA/P 转 RGB，按 `width/height` 等比压缩，输出 JPEG。
  - 保留响应头：`Cache-Control: public, max-age=86400`、`Content-Disposition: inline`。
- `deploy/cluster_main.py`
  - `create_files_router()` 注册时注入 `security`、`jwt_auth.verify_token`、`_storage_path_safe`、`db_manager`。
  - 删除旧 `@app.get("/api/thumbnail")` handler，避免重复注册。
  - File API 注册日志更新为 `/api/upload, /api/thumbnail`。

### 本地验证结果
- `python -m py_compile deploy/routers/files.py deploy/routers/comfyui_files.py deploy/routers/video.py deploy/cluster_main.py` 通过。
- `git diff --check -- deploy/cluster_main.py deploy/routers/files.py Agent.md` 通过。
- 使用项目 venv 直接调用 `/api/thumbnail` endpoint mock 检查通过：
  - `/storage/...` 分支返回 `image/jpeg`，body 为 JPEG，缓存和 inline header 保留。
  - `/api/files/{file_id}/download` 分支通过 mock `FileDAO.get_file()` 返回 JPEG。
  - 无效 token 返回 401。
  - 缺失文件返回 404。
- 加载 `cluster_main.app` 后检查以下路由均为单一注册：
  - `/api/thumbnail`
  - `/api/upload`
  - `/api/comfyui/upload`

### 本轮仍未处理或需后续观察
- `GET /api/thumbnail` 仍然是请求时动态生成缩略图；后续如需进一步减轻图片列表负载，可增加磁盘/对象存储缩略图缓存层。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`，部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_thumbnail_router_20260618-081916`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile cluster_main.py routers/files.py routers/comfyui_files.py routers/video.py`
  - 直接调用 `/api/thumbnail` endpoint mock：`/storage/...`、`/api/files/{file_id}/download`、无效 token、缺失文件、路由单一注册检查均通过。
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。

## 2026-06-18 Thumbnail Cache 加速增量记录

### 已修改内容
- `deploy/routers/files.py`
  - 在 `GET /api/thumbnail` 中新增磁盘缓存层。
  - 缓存 key 由源文件绝对路径、源文件 `mtime_ns`、文件大小、请求的 `width/height` 共同生成，源图变更或缩略尺寸变化会自动生成新缓存。
  - 未命中时仍使用原 PIL 逻辑生成 JPEG，并通过临时文件 + `os.replace()` 原子写入 `temp/thumbnail_cache/*.jpg`。
  - 命中时直接返回 `FileResponse`，避免重复打开源图和重复执行 PIL 缩放。
  - 保留原鉴权、URL 解析、404/401 行为与响应头：`Cache-Control: public, max-age=86400`、`Content-Disposition: inline`。

### 本地验证结果
- `python -m py_compile deploy/routers/files.py` 通过。
- 使用项目 venv 直接调用 `/api/thumbnail` endpoint mock 检查通过：
  - 第一次请求生成并写入 1 个 `.jpg` 缓存文件。
  - 第二次相同源图与尺寸请求命中同一缓存文件，文件 `mtime` 不变化。
  - 返回仍为 `image/jpeg`，缓存和 inline header 保留。
  - 无效 token 返回 401。
  - 缺失文件返回 404。
- `external_api/` 静态扫描未发现任何 `@app.*` 或 `@router.*` FastAPI 路由装饰器；`/api/video/crop` 只在 `deploy/routers/video.py` 注册，`cluster_main.py` 仅负责 `include_router(create_video_router(...))`。
- 加载 `cluster_main.app` 后 OpenAPI 数量检查通过：
  - `len(openapi["paths"]) == 225`
  - HTTP operation 数量为 `281`
  - `/api/video/crop`、`/api/thumbnail`、`/api/upload`、`/api/comfyui/upload` 均为单一注册。

### 本轮仍未处理或需后续观察
- 当前缓存目录为 `temp/thumbnail_cache`，未增加后台清理策略；后续如缩略图数量很大，可增加按 mtime/总大小的清理任务。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`，部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_thumbnail_cache_20260618-103349`
- 服务器验证通过：
  - `external_api/` 静态扫描未发现 FastAPI route decorator 残留。
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile routers/files.py routers/comfyui_files.py routers/video.py cluster_main.py`
  - 直接调用 `/api/thumbnail` endpoint mock：首次生成缓存、二次命中同一缓存、401、404、header 保留均通过。
  - 加载 `cluster_main.app` 后 OpenAPI 检查：`paths=225`、HTTP operations=`281`，且 `/api/video/crop`、`/api/thumbnail`、`/api/upload`、`/api/comfyui/upload` 均为单一注册。
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - 线上 `https://mecha.one/openapi.json` 检查：`paths=225`、HTTP operations=`281`。

## 2026-06-18 Route Contract Checker 增量记录

### 已修改内容
- 新增 `deploy/scripts/check_route_contract.py`
  - 导入 `cluster_main.app`，不启动 uvicorn。
  - 检查 OpenAPI 公开面：
    - `len(openapi["paths"]) == 225`
    - HTTP operation 数量为 `281`
  - 扫描运行时重复路由注册，当前只允许已知高耦合遗留项：
    - `GET /api/projects/{project_id}`：`cluster_main.get_project` 与 `api_routes.get_project_detail` 双模型并存，按项目接口重构计划后置处理。
  - 检查已拆分接口的 endpoint 归属：
    - `/api/video/crop` -> `routers.video.crop_video`
    - `/api/thumbnail`、`/api/upload` -> `routers.files`
    - `/api/comfyui/upload` -> `routers.comfyui_files`
    - `/api/admin/users`、`/api/admin/users/{user_id}/permissions` -> `admin_routes`

### 本地验证结果
- `python -m py_compile deploy/scripts/check_route_contract.py deploy/cluster_main.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py --show-routes` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - 当前唯一允许重复为 `GET /api/projects/{project_id}`。
  - 目标 router endpoint 归属检查全部通过。

### 本轮仍未处理或需后续观察
- `GET /api/projects/{project_id}` 的 V1/V2 双模型重复仍保留，属于高耦合项目接口，后续需要专门设计迁移。
- 本轮未修改运行时业务逻辑，未重启本地服务，未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy/scripts/check_route_contract.py`，部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_route_contract_checker_20260618-104459`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py --show-routes`
  - 检查结果：`openapi_paths=225`、`openapi_operations=281`。
  - 当前唯一允许重复：`GET /api/projects/{project_id}`。
  - 已拆分 endpoint 归属检查全部通过。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - 线上 `https://mecha.one/openapi.json` 检查：`paths=225`、HTTP operations=`281`。

## 2026-06-18 Thumbnail Cache Cleanup 增量记录

### 已修改内容
- `deploy/routers/files.py`
  - 新增 `cleanup_thumbnail_cache()`，负责清理 `temp/thumbnail_cache`。
  - 默认保留 7 天内缓存，默认总量上限 2GB。
  - 支持环境变量调整：
    - `THUMBNAIL_CACHE_MAX_AGE_SECONDS`
    - `THUMBNAIL_CACHE_MAX_BYTES`
  - 清理策略：
    - 删除过期 `.jpg` 缓存。
    - 删除超过 1 小时的 `.tmp` 残留文件。
    - 总量超过上限时按最旧 mtime 继续裁剪。
  - `GET /api/thumbnail` 仍使用原缓存 key 和响应行为。
- `deploy/cluster_main.py`
  - 在 lifespan 中新增 `thumbnail_cache_cleaner()` 后台任务。
  - 启动后延迟 10 分钟首次执行，之后每 24 小时执行一次。
  - 仅记录清理结果，不影响请求路径或路由注册。

### 本地验证结果
- `python -m py_compile deploy/routers/files.py deploy/cluster_main.py` 通过。
- `cleanup_thumbnail_cache()` 行为 mock 通过：
  - 过期 `.jpg` 被删除。
  - 超过 1 小时的 `.tmp` 被删除。
  - 未过期 `.jpg` 和较新的 `.tmp` 保留。
  - 总量超过 `max_bytes` 时按最旧文件裁剪。
- `/api/thumbnail` endpoint mock 通过：
  - 首次请求生成缓存。
  - 二次相同请求命中同一缓存文件且 mtime 不变化。
  - 无效 token 返回 401。
  - 缺失文件返回 404。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - 当前唯一允许重复为 `GET /api/projects/{project_id}`。

### 本轮仍未处理或需后续观察
- 缩略图缓存清理以本地磁盘为目标；如果未来迁移到对象存储，需要把清理策略迁移到对象存储生命周期规则。
- 本轮未修改公开 API、worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`，部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_thumbnail_cache_cleanup_20260618-104948`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile cluster_main.py routers/files.py scripts/check_route_contract.py`
  - `cleanup_thumbnail_cache()` 行为 mock：过期 `.jpg`、过期 `.tmp`、总量裁剪均通过。
  - `/api/thumbnail` endpoint mock：首次生成缓存、二次命中同一缓存、401、404、header 保留均通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py` 通过：`paths=225`、HTTP operations=`281`。
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - 线上 `https://mecha.one/openapi.json` 检查：`paths=225`、HTTP operations=`281`。

## 2026-06-18 Task Stale Reaper 后台调度增量记录

### 已修改内容
- `deploy/cluster_main.py`
  - 新增 `task_stale_reaper_settings()` 和 `run_task_stale_reaper_once()`。
  - 在 lifespan 中新增 `task_stale_reaper()` 后台任务。
  - 默认启用，调用现有 `TaskDAO.cleanup_stale(hours)`，将超时的 `pending/queued/processing` 任务标记为 `failed`。
  - 默认配置：
    - `TASK_STALE_REAPER_ENABLED=true`
    - `TASK_STALE_REAPER_HOURS=24`
    - `TASK_STALE_REAPER_INITIAL_DELAY_SECONDS=900`
    - `TASK_STALE_REAPER_INTERVAL_SECONDS=3600`
  - 保留 admin 手工入口 `/api/admin/tasks/cleanup` 不变。

### 本地验证结果
- `python -m py_compile deploy/cluster_main.py deploy/scripts/check_route_contract.py` 通过。
- 使用 mock cleanup 函数直接验证：
  - 默认配置为启用、24 小时阈值、900 秒首延迟、3600 秒周期。
  - `TASK_STALE_REAPER_HOURS=5` 时传入 cleanup 的阈值为 5。
  - `TASK_STALE_REAPER_ENABLED=false` 时不调用 cleanup。
  - `hours/initial_delay/interval` 均有最小值保护，避免配置为 0 或过短导致误清理/高频循环。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - 当前唯一允许重复为 `GET /api/projects/{project_id}`。

### 本轮仍未处理或需后续观察
- 本轮只增加已有 DAO 清理方法的后台调度，不改变 `TaskDAO.cleanup_stale()` SQL。
- 仍未处理审计文档中的第二项：`core/task_queue.py` dequeue 对 api_call JSON member 的防御；该项涉及 Redis 队列契约，需单独谨慎处理。
- 本轮未修改公开 API、worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`，部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_task_stale_reaper_20260618-105612`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile cluster_main.py scripts/check_route_contract.py`
  - `task_stale_reaper_settings()` 和 `run_task_stale_reaper_once()` mock：默认配置、`TASK_STALE_REAPER_HOURS=5`、禁用开关、最小值保护均通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py` 通过：`paths=225`、HTTP operations=`281`。
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - 线上 `https://mecha.one/openapi.json` 检查：`paths=225`、HTTP operations=`281`。

## 2026-06-18 Provider Contract Checker 增量记录

### 已修改内容
- 新增 `deploy/scripts/check_provider_contract.py`
  - 检查 `services/api_provider_registry.py` 的 provider catalog、env map、preset 是否一致。
  - 在隔离的 managed env 下调用 `resolve_provider()`，确认默认 endpoint、model、provider 能从 preset 正确解析。
  - 扫描代码中 `resolve_provider("...")` 的字面量 provider 引用，确认都存在于 registry。
  - 检查 endpoint/proxy/custom proxy 派生 env key 不重复。

### 本地验证结果
- `python -m py_compile deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `derived_env_keys=36`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - 当前唯一允许重复为 `GET /api/projects/{project_id}`。

### 本轮仍未处理或需后续观察
- 本轮只新增 provider 注册表/解析器契约检查脚本，不改运行时 API 调用路径。
- `SEEDANCE_MODEL_STANDARD` / `SEEDANCE_MODEL_FAST` 等模型名 override 仍是 env 配置，后续可考虑纳入后台标准模型配置。
- 本轮未修改公开 API、worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy/scripts/check_provider_contract.py`，部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_provider_contract_checker_20260618-110145`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`：
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `derived_env_keys=36`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py` 通过：`paths=225`、HTTP operations=`281`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - 线上 `https://mecha.one/openapi.json` 检查：`paths=225`、HTTP operations=`281`。

## 2026-06-18 Admin Users 路由去重增量记录

### 已修改内容
- `deploy/cluster_main.py`
  - 取消旧版 `get_admin_users()` 的 `@app.get("/api/admin/users")` 装饰器。
  - 取消旧版 `update_user_permissions()` 的 `@app.put("/api/admin/users/{user_id}/permissions")` 装饰器。
  - 两个函数体暂时保留并标注为 legacy reference，避免一次性删除大段旧逻辑导致审计困难。
- 当前实际生效的接口统一由 `deploy/admin_routes.py` 提供：
  - `GET /api/admin/users` -> `admin_routes.admin_list_users`
  - `PUT /api/admin/users/{user_id}/permissions` -> `admin_routes.admin_update_permissions`

### 本地验证结果
- `python -m py_compile deploy/cluster_main.py deploy/admin_routes.py` 通过。
- 加载 `cluster_main.app` 后 OpenAPI 数量保持不变：
  - `len(openapi["paths"]) == 225`
  - HTTP operation 数量为 `281`
- 运行时路由检查通过：
  - `GET /api/admin/users` 仅注册 1 次，endpoint 为 `admin_routes.admin_list_users`。
  - `PUT /api/admin/users/{user_id}/permissions` 仅注册 1 次，endpoint 为 `admin_routes.admin_update_permissions`。

### 本轮仍未处理或需后续观察
- `cluster_main.py` 中仍保留未注册的 legacy admin user 函数体；后续确认无人引用后可彻底删除。
- `POST /api/admin/users/create` 和 `DELETE /api/admin/users/{user_id}` 仍是旧路径兼容入口，本轮未迁移。
- `GET /api/projects/{project_id}` 仍存在 V1/V2 双模型重复，属于高耦合项目接口，按计划后置处理。
- 本轮未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`，部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_admin_route_dedupe_20260618-104002`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile cluster_main.py admin_routes.py`
  - 加载 `cluster_main.app` 后 OpenAPI 检查：`paths=225`、HTTP operations=`281`。
  - 运行时路由检查：`GET /api/admin/users` 和 `PUT /api/admin/users/{user_id}/permissions` 均只注册 1 次，endpoint 均来自 `admin_routes.py`。
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - 线上 `https://mecha.one/openapi.json` 检查：`paths=225`、HTTP operations=`281`。
## 2026-06-18 Video Router Ownership Recheck

### Checked items
- Rechecked local route ownership for `/api/video/crop`.
- Rechecked production route ownership on `/home/Administrator/deploy`.
- Confirmed `external_api/` only contains external provider/client modules and does not register FastAPI routes.
- Confirmed the effective video crop route is `routers.video.crop_video`, not a legacy `cluster_main.py` handler.

### Local verification
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py --show-routes` passed.
- Local OpenAPI contract remained unchanged:
  - `openapi_paths=225`
  - `openapi_operations=281`
- Expected endpoint check:
  - `POST /api/video/crop -> routers.video.crop_video`
- Local readonly scan found `/api/video/crop` only in `deploy/routers/video.py` plus the registration log line in `deploy/cluster_main.py`.

### Production verification
- `/home/Administrator/deploy/.venv/bin/python scripts/check_route_contract.py --show-routes` passed on the server.
- Production OpenAPI contract remained unchanged:
  - `openapi_paths=225`
  - `openapi_operations=281`
- Public `https://mecha.one/openapi.json` check:
  - `openapi_paths=225`
  - `openapi_operations=281`
  - `/api/video/crop` exposes `POST`.
- Production readonly scan found `/api/video/crop` only in `routers/video.py` plus the registration log line in `cluster_main.py`.

### Deployment note
- No runtime code change was needed in this pass because production already matched the local route contract.
- No service restart was performed.
- Only this documentation entry needs to be synced to the server.
## 2026-06-18 API Runtime Status Admin Increment

### 已修改内容
- `deploy/services/api_provider_runtime.py`
  - 新增 `build_provider_runtime_status()`。
  - 基于现有 `resolve_provider(provider, model)` 逐个 preset 计算运行时实际解析结果。
  - 返回 provider、model、category、endpoint、endpoint_source、api_key_env/api_key_source、proxy_mode、custom_proxy_configured、health_check_url、status/issues 等脱敏字段。
  - 不返回 API key 明文，不返回 custom proxy 明文。
- `deploy/admin_routes.py`
  - `GET /api/admin/api-configs` 响应新增 `runtime_status`。
  - 不新增路由，不改变现有 `api_configs/providers/provider_status` 字段。
- `deploy/admin/app.js`
  - 旧后台 API 密钥页读取 `runtime_status`。
  - 顶部摘要新增 runtime ready 计数。
  - 每张 API 卡新增 runtime badge，并展示实际 key source、endpoint source、endpoint、proxy mode。
- `deploy/scripts/check_provider_contract.py`
  - 新增 runtime status 契约检查。
  - 校验 preset 数量、runtime rows 数量、env override 来源识别、custom proxy configured 标记。
  - 校验假 API key 和假 proxy 明文不会出现在 runtime JSON 中。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_provider_runtime.py deploy/services/api_provider_registry.py deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。
- mock 直接调用 `admin_list_api_configs()` 通过：
  - 响应包含 `runtime_status`
  - `runtime_rows=17`
  - 假密钥 `SECRET_ADMIN_RESPONSE_KEY_SHOULD_NOT_LEAK` 未泄露
  - `gemini-text` runtime endpoint override 识别为 `GEMINI_TEXT_ENDPOINT`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_runtime_status_20260618-1918`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_provider_runtime.py scripts/check_provider_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
  - `node --check /home/Administrator/deploy/admin/app.js`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后请求 `GET https://mecha.one/api/admin/api-configs`：
    - `runtime_status_rows=17`
    - `runtime_ready=15`
    - `has_api_key_field=false`
    - `has_custom_proxy_value=false`

### 本轮仍未处理或需后续观察
- 本轮只增强现有后台 API 配置页的运行时可见性，还没有新建完整独立的新版 API 管理平台页面。
- `GET /api/projects/{project_id}` 的 V1/V2 双模型重复仍按计划后置。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。
## 2026-06-18 API Effective DB Source Increment

### 已修改内容
- `deploy/services/api_provider_runtime.py`
  - 新增 `build_effective_provider_config_sources(configs)`。
  - 按 `load_api_configs_to_env()` 的现有行为镜像判断：同 provider 的多条 enabled 且 keyed 配置共享一个 env key，列表顺序中最后一条会覆盖前面的配置。
  - 返回脱敏的 effective DB 来源：`config_id/name/model_name/endpoint/proxy_mode/category`，不返回明文 key，也不返回 `api_key_encrypted`。
  - `_config_get()` 同时支持 dict、asyncpg.Record 风格的 `__getitem__`、对象属性读取。
  - `build_provider_runtime_status(configs=None)` 支持接收 DB rows，并新增字段：
    - `runtime_source`
    - `db_effective_config_id`
    - `db_effective_config_name`
    - `db_effective_model_name`
    - `db_keyed_enabled_config_count`
    - `db_enabled_endpoint_count`
    - `db_candidate_config_ids`
  - 当同 provider 存在多条 enabled keyed 配置时，`issues` 增加 `db_multiple_keyed_enabled_configs`；endpoint 不同时增加 `db_endpoint_conflict`。
- `deploy/admin_routes.py`
  - `GET /api/admin/api-configs` 现在调用 `build_provider_runtime_status(rows)`，把当前 DB 配置来源并入 runtime status。
- `deploy/admin/app.js`
  - 旧后台 API 卡片 runtime 行新增 `source` 与 `db config` 展示。
  - 当一个 provider 有多条 keyed enabled 配置时，卡片会显示 `(+N)` 和 issues，便于定位覆盖冲突。
- `deploy/scripts/check_provider_contract.py`
  - 新增 effective DB source 契约检查。
  - 用两条同 provider 的 asyncpg.Record-like 假配置验证最后一条 `apicfg_new` 是生效来源。
  - 校验明文 fake key、custom proxy、`api_key_encrypted` 均不会泄露到 runtime status JSON。
- `deploy/services/api_provider_registry.py`
  - 同步加固 `_config_get()`，避免 `provider_status` 在 asyncpg.Record 行上读不到字段。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_provider_runtime.py deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。
- mock 直接调用 `admin_list_api_configs()` 通过：
  - `runtime_rows=17`
  - `db_effective_config_id=apicfg_new`
  - `db_keyed_enabled_config_count=2`
  - `runtime_source=db`
  - `has_conflict_issue=True`
  - `plain_secret_leaked=False`
  - `encrypted_secret_leaked=False`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_effective_source_20260618-1926`
  - `/home/Administrator/deploy_backups/mecha_api_effective_source_asyncpg_fix_20260618-1930`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_provider_runtime.py services/api_provider_registry.py scripts/check_provider_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
  - `node --check /home/Administrator/deploy/admin/app.js`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后请求 `GET https://mecha.one/api/admin/api-configs`：
    - `runtime_status_rows=17`
    - `runtime_ready=15`
    - `has_db_effective_field=True`
    - `db_sourced_rows=0`
    - `rows_with_db_config=0`
    - `api_key_field=false`
    - `api_key_encrypted_field=false`
- 线上现状确认：
  - `api_configs=2`
  - `masked_key_configs=0`
  - `enabled_configs=0`
  - 这说明当前生产可用 runtime key 仍来自 systemd/env 注入；DB `api_configurations` 里只有 2 条禁用占位配置，后台 DB 尚未接管生产 key。

### 本轮仍未处理或需后续观察
- 本轮只显式暴露“现有覆盖行为”的来源，没有改变覆盖规则；后续可以再加“每 provider 只允许一个 active config”的强约束或后台冲突修复按钮。
- 线上当前 `db_sourced_rows=0`，后续正式切到后台配置平台时，需要把 systemd/env 中的 key 迁移/录入 DB，或明确保留 env 为生产一级来源。
- 仍未新建完整新版 API 管理页面。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。
## 2026-06-18 Runtime Env Key Import Increment

### 已修改内容
- `deploy/admin_routes.py`
  - `POST /api/admin/api-configs/import-presets` 复用原路由，新增可选请求体 `ApiConfigImportPresetsBody`，不新增路由。
  - 默认 `copy_runtime_env_keys=false`，普通“导入预置模型”仍只导入预置行，不复制任何运行时密钥。
  - 当管理员显式传入 `copy_runtime_env_keys=true` 时：
    - 使用 `resolve_provider(provider, model)` 读取当前运行时已生效的 env key / endpoint / proxy mode。
    - 对缺 key 的既有 DB 配置写入密钥并可自动启用。
    - 对缺失的 preset 创建 DB 配置，若运行时存在 key 则加密写入。
    - 写入/更新后调用 `_reload_api_env()`，无需重启即可刷新进程内配置。
  - 响应新增计数：`env_keys_imported`、`env_keys_missing`、`env_keys_existing`、`updated_existing`、`enabled_existing`。
- `deploy/admin/index.html`
  - API 密钥页新增独立按钮“导入运行时 Key”。
- `deploy/admin/app.js`
  - 新增 `importRuntimeEnvKeys()`。
  - 点击前二次确认，只在确认后调用 `copy_runtime_env_keys=true`。
  - toast 展示新增、更新、写入 key、缺失 key 数量。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_provider_runtime.py deploy/services/api_provider_registry.py deploy/scripts/check_provider_contract.py` 通过。
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
- mock 调用 `admin_import_preset_configs()` 通过：
  - 普通导入：`plain_copy_runtime=False`、`plain_updates=0`、`plain_env_keys_imported=0`
  - 显式 env 导入：`copy_runtime=True`、`updated_existing=1`、`enabled_existing=1`、`env_keys_imported=1`
  - 既有占位配置被启用并刷新 endpoint：`target_enabled=True`、`target_endpoint=https://env-db.example.test/v1`
  - `_reload_api_env()` 被调用：`reload_calls=1`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_runtime_env_key_import_20260618-1940`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_provider_runtime.py services/api_provider_registry.py scripts/check_provider_contract.py`
  - `node --check /home/Administrator/deploy/admin/app.js`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后请求 `GET https://mecha.one/api/admin/api-configs`：
    - `runtime_status_rows=17`
    - `configs=2`
- 注意：本轮部署没有在生产上触发 `copy_runtime_env_keys=true`，因此没有把线上 systemd/env key 写入 DB；该动作必须由管理员在后台点击“导入运行时 Key”显式执行。

### 本轮仍未处理或需后续观察
- 本轮新增的是安全迁移入口，尚未在生产上实际点击执行迁移；线上 key 仍保留在 systemd/env，除非管理员在后台点击“导入运行时 Key”。
- 如果迁移后希望完全由 DB 接管，需要再决定是否从 systemd override 中移除对应 key，避免双来源长期并存。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。
## 2026-06-18 Provider-Scoped Runtime Key Import Increment

### 已修改内容
- `deploy/admin_routes.py`
  - 调整 `copy_runtime_env_keys=true` 的导入策略。
  - 同一个 provider 只允许导入/复用一个 enabled keyed DB 来源，避免多 preset provider（如 DashScope、Gemini Image）为每个模型都写入同一个 key，导致 `load_api_configs_to_env()` 反复覆盖同一个 env key。
  - 新增响应计数 `env_keys_skipped_provider_claimed`，表示该 provider 已有 key 来源，因此其它 preset 跳过重复写 key。
  - 普通预设导入仍保持 `copy_runtime_env_keys=false`，不复制任何密钥。
- `deploy/admin/app.js`
  - “导入运行时 Key” toast 新增“已有/复用”和“跳过重复”计数。
- `deploy/scripts/check_admin_api_config_import.py`
  - 新增无真实 DB 的契约检查脚本。
  - 覆盖三类导入行为：
    - 普通导入不复制 key。
    - DashScope 多 preset 只创建 1 条 keyed row，其它 preset 跳过 provider 重复 key。
    - 既有空 key 且禁用的占位配置会被显式 env 导入更新、启用并刷新 endpoint。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/scripts/check_admin_api_config_import.py deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过：
  - `plain_import_copies_keys=0`
  - `dashscope_keyed_rows=1`
  - `existing_empty_key_update=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_provider_scoped_env_import_20260618-1947`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py scripts/check_admin_api_config_import.py scripts/check_provider_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py`
    - `plain_import_copies_keys=0`
    - `dashscope_keyed_rows=1`
    - `existing_empty_key_update=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
  - `node --check /home/Administrator/deploy/admin/app.js`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后请求 `GET https://mecha.one/api/admin/api-configs`：
    - `runtime_status_rows=17`
    - `configs=2`
- 注意：本轮仍未触发生产 `copy_runtime_env_keys=true`，不会自动把 systemd/env key 写入 DB。

### 本轮仍未处理或需后续观察
- 本轮只改“显式导入运行时 Key”时的 DB 写入策略；生产环境仍不会自动迁移 key。
- 后续可以继续加一个后台“冲突修复”动作：保留当前 effective config，自动禁用同 provider 其它 keyed enabled rows。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。
## 2026-06-18 Runtime Key Import Dry-Run Preview Increment

### 已修改内容
- `deploy/admin_routes.py`
  - `ApiConfigImportPresetsBody` 新增 `dry_run`。
  - `POST /api/admin/api-configs/import-presets` 在 `dry_run=true` 时只计算导入计划，不写 DB、不调用 `_reload_api_env()`。
  - 响应新增 `dry_run` 和 `planned_actions`，用于后台预览将新增、更新、跳过或缺失的配置；不包含明文 key 或加密 key。
- `deploy/admin/app.js`
  - “导入运行时 Key”现在会先调用 `dry_run=true` 预览。
  - 弹窗展示新增、更新、写入 key、已有/复用、跳过重复 provider、缺失 key 数量。
  - 用户二次确认后才执行真实写入。
- `deploy/scripts/check_admin_api_config_import.py`
  - 增加 dry-run 契约检查：
    - dry-run 响应必须标记 `dry_run=true`。
    - dry-run 能计算出可导入 key。
    - dry-run 不应 mutate fake DB。
    - dry-run 不应触发 `_reload_api_env()`。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/scripts/check_admin_api_config_import.py deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过：
  - `plain_import_copies_keys=0`
  - `dashscope_keyed_rows=1`
  - `existing_empty_key_update=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_runtime_key_import_dryrun_20260618-1955`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py scripts/check_admin_api_config_import.py scripts/check_provider_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py`
    - `plain_import_copies_keys=0`
    - `dashscope_keyed_rows=1`
    - `existing_empty_key_update=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
  - `node --check /home/Administrator/deploy/admin/app.js`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后请求 `GET https://mecha.one/api/admin/api-configs`：
    - `runtime_status_rows=17`
    - `configs=2`
- 注意：本轮只增加 dry-run 预览和二次确认，未执行真实 key 导入。

### 本轮仍未处理或需后续观察
- 本轮只增加导入预览和二次确认，仍未在生产上实际迁移 key。
- 后续如果正式执行迁移，建议先截图/记录 dry-run 预览结果，再执行真实导入。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 API Architecture Contract Guard Increment

### 已修改内容
- `deploy/scripts/check_route_contract.py`
  - 新增 `external_api/` 静态 AST 契约检查。
  - 要求 `external_api/` 只保留 provider/client 代码，不能导入或构造 `FastAPI`/`APIRouter`，也不能出现 `@app.*` 或 `@router.*` 路由装饰器。
  - 验证输出新增：
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
- `deploy/scripts/check_provider_contract.py`
  - 新增关键 provider 客户端 resolver 覆盖检查。
  - 要求以下运行时调用层继续通过 `resolve_provider()` 读取 key/endpoint/proxy：
    - `services/ai_proxy_service.py`
    - `services/audio_provider.py`
    - `services/video_reverse_service.py`
    - `external_api/audio/minimax_audio.py`
    - `external_api/video/{minimax,sora2,veo,seedance,dashscope,wan2}.py`
  - 对 GPT Image 的动态 tier 注册表 `GPT_IMAGE_TIERS` 单独校验，确认 `laozhang-gpt-image` 与 `laozhang-sora2` 都仍然挂在 provider registry 上。

### 本地验证结果
- `python -m py_compile deploy/scripts/check_route_contract.py deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `runtime_wired_files=10`
  - `gpt_image_tier_providers=2`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_arch_contract_20260618-120716`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile scripts/check_route_contract.py scripts/check_provider_contract.py scripts/check_admin_api_config_import.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `runtime_wired_files=10`
    - `gpt_image_tier_providers=2`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
- 本轮只更新验证脚本和文档，未重启服务；服务器 `drama` 状态保持 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`

### 本轮仍未处理或需后续观察
- 本轮是架构契约护栏，不改变生产业务行为。
- 后续继续拆分 MVC 或替换自建 API 时，需要把这两个 contract 脚本纳入每次部署验证。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 API Config Import Service Extraction Increment

### 已修改内容
- 新增 `deploy/services/api_config_import_service.py`
  - 抽出 API 预设导入和“导入运行时 Key”的策略逻辑。
  - 保留原有响应字段和计数：`dry_run`、`planned_actions`、`env_keys_imported`、`env_keys_skipped_provider_claimed`、`updated_existing` 等。
  - 继续通过 `resolve_provider()` 读取运行时 key/endpoint/proxy，不在路由里直接处理 provider 细节。
  - 支持注入 `reload_api_env` 回调，dry-run 不写 DB、不刷新环境变量。
- `deploy/admin_routes.py`
  - `/api/admin/api-configs/import-presets` 路由改为薄包装，只做 DB 检查、请求体转换和调用服务层。
  - 路由路径、HTTP method、请求体和响应结构保持不变。
- `deploy/scripts/check_admin_api_config_import.py`
  - 改为直接验证 `services.api_config_import_service`，不再依赖 FastAPI route wrapper。
  - 保留三类契约：普通导入不复制 key、DashScope 多 preset 只写一条 keyed row、已有空 key 配置可被运行时 key 更新并启用。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_config_import_service.py deploy/scripts/check_admin_api_config_import.py deploy/scripts/check_provider_contract.py deploy/scripts/check_route_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过：
  - `plain_import_copies_keys=0`
  - `dashscope_keyed_rows=1`
  - `existing_empty_key_update=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `runtime_wired_files=10`
  - `gpt_image_tier_providers=2`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_config_import_service_20260618-121332`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_config_import_service.py scripts/check_admin_api_config_import.py scripts/check_provider_contract.py scripts/check_route_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py`
    - `plain_import_copies_keys=0`
    - `dashscope_keyed_rows=1`
    - `existing_empty_key_update=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `runtime_wired_files=10`
    - `gpt_image_tier_providers=2`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后调用 `POST /api/admin/api-configs/import-presets` dry-run：
    - `dry_run_http=200`
    - `dry_run=True`
    - `planned_actions=17`
    - `imported=15`
    - `skipped=2`
    - `env_keys_imported=10`
    - `env_keys_skipped_provider_claimed=5`

### 本轮仍未处理或需后续观察
- 本轮只拆出 API config import 服务层，不改变后台 UI 和生产业务行为。
- 后续可继续把 API config health test 也抽到服务层，让 `admin_routes.py` 只保留 HTTP 边界。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 API Config Health Service Extraction Increment

### 已修改内容
- 新增 `deploy/services/api_config_health_service.py`
  - 抽出 `/api/admin/api-configs/{config_id}/test` 的健康检查逻辑。
  - 统一处理 health URL 派生、provider preset/catalog fallback、Bearer header、custom/system proxy、aiohttp 请求和响应归一化。
  - 支持注入 `session_factory` 和 `proxy_settings_loader`，方便无真实外部 API 的契约测试。
- `deploy/admin_routes.py`
  - `/api/admin/api-configs/{config_id}/test` 路由改为薄包装：只查 DB、解密 key、调用 `test_api_config_health()`。
  - 路由路径、HTTP method 和响应结构保持不变。
- 新增 `deploy/scripts/check_admin_api_config_health.py`
  - 验证 DashScope video endpoint 能派生到 compatible-mode `/models` 健康检查 URL。
  - 验证无 key 时不会发起外部请求，并返回标准 `No API key configured`。
  - 验证 system/custom proxy、Authorization header、custom headers 和多 URL fallback 行为。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_config_health_service.py deploy/services/api_config_import_service.py deploy/scripts/check_admin_api_config_health.py deploy/scripts/check_admin_api_config_import.py deploy/scripts/check_provider_contract.py deploy/scripts/check_route_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过：
  - `dashscope_health_urls=2`
  - `no_key_result_ok=1`
  - `fake_http_calls=2`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过：
  - `plain_import_copies_keys=0`
  - `dashscope_keyed_rows=1`
  - `existing_empty_key_update=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `runtime_wired_files=10`
  - `gpt_image_tier_providers=2`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_config_health_service_20260618-122146`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_config_health_service.py services/api_config_import_service.py scripts/check_admin_api_config_health.py scripts/check_admin_api_config_import.py scripts/check_provider_contract.py scripts/check_route_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_health.py`
    - `dashscope_health_urls=2`
    - `no_key_result_ok=1`
    - `fake_http_calls=2`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py`
    - `plain_import_copies_keys=0`
    - `dashscope_keyed_rows=1`
    - `existing_empty_key_update=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `runtime_wired_files=10`
    - `gpt_image_tier_providers=2`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后调用无 key 配置的 `POST /api/admin/api-configs/{config_id}/test`：
    - `health_http=200`
    - `config_id=apicfg_seed_gptimg_v`
    - `ok=False`
    - `error=No API key configured`
    - `urls_tried=1`

### 本轮仍未处理或需后续观察
- 本轮只拆出 API config health check 服务层，不改变后台 UI 或真实 provider 请求策略。
- 后续可继续把 API config CRUD 的 create/update/delete 也抽到服务层，让 `admin_routes.py` 进一步只保留 HTTP 边界。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 API Config CRUD Service Extraction Increment

### 已修改内容
- 新增 `deploy/services/api_config_service.py`
  - 抽出 API config 的 list/create/update/delete 以及 saved-config health wrapper。
  - 统一处理 API key 遮罩、provider/runtime 状态摘要、create/update/delete 后的 `_reload_api_env()` 回调。
  - 使用 `ApiConfigNotFound` / `ApiConfigCreateFailed` 作为服务层异常，路由层只转换为 HTTP 404/500。
- `deploy/admin_routes.py`
  - `/api/admin/api-configs` 的 GET/POST/PUT/DELETE 和 `/api-configs/{config_id}/test` 改为薄包装。
  - 移除 route 内部对 `ApiConfigDAO` 的直接 CRUD 调用、旧 `_mask_api_config_row()` 和旧 `_row_get()`。
  - 路由路径、HTTP method 和响应结构保持不变。
- 新增 `deploy/scripts/check_admin_api_config_crud.py`
  - 使用 fake DAO 验证 list 遮罩 key、create/update/delete reload 次数、空 update 不 reload、missing delete 抛 `ApiConfigNotFound`、health wrapper 无 key 结果。

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_config_service.py deploy/services/api_config_health_service.py deploy/services/api_config_import_service.py deploy/scripts/check_admin_api_config_crud.py deploy/scripts/check_admin_api_config_health.py deploy/scripts/check_admin_api_config_import.py deploy/scripts/check_provider_contract.py deploy/scripts/check_route_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_crud.py` 通过：
  - `list_masks_key=1`
  - `create_update_delete_reload_calls=3`
  - `empty_update_reload_calls=0`
  - `health_wrapper_no_key=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过：
  - `dashscope_health_urls=2`
  - `no_key_result_ok=1`
  - `fake_http_calls=2`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过：
  - `plain_import_copies_keys=0`
  - `dashscope_keyed_rows=1`
  - `existing_empty_key_update=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `runtime_wired_files=10`
  - `gpt_image_tier_providers=2`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_config_crud_service_20260618-122929`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_config_service.py services/api_config_health_service.py services/api_config_import_service.py scripts/check_admin_api_config_crud.py scripts/check_admin_api_config_health.py scripts/check_admin_api_config_import.py scripts/check_provider_contract.py scripts/check_route_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_crud.py`
    - `list_masks_key=1`
    - `create_update_delete_reload_calls=3`
    - `empty_update_reload_calls=0`
    - `health_wrapper_no_key=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_health.py`
    - `dashscope_health_urls=2`
    - `no_key_result_ok=1`
    - `fake_http_calls=2`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py`
    - `plain_import_copies_keys=0`
    - `dashscope_keyed_rows=1`
    - `existing_empty_key_update=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `runtime_wired_files=10`
    - `gpt_image_tier_providers=2`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后请求 `GET /api/admin/api-configs`：
    - `configs_http=200`
    - `configs=2`
    - `providers=12`
    - `provider_status=12`
    - `runtime_status=17`
    - `masked_rows=2`
  - 登录后调用无 key 配置的 `POST /api/admin/api-configs/{config_id}/test`：
    - `health_http=200`
    - `health_config_id=apicfg_seed_gptimg_v`
    - `health_ok=False`
    - `health_error=No API key configured`

### 本轮仍未处理或需后续观察
- 本轮只拆出 API config CRUD 服务层，不改变后台 UI 或真实 provider 请求策略。
- 后续可继续把 `api-configs/presets` 也做成服务层 facade，或开始把 `routers/ai_proxy.py` 与 API registry 的自建 provider 切换模式打通。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 API Config Presets Facade Increment

### 已修改内容
- `deploy/services/api_config_service.py`
  - 新增 `get_api_config_presets()` facade。
  - 将 presets + providers 的组合响应收进 API config 服务层。
- `deploy/admin_routes.py`
  - `/api/admin/api-configs/presets` 改为调用 `get_api_config_presets()`。
  - `/api/admin/api-configs/import-presets` 不再持有 `PRESET_API_MODELS`，由 `import_preset_api_configs()` 自行读取 registry。
  - `admin_routes.py` 不再直接 import `services.api_provider_registry`，API config 区域进一步只保留 HTTP 边界。
- `deploy/scripts/check_admin_api_config_crud.py`
  - 增加 presets facade 契约检查：
    - `presets=17`
    - `providers=12`

### 本地验证结果
- `python -m py_compile deploy/admin_routes.py deploy/services/api_config_service.py deploy/services/api_config_health_service.py deploy/services/api_config_import_service.py deploy/scripts/check_admin_api_config_crud.py deploy/scripts/check_admin_api_config_health.py deploy/scripts/check_admin_api_config_import.py deploy/scripts/check_provider_contract.py deploy/scripts/check_route_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_crud.py` 通过：
  - `list_masks_key=1`
  - `presets_facade=17/12`
  - `create_update_delete_reload_calls=3`
  - `empty_update_reload_calls=0`
  - `health_wrapper_no_key=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过：
  - `plain_import_copies_keys=0`
  - `dashscope_keyed_rows=1`
  - `existing_empty_key_update=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过：
  - `dashscope_health_urls=2`
  - `no_key_result_ok=1`
  - `fake_http_calls=2`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `runtime_wired_files=10`
  - `gpt_image_tier_providers=2`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_config_presets_facade_20260618-123519`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile admin_routes.py services/api_config_service.py services/api_config_health_service.py services/api_config_import_service.py scripts/check_admin_api_config_crud.py scripts/check_admin_api_config_health.py scripts/check_admin_api_config_import.py scripts/check_provider_contract.py scripts/check_route_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_crud.py`
    - `list_masks_key=1`
    - `presets_facade=17/12`
    - `create_update_delete_reload_calls=3`
    - `empty_update_reload_calls=0`
    - `health_wrapper_no_key=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py`
    - `plain_import_copies_keys=0`
    - `dashscope_keyed_rows=1`
    - `existing_empty_key_update=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_health.py`
    - `dashscope_health_urls=2`
    - `no_key_result_ok=1`
    - `fake_http_calls=2`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `runtime_wired_files=10`
    - `gpt_image_tier_providers=2`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`
  - 登录后请求 `GET /api/admin/api-configs/presets`：
    - `presets_http=200`
    - `presets=17`
    - `providers=12`
  - 登录后调用 `POST /api/admin/api-configs/import-presets` dry-run：
    - `dry_run_http=200`
    - `dry_run=True`
    - `total=17`
    - `planned_actions=17`

### 本轮仍未处理或需后续观察
- 本轮只收拢 API config presets facade，不改变后台 UI 或真实 provider 请求策略。
- 后续可开始把 `routers/ai_proxy.py` 与 API registry 的自建 provider 切换模式进一步打通。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 GPT Image Tier Registry Increment

### 已修改内容
- `deploy/services/api_provider_registry.py`
  - 新增 `GPT_IMAGE_TIERS`，统一记录 GPT Image 的 `tier -> provider/model/key_hint` 映射。
  - 新增 `normalize_gpt_image_tier()`、`get_gpt_image_tier()`、`get_gpt_image_tiers()`。
- `deploy/services/ai_proxy_service.py`
  - 移除本地 `GPT_IMAGE_TIERS` 常量。
  - GPT Image 生成逻辑改为通过 registry 解析 tier 配置，再调用 `resolve_provider(provider, model)`。
- `deploy/scripts/check_provider_contract.py`
  - 契约检查改为读取 registry 中的 GPT Image tier 映射。
  - 新增防回退检查：`services/ai_proxy_service.py` 不允许重新定义 `GPT_IMAGE_TIERS`。
  - 校验每个 tier 指向的 provider/model 都存在对应 preset。

### 本地验证结果
- `python -m py_compile deploy/services/api_provider_registry.py deploy/services/ai_proxy_service.py deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `runtime_wired_files=10`
  - `gpt_image_tier_providers=2`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=225`
  - `openapi_operations=281`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_crud.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_gpt_image_tier_registry_20260618-204420`
- 已同步最新 `Agent.md` 到：
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/Agent.md`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/api_provider_registry.py services/ai_proxy_service.py scripts/check_provider_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `runtime_wired_files=10`
    - `gpt_image_tier_providers=2`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=225`
    - `openapi_operations=281`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_crud.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_health.py` 通过。
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=225`，`openapi_operations=281`

### 本轮仍未处理或需后续观察
- 本轮只迁移 GPT Image tier 元数据来源，不改变真实 GPT Image 请求路径或请求体。
- `external_api/` 当前没有旧 FastAPI route handler，视频裁剪入口已切到 `routers/video.py`。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 API Platform Hot Reload + Provider Health Increment

### 已修改内容
- `deploy/services/api_config_runtime_loader.py`
  - 新增 API 配置热更新服务层，统一承载 DB -> env 投影逻辑。
  - `load_api_configs_to_env()` 每次从 DB enabled/keyed rows 刷新 key、endpoint、proxy_mode、custom_proxy。
  - 空 DB/禁用后会恢复到进程启动时的 env baseline，实现 DB 优先、删除/禁用后回退 env。
  - `seed_default_api_providers()` 改为从 registry 派生 GPT Image placeholder，不再在 `cluster_main.py` 维护第二份 provider 列表。
- `deploy/cluster_main.py`
  - 保留 `load_api_configs_to_env()` / `seed_default_api_providers()` 旧函数名作为兼容 wrapper。
  - 启动期直接调用 `services.api_config_runtime_loader`。
  - 移除主入口里的旧 DB -> env 实现和 GPT Image seed 常量。
- `deploy/admin_routes.py`
  - `_reload_api_env()` 不再动态 import `cluster_main`，改为直接调用服务层 loader。
  - 新增 `GET /api/admin/api-configs/{provider_id}/health`。
- `deploy/services/api_config_health_service.py`
  - 新增 `check_provider_health(provider_id)`，基于 `resolve_provider()` 检查当前运行时生效的 key/endpoint。
  - 返回 `status`（`ok` / `error` / `no_key`）、`latency_ms`、`checked_at` 和详细 health 信息。
- `deploy/services/api_provider_registry.py`
  - Provider catalog 增加 `health_check` 元数据，默认使用非计费 GET models 探测。
- `deploy/admin/app.js`
  - API 配置卡新增 provider runtime health 状态灯、延迟、最后检测时间、探测 URL。
  - 新增“运行时”按钮，调用 provider 级 health 接口。
- `deploy/admin/index.html`
  - 静态脚本版本更新到 `app.js?v=20260618d`。
- `deploy/new_html/admin/AdminSettingsPage.tsx`
  - iframe 旧后台版本更新到 `20260618d`。
- `deploy/scripts/check_api_config_runtime_loader.py`
  - 新增热更新契约测试。
- `deploy/scripts/check_admin_api_config_health.py`
  - 增加 provider runtime health 覆盖。
- `deploy/scripts/check_route_contract.py`
  - 路由契约更新为本轮新增接口后的 `226 paths / 282 operations`。

### 本地验证结果
- `python -m py_compile ...` 通过。
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_api_config_runtime_loader.py` 通过：
  - `hot_reload_loaded_rows=1`
  - `baseline_restore=1`
  - `seed_registry_placeholders=2`
  - `admin_routes_no_cluster_import=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过：
  - `dashscope_health_urls=2`
  - `no_key_result_ok=1`
  - `fake_http_calls=2`
  - `provider_runtime_health=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=226`
  - `openapi_operations=282`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_crud.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_api_platform_health_20260618-210014`
- 已同步最新 `Agent.md` 到：
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/Agent.md`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/api_config_runtime_loader.py services/api_config_health_service.py services/api_provider_registry.py admin_routes.py cluster_main.py scripts/check_api_config_runtime_loader.py scripts/check_admin_api_config_health.py scripts/check_provider_contract.py scripts/check_route_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_api_config_runtime_loader.py`
    - `hot_reload_loaded_rows=1`
    - `baseline_restore=1`
    - `seed_registry_placeholders=2`
    - `admin_routes_no_cluster_import=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_health.py`
    - `dashscope_health_urls=2`
    - `no_key_result_ok=1`
    - `fake_http_calls=2`
    - `provider_runtime_health=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `resolve_provider_references=15`
    - `runtime_wired_files=10`
    - `gpt_image_tier_providers=2`
    - `derived_env_keys=36`
    - `runtime_status_rows=17`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=226`
    - `openapi_operations=282`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_crud.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py` 通过。
  - `cd /home/Administrator/deploy/new_html && npm run build` 通过，产物 `../dist/assets/index-I92ncyps.js`。
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=226`，`openapi_operations=282`
  - 登录后请求 `GET /api/admin/api-configs/deepseek/health`：
    - `health_status=ok`
    - `health_provider=deepseek`
    - `health_latency_ms=177`
  - `/admin-legacy/?embed=1&v=20260618d&page=apiconfig#apiconfig` 已引用 `app.js?v=20260618d`。

### 本轮仍未处理或需后续观察
- 已完成计划 Step 1 热更新通路、Step 2 provider 健康检查接口、Step 3 的旧后台可见状态展示。
- Step 4 定时巡检和 Step 5 failover 尚未实现。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 API Provider Health Monitor Increment

### 已修改内容
- `deploy/services/api_provider_health_monitor.py`
  - 新增 provider 健康巡检后台服务。
  - 默认每 5 分钟巡检全部 registry provider，结果写入 Redis：`provider:health:{provider_id}`。
  - 支持环境变量：
    - `API_PROVIDER_HEALTH_MONITOR_ENABLED`
    - `API_PROVIDER_HEALTH_INITIAL_DELAY_SECONDS`
    - `API_PROVIDER_HEALTH_INTERVAL_SECONDS`
    - `API_PROVIDER_HEALTH_TTL_SECONDS`
    - `API_PROVIDER_HEALTH_CONCURRENCY`
  - 缓存内容不包含明文 API Key 或代理地址。
- `deploy/cluster_main.py`
  - Redis 初始化成功后调用 `set_provider_health_redis(redis_client)`。
  - 启动 `provider_health_monitor_loop(redis_client)` 后台任务。
  - shutdown 时取消 provider health monitor task。
- `deploy/services/api_config_service.py`
  - `/api/admin/api-configs` 响应新增 `provider_health`，返回 Redis 中最近一次巡检结果。
- `deploy/admin_routes.py`
  - 手动调用 `GET /api/admin/api-configs/{provider_id}/health` 后，会把结果写入同一份 Redis 缓存。
- `deploy/admin/app.js`
  - `fetchApiConfigs()` 会读取后端返回的 `provider_health`。
  - API 配置页打开后可显示最近一次后台巡检状态；手动“运行时”测试仍保留。
- `deploy/admin/index.html`
  - 静态脚本版本更新到 `app.js?v=20260618e`。
- `deploy/new_html/admin/AdminSettingsPage.tsx`
  - iframe 旧后台版本更新到 `20260618e`。
- `deploy/scripts/check_provider_health_monitor.py`
  - 新增 provider health monitor 契约测试。

### 本地验证结果
- `python -m py_compile deploy/services/api_provider_health_monitor.py deploy/services/api_config_service.py deploy/admin_routes.py deploy/cluster_main.py deploy/scripts/check_provider_health_monitor.py` 通过。
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_health_monitor.py` 通过：
  - `cached_provider_health=2`
  - `sweep_results=2`
  - `api_config_response_provider_health=2`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_api_config_runtime_loader.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=226`
  - `openapi_operations=282`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_crud.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过。

### 生产服务器部署结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_provider_health_monitor_20260618-210950`
- 已同步最新 `Agent.md` 到：
  - `/home/Administrator/deploy/Agent.md`
  - `/home/Administrator/Agent.md`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/api_provider_health_monitor.py services/api_config_service.py admin_routes.py cluster_main.py scripts/check_provider_health_monitor.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_health_monitor.py`
    - `cached_provider_health=2`
    - `sweep_results=2`
    - `api_config_response_provider_health=2`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_api_config_runtime_loader.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_health.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=226`
    - `openapi_operations=282`
    - `external_api_python_files=10`
    - `external_api_route_handlers=0`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_crud.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_admin_api_config_import.py` 通过。
  - `cd /home/Administrator/deploy/new_html && npm run build` 通过，产物 `../dist/assets/index-D1okB5Dg.js`。
- `sudo systemctl restart drama` 后服务状态为 `active`。
- 线上验证通过：
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`
  - `https://mecha.one/openapi.json`：`openapi_paths=226`，`openapi_operations=282`
  - 登录后请求 `GET /api/admin/api-configs`：
    - `provider_health_count=12`
    - 示例：`dashscope:ok:215`、`deepseek:ok:154`、`doubao:ok:285`、`gemini-image:ok:634`、`gemini-text:ok:578`
  - `/admin-legacy/?embed=1&v=20260618e&page=apiconfig#apiconfig` 已引用 `app.js?v=20260618e`。

### 本轮仍未处理或需后续观察
- 已完成计划 Step 4 定时健康巡检。
- Step 5 failover 自动切换尚未实现。
- 未修改 worker、任务队列、ComfyUI pipeline、`agent_routes.py` 或 Redis 契约。

## 2026-06-18 Frontend Overflow / Admin Layout Pass

### 已修改内容
- `deploy/new_html/styles/design-tokens.css`
  - 增加全局 `box-sizing`、`min-width: 0`、`overflow-x: hidden`、媒体元素最大宽度和长文本换行工具类，降低页面被长 URL、长模型名、表格内容横向撑爆的概率。
- `deploy/new_html/admin/AdminLayout.tsx`
  - 后台 React 外壳从 `w-screen` 调整为 `w-full min-w-0`，主区补充 `min-h-0/min-w-0`，避免 iframe 或内部页面撑出横向滚动。
- `deploy/new_html/admin/AdminSettingsPage.tsx`
  - iframe 容器增加 `min-h-0/min-w-0/overflow-hidden`。
  - legacy 资源版本升级到 `20260618f`。
- `deploy/new_html/admin/AdminSidebar.tsx`
  - 后台侧栏补充 `min-h-0/min-w-0`，菜单文字可截断，避免长菜单名挤压内容区。
- `deploy/new_html/layouts/WorkflowLayout.tsx`
  - 流程页顶部导航改为横向可滚动的中间导航区，右侧通知/退出区域不再被导航项挤出。
  - 主内容区补充 `min-h-0/min-w-0`。
- `deploy/admin/style.css`
  - legacy 后台增加全局防横向溢出、页面自适应 padding、统计卡片 `auto-fit`、表格长文本换行。
  - API 配置卡片改为 grid 布局，endpoint/key/model 等长文本可换行；操作按钮允许换行。
  - 工作流卡片、节点卡片、代理配置网格和 toast 都补充响应式换行。
  - 工作流编辑弹窗在桌面使用更宽布局，小屏自动变单列，减少左右栏小区域滚动。
- `deploy/admin/app.js`
  - API 配置卡片中的 endpoint 展示去掉硬编码 `max-width:200px;overflow:hidden;white-space:nowrap`，改为可换行展示。
- `deploy/admin/index.html`
  - `style.css` / `app.js` 静态资源版本升级到 `20260618f`。

### 本地验证结果
- `node --check deploy/admin/app.js` 通过（使用 Codex bundled Node）。
- 本地 `vite build` 未完成：Windows 本地 `node_modules` 缺少 Rollup 可选包 `@rollup/rollup-win32-x64-msvc`，这是本地依赖安装问题；生产验收以服务器 `cd /home/Administrator/deploy/new_html && npm run build` 为准。

### 生产服务器部署与验证结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_frontend_overflow_20260618-132806`
- 服务器验证通过：
  - `node --check admin/app.js` 通过。
  - `cd /home/Administrator/deploy/new_html && npm run build` 通过，生成产物 `../dist/assets/index-xTD1L-a0.js`。
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - `https://mecha.one/openapi.json`：`openapi_paths=226`，`openapi_operations=282`。
  - `https://mecha.one/admin-legacy/` 已引用 `style.css?v=20260618f` 和 `app.js?v=20260618f`。

### 本轮仍未处理或需后续观察
- 本轮是全局布局/溢出治理，不改变分镜和视频的数据加载策略。
- 分镜页和视频页已经存在 10 条分页/懒加载基础；如果线上仍卡，需要下一轮继续做更深的虚拟列表或按视口预取重构。
- Step 5 failover 自动切换尚未实现。

## 2026-06-18 API Provider Failover Foundation Increment

### 已修改内容
- `deploy/services/api_provider_registry.py`
  - Provider catalog 新增 provider 级 `fallback` 元数据。
  - 当前仅启用低风险链路：`gemini-text -> deepseek`，触发条件为 `missing_key` 或 `health_error`。
  - `get_api_provider_catalog()` 返回 fallback provider 元数据，供后台展示。
- `deploy/services/api_provider_runtime.py`
  - 新增 `resolve_provider_with_failover(provider, model_name, provider_health=...)`。
  - 新增 provider 健康状态标准化、`provider_is_down()`、`provider_is_usable()`、`provider_fallback_chain()`。
  - `build_provider_runtime_status()` 新增 `fallback`、`failover`、`failover_active`、`failover_selected_provider`、`failover_reason` 等诊断字段。
  - 设计上缺失健康缓存不视为 down，只有明确 `status=error` 或缺 key 才进入 fallback 判断。
- `deploy/services/api_config_service.py`
  - `/api/admin/api-configs` 构建 runtime status 时传入 Redis 缓存的 provider health，使后台能看到当前 failover 诊断。
- `deploy/admin/app.js`
  - API 配置卡片展示 fallback env 与 fallback provider。
  - runtime 行展示当前是否触发 failover，以及切到了哪个 provider。
- `deploy/admin/index.html` / `deploy/new_html/admin/AdminSettingsPage.tsx`
  - legacy 静态资源版本升级到 `20260618g`，确保后台 iframe 拉取新的 `app.js`。
- `deploy/scripts/check_provider_contract.py`
  - 增加 fallback provider 合约校验：不能引用未知 provider，能力类别必须兼容。
  - 增加 failover 行为测试：`gemini-text` 缺 key 或健康错误时可选 `deepseek`，主 provider 健康时不切换。

### 本地验证结果
- `python -m py_compile ...` 通过。
- `node --check deploy/admin/app.js` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=15`
  - `runtime_wired_files=10`
  - `gpt_image_tier_providers=2`
  - `derived_env_keys=36`
  - `runtime_status_rows=17`
  - `failover_checks=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_health_monitor.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_api_config_runtime_loader.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_crud.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=226`
  - `openapi_operations=282`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`

### 生产服务器部署与验证结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_provider_failover_20260618-133859`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/api_provider_registry.py services/api_provider_runtime.py services/api_config_service.py scripts/check_provider_contract.py`
  - `node --check admin/app.js`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `providers=12`
    - `presets=17`
    - `runtime_status_rows=17`
    - `failover_checks=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_health_monitor.py` 通过。
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=226`
    - `openapi_operations=282`
  - `cd /home/Administrator/deploy/new_html && npm run build` 通过，生成产物 `../dist/assets/index-B5PBo_Nc.js`。
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - `https://mecha.one/openapi.json`：`openapi_paths=226`，`openapi_operations=282`。
  - `https://mecha.one/admin-legacy/` 已引用 `style.css?v=20260618g` 和 `app.js?v=20260618g`。
  - 登录后请求 `GET /api/admin/api-configs`：
    - `runtime_rows=17`
    - `provider_health_count=12`
    - `gemini_fallback_provider=deepseek`
    - `gemini_runtime_has_failover=True`
    - 当前健康状态下 `gemini_failover_active=False`，`gemini_failover_selected=gemini-text`。

### 本轮仍未处理或需后续观察
- 本轮先完成 failover 的注册表、resolver 和后台诊断基础；生成 handler 尚未全面自动切到 `resolve_provider_with_failover()`。
- 继续保持保守：图像/视频 provider 由于调用协议差异较大，暂未声明跨 provider fallback。
- 下一轮可优先将 `/api/gemini/text` 的调用层接入 failover resolver，并在真实请求失败时按同协议 fallback 重试。

## 2026-06-18 Gemini Text Call-Level Failover Increment

### 已修改内容
- `deploy/services/ai_proxy_service.py`
  - `/api/gemini/text` 的真实调用路径接入 `resolve_provider_with_failover("gemini-text")`。
  - 每次请求前读取 Redis 中最近的 `gemini-text` / `deepseek` provider health 缓存。
  - 当 `gemini-text` 缺 key 或健康状态为 `error`，且 `deepseek` 有可用 key/endpoint 时，实际请求会切到 DeepSeek chat-completions。
  - 当 `gemini-text` 健康时保持原 Gemini 路径，不触发切换。
  - 若健康缓存读取失败，仅记录 warning 并继续按 resolver 默认逻辑运行，不阻塞文本生成。
- `deploy/scripts/check_provider_contract.py`
  - 运行时 provider wiring 检查同时识别 `resolve_provider()` 和 `resolve_provider_with_failover()`。
- `deploy/scripts/check_ai_proxy_failover.py`
  - 新增调用层 failover 契约测试，不发真实 HTTP。
  - 验证 Gemini text 主 provider 不可用时请求 DeepSeek endpoint/model/key。
  - 验证 Gemini text 主 provider 健康时仍请求 Gemini endpoint/model/key。

### 本地验证结果
- `python -m py_compile deploy/services/ai_proxy_service.py deploy/scripts/check_ai_proxy_failover.py deploy/scripts/check_provider_contract.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_ai_proxy_failover.py` 通过：
  - `gemini_text_failover_to_deepseek=1`
  - `gemini_text_primary_stays_when_healthy=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_contract.py` 通过：
  - `providers=12`
  - `presets=17`
  - `resolve_provider_references=18`
  - `runtime_wired_files=10`
  - `runtime_status_rows=17`
  - `failover_checks=1`
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_api_config_runtime_loader.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_health.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_crud.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_admin_api_config_import.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_provider_health_monitor.py` 通过。
- `deploy/.venv/Scripts/python.exe -X utf8 deploy/scripts/check_route_contract.py` 通过：
  - `openapi_paths=226`
  - `openapi_operations=282`
  - `external_api_python_files=10`
  - `external_api_route_handlers=0`

### 本轮仍未处理或需后续观察
- `/api/gemini/text` 已完成调用层 failover；DeepSeek 流式 `/api/deepseek/chat` 暂不反向切 Gemini。
- 图像/视频 provider 由于协议差异，仍只保留 registry/runtime 诊断，不自动跨 provider 切换。
- 后续可以继续把文本类调用统一成更完整的 provider adapter，再推进 `routers/ai_proxy.py` 的 MVC 拆分。

### 生产服务器部署与验证结果
- 已同步到服务器 `/home/Administrator/deploy`。
- 部署前备份目录：
  - `/home/Administrator/deploy_backups/mecha_gemini_text_failover_20260618-134821`
- 服务器验证通过：
  - `/home/Administrator/deploy/.venv/bin/python -m py_compile services/ai_proxy_service.py scripts/check_ai_proxy_failover.py scripts/check_provider_contract.py`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_ai_proxy_failover.py`
    - `gemini_text_failover_to_deepseek=1`
    - `gemini_text_primary_stays_when_healthy=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_provider_contract.py`
    - `resolve_provider_references=18`
    - `runtime_wired_files=10`
    - `runtime_status_rows=17`
    - `failover_checks=1`
  - `/home/Administrator/deploy/.venv/bin/python -X utf8 scripts/check_route_contract.py`
    - `openapi_paths=226`
    - `openapi_operations=282`
  - `sudo systemctl restart drama` 后服务状态为 `active`。
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@` 冒烟通过：`9/9`。
  - 线上真实请求 `POST https://mecha.one/api/gemini/text` 返回 `HTTP 200`，短提示词返回文本内容样例：`Okay`。
## 2026-06-18 Frontend Overflow / Small Scroll Area Usability Pass

### Problem

- Several front-end pages could exceed their containers or force users to read important content inside very small nested scroll boxes.
- The storyboard/video/material/workspace pages were especially sensitive because they mix sidebars, toolbars, cards, media previews, long prompts, and generated assets.

### Changes

- Added global layout guardrails in `deploy/new_html/styles/design-tokens.css`:
  - `box-sizing: border-box` everywhere.
  - Root/body horizontal overflow protection.
  - Safe wrapping for long text, code, model IDs, URLs, and prompt content.
  - Responsive helper classes for toolbars, split panes, modal surfaces, media details, storyboard generation, video workbench, and workspace frames.
- Changed `deploy/new_html/index.html` body from full hidden overflow to horizontal-only overflow protection so pages can scroll normally.
- Updated major shell/layout pages to use the new responsive helpers:
  - `layouts/WorkflowLayout.tsx`
  - `admin/AdminLayout.tsx`
  - `components/ProjectHub.tsx`
  - `WorkspaceApp.tsx`
  - `pages/ScriptPage.tsx`
- Updated media-heavy and workflow-heavy pages so wide panes stack on narrower screens instead of creating cramped nested scroll areas:
  - `components/VideoPage.tsx`
  - `pages/VideoGenPage.tsx`
  - `pages/MediaLibraryPage.tsx`
  - `components/GenerationPage.tsx`
  - `pages/GenerationPage.tsx`
  - `pages/StoryboardGenPage.tsx`
  - `pages/VideoReversePage.tsx`
  - `pages/EnhancePage.tsx`
  - `pages/FinalProductPage.tsx`
  - `components/MaterialPage.tsx`
- Removed tiny fixed-height prompt boxes in material cards, replacing them with normal wrapping text so users do not need to drag inside a 100px-high inner scroll area.
- Capped the storyboard timeline expanded height against viewport height so it does not dominate the page on smaller screens.

### Verification

- Server backup created before sync:
  - `/home/Administrator/deploy_backups/mecha_frontend_overflow_20260618-140309`
- Server front-end build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server service restart passed:
  - `sudo systemctl restart drama`
  - service status: `active`
- Server smoke test passed:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- Local TypeScript check was attempted with bundled Node, but the repository still has unrelated pre-existing type errors, so `tsc --noEmit` is not currently a clean validation signal.
- Browser visual verification was attempted against the storyboard URL, but Chrome automation timed out during the logged-in page check. The unauthenticated login page showed no horizontal overflow in the quick metric check.

### Notes

- This is a UI usability/layout pass only. It does not change API routing, provider keys, generation logic, task queue contracts, or ComfyUI/agent redline files.

## 2026-06-18 Backend Code Quality Fixes / API Config Runtime Safety

### Problems Fixed

- Fixed five admin update handlers that previously built update fields with `body.dict()` and `v is not None`; they now use `body.model_dump(exclude_unset=True)` so explicitly supplied `False`, `0`, and `None` are not confused with missing fields.
- Fixed `normalize_provider_health_map()` so mixed dict payloads keep valid provider health rows instead of dropping the whole map when one value is not a dict.
- Removed shared `GEMINI_API_KEY` fallback env from `gemini-text` and `gemini-image`; those providers now require their dedicated `GEMINI_TEXT_API_KEY` / `GEMINI_IMAGE_API_KEY` values and cannot accidentally inherit a Gemini TTS endpoint.
- Made `load_api_configs_to_env()` build a complete `new_env` first, then reset/apply only after successful construction. A decrypt failure no longer leaves the process env half-cleared.
- Added public `ApiConfigDAO.decrypt_key()` and changed the runtime loader to use it instead of calling the private `_decrypt_key()` across class boundaries.
- Changed `_reload_api_env()` to return `bool`; API config create/update/delete/import responses now include `env_refreshed` so the admin UI/API can tell whether runtime env refresh actually succeeded.
- Moved duplicated `_config_get()` helper into `deploy/utils/config_helpers.py` and imported it from registry/runtime/loader modules.

### Files Changed

- `deploy/admin_routes.py`
- `deploy/dao/admin/api_config.py`
- `deploy/services/api_provider_runtime.py`
- `deploy/services/api_provider_registry.py`
- `deploy/services/api_config_runtime_loader.py`
- `deploy/services/api_config_service.py`
- `deploy/services/api_config_import_service.py`
- `deploy/utils/config_helpers.py`
- Contract scripts under `deploy/scripts/check_*`.

### Verification

- Local py_compile passed for all changed Python files.
- Local contract tests passed with `deploy/.venv`:
  - `check_admin_api_config_crud.py`
  - `check_admin_api_config_import.py`
  - `check_api_config_runtime_loader.py`
  - `check_provider_contract.py`
  - `check_route_contract.py`
  - `check_provider_health_monitor.py`
  - `check_admin_api_config_health.py`
- Server backup created before sync:
  - `/home/Administrator/deploy_backups/mecha_code_quality_20260618-154054`
- Server contract tests passed with `/home/Administrator/deploy/.venv/bin/python -X utf8`.
- Server service restarted successfully:
  - `sudo systemctl restart drama`
  - service status: `active`
- Server smoke test passed:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No `pipeline/`, `agent_routes.py`, or `workflows/*.json` files were modified.
- The `decrypt exploded` stack trace in the runtime loader contract output is intentional failure injection; the script passes only if env values remain unchanged after that simulated decrypt failure.

## 2026-06-18 Admin API Config Health UI Increment

### Changes

- Migrated `/admin/settings?item=apiconfig` from a pure legacy iframe into a native React API config panel in `deploy/new_html/admin/AdminSettingsPage.tsx`.
- Each API config card now shows provider runtime health:
  - status indicator: `ok`, `error`, `no_key`, or `unknown`
  - latest latency in milliseconds
  - last checked time
  - health status code / runtime issue detail when available
- Added a per-card `测试连接` button that calls:
  - `GET /api/admin/api-configs/{provider_id}/health`
  - The returned health result updates the card immediately.
- Initial card state uses cached `provider_health` from:
  - `GET /api/admin/api-configs`
- Added a React `导入预设` action and a `旧版编辑` link so the old editor remains reachable while this admin page is migrated incrementally.
- Non-API settings pages (`cluster`, `workflows`, `dashboard`) still use the legacy iframe.

### Verification

- Local TypeScript check was run; the project still has unrelated pre-existing TS errors, and no new `AdminSettingsPage.tsx` errors appeared.
- Server backup created before sync:
  - `/home/Administrator/deploy_backups/mecha_admin_api_health_ui_20260618-155104`
- Server front-end build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server service restart passed:
  - `sudo systemctl restart drama`
  - service status: `active`
- Server smoke test passed after the restart window settled:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- API config endpoint verification passed:
  - login HTTP `200`
  - `GET /api/admin/api-configs` HTTP `200`
  - configs: `17`
  - providers: `12`
  - cached health rows: `12`
  - `GET /api/admin/api-configs/laozhang-gpt-image/health` HTTP `200`, status `no_key`

### Notes

- The first smoke run immediately after `systemctl restart drama` saw a transient login `502`; `/health` returned `200` shortly after, and the repeated smoke passed `9/9`.
- No backend API contract changes were required for this UI increment.

## 2026-06-18 Admin API Config Native Edit Increment

### Changes

- Extended the native React API config panel in `deploy/new_html/admin/AdminSettingsPage.tsx`.
- API config cards now have native actions:
  - `测试连接`
  - `编辑`
  - `启用` / `禁用`
  - `删除`
- Added a native edit/create modal:
  - name
  - provider
  - endpoint
  - model name
  - API key
  - category
  - proxy mode
  - custom proxy
  - enabled flag
- Edit mode leaves the key blank by default; blank key keeps the existing encrypted key.
- Save/toggle/delete call the standard admin API config endpoints:
  - `POST /api/admin/api-configs`
  - `PUT /api/admin/api-configs/{config_id}`
  - `DELETE /api/admin/api-configs/{config_id}`
- UI displays runtime refresh outcome through the `env_refreshed` field returned by the backend.
- Legacy edit link remains available as a fallback while the admin platform migration continues.

### Verification

- Local TypeScript check was run; the repository still has unrelated pre-existing TS errors, and no new `AdminSettingsPage.tsx` errors appeared.
- Server backup created before sync:
  - `/home/Administrator/deploy_backups/mecha_admin_api_native_edit_20260618-160217`
- Server front-end build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server service restart passed:
  - `sudo systemctl restart drama`
  - service status: `active`
- Server smoke test passed:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`
- API config data source verification passed:
  - login HTTP `200`
  - `GET /api/admin/api-configs` HTTP `200`
  - configs: `17`
  - providers: `12`
  - cached health rows: `12`
  - runtime status rows: `17`

### Notes

- This increment replaces the most common API config operations in the React admin page, but it does not remove the legacy admin implementation yet.
- No `pipeline/`, `agent_routes.py`, or `workflows/*.json` files were modified.

## 2026-06-19 Code Quality Fix Verification

### Scope

- Verified the 5 admin update endpoints in `deploy/admin_routes.py` now use `body.model_dump(exclude_unset=True)`, so explicit `False`, `0`, and `None` updates are preserved.
- Verified `deploy/services/api_provider_runtime.py` now filters mixed provider health maps per item instead of discarding the whole map.
- Verified `deploy/services/api_provider_registry.py` keeps `gemini-text` and `gemini-image` on dedicated keys with empty `fallback_env`.
- Verified `deploy/services/api_config_runtime_loader.py` builds the complete env projection before resetting/writing `os.environ`, and uses `ApiConfigDAO.decrypt_key()`.
- Verified `_reload_api_env()` returns a boolean and API config write responses expose `env_refreshed`.
- Verified the shared `_config_get` helper lives in `deploy/utils/config_helpers.py`.

### Verification

- Local compile passed:
  - `python -X utf8 -m py_compile deploy/admin_routes.py deploy/services/api_provider_runtime.py deploy/services/api_provider_registry.py deploy/services/api_config_runtime_loader.py deploy/dao/admin/api_config.py deploy/utils/config_helpers.py`
- Local contract checks passed:
  - `deploy/scripts/check_provider_contract.py`
  - `deploy/scripts/check_api_config_runtime_loader.py`
  - `deploy/scripts/check_admin_api_config_crud.py`
  - `deploy/scripts/check_admin_api_config_import.py`
- Server source check found no old patterns and confirmed `utils/config_helpers.py` exists.
- Server compile and the same four contract checks passed.
- Smoke test passed:
  - `python deploy/scripts/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.
- No new deployment gap was found in this verification pass.

## 2026-06-19 Admin API Provider Health Sweep Increment

### Changes

- Added a batch provider health sweep endpoint:
  - `POST /api/admin/api-configs/health/sweep`
  - Request body supports optional `providers` and `concurrency`.
  - Response returns `provider_health` rows plus `summary.total/ok/error/no_key`.
- Extended the React admin API config page:
  - Added a `测试全部` button on the API config toolbar.
  - The button calls the sweep endpoint and updates each provider card health state from the returned rows.
- Updated the route contract baseline:
  - OpenAPI paths: `227`
  - OpenAPI operations: `283`
- Updated `deploy/docs/api.md` with the provider health routes.

### Verification

- Local backend checks passed:
  - `py_compile` for touched backend/scripts files
  - `deploy/scripts/check_route_contract.py`
  - `deploy/scripts/check_provider_health_monitor.py`
- Local frontend build could not run because local Windows `node_modules` is missing Rollup's optional native package; server build is the authoritative build for this deployment.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_provider_health_sweep_20260619-001838`
- Server checks passed:
  - `py_compile`
  - `scripts/check_route_contract.py` -> `openapi_paths=227`, `openapi_operations=283`
  - `scripts/check_provider_health_monitor.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server service restart passed:
  - `sudo systemctl restart drama`
  - service status: `active`
- Live endpoint verification passed:
  - `POST https://mecha.one/api/admin/api-configs/health/sweep`
  - provider tested: `laozhang-gpt-image`
  - HTTP `200`
  - summary: `total=1`, `ok=0`, `error=0`, `no_key=1`
- Smoke test passed:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This is a low-risk API management platform increment: the sweep endpoint can refresh all configured provider cards without forcing admins to test each card one by one.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Import Presets Runtime Key Reuse Increment

### Changes

- Changed the HTTP import-presets default in `deploy/admin_routes.py`:
  - `copy_runtime_env_keys` now defaults to `true` for `POST /api/admin/api-configs/import-presets`.
  - The lower-level service default remains unchanged, so tests and custom callers can still opt out explicitly.
- Updated the native React API config page in `deploy/new_html/admin/AdminSettingsPage.tsx`:
  - The `导入预设` action now explicitly sends:
    - `copy_runtime_env_keys: true`
    - `update_existing_empty_keys: true`
    - `enable_copied_keys: true`
  - The success toast now reports imported rows, updated empty-key rows, copied keys, and missing keys.
- Updated `deploy/scripts/check_admin_api_config_import.py`:
  - Added a contract check that the HTTP route default copies runtime env keys.
- Updated `deploy/docs/api.md`:
  - Documented that import-presets defaults to copying current runtime env keys into DB configs.

### Verification

- Local checks passed:
  - `py_compile` for `admin_routes.py` and `check_admin_api_config_import.py`
  - `scripts/check_admin_api_config_import.py`
  - `scripts/check_route_contract.py` -> `openapi_paths=227`, `openapi_operations=283`
- Local TypeScript check still reports unrelated pre-existing project errors; no `AdminSettingsPage.tsx` errors were reported.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_import_presets_copy_keys_20260619-002657`
- Server checks passed:
  - `py_compile`
  - `scripts/check_admin_api_config_import.py`
  - `scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server service restart passed:
  - `sudo systemctl restart drama`
  - service status: `active`
- Live dry-run verification passed:
  - `POST https://mecha.one/api/admin/api-configs/import-presets` with body `{"dry_run": true}`
  - HTTP `200`
  - `dry_run=True`
  - `copy_runtime_env_keys=True`
  - `env_refreshed=None`
- Smoke test passed:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This makes the admin import flow match the intended “existing keys can keep being used” behavior: if systemd/env already has usable keys, import can encrypt them into DB-backed API configs and hot-refresh runtime state.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Admin Runtime Diagnostics UI Increment

### Changes

- Extended the native React API config card in `deploy/new_html/admin/AdminSettingsPage.tsx`.
- Each provider card now surfaces runtime diagnostics already returned by `GET /api/admin/api-configs`:
  - API key source (`api_key_env` / `api_key_source`)
  - endpoint source (`endpoint_env` / `endpoint_source`)
  - proxy mode
  - runtime source (`db` / `env` / `missing`)
  - effective DB config name/id
  - keyed enabled config count
  - enabled endpoint count
  - failover target and reason
- Runtime issue codes are now shown as readable labels:
  - `missing_key` -> `缺少 Key`
  - `missing_endpoint` -> `缺少 Endpoint`
  - `db_multiple_keyed_enabled_configs` -> `多条启用配置共享同一 Key`
  - `db_endpoint_conflict` -> `启用配置 Endpoint 冲突`
  - `custom_proxy_missing` -> `自定义代理未填写`

### Verification

- Local checks:
  - Full TypeScript check still reports unrelated pre-existing project errors.
  - No `AdminSettingsPage.tsx` errors after the JSX fix.
  - `scripts/check_admin_api_config_crud.py` passed.
  - `scripts/check_provider_contract.py` passed.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_admin_runtime_diagnostics_20260619-003428`
- Server build passed:
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server service health remained OK:
  - `systemctl is-active drama` -> `active`
  - `https://mecha.one/health` -> HTTP `200`
- Built asset verification passed:
  - asset contains `生效配置`
  - asset contains `多条启用配置`
  - asset contains `Endpoint`
- Smoke test passed:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This does not add backend routes; it exposes existing runtime_status diagnostics in the admin UI so endpoint/key conflicts are visible before swapping providers or moving to self-hosted APIs.
- No files under `pipeline/`, `agent_routes.py`, or `workflows/*.json` were modified.

## 2026-06-19 Manual API Runtime Reload Increment

### Changes

- Added a manual runtime reload endpoint:
  - `POST /api/admin/api-configs/reload-env`
  - Calls the existing `load_api_configs_to_env()` path.
  - Returns only safe metadata: `success`, `env_refreshed`, `loaded`, `loaded_providers`, and `error`.
- Updated the native React API config page:
  - Added a `刷新运行时` button next to the API config refresh controls.
  - On success it reloads `/api/admin/api-configs` so runtime diagnostics update immediately.
- Updated route contract:
  - OpenAPI paths: `228`
  - OpenAPI operations: `284`
- Updated `deploy/docs/api.md` with the new endpoint.

### Verification

- Local checks passed:
  - `py_compile` for `admin_routes.py` and `check_route_contract.py`
  - `scripts/check_route_contract.py` -> `openapi_paths=228`, `openapi_operations=284`
- Local TypeScript check still reports unrelated pre-existing project errors; no `AdminSettingsPage.tsx` errors were reported.
- Server backup created:
  - `/home/Administrator/deploy_backups/mecha_api_reload_env_20260619-003948`
- Server checks passed:
  - `py_compile`
  - `scripts/check_route_contract.py`
  - `cd /home/Administrator/deploy/new_html && npm run build`
- Server restart passed:
  - `sudo systemctl restart drama`
  - service status: `active`
- Live endpoint verification passed:
  - `POST https://mecha.one/api/admin/api-configs/reload-env`
  - HTTP `200`
  - `env_refreshed=True`
- Built asset verification passed:
  - asset contains `刷新运行时`
  - asset contains `/api/admin/api-configs/reload-env`
- Smoke test passed:
  - `python3 /tmp/smoke_test.py https://mecha.one Liu3753650@`
  - result: `9/9`

### Notes

- This supports the no-restart API management workflow: an admin can force DB-backed API config projection into process env and immediately refresh runtime diagnostics.
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

## 2026-06-21 Auth User Service DB Plumbing Cleanup

### Changes

- Added `deploy/services/auth_user_service.py` for DB credential checks, login user-row sync, default permissions, and token-authenticated user-row auto-creation.
- Removed `get_db_manager` plumbing from `deploy/routers/auth.py` and from the `cluster_main.py` auth router registration.
- Replaced inline `require_auth` user auto-create logic with `ensure_authenticated_user_record(...)`.
- Added DB-unavailable fallbacks to the `UserDAO` methods used by auth.
- Added auth service tests and route contract guards, and included the new files in `deploy/scripts/live_deploy_mvc2.sh`.

### Verification

- Local `py_compile` passed for touched backend files.
- Local `pytest tests/test_auth_user_service.py tests/test_user_dao_admin_delete.py -q` passed `10/10`.
- Local route contract passed with `openapi_paths=231`, `openapi_operations=287`.
- Local architecture contract suite passed `9/9`.

## 2026-06-21 Files Router DB Plumbing Cleanup

### Changes

- Removed `get_db_manager` plumbing from `deploy/routers/files.py` and from the `cluster_main.py` file router registration.
- Let thumbnail lookup for `/api/files/{file_id}` rely on `FileDAO.get_file()` directly.
- Added a DB-unavailable fallback to `FileDAO.get_file()`.
- Added `deploy/tests/test_content_file_dao.py`, route contract guards, and deploy-script inclusion for the new test.

### Verification

- Local `py_compile` passed for touched backend files.
- Local `pytest tests/test_content_file_dao.py tests/test_task_read_service.py -q` passed `7/7`.
- Local route contract passed with `openapi_paths=231`, `openapi_operations=287`, `service_mapper_purity_checks=587`.
- Local architecture contract suite passed `9/9`.

## 2026-06-21 Entity Files Router DB Plumbing Cleanup

### Changes

- Removed unused `get_db_manager_func` plumbing from `deploy/routers/entity_files.py`.
- Removed `get_db_manager` import and entity-file router DB pass-through from `deploy/api_routes.py`.
- Added a DB-unavailable fallback to `FileDAO.get_user_files()`.
- Expanded `deploy/tests/test_content_file_dao.py` and route contract guards for the entity-file router boundary.

### Verification

- Local `py_compile` passed for touched backend files.
- Local `pytest tests/test_content_file_dao.py tests/test_project_read_access.py -q` passed `8/8`.
- Local route contract passed with `openapi_paths=231`, `openapi_operations=287`, `entity_file_route_handlers=13`.
- Local architecture contract suite passed `9/9`.
- Runtime route/service DB plumbing search now only finds `cluster_main.py` lifecycle DB management.

## 2026-06-21 Three.js Chunk Split

### Changes

- Added a dedicated Vite `three-vendor` manual chunk for the optional 3D angle controller.
- Added route contract guards so Three.js imports stay inside the optional 3D controller boundary.

### Verification

- Local route contract passed with `frontend_three_chunk_checks=3`.
- Local architecture contract suite passed `9/9`.
- Server build succeeded and split `MultiAngle3DController` down to 11.46 kB while moving Three.js to a cacheable `three-vendor` chunk.
- Server route/architecture contracts passed.
- Online smoke test passed `9/9`.

## 2026-06-21 React Flow Chunk Split

### Changes

- Added a dedicated Vite `flow-vendor` manual chunk for the Canvas route.
- Added route contract guards so `@xyflow/react` imports stay inside `CanvasPage` and the `canvas/` node boundary.

### Verification

- Local route contract passed with `frontend_flow_chunk_checks=4`.
- Local architecture contract suite passed `9/9`.
- Server build succeeded and split `CanvasPage` down to 7.39 kB while moving React Flow to a cacheable `flow-vendor` chunk.
- Server route/architecture contracts passed.
- Online smoke test passed `9/9`.

## 2026-06-21 Core Frontend Vendor Split

### Changes

- Added dedicated Vite `router-vendor` and `query-vendor` manual chunks for `react-router-dom` and `@tanstack/react-query`.
- Added route contract guards for the core frontend vendor split.

### Verification

- Local route contract passed with `frontend_core_vendor_chunk_checks=2`.
- Local architecture contract suite passed `9/9`.
- Server build succeeded and split `index` down to 250.74 kB while moving router/query libraries to cacheable vendor chunks.
- Server route/architecture contracts passed.
- Online smoke test passed `9/9`.

## 2026-06-21 Utility Frontend Vendor Split

### Changes

- Replaced the mixed Vite `utils` manual chunk with dedicated `icons-vendor` and `id-vendor` chunks for `lucide-react` and `uuid`.
- Added route contract guards so icon and id libraries stay as explicit cacheable utility vendor chunks.

### Verification

- Local route contract passed with `frontend_utility_vendor_chunk_checks=4`.
- Local architecture contract suite passed `9/9`.
- Server build succeeded and split utility dependencies into:
  - `icons-vendor-*.js`: 61.64 kB build output, 61K on disk
  - `id-vendor-*.js`: 0.94 kB build output, 941 bytes on disk
  - `index-*.js`: 250.80 kB build output, 245K on disk
- Server route/architecture contracts passed.
- Online smoke test passed `9/9`.

## 2026-06-21 Legacy Workspace Lazy Views

### Changes

- Converted `WorkspaceApp` legacy Materials, Generation, Video, History, and Admin views from static imports to `React.lazy()` boundaries.
- Added local Suspense fallbacks for those legacy views so `/workflow/script` no longer has direct synchronous imports for non-script workspaces.
- Expanded the frontend workflow chunk contract to forbid reintroducing those static legacy imports.

### Verification

- Local route contract passed with `frontend_workflow_chunk_checks=17`.
- Local architecture contract suite passed `9/9`.
- Server `live_deploy_mvc2.sh` build and restart succeeded.
- Server build kept the legacy views in independent chunks:
  - `ScriptPage-*.js`: 141.58 kB build output, 139K on disk
  - `MaterialPage-*.js`: 58K on disk
  - `GenerationPage-*.js`: 89K on disk for the legacy component chunk
  - `VideoPage-*.js`: 149K on disk
  - `AdminPage-*.js`: 54K on disk
  - `HistoryPage-*.js`: 14K on disk
- Server route/architecture contracts passed.
- Online smoke test passed `9/9`.

## 2026-06-21 API Provider Health Model Targeting

### Changes

- Added optional `model_name` targeting to `GET /api/admin/api-configs/{provider_id}/health`.
- Extended provider health sweeps to accept `targets=[{provider, model_name}]`, so batch health checks can test the currently effective provider/model pair instead of only a provider default.
- Updated the admin API settings UI so provider cards and batch health refresh pass the active model name from the primary DB config/runtime status.
- Added contracts for model-aware provider health checks and model-aware health sweep targets.

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

- Removed unused `react-markdown` and `remark-gfm` from `deploy/new_html/package.json`.
- Regenerated `deploy/new_html/package-lock.json` with the server npm result, pruning the unused Markdown renderer packages and their unreachable dependency tree.
- Added `check_frontend_dependency_contract()` to `deploy/scripts/check_route_contract.py` so those packages cannot be reintroduced through dependencies, lockfile entries, or frontend source imports.

### Verification

- Deployed the cleanup build with `scripts/live_deploy_mvc2.sh`; server Vite build passed and `drama.service` stayed `active`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`, including `frontend_dependency_checks=11`.
- Online smoke test against `https://mecha.one` passed `9/9`.
- Local exact search found no `react-markdown`, `remark-gfm`, `ReactMarkdown`, or `remarkGfm` references in frontend source/config after cleanup.
- Server npm lockfile verification passed with `npm install --package-lock-only --ignore-scripts`; npm normalized the lockfile to 241 package entries.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `scripts/check_route_contract.py` passed with `frontend_dependency_checks=11`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Note: server npm audit still reports existing dependency audit findings (`1 low`, `2 moderate`, `6 high`); this cleanup removes unused packages but does not attempt a broad dependency upgrade.

## 2026-06-21 Task Notification Service Split

### Changes

- Extracted task polling and persistent notification API helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/taskNotificationService.ts`.
- Updated `globalTaskManager` and `TaskContext` to import task/notification APIs from the new service directly.
- Kept `apiService.ts` compatibility re-exports so older imports continue to work while new task code has a clear ownership boundary.
- Strengthened `scripts/check_route_contract.py` so task notification endpoints are checked against `taskNotificationService.ts` and `globalTaskManager` cannot drift back to the monolithic service.

### Verification

- Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6829`.
- Local `scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.

## 2026-06-21 Video Workspace Service Split

### Changes

- Extracted pure video task/session types into `deploy/new_html/services/videoTaskTypes.ts`.
- Extracted workspace session persistence, storyboard metadata, and reactive duration mapping into `deploy/new_html/services/videoWorkspaceService.ts`.
- Kept `deploy/new_html/services/videoService.ts` as a compatibility re-export while removing duplicated task/session type and workspace API implementations from it.
- Updated `VideoGenPage`, `VideoPage`, `VideoCard`, `storyboardSync`, `useReactiveDuration`, `StoryboardSyncModal`, and `videoTaskInsert` to consume the narrower type/workspace services directly.
- Strengthened `deploy/scripts/check_route_contract.py` to guard `videoTaskTypes.ts`, `videoWorkspaceService.ts`, and the direct workspace-service imports.
- Updated `DashScopeCards.test.tsx` to match the current Kling mode toggle behavior: `Omni` / `Multi`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7125`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local UTF-8 scan passed for `deploy/new_html/**/*.ts*`.
- Local npm was unavailable on Windows PATH, so frontend build/tests were verified on the server.
- Server `scripts/live_deploy_mvc2.sh` timed out locally while remote build was still running; the remote build was completed manually with `npm run build`, then `drama.service` was restarted and reported `active`.
- Server build emitted a standalone `videoWorkspaceService-*.js` chunk at `1.11 kB`; app shell `index-*.js` is `236.01 kB`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=5993`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Server Vitest subset passed `56/56`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Task Service Split

### Changes

- Extracted video generation task submission, task status/history/cancel/delete APIs, queued ComfyUI task wrappers, Seedance/DashScope task submitters, storyboard audio mixing, UUID helpers, and bounded concurrency helper from `deploy/new_html/services/videoService.ts` into `deploy/new_html/services/videoTaskService.ts`.
- Reduced `deploy/new_html/services/videoService.ts` to a 66-line compatibility facade that re-exports the focused video services.
- Updated `VideoPage`, `VideoGenPage`, `EnhancePage`, `videoTaskPoller`, `ttsTaskPoller`, `TaskContext`, `storyboardSync`, and `videoTaskInsert` to import task APIs/helpers directly from `videoTaskService.ts`.
- Kept the existing compatibility import test in `videoMediaService.test.ts` so legacy `videoService` callers remain covered.
- Strengthened `deploy/scripts/check_route_contract.py` to guard `videoTaskService.ts` ownership and direct task-service imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7145`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local UTF-8 scan passed for `deploy/new_html/**/*.ts*`.
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

- Extracted video generation task submission, task status/history/cancel/delete APIs, queued ComfyUI task wrappers, Seedance/DashScope task submitters, storyboard audio mixing, UUID helpers, and bounded concurrency helper from `deploy/new_html/services/videoService.ts` into `deploy/new_html/services/videoTaskService.ts`.
- Reduced `deploy/new_html/services/videoService.ts` to a 66-line compatibility facade that re-exports the focused video services.
- Updated `VideoPage`, `VideoGenPage`, `EnhancePage`, `videoTaskPoller`, `ttsTaskPoller`, `TaskContext`, `storyboardSync`, and `videoTaskInsert` to import task APIs/helpers directly from `videoTaskService.ts`.
- Kept the existing compatibility import test in `videoMediaService.test.ts` so legacy `videoService` callers remain covered.
- Strengthened `deploy/scripts/check_route_contract.py` to guard `videoTaskService.ts` ownership and direct task-service imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7145`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local UTF-8 scan passed for `deploy/new_html/**/*.ts*`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build kept app shell `index-*.js` at `236.01 kB` and `VideoPage-*.js` at `154.53 kB`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6013`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Server Vitest subset passed `56/56`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Model Service Split

### Changes

- Extracted pure video model names/types, Seedance media params, DashScope params/defaults, model display names, selectable model list, and task-type inference helpers from `deploy/new_html/services/videoService.ts` into `deploy/new_html/services/videoModelService.ts`.
- Kept `videoService.ts` compatibility re-exports while task submission remains in the generation service.
- Updated DashScope cards/tests, Seedance helper components, video card layout helpers, and `VideoPage.tsx` imports to use `videoModelService.ts` directly.
- Strengthened `deploy/scripts/check_route_contract.py` so pure model-service ownership and the production `SELECTABLE_MODELS` whitelist stay guarded.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7091`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.

## 2026-06-21 Episode Data Service Split

### Changes

- Extracted episode storyboard/assets/audio/video/script/character data helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/episodeDataService.ts`.
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

- Extracted audio track writes, audio generation, character voice writes, and MiniMax audio helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/audioGenerationService.ts`.
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

- Extracted video segment writes, Seedance/ComfyUI capability probes, video takes, and final compose helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/videoWorkflowService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing the duplicated video workflow implementation from the monolithic file.
- Updated `FinalProductPage`, `EnhancePage`, `GenerationPage`, `VideoPage`, and `SeedanceMultimodalPanel` to import video workflow APIs directly from the new service.
- Added `videoWorkflowService.test.ts` and strengthened `deploy/scripts/check_route_contract.py` so video workflow endpoint ownership stays in the new service.

### Verification

- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=6904`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vitest could not run because the Windows `node_modules` is missing Rollup optional dependency `@rollup/rollup-win32-x64-msvc`; server tests below are authoritative.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `videoWorkflowService-*.js` as a separate `0.94 kB` chunk and reduced the built `apiService-*.js` chunk to `7.49 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `52/52`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Asset and Storyboard Mutation Service Split

### Changes

- Extracted asset create/update/delete/share helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/assetMutationService.ts`.
- Extracted storyboard create/delete/delete-all/reorder/export helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/storyboardMutationService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing duplicated asset/storyboard mutation implementations from the monolithic file.
- Updated `DesignPage`, `MaterialsPage`, `StoryboardGenPage`, `AudioStagePage`, and `WorkspaceApp` to import these mutations directly from the new services.
- Added focused `assetMutationService.test.ts` and `storyboardMutationService.test.ts`, and strengthened `deploy/scripts/check_route_contract.py` so these endpoint families stay with their new owners.

### Verification

- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=6946`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local `tsc --noEmit` remains blocked by existing project TS debt unrelated to this split, including missing Seedance test fixtures and legacy Workspace/App prop/type mismatches.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `assetMutationService-*.js` (`0.35 kB`) and `storyboardMutationService-*.js` (`0.63 kB`) as separate chunks, reducing the built `apiService-*.js` chunk to `5.36 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `59/59`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Script Timeline Service Split

### Changes

- Extracted multi-script CRUD, script segment batch operations, and timeline track helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/scriptTimelineService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing duplicated script/timeline implementations from the monolithic file.
- Updated `WorkspaceApp` to import script/timeline APIs directly from the new service.
- Added `scriptTimelineService.test.ts` and strengthened `deploy/scripts/check_route_contract.py` so script/timeline endpoint ownership stays in the new service.

### Verification

- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=6965`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `scriptTimelineService-*.js` (`0.82 kB`) as a separate chunk and reduced the built `apiService-*.js` chunk to `4.73 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `64/64`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Admin Compatibility Service Split

### Changes

- Extracted legacy admin users, stats, and generation log helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/adminCompatService.ts`.
- Kept `apiService.ts` compatibility re-exports while removing duplicated admin endpoint implementations from the monolithic file.
- Updated `AdminPage` to import admin compatibility APIs directly from the new service.
- Added `adminCompatService.test.ts` and strengthened `deploy/scripts/check_route_contract.py` so these legacy admin endpoint helpers stay with their new owner.

### Verification

- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=6984`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `adminCompatService-*.js` (`0.70 kB`) as a separate chunk and reduced the built `apiService-*.js` chunk to `4.20 kB`.
- Server `npm run test:run -- --pool=forks __tests__/services/adminCompatService.test.ts __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/apiService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `70/70`.
- Server `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6588`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 ComfyUI Bridge Service Split

### Changes

- Extracted `uploadImageToComfyUI` and `processMaterial` from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/comfyuiBridgeService.ts`.
- Updated `geminiService.ts` dynamic imports to load the smaller ComfyUI bridge chunk instead of the full `apiService.ts` compatibility layer.
- Kept `apiService.ts` compatibility re-exports while removing duplicated ComfyUI/material-processing implementations from the monolithic file.
- Moved upload coverage from `apiService.test.ts` to `comfyuiBridgeService.test.ts` and strengthened `deploy/scripts/check_route_contract.py` to keep this boundary from regressing.

### Verification

- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=7004`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `comfyuiBridgeService-*.js` (`1.83 kB`) as a separate chunk, reduced `apiService-*.js` to `2.76 kB`, and reduced `geminiService-*.js` to `14.90 kB`.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/comfyuiBridgeService.test.ts __tests__/services/adminCompatService.test.ts __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `70/70`.
- Server `scripts/check_route_contract.py` passed with `frontend_http_client_checks=6608`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Project Workflow Service Split

### Changes

- Extracted project CRUD, project member management, episode management, and export-to-video helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/projectWorkflowService.ts`.
- Updated `deploy/new_html/components/ShareResourceDialog.tsx` and `deploy/new_html/WorkspaceApp.tsx` to import the project workflow API directly from the new service.
- Kept `apiService.ts` compatibility re-exports while removing duplicated project and episode implementations from the monolithic file.
- Added `projectWorkflowService.test.ts` and strengthened `deploy/scripts/check_route_contract.py` so project workflow endpoint ownership stays with the new service.

### Verification

- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=7026`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `projectWorkflowService-*.js` (`0.58 kB`) as a separate chunk and no longer emitted a separate built `apiService-*.js` business chunk for this path.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/projectWorkflowService.test.ts __tests__/services/comfyuiBridgeService.test.ts __tests__/services/adminCompatService.test.ts __tests__/services/scriptTimelineService.test.ts __tests__/services/assetMutationService.test.ts __tests__/services/storyboardMutationService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/episodeDataService.test.ts __tests__/services/audioGenerationService.test.ts __tests__/contexts/EpisodeContext.test.tsx __tests__/routing/routing.test.tsx` passed `75/75`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6630`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Canvas Service Split

### Changes

- Extracted canvas board, node, and connection helpers from `deploy/new_html/services/apiService.ts` into `deploy/new_html/services/canvasService.ts`.
- Kept `apiService.ts` as a thin compatibility re-export layer; it no longer imports `apiJson` or contains `/api/canvas/*` calls.
- Added `canvasService.test.ts` for board/node/connection request contracts.
- Strengthened `deploy/scripts/check_route_contract.py` so canvas endpoint ownership stays in `canvasService.ts`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=7046`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vitest was unavailable because `npm` was not on the Windows PATH.
- Server build completed successfully after the initial live deploy command timed out while `npm run build` was still running; the build was completed manually, then `drama.service` was restarted and reported `active`.
- Server production assets no longer include `apiService-*.js` or `canvasService-*.js`; the compatibility layer is tree-shaken for this path.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/canvasService.test.ts __tests__/services/apiService.handleResponse.test.ts` passed `6/6`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6650`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Media Service Split

### Changes

- Extracted media URL signing, image/audio/video upload, project video task import cleanup, crop, and reupload helpers from `deploy/new_html/services/videoService.ts` into `deploy/new_html/services/videoMediaService.ts`.
- Kept `videoService.ts` compatibility re-exports while removing duplicated media/upload implementations from the larger video generation service.
- Updated `deploy/new_html/components/SeedanceMultimodalPanel.tsx` to import upload helpers directly from `videoMediaService.ts`.
- Added `videoMediaService.test.ts` for media URL tokenization, project video task import cleanup, crop, and reupload request contracts.
- Strengthened `deploy/scripts/check_route_contract.py` so media/upload endpoint ownership stays in `videoMediaService.ts`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=7075`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vitest was unavailable because `npm` was not on the Windows PATH.
- Server `scripts/live_deploy_mvc2.sh` built frontend successfully and kept `drama.service` active.
- Server build emitted `index-DrKLO5Y8.js` at `237.88 kB`, down from the prior `240.51 kB` app shell build; `VideoPage` remains the next large target at `154.44 kB`.
- Server `npm run test:run -- --pool=forks --testTimeout=15000 __tests__/services/videoMediaService.test.ts __tests__/services/videoWorkflowService.test.ts __tests__/services/canvasService.test.ts __tests__/routing/routing.test.tsx` passed `23/23`.
- Server `scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6679`.
- Server `scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 ComfyUI Generation Service Split

### Changes

- Extracted ComfyUI generation task submission, task polling, task registry synchronization, queued wrappers, material processing, matting, image fusion, panorama, auto-storyboard, and multi-grid storyboard helpers from `deploy/new_html/services/geminiService.ts` into `deploy/new_html/services/comfyuiGenerationService.ts`.
- Reduced `deploy/new_html/services/geminiService.ts` to Gemini text/proxy image helpers plus a compatibility re-export for existing imports.
- Updated `GenerationPage`, `MaterialPage`, and `DesignPage` to import ComfyUI generation helpers directly from `comfyuiGenerationService.ts`.
- Strengthened `deploy/scripts/check_route_contract.py` so ComfyUI generation endpoint ownership and direct page imports stay guarded.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7153`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local npm remains unavailable on Windows PATH, so frontend build was verified on the server.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `geminiService-*.js` at `15.60 kB`; app shell `index-*.js` stayed at `236.01 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6021`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 ComfyUI Task Wait Service Split

### Changes

- Extracted ComfyUI task status polling, wait helpers, queue status export, queue metadata conversion, and task registry synchronization from `deploy/new_html/services/comfyuiGenerationService.ts` into `deploy/new_html/services/comfyuiTaskWaitService.ts`.
- Kept `deploy/new_html/services/comfyuiGenerationService.ts` focused on generation task submission, queued wrapper orchestration, and ComfyUI workflow calls.
- Updated `GenerationPage`, `MaterialPage`, and `DesignPage` to import wait/status helpers directly from `comfyuiTaskWaitService.ts`.
- Strengthened `deploy/scripts/check_route_contract.py` so task polling ownership stays in the wait service and page imports stay explicit.
- During deployment, repaired the server frontend dependency state by rebuilding `deploy/new_html/node_modules` with `npm ci` after an interrupted build left dependency resolution inconsistent.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7205`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server frontend build passed after dependency refresh; emitted `comfyuiGenerationService-KPusP5yP.js` at `14.48 kB` and app shell `index-C8C0dirM.js` at `236.02 kB`.
- Server `drama.service` restarted successfully and reported `active`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6073`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Gemini/ComfyUI Chunk Decoupling

### Changes

- Removed the broad `export * from './comfyuiGenerationService'` compatibility export from `deploy/new_html/services/geminiService.ts`.
- Kept current callers explicit: Gemini image/text helpers continue to import from `geminiService.ts`, while ComfyUI generation helpers import from `comfyuiGenerationService.ts`.
- Strengthened `deploy/scripts/check_route_contract.py` to fail if `geminiService.ts` imports or re-exports `comfyuiGenerationService.ts` again.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7156`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted a standalone `comfyuiGenerationService-*.js` chunk at `15.00 kB`, with app shell `index-*.js` at `236.02 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6024`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Gemini Image Generation Service Split

### Changes

- Extracted Gemini image generation helpers from `deploy/new_html/services/geminiService.ts` into `deploy/new_html/services/geminiImageGenerationService.ts`.
- Updated `GenerationPage`, `MaterialPage`, and `DesignPage` to import Gemini image helpers directly from `geminiImageGenerationService.ts`.
- Kept `geminiService.ts` as a smaller text/compatibility layer that re-exports the image helpers for legacy callers.
- Strengthened `deploy/scripts/check_route_contract.py` so image-heavy pages cannot regress back to importing `geminiService.ts` for Gemini image generation.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7179`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build no longer emitted a standalone `geminiService-*.js` chunk for the image-heavy pages; app shell `index-*.js` stayed at `236.02 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6047`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Provider Panel Chunk Split

### Changes

- Split `deploy/new_html/components/video/SeedancePanelWithCandidates.tsx` and `deploy/new_html/components/video/DashScopeCardWithCandidates.tsx` out of `deploy/new_html/components/video/VideoCard.tsx`.
- Converted `VideoPage` provider panels to `React.lazy` chunks with stable-height fallbacks, so Seedance/DashScope UI loads only for cards that need those provider controls.
- Kept `VideoCard.tsx` as a lightweight shared primitive module for duration fields, audio badges, and storyboard image display.
- Strengthened `deploy/scripts/check_route_contract.py` so `VideoCard.tsx` cannot regress to statically importing `SeedanceMultimodalPanel`, `DashScopeCards`, `DashScopeVideoCard`, or `SeedanceMentionPromptEditor`.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7223`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `VideoPage-pELF8rue.js` at `136.13 kB`, down from the prior `VideoPage-CDrwW23j.js` at `154.53 kB`; provider panels split into `DashScopeCardWithCandidates-BO6mW1KA.js` at `20.31 kB` and `SeedancePanelWithCandidates-C63PjtFh.js` at `0.94 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6091`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Video Modal Chunk Split

### Changes

- Converted the `SeedanceDetailModal` and `StoryboardSyncModal` paths in `deploy/new_html/components/VideoPage.tsx` to `React.lazy` chunks.
- Kept `SyncMode` as a type-only import so the storyboard sync modal module is not loaded before the user opens it.
- Added a full-screen modal fallback for lazy video modals and guarded `StoryboardSyncModal` rendering behind `syncModalOpen`, preventing open=false modals from triggering lazy chunk loads.
- Strengthened `deploy/scripts/check_route_contract.py` so VideoPage cannot regress to static modal imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=7230`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `VideoPage-CG5hoBqM.js` at `96.59 kB`, down from the prior `VideoPage-pELF8rue.js` at `136.13 kB`.
- Server build split lazy chunks: `SeedanceMultimodalPanel-DCi4iMPb.js` at `17.78 kB`, `SeedanceMentionPromptEditor-KAqryN0u.js` at `19.39 kB`, `SeedanceDetailModal-CIv0Cr22.js` at `1.95 kB`, and `StoryboardSyncModal-BtIw91QI.js` at `2.74 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_http_client_checks=6098`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Script Route Workspace Chunk Split

### Changes

- Converted `deploy/new_html/pages/ScriptPage.tsx` from a static `WorkspaceApp` import to a `React.lazy` route shell.
- Added `ScriptWorkspaceFallback` so the workflow shell can render immediately while the legacy workspace chunk loads.
- Strengthened `deploy/scripts/check_route_contract.py` so `ScriptPage` must lazy-load `WorkspaceApp` and cannot regress to a static import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=20`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `ScriptPage-jGEDm0NN.js` at `1.56 kB`, down from the prior script route chunk around `142.57 kB`; `WorkspaceApp-4C9Q9N6Y.js` is now an independent `142.14 kB` lazy chunk.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=20`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Workspace Editor Column Chunk Split

### Changes

- Converted the legacy editor columns in `deploy/new_html/WorkspaceApp.tsx` (`FileColumn`, `ViewerColumn`, `ScriptColumn`, `StoryboardColumn`) from static imports to `React.lazy` chunks.
- Added `LegacyColumnFallback` so each old editor column can load independently without changing props, resize state, or editor workflow behavior.
- Strengthened `deploy/scripts/check_route_contract.py` so `WorkspaceApp` must lazy-load editor columns and cannot regress to static imports.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=29`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `WorkspaceApp-BbSuuWpT.js` at `67.71 kB`, down from the prior `WorkspaceApp-4C9Q9N6Y.js` at `142.14 kB`.
- Server build split editor columns into `FileColumn-C1r1P__t.js` at `14.15 kB`, `ViewerColumn-CXj8ZXoL.js` at `3.74 kB`, `ScriptColumn-CuUAcLga.js` at `30.24 kB`, and `StoryboardColumn-Do3vooFZ.js` at `28.28 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_workflow_chunk_checks=29`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 App Shell Video Task Chunk Split

### Changes

- Removed the static `videoTaskService` import from `deploy/new_html/contexts/TaskContext.tsx`.
- Converted backend task cancellation to a dynamic `import('../services/videoTaskService')`, keeping the optimistic local cancel behavior unchanged while avoiding video task submission/model code in the app shell.
- Strengthened `deploy/scripts/check_route_contract.py` so `TaskContext` must lazy-load `videoTaskService` and cannot regress to a static app-shell import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=7230`, and `frontend_app_shell_chunk_checks=11`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-DvjkqY_w.js` at `223.32 kB`, down from the prior `index-Dt9pk4qe.js` at `236.00 kB`.
- Server build split `videoTaskService-D_YRmEfM.js` at `9.69 kB`, loaded only when the global task context needs backend cancellation.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=6098`, and `frontend_app_shell_chunk_checks=11`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Task Control Service Split

### Changes

- Added `deploy/new_html/services/taskControlService.ts` for lightweight task control calls (`cancelTask`, `deleteTask`).
- Updated `deploy/new_html/contexts/TaskContext.tsx` to dynamically import `taskControlService` instead of `videoTaskService` when cancelling a task.
- Kept `deploy/new_html/services/videoTaskService.ts` backward-compatible by re-exporting `cancelTask` and `deleteTask`, while removing the direct implementations from the video generation service.
- Strengthened `deploy/scripts/check_route_contract.py` so task control ownership stays in `taskControlService`, and the app shell cannot regress to loading `videoTaskService` for cancellation.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=7251`, and `frontend_app_shell_chunk_checks=12`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `taskControlService-boNdFV2m.js` at `0.50 kB`, replacing the cancellation-time load of the full `videoTaskService` chunk.
- Server build emitted `videoTaskService-1SkFLo-c.js` at `9.19 kB`, down from the prior `videoTaskService-D_YRmEfM.js` at `9.69 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, `frontend_http_client_checks=6119`, and `frontend_app_shell_chunk_checks=12`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Gemini Image Alias Registry Move

### Changes

- Moved Gemini image model aliases from `deploy/services/ai_proxy_service.py` into `deploy/services/api_provider_registry.py`.
- Added registry-owned `normalize_gemini_image_model()` so AI proxy handlers consume provider/model metadata from the provider registry.
- Strengthened `deploy/scripts/check_provider_contract.py` so `GEMINI_IMAGE_MODEL_ALIASES` and `normalize_gemini_image_model()` cannot drift back into `ai_proxy_service.py`.

### Verification

- Local `diff --check` passed.
- Local `deploy/scripts/check_provider_contract.py` passed with `providers=12`, `presets=17`, and `gemini_image_alias_checks=5`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=12`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-DZIRn4Bt.js` at `223.36 kB`, `WorkspaceApp-WwKkM-rG.js` at `67.79 kB`, and `videoTaskService-1SkFLo-c.js` at `9.19 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=12`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Task Runtime App Shell Split

### Changes

- Removed the top-level `useSSEInvalidation` wrapper from `deploy/new_html/App.tsx`.
- Moved task notification query invalidation into `deploy/new_html/contexts/TaskContext.tsx`, so task events are handled by one runtime owner.
- Converted `globalTaskManager`, `taskNotificationService`, and `notificationMapping` from static `TaskContext` imports into dynamic runtime chunks.
- Deleted `deploy/new_html/hooks/useSSEInvalidation.ts` to prevent task transport from drifting back into the app shell.
- Strengthened `deploy/scripts/check_route_contract.py` so app shell chunk contracts reject static task runtime imports and require the new dynamic wiring.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=22`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local Vite build could not run because the Windows `node_modules` tree is missing Rollup optional package `@rollup/rollup-win32-x64-msvc`; no package files were changed for this local environment issue.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-B2nTUbrg.js` at `216.45 kB`, down from the prior `index-DZIRn4Bt.js` at `223.36 kB`.
- Server build split task runtime chunks: `globalTaskManager-DwHjopXU.js` at `4.98 kB`, `taskNotificationService-D9URRPBR.js` at `1.18 kB`, and `notificationMapping-D7Y2oSEc.js` at `2.31 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=22`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Global Toast App Shell Split

### Changes

- Converted `deploy/new_html/components/GlobalToast.tsx` from a static `App.tsx` import to a `React.lazy` chunk.
- Added `DeferredGlobalToastWithNav` so the toast host mounts after idle time and skips `/admin/*` routes.
- Strengthened `deploy/scripts/check_route_contract.py` so `GlobalToast` cannot regress to an eager app-shell import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=27`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-bLIzdp-w.js` at `212.30 kB`, down from the prior `index-B2nTUbrg.js` at `216.45 kB`.
- Server build split `GlobalToast-DK-5BwzP.js` at `4.82 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=27`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 Workspace Organization Service Runtime Split

### Changes

- Converted `deploy/new_html/contexts/WorkspaceContext.tsx` to import `Organization` as type-only and load `listMyOrganizations()` via dynamic `import('../services/organizationService')`.
- Kept `/admin/*` workspace skip behavior unchanged while removing user/admin organization service code from the app shell.
- Strengthened `deploy/scripts/check_route_contract.py` so `WorkspaceContext` cannot regress to a static `listMyOrganizations` import.

### Verification

- Local `diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=30`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Server `scripts/live_deploy_mvc2.sh` completed successfully: frontend built, `drama.service` restarted, service status `active`.
- Server build emitted `index-Cp3pjs-n.js` at `206.53 kB`, down from the prior `index-bLIzdp-w.js` at `212.30 kB`.
- Server build split `organizationService-B_RBM9-T.js` at `1.46 kB` and `httpClient-DncKv2Q5.js` at `3.99 kB`.
- Server `.venv/bin/python scripts/check_route_contract.py` passed with `openapi_paths=231`, `openapi_operations=287`, and `frontend_app_shell_chunk_checks=30`.
- Server `.venv/bin/python scripts/check_architecture_contracts.py` passed `9/9`.
- Online smoke test against `https://mecha.one` passed `9/9`.

## 2026-06-21 External API Runtime Refresh Contract

### Changes

- Added an AST contract in `deploy/scripts/check_provider_contract.py` that verifies shared external API clients refresh provider runtime configuration before request methods use API keys/endpoints.
- Covered MiniMax audio plus MiniMax, Seedance, DashScope, Wan2, Sora2, and Veo video clients.
- The contract allows MiniMax audio's `_url()` helper as an indirect refresh path, and also verifies `_url()` itself calls `_refresh_runtime_config()`.

### Deployment/Config Gap Covered

- Backend admin API config changes are expected to hot-update keys/endpoints without a process restart.
- This contract prevents future provider-client refactors from silently reusing stale API keys, stale endpoints, or old proxy settings after the admin platform refreshes runtime env/config.

### Verification

- Local `python -m py_compile deploy/scripts/check_provider_contract.py`: passed.
- Local `deploy/scripts/check_provider_contract.py`: passed with `external_runtime_refresh_checks=31`.

## 2026-06-21 Frontend Unauthorized Handling Consolidation

### Changes

- Added `handleUnauthorized()` to `deploy/new_html/services/httpClient.ts` as the shared 401/session-expiry handler for both normal fetch clients and special transports.
- Updated `deploy/new_html/services/videoMediaService.ts` so XHR uploads keep upload progress support but reuse the shared 401 redirect/session cleanup behavior.
- Updated `deploy/new_html/services/videoTaskService.ts` so historical task loading no longer clears auth state directly.
- Strengthened `deploy/scripts/check_route_contract.py` so migrated frontend services cannot reintroduce direct `localStorage.removeItem('auth_token')` cleanup and must use the shared unauthorized handler.

### Verification

- Local `diff --check` passed.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_http_client_checks=7299`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`.
- Local targeted Vitest could not run because the Windows `node_modules` tree is still missing Rollup's optional `@rollup/rollup-win32-x64-msvc` package; pnpm execution was also blocked by a local symlink permission error.

## 2026-06-21 Materials/Audio Progressive Storyboard Field Loading

### Changes

- Changed `deploy/new_html/pages/MaterialsPage.tsx` to request only the first 20 `fields=materials` storyboard rows with `include_total=true`, then fill the rest in idle-time background pages of 80 rows.
- Changed `deploy/new_html/pages/AudioStagePage.tsx` to use the same first-screen limit and idle background paging for `fields=audio_stage`.
- Kept existing bounded rendering in `MaterialPage` and `DubbingPanel`; this change reduces the initial data request instead of only hiding already-loaded cards.
- Updated the material auto-binding patcher to track checked storyboard item ids so rows loaded later in background pages are still eligible for `char:/scene:` tag patching.
- Strengthened `deploy/scripts/check_route_contract.py` so both pages must keep limit, total, offset, and idle background paging.

### Verification

- Local `git diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_architecture_contracts.py` passed `9/9`, including `audio_stage_lightweight_storyboard_checks=15` and `materials_lightweight_storyboard_checks=15`.
- Local `vite build` could not run because the Windows `node_modules` tree is still missing Rollup's optional `@rollup/rollup-win32-x64-msvc` package.
- Local `tsc --noEmit` still reports pre-existing project type errors outside this change; the new progressive loading code was not listed.

## 2026-06-21 Frontend Idle Scheduler Consolidation

### Changes

- Added `deploy/new_html/utils/idleScheduler.ts` with shared `runWhenIdle()` and `waitForIdle()` helpers.
- Replaced duplicated `requestIdleCallback` fallback logic in `deploy/new_html/App.tsx`, `VideoGenPage.tsx`, `StoryboardGenPage.tsx`, `MaterialsPage.tsx`, and `AudioStagePage.tsx`.
- `StoryboardGenPage` now cancels the idle asset preload if the page unmounts before the deferred callback runs.
- Strengthened `deploy/scripts/check_route_contract.py` so App shell, storyboard, video, material, and audio workflows keep using the shared idle scheduler.

### Verification

- Local `git diff --check` passed.
- Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
- Local `deploy/scripts/check_route_contract.py` passed with `storyboard_paged_reload_checks=33`, `frontend_app_shell_chunk_checks=36`, and `materials/audio lightweight checks=15/15`.

## 2026-06-21 Image Preload Idle Scheduler Completion

### Changes

- Updated `deploy/new_html/services/imageLoaderService.ts` so image preloading also uses `runWhenIdle()` instead of touching `requestIdleCallback` directly.
- Strengthened `deploy/scripts/check_route_contract.py` so production frontend code can only use `requestIdleCallback` / `cancelIdleCallback` inside `deploy/new_html/utils/idleScheduler.ts`.
- Added explicit contract coverage that `imageLoaderService.ts` keeps both shared `httpClient` and shared `idleScheduler` integration.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile deploy/scripts/check_route_contract.py` passed.
- Local `deploy/scripts/check_route_contract.py` passed with `storyboard_paged_reload_checks=33`, `frontend_http_client_checks=7304`, `frontend_dependency_checks=349`, and `frontend_app_shell_chunk_checks=36`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Admin API Settings Runtime/DB Status Split

### Changes

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so provider cards treat "生效健康" as the primary runtime status and "高级诊断" as the separate DB-record test.
- When a DB record has no saved key but runtime/env key still works, the card and toast now show a yellow warning instead of a green DB success or red provider failure.
- Removed the legacy API edit button that routed users back to `/admin-legacy/?page=apiconfig`; the new `/admin/settings?item=legacy-apiconfig` API management panel is now the self-contained edit path.
- Strengthened `deploy/scripts/check_route_contract.py` to require the new runtime/DB wording and forbid routing API editing back to the legacy console.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile deploy/scripts/check_route_contract.py` passed.
- Local `deploy/scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=124`, `frontend_http_client_checks=7304`, `frontend_dependency_checks=349`, and `frontend_app_shell_chunk_checks=36`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Admin API Settings Legacy Parameter Compatibility

### Changes

- Changed `deploy/new_html/admin/AdminSettingsPage.tsx` so `/admin/settings?item=legacy-apiconfig` now renders the native API provider management panel instead of the old `/admin-legacy` iframe.
- Updated `deploy/new_html/admin/adminMenu.ts` so legacy API config bookmarks keep the normal `系统设置 / API 厂商配置` breadcrumb rather than advertising an old edit surface.
- Strengthened `deploy/scripts/check_route_contract.py` so `legacy-apiconfig` cannot be mapped back to the legacy iframe and old edit labels cannot reappear.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile deploy/scripts/check_route_contract.py` passed.
- Local `deploy/scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=127`, `frontend_http_client_checks=7304`, `frontend_dependency_checks=349`, and `admin_api_config_ui_checks=23`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 SmartApiRouter Dead Code Removal

### Changes

- Deleted `deploy/api_router.py`, the unused `SmartApiRouter` skeleton that still suggested a separate API dispatch path outside `services.ai_proxy_service` and `services.api_provider_runtime`.
- Removed the no-op Redis injection from `deploy/cluster_main.py`.
- Updated `deploy/scripts/live_deploy_mvc2.sh` to remove stale `api_router.py` from the server during deployment.
- Updated current architecture docs to list `routers/` as the route split owner instead of the removed file.
- Strengthened `deploy/scripts/check_route_contract.py` so `api_router.py` stays deleted and `cluster_main.py` cannot inject it again.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile deploy/cluster_main.py deploy/scripts/check_route_contract.py` passed.
- Local Git Bash `bash -n deploy/scripts/live_deploy_mvc2.sh` passed.
- Local `deploy/scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=127`, `frontend_http_client_checks=7304`, and `live_deploy_frontend_checks=13`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Current Architecture Docs API Runtime Refresh

### Changes

- Updated `deploy/ARCHITECTURE.md` so the current backend map points to `routers/` and no longer lists the deleted `api_router.py` as entry-level infrastructure.
- Updated `deploy/docs/安全加固清单.md` so the old SmartApiRouter custom-proxy risk is marked closed rather than active.
- Updated `deploy/docs/架构审计与重构计划.md` to reflect the current provider registry/runtime/API proxy baseline, mark DB endpoint hot-update as live, and move the next API replacement step to self-hosted provider adapters.
- Strengthened `deploy/scripts/check_route_contract.py` with a current-docs contract so active architecture docs cannot drift back to the removed SmartApiRouter model.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile deploy/scripts/check_route_contract.py` passed.
- Local `deploy/scripts/check_route_contract.py` passed with `current_architecture_docs_checks=12`, `api_provider_runtime_model_checks=127`, and `live_deploy_frontend_checks=13`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Live Deploy Current Docs Sync

### Changes

- Updated `deploy/scripts/live_deploy_mvc2.sh` so current architecture docs (`deploy/ARCHITECTURE.md` and `deploy/docs/`) are uploaded with each live deployment.
- Strengthened `deploy/scripts/check_route_contract.py` so future deployments keep those docs in the synced file set.
- This keeps the server-side route/architecture contracts aligned with the current provider-runtime documentation.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile deploy/scripts/check_route_contract.py` passed.
- Local Git Bash `bash -n deploy/scripts/live_deploy_mvc2.sh` passed.
- Local `deploy/scripts/check_route_contract.py` passed with `current_architecture_docs_checks=12` and `live_deploy_frontend_checks=15`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=9`.

## 2026-06-21 Video Legacy Model Alias Registry

### Changes

- Moved Sora2/Veo legacy video model alias handling into `deploy/services/api_provider_registry.py`.
- Updated `deploy/external_api/video/sora2.py` and `deploy/external_api/video/veo.py` to call registry helpers instead of defining local alias normalization functions.
- Updated `deploy/services/api_config_runtime_loader.py` so default provider seeding checks Sora2/Veo legacy model names through registry constants.
- Strengthened `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, and `deploy/tests/test_api_provider_runtime_model_env.py` so future clients cannot drift back to local hardcoded legacy aliases.
- Updated `deploy/scripts/live_deploy_mvc2.sh` to sync the runtime model env test to the server with live deployments.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile` passed for the changed Python modules and contract scripts.
- Local `deploy/scripts/check_provider_contract.py` passed with `video_default_model_checks=38`.
- Local targeted pytest passed: `tests/test_api_provider_runtime_model_env.py` + `tests/test_minimax_audio_runtime.py`, 32 passed.
- Local `deploy/scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=139`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `0b839e3` (`refactor(api-provider): centralize video legacy model aliases`) to `origin/refactor/v2`.
- Ran `deploy/scripts/live_deploy_mvc2.sh`; the local wrapper timed out after service restart, then manual verification confirmed the server was active and the updated files were present.
- Remote file sync check passed: `cluster_main.py` 985 lines, `admin_routes.py` 1502 lines, `dao/` 72 files.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 MiniMax Video Runtime Model Registry

### Changes

- Moved MiniMax video runtime model override and normalization helpers into `deploy/services/api_provider_registry.py`.
- Updated `deploy/external_api/video/minimax.py` so it no longer defines local runtime-model override logic.
- Extended `deploy/scripts/check_provider_contract.py` and `deploy/scripts/check_route_contract.py` to keep MiniMax/Sora2/Veo video model rules registry-owned.
- Extended `deploy/tests/test_api_provider_runtime_model_env.py` with registry helper coverage for MiniMax.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile` passed for the changed Python modules and contract scripts.
- Local `deploy/scripts/check_provider_contract.py` passed with `video_default_model_checks=50`.
- Local targeted pytest passed: `tests/test_api_provider_runtime_model_env.py` + `tests/test_minimax_audio_runtime.py`, 32 passed.
- Local `deploy/scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=144`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `d0a9901` (`refactor(api-provider): centralize minimax video model resolution`) to `origin/refactor/v2`.
- Ran `deploy/scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote file check confirmed `minimax_runtime_model_override` and `normalize_minimax_video_model` are present in the deployed registry/client path.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 DashScope Vidu Model Registry

### Changes

- Moved DashScope Vidu reference/start-end sub-model maps into `deploy/services/api_provider_registry.py`.
- Added `resolve_dashscope_default_model_name()` in `deploy/services/api_provider_runtime.py` so default DashScope model names resolve through runtime sub-model env values outside the client.
- Updated `deploy/external_api/video/dashscope.py` to call registry/runtime helpers instead of defining local Vidu maps or default-model reverse lookup.
- Strengthened `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, and `deploy/tests/test_api_provider_runtime_model_env.py` so DashScope model rules stay centralized.

### Verification

- Local `git diff --check` passed.
- Local `python -m py_compile` passed for the changed Python modules and contract scripts.
- Local `deploy/scripts/check_provider_contract.py` passed with `video_default_model_checks=65`.
- Local targeted pytest passed: `tests/test_api_provider_runtime_model_env.py` + `tests/test_dashscope_video_payload_extension.py`, 39 passed.
- Local `deploy/scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=151`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `1d12d32` (`refactor(api-provider): centralize dashscope video model mapping`) to `origin/refactor/v2`.
- Ran `deploy/scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote `scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote file check confirmed `DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP`, `resolve_dashscope_default_model_name`, and `dashscope_vidu_reference_sub_model` are present in deployed registry/runtime/client paths.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 MiniMax Provider Default Registry Alias

### Changes

- Added `MINIMAX_DEFAULT_PROVIDER_MODEL` in `deploy/services/api_provider_registry.py` as the provider-level default alias for the shared MiniMax API provider.
- Updated `deploy/external_api/audio/minimax_audio.py` so audio runtime config resolves MiniMax through the provider-level alias instead of a video-named constant.
- Strengthened `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, and `deploy/tests/test_minimax_audio_runtime.py` so MiniMax audio stays wired to the provider-level default.
- Verified `deploy/scripts/live_deploy_mvc2.sh` already syncs directory-level `dao`, `services`, `utils`, `routers`, and `schemas`; no `pipeline/`, `agent_routes.py`, or `workflows/` entries are present.

### Verification

- Local `git diff --check` passed.
- Local `deploy/scripts/check_provider_contract.py` passed with `video_default_model_checks=68`.
- Local targeted pytest passed: `tests/test_minimax_audio_runtime.py` + `tests/test_api_provider_runtime_model_env.py`, 34 passed.
- Local `deploy/scripts/check_route_contract.py` passed with `api_provider_runtime_model_checks=152`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `4e9eeca` (`refactor(api-provider): clarify minimax provider default model`) to `origin/refactor/v2`.
- Ran `deploy/scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote `deploy/scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote file sync check: `cluster_main.py` 985 lines, `admin_routes.py` 1502 lines, `dao/` 72 files recursively.
- Remote file check confirmed `MINIMAX_DEFAULT_PROVIDER_MODEL` is present in deployed registry and MiniMax audio client paths.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-21 Frontend Local Tailwind Build

### Changes

- Replaced the production `deploy/new_html/index.html` Tailwind CDN runtime config with local Tailwind/PostCSS build files.
- Added `deploy/new_html/tailwind.config.cjs` and `deploy/new_html/postcss.config.cjs`, moving the Atlassian color, font, and shadow tokens into the build pipeline.
- Added Tailwind directives to `deploy/new_html/styles/design-tokens.css` and moved the existing animation/scrollbar helper CSS out of inline HTML.
- Removed the unused importmap CDN block for React, uuid, lucide, and Google GenAI from the Vite entry HTML.
- Extended `deploy/scripts/check_route_contract.py` so frontend dependency contracts reject runtime Tailwind/importmap CDN regressions and require local Tailwind lockfile/config wiring.

### Verification

- Remote temporary build with `npm ci && npm run build` passed before deployment.
- Production build output changed from runtime Tailwind CDN to a local CSS asset: `index-D1kXhn4K.css` 90.52 KB, gzip 15.64 KB.
- Built `dist/index.html` and assets were checked for `cdn.tailwindcss.com`, `aistudiocdn.com`, and `importmap`; no matches.
- Local `package.json` and `package-lock.json` parse check passed.
- Local `deploy/scripts/check_route_contract.py` passed with `frontend_dependency_checks=371`.
- Local `deploy/scripts/check_architecture_contracts.py` passed with `contracts=10`.

### Deployment

- Pushed commit `976f179` (`perf(frontend): build tailwind locally instead of runtime CDN`) to `origin/refactor/v2`.
- Ran `deploy/scripts/live_deploy_mvc2.sh`; server restart finished with service status `active`.
- Remote frontend build recovered as expected after `npm ci` installed the new Tailwind dependencies, then produced the local CSS asset.
- Remote `deploy/scripts/check_architecture_contracts.py` passed with `contracts=10`.
- Remote dist check confirmed no Tailwind/importmap CDN strings and `dist/assets/index-D1kXhn4K.css` is 89 KB on disk.
- Online smoke test against `https://mecha.one` passed: 9/9.

## 2026-06-22 Runtime CDN/WebFont Removal

- Removed runtime Google Fonts links from `deploy/new_html/index.html`.
- Switched `deploy/new_html/tailwind.config.cjs`, `deploy/new_html/styles/design-tokens.css`, and admin inline mono labels to system font stacks.
- Rebuilt `deploy/login.html` as a self-contained static page with inline CSS/SVG icons instead of Tailwind CDN, Google Fonts, and jsDelivr lucide.
- Removed Google Fonts `@import` from `deploy/admin/style.css`.
- Updated `deploy/scripts/live_deploy_mvc2.sh` to sync `login.html`, the legacy `admin` directory, and `deploy/Agent.md`, so these entrypoint fixes deploy with the rest of the app.
- Strengthened `deploy/scripts/check_route_contract.py` to reject runtime CDN/importmap/webfont dependencies in `new_html/index.html`, `login.html`, and `admin/style.css`.
- Verification:
  - Local `py_compile` for `check_route_contract.py`: passed.
  - Local `check_route_contract.py`: passed with `frontend_dependency_checks=395` and `live_deploy_frontend_checks=37`.
  - Local `check_architecture_contracts.py`: 10/10 passed.
  - Server temporary `new_html` build passed after `npm ci`; generated `dist/index.html` is 811 bytes.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and server architecture contracts passed 10/10.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
- Server grep found no `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.tailwindcss.com`, `cdn.jsdelivr.net`, `unpkg.com`, `aistudiocdn.com`, or `importmap` in deployed app shell/login/admin CSS assets.

## 2026-06-22 Self-contained Static Login

- Removed the remaining `/static/js/auth.js` dependency from `deploy/login.html`.
- The static `/login` page now performs its own minimal unauthenticated `POST /api/login`, writes `auth_token` and `username` to `localStorage`, and redirects to `/projects`.
- Strengthened `deploy/scripts/check_route_contract.py` so `login.html` must contain the inline login/token path and must not depend on `/static/js/auth.js`, `/static/js/api.js`, `Auth.login`, or runtime CDN/webfont snippets.
- Verification:
  - Local HTML parse for `deploy/login.html` and `deploy/new_html/index.html`: passed.
  - Local `git diff --check`: passed.
  - Local `check_route_contract.py`: passed with `frontend_dependency_checks=406`.
  - Local `check_architecture_contracts.py`: 10/10 passed.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and server architecture contracts passed 10/10.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Live `/login` HTML contains `fetch('/api/login')` and `localStorage.setItem(TOKEN_KEY)`, with no `/static/js/auth.js`, `Auth.login`, Tailwind CDN, Google Fonts, or jsDelivr references.

## 2026-06-22 Admin Cluster Node Metrics + Deploy Sync Contract

- Removed the fake `Local-Node-01` fallback and random storage/GPU numbers from `deploy/new_html/components/AdminPage.tsx`.
- The admin cluster node view now accepts both list and map responses from `/api/cluster/nodes`, shows backend messages for agent-only or empty states, and displays `未上报` when storage/GPU metrics are not provided.
- Node cards now use responsive columns instead of forcing four columns on narrow admin layouts.
- Strengthened `deploy/scripts/check_route_contract.py` so AdminPage cannot reintroduce fake/random cluster node metrics.
- Strengthened the deploy script contract so `deploy/scripts/live_deploy_mvc2.sh` must continue syncing `dao`, `routers`, `schemas`, `services`, and `utils` as directories, while rejecting `pipeline/`, `agent_routes.py`, `workflows/`, and old one-file `services/*.py` sync entries.
- Verification:
  - Live deploy to `https://mecha.one/` completed; remote Vite build passed and `drama.service` stayed `active`.
  - Remote architecture contracts passed 10/10.
  - Server sync check matched current local code: `cluster_main.py` 985 lines, `admin_routes.py` 1502 lines, `dao/` 36 recursive Python files plus 28 legacy root `dao_*.py` files.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Built-in Admin Password Hardening

- Removed the implicit `admin / admin123` fallback from `deploy/cluster_main.py`; built-in admin login now requires an explicit `ADMIN_PASSWORD`.
- Added an explicit local-development escape hatch: `ALLOW_DEV_ADMIN_PASSWORD=true` enables the temporary `admin / admin123` password only for development/test environments.
- Built-in admin password values shorter than 8 characters now disable the built-in login path instead of silently accepting a weak password.
- Updated local/test verification scripts and deployment docs to prefer `ADMIN_PASSWORD` and describe the development-only fallback.
- Strengthened `deploy/scripts/check_route_contract.py` so `ADMIN_PASSWORD` cannot regain an `admin123` default.
- Verification:
  - Local route contract, architecture contract, targeted auth pytest, and script py_compile passed.
  - Runtime matrix confirmed: no env rejects `admin123`; dev flag accepts it; strong `ADMIN_PASSWORD` works; short `ADMIN_PASSWORD` is disabled.
  - Live deploy to `https://mecha.one/` passed; `drama.service` stayed `active`, remote architecture contracts passed 10/10, online smoke passed 9/9, and `admin / admin123` returned 401.

## 2026-06-22 CORS Allowlist Defaults

- Unified CORS defaults in `deploy/cluster_config.py` and legacy `deploy/config.py` around an explicit allowlist: `https://mecha.one`, backend local dev, and Vite local dev origins.
- Aligned `deploy/cluster_config_generated.py` and the config template emitted by `deploy/auto_deploy_cluster.py` to the same allowlist helper, so generated configs cannot drift back to local-only defaults.
- Added `parse_cors_allow_origins()` so `CORS_ALLOW_ORIGINS` remains the single runtime override mechanism.
- Updated `deploy/scripts/live_deploy_mvc2.sh` to sync `cluster_config.py` and `config.py`; otherwise server deployments could miss security/config changes.
- Updated `deploy/scripts/live_deploy_mvc2.sh` to also sync `cluster_config_generated.py` and `auto_deploy_cluster.py`.
- Updated `deploy/docs/deployment.md` to remove the obsolete `ALLOW_ORIGINS = ["*"]` guidance.
- Strengthened `deploy/scripts/check_route_contract.py` with a CORS allowlist contract that rejects wildcard CORS defaults and requires the official domain.
- Verification:
  - Local CORS parser check confirmed active config modules, generated config, and auto-deploy template default to the explicit origin list and contain no wildcard CORS default.
  - Local `git diff --check`, deploy script syntax check, route contract, and architecture contract passed.
  - Live deploy to `https://mecha.one/` passed; remote architecture contracts passed 10/10 and online smoke passed 9/9.
  - Remote sync check: `cluster_main.py` has 999 lines, `admin_routes.py` has 1502 lines, and `dao/` contains 36 Python files recursively.
  - Remote generated CORS check confirmed `cluster_config_generated.py` reports the explicit origin list without wildcard CORS, and `auto_deploy_cluster.py` contains `https://mecha.one` without the old local-only default.

## 2026-06-22 Admin API Runtime Model Selection

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so provider quick cards and manual provider sweeps select runtime status by `provider + model`, not by provider alone.
- This keeps multi-model providers such as DashScope and Seedance from showing the first provider runtime row when the card is actually displaying another preset/model.
- Strengthened `deploy/scripts/check_route_contract.py` so the admin API config UI must keep the model-aware runtime helper and cannot regress to the old provider-only quick-card lookup.
- Verification:
  - Local `py_compile`, `check_route_contract.py`, `check_architecture_contracts.py`, and `git diff --check` passed.
  - Local Vite build remains blocked by the known missing Windows Rollup optional package `@rollup/rollup-win32-x64-msvc`; local `tsc --noEmit` remains blocked by existing project-wide TypeScript debt outside `AdminSettingsPage.tsx`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, remote architecture contracts passed 10/10, and online smoke passed 9/9.

## 2026-06-22 API Health Cache Invalidation Precision

- Added exact provider/model health cache clearing in `deploy/services/api_provider_health_monitor.py`.
- Updated `deploy/services/api_config_service.py` so API config create/update/delete and conflict repair invalidate both provider-level health and affected provider/model rows, including custom models and automatically disabled conflicting configs.
- Added prefix-level health cache clearing for `reload-env`, so full runtime reloads also remove custom provider/model cache entries that are not present in the registry preset list.
- Strengthened `deploy/scripts/check_provider_health_monitor.py` and `deploy/scripts/check_admin_api_config_crud.py` to cover exact model cache deletion and CRUD-triggered provider/model invalidation.
- Verification:
  - Local `py_compile`, targeted health monitor contract, targeted admin API config CRUD contract, full architecture contracts, and `git diff --check` passed.
  - Health monitor contract covers global prefix cache clearing and admin reload fallback behavior.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, remote architecture contracts passed 10/10, and online smoke passed 9/9.
  - Follow-up deploy for global reload cache clearing passed remote Vite build, remote architecture contracts 10/10, and online smoke 9/9.

## 2026-06-22 Admin API Health Cache UI Reset

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so provider health cache payloads are normalized through `buildProviderHealthMap()`.
- The "refresh status" action now replaces the local health map from `/api/admin/api-configs/health/cache` instead of merging into stale React state.
- This keeps the native API management page from showing old green/error indicators after backend cache clears from runtime reloads, preset imports, or provider config changes.
- Strengthened `deploy/scripts/check_route_contract.py` so `refreshHealthCache` cannot regress to merging stale `healthMap` state.
- Verification:
  - Local `py_compile` passed for `deploy/scripts/check_route_contract.py`.
  - Local `deploy/scripts/check_route_contract.py` passed with `admin_api_config_ui_checks=33`.
  - Local `deploy/scripts/check_architecture_contracts.py` passed 10/10.
  - Local TypeScript filter check reported no `AdminSettingsPage.tsx` errors.
  - Local `git diff --check` passed.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Video Client Shared Download Base

- Added `deploy/external_api/video/base.py` with `download_streaming_video()` as the shared streaming download helper for synchronous external video clients.
- Updated `deploy/external_api/video/seedance.py`, `sora2.py`, `veo.py`, and `wan2.py` to use the shared helper instead of duplicating `requests.get(..., stream=True)` and chunk-join loops.
- Updated `deploy/scripts/live_deploy_mvc2.sh` to deploy the new video helper and its focused unit test.
- Strengthened `deploy/scripts/check_route_contract.py` with `video_client_base_checks` so these clients cannot regress to duplicated streaming download code.
- Added `deploy/tests/test_video_client_base.py` to pin header/timeout/proxy forwarding and chunk concatenation behavior.
- Verification:
  - Local `pytest deploy/tests/test_video_client_base.py -q` passed.
  - Local `py_compile` passed for the new helper, updated clients, and route contract script.
  - Local `deploy/scripts/check_route_contract.py` passed with `video_client_base_checks=29`.
  - Local `deploy/scripts/check_architecture_contracts.py` passed 10/10.
  - Local `git diff --check` passed.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=29`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Video Client Shared JSON Request Base

- Extended `deploy/external_api/video/base.py` with `request_json()` to centralize synchronous video-provider JSON requests.
- Updated `deploy/external_api/video/seedance.py`, `sora2.py`, `veo.py`, and `wan2.py` task-query/content-query paths to use `request_json()` while preserving provider-specific URLs, headers, runtime proxy kwargs, and timeout behavior.
- Moved non-2xx response-body logging into the shared helper so provider query failures stay diagnosable.
- Extended `deploy/tests/test_video_client_base.py` to cover method normalization, params/header/timeout/proxy forwarding, `raise_for_status()`, and JSON return behavior.
- Strengthened `deploy/scripts/check_route_contract.py` so these synchronous video clients must use both shared JSON request and streaming download helpers.
- Verification:
  - Local `pytest deploy/tests/test_video_client_base.py -q` passed with 2 tests.
  - Local `py_compile` passed for the helper, updated clients, and route contract script.
  - Local `deploy/scripts/check_route_contract.py` passed with `video_client_base_checks=45`.
  - Local `deploy/scripts/check_architecture_contracts.py` passed 10/10.
  - Local `git diff --check` passed.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=45`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Minimax Video Client Base Alignment

- Updated `deploy/external_api/video/minimax.py` so Hailuo/MiniMax video task creation, task query, file retrieval, and final video download all use the shared `external_api.video.base` helpers.
- Kept Minimax-specific payload, model resolution, file-retrieve URL, and worker-facing return shapes unchanged.
- Updated `deploy/tests/test_api_provider_runtime_model_env.py` so Minimax runtime-model tests patch the shared request helper path instead of the old direct `requests.post` call.
- Extended `deploy/scripts/check_route_contract.py` so `MinimaxClient` is included in `video_client_base_checks`.
- Verification:
  - Local `pytest deploy/tests/test_video_client_base.py deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
  - Local `py_compile` passed for `deploy/external_api/video/minimax.py`, the runtime-model tests, and the route contract script.
  - Local `deploy/scripts/check_route_contract.py` passed with `video_client_base_checks=54`.
  - Local `deploy/scripts/check_architecture_contracts.py` passed 10/10.
  - Local `git diff --check` passed.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=54`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Live Deploy Directory Sync + Video Create Requests

- Verified `deploy/scripts/live_deploy_mvc2.sh` now syncs the whole `dao`, `services`, and `utils` directories instead of relying on an old partial service-file list.
- Confirmed the deploy script still avoids the red-zone `pipeline/`, `agent_routes.py`, and `workflows/*.json` paths.
- Updated `deploy/external_api/video/seedance.py`, `veo.py`, and `wan2.py` so pure JSON task-creation requests use shared `external_api.video.base.request_json()`.
- Left `deploy/external_api/video/sora2.py` direct POST handling in place for its multipart upload branch.
- Strengthened `deploy/scripts/check_route_contract.py` so JSON-only synchronous video clients cannot reintroduce direct `requests.*` calls.
- Updated `deploy/tests/test_api_provider_runtime_model_env.py` to patch the shared request path for Seedance, Veo, and Wan2.6 create-task tests.
- Verification:
  - Local `pytest deploy/tests/test_video_client_base.py deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
  - Local `py_compile`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, and `git diff --check` passed.
  - Local route contract passed with `video_client_base_checks=58`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=58`.
  - Server sync check: local and remote SHA256 hashes match for `cluster_main.py`, `admin_routes.py`, and `scripts/live_deploy_mvc2.sh`.
  - `dao/` recursive file count matches locally and remotely at 72 files; the top-level `ls dao | wc -l` count is 8 because DAO files are grouped under subdirectories.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 MiniMax Audio Runtime Request Consolidation

- Added `_request_json()` and `_download_bytes()` inside `deploy/external_api/audio/minimax_audio.py` so MiniMax audio JSON calls and binary demo/TTS downloads share runtime endpoint, proxy, headers, and GroupId handling.
- Updated voice design, voice clone, voice list/delete, async TTS create/query, music generation, lyrics generation, file retrieve, and file delete to use the shared helpers.
- Kept `tts_sync` on its dedicated timeout/retry path and `file_upload` on its multipart form path.
- Updated `deploy/scripts/check_provider_contract.py` so provider runtime refresh checks understand shared helper refresh paths and still verify `_request_json()` calls `_url()` and `_download_bytes()` refreshes runtime config.
- Strengthened `deploy/scripts/check_route_contract.py` so the MiniMax audio client cannot drift back to scattered JSON request sessions.
- Verification:
  - Local `pytest deploy/tests/test_minimax_audio_runtime.py deploy/tests/test_audio_provider.py -q` passed with 15 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_audio_provider_runtime.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - First live deploy attempt hit a transient SCP connection reset during backend upload; rollback ran and `drama.service` stayed `active`.
  - Retry live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=160`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Sora2 JSON Create Request Consolidation

- Updated `deploy/external_api/video/sora2.py` so text-to-video task creation uses shared `external_api.video.base.request_json()`.
- Kept the Sora2 image-to-video multipart upload branch on direct `requests.post()`, because it carries file upload semantics.
- Updated Sora2 runtime-model tests to patch the shared video request helper instead of the old direct `requests.post()` path.
- Strengthened `deploy/scripts/check_route_contract.py` so Sora2 must use the shared helper for JSON create requests and can keep only one direct `requests.post()` for multipart upload.
- Verification:
  - Local `pytest deploy/tests/test_video_client_base.py deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
  - Local `py_compile`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `video_client_base_checks=60`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=60`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 DashScope Video Runtime Request Consolidation

- Added `_request_json()` in `deploy/external_api/video/dashscope.py` so DashScope task creation and query share aiohttp timeout, proxy, JSON parsing, and error handling.
- Kept per-call runtime config refresh in `create_task()` and `query_task()`, preserving hot provider endpoint/key/model behavior.
- Strengthened `deploy/scripts/check_route_contract.py` so DashScope create/query must continue routing through the shared async helper.
- Reconfirmed `deploy/scripts/live_deploy_mvc2.sh` already syncs directory-level `dao`, `services`, `utils`, `routers`, and `schemas` entries and has no `pipeline/` entry.
- Verification:
  - Local `pytest deploy/tests/test_dashscope_video_payload_extension.py -q` passed with 12 tests.
  - Local `py_compile`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `api_provider_runtime_model_checks=164`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=164`.
  - Server sync check: local and remote SHA256 hashes match for `cluster_main.py`, `admin_routes.py`, `scripts/live_deploy_mvc2.sh`, `external_api/video/dashscope.py`, and `scripts/check_route_contract.py`.
  - Same-counter line check is `cluster_main.py=999`, `admin_routes.py=1502`; the older `846/1289` expectation is stale for this branch.
  - `dao/` recursive file count matches locally and remotely at 72 files; top-level `ls dao | wc -l` remains 8 because DAO files are grouped under subdirectories.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 Video Card Lazy Image Binding

- Added `deploy/new_html/components/LazyImage.tsx`, mirroring the existing `LazyVideo` pattern for images: keep layout mounted, but do not bind `src` until the element is near the viewport.
- Updated `deploy/new_html/components/video/VideoCard.tsx` so storyboard preview images use `LazyImage` instead of eager `<img src={image.url}>`.
- Added `deploy/new_html/__tests__/components/LazyImage.test.tsx` to prove `src` remains unset before the intersection observer fires.
- Strengthened `deploy/scripts/check_route_contract.py` with `frontend_lazy_image_checks` so the shared card cannot drift back to eager image loading.
- Verification:
  - Local `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local TypeScript output has no `LazyImage` errors after the test cast fix; full `tsc --noEmit` still reports unrelated pre-existing project errors.
  - Local frontend `vitest`/`vite build` is blocked by missing Windows Rollup optional package `@rollup/rollup-win32-x64-msvc` in `new_html/node_modules`; use remote Linux build during deploy for final frontend verification.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `frontend_lazy_image_checks=9`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `new_html/components/LazyImage.tsx` exists on `/home/Administrator/deploy`.

## 2026-06-22 AI Proxy JSON Request Consolidation

- Added `_post_json_request()` and `_post_json_request_async()` in `deploy/services/ai_proxy_service.py` so provider JSON calls share POST, proxy kwargs, timeout, upstream-body logging, HTTP status, and JSON parse handling.
- Routed DeepSeek non-stream chat, Gemini text, Gemini image, and Doubao image generation through the shared helper while keeping provider-specific config resolution, model selection, expected status, and user-facing error messages at call sites.
- Left DeepSeek streaming and GPT Image multipart/generation paths unchanged for a later focused cut.
- Strengthened `deploy/scripts/check_route_contract.py` so these AI proxy JSON providers must keep using the shared helper and direct `requests.post` usage cannot creep upward.
- Verification:
  - Local `pytest deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 27 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `api_provider_runtime_model_checks=171`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=171`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `_post_json_request()` is present and called by DeepSeek, Gemini text, Gemini image, and Doubao image paths.

## 2026-06-22 GPT Image Proxy Request Consolidation

- Added shared response parsing and `_post_form_request()` / `_post_form_request_async()` in `deploy/services/ai_proxy_service.py` so GPT Image multipart edit requests use the same timeout, proxy kwargs, upstream logging, HTTP status, and JSON parse handling as JSON provider calls.
- Routed GPT Image generation through `_post_json_request_async()` and GPT Image edits through `_post_form_request_async()`, preserving tier/provider resolution, request model, endpoint/key lookup, and returned image parsing.
- Added runtime tests for GPT Image VIP generation and official edit paths in `deploy/tests/test_api_provider_runtime_model_env.py`.
- Strengthened `deploy/scripts/check_route_contract.py` so direct `requests.post` in AI proxy stays limited to JSON helper, form helper, and DeepSeek streaming.
- Verification:
  - Local `pytest deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 29 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `api_provider_runtime_model_checks=175`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=175`.
  - Server sync check: `cluster_main.py=999` lines, `admin_routes.py=1502` lines, and `dao/` contains 72 recursive files; top-level `ls dao | wc -l` is 8 because DAO files are grouped under subdirectories.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 DeepSeek Stream Request Consolidation

- Added `_post_stream_request()` and `_ensure_stream_response_ok()` in `deploy/services/ai_proxy_service.py` so DeepSeek streaming calls share request timeout, proxy kwargs, upstream logging, and connection-error handling with the rest of the AI proxy layer.
- Kept `stream_deepseek_chat()` focused on SSE parsing, reasoning/content event emission, response closing, and completion callbacks.
- Added `test_deepseek_stream_uses_shared_runtime_request` to prove streaming still resolves endpoint/key/model through provider runtime env and sends `stream=True`.
- Strengthened `deploy/scripts/check_route_contract.py` so AI proxy provider calls must keep JSON, form, and stream helpers.
- Verification:
  - Local `pytest deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 30 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, and `deploy/scripts/smoke_test.py` passed.
  - Local route contract passed with `api_provider_runtime_model_checks=178`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=178`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `_post_stream_request()` and the `DeepSeek stream` call label are present on `/home/Administrator/deploy/services/ai_proxy_service.py`.

## 2026-06-22 Video Reverse Gemini Request Delegation

- Added `generate_gemini_chat_result()` in `deploy/services/ai_proxy_service.py` for OpenAI-compatible Gemini chat payloads that need shared runtime endpoint/key/model, proxy kwargs, timeout, upstream logging, and JSON parse handling.
- Updated `deploy/services/video_reverse_service.py` so frame analysis delegates Gemini vision/chat calls to `ai_proxy_service` instead of importing `requests` and posting directly.
- Kept video reverse visual analysis on `allow_failover=False`, because image-bearing prompts should not silently fail over to text-only DeepSeek.
- Updated provider/route contracts so video reverse must stay on delegated runtime wiring and cannot reintroduce direct `requests.post`.
- Verification:
  - Local `pytest deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 30 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `api_provider_runtime_model_checks=180`.
  - Local provider contract passed with `resolve_provider_references=24` and delegated video reverse runtime wiring.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=180`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `video_reverse_service.py` imports/calls `generate_gemini_chat_result()` and has no `requests.post` or `import requests`.

## 2026-06-22 GPT Image Result Download Delegation

- Added `generated_image_content()` in `deploy/services/ai_proxy_service.py` so generated image data URLs and provider-hosted image URLs are decoded/downloaded through the AI proxy service layer.
- Remote generated-image URLs now pass `assert_public_http_url()` before download, keeping SSRF protection with the provider result save path.
- Updated `deploy/routers/ai_proxy.py` so GPT Image result saving delegates image bytes extraction to `ai_proxy_service` instead of importing `requests` in the route layer.
- Strengthened route contracts so `routers/ai_proxy.py` cannot reintroduce direct HTTP requests and must keep using `generated_image_content()`.
- Verification:
  - Local `pytest deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 32 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `api_provider_runtime_model_checks=183`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `api_provider_runtime_model_checks=183`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `routers/ai_proxy.py` calls `generated_image_content()` and has no direct `requests` import/calls.

## 2026-06-22 Video Crop ComfyUI Fetch Delegation

- Added `deploy/services/video_source_service.py` as the shared service boundary for fetching video bytes from ComfyUI `/view` endpoints.
- Updated `deploy/routers/video.py` so the crop route delegates ComfyUI fetches to `get_comfyui_view_response()` instead of importing `requests` directly in the route layer.
- Added focused tests in `deploy/tests/test_video_client_base.py` for ComfyUI view response forwarding and output/temp/input fallback byte selection.
- Strengthened route contracts so `routers/video.py` cannot reintroduce direct HTTP requests and the video source helper remains deployed.
- Verification:
  - Local `pytest deploy/tests/test_video_client_base.py -q` passed with 4 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `video_client_base_checks=65` and `service_mapper_purity_checks=607`.
  - Live deploy to `https://mecha.one/` passed; remote Vite build completed with `2080 modules transformed`, `drama.service` stayed `active`, and remote architecture contracts passed 10/10 with `video_client_base_checks=65`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `routers/video.py` calls `get_comfyui_view_response()` and has no direct `requests` import/calls.

## 2026-06-22 ComfyUI File Route Transport Delegation

- Added `deploy/services/comfyui_file_service.py` as the shared transport boundary for ComfyUI `/view` proxying and `/upload/image` multipart uploads.
- Updated `deploy/routers/comfyui_files.py` so preview proxy, image upload, video upload, audio upload, and video reupload delegate HTTP requests to the service layer instead of importing `requests` in the route layer.
- Added `deploy/tests/test_comfyui_file_service.py` to cover GET options forwarding, multipart upload payload forwarding, and wrapped request exceptions.
- Strengthened `deploy/scripts/check_route_contract.py` with `comfyui_file_service_checks=10`; `routers/comfyui_files.py` is now contract-protected from reintroducing direct HTTP requests.
- Verification:
  - Local `pytest deploy/tests/test_comfyui_file_service.py deploy/tests/test_video_client_base.py -q` passed with 7 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `comfyui_file_service_checks=10` and `service_mapper_purity_checks=627`.
  - Live files synced to `https://mecha.one/`; `drama.service` was manually restarted after the frontend build step exceeded the local command timeout, then stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`, with `comfyui_file_service_checks=10`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `admin_routes.py=1502` lines, `cluster_main.py=999` lines, `dao/` has 72 recursive files, password fields use `min_length=8`, API env reload errors are logged, `env_refreshed` is returned, and `routers/comfyui_files.py` has no direct `requests` import/calls.

## 2026-06-22 Sora2 Multipart Video Request Consolidation

- Added `request_multipart_json()` to `deploy/external_api/video/base.py` so multipart video provider requests share the same endpoint, proxy kwargs, HTTP status logging, and JSON response handling as the existing JSON helper.
- Updated `deploy/external_api/video/sora2.py` so image-to-video creation delegates multipart upload to `request_multipart_json()` instead of importing and calling `requests.post` directly.
- Added focused tests for multipart helper forwarding and Sora2 image-to-video runtime wiring in `deploy/tests/test_video_client_base.py` and `deploy/tests/test_api_provider_runtime_model_env.py`.
- Strengthened `deploy/scripts/check_route_contract.py` so Sora2 text-to-video must use `request_json()`, image-to-video must use `request_multipart_json()`, and Sora2 cannot reintroduce direct `requests` imports/calls.
- Verification:
  - Local `pytest deploy/tests/test_video_client_base.py deploy/tests/test_api_provider_runtime_model_env.py -q` passed with 38 tests.
  - Local `py_compile`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local route contract passed with `video_client_base_checks=69`.
  - Live files synced to `https://mecha.one/`; `drama.service` was manually restarted after `live_deploy_mvc2.sh` exceeded the local command timeout, then stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`, with `video_client_base_checks=69`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `external_api/video/sora2.py` has no direct `requests` import/calls and the route contract contains `request_multipart_json` checks.

## 2026-06-22 Deployment Frontend Build Skip

- Updated `deploy/scripts/live_deploy_mvc2.sh` so backend/API-only deploys no longer rebuild the Vite frontend when `new_html` source is unchanged.
- Added `frontend_source_hash()` with normalized `sha256sum` output so Windows Git Bash and Linux produce the same `new_html` source fingerprint.
- Added remote marker support via `/home/Administrator/deploy/.new_html_source.sha256`; when the marker or remote source hash matches and `dist/` exists, the script prints `Skipping frontend build` and goes straight to service restart and contracts.
- Added `FORCE_FRONTEND_BUILD=1` for explicit frontend rebuilds, and kept the existing tar/upload/build path for real frontend changes.
- Added `tests/test_comfyui_file_service.py` to the deploy file list so the latest service-boundary tests are synced with the rest of the test set.
- Strengthened `deploy/scripts/check_route_contract.py` with deployment-script checks for hash skip, force rebuild, hash normalization, and the additional synced test.
- Verification:
  - Local `bash -n deploy/scripts/live_deploy_mvc2.sh`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local and remote normalized `new_html` hashes matched: `9db167248502ecc442d58544715c73d61de887e58fe83deb65191ac4130d9623`.
  - One manual remote `npm run build` completed successfully with `2080 modules transformed`; the marker was then written.
  - A real `live_deploy_mvc2.sh` run printed `Skipping frontend build: new_html source hash unchanged (...)`, restarted `drama.service`, and passed remote architecture contracts 10/10 with `live_deploy_frontend_checks=61`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.

## 2026-06-22 MiniMax Audio Request Helper Consolidation

- Updated `deploy/external_api/audio/minimax_audio.py` so `tts_sync()` now reuses `_request_json()` with timeout, retry, proxy, group-id, and HTTP-body error handling instead of opening its own `aiohttp.ClientSession`.
- Added `_request_form_json()` and moved `file_upload()` multipart transport through that helper, leaving MiniMax audio with exactly three session boundaries: JSON requests, binary downloads, and form uploads.
- Strengthened `deploy/tests/test_minimax_tts_sync.py` to assert the shared helper still sends the expected `/t2a_v2` URL, payload, auth header, and 60 second timeout.
- Updated `deploy/scripts/check_route_contract.py` so MiniMax audio is contract-protected against reintroducing direct sessions outside the three helpers, and added `tests/test_minimax_tts_sync.py` to `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Verification:
  - Local `pytest deploy/tests/test_minimax_tts_sync.py deploy/tests/test_minimax_audio_runtime.py -q` passed with 11 tests.
  - Local `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, `bash -n deploy/scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
  - Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` printed `Skipping frontend build`, restarted `drama.service`, and left it `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `cluster_main.py=999` lines, `admin_routes.py=1502` lines, `dao/` has 36 Python files, `tests/test_minimax_tts_sync.py` is present, and `external_api/audio/minimax_audio.py` contains exactly 3 `aiohttp.ClientSession` helper sites.

## 2026-06-22 Cluster Main Direct HTTP Guard

- Removed the unused `requests` import from `deploy/cluster_main.py`, keeping the startup/composition entrypoint free of direct outbound HTTP transport.
- Strengthened `deploy/scripts/check_route_contract.py` so `cluster_main.py` now fails the route contract if `requests`, `aiohttp.ClientSession`, or `httpx` transport code is reintroduced.
- Verification:
  - Local `py_compile` for `cluster_main.py` and `scripts/check_route_contract.py` passed.
  - Local `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` printed `Skipping frontend build`, restarted `drama.service`, and left it `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `cluster_main.py=998` lines, `admin_routes.py=1502` lines, and `grep requests ~/deploy/cluster_main.py` returned no matches.

## 2026-06-22 Episode Compose Service DAO Boundary

- Split final episode composition out of the legacy root `deploy/compose_service.py` into `deploy/services/episode_compose_service.py`.
- Added `deploy/dao/creative/episode_compose.py` so video-take listing and final-cut `files` + `media_library_items` writes now live behind `EpisodeComposeDAO`.
- Kept `deploy/compose_service.py` as a 2-line compatibility shim for older imports while `routers/episode_video.py` now explicitly calls `services.episode_compose_service`.
- The final-cut file and media-library inserts now run inside one DAO-owned transaction.
- Added `deploy/tests/test_episode_compose_service.py` for take grouping, duplicate segment dedupe, selected-take handling, and latest-take fallback.
- Strengthened `deploy/scripts/check_route_contract.py` so episode compose routes cannot reintroduce legacy `compose_service` calls and the root shim cannot regain DB logic.
- Added `compose_service.py` and the new compose test to `deploy/scripts/live_deploy_mvc2.sh`.
- Verification:
  - Local `py_compile` for compose DAO/service/router/contract files passed.
  - Local `pytest deploy/tests/test_episode_compose_service.py deploy/tests/test_video_client_base.py -q` passed with 7 tests.
  - Local `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, `bash -n deploy/scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
  - Local architecture contract reported `service_files=24`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=668`.
  - Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` printed `Skipping frontend build`, restarted `drama.service`, and left it `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `compose_service.py=2` lines, `services/episode_compose_service.py=328` lines, `dao/creative/episode_compose.py=95` lines, and `tests/test_episode_compose_service.py` is present.

## 2026-06-22 Admin User Detail DAO Boundary

- Moved the admin user detail lookup SQL out of `deploy/admin_routes.py` into `deploy/dao/user/user.py` as `UserDAO.admin_get_user_detail()`.
- Preserved the previous tolerant behavior: if the full admin-column query fails because a deployment schema is missing optional columns, the DAO falls back to the base `get_user_by_id()` result instead of breaking the admin page.
- Strengthened `deploy/tests/test_user_dao_admin_delete.py` with coverage for full admin-field lookup, base-user fallback, and DB-unavailable behavior.
- Strengthened `deploy/scripts/check_route_contract.py` so `admin_routes.py` must call `UserDAO.admin_get_user_detail()` and cannot reintroduce the user-detail `fetchrow` SQL block.
- Verification:
  - Local `pytest deploy/tests/test_user_dao_admin_delete.py deploy/tests/test_admin_stats_logs.py -q` passed with 7 tests.
  - Local `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, and `git diff --check` passed.
  - Local architecture contract reported `service_files=24`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=673`.
  - Live deploy to `https://mecha.one/` synced the DAO and admin route changes; `drama.service` stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `dao/user/user.py` contains `admin_get_user_detail()`, `admin_routes.py` calls it, and the old user-detail SQL snippets are absent from `admin_routes.py`.

## 2026-06-22 MiniMax Audio Import Boundary

- Updated non-red-zone callers to import MiniMax audio runtime from `deploy/external_api/audio/minimax_audio.py` directly instead of the root `deploy/minimax_audio.py` compatibility shim.
- Kept the legacy shim available for `core/worker.py` and older imports; `core/worker.py` remains untouched because it is in the red-line list.
- Updated `deploy/tests/test_audio_provider.py` patch paths to target `external_api.audio.minimax_audio.get_minimax_audio_client`.
- Added route-contract checks so `deploy/api_routes.py` and `deploy/services/audio_provider.py` cannot reintroduce `from minimax_audio import get_minimax_audio_client`.
- Added `deploy/tests/test_audio_provider.py` to `deploy/scripts/live_deploy_mvc2.sh` so remote architecture contracts receive the test file they inspect.
- Verification:
  - Local `pytest deploy/tests/test_audio_provider.py deploy/tests/test_minimax_audio_runtime.py deploy/tests/test_minimax_tts_sync.py -q` passed with 19 tests.
  - Local `deploy/scripts/check_audio_provider_runtime.py`, `deploy/scripts/check_route_contract.py`, `deploy/scripts/check_provider_contract.py`, `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, `bash -n deploy/scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
  - Local route contract reported `api_provider_runtime_model_checks=188` and `live_deploy_frontend_checks=65`.
  - Live deploy to `https://mecha.one/` passed; `live_deploy_mvc2.sh` skipped the unchanged frontend build, restarted `drama.service`, and left it `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed `api_routes.py`, `services/audio_provider.py`, and `tests/test_audio_provider.py` reference `external_api.audio.minimax_audio`; only red-line `core/worker.py` still imports the legacy shim.

## 2026-06-22 API Config Canonical DAO Imports

- Updated API management services to depend on canonical DAO package modules:
  - `deploy/services/api_config_service.py`
  - `deploy/services/api_config_runtime_loader.py`
  - `deploy/services/api_config_import_service.py`
  - `deploy/services/api_config_health_service.py`
- Kept top-level compatibility shims such as `deploy/dao_api_config.py` and `deploy/dao_system_settings.py` available for older callers, while the API management path now uses `dao.admin.*` directly.
- Updated `deploy/tests/test_dao_api_config_category.py` to patch `dao.admin.api_config.get_db_manager`, matching the real implementation module and avoiding accidental real DB connections in mock-only tests.
- Strengthened `deploy/scripts/check_provider_contract.py` with `api_config_dao_import_checks=20` so API config services cannot reintroduce `dao_api_config` or `dao_system_settings` shim imports.
- Added `deploy/tests/test_dao_api_config_category.py` to `deploy/scripts/live_deploy_mvc2.sh` and the deployment contract so server-side checks receive the test file.
- Verification:
  - Local API config contracts passed: runtime loader, CRUD, import, health, and provider contract.
  - Local `pytest deploy/tests/test_admin_import_presets_writes_category.py deploy/tests/test_minimax_audio_runtime.py deploy/tests/test_dao_api_config_category.py -q` passed with 15 tests.
  - Local `deploy/scripts/check_architecture_contracts.py`, `deploy/scripts/smoke_test.py`, `bash -n deploy/scripts/live_deploy_mvc2.sh`, and `git diff --check` passed.
  - Local route contract reported `live_deploy_frontend_checks=66`.
  - Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server sync check confirmed API config services import `dao.admin.api_config` / `dao.admin.system_settings`, and `tests/test_dao_api_config_category.py` is included in the live deploy file list.

## 2026-06-22 API Config Reload Service Boundary

- Moved API config runtime reload orchestration and optional global provider-health cache clearing into `deploy/services/api_config_service.py`:
  - `reload_api_env_runtime()`
  - `clear_all_provider_health_cache()`
  - `ApiConfigReloadFailed`
- Kept `deploy/admin_api_config_routes.py` as the HTTP boundary: write endpoints and the manual reload endpoint now delegate to the service, preserve `env_refreshed` response fields, and map reload failures to HTTP 500 instead of silently reporting success.
- Strengthened `deploy/scripts/check_provider_contract.py` so `admin_api_config_routes.py` cannot reintroduce direct `load_api_configs_to_env`, provider registry, or provider-health cache implementation details.
- Strengthened `deploy/scripts/check_admin_api_config_crud.py` with dynamic success/failure checks for `reload_api_env_runtime(clear_health_cache=True)`.
- Updated `deploy/scripts/check_provider_health_monitor.py` to verify global provider-health clearing through the service helper instead of a route-private helper.
- Verification:
  - Local `py_compile` for API config route/service/contract files passed using `deploy/.venv`.
  - Local API config CRUD, provider health monitor, provider contract, architecture contracts, and smoke test passed; smoke reported 9/9.
  - Live deploy to `https://mecha.one/` synced the service-boundary changes, restarted `drama.service`, and left it `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server grep confirmed `admin_api_config_routes.py` now only references `reload_api_env_runtime`, while loader, registry, and provider-health cache internals live in `services/api_config_service.py` and contract scripts.

## 2026-06-22 API Config Write Reload Ownership

- Removed the private `_reload_api_env()` callback from `deploy/admin_api_config_routes.py`.
- Made write services own their default runtime reload behavior:
  - `deploy/services/api_config_service.py` now uses `_reload_api_env_after_write()` for create/update/delete/repair when no test callback is injected.
  - `deploy/services/api_config_import_service.py` now uses `_reload_api_env_after_import()` for preset imports when no test callback is injected.
- Kept callback injection available at the service layer for pure contract tests, but the HTTP route no longer passes `reload_api_env=` into write services.
- Strengthened `deploy/scripts/check_provider_contract.py` so API config routes cannot reintroduce private reload callbacks or reload callback wiring.
- Strengthened `deploy/scripts/check_admin_api_config_crud.py` with a dynamic default-service-reload check.
- Updated `deploy/tests/test_admin_import_presets_writes_category.py` to patch the import-service reload helper instead of a route-private helper.
- Verification:
  - Local `py_compile` for API config route/service/import/contract files passed.
  - Local API config CRUD/import/provider contracts passed; provider contract now reports `api_config_env_refresh_checks=20`.
  - Local `pytest deploy/tests/test_admin_import_presets_writes_category.py deploy/tests/test_dao_api_config_category.py -q` passed with 8 tests.
  - Local `deploy/scripts/check_architecture_contracts.py` passed 10/10.
  - Local `deploy/scripts/smoke_test.py` passed 9/9.
  - Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server grep confirmed `admin_api_config_routes.py` only keeps the manual `admin_reload_api_env()` endpoint; write reload helpers live in `services/api_config_service.py` and `services/api_config_import_service.py`.

## 2026-06-22 API Config Health Cache Service Boundary

- Added `deploy/services/api_config_health_cache_service.py` as the single helper layer for provider-health cache invalidation caused by API config writes.
- Moved provider/model cache target derivation and global provider-health cache clearing out of `deploy/services/api_config_service.py`.
- Updated `deploy/services/api_config_import_service.py` to clear provider/model health cache targets through the shared helper instead of directly calling provider-health monitor delete functions.
- Strengthened contracts:
  - `deploy/scripts/check_provider_contract.py` now requires API config CRUD/import services to use `api_config_health_cache_service` and forbids direct bottom-level health-cache delete calls there.
  - `deploy/scripts/check_admin_api_config_import.py` now verifies import invalidates model-specific provider health targets.
  - `deploy/scripts/check_provider_health_monitor.py` now validates global cache clearing through the dedicated helper service.
- Verification:
  - Local `py_compile` for API config services and contracts passed.
  - Local API config CRUD/import/provider/provider-health contracts passed; provider contract now reports `api_config_env_refresh_checks=28`.
  - Local `pytest deploy/tests/test_admin_import_presets_writes_category.py deploy/tests/test_dao_api_config_category.py -q` passed with 8 tests.
  - Local architecture contracts passed 10/10; `service_files=25`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=693`.
  - Local smoke test passed 9/9.
  - Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server grep confirmed bottom-level provider-health cache delete calls now live in `services/api_config_health_cache_service.py`, while CRUD/import services import only the helper.

## 2026-06-22 API Config Import Row Helper Cleanup

- Updated `deploy/services/api_config_import_service.py` to use the shared `utils.config_helpers._config_get()` helper instead of maintaining a local `_row_get()` copy.
- Strengthened `deploy/scripts/check_provider_contract.py` so `api_config_import_service.py` must import the shared helper and cannot reintroduce local `_row_get()`.
- Verification:
  - Local `py_compile` for `services/api_config_import_service.py` and `scripts/check_provider_contract.py` passed.
  - Local `scripts/check_admin_api_config_import.py` and `scripts/check_provider_contract.py` passed; provider contract now reports `api_config_env_refresh_checks=30`.
  - Local `pytest deploy/tests/test_admin_import_presets_writes_category.py deploy/tests/test_dao_api_config_category.py -q` passed with 8 tests.
  - Local architecture contracts passed 10/10.
  - Local smoke test passed 9/9.
  - Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server grep confirmed `services/api_config_import_service.py` imports `_config_get` and has no local `_row_get()` definition.

## 2026-06-22 API Config Service Row Helper Cleanup

- Updated `deploy/services/api_config_service.py` row access helpers (`_row_provider`, `_row_model_name`, `_row_config_id`, `_row_enabled`, `_row_has_key`) to use the shared `utils.config_helpers._config_get()` helper.
- Strengthened `deploy/scripts/check_provider_contract.py` so those API config row helpers must use `_config_get`.
- Verification:
  - Local `py_compile` for `services/api_config_service.py` and `scripts/check_provider_contract.py` passed.
  - Local `scripts/check_admin_api_config_crud.py` and `scripts/check_provider_contract.py` passed; provider contract now reports `api_config_env_refresh_checks=36`.
  - Local `pytest deploy/tests/test_admin_import_presets_writes_category.py deploy/tests/test_dao_api_config_category.py -q` passed with 8 tests.
  - Local architecture contracts passed 10/10.
  - Local smoke test passed 9/9.
  - Live deploy to `https://mecha.one/` passed; frontend build was skipped because `new_html` source hash was unchanged and `drama.service` stayed `active`.
  - Remote architecture contracts passed 10/10 using `/home/Administrator/deploy/.venv/bin/python`.
  - Online smoke test against `https://mecha.one`: 9/9 passed.
  - Server grep confirmed `api_config_service.py` imports `_config_get` and all `_row_*` helpers use it.

## 2026-06-22 API Config Reload Service Boundary

- Added `deploy/services/api_config_reload_service.py` as the single service boundary for API config runtime reload orchestration.
- Moved `reload_api_env_runtime()`, `reload_api_env_after_config_change()`, `ReloadCallback`, and `ApiConfigReloadFailed` out of `deploy/services/api_config_service.py`.
- Updated API config CRUD, preset import, and admin manual reload routes to depend on the reload service instead of cross-importing CRUD service internals.
- Removed the lazy `from services.api_config_service import reload_api_env_runtime` import from `deploy/services/api_config_import_service.py`.
- Strengthened `deploy/scripts/check_provider_contract.py` so:
  - runtime loader access belongs to `api_config_reload_service.py`;
  - import service must not import CRUD service;
  - admin manual reload imports runtime reload from `api_config_reload_service.py`.
- Verification:
  - Local `py_compile` for admin API config route, reload service, CRUD service, import service, and contracts passed.
  - Local API config CRUD/import/provider contracts passed; provider contract now reports `api_config_env_refresh_checks=39`.
  - Local `pytest deploy/tests/test_admin_import_presets_writes_category.py deploy/tests/test_dao_api_config_category.py -q` passed with 8 tests.
  - Local architecture contracts passed 10/10; `service_files=26`, `raw_sql_in_services=0`, and `service_mapper_purity_checks=713`.
  - Local smoke test passed 9/9.

## 2026-06-22 Admin API Config Status UX

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so saved-config test results from `POST /api/admin/api-configs/{id}/test` participate in the provider card's primary status.
- This prevents a provider from staying red/no-key after the DB config test proves runtime key fallback is usable.
- Renamed the old "advanced diagnostic" action to "test connectivity"; runtime provider checks remain available as "refresh effective health".
- Updated `deploy/scripts/check_route_contract.py` to enforce the merged API config health status path.
- Verification:
  - `deploy/scripts/check_route_contract.py` passed.
  - `deploy/scripts/check_architecture_contracts.py` passed 10/10.
  - `deploy/new_html` Vite production build passed using the bundled Node runtime.
  - Local smoke test passed 9/9.

## 2026-06-22 Provider Credential Links

- Added `docs_url`, `console_url`, and `key_help` metadata to `deploy/services/api_provider_registry.py` for every managed provider.
- Backend provider catalog now exposes credential acquisition links for DeepSeek, Google Gemini, Volcengine Ark/Seedance, Alibaba DashScope, MiniMax, and LaoZhang gateway providers.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` to render provider credential links in the API config quick cards, detail cards, and editor modal.
- Updated provider and route contracts so credential metadata and the admin UI rendering path cannot silently regress.
- Verification:
  - Local `scripts/check_provider_contract.py` passed.
  - Local `scripts/check_route_contract.py` passed.
  - Local `scripts/check_architecture_contracts.py` passed 10/10.
  - Local `new_html` Vite production build passed.
  - Local smoke test passed 9/9.

## 2026-06-22 Gemini TTS Default Model Registry Cleanup

- Added `GEMINI_TTS_DEFAULT_MODEL` to `deploy/services/api_provider_registry.py`.
- Updated the Gemini TTS preset, API config legacy-model upgrade target, and `GeminiAudioProvider` fallback model to read the same registry constant.
- Updated `deploy/scripts/check_provider_contract.py` so `audio_provider.py` and `api_config_runtime_loader.py` cannot reintroduce local Gemini TTS default-model literals.
- Verification:
  - Local `py_compile` for provider registry, runtime loader, audio provider, and provider contract passed.
  - Local `scripts/check_provider_contract.py` passed; provider contract now reports `video_default_model_checks=74`.
  - Local `scripts/check_architecture_contracts.py` passed 10/10.
  - Local smoke test passed 9/9.

## 2026-06-22 API Config Audit Logging

- Added best-effort audit logging to `deploy/admin_api_config_routes.py` for API config create, update, delete, preset import, runtime env reload, and conflict repair.
- Added audit summaries that record provider/model/endpoint metadata and reload status while redacting API keys, custom proxy values, header contents, and request-template values.
- Updated `deploy/scripts/check_route_contract.py` so API config audit hooks and sensitive-field redaction markers cannot silently regress.
- Updated `deploy/scripts/check_provider_contract.py` so manual reload responses may be validated through a constructed response object, not only a direct return dict.
- Added tests covering import route compatibility and audit redaction behavior.
- Verification:
  - Local `py_compile` for API config routes, route/provider contracts, and updated tests passed.
  - Local `scripts/check_admin_api_config_crud.py`, `scripts/check_admin_api_config_import.py`, `scripts/check_provider_contract.py`, and `scripts/check_route_contract.py` passed.
  - Local `pytest deploy/tests/test_admin_import_presets_writes_category.py -q` passed with 7 tests.
  - Local `scripts/check_architecture_contracts.py` passed 10/10.
  - Local smoke test passed 9/9.

## 2026-06-22 Provider Health URL Derivation

- Removed the duplicate `PROVIDER_HEALTH_CHECK_URLS` table from `deploy/services/api_provider_registry.py`.
- API provider preset and catalog health-check URLs are now derived from each preset endpoint through `services.api_provider_endpoints.derive_models_health_urls()`.
- DashScope still derives the special compatible-mode `/models` URL from the video synthesis endpoint, so health checks keep the old behavior without maintaining a second URL source.
- Strengthened `deploy/scripts/check_provider_contract.py` so health URLs must be endpoint-derived and `PROVIDER_HEALTH_CHECK_URLS` cannot be reintroduced.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py` and `scripts/check_admin_api_config_health.py` passed.
  - Local `scripts/check_architecture_contracts.py` passed 10/10.
  - Local smoke test passed 9/9.

## 2026-06-22 Provider Default Endpoint Registry

- Added `PROVIDER_DEFAULT_ENDPOINTS` to `deploy/services/api_provider_registry.py` as the single provider-level source for default upstream endpoints.
- Removed repeated `endpoint` literals from raw `API_MODEL_PRESETS`; `get_api_model_presets()` now enriches presets with `get_provider_default_endpoint(provider)`.
- External preset/catalog responses remain unchanged: all 17 enriched presets still include endpoint and endpoint-derived health-check URL.
- Strengthened `deploy/scripts/check_provider_contract.py` so:
  - every provider must have exactly one default endpoint;
  - raw presets cannot carry endpoint values;
  - enriched preset and catalog endpoints must match `PROVIDER_DEFAULT_ENDPOINTS`.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.
  - Local `scripts/check_architecture_contracts.py` passed 10/10.
  - Local smoke test passed 9/9.

## 2026-06-22 Provider Default Proxy Mode Registry

- Removed repeated `proxy_mode` literals from raw `API_MODEL_PRESETS`.
- `get_api_model_presets()` now enriches each preset from `PROVIDER_CATALOG[provider].default_proxy_mode`, defaulting to `direct`.
- External preset/catalog responses remain unchanged: all 17 enriched presets still include `proxy_mode=direct`.
- Strengthened `deploy/scripts/check_provider_contract.py` so raw presets cannot carry `proxy_mode`, and enriched presets must match the provider catalog default.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py` passed.
  - Local `scripts/check_admin_api_config_import.py` passed.

## 2026-06-22 Provider Default Category Registry

- Added `get_provider_default_category()` to `deploy/services/api_provider_registry.py`.
- Removed repeated default `category` literals from raw `API_MODEL_PRESETS`; `get_api_model_presets()` now enriches each preset from `PROVIDER_CATALOG[provider].capabilities[0]`.
- Model-specific category overrides remain possible when a future preset genuinely differs from the provider default capability.
- External preset/catalog responses remain unchanged: all 17 enriched presets still include category values (`video=9`, `image=5`, `text=2`, `audio=1`).
- Strengthened `deploy/scripts/check_provider_contract.py` so raw presets cannot repeat provider default categories, and enriched presets must match the provider capability default or an explicit valid override.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Proxy Metadata Defaults

- Added `DEFAULT_PROVIDER_PROXY_MODE` and `DEFAULT_PROVIDER_SUPPORTS_PROXY` to `deploy/services/api_provider_registry.py`.
- Removed repeated provider-level `default_proxy_mode=direct` and `supports_proxy=True` literals from all 12 `PROVIDER_CATALOG` entries.
- Provider metadata now applies those values through a single post-catalog `setdefault()` pass, so future providers only need explicit overrides when they differ from the default.
- External provider catalog and preset responses remain unchanged: 12 catalog entries still report `default_proxy_mode=direct` and `supports_proxy=True`; 17 enriched presets still report `proxy_mode=direct` and `supports_proxy=True`.
- Strengthened `deploy/scripts/check_provider_contract.py` so default proxy/supports metadata must be centralized and enriched presets must match provider metadata.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Health Check Metadata Defaults

- Replaced the generated `PROVIDER_HEALTH_CHECKS` table in `deploy/services/api_provider_registry.py` with `DEFAULT_PROVIDER_HEALTH_CHECK` plus `PROVIDER_HEALTH_CHECK_OVERRIDES`.
- DashScope now only overrides the health-check path (`/compatible-mode/v1/models`); method and billable status inherit from the shared default.
- Provider metadata still exposes identical health-check results: 11 providers use `/models`, DashScope uses `/compatible-mode/v1/models`, all use `GET` and `billable=False`.
- Strengthened `deploy/scripts/check_provider_contract.py` so health-check metadata must be produced from the shared default plus explicit provider overrides.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_health.py`, and `scripts/check_admin_api_config_import.py` passed.

## 2026-06-22 Provider Required Env Single Source

- Removed repeated `required_env` lists from all 12 `PROVIDER_CATALOG` entries in `deploy/services/api_provider_registry.py`.
- Provider metadata now derives `required_env` from `PROVIDER_ENV_MAP` during the same post-catalog initialization pass used for defaults.
- External provider catalog responses remain unchanged: every provider still exposes its primary API-key env in `required_env`.
- Strengthened `deploy/scripts/check_provider_contract.py` so provider catalog entries cannot repeat `required_env`, and initialized metadata must match `PROVIDER_ENV_MAP`.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Fallback Env Overrides

- Added `DEFAULT_PROVIDER_FALLBACK_ENV` and `PROVIDER_FALLBACK_ENV_OVERRIDES` to `deploy/services/api_provider_registry.py`.
- Removed repeated `fallback_env` lists from all 12 `PROVIDER_CATALOG` entries.
- Provider metadata now derives fallback API-key borrowing from a default empty list plus explicit overrides (`seedance -> ARK_API_KEY`, `veo -> SORA2_API_KEY`).
- External provider catalog responses remain unchanged: 10 providers still have no fallback env, Seedance can borrow `ARK_API_KEY`, and Veo can borrow `SORA2_API_KEY`.
- Strengthened `deploy/scripts/check_provider_contract.py` so catalog entries cannot repeat `fallback_env`, and initialized metadata must match the override map.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py`, `scripts/check_admin_api_config_import.py`, and `scripts/check_admin_api_config_health.py` passed.

## 2026-06-22 Provider Credential Link Defaults

- Replaced provider-level `PROVIDER_CREDENTIAL_LINKS` in `deploy/services/api_provider_registry.py` with `VENDOR_CREDENTIAL_LINKS` plus `PROVIDER_KEY_HELP`.
- Docs and console URLs now derive from provider `vendor`, while provider-specific help text remains keyed by provider id.
- External provider catalog responses remain unchanged: every provider still exposes `docs_url`, `console_url`, and `key_help` for the admin API configuration UI.
- Strengthened `deploy/scripts/check_provider_contract.py` so docs/console links must come from vendor credential metadata and key help must come from provider-specific help text.
- Verification:
  - Local `py_compile` for provider registry and provider contract passed.
  - Local `scripts/check_provider_contract.py` and `scripts/check_admin_api_config_import.py` passed.

## 2026-06-22 Provider API Operation Paths

- Added `PROVIDER_API_PATHS` and `get_provider_api_path()` to `deploy/services/api_provider_registry.py`.
- Added `ResolvedProviderConfig.url_for_operation()` to `deploy/services/api_provider_runtime.py`.
- Updated `deploy/services/ai_proxy_service.py` so DeepSeek/Gemini text, Gemini image, and GPT Image calls resolve provider operation URLs through registry metadata instead of hardcoding path strings in business functions.
- External request URLs remain unchanged, including OpenAI-compatible `chat/completions`, Gemini `models/{model}:generateContent`, and GPT Image `images/generations` / `images/edits`.
- Strengthened `deploy/scripts/check_provider_contract.py` so AI proxy code must use `url_for_operation()` for registered provider paths.
- Verification:
  - Local `py_compile` for provider registry, runtime, AI proxy service, and provider contract passed.
  - Local `scripts/check_provider_contract.py` and `scripts/check_ai_proxy_failover.py` passed.
  - Local `pytest tests/test_api_provider_runtime_model_env.py -q` passed with 33 tests.

## 2026-06-22 External Video/Audio Operation Paths

- Extended `PROVIDER_API_PATHS` for MiniMax, Sora2, Veo, and Seedance runtime operations.
- Updated MiniMax video, Sora2 video, Veo video, Seedance query, and MiniMax audio clients so provider API paths resolve through `ResolvedProviderConfig.url_for_operation()` instead of client-local `base_url + path` construction.
- MiniMax audio keeps the shared `_request_json()` / `_request_form_json()` helpers; those helpers now accept operation ids such as `voice_clone`, `tts_sync`, and `files_upload`.
- External request URLs remain unchanged, including MiniMax `/video_generation`, `/voice_clone`, `/t2a_v2`, Sora2 `/videos`, Veo `/chat/completions`, and Seedance task polling.
- Strengthened `deploy/scripts/check_provider_contract.py` and `deploy/scripts/check_route_contract.py` so these clients cannot regress to direct provider path construction.
- Verification:
  - Local `py_compile` for changed registry, client, and contract files passed.
  - Local `scripts/check_provider_contract.py`, `scripts/check_audio_provider_runtime.py`, and `scripts/check_route_contract.py` passed.
  - Local `scripts/check_architecture_contracts.py` passed with 10/10 contracts.
  - Local `pytest tests/test_minimax_audio_runtime.py tests/test_minimax_tts_sync.py tests/test_api_provider_runtime_model_env.py -q` passed with 44 tests.

## 2026-06-22 Admin Provider Operation Path Visibility

- Added `get_provider_operation_paths()` to `deploy/services/api_provider_registry.py`.
- Provider catalog and provider status now expose `operation_paths` derived from `PROVIDER_API_PATHS`.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so API provider/config cards show the registered operation paths used by runtime calls.
- Strengthened provider and route contracts so the admin API config UI and catalog must keep exposing these paths.
- Verification:
  - Local `py_compile` for changed Python files passed.
  - Local `scripts/check_provider_contract.py` and `scripts/check_route_contract.py` passed.
  - Local frontend production build passed via bundled Node/Vite.

## 2026-06-22 Admin Provider Operation URL Templates

- Added `build_provider_operation_url_templates()` to `deploy/services/api_provider_registry.py`.
- Provider catalog now exposes `default_operation_url_templates` from each provider default endpoint plus registered operation paths.
- Runtime status now exposes `operation_urls` from the resolved endpoint, so admin can see the actual URL templates that will be used after DB/env overrides.
- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so API provider cards prefer runtime-resolved operation URLs and fall back to default templates/path metadata.
- Strengthened provider and route contracts so catalog/runtime/UI metadata cannot regress to path-only visibility.
- Verification:
  - Local `py_compile` for changed Python files passed.
  - Local `scripts/check_provider_contract.py` and `scripts/check_route_contract.py` passed.
  - Local frontend production build passed via bundled Node/Vite.

## 2026-06-23 Admin API Health Status Clarity

- Updated `deploy/new_html/admin/AdminSettingsPage.tsx` so DB config tests no longer mark the main provider card red when a runtime key is available; the primary status now reflects the effective runtime config.
- Renamed ambiguous card actions from generic connection testing to `测试 DB 配置` and `测试生效配置`.
- Renamed card status labels to `生效配置状态` and result blocks to `DB 配置测试` so DB-row validation and real generation runtime health are visibly separate.
- Strengthened `deploy/scripts/check_route_contract.py` so the UI cannot regress to the ambiguous `测试连通性` wording or let DB no-key/error override runtime status when an effective key exists.
- Verification:
  - Local `py_compile` for route contract passed.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local frontend production build passed via bundled Node/Vite.

## 2026-06-23 Frontend Provider Key Documentation Cleanup

- Replaced stale AI Studio frontend key instructions in `deploy/new_html/.env.example`, `deploy/new_html/README.md`, and `deploy/new_html/GEMINI_API_CONFIG.md`.
- Frontend docs now state that third-party provider keys must be configured server-side through `/admin/settings?item=apiconfig`, not through Vite env vars or browser localStorage.
- Gemini docs now describe the backend provider ids (`gemini-text`, `gemini-image`, `gemini-tts`), runtime key names, and backend proxy call path without exposing browser-side key setup.
- Strengthened `deploy/scripts/check_route_contract.py` so frontend docs cannot reintroduce `VITE_GEMINI_*_API_KEY`, browser Gemini key storage, or direct LaoZhang Gemini model endpoint instructions.
- Verification:
  - Local `py_compile` for route contract passed.
  - Local `scripts/check_route_contract.py` passed.
  - Local frontend production build passed via bundled Node/Vite.

## 2026-06-23 Deploy Frontend Build Hash Cleanup

- Updated `deploy/scripts/live_deploy_mvc2.sh` so frontend Markdown docs are synced as ordinary deploy files instead of forcing a full `new_html` source tar/build.
- Changed the frontend build hash marker to `.new_html_build_source.sha256` and excluded `new_html/*.md` from the build-source hash.
- Added `new_html/.env.example`, `new_html/README.md`, and `new_html/GEMINI_API_CONFIG.md` to the deploy file list so docs still reach the server when needed.
- Strengthened `deploy/scripts/check_route_contract.py` so the deploy script must keep doc sync, the build hash marker, and Markdown exclusion.
- Verification:
  - Local `bash -n scripts/live_deploy_mvc2.sh` passed.
  - Local `py_compile` for route contract passed.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - A temporary `new_html/*.md` probe did not change the frontend build hash.

## 2026-06-23 Frontend Direct Fetch Guardrail

- Audited production frontend code for direct `fetch()` calls; only `deploy/new_html/services/httpClient.ts` still uses the browser primitive.
- Strengthened `deploy/scripts/check_route_contract.py` so production `.ts/.tsx` files must route HTTP through `services/httpClient.ts`.
- The guard excludes tests, Vite config, and the shared `httpClient` implementation itself.
- Verification:
  - Local `py_compile` for route contract passed.
  - Local `scripts/check_route_contract.py` passed with `frontend_http_client_checks=12864`.
  - Local `rg "\bfetch\(" new_html` confirmed only `services/httpClient.ts` has direct fetch calls outside excluded folders.

## 2026-06-23 Video Capability Service Boundary

- Moved `/api/video/capabilities` business checks from `deploy/routers/video_capabilities.py` into `deploy/services/video_capability_service.py`.
- The router now only owns the HTTP route and delegates Seedance runtime model and ComfyUI agent availability checks to the service layer.
- Added `deploy/tests/test_video_capability_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so this route cannot regress to direct `AgentDAO` or Seedance runtime calls in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_video_capability_service.py -q` passed with 2 tests.
  - Local `scripts/check_route_contract.py` passed.

## 2026-06-23 Prompt Service Boundary

- Moved `/api/prompts/{template_type}` business logic from `deploy/routers/prompts.py` into `deploy/services/prompt_service.py`.
- Replaced the mojibake bundled rewrite/storyboard prompts with readable Chinese defaults while preserving `{text}` and `{scriptText}` placeholders.
- Added `deploy/tests/test_prompt_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so prompt routes cannot regress to direct `PromptTemplateDAO` calls or route-local default prompts.
- Verification:
  - Local `py_compile` for changed prompt route/service/contract/test files passed.
  - Local `pytest tests/test_prompt_service.py -q` passed with 5 tests.
  - Local `scripts/check_route_contract.py` passed.

## 2026-06-23 Episode Video Service Boundary

- Moved episode video segment and composition business logic from `deploy/routers/episode_video.py` into `deploy/services/episode_video_service.py`.
- The router still owns the 7 HTTP endpoints, but now delegates segment list/create/update/delete, video takes, compose start, and compose status to the service layer.
- Added `deploy/tests/test_episode_video_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so episode video routes cannot regress to direct `VideoSegmentDAO`, `EpisodeDAO`, or compose-service calls in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_episode_video_service.py -q` passed with 6 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Asset Service Boundary

- Moved project asset list/create/update/delete/share logic from `deploy/routers/assets.py` into `deploy/services/asset_service.py`.
- The router still owns the 5 asset HTTP endpoints, but now delegates asset DAO orchestration and linked entity-file copy handling to the service layer.
- Added `deploy/tests/test_asset_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so asset routes cannot regress to direct `AssetDAO` or `EntityFileDAO` orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_asset_service.py -q` passed with 7 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Script Timeline Service Boundary

- Moved script segment, multi-script, and timeline track business logic from `deploy/routers/script_timeline.py` into `deploy/services/script_timeline_service.py`.
- The router still owns the 12 script/timeline HTTP endpoints, but now delegates `EpisodeScriptSegmentDAO`, `EpisodeScriptDAO`, and `TimelineDAO` orchestration to the service layer.
- Added `deploy/tests/test_script_timeline_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so script/timeline routes cannot regress to direct DAO orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_script_timeline_service.py -q` passed with 9 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Canvas Service Boundary

- Moved canvas board, node, and connection business logic from `deploy/routers/canvas.py` into `deploy/services/canvas_service.py`.
- The router still owns the 10 canvas HTTP endpoints, but now delegates project permission checks and canvas DAO orchestration to the service layer.
- Added `deploy/tests/test_canvas_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so canvas routes cannot regress to direct permission checks or canvas DAO orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_canvas_service.py -q` passed with 9 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Entity File Service Boundary

- Moved user file listing, entity file linking/selection, upload media sync, deletion, batch deletion, and migration orchestration from `deploy/routers/entity_files.py` into `deploy/services/entity_file_service.py`.
- The router still owns the 9 entity-file HTTP endpoints, but now delegates `FileDAO`, `EntityFileDAO`, media-library sync, and migration orchestration to the service layer.
- Added `deploy/tests/test_entity_file_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so entity-file routes cannot regress to direct DAO/media/migration orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_entity_file_service.py -q` passed with 9 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Content Version Service Boundary

- Moved version and text-content business logic from `deploy/routers/content_versions.py` into `deploy/services/content_version_service.py`.
- The router still owns the 6 version/text HTTP endpoints, but now delegates project ownership checks, parent-version resolution, version restore/delete, text creation/read, and activity logging to the service layer.
- Added `deploy/tests/test_content_version_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so content version routes cannot regress to direct DAO or activity-log orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_content_version_service.py -q` passed with 8 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Episode Service Boundary

- Moved episode list/create/read/update/delete/duplicate/reorder business logic from `deploy/routers/episodes.py` into `deploy/services/episode_service.py`.
- The router still owns the 7 episode HTTP endpoints, but now delegates episode numbering, default names, duplication metadata parsing, script copy orchestration, and reorder updates to the service layer.
- Added `deploy/tests/test_episode_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so episode routes cannot regress to direct `EpisodeDAO` or `EpisodeScriptDAO` orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_episode_service.py -q` passed with 8 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Storyboard Service Boundary

- Moved storyboard list/create/update/delete/delete-all/export/reorder/mix-audio/batch/extract-to-assets business logic from `deploy/routers/storyboard.py` into `deploy/services/storyboard_service.py`.
- The router still owns the 10 storyboard HTTP endpoints, but now delegates stale script fallback, bounded field-set reads, bound asset normalization, script export transaction calls, audio mix orchestration, and asset extraction dedupe to the service layer.
- Added `deploy/tests/test_storyboard_service.py` and kept `deploy/tests/test_storyboard_stale_script_fallback.py` green with the new service boundary.
- Included `deploy/tests/test_storyboard_service.py` in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so storyboard routes cannot regress to direct `StoryboardDAO`, `EpisodeScriptDAO`, `AssetDAO`, or `EpisodeDAO` orchestration in the router while preserving the paged/lazy storyboard loading contracts.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_storyboard_service.py tests/test_storyboard_stale_script_fallback.py -q` passed with 14 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Project Core Service Boundary

- Moved DAO-backed project create/list/detail business logic from `deploy/routers/project_core.py` into `deploy/services/project_core_service.py`.
- The router still owns the 3 core project HTTP endpoints, but now delegates initial version creation, owner membership creation, activity logging, organization-scoped list authorization, project access checks, last-access update, and detail aggregation to the service layer.
- Removed the route-local dynamic `dao_organization` import by injecting `OrganizationMemberDAO` through `deploy/api_routes.py`.
- Added `deploy/tests/test_project_core_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so project core routes cannot regress to direct `ProjectDAO`, `VersionDAO`, `ProjectMemberDAO`, `UserDAO`, `ActivityLogDAO`, or `OrganizationMemberDAO` orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_project_core_service.py -q` passed with 7 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Project Admin Service Boundary

- Moved project settings, archive/unarchive, and membership management business logic from `deploy/routers/project_admin.py` into `deploy/services/project_admin_service.py`.
- The router still owns the 7 project admin HTTP endpoints, but now delegates admin/readonly permission checks, metadata updates, project archive state changes, member listing/add/update/remove, target-user validation, and owner removal protection to the service layer.
- Added `deploy/tests/test_project_admin_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so project admin routes cannot regress to direct `ProjectDAO`, `ProjectMemberDAO`, or `UserDAO` orchestration in the router.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_project_admin_service.py -q` passed with 7 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Task Notification Service Boundary

- Moved task recovery, terminal task notification formatting, task-file access checks, and persisted notification CRUD from `deploy/routers/task_notifications.py` into `deploy/services/task_notification_service.py`.
- The router still owns the 9 task/notification HTTP endpoints, but now delegates task ownership checks, active/recent task reads, terminal task `task_data` normalization, unread-count/history reads, mark-read/read-all, and dismiss operations to the service layer.
- Injected `NotificationDAO` through `deploy/api_routes.py` so the router no longer imports notification persistence directly.
- Added `deploy/tests/test_task_notification_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so task notification routes cannot regress to direct `TaskDAO`/`NotificationDAO` orchestration or route-local `task_data` parsing.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_task_notification_service.py -q` passed with 5 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 User Session Service Boundary

- Moved current-user session and organization self-service business logic from `deploy/routers/user_session.py` into `deploy/services/user_session_service.py`.
- The router still owns the 4 HTTP endpoints, but now delegates logout state cleanup, user-info timestamp formatting, organization list serialization, organization membership checks, owner-leave protection, and member removal to the service layer.
- Injected `OrganizationDAO` and `OrganizationMemberDAO` through `deploy/cluster_main.py` so the router no longer imports organization persistence directly.
- Added `deploy/tests/test_user_session_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so user session routes cannot regress to direct organization DAO calls, route-local serialization, or route-local time formatting.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_user_session_service.py -q` passed with 6 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Admin Compatibility Service Boundary

- Moved legacy admin compatibility stats/logs/user-create/user-delete business logic from `deploy/routers/admin_compat.py` into `deploy/services/admin_compat_service.py`.
- The router still owns the 4 compatibility HTTP endpoints, but now delegates admin permission checks, `group_by` validation, stats/log DAO reads, password length validation, legacy in-memory user map updates, DB user sync, audit recording, and delete guards to the service layer.
- Injected `AdminStatsDAO`, `UserDAO`, and `admin_audit_service.record` through `deploy/cluster_main.py` so the router no longer imports admin reporting or user persistence directly.
- Added `deploy/tests/test_admin_compat_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so admin compatibility routes cannot regress to direct `AdminStatsDAO`/`UserDAO` calls, route-local password checks, route-local legacy user map mutation, or route-local audit recording.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_admin_compat_service.py tests/test_admin_stats_logs.py tests/test_user_dao_admin_delete.py -q` passed with 15 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Legacy File Service Boundary

- Moved legacy version-scoped file upload/download/delete business logic from `deploy/routers/legacy_files.py` into `deploy/services/legacy_file_service.py`.
- The router still owns the 3 legacy HTTP endpoints, but now delegates version ownership checks, storage quota checks, file type/storage path generation, hash and duplicate handling, file record creation, download path fallback, range parsing, delete authorization, and activity logging to the service layer.
- Added `deploy/tests/test_legacy_file_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so legacy file routes cannot regress to direct DAO/storage/optimization/deduplication orchestration.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_legacy_file_service.py -q` passed with 6 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Generic File Route Service Boundary

- Moved generic `/api/upload` and `/api/thumbnail` business logic from `deploy/routers/files.py` into `deploy/services/file_route_service.py`.
- The router still owns the 2 HTTP endpoints and auth/HTTP response wrapping, but now delegates thumbnail source resolution, cache key generation, thumbnail rendering, cache cleanup, upload type detection, default project/version creation, file storage, DB file record creation, and DB-failure rollback to the service layer.
- Added `deploy/tests/test_file_route_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so generic file routes cannot regress to direct `FileDAO`/`ProjectDAO`/`VersionDAO`, PIL, storage path, hashing, or upload persistence orchestration.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_file_route_service.py -q` passed with 6 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 Video Crop Service Boundary

- Moved `/api/video/crop` source resolution, FFmpeg execution, cropped-file storage, default project/version resolution, and DB file record creation from `deploy/routers/video.py` into `deploy/services/video_crop_service.py`.
- The router still owns the single crop HTTP endpoint and HTTP error mapping, but now delegates DB/local/ComfyUI source lookup, persistent-storage fallback paths, ComfyUI node selection, temp-file cleanup, FFmpeg command execution, output validation, and cropped file persistence to the service layer.
- Added `deploy/tests/test_video_crop_service.py` and included it in `deploy/scripts/live_deploy_mvc2.sh` sync coverage.
- Strengthened `deploy/scripts/check_route_contract.py` so video crop routes cannot regress to direct ComfyUI fetches, FFmpeg/subprocess/tempfile orchestration, DAO method calls, or route-local storage writes.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_video_crop_service.py tests/test_video_client_base.py -q` passed with 12 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.

## 2026-06-23 ComfyUI Upload Record Service Boundary

- Moved ComfyUI image/video upload DB persistence from `deploy/routers/comfyui_files.py` into `deploy/services/comfyui_file_service.py`.
- The router still owns HTTP upload handling, node selection, local file writes, and ComfyUI forwarding, but now delegates default project/version creation, `FileDAO.create_file`, download URL construction, and Redis filename mapping to `create_comfyui_upload_record()`.
- Extended `deploy/tests/test_comfyui_file_service.py` to cover default project/version creation, existing-version reuse, DB file URL behavior, and Redis mapping preservation.
- Strengthened `deploy/scripts/check_route_contract.py` so ComfyUI file routes cannot regress to direct upload persistence DAO calls.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_comfyui_file_service.py -q` passed with 5 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `be7aef9`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Video Reupload Service Boundary

- Moved `/api/comfyui/reupload/video` source resolution and reupload workflow from `deploy/routers/comfyui_files.py` into `deploy/services/comfyui_file_service.py`.
- The router still owns auth, target ComfyUI node selection, and HTTP error mapping, but now delegates persistent-storage path resolution, ComfyUI fallback downloads, UUID reupload filename generation, upload failure handling, and response shaping to `reupload_comfyui_video_with_uuid()`.
- Extended `deploy/tests/test_comfyui_file_service.py` to cover storage-hit reupload, ComfyUI fallback reupload, missing source errors, and upload failure errors.
- Strengthened `deploy/scripts/check_route_contract.py` so the reupload route cannot regress to route-local storage path parsing, ComfyUI fallback loops, or `_reuploaded` filename generation.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_comfyui_file_service.py -q` passed with 9 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `c83992c`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh` sync/restart, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Audio Upload Service Boundary

- Moved `/api/upload/audio` ComfyUI upload workflow from `deploy/routers/comfyui_files.py` into `deploy/services/comfyui_file_service.py`.
- The router still owns auth, request body reading, target video-node selection, and HTTP error mapping, but now delegates UUID upload filename generation, ComfyUI upload calls, response filename parsing, best-effort local audio backup, upload rejection handling, and response shaping to `upload_audio_file_to_comfyui()`.
- Extended `deploy/tests/test_comfyui_file_service.py` to cover audio upload success, backup persistence, ComfyUI filename parsing, and rejected-upload errors.
- Strengthened `deploy/scripts/check_route_contract.py` so the audio upload route cannot regress to route-local ComfyUI upload calls, response JSON parsing, or audio backup writes.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_comfyui_file_service.py -q` passed with 11 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `3e74fbf`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI View Fallback Service Boundary

- Moved `/api/proxy/comfyui/view` fallback-fetch behavior from `deploy/routers/comfyui_files.py` into `deploy/services/comfyui_file_service.py`.
- The router still owns auth, target node selection, and `StreamingResponse` construction, but now delegates ComfyUI `/view` params, 404 fallback ordering, non-OK response handling, and status-bearing view errors to `fetch_comfyui_view_with_fallback()`.
- Extended `deploy/tests/test_comfyui_file_service.py` to cover output→temp fallback and status-preserving fetch failures.
- Strengthened `deploy/scripts/check_route_contract.py` so the proxy route cannot regress to route-local fallback lists, status-code 404 loops, or direct `fetch_comfyui_view_response()` calls.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_comfyui_file_service.py -q` passed with 13 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `04038a4`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Video Upload Service Boundary

- Moved `/api/comfyui/upload/video` ComfyUI upload, local video persistence, and DB file record creation from `deploy/routers/comfyui_files.py` into `deploy/services/comfyui_file_service.py`.
- The router still owns auth, upload body reading, target video-node selection, and HTTP error mapping, but now delegates UUID filename generation, ComfyUI upload calls, response filename parsing, local video storage, `create_comfyui_upload_record()`, and response shaping to `upload_video_file_to_comfyui()`.
- Extended `deploy/tests/test_comfyui_file_service.py` to cover video upload success, local save, DB record creation, and rejected-upload errors.
- Strengthened `deploy/scripts/check_route_contract.py` so the video upload route cannot regress to route-local ComfyUI upload calls, response JSON parsing, local video writes, or DB record creation.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_comfyui_file_service.py -q` passed with 15 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `3874959`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 ComfyUI Image Upload Service Boundary

- Moved `/api/comfyui/upload` image upload persistence, optional ComfyUI forwarding, DB file record creation, Redis filename mapping, and response shaping from `deploy/routers/comfyui_files.py` into `deploy/services/comfyui_file_service.py`.
- The router still owns auth, empty-file validation, target ComfyUI node selection, and HTTP error mapping, but now delegates UUID filename generation, local image storage, ComfyUI upload calls, response filename parsing, `create_comfyui_upload_record()`, Redis mapping, and response shaping to `upload_image_file_to_comfyui()`.
- Extended `deploy/tests/test_comfyui_file_service.py` to cover image upload success, local save, DB record creation, Redis mapping, and nonfatal ComfyUI forwarding failures.
- Strengthened `deploy/scripts/check_route_contract.py` so the image upload route cannot regress to route-local ComfyUI upload calls, response JSON parsing, local image writes, UUID generation, timestamp generation, or DB record creation.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_comfyui_file_service.py -q` passed with 17 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `3bcb7b0`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh` sync/restart, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.
  - Note: local deployment wrapper hit the 300s command timeout after the server restart; manual server checks confirmed synced files, active service, remote contracts, and online smoke success.

## 2026-06-23 Project Image Persistence Service Boundary

- Moved project-embedded base64 image persistence and export-to-video storyboard image persistence from `deploy/routers/projects.py` into `deploy/services/project_image_service.py`.
- The legacy project router still owns project JSON traversal, selected storyboard-image choice, access checks, and project stage updates, but now delegates base64 decoding, local image storage, WebP conversion, default project/version fallback, `FileDAO.create_file()`, and image file URL shaping to the service layer.
- Added `deploy/tests/test_project_image_service.py` to cover embedded project image persistence, default project/version creation, existing-version reuse with raw fallback, and export storyboard image persistence.
- Strengthened `deploy/scripts/check_route_contract.py` so `routers/projects.py` cannot regress to route-local base64 decoding, UUID/timestamp generation, `persistent_storage/images` writes, WebP conversion, or direct `FileDAO.create_file()` calls.
- Added the new project image service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_project_image_service.py tests/test_project_read_access.py -q` passed with 7 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `59cd115`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Project Read Service Boundary

- Moved legacy project detail read shaping and per-shot image loading from `deploy/routers/projects.py` into `deploy/services/project_read_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates project read permission checks, JSON settings parsing, thumbnail-only generated-image thinning, shot image URL backfill, and project access timestamp updates to the service layer.
- Added `deploy/tests/test_project_read_service.py` to cover thumbnail-mode payload thinning, full-mode URL preservation, member/visitor access behavior, shot image URL backfill, and missing/empty image cases.
- Strengthened `deploy/scripts/check_route_contract.py` so project detail and shot-image routes cannot regress to route-local JSON parsing, thumbnail shaping, URL backfill, permission helper definitions, or `ProjectDAO.update_project_access()` calls.
- Added the new project read service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_project_read_service.py tests/test_project_read_access.py -q` passed with 9 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `4d2a571`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Project Video Task Service Boundary

- Moved `/api/projects/{project_id}/export-to-video` and `/api/projects/{project_id}/clear-video-tasks` workflow from `deploy/routers/projects.py` into `deploy/services/project_video_task_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates owner validation, export version resolution/creation, project settings parsing, selected/first image resolution, base64 image persistence fallback, `video_tasks` construction, stage update, and project save to the service layer.
- Added `deploy/tests/test_project_video_task_service.py` to cover selected-image export, base64 persistence with version creation, persistence failure fallback, clearing existing tasks, and missing/forbidden project errors.
- Strengthened `deploy/scripts/check_route_contract.py` so export/clear routes cannot regress to route-local version creation, JSON parsing, selected-image selection, base64 persistence, `video_tasks` mutation, or `ProjectDAO.save_or_update_project()`.
- Added the new project video task service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_project_video_task_service.py tests/test_project_read_access.py -q` passed with 9 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `4b3a08e`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Project Save Service Boundary

- Moved `/api/projects/save` workflow from `deploy/routers/projects.py` into `deploy/services/project_save_service.py`.
- The router still owns route registration, auth dependency, and HTTP error mapping, but now delegates timestamp/user stamping, existing project data loading, `video_tasks` and `generated_images` preservation, generated-image URL recovery, nested Base64 image persistence, and `ProjectDAO.save_or_update_project()` to the service layer.
- Rewrote `deploy/routers/projects.py` as a thin ASCII route module, removing the legacy route-local Base64 conversion helper and preserving the existing 7 project route registrations.
- Added `deploy/tests/test_project_save_service.py` to cover existing collection preservation, generated-image URL recovery, nested Base64 conversion across project payload sections, and persistence failure fallback.
- Strengthened `deploy/scripts/check_route_contract.py` so `/api/projects/save` cannot regress to route-local JSON parsing, timestamping, old-data recovery, Base64 persistence, or direct project DAO save calls.
- Added the new project save service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_project_save_service.py tests/test_project_image_service.py tests/test_project_read_access.py -q` passed with 10 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `fb2296f`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Audio Generation Persistence Service Boundary

- Moved generated-audio file registration and media-library sync tail work from `deploy/routers/audio.py` into `deploy/services/audio_generation_service.py`.
- The affected routes still own provider selection and HTTP error mapping, but now delegate local `audio_url` basename resolution, generated audio file reads, `save_generated_file_to_db()` calls, `file_id`/`file_url` response enrichment, and best-effort media-library indexing to `attach_local_generated_audio_file()`.
- Updated `/api/audio/generate-speech`, `/api/audio/generate-sfx`, `/api/audio/generate-music`, and `/api/minimax/music` to use the shared service. `/api/minimax/tts/sync` remains route-local for now because it also performs character voice sample URL write-back.
- Added `deploy/tests/test_audio_generation_service.py` to cover local file save/media sync, basename-only URL handling, missing local files, save failure fallback, and media-library failure fallback.
- Strengthened `deploy/scripts/check_route_contract.py` so these generated-audio routes cannot regress to route-local `AUDIO_UPLOAD_DIR` path assembly, local byte reads, or direct `media_library_service.create_from_file()` calls.
- Added the new audio generation service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_audio_generation_service.py tests/test_audio_provider.py tests/test_minimax_audio_runtime.py -q` passed with 18 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `7bacc11`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 MiniMax Sync TTS Service Boundary

- Moved `/api/minimax/tts/sync` fast-path workflow from `deploy/routers/audio.py` into `deploy/services/audio_generation_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates short-text validation, MiniMax `tts_sync()` invocation, missing-audio checks, generated audio file persistence, media-library sync, character voice sample URL write-back, and response shaping to `generate_minimax_tts_sync_response()`.
- Extended `deploy/tests/test_audio_generation_service.py` to cover successful sync TTS save/media sync/voice binding, empty and overlong text validation, provider failure, missing audio bytes, and nonfatal media/voice write-back failures.
- Strengthened `deploy/scripts/check_route_contract.py` so `/api/minimax/tts/sync` cannot regress to route-local provider calls, `audio_bytes` handling, file saves, media-library sync, or character voice URL write-back.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_audio_generation_service.py tests/test_audio_provider.py tests/test_minimax_audio_runtime.py -q` passed with 22 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `b94fd32`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 MiniMax File Service Boundary

- Moved `/api/minimax/files/upload`, `/api/minimax/files/{file_id}` GET, and `/api/minimax/files/{file_id}` DELETE workflows from `deploy/routers/audio.py` into `deploy/services/audio_minimax_file_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates upload filename sanitization, audio extension/size validation, temp file creation, MiniMax `file_upload()` calls, best-effort temp cleanup, and retrieve/delete response shaping to the service layer.
- Added `deploy/tests/test_audio_minimax_file_service.py` to cover sanitized temp upload paths, cleanup, nested/top-level MiniMax file IDs, extension and size validation, provider failure cleanup, and retrieve/delete wrappers.
- Strengthened `deploy/scripts/check_route_contract.py` so MiniMax file routes cannot regress to route-local temp path assembly, file reads/writes, `uuid`, `os.remove`, or direct MiniMax file API calls.
- Added the new MiniMax file service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_audio_minimax_file_service.py tests/test_audio_generation_service.py tests/test_minimax_audio_runtime.py -q` passed with 19 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `a5f5999`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh` sync/restart, manual remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.
  - Note: the local deployment wrapper timed out while waiting for output, but manual server checks confirmed synced files, active service, remote contracts, and online smoke success.

## 2026-06-23 MiniMax Voice Service Boundary

- Moved `/api/minimax/voice-design`, `/api/minimax/voice-clone`, `/api/minimax/voices`, `/api/minimax/voices/{voice_id}` GET, and `/api/minimax/voices/{voice_id}` DELETE workflows from `deploy/routers/audio.py` into `deploy/services/audio_minimax_voice_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates MiniMax voice design, clone, list, get, and delete provider calls plus response shaping to the service layer.
- Added `deploy/tests/test_audio_minimax_voice_service.py` to cover payload forwarding and success response wrapping for voice design, clone, list, get, and delete.
- Strengthened `deploy/scripts/check_route_contract.py` so MiniMax voice routes cannot regress to direct route-local `client.voice_design()`, `client.voice_clone()`, `client.list_voices()`, `client.get_voice()`, or `client.delete_voice()` calls.
- Added the new MiniMax voice service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_audio_minimax_voice_service.py tests/test_audio_minimax_file_service.py tests/test_audio_generation_service.py tests/test_minimax_audio_runtime.py -q` passed with 22 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `5e24b02`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 MiniMax Content Service Boundary

- Moved `/api/minimax/tts/{task_id}`, `/api/minimax/music`, and `/api/minimax/lyrics` workflows from `deploy/routers/audio.py` into `deploy/services/audio_minimax_content_service.py`.
- The router still owns route registration and HTTP error mapping, but now delegates MiniMax TTS query, music generation with generated-file/media-library tail work, and lyrics extraction to the service layer.
- Added `deploy/tests/test_audio_minimax_content_service.py` to cover TTS query wrapping, music generation persistence, media-library metadata, and lyrics extraction.
- Strengthened `deploy/scripts/check_route_contract.py` so these MiniMax content routes cannot regress to route-local `client.tts_query()`, `client.music_generate()`, `client.lyrics_generate()`, or local generated-file attachment calls.
- Added the new MiniMax content service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_audio_minimax_content_service.py tests/test_audio_minimax_voice_service.py tests/test_audio_minimax_file_service.py tests/test_audio_generation_service.py tests/test_minimax_audio_runtime.py -q` passed with 25 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `ce430f0`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 AI Proxy Image Persistence Boundary

- Moved generated-image file persistence and media-library indexing for `/api/gemini/image`, `/api/gpt-image/generate`, and `/api/materials/doubao` from `deploy/routers/ai_proxy.py` into `deploy/services/ai_proxy_image_persistence_service.py`.
- The router still owns auth, request/reference shaping, provider dispatch, task row creation, and HTTP error mapping, but now delegates generated image byte loading, `save_generated_file_to_db()`, file-record lookup, media-library sync, and per-image failure fallback to the service layer.
- Added `deploy/tests/test_ai_proxy_image_persistence_service.py` to cover successful image persistence/media sync, GPT-style remote URL response shape, save failure fallback, and nonfatal media-library failure.
- Strengthened `deploy/scripts/check_route_contract.py` so AI proxy image routes cannot regress to route-local `generated_image_content()`, `save_generated_file_to_db`, `media_library_service`, `FileDAO`, or `create_from_file()` usage.
- Added the new AI proxy image persistence test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_ai_proxy_image_persistence_service.py tests/test_api_provider_runtime_model_env.py -q` passed with 36 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `84c82fc`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Generation Multi-Grid Image Persistence Boundary

- Reused `deploy/services/ai_proxy_image_persistence_service.py` for `/api/generate/multi-grid-storyboard` generated-image file persistence and media-library indexing.
- `deploy/routers/generation.py` still owns request validation, reference-image shaping, Gemini image provider dispatch, and HTTP error mapping, but no longer directly imports `file_service`, `media_library_service`, or `FileDAO` for the multi-grid storyboard save path.
- Strengthened `deploy/scripts/check_route_contract.py` so the multi-grid storyboard route cannot regress to route-local `save_generated_file_to_db`, `media_library_service`, `FileDAO`, `create_from_file()`, or generated-image `base64.b64decode()` persistence logic.
- Verification:
  - Local `py_compile` for changed route/contract files passed.
  - Local `pytest tests/test_ai_proxy_image_persistence_service.py tests/test_api_provider_runtime_model_env.py -q` passed with 36 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `7566737`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 AI Proxy Task Persistence Boundary

- Moved AI proxy task row creation/completion for `/api/deepseek/chat`, `/api/gemini/text`, `/api/gemini/image`, and `/api/materials/doubao` from `deploy/routers/ai_proxy.py` into `deploy/services/ai_proxy_task_service.py`.
- The router still owns auth, request/reference shaping, provider dispatch, streaming response wiring, and HTTP error mapping, but now delegates task id generation, `TaskDAO.create_task()`, `TaskDAO.update_task_status()`, result truncation, and best-effort task persistence failure handling to the service layer.
- Added `deploy/tests/test_ai_proxy_task_service.py` to cover DeepSeek task creation, text result completion/truncation, Gemini text task create+complete, image task create+complete, and nonfatal DAO failures.
- Strengthened `deploy/scripts/check_route_contract.py` so AI proxy routes cannot regress to route-local `TaskDAO` imports/calls or `time.time()` task id generation.
- Added the new AI proxy task service test to `deploy/scripts/live_deploy_mvc2.sh` so server sync includes it.
- Verification:
  - Local `py_compile` for changed route/service/contract/test files passed.
  - Local `pytest tests/test_ai_proxy_task_service.py tests/test_ai_proxy_image_persistence_service.py tests/test_api_provider_runtime_model_env.py -q` passed with 41 tests.
  - Local `scripts/check_route_contract.py` and `scripts/check_architecture_contracts.py` passed.
  - Local `scripts/smoke_test.py` passed 9/9.
  - Commit `d29ef39`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh`, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-06-23 Excel Test Issue Fix Batch 1

- Read `C:/Users/Administrator/Desktop/漫剧平台测试问题.xlsx`; both `06.23` and `Sheet1` contain test issues.
- Fixed Seedance single-image video generation: one storyboard image marked as `first_frame` is now accepted as `seedance_i2v` instead of being blocked by the first/last-frame pair validation or misrouted as `seedance_multi`.
- Stabilized episode duplication UX: added a shared `duplicateEpisode()` frontend service call and changed episode card numbers to render from current list order, preventing visible skipped numbers after delete/copy/sort drift.
- Reduced audio batch noise: "全部生成" on the dubbing page now only submits clips that do not already have generated audio and uses a local running lock to prevent duplicate batch clicks.
- Added frontend regression tests for episode duplication API wiring and Seedance task-type inference.
- Still open from the spreadsheet: image/storyboard quality consistency, intermittent next-day missing media, and deeper storyboard generation partial failures require separate data/provider investigation.
- Verification:
  - Local Vitest targeted run passed: `videoModelService.test.ts` and `projectWorkflowService.test.ts` (7 tests).
  - Local `vite build` for `deploy/new_html` passed; only the existing chunk-size warning remained.
  - Commit `983b209`, push to `origin/refactor/v2`, `live_deploy_mvc2.sh` sync/restart, remote architecture contracts, and online smoke `https://mecha.one` passed 9/9.

## 2026-07-07 Storage Layout Migration Preparation

- Added canonical storage path helper `deploy/utils/storage_layout.py`.
- Updated generated file persistence so new image/video/audio outputs are written as `persistent_storage/{file_type}/{user_id}/{project_id}/{episode_id}/{YYYYMM}/{uuid.ext}` when project/episode context is available.
- Added best-effort `episode_id -> project_id` DAO lookup before choosing the generated-file storage path.
- Added optional `project_id`, `episode_id`, and `source` write support in the `files` DAO with legacy-column fallback.
- Added SQL migration `deploy/sql/db_migration_files_project_episode_source.sql` to add and backfill `files.project_id`, `files.episode_id`, and `files.source`.
- Added read-only audit script `deploy/scripts/audit_storage_manifest.py` for missing DB refs, disk orphans, and unowned media files.
- Added dry-run restructure manifest script `deploy/scripts/restructure_storage_manifest.py`; it generates CSV and SQL update plans but does not move/delete files.
- Added `deploy/sql/` plus the two storage migration scripts to `deploy/scripts/live_deploy_mvc2.sh` so server deployments do not miss migration tooling.
- Added clean migration package script `deploy/scripts/build_clean_migration_package.py` to export only valid referenced files and generate new-server cleanup SQL for excluded dirty records.
- Migration notes:
  - Do not delete or move `persistent_storage` data until `storage_audit_reports/*.csv` has been reviewed.
  - Suggested server order: deploy code, run SQL migration, run audit script, review orphan/unowned/missing lists, then generate restructure manifest.
  - Old generated files remain readable because existing `file_url` values are unchanged until a reviewed migration SQL is applied.
- Remaining:
  - Add an apply script only after reviewing dry-run manifests on the live server.
  - Decide cleanup policy for disk orphans: quarantine first, delete only after backup and user confirmation.

## 2026-07-07 Clean Migration Package

- Built clean migration package on the current GCP server at `/home/Administrator/deploy/clean_migration_export`.
- Materialized `clean_migration_export/persistent_storage` with hardlinks, so the export tree is ready for rsync while avoiding duplicate disk blocks on the old server.
- Generated local copies under `deploy/clean_migration_export/`.
- Valid referenced files included: 1891 files, about 4.98 GB by DB size.
- Included by type: image 984, audio 595, video 312.
- Excluded dirty file records: 193.
- Excluded missing file references: 175.
- Excluded unowned file references: 80.
- Excluded disk orphan files: 873.
- Key outputs:
  - `clean_migration_export/manifests/clean_files_manifest.csv`
  - `clean_migration_export/manifests/excluded_file_records.csv`
  - `clean_migration_export/sql/01_update_valid_file_paths.sql`
  - `clean_migration_export/sql/02_exclude_dirty_file_records.sql`
  - `/tmp/mecha-clean-migration-manifests.tgz` on the server for manifest/SQL transfer.
- Migration rule:
  - New server should receive only `clean_migration_export/persistent_storage`.
  - After restoring DB on the new server, run the two generated SQL files in order.
  - Do not migrate `storage_audit_reports/disk_orphans.csv` paths, missing file references, or unowned file records.
- Orphan-file handling update:
  - Disk-only orphan files should be packaged separately and transferred back to the local workstation for manual review.
  - Use `deploy/scripts/package_storage_orphans.py --archive` after `audit_storage_manifest.py` has produced `storage_audit_reports/disk_orphans.csv`.
  - The orphan package must not be copied to the new production server wholesale; only files manually selected by the owner should be re-uploaded later.

## 2026-07-07 Admin Recycle Bin And Multi-Key Management

- Added admin file recycle-bin backend:
  - `GET /api/admin/trash/files`
  - `POST /api/admin/trash/files/{file_id}/restore`
  - `DELETE /api/admin/trash/files/{file_id}/purge`
  - `POST /api/admin/trash/files/purge`
- Permanent purge requires `risk_ack=true` and is restricted to files under `deploy/persistent_storage`; this is intentionally conservative so database mistakes cannot delete source code or unrelated system files.
- Existing admin media deletion already soft-deletes `media_library_items` and related `files`, so the recycle bin manages those soft-deleted file records and can restore them or release disk space.
- Added multi API key management on top of `api_configurations`: each key is stored as one config row; switching active key enables one row and disables other keyed rows for the same provider.
- Added backend endpoints:
  - `POST /api/admin/api-configs/bulk-keys`
  - `POST /api/admin/api-configs/{config_id}/activate`
- Updated `new_html/admin/AdminSettingsPage.tsx` with batch-key input, active-key badge, key suffix preview, active-key switch button, and a file recycle-bin panel.
- Deployment note: `deploy/scripts/live_deploy_mvc2.sh` now includes `admin_recycle_bin_routes.py`; it already syncs the full `services`, `dao`, and `utils` directories.

## 2026-07-09 Storyboard And Video Generation Check

- Hardened AI proxy reference helpers so `references=None` is treated as an empty list for Gemini Image, GPT Image, and Doubao image calls.
- Added stack traces to the `/api/gemini/image` fallback error log for future production debugging.
- Verification:
  - Local `py_compile` passed for `deploy/routers/ai_proxy.py` and `deploy/services/ai_proxy_reference_service.py`.
  - Local targeted tests passed: `tests/test_ai_proxy_reference_service.py` (6/6).
  - Deployed the two backend files to `mecha.5kcrm.cn`; `drama.service` restarted and stayed active.
  - Live `/api/gemini/image` minimal generation succeeded with 1 generated image and 1 persisted file.
- Video finding:
  - Recent video generation failures are concentrated on DashScope models (`happyhorse_r2v`, `kling_i2v`).
  - Provider health returns DashScope `401 InvalidApiKey`, so those failures require replacing the effective DashScope / Alibaba Model Studio key or using healthy Seedance models for demo flows.
  - DashScope `InvalidApiKey` / `MissingApiKey` / HTTP 401 errors are now treated as non-retryable in `deploy/core/worker.py` to avoid repeated failure notifications for the same invalid key.
  - Seedance `ModelNotOpen` / auth errors are now treated as non-retryable and reported with an actionable user-facing message.
  - Runtime Seedance model resolution no longer lets `fast` silently borrow the generic standard-model env value.
  - `mecha.5kcrm.cn` was temporarily switched from Seedance 2.0 model ids to `doubao-seedance-1-0-pro-250528` because the current Ark account has not activated `doubao-seedance-2-0-260128`.
  - Verification after deploy: `drama.service` active and server-side smoke test passed 9/9.

## 2026-07-09 Smoke Follow-Up And Task Status Cleanup

- Fixed final task failure persistence in `deploy/core/task_queue.py`: when Redis reaches the final failed state, SQL `tasks.status` is now updated to `failed` with the error message.
- This prevents `/api/tasks/active` from continuing to show old `pending` / `processing` rows after workers have already emitted failure notifications.
- Updated `deploy/scripts/check_gpu_agent_readiness.py` so GPU Agent restart commands use `PUBLIC_BASE_URL` / `SERVER_BASE_URL` / `SMOKE_BASE_URL` before falling back to `https://mecha.one`.
- Deployed the narrow fix to `mecha.5kcrm.cn`, restarted `drama.service`, and restored the public Agent script at `/storage/tools/comfyui_agent.py`.
- Cleaned 27 stale task rows on the test server; active task samples are now 0.
- Verification:
  - Server-side `scripts/smoke_test.py http://127.0.0.1:6006` passed 9/9.
  - `scripts/check_api_config_runtime_loader.py` passed.
  - `scripts/check_provider_contract.py` passed.
  - Recent service logs after restart show no new traceback/error stack.
- Remaining runtime dependency:
  - GPU Agent is still offline. The latest public script is downloadable, but local GPU / ComfyUI tasks require restarting the external GPU Agent with the admin token.
