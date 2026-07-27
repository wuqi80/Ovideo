from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_release_metadata_dirty_check_ignores_line_ending_noise():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert "git status --porcelain --untracked-files=no" not in script
    assert "git -c core.filemode=false diff --quiet --ignore-space-at-eol --no-ext-diff -- ." in script
    assert "git -c core.filemode=false diff --cached --quiet --ignore-space-at-eol --no-ext-diff -- ." in script
    assert "line-ending noise" in script


def test_live_deploy_builds_studio_as_a_sibling_application():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert 'STUDIO_LOCAL_DIR="${STUDIO_LOCAL_DIR:-../studio}"' in script
    assert 'STUDIO_REMOTE_DIR="${STUDIO_REMOTE_DIR:-$(dirname "$REMOTE_DIR")/studio}"' in script
    assert "studio_source_hash()" in script
    assert "npm run build || (npm ci && npm run build)" in script
    assert '\\"studio_source_sha256\\":\\"$STUDIO_SOURCE_HASH\\"' in script


def test_live_deploy_syncs_pipeline_and_preserves_admin_uploaded_workflows():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert '  "pipeline"' in script
    assert "workflows_bak='$REMOTE_DIR'/workflows.bak.\\$ts" in script
    assert "WORKFLOWS_BACKUP_PATH=$(printf" in script
    assert "cp -a '${WORKFLOWS_BACKUP_PATH:-}'/. '$REMOTE_DIR'/workflows" in script
    upload_section = script.split('echo "Uploading MVC/API management files..."', 1)[1]
    assert "find '$REMOTE_DIR'/workflows -mindepth 1 -maxdepth 1 -type f -delete" not in upload_section
    assert "without deleting valid templates uploaded from" in upload_section


def test_live_deploy_syncs_all_regression_tests_and_prunes_remote_stale_tests():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert "db_migration_*.sql" in script
    assert "scripts/*.py" in script
    assert "tests/*.py" in script
    assert "deploy-tests.bak." in script
    assert "tests backup:" in script
    assert "find '$REMOTE_DIR' -mindepth 1 -maxdepth 1 -type d -name 'tests.bak.*'" in script
    assert "rm -rf '$REMOTE_DIR'/tests" in script


def test_live_deploy_uses_unique_remote_temp_artifacts_per_run():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert 'DEPLOY_RUN_ID="${DEPLOY_RUN_ID:-$(date +%Y%m%d%H%M%S)-$$}"' in script
    assert '/tmp/mecha-new_html-src-$DEPLOY_RUN_ID.tgz' in script
    assert '/tmp/mecha-studio-src-$DEPLOY_RUN_ID.tgz' in script
    assert '/tmp/mecha-backend-src-$DEPLOY_RUN_ID.tgz' in script
    assert '/tmp/mecha-release-metadata-$DEPLOY_RUN_ID.json' in script
    assert 'RELEASE_METADATA_REMOTE_CANDIDATE="/tmp/mecha-release-metadata.json"' not in script
