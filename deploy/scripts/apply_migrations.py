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

# These two migrations were first applied from a pre-commit production build.
# The deployed schema matches the canonical files, but the ledger retained the
# hashes of that build. Keep the exception exact so unrelated edits still fail.
LEGACY_CHECKSUM_ALIASES = {
    "sql/db_migration_episode_script_sources.sql": {
        "bbe14ea12b6cc44d39e312d7fb3250b6957c33eab64b3ffe400c40fdd989d1e1":
            "96bd7022d476a3c5a3ca1b7cd34cb042632678b4c7c1ecf7afad72e64dfa0c00",
    },
    "sql/db_migration_script_conversations.sql": {
        "67a78fefe7467ae02c227d1a04de20be78875ed5bd2ed917032eefea6bed72eb":
            "64e2638039fcbcae56fb1375b217af28a738b238fa8f4c87013926db46284f9d",
    },
}

# These migrations predate the checksum ledger on the production database.
# Existing installations adopt them once; fresh databases still execute them.
LEGACY_BASELINE_FILENAMES = frozenset({
    "database_schema.sql",
    "db_migration_add_permissions.sql",
    "db_migration_unified_files.sql",
    "db_migration_project_soft_delete.sql",
    "db_migration_episodes.sql",
    "db_migration_episode_scripts.sql",
    "db_migration_episode_script_segments.sql",
    "db_migration_multi_scripts.sql",
    "db_migration_storyboard_items.sql",
    "db_migration_assets.sql",
    "db_migration_script_id.sql",
    "db_migration_storyboard_audio_mix.sql",
    "db_migration_storyboard_pipeline_fields.sql",
    "db_migration_storyboard_reference_config.sql",
    "db_migration_clean_storyboard_data_urls.sql",
    "db_migration_files_project_episode_source.sql",
    "db_migration_character_voices.sql",
    "db_migration_video_segments.sql",
    "db_migration_video_voice_references.sql",
    "db_migration_timeline_tracks.sql",
    "db_migration_project_hub.sql",
    "db_migration_audio_tracks.sql",
    "db_migration_admin_users_groups.sql",
    "db_migration_credits.sql",
    "db_migration_credit_onboarding.sql",
    "db_migration_notifications.sql",
    "db_migration_organizations.sql",
    "db_migration_media_library.sql",
    "db_migration_media_library_folders.sql",
    "db_migration_admin.sql",
    "db_migration_api_config_category.sql",
    "db_migration_api_config_model_bindings.sql",
    "db_migration_gpt_image_providers.sql",
    "db_migration_provider_remote_objects.sql",
    "db_migration_admin_extra.sql",
    "db_migration_visibility_columns.sql",
    "db_migration_video_reverse.sql",
})


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


def migration_checksum_variants(path: Path) -> set[str]:
    """Return content-equivalent hashes for LF and CRLF checkouts."""
    raw = path.read_bytes()
    lf = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    crlf = lf.replace(b"\n", b"\r\n")
    return {
        hashlib.sha256(raw).hexdigest(),
        hashlib.sha256(lf).hexdigest(),
        hashlib.sha256(crlf).hexdigest(),
    }


def migration_checksum_matches(path: Path, version: str, recorded: str) -> bool:
    variants = migration_checksum_variants(path)
    if recorded in variants:
        return True
    canonical = LEGACY_CHECKSUM_ALIASES.get(version, {}).get(recorded)
    return bool(canonical and canonical in variants)


def migration_id(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def read_manifest(path: Path, *, root: Path) -> list[Path]:
    """Read an ordered migration manifest relative to the deployment root."""
    migrations: list[Path] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        migration = Path(line)
        migrations.append(migration if migration.is_absolute() else root / migration)
    return migrations


def prepare_migration_sql(sql: str) -> str:
    """Remove legacy outer transaction markers before the runner wraps the file."""
    return TRANSACTION_CONTROL.sub("", sql)


async def ensure_ledger(conn: Any) -> None:
    await conn.execute(LEDGER_DDL)


async def apply_one(
    conn: Any,
    path: Path,
    *,
    root: Path,
    git_sha: str = "",
    adopt_legacy_baseline: bool = False,
) -> str:
    if not path.is_file():
        raise FileNotFoundError(path)

    sql = prepare_migration_sql(path.read_text(encoding="utf-8"))
    checksum = migration_checksum(path)
    version = migration_id(path, root)
    existing = await conn.fetchrow(
        "SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = $1",
        version,
    )
    if existing:
        recorded = str(existing["checksum_sha256"])
        if not migration_checksum_matches(path, version, recorded):
            raise RuntimeError(
                f"Migration checksum mismatch for {version}: recorded={recorded}, current={checksum}"
            )
        return "skipped"

    if adopt_legacy_baseline and path.name in LEGACY_BASELINE_FILENAMES:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO schema_migrations (
                    migration_id, checksum_sha256, execution_ms, git_sha
                ) VALUES ($1, $2, 0, NULLIF($3, ''))
                """,
                version,
                checksum,
                git_sha or "legacy-baseline",
            )
        return "baselined"

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
    existing_schema = bool(await conn.fetchval("SELECT to_regclass('public.users') IS NOT NULL"))
    await ensure_ledger(conn)
    await conn.execute("SELECT pg_advisory_lock(hashtext($1))", LOCK_NAME)
    results: list[tuple[str, str]] = []
    try:
        for path in paths:
            state = await apply_one(
                conn,
                path,
                root=root,
                git_sha=git_sha,
                adopt_legacy_baseline=existing_schema,
            )
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
    parser.add_argument("--manifest", help="Ordered migration manifest relative to --root")
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
        root = Path(args.root)
        paths = read_manifest(Path(args.manifest), root=root) if args.manifest else []
        paths.extend(Path(item) for item in args.migrations)
        if not paths:
            raise ValueError("Provide migrations or --manifest unless --status is used")
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
