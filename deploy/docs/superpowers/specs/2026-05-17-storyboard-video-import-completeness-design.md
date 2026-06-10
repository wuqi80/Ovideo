# 分镜到视频页：完整数据导入设计

> **Spec date**: 2026-05-17
> **Status**: Approved v2 — 合并 Seedance Asset Mentions（原 plan `2026-05-16-seedance-asset-mentions.md` 未实施，本 spec 一次性吃掉）
> **Owner**: VideoGenPage / VideoPage / SeedanceMentionPromptEditor / 后端 audio_mix_service
> **Related FAQ**:
> - 视频页空白（data: URL 残留）— 2026-05-17
> - 拖拽上传图片视频页空 — 2026-05-17
> - SeedanceMultimodalPanel 的 prompt 不支持 @ — 2026-05-17（本 spec 修复）

## 1. Problem Statement

视频页 `handleImportAll` 当前只导入**有 generated_image 的分镜**，且只携带画面 URL。
用户实际工作流期望：

1. **空分镜**（还没生成画面）也要能导入，导入后用飞升/渡劫，从素材库/媒体库 @ 选首帧。
2. 分镜的**音频**（dialogue / narration / sfx 三道）随分镜一起带过来，作为视频生成的 reference_audio。
3. 每个分镜的**秒数**带过来，决定视频卡片的 duration（不再硬写 5 秒）。
4. **已有画面的分镜**（现状）继续支持，且也要享受秒数 / 音频的红利。
5. **SeedanceMultimodalPanel 当前的 prompt 是普通 textarea**，`@` 没反应（旧 plan `2026-05-16-seedance-asset-mentions.md` 设计但未实施）。本 spec 把 mention picker 一次性补齐，让"空分镜导入 + @ 选首帧"是真闭环。

设计目标：让"导入分镜"是一次完整的内容迁移，而不是"只搬画面"；并让 Seedance prompt 真的支持 `@` 引用资产。

## 2. Key Decisions（来自 brainstorming）

| 决策 | 选定方案 |
|---|---|
| **导入后默认模型** | 全部 Seedance2（飞升）。空分镜和已有画面都默认飞升，因为本 spec 同步实现的 `@` mention picker（Section 6）正是"从素材库选图"的最佳路径。 |
| **duration 优先级** | 响应式规则：有 reference_audio → audio.durationMs；无 → planned_duration_ms；都无 → 5。用户在 `CardDurationField` 输入框直接改值即触发 `durationUserOverride = true`，从此 audio 变化不再覆盖；点 ↺ 按钮把 override 清回 false 才恢复跟随。 |
| **音频映射** | 后端混音：dialogue + narration + sfx → 一道 reference_audio。dialogue 主轨道（0dB），narration -3dB，sfx -8dB。命中 hash 缓存复用。 |
| **重复导入** | 手动「同步分镜」按钮 + 三选一模态：仅添加新的 / 覆盖未修改的 / 全量重置。 |
| **duration 通用化** | duration 字段从 `SeedanceParams` 提到 `TaskGroup` 顶层，**所有视频模型卡片**都展示该字段（不只 Seedance）。 |
| **Mention 候选源** | 7 类（current card / storyboard data / 素材库 / 音频 / 已生成视频片段 / 媒体库 entity_files / Ark `asset://` 手输）。覆盖 import 流程产生的全部资产 + 远程 ID 兜底。 |
| **Mention 交互** | M3：行内 `@` popover（Slack/Notion 风格，分组 + 搜索）+ 卡片右上「+ 插入素材」按钮（同一数据源、Modal 多选）。二者都要。 |
| **Mention token 维护** | T1 全自动：插入媒体 → 自动追加 `图片N / 视频N / 音频N` 到 prompt 末尾；删除 image_input / video / audio → 自动剔除对应 token 并 R1 重编号（`图片3` → `图片2`）。用户零负担。 |
| **Placeholder 默认行为** | P2：placeholder 卡片默认 prompt 塞 `@` 字符 + 光标后置，卡片获焦时自动弹 popover。最强引导。 |
| **实施粒度** | 一次性全量上线（一个 PR），内部分 9 个步骤便于 review。 |

## 3. Architecture / Data Model

### 3.0 Seedance Mention 类型（`new_html/utils/seedanceMedia.ts`）

⚠️ 已存在事实：`SeedanceMediaInput` / `SeedanceMediaKind` / `SeedanceMediaRole` 已在 `services/videoService.ts:57-65` 定义；`SeedanceParams.duration` 已存在于第 73 行。本 spec **不重新定义**，只 re-export 并新增 mention 专属类型。

```typescript
// new_html/utils/seedanceMedia.ts
import type {
    SeedanceMediaInput,
    SeedanceMediaKind,
    SeedanceMediaRole,
    SeedanceParams,
} from '../services/videoService';

export type { SeedanceMediaInput, SeedanceMediaKind, SeedanceMediaRole };

// 仅在 mention 插入时使用、不持久化到 task.data
export interface SeedanceMentionMeta {
    arkAssetId?: string;
    label?: string;
    sourceId?: string;
}

export type SeedanceCandidateGroup =
    | 'current_card' | 'storyboard_data' | 'assets'
    | 'audio' | 'video_segments' | 'user_files' | 'ark_asset_id';

export interface SeedanceAssetCandidate {
    id: string;
    group: SeedanceCandidateGroup;
    kind: SeedanceMediaKind | 'text';
    label: string;
    url?: string;
    text?: string;
    arkAssetId?: string;
    storyboardItemId?: string;
    durationMs?: number;
    thumbnailUrl?: string;
}

export const TOKEN_PREFIX: Record<SeedanceMediaKind, string> = {
    image: '图片', video: '视频', audio: '音频',
};
```

`SeedanceMediaInput` 的现有形状 `{ kind, url, role?, file_id? }` 不变（它会被序列化提交给后端 worker.py）；mention 时携带的 ark / label / sourceId 信息只存在于 candidate 和瞬时插入逻辑里，不写入持久化的 media_inputs。

### 3.1 类型扩展（`new_html/services/videoService.ts`）

```typescript
export interface TaskGroup {
    uuid: string;
    ids: string[];
    model: VideoModel;
    shotType?: ShotType;
    duration?: number;                    // ⭐ 通用时长（秒，3–15），所有模型可读
    durationUserOverride?: boolean;       // ⭐ true 后响应式规则不再自动改
}

export interface UploadedImage {
    id: string;
    url: string;                          // 空分镜时为空字符串
    filename: string;
    storageUrl?: string;
    comfyuiFilename?: string;
    uploadTime: number;
    isUploading?: boolean;
    uploadFailed?: boolean;
    uploadProgress?: number;
    isPlaceholder?: boolean;              // ⭐ true = 空分镜
    storyboardItemId?: string;            // ⭐ 反查 storyboard_meta
    sortOrder?: number;                   // ⭐ 显示顺序
}

export interface StoryboardMeta {
    plannedDurationMs?: number;
    audioDurationMs?: number;
    audioUrls?: {
        dialogue?: string;
        narration?: string;
        sfx?: string;
    };
    mixedAudioUrl?: string;
    mixedAudioHash?: string;
    sceneHeading?: string;
    dialogue?: string;
    lastSyncedAt?: number;                // 用于「同步分镜」对比
}

export interface WorkspaceSession {
    task_groups: TaskGroup[];
    uploaded_images: UploadedImage[];
    image_prompts: Record<string, string>;
    tasks_status: Record<string, TaskStatus>;
    seedance_params?: Record<string /* groupUuid */, SeedanceParams>;  // ⭐ 持久化
    storyboard_meta?: Record<string /* itemId */, StoryboardMeta>;     // ⭐ 新增
}
```

### 3.2 数据库 migration

```sql
-- db_migration_storyboard_audio_mix.sql
ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS mixed_audio_url TEXT,
    ADD COLUMN IF NOT EXISTS mixed_audio_hash VARCHAR(64);
```

镜像由 `sync_to_deploy.py` 自动同步到 `deploy/sql/`。

### 3.3 后端 API

```python
# api_routes.py
@router.post("/api/storyboard/mix-audio")
async def mix_storyboard_audio(
    request: MixAudioRequest,
    user_id: str = Depends(get_current_user),
) -> MixAudioResponse: ...

class MixAudioRequest(BaseModel):
    item_id: str
    dialogue_url:     Optional[str] = None
    narration_url:    Optional[str] = None
    sfx_url:          Optional[str] = None
    dialogue_gain_db:  float = 0.0
    narration_gain_db: float = -3.0
    sfx_gain_db:       float = -8.0

class MixAudioResponse(BaseModel):
    success: bool
    mixed_audio_url: str
    cached: bool
    duration_ms: int
```

实现走 `audio_mix_service.py` 新模块，内部用 ffmpeg `amix` filter，命中 hash 缓存（来自 `storyboard_items.mixed_audio_hash` 列）即直接返回；未命中则生成新文件并 `save_generated_file_to_db()` 落盘。

## 4. Components / Modules（新增 / 修改清单）

| Layer | File | 类型 | 职责 |
|---|---|---|---|
| Backend | `api_routes.py` | 修改 | 新加 `POST /api/storyboard/mix-audio` |
| Backend | `audio_mix_service.py` | 新增 | ffmpeg 混音 + hash 缓存 + 落盘 |
| Backend | `dao_storyboard.py` | 修改 | 加 mixed_audio_url / mixed_audio_hash 字段 R/W |
| DB | `db_migration_storyboard_audio_mix.sql` | 新增 | ALTER TABLE 加两个字段 |
| Frontend | `services/videoService.ts` | 修改 | 类型扩展 + `mixStoryboardAudio()` 客户端函数 |
| Frontend | `pages/VideoGenPage.tsx` | 修改 | 重写 `handleImportAll`：空分镜不过滤、收集 storyboard_meta、异步混音 |
| Frontend | `components/VideoPage.tsx` | 修改 | placeholder 卡片样式 + audio badges + 同步按钮 + 同步模态 |
| Frontend | `components/video/CardDurationField.tsx` | 新增 | 通用时长输入组件 |
| Frontend | `hooks/useReactiveDuration.ts` | 新增 | 响应式 duration 状态机 |
| Frontend | `utils/durationMapping.ts` | 新增 | clampSec、computeReactiveDuration 纯函数 |
| Frontend | `components/SeedanceMultimodalPanel.tsx` | 修改 | 移除自带 duration 输入（让位 CardDurationField）；textarea 替换为 SeedanceMentionPromptEditor；新增右上「+ 插入素材」按钮 |
| Frontend | `utils/seedanceMedia.ts` | 新增 | media 类型 + insertMention / removeMediaInput / canonicalizePrompt / shouldEnableWebSearch / nextTokenIndex |
| Frontend | `utils/seedanceCandidateBuilder.ts` | 新增 | buildCandidates(ctx) 纯函数，输入 EpisodeContext / SeedanceParams / userFiles，输出 7 组候选 |
| Frontend | `components/SeedanceMentionPromptEditor.tsx` | 新增 | 受控编辑器，`@` popover + Modal 选择，token 自动维护 |
| Frontend | `components/SeedanceAssetPickerModal.tsx` | 新增 | 「+ 插入素材」按钮 Modal，多选缩略图，复用 candidate builder |
| Frontend | `hooks/useSeedanceCandidates.ts` | 新增 | 组合 EpisodeContext + useEntityFilesQuery + useHistory，memo 后给 panel |
| Backend | `worker.py` | 修改 | Seedance 调用层透传 `tools: [{type: "web_search"}]`（仅当 shouldEnableWebSearch 为 true） |
| Tests | `__tests__/utils/durationMapping.test.ts` | 新增 | clampSec / 响应式规则单测 |
| Tests | `__tests__/utils/seedanceMedia.test.ts` | 新增 | nextTokenIndex / insertMention / removeMediaInput 重编号 / canonicalizePrompt / shouldEnableWebSearch |
| Tests | `__tests__/utils/seedanceCandidateBuilder.test.ts` | 新增 | 7 组候选构造，空 episode、含 storyboard、含 history、ark 兜底 |
| Tests | `__tests__/components/SeedanceMentionPromptEditor.test.tsx` | 新增 | `@` 触发条件、token 自动追加、删除重编号、autoOpenOnMount、Modal 多选 |
| Tests | `__tests__/hooks/useReactiveDuration.test.ts` | 新增 | hook 状态机单测 |
| Docs | `docs/api.md` | 修改 | mix-audio 接口文档 |
| Docs | `docs/database.md` | 修改 | mixed_audio_url / mixed_audio_hash |
| Docs | `docs/frontend.md` | 修改 | VideoGenPage 流程更新 + Seedance mention 编辑器 |
| Docs | `docs/vertical-slices.md` | 修改 | 增 CardDurationField / useReactiveDuration / SeedanceMentionPromptEditor |
| Docs | `docs/faq.md` | 修改 | 加新 entry：空分镜也能导入；Seedance prompt @ 不弹 popover 排错 |
| Docs | `docs/conventions.md` | 修改 | 「视频卡片时长字段统一走 TaskGroup.duration」+「Seedance prompt 走 SeedanceMentionPromptEditor，禁止裸 textarea」 |
| Plans | `docs/superpowers/plans/2026-05-16-seedance-asset-mentions.md` | 修改 | header 加 `Status: Superseded by docs/superpowers/specs/2026-05-17-storyboard-video-import-completeness-design.md` |
| Specs | `docs/superpowers/specs/2026-05-16-seedance-asset-mentions-design.md` | 修改 | 同上 superseded 标记 |

## 5. Data Flow

### 5.1 Import 流程（`handleImportAll`）

```
用户进 VideoGenPage
  ↓
loadSlices('storyboardItems') ← EpisodeContext
  ↓
循环每条 storyboardItem：
  ┌─ 校验 generated_image_url（白名单）─┐
  ├─ 收集 audioUrls / plannedDurationMs / audioDurationMs ─┤
  └─ 决定 isPlaceholder（无图）─┘
  ↓
计算每个 group 的初始 duration（响应式规则一次性）
  ↓
makeInitialSeedanceParams → 每个 group 的 SeedanceParams
  ↓
saveWorkspaceSession（不含 mixedAudioUrl）→ UI 立即显示
  ↓
异步 batch（并发 3）：对每条有音频的 itemId 调 mix-audio
  ↓ 每条完成
patch session.storyboard_meta[itemId].mixedAudioUrl
patch seedance_params[groupUuid].media_inputs += { role: 'reference_audio', url }
  ↓
触发 useReactiveDuration 重算 → 卡片 duration 自动更新
```

### 5.2 卡片内响应式 duration

```
用户在卡片操作 → media_inputs 变化
  ↓
useReactiveDuration 重算（除非 userOverride）
  ↓
patchTaskGroup(uuid, { duration: newValue })
  ↓
session 持久化 + UI 更新
```

### 5.3 Mention 选择 → 插入流程

```
用户在卡片输入 prompt，敲 @
  ↓
SeedanceMentionPromptEditor 检测合法触发条件（前一字符为空白/行首，光标不在 token 内）
  ↓
useSeedanceCandidates 取出已 memo 的 SeedanceAssetCandidate[]（按 group 排序）
  ↓
弹 popover，搜索框默认聚焦
  ↓
用户选中（或敲 Enter）
  ├─ text 候选：直接插字符串到光标位置
  ├─ media 候选：insertMention(value, candidate)
  │     → push media_inputs（kind/role/url/sourceId）
  │     → 末尾追加 图片N / 视频N / 音频N（前置空格）
  │     → onChange 上抛新 SeedanceParams
  └─ ark_asset_id：弹小输入框收 asset://...，校验后视为 media
  ↓
渲染：textarea 文本更新；media_inputs 列表加新缩略图

删除 media_input：
  removeMediaInput(value, idx)
    → 删除 + 同 kind 项重编号
    → prompt 文本里所有 图片k (k > idx 的同 kind) 同步 rename
    → onChange 上抛
```

### 5.4 「同步分镜」流程

```
用户点 ⟳ 同步按钮
  ↓
比对 storyboardItems × workspace.uploaded_images.storyboardItemId
  → newItemIds: 在 storyboard 但不在 workspace
  → modifiedItemIds: 在两者，但 storyboard.updated_at > storyboard_meta.lastSyncedAt
  → cardModifiedItemIds: 用户已动过卡片（media_inputs / prompt / duration override）
  ↓
弹模态显示 N / M / K
  ↓
用户选：
  - 仅添加新分镜：append newItemIds 对应的 image + group + meta + seedance_params
  - 覆盖未修改的：上述 + 重置 modifiedItemIds 但跳过 cardModifiedItemIds
  - 全量重置：清空 task_groups / uploaded_images / seedance_params / storyboard_meta，重导入
  ↓
saveWorkspaceSession + 触发异步混音（仅对新增/覆盖的 itemId）
```

## 6. Seedance Asset Mentions（合并自 2026-05-16 plan）

### 6.1 候选源（7 类）

| Group | 数据来源 | kind | 典型用法 |
|---|---|---|---|
| `current_card` | 该 SeedanceParams.media_inputs 已添加的项 | image / video / audio | "把刚才的首帧改成参考图" |
| `storyboard_data` | EpisodeContext.storyboardItems[i].sceneHeading / dialogue | text | 把分镜文字片段插进 prompt |
| `assets` | EpisodeContext.materialLibrary（角色/背景/道具） | image | "用主角立绘做首帧" |
| `audio` | storyboard_meta.audioUrls + materialLibrary.audio | audio | "把这段对白当 reference_audio" |
| `video_segments` | history.videos（已生成视频）+ workspace.task_groups 已成功的视频 | video | "续接刚生成的镜头" |
| `user_files` | useEntityFilesQuery（entity_files 表，按 episode 范围） | image / video / audio | 媒体库（按用户口径） |
| `ark_asset_id` | 用户在 popover 末尾手输 `asset://xxx` | image / video / audio | 跨端复用已上传到 Ark 的远程 ID |

候选生成入口：`new_html/utils/seedanceCandidateBuilder.ts:buildCandidates(ctx)`（纯函数，输入 EpisodeContext / current SeedanceParams / user files query result，输出 `SeedanceAssetCandidate[]`，分组排序后给 popover）。

### 6.2 编辑器组件 `SeedanceMentionPromptEditor`

**职责**：受控的 prompt 编辑器，替换 SeedanceMultimodalPanel 当前裸 textarea。

**接口**：

```typescript
interface SeedanceMentionPromptEditorProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
    disabled?: boolean;
    autoOpenOnMount?: boolean;        // P2 placeholder 卡片用
    placeholder?: string;
}
```

**行为**：

- 检测光标后输入 `@`（不在 token 内、前一个字符为空白或行首）→ 弹 popover，定位在光标处。
- popover：上面是搜索框（按 label 模糊匹配），下面分组列表 7 个 group，每组前 N 条；`Esc` 关闭、`↑↓` 导航、`Enter` 选中、`Tab` 跳到下一组。
- 选中候选：
  - 文本候选 → 直接把 text 插进光标位置（不动 media_inputs，不加 token）。
  - 媒体候选 → 调用 `insertMention(value, candidate)` 拿到新的 SeedanceParams（push media_inputs + 在 prompt 末尾追加 `图片N / 视频N / 音频N`），onChange 上抛。
  - `ark_asset_id` 候选 → 弹小输入框收 `asset://...`，校验后视为对应 kind 的 media。
- 卡片右上 `+ 插入素材` 按钮：复用同一 candidates 数据源，开 Modal（多选 + 缩略图）→ 选完后批量 `insertMention` 一次。

### 6.3 Token 自动管理（T1 + R1）

纯函数集中在 `seedanceMedia.ts`，单测必须覆盖：

| 函数 | 行为 |
|---|---|
| `nextTokenIndex(value, kind)` | 返回该 kind 当前最大编号 + 1（基于 media_inputs 而非 prompt 文本） |
| `insertMention(value, candidate)` | push media_inputs；prompt 末尾如缺 token 则追加（含前置空格）；返回新 value |
| `removeMediaInput(value, idx)` | 删除 media_inputs[idx]，**对剩余同 kind 项重编号**（图片3→图片2 当 2 删除时），prompt 文本里所有该 kind 的 token 同步 rename |
| `canonicalizePrompt(value)` | 提交前规范化：剔除孤儿 token（媒体已删但文字还在）、合并重复 token、保证每个 media_inputs 都至少出现一次（缺失则自动补在末尾） |

**重编号语义警告**：R1 决定接受"图片2 走向 图片3"这类硬写表达可能漂移。`canonicalizePrompt` 不主动改写用户文字 token 的语义，只做格式层 rename。Section 11 风险列表对应一条。

### 6.4 与 Import / Placeholder 的集成

- **Placeholder 卡片**：`makeInitialSeedanceParams(item)` 在 `isPlaceholder = true` 时把 `prompt` 初始化为 `'@'`，并在 SeedanceMultimodalPanel 把 `autoOpenOnMount = (prompt === '@' && media_inputs.length === 0)` 传给编辑器，卡片首次获焦自动弹 popover。
- **导入完成后**：每条带音频的 storyboard_item 异步 mix 完成 → patch `seedance_params[uuid].media_inputs` 追加 `{ kind: 'audio', role: 'reference_audio', url }` → `insertMention` 同步加 `音频1` token；UI 下次 render 卡片就能看到（不影响响应式 duration 流，且 token 重编号不会冲突，因为新增不重命名）。

### 6.5 web_search Tool（纯文本场景）

旧 plan 的「无 media_inputs 且 prompt 非空」时给 Seedance API 加 `tools: [{ "type": "web_search" }]`。本 spec 保留：

- 前端 `seedanceMedia.ts:shouldEnableWebSearch(value)` 返回布尔（无任何 media_inputs + prompt 非空 + sub_model 允许 web_search）。
- 透传给后端 `worker.py` 的 Seedance 调用层；`api_routes.py` /api/generate 不需要改，参数已经在 task.params。

## 7. Error Handling

| 错误源 | 行为 | 用户感知 |
|---|---|---|
| storyboard.generated_image_url 是 data:/blob: | 跳过该项，banner 报告（已有的现成机制） | banner 红条 + console 详情 |
| ffmpeg 不可用 | mix-audio 返回 503 | banner 警告"音频混音不可用，已跳过音频"，卡片正常导入但无音频 |
| 单条 mix-audio 失败 | 该 itemId 不写 mixedAudioUrl，其余继续 | 该卡片走"无 mixed audio"路径，duration 走 planned |
| save_session 失败 | banner 报"保存工作区会话失败" | 同现状 |
| 混音超时（> 30s） | 客户端不阻塞主流程，后续 poll | 卡片显示"混音中..."直到完成 |

## 8. Backwards Compatibility

| 老数据 | 新代码行为 |
|---|---|
| 老 session 无 `seedance_params` | 加载时取 `{}`，需要时按需 init 默认值 |
| 老 session 无 `storyboard_meta` | duration 用 5（响应式规则兜底分支），无 audio badge |
| 老 session `task_groups[i].model = 'Wan2'` | 不强制升级，CardDurationField 显示 duration（用户可改） |
| 老 session `seedance_params[uuid].duration` 存在但 group.duration 缺失 | 加载时迁移：从 seedance.duration 拷贝到 group.duration，下次 save 时不再写 seedance.duration |
| 老 storyboard_items 行无 mixed_audio_url 列 | DB migration 已 ADD COLUMN IF NOT EXISTS，加载安全；新调用 mix-audio 后自动填充 |

## 9. Testing Strategy

| 类型 | 文件 | 覆盖 |
|---|---|---|
| Unit (frontend pure) | `__tests__/utils/durationMapping.test.ts` | clampSec 边界、computeReactiveDuration 5 个分支 |
| Unit (frontend hook) | `__tests__/hooks/useReactiveDuration.test.ts` | userOverride 锁定、媒体变化重算、storyboard meta 缺失兜底 |
| Integration (frontend) | 暂无（手测覆盖：空分镜导入、混音返回后卡片更新、同步模态三选一） | — |
| Backend | `tests/test_audio_mix_service.py`（如不存在则不强求） | hash 缓存命中、3 道→1 道、单道音频降级、ffmpeg 失败回退 |

## 10. Roll-out Plan

一次性 commit，内部分 9 个步骤便于 review：

1. Schema & types（DB migration + videoService.ts + seedanceMedia.ts 类型）
2. Backend（audio_mix_service + mix-audio 路由 + DAO + Seedance worker 透传 web_search）
3. Frontend pure utils + 单测（durationMapping、seedanceMedia、seedanceCandidateBuilder）
4. Frontend hook + 单测（useReactiveDuration、useSeedanceCandidates）
5. Frontend UI components（CardDurationField、SeedanceMentionPromptEditor、refactor SeedancePanel 用编辑器替换 textarea）
6. Frontend integration（handleImportAll、VideoPage placeholder/badges/同步模态、placeholder 自动 `@`）
7. Docs（按 Change → Doc Mapping 更新所有相关 docs，含 mention 部分）
8. Memory（scan_project + sync_check 须过）
9. Cleanup（旧 plan `2026-05-16-seedance-asset-mentions.md` 标记 status: superseded-by 2026-05-17 spec；旧 spec 同步标记）

## 11. Risks & Mitigations

| 风险 | 缓解 |
|---|---|
| ffmpeg 在生产服务器没装 | 启动时 `which ffmpeg` 检查；mix-audio 显式 503 + 文档说明部署要求 |
| 混音文件占磁盘 | 复用 `save_generated_file_to_db`，进 files 表；GC 走现有配额清理流程 |
| 一次大量混音雪崩 | 客户端 batch 并发 = 3 |
| 响应式 duration 与用户手动改的 race | userOverride 一旦 true 永久锁定，仅 ↺ 按钮可解 |
| 老 session 双 duration 冲突 | 加载时迁移到 group.duration，写入只走 group.duration |
| 「飞升 = standard 子模型」用户期望 vs 实际 | 文档明确：飞升 = standard、渡劫 = fast；用户在卡片下拉可切 |
| Mention 候选数据延迟（用户刚生成的图未入 cache） | useSeedanceCandidates 监听 EpisodeContext / useEntityFilesQuery 失效，新数据 invalidate 后 100ms 内出现在 popover；popover 顶端有「↻ 刷新」按钮兜底 |
| Token 重编号导致 prompt 语义漂移（"图片2 走向 图片3" 写法） | canonicalize 只 rename 格式层，不改用户写的语义连接词；FAQ 强调用户最好写"主图走向参考"而非引数字；插入新 media 不触发 rename，仅删除时触发 |
| `@` popover 在受控编辑器和浏览器原生 IME（中文输入法）冲突 | popover 在 `compositionstart` 时收起，`compositionend` 后再判断是否需要重开；单测覆盖中文输入场景 |
| 用户在 prompt 里手写 `图片3` 但 media_inputs 只有 2 张 | canonicalizePrompt 把孤儿 token 标黄（不删除），提交前给警告 banner，不阻塞提交 |
| Ark `asset://` ID 写错被 Seedance API 拒绝 | 输入时只做格式校验（`asset://` 前缀 + 非空 id），实际可用性由后端 worker 报错回流；FAQ 记录常见错误 |
| web_search tool 与 sub_model 不兼容 | shouldEnableWebSearch 内部白名单：仅 standard/lite 支持；不支持的 sub_model 直接返回 false，不上报错误 |

## 12. YAGNI / Out-of-Scope

显式不做的事情：

- 客户端混音（浏览器 Web Audio 不稳定）
- 混音参数 UI 调节（gain 写死，需要时再加）
- 自动按 storyboard 顺序生成视频（用户手动点）
- 卡片间 audio 试听联动（每张独立）
- "全部应用相同 duration" 批量按钮
- 不同采样率/通道数的对齐（ffmpeg amix 自动处理）
- 「按需混音」（导入时一次性，避免切卡片再 trigger）
- Mention popover 内「编辑候选」（仅展示和选择，编辑要去对应页面：素材库 / 媒体库 / 历史）
- Mention 跨 episode 引用（候选只来自当前 episode，跨 episode 不在本期）
- Ark `asset://` 的可用性预校验（不调 Ark API 验证 ID 真实存在，提交时由 worker 兜底报错）
- Mention 协同 / 多用户编辑同一 prompt 冲突（项目目前是单用户工作区）
- 文本片段（storyboard_data 候选）插入后高亮 / 反查到分镜的「跳转」交互

## 13. References

- Brainstorming session transcript: 本对话
- Related fixes:
  - 拖拽上传 base64 修复（commit `49cbfdb`）
  - 双仓镜像自动化（commit `4b89834`）
- Superseded designs (合并入本 spec)：
  - `docs/superpowers/specs/2026-05-16-seedance-asset-mentions-design.md`
  - `docs/superpowers/plans/2026-05-16-seedance-asset-mentions.md`（1460 行，未实施）
- Code anchors:
  - `new_html/pages/VideoGenPage.tsx:handleImportAll`
  - `new_html/services/videoService.ts:WorkspaceSession`
  - `new_html/components/SeedanceMultimodalPanel.tsx`（当前裸 textarea，待替换）
  - `new_html/services/entityFileService.ts` / `useEntityFilesQuery`（媒体库数据源）
  - `new_html/components/MaterialPage.tsx` / `EpisodeContext.materialLibrary`（素材库数据源）
  - `db_migration_storyboard_items.sql`
  - `file_service.py:save_generated_file_to_db / _sync_legacy_on_file_create`
