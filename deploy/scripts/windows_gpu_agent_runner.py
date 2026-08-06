"""Run the MECHA ComfyUI Agent without exposing its token in process arguments."""
from __future__ import annotations

import math
import os
import random
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
GPU2_IMAGE_UPSCALE_TARGET = 4096
GPU2_IMAGE_UPSCALE_MAX_RESOLUTION = 4096

GPU2_WAN_MODEL_FILES = {
    "diffusion": r"wan2.1\Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors",
    "infinitetalk": r"wan2.1\Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors",
    "text_encoder": "umt5-xxl-enc-fp8_e4m3fn.safetensors",
    "vae": r"wan2.1\Wan2_1_VAE_bf16.safetensors",
    "clip_vision": "clip_vision_h.safetensors",
    "lora": r"wan2.1\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors",
    "wav2vec": "wav2vec2-chinese-base_fp16.safetensors",
}
GPU2_WAN_WIDTH = 640
GPU2_WAN_HEIGHT = 384
GPU2_WAN_FRAMES = 33
GPU2_WAN_FPS = 16
GPU2_WAN_BLOCKS_TO_SWAP = 36
GPU2_WAN_MAX_DURATION_SECONDS = 30.0
GPU2_WAN_MAX_GENERATION_SECONDS = 15.0

GPU2_H3_PORT = 8189
GPU2_H3_MODEL_FILES = {
    "diffusion": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "text_encoder": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "video_vae": "minimax_h3_video_vae_fp16.safetensors",
    "audio_vae": "minimax_h3_audio_vae_fp32.safetensors",
}
# MiniMax H3's sampler reshapes latents on a 32px grid. 768x432 looks like
# 16:9, but 432 / 32 = 13.5 and causes SamplerCustomAdvanced shape mismatches.
# GPU2 currently runs H3 on a 12GB RTX 3060, so keep this preset low-VRAM
# while still aligned to the model's 32px grid.
GPU2_H3_WIDTH = 768
GPU2_H3_HEIGHT = 416
GPU2_H3_FPS = 24
GPU2_H3_DEFAULT_DURATION_SECONDS = 5.0
GPU2_H3_MIN_DURATION_SECONDS = 4.0
GPU2_H3_MAX_DURATION_SECONDS = 15.0

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
    """Build a low-VRAM SeedVR2 image workflow that still satisfies the 4K UI contract."""
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
                "blocks_to_swap": 36,
                "swap_io_components": False,
                "offload_device": "cpu",
                "cache_model": False,
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
                "cache_model": False,
            },
        },
        "4": {
            "class_type": "SeedVR2VideoUpscaler",
            "inputs": {
                "image": ["1", 0],
                "dit": ["2", 0],
                "vae": ["3", 0],
                "seed": seed,
                "resolution": GPU2_IMAGE_UPSCALE_TARGET,
                "max_resolution": GPU2_IMAGE_UPSCALE_MAX_RESOLUTION,
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
        "image",
        "start_image",
        "end_image",
        "first_frame",
        "last_frame",
        "image_path",
        "image_path_end",
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
        "i2i_fj": (
            "Change the camera angle as requested while preserving the subject identity, clothes, and visual style. "
            "Keep the complete visible subject fully inside the frame, including the top of the head and both feet "
            "for a full-body character. Reframe or zoom out as needed, leave a safe margin, and do not crop body parts."
        ),
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
    """Fit requested geometry into the low-VRAM range without changing its aspect ratio."""
    try:
        normalized_width = int(float(width or 768))
    except (TypeError, ValueError):
        normalized_width = 768
    try:
        normalized_height = int(float(height or 768))
    except (TypeError, ValueError):
        normalized_height = 768
    normalized_width = max(1, normalized_width)
    normalized_height = max(1, normalized_height)
    scale = min(1.0, 1024 / max(normalized_width, normalized_height))
    normalized_width = max(256, int(normalized_width * scale))
    normalized_height = max(256, int(normalized_height * scale))
    return (
        max(256, (normalized_width // 8) * 8),
        max(256, (normalized_height // 8) * 8),
    )

GPU2_HUMAN_ANGLE_PROMPTS = (
    "Move the camera forward while preserving the same character and scene.",
    "Move the camera backward while preserving the same character and scene.",
    "Move the camera to the left while preserving the same character and scene.",
    "Move the camera to the right while preserving the same character and scene.",
    "Move the camera upward while preserving the same character and scene.",
    "Move the camera downward while preserving the same character and scene.",
    "Rotate the camera 45 degrees to the left around the same character.",
    "Rotate the camera 45 degrees to the right around the same character.",
    "Rotate the camera 90 degrees to the left around the same character.",
    "Rotate the camera 90 degrees to the right around the same character.",
    "Change the camera to a top-down view of the same character and scene.",
    "Change the camera to a low-angle view of the same character and scene.",
    "Change the camera to a wide-angle view while preserving the same character.",
    "Change the camera to a close-up view while preserving the same character.",
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
    image_names = _gpu2_input_image_names(task)[:6]
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

    load_links: list[list[Any]] = []
    for index, image_name in enumerate(image_names, 1):
        load_id = str(200 + index)
        workflow[load_id] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
        load_links.append([load_id, 0])

    if len(load_links) <= 3:
        reference_groups = [[link] for link in load_links]
    elif len(load_links) == 4:
        reference_groups = [[load_links[0]], [load_links[1]], load_links[2:4]]
    elif len(load_links) == 5:
        reference_groups = [[load_links[0]], load_links[1:3], load_links[3:5]]
    else:
        reference_groups = [load_links[0:2], load_links[2:4], load_links[4:6]]

    image_links: Dict[str, list[Any]] = {}
    for index, group in enumerate(reference_groups, 1):
        source_link = group[0]
        if len(group) == 2:
            stitch_id = str(300 + index)
            workflow[stitch_id] = {
                "class_type": "ImageStitch",
                "inputs": {
                    "image1": group[0],
                    "image2": group[1],
                    "direction": "down",
                    "spacing_color": "white",
                    "spacing_width": 0,
                    "match_image_size": True,
                },
            }
            source_link = [stitch_id, 0]

        scale_id = str(400 + index)
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
                "image": source_link,
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
    if task_type == "i2i_human":
        base_seed = _gpu2_seed(task)
        for index, angle_prompt in enumerate(GPU2_HUMAN_ANGLE_PROMPTS):
            if index == 0:
                prompt_id = "111"
                sampler_id = "3"
                decode_id = "8"
                save_id = "60"
            else:
                branch_base = 500 + index * 4
                prompt_id = str(branch_base)
                sampler_id = str(branch_base + 1)
                decode_id = str(branch_base + 2)
                save_id = str(branch_base + 3)
                workflow[prompt_id] = deepcopy(workflow["111"])
                workflow[sampler_id] = deepcopy(workflow["3"])
                workflow[decode_id] = deepcopy(workflow["8"])
                workflow[save_id] = deepcopy(workflow["60"])
                workflow[sampler_id]["inputs"]["positive"] = [prompt_id, 0]
                workflow[decode_id]["inputs"]["samples"] = [sampler_id, 0]
                workflow[save_id]["inputs"]["images"] = [decode_id, 0]

            workflow[prompt_id]["inputs"]["prompt"] = angle_prompt
            workflow[sampler_id]["inputs"]["seed"] = base_seed + index
            workflow[save_id]["inputs"]["filename_prefix"] = (
                f"MECHA_GPU2_i2i_human_{index + 1:02d}"
            )

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


def _gpu2_workflow_name(task: Dict[str, Any]) -> str:
    return str(task.get("workflow_name") or task.get("workflow") or "").strip().lower()


def _gpu2_input_file_name(
    task: Dict[str, Any],
    *,
    param_names: tuple[str, ...],
    extensions: tuple[str, ...],
) -> str:
    params = _gpu2_task_params(task)
    for key in param_names:
        value = str(params.get(key) or "").strip()
        if value:
            return value

    normalized_params = {name.lower() for name in param_names}
    fallback = ""
    for item in task.get("files") or []:
        if not isinstance(item, dict):
            continue
        filename = str(item.get("filename") or "").strip()
        if not filename:
            continue
        item_param = str(item.get("param") or "").strip().lower()
        if item_param in normalized_params:
            return filename
        if not fallback and filename.lower().endswith(extensions):
            fallback = filename
    if fallback:
        return fallback
    raise RuntimeError(f"GPU2 task is missing an input file for {', '.join(param_names)}")


def _gpu2_seed(task: Dict[str, Any]) -> int:
    params = _gpu2_task_params(task)
    try:
        seed = int(params.get("seed") or params.get("seed_0") or 42)
    except (TypeError, ValueError):
        seed = -1
    return seed if seed >= 0 else random.randint(0, 2**63 - 1)


def is_gpu2_h3_task(task: Dict[str, Any]) -> bool:
    task_type = str(task.get("task_type") or "").strip().lower()
    workflow_name = _gpu2_workflow_name(task)
    params = _gpu2_task_params(task)
    model = str(params.get("model") or params.get("model_name") or "").strip().lower()
    return (
        model in {"minimaxh3", "minimax-h3", "minimax_h3"}
        or workflow_name in {"minimax_h3_fl2va", "gpu2_minimax_h3_fl2va"}
        or workflow_name.startswith("minimax_h3")
        or (task_type in {"i2v", "morph"} and "minimax" in model and "h3" in model)
    )


def gpu2_h3_duration_seconds(task: Dict[str, Any]) -> float:
    params = _gpu2_task_params(task)
    try:
        duration = float(params.get("duration") or GPU2_H3_DEFAULT_DURATION_SECONDS)
    except (TypeError, ValueError):
        duration = GPU2_H3_DEFAULT_DURATION_SECONDS
    return max(GPU2_H3_MIN_DURATION_SECONDS, min(GPU2_H3_MAX_DURATION_SECONDS, duration))


def gpu2_h3_length_frames(task: Dict[str, Any]) -> int:
    """Use the official MiniMax H3 ComfyUI template length expression."""
    requested = max(5, round(gpu2_h3_duration_seconds(task) * GPU2_H3_FPS))
    return int(requested + (5 - (requested % 17)) % 17)


def build_gpu2_minimax_h3_fl2va_workflow(task: Dict[str, Any]) -> Dict[str, Any]:
    """Build the official MiniMax H3 FL2VA graph for the isolated GPU2:8189 ComfyUI."""
    params = _gpu2_task_params(task)
    image_names = _gpu2_input_image_names(task)
    if not image_names:
        raise RuntimeError("GPU2 MiniMax H3 task is missing a first-frame image filename")

    prompt = str(
        params.get("prompt")
        or params.get("positive_prompt")
        or "cinematic image to video, stable camera motion, natural movement, high quality"
    ).strip()
    seed = _gpu2_seed(task)
    workflow: Dict[str, Any] = {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_names[0]}},
        "3": {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["1", 0],
                "upscale_method": "lanczos",
                "width": GPU2_H3_WIDTH,
                "height": GPU2_H3_HEIGHT,
                "crop": "center",
            },
        },
        "6": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": GPU2_H3_MODEL_FILES["diffusion"],
                "weight_dtype": "default",
            },
        },
        "9": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": ["6", 0],
                "scheduler": "simple",
                "steps": 20,
                "denoise": 1,
            },
        },
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0], "vae": ["11", 0]}},
        "11": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": GPU2_H3_MODEL_FILES["video_vae"]},
        },
        "13": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": GPU2_H3_MODEL_FILES["text_encoder"],
                "type": "minimax",
                "device": "default",
            },
        },
        "14": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["15", 0],
                "guider": ["16", 0],
                "sampler": ["17", 0],
                "sigmas": ["9", 0],
                "latent_image": ["104", 1],
            },
        },
        "15": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "16": {
            "class_type": "BasicGuider",
            "inputs": {"model": ["6", 0], "conditioning": ["104", 0]},
        },
        "17": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "23": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["14", 0], "vae": ["24", 0]},
        },
        "24": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": GPU2_H3_MODEL_FILES["audio_vae"]},
        },
        "91": {
            "class_type": "CreateVideo",
            "inputs": {
                "images": ["10", 0],
                "audio": ["23", 0],
                "fps": GPU2_H3_FPS,
                "bit_depth": 8,
            },
        },
        "92": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["91", 0],
                "filename_prefix": "MECHA_GPU2_minimax_h3",
                "format": "auto",
                "codec": "auto",
            },
        },
        "104": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["13", 0],
                "vae": ["11", 0],
                "first_frame": ["3", 0],
                "prompt": prompt,
                "width": GPU2_H3_WIDTH,
                "height": GPU2_H3_HEIGHT,
                "length": gpu2_h3_length_frames(task),
            },
        },
    }
    if len(image_names) >= 2:
        workflow["2"] = {"class_type": "LoadImage", "inputs": {"image": image_names[1]}}
        workflow["4"] = {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["2", 0],
                "upscale_method": "lanczos",
                "width": GPU2_H3_WIDTH,
                "height": GPU2_H3_HEIGHT,
                "crop": "center",
            },
        }
        workflow["104"]["inputs"]["last_frame"] = ["4", 0]
        workflow["92"]["inputs"]["filename_prefix"] = "MECHA_GPU2_minimax_h3_fl2va"
    return workflow


def is_gpu2_wan_i2v_task(task: Dict[str, Any]) -> bool:
    task_type = str(task.get("task_type") or "").strip().lower()
    workflow_name = _gpu2_workflow_name(task)
    params = _gpu2_task_params(task)
    model = str(params.get("model") or params.get("model_name") or "").strip().lower()
    return (
        workflow_name in {"wan2_i2v", "wan2_morph"}
        or workflow_name.startswith("wan2_i2v")
        or workflow_name.startswith("wan2_morph")
        or (task_type in {"i2v", "morph"} and ("wan" in model or model == "wannode2"))
    )


def is_gpu2_infinitetalk_task(task: Dict[str, Any]) -> bool:
    task_type = str(task.get("task_type") or "").strip().lower()
    workflow_name = _gpu2_workflow_name(task)
    return task_type in {"voice", "infinitetalk"} or "infinitetalk" in workflow_name


def gpu2_wan_duration_seconds(task: Dict[str, Any]) -> float:
    """Preserve the requested clip duration while bounding pathological requests."""
    params = _gpu2_task_params(task)
    try:
        duration = float(params.get("duration") or 5.0)
    except (TypeError, ValueError):
        duration = 5.0
    return max(1.0, min(GPU2_WAN_MAX_GENERATION_SECONDS, duration))


def gpu2_wan_total_frames(task: Dict[str, Any]) -> int:
    """Wan frame counts must follow 4n+1 while covering the requested duration."""
    requested = max(1, int(math.ceil(gpu2_wan_duration_seconds(task) * GPU2_WAN_FPS)))
    return int(math.ceil(max(0, requested - 1) / 4) * 4 + 1)


def gpu2_wan_chunk_frame_counts(task: Dict[str, Any]) -> list[int]:
    """Split long clips into overlapping 33-frame windows for the 12 GB node."""
    remaining_new_frames = gpu2_wan_total_frames(task) - 1
    chunks: list[int] = []
    while remaining_new_frames > 0:
        new_frames = min(GPU2_WAN_FRAMES - 1, remaining_new_frames)
        chunks.append(new_frames + 1)
        remaining_new_frames -= new_frames
    return chunks or [1]


def _gpu2_wan_common_nodes(task: Dict[str, Any]) -> Dict[str, Any]:
    params = _gpu2_task_params(task)
    prompt = str(
        params.get("prompt")
        or params.get("positive_prompt")
        or "cinematic movement, stable subject, natural motion, high quality"
    ).strip()
    negative_prompt = str(
        params.get("negative_prompt")
        or "low quality, static image, blur, distortion, flicker, text, watermark"
    ).strip()
    return {
        "10": {
            "class_type": "LoadWanVideoT5TextEncoder",
            "inputs": {
                "model_name": GPU2_WAN_MODEL_FILES["text_encoder"],
                "precision": "bf16",
                "load_device": "offload_device",
                "quantization": "fp8_e4m3fn",
            },
        },
        "11": {
            "class_type": "WanVideoTextEncode",
            "inputs": {
                "positive_prompt": prompt,
                "negative_prompt": negative_prompt,
                "force_offload": True,
                "use_disk_cache": False,
                "device": "cpu",
                "t5": ["10", 0],
            },
        },
        "12": {
            "class_type": "WanVideoBlockSwap",
            "inputs": {
                "blocks_to_swap": GPU2_WAN_BLOCKS_TO_SWAP,
                "offload_img_emb": True,
                "offload_txt_emb": True,
                "use_non_blocking": False,
                "vace_blocks_to_swap": 0,
                "prefetch_blocks": 0,
                "block_swap_debug": False,
            },
        },
        "13": {
            "class_type": "WanVideoLoraSelect",
            "inputs": {
                "lora": GPU2_WAN_MODEL_FILES["lora"],
                "strength": 1.0,
                "low_mem_load": True,
                "merge_loras": False,
            },
        },
        "14": {
            "class_type": "WanVideoModelLoader",
            "inputs": {
                "model": GPU2_WAN_MODEL_FILES["diffusion"],
                "base_precision": "fp16",
                "quantization": "fp8_e4m3fn_scaled",
                "load_device": "offload_device",
                "attention_mode": "sdpa",
                "rms_norm_function": "default",
                "block_swap_args": ["12", 0],
                "lora": ["13", 0],
            },
        },
        "15": {
            "class_type": "WanVideoVAELoader",
            "inputs": {
                "model_name": GPU2_WAN_MODEL_FILES["vae"],
                "precision": "bf16",
            },
        },
    }


def build_gpu2_wan_i2v_workflow(task: Dict[str, Any]) -> Dict[str, Any]:
    """Build a duration-aware Wan 2.1 graph split into low-VRAM frame windows."""
    workflow_name = _gpu2_workflow_name(task)
    task_type = str(task.get("task_type") or "").strip().lower()
    morph = task_type == "morph" or "morph" in workflow_name
    image_names = _gpu2_input_image_names(task)
    if not image_names:
        raise RuntimeError("GPU2 Wan task is missing a start image filename")
    if morph and len(image_names) < 2:
        raise RuntimeError("GPU2 Wan morph task is missing an end image filename")
    chunk_frames = gpu2_wan_chunk_frame_counts(task)

    workflow = _gpu2_wan_common_nodes(task)
    workflow.update(
        {
            "20": {"class_type": "LoadImage", "inputs": {"image": image_names[0]}},
            "21": {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["20", 0],
                    "upscale_method": "lanczos",
                    "width": GPU2_WAN_WIDTH,
                    "height": GPU2_WAN_HEIGHT,
                    "crop": "center",
                },
            },
            "22": {
                "class_type": "WanVideoImageToVideoEncode",
                "inputs": {
                    "width": GPU2_WAN_WIDTH,
                    "height": GPU2_WAN_HEIGHT,
                    "num_frames": chunk_frames[0],
                    "noise_aug_strength": 0.0,
                    "start_latent_strength": 1.0,
                    "end_latent_strength": 1.0,
                    "force_offload": True,
                    "fun_or_fl2v_model": False,
                    "tiled_vae": True,
                    "vae": ["15", 0],
                    "start_image": ["21", 0],
                },
            },
            "23": {
                "class_type": "WanVideoSampler",
                "inputs": {
                    "steps": 4,
                    "cfg": 1.0,
                    "shift": 8.0,
                    "seed": _gpu2_seed(task),
                    "force_offload": True,
                    "scheduler": "dpm++_sde",
                    "riflex_freq_index": 0,
                    "denoise_strength": 1.0,
                    "batched_cfg": False,
                    "rope_function": "comfy_chunked",
                    "start_step": 0,
                    "end_step": -1,
                    "add_noise_to_samples": False,
                    "model": ["14", 0],
                    "image_embeds": ["22", 0],
                    "text_embeds": ["11", 0],
                },
            },
            "24": {
                "class_type": "WanVideoDecode",
                "inputs": {
                    "enable_vae_tiling": True,
                    "tile_x": 256,
                    "tile_y": 256,
                    "tile_stride_x": 128,
                    "tile_stride_y": 128,
                    "normalization": "default",
                    "vae": ["15", 0],
                    "samples": ["23", 0],
                },
            },
            "25": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["24", 0],
                    "frame_rate": GPU2_WAN_FPS,
                    "loop_count": 0,
                    "filename_prefix": "MECHA_GPU2_wan_i2v",
                    "format": "video/h264-mp4",
                    "pix_fmt": "yuv420p",
                    "crf": 23,
                    "save_metadata": True,
                    "trim_to_audio": False,
                    "pingpong": False,
                    "save_output": True,
                },
            },
        }
    )
    if morph:
        workflow["26"] = {"class_type": "LoadImage", "inputs": {"image": image_names[1]}}
        workflow["27"] = {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["26", 0],
                "upscale_method": "lanczos",
                "width": GPU2_WAN_WIDTH,
                "height": GPU2_WAN_HEIGHT,
                "crop": "center",
            },
        }
        workflow["25"]["inputs"]["filename_prefix"] = "MECHA_GPU2_wan_morph"

    combined_images: list[Any] = ["24", 0]
    combined_frame_count = chunk_frames[0]
    final_encode_node = "22"
    for chunk_index, frame_count in enumerate(chunk_frames[1:], 1):
        base_id = 30 + (chunk_index - 1) * 10
        last_frame_id = str(base_id)
        encode_id = str(base_id + 1)
        sample_id = str(base_id + 2)
        decode_id = str(base_id + 3)
        trim_id = str(base_id + 4)
        combine_id = str(base_id + 5)

        workflow[last_frame_id] = {
            "class_type": "ImageFromBatch",
            "inputs": {
                "image": combined_images,
                "batch_index": combined_frame_count - 1,
                "length": 1,
            },
        }
        workflow[encode_id] = deepcopy(workflow["22"])
        workflow[encode_id]["inputs"]["num_frames"] = frame_count
        workflow[encode_id]["inputs"]["start_image"] = [last_frame_id, 0]
        workflow[encode_id]["inputs"].pop("end_image", None)
        workflow[sample_id] = deepcopy(workflow["23"])
        workflow[sample_id]["inputs"]["seed"] = _gpu2_seed(task) + chunk_index
        workflow[sample_id]["inputs"]["image_embeds"] = [encode_id, 0]
        workflow[decode_id] = deepcopy(workflow["24"])
        workflow[decode_id]["inputs"]["samples"] = [sample_id, 0]
        workflow[trim_id] = {
            "class_type": "ImageFromBatch",
            "inputs": {
                "image": [decode_id, 0],
                "batch_index": 1,
                "length": frame_count - 1,
            },
        }
        workflow[combine_id] = {
            "class_type": "ImageBatch",
            "inputs": {"image1": combined_images, "image2": [trim_id, 0]},
        }
        combined_images = [combine_id, 0]
        combined_frame_count += frame_count - 1
        final_encode_node = encode_id

    if morph:
        workflow[final_encode_node]["inputs"]["end_image"] = ["27", 0]
    workflow["25"]["inputs"]["images"] = combined_images
    return workflow


def gpu2_infinitetalk_duration_seconds(task: Dict[str, Any]) -> float:
    """Return a bounded target duration while preserving the low-VRAM window size."""
    params = _gpu2_task_params(task)
    try:
        duration = float(params.get("duration") or 5.0)
    except (TypeError, ValueError):
        duration = 5.0
    return max(1.0, min(GPU2_WAN_MAX_DURATION_SECONDS, duration))


def gpu2_infinitetalk_total_frames(task: Dict[str, Any]) -> int:
    return max(1, int(math.ceil(gpu2_infinitetalk_duration_seconds(task) * GPU2_WAN_FPS)))


def build_gpu2_infinitetalk_workflow(task: Dict[str, Any]) -> Dict[str, Any]:
    """Build a duration-aware InfiniteTalk graph for the RTX 3060 12 GB node."""
    params = _gpu2_task_params(task)
    duration_seconds = gpu2_infinitetalk_duration_seconds(task)
    total_frames = gpu2_infinitetalk_total_frames(task)
    video_name = _gpu2_input_file_name(
        task,
        param_names=("video_filename", "uploaded_video", "video"),
        extensions=(".mp4", ".mov", ".mkv", ".webm", ".avi"),
    )
    audio_name = _gpu2_input_file_name(
        task,
        param_names=("audio_filename", "uploaded_audio", "audio", "Audio"),
        extensions=(".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"),
    )
    prompt = str(
        params.get("prompt_AU")
        or params.get("prompt")
        or "A person speaks naturally with stable identity and synchronized lips."
    ).strip()
    workflow = _gpu2_wan_common_nodes({**task, "params": {**params, "prompt": prompt}})
    workflow["14"]["inputs"]["multitalk_model"] = ["32", 0]
    workflow.update(
        {
            "30": {
                "class_type": "VHS_LoadVideo",
                "inputs": {
                    "video": video_name,
                    "force_rate": GPU2_WAN_FPS,
                    "custom_width": 0,
                    "custom_height": 0,
                    "frame_load_cap": 1,
                    "skip_first_frames": 0,
                    "select_every_nth": 1,
                    "format": "AnimateDiff",
                },
            },
            "31": {
                "class_type": "VHS_LoadAudioUpload",
                "inputs": {"audio": audio_name, "start_time": 0, "duration": duration_seconds},
            },
            "32": {
                "class_type": "MultiTalkModelLoader",
                "inputs": {"model": GPU2_WAN_MODEL_FILES["infinitetalk"]},
            },
            "33": {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["30", 0],
                    "upscale_method": "lanczos",
                    "width": GPU2_WAN_WIDTH,
                    "height": GPU2_WAN_HEIGHT,
                    "crop": "center",
                },
            },
            "34": {
                "class_type": "CLIPVisionLoader",
                "inputs": {"clip_name": GPU2_WAN_MODEL_FILES["clip_vision"]},
            },
            "35": {
                "class_type": "WanVideoClipVisionEncode",
                "inputs": {
                    "strength_1": 1.0,
                    "strength_2": 1.0,
                    "crop": "center",
                    "combine_embeds": "average",
                    "force_offload": True,
                    "tiles": 0,
                    "ratio": 0.5,
                    "clip_vision": ["34", 0],
                    "image_1": ["33", 0],
                },
            },
            "36": {
                "class_type": "WanVideoImageToVideoMultiTalk",
                "inputs": {
                    "width": GPU2_WAN_WIDTH,
                    "height": GPU2_WAN_HEIGHT,
                    "frame_window_size": GPU2_WAN_FRAMES,
                    "motion_frame": 9,
                    "force_offload": True,
                    "colormatch": "disabled",
                    "tiled_vae": True,
                    "mode": "infinitetalk",
                    "output_path": "",
                    "vae": ["15", 0],
                    "start_image": ["33", 0],
                    "clip_embeds": ["35", 0],
                },
            },
            "37": {
                "class_type": "Wav2VecModelLoader",
                "inputs": {
                    "model": GPU2_WAN_MODEL_FILES["wav2vec"],
                    "base_precision": "fp16",
                    "load_device": "offload_device",
                },
            },
            "38": {
                "class_type": "MultiTalkWav2VecEmbeds",
                "inputs": {
                    "normalize_loudness": True,
                    "num_frames": total_frames,
                    "fps": float(GPU2_WAN_FPS),
                    "audio_scale": 1.0,
                    "audio_cfg_scale": 1.0,
                    "multi_audio_type": "para",
                    "wav2vec_model": ["37", 0],
                    "audio_1": ["31", 0],
                },
            },
            "39": {
                "class_type": "WanVideoSampler",
                "inputs": {
                    "steps": 4,
                    "cfg": 1.0,
                    "shift": 8.0,
                    "seed": _gpu2_seed(task),
                    "force_offload": True,
                    "scheduler": "dpm++_sde",
                    "riflex_freq_index": 0,
                    "denoise_strength": 1.0,
                    "batched_cfg": False,
                    "rope_function": "comfy_chunked",
                    "start_step": 0,
                    "end_step": -1,
                    "add_noise_to_samples": False,
                    "model": ["14", 0],
                    "image_embeds": ["36", 0],
                    "text_embeds": ["11", 0],
                    "multitalk_embeds": ["38", 0],
                },
            },
            "40": {
                "class_type": "WanVideoDecode",
                "inputs": {
                    "enable_vae_tiling": True,
                    "tile_x": 256,
                    "tile_y": 256,
                    "tile_stride_x": 128,
                    "tile_stride_y": 128,
                    "normalization": "default",
                    "vae": ["15", 0],
                    "samples": ["39", 0],
                },
            },
            "41": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["40", 0],
                    "audio": ["31", 0],
                    "frame_rate": GPU2_WAN_FPS,
                    "loop_count": 0,
                    "filename_prefix": "MECHA_GPU2_infinitetalk",
                    "format": "video/h264-mp4",
                    "pix_fmt": "yuv420p",
                    "crf": 23,
                    "save_metadata": True,
                    "trim_to_audio": True,
                    "pingpong": False,
                    "save_output": True,
                },
            },
        }
    )
    return workflow


def prepare_gpu2_task(task: Dict[str, Any]) -> Dict[str, Any]:
    prepared = deepcopy(task)
    task_type = str(prepared.get("task_type") or "").lower()
    operation = str(_gpu2_task_params(prepared).get("gpu2_operation") or "").lower()
    if is_gpu2_h3_task(prepared):
        prepared["workflow_json"] = build_gpu2_minimax_h3_fl2va_workflow(prepared)
        prepared["workflow_name"] = "gpu2_minimax_h3_fl2va"
        params = prepared.get("params")
        if not isinstance(params, dict):
            params = {}
            prepared["params"] = params
        params["preferred_comfyui_port"] = GPU2_H3_PORT
        params["strict_preferred_comfyui_port"] = True
    elif is_gpu2_infinitetalk_task(prepared):
        prepared["workflow_json"] = build_gpu2_infinitetalk_workflow(prepared)
        prepared["workflow_name"] = "gpu2_infinitetalk_wan21_low_vram"
    elif is_gpu2_wan_i2v_task(prepared):
        prepared["workflow_json"] = build_gpu2_wan_i2v_workflow(prepared)
        suffix = "morph" if task_type == "morph" or "morph" in _gpu2_workflow_name(prepared) else "i2v"
        prepared["workflow_name"] = f"gpu2_wan21_{suffix}_low_vram"
    elif operation in {"matting_subject", "matting_split"}:
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

    server_url = os.environ.get("MECHA_SERVER_URL", "https://192.168.31.134")
    ports = [
        int(value.strip())
        for value in os.environ.get("MECHA_COMFYUI_PORTS", "8188").split(",")
        if value.strip()
    ]
    Gpu2ComfyUIAgent(server_url, token, ports).run()


if __name__ == "__main__":
    main()
