from pipeline.workflow_handler import WorkflowHandler


def test_apply_output_dimensions_updates_all_latent_sources_only():
    workflow = {
        "1": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1928, "height": 1080, "batch_size": 1},
        },
        "2": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1024, "height": 1024},
        },
        "3": {
            "class_type": "LoadImage",
            "inputs": {"image": "reference.png"},
        },
    }

    result = WorkflowHandler.apply_output_dimensions(workflow, 1344, 768)

    assert result["1"]["inputs"] == {"width": 1344, "height": 768, "batch_size": 1}
    assert result["2"]["inputs"] == {"width": 1344, "height": 768}
    assert result["3"]["inputs"] == {"image": "reference.png"}


def test_apply_output_dimensions_keeps_workflow_when_auto_values_are_missing():
    workflow = {
        "1": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1928, "height": 1080},
        },
    }

    result = WorkflowHandler.apply_output_dimensions(workflow, None, None)

    assert result["1"]["inputs"] == {"width": 1928, "height": 1080}
