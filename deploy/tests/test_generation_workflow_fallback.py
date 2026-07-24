import json
from pathlib import Path

from routers.generation import (
    merge_angle_adjust_prompt,
    merge_gpu2_operation_prompt,
    resolve_executable_comfyui_workflow_type,
)


def test_qwenn_empty_workflows_fall_back_to_qwen_family():
    assert resolve_executable_comfyui_workflow_type("qwenN", 3) == ("qwen_3", True)
    assert resolve_executable_comfyui_workflow_type("qwenN_lora", 6) == ("qwen_lora_6", True)
    assert resolve_executable_comfyui_workflow_type("three_view", 1) == ("qwen_1", True)


def test_workflow_fallback_clamps_reference_count_and_preserves_real_workflows():
    assert resolve_executable_comfyui_workflow_type("qwen", 0) == ("qwen_1", False)
    assert resolve_executable_comfyui_workflow_type("qwen_lora", 9) == ("qwen_lora_6", False)
    assert resolve_executable_comfyui_workflow_type("kontext", 2) == ("kontext", False)


def test_placeholder_operation_prompt_preserves_user_direction():
    prompt = merge_gpu2_operation_prompt("panorama_360", "sunset lighting")

    assert "equirectangular" in prompt
    assert prompt.endswith("Additional direction: sunset lighting")


def test_angle_adjust_prompt_preserves_direction_and_requires_complete_subject():
    prompt = merge_angle_adjust_prompt("Rotate the camera 90 degrees to the left.")

    assert prompt.startswith("Rotate the camera 90 degrees to the left.")
    assert "top of the head through both feet fully inside the frame" in prompt
    assert "Reframe or zoom out as needed" in prompt
    assert "Do not crop the head" in prompt


def test_angle_adjust_prompt_uses_safe_default_when_direction_is_empty():
    prompt = merge_angle_adjust_prompt("")

    assert prompt.startswith("Adjust the camera angle slightly")
    assert "safe margin" in prompt


def test_angle_adjust_workflow_rejects_cropped_character_outputs():
    workflow_path = Path(__file__).resolve().parents[1] / "workflows" / "I2I_FJ.json"
    workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
    negative_prompt = workflow["110"]["inputs"]["prompt"]

    assert "头顶缺失" in negative_prompt
    assert "四肢缺失" in negative_prompt
    assert "主体贴边" in negative_prompt
    assert "站立姿势" not in negative_prompt
