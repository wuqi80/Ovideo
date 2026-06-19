"""Service layer for admin API configuration CRUD and diagnostics."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

from dao_api_config import ApiConfigDAO
from services.api_config_health_service import test_api_config_health
from services.api_provider_health_monitor import (
    delete_cached_provider_health_many,
    list_cached_provider_health,
)
from services.api_provider_registry import (
    get_api_model_presets,
    get_api_provider_catalog,
    normalize_provider,
    summarize_api_provider_configs,
)
from services.api_provider_runtime import build_provider_runtime_status


ReloadCallback = Callable[[], Awaitable[None]]
logger = logging.getLogger(__name__)


class ApiConfigServiceError(RuntimeError):
    pass


class ApiConfigNotFound(ApiConfigServiceError):
    pass


class ApiConfigCreateFailed(ApiConfigServiceError):
    pass


def _row_to_jsonable(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        raw = dict(row)
    else:
        raw = dict(row)
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        if isinstance(value, (datetime, date)):
            out[key] = value.isoformat()
        elif isinstance(value, Decimal):
            out[key] = float(value)
        else:
            out[key] = value
    return out


def mask_api_config_row(row: Any) -> Dict[str, Any]:
    data = _row_to_jsonable(row)
    if "api_key_encrypted" in data:
        data["api_key_encrypted"] = "***" if data["api_key_encrypted"] else ""
    return data


def _row_provider(row: Any) -> str:
    if not row:
        return ""
    getter = getattr(row, "get", None)
    if callable(getter):
        return str(getter("provider", "") or "").strip()
    try:
        return str(row["provider"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return str(getattr(row, "provider", "") or "").strip()


def _row_config_id(row: Any) -> str:
    if not row:
        return ""
    getter = getattr(row, "get", None)
    if callable(getter):
        return str(getter("config_id", "") or "").strip()
    try:
        return str(row["config_id"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return str(getattr(row, "config_id", "") or "").strip()


def _row_enabled(row: Any) -> bool:
    if not row:
        return False
    getter = getattr(row, "get", None)
    if callable(getter):
        return getter("enabled", True) is not False
    try:
        return row["enabled"] is not False
    except (KeyError, IndexError, TypeError):
        return getattr(row, "enabled", True) is not False


def _row_has_key(row: Any) -> bool:
    if not row:
        return False
    getter = getattr(row, "get", None)
    if callable(getter):
        return bool(getter("api_key_encrypted", ""))
    try:
        return bool(row["api_key_encrypted"])
    except (KeyError, IndexError, TypeError):
        return bool(getattr(row, "api_key_encrypted", ""))


async def _disable_conflicting_provider_configs(row: Any) -> List[str]:
    """Keep at most one enabled keyed config per provider.

    Runtime env has one key/endpoint slot per provider, so multiple enabled
    keyed rows cannot all be effective. Disable older siblings when a new row
    becomes the active keyed config.
    """
    provider = _row_provider(row)
    keep_id = _row_config_id(row)
    if not provider or not keep_id or not _row_enabled(row) or not _row_has_key(row):
        return []

    disabled: List[str] = []
    for other in await ApiConfigDAO.list_all():
        other_id = _row_config_id(other)
        if not other_id or other_id == keep_id:
            continue
        if _row_provider(other).lower() != provider.lower():
            continue
        if not _row_enabled(other) or not _row_has_key(other):
            continue
        await ApiConfigDAO.update(other_id, enabled=False)
        disabled.append(other_id)
    return disabled


async def _invalidate_provider_health(providers: Iterable[str]) -> None:
    provider_ids = [provider for provider in providers if provider]
    if not provider_ids:
        return
    try:
        await delete_cached_provider_health_many(provider_ids)
    except Exception as exc:
        logger.warning("Failed to invalidate provider health cache: %s", exc, exc_info=True)


async def list_api_configs() -> Dict[str, Any]:
    rows = await ApiConfigDAO.list_all()
    provider_health = await list_cached_provider_health()
    return {
        "success": True,
        "api_configs": [mask_api_config_row(row) for row in rows],
        "providers": get_api_provider_catalog(),
        "provider_status": summarize_api_provider_configs(rows),
        "runtime_status": build_provider_runtime_status(rows, provider_health=provider_health),
        "provider_health": provider_health,
    }


def get_api_config_presets() -> Dict[str, Any]:
    return {
        "success": True,
        "presets": get_api_model_presets(),
        "providers": get_api_provider_catalog(),
    }


async def create_api_config(
    *,
    name: str,
    provider: str,
    endpoint: str,
    api_key: str,
    model_name: str = "",
    proxy_mode: str = "direct",
    custom_proxy: str = "",
    category: str = "",
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    row = await ApiConfigDAO.create(
        name=name.strip(),
        provider=provider.strip(),
        endpoint=endpoint.strip(),
        api_key=api_key,
        model_name=model_name,
        proxy_mode=proxy_mode,
        custom_proxy=custom_proxy,
        category=category,
    )
    if not row:
        raise ApiConfigCreateFailed("Failed to create API config")
    disabled_conflicts = await _disable_conflicting_provider_configs(row)
    if reload_api_env:
        await reload_api_env()
    await _invalidate_provider_health([_row_provider(row)])
    return {
        "success": True,
        "api_config": mask_api_config_row(row),
        "disabled_conflicting_config_ids": disabled_conflicts,
    }


async def update_api_config(
    config_id: str,
    fields: Dict[str, Any],
    *,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    if not fields:
        row = await ApiConfigDAO.get_by_id(config_id)
        if not row:
            raise ApiConfigNotFound("Config not found")
        return {"success": True, "api_config": mask_api_config_row(row)}

    before = await ApiConfigDAO.get_by_id(config_id)
    updated = await ApiConfigDAO.update(config_id, **fields)
    if not updated:
        raise ApiConfigNotFound("Config not found")
    disabled_conflicts = await _disable_conflicting_provider_configs(updated)
    if reload_api_env:
        await reload_api_env()
    await _invalidate_provider_health([_row_provider(before), _row_provider(updated)])
    return {
        "success": True,
        "api_config": mask_api_config_row(updated),
        "disabled_conflicting_config_ids": disabled_conflicts,
    }


async def delete_api_config(
    config_id: str,
    *,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    before = await ApiConfigDAO.get_by_id(config_id)
    ok = await ApiConfigDAO.delete(config_id)
    if not ok:
        raise ApiConfigNotFound("Config not found")
    if reload_api_env:
        await reload_api_env()
    await _invalidate_provider_health([_row_provider(before)])
    return {"success": True, "deleted": True}


async def repair_api_config_provider_conflicts(
    *,
    reload_api_env: Optional[ReloadCallback] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Disable historical duplicate enabled keyed rows per provider.

    This preserves the row that currently wins runtime projection. DAO list_all()
    is ordered the same way as list_enabled(), and load_api_configs_to_env()
    projects rows in that order, so the last enabled keyed row for a provider is
    kept active.
    """
    rows = list(await ApiConfigDAO.list_all())
    grouped: Dict[str, List[Any]] = {}
    for row in rows:
        provider = normalize_provider(_row_provider(row))
        if not provider or not _row_enabled(row) or not _row_has_key(row):
            continue
        grouped.setdefault(provider, []).append(row)

    conflicts: List[Dict[str, Any]] = []
    touched_providers: List[str] = []
    total_disabled = 0
    for provider, provider_rows in grouped.items():
        if len(provider_rows) <= 1:
            continue
        keep = provider_rows[-1]
        keep_id = _row_config_id(keep)
        disabled_ids = [_row_config_id(row) for row in provider_rows[:-1] if _row_config_id(row)]
        if not dry_run:
            for config_id in disabled_ids:
                await ApiConfigDAO.update(config_id, enabled=False)
        total_disabled += len(disabled_ids)
        touched_providers.append(provider)
        conflicts.append(
            {
                "provider": provider,
                "kept_config_id": keep_id,
                "disabled_config_ids": disabled_ids,
                "keyed_enabled_count": len(provider_rows),
                "dry_run": dry_run,
            }
        )

    if total_disabled and not dry_run and reload_api_env:
        await reload_api_env()
    if touched_providers and not dry_run:
        await _invalidate_provider_health(touched_providers)

    return {
        "success": True,
        "dry_run": dry_run,
        "conflicts": conflicts,
        "total_conflicts": len(conflicts),
        "total_disabled": total_disabled if not dry_run else 0,
        "would_disable": total_disabled,
    }


async def test_saved_api_config_health(config_id: str) -> Dict[str, Any]:
    row = await ApiConfigDAO.get_by_id(config_id)
    if not row:
        raise ApiConfigNotFound("Config not found")
    key = await ApiConfigDAO.get_decrypted_key(config_id)
    return await test_api_config_health(row, key or "")


def summarize_config_test_results(results: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    rows = list(results)
    ok = 0
    no_key = 0
    auth_error = 0
    error = 0
    for item in rows:
        test = item.get("test") or {}
        if test.get("ok"):
            ok += 1
            continue
        if test.get("error") == "No API key configured":
            no_key += 1
        elif test.get("auth_ok") is False:
            auth_error += 1
        else:
            error += 1
    return {
        "total": len(rows),
        "ok": ok,
        "no_key": no_key,
        "auth_error": auth_error,
        "error": error,
    }


async def test_all_saved_api_config_health(
    *,
    config_ids: Optional[Iterable[str]] = None,
    enabled_only: bool = False,
    concurrency: Optional[int] = None,
) -> Dict[str, Any]:
    rows = list(await ApiConfigDAO.list_all())
    if config_ids:
        wanted = {str(config_id) for config_id in config_ids if config_id}
        rows = [row for row in rows if str(row.get("config_id") or "") in wanted]
    if enabled_only:
        rows = [row for row in rows if bool(row.get("enabled"))]

    limit = max(1, min(int(concurrency or 3), 8))
    sem = asyncio.Semaphore(limit)

    async def one(row: Dict[str, Any]) -> Dict[str, Any]:
        config_id = str(row.get("config_id") or "")
        async with sem:
            try:
                key = await ApiConfigDAO.get_decrypted_key(config_id)
                result = await test_api_config_health(row, key or "")
                test = result.get("test") or {}
            except Exception as exc:
                logger.warning("API config batch test failed for %s: %s", config_id, exc, exc_info=True)
                test = {
                    "ok": False,
                    "reachable": False,
                    "auth_ok": False,
                    "status_code": None,
                    "url": None,
                    "error": str(exc),
                    "provider": row.get("provider") or None,
                    "model_name": row.get("model_name") or None,
                    "method": "GET",
                    "urls_tried": [],
                    "checked_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                }
            return {
                "config_id": config_id,
                "name": row.get("name"),
                "provider": row.get("provider"),
                "model_name": row.get("model_name"),
                "enabled": bool(row.get("enabled")),
                "test": test,
            }

    results: List[Dict[str, Any]] = list(await asyncio.gather(*(one(row) for row in rows)))
    return {
        "success": True,
        "config_tests": results,
        "summary": summarize_config_test_results(results),
    }
