from schemas.generation import (
    AngleAdjustRequest,
    MaterialProcessRequest,
    MattingRequest,
)


def test_comfyui_requests_preserve_preferred_agent_fields():
    common = {
        "preferred_agent_id": "agent_kunming",
        "preferred_node_id": "agent_kunming",
    }

    angle = AngleAdjustRequest(
        image_filename="input.png",
        prompt="front view",
        output_width=1024,
        output_height=576,
        **common,
    )
    matting = MattingRequest(image_filename="input.png", matting_type="subject", **common)
    material = MaterialProcessRequest(
        image_filename="input.png",
        workflow_type="image_upscale",
        target_long_edge=50000,
        dpi=300,
        text_clarity=True,
        **common,
    )

    for request in (angle, matting, material):
        payload = request.model_dump()
        assert payload["preferred_agent_id"] == "agent_kunming"
        assert payload["preferred_node_id"] == "agent_kunming"
    assert angle.model_dump()["output_width"] == 1024
    assert angle.model_dump()["output_height"] == 576
    assert material.model_dump()["target_long_edge"] == 50000
    assert material.model_dump()["dpi"] == 300
    assert material.model_dump()["text_clarity"] is True
