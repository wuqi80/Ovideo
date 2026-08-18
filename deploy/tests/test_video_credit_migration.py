from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_video_credit_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_video_credit_pricing.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_video_credit_pricing.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_video_credit_pricing.sql" in manifest


def test_video_credit_migration_documents_product_boundaries():
    sql = (DEPLOY_DIR / "db_migration_video_credit_pricing.sql").read_text(encoding="utf-8")

    assert "base_cost = 10" in sql
    assert "min_cost = 10" in sql
    assert "按20积分/元换算" in sql
    assert "HappyHorse 1.0 1080P 5秒为160积分" in sql
    assert "失败或取消不扣积分" in sql
