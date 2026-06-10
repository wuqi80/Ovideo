# Storyboard → Video Page Import Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storyboard → video page import a complete content migration (empty frames + per-shot audio mix + per-shot duration + existing frames), and add Seedance prompt `@`-mentions for asset selection from material library / media library / current card / storyboard data / history / Ark `asset://` IDs with auto token management.

**Architecture:** New backend service `audio_mix_service.py` (ffmpeg `amix` with hash cache) exposed via `POST /api/storyboard/mix-audio`. New frontend pure utils (`durationMapping.ts`, `seedanceMedia.ts`, `seedanceCandidateBuilder.ts`) sit under one new hook layer (`useReactiveDuration`, `useSeedanceCandidates`) and one new component layer (`CardDurationField`, `SeedanceMentionPromptEditor`, `SeedanceAssetPickerModal`). Existing `VideoGenPage.handleImportAll` rewritten to no longer filter empty storyboards; existing `VideoPage` adds placeholder cards, audio badges, manual sync modal. `SeedanceMultimodalPanel` swaps its plain `<textarea>` for the new mention editor and adds a `+ 插入素材` button.

**Tech Stack:** React 18, TypeScript 5, Vite, Vitest, Testing Library, FastAPI, Python 3.11, ffmpeg, PostgreSQL, Volcengine Ark Seedance API.

**Reference Spec:** `docs/superpowers/specs/2026-05-17-storyboard-video-import-completeness-design.md`

**Superseded:** `docs/superpowers/plans/2026-05-16-seedance-asset-mentions.md` (1460 lines, never implemented; mention design is folded into Task 3/4/5/6 below).

**Pre-flight checks (run these first, before Task 1):**

```powershell
# Stale-index check
npx gitnexus analyze

# Impact check on every file we will edit (read each output, expand reverse-deps if surprising)
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/services/videoService.ts" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/SeedanceMultimodalPanel.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/VideoPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/pages/VideoGenPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "api_routes.py" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "worker.py" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "dao_storyboard.py" --brief
```

If any impact result shows a page outside the expected slice (VideoGenPage / VideoPage / StoryboardGenPage / GenerationPage / EpisodeContext), STOP and re-read the spec; we likely missed a consumer.

---

## File Structure

### Create

| Path | Responsibility |
|---|---|
| `db_migration_storyboard_audio_mix.sql` | `ALTER TABLE storyboard_items ADD COLUMN mixed_audio_url TEXT, mixed_audio_hash VARCHAR(64)` |
| `audio_mix_service.py` | ffmpeg `amix` wrapper with sha1 hash cache, single entry point `mix_storyboard_audio(item_id, dialogue, narration, sfx, gains) → MixResult` |
| `tests/test_audio_mix_service.py` | Cache hit, 3-track mix, single-track passthrough, ffmpeg failure fallback |
| `new_html/utils/seedanceMedia.ts` | Mention types + pure helpers: `nextTokenIndex`, `insertMention`, `removeMediaInput`, `canonicalizePrompt`, `shouldEnableWebSearch`, `parseArkAssetId` |
| `new_html/utils/seedanceCandidateBuilder.ts` | `buildCandidates(ctx) → SeedanceAssetCandidate[]` for the 7 source groups |
| `new_html/utils/durationMapping.ts` | `clampSec`, `computeReactiveDuration` (audio > planned > 5s) |
| `new_html/hooks/useReactiveDuration.ts` | React hook wrapping `computeReactiveDuration`, honors `durationUserOverride` |
| `new_html/hooks/useSeedanceCandidates.ts` | Memo-merge of EpisodeContext + useEntityFilesQuery + history → `SeedanceAssetCandidate[]` |
| `new_html/components/video/CardDurationField.tsx` | Generic duration input (3–15s), shows ↺ when user-overridden |
| `new_html/components/SeedanceMentionPromptEditor.tsx` | Controlled prompt editor with `@` popover + token auto-management |
| `new_html/components/SeedanceAssetPickerModal.tsx` | `+ 插入素材` modal, multi-select, shares candidate data source with the popover |
| `new_html/__tests__/utils/durationMapping.test.ts` | clampSec edges + 5 branches of computeReactiveDuration |
| `new_html/__tests__/utils/seedanceMedia.test.ts` | nextTokenIndex / insertMention / removeMediaInput renumbering / canonicalizePrompt / shouldEnableWebSearch / parseArkAssetId |
| `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts` | All 7 groups across empty / partial / full episode fixtures |
| `new_html/__tests__/hooks/useReactiveDuration.test.ts` | userOverride lock, media change recompute, missing meta fallback |
| `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx` | `@` trigger conditions, token append, delete renumber, autoOpenOnMount, IME compositionstart suppression, Modal multi-select |

### Modify

| Path | Lines (current → after, approximate) | What changes |
|---|---|---|
| `api_routes.py` | + ~80 lines | Add `MixAudioRequest` / `MixAudioResponse` Pydantic, `POST /api/storyboard/mix-audio` handler |
| `dao_storyboard.py` | + ~25 lines | Read/write `mixed_audio_url`, `mixed_audio_hash` |
| `worker.py` | + ~10 lines | Pass-through `tools: [{type: "web_search"}]` for Seedance text-only path |
| `new_html/services/videoService.ts` | + ~70 lines | Extend `TaskGroup` (`duration`, `durationUserOverride`), `UploadedImage` (`isPlaceholder`, `storyboardItemId`, `sortOrder`), add `StoryboardMeta`, extend `WorkspaceSession`, add `mixStoryboardAudio()` client function |
| `new_html/pages/VideoGenPage.tsx` | rewrite `handleImportAll` (~150 lines net) | No empty-frame filtering, collect storyboard_meta, async batch mix-audio (concurrency 3), patch session as results return |
| `new_html/components/VideoPage.tsx` | + ~120 lines | Placeholder card variant, audio badges (3 tracks + mixed indicator), `↻ 同步分镜` button + sync modal (3 options), append session-load token validation |
| `new_html/components/SeedanceMultimodalPanel.tsx` | rewrite prompt area (~50 lines net) | Replace `<textarea>` with `SeedanceMentionPromptEditor`, remove inline duration input (handled by CardDurationField outside), add `+ 插入素材` button → opens `SeedanceAssetPickerModal` |
| `docs/api.md` | + ~40 lines | Document `POST /api/storyboard/mix-audio` |
| `docs/database.md` | + 2 rows | New columns `mixed_audio_url`, `mixed_audio_hash` |
| `docs/frontend.md` | + ~30 lines | VideoGenPage import flow update + Seedance mention editor |
| `docs/vertical-slices.md` | + 1 page section | New per-page slice for VideoPage covering placeholders + audio + sync modal + mention picker |
| `docs/faq.md` | + 2 entries | "空分镜也能导入" + "Seedance prompt @ 不弹 popover 排错" |
| `docs/conventions.md` | + 2 lines | Duration field convention; Seedance prompt convention |
| `docs/superpowers/plans/2026-05-16-seedance-asset-mentions.md` | header only | Add `Status: Superseded by 2026-05-17 spec` |
| `docs/superpowers/specs/2026-05-16-seedance-asset-mentions-design.md` | header only | Same superseded marker |
| `deploy/` mirror | sync via script | Run `python scripts/sync_to_deploy.py --apply` after every committed change to root |

---

## Task Index

1. **Schema & Types** — DB migration, type extensions in `videoService.ts` and `seedanceMedia.ts`
2. **Backend** — `audio_mix_service`, `POST /api/storyboard/mix-audio`, DAO, worker `tools` pass-through
3. **Frontend Pure Utils + Tests** — `durationMapping`, `seedanceMedia`, `seedanceCandidateBuilder`
4. **Frontend Hooks + Tests** — `useReactiveDuration`, `useSeedanceCandidates`
5. **Frontend UI Components** — `CardDurationField`, `SeedanceMentionPromptEditor`, `SeedanceAssetPickerModal`, refactor `SeedanceMultimodalPanel`
6. **Frontend Integration** — `VideoGenPage.handleImportAll` rewrite, `VideoPage` placeholders/badges/sync modal
7. **Docs** — apply Change → Doc Mapping
8. **Memory** — `scan_project.py`, `sync_check.py --strict --levels ERROR`, `sync_to_deploy.py --apply`
9. **Cleanup** — Mark old plan/spec superseded, update todos, final smoke test

---

## Task 1: Schema & Types

**Goal:** Land DB columns and TypeScript types so all later code can reference the contract.

**Files:**
- Create: `db_migration_storyboard_audio_mix.sql`
- Modify: `dao_storyboard.py` (only column constants / column list, full R/W in Task 2)
- Modify: `new_html/services/videoService.ts`
- Create: `new_html/utils/seedanceMedia.ts` (types only, helpers in Task 3)

- [ ] **Step 1.1: Run impact_check on the schema files we'll touch**

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "db_migration_storyboard_items.sql" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "dao_storyboard.py" --brief
```

Expected: Reverse pages includes `StoryboardGenPage`, `VideoGenPage`, `VideoPage`. Routes include `/api/projects/*/storyboard-items`, `/api/storyboard-items*`. If anything else shows, flag in commit message.

- [ ] **Step 1.2: Create the DB migration file**

Create `db_migration_storyboard_audio_mix.sql`:

```sql
-- 2026-05-17: storyboard_items add mixed audio cache columns
-- For: spec docs/superpowers/specs/2026-05-17-storyboard-video-import-completeness-design.md §3.2
-- Idempotent: uses IF NOT EXISTS

DO $$
BEGIN
    RAISE NOTICE '[migration] storyboard_audio_mix start at %', clock_timestamp();
END
$$;

ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS mixed_audio_url  TEXT,
    ADD COLUMN IF NOT EXISTS mixed_audio_hash VARCHAR(64);

COMMENT ON COLUMN storyboard_items.mixed_audio_url  IS 'Backend-mixed reference audio URL; cached via mixed_audio_hash';
COMMENT ON COLUMN storyboard_items.mixed_audio_hash IS 'sha1 of (dialogue_url|narration_url|sfx_url|gains); same hash → reuse mixed_audio_url';

-- Optional index to look up by hash for cache reuse across episodes
CREATE INDEX IF NOT EXISTS idx_storyboard_items_mixed_audio_hash
    ON storyboard_items (mixed_audio_hash)
    WHERE mixed_audio_hash IS NOT NULL;

DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'storyboard_items'
      AND column_name IN ('mixed_audio_url', 'mixed_audio_hash');
    IF col_count <> 2 THEN
        RAISE EXCEPTION '[migration] expected 2 new columns, found %', col_count;
    END IF;
    RAISE NOTICE '[migration] storyboard_audio_mix done at %', clock_timestamp();
END
$$;
```

- [ ] **Step 1.3: Apply the migration to the dev database**

```powershell
# Substitute connection string from your .env
psql "%DATABASE_URL%" -f db_migration_storyboard_audio_mix.sql
```

Expected output: 2 `NOTICE` lines (start/done), no errors.

Verify:

```powershell
psql "%DATABASE_URL%" -c "\d storyboard_items" | findstr /i "mixed_audio"
```

Expected: 2 lines listing `mixed_audio_url text` and `mixed_audio_hash varchar(64)`.

- [ ] **Step 1.4: Mirror migration to deploy/ and run scan**

```powershell
python scripts/sync_to_deploy.py --apply --paths db_migration_storyboard_audio_mix.sql
python ".claude/skills/project-memory/scripts/scan_project.py" "h:\MY2"
```

Verify `context/database.json` now includes the two new columns:

```powershell
python -c "import json; d=json.load(open('context/database.json',encoding='utf-8')); cols=[c['name'] for c in d['tables']['storyboard_items']['columns']]; print('mixed_audio_url' in cols, 'mixed_audio_hash' in cols)"
```

Expected: `True True`

- [ ] **Step 1.5: Extend `videoService.ts` types**

Modify `new_html/services/videoService.ts` (locate the `TaskGroup` and `UploadedImage` interfaces, and the `WorkspaceSession` interface).

Add the new `StoryboardMeta` interface (place it just above `WorkspaceSession`):

```typescript
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
    lastSyncedAt?: number;
}
```

Extend `TaskGroup`:

```typescript
export interface TaskGroup {
    uuid: string;
    ids: string[];
    model: VideoModel;
    shotType?: ShotType;
    duration?: number;                    // 通用时长（秒，3–15）
    durationUserOverride?: boolean;       // true 后响应式规则不再自动改
}
```

Extend `UploadedImage`:

```typescript
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
    isPlaceholder?: boolean;              // true = 空分镜
    storyboardItemId?: string;            // 反查 storyboard_meta
    sortOrder?: number;                   // 显示顺序
}
```

Extend `WorkspaceSession`:

```typescript
export interface WorkspaceSession {
    task_groups: TaskGroup[];
    uploaded_images: UploadedImage[];
    image_prompts: Record<string, string>;
    tasks_status: Record<string, TaskStatus>;
    seedance_params?: Record<string /* groupUuid */, SeedanceParams>;
    storyboard_meta?: Record<string /* itemId */, StoryboardMeta>;
}
```

Append the `mixStoryboardAudio` client function near the bottom of the file (just after the existing `saveWorkspaceSession`):

```typescript
export interface MixStoryboardAudioRequest {
    item_id: string;
    dialogue_url?: string;
    narration_url?: string;
    sfx_url?: string;
    dialogue_gain_db?: number;
    narration_gain_db?: number;
    sfx_gain_db?: number;
}

export interface MixStoryboardAudioResponse {
    success: boolean;
    mixed_audio_url: string;
    cached: boolean;
    duration_ms: number;
}

export async function mixStoryboardAudio(
    body: MixStoryboardAudioRequest,
): Promise<MixStoryboardAudioResponse> {
    const token = localStorage.getItem('auth_token') || '';
    const resp = await fetch('/api/storyboard/mix-audio', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`mix-audio failed: ${resp.status} ${await resp.text()}`);
    }
    return resp.json();
}
```

- [ ] **Step 1.6: Create `seedanceMedia.ts` (types only)**

⚠️ Pre-existing fact: `SeedanceMediaInput` / `SeedanceMediaKind` / `SeedanceMediaRole` already live in `new_html/services/videoService.ts` lines 57–65, and `SeedanceParams.duration` already exists at line 73. We DO NOT re-define them; we import and extend.

Two consumers of those existing types: `videoService.ts` itself (export site) and `components/SeedanceMultimodalPanel.tsx`. No other file imports them, so no migration cost.

Create `new_html/utils/seedanceMedia.ts` with **mention-specific types only** (helpers come in Task 3 alongside their tests):

```typescript
// new_html/utils/seedanceMedia.ts
// Pure types for Seedance @-mention support. Helpers live below in Task 3.
// Re-uses SeedanceMediaInput / SeedanceMediaKind / SeedanceMediaRole from videoService.ts.

import type {
    SeedanceMediaInput,
    SeedanceMediaKind,
    SeedanceMediaRole,
    SeedanceParams,
} from '../services/videoService';

export type { SeedanceMediaInput, SeedanceMediaKind, SeedanceMediaRole };

// ⭐ New: extra optional fields used only at mention-insertion time, not persisted on the task.
export interface SeedanceMentionMeta {
    arkAssetId?: string;          // user-typed asset:// id
    label?: string;               // popover display label snapshot
    sourceId?: string;            // back-reference to candidate
}

export type SeedanceCandidateGroup =
    | 'current_card'
    | 'storyboard_data'
    | 'assets'
    | 'audio'
    | 'video_segments'
    | 'user_files'
    | 'ark_asset_id';

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

// Token format constants. Helpers in Task 3 will use these.
export const TOKEN_PREFIX: Record<SeedanceMediaKind, string> = {
    image: '图片',
    video: '视频',
    audio: '音频',
};

// Convenience type alias used in helpers
export type WithSeedanceParams = Pick<SeedanceParams, 'prompt' | 'media_inputs' | 'sub_model'>;
```

Note: `SeedanceMediaInput` in the existing file allows only `{ kind, url, role?, file_id? }` — it does NOT yet have `arkAssetId` / `label` / `sourceId`. We do NOT change that shape (it's serialized to backend); mention-time metadata lives separately on candidate / per-insertion temp state, not on the persisted media input. Helpers in Task 3 must accept `SeedanceMediaInput` as-is.

- [ ] **Step 1.7: Commit Task 1**

```powershell
git add db_migration_storyboard_audio_mix.sql `
        deploy/db_migration_storyboard_audio_mix.sql `
        new_html/services/videoService.ts `
        new_html/utils/seedanceMedia.ts
git commit -m "feat(types): schema + TS types for storyboard audio mix and Seedance mentions

- DB: storyboard_items.mixed_audio_url, mixed_audio_hash + idx
- TS: TaskGroup.duration / durationUserOverride
- TS: UploadedImage.isPlaceholder / storyboardItemId / sortOrder
- TS: StoryboardMeta + WorkspaceSession.storyboard_meta
- TS: mixStoryboardAudio() client
- TS: seedanceMedia.ts type-only stub for Task 3 helpers

Spec: docs/superpowers/specs/2026-05-17-storyboard-video-import-completeness-design.md"
```

Verify post-commit:

```powershell
python scripts/sync_to_deploy.py --check
```

Expected: `[OK] no drift between root and deploy/`

---

## Task 2: Backend — `audio_mix_service`, `mix-audio` route, DAO, worker `tools` pass-through

**Goal:** Backend can mix dialogue + narration + sfx into one cached file and Seedance text-only path passes `tools: [{type: "web_search"}]` to Ark.

**Files:**
- Create: `audio_mix_service.py`
- Create: `tests/test_audio_mix_service.py`
- Modify: `dao_storyboard.py` (allowed set, ~line 129)
- Modify: `api_routes.py` (add Pydantic + handler)
- Modify: `seedance_api.py` (add `tools` parameter to `create_video_task`)
- Modify: `worker.py` (line ~1113 kwargs block: pass `tools` if present in `task.data`)

- [ ] **Step 2.1: Write `tests/test_audio_mix_service.py`**

```python
# tests/test_audio_mix_service.py
import asyncio
import hashlib
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from audio_mix_service import (
    MixInput,
    MixResult,
    compute_mix_hash,
    mix_storyboard_audio,
)


def test_compute_mix_hash_is_stable_and_order_independent():
    a = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    # Same inputs → same hash
    b = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    assert a == b
    assert len(a) == 40  # sha1 hex


def test_compute_mix_hash_changes_when_gain_changes():
    a = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    b = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=-1.5, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    assert a != b


@pytest.mark.asyncio
async def test_mix_returns_cached_when_hash_matches(tmp_path, monkeypatch):
    """If storyboard_items.mixed_audio_hash == newly computed hash, skip ffmpeg and return cached URL."""
    item_id = "sb_test_01"
    cached_url = "/storage/audio/mixed_cached.mp3"

    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id,
        "mixed_audio_url": cached_url,
        "mixed_audio_hash": None,  # filled after first hash compute below
    })
    fake_dao.update = AsyncMock(return_value={"item_id": item_id})

    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )
    expected_hash = compute_mix_hash(inp)
    fake_dao.get_by_id.return_value["mixed_audio_hash"] = expected_hash

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._run_ffmpeg_mix", new=AsyncMock()) as mock_ff:
        result: MixResult = await mix_storyboard_audio(item_id, inp)

    assert result.cached is True
    assert result.mixed_audio_url == cached_url
    mock_ff.assert_not_called()


@pytest.mark.asyncio
async def test_mix_runs_ffmpeg_and_persists_when_no_cache(tmp_path):
    item_id = "sb_test_02"
    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )

    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id, "mixed_audio_url": None, "mixed_audio_hash": None,
    })
    fake_dao.update = AsyncMock(return_value={"item_id": item_id})

    fake_save = AsyncMock(return_value={"file_url": "/storage/audio/mixed_new.mp3", "duration_ms": 4500})

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._run_ffmpeg_mix", new=AsyncMock(return_value="/tmp/out.mp3")), \
         patch("audio_mix_service.save_generated_file_to_db", new=fake_save):
        result: MixResult = await mix_storyboard_audio(item_id, inp)

    assert result.cached is False
    assert result.mixed_audio_url == "/storage/audio/mixed_new.mp3"
    assert result.duration_ms == 4500
    fake_dao.update.assert_called_once()
    args, kwargs = fake_dao.update.call_args
    assert kwargs.get("mixed_audio_url") == "/storage/audio/mixed_new.mp3"
    assert kwargs.get("mixed_audio_hash") == compute_mix_hash(inp)


@pytest.mark.asyncio
async def test_mix_passes_through_when_only_one_track():
    """Single dialogue track: return it as-is, no mixing, but still cache."""
    item_id = "sb_test_03"
    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )

    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id, "mixed_audio_url": None, "mixed_audio_hash": None,
    })
    fake_dao.update = AsyncMock(return_value={"item_id": item_id})

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._run_ffmpeg_mix", new=AsyncMock(return_value="/tmp/probe.mp3")) as mock_ff, \
         patch("audio_mix_service.save_generated_file_to_db",
               new=AsyncMock(return_value={"file_url": "/storage/audio/x.mp3", "duration_ms": 3000})):
        result = await mix_storyboard_audio(item_id, inp)

    assert result.cached is False
    # Single-track path may still touch ffmpeg for re-encode/probe; that's acceptable
    # as long as the result stores the dialogue URL semantics.
    assert result.mixed_audio_url == "/storage/audio/x.mp3"


@pytest.mark.asyncio
async def test_mix_raises_when_all_tracks_empty():
    inp = MixInput(
        dialogue_url=None, narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )
    with pytest.raises(ValueError, match="at least one"):
        await mix_storyboard_audio("sb_test_04", inp)


@pytest.mark.asyncio
async def test_mix_propagates_ffmpeg_failure():
    item_id = "sb_test_05"
    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )
    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id, "mixed_audio_url": None, "mixed_audio_hash": None,
    })

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._run_ffmpeg_mix",
               new=AsyncMock(side_effect=RuntimeError("ffmpeg not found"))):
        with pytest.raises(RuntimeError, match="ffmpeg"):
            await mix_storyboard_audio(item_id, inp)
```

- [ ] **Step 2.2: Run tests, expect failure**

```powershell
pytest tests/test_audio_mix_service.py -v
```

Expected: All 6 tests FAIL with `ModuleNotFoundError: No module named 'audio_mix_service'`.

- [ ] **Step 2.3: Implement `audio_mix_service.py`**

Create `audio_mix_service.py` at the project root (next to `worker.py`, `api_routes.py`):

```python
# audio_mix_service.py
"""Backend audio mixing for storyboard reference_audio.

Combines dialogue / narration / sfx tracks via ffmpeg `amix`, caching results
by sha1 hash of (urls + gains) on `storyboard_items.mixed_audio_*` columns.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Optional

import aiohttp

from dao_storyboard import StoryboardDAO
from file_service import save_generated_file_to_db

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MixInput:
    dialogue_url: Optional[str]
    narration_url: Optional[str]
    sfx_url: Optional[str]
    dialogue_gain_db: float = 0.0
    narration_gain_db: float = -3.0
    sfx_gain_db: float = -8.0


@dataclass
class MixResult:
    success: bool
    mixed_audio_url: str
    cached: bool
    duration_ms: int


def compute_mix_hash(inp: MixInput) -> str:
    """sha1 of canonical (urls + gains) string."""
    parts = [
        inp.dialogue_url or "",
        inp.narration_url or "",
        inp.sfx_url or "",
        f"{inp.dialogue_gain_db:.2f}",
        f"{inp.narration_gain_db:.2f}",
        f"{inp.sfx_gain_db:.2f}",
    ]
    payload = "|".join(parts).encode("utf-8")
    return hashlib.sha1(payload).hexdigest()


async def _download(url: str, dest: str) -> None:
    """Download URL or copy local /storage/* path into dest."""
    if url.startswith("/"):
        # Local path under FastAPI static mount; map to disk
        from cluster_main import resolve_storage_path  # local helper
        local = resolve_storage_path(url)
        shutil.copy2(local, dest)
        return
    async with aiohttp.ClientSession() as sess:
        async with sess.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as f:
                async for chunk in resp.content.iter_chunked(64 * 1024):
                    f.write(chunk)


async def _run_ffmpeg_mix(
    inputs: list[tuple[str, float]],   # [(local_path, gain_db), ...]
    output_path: str,
) -> str:
    """Invoke ffmpeg amix; raise RuntimeError on failure. Returns output_path."""
    if not inputs:
        raise ValueError("ffmpeg mix requires at least one input")

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH")

    cmd: list[str] = ["ffmpeg", "-y", "-loglevel", "error"]
    for path, _gain in inputs:
        cmd.extend(["-i", path])

    if len(inputs) == 1:
        # Single-track: still re-encode to normalize (mp3 192k)
        cmd.extend(["-codec:a", "libmp3lame", "-b:a", "192k", output_path])
    else:
        # Build amix filter with per-input volume
        filter_chunks = []
        labels = []
        for i, (_, gain) in enumerate(inputs):
            label = f"[a{i}]"
            filter_chunks.append(f"[{i}:a]volume={gain}dB{label}")
            labels.append(label)
        filter_chunks.append(
            f"{''.join(labels)}amix=inputs={len(inputs)}:duration=longest:dropout_transition=0[mix]"
        )
        cmd.extend([
            "-filter_complex", ";".join(filter_chunks),
            "-map", "[mix]",
            "-codec:a", "libmp3lame", "-b:a", "192k",
            output_path,
        ])

    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (rc={proc.returncode}): {stderr.decode(errors='replace')[:500]}")
    return output_path


async def mix_storyboard_audio(item_id: str, inp: MixInput) -> MixResult:
    """Mix dialogue/narration/sfx into one file. Cache by hash on storyboard_items row."""
    if not (inp.dialogue_url or inp.narration_url or inp.sfx_url):
        raise ValueError("mix_storyboard_audio requires at least one non-None url")

    target_hash = compute_mix_hash(inp)

    row = await StoryboardDAO.get_by_id(item_id)
    if not row:
        raise LookupError(f"storyboard item not found: {item_id}")

    if row.get("mixed_audio_hash") == target_hash and row.get("mixed_audio_url"):
        logger.info(f"[mix-audio] cache hit for {item_id} hash={target_hash[:8]}")
        return MixResult(
            success=True,
            mixed_audio_url=row["mixed_audio_url"],
            cached=True,
            duration_ms=int(row.get("audio_duration_ms") or 0),
        )

    # Cache miss: download + mix
    with tempfile.TemporaryDirectory(prefix="mix_audio_") as tmpdir:
        track_specs = [
            (inp.dialogue_url, inp.dialogue_gain_db),
            (inp.narration_url, inp.narration_gain_db),
            (inp.sfx_url, inp.sfx_gain_db),
        ]
        local_inputs: list[tuple[str, float]] = []
        for i, (url, gain) in enumerate(track_specs):
            if not url:
                continue
            local_path = os.path.join(tmpdir, f"in_{i}.mp3")
            await _download(url, local_path)
            local_inputs.append((local_path, gain))

        output_path = os.path.join(tmpdir, "mixed.mp3")
        await _run_ffmpeg_mix(local_inputs, output_path)

        # Save into our file-service so it gets a /storage URL + duration
        saved = await save_generated_file_to_db(
            file_path=output_path,
            entity_type="storyboard_item",
            entity_id=item_id,
            file_kind="mixed_audio",
            episode_id=row.get("episode_id"),
        )
        mixed_url = saved["file_url"]
        duration_ms = int(saved.get("duration_ms") or 0)

    await StoryboardDAO.update(
        item_id,
        mixed_audio_url=mixed_url,
        mixed_audio_hash=target_hash,
    )

    logger.info(f"[mix-audio] generated for {item_id} hash={target_hash[:8]} url={mixed_url}")
    return MixResult(success=True, mixed_audio_url=mixed_url, cached=False, duration_ms=duration_ms)
```

- [ ] **Step 2.4: Run tests, expect pass**

```powershell
pytest tests/test_audio_mix_service.py -v
```

Expected: 6 PASS. If `test_mix_passes_through_when_only_one_track` fails because the implementation took an early-return branch that bypassed `save_generated_file_to_db`, adjust the implementation to **always** persist (not the test) — single track is rare and consistency matters more than the saved encode pass.

If `save_generated_file_to_db` signature in your tree differs from `(file_path, entity_type, entity_id, file_kind, episode_id)`, look up `file_service.py:save_generated_file_to_db` and adapt the kwargs in BOTH the implementation and the test mocks. Do not silently change one side.

- [ ] **Step 2.5: Modify `dao_storyboard.py` `update.allowed`**

Locate the `allowed = {...}` set inside `update()` (currently around line 129) and add the two new keys:

```python
allowed = {
    'sort_order', 'scene_heading', 'action_text', 'dialogue',
    'camera_movement', 'image_prompt', 'video_prompt',
    'generated_image_url', 'status',
    'dialogue_audio_url', 'narration_audio_url', 'sfx_audio_url',
    'audio_duration_ms', 'planned_duration_ms',
    'mixed_audio_url', 'mixed_audio_hash',  # ⭐ Task 2
}
```

No other DAO change needed — the function uses the allowed set as a whitelist.

- [ ] **Step 2.6: Add `POST /api/storyboard/mix-audio` route in `api_routes.py`**

Find a section that defines other storyboard routes (search for `@router.post("/api/storyboard-items"` or similar). Add the following at the end of that section:

```python
class MixAudioRequest(BaseModel):
    item_id: str
    dialogue_url: Optional[str] = None
    narration_url: Optional[str] = None
    sfx_url: Optional[str] = None
    dialogue_gain_db: float = 0.0
    narration_gain_db: float = -3.0
    sfx_gain_db: float = -8.0


class MixAudioResponse(BaseModel):
    success: bool
    mixed_audio_url: str
    cached: bool
    duration_ms: int


@router.post("/api/storyboard/mix-audio", response_model=MixAudioResponse)
async def mix_storyboard_audio_endpoint(
    body: MixAudioRequest,
    user_id: str = Depends(get_current_user),
) -> MixAudioResponse:
    """Mix dialogue / narration / sfx into one reference_audio for a storyboard item.

    Cache: hash of (urls + gains) is stored on `storyboard_items.mixed_audio_hash`;
    same hash → returns existing `mixed_audio_url` without invoking ffmpeg.
    """
    from audio_mix_service import MixInput, mix_storyboard_audio

    if not (body.dialogue_url or body.narration_url or body.sfx_url):
        raise HTTPException(status_code=400, detail="at least one of dialogue/narration/sfx url is required")

    try:
        result = await mix_storyboard_audio(
            body.item_id,
            MixInput(
                dialogue_url=body.dialogue_url,
                narration_url=body.narration_url,
                sfx_url=body.sfx_url,
                dialogue_gain_db=body.dialogue_gain_db,
                narration_gain_db=body.narration_gain_db,
                sfx_gain_db=body.sfx_gain_db,
            ),
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        # ffmpeg missing or ran but failed
        msg = str(e)
        if "ffmpeg not found" in msg:
            raise HTTPException(status_code=503, detail="ffmpeg unavailable on server")
        raise HTTPException(status_code=500, detail=msg)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return MixAudioResponse(
        success=result.success,
        mixed_audio_url=result.mixed_audio_url,
        cached=result.cached,
        duration_ms=result.duration_ms,
    )
```

If `Optional` is not imported at the top of `api_routes.py`, add `from typing import Optional` to the imports section. Verify by re-reading the imports block.

- [ ] **Step 2.7: Smoke-test the route**

Start backend dev server (assume `uvicorn cluster_main:app --reload` or your project's start command), then:

```powershell
# Replace TOKEN with a dev auth_token
$env:TOKEN = "<your_dev_token>"
$body = @{ item_id = "sb_existing_id"; dialogue_url = "https://example.com/a.mp3" } | ConvertTo-Json
curl.exe -X POST "http://localhost:8000/api/storyboard/mix-audio" `
    -H "Content-Type: application/json" `
    -H "Authorization: Bearer $env:TOKEN" `
    -d $body
```

Expected (with a real item_id and a reachable mp3): JSON with `success: true`, `mixed_audio_url` starting with `/storage/`, `cached: false` first time, `cached: true` on second call.

Expected (with a missing item_id): HTTP 404.
Expected (with empty body): HTTP 400.

- [ ] **Step 2.8: Add `tools` parameter to `seedance_api.py:create_video_task`**

In `seedance_api.py`, add `tools` to the signature and propagate to `payload`:

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
    tools: Optional[List[Dict[str, Any]]] = None,  # ⭐ Task 2
) -> str:
    if sub_model not in self.MODEL_MAP:
        raise ValueError(f"不支持的子型号: {sub_model}")

    payload: Dict[str, Any] = {
        "model": self.MODEL_MAP[sub_model],
        "content": contents,
    }
    if resolution:
        payload["resolution"] = resolution
    if ratio:
        payload["ratio"] = ratio
    if duration is not None:
        payload["duration"] = duration
    if seed is not None:
        payload["seed"] = seed
    payload["watermark"] = watermark
    payload["generate_audio"] = generate_audio
    payload["camera_fixed"] = camera_fixed
    if tools:                          # ⭐ Task 2
        payload["tools"] = tools

    # ... rest unchanged ...
```

- [ ] **Step 2.9: Pass-through `tools` in `worker.py`**

Locate `worker.py:_process_seedance_task` (line ~1066). In the `kwargs = dict(...)` block (~line 1113), add a `tools` key:

```python
kwargs = dict(
    resolution=task.data.get('resolution'),
    ratio=task.data.get('ratio') or 'adaptive',
    duration=task.data.get('duration'),
    seed=task.data.get('seed', -1),
    watermark=bool(task.data.get('watermark', False)),
    generate_audio=bool(task.data.get('generate_audio', True)),
    camera_fixed=bool(task.data.get('camera_fixed', False)),
    tools=task.data.get('tools') or None,  # ⭐ Task 2: web_search pass-through
)
```

The frontend (Task 5) will set `task.data.tools` to `[{"type": "web_search"}]` only when `shouldEnableWebSearch(value)` is true. If absent or falsy, no `tools` field is sent and behavior is unchanged.

- [ ] **Step 2.10: Mirror to deploy/ and re-scan**

```powershell
python scripts/sync_to_deploy.py --apply --paths `
    audio_mix_service.py `
    tests/test_audio_mix_service.py `
    dao_storyboard.py `
    api_routes.py `
    seedance_api.py `
    worker.py
python ".claude/skills/project-memory/scripts/scan_project.py" "h:\MY2"
```

Verify the new route is in `context/routes.json`:

```powershell
python -c "import json; r=json.load(open('context/routes.json',encoding='utf-8')); paths=[x['method']+' '+x['path'] for x in r]; print('POST /api/storyboard/mix-audio' in paths)"
```

Expected: `True`

- [ ] **Step 2.11: Run impact_check after the BE landed**

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "audio_mix_service.py" --brief
```

Expected: forward shows `storyboard_items` table; reverse shows api_routes.py (and through that, eventually frontend pages once Task 6 wires it).

- [ ] **Step 2.12: Commit Task 2**

```powershell
git add audio_mix_service.py `
        tests/test_audio_mix_service.py `
        dao_storyboard.py `
        api_routes.py `
        seedance_api.py `
        worker.py `
        deploy/audio_mix_service.py `
        deploy/tests/test_audio_mix_service.py `
        deploy/dao_storyboard.py `
        deploy/api_routes.py `
        deploy/seedance_api.py `
        deploy/worker.py `
        context/routes.json `
        context/database.json `
        context/cross_refs.json
git commit -m "feat(backend): audio mix service + Seedance web_search pass-through

- audio_mix_service.py: ffmpeg amix wrapper with sha1 hash cache
- POST /api/storyboard/mix-audio: 200/cached, 404 unknown item, 503 no ffmpeg
- dao_storyboard: allow mixed_audio_url / mixed_audio_hash on update
- seedance_api / worker: pass tools=[{type: web_search}] when present in task.data
- tests: 6 unit tests covering hash stability, cache hit, mix flow, single-track, ffmpeg failure, empty inputs

Spec: docs/superpowers/specs/2026-05-17-storyboard-video-import-completeness-design.md §3.3, §6.5"
```

---

## Task 3: Frontend Pure Utils + Tests (`durationMapping`, `seedanceMedia` helpers, `seedanceCandidateBuilder`)

**Goal:** All pure helper functions land with full unit tests so the rest of the frontend can compose them confidently.

**Files:**
- Create: `new_html/utils/durationMapping.ts`
- Create: `new_html/__tests__/utils/durationMapping.test.ts`
- Modify: `new_html/utils/seedanceMedia.ts` (append helpers below the types from Task 1)
- Create: `new_html/__tests__/utils/seedanceMedia.test.ts`
- Create: `new_html/utils/seedanceCandidateBuilder.ts`
- Create: `new_html/__tests__/utils/seedanceCandidateBuilder.test.ts`

### 3a. `durationMapping`

- [ ] **Step 3.1: Write `__tests__/utils/durationMapping.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { clampSec, computeReactiveDuration } from '../../utils/durationMapping';

describe('clampSec', () => {
    it('clamps to [3, 15] integer seconds', () => {
        expect(clampSec(0)).toBe(3);
        expect(clampSec(2.4)).toBe(3);
        expect(clampSec(3)).toBe(3);
        expect(clampSec(7.6)).toBe(8);
        expect(clampSec(15)).toBe(15);
        expect(clampSec(99)).toBe(15);
    });
    it('returns fallback for non-finite', () => {
        expect(clampSec(NaN, 5)).toBe(5);
        expect(clampSec(Infinity, 5)).toBe(5);
        expect(clampSec(-Infinity, 5)).toBe(5);
    });
});

describe('computeReactiveDuration', () => {
    it('uses audio durationMs when present', () => {
        expect(computeReactiveDuration({ audioDurationMs: 4200, plannedDurationMs: 9000 })).toBe(4);
    });
    it('falls back to plannedDurationMs when audio missing', () => {
        expect(computeReactiveDuration({ plannedDurationMs: 7400 })).toBe(7);
    });
    it('uses default 5 when both missing', () => {
        expect(computeReactiveDuration({})).toBe(5);
    });
    it('clamps audio to [3, 15]', () => {
        expect(computeReactiveDuration({ audioDurationMs: 1500 })).toBe(3);
        expect(computeReactiveDuration({ audioDurationMs: 22000 })).toBe(15);
    });
    it('treats audioDurationMs of 0 as missing (falls back)', () => {
        expect(computeReactiveDuration({ audioDurationMs: 0, plannedDurationMs: 8000 })).toBe(8);
    });
});
```

- [ ] **Step 3.2: Run tests, expect failure**

```powershell
cd new_html
npx vitest run __tests__/utils/durationMapping.test.ts
```

Expected: FAIL with `Cannot find module '../../utils/durationMapping'`.

- [ ] **Step 3.3: Implement `durationMapping.ts`**

Create `new_html/utils/durationMapping.ts`:

```typescript
// new_html/utils/durationMapping.ts
// Pure helpers for video card duration. No React, no I/O.

export const DURATION_MIN_SEC = 3;
export const DURATION_MAX_SEC = 15;
export const DURATION_DEFAULT_SEC = 5;

export function clampSec(value: unknown, fallback: number = DURATION_DEFAULT_SEC): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.round(n);
    if (rounded < DURATION_MIN_SEC) return DURATION_MIN_SEC;
    if (rounded > DURATION_MAX_SEC) return DURATION_MAX_SEC;
    return rounded;
}

export interface DurationInputs {
    audioDurationMs?: number;
    plannedDurationMs?: number;
}

export function computeReactiveDuration(inputs: DurationInputs): number {
    const { audioDurationMs, plannedDurationMs } = inputs;
    if (audioDurationMs && audioDurationMs > 0) {
        return clampSec(audioDurationMs / 1000);
    }
    if (plannedDurationMs && plannedDurationMs > 0) {
        return clampSec(plannedDurationMs / 1000);
    }
    return DURATION_DEFAULT_SEC;
}
```

- [ ] **Step 3.4: Run tests, expect pass**

```powershell
npx vitest run __tests__/utils/durationMapping.test.ts
```

Expected: 8 PASS.

- [ ] **Step 3.5: Commit 3a**

```powershell
cd ..
git add new_html/utils/durationMapping.ts `
        new_html/__tests__/utils/durationMapping.test.ts
git commit -m "feat(utils): durationMapping (clampSec + computeReactiveDuration)

Pure helpers; 8 unit tests cover edges, fallback chain, clamp ranges.
Used by Task 4 useReactiveDuration hook and Task 5 CardDurationField."
```

### 3b. `seedanceMedia` helpers

- [ ] **Step 3.6: Write `__tests__/utils/seedanceMedia.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
    nextTokenIndex,
    insertMention,
    removeMediaInput,
    canonicalizePrompt,
    shouldEnableWebSearch,
    parseArkAssetId,
} from '../../utils/seedanceMedia';
import type { SeedanceParams } from '../../services/videoService';
import type { SeedanceAssetCandidate } from '../../utils/seedanceMedia';

const baseParams = (over: Partial<SeedanceParams> = {}): SeedanceParams => ({
    sub_model: 'standard',
    prompt: '',
    media_inputs: [],
    duration: 5,
    ...over,
});

const imgCandidate = (over: Partial<SeedanceAssetCandidate> = {}): SeedanceAssetCandidate => ({
    id: 'cand_img_1',
    group: 'assets',
    kind: 'image',
    label: '主角立绘',
    url: '/storage/assets/hero.png',
    ...over,
});

describe('nextTokenIndex', () => {
    it('returns 1 when no media of that kind', () => {
        expect(nextTokenIndex(baseParams(), 'image')).toBe(1);
        expect(nextTokenIndex(baseParams(), 'video')).toBe(1);
        expect(nextTokenIndex(baseParams(), 'audio')).toBe(1);
    });
    it('counts only matching kind', () => {
        const v = baseParams({
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'image', url: '/b.png' },
                { kind: 'audio', url: '/a.mp3' },
            ],
        });
        expect(nextTokenIndex(v, 'image')).toBe(3);
        expect(nextTokenIndex(v, 'audio')).toBe(2);
        expect(nextTokenIndex(v, 'video')).toBe(1);
    });
});

describe('insertMention (image)', () => {
    it('appends media_input and adds 图片N to prompt end', () => {
        const v = baseParams({ prompt: '英雄登场' });
        const next = insertMention(v, imgCandidate());
        expect(next.media_inputs).toHaveLength(1);
        expect(next.media_inputs[0]).toMatchObject({
            kind: 'image', url: '/storage/assets/hero.png',
        });
        expect(next.prompt).toBe('英雄登场 图片1');
    });
    it('does not duplicate token when one already exists in prompt', () => {
        const v = baseParams({
            prompt: '主图 图片1 走向参考',
            media_inputs: [{ kind: 'image', url: '/a.png' }],
        });
        const next = insertMention(v, imgCandidate({ id: 'cand_img_2', url: '/b.png' }));
        // After insert: 2 inputs; prompt should now contain 图片1 AND 图片2
        expect(next.media_inputs).toHaveLength(2);
        expect(next.prompt).toMatch(/图片1/);
        expect(next.prompt).toMatch(/图片2/);
    });
});

describe('insertMention (text candidate)', () => {
    it('inserts text content but does not touch media_inputs', () => {
        const v = baseParams({ prompt: 'INT. 卧室 - 夜' });
        const text: SeedanceAssetCandidate = {
            id: 'cand_text_1', group: 'storyboard_data', kind: 'text',
            label: '场景', text: '\n大风吹起窗帘',
        };
        const next = insertMention(v, text);
        expect(next.media_inputs).toHaveLength(0);
        expect(next.prompt).toBe('INT. 卧室 - 夜\n大风吹起窗帘');
    });
});

describe('insertMention (ark_asset_id)', () => {
    it('treats arkAssetId candidate as media_input with kind=image by default', () => {
        const v = baseParams();
        const cand: SeedanceAssetCandidate = {
            id: 'cand_ark_1', group: 'ark_asset_id', kind: 'image',
            label: 'asset://abc', arkAssetId: 'asset://abc',
        };
        const next = insertMention(v, cand);
        expect(next.media_inputs).toHaveLength(1);
        expect(next.media_inputs[0].kind).toBe('image');
        // url field stores the asset:// id (worker.py converts to image_url with id reference)
        expect(next.media_inputs[0].url).toBe('asset://abc');
        expect(next.prompt).toMatch(/图片1/);
    });
});

describe('removeMediaInput', () => {
    it('renumbers same-kind tokens after removal', () => {
        const v = baseParams({
            prompt: '从 图片1 走到 图片2 然后 图片3',
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'image', url: '/b.png' },
                { kind: 'image', url: '/c.png' },
            ],
        });
        // Remove index 1 (图片2)
        const next = removeMediaInput(v, 1);
        expect(next.media_inputs).toHaveLength(2);
        expect(next.media_inputs[0].url).toBe('/a.png');
        expect(next.media_inputs[1].url).toBe('/c.png');
        // 图片3 → 图片2; 图片2 → removed; 图片1 → 图片1
        expect(next.prompt).toBe('从 图片1 走到  然后 图片2');
    });
    it('renumbers only same kind, leaves others untouched', () => {
        const v = baseParams({
            prompt: '图片1 视频1 音频1 图片2',
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'video', url: '/v.mp4' },
                { kind: 'audio', url: '/a.mp3' },
                { kind: 'image', url: '/b.png' },
            ],
        });
        const next = removeMediaInput(v, 0);   // remove 图片1
        expect(next.media_inputs).toHaveLength(3);
        expect(next.prompt).toMatch(/视频1/);
        expect(next.prompt).toMatch(/音频1/);
        expect(next.prompt).toMatch(/图片1/);   // was 图片2 → now 图片1
        expect(next.prompt).not.toMatch(/图片2/);
    });
});

describe('canonicalizePrompt', () => {
    it('marks orphan tokens (no backing media) without deleting them', () => {
        const v = baseParams({
            prompt: '图片1 图片3',
            media_inputs: [{ kind: 'image', url: '/a.png' }],   // only 1
        });
        const result = canonicalizePrompt(v);
        expect(result.orphans).toContain('图片3');
        expect(result.orphans).toHaveLength(1);
        // Prompt is unchanged
        expect(result.prompt).toBe('图片1 图片3');
    });
    it('appends missing tokens for media_inputs not referenced in prompt', () => {
        const v = baseParams({
            prompt: '场景描写',
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'audio', url: '/a.mp3' },
            ],
        });
        const result = canonicalizePrompt(v);
        expect(result.prompt).toMatch(/图片1/);
        expect(result.prompt).toMatch(/音频1/);
        expect(result.added).toEqual(['图片1', '音频1']);
    });
});

describe('shouldEnableWebSearch', () => {
    it('true when no media_inputs + non-empty prompt + supported sub_model', () => {
        expect(shouldEnableWebSearch(baseParams({ prompt: '查一下今天天气' }))).toBe(true);
    });
    it('false when any media_input present', () => {
        expect(shouldEnableWebSearch(baseParams({
            prompt: 'x',
            media_inputs: [{ kind: 'image', url: '/a.png' }],
        }))).toBe(false);
    });
    it('false when prompt is empty', () => {
        expect(shouldEnableWebSearch(baseParams({ prompt: '   ' }))).toBe(false);
    });
});

describe('parseArkAssetId', () => {
    it('accepts valid asset:// strings', () => {
        expect(parseArkAssetId('asset://abc-123')).toBe('asset://abc-123');
        expect(parseArkAssetId('  asset://x  ')).toBe('asset://x');
    });
    it('rejects malformed', () => {
        expect(parseArkAssetId('asset://')).toBeNull();
        expect(parseArkAssetId('http://x')).toBeNull();
        expect(parseArkAssetId('')).toBeNull();
    });
});
```

- [ ] **Step 3.7: Run tests, expect failure**

```powershell
cd new_html
npx vitest run __tests__/utils/seedanceMedia.test.ts
```

Expected: FAIL with multiple "X is not a function" — the helpers don't exist yet.

- [ ] **Step 3.8: Implement helpers in `seedanceMedia.ts`**

Append to `new_html/utils/seedanceMedia.ts` (after the types from Task 1.6):

```typescript
// ===== Helpers (Task 3) =====

import type { SeedanceParams, SeedanceMediaInput } from '../services/videoService';

export function nextTokenIndex(
    value: Pick<SeedanceParams, 'media_inputs'>,
    kind: SeedanceMediaKind,
): number {
    return value.media_inputs.filter(m => m.kind === kind).length + 1;
}

function tokenRegex(kind: SeedanceMediaKind, n: number | '\\d+'): RegExp {
    return new RegExp(`${TOKEN_PREFIX[kind]}${n}`, 'g');
}

export function insertMention(
    value: SeedanceParams,
    candidate: SeedanceAssetCandidate,
): SeedanceParams {
    if (candidate.kind === 'text') {
        return { ...value, prompt: (value.prompt || '') + (candidate.text || '') };
    }

    const kind = candidate.kind as SeedanceMediaKind;
    const url = candidate.arkAssetId || candidate.url;
    if (!url) return value;

    const newInput: SeedanceMediaInput = { kind, url };
    const idx = nextTokenIndex(value, kind);
    const token = `${TOKEN_PREFIX[kind]}${idx}`;
    const promptHasToken = tokenRegex(kind, idx).test(value.prompt || '');
    const sep = (value.prompt || '').endsWith(' ') || !value.prompt ? '' : ' ';
    const newPrompt = promptHasToken
        ? value.prompt
        : (value.prompt || '') + sep + token;

    return {
        ...value,
        media_inputs: [...value.media_inputs, newInput],
        prompt: newPrompt,
    };
}

export function removeMediaInput(value: SeedanceParams, idxToRemove: number): SeedanceParams {
    const removed = value.media_inputs[idxToRemove];
    if (!removed) return value;

    const kind = removed.kind;
    const sameKindIndices = value.media_inputs
        .map((m, i) => ({ m, i }))
        .filter(x => x.m.kind === kind)
        .map(x => x.i);
    const removedRank = sameKindIndices.indexOf(idxToRemove); // 0-based among same kind
    const removedTokenN = removedRank + 1;

    let prompt = value.prompt || '';
    // 1) Remove the deleted-rank token (replace with empty)
    prompt = prompt.replace(tokenRegex(kind, removedTokenN), '');
    // 2) Renumber tokens > removedTokenN: walk descending so we don't double-rename
    const totalSameKind = sameKindIndices.length;
    for (let n = removedTokenN + 1; n <= totalSameKind; n++) {
        const re = tokenRegex(kind, n);
        prompt = prompt.replace(re, `${TOKEN_PREFIX[kind]}${n - 1}`);
    }

    return {
        ...value,
        media_inputs: value.media_inputs.filter((_, i) => i !== idxToRemove),
        prompt,
    };
}

export interface CanonicalizeResult {
    prompt: string;
    orphans: string[];   // tokens in prompt with no backing media
    added: string[];     // tokens appended for media that had none
}

export function canonicalizePrompt(value: SeedanceParams): CanonicalizeResult {
    const orphans: string[] = [];
    const added: string[] = [];
    let prompt = value.prompt || '';

    for (const kind of ['image', 'video', 'audio'] as const) {
        const count = value.media_inputs.filter(m => m.kind === kind).length;
        // Orphan check: any 图片N where N > count is orphan
        const re = new RegExp(`${TOKEN_PREFIX[kind]}(\\d+)`, 'g');
        const seen = new Set<number>();
        let match: RegExpExecArray | null;
        while ((match = re.exec(prompt)) !== null) {
            const n = parseInt(match[1], 10);
            seen.add(n);
            if (n > count) orphans.push(`${TOKEN_PREFIX[kind]}${n}`);
        }
        // Missing check: append tokens 1..count not yet in prompt
        for (let n = 1; n <= count; n++) {
            if (!seen.has(n)) {
                const tok = `${TOKEN_PREFIX[kind]}${n}`;
                prompt = (prompt + (prompt && !prompt.endsWith(' ') ? ' ' : '') + tok);
                added.push(tok);
            }
        }
    }

    return { prompt, orphans, added };
}

export function shouldEnableWebSearch(value: SeedanceParams): boolean {
    if (value.media_inputs.length > 0) return false;
    if (!(value.prompt || '').trim()) return false;
    // Per spec §11 risk row: web_search whitelist is sub_model standard/lite (default lite path uses fast or standard)
    return value.sub_model === 'standard' || value.sub_model === 'fast';
}

export function parseArkAssetId(raw: string): string | null {
    const s = (raw || '').trim();
    if (!s.startsWith('asset://')) return null;
    if (s.length <= 'asset://'.length) return null;
    return s;
}
```

- [ ] **Step 3.9: Run tests, expect pass**

```powershell
cd new_html
npx vitest run __tests__/utils/seedanceMedia.test.ts
```

Expected: All tests PASS. If `removeMediaInput` test "renumbers same-kind tokens after removal" fails on the exact prompt string, double-check whitespace handling — the expected is `'从 图片1 走到  然后 图片2'` with **two spaces** where 图片2 was removed. That's intentional; canonicalizePrompt is the layer that cleans formatting, not removeMediaInput.

- [ ] **Step 3.10: Commit 3b**

```powershell
cd ..
git add new_html/utils/seedanceMedia.ts `
        new_html/__tests__/utils/seedanceMedia.test.ts
git commit -m "feat(utils): seedanceMedia helpers (insert/remove/canonical/web_search/ark)

- nextTokenIndex / insertMention / removeMediaInput (with renumbering)
- canonicalizePrompt: orphans + auto-append missing
- shouldEnableWebSearch: pure-text + supported sub_model gate
- parseArkAssetId: asset:// validator

Token semantics: 图片N / 视频N / 音频N. Renumber on delete (R1).
Tests: ~25 cases."
```

### 3c. `seedanceCandidateBuilder`

- [ ] **Step 3.11: Write `__tests__/utils/seedanceCandidateBuilder.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildCandidates, type CandidateBuildContext } from '../../utils/seedanceCandidateBuilder';
import { baseParams } from './_fixtures/seedance';   // tiny shared helper, see step 3.13

const emptyCtx = (): CandidateBuildContext => ({
    currentParams: baseParams(),
    materialLibrary: { characters: [], scenes: [], props: [], audio: [] } as any,
    storyboardItems: [],
    historyVideos: [],
    userFiles: [],
});

describe('buildCandidates', () => {
    it('returns empty list when context is empty', () => {
        expect(buildCandidates(emptyCtx())).toEqual([]);
    });
    it('emits current_card group for already-added media', () => {
        const ctx = emptyCtx();
        ctx.currentParams.media_inputs = [
            { kind: 'image', url: '/a.png' },
            { kind: 'audio', url: '/a.mp3' },
        ];
        const cands = buildCandidates(ctx);
        const cur = cands.filter(c => c.group === 'current_card');
        expect(cur).toHaveLength(2);
        expect(cur[0].kind).toBe('image');
        expect(cur[1].kind).toBe('audio');
    });
    it('emits assets group from materialLibrary characters/scenes/props', () => {
        const ctx = emptyCtx();
        ctx.materialLibrary = {
            characters: [{ id: 'c1', name: '主角', currentVersion: { url: '/c.png' } }],
            scenes:     [{ id: 's1', name: '咖啡馆', currentVersion: { url: '/s.png' } }],
            props:      [{ id: 'p1', name: '吉他', currentVersion: { url: '/p.png' } }],
            audio:      [],
        } as any;
        const cands = buildCandidates(ctx);
        const assets = cands.filter(c => c.group === 'assets');
        expect(assets.map(c => c.label)).toEqual(['主角', '咖啡馆', '吉他']);
        expect(assets.every(c => c.kind === 'image')).toBe(true);
    });
    it('emits storyboard_data text candidates from sceneHeading + dialogue', () => {
        const ctx = emptyCtx();
        ctx.storyboardItems = [
            { item_id: 'sb1', sort_order: 1, scene_heading: 'INT. 卧室', dialogue: '"我在这里"', generated_image_url: null },
        ] as any;
        const cands = buildCandidates(ctx);
        const text = cands.filter(c => c.group === 'storyboard_data');
        expect(text.length).toBeGreaterThanOrEqual(2);
        expect(text.some(c => c.label.includes('SB-1'))).toBe(true);
        expect(text.every(c => c.kind === 'text')).toBe(true);
    });
    it('emits image candidates for storyboards with generated_image_url', () => {
        const ctx = emptyCtx();
        ctx.storyboardItems = [
            { item_id: 'sb1', sort_order: 1, generated_image_url: '/storage/sb1.png' },
        ] as any;
        const cands = buildCandidates(ctx);
        const sbImgs = cands.filter(c => c.group === 'storyboard_data' && c.kind === 'image');
        expect(sbImgs).toHaveLength(1);
        expect(sbImgs[0].url).toBe('/storage/sb1.png');
        expect(sbImgs[0].storyboardItemId).toBe('sb1');
    });
    it('emits audio group from materialLibrary.audio + storyboard audio urls', () => {
        const ctx = emptyCtx();
        ctx.materialLibrary = {
            characters: [], scenes: [], props: [],
            audio: [{ id: 'a1', name: '主题曲', currentVersion: { url: '/m.mp3', durationMs: 12000 } }],
        } as any;
        ctx.storyboardItems = [
            { item_id: 'sb1', sort_order: 1, dialogue_audio_url: '/sb1_d.mp3' },
        ] as any;
        const cands = buildCandidates(ctx);
        const audio = cands.filter(c => c.group === 'audio');
        expect(audio.length).toBeGreaterThanOrEqual(2);
    });
    it('emits video_segments from historyVideos', () => {
        const ctx = emptyCtx();
        ctx.historyVideos = [{ id: 'v1', url: '/v.mp4', label: '镜头 1', durationMs: 6000 }] as any;
        const cands = buildCandidates(ctx);
        expect(cands.filter(c => c.group === 'video_segments')).toHaveLength(1);
    });
    it('emits user_files from entity_files (image/video/audio kinds)', () => {
        const ctx = emptyCtx();
        ctx.userFiles = [
            { id: 'f1', file_url: '/u/x.png', file_name: 'x.png', mime_type: 'image/png' },
            { id: 'f2', file_url: '/u/y.mp4', file_name: 'y.mp4', mime_type: 'video/mp4' },
        ] as any;
        const cands = buildCandidates(ctx);
        const uf = cands.filter(c => c.group === 'user_files');
        expect(uf).toHaveLength(2);
        expect(uf.map(c => c.kind).sort()).toEqual(['image', 'video']);
    });
    it('always emits exactly one ark_asset_id placeholder candidate at the end', () => {
        const cands = buildCandidates(emptyCtx());
        const last = cands[cands.length - 1];
        // Even on empty context, the ark prompt entry exists
        const arkOnly = buildCandidates(emptyCtx()).filter(c => c.group === 'ark_asset_id');
        expect(arkOnly).toHaveLength(1);
        expect(arkOnly[0].label).toMatch(/asset:\/\//);
    });
});
```

- [ ] **Step 3.12: Run tests, expect failure**

```powershell
cd new_html
npx vitest run __tests__/utils/seedanceCandidateBuilder.test.ts
```

Expected: FAIL with `Cannot find module '../../utils/seedanceCandidateBuilder'`.

- [ ] **Step 3.13: Add a tiny test fixture helper**

Create `new_html/__tests__/utils/_fixtures/seedance.ts`:

```typescript
import type { SeedanceParams } from '../../../services/videoService';

export const baseParams = (over: Partial<SeedanceParams> = {}): SeedanceParams => ({
    sub_model: 'standard',
    prompt: '',
    media_inputs: [],
    duration: 5,
    ...over,
});
```

- [ ] **Step 3.14: Implement `seedanceCandidateBuilder.ts`**

Create `new_html/utils/seedanceCandidateBuilder.ts`:

```typescript
// new_html/utils/seedanceCandidateBuilder.ts
// Pure function: builds the SeedanceAssetCandidate[] for the @-mention popover
// from EpisodeContext slices, current SeedanceParams, history, and user files.

import type { SeedanceParams } from '../services/videoService';
import type { SeedanceAssetCandidate, SeedanceMediaKind } from './seedanceMedia';

export interface CandidateBuildContext {
    currentParams: SeedanceParams;
    materialLibrary: any;     // MaterialLibrary (loose typing intentional; see types/material.ts)
    storyboardItems: any[];
    historyVideos: any[];
    userFiles: any[];
}

function inferKindFromMime(mime: string | undefined): SeedanceMediaKind | null {
    if (!mime) return null;
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return null;
}

export function buildCandidates(ctx: CandidateBuildContext): SeedanceAssetCandidate[] {
    const out: SeedanceAssetCandidate[] = [];

    // 1. current_card
    ctx.currentParams.media_inputs.forEach((m, i) => {
        out.push({
            id: `current_${i}`,
            group: 'current_card',
            kind: m.kind,
            label: `${m.kind === 'image' ? '图片' : m.kind === 'video' ? '视频' : '音频'} #${i + 1}`,
            url: m.url,
            thumbnailUrl: m.kind === 'image' ? m.url : undefined,
        });
    });

    // 2. storyboard_data — text snippets + generated images
    (ctx.storyboardItems || []).forEach((sb: any) => {
        const order = sb.sort_order ?? 0;
        if (sb.scene_heading) {
            out.push({
                id: `sb_text_heading_${sb.item_id}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${order} 场景: ${String(sb.scene_heading).slice(0, 16)}`,
                text: sb.scene_heading,
                storyboardItemId: sb.item_id,
            });
        }
        if (sb.dialogue) {
            out.push({
                id: `sb_text_dialogue_${sb.item_id}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${order} 台词: ${String(sb.dialogue).slice(0, 16)}`,
                text: sb.dialogue,
                storyboardItemId: sb.item_id,
            });
        }
        if (sb.generated_image_url) {
            out.push({
                id: `sb_img_${sb.item_id}`,
                group: 'storyboard_data',
                kind: 'image',
                label: `SB-${order} 画面`,
                url: sb.generated_image_url,
                thumbnailUrl: sb.generated_image_url,
                storyboardItemId: sb.item_id,
            });
        }
    });

    // 3. assets — materialLibrary characters / scenes / props (kind=image)
    const lib = ctx.materialLibrary || {};
    const assetGroups: Array<{ key: string; items: any[] }> = [
        { key: 'characters', items: lib.characters || [] },
        { key: 'scenes',     items: lib.scenes || [] },
        { key: 'props',      items: lib.props || [] },
    ];
    assetGroups.forEach(({ key, items }) => {
        items.forEach((it: any) => {
            const url = it?.currentVersion?.url || it?.url;
            if (!url) return;
            out.push({
                id: `asset_${key}_${it.id}`,
                group: 'assets',
                kind: 'image',
                label: it.name || it.id,
                url,
                thumbnailUrl: url,
            });
        });
    });

    // 4. audio — materialLibrary.audio + storyboard audio tracks
    (lib.audio || []).forEach((a: any) => {
        const url = a?.currentVersion?.url || a?.url;
        if (!url) return;
        out.push({
            id: `audio_lib_${a.id}`,
            group: 'audio',
            kind: 'audio',
            label: a.name || a.id,
            url,
            durationMs: a?.currentVersion?.durationMs,
        });
    });
    (ctx.storyboardItems || []).forEach((sb: any) => {
        const order = sb.sort_order ?? 0;
        ['dialogue_audio_url', 'narration_audio_url', 'sfx_audio_url'].forEach((field) => {
            const url = sb[field];
            if (!url) return;
            const tag = field.replace('_audio_url', '');
            out.push({
                id: `audio_sb_${sb.item_id}_${tag}`,
                group: 'audio',
                kind: 'audio',
                label: `SB-${order} ${tag}`,
                url,
                storyboardItemId: sb.item_id,
            });
        });
        if (sb.mixed_audio_url) {
            out.push({
                id: `audio_sb_${sb.item_id}_mixed`,
                group: 'audio',
                kind: 'audio',
                label: `SB-${order} 混音`,
                url: sb.mixed_audio_url,
                storyboardItemId: sb.item_id,
            });
        }
    });

    // 5. video_segments — history videos
    (ctx.historyVideos || []).forEach((v: any) => {
        if (!v.url) return;
        out.push({
            id: `vid_${v.id}`,
            group: 'video_segments',
            kind: 'video',
            label: v.label || v.id,
            url: v.url,
            durationMs: v.durationMs,
        });
    });

    // 6. user_files — entity_files (image/video/audio only)
    (ctx.userFiles || []).forEach((f: any) => {
        const kind = inferKindFromMime(f.mime_type);
        if (!kind) return;
        out.push({
            id: `uf_${f.id}`,
            group: 'user_files',
            kind,
            label: f.file_name || f.id,
            url: f.file_url,
            thumbnailUrl: kind === 'image' ? f.file_url : undefined,
        });
    });

    // 7. ark_asset_id — single placeholder entry; user types asset:// in popover
    out.push({
        id: 'ark_input',
        group: 'ark_asset_id',
        kind: 'image',   // popover will let user pick the kind via small chip; default image
        label: '手输 asset://...（远程 ID）',
    });

    return out;
}
```

- [ ] **Step 3.15: Run tests, expect pass**

```powershell
cd new_html
npx vitest run __tests__/utils/seedanceCandidateBuilder.test.ts
```

Expected: All PASS.

If any test fails because `materialLibrary.audio` shape differs in the real codebase (look at `new_html/types/material.ts` if it exists), adjust both the test fixture and the implementation to use the actual shape — the implementation should be flexible to `currentVersion.url || url` chaining as written.

- [ ] **Step 3.16: Commit 3c**

```powershell
cd ..
git add new_html/utils/seedanceCandidateBuilder.ts `
        new_html/__tests__/utils/seedanceCandidateBuilder.test.ts `
        new_html/__tests__/utils/_fixtures/seedance.ts
git commit -m "feat(utils): seedanceCandidateBuilder for 7-group mention candidates

- current_card / storyboard_data / assets / audio / video_segments / user_files / ark_asset_id
- Pure function on EpisodeContext slices + current params + history + entity files
- Always emits 1 ark_asset_id placeholder for asset:// input
- Tests: 8 fixtures across empty / partial / full"
```

- [ ] **Step 3.17: Run all 3 utility test files together as a sanity check**

```powershell
cd new_html
npx vitest run __tests__/utils/durationMapping.test.ts `
               __tests__/utils/seedanceMedia.test.ts `
               __tests__/utils/seedanceCandidateBuilder.test.ts
```

Expected: ~40+ tests PASS, no regressions.

- [ ] **Step 3.18: Mirror to deploy/**

```powershell
cd ..
python scripts/sync_to_deploy.py --apply --paths `
    new_html/utils/durationMapping.ts `
    new_html/utils/seedanceMedia.ts `
    new_html/utils/seedanceCandidateBuilder.ts `
    new_html/__tests__/utils/durationMapping.test.ts `
    new_html/__tests__/utils/seedanceMedia.test.ts `
    new_html/__tests__/utils/seedanceCandidateBuilder.test.ts `
    new_html/__tests__/utils/_fixtures/seedance.ts
python scripts/sync_to_deploy.py --check
```

Expected: `[OK] no drift`

---

## Task 4: Frontend Hooks + Tests

**Goal:** Two React hooks — `useReactiveDuration` (computes per-card duration with userOverride lock) and `useSeedanceCandidates` (memoizes candidate list from EpisodeContext + entity files + history).

**Files:**
- Create: `new_html/hooks/useReactiveDuration.ts`
- Create: `new_html/__tests__/hooks/useReactiveDuration.test.ts`
- Create: `new_html/hooks/useSeedanceCandidates.ts`
- Create: `new_html/__tests__/hooks/useSeedanceCandidates.test.ts` (lighter — heavy logic is in builder, this hook only memoizes)

### 4a. `useReactiveDuration`

- [ ] **Step 4.1: Write `__tests__/hooks/useReactiveDuration.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReactiveDuration } from '../../hooks/useReactiveDuration';

describe('useReactiveDuration', () => {
    it('returns default 5 when no audio and no planned', () => {
        const { result } = renderHook(() =>
            useReactiveDuration({
                groupUuid: 'g1',
                durationUserOverride: false,
                meta: {},
                onChange: vi.fn(),
            }),
        );
        expect(result.current.duration).toBe(5);
        expect(result.current.userOverride).toBe(false);
    });

    it('uses audio duration when meta.audioDurationMs present', () => {
        const onChange = vi.fn();
        renderHook(() =>
            useReactiveDuration({
                groupUuid: 'g1',
                durationUserOverride: false,
                meta: { audioDurationMs: 7400, plannedDurationMs: 12000 },
                onChange,
            }),
        );
        expect(onChange).toHaveBeenCalledWith(7);
    });

    it('respects userOverride: does not call onChange when true', () => {
        const onChange = vi.fn();
        renderHook(() =>
            useReactiveDuration({
                groupUuid: 'g1',
                durationUserOverride: true,
                meta: { audioDurationMs: 8000 },
                currentDuration: 10,
                onChange,
            }),
        );
        expect(onChange).not.toHaveBeenCalled();
    });

    it('setUserDuration calls onChange + flips override true', () => {
        const onChange = vi.fn();
        const { result } = renderHook(() =>
            useReactiveDuration({
                groupUuid: 'g1',
                durationUserOverride: false,
                meta: {},
                onChange,
            }),
        );
        act(() => result.current.setUserDuration(8));
        expect(onChange).toHaveBeenLastCalledWith(8, true);
    });

    it('clearOverride resets to reactive value', () => {
        const onChange = vi.fn();
        const { result } = renderHook(() =>
            useReactiveDuration({
                groupUuid: 'g1',
                durationUserOverride: true,
                meta: { audioDurationMs: 6500 },
                currentDuration: 10,
                onChange,
            }),
        );
        act(() => result.current.clearOverride());
        // Resets override + recomputes from meta
        expect(onChange).toHaveBeenLastCalledWith(7, false);
    });
});
```

- [ ] **Step 4.2: Run tests, expect failure**

```powershell
cd new_html
npx vitest run __tests__/hooks/useReactiveDuration.test.ts
```

Expected: FAIL `Cannot find module '../../hooks/useReactiveDuration'`.

- [ ] **Step 4.3: Implement `useReactiveDuration.ts`**

```typescript
// new_html/hooks/useReactiveDuration.ts
import { useEffect, useCallback } from 'react';
import { computeReactiveDuration, clampSec } from '../utils/durationMapping';
import type { StoryboardMeta } from '../services/videoService';

export interface UseReactiveDurationProps {
    groupUuid: string;
    durationUserOverride: boolean;
    meta: Partial<StoryboardMeta>;
    currentDuration?: number;
    /** Called with (newDuration, override) whenever the hook decides duration must change.
     *  Caller should patch task_groups[groupUuid] = { duration, durationUserOverride: override }. */
    onChange: (duration: number, override: boolean) => void;
}

export interface UseReactiveDurationResult {
    duration: number;
    userOverride: boolean;
    setUserDuration: (sec: number) => void;
    clearOverride: () => void;
}

export function useReactiveDuration(p: UseReactiveDurationProps): UseReactiveDurationResult {
    const reactive = computeReactiveDuration({
        audioDurationMs: p.meta.audioDurationMs,
        plannedDurationMs: p.meta.plannedDurationMs,
    });

    // When override is OFF, sync reactive value into the upstream state via onChange.
    useEffect(() => {
        if (p.durationUserOverride) return;
        if (p.currentDuration === reactive) return;
        p.onChange(reactive, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reactive, p.durationUserOverride, p.groupUuid]);

    const setUserDuration = useCallback(
        (sec: number) => p.onChange(clampSec(sec), true),
        [p.onChange],
    );

    const clearOverride = useCallback(() => {
        // Recompute reactive at click time
        const next = computeReactiveDuration({
            audioDurationMs: p.meta.audioDurationMs,
            plannedDurationMs: p.meta.plannedDurationMs,
        });
        p.onChange(next, false);
    }, [p.onChange, p.meta.audioDurationMs, p.meta.plannedDurationMs]);

    return {
        duration: p.durationUserOverride ? (p.currentDuration ?? reactive) : reactive,
        userOverride: p.durationUserOverride,
        setUserDuration,
        clearOverride,
    };
}
```

- [ ] **Step 4.4: Run tests, expect pass**

```powershell
npx vitest run __tests__/hooks/useReactiveDuration.test.ts
```

Expected: 5 PASS. If `respects userOverride` fails (onChange called once on mount), it means the effect ran on first render even with override=true — fix the effect to early-return on override.

- [ ] **Step 4.5: Commit 4a**

```powershell
cd ..
git add new_html/hooks/useReactiveDuration.ts `
        new_html/__tests__/hooks/useReactiveDuration.test.ts
git commit -m "feat(hooks): useReactiveDuration with userOverride lock + clearOverride"
```

### 4b. `useSeedanceCandidates`

- [ ] **Step 4.6: Write `__tests__/hooks/useSeedanceCandidates.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { baseParams } from '../utils/_fixtures/seedance';

// Mock the EpisodeContext module — keep the hook surface minimal.
vi.mock('../../contexts/EpisodeContext', () => ({
    useEpisode: () => ({
        materialLibrary: { characters: [], scenes: [], props: [], audio: [] },
        storyboardItems: [],
        episodeId: 'ep1',
    }),
}));
vi.mock('../../hooks/useEntityFilesQuery', () => ({
    useEntityFilesQuery: () => ({ data: [], isLoading: false }),
}));

describe('useSeedanceCandidates', () => {
    it('always includes the ark_asset_id placeholder', () => {
        const { result } = renderHook(() => useSeedanceCandidates({ currentParams: baseParams() }));
        expect(result.current.candidates.some((c: any) => c.group === 'ark_asset_id')).toBe(true);
    });
    it('memoizes: same input ref → same output ref', () => {
        const params = baseParams();
        const { result, rerender } = renderHook(
            ({ p }: any) => useSeedanceCandidates({ currentParams: p }),
            { initialProps: { p: params } },
        );
        const first = result.current.candidates;
        rerender({ p: params });
        expect(result.current.candidates).toBe(first);
    });
});
```

- [ ] **Step 4.7: Run tests, expect failure**

```powershell
cd new_html
npx vitest run __tests__/hooks/useSeedanceCandidates.test.ts
```

Expected: FAIL `Cannot find module ...useSeedanceCandidates`.

- [ ] **Step 4.8: Implement `useSeedanceCandidates.ts`**

```typescript
// new_html/hooks/useSeedanceCandidates.ts
import { useMemo } from 'react';
import type { SeedanceParams } from '../services/videoService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { buildCandidates } from '../utils/seedanceCandidateBuilder';
import { useEpisode } from '../contexts/EpisodeContext';
import { useEntityFilesQuery } from '../hooks/useEntityFilesQuery';

export interface UseSeedanceCandidatesProps {
    currentParams: SeedanceParams;
    /** Optional history-videos slice. If absent, defaults to []. */
    historyVideos?: any[];
}

export interface UseSeedanceCandidatesResult {
    candidates: SeedanceAssetCandidate[];
    isLoading: boolean;
}

export function useSeedanceCandidates(p: UseSeedanceCandidatesProps): UseSeedanceCandidatesResult {
    const ep = useEpisode();
    const ufQuery = useEntityFilesQuery({
        entityType: 'episode',
        entityId: ep.episodeId || '',
        enabled: !!ep.episodeId,
    });

    const candidates = useMemo<SeedanceAssetCandidate[]>(
        () =>
            buildCandidates({
                currentParams: p.currentParams,
                materialLibrary: ep.materialLibrary,
                storyboardItems: ep.storyboardItems || [],
                historyVideos: p.historyVideos || [],
                userFiles: ufQuery.data || [],
            }),
        [
            p.currentParams,
            p.historyVideos,
            ep.materialLibrary,
            ep.storyboardItems,
            ufQuery.data,
        ],
    );

    return {
        candidates,
        isLoading: !!ufQuery.isLoading,
    };
}
```

⚠️ The exact signature of `useEntityFilesQuery` may differ in your tree (the file already exists). Before implementing, run:

```powershell
type new_html\hooks\useEntityFilesQuery.ts | findstr /n "export"
```

If it accepts different props (e.g. `(entityType, entityId)` positionally) adjust the call site to match.

- [ ] **Step 4.9: Run tests, expect pass**

```powershell
npx vitest run __tests__/hooks/useSeedanceCandidates.test.ts
```

Expected: 2 PASS. If memo test fails, check that `materialLibrary` is referentially stable across re-renders (in the mock it is). If real EpisodeContext returns a fresh object each render, the memo test will need `.toEqual` instead of `.toBe`. That's a reflection of real behavior; do not break the prod hook to fit the test — adjust the test.

- [ ] **Step 4.10: Commit 4b + mirror**

```powershell
cd ..
git add new_html/hooks/useSeedanceCandidates.ts `
        new_html/__tests__/hooks/useSeedanceCandidates.test.ts
git commit -m "feat(hooks): useSeedanceCandidates memoizes 7-group candidate list"

python scripts/sync_to_deploy.py --apply --paths `
    new_html/hooks/useReactiveDuration.ts `
    new_html/hooks/useSeedanceCandidates.ts `
    new_html/__tests__/hooks/useReactiveDuration.test.ts `
    new_html/__tests__/hooks/useSeedanceCandidates.test.ts
python scripts/sync_to_deploy.py --check
```

Expected: `[OK] no drift`

---

## Task 5: Frontend UI Components

**Goal:** Three new components + refactor `SeedanceMultimodalPanel` to use them.

**Files:**
- Create: `new_html/components/video/CardDurationField.tsx`
- Create: `new_html/components/SeedanceMentionPromptEditor.tsx`
- Create: `new_html/components/SeedanceAssetPickerModal.tsx`
- Create: `new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx`
- Modify: `new_html/components/SeedanceMultimodalPanel.tsx`

### 5a. `CardDurationField`

- [ ] **Step 5.1: Implement `CardDurationField.tsx`** (no test file — pure form input, covered by integration in Task 6)

Create `new_html/components/video/CardDurationField.tsx`:

```typescript
// new_html/components/video/CardDurationField.tsx
import React from 'react';
import { RotateCcw } from 'lucide-react';
import { DURATION_MIN_SEC, DURATION_MAX_SEC } from '../../utils/durationMapping';

export interface CardDurationFieldProps {
    duration: number;
    userOverride: boolean;
    onChange: (sec: number, override: boolean) => void;
    onClear: () => void;
    disabled?: boolean;
}

export const CardDurationField: React.FC<CardDurationFieldProps> = ({
    duration, userOverride, onChange, onClear, disabled,
}) => {
    return (
        <div className="flex items-center gap-1 text-[10px]">
            <label className="text-slate-400">时长</label>
            <input
                type="number"
                min={DURATION_MIN_SEC}
                max={DURATION_MAX_SEC}
                step={1}
                value={duration}
                disabled={disabled}
                className="w-12 px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-center"
                onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isFinite(n)) return;
                    onChange(n, true);
                }}
                title={userOverride ? '已手动设置（点 ↺ 恢复跟随音频）' : '跟随音频/脚本'}
            />
            <span className="text-slate-500">s</span>
            {userOverride && (
                <button
                    type="button"
                    onClick={onClear}
                    disabled={disabled}
                    title="清除手动设置，恢复跟随"
                    className="p-0.5 text-slate-400 hover:text-slate-200"
                >
                    <RotateCcw size={11} />
                </button>
            )}
        </div>
    );
};
```

- [ ] **Step 5.2: Lint check**

```powershell
cd new_html
npx tsc --noEmit components/video/CardDurationField.tsx
```

Expected: no errors. (If `tsc` requires a project config, just save and rely on the next `npm run build` to surface issues.)

### 5b. `SeedanceMentionPromptEditor` (the heavy one)

- [ ] **Step 5.3: Write `__tests__/components/SeedanceMentionPromptEditor.test.tsx`**

```typescript
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeedanceMentionPromptEditor } from '../../components/SeedanceMentionPromptEditor';
import { baseParams } from '../utils/_fixtures/seedance';

const sampleCands = () => [
    { id: 'c_img_1', group: 'assets', kind: 'image', label: '主角立绘', url: '/c.png' },
    { id: 'c_aud_1', group: 'audio', kind: 'audio', label: '主题曲',  url: '/a.mp3' },
    { id: 'c_txt_1', group: 'storyboard_data', kind: 'text', label: 'SB-1 场景', text: 'INT. 卧室 - 夜' },
    { id: 'ark_input', group: 'ark_asset_id', kind: 'image', label: '手输 asset://...' },
] as any;

describe('SeedanceMentionPromptEditor', () => {
    it('renders prompt textarea', () => {
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: 'hi' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        expect(screen.getByRole('textbox')).toHaveValue('hi');
    });

    it('opens popover when user types @ at start of line', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={onChange}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox');
        await user.click(ta);
        await user.type(ta, '@');
        await waitFor(() =>
            expect(screen.getByRole('listbox', { name: /mention/i })).toBeInTheDocument(),
        );
    });

    it('does NOT open popover when @ is mid-word', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: 'foo' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        await user.type(screen.getByRole('textbox'), '@');
        // No popover
        expect(screen.queryByRole('listbox', { name: /mention/i })).toBeNull();
    });

    it('selecting an image candidate calls onChange with insertMention result', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={onChange}
                candidates={sampleCands()}
            />,
        );
        await user.click(screen.getByRole('textbox'));
        await user.type(screen.getByRole('textbox'), '@');
        await user.click(await screen.findByText('主角立绘'));
        expect(onChange).toHaveBeenCalled();
        const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(next.media_inputs).toHaveLength(1);
        expect(next.prompt).toMatch(/图片1/);
    });

    it('autoOpenOnMount opens popover immediately when prompt === "@"', async () => {
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '@' })}
                onChange={() => {}}
                candidates={sampleCands()}
                autoOpenOnMount
            />,
        );
        await waitFor(() =>
            expect(screen.getByRole('listbox', { name: /mention/i })).toBeInTheDocument(),
        );
    });

    it('hides popover during IME composition', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox');
        await user.click(ta);
        await user.type(ta, '@');
        await screen.findByRole('listbox', { name: /mention/i });
        // Simulate IME compositionstart
        fireEvent.compositionStart(ta);
        await waitFor(() =>
            expect(screen.queryByRole('listbox', { name: /mention/i })).toBeNull(),
        );
        // compositionend re-evaluates
        fireEvent.compositionEnd(ta, { data: '中' });
    });

    it('Esc closes the popover', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox');
        await user.click(ta);
        await user.type(ta, '@');
        await screen.findByRole('listbox', { name: /mention/i });
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox', { name: /mention/i })).toBeNull();
    });
});
```

- [ ] **Step 5.4: Run tests, expect failure**

```powershell
npx vitest run __tests__/components/SeedanceMentionPromptEditor.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 5.5: Implement `SeedanceMentionPromptEditor.tsx`**

Create `new_html/components/SeedanceMentionPromptEditor.tsx`:

```typescript
// new_html/components/SeedanceMentionPromptEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeedanceParams } from '../services/videoService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { insertMention, parseArkAssetId } from '../utils/seedanceMedia';

export interface SeedanceMentionPromptEditorProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
    disabled?: boolean;
    autoOpenOnMount?: boolean;
    placeholder?: string;
}

const GROUP_LABELS: Record<string, string> = {
    current_card: '当前卡',
    storyboard_data: '分镜',
    assets: '素材库',
    audio: '音频',
    video_segments: '视频片段',
    user_files: '媒体库',
    ark_asset_id: '远程 ID',
};

export const SeedanceMentionPromptEditor: React.FC<SeedanceMentionPromptEditorProps> = (props) => {
    const { value, onChange, candidates, disabled, autoOpenOnMount, placeholder } = props;
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const [composing, setComposing] = useState(false);

    // autoOpenOnMount
    useEffect(() => {
        if (autoOpenOnMount && (value.prompt || '').trim() === '@') {
            setOpen(true);
            setSearch('');
            // Focus + place cursor at end so the popover anchors at the @
            taRef.current?.focus();
            taRef.current?.setSelectionRange(value.prompt.length, value.prompt.length);
        }
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Compose (IME) suppression
    useEffect(() => { if (composing) setOpen(false); }, [composing]);

    // Filtered + grouped candidates
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = q
            ? candidates.filter(c => c.label.toLowerCase().includes(q))
            : candidates;
        const groups: Record<string, SeedanceAssetCandidate[]> = {};
        for (const c of list) {
            (groups[c.group] ||= []).push(c);
        }
        return groups;
    }, [search, candidates]);

    const flatList = useMemo(
        () => Object.entries(filtered).flatMap(([_, items]) => items),
        [filtered],
    );

    const handleSelect = useCallback(
        (cand: SeedanceAssetCandidate) => {
            if (cand.group === 'ark_asset_id') {
                const raw = window.prompt('输入 asset:// id（如 asset://abc-123）：') || '';
                const valid = parseArkAssetId(raw);
                if (!valid) {
                    window.alert('无效的 asset:// 格式');
                    return;
                }
                const arkCand: SeedanceAssetCandidate = { ...cand, arkAssetId: valid };
                onChange(insertMention(value, arkCand));
            } else {
                onChange(insertMention(value, cand));
            }
            setOpen(false);
            setSearch('');
            taRef.current?.focus();
        },
        [value, onChange],
    );

    // Detect @ trigger after each input event
    const handleInput = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const v = e.target.value;
            onChange({ ...value, prompt: v });
            if (composing || disabled) return;
            const cursor = e.target.selectionStart || 0;
            // Look at the char just typed and the one before it
            const justTyped = v.charAt(cursor - 1);
            if (justTyped !== '@') {
                // Maybe user backspaced; close popover if @ no longer in the trigger position
                if (open) {
                    const lastAt = v.lastIndexOf('@', cursor - 1);
                    if (lastAt < 0) setOpen(false);
                }
                return;
            }
            // Check trigger condition: char before @ is whitespace, line start, or empty
            const prev = cursor >= 2 ? v.charAt(cursor - 2) : '';
            if (prev === '' || /\s/.test(prev)) {
                setOpen(true);
                setSearch('');
                setActiveIdx(0);
            }
        },
        [value, onChange, composing, disabled, open],
    );

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

    return (
        <div className="relative">
            <textarea
                ref={taRef}
                value={value.prompt}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                placeholder={placeholder || '描述动作、镜头、声音；@ 选素材...'}
                disabled={disabled}
                rows={3}
                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs resize-none"
            />
            {open && !composing && (
                <div
                    role="listbox"
                    aria-label="mention candidates"
                    className="absolute left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-slate-900 border border-slate-700 rounded shadow-lg z-50"
                >
                    <input
                        autoFocus
                        type="text"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setActiveIdx(0); }}
                        placeholder="搜索..."
                        className="w-full px-2 py-1 text-xs bg-slate-800 border-b border-slate-700 text-slate-200"
                    />
                    {Object.entries(filtered).map(([group, items]) => (
                        <div key={group}>
                            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 bg-slate-800/50">
                                {GROUP_LABELS[group] || group}
                            </div>
                            {items.map((c) => {
                                const idx = flatList.indexOf(c);
                                return (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => handleSelect(c)}
                                        className={`flex items-center gap-2 w-full text-left px-2 py-1 text-xs hover:bg-slate-700 ${
                                            idx === activeIdx ? 'bg-slate-700' : ''
                                        }`}
                                    >
                                        {c.thumbnailUrl && (
                                            <img src={c.thumbnailUrl} alt="" className="w-6 h-6 object-cover rounded" />
                                        )}
                                        <span className="text-slate-200">{c.label}</span>
                                        <span className="ml-auto text-[10px] text-slate-500">{c.kind}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    {flatList.length === 0 && (
                        <div className="px-2 py-2 text-[11px] text-slate-500">无匹配</div>
                    )}
                </div>
            )}
        </div>
    );
};
```

- [ ] **Step 5.6: Run tests, expect pass**

```powershell
npx vitest run __tests__/components/SeedanceMentionPromptEditor.test.tsx
```

Expected: 7 PASS. Common failure modes:
- "popover does not open on @ at start" → check `prev === ''` branch in `handleInput` — at very first char, `cursor === 1`, so `prev` slice is `''` and should trigger.
- IME test fails because compositionstart sets state but rendering hasn't flushed → keep the `composing` effect that closes immediately.
- The "Enter selects" test may fail if `userEvent.type` types `{Enter}` literally — make sure the test types `@` first to open, then uses `keyboard` API.

If the heuristic for `@` trigger needs refinement (e.g. open after `\n@`), adjust the regex `/\s/.test(prev)` — newlines match `\s` so this should already work.

- [ ] **Step 5.7: Commit 5b**

```powershell
cd ..
git add new_html/components/SeedanceMentionPromptEditor.tsx `
        new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx
git commit -m "feat(ui): SeedanceMentionPromptEditor with @ popover, token auto-mgmt, IME safe"
```

### 5c. `SeedanceAssetPickerModal`

- [ ] **Step 5.8: Implement `SeedanceAssetPickerModal.tsx`** (no separate test file — covered by Task 6 integration; behavior reuses Task 5b helpers)

Create `new_html/components/SeedanceAssetPickerModal.tsx`:

```typescript
// new_html/components/SeedanceAssetPickerModal.tsx
import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { SeedanceParams } from '../services/videoService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { insertMention, parseArkAssetId } from '../utils/seedanceMedia';

export interface SeedanceAssetPickerModalProps {
    open: boolean;
    onClose: () => void;
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
}

const GROUP_LABELS: Record<string, string> = {
    current_card: '当前卡',
    storyboard_data: '分镜',
    assets: '素材库',
    audio: '音频',
    video_segments: '视频片段',
    user_files: '媒体库',
    ark_asset_id: '远程 ID',
};

export const SeedanceAssetPickerModal: React.FC<SeedanceAssetPickerModalProps> = (p) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [arkRaw, setArkRaw] = useState('');

    if (!p.open) return null;

    const grouped: Record<string, SeedanceAssetCandidate[]> = {};
    for (const c of p.candidates) (grouped[c.group] ||= []).push(c);

    const apply = () => {
        let next = p.value;
        for (const cand of p.candidates) {
            if (selected.has(cand.id)) {
                if (cand.group === 'ark_asset_id') {
                    const valid = parseArkAssetId(arkRaw);
                    if (!valid) continue;
                    next = insertMention(next, { ...cand, arkAssetId: valid });
                } else {
                    next = insertMention(next, cand);
                }
            }
        }
        p.onChange(next);
        p.onClose();
        setSelected(new Set());
        setArkRaw('');
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={p.onClose}>
            <div className="w-[600px] max-h-[80vh] bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
                    <div className="text-sm text-slate-200">插入素材（多选）</div>
                    <button onClick={p.onClose} className="p-1 text-slate-400 hover:text-slate-200"><X size={14} /></button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                    {Object.entries(grouped).map(([group, items]) => (
                        <div key={group}>
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{GROUP_LABELS[group] || group}</div>
                            {group === 'ark_asset_id' ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={arkRaw}
                                        onChange={e => setArkRaw(e.target.value)}
                                        placeholder="asset://abc-123"
                                        className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const id = items[0]?.id;
                                            if (id) setSelected(s => {
                                                const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns;
                                            });
                                        }}
                                        className="px-2 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
                                    >
                                        {selected.has(items[0]?.id || '') ? '已勾选' : '勾选'}
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2">
                                    {items.map(c => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setSelected(s => {
                                                const ns = new Set(s); ns.has(c.id) ? ns.delete(c.id) : ns.add(c.id); return ns;
                                            })}
                                            className={`relative p-2 rounded border text-left ${selected.has(c.id) ? 'border-blue-500 bg-slate-800' : 'border-slate-700 hover:bg-slate-800'}`}
                                        >
                                            {c.thumbnailUrl && (
                                                <img src={c.thumbnailUrl} alt="" className="w-full h-16 object-cover rounded mb-1" />
                                            )}
                                            <div className="text-[11px] text-slate-200 truncate">{c.label}</div>
                                            <div className="text-[9px] text-slate-500">{c.kind}</div>
                                            {selected.has(c.id) && (
                                                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                                                    <Plus size={10} className="text-white rotate-45" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-slate-700">
                    <button onClick={p.onClose} className="px-3 py-1 text-xs text-slate-300">取消</button>
                    <button onClick={apply} disabled={selected.size === 0} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded text-white">
                        插入 {selected.size} 项
                    </button>
                </div>
            </div>
        </div>
    );
};
```

- [ ] **Step 5.9: Commit 5c**

```powershell
git add new_html/components/SeedanceAssetPickerModal.tsx
git commit -m "feat(ui): SeedanceAssetPickerModal multi-select picker reusing candidate data"
```

### 5d. Refactor `SeedanceMultimodalPanel`

- [ ] **Step 5.10: Modify `SeedanceMultimodalPanel.tsx`**

Open `new_html/components/SeedanceMultimodalPanel.tsx`. Locate:

1. The `<textarea>` block around line 130:
   ```typescript
   <textarea
       value={value.prompt}
       onChange={e => patch({ prompt: e.target.value })}
       placeholder="描述动作、镜头、声音或剪辑意图..."
       disabled={disabled}
   ```
2. The duration `<input>` block (search for `value.duration` near `'duration'` references).

Replace the textarea with the editor, add the `+ 插入素材` button, and remove the inline duration input. The component now expects:
- `candidates` prop (provided by parent via `useSeedanceCandidates`)
- `groupUuid` prop (used by parent for token / candidate scoping; we do not store it)
- The duration field is rendered OUTSIDE this component (parent uses `CardDurationField` + `useReactiveDuration`).

Replace the relevant JSX block:

```typescript
import { Plus } from 'lucide-react';
import { SeedanceMentionPromptEditor } from './SeedanceMentionPromptEditor';
import { SeedanceAssetPickerModal } from './SeedanceAssetPickerModal';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';

// ... existing imports / props ...

export interface SeedanceMultimodalPanelProps {
    // existing fields ...
    candidates: SeedanceAssetCandidate[];   // ⭐ NEW
    autoOpenMentionOnMount?: boolean;       // ⭐ NEW
}

// Inside the component body:
const [pickerOpen, setPickerOpen] = useState(false);

// ... in JSX, replace the prompt textarea block with: ...
<div className="flex items-center justify-between mb-1">
    <div className="text-[10px] font-medium text-slate-300">提示词</div>
    <div className="flex items-center gap-1">
        <span className="text-[9px] text-slate-500">可空，但必须有媒体或文本</span>
        <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={disabled}
            className="ml-1 p-1 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded"
            title="插入素材（媒体库 / 素材库 / 分镜...）"
        >
            <Plus size={11} /> 插入素材
        </button>
    </div>
</div>
<SeedanceMentionPromptEditor
    value={value}
    onChange={onChange}
    candidates={props.candidates}
    disabled={disabled}
    autoOpenOnMount={props.autoOpenMentionOnMount}
    placeholder="描述动作、镜头、声音；@ 选素材..."
/>
<SeedanceAssetPickerModal
    open={pickerOpen}
    onClose={() => setPickerOpen(false)}
    value={value}
    onChange={onChange}
    candidates={props.candidates}
/>

// Remove the inline duration input. Search for the JSX block that handles duration
// (`value.duration`, `patch({ duration: ... })`) and DELETE it entirely. The parent
// renders <CardDurationField/> at the card level.
```

**Important:** The validation block at lines 30-49 references `value.duration`. Keep that — duration is still on `SeedanceParams` (not removed from the type, just removed from this panel's UI). The validation should continue to work.

- [ ] **Step 5.11: Update `__tests__/components/SeedanceMultimodalPanel.test.tsx`** (existing file)

Open the existing test file. The test file likely renders `<SeedanceMultimodalPanel value={...} onChange={...} />`. We added two new props — pass empty/false defaults:

```typescript
<SeedanceMultimodalPanel
    value={params}
    onChange={onChange}
    candidates={[]}                    // ⭐
    autoOpenMentionOnMount={false}     // ⭐
    // ...other existing props
/>
```

If any existing test asserts on the duration input element being present, **delete those assertions** (the input moved to `CardDurationField` rendered by parent). Replace with assertions on the prompt area `getByRole('textbox')`.

Run the existing panel tests:

```powershell
cd new_html
npx vitest run __tests__/components/SeedanceMultimodalPanel.test.tsx
```

Expected: PASS after the prop additions and duration assertion deletions.

- [ ] **Step 5.12: Commit 5d + mirror**

```powershell
cd ..
git add new_html/components/SeedanceMultimodalPanel.tsx `
        new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx `
        new_html/components/video/CardDurationField.tsx
git commit -m "refactor(ui): SeedanceMultimodalPanel uses MentionPromptEditor + AssetPickerModal

- Replace plain <textarea> with SeedanceMentionPromptEditor (@ popover)
- Add '+ 插入素材' button → SeedanceAssetPickerModal (multi-select)
- Remove inline duration input; parent now renders CardDurationField
- Existing panel tests adjusted for new props"

python scripts/sync_to_deploy.py --apply --paths `
    new_html/components/video/CardDurationField.tsx `
    new_html/components/SeedanceMentionPromptEditor.tsx `
    new_html/components/SeedanceAssetPickerModal.tsx `
    new_html/components/SeedanceMultimodalPanel.tsx `
    new_html/__tests__/components/SeedanceMentionPromptEditor.test.tsx `
    new_html/__tests__/components/SeedanceMultimodalPanel.test.tsx
python scripts/sync_to_deploy.py --check
```

---

## Task 6: Frontend Integration

**Goal:** Wire the rewritten `handleImportAll`, `VideoPage` placeholder/badges/sync modal, and per-card hook composition.

**Files:**
- Modify: `new_html/pages/VideoGenPage.tsx`
- Modify: `new_html/components/VideoPage.tsx`
- (no new tests; covered by manual smoke + existing routing tests)

### 6a. Rewrite `handleImportAll`

- [ ] **Step 6.1: Replace `handleImportAll` body (lines 49–~178)**

In `new_html/pages/VideoGenPage.tsx`, replace the entire `handleImportAll` callback with the version below. Note we now iterate ALL `storyboardItems` (not just `itemsWithImages`), build per-shot meta, default to Seedance2, kick off mix-audio in the background.

```typescript
const handleImportAll = useCallback(async () => {
    if (importing || allStoryboardItems.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    try {
        const images: videoService.UploadedImage[] = [];
        const prompts: Record<string, string> = {};
        const meta: Record<string, videoService.StoryboardMeta> = {};
        const seedanceParams: Record<string, videoService.SeedanceParams> = {};
        const groups: videoService.TaskGroup[] = [];
        const skipped: { id: string; reason: string; sample?: string }[] = [];

        for (const item of allStoryboardItems) {
            const rawUrl = (item as any).generated_image_url ?? (item as any).generatedImageUrl;
            const itemId = (item as any).item_id ?? (item as any).itemId;
            const prompt = (item as any).image_prompt ?? (item as any).imagePrompt ?? '';
            const sortOrder = (item as any).sort_order ?? (item as any).sortOrder ?? 0;
            if (!itemId) {
                skipped.push({ id: '(no itemId)', reason: 'missing itemId' });
                continue;
            }

            // URL validation: keep only http/https/leading-slash; data:/blob: skip
            const urlRaw = (rawUrl || '').toString();
            const url = urlRaw.split('?')[0];
            let imgUrl = '';
            let isPlaceholder = true;
            if (url) {
                if (url.startsWith('data:')) {
                    skipped.push({ id: itemId, reason: 'data: URL（已跳过画面，仍占空位）', sample: url.slice(0, 60) + '...' });
                } else if (url.startsWith('blob:')) {
                    skipped.push({ id: itemId, reason: 'blob: URL（已跳过画面，仍占空位）', sample: url.slice(0, 60) });
                } else if (!url.startsWith('http') && !url.startsWith('/')) {
                    skipped.push({ id: itemId, reason: '未识别 URL 协议（已跳过画面）', sample: url.slice(0, 60) });
                } else {
                    imgUrl = url;
                    isPlaceholder = false;
                }
            }

            const upImg: videoService.UploadedImage = {
                id: itemId,
                url: imgUrl,
                filename: imgUrl ? `storyboard_${sortOrder + 1}.png` : `placeholder_${sortOrder + 1}`,
                uploadTime: Date.now(),
                isPlaceholder,
                storyboardItemId: itemId,
                sortOrder,
                tags: [] as any,
                linkedGroupUuids: [] as any,
            };
            images.push(upImg);
            if (prompt) prompts[itemId] = prompt;

            // Storyboard meta (audio + planned duration + scene/dialogue snapshot)
            const audioUrls = {
                dialogue:  (item as any).dialogue_audio_url || undefined,
                narration: (item as any).narration_audio_url || undefined,
                sfx:       (item as any).sfx_audio_url || undefined,
            };
            meta[itemId] = {
                plannedDurationMs: (item as any).planned_duration_ms,
                audioDurationMs:   (item as any).audio_duration_ms,
                audioUrls: (audioUrls.dialogue || audioUrls.narration || audioUrls.sfx) ? audioUrls : undefined,
                mixedAudioUrl:  (item as any).mixed_audio_url || undefined,
                mixedAudioHash: (item as any).mixed_audio_hash || undefined,
                sceneHeading: (item as any).scene_heading,
                dialogue:     (item as any).dialogue,
                lastSyncedAt: Date.now(),
            };

            // Initial reactive duration
            const initialDuration = videoService.computeReactiveDurationFromMeta(meta[itemId]);

            // Default model: Seedance2 (飞升)
            const groupUuid = videoService.generateUUID();
            const group: videoService.TaskGroup = {
                uuid: groupUuid,
                ids: [itemId],
                model: 'Seedance2' as videoService.VideoModel,
                shotType: 'single' as videoService.ShotType,
                duration: initialDuration,
                durationUserOverride: false,
            };
            groups.push(group);
            upImg.linkedGroupUuids = [groupUuid];

            // Initial SeedanceParams
            const sp: videoService.SeedanceParams = {
                sub_model: 'standard',
                prompt: isPlaceholder ? '@' : (prompt || ''),
                media_inputs: imgUrl
                    ? [{ kind: 'image', url: imgUrl, role: 'first_frame' }]
                    : [],
                duration: initialDuration,
                ratio: 'adaptive',
                seed: -1,
                watermark: false,
                generate_audio: true,
                camera_fixed: false,
            };
            // If mixed audio already present from a previous mix, attach it as reference_audio
            if (meta[itemId].mixedAudioUrl) {
                sp.media_inputs.push({
                    kind: 'audio',
                    url: meta[itemId].mixedAudioUrl,
                    role: 'reference_audio',
                });
            }
            seedanceParams[groupUuid] = sp;
        }

        if (images.length === 0) {
            const msg = `没有可导入的分镜（共 ${allStoryboardItems.length} 个，全部被跳过）`;
            setImportMsg({ kind: 'error', text: msg });
            return;
        }
        if (skipped.length > 0) {
            console.warn('[VideoGenPage] 跳过 %d 个画面（占位仍导入）', skipped.length, skipped);
        }

        // 1) Save the session immediately so user sees cards (sans mixed audio)
        const saveRes = await videoService.saveWorkspaceSession({
            uploaded_images: images,
            task_groups: groups,
            image_prompts: prompts,
            tasks_status: {},
            seedance_params: seedanceParams,
            storyboard_meta: meta,
        }, sessionScope);
        if (!saveRes?.success) {
            setImportMsg({ kind: 'error', text: '保存工作区会话失败，请稍后重试' });
            return;
        }
        setImportDone(true);

        // 2) Async batch: for each item with audio_urls but no mixedAudioUrl, call mix-audio
        const itemsToMix = Object.entries(meta).filter(([, m]) =>
            !m.mixedAudioUrl && m.audioUrls && (m.audioUrls.dialogue || m.audioUrls.narration || m.audioUrls.sfx)
        );
        if (itemsToMix.length > 0) {
            setImportMsg({ kind: 'info', text: `正在后台混音 ${itemsToMix.length} 条音频...` });
            await videoService.runWithConcurrency(itemsToMix, 3, async ([itemId, m]) => {
                try {
                    const r = await videoService.mixStoryboardAudio({
                        item_id: itemId,
                        dialogue_url:  m.audioUrls?.dialogue,
                        narration_url: m.audioUrls?.narration,
                        sfx_url:       m.audioUrls?.sfx,
                    });
                    // Patch session in place via the service's session-patch helper
                    await videoService.patchWorkspaceSession(sessionScope, (cur) => {
                        const newMeta = { ...(cur.storyboard_meta || {}), [itemId]: {
                            ...(cur.storyboard_meta?.[itemId] || {}),
                            mixedAudioUrl: r.mixed_audio_url,
                            mixedAudioHash: undefined, // will be filled on next reload from DB
                        } };
                        const groupForItem = (cur.task_groups || []).find(g => g.ids.includes(itemId));
                        const newSP = { ...(cur.seedance_params || {}) };
                        if (groupForItem) {
                            const existing = newSP[groupForItem.uuid];
                            if (existing) {
                                // Add (or replace) reference_audio
                                const others = existing.media_inputs.filter(mi => mi.role !== 'reference_audio');
                                newSP[groupForItem.uuid] = {
                                    ...existing,
                                    media_inputs: [...others, { kind: 'audio', url: r.mixed_audio_url, role: 'reference_audio' }],
                                };
                            }
                        }
                        return { storyboard_meta: newMeta, seedance_params: newSP };
                    });
                } catch (e) {
                    console.warn('[VideoGenPage] mix-audio failed for', itemId, e);
                }
            });
            setImportMsg({ kind: 'info', text: `导入完成（${images.length} 个分镜，混音 ${itemsToMix.length} 条）` });
        } else {
            setImportMsg({ kind: 'info', text: `导入完成（${images.length} 个分镜）` });
        }
    } finally {
        setImporting(false);
    }
}, [importing, allStoryboardItems, sessionScope]);
```

This rewrite assumes three small helpers on `videoService`:
- `videoService.computeReactiveDurationFromMeta(meta)` — re-export of `computeReactiveDuration`
- `videoService.runWithConcurrency(items, n, fn)` — async batch with concurrency limit
- `videoService.patchWorkspaceSession(scope, mutator)` — fetch current, run mutator, save merged

- [ ] **Step 6.2: Add the helper exports to `videoService.ts`**

Append to `new_html/services/videoService.ts`:

```typescript
import { computeReactiveDuration as _crd } from '../utils/durationMapping';

export function computeReactiveDurationFromMeta(meta: Partial<StoryboardMeta>): number {
    return _crd({
        audioDurationMs: meta.audioDurationMs,
        plannedDurationMs: meta.plannedDurationMs,
    });
}

export async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}

export async function patchWorkspaceSession(
    scope: WorkspaceScope,
    mutator: (current: WorkspaceSession) => Partial<WorkspaceSession>,
): Promise<void> {
    const cur = await loadWorkspaceSession(scope);
    if (!cur?.success || !cur.session) {
        console.warn('[patchWorkspaceSession] no current session');
        return;
    }
    const patch = mutator(cur.session);
    await saveWorkspaceSession({ ...cur.session, ...patch }, scope);
}
```

If `WorkspaceScope` and `loadWorkspaceSession` have different names in your tree, search the file and adapt — they exist already (the page calls `loadWorkspaceSession` indirectly via the import button flow).

- [ ] **Step 6.3: Rename / make-available `allStoryboardItems`**

The current code uses `itemsWithImages` (filtered). Add an unfiltered version near the top of the component:

```typescript
const allStoryboardItems = useMemo(
    () => storyboardItems || [],
    [storyboardItems],
);
```

Update the early-return condition in handleImportAll's caller flow and the disable state of the import button to reference `allStoryboardItems.length` (not `itemsWithImages.length`).

- [ ] **Step 6.4: Smoke test the new import**

Manual:
1. Open `/video-gen` for an episode that has at least one empty storyboard (no generated image), one storyboard with image, one with audio tracks.
2. Click 「导入全部分镜到视频工作区」.
3. Expected: ALL items appear as cards in the video page; empty ones show as placeholder cards; banner shows "正在后台混音 N 条..." then "导入完成"; refresh — placeholders persist with `prompt: '@'`, audio cards show mixed audio in their media list.

Console: no errors. Network: `/api/storyboard/mix-audio` returns 200 for items with audio.

- [ ] **Step 6.5: Commit 6a**

```powershell
git add new_html/pages/VideoGenPage.tsx new_html/services/videoService.ts
git commit -m "feat(import): handleImportAll rewrites for empty frames + audio mix + duration

- Iterate ALL storyboardItems (no longer filter on generated_image_url)
- Build storyboard_meta (audio urls + planned/audio duration + scene/dialogue)
- Default model = Seedance2; placeholder cards get prompt = '@' for autoOpen
- Initial duration = computeReactiveDuration(meta)
- Async batch mix-audio (concurrency=3); patches session as results return
- Reference_audio injected into seedance_params on mix complete
- Helpers: computeReactiveDurationFromMeta, runWithConcurrency, patchWorkspaceSession"
```

### 6b. `VideoPage` placeholder card + audio badges + sync modal

- [ ] **Step 6.6: Add placeholder card variant in `VideoPage.tsx`**

Locate the JSX block that renders an UploadedImage card. Wrap the image area with a placeholder fallback:

```typescript
{img.isPlaceholder ? (
    <div className="aspect-video bg-slate-800 border border-dashed border-slate-600 rounded flex flex-col items-center justify-center text-slate-500">
        <ImageOff size={20} />
        <div className="text-[10px] mt-1">空分镜</div>
        <div className="text-[9px] mt-0.5">@ 选首帧</div>
    </div>
) : (
    <img src={img.url + (img.url.includes('?') ? '' : `?token=${authToken}`)} alt={img.filename} className="aspect-video object-cover rounded" />
)}
```

Add `import { ImageOff } from 'lucide-react';` at the top.

- [ ] **Step 6.7: Add audio badges**

Inside the same card, after the image area, render badges for each present audio source:

```typescript
{(() => {
    const itemId = img.storyboardItemId;
    const m = itemId ? session.storyboard_meta?.[itemId] : undefined;
    if (!m) return null;
    const hasD  = !!m.audioUrls?.dialogue;
    const hasN  = !!m.audioUrls?.narration;
    const hasS  = !!m.audioUrls?.sfx;
    const hasMx = !!m.mixedAudioUrl;
    if (!(hasD || hasN || hasS)) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {hasD && <span className="px-1 py-0.5 bg-blue-600/20 text-blue-300 rounded text-[9px]">对白</span>}
            {hasN && <span className="px-1 py-0.5 bg-purple-600/20 text-purple-300 rounded text-[9px]">旁白</span>}
            {hasS && <span className="px-1 py-0.5 bg-orange-600/20 text-orange-300 rounded text-[9px]">音效</span>}
            {hasMx
                ? <span className="px-1 py-0.5 bg-emerald-600/20 text-emerald-300 rounded text-[9px]">已混音</span>
                : <span className="px-1 py-0.5 bg-slate-700 text-slate-400 rounded text-[9px]">混音中...</span>}
        </div>
    );
})()}
```

- [ ] **Step 6.8: Add `↻ 同步分镜` button + sync modal**

Add a state + button somewhere near the top of `VideoPage` (e.g. next to existing toolbar):

```typescript
const [syncModalOpen, setSyncModalOpen] = useState(false);
// ... in toolbar JSX:
<button
    type="button"
    onClick={() => setSyncModalOpen(true)}
    title="比对当前 storyboard 与工作区，按需同步"
    className="p-1 text-slate-300 hover:text-white"
>
    <RotateCw size={14} />
</button>
{syncModalOpen && (
    <StoryboardSyncModal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        storyboardItems={storyboardItems}
        session={session}
        onApply={async (mode) => {
            // Implemented via Step 6.9 helper
            await applySyncStrategy(mode, storyboardItems, session, sessionScope);
            setSyncModalOpen(false);
        }}
    />
)}
```

- [ ] **Step 6.9: Add `StoryboardSyncModal` component (inline file or new file)**

For locality, put it in `new_html/components/video/StoryboardSyncModal.tsx`:

```typescript
// new_html/components/video/StoryboardSyncModal.tsx
import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceSession } from '../../services/videoService';

export type SyncMode = 'add_new' | 'overwrite_unmodified' | 'full_reset';

export interface StoryboardSyncModalProps {
    open: boolean;
    onClose: () => void;
    storyboardItems: any[];
    session: WorkspaceSession;
    onApply: (mode: SyncMode) => void | Promise<void>;
}

export const StoryboardSyncModal: React.FC<StoryboardSyncModalProps> = (p) => {
    if (!p.open) return null;
    const stats = useMemo(() => {
        const sbIds = new Set(p.storyboardItems.map(s => s.item_id));
        const wsIds = new Set((p.session.uploaded_images || []).map(i => i.storyboardItemId).filter(Boolean));
        const newOnSb = [...sbIds].filter(id => !wsIds.has(id));
        const cardModified = (p.session.task_groups || []).filter(g => g.durationUserOverride
            || (p.session.seedance_params?.[g.uuid]?.media_inputs?.length || 0) > 1);
        const modifiedSinceSync = p.storyboardItems.filter(s => {
            const m = p.session.storyboard_meta?.[s.item_id];
            if (!m?.lastSyncedAt) return false;
            return new Date(s.updated_at).getTime() > m.lastSyncedAt;
        });
        return {
            new: newOnSb.length,
            modifiedSinceSync: modifiedSinceSync.length,
            cardModified: cardModified.length,
        };
    }, [p.storyboardItems, p.session]);

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={p.onClose}>
            <div className="w-[480px] bg-slate-900 border border-slate-700 rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
                    <div className="text-sm text-slate-200">同步分镜</div>
                    <button onClick={p.onClose} className="p-1 text-slate-400 hover:text-slate-200"><X size={14} /></button>
                </div>
                <div className="p-3 space-y-2 text-xs text-slate-300">
                    <div>新分镜：<span className="text-emerald-400">{stats.new}</span></div>
                    <div>分镜端有修改：<span className="text-amber-400">{stats.modifiedSinceSync}</span></div>
                    <div>卡片端已编辑：<span className="text-rose-400">{stats.cardModified}</span></div>
                </div>
                <div className="px-3 pb-3 space-y-1 text-xs">
                    <button onClick={() => p.onApply('add_new')} className="w-full text-left px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded">
                        仅添加 {stats.new} 个新分镜
                    </button>
                    <button onClick={() => p.onApply('overwrite_unmodified')} className="w-full text-left px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded">
                        覆盖未修改的（保留卡片端 {stats.cardModified} 处编辑）
                    </button>
                    <button onClick={() => p.onApply('full_reset')} className="w-full text-left px-2 py-1.5 bg-rose-800 hover:bg-rose-700 rounded text-rose-100">
                        ⚠ 全量重置（丢弃所有卡片端编辑）
                    </button>
                </div>
            </div>
        </div>
    );
};
```

And the `applySyncStrategy` helper (new file `new_html/utils/storyboardSync.ts`):

```typescript
// new_html/utils/storyboardSync.ts
import type { SyncMode } from '../components/video/StoryboardSyncModal';
import * as videoService from '../services/videoService';

export async function applySyncStrategy(
    mode: SyncMode,
    storyboardItems: any[],
    session: videoService.WorkspaceSession,
    scope: any,
): Promise<void> {
    if (mode === 'full_reset') {
        // Delegate to handleImportAll-equivalent: easiest path is to clear and trigger re-import in caller.
        // Caller can clear session and re-run import. For simplicity, expose a flag here.
        await videoService.saveWorkspaceSession({
            uploaded_images: [],
            task_groups: [],
            image_prompts: {},
            tasks_status: {},
            seedance_params: {},
            storyboard_meta: {},
        }, scope);
        // Caller should now re-run handleImportAll.
        return;
    }
    const wsIds = new Set((session.uploaded_images || []).map(i => i.storyboardItemId).filter(Boolean));
    const newItems = storyboardItems.filter(s => !wsIds.has(s.item_id));
    if (newItems.length === 0 && mode === 'add_new') return;

    if (mode === 'add_new') {
        // Append-only: caller's handleImportAll uses this items list with a custom flag
        // For simplicity in this plan, we delegate by stashing the list and asking caller
        // to call a new handleImportSubset(newItems). Implement it as a small variant of handleImportAll.
        return;
    }

    if (mode === 'overwrite_unmodified') {
        // Only reset cards that user did not touch (no override + media_inputs.length === 1 image only)
        // Exact rules: see spec §5.3.
        // Implementation: walk modified-on-sb items; if their group has no override and no extra media,
        // re-run the per-item init (Step 6.1's per-iteration logic) and patch session.
        return;
    }
}
```

Note: the empty implementation bodies above are intentional plan-time stubs for the variant flows. Implement them inline by extracting the per-item iteration of Step 6.1's `handleImportAll` into a function `buildImportArtifacts(item)` that returns `{ image, group, prompt, meta, sp }`, and call it from each branch of `applySyncStrategy`. This is a refactor that's small enough to land in this same step.

- [ ] **Step 6.10: Wire VideoPage card grid to use `useReactiveDuration` + `useSeedanceCandidates` + `CardDurationField`**

For each rendered card whose model is a video model, compose the hooks in a small inner component to keep VideoPage tidy:

```typescript
// at the top of VideoPage.tsx (or new file new_html/components/video/VideoCard.tsx)
import { useReactiveDuration } from '../../hooks/useReactiveDuration';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { CardDurationField } from './CardDurationField';

interface VideoCardProps {
    group: videoService.TaskGroup;
    image: videoService.UploadedImage;
    seedanceParams: videoService.SeedanceParams | undefined;
    meta: videoService.StoryboardMeta | undefined;
    onPatchGroup: (uuid: string, patch: Partial<videoService.TaskGroup>) => void;
    onPatchSeedance: (uuid: string, params: videoService.SeedanceParams) => void;
    /* ... existing props ... */
}

export const VideoCard: React.FC<VideoCardProps> = (p) => {
    const dur = useReactiveDuration({
        groupUuid: p.group.uuid,
        durationUserOverride: !!p.group.durationUserOverride,
        meta: p.meta || {},
        currentDuration: p.group.duration,
        onChange: (d, override) => p.onPatchGroup(p.group.uuid, { duration: d, durationUserOverride: override }),
    });

    const isSeedance = p.group.model === 'Seedance2' || p.group.model === 'Seedance2Fast';
    const candidates = useSeedanceCandidates({ currentParams: p.seedanceParams || baseEmptySeedanceParams() });

    return (
        <div /* card layout */>
            {/* ... image area / badges from steps 6.6-6.7 ... */}
            <CardDurationField
                duration={dur.duration}
                userOverride={dur.userOverride}
                onChange={dur.setUserDuration}
                onClear={dur.clearOverride}
            />
            {isSeedance && p.seedanceParams && (
                <SeedanceMultimodalPanel
                    value={p.seedanceParams}
                    onChange={(next) => p.onPatchSeedance(p.group.uuid, next)}
                    candidates={candidates.candidates}
                    autoOpenMentionOnMount={p.image.isPlaceholder && p.seedanceParams.prompt === '@'}
                    /* ... existing props ... */
                />
            )}
        </div>
    );
};

function baseEmptySeedanceParams(): videoService.SeedanceParams {
    return { sub_model: 'standard', prompt: '', media_inputs: [], duration: 5 };
}
```

Then in `VideoPage.tsx`, replace the inline card render with `<VideoCard ... />` calls passing through `onPatchGroup` (calls `saveWorkspaceSession` with a single-group patch) and `onPatchSeedance` (same).

- [ ] **Step 6.11: Smoke test full flow**

Manual:
1. Empty storyboards: import → cards render as placeholders → focus a placeholder card → mention popover auto-opens → select an asset → media_inputs adds the image, prompt becomes `@ 图片1` → fix orphan `@` by hand or via canonicalize on submit.
2. Storyboard with audio: after import, banner says "正在后台混音 1 条" → audio badges appear → after a few seconds the badge flips from "混音中" to "已混音" → SeedancePanel media list shows reference_audio.
3. Card with planned 7s: duration field shows 7. Type 9 → override goes true, ↺ button appears. Click ↺ → duration reverts to reactive (audio if present, else planned).
4. Sync modal: edit a storyboard sceneHeading → click ↻ → modal shows "1 modified, 0 cardModified" → "覆盖未修改的" → card prompt updates without losing other cards' overrides.

If 1.x autoOpen does not fire, debug `prompt === '@'` heuristic — VideoGenPage may have already attached audio so prompt is `@ 音频1`; in that case adjust heuristic in `VideoCard` props derivation.

- [ ] **Step 6.12: Commit 6b + mirror**

```powershell
git add new_html/components/VideoPage.tsx `
        new_html/components/video/StoryboardSyncModal.tsx `
        new_html/components/video/VideoCard.tsx `
        new_html/utils/storyboardSync.ts
git commit -m "feat(video-page): placeholder cards, audio badges, sync modal, hook composition"

python scripts/sync_to_deploy.py --apply --paths `
    new_html/pages/VideoGenPage.tsx `
    new_html/services/videoService.ts `
    new_html/components/VideoPage.tsx `
    new_html/components/video/StoryboardSyncModal.tsx `
    new_html/components/video/VideoCard.tsx `
    new_html/utils/storyboardSync.ts
python scripts/sync_to_deploy.py --check
```

---

## Task 7: Docs (Change → Doc Mapping)

**Goal:** All docs reflect the new state. The skill says: do all of these together after code changes.

- [ ] **Step 7.1: Update `docs/api.md`**

Add a new section `POST /api/storyboard/mix-audio` with: method/path, auth, request body, response body, error codes (400/404/503/500), example, caching note. Use the existing format other endpoints use in this file.

```markdown
## POST /api/storyboard/mix-audio

Mix dialogue / narration / sfx into one reference_audio for a storyboard item.
Cache by sha1 of (urls + gains) on `storyboard_items.mixed_audio_*` columns.

**Auth:** Bearer token (any logged-in user).

**Request:**
```json
{
  "item_id": "sb_xxx",
  "dialogue_url":  "/storage/audio/d.mp3",
  "narration_url": "/storage/audio/n.mp3",
  "sfx_url":       null,
  "dialogue_gain_db":  0.0,
  "narration_gain_db": -3.0,
  "sfx_gain_db":       -8.0
}
```

**Response (200):**
```json
{ "success": true, "mixed_audio_url": "/storage/audio/mixed.mp3", "cached": false, "duration_ms": 4800 }
```

**Errors:** `400` empty body, `404` unknown `item_id`, `503` ffmpeg unavailable, `500` ffmpeg run failed.
```

- [ ] **Step 7.2: Update `docs/database.md`**

Find the `storyboard_items` row. Append:

```markdown
| `mixed_audio_url`  | TEXT          | Backend-mixed reference audio URL          |
| `mixed_audio_hash` | VARCHAR(64)   | sha1 of inputs+gains; same hash → reuse    |
```

And note the new index `idx_storyboard_items_mixed_audio_hash`.

- [ ] **Step 7.3: Update `docs/frontend.md`**

Add a subsection under VideoGenPage / VideoPage:
- VideoGenPage: `handleImportAll` now imports ALL items (no filter) and triggers async backend mix.
- VideoPage: placeholder card + audio badges + 同步模态 (3 modes).
- New cross-cutting: `SeedanceMentionPromptEditor` replaces all Seedance plain prompt inputs; `@` opens picker, picks from 7 candidate sources.

- [ ] **Step 7.4: Update `docs/vertical-slices.md`**

Add a new page slice for VideoGenPage or extend the existing one with:
- Tables touched: `storyboard_items` (read), `system_configs` (R/W: `workspace_session_*` keys).
- Routes called: `/api/episodes/*/storyboard-items`, `/api/storyboard/mix-audio`, `/api/system-configs/*`.
- Components: `VideoCard`, `CardDurationField`, `SeedanceMentionPromptEditor`, `SeedanceAssetPickerModal`, `StoryboardSyncModal`.
- Hooks: `useReactiveDuration`, `useSeedanceCandidates`.

- [ ] **Step 7.5: Update `docs/faq.md`**

Append two new entries (use the standard FAQ format already in the file: Symptom + Root Cause + Fix + Files + Date):

1. `[2026-05-17] 空分镜不能导入到视频页 / 视频页空白` — root cause: handleImportAll filtered on generated_image_url; fix: rewrite to iterate all items, use placeholder cards for empty ones.
2. `[2026-05-17] Seedance 2.0 的 prompt 输入框打 @ 没反应` — root cause: SeedanceMultimodalPanel used plain textarea, no mention picker; fix: replace with SeedanceMentionPromptEditor which checks `@` after whitespace/line-start and opens popover with 7 candidate groups.

- [ ] **Step 7.6: Update `docs/conventions.md`**

Append two convention bullets:
- Video card duration: ALWAYS read from `TaskGroup.duration`, never from `SeedanceParams.duration` directly. The latter persists for backend submission only; UI consumers go through `useReactiveDuration`.
- Seedance prompt input: never use a plain `<textarea>` for SeedanceParams.prompt. Use `SeedanceMentionPromptEditor` so `@` and token management are uniform across the app.

- [ ] **Step 7.7: Mark old plan + spec as superseded**

Open `docs/superpowers/plans/2026-05-16-seedance-asset-mentions.md` and change the header (top of file) to:

```markdown
# Seedance Asset Mentions Implementation Plan

> **Status: Superseded** by `docs/superpowers/plans/2026-05-17-storyboard-video-import-completeness.md`.
> The mention design is implemented as part of the larger import-completeness feature on 2026-05-17. Do not execute this plan independently.

[... original content kept for history ...]
```

Same for `docs/superpowers/specs/2026-05-16-seedance-asset-mentions-design.md`.

- [ ] **Step 7.8: Commit Task 7**

```powershell
git add docs/api.md docs/database.md docs/frontend.md docs/vertical-slices.md `
        docs/faq.md docs/conventions.md `
        docs/superpowers/plans/2026-05-16-seedance-asset-mentions.md `
        docs/superpowers/specs/2026-05-16-seedance-asset-mentions-design.md
git commit -m "docs: video import completeness + Seedance mentions (full doc set)

- api.md: POST /api/storyboard/mix-audio
- database.md: storyboard_items.mixed_audio_url / mixed_audio_hash
- frontend.md: VideoGenPage import flow + Seedance mention editor
- vertical-slices.md: VideoGenPage slice updated
- faq.md: 2 new entries (empty import, @ no popover)
- conventions.md: duration field + mention editor conventions
- Mark 2026-05-16 plan/spec as Superseded"

python scripts/sync_to_deploy.py --apply --paths `
    docs/api.md docs/database.md docs/frontend.md docs/vertical-slices.md `
    docs/faq.md docs/conventions.md
python scripts/sync_to_deploy.py --check
```

---

## Task 8: Memory (scan + sync_check + index)

- [ ] **Step 8.1: Re-scan**

```powershell
python ".claude/skills/project-memory/scripts/scan_project.py" "h:\MY2"
```

Verify `context/cross_refs.json` shows the new route and tables under `VideoGenPage` / `VideoPage` slices:

```powershell
python -c "import json; r=json.load(open('context/cross_refs.json',encoding='utf-8')); print('POST /api/storyboard/mix-audio' in r['by_route']); print('mixed_audio_url' in str(r['by_table'].get('storyboard_items', {})))"
```

Expected: `True True`.

- [ ] **Step 8.2: Run `sync_check.py --strict --levels ERROR`**

```powershell
python ".claude/skills/project-memory/scripts/sync_check.py" "h:\MY2" --strict --levels ERROR
```

Expected exit code: 0. If ERROR appears (route undocumented / table undocumented / column-type mismatch), it means a doc edit in Task 7 got skipped — re-read the script output and add the missing entry.

- [ ] **Step 8.3: Generate diagrams**

```powershell
python ".claude/skills/project-memory/scripts/gen_diagrams.py" "h:\MY2" --pages VideoGenPage,VideoPage
```

This refreshes `docs/diagrams/page-VideoGenPage.md` and `docs/diagrams/page-VideoPage.md` to include the new mix-audio route and storyboard_meta channel.

- [ ] **Step 8.4: Build the index**

```powershell
python ".claude/skills/project-memory/scripts/build_index.py" "h:\MY2"
```

Verify `docs/index.md` got regenerated with the new route + slice rows.

- [ ] **Step 8.5: Final mirror + drift check**

```powershell
python scripts/sync_to_deploy.py --apply
python scripts/sync_to_deploy.py --check
```

Expected: `[OK] no drift`.

- [ ] **Step 8.6: Commit Task 8**

```powershell
git add context/ docs/diagrams/ docs/index.md
git commit -m "memory: re-scan + sync-check + diagrams + index after import-completeness landing"
```

---

## Task 9: Cleanup + Final Smoke

- [ ] **Step 9.1: Run the full frontend test suite**

```powershell
cd new_html
npx vitest run
```

Expected: all tests PASS (durationMapping, seedanceMedia, seedanceCandidateBuilder, useReactiveDuration, useSeedanceCandidates, SeedanceMentionPromptEditor, SeedanceMultimodalPanel, plus existing routing tests).

- [ ] **Step 9.2: Run the full backend test suite**

```powershell
cd ..
pytest tests/test_audio_mix_service.py -v
# plus any other backend tests in tests/
pytest tests/ -v
```

Expected: PASS.

- [ ] **Step 9.3: Manual end-to-end smoke (~10 minutes)**

Follow the script:
1. Navigate to `/video-gen` for an episode that has 5 storyboards (mix of empty/with-image/with-audio).
2. Click 「导入全部分镜到视频工作区」.
3. Verify all 5 cards render. Verify placeholder cards show "空分镜 @ 选首帧". Verify audio badges. Verify durations.
4. On a placeholder card, click into prompt → popover opens → search "主角" → select the character → media_inputs has 1 image, prompt has `@ 图片1`. Manually backspace the leading `@`.
5. Click `+ 插入素材` → modal opens → multi-select 2 audio + 1 image → click 插入 3 项 → media_inputs gains 3, prompt has `图片1 图片2 音频1 音频2` (image#1 already from step 4).
6. Delete media_inputs[2] (the audio) → prompt's `音频1` is removed; `音频2` becomes `音频1`.
7. Modify a storyboard sceneHeading in another tab → click ↻ on VideoPage toolbar → modal shows "1 modified, 0 cardModified" → click "覆盖未修改的" → cards refresh, the unedited card's prompt updates, the edited card's prompt is preserved.
8. Generate a video on a Seedance card → verify backend log shows `tools` in payload only when no media (web_search test) and `media_inputs` correct.

- [ ] **Step 9.4: Run impact check on every changed file as a sanity audit**

```powershell
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/pages/VideoGenPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/VideoPage.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "new_html/components/SeedanceMultimodalPanel.tsx" --brief
python ".claude/skills/project-memory/scripts/impact_check.py" "h:\MY2" "audio_mix_service.py" --brief
```

Expected: each output's reverse-deps stays inside the expected slice (VideoGenPage / VideoPage / StoryboardGenPage). If a NEW page surfaces in the reverse list, investigate before merging.

- [ ] **Step 9.5: Final tag commit**

```powershell
git tag -a feature/storyboard-video-import-completeness -m "Storyboard → video page import completeness + Seedance mentions"
git log --oneline -20   # sanity-check the last 20 commits cover all tasks
```

Expected: ~14 commits matching the task structure (1 schema + 1 backend + 3 utils + 2 hooks + 4 ui + 2 integration + 1 docs + 1 memory + 1 cleanup tag).

---

## Self-Review (run AFTER plan is fully written, BEFORE handoff)

This is the engineer's own checklist before declaring the plan complete. Walk it once.

### 1. Spec coverage

For each spec section, confirm a task implements it:

| Spec § | Mapped to Task |
|---|---|
| §1 Problem (5 points incl. mention) | Tasks 5, 6 |
| §2 Decisions (default model / duration / audio / sync / mentions × 4) | Tasks 1, 3, 4, 5, 6 |
| §3.0 mention types | Task 1.6 |
| §3.1 type extensions | Task 1.5 |
| §3.2 DB migration | Task 1.2 |
| §3.3 mix-audio API | Task 2.1–2.7 |
| §4 file table | Tasks 1–6 (cross-referenced) |
| §5 data flow (5.1 import, 5.2 reactive, 5.3 mention, 5.4 sync) | Task 6 |
| §6 mention design (6.1–6.5) | Tasks 3, 4, 5; web_search Task 2.8–2.9 |
| §7 error handling | Tasks 2 (BE) + 6 (banner UI) |
| §8 backwards compat | Task 6.1 (migration on session load) — confirm |
| §9 testing | Tasks 2.1, 3.1, 3.6, 3.11, 4.1, 4.6, 5.3 |
| §10 rollout 9 steps | Tasks 1–9 (1:1) |
| §11 risks (incl. mention) | Manual smoke 9.3 covers IME + renumber + orphan |
| §12 YAGNI | Out-of-scope, no task |
| §13 references | doc updates Task 7 |

⚠️ Gap noticed during this review: spec §8 backwards compat says "old session has SeedanceParams.duration → migrate to TaskGroup.duration on load". This migration is implicit in the new types but isn't explicitly written as a step. If you find old sessions in production, add a one-time migration in `loadWorkspaceSession` that does `if (g.duration === undefined && seedance_params[g.uuid]?.duration) g.duration = seedance_params[g.uuid].duration`. This belongs in Task 6.2 (videoService helpers); add 5 lines there.

### 2. Placeholder scan

Searched plan for: TBD / TODO / fill in / similar to / write tests for the above (without code).

Findings: 
- Step 6.9's `applySyncStrategy` has empty bodies for `add_new` and `overwrite_unmodified` branches — flagged inline with explicit refactor instruction (extract `buildImportArtifacts` from Step 6.1). Acceptable as long as the extraction is part of the implementation step.

If the executing agent treats those as TODO and skips them, that's the failure mode. Step 6.11 smoke test #7 is the gate that catches it.

### 3. Type consistency

- `SeedanceMediaInput`: existing fields `{ kind, url, role?, file_id? }` — used unchanged. ✅
- `SeedanceParams`: existing `{ ..., duration? }` — `duration` reused. UI reads from `TaskGroup.duration` (new). ✅
- `TaskGroup.duration` / `durationUserOverride` — added in Task 1.5, read in Task 4 hook + Task 5 component, written in Task 6 integration. ✅
- `StoryboardMeta` — defined in Task 1.5, populated in Task 6.1, consumed in Task 6.7 (badges) + 4.1 (hook). ✅
- `SeedanceAssetCandidate` — defined in Task 1.6, built in Task 3.14, consumed in Task 4.8 + 5.5 + 5.8. ✅
- `MixInput` / `MixResult` — defined in Task 2.3, used in 2.4 / 2.6 / 2.7. ✅
- Helper names: `nextTokenIndex`, `insertMention`, `removeMediaInput`, `canonicalizePrompt`, `shouldEnableWebSearch`, `parseArkAssetId`, `computeReactiveDuration`, `clampSec`, `buildCandidates`, `runWithConcurrency`, `patchWorkspaceSession`, `mixStoryboardAudio`, `applySyncStrategy`. All consistently spelled. ✅

### 4. Open questions for the executing agent

- The 「同步分镜」覆盖未修改 path (Step 6.9) needs the `buildImportArtifacts` extraction. Cost: ~30 lines refactor in Step 6.1, then 6.9 implementation becomes ~20 lines per branch. If executor wants to defer 「同步分镜」 to a follow-up PR, the import + placeholder + audio + mention path still works standalone — sync modal can ship as the button + stats display only, with `applySyncStrategy` returning early with a banner "尚未实现，请重新导入".

- `useEntityFilesQuery` exact prop signature — Step 4.8 acknowledges this; resolve by reading the existing hook before implementing.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-storyboard-video-import-completeness.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
