import pytest

from services import credit_service
from services.video_credit_pricing import CREDITS_PER_CNY, quote_video_credits


@pytest.mark.parametrize(
    "model",
    ["Wan2", "LTXNode1", "WanNode2", "一阶", "七阶", "MiniMaxH3", "MiniMaxH3Fast", "MiniMaxH3Mini"],
)
def test_local_video_models_use_product_minimum(model):
    assert quote_video_credits({"model": model, "duration_seconds": 15})["credits"] == 10


def test_external_conversion_is_twenty_credits_per_cny():
    assert CREDITS_PER_CNY == 20
    quote = quote_video_credits({
        "task_type": "wan26_i2v",
        "duration_seconds": 5,
        "resolution": "1080P",
    })
    assert quote["provider_cost_cny"] == "5"
    assert quote["credits"] == 100


def test_happyhorse_1080p_uses_twenty_credits_per_cny_and_default():
    explicit = quote_video_credits({
        "task_type": "happyhorse_r2v",
        "duration_seconds": 5,
        "hh_resolution": "1080P",
    })
    defaulted = quote_video_credits({"model": "HappyHorse", "duration_seconds": 5})
    assert explicit["credits"] == 160
    assert defaulted["credits"] == 160


@pytest.mark.parametrize(
    ("params", "credits"),
    [
        ({"model": "HappyHorse", "duration_seconds": 5, "hh_resolution": "720P"}, 90),
        ({"model": "Kling", "duration_seconds": 5, "resolution": "720P"}, 60),
        ({"model": "Kling", "duration_seconds": 5, "resolution": "1080P", "audio": True}, 120),
        ({"model": "Vidu", "duration_seconds": 5, "sub_model": "q3", "vidu_resolution": "720P"}, 63),
        ({"model": "MINI", "minimax_model": "MiniMax-Hailuo-2.3", "minimax_resolution": "768P", "duration_seconds": 6}, 40),
        ({"model": "MINI", "minimax_model": "MiniMax-Hailuo-2.3-Fast", "minimax_resolution": "1080P", "duration_seconds": 6}, 46),
        ({"model": "Seedance2Mini", "sub_model": "mini", "resolution": "720P", "duration_seconds": 5}, 50),
        ({"model": "Seedance2Fast", "sub_model": "fast", "resolution": "720P", "duration_seconds": 5}, 75),
        ({"model": "Seedance2", "sub_model": "standard", "resolution": "1080P", "duration_seconds": 5}, 135),
        ({"model": "Sora2"}, 120),
        ({"model": "Veo"}, 110),
    ],
)
def test_model_and_spec_specific_prices(params, credits):
    assert quote_video_credits(params)["credits"] == credits


def test_caller_supplied_credit_amount_is_ignored():
    quote = quote_video_credits({
        "model": "HappyHorse",
        "duration_seconds": 5,
        "hh_resolution": "1080P",
        "credits": 1,
        "price": 0,
    })
    assert quote["credits"] == 160


def test_credit_service_uses_server_owned_video_quote():
    rule = {
        "feature_key": "video_generation",
        "base_cost": 999,
        "min_cost": 999,
        "max_cost": 999,
        "factors": [],
    }
    assert credit_service.compute_cost(rule, {"model": "MiniMaxH3"}) == 10
    assert credit_service.compute_cost(rule, {"model": "HappyHorse", "duration_seconds": 5}) == 160
