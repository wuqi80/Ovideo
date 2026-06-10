# DashScope 分镜参考图 file_id 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Kling/Vidu/HappyHorse（DashScope 族）视频任务因把分镜项 ID `sb_xxx` 当成 `file_id` 而报 `FileNotFoundError: 数据库未找到 ref_image_0` 的问题。

**Architecture:** 双层修复。后端：`_file_id_to_dashscope_url` 改成「URL/分镜 ID 也能还原成本地文件转 Base64」的健壮解析器（新增 `FileDAO.get_file_by_url`）；前端：`VideoPage.getDashScopeParams` 不再把 `sb_` 分镜 ID 塞进 `file_id`，让真实的（带 token 的）图片 URL 流到后端由其还原。两层都改、同一批次提交。

**Tech Stack:** Python 3.9 / FastAPI / asyncpg / pytest（mock，无需真实 DB）；React + TypeScript / Vitest。

---

## 背景与根因（必读）

错误链（已在排查中确证）：

1. 分镜导入：`new_html/pages/VideoGenPage.tsx:105-115` 把 `UploadedImage.id = itemId`（分镜项 ID `sb_xxx`），`url = generated_image_url`（带 `?token=` 的 `/storage/...` 预览 URL）。
2. 转 DashScope 参数：`new_html/components/VideoPage.tsx:299-313` 写 `file_id: img.id` → 对分镜图就是 `sb_xxx`。
3. 提交序列化：`new_html/services/videoService.ts:1222` `resolveUrl = (m) => m.file_id || m.url` —— **file_id 优先**，于是 `image_path` 与 `media_inputs[].url` 都变成 `sb_xxx`，真实 URL 丢失。
4. worker：`worker.py:2134` `src = m.get('file_id') or m.get('url')` 拿到 `sb_xxx` → `_file_id_to_dashscope_url` → `FileDAO.get_file('sb_xxx')` 查 `files` 表无果 → `FileNotFoundError`。

为何不能直接把 URL 透传给 DashScope：分镜图 URL 带 `?token=`，DashScope 服务端 fetch 会 401（见 `worker.py:2125-2127` 注释），所以必须由 worker 把本地文件读出来转 Base64。

数据事实：`files.file_url` 存为相对路径 `/storage/<type>/<user>/<ym>/<file>`（`file_service.py:193`，无查询串）；`storyboard_items.generated_image_url` = 同一 `file_url` + 可能的 `?token=`。两者可用「去掉 `?` 后的 path」精确 join（`migrate_existing_files.py:248` 已有同款写法）。`StoryboardDAO.get_by_id(item_id)`（`dao_storyboard.py:123`）可由 `sb_xxx` 取回该行及其 `generated_image_url`。

## File Structure

- `dao_content.py` — 新增 `FileDAO.get_file_by_url(url)`（按 URL 反查 `files` 行）。
- `worker.py` — 新增私有 `_record_to_base64(file_record, label)`；重写 `_file_id_to_dashscope_url(ref, *, label)` 支持 URL / `sb_` / file_id 三类输入。
- `new_html/components/VideoPage.tsx` — `getDashScopeParams` 内 `file_id` 仅在非 `sb_` 时写入。
- `tests/test_dashscope_fileid_resolution.py` — 新增 worker 解析器 + DAO 行为的 mock 单测。
- 镜像：`deploy/dao_content.py`、`deploy/worker.py`、`deploy/new_html/...`（若存在镜像树）。
- 文档：`docs/faq.md`、`docs/database.md`（DAO 方法）、`docs/vertical-slices.md`（VideoPage 切片备注）。

---

### Task 1: `FileDAO.get_file_by_url` —— 按 URL 反查文件

**Files:**
- Modify: `dao_content.py`（紧跟 `get_file_by_name`，约 `dao_content.py:430` 之后）
- Test: `tests/test_dashscope_fileid_resolution.py`

- [ ] **Step 1: 写失败测试**

新建 `tests/test_dashscope_fileid_resolution.py`：

```python
"""DashScope 参考图解析：URL / sb_ / file_id 三类输入都要能还原成本地文件。

Mock-only —— 不连真实 DB、不发真实 HTTP。
回归点：分镜项 ID sb_xxx 被当成 file_id 导致 FileNotFoundError（2026-06-01）。
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─── Task 1: FileDAO.get_file_by_url 传 path 给 SQL（去掉 scheme/host/query） ───

async def test_get_file_by_url_strips_host_and_token():
    import dao_content
    captured = {}

    async def fake_fetchrow(query, *args):
        captured['query'] = query
        captured['args'] = args
        return {'file_id': 'file_abc', 'file_path': '/data/x.png', 'mime_type': 'image/png'}

    fake_db = MagicMock()
    fake_db.fetchrow = AsyncMock(side_effect=fake_fetchrow)

    with patch('dao_content.get_db_manager', return_value=fake_db):
        rec = await dao_content.FileDAO.get_file_by_url(
            'http://host:8000/storage/image/u1/2026-06/x.png?token=abc123'
        )

    assert rec and rec['file_id'] == 'file_abc'
    # 传给 SQL 的应是去 host/去 token 后的 path
    assert captured['args'][0] == '/storage/image/u1/2026-06/x.png'


async def test_get_file_by_url_handles_relative_path():
    import dao_content
    captured = {}

    async def fake_fetchrow(query, *args):
        captured['args'] = args
        return None

    fake_db = MagicMock()
    fake_db.fetchrow = AsyncMock(side_effect=fake_fetchrow)

    with patch('dao_content.get_db_manager', return_value=fake_db):
        rec = await dao_content.FileDAO.get_file_by_url('/storage/image/u1/2026-06/x.png?token=z')

    assert rec is None
    assert captured['args'][0] == '/storage/image/u1/2026-06/x.png'
```

- [ ] **Step 2: 运行，确认失败**

Run: `python -m pytest tests/test_dashscope_fileid_resolution.py -k get_file_by_url -v`
Expected: FAIL —— `AttributeError: type object 'FileDAO' has no attribute 'get_file_by_url'`

- [ ] **Step 3: 实现 `get_file_by_url`**

在 `dao_content.py` 的 `get_file_by_name`（约 430 行）之后插入：

```python
    @staticmethod
    async def get_file_by_url(url: str) -> Optional[Dict[str, Any]]:
        """按 file_url 反查文件，忽略 scheme/host 与 ?token=... 查询串。

        用途：把分镜 generated_image_url（带 token 的 /storage 预览 URL）还原成
        本地文件，供 DashScope worker 转 Base64（DashScope 服务端无法 fetch token URL）。
        files.file_url 存为相对路径（如 /storage/...），故只比较 path。
        """
        if not url:
            return None
        from urllib.parse import urlparse
        # urlparse 对绝对/相对 URL 都能取出 path；fallback 兜底去掉 query
        path = urlparse(url).path or url.split('?', 1)[0]
        db = get_db_manager()
        query = """
            SELECT * FROM files
            WHERE split_part(file_url, '?', 1) = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
            LIMIT 1
        """
        return await db.fetchrow(query, path)
```

- [ ] **Step 4: 运行，确认通过**

Run: `python -m pytest tests/test_dashscope_fileid_resolution.py -k get_file_by_url -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add dao_content.py tests/test_dashscope_fileid_resolution.py
git commit -m "feat(dao): add FileDAO.get_file_by_url for token-stripped file lookup"
```

---

### Task 2: worker 解析器健壮化（URL / sb_ / file_id 三类输入）

**Files:**
- Modify: `worker.py:2065-2090`（`_file_id_to_dashscope_url`，并抽出 `_record_to_base64`）
- Test: `tests/test_dashscope_fileid_resolution.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `tests/test_dashscope_fileid_resolution.py` 末尾追加：

```python
# ─── Task 2: _file_id_to_dashscope_url 三类输入解析 ───

def _make_worker():
    from worker import Worker
    w = Worker.__new__(Worker)  # 跳过重依赖 __init__
    return w


async def test_resolver_data_uri_passthrough():
    w = _make_worker()
    out = await w._file_id_to_dashscope_url('data:image/png;base64,AAAA', label='ref')
    assert out == 'data:image/png;base64,AAAA'


async def test_resolver_storyboard_id_resolves_via_generated_image_url(tmp_path):
    """sb_xxx → StoryboardDAO.get_by_id → generated_image_url → get_file_by_url → Base64."""
    w = _make_worker()
    img = tmp_path / 's.png'
    img.write_bytes(b'PNGDATA')

    fake_item = {'item_id': 'sb_0e2e9f58c3a6',
                 'generated_image_url': '/storage/image/u1/2026-06/s.png?token=t'}
    fake_rec = {'file_path': str(img), 'mime_type': 'image/png'}

    with patch('dao_storyboard.StoryboardDAO.get_by_id', new=AsyncMock(return_value=fake_item)), \
         patch('worker.FileDAO.get_file_by_url', new=AsyncMock(return_value=fake_rec)):
        out = await w._file_id_to_dashscope_url('sb_0e2e9f58c3a6', label='ref_image_0')

    assert out.startswith('data:image/png;base64,')


async def test_resolver_storyboard_url_resolves_to_base64(tmp_path):
    """带 token 的 /storage URL → get_file_by_url → Base64（不透传）。"""
    w = _make_worker()
    img = tmp_path / 'u.png'
    img.write_bytes(b'X')
    fake_rec = {'file_path': str(img), 'mime_type': 'image/png'}
    with patch('worker.FileDAO.get_file_by_url', new=AsyncMock(return_value=fake_rec)):
        out = await w._file_id_to_dashscope_url('/storage/image/u1/2026-06/u.png?token=t', label='ref')
    assert out.startswith('data:image/png;base64,')


async def test_resolver_public_url_passthrough():
    """找不到本地文件的公网 http URL → 原样透传。"""
    w = _make_worker()
    with patch('worker.FileDAO.get_file_by_url', new=AsyncMock(return_value=None)):
        out = await w._file_id_to_dashscope_url('https://cdn.example.com/a.png', label='ref')
    assert out == 'https://cdn.example.com/a.png'


async def test_resolver_real_file_id_base64(tmp_path):
    w = _make_worker()
    img = tmp_path / 'f.png'
    img.write_bytes(b'Y')
    fake_rec = {'file_path': str(img), 'mime_type': 'image/png'}
    with patch('worker.FileDAO.get_file', new=AsyncMock(return_value=fake_rec)):
        out = await w._file_id_to_dashscope_url('file_abc123', label='first_frame')
    assert out.startswith('data:image/png;base64,')


async def test_resolver_unknown_file_id_raises():
    w = _make_worker()
    with patch('worker.FileDAO.get_file', new=AsyncMock(return_value=None)):
        with pytest.raises(FileNotFoundError):
            await w._file_id_to_dashscope_url('file_missing', label='ref')
```

- [ ] **Step 2: 运行，确认失败**

Run: `python -m pytest tests/test_dashscope_fileid_resolution.py -k resolver -v`
Expected: FAIL（多数用例失败：旧实现对 `sb_` / token-URL 抛 FileNotFoundError 或透传 token URL）

- [ ] **Step 3: 重写解析器 + 抽出 Base64 helper**

把 `worker.py` 原 `_file_id_to_dashscope_url`（`worker.py:2065-2090`）整体替换为：

```python
    def _record_to_base64(self, file_record: dict, label: str) -> str:
        """把 files 记录读成 DashScope 可接受的 Base64 data URI。"""
        fp = Path(file_record['file_path'])
        if not fp.exists():
            raise FileNotFoundError(f"{label} 物理文件不存在: {fp}")
        data = fp.read_bytes()
        if len(data) > 20 * 1024 * 1024:
            raise ValueError(f"{label} 过大 {len(data)} bytes (DashScope 限制 20MB)")
        mime = file_record.get('mime_type') or 'image/png'
        b64 = base64.b64encode(data).decode('utf-8')
        logger.info(f"📦 DashScope {label}: {fp.name} → Base64 {len(data)} bytes")
        return f"data:{mime};base64,{b64}"

    async def _file_id_to_dashscope_url(self, ref: str, *, label: str = "image") -> str:
        """把一个引用（file_id / URL / 分镜项 ID）转成 DashScope 接受的值。

        DashScope 视频 endpoint 接受公网 HTTPS URL 或 Base64 data URI。但分镜图的
        generated_image_url 带 ?token=，服务端 fetch 会 401，必须还原本地文件转 Base64。

        分派：
          - data:URI            → 透传
          - http(s)/相对 URL    → get_file_by_url 命中则转 Base64；未命中且为公网 http → 透传
          - sb_ 分镜项 ID       → StoryboardDAO 取 generated_image_url 再转 Base64（防御）
          - 其余                → 当 file_id：get_file → 转 Base64
        """
        if not ref:
            raise ValueError(f"DashScope 任务缺少 {label}")
        # 1) data URI 直接透传
        if ref.startswith("data:"):
            return ref
        # 2) URL（绝对或相对）：优先还原本地文件转 Base64
        if ref.startswith(("http://", "https://", "/")):
            rec = await FileDAO.get_file_by_url(ref)
            if rec:
                return self._record_to_base64(rec, label)
            if ref.startswith(("http://", "https://")):
                return ref  # 本地查不到 → 视为公网 URL 透传
            raise FileNotFoundError(f"{label} 无法解析本地文件: {ref}")
        # 3) 分镜项 ID（误把 sb_xxx 当 file_id 传进来）：按分镜图还原
        if ref.startswith("sb_"):
            from dao_storyboard import StoryboardDAO
            item = await StoryboardDAO.get_by_id(ref)
            img_url = (item or {}).get('generated_image_url')
            if not img_url:
                raise FileNotFoundError(f"{label} 分镜 {ref} 无 generated_image_url")
            rec = await FileDAO.get_file_by_url(img_url)
            if not rec:
                raise FileNotFoundError(f"{label} 分镜 {ref} 图片未入库: {img_url}")
            return self._record_to_base64(rec, label)
        # 4) 其余 → 当 file_id
        file_record = await FileDAO.get_file(ref)
        if not file_record:
            raise FileNotFoundError(f"数据库未找到 {label} file_id={ref}")
        return self._record_to_base64(file_record, label)
```

注意：`base64`、`Path`、`logger`、`FileDAO` 在 `worker.py` 顶部已可用（原实现已在用）。

- [ ] **Step 4: 运行，确认通过**

Run: `python -m pytest tests/test_dashscope_fileid_resolution.py -v`
Expected: PASS（Task 1 + Task 2 全部用例）

- [ ] **Step 5: 回归既有 wiring 测试**

Run: `python -m pytest tests/test_dashscope_wiring_e2e.py -v`
Expected: PASS（既有用例 stub 了 `_file_id_to_dashscope_url`，签名 `(ref, *, label)` 兼容 `lambda src, label='x'`）

- [ ] **Step 6: 提交**

```bash
git add worker.py tests/test_dashscope_fileid_resolution.py
git commit -m "fix(worker): resolve DashScope ref via URL/storyboard-id to Base64 (fixes sb_ file_id 404)"
```

---

### Task 3: 前端不再把 `sb_` 分镜 ID 写进 `file_id`

**Files:**
- Modify: `new_html/components/VideoPage.tsx:296-316`（`getDashScopeParams` 的 `seedMedia` 构造）

- [ ] **Step 1: 加守卫函数并改三处 `file_id`**

在 `getDashScopeParams`（`new_html/components/VideoPage.tsx`）的 `seedMedia` 构造之前，加一个内联守卫；分镜图的 `id` 是 `sb_xxx`（非真实 file_id），只在非 `sb_` 时写 `file_id`，让真实 `url` 流到后端解析：

```tsx
        // sb_ 开头是分镜项 ID（非 files 表 file_id），不能当 file_id 下发。
        // 留空 file_id → submitDashScopeVideoTask.resolveUrl 会用 url（worker 负责还原 Base64）。
        const fileIdOf = (id: string): string | undefined =>
            id && !id.startsWith('sb_') ? id : undefined;

        let seedMedia: videoService.SeedanceMediaInput[];
        if (model === 'HappyHorse') {
            seedMedia = orderedImgs.map(img => ({
                kind: 'image' as const,
                url: img.url,
                file_id: fileIdOf(img.id),
                role: 'reference_image' as const,
            }));
        } else if (isPair && orderedImgs.length >= 2) {
            seedMedia = [
                { kind: 'image', url: orderedImgs[0].url, file_id: fileIdOf(orderedImgs[0].id), role: 'first_frame' },
                { kind: 'image', url: orderedImgs[1].url, file_id: fileIdOf(orderedImgs[1].id), role: 'last_frame' },
            ];
        } else if (orderedImgs.length >= 1) {
            seedMedia = [
                { kind: 'image', url: orderedImgs[0].url, file_id: fileIdOf(orderedImgs[0].id), role: 'first_frame' },
            ];
        } else {
            seedMedia = [];
        }
```

（仅把原 296-316 的 `seedMedia` 分支替换为上面版本；其余 `getDashScopeParams` 逻辑不变。）

- [ ] **Step 2: 类型检查**

Run（在 `new_html/`）: `npx tsc --noEmit`
Expected: 不引入新错误（`SeedanceMediaInput.file_id` 为可选，`undefined` 合法）。预存在错误（如 `materialLibrary` 类型）忽略，确认与本改动无关。

- [ ] **Step 3: 跑相关前端单测**

Run（在 `new_html/`）: `npx vitest run __tests__/services/dashScopeParams.test.ts __tests__/components/MediaBadges.test.tsx`
Expected: PASS（媒体输入 url/role 逻辑未变）

- [ ] **Step 4: 提交**

```bash
git add new_html/components/VideoPage.tsx
git commit -m "fix(video): stop sending sb_ storyboard id as DashScope file_id"
```

---

### Task 4: 镜像到 deploy/ + 文档 + 校验

**Files:**
- Mirror: `deploy/dao_content.py`、`deploy/worker.py`、`deploy/new_html/components/VideoPage.tsx`（若镜像树存在；用 `scripts/sync_to_deploy.py`）
- Modify: `docs/faq.md`、`docs/database.md`、`docs/vertical-slices.md`

- [ ] **Step 1: 镜像 deploy/**

Run: `python scripts/sync_to_deploy.py dao_content.py worker.py new_html/components/VideoPage.tsx`
（若无该脚本，按 `git status` 用编辑器把三文件等价改动复制到 `deploy/` 对应路径。）
Expected: `deploy/` 三文件与根同步。

- [ ] **Step 2: `docs/faq.md` 追加条目**

在文末 `---` 前追加：

```markdown
### DashScope（Kling/Vidu/HappyHorse）报「数据库未找到 ref_image_0 file_id=sb_xxx」

**Symptom**: `_process_dashscope_video_task` 抛 `FileNotFoundError: 数据库未找到 ref_image_0 file_id=sb_0e2e9f58c3a6`，任务最终失败。

**Root Cause**: `sb_xxx` 是分镜项 ID（`storyboard_items.item_id`），不是 `files` 表 file_id。链路：`VideoPage.getDashScopeParams` 写 `file_id: img.id`（分镜图 id=sb_）→ `videoService.submitDashScopeVideoTask` 的 `resolveUrl = m.file_id || m.url` 优先取 file_id → worker `FileDAO.get_file('sb_...')` 查不到。且分镜图真实 URL 带 `?token=`，DashScope 服务端 fetch 会 401，故必须 worker 还原本地文件转 Base64。

**Fix（2026-06-01）**:
1. 前端 `VideoPage.getDashScopeParams` 仅在 id 非 `sb_` 时写 `file_id`，分镜图改用 url 下发。
2. 后端 `worker._file_id_to_dashscope_url` 健壮化：URL→`FileDAO.get_file_by_url`→Base64；`sb_` 防御性走 `StoryboardDAO.get_by_id`→`generated_image_url`→Base64；公网 URL 透传；其余按 file_id。
3. 新增 `FileDAO.get_file_by_url(url)`（去 host/去 token 后按 path 精确匹配 `files.file_url`，复用 `migrate_existing_files.py:248` 的 join 思路）。

**Files**: `new_html/components/VideoPage.tsx`, `worker.py`, `dao_content.py`（+ deploy mirror）, `tests/test_dashscope_fileid_resolution.py`
**Date**: 2026-06-01
```

- [ ] **Step 3: `docs/database.md` / `docs/vertical-slices.md`**

- `docs/database.md`：在 `files` 表 DAO 方法列表补 `FileDAO.get_file_by_url(url)`（按 file_url 去 token 反查）。
- `docs/vertical-slices.md`：VideoGenPage/VideoPage 切片备注「DashScope 参考图：分镜图用 url 下发，worker 按 file_url 还原 Base64；sb_ 分镜 ID 不作 file_id」。

- [ ] **Step 4: memory + drift 校验**

Run:
```bash
python C:/Users/liulong/.claude/skills/project-memory/scripts/scan_project.py h:/MY2
python C:/Users/liulong/.claude/skills/project-memory/scripts/sync_check.py h:/MY2 --strict --levels ERROR
```
Expected: sync_check exit 0（无新增 ERROR）。

- [ ] **Step 5: 全量回归**

Run: `python -m pytest tests/test_dashscope_fileid_resolution.py tests/test_dashscope_wiring_e2e.py tests/test_dashscope_video_payload_extension.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add deploy/ docs/faq.md docs/database.md docs/vertical-slices.md
git commit -m "docs+mirror: sync DashScope file_id fix to deploy + faq/database/vertical-slices"
```

---

## 验证（人工）

开通模型且有 GPU/agent 的环境下：导入分镜 → 选 Kling/HappyHorse/Vidu 参考图（或首尾帧）→ 提交任务。预期：
- 不再出现 `数据库未找到 ref_image_* file_id=sb_...`。
- worker 日志出现 `📦 DashScope ref_image_0: <文件名> → Base64 N bytes`。
- 任务进入 DashScope 创建/轮询流程。

## Self-Review 备注

- **Spec 覆盖**：根因 4 个环节（FE 注入 / FE 序列化 / worker 解析 / DB 查无）→ Task 3 修 FE 注入并让 url 流过序列化；Task 1+2 修 worker 解析与 DB 反查。全覆盖。
- **类型一致**：`get_file_by_url`（DAO）、`_record_to_base64` / `_file_id_to_dashscope_url(ref,*,label)`（worker）、`fileIdOf`（FE）命名在各 Task 间一致。
- **占位符**：无 TODO/示意；每个代码步骤均为完整可粘贴代码。
- **既有测试**：`test_dashscope_wiring_e2e.py` 对解析器的 stub `lambda src, label='x'` 与新签名兼容，不破坏。
