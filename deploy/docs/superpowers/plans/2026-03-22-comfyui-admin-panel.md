# ComfyUI 集群管理后台实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个独立的 ComfyUI 集群管理后台，支持 Agent 注册/拉取架构、工作流模板可视化管理、AI API 配置（含智能代理路由），以及实时集群监控仪表盘。

**Architecture:** 管理后台为独立 HTML + JS 应用，挂载到现有 FastAPI 的 `/admin/` 路径。GPU 服务器部署轻量 Agent 脚本，通过 HTTP 轮询拉取任务（ComfyUI 生成 + 外部 API 代理调用），结果通过 multipart POST 回传。数据全部存储在 PostgreSQL（5 张新表），任务队列复用现有 Redis。

**Tech Stack:** Python FastAPI + asyncpg (后端), HTML + Vanilla JS + Tailwind CSS (独立管理前端), PostgreSQL (配置存储), Redis (任务队列), aiohttp (Agent HTTP 通信)

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `db_migration_admin.sql` | 5 张新表的 DDL |
| `dao_agent.py` | comfyui_agents 表 CRUD |
| `dao_workflow_template.py` | workflow_templates 表 CRUD |
| `dao_api_config.py` | api_configurations 表 CRUD（含密钥加密） |
| `dao_task_history.py` | task_history 表 CRUD + 统计查询 |
| `dao_system_settings.py` | system_settings 表 KV 读写 |
| `agent_routes.py` | Agent 通信 4 个接口 (register/heartbeat/poll/complete) |
| `admin_routes.py` | 管理后台 CRUD API (~20 个接口) |
| `api_router.py` | 智能 API 路由器（直连 vs Agent 代理） |
| `comfyui_agent.py` | GPU 服务器部署的 Agent 脚本 |
| `admin/index.html` | 管理后台入口页 |
| `admin/app.js` | 前端主逻辑（路由、API 调用、渲染） |
| `admin/style.css` | 自定义样式 |
| `tests/test_dao_agent.py` | Agent DAO 测试 |
| `tests/test_dao_workflow_template.py` | 工作流模板 DAO 测试 |
| `tests/test_dao_api_config.py` | API 配置 DAO 测试 |
| `tests/test_agent_routes.py` | Agent 通信接口测试 |
| `tests/test_api_router.py` | 智能路由器测试 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `cluster_main.py` (~行 76-158, ~260) | lifespan 中初始化新模块；挂载 admin 静态文件和路由 |
| `cluster_config.py` (~行 32-98) | ClusterConfig 增加 `from_database()` 方法，支持从 PG 读取 |
| `cluster_manager.py` (~行 25-47) | 初始化支持动态节点列表（来自 Agent 注册） |
| `workflow_handler.py` (~行 15-41) | 支持从 DB 加载工作流模板 |

---

## Task 1: 数据库迁移脚本

**Files:**
- Create: `db_migration_admin.sql`

- [ ] **Step 1: 编写 5 张表的 DDL**

```sql
-- db_migration_admin.sql
-- ComfyUI 集群管理后台数据库迁移

-- ====== 表1: comfyui_agents ======
CREATE TABLE IF NOT EXISTS comfyui_agents (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL DEFAULT '',
    token VARCHAR(64) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'offline'
        CHECK (status IN ('online', 'offline', 'busy', 'disabled')),
    last_heartbeat TIMESTAMP,
    system_info JSONB DEFAULT '{}'::jsonb,
    comfyui_instances JSONB DEFAULT '[]'::jsonb,
    stats JSONB DEFAULT '{"tasks_completed":0,"tasks_failed":0,"avg_time":0}'::jsonb,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agents_token ON comfyui_agents(token);
CREATE INDEX IF NOT EXISTS idx_agents_status ON comfyui_agents(status);

-- ====== 表2: workflow_templates ======
CREATE TABLE IF NOT EXISTS workflow_templates (
    id SERIAL PRIMARY KEY,
    template_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'image'
        CHECK (category IN ('image', 'video', 'upscale', 'interpolation', 'audio', 'other')),
    description TEXT DEFAULT '',
    workflow_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    placeholders JSONB DEFAULT '[]'::jsonb,
    node_type VARCHAR(20) DEFAULT 'any',
    estimated_time INT DEFAULT 30,
    enabled BOOLEAN DEFAULT true,
    version INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wf_templates_category ON workflow_templates(category);
CREATE INDEX IF NOT EXISTS idx_wf_templates_enabled ON workflow_templates(enabled);

-- ====== 表3: api_configurations ======
CREATE TABLE IF NOT EXISTS api_configurations (
    id SERIAL PRIMARY KEY,
    config_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    api_key_encrypted TEXT DEFAULT '',
    model_name VARCHAR(100) DEFAULT '',
    request_template JSONB DEFAULT '{}'::jsonb,
    headers JSONB DEFAULT '{}'::jsonb,
    proxy_mode VARCHAR(20) DEFAULT 'direct'
        CHECK (proxy_mode IN ('direct', 'agent', 'custom')),
    custom_proxy VARCHAR(200) DEFAULT '',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ====== 表4: task_history ======
CREATE TABLE IF NOT EXISTS task_history (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(50),
    workflow_id VARCHAR(50),
    task_type VARCHAR(20) NOT NULL DEFAULT 'comfyui'
        CHECK (task_type IN ('comfyui', 'api_call')),
    params JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    result JSONB DEFAULT '{}'::jsonb,
    error_message TEXT DEFAULT '',
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_history_agent ON task_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history(status);
CREATE INDEX IF NOT EXISTS idx_task_history_type ON task_history(task_type);
CREATE INDEX IF NOT EXISTS idx_task_history_queued ON task_history(queued_at DESC);

-- ====== 表5: system_settings ======
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT DEFAULT '',
    description VARCHAR(255) DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (key, value, description) VALUES
    ('proxy_http', '', 'HTTP代理地址，如 http://127.0.0.1:7890'),
    ('proxy_https', '', 'HTTPS代理地址'),
    ('proxy_socks5', '', 'SOCKS5代理地址'),
    ('proxy_no_proxy', '127.0.0.1,localhost', '不走代理的地址')
ON CONFLICT (key) DO NOTHING;

-- ====== 所有表的 updated_at 触发器 ======
CREATE OR REPLACE FUNCTION update_admin_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agents_updated ON comfyui_agents;
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON comfyui_agents
    FOR EACH ROW EXECUTE FUNCTION update_admin_updated_at();

DROP TRIGGER IF EXISTS trg_wf_templates_updated ON workflow_templates;
CREATE TRIGGER trg_wf_templates_updated BEFORE UPDATE ON workflow_templates
    FOR EACH ROW EXECUTE FUNCTION update_admin_updated_at();

DROP TRIGGER IF EXISTS trg_api_configs_updated ON api_configurations;
CREATE TRIGGER trg_api_configs_updated BEFORE UPDATE ON api_configurations
    FOR EACH ROW EXECUTE FUNCTION update_admin_updated_at();

DROP TRIGGER IF EXISTS trg_sys_settings_updated ON system_settings;
CREATE TRIGGER trg_sys_settings_updated BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_admin_updated_at();
```

- [ ] **Step 2: 执行迁移脚本验证**

使用现有的 asyncpg 方式执行（参考之前的迁移脚本执行方式）：
```bash
python -c "
import asyncio, asyncpg
async def run():
    conn = await asyncpg.connect('postgresql://my2_user:<DB_PASSWORD>@localhost/my2_db')
    with open('db_migration_admin.sql') as f:
        await conn.execute(f.read())
    await conn.close()
    print('Migration OK')
asyncio.run(run())
"
```

- [ ] **Step 3: Commit**

```bash
git add db_migration_admin.sql
git commit -m "feat: add admin panel database migration (5 tables)"
```

---

## Task 2: DAO 层 — Agent 管理

**Files:**
- Create: `dao_agent.py`
- Create: `tests/test_dao_agent.py`

- [ ] **Step 1: 编写 Agent DAO 测试**

```python
# tests/test_dao_agent.py
import pytest

async def test_create_agent(test_db):
    from dao_agent import AgentDAO
    agent = await AgentDAO.create(name="Test-GPU-01", token="sk-test-token-001")
    assert agent is not None
    assert agent["agent_id"].startswith("agent_")
    assert agent["name"] == "Test-GPU-01"
    assert agent["status"] == "offline"

async def test_get_by_token(test_db):
    from dao_agent import AgentDAO
    created = await AgentDAO.create(name="GPU-A", token="sk-unique-token")
    found = await AgentDAO.get_by_token("sk-unique-token")
    assert found is not None
    assert found["agent_id"] == created["agent_id"]

async def test_get_by_token_not_found(test_db):
    from dao_agent import AgentDAO
    found = await AgentDAO.get_by_token("nonexistent-token")
    assert found is None

async def test_update_heartbeat(test_db):
    from dao_agent import AgentDAO
    agent = await AgentDAO.create(name="GPU-B", token="sk-hb-token")
    instances = [{"port": 8188, "status": "healthy"}, {"port": 8189, "status": "healthy"}]
    system_info = {"gpu": "A100", "vram": "80GB"}
    updated = await AgentDAO.update_heartbeat(
        agent["agent_id"], status="online",
        comfyui_instances=instances, system_info=system_info
    )
    assert updated["status"] == "online"
    assert updated["last_heartbeat"] is not None

async def test_list_all_agents(test_db):
    from dao_agent import AgentDAO
    await AgentDAO.create(name="G1", token="sk-list-1")
    await AgentDAO.create(name="G2", token="sk-list-2")
    agents = await AgentDAO.list_all()
    assert len(agents) >= 2

async def test_get_online_agents(test_db):
    from dao_agent import AgentDAO
    a1 = await AgentDAO.create(name="Online", token="sk-on")
    await AgentDAO.update_heartbeat(a1["agent_id"], status="online")
    a2 = await AgentDAO.create(name="Offline", token="sk-off")
    online = await AgentDAO.get_online_agents()
    ids = [a["agent_id"] for a in online]
    assert a1["agent_id"] in ids
    assert a2["agent_id"] not in ids

async def test_delete_agent(test_db):
    from dao_agent import AgentDAO
    agent = await AgentDAO.create(name="ToDelete", token="sk-del")
    deleted = await AgentDAO.delete(agent["agent_id"])
    assert deleted is True
    found = await AgentDAO.get_by_id(agent["agent_id"])
    assert found is None

async def test_generate_token(test_db):
    from dao_agent import AgentDAO
    token = AgentDAO.generate_token()
    assert token.startswith("sk-agent-")
    assert len(token) > 20
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_dao_agent.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'dao_agent'`

- [ ] **Step 3: 实现 Agent DAO**

```python
# dao_agent.py
import uuid
import json
import secrets
from typing import List, Dict, Any, Optional
from db_manager import get_db_manager


class AgentDAO:

    @staticmethod
    def generate_token() -> str:
        return f"sk-agent-{secrets.token_hex(24)}"

    @staticmethod
    async def create(name: str, token: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        agent_id = f"agent_{uuid.uuid4().hex[:12]}"
        return await db.fetchrow(
            """INSERT INTO comfyui_agents (agent_id, name, token)
               VALUES ($1, $2, $3) RETURNING *""",
            agent_id, name, token
        )

    @staticmethod
    async def get_by_id(agent_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM comfyui_agents WHERE agent_id = $1", agent_id
        )

    @staticmethod
    async def get_by_token(token: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM comfyui_agents WHERE token = $1", token
        )

    @staticmethod
    async def update_heartbeat(
        agent_id: str,
        status: str = "online",
        comfyui_instances: Optional[list] = None,
        system_info: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            """UPDATE comfyui_agents
               SET status = $2, last_heartbeat = CURRENT_TIMESTAMP,
                   comfyui_instances = COALESCE($3::jsonb, comfyui_instances),
                   system_info = COALESCE($4::jsonb, system_info)
               WHERE agent_id = $1 RETURNING *""",
            agent_id, status,
            json.dumps(comfyui_instances, ensure_ascii=False) if comfyui_instances else None,
            json.dumps(system_info, ensure_ascii=False) if system_info else None,
        )

    @staticmethod
    async def update_stats(agent_id: str, stats: dict) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            """UPDATE comfyui_agents SET stats = $2::jsonb
               WHERE agent_id = $1 RETURNING *""",
            agent_id, json.dumps(stats, ensure_ascii=False)
        )

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM comfyui_agents ORDER BY created_at DESC"
        )

    @staticmethod
    async def get_online_agents() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM comfyui_agents WHERE status = 'online' AND enabled = true ORDER BY created_at"
        )

    @staticmethod
    async def set_enabled(agent_id: str, enabled: bool) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "UPDATE comfyui_agents SET enabled = $2 WHERE agent_id = $1 RETURNING *",
            agent_id, enabled
        )

    @staticmethod
    async def delete(agent_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM comfyui_agents WHERE agent_id = $1", agent_id
        )
        return result == "DELETE 1"

    @staticmethod
    async def mark_stale_offline(timeout_seconds: int = 15) -> int:
        """将超过 timeout_seconds 未心跳的 Agent 标记为 offline"""
        db = get_db_manager()
        if not db:
            return 0
        result = await db.execute(
            """UPDATE comfyui_agents SET status = 'offline'
               WHERE status = 'online'
               AND last_heartbeat < CURRENT_TIMESTAMP - INTERVAL '%s seconds'""" % timeout_seconds
        )
        count = int(result.split()[-1]) if result else 0
        return count
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_dao_agent.py -v
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add dao_agent.py tests/test_dao_agent.py
git commit -m "feat: add Agent DAO with CRUD and heartbeat support"
```

---

## Task 3: DAO 层 — 工作流模板

**Files:**
- Create: `dao_workflow_template.py`
- Create: `tests/test_dao_workflow_template.py`

- [ ] **Step 1: 编写工作流模板 DAO 测试**

```python
# tests/test_dao_workflow_template.py
import pytest

SAMPLE_JSON = {"3": {"inputs": {"text": "{prompt}"}, "class_type": "CLIPTextEncode"}}
SAMPLE_PLACEHOLDERS = [{"key": "prompt", "label": "提示词", "node_id": "3", "field": "inputs.text", "type": "text", "required": True, "default": ""}]

async def test_create_template(test_db):
    from dao_workflow_template import WorkflowTemplateDAO
    t = await WorkflowTemplateDAO.create(
        name="文生图-测试", category="image",
        workflow_json=SAMPLE_JSON, placeholders=SAMPLE_PLACEHOLDERS
    )
    assert t is not None
    assert t["template_id"].startswith("wft_")
    assert t["name"] == "文生图-测试"
    assert t["version"] == 1

async def test_get_by_name(test_db):
    from dao_workflow_template import WorkflowTemplateDAO
    await WorkflowTemplateDAO.create(name="查找测试", category="video", workflow_json={})
    found = await WorkflowTemplateDAO.get_by_name("查找测试")
    assert found is not None
    assert found["category"] == "video"

async def test_list_enabled(test_db):
    from dao_workflow_template import WorkflowTemplateDAO
    await WorkflowTemplateDAO.create(name="启用的", category="image", workflow_json={})
    t2 = await WorkflowTemplateDAO.create(name="禁用的", category="image", workflow_json={})
    await WorkflowTemplateDAO.update(t2["template_id"], enabled=False)
    enabled = await WorkflowTemplateDAO.list_enabled()
    names = [t["name"] for t in enabled]
    assert "启用的" in names
    assert "禁用的" not in names

async def test_update_increments_version(test_db):
    from dao_workflow_template import WorkflowTemplateDAO
    t = await WorkflowTemplateDAO.create(name="版本测试", category="image", workflow_json={"old": True})
    updated = await WorkflowTemplateDAO.update(t["template_id"], workflow_json={"new": True})
    assert updated["version"] == 2

async def test_delete_template(test_db):
    from dao_workflow_template import WorkflowTemplateDAO
    t = await WorkflowTemplateDAO.create(name="删除测试", category="image", workflow_json={})
    assert await WorkflowTemplateDAO.delete(t["template_id"]) is True
    assert await WorkflowTemplateDAO.get_by_id(t["template_id"]) is None

async def test_parse_nodes_from_json(test_db):
    from dao_workflow_template import WorkflowTemplateDAO
    workflow = {
        "3": {"inputs": {"text": "{prompt}", "seed": 42}, "class_type": "CLIPTextEncode"},
        "5": {"inputs": {"steps": 20, "cfg": 7.5, "seed": "{seed}"}, "class_type": "KSampler"}
    }
    nodes = WorkflowTemplateDAO.parse_nodes(workflow)
    assert len(nodes) >= 2
    assert any(n["node_id"] == "3" for n in nodes)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_dao_workflow_template.py -v
```

- [ ] **Step 3: 实现工作流模板 DAO**

```python
# dao_workflow_template.py
import uuid
import json
import re
from typing import List, Dict, Any, Optional
from db_manager import get_db_manager


class WorkflowTemplateDAO:

    @staticmethod
    async def create(
        name: str, category: str, workflow_json: dict,
        placeholders: Optional[list] = None,
        description: str = '', node_type: str = 'any',
        estimated_time: int = 30
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        tid = f"wft_{uuid.uuid4().hex[:12]}"
        return await db.fetchrow(
            """INSERT INTO workflow_templates
               (template_id, name, category, description, workflow_json, placeholders,
                node_type, estimated_time)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) RETURNING *""",
            tid, name, category, description,
            json.dumps(workflow_json, ensure_ascii=False),
            json.dumps(placeholders or [], ensure_ascii=False),
            node_type, estimated_time
        )

    @staticmethod
    async def get_by_id(template_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM workflow_templates WHERE template_id = $1", template_id
        )

    @staticmethod
    async def get_by_name(name: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM workflow_templates WHERE name = $1", name
        )

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM workflow_templates ORDER BY category, name"
        )

    @staticmethod
    async def list_enabled() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM workflow_templates WHERE enabled = true ORDER BY category, name"
        )

    @staticmethod
    async def update(template_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        sets, vals, idx = [], [], 1
        json_fields = {'workflow_json', 'placeholders'}
        version_bump = False
        for k, v in kwargs.items():
            if k in json_fields:
                sets.append(f"{k} = ${idx}::jsonb")
                vals.append(json.dumps(v, ensure_ascii=False))
                if k == 'workflow_json':
                    version_bump = True
            else:
                sets.append(f"{k} = ${idx}")
                vals.append(v)
            idx += 1
        if version_bump:
            sets.append("version = version + 1")
        if not sets:
            return await WorkflowTemplateDAO.get_by_id(template_id)
        vals.append(template_id)
        return await db.fetchrow(
            f"UPDATE workflow_templates SET {', '.join(sets)} WHERE template_id = ${idx} RETURNING *",
            *vals
        )

    @staticmethod
    async def delete(template_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM workflow_templates WHERE template_id = $1", template_id
        )
        return result == "DELETE 1"

    @staticmethod
    def parse_nodes(workflow_json: dict) -> List[Dict[str, Any]]:
        """解析 ComfyUI workflow JSON，返回所有节点及其字段列表"""
        nodes = []
        for node_id, node_data in workflow_json.items():
            if not isinstance(node_data, dict) or "inputs" not in node_data:
                continue
            class_type = node_data.get("class_type", "Unknown")
            inputs = node_data.get("inputs", {})
            for field_name, field_value in inputs.items():
                if isinstance(field_value, list):
                    continue
                is_placeholder = (isinstance(field_value, str)
                                  and re.match(r'^\{.+\}$', str(field_value)))
                nodes.append({
                    "node_id": str(node_id),
                    "class_type": class_type,
                    "field": f"inputs.{field_name}",
                    "current_value": field_value,
                    "is_placeholder": bool(is_placeholder),
                })
        return nodes
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_dao_workflow_template.py -v
```

- [ ] **Step 5: Commit**

```bash
git add dao_workflow_template.py tests/test_dao_workflow_template.py
git commit -m "feat: add workflow template DAO with node parsing"
```

---

## Task 4: DAO 层 — API 配置 + 系统设置 + 任务历史

**Files:**
- Create: `dao_api_config.py`
- Create: `dao_system_settings.py`
- Create: `dao_task_history.py`
- Create: `tests/test_dao_api_config.py`

- [ ] **Step 1: 编写 API 配置 DAO 测试**

```python
# tests/test_dao_api_config.py
import pytest

async def test_create_api_config(test_db):
    from dao_api_config import ApiConfigDAO
    cfg = await ApiConfigDAO.create(
        name="Gemini-Test", provider="gemini",
        endpoint="https://api.example.com/v1",
        api_key="sk-test-key-123", model_name="gemini-2.0-flash",
        proxy_mode="agent"
    )
    assert cfg is not None
    assert cfg["config_id"].startswith("apicfg_")
    assert cfg["proxy_mode"] == "agent"

async def test_get_api_key_decrypts(test_db):
    from dao_api_config import ApiConfigDAO
    created = await ApiConfigDAO.create(
        name="Key-Test", provider="deepseek",
        endpoint="https://api.deepseek.com", api_key="my-secret-key"
    )
    key = await ApiConfigDAO.get_decrypted_key(created["config_id"])
    assert key == "my-secret-key"

async def test_list_enabled_configs(test_db):
    from dao_api_config import ApiConfigDAO
    await ApiConfigDAO.create(name="Active", provider="gemini", endpoint="https://a.com", api_key="k1")
    c2 = await ApiConfigDAO.create(name="Disabled", provider="openai", endpoint="https://b.com", api_key="k2")
    await ApiConfigDAO.update(c2["config_id"], enabled=False)
    enabled = await ApiConfigDAO.list_enabled()
    names = [c["name"] for c in enabled]
    assert "Active" in names
    assert "Disabled" not in names

async def test_list_by_proxy_mode(test_db):
    from dao_api_config import ApiConfigDAO
    await ApiConfigDAO.create(name="Direct", provider="deepseek", endpoint="https://d.com", api_key="k1", proxy_mode="direct")
    await ApiConfigDAO.create(name="Proxied", provider="gemini", endpoint="https://g.com", api_key="k2", proxy_mode="agent")
    agent_apis = await ApiConfigDAO.list_by_proxy_mode("agent")
    names = [c["name"] for c in agent_apis]
    assert "Proxied" in names
    assert "Direct" not in names
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 3 个 DAO**

`dao_api_config.py` — 含 `base64` 编码的简单加密（生产环境应替换为 AES）:

```python
# dao_api_config.py
import uuid
import json
import base64
from typing import List, Dict, Any, Optional
from db_manager import get_db_manager


class ApiConfigDAO:

    @staticmethod
    def _encrypt_key(key: str) -> str:
        return base64.b64encode(key.encode()).decode()

    @staticmethod
    def _decrypt_key(encrypted: str) -> str:
        try:
            return base64.b64decode(encrypted.encode()).decode()
        except Exception:
            return encrypted

    @staticmethod
    async def create(
        name: str, provider: str, endpoint: str, api_key: str,
        model_name: str = '', proxy_mode: str = 'direct',
        request_template: Optional[dict] = None,
        headers: Optional[dict] = None,
        custom_proxy: str = ''
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        cid = f"apicfg_{uuid.uuid4().hex[:12]}"
        encrypted = ApiConfigDAO._encrypt_key(api_key)
        return await db.fetchrow(
            """INSERT INTO api_configurations
               (config_id, name, provider, endpoint, api_key_encrypted,
                model_name, request_template, headers, proxy_mode, custom_proxy)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10) RETURNING *""",
            cid, name, provider, endpoint, encrypted, model_name,
            json.dumps(request_template or {}),
            json.dumps(headers or {}),
            proxy_mode, custom_proxy
        )

    @staticmethod
    async def get_by_id(config_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM api_configurations WHERE config_id = $1", config_id
        )

    @staticmethod
    async def get_decrypted_key(config_id: str) -> Optional[str]:
        row = await ApiConfigDAO.get_by_id(config_id)
        if not row:
            return None
        return ApiConfigDAO._decrypt_key(row["api_key_encrypted"])

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch("SELECT * FROM api_configurations ORDER BY name")

    @staticmethod
    async def list_enabled() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM api_configurations WHERE enabled = true ORDER BY name"
        )

    @staticmethod
    async def list_by_proxy_mode(mode: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM api_configurations WHERE proxy_mode = $1 AND enabled = true ORDER BY name",
            mode
        )

    @staticmethod
    async def update(config_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        sets, vals, idx = [], [], 1
        for k, v in kwargs.items():
            if k == 'api_key':
                sets.append(f"api_key_encrypted = ${idx}")
                vals.append(ApiConfigDAO._encrypt_key(v))
            elif k in ('request_template', 'headers'):
                sets.append(f"{k} = ${idx}::jsonb")
                vals.append(json.dumps(v, ensure_ascii=False))
            else:
                sets.append(f"{k} = ${idx}")
                vals.append(v)
            idx += 1
        if not sets:
            return await ApiConfigDAO.get_by_id(config_id)
        vals.append(config_id)
        return await db.fetchrow(
            f"UPDATE api_configurations SET {', '.join(sets)} WHERE config_id = ${idx} RETURNING *",
            *vals
        )

    @staticmethod
    async def delete(config_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM api_configurations WHERE config_id = $1", config_id
        )
        return result == "DELETE 1"
```

`dao_system_settings.py`:

```python
# dao_system_settings.py
from typing import Optional, Dict, Any, List
from db_manager import get_db_manager


class SystemSettingsDAO:

    @staticmethod
    async def get(key: str) -> Optional[str]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            "SELECT value FROM system_settings WHERE key = $1", key
        )
        return row["value"] if row else None

    @staticmethod
    async def set(key: str, value: str, description: str = '') -> bool:
        db = get_db_manager()
        if not db:
            return False
        await db.execute(
            """INSERT INTO system_settings (key, value, description)
               VALUES ($1, $2, $3)
               ON CONFLICT (key) DO UPDATE SET value = $2""",
            key, value, description
        )
        return True

    @staticmethod
    async def get_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch("SELECT * FROM system_settings ORDER BY key")

    @staticmethod
    async def get_proxy_settings() -> Dict[str, str]:
        db = get_db_manager()
        if not db:
            return {}
        rows = await db.fetch(
            "SELECT key, value FROM system_settings WHERE key LIKE 'proxy_%'"
        )
        return {r["key"]: r["value"] for r in rows}
```

`dao_task_history.py`:

```python
# dao_task_history.py
import uuid
import json
from typing import List, Dict, Any, Optional
from db_manager import get_db_manager


class TaskHistoryDAO:

    @staticmethod
    async def create(
        task_id: str, task_type: str = 'comfyui',
        agent_id: Optional[str] = None, workflow_id: Optional[str] = None,
        params: Optional[dict] = None
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            """INSERT INTO task_history (task_id, task_type, agent_id, workflow_id, params)
               VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *""",
            task_id, task_type, agent_id, workflow_id,
            json.dumps(params or {}, ensure_ascii=False)
        )

    @staticmethod
    async def update_status(
        task_id: str, status: str,
        agent_id: Optional[str] = None,
        result: Optional[dict] = None,
        error_message: str = ''
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        extra_sets = ""
        if status == 'processing':
            extra_sets = ", started_at = CURRENT_TIMESTAMP"
        elif status in ('completed', 'failed'):
            extra_sets = ", completed_at = CURRENT_TIMESTAMP"
        return await db.fetchrow(
            f"""UPDATE task_history
                SET status = $2, agent_id = COALESCE($3, agent_id),
                    result = COALESCE($4::jsonb, result),
                    error_message = COALESCE($5, error_message){extra_sets}
                WHERE task_id = $1 RETURNING *""",
            task_id, status, agent_id,
            json.dumps(result, ensure_ascii=False) if result else None,
            error_message or None
        )

    @staticmethod
    async def get_recent(limit: int = 50) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM task_history ORDER BY queued_at DESC LIMIT $1", limit
        )

    @staticmethod
    async def get_stats() -> Dict[str, Any]:
        db = get_db_manager()
        if not db:
            return {}
        row = await db.fetchrow("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'queued') as queued,
                COUNT(*) FILTER (WHERE status = 'processing') as processing,
                AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
                    FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL AND started_at IS NOT NULL)
                    as avg_duration,
                COUNT(*) FILTER (WHERE queued_at > CURRENT_TIMESTAMP - INTERVAL '24 hours' AND status = 'completed')
                    as today_completed
            FROM task_history
        """)
        return dict(row) if row else {}
```

- [ ] **Step 4: 运行所有 DAO 测试**

```bash
pytest tests/test_dao_api_config.py -v
```

- [ ] **Step 5: Commit**

```bash
git add dao_api_config.py dao_system_settings.py dao_task_history.py tests/test_dao_api_config.py
git commit -m "feat: add API config, system settings, and task history DAOs"
```

---

## Task 5: Agent 通信接口

**Files:**
- Create: `agent_routes.py`
- Create: `tests/test_agent_routes.py`

- [ ] **Step 1: 编写 Agent 接口测试**

```python
# tests/test_agent_routes.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

async def test_register_with_valid_token():
    """Agent 用有效 token 注册应返回 agent_id"""
    from agent_routes import register_agent
    mock_agent = {"agent_id": "agent_abc", "name": "GPU-01", "status": "online"}
    with patch("agent_routes.AgentDAO") as MockDAO:
        MockDAO.get_by_token = AsyncMock(return_value=mock_agent)
        MockDAO.update_heartbeat = AsyncMock(return_value=mock_agent)
        # 测试逻辑：能根据 token 找到 agent 并更新状态

async def test_register_with_invalid_token():
    """无效 token 应返回 401"""
    from agent_routes import AgentDAO
    with patch("agent_routes.AgentDAO") as MockDAO:
        MockDAO.get_by_token = AsyncMock(return_value=None)
        # 测试逻辑：应抛出 HTTPException(401)

async def test_poll_returns_task_when_available():
    """有任务时 poll 应返回任务数据"""
    pass  # 集成测试在后续阶段

async def test_poll_returns_null_when_empty():
    """无任务时 poll 应返回 {"task": null}"""
    pass

async def test_complete_updates_task_status():
    """回传结果应更新任务状态"""
    pass
```

- [ ] **Step 2: 实现 Agent 通信路由**

```python
# agent_routes.py
import json
import logging
import os
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Header, File, UploadFile, Form
from pydantic import BaseModel, Field

from dao_agent import AgentDAO
from dao_task_history import TaskHistoryDAO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


class RegisterRequest(BaseModel):
    system_info: dict = Field(default_factory=dict)
    comfyui_ports: List[int] = Field(default_factory=list)


class HeartbeatRequest(BaseModel):
    agent_id: str
    comfyui_instances: list = Field(default_factory=list)
    system_info: dict = Field(default_factory=dict)
    current_tasks: int = 0


async def _verify_agent_token(authorization: str = Header(...)) -> dict:
    """从 Authorization header 验证 Agent token"""
    token = authorization.replace("Bearer ", "")
    agent = await AgentDAO.get_by_token(token)
    if not agent or not agent.get("enabled", True):
        raise HTTPException(status_code=401, detail="Invalid or disabled agent token")
    return agent


@router.post("/register")
async def register_agent(
    request: RegisterRequest,
    authorization: str = Header(...)
):
    token = authorization.replace("Bearer ", "")
    agent = await AgentDAO.get_by_token(token)
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid token")
    instances = [{"port": p, "status": "unknown"} for p in request.comfyui_ports]
    updated = await AgentDAO.update_heartbeat(
        agent["agent_id"], status="online",
        comfyui_instances=instances, system_info=request.system_info
    )
    return {
        "success": True,
        "agent_id": agent["agent_id"],
        "name": agent["name"],
        "message": f"Registered with {len(request.comfyui_ports)} ComfyUI instances"
    }


@router.post("/heartbeat")
async def agent_heartbeat(
    request: HeartbeatRequest,
    authorization: str = Header(...)
):
    agent = await _verify_agent_token(authorization)
    if agent["agent_id"] != request.agent_id:
        raise HTTPException(status_code=403, detail="Agent ID mismatch")
    status = "busy" if request.current_tasks > 0 else "online"
    await AgentDAO.update_heartbeat(
        request.agent_id, status=status,
        comfyui_instances=request.comfyui_instances,
        system_info=request.system_info
    )
    return {"success": True, "status": status}


@router.get("/poll")
async def agent_poll(authorization: str = Header(...)):
    """Agent 拉取待处理任务。从 Redis 队列获取一个任务返回。"""
    agent = await _verify_agent_token(authorization)
    # 从 Redis 获取任务（需要从 cluster_main 获取 task_queue 引用）
    # 这里通过全局引用获取
    from cluster_main import task_queue, redis_client
    from cluster_config import RedisConfig

    task_data = await redis_client.zpopmin(RedisConfig.TASK_QUEUE_KEY)
    if not task_data:
        return {"task": None}

    task_json = task_data[0][0] if task_data else None
    if not task_json:
        return {"task": None}

    task_info = json.loads(task_json) if isinstance(task_json, str) else task_json
    task_id = task_info.get("task_id")

    await TaskHistoryDAO.update_status(task_id, "processing", agent_id=agent["agent_id"])

    files_to_download = []
    data = task_info.get("data", {})
    for key in ("image", "image_end", "video"):
        if data.get(key) and isinstance(data[key], str) and data[key].startswith(("http", "/")):
            files_to_download.append({"param": key, "url": data[key]})

    return {
        "task": {
            "task_id": task_id,
            "task_type": task_info.get("task_type", "comfyui"),
            "workflow_name": data.get("workflow_name", ""),
            "workflow_json": data.get("workflow_json"),
            "params": data,
            "files": files_to_download,
        }
    }


@router.post("/complete")
async def agent_complete(
    task_id: str = Form(...),
    agent_id: str = Form(...),
    status: str = Form("completed"),
    duration: float = Form(0.0),
    error_message: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    authorization: str = Header(...)
):
    await _verify_agent_token(authorization)

    output_dir = os.path.join("outputs", "agent")
    os.makedirs(output_dir, exist_ok=True)

    saved_files = []
    for f in files:
        file_path = os.path.join(output_dir, f"{task_id}_{f.filename}")
        content = await f.read()
        with open(file_path, "wb") as out:
            out.write(content)
        saved_files.append({"filename": f.filename, "path": file_path, "size": len(content)})

    result = {"output_files": saved_files, "duration": duration}
    await TaskHistoryDAO.update_status(
        task_id, status, agent_id=agent_id,
        result=result, error_message=error_message
    )

    # 更新 Redis 中的任务状态（兼容现有 SSE 通知机制）
    try:
        from cluster_main import redis_client
        from cluster_config import RedisConfig
        key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
        await redis_client.hset(key, mapping={
            "status": status,
            "result": json.dumps(result),
            "completed_at": datetime.now().isoformat()
        })
    except Exception as e:
        logger.warning(f"Failed to update Redis task status: {e}")

    return {"success": True, "task_id": task_id, "files_saved": len(saved_files)}
```

- [ ] **Step 3: 运行测试**

```bash
pytest tests/test_agent_routes.py -v
```

- [ ] **Step 4: Commit**

```bash
git add agent_routes.py tests/test_agent_routes.py
git commit -m "feat: add Agent HTTP protocol (register/heartbeat/poll/complete)"
```

---

## Task 6: 管理后台 API 路由

**Files:**
- Create: `admin_routes.py`

- [ ] **Step 1: 实现管理后台 CRUD 路由**

```python
# admin_routes.py
import json
import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel, Field

from dao_agent import AgentDAO
from dao_workflow_template import WorkflowTemplateDAO
from dao_api_config import ApiConfigDAO
from dao_system_settings import SystemSettingsDAO
from dao_task_history import TaskHistoryDAO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# -- 需要从 cluster_main 导入 require_auth --
# from cluster_main import require_auth
# 为避免循环导入，在 cluster_main.py 注册路由时通过 dependency_overrides 注入


# ===== Agent 管理 =====

class CreateAgentRequest(BaseModel):
    name: str

@router.post("/agents")
async def create_agent(request: CreateAgentRequest):
    token = AgentDAO.generate_token()
    agent = await AgentDAO.create(name=request.name, token=token)
    if not agent:
        raise HTTPException(500, "Failed to create agent")
    return {"success": True, "agent": dict(agent), "token": token}

@router.get("/agents")
async def list_agents():
    agents = await AgentDAO.list_all()
    return {"success": True, "agents": [dict(a) for a in agents]}

@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    agent = await AgentDAO.get_by_id(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    return {"success": True, "agent": dict(agent)}

@router.put("/agents/{agent_id}/toggle")
async def toggle_agent(agent_id: str):
    agent = await AgentDAO.get_by_id(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    updated = await AgentDAO.set_enabled(agent_id, not agent["enabled"])
    return {"success": True, "agent": dict(updated)}

@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    ok = await AgentDAO.delete(agent_id)
    if not ok:
        raise HTTPException(404, "Agent not found")
    return {"success": True}


# ===== 工作流模板管理 =====

class CreateWorkflowRequest(BaseModel):
    name: str
    category: str = "image"
    description: str = ""
    workflow_json: dict = Field(default_factory=dict)
    placeholders: list = Field(default_factory=list)
    node_type: str = "any"
    estimated_time: int = 30

class UpdateWorkflowRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    workflow_json: Optional[dict] = None
    placeholders: Optional[list] = None
    node_type: Optional[str] = None
    estimated_time: Optional[int] = None
    enabled: Optional[bool] = None

@router.get("/workflows")
async def list_workflow_templates():
    templates = await WorkflowTemplateDAO.list_all()
    return {"success": True, "templates": [dict(t) for t in templates]}

@router.post("/workflows")
async def create_workflow_template(request: CreateWorkflowRequest):
    t = await WorkflowTemplateDAO.create(
        name=request.name, category=request.category,
        description=request.description, workflow_json=request.workflow_json,
        placeholders=request.placeholders, node_type=request.node_type,
        estimated_time=request.estimated_time
    )
    if not t:
        raise HTTPException(500, "Failed to create template")
    return {"success": True, "template": dict(t)}

@router.get("/workflows/{template_id}")
async def get_workflow_template(template_id: str):
    t = await WorkflowTemplateDAO.get_by_id(template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    return {"success": True, "template": dict(t)}

@router.put("/workflows/{template_id}")
async def update_workflow_template(template_id: str, request: UpdateWorkflowRequest):
    kwargs = {k: v for k, v in request.dict().items() if v is not None}
    if not kwargs:
        raise HTTPException(400, "No fields to update")
    updated = await WorkflowTemplateDAO.update(template_id, **kwargs)
    if not updated:
        raise HTTPException(404, "Template not found")
    return {"success": True, "template": dict(updated)}

@router.delete("/workflows/{template_id}")
async def delete_workflow_template(template_id: str):
    ok = await WorkflowTemplateDAO.delete(template_id)
    if not ok:
        raise HTTPException(404, "Template not found")
    return {"success": True}

@router.post("/workflows/parse-json")
async def parse_workflow_json(request: dict):
    """解析上传的 workflow JSON，返回所有节点列表"""
    nodes = WorkflowTemplateDAO.parse_nodes(request)
    return {"success": True, "nodes": nodes}

@router.post("/workflows/import-existing")
async def import_existing_workflows():
    """一键导入现有 workflows/ 目录下的 JSON 文件和 workflow_config.py 配置"""
    from workflow_config import WORKFLOW_CONFIGS
    from pathlib import Path
    imported = 0
    errors = []
    for name, cfg in WORKFLOW_CONFIGS.items():
        try:
            existing = await WorkflowTemplateDAO.get_by_name(cfg.name)
            if existing:
                continue
            workflow_json = {}
            if cfg.file:
                json_path = Path("workflows") / cfg.file
                if json_path.exists():
                    with open(json_path, 'r', encoding='utf-8') as f:
                        workflow_json = json.load(f)
            placeholders = [
                {"key": p, "label": p, "type": "text", "required": False, "default": cfg.default_params.get(p, "")}
                for p in cfg.placeholders
            ]
            await WorkflowTemplateDAO.create(
                name=cfg.name, category="image",
                description=cfg.description, workflow_json=workflow_json,
                placeholders=placeholders
            )
            imported += 1
        except Exception as e:
            errors.append(f"{name}: {str(e)}")
    return {"success": True, "imported": imported, "errors": errors}


# ===== API 配置管理 =====

class CreateApiConfigRequest(BaseModel):
    name: str
    provider: str
    endpoint: str
    api_key: str
    model_name: str = ""
    proxy_mode: str = "direct"
    custom_proxy: str = ""

class UpdateApiConfigRequest(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    endpoint: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    proxy_mode: Optional[str] = None
    custom_proxy: Optional[str] = None
    enabled: Optional[bool] = None

@router.get("/api-configs")
async def list_api_configs():
    configs = await ApiConfigDAO.list_all()
    result = []
    for c in configs:
        d = dict(c)
        d["api_key_encrypted"] = "***"
        result.append(d)
    return {"success": True, "configs": result}

@router.post("/api-configs")
async def create_api_config(request: CreateApiConfigRequest):
    cfg = await ApiConfigDAO.create(
        name=request.name, provider=request.provider,
        endpoint=request.endpoint, api_key=request.api_key,
        model_name=request.model_name, proxy_mode=request.proxy_mode,
        custom_proxy=request.custom_proxy
    )
    if not cfg:
        raise HTTPException(500, "Failed to create config")
    d = dict(cfg)
    d["api_key_encrypted"] = "***"
    return {"success": True, "config": d}

@router.put("/api-configs/{config_id}")
async def update_api_config(config_id: str, request: UpdateApiConfigRequest):
    kwargs = {k: v for k, v in request.dict().items() if v is not None}
    if not kwargs:
        raise HTTPException(400, "No fields to update")
    updated = await ApiConfigDAO.update(config_id, **kwargs)
    if not updated:
        raise HTTPException(404, "Config not found")
    d = dict(updated)
    d["api_key_encrypted"] = "***"
    return {"success": True, "config": d}

@router.delete("/api-configs/{config_id}")
async def delete_api_config(config_id: str):
    ok = await ApiConfigDAO.delete(config_id)
    if not ok:
        raise HTTPException(404, "Config not found")
    return {"success": True}

@router.post("/api-configs/{config_id}/test")
async def test_api_config(config_id: str):
    """测试 API 连通性"""
    import aiohttp
    cfg = await ApiConfigDAO.get_by_id(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    key = await ApiConfigDAO.get_decrypted_key(config_id)
    proxy = None
    if cfg["proxy_mode"] == "global":
        settings = await SystemSettingsDAO.get_proxy_settings()
        proxy = settings.get("proxy_https", "")
    elif cfg["proxy_mode"] == "custom":
        proxy = cfg["custom_proxy"]
    try:
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {key}"}
            async with session.get(cfg["endpoint"], headers=headers, proxy=proxy or None, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                return {"success": True, "status": resp.status, "message": "连接成功"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ===== 系统设置 =====

class UpdateSettingsRequest(BaseModel):
    settings: dict

@router.get("/settings")
async def get_settings():
    settings = await SystemSettingsDAO.get_all()
    return {"success": True, "settings": [dict(s) for s in settings]}

@router.put("/settings")
async def update_settings(request: UpdateSettingsRequest):
    for key, value in request.settings.items():
        await SystemSettingsDAO.set(key, value)
    return {"success": True}


# ===== 仪表盘统计 =====

@router.get("/dashboard")
async def get_dashboard():
    agents = await AgentDAO.list_all()
    online_count = sum(1 for a in agents if a["status"] == "online")
    total_instances = 0
    healthy_instances = 0
    for a in agents:
        instances = a.get("comfyui_instances") or []
        if isinstance(instances, str):
            instances = json.loads(instances)
        total_instances += len(instances)
        healthy_instances += sum(1 for i in instances if i.get("status") == "healthy")

    stats = await TaskHistoryDAO.get_stats()
    recent = await TaskHistoryDAO.get_recent(limit=20)

    return {
        "success": True,
        "dashboard": {
            "agents_online": online_count,
            "agents_total": len(agents),
            "instances_healthy": healthy_instances,
            "instances_total": total_instances,
            "queue_length": stats.get("queued", 0),
            "processing": stats.get("processing", 0),
            "today_completed": stats.get("today_completed", 0),
            "avg_duration": round(stats.get("avg_duration") or 0, 1),
            "recent_tasks": [dict(t) for t in recent],
        }
    }
```

- [ ] **Step 2: Commit**

```bash
git add admin_routes.py
git commit -m "feat: add admin panel CRUD routes (agents, workflows, API configs, dashboard)"
```

---

## Task 7: 智能 API 路由器

**Files:**
- Create: `api_router.py`
- Create: `tests/test_api_router.py`

- [ ] **Step 1: 编写路由器测试**

```python
# tests/test_api_router.py
import pytest
from unittest.mock import AsyncMock, patch

async def test_direct_mode_calls_api_directly():
    from api_router import SmartApiRouter
    router = SmartApiRouter()
    mock_config = {"config_id": "c1", "proxy_mode": "direct", "endpoint": "https://api.deepseek.com/v1/chat",
                   "api_key_encrypted": "dGVzdA==", "headers": {}}
    with patch("api_router.ApiConfigDAO.get_by_id", new=AsyncMock(return_value=mock_config)):
        with patch("api_router.ApiConfigDAO.get_decrypted_key", new=AsyncMock(return_value="test")):
            with patch("api_router.aiohttp.ClientSession") as MockSession:
                mock_resp = AsyncMock()
                mock_resp.status = 200
                mock_resp.json = AsyncMock(return_value={"result": "ok"})
                mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
                mock_resp.__aexit__ = AsyncMock()
                mock_session = AsyncMock()
                mock_session.post = AsyncMock(return_value=mock_resp)
                mock_session.__aenter__ = AsyncMock(return_value=mock_session)
                mock_session.__aexit__ = AsyncMock()
                MockSession.return_value = mock_session
                result = await router.call_api("c1", body={"prompt": "hello"})
                assert result["result"] == "ok"

async def test_agent_mode_creates_task():
    from api_router import SmartApiRouter
    router = SmartApiRouter()
    mock_config = {"config_id": "c2", "proxy_mode": "agent", "endpoint": "https://api.gemini.com",
                   "api_key_encrypted": "dGVzdA==", "headers": {}, "model_name": "gemini-2.0"}
    with patch("api_router.ApiConfigDAO.get_by_id", new=AsyncMock(return_value=mock_config)):
        with patch("api_router.ApiConfigDAO.get_decrypted_key", new=AsyncMock(return_value="key")):
            with patch("api_router.SystemSettingsDAO.get_proxy_settings", new=AsyncMock(return_value={"proxy_https": "http://127.0.0.1:7890"})):
                # agent 模式应该返回一个 task_id 而非直接结果
                with patch("api_router.redis_client") as mock_redis:
                    mock_redis.zadd = AsyncMock()
                    result = await router.call_api("c2", body={"prompt": "hello"})
                    assert "task_id" in result
```

- [ ] **Step 2: 实现智能路由器**

```python
# api_router.py
import json
import uuid
import logging
import aiohttp
from typing import Optional, Dict, Any
from dao_api_config import ApiConfigDAO
from dao_system_settings import SystemSettingsDAO
from dao_task_history import TaskHistoryDAO

logger = logging.getLogger(__name__)

redis_client = None  # 在 cluster_main.py 启动时注入


def set_redis_client(client):
    global redis_client
    redis_client = client


class SmartApiRouter:
    """根据 API 配置的 proxy_mode 智能选择直连或走 Agent"""

    async def call_api(
        self, config_id: str, body: dict,
        method: str = "POST", extra_headers: Optional[dict] = None
    ) -> Dict[str, Any]:
        config = await ApiConfigDAO.get_by_id(config_id)
        if not config:
            raise ValueError(f"API config {config_id} not found")

        api_key = await ApiConfigDAO.get_decrypted_key(config_id)

        if config["proxy_mode"] == "direct":
            return await self._call_direct(config, api_key, body, method, extra_headers)
        else:
            return await self._dispatch_to_agent(config, api_key, body, method, extra_headers)

    async def _call_direct(self, config, api_key, body, method, extra_headers):
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        if config.get("headers"):
            h = config["headers"]
            if isinstance(h, str):
                h = json.loads(h)
            headers.update(h)
        if extra_headers:
            headers.update(extra_headers)
        async with aiohttp.ClientSession() as session:
            req_method = getattr(session, method.lower())
            async with req_method(config["endpoint"], json=body, headers=headers,
                                  timeout=aiohttp.ClientTimeout(total=120)) as resp:
                return await resp.json()

    async def _dispatch_to_agent(self, config, api_key, body, method, extra_headers):
        proxy_settings = await SystemSettingsDAO.get_proxy_settings()
        proxy = proxy_settings.get("proxy_https", "")
        if config["proxy_mode"] == "custom" and config.get("custom_proxy"):
            proxy = config["custom_proxy"]

        task_id = f"api_{uuid.uuid4().hex[:16]}"
        task_data = {
            "task_id": task_id,
            "task_type": "api_call",
            "data": {
                "config_id": config["config_id"],
                "endpoint": config["endpoint"],
                "api_key": api_key,
                "method": method,
                "headers": {**(json.loads(config["headers"]) if isinstance(config["headers"], str) else config["headers"]), **(extra_headers or {})},
                "body": body,
                "proxy": proxy,
            }
        }

        await TaskHistoryDAO.create(task_id=task_id, task_type="api_call",
                                    params=task_data["data"])

        from cluster_config import RedisConfig
        await redis_client.zadd(
            RedisConfig.TASK_QUEUE_KEY,
            {json.dumps(task_data): 10}  # 高优先级
        )

        return {"task_id": task_id, "status": "queued", "message": "Dispatched to agent"}
```

- [ ] **Step 3: 运行测试**

```bash
pytest tests/test_api_router.py -v
```

- [ ] **Step 4: Commit**

```bash
git add api_router.py tests/test_api_router.py
git commit -m "feat: add smart API router (direct vs agent proxy)"
```

---

## Task 8: GPU Agent 脚本

**Files:**
- Create: `comfyui_agent.py`

- [ ] **Step 1: 实现 Agent 脚本**

这是部署到 GPU 服务器上的独立 Python 脚本，仅依赖 `requests` 库。

```python
# comfyui_agent.py
"""
ComfyUI Agent — 部署在 GPU 服务器上
用法: python comfyui_agent.py --server URL --token TOKEN --ports 8188,8189
"""
import argparse
import json
import logging
import os
import sys
import signal
import time
import requests
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("agent")

POLL_INTERVAL = 3
HEARTBEAT_INTERVAL = 3


class ComfyUIAgent:
    def __init__(self, server_url: str, token: str, ports: list):
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.ports = ports
        self.agent_id = None
        self.running = True
        self.current_tasks = 0
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)

    def _shutdown(self, *args):
        logger.info("Shutting down gracefully...")
        self.running = False

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    def _get_system_info(self):
        info = {"hostname": os.uname().nodename if hasattr(os, 'uname') else "unknown"}
        try:
            import subprocess
            result = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total",
                                     "--format=csv,noheader"], capture_output=True, text=True)
            if result.returncode == 0:
                info["gpus"] = result.stdout.strip().split("\n")
        except Exception:
            pass
        return info

    def _check_comfyui(self, port: int) -> str:
        try:
            resp = requests.get(f"http://127.0.0.1:{port}/system_stats", timeout=5)
            return "healthy" if resp.status_code == 200 else "unhealthy"
        except Exception:
            return "offline"

    def register(self):
        instances_status = [{"port": p, "status": self._check_comfyui(p)} for p in self.ports]
        resp = requests.post(f"{self.server_url}/api/agent/register", json={
            "system_info": self._get_system_info(),
            "comfyui_ports": self.ports,
        }, headers=self._headers(), timeout=10)
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"Registration failed: {data}")
        self.agent_id = data["agent_id"]
        logger.info(f"Registered as {self.agent_id} ({data['name']})")

    def heartbeat(self):
        instances = [{"port": p, "status": self._check_comfyui(p)} for p in self.ports]
        requests.post(f"{self.server_url}/api/agent/heartbeat", json={
            "agent_id": self.agent_id,
            "comfyui_instances": instances,
            "system_info": self._get_system_info(),
            "current_tasks": self.current_tasks,
        }, headers=self._headers(), timeout=10)

    def poll(self):
        resp = requests.get(f"{self.server_url}/api/agent/poll",
                            headers=self._headers(), timeout=10)
        return resp.json().get("task")

    def execute_comfyui_task(self, task):
        """在本地 ComfyUI 上执行任务"""
        port = self._pick_available_port()
        if not port:
            return {"status": "failed", "error": "No available ComfyUI instance"}

        params = task.get("params", {})
        workflow_json = task.get("workflow_json") or params.get("workflow_json")

        # 下载需要的文件
        for file_info in task.get("files", []):
            url = file_info["url"]
            if url.startswith("/"):
                url = f"{self.server_url}{url}"
            local_path = self._download_file(url)
            filename = self._upload_to_comfyui(port, local_path)
            params[file_info["param"]] = filename

        # 替换占位符并提交
        workflow_str = json.dumps(workflow_json)
        for key, value in params.items():
            workflow_str = workflow_str.replace(f'"{{{key}}}"', json.dumps(value))
        workflow = json.loads(workflow_str)

        # 提交到 ComfyUI
        resp = requests.post(f"http://127.0.0.1:{port}/prompt",
                             json={"prompt": workflow}, timeout=30)
        prompt_id = resp.json().get("prompt_id")

        # 等待完成
        output_files = self._wait_for_completion(port, prompt_id)
        return {"status": "completed", "output_files": output_files}

    def execute_api_call_task(self, task):
        """代替后端执行外部 API 调用"""
        data = task.get("params", {})
        endpoint = data.get("endpoint")
        method = data.get("method", "POST").upper()
        headers = data.get("headers", {})
        body = data.get("body", {})
        proxy = data.get("proxy", "")
        api_key = data.get("api_key", "")

        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        headers.setdefault("Content-Type", "application/json")

        proxies = {"http": proxy, "https": proxy} if proxy else None

        if method == "POST":
            resp = requests.post(endpoint, json=body, headers=headers, proxies=proxies, timeout=120)
        else:
            resp = requests.get(endpoint, headers=headers, proxies=proxies, timeout=120)

        return {"status": "completed", "api_response": resp.json(), "http_status": resp.status_code}

    def complete(self, task_id, status, duration, output_files=None, error="", api_result=None):
        files_payload = []
        for f in (output_files or []):
            files_payload.append(("files", (os.path.basename(f), open(f, "rb"))))

        data = {
            "task_id": task_id,
            "agent_id": self.agent_id,
            "status": status,
            "duration": str(duration),
            "error_message": error,
        }
        requests.post(f"{self.server_url}/api/agent/complete",
                       data=data, files=files_payload or None,
                       headers=self._headers(), timeout=60)
        for _, (_, fobj) in files_payload:
            fobj.close()

    def _pick_available_port(self):
        for p in self.ports:
            if self._check_comfyui(p) == "healthy":
                return p
        return None

    def _download_file(self, url):
        local_dir = Path("/tmp/agent_downloads")
        local_dir.mkdir(exist_ok=True)
        filename = url.split("/")[-1]
        local_path = local_dir / filename
        resp = requests.get(url, timeout=60)
        local_path.write_bytes(resp.content)
        return str(local_path)

    def _upload_to_comfyui(self, port, local_path):
        with open(local_path, "rb") as f:
            resp = requests.post(f"http://127.0.0.1:{port}/upload/image",
                                 files={"image": f}, timeout=30)
        return resp.json().get("name", "")

    def _wait_for_completion(self, port, prompt_id, timeout=600):
        start = time.time()
        while time.time() - start < timeout:
            resp = requests.get(f"http://127.0.0.1:{port}/history/{prompt_id}", timeout=10)
            history = resp.json()
            if prompt_id in history:
                outputs = history[prompt_id].get("outputs", {})
                files = []
                for node_output in outputs.values():
                    for img in node_output.get("images", []):
                        fname = img["filename"]
                        subfolder = img.get("subfolder", "")
                        file_url = f"http://127.0.0.1:{port}/view?filename={fname}&subfolder={subfolder}"
                        local = self._download_file(file_url)
                        files.append(local)
                    for vid in node_output.get("gifs", []) + node_output.get("videos", []):
                        fname = vid["filename"]
                        subfolder = vid.get("subfolder", "")
                        file_url = f"http://127.0.0.1:{port}/view?filename={fname}&subfolder={subfolder}"
                        local = self._download_file(file_url)
                        files.append(local)
                return files
            time.sleep(2)
        return []

    def run(self):
        self.register()
        logger.info(f"Agent running. Polling every {POLL_INTERVAL}s...")
        last_heartbeat = 0

        while self.running:
            try:
                now = time.time()
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    self.heartbeat()
                    last_heartbeat = now

                task = self.poll()
                if task:
                    task_id = task["task_id"]
                    task_type = task.get("task_type", "comfyui")
                    logger.info(f"Got task: {task_id} (type={task_type})")
                    self.current_tasks += 1
                    start_time = time.time()
                    try:
                        if task_type == "api_call":
                            result = self.execute_api_call_task(task)
                        else:
                            result = self.execute_comfyui_task(task)
                        duration = time.time() - start_time
                        self.complete(task_id, result.get("status", "completed"), duration,
                                      output_files=result.get("output_files"))
                        logger.info(f"Task {task_id} completed in {duration:.1f}s")
                    except Exception as e:
                        duration = time.time() - start_time
                        logger.error(f"Task {task_id} failed: {e}")
                        self.complete(task_id, "failed", duration, error=str(e))
                    finally:
                        self.current_tasks -= 1
                else:
                    time.sleep(POLL_INTERVAL)
            except requests.ConnectionError:
                logger.warning("Connection lost, retrying in 10s...")
                time.sleep(10)
            except Exception as e:
                logger.error(f"Error: {e}")
                time.sleep(POLL_INTERVAL)


def main():
    parser = argparse.ArgumentParser(description="ComfyUI Agent")
    parser.add_argument("--server", required=True, help="Backend URL (e.g. https://your-backend.com:6006)")
    parser.add_argument("--token", required=True, help="Agent registration token")
    parser.add_argument("--ports", required=True, help="ComfyUI ports (e.g. 8188,8189)")
    args = parser.parse_args()
    ports = [int(p.strip()) for p in args.ports.split(",")]
    agent = ComfyUIAgent(args.server, args.token, ports)
    agent.run()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add comfyui_agent.py
git commit -m "feat: add GPU Agent script (comfyui + api_call task execution)"
```

---

## Task 9: 后端集成 — 挂载路由和静态文件

**Files:**
- Modify: `cluster_main.py`

- [ ] **Step 1: 在 cluster_main.py 中注册 Agent 和 Admin 路由**

在 `cluster_main.py` 约 259 行（`app = FastAPI(...)` 后）添加路由导入和挂载：

```python
# 在现有 import 区域添加:
from agent_routes import router as agent_router
from admin_routes import router as admin_router
from api_router import set_redis_client as set_api_router_redis

# 在 app.add_middleware(CORSMiddleware, ...) 后添加:
app.include_router(agent_router)
app.include_router(admin_router)

# 在 lifespan 函数中 redis_client 初始化后添加:
set_api_router_redis(redis_client)

# 挂载 admin 前端静态文件:
admin_dir = os.path.join(os.path.dirname(__file__), "admin")
if os.path.exists(admin_dir):
    app.mount("/admin", StaticFiles(directory=admin_dir, html=True), name="admin")
```

- [ ] **Step 2: 在 lifespan 中启动 Agent 超时清理任务**

在 lifespan yield 前添加:

```python
async def agent_stale_checker():
    """每 30 秒检查一次，将超时的 Agent 标记为离线"""
    while True:
        try:
            from dao_agent import AgentDAO
            count = await AgentDAO.mark_stale_offline(timeout_seconds=15)
            if count > 0:
                logger.info(f"Marked {count} stale agents as offline")
        except Exception as e:
            logger.error(f"Agent stale check error: {e}")
        await asyncio.sleep(30)

asyncio.create_task(agent_stale_checker())
```

- [ ] **Step 3: 验证路由注册成功**

```bash
python -c "from cluster_main import app; print([r.path for r in app.routes])" | grep agent
```

- [ ] **Step 4: Commit**

```bash
git add cluster_main.py
git commit -m "feat: integrate agent and admin routes into main app"
```

---

## Task 10: 管理后台前端

**Files:**
- Create: `admin/index.html`
- Create: `admin/app.js`
- Create: `admin/style.css`

- [ ] **Step 1: 创建 index.html（包含 Tailwind CDN + 4 页面结构）**

独立 HTML 页面，包含左侧导航 + 右侧内容区。使用 Tailwind CDN 和 CodeMirror CDN（JSON 编辑器）。

关键结构:
- 导航: 仪表盘 / 集群管理 / 工作流模板 / API 配置
- 仪表盘: 4 个统计卡片 + 实时任务列表 + 最近完成列表
- 集群管理: Agent 列表 + 注册面板（Token 生成 + 启动命令复制）
- 工作流模板: 列表 + 新建/编辑弹窗（左JSON编辑器+右占位符配置）
- API 配置: 列表 + 新建/编辑表单 + 全局代理设置面板

- [ ] **Step 2: 创建 app.js（所有 API 调用和 UI 逻辑）**

核心功能:
- `fetchDashboard()` — 拉取仪表盘数据，5 秒自动刷新
- `fetchAgents()` / `createAgent()` / `toggleAgent()` / `deleteAgent()`
- `fetchWorkflows()` / `createWorkflow()` / `updateWorkflow()` / `deleteWorkflow()`
- `parseWorkflowJson(json)` — 上传 JSON 后解析节点列表
- `fetchApiConfigs()` / `createApiConfig()` / `testApiConfig()`
- `fetchSettings()` / `updateSettings()` — 全局代理设置
- `importExistingWorkflows()` — 一键导入

- [ ] **Step 3: 创建 style.css（自定义样式补充）**

- [ ] **Step 4: 本地测试管理后台页面**

```bash
python -m uvicorn cluster_main:app --host 0.0.0.0 --port 6006
# 浏览器访问 http://localhost:6006/admin/
```

- [ ] **Step 5: Commit**

```bash
git add admin/
git commit -m "feat: add admin panel frontend (dashboard, cluster, workflows, API config)"
```

---

## Task 11: 一键导入现有工作流

**Files:** 无新建，使用 `admin_routes.py` 中已实现的 `/api/admin/workflows/import-existing`

- [ ] **Step 1: 测试导入功能**

启动后端后，调用导入接口:
```bash
curl -X POST http://localhost:6006/api/admin/workflows/import-existing
```
Expected: 返回 `{"success": true, "imported": N}`，N 应接近 40（现有工作流文件数量）

- [ ] **Step 2: 验证导入结果**

```bash
curl http://localhost:6006/api/admin/workflows | python -m json.tool
```
Expected: 列出所有导入的工作流模板

- [ ] **Step 3: Commit**

```bash
git commit -m "test: verify existing workflow import"
```

---

## 执行顺序总结

| 序号 | 任务 | 依赖 | 预估时间 |
|------|------|------|----------|
| 1 | 数据库迁移 | 无 | 5min |
| 2 | Agent DAO | Task 1 | 15min |
| 3 | 工作流模板 DAO | Task 1 | 15min |
| 4 | API配置+系统设置+历史 DAO | Task 1 | 15min |
| 5 | Agent 通信接口 | Task 2, 4 | 20min |
| 6 | 管理后台 CRUD 路由 | Task 2-4 | 20min |
| 7 | 智能 API 路由器 | Task 4 | 15min |
| 8 | GPU Agent 脚本 | Task 5 | 25min |
| 9 | 后端集成 | Task 5, 6 | 10min |
| 10 | 管理后台前端 | Task 6 | 40min |
| 11 | 导入现有工作流 | Task 6, 10 | 5min |
