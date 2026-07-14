"""Validate or execute GPU2 Wan/InfiniteTalk workflows directly in ComfyUI."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import imageio_ffmpeg
import requests
from PIL import Image, ImageDraw


ROOT = Path(os.environ.get("MECHA_GPU_ROOT", r"E:\MECHA-GPU"))
AGENT_DIR = ROOT / "agent"
LOG_DIR = ROOT / "logs"
BASE_URL = os.environ.get("MECHA_COMFYUI_URL", "http://127.0.0.1:8188")
TIMEOUT_SECONDS = 6 * 60 * 60

sys.path.insert(0, str(AGENT_DIR))
sys.path.insert(0, str(ROOT))

from windows_gpu_agent_runner import (  # noqa: E402
    GPU2_WAN_MODEL_FILES,
    build_gpu2_infinitetalk_workflow,
    build_gpu2_wan_i2v_workflow,
)


REQUIRED_NODES = {
    "WanVideoModelLoader",
    "WanVideoImageToVideoEncode",
    "WanVideoImageToVideoMultiTalk",
    "MultiTalkModelLoader",
    "Wav2VecModelLoader",
    "WanVideoSampler",
    "WanVideoDecode",
    "VHS_LoadVideo",
    "VHS_LoadAudioUpload",
    "VHS_VideoCombine",
}


def _model_paths() -> dict[str, Path]:
    models = ROOT / "ComfyUI_windows_portable" / "ComfyUI" / "models"
    return {
        "diffusion": models / "diffusion_models" / GPU2_WAN_MODEL_FILES["diffusion"],
        "infinitetalk": models / "diffusion_models" / GPU2_WAN_MODEL_FILES["infinitetalk"],
        "text_encoder": models / "text_encoders" / GPU2_WAN_MODEL_FILES["text_encoder"],
        "vae": models / "vae" / GPU2_WAN_MODEL_FILES["vae"],
        "clip_vision": models / "clip_vision" / GPU2_WAN_MODEL_FILES["clip_vision"],
        "lora": models / "loras" / GPU2_WAN_MODEL_FILES["lora"],
        "wav2vec": models / "wav2vec2" / GPU2_WAN_MODEL_FILES["wav2vec"],
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


def _make_test_image(path: Path) -> None:
    image = Image.new("RGB", (640, 384), (38, 54, 86))
    draw = ImageDraw.Draw(image)
    draw.ellipse((236, 62, 404, 230), fill=(222, 190, 164))
    draw.rectangle((210, 230, 430, 384), fill=(68, 98, 148))
    draw.ellipse((282, 122, 302, 142), fill=(20, 20, 24))
    draw.ellipse((338, 122, 358, 142), fill=(20, 20, 24))
    draw.arc((298, 146, 344, 184), 0, 180, fill=(90, 30, 36), width=4)
    image.save(path)


def _run_ffmpeg(arguments: list[str]) -> None:
    subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-y", *arguments],
        check=True,
        capture_output=True,
    )


def _make_voice_inputs(video_path: Path, audio_path: Path) -> None:
    _run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            "color=c=0x263656:s=640x384:r=16:d=2.1",
            "-pix_fmt",
            "yuv420p",
            str(video_path),
        ]
    )
    _run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:sample_rate=16000:duration=2.1",
            "-ac",
            "1",
            str(audio_path),
        ]
    )


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
        json={"prompt": workflow, "client_id": f"mecha-wan-smoke-{uuid.uuid4().hex}"},
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
                    for item in (output.get("gifs") or []) + (output.get("videos") or [])
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
    raise TimeoutError(f"GPU2 Wan smoke timed out: {prompt_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("readiness", "i2v", "infinitetalk"), default="readiness")
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    report_path = LOG_DIR / f"wan-{args.mode}-smoke-report.json"
    readiness = check_readiness()
    report: dict[str, Any] = {"mode": args.mode, "readiness": readiness}
    if not readiness["success"]:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        raise RuntimeError(f"GPU2 Wan readiness failed: {readiness}")

    if args.mode == "i2v":
        image_path = LOG_DIR / "wan-smoke-input.png"
        _make_test_image(image_path)
        image_name = _upload(image_path, "image/png")
        workflow = build_gpu2_wan_i2v_workflow(
            {
                "task_type": "i2v",
                "workflow_name": "wan2_i2v",
                "params": {
                    "image": image_name,
                    "prompt": "The person slowly blinks and slightly turns their head.",
                    "seed": 42,
                },
            }
        )
        report["execution"] = _submit_and_wait(workflow)
    elif args.mode == "infinitetalk":
        video_path = LOG_DIR / "infinitetalk-smoke-input.mp4"
        audio_path = LOG_DIR / "infinitetalk-smoke-audio.wav"
        _make_voice_inputs(video_path, audio_path)
        video_name = _upload(video_path, "video/mp4")
        audio_name = _upload(audio_path, "audio/wav")
        workflow = build_gpu2_infinitetalk_workflow(
            {
                "task_type": "voice",
                "workflow_name": "video_infinitetalk",
                "params": {
                    "video_filename": video_name,
                    "audio_filename": audio_name,
                    "prompt_AU": "A person speaks naturally with synchronized lips.",
                    "seed": 42,
                },
            }
        )
        report["execution"] = _submit_and_wait(workflow)

    report["success"] = readiness["success"] and report.get("execution", {}).get("success", True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not report["success"]:
        raise RuntimeError(f"GPU2 Wan smoke failed: {report}")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
