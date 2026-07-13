from services.api_config_health_service import (
    ProviderHealthNotFound,
    _has_chat_content,
    _headers_for_generation,
    _minimax_error_from_payload,
    _real_generation_request,
    _real_generation_response_ok,
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
    assert body["content"] == [
        {"type": "text", "text": "A simple blue square icon on a white background."}
    ]
    assert "prompt" not in body
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


def test_minimax_audio_real_generation_uses_tts_sync_and_group_id() -> None:
    url, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-Hailuo-02",
            "category": "audio",
            "request_template": {"group_id": "group-1"},
            "model_bindings": [
                {
                    "operation": "tts-hd",
                    "label": "语音生成 (Speech 2.8 HD)",
                    "model_name": "speech-2.8-hd",
                },
            ],
        },
    )

    assert url == "https://api.minimaxi.com/v1/t2a_v2?GroupId=group-1"
    assert body["model"] == "speech-2.8-hd"
    assert body["text"] == "OK."
    assert body["voice_setting"]["voice_id"] == "male-qn-qingse"
    assert body["voice_setting"]["vol"] == 1.0
    assert body["audio_setting"]["channel"] == 1
    assert "output_format" not in body
    assert output_type == "audio"


def test_minimax_token_plan_audio_real_generation_omits_legacy_group_id() -> None:
    url, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "speech-2.8-hd",
            "category": "audio",
            "request_template": {
                "group_id": "admin",
                "provider_access_mode": "domestic_token_plan",
            },
        },
    )

    assert url == "https://api.minimaxi.com/v1/t2a_v2"
    assert body["model"] == "speech-2.8-hd"
    assert output_type == "audio"


def test_minimax_video_real_generation_creates_video_task() -> None:
    url, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-Hailuo-2.3",
            "category": "video",
            "model_bindings": [
                {
                    "operation": "video-standard",
                    "label": "金丹 (Hailuo 2.3)",
                    "model_name": "MiniMax-Hailuo-2.3",
                },
            ],
        },
    )

    assert url == "https://api.minimaxi.com/v1/video_generation"
    assert body["model"] == "MiniMax-Hailuo-2.3"
    assert body["duration"] == 6
    assert body["resolution"] == "768P"
    assert output_type == "video_task"


def test_minimax_audio_and_video_generation_response_detection() -> None:
    assert _real_generation_response_ok(
        "audio",
        {"data": {"audio": "494433"}, "base_resp": {"status_code": 0}},
    )
    assert _real_generation_response_ok(
        "video_task",
        {"task_id": "106916112212032", "base_resp": {"status_code": 0}},
    )


def test_generation_headers_replace_stale_authorization() -> None:
    headers = _headers_for_generation(
        "minimax",
        "https://api.minimaxi.com/v1",
        "fresh-key",
        {"Authorization": "", "X-Custom": "1"},
    )

    assert headers["Authorization"] == "Bearer fresh-key"
    assert headers["X-Custom"] == "1"
    assert "authorization" not in {key.lower(): key for key in headers if key != "Authorization"}


def test_minimax_base_resp_error_is_actionable_for_token_plan() -> None:
    error = _minimax_error_from_payload(
        {
            "base_resp": {
                "status_code": 1004,
                "status_msg": "login fail: Please carry the API secret key in the 'Authorization' field",
            }
        }
    )

    assert "MiniMax status_code=1004" in error
    assert "Authorization" in error
    assert "Token Plan" in error
    assert "Subscription Key" in error


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
