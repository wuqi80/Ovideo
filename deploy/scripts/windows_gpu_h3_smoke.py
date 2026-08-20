"""Validate or execute MiniMax H3 FL2VA on GPU2's isolated ComfyUI sidecar."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageDraw


ROOT = Path(os.environ.get("MECHA_GPU_ROOT", r"E:\MECHA-GPU"))
AGENT_DIR = ROOT / "agent"
LOG_DIR = ROOT / "logs"
BASE_URL = os.environ.get("MECHA_H3_COMFYUI_URL", "http://127.0.0.1:8188")
TIMEOUT_SECONDS = 6 * 60 * 60

sys.path.insert(0, str(AGENT_DIR))
sys.path.insert(0, str(ROOT))

from windows_gpu_agent_runner import (  # noqa: E402
    GPU2_H3_HEIGHT,
    GPU2_H3_MODEL_FILES,
    GPU2_H3_WIDTH,
    build_gpu2_minimax_h3_fl2va_workflow,
)


REQUIRED_NODES = {
    "MiniMaxH3ImageToVideo",
    "UNETLoader",
    "CLIPLoader",
    "VAELoader",
    "VAEDecode",
    "VAEDecodeAudio",
    "BasicScheduler",
    "KSamplerSelect",
    "SamplerCustomAdvanced",
    "BasicGuider",
    "RandomNoise",
    "CreateVideo",
    "SaveVideo",
}


def _model_paths() -> dict[str, Path]:
    models = ROOT / "ComfyUI-H3" / "ComfyUI" / "models"
    return {
        "diffusion": models / "diffusion_models" / GPU2_H3_MODEL_FILES["diffusion"],
        "text_encoder": models / "text_encoders" / GPU2_H3_MODEL_FILES["text_encoder"],
        "video_vae": models / "vae" / GPU2_H3_MODEL_FILES["video_vae"],
        "audio_vae": models / "vae" / GPU2_H3_MODEL_FILES["audio_vae"],
    }


def check_readiness() -> dict[str, Any]:
    response = requests.get(f"{BASE_URL}/object_info", timeout=30)
    response.raise_for_status()
    object_info = response.json()
    nodes = {node: node in object_info for node in sorted(REQUIRED_NODES)}
    models = {name: path.exists() for name, path in _model_paths().items()}
    return {
        "success": all(nodes.values()) and all(models.values()),
        "nodes": nodes,
        "models": models,
    }


def _make_test_image(path: Path, *, ending: bool = False) -> None:
    image = Image.new("RGB", (GPU2_H3_WIDTH, GPU2_H3_HEIGHT), (23, 38, 62) if not ending else (54, 24, 68))
    draw = ImageDraw.Draw(image)
    ground_y = int(GPU2_H3_HEIGHT * 0.69)
    draw.rectangle((0, ground_y, GPU2_H3_WIDTH, GPU2_H3_HEIGHT), fill=(33, 54, 38) if not ending else (70, 38, 82))
    x_offset = 0 if not ending else 90
    draw.ellipse((276 + x_offset, 82, 452 + x_offset, 258), fill=(226, 192, 150))
    draw.rectangle((304 + x_offset, 250, 424 + x_offset, 408), fill=(82, 124, 188))
    draw.ellipse((324 + x_offset, 146, 342 + x_offset, 164), fill=(18, 18, 22))
    draw.ellipse((386 + x_offset, 146, 404 + x_offset, 164), fill=(18, 18, 22))
    draw.arc((348 + x_offset, 170, 382 + x_offset, 206), 0, 180, fill=(90, 30, 36), width=4)
    image.save(path)


def _upload(path: Path, content_type: str) -> str:
    with path.open("rb") as handle:
        response = requests.post(
            f"{BASE_URL}/upload/image",
            files={"image": (path.name, handle, content_type)},
            data={"overwrite": "true"},
            timeout=300,
        )
    response.raise_for_status()
    return str(response.json().get("name") or path.name)


def _submit_and_wait(workflow: dict[str, Any]) -> dict[str, Any]:
    started_at = time.time()
    response = requests.post(
        f"{BASE_URL}/prompt",
        json={"prompt": workflow, "client_id": f"mecha-h3-smoke-{uuid.uuid4().hex}"},
        timeout=120,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("node_errors"):
        raise RuntimeError(f"ComfyUI rejected workflow: {payload['node_errors']}")
    prompt_id = payload.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {payload}")

    deadline = time.time() + TIMEOUT_SECONDS
    while time.time() < deadline:
        history_response = requests.get(f"{BASE_URL}/history/{prompt_id}", timeout=60)
        history_response.raise_for_status()
        history = history_response.json().get(prompt_id)
        if history:
            status = history.get("status") or {}
            outputs = history.get("outputs") or {}
            video_info = next(
                (
                    item
                    for output in outputs.values()
                    for item in (
                        (output.get("gifs") or [])
                        + (output.get("videos") or [])
                        + [
                            image
                            for image, animated in zip(
                                output.get("images") or [],
                                output.get("animated") or [],
                            )
                            if animated or str(image.get("filename", "")).lower().endswith((".mp4", ".webm", ".mov"))
                        ]
                    )
                ),
                None,
            )
            success = status.get("status_str") == "success" and bool(video_info)
            return {
                "success": success,
                "prompt_id": prompt_id,
                "duration_seconds": round(time.time() - started_at, 2),
                "status": status,
                "video": video_info,
            }
        time.sleep(10)
    raise TimeoutError(f"MiniMax H3 smoke timed out: {prompt_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("readiness", "i2v", "fl2va"), default="readiness")
    parser.add_argument("--duration", type=float, default=4.0)
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    report_path = LOG_DIR / f"h3-{args.mode}-smoke-report.json"
    readiness = check_readiness()
    report: dict[str, Any] = {"mode": args.mode, "readiness": readiness}
    if not readiness["success"]:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        raise RuntimeError(f"MiniMax H3 readiness failed: {readiness}")

    if args.mode in {"i2v", "fl2va"}:
        first_path = LOG_DIR / "h3-smoke-first.png"
        _make_test_image(first_path)
        first_name = _upload(first_path, "image/png")
        params = {
            "model": "MiniMaxH3",
            "image_path": first_name,
            "prompt": (
                "A calm cinematic test shot. The character slowly raises their hand, "
                "subtle camera drift, stable face and clothing, natural motion. "
                "Audio: soft ambient room tone."
            ),
            "duration": args.duration,
            "seed": 42,
        }
        files = [{"param": "image_path", "filename": first_name}]
        if args.mode == "fl2va":
            last_path = LOG_DIR / "h3-smoke-last.png"
            _make_test_image(last_path, ending=True)
            last_name = _upload(last_path, "image/png")
            params["image_path_end"] = last_name
            files.append({"param": "image_path_end", "filename": last_name})

        workflow = build_gpu2_minimax_h3_fl2va_workflow(
            {"task_type": "morph" if args.mode == "fl2va" else "i2v", "params": params, "files": files}
        )
        report["execution"] = _submit_and_wait(workflow)

    report["success"] = readiness["success"] and report.get("execution", {}).get("success", True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not report["success"]:
        raise RuntimeError(f"MiniMax H3 smoke failed: {report}")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
