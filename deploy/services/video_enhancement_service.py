"""Prepare portable GPU-Agent workflows for video enhancement tasks."""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Dict


_WORKFLOW_DIR = Path(__file__).resolve().parent.parent / "workflows"


def normalize_video_resolution(value: Any) -> int:
    """Normalize UI resolution labels for the legacy GPU1 SeedVR2 workflow."""
    normalized = str(value or "1080P").strip().upper()
    aliases = {"HD": 720, "FHD": 1080, "2K": 1440, "4K": 2160}
    if normalized in aliases:
        resolution = aliases[normalized]
    else:
        if normalized.endswith("P"):
            normalized = normalized[:-1]
        try:
            resolution = int(float(normalized))
        except (TypeError, ValueError):
            resolution = 1080
    return max(360, min(2160, resolution))


def build_video_upscale_workflow(
    video_filename: str,
    resolution: Any = "1080P",
    seed: Any = -1,
) -> Dict[str, Any]:
    """Build the GPU1 SeedVR2 graph; GPU2 rewrites it to its low-VRAM graph."""
    filename = str(video_filename or "").strip()
    if not filename:
        raise ValueError("video_filename is required for upscale")
    try:
        normalized_seed = int(seed)
    except (TypeError, ValueError):
        normalized_seed = -1
    if normalized_seed < 0:
        normalized_seed = random.randint(100000, 999999)
    target_resolution = normalize_video_resolution(resolution)

    return {
        "1": {
            "class_type": "VHS_LoadVideo",
            "inputs": {
                "video": filename,
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
                "encode_tile_size": 1024,
                "encode_tile_overlap": 128,
                "decode_tiled": True,
                "decode_tile_size": 1024,
                "decode_tile_overlap": 128,
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
                "seed": normalized_seed,
                "resolution": target_resolution,
                "max_resolution": max(1920, target_resolution),
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
                "audio": ["1", 2],
                "frame_rate": 25,
                "loop_count": 0,
                "filename_prefix": "OSTORY_video_upscale",
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": 20,
                "save_metadata": True,
                "trim_to_audio": True,
                "pingpong": False,
                "save_output": True,
            },
        },
    }


def _replace_workflow_values(value: Any, replacements: Dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {key: _replace_workflow_values(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace_workflow_values(item, replacements) for item in value]
    if isinstance(value, str):
        for placeholder, replacement in replacements.items():
            value = value.replace(placeholder, replacement)
    return value


def build_video_voice_workflow(
    video_filename: str,
    audio_filename: str,
    prompt: str,
) -> Dict[str, Any]:
    """Build GPU1's InfiniteTalk graph; GPU2 rewrites it for the RTX 3060."""
    video = str(video_filename or "").strip()
    audio = str(audio_filename or "").strip()
    if not video:
        raise ValueError("video_filename is required for voice")
    if not audio:
        raise ValueError("audio_filename is required for voice")
    template_path = _WORKFLOW_DIR / "video_infinitetalk.json"
    with template_path.open("r", encoding="utf-8") as handle:
        template = json.load(handle)
    return _replace_workflow_values(
        template,
        {
            "{video}": video,
            "{Audio}": audio,
            "{prompt_AU}": str(prompt or "自然表情与口型同步"),
        },
    )


async def prepare_video_upscale_task(
    task_data: Dict[str, Any],
    username: str,
    task_service: Any,
) -> None:
    resolved = await task_service.resolve_agent_file(
        "video_filename",
        task_data.get("video_filename"),
        username,
    )
    if not resolved:
        raise ValueError("video_filename is required for upscale")
    task_data["video_filename"] = resolved["filename"]
    task_data["workflow_json"] = build_video_upscale_workflow(
        resolved["filename"],
        task_data.get("resolution"),
        task_data.get("seed"),
    )
    task_data["workflow_name"] = "viedo_upscaler"
    task_data["agent_files"] = [resolved]


async def prepare_video_voice_task(
    task_data: Dict[str, Any],
    username: str,
    task_service: Any,
) -> None:
    resolved_files = []
    for param in ("image_path", "video_filename", "audio_filename"):
        resolved = await task_service.resolve_agent_file(param, task_data.get(param), username)
        if resolved:
            task_data[param] = resolved["filename"]
            resolved_files.append(resolved)
    video_filename = task_data.get("video_filename")
    audio_filename = task_data.get("audio_filename")
    if not video_filename or not audio_filename:
        raise ValueError("video_filename and audio_filename are required for voice")
    try:
        normalized_seed = int(task_data.get("seed", -1))
    except (TypeError, ValueError):
        normalized_seed = -1
    if normalized_seed < 0:
        normalized_seed = random.randint(100000, 999999)
    task_data["seed"] = normalized_seed
    task_data["workflow_json"] = build_video_voice_workflow(
        video_filename,
        audio_filename,
        task_data.get("prompt_AU") or task_data.get("prompt") or "",
    )
    task_data["workflow_name"] = "video_infinitetalk"
    task_data["agent_files"] = resolved_files
