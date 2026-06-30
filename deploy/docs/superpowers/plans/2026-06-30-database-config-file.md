# Database Config File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL connection settings load from one backend-owned file, `deploy/configs/database.env`, while preserving environment variable overrides.

**Architecture:** Add a small parser/loader in `deploy/core/db_config_loader.py`, then route runtime database config and the fresh database builder through it. The loader does not mutate `os.environ`; each consumer resolves values through a shared helper with the precedence environment -> file -> default.

**Tech Stack:** Python 3.9+, FastAPI backend, asyncpg, pytest, plain `KEY=value` config file format.

---

## File Structure

- Create `deploy/core/db_config_loader.py`: parse and resolve database config values from process environment and `deploy/configs/database.env`.
- Create `deploy/tests/test_db_config_loader.py`: unit tests for loader parsing, precedence, defaults, and malformed lines.
- Create `deploy/tests/test_database_config_file_integration.py`: tests that runtime/database builder config reads through the shared loader.
- Modify `deploy/core/db_manager.py`: use the loader in the runtime connection pool config.
- Modify `deploy/core/database_config.py`: use the same loader for compatibility helpers.
- Modify `deploy/db_build/build_fresh_db.py`: use the same loader for fresh database creation.
- Create `deploy/configs/database.env.example`: safe template with non-secret placeholders.
- Modify `.gitignore`: ignore `deploy/configs/database.env`.
- Modify `deploy/docs/GCP-上线清单.md`: document the new single-file database config path for normal deployment.

---

### Task 1: Shared Database Config Loader

**Files:**
- Create: `deploy/tests/test_db_config_loader.py`
- Create: `deploy/core/db_config_loader.py`

- [ ] **Step 1: Write the failing loader tests**

Create `deploy/tests/test_db_config_loader.py`:

```python
from pathlib import Path

import pytest


def test_database_env_file_value_is_used(tmp_path):
    from core.db_config_loader import get_db_config_value

    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=file-host\n"
        "DB_PORT=15432\n"
        "DB_PASSWORD='secret value'\n",
        encoding="utf-8",
    )

    assert get_db_config_value("DB_HOST", "localhost", config_file=config_file, environ={}) == "file-host"
    assert get_db_config_value("DB_PORT", "5432", config_file=config_file, environ={}) == "15432"
    assert get_db_config_value("DB_PASSWORD", "changeme", config_file=config_file, environ={}) == "secret value"


def test_process_environment_overrides_database_env_file(tmp_path):
    from core.db_config_loader import get_db_config_value

    config_file = tmp_path / "database.env"
    config_file.write_text("DB_HOST=file-host\n", encoding="utf-8")

    value = get_db_config_value(
        "DB_HOST",
        "localhost",
        config_file=config_file,
        environ={"DB_HOST": "env-host"},
    )

    assert value == "env-host"


def test_default_is_used_when_env_and_file_are_missing(tmp_path):
    from core.db_config_loader import get_db_config_value

    missing_file = tmp_path / "missing.env"

    assert get_db_config_value("DB_HOST", "localhost", config_file=missing_file, environ={}) == "localhost"


def test_malformed_database_env_line_raises_useful_error(tmp_path):
    from core.db_config_loader import load_database_env_file

    config_file = tmp_path / "database.env"
    config_file.write_text("DB_HOST=file-host\nBROKEN_LINE\n", encoding="utf-8")

    with pytest.raises(ValueError, match=r"database\.env:2"):
        load_database_env_file(config_file)
```

- [ ] **Step 2: Run loader tests to verify they fail**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_db_config_loader.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'core.db_config_loader'`.

- [ ] **Step 3: Implement the minimal loader**

Create `deploy/core/db_config_loader.py`:

```python
# -*- coding: utf-8 -*-
"""Database config file loader.

Resolution order:
1. Process environment variables.
2. deploy/configs/database.env.
3. Caller-provided defaults.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Mapping, Optional, Union

PathInput = Union[str, os.PathLike, Path]

DEPLOY_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_CONFIG_FILE = DEPLOY_DIR / "configs" / "database.env"


def _strip_matching_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_database_env_file(config_file: Optional[PathInput] = None) -> Dict[str, str]:
    path = Path(config_file) if config_file is not None else DEFAULT_DATABASE_CONFIG_FILE
    if not path.exists():
        return {}

    values: Dict[str, str] = {}
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_no}: expected KEY=value")

        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not key or any(ch.isspace() for ch in key):
            raise ValueError(f"{path}:{line_no}: invalid key {key!r}")

        values[key] = _strip_matching_quotes(raw_value.strip())
    return values


def get_db_config_value(
    key: str,
    default: str = "",
    *,
    config_file: Optional[PathInput] = None,
    environ: Optional[Mapping[str, str]] = None,
) -> str:
    env = os.environ if environ is None else environ
    if key in env:
        return str(env[key])

    file_values = load_database_env_file(config_file)
    return file_values.get(key, default)
```

- [ ] **Step 4: Run loader tests to verify they pass**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_db_config_loader.py -q
```

Expected: `4 passed`.

- [ ] **Step 5: Commit loader work**

Run:

```bash
git add deploy/core/db_config_loader.py deploy/tests/test_db_config_loader.py
git commit -m "feat: add database config file loader"
```

---

### Task 2: Runtime Database Config Uses Loader

**Files:**
- Modify: `deploy/core/db_manager.py`
- Modify: `deploy/core/database_config.py`
- Create: `deploy/tests/test_database_config_file_integration.py`

- [ ] **Step 1: Write failing integration tests**

Create `deploy/tests/test_database_config_file_integration.py`:

```python
import importlib


DB_ENV_KEYS = [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_POOL_MIN_SIZE",
    "DB_POOL_MAX_SIZE",
    "DB_MAX_QUERIES",
    "DB_MAX_IDLE_TIME",
]


def clear_db_env(monkeypatch):
    for key in DB_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_db_manager_config_reads_database_env_file(tmp_path, monkeypatch):
    from core import db_config_loader
    import core.db_manager as db_manager

    clear_db_env(monkeypatch)
    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=file-host\n"
        "DB_PORT=15432\n"
        "DB_NAME=file_db\n"
        "DB_USER=file_user\n"
        "DB_PASSWORD=file_password\n"
        "DB_POOL_MIN_SIZE=3\n"
        "DB_POOL_MAX_SIZE=7\n"
        "DB_MAX_QUERIES=123\n"
        "DB_MAX_IDLE_TIME=45.5\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config_file)
    cfg = importlib.reload(db_manager).DatabaseConfig()

    assert cfg.HOST == "file-host"
    assert cfg.PORT == 15432
    assert cfg.DATABASE == "file_db"
    assert cfg.USER == "file_user"
    assert cfg.PASSWORD == "file_password"
    assert cfg.MIN_SIZE == 3
    assert cfg.MAX_SIZE == 7
    assert cfg.MAX_QUERIES == 123
    assert cfg.MAX_INACTIVE_CONNECTION_LIFETIME == 45.5


def test_database_config_helper_uses_same_database_env_file(tmp_path, monkeypatch):
    from core import db_config_loader
    import core.database_config as database_config

    clear_db_env(monkeypatch)
    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=file-host\n"
        "DB_PORT=15432\n"
        "DB_NAME=file_db\n"
        "DB_USER=file_user\n"
        "DB_PASSWORD=file_password\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config_file)
    config_module = importlib.reload(database_config)

    params = config_module.DatabaseConfig.get_connection_params()

    assert params["host"] == "file-host"
    assert params["port"] == 15432
    assert params["database"] == "file_db"
    assert params["user"] == "file_user"
    assert params["password"] == "file_password"
    assert config_module.DatabaseConfig.get_connection_string() == (
        "postgresql://file_user:file_password@file-host:15432/file_db"
    )
```

- [ ] **Step 2: Run integration tests to verify they fail**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_database_config_file_integration.py -q
```

Expected: FAIL because `core.db_manager.DatabaseConfig` and `core.database_config.DatabaseConfig` still read only `os.getenv`.

- [ ] **Step 3: Update runtime database manager config**

In `deploy/core/db_manager.py`, remove the `import os` line and import the loader:

```python
from core.db_config_loader import get_db_config_value
```

Replace the current `DatabaseConfig` class with:

```python
class DatabaseConfig:
    """数据库配置"""

    def __init__(self):
        self.HOST = get_db_config_value("DB_HOST", "localhost")
        self.PORT = int(get_db_config_value("DB_PORT", "5432"))
        self.DATABASE = get_db_config_value("DB_NAME", "my2_db")
        self.USER = get_db_config_value("DB_USER", "my2_user")
        self.PASSWORD = get_db_config_value("DB_PASSWORD", "changeme")
        self.MIN_SIZE = int(get_db_config_value("DB_POOL_MIN_SIZE", "10"))
        self.MAX_SIZE = int(get_db_config_value("DB_POOL_MAX_SIZE", "50"))
        self.MAX_QUERIES = int(get_db_config_value("DB_MAX_QUERIES", "50000"))
        self.MAX_INACTIVE_CONNECTION_LIFETIME = float(get_db_config_value("DB_MAX_IDLE_TIME", "300"))
```

- [ ] **Step 4: Update compatibility database config**

In `deploy/core/database_config.py`, keep `import os` for `JWTConfig`, add:

```python
from core.db_config_loader import get_db_config_value
```

Replace the current `DatabaseConfig` class with:

```python
class DatabaseConfig:
    """PostgreSQL 数据库配置"""

    @classmethod
    def get_connection_string(cls):
        params = cls.get_connection_params()
        return (
            f"postgresql://{params['user']}:{params['password']}"
            f"@{params['host']}:{params['port']}/{params['database']}"
        )

    @classmethod
    def get_connection_params(cls):
        return {
            "host": get_db_config_value("DB_HOST", "localhost"),
            "port": int(get_db_config_value("DB_PORT", "5432")),
            "database": get_db_config_value("DB_NAME", "my2_db"),
            "user": get_db_config_value("DB_USER", "my2_user"),
            "password": get_db_config_value("DB_PASSWORD", "changeme"),
            "min_size": int(get_db_config_value("DB_POOL_MIN_SIZE", "10")),
            "max_size": int(get_db_config_value("DB_POOL_MAX_SIZE", "50")),
        }
```

- [ ] **Step 5: Run integration tests to verify they pass**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_database_config_file_integration.py -q
```

Expected: `2 passed`.

- [ ] **Step 6: Run loader plus integration tests together**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_db_config_loader.py tests/test_database_config_file_integration.py -q
```

Expected: `6 passed`.

- [ ] **Step 7: Commit runtime config work**

Run:

```bash
git add deploy/core/db_manager.py deploy/core/database_config.py deploy/tests/test_database_config_file_integration.py
git commit -m "feat: load runtime database config from file"
```

---

### Task 3: Fresh Database Builder Uses Loader

**Files:**
- Modify: `deploy/db_build/build_fresh_db.py`
- Modify: `deploy/tests/test_database_config_file_integration.py`

- [ ] **Step 1: Add failing build runner config test**

Append this test to `deploy/tests/test_database_config_file_integration.py`:

```python
def test_fresh_db_builder_uses_database_env_file(tmp_path, monkeypatch):
    from core import db_config_loader
    from db_build import build_fresh_db

    clear_db_env(monkeypatch)
    config_file = tmp_path / "database.env"
    config_file.write_text(
        "DB_HOST=builder-host\n"
        "DB_PORT=25432\n"
        "DB_NAME=builder_db\n"
        "DB_USER=builder_user\n"
        "DB_PASSWORD=builder_password\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config_file)

    assert build_fresh_db.db_connection_config() == {
        "host": "builder-host",
        "port": 25432,
        "database": "builder_db",
        "user": "builder_user",
        "password": "builder_password",
    }
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_database_config_file_integration.py::test_fresh_db_builder_uses_database_env_file -q
```

Expected: FAIL with `AttributeError: module 'db_build.build_fresh_db' has no attribute 'db_connection_config'`.

- [ ] **Step 3: Add shared config import to the build runner**

In `deploy/db_build/build_fresh_db.py`, keep the existing `DEPLOY_DIR` assignment and add this immediately after it:

```python
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from core.db_config_loader import get_db_config_value
```

Add this function below `check()`:

```python
def db_connection_config() -> dict:
    return {
        "host": get_db_config_value("DB_HOST", "localhost"),
        "port": int(get_db_config_value("DB_PORT", "5432")),
        "database": get_db_config_value("DB_NAME", "my2_db"),
        "user": get_db_config_value("DB_USER", "my2_user"),
        "password": get_db_config_value("DB_PASSWORD", ""),
    }
```

Replace the current inline connection dictionary in `run()` with:

```python
    cfg = db_connection_config()
```

- [ ] **Step 4: Run the build runner test to verify it passes**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_database_config_file_integration.py::test_fresh_db_builder_uses_database_env_file -q
```

Expected: `1 passed`.

- [ ] **Step 5: Run the build runner manifest check**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
python db_build/build_fresh_db.py --check
```

Expected: output includes `✅ 所有文件存在` and exit code `0`.

- [ ] **Step 6: Commit build runner work**

Run:

```bash
git add deploy/db_build/build_fresh_db.py deploy/tests/test_database_config_file_integration.py
git commit -m "feat: load fresh database builder config from file"
```

---

### Task 4: Template, Ignore Rule, and Docs

**Files:**
- Create: `deploy/configs/database.env.example`
- Modify: `.gitignore`
- Modify: `deploy/docs/GCP-上线清单.md`

- [ ] **Step 1: Add the database config template**

Create `deploy/configs/database.env.example`:

```dotenv
# PostgreSQL connection settings.
# Copy this file to database.env and replace DB_PASSWORD before running locally.

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=my2_db
DB_USER=my2_user
DB_PASSWORD=change-me

# Optional pool settings.
DB_POOL_MIN_SIZE=10
DB_POOL_MAX_SIZE=50
DB_MAX_QUERIES=50000
DB_MAX_IDLE_TIME=300
```

- [ ] **Step 2: Ignore the real database config file**

Add this line to the secret section of `.gitignore`:

```gitignore
deploy/configs/database.env
```

- [ ] **Step 3: Update GCP deployment docs**

In `deploy/docs/GCP-上线清单.md`, replace the database config export example in section `3. 建库 + 跑迁移` with:

```bash
cp configs/database.env.example configs/database.env
nano configs/database.env

# 用有序建库 runner 一次跑通 schema + 全部迁移（已按依赖顺序拓扑排序，幂等可重复）
.venv/bin/python db_build/build_fresh_db.py
```

In section `4. 配置密钥`, keep the `.env` guidance for non-database secrets and add this sentence below the variables table:

```markdown
PostgreSQL 连接配置优先从进程环境变量读取；未设置时读取 `deploy/configs/database.env`。生产 systemd 仍可通过 `EnvironmentFile` 覆盖这些值。
```

- [ ] **Step 4: Verify template and ignore rule**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama
git check-ignore deploy/configs/database.env
```

Expected: output is `deploy/configs/database.env`.

- [ ] **Step 5: Commit template and docs**

Run:

```bash
git add .gitignore deploy/configs/database.env.example deploy/docs/GCP-上线清单.md
git commit -m "docs: document database config file"
```

---

### Task 5: Final Verification

**Files:**
- Verify only; no planned file changes.

- [ ] **Step 1: Run targeted pytest**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
pytest tests/test_db_config_loader.py tests/test_database_config_file_integration.py -q
```

Expected: `7 passed`.

- [ ] **Step 2: Run Python compile checks**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
python -m py_compile core/db_config_loader.py core/db_manager.py core/database_config.py db_build/build_fresh_db.py
```

Expected: exit code `0` and no output.

- [ ] **Step 3: Run build runner manifest check**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama/deploy
python db_build/build_fresh_db.py --check
```

Expected: output includes `✅ 所有文件存在` and exit code `0`.

- [ ] **Step 4: Check whitespace**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama
git diff --check
```

Expected: exit code `0` and no output.

- [ ] **Step 5: Review changed files**

Run:

```bash
cd /Users/gengxiaoxu/work/Drama
git status --short
git diff --stat
```

Expected: only the planned files are changed, and no real `deploy/configs/database.env` file is staged or committed.
