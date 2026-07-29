"""Public, secret-free text model metadata for authenticated frontend clients."""
from __future__ import annotations

from typing import Any, Dict, List

from services.ai_proxy_chat_service import resolve_ai_proxy_provider
from services.api_provider_runtime import resolve_provider
from services.api_provider_registry import MODEL_USAGE_SCOPE_WORKFLOW, normalize_model_usage_scope


async def build_text_model_catalog(
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> List[Dict[str, Any]]:
    """Describe the effective models used by the stable frontend choices.

    Frontend values and DeepSeek operation identifiers are deliberately stable.
    Only provider/model display metadata follows the effective runtime config.
    """
    model_scope = normalize_model_usage_scope(usage_scope)
    gemini_config, gemini_failover = await resolve_ai_proxy_provider("gemini-text", usage_scope=model_scope)
    reasoner_config = resolve_provider("deepseek", "deepseek-reasoner", usage_scope=model_scope)
    chat_config = resolve_provider("deepseek", "deepseek-chat", usage_scope=model_scope)
    minimax_config = resolve_provider("minimax", "minimax-m3", usage_scope=model_scope)

    return [
        {
            "value": "minimax-m3",
            "label": "练气",
            "operation": "minimax-m3",
            "requested_provider": "minimax",
            "provider": minimax_config.provider,
            "runtime_model_name": minimax_config.model_name or "MiniMax-M3",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "gemini",
            "label": "化神",
            "operation": "gemini-text",
            "requested_provider": "gemini-text",
            "provider": gemini_config.provider,
            "runtime_model_name": gemini_config.model_name or "gemini-2.5-flash",
            "model_scope": model_scope,
            "failover_active": bool(gemini_failover.get("active")),
        },
        {
            "value": "deepseek",
            "label": "筑基",
            "operation": "deepseek-reasoner",
            "requested_provider": "deepseek",
            "provider": reasoner_config.provider,
            "runtime_model_name": reasoner_config.model_name or "deepseek-v4-pro",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "deepseek-chat",
            "label": "金丹",
            "operation": "deepseek-chat",
            "requested_provider": "deepseek",
            "provider": chat_config.provider,
            "runtime_model_name": chat_config.model_name or "deepseek-v4-flash",
            "model_scope": model_scope,
            "failover_active": False,
        },
    ]
