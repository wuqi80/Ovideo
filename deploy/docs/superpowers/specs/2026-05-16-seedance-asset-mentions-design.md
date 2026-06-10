# Seedance 2.0 Asset Mentions Design

> **Status: Superseded** by `docs/superpowers/specs/2026-05-17-storyboard-video-import-completeness-design.md` §6（Seedance Asset Mentions 节）。
> 本 spec 描述的 7 组候选、`@` popover、token 自动维护、Ark `asset://` 透传、`web_search` 兜底，全部已在 2026-05-17 spec 内合并实施（2026-05-17，commits `e6c4ca0..fae1978`）。**不要独立执行。** 仅保留供历史回溯。

Date: 2026-05-16

## Goal

Improve the Seedance 2.0 frontend so creators can reuse existing project materials with `@` mentions instead of repeatedly uploading files or manually tracking Seedance's `图片1 / 视频1 / 音频1` references.

The design targets a focused first release:

- Rich `@` mentions in the Seedance prompt editor.
- Automatic `图片n / 视频n / 音频n` numbering based on the actual request content order.
- A searchable candidate pool from current card media, current episode storyboard data, assets, audio, previous video outputs, and user files.
- Four lightweight intent buttons: `参考生成`, `编辑视频`, `延长视频`, `联网搜索`.
- No complex wizard in the first release.

`联网搜索` is in scope for the first release. Because Ark only supports web search for pure-text requests, the frontend must disable it whenever media is present, and the backend must pass `tools: [{ type: "web_search" }]` through the Seedance request path only for valid pure-text Seedance tasks.

## Current Data Flow Findings

Project-memory slice review shows that the current video workspace is only partially connected to upstream creative data.

| Source page | Current source data | Current path into VideoPage | Gap for Seedance |
| --- | --- | --- | --- |
| `StoryboardGenPage` / `GenerationPage` | `StoryboardItemDB.imagePrompt`, `videoPrompt`, `dialogue`, `generatedImageUrl`, `boundAssets`, `dialogueAudioUrl`, `narrationAudioUrl` | `VideoGenPage` imports `generatedImageUrl` into `uploaded_images` and `imagePrompt` into `image_prompts` | `videoPrompt`, `dialogue`, audio URLs, and bound asset metadata are not imported into the video workspace |
| `MaterialsPage` / `DesignPage` | `assets`, `referenceImages`, `thumbnailUrl`, `entityFiles`, `boundAssets`, `materialSelections` | Available through `EpisodeContext` only when the page loads the `assets` slice | Seedance panel currently does not receive assets or material library candidates |
| `AudioStagePage` | `dialogueAudioUrl`, `narrationAudioUrl`, `audioTracks`, `characterVoices.sampleAudioUrl` | Available through `EpisodeContext` if `audioTracks` / `characterVoices` slices are loaded | Seedance panel currently only uploads new audio files and cannot reuse generated dialogue or voice samples |
| `VideoPage` current card | `uploadedImages`, `taskGroups`, `tasksStatus.videos`, `imagePrompts` | Local component state + workspace session | Good local source for current-card images and previous result videos, but not exposed as a typed Seedance candidate source |
| Historical files | `/api/user-files`, `/api/entity-files` | Available through `entityFileService` | Not wired into Seedance media selection |

Conclusion: the first implementation should **not** extend the old workspace session as the main integration surface. Instead, `VideoGenPage` should load the extra `EpisodeContext` slices and pass a normalized candidate context into `VideoPage` / `SeedanceMultimodalPanel`.

## Product Behavior

### Prompt Mentions

The Seedance prompt editor becomes a token-aware prompt input.

User-facing behavior:

- Typing `@` opens a searchable material picker.
- Selecting a candidate inserts a rich token, for example `@小美(图片1)` or `@旁白音色(音频1)`.
- The token also adds the selected material to `media_inputs`.
- The visible token keeps the human-readable label.
- The submitted prompt replaces tokens with Seedance-compatible references:
  - `@小美(图片1)` -> `图片1`
  - `@参考片段(视频2)` -> `视频2`
  - `@旁白音色(音频1)` -> `音频1`

Important rule from the Seedance docs:

- The model does not understand asset IDs or filenames inside prompt text.
- Prompt text must refer to media as `图片n`, `视频n`, or `音频n`, where `n` is the 1-based order of that modality in the request content array.

### Media Numbering

Numbering is derived from the current `media_inputs` order by modality:

- Images: all `kind: "image"` inputs ordered by their media order become `图片1`, `图片2`, ...
- Videos: all `kind: "video"` inputs become `视频1`, `视频2`, ...
- Audio: all `kind: "audio"` inputs become `音频1`, `音频2`, ...

When the user reorders or removes a media item:

- Visible mention labels update automatically.
- The canonical prompt submitted to the backend is regenerated.
- No stale `图片2` should remain if the second image was removed or moved.

### Candidate Sources

Candidates are normalized into a single `SeedanceAssetCandidate` shape.

Candidate groups:

1. Current card
   - Left-card imported storyboard image.
   - Linked pair image if present.
   - Current card result videos from `tasksStatus[group.uuid].videos`.
   - Current card prompt as a text helper, not media.

2. Current episode storyboard
   - `generatedImageUrl` as image candidates.
   - `videoPrompt`, `imagePrompt`, `dialogue`, `sceneHeading`, `actionText` as prompt helper snippets.
   - `dialogueAudioUrl` and `narrationAudioUrl` as audio candidates.
   - `boundAssets` as a bridge to character / scene assets.

3. Asset library
   - Character, scene, and prop assets from `EpisodeContext.assets`.
   - Prefer `entityFiles` with `fileRole: "reference_image"` over legacy `referenceImages`.
   - Fall back to `thumbnailUrl` / `referenceImages`.

4. Audio library
   - `audioTracks` as music / dialogue / sound-effect candidates.
   - `characterVoices.sampleAudioUrl` as voice-reference candidates.

5. Existing video outputs
   - `videoSegments.videoUrl` as video candidates for editing or extension.
   - Current session result videos as immediate candidates before DB reload completes.

6. User history
   - `/api/user-files` as a secondary search source for images, videos, and audio.
   - This should be lazy-loaded when the picker opens or when the user searches.

7. Ark asset IDs
   - Manual `asset://<asset ID>` input should be supported as an advanced option.
   - These candidates are useful for preset virtual human assets or authorized human materials.
   - The visible prompt still uses `图片n / 视频n / 音频n`, never the asset ID.

Text candidates are helper snippets only:

- Selecting a text candidate inserts or appends the snippet into the prompt.
- It does not create a `SeedancePromptMention`.
- It does not add anything to `media_inputs`.
- It does not participate in `图片n / 视频n / 音频n` numbering.

## Intent Buttons

The panel adds a compact intent row above the prompt editor.

### `参考生成`

Default Seedance multimodal mode.

Behavior:

- Allows any valid image / video / audio combination.
- Uses existing validation: images <= 9, videos <= 3, audio <= 3, not audio-only.
- Prompt helper examples:
  - `参考图片1的主体特征，结合视频1的运镜，生成...`
  - `全程使用音频1作为背景音乐...`

### `编辑视频`

For object replacement, deletion, modification, local repainting, and similar video edits.

Behavior:

- Encourages at least one `视频n`.
- Allows reference images / audio.
- Prompt helper examples:
  - `将视频1中的香水替换成图片1中的面霜，运镜不变。`
  - `删除视频1中右侧的人物，保持背景和镜头运动不变。`

### `延长视频`

For forward / backward extension or stitching up to three video clips.

Behavior:

- Encourages 1-3 videos.
- Allows prompt-driven transition descriptions.
- Prompt helper examples:
  - `向后延长视频1，镜头继续推进到...`
  - `视频1接视频2，中间补全自然过渡...`

### `联网搜索`

For pure text generation with timely information.

Behavior:

- Only enabled when `media_inputs.length === 0`.
- If media exists, show disabled state with: `联网搜索仅适用于纯文本输入`.
- Adds `tools: [{ type: "web_search" }]` to the Seedance request.
- The backend request model, worker, and Seedance API client need a small extension to pass `tools`.
- This is a first-release requirement, not a later optional enhancement.

## Component Design

### `SeedanceAssetCandidate`

Recommended frontend-only normalized type:

```ts
type SeedanceAssetCandidateKind = 'image' | 'video' | 'audio' | 'text';

interface SeedanceAssetCandidate {
  id: string;
  kind: SeedanceAssetCandidateKind;
  label: string;
  url?: string;
  fileId?: string;
  source:
    | 'current_card'
    | 'storyboard'
    | 'asset'
    | 'audio_track'
    | 'character_voice'
    | 'video_segment'
    | 'user_file'
    | 'ark_asset';
  roleHint?: SeedanceMediaRole;
  previewUrl?: string;
  metadata?: {
    storyboardItemId?: string;
    assetId?: string;
    assetType?: 'character' | 'scene' | 'prop';
    sortOrder?: number;
    text?: string;
    arkAssetId?: string;
  };
}
```

### `SeedancePromptMention`

Prompt editor tokens store stable candidate identity and render-time numbering.

```ts
interface SeedancePromptMention {
  id: string;
  candidateId: string;
  mediaInputId: string;
  label: string;
  kind: 'image' | 'video' | 'audio';
}
```

The canonical submitted prompt should be built from the editor document, not from visible text.

### `SeedanceMediaInput`

Extend the existing media input with stable IDs and labels:

```ts
interface SeedanceMediaInput {
  id: string;
  kind: SeedanceMediaKind;
  url: string;
  role?: SeedanceMediaRole;
  file_id?: string;
  label?: string;
  source?: SeedanceAssetCandidate['source'];
  source_id?: string;
}
```

Compatibility note:

- Existing saved state may not have `id`, `label`, or `source`.
- The UI must normalize existing values through a single `normalizeSeedanceMediaInputs()` helper when reading or initializing `SeedanceParams`.
- The helper generates missing stable IDs, preserves existing `file_id`, and fills conservative labels from URL filenames or source metadata.
- Normalization should happen at the boundary (`getSeedanceParams` / panel initialization), not scattered across child components.

### `SeedanceContextBuilder`

Create a pure helper that receives:

- current group
- `uploadedImages`
- `tasksStatus`
- `imagePrompts`
- `storyboardItems`
- `assets`
- `audioTracks`
- `characterVoices`
- `videoSegments`
- optional `fetchUserFiles` result

It returns grouped `SeedanceAssetCandidate[]`.

This isolates cross-page data mapping from the panel UI and makes it unit-testable.

### `SeedanceMentionPromptEditor`

Responsibilities:

- Render the prompt editor.
- Open the picker on `@`.
- Insert / delete rich tokens.
- Recompute visible token numbering when media order changes.
- Export canonical prompt text for `submitSeedanceTask`.

Implementation can start simple:

- A controlled textarea plus a token sidecar map is acceptable for the first version if full rich text is too large.
- The user-visible text can include plain token text like `@小美(图片1)`.
- Submit-time canonicalization should still be token-map-driven where possible.

Textarea fallback consistency rules:

- The sidecar token map is the source of truth for media-backed mentions.
- Before submit, scan the visible prompt for each known token label.
- If a token was manually edited so it no longer matches the sidecar metadata, show a repair prompt instead of silently submitting ambiguous text.
- If a token was deleted from the visible prompt, mark the mention as unreferenced. The media may remain in `media_inputs`, but the UI should show that it is no longer referenced in prompt text.
- A "sync tokens" action can rewrite visible labels from metadata, for example changing stale `@小美(图片2)` back to the current `@小美(图片1)` after reorder.

## Data Flow

1. `VideoGenPage` loads:
   - `storyboardItems`
   - `assets`
   - `audioTracks`
   - `characterVoices`
   - `videoSegments`

2. `VideoGenPage` passes this context to `VideoPage`.

3. `VideoPage` combines episode context with local workspace state:
   - current `uploadedImages`
   - current `taskGroups`
   - current `tasksStatus`
   - current `imagePrompts`

4. `VideoPage` builds per-group Seedance candidates and passes them to `SeedanceMultimodalPanel`.

5. `SeedanceMultimodalPanel` lets the prompt editor insert candidates as mentions.

6. Mentions update:
   - visible prompt document
   - `media_inputs`
   - token metadata

7. `runTask` calls `submitSeedanceTask` with:
   - canonical prompt text
   - media inputs in the displayed order
   - optional `tools` when `联网搜索` is enabled

8. Backend persists output through the existing entity-aware Seedance path:
   - `entity_type=video_segment`
   - `entity_id=group.uuid`
   - `file_role=video`

## Validation Rules

Existing rules remain:

- Empty media + empty prompt is invalid.
- Audio-only is invalid.
- Images <= 9.
- Videos <= 3.
- Audio <= 3.
- `fast` does not support `1080p`.
- `first_frame` and `last_frame` must be paired.
- `first_frame` / `last_frame` cannot mix with `reference_image`.

New rules:

- `联网搜索` requires zero media inputs.
- `编辑视频` shows a warning if no video is selected.
- `延长视频` shows a warning if no video is selected.
- Prompt mention tokens must point to existing media inputs.
- Removing a media input removes or invalidates mentions that reference it.
- Ark `asset://` candidates must include a modality selected by the user, because the asset ID itself does not tell the frontend whether it should be sent as `image_url`, `video_url`, or `audio_url`.

Image role defaults:

- Plain image candidates selected through `@` default to `reference_image`.
- Current card primary image can default to `first_frame` only when the user is in an image-to-video oriented flow and no other image role is set.
- Linked two-image card pairs may offer a one-click `首尾帧` assignment, setting the first image to `first_frame` and the second to `last_frame`.
- Editing and reference-generation modes should prefer `reference_image`.
- Strict first/last frame generation must require an explicit role assignment or an explicit pair action; it should not happen accidentally from a generic `@` selection.

## UX Details

Picker grouping:

- `当前卡片`
- `当前分镜`
- `角色 / 场景 / 道具`
- `音频 / 音色`
- `已有视频`
- `历史文件`
- `Ark asset://`

Search behavior:

- Search by label, asset name, scene heading, dialogue, filename, file ID, and asset ID.
- Default picker view should prioritize current card and current storyboard item.
- History search can be lazy and paginated.

Media tray:

- Each media item shows its computed Seedance reference label: `图片1`, `视频1`, `音频1`.
- Each media item shows its source label, e.g. `角色: 小美`, `分镜 03`, `当前结果视频`.
- Reordering should be explicit, because reordering changes prompt meaning.

Prompt helpers:

- Intent buttons insert short formulas, not full generated scripts.
- Do not auto-overwrite user prompt.
- If the prompt already contains mentions, helpers should preserve them.

Compliance hints:

- Keep the existing真人脸限制 warning.
- Add a note for `asset://`: `可用于预置虚拟人像或已授权真人素材；提示词里仍引用 图片n / 视频n / 音频n。`

## Backend/API Impact

First release is mostly frontend-side, with one required backend pass-through for web search.

Required backend/API changes:

- Add `tools?: Array<{ type: 'web_search' }>` to the generate request shape.
- Pass `tools` through `worker._process_seedance_task` to `SeedanceClient.create_video_task`.
- Ensure tools are only sent for Seedance pure text requests.
- Reject or ignore `tools` when media inputs exist, matching Ark's pure-text-only web search constraint.

No database schema change is required.

## Documentation Impact

Update these docs when implementing:

- `docs/frontend.md`: Seedance mention editor, candidate sources, intent buttons.
- `docs/api.md`: only if `tools` is added to `/api/generate`.
- `docs/backend.md`: only if `tools` is passed to Ark.
- `docs/vertical-slices.md`: Video page now reads additional `EpisodeContext` slices for Seedance candidates.
- `docs/faq.md`: add a note that Seedance prompts must use `图片n / 视频n / 音频n`, not file names or asset IDs.

## Testing Plan

Unit tests:

- Build candidates from current card state.
- Build candidates from storyboard items, assets, audio tracks, character voices, and video segments.
- Convert visible mentions to canonical Seedance prompt.
- Recompute numbering after media removal / reorder.
- Validate `联网搜索` disabled when media exists.
- Verify text candidates insert prompt snippets without adding media or mention tokens.
- Verify `normalizeSeedanceMediaInputs()` fills missing IDs for old saved state.
- Verify default image role assignment for generic `@` images and explicit first/last pair action.
- Verify edited or stale textarea tokens are detected before submit.

Component tests:

- Typing `@` opens picker.
- Selecting an image candidate inserts `@名称(图片1)` and adds image media.
- Selecting a video candidate inserts `@名称(视频1)` and adds video media.
- Selecting audio with no image/video triggers audio-only validation.
- Intent buttons insert formulas without overwriting existing prompt.

Integration checks:

- `VideoGenPage` loads the needed slices.
- Existing non-Seedance video models keep current behavior.
- Existing workspace sessions without new media IDs still load.
- `/api/generate` accepts Seedance `tools` for pure text web search and does not send tools with media requests.

Manual QA:

- Current card image -> `@当前分镜(图片1)` -> Seedance submit.
- Character asset reference image -> prompt canonicalizes to `图片1`.
- Dialogue audio -> `音频1` plus at least one image/video.
- Existing generated video -> edit mode `视频1`.
- Pure text + `联网搜索` enabled.
- Media present + `联网搜索` disabled.

## Out of Scope

- Full visual wizard for every Seedance recipe.
- Automatic prompt rewriting by LLM.
- Managing Ark virtual-human library inventory inside the app.
- New database tables for Seedance materials.
- Changing existing non-Seedance generation flows.

## Open Decisions

Resolved by this spec:

- Use rich visible `@名称(图片n)` tokens.
- Submit canonical Seedance references, not asset IDs or filenames.
- Load upstream episode slices into video page context instead of expanding workspace session as the primary contract.
- Keep first release lightweight with four intent buttons, not a multi-step wizard.
- Include `联网搜索` in the first release with backend `tools` pass-through.
- Treat text candidates as prompt snippets, not media mentions.
- Normalize legacy `media_inputs` at the Seedance state boundary.
- Default generic selected images to `reference_image`; use explicit controls for `first_frame` / `last_frame`.

Implementation should still choose the smallest prompt-editor mechanism that can preserve stable mention metadata. If a full rich-text editor is too much, start with plain token text plus sidecar metadata and strict canonicalization tests.
