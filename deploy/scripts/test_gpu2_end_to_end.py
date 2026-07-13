"""Exercise production upload -> queue -> GPU2 -> result paths with a tiny image."""
from __future__ import annotations

import argparse
import io
import os
import sys
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
}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", choices=sorted(WORKFLOWS), default="upscale_hd")
    parser.add_argument("--timeout", type=int, default=7200)
    return parser.parse_args()


def _submit_workflow(
    session: requests.Session,
    base_url: str,
    headers: dict[str, str],
    filename: str,
    workflow: str,
    agent_id: str,
) -> requests.Response:
    routing = {"preferred_agent_id": agent_id, "preferred_node_id": agent_id}
    if workflow in {"upscale_hd", "remove_watermark", "three_view"}:
        endpoint = "/api/materials/process"
        payload = {"image_filename": filename, "workflow_type": workflow, **routing}
    elif workflow in {"qwen", "qwen_lora", "qwenN", "qwenN_lora", "kontext"}:
        endpoint = "/api/generate/comfyui-workflow"
        payload = {
            "workflow_type": workflow,
            "prompt": "Keep the reference composition and render a clean, high quality result.",
            "image_filenames": [filename],
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


def main() -> int:
    args = _parse_args()
    base_url = os.environ.get("MECHA_BASE_URL", "https://mecha.one").rstrip("/")
    password = os.environ.get("ADMIN_PASSWORD", "").strip()
    agent_id = os.environ.get("MECHA_GPU2_AGENT_ID", "").strip()
    if not password or not agent_id:
        raise RuntimeError("ADMIN_PASSWORD and MECHA_GPU2_AGENT_ID are required")

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

    image = Image.new("RGB", (64, 64), color=(42, 91, 168))
    image_bytes = io.BytesIO()
    image.save(image_bytes, format="PNG")
    upload = session.post(
        f"{base_url}/api/comfyui/upload",
        headers=headers,
        files={"image": ("gpu2-e2e-smoke.png", image_bytes.getvalue(), "image/png")},
        data={"node_type": "image"},
        timeout=60,
    )
    upload.raise_for_status()
    uploaded = upload.json()

    submit = _submit_workflow(
        session,
        base_url,
        headers,
        uploaded["filename"],
        args.workflow,
        agent_id,
    )
    submit.raise_for_status()
    task_id = submit.json().get("task_id")
    if not task_id:
        raise RuntimeError(f"Task submission did not return task_id: {submit.text[:500]}")

    deadline = time.time() + args.timeout
    while time.time() < deadline:
        status_response = session.get(f"{base_url}/api/task/{task_id}", headers=headers, timeout=30)
        status_response.raise_for_status()
        status = status_response.json()
        if status.get("status") == "completed":
            result = status.get("result") or {}
            images = result.get("images") or []
            if not images:
                raise RuntimeError(f"GPU2 task completed without images: {status}")
            print(
                {
                    "success": True,
                    "task_id": task_id,
                    "workflow": args.workflow,
                    "input_file_id": uploaded.get("file_id"),
                    "result_count": len(images),
                    "node_id": status.get("node_id"),
                }
            )
            return 0
        if status.get("status") == "failed":
            raise RuntimeError(f"GPU2 task failed: {status.get('error') or status}")
        time.sleep(2)

    raise TimeoutError(f"GPU2 {args.workflow} task timed out: {task_id}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"GPU2 end-to-end smoke failed: {exc}", file=sys.stderr)
        raise
