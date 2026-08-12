# -*- coding: utf-8 -*-
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

import routers.tasks as tasks_router_module
from routers.tasks import _gpu_queue_snapshot, _local_gpu_maintenance, _should_prepare_workflow, create_task_router
from schemas.generation import GenerateRequest
from services.generation_access_service import GenerationAccessDenied


@pytest.fixture(autouse=True)
def _explicitly_enable_local_gpu_for_normal_route_tests(monkeypatch):
    monkeypatch.setenv("MECHA_LOCAL_GPU_MAINTENANCE", "0")


def test_local_gpu_maintenance_defaults_closed(monkeypatch):
    monkeypatch.delenv("MECHA_LOCAL_GPU_MAINTENANCE", raising=False)
    assert _local_gpu_maintenance()["enabled"] is True


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
async def test_gpu_queue_preflight_reports_anonymous_serial_position_and_eta():
    queue = Mock()
    queue.get_queue_length = AsyncMock(return_value=2)
    queue.get_processing_count = AsyncMock(return_value=1)

    result = await _gpu_queue_snapshot(
        queue,
        GenerateRequest(task_type="i2v", model="MiniMaxH3", prompt="x"),
    )

    assert result["queue_mode"] == "gpu2_serial"
    assert result["public_comfyui_port"] == 8188
    assert result["runtime_profile"] == "h3"
    assert result["tasks_ahead"] == 3
    assert result["estimated_wait_seconds"] == 2820
    assert result["requires_confirmation"] is True
    assert result["can_cancel_before_submit"] is True
    assert result["accepting_submissions"] is True


@pytest.mark.asyncio
async def test_gpu_queue_preflight_blocks_local_tasks_during_maintenance(monkeypatch):
    monkeypatch.setenv("MECHA_LOCAL_GPU_MAINTENANCE", "1")
    monkeypatch.setenv("MECHA_LOCAL_GPU_MAINTENANCE_MESSAGE", "DFS recovery in progress")
    monkeypatch.setenv("MECHA_LOCAL_GPU_MAINTENANCE_RESUME_AT", "2026-08-17")
    queue = Mock()

    result = await _gpu_queue_snapshot(
        queue,
        GenerateRequest(task_type="upscale_hd", prompt="x"),
    )

    assert result == {
        "queue_mode": "maintenance",
        "runtime_profile": "wan",
        "public_comfyui_port": 8188,
        "tasks_ahead": 0,
        "estimated_wait_seconds": 0,
        "estimated_wait_time": 0,
        "requires_confirmation": False,
        "can_cancel_before_submit": True,
        "accepting_submissions": False,
        "maintenance_message": "DFS recovery in progress",
        "estimated_resume_at": "2026-08-17",
    }
    queue.get_queue_length.assert_not_called()


@pytest.mark.asyncio
async def test_gpu_queue_preflight_keeps_external_api_available_during_local_maintenance(monkeypatch):
    monkeypatch.setenv("MECHA_LOCAL_GPU_MAINTENANCE", "1")

    result = await _gpu_queue_snapshot(
        Mock(),
        GenerateRequest(task_type="seedance_i2v", prompt="x"),
    )

    assert result["queue_mode"] == "external"
    assert result["accepting_submissions"] is True


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
async def test_generate_route_rejects_direct_local_submit_during_maintenance(monkeypatch):
    monkeypatch.setenv("MECHA_LOCAL_GPU_MAINTENANCE", "true")
    monkeypatch.setenv("MECHA_LOCAL_GPU_MAINTENANCE_MESSAGE", "DFS first")

    service = Mock()
    service.submit = AsyncMock(return_value="should-not-submit")
    task_service_module = Mock()
    task_service_module.get.return_value = service
    router = create_task_router(
        require_auth_dependency=AsyncMock(return_value="u-test"),
        jwt_auth_module=Mock(),
        task_service_module=task_service_module,
        task_dao=Mock(),
        file_dao=Mock(),
        get_pubsub_redis_client=Mock(),
        logger=Mock(),
    )
    create_generate_task = next(
        route.endpoint for route in router.routes
        if getattr(route, "path", None) == "/api/generate"
    )

    with pytest.raises(HTTPException) as exc:
        await create_generate_task(
            GenerateRequest(task_type="upscale_hd", prompt="x"),
            username="u-test",
        )

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "local_gpu_maintenance"
    assert exc.value.detail["message"] == "DFS first"
    service.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_generate_route_targets_minimax_h3_to_owning_gpu2_agent(monkeypatch):
    async def require_auth():
        return "u-test"

    async def fake_h3_target():
        return {
            "preferred_agent_id": "agent_gpu2",
            "preferred_node_id": "agent_gpu2",
            "preferred_comfyui_port": 8188,
            "strict_preferred_comfyui_port": True,
        }

    monkeypatch.setattr(tasks_router_module, "resolve_minimax_h3_agent_target", fake_h3_target)

    service = Mock()
    service.submit = AsyncMock(return_value="task-h3")
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
        GenerateRequest(task_type="i2v", model="MiniMaxH3", image_path="first.png", prompt="x"),
        username="u-test",
    )

    assert response["success"] is True
    task_data = service.submit.call_args.args[1]
    assert task_data["preferred_agent_id"] == "agent_gpu2"
    assert task_data["preferred_node_id"] == "agent_gpu2"
    assert task_data["preferred_comfyui_port"] == 8188
    assert task_data["strict_preferred_comfyui_port"] is True
    assert service.submit.call_args.kwargs["prepare"] is True


@pytest.mark.asyncio
async def test_generate_route_rejects_unauthorized_studio_scope_before_enqueue():
    async def require_auth():
        return "u-test"

    async def deny_access(*args, **kwargs):
        raise GenerationAccessDenied("denied")

    service = Mock()
    service.submit = AsyncMock(return_value="should-not-submit")
    task_service_module = Mock()
    task_service_module.get.return_value = service
    task_service_module.get_queue.return_value.get_queue_length = AsyncMock(return_value=0)

    router = create_task_router(
        require_auth_dependency=require_auth,
        jwt_auth_module=Mock(),
        task_service_module=task_service_module,
        task_dao=Mock(),
        file_dao=Mock(),
        get_pubsub_redis_client=Mock(),
        logger=Mock(),
        generation_access_checker=deny_access,
    )
    create_generate_task = next(
        route.endpoint
        for route in router.routes
        if getattr(route, "path", None) == "/api/generate"
    )

    with pytest.raises(HTTPException) as exc:
        await create_generate_task(
            GenerateRequest(
                task_type="seedance_i2v",
                entity_type="episode",
                entity_id="ep-other",
                episode_id="ep-other",
                project_id="proj-1",
                file_role="studio_video",
                media_inputs=[
                    {"kind": "image", "url": "/storage/private.png", "role": "first_frame"},
                ],
            ),
            username="u-test",
        )

    assert exc.value.status_code == 404
    service.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_generate_route_rejects_invalid_minimax_options_before_enqueue():
    async def require_auth():
        return "u-test"

    service = Mock()
    service.submit = AsyncMock(return_value="should-not-submit")
    task_service_module = Mock()
    task_service_module.get.return_value = service
    task_service_module.get_queue.return_value.get_queue_length = AsyncMock(return_value=0)

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

    with pytest.raises(HTTPException) as exc:
        await create_generate_task(
            GenerateRequest(
                task_type="minimax_i2v",
                first_frame_image="/storage/frame.png",
                duration=10,
                minimax_resolution="1080P",
            ),
            username="u-test",
        )

    assert exc.value.status_code == 400
    assert "1080P 仅支持 6 秒" in str(exc.value.detail)
    service.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("generate_request", "expected_workflow", "expected_node_type"),
    [
        (
                GenerateRequest(task_type="upscale", video_filename="/storage/clip.mp4"),
                "viedo_upscaler",
                "SeedVR2VideoUpscaler",
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
