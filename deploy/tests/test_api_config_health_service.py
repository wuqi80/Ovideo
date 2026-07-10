from services.api_config_health_service import (
    ProviderHealthNotFound,
    _has_chat_content,
    _real_generation_request,
    api_config_health_urls,
)

import pytest


def test_chat_generation_accepts_deepseek_reasoning_content() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "reasoning_content": "The requested answer is ok.",
                }
            }
        ]
    }

    assert _has_chat_content(payload) is True


def test_chat_generation_rejects_empty_message() -> None:
    payload = {
        "choices": [
            {"message": {"content": "", "reasoning_content": ""}}
        ]
    }

    assert _has_chat_content(payload) is False


def test_deepseek_reasoner_generation_test_allows_reasoning_budget() -> None:
    url, body, output_type = _real_generation_request(
        "deepseek",
        {
            "endpoint": "https://api.deepseek.com",
            "model_name": "deepseek-reasoner",
        },
    )

    assert url == "https://api.deepseek.com/chat/completions"
    assert body["model"] == "deepseek-reasoner"
    assert body["max_tokens"] == 64
    assert output_type == "text"


def test_doubao_real_generation_uses_minimum_cost_image_payload() -> None:
    _, body, output_type = _real_generation_request(
        "doubao",
        {
            "endpoint": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            "model_name": "doubao-seedream-5-0-pro-260628",
        },
    )

    assert body["size"] == "1024x1024"
    assert body["response_format"] == "url"
    assert body["watermark"] is False
    assert output_type == "image"


def test_doubao_agent_plan_real_generation_uses_plan_endpoint_and_min_size() -> None:
    url, body, output_type = _real_generation_request(
        "doubao",
        {
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks",
            "model_name": "doubao-seedream-5.0-lite",
        },
    )

    assert url == "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"
    assert body["size"] == "1920x1920"
    assert body["model"] == "doubao-seedream-5.0-lite"
    assert body["response_format"] == "url"
    assert body["watermark"] is False
    assert output_type == "image_task"


def test_doubao_agent_plan_real_generation_expands_short_endpoint() -> None:
    url, body, _ = _real_generation_request(
        "doubao",
        {
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan",
            "model_name": "doubao-seedream-5.0-lite",
        },
    )

    assert url == "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"
    assert body["model"] == "doubao-seedream-5.0-lite"
    assert body["size"] == "1920x1920"


def test_gpt_image_real_generation_uses_lowest_explicit_cost_profile() -> None:
    _, body, output_type = _real_generation_request(
        "laozhang-gpt-image",
        {
            "endpoint": "https://api.laozhang.ai/v1",
            "model_name": "gpt-image-2-vip",
        },
    )

    assert body["n"] == 1
    assert body["size"] == "1024x1024"
    assert body["quality"] == "low"
    assert output_type == "image"


def test_gemini_31_image_real_generation_uses_512_resolution() -> None:
    _, body, output_type = _real_generation_request(
        "gemini-image",
        {
            "endpoint": "https://generativelanguage.googleapis.com/v1beta",
            "model_name": "gemini-3.1-flash-image-preview",
        },
    )

    image_config = body["generationConfig"]["imageConfig"]
    assert image_config == {"aspectRatio": "1:1", "imageSize": "512"}
    assert output_type == "image"


def test_video_real_generation_does_not_create_billable_task() -> None:
    with pytest.raises(ProviderHealthNotFound):
        _real_generation_request(
            "seedance",
            {
                "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
                "model_name": "doubao-seedance-2-0-260128",
            },
        )


def test_seedance_agent_plan_health_uses_plan_v3_routes() -> None:
    urls = api_config_health_urls(
        {
            "provider": "seedance",
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan/",
            "model_name": "doubao-seedance-2-0-260128",
        }
    )

    assert urls[0] == "https://ark.cn-beijing.volces.com/api/plan/v3/models"
    assert "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks" in urls
    assert all("/api/plan/" in url for url in urls)
