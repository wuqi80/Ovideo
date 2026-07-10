from services.api_config_health_service import (
    _has_chat_content,
    _real_generation_request,
)


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
