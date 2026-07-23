from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_design_credit_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_design_credit_rules.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_design_credit_rules.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_design_credit_rules.sql" in manifest


def test_design_credit_rules_cover_image_angle_and_upscale():
    sql = (DEPLOY_DIR / "db_migration_design_credit_rules.sql").read_text(encoding="utf-8")

    assert "design_image_generation" in sql
    assert "design_angle_adjustment" in sql
    assert "design_upscale_hd" in sql
    assert '"image_count"' in sql
    assert '"cost_per_unit":10' in sql
