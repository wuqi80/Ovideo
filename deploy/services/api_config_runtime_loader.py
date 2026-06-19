"""Runtime loader for admin API configurations.

The admin API stores provider keys and endpoints in the database. This service
is the single place that projects those rows into process environment variables
for the provider resolver.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from dao_api_config import ApiConfigDAO
from services.api_provider_registry import (
    PROVIDER_ENV_MAP,
    get_api_model_preset,
    get_custom_proxy_env_key,
    get_endpoint_env_key,
    get_gpt_image_tiers,
    get_model_env_key,
    get_provider_env_key,
    get_proxy_mode_env_key,
)
from utils.config_helpers import _config_get

logger = logging.getLogger(__name__)


LEGACY_API_KEY_GLOBALS = (
    "DEEPSEEK_API_KEY",
    "ARK_API_KEY",
    "GEMINI_TEXT_API_KEY",
    "GEMINI_IMAGE_API_KEY",
    "GPT_IMAGE_API_KEY",
    "SORA2_GPT_IMAGE_API_KEY",
)

GEMINI_IMAGE_LEGACY_MODELS = {
    "gemini-3-pro-image-preview",
    "gemini-3.0-pro-image",
    "nanobanana",
}
GEMINI_IMAGE_NEW_MODEL = "gemini-3.1-flash-image-preview"
GEMINI_TTS_LEGACY_MODELS = {"gemini-2.0-flash"}
GEMINI_TTS_NEW_MODEL = "gemini-2.5-flash-preview-tts"


def managed_api_env_keys() -> set[str]:
    keys: set[str] = set()
    for env_key in PROVIDER_ENV_MAP.values():
        keys.update(
            {
                env_key,
                get_endpoint_env_key(env_key),
                get_proxy_mode_env_key(env_key),
                get_custom_proxy_env_key(env_key),
                get_model_env_key(env_key),
            }
        )
    return keys


_BASE_API_ENV_VALUES = {key: os.environ.get(key) for key in managed_api_env_keys()}


def reset_managed_api_env_to_baseline() -> None:
    for key, value in _BASE_API_ENV_VALUES.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def runtime_api_key_globals() -> Dict[str, str | None]:
    return {key: os.environ.get(key) for key in LEGACY_API_KEY_GLOBALS}


async def load_api_configs_to_env() -> Dict[str, Any]:
    """Load enabled DB configs into managed env vars for resolve_provider()."""
    try:
        configs = await ApiConfigDAO.list_enabled()
        new_env: Dict[str, Optional[str]] = dict(_BASE_API_ENV_VALUES)
        loaded = 0
        loaded_providers: List[str] = []
        for config in configs:
            provider = str(_config_get(config, "provider", "") or "")
            env_key = get_provider_env_key(provider)
            if not env_key:
                continue
            enc = _config_get(config, "api_key_encrypted", "")
            if not enc:
                continue
            api_key = ApiConfigDAO.decrypt_key(enc)
            if not api_key:
                continue

            new_env[env_key] = api_key
            loaded += 1
            loaded_providers.append(provider.strip().lower())

            endpoint = str(_config_get(config, "endpoint", "") or "").strip()
            endpoint_env = get_endpoint_env_key(env_key)
            if endpoint:
                new_env[endpoint_env] = endpoint
            else:
                new_env[endpoint_env] = None

            proxy_mode = str(_config_get(config, "proxy_mode", "direct") or "direct").strip()
            new_env[get_proxy_mode_env_key(env_key)] = proxy_mode

            custom_proxy = str(_config_get(config, "custom_proxy", "") or "").strip()
            custom_proxy_env = get_custom_proxy_env_key(env_key)
            if custom_proxy:
                new_env[custom_proxy_env] = custom_proxy
            else:
                new_env[custom_proxy_env] = None

            model_name = str(_config_get(config, "model_name", "") or "").strip()
            model_env = get_model_env_key(env_key)
            if model_name:
                new_env[model_env] = model_name
            else:
                new_env[model_env] = None

        reset_managed_api_env_to_baseline()
        for key, value in new_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

        deepseek_key = os.environ.get("DEEPSEEK_API_KEY")
        if deepseek_key:
            logger.info("DeepSeek config loaded/refreshed (key=%s...)", deepseek_key[:8])
        logger.info("Loaded %s API configs from database into runtime env", loaded)
        return {
            "success": True,
            "loaded": loaded,
            "loaded_providers": loaded_providers,
        }
    except Exception as exc:
        logger.warning("Failed to load API configs from database; falling back to env: %s", exc, exc_info=True)
        return {"success": False, "loaded": 0, "error": str(exc)}


def _gpt_image_seed_specs() -> List[Dict[str, str]]:
    specs: List[Dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for tier in get_gpt_image_tiers().values():
        provider = str(tier.get("provider") or "").strip().lower()
        model_name = str(tier.get("model") or "").strip()
        if not provider or not model_name:
            continue
        key = (provider, model_name)
        if key in seen:
            continue
        seen.add(key)
        preset = get_api_model_preset(provider, model_name) or {}
        specs.append(
            {
                "provider": provider,
                "name": preset.get("name") or provider,
                "endpoint": preset.get("endpoint") or "",
                "model_name": model_name,
                "category": preset.get("category") or "image",
                "proxy_mode": preset.get("proxy_mode") or "direct",
            }
        )
    return specs


async def seed_default_api_providers() -> Dict[str, Any]:
    """Idempotently seed API config placeholders required by the admin UI."""
    try:
        existing = await ApiConfigDAO.list_all()
        existing_providers = {
            str(_config_get(row, "provider", "") or "").strip().lower()
            for row in existing
        }

        created = 0
        for spec in _gpt_image_seed_specs():
            if spec["provider"] in existing_providers:
                continue
            row = await ApiConfigDAO.create(
                name=spec["name"],
                provider=spec["provider"],
                endpoint=spec["endpoint"],
                api_key="",
                model_name=spec["model_name"],
                proxy_mode=spec["proxy_mode"],
                category=spec["category"],
            )
            if row:
                await ApiConfigDAO.update(row["config_id"], enabled=False)
                existing_providers.add(spec["provider"])
                created += 1
                logger.info("Created API config placeholder: %s (%s)", spec["name"], spec["provider"])

        upgraded = 0
        for row in existing:
            provider = str(_config_get(row, "provider", "") or "").strip().lower()
            if provider != "gemini-image":
                continue
            model_name = str(_config_get(row, "model_name", "") or "").strip()
            if model_name not in GEMINI_IMAGE_LEGACY_MODELS:
                continue

            old_name = str(_config_get(row, "name", "") or "")
            new_name = old_name
            if "Pro" in old_name or "pro" in old_name:
                new_name = new_name.replace("Gemini 3 Pro", "Gemini 3.1 Flash")
                new_name = new_name.replace("Gemini 3.0 Pro", "Gemini 3.1 Flash")
                new_name = new_name.replace("gemini-3-pro", "gemini-3.1-flash")
            update_kwargs: Dict[str, Any] = {"model_name": GEMINI_IMAGE_NEW_MODEL}
            if new_name != old_name:
                update_kwargs["name"] = new_name
            await ApiConfigDAO.update(_config_get(row, "config_id", ""), **update_kwargs)
            upgraded += 1
            logger.info(
                "Upgraded Gemini image API config %r from %s to %s",
                old_name,
                model_name,
                GEMINI_IMAGE_NEW_MODEL,
            )

        for row in existing:
            provider = str(_config_get(row, "provider", "") or "").strip().lower()
            if provider != "gemini-tts":
                continue
            model_name = str(_config_get(row, "model_name", "") or "").strip()
            if model_name not in GEMINI_TTS_LEGACY_MODELS:
                continue

            old_name = str(_config_get(row, "name", "") or "")
            await ApiConfigDAO.update(_config_get(row, "config_id", ""), model_name=GEMINI_TTS_NEW_MODEL)
            upgraded += 1
            logger.info(
                "Upgraded Gemini TTS API config %r from %s to %s",
                old_name,
                model_name,
                GEMINI_TTS_NEW_MODEL,
            )

        if created or upgraded:
            logger.info("API config seed complete: created=%s upgraded=%s", created, upgraded)
        else:
            logger.debug("API config seed complete: no changes")
        return {"success": True, "created": created, "upgraded": upgraded}
    except Exception as exc:
        logger.warning("API config seed failed; startup will continue: %s", exc, exc_info=True)
        return {"success": False, "created": 0, "upgraded": 0, "error": str(exc)}
