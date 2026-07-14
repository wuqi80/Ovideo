"""Build and prepare ComfyUI video frame-interpolation tasks."""
from __future__ import annotations

from typing import Any, Dict


INTERPOLATION_MODEL = "rife_v4.25_lite.safetensors"
SUPPORTED_TARGET_FPS = (30, 60, 120)


def normalize_target_fps(value: Any) -> int:
    """Return a supported output FPS, defaulting to 60."""
    try:
        target_fps = int(value)
    except (TypeError, ValueError):
        return 60
    return target_fps if target_fps in SUPPORTED_TARGET_FPS else 60


def build_video_interpolation_workflow(
    video_filename: str,
    target_fps: Any = 60,
) -> Dict[str, Any]:
    """Build a portable native-ComfyUI RIFE interpolation workflow."""
    filename = str(video_filename or "").strip()
    if not filename:
        raise ValueError("video_filename is required for interpolation")

    output_fps = normalize_target_fps(target_fps)
    input_fps = min(60, output_fps / 2)
    return {
        "1": {
            "class_type": "VHS_LoadVideo",
            "inputs": {
                "video": filename,
                "force_rate": input_fps,
                "custom_width": 0,
                "custom_height": 0,
                "frame_load_cap": 0,
                "skip_first_frames": 0,
                "select_every_nth": 1,
                "format": "AnimateDiff",
            },
        },
        "2": {
            "class_type": "FrameInterpolationModelLoader",
            "inputs": {"model_name": INTERPOLATION_MODEL},
        },
        "3": {
            "class_type": "FrameInterpolate",
            "inputs": {
                "interp_model": ["2", 0],
                "images": ["1", 0],
                "multiplier": 2,
            },
        },
        "4": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["3", 0],
                "audio": ["1", 2],
                "frame_rate": output_fps,
                "loop_count": 0,
                "filename_prefix": "MECHA_interpolate",
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": 20,
                "save_metadata": True,
                "trim_to_audio": False,
                "pingpong": False,
                "save_output": True,
            },
        },
    }


async def prepare_video_interpolation_task(
    task_data: Dict[str, Any],
    username: str,
    task_service: Any,
) -> None:
    """Resolve the input video for an Agent and attach the executable graph."""
    resolved = await task_service.resolve_agent_file(
        "video_filename",
        task_data.get("video_filename"),
        username,
    )
    if not resolved:
        raise ValueError("video_filename is required for interpolation")

    task_data["video_filename"] = resolved["filename"]
    task_data["target_fps"] = normalize_target_fps(task_data.get("target_fps"))
    task_data["workflow_json"] = build_video_interpolation_workflow(
        resolved["filename"],
        task_data["target_fps"],
    )
    task_data["workflow_name"] = "video_interpolation_rife_lite"
    task_data["agent_files"] = [resolved]
