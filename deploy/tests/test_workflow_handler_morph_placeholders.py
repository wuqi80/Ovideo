from workflow_handler import WorkflowHandler


def test_morph_replaces_start_and_end_image_aliases(tmp_path):
    handler = WorkflowHandler(str(tmp_path))
    workflow = {
        "145": {
            "inputs": {"image": "{start_image}"},
            "class_type": "LoadImage",
        },
        "165": {
            "inputs": {"image": "{end_image}"},
            "class_type": "LoadImage",
        },
        "150": {
            "inputs": {"images": ["145", 0]},
            "class_type": "SaveImage",
        },
    }

    result = handler.build_workflow_for_task(
        "morph",
        {
            "model": "Wan2",
            "uploaded_image": "first_frame.png",
            "uploaded_image_end": "last_frame.png",
            "prompt": "move",
            "seed": 123456789012345,
        },
        workflow_override=workflow,
    )

    assert result["145"]["inputs"]["image"] == "first_frame.png"
    assert result["165"]["inputs"]["image"] == "last_frame.png"


def test_morph_replaces_legacy_image_filename_aliases(tmp_path):
    handler = WorkflowHandler(str(tmp_path))
    workflow = {
        "67": {
            "inputs": {"image": "{image_filename}"},
            "class_type": "LoadImage",
        },
        "114": {
            "inputs": {"image": "{image_filename_end}"},
            "class_type": "LoadImage",
        },
    }

    result = handler.build_workflow_for_task(
        "morph",
        {
            "model": "Wan2",
            "uploaded_image": "start.png",
            "uploaded_image_end": "end.png",
            "prompt": "move",
            "seed": 123456789012345,
        },
        workflow_override=workflow,
    )

    assert result["67"]["inputs"]["image"] == "start.png"
    assert result["114"]["inputs"]["image"] == "end.png"


def test_kontext_replaces_negative_prompt(tmp_path):
    handler = WorkflowHandler(str(tmp_path))
    workflow = {
        "1": {"inputs": {"image": "{image}"}, "class_type": "LoadImage"},
        "2": {"inputs": {"text": "{prompt}"}, "class_type": "CLIPTextEncode"},
        "3": {"inputs": {"text": "{negative_prompt}"}, "class_type": "CLIPTextEncode"},
    }

    result = handler.build_workflow_for_task(
        "kontext",
        {
            "uploaded_image": "ref.png",
            "prompt": "clean frame",
            "negative_prompt": "bad quality",
            "seed": 123456789012345,
        },
        workflow_override=workflow,
    )

    assert result["1"]["inputs"]["image"] == "ref.png"
    assert result["2"]["inputs"]["text"] == "clean frame"
    assert result["3"]["inputs"]["text"] == "bad quality"


def test_placeholder_node_template_is_not_executable(tmp_path):
    handler = WorkflowHandler(str(tmp_path))
    workflow = {
        "placeholder_node": {
            "inputs": {"image": "{image}"},
            "class_type": "PlaceholderNode",
        }
    }

    try:
        handler.build_workflow_for_task(
            "upscale_hd",
            {"uploaded_image": "ref.png", "seed_0": 123456},
            workflow_override=workflow,
        )
    except ValueError as exc:
        assert "不是可执行的处理工作流" in str(exc)
    else:
        raise AssertionError("placeholder workflow should not be executable")
