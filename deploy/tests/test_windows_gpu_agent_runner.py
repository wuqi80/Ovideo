import json

import pytest

from scripts.windows_gpu_agent_runner import (
    COMFYUI_RECOVERY_COOLDOWN_SECONDS,
    COMFYUI_RECOVERY_FAILURE_THRESHOLD,
    ComfyUIPortRecovery,
    GPU2_BACKGROUND_REMOVAL_MODEL,
    GPU2_IMAGE_UPSCALE_MAX_RESOLUTION,
    GPU2_IMAGE_UPSCALE_TARGET,
    GPU2_HUMAN_ANGLE_PROMPTS,
    GPU2_H3_FPS,
    GPU2_H3_HEIGHT,
    GPU2_H3_KJNODES_COMMIT,
    GPU2_H3_DIRECTOR_COMMIT,
    GPU2_H3_MODEL_FILES,
    GPU2_H3_PORT,
    GPU2_COMFYUI_PORT,
    GIB,
    Gpu2ModelReleaseGate,
    Gpu2RuntimeManager,
    GPU2_H3_WIDTH,
    GPU2_QWEN_MODEL_FILES,
    GPU2_WAN_BLOCKS_TO_SWAP,
    GPU2_WAN_FRAMES,
    GPU2_WAN_HEIGHT,
    GPU2_WAN_MODEL_FILES,
    GPU2_WAN_WIDTH,
    build_gpu2_infinitetalk_workflow,
    build_gpu2_matting_workflow,
    build_gpu2_minimax_h3_fl2va_workflow,
    build_gpu2_minimax_h3_long_video_workflow,
    build_gpu2_qwen_workflow,
    build_gpu2_upscale_workflow,
    build_gpu2_video_upscale_workflow,
    build_gpu2_wan_i2v_workflow,
    gpu2_infinitetalk_duration_seconds,
    gpu2_infinitetalk_total_frames,
    gpu2_h3_duration_seconds,
    gpu2_h3_length_frames,
    gpu2_h3_sage_attention_ready,
    gpu2_h3_sage_attention_requested,
    gpu2_h3_long_video_ready,
    gpu2_h3_long_video_requested,
    gpu2_h3_upscale_720p_requested,
    gpu2_agent_maintenance_enabled,
    gpu2_wan_chunk_frame_counts,
    gpu2_wan_duration_seconds,
    gpu2_wan_total_frames,
    is_gpu2_h3_task,
    is_gpu2_infinitetalk_task,
    is_gpu2_qwen_compatible_task,
    is_gpu2_wan_i2v_task,
    normalize_gpu2_image_dimensions,
    normalize_gpu2_video_resolution,
    execute_gpu2_h3_post_upscale_720p,
    prepare_gpu2_task,
    tune_gpu2_qwen_workflow,
)


def test_gpu2_agent_maintenance_gate_defaults_closed(monkeypatch):
    monkeypatch.delenv("MECHA_GPU_AGENT_MAINTENANCE", raising=False)
    assert gpu2_agent_maintenance_enabled() is True

    monkeypatch.setenv("MECHA_GPU_AGENT_MAINTENANCE", "0")
    assert gpu2_agent_maintenance_enabled() is False


def test_gpu2_port_recovery_waits_for_sustained_outage_and_respects_cooldown(tmp_path):
    command = tmp_path / "start_h3.cmd"
    command.write_text("@echo off\n", encoding="utf-8")
    launched = []
    now = [1000.0]
    recovery = ComfyUIPortRecovery(
        [8288],
        command_map={8288: command},
        port_is_listening=lambda _port: False,
        launcher=lambda path: launched.append(path) or True,
        clock=lambda: now[0],
        failure_threshold=3,
        cooldown_seconds=60,
    )

    recovery.check()
    recovery.check()
    assert launched == []

    recovery.check()
    assert launched == [command]

    recovery.check()
    recovery.check()
    recovery.check()
    assert launched == [command]

    now[0] += 61
    recovery.check()
    assert launched == [command, command]


def test_gpu2_port_recovery_resets_failure_count_when_port_listens(tmp_path):
    command = tmp_path / "start_comfyui.cmd"
    command.write_text("@echo off\n", encoding="utf-8")
    listening = iter([False, True, False, False])
    launched = []
    recovery = ComfyUIPortRecovery(
        [8188],
        command_map={8188: command},
        port_is_listening=lambda _port: next(listening),
        launcher=lambda path: launched.append(path) or True,
        failure_threshold=2,
    )

    for _ in range(4):
        recovery.check()

    assert launched == [command]
    assert COMFYUI_RECOVERY_FAILURE_THRESHOLD * 3 == 30
    assert COMFYUI_RECOVERY_COOLDOWN_SECONDS == 300


def test_gpu2_port_recovery_launcher_failure_does_not_break_heartbeats(tmp_path):
    command = tmp_path / "start_comfyui.cmd"
    command.write_text("@echo off\n", encoding="utf-8")
    recovery = ComfyUIPortRecovery(
        [8188],
        command_map={8188: command},
        port_is_listening=lambda _port: False,
        launcher=lambda _path: (_ for _ in ()).throw(OSError("launch failed")),
        failure_threshold=1,
    )

    recovery.check()
    assert recovery.failures[8188] == 0


def test_gpu2_wan_i2v_uses_one_scaled_fp8_model_and_aggressive_ram_offload():
    task = {
        "task_type": "i2v",
        "workflow_name": "wan2_i2v",
        "params": {"image": "start.png", "prompt": "slow camera push", "seed": 77},
        "files": [{"param": "image", "filename": "start.png"}],
    }

    workflow = build_gpu2_wan_i2v_workflow(task)
    prepared = prepare_gpu2_task(task)

    assert is_gpu2_wan_i2v_task(task)
    assert workflow["10"]["inputs"]["precision"] == "bf16"
    assert workflow["12"]["inputs"]["blocks_to_swap"] == GPU2_WAN_BLOCKS_TO_SWAP
    assert workflow["12"]["inputs"]["offload_img_emb"] is True
    assert workflow["14"]["inputs"]["model"] == GPU2_WAN_MODEL_FILES["diffusion"]
    assert workflow["14"]["inputs"]["attention_mode"] == "sdpa"
    assert workflow["14"]["inputs"]["quantization"] == "fp8_e4m3fn_scaled"
    assert workflow["21"]["inputs"]["width"] == GPU2_WAN_WIDTH
    assert workflow["21"]["inputs"]["height"] == GPU2_WAN_HEIGHT
    assert workflow["22"]["inputs"]["num_frames"] == GPU2_WAN_FRAMES
    assert workflow["23"]["inputs"]["steps"] == 4
    assert workflow["23"]["inputs"]["rope_function"] == "comfy_chunked"
    assert workflow["25"]["inputs"]["save_output"] is True
    assert prepared["workflow_name"] == "gpu2_wan21_i2v_low_vram"


def test_gpu2_minimax_h3_routes_to_single_8188_port_and_audio_video_nodes():
    task = {
        "task_type": "i2v",
        "params": {
            "model": "MiniMaxH3",
            "image_path": "first.png",
            "prompt": "slow cinematic motion with natural ambient sound",
            "duration": 5,
            "seed": 77,
        },
        "files": [{"param": "image_path", "filename": "first.png"}],
    }

    workflow = build_gpu2_minimax_h3_fl2va_workflow(task)
    prepared = prepare_gpu2_task(task)

    assert is_gpu2_h3_task(task)
    assert workflow["1"]["inputs"]["image"] == "first.png"
    assert workflow["3"]["class_type"] == "ImageScale"
    assert workflow["3"]["inputs"]["image"] == ["1", 0]
    assert workflow["3"]["inputs"]["width"] == GPU2_H3_WIDTH
    assert workflow["3"]["inputs"]["height"] == GPU2_H3_HEIGHT
    assert GPU2_H3_WIDTH == 768
    assert GPU2_H3_HEIGHT == 416
    assert GPU2_H3_WIDTH % 32 == 0
    assert GPU2_H3_HEIGHT % 32 == 0
    assert workflow["3"]["inputs"]["crop"] == "center"
    assert workflow["6"]["inputs"]["unet_name"] == GPU2_H3_MODEL_FILES["diffusion"]
    assert workflow["13"]["inputs"]["clip_name"] == GPU2_H3_MODEL_FILES["text_encoder"]
    assert workflow["13"]["inputs"]["type"] == "minimax"
    assert workflow["11"]["inputs"]["vae_name"] == GPU2_H3_MODEL_FILES["video_vae"]
    assert workflow["24"]["inputs"]["vae_name"] == GPU2_H3_MODEL_FILES["audio_vae"]
    assert workflow["23"]["class_type"] == "VAEDecodeAudio"
    assert workflow["91"]["inputs"]["audio"] == ["23", 0]
    assert workflow["91"]["inputs"]["fps"] == GPU2_H3_FPS
    assert workflow["104"]["class_type"] == "MiniMaxH3ImageToVideo"
    assert workflow["104"]["inputs"]["first_frame"] == ["3", 0]
    assert workflow["104"]["inputs"]["length"] == gpu2_h3_length_frames(task)
    assert "last_frame" not in workflow["104"]["inputs"]
    assert prepared["workflow_name"] == "gpu2_minimax_h3_fl2va"
    assert prepared["params"]["preferred_comfyui_port"] == GPU2_H3_PORT
    assert GPU2_H3_PORT == GPU2_COMFYUI_PORT == 8188
    assert prepared["params"]["strict_preferred_comfyui_port"] is True
    assert prepared["params"]["gpu2_runtime_profile"] == "h3"


def test_gpu2_minimax_h3_sageattention_only_rewires_model_attention():
    task = {
        "task_type": "i2v",
        "params": {
            "model": "MiniMaxH3",
            "image_path": "first.png",
            "prompt": "same prompt",
            "duration": 15,
            "seed": 77,
        },
        "files": [{"param": "image_path", "filename": "first.png"}],
    }

    baseline = build_gpu2_minimax_h3_fl2va_workflow(task)
    accelerated = build_gpu2_minimax_h3_fl2va_workflow(
        task, enable_sage_attention=True
    )

    assert accelerated["7"] == {
        "class_type": "PathchSageAttentionKJ",
        "inputs": {
            "model": ["6", 0],
            "sage_attention": "auto",
            "allow_compile": True,
        },
    }
    assert accelerated["8"] == {
        "class_type": "MiniMaxH3MemoryEfficientSageAttentionPatch",
        "inputs": {"model": ["7", 0]},
    }
    assert accelerated["9"]["inputs"]["model"] == ["8", 0]
    assert accelerated["16"]["inputs"]["model"] == ["8", 0]
    for node_id in ("3", "9", "17", "104"):
        baseline_inputs = dict(baseline[node_id]["inputs"])
        accelerated_inputs = dict(accelerated[node_id]["inputs"])
        baseline_inputs.pop("model", None)
        accelerated_inputs.pop("model", None)
        assert accelerated_inputs == baseline_inputs


def test_gpu2_minimax_h3_sageattention_preserves_data_payload_on_prepare():
    task = {
        "task_type": "i2v",
        "data": {
            "model": "MiniMaxH3",
            "image_path": "first.png",
            "prompt": "preserve this prompt",
            "duration": 15,
            "seed": 77,
            "h3_sage_attention": True,
        },
        "files": [{"param": "image_path", "filename": "first.png"}],
    }

    prepared = prepare_gpu2_task(task)
    accelerated = build_gpu2_minimax_h3_fl2va_workflow(
        prepared, enable_sage_attention=True
    )

    assert gpu2_h3_sage_attention_requested(task) is True
    assert prepared["params"]["prompt"] == "preserve this prompt"
    assert prepared["params"]["duration"] == 15
    assert prepared["params"]["seed"] == 77
    assert accelerated["104"]["inputs"]["prompt"] == "preserve this prompt"
    assert accelerated["15"]["inputs"]["noise_seed"] == 77
    assert accelerated["104"]["inputs"]["length"] == gpu2_h3_length_frames(task)


def test_gpu2_h3_sageattention_requires_marker_and_live_nodes(tmp_path, monkeypatch):
    marker = tmp_path / "h3-sageattention-ready.json"
    monkeypatch.setenv("MECHA_GPU_H3_SAGE_ATTENTION", "1")

    ready, reason = gpu2_h3_sage_attention_ready(
        marker_path=marker, object_info_reader=lambda: {}
    )
    assert ready is False
    assert "marker unavailable" in reason

    marker.write_text(json.dumps({
        "verified": True,
        "sageattention_version": "2.2.0",
        "cuda_arch": "sm86",
        "kjnodes_commit": GPU2_H3_KJNODES_COMMIT,
    }), encoding="utf-8")
    ready, reason = gpu2_h3_sage_attention_ready(
        marker_path=marker,
        object_info_reader=lambda: {
            "PathchSageAttentionKJ": {},
            "MiniMaxH3MemoryEfficientSageAttentionPatch": {},
        },
    )
    assert (ready, reason) == (True, "verified")


def test_gpu2_minimax_h3_long_video_builds_serialized_director_groups():
    task = {
        "task_type": "i2v",
        "params": {
            "model": "MiniMaxH3",
            "image_path": "first.png",
            "h3_long_video": True,
            "h3_long_video_segments": [
                {
                    "prompt": "continue walking",
                    "duration": 5,
                    "image_path": "first.png",
                    "image_path_end": "first_end.png",
                },
                {
                    "prompt": "turn and wave",
                    "duration": 7,
                    "image_path": "second.png",
                },
            ],
            "seed": 77,
        },
    }

    workflow = build_gpu2_minimax_h3_long_video_workflow(task)
    timeline = json.loads(workflow["81"]["inputs"]["timeline_data"])

    assert gpu2_h3_long_video_requested(task) is True
    assert workflow["g0"]["inputs"]["first_frame"] == ["l0f", 0]
    assert workflow["g0"]["inputs"]["last_frame"] == ["l0l", 0]
    assert workflow["g1"]["inputs"]["first_frame"] == ["l1f", 0]
    assert "last_frame" not in workflow["g1"]["inputs"]
    assert workflow["80"]["inputs"] == {
        "groups.group_0": ["g0", 0],
        "groups.group_1": ["g1", 0],
    }
    assert workflow["81"]["class_type"] == "MiniMaxH3Director"
    assert workflow["81"]["inputs"]["clear_vram_between_segments"] is True
    assert workflow["81"]["inputs"]["steps"] == 25
    assert workflow["81"]["inputs"]["export_source_images"] is False
    assert workflow["91"]["inputs"]["fps"] == ["81", 2]
    assert timeline["output"]["continuityEnabled"] is True
    assert timeline["output"]["continuityOverlapFrames"] == 22
    assert timeline["segments"][1]["continuityFromPrev"] is True


def test_gpu2_h3_long_video_requires_exact_marker_nodes_and_no_conflicting_pack(
    tmp_path, monkeypatch
):
    marker = tmp_path / "h3-long-video-ready.json"
    monkeypatch.setenv("MECHA_GPU_H3_LONG_VIDEO", "1")
    marker.write_text(json.dumps({
        "verified": True,
        "director_commit": GPU2_H3_DIRECTOR_COMMIT,
        "inference_executed": False,
    }), encoding="utf-8")
    nodes = {
        "MiniMaxH3Director": {},
        "MiniMaxH3DirectorGroupImageToVideo": {},
        "MiniMaxH3DirectorGroupsCombine": {},
        "CreateVideo": {},
        "SaveVideo": {},
    }

    assert gpu2_h3_long_video_ready(
        marker_path=marker, object_info_reader=lambda: nodes
    ) == (True, "verified")
    nodes["MiniMaxH3MotionContext"] = {}
    ready, reason = gpu2_h3_long_video_ready(
        marker_path=marker, object_info_reader=lambda: nodes
    )
    assert ready is False
    assert "conflicts with Director" in reason


def test_gpu2_runtime_manager_stops_previous_profile_before_single_port_switch(tmp_path):
    wan = tmp_path / "wan.cmd"
    h3 = tmp_path / "h3.cmd"
    wan.write_text("@echo off\n", encoding="utf-8")
    h3.write_text("@echo off\n", encoding="utf-8")
    listening = [True]
    stopped = []
    launched = []

    def stop(profile):
        stopped.append(profile)
        listening[0] = False
        return True

    def launch(command):
        launched.append(command)
        listening[0] = True
        return True

    manager = Gpu2RuntimeManager(
        commands={"wan": wan, "h3": h3},
        listener=lambda _port: listening[0],
        stopper=stop,
        launcher=launch,
        sleeper=lambda _seconds: None,
    )
    manager.ensure("h3")

    assert stopped == ["wan"]
    assert launched == [h3]
    assert manager.active_profile == "h3"


def test_gpu2_model_release_gate_requires_three_consecutive_safe_samples():
    now = [0.0]
    released = []
    snapshots = iter([
        {"ram_free": 24 * GIB, "vram_total": 48 * GIB, "vram_free": 40 * GIB},
        {"ram_free": 24 * GIB, "vram_total": 48 * GIB, "vram_free": 40 * GIB},
        {"ram_free": 7 * GIB, "vram_total": 48 * GIB, "vram_free": 40 * GIB},
        {"ram_free": 24 * GIB, "vram_total": 48 * GIB, "vram_free": 40 * GIB},
        {"ram_free": 24 * GIB, "vram_total": 48 * GIB, "vram_free": 40 * GIB},
        {"ram_free": 24 * GIB, "vram_total": 48 * GIB, "vram_free": 40 * GIB},
    ])

    def sleep(seconds):
        now[0] += seconds

    gate = Gpu2ModelReleaseGate(
        release_request=lambda: released.append(True) or True,
        memory_reader=lambda: next(snapshots),
        sleeper=sleep,
        clock=lambda: now[0],
        timeout_seconds=30,
        poll_seconds=1,
        stable_samples=3,
        min_free_ram_gib=8,
        min_free_vram_gib=8,
    )
    assert gate.released is False
    gate.mark_models_loaded()

    assert gate.release_and_wait() is True
    assert gate.released is True
    assert released == [True]


def test_gpu2_model_release_gate_fails_closed_when_memory_does_not_release():
    now = [0.0]

    def sleep(seconds):
        now[0] += seconds

    gate = Gpu2ModelReleaseGate(
        release_request=lambda: True,
        memory_reader=lambda: {
            "ram_free": 20 * GIB,
            "vram_total": 48 * GIB,
            "vram_free": 12 * GIB,
        },
        sleeper=sleep,
        clock=lambda: now[0],
        timeout_seconds=3,
        poll_seconds=1,
        stable_samples=2,
        min_free_ram_gib=8,
        min_free_vram_gib=8,
    )
    gate.mark_models_loaded()

    assert gate.release_and_wait() is False
    assert gate.ensure_released() is False
    assert gate.released is False
    assert "RAM/VRAM baseline" in gate.last_error


def test_gpu2_model_release_gate_requires_pre_task_memory_recovery():
    now = [0.0]
    snapshots = iter([
        {"ram_free": 24 * GIB, "vram_total": 48 * GIB, "vram_free": 44 * GIB},
        {"ram_free": 19 * GIB, "vram_total": 48 * GIB, "vram_free": 42 * GIB},
        {"ram_free": 19 * GIB, "vram_total": 48 * GIB, "vram_free": 42 * GIB},
    ])

    def sleep(seconds):
        now[0] += seconds

    gate = Gpu2ModelReleaseGate(
        release_request=lambda: True,
        memory_reader=lambda: next(snapshots),
        sleeper=sleep,
        clock=lambda: now[0],
        timeout_seconds=1,
        poll_seconds=1,
        stable_samples=1,
        min_free_ram_gib=8,
        min_free_vram_gib=8,
        ram_tolerance_gib=4,
        vram_tolerance_gib=1,
    )
    gate.mark_models_loaded()

    assert gate.release_and_wait() is False
    assert gate.released is False


def test_gpu2_runtime_manager_blocks_next_task_until_release_gate_opens(tmp_path):
    wan = tmp_path / "wan.cmd"
    wan.write_text("@echo off\n", encoding="utf-8")
    attempts = []
    gate = Gpu2ModelReleaseGate(
        release_request=lambda: attempts.append(True) or False,
        memory_reader=lambda: None,
    )
    manager = Gpu2RuntimeManager(
        commands={"wan": wan},
        listener=lambda _port: True,
        model_gate=gate,
    )
    manager.mark_models_loaded()

    assert manager.release_models() is False
    assert manager.ready_for_next_task() is False
    assert attempts == [True, True]


def test_gpu2_runtime_manager_emergency_stop_targets_only_active_owned_profile(tmp_path):
    wan = tmp_path / "wan.cmd"
    h3 = tmp_path / "h3.cmd"
    wan.write_text("@echo off\n", encoding="utf-8")
    h3.write_text("@echo off\n", encoding="utf-8")
    stopped = []
    manager = Gpu2RuntimeManager(
        commands={"wan": wan, "h3": h3},
        listener=lambda _port: True,
        stopper=lambda profile: stopped.append(profile) or True,
    )
    manager.active_profile = "h3"

    assert manager.emergency_stop() is True
    assert stopped == ["h3"]
    assert manager.active_profile is None
    assert manager.model_gate.released is True


def test_gpu2_minimax_h3_preserves_first_and_last_frame_inputs():
    task = {
        "task_type": "morph",
        "params": {
            "model": "MiniMaxH3",
            "image_path": "first.png",
            "image_path_end": "last.png",
            "duration": 15,
        },
        "files": [
            {"param": "image_path", "filename": "first.png"},
            {"param": "image_path_end", "filename": "last.png"},
        ],
    }

    workflow = build_gpu2_minimax_h3_fl2va_workflow(task)

    assert workflow["1"]["inputs"]["image"] == "first.png"
    assert workflow["2"]["inputs"]["image"] == "last.png"
    assert workflow["3"]["inputs"]["image"] == ["1", 0]
    assert workflow["4"]["inputs"]["image"] == ["2", 0]
    assert workflow["104"]["inputs"]["first_frame"] == ["3", 0]
    assert workflow["104"]["inputs"]["last_frame"] == ["4", 0]
    assert gpu2_h3_duration_seconds(task) == 15
    assert gpu2_h3_length_frames(task) == 362


def test_gpu2_replaces_gpu1_ltx_baseline_when_stable_wan_operation_is_selected():
    task = {
        "task_type": "i2v",
        "workflow_name": "ltx_i2v",
        "params": {
            "model": "Wan2",
            "image_path": "start.png",
            "duration": 2,
        },
        "files": [{"param": "image_path", "filename": "start.png"}],
    }

    prepared = prepare_gpu2_task(task)

    assert is_gpu2_wan_i2v_task(task)
    assert prepared["workflow_name"] == "gpu2_wan21_i2v_low_vram"
    assert prepared["workflow_json"]["14"]["inputs"]["model"] == (
        GPU2_WAN_MODEL_FILES["diffusion"]
    )


def test_gpu2_accepts_explicit_wan_node_model_key():
    task = {
        "task_type": "i2v",
        "params": {
            "model": "WanNode2",
            "image_path": "start.png",
            "duration": 2,
        },
        "files": [{"param": "image_path", "filename": "start.png"}],
    }

    prepared = prepare_gpu2_task(task)

    assert is_gpu2_wan_i2v_task(task)
    assert prepared["workflow_name"] == "gpu2_wan21_i2v_low_vram"


def test_gpu2_wan_morph_preserves_start_and_end_images():
    task = {
        "task_type": "morph",
        "workflow_name": "wan2_morph",
        "params": {"start_image": "first.png", "end_image": "last.png", "duration": 2},
        "files": [
            {"param": "start_image", "filename": "first.png"},
            {"param": "end_image", "filename": "last.png"},
        ],
    }

    workflow = build_gpu2_wan_i2v_workflow(task)
    prepared = prepare_gpu2_task(task)

    assert workflow["20"]["inputs"]["image"] == "first.png"
    assert workflow["26"]["inputs"]["image"] == "last.png"
    assert workflow["22"]["inputs"]["end_image"] == ["27", 0]
    assert prepared["workflow_name"] == "gpu2_wan21_morph_low_vram"


def test_gpu2_wan_long_clip_is_split_and_reassembled_without_losing_duration():
    task = {
        "task_type": "i2v",
        "workflow_name": "wan2_i2v",
        "params": {
            "image": "start.png",
            "prompt": "slow camera push",
            "seed": 77,
            "duration": 5,
        },
    }

    workflow = build_gpu2_wan_i2v_workflow(task)

    assert gpu2_wan_duration_seconds(task) == 5
    assert gpu2_wan_total_frames(task) == 81
    assert gpu2_wan_chunk_frame_counts(task) == [33, 33, 17]
    assert workflow["22"]["inputs"]["num_frames"] == 33
    assert workflow["31"]["inputs"]["num_frames"] == 33
    assert workflow["41"]["inputs"]["num_frames"] == 17
    assert workflow["30"]["class_type"] == "ImageFromBatch"
    assert workflow["35"]["class_type"] == "ImageBatch"
    assert workflow["45"]["class_type"] == "ImageBatch"
    assert workflow["25"]["inputs"]["images"] == ["45", 0]


def test_gpu2_infinitetalk_uses_short_window_and_direct_audio_without_separation():
    task = {
        "task_type": "voice",
        "workflow_name": "video_infinitetalk",
        "params": {
            "video_filename": "speaker.mp4",
            "audio_filename": "speech.wav",
            "prompt_AU": "speak naturally",
            "duration": 5,
        },
        "files": [
            {"param": "video_filename", "filename": "speaker.mp4"},
            {"param": "audio_filename", "filename": "speech.wav"},
        ],
    }

    workflow = build_gpu2_infinitetalk_workflow(task)
    prepared = prepare_gpu2_task(task)
    class_types = {node["class_type"] for node in workflow.values()}

    assert is_gpu2_infinitetalk_task(task)
    assert workflow["30"]["inputs"]["video"] == "speaker.mp4"
    assert workflow["30"]["inputs"]["frame_load_cap"] == 1
    assert workflow["31"]["inputs"]["audio"] == "speech.wav"
    assert workflow["32"]["inputs"]["model"] == GPU2_WAN_MODEL_FILES["infinitetalk"]
    assert workflow["37"]["class_type"] == "Wav2VecModelLoader"
    assert workflow["37"]["inputs"]["model"] == GPU2_WAN_MODEL_FILES["wav2vec"]
    assert workflow["36"]["inputs"]["frame_window_size"] == GPU2_WAN_FRAMES
    assert workflow["31"]["inputs"]["duration"] == 5
    assert workflow["38"]["inputs"]["num_frames"] == 5 * 16
    assert workflow["41"]["inputs"]["audio"] == ["31", 0]
    assert "AudioSeparation" not in class_types
    assert "easy cleanGpuUsed" not in class_types
    assert prepared["workflow_name"] == "gpu2_infinitetalk_wan21_low_vram"


def test_gpu2_infinitetalk_normalizes_random_seed_sentinel():
    workflow = build_gpu2_infinitetalk_workflow(
        {
            "task_type": "voice",
            "params": {
                "video_filename": "speaker.mp4",
                "audio_filename": "speech.wav",
                "seed": -1,
            },
        }
    )

    assert workflow["39"]["inputs"]["seed"] >= 0


def test_gpu2_infinitetalk_keeps_small_window_but_scales_total_frames_with_duration():
    task = {
        "task_type": "voice",
        "params": {
            "video_filename": "speaker.mp4",
            "audio_filename": "speech.wav",
            "duration": 9.5,
        },
    }

    workflow = build_gpu2_infinitetalk_workflow(task)

    assert gpu2_infinitetalk_duration_seconds(task) == 9.5
    assert gpu2_infinitetalk_total_frames(task) == 152
    assert workflow["36"]["inputs"]["frame_window_size"] == GPU2_WAN_FRAMES
    assert workflow["38"]["inputs"]["num_frames"] == 152
    assert workflow["31"]["inputs"]["duration"] == 9.5


def test_gpu2_upscale_workflow_uses_low_vram_seedvr2_nodes():
    workflow = build_gpu2_upscale_workflow(
        {
            "params": {"image_path": "input.webp", "seed_0": 123},
            "files": [{"filename": "input.webp", "url": "/api/files/file_1/download"}],
        }
    )

    assert workflow["1"]["inputs"]["image"] == "input.webp"
    assert workflow["2"]["inputs"]["blocks_to_swap"] == 36
    assert workflow["2"]["inputs"]["cache_model"] is False
    assert workflow["3"]["inputs"]["decode_tiled"] is True
    assert workflow["3"]["inputs"]["cache_model"] is False
    assert workflow["4"]["inputs"]["batch_size"] == 1
    assert workflow["4"]["inputs"]["seed"] == 123
    assert workflow["4"]["inputs"]["resolution"] == GPU2_IMAGE_UPSCALE_TARGET
    assert workflow["4"]["inputs"]["max_resolution"] == GPU2_IMAGE_UPSCALE_MAX_RESOLUTION
    assert GPU2_IMAGE_UPSCALE_TARGET >= 3840
    assert workflow["5"]["class_type"] == "SaveImage"


def test_gpu2_only_rewrites_upscale_hd_and_qwen_compatible_tasks():
    original = {"task_type": "unrelated", "workflow_json": {"a": {"class_type": "Original"}}}

    prepared = prepare_gpu2_task(original)

    assert prepared == original
    assert prepared is not original


def test_gpu2_video_upscale_uses_serial_seedvr2_and_preserves_audio():
    task = {
        "task_type": "upscale",
        "params": {"video_filename": "clip.mp4", "seed": 456, "resolution": 900},
        "files": [
            {
                "param": "video_filename",
                "filename": "clip.mp4",
                "url": "/api/files/file_video/download",
            }
        ],
    }

    workflow = build_gpu2_video_upscale_workflow(task)
    prepared = prepare_gpu2_task(task)

    assert workflow["1"]["inputs"]["video"] == "clip.mp4"
    assert workflow["2"]["inputs"]["model"] == "seedvr2_ema_3b_fp8_e4m3fn.safetensors"
    assert workflow["3"]["inputs"]["offload_device"] == "cpu"
    assert workflow["4"]["inputs"]["batch_size"] == 1
    assert workflow["4"]["inputs"]["resolution"] == 900
    assert workflow["5"]["inputs"]["audio"] == ["1", 2]
    assert workflow["5"]["inputs"]["format"] == "video/h264-mp4"
    assert prepared["workflow_name"] == "gpu2_video_upscale_seedvr2"


def test_gpu2_video_resolution_accepts_frontend_labels_and_caps_large_targets():
    assert normalize_gpu2_video_resolution("360P") == 360
    assert normalize_gpu2_video_resolution("1080P") == 1080
    assert normalize_gpu2_video_resolution("2K") == 1080
    assert normalize_gpu2_video_resolution("4K") == 1080
    assert normalize_gpu2_video_resolution("unexpected") == 720


def test_gpu2_h3_720p_request_is_explicit_only():
    assert gpu2_h3_upscale_720p_requested({"params": {"h3_upscale_720p": True}}) is True
    assert gpu2_h3_upscale_720p_requested({"params": {}}) is False


def test_gpu2_h3_720p_postprocess_unloads_before_upscaler(tmp_path):
    source = tmp_path / "h3.mp4"
    source.write_bytes(b"video")
    events = []

    class _Gate:
        last_error = ""

    class _Runtime:
        model_gate = _Gate()

        def release_models(self):
            events.append("release_h3")
            return True

        def ensure(self, profile):
            events.append(f"ensure_{profile}")

        def mark_models_loaded(self):
            events.append("mark_seedvr_loaded")

    class _Resources:
        last_error = ""

        def ready_for_new_task(self):
            events.append("resource_gate")
            return True

    class _Agent:
        def _upload_to_comfyui(self, port, path):
            events.append(f"upload_{port}")
            assert path == str(source)
            return "h3.mp4"

    def _execute(task):
        events.append("execute_upscale")
        assert task["workflow_name"] == "gpu2_h3_post_upscale_720p"
        assert task["workflow_json"]["4"]["inputs"]["resolution"] == 720
        return {"status": "completed", "output_files": ["upscaled.mp4"]}

    result = execute_gpu2_h3_post_upscale_720p(
        agent=_Agent(),
        runtime_manager=_Runtime(),
        resource_controller=_Resources(),
        execute_workflow=_execute,
        generation_result={"status": "completed", "output_files": [str(source)]},
        params={"seed": 123},
    )

    assert events == [
        "release_h3",
        "resource_gate",
        "ensure_wan",
        f"upload_{GPU2_COMFYUI_PORT}",
        "mark_seedvr_loaded",
        "execute_upscale",
    ]
    assert result["result_payload"]["h3_upscale_720p_completed"] is True
    assert result["result_payload"]["upscale_resolution"] == "1280x720"


def test_gpu2_h3_720p_postprocess_fails_closed_when_h3_does_not_unload(tmp_path):
    source = tmp_path / "h3.mp4"
    source.write_bytes(b"video")

    class _Runtime:
        model_gate = type("Gate", (), {"last_error": "still loaded"})()

        def release_models(self):
            return False

    with pytest.raises(RuntimeError, match="did not fully unload"):
        execute_gpu2_h3_post_upscale_720p(
            agent=object(),
            runtime_manager=_Runtime(),
            resource_controller=object(),
            execute_workflow=lambda _task: {},
            generation_result={"status": "completed", "output_files": [str(source)]},
            params={},
        )


def test_gpu2_qwen_compatibility_covers_frontend_image_workflows():
    for task_type in (
        "qwen_1",
        "qwen_lora_6",
        "qwenN_3",
        "qwenN_lora_2",
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
        "panorama_fusion_3",
        "auto_storyboard",
    ):
        assert is_gpu2_qwen_compatible_task(task_type)


def test_gpu2_builds_executable_qwen_fallback_for_placeholder_workflow():
    task = {
        "task_type": "qwenN_lora_6",
        "params": {
            "image_path_1": "first.png",
            "image_path_2": "second.png",
            "image_path_3": "third.png",
            "image_path_4": "fourth.png",
            "prompt": "keep the same subject",
            "seed": 123,
        },
        "workflow_json": {"1": {"class_type": "PlaceholderNode"}},
    }

    workflow = build_gpu2_qwen_workflow(task)
    prepared = prepare_gpu2_task(task)

    assert workflow["37"]["inputs"]["unet_name"] == GPU2_QWEN_MODEL_FILES["diffusion"]
    assert workflow["38"]["inputs"]["clip_name"] == GPU2_QWEN_MODEL_FILES["text_encoder"]
    assert workflow["121"]["inputs"] == {"width": 768, "height": 768, "batch_size": 1}
    assert workflow["111"]["inputs"]["prompt"] == "keep the same subject"
    assert workflow["111"]["inputs"]["image1"] == ["401", 0]
    assert workflow["111"]["inputs"]["image3"] == ["403", 0]
    assert "image4" not in workflow["111"]["inputs"]
    assert {
        node["inputs"]["image"]
        for node in workflow.values()
        if node.get("class_type") == "LoadImage"
    } == {"first.png", "second.png", "third.png", "fourth.png"}
    assert workflow["303"]["class_type"] == "ImageStitch"
    assert prepared["workflow_name"] == "gpu2_qwenn_lora_6_qwen_fp8"
    assert prepared["workflow_json"]["60"]["class_type"] == "SaveImage"


def test_gpu2_qwen_fallback_uses_requested_safe_geometry_and_legacy_image_names():
    workflow = build_gpu2_qwen_workflow(
        {
            "task_type": "panorama_fusion_3",
            "params": {
                "uploaded_image_BK": "background.png",
                "uploaded_image_HU": "subject.png",
                "output_width": 1025,
                "output_height": 509,
            },
        }
    )

    assert normalize_gpu2_image_dimensions(1025, 509) == (1024, 504)
    assert workflow["121"]["inputs"] == {"width": 1024, "height": 504, "batch_size": 1}
    assert workflow["111"]["inputs"]["image1"] == ["401", 0]
    assert workflow["111"]["inputs"]["image2"] == ["402", 0]
    assert workflow["401"]["inputs"]["scale_to_length"] == 1024
    assert normalize_gpu2_image_dimensions(1928, 1080) == (1024, 568)


def test_gpu2_qwen_six_reference_workflow_keeps_every_input_via_three_stitches():
    workflow = build_gpu2_qwen_workflow(
        {
            "task_type": "qwen_6",
            "params": {
                **{f"image_path_{index}": f"reference-{index}.png" for index in range(1, 7)},
                "prompt": "preserve every reference",
                "output_width": 1024,
                "output_height": 768,
            },
        }
    )

    loaded = [
        node["inputs"]["image"]
        for node in workflow.values()
        if node.get("class_type") == "LoadImage"
    ]
    stitched = [
        node
        for node in workflow.values()
        if node.get("class_type") == "ImageStitch"
    ]

    assert loaded == [f"reference-{index}.png" for index in range(1, 7)]
    assert len(stitched) == 3
    assert workflow["111"]["inputs"]["image1"] == ["401", 0]
    assert workflow["111"]["inputs"]["image2"] == ["402", 0]
    assert workflow["111"]["inputs"]["image3"] == ["403", 0]


def test_gpu2_human_multi_angle_splits_fourteen_views_without_growing_batch_vram():
    workflow = build_gpu2_qwen_workflow(
        {
            "task_type": "i2i_human",
            "params": {
                "image_path": "character.png",
                "seed": 700,
            },
        }
    )

    save_nodes = [
        node
        for node in workflow.values()
        if node.get("class_type") == "SaveImage"
    ]
    sampler_nodes = [
        node
        for node in workflow.values()
        if node.get("class_type") == "KSampler"
    ]
    positive_prompt_ids = {
        node["inputs"]["positive"][0]
        for node in sampler_nodes
    }
    prompts = {
        workflow[node_id]["inputs"]["prompt"]
        for node_id in positive_prompt_ids
    }

    assert len(save_nodes) == len(GPU2_HUMAN_ANGLE_PROMPTS) == 14
    assert len(sampler_nodes) == 14
    assert workflow["121"]["inputs"]["batch_size"] == 1
    assert prompts == set(GPU2_HUMAN_ANGLE_PROMPTS)
    assert {node["inputs"]["seed"] for node in sampler_nodes} == set(range(700, 714))


def test_gpu2_matting_uses_native_birefnet_and_split_has_two_outputs():
    task = {
        "task_type": "qwen_1",
        "params": {"image_path": "subject.png", "gpu2_operation": "matting_split"},
        "workflow_json": {"1": {"class_type": "PlaceholderNode"}},
    }

    workflow = build_gpu2_matting_workflow(task, split=True)
    prepared = prepare_gpu2_task(task)

    assert workflow["2"]["inputs"]["bg_removal_name"] == GPU2_BACKGROUND_REMOVAL_MODEL
    assert workflow["3"]["class_type"] == "RemoveBackground"
    assert workflow["5"]["class_type"] == "SaveImage"
    assert workflow["8"]["class_type"] == "SaveImage"
    assert prepared["workflow_name"] == "gpu2_matting_split_birefnet"
    assert prepared["workflow_json"]["6"]["class_type"] == "InvertMask"


def test_gpu2_angle_adjustment_does_not_require_private_angle_lora():
    prepared = prepare_gpu2_task(
        {
            "task_type": "i2i_fj",
            "params": {"image_path": "angle.png", "prompt": "left profile"},
            "workflow_json": {
                "119": {
                    "class_type": "LoraLoaderModelOnly",
                    "inputs": {"lora_name": "duojiaodu.safetensors"},
                }
            },
        }
    )

    lora_names = {
        node["inputs"]["lora_name"]
        for node in prepared["workflow_json"].values()
        if node.get("class_type") == "LoraLoaderModelOnly"
    }
    assert lora_names == {GPU2_QWEN_MODEL_FILES["lora"]}


def test_gpu2_around_angle_rewrites_canonical_task_to_low_vram_qwen():
    prepared = prepare_gpu2_task(
        {
            "task_type": "i2i_around",
            "params": {
                "image_path": "scene.png",
                "prompt": "rotate to the rear-right quarter view",
                "seed": 123,
            },
        }
    )

    assert prepared["workflow_name"] == "gpu2_i2i_around_qwen_fp8"
    assert prepared["workflow_json"]["37"]["inputs"]["unet_name"] == (
        GPU2_QWEN_MODEL_FILES["diffusion"]
    )
    assert prepared["workflow_json"]["201"]["inputs"]["image"] == "scene.png"
    assert "rear-right quarter view" in prepared["workflow_json"]["111"]["inputs"]["prompt"]


def test_gpu2_qwen_workflow_uses_fp8_models_and_single_batch():
    original = {
        "37": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "Qwen_Image_Edit_2509_bf16.safetensors"},
        },
        "38": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": "qwen_2.5_vl_7b.safetensors", "type": "qwen_image"},
        },
        "39": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "qwen_image_vae.safetensors"},
        },
        "89": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"lora_name": "Qwen-Image-Lightning-4steps-V2.0.safetensors"},
        },
        "121": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1928, "height": 1080, "batch_size": 4},
        },
    }

    tuned = tune_gpu2_qwen_workflow(original)

    assert tuned["37"]["inputs"]["unet_name"] == GPU2_QWEN_MODEL_FILES["diffusion"]
    assert tuned["38"]["inputs"]["clip_name"] == GPU2_QWEN_MODEL_FILES["text_encoder"]
    assert tuned["39"]["inputs"]["vae_name"] == GPU2_QWEN_MODEL_FILES["vae"]
    assert tuned["89"]["inputs"]["lora_name"] == GPU2_QWEN_MODEL_FILES["lora"]
    assert tuned["121"]["inputs"]["batch_size"] == 1
    assert original["121"]["inputs"]["batch_size"] == 4


def test_gpu2_preserves_non_qwen_workflow():
    original = {
        "1": {"class_type": "EmptyLatentImage", "inputs": {"batch_size": 4}},
        "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
    }

    tuned = tune_gpu2_qwen_workflow(original)

    assert tuned == original
    assert tuned is not original
