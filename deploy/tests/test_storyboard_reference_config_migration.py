from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
ROOT_MIGRATION = DEPLOY_DIR / "db_migration_storyboard_reference_config.sql"
SQL_MIRROR = DEPLOY_DIR / "sql" / "db_migration_storyboard_reference_config.sql"


def test_storyboard_reference_config_migration_is_mirrored():
    assert ROOT_MIGRATION.read_bytes() == SQL_MIRROR.read_bytes()


def test_storyboard_reference_config_migration_adds_jsonb_column():
    sql = SQL_MIRROR.read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS configured_references JSONB" in sql
    assert "DEFAULT '[]'::jsonb" in sql


def test_storyboard_reference_config_migration_is_in_deploy_ledgers():
    migration = "sql/db_migration_storyboard_reference_config.sql"
    live = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")
    automatic = (DEPLOY_DIR / "auto_deploy.sh").read_text(encoding="utf-8")
    assert migration in live
    assert f'"{migration}"' in automatic
