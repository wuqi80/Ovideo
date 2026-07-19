#!/usr/bin/env python3
"""Apply SQL migrations with a checksum ledger and transaction lock."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
import time
from pathlib import Path
from typing import Any, Iterable

import asyncpg


LEDGER_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    checksum_sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execution_ms INTEGER NOT NULL DEFAULT 0,
    git_sha TEXT
)
"""
LOCK_NAME = "mecha:schema_migrations"
TRANSACTION_CONTROL = re.compile(r"^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$", re.IGNORECASE | re.MULTILINE)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def migration_checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def migration_id(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def validate_migration_sql(path: Path, sql: str) -> None:
    if TRANSACTION_CONTROL.search(sql):
        raise ValueError(
            f"{path} contains explicit transaction control; migrations are wrapped atomically by the runner"
        )


async def ensure_ledger(conn: Any) -> None:
    await conn.execute(LEDGER_DDL)


async def apply_one(conn: Any, path: Path, *, root: Path, git_sha: str = "") -> str:
    if not path.is_file():
        raise FileNotFoundError(path)

    sql = path.read_text(encoding="utf-8")
    validate_migration_sql(path, sql)
    checksum = migration_checksum(path)
    version = migration_id(path, root)
    existing = await conn.fetchrow(
        "SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = $1",
        version,
    )
    if existing:
        recorded = str(existing["checksum_sha256"])
        if recorded != checksum:
            raise RuntimeError(
                f"Migration checksum mismatch for {version}: recorded={recorded}, current={checksum}"
            )
        return "skipped"

    started = time.monotonic()
    async with conn.transaction():
        await conn.execute(sql)
        elapsed_ms = max(0, int((time.monotonic() - started) * 1000))
        await conn.execute(
            """
            INSERT INTO schema_migrations (
                migration_id, checksum_sha256, execution_ms, git_sha
            ) VALUES ($1, $2, $3, NULLIF($4, ''))
            """,
            version,
            checksum,
            elapsed_ms,
            git_sha,
        )
    return "applied"


async def apply_migrations(
    conn: Any,
    paths: Iterable[Path],
    *,
    root: Path,
    git_sha: str = "",
) -> list[tuple[str, str]]:
    await ensure_ledger(conn)
    await conn.execute("SELECT pg_advisory_lock(hashtext($1))", LOCK_NAME)
    results: list[tuple[str, str]] = []
    try:
        for path in paths:
            state = await apply_one(conn, path, root=root, git_sha=git_sha)
            results.append((migration_id(path, root), state))
    finally:
        await conn.execute("SELECT pg_advisory_unlock(hashtext($1))", LOCK_NAME)
    return results


async def list_migrations(conn: Any) -> list[Any]:
    await ensure_ledger(conn)
    return await conn.fetch(
        """
        SELECT migration_id, checksum_sha256, applied_at, execution_ms, git_sha
        FROM schema_migrations
        ORDER BY applied_at, migration_id
        """
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migrations", nargs="*", help="SQL migration files in execution order")
    parser.add_argument("--env", action="append", default=[], help="Environment file to load")
    parser.add_argument("--root", default=".", help="Root used for stable migration ids")
    parser.add_argument("--status", action="store_true", help="Print the migration ledger")
    return parser


async def async_main(args: argparse.Namespace) -> int:
    for env_path in args.env:
        load_env_file(Path(env_path))

    conn = await asyncpg.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "my2_db"),
        user=os.getenv("DB_USER", "my2_user"),
        password=os.getenv("DB_PASSWORD", ""),
    )
    try:
        if args.status:
            for row in await list_migrations(conn):
                print(
                    f"{row['migration_id']} {row['checksum_sha256']} "
                    f"{row['applied_at']} {row['execution_ms']}ms {row['git_sha'] or '-'}"
                )
            return 0
        if not args.migrations:
            raise ValueError("At least one migration path is required unless --status is used")
        root = Path(args.root)
        paths = [Path(item) for item in args.migrations]
        for version, state in await apply_migrations(
            conn,
            paths,
            root=root,
            git_sha=os.getenv("GIT_SHA", ""),
        ):
            print(f"  {state}: {version}")
        return 0
    finally:
        await conn.close()


def main() -> int:
    return asyncio.run(async_main(build_parser().parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
