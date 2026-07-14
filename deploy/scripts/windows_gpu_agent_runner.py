"""Run the MECHA ComfyUI Agent without exposing its token in process arguments."""
from __future__ import annotations

import os
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict


ROOT = Path(os.environ.get("MECHA_GPU_ROOT", r"E:\MECHA-GPU"))
AGENT_DIR = ROOT / "agent"
TOKEN_FILE = ROOT / "config" / "agent-token.txt"

GPU2_QWEN_MODEL_FILES = {
    "diffusion": "qwen_image_edit_2509_fp8_e4m3fn.safetensors",
    "text_encoder": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    "vae": "qwen_image_vae.safetensors",
    "lora": "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors",
}
GPU2_BACKGROUND_REMOVAL_MODEL = "birefnet.safetensors"

GPU2_QWEN_COMPAT_PREFIXES = (
    "qwen_",
    "qwen_lora_",
    "qwenn_",
    "qwenn_lora_",
)
GPU2_QWEN_COMPAT_TASKS = {
    "kontext",
    "i2i_fj",
    "i2i_human",
    "i2i_around",
    "remove_watermark",
    "three_view",
    "image_fusion",
    "image_transfer",
    "pose_imitation",
    "panorama_360",
    "panorama_fusion_1",
    "panorama_fusion_2",
    "panorama_fusion_3",
    "auto_storyboard",
}
GPU2_LONG_TASK_TIMEOUT_SECONDS = 6 * 60 * 60

sys.path.insert(0, str(AGENT_DIR))


def build_gpu2_upscale_workflow(task: Dict[str, Any]) -> Dict[str, Any]:
    """Build a low-VRAM SeedVR2 image workflow for the 12 GB GPU2 node."""
    params = task.get("params") or {}
    files = task.get("files") or []
    image_name = str(params.get("image_path") or params.get("uploaded_image") or "").strip()
    if not image_name:
        first_file = next((item for item in files if isinstance(item, dict)), {})
        image_name = str(first_file.get("filename") or "").strip()
    if not image_name:
        raise RuntimeError("GPU2 upscale task is missing an input image filename")

    seed = int(params.get("seed_0") or params.get("seed") or 42)
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {
            "class_type": "SeedVR2LoadDiTModel",
            "inputs": {
                "model": "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
                "device": "cuda:0",
                "blocks_to_swap": 0,
                "swap_io_components": False,
                "offload_device": "cpu",
                "cache_model": True,
                "attention_mode": "sdpa",
            },
        },
        "3": {
            "class_type": "SeedVR2LoadVAEModel",
            "inputs": {
                "model": "ema_vae_fp16.safetensors",
                "device": "cuda:0",
                "encode_tiled": True,
                "encode_tile_size": 512,
                "encode_tile_overlap": 64,
                "decode_tiled": True,
                "decode_tile_size": 512,
                "decode_tile_overlap": 64,
                "tile_debug": "false",
                "offload_device": "cpu",
                "cache_model": True,
            },
        },
        "4": {
            "class_type": "SeedVR2VideoUpscaler",
            "inputs": {
                "image": ["1", 0],
                "dit": ["2", 0],
                "vae": ["3", 0],
                "seed": seed,
                "resolution": 1080,
                "max_resolution": 1920,
                "batch_size": 1,
                "uniform_batch_size": False,
                "color_correction": "lab",
                "temporal_overlap": 0,
                "prepend_frames": 0,
                "input_noise_scale": 0.0,
                "latent_noise_scale": 0.0,
                "offload_device": "cpu",
                "enable_debug": False,
            },
        },
        "5": {
            "class_type": "SaveImage",
            "inputs": {"images": ["4", 0], "filename_prefix": "MECHA_GPU2_upscale"},
        },
    }


def _gpu2_input_video_name(task: Dict[str, Any]) -> str:
    params = _gpu2_task_params(task)
    video_name = str(params.get("video_filename") or params.get("uploaded_video") or "").strip()
    if video_name:
        return video_name
    for item in task.get("files") or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("param") or "") not in {"", "video_filename"}:
            continue
        video_name = str(item.get("filename") or "").strip()
        if video_name:
            return video_name
    raise RuntimeError("GPU2 video upscale task is missing an input video filename")


def normalize_gpu2_video_resolution(value: Any) -> int:
    """Normalize frontend resolution labels before applying the GPU2 safety cap."""
    normalized = str(value or "720P").strip().upper()
    aliases = {
        "HD": 720,
        "FHD": 1080,
        "2K": 1440,
        "4K": 2160,
    }
    if normalized in aliases:
        resolution = aliases[normalized]
    else:
        if normalized.endswith("P"):
            normalized = normalized[:-1]
        try:
            resolution = int(float(normalized))
        except (TypeError, ValueError):
            resolution = 720
    return max(360, min(1080, resolution))


def build_gpu2_video_upscale_workflow(task: Dict[str, Any]) -> Dict[str, Any]:
    """Build a serial, CPU-offloaded SeedVR2 graph for video enhancement."""
    params = _gpu2_task_params(task)
    video_name = _gpu2_input_video_name(task)
    seed = int(params.get("seed") or params.get("seed_0") or 42)
    target_resolution = normalize_gpu2_video_resolution(params.get("resolution"))
    return {
        "1": {
            "class_type": "VHS_LoadVideo",
            "inputs": {
                "video": video_name,
                "force_rate": 0,
                "custom_width": 0,
                "custom_height": 0,
                "frame_load_cap": 0,
                "skip_first_frames": 0,
                "select_every_nth": 1,
                "format": "AnimateDiff",
            },
        },
        "2": {
            "class_type": "SeedVR2LoadDiTModel",
            "inputs": {
                "model": "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
                "device": "cuda:0",
                "blocks_to_swap": 0,
                "swap_io_components": False,
                "offload_device": "cpu",
                "cache_model": True,
                "attention_mode": "sdpa",
            },
        },
        "3": {
            "class_type": "SeedVR2LoadVAEModel",
            "inputs": {
                "model": "ema_vae_fp16.safetensors",
                "device": "cuda:0",
                "encode_tiled": True,
                "encode_tile_size": 384,
                "encode_tile_overlap": 64,
                "decode_tiled": True,
                "decode_tile_size": 384,
                "decode_tile_overlap": 64,
                "tile_debug": "false",
                "offload_device": "cpu",
                "cache_model": True,
            },
        },
        "4": {
            "class_type": "SeedVR2VideoUpscaler",
            "inputs": {
                "image": ["1", 0],
                "dit": ["2", 0],
                "vae": ["3", 0],
                "seed": seed,
                "resolution": target_resolution,
                "max_resolution": 1920,
                "batch_size": 1,
                "uniform_batch_size": False,
                "color_correction": "lab",
                "temporal_overlap": 0,
                "prepend_frames": 0,
                "input_noise_scale": 0.0,
                "latent_noise_scale": 0.0,
                "offload_device": "cpu",
                "enable_debug": False,
            },
        },
        "5": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["4", 0],
                "frame_rate": 25,
                "loop_count": 0,
                "filename_prefix": "MECHA_GPU2_video_upscale",
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": 21,
                "save_metadata": True,
                "trim_to_audio": True,
                "pingpong": False,
                "save_output": True,
                "audio": ["1", 2],
            },
        },
    }


def _gpu2_task_params(task: Dict[str, Any]) -> Dict[str, Any]:
    for key in ("params", "data"):
        value = task.get(key)
        if isinstance(value, dict):
            return value
    return {}


def _gpu2_input_image_names(task: Dict[str, Any]) -> list[str]:
    params = _gpu2_task_params(task)
    names: list[str] = []
    param_names = [
        "image_path",
        "uploaded_image",
        *[f"image_path_{index}" for index in range(1, 7)],
        *[f"uploaded_image_{index}" for index in range(1, 7)],
        *[f"image_{suffix}" for suffix in ("BK", "HU", "MB")],
        *[f"uploaded_image_{suffix}" for suffix in ("BK", "HU", "MB")],
        *[f"image_{index}" for index in range(1, 7)],
    ]
    for key in param_names:
        value = str(params.get(key) or "").strip()
        if value and value not in names:
            names.append(value)
    for item in task.get("files") or []:
        if not isinstance(item, dict):
            continue
        value = str(item.get("filename") or "").strip()
        if value and value not in names:
            names.append(value)
    return names


def _gpu2_prompt(task: Dict[str, Any], task_type: str) -> str:
    params = _gpu2_task_params(task)
    prompt = str(params.get("prompt") or params.get("positive_prompt") or "").strip()
    if prompt:
        return prompt
    defaults = {
        "i2i_fj": "Change the camera angle as requested while preserving the subject identity, clothes, and visual style.",
        "i2i_human": "Create a clean multi-angle character reference sheet while preserving identity, clothes, and visual style.",
        "i2i_around": "Create a consistent alternate viewing angle while preserving the scene, subject, and visual style.",
        "remove_watermark": "Remove all visible watermarks and repair the covered area naturally. Preserve all other content.",
        "three_view": "Create a single orthographic three-view reference sheet with front, side, and back views. Preserve identity and design.",
        "kontext": "Create a faithful edited image based on the reference image while preserving identity and visual style.",
        "image_fusion": "Blend all reference images into one coherent composition while preserving identity and scene style.",
        "image_transfer": "Transfer the subject and composition according to the references while preserving identity and style.",
        "pose_imitation": "Match the pose from the first reference while preserving the subject identity from the other reference.",
        "panorama_360": "Create a seamless 2:1 equirectangular 360-degree panorama from the reference scene.",
        "panorama_fusion_1": "Create one seamless 2:1 equirectangular panorama by combining all references.",
        "panorama_fusion_2": "Create one seamless 2:1 equirectangular panorama by combining all references.",
        "panorama_fusion_3": "Create one seamless 2:1 equirectangular panorama by combining all references.",
        "auto_storyboard": "Create a six-shot cinematic storyboard contact sheet in a 3 by 2 grid.",
    }
    return defaults.get(task_type, "Create a high quality image faithful to the reference images.")


def normalize_gpu2_image_dimensions(width: Any, height: Any) -> tuple[int, int]:
    """Clamp requested image geometry to a low-VRAM, Qwen-compatible range."""
    try:
        normalized_width = int(float(width or 768))
    except (TypeError, ValueError):
        normalized_width = 768
    try:
        normalized_height = int(float(height or 768))
    except (TypeError, ValueError):
        normalized_height = 768
    normalized_width = max(256, min(1024, normalized_width))
    normalized_height = max(256, min(1024, normalized_height))
    return (
        max(256, (normalized_width // 8) * 8),
        max(256, (normalized_height // 8) * 8),
    )


def build_gpu2_matting_workflow(task: Dict[str, Any], *, split: bool) -> Dict[str, Any]:
    """Build a local, MIT-licensed BiRefNet background-removal workflow."""
    image_names = _gpu2_input_image_names(task)
    if not image_names:
        raise RuntimeError("GPU2 matting task is missing an input image filename")
    workflow: Dict[str, Any] = {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_names[0]}},
        "2": {
            "class_type": "LoadBackgroundRemovalModel",
            "inputs": {"bg_removal_name": GPU2_BACKGROUND_REMOVAL_MODEL},
        },
        "3": {
            "class_type": "RemoveBackground",
            "inputs": {"bg_removal_model": ["2", 0], "image": ["1", 0]},
        },
        "4": {
            "class_type": "JoinImageWithAlpha",
            "inputs": {"image": ["1", 0], "alpha": ["3", 0]},
        },
        "5": {
            "class_type": "SaveImage",
            "inputs": {"images": ["4", 0], "filename_prefix": "MECHA_GPU2_matting_subject"},
        },
    }
    if split:
        workflow.update(
            {
                "6": {"class_type": "InvertMask", "inputs": {"mask": ["3", 0]}},
                "7": {
                    "class_type": "JoinImageWithAlpha",
                    "inputs": {"image": ["1", 0], "alpha": ["6", 0]},
                },
                "8": {
                    "class_type": "SaveImage",
                    "inputs": {"images": ["7", 0], "filename_prefix": "MECHA_GPU2_matting_background"},
                },
            }
        )
    return workflow


def is_gpu2_qwen_compatible_task(task_type: str) -> bool:
    normalized = task_type.strip().lower()
    return normalized in GPU2_QWEN_COMPAT_TASKS or normalized.startswith(GPU2_QWEN_COMPAT_PREFIXES)


def build_gpu2_qwen_workflow(task: Dict[str, Any]) -> Dict[str, Any]:
    """Build one executable low-VRAM Qwen Image Edit graph for GPU2.

    Several legacy workflows are empty, placeholders, or depend on models that
    do not fit the RTX 3060. GPU2 deliberately uses the same FP8 Qwen stack for
    those frontend modes so every selectable local image action can complete.
    """
    task_type = str(task.get("task_type") or "qwen_1").strip().lower()
    image_names = _gpu2_input_image_names(task)[:3]
    if not image_names:
        raise RuntimeError(f"GPU2 {task_type} task is missing an input image filename")

    params = _gpu2_task_params(task)
    seed = int(params.get("seed") or params.get("seed_0") or 42)
    prompt = _gpu2_prompt(task, task_type)
    output_width, output_height = normalize_gpu2_image_dimensions(
        params.get("output_width"),
        params.get("output_height"),
    )
    negative = (
        "different identity, different clothes, changed visual style, distorted anatomy, "
        "bad perspective, duplicate subject, text, logo, watermark"
    )
    workflow: Dict[str, Any] = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": 4,
                "cfg": 1.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["75", 0],
                "positive": ["111", 0],
                "negative": ["110", 0],
                "latent_image": ["121", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["39", 0]}},
        "37": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": GPU2_QWEN_MODEL_FILES["diffusion"], "weight_dtype": "default"},
        },
        "38": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": GPU2_QWEN_MODEL_FILES["text_encoder"],
                "type": "qwen_image",
                "device": "default",
            },
        },
        "39": {"class_type": "VAELoader", "inputs": {"vae_name": GPU2_QWEN_MODEL_FILES["vae"]}},
        "60": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": f"MECHA_GPU2_{task_type}", "images": ["8", 0]},
        },
        "66": {"class_type": "ModelSamplingAuraFlow", "inputs": {"shift": 3, "model": ["89", 0]}},
        "75": {"class_type": "CFGNorm", "inputs": {"strength": 1, "model": ["66", 0]}},
        "89": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "lora_name": GPU2_QWEN_MODEL_FILES["lora"],
                "strength_model": 1,
                "model": ["37", 0],
            },
        },
        "121": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": output_width, "height": output_height, "batch_size": 1},
        },
    }

    image_links: Dict[str, list[Any]] = {}
    for index, image_name in enumerate(image_names, 1):
        load_id = str(77 + index)
        scale_id = str(125 + index)
        workflow[load_id] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
        workflow[scale_id] = {
            "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
            "inputs": {
                "aspect_ratio": "original",
                "proportional_width": 1,
                "proportional_height": 1,
                "fit": "letterbox",
                "method": "lanczos",
                "round_to_multiple": "8",
                "scale_to_side": "longest",
                "scale_to_length": max(output_width, output_height),
                "background_color": "#000000",
                "image": [load_id, 0],
            },
        }
        image_links[f"image{index}"] = [scale_id, 0]

    encoder_base: Dict[str, Any] = {
        "speak_and_recognation": True,
        "clip": ["38", 0],
        "vae": ["39", 0],
        **image_links,
    }
    workflow["110"] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "inputs": {"prompt": negative, **encoder_base},
    }
    workflow["111"] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "inputs": {"prompt": prompt, **encoder_base},
    }
    return workflow


def tune_gpu2_qwen_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """Use the official FP8 Qwen 2509 stack and one output on 12 GB VRAM."""
    tuned = deepcopy(workflow)
    is_qwen_workflow = False

    for node in tuned.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        class_type = str(node.get("class_type") or "")

        if class_type == "UNETLoader" and "qwen" in str(inputs.get("unet_name") or "").lower():
            inputs["unet_name"] = GPU2_QWEN_MODEL_FILES["diffusion"]
            is_qwen_workflow = True
        elif class_type == "CLIPLoader" and (
            str(inputs.get("type") or "").lower() == "qwen_image"
            or "qwen" in str(inputs.get("clip_name") or "").lower()
        ):
            inputs["clip_name"] = GPU2_QWEN_MODEL_FILES["text_encoder"]
            is_qwen_workflow = True
        elif class_type == "VAELoader" and "qwen" in str(inputs.get("vae_name") or "").lower():
            inputs["vae_name"] = GPU2_QWEN_MODEL_FILES["vae"]
            is_qwen_workflow = True
        elif class_type == "LoraLoaderModelOnly" and "qwen" in str(inputs.get("lora_name") or "").lower():
            inputs["lora_name"] = GPU2_QWEN_MODEL_FILES["lora"]
            is_qwen_workflow = True

    if is_qwen_workflow:
        for node in tuned.values():
            if not isinstance(node, dict) or node.get("class_type") != "EmptyLatentImage":
                continue
            inputs = node.get("inputs")
            if isinstance(inputs, dict):
                inputs["batch_size"] = 1
    return tuned


def prepare_gpu2_task(task: Dict[str, Any]) -> Dict[str, Any]:
    prepared = deepcopy(task)
    task_type = str(prepared.get("task_type") or "").lower()
    operation = str(_gpu2_task_params(prepared).get("gpu2_operation") or "").lower()
    if operation in {"matting_subject", "matting_split"}:
        prepared["workflow_json"] = build_gpu2_matting_workflow(
            prepared,
            split=operation == "matting_split",
        )
        prepared["workflow_name"] = f"gpu2_{operation}_birefnet"
    elif task_type == "upscale_hd":
        prepared["workflow_json"] = build_gpu2_upscale_workflow(prepared)
        prepared["workflow_name"] = "gpu2_upscale_hd"
    elif task_type == "upscale":
        prepared["workflow_json"] = build_gpu2_video_upscale_workflow(prepared)
        prepared["workflow_name"] = "gpu2_video_upscale_seedvr2"
    elif task_type in {"matting_subject", "matting_split"}:
        prepared["workflow_json"] = build_gpu2_matting_workflow(
            prepared,
            split=task_type == "matting_split",
        )
        prepared["workflow_name"] = f"gpu2_{task_type}_birefnet"
    elif is_gpu2_qwen_compatible_task(task_type):
        prepared["workflow_json"] = build_gpu2_qwen_workflow(prepared)
        prepared["workflow_name"] = f"gpu2_{task_type}_qwen_fp8"
    elif isinstance(prepared.get("workflow_json"), dict):
        prepared["workflow_json"] = tune_gpu2_qwen_workflow(prepared["workflow_json"])
    return prepared


def main() -> None:
    from comfyui_agent import ComfyUIAgent

    class Gpu2ComfyUIAgent(ComfyUIAgent):
        def execute_comfyui_task(self, task):
            return super().execute_comfyui_task(prepare_gpu2_task(task))

        def _wait_for_completion(self, port, prompt_id, timeout=GPU2_LONG_TASK_TIMEOUT_SECONDS):
            return super()._wait_for_completion(
                port,
                prompt_id,
                timeout=GPU2_LONG_TASK_TIMEOUT_SECONDS,
            )

    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError(f"Agent token is empty: {TOKEN_FILE}")

    server_url = os.environ.get("MECHA_SERVER_URL", "https://mecha.one")
    ports = [
        int(value.strip())
        for value in os.environ.get("MECHA_COMFYUI_PORTS", "8188").split(",")
        if value.strip()
    ]
    Gpu2ComfyUIAgent(server_url, token, ports).run()


if __name__ == "__main__":
    main()
