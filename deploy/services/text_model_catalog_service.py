"""Public, secret-free text model metadata for authenticated frontend clients."""
from __future__ import annotations

from typing import Any, Dict, List

from services.ai_proxy_chat_service import resolve_ai_proxy_provider
from services.api_provider_runtime import resolve_provider


async def build_text_model_catalog() -> List[Dict[str, Any]]:
    """Describe the effective models used by the three stable frontend choices.

    Frontend values and DeepSeek operation identifiers are deliberately stable.
    Only provider/model display metadata follows the effective runtime config.
    """
    gemini_config, gemini_failover = await resolve_ai_proxy_provider("gemini-text")
    reasoner_config = resolve_provider("deepseek", "deepseek-reasoner")
    chat_config = resolve_provider("deepseek", "deepseek-chat")

    return [
        {
            "value": "gemini",
            "label": "化神",
            "operation": "gemini-text",
            "requested_provider": "gemini-text",
            "provider": gemini_config.provider,
            "runtime_model_name": gemini_config.model_name or "gemini-2.5-flash",
            "failover_active": bool(gemini_failover.get("active")),
        },
        {
            "value": "deepseek",
            "label": "筑基",
            "operation": "deepseek-reasoner",
            "requested_provider": "deepseek",
            "provider": reasoner_config.provider,
            "runtime_model_name": reasoner_config.model_name or "deepseek-v4-pro",
            "failover_active": False,
        },
        {
            "value": "deepseek-chat",
            "label": "金丹",
            "operation": "deepseek-chat",
            "requested_provider": "deepseek",
            "provider": chat_config.provider,
            "runtime_model_name": chat_config.model_name or "deepseek-v4-flash",
            "failover_active": False,
        },
    ]
