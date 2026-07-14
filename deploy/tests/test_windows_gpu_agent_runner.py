from scripts.windows_gpu_agent_runner import (
    GPU2_BACKGROUND_REMOVAL_MODEL,
    GPU2_QWEN_MODEL_FILES,
    GPU2_WAN_BLOCKS_TO_SWAP,
    GPU2_WAN_FRAMES,
    GPU2_WAN_HEIGHT,
    GPU2_WAN_MODEL_FILES,
    GPU2_WAN_WIDTH,
    build_gpu2_infinitetalk_workflow,
    build_gpu2_matting_workflow,
    build_gpu2_qwen_workflow,
    build_gpu2_upscale_workflow,
    build_gpu2_video_upscale_workflow,
    build_gpu2_wan_i2v_workflow,
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


def test_gpu2_wan_morph_preserves_start_and_end_images():
    task = {
        "task_type": "morph",
        "workflow_name": "wan2_morph",
        "params": {"start_image": "first.png", "end_image": "last.png"},
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


def test_gpu2_infinitetalk_uses_short_window_and_direct_audio_without_separation():
    task = {
        "task_type": "voice",
        "workflow_name": "video_infinitetalk",
        "params": {
            "video_filename": "speaker.mp4",
            "audio_filename": "speech.wav",
            "prompt_AU": "speak naturally",
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
    assert workflow["38"]["inputs"]["num_frames"] == GPU2_WAN_FRAMES
    assert workflow["41"]["inputs"]["audio"] == ["31", 0]
    assert "AudioSeparation" not in class_types
    assert "easy cleanGpuUsed" not in class_types
    assert prepared["workflow_name"] == "gpu2_infinitetalk_wan21_low_vram"


def test_gpu2_upscale_workflow_uses_low_vram_seedvr2_nodes():
    workflow = build_gpu2_upscale_workflow(
        {
            "params": {"image_path": "input.webp", "seed_0": 123},
            "files": [{"filename": "input.webp", "url": "/api/files/file_1/download"}],
        }
    )

    assert workflow["1"]["inputs"]["image"] == "input.webp"
    assert workflow["2"]["inputs"]["blocks_to_swap"] == 0
    assert workflow["3"]["inputs"]["decode_tiled"] is True
    assert workflow["4"]["inputs"]["batch_size"] == 1
    assert workflow["4"]["inputs"]["seed"] == 123
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
    assert workflow["111"]["inputs"]["image1"] == ["126", 0]
    assert workflow["111"]["inputs"]["image3"] == ["128", 0]
    assert "image4" not in workflow["111"]["inputs"]
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
    assert workflow["111"]["inputs"]["image1"] == ["126", 0]
    assert workflow["111"]["inputs"]["image2"] == ["127", 0]
    assert workflow["126"]["inputs"]["scale_to_length"] == 1024


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
