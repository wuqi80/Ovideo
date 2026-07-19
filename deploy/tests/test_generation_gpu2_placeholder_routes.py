from types import SimpleNamespace

import pytest

from routers.generation import create_generation_router
from schemas.generation import (
    AutoStoryboardRequest,
    HumanMultiAngleRequest,
    ImageFusionRequest,
    MattingRequest,
    PanoramaFusionRequest,
)


class RecordingTaskService:
    def __init__(self):
        self.calls = []

    async def submit(self, task_type, task_data, username):
        self.calls.append((task_type, task_data, username))
        return "task-test"


def build_router_and_service():
    service = RecordingTaskService()

    async def require_auth():
        return "tester"

    async def unused_generate(*args, **kwargs):
        raise AssertionError("Gemini should not be called")

    async def allow_generation(*args, **kwargs):
        return {"project_id": "", "episode_id": ""}

    router = create_generation_router(
        require_auth_dependency=require_auth,
        task_service_module=SimpleNamespace(get=lambda: service),
        generate_gemini_images=unused_generate,
        file_dao=SimpleNamespace(),
        logger=SimpleNamespace(info=lambda *args: None, warning=lambda *args: None, error=lambda *args: None),
        generation_access_checker=allow_generation,
    )
    return router, service


def endpoint_for(router, path):
    return next(route.endpoint for route in router.routes if route.path == path)


@pytest.mark.asyncio
async def test_human_multi_angle_uses_defined_identity_preserving_prompt():
    router, service = build_router_and_service()
    request = HumanMultiAngleRequest(
        image_filename="character.png",
        preferred_node_id="gpu-node-2",
    )

    await endpoint_for(router, "/api/generate/human-multi-angle")(request, username="tester")

    task_type, data, _ = service.calls[0]
    assert task_type == "i2i_human"
    assert data["image_path"] == "character.png"
    assert "Preserve identity" in data["prompt"]
    assert data["preferred_node_id"] == "gpu-node-2"


@pytest.mark.asyncio
async def test_matting_keeps_semantic_task_type_and_targets_selected_gpu():
    router, service = build_router_and_service()
    request = MattingRequest(
        image_filename="subject.png",
        matting_type="split",
        preferred_agent_id="agent-gpu2",
    )

    response = await endpoint_for(router, "/api/generate/matting")(request, username="tester")

    task_type, data, username = service.calls[0]
    assert response["task_id"] == "task-test"
    assert task_type == "qwen_1"
    assert data["gpu2_operation"] == "matting_split"
    assert data["requested_workflow_type"] == "matting_split"
    assert data["image_path"] == "subject.png"
    assert data["preferred_agent_id"] == "agent-gpu2"
    assert username == "tester"


@pytest.mark.asyncio
async def test_fusion_preserves_all_downloadable_images_for_gpu2():
    router, service = build_router_and_service()
    request = ImageFusionRequest(
        fusion_type="transfer",
        image_bk="background.png",
        image_hu="subject.png",
        image_mb="mask.png",
        preferred_agent_id="agent-gpu2",
    )

    await endpoint_for(router, "/api/generate/image-fusion")(request, username="tester")

    task_type, data, _ = service.calls[0]
    assert task_type == "qwen_3"
    assert data["gpu2_operation"] == "image_transfer"
    assert data["image_path_1"] == "background.png"
    assert data["image_path_2"] == "subject.png"
    assert data["image_path_3"] == "mask.png"
    assert "placement mask" in data["prompt"]


@pytest.mark.asyncio
async def test_panorama_and_storyboard_use_agent_resolvable_files_and_safe_geometry():
    router, service = build_router_and_service()
    panorama = PanoramaFusionRequest(
        image_1="left.png",
        image_2="center.png",
        image_3="right.png",
        prompt="golden hour",
        preferred_agent_id="agent-gpu2",
    )
    storyboard = AutoStoryboardRequest(
        image_filename="scene.png",
        prompt="the hero enters the room",
        preferred_agent_id="agent-gpu2",
    )

    await endpoint_for(router, "/api/generate/panorama-fusion")(panorama, username="tester")
    await endpoint_for(router, "/api/generate/auto-storyboard")(storyboard, username="tester")

    panorama_type, panorama_data, _ = service.calls[0]
    storyboard_type, storyboard_data, _ = service.calls[1]
    assert panorama_type == "qwen_3"
    assert panorama_data["requested_workflow_type"] == "panorama_fusion_3"
    assert [panorama_data[f"image_path_{index}"] for index in range(1, 4)] == [
        "left.png",
        "center.png",
        "right.png",
    ]
    assert (panorama_data["output_width"], panorama_data["output_height"]) == (1024, 512)
    assert storyboard_type == "qwen_1"
    assert storyboard_data["requested_workflow_type"] == "auto_storyboard"
    assert storyboard_data["image_path"] == "scene.png"
    assert (storyboard_data["output_width"], storyboard_data["output_height"]) == (1024, 768)
