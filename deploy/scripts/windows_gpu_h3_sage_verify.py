"""Verify H3 SageAttention dependencies without loading a model or running inference."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_NODE_TYPES = {
    "PathchSageAttentionKJ",
    "MiniMaxH3MemoryEfficientSageAttentionPatch",
}
REQUIRED_SAGE_VERSION = "2.2.0"
REVIEWED_KJNODES_COMMIT = "6ab7e8130e449ed2c0037589bcf84146ceb7fc9c"


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


def verify(port: int, kjnodes_root: Path) -> dict:
    import torch
    import sageattention

    sage_version = importlib.metadata.version("sageattention")
    if sage_version != REQUIRED_SAGE_VERSION:
        raise RuntimeError(
            f"SageAttention {REQUIRED_SAGE_VERSION} required, found {sage_version}"
        )
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable in the isolated H3 Python runtime")
    major, minor = torch.cuda.get_device_capability(0)
    cuda_arch = f"sm{major}{minor}"
    if cuda_arch != "sm86":
        raise RuntimeError(f"Expected RTX 3060 sm86, found {cuda_arch}")
    if not callable(getattr(sageattention, "sageattn", None)):
        raise RuntimeError("sageattention.sageattn is unavailable")

    commit_file = kjnodes_root / ".mecha-reviewed-commit"
    try:
        kjnodes_commit = commit_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Reviewed KJNodes commit marker is unavailable: {exc}") from exc
    if kjnodes_commit != REVIEWED_KJNODES_COMMIT:
        raise RuntimeError(
            f"Expected reviewed KJNodes commit {REVIEWED_KJNODES_COMMIT}, found {kjnodes_commit}"
        )

    with urllib.request.urlopen(f"http://127.0.0.1:{port}/object_info", timeout=10) as response:
        object_info = json.loads(response.read().decode("utf-8"))
    missing = sorted(REQUIRED_NODE_TYPES - set(object_info or {}))
    if missing:
        raise RuntimeError(f"ComfyUI is missing required nodes: {', '.join(missing)}")

    return {
        "verified": True,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "sageattention_version": sage_version,
        "cuda_arch": cuda_arch,
        "torch_version": str(torch.__version__),
        "torch_cuda_version": str(torch.version.cuda or ""),
        "kjnodes_commit": kjnodes_commit,
        "required_node_types": sorted(REQUIRED_NODE_TYPES),
        "inference_executed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8188)
    parser.add_argument("--install-root", default=r"E:\MECHA-GPU")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    install_root = Path(args.install_root)
    output = Path(args.output) if args.output else install_root / "config" / "h3-sageattention-ready.json"
    kjnodes_root = install_root / "ComfyUI-H3" / "ComfyUI" / "custom_nodes" / "ComfyUI-KJNodes"
    try:
        payload = verify(args.port, kjnodes_root)
        _atomic_write_json(output, payload)
    except Exception:
        output.unlink(missing_ok=True)
        raise
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
