from pathlib import Path

from scripts.check_open_source_hygiene import IMMUTABLE_MIGRATION_PATH, scan_repository


def test_tracked_files_pass_open_source_hygiene() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    issues = scan_repository(repository_root)
    assert issues == [], "\n".join(
        f"{issue.path}:{issue.line} [{issue.rule}]" for issue in issues
    )


def test_legacy_identifier_exception_is_limited_to_migration_sql() -> None:
    assert IMMUTABLE_MIGRATION_PATH.match("deploy/sql/db_migration_example.sql")
    assert IMMUTABLE_MIGRATION_PATH.match("deploy/database_schema.sql")
    assert not IMMUTABLE_MIGRATION_PATH.match("deploy/core/database_config.py")
    assert not IMMUTABLE_MIGRATION_PATH.match("deploy/docs/database.md")
