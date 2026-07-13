"""Run a tiny SeedVR2 video enhancement directly against GPU2 ComfyUI."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import imageio_ffmpeg
import requests


ROOT = Path(os.environ.get("MECHA_GPU_ROOT", r"E:\MECHA-GPU"))
LOG_DIR = ROOT / "logs"
AGENT_DIR = ROOT / "agent"
BASE_URL = "http://127.0.0.1:8188"

sys.path.insert(0, str(AGENT_DIR))

from windows_gpu_agent_runner import build_gpu2_video_upscale_workflow  # noqa: E402


def _make_test_video(path: Path) -> None:
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=96x64:rate=1:duration=2",
        "-pix_fmt",
        "yuv420p",
        str(path),
    ]
    subprocess.run(command, check=True, capture_output=True)


def _download_output(file_info: dict, destination: Path) -> None:
    response = requests.get(
        f"{BASE_URL}/view",
        params={
            "filename": file_info.get("filename", ""),
            "subfolder": file_info.get("subfolder", ""),
            "type": file_info.get("type", "output"),
        },
        timeout=120,
    )
    response.raise_for_status()
    destination.write_bytes(response.content)


def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    source = LOG_DIR / "video-smoke-input.mp4"
    result_path = LOG_DIR / "video-smoke-output.mp4"
    report_path = LOG_DIR / "video-smoke-report.json"
    _make_test_video(source)

    with source.open("rb") as handle:
        upload = requests.post(
            f"{BASE_URL}/upload/image",
            files={"image": (source.name, handle, "video/mp4")},
            data={"overwrite": "true"},
            timeout=120,
        )
    upload.raise_for_status()
    uploaded_name = upload.json().get("name") or source.name

    workflow = build_gpu2_video_upscale_workflow(
        {"task_type": "upscale", "params": {"video_filename": uploaded_name, "seed": 42}}
    )
    workflow["4"]["inputs"]["resolution"] = 64
    workflow["4"]["inputs"]["max_resolution"] = 128
    workflow["5"]["inputs"].pop("audio", None)
    workflow["5"]["inputs"]["filename_prefix"] = "MECHA_GPU2_video_smoke"

    started_at = time.time()
    response = requests.post(
        f"{BASE_URL}/prompt",
        json={"prompt": workflow, "client_id": f"mecha-video-smoke-{uuid.uuid4().hex}"},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("node_errors"):
        raise RuntimeError(f"ComfyUI rejected video workflow: {payload['node_errors']}")
    prompt_id = payload.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {payload}")

    deadline = time.time() + 7200
    while time.time() < deadline:
        history_response = requests.get(f"{BASE_URL}/history/{prompt_id}", timeout=30)
        history_response.raise_for_status()
        history = history_response.json().get(prompt_id)
        if history:
            status = history.get("status") or {}
            outputs = history.get("outputs") or {}
            video_info = next(
                (
                    item
                    for output in outputs.values()
                    for item in (output.get("gifs") or []) + (output.get("videos") or [])
                ),
                None,
            )
            success = status.get("status_str") == "success" and bool(video_info)
            report = {
                "success": success,
                "prompt_id": prompt_id,
                "duration_seconds": round(time.time() - started_at, 2),
                "status": status,
                "outputs": outputs,
            }
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            if not success:
                raise RuntimeError(f"SeedVR2 video smoke failed: {status}")
            _download_output(video_info, result_path)
            return
        time.sleep(5)

    raise TimeoutError(f"SeedVR2 video smoke timed out: {prompt_id}")


if __name__ == "__main__":
    main()
