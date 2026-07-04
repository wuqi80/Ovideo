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
