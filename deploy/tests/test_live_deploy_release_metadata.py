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


def test_live_deploy_syncs_video_interpolation_regression_tests():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert "tests/test_video_interpolation_service.py" in script
