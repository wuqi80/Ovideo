# -*- coding: utf-8 -*-
"""
5 家视频/音频厂商的"非重试错误"识别 + 用户可读错误提示——单元测试。

背景：
  - Seedance (commit 8cee1dd7) 与 DashScope (commit 60ffec78) 已分别加固。
  - 剩余 5 家（sora2 / veo / wan26 / minimax / minimax_tts）的失败处理改用
    api_provider_runtime 的 vendor_error_is_non_retryable + vendor_user_facing_error。
  - seedance_error_is_non_retryable / seedance_user_facing_error 改写为薄壳，
    内部转调 vendor_*，本文件含 1 个等价 regression 用例防止语义漂移。

测试覆盖 3 类错误：
  1. requests.HTTPError 携带 response.status_code (401/403/404)
  2. RuntimeError 含业务码或鉴权 marker (e.g. "status_code=1004" / "InvalidApiKey")
  3. RuntimeError 含余额/额度 marker (e.g. "balance" / "quota")
"""
from __future__ import annotations

import pytest
import requests

from services.api_provider_runtime import (
    seedance_error_is_non_retryable,
    seedance_user_facing_error,
    vendor_error_is_non_retryable,
    vendor_user_facing_error,
    _VENDOR_ERROR_PROFILES,
)


# ──────────────────────────────────────────────────────────────────────
# 工具：构造一个 requests.HTTPError，带 response.status_code 和 text
# ──────────────────────────────────────────────────────────────────────


def _http_error(status_code: int, body: str = "") -> requests.HTTPError:
    """构造一个 requests.HTTPError（带 .response.status_code / .response.text）。"""
    response = requests.Response()
    response.status_code = status_code
    response._content = body.encode("utf-8")
    err = requests.HTTPError(f"{status_code} Client Error: {body[:50]}")
    err.response = response
    return err


# ──────────────────────────────────────────────────────────────────────
# 5 家 vendor × HTTP 401 → 全部应识别为非重试
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "vendor",
    ["sora2", "veo", "wan26", "minimax", "minimax_tts"],
)
def test_http_401_marks_non_retryable(vendor):
    """HTTP 401 + body 含鉴权 marker → 5 家都识别为非重试。
    body 文本按各 vendor 实际匹配：4 家认 'unauthorized'，minimax_tts 认 'authorization'。
    """
    body_map = {
        "sora2": '{"error": "unauthorized"}',
        "veo": '{"error": "unauthorized"}',
        "wan26": '{"error": "unauthorized"}',
        "minimax": '{"error": "unauthorized"}',
        "minimax_tts": '{"error": "authorization failed"}',
    }
    exc = _http_error(401, body_map[vendor])
    assert vendor_error_is_non_retryable(exc, vendor) is True


@pytest.mark.parametrize("vendor", ["sora2", "veo", "wan26", "minimax"])
def test_http_403_marks_non_retryable(vendor):
    exc = _http_error(403, "Forbidden")
    assert vendor_error_is_non_retryable(exc, vendor) is True


@pytest.mark.parametrize("vendor", ["sora2", "veo"])
def test_http_404_marks_non_retryable_for_laozhang(vendor):
    """Sora2/Veo 走 laozhang 网关，404 也视为鉴权/模型不存在。"""
    exc = _http_error(404, '{"error": "model_not_found"}')
    assert vendor_error_is_non_retryable(exc, vendor) is True


def test_minimax_tts_http_401_does_not_match_pure_status():
    """minimax_tts profile http_statuses=()，纯 401 无 body 不命中（靠 text 识别）。
    避免 TTS 把 401 当鉴权失败误判（实际 TTS 路径根本不抛 HTTPError）。
    """
    exc = _http_error(401, "")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is False


# ──────────────────────────────────────────────────────────────────────
# RuntimeError 文本 marker 命中
# ──────────────────────────────────────────────────────────────────────


def test_minimax_tts_runtime_error_with_business_code():
    """MiniMax TTS 业务码 status_code=1004（余额不足）应识别为非重试。"""
    exc = RuntimeError("tts_sync 失败: http_status=400 status_code=1004 msg=insufficient balance")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is True


def test_minimax_runtime_error_with_business_code():
    exc = RuntimeError("MiniMax 任务失败: base_resp.status_msg=insufficient balance, status_code=1004")
    assert vendor_error_is_non_retryable(exc, "minimax") is True


def test_sora2_runtime_error_with_invalid_api_key():
    exc = RuntimeError("Sora2 失败: Incorrect API key provided")
    assert vendor_error_is_non_retryable(exc, "sora2") is True


def test_wan26_runtime_error_with_missing_api_key():
    exc = RuntimeError("Wan2.6 失败: code=MissingApiKey, message=API key not configured")
    assert vendor_error_is_non_retryable(exc, "wan26") is True


def test_veo_runtime_error_with_model_not_found():
    exc = RuntimeError("Veo 失败: model_not_found - the model does not exist")
    assert vendor_error_is_non_retryable(exc, "veo") is True


def test_minimax_tts_local_message_unconfigured():
    """worker.py:2466 抛 'MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY'。"""
    exc = RuntimeError("MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is True


def test_minimax_local_message_unconfigured():
    exc = RuntimeError("MINIMAX_API_KEY 未设置")
    assert vendor_error_is_non_retryable(exc, "minimax") is True


# ──────────────────────────────────────────────────────────────────────
# 兜底：无关错误 → 不应识别为非重试（避免误吞内容审核、网络错等）
# ──────────────────────────────────────────────────────────────────────


def test_content_review_error_is_retryable_for_minimax():
    """内容审核不通过是可重试/换 prompt 的问题，不应判非重试。"""
    exc = RuntimeError("MiniMax 任务失败: 内容审核不通过，请调整 prompt")
    assert vendor_error_is_non_retryable(exc, "minimax") is False


def test_network_error_is_retryable_for_minimax_tts():
    """TTS 路径网络错（'consecutive N network errors'）应走默认重试。"""
    exc = RuntimeError("tts_sync 失败: consecutive 3 network errors last_err=ConnectionTimeout")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is False


def test_unrelated_runtime_error_is_retryable():
    exc = RuntimeError("Wan2.6 任务失败: 视频处理超时")
    assert vendor_error_is_non_retryable(exc, "wan26") is False


def test_unknown_vendor_falls_back_to_no_match():
    """未注册 vendor 不应抛错，永远返回 False（走默认重试）。"""
    exc = _http_error(401, "unauthorized")
    assert vendor_error_is_non_retryable(exc, "unknown_vendor_xyz") is False


# ──────────────────────────────────────────────────────────────────────
# 用户可读错误提示
# ──────────────────────────────────────────────────────────────────────


def test_user_facing_error_invalid_api_key_message():
    exc = _http_error(401, '{"error": "InvalidApiKey"}')
    msg = vendor_user_facing_error(exc, "sora2")
    assert "Sora2" in msg
    assert "API Key" in msg or "Key" in msg
    assert "后台" in msg  # 提示去后台切换


def test_user_facing_error_balance_message():
    exc = RuntimeError("MiniMax 任务失败: balance insufficient, status_code=1004")
    msg = vendor_user_facing_error(exc, "minimax")
    assert "MiniMax" in msg
    assert "余额" in msg or "额度" in msg


def test_user_facing_error_local_config_message():
    exc = RuntimeError("MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY")
    msg = vendor_user_facing_error(exc, "minimax_tts")
    assert "MiniMax" in msg
    assert "未配置" in msg or "配置" in msg


def test_user_facing_error_fallback_to_response_text():
    exc = _http_error(500, "internal error from server")
    msg = vendor_user_facing_error(exc, "sora2")
    # 5xx 不在 sora2 http_statuses (401,403,404) 范围内 → 走 fallback
    assert "Sora2" in msg
    assert "请求失败" in msg or "internal error" in msg


# ──────────────────────────────────────────────────────────────────────
# Regression: Seedance 薄壳与原实现等价
# ──────────────────────────────────────────────────────────────────────


def test_seedance_thin_shell_equivalent_for_401():
    """Seedance 薄壳（401 → True）与新通用函数（401 → 兜底空 profile → False）等价性。

    注意：seedance 走独立薄壳（不在 _VENDOR_ERROR_PROFILES），所以调用
    vendor_error_is_non_retryable(exc, "seedance") 会拿兜底空 profile。
    此处只验证：薄壳对 401 仍然返回 True（保留旧行为）。
    """
    exc = _http_error(401, '{"error": "Unauthorized"}')
    assert seedance_error_is_non_retryable(exc) is True


def test_seedance_thin_shell_equivalent_for_invalid_api_key_marker():
    """薄壳与原实现都用 InvalidApiKey marker 识别——两端独立 profile 都包含。"""
    exc = RuntimeError("Seedance 任务失败: InvalidApiKey - 当前 API Key 无效")
    assert seedance_error_is_non_retryable(exc) is True


def test_seedance_thin_shell_user_facing_preserves_message():
    """Seedance 薄壳必须保留原文案，不能改成通用模板。"""
    exc = RuntimeError("Seedance 失败: ModelNotOpen")
    msg = seedance_user_facing_error(exc)
    assert msg.startswith("Seedance 模型未开通：")
    assert "火山方舟" in msg  # 保留原特定指引


def test_seedance_thin_shell_user_facing_for_invalid_key():
    exc = _http_error(401, '{"error": "InvalidApiKey"}')
    msg = seedance_user_facing_error(exc)
    assert "Seedance API Key 无效或无权限" in msg


# ──────────────────────────────────────────────────────────────────────
# 5 套 profile 都已注册
# ──────────────────────────────────────────────────────────────────────


def test_all_five_vendor_profiles_registered():
    expected = {"sora2", "veo", "wan26", "minimax", "minimax_tts"}
    assert set(_VENDOR_ERROR_PROFILES.keys()) == expected


def test_each_profile_has_vendor_label():
    """每个 profile 必须有 vendor_label，否则用户文案会变 'Vendor'。"""
    for vendor, profile in _VENDOR_ERROR_PROFILES.items():
        assert profile.vendor_label, f"vendor={vendor} missing vendor_label"
        assert profile.vendor_label != vendor  # 中文 label ≠ 内部 key
def test_minimax_rate_limit_code_1002_remains_retryable():
    exc = RuntimeError("MiniMax task failed: status_code=1002 msg=rate limit")
    assert vendor_error_is_non_retryable(exc, "minimax") is False


def test_minimax_tts_system_error_code_1033_remains_retryable():
    exc = RuntimeError("tts_sync failed: status_code=1033 msg=system error")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is False


def test_minimax_code_only_auth_and_balance_are_non_retryable():
    assert vendor_error_is_non_retryable(RuntimeError("status_code=1004"), "minimax") is True
    assert vendor_error_is_non_retryable(RuntimeError("status_code=1008"), "minimax_tts") is True


def test_minimax_code_only_messages_are_actionable():
    auth_msg = vendor_user_facing_error(RuntimeError("status_code=1004"), "minimax")
    balance_msg = vendor_user_facing_error(RuntimeError("status_code=1008"), "minimax_tts")
    assert "MiniMax" in auth_msg and "Key" in auth_msg
    assert "MiniMax" in balance_msg and ("余额" in balance_msg or "额度" in balance_msg)
