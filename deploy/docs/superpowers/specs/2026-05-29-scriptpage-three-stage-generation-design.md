# ScriptPage 三步生成链路设计

> Spec date: 2026-05-29  
> Status: Draft  
> Owner: ScriptPage / WorkspaceApp / Episode script and storyboard persistence  
> Route: `/projects/:projectId/ep/:episodeId/workflow/script`

## 1. 背景

当前 ScriptPage 的核心链路是：

1. 用户在三栏编辑器中粘贴文案，暂存在 `ProjectFile.originalContent`。
2. 用户点“AI 改写”，`WorkspaceApp.handleRewrite()` 调用 AI，一步生成可解析的分镜脚本文本。
3. 用户点“提取分镜”，`WorkspaceApp.handleExtractShots()` 从剧本文本中提取 `StoryboardItem[]`。
4. 保存时写入：
   - `episode_scripts.original_content`
   - `episode_scripts.adapted_script`
   - `storyboard_items.scene_heading/action_text/image_prompt/video_prompt/...`

新需求是把“一步改写”改为三步：

1. 使用 `剧本拆分标准.docx`，把剧本按情绪单元拆成 4 到 15 秒的原文段落。
2. 使用 `剧本转视频脚本（5.26）.docx`，对每个分段逐批生成多个视频镜头脚本，并按顺序追加成完整视频脚本。
3. 使用 `视频脚本提取分镜.docx`，针对每个视频镜头生成分镜图片提示词。

生成结果的消费要求：

- 视频脚本内容进入后续视频生成页面。
- 分镜提示词内容进入后续分镜生成页面。
- 中间产物需要落库，避免刷新页面或切页后丢失进度。

## 2. 设计目标

- 保持现有 ScriptPage 三栏编辑器主体不推翻，只增加三阶段工作流区域。
- 让用户能清楚看到当前处于“已分段、正在生成视频脚本、正在提取分镜提示词、完成、失败”的哪一步。
- 支持每个阶段单独重跑，失败时能从失败阶段恢复。
- 继续复用 `storyboard_items.video_prompt` 给视频页，复用 `storyboard_items.image_prompt` 给分镜页。
- 保持 `script_id` 隔离，分集下多个剧本文件互不污染。
- 尽量不破坏现有保存链路，继续兼容历史无 `script_id` 的孤儿分镜逻辑。

## 3. 关键决策

| 维度 | 决策 |
|---|---|
| 前端交互 | 不只加两个按钮。新增一个“三步生成”工作流区域，提供一个主按钮和三个阶段按钮。 |
| 主按钮 | `按三步生成`，顺序执行分段、生成视频脚本、提取分镜提示词。 |
| 阶段按钮 | `拆分剧本`、`生成视频脚本`、`提取分镜提示词`，用于单独重跑。 |
| 视频页数据来源 | `storyboard_items.video_prompt` 继续作为视频生成页优先读取字段。 |
| 分镜页数据来源 | `storyboard_items.image_prompt` 继续作为分镜生成页使用字段。 |
| 完整视频脚本 | 写入 `episode_scripts.adapted_script`，对应前端 `file.scriptContent`。 |
| 分段中间产物 | 新增 `episode_script_segments` 表保存，避免只存在前端 state。 |
| 分镜持久化方式 | 保持现有“先删后批量插”策略，但 batch item 增加新字段。 |
| AI prompt 管理 | 把三个 docx 内容内置为三个 prompt template，v1 不做后台可配置。 |

## 4. 前端页面设计

### 4.1 页面结构

ScriptPage 仍复用 `new_html/WorkspaceApp.tsx` 的三栏编辑器：

- 左栏: 剧本文件列表和原文文案输入。
- 中栏: 视频脚本内容，也就是 `file.scriptContent`。
- 右栏: 分镜项列表，也就是 `file.storyboard.items`。

在现有 AI 操作区增加一个轻量工作流面板：

```text
三步生成

[按三步生成]

1. 剧本分段         状态: 未开始/完成/失败
   [拆分剧本]       分段数: 12   平均时长: 11 秒

2. 生成视频脚本     状态: 未开始/进行中 5/12/完成/失败
   [生成视频脚本]   已生成镜头: 38

3. 提取分镜提示词   状态: 未开始/进行中 21/38/完成/失败
   [提取分镜提示词] 已生成分镜提示词: 38
```

### 4.2 为什么不是只加两个按钮

只加 `生成视频脚本` 和 `提取分镜提示词` 两个按钮可以跑通最小流程，但会留下三个问题：

- 用户看不到剧本是否已经拆分成功，也看不到分段时长是否合理。
- 第二步按分段逐批生成，任何一段失败都需要明确显示失败段落，否则用户不知道该从哪里重试。
- 第三步生成的是分镜图片提示词，和第二步视频脚本是不同产物，必须让用户知道后续视频页和分镜页分别会消费哪个字段。

因此 v1 推荐三阶段面板，而不是只增加两个离散按钮。

### 4.3 操作规则

- `按三步生成`
  - 若没有分段，先执行 Stage 1。
  - 若已有分段但没有视频脚本，从 Stage 2 开始。
  - 若已有视频脚本但没有分镜提示词，从 Stage 3 开始。
  - 若全部已有，弹确认后全量重跑。
- `拆分剧本`
  - 输入为 `file.originalContent`。
  - 成功后保存到 `episode_script_segments`。
  - 重跑会覆盖当前 `script_id` 下的旧 segments。
- `生成视频脚本`
  - 输入为当前 `script_id` 下的 segments。
  - 按 `segment_order` 顺序逐段调用 AI。
  - 每段完成后追加到 `file.scriptContent`，并保存该 segment 的 `video_script`。
  - 全部完成后保存 `episode_scripts.adapted_script`。
- `提取分镜提示词`
  - 输入为 Stage 2 输出的视频镜头块。
  - 每个镜头块生成一个 `StoryboardItem`。
  - 成功后写入 `file.storyboard.items`，自动保存到 `storyboard_items`。

### 4.4 前端状态

在 `ProjectFile` 增加可选运行态字段：

```ts
interface ScriptGenerationStageState {
  status: 'idle' | 'running' | 'done' | 'error';
  total?: number;
  completed?: number;
  errorMessage?: string;
  updatedAt?: number;
}

interface ScriptSegment {
  id: string;
  order: number;
  sourceText: string;
  estimatedDurationSec: number | null;
  videoScript?: string;
  status?: 'pending' | 'running' | 'done' | 'error';
  errorMessage?: string;
}

interface ProjectFile {
  scriptSegments?: ScriptSegment[];
  generationStages?: {
    split?: ScriptGenerationStageState;
    videoScript?: ScriptGenerationStageState;
    storyboardPrompt?: ScriptGenerationStageState;
  };
}
```

这些字段主要服务页面交互；持久化以 API 返回的 segment 和 storyboard rows 为准。

## 5. 数据模型

### 5.1 新增表 `episode_script_segments`

```sql
CREATE TABLE IF NOT EXISTS episode_script_segments (
    id SERIAL PRIMARY KEY,
    segment_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    script_id VARCHAR(50) REFERENCES episode_scripts(script_id) ON DELETE CASCADE,
    segment_order INTEGER NOT NULL DEFAULT 0,
    source_text TEXT NOT NULL DEFAULT '',
    estimated_duration_sec INTEGER,
    video_script TEXT DEFAULT '',
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_script_segments_episode
    ON episode_script_segments(episode_id);

CREATE INDEX IF NOT EXISTS idx_episode_script_segments_script_order
    ON episode_script_segments(script_id, segment_order);
```

字段含义：

- `source_text`: Stage 1 输出的原文段落，必须是原文摘抄。
- `estimated_duration_sec`: Stage 1 输出的 `时长：N秒`。
- `video_script`: Stage 2 针对该段生成的视频镜头脚本。
- `status/error_message`: 用于失败恢复和页面展示。
- `metadata`: 存储 prompt version、模型、生成耗时、原始 AI 返回等可选信息。

### 5.2 扩展 `storyboard_items`

```sql
ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS script_segment_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_video_shot_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS video_script_block TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS shot_size VARCHAR(50) DEFAULT '',
    ADD COLUMN IF NOT EXISTS camera_angle VARCHAR(100) DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_storyboard_items_script_segment
    ON storyboard_items(script_segment_id);
```

字段含义：

- `script_segment_id`: 该分镜来自哪个剧本分段。
- `source_video_shot_no`: Stage 2 中的镜头号。
- `video_script_block`: Stage 2 的单镜头完整视频脚本块。
- `shot_size`: Stage 3 提取的景别。
- `camera_angle`: Stage 3 提取的拍摄角度。

### 5.3 现有字段继续使用

| 前端字段 | DB 字段 | 新流程含义 |
|---|---|---|
| `file.originalContent` | `episode_scripts.original_content` | 用户粘贴的原始剧本/文案 |
| `file.scriptContent` | `episode_scripts.adapted_script` | Stage 2 拼接后的完整视频脚本 |
| `item.originalText` | `storyboard_items.scene_heading` | Stage 1 原文段落或 Stage 2 镜头来源摘要 |
| `item.scriptSegment` | `storyboard_items.action_text` | Stage 3 的画面描述 |
| `item.imagePrompt` | `storyboard_items.image_prompt` | Stage 3 的分镜生成提示词 |
| `item.videoPrompt` | `storyboard_items.video_prompt` | Stage 2 单镜头视频脚本或规范化视频提示词 |
| `item.dialogue` | `storyboard_items.dialogue` | Stage 3 提取台词 |
| `item.cameraMovement` | `storyboard_items.camera_movement` | `景别 + 拍摄角度 + 运镜方式` |
| `item.plannedDurationMs` | `storyboard_items.planned_duration_ms` | 镜头时长，秒转毫秒 |

## 6. API 设计

### 6.1 Segments API

新增 `dao_episode_script_segment.py` 和以下接口：

```text
GET    /api/episodes/{episode_id}/script-segments?script_id=...
PUT    /api/episodes/{episode_id}/script-segments/batch
DELETE /api/episodes/{episode_id}/script-segments?script_id=...
```

批量保存请求：

```json
{
  "script_id": "script_xxx",
  "segments": [
    {
      "segment_id": "seg_xxx",
      "segment_order": 0,
      "source_text": "原文段落",
      "estimated_duration_sec": 12,
      "video_script": "镜头1...",
      "status": "done",
      "error_message": "",
      "metadata": {
        "prompt_version": "script_split_docx_2026_05_29"
      }
    }
  ]
}
```

行为：

- `PUT batch` 对同一 `episode_id + script_id` 采用替换式保存，和现有 storyboard 保存策略保持一致。
- 返回后端生成或保留的 `segment_id`，前端回写到 `file.scriptSegments`。

### 6.2 Storyboard batch API

现有：

```text
POST /api/episodes/{episode_id}/storyboard-items/batch
```

扩展 `items[]` 支持：

```json
{
  "script_segment_id": "seg_xxx",
  "source_video_shot_no": "镜头1",
  "video_script_block": "镜头1完整块",
  "shot_size": "远景",
  "camera_angle": "俯视视角"
}
```

`StoryboardDAO.create()`、`batch_create()`、`batch_create_transactional()`、`update()` 都需要允许这些字段。

## 7. AI 服务设计

### 7.1 新增 Prompt Templates

在 `new_html/prompts/scriptPrompts.ts` 或单独 `new_html/prompts/scriptPipelinePrompts.ts` 中新增：

```ts
export const SPLIT_SCRIPT_INTO_SEGMENTS: PromptTemplate;
export const GENERATE_VIDEO_SCRIPT_FROM_SEGMENT: PromptTemplate;
export const EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT: PromptTemplate;
```

内容来源：

- `SPLIT_SCRIPT_INTO_SEGMENTS`: `剧本拆分标准.docx`
- `GENERATE_VIDEO_SCRIPT_FROM_SEGMENT`: `剧本转视频脚本（5.26）.docx`
- `EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT`: `视频脚本提取分镜.docx`

### 7.2 新增业务函数

在 `new_html/services/aiModelService.ts` 增加：

```ts
export async function aiSplitScriptIntoSegments(
  model: AiModel,
  originalContent: string,
  onStream?: (chunk: string) => void,
): Promise<ScriptSegment[]>;

export async function aiGenerateVideoScriptFromSegment(
  model: AiModel,
  segment: ScriptSegment,
  onStream?: (chunk: string) => void,
): Promise<string>;

export async function aiExtractStoryboardPromptFromVideoShot(
  model: AiModel,
  videoShotBlock: string,
): Promise<ExtractedStoryboardPrompt>;
```

### 7.3 Parser 设计

新增纯函数模块 `new_html/utils/scriptPipelineParsers.ts`：

```ts
parseScriptSegments(text: string): ScriptSegment[]
parseVideoScriptBlocks(text: string): VideoScriptBlock[]
parseStoryboardPromptExtraction(text: string): ExtractedStoryboardPrompt
```

解析要求：

- `parseScriptSegments`
  - 支持 `---` 分隔。
  - 识别 `时长：N秒`。
  - 去掉 `时长` 行后保留原文段落。
  - 如果无法解析时长，`estimatedDurationSec = null`，UI 显示待确认。
- `parseVideoScriptBlocks`
  - 支持 `镜头1`、`镜头1：`、`镜头 1`。
  - 保留每个镜头完整块。
  - 提取 `时长（秒）：N`。
- `parseStoryboardPromptExtraction`
  - 提取 `镜头号`、`景别`、`画面描述`、`分镜生成提示词`、`拍摄角度`、`运镜方式`、`台词`、`时长`。
  - `台词：无` 写成空字符串。

## 8. WorkspaceApp 流程改造

### 8.1 加载

`loadEpisodeData()` 现有并发加载：

- `listEpisodeScripts(episodeId)`
- `getStoryboardItems(episodeId)`

新增：

- `listEpisodeScriptSegments(episodeId)`

加载后按 `script_id` 分组：

- scripts 转为 `ProjectFile[]`。
- storyboard rows 继续归到对应 file。
- segments 归到 `file.scriptSegments`。
- 历史无 `script_id` 的 orphan storyboard rows 保持挂到第一个 file。

### 8.2 保存

`saveEpisodeToBackend()` 扩展为：

1. 保存每个 file 到 `episode_scripts`。
2. 保存每个 file 的 `scriptSegments` 到 `episode_script_segments`。
3. 保存每个 file 的 `storyboard.items` 到 `storyboard_items`。

`storyboard_items` 仍保持：

```text
deleteAllStoryboardItems(epId, fileId)
batchCreateStoryboardItems(epId, dbItems, fileId)
```

新增字段映射：

```ts
{
  script_segment_id: item.scriptSegmentId || null,
  source_video_shot_no: item.sourceVideoShotNo || '',
  video_script_block: item.videoScriptBlock || '',
  shot_size: item.shotSize || '',
  camera_angle: item.cameraAngle || '',
}
```

### 8.3 三阶段 handler

建议新增：

```ts
handleSplitScript(targetFileId?: string)
handleGenerateVideoScript(targetFileId?: string)
handleExtractStoryboardPrompts(targetFileId?: string)
handleRunThreeStagePipeline(targetFileId?: string)
```

现有 `handleRewrite()` 可以改为调用 `handleRunThreeStagePipeline()`，保留旧按钮文案兼容；或者将按钮文案改为 `按三步生成`。

### 8.4 错误处理

- Stage 1 失败：不清空旧分镜，不覆盖旧 `scriptContent`。
- Stage 2 某段失败：
  - 保留已完成 segment 的 `video_script`。
  - 标记失败 segment。
  - 主按钮下次点击从失败 segment 继续。
- Stage 3 某镜头失败：
  - 保留已提取的 storyboard items。
  - 标记失败镜头。
  - 用户可重试 Stage 3。

## 9. 后续页面消费

### 9.1 VideoGenPage

现有 VideoGenPage 已经优先读取：

```ts
item.video_prompt ?? item.videoPrompt ?? item.image_prompt ?? item.imagePrompt
```

新流程只要确保 `storyboard_items.video_prompt` 写入 Stage 2 单镜头视频脚本，视频页就能继续消费。

补充建议：

- 导入卡片的 `storyboard_meta.sceneHeading` 继续使用 `scene_heading`。
- `planned_duration_ms` 优先用 Stage 2/3 提取时长。
- UI 上可以显示“来自视频脚本”的小标签，但不是 v1 必需。

### 9.2 StoryboardGenPage

StoryboardGenPage 通过 `scriptToProjectFile()` 把 DB item 转成 `StoryboardItem`，`imagePrompt` 来自 `image_prompt`。

新流程只要确保 `storyboard_items.image_prompt` 写入 Stage 3 的“分镜生成提示词”，分镜生成页即可使用。

补充建议：

- `scriptSegment` 使用 Stage 3 的 `画面描述`，便于分镜页卡片阅读。
- `cameraMovement` 保存 `景别 + 拍摄角度 + 运镜方式`，便于后续人工调整。

## 10. 兼容和迁移

- 旧数据没有 `episode_script_segments`，加载时 `file.scriptSegments = []`。
- 旧 `storyboard_items` 没有新增字段，前端按空字符串处理。
- 旧流程生成的 `image_prompt/video_prompt` 继续可被后续页面读取。
- `episode_scripts.adapted_script` 仍然是后续页面可读的剧本文本，只是语义从“分镜脚本”变为“完整视频脚本”。
- 若需要保留旧的一步生成能力，可以在 AI 面板放入更多菜单项 `旧版一步生成`，默认不展示。

## 11. 实施步骤

1. 新增数据库 migration：
   - `db_migration_episode_script_segments.sql`
   - `db_migration_storyboard_pipeline_fields.sql`
   - 同步 deploy/sql。
2. 新增 DAO 和 API：
   - `dao_episode_script_segment.py`
   - `api_routes.py` 增加 segments API。
   - `dao_storyboard.py` 支持新增字段。
3. 前端类型和 API：
   - `new_html/types.ts` 增加 `ScriptSegment` 和 storyboard 新字段。
   - `new_html/services/apiService.ts` 增加 segments API。
4. AI prompt 和 parser：
   - 新增 3 个 prompt template。
   - 新增 3 个 aiModelService 函数。
   - 新增 parser 纯函数和单测。
5. WorkspaceApp：
   - `loadEpisodeData()` 加载 segments。
   - `saveEpisodeToBackend()` 保存 segments 和新增 storyboard 字段。
   - 增加三阶段 handler。
   - AI 操作区增加三步生成面板。
6. 后续页面校验：
   - VideoGenPage 验证 `video_prompt` 导入。
   - StoryboardGenPage 验证 `image_prompt` 生成分镜。
7. 文档更新：
   - `docs/database.md`
   - `docs/frontend.md`
   - `docs/diagrams/page-ScriptPage.md`
   - 必要时更新 `docs/api.md`

## 12. 测试计划

### 12.1 单元测试

- `parseScriptSegments`
  - 正常解析 `---` 分隔。
  - 正常解析 `时长：12秒`。
  - 缺失时长时不崩溃。
  - 拼接所有 `sourceText` 后能覆盖输入主体内容。
- `parseVideoScriptBlocks`
  - 支持多个 `镜头N`。
  - 保留完整视频脚本块。
  - 正确解析 `时长（秒）：N`。
- `parseStoryboardPromptExtraction`
  - 正确解析 `分镜生成提示词`。
  - `台词：无` 转为空字符串。
  - 景别、角度、运镜保存到对应字段。

### 12.2 DAO/API 测试

- `EpisodeScriptSegmentDAO.batch_replace()` 保存后可按 `script_id` 读回。
- 删除 script 时 segments 级联删除。
- `StoryboardDAO.batch_create()` 能保存新增字段。
- `GET storyboard-items` 返回新增字段。

### 12.3 前端流程测试

- mock 三个 AI 调用，点击 `按三步生成` 后：
  - `file.scriptSegments` 有数据。
  - `file.scriptContent` 为 Stage 2 拼接文本。
  - `file.storyboard.items[].videoPrompt` 有视频脚本。
  - `file.storyboard.items[].imagePrompt` 有分镜提示词。
- Stage 2 中途失败时，已完成段落保留，失败状态可见。
- Stage 3 中途失败时，已完成分镜保留，失败状态可见。

### 12.4 回归测试

- 多剧本文件下只保存当前 `script_id` 的 segments/storyboard。
- 历史无 `script_id` 的 orphan storyboard rows 仍挂到第一个文件。
- 切页后自动保存不会清空已生成分镜。
- VideoGenPage 导入时优先使用 `video_prompt`。
- StoryboardGenPage 使用 `image_prompt` 生成图片。

## 13. GitNexus 和风险

已做只读 impact 查询：

- `WorkspaceApp`: LOW。
- `handleRewrite`: LOW。
- `saveEpisodeToBackend`: LOW，直接上游为 `saveToBackend`，间接影响自动保存、切页保存、beforeunload 保存。
- `StoryboardDAO`: LOW，直接上游包括 `api_routes.py`、`audio_mix_service.py`、`tests/test_dao_storyboard.py`。
- `EpisodeScriptDAO`: LOW，直接上游包括 `api_routes.py`、`tests/test_dao_episode_script.py`。

实施前置要求：

- 当前 GitNexus 状态显示 indexed commit 与 current commit 一致。
- 查询时提示 FTS indexes missing，实施前建议运行：

```bash
npx gitnexus analyze --force
```

提交前要求：

- 按 AGENTS.md，运行 `npx gitnexus detect-changes --repo MY2` 或等价 `gitnexus_detect_changes()`，确认影响范围只包含本 spec 预期模块。

## 14. 验收标准

- ScriptPage 可以一键完成三步生成。
- 用户可以单独重跑任一阶段。
- 页面能显示分段数量、视频镜头数量、分镜提示词数量和失败信息。
- 刷新页面后已生成 segments、视频脚本、分镜提示词仍存在。
- 视频页导入后卡片 prompt 使用 Stage 2 的视频脚本。
- 分镜页生成图片时使用 Stage 3 的分镜生成提示词。
- 旧数据继续可加载，不要求迁移旧内容生成 segments。
