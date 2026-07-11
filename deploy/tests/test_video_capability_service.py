from services import video_capability_service


async def test_video_capabilities_report_seedance_omni_and_comfyui(monkeypatch):
    async def fake_list_agent_nodes():
        return [{"agent_id": "agent_1", "status": "busy"}]

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model: "doubao-seedance-2-0-260128",
    )
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", fake_list_agent_nodes)

    assert await video_capability_service.get_video_capabilities() == {
        "seedance_omni": True,
        "comfyui_available": True,
    }


async def test_video_capabilities_degrade_safely(monkeypatch):
    def broken_seedance_model(_sub_model: str) -> str:
        raise RuntimeError("runtime unavailable")

    async def broken_list_agent_nodes():
        raise RuntimeError("agent unavailable")

    monkeypatch.setattr(video_capability_service, "resolve_seedance_model_name", broken_seedance_model)
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", broken_list_agent_nodes)

    assert await video_capability_service.get_video_capabilities() == {
        "seedance_omni": False,
        "comfyui_available": False,
    }
