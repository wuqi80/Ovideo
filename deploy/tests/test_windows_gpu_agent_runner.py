from scripts.windows_gpu_agent_runner import (
    GPU2_BACKGROUND_REMOVAL_MODEL,
    GPU2_IMAGE_UPSCALE_MAX_RESOLUTION,
    GPU2_IMAGE_UPSCALE_TARGET,
    GPU2_HUMAN_ANGLE_PROMPTS,
    GPU2_H3_FPS,
    GPU2_H3_HEIGHT,
    GPU2_H3_MODEL_FILES,
    GPU2_H3_PORT,
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
    build_gpu2_qwen_workflow,
    build_gpu2_upscale_workflow,
    build_gpu2_video_upscale_workflow,
    build_gpu2_wan_i2v_workflow,
    gpu2_infinitetalk_duration_seconds,
    gpu2_infinitetalk_total_frames,
    gpu2_h3_duration_seconds,
    gpu2_h3_length_frames,
    gpu2_wan_chunk_frame_counts,
    gpu2_wan_duration_seconds,
    gpu2_wan_total_frames,
    is_gpu2_h3_task,
    is_gpu2_infinitetalk_task,
    is_gpu2_qwen_compatible_task,
    is_gpu2_wan_i2v_task,
    normalize_gpu2_image_dimensions,
    normalize_gpu2_video_resolution,
    prepare_gpu2_task,
    tune_gpu2_qwen_workflow,
)


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


def test_gpu2_minimax_h3_routes_to_isolated_8189_sidecar_and_audio_video_nodes():
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
    assert prepared["params"]["strict_preferred_comfyui_port"] is True


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
