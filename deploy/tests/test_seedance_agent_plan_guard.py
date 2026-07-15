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


def test_seedance_agent_plan_i2v_keeps_duration_until_provider_rejects(monkeypatch):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )
    request_payload = {}

    def fake_request_json(*args, **kwargs):
        request_payload.update(kwargs["json"])
        return {"id": "agent-plan-i2v-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    task_id = client.create_video_task(
        "standard",
        [
            {"type": "text", "text": "move gently"},
            {"type": "image_url", "image_url": {"url": "https://cdn.example.test/frame.png"}},
        ],
        duration=5,
    )

    assert task_id == "agent-plan-i2v-task"
    assert request_payload["model"] == "doubao-seedance-1.5-pro"
    assert request_payload["duration"] == 5
    assert request_payload["content"][1]["role"] == "first_frame"


def test_seedance_agent_plan_maps_single_reference_image_to_i2v(monkeypatch):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )
    request_payload = {}

    def fake_request_json(*args, **kwargs):
        request_payload.update(kwargs["json"])
        return {"id": "agent-plan-reference-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    task_id = client.create_video_task(
        "standard",
        [
            {"type": "text", "text": "move gently"},
            {
                "type": "image_url",
                "image_url": {"url": "https://cdn.example.test/frame.png"},
                "role": "reference_image",
            },
        ],
        duration=3,
    )

    assert task_id == "agent-plan-reference-task"
    assert request_payload["model"] == "doubao-seedance-1.5-pro"
    assert request_payload["duration"] == 3
    assert request_payload["content"][1]["role"] == "first_frame"


def test_seedance_agent_plan_rejects_duration_above_supported_limit_before_submit(monkeypatch):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )
    submitted_payloads = []

    def fake_request_json(*args, **kwargs):
        submitted_payloads.append(dict(kwargs["json"]))
        return {"id": "unexpected-submit-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    with pytest.raises(ValueError, match="最多支持 12 秒"):
        client.create_video_task(
            "standard",
            [
                {"type": "text", "text": "move gently"},
                {"type": "image_url", "image_url": {"url": "https://cdn.example.test/frame.png"}},
            ],
            duration=13,
        )

    assert submitted_payloads == []


def test_seedance_agent_plan_i2v_rejects_invalid_duration_without_retry(monkeypatch):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )
    submitted_payloads = []

    class InvalidDurationError(RuntimeError):
        response = type(
            "Response",
            (),
            {
                "text": (
                    '{"error":{"code":"InvalidParameter",'
                    '"message":"the parameter duration specified in the request is not valid"}}'
                )
            },
        )()

    def fake_request_json(*args, **kwargs):
        submitted_payloads.append(dict(kwargs["json"]))
        if len(submitted_payloads) == 1:
            raise InvalidDurationError("400 Client Error")
        return {"id": "unexpected-retry-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    with pytest.raises(ValueError, match="duration=12"):
        client.create_video_task(
            "standard",
            [
                {"type": "text", "text": "move gently"},
                {"type": "image_url", "image_url": {"url": "https://cdn.example.test/frame.png"}},
            ],
            duration=12,
        )

    assert len(submitted_payloads) == 1
    assert submitted_payloads[0]["model"] == "doubao-seedance-1.5-pro"
    assert submitted_payloads[0]["duration"] == 12
    assert submitted_payloads[0]["content"][1]["role"] == "first_frame"


def test_seedance_agent_plan_maps_two_reference_images_to_morph(monkeypatch):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )
    request_payload = {}

    def fake_request_json(*args, **kwargs):
        request_payload.update(kwargs["json"])
        return {"id": "agent-plan-morph-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    task_id = client.create_video_task(
        "standard",
        [
            {"type": "text", "text": "move gently"},
            {
                "type": "image_url",
                "image_url": {"url": "https://cdn.example.test/start.png"},
                "role": "reference_image",
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://cdn.example.test/end.png"},
                "role": "reference_image",
            },
        ],
    )

    assert task_id == "agent-plan-morph-task"
    assert request_payload["content"][1]["role"] == "first_frame"
    assert request_payload["content"][2]["role"] == "last_frame"


def test_seedance_agent_plan_t2v_keeps_duration(monkeypatch):
    monkeypatch.setattr(seedance_module, "resolve_provider", lambda provider, model=None: _ResolvedConfig())
    monkeypatch.setattr(
        seedance_module,
        "resolve_seedance_model_name",
        lambda requested_sub_model: "doubao-seedance-2-0-260128",
    )
    request_payload = {}

    def fake_request_json(*args, **kwargs):
        request_payload.update(kwargs["json"])
        return {"id": "agent-plan-t2v-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    task_id = client.create_video_task(
        "standard",
        [{"type": "text", "text": "move gently"}],
        duration=5,
    )

    assert task_id == "agent-plan-t2v-task"
    assert request_payload["model"] == "doubao-seedance-1.5-pro"
    assert request_payload["duration"] == 5


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


def test_seedance_payg_fallback_to_agent_plan_i2v_keeps_duration_until_rejected(monkeypatch):
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
    submitted_payloads = []

    class UnsupportedModelError(RuntimeError):
        response = type(
            "Response",
            (),
            {"text": '{"error":{"code":"UnsupportedModel","message":"model does not exist"}}'},
        )()

    def fake_request_json(*args, **kwargs):
        submitted_payloads.append(dict(kwargs["json"]))
        if len(submitted_payloads) == 1:
            raise UnsupportedModelError("400 Client Error")
        return {"id": "payg-fallback-i2v-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    task_id = client.create_video_task(
        "standard",
        [
            {"type": "text", "text": "move gently"},
            {"type": "image_url", "image_url": {"url": "https://cdn.example.test/frame.png"}},
        ],
        duration=5,
    )

    assert task_id == "payg-fallback-i2v-task"
    assert submitted_payloads[0]["model"] == "doubao-seedance-2-0-260128"
    assert submitted_payloads[0]["duration"] == 5
    assert submitted_payloads[1]["model"] == "doubao-seedance-1.5-pro"
    assert submitted_payloads[1]["duration"] == 5


def test_seedance_rejects_invalid_duration_without_retry(monkeypatch):
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
    submitted_payloads = []

    class InvalidDurationError(RuntimeError):
        response = type(
            "Response",
            (),
            {
                "text": (
                    '{"error":{"code":"InvalidParameter",'
                    '"message":"the parameter duration specified in the request is not valid"}}'
                )
            },
        )()

    def fake_request_json(*args, **kwargs):
        submitted_payloads.append(dict(kwargs["json"]))
        if len(submitted_payloads) == 1:
            raise InvalidDurationError("400 Client Error")
        return {"id": "unexpected-retry-task"}

    monkeypatch.setattr(seedance_module, "request_json", fake_request_json)
    client = seedance_module.SeedanceClient()

    with pytest.raises(ValueError, match="duration=5"):
        client.create_video_task(
            "standard",
            [{"type": "text", "text": "move gently"}],
            duration=5,
        )

    assert len(submitted_payloads) == 1
    assert submitted_payloads[0]["duration"] == 5


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
