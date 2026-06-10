# MY2 UI 全面重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MY2 从"单页面多视图"重构为"分集驱动的多页面 + 无限画布"架构，TDD 驱动全部开发。

**Architecture:** 四层嵌套路由 (Project > Episode > Mode > Page)，新增 EpisodeContext 提供集级数据，7 张新数据库表支撑独立数据存储，音频预演页前置解决时序问题，@xyflow/react 实现节点化画布。所有新代码 RED-GREEN-REFACTOR。

**Tech Stack:** React 19 + Vite 6 + TypeScript + React Router 7 + @xyflow/react + Tailwind | FastAPI + asyncpg + Redis | Vitest + @testing-library/react | pytest + pytest-asyncio + httpx

**Spec:** [`docs/superpowers/specs/2026-03-22-ui-redesign-design.md`](docs/superpowers/specs/2026-03-22-ui-redesign-design.md)

---

## File Structure

### New files to create

```
# Frontend test infra
new_html/test/setup.ts                           -- Vitest global setup
new_html/test/test-utils.tsx                      -- Custom render with providers
new_html/__tests__/smoke.test.ts                  -- Smoke test
new_html/__tests__/services/apiService.test.ts    -- API service tests
new_html/__tests__/contexts/EpisodeContext.test.tsx
new_html/__tests__/App.test.tsx                   -- Routing tests
new_html/__tests__/pages/EpisodeHub.test.tsx
new_html/__tests__/pages/ScriptPage.test.tsx
new_html/__tests__/pages/MaterialsPage.test.tsx
new_html/__tests__/pages/GenerationPage.test.tsx
new_html/__tests__/pages/HistoryPage.test.tsx
new_html/__tests__/pages/DesignPage.test.tsx
new_html/__tests__/pages/AudioStage.test.tsx
new_html/__tests__/pages/VideoWorkspace.test.tsx
new_html/__tests__/pages/EnhancePage.test.tsx
new_html/__tests__/pages/CanvasPage.test.tsx
new_html/__tests__/canvas/nodes/ImageGeneratorNode.test.tsx
new_html/__tests__/canvas/AgentPanel.test.tsx

# Frontend new source files
new_html/contexts/EpisodeContext.tsx               -- Episode-level data context
new_html/layouts/WorkflowLayout.tsx                -- Workflow tab container
new_html/pages/EpisodeHub.tsx                      -- Episode management
new_html/pages/ScriptPage.tsx                      -- Script editing (from WorkspaceApp)
new_html/pages/MaterialsPage.tsx                   -- Material binding (from WorkspaceApp)
new_html/pages/DesignPage.tsx                      -- Asset design (new)
new_html/pages/AudioStage.tsx                      -- Audio pre-viz (new)
new_html/pages/GenerationPage.tsx                  -- Visual storyboard (from WorkspaceApp)
new_html/pages/VideoWorkspace.tsx                  -- Video generation (new)
new_html/pages/EnhancePage.tsx                     -- Video enhancement (new)
new_html/pages/HistoryPage.tsx                     -- History (from WorkspaceApp)
new_html/pages/CanvasPage.tsx                      -- Infinite canvas (new)
new_html/canvas/nodes/TextInputNode.tsx
new_html/canvas/nodes/ImageGeneratorNode.tsx
new_html/canvas/nodes/VideoGeneratorNode.tsx
new_html/canvas/nodes/AudioGeneratorNode.tsx
new_html/canvas/nodes/StoryboardNode.tsx
new_html/canvas/nodes/VideoAnalyzerNode.tsx
new_html/canvas/AgentPanel.tsx
new_html/canvas/AssistantPanel.tsx
new_html/canvas/CanvasToolbar.tsx
new_html/canvas/WorkflowTemplates.tsx
new_html/components/TimelineEditor.tsx             -- Multi-track timeline (shared)
new_html/components/AssetLibraryPanel.tsx           -- Asset library (shared)
new_html/services/audioProvider.ts                  -- Audio provider interface
new_html/services/geminiAudioProvider.ts            -- Gemini implementation

# Backend test infra
tests/conftest.py
tests/test_smoke.py
pytest.ini

# Backend new source files
dao_asset.py
dao_storyboard.py
dao_video_segment.py
dao_timeline.py
dao_episode_script.py
dao_audio_track.py
audio_provider.py

# Backend tests
tests/test_dao_asset.py
tests/test_dao_storyboard.py
tests/test_dao_video_segment.py
tests/test_dao_timeline.py
tests/test_dao_episode_script.py
tests/test_dao_audio_track.py
tests/test_api_assets.py
tests/test_api_storyboard.py
tests/test_audio_provider.py
tests/test_migration.py

# SQL migrations
db_migration_assets.sql
db_migration_episode_scripts.sql
db_migration_storyboard_items.sql
db_migration_video_segments.sql
db_migration_timeline_tracks.sql
db_migration_audio_tracks.sql

# Data migration
migrate_settings_to_tables.py
```

### Files to modify

```
new_html/vite.config.ts       -- Add test block
new_html/package.json          -- Add test deps & scripts
new_html/tsconfig.json         -- Add vitest types
new_html/App.tsx               -- Rewrite routes
new_html/types.ts              -- Add new interfaces
new_html/services/apiService.ts -- Add new API functions
new_html/components/Header.tsx  -- Adapt to new routing
new_html/components/ProjectWorkspace.tsx -- Add EpisodeProvider nesting
api_routes.py                  -- Add new API endpoints
requirements.txt               -- Add test deps
```

---

## Task 1: Frontend Test Infrastructure

**Files:**
- Create: `new_html/test/setup.ts`
- Create: `new_html/test/test-utils.tsx`
- Create: `new_html/__tests__/smoke.test.ts`
- Modify: `new_html/vite.config.ts`
- Modify: `new_html/package.json`
- Modify: `new_html/tsconfig.json`

- [ ] **Step 1: Install test dependencies**

```bash
cd new_html
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/react @types/react-dom
```

- [ ] **Step 2: Add test config to `vite.config.ts`**

Add the `test` block inside the returned config object, after `build`:

```typescript
// In new_html/vite.config.ts, add inside the return object after 'build':
test: {
  globals: true,
  environment: 'jsdom',
  setupFiles: ['./test/setup.ts'],
  include: ['__tests__/**/*.test.{ts,tsx}'],
  css: false,
},
```

The file needs `/// <reference types="vitest/config" />` at the very top.

- [ ] **Step 3: Add vitest types to `tsconfig.json`**

Add `"vitest/globals"` to `compilerOptions.types`:

```json
"types": ["node", "vitest/globals"]
```

- [ ] **Step 4: Add test scripts to `package.json`**

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 5: Create `new_html/test/setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Create `new_html/test/test-utils.tsx`**

```typescript
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

function AllProviders({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function customRender(ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'> & { route?: string }) {
  const { route, ...renderOptions } = options || {};
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={route ? [route] : ['/']}>
        {children}
      </MemoryRouter>
    ),
    ...renderOptions,
  });
}

export * from '@testing-library/react';
export { customRender as render };
```

- [ ] **Step 7: Create smoke test**

```typescript
// new_html/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('test infrastructure', () => {
  it('vitest runs correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('jsdom is available', () => {
    expect(document).toBeDefined();
  });
});
```

- [ ] **Step 8: Run smoke test to verify**

```bash
cd new_html && npx vitest run __tests__/smoke.test.ts
```

Expected: 2 tests passed.

- [ ] **Step 9: Commit**

```bash
git add new_html/test/ new_html/__tests__/smoke.test.ts new_html/vite.config.ts new_html/package.json new_html/tsconfig.json new_html/package-lock.json
git commit -m "chore: set up frontend test infrastructure with Vitest"
```

---

## Task 2: Backend Test Infrastructure

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_smoke.py`
- Create: `pytest.ini`
- Modify: `requirements.txt`

- [ ] **Step 1: Add test deps to `requirements.txt`**

Append:

```
pytest>=8.0
pytest-asyncio>=0.23
httpx>=0.27
```

- [ ] **Step 2: Install deps**

```bash
pip install pytest pytest-asyncio httpx
```

- [ ] **Step 3: Create `pytest.ini`**

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
python_functions = test_*
```

- [ ] **Step 4: Create `tests/conftest.py`**

```python
# -*- coding: utf-8 -*-
"""
测试配置 - fixtures 和测试数据库设置
"""
import pytest
import asyncio
import json
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def test_db():
    """提供测试数据库连接，每个测试用事务包裹，结束后回滚"""
    from db_manager import get_db_manager
    db = get_db_manager()
    if not db or not db.pool:
        from db_manager import init_db_manager
        db = await init_db_manager()
    conn = await db.pool.acquire()
    tx = conn.transaction()
    await tx.start()
    yield conn
    await tx.rollback()
    await db.pool.release(conn)


@pytest.fixture
async def client():
    """提供 FastAPI 测试客户端"""
    from cluster_main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def auth_headers(client):
    """登录获取 token，返回 Authorization header"""
    resp = await client.post("/api/login", json={
        "username": "admin",
        "password": "admin123"
    })
    if resp.status_code == 200 and resp.json().get("token"):
        return {"Authorization": f"Bearer {resp.json()['token']}"}
    return {"Authorization": "Bearer test-fallback-token"}
```

- [ ] **Step 5: Create `tests/test_smoke.py`**

```python
def test_smoke():
    assert True


async def test_async_smoke():
    assert 1 + 1 == 2
```

- [ ] **Step 6: Run smoke test to verify**

```bash
cd h:\MY2 && python -m pytest tests/test_smoke.py -v
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add tests/ pytest.ini requirements.txt
git commit -m "chore: set up backend test infrastructure with pytest"
```

---

## Task 3: Database Migration Scripts

**Files:**
- Create: `db_migration_assets.sql`
- Create: `db_migration_episode_scripts.sql`
- Create: `db_migration_storyboard_items.sql`
- Create: `db_migration_video_segments.sql`
- Create: `db_migration_timeline_tracks.sql`
- Create: `db_migration_audio_tracks.sql`

No TDD needed for DDL. Follow existing pattern from [`db_migration_episodes.sql`](db_migration_episodes.sql).

- [ ] **Step 1: Create `db_migration_assets.sql`**

```sql
-- assets: 人物/场景/道具资产
CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    asset_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE SET NULL,
    asset_type VARCHAR(20) NOT NULL CHECK (asset_type IN ('character', 'scene', 'prop')),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    thumbnail_url TEXT,
    reference_images JSONB DEFAULT '[]'::jsonb,
    style_params JSONB DEFAULT '{}'::jsonb,
    tags JSONB DEFAULT '[]'::jsonb,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_project_episode ON assets(project_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

CREATE OR REPLACE FUNCTION update_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assets_updated_at ON assets;
CREATE TRIGGER trg_assets_updated_at
    BEFORE UPDATE ON assets FOR EACH ROW
    EXECUTE FUNCTION update_assets_updated_at();
```

- [ ] **Step 2: Create `db_migration_episode_scripts.sql`**

```sql
-- episode_scripts: 每集剧本文本
CREATE TABLE IF NOT EXISTS episode_scripts (
    id SERIAL PRIMARY KEY,
    script_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL UNIQUE REFERENCES episodes(episode_id) ON DELETE CASCADE,
    original_content TEXT DEFAULT '',
    adapted_script TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_scripts_episode ON episode_scripts(episode_id);

CREATE OR REPLACE FUNCTION update_episode_scripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_episode_scripts_updated_at ON episode_scripts;
CREATE TRIGGER trg_episode_scripts_updated_at
    BEFORE UPDATE ON episode_scripts FOR EACH ROW
    EXECUTE FUNCTION update_episode_scripts_updated_at();
```

- [ ] **Step 3: Create `db_migration_storyboard_items.sql`**

```sql
-- storyboard_items: 分镜内容
CREATE TABLE IF NOT EXISTS storyboard_items (
    id SERIAL PRIMARY KEY,
    item_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    scene_heading VARCHAR(255) DEFAULT '',
    action_text TEXT DEFAULT '',
    dialogue TEXT DEFAULT '',
    camera_movement VARCHAR(255) DEFAULT '',
    image_prompt TEXT DEFAULT '',
    video_prompt TEXT DEFAULT '',
    generated_image_url TEXT,
    bound_assets JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) DEFAULT 'draft',
    -- Audio fields
    dialogue_audio_url TEXT,
    narration_audio_url TEXT,
    sfx_audio_url TEXT,
    audio_duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_storyboard_items_episode ON storyboard_items(episode_id);
CREATE INDEX IF NOT EXISTS idx_storyboard_items_episode_sort ON storyboard_items(episode_id, sort_order);

CREATE OR REPLACE FUNCTION update_storyboard_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_storyboard_items_updated_at ON storyboard_items;
CREATE TRIGGER trg_storyboard_items_updated_at
    BEFORE UPDATE ON storyboard_items FOR EACH ROW
    EXECUTE FUNCTION update_storyboard_items_updated_at();
```

- [ ] **Step 4: Create `db_migration_video_segments.sql`**

```sql
-- video_segments: 视频片段
CREATE TABLE IF NOT EXISTS video_segments (
    id SERIAL PRIMARY KEY,
    segment_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    storyboard_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    generation_mode VARCHAR(30) DEFAULT 'i2v',
    model VARCHAR(50) DEFAULT '',
    input_params JSONB DEFAULT '{}'::jsonb,
    video_url TEXT,
    thumbnail_url TEXT,
    duration_ms INTEGER,
    task_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_video_segments_episode ON video_segments(episode_id);
CREATE INDEX IF NOT EXISTS idx_video_segments_storyboard ON video_segments(storyboard_item_id);

CREATE OR REPLACE FUNCTION update_video_segments_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_video_segments_updated_at ON video_segments;
CREATE TRIGGER trg_video_segments_updated_at
    BEFORE UPDATE ON video_segments FOR EACH ROW
    EXECUTE FUNCTION update_video_segments_updated_at();
```

- [ ] **Step 5: Create `db_migration_timeline_tracks.sql`**

```sql
-- timeline_tracks: 多轨时间轴
CREATE TABLE IF NOT EXISTS timeline_tracks (
    id SERIAL PRIMARY KEY,
    track_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    track_type VARCHAR(20) NOT NULL CHECK (track_type IN ('video', 'audio', 'subtitle')),
    track_name VARCHAR(255) DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    items JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timeline_tracks_episode ON timeline_tracks(episode_id);

CREATE OR REPLACE FUNCTION update_timeline_tracks_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timeline_tracks_updated_at ON timeline_tracks;
CREATE TRIGGER trg_timeline_tracks_updated_at
    BEFORE UPDATE ON timeline_tracks FOR EACH ROW
    EXECUTE FUNCTION update_timeline_tracks_updated_at();
```

- [ ] **Step 6: Create `db_migration_audio_tracks.sql`**

```sql
-- audio_tracks: 集级 BGM 和跨分镜音频
CREATE TABLE IF NOT EXISTS audio_tracks (
    id SERIAL PRIMARY KEY,
    track_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    track_type VARCHAR(30) NOT NULL CHECK (track_type IN ('bgm', 'sfx_global', 'narration_global')),
    name VARCHAR(255) DEFAULT '',
    audio_url TEXT,
    duration_ms INTEGER,
    start_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE SET NULL,
    end_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE SET NULL,
    generation_params JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audio_tracks_episode ON audio_tracks(episode_id);

CREATE OR REPLACE FUNCTION update_audio_tracks_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audio_tracks_updated_at ON audio_tracks;
CREATE TRIGGER trg_audio_tracks_updated_at
    BEFORE UPDATE ON audio_tracks FOR EACH ROW
    EXECUTE FUNCTION update_audio_tracks_updated_at();
```

- [ ] **Step 7: Add `episode_id` to `canvas_boards`**

```sql
-- Add to one of the migration scripts or a new file:
ALTER TABLE canvas_boards ADD COLUMN IF NOT EXISTS episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_canvas_boards_episode ON canvas_boards(episode_id);
```

- [ ] **Step 8: Execute all migrations**

```bash
cd h:\MY2
psql -U my2_user -d my2_db -f db_migration_assets.sql
psql -U my2_user -d my2_db -f db_migration_episode_scripts.sql
psql -U my2_user -d my2_db -f db_migration_storyboard_items.sql
psql -U my2_user -d my2_db -f db_migration_video_segments.sql
psql -U my2_user -d my2_db -f db_migration_timeline_tracks.sql
psql -U my2_user -d my2_db -f db_migration_audio_tracks.sql
```

- [ ] **Step 9: Commit**

```bash
git add db_migration_*.sql
git commit -m "feat: add 6 new database tables for UI redesign"
```

---

## Task 4: Backend DAO - Assets [TDD]

**Files:**
- Create: `dao_asset.py`
- Test: `tests/test_dao_asset.py`

Follow existing DAO pattern from [`dao_episode.py`](dao_episode.py): static methods, `get_db_manager()`, `$n` placeholders, `RETURNING *`, ID format `asset_{uuid.uuid4().hex[:12]}`.

- [ ] **Step 1: Write failing tests** (`tests/test_dao_asset.py`)

```python
# -*- coding: utf-8 -*-
"""
资产 DAO 测试
"""
import pytest


async def test_create_asset_returns_complete_record(test_db):
    from dao_asset import AssetDAO
    result = await AssetDAO.create(
        project_id="proj_test1", episode_id=None,
        asset_type="character", name="主角",
        description="黑发少年", created_by="user_test"
    )
    assert result is not None
    assert result["asset_id"].startswith("asset_")
    assert result["name"] == "主角"
    assert result["asset_type"] == "character"
    assert result["episode_id"] is None


async def test_get_project_assets_includes_shared(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="scene", name="学校", created_by="u1")
    await AssetDAO.create(project_id="proj_1", episode_id="ep_1",
                          asset_type="scene", name="教室", created_by="u1")
    results = await AssetDAO.get_by_project("proj_1", episode_id="ep_1")
    names = [r["name"] for r in results]
    assert "学校" in names
    assert "教室" in names


async def test_get_assets_filters_by_project(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_A", episode_id=None,
                          asset_type="prop", name="剑", created_by="u1")
    results = await AssetDAO.get_by_project("proj_B")
    assert len(results) == 0


async def test_update_asset_name(test_db):
    from dao_asset import AssetDAO
    created = await AssetDAO.create(project_id="proj_1", episode_id=None,
                                     asset_type="character", name="旧名", created_by="u1")
    updated = await AssetDAO.update(created["asset_id"], name="新名")
    assert updated["name"] == "新名"


async def test_delete_asset(test_db):
    from dao_asset import AssetDAO
    created = await AssetDAO.create(project_id="proj_1", episode_id=None,
                                     asset_type="prop", name="盾牌", created_by="u1")
    await AssetDAO.delete(created["asset_id"])
    result = await AssetDAO.get_by_id(created["asset_id"])
    assert result is None


async def test_filter_assets_by_type(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="character", name="人物A", created_by="u1")
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="scene", name="场景A", created_by="u1")
    chars = await AssetDAO.get_by_project("proj_1", asset_type="character")
    assert all(r["asset_type"] == "character" for r in chars)
```

- [ ] **Step 2: Run tests to verify RED**

```bash
python -m pytest tests/test_dao_asset.py -v
```

Expected: FAIL (ImportError: `dao_asset` does not exist).

- [ ] **Step 3: Implement `dao_asset.py`**

```python
# -*- coding: utf-8 -*-
"""
资产 DAO -- assets 表的增删改查
"""
import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class AssetDAO:

    @staticmethod
    async def create(
        project_id: str,
        asset_type: str,
        name: str,
        created_by: str,
        episode_id: Optional[str] = None,
        description: str = '',
        thumbnail_url: Optional[str] = None,
        reference_images: Optional[list] = None,
        style_params: Optional[dict] = None,
        tags: Optional[list] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        aid = f"asset_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO assets
                (asset_id, project_id, episode_id, asset_type, name, description,
                 thumbnail_url, reference_images, style_params, tags, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)
            RETURNING *
        """
        return await db.fetchrow(
            query, aid, project_id, episode_id, asset_type, name, description,
            thumbnail_url,
            json.dumps(reference_images or [], ensure_ascii=False),
            json.dumps(style_params or {}, ensure_ascii=False),
            json.dumps(tags or [], ensure_ascii=False),
            created_by
        )

    @staticmethod
    async def get_by_id(asset_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM assets WHERE asset_id = $1", asset_id
        )

    @staticmethod
    async def get_by_project(
        project_id: str,
        episode_id: Optional[str] = None,
        asset_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        conditions = ["project_id = $1"]
        args: list = [project_id]
        idx = 2

        if episode_id:
            conditions.append(f"(episode_id IS NULL OR episode_id = ${idx})")
            args.append(episode_id)
            idx += 1

        if asset_type:
            conditions.append(f"asset_type = ${idx}")
            args.append(asset_type)
            idx += 1

        where = " AND ".join(conditions)
        query = f"SELECT * FROM assets WHERE {where} ORDER BY created_at DESC"
        return await db.fetch(query, *args)

    @staticmethod
    async def update(asset_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {'name', 'description', 'thumbnail_url', 'reference_images',
                    'style_params', 'tags', 'episode_id'}
        sets, vals, idx = [], [], 1
        for key, val in kwargs.items():
            if key in allowed and val is not None:
                if key in ('reference_images', 'style_params', 'tags'):
                    sets.append(f"{key} = ${idx}::jsonb")
                    vals.append(json.dumps(val, ensure_ascii=False))
                else:
                    sets.append(f"{key} = ${idx}")
                    vals.append(val)
                idx += 1
        if not sets:
            return await AssetDAO.get_by_id(asset_id)
        vals.append(asset_id)
        query = f"UPDATE assets SET {', '.join(sets)} WHERE asset_id = ${idx} RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def delete(asset_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM assets WHERE asset_id = $1", asset_id
        )
        return result == "DELETE 1"
```

- [ ] **Step 4: Run tests to verify GREEN**

```bash
python -m pytest tests/test_dao_asset.py -v
```

Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add dao_asset.py tests/test_dao_asset.py
git commit -m "feat: add AssetDAO with full CRUD and filtering (TDD)"
```

---

## Task 5: Backend DAO - Storyboard Items [TDD]

**Files:**
- Create: `dao_storyboard.py`
- Test: `tests/test_dao_storyboard.py`

- [ ] **Step 1: Write failing tests** (`tests/test_dao_storyboard.py`)

```python
# -*- coding: utf-8 -*-
import pytest


async def test_create_storyboard_item(test_db):
    from dao_storyboard import StoryboardDAO
    result = await StoryboardDAO.create(
        episode_id="ep_test1", sort_order=1,
        dialogue="你好世界", image_prompt="一个少年站在阳光下"
    )
    assert result is not None
    assert result["item_id"].startswith("sb_")
    assert result["dialogue"] == "你好世界"
    assert result["audio_duration_ms"] is None


async def test_get_items_by_episode_sorted(test_db):
    from dao_storyboard import StoryboardDAO
    await StoryboardDAO.create(episode_id="ep_1", sort_order=2, dialogue="第二")
    await StoryboardDAO.create(episode_id="ep_1", sort_order=1, dialogue="第一")
    items = await StoryboardDAO.get_by_episode("ep_1")
    assert len(items) >= 2
    assert items[0]["sort_order"] <= items[1]["sort_order"]


async def test_update_audio_duration_writes_back(test_db):
    from dao_storyboard import StoryboardDAO
    created = await StoryboardDAO.create(
        episode_id="ep_1", sort_order=1, dialogue="测试"
    )
    updated = await StoryboardDAO.update(
        created["item_id"], audio_duration_ms=3200
    )
    assert updated["audio_duration_ms"] == 3200


async def test_reorder_items(test_db):
    from dao_storyboard import StoryboardDAO
    a = await StoryboardDAO.create(episode_id="ep_1", sort_order=1, dialogue="A")
    b = await StoryboardDAO.create(episode_id="ep_1", sort_order=2, dialogue="B")
    await StoryboardDAO.reorder("ep_1", [b["item_id"], a["item_id"]])
    items = await StoryboardDAO.get_by_episode("ep_1")
    ids_ordered = [i["item_id"] for i in items]
    assert ids_ordered.index(b["item_id"]) < ids_ordered.index(a["item_id"])


async def test_delete_item(test_db):
    from dao_storyboard import StoryboardDAO
    created = await StoryboardDAO.create(
        episode_id="ep_1", sort_order=1, dialogue="删除我"
    )
    await StoryboardDAO.delete(created["item_id"])
    result = await StoryboardDAO.get_by_id(created["item_id"])
    assert result is None
```

- [ ] **Step 2: Run tests - RED**

```bash
python -m pytest tests/test_dao_storyboard.py -v
```

- [ ] **Step 3: Implement `dao_storyboard.py`**

Follow `dao_asset.py` pattern. ID prefix: `sb_`. Key fields: `episode_id`, `sort_order`, `dialogue`, `image_prompt`, `video_prompt`, `dialogue_audio_url`, `narration_audio_url`, `sfx_audio_url`, `audio_duration_ms`. The `update` method accepts all fields as optional kwargs with dynamic SET building. The `reorder` method loops over the ID list and sets `sort_order` for each.

- [ ] **Step 4: Run tests - GREEN**

```bash
python -m pytest tests/test_dao_storyboard.py -v
```

- [ ] **Step 5: Commit**

```bash
git add dao_storyboard.py tests/test_dao_storyboard.py
git commit -m "feat: add StoryboardDAO with CRUD, reorder, audio fields (TDD)"
```

---

## Task 6: Backend DAO - Remaining 4 DAOs [TDD]

**Files:**
- Create: `dao_episode_script.py`, `dao_video_segment.py`, `dao_timeline.py`, `dao_audio_track.py`
- Test: `tests/test_dao_episode_script.py`, `tests/test_dao_video_segment.py`, `tests/test_dao_timeline.py`, `tests/test_dao_audio_track.py`

Each DAO follows the exact same pattern as `dao_asset.py`. One RED-GREEN cycle per DAO.

- [ ] **Step 1: Write all 4 test files (RED)**

`test_dao_episode_script.py`: 3 tests (create, get_by_episode, update)
`test_dao_video_segment.py`: 4 tests (create, get_by_episode, update_status, delete)
`test_dao_timeline.py`: 3 tests (create, get_by_episode, update_items)
`test_dao_audio_track.py`: 4 tests (create_bgm, get_by_episode, update_range, delete)

Key patterns:
- `EpisodeScriptDAO`: ID prefix `script_`, fields `episode_id (UNIQUE)`, `original_content`, `adapted_script`, `metadata` JSONB. Use UPSERT for `save_or_update`.
- `VideoSegmentDAO`: ID prefix `seg_`, FK to `storyboard_item_id`, fields `generation_mode`, `model`, `input_params` JSONB, `video_url`, `duration_ms`, `task_id`, `status`.
- `TimelineDAO`: ID prefix `track_`, fields `track_type`, `track_name`, `sort_order`, `items` JSONB.
- `AudioTrackDAO`: ID prefix `atrk_`, fields `track_type`, `name`, `audio_url`, `duration_ms`, `start_item_id`, `end_item_id`, `generation_params` JSONB.

- [ ] **Step 2: Run all 4 test files - RED**

```bash
python -m pytest tests/test_dao_episode_script.py tests/test_dao_video_segment.py tests/test_dao_timeline.py tests/test_dao_audio_track.py -v
```

- [ ] **Step 3: Implement all 4 DAOs**

- [ ] **Step 4: Run tests - GREEN**

```bash
python -m pytest tests/test_dao_episode_script.py tests/test_dao_video_segment.py tests/test_dao_timeline.py tests/test_dao_audio_track.py -v
```

- [ ] **Step 5: Commit**

```bash
git add dao_episode_script.py dao_video_segment.py dao_timeline.py dao_audio_track.py tests/test_dao_*.py
git commit -m "feat: add 4 DAOs (episode_script, video_segment, timeline, audio_track) with TDD"
```

---

## Task 7: Backend API Endpoints [TDD]

**Files:**
- Modify: `api_routes.py` (add ~7 API groups)
- Test: `tests/test_api_assets.py`, `tests/test_api_storyboard.py`

- [ ] **Step 1: Write API tests (RED)**

`tests/test_api_assets.py`:

```python
# -*- coding: utf-8 -*-
import pytest


async def test_create_asset_api(client, auth_headers):
    resp = await client.post("/api/assets", json={
        "project_id": "proj_1", "asset_type": "character",
        "name": "主角", "description": "黑发少年"
    }, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["asset"]["name"] == "主角"


async def test_list_assets_api(client, auth_headers):
    resp = await client.get("/api/projects/proj_1/assets", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json()["assets"], list)


async def test_update_asset_api(client, auth_headers):
    create = await client.post("/api/assets", json={
        "project_id": "proj_1", "asset_type": "prop", "name": "旧名"
    }, headers=auth_headers)
    aid = create.json()["asset"]["asset_id"]
    resp = await client.put(f"/api/assets/{aid}", json={"name": "新名"}, headers=auth_headers)
    assert resp.json()["asset"]["name"] == "新名"


async def test_delete_asset_api(client, auth_headers):
    create = await client.post("/api/assets", json={
        "project_id": "proj_1", "asset_type": "prop", "name": "临时"
    }, headers=auth_headers)
    aid = create.json()["asset"]["asset_id"]
    resp = await client.delete(f"/api/assets/{aid}", headers=auth_headers)
    assert resp.json()["success"] is True
```

`tests/test_api_storyboard.py`: Similar pattern for storyboard CRUD.

- [ ] **Step 2: Run tests - RED**

```bash
python -m pytest tests/test_api_assets.py tests/test_api_storyboard.py -v
```

- [ ] **Step 3: Add API endpoints to `api_routes.py`**

Add Pydantic models and route handlers. Follow existing pattern:

```python
# In api_routes.py, add these imports at top:
from dao_asset import AssetDAO
from dao_storyboard import StoryboardDAO
from dao_video_segment import VideoSegmentDAO
from dao_timeline import TimelineDAO
from dao_episode_script import EpisodeScriptDAO
from dao_audio_track import AudioTrackDAO

# Pydantic models
class AssetCreate(BaseModel):
    project_id: str
    asset_type: str
    name: str
    episode_id: Optional[str] = None
    description: str = ''

class AssetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None

# Routes
@router.post("/api/assets")
async def create_asset(data: AssetCreate, user_id: str = Depends(get_current_user)):
    asset = await AssetDAO.create(
        project_id=data.project_id, episode_id=data.episode_id,
        asset_type=data.asset_type, name=data.name,
        description=data.description, created_by=user_id
    )
    return {"success": True, "asset": asset}

@router.get("/api/projects/{project_id}/assets")
async def list_assets(project_id: str, episode_id: Optional[str] = None,
                      asset_type: Optional[str] = None,
                      user_id: str = Depends(get_current_user)):
    assets = await AssetDAO.get_by_project(project_id, episode_id=episode_id, asset_type=asset_type)
    return {"success": True, "assets": assets}

# ... PUT /api/assets/{asset_id}, DELETE /api/assets/{asset_id}
# Same pattern for storyboard, video_segment, timeline, episode_script, audio_track APIs
```

Add similar route groups for all 7 API groups (assets, storyboard-items, video-segments, timeline-tracks, episode-scripts, audio-tracks, audio generation).

- [ ] **Step 4: Run tests - GREEN**

```bash
python -m pytest tests/test_api_assets.py tests/test_api_storyboard.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api_routes.py tests/test_api_*.py
git commit -m "feat: add API endpoints for assets, storyboard, video, timeline, audio (TDD)"
```

---

## Task 8: Backend Audio Provider [TDD]

**Files:**
- Create: `audio_provider.py`
- Test: `tests/test_audio_provider.py`

- [ ] **Step 1: Write failing tests**

```python
# -*- coding: utf-8 -*-
import pytest
from unittest.mock import AsyncMock, patch


async def test_provider_interface_contract():
    from audio_provider import AudioProvider
    provider = AudioProvider()
    with pytest.raises(NotImplementedError):
        await provider.generate_speech("text", persona="narrator")


async def test_gemini_generate_speech_returns_audio():
    from audio_provider import GeminiAudioProvider
    with patch.object(GeminiAudioProvider, '_call_gemini', new_callable=AsyncMock) as mock:
        mock.return_value = {"audio_url": "/uploads/audio/test.wav", "duration_ms": 3200}
        provider = GeminiAudioProvider()
        result = await provider.generate_speech("你好世界", persona="narrator", emotion="neutral")
        assert result["audio_url"].endswith(".wav")
        assert result["duration_ms"] > 0


async def test_gemini_generate_music_returns_audio():
    from audio_provider import GeminiAudioProvider
    with patch.object(GeminiAudioProvider, '_call_gemini', new_callable=AsyncMock) as mock:
        mock.return_value = {"audio_url": "/uploads/audio/bgm.wav", "duration_ms": 30000}
        provider = GeminiAudioProvider()
        result = await provider.generate_music("紧张悬疑的背景音乐")
        assert result["audio_url"] is not None
        assert result["duration_ms"] > 0
```

- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement `audio_provider.py`** with base `AudioProvider` class and `GeminiAudioProvider` subclass
- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

```bash
git add audio_provider.py tests/test_audio_provider.py
git commit -m "feat: add AudioProvider abstraction with Gemini implementation (TDD)"
```

---

## Task 9: Frontend Types & API Service [TDD]

**Files:**
- Modify: `new_html/types.ts`
- Modify: `new_html/services/apiService.ts`
- Test: `new_html/__tests__/services/apiService.test.ts`

- [ ] **Step 1: Write failing tests** (`new_html/__tests__/services/apiService.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('getAssets', () => {
  it('calls correct URL with project and episode filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, assets: [] }),
    });
    const { getAssets } = await import('../../services/apiService');
    await getAssets('proj_1', 'ep_1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/proj_1/assets'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token'
        })
      })
    );
  });
});

describe('createAsset', () => {
  it('sends POST with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, asset: { asset_id: 'a1' } }),
    });
    const { createAsset } = await import('../../services/apiService');
    await createAsset({ project_id: 'p1', asset_type: 'character', name: '角色' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/assets');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).name).toBe('角色');
  });
});

// Add similar tests for:
// getStoryboardItems, getAudioTracks, generateSpeech, getEpisodeScript, etc.
```

- [ ] **Step 2: Run - RED**

```bash
cd new_html && npx vitest run __tests__/services/apiService.test.ts
```

- [ ] **Step 3: Add new types to `types.ts`**

Add after existing types:

```typescript
// New types for UI redesign

export interface AssetItem {
  assetId: string;
  projectId: string;
  episodeId: string | null;
  assetType: 'character' | 'scene' | 'prop';
  name: string;
  description: string;
  thumbnailUrl: string | null;
  referenceImages: string[];
  styleParams: Record<string, any>;
  tags: string[];
  createdBy: string;
  createdAt: string;
}

export interface StoryboardItemDB {
  itemId: string;
  episodeId: string;
  sortOrder: number;
  sceneHeading: string;
  actionText: string;
  dialogue: string;
  cameraMovement: string;
  imagePrompt: string;
  videoPrompt: string;
  generatedImageUrl: string | null;
  boundAssets: string[];
  status: string;
  dialogueAudioUrl: string | null;
  narrationAudioUrl: string | null;
  sfxAudioUrl: string | null;
  audioDurationMs: number | null;
}

export interface VideoSegment {
  segmentId: string;
  episodeId: string;
  storyboardItemId: string | null;
  sortOrder: number;
  generationMode: string;
  model: string;
  inputParams: Record<string, any>;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  taskId: string | null;
  status: string;
}

export interface AudioTrack {
  trackId: string;
  episodeId: string;
  trackType: 'bgm' | 'sfx_global' | 'narration_global';
  name: string;
  audioUrl: string | null;
  durationMs: number | null;
  startItemId: string | null;
  endItemId: string | null;
  generationParams: Record<string, any>;
}

export interface EpisodeScript {
  scriptId: string;
  episodeId: string;
  originalContent: string;
  adaptedScript: string;
  metadata: Record<string, any>;
}

export interface TimelineTrack {
  trackId: string;
  episodeId: string;
  trackType: 'video' | 'audio' | 'subtitle';
  trackName: string;
  sortOrder: number;
  items: any[];
}
```

Update `AppView` enum:

```typescript
export enum AppView {
  ProjectHub = 'ProjectHub',
  EpisodeHub = 'EpisodeHub',
  Editor = 'Editor',
  Design = 'Design',
  Materials = 'Materials',
  AudioStage = 'AudioStage',
  Generation = 'Generation',
  Video = 'Video',
  Enhance = 'Enhance',
  PostProcess = 'PostProcess',
  History = 'History',
  Canvas = 'Canvas',
  Admin = 'Admin'
}
```

- [ ] **Step 4: Add new API functions to `apiService.ts`**

Append new exports following existing pattern (`fetch` + `handleResponse`):

```typescript
// ===== Asset APIs =====
export async function getAssets(projectId: string, episodeId?: string, assetType?: string) {
    const params = new URLSearchParams();
    if (episodeId) params.set('episode_id', episodeId);
    if (assetType) params.set('asset_type', assetType);
    const qs = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/assets${qs}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'getAssets');
}

export async function createAsset(data: {
    project_id: string; asset_type: string; name: string;
    episode_id?: string; description?: string;
}) {
    const response = await fetch(`${API_BASE}/api/assets`, {
        method: 'POST', headers: getHeaders(), body: JSON.stringify(data)
    });
    return handleResponse(response, 'createAsset');
}

export async function updateAsset(assetId: string, data: Record<string, any>) {
    const response = await fetch(`${API_BASE}/api/assets/${assetId}`, {
        method: 'PUT', headers: getHeaders(), body: JSON.stringify(data)
    });
    return handleResponse(response, 'updateAsset');
}

export async function deleteAsset(assetId: string) {
    const response = await fetch(`${API_BASE}/api/assets/${assetId}`, {
        method: 'DELETE', headers: getHeaders()
    });
    return handleResponse(response, 'deleteAsset');
}

// ===== Storyboard APIs =====
export async function getStoryboardItems(episodeId: string) { /* GET /api/episodes/:eid/storyboard-items */ }
export async function createStoryboardItem(episodeId: string, data: any) { /* POST */ }
export async function updateStoryboardItem(itemId: string, data: any) { /* PUT /api/storyboard-items/:id */ }
export async function deleteStoryboardItem(itemId: string) { /* DELETE */ }

// ===== Video Segment APIs =====
export async function getVideoSegments(episodeId: string) { /* GET /api/episodes/:eid/video-segments */ }
export async function createVideoSegment(episodeId: string, data: any) { /* POST */ }

// ===== Audio Track APIs =====
export async function getAudioTracks(episodeId: string) { /* GET /api/episodes/:eid/audio-tracks */ }
export async function createAudioTrack(episodeId: string, data: any) { /* POST */ }
export async function deleteAudioTrack(trackId: string) { /* DELETE */ }

// ===== Audio Generation APIs =====
export async function generateSpeech(data: { text: string; persona?: string; emotion?: string }) { /* POST /api/audio/generate-speech */ }
export async function generateSFX(data: { description: string }) { /* POST /api/audio/generate-sfx */ }
export async function generateMusic(data: { description: string; duration_ms?: number }) { /* POST /api/audio/generate-music */ }

// ===== Episode Script APIs =====
export async function getEpisodeScript(episodeId: string) { /* GET /api/episodes/:eid/script */ }
export async function updateEpisodeScript(episodeId: string, data: any) { /* PUT */ }

// ===== Timeline APIs =====
export async function getTimelineTracks(episodeId: string) { /* GET /api/episodes/:eid/timeline-tracks */ }
export async function updateTimelineTrack(trackId: string, data: any) { /* PUT */ }
```

- [ ] **Step 5: Run - GREEN**
- [ ] **Step 6: Commit**

```bash
git add new_html/types.ts new_html/services/apiService.ts new_html/__tests__/services/
git commit -m "feat: add new TypeScript types and API service functions (TDD)"
```

---

## Task 10: EpisodeContext [TDD]

**Files:**
- Create: `new_html/contexts/EpisodeContext.tsx`
- Test: `new_html/__tests__/contexts/EpisodeContext.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// new_html/__tests__/contexts/EpisodeContext.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

vi.mock('../../services/apiService', () => ({
  getEpisodeScript: vi.fn().mockResolvedValue({ success: true, script: { original_content: '剧本内容' } }),
  getStoryboardItems: vi.fn().mockResolvedValue({ success: true, items: [{ item_id: 'sb1', sort_order: 1, dialogue: '你好' }] }),
  getAssets: vi.fn().mockResolvedValue({ success: true, assets: [] }),
  getAudioTracks: vi.fn().mockResolvedValue({ success: true, tracks: [] }),
  getVideoSegments: vi.fn().mockResolvedValue({ success: true, segments: [] }),
  getHeaders: vi.fn().mockReturnValue({}),
}));

// Tests for:
// 1. provides episode data after loading
// 2. shows loading state initially
// 3. exposes error when API fails
// 4. updateStoryboardDuration writes audio_duration_ms
```

- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement `EpisodeContext.tsx`**

Follow `ProjectContext.tsx` pattern: `createContext`, typed interface, `useEpisode()` hook, `EpisodeProvider` with `useParams` for `episodeId`. Load script, storyboard items, assets, audio tracks, video segments on mount. Expose CRUD helpers.

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

```bash
git add new_html/contexts/EpisodeContext.tsx new_html/__tests__/contexts/
git commit -m "feat: add EpisodeContext for episode-level data management (TDD)"
```

---

## Task 11: Routing Refactor [TDD]

**Files:**
- Modify: `new_html/App.tsx`
- Create: `new_html/layouts/WorkflowLayout.tsx`
- Modify: `new_html/components/ProjectWorkspace.tsx`
- Test: `new_html/__tests__/App.test.tsx`

- [ ] **Step 1: Write failing routing tests**

```typescript
// new_html/__tests__/App.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../test/test-utils';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('../pages/EpisodeHub', () => ({ default: () => <div data-testid="episode-hub" /> }));
vi.mock('../pages/ScriptPage', () => ({ default: () => <div data-testid="script-page" /> }));
vi.mock('../pages/AudioStage', () => ({ default: () => <div data-testid="audio-stage" /> }));
vi.mock('../pages/CanvasPage', () => ({ default: () => <div data-testid="canvas-page" /> }));
vi.mock('../pages/DesignPage', () => ({ default: () => <div data-testid="design-page" /> }));
vi.mock('../pages/VideoWorkspace', () => ({ default: () => <div data-testid="video-workspace" /> }));
vi.mock('../components/ProjectHub', () => ({ default: () => <div data-testid="project-hub" /> }));

// Mock contexts
vi.mock('../contexts/ProjectContext', () => ({
  ProjectProvider: ({ children }: any) => <div>{children}</div>,
  useProject: () => ({ project: {}, loading: false, error: null }),
}));
vi.mock('../contexts/EpisodeContext', () => ({
  EpisodeProvider: ({ children }: any) => <div>{children}</div>,
  useEpisode: () => ({ isLoading: false }),
}));

describe('App routing', () => {
  it('renders ProjectHub at /projects', () => { /* ... */ });
  it('renders EpisodeHub at /projects/:id', () => { /* ... */ });
  it('renders ScriptPage at workflow/script', () => { /* ... */ });
  it('renders AudioStage at workflow/audio', () => { /* ... */ });
  it('renders CanvasPage at canvas', () => { /* ... */ });
  it('redirects / to /projects', () => { /* ... */ });
});
```

- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Rewrite `App.tsx` with new route structure**

New route tree:

```
/projects → ProjectHub
/projects/:projectId → ProjectWorkspace > EpisodeHub (index)
/projects/:projectId/ep/:episodeId/workflow → WorkflowLayout
  /workflow/script → ScriptPage
  /workflow/design → DesignPage
  /workflow/materials → MaterialsPage
  /workflow/audio → AudioStage
  /workflow/generation → GenerationPage
  /workflow/video → VideoWorkspace
  /workflow/enhance → EnhancePage
  /workflow/history → HistoryPage
/projects/:projectId/ep/:episodeId/canvas → CanvasPage
/admin → AdminPage
```

Use `React.lazy` and `Suspense` for code splitting.

- [ ] **Step 4: Create `WorkflowLayout.tsx`**

Container with:
- `EpisodeProvider` wrapping children
- Header with workflow tabs (剧本 / 资产设计 / 素材绑定 / 音频预演 / 画面分镜 / 生成视频 / 视频美化 / 历史)
- `<Outlet />` for nested routes
- Mode switch button (to canvas)

- [ ] **Step 5: Update `ProjectWorkspace.tsx`** to render `<Outlet />` instead of `WorkspaceApp`
- [ ] **Step 6: Run - GREEN**
- [ ] **Step 7: Commit**

```bash
git add new_html/App.tsx new_html/layouts/ new_html/components/ProjectWorkspace.tsx new_html/__tests__/App.test.tsx
git commit -m "feat: refactor routing to 4-layer nested structure (TDD)"
```

---

## Task 12: Extract Pages from WorkspaceApp [TDD]

**Files:**
- Create: `new_html/pages/ScriptPage.tsx`, `MaterialsPage.tsx`, `GenerationPage.tsx`, `HistoryPage.tsx`
- Test: `new_html/__tests__/pages/ScriptPage.test.tsx` (etc.)

- [ ] **Step 1: Write minimal render tests for each page**

```typescript
// new_html/__tests__/pages/ScriptPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../../test/test-utils';
import ScriptPage from '../../pages/ScriptPage';

vi.mock('../../contexts/EpisodeContext', () => ({
  useEpisode: () => ({ script: { originalContent: '测试剧本' }, storyboardItems: [], isLoading: false }),
}));

describe('ScriptPage', () => {
  it('renders without crashing', () => {
    render(<ScriptPage />);
    expect(document.body).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Extract each page from `WorkspaceApp.tsx`**

Each page:
1. Copy the relevant view section from `WorkspaceApp.tsx` (see [`WorkspaceApp.tsx:41`](new_html/WorkspaceApp.tsx))
2. Replace state access with `useEpisode()` hook
3. Replace props with context-provided data
4. Keep component imports intact

Mapping from WorkspaceApp views:
- `Editor` view (FileColumn + ScriptColumn + StoryboardColumn) → `ScriptPage.tsx`
- `Materials` view (MaterialPage component) → `MaterialsPage.tsx`
- `Generation` view (GenerationPage component) → `GenerationPage.tsx`
- `History` view (HistoryPage component) → `HistoryPage.tsx`

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

```bash
git add new_html/pages/ScriptPage.tsx new_html/pages/MaterialsPage.tsx new_html/pages/GenerationPage.tsx new_html/pages/HistoryPage.tsx new_html/__tests__/pages/
git commit -m "feat: extract 4 pages from WorkspaceApp into standalone components (TDD)"
```

---

## Task 13: EpisodeHub Page [TDD]

**Files:**
- Create: `new_html/pages/EpisodeHub.tsx`
- Test: `new_html/__tests__/pages/EpisodeHub.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
// 6 tests: renders cards, dual mode buttons, navigation (workflow/canvas), create, delete
```

- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement `EpisodeHub.tsx`**

Reference: Card-style list. Each card shows episode name, number, status, and two buttons: "流程化制作" (navigate to `/workflow/script`) and "自由创作" (navigate to `/canvas`). Top has "新建集数" button. Uses existing `getEpisodes`, `createEpisode`, `deleteEpisode` from apiService.

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

---

## Task 14: DesignPage [TDD]

**Files:**
- Create: `new_html/pages/DesignPage.tsx`
- Create: `new_html/components/AssetLibraryPanel.tsx`
- Test: `new_html/__tests__/pages/DesignPage.test.tsx`

- [ ] **Step 1: Write tests** (5 tests: tabs, tab switch, generation form, asset library, delete)
- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement**

Reference UI: [`new_html1/components/DesignView.tsx`](new_html1/components/DesignView.tsx). Three tabs (character/scene/prop). Left sidebar: prompt textarea + model select + generate button. Right panel: `AssetLibraryPanel` showing project + episode assets. Use `createAsset`, `getAssets`, `deleteAsset` from apiService. Trigger image generation via existing ComfyUI task system.

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

---

## Task 15: AudioStage Page [TDD]

**Files:**
- Create: `new_html/pages/AudioStage.tsx`
- Create: `new_html/services/audioProvider.ts`
- Create: `new_html/services/geminiAudioProvider.ts`
- Test: `new_html/__tests__/pages/AudioStage.test.tsx`

- [ ] **Step 1: Write tests** (12 tests covering storyboard list, audio editing area, TTS generation, duration display/writeback, persona/emotion, BGM, playback, sequential play, timeline)
- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement frontend audio provider interface**

```typescript
// new_html/services/audioProvider.ts
export interface AudioProviderResult {
  audioUrl: string;
  durationMs: number;
}

export interface AudioProvider {
  generateSpeech(text: string, options: { persona?: string; emotion?: string }): Promise<AudioProviderResult>;
  generateSFX(description: string): Promise<AudioProviderResult>;
  generateMusic(description: string, durationMs?: number): Promise<AudioProviderResult>;
}
```

```typescript
// new_html/services/geminiAudioProvider.ts
import { generateSpeech, generateSFX, generateMusic } from './apiService';
import type { AudioProvider, AudioProviderResult } from './audioProvider';

export class GeminiAudioProvider implements AudioProvider {
  async generateSpeech(text: string, options: { persona?: string; emotion?: string }): Promise<AudioProviderResult> {
    const result = await generateSpeech({ text, ...options });
    return { audioUrl: result.audio_url, durationMs: result.duration_ms };
  }
  // ... generateSFX, generateMusic
}
```

- [ ] **Step 4: Implement `AudioStage.tsx`**

Reference: [`new_html2/sunborad/components/SonicStudio.tsx`](new_html2/sunborad/components/SonicStudio.tsx) for voice personas, emotions, PCM playback.

Layout:
- Left: storyboard list from `useEpisode().storyboardItems`
- Center: audio editing area (dialogue/narration/sfx/bgm sections)
- Bottom: timeline showing all storyboard audio waveforms + total duration

Core flow: Select storyboard item -> Choose persona/emotion -> Generate TTS -> Preview audio -> Confirm duration (writes `audio_duration_ms` back to storyboard item via `updateStoryboardItem`).

Reuse from SonicStudio: `VOICE_PERSONAS`, `EMOTIONS` arrays and PCM decode/playback helpers.

- [ ] **Step 5: Run - GREEN**
- [ ] **Step 6: Commit**

---

## Task 16: VideoWorkspace Page [TDD]

**Files:**
- Create: `new_html/pages/VideoWorkspace.tsx`
- Create: `new_html/components/TimelineEditor.tsx`
- Test: `new_html/__tests__/pages/VideoWorkspace.test.tsx`

- [ ] **Step 1: Write tests** (13 tests covering 3-column layout, asset panel, generation modes, task submission, audio_duration_ms usage, multi-track timeline, audio segment editing, time ruler)
- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement `TimelineEditor.tsx`** (shared component)

Multi-track timeline editor:
- Tracks: dialogue, narration, sfx, bgm, video
- Each track renders segments with waveform placeholder + duration label
- Drag to adjust duration, right-click for context menu
- Time ruler with total duration
- Shared by `VideoWorkspace` and `EnhancePage`

Reference: [`new_html1/components/EnhanceView.tsx`](new_html1/components/EnhanceView.tsx) for timeline scale/playback patterns.

- [ ] **Step 4: Implement `VideoWorkspace.tsx`**

Reference: [`new_html1/components/Workspace.tsx`](new_html1/components/Workspace.tsx).

Three columns:
- Left: Asset library panel (from `AssetLibraryPanel`) + storyboard items list
- Center: Clip editor with generation mode selector (t2i, i2v, ref2v, keyframes, multi_frame, mimic, audio2v), model select, prompt, generate button. Duration auto-populated from `storyboard_item.audio_duration_ms`.
- Right: Preview player
- Bottom: `TimelineEditor` with audio + video tracks

- [ ] **Step 5: Run - GREEN**
- [ ] **Step 6: Commit**

---

## Task 17: EnhancePage [TDD]

**Files:**
- Create: `new_html/pages/EnhancePage.tsx`
- Test: `new_html/__tests__/pages/EnhancePage.test.tsx`

- [ ] **Step 1: Write tests** (6 tests: video preview, enhancement options, toggle upscale, apply submit, timeline, audio import)
- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement**

Reference: [`new_html1/components/EnhanceView.tsx`](new_html1/components/EnhanceView.tsx).

Video preview + enhancement options (HD upscale, frame interpolation, lip sync) + `TimelineEditor` for final multi-track editing. Uses existing ComfyUI upscale/interpolation workflows.

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

---

## Task 18: Canvas Page Setup [TDD]

**Files:**
- Create: `new_html/pages/CanvasPage.tsx`
- Test: `new_html/__tests__/pages/CanvasPage.test.tsx`

- [ ] **Step 1: Install @xyflow/react**

```bash
cd new_html && npm install @xyflow/react
```

- [ ] **Step 2: Write tests** (5 tests: ReactFlow renders, agent panel, assistant panel, loads nodes, mode switch)
- [ ] **Step 3: Run - RED**
- [ ] **Step 4: Implement `CanvasPage.tsx`**

Reference: [`new_html2/Storyboard-Copilot-0.1.13/src/App.tsx`](new_html2/Storyboard-Copilot-0.1.13/src/App.tsx) for `ReactFlowProvider` + `@xyflow/react` usage. [`new_html2/sunborad/App.tsx`](new_html2/sunborad/App.tsx) for visual style.

Structure:
```
<ReactFlowProvider>
  <div className="flex h-screen">
    <AgentPanel />            {/* left sidebar */}
    <ReactFlow               {/* center canvas */}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={...}
      onEdgesChange={...}
      onConnect={...}
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
    <AssistantPanel />        {/* right sidebar, collapsed */}
  </div>
</ReactFlowProvider>
```

- [ ] **Step 5: Run - GREEN**
- [ ] **Step 6: Commit**

---

## Task 19: Canvas Nodes [TDD]

**Files:**
- Create: 6 node components in `new_html/canvas/nodes/`
- Test: `new_html/__tests__/canvas/nodes/ImageGeneratorNode.test.tsx`

- [ ] **Step 1: Write tests for ImageGeneratorNode** (4 tests: prompt input, generate button, image display, output handle)
- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement all 6 node types**

Each node is a custom @xyflow/react node with:
- Input handles (top) for receiving data from upstream nodes
- Output handles (bottom) for sending to downstream nodes
- Internal UI: prompt fields, generate buttons, preview areas

Types:
- `TextInputNode`: Textarea input, text output handle
- `ImageGeneratorNode`: Prompt + model + generate, shows generated image, output handle
- `VideoGeneratorNode`: Image input + prompt + duration, generate, video preview
- `AudioGeneratorNode`: Text/description input, TTS/SFX/music generation
- `StoryboardNode`: Multi-shot storyboard viewer with bound assets
- `VideoAnalyzerNode`: Video input, AI analysis output

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

---

## Task 20: Canvas Agent Panel [TDD]

**Files:**
- Create: `new_html/canvas/AgentPanel.tsx`, `AssistantPanel.tsx`, `CanvasToolbar.tsx`, `WorkflowTemplates.tsx`
- Test: `new_html/__tests__/canvas/AgentPanel.test.tsx`

- [ ] **Step 1: Write tests** (5 tests: node list, drag/drop, templates, template click, AI orchestrator)
- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement panels**

Reference: [`new_html2/sunborad/components/SidebarDock.tsx`](new_html2/sunborad/components/SidebarDock.tsx) for dock UI, [`AssistantPanel.tsx`](new_html2/sunborad/components/AssistantPanel.tsx) for AI chat.

`AgentPanel`: Node type list (draggable) + Workflow templates (preset node groups) + AI Orchestrator (natural language to node flow)
`AssistantPanel`: Chat interface connected to Gemini for prompt optimization
`WorkflowTemplates`: Preset combinations like "Text -> Image -> Video", "Script -> Storyboard -> Full Pipeline"

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Commit**

---

## Task 21: Data Migration & Cleanup [TDD]

**Files:**
- Create: `migrate_settings_to_tables.py`
- Test: `tests/test_migration.py`

- [ ] **Step 1: Write migration tests**

```python
# tests/test_migration.py
async def test_migrate_storyboard_from_jsonb(test_db):
    """settings.storyboard -> storyboard_items"""

async def test_migrate_script_from_jsonb(test_db):
    """settings.scriptContent -> episode_scripts"""

async def test_migrate_materials_to_assets(test_db):
    """settings.materialLibrary -> assets"""

async def test_migrate_preserves_original_data(test_db):
    """原始 JSONB 不变"""

async def test_idempotent_migration(test_db):
    """重复运行不产生重复数据"""
```

- [ ] **Step 2: Run - RED**
- [ ] **Step 3: Implement migration script**

Read `projects.settings` JSONB for each project/episode, map to new table rows, use UPSERT to be idempotent. Preserve original data.

- [ ] **Step 4: Run - GREEN**
- [ ] **Step 5: Clean up deprecated code in `WorkspaceApp.tsx`**

Remove the sections that have been extracted to standalone pages. Keep `WorkspaceApp.tsx` as a legacy fallback during transition, then delete once all routes point to new pages.

- [ ] **Step 6: Commit**

```bash
git add migrate_settings_to_tables.py tests/test_migration.py
git commit -m "feat: add data migration from JSONB to independent tables (TDD)"
```

---

## Final Verification

After all tasks are complete:

- [ ] **Run full test suite**

```bash
cd h:\MY2 && python -m pytest tests/ -v
cd h:\MY2\new_html && npx vitest run
```

Expected: ~40 backend tests + ~60 frontend tests = ~100 total, all green.

- [ ] **Run dev server and verify routes**

```bash
cd new_html && npm run dev
```

Verify: `/projects` -> `/projects/:id` (EpisodeHub) -> workflow pages -> canvas.

- [ ] **Run `gitnexus_detect_changes`** to verify scope

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: complete MY2 UI redesign - all phases implemented with TDD"
```
