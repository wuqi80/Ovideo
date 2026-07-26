from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_release_metadata_dirty_check_ignores_line_ending_noise():
    script = (DEPLOY_DIR / "scripts" / "live_deploy_mvc2.sh").read_text(encoding="utf-8")

    assert "git status --porcelain --untracked-files=no" not in script
    assert "git -c core.filemode=false diff --quiet --ignore-space-at-eol --no-ext-diff -- ." in script
    assert "git -c core.filemode=false diff --cached --quiet --ignore-space-at-eol --no-ext-diff -- ." in script
    assert "line-ending noise" in script
