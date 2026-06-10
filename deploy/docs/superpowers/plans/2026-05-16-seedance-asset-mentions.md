# Seedance Asset Mentions Implementation Plan

> **Status: Superseded** by `docs/superpowers/plans/2026-05-17-storyboard-video-import-completeness.md`.
> 这个 mention 设计已经合并到 2026-05-17 的"分镜→视频导入完整化"大特性里实施完成（commits `e6c4ca0`/`556ffdb`/`27345d3`/`8732afb`/`fae1978`，2026-05-17）。**不要再独立执行本 plan。** 历史保留供回溯。
>
> 主要差异：完整 plan 把 mention 与"导入空分镜 + 异步混音 + 响应式时长 + 同步模态"绑定为一个垂直切片，避免后续多次往同一 panel 改两次。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Seedance 2.0 `@` material mentions so creators can reuse current-card files, storyboard data, assets, audio, existing videos, user files, and Ark `asset://` IDs while the frontend automatically maintains Seedance-compatible `图片n / 视频n / 音频n` references.

**Architecture:** Keep the feature as a small vertical slice around the existing Seedance panel. Add pure frontend helpers for media normalization, candidate building, mention numbering, and prompt canonicalization; then wire those helpers into `VideoGenPage`, `VideoPage`, and `SeedanceMultimodalPanel`. Add a small backend pass-through for Seedance pure-text `tools: [{ type: "web_search" }]`.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, FastAPI/Pydantic, Python worker, Volcengine Ark Seedance API.

---

## Reference Spec

Design spec: `docs/superpowers/specs/2026-05-16-seedance-asset-mentions-design.md`

Before implementation, re-run impact checks for every file that will be edited:

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/services/videoService.ts" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/SeedanceMultimodalPanel.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/VideoPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/pages/VideoGenPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "cluster_main.py" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "worker.py" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "seedance_api.py" --brief
```

Expected: `VideoPage`, `VideoGenPage`, `EpisodeContext`, backend `/api/generate`, and Seedance worker are part of the affected slice. If GitNexus reports a stale index during implementation, run `npx gitnexus analyze` before editing symbols.

## File Structure

### Create

- `new_html/utils/seedanceMedia.ts`  
  Owns frontend-only Seedance media types, `normalizeSeedanceMediaInputs`, role defaults, media numbering, and canonical prompt conversion helpers.

- `new_html/utils/seedanceCandidateBuilder.ts`  
  Builds grouped `SeedanceAssetCandidate[]` from current card state, `EpisodeContext` slices, and optional user files.

- `new_html/components/SeedanceMentionPromptEditor.tsx`  
  Controlled prompt editor with `@` picker, text snippet insertion, media-backed mention insertion, token consistency checks, and canonical prompt export.

- `new_html/__tests__/utils/seedanceMedia.test.ts`  
  Unit tests for normalization, numbering, canonicalization, role defaults, stale token detection, and web-search validation.

- `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts`  
  Unit tests for candidate construction from current card, storyboard items, assets, audio, video segments, and user files.

- `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx`  
  Component tests for picker behavior, text snippets, media mentions, deletion, and token repair warning.

### Modify

- `new_html/services/videoService.ts`  
  Extend `SeedanceMediaInput`, `SeedanceParams`, and `submitSeedanceTask` for stable media IDs, source metadata, mention metadata, and optional `tools`.

- `new_html/components/SeedanceMultimodalPanel.tsx`  
  Replace raw textarea with `SeedanceMentionPromptEditor`; add intent buttons, candidate props, web-search disabled state, and improved media tray display.

- `new_html/components/VideoPage.tsx`  
  Accept episode context props, build per-group Seedance candidates, normalize params at the boundary, submit canonical prompt and tools.

- `new_html/pages/VideoGenPage.tsx`  
  Load `storyboardItems`, `assets`, `audioTracks`, `characterVoices`, and `videoSegments`; pass them into `VideoPage`.

- `cluster_main.py` and `deploy/cluster_main.py`  
  Add `tools` to `GenerateRequest`; reject Seedance web search when media exists; persist `tools` into task data.

- `worker.py` and `deploy/worker.py`  
  Read `tools` from task data and pass it into the Seedance client for pure-text tasks.

- `seedance_api.py` and `deploy/seedance_api.py`  
  Add optional `tools` to `create_video_task` payload.

- `docs/frontend.md`, `docs/api.md`, `docs/backend.md`, `docs/vertical-slices.md`, `docs/faq.md` and matching `deploy/docs/*` mirrors where present.  
  Document new prompt mention behavior, `/api/generate.tools`, backend pass-through, upstream episode slice data flow, and Seedance prompt reference gotcha.

---

## Task 1: Backend Seedance Web Search Pass-Through

**Files:**
- Modify: `cluster_main.py`
- Modify: `deploy/cluster_main.py`
- Modify: `worker.py`
- Modify: `deploy/worker.py`
- Modify: `seedance_api.py`
- Modify: `deploy/seedance_api.py`

- [ ] **Step 1: Run impact checks**

Run:

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "cluster_main.py" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "worker.py" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "seedance_api.py" --brief
```

Expected: `cluster_main.py` reports `/api/generate`; `worker.py` and `seedance_api.py` report Seedance/external video generation scope.

- [ ] **Step 2: Write a small backend test or smoke script for request validation**

If no existing backend pytest harness is available, create a temporary local smoke script during implementation and delete it before committing:

```python
from cluster_main import GenerateRequest

pure = GenerateRequest(task_type="seedance_t2v", prompt="玻璃蛙微距", tools=[{"type": "web_search"}])
assert pure.tools == [{"type": "web_search"}]

media = GenerateRequest(
    task_type="seedance_multi",
    prompt="参考图片1",
    media_inputs=[{"kind": "image", "url": "/storage/image/a.png", "role": "reference_image"}],
    tools=[{"type": "web_search"}],
)
assert media.tools == [{"type": "web_search"}]
```

Run:

```powershell
python -c "from cluster_main import GenerateRequest; pure=GenerateRequest(task_type='seedance_t2v', prompt='玻璃蛙微距', tools=[{'type':'web_search'}]); assert pure.tools == [{'type':'web_search'}]; media=GenerateRequest(task_type='seedance_multi', prompt='参考图片1', media_inputs=[{'kind':'image','url':'/storage/image/a.png','role':'reference_image'}], tools=[{'type':'web_search'}]); assert media.tools == [{'type':'web_search'}]"
```

Expected before implementation: FAIL with validation error or missing `tools` field.

- [ ] **Step 3: Extend `GenerateRequest` in both cluster files**

In `cluster_main.py` and `deploy/cluster_main.py`, add this field near the Seedance fields:

```python
tools: Optional[List[Dict[str, Any]]] = Field(None, description="Seedance tools，例如 [{'type':'web_search'}]，仅纯文本输入允许")
```

- [ ] **Step 4: Validate Seedance web search in `/api/generate`**

In the route that builds `task_data`, normalize tools only for Seedance tasks. Add the following logic before enqueuing the task:

```python
tools = request.tools or None
if tools:
    allowed_tools = [{"type": "web_search"}]
    if tools != allowed_tools:
        raise HTTPException(status_code=400, detail="Seedance tools 仅支持 [{'type':'web_search'}]")
    if request.media_inputs:
        raise HTTPException(status_code=400, detail="联网搜索仅适用于 Seedance 纯文本输入，不能与图片/视频/音频同时使用")
```

Then include tools in `task_data`:

```python
if tools:
    task_data["tools"] = tools
```

Expected: media requests with tools fail early; pure text requests keep `tools` in task data.

- [ ] **Step 5: Extend `SeedanceClient.create_video_task`**

In `seedance_api.py` and `deploy/seedance_api.py`, update the signature:

```python
def create_video_task(
    self,
    sub_model: str,
    contents: List[Dict[str, Any]],
    resolution: Optional[str] = None,
    ratio: Optional[str] = "adaptive",
    duration: Optional[int] = None,
    seed: Optional[int] = -1,
    watermark: bool = False,
    generate_audio: bool = True,
    camera_fixed: bool = False,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> str:
```

Add payload assignment after `payload["camera_fixed"] = camera_fixed`:

```python
if tools:
    payload["tools"] = tools
```

- [ ] **Step 6: Pass tools through `worker._process_seedance_task`**

In `worker.py` and `deploy/worker.py`, read tools after `media_inputs`:

```python
tools = task.data.get('tools') or None
if tools and media_inputs:
    raise ValueError("Seedance 联网搜索仅适用于纯文本输入，不能与 media_inputs 同时使用")
```

Add tools into `kwargs` only when present:

```python
kwargs = dict(
    resolution=task.data.get('resolution'),
    ratio=task.data.get('ratio', 'adaptive'),
    duration=task.data.get('duration'),
    seed=task.data.get('seed', -1),
    watermark=bool(task.data.get('watermark', False)),
    generate_audio=bool(task.data.get('generate_audio', True)),
    camera_fixed=bool(task.data.get('camera_fixed', False)),
)
if tools:
    kwargs['tools'] = tools
```

- [ ] **Step 7: Re-run backend smoke check**

Run:

```powershell
python -c "from cluster_main import GenerateRequest; pure=GenerateRequest(task_type='seedance_t2v', prompt='玻璃蛙微距', tools=[{'type':'web_search'}]); assert pure.tools == [{'type':'web_search'}]"
```

Expected: PASS.

- [ ] **Step 8: Commit backend pass-through**

Run:

```powershell
git add cluster_main.py deploy/cluster_main.py worker.py deploy/worker.py seedance_api.py deploy/seedance_api.py
git commit -m "feat(seedance): pass through web search tools"
```

---

## Task 2: Seedance Media Normalization and Mention Utilities

**Files:**
- Create: `new_html/utils/seedanceMedia.ts`
- Create: `new_html/__tests__/utils/seedanceMedia.test.ts`
- Modify: `new_html/services/videoService.ts`

- [ ] **Step 1: Run impact check**

Run:

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/services/videoService.ts" --brief
```

Expected: shared service warning; treat exported type changes as public frontend API.

- [ ] **Step 2: Write failing utility tests**

Create `new_html/__tests__/utils/seedanceMedia.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildCanonicalSeedancePrompt,
  getSeedanceMediaReference,
  normalizeSeedanceMediaInputs,
  validateSeedanceTools,
} from '../../utils/seedanceMedia';

describe('seedanceMedia', () => {
  it('fills missing ids and labels without changing existing urls or roles', () => {
    const result = normalizeSeedanceMediaInputs([
      { kind: 'image', url: '/storage/image/a.png', role: 'reference_image' },
      { id: 'm-existing', kind: 'audio', url: '/storage/audio/a.mp3', role: 'reference_audio', label: '旁白' },
    ] as any);

    expect(result[0].id).toMatch(/^seedance_media_/);
    expect(result[0].label).toBe('a.png');
    expect(result[0].role).toBe('reference_image');
    expect(result[1].id).toBe('m-existing');
    expect(result[1].label).toBe('旁白');
  });

  it('computes modality-specific references', () => {
    const media = normalizeSeedanceMediaInputs([
      { kind: 'image', url: '/a.png' },
      { kind: 'video', url: '/a.mp4' },
      { kind: 'image', url: '/b.png' },
      { kind: 'audio', url: '/a.mp3' },
    ] as any);

    expect(getSeedanceMediaReference(media, media[0].id)).toBe('图片1');
    expect(getSeedanceMediaReference(media, media[1].id)).toBe('视频1');
    expect(getSeedanceMediaReference(media, media[2].id)).toBe('图片2');
    expect(getSeedanceMediaReference(media, media[3].id)).toBe('音频1');
  });

  it('canonicalizes known mention labels to Seedance references', () => {
    const media = normalizeSeedanceMediaInputs([
      { id: 'img1', kind: 'image', url: '/a.png', label: '小美' },
      { id: 'vid1', kind: 'video', url: '/a.mp4', label: '参考片段' },
    ] as any);
    const prompt = '让 @小美(图片1) 走进 @参考片段(视频1) 的运镜里';

    expect(buildCanonicalSeedancePrompt(prompt, [
      { id: 'mention-1', candidateId: 'c1', mediaInputId: 'img1', label: '小美', kind: 'image' },
      { id: 'mention-2', candidateId: 'c2', mediaInputId: 'vid1', label: '参考片段', kind: 'video' },
    ], media)).toBe('让 图片1 走进 视频1 的运镜里');
  });

  it('requires web search to be pure text', () => {
    expect(validateSeedanceTools(true, [])).toEqual({ ok: true, msg: '' });
    expect(validateSeedanceTools(true, [{ kind: 'image', url: '/a.png' }] as any)).toEqual({
      ok: false,
      msg: '联网搜索仅适用于纯文本输入',
    });
  });
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```powershell
cd new_html; npm test -- --run __tests__/utils/seedanceMedia.test.ts
```

Expected: FAIL because `new_html/utils/seedanceMedia.ts` does not exist.

- [ ] **Step 4: Extend frontend Seedance types**

In `new_html/services/videoService.ts`, update `SeedanceMediaInput` and `SeedanceParams`:

```ts
export interface SeedanceMediaInput {
    id?: string;
    kind: SeedanceMediaKind;
    url: string;
    role?: SeedanceMediaRole;
    file_id?: string;
    label?: string;
    source?: 'current_card' | 'storyboard' | 'asset' | 'audio_track' | 'character_voice' | 'video_segment' | 'user_file' | 'ark_asset';
    source_id?: string;
}

export interface SeedancePromptMention {
    id: string;
    candidateId: string;
    mediaInputId: string;
    label: string;
    kind: SeedanceMediaKind;
}

export interface SeedanceParams {
    sub_model: 'standard' | 'fast';
    prompt: string;
    media_inputs: SeedanceMediaInput[];
    mentions?: SeedancePromptMention[];
    enable_web_search?: boolean;
    resolution?: '480p' | '720p' | '1080p';
    ratio?: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9';
    duration?: number;
    seed?: number;
    watermark?: boolean;
    generate_audio?: boolean;
    camera_fixed?: boolean;
}
```

- [ ] **Step 5: Implement `seedanceMedia.ts`**

Create `new_html/utils/seedanceMedia.ts`:

```ts
import type { SeedanceMediaInput, SeedancePromptMention } from '../services/videoService';

export function makeSeedanceMediaId(index: number, url: string): string {
  const tail = (url || 'media').split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'media';
  return `seedance_media_${index}_${tail}`;
}

export function mediaLabelFromUrl(url: string): string {
  const clean = (url || '').split('?')[0];
  return clean.split('/').pop() || clean || '素材';
}

export function normalizeSeedanceMediaInputs(media: SeedanceMediaInput[]): Required<Pick<SeedanceMediaInput, 'id'>>[] & SeedanceMediaInput[] {
  return (media || []).map((item, index) => ({
    ...item,
    id: item.id || makeSeedanceMediaId(index, item.url),
    label: item.label || mediaLabelFromUrl(item.url),
  })) as Required<Pick<SeedanceMediaInput, 'id'>>[] & SeedanceMediaInput[];
}

export function getSeedanceMediaReference(media: SeedanceMediaInput[], mediaInputId: string): string {
  const normalized = normalizeSeedanceMediaInputs(media);
  const target = normalized.find(item => item.id === mediaInputId);
  if (!target) return '';
  const sameKind = normalized.filter(item => item.kind === target.kind);
  const index = sameKind.findIndex(item => item.id === mediaInputId) + 1;
  if (target.kind === 'image') return `图片${index}`;
  if (target.kind === 'video') return `视频${index}`;
  return `音频${index}`;
}

export function buildVisibleMentionLabel(mention: SeedancePromptMention, media: SeedanceMediaInput[]): string {
  const ref = getSeedanceMediaReference(media, mention.mediaInputId);
  return `@${mention.label}(${ref})`;
}

export function buildCanonicalSeedancePrompt(
  visiblePrompt: string,
  mentions: SeedancePromptMention[] = [],
  media: SeedanceMediaInput[] = [],
): string {
  let result = visiblePrompt || '';
  for (const mention of mentions) {
    const visible = buildVisibleMentionLabel(mention, media);
    const ref = getSeedanceMediaReference(media, mention.mediaInputId);
    if (visible && ref) result = result.split(visible).join(ref);
  }
  return result;
}

export function findStaleMentionLabels(
  visiblePrompt: string,
  mentions: SeedancePromptMention[] = [],
  media: SeedanceMediaInput[] = [],
): string[] {
  return mentions
    .map(mention => buildVisibleMentionLabel(mention, media))
    .filter(label => label && !visiblePrompt.includes(label));
}

export function validateSeedanceTools(enableWebSearch: boolean | undefined, media: SeedanceMediaInput[]): { ok: boolean; msg: string } {
  if (enableWebSearch && media.length > 0) {
    return { ok: false, msg: '联网搜索仅适用于纯文本输入' };
  }
  return { ok: true, msg: '' };
}
```

- [ ] **Step 6: Run utility tests**

Run:

```powershell
cd new_html; npm test -- --run __tests__/utils/seedanceMedia.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit media utilities**

Run:

```powershell
git add new_html/services/videoService.ts new_html/utils/seedanceMedia.ts new_html/__tests__/utils/seedanceMedia.test.ts
git commit -m "feat(seedance): add mention media utilities"
```

---

## Task 3: Seedance Candidate Builder

**Files:**
- Create: `new_html/utils/seedanceCandidateBuilder.ts`
- Create: `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts`

- [ ] **Step 1: Write failing candidate tests**

Create `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSeedanceCandidates } from '../../utils/seedanceCandidateBuilder';

describe('buildSeedanceCandidates', () => {
  it('prioritizes current card image and result video', () => {
    const result = buildSeedanceCandidates({
      group: { uuid: 'group-1', ids: ['shot-1'], model: 'Seedance2' } as any,
      uploadedImages: [{ id: 'shot-1', url: '/storage/image/shot.png', filename: 'shot.png', uploadTime: 1 }] as any,
      tasksStatus: { 'group-1': { state: 'done', videos: ['/storage/video/out.mp4'] } } as any,
      imagePrompts: { 'shot-1': '原始图片提示词' },
      storyboardItems: [],
      assets: [],
      audioTracks: [],
      characterVoices: [],
      videoSegments: [],
      userFiles: [],
    });

    expect(result.currentCard.map(c => c.kind)).toEqual(['image', 'video', 'text']);
    expect(result.currentCard[0].label).toContain('shot.png');
    expect(result.currentCard[1].url).toBe('/storage/video/out.mp4');
  });

  it('builds storyboard image, text, and audio candidates', () => {
    const result = buildSeedanceCandidates({
      group: { uuid: 'group-1', ids: [], model: 'Seedance2' } as any,
      uploadedImages: [],
      tasksStatus: {},
      imagePrompts: {},
      storyboardItems: [{
        itemId: 'item-1',
        sortOrder: 2,
        sceneHeading: '室内',
        actionText: '角色推门',
        dialogue: '你好',
        imagePrompt: '明亮室内',
        videoPrompt: '镜头推进',
        generatedImageUrl: '/storage/image/generated.png',
        dialogueAudioUrl: '/storage/audio/dialogue.mp3',
        narrationAudioUrl: null,
        boundAssets: [],
      }] as any,
      assets: [],
      audioTracks: [],
      characterVoices: [],
      videoSegments: [],
      userFiles: [],
    });

    expect(result.storyboard.some(c => c.kind === 'image')).toBe(true);
    expect(result.storyboard.some(c => c.kind === 'audio')).toBe(true);
    expect(result.storyboard.some(c => c.kind === 'text' && c.metadata?.text === '镜头推进')).toBe(true);
  });

  it('prefers asset entity files over legacy reference images', () => {
    const result = buildSeedanceCandidates({
      group: { uuid: 'group-1', ids: [], model: 'Seedance2' } as any,
      uploadedImages: [],
      tasksStatus: {},
      imagePrompts: {},
      storyboardItems: [],
      assets: [{
        assetId: 'asset-1',
        assetType: 'character',
        name: '小美',
        thumbnailUrl: '/legacy/thumb.png',
        referenceImages: ['/legacy/ref.png'],
        entityFiles: [{ fileId: 'file-1', fileUrl: '/storage/image/entity.png', fileRole: 'reference_image', fileType: 'image', isSelected: true, createdAt: '2026-05-16' }],
      }] as any,
      audioTracks: [],
      characterVoices: [],
      videoSegments: [],
      userFiles: [],
    });

    expect(result.assets[0].url).toBe('/storage/image/entity.png');
    expect(result.assets[0].label).toContain('小美');
  });
});
```

- [ ] **Step 2: Run candidate tests and confirm failure**

Run:

```powershell
cd new_html; npm test -- --run __tests__/utils/seedanceCandidateBuilder.test.ts
```

Expected: FAIL because `seedanceCandidateBuilder.ts` does not exist.

- [ ] **Step 3: Implement candidate builder**

Create `new_html/utils/seedanceCandidateBuilder.ts`:

```ts
import type { EntityFile } from '../services/entityFileService';
import type { SeedanceMediaRole, TaskGroup, TaskStatus, UploadedImage } from '../services/videoService';
import type { AssetItem, AudioTrack, CharacterVoice, StoryboardItemDB, VideoSegment } from '../types';

export type SeedanceAssetCandidateKind = 'image' | 'video' | 'audio' | 'text';
export type SeedanceAssetCandidateSource =
  | 'current_card'
  | 'storyboard'
  | 'asset'
  | 'audio_track'
  | 'character_voice'
  | 'video_segment'
  | 'user_file'
  | 'ark_asset';

export interface SeedanceAssetCandidate {
  id: string;
  kind: SeedanceAssetCandidateKind;
  label: string;
  url?: string;
  fileId?: string;
  source: SeedanceAssetCandidateSource;
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

export interface SeedanceCandidateGroups {
  currentCard: SeedanceAssetCandidate[];
  storyboard: SeedanceAssetCandidate[];
  assets: SeedanceAssetCandidate[];
  audio: SeedanceAssetCandidate[];
  videos: SeedanceAssetCandidate[];
  userFiles: SeedanceAssetCandidate[];
}

export interface BuildSeedanceCandidatesInput {
  group: TaskGroup;
  uploadedImages: UploadedImage[];
  tasksStatus: Record<string, TaskStatus>;
  imagePrompts: Record<string, string>;
  storyboardItems: StoryboardItemDB[];
  assets: AssetItem[];
  audioTracks: AudioTrack[];
  characterVoices: CharacterVoice[];
  videoSegments: VideoSegment[];
  userFiles?: EntityFile[];
}

function fileName(url: string): string {
  return (url || '').split('?')[0].split('/').pop() || url || '素材';
}

function pushText(list: SeedanceAssetCandidate[], id: string, label: string, text?: string, metadata: SeedanceAssetCandidate['metadata'] = {}) {
  if (!text?.trim()) return;
  list.push({ id, kind: 'text', label, source: 'storyboard', metadata: { ...metadata, text } });
}

export function buildSeedanceCandidates(input: BuildSeedanceCandidatesInput): SeedanceCandidateGroups {
  const currentCard: SeedanceAssetCandidate[] = [];
  const storyboard: SeedanceAssetCandidate[] = [];
  const assets: SeedanceAssetCandidate[] = [];
  const audio: SeedanceAssetCandidate[] = [];
  const videos: SeedanceAssetCandidate[] = [];
  const userFiles: SeedanceAssetCandidate[] = [];

  for (const imageId of input.group.ids || []) {
    const image = input.uploadedImages.find(i => i.id === imageId);
    if (image?.url) {
      currentCard.push({
        id: `current_card:image:${image.id}`,
        kind: 'image',
        label: image.filename || fileName(image.url),
        url: image.url,
        source: 'current_card',
        roleHint: 'reference_image',
        previewUrl: image.url,
      });
    }
    const prompt = input.imagePrompts[imageId];
    if (prompt) {
      currentCard.push({ id: `current_card:text:${imageId}`, kind: 'text', label: '当前卡片提示词', source: 'current_card', metadata: { text: prompt } });
    }
  }

  for (const url of input.tasksStatus[input.group.uuid]?.videos || []) {
    currentCard.push({ id: `current_card:video:${url}`, kind: 'video', label: fileName(url), url, source: 'current_card', roleHint: 'reference_video' });
  }

  for (const item of input.storyboardItems || []) {
    const order = (item.sortOrder ?? 0) + 1;
    if (item.generatedImageUrl) {
      storyboard.push({ id: `storyboard:image:${item.itemId}`, kind: 'image', label: `分镜 ${order} 画面`, url: item.generatedImageUrl, source: 'storyboard', roleHint: 'reference_image', previewUrl: item.generatedImageUrl, metadata: { storyboardItemId: item.itemId, sortOrder: item.sortOrder } });
    }
    if (item.dialogueAudioUrl) {
      storyboard.push({ id: `storyboard:audio:dialogue:${item.itemId}`, kind: 'audio', label: `分镜 ${order} 台词音频`, url: item.dialogueAudioUrl, source: 'storyboard', roleHint: 'reference_audio', metadata: { storyboardItemId: item.itemId, sortOrder: item.sortOrder } });
    }
    if (item.narrationAudioUrl) {
      storyboard.push({ id: `storyboard:audio:narration:${item.itemId}`, kind: 'audio', label: `分镜 ${order} 旁白音频`, url: item.narrationAudioUrl, source: 'storyboard', roleHint: 'reference_audio', metadata: { storyboardItemId: item.itemId, sortOrder: item.sortOrder } });
    }
    pushText(storyboard, `storyboard:text:video:${item.itemId}`, `分镜 ${order} 视频提示词`, item.videoPrompt, { storyboardItemId: item.itemId, sortOrder: item.sortOrder });
    pushText(storyboard, `storyboard:text:image:${item.itemId}`, `分镜 ${order} 图片提示词`, item.imagePrompt, { storyboardItemId: item.itemId, sortOrder: item.sortOrder });
    pushText(storyboard, `storyboard:text:dialogue:${item.itemId}`, `分镜 ${order} 台词`, item.dialogue, { storyboardItemId: item.itemId, sortOrder: item.sortOrder });
  }

  for (const asset of input.assets || []) {
    const entityImages = (asset.entityFiles || []).filter(f => f.fileRole === 'reference_image' && f.fileUrl);
    const urls = entityImages.length > 0
      ? entityImages.map(f => ({ url: f.fileUrl, fileId: f.fileId }))
      : [...(asset.thumbnailUrl ? [asset.thumbnailUrl] : []), ...(asset.referenceImages || [])].filter(Boolean).map(url => ({ url }));
    urls.forEach((entry, index) => {
      assets.push({ id: `asset:image:${asset.assetId}:${index}`, kind: 'image', label: `${asset.name} ${index + 1}`, url: entry.url, fileId: entry.fileId, source: 'asset', roleHint: 'reference_image', previewUrl: entry.url, metadata: { assetId: asset.assetId, assetType: asset.assetType } });
    });
  }

  for (const track of input.audioTracks || []) {
    if (track.audioUrl) audio.push({ id: `audio_track:${track.trackId}`, kind: 'audio', label: track.name || track.trackType || '音频轨', url: track.audioUrl, source: 'audio_track', roleHint: 'reference_audio' });
  }
  for (const voice of input.characterVoices || []) {
    if (voice.sampleAudioUrl) audio.push({ id: `character_voice:${voice.voiceId}`, kind: 'audio', label: `${voice.characterName} 音色`, url: voice.sampleAudioUrl, source: 'character_voice', roleHint: 'reference_audio' });
  }

  for (const segment of input.videoSegments || []) {
    if (segment.videoUrl) videos.push({ id: `video_segment:${segment.segmentId}`, kind: 'video', label: `视频段 ${segment.sortOrder + 1}`, url: segment.videoUrl, source: 'video_segment', roleHint: 'reference_video', previewUrl: segment.thumbnailUrl || undefined });
  }

  for (const file of input.userFiles || []) {
    const kind = file.fileType?.startsWith('video') ? 'video' : file.fileType?.startsWith('audio') ? 'audio' : 'image';
    userFiles.push({ id: `user_file:${file.fileId}`, kind, label: fileName(file.fileUrl), url: file.fileUrl, fileId: file.fileId, source: 'user_file', roleHint: kind === 'audio' ? 'reference_audio' : kind === 'video' ? 'reference_video' : 'reference_image', previewUrl: kind === 'image' ? file.fileUrl : undefined });
  }

  return { currentCard, storyboard, assets, audio, videos, userFiles };
}
```

- [ ] **Step 4: Run candidate tests**

Run:

```powershell
cd new_html; npm test -- --run __tests__/utils/seedanceCandidateBuilder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit candidate builder**

Run:

```powershell
git add new_html/utils/seedanceCandidateBuilder.ts new_html/__tests__/utils/seedanceCandidateBuilder.test.ts
git commit -m "feat(seedance): build asset mention candidates"
```

---

## Task 4: Mention Prompt Editor Component

**Files:**
- Create: `new_html/components/SeedanceMentionPromptEditor.tsx`
- Create: `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SeedanceMentionPromptEditor } from '../../components/SeedanceMentionPromptEditor';

const candidates = {
  currentCard: [{ id: 'c-img', kind: 'image', label: '当前分镜', url: '/a.png', source: 'current_card', roleHint: 'reference_image' }],
  storyboard: [{ id: 'c-text', kind: 'text', label: '视频提示词', source: 'storyboard', metadata: { text: '镜头缓慢推进' } }],
  assets: [],
  audio: [{ id: 'c-audio', kind: 'audio', label: '旁白音色', url: '/a.mp3', source: 'character_voice', roleHint: 'reference_audio' }],
  videos: [],
  userFiles: [],
} as any;

describe('SeedanceMentionPromptEditor', () => {
  it('inserts image mention and media input', () => {
    const onChange = vi.fn();
    render(<SeedanceMentionPromptEditor prompt="" mediaInputs={[]} mentions={[]} candidates={candidates} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Seedance 提示词'), { target: { value: '@' } });
    fireEvent.click(screen.getByText('当前分镜'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '@当前分镜(图片1)',
      mediaInputs: [expect.objectContaining({ kind: 'image', url: '/a.png', role: 'reference_image' })],
      mentions: [expect.objectContaining({ label: '当前分镜', kind: 'image' })],
    }));
  });

  it('inserts text candidate as snippet only', () => {
    const onChange = vi.fn();
    render(<SeedanceMentionPromptEditor prompt="开头 " mediaInputs={[]} mentions={[]} candidates={candidates} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Seedance 提示词'), { target: { value: '开头 @' } });
    fireEvent.click(screen.getByText('视频提示词'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '开头 镜头缓慢推进',
      mediaInputs: [],
      mentions: [],
    }));
  });
});
```

- [ ] **Step 2: Run component tests and confirm failure**

Run:

```powershell
cd new_html; npm test -- --run __tests__/components/SeedanceMentionPromptEditor.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the editor component**

Create `new_html/components/SeedanceMentionPromptEditor.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import type { SeedanceMediaInput, SeedancePromptMention } from '../services/videoService';
import type { SeedanceAssetCandidate, SeedanceCandidateGroups } from '../utils/seedanceCandidateBuilder';
import { buildVisibleMentionLabel, findStaleMentionLabels, normalizeSeedanceMediaInputs } from '../utils/seedanceMedia';

interface Props {
  prompt: string;
  mediaInputs: SeedanceMediaInput[];
  mentions: SeedancePromptMention[];
  candidates: SeedanceCandidateGroups;
  disabled?: boolean;
  onChange: (next: { prompt: string; mediaInputs: SeedanceMediaInput[]; mentions: SeedancePromptMention[] }) => void;
}

const GROUP_LABELS: Array<[keyof SeedanceCandidateGroups, string]> = [
  ['currentCard', '当前卡片'],
  ['storyboard', '当前分镜'],
  ['assets', '角色 / 场景 / 道具'],
  ['audio', '音频 / 音色'],
  ['videos', '已有视频'],
  ['userFiles', '历史文件'],
];

export const SeedanceMentionPromptEditor: React.FC<Props> = ({
  prompt,
  mediaInputs,
  mentions,
  candidates,
  disabled,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const normalizedMedia = useMemo(() => normalizeSeedanceMediaInputs(mediaInputs), [mediaInputs]);
  const staleLabels = useMemo(() => findStaleMentionLabels(prompt, mentions, normalizedMedia), [prompt, mentions, normalizedMedia]);

  const handlePromptChange = (value: string) => {
    setOpen(value.endsWith('@') || value.includes('@'));
    onChange({ prompt: value, mediaInputs: normalizedMedia, mentions });
  };

  const selectCandidate = (candidate: SeedanceAssetCandidate) => {
    if (candidate.kind === 'text') {
      const snippet = candidate.metadata?.text || '';
      const nextPrompt = prompt.replace(/@$/, '') + snippet;
      onChange({ prompt: nextPrompt, mediaInputs: normalizedMedia, mentions });
      setOpen(false);
      return;
    }

    const media: SeedanceMediaInput = {
      id: `seedance_media_${Date.now()}_${candidate.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      kind: candidate.kind,
      url: candidate.url || '',
      role: candidate.roleHint,
      file_id: candidate.fileId,
      label: candidate.label,
      source: candidate.source,
      source_id: candidate.id,
    };
    const nextMedia = normalizeSeedanceMediaInputs([...normalizedMedia, media]);
    const mention: SeedancePromptMention = {
      id: `seedance_mention_${Date.now()}_${candidate.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      candidateId: candidate.id,
      mediaInputId: media.id!,
      label: candidate.label,
      kind: candidate.kind,
    };
    const visible = buildVisibleMentionLabel(mention, nextMedia);
    const nextPrompt = prompt.replace(/@$/, '') + visible;
    onChange({ prompt: nextPrompt, mediaInputs: nextMedia, mentions: [...mentions, mention] });
    setOpen(false);
  };

  return (
    <div className="relative space-y-1">
      <textarea
        aria-label="Seedance 提示词"
        value={prompt}
        disabled={disabled}
        onChange={event => handlePromptChange(event.target.value)}
        placeholder="输入 @ 选择素材，或描述动作、镜头、声音、剪辑意图..."
        className="w-full bg-black/30 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none resize-none h-16"
      />
      {staleLabels.length > 0 && (
        <div className="text-[10px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded px-2 py-1">
          有素材标签已被手动修改或删除，请同步标签后再提交。
        </div>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-cyan-800/40 bg-slate-950 shadow-xl">
          {GROUP_LABELS.map(([key, label]) => {
            const list = candidates[key] || [];
            if (list.length === 0) return null;
            return (
              <div key={key} className="border-b border-slate-800 last:border-b-0">
                <div className="px-2 py-1 text-[10px] text-cyan-300 bg-cyan-950/20">{label}</div>
                {list.map(candidate => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => selectCandidate(candidate)}
                    className="w-full flex items-center justify-between px-2 py-1 text-left text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    <span className="truncate">{candidate.label}</span>
                    <span className="ml-2 text-[9px] text-slate-500">{candidate.kind}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Run editor tests**

Run:

```powershell
cd new_html; npm test -- --run __tests__/components/SeedanceMentionPromptEditor.test.tsx
```

Expected: PASS. If Testing Library cannot find Chinese labels because of nested markup, adjust queries to `getByRole('textbox', { name: 'Seedance 提示词' })`.

- [ ] **Step 5: Commit editor component**

Run:

```powershell
git add new_html/components/SeedanceMentionPromptEditor.tsx new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx
git commit -m "feat(seedance): add prompt mention editor"
```

---

## Task 5: Seedance Panel Integration

**Files:**
- Modify: `new_html/components/SeedanceMultimodalPanel.tsx`
- Modify: `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx`

- [ ] **Step 1: Run impact check**

Run:

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/SeedanceMultimodalPanel.tsx" --brief
```

Expected: component affects `VideoPage`.

- [ ] **Step 2: Add failing panel tests for intent buttons and web search**

Append to `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx`:

```tsx
it('shows Seedance intent buttons', () => {
    render(<SeedanceMultimodalPanel value={baseParams} onChange={vi.fn()} candidates={{
        currentCard: [], storyboard: [], assets: [], audio: [], videos: [], userFiles: [],
    }} />);

    expect(screen.getByText('参考生成')).toBeInTheDocument();
    expect(screen.getByText('编辑视频')).toBeInTheDocument();
    expect(screen.getByText('延长视频')).toBeInTheDocument();
    expect(screen.getByText('联网搜索')).toBeInTheDocument();
});

it('disables web search when media exists', () => {
    render(
        <SeedanceMultimodalPanel
            value={{ ...baseParams, media_inputs: [{ kind: 'image', url: '/storage/image/a.png', role: 'reference_image' }] }}
            onChange={vi.fn()}
            candidates={{ currentCard: [], storyboard: [], assets: [], audio: [], videos: [], userFiles: [] }}
        />
    );

    expect(screen.getByText('联网搜索仅适用于纯文本输入')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run panel tests and confirm failure**

Run:

```powershell
cd new_html; npm test -- --run __tests__/components/SeedanceMultimodalPanel.test.tsx
```

Expected: FAIL because `candidates` prop and intent buttons do not exist.

- [ ] **Step 4: Extend panel props**

In `SeedanceMultimodalPanel.tsx`, add imports:

```ts
import { SeedanceMentionPromptEditor } from './SeedanceMentionPromptEditor';
import type { SeedanceCandidateGroups } from '../utils/seedanceCandidateBuilder';
import { normalizeSeedanceMediaInputs, validateSeedanceTools } from '../utils/seedanceMedia';
```

Extend `Props`:

```ts
interface Props {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates?: SeedanceCandidateGroups;
    disabled?: boolean;
}
```

Add default candidate groups:

```ts
const EMPTY_CANDIDATES: SeedanceCandidateGroups = {
    currentCard: [],
    storyboard: [],
    assets: [],
    audio: [],
    videos: [],
    userFiles: [],
};
```

- [ ] **Step 5: Replace prompt textarea with mention editor**

Replace the current prompt `<textarea>` section with:

```tsx
<SeedanceMentionPromptEditor
    prompt={value.prompt}
    mediaInputs={value.media_inputs}
    mentions={value.mentions || []}
    candidates={candidates || EMPTY_CANDIDATES}
    disabled={disabled}
    onChange={(next) => patch({
        prompt: next.prompt,
        media_inputs: normalizeSeedanceMediaInputs(next.mediaInputs),
        mentions: next.mentions,
    })}
/>
```

- [ ] **Step 6: Add intent row and web search toggle**

Add an intent section above media inputs:

```tsx
<section className="space-y-2">
    <div className="grid grid-cols-4 gap-1 text-[10px]">
        {['参考生成', '编辑视频', '延长视频'].map(label => (
            <button
                key={label}
                type="button"
                disabled={disabled}
                onClick={() => patch({ prompt: value.prompt ? value.prompt : label === '编辑视频' ? '将视频1中的元素替换为图片1中的目标，运镜不变。' : label === '延长视频' ? '向后延长视频1，镜头继续推进到...' : '参考图片1的主体特征，结合视频1的运镜，生成...' })}
                className="rounded border border-cyan-800/40 bg-cyan-950/20 px-1.5 py-1 text-cyan-200 hover:bg-cyan-900/30 disabled:opacity-50"
            >
                {label}
            </button>
        ))}
        <button
            type="button"
            disabled={disabled || value.media_inputs.length > 0}
            onClick={() => patch({ enable_web_search: !value.enable_web_search })}
            className={`rounded border px-1.5 py-1 ${value.enable_web_search ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200' : 'border-slate-700 bg-slate-900/60 text-slate-300'} disabled:opacity-40`}
        >
            联网搜索
        </button>
    </div>
    {value.media_inputs.length > 0 && (
        <div className="text-[9px] text-slate-500">联网搜索仅适用于纯文本输入</div>
    )}
</section>
```

- [ ] **Step 7: Update validation with web search rule**

Inside `validation`, add:

```ts
const toolValidation = validateSeedanceTools(value.enable_web_search, value.media_inputs);
if (!toolValidation.ok) return toolValidation;
```

- [ ] **Step 8: Run panel tests**

Run:

```powershell
cd new_html; npm test -- --run __tests__/components/SeedanceMultimodalPanel.test.tsx __tests__/components/SeedanceMentionPromptEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit panel integration**

Run:

```powershell
git add new_html/components/SeedanceMultimodalPanel.tsx new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx
git commit -m "feat(seedance): integrate mention editor panel"
```

---

## Task 6: Video Page Context Wiring and Submit Canonicalization

**Files:**
- Modify: `new_html/pages/VideoGenPage.tsx`
- Modify: `new_html/components/VideoPage.tsx`
- Modify: `new_html/services/videoService.ts`

- [ ] **Step 1: Run impact checks**

Run:

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/pages/VideoGenPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/VideoPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/services/videoService.ts" --brief
```

Expected: `VideoPage` affects multiple pages and shared session behavior; keep changes scoped to Seedance props and submit path.

- [ ] **Step 2: Extend `VideoGenPage` slice loading**

Change:

```ts
const { episodeId, projectId, selectedScriptId, storyboardItems, isLoading, error, loadSlices } = useEpisode();
useEffect(() => {
  loadSlices('storyboardItems');
}, [loadSlices]);
```

To:

```ts
const {
  episodeId,
  projectId,
  selectedScriptId,
  storyboardItems,
  assets,
  audioTracks,
  characterVoices,
  videoSegments,
  isLoading,
  error,
  loadSlices,
} = useEpisode();

useEffect(() => {
  loadSlices('storyboardItems', 'assets', 'audioTracks', 'characterVoices', 'videoSegments');
}, [loadSlices]);
```

- [ ] **Step 3: Pass episode context into `VideoPage`**

Change:

```tsx
<VideoPage isActive={true} sessionScope={sessionScope} key={`${sessionScope}-${importDone}`} />
```

To:

```tsx
<VideoPage
  isActive={true}
  sessionScope={sessionScope}
  key={`${sessionScope}-${importDone}`}
  storyboardItems={storyboardItems}
  assets={assets}
  audioTracks={audioTracks}
  characterVoices={characterVoices}
  videoSegments={videoSegments}
/>
```

- [ ] **Step 4: Extend `VideoPageProps`**

In `VideoPage.tsx`, import required types:

```ts
import type { AssetItem, AudioTrack, CharacterVoice, StoryboardItemDB, VideoSegment } from '../types';
import { buildSeedanceCandidates } from '../utils/seedanceCandidateBuilder';
import { buildCanonicalSeedancePrompt, normalizeSeedanceMediaInputs } from '../utils/seedanceMedia';
```

Extend props:

```ts
interface VideoPageProps {
    onAddNotification?: (notification: Omit<TaskNotification, 'id' | 'timestamp'>) => string;
    onUpdateNotification?: (id: string, updates: Partial<TaskNotification>) => void;
    isActive?: boolean;
    sessionScope?: string;
    storyboardItems?: StoryboardItemDB[];
    assets?: AssetItem[];
    audioTracks?: AudioTrack[];
    characterVoices?: CharacterVoice[];
    videoSegments?: VideoSegment[];
}
```

Destructure defaults:

```ts
storyboardItems = [],
assets = [],
audioTracks = [],
characterVoices = [],
videoSegments = [],
```

- [ ] **Step 5: Normalize Seedance params at boundary**

Update `getSeedanceParams`:

```ts
const getSeedanceParams = useCallback((uuid: string, model: videoService.VideoModel): SeedanceParams => {
    const existing = seedanceParamsByUuid[uuid];
    if (existing) {
        return {
            ...existing,
            media_inputs: normalizeSeedanceMediaInputs(existing.media_inputs || []),
            mentions: existing.mentions || [],
        };
    }
    return {
        sub_model: model === 'Seedance2Fast' ? 'fast' : 'standard',
        prompt: '',
        media_inputs: [],
        mentions: [],
        enable_web_search: false,
        resolution: '720p',
        ratio: 'adaptive',
        duration: 5,
        seed: -1,
        watermark: false,
        generate_audio: true,
        camera_fixed: false,
    };
}, [seedanceParamsByUuid]);
```

- [ ] **Step 6: Build candidates per Seedance group**

Before rendering `SeedanceMultimodalPanel`, compute:

```ts
const candidates = buildSeedanceCandidates({
    group,
    uploadedImages,
    tasksStatus,
    imagePrompts,
    storyboardItems,
    assets,
    audioTracks,
    characterVoices,
    videoSegments,
    userFiles: [],
});
```

Pass it:

```tsx
<SeedanceMultimodalPanel
    value={getSeedanceParams(group.uuid, group.model)}
    onChange={(next) => setSeedanceParams(group.uuid, next)}
    candidates={candidates}
/>
```

Apply this in both list view and card view Seedance render sites.

- [ ] **Step 7: Submit canonical prompt and tools**

In Seedance branch of `runTask`, before `submitSeedanceTask`:

```ts
const normalizedParams: SeedanceParams = {
    ...params,
    media_inputs: normalizeSeedanceMediaInputs(params.media_inputs || []),
    prompt: buildCanonicalSeedancePrompt(params.prompt, params.mentions || [], params.media_inputs || []),
};
```

Submit `normalizedParams`.

- [ ] **Step 8: Add tools in `submitSeedanceTask`**

In `new_html/services/videoService.ts`, add:

```ts
if (params.enable_web_search) {
    body.tools = [{ type: 'web_search' }];
}
```

Place it after body construction and before `fetch`.

- [ ] **Step 9: Run frontend checks for affected tests**

Run:

```powershell
cd new_html; npm test -- --run __tests__/utils/seedanceMedia.test.ts __tests__/utils/seedanceCandidateBuilder.test.ts __tests__/components/SeedanceMultimodalPanel.test.tsx __tests__/components/SeedanceMentionPromptEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Run type check**

Run:

```powershell
cd new_html; npm run typecheck
```

If the project uses `tsc` directly instead of `typecheck`, run:

```powershell
cd new_html; npx tsc --noEmit
```

Expected: no TypeScript errors in touched files.

- [ ] **Step 11: Commit page wiring**

Run:

```powershell
git add new_html/pages/VideoGenPage.tsx new_html/components/VideoPage.tsx new_html/services/videoService.ts
git commit -m "feat(seedance): wire mentions into video page"
```

---

## Task 7: Documentation, Build, Project Memory, and Final Verification

**Files:**
- Modify: `docs/frontend.md`
- Modify: `docs/api.md`
- Modify: `docs/backend.md`
- Modify: `docs/vertical-slices.md`
- Modify: `docs/faq.md`
- Modify mirrors under `deploy/docs/` where matching files exist

- [ ] **Step 1: Update frontend documentation**

In `docs/frontend.md`, add a Seedance section that states:

```md
### Seedance `@` 素材引用

`VideoGenPage` 为 Seedance 加载 `storyboardItems / assets / audioTracks / characterVoices / videoSegments`，并传给 `VideoPage`。`SeedanceMultimodalPanel` 使用候选池支持 `@素材名(图片1)`、`@视频段(视频1)`、`@音色(音频1)`，提交前会转成 Ark 要求的 `图片n / 视频n / 音频n`。

文本候选只插入提示词片段，不加入 `media_inputs`。普通图片候选默认 `reference_image`；首尾帧必须显式选择或使用成对图片动作。
```

- [ ] **Step 2: Update API documentation**

In `docs/api.md`, update `/api/generate` Seedance fields:

```md
| Field | Type | Notes |
| --- | --- | --- |
| `tools` | `[{ type: "web_search" }]` | Seedance 2.0 only. Only allowed for pure text requests with no `media_inputs`. |
```

- [ ] **Step 3: Update backend documentation**

In `docs/backend.md`, add:

```md
### Seedance web search tools

`cluster_main.GenerateRequest.tools` accepts `[{ type: "web_search" }]` for Seedance pure-text tasks. `worker._process_seedance_task` passes `tools` to `SeedanceClient.create_video_task`, which forwards it to Ark as `payload.tools`.
```

- [ ] **Step 4: Update vertical slice documentation**

In `docs/vertical-slices.md`, update `VideoGenPage / VideoPage — 视频生成`:

```md
**Seedance `@` 候选池额外读取**:
- `storyboard_items`: 分镜图、`videoPrompt`、`imagePrompt`、`dialogue`、台词/旁白音频 URL
- `assets`: 角色/场景/道具参考图，优先 `entity_files`
- `audio_tracks`: 背景音乐 / 音效候选
- `character_voices`: 角色音色样本
- `video_segments`: 已有视频结果，用于编辑 / 延长
```

- [ ] **Step 5: Update FAQ**

In `docs/faq.md`, add:

```md
## Seedance prompt 里写了文件名或 asset ID，模型没有正确引用素材

**Symptom:** Seedance 输出没有使用预期素材，或者用户在 prompt 中写 `asset://...` / 文件名后效果不稳定。

**Root Cause:** Ark Seedance 2.0 要求 prompt 使用 `图片n / 视频n / 音频n` 指代请求 content 数组里的同类素材序号，不支持在 prompt 中直接用 asset ID 或文件名指代素材。

**Fix:** 前端 `@素材名(图片1)` 只作为可视标签；提交前转成 `图片1`。`asset://<asset ID>` 只放在 `content.<modality>_url.url` 中。

**Files:** `new_html/components/SeedanceMentionPromptEditor.tsx`, `new_html/utils/seedanceMedia.ts`, `new_html/components/SeedanceMultimodalPanel.tsx`
```

- [ ] **Step 6: Mirror docs**

For each changed doc with a matching `deploy/docs/<name>.md`, copy the same section into the mirror.

Run:

```powershell
Copy-Item "docs/frontend.md" "deploy/docs/frontend.md"
Copy-Item "docs/api.md" "deploy/docs/api.md"
Copy-Item "docs/backend.md" "deploy/docs/backend.md"
Copy-Item "docs/faq.md" "deploy/docs/faq.md"
```

If `deploy/docs/vertical-slices.md` does not exist, do not create it.

- [ ] **Step 7: Run full frontend verification**

Run:

```powershell
cd new_html; npm test -- --run __tests__/utils/seedanceMedia.test.ts __tests__/utils/seedanceCandidateBuilder.test.ts __tests__/components/SeedanceMultimodalPanel.test.tsx __tests__/components/SeedanceMentionPromptEditor.test.tsx
cd new_html; npx tsc --noEmit
cd new_html; npm run build
```

Expected:

- Vitest: all listed tests pass.
- TypeScript: no errors.
- Build: production assets generated successfully.

- [ ] **Step 8: Run project-memory gate**

Run:

```powershell
python ".claude/skills/project-memory/scripts/scan_project.py" "h:\MY2"
python ".claude/skills/project-memory/scripts/sync_check.py" "h:\MY2" --strict --levels ERROR
```

Expected: both commands exit 0.

- [ ] **Step 9: Run GitNexus detect changes before final commit**

Before committing final docs and any remaining changes, inspect MCP descriptors and call GitNexus detect changes according to project rules. If using the GitNexus CLI instead of MCP in this environment, run the equivalent project command:

```powershell
npx gitnexus analyze
```

Then use the available GitNexus detect-changes tool if present in Cursor MCP. Expected: affected symbols and flows are limited to Seedance video generation, `/api/generate`, VideoPage, and documentation.

- [ ] **Step 10: Commit docs and final verification changes**

Run:

```powershell
git add docs/frontend.md docs/api.md docs/backend.md docs/vertical-slices.md docs/faq.md deploy/docs/frontend.md deploy/docs/api.md deploy/docs/backend.md deploy/docs/faq.md context
git commit -m "docs(seedance): document asset mention workflow"
```

If `scan_project.py` changed only expected `context/*.json` files, include them. If it changed unrelated context files because of stale previous work, inspect before adding and include only expected updates.

---

## Final Manual QA Checklist

Run these checks in the browser after a successful build:

- [ ] Open Video page with existing storyboard images. Switch a card to `Seedance2`.
- [ ] Type `@`, select current card image, confirm visible prompt becomes `@当前分镜(图片1)` and media tray shows `图片1`.
- [ ] Select a character asset image, confirm it becomes `图片2` and defaults to `参考图`.
- [ ] Select a text candidate such as a storyboard `videoPrompt`, confirm it inserts text and does not add media.
- [ ] Select dialogue audio without any image/video, confirm validation blocks audio-only.
- [ ] Add an image plus dialogue audio, confirm validation passes.
- [ ] Select an existing generated video, choose `编辑视频`, confirm prompt helper preserves existing mentions.
- [ ] Clear all media, enable `联网搜索`, submit pure text, confirm backend request includes `tools`.
- [ ] Add any media, confirm `联网搜索` is disabled and cannot submit tools.
- [ ] Reorder or remove media, confirm visible labels and canonical prompt update or show token repair warning.

## Rollback Plan

If the feature breaks Seedance submission:

1. Revert only the commits from Tasks 2 through 6.
2. Keep Task 1 backend tools pass-through if pure text web search works independently.
3. If backend validation causes failures for existing Seedance calls, revert Task 1 as well.
4. Existing non-Seedance video models should remain unaffected because all UI and submit changes are gated behind `Seedance2` / `Seedance2Fast`.

## Self-Review

- Spec coverage: covered rich mentions, automatic numbering, candidate pool, intent buttons, pure-text web search, upstream page data relationships, validation, compatibility normalization, docs, and tests.
- Placeholder scan: this plan contains no unresolved placeholder markers or open-ended implementation placeholders.
- Type consistency: `SeedanceMediaInput`, `SeedancePromptMention`, `SeedanceAssetCandidate`, `SeedanceCandidateGroups`, `normalizeSeedanceMediaInputs`, `buildSeedanceCandidates`, and `SeedanceMentionPromptEditor` are introduced before later tasks use them.
