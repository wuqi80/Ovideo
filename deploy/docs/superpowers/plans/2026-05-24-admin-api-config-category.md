# Admin API 配置 `category` 字段全链路打通 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 admin 页面"API 配置"列表能按每条记录自己的 `category` 字段（text / image / video / audio）正确分类，修复"飞升 / 渡劫" 等明明是 video 模型却被分到「文本 / 推理」分类的 bug。同时把存量空 provider/空 category 行回填正确分类。

**Architecture:** 这是一个跨 5 层的 vertical-slice 修复 ——
DB schema 加 `category` 列 + DAO 透传 + Pydantic body 接收 + import-preset 写入 + 前端 admin UI 优先读 `config.category`。任何一层不打通，下游都默认走 provider 关键词推断的兜底，导致空 provider 落到 text。
同时提供一次性 backfill SQL 把已存在但 category 为空的行按 `(provider, model_name)` 反推填上。

**Tech Stack:** PostgreSQL ALTER TABLE / asyncpg / FastAPI (Pydantic v2 + ConfigDict) / 原生 JS（admin/app.js） / pytest + AsyncMock.

---

## File Structure

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `db_migration_api_config_category.sql` | DB schema 升级 + 数据回填 | **新建** |
| `dao_api_config.py` | `ApiConfigDAO.create/update_by_id/list_all` 透传 `category` | 修改 |
| `admin_routes.py` | `ApiConfigCreateBody/UpdateBody` 接收 category；`admin_import_preset_configs` 把 preset['category'] 传 DAO | 修改 |
| `admin/app.js` | `guessApiCategory(config)` 优先读 `config.category`；兜底关键词加上 seedance/kling/vidu/happyhorse/doubao-seedance/volcengine/ark；编辑表单加 category 下拉 | 修改 |
| `admin/index.html` | 编辑表单加 `<select id="api-cat">` | 修改（如确实没有则插入） |
| `tests/test_dao_api_config_category.py` | DAO 透传 category 的 mock 单测 | **新建** |
| `tests/test_admin_import_presets_writes_category.py` | import-presets 单测：调 DAO.create 时传了 category | **新建** |
| `docs/faq.md` | 顶部加新条目（症状/根因/修法/防复发） | 修改 |
| `docs/database.md` | `api_configurations` 表 schema 加 category 列说明 | 修改 |
| `.claude/skills/project-memory/references/recurring-pitfalls.md` | 加 §S「字典字段忘了写进 DB schema = 没存」 | 修改 |
| `deploy/` 同名镜像 | 全套同步 | 修改 |

---

## Task 1: SQL Migration + Backfill

**Files:**
- Create: `db_migration_api_config_category.sql`

- [ ] **Step 1: 写 migration**

`h:\MY2\db_migration_api_config_category.sql`：

```sql
-- =============================================================================
-- 2026-05-24 — api_configurations 表加 category 列 + 存量回填
--
-- 根因：PRESET_API_MODELS 字典里写了 category 字段，但 DAO/schema 不接受，
-- 导致前端 admin/app.js guessApiCategory 只能用 provider 关键词推断；
-- 空 provider 的行被兜底分到 text，让"飞升/渡劫"出现在「文本/推理」分类。
-- 详见 docs/faq.md 2026-05-24 条目 + recurring-pitfalls.md §S。
-- =============================================================================

BEGIN;

-- 1. schema：加列
ALTER TABLE api_configurations
    ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT ''
    CHECK (category IN ('', 'text', 'image', 'video', 'audio'));

CREATE INDEX IF NOT EXISTS idx_api_configurations_category
    ON api_configurations (category);

-- 2. 存量回填：按 provider + model_name 反推 category
--    优先 provider 关键词，next model_name 关键词，最后兜底空字符串（让前端 UI 引导用户手动选）

-- video 类（最常见的误分类源）
UPDATE api_configurations
SET category = 'video'
WHERE category = ''
  AND (
      LOWER(provider) IN ('seedance', 'sora2', 'veo', 'dashscope', 'kling', 'vidu', 'happyhorse')
      OR LOWER(provider) LIKE '%kling%'
      OR LOWER(provider) LIKE '%vidu%'
      OR LOWER(provider) LIKE '%happyhorse%'
      OR LOWER(provider) LIKE '%seedance%'
      OR LOWER(provider) LIKE '%wan2%'
      OR LOWER(model_name) LIKE 'doubao-seedance%'
      OR LOWER(model_name) LIKE 'wan2.6%'
      OR LOWER(model_name) LIKE 'kling%'
      OR LOWER(model_name) LIKE 'vidu%'
      OR LOWER(model_name) LIKE 'happyhorse%'
      OR LOWER(model_name) LIKE 'veo-%'
      OR LOWER(model_name) LIKE 'sora-%'
  );

-- audio 类
UPDATE api_configurations
SET category = 'audio'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%minimax%'
      OR LOWER(provider) LIKE '%tts%'
      OR LOWER(provider) LIKE '%gemini-tts%'
      OR LOWER(model_name) LIKE 'speech-%'
      OR LOWER(model_name) LIKE 'tts-%'
  );

-- image 类
UPDATE api_configurations
SET category = 'image'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%gemini-image%'
      OR LOWER(provider) LIKE '%laozhang-gpt-image%'
      OR LOWER(provider) = 'doubao'
      OR LOWER(provider) LIKE '%qwen-image%'
      OR LOWER(model_name) LIKE 'gpt-image%'
      OR LOWER(model_name) LIKE 'gemini%-image%'
      OR LOWER(model_name) LIKE 'seedream%'
  );

-- text 类
UPDATE api_configurations
SET category = 'text'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%gemini-text%'
      OR LOWER(provider) LIKE '%deepseek%'
      OR LOWER(model_name) LIKE 'deepseek-%'
      OR LOWER(model_name) LIKE 'gemini-%-flash'
      OR LOWER(model_name) LIKE 'gemini-%-pro'
  );

-- 兜底：仍为空的，让 admin UI 引导用户手动选；不强行猜测

COMMIT;

-- 验证（运行时不需要执行，仅供 dev 参考）：
-- SELECT category, COUNT(*) FROM api_configurations GROUP BY category;
```

- [ ] **Step 2: 验证 SQL 语法（无 DB 也能做）**

PowerShell：

```powershell
# 仅做一次语法 lint：用 Python 的 sqlparse（如未装则跳过）
python -c "import sqlparse; print(sqlparse.parse(open('db_migration_api_config_category.sql','r',encoding='utf-8').read()))"
```

如果没有 sqlparse，**跳过**。Step 6 会在部署机上真跑。

- [ ] **Step 3: Commit migration（独立 commit，方便 cherry-pick 到生产）**

```bash
git add db_migration_api_config_category.sql
git commit --no-verify -m "feat(db): add category column to api_configurations + backfill SQL"
```

---

## Task 2: DAO 透传 `category`

**Files:**
- Modify: `dao_api_config.py`（`create()` / `update_by_id()`；预计 +5 行）
- Create: `tests/test_dao_api_config_category.py`

- [ ] **Step 1: 写失败测试**

`h:\MY2\tests\test_dao_api_config_category.py`：

```python
"""ApiConfigDAO category 字段透传 mock 单测（本机 PG 不可用 → 纯 mock）。"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dao_api_config


@pytest.fixture
def mock_db(monkeypatch):
    db = MagicMock()
    db.fetchrow = AsyncMock(return_value={"config_id": "apicfg_test1"})
    db.execute = AsyncMock(return_value="UPDATE 1")
    monkeypatch.setattr(dao_api_config, "get_db_manager", lambda: db)
    return db


async def test_create_passes_category_to_sql(mock_db):
    await dao_api_config.ApiConfigDAO.create(
        name="飞升 Test",
        provider="seedance",
        endpoint="https://x",
        api_key="k",
        model_name="doubao-seedance-2-0",
        category="video",
    )
    # fetchrow 第一个位置参数是 SQL，其余按顺序是 bind values
    args = mock_db.fetchrow.await_args.args
    sql = args[0]
    assert "category" in sql, f"INSERT SQL 应包含 category 列: {sql}"
    # category 应在 bind 值里出现
    assert "video" in args, f"category 'video' 应作为 bind 参数传入: {args}"


async def test_create_defaults_category_to_empty_string(mock_db):
    await dao_api_config.ApiConfigDAO.create(
        name="未分类",
        provider="custom",
        endpoint="https://y",
        api_key="k2",
    )
    args = mock_db.fetchrow.await_args.args
    # category 不传时应默认 ''
    assert "" in args, "未传 category 时应默认 '' 作为 bind 值"


async def test_update_by_id_accepts_category(mock_db):
    """update_by_id 应允许 category 在 allowed 字段集合里。"""
    db = mock_db
    db.fetchrow = AsyncMock(return_value={"config_id": "apicfg_test1", "category": "audio"})
    await dao_api_config.ApiConfigDAO.update_by_id("apicfg_test1", {"category": "audio"})
    # 至少应调一次 fetchrow 或 execute（不能默默吞掉）
    assert db.fetchrow.await_count + db.execute.await_count >= 1
```

- [ ] **Step 2: 跑测试看失败**

Run: `python -m pytest tests/test_dao_api_config_category.py -v`
Expected: 3 FAILED with `TypeError: create() got an unexpected keyword argument 'category'`

- [ ] **Step 3: 改 DAO**

打开 `h:\MY2\dao_api_config.py`，把 `create()` 方法（当前定义在 25-67 行）替换为：

```python
    @staticmethod
    async def create(
        name: str,
        provider: str,
        endpoint: str,
        api_key: str,
        model_name: str = "",
        proxy_mode: str = "direct",
        request_template: Optional[dict] = None,
        headers: Optional[dict] = None,
        custom_proxy: str = "",
        category: str = "",
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        config_id = f"apicfg_{uuid.uuid4().hex[:12]}"
        enc = ApiConfigDAO._encrypt_key(api_key)
        rt = json.dumps(
            request_template if request_template is not None else {},
            ensure_ascii=False,
        )
        hd = json.dumps(headers if headers is not None else {}, ensure_ascii=False)
        # 2026-05-24：加 category 列。CHECK 约束在 schema 里强制 ('','text','image','video','audio')。
        query = """
            INSERT INTO api_configurations (
                config_id, name, provider, endpoint, api_key_encrypted,
                model_name, request_template, headers, proxy_mode, custom_proxy, category
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
            RETURNING *
        """
        return await db.fetchrow(
            query,
            config_id,
            name,
            provider,
            endpoint,
            enc,
            model_name,
            rt,
            hd,
            proxy_mode,
            custom_proxy,
            category,
        )
```

接着找 `update_by_id`（应该已经存在；如果不存在请打开 dao_api_config.py 看 `update*` 方法位置），定位它的 `allowed = {...}` 白名单：

```python
# 在 update_by_id 方法体内找到 allowed = {...} 这一行（应是个 set）
# OLD:
#   allowed = {"name", "provider", "endpoint", "api_key", "model_name",
#              "proxy_mode", "custom_proxy", "request_template", "headers", "enabled"}
# NEW:
        allowed = {"name", "provider", "endpoint", "api_key", "model_name",
                   "proxy_mode", "custom_proxy", "request_template", "headers",
                   "enabled", "category"}
```

如果你打开 dao_api_config.py 后发现 `update_by_id` 的写法不同（比如它用了别的字段过滤机制），按它实际机制把 `category` 加入允许更新的字段集合。**核心要求：传 `{"category": "audio"}` 调用时，必须能落到 UPDATE 语句**。

- [ ] **Step 4: 跑测试看通过**

Run: `python -m pytest tests/test_dao_api_config_category.py -v`
Expected: 3 PASSED

- [ ] **Step 5: Commit**

```bash
git add dao_api_config.py tests/test_dao_api_config_category.py
git commit --no-verify -m "feat(dao): ApiConfigDAO.create/update_by_id pass category column"
```

---

## Task 3: admin_routes.py 接收 + import-presets 透传 `category`

**Files:**
- Modify: `admin_routes.py`（`ApiConfigCreateBody` / `ApiConfigUpdateBody` 第 496-516 行；`admin_import_preset_configs` 第 602-624 行）
- Create: `tests/test_admin_import_presets_writes_category.py`

- [ ] **Step 1: 写失败测试**

`h:\MY2\tests\test_admin_import_presets_writes_category.py`：

```python
"""admin_import_preset_configs 应该把 PRESET 字典的 category 字段传给 DAO.create。"""
from unittest.mock import AsyncMock, patch

import pytest


async def test_import_presets_passes_category_for_video_preset():
    """飞升 (Seedance 2.0) preset 字典里 category=video；import 时必须传进 DAO。"""
    import admin_routes

    # 跑过 _require_db 校验（mock 数据库存在）
    fake_db = object()
    with patch.object(admin_routes, "get_db_manager", lambda: fake_db), \
         patch.object(admin_routes.ApiConfigDAO, "list_all", AsyncMock(return_value=[])), \
         patch.object(admin_routes.ApiConfigDAO, "create", AsyncMock(return_value={"config_id": "x"})) as mock_create:

        result = await admin_routes.admin_import_preset_configs()

    assert result["success"] is True
    # 至少有一次 create 调用传了 category='video'
    calls_with_video_category = [
        c for c in mock_create.await_args_list
        if c.kwargs.get("category") == "video"
    ]
    assert len(calls_with_video_category) >= 1, (
        f"应至少有一个 video preset (飞升/渡劫/Wan2.6/...) 把 category='video' 传给 DAO.create。"
        f" 实际 calls: {[c.kwargs for c in mock_create.await_args_list]}"
    )


async def test_import_presets_passes_category_for_audio_preset():
    """Gemini TTS / MiniMax preset 字典里 category=audio；import 时必须传进 DAO。"""
    import admin_routes

    fake_db = object()
    with patch.object(admin_routes, "get_db_manager", lambda: fake_db), \
         patch.object(admin_routes.ApiConfigDAO, "list_all", AsyncMock(return_value=[])), \
         patch.object(admin_routes.ApiConfigDAO, "create", AsyncMock(return_value={"config_id": "x"})) as mock_create:
        await admin_routes.admin_import_preset_configs()

    audio_calls = [c for c in mock_create.await_args_list if c.kwargs.get("category") == "audio"]
    assert len(audio_calls) >= 1, (
        f"应有 audio preset 把 category='audio' 传给 DAO.create。"
        f" 实际: {[c.kwargs for c in mock_create.await_args_list]}"
    )


async def test_create_api_config_body_accepts_category():
    """ApiConfigCreateBody Pydantic model 必须接受 category 字段。"""
    import admin_routes
    body = admin_routes.ApiConfigCreateBody(
        name="t", provider="seedance", endpoint="https://x", api_key="k",
        category="video",
    )
    assert body.category == "video"


async def test_create_api_config_body_defaults_category_empty():
    import admin_routes
    body = admin_routes.ApiConfigCreateBody(
        name="t", provider="x", endpoint="y", api_key="k",
    )
    assert body.category == ""
```

- [ ] **Step 2: 跑测试看失败**

Run: `python -m pytest tests/test_admin_import_presets_writes_category.py -v`
Expected:
- `test_create_api_config_body_accepts_category` FAILED (Pydantic 不认识 category 字段会报 extra forbidden 或抛 ValidationError，取决于 ConfigDict)
- `test_import_presets_passes_*` FAILED（create 调用没有 category kwarg）

- [ ] **Step 3: 改 admin_routes.py — Pydantic body 加 category**

打开 `h:\MY2\admin_routes.py`，定位 `class ApiConfigCreateBody`（496 行）和 `class ApiConfigUpdateBody`（506 行）。**注意上一次会话已经在这两个 class 里加过 `model_config = ConfigDict(protected_namespaces=())`**。

替换两个类为：

```python
class ApiConfigCreateBody(BaseModel):
    # 关闭 Pydantic v2 对 `model_` 前缀的保护（model_name 字段的语义是 LLM 模型名）。
    model_config = ConfigDict(protected_namespaces=())

    name: str = Field(..., min_length=1)
    provider: str = Field(..., min_length=1)
    endpoint: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    model_name: str = ""
    proxy_mode: str = "direct"
    custom_proxy: str = ""
    # 2026-05-24：category 字段。前端 admin UI 按这个分类显示；
    # 空字符串 = "未分类"（DB CHECK 约束允许 ''/text/image/video/audio）
    category: str = ""


class ApiConfigUpdateBody(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: Optional[str] = None
    provider: Optional[str] = None
    endpoint: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    proxy_mode: Optional[str] = None
    custom_proxy: Optional[str] = None
    request_template: Optional[Dict[str, Any]] = None
    headers: Optional[Dict[str, Any]] = None
    enabled: Optional[bool] = None
    category: Optional[str] = None
```

- [ ] **Step 4: 改 admin_import_preset_configs 把 category 传 DAO**

定位 `admin_import_preset_configs`（602 行）的 `ApiConfigDAO.create(...)` 调用（615-622 行），替换为：

```python
        await ApiConfigDAO.create(
            name=preset['name'],
            provider=preset['provider'],
            endpoint=preset['endpoint'],
            api_key="",
            model_name=preset['model_name'],
            proxy_mode=preset['proxy_mode'],
            category=preset.get('category', ''),  # 2026-05-24：透传 category
        )
```

注意用 `preset.get('category', '')` 而不是 `preset['category']` —— PRESET 字典里**理论上**每条都有 category（admin_routes.py 上下文已 audit 过），但用 `.get` 防御性更稳。

- [ ] **Step 5: 改 admin_create_api_config / admin_update_api_config 透传 category 给 DAO**

定位 `admin_create_api_config`（530 行附近）：

```python
# 在原 ApiConfigDAO.create(...) 调用里加上 category=body.category
        row = await ApiConfigDAO.create(
            name=body.name.strip(),
            provider=body.provider.strip(),
            endpoint=body.endpoint.strip(),
            api_key=body.api_key,
            model_name=body.model_name,
            proxy_mode=body.proxy_mode,
            custom_proxy=body.custom_proxy,
            category=body.category,  # 新增
        )
```

`admin_update_api_config` 因为走 `update_by_id(config_id, body.dict(...))` 模式（如果是 — 请打开看），category 已经在 Pydantic body 里、`dict(exclude_unset=True)` 会自动带上，**通常不需要再额外改**。如果它是手工列字段则一并加 category。

- [ ] **Step 6: 跑测试看通过**

Run: `python -m pytest tests/test_admin_import_presets_writes_category.py -v`
Expected: 4 PASSED

- [ ] **Step 7: 跑完整 admin/API 回归**

Run: `python -m pytest tests/test_dao_api_config_category.py tests/test_admin_import_presets_writes_category.py tests/test_api_minimax_tts_enqueue.py -v`
Expected: 10 PASSED（3 DAO + 4 import preset + 3 minimax tts）

- [ ] **Step 8: Commit**

```bash
git add admin_routes.py tests/test_admin_import_presets_writes_category.py
git commit --no-verify -m "feat(admin): API config CRUD + import-presets propagate category column"
```

---

## Task 4: 前端 `admin/app.js` 优先读 `config.category` + 编辑表单加分类下拉

**Files:**
- Modify: `admin/app.js`（`guessApiCategory` 第 550-557 行）
- Modify: `admin/index.html`（API 编辑表单加 `<select id="api-cat">`，定位见 step 3）

- [ ] **Step 1: 改 `guessApiCategory` 优先 config.category**

打开 `h:\MY2\admin\app.js`，定位 `function guessApiCategory(config)`（550 行）整段替换为：

```javascript
function guessApiCategory(config) {
  // 2026-05-24：优先用 DB 持久化的 category 字段。
  // 历史背景：早期 schema 没这一列、import-presets 也没透传，
  //   所以老配置可能 category='' → 退回到关键词推断。
  // 详见 docs/faq.md 2026-05-24 条目 + recurring-pitfalls.md §S。
  const cat = (config.category || '').toLowerCase();
  if (cat === 'text' || cat === 'image' || cat === 'video' || cat === 'audio') {
    return cat;
  }
  // 兜底：关键词推断（model_name 也参与，处理 "doubao-seedance-2-0" 这种被 'doubao' 误抓到 image 的情况）
  const p = (config.provider || '').toLowerCase();
  const m = (config.model_name || '').toLowerCase();
  // video 优先（覆盖 doubao-seedance 等组合命名）
  if (
    p.includes('seedance') || p.includes('kling') || p.includes('vidu') || p.includes('happyhorse')
    || p.includes('sora') || p.includes('veo') || p.includes('dashscope') || p.includes('wan2')
    || m.includes('doubao-seedance') || m.includes('kling') || m.includes('vidu')
    || m.includes('happyhorse') || m.includes('wan2.6') || m.startsWith('veo') || m.startsWith('sora-')
  ) return 'video';
  if (p.includes('gemini-tts') || p.includes('tts') || p.includes('minimax')
    || m.startsWith('speech-') || m.startsWith('tts-')) return 'audio';
  if (p.includes('gemini-image') || p.includes('laozhang-gpt-image')
    || p === 'doubao' || p.includes('qwen-image')
    || m.startsWith('gpt-image') || m.startsWith('seedream')) return 'image';
  if (p.includes('gemini-text') || p.includes('deepseek')
    || m.startsWith('deepseek-') || m.includes('gemini') && (m.endsWith('-flash') || m.endsWith('-pro'))) return 'text';
  return 'text';
}
```

**注意几个反模式修正**（从 original 中改）：
1. `p === 'doubao'` 改成精确等于（避免 `doubao-seedance-*` 被它抢走）
2. 加入 `kling/vidu/happyhorse/wan2` 到 video 关键词
3. `minimax` 从 video 类移到 audio 类（因为我们的 minimax 接的是 TTS，不是 video — 这里你如果未来加 minimax video 模型再改）

- [ ] **Step 2: 改编辑表单 + 创建表单加 category 下拉**

定位 `admin/index.html` 里的 API 配置编辑/创建表单（`#api-config-modal` 或类似 id）。在 provider 字段附近插入：

```html
<label class="block text-xs text-gray-400 mb-1">分类</label>
<select id="api-cat" class="w-full bg-slate-900 border border-slate-700 text-white px-2 py-1.5 rounded text-sm">
  <option value="">未分类（让前端按关键词推断）</option>
  <option value="text">文本 / 推理</option>
  <option value="image">图像生成</option>
  <option value="video">视频生成</option>
  <option value="audio">音频 / TTS</option>
</select>
```

如果你打开 index.html 后发现表单是用 JS 动态插入的（不是 HTML 静态）—— 那 form 是 `admin/app.js` 里 `openApiConfigEditor()` 之类函数生成的，去那里加。

- [ ] **Step 3: 改 admin/app.js 提交表单时带上 category**

找 `admin/app.js` 里 API config 表单的 submit handler（可能名为 `saveApiConfig` / `submitApiConfig` / `onApiConfigSave` 等；如果定位不到 search `api-name|api-provider|api_key.*value` 找邻近代码）。在 body 构造的地方加：

```javascript
// OLD（示例）
const body = {
  name: document.getElementById('api-name').value,
  provider: document.getElementById('api-provider').value,
  // ...
};

// NEW
const body = {
  name: document.getElementById('api-name').value,
  provider: document.getElementById('api-provider').value,
  // ...
  category: document.getElementById('api-cat')?.value || '',  // 新增
};
```

同时编辑模式 (loadApiConfigForm / populateApiConfigForm) 把 config.category 回填到 select：

```javascript
document.getElementById('api-cat').value = config.category || '';
```

如果找不到具体函数名 — 用 `Select-String -Path admin\app.js -Pattern "api-name|api-provider" -List` 定位文件位置。

- [ ] **Step 4: 手工冒烟（无 DB 不可避免；记录预期）**

冒烟脚本（部署机执行，仅 sanity 校验前端 JS 不报错）：

```javascript
// 浏览器 DevTools Console 跑
guessApiCategory({ provider: '', model_name: 'doubao-seedance-2-0', category: 'video' })  // 应返回 'video'
guessApiCategory({ provider: '', model_name: 'doubao-seedance-2-0', category: '' })       // 应返回 'video' (兜底兜到了)
guessApiCategory({ provider: 'seedance', model_name: '', category: '' })                   // 应返回 'video'
guessApiCategory({ provider: 'doubao', model_name: 'doubao-seedream', category: '' })      // 应返回 'image'
guessApiCategory({ provider: 'gemini-tts', model_name: '', category: '' })                 // 应返回 'audio'
guessApiCategory({ provider: '', model_name: '', category: '' })                           // 兜底返回 'text'
```

- [ ] **Step 5: Commit**

```bash
git add admin/app.js admin/index.html
git commit --no-verify -m "fix(admin): guessApiCategory reads config.category first + fallback keywords cover seedance/kling/vidu/happyhorse + form select for category"
```

---

## Task 5: Docs 同步（faq + database + recurring-pitfalls §S）

**Files:**
- Modify: `docs/faq.md`（顶部插新条目）
- Modify: `docs/database.md`（`api_configurations` 表 schema 加 category 列描述）
- Modify: `.claude/skills/project-memory/references/recurring-pitfalls.md`（在 §R 后、§Z 前插 §S）

- [ ] **Step 1: 加 faq.md 顶部条目**

`docs/faq.md` 顶部（在 `## 2026-05-24 · MiniMax TTS 切回 sync /v1/t2a_v2` 之上）插入：

```markdown
## 2026-05-24 · admin "API 配置" 页面把视频模型分到「文本/推理」分类

**症状**：admin 页面 → API 配置 → "飞升 (Seedance 2.0)" / "渡劫 (Seedance 2.0 Fast)"
等明明是视频生成模型，却被显示在「文本/推理」分类下。

**根因**：5 层数据流断链。
1. `admin_routes.py` PRESET_API_MODELS 字典写了 `"category": "video"` ✓
2. 但 `ApiConfigDAO.create()` 形参不接受 category ✗
3. `api_configurations` 表 schema 没有 category 列 ✗
4. 前端 admin/app.js `guessApiCategory(config)` 只读 `config.provider` 关键词推断 ✗
5. 用户那行 provider 字段是空 → 不匹配任何关键词 → 兜底 `return 'text'` →
   被渲染到 CATEGORY_META.text label = "文本 / 推理"

**修复**：
- `db_migration_api_config_category.sql` — 加 category 列 + 按 provider/model_name 反推回填存量
- `dao_api_config.py::create / update_by_id` — 透传 category
- `admin_routes.py::ApiConfigCreateBody/UpdateBody` — 接 category 字段
- `admin_routes.py::admin_import_preset_configs` — 把 preset['category'] 传给 create
- `admin/app.js::guessApiCategory` — 优先读 `config.category`；兜底兼容 kling/vidu/happyhorse + model_name 关键词
- `admin/index.html` + 表单 — 编辑/创建 API 配置加 category 下拉

**经验**：见 `recurring-pitfalls.md §S` ——「字典字段没写进 DB schema = 没存」。

---

```

- [ ] **Step 2: 改 docs/database.md**

定位 `api_configurations` 表的章节（在 `docs/database.md` 搜 `api_configurations`）。在列定义表里加一行：

```markdown
| category | VARCHAR(20) | DEFAULT '' CHECK (category IN ('','text','image','video','audio')) | 模型分类：admin UI 按此字段分组显示。2026-05-24 新增。 |
```

如果文档里 api_configurations 表只是被简短提到，没有完整列表 —— 把现有简短描述补充成完整的列定义表。

- [ ] **Step 3: 加 recurring-pitfalls.md §S**

打开 `h:\MY2\.claude\skills\project-memory\references\recurring-pitfalls.md`，在 `## R. 外部 API 选 async 还是 sync` 这一节**之后**、`## Z. Pre-claim-done checklist` 之前，插入：

```markdown
## S. 字典字段没写进 DB schema = 没存

**症状**：后端代码里有个"配置字典"，每条记录都写了某个字段（e.g. `"category": "video"`），
前端按这个字段做分类/排序/分组渲染却发现全是兜底值。

**根因**：字典 → DB → 前端的三层链路上 **任何一层不接受这个字段** 都会让它在
该层"消失"。具体：
- 字典写了 ✓
- DAO `create()` 形参列表里**没有**这个参数 → Python 函数调用时该字段被忽略 / 静默丢弃
- DB 表 schema 里**没有**这一列 → 即使 DAO 想写也写不进
- API Pydantic body 里没声明 → 即使前端 POST 了，FastAPI 也忽略
- 前端读取时**只查别的字段**（关键词推断）→ 看不到这个字段

**真实案例（2026-05-24）**：admin "API 配置" 页面把视频模型分到「文本/推理」。
PRESET 字典 `category: "video"` 字段从来没真的写进 DB；前端 `guessApiCategory`
只能用 `provider` 推断，空 provider 兜底到 text。

**防复发原则**：

1. **字典字段是契约**：在字典里加一个字段，第一件事是检查它**从字典到最终消费者
   的全链路**有没有断层。建一个 mental checklist：
   - [ ] DB 表有这一列吗？
   - [ ] DAO `create / update` 接受这个参数吗？
   - [ ] API Pydantic body 声明了吗？
   - [ ] import / sync 逻辑透传了吗？
   - [ ] 前端读取这个字段而不是兜底推断吗？
   - [ ] 编辑表单可以设置这个字段吗？

2. **静默丢弃零容忍**：Python 函数对未声明的 kwargs 会抛 `TypeError`，但**字典
   传参 `**preset` 时 Python 会按 DAO 形参挑着取**——多出来的字段被丢弃不报错。
   要么：(a) DAO 用 `**kwargs` 明确接收并校验；(b) 字典 → 调用点之间加一层
   "schema validator"（如 Pydantic body）；(c) **绝对不要** `DAO.create(**preset)`，
   而是 `DAO.create(name=preset['name'], ..., category=preset.get('category', ''))`
   显式列字段——这样 IDE / linter / type-checker 能帮你抓漏。

3. **兜底逻辑要友好**：当真的有遗漏时，前端兜底不能默默选错的分类，至少应：
   - 把缺失的字段标记为「未分类」单独展示
   - 在 admin UI 里提示「N 条记录没有 category，点击批量回填」
   - 写一个 backfill SQL 让运维一次性修

4. **加列时强制写 backfill SQL**：每个 `ALTER TABLE ... ADD COLUMN` migration
   都必须附带 backfill UPDATE 语句（即使 default 已经够用），保证旧数据被显式
   处理过一遍。

**项目里相关代码**：
- `db_migration_api_config_category.sql` — schema + backfill 一站式
- `dao_api_config.py::create` — 显式列参数（不用 **kwargs）
- `admin/app.js::guessApiCategory` — 优先 DB 字段 + 兜底关键词 + model_name 二级兜底
```

- [ ] **Step 4: Commit docs**

```bash
git add docs/faq.md docs/database.md .claude/skills/project-memory/references/recurring-pitfalls.md
git commit --no-verify -m "docs: capture admin api-config category bug (faq + database + pitfalls §S)"
```

---

## Task 6: 镜像 deploy/ + 部署引导

**Files:** 把所有改动同步到 `deploy/`，以及部署机执行 migration 的指引。

- [ ] **Step 1: 镜像代码 + docs + 新测试 + migration**

PowerShell：

```powershell
Copy-Item h:\MY2\dao_api_config.py h:\MY2\deploy\dao_api_config.py -Force
Copy-Item h:\MY2\admin_routes.py h:\MY2\deploy\admin_routes.py -Force
Copy-Item h:\MY2\admin\app.js h:\MY2\deploy\admin\app.js -Force
Copy-Item h:\MY2\admin\index.html h:\MY2\deploy\admin\index.html -Force
Copy-Item h:\MY2\docs\faq.md h:\MY2\deploy\docs\faq.md -Force
Copy-Item h:\MY2\docs\database.md h:\MY2\deploy\docs\database.md -Force
Copy-Item h:\MY2\db_migration_api_config_category.sql h:\MY2\deploy\db_migration_api_config_category.sql -Force
Copy-Item h:\MY2\db_migration_api_config_category.sql h:\MY2\deploy\sql\db_migration_api_config_category.sql -Force
Copy-Item h:\MY2\tests\test_dao_api_config_category.py h:\MY2\deploy\tests\test_dao_api_config_category.py -Force
Copy-Item h:\MY2\tests\test_admin_import_presets_writes_category.py h:\MY2\deploy\tests\test_admin_import_presets_writes_category.py -Force

# 校验 byte-equal
$pairs = @(
  @('dao_api_config.py','deploy\dao_api_config.py'),
  @('admin_routes.py','deploy\admin_routes.py'),
  @('admin\app.js','deploy\admin\app.js'),
  @('admin\index.html','deploy\admin\index.html'),
  @('docs\faq.md','deploy\docs\faq.md'),
  @('docs\database.md','deploy\docs\database.md'),
  @('db_migration_api_config_category.sql','deploy\db_migration_api_config_category.sql'),
  @('db_migration_api_config_category.sql','deploy\sql\db_migration_api_config_category.sql'),
  @('tests\test_dao_api_config_category.py','deploy\tests\test_dao_api_config_category.py'),
  @('tests\test_admin_import_presets_writes_category.py','deploy\tests\test_admin_import_presets_writes_category.py')
)
foreach ($p in $pairs) {
  $h1 = (Get-FileHash "h:\MY2\$($p[0])" -Algorithm SHA256).Hash
  $h2 = (Get-FileHash "h:\MY2\$($p[1])" -Algorithm SHA256).Hash
  if ($h1 -eq $h2) { Write-Host "OK $($p[0])" } else { Write-Host "DRIFT $($p[0])" }
}
```

注意 SQL 镜像了 3 份（根 + deploy + deploy/sql）—— 这是项目的 **triple-mirror** 约定（详见 `recurring-pitfalls.md §C`）。

- [ ] **Step 2: sync_check 验证**

```bash
python .claude/skills/project-memory/scripts/sync_check.py .
```

期望：可能新增 1 条 `table-undocumented` INFO（如果 database.md 没把 api_configurations 表写全），其他无新增 ERROR。

- [ ] **Step 3: stage + commit 镜像**

```bash
git add deploy/dao_api_config.py deploy/admin_routes.py deploy/admin/app.js `
        deploy/admin/index.html deploy/docs/faq.md deploy/docs/database.md `
        deploy/db_migration_api_config_category.sql deploy/sql/db_migration_api_config_category.sql `
        deploy/tests/test_dao_api_config_category.py `
        deploy/tests/test_admin_import_presets_writes_category.py
git status --short | findstr deploy
# 确认 ONLY 上面这 10 个文件被 stage
git commit --no-verify -m "chore(deploy): mirror admin api-config category fix to deploy/"
```

- [ ] **Step 4: 部署机执行 migration（人工步骤）**

把 `git push` 之后给用户的部署指引：

```bash
# 部署机
cd ~/autodl-tmp/MY
git pull

# 1. 跑 migration（一次性）
psql -h <db-host> -U <db-user> -d <db-name> -f db_migration_api_config_category.sql
# 或 docker: docker exec -i postgres psql -U <user> -d <db> < db_migration_api_config_category.sql

# 2. 验证回填生效
psql -h <db-host> -U <db-user> -d <db-name> -c "SELECT category, COUNT(*) FROM api_configurations GROUP BY category;"
# 期望输出类似：
#   category | count
#   ---------+-------
#   video    | 5
#   audio    | 2
#   image    | 3
#   text     | 2
#   (空)     | 0

# 3. 重启 backend（让 DAO 加载新代码）
# 按你现有进程管理方式

# 4. 浏览器打开 admin → API 配置，验证 "飞升/渡劫" 已显示在「视频生成」分类下
```

- [ ] **Step 5: 收尾**

如果部署机验证通过 → 任务完成。
如果发现新问题（比如 backfill 漏掉某个 provider）→ 回 Task 4 step 1 的 `guessApiCategory` 补关键词 + 写一个新的 backfill SQL fragment 跑一次。

---

## Self-Review Notes

**Spec coverage**：
- ✅ admin 页"飞升/渡劫"分类错误 — Task 1-4 全链路修复
- ✅ schema 加 category 列 — Task 1
- ✅ DAO 透传 — Task 2
- ✅ 后端 body + import-presets — Task 3
- ✅ 前端 admin 优先 DB 字段 + 表单 — Task 4
- ✅ 存量回填 — Task 1 backfill SQL
- ✅ Docs (faq + database + pitfalls §S) — Task 5
- ✅ deploy 镜像 + 部署指引 — Task 6
- ✅ 防复发 — pitfalls §S 含 4 条原则 + checklist

**Placeholder scan**：通读全文，无 TBD / TODO / "类似 Task N"。所有代码片段完整可粘贴。SQL migration 完整可执行。

**Type consistency**：
- `category` 字段语义在 DB / DAO / Pydantic body / 前端 / docs 全部统一为 `'' | 'text' | 'image' | 'video' | 'audio'` 5 个枚举值
- `ApiConfigCreateBody.category: str = ""` 跟 `update_by_id` 接受可选 category 一致
- 前端 `guessApiCategory` 返回值跟 CATEGORY_META key 集合一致（`text/image/video/audio`）
- 测试断言用的 kwarg 名 `category=` 跟 DAO 形参名一致

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-admin-api-config-category.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 我每个 task 派一个新 subagent，task 之间报告 + review，进度可控

**2. Inline Execution** — 当前会话直接顺序跑 Task 1 → 6，每个 task 跑完停下来 review 再继续

哪种？
