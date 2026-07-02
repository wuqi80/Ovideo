#!/usr/bin/env python3
"""Diagnose the external GPU Agent and ComfyUI workflow compatibility.

Run on the backend server:

    .venv/bin/python scripts/diagnose_gpu_agent_workflows.py --qwen

The checks are intentionally end-to-end through Redis and the registered GPU
Agent. They do not require SSH access to the GPU machine.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


async def redis_client():
    import redis.asyncio as redis
    from cluster_config import RedisConfig

    client = redis.Redis(
        host=RedisConfig.HOST,
        port=RedisConfig.PORT,
        db=RedisConfig.DB,
        password=RedisConfig.PASSWORD,
        decode_responses=True,
    )
    await client.ping()
    return client


async def wait_task(r: Any, task_id: str, seconds: int = 180) -> dict[str, Any]:
    from cluster_config import RedisConfig

    key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
    last = None
    for _ in range(max(1, seconds // 3)):
        h = await r.hgetall(key)
        status = h.get("status")
        if status and status != last:
            print(f"{task_id}: status={status}")
            last = status
        if status in {"completed", "failed", "cancelled", "timeout"}:
            return h
        await asyncio.sleep(3)
    h = await r.hgetall(key)
    h.setdefault("status", "still_processing")
    return h


def create_probe_image(username: str, prefix: str) -> tuple[str, str]:
    ym = datetime.now().strftime("%Y%m")
    filename = f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    image_dir = ROOT / "persistent_storage" / "image" / username / ym
    image_dir.mkdir(parents=True, exist_ok=True)
    (image_dir / filename).write_bytes(PNG_1X1)
    return filename, f"/storage/image/{username}/{ym}/{filename}"


def with_base_output(workflow: dict[str, Any], filename: str, prefix: str) -> dict[str, Any]:
    """Attach a tiny guaranteed output branch so ComfyUI validates side probes.

    ComfyUI rejects prompts that do not have an executable output path. The
    extra branch lets us test whether unrelated Qwen nodes are accepted by the
    prompt validator without confusing "no output node" with "bad Qwen node".
    """

    merged = dict(workflow)
    merged["9001"] = {"inputs": {"image": filename}, "class_type": "LoadImage"}
    merged["9002"] = {
        "inputs": {"filename_prefix": prefix, "images": ["9001", 0]},
        "class_type": "SaveImage",
    }
    return merged


async def probe_object_info(r: Any) -> dict[str, Any]:
    from cluster_config import RedisConfig

    task_id = "codex_object_info_" + uuid.uuid4().hex[:12]
    data = {
        "endpoint": "http://127.0.0.1:8188/object_info",
        "method": "GET",
        "headers": {},
        "body": {},
    }
    await seed_task_hash(r, task_id=task_id, task_type="api_call", data=data)
    member = json.dumps(
        {
            "task_id": task_id,
            "task_type": "api_call",
            "data": data,
            "params": data,
            "user_id": "admin",
        },
        ensure_ascii=False,
    )
    await r.zadd(RedisConfig.TASK_QUEUE_KEY, {member: 10})
    result = await wait_task(r, task_id, seconds=120)
    print("object_info:", summarize_task(result))
    if not result.get("result"):
        print("object_info: no result_json returned; GPU Agent is likely still the old script")
    return result


async def enqueue_custom_workflow(
    r: Any,
    *,
    task_type: str,
    workflow_name: str,
    workflow_json: dict[str, Any],
    filename: str,
    file_url: str,
    username: str = "admin",
) -> str:
    task_id = f"{task_type}_{uuid.uuid4().hex[:12]}"
    data = {
        "workflow_name": workflow_name,
        "workflow_json": workflow_json,
        "agent_files": [{"param": "image_path", "filename": filename, "url": file_url}],
    }
    await enqueue_plain_agent_task(
        r,
        task_id=task_id,
        task_type=task_type,
        data=data,
        user_id=username,
    )
    return task_id


async def seed_task_hash(
    r: Any,
    *,
    task_id: str,
    task_type: str,
    data: dict[str, Any],
    user_id: str = "admin",
    priority: int = 2,
) -> None:
    from cluster_config import RedisConfig

    await r.hset(
        f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}",
        mapping={
            "task_id": task_id,
            "task_type": task_type,
            "data": json.dumps(data, ensure_ascii=False),
            "params": json.dumps(data, ensure_ascii=False),
            "priority": priority,
            "user_id": user_id,
            "status": "queued",
            "created_at": datetime.now().isoformat(),
            "progress": 0,
        },
    )


async def enqueue_plain_agent_task(
    r: Any,
    *,
    task_id: str,
    task_type: str,
    data: dict[str, Any],
    user_id: str = "admin",
    priority: int = 2,
) -> None:
    from cluster_config import RedisConfig

    await seed_task_hash(
        r,
        task_id=task_id,
        task_type=task_type,
        data=data,
        user_id=user_id,
        priority=priority,
    )
    score = priority * 1_000_000 + int(datetime.now().timestamp())
    await r.zadd(RedisConfig.TASK_QUEUE_KEY, {task_id: score})


async def probe_layer_utility(r: Any) -> dict[str, Any]:
    filename, file_url = create_probe_image("admin", "codex_layer_probe")
    workflow = {
        "1": {"inputs": {"image": filename}, "class_type": "LoadImage"},
        "2": {
            "inputs": {
                "aspect_ratio": "original",
                "proportional_width": 1,
                "proportional_height": 1,
                "fit": "letterbox",
                "method": "lanczos",
                "round_to_multiple": "8",
                "scale_to_side": "longest",
                "scale_to_length": 512,
                "background_color": "#000000",
                "image": ["1", 0],
            },
            "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
        },
        "3": {
            "inputs": {"filename_prefix": "CodexLayerProbe", "images": ["2", 0]},
            "class_type": "SaveImage",
        },
    }
    task_id = await enqueue_custom_workflow(
        r,
        task_type="codex_layer_probe",
        workflow_name="codex_layer_probe",
        workflow_json=workflow,
        filename=filename,
        file_url=file_url,
    )
    result = await wait_task(r, task_id, seconds=120)
    print("layer_probe:", summarize_task(result))
    return result


async def probe_task_service_workflow(r: Any, task_type: str) -> dict[str, Any]:
    from PIL import Image, ImageDraw
    from workflow_handler import get_workflow_handler

    username = "admin"
    ym = datetime.now().strftime("%Y%m")
    filename = f"codex_{task_type}_probe_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    image_dir = ROOT / "persistent_storage" / "image" / username / ym
    image_dir.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (384, 384), (245, 248, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((88, 90, 296, 300), fill=(42, 130, 218), outline=(10, 55, 110), width=8)
    draw.ellipse((140, 145, 170, 175), fill=(255, 255, 255))
    draw.ellipse((214, 145, 244, 175), fill=(255, 255, 255))
    draw.arc((138, 165, 246, 245), 15, 165, fill=(255, 255, 255), width=8)
    image.save(image_dir / filename)

    if task_type == "qwen_1":
        data = {
            "image_path_1": filename,
            "uploaded_image_1": filename,
            "prompt": "keep the same blue cartoon character, front view",
            "seed": 123456,
        }
        file_param = "image_path_1"
    else:
        data = {
            "image_path": filename,
            "uploaded_image": filename,
            "prompt": "front-right quarter view, keep the same blue cartoon character",
            "seed": 123456,
        }
        file_param = "image_path"
    workflow_json = get_workflow_handler().build_workflow_for_task(task_type, dict(data))
    data.update(
        {
            "workflow_name": {
                "i2i_fj": "I2I_FJ",
            }.get(task_type, task_type),
            "workflow_json": workflow_json,
            "agent_files": [
                {
                    "param": file_param,
                    "filename": filename,
                    "url": f"/storage/image/{username}/{ym}/{filename}",
                }
            ],
        }
    )
    task_id = f"codex_{task_type}_{uuid.uuid4().hex[:12]}"
    await enqueue_plain_agent_task(r, task_id=task_id, task_type=task_type, data=data, user_id=username)
    result = await wait_task(r, task_id, seconds=240)
    print(f"{task_type}:", summarize_task(result))
    return result


async def enqueue_probe_workflow(
    r: Any,
    name: str,
    workflow: dict[str, Any],
    *,
    with_image: bool = False,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "workflow_name": name,
        "workflow_json": workflow,
    }
    if with_image:
        filename, file_url = create_probe_image("admin", name)
        data["agent_files"] = [{"param": "image_path", "filename": filename, "url": file_url}]
    task_id = f"{name}_{uuid.uuid4().hex[:12]}"
    await enqueue_plain_agent_task(r, task_id=task_id, task_type=name, data=data)
    result = await wait_task(r, task_id, seconds=120)
    print(f"{name}:", summarize_task(result))
    return result


async def probe_qwen_nodes(r: Any) -> list[tuple[str, dict[str, Any]]]:
    filename, file_url = create_probe_image("admin", "codex_qwen_node_image")
    common_image_file = [{"param": "image_path", "filename": filename, "url": file_url}]

    probes: list[tuple[str, dict[str, Any], list[dict[str, str]]]] = [
        (
            "probe_load_image_only",
            {"1": {"inputs": {"image": filename}, "class_type": "LoadImage"}},
            common_image_file,
        ),
        (
            "probe_unet_qwen",
            {
                "37": {
                    "inputs": {
                        "unet_name": "Qwen_Image_Edit_2509_bf16.safetensors",
                        "weight_dtype": "default",
                    },
                    "class_type": "UNETLoader",
                }
            },
            [],
        ),
        (
            "probe_clip_qwen",
            {
                "38": {
                    "inputs": {
                        "clip_name": "qwen_2.5_vl_7b.safetensors",
                        "type": "qwen_image",
                        "device": "default",
                    },
                    "class_type": "CLIPLoader",
                }
            },
            [],
        ),
        (
            "probe_vae_qwen",
            {
                "39": {
                    "inputs": {"vae_name": "qwen_image_vae.safetensors"},
                    "class_type": "VAELoader",
                }
            },
            [],
        ),
        (
            "probe_lora_lightning",
            {
                "37": {
                    "inputs": {
                        "unet_name": "Qwen_Image_Edit_2509_bf16.safetensors",
                        "weight_dtype": "default",
                    },
                    "class_type": "UNETLoader",
                },
                "89": {
                    "inputs": {
                        "lora_name": "Qwen-Image-Lightning-4steps-V2.0.safetensors",
                        "strength_model": 1,
                        "model": ["37", 0],
                    },
                    "class_type": "LoraLoaderModelOnly",
                },
            },
            [],
        ),
        (
            "probe_qwen_textencode",
            {
                "1": {"inputs": {"image": filename}, "class_type": "LoadImage"},
                "38": {
                    "inputs": {
                        "clip_name": "qwen_2.5_vl_7b.safetensors",
                        "type": "qwen_image",
                        "device": "default",
                    },
                    "class_type": "CLIPLoader",
                },
                "39": {
                    "inputs": {"vae_name": "qwen_image_vae.safetensors"},
                    "class_type": "VAELoader",
                },
                "126": {
                    "inputs": {
                        "aspect_ratio": "original",
                        "proportional_width": 1,
                        "proportional_height": 1,
                        "fit": "letterbox",
                        "method": "lanczos",
                        "round_to_multiple": "8",
                        "scale_to_side": "longest",
                        "scale_to_length": 512,
                        "background_color": "#000000",
                        "image": ["1", 0],
                    },
                    "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
                },
                "111": {
                    "inputs": {
                        "prompt": "blue cartoon character",
                        "speak_and_recognation": True,
                        "clip": ["38", 0],
                        "vae": ["39", 0],
                        "image1": ["126", 0],
                    },
                    "class_type": "TextEncodeQwenImageEditPlus",
                },
            },
            common_image_file,
        ),
    ]

    results: list[tuple[str, dict[str, Any]]] = []
    for name, workflow, files in probes:
        data: dict[str, Any] = {
            "workflow_name": name,
            "workflow_json": with_base_output(workflow, filename, name),
        }
        if files:
            data["agent_files"] = files
        else:
            data["agent_files"] = common_image_file
        task_id = f"{name}_{uuid.uuid4().hex[:12]}"
        await enqueue_plain_agent_task(r, task_id=task_id, task_type=name, data=data)
        result = await wait_task(r, task_id, seconds=120)
        print(f"{name}:", summarize_task(result))
        results.append((name, result))
    return results


def build_qwen_branch_probe(
    filename: str,
    *,
    include_base_output: bool = False,
    use_vae_latent: bool = False,
    use_flux_conditioning: bool = False,
) -> dict[str, Any]:
    """Build a focused Qwen Image Edit probe.

    `include_base_output=True` intentionally reproduces the previous "masked"
    situation where a trivial output branch can make a prompt look successful
    even if the Qwen branch itself does not produce files.
    """

    latent_node = ["88", 0] if use_vae_latent else ["121", 0]
    positive = ["84", 0] if use_flux_conditioning else ["111", 0]
    negative = ["85", 0] if use_flux_conditioning else ["110", 0]
    workflow: dict[str, Any] = {
        "1": {"inputs": {"image": filename}, "class_type": "LoadImage"},
        "3": {
            "inputs": {
                "seed": 123456789,
                "steps": 4,
                "cfg": 1.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["75", 0],
                "positive": positive,
                "negative": negative,
                "latent_image": latent_node,
            },
            "class_type": "KSampler",
        },
        "8": {"inputs": {"samples": ["3", 0], "vae": ["39", 0]}, "class_type": "VAEDecode"},
        "37": {
            "inputs": {
                "unet_name": "Qwen_Image_Edit_2509_bf16.safetensors",
                "weight_dtype": "default",
            },
            "class_type": "UNETLoader",
        },
        "38": {
            "inputs": {
                "clip_name": "qwen_2.5_vl_7b.safetensors",
                "type": "qwen_image",
                "device": "default",
            },
            "class_type": "CLIPLoader",
        },
        "39": {"inputs": {"vae_name": "qwen_image_vae.safetensors"}, "class_type": "VAELoader"},
        "60": {
            "inputs": {"filename_prefix": "CodexQwenBranch", "images": ["8", 0]},
            "class_type": "SaveImage",
        },
        "66": {"inputs": {"shift": 3, "model": ["89", 0]}, "class_type": "ModelSamplingAuraFlow"},
        "75": {"inputs": {"strength": 1, "model": ["66", 0]}, "class_type": "CFGNorm"},
        "89": {
            "inputs": {
                "lora_name": "Qwen-Image-Lightning-4steps-V2.0.safetensors",
                "strength_model": 1,
                "model": ["37", 0],
            },
            "class_type": "LoraLoaderModelOnly",
        },
        "110": {
            "inputs": {
                "prompt": "",
                "speak_and_recognation": True,
                "clip": ["38", 0],
                "vae": ["39", 0],
                "image1": ["126", 0],
            },
            "class_type": "TextEncodeQwenImageEditPlus",
        },
        "111": {
            "inputs": {
                "prompt": "turn camera left 30 degrees, keep character consistent",
                "speak_and_recognation": True,
                "clip": ["38", 0],
                "vae": ["39", 0],
                "image1": ["126", 0],
            },
            "class_type": "TextEncodeQwenImageEditPlus",
        },
        "121": {
            "inputs": {"width": 512, "height": 512, "batch_size": 1},
            "class_type": "EmptyLatentImage",
        },
        "126": {
            "inputs": {
                "aspect_ratio": "original",
                "proportional_width": 1,
                "proportional_height": 1,
                "fit": "letterbox",
                "method": "lanczos",
                "round_to_multiple": "8",
                "scale_to_side": "longest",
                "scale_to_length": 512,
                "background_color": "#000000",
                "image": ["1", 0],
            },
            "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
        },
    }
    if use_vae_latent:
        workflow["88"] = {
            "inputs": {"pixels": ["126", 0], "vae": ["39", 0]},
            "class_type": "VAEEncode",
        }
    if use_flux_conditioning:
        workflow["84"] = {
            "inputs": {
                "reference_latents_method": "index_timestep_zero",
                "conditioning": ["111", 0],
            },
            "class_type": "FluxKontextMultiReferenceLatentMethod",
        }
        workflow["85"] = {
            "inputs": {
                "reference_latents_method": "index_timestep_zero",
                "conditioning": ["110", 0],
            },
            "class_type": "FluxKontextMultiReferenceLatentMethod",
        }
    if include_base_output:
        workflow["2"] = {
            "inputs": {"filename_prefix": "CodexBaseMask", "images": ["1", 0]},
            "class_type": "SaveImage",
        }
    return workflow


async def probe_qwen_output_branches(r: Any) -> list[tuple[str, dict[str, Any]]]:
    filename, file_url = create_probe_image("admin", "codex_qwen_branch")
    cases = [
        ("qwen_only_current", {}),
        ("qwen_masked_current", {"include_base_output": True}),
        (
            "qwen_only_vae_flux",
            {"use_vae_latent": True, "use_flux_conditioning": True},
        ),
    ]
    results: list[tuple[str, dict[str, Any]]] = []
    for name, kwargs in cases:
        task_id = f"{name}_{uuid.uuid4().hex[:12]}"
        workflow = build_qwen_branch_probe(filename, **kwargs)
        data = {
            "workflow_name": name,
            "workflow_json": workflow,
            "agent_files": [{"param": "image_path", "filename": filename, "url": file_url}],
        }
        await enqueue_plain_agent_task(r, task_id=task_id, task_type=name, data=data)
        result = await wait_task(r, task_id, seconds=360)
        print(f"{name}:", summarize_task(result))
        results.append((name, result))
    return results


def summarize_task(task_hash: dict[str, Any]) -> str:
    status = task_hash.get("status")
    error = (task_hash.get("error") or "").replace("\n", " ")[:300]
    result_raw = task_hash.get("result")
    if not result_raw:
        return f"status={status} error={error or '-'} result=no"
    try:
        result = json.loads(result_raw)
    except Exception:
        return f"status={status} error={error or '-'} result=unparseable"
    output_files = result.get("output_files") or []
    interesting = result.get("interesting_nodes")
    return (
        f"status={status} error={error or '-'} files={len(output_files)} "
        f"interesting_nodes={json.dumps(interesting, ensure_ascii=False) if interesting else '-'}"
    )


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--qwen", action="store_true", help="also run qwen_1 and i2i_fj probes")
    parser.add_argument("--node-probes", action="store_true", help="run minimal Qwen node compatibility probes")
    parser.add_argument("--qwen-branch-probes", action="store_true", help="run focused Qwen output/masked branch probes")
    args = parser.parse_args()

    r = await redis_client()
    try:
        await probe_object_info(r)
        await probe_layer_utility(r)
        if args.node_probes:
            await probe_qwen_nodes(r)
        if args.qwen_branch_probes:
            await probe_qwen_output_branches(r)
        if args.qwen:
            await probe_task_service_workflow(r, "qwen_1")
            await probe_task_service_workflow(r, "i2i_fj")
    finally:
        await r.aclose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
