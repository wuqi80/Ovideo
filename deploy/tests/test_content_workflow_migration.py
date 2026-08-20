from pathlib import Path

from scripts.apply_migrations import read_manifest


DEPLOY_DIR = Path(__file__).resolve().parents[1]
MIGRATION = DEPLOY_DIR / "sql" / "db_migration_content_workflow_model.sql"
MANIFEST = DEPLOY_DIR / "db_build" / "manifest.txt"


def test_content_workflow_migration_is_ordered_after_its_dependencies():
    names = [path.name for path in read_manifest(MANIFEST, root=DEPLOY_DIR)]
    workflow = names.index(MIGRATION.name)

    for dependency in (
        "db_migration_storyboard_items.sql",
        "db_migration_assets.sql",
        "db_migration_video_segments.sql",
        "db_migration_script_conversations.sql",
    ):
        assert names.index(dependency) < workflow


def test_content_workflow_migration_preserves_candidates_selection_and_lineage():
    sql = MIGRATION.read_text(encoding="utf-8")

    for snippet in (
        "ADD COLUMN IF NOT EXISTS lineage_id",
        "ADD COLUMN IF NOT EXISTS storyboard_lineage_id",
        "CREATE TABLE IF NOT EXISTS content_takes",
        "CREATE TABLE IF NOT EXISTS content_selections",
        "CREATE TABLE IF NOT EXISTS content_stale_events",
        "CREATE TABLE IF NOT EXISTS content_bindings",
        "scope IN ('project', 'shot')",
        "ADD COLUMN IF NOT EXISTS base_version_id",
        "ADD COLUMN IF NOT EXISTS patch JSONB",
        "confirmed_at",
        "rejected_at",
        "INSERT INTO content_takes",
        "INSERT INTO content_selections",
    ):
        assert snippet in sql

    assert "attachment_round BETWEEN 0 AND 3" in sql
    assert "WHERE f.is_selected = TRUE" in sql
    assert "f.file_role LIKE 'dialogue_audio:%'" in sql
