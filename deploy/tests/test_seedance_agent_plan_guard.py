import pytest

from external_api.video import seedance as seedance_module


class _ResolvedConfig:
    api_key = "test-key"
    endpoint = "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"

    @staticmethod
    def requests_kwargs():
        return {}

    @staticmethod
    def url_for_operation(operation: str, **path_params):
        return _ResolvedConfig.endpoint


class _PayAsYouGoResolvedConfig(_ResolvedConfig):
    endpoint = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"


@pytest.mark.parametrize(
    ("sub_model", "resolved_model"),
    [
        ("standard", "doubao-seedance-2-0-260128"),
        ("fast", "doubao-seedance-2-0-fast-260128"),
    ],
)
def test_seedance_agent_plan_uses_supported_15_model(monkeypatch, sub_model, resolved_model):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: resolved_model,
    )
    request_payload = {}

    def fake_request_json(*args, **kwargs):
        request_payload.update(kwargs["json"])
        return {"id": "agent-plan-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    task_id = client.create_video_task(sub_model, [{"type": "text", "text": "test"}])

    assert task_id == "agent-plan-task"
    assert request_payload["model"] == "doubao-seedance-1.5-pro"


def test_seedance_unsupported_model_is_non_retryable(monkeypatch):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )

    class UnsupportedModelError(RuntimeError):
        response = type(
            "Response",
            (),
            {"text": '{"error":{"code":"UnsupportedModel","message":"does not support the agent plan feature"}}'},
        )()

    def fake_request_json(*args, **kwargs):
        raise UnsupportedModelError("400 Client Error")

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    with pytest.raises(RuntimeError, match="ModelNotOpen"):
        client.create_video_task("standard", [{"type": "text", "text": "test"}])


@pytest.mark.parametrize(
    ("sub_model", "resolved_model"),
    [
        ("standard", "doubao-seedance-2-0-260128"),
        ("fast", "doubao-seedance-2-0-fast-260128"),
    ],
)
def test_seedance_payg_falls_back_to_15_for_model_availability_errors(
    monkeypatch,
    sub_model,
    resolved_model,
):
    monkeypatch.setattr(
        seedance_module,
        "resolve_provider",
        lambda provider, model=None: _PayAsYouGoResolvedConfig(),
    )
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: resolved_model,
    )
    submitted_models = []

    class UnsupportedModelError(RuntimeError):
        response = type(
            "Response",
            (),
            {"text": '{"error":{"code":"UnsupportedModel","message":"model does not exist"}}'},
        )()

    def fake_request_json(*args, **kwargs):
        submitted_models.append(kwargs["json"]["model"])
        if len(submitted_models) == 1:
            raise UnsupportedModelError("400 Client Error")
        return {"id": "payg-fallback-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    task_id = client.create_video_task(sub_model, [{"type": "text", "text": "test"}])

    assert task_id == "payg-fallback-task"
    assert submitted_models == [resolved_model, "doubao-seedance-1.5-pro"]


def test_seedance_payg_does_not_fallback_for_transport_errors(monkeypatch):
    monkeypatch.setattr(
        seedance_module,
        "resolve_provider",
        lambda provider, model=None: _PayAsYouGoResolvedConfig(),
    )
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )
    submitted_models = []

    def fake_request_json(*args, **kwargs):
        submitted_models.append(kwargs["json"]["model"])
        raise TimeoutError("provider timed out")

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    with pytest.raises(TimeoutError, match="timed out"):
        client.create_video_task("standard", [{"type": "text", "text": "test"}])

    assert submitted_models == ["doubao-seedance-2-0-260128"]
