from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
ROOT_MIGRATION = DEPLOY_DIR / "db_migration_provider_remote_objects.sql"
SQL_MIRROR = DEPLOY_DIR / "sql" / "db_migration_provider_remote_objects.sql"


def test_provider_remote_objects_migration_is_mirrored():
    assert ROOT_MIGRATION.read_bytes() == SQL_MIRROR.read_bytes()


def test_provider_remote_objects_migration_defines_owner_key():
    sql = SQL_MIRROR.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS provider_remote_objects" in sql
    assert "PRIMARY KEY (provider, object_type, object_id)" in sql
    assert "user_id TEXT NOT NULL" in sql


def test_provider_remote_objects_migration_is_in_deploy_ledgers():
    migration = "sql/db_migration_provider_remote_objects.sql"
    live = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")
    automatic = (DEPLOY_DIR / "auto_deploy.sh").read_text(encoding="utf-8")
    assert migration in live
    assert f'"{migration}"' in automatic
