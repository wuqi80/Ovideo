"""Exercise production upload -> queue -> selected GPU -> result paths."""
from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

import requests
from PIL import Image


WORKFLOWS = {
    "upscale_hd",
    "remove_watermark",
    "three_view",
    "qwen",
    "qwen_lora",
    "qwenN",
    "qwenN_lora",
    "kontext",
    "i2i_fj",
    "i2i_human",
    "i2i_around",
    "matting_subject",
    "matting_split",
    "image_fusion",
    "image_transfer",
    "pose_imitation",
    "panorama_360",
    "panorama_fusion_1",
    "panorama_fusion_3",
    "auto_storyboard",
    "i2v",
    "morph",
    "interpolate",
    "video_upscale",
}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", choices=sorted(WORKFLOWS), default="upscale_hd")
    parser.add_argument("--timeout", type=int, default=7200)
    parser.add_argument(
        "--agent-id",
        default=os.environ.get("MECHA_GPU_AGENT_ID")
        or os.environ.get("MECHA_GPU2_AGENT_ID", ""),
        help="Target Agent ID; MECHA_GPU_AGENT_ID and legacy MECHA_GPU2_AGENT_ID are supported.",
    )
    parser.add_argument("--agent-name", default=os.environ.get("MECHA_GPU_AGENT_NAME", "GPU"))
    parser.add_argument("--reference-count", type=int, choices=range(1, 7), default=1)
    parser.add_argument("--output-width", type=int, default=1024)
    parser.add_argument("--output-height", type=int, default=768)
    parser.add_argument("--duration", type=int, choices=range(1, 16), default=5)
    parser.add_argument(
        "--video-model",
        default="Wan2",
        help="Backend video model label used by i2v/morph smoke tasks.",
    )
    parser.add_argument("--expect-min-width", type=int, default=0)
    parser.add_argument("--expect-min-images", type=int, default=1)
    return parser.parse_args()


def _submit_workflow(
    session: requests.Session,
    base_url: str,
    headers: dict[str, str],
    filename: str,
    workflow: str,
    agent_id: str,
    *,
    reference_filenames: list[str] | None = None,
    video_filename: str = "",
    output_width: int = 1024,
    output_height: int = 768,
    duration: int = 5,
    video_model: str = "Wan2",
) -> requests.Response:
    routing = {"preferred_agent_id": agent_id, "preferred_node_id": agent_id}
    if workflow == "video_upscale":
        endpoint = "/api/generate"
        payload = {
            "task_type": "upscale",
            "video_filename": filename,
            "seed": 20260713,
            "resolution": "360P",
            "priority": 2,
            **routing,
        }
    elif workflow == "interpolate":
        endpoint = "/api/generate"
        payload = {
            "task_type": "interpolate",
            "video_filename": video_filename or filename,
            "target_fps": 30,
            "seed": 20260713,
            "priority": 2,
            **routing,
        }
    elif workflow in {"i2v", "morph"}:
        references = reference_filenames or [filename]
        endpoint = "/api/generate"
        payload = {
            "task_type": workflow,
            "image_path": references[0],
            "prompt": "A subtle camera push while the subject remains visually consistent.",
            "negative_prompt": "bad quality, distorted anatomy, flicker, text, logo",
            "model": video_model,
            "duration": duration,
            "seed": 20260713,
            "priority": 2,
            **routing,
        }
        if workflow == "morph":
            payload["image_path_end"] = references[-1]
    elif workflow in {"upscale_hd", "remove_watermark", "three_view"}:
        endpoint = "/api/materials/process"
        payload = {"image_filename": filename, "workflow_type": workflow, **routing}
    elif workflow in {"qwen", "qwen_lora", "qwenN", "qwenN_lora", "kontext"}:
        endpoint = "/api/generate/comfyui-workflow"
        payload = {
            "workflow_type": workflow,
            "prompt": "Keep the reference composition and render a clean, high quality result.",
            "image_filenames": reference_filenames or [filename],
            "seed": 20260713,
            "output_width": output_width,
            "output_height": output_height,
            **routing,
        }
    elif workflow in {"matting_subject", "matting_split"}:
        endpoint = "/api/generate/matting"
        payload = {
            "image_filename": filename,
            "matting_type": workflow.removeprefix("matting_"),
            "seed": 20260713,
            **routing,
        }
    elif workflow in {"image_fusion", "image_transfer", "pose_imitation"}:
        endpoint = "/api/generate/image-fusion"
        type_map = {
            "image_fusion": "fusion",
            "image_transfer": "transfer",
            "pose_imitation": "imitation",
        }
        payload = {
            "fusion_type": type_map[workflow],
            "image_bk": filename,
            "image_hu": filename,
            "seed": 20260713,
            **routing,
        }
        if workflow == "image_transfer":
            payload["image_mb"] = filename
    elif workflow == "panorama_360":
        endpoint = "/api/generate/panorama-360"
        payload = {
            "image_filename": filename,
            "prompt": "A seamless blue-hour panorama.",
            "seed": 20260713,
            **routing,
        }
    elif workflow in {"panorama_fusion_1", "panorama_fusion_3"}:
        endpoint = "/api/generate/panorama-fusion"
        payload = {
            "image_1": filename,
            "image_3": filename,
            "prompt": "A seamless blue-hour panorama.",
            "seed": 20260713,
            **routing,
        }
        if workflow == "panorama_fusion_3":
            payload["image_2"] = filename
    elif workflow == "auto_storyboard":
        endpoint = "/api/generate/auto-storyboard"
        payload = {
            "image_filename": filename,
            "prompt": "The subject turns and walks toward the window.",
            "seed": 20260713,
            **routing,
        }
    else:
        endpoint_map = {
            "i2i_fj": "/api/generate/angle-adjust",
            "i2i_human": "/api/generate/human-multi-angle",
            "i2i_around": "/api/generate/around-angle",
        }
        endpoint = endpoint_map[workflow]
        payload = {"image_filename": filename, "seed": 20260713, **routing}
        if workflow in {"i2i_fj", "i2i_around"}:
            payload["prompt"] = "Show the same subject from a left three-quarter angle."
    return session.post(
        f"{base_url}{endpoint}",
        headers={**headers, "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )


def _build_smoke_video() -> bytes:
    with tempfile.TemporaryDirectory(prefix="mecha-gpu2-e2e-") as temp_dir:
        output_path = Path(temp_dir) / "gpu2-e2e-smoke.mp4"
        ffmpeg_exe = shutil.which("ffmpeg")
        if not ffmpeg_exe:
            try:
                import imageio_ffmpeg

                ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
            except (ImportError, RuntimeError) as exc:
                raise RuntimeError("ffmpeg is required to build the GPU2 video smoke input") from exc
        command = [
            ffmpeg_exe,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x2a5ba8:s=64x64:r=2:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(output_path),
        ]
        subprocess.run(command, check=True, timeout=60)
        return output_path.read_bytes()


def _upload_input(
    session: requests.Session,
    base_url: str,
    headers: dict[str, str],
    workflow: str,
    *,
    reference_index: int = 1,
) -> dict:
    if workflow == "video_upscale":
        upload = session.post(
            f"{base_url}/api/upload",
            headers=headers,
            files={"file": ("gpu2-e2e-smoke.mp4", _build_smoke_video(), "video/mp4")},
            timeout=60,
        )
    else:
        image = Image.new(
            "RGB",
            (64, 64),
            color=(
                (42 + reference_index * 23) % 255,
                (91 + reference_index * 37) % 255,
                (168 + reference_index * 41) % 255,
            ),
        )
        image_bytes = io.BytesIO()
        image.save(image_bytes, format="PNG")
        upload = session.post(
            f"{base_url}/api/comfyui/upload",
            headers=headers,
            files={
                "image": (
                    f"gpu-e2e-reference-{reference_index}.png",
                    image_bytes.getvalue(),
                    "image/png",
                )
            },
            data={"node_type": "image"},
            timeout=60,
        )
    upload.raise_for_status()
    return upload.json()


def main() -> int:
    args = _parse_args()
    base_url = os.environ.get("MECHA_BASE_URL", "https://spti.ai").rstrip("/")
    password = os.environ.get("ADMIN_PASSWORD", "").strip()
    agent_id = args.agent_id.strip()
    if not password or not agent_id:
        raise RuntimeError(
            "ADMIN_PASSWORD and --agent-id (or MECHA_GPU_AGENT_ID) are required"
        )

    session = requests.Session()
    login = session.post(
        f"{base_url}/api/login",
        json={"username": "admin", "password": password},
        timeout=30,
    )
    login.raise_for_status()
    token = login.json().get("token")
    if not token:
        raise RuntimeError("Login did not return a token")
    headers = {"Authorization": f"Bearer {token}"}

    qwen_workflows = {"qwen", "qwen_lora", "qwenN", "qwenN_lora", "kontext"}
    if args.workflow in qwen_workflows:
        upload_count = args.reference_count
    elif args.workflow == "morph":
        upload_count = 2
    else:
        upload_count = 1
    upload_workflow = (
        "video_upscale"
        if args.workflow in {"video_upscale", "interpolate"}
        else args.workflow
    )
    uploaded_inputs = [
        _upload_input(
            session,
            base_url,
            headers,
            upload_workflow,
            reference_index=index,
        )
        for index in range(1, upload_count + 1)
    ]
    uploaded = uploaded_inputs[0]
    uploaded_reference = (
        uploaded.get("file_id")
        if upload_workflow == "video_upscale"
        else uploaded.get("filename")
    ) or uploaded["filename"]

    submit = _submit_workflow(
        session,
        base_url,
        headers,
        uploaded_reference,
        args.workflow,
        agent_id,
        reference_filenames=[item["filename"] for item in uploaded_inputs],
        video_filename=uploaded_reference if upload_workflow == "video_upscale" else "",
        output_width=args.output_width,
        output_height=args.output_height,
        duration=args.duration,
        video_model=args.video_model,
    )
    if not submit.ok:
        raise RuntimeError(
            f"Task submission failed ({submit.status_code}): {submit.text[:1000]}"
        )
    task_id = submit.json().get("task_id")
    if not task_id:
        raise RuntimeError(f"Task submission did not return task_id: {submit.text[:500]}")
    print(
        json.dumps(
            {
                "event": "submitted",
                "task_id": task_id,
                "workflow": args.workflow,
                "agent_id": agent_id,
                "agent_name": args.agent_name,
                "reference_count": upload_count,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    deadline = time.time() + args.timeout
    consecutive_poll_errors = 0
    while time.time() < deadline:
        try:
            status_response = session.get(
                f"{base_url}/api/task/{task_id}",
                headers=headers,
                timeout=30,
            )
        except requests.RequestException:
            consecutive_poll_errors += 1
            if consecutive_poll_errors >= 5:
                raise
            time.sleep(min(2 * consecutive_poll_errors, 8))
            continue
        status_response.raise_for_status()
        consecutive_poll_errors = 0
        status = status_response.json()
        if status.get("status") == "completed":
            result = status.get("result") or {}
            result_key = (
                "videos"
                if args.workflow in {"video_upscale", "interpolate", "i2v", "morph"}
                else "images"
            )
            outputs = result.get(result_key) or []
            if not outputs:
                raise RuntimeError(f"GPU task completed without {result_key}: {status}")
            if args.workflow == "matting_split" and len(outputs) < 2:
                raise RuntimeError(f"GPU matting split returned fewer than two images: {status}")
            if result_key == "images" and len(outputs) < args.expect_min_images:
                raise RuntimeError(
                    f"GPU task returned {len(outputs)} images; expected at least "
                    f"{args.expect_min_images}: {status}"
                )
            dimensions: list[list[int]] = []
            if result_key == "images":
                for output in outputs:
                    url = output.get("url") if isinstance(output, dict) else output
                    if not isinstance(url, str) or not url:
                        continue
                    response = session.get(
                        url if url.startswith("http") else f"{base_url}{url}",
                        headers=headers,
                        timeout=120,
                    )
                    response.raise_for_status()
                    with Image.open(io.BytesIO(response.content)) as image:
                        dimensions.append([image.width, image.height])
                if args.expect_min_width and (
                    not dimensions or min(width for width, _ in dimensions) < args.expect_min_width
                ):
                    raise RuntimeError(
                        f"GPU task dimensions {dimensions} do not meet minimum width "
                        f"{args.expect_min_width}"
                    )
            print(
                json.dumps(
                    {
                        "event": "completed",
                        "success": True,
                        "task_id": task_id,
                        "workflow": args.workflow,
                        "agent_id": agent_id,
                        "agent_name": args.agent_name,
                        "input_file_ids": [
                            item.get("file_id") for item in uploaded_inputs
                        ],
                        "result_type": result_key,
                        "result_count": len(outputs),
                        "dimensions": dimensions,
                        "duration": result.get("duration"),
                        "node_id": status.get("node_id"),
                    },
                    ensure_ascii=False,
                )
            )
            return 0
        if status.get("status") == "failed":
            raise RuntimeError(f"GPU task failed: {status.get('error') or status}")
        time.sleep(2)

    raise TimeoutError(f"GPU {args.workflow} task timed out: {task_id}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"GPU end-to-end smoke failed: {exc}", file=sys.stderr)
        raise
