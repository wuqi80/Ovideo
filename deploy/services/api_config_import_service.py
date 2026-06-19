"""Import preset API configurations into the admin API config store."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional

from dao_api_config import ApiConfigDAO
from services.api_provider_health_monitor import delete_cached_provider_health_many
from services.api_provider_registry import get_api_model_presets
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ApiConfigImportOptions:
    copy_runtime_env_keys: bool = False
    update_existing_empty_keys: bool = True
    enable_copied_keys: bool = True
    dry_run: bool = False


ReloadCallback = Callable[[], Awaitable[bool]]


def _row_get(row: Any, key: str, default: Any = None) -> Any:
    getter = getattr(row, "get", None)
    if callable(getter):
        return getter(key, default)
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        pass
    return getattr(row, key, default)


async def import_preset_api_configs(
    options: Optional[ApiConfigImportOptions] = None,
    *,
    reload_api_env: Optional[ReloadCallback] = None,
    presets: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    """Create/update API config rows from the central provider registry.

    The service is intentionally independent from FastAPI so the import policy
    can be contract-tested without hitting a real database or HTTP route.
    """
    options = options or ApiConfigImportOptions()
    preset_models = presets or get_api_model_presets()
    existing = await ApiConfigDAO.list_all()
    existing_by_key = {
        (_row_get(r, "provider", ""), _row_get(r, "model_name", "")): r
        for r in existing
    }
    keyed_provider_sources: Dict[str, Any] = {}
    for row in existing:
        provider = _row_get(row, "provider", "")
        if provider and _row_get(row, "api_key_encrypted", "") and provider not in keyed_provider_sources:
            keyed_provider_sources[provider] = row

    imported = 0
    skipped = 0
    env_keys_imported = 0
    env_keys_missing = 0
    env_keys_existing = 0
    env_keys_skipped_provider_claimed = 0
    updated_existing = 0
    enabled_existing = 0
    planned_actions: List[Dict[str, Any]] = []
    touched_providers: set[str] = set()

    for preset in preset_models:
        key = (preset["provider"], preset["model_name"])
        provider = preset["provider"]
        existing_row = existing_by_key.get(key)
        resolved = resolve_provider(preset["provider"], preset["model_name"])
        provider_already_has_key = provider in keyed_provider_sources
        should_copy_runtime_key = bool(
            options.copy_runtime_env_keys
            and resolved.has_key
            and not provider_already_has_key
        )
        runtime_key = resolved.api_key if should_copy_runtime_key else ""
        endpoint = resolved.endpoint or preset["endpoint"]
        proxy_mode = resolved.proxy_config.get("mode") or preset["proxy_mode"] or "direct"
        custom_proxy = (resolved.proxy_config.get("custom_proxy") or "") if options.copy_runtime_env_keys else ""

        if existing_row:
            has_db_key = bool(_row_get(existing_row, "api_key_encrypted", ""))
            if options.copy_runtime_env_keys:
                if has_db_key:
                    env_keys_existing += 1
                    planned_actions.append(
                        {
                            "action": "skip_existing_key",
                            "provider": provider,
                            "model_name": preset["model_name"],
                            "config_id": _row_get(existing_row, "config_id", ""),
                            "name": _row_get(existing_row, "name", ""),
                        }
                    )
                elif should_copy_runtime_key and options.update_existing_empty_keys:
                    update_fields: Dict[str, Any] = {
                        "api_key": runtime_key,
                        "endpoint": endpoint,
                        "proxy_mode": proxy_mode,
                        "custom_proxy": custom_proxy,
                        "category": preset.get("category", ""),
                    }
                    if options.enable_copied_keys:
                        update_fields["enabled"] = True
                        if _row_get(existing_row, "enabled", True) is False:
                            enabled_existing += 1
                    planned_actions.append(
                        {
                            "action": "update_existing_empty_key",
                            "provider": provider,
                            "model_name": preset["model_name"],
                            "config_id": _row_get(existing_row, "config_id", ""),
                            "name": _row_get(existing_row, "name", ""),
                            "endpoint": endpoint,
                            "will_enable": bool(update_fields.get("enabled")),
                            "will_copy_key": True,
                        }
                    )
                    if not options.dry_run:
                        await ApiConfigDAO.update(_row_get(existing_row, "config_id", ""), **update_fields)
                    touched_providers.add(provider)
                    keyed_provider_sources[provider] = existing_row
                    env_keys_imported += 1
                    updated_existing += 1
                elif resolved.has_key and provider_already_has_key:
                    env_keys_skipped_provider_claimed += 1
                    planned_actions.append(
                        {
                            "action": "skip_provider_key_already_claimed",
                            "provider": provider,
                            "model_name": preset["model_name"],
                            "config_id": _row_get(existing_row, "config_id", ""),
                            "name": _row_get(existing_row, "name", ""),
                        }
                    )
                else:
                    env_keys_missing += 1
                    planned_actions.append(
                        {
                            "action": "skip_missing_runtime_key",
                            "provider": provider,
                            "model_name": preset["model_name"],
                            "config_id": _row_get(existing_row, "config_id", ""),
                            "name": _row_get(existing_row, "name", ""),
                        }
                    )
            skipped += 1
            continue

        if options.copy_runtime_env_keys and resolved.has_key and provider_already_has_key:
            env_keys_skipped_provider_claimed += 1
            planned_actions.append(
                {
                    "action": "create_placeholder_provider_key_already_claimed",
                    "provider": provider,
                    "model_name": preset["model_name"],
                    "name": preset["name"],
                    "endpoint": endpoint,
                    "will_copy_key": False,
                }
            )
        elif options.copy_runtime_env_keys and not runtime_key:
            env_keys_missing += 1
            planned_actions.append(
                {
                    "action": "create_placeholder_missing_runtime_key",
                    "provider": provider,
                    "model_name": preset["model_name"],
                    "name": preset["name"],
                    "endpoint": endpoint,
                    "will_copy_key": False,
                }
            )
        else:
            planned_actions.append(
                {
                    "action": "create_config",
                    "provider": provider,
                    "model_name": preset["model_name"],
                    "name": preset["name"],
                    "endpoint": endpoint,
                    "will_copy_key": bool(runtime_key),
                }
            )
        if not options.dry_run:
            await ApiConfigDAO.create(
                name=preset["name"],
                provider=preset["provider"],
                endpoint=endpoint,
                api_key=runtime_key,
                model_name=preset["model_name"],
                proxy_mode=proxy_mode,
                custom_proxy=custom_proxy,
                category=preset.get("category", ""),
            )
            touched_providers.add(provider)
        if options.copy_runtime_env_keys and runtime_key:
            keyed_provider_sources[provider] = {"provider": provider}
            env_keys_imported += 1
        imported += 1

    env_refreshed = None
    if not options.dry_run and (imported or updated_existing) and reload_api_env:
        env_refreshed = await reload_api_env()

    health_cache_invalidated: List[str] = []
    if not options.dry_run and touched_providers:
        try:
            health_cache_invalidated = await delete_cached_provider_health_many(touched_providers)
        except Exception as exc:
            logger.warning("Failed to invalidate provider health cache after preset import: %s", exc, exc_info=True)

    return {
        "success": True,
        "dry_run": options.dry_run,
        "imported": imported,
        "skipped": skipped,
        "total": len(preset_models),
        "copy_runtime_env_keys": options.copy_runtime_env_keys,
        "env_keys_imported": env_keys_imported,
        "env_keys_missing": env_keys_missing,
        "env_keys_existing": env_keys_existing,
        "env_keys_skipped_provider_claimed": env_keys_skipped_provider_claimed,
        "updated_existing": updated_existing,
        "enabled_existing": enabled_existing,
        "env_refreshed": env_refreshed,
        "health_cache_invalidated": health_cache_invalidated,
        "planned_actions": planned_actions,
    }
