# Conventions

## Naming

| Item | Convention | Example |
|------|-----------|---------|
| Python files | snake_case | `api_routes.py`, `dao_content.py` |
| Python classes | PascalCase | `FileDAO`, `TaskQueue` |
| Python functions | snake_case | `save_generated_file_to_db()` |
| TS/TSX files | PascalCase (components/pages), camelCase (services/hooks) | `DesignPage.tsx`, `apiService.ts` |
| React components | PascalCase | `StoryboardGenPage`, `DubbingPanel` |
| React hooks | use + PascalCase | `useEntityFilesQuery`, `useSSEInvalidation` |
| API routes | /api/kebab-case | `/api/entity-files/upload` |
| DB tables | snake_case plural | `storyboard_items`, `files` |
| DB columns | snake_case | `entity_type`, `file_role` |
| queryKey | camelCase array | `['entityFiles', entityType, entityId]` |

## File Organization

| Layer | Path | Pattern |
|-------|------|---------|
| Backend routes | `*_routes.py` | FastAPI router, grouped by domain |
| Backend DAO | `dao_*.py` | One DAO class per domain entity |
| Backend workers | `worker_*.py` | Process-level workers for ComfyUI |
| Frontend pages | `new_html/pages/*.tsx` | One file per route, thin wrapper |
| Frontend components | `new_html/components/*.tsx` | Heavy logic components |
| Frontend services | `new_html/services/*.ts` | API client functions, no state |
| Frontend hooks | `new_html/hooks/*.ts` | React Query hooks, stateful logic |
| Frontend contexts | `new_html/contexts/*.tsx` | React Context providers |
| SQL schemas | `sql/*.sql`, `database_schema.sql` | CREATE TABLE + migrations |

## Dual-Repo Mirror（双仓镜像约定）⭐

本项目存在 **同 git repo 内的双仓镜像**：根目录是开发副本，`deploy/` 是云端部署
打包用的镜像，按 `DEPLOY_GUIDE.md` 上传到生产服务器。这套机制是手工维护的：
没有自动同步会反复漂移，是大量「线上 bug 反复出现」的根因。

### 镜像规则（root → deploy/，单向）

| 源（根目录）                        | 目标                                          |
|------------------------------------|-----------------------------------------------|
| `*.py`                             | `deploy/*.py`                                 |
| `database_schema.sql`              | `deploy/database_schema.sql` 和 `deploy/sql/database_schema.sql` |
| `db_migration_*.sql`               | `deploy/db_migration_*.sql` 和 `deploy/sql/db_migration_*.sql` |
| `new_html/**`                      | `deploy/new_html/**`（仅 .ts/.tsx/.js/.jsx/.css/.md/.json/.html/.svg/.txt） |
| `docs/**/*.md`                     | `deploy/docs/**/*.md`                         |
| `workflows/**`                     | `deploy/workflows/**`                         |

**不镜像**：`tests/`, `__tests__/`, `node_modules/`, `dist/`, `context/`,
`new_html2/`, `temp/`, `assets/`, `_release/`, `__pycache__/`, `.vite/`,
`agent-transcripts/`, `terminals/`, `.claude/`, `.cursor/`, `.worktrees/`。

> 前端 `dist/` 不进 deploy/——生产前端是把根 `dist/` 直接上传到 web 根；
> `deploy/new_html/` 只是开发期源码备份。

### 工作流：每次代码改动后

```bash
# 1. 改完根仓代码（normal 开发）
# 2. 检查是否漂移（pre-commit/pre-push gate）
python scripts/sync_to_deploy.py --check

# 3. 漂移则同步（一键）
python scripts/sync_to_deploy.py --apply

# 4. 只想同步今天改的文件（白名单）
python scripts/sync_to_deploy.py --apply --paths \
    new_html/pages/VideoGenPage.tsx \
    new_html/components/VideoPage.tsx
```

### Iron Rule

- **任何 commit 之前必须 `python scripts/sync_to_deploy.py --check` 退出 0**。
- 不要直接编辑 `deploy/`（除非脚本主动 sync，否则 root → deploy/ 会被覆盖）。
- 新增顶层 `*.py` / `db_migration_*.sql` 即被自动捕获，无需手工列入白名单。
- 删除根仓的文件后，sync 会把对应 `deploy/` 文件标为 orphan，`--apply` 会一并删除。

### Pre-commit Hook（推荐，opt-in）

```bash
# 一次性安装：commit 前自动检查漂移，未同步的 commit 直接阻止
cp scripts/hooks/pre-commit.sample .git/hooks/pre-commit
# Linux/macOS 还要：chmod +x .git/hooks/pre-commit
```

未装也可以，但人工记忆容易漏；装上之后，所有 push 到远端的 commit 都保证镜像一致。

### 为什么不直接合并成单仓？

- `deploy/` 是云端部署的**上传根目录**：里面有独立 `package.json`, `vite.config.ts`,
  `requirements.txt`, `DEPLOY_GUIDE.md`，按 `DEPLOY_GUIDE.md` 步骤 1 直接上传到
  `/opt/my2/`。云端不会安装根目录的开发依赖。
- 需要单独的目录边界来打部署包，但又要避免维护成本，因此用 `sync_to_deploy.py`
  自动镜像替代手工 `xcopy`。

## Backend Patterns

### Request Models
```python
class SomeRequest(BaseModel):
    # business fields
    prompt: str
    # entity tracking fields (ALL generation endpoints must include these)
    entity_type: Optional[str] = Field(None)
    entity_id: Optional[str] = Field(None)
    file_role: Optional[str] = Field(None)
    episode_id: Optional[str] = Field(None)
```

### File Persistence
```python
# ALWAYS use save_generated_file_to_db() for generated content
result = await save_generated_file_to_db(
    content=file_bytes,
    file_type='image',     # image | audio | video | text
    user_id=user_id,
    source='gemini',       # gemini | doubao | minimax | comfyui | upload
    entity_type='storyboard_item',
    entity_id=item_id,
    file_role='generated_image',
)
# Returns: { file_id, file_url, file_path }
```

### DAO Usage
```python
# CORRECT: use dao_content.FileDAO.create_file() — supports entity fields
from dao_content import FileDAO
await FileDAO.create_file(entity_type=..., entity_id=..., file_role=...)

# WRONG: dao_file.FileDAO.create() — does NOT support entity fields
```

### API Response Format (generation endpoints)
```python
# Return BOTH legacy + new formats during migration
return {
    "images": [data_url_1, ...],           # legacy compat
    "files": [{"data_url": ..., "file_id": ..., "file_url": ...}],  # new
}
```

### External Video API Integration Pattern

新增第三方视频生成 API（如 Seedance 2.0）必须遵循：

1. **客户端文件命名**：`<provider>_api.py`（root + 镜像 `deploy/<provider>_api.py`），导出单例 `get_<provider>_client()`。
2. **Client 必须实现三方法**：
   - `create_video_task(...) -> str` — 提交任务，返回 ark/provider 侧 task_id
   - `query_task(task_id) -> dict` — 轮询状态（status/progress/video_url/error）
   - `download_video(url) -> bytes` — 拉取最终视频字节
3. **task_type 命名**：`<provider>_<scenario>`（如 `seedance_t2v` / `seedance_i2v` / `seedance_morph`），worker 用 `task.task_type.startswith('<provider>_')` 路由到 `_process_<provider>_task`。
   **共享 endpoint 例外**：当多个 provider 共享同一 API endpoint + Key + 状态机时（如 DashScope 视频族 Wan2.6 / Kling / Vidu / HappyHorse），**worker 用一个 `_process_dashscope_video_task` 统一处理**，按 `task.task_type.startswith('kling_'|'vidu_'|'happyhorse_')` 派发到同一函数，禁止为每家新建独立处理函数——详见 `recurring-pitfalls.md §P`。
4. **保存视频必须走 `_save_external_video`**（不要直接写文件），它会：
   - 落盘 `persistent_storage` + 写 `files` 表（带 `entity_type/entity_id/file_role`）
   - 调 `_sync_legacy_on_file_create` 同步 `video_segments.video_url` / `thumbnail_url`
   - 生成 thumbnail 并 sync 第二次（`file_role=video_thumbnail`）
5. **API key fallback 约定**：
   - subscriber-specific env 优先（如 `SEEDANCE_API_KEY`）
   - **Volcengine Ark 系列**（doubao / seedance）回落 `ARK_API_KEY`
   - Client `__init__` 内做兜底：`api_key or os.getenv('FOO_API_KEY') or os.getenv('ARK_API_KEY')`
6. **Provider 注册**：
   - `cluster_main.py::PROVIDER_ENV_MAP` 加 `'<provider>': '<PROVIDER>_API_KEY'`
   - `admin_routes.py::PRESET_API_MODELS` 加 preset 行，便于管理后台一键导入
7. **GenerateRequest 扩展原则**：provider 专用字段（如 `sub_model` / `media_inputs` / `ratio` / `watermark` / `generate_audio` / `camera_fixed` / `draft_task_id`）一律 `Optional[...] = Field(None, ...)`，旧家 API 不传不影响。

### 长任务必须 worker 卸载（2026-05-24 强制）

**规则**: 任何 handler 内 `max_wait > 60s` 的轮询都必须迁到 worker。

**原因**: autodl 反代 idle timeout ~5min，nginx 默认 60s。handler 内长 await 会被反代杀连接，前端体感卡死。

**模板**:
1. handler: `await task_service.get().submit(task_type, task_data, user_id, prepare=False)` → 立刻 return task_id
2. worker.py dispatch 分支: `elif task.task_type == '<your_type>': return await self._process_<your_type>_task(task)`
3. worker 方法内: 跑完整轮询 + 入库 + entity 同步 + `task_queue.complete_task(task_id, result)`
4. 前端: POST 拿 task_id → `getTaskStatus(task_id)` 轮询

详见 recurring-pitfalls §Q。

## Frontend Patterns

### Generated Image ID Rule
```typescript
// MUST use fileId as the GeneratedImage.id when available
const newImage: GeneratedImage = {
    id: r.fileId || uuidv4(),    // fileId first, fallback to uuid
    url: r.url,
    fileId: r.fileId || undefined,
};
```

### Data URL Prohibition
```typescript
// NEVER store data URLs in database fields
// CORRECT: use uploadEntityFile() or fileUrl from generation results
const urlToStore = result.fileUrl || result.url;

// WRONG: storing base64 data URL directly
await updateAsset(id, { reference_images: [dataUrl] });  // NO!
```

### Stale Closure Prevention
```typescript
// ALWAYS fetch fresh data before updating in useCallback
const freshData = await getAssets(projectId!, episodeId);
const existing = freshData.assets.find(a => a.assetId === id)?.referenceImages || [];
await updateAsset(id, { reference_images: [...existing, newUrl] });
```

### React Query Cache Invalidation
```typescript
// Manual invalidation after mutations
queryClient.invalidateQueries({ queryKey: ['entityFiles', entityType, entityId] });

// Automatic via SSE (useSSEInvalidation hook)
// task_complete event → invalidateQueries for matching entityType/entityId
```

### Placeholder Text Pattern
```typescript
// Non-empty placeholder when creating items to avoid empty-state loops
onTextPersist(itemId, speaker, '（请输入台词）');  // NOT empty string
```

## ComfyUI Workflow Placeholders

ComfyUI 工作流模板（`workflows/*.json` 与 `deploy/workflows/*.json`）的占位符命名必须严格遵守下表 —— 后端 `cluster_main.generate_comfyui_workflow` 与 `workflow_handler.build_workflow_for_task` 的发参约定决定了哪些占位符在 `replace_placeholders` 阶段会被赋值。

| 工作流系列 | 路由发参 key | 模板里 LoadImage 节点占位符 | 走哪条 workflow_handler 通道 |
|---|---|---|---|
| `qwen_X` / `qwen_lora_X` / `qwenN_X` / `qwenN_lora_X`（X = 1..6 张参考图） | `image_path_1` … `image_path_6` | **`{image_1}` … `{image_6}`**（即使只有 1 张图也用 `{image_1}`） | 多图通道 — `params['image_X']` |
| `kontext` / `i2i_fj` / `i2i_human` / `i2i_around` / `panorama_360` / `auto_storyboard` / `matting_subject` / `matting_split` / `upscale_hd` / `remove_watermark` / `three_view` | `image_path` | `{image}` | 单图通道 — `params['image']` |
| `wan2_i2v` / `smooth_i2v` / `Dawasi_i2v` / `hunyuan_i2v` / `LTX_i2v` / `Turbo2.1_i2v` / `Turbo2.2_i2v` / `SVD_WAN_i2v`（i2v 系列） | `image_path` | `{image}`；morph 模式额外 `{image_end}` | 单图通道 |
| `image_fusion` / `image_transfer` / `pose_imitation`（融合系列） | `image_BK` / `image_HU` / `image_MB` | `{image_BK}` / `{image_HU}` / `{image_MB}` | 融合通道 |
| 视频放大 `viedo_upscaler` | `video_filename` | `{video}` | 视频通道（绝对路径自动转换） |
| 视频配音 `video_infinitetalk` | `video_filename` + `audio_filename` | `{video}` + `{Audio}` + `{prompt_AU}` | 视频+音频通道 |

**Rules**:
1. `qwen_1.json` / `qwen_lora_1.json` / `qwenN_1.json` / `qwenN_lora_1.json` 即使只有 1 张参考图，**LoadImage 节点占位符也必须用 `{image_1}`**（不能用 `{image}`）。一致命名让后续从 `_1` 扩展到 `_2~6` 时不会漏修。
2. 单图非 qwen 系列（kontext / i2i_fj / wan2_i2v / matting_* / panorama_360 / ...）保持 `{image}` 占位符。
3. `workflow_handler.build_workflow_for_task` 内置兜底：当模板用了 `{image}` 而后端只传了 `image_path_1` 时，自动 `params['image'] = params['image_1']`，但**这是 safety net**，不是正常路径——新增模板必须遵守约定。
4. 添加新工作流前先在 `cluster_main.py:generate_comfyui_workflow` 与 `workflow_handler.build_workflow_for_task` 里确认它走哪条通道，并查 FAQ 历史条目确保不会重蹈"练气一阶 1 张图占位符未替换"的覆辙。

## Anti-Patterns

| Anti-Pattern | Why Bad | Correct Approach |
|-------------|---------|-----------------|
| `dao_file.FileDAO.create()` | Missing entity fields | Use `dao_content.FileDAO.create_file()` |
| Store data URL in DB | 414 errors, bloated DB | Upload first via `uploadEntityFile()` |
| `id: uuidv4()` for GeneratedImage | ID mismatch with entity files → deletion bugs | Use `id: r.fileId \|\| uuidv4()` |
| Function-style `onUpdateStoryboardItem(id, prev => ...)` | Stale closure in pseudoFile | Use direct object update |
| Empty string for new dialogue | Dead loop: no card rendered → no input | Use placeholder text |
| `fetch('/api/thumbnail?url=' + dataUrl)` | 414 Request-URI Too Large | Return data URL directly for display |
| Read all docs at once | Token waste | Use `docs/index.md` routing |
| `qwen_1.json` 用 `{image}` 占位符 | 与同系列 X≥2 不一致；后端只发 `image_path_X`，导致占位符永不替换、ComfyUI 报 LoadImage `Invalid image file: {image}` | qwen / qwen_lora / qwenN / qwenN_lora 系列**所有** X（含 X=1）一律用 `{image_X}` |
| 视频卡片 UI 直接读 `SeedanceParams.duration` | 跳过响应式规则；后端字段是提交快照，不该作为 UI 真值源 | 视频卡时长统一从 `TaskGroup.duration` 读 / 写。响应式规则走 `useReactiveDuration({groupUuid, durationUserOverride, meta})`；`SeedanceParams.duration` 仅在提交时由 hook 同步过去 |
| 任意 Seedance prompt 输入用 `<textarea value={params.prompt}>` | 没有 `@` 候选 popover、没有 token 自动维护、占位卡引导失效 | 统一用 `<SeedanceMentionPromptEditor value={params} onChange={...} candidates={candidates}/>`（候选源由 `useSeedanceCandidates` 提供）。如果父组件直接挂 `<SeedanceMultimodalPanel>`，必须经过 `SeedancePanelWithCandidates` wrapper（`components/video/VideoCard.tsx`）注入 candidates |

## Entity Type / File Role Enum

| entity_type | Description |
|------------|-------------|
| `storyboard_item` | 分镜条目 |
| `asset` | 角色/场景/道具 |
| `video_segment` | 视频片段 |

| file_role | Description |
|----------|-------------|
| `generated_image` | AI 生成画面 |
| `reference_image` | 参考图 |
| `dialogue_audio` | 对话配音 |
| `narration_audio` | 旁白音频 |
| `sfx_audio` | 音效 |
| `music_audio` | 背景音乐 |
| `video_result` | 视频输出 |

## Video Page Anti-Patterns（2026-05-17）

### Seedance 媒体模式必须从 role 推导

**反模式**：在 `WorkspaceSession` 增加新字段 `seedance_mode` 来记录"全能参考 vs 首尾帧"。

**正确做法**：从 `media_inputs[].role` 推导：

```typescript
const isFirstLastMode = media_inputs.some(m =>
    m.kind === 'image' && (m.role === 'first_frame' || m.role === 'last_frame')
);
```

理由：避免 mode 与 role 不一致；后端只关心 role；UI 切换 mode = 批量 rewrite role。

### 列表模式不要复用卡片模式的全功能面板

**反模式**：在列表行里直接渲染 `<SeedanceMultimodalPanel>`，靠 CSS `max-h` 强压尺寸。

**正确做法**：列表模式行 = 关键字段 + ⚙ 按钮触发 Modal；Modal 内才渲染完整面板。理由：
1. 行高度强制一致（`h-16` = 64px）；
2. 左右两列严格对齐；
3. 用户在列表里只看摘要，要编辑时主动打开 Modal，避免每行都"全光光"。

## Cross-Layer Naming Adapter（2026-05-20）

### 跨层数据消费时必须容忍 snake_case / camelCase 双写

**反模式**：在前端工具函数（`buildCandidates`、`computeXxxFromItems` 等）里只读 `item.dialogue_audio_url`，假设上游永远直接来自后端 API。

**实际链路**：
```
DB columns (snake_case) → DAO dict (snake_case) → API JSON (snake_case)
   → EpisodeContext.normalizeStoryboardItem → state (camelCase)
   → useSeedanceCandidates / 各页面消费
```

`EpisodeContext` 在 normalize 阶段把 `dialogue_audio_url` 改写为 `dialogueAudioUrl`，原 key 不再保留。任何下游纯函数同时被「测试 fixture（snake_case）」和「真实 state（camelCase）」喂入，必须两面都读。

**正确做法**：在工具函数顶部写一个 1-2 行 adapter，统一读两种 key：

```typescript
function sb(item: any) {
    return {
        itemId:           item.item_id           ?? item.itemId           ?? '',
        dialogueAudioUrl: item.dialogue_audio_url ?? item.dialogueAudioUrl ?? '',
        // ...
    };
}
const sbItems = (ctx.storyboardItems || []).map(sb);
```

理由：
1. 测试用 snake_case fixture 才能直观对应 DB schema；
2. 生产环境用 camelCase 才能符合 React 风格；
3. 任何 schema 改名时，只改 normalize + adapter 两处。

### @-mention 触发字符不要只接受空白

**反模式**：`if (prev === '' || /\s/.test(prev))` —— 只在空格、tab、换行后触发。

**问题**：导入的 `video_prompt` 是中文长句，用户在末尾输 `@`，前一字符是 `巷` / `，` / `：`，不算空白，popover 静默吞掉 @。

**正确做法**：`if (prev === '' || !/[A-Za-z0-9_]/.test(prev))` —— 任何**非英数字下划线**字符都允许触发。中文 / 全角标点 / 半角标点 / 换行均可，仅在英文单词中间（如邮箱）才静默。

## Video Page Anti-Patterns（2026-05-20）

### 行布局：左右两列必须同列宽 + 同高度，逐列声明

**反模式**：左侧 `renderListViewCard` 用 `px-3 h-16` + 4 个 `w-16/w-20/w-24` 列；右侧 `renderListResultCard` 写 `p-3` 没 `h-16`、列宽 `w-20`。
**结果**：左右每行差 16-20px，第 3 行起越往后越错位。
**正确做法**：把每列宽度作为"对齐契约"集中声明（代码注释或 const 数组），左右严格用同一组 `shrink-0 w-X`。Padding/`h-16` 也要同步。

### 二次排序会吃掉用户拖拽

**反模式**：用 `useMemo(() => taskGroups.sort(...))` 按 sort_order 强制排，渲染层用 `sortedTaskGroups`；`handleDragDrop` `setTaskGroups(reorder)` 后**重新被排回去**。
**正确做法**：单一信任源——拖拽改 `taskGroups` 数组顺序，渲染层直接用 `taskGroups.map(...)`。初次导入时已按 sort_order 升序构造数组，后续 user-controlled。如果需要"恢复初始顺序"，提供"↻ 重新导入分镜"按钮，不要在 useMemo 里偷偷排序。

### @-mention token 不要试图在 textarea 里做富文本

**反模式**：把 `<textarea>` 换成 contenteditable 富文本，token 渲染为带缩略图的 inline span。
**问题**：IME（中文输入）在 contenteditable 里行为复杂；复制粘贴会带 HTML；选区/光标管理代价高；移动端键盘适配会破。
**正确做法**：textarea 保留纯文本 token（图片1/视频1/音频1），在 textarea **下方**渲染独立的 `<MentionTokensRow>` 胶囊清单组件 → 缩略图 + hover 弹大图 + 点击触发外层 `onPreviewMedia(url, kind)` + X 调 `removeMediaInput`。视觉锚点和编辑体验解耦，是改造代价最小的方案。

### 跨层数据契约不允许 NULL 留给前端 fallback

**反模式**：剧本页 export 时 `planned_duration_ms = parseDurationToMs(item.duration)` 返回 null（解析失败），DB 列就存 NULL；下游视频页用 `?? 5` 兜底，导致剧本 2s + 视频 5s 不一致。

**问题**：每个消费层都 fallback 到自己的默认值，造成「同一个分镜在三个页面看到三个时长」的链路漂移。

**正确做法**：上游 export 时**永远写入有效值**——`estimateDurationMs({ durationStr, dialogueText })` 永远返回 ≥2000ms，不返回 null。下游 fallback 仅作为最后兜底（极端情况 meta 完全空）。同时为旧数据提供**自动迁移**通道（页面 import 时检测 NULL → 前端估算 → PUT 回 DB），不要让用户手动点按钮。

### catch 块不允许静默吞错

**反模式**：`try { await apiUpdate(...) } catch { /* best-effort */ }`，写 DB 失败时 UI 还显示成功。

**问题**：用户看到生成成功，但刷新后数据丢失——典型「行为与状态不一致」bug，调试极难。

**正确做法**：所有持久化写入的 catch 必须至少 `console.error` + 把错误信息写到组件错误状态（`errors[key]`），UI 上必须给出「保存失败/请重试」反馈。如果是「best-effort」（不影响主流程），也要 console.warn 留痕。**永远不要写空 catch 块**。

### LLM 后端聚合用一层薄适配，不要在组件里 import 三个 service

**反模式**：组件里 `if (backend === 'gemini') { callGeminiProxyWithRetry } else if (backend === 'deepseek') { callDeepseekChatWithRetry } else ...`——切换/扩展时改动每个调用点。

**正确做法**：建 `services/promptRewriter.ts` 这种统一适配层，对外暴露 `rewritePrompt({ ..., backend })`；新增 backend 时只改适配层。组件只 import `rewritePrompt` 一个符号 + `BACKEND_LABELS` 一个常量。

### caret-mode 与 append-mode 应该是同一函数的可选参数，不是两个函数

**反模式**：插入到 prompt 末尾用 `insertMentionEnd()`、插入到光标位置用 `insertMentionAtCaret()`——两套独立实现，token 计数器、media_inputs 更新逻辑重复，很容易出现一边修了一边忘的 bug。

**正确做法**：`insertMention(value, candidate, opts?)` 一个函数，opts 缺省 = legacy append；`opts.atPos + opts.caretPos` 给定 = caret-mode 替换 `[atPos, caretPos)` 为 token。token 计数 / media_inputs 追加 / 文本拼接逻辑只写一次。

### 跨页音频不要重新发明，复用 EpisodeContext slice

**反模式**：在视频页里另外 `fetch('/api/character-voices')` 拿配音、再 `fetch('/api/audio-tracks')` 拿背景音；建一份 video-only 缓存。
**正确做法**：`EpisodeContext` 已经有 `characterVoices` / `audioTracks` slice（normalize 过），通过 `loadSlices('characterVoices', 'audioTracks')` 加载，下游 hook（`useSeedanceCandidates`）直接读 context 里的 slice。一份数据、一处 normalize、零重复请求。新数据源接入路径：扩 `DataSlice` → 加 `loaders[X]` → 在用到的页面 `loadSlices('X')`。

## Cross-Page Anti-Patterns（2026-05-20）

### Mask overlay：textarea 想要"富文本视觉"必走的路

**反模式**：在 `<textarea>` 内部尝试用 colored span 渲染高亮 token——textarea 是 plain-text 元素，DOM 子树会被强制忽略。或者改用 contenteditable，但 IME（中文输入法）/复制粘贴/移动端键盘行为复杂。

**正确做法**：mask overlay 模式：
1. textarea 与 overlay div 共享样式（同 padding/font/leading/letter-spacing/whitespace-pre-wrap/break-words），保证字符位置严格对齐。
2. textarea 设 `text-transparent` + 显式 `caret-slate-100` 保留光标可见。**IME composing 时**短暂改回 `text-slate-100`，否则中文候选词输入期间字符不可见。
3. overlay div 设 `absolute inset-0` + `pointer-events: none` + 较低 z-index，渲染高亮版本（token 段加颜色胶囊）。
4. **★ overlay 与 textarea 的 `text-color` 必须互斥 — 任意时刻只能一层显字**。常见错误是把 overlay 父级也写成 `text-transparent`（误把"我自己不显字"语义粘到 overlay 上），导致非 token 的 plain text 段继承透明 → 看不见（只有 token span 因 `TOKEN_KIND_CLASS` 自带 text-blue-200/purple-200/emerald-200 而可见，给人"字体色 = 背景色"的错觉）。正确写法：`overlay = composing ? 'text-transparent' : 'text-slate-100'`，与 textarea 那个三元 `composing ? 'text-slate-100' : 'text-transparent'` **方向相反**。
5. textarea 滚动时 `onScroll` 同步 overlay scrollTop/scrollLeft。
6. 末尾 `\n` 时在 overlay 末尾加 ZWSP 占位行，避免最后一行不可见。
7. **★ 任何绝对定位的辅助 UI（如 ✨ AI 改写按钮、状态徽章、清除 icon）都必须显式 `z-10` 或更高**，因为 textarea 为了压在 overlay 上设了 `zIndex:1` 且 `w-full`（`pr-8` 只影响内边距、不影响 click target box）—— 不显式 z-index 的 `absolute` 子元素会被 textarea 的 click area 整宽拦截，**视觉看得到、点不动**。

**回归记录（2026-05-21，连环踩中）**：
- 左卡用户中文 prompt 全消失（overlay 父级 `text-transparent` 让普通文字段继承透明 → 误以为是配色问题，实为 mask 模式语义错粘到 overlay 上）。
- 上述修复后又暴露：✨ AI 改写按钮（`absolute top-1.5 right-1.5`，无 z-index）被 textarea (zIndex:1, w-full) 拦截点击。修复前 overlay 透明、用户看不见字也想不到点 ✨；修复后字显出来，bug 浮现。

**实例**：`new_html/components/SeedanceMentionPromptEditor.tsx` + `new_html/utils/promptHighlight.ts.splitPromptSegments()`。

### Transient state 必须 scoped 持久化，不能用裸 useState

**反模式**：`const [tab, setTab] = useState('character')` —— 切页 / 刷新即丢，用户回来发现选过的镜头、对白草稿、视图模式都没了。

**问题**：已入库部分（DB / WorkspaceSession）通过 EpisodeContext 重拉无感，但**未入库**部分（用户编辑中的草稿、视图偏好、当前选中态、本页面 modal 状态）完全丢失。这是"我刚才编辑的呢？"类用户投诉的根因。

**正确做法**：用 `hooks/usePersistedPageState.ts` 替代 useState，按 `episodeId` scope 存 sessionStorage。Key 形如 `h-my2:page-state:v1:<page>:<episodeId|global>`：
- 不同剧集天然隔离（不会串数据）。
- `version` bump 时旧 key 自然失效（schema 不兼容时安全升级）。
- sessionStorage 的语义匹配"transient"——关 tab 即清，比 localStorage 更适合。
- 跨剧集偏好（如 sidebar 宽度）显式 `episodeId: 'global'`。

**值得持久化**：用户偏好（视图模式、模型选择、tab、宽度）、用户操作中的草稿（对白覆盖、提示词）、当前选中态（selectedShotId）。

**不要持久化**：modal 开关 / loading flag / 进度 / 一次性错误 / playingKey / 多选集合（运行时态，刷新清空合理）。

**实例**：`AudioStagePage.localOverrides`、`GenerationPage.{selectedShotId, globalModel, shotModels, sidebarWidth}`、`VideoPage.{viewMode, globalModel}`、`DesignPage.tab`。

### 上游硬过滤 = 强制下游也要硬过滤

**反模式**：分镜导出页 `filter(item => item.generatedImages?.length > 0)` 把无图项直接砍掉，然后弹 alert "至少生成一张图"——但下游视频页其实早就支持空分镜（占位卡 + isPlaceholder 标记）。

**问题**：上游单方面收紧后，下游能力被掩盖；用户体验断层（"我都还没画图，怎么把对白时长带过去？"）。

**正确做法**：上游导出端不要做"完整性检查"，只做"是否有数据"检查（items.length === 0 才提示）。允许下游收到不完整数据后用占位项继续编辑——这才符合多阶段创作流的本质。alert 文案应反映"什么时候真的不能继续"（数据为空），而不是"什么时候不够漂亮"（缺图）。

### 异步任务的 polling 不能绑组件 lifecycle

**反模式**：把 `setInterval` 句柄存在组件内 `useRef`，在 `useEffect` 的 cleanup 里 `clearInterval`。后果：用户切页 → 组件 unmount → polling 停 → 后端任务还在跑但前端"看不见"。回到该页才能重新拉，用户体验是"我离开一次就要等半天才出结果"。

**问题**：`useRef` 是 component-scoped；轮询的本质是"任务级"，不是"页面级"。两者生命周期不一样，强行绑定就会出现切页死亡。

**正确做法**：把 polling 的 `setInterval` map 提到**模块级**（`const intervals = new Map<id, IntervalHandle>` 在 `services/*.ts` 里），组件只 `attach / detach 回调`：
- 模块只 import 一次，刷新整页才重建 → 跨页跳转完全保留。
- 组件 mount 时通过 `attach(id, callbacks)` 把 `setState` 接到正在运行的 polling 上。
- 组件 unmount 时只 `detach(id)`（callbacks 清空），polling 继续。
- 进度通过 callbacks + `taskRegistry.update` 双路同步：前者写本地组件 state，后者写全局任务系统（铃铛/徽章看到）。

**实例**：`new_html/services/videoTaskPoller.ts`（视频任务 polling 提到 service）；`new_html/services/geminiService.ts.waitForComfyUITask*`（ComfyUI 等待函数本来就在 service 层，但通过 `registryMeta` 接入 taskRegistry 让任务可见）。

### 全局任务必须有单一 registry，不要双系统平行

**反模式**：`WorkspaceApp.taskNotifications`（页面内 state）+ `TaskContext.notifications`（SSE）+ 各组件自己的 `tasksStatus` —— 三套数据各跑各的，UI 拿哪个都不一致；旧 Header 重复 80 行下拉面板，新 Layout 又写一遍。

**问题**：单一信任源缺失 → 任意一个数据源更新另两个都可能漏 → 完成通知概率丢失 / 失败状态不显示 / 切页后任务"消失"。

**正确做法**：用 `services/taskRegistry.ts` 作为**唯一**的 source of truth。所有写入路径（页面 register / SSE 推送 / 轮询 update）都收敛到 registry；所有读取路径（铃铛 / per-page Badge / Toast / 跳转）都从 registry 派生。`TaskContext` 是 React 适配层，订阅 registry 变化驱动 re-render。**绝不**让 UI 直接维护任务列表 state。

**registry 字段约定**：
- `taskId` 是后端任务 id（唯一键，每次提交都是新条目）。
- `targetEntityId` 是业务实体 id（如 `group.uuid` / `storyboardItem.id` / `asset.id`），用于回页面后定位卡片。
- 不要把"业务 uuid"当 `taskId` —— 重复提交同一 group 时会撞键。
- `progress` **统一 0-1 区间**（即使后端返回 0-100，前端 service 入库前必须 normalize）；UI 展示 `*100` 即可。

**实例**：`new_html/services/taskRegistry.ts` + `new_html/contexts/TaskContext.tsx` + `new_html/components/NotificationPanel.tsx` + `new_html/components/TaskBadge.tsx`。

### useEffect 的 deps 数组绝不能引用尚未声明的 useCallback / useMemo / const（TDZ）

**反模式**：在文件靠前位置写一个 useEffect，deps 数组里引用一个**用 useCallback 在文件靠后位置才声明**的变量：
```tsx
// line 293
useEffect(() => {
    attachVideoPollCallbacks(uuid, buildPollCallbacks(uuid));
}, [buildPollCallbacks]);  // ★ TDZ：buildPollCallbacks 在 line 1225 才声明

// ...一千行业务代码...

// line 1225
const buildPollCallbacks = useCallback((uuid) => ({...}), [onAddNotification]);
```

**问题**：JS `const` 声明有 **Temporal Dead Zone**：声明前读它直接 `ReferenceError`。React 函数组件每次 render 函数体都顺序执行，跑到 `useEffect(...)` 调用时，**deps 数组立即被求值**（数组字面量是表达式，求值就是顺序读各成员），而 `const buildPollCallbacks` 还没声明 → 报错。

**症状典型为**：minified bundle 中抛 `Cannot access 'Ms' before initialization`（`Ms` 是被 mangled 的 useCallback 变量名），栈深处是 `React.renderWithHooks` / scheduler。看似离奇的"加载就崩"。

**正确做法（任选其一）**：
1. **把 useEffect 下移到 useCallback 之后**（最小侵入，本项目首选）：
   ```tsx
   const buildPollCallbacks = useCallback(...);
   useEffect(() => { ... }, [buildPollCallbacks]);  // 现在合法
   ```
2. **把 useCallback 提前到 useEffect 之前**（但要小心 useCallback 自身 deps 也得跟着前移，可能牵动一长串 hooks 顺序，副作用大）。

**禁止做法**：用 `function` 声明替代 `useCallback`（function 虽然 hoisted，但失去 React 引用稳定性，每次 render 都是新引用，让 useEffect deps 变化失控）。

**Lint 提示**：`react-hooks/exhaustive-deps` 不会捕获顺序问题（它只检查 deps 是否覆盖了 effect 内引用），所以这种 bug 必须在 code review 时盯顺序。

**实例**：2026-05-21 VideoPage.tsx 该 bug 让视频页一访问就崩；单文件长达 3000+ 行的组件中尤其容易踩。
