from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
ROOT_MIGRATION = DEPLOY_DIR / "db_migration_credit_onboarding.sql"
SQL_MIRROR = DEPLOY_DIR / "sql" / "db_migration_credit_onboarding.sql"


def test_credit_onboarding_migration_mirror_matches():
    assert ROOT_MIGRATION.read_bytes() == SQL_MIRROR.read_bytes()


def test_credit_onboarding_is_one_time_and_audited():
    sql = ROOT_MIGRATION.read_text(encoding="utf-8")

    assert "initial_credits CONSTANT INTEGER := 1000" in sql
    assert "AFTER INSERT ON users" in sql
    assert "ON CONFLICT (owner_type, owner_id) DO NOTHING" in sql
    assert "DROP TRIGGER" not in sql
    assert "FROM pg_trigger" in sql
    assert "'signup_grant'" in sql
    assert "NOT EXISTS (" in sql
    assert "credit_onboarding_backfill" in sql
