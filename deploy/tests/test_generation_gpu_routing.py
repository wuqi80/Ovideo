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

    angle = AngleAdjustRequest(image_filename="input.png", prompt="front view", **common)
    matting = MattingRequest(image_filename="input.png", matting_type="subject", **common)
    material = MaterialProcessRequest(
        image_filename="input.png",
        workflow_type="upscale_hd",
        **common,
    )

    for request in (angle, matting, material):
        payload = request.model_dump()
        assert payload["preferred_agent_id"] == "agent_kunming"
        assert payload["preferred_node_id"] == "agent_kunming"
