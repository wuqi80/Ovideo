"""Run the GPU2 Qwen compatibility graph directly against local ComfyUI."""
from __future__ import annotations

import io
import json
import os
import sys
import time
from pathlib import Path

import requests
from PIL import Image

from windows_gpu_agent_runner import build_gpu2_qwen_workflow


ROOT = Path(os.environ.get("MECHA_GPU_ROOT", r"E:\MECHA-GPU"))
COMFYUI_URL = os.environ.get("MECHA_COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")


def build_probe_png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), color=(34, 96, 180)).save(buffer, format="PNG")
    return buffer.getvalue()


def upload_probe_image(session: requests.Session) -> str:
    response = session.post(
        f"{COMFYUI_URL}/upload/image",
        files={"image": ("mecha-gpu2-qwen-smoke.png", build_probe_png(), "image/png")},
        data={"overwrite": "true"},
        timeout=30,
    )
    response.raise_for_status()
    name = str(response.json().get("name") or "").strip()
    if not name:
        raise RuntimeError(f"ComfyUI upload returned no filename: {response.text[:500]}")
    return name


def wait_for_result(session: requests.Session, prompt_id: str, timeout: int = 3600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = session.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=30)
        response.raise_for_status()
        entry = response.json().get(prompt_id)
        if entry:
            status = entry.get("status") or {}
            status_text = str(status.get("status_str") or "").lower()
            if status_text in {"error", "failed"}:
                raise RuntimeError(json.dumps(status, ensure_ascii=False)[:3000])
            outputs = entry.get("outputs") or {}
            if outputs:
                files = []
                for node_output in outputs.values():
                    files.extend(node_output.get("images") or [])
                if files:
                    return {"status": status, "files": files}
            if status.get("completed") is True:
                raise RuntimeError("ComfyUI completed the Qwen smoke without image output")
        time.sleep(3)
    raise TimeoutError(f"Qwen smoke timed out after {timeout}s: {prompt_id}")


def main() -> int:
    session = requests.Session()
    object_info = session.get(f"{COMFYUI_URL}/object_info", timeout=60)
    object_info.raise_for_status()
    nodes = object_info.json()
    required = {
        "LayerUtility: ImageScaleByAspectRatio V2",
        "TextEncodeQwenImageEditPlus",
        "CFGNorm",
    }
    missing = sorted(required.difference(nodes))
    if missing:
        raise RuntimeError(f"Required Qwen nodes are missing: {missing}")

    image_name = upload_probe_image(session)
    workflow = build_gpu2_qwen_workflow(
        {
            "task_type": "qwen_1",
            "params": {
                "image_path_1": image_name,
                "prompt": "Turn this reference into a simple blue square icon on a clean white background.",
                "seed": 20260713,
            },
        }
    )
    response = session.post(f"{COMFYUI_URL}/prompt", json={"prompt": workflow}, timeout=60)
    if not response.ok:
        raise RuntimeError(f"ComfyUI rejected Qwen smoke: HTTP {response.status_code} {response.text[:3000]}")
    prompt_id = str(response.json().get("prompt_id") or "").strip()
    if not prompt_id:
        raise RuntimeError(f"ComfyUI returned no prompt id: {response.text[:500]}")

    result = wait_for_result(session, prompt_id)
    report = {
        "success": True,
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "prompt_id": prompt_id,
        "files": result["files"],
    }
    report_path = ROOT / "logs" / "qwen-smoke-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"GPU2 direct Qwen smoke failed: {exc}", file=sys.stderr)
        raise
