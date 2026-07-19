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
    assert "JOIN credit_accounts ca ON ca.account_id = ct.account_id" in sql
    assert "SET available_credits = available_credits + initial_credits" in sql
    assert "balance_before_value" in sql
    assert "balance_after_value" in sql
    assert "credit_onboarding_backfill" in sql


def test_live_deploy_runs_credit_prerequisites_before_onboarding():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")
    credits = script.index("sql/db_migration_credits.sql")
    onboarding = script.index("sql/db_migration_credit_onboarding.sql")

    assert credits < onboarding
    assert "sql/db_migration_files_project_episode_source.sql" in script
    assert '"scripts/apply_migrations.py"' in script


def test_auto_deploy_does_not_ignore_required_migration_failures():
    script = (DEPLOY_DIR / "auto_deploy.sh").read_text(encoding="utf-8")
    credits = script.index('"sql/db_migration_credits.sql"')
    onboarding = script.index('"sql/db_migration_credit_onboarding.sql"')

    assert credits < onboarding
    assert '"sql/db_migration_files_project_episode_source.sql"' in script
    assert "scripts/apply_migrations.py" in script
    runner_line = next(line for line in script.splitlines() if "python3 scripts/apply_migrations.py" in line)
    assert "|| true" not in runner_line
