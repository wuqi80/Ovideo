# UI Fixes + Media Library Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the notification bell so its dropdown always renders on top; make the storyboard combined timeline panel vertically resizable + collapsible with persisted state; add a nestable folder tree to the media library (素材库) with upload-time folder selection and drag-to-classify.

**Architecture:** Three independent work items. Items 1-2 are frontend-only (low risk, no backend). Item 3 is a full vertical slice: a new `media_library_folders` table (project-scoped, self-referencing for nesting) + a nullable `folder_id` column on `media_library_items`, exposed via folder CRUD endpoints and threaded through the existing list/upload/patch flows, then surfaced as a folder-tree sidebar in `MediaLibraryPage`.

**Tech Stack:** React 18 + TypeScript (`new_html/`), FastAPI + asyncpg (`*_routes.py`, `dao_*.py`, `media_library_service.py`), PostgreSQL (`db_migration_*.sql`), Vitest (FE unit), Pytest (BE unit). Deploy mirror via `python scripts/sync_to_deploy.py --apply`.

**Important environment note:** The database is remote and unreachable from this workspace (`psql` not on PATH). All SQL migrations and Pytest suites in this plan must be run by the user on the server. Backend code is written and committed locally; verification of backend tasks happens server-side. Frontend tasks (tsc, vitest, vite build) run locally.

**Project discipline (project-memory):** Each commit runs `python scripts/sync_to_deploy.py --apply` BEFORE `git commit` (a pre-commit hook blocks mirror drift), then after backend/DB/API/page changes run `python scripts/scan_project.py H:/MY2` and `python scripts/sync_check.py H:/MY2 --strict --levels ERROR` (must exit 0).

---

## File Structure

**Item 1 — Notification bell (FE only)**
- Modify: `new_html/components/NotificationPanel.tsx` — portal the dropdown to `document.body`, `fixed` positioning at `z-[9000]`.
- Mirror: `deploy/new_html/components/NotificationPanel.tsx`.

**Item 2 — Storyboard timeline (FE only)**
- Modify: `new_html/pages/StoryboardGenPage.tsx` — persisted `{collapsed, heightPx}` + vertical drag handle + scrollable body.
- Mirror: `deploy/new_html/pages/StoryboardGenPage.tsx`.

**Item 3 — Media library folders (vertical slice)**
- Create: `db_migration_media_library_folders.sql` — `media_library_folders` table + `media_library_items.folder_id` column.
- Create: `dao_media_library_folder.py` — folder CRUD DAO (with optional `conn=` for tests).
- Create: `tests/test_dao_media_library_folder.py` — DAO unit tests (run on server).
- Modify: `dao_media_library.py` — `folder_id` in `create`, list filter, update allowed-set.
- Modify: `media_library_service.py` — thread `folder_id` through `create_from_file` + `list_items`.
- Modify: `media_library_routes.py` — folder CRUD routes; `folder_id` on `GET /items`, `POST /upload`, `PATCH /items/{id}`.
- Modify: `new_html/services/mediaLibraryService.ts` — `MediaFolder` type, folder CRUD client fns, `folder_id` params.
- Create: `new_html/utils/mediaFolderTree.ts` — pure `buildFolderTree` helper.
- Create: `new_html/__tests__/utils/mediaFolderTree.test.ts` — vitest unit tests.
- Modify: `new_html/pages/MediaLibraryPage.tsx` — folder-tree sidebar, folder filter, upload folder picker, drag-to-folder.
- Modify docs: `docs/database.md`, `docs/api.md`, `docs/frontend.md`, `docs/faq.md`, `docs/vertical-slices.md`.
- Mirror all of the above to `deploy/` via `sync_to_deploy.py`.

---

## Item 1 — Notification bell always on top

### Task 1: Portal the NotificationPanel dropdown to document.body

**Why:** [new_html/components/NotificationPanel.tsx](new_html/components/NotificationPanel.tsx) renders the dropdown as `absolute ... z-[60]` inline under the bell's `relative` wrapper (line 204, 241). On workflow pages the nav has no z-index and the dropdown overlaps the sibling `<main className="flex-1 overflow-auto">`, which paints over it; it also loses to all `fixed` overlays (`z-[100]`-`z-[200]` modals, `z-[9999]` toasts). Rendering it via a portal with `fixed` positioning at `z-[9000]` removes it from every page stacking context.

**Files:**
- Modify: `new_html/components/NotificationPanel.tsx`

- [ ] **Step 1: Add the `react-dom` import**

In `new_html/components/NotificationPanel.tsx`, change the React import line (line 10) to also import `react-dom`. After line 10:

```tsx
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
```

- [ ] **Step 2: Add menu-position state**

Inside the component, next to the existing refs (after line 145 `const triggerRef = useRef<HTMLButtonElement | null>(null);`), add:

```tsx
    const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
```

- [ ] **Step 3: Compute position when opening (replace `handleToggle`)**

Replace the existing `handleToggle` (lines 186-192):

```tsx
    const handleToggle = useCallback(() => {
        setOpen(prev => {
            const next = !prev;
            if (next && unreadCount > 0) markAllRead();
            return next;
        });
    }, [unreadCount, markAllRead]);
```

with:

```tsx
    const computeMenuPos = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setMenuPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    }, []);

    const handleToggle = useCallback(() => {
        setOpen(prev => {
            const next = !prev;
            if (next) {
                computeMenuPos();
                if (unreadCount > 0) markAllRead();
            }
            return next;
        });
    }, [unreadCount, markAllRead, computeMenuPos]);
```

- [ ] **Step 4: Reposition / keep aligned on scroll + resize while open**

Add this effect right after the Esc-close effect (after line 184):

```tsx
    // ── 跟随滚动 / 窗口尺寸变化重新定位（portal 是 fixed，需手动跟随 trigger）──
    useEffect(() => {
        if (!open) return;
        const update = () => computeMenuPos();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open, computeMenuPos]);
```

- [ ] **Step 5: Render the dropdown through a portal with fixed positioning**

Replace the dropdown block (lines 235-310, the `{open && ( ... )}` JSX that renders `role="dialog"`). The wrapper changes from `absolute right-0 top-full mt-2 ... z-[60]` to `fixed ... z-[9000]` with computed `top`/`right`, and is wrapped in `ReactDOM.createPortal(..., document.body)`. The inner Header / Body / Footer markup is UNCHANGED — only the outer `{open && (` opener and the container `<div>`'s `className`/`style` change, plus the closing `)}` becomes `, document.body)}`.

Change the opener line:

```tsx
            {/* 下拉面板 */}
            {open && (
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label="任务通知面板"
                    className="absolute right-0 top-full mt-2 w-[400px] max-h-[70vh] overflow-hidden bg-slate-950 border border-slate-800 rounded-lg shadow-2xl shadow-black/40 z-[60] flex flex-col"
                    style={{ animationName: 'panelFadeIn', animationDuration: '160ms', animationTimingFunction: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}
                >
```

to:

```tsx
            {/* 下拉面板（portal 到 body，避免被页面 main/overlay 盖住）*/}
            {open && menuPos && ReactDOM.createPortal(
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label="任务通知面板"
                    className="fixed w-[400px] max-h-[70vh] overflow-hidden bg-slate-950 border border-slate-800 rounded-lg shadow-2xl shadow-black/40 z-[9000] flex flex-col"
                    style={{ top: menuPos.top, right: menuPos.right, animationName: 'panelFadeIn', animationDuration: '160ms', animationTimingFunction: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}
                >
```

Then change the dropdown's closing `)}` (currently line 310, right before line 311 `</div>` that closes the `relative` wrapper) from:

```tsx
                </div>
            )}
        </div>
    );
```

to:

```tsx
                </div>,
                document.body,
            )}
        </div>
    );
```

Note: the existing outside-click handler (lines 167-176) checks `panelRef.current?.contains(...)` and `triggerRef.current?.contains(...)`; both refs point to real DOM nodes (the portal node lives in `document.body`), so click-away and Esc continue to work.

- [ ] **Step 6: Type-check**

Run: `cd new_html && npx tsc --noEmit`
Expected: no NEW errors from `NotificationPanel.tsx` (pre-existing errors elsewhere are unchanged).

- [ ] **Step 7: Build**

Run: `cd new_html && npx vite build`
Expected: build succeeds.

- [ ] **Step 8: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add new_html/components/NotificationPanel.tsx deploy/new_html/components/NotificationPanel.tsx
git commit -m "fix(notifications): portal task bell dropdown to body so it renders above page content and overlays"
```

---

## Item 2 — Storyboard combined timeline: resizable + collapsible

### Task 2: Persist collapse + add vertical resize to the timeline footer

**Why:** The "图 + 音联合时间轴" footer in [new_html/pages/StoryboardGenPage.tsx](new_html/pages/StoryboardGenPage.tsx) (lines 335-355) has only an ephemeral `useState` collapse (line 272) and content-driven height (no scroll). Users want to drag it taller/shorter to see content fully, collapse it, and have that persist. We reuse `usePersistedPageState` ([new_html/hooks/usePersistedPageState.ts](new_html/hooks/usePersistedPageState.ts)) and mirror the drag pattern from [new_html/components/GenerationPage.tsx](new_html/components/GenerationPage.tsx) (lines 377-414), but vertical.

**Files:**
- Modify: `new_html/pages/StoryboardGenPage.tsx`

- [ ] **Step 1: Add imports**

In `new_html/pages/StoryboardGenPage.tsx`, extend the lucide import (line 14) to include `GripHorizontal`, and add the hook import after line 16:

```tsx
import { LayoutGrid, Loader, ChevronDown, ChevronRight, GripHorizontal } from 'lucide-react';
import { TimelineTrack, type TimelineClip } from '../components/TimelineTrack';
import type { StoryboardItem, FileVersion, GeneratedImage } from '../types';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
```

- [ ] **Step 2: Replace ephemeral collapse state with persisted panel state**

Replace lines 271-272:

```tsx
  const showTimeline = timelineClips.length > 0;
  const [timelineCollapsed, setTimelineCollapsed] = React.useState(false);
```

with:

```tsx
  const showTimeline = timelineClips.length > 0;
  const [timelinePanel, setTimelinePanel] = usePersistedPageState<{ collapsed: boolean; heightPx: number }>({
    page: 'StoryboardGenPage:timelinePanel',
    episodeId: 'global', // 面板尺寸是全局视觉偏好，不按剧集隔离
    version: 1,
    defaultValue: { collapsed: false, heightPx: 260 },
  });
  const timelineCollapsed = timelinePanel.collapsed;
  const setTimelineCollapsed = useCallback(
    (updater: boolean | ((c: boolean) => boolean)) =>
      setTimelinePanel(p => ({
        ...p,
        collapsed: typeof updater === 'function' ? (updater as (c: boolean) => boolean)(p.collapsed) : updater,
      })),
    [setTimelinePanel],
  );
  const [isTimelineResizing, setIsTimelineResizing] = React.useState(false);

  const startTimelineResize = useCallback(() => {
    setIsTimelineResizing(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isTimelineResizing) return;
    const onMove = (e: MouseEvent) => {
      // 时间轴贴在底部：面板高度 = 视口底部 - 鼠标 Y，clamp 到 [140, 70vh]
      const raw = Math.round(window.innerHeight - e.clientY);
      const clamped = Math.max(140, Math.min(raw, Math.round(window.innerHeight * 0.7)));
      setTimelinePanel(p => ({ ...p, heightPx: clamped }));
    };
    const onUp = () => {
      setIsTimelineResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isTimelineResizing, setTimelinePanel]);
```

(`useCallback` and `useEffect` are already imported on line 1.)

- [ ] **Step 3: Add the drag handle + scrollable fixed-height body in the footer**

Replace the footer block (lines 335-355):

```tsx
      {showTimeline && (
        <div className="shrink-0 border-t border-gray-800 bg-gray-950">
          <div
            className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-900/50 transition-colors"
            onClick={() => setTimelineCollapsed(c => !c)}
          >
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              {timelineCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              图 + 音联合时间轴
            </h4>
            <span className="text-[10px] text-gray-600">
              {fmtTimeSimple(timelineTotalMs)} | {timelineClips.filter(c => c.track === 'image').length} 个镜头
            </span>
          </div>
          {!timelineCollapsed && (
            <div className="px-4 pb-4">
              <TimelineTrack mode="combined" clips={timelineClips} totalDurationMs={timelineTotalMs} showPreview />
            </div>
          )}
        </div>
      )}
```

with:

```tsx
      {showTimeline && (
        <div className="shrink-0 border-t border-gray-800 bg-gray-950 relative">
          {/* 拖拽手柄：仅展开时可调高度 */}
          {!timelineCollapsed && (
            <div
              onMouseDown={startTimelineResize}
              className="absolute -top-1.5 left-0 right-0 h-3 flex items-center justify-center cursor-row-resize group z-10"
              title="拖动调整时间轴高度"
            >
              <div className="w-12 h-1 rounded-full bg-gray-700 group-hover:bg-indigo-500 transition-colors flex items-center justify-center">
                <GripHorizontal className="w-3 h-3 text-gray-500 opacity-0 group-hover:opacity-100" />
              </div>
            </div>
          )}
          <div
            className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-900/50 transition-colors"
            onClick={() => setTimelineCollapsed(c => !c)}
          >
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              {timelineCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              图 + 音联合时间轴
            </h4>
            <span className="text-[10px] text-gray-600">
              {fmtTimeSimple(timelineTotalMs)} | {timelineClips.filter(c => c.track === 'image').length} 个镜头
            </span>
          </div>
          {!timelineCollapsed && (
            <div className="px-4 pb-4 overflow-y-auto" style={{ height: timelinePanel.heightPx }}>
              <TimelineTrack mode="combined" clips={timelineClips} totalDurationMs={timelineTotalMs} showPreview />
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Type-check + build**

Run: `cd new_html && npx tsc --noEmit && npx vite build`
Expected: no new errors; build succeeds.

- [ ] **Step 5: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add new_html/pages/StoryboardGenPage.tsx deploy/new_html/pages/StoryboardGenPage.tsx
git commit -m "feat(storyboard): make 图+音联合时间轴 vertically resizable + collapsible with persisted state"
```

---

## Item 3 — Media library folders (素材库 / MediaLibraryPage)

### Task 3: DB migration — `media_library_folders` table + `folder_id` column

**Files:**
- Create: `db_migration_media_library_folders.sql`

- [ ] **Step 1: Write the migration**

Create `db_migration_media_library_folders.sql`:

```sql
-- ============================================
-- 2026-05-30 素材库文件夹（可嵌套，项目级）
-- media_library_folders: 用户自定义文件夹（人物 / 场景 / 道具 等），支持父子嵌套
-- media_library_items.folder_id: 素材所属文件夹（可空 = 未归类）
-- 删除文件夹 -> 子文件夹级联删除；素材的 folder_id 置 NULL（不删素材）
-- ============================================

CREATE TABLE IF NOT EXISTS media_library_folders (
    id SERIAL PRIMARY KEY,
    folder_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    parent_folder_id VARCHAR(50) REFERENCES media_library_folders(folder_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    folder_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mlf_project ON media_library_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_mlf_parent  ON media_library_folders(parent_folder_id);

CREATE OR REPLACE FUNCTION update_media_library_folders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_library_folders_updated_at ON media_library_folders;
CREATE TRIGGER trg_media_library_folders_updated_at
    BEFORE UPDATE ON media_library_folders
    FOR EACH ROW
    EXECUTE FUNCTION update_media_library_folders_updated_at();

-- 在 media_library_items 上加 folder_id（可空，删除文件夹时置 NULL）
ALTER TABLE media_library_items
    ADD COLUMN IF NOT EXISTS folder_id VARCHAR(50)
    REFERENCES media_library_folders(folder_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_library_folder ON media_library_items(folder_id);
```

- [ ] **Step 2: Mirror + commit (migration is run on server later — see Task 11)**

```bash
python scripts/sync_to_deploy.py --apply
git add db_migration_media_library_folders.sql deploy/db_migration_media_library_folders.sql
git commit -m "feat(media-library): add media_library_folders table + folder_id column migration"
```

---

### Task 4: `MediaLibraryFolderDAO` + unit tests

**Files:**
- Create: `dao_media_library_folder.py`
- Create: `tests/test_dao_media_library_folder.py`

- [ ] **Step 1: Write the failing test (run on server)**

Create `tests/test_dao_media_library_folder.py`. Mirrors the seeding pattern from [tests/test_dao_episode_script_segment.py](tests/test_dao_episode_script_segment.py) and the `test_db` transaction fixture in [tests/conftest.py](tests/conftest.py):

```python
# -*- coding: utf-8 -*-
"""素材库文件夹 DAO 测试"""
import pytest


async def _make_project(conn):
    await conn.execute(
        "INSERT INTO users (user_id, username, password_hash) VALUES ($1,$2,$3) "
        "ON CONFLICT (user_id) DO NOTHING",
        "user_mlf_test", "mlf_tester", "x",
    )
    await conn.execute(
        "INSERT INTO projects (project_id, user_id, project_name) VALUES ($1,$2,$3) "
        "ON CONFLICT (project_id) DO NOTHING",
        "proj_mlf_test", "user_mlf_test", "测试项目",
    )
    return "proj_mlf_test"


async def test_create_and_list(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    root = await MediaLibraryFolderDAO.create(project_id, "人物", conn=test_db)
    assert root["folder_id"].startswith("mlf_")
    child = await MediaLibraryFolderDAO.create(project_id, "主角", parent_folder_id=root["folder_id"], conn=test_db)
    rows = await MediaLibraryFolderDAO.list_by_project(project_id, conn=test_db)
    assert {r["name"] for r in rows} == {"人物", "主角"}
    assert next(r for r in rows if r["name"] == "主角")["parent_folder_id"] == root["folder_id"]


async def test_rename_and_move(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    a = await MediaLibraryFolderDAO.create(project_id, "场景", conn=test_db)
    b = await MediaLibraryFolderDAO.create(project_id, "道具", conn=test_db)
    updated = await MediaLibraryFolderDAO.update(a["folder_id"], {"name": "场景库", "parent_folder_id": b["folder_id"]}, conn=test_db)
    assert updated["name"] == "场景库"
    assert updated["parent_folder_id"] == b["folder_id"]


async def test_cycle_guard(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    a = await MediaLibraryFolderDAO.create(project_id, "A", conn=test_db)
    b = await MediaLibraryFolderDAO.create(project_id, "B", parent_folder_id=a["folder_id"], conn=test_db)
    # 把 A 的父设成它的子 B 会成环 -> True
    assert await MediaLibraryFolderDAO.would_create_cycle(a["folder_id"], b["folder_id"], conn=test_db) is True
    # 自己当自己父 -> True
    assert await MediaLibraryFolderDAO.would_create_cycle(a["folder_id"], a["folder_id"], conn=test_db) is True
    # 合法移动 -> False
    assert await MediaLibraryFolderDAO.would_create_cycle(b["folder_id"], None, conn=test_db) is False


async def test_delete_sets_item_folder_null(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    f = await MediaLibraryFolderDAO.create(project_id, "临时", conn=test_db)
    # 建一个 file + media item 挂到该文件夹
    await test_db.execute(
        "INSERT INTO files (file_id, user_id, file_type, file_name) VALUES ($1,$2,$3,$4) "
        "ON CONFLICT (file_id) DO NOTHING",
        "file_mlf_test", "user_mlf_test", "image", "x.png",
    )
    await test_db.execute(
        "INSERT INTO media_library_items (library_item_id, file_id, user_id, project_id, item_type, source, folder_id) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        "mli_mlf_test", "file_mlf_test", "user_mlf_test", project_id, "image", "upload", f["folder_id"],
    )
    await MediaLibraryFolderDAO.delete(f["folder_id"], conn=test_db)
    folder_id = await test_db.fetchval(
        "SELECT folder_id FROM media_library_items WHERE library_item_id = $1", "mli_mlf_test",
    )
    assert folder_id is None
```

- [ ] **Step 2: Run test to confirm it fails (server)**

Run on server: `python -m pytest tests/test_dao_media_library_folder.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'dao_media_library_folder'`.

- [ ] **Step 3: Write the DAO**

Create `dao_media_library_folder.py` (follows the optional-`conn` pattern from [dao_episode_script_segment.py](dao_episode_script_segment.py)):

```python
# -*- coding: utf-8 -*-
"""
Media Library Folder DAO -- media_library_folders 表
项目级、可嵌套的素材文件夹（人物 / 场景 / 道具 等用户自定义分类）。
media_library_items.folder_id 引用本表；删除文件夹时子文件夹级联删除，
素材的 folder_id 由数据库 ON DELETE SET NULL 自动置空。
"""
import uuid
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


def _folder_id() -> str:
    return f"mlf_{uuid.uuid4().hex[:12]}"


class MediaLibraryFolderDAO:

    @staticmethod
    async def list_by_project(project_id: str, conn=None) -> List[Dict[str, Any]]:
        sql = (
            "SELECT * FROM media_library_folders WHERE project_id = $1 "
            "ORDER BY folder_order ASC, created_at ASC"
        )
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return []
        rows = await executor.fetch(sql, project_id)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    async def get(folder_id: str, conn=None) -> Optional[Dict[str, Any]]:
        sql = "SELECT * FROM media_library_folders WHERE folder_id = $1"
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return None
        row = await executor.fetchrow(sql, folder_id)
        return dict(row) if row else None

    @staticmethod
    async def create(
        project_id: str, name: str,
        parent_folder_id: Optional[str] = None, folder_order: int = 0, conn=None,
    ) -> Dict[str, Any]:
        fid = _folder_id()
        sql = (
            "INSERT INTO media_library_folders "
            "(folder_id, project_id, parent_folder_id, name, folder_order) "
            "VALUES ($1,$2,$3,$4,$5) RETURNING *"
        )
        executor = conn if conn is not None else get_db_manager()
        row = await executor.fetchrow(sql, fid, project_id, parent_folder_id, name, int(folder_order))
        return dict(row)

    @staticmethod
    async def update(folder_id: str, fields: Dict[str, Any], conn=None) -> Optional[Dict[str, Any]]:
        allowed = {"name", "parent_folder_id", "folder_order"}
        sets: List[str] = []
        params: List[Any] = []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        if not sets:
            return await MediaLibraryFolderDAO.get(folder_id, conn=conn)
        params.append(folder_id)
        sql = f"UPDATE media_library_folders SET {', '.join(sets)} WHERE folder_id = ${idx} RETURNING *"
        executor = conn if conn is not None else get_db_manager()
        row = await executor.fetchrow(sql, *params)
        return dict(row) if row else None

    @staticmethod
    async def delete(folder_id: str, conn=None) -> bool:
        sql = "DELETE FROM media_library_folders WHERE folder_id = $1"
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return False
        result = await executor.execute(sql, folder_id)
        try:
            return int(result.split()[-1]) > 0
        except Exception:
            return False

    @staticmethod
    async def would_create_cycle(folder_id: str, new_parent_id: Optional[str], conn=None) -> bool:
        """把 folder_id 的父设为 new_parent_id 是否会成环（new_parent 是 folder_id 自身或其后代）。"""
        if not new_parent_id:
            return False
        if new_parent_id == folder_id:
            return True
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return False
        current: Optional[str] = new_parent_id
        seen = set()
        while current and current not in seen:
            seen.add(current)
            if current == folder_id:
                return True
            row = await executor.fetchrow(
                "SELECT parent_folder_id FROM media_library_folders WHERE folder_id = $1", current,
            )
            if not row:
                break
            current = row["parent_folder_id"]
        return False
```

- [ ] **Step 4: Run test to confirm it passes (server)**

Run on server: `python -m pytest tests/test_dao_media_library_folder.py -v`
Expected: 4 passed.

- [ ] **Step 5: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add dao_media_library_folder.py tests/test_dao_media_library_folder.py deploy/dao_media_library_folder.py deploy/tests/test_dao_media_library_folder.py
git commit -m "feat(media-library): add MediaLibraryFolderDAO with nesting + cycle guard + tests"
```

---

### Task 5: Thread `folder_id` through `MediaLibraryDAO`

**Files:**
- Modify: `dao_media_library.py`

- [ ] **Step 1: Add `folder_id` to `create`**

In [dao_media_library.py](dao_media_library.py), add a `folder_id` parameter to `MediaLibraryDAO.create`. Change the signature (after line 70 `library_item_id: Optional[str] = None,`):

```python
        library_item_id: Optional[str] = None,
        visibility: str = "private",
        folder_id: Optional[str] = None,
    ) -> Dict[str, Any]:
```

Update the INSERT (lines 84-99) to include `folder_id` as a new column/param `$18`:

```python
        row = await db.fetchrow(
            """
            INSERT INTO media_library_items (
                library_item_id, file_id, user_id, project_id, episode_id, team_id,
                item_type, source, title, description, tags, permission_scope,
                source_task_id, source_entity_type, source_entity_id, metadata, visibility,
                folder_id
            ) VALUES (
                $1,$2,$3,$4,$5,$6,
                $7,$8,$9,$10,$11::jsonb,$12,
                $13,$14,$15,$16::jsonb,$17,
                $18
            )
            RETURNING *
            """,
            lid, file_id, user_id, project_id, episode_id, team_id,
            item_type, source, title, description, json.dumps(tags or []), permission_scope,
            source_task_id, source_entity_type, source_entity_id, json.dumps(metadata or {}),
            visibility,
            folder_id,
        )
```

- [ ] **Step 2: Add `folder_id` filter to `list_for_user`**

In `list_for_user`, add the parameter (after line 145 `org_id: Optional[str] = None,`):

```python
        org_id: Optional[str] = None,
        folder_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
```

Then add the filter clause after the `tag` filter block (after line 223, before `params.extend([limit, offset])`):

```python
        if folder_id == 'none':
            where.append("ml.folder_id IS NULL")
        elif folder_id:
            where.append(f"ml.folder_id = ${idx}")
            params.append(folder_id)
            idx += 1
```

(The SELECT already returns `ml.*`, so `folder_id` flows to the response automatically once the column exists.)

- [ ] **Step 3: Add `folder_id` to the `update` allowed-set**

In `MediaLibraryDAO.update`, extend `allowed` (lines 355-359):

```python
        allowed = {
            'title', 'description', 'permission_scope', 'is_favorite',
            'tags', 'metadata', 'source_entity_type', 'source_entity_id',
            'project_id', 'episode_id', 'team_id', 'folder_id',
        }
```

- [ ] **Step 4: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add dao_media_library.py deploy/dao_media_library.py
git commit -m "feat(media-library): persist + filter + update folder_id on media items"
```

---

### Task 6: Thread `folder_id` through `media_library_service`

**Files:**
- Modify: `media_library_service.py`

- [ ] **Step 1: `create_from_file` accepts + forwards `folder_id`**

In [media_library_service.py](media_library_service.py), add the parameter to `create_from_file` (after line 74 `visibility: str = "private",`):

```python
    visibility: str = "private",
    folder_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
```

Then pass it into the `MediaLibraryDAO.create(...)` call (after line 120 `visibility=visibility,`):

```python
            visibility=visibility,
            folder_id=folder_id,
        )
```

- [ ] **Step 2: `list_items` accepts + forwards `folder_id`**

Add the parameter to `list_items` (after line 150 `org_id: Optional[str] = None,`):

```python
    org_id: Optional[str] = None,
    folder_id: Optional[str] = None,
) -> Dict[str, Any]:
```

Pass it into `MediaLibraryDAO.list_for_user(...)` (after line 169 `org_id=org_id,`):

```python
        org_id=org_id,
        folder_id=folder_id,
    )
```

- [ ] **Step 3: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add media_library_service.py deploy/media_library_service.py
git commit -m "feat(media-library): thread folder_id through service create + list"
```

---

### Task 7: Folder CRUD routes + `folder_id` on list/upload/patch

**Files:**
- Modify: `media_library_routes.py`

- [ ] **Step 1: Import the folder DAO + add request models**

In [media_library_routes.py](media_library_routes.py), add the import after line 27 (`from dao_media_library import MediaLibraryDAO`):

```python
from dao_media_library import MediaLibraryDAO
from dao_media_library_folder import MediaLibraryFolderDAO
```

Add `folder_id` to `MediaItemUpdateRequest` (after line 46 `episode_id: Optional[str] = None`):

```python
    episode_id: Optional[str] = None
    folder_id: Optional[str] = None  # 移动到文件夹（None 不动；空串 '' 视为未归类由前端转 null）
```

Add new models after `BatchDownloadRequest` (after line 58):

```python
class FolderCreateRequest(BaseModel):
    project_id: str
    name: str
    parent_folder_id: Optional[str] = None


class FolderUpdateRequest(BaseModel):
    name: Optional[str] = None
    parent_folder_id: Optional[str] = None
    folder_order: Optional[int] = None
```

- [ ] **Step 2: Add `folder_id` query param to `GET /items`**

In `list_media_items`, add the parameter (after line 105 `tag: Optional[str] = None,`):

```python
    tag: Optional[str] = None,
    folder_id: Optional[str] = None,
```

And pass it into `media_library_service.list_items(...)` (after line 140 `org_id=org_id,`):

```python
            org_id=org_id,
            folder_id=folder_id,
        )
```

- [ ] **Step 3: Add `folder_id` Form field to `POST /upload`**

In `upload_media_item`, add the form field (after line 160 `org_id: Optional[str] = Form(None),`):

```python
    org_id: Optional[str] = Form(None),  # visibility='org-default' 时附带，触发自动 share
    folder_id: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user),
```

Pass it into `media_library_service.create_from_file(...)` (after line 242 `visibility=visibility,`):

```python
            visibility=visibility,
            folder_id=folder_id,
        )
```

- [ ] **Step 4: Append the folder CRUD routes**

Add at the end of `media_library_routes.py` (after `batch_download`, line 389). Folders are project-scoped; create/update/delete require `member`, list requires `readonly`:

```python
# ============================================
# 文件夹（2026-05-30 素材库可嵌套分类：人物 / 场景 / 道具 等）
# ============================================

@router.get("/folders")
async def list_folders(
    project_id: str,
    user_id: str = Depends(get_current_user),
):
    if not await _check_project_access(project_id, user_id, required_role='readonly'):
        raise HTTPException(status_code=403, detail="无权访问该项目素材库")
    folders = await MediaLibraryFolderDAO.list_by_project(project_id)
    return {"success": True, "folders": folders}


@router.post("/folders")
async def create_folder(
    payload: FolderCreateRequest,
    user_id: str = Depends(get_current_user),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="文件夹名不能为空")
    if not await _check_project_access(payload.project_id, user_id, required_role='member'):
        raise HTTPException(status_code=403, detail="无权在该项目创建文件夹")
    if payload.parent_folder_id:
        parent = await MediaLibraryFolderDAO.get(payload.parent_folder_id)
        if not parent or parent.get('project_id') != payload.project_id:
            raise HTTPException(status_code=400, detail="父文件夹无效")
    folder = await MediaLibraryFolderDAO.create(
        payload.project_id, payload.name.strip(), parent_folder_id=payload.parent_folder_id,
    )
    return {"success": True, "folder": folder}


@router.patch("/folders/{folder_id}")
async def patch_folder(
    folder_id: str,
    payload: FolderUpdateRequest,
    user_id: str = Depends(get_current_user),
):
    folder = await MediaLibraryFolderDAO.get(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    if not await _check_project_access(folder['project_id'], user_id, required_role='member'):
        raise HTTPException(status_code=403, detail="无权修改该文件夹")
    fields = {k: v for k, v in payload.dict().items() if v is not None}
    if 'parent_folder_id' in fields:
        if await MediaLibraryFolderDAO.would_create_cycle(folder_id, fields['parent_folder_id']):
            raise HTTPException(status_code=400, detail="不能把文件夹移动到自身或其子文件夹下")
    updated = await MediaLibraryFolderDAO.update(folder_id, fields)
    return {"success": True, "folder": updated}


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    user_id: str = Depends(get_current_user),
):
    folder = await MediaLibraryFolderDAO.get(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    if not await _check_project_access(folder['project_id'], user_id, required_role='member'):
        raise HTTPException(status_code=403, detail="无权删除该文件夹")
    await MediaLibraryFolderDAO.delete(folder_id)
    return {"success": True}
```

- [ ] **Step 5: Handle empty-string `folder_id` in PATCH (move-to-unfiled)**

In `patch_media_item` (lines 284-303), the existing `fields = {k: v for k, v in payload.dict().items() if v is not None}` drops `None` but keeps `''`. To let the frontend move an item to "未归类" by sending `folder_id: ''`, normalize empty string to SQL NULL. After line 290 (`fields = {...}`) add:

```python
    fields = {k: v for k, v in payload.dict().items() if v is not None}
    if fields.get('folder_id') == '':
        fields['folder_id'] = None
    if not fields:
        raise HTTPException(status_code=400, detail="未提供可更新字段")
```

(Note: because the dict-comprehension uses `is not None`, an explicit `folder_id: ''` survives and is then converted to `None` here; sending `folder_id: null` is filtered out and leaves the item unchanged.)

- [ ] **Step 6: Sanity check (server)**

After deploying, optional smoke test on server:
`curl -s "http://localhost:PORT/api/media-library/folders?project_id=<pid>" -H "Authorization: Bearer <token>"`
Expected: `{"success": true, "folders": [...]}`.

- [ ] **Step 7: Scan + sync_check + mirror + commit**

```bash
python scripts/scan_project.py H:/MY2
python scripts/sync_check.py H:/MY2 --strict --levels ERROR
python scripts/sync_to_deploy.py --apply
git add media_library_routes.py deploy/media_library_routes.py context/
git commit -m "feat(media-library): folder CRUD endpoints + folder_id on list/upload/patch"
```

---

### Task 8: Frontend service + `buildFolderTree` helper (+ vitest)

**Files:**
- Modify: `new_html/services/mediaLibraryService.ts`
- Create: `new_html/utils/mediaFolderTree.ts`
- Create: `new_html/__tests__/utils/mediaFolderTree.test.ts`

- [ ] **Step 1: Extend `mediaLibraryService.ts` types + params**

In [new_html/services/mediaLibraryService.ts](new_html/services/mediaLibraryService.ts), add `folder_id` to `ListItemsParams` (after line 70 `org_id?: string;`):

```ts
  org_id?: string;
  /** 文件夹筛选：folder_id 字符串 = 该文件夹；'none' = 未归类；省略 = 全部 */
  folder_id?: string;
}
```

Add `folder_id` to `UpdateItemPayload` (after line 80 `episode_id?: string;`):

```ts
  episode_id?: string;
  /** 移动到文件夹：folder_id；空串 '' = 移出到未归类 */
  folder_id?: string | null;
}
```

Add `folderId` to `UploadOptions` (after line 92 `orgId?: string; ...`):

```ts
  orgId?: string;  // visibility='org-default' 时必填
  folderId?: string;
}
```

In `uploadMediaItem`, append the form field (after line 146 `if (options.orgId) form.append('org_id', options.orgId);`):

```ts
  if (options.orgId) form.append('org_id', options.orgId);
  if (options.folderId) form.append('folder_id', options.folderId);
```

- [ ] **Step 2: Add `MediaFolder` type + folder CRUD client fns**

Append to `new_html/services/mediaLibraryService.ts` (end of file, after `batchDownloadMediaItems`, line 200):

```ts
// ============================================
// 文件夹（2026-05-30）
// ============================================

export interface MediaFolder {
  folder_id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  folder_order: number;
  created_at: string;
  updated_at: string;
}

export async function listFolders(projectId: string): Promise<{ success: boolean; folders: MediaFolder[] }> {
  const resp = await fetch(`${API_BASE}/api/media-library/folders?project_id=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'listFolders');
}

export async function createFolder(payload: {
  project_id: string;
  name: string;
  parent_folder_id?: string | null;
}): Promise<{ success: boolean; folder: MediaFolder }> {
  const resp = await fetch(`${API_BASE}/api/media-library/folders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'createFolder');
}

export async function updateFolder(folderId: string, payload: {
  name?: string;
  parent_folder_id?: string | null;
  folder_order?: number;
}): Promise<{ success: boolean; folder: MediaFolder }> {
  const resp = await fetch(`${API_BASE}/api/media-library/folders/${folderId}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'updateFolder');
}

export async function deleteFolder(folderId: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_BASE}/api/media-library/folders/${folderId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'deleteFolder');
}
```

- [ ] **Step 3: Write the failing vitest for `buildFolderTree`**

Create `new_html/__tests__/utils/mediaFolderTree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFolderTree, flattenForSelect } from '../../utils/mediaFolderTree';
import type { MediaFolder } from '../../services/mediaLibraryService';

function f(id: string, parent: string | null, name: string, order = 0): MediaFolder {
  return {
    folder_id: id, project_id: 'p', parent_folder_id: parent, name,
    folder_order: order, created_at: '', updated_at: '',
  };
}

describe('buildFolderTree', () => {
  it('nests children under parents and keeps roots', () => {
    const tree = buildFolderTree([
      f('a', null, '人物'),
      f('b', 'a', '主角'),
      f('c', null, '场景'),
      f('d', 'a', '配角', 1),
    ]);
    expect(tree.map(n => n.folder_id)).toEqual(['a', 'c']);
    const a = tree.find(n => n.folder_id === 'a')!;
    expect(a.children.map(n => n.folder_id)).toEqual(['b', 'd']);
  });

  it('treats orphan (missing parent) folders as roots', () => {
    const tree = buildFolderTree([f('x', 'ghost', '孤儿')]);
    expect(tree.map(n => n.folder_id)).toEqual(['x']);
  });

  it('flattenForSelect emits depth for indentation', () => {
    const tree = buildFolderTree([f('a', null, '人物'), f('b', 'a', '主角')]);
    const flat = flattenForSelect(tree);
    expect(flat).toEqual([
      { folder_id: 'a', name: '人物', depth: 0 },
      { folder_id: 'b', name: '主角', depth: 1 },
    ]);
  });
});
```

- [ ] **Step 4: Run test to confirm it fails**

Run: `cd new_html && npx vitest run __tests__/utils/mediaFolderTree.test.ts`
Expected: FAIL — cannot resolve `../../utils/mediaFolderTree`.

- [ ] **Step 5: Implement the helper**

Create `new_html/utils/mediaFolderTree.ts`:

```ts
import type { MediaFolder } from '../services/mediaLibraryService';

export interface FolderNode extends MediaFolder {
  children: FolderNode[];
}

/** 把扁平文件夹列表构造成嵌套树。父不存在的当作根。保持 list 内的相对顺序。 */
export function buildFolderTree(folders: MediaFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.folder_id, { ...f, children: [] });
  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.folder_id)!;
    const parent = f.parent_folder_id ? byId.get(f.parent_folder_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export interface FlatFolderOption {
  folder_id: string;
  name: string;
  depth: number;
}

/** 深度优先展平（用于 <select> 缩进显示）。 */
export function flattenForSelect(nodes: FolderNode[], depth = 0): FlatFolderOption[] {
  const out: FlatFolderOption[] = [];
  for (const n of nodes) {
    out.push({ folder_id: n.folder_id, name: n.name, depth });
    if (n.children.length) out.push(...flattenForSelect(n.children, depth + 1));
  }
  return out;
}
```

- [ ] **Step 6: Run test to confirm it passes**

Run: `cd new_html && npx vitest run __tests__/utils/mediaFolderTree.test.ts`
Expected: 3 passed.

- [ ] **Step 7: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add new_html/services/mediaLibraryService.ts new_html/utils/mediaFolderTree.ts new_html/__tests__/utils/mediaFolderTree.test.ts deploy/new_html/services/mediaLibraryService.ts deploy/new_html/utils/mediaFolderTree.ts deploy/new_html/__tests__/utils/mediaFolderTree.test.ts
git commit -m "feat(media-library): folder API client + buildFolderTree helper + tests"
```

---

### Task 9: MediaLibraryPage — folder tree sidebar, filter, upload picker, drag-to-folder

**Files:**
- Modify: `new_html/pages/MediaLibraryPage.tsx`

This is the largest UI task. It adds: (a) a `FolderTree` sub-component, (b) folder state + load, (c) folder filter wired into `reload`, (d) an upload folder `<select>`, (e) drag-and-drop of cards onto folder nodes.

- [ ] **Step 1: Extend imports**

In [new_html/pages/MediaLibraryPage.tsx](new_html/pages/MediaLibraryPage.tsx), extend the lucide import (lines 18-22) and the service import (lines 23-32):

```tsx
import {
  Upload, Download, Star, StarOff, Trash2, Eye, RefreshCw, Filter,
  Grid as GridIcon, List as ListIcon, Image as ImageIcon, Film, Music, FileText,
  Search, Folder, FolderPlus, ChevronRight, ChevronDown, Pencil, X as XIcon,
} from 'lucide-react';
import {
  listMediaItems,
  uploadMediaItem,
  updateMediaItem,
  deleteMediaItem,
  batchDownloadMediaItems,
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  MediaLibraryItem,
  MediaFolder,
  MediaItemType,
  PermissionScope,
} from '../services/mediaLibraryService';
import { buildFolderTree, flattenForSelect, type FolderNode } from '../utils/mediaFolderTree';
```

- [ ] **Step 2: Add folder state + selected folder**

After line 89 (`const [uploadVisibility, setUploadVisibility] = useState<'private' | 'org-default'>('private');`) add:

```tsx
  // 2026-05-30 文件夹
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  // selectedFolderId: null = 全部（不按文件夹过滤）; 'none' = 未归类; 其它 = 具体文件夹
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [uploadFolderId, setUploadFolderId] = useState<string>('');  // '' = 不归类
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const folderOptions = useMemo(() => flattenForSelect(folderTree), [folderTree]);

  const loadFolders = useCallback(async () => {
    if (!projectId) return;
    try {
      const resp = await listFolders(projectId);
      setFolders(resp.folders || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [projectId]);

  useEffect(() => { loadFolders(); }, [loadFolders]);
```

- [ ] **Step 3: Wire folder filter into `reload`**

In `reload` (lines 99-137), add the folder param just before `if (keyword.trim())` (line 128) and add `selectedFolderId` to the dependency array (line 137):

```tsx
      if (selectedFolderId === 'none') params.folder_id = 'none';
      else if (selectedFolderId) params.folder_id = selectedFolderId;
      if (keyword.trim()) params.keyword = keyword.trim();
```

```tsx
  }, [projectId, category, keyword, selectedFolderId]);
```

- [ ] **Step 4: Default `uploadFolderId` to the selected folder; pass into upload**

In `handleFileChosen` (lines 143-165), pass `folderId` into `uploadMediaItem` (line 150-156):

```tsx
        await uploadMediaItem(f, {
          projectId,
          permissionScope: 'project',
          title: f.name,
          visibility: uploadVisibility,
          orgId: uploadVisibility === 'org-default' ? (orgId || undefined) : undefined,
          folderId: uploadFolderId || undefined,
        });
```

And keep `uploadFolderId` synced to the currently selected real folder — add this effect after the `loadFolders` effect from Step 2:

```tsx
  useEffect(() => {
    // 选中具体文件夹时，上传默认进该文件夹；选「全部 / 未归类」则默认不归类
    setUploadFolderId(selectedFolderId && selectedFolderId !== 'none' ? selectedFolderId : '');
  }, [selectedFolderId]);
```

- [ ] **Step 5: Add folder action handlers**

After `handleDelete` (ends line 217) add:

```tsx
  const handleCreateFolder = async (parentId: string | null) => {
    if (!projectId) return;
    const name = prompt(parentId ? '新建子文件夹名称' : '新建文件夹名称（如 人物 / 场景 / 道具）');
    if (!name || !name.trim()) return;
    try {
      await createFolder({ project_id: projectId, name: name.trim(), parent_folder_id: parentId });
      await loadFolders();
    } catch (e: any) { setError(e?.message || String(e)); }
  };

  const handleRenameFolder = async (folder: MediaFolder) => {
    const name = prompt('重命名文件夹', folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    try {
      await updateFolder(folder.folder_id, { name: name.trim() });
      await loadFolders();
    } catch (e: any) { setError(e?.message || String(e)); }
  };

  const handleDeleteFolder = async (folder: MediaFolder) => {
    if (!confirm(`删除文件夹 "${folder.name}"？\n（子文件夹一并删除；文件夹内素材不会被删除，只会变为未归类）`)) return;
    try {
      await deleteFolder(folder.folder_id);
      if (selectedFolderId === folder.folder_id) setSelectedFolderId(null);
      await loadFolders();
      await reload();
    } catch (e: any) { setError(e?.message || String(e)); }
  };

  const handleMoveItemToFolder = async (libraryItemId: string, folderId: string | null) => {
    try {
      await updateMediaItem(libraryItemId, { folder_id: folderId === null ? '' : folderId });
      await reload();
    } catch (e: any) { setError(e?.message || String(e)); }
  };
```

- [ ] **Step 6: Render the folder section in the sidebar**

In the left `<aside>` (lines 305-324), after the `CATEGORIES.map(...)` block and before the `共 {total} 个素材` footer (line 321), insert the folder tree. Replace lines 320-323:

```tsx
          <div className="mt-auto pt-3 border-t border-zinc-800 text-xs text-zinc-500 px-2">
            共 {total} 个素材
          </div>
        </aside>
```

with:

```tsx
          {/* 文件夹（人物 / 场景 / 道具 等可嵌套分类）*/}
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">文件夹</span>
              <button
                onClick={() => handleCreateFolder(null)}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                title="新建文件夹"
              >
                <FolderPlus size={13} />
              </button>
            </div>
            <button
              onClick={() => { setSelectedFolderId('none'); setSelectedId(null); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${
                selectedFolderId === 'none' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60'
              }`}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                const id = e.dataTransfer.getData('text/library-item-id');
                if (id) handleMoveItemToFolder(id, null);
              }}
            >
              <Folder size={14} />
              <span>未归类</span>
            </button>
            <FolderTree
              nodes={folderTree}
              selectedFolderId={selectedFolderId}
              onSelect={fid => { setSelectedFolderId(fid); setSelectedId(null); }}
              onCreateChild={handleCreateFolder}
              onRename={handleRenameFolder}
              onDelete={handleDeleteFolder}
              onDropItem={handleMoveItemToFolder}
            />
          </div>

          <div className="mt-auto pt-3 border-t border-zinc-800 text-xs text-zinc-500 px-2">
            共 {total} 个素材
          </div>
        </aside>
```

Also make the existing CATEGORIES buttons clear the folder filter so the top categories and folders are mutually exclusive selections. In the `CATEGORIES.map` button `onClick` (line 309), change:

```tsx
              onClick={() => { setCategory(c.key); setSelectedId(null); }}
```

to:

```tsx
              onClick={() => { setCategory(c.key); setSelectedFolderId(null); setSelectedId(null); }}
```

(Selecting a top category resets to "all folders"; the media-type filter still applies. Selecting a folder keeps the current category as an additional AND filter.)

- [ ] **Step 7: Add the upload folder picker to the toolbar**

In the toolbar, right before the upload visibility `<select>` (line 271), insert a folder picker:

```tsx
          {/* 上传目标文件夹 */}
          <select
            value={uploadFolderId}
            onChange={e => setUploadFolderId(e.target.value)}
            className="px-2 py-1.5 rounded bg-zinc-800 text-xs border border-zinc-700 max-w-[160px]"
            title="上传到哪个文件夹"
          >
            <option value="">未归类</option>
            {folderOptions.map(o => (
              <option key={o.folder_id} value={o.folder_id}>
                {`${'\u00A0\u00A0'.repeat(o.depth)}${o.name}`}
              </option>
            ))}
          </select>
```

- [ ] **Step 8: Make grid cards draggable**

In `MediaCard` (lines 418-495), make the root `<div>` draggable and set the drag payload. Change the opening `<div onClick={onSelect} ...>` (lines 425-429) to add `draggable` + `onDragStart`:

```tsx
    <div
      onClick={onSelect}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/library-item-id', item.library_item_id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`relative group rounded overflow-hidden border bg-zinc-900 cursor-pointer ${
        selected ? 'border-emerald-500' : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
```

- [ ] **Step 9: Add the `FolderTree` sub-component**

Add this component at the end of the file (after `MediaDetailPanel` / near the other sub-components, e.g. after line 557 `MediaList`):

```tsx
const FolderTree: React.FC<{
  nodes: FolderNode[];
  selectedFolderId: string | null;
  depth?: number;
  onSelect: (folderId: string) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (folder: MediaFolder) => void;
  onDelete: (folder: MediaFolder) => void;
  onDropItem: (libraryItemId: string, folderId: string | null) => void;
}> = ({ nodes, selectedFolderId, depth = 0, onSelect, onCreateChild, onRename, onDelete, onDropItem }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  return (
    <div>
      {nodes.map(node => {
        const isOpen = expanded.has(node.folder_id);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.folder_id}>
            <div
              className={`group flex items-center gap-1 pr-1 py-1 rounded text-sm ${
                selectedFolderId === node.folder_id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60'
              }`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                const id = e.dataTransfer.getData('text/library-item-id');
                if (id) onDropItem(id, node.folder_id);
              }}
            >
              <button
                onClick={() => hasChildren && toggle(node.folder_id)}
                className={`shrink-0 ${hasChildren ? '' : 'invisible'}`}
              >
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <button onClick={() => onSelect(node.folder_id)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
                <Folder size={13} className="shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
              <div className="flex items-center opacity-0 group-hover:opacity-100">
                <button onClick={() => onCreateChild(node.folder_id)} className="p-0.5 hover:text-zinc-100" title="新建子文件夹"><FolderPlus size={12} /></button>
                <button onClick={() => onRename(node)} className="p-0.5 hover:text-zinc-100" title="重命名"><Pencil size={12} /></button>
                <button onClick={() => onDelete(node)} className="p-0.5 hover:text-red-300" title="删除"><XIcon size={12} /></button>
              </div>
            </div>
            {isOpen && hasChildren && (
              <FolderTree
                nodes={node.children}
                selectedFolderId={selectedFolderId}
                depth={depth + 1}
                onSelect={onSelect}
                onCreateChild={onCreateChild}
                onRename={onRename}
                onDelete={onDelete}
                onDropItem={onDropItem}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 10: Type-check + build**

Run: `cd new_html && npx tsc --noEmit && npx vite build`
Expected: no new errors; build succeeds.

- [ ] **Step 11: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add new_html/pages/MediaLibraryPage.tsx deploy/new_html/pages/MediaLibraryPage.tsx
git commit -m "feat(media-library): folder tree sidebar + upload folder picker + drag-to-folder in MediaLibraryPage"
```

---

### Task 10: Docs sync + gates

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/frontend.md`, `docs/faq.md`, `docs/vertical-slices.md`

- [ ] **Step 1: database.md — document the new table + column**

Add a `media_library_folders` section (columns: `folder_id` PK-ish unique, `project_id` FK, `parent_folder_id` self-FK nullable, `name`, `folder_order`, timestamps) and note the new `media_library_items.folder_id VARCHAR(50)` nullable FK (`ON DELETE SET NULL`). Reference `db_migration_media_library_folders.sql`.

- [ ] **Step 2: api.md — document the folder endpoints + new params**

Add: `GET /api/media-library/folders?project_id=`, `POST /api/media-library/folders`, `PATCH /api/media-library/folders/{folder_id}`, `DELETE /api/media-library/folders/{folder_id}`; note `folder_id` query param on `GET /api/media-library/items` (`folder_id=none` → unfiled), `folder_id` form field on `POST /api/media-library/upload`, and `folder_id` (incl. `''` → unfiled) on `PATCH /api/media-library/items/{id}`.

- [ ] **Step 3: frontend.md — document the folder tree UI**

Note `MediaLibraryPage` now renders a nestable folder tree sidebar, an upload target-folder picker, and supports drag-and-drop of cards onto folders; helper `new_html/utils/mediaFolderTree.ts` (`buildFolderTree` / `flattenForSelect`).

- [ ] **Step 4: faq.md — add an entry**

Add: Symptom "素材库无法按人物/场景/道具归类"; Root cause "media_library_items 原本只有 item_type（图片/视频/音频），无用户自定义分类"; Fix "新增 media_library_folders 嵌套表 + folder_id 列 + 文件夹树 UI（2026-05-30）"; Files: the migration, DAO, routes, `MediaLibraryPage.tsx`.

- [ ] **Step 5: vertical-slices.md — update the MediaLibraryPage slice**

Add `media_library_folders` to the tables list and the four folder routes to the routes list for the `MediaLibraryPage` slice.

- [ ] **Step 6: Run gates**

```bash
python scripts/scan_project.py H:/MY2
python scripts/sync_check.py H:/MY2 --strict --levels ERROR
```
Expected: exit 0.

- [ ] **Step 7: Mirror + commit**

```bash
python scripts/sync_to_deploy.py --apply
git add docs/ deploy/docs/ context/
git commit -m "docs(media-library): document folder table, endpoints, and folder-tree UI"
```

---

### Task 11: Server-side migration + backend tests (run by user)

Backend DB is remote; run these on the server after the branch is deployed/pulled.

- [ ] **Step 1: Apply the migration (idempotent)**

```bash
PGPASSWORD='<db_password>' psql -U my2_user -d my2_db -f db_migration_media_library_folders.sql
```
Expected: `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` with no errors (safe to re-run thanks to `IF NOT EXISTS`).

- [ ] **Step 2: Run the backend tests**

```bash
python -m pytest tests/test_dao_media_library_folder.py -v
```
Expected: 4 passed.

- [ ] **Step 3: Smoke-test the API**

Open the 素材库 page in the app: create a folder named 人物, create a subfolder 主角, upload a file with the folder picker set to 主角, confirm it appears when 主角 is selected, drag another card onto 场景, and reload to confirm folder selection + storyboard persistence behave correctly.

---

## Self-Review

**Spec coverage (the three user requests):**
1. Bell dropdown covered on every page → Task 1 (portal + `z-[9000]` + fixed positioning). Covered.
2. Storyboard 图+音联合时间轴 height adjustable + collapsible → Task 2 (vertical drag + persisted `{collapsed, heightPx}` + scrollable body). Covered.
3. 素材库 nestable folders (人物/场景/道具 + custom), upload-time folder selection, drag-to-classify → Tasks 3-11 (table + DAO + routes + service + FE service + tree UI + upload picker + DnD). Covered.

**Placeholder scan:** No TBD / "handle edge cases" / "similar to Task N" left; every code step has full code.

**Type consistency:**
- `MediaFolder` shape is identical in `mediaLibraryService.ts` (Task 8) and consumed in `MediaLibraryPage.tsx` (Task 9) and `mediaFolderTree.ts` (Task 8).
- `buildFolderTree` / `flattenForSelect` / `FolderNode` defined in Task 8, imported in Task 9.
- `folder_id` naming: backend column `folder_id` (snake), API param `folder_id`, FE service `folder_id` (in `ListItemsParams`/`UpdateItemPayload`) and `folderId` (in `UploadOptions`, mapped to form field `folder_id`). Consistent and intentional.
- `would_create_cycle(folder_id, new_parent_id)` defined in Task 4 DAO, called in Task 7 route — signature matches.
- `usePersistedPageState<T>` returns `[T, setter, clear]`; Task 2 uses the 2-tuple destructure `[timelinePanel, setTimelinePanel]` which is valid (third element omitted).

**Edge cases handled:** unfiled filter (`folder_id=none` / `''`), cycle guard on move, folder delete leaves items (SET NULL) and cascades subfolders, orphan folders (missing parent) treated as roots in `buildFolderTree`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-30-ui-fixes-and-media-folders.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
