"""Verify H3 Director dependencies without loading a model or running inference."""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REVIEWED_DIRECTOR_COMMIT = "85863be2411eb1b5877c23414d88396c47838467"
REQUIRED_NODE_TYPES = {
    "MiniMaxH3Director",
    "MiniMaxH3DirectorGroupImageToVideo",
    "MiniMaxH3DirectorGroupsCombine",
    "CreateVideo",
    "SaveVideo",
}
CONFLICTING_NODE_TYPES = {
    "MiniMaxH3MotionContext",
    "MiniMaxH3MotionContextTrim",
    "MiniMaxH3MotionContextSaveLatent",
    "MiniMaxH3MotionContextLoadLatent",
}


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def verify(port: int, director_root: Path) -> dict:
    commit_file = director_root / ".mecha-reviewed-commit"
    try:
        director_commit = commit_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Reviewed Director commit marker is unavailable: {exc}") from exc
    if director_commit != REVIEWED_DIRECTOR_COMMIT:
        raise RuntimeError(
            f"Expected reviewed Director commit {REVIEWED_DIRECTOR_COMMIT}, found {director_commit}"
        )

    with urllib.request.urlopen(f"http://127.0.0.1:{port}/object_info", timeout=10) as response:
        object_info = json.loads(response.read().decode("utf-8"))
    live_nodes = set(object_info or {})
    conflicts = sorted(CONFLICTING_NODE_TYPES & live_nodes)
    if conflicts:
        raise RuntimeError(
            "Standalone Motion Context must not be installed with Director: "
            + ", ".join(conflicts)
        )
    missing = sorted(REQUIRED_NODE_TYPES - live_nodes)
    if missing:
        raise RuntimeError(f"ComfyUI is missing required Director nodes: {', '.join(missing)}")

    return {
        "verified": True,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "director_commit": director_commit,
        "required_node_types": sorted(REQUIRED_NODE_TYPES),
        "conflicting_node_types_absent": sorted(CONFLICTING_NODE_TYPES),
        "context_frames": 22,
        "audio_context_frames": 24,
        "inference_executed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8188)
    parser.add_argument("--install-root", default=r"E:\MECHA-GPU")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    install_root = Path(args.install_root)
    output = Path(args.output) if args.output else install_root / "config" / "h3-long-video-ready.json"
    director_root = (
        install_root
        / "ComfyUI-H3"
        / "ComfyUI"
        / "custom_nodes"
        / "ComfyUI_MiniMaxH3_Director"
    )
    try:
        payload = verify(args.port, director_root)
        _atomic_write_json(output, payload)
    except Exception:
        output.unlink(missing_ok=True)
        raise
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
