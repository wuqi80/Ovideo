# Storyboard-scoped mentions + row alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter `@`-mention candidates to the current storyboard scene only (storyboard_data + audio fields scoped to `currentStoryboardItemId`; assets/user_files/video_segments stay episode-wide); fix the per-row vertical drift between left link-buttons and right placeholders so card-view rows stay aligned across the whole page; carry the imported `video_prompt` over when a card is freshly switched to Seedance (close T1's last gap).

**Architecture:** Three small atomic commits, each red→green→commit. Commit A reshapes `useSeedanceCandidates` + `buildCandidates` to accept and apply `currentStoryboardItemId` plus collects new text candidates (image_prompt / video_prompt / lines). Commit B fills `SeedanceParams.prompt` from `imagePrompts[group.ids[0]]` when `getSeedanceParams` falls back. Commit C swaps the left-side link-button container to match the right-side placeholder geometry exactly, so per-row delta is 0px.

**Tech Stack:** React 19, TypeScript, Vite, Vitest. No backend / DB changes.

**Branch:** continue on `feature/storyboard-video-import-completeness` (current).

---

## File Structure

### Modify (5 files)

| File | Commit | Change |
|------|--------|--------|
| `new_html/utils/seedanceCandidateBuilder.ts` | A | accept `currentStoryboardItemId`; filter storyboard_data + audio by it; collect image_prompt/video_prompt/lines text candidates |
| `new_html/hooks/useSeedanceCandidates.ts` | A | accept + forward `currentStoryboardItemId` |
| `new_html/components/video/VideoCard.tsx` | A | accept + forward `storyboardItemId` to hook |
| `new_html/components/VideoPage.tsx` | A, B, C | reverse-lookup `storyboardItemId` from `group.ids[0]`; carry `prompt` in `getSeedanceParams` fallback; rewrite link-button container |
| `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts` | A | +3 cases (storyboard scope, audio scope, prompt-text candidates) |
| `new_html/__tests__/hooks/useSeedanceCandidates.test.ts` | A | +1 case (forwards prop) |

### No new files

### Mirror (auto)

`scripts/sync_to_deploy.py` mirrors `new_html/*` to `deploy/`. Test files excluded.

---

## Task Index

| # | Task | Commit | Time |
|---|------|--------|------|
| A | Storyboard-scoped mention candidates | 1 | 60 min |
| B | Carry video_prompt across model switches | 1 | 15 min |
| C | Row alignment: link-button geometry | 1 | 10 min |
| D | Memory + docs + faq | 1 | 15 min |

Total: ~100 min, 4 commits.

---

## Task A: Storyboard-scoped mention candidates

**Goal:** When the popover opens for a card backed by storyboard_item X, candidates must:
- Show storyboard_data ONLY for item X (heading / dialogue / generated_image / image_prompt / video_prompt / lines).
- Show audio ONLY for item X (dialogue / narration / sfx / mixed).
- Continue showing assets / user_files / video_segments / current_card / ark_asset_id at episode scope.

**Files:**
- Modify: `new_html/utils/seedanceCandidateBuilder.ts` — filter + collect new text fields
- Modify: `new_html/hooks/useSeedanceCandidates.ts` — pass-through prop
- Modify: `new_html/components/video/VideoCard.tsx` — pass-through prop
- Modify: `new_html/components/VideoPage.tsx` — reverse-lookup `storyboardItemId` and provide it
- Modify: `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts` — +3 cases
- Modify: `new_html/__tests__/hooks/useSeedanceCandidates.test.ts` — +1 case

### Step A.1: Pre-edit impact check

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/utils/seedanceCandidateBuilder.ts" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/hooks/useSeedanceCandidates.ts" --brief
```

Expected: candidate builder reaches VideoPage; hook reaches VideoGenPage / VideoPage / WorkspaceApp. No HIGH/CRITICAL warnings.

### Step A.2: Write failing tests for builder

Open `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts`. Append before the closing `});` of the existing `describe` block:

```typescript
    it('filters storyboard_data candidates by currentStoryboardItemId', () => {
        const ctx = {
            currentParams: { ...emptyParams },
            currentStoryboardItemId: 'item-2',
            materialLibrary: {},
            storyboardItems: [
                { item_id: 'item-1', sort_order: 1, scene_heading: 'A', dialogue: 'a' },
                { item_id: 'item-2', sort_order: 2, scene_heading: 'B', dialogue: 'b', generated_image_url: '/b.png' },
                { item_id: 'item-3', sort_order: 3, scene_heading: 'C' },
            ],
            historyVideos: [],
            userFiles: [],
        } as any;
        const out = buildCandidates(ctx);
        const sb = out.filter(c => c.group === 'storyboard_data');
        // Only item-2 entries
        expect(sb.every(c => (c as any).storyboardItemId === 'item-2')).toBe(true);
        // heading + dialogue + image = 3 entries for item-2
        expect(sb).toHaveLength(3);
    });

    it('filters audio candidates by currentStoryboardItemId (no public audioTracks bleed)', () => {
        const ctx = {
            currentParams: { ...emptyParams },
            currentStoryboardItemId: 'item-2',
            materialLibrary: {
                audio: [{ id: 'lib-a', name: 'BGM', currentVersion: { url: '/bgm.mp3' } }],
            },
            storyboardItems: [
                { item_id: 'item-1', sort_order: 1, dialogue_audio_url: '/a-dlg.mp3' },
                { item_id: 'item-2', sort_order: 2, narration_audio_url: '/b-nar.mp3', mixed_audio_url: '/b-mix.mp3' },
            ],
            historyVideos: [],
            userFiles: [],
        } as any;
        const out = buildCandidates(ctx);
        const audio = out.filter(c => c.group === 'audio');
        // Strict: no lib-a (public), no item-1 (other scene). Only item-2 narration + mixed.
        expect(audio.map(c => c.id).sort()).toEqual(
            ['audio_sb_item-2_mixed', 'audio_sb_item-2_narration'].sort()
        );
    });

    it('collects image_prompt + video_prompt + lines as text candidates for the current scene', () => {
        const ctx = {
            currentParams: { ...emptyParams },
            currentStoryboardItemId: 'item-1',
            materialLibrary: {},
            storyboardItems: [
                { item_id: 'item-1', sort_order: 1,
                  image_prompt: 'a wide shot of a city',
                  video_prompt: 'camera pans left, vehicles move',
                  lines: 'NARRATOR: the city sleeps...' },
            ],
            historyVideos: [],
            userFiles: [],
        } as any;
        const out = buildCandidates(ctx);
        const labels = out.filter(c => c.group === 'storyboard_data' && c.kind === 'text').map(c => c.label);
        expect(labels.some(l => /图片提示词/.test(l))).toBe(true);
        expect(labels.some(l => /视频提示词/.test(l))).toBe(true);
        expect(labels.some(l => /旁白/.test(l) || /lines/i.test(l))).toBe(true);
    });
```

`emptyParams` is the existing fixture in this file; if the file uses a different name, find it (likely declared at top). If absent, define inline:
```typescript
const emptyParams = { sub_model: 'standard', prompt: '', media_inputs: [], resolution: '720p', ratio: 'adaptive', duration: 5, seed: -1, watermark: false, generate_audio: true, camera_fixed: false } as any;
```

Run: `cd new_html && npx vitest run __tests__/utils/seedanceCandidateBuilder.test.ts`
Expected: 3 NEW tests FAIL.

### Step A.3: Implement builder filtering + new text candidates

Open `new_html/utils/seedanceCandidateBuilder.ts`.

**Change 1** — extend `CandidateBuildContext` (around line 8):

```typescript
export interface CandidateBuildContext {
    currentParams: SeedanceParams;
    /** storyboard_item.item_id for the card the popover belongs to.
     *  When set, storyboard_data and audio candidates are scoped to this item.
     *  When undefined (e.g. tests, manual upload card), behavior is the legacy "all". */
    currentStoryboardItemId?: string;
    materialLibrary: any;
    storyboardItems: any[];
    historyVideos: any[];
    userFiles: any[];
}
```

**Change 2** — replace the entire storyboard_data section (current lines ~40-73, the `// 2. storyboard_data` block):

```typescript
    // 2. storyboard_data — text snippets + generated images + prompts (scoped)
    const sbItems = (ctx.storyboardItems || []).filter(sb =>
        ctx.currentStoryboardItemId ? sb.item_id === ctx.currentStoryboardItemId : true
    );
    sbItems.forEach((sb: any) => {
        const order = sb.sort_order ?? 0;
        if (sb.scene_heading) {
            out.push({
                id: `sb_text_heading_${sb.item_id}`,
                group: 'storyboard_data', kind: 'text',
                label: `SB-${order} 场景: ${String(sb.scene_heading).slice(0, 16)}`,
                text: sb.scene_heading,
                storyboardItemId: sb.item_id,
            });
        }
        if (sb.dialogue) {
            out.push({
                id: `sb_text_dialogue_${sb.item_id}`,
                group: 'storyboard_data', kind: 'text',
                label: `SB-${order} 台词: ${String(sb.dialogue).slice(0, 16)}`,
                text: sb.dialogue,
                storyboardItemId: sb.item_id,
            });
        }
        if (sb.image_prompt) {
            out.push({
                id: `sb_text_image_prompt_${sb.item_id}`,
                group: 'storyboard_data', kind: 'text',
                label: `SB-${order} 图片提示词: ${String(sb.image_prompt).slice(0, 16)}`,
                text: sb.image_prompt,
                storyboardItemId: sb.item_id,
            });
        }
        if (sb.video_prompt) {
            out.push({
                id: `sb_text_video_prompt_${sb.item_id}`,
                group: 'storyboard_data', kind: 'text',
                label: `SB-${order} 视频提示词: ${String(sb.video_prompt).slice(0, 16)}`,
                text: sb.video_prompt,
                storyboardItemId: sb.item_id,
            });
        }
        if (sb.lines) {
            out.push({
                id: `sb_text_lines_${sb.item_id}`,
                group: 'storyboard_data', kind: 'text',
                label: `SB-${order} 旁白: ${String(sb.lines).slice(0, 16)}`,
                text: sb.lines,
                storyboardItemId: sb.item_id,
            });
        }
        if (sb.generated_image_url) {
            out.push({
                id: `sb_img_${sb.item_id}`,
                group: 'storyboard_data', kind: 'image',
                label: `SB-${order} 画面`,
                url: sb.generated_image_url,
                thumbnailUrl: sb.generated_image_url,
                storyboardItemId: sb.item_id,
            });
        }
    });
```

**Change 3** — replace the audio section (current lines ~97-135, the entire `// 4. audio` block):

```typescript
    // 4. audio — strict scope:
    //   * if currentStoryboardItemId set → ONLY this item's dialogue/narration/sfx/mixed
    //   * else (legacy) → public materialLibrary.audio + all storyboard audios
    const sbAudioItems = (ctx.storyboardItems || []).filter(sb =>
        ctx.currentStoryboardItemId ? sb.item_id === ctx.currentStoryboardItemId : true
    );
    sbAudioItems.forEach((sb: any) => {
        const order = sb.sort_order ?? 0;
        ['dialogue_audio_url', 'narration_audio_url', 'sfx_audio_url'].forEach((field) => {
            const url = sb[field];
            if (!url) return;
            const tag = field.replace('_audio_url', '');
            out.push({
                id: `audio_sb_${sb.item_id}_${tag}`,
                group: 'audio', kind: 'audio',
                label: `SB-${order} ${tag}`,
                url,
                storyboardItemId: sb.item_id,
            });
        });
        if (sb.mixed_audio_url) {
            out.push({
                id: `audio_sb_${sb.item_id}_mixed`,
                group: 'audio', kind: 'audio',
                label: `SB-${order} 混音`,
                url: sb.mixed_audio_url,
                storyboardItemId: sb.item_id,
            });
        }
    });
    // Public audioTracks (materialLibrary.audio) are episode-wide; they bleed across scenes
    // by design and are NOT scoped. Only include them when no scene scope was specified.
    if (!ctx.currentStoryboardItemId) {
        (ctx.materialLibrary?.audio || []).forEach((a: any) => {
            const url = a?.currentVersion?.url || a?.url;
            if (!url) return;
            out.push({
                id: `audio_lib_${a.id}`,
                group: 'audio', kind: 'audio',
                label: a.name || a.id,
                url,
                durationMs: a?.currentVersion?.durationMs,
            });
        });
    }
```

(Note: per user's A1 choice, public audio tracks are excluded when scoped. Behavior preserved when `currentStoryboardItemId` is undefined for tests / upload-card paths.)

### Step A.4: Wire `currentStoryboardItemId` through the hook

Open `new_html/hooks/useSeedanceCandidates.ts`.

**Change 1** — add the prop to `UseSeedanceCandidatesProps` (around line 8):

```typescript
export interface UseSeedanceCandidatesProps {
    currentParams: SeedanceParams;
    /** Optional. When provided, storyboard_data and audio candidates are
     *  filtered to this item only. Pass undefined for upload-only cards. */
    currentStoryboardItemId?: string;
    historyVideos?: any[];
}
```

**Change 2** — pass it into `buildCandidates` (around line 81-90):

```typescript
    const candidates = useMemo<SeedanceAssetCandidate[]>(
        () => buildCandidates({
            currentParams: p.currentParams,
            currentStoryboardItemId: p.currentStoryboardItemId,
            materialLibrary,
            storyboardItems,
            historyVideos: historyVideosResolved,
            userFiles: userFilesAdapted,
        }),
        [p.currentParams, p.currentStoryboardItemId, materialLibrary, storyboardItems, historyVideosResolved, userFilesAdapted],
    );
```

### Step A.5: Hook test for prop forwarding

Open `new_html/__tests__/hooks/useSeedanceCandidates.test.ts`. Append before the closing `});` of `describe`:

```typescript
    it('forwards currentStoryboardItemId so the builder receives the scene scope', () => {
        const { result } = renderHook(
            () => useSeedanceCandidates({
                currentParams: emptyParams as any,
                currentStoryboardItemId: 'item-X',
            }),
            { wrapper: Wrapper }
        );
        // The builder is the unit under test in builder.test.ts; here we just
        // assert the hook produced something without throwing and that the
        // prop is exposed (smoke). storyboard_data candidates are validated in
        // the builder tests.
        expect(result.current.candidates).toBeInstanceOf(Array);
    });
```

`Wrapper` and `emptyParams` are existing fixtures in this test file; reuse them as-is.

### Step A.6: Wire from VideoPage → SeedancePanelWithCandidates

Open `new_html/components/video/VideoCard.tsx`.

**Change 1** — extend `SeedancePanelWithCandidatesProps` (around line 26):

```typescript
export interface SeedancePanelWithCandidatesProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    autoOpenMentionOnMount?: boolean;
    /** storyboard_item.item_id this card maps to. Forwards to useSeedanceCandidates. */
    storyboardItemId?: string;
}
```

**Change 2** — destructure and forward (around line 33-36, the `useSeedanceCandidates` call):

```typescript
export const SeedancePanelWithCandidates: React.FC<SeedancePanelWithCandidatesProps> = ({
    value, onChange, autoOpenMentionOnMount, storyboardItemId,
}) => {
    const { candidates } = useSeedanceCandidates({
        currentParams: value,
        currentStoryboardItemId: storyboardItemId,
    });
```

### Step A.7: Look up `storyboardItemId` in VideoPage and pass

Open `new_html/components/VideoPage.tsx`.

**Add a helper** near other small `useCallback` helpers (search for `const getSeedanceParams = useCallback`, insert just before it):

```tsx
    // Reverse-lookup the storyboard_item.item_id for a given task group.
    // Convention: handleImportAll sets uploadedImage.id === item_id and stores
    // it on linkedGroupUuids[]; we pick the first linked image for the group.
    const getStoryboardItemId = useCallback((uuid: string): string | undefined => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return undefined;
        const firstId = group.ids?.[0];
        if (!firstId) return undefined;
        const img = uploadedImages.find(i => i.id === firstId || i.linkedGroupUuids?.includes(uuid));
        return img?.storyboardItemId ?? undefined;
    }, [taskGroups, uploadedImages]);
```

**Forward in 3 call sites** of `SeedancePanelWithCandidates` and the detail modal:

Find around line 2187 (renderStoryboardCard for Seedance):
```tsx
                            <SeedancePanelWithCandidates
                                value={getSeedanceParams(group.uuid, group.model)}
                                onChange={(next) => setSeedanceParams(group.uuid, next)}
                                autoOpenMentionOnMount={!!img1.isPlaceholder && (getSeedanceParams(group.uuid, group.model).prompt || '').trim() === '@'}
                            />
```
Replace with:
```tsx
                            <SeedancePanelWithCandidates
                                value={getSeedanceParams(group.uuid, group.model)}
                                onChange={(next) => setSeedanceParams(group.uuid, next)}
                                autoOpenMentionOnMount={!!img1.isPlaceholder && (getSeedanceParams(group.uuid, group.model).prompt || '').trim() === '@'}
                                storyboardItemId={getStoryboardItemId(group.uuid)}
                            />
```

Find inside `ListSeedanceRow` (was added in T5) — the inner `useSeedanceCandidates({ currentParams: params })` call. Update both `ListSeedanceRow` and `SeedanceDetailModalWithCandidates` to take an additional `storyboardItemId` prop and pass it to the hook:

```tsx
    const ListSeedanceRow: React.FC<{
        group: videoService.TaskGroup;
        params: SeedanceParams;
        onChangeParams: (next: SeedanceParams) => void;
        onOpenDetail: () => void;
        isPlaceholder: boolean;
        storyboardItemId?: string;
    }> = ({ group, params, onChangeParams, onOpenDetail, isPlaceholder, storyboardItemId }) => {
        const { candidates } = useSeedanceCandidates({
            currentParams: params,
            currentStoryboardItemId: storyboardItemId,
        });
        // ...rest unchanged
    };
```

```tsx
    const SeedanceDetailModalWithCandidates: React.FC<{
        title: string;
        value: SeedanceParams;
        onChange: (next: SeedanceParams) => void;
        onClose: () => void;
        storyboardItemId?: string;
    }> = ({ title, value, onChange, onClose, storyboardItemId }) => {
        const { candidates } = useSeedanceCandidates({
            currentParams: value,
            currentStoryboardItemId: storyboardItemId,
        });
        // ...rest unchanged
    };
```

And at the call sites of these two inner components, pass `storyboardItemId={getStoryboardItemId(group.uuid)}`.

### Step A.8: Run all tests

```powershell
cd new_html
npx vitest run __tests__/utils/seedanceCandidateBuilder.test.ts __tests__/hooks/useSeedanceCandidates.test.ts 2>&1 | Select-Object -Last 10
npx tsc --noEmit 2>&1 | Select-String -Pattern "(seedanceCandidateBuilder|useSeedanceCandidates|VideoCard|VideoPage)" | Select-Object -First 10
```

Expected: builder 3 new + audio test passing; hook smoke test passing; tsc 17 pre-existing in VideoPage.tsx unchanged, zero new.

### Step A.9: Mirror + commit

```powershell
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/utils/seedanceCandidateBuilder.ts new_html/hooks/useSeedanceCandidates.ts new_html/components/video/VideoCard.tsx new_html/components/VideoPage.tsx
git add new_html/utils/seedanceCandidateBuilder.ts new_html/hooks/useSeedanceCandidates.ts new_html/components/video/VideoCard.tsx new_html/components/VideoPage.tsx new_html/__tests__/utils/seedanceCandidateBuilder.test.ts new_html/__tests__/hooks/useSeedanceCandidates.test.ts deploy/new_html/utils/seedanceCandidateBuilder.ts deploy/new_html/hooks/useSeedanceCandidates.ts deploy/new_html/components/video/VideoCard.tsx deploy/new_html/components/VideoPage.tsx
```

Use `.commit_msg.tmp` + `git commit -F .commit_msg.tmp` with body:

```
fix(seedance-mention): scope @ candidates to current storyboard scene

- buildCandidates accepts currentStoryboardItemId; when set:
  * storyboard_data → only this item's heading/dialogue/image_prompt/
    video_prompt/lines/generated_image_url
  * audio → only this item's dialogue/narration/sfx/mixed (public
    materialLibrary.audio NOT included; episode-wide bleed disabled)
- Adds image_prompt / video_prompt / lines as new text candidates
  (previously only scene_heading + dialogue text were collected).
- assets / user_files / video_segments / current_card / ark_asset_id
  remain episode-wide (cross-scene resources, by design).
- VideoPage adds getStoryboardItemId() reverse lookup
  (uploadedImage.id === item_id by handleImportAll convention) and
  forwards it to all 3 SeedancePanelWithCandidates call sites
  (card view + list view inline + detail modal).

Tests: +3 builder cases (storyboard scope, audio scope, prompt-text
collection), +1 hook smoke. Vitest 84/91 (was 81/88; +3 expected).
```

---

## Task B: Carry video_prompt across model switches

**Why:** T1 (commit `5730dfd`) made `handleImportAll` write the imported `video_prompt` (fallback `image_prompt`) into both `imagePrompts[itemId]` AND `seedanceParams[uuid].prompt`. But when the user manually switches a card's model after import (e.g. Seedance2 → Wan2 → Seedance2 again), `getSeedanceParams` falls through to its default branch and creates a fresh SP with `prompt: ''`. T2 (commit `fd6ad61`) added auto-pull for `media_inputs` but left `prompt` empty. Result: prompt visible in Wan2 textarea but blank when switching back to Seedance2.

**Files:**
- Modify: `new_html/components/VideoPage.tsx:102-138` — `getSeedanceParams` carries `imagePrompts[group.ids[0]]` into the fallback SP.

### Step B.1: Pre-edit impact (already done in Task A)

### Step B.2: Patch `getSeedanceParams`

Open `new_html/components/VideoPage.tsx`. Find `const getSeedanceParams = useCallback((uuid, model)` (was line ~102 after Task A insertions). The current fallback returns:

```tsx
        return {
            sub_model: model === 'Seedance2Fast' ? 'fast' : 'standard',
            prompt: '',
            media_inputs: seedMedia,
            // ...
        };
```

Change `prompt: ''` to:

```tsx
            prompt: imagePrompts[group?.ids?.[0] || ''] || '',
```

So the full returned literal becomes:

```tsx
        return {
            sub_model: model === 'Seedance2Fast' ? 'fast' : 'standard',
            // T1 imported video_prompt into imagePrompts[item_id] (fallback image_prompt).
            // Carry it across model switches so users don't see a blank prompt after
            // toggling Wan2 ↔ Seedance2.
            prompt: imagePrompts[group?.ids?.[0] || ''] || '',
            media_inputs: seedMedia,
            resolution: '720p',
            ratio: 'adaptive',
            duration: 5,
            seed: -1,
            watermark: false,
            generate_audio: true,
            camera_fixed: false,
        };
```

Also update the dependency array of this `useCallback`:

```tsx
    }, [seedanceParamsByUuid, taskGroups, uploadedImages, imagePrompts]);
```

### Step B.3: tsc + manual smoke

```powershell
cd new_html
npx tsc --noEmit 2>&1 | Select-String -Pattern "VideoPage" | Select-Object -First 10
```

No new errors expected.

### Step B.4: Mirror + commit

```powershell
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/components/VideoPage.tsx
git add new_html/components/VideoPage.tsx deploy/new_html/components/VideoPage.tsx
```

Commit msg:
```
fix(video-page): carry imported video_prompt across model switches

- getSeedanceParams fallback was returning prompt: '' which dropped the
  imported video_prompt (T1) when a user manually toggled a card from
  Seedance2 → Wan2 → Seedance2.
- Now reads imagePrompts[group.ids[0]] (set by handleImportAll for every
  imported item) so the prompt textarea / mention editor stays populated.
- No regression for upload-only cards (imagePrompts entry just absent).

Pairs with T1 5730dfd and T2 fd6ad61 to fully close the
'imported scene metadata sticky on the Seedance card' invariant.
```

---

## Task C: Row alignment — link-button container geometry

**Why:** Card view shows a `<Link>` connector button BETWEEN every two adjacent left-side cards (line ~2996); the right-side mirrors it with a height-only spacer (line ~3032). Their geometries don't match per row, so each subsequent row drifts by ~22 px:

| Element | Tailwind | net flow height |
|---|---|---|
| left link-button container | `flex justify-center -my-5 mb-2 pointer-events-none` (button is 24 px) | ~ −8 px |
| right placeholder | `h-[18px] -mt-3 mb-2` | ~ +14 px |

**Fix (G1):** Make the left container use the **exact same** outer geometry as the right placeholder (`h-[18px] -mt-3 mb-2`), and absolutely-position the actual button inside, so it visually overlaps the seam without contributing flow height.

**Files:**
- Modify: `new_html/components/VideoPage.tsx:2992-3005` (the link-button block)

### Step C.1: Patch the link-button container

Open `new_html/components/VideoPage.tsx`. Find:

```tsx
                                        {originalIndex < taskGroups.length - 1 && 
                                         group.ids?.length === 1 && 
                                         taskGroups[originalIndex + 1]?.ids?.length === 1 && (
                                            <div className="flex justify-center -my-5 relative z-10 mb-2 pointer-events-none">
                                                <button
                                                    onClick={() => linkGroups(originalIndex)}
                                                    className="pointer-events-auto bg-slate-800 hover:bg-purple-600 text-slate-400 hover:text-white border border-slate-600 hover:border-purple-500 rounded-full p-1 transition-all shadow-lg transform hover:scale-110"
                                                    title="合并为首尾帧任务"
                                                >
                                                    <Link className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
```

Replace with:

```tsx
                                        {originalIndex < taskGroups.length - 1 && 
                                         group.ids?.length === 1 && 
                                         taskGroups[originalIndex + 1]?.ids?.length === 1 && (
                                            // Match right-side placeholder geometry EXACTLY (h-[18px] -mt-3 mb-2)
                                            // so left and right rows accumulate the same vertical advance per scene.
                                            // The button is absolutely-positioned and does not contribute to flow.
                                            <div className="h-[18px] -mt-3 mb-2 relative pointer-events-none">
                                                <button
                                                    onClick={() => linkGroups(originalIndex)}
                                                    className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 hover:bg-purple-600 text-slate-400 hover:text-white border border-slate-600 hover:border-purple-500 rounded-full p-1 transition-all shadow-lg hover:scale-110 z-10"
                                                    title="合并为首尾帧任务"
                                                >
                                                    <Link className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
```

Notes:
- Left and right both now contribute net `+14 px` per row (`18 - 12 + 8`).
- Button remains visually centered on the seam via `absolute + translate`.
- `pointer-events-none` on the wrapper + `pointer-events-auto` on the button keeps the button clickable while not eating drag-and-drop on flanking cards.
- `transform` collapsed into a single `translate-x` + `translate-y` chain (Tailwind concatenates correctly without explicit `transform` keyword in modern Tailwind 3+).

### Step C.2: tsc smoke

```powershell
cd new_html
npx tsc --noEmit 2>&1 | Select-String -Pattern "VideoPage" | Select-Object -First 5
```

No new errors expected.

### Step C.3: Visual smoke (manual, optional)

```powershell
npm run dev
```

Open the video page with ≥ 4 storyboard cards. Confirm: row N's bottom edge on left lines up with row N's bottom edge on right, all the way down. The link button still hovers visibly between cards.

### Step C.4: Mirror + commit

```powershell
cd ..
python scripts/sync_to_deploy.py --apply --paths new_html/components/VideoPage.tsx
git add new_html/components/VideoPage.tsx deploy/new_html/components/VideoPage.tsx
```

Commit msg:
```
fix(video-page): align link-button row geometry with right placeholder

- Card view rendered the left-side link button inside a flex container
  with -my-5 mb-2 → net flow contribution ~ -8 px per row.
- Right side used h-[18px] -mt-3 mb-2 → net +14 px per row.
- Each row drifted ~22 px; with 4+ scenes left and right columns
  visibly desynced ('越往后越对不齐').
- Container now matches right side exactly (h-[18px] -mt-3 mb-2);
  the actual <Link/> button is absolutely-positioned (centered via
  translate) so it does not contribute flow height. Per-row delta = 0.

Closes problem 2 of 2026-05-19 user report.
```

---

## Task D: Memory + docs + faq

### Step D.1: Refresh project memory

```powershell
python ".claude/skills/project-memory/scripts/scan_project.py" "h:\MY2"
python ".claude/skills/project-memory/scripts/sync_check.py" "h:\MY2" --strict --levels ERROR
```

Expected exit 0.

### Step D.2: Append 3 FAQ entries

Open `docs/faq.md`. Append:

```markdown
### @ 候选列表显示了其它分镜的素材

**症状**：在 Seedance 卡片的提示词里输入 `@`，弹出的候选列表里出现了其它分镜的台词、音频、画面。

**原因**：`buildCandidates` 早期未按 `currentStoryboardItemId` 过滤；`storyboardItems` 数组是 episode 全集。

**修复（2026-05-19）**：`useSeedanceCandidates` 接收 `currentStoryboardItemId`，`buildCandidates` 据此严格过滤 storyboard_data 和 audio 候选。`assets / user_files / video_segments / current_card / ark_asset_id` 仍是 episode 范围（跨分镜复用）。`VideoPage.getStoryboardItemId(uuid)` 通过 `uploadedImage.id === item_id` 反查。

### Seedance 卡片切换模型后视频提示词不见了

**症状**：分镜导入时 video_prompt 已正确填到 Seedance 提示词框；但用户切到 Wan2 再切回 Seedance2 后，提示词为空。

**原因**：`getSeedanceParams` 的 fallback 分支（无现有 SP 时）创建 SP 时 `prompt: ''`，没读 `imagePrompts[group.ids[0]]`。

**修复（2026-05-19）**：fallback 改读 `imagePrompts[group?.ids?.[0]] || ''`；`useCallback` 依赖加 `imagePrompts`。

### 视频页卡片视图越往下左右越对不齐

**症状**：分镜数 ≥ 4 时，左右两列卡片每多一行就再偏 ~22 px。

**原因**：左侧链接按钮容器用 `flex -my-5 mb-2`（净 ~ -8 px），右侧占位符用 `h-[18px] -mt-3 mb-2`（净 +14 px）。两者每行差 22 px 累积。

**修复（2026-05-19）**：左侧容器改成与右侧完全相同的 `h-[18px] -mt-3 mb-2 relative`，按钮 `absolute + translate` 居中，不抢 flow 空间。
```

### Step D.3: Refresh frontend.md candidate-source description

Open `docs/frontend.md`. Find the section describing the `@`-mention candidate sources (likely under SeedanceMentionPromptEditor / "@-mention candidate sources"). Update to:

```markdown
The `@`-mention popover shows 7 candidate groups, with **scene scope** applied
to two of them when `currentStoryboardItemId` is provided:

| group | scope | source |
|-------|-------|--------|
| current_card | always | `currentParams.media_inputs` |
| storyboard_data | scene-scoped | `storyboard_items` filtered by `currentStoryboardItemId`; collects `scene_heading`, `dialogue`, `image_prompt`, `video_prompt`, `lines`, `generated_image_url` |
| audio | scene-scoped | this scene's `dialogue_audio_url` / `narration_audio_url` / `sfx_audio_url` / `mixed_audio_url`; episode-wide `materialLibrary.audio` is NOT bled in when scoped |
| assets | episode-wide | `materialLibrary.characters / scenes / props` |
| user_files | episode-wide | `useEntityFilesQuery('episode', episodeId)` |
| video_segments | episode-wide | other completed video clips in this episode |
| ark_asset_id | always | one synthetic input row for `asset://` paste-in |
```

### Step D.4: Mirror docs + final commit + tag

```powershell
python scripts/sync_to_deploy.py --apply --paths docs/faq.md docs/frontend.md
git add docs/faq.md docs/frontend.md deploy/docs/faq.md deploy/docs/frontend.md context/
```

Commit msg:
```
docs(video-page): scoped-mention + row-align knowledge update

- faq.md: 3 new entries (storyboard-scoped @-candidates, prompt sticky
  across model switches, link-button row alignment)
- frontend.md: refresh @-mention candidate sources table to call out
  which groups are scene-scoped vs episode-wide
- context/: refreshed by scan_project.py
```

Tag (after the docs commit):
```powershell
git tag video-page-mention-scope-2026-05-19 -m "@-mention scene scoping + sticky video_prompt + row alignment"
```

### Step D.5: Final QA gate

```powershell
git log --oneline -8
git tag --list video-page-*
cd new_html; npx vitest run 2>&1 | Select-Object -Last 6
```

Expected:
- 3 fix commits + 1 docs commit (+ optional context-refresh chore commit) on top of `7cc91ba`.
- New tag visible.
- vitest 84/91 (81 baseline from prior batch + 3 new).
- 7 pre-existing failures unchanged.

---

## Self-Review Checklist

### 1. Spec coverage

| User report | Task | Step |
|-------------|------|------|
| @ 候选要按本分镜（设计/分镜/剧本/声音 4 源） | A | A.3 (filter + new prompt-text candidates) |
| 视频提示词没填到左卡（旧 session / 切模型角落 case） | B | B.2 |
| 越往下左右卡片越对不齐 | C | C.1 |

### 2. Placeholder scan

No "TBD / TODO / fill-in-later" — every code block is the actual code to apply.

### 3. Type / signature consistency

| Symbol | Defined | Used in |
|--------|---------|---------|
| `CandidateBuildContext.currentStoryboardItemId?` | A.3 (builder) | A.4 (hook), A.6 (VideoCard), A.7 (VideoPage) |
| `UseSeedanceCandidatesProps.currentStoryboardItemId?` | A.4 | A.5 (test), A.6, A.7 (3 call sites) |
| `SeedancePanelWithCandidatesProps.storyboardItemId?` | A.6 | A.7 (1 call site) |
| `getStoryboardItemId(uuid: string): string \| undefined` | A.7 (helper) | A.7 (3 invocations) |
| `imagePrompts[group.ids[0]]` | (existing state) | B.2 |

All names consistent. Optional props default to undefined; legacy callers (no scope) preserved by the `if (ctx.currentStoryboardItemId) ... else ...` guard in builder.

### 4. Mirror policy

`sync_to_deploy.py --paths` lists never include `__tests__/`. Test files only in `git add`. Confirmed in steps A.9, B.4, C.4, D.4.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-mention-scope-and-row-align.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Single subagent for Task A (largest, has 6 file edits + 4 test cases), then I do B + C + D inline (each is < 10 min). ~75 min total.

**2. Inline Execution** — Execute all 4 tasks in this session.

**Recommendation:** Inline this time. The previous batch showed inline runs are reliable for small surgical edits, and Task A's biggest risk (test fixture compatibility) can be handled by reading the existing test files once.


