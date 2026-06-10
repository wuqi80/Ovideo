# Seedance Card Layout Design

Date: 2026-05-13

## Goal

VideoPage 的飞升 / 渡劫模型需要在卡片视图内完整展示 Seedance 2.0 参数，同时保持左右两列卡片高度一致。

当前问题：

- VideoPage 默认是 `card` 视图。
- 普通卡片高度固定在 `min-h-[380px] max-h-[420px]`。
- `SeedanceMultimodalPanel` 包含 prompt、图片、视频、音频、真人脸提示、输出参数等内容，放进 420px 卡片后参数显示不全。
- 左侧配置卡变高后，右侧结果卡没有同步高度，造成左右不齐。

## Approved Direction

采用方案 B：

**Seedance 专用大卡片 + 参数全部展开 + 左右同高自适应 620-760px**。

普通模型继续使用现有紧凑卡片高度；只有 `Seedance2` / `Seedance2Fast` 使用专用大卡片布局。

## UX Requirements

### Card Height

- 普通模型：保持当前 `min-h-[380px] max-h-[420px]`。
- Seedance 模型：使用 `min-h-[620px] max-h-[760px]`。
- 左侧 storyboard/config 卡和右侧 result 卡必须使用同一个 height class helper，确保同一任务行左右同高。

建议 helper：

```ts
const isSeedanceModel = (model: videoService.VideoModel) =>
  model === 'Seedance2' || model === 'Seedance2Fast';

const getCardHeightClass = (model: videoService.VideoModel) =>
  isSeedanceModel(model)
    ? 'min-h-[620px] max-h-[760px]'
    : 'min-h-[380px] max-h-[420px]';
```

### Left Card Layout

Seedance 模式下左侧卡片结构：

1. Header
   - I2V / Morph badge
   - 模型选择：飞升 / 渡劫
   - 删除 / 拆分等现有操作保持不变
2. 图片预览
   - Seedance 模式下压缩高度，把空间留给参数
   - 单图建议 `h-40`
   - 双图建议 `h-28`
3. Seedance 参数面板
   - Prompt
   - 媒体输入：图片 0-9、视频 0-3、音频 0-3
   - 输出参数：分辨率、比例、时长、seed、水印、AI 配音、camera_fixed
   - 约束提示：真人脸来源限制、不可仅音频、fast 不支持 1080p

### Parameter Visibility

Seedance 参数默认全部展开。

不再把输出参数藏在“高级设置”折叠里。可以保留视觉分组，但默认必须直接可见：

- `resolution`
- `ratio`
- `duration`
- `seed`
- `watermark`
- `generate_audio`
- `camera_fixed`（2.0 系列灰显并说明无效）

样片任务 ID 仍然灰显，因为 Seedance 2.0 系列不支持 `draft_task_id`。

### Media Inputs

面板必须清楚显示三类输入：

| Type | Limit | Role |
|------|-------|------|
| 图片 | 0-9 | empty / first_frame / last_frame / reference_image |
| 视频 | 0-3 | reference_video |
| 音频 | 0-3 | reference_audio |

Validation:

- 至少提供 prompt 或媒体。
- 不可单独输入音频；有音频时必须至少有 1 张图或 1 段视频。
- 首帧和尾帧必须成对出现。
- 首尾帧与 reference_image 互斥。
- fast / 渡劫不支持 1080p。
- 图片最多 9 张，视频最多 3 个，音频最多 3 个。

### Right Result Card Layout

右侧结果卡必须与左侧同高。

Seedance 模式下：

- idle：居中显示等待生成。
- running：居中显示进度、耗时、状态。
- completed：视频预览区域可比普通模型更高，底部保留选择 / 下载 / 操作按钮。
- failed：错误信息在卡片内可滚动，不撑破卡片。

### Scroll Behavior

Seedance 大卡片允许内容在内部滚动，但首选通过布局压缩减少滚动。

约束：

- 外层卡片高度不超过 760px。
- 左侧参数区可用 `overflow-y-auto`。
- 右侧失败详情或多结果区域可用内部滚动。
- 普通模型不改变滚动体验。

## Component Changes

### `new_html/components/VideoPage.tsx`

Add shared helpers:

- `isSeedanceModel(model)`
- `getCardHeightClass(model)`

Use helper in:

- `renderStoryboardCard`
- `renderResultCard`

Replace hardcoded:

```ts
const cardHeight = 'min-h-[380px] max-h-[420px]';
```

with:

```ts
const cardHeight = getCardHeightClass(group.model);
```

Seedance image preview height should also depend on model:

- normal single image: existing `h-52`
- seedance single image: `h-40`
- normal pair image: existing `h-32`
- seedance pair image: `h-28`

### `new_html/components/SeedanceMultimodalPanel.tsx`

Restructure into always-visible sections:

1. Prompt
2. Media inputs
3. Output params
4. Constraints / warnings

Remove default collapsed “高级设置” behavior for Seedance 2.0. The section may keep a heading, but controls must be visible by default.

Use compact two-column controls for output params:

```text
分辨率 | 画面比例
时长   | Seed
水印   | AI配音
固定镜头(灰)
```

Keep the existing validation logic and upload handlers.

## Documentation Updates

Because this changes a page/panel layout:

- Update `docs/frontend.md`
  - VideoPage card/list mode note
  - Seedance card height and always-expanded parameter design
- Update `docs/faq.md`
  - Add/extend entry for “飞升/渡劫参数显示不全、左右卡片高度不一致”
- Mirror both files to `deploy/docs/`.

## Verification

Required checks:

```bash
npx tsc --noEmit
npm run build
python .claude/skills/project-memory/scripts/scan_project.py .
python .claude/skills/project-memory/scripts/sync_check.py . --strict --levels ERROR
```

Manual UI checks:

1. Card view + `Seedance2`:
   - All parameters are visible by default.
   - Card height is larger than normal card.
   - Right result card height matches left card.
2. Card view + `Seedance2Fast`:
   - 1080p disabled or downgraded.
   - All params visible.
3. Card view + normal model:
   - Old compact card height unchanged.
4. List view:
   - Existing Seedance panel still works.
5. Upload counts:
   - 图片 0-9 / 视频 0-3 / 音频 0-3.
   - Audio-only input shows validation error.

## Non-goals

- Do not add new Seedance API parameters in this layout pass.
- Do not redesign list view beyond keeping it compatible.
- Do not change backend task submission behavior.
- Do not change database schema.

## Self-review

- No placeholder sections remain.
- Scope is limited to VideoPage card layout, SeedanceMultimodalPanel display behavior, docs, and rebuild.
- Backend behavior and API request shape stay unchanged.
- Existing normal model card layout remains the compatibility baseline.
