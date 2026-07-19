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

    result = await video_capability_service.get_video_capabilities()

    assert result["seedance_omni"] is True
    assert result["comfyui_available"] is True
    assert result["manifest_version"]
    minimax = next(model for model in result["models"] if model["key"] == "MINI")
    assert minimax["parameter_rules"]["normalization_policy"] == "reject"
    assert minimax["parameter_rules"]["valid_combinations"] == [
        {"duration": 6, "resolution": ["768P", "1080P"]},
        {"duration": 10, "resolution": ["768P"]},
    ]
    gpu = next(model for model in result["models"] if model["key"] == "COMFYUI")
    assert gpu["available"] is True


async def test_video_capabilities_degrade_safely(monkeypatch):
    def broken_seedance_model(_sub_model: str) -> str:
        raise RuntimeError("runtime unavailable")

    async def broken_list_agent_nodes():
        raise RuntimeError("agent unavailable")

    monkeypatch.setattr(video_capability_service, "resolve_seedance_model_name", broken_seedance_model)
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", broken_list_agent_nodes)

    result = await video_capability_service.get_video_capabilities()

    assert result["seedance_omni"] is False
    assert result["comfyui_available"] is False
    assert result["manifest_version"]
    seedance = next(model for model in result["models"] if model["key"] == "Seedance2")
    assert "reference_audio" not in seedance["media_inputs"]


def test_video_manifest_reports_agent_plan_duration_limit_without_affecting_payg():
    manifest = video_capability_service.build_video_model_manifest(
        standard_seedance_model="doubao-seedance-1.5-pro",
        fast_seedance_model="doubao-seedance-2-0-fast-260128",
        seedance_omni=False,
        comfyui_available=False,
    )

    standard = next(model for model in manifest["models"] if model["key"] == "Seedance2")
    fast = next(model for model in manifest["models"] if model["key"] == "Seedance2Fast")
    assert standard["parameter_rules"]["duration"]["maximum"] == 12
    assert fast["parameter_rules"]["duration"]["maximum"] == 15
