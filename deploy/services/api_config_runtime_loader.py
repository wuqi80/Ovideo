"""Runtime loader for admin API configurations.

The admin API stores provider keys and endpoints in the database. This service
is the single place that projects those rows into process environment variables
for the provider resolver.
"""
from __future__ import annotations

import logging
import json
import os
from typing import Any, Dict, List, Optional

from dao.admin.api_config import ApiConfigDAO
from services.api_provider_registry import (
    DASHSCOPE_SUB_MODEL_ENV_MAP,
    DEEPSEEK_OPERATION_MODEL_ENV_MAP,
    MINIMAX_OPERATION_MODEL_ENV_MAP,
    PROVIDER_EXTRA_ENV_MAP,
    PROVIDER_ENV_MAP,
    SEEDANCE_SUB_MODEL_ENV_MAP,
    SORA2_DEFAULT_VIDEO_MODEL,
    SORA2_LEGACY_VIDEO_MODELS,
    VEO_DEFAULT_VIDEO_MODEL,
    VEO_LEGACY_VIDEO_MODELS,
    dashscope_sub_model_for_model,
    get_api_model_preset,
    get_custom_proxy_env_key,
    get_deepseek_operation_model_env_key,
    get_dashscope_sub_model_env_key,
    get_endpoint_env_key,
    get_gpt_image_tiers,
    get_model_env_key,
    get_minimax_operation_model_env_key,
    get_provider_default_endpoint,
    get_provider_extra_env_keys,
    get_provider_env_key,
    get_proxy_mode_env_key,
    get_scoped_model_env_key,
    get_seedance_sub_model_env_key,
    infer_model_binding_operation,
    MODEL_USAGE_SCOPES,
    MODEL_USAGE_SCOPE_WORKFLOW,
    normalize_deepseek_model_name,
    normalize_doubao_image_endpoint,
    normalize_doubao_image_model_for_endpoint,
    normalize_model_bindings,
    normalize_model_usage_scope,
    normalize_provider,
    normalize_seedance_endpoint,
    normalize_seedance_model_for_endpoint,
    primary_model_name_for_bindings,
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
SORA2_NEW_MODEL = SORA2_DEFAULT_VIDEO_MODEL
VEO_NEW_MODEL = VEO_DEFAULT_VIDEO_MODEL
def managed_api_env_keys() -> set[str]:
    keys: set[str] = (
        set(SEEDANCE_SUB_MODEL_ENV_MAP.values())
        | set(DASHSCOPE_SUB_MODEL_ENV_MAP.values())
        | set(DEEPSEEK_OPERATION_MODEL_ENV_MAP.values())
        | set(MINIMAX_OPERATION_MODEL_ENV_MAP.values())
    )
    for field_map in PROVIDER_EXTRA_ENV_MAP.values():
        keys.update(field_map.values())
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
        for scope in MODEL_USAGE_SCOPES:
            scoped_model_env = get_scoped_model_env_key(get_model_env_key(env_key), scope)
            if scoped_model_env:
                keys.add(scoped_model_env)
    for operation_model_env in (
        set(SEEDANCE_SUB_MODEL_ENV_MAP.values())
        | set(DASHSCOPE_SUB_MODEL_ENV_MAP.values())
        | set(DEEPSEEK_OPERATION_MODEL_ENV_MAP.values())
        | set(MINIMAX_OPERATION_MODEL_ENV_MAP.values())
    ):
        for scope in MODEL_USAGE_SCOPES:
            scoped_model_env = get_scoped_model_env_key(operation_model_env, scope)
            if scoped_model_env:
                keys.add(scoped_model_env)
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


def _json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _config_extra_value(config: Any, field: str) -> Optional[str]:
    request_template = _json_object(_config_get(config, "request_template", {}))
    value = request_template.get(field)
    if value is None:
        value = request_template.get(f"minimax_{field}")
    if value is None:
        headers = _json_object(_config_get(config, "headers", {}))
        value = headers.get(f"X-MiniMax-{field.replace('_', '-').title()}")
    if value is None:
        return None
    return str(value).strip()


def _bindings_with_replaced_primary_model(config: Any, model_name: str) -> List[Dict[str, str]]:
    provider = str(_config_get(config, "provider", "") or "")
    old_model = str(_config_get(config, "model_name", "") or "").strip()
    bindings = normalize_model_bindings(
        provider,
        _config_get(config, "model_bindings", []),
        old_model,
    )
    replaced = False
    updated: List[Dict[str, str]] = []
    for binding in bindings:
        if not replaced and str(binding.get("model_name") or "").strip() == old_model:
            updated.append({**binding, "model_name": model_name})
            replaced = True
        else:
            updated.append(binding)
    if not replaced:
        updated = normalize_model_bindings(provider, [], model_name)
    return updated


def _explicit_runtime_binding_keys(
    provider: str,
    raw_bindings: Any,
    legacy_model_name: str,
) -> set[tuple[str, str]]:
    """Identify bindings explicitly stored on one card, excluding registry defaults."""
    if isinstance(raw_bindings, str):
        try:
            raw_bindings = json.loads(raw_bindings) if raw_bindings.strip() else []
        except json.JSONDecodeError:
            raw_bindings = []
    items = raw_bindings if isinstance(raw_bindings, list) else []
    provider_id = normalize_provider(provider)
    keys: set[tuple[str, str]] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        model_name = str(item.get("model_name") or "").strip()
        if not model_name:
            continue
        if provider_id == "deepseek":
            model_name = normalize_deepseek_model_name(model_name)
        raw_scope = item.get("scope")
        scopes = (
            MODEL_USAGE_SCOPES
            if raw_scope is None or not str(raw_scope).strip()
            else (normalize_model_usage_scope(raw_scope),)
        )
        operation = str(item.get("operation") or "").strip().lower()
        inferred_operation = infer_model_binding_operation(provider, model_name)
        if provider_id == "doubao":
            operation = "generate"
        elif not operation or (operation == "default" and inferred_operation != "default"):
            operation = inferred_operation
        keys.update((scope, operation) for scope in scopes)
    if not keys and legacy_model_name:
        fallback_model = legacy_model_name
        if provider_id == "deepseek":
            fallback_model = normalize_deepseek_model_name(fallback_model)
        keys.add(
            (
                MODEL_USAGE_SCOPE_WORKFLOW,
                infer_model_binding_operation(provider, fallback_model),
            )
        )
    return keys


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
            provider_id = normalize_provider(provider)
            if provider_id == "doubao":
                endpoint = normalize_doubao_image_endpoint(endpoint)
            elif provider_id == "seedance":
                endpoint = normalize_seedance_endpoint(endpoint)
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

            for field, extra_env_key in get_provider_extra_env_keys(provider).items():
                extra_value = _config_extra_value(config, field)
                if extra_value is not None:
                    new_env[extra_env_key] = extra_value or None

            model_name = str(_config_get(config, "model_name", "") or "").strip()
            raw_bindings = _config_get(config, "model_bindings", [])
            explicit_runtime_binding_keys = _explicit_runtime_binding_keys(
                provider,
                raw_bindings,
                model_name,
            )
            bindings = normalize_model_bindings(
                provider,
                raw_bindings,
                model_name,
            )
            if provider_id == "doubao":
                bindings = normalize_model_bindings(
                    provider,
                    [
                        {
                            **binding,
                            "model_name": normalize_doubao_image_model_for_endpoint(
                                binding.get("model_name"),
                                endpoint,
                            ),
                        }
                        for binding in bindings
                    ],
                )
            elif provider_id == "seedance":
                bindings = normalize_model_bindings(
                    provider,
                    [
                        {
                            **binding,
                            "model_name": normalize_seedance_model_for_endpoint(
                                binding.get("model_name"),
                                endpoint,
                                binding.get("operation"),
                            ),
                        }
                        for binding in bindings
                    ],
                )
            model_env = get_model_env_key(env_key)
            for scope in MODEL_USAGE_SCOPES:
                primary_model = primary_model_name_for_bindings(bindings, model_name, scope=scope)
                target_model_env = get_scoped_model_env_key(model_env, scope)
                if not target_model_env:
                    continue
                if primary_model:
                    new_env[target_model_env] = primary_model
                elif scope == MODEL_USAGE_SCOPE_WORKFLOW:
                    new_env[target_model_env] = None
            for binding in bindings:
                scope = normalize_model_usage_scope(binding.get("scope"))
                operation = str(binding.get("operation") or "").strip().lower()
                bound_model = str(binding.get("model_name") or "").strip()
                if not operation or not bound_model:
                    continue
                if (scope, operation) not in explicit_runtime_binding_keys:
                    continue
                if provider_id == "seedance" and operation in SEEDANCE_SUB_MODEL_ENV_MAP:
                    sub_model = operation
                    new_env[get_scoped_model_env_key(get_seedance_sub_model_env_key(sub_model), scope)] = bound_model
                if provider_id == "deepseek" and operation in DEEPSEEK_OPERATION_MODEL_ENV_MAP:
                    new_env[get_scoped_model_env_key(get_deepseek_operation_model_env_key(operation), scope)] = bound_model
                if provider_id == "minimax" and operation in MINIMAX_OPERATION_MODEL_ENV_MAP:
                    new_env[get_scoped_model_env_key(get_minimax_operation_model_env_key(operation), scope)] = bound_model
                if provider.strip().lower() == "dashscope":
                    binding_model_name = bound_model
                    dashscope_sub_model = dashscope_sub_model_for_model(binding_model_name)
                    if not dashscope_sub_model and operation in DASHSCOPE_SUB_MODEL_ENV_MAP:
                        dashscope_sub_model = operation
                    if dashscope_sub_model:
                        new_env[get_scoped_model_env_key(get_dashscope_sub_model_env_key(dashscope_sub_model), scope)] = bound_model

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
        retired = 0
        active_existing = []
        for row in existing:
            provider = str(_config_get(row, "provider", "") or "").strip().lower()
            if provider != "gemini-tts":
                active_existing.append(row)
                continue
            config_id = _config_get(row, "config_id", "")
            if not await ApiConfigDAO.delete(config_id):
                raise RuntimeError(f"Failed to retire Gemini TTS API config: {config_id}")
            retired += 1
            logger.info("Retired Gemini TTS API config: %s", config_id)
        existing = active_existing
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
                model_bindings=normalize_model_bindings(
                    spec["provider"],
                    [],
                    spec["model_name"],
                ),
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
            update_kwargs: Dict[str, Any] = {
                "model_name": GEMINI_IMAGE_NEW_MODEL,
                "model_bindings": _bindings_with_replaced_primary_model(row, GEMINI_IMAGE_NEW_MODEL),
            }
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
            if provider != "sora2":
                continue
            model_name = str(_config_get(row, "model_name", "") or "").strip()
            if model_name not in SORA2_LEGACY_VIDEO_MODELS:
                continue

            old_name = str(_config_get(row, "name", "") or "")
            await ApiConfigDAO.update(
                _config_get(row, "config_id", ""),
                model_name=SORA2_NEW_MODEL,
                model_bindings=_bindings_with_replaced_primary_model(row, SORA2_NEW_MODEL),
            )
            upgraded += 1
            logger.info(
                "Upgraded Sora2 API config %r from %s to %s",
                old_name,
                model_name,
                SORA2_NEW_MODEL,
            )

        for row in existing:
            provider = str(_config_get(row, "provider", "") or "").strip().lower()
            if provider != "veo":
                continue
            model_name = str(_config_get(row, "model_name", "") or "").strip()
            if model_name not in VEO_LEGACY_VIDEO_MODELS:
                continue

            old_name = str(_config_get(row, "name", "") or "")
            await ApiConfigDAO.update(
                _config_get(row, "config_id", ""),
                model_name=VEO_NEW_MODEL,
                model_bindings=_bindings_with_replaced_primary_model(row, VEO_NEW_MODEL),
            )
            upgraded += 1
            logger.info(
                "Upgraded Veo API config %r from %s to %s",
                old_name,
                model_name,
                VEO_NEW_MODEL,
            )

        if created or upgraded or retired:
            logger.info(
                "API config seed complete: created=%s upgraded=%s retired=%s",
                created,
                upgraded,
                retired,
            )
        else:
            logger.debug("API config seed complete: no changes")
        return {"success": True, "created": created, "upgraded": upgraded, "retired": retired}
    except Exception as exc:
        logger.warning("API config seed failed; startup will continue: %s", exc, exc_info=True)
        return {"success": False, "created": 0, "upgraded": 0, "retired": 0, "error": str(exc)}
