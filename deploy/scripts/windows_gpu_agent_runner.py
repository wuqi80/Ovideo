"""Run the MECHA ComfyUI Agent without exposing its token in process arguments."""
from __future__ import annotations

import json
import math
import os
import random
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable, Dict

try:
    from scripts.windows_gpu_resource_guard import Gpu2ResourceController
except ImportError:  # Direct execution on the Windows GPU host.
    from windows_gpu_resource_guard import Gpu2ResourceController


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

GPU2_COMFYUI_PORT = 8188
GPU2_H3_PORT = GPU2_COMFYUI_PORT
GPU2_MUSIC3_MODEL_FILES = {
    "diffusion": "minimax_music3_dit_int8_convrot.safetensors",
    "text_encoder": "minimax_music3_text_encoder_pruned_int8_convrot.safetensors",
    "vae": "minimax_music3_dav.safetensors",
}
GPU2_MUSIC3_MIN_DURATION_SECONDS = 10.0
GPU2_MUSIC3_MAX_DURATION_SECONDS = 300.0
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
GPU2_H3_SAGE_NODE_TYPES = {
    "PathchSageAttentionKJ",
    "MiniMaxH3MemoryEfficientSageAttentionPatch",
}
GPU2_H3_MINI_MODEL_FILES = {
    "text_encoder": "qwen3vl_4b_fp8_scaled.safetensors",
    "projection": "mmh3-4b-ClipProj-v3-mlp.safetensors",
}
GPU2_H3_MINI_MODEL_SIZES = {
    "text_encoder": 5242467968,
    "projection": 503434368,
}
GPU2_H3_CLIPPROJ_COMMIT = "e556987e6bbf9c6448dd5691fe29ce9a7a6970ae"
GPU2_H3_MINI_READY_MARKER = ROOT / "config" / "h3-mini-ready.json"
GPU2_H3_KJNODES_COMMIT = "6ab7e8130e449ed2c0037589bcf84146ceb7fc9c"
GPU2_H3_SAGE_READY_MARKER = ROOT / "config" / "h3-sageattention-ready.json"
GPU2_H3_DIRECTOR_COMMIT = "85863be2411eb1b5877c23414d88396c47838467"
GPU2_H3_LONG_READY_MARKER = ROOT / "config" / "h3-long-video-ready.json"
GPU2_H3_LONG_MAX_SEGMENTS = 8
GPU2_H3_LONG_MAX_DURATION_SECONDS = 120.0
GPU2_H3_LONG_CONTEXT_FRAMES = 22
GPU2_H3_DIRECTOR_NODE_TYPES = {
    "MiniMaxH3Director",
    "MiniMaxH3DirectorGroupImageToVideo",
    "MiniMaxH3DirectorGroupsCombine",
    "CreateVideo",
    "SaveVideo",
}
GPU2_H3_STANDALONE_MOTION_NODE_TYPES = {
    "MiniMaxH3MotionContext",
    "MiniMaxH3MotionContextTrim",
    "MiniMaxH3MotionContextSaveLatent",
    "MiniMaxH3MotionContextLoadLatent",
}

COMFYUI_RECOVERY_FAILURE_THRESHOLD = 10
COMFYUI_RECOVERY_COOLDOWN_SECONDS = 5 * 60
COMFYUI_START_COMMANDS = {
    8188: ROOT / "start_comfyui.cmd",
}
GPU2_RUNTIME_COMMANDS = {
    "wan": ROOT / "start_comfyui.cmd",
    "h3": ROOT / "scripts" / "windows_gpu_start_h3_comfyui.cmd",
    "music": ROOT / "scripts" / "windows_gpu_start_music3_comfyui.cmd",
}

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
GPU2_MODEL_RELEASE_TIMEOUT_SECONDS = 120
GPU2_MODEL_RELEASE_POLL_SECONDS = 5
GPU2_MODEL_RELEASE_STABLE_SAMPLES = 3
GPU2_MODEL_RELEASE_MIN_FREE_RAM_GIB = 96
GPU2_MODEL_RELEASE_MIN_FREE_VRAM_GIB = 8
GPU2_MODEL_RELEASE_RAM_TOLERANCE_GIB = 4
GPU2_MODEL_RELEASE_VRAM_TOLERANCE_GIB = 1
GPU2_MODEL_RELEASE_MIN_FREE_VRAM_RATIO = 0.75
GIB = 1024 ** 3

sys.path.insert(0, str(AGENT_DIR))


def gpu2_agent_maintenance_enabled() -> bool:
    """Fail closed unless production activation explicitly enables task claims."""
    return str(os.environ.get("MECHA_GPU_AGENT_MAINTENANCE", "1")).strip().lower() not in {
        "0", "false", "no", "off",
    }


def gpu2_h3_sage_attention_allowed() -> bool:
    return str(os.environ.get("MECHA_GPU_H3_SAGE_ATTENTION", "0")).strip().lower() in {
        "1", "true", "yes", "on",
    }


def gpu2_h3_sage_attention_requested(task: Dict[str, Any]) -> bool:
    model = str(
        _gpu2_task_params(task).get("model")
        or _gpu2_task_params(task).get("model_name")
        or ""
    ).strip().lower()
    if model in {"minimaxh3fast", "minimax-h3-fast", "minimax_h3_fast"}:
        return True
    value = _gpu2_task_params(task).get("h3_sage_attention", False)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def gpu2_h3_mini_requested(task: Dict[str, Any]) -> bool:
    params = _gpu2_task_params(task)
    model = str(params.get("model") or params.get("model_name") or "").strip().lower()
    if model in {"minimaxh3mini", "minimax-h3-mini", "minimax_h3_mini"}:
        return True
    value = params.get("h3_low_vram", False)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def gpu2_h3_fast_model_requested(task: Dict[str, Any]) -> bool:
    params = _gpu2_task_params(task)
    model = str(params.get("model") or params.get("model_name") or "").strip().lower()
    return model in {"minimaxh3fast", "minimax-h3-fast", "minimax_h3_fast"}


def gpu2_h3_mini_ready(
    *,
    marker_path: Path = GPU2_H3_MINI_READY_MARKER,
    object_info_reader: Callable[[], Dict[str, Any]] | None = None,
    models_root: Path | None = None,
) -> tuple[bool, str]:
    """Fail closed unless the pinned ClipProj node and both Mini assets are ready."""
    installed, reason = gpu2_h3_mini_installed(
        marker_path=marker_path,
        models_root=models_root,
    )
    if not installed:
        return False, reason
    try:
        if object_info_reader is None:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{GPU2_H3_PORT}/object_info", timeout=5
            ) as response:
                object_info = json.loads(response.read().decode("utf-8"))
        else:
            object_info = object_info_reader()
    except Exception as exc:
        return False, f"ComfyUI node discovery failed: {exc}"
    if "ClipProjApply" not in set(object_info or {}):
        return False, "required ClipProjApply node is missing"
    return True, "verified"


def gpu2_h3_mini_installed(
    *,
    marker_path: Path = GPU2_H3_MINI_READY_MARKER,
    models_root: Path | None = None,
) -> tuple[bool, str]:
    """Verify the installed Mini profile without depending on the active runtime."""
    try:
        marker = json.loads(Path(marker_path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        return False, f"verification marker unavailable: {exc}"
    if marker.get("verified") is not True:
        return False, "verification marker is not approved"
    if str(marker.get("clipproj_commit") or "") != GPU2_H3_CLIPPROJ_COMMIT:
        return False, "verified ClipProj commit does not match the reviewed release"
    if marker.get("inference_executed") is not False:
        return False, "verification marker must be non-inference only"
    root = Path(models_root or (ROOT / "ComfyUI-H3" / "ComfyUI" / "models"))
    expected_files = {
        root / "text_encoders" / GPU2_H3_MINI_MODEL_FILES["text_encoder"]:
            GPU2_H3_MINI_MODEL_SIZES["text_encoder"],
        root / "clip_projections" / GPU2_H3_MINI_MODEL_FILES["projection"]:
            GPU2_H3_MINI_MODEL_SIZES["projection"],
    }
    for path, expected_size in expected_files.items():
        try:
            if path.stat().st_size != expected_size:
                return False, f"model file size mismatch: {path.name}"
        except OSError as exc:
            return False, f"model file unavailable: {path.name}: {exc}"
    return True, "verified"


def gpu2_h3_long_video_allowed() -> bool:
    return str(os.environ.get("MECHA_GPU_H3_LONG_VIDEO", "0")).strip().lower() in {
        "1", "true", "yes", "on",
    }


def gpu2_h3_long_video_requested(task: Dict[str, Any]) -> bool:
    value = _gpu2_task_params(task).get("h3_long_video", False)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def gpu2_h3_upscale_720p_requested(task: Dict[str, Any]) -> bool:
    value = _gpu2_task_params(task).get("h3_upscale_720p", False)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def gpu2_h3_long_video_ready(
    *,
    marker_path: Path = GPU2_H3_LONG_READY_MARKER,
    object_info_reader: Callable[[], Dict[str, Any]] | None = None,
) -> tuple[bool, str]:
    """Fail closed unless the reviewed Director-only runtime is live."""
    if not gpu2_h3_long_video_allowed():
        return False, "disabled"
    try:
        marker = json.loads(Path(marker_path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        return False, f"verification marker unavailable: {exc}"
    if marker.get("verified") is not True:
        return False, "verification marker is not approved"
    if str(marker.get("director_commit") or "") != GPU2_H3_DIRECTOR_COMMIT:
        return False, "verified Director commit does not match the reviewed release"
    if marker.get("inference_executed") is not False:
        return False, "verification marker must be non-inference only"
    try:
        if object_info_reader is None:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{GPU2_H3_PORT}/object_info", timeout=5
            ) as response:
                object_info = json.loads(response.read().decode("utf-8"))
        else:
            object_info = object_info_reader()
    except Exception as exc:
        return False, f"ComfyUI node discovery failed: {exc}"
    live_nodes = set(object_info or {})
    conflicting = sorted(GPU2_H3_STANDALONE_MOTION_NODE_TYPES & live_nodes)
    if conflicting:
        return False, f"standalone Motion Context conflicts with Director: {', '.join(conflicting)}"
    missing = sorted(GPU2_H3_DIRECTOR_NODE_TYPES - live_nodes)
    if missing:
        return False, f"required Director nodes are missing: {', '.join(missing)}"
    return True, "verified"


def gpu2_h3_sage_attention_ready(
    *,
    marker_path: Path = GPU2_H3_SAGE_READY_MARKER,
    object_info_reader: Callable[[], Dict[str, Any]] | None = None,
    require_feature_flag: bool = True,
) -> tuple[bool, str]:
    """Require an offline verification marker plus live ComfyUI node discovery."""
    if require_feature_flag and not gpu2_h3_sage_attention_allowed():
        return False, "disabled"
    installed, reason = gpu2_h3_sage_attention_installed(marker_path=marker_path)
    if not installed:
        return False, reason
    try:
        if object_info_reader is None:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{GPU2_H3_PORT}/object_info", timeout=5
            ) as response:
                object_info = json.loads(response.read().decode("utf-8"))
        else:
            object_info = object_info_reader()
    except Exception as exc:
        return False, f"ComfyUI node discovery failed: {exc}"
    missing = sorted(GPU2_H3_SAGE_NODE_TYPES - set(object_info or {}))
    if missing:
        return False, f"required acceleration nodes are missing: {', '.join(missing)}"
    return True, "verified"


def gpu2_h3_sage_attention_installed(
    *, marker_path: Path = GPU2_H3_SAGE_READY_MARKER
) -> tuple[bool, str]:
    """Verify the reviewed Fast profile marker independent of the active runtime."""
    try:
        marker = json.loads(Path(marker_path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        return False, f"verification marker unavailable: {exc}"
    if marker.get("verified") is not True:
        return False, "verification marker is not approved"
    if str(marker.get("sageattention_version") or "") != "2.2.0":
        return False, "verified SageAttention version is not 2.2.0"
    if str(marker.get("cuda_arch") or "") != "sm86":
        return False, "verified CUDA architecture is not RTX 3060 sm86"
    if str(marker.get("kjnodes_commit") or "") != GPU2_H3_KJNODES_COMMIT:
        return False, "verified KJNodes commit does not match the reviewed release"
    if marker.get("inference_executed") is not False:
        return False, "verification marker must be non-inference only"
    return True, "verified"


def gpu2_static_h3_capabilities() -> Dict[str, Any]:
    """Report installed profiles even while the serialized runtime currently runs Wan."""
    mini_ready, mini_reason = gpu2_h3_mini_installed()
    fast_ready, fast_reason = gpu2_h3_sage_attention_installed()
    return {
        "minimax_h3_fast": fast_ready,
        "minimax_h3_fast_installation": fast_reason,
        "minimax_h3_mini": mini_ready,
        "minimax_h3_mini_installation": mini_reason,
    }


def _tcp_port_is_listening(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=1):
            return True
    except OSError:
        return False


def _launch_comfyui_command(command: Path) -> bool:
    if os.name != "nt":
        return False
    creation_flags = (
        getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        | getattr(subprocess, "DETACHED_PROCESS", 0)
        | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )
    subprocess.Popen(
        ["cmd.exe", "/d", "/c", str(command)],
        cwd=str(ROOT),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=creation_flags,
    )
    return True


class ComfyUIPortRecovery:
    """Restart configured local ComfyUI services only after a sustained TCP outage."""

    def __init__(
        self,
        ports: list[int],
        *,
        command_map: Dict[int, Path] | None = None,
        port_is_listening: Callable[[int], bool] = _tcp_port_is_listening,
        launcher: Callable[[Path], bool] = _launch_comfyui_command,
        clock: Callable[[], float] = time.monotonic,
        failure_threshold: int = COMFYUI_RECOVERY_FAILURE_THRESHOLD,
        cooldown_seconds: int = COMFYUI_RECOVERY_COOLDOWN_SECONDS,
    ) -> None:
        commands = command_map or COMFYUI_START_COMMANDS
        self.commands = {
            int(port): Path(commands[int(port)])
            for port in ports
            if int(port) in commands
        }
        self.port_is_listening = port_is_listening
        self.launcher = launcher
        self.clock = clock
        self.failure_threshold = max(1, int(failure_threshold))
        self.cooldown_seconds = max(0, int(cooldown_seconds))
        self.failures = {port: 0 for port in self.commands}
        self.last_launch_at: Dict[int, float] = {}

    def check(self) -> None:
        now = self.clock()
        for port, command in self.commands.items():
            if self.port_is_listening(port):
                self.failures[port] = 0
                continue

            self.failures[port] += 1
            if self.failures[port] < self.failure_threshold:
                continue
            if now - self.last_launch_at.get(port, float("-inf")) < self.cooldown_seconds:
                continue
            if not command.is_file():
                self.last_launch_at[port] = now
                print(
                    f"[MECHA] ComfyUI:{port} recovery command is missing: {command}",
                    file=sys.stderr,
                    flush=True,
                )
                continue

            self.last_launch_at[port] = now
            try:
                launched = self.launcher(command)
            except Exception as exc:
                self.failures[port] = 0
                print(
                    f"[MECHA] Failed to restart ComfyUI:{port}: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                continue

            if launched:
                self.failures[port] = 0
                print(
                    f"[MECHA] Restarted ComfyUI:{port} after sustained TCP outage",
                    flush=True,
                )


def gpu2_runtime_profile(task: Dict[str, Any]) -> str:
    """Map every GPU2 task to one isolated runtime on the shared port."""
    if is_gpu2_music3_task(task):
        return "music"
    return "h3" if is_gpu2_h3_task(task) else "wan"


def _stop_gpu2_runtime(profile: str) -> bool:
    """Stop only a known Drama ComfyUI listener; never match a generic python.exe."""
    if os.name != "nt":
        return False
    cleanup = ROOT / "scripts" / "windows_gpu_cleanup_port.ps1"
    if profile == "h3":
        python_exe = ROOT / "ComfyUI-H3" / "python_embeded" / "python.exe"
        command_match = ROOT / "ComfyUI-H3" / "ComfyUI" / "main.py"
    elif profile == "music":
        python_exe = ROOT / "ComfyUI-Music3" / "python_embeded" / "python.exe"
        command_match = ROOT / "ComfyUI-Music3" / "ComfyUI" / "main.py"
    else:
        python_exe = ROOT / "ComfyUI_windows_portable" / "python_embeded" / "python.exe"
        command_match = ROOT / "ComfyUI_windows_portable" / "ComfyUI" / "main.py"
    result = subprocess.run(
        [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(cleanup), "-Port", str(GPU2_COMFYUI_PORT),
            "-PythonExe", str(python_exe), "-CommandMatch", str(command_match),
        ],
        cwd=str(ROOT),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )
    return result.returncode == 0


def _free_gpu2_models() -> bool:
    payload = b'{"unload_models":true,"free_memory":true}'
    request = urllib.request.Request(
        f"http://127.0.0.1:{GPU2_COMFYUI_PORT}/free",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return 200 <= int(getattr(response, "status", 200)) < 300
    except (OSError, ValueError):
        return False


def _read_gpu2_memory_snapshot() -> Dict[str, int] | None:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{GPU2_COMFYUI_PORT}/system_stats",
            timeout=10,
        ) as response:
            payload = json.load(response)
    except (OSError, ValueError, TypeError):
        return None

    system = payload.get("system")
    devices = payload.get("devices")
    if not isinstance(system, dict) or not isinstance(devices, list):
        return None
    try:
        ram_total = int(system["ram_total"])
        ram_free = int(system["ram_free"])
        vram_totals = [
            int(device["vram_total"])
            for device in devices
            if isinstance(device, dict)
            and device.get("vram_total") is not None
            and device.get("vram_free") is not None
        ]
        vram_free_values = [
            int(device["vram_free"])
            for device in devices
            if isinstance(device, dict)
            and device.get("vram_total") is not None
            and device.get("vram_free") is not None
        ]
    except (KeyError, TypeError, ValueError):
        return None
    if ram_total <= 0 or ram_free < 0 or not vram_totals:
        return None
    if any(total <= 0 for total in vram_totals) or len(vram_totals) != len(vram_free_values):
        return None
    return {
        "ram_total": ram_total,
        "ram_free": ram_free,
        "vram_total": sum(vram_totals),
        "vram_free": sum(vram_free_values),
    }


class Gpu2ModelReleaseGate:
    """Fail closed until ComfyUI proves the previous model is unloaded."""

    def __init__(
        self,
        *,
        release_request: Callable[[], bool] = _free_gpu2_models,
        memory_reader: Callable[[], Dict[str, int] | None] = _read_gpu2_memory_snapshot,
        sleeper: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        timeout_seconds: int = GPU2_MODEL_RELEASE_TIMEOUT_SECONDS,
        poll_seconds: int = GPU2_MODEL_RELEASE_POLL_SECONDS,
        stable_samples: int = GPU2_MODEL_RELEASE_STABLE_SAMPLES,
        min_free_ram_gib: int = GPU2_MODEL_RELEASE_MIN_FREE_RAM_GIB,
        min_free_vram_gib: int = GPU2_MODEL_RELEASE_MIN_FREE_VRAM_GIB,
        ram_tolerance_gib: int = GPU2_MODEL_RELEASE_RAM_TOLERANCE_GIB,
        vram_tolerance_gib: int = GPU2_MODEL_RELEASE_VRAM_TOLERANCE_GIB,
        min_free_vram_ratio: float = GPU2_MODEL_RELEASE_MIN_FREE_VRAM_RATIO,
    ) -> None:
        self.release_request = release_request
        self.memory_reader = memory_reader
        self.sleeper = sleeper
        self.clock = clock
        self.timeout_seconds = max(1, int(timeout_seconds))
        self.poll_seconds = max(1, int(poll_seconds))
        self.stable_samples = max(1, int(stable_samples))
        self.min_free_ram = max(0, int(min_free_ram_gib)) * GIB
        self.min_free_vram = max(0, int(min_free_vram_gib)) * GIB
        self.ram_tolerance = max(0, int(ram_tolerance_gib)) * GIB
        self.vram_tolerance = max(0, int(vram_tolerance_gib)) * GIB
        self.min_free_vram_ratio = min(1.0, max(0.0, float(min_free_vram_ratio)))
        self.baseline: Dict[str, int] | None = None
        self.released = False
        self.last_error = "startup model state has not been verified"

    def mark_models_loaded(self) -> None:
        baseline = self.memory_reader()
        self.baseline = baseline
        self.released = False
        self.last_error = "previous task models have not been released"

    def mark_process_stopped(self) -> None:
        self.released = True
        self.baseline = None
        self.last_error = ""

    def _is_safe_snapshot(self, snapshot: Dict[str, int] | None) -> bool:
        if snapshot is None:
            return False
        try:
            ram_free = int(snapshot["ram_free"])
            vram_total = int(snapshot["vram_total"])
            vram_free = int(snapshot["vram_free"])
        except (KeyError, TypeError, ValueError):
            return False
        if ram_free < self.min_free_ram or vram_free < self.min_free_vram:
            return False
        if vram_total <= 0 or vram_free / vram_total < self.min_free_vram_ratio:
            return False
        if self.baseline is None:
            return True
        return (
            ram_free >= int(self.baseline.get("ram_free", 0)) - self.ram_tolerance
            and vram_free >= int(self.baseline.get("vram_free", 0)) - self.vram_tolerance
        )

    def release_and_wait(self) -> bool:
        self.released = False
        if not self.release_request():
            self.last_error = "ComfyUI rejected or did not answer the model release request"
            return False

        deadline = self.clock() + self.timeout_seconds
        consecutive = 0
        while self.clock() <= deadline:
            snapshot = self.memory_reader()
            if self._is_safe_snapshot(snapshot):
                consecutive += 1
                if consecutive >= self.stable_samples:
                    self.released = True
                    self.baseline = snapshot
                    self.last_error = ""
                    return True
            else:
                consecutive = 0
            self.sleeper(self.poll_seconds)

        self.last_error = (
            "model release did not recover the pre-task RAM/VRAM baseline "
            f"within {self.timeout_seconds}s"
        )
        return False

    def ensure_released(self) -> bool:
        return self.released or self.release_and_wait()


class Gpu2RuntimeManager:
    """Serialize Wan/H3/Music runtime switching on the single public port."""

    def __init__(
        self,
        *,
        commands: Dict[str, Path] | None = None,
        listener: Callable[[int], bool] = _tcp_port_is_listening,
        launcher: Callable[[Path], bool] = _launch_comfyui_command,
        stopper: Callable[[str], bool] = _stop_gpu2_runtime,
        model_gate: Gpu2ModelReleaseGate | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        startup_timeout: int = 180,
    ) -> None:
        self.commands = commands or GPU2_RUNTIME_COMMANDS
        self.listener = listener
        self.launcher = launcher
        self.stopper = stopper
        self.model_gate = model_gate or Gpu2ModelReleaseGate()
        self.sleeper = sleeper
        self.startup_timeout = max(1, int(startup_timeout))
        self.active_profile: str | None = "wan" if listener(GPU2_COMFYUI_PORT) else None
        self._lock = threading.Lock()

    def ensure(self, profile: str) -> None:
        if profile not in self.commands:
            raise RuntimeError(f"Unsupported GPU2 runtime profile: {profile}")
        with self._lock:
            if self.active_profile == profile and self.listener(GPU2_COMFYUI_PORT):
                return
            if self.listener(GPU2_COMFYUI_PORT):
                current = self.active_profile
                if not current or not self.stopper(current):
                    raise RuntimeError("Refused to replace an unknown ComfyUI listener on port 8188")
            command = Path(self.commands[profile])
            if not command.is_file():
                raise RuntimeError(f"GPU2 runtime launcher is missing: {command}")
            if not self.launcher(command):
                raise RuntimeError(f"Failed to launch GPU2 {profile} runtime")
            deadline = time.monotonic() + self.startup_timeout
            while time.monotonic() < deadline:
                if self.listener(GPU2_COMFYUI_PORT):
                    self.active_profile = profile
                    return
                self.sleeper(1)
            raise RuntimeError(f"GPU2 {profile} runtime did not open port 8188 in time")

    def mark_models_loaded(self) -> None:
        with self._lock:
            self.model_gate.mark_models_loaded()

    def release_models(self) -> bool:
        with self._lock:
            if not self.listener(GPU2_COMFYUI_PORT):
                self.model_gate.mark_process_stopped()
                return True
            return self.model_gate.release_and_wait()

    def ready_for_next_task(self) -> bool:
        with self._lock:
            if not self.listener(GPU2_COMFYUI_PORT):
                self.model_gate.mark_process_stopped()
                return True
            return self.model_gate.ensure_released()

    def emergency_stop(self) -> bool:
        """Stop only the runtime profile already owned by this Agent."""
        with self._lock:
            if not self.listener(GPU2_COMFYUI_PORT):
                self.model_gate.mark_process_stopped()
                return True
            profile = self.active_profile
            if not profile or profile not in self.commands:
                return False
            stopped = self.stopper(profile)
            if stopped:
                self.active_profile = None
                self.model_gate.mark_process_stopped()
            return stopped


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


def is_gpu2_music3_task(task: Dict[str, Any]) -> bool:
    task_type = str(task.get("task_type") or "").strip().lower()
    workflow_name = _gpu2_workflow_name(task)
    return task_type == "minimax_music3" or workflow_name == "gpu2_minimax_music3"


def gpu2_music3_duration_seconds(task: Dict[str, Any]) -> float:
    params = _gpu2_task_params(task)
    try:
        duration = float(
            params.get("duration_seconds")
            or params.get("duration")
            or 30.0
        )
    except (TypeError, ValueError):
        duration = 30.0
    return max(
        GPU2_MUSIC3_MIN_DURATION_SECONDS,
        min(GPU2_MUSIC3_MAX_DURATION_SECONDS, duration),
    )


def build_gpu2_minimax_music3_workflow(task: Dict[str, Any]) -> Dict[str, Any]:
    """Build the native low-VRAM MiniMax Music 3 graph.

    The int8 DiT/text encoder and tiled VAE decode are intentionally fixed here
    so a client cannot select a larger precision variant on the production node.
    """
    params = _gpu2_task_params(task)
    caption = str(
        params.get("caption")
        or params.get("prompt")
        or "Cinematic instrumental background score, coherent structure, no vocals."
    ).strip()
    lyrics = str(params.get("lyrics") or "[Instrumental]").strip()
    seed = _gpu2_seed(task)
    duration = gpu2_music3_duration_seconds(task)
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": GPU2_MUSIC3_MODEL_FILES["diffusion"],
                "weight_dtype": "default",
            },
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": GPU2_MUSIC3_MODEL_FILES["text_encoder"],
                "type": "minimax",
                "device": "default",
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": GPU2_MUSIC3_MODEL_FILES["vae"]},
        },
        "4": {
            "class_type": "MiniMaxMusic3TextEncode",
            "inputs": {
                "clip": ["2", 0],
                "caption": caption,
                "lyrics": lyrics,
                "seed": seed,
                "max_duration": duration,
                "cfg_scale": 1.7,
                "top_k": 50,
            },
        },
        "5": {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["4", 0]},
        },
        "6": {
            "class_type": "EmptyMiniMaxMusic3LatentAudio",
            "inputs": {"seconds": ["4", 1], "batch_size": 1},
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": seed + 1,
                "steps": 30,
                "cfg": 1.7,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
            },
        },
        "8": {
            "class_type": "VAEDecodeAudioTiled",
            "inputs": {
                "samples": ["7", 0],
                "vae": ["3", 0],
                "tile_size": 1536,
                "overlap": 64,
            },
        },
        "9": {
            "class_type": "SaveAudioAdvanced",
            "inputs": {
                "audio": ["8", 0],
                "filename_prefix": "audio/MECHA_GPU2_minimax_music3",
                "format": "mp3",
                "format.quality": "V0",
            },
        },
    }


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


def build_gpu2_minimax_h3_fl2va_workflow(
    task: Dict[str, Any], *, enable_sage_attention: bool = False, use_mini_clip: bool = False
) -> Dict[str, Any]:
    """Build the MiniMax H3 FL2VA graph for the Agent-switched local runtime."""
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
    if use_mini_clip:
        workflow["13"]["inputs"] = {
            "clip_name": GPU2_H3_MINI_MODEL_FILES["text_encoder"],
            "type": "krea2",
            "device": "default",
        }
        workflow["12"] = {
            "class_type": "ClipProjApply",
            "inputs": {
                "clip": ["13", 0],
                "projection": GPU2_H3_MINI_MODEL_FILES["projection"],
            },
        }
        workflow["104"]["inputs"]["clip"] = ["12", 0]
        workflow["92"]["inputs"]["filename_prefix"] += "_mini"
    if enable_sage_attention:
        workflow["7"] = {
            "class_type": "PathchSageAttentionKJ",
            "inputs": {
                "model": ["6", 0],
                "sage_attention": "auto",
                "allow_compile": True,
            },
        }
        workflow["8"] = {
            "class_type": "MiniMaxH3MemoryEfficientSageAttentionPatch",
            "inputs": {"model": ["7", 0]},
        }
        workflow["9"]["inputs"]["model"] = ["8", 0]
        workflow["16"]["inputs"]["model"] = ["8", 0]
    return workflow


def _gpu2_h3_long_video_segments(task: Dict[str, Any]) -> list[Dict[str, Any]]:
    params = _gpu2_task_params(task)
    raw_segments = params.get("h3_long_video_segments")
    if not isinstance(raw_segments, list) or not 2 <= len(raw_segments) <= GPU2_H3_LONG_MAX_SEGMENTS:
        raise RuntimeError(
            f"GPU2 H3 long video requires 2-{GPU2_H3_LONG_MAX_SEGMENTS} segments"
        )
    segments: list[Dict[str, Any]] = []
    total_duration = 0.0
    for index, raw in enumerate(raw_segments):
        if not isinstance(raw, dict):
            raise RuntimeError(f"GPU2 H3 long video segment {index + 1} is invalid")
        first_frame = str(raw.get("image_path") or "").strip()
        last_frame = str(raw.get("image_path_end") or "").strip()
        if not first_frame:
            raise RuntimeError(
                f"GPU2 H3 long video segment {index + 1} is missing a first frame"
            )
        try:
            duration = float(raw.get("duration") or 0)
        except (TypeError, ValueError) as exc:
            raise RuntimeError(
                f"GPU2 H3 long video segment {index + 1} duration is invalid"
            ) from exc
        if not GPU2_H3_MIN_DURATION_SECONDS <= duration <= GPU2_H3_MAX_DURATION_SECONDS:
            raise RuntimeError(
                f"GPU2 H3 long video segment {index + 1} must be 4-15 seconds"
            )
        total_duration += duration
        segments.append({
            "prompt": str(raw.get("prompt") or "").strip(),
            "duration": duration,
            "image_path": first_frame,
            "image_path_end": last_frame,
        })
    if total_duration > GPU2_H3_LONG_MAX_DURATION_SECONDS:
        raise RuntimeError(
            f"GPU2 H3 long video exceeds {GPU2_H3_LONG_MAX_DURATION_SECONDS:g} seconds"
        )
    return segments


def _gpu2_h3_director_segment_frames(duration: float) -> int:
    requested = max(5, round(float(duration) * GPU2_H3_FPS))
    return int(requested + (5 - (requested % 17)) % 17)


def build_gpu2_minimax_h3_long_video_workflow(
    task: Dict[str, Any], *, enable_sage_attention: bool = False, use_mini_clip: bool = False
) -> Dict[str, Any]:
    """Build one serialized Director prompt from an existing merged H3 card."""
    segments = _gpu2_h3_long_video_segments(task)
    seed = _gpu2_seed(task)
    frame_counts = [_gpu2_h3_director_segment_frames(segment["duration"]) for segment in segments]
    total_frames = sum(frame_counts)
    timeline_segments = []
    cursor = 0
    for index, (segment, frame_count) in enumerate(zip(segments, frame_counts)):
        timeline_segments.append({
            "id": f"shot{index}",
            "start": cursor,
            "length": frame_count,
            "frameCount": frame_count,
            "durationSec": segment["duration"],
            "prompt": segment["prompt"],
            "continuityFromPrev": index > 0,
        })
        cursor += frame_count
    timeline_data = json.dumps({
        "version": 5,
        "editMode": "segment",
        "timelineMode": "fl2v",
        "totalFrames": total_frames,
        "frameRate": GPU2_H3_FPS,
        "width": GPU2_H3_WIDTH,
        "height": GPU2_H3_HEIGHT,
        "refMaxSize": GPU2_H3_WIDTH,
        "output": {
            "mode": "fixed",
            "longEdge": GPU2_H3_WIDTH,
            "width": GPU2_H3_WIDTH,
            "height": GPU2_H3_HEIGHT,
            "maxExportFrames": 0,
            "exportMode": "all",
            "audioMode": "generate",
            "continuityEnabled": True,
            "continuityOverlapFrames": GPU2_H3_LONG_CONTEXT_FRAMES,
        },
        "global": {
            "taskType": "fl2v",
            "prompt": "",
            "refs": [],
            "referenceVideo": {},
            "continuousReference": False,
        },
        "segments": timeline_segments,
    }, ensure_ascii=False, separators=(",", ":"))

    model_link: list[Any] = ["6", 0]
    workflow: Dict[str, Any] = {
        "6": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": GPU2_H3_MODEL_FILES["diffusion"],
                "weight_dtype": "default",
            },
        },
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
        "24": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": GPU2_H3_MODEL_FILES["audio_vae"]},
        },
    }
    clip_link: list[Any] = ["13", 0]
    if use_mini_clip:
        workflow["13"]["inputs"] = {
            "clip_name": GPU2_H3_MINI_MODEL_FILES["text_encoder"],
            "type": "krea2",
            "device": "default",
        }
        workflow["12"] = {
            "class_type": "ClipProjApply",
            "inputs": {
                "clip": ["13", 0],
                "projection": GPU2_H3_MINI_MODEL_FILES["projection"],
            },
        }
        clip_link = ["12", 0]
    if enable_sage_attention:
        workflow["7"] = {
            "class_type": "PathchSageAttentionKJ",
            "inputs": {
                "model": ["6", 0],
                "sage_attention": "auto",
                "allow_compile": True,
            },
        }
        workflow["8"] = {
            "class_type": "MiniMaxH3MemoryEfficientSageAttentionPatch",
            "inputs": {"model": ["7", 0]},
        }
        model_link = ["8", 0]

    group_links: list[list[Any]] = []
    for index, segment in enumerate(segments):
        first_id = f"l{index}f"
        group_id = f"g{index}"
        workflow[first_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": segment["image_path"]},
        }
        group_inputs: Dict[str, Any] = {
            "prompt": segment["prompt"],
            "duration_sec": segment["duration"],
            "first_frame": [first_id, 0],
        }
        if segment["image_path_end"]:
            last_id = f"l{index}l"
            workflow[last_id] = {
                "class_type": "LoadImage",
                "inputs": {"image": segment["image_path_end"]},
            }
            group_inputs["last_frame"] = [last_id, 0]
        workflow[group_id] = {
            "class_type": "MiniMaxH3DirectorGroupImageToVideo",
            "inputs": group_inputs,
        }
        group_links.append([group_id, 0])

    workflow["80"] = {
        "class_type": "MiniMaxH3DirectorGroupsCombine",
        # Current Director uses ComfyUI Autogrow, whose API input names retain
        # the collection prefix (as shown by the reviewed example workflow).
        "inputs": {f"groups.group_{index}": link for index, link in enumerate(group_links)},
    }
    workflow["81"] = {
        "class_type": "MiniMaxH3Director",
        "inputs": {
            "model": model_link,
            "video_vae": ["11", 0],
            "audio_vae": ["24", 0],
            "clip": clip_link,
            "i2v_groups": ["80", 0],
            "task_type": "fl2v — 首尾帧生视频(First-Last Frame)",
            "global_prompt": "",
            "bd_grp_sample": "采样设置",
            "cfg": 1.0,
            "seed": seed,
            "frame_rate": float(GPU2_H3_FPS),
            "width": GPU2_H3_WIDTH,
            "height": GPU2_H3_HEIGHT,
            "ref_max_size": GPU2_H3_WIDTH,
            "total_frames": total_frames,
            "timeline_data": timeline_data,
            "bd_grp_advanced": "高级采样",
            "steps": 25,
            "sampler": "res_multistep",
            "scheduler": "simple",
            "shift_video": 12.0,
            "shift_audio": 3.0,
            "bd_grp_perf": "性能",
            "clear_vram_between_segments": True,
            "export_source_images": False,
        },
    }
    workflow["91"] = {
        "class_type": "CreateVideo",
        "inputs": {
            "images": ["81", 0],
            "audio": ["81", 1],
            "fps": ["81", 2],
            "bit_depth": 8,
        },
    }
    workflow["92"] = {
        "class_type": "SaveVideo",
        "inputs": {
            "video": ["91", 0],
            "filename_prefix": "MECHA_GPU2_minimax_h3_long",
            "format": "auto",
            "codec": "auto",
        },
    }
    if use_mini_clip:
        workflow["92"]["inputs"]["filename_prefix"] += "_mini"
    return workflow


def _gpu2_output_video_path(result: Dict[str, Any]) -> str:
    for value in result.get("output_files") or []:
        path = Path(str(value or ""))
        if path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm", ".avi"} and path.is_file():
            return str(path)
    raise RuntimeError("H3 completed without a local video output for 720P upscaling")


def _gpu2_upload_local_video(agent: Any, port: int, local_path: str) -> str:
    """Stage a local generated video in ComfyUI input without reloading any model."""
    path = Path(local_path)
    if not path.is_file():
        raise RuntimeError(f"H3 720P source video is unavailable: {path}")
    response = agent._upload_to_comfyui(port, str(path))
    if not response:
        raise RuntimeError("Failed to upload the H3 result for 720P upscaling")
    return str(response)


def execute_gpu2_h3_post_upscale_720p(
    *,
    agent: Any,
    runtime_manager: Any,
    resource_controller: Any,
    execute_workflow: Callable[[Dict[str, Any]], Dict[str, Any]],
    generation_result: Dict[str, Any],
    params: Dict[str, Any],
) -> Dict[str, Any]:
    """Run SeedVR2 only after H3 unload and the host guard both pass."""
    source_video = _gpu2_output_video_path(generation_result)
    if not runtime_manager.release_models():
        raise RuntimeError(
            "H3 model did not fully unload: " + runtime_manager.model_gate.last_error
        )
    if not resource_controller.ready_for_new_task():
        raise RuntimeError(
            "host resource guard rejected the upscale: " + resource_controller.last_error
        )
    runtime_manager.ensure("wan")
    uploaded_video = _gpu2_upload_local_video(agent, GPU2_COMFYUI_PORT, source_video)
    seed = params.get("seed") or params.get("seed_0") or 42
    upscale_params = {
        "video_filename": uploaded_video,
        "resolution": "720P",
        "seed": seed,
        "preferred_comfyui_port": GPU2_COMFYUI_PORT,
        "strict_preferred_comfyui_port": True,
        "gpu2_runtime_profile": "wan",
    }
    upscale_task = {
        "task_type": "upscale",
        "params": upscale_params,
        "workflow_json": build_gpu2_video_upscale_workflow({
            "task_type": "upscale",
            "params": upscale_params,
        }),
        "workflow_name": "gpu2_h3_post_upscale_720p",
    }
    runtime_manager.mark_models_loaded()
    upscale_result = execute_workflow(upscale_task)
    if str(upscale_result.get("status") or "completed") != "completed":
        raise RuntimeError(str(upscale_result.get("error") or "unknown upscale error"))
    payload = dict(upscale_result.get("result_payload") or {})
    payload.update({
        "h3_generation_completed": True,
        "h3_upscale_720p_completed": True,
        "upscale_resolution": "1280x720",
    })
    upscale_result["result_payload"] = payload
    return upscale_result


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
    if is_gpu2_music3_task(prepared):
        prepared["workflow_json"] = build_gpu2_minimax_music3_workflow(prepared)
        prepared["workflow_name"] = "gpu2_minimax_music3"
        params = prepared.get("params")
        if not isinstance(params, dict):
            source_data = prepared.get("data")
            params = dict(source_data) if isinstance(source_data, dict) else {}
            prepared["params"] = params
        params["preferred_comfyui_port"] = GPU2_COMFYUI_PORT
        params["strict_preferred_comfyui_port"] = True
        params["gpu2_runtime_profile"] = "music"
        params["comfyui_timeout_seconds"] = 60 * 60
    elif is_gpu2_h3_task(prepared):
        prepared["workflow_json"] = build_gpu2_minimax_h3_fl2va_workflow(prepared)
        prepared["workflow_name"] = "gpu2_minimax_h3_fl2va"
        params = prepared.get("params")
        if not isinstance(params, dict):
            source_data = prepared.get("data")
            params = dict(source_data) if isinstance(source_data, dict) else {}
            prepared["params"] = params
        params["preferred_comfyui_port"] = GPU2_H3_PORT
        params["strict_preferred_comfyui_port"] = True
        params["gpu2_runtime_profile"] = "h3"
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
    if prepared != task:
        params = prepared.get("params")
        if not isinstance(params, dict):
            params = {}
            prepared["params"] = params
        params.setdefault("preferred_comfyui_port", GPU2_COMFYUI_PORT)
        params.setdefault("strict_preferred_comfyui_port", True)
        params.setdefault("gpu2_runtime_profile", gpu2_runtime_profile(prepared))
    return prepared


def main() -> None:
    from comfyui_agent import ComfyUIAgent

    ports = [
        int(value.strip())
        for value in os.environ.get("MECHA_COMFYUI_PORTS", "8188").split(",")
        if value.strip()
    ]
    runtime_manager = Gpu2RuntimeManager()
    resource_controller = Gpu2ResourceController(
        ROOT,
        comfy_reader=_read_gpu2_memory_snapshot,
        emergency_stop=runtime_manager.emergency_stop,
    )

    class Gpu2ComfyUIAgent(ComfyUIAgent):
        def _get_system_info(self):
            info = super()._get_system_info()
            info["resource_guard"] = resource_controller.status()
            info["local_gpu_maintenance"] = gpu2_agent_maintenance_enabled()
            return info

        def _probe_comfyui_capabilities(self, port, status=""):
            capabilities = super()._probe_comfyui_capabilities(port, status)
            if status and status != "healthy":
                return capabilities
            capabilities.update(gpu2_static_h3_capabilities())
            return capabilities

        def heartbeat(self):
            return super().heartbeat()

        def poll(self):
            if gpu2_agent_maintenance_enabled():
                print(
                    "[MECHA] Local GPU maintenance gate is closed; no queued task will be claimed",
                    file=sys.stderr,
                    flush=True,
                )
                return None
            if not resource_controller.ready_for_new_task():
                print(
                    "[MECHA] New task claim blocked by host resource guard: "
                    f"{resource_controller.last_error}",
                    file=sys.stderr,
                    flush=True,
                )
                return None
            if not runtime_manager.ready_for_next_task():
                print(
                    "[MECHA] New task claim blocked until the previous model is released: "
                    f"{runtime_manager.model_gate.last_error}",
                    file=sys.stderr,
                    flush=True,
                )
                return None
            return super().poll()

        def execute_comfyui_task(self, task):
            acceleration_requested = (
                is_gpu2_h3_task(task)
                and gpu2_h3_sage_attention_requested(task)
            )
            long_video_requested = (
                is_gpu2_h3_task(task)
                and gpu2_h3_long_video_requested(task)
            )
            upscale_720p_requested = (
                is_gpu2_h3_task(task)
                and gpu2_h3_upscale_720p_requested(task)
            )
            mini_requested = is_gpu2_h3_task(task) and gpu2_h3_mini_requested(task)
            prepared = prepare_gpu2_task(task)
            params = prepared.get("params") or {}
            profile = params.get("gpu2_runtime_profile") or gpu2_runtime_profile(prepared)
            width = params.get("width") or params.get("output_width") or 0
            height = params.get("height") or params.get("output_height") or 0
            duration = params.get("duration") or params.get("duration_seconds") or 0
            resource_controller.begin_task({
                "task_id": prepared.get("task_id"),
                "task_type": prepared.get("task_type"),
                "runtime_profile": profile,
                "model": params.get("model") or prepared.get("workflow_name"),
                "width": width,
                "height": height,
                "duration_seconds": duration,
            })
            task_status = "failed"
            models_released = False
            try:
                runtime_manager.ensure(profile)
                acceleration_ready = False
                if acceleration_requested:
                    acceleration_ready, acceleration_reason = gpu2_h3_sage_attention_ready(
                        require_feature_flag=not gpu2_h3_fast_model_requested(task)
                    )
                    if acceleration_ready and not long_video_requested:
                        prepared["workflow_json"] = build_gpu2_minimax_h3_fl2va_workflow(
                            prepared, enable_sage_attention=True
                        )
                        prepared["workflow_name"] = "gpu2_minimax_h3_fl2va_sageattention"
                    else:
                        if gpu2_h3_fast_model_requested(task):
                            raise RuntimeError(
                                "H3 Fast is unavailable: " + acceleration_reason
                            )
                        print(
                            "[MECHA] H3 SageAttention requested but not verified; using baseline: "
                            f"{acceleration_reason}",
                            file=sys.stderr,
                            flush=True,
                        )
                if mini_requested:
                    mini_ready, mini_reason = gpu2_h3_mini_ready()
                    if not mini_ready:
                        raise RuntimeError("H3 Mini is unavailable: " + mini_reason)
                    if not long_video_requested:
                        prepared["workflow_json"] = build_gpu2_minimax_h3_fl2va_workflow(
                            prepared, use_mini_clip=True
                        )
                        prepared["workflow_name"] = "gpu2_minimax_h3_fl2va_mini"
                if long_video_requested:
                    long_video_ready, long_video_reason = gpu2_h3_long_video_ready()
                    if not long_video_ready:
                        raise RuntimeError(
                            "H3 long video is unavailable: " + long_video_reason
                        )
                    prepared["workflow_json"] = build_gpu2_minimax_h3_long_video_workflow(
                        prepared,
                        enable_sage_attention=bool(acceleration_ready),
                        use_mini_clip=mini_requested,
                    )
                    prepared["workflow_name"] = (
                        "gpu2_minimax_h3_long_director_sageattention"
                        if acceleration_ready
                        else (
                            "gpu2_minimax_h3_long_director_mini"
                            if mini_requested
                            else "gpu2_minimax_h3_long_director"
                        )
                    )
                runtime_manager.mark_models_loaded()
                result = super().execute_comfyui_task(prepared)
                task_status = str(result.get("status") or "completed")
                if upscale_720p_requested and task_status == "completed":
                    generation_result = result
                    try:
                        base_execute = super().execute_comfyui_task
                        result = execute_gpu2_h3_post_upscale_720p(
                            agent=self,
                            runtime_manager=runtime_manager,
                            resource_controller=resource_controller,
                            execute_workflow=base_execute,
                            generation_result=generation_result,
                            params=params,
                        )
                        task_status = "completed"
                    except Exception as exc:
                        task_status = "failed"
                        result = {
                            "status": "failed",
                            "error": "H3 video completed but 720P upscale failed: " + str(exc),
                            "output_files": generation_result.get("output_files") or [],
                            "result_payload": {
                                "h3_generation_completed": True,
                                "h3_upscale_720p_completed": False,
                            },
                        }
                return result
            finally:
                models_released = runtime_manager.release_models()
                if not models_released:
                    print(
                        "[MECHA] Model release gate is closed; queued tasks will remain unclaimed: "
                        f"{runtime_manager.model_gate.last_error}",
                        file=sys.stderr,
                        flush=True,
                    )
                resource_controller.finish_task(task_status, models_released=models_released)

        def _wait_for_completion(self, port, prompt_id, timeout=GPU2_LONG_TASK_TIMEOUT_SECONDS):
            return super()._wait_for_completion(
                port,
                prompt_id,
                timeout=GPU2_LONG_TASK_TIMEOUT_SECONDS,
            )

    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError(f"Agent token is empty: {TOKEN_FILE}")

    server_url = os.environ.get("MECHA_SERVER_URL", "https://spti.ai")
    resource_controller.start()
    try:
        Gpu2ComfyUIAgent(server_url, token, ports).run()
    finally:
        resource_controller.stop()


if __name__ == "__main__":
    main()
