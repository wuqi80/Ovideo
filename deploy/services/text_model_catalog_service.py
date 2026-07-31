"""Public, secret-free text model metadata for authenticated frontend clients."""
from __future__ import annotations

from typing import Any, Dict, List

from services.ai_proxy_chat_service import resolve_ai_proxy_provider
from services.api_provider_registry import MODEL_USAGE_SCOPE_WORKFLOW, normalize_model_usage_scope


async def build_text_model_catalog(
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> List[Dict[str, Any]]:
    """Describe public text-model choices used by the stable frontend selector.

    Frontend values and operation identifiers are deliberately stable.
    Public labels stay provider-free. Runtime/provider mapping belongs to the
    admin API configuration surface and is intentionally omitted here.
    """
    model_scope = normalize_model_usage_scope(usage_scope)
    _, gemini_failover = await resolve_ai_proxy_provider("gemini-text", usage_scope=model_scope)

    return [
        {
            "value": "minimax-m3",
            "label": "一阶 · 连续写作模型",
            "hint": "适合持续",
            "billing_model": "script_tier_1",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "deepseek-chat",
            "label": "二阶 · 快速写作模型",
            "hint": "速度优先",
            "billing_model": "script_tier_2",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "deepseek",
            "label": "三阶 · 推理写作模型",
            "hint": "推理优先",
            "billing_model": "script_tier_3",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "gemini",
            "label": "四阶 · 全能写作模型",
            "hint": "综合全能",
            "billing_model": "script_tier_4",
            "model_scope": model_scope,
            "failover_active": bool(gemini_failover.get("active")),
        },
    ]
