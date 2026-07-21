from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from scripts import apply_migrations as runner


class FakeConnection:
    def __init__(self, *, existing_schema=False):
        self.ledger = {}
        self.executed = []
        self.existing_schema = existing_schema

    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        if "INSERT INTO schema_migrations" in sql:
            self.ledger[args[0]] = args[1]
        return "OK"

    async def fetchrow(self, _sql, migration_id):
        checksum = self.ledger.get(migration_id)
        return {"checksum_sha256": checksum} if checksum else None

    async def fetchval(self, _sql, *_args):
        return self.existing_schema

    @asynccontextmanager
    async def transaction(self):
        yield


@pytest.mark.asyncio
async def test_apply_migrations_is_ordered_and_idempotent(tmp_path):
    first = tmp_path / "001_first.sql"
    second = tmp_path / "002_second.sql"
    first.write_text("CREATE TABLE one(id int);", encoding="utf-8")
    second.write_text("CREATE TABLE two(id int);", encoding="utf-8")
    conn = FakeConnection()

    initial = await runner.apply_migrations(conn, [first, second], root=tmp_path, git_sha="abc123")
    repeated = await runner.apply_migrations(conn, [first, second], root=tmp_path, git_sha="abc123")

    assert initial == [("001_first.sql", "applied"), ("002_second.sql", "applied")]
    assert repeated == [("001_first.sql", "skipped"), ("002_second.sql", "skipped")]
    migration_sql = [sql for sql, _args in conn.executed if sql.startswith("CREATE TABLE one") or sql.startswith("CREATE TABLE two")]
    assert migration_sql == ["CREATE TABLE one(id int);", "CREATE TABLE two(id int);"]


@pytest.mark.asyncio
async def test_changed_applied_migration_is_blocked(tmp_path):
    path = tmp_path / "001.sql"
    path.write_text("SELECT 1;", encoding="utf-8")
    conn = FakeConnection()
    conn.ledger["001.sql"] = hashlib.sha256(b"old content").hexdigest()

    with pytest.raises(RuntimeError, match="checksum mismatch"):
        await runner.apply_migrations(conn, [path], root=tmp_path)


def test_explicit_outer_transaction_control_is_removed():
    sql = "BEGIN;\nSELECT 1;\nCOMMIT;"
    assert runner.prepare_migration_sql(sql).strip() == "SELECT 1;"


def test_manifest_paths_are_resolved_from_root(tmp_path):
    manifest = tmp_path / "manifest.txt"
    manifest.write_text("# ordered\nsql/001.sql # first\n\nsql/002.sql\n", encoding="utf-8")

    assert runner.read_manifest(manifest, root=tmp_path) == [
        tmp_path / "sql" / "001.sql",
        tmp_path / "sql" / "002.sql",
    ]


def test_deploy_scripts_use_the_ledger_runner():
    deploy_dir = Path(__file__).resolve().parents[1]
    auto_deploy = (deploy_dir / "auto_deploy.sh").read_text(encoding="utf-8")
    live_deploy = (deploy_dir / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert "scripts/apply_migrations.py" in auto_deploy
    assert "scripts/apply_migrations.py" in live_deploy
    assert "--manifest db_build/manifest.txt" in auto_deploy
    assert "--manifest db_build/manifest.txt" in live_deploy


@pytest.mark.asyncio
async def test_existing_schema_adopts_untracked_legacy_migration(tmp_path):
    legacy = tmp_path / "database_schema.sql"
    legacy.write_text("CREATE TABLE users(id int);", encoding="utf-8")
    conn = FakeConnection(existing_schema=True)

    result = await runner.apply_migrations(conn, [legacy], root=tmp_path, git_sha="release")

    assert result == [("database_schema.sql", "baselined")]
    assert not any(sql.startswith("CREATE TABLE users") for sql, _args in conn.executed)
    assert conn.ledger["database_schema.sql"] == runner.migration_checksum(legacy)


@pytest.mark.asyncio
async def test_fresh_schema_executes_legacy_migration(tmp_path):
    legacy = tmp_path / "database_schema.sql"
    legacy.write_text("CREATE TABLE users(id int);", encoding="utf-8")
    conn = FakeConnection(existing_schema=False)

    result = await runner.apply_migrations(conn, [legacy], root=tmp_path)

    assert result == [("database_schema.sql", "applied")]
    assert any(sql.startswith("CREATE TABLE users") for sql, _args in conn.executed)


@pytest.mark.asyncio
async def test_existing_schema_still_executes_new_migration(tmp_path):
    current = tmp_path / "db_migration_script_conversations.sql"
    current.write_text("CREATE TABLE episode_script_messages(id int);", encoding="utf-8")
    conn = FakeConnection(existing_schema=True)

    result = await runner.apply_migrations(conn, [current], root=tmp_path)

    assert result == [("db_migration_script_conversations.sql", "applied")]
    assert any(sql.startswith("CREATE TABLE episode_script_messages") for sql, _args in conn.executed)
