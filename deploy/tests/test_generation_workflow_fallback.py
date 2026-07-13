from routers.generation import resolve_executable_comfyui_workflow_type


def test_qwenn_empty_workflows_fall_back_to_qwen_family():
    assert resolve_executable_comfyui_workflow_type("qwenN", 3) == ("qwen_3", True)
    assert resolve_executable_comfyui_workflow_type("qwenN_lora", 6) == ("qwen_lora_6", True)


def test_workflow_fallback_clamps_reference_count_and_preserves_real_workflows():
    assert resolve_executable_comfyui_workflow_type("qwen", 0) == ("qwen_1", False)
    assert resolve_executable_comfyui_workflow_type("qwen_lora", 9) == ("qwen_lora_6", False)
    assert resolve_executable_comfyui_workflow_type("kontext", 2) == ("kontext", False)
