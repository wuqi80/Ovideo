"""Run a minimal local SeedVR2 generation against the GPU2 ComfyUI service."""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

import requests


ROOT = Path(os.environ.get("OSTORY_GPU_ROOT", r"E:\OSTORY-GPU"))
LOG_DIR = ROOT / "logs"
AGENT_DIR = ROOT / "agent"
BASE_URL = "http://127.0.0.1:8188"

sys.path.insert(0, str(AGENT_DIR))

from windows_gpu_agent_runner import build_gpu2_upscale_workflow  # noqa: E402


def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    workflow = build_gpu2_upscale_workflow(
        {"params": {"image_path": "example.png", "seed_0": 42}, "files": []}
    )
    resolution = int(os.environ.get("OSTORY_GPU_SMOKE_RESOLUTION", "64"))
    blocks_to_swap = int(
        os.environ.get("OSTORY_GPU_SMOKE_BLOCKS_TO_SWAP", workflow["2"]["inputs"]["blocks_to_swap"])
    )
    workflow["2"]["inputs"]["blocks_to_swap"] = blocks_to_swap
    workflow["4"]["inputs"]["resolution"] = resolution
    workflow["4"]["inputs"]["max_resolution"] = max(128, resolution * 2)
    workflow["5"]["inputs"]["filename_prefix"] = "OSTORY_GPU2_smoke"

    started_at = time.time()
    response = requests.post(
        f"{BASE_URL}/prompt",
        json={"prompt": workflow, "client_id": f"ostory-gpu2-smoke-{uuid.uuid4().hex}"},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("node_errors"):
        raise RuntimeError(f"ComfyUI rejected workflow: {payload['node_errors']}")
    prompt_id = payload.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {payload}")

    deadline = time.time() + 1800
    while time.time() < deadline:
        history_response = requests.get(f"{BASE_URL}/history/{prompt_id}", timeout=30)
        history_response.raise_for_status()
        history = history_response.json().get(prompt_id)
        if history:
            status = history.get("status") or {}
            result = {
                "success": status.get("status_str") == "success",
                "prompt_id": prompt_id,
                "duration_seconds": round(time.time() - started_at, 2),
                "status": status,
                "outputs": history.get("outputs") or {},
            }
            (LOG_DIR / "seedvr-smoke-result.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            if not result["success"]:
                raise RuntimeError(f"SeedVR2 smoke failed: {status}")
            return
        time.sleep(3)

    raise TimeoutError(f"SeedVR2 smoke timed out: {prompt_id}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        (LOG_DIR / "seedvr-smoke-error.txt").write_text(str(exc), encoding="utf-8")
        raise
