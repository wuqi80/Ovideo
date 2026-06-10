# 7-Step Video Production Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the monolithic WorkspaceApp into 7 independent, episode-DB-driven workflow pages that form a complete video production pipeline: Script → Design → Materials → Audio → Storyboard → Video → Enhance.

**Architecture:** Each workflow page becomes a standalone React component that reads/writes directly to episode-scoped PostgreSQL tables via REST API, using `useEpisode()` context for shared state. AI service calls (geminiService, aiModelService, etc.) remain unchanged — only the data source/sink layer is replaced. A new `character_voices` table enables cross-episode voice reuse.

**Tech Stack:** React 18 + TypeScript, FastAPI + asyncpg, PostgreSQL, Tailwind CSS (CDN), existing AI service integrations (Gemini, Doubao, ComfyUI, DeepSeek)

---

## File Structure Overview

### New Backend Files
- `h:\MY2\db_migration_character_voices.sql` — DDL for `character_voices` table
- `h:\MY2\dao_character_voice.py` — CRUD DAO for character_voices

### Modified Backend Files
- `h:\MY2\api_routes.py` — New endpoints: character_voices CRUD, batch storyboard creation, extract-to-assets
- `h:\MY2\dao_storyboard.py` — Add `batch_create` method

### New Frontend Files
- `h:\MY2\new_html\pages\StoryboardGenPage.tsx` — Step 5: storyboard image generation (migrated from components/GenerationPage.tsx)

### Modified Frontend Files
- `h:\MY2\new_html\types.ts` — Add `CharacterVoice` type
- `h:\MY2\new_html\contexts\EpisodeContext.tsx` — Add characterVoices, saveScript, batchCreateItems, updateAsset methods
- `h:\MY2\new_html\services\apiService.ts` — Add character_voices API functions, batch endpoints
- `h:\MY2\new_html\layouts\WorkflowLayout.tsx` — Add storyboard nav item, reorder nav
- `h:\MY2\new_html\App.tsx` — Add storyboard route
- `h:\MY2\new_html\pages\ScriptPage.tsx` — Full rewrite: standalone 3-column editor
- `h:\MY2\new_html\pages\DesignPage.tsx` — Enhance: design status, AI image generation
- `h:\MY2\new_html\pages\MaterialsPage.tsx` — Full rewrite: standalone material binding
- `h:\MY2\new_html\pages\AudioStagePage.tsx` — Enhance: character voice management
- `h:\MY2\new_html\pages\GenerationPage.tsx` — Minor: ensure asset library sidebar
- `h:\MY2\new_html\pages\EnhancePage.tsx` — Enhance: persist timeline, real enhancement API

### Files to Keep (UI components reused by new pages)
- `h:\MY2\new_html\components\ScriptColumn.tsx` — Reused in new ScriptPage
- `h:\MY2\new_html\components\StoryboardColumn.tsx` — Reused in new ScriptPage
- `h:\MY2\new_html\components\MaterialPage.tsx` — Reused in new MaterialsPage
- `h:\MY2\new_html\components\GenerationPage.tsx` — Source for StoryboardGenPage migration
- `h:\MY2\new_html\components\MattingModal.tsx` — Reused in StoryboardGenPage
- `h:\MY2\new_html\components\ImageFusionModal.tsx` — Reused in StoryboardGenPage
- `h:\MY2\new_html\components\StoryboardToolModal.tsx` — Reused in StoryboardGenPage
- `h:\MY2\new_html\components\MultiAngle3DController.tsx` — Reused in StoryboardGenPage
- `h:\MY2\new_html\services\geminiService.ts` — All AI calls, unchanged
- `h:\MY2\new_html\services\aiModelService.ts` — AI model calls, unchanged

---

## Task 1: Database Migration — `character_voices` Table

**Files:**
- Create: `h:\MY2\db_migration_character_voices.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- db_migration_character_voices.sql
-- 人物音色配置表 - 支持跨集复用

CREATE TABLE IF NOT EXISTS character_voices (
    id SERIAL PRIMARY KEY,
    voice_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    project_id UUID NOT NULL,
    asset_id UUID,
    character_name VARCHAR(200) NOT NULL,
    voice_provider VARCHAR(50),
    voice_model_id VARCHAR(200),
    voice_name VARCHAR(200),
    voice_params JSONB DEFAULT '{}',
    sample_audio_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_cv_project FOREIGN KEY (project_id)
        REFERENCES projects(project_id) ON DELETE CASCADE,
    CONSTRAINT fk_cv_asset FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_character_voices_project ON character_voices(project_id);
CREATE INDEX IF NOT EXISTS idx_character_voices_asset ON character_voices(asset_id);
```

- [ ] **Step 2: Run the migration**

```bash
# Connect to PostgreSQL and execute
psql -U <user> -d <db> -f db_migration_character_voices.sql
```

Expected: Table created, indices created, no errors.

- [ ] **Step 3: Verify**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'character_voices' ORDER BY ordinal_position;
```

Expected: 11 columns (id through updated_at).

- [ ] **Step 4: Commit**

```bash
git add db_migration_character_voices.sql
git commit -m "feat: add character_voices table for cross-episode voice reuse"
```

---

## Task 2: Backend — `CharacterVoiceDAO`

**Files:**
- Create: `h:\MY2\dao_character_voice.py`

- [ ] **Step 1: Create the DAO file**

Follow the exact pattern of `h:\MY2\dao_asset.py`:

```python
# -*- coding: utf-8 -*-
"""
人物音色 DAO -- character_voices 表的增删改查
"""
import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class CharacterVoiceDAO:

    @staticmethod
    async def create(
        project_id: str,
        character_name: str,
        asset_id: Optional[str] = None,
        voice_provider: Optional[str] = None,
        voice_model_id: Optional[str] = None,
        voice_name: Optional[str] = None,
        voice_params: Optional[dict] = None,
        sample_audio_url: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        vid = str(uuid.uuid4())
        query = """
            INSERT INTO character_voices
                (voice_id, project_id, asset_id, character_name,
                 voice_provider, voice_model_id, voice_name,
                 voice_params, sample_audio_url)
            VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9)
            RETURNING *
        """
        return await db.fetchrow(
            query, vid, project_id, asset_id, character_name,
            voice_provider, voice_model_id, voice_name,
            json.dumps(voice_params or {}, ensure_ascii=False),
            sample_audio_url
        )

    @staticmethod
    async def get_by_project(project_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM character_voices WHERE project_id = $1::uuid ORDER BY created_at DESC",
            project_id
        )

    @staticmethod
    async def get_by_id(voice_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM character_voices WHERE voice_id = $1::uuid", voice_id
        )

    @staticmethod
    async def update(voice_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {
            'character_name', 'asset_id', 'voice_provider',
            'voice_model_id', 'voice_name', 'sample_audio_url'
        }
        json_fields = {'voice_params'}
        sets, vals, idx = [], [], 1
        for key, val in kwargs.items():
            if key in allowed and val is not None:
                sets.append(f"{key} = ${idx}")
                vals.append(val)
                idx += 1
            elif key in json_fields and val is not None:
                sets.append(f"{key} = ${idx}::jsonb")
                vals.append(json.dumps(val, ensure_ascii=False))
                idx += 1
        if not sets:
            return await CharacterVoiceDAO.get_by_id(voice_id)
        sets.append(f"updated_at = NOW()")
        vals.append(voice_id)
        query = f"UPDATE character_voices SET {', '.join(sets)} WHERE voice_id = ${idx}::uuid RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def delete(voice_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM character_voices WHERE voice_id = $1::uuid", voice_id
        )
        return result == "DELETE 1"
```

- [ ] **Step 2: Commit**

```bash
git add dao_character_voice.py
git commit -m "feat: add CharacterVoiceDAO for character voice management"
```

---

## Task 3: Backend — API Endpoints for Character Voices + Batch Operations

**Files:**
- Modify: `h:\MY2\api_routes.py`
- Modify: `h:\MY2\dao_storyboard.py` — add `batch_create` method

- [ ] **Step 1: Add `batch_create` to StoryboardDAO**

In `h:\MY2\dao_storyboard.py`, add after the `create` method:

```python
@staticmethod
async def batch_create(episode_id: str, items: list) -> List[Dict[str, Any]]:
    """Batch-create storyboard items. Each item dict needs at minimum sort_order."""
    db = get_db_manager()
    if not db:
        return []
    results = []
    for item in items:
        row = await StoryboardDAO.create(
            episode_id=episode_id,
            sort_order=item.get('sort_order', 0),
            scene_heading=item.get('scene_heading', ''),
            action_text=item.get('action_text', ''),
            dialogue=item.get('dialogue', ''),
            camera_movement=item.get('camera_movement', ''),
            image_prompt=item.get('image_prompt', ''),
            video_prompt=item.get('video_prompt', ''),
        )
        if row:
            results.append(dict(row))
    return results
```

- [ ] **Step 2: Add Pydantic models and endpoints to `api_routes.py`**

Add Pydantic models near existing ones:

```python
class CharacterVoiceCreate(BaseModel):
    project_id: str
    character_name: str
    asset_id: Optional[str] = None
    voice_provider: Optional[str] = None
    voice_model_id: Optional[str] = None
    voice_name: Optional[str] = None
    voice_params: Optional[dict] = None
    sample_audio_url: Optional[str] = None

class CharacterVoiceUpdate(BaseModel):
    character_name: Optional[str] = None
    asset_id: Optional[str] = None
    voice_provider: Optional[str] = None
    voice_model_id: Optional[str] = None
    voice_name: Optional[str] = None
    voice_params: Optional[dict] = None
    sample_audio_url: Optional[str] = None

class BatchStoryboardCreate(BaseModel):
    items: list  # list of dicts with storyboard fields

class ExtractToAssetsRequest(BaseModel):
    characters: list  # [{"name": "...", "description": "..."}]
    scenes: list      # [{"name": "...", "description": "..."}]
```

Add endpoints:

```python
from dao_character_voice import CharacterVoiceDAO

# ===== Character Voice endpoints =====

@router.post("/api/character-voices")
async def create_character_voice(data: CharacterVoiceCreate, user_id: str = Depends(get_current_user)):
    voice = await CharacterVoiceDAO.create(
        project_id=data.project_id, character_name=data.character_name,
        asset_id=data.asset_id, voice_provider=data.voice_provider,
        voice_model_id=data.voice_model_id, voice_name=data.voice_name,
        voice_params=data.voice_params, sample_audio_url=data.sample_audio_url,
    )
    if not voice:
        raise HTTPException(status_code=500, detail="创建音色失败")
    return {"success": True, "voice": dict(voice)}

@router.get("/api/projects/{project_id}/character-voices")
async def get_character_voices(project_id: str, user_id: str = Depends(get_current_user)):
    voices = await CharacterVoiceDAO.get_by_project(project_id)
    return {"success": True, "voices": [dict(v) for v in voices]}

@router.put("/api/character-voices/{voice_id}")
async def update_character_voice(voice_id: str, data: CharacterVoiceUpdate, user_id: str = Depends(get_current_user)):
    voice = await CharacterVoiceDAO.update(voice_id, **data.dict(exclude_none=True))
    if not voice:
        raise HTTPException(status_code=404, detail="音色不存在")
    return {"success": True, "voice": dict(voice)}

@router.delete("/api/character-voices/{voice_id}")
async def delete_character_voice(voice_id: str, user_id: str = Depends(get_current_user)):
    ok = await CharacterVoiceDAO.delete(voice_id)
    if not ok:
        raise HTTPException(status_code=404, detail="音色不存在")
    return {"success": True}

# ===== Batch Storyboard Creation =====

@router.post("/api/episodes/{episode_id}/storyboard-items/batch")
async def batch_create_storyboard_items(
    episode_id: str, data: BatchStoryboardCreate,
    user_id: str = Depends(get_current_user)
):
    items = await StoryboardDAO.batch_create(episode_id, data.items)
    return {"success": True, "items": items}

# ===== Extract to Assets =====

@router.post("/api/episodes/{episode_id}/extract-to-assets")
async def extract_to_assets(
    episode_id: str, data: ExtractToAssetsRequest,
    user_id: str = Depends(get_current_user)
):
    from dao_episode import EpisodeDAO
    episode = await EpisodeDAO.get_by_id(episode_id)
    if not episode:
        raise HTTPException(status_code=404, detail="集不存在")
    project_id = episode['project_id']

    created = []
    for char in data.characters:
        asset = await AssetDAO.create(
            project_id=project_id, asset_type='character',
            name=char.get('name', ''), created_by=user_id,
            episode_id=episode_id, description=char.get('description', '')
        )
        if asset:
            created.append(dict(asset))
    for scene in data.scenes:
        asset = await AssetDAO.create(
            project_id=project_id, asset_type='scene',
            name=scene.get('name', ''), created_by=user_id,
            episode_id=episode_id, description=scene.get('description', '')
        )
        if asset:
            created.append(dict(asset))
    return {"success": True, "assets": created}
```

- [ ] **Step 3: Verify server starts**

```bash
cd h:\MY2 && python cluster_main.py
```

Expected: Server starts without import errors.

- [ ] **Step 4: Commit**

```bash
git add api_routes.py dao_storyboard.py dao_character_voice.py
git commit -m "feat: add character voice API, batch storyboard creation, extract-to-assets endpoint"
```

---

## Task 4: Frontend — Types + API Service + EpisodeContext Extension

**Files:**
- Modify: `h:\MY2\new_html\types.ts`
- Modify: `h:\MY2\new_html\services\apiService.ts`
- Modify: `h:\MY2\new_html\contexts\EpisodeContext.tsx`

- [ ] **Step 1: Add `CharacterVoice` type to `types.ts`**

After the `TimelineTrack` interface (~line 407):

```typescript
export interface CharacterVoice {
  voiceId: string;
  projectId: string;
  assetId: string | null;
  characterName: string;
  voiceProvider: string | null;
  voiceModelId: string | null;
  voiceName: string | null;
  voiceParams: Record<string, any>;
  sampleAudioUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add API functions to `apiService.ts`**

```typescript
// ===== Character Voice APIs =====

export async function getCharacterVoices(projectId: string) {
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/character-voices`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getCharacterVoices');
}

export async function createCharacterVoice(data: {
    project_id: string; character_name: string;
    asset_id?: string; voice_provider?: string;
    voice_model_id?: string; voice_name?: string;
    voice_params?: Record<string, any>; sample_audio_url?: string;
}) {
    const response = await fetch(`${API_BASE}/api/character-voices`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'createCharacterVoice');
}

export async function updateCharacterVoice(voiceId: string, data: Record<string, any>) {
    const response = await fetch(`${API_BASE}/api/character-voices/${voiceId}`, {
        method: 'PUT', headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateCharacterVoice');
}

export async function deleteCharacterVoice(voiceId: string) {
    const response = await fetch(`${API_BASE}/api/character-voices/${voiceId}`, {
        method: 'DELETE', headers: getHeaders()
    });
    return handleResponse(response, 'deleteCharacterVoice');
}

// ===== Batch Operations =====

export async function batchCreateStoryboardItems(episodeId: string, items: any[]) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/storyboard-items/batch`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ items })
    });
    return handleResponse(response, 'batchCreateStoryboardItems');
}

export async function extractToAssets(episodeId: string, characters: any[], scenes: any[]) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/extract-to-assets`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ characters, scenes })
    });
    return handleResponse(response, 'extractToAssets');
}
```

- [ ] **Step 3: Extend `EpisodeContext.tsx`**

Add to the `EpisodeContextValue` interface:

```typescript
characterVoices: CharacterVoice[];
saveScript: (data: { original_content?: string; adapted_script?: string; metadata?: Record<string, any> }) => Promise<void>;
saveStoryboardItem: (itemId: string, data: Record<string, any>) => Promise<void>;
createStoryboardItems: (items: any[]) => Promise<void>;
extractToAssets: (characters: any[], scenes: any[]) => Promise<void>;
```

Add state, load, and mutation methods:

```typescript
const [characterVoices, setCharacterVoices] = useState<CharacterVoice[]>([]);

// In loadData, add:
const voiceRes = await getCharacterVoices(projectId).catch(() => ({ success: false, voices: [] }));
if (voiceRes.success) {
    setCharacterVoices(voiceRes.voices || []);
}

// Mutation methods:
const saveScript = useCallback(async (data: { original_content?: string; adapted_script?: string; metadata?: Record<string, any> }) => {
    await updateEpisodeScript(episodeId, data);
    await loadData();
}, [episodeId, loadData]);

const saveStoryboardItemFn = useCallback(async (itemId: string, data: Record<string, any>) => {
    await apiUpdateStoryboardItem(itemId, data);
    setStoryboardItems(prev => prev.map(item =>
        item.itemId === itemId ? { ...item, ...data } : item
    ));
}, []);

const createStoryboardItemsFn = useCallback(async (items: any[]) => {
    await batchCreateStoryboardItems(episodeId, items);
    await loadData();
}, [episodeId, loadData]);

const extractToAssetsFn = useCallback(async (characters: any[], scenes: any[]) => {
    await apiExtractToAssets(episodeId, characters, scenes);
    await loadData();
}, [episodeId, loadData]);
```

- [ ] **Step 4: Commit**

```bash
git add new_html/types.ts new_html/services/apiService.ts new_html/contexts/EpisodeContext.tsx
git commit -m "feat: add CharacterVoice types, API functions, and extended EpisodeContext"
```

---

## Task 5: Routes — Add Storyboard Page to Workflow

**Files:**
- Modify: `h:\MY2\new_html\layouts\WorkflowLayout.tsx`
- Modify: `h:\MY2\new_html\App.tsx`
- Create: `h:\MY2\new_html\pages\StoryboardGenPage.tsx` (placeholder)

- [ ] **Step 1: Update WorkflowLayout NAV_ITEMS**

Replace the `NAV_ITEMS` array in `h:\MY2\new_html\layouts\WorkflowLayout.tsx`:

```typescript
import { ArrowLeft, FileText, Image, Mic, Palette, Film, Sparkles, Clock, Brush, LogOut, Layout } from 'lucide-react';

const NAV_ITEMS = [
  { path: 'script', label: '剧本', icon: FileText },
  { path: 'design', label: '设计', icon: Palette },
  { path: 'materials', label: '素材绑定', icon: Image },
  { path: 'audio', label: '语音', icon: Mic },
  { path: 'storyboard', label: '分镜', icon: Layout },
  { path: 'generation', label: '视频', icon: Film },
  { path: 'enhance', label: '美化', icon: Sparkles },
];
```

Note: "历史" removed from main nav. Can be accessed via header or kept as a secondary link.

- [ ] **Step 2: Add route in App.tsx**

Add import and route:

```typescript
import { StoryboardGenPage } from './pages/StoryboardGenPage';

// Inside the workflow Route group, after audio:
<Route path="storyboard" element={<StoryboardGenPage />} />
```

- [ ] **Step 3: Create placeholder StoryboardGenPage**

```typescript
import React from 'react';
import { useEpisode } from '../contexts/EpisodeContext';

export const StoryboardGenPage: React.FC = () => {
  const { storyboardItems, assets, isLoading } = useEpisode();

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-gray-400">加载中...</div>;
  }

  return (
    <div className="h-full flex items-center justify-center text-gray-400">
      <div className="text-center">
        <p className="text-xl mb-2">分镜画面生成</p>
        <p className="text-sm">共 {storyboardItems.length} 个分镜，{assets.length} 个资产</p>
        <p className="text-xs mt-4 text-gray-600">Phase 6 实现</p>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Commit**

```bash
git add new_html/layouts/WorkflowLayout.tsx new_html/App.tsx new_html/pages/StoryboardGenPage.tsx
git commit -m "feat: add storyboard page to workflow navigation and routing"
```

---

## Task 6: Rewrite ScriptPage — Standalone 3-Column Editor

**Files:**
- Modify: `h:\MY2\new_html\pages\ScriptPage.tsx` — Full rewrite
- Reuse: `h:\MY2\new_html\components\ScriptColumn.tsx` (existing UI)
- Reuse: `h:\MY2\new_html\components\StoryboardColumn.tsx` (existing UI)

This is the largest rewrite. The current ScriptPage simply embeds WorkspaceApp. The new ScriptPage:

1. Reads from `episode_scripts` + `storyboard_items` via `useEpisode()`
2. Provides a 3-column layout: Original Text | Script Editor | Storyboard List
3. AI rewrite/extract calls go to the same backend services
4. All saves go to episode DB tables

- [ ] **Step 1: Design the data adapter layer**

The existing `ScriptColumn` and `StoryboardColumn` expect `ProjectFile` props (in-memory model). We need adapter functions that convert between `EpisodeScript`/`StoryboardItemDB` (DB model) and the props these components expect.

Create an adapter module `h:\MY2\new_html\utils\episodeAdapters.ts`:

```typescript
import type { StoryboardItemDB, EpisodeScript } from '../types';
import type { ProjectFile, StoryboardItem, StoryboardData } from '../types';

export function dbItemsToStoryboardData(items: StoryboardItemDB[]): StoryboardData {
  return {
    items: items.map(dbItemToStoryboardItem),
  };
}

export function dbItemToStoryboardItem(item: StoryboardItemDB): StoryboardItem {
  return {
    id: item.itemId,
    originalText: item.sceneHeading,
    scriptSegment: item.actionText,
    characters: [], // extracted from boundAssets or metadata
    scene: '',
    dialogue: item.dialogue,
    imagePrompt: item.imagePrompt,
    videoPrompt: item.videoPrompt,
    generatedImage: item.generatedImageUrl || undefined,
    generatedImages: item.generatedImageUrl
      ? [{ id: item.itemId, url: item.generatedImageUrl, timestamp: Date.now() }]
      : [],
    materialSelections: {},
    cameraMovement: item.cameraMovement,
    isLocked: item.status === 'locked',
    status: item.status,
  };
}

export function storyboardItemToDbUpdate(item: Partial<StoryboardItem>): Record<string, any> {
  const update: Record<string, any> = {};
  if (item.originalText !== undefined) update.scene_heading = item.originalText;
  if (item.scriptSegment !== undefined) update.action_text = item.scriptSegment;
  if (item.dialogue !== undefined) update.dialogue = item.dialogue;
  if (item.imagePrompt !== undefined) update.image_prompt = item.imagePrompt;
  if (item.videoPrompt !== undefined) update.video_prompt = item.videoPrompt;
  if (item.cameraMovement !== undefined) update.camera_movement = item.cameraMovement;
  if (item.generatedImage !== undefined) update.generated_image_url = item.generatedImage;
  if (item.isLocked !== undefined) update.status = item.isLocked ? 'locked' : 'draft';
  return update;
}

export function scriptToProjectFile(
  script: EpisodeScript | null,
  items: StoryboardItemDB[],
  episodeId: string
): ProjectFile {
  return {
    id: episodeId,
    name: '当前集',
    originalContent: script?.originalContent || '',
    scriptContent: script?.adaptedScript || null,
    storyboard: items.length > 0 ? dbItemsToStoryboardData(items) : null,
    extractedCharacters: script?.metadata?.extracted_characters || [],
    extractedScenes: script?.metadata?.extracted_scenes || [],
    status: 'idle' as any,
    lastUpdated: Date.now(),
    versions: [],
  };
}
```

- [ ] **Step 2: Rewrite ScriptPage.tsx**

The new ScriptPage renders the 3-column layout using `useEpisode()` for data and the adapter layer for component compatibility:

```typescript
import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import { ScriptColumn } from '../components/ScriptColumn';
import { StoryboardColumn } from '../components/StoryboardColumn';
import {
  scriptToProjectFile,
  storyboardItemToDbUpdate,
} from '../utils/episodeAdapters';
import { ArrowRight } from 'lucide-react';

export const ScriptPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    episodeId, projectId, script, storyboardItems, assets,
    isLoading, error, reload,
    saveScript, saveStoryboardItem, createStoryboardItems, extractToAssets,
  } = useEpisode();

  const [highlightedItemIds, setHighlightedItemIds] = useState<Set<string>>(new Set());

  // Convert DB data to ProjectFile format for legacy component compatibility
  const pseudoFile = useMemo(
    () => scriptToProjectFile(script, storyboardItems, episodeId),
    [script, storyboardItems, episodeId]
  );

  // --- Column 1: Original text viewer ---
  const renderOriginalText = () => (
    <div className="h-full flex flex-col bg-gray-950 border-r border-gray-800">
      <div className="px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-bold text-gray-300">原文</h3>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {script?.originalContent ? (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
            {script.originalContent}
          </pre>
        ) : (
          <div className="text-center text-gray-600 mt-20">
            <p>粘贴或上传原始文本开始</p>
            <textarea
              className="mt-4 w-full h-48 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-300 resize-none"
              placeholder="在此粘贴原始剧本文本..."
              onBlur={(e) => {
                if (e.target.value.trim()) {
                  saveScript({ original_content: e.target.value.trim() });
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );

  // --- Handlers that bridge legacy components to DB ---
  const handleUpdateScript = useCallback(async (content: string) => {
    await saveScript({ adapted_script: content });
  }, [saveScript]);

  const handleUpdateItem = useCallback(async (shotId: string, updates: any) => {
    const dbUpdates = storyboardItemToDbUpdate(
      typeof updates === 'function' ? updates({}) : updates
    );
    await saveStoryboardItem(shotId, dbUpdates);
  }, [saveStoryboardItem]);

  const handleExportToDesign = useCallback(() => {
    navigate(`/projects/${projectId}/ep/${episodeId}/workflow/design`);
  }, [navigate, projectId, episodeId]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-gray-400">加载剧本数据...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with export button */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/50">
        <span className="text-sm text-gray-400">
          {storyboardItems.length} 个分镜 · {assets.filter(a => a.assetType === 'character').length} 个人物 · {assets.filter(a => a.assetType === 'scene').length} 个场景
        </span>
        <button
          onClick={handleExportToDesign}
          className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
        >
          导出到设计 <ArrowRight size={14} />
        </button>
      </div>

      {/* 3-column layout */}
      <div className="flex-1 flex min-h-0">
        <div className="w-1/4 min-w-[250px]">{renderOriginalText()}</div>
        <div className="w-2/4 border-r border-gray-800">
          <ScriptColumn
            files={[pseudoFile]}
            selectedFileId={episodeId}
            onUpdateScript={handleUpdateScript}
            aiModel="deepseek"
            onExtractShots={() => {/* TODO: call AI extract → saveScript metadata + extractToAssets */}}
            onRewrite={() => {/* TODO: call AI rewrite → saveScript adapted_script */}}
            highlightedItemIds={highlightedItemIds}
            {/* Pass remaining props with stubs */}
          />
        </div>
        <div className="w-1/4 min-w-[280px]">
          <StoryboardColumn
            files={[pseudoFile]}
            selectedFileId={episodeId}
            onUpdateItem={handleUpdateItem}
            onExport={handleExportToDesign}
            onHighlightScript={(ids) => setHighlightedItemIds(new Set(ids))}
            {/* Pass remaining props with stubs */}
          />
        </div>
      </div>
    </div>
  );
};
```

**Important notes:**
- This is a skeleton. The actual implementation needs to wire ALL ScriptColumn/StoryboardColumn props.
- AI operations (rewrite, extract, refine) will call the same backend services, just save results to DB instead of in-memory.
- The adapter layer (`episodeAdapters.ts`) handles the translation between DB model and legacy component model.

- [ ] **Step 3: Test manually**

Navigate to `/projects/{pid}/ep/{eid}/workflow/script`. Verify:
- 3 columns render
- Data loads from DB (may be empty initially)
- Pasting text into original column saves to DB

- [ ] **Step 4: Commit**

```bash
git add new_html/pages/ScriptPage.tsx new_html/utils/episodeAdapters.ts
git commit -m "feat: rewrite ScriptPage as standalone DB-driven 3-column editor"
```

---

## Task 7: Enhance DesignPage — Design Status + AI Image Generation

**Files:**
- Modify: `h:\MY2\new_html\pages\DesignPage.tsx`

- [ ] **Step 1: Add design status indicators and AI generation**

The current DesignPage has basic CRUD. Enhance it:

1. Show "待设计" (no thumbnail) vs "已设计" (has thumbnail) status on each card
2. Add AI image generation button per asset (using `generateFinalIllustration` from geminiService)
3. Add upload button for reference images
4. Show asset description from script extraction
5. Add "导出到素材绑定" button

Key additions to the existing DesignPage:

```typescript
// Import AI generation service
import { generateFinalIllustration } from '../services/geminiService';
import { updateAsset } from '../services/apiService';

// Per-card: show status badge
const isDesigned = asset.thumbnailUrl || (asset.referenceImages && asset.referenceImages.length > 0);

// Generate image handler
const handleGenerateDesign = async (asset: AssetItem) => {
  const result = await generateFinalIllustration(
    asset.description || asset.name,
    [], // reference images
    'character_design' // style
  );
  if (result) {
    await updateAsset(asset.assetId, {
      thumbnail_url: result.thumbnail || result.url,
      reference_images: [result.url], // full resolution for AI reference + lightbox
    });
    reload();
  }
};

// Export button in header
<button onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/materials`)}>
  导出到素材绑定 <ArrowRight size={14} />
</button>
```

- [ ] **Step 2: Commit**

```bash
git add new_html/pages/DesignPage.tsx
git commit -m "feat: enhance DesignPage with design status, AI generation, and export navigation"
```

---

## Task 8: Rewrite MaterialsPage — Standalone Material Binding

**Files:**
- Modify: `h:\MY2\new_html\pages\MaterialsPage.tsx` — Full rewrite

- [ ] **Step 1: Create standalone material binding page**

Currently wraps WorkspaceApp. Rewrite to:
- Read storyboard items and assets from `useEpisode()`
- Left panel: storyboard shots list (each showing needed characters/scenes)
- Right panel: available assets grid with bind/unbind actions
- Binding writes `bound_assets` JSONB to storyboard_items

Reuse UI patterns from `components/MaterialPage.tsx` but with DB data layer:

```typescript
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import { updateStoryboardItem } from '../services/apiService';
import { ArrowRight, Check, Link, Upload } from 'lucide-react';

export const MaterialsPage: React.FC = () => {
  const navigate = useNavigate();
  const { episodeId, projectId, storyboardItems, assets, isLoading, reload } = useEpisode();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const selectedItem = storyboardItems.find(i => i.itemId === selectedItemId);

  const handleBind = useCallback(async (itemId: string, assetId: string) => {
    const item = storyboardItems.find(i => i.itemId === itemId);
    const currentBound = Array.isArray(item?.boundAssets) ? [...item.boundAssets] : [];
    if (!currentBound.includes(assetId)) {
      currentBound.push(assetId);
      await updateStoryboardItem(itemId, { bound_assets: currentBound });
      reload();
    }
  }, [storyboardItems, reload]);

  const handleUnbind = useCallback(async (itemId: string, assetId: string) => {
    const item = storyboardItems.find(i => i.itemId === itemId);
    const currentBound = Array.isArray(item?.boundAssets) ? item.boundAssets.filter((id: string) => id !== assetId) : [];
    await updateStoryboardItem(itemId, { bound_assets: currentBound });
    reload();
  }, [storyboardItems, reload]);

  // ... render left panel (shot list) + right panel (asset grid with bind buttons)
  // ... "导出到语音" button navigates to /workflow/audio
};
```

**Note:** The full MaterialsPage implementation should also integrate the existing `MaterialAIModal`, `CameraModal`, `ProcessModal`, `ThreeViewModal` modals from `components/MaterialPage.tsx` for advanced features (AI generation, angle adjustment, upscale, matting, three-view). These modals are standalone components and can be imported directly — they only need an image URL and callback props.

- [ ] **Step 2: Commit**

```bash
git add new_html/pages/MaterialsPage.tsx
git commit -m "feat: rewrite MaterialsPage as standalone DB-driven material binding"
```

---

## Task 9: Enhance AudioStagePage — Character Voice Management

**Files:**
- Modify: `h:\MY2\new_html\pages\AudioStagePage.tsx`

- [ ] **Step 1: Add character voice configuration section**

Above the existing per-shot TTS list, add a "人物音色配置" section:

```typescript
import { useEpisode } from '../contexts/EpisodeContext';
import {
  createCharacterVoice, updateCharacterVoice, deleteCharacterVoice,
} from '../services/apiService';

// In component:
const { assets, characterVoices, storyboardItems, reload } = useEpisode();
const characterAssets = assets.filter(a => a.assetType === 'character');

// Voice config UI: for each character asset, show voice settings
// - voice_provider select (tts-1, edge-tts, fish-audio, etc.)
// - voice_model_id input
// - voice_name display name
// - voice_params (speed, pitch, emotion sliders)
// - "试听" preview button
// - Save creates/updates character_voices record

// Per-shot TTS: auto-fill voice from character's bound asset → character_voice lookup
const getVoiceForShot = (item: StoryboardItemDB) => {
  const boundCharacterId = item.boundAssets?.find((id: string) =>
    characterAssets.some(a => a.assetId === id)
  );
  if (boundCharacterId) {
    return characterVoices.find(v => v.assetId === boundCharacterId);
  }
  return null;
};
```

- [ ] **Step 2: Add "导出到分镜" navigation**

```typescript
<button onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`)}>
  导出到分镜 <ArrowRight size={14} />
</button>
```

- [ ] **Step 3: Commit**

```bash
git add new_html/pages/AudioStagePage.tsx
git commit -m "feat: enhance AudioStagePage with character voice management and export navigation"
```

---

## Task 10: Create StoryboardGenPage — Full Image Generation (Phase 6)

**Files:**
- Modify: `h:\MY2\new_html\pages\StoryboardGenPage.tsx` — Full implementation

This is the largest single task. Migrate `components/GenerationPage.tsx` (3495 lines) to use episode DB tables.

- [ ] **Step 1: Copy and adapt GenerationPage**

Strategy: Copy `components/GenerationPage.tsx` to `pages/StoryboardGenPage.tsx`, then systematically replace data sources:

1. **Replace props with useEpisode():**
   - `files` / `selectedFile` → `useEpisode().storyboardItems` + adapter
   - `materialLibrary` → `useEpisode().assets` (converted to library format)
   - `onUpdateStoryboardItem` → `updateStoryboardItem` API call
   - `onForceSave` → `reload()` after API call

2. **Asset-to-MaterialLibrary adapter:**

```typescript
function assetsToMaterialLibrary(assets: AssetItem[]): Record<string, Material[]> {
  const lib: Record<string, Material[]> = {};
  for (const asset of assets) {
    const key = asset.name;
    if (!lib[key]) lib[key] = [];
    lib[key].push({
      id: asset.assetId,
      url: asset.referenceImages?.[0] || asset.thumbnailUrl || '',
      thumbnail: asset.thumbnailUrl || asset.referenceImages?.[0] || '',
      name: asset.name,
      source: 'asset',
    });
  }
  return lib;
}
```

3. **Replace save callbacks:**
   - Image generated → `updateStoryboardItem(itemId, { generated_image_url: url })`
   - Version save → `saveScript({ metadata: { ...script.metadata, versions: [...] } })`

4. **Keep ALL these unchanged:**
   - 6 generation models (qwen, qwen_lora, nanobanana, kontext, qwenN_lora, qwenN)
   - All geminiService calls (generateFinalIllustration, generateHumanMultiAngleQueued, etc.)
   - MattingModal, ImageFusionModal, StoryboardToolModal, MultiAngle3DController
   - Batch generation, per-shot model selection, prompt editing
   - Reference image system (loads from `assets.reference_images` — full resolution for AI input, `thumbnailUrl` for card display only)

- [ ] **Step 2: Add navigation**

```typescript
// "导出到视频" button
<button onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/generation`)}>
  导出到视频 <ArrowRight size={14} />
</button>
```

- [ ] **Step 3: Test manually**

Navigate to `/projects/{pid}/ep/{eid}/workflow/storyboard`. Verify:
- Storyboard items load from DB
- Assets appear as references
- Model selection works
- Image generation works (if backend AI services are configured)

- [ ] **Step 4: Commit**

```bash
git add new_html/pages/StoryboardGenPage.tsx
git commit -m "feat: implement StoryboardGenPage with full image generation, 6 models, and all tools"
```

---

## Task 11: Adjust Video Page (GenerationPage) — Asset Library + Navigation

**Files:**
- Modify: `h:\MY2\new_html\pages\GenerationPage.tsx`

- [ ] **Step 1: Ensure generated images display correctly**

The page already uses `useEpisode()`. Verify that `storyboardItems` with `generatedImageUrl` render their images.

- [ ] **Step 2: Add asset library sidebar**

Show assets from `useEpisode().assets` in a collapsible panel for reference.

- [ ] **Step 3: Add "导出到美化" navigation**

```typescript
<button onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/enhance`)}>
  导出到美化 <ArrowRight size={14} />
</button>
```

- [ ] **Step 4: Commit**

```bash
git add new_html/pages/GenerationPage.tsx
git commit -m "feat: adjust video page with asset library and export navigation"
```

---

## Task 12: Enhance EnhancePage — Persist Timeline + Real Enhancement

**Files:**
- Modify: `h:\MY2\new_html\pages\EnhancePage.tsx`

- [ ] **Step 1: Save timeline state to DB**

On clip changes (drag, split, delete, import audio), save to `timeline_tracks`:

```typescript
import { createTimelineTrack, updateTimelineTrack, getTimelineTracks } from '../services/apiService';

// On mount: load existing timeline tracks
// On change: save video track and audio track items to DB
const saveTimeline = async () => {
  // Serialize clips to timeline track format
  const videoTrackData = clips.filter(c => c.type === 'video').map(c => ({
    segmentId: c.id, startTime: c.startTime, duration: c.duration, settings: c.settings,
  }));
  // Create or update timeline tracks via API
};
```

- [ ] **Step 2: Wire enhancement to task queue (placeholder)**

Replace the fake progress with actual API call to submit enhancement task:

```typescript
const applyEnhancement = async () => {
  // POST to /api/tasks or ComfyUI agent for upscale/interpolation/lip-sync
  // Poll for completion
};
```

Note: Full enhancement backend integration depends on ComfyUI agent availability. For now, improve the UX by making the submit call real when possible, and show "功能开发中" for unavailable features.

- [ ] **Step 3: Commit**

```bash
git add new_html/pages/EnhancePage.tsx
git commit -m "feat: enhance EnhancePage with timeline persistence and enhancement task submission"
```

---

## Task 13: Sync to Deploy + Cleanup

**Files:**
- All modified files → `h:\MY2\deploy\new_html\`

- [ ] **Step 1: Sync all changed frontend files to deploy**

```bash
# From project root
xcopy /Y /S "new_html\*.tsx" "deploy\new_html\"
xcopy /Y /S "new_html\*.ts" "deploy\new_html\"
```

- [ ] **Step 2: Sync backend files**

```bash
copy /Y dao_character_voice.py deploy\
copy /Y dao_storyboard.py deploy\
copy /Y api_routes.py deploy\
copy /Y db_migration_character_voices.sql deploy\
```

- [ ] **Step 3: Verify old WorkspaceApp routes still work**

The old routes (`/projects/:id/materials`, `/projects/:id/generation`, etc.) in App.tsx still point to WorkspaceApp. These serve as fallback for any project not using the episode workflow.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete 7-step video pipeline with DB-driven workflow pages"
```

---

## Image Loading Rules (Cross-cutting)

All pages must follow these rules for image assets:

| Context | Image Source | Field |
|---------|-------------|-------|
| List/card thumbnails | Small, fast | `asset.thumbnailUrl` |
| User click-to-zoom | Full resolution | `asset.referenceImages[0]` |
| AI generation reference | Full resolution | `asset.referenceImages[0]` |
| Generated storyboard | As stored | `storyboardItem.generatedImageUrl` |

All image URLs must include auth token via `secureMediaUrl()` or `getAuthenticatedImageUrl()` from existing utilities.

---

## Execution Order

Tasks must be executed in order (each builds on the previous):

```
Task 1 (DB migration)
  → Task 2 (DAO)
    → Task 3 (API endpoints)
      → Task 4 (Frontend types + context)
        → Task 5 (Routes)
          → Task 6 (ScriptPage) ← largest rewrite
            → Task 7 (DesignPage)
              → Task 8 (MaterialsPage) ← second largest
                → Task 9 (AudioStagePage)
                  → Task 10 (StoryboardGenPage) ← third largest
                    → Task 11 (VideoPage)
                      → Task 12 (EnhancePage)
                        → Task 13 (Sync + Cleanup)
```

Tasks 6-12 can technically be parallelized (different pages), but each depends on Tasks 1-5 being complete.
