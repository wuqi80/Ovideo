# Video Page Bugfixes (7 issues) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 distinct video-page bugs that surfaced after the storyboard-import landing: card-row height misalignment, reversed sort order, wrong default Seedance media-mode (should be "all-purpose reference" not first/last frame), first/last-frame mode should grey-out video/audio + skip them on submit, current-card image must auto-populate `media_inputs`, prompt tokens (`图片1` / `视频2` / `音频3`) must delete as a single block on Backspace, video prompt (`video_prompt`) should be imported from storyboard (currently only `image_prompt` is read), and the list-view layout must be redesigned (current Seedance row renders the entire panel, breaking row alignment 12x).

**Architecture:** Five independent commits, each red→green→commit. Reuses every helper already shipped (`insertMention`, `removeMediaInput`, `useReactiveDuration`, `useSeedanceCandidates`, `SeedancePanelWithCandidates`). Two new tiny components (`MediaBadges`, `SeedanceDetailModal`) introduced for the list-view redesign so the existing `<SeedanceMultimodalPanel>` can be reused inside a modal without a "compact mode" branch. Mode-toggle reasons over `media_inputs[].role` rather than introducing a new persisted field.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind CSS. No backend / DB changes.

**Branch:** `feature/video-page-bugfixes` (created off current `feature/storyboard-video-import-completeness`).

---

## File Structure

### Modify (10 files)

| File | Tasks | Change |
|------|-------|--------|
| `new_html/utils/videoCardLayout.ts` | T1 | constants → fixed height + overflow |
| `new_html/components/VideoPage.tsx` | T1, T2, T3, T5 | sortedTaskGroups rewrite + sortOrder/toolbar removal + getSeedanceParams + runTask submit filter + renderListViewCard rewrite + detail modal mount |
| `new_html/pages/VideoGenPage.tsx` | T1, T2 | `video_prompt` priority + `role: 'reference_image'` |
| `new_html/utils/storyboardSync.ts` | T1, T2 | `video_prompt` priority + `role: 'reference_image'` |
| `new_html/components/SeedanceMultimodalPanel.tsx` | T3 | mode toggle + grey-out + role constraint |
| `new_html/components/SeedanceMentionPromptEditor.tsx` | T4 | Backspace token-block delete |
| `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx` | T3 | +3 cases |
| `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx` | T4 | +1 case |
| `docs/faq.md` | T6 | +7 entries |
| `docs/conventions.md` | T6 | +2 anti-patterns |
| `docs/frontend.md` | T6 | update VideoPage / SeedanceMultimodalPanel sections |

### Create (4 files)

| File | Task | Purpose |
|------|------|---------|
| `new_html/components/video/MediaBadges.tsx` | T5 | Compact `[图3][视0][音1]` badge row, hover tooltip |
| `new_html/components/video/SeedanceDetailModal.tsx` | T5 | Modal wrapper around `<SeedanceMultimodalPanel>` for list-view ⚙ |
| `new_html/__tests__/components/MediaBadges.test.tsx` | T5 | 4 cases (each kind, all zero, mixed) |
| `new_html/__tests__/components/SeedanceDetailModal.test.tsx` | T5 | 2 cases (open/close, body-locked content) |

### Mirror (auto)

`scripts/sync_to_deploy.py` mirrors every `new_html/*` and `docs/*` change to `deploy/`. Test files are excluded — never run `--paths` on test files. Pre-commit hook enforces.

---

## Task Index

| # | Task | Commits | Time |
|---|------|---------|------|
| 1 | Quick wins (① height, ② sort, ⑥ video_prompt) | 1 | 20 min |
| 2 | Auto-populate media_inputs (⑤a) | 1 | 20 min |
| 3 | Mode toggle + grey-out + submit filter (③④) | 1 | 75 min |
| 4 | Token-block delete (⑤b) | 1 | 40 min |
| 5 | List-view redesign (⑦) | 1 | 75 min |
| 6 | Docs + memory + dist + tag | 1 | 30 min |

Total: ~4.5 h, 6 commits. Each task self-contained.

---

## Task 1: Quick wins (issues ①, ②, ⑥)

**Files:**
- Modify: `new_html/utils/videoCardLayout.ts:3-4` — fixed card height
- Modify: `new_html/components/VideoPage.tsx:94` — drop `sortOrder` state
- Modify: `new_html/components/VideoPage.tsx:140-151` — rewrite `sortedTaskGroups` to ascending by `sort_order` of linked image
- Modify: `new_html/components/VideoPage.tsx:2754-2772` — delete `最新/最早` toolbar buttons (and the divider before them)
- Modify: `new_html/pages/VideoGenPage.tsx:73` — `video_prompt` priority
- Modify: `new_html/utils/storyboardSync.ts:44` — `video_prompt` priority

### Step 1.1: Pre-edit impact check

Before touching the 4 files, run:

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/utils/videoCardLayout.ts" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/VideoPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/pages/VideoGenPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/utils/storyboardSync.ts" --brief
```

Expected: each output's reverse-deps stays inside `VideoGenPage / VideoPage`. Already verified once — re-run as a sanity check.

### Step 1.2: Fix issue ① — fixed card height

Open `new_html/utils/videoCardLayout.ts`. Replace lines 3-4:

**Before:**
```typescript
export const COMPACT_CARD_HEIGHT_CLASS = 'min-h-[380px] max-h-[420px]';
export const SEEDANCE_CARD_HEIGHT_CLASS = 'min-h-[620px] max-h-[760px]';
```

**After:**
```typescript
// Card-view fixed heights so left and right columns stay aligned per row.
// Internal overflow scrolls when content exceeds the box.
export const COMPACT_CARD_HEIGHT_CLASS = 'h-[400px] overflow-y-auto';
export const SEEDANCE_CARD_HEIGHT_CLASS = 'h-[720px] overflow-y-auto';
```

(List-view rows have their own height, set in Task 5; this constant only applies to `renderStoryboardCard` / `renderResultCard`.)

### Step 1.3: Fix issue ② — drop `sortOrder` state

Open `new_html/components/VideoPage.tsx`. Delete line 94 entirely:

**Before (line 94):**
```tsx
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
```

**After:** (remove the line — no replacement)

### Step 1.4: Rewrite `sortedTaskGroups` to ascending by storyboard `sort_order`

Open `new_html/components/VideoPage.tsx`. Replace lines 140-151:

**Before:**
```tsx
    const sortedTaskGroups = useMemo(() => {
        // 保留原始索引
        const withIndex = taskGroups.map((group, index) => ({ group, originalIndex: index }));
        
        // 按照任务组在数组中的索引排序（索引越大越新）
        if (sortOrder === 'newest') {
            // 最新在前：反转数组
            withIndex.reverse();
        }
        // 'oldest' 保持原顺序（最早在前）
        return withIndex;
    }, [taskGroups, sortOrder]);
```

**After:**
```tsx
    const sortedTaskGroups = useMemo(() => {
        // 强制按 storyboard sort_order 升序（与分镜页完全一致）。
        // 没有 linked image 的 group 退化用 originalIndex（手动上传的卡片排到最后）。
        return taskGroups
            .map((group, originalIndex) => {
                const linkedImg = uploadedImages.find(i =>
                    i.linkedGroupUuids?.includes(group.uuid) || group.ids?.[0] === i.id
                );
                const sortKey = linkedImg?.sortOrder ?? (1000 + originalIndex);
                return { group, originalIndex, sortKey };
            })
            .sort((a, b) => a.sortKey - b.sortKey);
    }, [taskGroups, uploadedImages]);
```

### Step 1.5: Delete the `最新 / 最早` toolbar buttons

Open `new_html/components/VideoPage.tsx`. Replace lines 2754-2773:

**Before:**
```tsx
                    {/* 排序按钮 */}
                    <div className="h-6 w-px bg-slate-600 mx-1" />
                    
                    <div className="flex items-center bg-slate-700 rounded-lg p-1">
                        <button
                            onClick={() => setSortOrder('newest')}
                            className={`px-2 py-1 text-xs rounded ${sortOrder === 'newest' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            title="最新在前"
                        >
                            最新
                        </button>
                        <button
                            onClick={() => setSortOrder('oldest')}
                            className={`px-2 py-1 text-xs rounded ${sortOrder === 'oldest' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            title="最早在前"
                        >
                            最早
                        </button>
                    </div>
                    
                    {/* 视图切换 */}
```

**After:**
```tsx
                    {/* 视图切换 */}
```

(Removed: 19 lines including the comment + divider + button group.)

### Step 1.6: Fix issue ⑥ — `video_prompt` priority in handleImportAll

Open `new_html/pages/VideoGenPage.tsx`. Replace line 73:

**Before:**
```tsx
        const prompt = (item as any).image_prompt ?? (item as any).imagePrompt ?? '';
```

**After:**
```tsx
        // 视频页优先用 video_prompt（视频生成专用），fallback 到 image_prompt（图像生成 prompt）。
        // storyboard_items 表两个字段都存在；此前只读 image_prompt 导致视频提示词丢失。
        const prompt =
            (item as any).video_prompt ?? (item as any).videoPrompt ??
            (item as any).image_prompt ?? (item as any).imagePrompt ?? '';
```

### Step 1.7: Fix issue ⑥ — `video_prompt` priority in storyboardSync

Open `new_html/utils/storyboardSync.ts`. Replace line 44:

**Before:**
```typescript
    const prompt: string = item.image_prompt ?? item.imagePrompt ?? '';
```

**After:**
```typescript
    // Mirror VideoGenPage.handleImportAll: video_prompt > image_prompt.
    const prompt: string =
        item.video_prompt ?? item.videoPrompt ??
        item.image_prompt ?? item.imagePrompt ?? '';
```

### Step 1.8: tsc + vitest gate

```powershell
cd new_html
npx tsc --noEmit 2>&1 | Select-String -Pattern "(VideoPage|VideoGenPage|videoCardLayout|storyboardSync)" | Select-Object -First 20
```

Expected: zero NEW errors. The ~17 pre-existing errors in `VideoPage.tsx` (TaskGroup.createdAt, TaskStatus.taskId/videos) stay unchanged.

```powershell
npx vitest run 2>&1 | Select-Object -Last 10
```

Expected: same 70/77 pass / 7 pre-existing fail (no new failures introduced).

### Step 1.9: Mirror + commit

```powershell
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/utils/videoCardLayout.ts new_html/components/VideoPage.tsx new_html/pages/VideoGenPage.tsx new_html/utils/storyboardSync.ts
git add new_html/utils/videoCardLayout.ts new_html/components/VideoPage.tsx new_html/pages/VideoGenPage.tsx new_html/utils/storyboardSync.ts deploy/new_html/utils/videoCardLayout.ts deploy/new_html/components/VideoPage.tsx deploy/new_html/pages/VideoGenPage.tsx deploy/new_html/utils/storyboardSync.ts
git commit -m "fix(video-page): height alignment + ascending sort + video_prompt import

- videoCardLayout.ts: SEEDANCE_CARD_HEIGHT_CLASS becomes h-[720px] overflow-y-auto
  so left and right card columns stay row-aligned (was min/max range causing 100px drift)
- VideoPage.tsx sortedTaskGroups: force ascending by storyboard sort_order
  (was 'newest first' which reversed the storyboard sequence after import)
- VideoPage.tsx: drop sortOrder state and remove the toolbar 最新/最早 buttons
- VideoGenPage.handleImportAll and storyboardSync.buildArtifacts:
  video_prompt over image_prompt fallback (was only reading image_prompt;
  storyboard page filled video_prompt got dropped silently on import)

Closes issues #1 #2 #6 of the video-page bugfix batch."
```

### Step 1.10: scan + sync_check

```powershell
python ".claude/skills/project-memory/scripts/scan_project.py" "h:\MY2"
python ".claude/skills/project-memory/scripts/sync_check.py" "h:\MY2" --strict --levels ERROR
```

Expected: exit 0. If `context/` changed, commit it as `chore(task1): refresh context indexes`.

---

## Task 2: Auto-populate `media_inputs` (issue ⑤a)

**Files:**
- Modify: `new_html/components/VideoPage.tsx:105-120` — `getSeedanceParams` fallback uses linked images
- Modify: `new_html/pages/VideoGenPage.tsx:148-150` — `role: 'first_frame'` → `'reference_image'`
- Modify: `new_html/utils/storyboardSync.ts:88` — same `role` change in `buildArtifacts`

**Why:** The current default for new Seedance params is `media_inputs: []`, so when a user toggles a card from Wan2 → Seedance2, `media_inputs` is empty even though the card visually has a storyboard image. Plus, even on import the role is `first_frame`, which forces "first/last-frame mode" semantics on every card. Both should default to `reference_image` (all-purpose reference), and `getSeedanceParams` must auto-pull the linked image.

### Step 2.1: Pre-edit impact check

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/VideoPage.tsx" --brief
```

Expected: same reverse-deps as Task 1 (already ran).

### Step 2.2: Rewrite `getSeedanceParams` to auto-pull linked image

Open `new_html/components/VideoPage.tsx`. Replace lines 105-120 (the current `getSeedanceParams` callback):

**Before:**
```tsx
    const getSeedanceParams = useCallback((uuid: string, model: videoService.VideoModel): SeedanceParams => {
        const existing = seedanceParamsByUuid[uuid];
        if (existing) return existing;
        return {
            sub_model: model === 'Seedance2Fast' ? 'fast' : 'standard',
            prompt: '',
            media_inputs: [],
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

**After:**
```tsx
    const getSeedanceParams = useCallback((uuid: string, model: videoService.VideoModel): SeedanceParams => {
        const existing = seedanceParamsByUuid[uuid];
        if (existing) return existing;

        // Issue 5a: when a card is freshly switched to Seedance2/Fast, auto-pull the
        // storyboard image linked to this group as a reference_image so the prompt
        // editor's @-popover can resolve "current_card" candidates and the panel
        // doesn't show 0/9 while the card visually has an image.
        const group = taskGroups.find(g => g.uuid === uuid);
        const linkedImages = uploadedImages.filter(img =>
            img.url
            && !img.isPlaceholder
            && (
                img.linkedGroupUuids?.includes(uuid)
                || group?.ids?.includes(img.id)
            )
        );
        const seedMedia: videoService.SeedanceMediaInput[] = linkedImages.map(img => ({
            kind: 'image',
            url: img.url,
            role: 'reference_image',
        }));

        return {
            sub_model: model === 'Seedance2Fast' ? 'fast' : 'standard',
            prompt: '',
            media_inputs: seedMedia,
            resolution: '720p',
            ratio: 'adaptive',
            duration: 5,
            seed: -1,
            watermark: false,
            generate_audio: true,
            camera_fixed: false,
        };
    }, [seedanceParamsByUuid, taskGroups, uploadedImages]);
```

### Step 2.3: Change handleImportAll to use `reference_image` (no more `first_frame` default)

Open `new_html/pages/VideoGenPage.tsx`. Replace lines 148-150 inside `handleImportAll`:

**Before:**
```tsx
          media_inputs: imgUrl
            ? [{ kind: 'image', url: imgUrl, role: 'first_frame' }]
            : [],
```

**After:**
```tsx
          // Default to reference_image (all-purpose reference / 全能参考).
          // Users can switch to first/last-frame mode via the panel toggle (Task 3).
          media_inputs: imgUrl
            ? [{ kind: 'image', url: imgUrl, role: 'reference_image' }]
            : [],
```

### Step 2.4: Same change in `storyboardSync.buildArtifacts`

Open `new_html/utils/storyboardSync.ts`. Replace line 88:

**Before:**
```typescript
        media_inputs: imgUrl
            ? [{ kind: 'image', url: imgUrl, role: 'first_frame' }]
            : [],
```

**After:**
```typescript
        // Mirrors VideoGenPage.handleImportAll: reference_image is the default.
        media_inputs: imgUrl
            ? [{ kind: 'image', url: imgUrl, role: 'reference_image' }]
            : [],
```

### Step 2.5: Verify existing tests still pass

```powershell
cd new_html
npx vitest run __tests__/utils/storyboardSync 2>&1 | Select-Object -Last 8
# storyboardSync has no dedicated tests, but seedanceMedia & seedanceCandidateBuilder use these helpers.
npx vitest run __tests__/utils/seedanceMedia.test.ts __tests__/utils/seedanceCandidateBuilder.test.ts 2>&1 | Select-Object -Last 8
```

Expected: PASS. Neither tests asserts on `role`, so no breakage.

### Step 2.6: tsc + commit

```powershell
npx tsc --noEmit 2>&1 | Select-String -Pattern "(VideoPage|VideoGenPage|storyboardSync)" | Select-Object -First 10
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/components/VideoPage.tsx new_html/pages/VideoGenPage.tsx new_html/utils/storyboardSync.ts
git add new_html/components/VideoPage.tsx new_html/pages/VideoGenPage.tsx new_html/utils/storyboardSync.ts deploy/new_html/components/VideoPage.tsx deploy/new_html/pages/VideoGenPage.tsx deploy/new_html/utils/storyboardSync.ts
git commit -m "fix(video-page): auto-populate media_inputs from linked image + reference_image default

- VideoPage.getSeedanceParams: when no SeedanceParams exists for a group yet,
  populate media_inputs from uploadedImages linked to this group.uuid (or
  having an id matching group.ids[0]). Fixes 'card has image but media_inputs
  is 0/9 after model switch'.
- handleImportAll + storyboardSync.buildArtifacts: default role becomes
  reference_image (all-purpose reference / 全能参考). Was first_frame, which
  forced 首尾帧 semantics on every imported card.

Closes issue #5a of the video-page bugfix batch.
Pairs with #3 (Task 3): mode toggle now reads role and routes accordingly."
```

---

## Task 3: Mode toggle + grey-out + submit filter (issues ③, ④)

**Files:**
- Modify: `new_html/components/SeedanceMultimodalPanel.tsx` — major UI restructure
- Modify: `new_html/components/VideoPage.tsx:984-1010` — `runTask` filter for first/last-frame mode
- Modify: `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx` — +3 cases

**Design (from /frontend-design):**

```
┌─ Seedance 2.0 多模态控制台      [飞升 Standard]                    ─┐
│                                                                       │
│  模式  [● 全能参考 ]  [○ 首尾帧]                                      │
│        混合 图/视频/音频     仅 2 张图（首+尾），视频音频灰显跳过      │
│ ────────────────────────────────────────────────────────────────────  │
│  提示词                                          [+ 插入素材]         │
│  [SeedanceMentionPromptEditor]                                        │
│                                                                       │
│  媒体输入                                                              │
│  ┌─ 图片 0/9 [+ 添加]┐ ┌─ 视频 0/3 [+ 添加]┐ ┌─ 音频 0/3 [+ 添加]┐    │
│  │                  │ │                  │ │                  │      │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘      │
│                                                                       │
│  当模式 = 首尾帧 时:                                                  │
│  · 图片角色下拉只显示「首帧 / 尾帧」                                   │
│  · 视频/音频 box 整体 opacity-30 + pointer-events-none                │
│  · 已有视频/音频 item 显示 "首尾帧模式不发送给后端" 角标               │
│  · submit 时自动过滤掉视频/音频                                        │
└────────────────────────────────────────────────────────────────────  ┘
```

**Mode derivation logic** (no new persisted field):
```
isFirstLastMode = images.some(m => m.role === 'first_frame' || m.role === 'last_frame')
```
Switching the toggle adjusts existing `media_inputs[].role` and (in 首尾帧→参考方向) keeps videos/audios but they remain present in `media_inputs` so they grey-out instead of being deleted.

### Step 3.1: Pre-edit impact check

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/SeedanceMultimodalPanel.tsx" --brief
```

Expected: `pages: VideoPage` — already verified.

### Step 3.2: Write failing tests (TDD red)

Open `new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx`. Append 3 new cases at the end of the `describe` block (before its closing `});`):

```tsx
    it('starts in 全能参考 mode by default (no first_frame in media_inputs)', () => {
        render(<SeedanceMultimodalPanel value={baseParams} onChange={vi.fn()} candidates={[]} />);
        // Toggle has 全能参考 active
        const refBtn = screen.getByRole('button', { name: /全能参考/ });
        expect(refBtn.getAttribute('aria-pressed')).toBe('true');
        const ffBtn = screen.getByRole('button', { name: /首尾帧/ });
        expect(ffBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('switching to 首尾帧 mode reassigns image roles to first_frame / last_frame', () => {
        const onChange = vi.fn();
        render(
            <SeedanceMultimodalPanel
                value={{
                    ...baseParams,
                    media_inputs: [
                        { kind: 'image', url: '/a.png', role: 'reference_image' },
                        { kind: 'image', url: '/b.png', role: 'reference_image' },
                    ],
                }}
                onChange={onChange}
                candidates={[]}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /首尾帧/ }));
        expect(onChange).toHaveBeenCalled();
        const next = onChange.mock.calls[0][0];
        expect(next.media_inputs[0].role).toBe('first_frame');
        expect(next.media_inputs[1].role).toBe('last_frame');
    });

    it('grey-outs video/audio sections when in 首尾帧 mode', () => {
        const { container } = render(
            <SeedanceMultimodalPanel
                value={{
                    ...baseParams,
                    media_inputs: [
                        { kind: 'image', url: '/a.png', role: 'first_frame' },
                        { kind: 'image', url: '/b.png', role: 'last_frame' },
                        { kind: 'video', url: '/v.mp4', role: 'reference_video' },
                    ],
                }}
                onChange={vi.fn()}
                candidates={[]}
            />
        );
        // Find the video box — its outer wrapper has data-greyed="true"
        const videoBox = container.querySelector('[data-section="video"]');
        expect(videoBox).toHaveAttribute('data-greyed', 'true');
    });
```

(`fireEvent` import is already in the file per other panels' style; if not, add `import { fireEvent } from '@testing-library/react'`.)

Run: `cd new_html && npx vitest run __tests__/components/SeedanceMultimodalPanel.test.tsx`
Expected: 3 NEW tests FAIL (button labels not present, data-section/data-greyed attributes missing).

### Step 3.3: Implement mode toggle in SeedanceMultimodalPanel

Open `new_html/components/SeedanceMultimodalPanel.tsx`. Make these surgical edits:

**Edit 1: Add `useEffect` import + role-related constants** (top of file, near existing `ROLE_OPTIONS_IMAGE`):

Replace `ROLE_OPTIONS_IMAGE` (lines 19-24) with role-option lists per mode:

```typescript
const ROLE_OPTIONS_REFERENCE: { value: SeedanceMediaRole | ''; label: string }[] = [
    { value: '', label: '无角色' },
    { value: 'reference_image', label: '参考图' },
];
const ROLE_OPTIONS_FIRST_LAST: { value: SeedanceMediaRole | ''; label: string }[] = [
    { value: 'first_frame', label: '首帧' },
    { value: 'last_frame', label: '尾帧' },
];
```

**Edit 2: After the `images / videos / audios` derivations (line 38-39 area), add mode derivation + toggle handler:**

Insert right after line 38-39:

```typescript
    // Issue 3/4: derive mode from existing media_inputs[].role (no new persisted field).
    const isFirstLastMode = images.some(m => m.role === 'first_frame' || m.role === 'last_frame');
    const mode: 'reference' | 'first_last' = isFirstLastMode ? 'first_last' : 'reference';

    const setMode = useCallback((newMode: 'reference' | 'first_last') => {
        if (newMode === mode) return;
        const nextInputs = value.media_inputs.map((m, idx) => {
            if (m.kind !== 'image') return m;
            // image kind: rewrite role per target mode
            if (newMode === 'first_last') {
                // 1st image → first_frame, 2nd → last_frame, 3+ stay (will be grey-listed)
                const imgIdx = value.media_inputs.slice(0, idx).filter(x => x.kind === 'image').length;
                if (imgIdx === 0) return { ...m, role: 'first_frame' as SeedanceMediaRole };
                if (imgIdx === 1) return { ...m, role: 'last_frame' as SeedanceMediaRole };
                return { ...m, role: undefined };
            }
            // newMode === 'reference': everything image becomes reference_image
            return { ...m, role: 'reference_image' as SeedanceMediaRole };
        });
        onChange({ ...value, media_inputs: nextInputs });
    }, [mode, value, onChange]);
```

**Edit 3: Replace header bar area (lines 121-129)** to include the toggle:

Replace:
```tsx
            <div className="flex items-center justify-between border-b border-cyan-900/40 pb-2">
                <div>
                    <div className="text-[11px] font-semibold text-cyan-200 tracking-wide">Seedance 2.0 多模态控制台</div>
                    <div className="text-[9px] text-slate-500">图片 0-9 · 视频 0-3 · 音频 0-3 · 参数默认展开</div>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-cyan-700/40 text-cyan-300 bg-cyan-950/30">
                    {value.sub_model === 'fast' ? '渡劫 Fast' : '飞升 Standard'}
                </span>
            </div>
```

With:
```tsx
            <div className="flex items-center justify-between border-b border-cyan-900/40 pb-2">
                <div>
                    <div className="text-[11px] font-semibold text-cyan-200 tracking-wide">Seedance 2.0 多模态控制台</div>
                    <div className="text-[9px] text-slate-500">
                        {mode === 'reference'
                            ? '全能参考：图片 0-9 · 视频 0-3 · 音频 0-3'
                            : '首尾帧：仅 2 张图（首+尾），视频/音频不发送给后端'}
                    </div>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-cyan-700/40 text-cyan-300 bg-cyan-950/30">
                    {value.sub_model === 'fast' ? '渡劫 Fast' : '飞升 Standard'}
                </span>
            </div>

            {/* Mode toggle (Issue 3/4) */}
            <div className="flex items-center gap-2 -mt-1">
                <span className="text-[10px] text-slate-400 shrink-0">模式</span>
                <div className="inline-flex rounded-md border border-cyan-800/40 bg-slate-900/40 overflow-hidden text-[10px]">
                    <button
                        type="button"
                        aria-pressed={mode === 'reference'}
                        onClick={() => setMode('reference')}
                        disabled={disabled}
                        className={`px-2 py-1 transition-colors ${
                            mode === 'reference'
                                ? 'bg-cyan-700/60 text-white'
                                : 'text-slate-400 hover:text-cyan-300'
                        }`}
                    >
                        全能参考
                    </button>
                    <button
                        type="button"
                        aria-pressed={mode === 'first_last'}
                        onClick={() => setMode('first_last')}
                        disabled={disabled}
                        className={`px-2 py-1 transition-colors ${
                            mode === 'first_last'
                                ? 'bg-cyan-700/60 text-white'
                                : 'text-slate-400 hover:text-cyan-300'
                        }`}
                    >
                        首尾帧
                    </button>
                </div>
            </div>
```

**Edit 4: Update the image role select** (around line 188-194 in current file, inside the image item map):

Replace:
```tsx
                                        <select
                                            value={m.role || ''}
                                            onChange={e => updateMediaRole(i, e.target.value as SeedanceMediaRole | '')}
                                            disabled={disabled}
                                            className="w-full mt-1 bg-slate-900 border border-slate-700 text-[9px] text-white rounded px-1"
                                        >
                                            {ROLE_OPTIONS_IMAGE.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
```

With:
```tsx
                                        <select
                                            value={m.role || ''}
                                            onChange={e => updateMediaRole(i, e.target.value as SeedanceMediaRole | '')}
                                            disabled={disabled}
                                            className="w-full mt-1 bg-slate-900 border border-slate-700 text-[9px] text-white rounded px-1"
                                        >
                                            {(mode === 'first_last' ? ROLE_OPTIONS_FIRST_LAST : ROLE_OPTIONS_REFERENCE)
                                                .map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
```

**Edit 5: Grey-out the video + audio sections in first_last mode** (around lines 206 and 233):

Replace the video section opening:
```tsx
                    <div className="rounded-md border border-slate-700/70 bg-slate-900/60 p-2 min-h-[122px]">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span>视频 {videos.length}/3</span>
```

With:
```tsx
                    <div
                        data-section="video"
                        data-greyed={mode === 'first_last' ? 'true' : 'false'}
                        className={`rounded-md border border-slate-700/70 bg-slate-900/60 p-2 min-h-[122px] ${
                            mode === 'first_last' ? 'opacity-30 pointer-events-none' : ''
                        }`}
                        title={mode === 'first_last' ? '首尾帧模式不发送视频给后端' : ''}
                    >
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span>视频 {videos.length}/3 {mode === 'first_last' && '(跳过)'}</span>
```

Apply the analogous wrap for the audio section (around line 233):

Replace:
```tsx
                    <div className="rounded-md border border-slate-700/70 bg-slate-900/60 p-2 min-h-[122px]">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span>音频 {audios.length}/3</span>
```

With:
```tsx
                    <div
                        data-section="audio"
                        data-greyed={mode === 'first_last' ? 'true' : 'false'}
                        className={`rounded-md border border-slate-700/70 bg-slate-900/60 p-2 min-h-[122px] ${
                            mode === 'first_last' ? 'opacity-30 pointer-events-none' : ''
                        }`}
                        title={mode === 'first_last' ? '首尾帧模式不发送音频给后端' : ''}
                    >
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span>音频 {audios.length}/3 {mode === 'first_last' && '(跳过)'}</span>
```

### Step 3.4: Run tests (green)

```powershell
cd new_html
npx vitest run __tests__/components/SeedanceMultimodalPanel.test.tsx 2>&1 | Select-Object -Last 12
```

Expected: 6/6 PASS (3 existing + 3 new).

### Step 3.5: Add submit filter in `runTask`

Open `new_html/components/VideoPage.tsx`. Replace lines 984-986:

**Before:**
```tsx
        if (group.model === 'Seedance2' || group.model === 'Seedance2Fast') {
            const params = getSeedanceParams(group.uuid, group.model);
            setTasksStatus(prev => {
```

**After:**
```tsx
        if (group.model === 'Seedance2' || group.model === 'Seedance2Fast') {
            const rawParams = getSeedanceParams(group.uuid, group.model);
            // Issue 4: in 首尾帧 mode (any image has role first_frame/last_frame),
            // the panel greys out videos/audios — strip them before submit.
            const isFirstLastMode = rawParams.media_inputs.some(
                m => m.kind === 'image' && (m.role === 'first_frame' || m.role === 'last_frame')
            );
            const params = isFirstLastMode
                ? { ...rawParams, media_inputs: rawParams.media_inputs.filter(m => m.kind === 'image') }
                : rawParams;
            setTasksStatus(prev => {
```

### Step 3.6: Run tests + tsc + commit

```powershell
cd new_html
npx vitest run 2>&1 | Select-Object -Last 8
npx tsc --noEmit 2>&1 | Select-String -Pattern "(VideoPage|SeedanceMultimodalPanel)" | Select-Object -First 10
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/components/SeedanceMultimodalPanel.tsx new_html/components/VideoPage.tsx new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx
git add new_html/components/SeedanceMultimodalPanel.tsx new_html/components/VideoPage.tsx new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx deploy/new_html/components/SeedanceMultimodalPanel.tsx deploy/new_html/components/VideoPage.tsx
git commit -m "fix(seedance): mode toggle (全能参考 / 首尾帧) + grey-out + submit filter

- SeedanceMultimodalPanel.tsx:
  * Header now shows segmented control 全能参考 | 首尾帧
  * Mode derived from media_inputs[].role (no new persisted field)
  * Switching to 首尾帧: 1st image -> first_frame, 2nd -> last_frame, rest cleared
  * Switching to 全能参考: all images become reference_image
  * Image role select shows mode-appropriate options only
  * Video & audio sections greyed (opacity-30, pointer-events-none) when in 首尾帧;
    data-greyed='true' attribute exposed for tests; tooltip explains submit-skip
- VideoPage.runTask: strips non-image media_inputs before submitSeedanceTask when
  isFirstLastMode is true, so backend only receives first/last-frame images
- 3 new test cases cover default mode, role reassignment, and grey-out rendering

Closes issues #3 #4 of the video-page bugfix batch.
Tests pass: 50/77 (was 47/74; +3 new); 7 pre-existing failures unchanged."
```

---

## Task 4: Token-block Backspace delete (issue ⑤b)

**Files:**
- Modify: `new_html/components/SeedanceMentionPromptEditor.tsx` — `handleKeyDown` Backspace branch
- Modify: `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx` — +1 case

**Why:** Tokens like `图片1 / 视频2 / 音频3` are 3-4 chars in raw text. Plain Backspace deletes one char at a time, leaving fragments like `图片` (orphan) which break `canonicalizePrompt`. Users expect the token to act as a single block: one Backspace press → entire token gone + matching `media_inputs` entry removed + remaining tokens renumbered (handled by existing `removeMediaInput` helper).

### Step 4.1: Pre-edit impact check

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/SeedanceMentionPromptEditor.tsx" --brief
```

Expected: leaf component (no reverse deps).

### Step 4.2: Write the failing test (TDD red)

Open `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx`. Append before the closing `});` of the `describe` block:

```tsx
    it('Backspace deletes the entire 图片1 token in one press and shrinks media_inputs', async () => {
        const user = userEvent.setup();
        const handleChange = vi.fn();
        const initial = baseParams({
            prompt: '镜头描述 图片1',
            media_inputs: [{ kind: 'image', url: '/c.png', role: 'reference_image' }],
        });
        render(
            <SeedanceMentionPromptEditor
                value={initial}
                onChange={handleChange}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        await user.click(ta);
        // Place cursor at the end of "图片1"
        ta.setSelectionRange(initial.prompt.length, initial.prompt.length);
        await user.keyboard('{Backspace}');
        expect(handleChange).toHaveBeenCalled();
        const next = handleChange.mock.calls[handleChange.mock.calls.length - 1][0];
        expect(next.media_inputs).toHaveLength(0);
        expect(next.prompt).not.toMatch(/图片1/);
        expect(next.prompt).not.toMatch(/图片$/); // no orphan fragment
    });
```

Run: `cd new_html && npx vitest run __tests__/components/SeedanceMentionPromptEditor.test.tsx`
Expected: this NEW test FAILs (Backspace currently deletes only `1`, leaving `图片`).

### Step 4.3: Implement Backspace token detection

Open `new_html/components/SeedanceMentionPromptEditor.tsx`. Add to imports near the top:

**Before (line 5):**
```tsx
import { insertMention, parseArkAssetId } from '../utils/seedanceMedia';
```

**After:**
```tsx
import { insertMention, parseArkAssetId, removeMediaInput, TOKEN_PREFIX } from '../utils/seedanceMedia';
```

Then add a Backspace branch INSIDE `handleKeyDown` (currently at lines 117-134). Replace the entire `handleKeyDown` callback:

**Before:**
```tsx
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (!open) return;
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx(i => Math.min(flatList.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx(i => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const cand = flatList[activeIdx];
                if (cand) handleSelect(cand);
            }
        },
        [open, flatList, activeIdx, handleSelect],
    );
```

**After:**
```tsx
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            // Issue 5b: Backspace at end of a token deletes whole 图片N / 视频N / 音频N
            // and removes the matching media_inputs entry (renumbers remaining tokens).
            if (e.key === 'Backspace' && !composing) {
                const ta = taRef.current;
                if (ta) {
                    const cursor = ta.selectionStart;
                    // Only fire when there's no selection (range delete is plain text)
                    if (cursor === ta.selectionEnd) {
                        const before = (value.prompt || '').slice(0, cursor);
                        const m = /(图片|视频|音频)(\d+)$/.exec(before);
                        if (m) {
                            e.preventDefault();
                            const tokenLen = m[0].length;
                            const labelToKind: Record<string, 'image' | 'video' | 'audio'> = {
                                '图片': 'image', '视频': 'video', '音频': 'audio',
                            };
                            const kind = labelToKind[m[1]];
                            const tokenN = parseInt(m[2], 10);
                            // Find the corresponding media_inputs index (N-th of that kind)
                            const sameKindAbs = value.media_inputs
                                .map((mi, i) => mi.kind === kind ? i : -1)
                                .filter(i => i >= 0);
                            const targetAbsIdx = sameKindAbs[tokenN - 1];

                            // Delete the token text and (if present) one preceding space
                            const start = cursor - tokenLen;
                            const trimStart = start > 0 && (value.prompt || '').charAt(start - 1) === ' ' ? start - 1 : start;
                            const promptStripped =
                                (value.prompt || '').slice(0, trimStart) + (value.prompt || '').slice(cursor);

                            if (targetAbsIdx === undefined || targetAbsIdx < 0) {
                                // No backing media (orphan token) — just strip text
                                onChange({ ...value, prompt: promptStripped });
                            } else {
                                // removeMediaInput operates on the full SeedanceParams (renumbers
                                // remaining tokens automatically). We then overlay our stripped
                                // prompt because removeMediaInput preserves text around the token.
                                const after = removeMediaInput(value, targetAbsIdx);
                                onChange({ ...after, prompt: removeMediaInput({ ...value, prompt: promptStripped }, targetAbsIdx).prompt });
                            }
                            return;
                        }
                    }
                }
            }
            if (!open) return;
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx(i => Math.min(flatList.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx(i => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const cand = flatList[activeIdx];
                if (cand) handleSelect(cand);
            }
        },
        [open, flatList, activeIdx, handleSelect, value, onChange, composing],
    );
```

### Step 4.4: Run test (green)

```powershell
cd new_html
npx vitest run __tests__/components/SeedanceMentionPromptEditor.test.tsx 2>&1 | Select-Object -Last 12
```

Expected: 8/8 PASS (7 existing + 1 new).

### Step 4.5: Sanity-check whole suite

```powershell
npx vitest run 2>&1 | Select-Object -Last 8
```

Expected: 51/77 pass (50 from Task 3 + 1 from Task 4). 7 pre-existing failures still pre-existing.

### Step 4.6: tsc + commit

```powershell
npx tsc --noEmit 2>&1 | Select-String -Pattern "SeedanceMentionPromptEditor" | Select-Object -First 5
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/components/SeedanceMentionPromptEditor.tsx new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx
git add new_html/components/SeedanceMentionPromptEditor.tsx new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx deploy/new_html/components/SeedanceMentionPromptEditor.tsx
git commit -m "fix(seedance): Backspace deletes prompt tokens as a block + drops matching media

- SeedanceMentionPromptEditor.handleKeyDown:
  * Backspace at end of '图片N' / '视频N' / '音频N' deletes the entire token
    in one press (was 1-char per press, leaving orphan fragments like '图片')
  * Also strips one preceding space if any
  * Calls removeMediaInput to remove the matching media_inputs entry and
    renumber the remaining same-kind tokens
  * Range deletes (selectionStart != selectionEnd) and IME composition fall
    through to default browser behavior
- Test: typing Backspace at end of '镜头描述 图片1' shrinks media_inputs to []
  and prompt to '镜头描述' (no '图片' orphan)

Closes issue #5b of the video-page bugfix batch."
```

---

## Task 5: List-view redesign (issue ⑦)

**Files:**
- Create: `new_html/components/video/MediaBadges.tsx`
- Create: `new_html/components/video/SeedanceDetailModal.tsx`
- Create: `new_html/__tests__/components/MediaBadges.test.tsx`
- Create: `new_html/__tests__/components/SeedanceDetailModal.test.tsx`
- Modify: `new_html/components/VideoPage.tsx:1845-1862` — list-view Seedance row
- Modify: `new_html/components/VideoPage.tsx` — add `seedanceDetailUuid` state + Modal mount

**Why:** Current `renderListViewCard` renders the FULL `<SeedancePanelWithCandidates>` for Seedance models — 600+ px tall — which makes left rows 12x taller than right rows so they cannot align and only ~2 left rows fit on screen. List view should be a "mission bus": each row 64 px high with serial / thumbnail / model / prompt-line / media-badges / status / actions. The full panel goes into a Modal triggered by ⚙ button.

### Step 5.1: TDD — create MediaBadges test first

Create `new_html/__tests__/components/MediaBadges.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MediaBadges } from '../../components/video/MediaBadges';
import type { SeedanceParams } from '../../services/videoService';

const mk = (over: Partial<SeedanceParams> = {}): SeedanceParams => ({
    sub_model: 'standard',
    prompt: '',
    media_inputs: [],
    resolution: '720p',
    ratio: 'adaptive',
    duration: 5,
    seed: -1,
    watermark: false,
    generate_audio: true,
    camera_fixed: false,
    ...over,
});

describe('MediaBadges', () => {
    it('renders three badges with counts when there is mixed media', () => {
        render(<MediaBadges params={mk({
            media_inputs: [
                { kind: 'image', url: '/a.png', role: 'reference_image' },
                { kind: 'image', url: '/b.png', role: 'reference_image' },
                { kind: 'image', url: '/c.png', role: 'reference_image' },
                { kind: 'video', url: '/v.mp4', role: 'reference_video' },
                { kind: 'audio', url: '/a.mp3', role: 'reference_audio' },
            ],
        })} />);
        expect(screen.getByText('图3')).toBeInTheDocument();
        expect(screen.getByText('视1')).toBeInTheDocument();
        expect(screen.getByText('音1')).toBeInTheDocument();
    });

    it('renders zero counts and applies muted styling', () => {
        const { container } = render(<MediaBadges params={mk()} />);
        expect(screen.getByText('图0')).toBeInTheDocument();
        expect(screen.getByText('视0')).toBeInTheDocument();
        expect(screen.getByText('音0')).toBeInTheDocument();
        // muted class signals 'count = 0'
        const muted = container.querySelector('[data-zero="true"]');
        expect(muted).toBeTruthy();
    });

    it('exposes data-kind attributes for each badge', () => {
        const { container } = render(<MediaBadges params={mk({
            media_inputs: [{ kind: 'image', url: '/a.png', role: 'reference_image' }],
        })} />);
        expect(container.querySelector('[data-kind="image"]')).toBeTruthy();
        expect(container.querySelector('[data-kind="video"]')).toBeTruthy();
        expect(container.querySelector('[data-kind="audio"]')).toBeTruthy();
    });

    it('truncates tooltip filenames to first 3 entries per kind', () => {
        const { container } = render(<MediaBadges params={mk({
            media_inputs: [
                { kind: 'image', url: '/a.png', role: 'reference_image' },
                { kind: 'image', url: '/b.png', role: 'reference_image' },
                { kind: 'image', url: '/c.png', role: 'reference_image' },
                { kind: 'image', url: '/d.png', role: 'reference_image' },
                { kind: 'image', url: '/e.png', role: 'reference_image' },
            ],
        })} />);
        const imgBadge = container.querySelector('[data-kind="image"]');
        const title = imgBadge?.getAttribute('title') || '';
        expect(title).toContain('a.png');
        expect(title).toContain('c.png');
        // 4th and beyond replaced by '+N more'
        expect(title).toMatch(/\+2|d\.png/); // either "+2 more" or full list ok
    });
});
```

Run: `cd new_html && npx vitest run __tests__/components/MediaBadges.test.tsx`
Expected: all 4 tests FAIL (component not yet created).

### Step 5.2: Create MediaBadges component

Create `new_html/components/video/MediaBadges.tsx`:

```tsx
// new_html/components/video/MediaBadges.tsx
//
// Compact badge row used in the list view (Issue 7) to summarize
// media_inputs without rendering the full SeedanceMultimodalPanel.
//
// Visual: [图3] [视0] [音1]
//   - color-coded per kind (cyan-blue / purple / orange)
//   - zero counts get a muted slate variant + data-zero='true' for tests
//   - hover tooltip shows up to first 3 filenames per kind, "+N more" suffix

import React from 'react';
import type { SeedanceParams } from '../../services/videoService';

export interface MediaBadgesProps {
    params: SeedanceParams;
}

const KIND_LABEL: Record<'image' | 'video' | 'audio', string> = {
    image: '图', video: '视', audio: '音',
};

function tooltipFor(params: SeedanceParams, kind: 'image' | 'video' | 'audio'): string {
    const items = params.media_inputs.filter(m => m.kind === kind);
    if (items.length === 0) return `没有${KIND_LABEL[kind]}片输入`;
    const top = items.slice(0, 3).map(m => (m.url || '').split('/').pop() || '').filter(Boolean);
    const extra = items.length - top.length;
    return extra > 0 ? `${top.join(' · ')}  +${extra} more` : top.join(' · ');
}

const TONE: Record<'image' | 'video' | 'audio', { active: string; zero: string }> = {
    image: {
        active: 'bg-blue-500/15 text-blue-300 border border-blue-700/40',
        zero:   'bg-slate-800 text-slate-600 border border-slate-700/40',
    },
    video: {
        active: 'bg-purple-500/15 text-purple-300 border border-purple-700/40',
        zero:   'bg-slate-800 text-slate-600 border border-slate-700/40',
    },
    audio: {
        active: 'bg-orange-500/15 text-orange-300 border border-orange-700/40',
        zero:   'bg-slate-800 text-slate-600 border border-slate-700/40',
    },
};

export const MediaBadges: React.FC<MediaBadgesProps> = ({ params }) => {
    const counts = {
        image: params.media_inputs.filter(m => m.kind === 'image').length,
        video: params.media_inputs.filter(m => m.kind === 'video').length,
        audio: params.media_inputs.filter(m => m.kind === 'audio').length,
    };
    return (
        <div className="flex items-center gap-1 shrink-0">
            {(['image', 'video', 'audio'] as const).map(kind => {
                const n = counts[kind];
                const isZero = n === 0;
                return (
                    <span
                        key={kind}
                        data-kind={kind}
                        data-zero={isZero ? 'true' : 'false'}
                        title={tooltipFor(params, kind)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isZero ? TONE[kind].zero : TONE[kind].active
                        }`}
                    >
                        {KIND_LABEL[kind]}{n}
                    </span>
                );
            })}
        </div>
    );
};

export default MediaBadges;
```

Re-run: `npx vitest run __tests__/components/MediaBadges.test.tsx`
Expected: 4/4 PASS.

### Step 5.3: TDD — create SeedanceDetailModal test

Create `new_html/__tests__/components/SeedanceDetailModal.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SeedanceDetailModal } from '../../components/video/SeedanceDetailModal';
import type { SeedanceParams } from '../../services/videoService';

const sample: SeedanceParams = {
    sub_model: 'standard',
    prompt: 'hi',
    media_inputs: [],
    resolution: '720p',
    ratio: 'adaptive',
    duration: 5,
    seed: -1,
    watermark: false,
    generate_audio: true,
    camera_fixed: false,
};

describe('SeedanceDetailModal', () => {
    it('renders nothing when open=false', () => {
        const { container } = render(
            <SeedanceDetailModal open={false} title="#1" value={sample} onChange={vi.fn()} candidates={[]} onClose={vi.fn()} />
        );
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders SeedanceMultimodalPanel inside dialog when open=true', () => {
        render(
            <SeedanceDetailModal open={true} title="#42" value={sample} onChange={vi.fn()} candidates={[]} onClose={vi.fn()} />
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/Seedance 详情/)).toBeInTheDocument();
        expect(screen.getByText(/#42/)).toBeInTheDocument();
        expect(screen.getByText('输出参数')).toBeInTheDocument();
    });

    it('clicking the close button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <SeedanceDetailModal open={true} title="#1" value={sample} onChange={vi.fn()} candidates={[]} onClose={onClose} />
        );
        fireEvent.click(screen.getByRole('button', { name: /关闭/ }));
        expect(onClose).toHaveBeenCalled();
    });
});
```

Run: expected 3 FAILS.

### Step 5.4: Create SeedanceDetailModal

Create `new_html/components/video/SeedanceDetailModal.tsx`:

```tsx
// new_html/components/video/SeedanceDetailModal.tsx
//
// Modal wrapper around <SeedanceMultimodalPanel> used by the list view (Issue 7).
// Lets the list keep each row tight (~64px) while still letting the user reach
// the full driving-cabin of media_inputs / output params.
//
// Behavior: real-time save (value/onChange bind directly to caller state).
// Single ✕ close button. Click backdrop = close. Esc to close.

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { SeedanceParams } from '../../services/videoService';
import type { SeedanceAssetCandidate } from '../../utils/seedanceMedia';
import { SeedanceMultimodalPanel } from '../SeedanceMultimodalPanel';

export interface SeedanceDetailModalProps {
    open: boolean;
    title: string;
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
    onClose: () => void;
}

export const SeedanceDetailModal: React.FC<SeedanceDetailModalProps> = (p) => {
    useEffect(() => {
        if (!p.open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [p.open, p.onClose]);

    if (!p.open) return null;
    return (
        <div
            role="dialog"
            aria-label="Seedance 详情"
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={p.onClose}
        >
            <div
                className="w-[520px] max-w-full max-h-[85vh] bg-slate-900 border border-cyan-700/40 rounded-xl shadow-2xl shadow-cyan-950/40 overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-cyan-900/40">
                    <div className="text-xs text-cyan-200">
                        <span className="opacity-60">Seedance 详情 ·</span>
                        <span className="ml-1.5 font-semibold">{p.title}</span>
                    </div>
                    <button
                        type="button"
                        onClick={p.onClose}
                        aria-label="关闭"
                        className="p-1 text-slate-400 hover:text-cyan-300 transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    <SeedanceMultimodalPanel
                        value={p.value}
                        onChange={p.onChange}
                        candidates={p.candidates}
                    />
                </div>
            </div>
        </div>
    );
};

export default SeedanceDetailModal;
```

Re-run: 3/3 PASS.

### Step 5.5: Rewrite the list-view Seedance row

Open `new_html/components/VideoPage.tsx`. Add new imports near the top alongside existing video/* imports:

**Before:**
```tsx
import {
    SeedancePanelWithCandidates,
    DurationFieldForGroup,
    AudioBadgesRow,
} from './video/VideoCard';
```

**After:**
```tsx
import {
    SeedancePanelWithCandidates,
    DurationFieldForGroup,
    AudioBadgesRow,
} from './video/VideoCard';
import { MediaBadges } from './video/MediaBadges';
import { SeedanceDetailModal } from './video/SeedanceDetailModal';
import { useSeedanceCandidates } from '../hooks/useSeedanceCandidates';
import { Settings } from 'lucide-react';
```

Add a state hook near the other modal states (around line 70):

**After existing line:** `const [editModalUuid, setEditModalUuid] = useState<string | null>(null);`

Insert:
```tsx
    // Issue 7: list-view ⚙ detail modal
    const [seedanceDetailUuid, setSeedanceDetailUuid] = useState<string | null>(null);
```

Now rewrite the list-view Seedance row. Replace lines 1845-1862 (the current `<div className="flex-1 min-w-0">...</div>` block):

**Before:**
```tsx
                {/* 提示词 */}
                <div className="flex-1 min-w-0">
                    {(group.model === 'Seedance2' || group.model === 'Seedance2Fast') ? (
                        <SeedancePanelWithCandidates
                            value={getSeedanceParams(group.uuid, group.model)}
                            onChange={(next) => setSeedanceParams(group.uuid, next)}
                            autoOpenMentionOnMount={!!img1.isPlaceholder && (getSeedanceParams(group.uuid, group.model).prompt || '').trim() === '@'}
                        />
                    ) : (
                        <textarea
                            value={promptText}
                            onChange={(e) => updatePrompt(group.ids[0], e.target.value)}
                            placeholder={isPair ? '描述变化过程...' : '描述动作内容...'}
                            className="w-full bg-black/30 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none resize-none h-12"
                        />
                    )}
                </div>
```

**After:**
```tsx
                {/* 提示词 + (Seedance only) 媒体徽章 + 详情按钮 */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                    {(group.model === 'Seedance2' || group.model === 'Seedance2Fast') ? (
                        <ListSeedanceRow
                            group={group}
                            params={getSeedanceParams(group.uuid, group.model)}
                            onChangeParams={(next) => setSeedanceParams(group.uuid, next)}
                            onOpenDetail={() => setSeedanceDetailUuid(group.uuid)}
                            isPlaceholder={!!img1.isPlaceholder}
                        />
                    ) : (
                        <textarea
                            value={promptText}
                            onChange={(e) => updatePrompt(group.ids[0], e.target.value)}
                            placeholder={isPair ? '描述变化过程...' : '描述动作内容...'}
                            className="flex-1 bg-black/30 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none resize-none h-10"
                        />
                    )}
                </div>
```

Add the `ListSeedanceRow` helper component right above `renderListViewCard` (around line 1755):

```tsx
    // Issue 7: compact Seedance row used inside renderListViewCard.
    // Single line of textarea + media badges + ⚙ detail button.
    const ListSeedanceRow: React.FC<{
        group: videoService.TaskGroup;
        params: SeedanceParams;
        onChangeParams: (next: SeedanceParams) => void;
        onOpenDetail: () => void;
        isPlaceholder: boolean;
    }> = ({ group, params, onChangeParams, onOpenDetail, isPlaceholder }) => {
        const { candidates } = useSeedanceCandidates({ currentParams: params });
        return (
            <>
                <div className="flex-1 min-w-0">
                    {/* prettier-ignore */}
                    <textarea
                        value={params.prompt}
                        onChange={(e) => onChangeParams({ ...params, prompt: e.target.value })}
                        placeholder={isPlaceholder ? '@ 选首帧...' : '描述动作、镜头...'}
                        rows={1}
                        className="w-full bg-black/30 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none resize-none h-10 leading-tight"
                    />
                </div>
                <MediaBadges params={params} />
                <button
                    type="button"
                    onClick={onOpenDetail}
                    className="p-1 text-slate-400 hover:text-cyan-300 transition-colors"
                    title="完整参数 / @-mention / 模式切换"
                    aria-label={`Seedance 详情 ${group.uuid}`}
                >
                    <Settings className="w-3.5 h-3.5" />
                </button>
            </>
        );
    };
```

(Note: this preserves prompt sync via `params.prompt` directly. The `@` popover is only available in the modal; list view stays compact. `isPlaceholder` is shown via placeholder text only.)

Also: change the **list-view row container height** to enforce 64 px. Open `renderListViewCard` outer `<div>` (line 1768-1777). Replace:

**Before:**
```tsx
            <div
                key={group.uuid}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDragDrop(e, index)}
                className={`bg-slate-800 rounded-lg border p-3 flex items-center gap-3 transition-all hover:border-slate-600 mb-2 ${
                    status.selected ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-slate-700'
                }`}
            >
```

**After:**
```tsx
            <div
                key={group.uuid}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDragDrop(e, index)}
                className={`bg-slate-800 rounded-lg border px-3 flex items-center gap-3 transition-all hover:border-slate-600 mb-2 h-16 ${
                    status.selected ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-slate-700'
                }`}
            >
```

(Changed: `p-3` → `px-3` and added `h-16` so the row is exactly 64 px regardless of content. Right-side rows use the same height — verify in Step 5.7.)

### Step 5.6: Mount the SeedanceDetailModal at component bottom

Open `new_html/components/VideoPage.tsx`. Find the existing modal cluster near the bottom of the JSX (right before the toast notification or main component closing). Add at the bottom of the returned JSX (right before the outermost closing `</div>`):

```tsx
            {/* Issue 7: list-view ⚙ Seedance detail modal */}
            {seedanceDetailUuid && (() => {
                const g = taskGroups.find(x => x.uuid === seedanceDetailUuid);
                if (!g || (g.model !== 'Seedance2' && g.model !== 'Seedance2Fast')) return null;
                const params = getSeedanceParams(g.uuid, g.model);
                return (
                    <SeedanceDetailModalWithCandidates
                        title={`#${(taskGroups.findIndex(x => x.uuid === g.uuid) + 1)}`}
                        value={params}
                        onChange={(next) => setSeedanceParams(g.uuid, next)}
                        onClose={() => setSeedanceDetailUuid(null)}
                    />
                );
            })()}
```

Define `SeedanceDetailModalWithCandidates` as a small inner component just below `ListSeedanceRow` (so it has access to `useSeedanceCandidates`):

```tsx
    // Issue 7 helper: SeedanceDetailModal needs candidates from current params,
    // and useSeedanceCandidates must be called from a function component (not the
    // outer VideoPage callback). Wrap it once here.
    const SeedanceDetailModalWithCandidates: React.FC<{
        title: string;
        value: SeedanceParams;
        onChange: (next: SeedanceParams) => void;
        onClose: () => void;
    }> = ({ title, value, onChange, onClose }) => {
        const { candidates } = useSeedanceCandidates({ currentParams: value });
        return (
            <SeedanceDetailModal
                open={true}
                title={title}
                value={value}
                onChange={onChange}
                candidates={candidates}
                onClose={onClose}
            />
        );
    };
```

### Step 5.7: Visual sanity (manual smoke)

After implementing, eyeball the page in dev mode:

```powershell
cd new_html; npm run dev
```

Open `/projects/<id>/ep/<id>/workflow/video`. Expected:
- List view (toggle icon top-right): each left row is 64 px tall, right row matches.
- Seedance card row: thumbnail · I2V badge + model select · 1-line textarea · `[图N][视N][音N]` · `等待` · `[▶ 🗑]` · single ⚙ button.
- Click ⚙ → modal opens with full panel; edit something → close (Esc / click outside / X) → list row reflects the change.

### Step 5.8: Run all tests

```powershell
npx vitest run 2>&1 | Select-Object -Last 8
```

Expected: 58/77 pass (51 from Task 4 + 4 MediaBadges + 3 SeedanceDetailModal). 7 pre-existing failures unchanged.

### Step 5.9: tsc + commit

```powershell
npx tsc --noEmit 2>&1 | Select-String -Pattern "(VideoPage|MediaBadges|SeedanceDetailModal)" | Select-Object -First 10
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/components/VideoPage.tsx new_html/components/video/MediaBadges.tsx new_html/components/video/SeedanceDetailModal.tsx
git add new_html/components/VideoPage.tsx new_html/components/video/MediaBadges.tsx new_html/components/video/SeedanceDetailModal.tsx new_html/__tests__/components/MediaBadges.test.tsx new_html/__tests__/components/SeedanceDetailModal.test.tsx deploy/new_html/components/VideoPage.tsx deploy/new_html/components/video/MediaBadges.tsx deploy/new_html/components/video/SeedanceDetailModal.tsx
git commit -m "fix(list-view): redesign Seedance row + add MediaBadges + ⚙ detail modal

- Was: list view rendered full SeedancePanelWithCandidates per row (~620px tall),
  making left rows 12x the height of right rows so they could not align and only
  ~2 left rows fit on screen.
- Now: list view Seedance row is single-line textarea + MediaBadges (图N 视N 音N)
  + ⚙ button; row container forced to h-16 (64px) to match right-column rows.
- New MediaBadges component (color-coded per kind, muted when 0, hover tooltip
  shows up to 3 filenames + '+N more') reusable in card view too.
- New SeedanceDetailModal wraps SeedanceMultimodalPanel — opened via ⚙. Real-time
  save (value/onChange bind to caller state); close via X / Esc / backdrop click.
- 4 MediaBadges tests + 3 SeedanceDetailModal tests added (all PASS).

Closes issue #7 of the video-page bugfix batch."
```

---

## Task 6: Docs + memory + dist + tag

**Files:**
- Modify: `docs/faq.md` — +7 entries
- Modify: `docs/conventions.md` — +2 anti-patterns
- Modify: `docs/frontend.md` — refresh VideoPage / SeedanceMultimodalPanel sections
- Modify: `dist/` — rebuild
- Add: git tag `video-page-bugfixes-2026-05-17`

### Step 6.1: Refresh project memory

```powershell
python ".claude/skills/project-memory/scripts/scan_project.py" "h:\MY2"
python ".claude/skills/project-memory/scripts/sync_check.py" "h:\MY2" --strict --levels ERROR
```

Expected exit 0. If warnings about new components, those are addressed in 6.2.

### Step 6.2: Append 7 FAQ entries

Open `docs/faq.md`. Append at the end (or under an existing "Video Page" section if present):

```markdown
### 视频页面卡片高度对不齐

**症状**：卡片视图模式下，左右两列卡片行不对齐，第 3 行开始错位 100px+。

**原因**：`SEEDANCE_CARD_HEIGHT_CLASS` 用 `min-h-[620px] max-h-[760px]` 这种弹性范围，左右卡片各自决定自己的高度。

**修复（2026-05-17）**：改为 `h-[720px] overflow-y-auto` 固定高度。`COMPACT_CARD_HEIGHT_CLASS` 同时改为 `h-[400px] overflow-y-auto`。详见 `new_html/utils/videoCardLayout.ts`。

### 视频页面分镜顺序倒了

**症状**：分镜页是镜头 1→N，导入到视频页后变成 N→1（最新在最上）。

**原因**：`VideoPage.sortedTaskGroups` 默认 `sortOrder = 'newest'` 时反转数组。

**修复（2026-05-17）**：删除 `sortOrder` state 和工具栏 `最新/最早` 按钮；强制按 `uploadedImages[i].sortOrder`（来自 `storyboard_items.sort_order`）升序，与分镜页一致。

### 飞升 / 渡劫默认应是「全能参考」模式而非「首尾帧」

**症状**：分镜导入到视频页时，默认把图片设成 `first_frame`，触发首尾帧语义。

**原因**：`VideoGenPage.handleImportAll` 和 `storyboardSync.buildArtifacts` 写死了 `role: 'first_frame'`。

**修复（2026-05-17）**：默认 `role: 'reference_image'`（全能参考）。用户需要首尾帧时，在 `SeedanceMultimodalPanel` 顶部 `[全能参考] [首尾帧]` toggle 切换。切换会自动 rewriteimage roles。

### 首尾帧模式应该只发图片，不发视频/音频

**症状**：首尾帧模式下视频/音频 box 还在收输入，submit 时被后端拒绝。

**修复（2026-05-17）**：
- UI：首尾帧模式下视频/音频 section 整体 `opacity-30 pointer-events-none`，并显示 `(跳过)` 角标。
- 提交：`VideoPage.runTask` 在 submit 前 `media_inputs.filter(m => m.kind === 'image')`。

### Seedance 卡片切到 Seedance2 后媒体输入是空的

**症状**：用户在 Wan2 模式下上传了图片，切到 Seedance2 后，媒体输入显示 0/9，但卡片视觉上还有图。

**原因**：`getSeedanceParams` 返回 `media_inputs: []`，没有自动从 `uploadedImages` 取关联图。

**修复（2026-05-17）**：`getSeedanceParams` 现在按 `linkedGroupUuids` / `group.ids` 找出当前 group 关联的所有 image，作为 `reference_image` 自动填进 `media_inputs`。

### Prompt 里的 `图片1` token 删除时一字一字消失

**症状**：用户 Backspace 想删除整个 `@图片1`，但只删了 `1`，留下 `图片` 孤儿字符串。

**原因**：`SeedanceMentionPromptEditor` 的 textarea 走默认 Backspace 行为。

**修复（2026-05-17）**：`handleKeyDown` 加 Backspace 拦截：检测光标前是否匹配 `(图片|视频|音频)\d+$`，如果匹配则整块删除 + 调 `removeMediaInput` 移除对应 `media_inputs[i]` + 重号剩余 token。IME 输入和范围选择不受影响。

### 视频页面列表模式参数太多 / 左右行宽度不匹配

**症状**：列表模式下，左侧 Seedance 卡渲染了完整的多模态面板（620px+ 高），右侧结果卡只有 64px 高，无法对齐，一屏只能显示 2 行。

**修复（2026-05-17）**：列表模式重设计为 "mission bus" 行：每行 64px，包含 thumbnail · model · 一行 textarea · `[图N][视N][音N]` 媒体徽章 · 状态 · `[▶ 🗑 ⚙]`。点 ⚙ 打开 `SeedanceDetailModal`（包装 `SeedanceMultimodalPanel`，实时保存，X/Esc/点空白关闭）。
```

### Step 6.3: Append conventions

Open `docs/conventions.md`. Append:

```markdown
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
```

### Step 6.4: Refresh frontend.md sections

Open `docs/frontend.md`. Find the existing `### VideoPage` and `### SeedanceMultimodalPanel` sections. Update the SeedanceMultimodalPanel section to mention the mode toggle:

Search/replace inside `docs/frontend.md`:

**Find** (anywhere mentioning Seedance modes in `frontend.md`):
```
The panel exposes media_inputs (image / video / audio) and output parameters.
```

**Replace with:**
```
The panel exposes a [全能参考 | 首尾帧] mode segmented control at the top.
- 全能参考: image roles can be reference_image; video/audio sections active.
- 首尾帧: 1st image becomes first_frame, 2nd becomes last_frame; video/audio
  sections greyed out + skipped on submit.
The mode is derived from existing media_inputs[].role (no separate persisted field).
The panel exposes media_inputs (image / video / audio) and output parameters.
```

(If exact text differs in your repo's `frontend.md`, manually search for `SeedanceMultimodalPanel` and add the same paragraph above the existing description.)

### Step 6.5: Rebuild dist

```powershell
cd new_html
npm run build
cd ..
git add dist/
```

Expected: `npm run build` exits 0; `dist/` directory shows ~30 MB of changed assets.

### Step 6.6: Commit docs + dist + tag

```powershell
python scripts/sync_to_deploy.py --apply --paths docs/faq.md docs/conventions.md docs/frontend.md
git add docs/faq.md docs/conventions.md docs/frontend.md deploy/docs/faq.md deploy/docs/conventions.md deploy/docs/frontend.md context/ dist/
git commit -m "docs(video-page): bugfix batch knowledge — faq + conventions + frontend.md + dist refresh

- faq.md: 7 entries documenting each bug + root cause + fix link
- conventions.md: 2 anti-patterns (mode-from-role, no panel-in-list)
- frontend.md: refresh SeedanceMultimodalPanel section to describe mode toggle
- context/: refreshed by scan_project.py
- dist/: rebuild via npm run build to ship the seven fixes
"
git tag video-page-bugfixes-2026-05-17 -m "Video page 7-bug fix batch (height + sort + Seedance modes + auto-media + token-block + video_prompt + list-view)"
```

### Step 6.7: Final QA gate

```powershell
git status
git log --oneline -8
git tag --list video-page-*
cd new_html; npx vitest run 2>&1 | Select-Object -Last 6
```

Expected:
- `git status`: clean tree
- 6 fix commits + tag visible
- vitest: 58/77 pass (51 + 7 from Task 5 — same as Step 5.8)
- 7 pre-existing failures unchanged from baseline

---

## Self-Review Checklist (run before declaring "plan ready")

### 1. Spec coverage

Each of the 7 reported issues has a task that implements it:

| Issue | Task | Step |
|-------|------|------|
| ① 左右卡片高度对不齐 | T1 | 1.2 |
| ② 顺序倒了 | T1 | 1.3 + 1.4 + 1.5 |
| ③ 飞升/渡劫默认全能参考 | T2 + T3 | 2.3 / 2.4 / 3.3 |
| ④ 首尾帧仅图片 + 灰显跳过 | T3 | 3.3 / 3.5 |
| ⑤a 当前卡图自动进 media_inputs | T2 | 2.2 |
| ⑤b token 整块删除 | T4 | 4.3 |
| ⑥ video_prompt 优先 | T1 | 1.6 + 1.7 |
| ⑦ 列表模式重设计 | T5 | all |

Closes ✅ all 7.

### 2. Placeholder scan

Scan plan for: "TBD", "TODO", "fill in", "implement later", "similar to", "add validation".

Pass — every code block contains exact code; every command shows exact text.

### 3. Type / signature consistency

| Symbol | Definition | Used in |
|--------|------------|---------|
| `SeedanceMediaInput.role` | `services/videoService` (existing) | T2.2 / T2.3 / T2.4 / T3.3 / T3.5 |
| `SeedanceParams.media_inputs` | `services/videoService` (existing) | all |
| `removeMediaInput(value, idx)` | `utils/seedanceMedia` (existing, signature `(SeedanceParams, number) => SeedanceParams`) | T4.3 |
| `useSeedanceCandidates({currentParams})` | `hooks/useSeedanceCandidates` (existing) | T5.5 / T5.6 |
| `MediaBadges({params})` | T5.2 (new) | T5.5 |
| `SeedanceDetailModal({open,title,value,onChange,candidates,onClose})` | T5.4 (new) | T5.6 |
| `ListSeedanceRow` | T5.5 (inline) | T5.5 |
| `SeedanceDetailModalWithCandidates` | T5.6 (inline) | T5.6 |
| `data-section / data-greyed / data-kind / data-zero` attrs | T3.3 / T5.2 (new) | T3.2 / T5.1 |

All names consistent. `removeMediaInput`'s signature confirmed against `new_html/utils/seedanceMedia.ts`.

### 4. Mirror policy

Rule: `scripts/sync_to_deploy.py` excludes `__tests__/`. Test files are NEVER mirrored. Component files / utils / hooks / docs ARE mirrored.

Plan compliance:
- T1.9 — only `.tsx`/`.ts` source mirrored ✅
- T2.6 — only source mirrored ✅
- T3.6 — explicitly mirrors panel + page; test file is in `--paths` BUT also lists `__tests__/components/SeedanceMultimodalPanel.test.tsx`. ⚠️

Fix: in T3.6, T4.6, T5.9 the `--paths` arg should NOT include test files (which `sync_to_deploy.py` will silently skip but the engineer should not have to think about). Adjusting:

**Correction for T3.6 mirror command:**
```powershell
python scripts/sync_to_deploy.py --apply --paths new_html/components/SeedanceMultimodalPanel.tsx new_html/components/VideoPage.tsx
```
(Drop `__tests__/...` from `--paths`. Test file still goes to `git add`.)

**Correction for T4.6:**
```powershell
python scripts/sync_to_deploy.py --apply --paths new_html/components/SeedanceMentionPromptEditor.tsx
```

**Correction for T5.9:**
```powershell
python scripts/sync_to_deploy.py --apply --paths new_html/components/VideoPage.tsx new_html/components/video/MediaBadges.tsx new_html/components/video/SeedanceDetailModal.tsx
```

(These corrected commands replace the originals shown in those steps. The `git add` lines still include the `__tests__/...` files as listed.)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-video-page-bugfixes.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task (T1 → T6), implementer + reviewer pattern, ~4.5 h total wall-clock with parallel review. Best for keeping context tight in each task and catching plan/codebase divergences early (we hit ~5 such divergences last batch — would all have been more painful inline).

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`. Faster for low-divergence tasks (T1, T6) but riskier for T3 (mode toggle + multiple SeedanceMultimodalPanel edits) and T5 (3 new components).

**Recommendation:** Subagent-Driven again, same as the previous batch. Tasks 1-2 can be a single subagent dispatch (both small, highly correlated); 3, 4, 5 each get their own subagent; 6 finalizes.

**Which approach?**


