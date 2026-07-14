from routers.generation import merge_gpu2_operation_prompt, resolve_executable_comfyui_workflow_type


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
