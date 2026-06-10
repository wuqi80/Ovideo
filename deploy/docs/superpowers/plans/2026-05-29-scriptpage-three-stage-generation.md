# ScriptPage 三步生成链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ScriptPage 的「一步 AI 改写」改造成「拆分剧本 → 生成视频脚本 → 提取分镜提示词」三阶段可重跑、可恢复、可落库的生成链路。

**Architecture:** 新增 `episode_script_segments` 表保存 Stage 1 分段中间产物；`storyboard_items` 扩列承载 Stage 2/3 的镜头来源与景别/角度；后端加一组 segments API + StoryboardDAO 扩字段；前端在 `WorkspaceApp` 现有三栏编辑器基础上加一个「三步生成」面板，三个阶段各自有 AI prompt template + 纯函数 parser + service 函数，逐段/逐镜头执行并即时保存。视频页继续读 `video_prompt`、分镜页继续读 `image_prompt`，向后兼容旧数据。

**Tech Stack:** PostgreSQL (asyncpg) · FastAPI/Pydantic · React 19 + TypeScript · Vitest (前端) · pytest (后端) · 双仓镜像 `scripts/sync_to_deploy.py`

---

## Pre-flight（执行前，只做一次）

- [ ] **P0：刷新 GitNexus 索引（spec §13 要求）**

Run: `npx gitnexus analyze --force`
Expected: 完成且无 error；`gitnexus://repo/MY2/context` 显示 indexed commit == current commit。

- [ ] **P1：对将要改动的关键文件跑 impact_check（项目铁律）**

Run:
```bash
python .claude/skills/project-memory/scripts/impact_check.py H:/MY2 dao_storyboard.py --brief
python .claude/skills/project-memory/scripts/impact_check.py H:/MY2 api_routes.py --brief
python .claude/skills/project-memory/scripts/impact_check.py H:/MY2 new_html/WorkspaceApp.tsx --brief
```
Expected: 三者风险均为 LOW（与 spec §13 一致）。若出现 HIGH/CRITICAL，停下来先和用户确认。

### 双仓镜像约定（贯穿全程，必须遵守）

本仓维护「根目录 → `deploy/`」**单向手工镜像**，由 `scripts/sync_to_deploy.py` 统一处理，pre-commit hook 会 `--check` 拦截漂移。规则：

- `*.py` → `deploy/*.py`
- `db_migration_*.sql` → `deploy/{name}.sql` **和** `deploy/sql/{name}.sql`（两处都要）
- `new_html/**/*.{ts,tsx,...}` → `deploy/new_html/**`（**但 `new_html/__tests__/` 不镜像**，测试只放根目录）
- `docs/**/*.md` → `deploy/docs/**`

**因此：每个 task 在 `git commit` 之前，先执行 `python scripts/sync_to_deploy.py --apply`，再 `git add` 包含 `deploy/` 下被同步的镜像文件。** 测试文件（`__tests__/`、`tests/test_*.py`）不镜像，但 `tests/test_*.py` 后端测试本身就只在根目录跑。

---

## File Structure

新建文件：

| 文件 | 职责 |
|---|---|
| `db_migration_episode_script_segments.sql` | 新表 `episode_script_segments` |
| `db_migration_storyboard_pipeline_fields.sql` | `storyboard_items` 扩 5 列 |
| `dao_episode_script_segment.py` | segments 表 CRUD + `batch_replace` |
| `tests/test_dao_episode_script_segment.py` | segments DAO 测试 |
| `new_html/prompts/scriptPipelinePrompts.ts` | 三个阶段的 PromptTemplate |
| `new_html/utils/scriptPipelineParsers.ts` | 三个纯函数 parser |
| `new_html/__tests__/utils/scriptPipelineParsers.test.ts` | parser 单测 |

修改文件：

| 文件 | 改动 |
|---|---|
| `dao_storyboard.py` | `create/batch_create/batch_create_transactional/update` 支持 5 个新字段 |
| `tests/test_dao_storyboard.py` | 新增字段往返测试 |
| `api_routes.py` | segments API（GET/PUT batch/DELETE）+ Pydantic body |
| `new_html/types.ts` | `ScriptSegment` / `ScriptGenerationStageState` / `VideoScriptBlock` / `ExtractedStoryboardPrompt`；`StoryboardItem`、`ProjectFile` 扩字段 |
| `new_html/services/apiService.ts` | segments 三个 API 函数 |
| `new_html/services/aiModelService.ts` | 三个 stage service 函数 |
| `new_html/WorkspaceApp.tsx` | `loadEpisodeData` 加载 segments；`saveEpisodeToBackend` 保存 segments + 新 storyboard 字段；三阶段 handler + pipeline；三步生成 UI 面板 |
| `docs/database.md` / `docs/frontend.md` / `docs/api.md` / `docs/diagrams/page-ScriptPage.md` | 文档同步 |

---

## Task 1: 数据库 migration（新表 + 扩列）

**Files:**
- Create: `db_migration_episode_script_segments.sql`
- Create: `db_migration_storyboard_pipeline_fields.sql`

- [ ] **Step 1: 写 `db_migration_episode_script_segments.sql`**

```sql
-- 2026-05-29: ScriptPage 三步生成 — 新增剧本分段中间产物表
-- For: docs/superpowers/specs/2026-05-29-scriptpage-three-stage-generation-design.md §5.1
-- Idempotent: IF NOT EXISTS

DO $$
BEGIN
    RAISE NOTICE '[migration] episode_script_segments start at %', clock_timestamp();
END
$$;

CREATE TABLE IF NOT EXISTS episode_script_segments (
    id SERIAL PRIMARY KEY,
    segment_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    script_id VARCHAR(50) REFERENCES episode_scripts(script_id) ON DELETE CASCADE,
    segment_order INTEGER NOT NULL DEFAULT 0,
    source_text TEXT NOT NULL DEFAULT '',
    estimated_duration_sec INTEGER,
    video_script TEXT DEFAULT '',
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_script_segments_episode
    ON episode_script_segments(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_script_segments_script_order
    ON episode_script_segments(script_id, segment_order);

CREATE OR REPLACE FUNCTION update_episode_script_segments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_episode_script_segments_updated_at ON episode_script_segments;
CREATE TRIGGER trg_episode_script_segments_updated_at
    BEFORE UPDATE ON episode_script_segments
    FOR EACH ROW
    EXECUTE FUNCTION update_episode_script_segments_updated_at();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'episode_script_segments') THEN
        RAISE EXCEPTION '[migration] episode_script_segments table missing';
    END IF;
    RAISE NOTICE '[migration] episode_script_segments done at %', clock_timestamp();
END
$$;
```

- [ ] **Step 2: 写 `db_migration_storyboard_pipeline_fields.sql`**

```sql
-- 2026-05-29: ScriptPage 三步生成 — storyboard_items 扩列（镜头来源 + 景别/角度）
-- For: docs/superpowers/specs/2026-05-29-scriptpage-three-stage-generation-design.md §5.2
-- Idempotent: ADD COLUMN IF NOT EXISTS

DO $$
BEGIN
    RAISE NOTICE '[migration] storyboard_pipeline_fields start at %', clock_timestamp();
END
$$;

ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS script_segment_id    VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_video_shot_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS video_script_block   TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS shot_size            VARCHAR(50) DEFAULT '',
    ADD COLUMN IF NOT EXISTS camera_angle         VARCHAR(100) DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_storyboard_items_script_segment
    ON storyboard_items(script_segment_id);

DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'storyboard_items'
      AND column_name IN ('script_segment_id','source_video_shot_no','video_script_block','shot_size','camera_angle');
    IF col_count <> 5 THEN
        RAISE EXCEPTION '[migration] expected 5 new storyboard columns, found %', col_count;
    END IF;
    RAISE NOTICE '[migration] storyboard_pipeline_fields done at %', clock_timestamp();
END
$$;
```

- [ ] **Step 3: 应用 migration 到开发库**

Run（密码/库名见 `deploy_database.sh`：用户 `my2_user`，库 `my2_db`）:
```bash
PGPASSWORD='<DB_PASSWORD>' psql -U my2_user -d my2_db -f db_migration_episode_script_segments.sql
PGPASSWORD='<DB_PASSWORD>' psql -U my2_user -d my2_db -f db_migration_storyboard_pipeline_fields.sql
```
Expected: 两条都打印 `done at ...` NOTICE，无 EXCEPTION。

- [ ] **Step 4: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add db_migration_episode_script_segments.sql db_migration_storyboard_pipeline_fields.sql \
        deploy/db_migration_episode_script_segments.sql deploy/sql/db_migration_episode_script_segments.sql \
        deploy/db_migration_storyboard_pipeline_fields.sql deploy/sql/db_migration_storyboard_pipeline_fields.sql
git commit -m "feat(db): add episode_script_segments table + storyboard pipeline columns"
```
Expected: commit 成功，pre-commit `sync --check` 通过。

---

## Task 2: `EpisodeScriptSegmentDAO`

**Files:**
- Create: `dao_episode_script_segment.py`
- Test: `tests/test_dao_episode_script_segment.py`

- [ ] **Step 1: 写失败测试 `tests/test_dao_episode_script_segment.py`**

```python
# -*- coding: utf-8 -*-
"""剧本分段 DAO 测试"""
import pytest


async def _make_script(conn):
    """在事务连接内建一个 episode + script，返回 (episode_id, script_id)"""
    await conn.execute(
        "INSERT INTO episodes (episode_id, project_id, title) VALUES ($1, $2, $3) "
        "ON CONFLICT (episode_id) DO NOTHING",
        "ep_seg_test", "proj_seg_test", "测试集"
    )
    await conn.execute(
        "INSERT INTO episode_scripts (script_id, episode_id, file_name) VALUES ($1, $2, $3) "
        "ON CONFLICT (script_id) DO NOTHING",
        "script_seg_test", "ep_seg_test", "测试剧本"
    )
    return "ep_seg_test", "script_seg_test"


async def test_batch_replace_then_read_back(test_db):
    from dao_episode_script_segment import EpisodeScriptSegmentDAO
    episode_id, script_id = await _make_script(test_db)
    saved = await EpisodeScriptSegmentDAO.batch_replace(
        episode_id, script_id,
        [
            {"segment_order": 0, "source_text": "原文一", "estimated_duration_sec": 12},
            {"segment_order": 1, "source_text": "原文二", "estimated_duration_sec": 8, "video_script": "镜头1..."},
        ],
        conn=test_db,
    )
    assert len(saved) == 2
    assert all(r["segment_id"].startswith("seg_") for r in saved)

    rows = await EpisodeScriptSegmentDAO.list_by_script(episode_id, script_id, conn=test_db)
    assert len(rows) == 2
    assert rows[0]["segment_order"] == 0
    assert rows[0]["source_text"] == "原文一"
    assert rows[1]["video_script"] == "镜头1..."


async def test_batch_replace_overwrites_old(test_db):
    from dao_episode_script_segment import EpisodeScriptSegmentDAO
    episode_id, script_id = await _make_script(test_db)
    await EpisodeScriptSegmentDAO.batch_replace(
        episode_id, script_id,
        [{"segment_order": 0, "source_text": "旧"}], conn=test_db,
    )
    await EpisodeScriptSegmentDAO.batch_replace(
        episode_id, script_id,
        [{"segment_order": 0, "source_text": "新一"}, {"segment_order": 1, "source_text": "新二"}],
        conn=test_db,
    )
    rows = await EpisodeScriptSegmentDAO.list_by_script(episode_id, script_id, conn=test_db)
    assert len(rows) == 2
    assert rows[0]["source_text"] == "新一"


async def test_cascade_delete_on_script_delete(test_db):
    from dao_episode_script_segment import EpisodeScriptSegmentDAO
    episode_id, script_id = await _make_script(test_db)
    await EpisodeScriptSegmentDAO.batch_replace(
        episode_id, script_id, [{"segment_order": 0, "source_text": "x"}], conn=test_db,
    )
    await test_db.execute("DELETE FROM episode_scripts WHERE script_id = $1", script_id)
    rows = await EpisodeScriptSegmentDAO.list_by_script(episode_id, script_id, conn=test_db)
    assert rows == []
```

> 说明：`test_db` fixture（`tests/conftest.py`）提供事务连接并在结束时 rollback。DAO 方法因此需要支持传入 `conn=`，在已有连接上执行；不传 `conn` 时回退到 `get_db_manager()`。

- [ ] **Step 2: 运行测试，确认失败**

Run: `python -m pytest tests/test_dao_episode_script_segment.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'dao_episode_script_segment'`

- [ ] **Step 3: 实现 `dao_episode_script_segment.py`**

```python
# -*- coding: utf-8 -*-
"""
剧本分段 DAO -- episode_script_segments 表
Stage 1 拆分剧本的中间产物；按 episode_id + script_id 替换式保存。
"""
import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


def _seg_id() -> str:
    return f"seg_{uuid.uuid4().hex[:12]}"


class EpisodeScriptSegmentDAO:

    @staticmethod
    async def list_by_script(episode_id: str, script_id: Optional[str], conn=None) -> List[Dict[str, Any]]:
        sql = (
            "SELECT * FROM episode_script_segments "
            "WHERE episode_id = $1 AND script_id IS NOT DISTINCT FROM $2 "
            "ORDER BY segment_order ASC"
        )
        if conn is not None:
            rows = await conn.fetch(sql, episode_id, script_id)
            return [dict(r) for r in rows]
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(sql, episode_id, script_id)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    async def list_by_episode(episode_id: str, conn=None) -> List[Dict[str, Any]]:
        sql = (
            "SELECT * FROM episode_script_segments "
            "WHERE episode_id = $1 ORDER BY script_id, segment_order ASC"
        )
        if conn is not None:
            rows = await conn.fetch(sql, episode_id)
            return [dict(r) for r in rows]
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(sql, episode_id)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    async def _insert_one(executor, episode_id: str, script_id: Optional[str], seg: dict) -> Dict[str, Any]:
        seg_id = seg.get("segment_id") or _seg_id()
        row = await executor.fetchrow(
            """
            INSERT INTO episode_script_segments
                (segment_id, episode_id, script_id, segment_order, source_text,
                 estimated_duration_sec, video_script, status, error_message, metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
            RETURNING *
            """,
            seg_id, episode_id, script_id,
            int(seg.get("segment_order", 0)),
            seg.get("source_text", "") or "",
            seg.get("estimated_duration_sec"),
            seg.get("video_script", "") or "",
            seg.get("status", "pending") or "pending",
            seg.get("error_message", "") or "",
            json.dumps(seg.get("metadata") or {}, ensure_ascii=False),
        )
        return dict(row)

    @staticmethod
    async def batch_replace(
        episode_id: str, script_id: Optional[str], segments: list, conn=None
    ) -> List[Dict[str, Any]]:
        """替换式保存：先删该 episode+script 的旧 segments，再插入新的。返回插入行。"""
        async def _run(executor):
            await executor.execute(
                "DELETE FROM episode_script_segments "
                "WHERE episode_id = $1 AND script_id IS NOT DISTINCT FROM $2",
                episode_id, script_id,
            )
            out = []
            for seg in segments:
                out.append(await EpisodeScriptSegmentDAO._insert_one(executor, episode_id, script_id, seg))
            return out

        if conn is not None:
            return await _run(conn)
        db = get_db_manager()
        if not db:
            return []
        async with db.acquire() as c:
            async with c.transaction():
                return await _run(c)

    @staticmethod
    async def delete_by_script(episode_id: str, script_id: Optional[str], conn=None) -> int:
        sql = (
            "DELETE FROM episode_script_segments "
            "WHERE episode_id = $1 AND script_id IS NOT DISTINCT FROM $2"
        )
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return 0
        result = await executor.execute(sql, episode_id, script_id)
        try:
            return int(result.split()[-1])
        except Exception:
            return 0
```

> `IS NOT DISTINCT FROM` 让 `script_id=None` 时也能正确匹配 NULL 行（兼容历史 orphan 段落）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `python -m pytest tests/test_dao_episode_script_segment.py -v`
Expected: 3 passed

- [ ] **Step 5: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add dao_episode_script_segment.py deploy/dao_episode_script_segment.py tests/test_dao_episode_script_segment.py
git commit -m "feat(dao): EpisodeScriptSegmentDAO with batch_replace"
```
Expected: commit 成功。（`tests/` 不镜像，仅根目录提交。）

---

## Task 3: `StoryboardDAO` 支持 5 个新字段

**Files:**
- Modify: `dao_storyboard.py:14-98`（`create` / `batch_create` / `batch_create_transactional`）和 `dao_storyboard.py:124-152`（`update`）
- Test: `tests/test_dao_storyboard.py`（追加）

- [ ] **Step 1: 追加失败测试到 `tests/test_dao_storyboard.py`**

```python
async def test_create_with_pipeline_fields(test_db):
    from dao_storyboard import StoryboardDAO
    result = await StoryboardDAO.create(
        episode_id="ep_pipe", sort_order=1,
        script_segment_id="seg_abc", source_video_shot_no="镜头1",
        video_script_block="镜头1\n时长（秒）：3\n...", shot_size="远景",
        camera_angle="俯视视角",
    )
    assert result is not None
    assert result["script_segment_id"] == "seg_abc"
    assert result["source_video_shot_no"] == "镜头1"
    assert result["shot_size"] == "远景"
    assert result["camera_angle"] == "俯视视角"
    assert result["video_script_block"].startswith("镜头1")


async def test_batch_create_with_pipeline_fields(test_db):
    from dao_storyboard import StoryboardDAO
    rows = await StoryboardDAO.batch_create("ep_pipe", [
        {"sort_order": 0, "scene_heading": "h", "shot_size": "近景",
         "camera_angle": "平视视角", "source_video_shot_no": "镜头2",
         "script_segment_id": "seg_x", "video_script_block": "blk"},
    ])
    assert len(rows) == 1
    assert rows[0]["shot_size"] == "近景"
    assert rows[0]["script_segment_id"] == "seg_x"


async def test_update_pipeline_fields(test_db):
    from dao_storyboard import StoryboardDAO
    created = await StoryboardDAO.create(episode_id="ep_pipe", sort_order=1)
    updated = await StoryboardDAO.update(
        created["item_id"], shot_size="特写", camera_angle="仰视视角",
    )
    assert updated["shot_size"] == "特写"
    assert updated["camera_angle"] == "仰视视角"
```

- [ ] **Step 2: 运行，确认失败**

Run: `python -m pytest tests/test_dao_storyboard.py -k pipeline -v`
Expected: FAIL，`create()` 不接受 `script_segment_id` 关键字 → `TypeError`

- [ ] **Step 3: 改 `StoryboardDAO.create`（`dao_storyboard.py:14-45`）**

替换整个 `create` 方法为：

```python
    @staticmethod
    async def create(
        episode_id: str,
        sort_order: int,
        scene_heading: str = '',
        action_text: str = '',
        dialogue: str = '',
        camera_movement: str = '',
        image_prompt: str = '',
        video_prompt: str = '',
        bound_assets: list = None,
        script_id: Optional[str] = None,
        # 2026-05-29 三步生成新增字段
        script_segment_id: Optional[str] = None,
        source_video_shot_no: str = '',
        video_script_block: str = '',
        shot_size: str = '',
        camera_angle: str = '',
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        item_id = f"sb_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO storyboard_items
                (item_id, episode_id, sort_order, scene_heading, action_text,
                 dialogue, camera_movement, image_prompt, video_prompt, bound_assets,
                 script_id, script_segment_id, source_video_shot_no,
                 video_script_block, shot_size, camera_angle)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                    $11, $12, $13, $14, $15, $16)
            RETURNING *
        """
        return await db.fetchrow(
            query, item_id, episode_id, sort_order,
            scene_heading, action_text, dialogue,
            camera_movement, image_prompt, video_prompt,
            json.dumps(bound_assets or [], ensure_ascii=False),
            script_id, script_segment_id, source_video_shot_no,
            video_script_block, shot_size, camera_angle,
        )
```

- [ ] **Step 4: 改 `batch_create`（`dao_storyboard.py:47-69`）的 `StoryboardDAO.create(...)` 调用，透传新字段**

在 `batch_create` 内的 `create(...)` 调用追加 5 个参数：

```python
            row = await StoryboardDAO.create(
                episode_id=episode_id,
                sort_order=item.get('sort_order', 0),
                scene_heading=item.get('scene_heading', ''),
                action_text=item.get('action_text', ''),
                dialogue=item.get('dialogue', ''),
                camera_movement=item.get('camera_movement', ''),
                image_prompt=item.get('image_prompt', ''),
                video_prompt=item.get('video_prompt', ''),
                bound_assets=item.get('bound_assets'),
                script_id=script_id or item.get('script_id'),
                script_segment_id=item.get('script_segment_id'),
                source_video_shot_no=item.get('source_video_shot_no', ''),
                video_script_block=item.get('video_script_block', ''),
                shot_size=item.get('shot_size', ''),
                camera_angle=item.get('camera_angle', ''),
            )
```

- [ ] **Step 5: 改 `batch_create_transactional`（`dao_storyboard.py:72-98`）的 INSERT，加 5 列**

替换其中的 `await conn.execute("""INSERT ...""", ...)` 为：

```python
            await conn.execute("""
                INSERT INTO storyboard_items
                    (item_id, episode_id, sort_order, scene_heading, action_text,
                     dialogue, camera_movement, image_prompt, video_prompt,
                     bound_assets, planned_duration_ms, script_id,
                     script_segment_id, source_video_shot_no, video_script_block,
                     shot_size, camera_angle)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12,
                        $13, $14, $15, $16, $17)
            """,
                item_id, episode_id,
                item.get('sort_order', 0),
                item.get('scene_heading', ''),
                item.get('action_text', ''),
                item.get('dialogue', ''),
                item.get('camera_movement', ''),
                item.get('image_prompt', ''),
                item.get('video_prompt', ''),
                json.dumps(item.get('bound_assets', []), ensure_ascii=False),
                item.get('planned_duration_ms'),
                sid,
                item.get('script_segment_id'),
                item.get('source_video_shot_no', ''),
                item.get('video_script_block', ''),
                item.get('shot_size', ''),
                item.get('camera_angle', ''),
            )
```

- [ ] **Step 6: 扩 `update` 的 `allowed` 集合（`dao_storyboard.py:129-136`）**

```python
        allowed = {
            'sort_order', 'scene_heading', 'action_text', 'dialogue',
            'camera_movement', 'image_prompt', 'video_prompt',
            'generated_image_url', 'status',
            'dialogue_audio_url', 'narration_audio_url', 'sfx_audio_url',
            'audio_duration_ms', 'planned_duration_ms',
            'mixed_audio_url', 'mixed_audio_hash',
            # 2026-05-29 三步生成新增字段
            'script_segment_id', 'source_video_shot_no', 'video_script_block',
            'shot_size', 'camera_angle',
        }
```

- [ ] **Step 7: 运行，确认通过**

Run: `python -m pytest tests/test_dao_storyboard.py -v`
Expected: 全部 passed（含 3 个新 pipeline 测试 + 原有 5 个）

- [ ] **Step 8: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add dao_storyboard.py deploy/dao_storyboard.py tests/test_dao_storyboard.py
git commit -m "feat(dao): StoryboardDAO supports pipeline fields (segment/shot/size/angle)"
```

---

## Task 4: Segments API + storyboard batch 字段直通

**Files:**
- Modify: `api_routes.py`（在 `class ScriptCreate`（约 2572 行）之后新增 segments 段；storyboard batch 已用 `items: list` 直通，无需改）
- Test: `tests/test_dao_episode_script_segment.py`（已覆盖 DAO）；API 层加 1 个 client 测试

- [ ] **Step 1: 在 `api_routes.py` 顶部 import 段加入 DAO import**

找到现有 `from dao_storyboard import StoryboardDAO`（或 `from dao_episode_script import EpisodeScriptDAO`）附近，追加：

```python
from dao_episode_script_segment import EpisodeScriptSegmentDAO
```

- [ ] **Step 2: 在 `api_routes.py` 的 `class ScriptCreate` 定义之后追加 segments API**

```python
# ---------- 剧本分段 API（2026-05-29 三步生成 Stage 1 产物）----------

class ScriptSegmentBatchBody(BaseModel):
    script_id: Optional[str] = None
    segments: list = []


@router.get("/api/episodes/{episode_id}/script-segments")
async def list_script_segments(episode_id: str, script_id: Optional[str] = None,
                               user_id: str = Depends(get_current_user)):
    if script_id:
        rows = await EpisodeScriptSegmentDAO.list_by_script(episode_id, script_id)
    else:
        rows = await EpisodeScriptSegmentDAO.list_by_episode(episode_id)
    return {"success": True, "segments": rows}


@router.put("/api/episodes/{episode_id}/script-segments/batch")
async def batch_save_script_segments(episode_id: str, data: ScriptSegmentBatchBody,
                                     user_id: str = Depends(get_current_user)):
    rows = await EpisodeScriptSegmentDAO.batch_replace(episode_id, data.script_id, data.segments)
    return {"success": True, "segments": rows}


@router.delete("/api/episodes/{episode_id}/script-segments")
async def delete_script_segments(episode_id: str, script_id: Optional[str] = None,
                                 user_id: str = Depends(get_current_user)):
    count = await EpisodeScriptSegmentDAO.delete_by_script(episode_id, script_id)
    return {"success": True, "deleted": count}
```

> storyboard batch 端点 (`/api/episodes/{episode_id}/storyboard-items/batch`) 的 body 是 `items: list`（裸 list，无 Pydantic 字段约束），新字段 `script_segment_id/source_video_shot_no/...` 会原样流进 `StoryboardDAO.batch_create`，**无需改 API**。Task 3 已让 DAO 接收这些 key。

- [ ] **Step 3: 加 client 测试（追加到 `tests/test_dao_episode_script_segment.py` 末尾）**

```python
async def test_segments_api_roundtrip(client, auth_headers):
    ep = "ep_seg_api"
    # 先建 episode + script（API 没有建 episode 的入口，用 DAO 直插）
    from db_manager import get_db_manager
    db = get_db_manager()
    async with db.acquire() as c:
        await c.execute("INSERT INTO episodes (episode_id, project_id, title) VALUES ($1,$2,$3) "
                        "ON CONFLICT (episode_id) DO NOTHING", ep, "proj_seg_api", "t")
    put = await client.put(
        f"/api/episodes/{ep}/script-segments/batch",
        headers=auth_headers,
        json={"script_id": None, "segments": [
            {"segment_order": 0, "source_text": "段一", "estimated_duration_sec": 10},
        ]},
    )
    assert put.status_code == 200
    assert put.json()["success"] is True

    got = await client.get(f"/api/episodes/{ep}/script-segments", headers=auth_headers)
    assert got.status_code == 200
    segs = got.json()["segments"]
    assert any(s["source_text"] == "段一" for s in segs)

    # 清理
    await client.delete(f"/api/episodes/{ep}/script-segments", headers=auth_headers)
```

> 此测试走真实库（非事务回滚 fixture），结尾 DELETE 清理；与现有 client 测试风格一致。

- [ ] **Step 4: 运行测试**

Run: `python -m pytest tests/test_dao_episode_script_segment.py -v`
Expected: 全部 passed（DAO 3 + API 1）

- [ ] **Step 5: 验证后端能 import（无语法错误）**

Run: `python -c "import api_routes; print('ok')"`
Expected: `ok`（Windows 控制台若有 GBK emoji 日志报错可忽略，只要最后打印 ok）

- [ ] **Step 6: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add api_routes.py deploy/api_routes.py tests/test_dao_episode_script_segment.py
git commit -m "feat(api): script-segments CRUD endpoints"
```

---

## Task 5: 前端类型

**Files:**
- Modify: `new_html/types.ts:21-85`（`StoryboardItem` 与 `ProjectFile` 之间/之内插入）

- [ ] **Step 1: 在 `new_html/types.ts` 的 `StoryboardItem` 接口内追加 5 个可选字段**

在 `StoryboardItem` 接口（`new_html/types.ts:21-61`）的 `generatedImage?: string;` 之前插入：

```ts
  // 🆕 2026-05-29 三步生成链路字段
  scriptSegmentId?: string;     // 来自哪个剧本分段 → storyboard_items.script_segment_id
  sourceVideoShotNo?: string;   // Stage 2 镜头号 → source_video_shot_no
  videoScriptBlock?: string;    // Stage 2 单镜头完整视频脚本块 → video_script_block
  shotSize?: string;            // Stage 3 景别 → shot_size
  cameraAngle?: string;         // Stage 3 拍摄角度 → camera_angle
```

- [ ] **Step 2: 在 `ProjectFile` 接口（`new_html/types.ts:74-85`）追加运行态字段**

在 `versions: FileVersion[];` 之后、闭合 `}` 之前插入：

```ts
  // 🆕 2026-05-29 三步生成运行态（持久化以 API segments/storyboard rows 为准）
  scriptSegments?: ScriptSegment[];
  generationStages?: {
    split?: ScriptGenerationStageState;
    videoScript?: ScriptGenerationStageState;
    storyboardPrompt?: ScriptGenerationStageState;
  };
```

- [ ] **Step 3: 在 `new_html/types.ts` 的 `StoryboardData` 接口之后追加新接口**

在 `export interface StoryboardData {...}`（约 63-65 行）之后插入：

```ts
// 🆕 2026-05-29 三步生成相关类型

export type ScriptStageStatus = 'idle' | 'running' | 'done' | 'error';

export interface ScriptGenerationStageState {
  status: ScriptStageStatus;
  total?: number;
  completed?: number;
  errorMessage?: string;
  updatedAt?: number;
}

export interface ScriptSegment {
  id: string;
  order: number;
  sourceText: string;
  estimatedDurationSec: number | null;
  videoScript?: string;
  status?: 'pending' | 'running' | 'done' | 'error';
  errorMessage?: string;
}

/** parseVideoScriptBlocks 输出：Stage 2 视频脚本里的单个镜头块 */
export interface VideoScriptBlock {
  shotNo: string;            // 规范化为 "镜头1"
  durationSec: number | null;
  rawBlock: string;          // 该镜头完整文本块
}

/** parseStoryboardPromptExtractions 输出元素：Stage 3 单个「镜头号」块的提取结果 */
export interface ExtractedStoryboardPrompt {
  shotNo: string;            // "镜头1"
  shotSize: string;          // 景别
  sceneDescription: string;  // 画面描述
  imagePrompt: string;       // 分镜生成提示词
  cameraAngle: string;       // 拍摄角度
  cameraMove: string;        // 运镜方式
  dialogue: string;          // 台词（"无" → ''）
  durationSec: number | null;
}
```

- [ ] **Step 4: 类型检查**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无新增错误（若仓库本身已有历史 tsc 报错，确认本次未新增与 types.ts 相关的错误）

- [ ] **Step 5: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/types.ts deploy/new_html/types.ts
git commit -m "feat(types): ScriptSegment + pipeline types for three-stage generation"
```

---

## Task 6: 前端 segments API 客户端

**Files:**
- Modify: `new_html/services/apiService.ts`（在 `deleteEpisodeScript`（约 905 行）之后）

- [ ] **Step 1: 在 `new_html/services/apiService.ts` 的多文件剧本 API 段末尾追加 3 个函数**

在 `export async function deleteEpisodeScript(...) {...}` 之后插入：

```ts
// ===== 剧本分段 APIs（2026-05-29 三步生成 Stage 1）=====

export async function listEpisodeScriptSegments(episodeId: string, scriptId?: string) {
    const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments${qs}`, {
        headers: getHeaders()
    });
    return handleResponse(response, 'listEpisodeScriptSegments');
}

export async function batchSaveScriptSegments(episodeId: string, scriptId: string | null, segments: any[]) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments/batch`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ script_id: scriptId, segments })
    });
    return handleResponse(response, 'batchSaveScriptSegments');
}

export async function deleteScriptSegments(episodeId: string, scriptId?: string) {
    const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/script-segments${qs}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response, 'deleteScriptSegments');
}
```

- [ ] **Step 2: 类型检查**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/services/apiService.ts deploy/new_html/services/apiService.ts
git commit -m "feat(api-client): episode script-segments endpoints"
```

---

## Task 7: AI Prompt Templates

**Files:**
- Create: `new_html/prompts/scriptPipelinePrompts.ts`
- Modify: `new_html/prompts/index.ts:31`（加 `export *`）

> Prompt 正文来自仓库根目录三个 docx（`剧本拆分标准.docx` / `剧本转视频脚本（5.26）.docx` / `视频脚本提取分镜.docx`）。下面已内置抽取后的正文，并在末尾追加 `{input}` 占位符 + 输出分隔约束，使 parser 可确定性解析。

- [ ] **Step 1: 创建 `new_html/prompts/scriptPipelinePrompts.ts`**

```ts
/**
 * 三步生成链路提示词（2026-05-29）
 * 来源：剧本拆分标准.docx / 剧本转视频脚本（5.26）.docx / 视频脚本提取分镜.docx
 *
 * 约定：占位符 {originalContent} / {segmentText} / {videoShotBlock} 会被 fillPrompt 替换。
 */
import type { PromptTemplate } from './scriptPrompts';

/** Stage 1：把剧本按情绪单元拆成 4-15 秒原文段落 */
export const SPLIT_SCRIPT_INTO_SEGMENTS: PromptTemplate = {
  system: `你是一个剧本拆分工具。你的唯一任务是将给定的短剧剧本按规则拆分成多个段落。你必须严格遵守规则，不允许任何形式的创作、修改或解释。`,
  user: `# 剧本拆分标准

## 绝对规则（违反即错误）
1. 100%原文摘抄。不允许增删改任何一个字，不允许润色、缩句、改写、补充内容。
2. 每个段落的时长必须为正整数，且必须满足：4 ≤ 时长 ≤ 15。
3. 尽量靠近15秒。在保证情绪闭环的前提下，通过合并相邻段落撑满上限。14-15秒的段落应占30%以上，平均时长应≥10秒。
4. 全覆盖。所有段落拼接后必须完全等于原剧本，无遗漏、无重复。
5. 不解释、不评论。只输出拆分结果。

## 拆分逻辑

### 锚点类型定义
- **信息增量**：一个改变当前局势的关键信息被完整抛出。
- **动作冲突**：一个包含“起势→爆发→结果反馈”的完整动作回合结束。
- **情绪翻转**：人物情绪或关系地位发生明显转变。
- **视觉奇观**：用画面或BGM集中渲染的高光时刻结束。
- **悬念断崖**：问题被抛出但答案悬置，或发生场景/时空切换。

### 情绪单元边界判断
当一个情绪单元完整结束时（即上述任一锚点被触发），可以考虑在此处划分段落。

## 执行步骤（必须按顺序）

### 步骤1：初判段落边界
通读剧本，标出所有情绪单元结束的位置，得到初始段落。

### 步骤2：估算每个初始段落的自然时长
对每个初判段落，估算其情绪自然时长。判断标准：以正常语速朗读台词+动作描述在脑中过一遍的时间。


### 步骤3：合并优化（核心步骤）
对每个不足10秒的段落，检查是否可与下一段落合并。合并条件：
- 同一场景内，情绪未发生明显。
- 同一人物连续对话。
- 动作与后续反应属于同一事件链条。

**禁止合并的情况**（即使段落很短）：
- 场景切换（场号或地点改变）。
- 情绪发生180度翻转。
- 信息冲击力极强、单独成段效果更好的关键时刻。

合并后重新计算时长，确保在4-15秒内。优先使段落时长达到13-15秒。

### 步骤4：最终检查
- 每个段落时长是否为4-15之间的整数？
- 是否所有原文都被保留且无修改？
- 平均时长是否≥10秒？
- 是否有连续多个低于8秒的段落？如果有，重新审视合并。
- 14-15秒段落占比是否达到30%以上？

### 步骤5：输出
按指定格式输出。

## 输出格式（严格遵守）
- 每个段落输出：原文段落（逐字摘抄，可多行），最后单独一行写 \`时长：N秒\`。
- 段落之间用单独一行 \`---\` 分隔。
- 不要输出任何额外说明、编号标题以外的内容。

剧本如下，请按要求输出：
{originalContent}`,
};

/** Stage 2：把单个原文分段转成竖屏视频镜头脚本 */
export const GENERATE_VIDEO_SCRIPT_FROM_SEGMENT: PromptTemplate = {
  system: `你是竖屏AI仿真人短剧的视频脚本导演。严禁篡改、增删原文核心剧情、人物设定、旁白、人物对话。`,
  user: `将下面这一段剧本，拆解整理成适配竖屏（9:16）AI仿真人剧的视频镜头脚本。

时长要求：
时长核算规则：所有时长必须为正整数，不得出现小数；中文说话时长按每秒4个字标准语速计算后向上取整；单镜头动作时长贴合剧本内容表演分配，最低2秒，全部取整数。
计算时长取值规则：说话时长＞动作时长，取说话时长；反之取动作时长。
动作描述要求
肢体细化 + 程度量化
动作需具体到手、腿、头部、肩背等肢体部位，同时补充幅度、速度、力度描述；
示例：缓慢抬手、快速转头、用力蹬地、微微低头
情绪具象化表达：
根据剧情设定，用具体的身体细节表现情绪，替代 “很悲伤”“非常愤怒” 这类抽象词汇。
具体示例参见下：
抽象情绪：悲伤。
外化为动作与细节：低头、肩膀微微颤抖、眼眶泛红、泪水在眼眶里打转但没有落下。
抽象情绪：喜悦
外化为动作与细节：嘴角抑制不住地上扬、眉眼舒展、脚步变得轻快。
抽象情绪：紧张 / 焦虑
外化为动作与细节：频繁地看手表、手指不停敲击桌面、呼吸急促、眼神闪躲、无意识地啃咬指甲。
抽象情绪：愤怒
外化为动作与细节：双拳紧握、下颌线紧绷、胸口剧烈起伏、眼神如刀般锐利、从牙缝里挤出话语。
抽象情绪：释然
外化为动作与细节：长长地舒了一口气、紧绷的肩膀完全放松下来、脸上露出久违的、淡淡的微笑、抬头望向远方。
以上实例仅作参考，具体的身体细节表请根据剧情，具体画面具体分析。
视觉风格：
根据剧本设定整体美术画风与视觉调性，统一画面艺术氛围。
示例：赛博朋克冷蓝紫色调、复古胶片、日系清新
【正向稳定约束】
无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换；角色五官、妆容、发型、服饰全程100%固定不变；人物肢体自然正常，无多手指、无肢体扭曲、无穿模；画面焦点始终锁定核心主体；竖屏主体居中，纵向空间充分利用。
严格遵循：
空间与衔接一致性铁则：同一场景内，所有镜头的摄影机机位、人物朝向、人物与场景的相对位置、光影色调、道具位置必须保持100%一致，prompt中必须重复固定核心参数，严禁出现跳轴、人物瞬移、道具穿帮、光影突变，杜绝模型生成画面跳变。严禁无逻辑跳切，保证画面流畅无割裂，适配模型生成连贯性。 - 对话正反打镜头必须严格遵守180度轴线规则，始终保持人物在画面中的相对位置全程固定，严禁跳轴，避免模型生成人物位置互换、空间错乱。全程固定，严禁跳轴，避免模型生成人物位置互换、空间错乱。
1. 严禁篡改、增删原文核心剧情、人物设定、旁白、人物对话；
2. 原脚本中的时长只做参考，严禁照抄。
3. 单组分镜总时长严禁大于15秒，如出现大于15秒的情况，请把超出的单镜头，另外单独成组。
4. 每组都需要完全独立的【视觉风格】、【正向稳定约束】的描述，禁止出现同上，同第一组等描述。
5. 镜头多组出现时【视觉风格】、【正向稳定约束】不需要注明第几组。在当前组下面表述即可。
6. 每个镜头的场景环境中严禁出现同上、同某个镜头等诸如此类的表述，必须详细描述场景环境。
7.  严禁同一场景内出现跳轴、人物朝向/相对位置突变、道具穿帮、光影色调突变；
8. 镜头运动，必须包含景别、运镜、角度这三个维度。
9. 严禁生成横屏构图，所有镜头必须适配9:16竖屏；
10. 严禁画面描述、静帧提示词、运镜、光影、prompt核心参数出现信息不匹配、前后矛盾；
11.  严禁无意义的运镜，所有运镜必须服务于剧情情绪与叙事，必须使用Seedance 2.0模型原生支持的运镜指令；
12. 严禁旁白、人物对话出现原文没有的内容，严禁单镜头旁白超过30字；
13. 严禁同一场景的镜头穿插其他场景的镜头，必须连续排列；
14. 严禁拆分镜头后出现剧情逻辑断层、画面割裂；
15. 严禁脱离原文核心剧情的二次创作、新增情节；
16. 严禁使用Seedance 2.0模型无法稳定生成的复杂动作、超纲特效指令，避免画面崩坏；
17. 严禁同场景镜头的人物核心设定、场景参数、光影参数出现表述差异，杜绝模型生成变脸/换装/场景跳变。 优化补充权限边界·仅可在以下范围内调整： 1. 原文单句描述无法用1个镜头完整呈现时，可拆分为2-3个连续镜头； 2. 原文剧情出现节奏拖沓、情绪断层、叙事逻辑不顺畅时，可补充不超过2个过渡镜头，补充内容必须服务于原文核心剧情； 3. 原文镜头表达无法凸显冲突、放大情绪时，可调整景别、运镜、构图方式，强化剧情张力；4. 所有优化调整必须以还原原文核心为前提，严禁偏离原文剧情。

输入示例：
1-1 日 外 秦岭上空
人物：卫星，铁鹰，麻雀
△铅灰色浓云压得极低，天地间弥漫着硝烟的焦黄色。三架龙-40 呈楔形编队，贴着秦岭山脊线超音速掠行，鸭翼在气流中微微震颤，机翼划破空气的尖啸盖过地面连绵爆炸声。一号机机身布满弹孔划痕，左尾翼被弹片削去一角，拖着一缕淡黑色黑烟。
△卫星端坐在驾驶舱内。
卫星：一号机报告，
△卫星拇指用力按下通讯键。
卫星：所有装甲目标全部摧毁。
△铁鹰二号机猛地拉杆拉升半米，避开迎面飞来的爆炸碎石，侧头看向下方翻倒的坦克。
铁鹰：干得漂亮！
时长：11秒
…………

输出模板
镜头1
时长（秒）：
画面描述：包含【精准主体+动作细节（包含台词，标注人物+语气+说：）+场景环境】
光影色调：
镜头运动：（必须包含景别、运镜、拍摄角度这三个维度）
画质：（示例：4K，高清，细节丰富，电影质感）
音效：
镜头2
时长（秒）：
画面描述：包含【精准主体+动作细节（包含台词，标注人物+语气+说：）+场景环境】
光影色调：
镜头运动：（必须包含景别、运镜、拍摄角度这三个维度）
画质：（示例：4K，高清，细节丰富，电影质感）
音效：
镜头3
时长（秒）：
画面描述：包含【精准主体+动作细节（包含台词，标注人物+语气+说：）+场景环境】
光影色调：
镜头运动：（必须包含景别、运镜、拍摄角度这三个维度）
画质：（示例：4K，高清，细节丰富，电影质感）
音效：

【视觉风格】（此组画面的视觉风格）
【正向稳定约束】（此组画面的正向稳定约束）
输出示例：
镜头1：
时长（秒）：4
画面描述：三架龙-40战机呈楔形编队，贴着秦岭山脊线超音速掠行，鸭翼在气流中微微震颤，一号机机身布满弹孔划痕，左尾翼被削去一角，拖着一缕淡黑色黑烟。外景，铅灰色浓云压得极低，天地间弥漫着焦黄色硝烟，远处地面连续爆炸，火光闪烁。
光影色调：冷灰主调，低饱和度，浓云透出微弱天光，爆炸暖橙色点缀。
镜头运动：远景，缓慢横移跟拍，保持编队居中，俯视视角。
画质：4K，高清，细节丰富，电影质感。
音效：战机引擎尖啸声，远处闷响爆炸声。
镜头2：
时长（秒）：3
画面描述：卫星端坐一号机驾驶舱内，头戴飞行头盔，氧气面罩遮住半脸，目视前方，眼神沉稳。他嘴唇微启，用平静语气说：“一号机报告，” 舱内仪表散发暗绿光，面罩上反射出跳动的数据光点。窗外灰云翻涌。
光影色调：座舱暗绿仪表光为主，面部半明半暗，冷蓝调。
镜头运动：从卫星中景缓慢推近至近景，平视视角。
画质：4K，高清，面部皮肤纹理、头盔划痕可见，电影质感。
音效：通讯电流声滋滋响，低频引擎振动声。
镜头3：
时长（秒）：2
画面描述：卫星右手拇指，重重用力按下操纵杆侧面的通讯键，指节因用力而泛白。手套磨损痕迹清晰。
光影色调：暗绿仪表光照亮手部，阴影浓重。
镜头运动：微距固定镜头，焦点锁死按键下压瞬间，卫星主观俯视视角。
画质：4K，高清，手套织物纹理清晰，金属按键反光。
音效：按键“咔哒”一声脆响，通讯频道开启的短促“哔”声。

【视觉风格】冷峻战争写实，胶片质感。
【正向稳定约束】无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换；角色五官、妆容、发型、服饰全程100%固定不变；人物肢体自然正常，无多手指、无肢体扭曲、无穿模；画面焦点始终锁定核心主体；竖屏主体居中，纵向空间充分利用

这一段剧本（参考时长仅供参考，严禁照抄）如下：
{segmentText}`,
};

/** Stage 3：从单个视频镜头块提取分镜图片提示词 */
export const EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT: PromptTemplate = {
  system: `你是分镜信息提取工具。把给定的文字分镜脚本拆解、整理、提取关键信息。严禁篡改、增删原文核心剧情、人物设定、旁白、人物对话。`,
  user: `把下面这个视频镜头块，按输出模板提取关键信息。如原文包含模板字段就100%按原文提取；如无该信息写“无”。“分镜生成提示词”这条除外，需按要求生成。

把我提供的文字分镜脚本拆解、整理、提取出我需要的关键信息。
以纯文字形式输出，具体要求如下：
1.	按原脚本画面分割镜头。
2.	严禁篡改、增删原文核心剧情、人物设定、旁白、人物对话。
3.	严禁旁白、人物对话出现原文没有的内容。
4.	如原脚本中，包含下面输出模板中的信息，请100%按原文提取，如无输出模板中的信息，请直接写无。”分镜生成提示词“这条除外，此条需要按模块要求输出。

输入示例：
镜头1
时长（秒）：3
画面描述：外景，铅灰色浓云压得极低，天地间弥漫着焦黄色硝烟。三架龙-40呈楔形编队，贴着秦岭山脊线超音速掠行，鸭翼在气流中微微震颤。一号机机身布满弹孔划痕，左尾翼被弹片削去一角，拖着一缕淡黑色黑烟。机翼尖啸盖过地面连绵爆炸声，远处山谷爆炸火光闪烁。
光影色调：冷灰主调，低饱和度，浓云透微弱天光，爆炸暖橙色点缀。
镜头运动：远景，缓慢横移跟拍，编队居中，俯视视角。
视觉风格：冷峻战争写实，胶片质感。
画质：4K，高清，细节丰富，电影质感。
音效：战机引擎尖啸声，远处闷响爆炸声。
正向稳定约束：无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换；角色五官、妆容、发型、服饰全程100%固定不变；人物肢体自然正常，无多手指、无肢体扭曲、无穿模；画面焦点始终锁定核心主体；竖屏主体居中，纵向空间充分利用。

镜头2
时长（秒）：2
画面描述：卫星端坐一号机驾驶舱内，头戴飞行头盔，氧气面罩遮住半脸，目视前方，眼神沉稳。他嘴唇微启，用平静语气说：“一号机报告，” 舱内仪表散发暗绿光，面罩上反射出跳动的数据光点。窗外灰云翻涌。
光影色调：座舱暗绿仪表光为主，面部半明半暗，冷蓝调。
镜头运动：中景缓慢推近至近景，平视视角。
视觉风格：冷峻战争写实，胶片质感。
画质：4K，高清，面部皮肤纹理、头盔划痕可见，电影质感。
音效：通讯电流声滋滋响，低频引擎振动声。
正向稳定约束：无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换；角色五官、妆容、发型、服饰全程100%固定不变；人物肢体自然正常，无多手指、无肢体扭曲、无穿模；画面焦点始终锁定核心主体；竖屏主体居中，纵向空间充分利用。

镜头3
时长（秒）：2
画面描述：卫星右手拇指，重重用力按下操纵杆侧面的通讯键，指节因用力而泛白。手套磨损痕迹清晰，按键边缘金属反光。
光影色调：暗绿仪表光照亮手部，阴影浓重。
镜头运动：微距固定镜头，焦点锁死按键下压瞬间，卫星主观俯视视角。
视觉风格：冷峻战争写实，胶片质感。
画质：4K，高清，手套织物纹理清晰，金属按键反光。
音效：按键“咔哒”一声脆响，通讯频道开启的短促“哔”声。
正向稳定约束：无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换；角色五官、妆容、发型、服饰全程100%固定不变；人物肢体自然正常，无多手指、无肢体扭曲、无穿模；画面焦点始终锁定核心主体；竖屏主体居中，纵向空间充分利用。

输出示例：
镜头号：1
景别：远景
画面描述：外景，铅灰色浓云压得极低，天地间弥漫着焦黄色硝烟。三架龙-40呈楔形编队，贴着秦岭山脊线超音速掠行，鸭翼在气流中微微震颤。一号机机身布满弹孔划痕，左尾翼被弹片削去一角，拖着一缕淡黑色黑烟。机翼尖啸盖过地面连绵爆炸声，远处山谷爆炸火光闪烁。
分镜生成提示词：远景，俯视角度，三架龙-40战机楔形编队超音速飞行，紧贴秦岭山脊线，一号机左尾翼破损拖出淡黑色黑烟，鸭翼震颤，铅灰色浓云压顶，天地间弥漫焦黄色硝烟，远处山谷爆炸闪烁暖橙色光，冷灰主调，低饱和度，电影光照，胶片质感。
拍摄角度：俯视视角
运镜方式：缓慢横移跟拍
台词：无
时长：3秒

镜头号：2
景别：中景缓慢推近至近景
画面描述：卫星端坐一号机驾驶舱内，头戴飞行头盔，氧气面罩遮住半脸，目视前方，眼神沉稳。他嘴唇微启，用平静语气说：“一号机报告，” 舱内仪表散发暗绿光，面罩上反射出跳动的数据光点。窗外灰云翻涌。
分镜生成提示词：近景，平视角度，卫星端坐驾驶舱内，戴飞行头盔和氧气面罩，眼神沉稳，嘴唇微启，面罩反射暗绿数据光点，舱内仪表散发暗绿光，窗外灰云翻涌，面部半明半暗，冷蓝调，胶片质感。
拍摄角度：平视视角
运镜方式：缓慢推近
台词：卫星（台词）：“一号机报告，”
时长：2秒

镜头号：3
景别：微距
画面描述：卫星右手拇指，重重用力按下操纵杆侧面的通讯键，指节因用力而泛白。手套磨损痕迹清晰，按键边缘金属反光。
分镜生成提示词：微距，主观俯视角度，右手拇指用力按下操纵杆侧面通讯键，指节泛白，手套有明显磨损痕迹，按键边缘金属反光，暗绿仪表光照亮手部，阴影浓重。
拍摄角度：卫星主观俯视视角
运镜方式：固定镜头
台词：无
时长：2秒

输出模板：
镜头号：1
景别：
画面描述：详细描述这个镜头里会看到什么，包括角色动作、表情、关键道具、环境细节。
分镜生成提示词：用于AI 生成分镜图片的提示词【含景别（只需要景别不要运镜）、角度、主体、动作、环境、光影 】
拍摄角度：
运镜方式：
台词：角色（台词/OS/OV）：
时长：
镜头号2
景别：
画面描述：详细描述这个镜头里会看到什么，包括角色动作、表情、关键道具、环境细节。
分镜生成提示词：用于AI 生成分镜图片的提示词【含景别（只需要景别不要运镜）、角度、主体、动作、环境、光影 】
拍摄角度：
运镜方式：
台词：角色（台词/OS/OV）：
时长：

镜头号3
景别：
画面描述：详细描述这个镜头里会看到什么，包括角色动作、表情、关键道具、环境细节。
分镜生成提示词：用于AI 生成分镜图片的提示词【含景别（只需要景别不要运镜）、角度、主体、动作、环境、光影 】
拍摄角度：
运镜方式：
台词：角色（台词/OS/OV）：
时长：

需要转写的镜头如下：
{videoShotBlock}`,
};
```

- [ ] **Step 2: 在 `new_html/prompts/index.ts` 追加导出**

在 `export * from './imagePrompts';`（第 31 行）之后插入：

```ts
// 三步生成链路提示词（2026-05-29）
export * from './scriptPipelinePrompts';
```

- [ ] **Step 3: 类型检查**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/prompts/scriptPipelinePrompts.ts new_html/prompts/index.ts \
        deploy/new_html/prompts/scriptPipelinePrompts.ts deploy/new_html/prompts/index.ts
git commit -m "feat(prompts): three-stage script pipeline prompt templates"
```

---

## Task 8: Parser 纯函数（TDD）

**Files:**
- Create: `new_html/utils/scriptPipelineParsers.ts`
- Test: `new_html/__tests__/utils/scriptPipelineParsers.test.ts`

- [ ] **Step 1: 写失败测试 `new_html/__tests__/utils/scriptPipelineParsers.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
    parseScriptSegments,
    parseVideoScriptBlocks,
    parseStoryboardPromptExtractions,
} from '../../utils/scriptPipelineParsers';

describe('parseScriptSegments', () => {
    it('splits on --- and reads 时长：N秒', () => {
        const text = [
            '1-1 日 外 浅浅家门口',
            '浅浅：哟，陆帅哥来啦。',
            '时长：5秒',
            '---',
            '1-2 日 内 浅浅家',
            '陆一航：脱衣服吧，我赶时间。',
            '时长：11秒',
        ].join('\n');
        const segs = parseScriptSegments(text);
        expect(segs).toHaveLength(2);
        expect(segs[0].order).toBe(0);
        expect(segs[0].estimatedDurationSec).toBe(5);
        expect(segs[0].sourceText).toContain('浅浅家门口');
        expect(segs[0].sourceText).not.toContain('时长');
        expect(segs[1].estimatedDurationSec).toBe(11);
    });

    it('sets estimatedDurationSec=null when 时长 missing', () => {
        const segs = parseScriptSegments('某段原文没有时长\n---\n另一段\n时长：8秒');
        expect(segs[0].estimatedDurationSec).toBeNull();
        expect(segs[1].estimatedDurationSec).toBe(8);
    });

    it('falls back to blank-line blocks when no --- present', () => {
        const text = '段一第一行\n时长：6秒\n\n段二第一行\n时长：7秒';
        const segs = parseScriptSegments(text);
        expect(segs).toHaveLength(2);
        expect(segs[0].estimatedDurationSec).toBe(6);
    });

    it('does not crash on empty input', () => {
        expect(parseScriptSegments('')).toEqual([]);
    });

    it('concatenated sourceText covers input body (minus 时长 lines)', () => {
        const text = 'A行1\nA行2\n时长：5秒\n---\nB行1\n时长：9秒';
        const segs = parseScriptSegments(text);
        const joined = segs.map(s => s.sourceText).join('\n');
        expect(joined).toContain('A行1');
        expect(joined).toContain('A行2');
        expect(joined).toContain('B行1');
    });
});

describe('parseVideoScriptBlocks', () => {
    const sample = [
        '镜头1',
        '时长（秒）：4',
        '画面描述：三架战机编队。',
        '镜头运动：远景，缓慢横移跟拍，俯视视角。',
        '镜头2：',
        '时长（秒）：3',
        '画面描述：卫星端坐驾驶舱。',
        '镜头 3',
        '时长（秒）：2',
        '画面描述：拇指按下通讯键。',
    ].join('\n');

    it('splits multiple 镜头N (with/without colon/space)', () => {
        const blocks = parseVideoScriptBlocks(sample);
        expect(blocks).toHaveLength(3);
        expect(blocks[0].shotNo).toBe('镜头1');
        expect(blocks[1].shotNo).toBe('镜头2');
        expect(blocks[2].shotNo).toBe('镜头3');
    });

    it('keeps the full block text', () => {
        const blocks = parseVideoScriptBlocks(sample);
        expect(blocks[0].rawBlock).toContain('画面描述：三架战机编队');
        expect(blocks[0].rawBlock).toContain('镜头运动：远景');
    });

    it('parses 时长（秒）：N', () => {
        const blocks = parseVideoScriptBlocks(sample);
        expect(blocks[0].durationSec).toBe(4);
        expect(blocks[2].durationSec).toBe(2);
    });

    it('returns [] for empty', () => {
        expect(parseVideoScriptBlocks('')).toEqual([]);
    });
});

describe('parseStoryboardPromptExtractions', () => {
    const shot = [
        '镜头号：2',
        '景别：近景',
        '画面描述：卫星端坐驾驶舱内，眼神沉稳。',
        '分镜生成提示词：近景，平视角度，卫星端坐驾驶舱，冷蓝调，胶片质感。',
        '拍摄角度：平视视角',
        '运镜方式：缓慢推近',
        '台词：卫星（台词）：“一号机报告，”',
        '时长：2秒',
    ].join('\n');

    it('parses a single 镜头号 block into a 1-element array', () => {
        const list = parseStoryboardPromptExtractions(shot);
        expect(list).toHaveLength(1);
        const r = list[0];
        expect(r.shotNo).toBe('镜头2');
        expect(r.shotSize).toBe('近景');
        expect(r.sceneDescription).toContain('眼神沉稳');
        expect(r.imagePrompt).toContain('冷蓝调');
        expect(r.cameraAngle).toBe('平视视角');
        expect(r.cameraMove).toBe('缓慢推近');
        expect(r.dialogue).toContain('一号机报告');
        expect(r.durationSec).toBe(2);
    });

    it('splits one video shot into multiple finer 镜头号 blocks', () => {
        const multi = [
            '镜头号：1', '景别：远景', '画面描述：A画面。',
            '分镜生成提示词：PA', '拍摄角度：俯视视角', '运镜方式：横移', '台词：无', '时长：3秒',
            '镜头号：2', '景别：近景', '画面描述：B画面。',
            '分镜生成提示词：PB', '拍摄角度：平视视角', '运镜方式：推近', '台词：卫星（台词）：“走”', '时长：2秒',
        ].join('\n');
        const list = parseStoryboardPromptExtractions(multi);
        expect(list).toHaveLength(2);
        expect(list[0].shotNo).toBe('镜头1');
        expect(list[0].imagePrompt).toBe('PA');
        expect(list[1].shotNo).toBe('镜头2');
        expect(list[1].dialogue).toContain('走');
    });

    it('converts 台词：无 to empty string', () => {
        const list = parseStoryboardPromptExtractions('镜头号：1\n景别：远景\n分镜生成提示词：P\n台词：无\n时长：3秒');
        expect(list).toHaveLength(1);
        expect(list[0].dialogue).toBe('');
    });

    it('handles multi-line 画面描述', () => {
        const list = parseStoryboardPromptExtractions(
            '镜头号：1\n画面描述：第一行。\n第二行继续。\n景别：远景\n分镜生成提示词：P'
        );
        expect(list[0].sceneDescription).toContain('第一行');
        expect(list[0].sceneDescription).toContain('第二行继续');
    });

    it('returns [] for empty', () => {
        expect(parseStoryboardPromptExtractions('')).toEqual([]);
    });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd new_html && npx vitest run __tests__/utils/scriptPipelineParsers.test.ts`
Expected: FAIL，无法 import `scriptPipelineParsers`

- [ ] **Step 3: 实现 `new_html/utils/scriptPipelineParsers.ts`**

```ts
/**
 * 三步生成链路 parser（纯函数，无副作用，可单测）
 * 2026-05-29
 */
import type { ScriptSegment, VideoScriptBlock, ExtractedStoryboardPrompt } from '../types';

let _segCounter = 0;
function segLocalId(): string {
    _segCounter += 1;
    return `seg_local_${Date.now().toString(36)}_${_segCounter}`;
}

/** 从一行里解析 时长：N秒 / 时长（秒）：N，取第一个正整数，找不到返回 null */
function parseDurationSec(line: string): number | null {
    const m = line.match(/时长[（(]?秒?[)）]?\s*[:：]\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    return null;
}

/**
 * Stage 1 输出 → ScriptSegment[]
 * 优先按单独一行 --- 切块；若无 ---，按空行分块。每块末尾的 时长 行被剥离。
 */
export function parseScriptSegments(text: string): ScriptSegment[] {
    if (!text || !text.trim()) return [];

    let blocks: string[];
    if (/^\s*---\s*$/m.test(text)) {
        blocks = text.split(/^\s*---\s*$/m);
    } else {
        blocks = text.split(/\n\s*\n/);
    }

    const segments: ScriptSegment[] = [];
    for (const raw of blocks) {
        const lines = raw.split('\n');
        let durationSec: number | null = null;
        const kept: string[] = [];
        for (const line of lines) {
            const d = parseDurationSec(line);
            if (d !== null && /时长/.test(line)) {
                durationSec = d;
                continue; // 剥离时长行
            }
            kept.push(line);
        }
        const sourceText = kept.join('\n').trim();
        if (!sourceText) continue;
        segments.push({
            id: segLocalId(),
            order: segments.length,
            sourceText,
            estimatedDurationSec: durationSec,
            status: 'done',
        });
    }
    return segments;
}

/** 把 "镜头1" / "镜头 1" / "镜头1：" 规范化成 "镜头1"；非镜头头返回 null */
function normalizeShotHeader(line: string): string | null {
    const m = line.match(/^\s*镜头\s*(\d+)\s*[:：]?\s*$/);
    if (m) return `镜头${m[1]}`;
    // 行内带内容的也允许（如 "镜头1：xxx"），但 Stage 2 模板镜头号独占一行
    const m2 = line.match(/^\s*镜头\s*(\d+)\s*[:：]/);
    if (m2) return `镜头${m2[1]}`;
    return null;
}

/**
 * Stage 2 输出 → VideoScriptBlock[]
 * 以 "镜头N" 行作为块起点，块内找 时长（秒）：N。
 */
export function parseVideoScriptBlocks(text: string): VideoScriptBlock[] {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const blocks: VideoScriptBlock[] = [];
    let current: { shotNo: string; lines: string[] } | null = null;

    const flush = () => {
        if (!current) return;
        const rawBlock = current.lines.join('\n').trim();
        let durationSec: number | null = null;
        for (const l of current.lines) {
            const d = parseDurationSec(l);
            if (d !== null && /时长/.test(l)) { durationSec = d; break; }
        }
        blocks.push({ shotNo: current.shotNo, durationSec, rawBlock });
        current = null;
    };

    for (const line of lines) {
        const shotNo = normalizeShotHeader(line);
        if (shotNo) {
            flush();
            current = { shotNo, lines: [line] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    flush();
    return blocks;
}

const STORYBOARD_LABELS: Array<{ key: keyof ExtractedStoryboardPrompt | 'shotNoRaw'; label: RegExp }> = [
    { key: 'shotNoRaw', label: /^镜头号\s*[:：]\s*(.*)$/ },
    { key: 'shotSize', label: /^景别\s*[:：]\s*(.*)$/ },
    { key: 'sceneDescription', label: /^画面描述\s*[:：]\s*(.*)$/ },
    { key: 'imagePrompt', label: /^分镜生成提示词\s*[:：]\s*(.*)$/ },
    { key: 'cameraAngle', label: /^拍摄角度\s*[:：]\s*(.*)$/ },
    { key: 'cameraMove', label: /^运镜方式\s*[:：]\s*(.*)$/ },
    { key: 'dialogue', label: /^台词\s*[:：]\s*(.*)$/ },
];

/**
 * 解析单个「镜头号」块 → ExtractedStoryboardPrompt（内部 helper）
 * 逐行解析；遇到已知 label 行开始新字段，后续非 label 行追加到当前字段（支持多行画面描述）。
 */
function parseOneStoryboardBlock(text: string): ExtractedStoryboardPrompt {
    const result: ExtractedStoryboardPrompt = {
        shotNo: '', shotSize: '', sceneDescription: '', imagePrompt: '',
        cameraAngle: '', cameraMove: '', dialogue: '', durationSec: null,
    };
    if (!text) return result;

    const lines = text.split('\n');
    let currentKey: keyof ExtractedStoryboardPrompt | 'shotNoRaw' | null = null;
    const buf: Record<string, string[]> = {};

    const matchLabel = (line: string) => {
        for (const { key, label } of STORYBOARD_LABELS) {
            const m = line.match(label);
            if (m) return { key, rest: m[1] ?? '' };
        }
        return null;
    };

    for (const line of lines) {
        const dur = line.match(/^时长\s*[:：]\s*(\d+)/);
        if (dur) { result.durationSec = parseInt(dur[1], 10); currentKey = null; continue; }

        const hit = matchLabel(line);
        if (hit) {
            currentKey = hit.key;
            buf[currentKey] = [hit.rest];
        } else if (currentKey) {
            buf[currentKey].push(line);
        }
    }

    const take = (k: string) => (buf[k] ? buf[k].join('\n').trim() : '');
    const shotNoRaw = take('shotNoRaw').replace(/[^\d]/g, '');
    result.shotNo = shotNoRaw ? `镜头${shotNoRaw}` : '';
    result.shotSize = take('shotSize');
    result.sceneDescription = take('sceneDescription');
    result.imagePrompt = take('imagePrompt');
    result.cameraAngle = take('cameraAngle');
    result.cameraMove = take('cameraMove');
    const dialogue = take('dialogue');
    result.dialogue = dialogue.trim() === '无' ? '' : dialogue;
    return result;
}

/**
 * Stage 3 输出 → ExtractedStoryboardPrompt[]
 * 单次只转写「一个视频镜头」，但 AI 可把它拆成多个「镜头号」块（更细的分镜）。
 * 按行首「镜头号」切块，每块单独解析；若整段没有任何「镜头号」则兜底为一个块。
 */
export function parseStoryboardPromptExtractions(text: string): ExtractedStoryboardPrompt[] {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const rawBlocks: string[] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        if (/^\s*镜头号/.test(line)) {
            if (current) rawBlocks.push(current.join('\n'));
            current = [line];
        } else if (current) {
            current.push(line);
        }
    }
    if (current) rawBlocks.push(current.join('\n'));

    if (rawBlocks.length === 0) {
        const single = parseOneStoryboardBlock(text);
        return (single.imagePrompt || single.sceneDescription || single.shotSize) ? [single] : [];
    }
    return rawBlocks
        .map(parseOneStoryboardBlock)
        .filter(b => b.imagePrompt || b.sceneDescription || b.shotSize);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd new_html && npx vitest run __tests__/utils/scriptPipelineParsers.test.ts`
Expected: 全部 passed（3 个 describe，共 14 个 it）

- [ ] **Step 5: 提交（测试不镜像；parser 本体镜像）**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/utils/scriptPipelineParsers.ts deploy/new_html/utils/scriptPipelineParsers.ts \
        new_html/__tests__/utils/scriptPipelineParsers.test.ts
git commit -m "feat(parsers): script pipeline parsers with unit tests"
```

---

## Task 9: AI service 函数

**Files:**
- Modify: `new_html/services/aiModelService.ts`（在 `aiExtractShotsFromScript`（约 124 行）之后）

- [ ] **Step 1: 在 `new_html/services/aiModelService.ts` 顶部确认 import**

文件已有 `import { AiModel } from '../types';` 与 `import { callAI } from './aiService';` 与 `import * as PROMPTS from '../prompts';`。追加 parser + 类型 import（在现有 import 之后）：

```ts
import type { ScriptSegment, ExtractedStoryboardPrompt } from '../types';
import { parseScriptSegments, parseStoryboardPromptExtractions } from '../utils/scriptPipelineParsers';
```

- [ ] **Step 2: 在 `aiExtractShotsFromScript` 之后追加三个 stage 函数**

```ts
// ===== 2026-05-29 三步生成链路 =====

/** Stage 1：拆分剧本为原文分段 */
export const aiSplitScriptIntoSegments = async (
  model: AiModel,
  originalContent: string,
  onStream?: (chunk: string) => void,
): Promise<ScriptSegment[]> => {
  const raw = await callAI(
    model,
    PROMPTS.SPLIT_SCRIPT_INTO_SEGMENTS,
    { originalContent },
    onStream,
  );
  return parseScriptSegments(raw);
};

/** Stage 2：把单个分段转成视频镜头脚本（返回原始文本，由调用方追加 + parseVideoScriptBlocks） */
export const aiGenerateVideoScriptFromSegment = async (
  model: AiModel,
  segment: ScriptSegment,
  onStream?: (chunk: string) => void,
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.GENERATE_VIDEO_SCRIPT_FROM_SEGMENT,
    { segmentText: segment.sourceText },
    onStream,
  );
};

/**
 * Stage 3：从单个视频镜头块提取分镜提示词。
 * 单次只喂一个视频镜头，但 AI 可把它拆成多个「镜头号」块（更细的分镜）→ 返回数组。
 */
export const aiExtractStoryboardPromptFromVideoShot = async (
  model: AiModel,
  videoShotBlock: string,
): Promise<ExtractedStoryboardPrompt[]> => {
  const raw = await callAI(
    model,
    PROMPTS.EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT,
    { videoShotBlock },
  );
  return parseStoryboardPromptExtractions(raw);
};
```

- [ ] **Step 3: 类型检查**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/services/aiModelService.ts deploy/new_html/services/aiModelService.ts
git commit -m "feat(ai): three-stage pipeline service functions"
```

---

## Task 10: `WorkspaceApp.loadEpisodeData` 加载 segments

**Files:**
- Modify: `new_html/WorkspaceApp.tsx:24`（import）、`new_html/WorkspaceApp.tsx:183-271`（`loadEpisodeData`）

- [ ] **Step 1: 在 `WorkspaceApp.tsx` 的 apiService import（第 24 行）追加 segments 函数**

把第 24 行 import 末尾的 `} from './services/apiService';` 前补充：

```ts
, listEpisodeScriptSegments, batchSaveScriptSegments
```

即该行变为 `import { ...existing..., listEpisodeScriptSegments, batchSaveScriptSegments } from './services/apiService';`。同时确认 `ScriptSegment` 类型已从 types 引入（文件顶部 types import 处追加 `ScriptSegment`）。

- [ ] **Step 2: 在 `loadEpisodeData` 的并发加载（第 187-190 行）加入 segments 请求**

把：

```ts
      const [scriptsRes, sbRes] = await Promise.all([
        listEpisodeScripts(propEpisodeId).catch(() => ({ success: false, scripts: [] })),
        getStoryboardItems(propEpisodeId).catch(() => ({ success: false, items: [] })),
      ]);
```

改为：

```ts
      const [scriptsRes, sbRes, segRes] = await Promise.all([
        listEpisodeScripts(propEpisodeId).catch(() => ({ success: false, scripts: [] })),
        getStoryboardItems(propEpisodeId).catch(() => ({ success: false, items: [] })),
        listEpisodeScriptSegments(propEpisodeId).catch(() => ({ success: false, segments: [] })),
      ]);
```

- [ ] **Step 3: 在 `loadEpisodeData` 内、`itemsByScript` 分组之后，按 script_id 分组 segments**

在第 200 行（`itemsByScript` 的 for 循环结束后）追加：

```ts
      const allSegments: any[] = segRes.success ? (segRes.segments || []) : [];
      const segsByScript = new Map<string | null, ScriptSegment[]>();
      for (const r of allSegments) {
        const sid = r.script_id ?? r.scriptId ?? null;
        if (!segsByScript.has(sid)) segsByScript.set(sid, []);
        segsByScript.get(sid)!.push({
          id: r.segment_id ?? r.segmentId,
          order: r.segment_order ?? r.segmentOrder ?? 0,
          sourceText: r.source_text ?? r.sourceText ?? '',
          estimatedDurationSec: r.estimated_duration_sec ?? r.estimatedDurationSec ?? null,
          videoScript: r.video_script ?? r.videoScript ?? '',
          status: r.status ?? 'done',
          errorMessage: r.error_message ?? r.errorMessage ?? '',
        });
      }
      for (const list of segsByScript.values()) {
        list.sort((a, b) => a.order - b.order);
      }
```

- [ ] **Step 4: 在 `scripts.length > 0` 分支构建 file 时，挂上 scriptSegments（第 231-242 行 `const file: ProjectFile = {...}`）**

在该对象字面量里 `versions: [],` 之后追加：

```ts
            scriptSegments: segsByScript.get(sid) || (idx === 0 ? (segsByScript.get(null) || []) : []),
```

- [ ] **Step 5: 在 `else`（无 scripts）分支构建 file 时也挂 segments（第 259-270 行）**

在该对象字面量 `versions: [],` 之后追加：

```ts
          scriptSegments: segsByScript.get(newId) || segsByScript.get(null) || [],
```

- [ ] **Step 6: 类型检查 + 现有 WorkspaceApp 相关测试**

Run: `cd new_html && npx tsc --noEmit && npx vitest run __tests__/contexts/EpisodeContext.test.tsx`
Expected: tsc 无新增错误；现有测试仍 passed

- [ ] **Step 7: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/WorkspaceApp.tsx deploy/new_html/WorkspaceApp.tsx
git commit -m "feat(workspace): load episode script segments on init"
```

---

## Task 11: `WorkspaceApp.saveEpisodeToBackend` 保存 segments + 新 storyboard 字段

**Files:**
- Modify: `new_html/WorkspaceApp.tsx:291-350`（`saveEpisodeToBackend`）

- [ ] **Step 1: 在 dbItems 映射（第 314-327 行）补充 5 个新字段**

把 `dbItems` 的 `.map(...)` 返回对象里追加（在 `bound_assets: [...]` 之后）：

```ts
          script_segment_id: item.scriptSegmentId || null,
          source_video_shot_no: item.sourceVideoShotNo || '',
          video_script_block: item.videoScriptBlock || '',
          shot_size: item.shotSize || '',
          camera_angle: item.cameraAngle || '',
```

- [ ] **Step 2: 在 `saveEpisodeToBackend` 的「保存 episode_scripts」循环之后、storyboard 循环之前，新增 segments 保存循环**

在第 304 行（第一个 `for (const file of files)` 保存 scripts 的循环结束 `}` 之后）插入：

```ts
      // 2026-05-29 保存剧本分段（Stage 1 产物）
      for (const file of files) {
        if (!file.id || file.id.startsWith('local_')) continue;
        if (!file.scriptSegments || file.scriptSegments.length === 0) continue;
        const segPayload = file.scriptSegments.map((s, idx) => ({
          segment_id: s.id && !s.id.startsWith('seg_local_') ? s.id : undefined,
          segment_order: idx,
          source_text: s.sourceText || '',
          estimated_duration_sec: s.estimatedDurationSec ?? null,
          video_script: s.videoScript || '',
          status: s.status || 'done',
          error_message: s.errorMessage || '',
        }));
        await batchSaveScriptSegments(propEpisodeId, file.id, segPayload).catch(err =>
          console.warn(`保存分段失败 (${file.id}):`, err)
        );
      }
```

- [ ] **Step 3: 类型检查**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/WorkspaceApp.tsx deploy/new_html/WorkspaceApp.tsx
git commit -m "feat(workspace): persist script segments + storyboard pipeline fields on save"
```

---

## Task 12: 三阶段 handler + pipeline

**Files:**
- Modify: `new_html/WorkspaceApp.tsx`（在 `handleExtractShots`（约 1746 行）之后新增）
- Modify: `new_html/WorkspaceApp.tsx:21`（import aiModelService 三个函数）

- [ ] **Step 1: 扩 `WorkspaceApp.tsx:21` 的 aiModelService import**

第 21 行 import 追加：

```ts
, aiSplitScriptIntoSegments, aiGenerateVideoScriptFromSegment, aiExtractStoryboardPromptFromVideoShot
```

同时在文件顶部 import 处确认引入 `parseVideoScriptBlocks`：

```ts
import { parseVideoScriptBlocks } from './utils/scriptPipelineParsers';
```

- [ ] **Step 2: 新增一个 setStage 辅助 + 三个 handler（在 `handleExtractShots` 之后插入）**

```ts
  // ===== 2026-05-29 三步生成链路 =====

  const setStage = useCallback((
    fileId: string,
    stage: 'split' | 'videoScript' | 'storyboardPrompt',
    patch: Partial<import('./types').ScriptGenerationStageState>,
  ) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f;
      const stages = { ...(f.generationStages || {}) };
      stages[stage] = { status: 'idle', ...(stages[stage] || {}), ...patch, updatedAt: Date.now() };
      return { ...f, generationStages: stages };
    }));
  }, []);

  /** Stage 1：拆分剧本 */
  const handleSplitScript = useCallback(async (targetFileId?: string) => {
    const file = files.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    if (!file.originalContent?.trim()) { alert('请先在左栏粘贴原文文案'); return; }

    setStage(file.id, 'split', { status: 'running', errorMessage: '' });
    try {
      const segments = await aiSplitScriptIntoSegments(aiModel, file.originalContent);
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, scriptSegments: segments } : f));
      setStage(file.id, 'split', { status: 'done', total: segments.length, completed: segments.length });
      await batchSaveScriptSegments(propEpisodeId!, file.id, segments.map((s, idx) => ({
        segment_order: idx, source_text: s.sourceText,
        estimated_duration_sec: s.estimatedDurationSec, status: 'done',
      }))).catch(e => console.warn('保存分段失败:', e));
    } catch (e) {
      setStage(file.id, 'split', { status: 'error', errorMessage: (e as Error).message });
      alert(`拆分剧本失败: ${(e as Error).message}`);
    }
  }, [files, selectedFileId, aiModel, propEpisodeId, setStage]);

  /** Stage 2：逐段生成视频脚本，按 order 追加到 scriptContent */
  const handleGenerateVideoScript = useCallback(async (targetFileId?: string) => {
    const file = files.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    const segs = file.scriptSegments || [];
    if (segs.length === 0) { alert('请先拆分剧本'); return; }

    setStage(file.id, 'videoScript', { status: 'running', total: segs.length, completed: 0, errorMessage: '' });
    const ordered = [...segs].sort((a, b) => a.order - b.order);
    const updated: ScriptSegment[] = [...ordered];
    let completed = 0;
    try {
      for (let i = 0; i < ordered.length; i++) {
        const seg = ordered[i];
        if (seg.status === 'done' && seg.videoScript) { completed++; continue; } // 跳过已完成（失败恢复）
        try {
          const text = await aiGenerateVideoScriptFromSegment(aiModel, seg);
          updated[i] = { ...seg, videoScript: text, status: 'done', errorMessage: '' };
          completed++;
          setStage(file.id, 'videoScript', { status: 'running', completed });
        } catch (segErr) {
          updated[i] = { ...seg, status: 'error', errorMessage: (segErr as Error).message };
          setFiles(prev => prev.map(f => f.id === file.id ? { ...f, scriptSegments: updated } : f));
          setStage(file.id, 'videoScript', { status: 'error', completed, errorMessage: `第 ${i + 1} 段失败` });
          return; // 保留已完成，下次从失败段继续
        }
      }
      const fullScript = updated.map(s => s.videoScript || '').filter(Boolean).join('\n\n');
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, scriptSegments: updated, scriptContent: fullScript }
        : f));
      setStage(file.id, 'videoScript', { status: 'done', completed });
      await updateEpisodeScriptById(propEpisodeId!, file.id, { adapted_script: fullScript }).catch(() => {});
      await batchSaveScriptSegments(propEpisodeId!, file.id, updated.map((s, idx) => ({
        segment_order: idx, source_text: s.sourceText,
        estimated_duration_sec: s.estimatedDurationSec,
        video_script: s.videoScript || '', status: s.status || 'done',
      }))).catch(() => {});
    } catch (e) {
      setStage(file.id, 'videoScript', { status: 'error', errorMessage: (e as Error).message });
    }
  }, [files, selectedFileId, aiModel, propEpisodeId, setStage]);

  /** Stage 3：对每个视频镜头块提取分镜提示词 → StoryboardItem[] */
  const handleExtractStoryboardPrompts = useCallback(async (targetFileId?: string) => {
    const file = files.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    const segs = (file.scriptSegments || []).filter(s => s.videoScript);
    if (segs.length === 0) { alert('请先生成视频脚本'); return; }

    // 收集所有镜头块（带 segmentId 关联）
    const shots: Array<{ segmentId: string; block: import('./types').VideoScriptBlock }> = [];
    for (const seg of segs) {
      for (const block of parseVideoScriptBlocks(seg.videoScript!)) {
        shots.push({ segmentId: seg.id, block });
      }
    }
    if (shots.length === 0) { alert('未能从视频脚本解析出镜头'); return; }

    // total = 视频镜头数（AI 调用次数）；一个视频镜头可拆成多个分镜 item
    setStage(file.id, 'storyboardPrompt', { status: 'running', total: shots.length, completed: 0, errorMessage: '' });
    const items: StoryboardItem[] = [];
    for (let i = 0; i < shots.length; i++) {
      const { segmentId, block } = shots[i];
      try {
        // 单个视频镜头 → 一个或多个更细的分镜
        const exList = await aiExtractStoryboardPromptFromVideoShot(aiModel, block.rawBlock);
        for (const ex of exList) {
          items.push({
            id: uuidv4(),
            shotNumber: items.length + 1,
            originalText: ex.sceneDescription || block.rawBlock.slice(0, 80),
            scriptSegment: ex.sceneDescription || '',
            imagePrompt: ex.imagePrompt || '',
            videoPrompt: block.rawBlock,               // Stage 2 单镜头块 → video_prompt（视频页消费）
            dialogue: ex.dialogue || '',
            cameraMovement: [ex.shotSize, ex.cameraAngle, ex.cameraMove].filter(Boolean).join(' / '),
            plannedDurationMs: (ex.durationSec ?? block.durationSec) != null
              ? (ex.durationSec ?? block.durationSec)! * 1000 : null,
            scriptSegmentId: segmentId,
            sourceVideoShotNo: ex.shotNo || block.shotNo,
            videoScriptBlock: block.rawBlock,
            shotSize: ex.shotSize || '',
            cameraAngle: ex.cameraAngle || '',
            timestamp: Date.now(),
          });
        }
        setStage(file.id, 'storyboardPrompt', { status: 'running', completed: i + 1 });
      } catch (shotErr) {
        setFiles(prev => prev.map(f => f.id === file.id
          ? { ...f, storyboard: { items } } : f));
        setStage(file.id, 'storyboardPrompt', { status: 'error', completed: i, errorMessage: `第 ${i + 1} 个镜头失败` });
        return; // 保留已提取
      }
    }
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, storyboard: { items } } : f));
    setStage(file.id, 'storyboardPrompt', { status: 'done', completed: shots.length });
    await saveEpisodeToBackend();
  }, [files, selectedFileId, aiModel, propEpisodeId, setStage, saveEpisodeToBackend]);

  /** 主按钮：按三步顺序执行，从未完成的阶段开始 */
  const handleRunThreeStagePipeline = useCallback(async (targetFileId?: string) => {
    const file = files.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    const hasSegments = (file.scriptSegments?.length || 0) > 0;
    const hasVideoScript = !!file.scriptContent && (file.scriptSegments || []).some(s => s.videoScript);
    const hasStoryboard = (file.storyboard?.items?.length || 0) > 0;

    if (hasSegments && hasVideoScript && hasStoryboard) {
      if (!confirm('三步均已完成，确定要全量重跑吗？')) return;
    }
    if (!hasSegments) await handleSplitScript(file.id);
    await handleGenerateVideoScript(file.id);
    await handleExtractStoryboardPrompts(file.id);
  }, [files, selectedFileId, handleSplitScript, handleGenerateVideoScript, handleExtractStoryboardPrompts]);
```

> 注意：`selectedFileId`、`aiModel`、`setFiles`、`uuidv4`、`updateEpisodeScriptById`、`StoryboardItem` 均为 WorkspaceApp 现有符号（见 `loadEpisodeData` / `saveEpisodeToBackend` / `handleExtractShots`）。若 `selectedFileId` 在本组件实际命名为 `selectedFile?.id`，按现有代码改为 `selectedFile?.id`。

- [ ] **Step 3: 类型检查**

Run: `cd new_html && npx tsc --noEmit`
Expected: 无新增错误（如报 `selectedFileId` 未定义，改用现有的 `selectedFile?.id`）

- [ ] **Step 4: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/WorkspaceApp.tsx deploy/new_html/WorkspaceApp.tsx
git commit -m "feat(workspace): three-stage handlers + pipeline orchestration"
```

---

## Task 13: 三步生成 UI 面板

**Files:**
- Modify: `new_html/WorkspaceApp.tsx`（在现有「AI 改写 / 提取分镜」按钮区附近渲染）

- [ ] **Step 1: 定位现有 AI 操作按钮区**

Run: `cd new_html && rg -n "提取分镜|改写为剧本|按三步生成|handleRewrite|handleExtractShots" WorkspaceApp.tsx`
Expected: 找到现有按钮 JSX 区块（`handleExtractShots` / `handleRewrite` 的 `onClick` 绑定处）。记下其外层容器，把新面板插在同一容器内。

- [ ] **Step 2: 在该按钮区插入三步生成面板 JSX**

在现有 AI 操作按钮容器内、合适位置插入（`selectedFile` 为当前文件，按现有命名调整）：

```tsx
{selectedFile && (
  <div className="mt-3 rounded-lg border border-slate-700 bg-slate-800/40 p-3 text-sm">
    <div className="flex items-center justify-between mb-2">
      <span className="font-bold text-slate-200">三步生成</span>
      <button
        className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-50"
        disabled={!selectedFile.originalContent?.trim()}
        onClick={() => handleRunThreeStagePipeline(selectedFile.id)}
      >按三步生成</button>
    </div>

    {([
      { key: 'split', label: '1. 拆分剧本', action: () => handleSplitScript(selectedFile.id),
        metric: `分段数: ${selectedFile.scriptSegments?.length ?? 0}` },
      { key: 'videoScript', label: '2. 生成视频脚本', action: () => handleGenerateVideoScript(selectedFile.id),
        metric: `已生成: ${(selectedFile.scriptSegments || []).filter(s => s.videoScript).length}/${selectedFile.scriptSegments?.length ?? 0}` },
      { key: 'storyboardPrompt', label: '3. 提取分镜提示词', action: () => handleExtractStoryboardPrompts(selectedFile.id),
        metric: `分镜提示词: ${(selectedFile.storyboard?.items || []).filter(i => i.imagePrompt).length}` },
    ] as const).map(row => {
      const st = selectedFile.generationStages?.[row.key];
      const statusText = st?.status === 'running'
        ? `进行中 ${st.completed ?? 0}/${st.total ?? '?'}`
        : st?.status === 'done' ? '完成'
        : st?.status === 'error' ? `失败: ${st.errorMessage || ''}` : '未开始';
      const statusColor = st?.status === 'done' ? 'text-green-400'
        : st?.status === 'error' ? 'text-red-400'
        : st?.status === 'running' ? 'text-amber-400' : 'text-slate-400';
      return (
        <div key={row.key} className="flex items-center justify-between py-1.5 border-t border-slate-700/60">
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs disabled:opacity-50"
              disabled={st?.status === 'running'}
              onClick={row.action}
            >{row.label.replace(/^\d+\.\s*/, '')}</button>
            <span className="text-xs text-slate-400">{row.metric}</span>
          </div>
          <span className={`text-xs ${statusColor}`}>{statusText}</span>
        </div>
      );
    })}
  </div>
)}
```

> Tailwind class 沿用项目现有深色风格；若项目用别的 class 体系，按邻近按钮的 className 调整。

- [ ] **Step 3: 构建验证（确保 JSX 无误）**

Run: `cd new_html && npx tsc --noEmit && npx vite build`
Expected: tsc 无新增错误；`vite build` 成功产出 `dist/`

- [ ] **Step 4: 镜像 + 提交**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add new_html/WorkspaceApp.tsx deploy/new_html/WorkspaceApp.tsx
git commit -m "feat(workspace): three-stage generation panel UI"
```

---

## Task 14: 后续页面消费校验（只读验证，不改代码除非发现 gap）

**Files:**
- Verify: `new_html/pages/VideoGenPage.tsx`、`new_html/components/VideoPage.tsx`
- Verify: `new_html/pages/StoryboardGenPage.tsx`、`scriptToProjectFile` 所在文件

- [ ] **Step 1: 验证 VideoGenPage 读取 video_prompt 的回退链**

Run: `cd new_html && rg -n "video_prompt|videoPrompt|image_prompt|imagePrompt" pages/VideoGenPage.tsx components/VideoPage.tsx`
Expected: 存在 `item.video_prompt ?? item.videoPrompt ?? item.image_prompt ?? item.imagePrompt` 之类回退。Task 12 把 Stage 2 镜头块写入 `videoPrompt` → 后端 `video_prompt`，因此视频页应能消费。**若发现没有该回退，新增一个最小修复并提交。**

- [ ] **Step 2: 验证 StoryboardGenPage 读取 image_prompt**

Run: `cd new_html && rg -n "scriptToProjectFile|image_prompt|imagePrompt" pages/StoryboardGenPage.tsx utils/episodeAdapters.ts`
Expected: `scriptToProjectFile()` 把 `image_prompt` 映射到 `StoryboardItem.imagePrompt`。Task 12 已写 `imagePrompt`，分镜页应能消费。

- [ ] **Step 3: 记录验证结论（无代码改动则跳过提交）**

若两条都满足，无需改动。若有 gap，按最小改动修复后：
```bash
python scripts/sync_to_deploy.py --apply
git add <changed> deploy/<changed>
git commit -m "fix(downstream): consume stage2 video_prompt / stage3 image_prompt"
```

---

## Task 15: 文档同步 + 镜像 + 收口 gate

**Files:**
- Modify: `docs/database.md`、`docs/frontend.md`、`docs/api.md`、`docs/diagrams/page-ScriptPage.md`

- [ ] **Step 1: 更新 `docs/database.md`**

在 `storyboard_items` 小节追加 5 个新列说明；在 Content 段新增 `episode_script_segments` 表条目（字段、索引、DAO=`dao_episode_script_segment.py`、migration 文件名）。在 ER 图 `episode_scripts` 旁补 `└──1:N──> episode_script_segments`。

- [ ] **Step 2: 更新 `docs/api.md`**

新增三条路由：
```
GET    /api/episodes/{episode_id}/script-segments?script_id=...
PUT    /api/episodes/{episode_id}/script-segments/batch
DELETE /api/episodes/{episode_id}/script-segments?script_id=...
```
并在 storyboard batch 处注明 `items[]` 现支持 `script_segment_id / source_video_shot_no / video_script_block / shot_size / camera_angle`。

- [ ] **Step 3: 更新 `docs/frontend.md` 与 `docs/diagrams/page-ScriptPage.md`**

`frontend.md`：ScriptPage 描述加入「三步生成面板」。
`docs/diagrams/page-ScriptPage.md`：可选地用 `python .claude/skills/project-memory/scripts/gen_diagrams.py H:/MY2 --pages ScriptPage` 重新生成；或手动补三阶段流。

- [ ] **Step 4: 重新扫描 + drift gate（项目铁律 pre-commit gate）**

Run:
```bash
python .claude/skills/project-memory/scripts/scan_project.py H:/MY2
python .claude/skills/project-memory/scripts/sync_check.py H:/MY2 --strict --levels ERROR
```
Expected: scan 完成；sync_check exit 0（无 ERROR drift）。

- [ ] **Step 5: 全量回归（后端 + 前端单测 + 构建）**

Run:
```bash
python -m pytest tests/test_dao_storyboard.py tests/test_dao_episode_script_segment.py -v
cd new_html && npx vitest run __tests__/utils/scriptPipelineParsers.test.ts && npx tsc --noEmit && npx vite build
```
Expected: 后端测试 passed；parser 测试 passed；tsc 无新增错误；build 成功。

- [ ] **Step 6: GitNexus 变更范围核对（AGENTS.md 要求）**

Run: `npx gitnexus detect-changes --repo MY2`
Expected: 影响范围仅含本 spec 预期模块（dao_storyboard / dao_episode_script_segment / api_routes / WorkspaceApp / prompts / parsers / aiModelService），无意外波及。

- [ ] **Step 7: 镜像 + 提交文档**

Run:
```bash
python scripts/sync_to_deploy.py --apply
git add docs/database.md docs/api.md docs/frontend.md docs/diagrams/page-ScriptPage.md \
        deploy/docs/database.md deploy/docs/api.md deploy/docs/frontend.md deploy/docs/diagrams/page-ScriptPage.md
git commit -m "docs: three-stage script generation (db/api/frontend/diagram)"
```

---

## Self-Review

**1. Spec coverage**

| Spec 章节 | 对应 Task |
|---|---|
| §5.1 episode_script_segments 表 | Task 1 |
| §5.2 storyboard_items 扩列 | Task 1 + Task 3 |
| §6.1 Segments API | Task 4（DAO Task 2） |
| §6.2 Storyboard batch 字段 | Task 3（DAO）+ Task 4（API 直通）+ Task 11（FE 映射） |
| §7.1 三个 Prompt Template | Task 7 |
| §7.2 三个 service 函数 | Task 9 |
| §7.3 三个 parser | Task 8 |
| §8.1 loadEpisodeData 加载 segments | Task 10 |
| §8.2 saveEpisodeToBackend 保存 | Task 11 |
| §8.3 三阶段 handler + pipeline | Task 12 |
| §8.4 错误处理（保留已完成、标记失败、可续跑） | Task 12（Stage 2/3 失败 return 保留进度） |
| §4.1/§4.3 三步生成面板 + 操作规则 | Task 13（UI）+ Task 12（pipeline 决策） |
| §4.4 前端状态 ScriptSegment/StageState | Task 5 |
| §9 后续页面消费 | Task 14 |
| §10 兼容迁移（orphan、空字段） | Task 2（IS NOT DISTINCT FROM）、Task 10（idx===0 orphan 挂载）、Task 3（默认空串） |
| §11 实施步骤 | Task 1-15 全覆盖 |
| §12 测试计划 | Task 2/3/4（DAO/API）、Task 8（parser）、Task 5-13（tsc/build） |
| §13 GitNexus | Pre-flight P0/P1 + Task 15 Step 6 |
| §14 验收标准 | Task 15 Step 5 回归覆盖 |

§12.3 前端流程测试（mock 三个 AI 调用点「按三步生成」）未单独成 Task —— 这是组件级集成测试，依赖 WorkspaceApp 巨型组件 mount，成本高。建议作为可选增强：在 `new_html/__tests__/pages/` 加一个 mock `aiModelService` 三函数的轻量测试。**若需要严格满足 §12.3，追加为 Task 16（可选）。**

**2. Placeholder scan**：无 TBD/TODO；所有代码步骤含完整代码；migration、DAO、API、parser、handler 均为可直接落地的完整实现。

**3. Type consistency**：
- `ScriptSegment`（Task 5）字段 `id/order/sourceText/estimatedDurationSec/videoScript/status/errorMessage` 在 Task 8 parser、Task 10 load、Task 11 save、Task 12 handler 中一致使用。
- `VideoScriptBlock`（`shotNo/durationSec/rawBlock`）、`ExtractedStoryboardPrompt`（`shotNo/shotSize/sceneDescription/imagePrompt/cameraAngle/cameraMove/dialogue/durationSec`）在 Task 8 定义、Task 9/12 消费一致。
- DB 列名 `script_segment_id/source_video_shot_no/video_script_block/shot_size/camera_angle`（Task 1）↔ DAO（Task 3）↔ FE camelCase `scriptSegmentId/sourceVideoShotNo/videoScriptBlock/shotSize/cameraAngle`（Task 5/11）映射一致。
- 函数名：`aiSplitScriptIntoSegments` / `aiGenerateVideoScriptFromSegment` / `aiExtractStoryboardPromptFromVideoShot`（Task 9）↔ handler（Task 12）一致；`batchSaveScriptSegments` / `listEpisodeScriptSegments`（Task 6）↔ Task 10/11/12 一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-29-scriptpage-three-stage-generation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 派一个全新 subagent，task 间审查，快速迭代（REQUIRED SUB-SKILL: superpowers:subagent-driven-development）。

**2. Inline Execution** — 在本会话内逐 Task 执行，带 checkpoint 审查（REQUIRED SUB-SKILL: superpowers:executing-plans）。

Which approach?
