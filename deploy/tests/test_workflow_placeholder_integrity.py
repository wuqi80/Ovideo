# -*- coding: utf-8 -*-
import json
from pathlib import Path
from typing import Any

import pytest

from pipeline.workflow_config import WORKFLOW_CONFIGS
from pipeline.workflow_handler import WorkflowHandler


KNOWN_INCOMPLETE_WORKFLOWS = {
    "smooth_i2v",
    "smooth_morph",
    "dawasi_i2v",
    "dawasi_morph",
    "hunyuan_i2v",
    "ltx_i2v",
    "turbo22_i2v",
    "turbo21_i2v",
    "svdwan_i2v",
    "three_view",
}


def _workflow_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        strings: list[str] = []
        for child in value.values():
            strings.extend(_workflow_strings(child))
        return strings
    if isinstance(value, list):
        strings: list[str] = []
        for child in value:
            strings.extend(_workflow_strings(child))
        return strings
    return []


def _placeholder_names(workflow_json: dict[str, Any]) -> set[str]:
    return {
        value[1:-1]
        for value in _workflow_strings(workflow_json)
        if value.startswith("{") and value.endswith("}")
    }


def test_configured_workflow_placeholders_exist_in_disk_json():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    missing_by_key: dict[str, list[str]] = {}

    for key, cfg in WORKFLOW_CONFIGS.items():
        if key in KNOWN_INCOMPLETE_WORKFLOWS or not cfg.file:
            continue

        path = workflow_dir / cfg.file
        workflow_json = json.loads(path.read_text(encoding="utf-8"))
        configured = set(cfg.placeholders or [])
        present = _placeholder_names(workflow_json)
        missing = sorted(configured - present)
        if missing:
            missing_by_key[key] = missing

    assert missing_by_key == {}


def test_workflow_disk_fallback_is_case_insensitive_on_linux_style_names(tmp_path):
    template = {
        "1": {
            "class_type": "LoadImage",
            "inputs": {"image": "{image}"},
        }
    }
    path = tmp_path / "LTX_i2v.json"
    path.write_text(json.dumps(template), encoding="utf-8")

    handler = WorkflowHandler(str(tmp_path))

    assert handler.get_workflow("ltx_i2v") == template


@pytest.mark.parametrize(
    "workflow_name",
    [
        *(f"qwen_{index}" for index in range(1, 7)),
        *(f"qwenN_{index}" for index in range(1, 7)),
        *(f"qwen_lora_{index}" for index in range(1, 7)),
    ],
)
def test_gpu1_qwen_templates_use_verified_model_directories(workflow_name):
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    workflow = json.loads(
        (workflow_dir / f"{workflow_name}.json").read_text(encoding="utf-8")
    )

    assert workflow["37"]["inputs"]["unet_name"] == (
        "qwen/qwen_image_edit_2509_bf16.safetensors"
    )
    assert workflow["89"]["inputs"]["lora_name"] == (
        "Qwen/Qwen-Image-Lightning-4steps-V2.0.safetensors"
    )


def test_gpu1_angle_template_uses_verified_models_and_safe_canvas_width():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    workflow = json.loads((workflow_dir / "I2I_FJ.json").read_text(encoding="utf-8"))

    assert workflow["37"]["inputs"]["unet_name"] == (
        "qwen/qwen_image_edit_2509_fp8_e4m3fn.safetensors"
    )
    assert workflow["89"]["inputs"]["lora_name"] == (
        "Qwen/Qwen-Image-Lightning-4steps-V2.0-bf16.safetensors"
    )
    assert workflow["119"]["inputs"]["lora_name"] == (
        "Qwen/Qwen-Edit-2509-Multiple-angles.safetensors"
    )
    assert workflow["121"]["inputs"]["width"] == 1920


def test_gpu1_around_template_is_a_full_angle_generation_workflow():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    workflow = json.loads((workflow_dir / "I2I_Around.json").read_text(encoding="utf-8"))

    assert workflow["37"]["inputs"]["unet_name"] == (
        "qwen/qwen_image_edit_2509_fp8_e4m3fn.safetensors"
    )
    assert workflow["119"]["inputs"]["lora_name"] == (
        "Qwen/Qwen-Edit-2509-Multiple-angles.safetensors"
    )
    assert workflow["78"]["inputs"]["image"] == "{image}"
    assert workflow["111"]["inputs"]["prompt"] == "{prompt}"
    assert workflow["3"]["inputs"]["seed"] == "{seed}"


def test_gpu1_upscale_template_uses_verified_tiled_graph_and_4k_target():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    workflow = json.loads((workflow_dir / "upscale_hd.json").read_text(encoding="utf-8"))

    assert workflow["109"]["inputs"]["model"] == "seedvr2_ema_3b_fp8_e4m3fn.safetensors"
    assert workflow["108"]["class_type"] == "SeedVR2VideoUpscaler"
    assert workflow["103"]["inputs"]["value"] == 4
    assert workflow["112"]["inputs"]["expression"] == "a*1024"


def test_gpu1_human_template_is_full_fourteen_angle_workflow():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    workflow = json.loads((workflow_dir / "I2I_HUMAN.json").read_text(encoding="utf-8"))

    prompts = workflow["82"]["inputs"]["text"].splitlines()
    assert len(prompts) == 14
    assert workflow["77"]["inputs"]["unet_name"] == (
        "qwen/qwen_image_edit_2509_fp8_e4m3fn_scaled.safetensors"
    )
    assert workflow["125"]["inputs"]["lora_name"] == (
        "Qwen/Qwen-Edit-2509-Multiple-angles.safetensors"
    )
    assert workflow["80"]["class_type"] == "SaveImage"


def test_gpu1_watermark_template_is_full_detection_and_inpaint_workflow():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    workflow = json.loads(
        (workflow_dir / "remove_watermark.json").read_text(encoding="utf-8")
    )
    class_types = {node["class_type"] for node in workflow.values()}

    assert "Florence2Run" in class_types
    assert "SamplerCustomAdvanced" in class_types
    assert "ImageCompositeMasked" in class_types
    assert workflow["117:3"]["inputs"]["unet_name"] == (
        "flux/flux-2-klein-4b.safetensors"
    )
    assert workflow["118:111"]["inputs"]["noise_seed"] == "{seed}"


def test_database_upscale_template_is_normalized_to_4k_without_mutating_source():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    handler = WorkflowHandler(str(workflow_dir))
    database_workflow = json.loads(
        (workflow_dir / "upscale_hd.json").read_text(encoding="utf-8")
    )
    database_workflow["103"]["inputs"]["value"] = 6

    rendered = handler.build_workflow_for_task(
        "upscale_hd",
        {"uploaded_image": "input.png", "seed": 123},
        workflow_override=database_workflow,
    )

    assert rendered["103"]["inputs"]["value"] == 4
    assert database_workflow["103"]["inputs"]["value"] == 6


def test_ltx_database_template_uses_requested_duration_without_mutating_source():
    workflow = {
        "fps": {
            "class_type": "PrimitiveInt",
            "inputs": {"value": 24},
        },
        "duration": {
            "class_type": "PrimitiveInt",
            "inputs": {"value": 10},
        },
        "frames": {
            "class_type": "MathExpression|pysssss",
            "inputs": {
                "a": ["duration", 0],
                "b": ["fps", 0],
                "expression": "a*b+1",
            },
        },
    }

    rendered = WorkflowHandler.apply_ltx_duration_contract(
        json.loads(json.dumps(workflow)),
        "ltx_i2v",
        3,
    )

    assert rendered["duration"]["inputs"]["value"] == 3
    assert workflow["duration"]["inputs"]["value"] == 10


def test_stable_wan_operation_id_routes_to_node_specific_verified_engines():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    handler = WorkflowHandler(str(workflow_dir))

    assert handler.resolve_workflow_name("i2v", {"model": "Wan2"}) == "ltx_i2v"
    assert handler.resolve_workflow_name("morph", {"model": "Wan2"}) == "ltx_morph"

    morph = handler.build_workflow_for_task(
        "morph",
        {
            "model": "Wan2",
            "uploaded_image": "first.png",
            "uploaded_image_end": "last.png",
            "prompt": "transition smoothly",
            "duration": 3,
            "seed": 123,
        },
    )

    assert morph["98"]["inputs"]["image"] == "first.png"
    assert morph["229"]["inputs"]["image"] == "last.png"
    assert morph["228"]["inputs"]["value"] == 3
    assert morph["232"]["inputs"]["frame_idx"] == -1
    assert morph["233"]["inputs"]["frame_idx"] == -1


def test_single_image_qwen_template_accepts_legacy_image_param():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    handler = WorkflowHandler(str(workflow_dir))

    workflow = handler.build_workflow_for_task(
        "qwen_1",
        {
            "uploaded_image": "single-reference.png",
            "prompt": "preserve the subject",
            "seed": 123,
        },
    )

    assert workflow["78"]["inputs"]["image"] == "single-reference.png"


def test_database_qwen_template_legacy_model_paths_are_normalized_for_gpu1():
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    handler = WorkflowHandler(str(workflow_dir))
    legacy = json.loads((workflow_dir / "qwen_1.json").read_text(encoding="utf-8"))
    legacy["37"]["inputs"]["unet_name"] = "Qwen_Image_Edit_2509_bf16.safetensors"
    legacy["89"]["inputs"]["lora_name"] = "Qwen-Image-Lightning-4steps-V2.0.safetensors"

    workflow = handler.build_workflow_for_task(
        "qwen_1",
        {
            "uploaded_image_1": "single-reference.png",
            "prompt": "preserve the subject",
            "seed": 123,
        },
        workflow_override=legacy,
    )

    assert workflow["37"]["inputs"]["unet_name"] == (
        "qwen/qwen_image_edit_2509_bf16.safetensors"
    )
    assert workflow["89"]["inputs"]["lora_name"] == (
        "Qwen/Qwen-Image-Lightning-4steps-V2.0.safetensors"
    )
    assert legacy["37"]["inputs"]["unet_name"] == "Qwen_Image_Edit_2509_bf16.safetensors"
    assert legacy["89"]["inputs"]["lora_name"] == "Qwen-Image-Lightning-4steps-V2.0.safetensors"


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, 5), ("bad", 5), (0, 1), (8.5, 8.5), (20, 15)],
)
def test_wan_duration_is_normalized_before_rendering(value, expected):
    assert WorkflowHandler.normalize_video_duration(value) == expected


@pytest.mark.parametrize(
    ("task_type", "task_data", "expected"),
    [
        (
            "i2v",
            {
                "model": "Wan2",
                "uploaded_image": "start.png",
                "prompt": "a moving shot",
                "negative_prompt": "bad frame",
                "seed": 123,
                "duration": 14,
            },
            {
                "image": "start.png",
                "prompt": "a moving shot",
            },
        ),
        (
            "morph",
            {
                "model": "Wan2",
                "uploaded_image": "start.png",
                "uploaded_image_end": "end.png",
                "prompt": "transition",
                "negative_prompt": "bad transition",
                "seed": 456,
                "duration": 10,
            },
            {
                "start_image": "start.png",
                "end_image": "end.png",
                "prompt": "transition",
            },
        ),
    ],
)
def test_wan2_workflows_replace_runtime_placeholders(task_type, task_data, expected):
    workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
    handler = WorkflowHandler(str(workflow_dir))

    workflow = handler.build_workflow_for_task(task_type, task_data)
    rendered_strings = set(_workflow_strings(workflow))

    for value in expected.values():
        assert value in rendered_strings

    assert workflow["228"]["inputs"]["value"] == task_data["duration"]
    unresolved = {value for value in rendered_strings if value.startswith("{") and value.endswith("}")}
    assert unresolved == set()
