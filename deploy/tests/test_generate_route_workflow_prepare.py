# -*- coding: utf-8 -*-
from unittest.mock import AsyncMock, Mock

import pytest

from routers.tasks import _should_prepare_workflow, create_task_router
from schemas.generation import GenerateRequest


@pytest.mark.parametrize("task_type", ["i2v", "morph", "upscale", "upscale_hd"])
def test_generate_route_prepares_comfyui_workflows(task_type):
    assert _should_prepare_workflow(task_type) is True


@pytest.mark.parametrize(
    "task_type",
    [
        "minimax_tts",
        "minimax_i2v",
        "wan26_i2v",
        "seedance_i2v",
        "kling_t2v",
        "vidu_r2v",
        "happyhorse_r2v",
    ],
)
def test_generate_route_skips_prepare_for_external_api_tasks(task_type):
    assert _should_prepare_workflow(task_type) is False


@pytest.mark.asyncio
async def test_generate_route_submits_i2v_with_prepare_enabled():
    async def require_auth():
        return "u-test"

    service = Mock()
    service.submit = AsyncMock(return_value="task-1")
    queue = Mock()
    queue.get_queue_length = AsyncMock(return_value=0)
    task_service_module = Mock()
    task_service_module.get.return_value = service
    task_service_module.get_queue.return_value = queue

    router = create_task_router(
        require_auth_dependency=require_auth,
        jwt_auth_module=Mock(),
        task_service_module=task_service_module,
        task_dao=Mock(),
        file_dao=Mock(),
        get_pubsub_redis_client=Mock(),
        logger=Mock(),
    )
    create_generate_task = next(
        route.endpoint
        for route in router.routes
        if getattr(route, "path", None) == "/api/generate"
    )

    response = await create_generate_task(
        GenerateRequest(task_type="i2v", prompt="x"),
        username="u-test",
    )

    assert response["success"] is True
    service.submit.assert_awaited_once()
    assert service.submit.call_args.kwargs["prepare"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("generate_request", "expected_workflow", "expected_node_type"),
    [
        (
            GenerateRequest(task_type="upscale", video_filename="/storage/clip.mp4"),
            "viedo_upscaler",
            "SeedVR2",
        ),
        (
            GenerateRequest(
                task_type="voice",
                image_path="/storage/frame.webp",
                video_filename="/storage/clip.mp4",
                audio_filename="/storage/voice.wav",
                prompt_AU="自然说话",
            ),
            "video_infinitetalk",
            "VHS_LoadVideo",
        ),
    ],
)
async def test_generate_route_uses_explicit_enhancement_workflow(
    generate_request,
    expected_workflow,
    expected_node_type,
):
    async def require_auth():
        return "u-test"

    async def resolve_agent_file(param, file_ref, username):
        if not file_ref:
            return None
        return {
            "param": param,
            "filename": f"resolved-{param}",
            "url": f"/download/{param}",
        }

    service = Mock()
    service.resolve_agent_file = AsyncMock(side_effect=resolve_agent_file)
    service.submit = AsyncMock(return_value="task-explicit")
    queue = Mock()
    queue.get_queue_length = AsyncMock(return_value=0)
    task_service_module = Mock()
    task_service_module.get.return_value = service
    task_service_module.get_queue.return_value = queue

    router = create_task_router(
        require_auth_dependency=require_auth,
        jwt_auth_module=Mock(),
        task_service_module=task_service_module,
        task_dao=Mock(),
        file_dao=Mock(),
        get_pubsub_redis_client=Mock(),
        logger=Mock(),
    )
    create_generate_task = next(
        route.endpoint
        for route in router.routes
        if getattr(route, "path", None) == "/api/generate"
    )

    response = await create_generate_task(generate_request, username="u-test")

    assert response["success"] is True
    submitted = service.submit.call_args.args[1]
    assert submitted["workflow_name"] == expected_workflow
    assert any(
        node.get("class_type") == expected_node_type
        for node in submitted["workflow_json"].values()
    )
    assert service.submit.call_args.kwargs["prepare"] is False
