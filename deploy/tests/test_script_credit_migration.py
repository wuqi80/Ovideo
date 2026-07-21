from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_script_credit_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_script_credit_rules.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_script_credit_rules.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_script_credit_rules.sql" in manifest


def test_script_credit_rules_cover_tokens_shots_and_models():
    sql = (DEPLOY_DIR / "db_migration_script_credit_rules.sql").read_text(encoding="utf-8")

    assert "script_model_call" in sql
    assert "storyboard_design_generation" in sql
    assert '"input_tokens"' in sql
    assert '"output_tokens"' in sql
    assert '"shot_count"' in sql
    assert '"model"' in sql
