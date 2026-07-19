from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_project_media_is_not_publicly_cached():
    source = (DEPLOY_DIR / "cluster_main.py").read_text(encoding="utf-8")
    media_branch = source.split("if path.startswith('/storage/')", 1)[1].split(
        "elif path.startswith('/assets/')",
        1,
    )[0]
    assert "private, no-store" in media_branch
    assert "public" not in media_branch
