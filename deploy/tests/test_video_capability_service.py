from types import SimpleNamespace

import pytest

from services import video_capability_service


@pytest.fixture(autouse=True)
def disable_admin_catalog_database(monkeypatch):
    async def no_catalog(_usage_scope: str):
        return None

    monkeypatch.setattr(video_capability_service, "load_public_video_catalog", no_catalog)


async def test_video_capabilities_report_seedance_omni_and_comfyui(monkeypatch):
    async def fake_list_agent_nodes():
        return [{"agent_id": "agent_1", "status": "busy"}]

    async def empty_agent_instances():
        return []

    async def empty_health(targets=None):
        return []

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model, usage_scope="workflow": {
            "agent_plan": "doubao-seedance-1.5-pro",
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
    monkeypatch.setattr(video_capability_service, "list_agent_instances", empty_agent_instances)

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
    model_keys = {model["key"] for model in result["models"]}
    assert "COMFYUI" not in model_keys
    assert model_keys.isdisjoint({
        "Wan2", "LTXNode1", "WanNode2",
        "一阶", "二阶", "三阶", "四阶", "五阶", "六阶", "七阶",
    })
    h3 = next(model for model in result["models"] if model["key"] == "MiniMaxH3")
    assert h3["available"] is False
    wan26 = next(model for model in result["models"] if model["key"] == "大能")
    assert wan26["available"] is True
    assert wan26["parameter_rules"]["resolution"] == ["720P", "1080P"]
    assert wan26["parameter_rules"]["shot_type"] == ["multi", "single"]
    seedance_mini = next(model for model in result["models"] if model["key"] == "Seedance2Mini")
    seedance_fast = next(model for model in result["models"] if model["key"] == "Seedance2Fast")
    assert seedance_mini["available"] is True
    assert seedance_mini["model_name"] == "doubao-seedance-2-0-mini-260615"
    assert "reference_video" in seedance_mini["media_inputs"]
    assert "reference_audio" in seedance_mini["media_inputs"]
    assert seedance_mini["parameter_rules"]["resolution"] == ["480p", "720p"]
    assert seedance_fast["parameter_rules"]["resolution"] == ["480p", "720p"]
    assert seedance_mini["parameter_rules"]["duration"]["maximum"] == 15


async def test_video_capabilities_degrade_safely(monkeypatch):
    def broken_seedance_model(_sub_model: str, usage_scope="workflow") -> str:
        raise RuntimeError("runtime unavailable")

    async def broken_list_agent_nodes():
        raise RuntimeError("agent unavailable")

    async def broken_list_agent_instances():
        raise RuntimeError("agent unavailable")

    async def empty_health(targets=None):
        return []

    monkeypatch.setattr(video_capability_service, "resolve_seedance_model_name", broken_seedance_model)
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", broken_list_agent_nodes)
    monkeypatch.setattr(video_capability_service, "list_agent_instances", broken_list_agent_instances)
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
    h3 = next(model for model in result["models"] if model["key"] == "MiniMaxH3")
    assert seedance["available"] is False
    assert seedance_mini["available"] is False
    assert minimax["available"] is False
    assert happyhorse["available"] is False
    assert h3["available"] is False
    assert "reference_audio" not in seedance["media_inputs"]


async def test_video_capabilities_expose_only_h3_processing_node_models(monkeypatch):
    async def fake_list_agent_nodes():
        return [
            {
                "id": "agent_gpu1",
                "agent_id": "agent_gpu1",
                "node_id": "agent_gpu1",
                "routing_name": "GPU1",
                "name": "处理节点1",
                "status": "online",
            },
            {
                "id": "agent_gpu2",
                "agent_id": "agent_gpu2",
                "node_id": "agent_gpu2",
                "routing_name": "GPU2",
                "name": "处理节点2",
                "status": "busy",
            },
        ]

    async def empty_agent_instances():
        return []

    async def empty_health(targets=None):
        return []

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model, usage_scope="workflow": {
            "agent_plan": "doubao-seedance-1.5-pro",
            "standard": "doubao-seedance-2-0-260128",
            "fast": "doubao-seedance-2-0-fast-260128",
            "mini": "doubao-seedance-2-0-mini-260615",
        }[sub_model],
    )
    monkeypatch.setattr(
        video_capability_service,
        "resolve_provider",
        lambda provider, model_name=None, usage_scope="workflow": SimpleNamespace(
            has_key=False,
            model_name=model_name or "",
            endpoint="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        ),
    )
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", fake_list_agent_nodes)
    monkeypatch.setattr(video_capability_service, "list_agent_instances", empty_agent_instances)
    monkeypatch.setattr(video_capability_service, "list_cached_provider_health", empty_health)

    result = await video_capability_service.get_video_capabilities()

    model_keys = {model["key"] for model in result["models"]}
    assert model_keys.isdisjoint({"Wan2", "LTXNode1", "WanNode2"})
    h3 = next(model for model in result["models"] if model["key"] == "MiniMaxH3")
    assert h3["available"] is True
    assert h3["preferred_agent_id"] == "agent_gpu2"
    assert h3["preferred_node_id"] == "agent_gpu2"
    assert h3["label"] == "MiniMax H3 · 本地节点模型"


async def test_video_capabilities_hide_seedance_model_marked_error_in_health_cache(monkeypatch):
    async def fake_list_agent_nodes():
        return []

    async def empty_agent_instances():
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
            "agent_plan": "doubao-seedance-1.5-pro",
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
    monkeypatch.setattr(video_capability_service, "list_agent_instances", empty_agent_instances)
    monkeypatch.setattr(video_capability_service, "list_cached_provider_health", fake_health)

    result = await video_capability_service.get_video_capabilities()

    seedance_standard = next(model for model in result["models"] if model["key"] == "Seedance2")
    seedance_mini = next(model for model in result["models"] if model["key"] == "Seedance2Mini")
    assert seedance_standard["available"] is True
    assert seedance_mini["available"] is False


async def test_video_capabilities_expose_minimax_h3_on_unified_8188_runtime(monkeypatch):
    async def fake_list_agent_nodes():
        return [{"agent_id": "agent_gpu2", "status": "online"}]

    async def fake_list_agent_instances():
        return [
            {"agent_id": "agent_gpu2", "port": 8188, "healthy": True, "capabilities": {}},
            {
                "agent_id": "agent_gpu2",
                "port": 8188,
                "healthy": True,
                "capabilities": {
                    "minimax_h3_fl2va": True,
                    "minimax_h3_fast": True,
                    "minimax_h3_mini": True,
                },
            },
        ]

    async def empty_health(targets=None):
        return []

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model, usage_scope="workflow": {
            "agent_plan": "doubao-seedance-1.5-pro",
            "standard": "doubao-seedance-2-0-260128",
            "fast": "doubao-seedance-2-0-fast-260128",
            "mini": "doubao-seedance-2-0-mini-260615",
        }[sub_model],
    )
    monkeypatch.setattr(
        video_capability_service,
        "resolve_provider",
        lambda provider, model_name=None, usage_scope="workflow": SimpleNamespace(
            has_key=False,
            model_name=model_name or "",
            endpoint="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        ),
    )
    monkeypatch.setattr(video_capability_service, "list_cached_provider_health", empty_health)
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", fake_list_agent_nodes)
    monkeypatch.setattr(video_capability_service, "list_agent_instances", fake_list_agent_instances)

    result = await video_capability_service.get_video_capabilities()

    h3 = next(model for model in result["models"] if model["key"] == "MiniMaxH3")
    h3_fast = next(model for model in result["models"] if model["key"] == "MiniMaxH3Fast")
    h3_mini = next(model for model in result["models"] if model["key"] == "MiniMaxH3Mini")
    assert h3["available"] is True
    assert h3["provider"] == "processing_cluster"
    assert h3["model_name"] == "MiniMax H3"
    assert h3["preferred_agent_id"] == "agent_gpu2"
    assert h3["preferred_node_id"] == "agent_gpu2"
    assert h3["preferred_comfyui_port"] == 8188
    assert h3["strict_preferred_routing"] is True
    assert h3["parameter_rules"]["duration"] == {
        "type": "integer",
        "default": 5,
        "minimum": 4,
        "maximum": 15,
    }
    assert h3["supports_generated_audio"] is True
    assert h3_fast["available"] is True
    assert h3_fast["parameter_rules"]["h3_profile"] == "fast"
    assert h3_mini["available"] is True
    assert h3_mini["parameter_rules"]["h3_profile"] == "mini"


def test_minimax_h3_instance_accepts_installed_mini_while_baseline_is_resident():
    assert video_capability_service._is_minimax_h3_instance({
        "port": 8188,
        "capabilities": {
            "minimax_h3_fl2va": False,
            "minimax_h3_fast": False,
            "minimax_h3_mini": True,
        },
    }) is True


async def test_video_capabilities_keep_minimax_h3_visible_when_gpu2_is_online(monkeypatch):
    async def fake_list_agent_nodes():
        return [{
            "agent_id": "agent_gpu2",
            "node_id": "agent_gpu2",
            "routing_name": "GPU2",
            "status": "healthy",
        }]

    async def empty_agent_instances():
        return []

    async def empty_health(targets=None):
        return []

    monkeypatch.setattr(
        video_capability_service,
        "resolve_seedance_model_name",
        lambda sub_model, usage_scope="workflow": {
            "agent_plan": "doubao-seedance-1.5-pro",
            "standard": "doubao-seedance-2-0-260128",
            "fast": "doubao-seedance-2-0-fast-260128",
            "mini": "doubao-seedance-2-0-mini-260615",
        }[sub_model],
    )
    monkeypatch.setattr(
        video_capability_service,
        "resolve_provider",
        lambda provider, model_name=None, usage_scope="workflow": SimpleNamespace(
            has_key=False,
            model_name=model_name or "",
            endpoint="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        ),
    )
    monkeypatch.setattr(video_capability_service, "list_cached_provider_health", empty_health)
    monkeypatch.setattr(video_capability_service, "list_agent_nodes", fake_list_agent_nodes)
    monkeypatch.setattr(video_capability_service, "list_agent_instances", empty_agent_instances)

    result = await video_capability_service.get_video_capabilities()

    h3 = next(model for model in result["models"] if model["key"] == "MiniMaxH3")
    assert h3["available"] is True
    assert h3["preferred_agent_id"] == "agent_gpu2"
    assert h3["preferred_node_id"] == "agent_gpu2"
    assert h3["preferred_comfyui_port"] == 8188
    assert h3["strict_preferred_routing"] is True


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


def test_video_manifest_exposes_agent_plan_and_payg_seedance_models_together():
    manifest = video_capability_service.build_video_model_manifest(
        agent_plan_seedance_model="doubao-seedance-1.5-pro",
        standard_seedance_model="doubao-seedance-2-0-260128",
        fast_seedance_model="doubao-seedance-2-0-fast-260128",
        mini_seedance_model="doubao-seedance-2-0-mini-260615",
        seedance_omni=True,
        comfyui_available=False,
        api_availability={
            "Seedance15": True,
            "Seedance2": True,
            "Seedance2Fast": True,
            "Seedance2Mini": True,
        },
    )

    seedance_keys = [model["key"] for model in manifest["models"] if model["provider"] == "seedance"]
    assert seedance_keys == ["Seedance15", "Seedance2", "Seedance2Fast", "Seedance2Mini"]
    seedance15 = next(model for model in manifest["models"] if model["key"] == "Seedance15")
    assert seedance15["model_name"] == "doubao-seedance-1.5-pro"
    assert seedance15["available"] is True
    assert seedance15["supports_original_audio"] is False
    assert "reference_audio" not in seedance15["media_inputs"]


def test_backend_catalog_controls_visibility_and_public_wording():
    configs = [{
        "provider": "minimax",
        "endpoint": "https://api.minimaxi.com/v1",
        "enabled": True,
        "model_name": "MiniMax-Hailuo-2.3",
        "model_bindings": [
            {
                "scope": "workflow",
                "operation": "video-standard",
                "model_name": "MiniMax-Hailuo-2.3",
                "display_name": "海螺标准",
                "description": "首尾帧精细视频模型",
                "published": True,
            },
            {
                "scope": "workflow",
                "operation": "video-fast",
                "model_name": "MiniMax-Hailuo-2.3-Fast",
                "published": False,
            },
        ],
    }]
    catalog = video_capability_service.build_public_video_catalog(configs)
    manifest = video_capability_service.build_video_model_manifest(
        standard_seedance_model="doubao-seedance-2-0-260128",
        fast_seedance_model="doubao-seedance-2-0-fast-260128",
        mini_seedance_model="doubao-seedance-2-0-mini-260615",
        seedance_omni=True,
        comfyui_available=False,
        api_availability={"MINI": True},
        runtime_model_names={
            "MINI": ["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast"],
        },
        public_model_catalog=catalog,
    )

    minimax = next(model for model in manifest["models"] if model["key"] == "MINI")
    assert minimax["available"] is True
    assert minimax["published"] is True
    assert minimax["label"] == "海螺标准 · 首尾帧精细视频模型"
    assert minimax["default_display_name"] == "MiniMax Hailuo 2.3"
    assert minimax["display_name_customized"] is True
    assert minimax["model_options"] == ["MiniMax-Hailuo-2.3"]


def test_disabling_every_backend_card_hides_that_provider_models():
    catalog = video_capability_service.build_public_video_catalog([{
        "provider": "seedance",
        "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        "enabled": False,
        "model_bindings": [],
    }])
    manifest = video_capability_service.build_video_model_manifest(
        standard_seedance_model="doubao-seedance-2-0-260128",
        fast_seedance_model="doubao-seedance-2-0-fast-260128",
        mini_seedance_model="doubao-seedance-2-0-mini-260615",
        seedance_omni=True,
        comfyui_available=False,
        api_availability={
            "Seedance15": True,
            "Seedance2": True,
            "Seedance2Fast": True,
            "Seedance2Mini": True,
        },
        public_model_catalog=catalog,
    )

    seedance = [model for model in manifest["models"] if model["provider"] == "seedance"]
    assert seedance
    assert all(model["available"] is False for model in seedance)
    assert all(model["published"] is False for model in seedance)
