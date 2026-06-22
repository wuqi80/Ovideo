"""Service layer for admin API configuration CRUD and diagnostics."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

from dao.admin.api_config import ApiConfigDAO
from services.api_config_health_cache_service import (
    clear_all_provider_health_cache,
    invalidate_provider_health_for_items,
)
from services.api_config_health_service import test_api_config_health
from services.api_config_runtime_loader import load_api_configs_to_env
from services.api_provider_health_monitor import (
    list_cached_provider_health,
    provider_health_cache_key,
    provider_health_monitor_state,
)
from services.api_provider_registry import (
    get_api_model_presets,
    get_api_provider_catalog,
    normalize_provider,
    summarize_api_provider_configs,
)
from services.api_provider_runtime import build_provider_runtime_status, resolve_provider
from utils.config_helpers import _config_get


ReloadCallback = Callable[[], Awaitable[Any]]
logger = logging.getLogger(__name__)


class ApiConfigServiceError(RuntimeError):
    pass


class ApiConfigNotFound(ApiConfigServiceError):
    pass


class ApiConfigCreateFailed(ApiConfigServiceError):
    pass


class ApiConfigReloadFailed(ApiConfigServiceError):
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
    return str(_config_get(row, "provider", "") or "").strip()


def _row_model_name(row: Any) -> str:
    if not row:
        return ""
    return str(_config_get(row, "model_name", "") or "").strip()


def _row_config_id(row: Any) -> str:
    if not row:
        return ""
    return str(_config_get(row, "config_id", "") or "").strip()


def _row_enabled(row: Any) -> bool:
    if not row:
        return False
    return _config_get(row, "enabled", True) is not False


def _row_has_key(row: Any) -> bool:
    if not row:
        return False
    return bool(_config_get(row, "api_key_encrypted", ""))


def _endpoint_key(value: Any) -> str:
    return str(value or "").strip().rstrip("/").lower()


def _runtime_for_row(row: Any) -> Any:
    provider = normalize_provider(_row_provider(row))
    model_name = _row_model_name(row) or None
    return resolve_provider(provider, model_name)


def _test_row_and_endpoint_source(row: Any, runtime: Any) -> tuple[Dict[str, Any], str, bool]:
    test_row = _row_to_jsonable(row)
    row_endpoint = str(test_row.get("endpoint") or "").strip()
    if row_endpoint:
        return test_row, "db", False
    runtime_endpoint = str(getattr(runtime, "endpoint", "") or "").strip() if runtime else ""
    if not runtime_endpoint:
        return test_row, "missing", False
    test_row["endpoint"] = runtime_endpoint
    proxy_config = getattr(runtime, "proxy_config", {}) or {}
    test_row["proxy_mode"] = proxy_config.get("mode") or test_row.get("proxy_mode") or "direct"
    test_row["custom_proxy"] = proxy_config.get("custom_proxy") or test_row.get("custom_proxy") or ""
    return test_row, "runtime", True


def _annotate_config_health_test(
    test: Dict[str, Any],
    *,
    row: Any,
    runtime: Any,
    key_source: str,
    key_env: Optional[str],
    endpoint_source: str,
    used_runtime_endpoint: bool,
) -> None:
    test["key_source"] = key_source
    test["key_env"] = key_env
    test["used_runtime_key"] = key_source == "runtime"
    test["endpoint_source"] = endpoint_source
    test["used_runtime_endpoint"] = used_runtime_endpoint

    row_endpoint = str(_row_to_jsonable(row).get("endpoint") or "").strip()
    runtime_endpoint = str(getattr(runtime, "endpoint", "") or "").strip() if runtime else ""
    if runtime_endpoint:
        source = getattr(runtime, "source", {}) or {}
        test["runtime_endpoint"] = runtime_endpoint
        test["runtime_endpoint_source"] = source.get("endpoint") or "missing"
        test["runtime_endpoint_env"] = getattr(runtime, "endpoint_env", None)
        test["runtime_model_name"] = getattr(runtime, "model_name", "") or None
        test["endpoint_matches_runtime"] = (
            _endpoint_key(row_endpoint) == _endpoint_key(runtime_endpoint)
            if row_endpoint
            else used_runtime_endpoint
        )
    else:
        test["endpoint_matches_runtime"] = None


async def _disable_conflicting_provider_configs(row: Any) -> tuple[List[str], List[Any]]:
    """Keep at most one enabled keyed config per provider.

    Runtime env has one key/endpoint slot per provider, so multiple enabled
    keyed rows cannot all be effective. Disable older siblings when a new row
    becomes the active keyed config.
    """
    provider = _row_provider(row)
    keep_id = _row_config_id(row)
    if not provider or not keep_id or not _row_enabled(row) or not _row_has_key(row):
        return [], []

    disabled: List[str] = []
    disabled_rows: List[Any] = []
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
        disabled_rows.append(other)
    return disabled, disabled_rows


async def reload_api_env_runtime(*, clear_health_cache: bool = False) -> Dict[str, Any]:
    """Reload DB-backed provider config into env and optionally clear health cache."""
    try:
        result = await load_api_configs_to_env()
    except Exception as exc:
        if clear_health_cache:
            await clear_all_provider_health_cache()
        raise ApiConfigReloadFailed("API env reload failed") from exc

    refreshed = bool(result.get("success"))
    health_cache_invalidated: List[str] = []
    if not refreshed:
        if clear_health_cache:
            health_cache_invalidated = await clear_all_provider_health_cache()
        raise ApiConfigReloadFailed(str(result.get("error") or "API env reload failed"))

    if clear_health_cache:
        health_cache_invalidated = await clear_all_provider_health_cache()

    return {
        "success": refreshed,
        "env_refreshed": refreshed,
        "loaded": result.get("loaded", 0),
        "loaded_providers": result.get("loaded_providers", []),
        "health_cache_invalidated": health_cache_invalidated,
        "error": result.get("error"),
    }


def _env_refreshed_from_reload_result(result: Any) -> bool:
    if isinstance(result, dict):
        return bool(result.get("env_refreshed", result.get("success")))
    return bool(result)


async def _reload_api_env_after_write(reload_api_env: Optional[ReloadCallback] = None) -> bool:
    if reload_api_env:
        return _env_refreshed_from_reload_result(await reload_api_env())
    return _env_refreshed_from_reload_result(await reload_api_env_runtime())


async def list_api_configs() -> Dict[str, Any]:
    rows = await ApiConfigDAO.list_all()
    provider_health_targets = [
        {
            "provider": _row_provider(row),
            "model_name": _row_model_name(row) or None,
        }
        for row in rows
        if _row_provider(row)
    ]
    provider_health_by_key: Dict[str, Dict[str, Any]] = {}
    for item in await list_cached_provider_health():
        provider_health_by_key[
            provider_health_cache_key(str(item.get("provider") or ""), item.get("model_name"))
        ] = item
    for item in await list_cached_provider_health(targets=provider_health_targets):
        provider_health_by_key[
            provider_health_cache_key(str(item.get("provider") or ""), item.get("model_name"))
        ] = item
    provider_health = list(provider_health_by_key.values())
    return {
        "success": True,
        "api_configs": [mask_api_config_row(row) for row in rows],
        "providers": get_api_provider_catalog(),
        "provider_status": summarize_api_provider_configs(rows),
        "runtime_status": build_provider_runtime_status(rows, provider_health=provider_health),
        "provider_health": provider_health,
        "monitor_state": provider_health_monitor_state(),
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
    request_template: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, Any]] = None,
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
        request_template=request_template,
        headers=headers,
        category=category,
    )
    if not row:
        raise ApiConfigCreateFailed("Failed to create API config")
    disabled_conflicts, disabled_conflict_rows = await _disable_conflicting_provider_configs(row)
    env_refreshed = await _reload_api_env_after_write(reload_api_env)
    await invalidate_provider_health_for_items([row, *disabled_conflict_rows])
    return {
        "success": True,
        "api_config": mask_api_config_row(row),
        "env_refreshed": env_refreshed,
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
    disabled_conflicts, disabled_conflict_rows = await _disable_conflicting_provider_configs(updated)
    env_refreshed = await _reload_api_env_after_write(reload_api_env)
    await invalidate_provider_health_for_items([before, updated, *disabled_conflict_rows])
    return {
        "success": True,
        "api_config": mask_api_config_row(updated),
        "env_refreshed": env_refreshed,
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
    env_refreshed = await _reload_api_env_after_write(reload_api_env)
    await invalidate_provider_health_for_items([before])
    return {"success": True, "deleted": True, "env_refreshed": env_refreshed}


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
    touched_items: List[Any] = []
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
        touched_items.extend(provider_rows)
        conflicts.append(
            {
                "provider": provider,
                "kept_config_id": keep_id,
                "disabled_config_ids": disabled_ids,
                "keyed_enabled_count": len(provider_rows),
                "dry_run": dry_run,
            }
        )

    env_refreshed = None
    if total_disabled and not dry_run:
        env_refreshed = await _reload_api_env_after_write(reload_api_env)
    if touched_items and not dry_run:
        await invalidate_provider_health_for_items(touched_items)

    return {
        "success": True,
        "dry_run": dry_run,
        "conflicts": conflicts,
        "total_conflicts": len(conflicts),
        "total_disabled": total_disabled if not dry_run else 0,
        "would_disable": total_disabled,
        "env_refreshed": env_refreshed,
    }


async def test_saved_api_config_health(config_id: str) -> Dict[str, Any]:
    row = await ApiConfigDAO.get_by_id(config_id)
    if not row:
        raise ApiConfigNotFound("Config not found")
    runtime = None
    try:
        runtime = _runtime_for_row(row)
    except Exception as exc:
        logger.warning("Runtime config lookup failed for config %s: %s", config_id, exc, exc_info=True)
    key = await ApiConfigDAO.get_decrypted_key(config_id)
    key_source = "db" if key else "missing"
    key_env: Optional[str] = None
    if not key and runtime and runtime.has_key:
        key = runtime.api_key
        key_source = "runtime"
        key_env = runtime.api_key_env

    test_row, endpoint_source, used_runtime_endpoint = _test_row_and_endpoint_source(row, runtime)
    result = await test_api_config_health(test_row, key or "")
    test = result.get("test")
    if isinstance(test, dict):
        _annotate_config_health_test(
            test,
            row=row,
            runtime=runtime,
            key_source=key_source,
            key_env=key_env,
            endpoint_source=endpoint_source,
            used_runtime_endpoint=used_runtime_endpoint,
        )
    return result


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
                runtime = None
                try:
                    runtime = _runtime_for_row(row)
                except Exception as exc:
                    logger.warning(
                        "Runtime config lookup failed for config %s: %s",
                        config_id,
                        exc,
                        exc_info=True,
                    )
                key = await ApiConfigDAO.get_decrypted_key(config_id)
                key_source = "db" if key else "missing"
                key_env: Optional[str] = None
                if not key and runtime and runtime.has_key:
                    key = runtime.api_key
                    key_source = "runtime"
                    key_env = runtime.api_key_env
                test_row, endpoint_source, used_runtime_endpoint = _test_row_and_endpoint_source(row, runtime)
                result = await test_api_config_health(test_row, key or "")
                test = result.get("test") or {}
                _annotate_config_health_test(
                    test,
                    row=row,
                    runtime=runtime,
                    key_source=key_source,
                    key_env=key_env,
                    endpoint_source=endpoint_source,
                    used_runtime_endpoint=used_runtime_endpoint,
                )
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
