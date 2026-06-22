# -*- coding: utf-8 -*-
"""Admin routes for runtime API provider configuration.

These handlers are included by ``admin_routes.py`` under the existing
``/api/admin`` prefix so the public API surface stays unchanged.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from db_manager import get_db_manager
from services.api_config_health_service import ProviderHealthNotFound, check_provider_health
from services.api_config_import_service import ApiConfigImportOptions, import_preset_api_configs
from services.api_config_reload_service import ApiConfigReloadFailed, reload_api_env_runtime
from services.api_config_service import (
    ApiConfigCreateFailed,
    ApiConfigNotFound,
    create_api_config,
    delete_api_config,
    get_api_config_presets,
    list_api_configs,
    repair_api_config_provider_conflicts,
    test_all_saved_api_config_health,
    test_saved_api_config_health,
    update_api_config,
)
from services.api_provider_health_monitor import (
    cache_provider_health_result,
    list_cached_provider_health,
    provider_health_monitor_settings,
    provider_health_monitor_state,
    run_provider_health_sweep,
    summarize_provider_health_results,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_db() -> None:
    if not get_db_manager():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )


class ApiConfigCreateBody(BaseModel):
    # Pydantic v2 protects model_* names by default, but model_name is a real
    # API config field used by the admin UI and database.
    model_config = ConfigDict(protected_namespaces=())

    name: str = Field(..., min_length=1)
    provider: str = Field(..., min_length=1)
    endpoint: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    model_name: str = ""
    proxy_mode: str = "direct"
    custom_proxy: str = ""
    request_template: Dict[str, Any] = Field(default_factory=dict)
    headers: Dict[str, Any] = Field(default_factory=dict)
    category: str = ""


class ApiConfigUpdateBody(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: Optional[str] = None
    provider: Optional[str] = None
    endpoint: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    proxy_mode: Optional[str] = None
    custom_proxy: Optional[str] = None
    request_template: Optional[Dict[str, Any]] = None
    headers: Optional[Dict[str, Any]] = None
    enabled: Optional[bool] = None
    category: Optional[str] = None


class ApiConfigImportPresetsBody(BaseModel):
    copy_runtime_env_keys: bool = True
    update_existing_empty_keys: bool = True
    enable_copied_keys: bool = True
    dry_run: bool = False


class ApiConfigHealthSweepBody(BaseModel):
    providers: Optional[List[str]] = None
    targets: Optional[List[Dict[str, Optional[str]]]] = None
    concurrency: Optional[int] = None


class ApiConfigBatchTestBody(BaseModel):
    config_ids: Optional[List[str]] = None
    enabled_only: bool = False
    concurrency: Optional[int] = None


class ApiConfigRepairConflictsBody(BaseModel):
    dry_run: bool = False


@router.get("/api-configs")
async def admin_list_api_configs():
    _require_db()
    return await list_api_configs()


@router.post("/api-configs", status_code=status.HTTP_201_CREATED)
async def admin_create_api_config(body: ApiConfigCreateBody):
    _require_db()
    try:
        return await create_api_config(
            name=body.name,
            provider=body.provider,
            endpoint=body.endpoint,
            api_key=body.api_key,
            model_name=body.model_name,
            proxy_mode=body.proxy_mode,
            custom_proxy=body.custom_proxy,
            request_template=body.request_template,
            headers=body.headers,
            category=body.category,
        )
    except ApiConfigCreateFailed:
        raise HTTPException(status_code=500, detail="Failed to create API config")


@router.post("/api-configs/reload-env")
async def admin_reload_api_env():
    """Manually reload DB-backed API configs into runtime env without restart."""
    _require_db()
    try:
        result = await reload_api_env_runtime(clear_health_cache=True)
    except ApiConfigReloadFailed as e:
        logger.error("Manual API env reload failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="API env reload failed") from e

    return {
        "success": bool(result.get("success")),
        "env_refreshed": bool(result.get("env_refreshed")),
        "loaded": result.get("loaded", 0),
        "loaded_providers": result.get("loaded_providers", []),
        "health_cache_invalidated": result.get("health_cache_invalidated", []),
        "error": result.get("error"),
    }


@router.post("/api-configs/import-presets")
async def admin_import_preset_configs(body: Optional[ApiConfigImportPresetsBody] = None):
    _require_db()
    body = body or ApiConfigImportPresetsBody()
    return await import_preset_api_configs(
        ApiConfigImportOptions(
            copy_runtime_env_keys=body.copy_runtime_env_keys,
            update_existing_empty_keys=body.update_existing_empty_keys,
            enable_copied_keys=body.enable_copied_keys,
            dry_run=body.dry_run,
        )
    )


@router.get("/api-configs/presets")
async def admin_get_presets():
    return get_api_config_presets()


@router.post("/api-configs/test-all")
async def admin_test_all_api_configs(body: Optional[ApiConfigBatchTestBody] = None):
    _require_db()
    body = body or ApiConfigBatchTestBody()
    return await test_all_saved_api_config_health(
        config_ids=body.config_ids,
        enabled_only=body.enabled_only,
        concurrency=body.concurrency,
    )


@router.get("/api-configs/health/cache")
async def admin_get_provider_health_cache():
    provider_health = await list_cached_provider_health()
    return {
        "success": True,
        "provider_health": provider_health,
        "summary": summarize_provider_health_results(provider_health),
        "settings": provider_health_monitor_settings(),
        "monitor_state": provider_health_monitor_state(),
    }


@router.post("/api-configs/health/sweep")
async def admin_sweep_provider_health(body: Optional[ApiConfigHealthSweepBody] = None):
    body = body or ApiConfigHealthSweepBody()
    results = await run_provider_health_sweep(
        providers=body.providers,
        targets=body.targets,
        concurrency=body.concurrency,
        record_state=True,
        sweep_source="manual",
    )
    summary = summarize_provider_health_results(results)
    return {
        "success": True,
        "provider_health": results,
        "summary": summary,
        "monitor_state": provider_health_monitor_state(),
    }


@router.post("/api-configs/repair-conflicts")
async def admin_repair_api_config_conflicts(body: Optional[ApiConfigRepairConflictsBody] = None):
    _require_db()
    body = body or ApiConfigRepairConflictsBody()
    return await repair_api_config_provider_conflicts(
        dry_run=body.dry_run,
    )


@router.post("/api-configs/{config_id}/test")
async def admin_test_api_config(config_id: str):
    _require_db()
    try:
        return await test_saved_api_config_health(config_id)
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")


@router.get("/api-configs/{provider_id}/health")
async def admin_check_provider_health(provider_id: str, model_name: Optional[str] = None):
    try:
        result = await check_provider_health(provider_id, model_name=model_name)
        return await cache_provider_health_result(result)
    except ProviderHealthNotFound:
        raise HTTPException(status_code=404, detail="Provider not found")


@router.put("/api-configs/{config_id}")
async def admin_update_api_config(config_id: str, body: ApiConfigUpdateBody):
    _require_db()
    data = body.model_dump(exclude_unset=True)
    try:
        return await update_api_config(config_id, data)
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")


@router.delete("/api-configs/{config_id}")
async def admin_delete_api_config(config_id: str):
    _require_db()
    try:
        return await delete_api_config(config_id)
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")
