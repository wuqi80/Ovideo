from types import SimpleNamespace

from services import video_capability_service


async def test_video_capabilities_report_seedance_omni_and_comfyui(monkeypatch):
    async def fake_list_agent_nodes():
        return [{"agent_id": "agent_1", "status": "busy"}]

    async def empty_health(targets=None):
        return []

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model, usage_scope="workflow": {
            "standard": "doubao-seedance-2-0-260128",
            "fast": "doubao-seedance-2-0-fast-260128",
            "mini": "doubao-seedance-2-0-mini-260615",
        }[sub_model],
    )
    monkeypatch.setattr(
        video_capability_service,
        "resolve_provider",
        lambda provider, model_name=None, usage_scope="workflow": SimpleNamespace(
            has_key=True,
            model_name=model_name or f"{provider}-runtime-model",
            endpoint="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        ),
    )
    monkeypatch.setattr(video_capability_service, "list_cached_provider_health", empty_health)
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", fake_list_agent_nodes)

    result = await video_capability_service.get_video_capabilities("studio")

    assert result["seedance_omni"] is True
    assert result["comfyui_available"] is True
    assert result["manifest_version"]
    assert result["model_scope"] == "studio"
    minimax = next(model for model in result["models"] if model["key"] == "MINI")
    assert minimax["available"] is True
    assert minimax["model_name"] == "minimax-runtime-model"
    assert minimax["parameter_rules"]["normalization_policy"] == "reject"
    assert minimax["parameter_rules"]["valid_combinations"] == [
        {"duration": 6, "resolution": ["768P", "1080P"]},
        {"duration": 10, "resolution": ["768P"]},
    ]
    gpu = next(model for model in result["models"] if model["key"] == "COMFYUI")
    assert gpu["available"] is True
    cluster_model = next(model for model in result["models"] if model["key"] == "一阶")
    assert cluster_model["available"] is True
    assert cluster_model["parameter_rules"]["duration"]["options"] == [5, 10, 15]
    wan26 = next(model for model in result["models"] if model["key"] == "大能")
    assert wan26["available"] is True
    assert wan26["parameter_rules"]["resolution"] == ["720P", "1080P"]
    assert wan26["parameter_rules"]["shot_type"] == ["multi", "single"]
    seedance_mini = next(model for model in result["models"] if model["key"] == "Seedance2Mini")
    assert seedance_mini["available"] is True
    assert seedance_mini["model_name"] == "doubao-seedance-2-0-mini-260615"
    assert "reference_video" in seedance_mini["media_inputs"]
    assert "reference_audio" in seedance_mini["media_inputs"]
    assert seedance_mini["parameter_rules"]["resolution"] == ["480p", "720p"]
    assert seedance_mini["parameter_rules"]["duration"]["maximum"] == 15


async def test_video_capabilities_degrade_safely(monkeypatch):
    def broken_seedance_model(_sub_model: str, usage_scope="workflow") -> str:
        raise RuntimeError("runtime unavailable")

    async def broken_list_agent_nodes():
        raise RuntimeError("agent unavailable")

    async def empty_health(targets=None):
        return []

    monkeypatch.setattr(video_capability_service, "resolve_seedance_model_name", broken_seedance_model)
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", broken_list_agent_nodes)
    monkeypatch.setattr(video_capability_service, "list_cached_provider_health", empty_health)
    monkeypatch.setattr(
        video_capability_service,
        "resolve_provider",
        lambda provider, model_name=None, usage_scope="workflow": SimpleNamespace(
            has_key=False,
            model_name=model_name or "",
            endpoint="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        ),
    )

    result = await video_capability_service.get_video_capabilities()

    assert result["seedance_omni"] is False
    assert result["comfyui_available"] is False
    assert result["manifest_version"]
    seedance = next(model for model in result["models"] if model["key"] == "Seedance2")
    seedance_mini = next(model for model in result["models"] if model["key"] == "Seedance2Mini")
    minimax = next(model for model in result["models"] if model["key"] == "MINI")
    happyhorse = next(model for model in result["models"] if model["key"] == "HappyHorse")
    assert seedance["available"] is False
    assert seedance_mini["available"] is False
    assert minimax["available"] is False
    assert happyhorse["available"] is False
    assert "reference_audio" not in seedance["media_inputs"]


async def test_video_capabilities_hide_seedance_model_marked_error_in_health_cache(monkeypatch):
    async def fake_list_agent_nodes():
        return []

    async def fake_health(targets=None):
        return [{
            "provider": "seedance",
            "model_name": "doubao-seedance-2-0-mini-260615",
            "status": "error",
        }]

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model, usage_scope="workflow": {
            "standard": "doubao-seedance-2-0-260128",
            "fast": "doubao-seedance-2-0-fast-260128",
            "mini": "doubao-seedance-2-0-mini-260615",
        }[sub_model],
    )
    monkeypatch.setattr(
        video_capability_service,
        "resolve_provider",
        lambda provider, model_name=None, usage_scope="workflow": SimpleNamespace(
            has_key=True,
            model_name=model_name or f"{provider}-runtime-model",
            endpoint="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        ),
    )
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", fake_list_agent_nodes)
    monkeypatch.setattr(video_capability_service, "list_cached_provider_health", fake_health)

    result = await video_capability_service.get_video_capabilities()

    seedance_standard = next(model for model in result["models"] if model["key"] == "Seedance2")
    seedance_mini = next(model for model in result["models"] if model["key"] == "Seedance2Mini")
    assert seedance_standard["available"] is True
    assert seedance_mini["available"] is False


def test_video_manifest_reports_agent_plan_duration_limit_without_affecting_payg():
    manifest = video_capability_service.build_video_model_manifest(
        standard_seedance_model="doubao-seedance-1.5-pro",
        fast_seedance_model="doubao-seedance-2-0-fast-260128",
        mini_seedance_model="doubao-seedance-2-0-mini-260615",
        seedance_omni=False,
        comfyui_available=False,
    )

    standard = next(model for model in manifest["models"] if model["key"] == "Seedance2")
    fast = next(model for model in manifest["models"] if model["key"] == "Seedance2Fast")
    mini = next(model for model in manifest["models"] if model["key"] == "Seedance2Mini")
    assert standard["parameter_rules"]["duration"]["maximum"] == 12
    assert fast["parameter_rules"]["duration"]["maximum"] == 15
    assert mini["parameter_rules"]["duration"]["maximum"] == 15


def test_video_manifest_exposes_only_seedance_15_in_agent_plan_mode():
    manifest = video_capability_service.build_video_model_manifest(
        standard_seedance_model="doubao-seedance-1.5-pro",
        fast_seedance_model="doubao-seedance-1.5-pro",
        mini_seedance_model="doubao-seedance-1.5-pro",
        seedance_omni=True,
        seedance_billing_mode="agent_plan",
        comfyui_available=False,
        api_availability={"Seedance15": True},
    )

    seedance_keys = [model["key"] for model in manifest["models"] if model["provider"] == "seedance"]
    assert seedance_keys == ["Seedance15"]
    seedance15 = next(model for model in manifest["models"] if model["key"] == "Seedance15")
    assert seedance15["model_name"] == "doubao-seedance-1.5-pro"
    assert seedance15["available"] is True
    assert seedance15["supports_original_audio"] is False
    assert "reference_audio" not in seedance15["media_inputs"]
