/**
 * AdminSettingsPage.tsx - system settings shell.
 *
 * API config is rendered natively so provider health can be shown without
 * reaching into the legacy iframe. Other settings pages continue to use the
 * legacy console until they are migrated.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    Download,
    Edit3,
    ExternalLink,
    ImageIcon,
    KeyRound,
    Loader2,
    Plus,
    RefreshCw,
    ServerCog,
    Timer,
    Trash2,
    X,
} from 'lucide-react';
import { crmConfirm, crmMessage } from './crmUI';
import { apiBlob, apiJson } from '../services/httpClient';

const LEGACY_VER = '20260701-qwen-agent-v2';
const LEGACY_PAGE_BY_ITEM: Record<string, string> = {
    cluster: 'cluster',
    workflows: 'workflows',
    dashboard: 'dashboard',
};

type HealthStatus = 'ok' | 'error' | 'no_key' | 'blocked_region' | 'connectivity_ok' | 'unknown';
type JsonRecord = Record<string, any>;

interface ApiConfig {
    config_id: string;
    name: string;
    provider: string;
    endpoint?: string;
    api_key_encrypted?: string;
    has_key?: boolean;
    api_key_preview?: string;
    model_name?: string;
    proxy_mode?: string;
    custom_proxy?: string;
    request_template?: JsonRecord | string | null;
    headers?: JsonRecord | string | null;
    category?: string;
    enabled?: boolean;
}

interface ProviderMeta {
    provider: string;
    label?: string;
    vendor?: string;
    env_key?: string;
    notes?: string;
    docs_url?: string;
    console_url?: string;
    key_help?: string;
    capabilities?: string[];
    extra_fields?: ProviderExtraField[];
    default_config_name?: string;
    default_endpoint?: string;
    default_model_name?: string;
    default_category?: string;
    default_proxy_mode?: string;
    preset_count?: number;
    preset_categories?: string[];
    operation_paths?: Record<string, string>;
    default_operation_url_templates?: Record<string, string>;
}

interface ProviderExtraField {
    field: string;
    label?: string;
    target?: 'request_template' | 'headers' | string;
    env_key?: string;
    input_type?: 'text' | 'password' | string;
    placeholder?: string;
    help?: string;
    aliases?: string[];
    secret?: boolean;
}

interface RuntimeFallbackEntry {
    provider?: string;
    model_name?: string;
    when?: string[];
}

interface RuntimeStatus {
    provider: string;
    model_name?: string;
    status?: string;
    has_key?: boolean;
    endpoint?: string;
    operation_urls?: Record<string, string>;
    endpoint_env?: string;
    endpoint_source?: string;
    runtime_model_name?: string;
    model_env?: string | null;
    model_source?: string;
    api_key_env?: string;
    api_key_source?: string;
    proxy_mode?: string;
    runtime_source?: string;
    db_effective_config_id?: string | null;
    db_effective_config_name?: string | null;
    db_keyed_enabled_config_count?: number;
    db_enabled_endpoint_count?: number;
    db_candidate_config_ids?: string[];
    custom_proxy_configured?: boolean;
    health_status?: HealthStatus | string;
    health_checked_at?: string;
    health_cached_at?: string;
    health_latency_ms?: number | null;
    health_error?: string | null;
    fallback?: RuntimeFallbackEntry[];
    failover?: {
        active?: boolean;
        reason?: string;
        selected_provider?: string;
        selected_model_name?: string;
    };
    failover_active?: boolean;
    failover_selected_provider?: string;
    failover_reason?: string;
    failover_selected_model_name?: string;
    issues?: string[];
}

interface ProviderHealth {
    success?: boolean;
    provider: string;
    model_name?: string | null;
    status?: HealthStatus | string;
    latency_ms?: number | null;
    checked_at?: string;
    health?: {
        ok?: boolean;
        reachable?: boolean;
        auth_ok?: boolean;
        status_code?: number | null;
        url?: string | null;
        error?: string | null;
        urls_tried?: string[];
    };
}

interface ProviderHealthMonitorState {
    enabled?: boolean;
    loop_running?: boolean;
    loop_started_at?: string | null;
    redis_configured?: boolean;
    last_sweep_source?: string | null;
    last_sweep_started_at?: string | null;
    last_sweep_completed_at?: string | null;
    last_sweep_duration_ms?: number | null;
    last_summary?: {
        total?: number;
        ok?: number;
        error?: number;
        no_key?: number;
        blocked_region?: number;
        connectivity_ok?: number;
        unknown?: number;
    } | null;
    last_error?: string | null;
}

interface ApiConfigTest {
    ok?: boolean;
    status?: HealthStatus | string;
    reachable?: boolean;
    auth_ok?: boolean;
    status_code?: number | null;
    latency_ms?: number | null;
    url?: string | null;
    error?: string | null;
    provider?: string | null;
    model_name?: string | null;
    method?: string;
    checked_at?: string;
    urls_tried?: string[];
    key_source?: 'db' | 'runtime' | 'missing' | string;
    key_env?: string | null;
    used_runtime_key?: boolean;
    endpoint_source?: 'db' | 'runtime' | 'missing' | string;
    used_runtime_endpoint?: boolean;
    runtime_endpoint?: string | null;
    runtime_endpoint_source?: string | null;
    runtime_endpoint_env?: string | null;
    runtime_model_name?: string | null;
    endpoint_matches_runtime?: boolean | null;
    config_enabled?: boolean;
    is_runtime_effective?: boolean;
    runtime_effective_config_id?: string | null;
    runtime_effective_config_name?: string | null;
}

interface ApiConfigTestResponse {
    success?: boolean;
    test?: ApiConfigTest;
}

interface ApiConfigsResponse {
    success: boolean;
    api_configs?: ApiConfig[];
    configs?: ApiConfig[];
    providers?: ProviderMeta[];
    runtime_status?: RuntimeStatus[];
    provider_health?: ProviderHealth[];
    monitor_state?: ProviderHealthMonitorState;
}

interface ApiConfigFormState {
    config_id?: string;
    name: string;
    provider: string;
    endpoint: string;
    api_key: string;
    bulk_api_keys: string;
    bulk_mode: boolean;
    model_name: string;
    proxy_mode: string;
    custom_proxy: string;
    request_template: string;
    headers: string;
    extra_values: Record<string, string>;
    category: string;
    enabled: boolean;
}

interface ApiConfigWriteResponse {
    success: boolean;
    api_config?: ApiConfig;
    api_configs?: ApiConfig[];
    created?: number;
    active_config_id?: string;
    deleted?: boolean;
    env_refreshed?: boolean | null;
    disabled_conflicting_config_ids?: string[];
    disabled_config_ids?: string[];
}

interface TrashFile {
    file_id: string;
    file_name?: string;
    file_type?: string;
    file_url?: string;
    file_path?: string;
    disk_path?: string;
    disk_exists?: boolean;
    disk_size_bytes?: number;
    purge_eligible?: boolean;
    purge_blocked_reason?: string;
    user_id?: string;
    project_id?: string;
    episode_id?: string;
    deleted_at?: string;
    media_name?: string;
    media_library_count?: number;
    legacy_reference_count?: number;
    legacy_reference_counts?: Record<string, number>;
    restore_targets?: string[];
    restore_warnings?: string[];
    restore_visibility?: 'normal' | 'file_record_only' | 'missing_disk' | string;
    download_available?: boolean;
    download_url?: string;
    preview_unavailable_reason?: string;
}

interface TrashRestoreResponse {
    success: boolean;
    file?: TrashFile;
    restore_targets?: string[];
    restore_warnings?: string[];
    restore_visibility?: string;
}

interface TrashFilesResponse {
    success: boolean;
    items?: TrashFile[];
    total?: number;
    limit?: number;
    offset?: number;
    disk_bytes?: number;
}

interface TrashPurgeResponse {
    success: boolean;
    file_id?: string;
    purged?: number;
    freed_bytes?: number;
    removed_disk?: boolean;
    deleted_db_record?: boolean;
    errors?: Array<{ file_id?: string; error?: string }>;
}

interface ApiConfigImportResponse {
    success: boolean;
    dry_run?: boolean;
    imported?: number;
    skipped?: number;
    total?: number;
    updated_existing?: number;
    env_keys_imported?: number;
    env_keys_missing?: number;
    env_keys_existing?: number;
    env_keys_skipped_provider_claimed?: number;
    enabled_existing?: number;
    env_refreshed?: boolean | null;
}

interface ApiConfigReloadEnvResponse {
    success: boolean;
    env_refreshed?: boolean;
    loaded?: number;
    loaded_providers?: string[];
    health_cache_invalidated?: string[];
    error?: string | null;
}

interface ProviderHealthSweepResponse {
    success: boolean;
    provider_health?: ProviderHealth[];
    summary?: {
        total?: number;
        ok?: number;
        error?: number;
        no_key?: number;
        blocked_region?: number;
        connectivity_ok?: number;
        unknown?: number;
    };
    monitor_state?: ProviderHealthMonitorState;
}

interface ProviderHealthCacheResponse extends ProviderHealthSweepResponse {
    settings?: {
        enabled?: boolean;
        initial_delay_seconds?: number;
        interval_seconds?: number;
        ttl_seconds?: number;
        concurrency?: number;
    };
}

interface ApiConfigBatchTestItem {
    config_id: string;
    name?: string;
    provider?: string;
    model_name?: string;
    enabled?: boolean;
    test?: ApiConfigTest;
}

interface ApiConfigBatchTestResponse {
    success: boolean;
    config_tests?: ApiConfigBatchTestItem[];
    summary?: {
        total?: number;
        ok?: number;
        error?: number;
        no_key?: number;
        auth_error?: number;
        connectivity_ok?: number;
    };
}

interface ApiConfigRepairConflict {
    provider?: string;
    kept_config_id?: string;
    disabled_config_ids?: string[];
    keyed_enabled_count?: number;
}

interface ApiConfigRepairConflictsResponse {
    success: boolean;
    dry_run?: boolean;
    conflicts?: ApiConfigRepairConflict[];
    total_conflicts?: number;
    total_disabled?: number;
    would_disable?: number;
    env_refreshed?: boolean | null;
}

const CATEGORY_LABELS: Record<string, string> = {
    text: '文本生成',
    image: '图像生成',
    video: '视频生成',
    audio: '语音生成',
    other: '其他',
};

const RUNTIME_KEY_IMPORT_BODY = {
    copy_runtime_env_keys: true,
    update_existing_empty_keys: true,
    enable_copied_keys: true,
};

function normalizeProvider(provider: string | undefined | null): string {
    return String(provider || '').trim().toLowerCase();
}

function runtimeStatusKey(provider: string | undefined | null, modelName?: string | null): string {
    const providerKey = normalizeProvider(provider);
    const modelKey = String(modelName || '').trim().toLowerCase();
    return `${providerKey}::${modelKey}`;
}

function providerHealthKey(provider: string | undefined | null, modelName?: string | null): string {
    const providerKey = normalizeProvider(provider);
    const modelKey = String(modelName || '').trim().toLowerCase();
    return modelKey ? `${providerKey}::${modelKey}` : providerKey;
}

function putProviderHealth(
    map: Record<string, ProviderHealth>,
    item: ProviderHealth,
    fallbackModelName?: string | null,
) {
    const provider = normalizeProvider(item.provider);
    if (!provider) return;
    const modelName = item.model_name || fallbackModelName || null;
    map[providerHealthKey(provider, modelName)] = item;
    if (!modelName) map[provider] = item;
}

function buildProviderHealthMap(rows: ProviderHealth[] = []): Record<string, ProviderHealth> {
    const next: Record<string, ProviderHealth> = {};
    rows.forEach(item => {
        putProviderHealth(next, item);
    });
    return next;
}

function providerHealthFrom(
    map: Record<string, ProviderHealth>,
    provider: string | undefined | null,
    modelName?: string | null,
): ProviderHealth | undefined {
    const providerKey = normalizeProvider(provider);
    if (!providerKey) return undefined;
    return map[providerHealthKey(providerKey, modelName)] || map[providerKey];
}

function formatEndpoint(endpoint?: string): string {
    if (!endpoint) return '-';
    return endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function endpointIdentity(endpoint?: string): string {
    return String(endpoint || '').trim().replace(/\/+$/, '').toLowerCase();
}

function endpointMismatch(left?: string, right?: string): boolean {
    const leftKey = endpointIdentity(left);
    const rightKey = endpointIdentity(right);
    return Boolean(leftKey && rightKey && leftKey !== rightKey);
}

function formatTime(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', { hour12: false });
}

function statusView(status: HealthStatus) {
    const map = {
        ok: {
            label: 'ok',
            text: '就绪',
            dot: 'bg-g400',
            badge: 'bg-g50 text-g400',
            icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        },
        error: {
            label: 'error',
            text: '异常',
            dot: 'bg-r400',
            badge: 'bg-r50 text-r400',
            icon: <AlertCircle className="w-3.5 h-3.5" />,
        },
        no_key: {
            label: 'no_key',
            text: '未配置',
            dot: 'bg-r400',
            badge: 'bg-r50 text-r400',
            icon: <KeyRound className="w-3.5 h-3.5" />,
        },
        blocked_region: {
            label: 'blocked_region',
            text: '地区受限',
            dot: 'bg-y400',
            badge: 'bg-y50 text-y400',
            icon: <AlertCircle className="w-3.5 h-3.5" />,
        },
        connectivity_ok: {
            label: 'connectivity_ok',
            text: '连接可达',
            dot: 'bg-y400',
            badge: 'bg-y50 text-y400',
            icon: <Activity className="w-3.5 h-3.5" />,
        },
        unknown: {
            label: 'unknown',
            text: '未检查',
            dot: 'bg-y400',
            badge: 'bg-y50 text-y400',
            icon: <Activity className="w-3.5 h-3.5" />,
        },
    };
    return map[status];
}

function healthStatusFrom(health?: ProviderHealth, runtime?: RuntimeStatus, configHasKey?: boolean): HealthStatus {
    const hasKey = typeof runtime?.has_key === 'boolean' ? runtime.has_key : configHasKey;
    const status = String(health?.status || runtime?.health_status || '').toLowerCase();
    if (status === 'ok') return 'ok';
    if (status === 'error') return 'error';
    if (status === 'no_key') return hasKey ? 'unknown' : 'no_key';
    if (status === 'blocked_region') return 'blocked_region';
    if (status === 'connectivity_ok') return 'connectivity_ok';
    if (hasKey === false) return 'no_key';
    return 'unknown';
}

function healthStatusFromResult(result?: ProviderHealth): HealthStatus {
    const status = String(result?.status || '').toLowerCase();
    if (
        status === 'ok'
        || status === 'error'
        || status === 'no_key'
        || status === 'blocked_region'
        || status === 'connectivity_ok'
    ) return status;
    if (result?.health?.auth_ok === true) return 'ok';
    if (result?.health?.auth_ok === false) return 'error';
    return 'unknown';
}

function healthStatusFromConfigTest(test?: ApiConfigTest): HealthStatus | undefined {
    if (!test) return undefined;
    if (test.ok) return 'ok';
    if (isNoKeyTest(test)) return 'no_key';
    const status = String(test.status || '').toLowerCase();
    if (status === 'connectivity_ok') return 'connectivity_ok';
    if (status === 'blocked_region') return 'blocked_region';
    const errorText = String(test.error || '').toLowerCase();
    if (errorText.includes('user location is not supported')) return 'blocked_region';
    if (test.reachable && test.auth_ok && errorText.includes('generation is not verified')) return 'connectivity_ok';
    return 'error';
}

function mergedHealthStatus(
    health: ProviderHealth | undefined,
    runtime: RuntimeStatus | undefined,
    hasEffectiveKey: boolean,
    configTest?: ApiConfigTest,
): HealthStatus {
    const runtimeStatus = healthStatusFrom(health, runtime, hasEffectiveKey);
    if (runtimeStatus === 'ok') return 'ok';

    const configStatus = healthStatusFromConfigTest(configTest);
    if (!configStatus) return runtimeStatus;
    if (configStatus === 'ok') return 'ok';
    if (configStatus === 'blocked_region' || configStatus === 'connectivity_ok') return configStatus;
    if (runtimeStatus === 'unknown') return configStatus;
    if (hasEffectiveKey) return runtimeStatus;
    if (runtimeStatus === 'no_key' && configStatus === 'error') return 'error';
    return runtimeStatus;
}

function groupCategory(config: ApiConfig): string {
    const category = String(config.category || '').toLowerCase();
    if (CATEGORY_LABELS[category]) return category;
    const provider = normalizeProvider(config.provider);
    const model = String(config.model_name || '').toLowerCase();
    if (provider.includes('tts') || provider.includes('minimax') || model.startsWith('speech-')) return 'audio';
    if (provider.includes('seedance') || provider.includes('sora') || provider.includes('veo') || provider.includes('dashscope')) return 'video';
    if (provider.includes('image') || provider.includes('doubao') || model.includes('image') || model.includes('seedream')) return 'image';
    return 'text';
}

function categoryFromProviderMeta(meta: ProviderMeta): string {
    const direct = String(meta.default_category || '').toLowerCase();
    if (CATEGORY_LABELS[direct]) return direct;
    const fromPreset = (meta.preset_categories || [])
        .map(item => String(item || '').toLowerCase())
        .find(item => CATEGORY_LABELS[item]);
    if (fromPreset) return fromPreset;
    const capabilities = (meta.capabilities || []).map(item => String(item || '').toLowerCase());
    if (capabilities.includes('audio')) return 'audio';
    if (capabilities.includes('video')) return 'video';
    if (capabilities.includes('image')) return 'image';
    return 'text';
}

function bestConfigForProvider(configs: ApiConfig[], providerRaw: string): ApiConfig | undefined {
    const provider = normalizeProvider(providerRaw);
    const matches = configs.filter(config => normalizeProvider(config.provider) === provider);
    return matches.find(config => config.enabled !== false && Boolean(config.has_key ?? config.api_key_encrypted))
        || matches.find(config => Boolean(config.has_key ?? config.api_key_encrypted))
        || matches.find(config => config.enabled !== false)
        || matches[0];
}

function jsonRecordFrom(value: ApiConfig['request_template']): JsonRecord {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
            return {};
        }
    }
    return {};
}

function jsonTextFrom(value: ApiConfig['request_template']): string {
    const record = jsonRecordFrom(value);
    return Object.keys(record).length ? JSON.stringify(record, null, 2) : '';
}

function parseJsonText(value: string, label: string): JsonRecord {
    const text = value.trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${label} 必须是 JSON object`);
        }
        return parsed;
    } catch (err: any) {
        throw new Error(`${label} 不是有效 JSON：${err?.message || 'parse error'}`);
    }
}

function extraFieldKeys(field: ProviderExtraField): string[] {
    const keys = [field.field, ...(field.aliases || [])]
        .map(item => String(item || '').trim())
        .filter(Boolean);
    return Array.from(new Set(keys));
}

function extraSourceForField(
    field: ProviderExtraField,
    requestTemplate: JsonRecord,
    headers: JsonRecord,
): JsonRecord {
    return field.target === 'headers' ? headers : requestTemplate;
}

function extraValuesFromRecords(
    fields: ProviderExtraField[] = [],
    requestTemplate: JsonRecord = {},
    headers: JsonRecord = {},
): Record<string, string> {
    const values: Record<string, string> = {};
    fields.forEach(field => {
        const source = extraSourceForField(field, requestTemplate, headers);
        for (const key of extraFieldKeys(field)) {
            if (source[key] !== undefined && source[key] !== null) {
                values[field.field] = String(source[key]);
                break;
            }
        }
    });
    return values;
}

function extraFieldValueFromForm(form: ApiConfigFormState, field: ProviderExtraField): string {
    if (form.extra_values[field.field] !== undefined) return form.extra_values[field.field];
    const requestTemplate = jsonRecordFrom(form.request_template);
    const headers = jsonRecordFrom(form.headers);
    return extraValuesFromRecords([field], requestTemplate, headers)[field.field] || '';
}

function applyExtraValuesToRecords(
    fields: ProviderExtraField[] = [],
    values: Record<string, string>,
    requestTemplate: JsonRecord,
    headers: JsonRecord,
) {
    fields.forEach(field => {
        const source = extraSourceForField(field, requestTemplate, headers);
        const value = String(values[field.field] || '').trim();
        if (value) {
            source[field.field] = value;
            return;
        }
        extraFieldKeys(field).forEach(key => {
            delete source[key];
        });
    });
}

function emptyConfigForm(): ApiConfigFormState {
    return {
        name: '',
        provider: '',
        endpoint: '',
        api_key: '',
        bulk_api_keys: '',
        bulk_mode: false,
        model_name: '',
        proxy_mode: 'direct',
        custom_proxy: '',
        request_template: '',
        headers: '',
        extra_values: {},
        category: 'text',
        enabled: true,
    };
}

function providerMetaToForm(meta: ProviderMeta): ApiConfigFormState {
    const provider = normalizeProvider(meta.provider);
    return {
        ...emptyConfigForm(),
        name: meta.default_config_name || meta.label || provider,
        provider,
        endpoint: meta.default_endpoint || '',
        model_name: meta.default_model_name || '',
        proxy_mode: meta.default_proxy_mode || 'direct',
        category: categoryFromProviderMeta(meta),
    };
}

function configToForm(config: ApiConfig, extraFields: ProviderExtraField[] = []): ApiConfigFormState {
    const requestTemplate = jsonRecordFrom(config.request_template);
    const headers = jsonRecordFrom(config.headers);
    return {
        config_id: config.config_id,
        name: config.name || '',
        provider: config.provider || '',
        endpoint: config.endpoint || '',
        api_key: '',
        bulk_api_keys: '',
        bulk_mode: false,
        model_name: config.model_name || '',
        proxy_mode: config.proxy_mode || 'direct',
        custom_proxy: config.custom_proxy || '',
        request_template: jsonTextFrom(config.request_template),
        headers: jsonTextFrom(config.headers),
        extra_values: extraValuesFromRecords(extraFields, requestTemplate, headers),
        category: config.category || groupCategory(config),
        enabled: config.enabled !== false,
    };
}

function envRefreshMessage(result: { env_refreshed?: boolean | null }, action: string): string {
    if (result.env_refreshed === false) return `${action}已保存，但运行时环境刷新失败`;
    if (result.env_refreshed === true) return `${action}已保存并生效`;
    return `${action}已保存`;
}

function conflictDisableSuffix(result: { disabled_conflicting_config_ids?: string[] }): string {
    const count = result.disabled_conflicting_config_ids?.length || 0;
    return count > 0 ? `，已自动关闭 ${count} 条同 provider 冲突配置` : '';
}

function activationDisableSuffix(result: { disabled_config_ids?: string[] }): string {
    const count = result.disabled_config_ids?.length || 0;
    return count > 0 ? `锛屽凡鍏抽棴 ${count} 鏉″悓 provider 鏃?Key` : '';
}

function splitBulkApiKeys(value: string): string[] {
    return Array.from(new Set(
        String(value || '')
            .split(/[\n,，;；]+/)
            .map(item => item.trim())
            .filter(Boolean)
    ));
}

function formatBytes(bytes?: number): string {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function trashPreviewUrl(item: TrashFile): string {
    const url = String(item.file_url || '').trim();
    if (!url) return '';
    if (url.startsWith('/storage/') || url.startsWith('/uploads/') || url.startsWith('/api/files/')) {
        return url;
    }
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    return '';
}

function isPreviewableTrashImage(item: TrashFile): boolean {
    if (!item.disk_exists) return false;
    const type = String(item.file_type || '').toLowerCase();
    const url = trashPreviewUrl(item).split('?', 1)[0].toLowerCase();
    return type === 'image' || /\.(webp|png|jpe?g|gif|bmp|svg)$/i.test(url);
}

function trashDownloadUrl(item: TrashFile): string {
    if (item.download_url) return item.download_url;
    if (!item.file_id) return '';
    return `/api/admin/trash/files/${encodeURIComponent(item.file_id)}/download`;
}

function trashDownloadName(item: TrashFile): string {
    const raw = String(item.media_name || item.file_name || item.file_url || item.file_path || item.file_id || 'download');
    const tail = raw.split(/[\\/]/).filter(Boolean).pop() || raw;
    return tail.replace(/[\\/:*?"<>|]+/g, '_') || 'download';
}

function restoreVisibilityClass(item: TrashFile): string {
    if (item.restore_visibility === 'normal') return 'border-g75 bg-g50 text-g400';
    if (item.restore_visibility === 'missing_disk') return 'border-r75 bg-r50 text-r400';
    return 'border-y200 bg-y50 text-y400';
}

function restoreVisibilityText(item: TrashFile): string {
    if (item.restore_visibility === 'normal') return '可恢复到关联位置';
    if (item.restore_visibility === 'missing_disk') return '缺少磁盘文件';
    if (item.restore_visibility === 'file_record_only') return '可能仅恢复记录';
    return '恢复状态未知';
}

const RUNTIME_ISSUE_LABELS: Record<string, string> = {
    missing_key: '缺少 Key',
    missing_endpoint: '缺少 Endpoint',
    db_multiple_keyed_enabled_configs: '多条启用配置共享同一 Key',
    db_endpoint_conflict: '启用配置 Endpoint 冲突',
    custom_proxy_missing: '自定义代理未填写',
    health_error: '健康检查异常',
    health_no_key: '健康检查缺少 Key',
};

const FAILOVER_REASON_LABELS: Record<string, string> = {
    missing_key: '主 provider 缺少 Key',
    health_error: '主 provider 健康检查异常',
};

function runtimeIssueText(issues?: string[]): string {
    if (!Array.isArray(issues) || !issues.length) return '';
    return issues.map(issue => RUNTIME_ISSUE_LABELS[issue] || issue).join('，');
}

function failoverReasonText(reason?: string): string {
    if (!reason) return '-';
    return FAILOVER_REASON_LABELS[reason] || reason;
}

function fallbackEntryText(entry: RuntimeFallbackEntry): string {
    const provider = normalizeProvider(entry.provider);
    const model = String(entry.model_name || '').trim();
    return model ? `${provider} / ${model}` : provider;
}

function sourceText(source?: string | null, env?: string | null): string {
    if (!source) return '-';
    if (source === 'missing') return '未配置';
    if (source === 'preset') return '预设';
    return env || source;
}

function keySourceText(runtime?: RuntimeStatus, configHasKey?: boolean): string {
    if (configHasKey) return 'DB 已保存 Key';
    if (runtime?.has_key) {
        const source = sourceText(runtime.api_key_source, runtime.api_key_env);
        return source && source !== '-' ? `运行时环境：${source}` : '运行时环境有 Key';
    }
    return '未配置 Key';
}

function configTestEndpointText(test?: ApiConfigTest): string {
    if (!test) return '';
    const parts: string[] = [];
    if (test.used_runtime_endpoint) {
        parts.push(`Endpoint 来源：运行时 ${sourceText(test.runtime_endpoint_source, test.runtime_endpoint_env)}`);
    } else if (test.endpoint_source === 'db') {
        parts.push('Endpoint 来源：DB 记录');
    } else if (test.endpoint_source === 'missing') {
        parts.push('Endpoint 未配置');
    } else if (test.endpoint_source) {
        parts.push(`Endpoint 来源：${test.endpoint_source}`);
    }
    if (test.endpoint_matches_runtime === false) {
        parts.push('与运行时 Endpoint 不一致');
    }
    return parts.join('；');
}

function configTestRuntimeWarning(test?: ApiConfigTest): string {
    if (!test) return '';
    if (test.config_enabled === false) {
        return '此条 DB 配置未启用，真实调用不会使用它';
    }
    if (test.is_runtime_effective === false) {
        const effective = test.runtime_effective_config_name || test.runtime_effective_config_id;
        return effective
            ? `真实调用当前使用：${effective}`
            : '此条 DB 配置未成为运行时生效配置';
    }
    return '';
}

function dbKeyStateText(hasSavedKey: boolean, runtimeHasKey: boolean): string {
    if (hasSavedKey) return 'DB 已保存 Key';
    if (runtimeHasKey) return 'DB 未保存 Key，真实调用使用运行时 Key';
    return 'DB 未保存 Key';
}

function dbKeyStateClass(hasSavedKey: boolean, runtimeHasKey: boolean): string {
    if (hasSavedKey) return 'text-g400';
    if (runtimeHasKey) return 'text-y400';
    return 'text-r400';
}

function isNoKeyTest(test?: ApiConfigTest): boolean {
    return test?.error === 'No API key configured';
}

const HealthBadge: React.FC<{ status: HealthStatus }> = ({ status }) => {
    const view = statusView(status);
    return (
        <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold ${view.badge}`}>
            <span className={`w-2 h-2 rounded-full ${view.dot}`} />
            <span className="font-mono">{view.label}</span>
            <span>{view.text}</span>
        </span>
    );
};

const ProviderCredentialLinks: React.FC<{ meta?: ProviderMeta; compact?: boolean; showHelp?: boolean }> = ({
    meta,
    compact = false,
    showHelp = true,
}) => {
    if (!meta?.docs_url && !meta?.console_url && !meta?.key_help) return null;
    return (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${compact ? 'mt-1' : 'mt-2'}`}>
            {meta.console_url && (
                <a
                    href={meta.console_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:text-primary-hover"
                >
                    <ExternalLink className="w-3 h-3" />
                    控制台
                </a>
            )}
            {meta.docs_url && (
                <a
                    href={meta.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:text-primary-hover"
                >
                    <ExternalLink className="w-3 h-3" />
                    API 文档
                </a>
            )}
            {showHelp && meta.key_help && (
                <span className="text-n100 break-words">{meta.key_help}</span>
            )}
        </div>
    );
};

const ProviderOperationPaths: React.FC<{ meta?: ProviderMeta; runtime?: RuntimeStatus; compact?: boolean }> = ({
    meta,
    runtime,
    compact = false,
}) => {
    const operationUrls = runtime?.operation_urls || meta?.default_operation_url_templates || {};
    const entries = Object.entries(meta?.operation_paths || operationUrls)
        .map(([operation, path]) => [operation, String(path || ''), String(operationUrls[operation] || '')] as const)
        .filter(([operation, path, url]) => operation && (path || url))
        .sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) return null;

    const visible = compact ? entries.slice(0, 3) : entries;
    return (
        <div className={`rounded border border-n40 bg-n20 px-3 py-2 text-[11px] text-n100 ${compact ? 'mt-2' : 'mt-3'}`}>
            <div className="mb-1 font-semibold uppercase tracking-wider text-n100">API Paths</div>
            <div className="grid gap-1">
                {visible.map(([operation, path, url]) => (
                    <div key={operation} className="grid gap-1 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
                        <span className="font-mono text-n700 break-all">{operation}</span>
                        <span className="font-mono text-n300 break-all">{url || path}</span>
                        {url && path && url !== path && (
                            <span className="font-mono text-n100 break-all sm:col-start-2">{path}</span>
                        )}
                    </div>
                ))}
            </div>
            {compact && entries.length > visible.length && (
                <div className="mt-1 font-mono text-n100">+{entries.length - visible.length} more</div>
            )}
        </div>
    );
};

const ProviderHealthMonitorStrip: React.FC<{ state: ProviderHealthMonitorState | null }> = ({ state }) => {
    if (!state) return null;
    const enabled = state.enabled !== false;
    const running = state.loop_running === true;
    const hasError = Boolean(state.last_error);
    const summary = state.last_summary || {};
    const badgeClass = !enabled
        ? 'bg-n20 text-n300'
        : hasError
            ? 'bg-r50 text-r400'
            : running
                ? 'bg-g50 text-g400'
                : 'bg-y50 text-y400';
    const label = !enabled ? 'disabled' : hasError ? 'error' : running ? 'running' : 'idle';
    return (
        <section className="rounded-md border border-n40 bg-n0 px-3 py-2 shadow-card flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-n300">
            <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-semibold ${badgeClass}`}>
                <Activity className="w-3.5 h-3.5" />
                <span>自动巡检</span>
                <span className="font-mono">{label}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5 text-n100" />
                <span>最近完成</span>
                <span className="font-mono text-n700">{formatTime(state.last_sweep_completed_at || undefined)}</span>
            </span>
            <span className="font-mono text-n700">
                {typeof state.last_sweep_duration_ms === 'number' ? `${state.last_sweep_duration_ms} ms` : '- ms'}
            </span>
            <span className="font-mono text-n700">
                ok {summary.ok ?? 0} / reachable {summary.connectivity_ok ?? 0} / error {summary.error ?? 0} / no_key {summary.no_key ?? 0}
            </span>
            <span className="font-mono text-n100">
                source {state.last_sweep_source || '-'}
            </span>
            {!state.redis_configured && (
                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-y50 text-y400 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Redis cache offline
                </span>
            )}
            {state.last_error && (
                <span className="min-w-0 flex-1 text-r400 truncate" title={state.last_error}>
                    {state.last_error}
                </span>
            )}
        </section>
    );
};

const ApiConfigEditorModal: React.FC<{
    form: ApiConfigFormState;
    providers: ProviderMeta[];
    saving: boolean;
    onChange: (next: ApiConfigFormState) => void;
    onClose: () => void;
    onSubmit: () => void;
}> = ({ form, providers, saving, onChange, onClose, onSubmit }) => {
    const isEdit = Boolean(form.config_id);
    const providerOptions = useMemo(() => {
        const seen = new Set<string>();
        const out = providers
            .map(item => ({ provider: normalizeProvider(item.provider), label: item.label || item.provider }))
            .filter(item => {
                if (!item.provider || seen.has(item.provider)) return false;
                seen.add(item.provider);
                return true;
            });
        const current = normalizeProvider(form.provider);
        if (current && !seen.has(current)) out.unshift({ provider: current, label: current });
        return out;
    }, [form.provider, providers]);

    const patch = (fields: Partial<ApiConfigFormState>) => onChange({ ...form, ...fields });
    const selectedProvider = normalizeProvider(form.provider);
    const selectedMeta = providers.find(item => normalizeProvider(item.provider) === selectedProvider);
    const extraFields = selectedMeta?.extra_fields || [];

    return (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-n900/40 backdrop-blur-sm p-4">
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    onSubmit();
                }}
                className="modal-surface w-full max-w-3xl bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden flex flex-col"
            >
                <div className="responsive-toolbar flex items-center justify-between gap-3 px-5 py-4 border-b border-n40 bg-n0">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-n800">{isEdit ? '编辑 API 配置' : '新增 API 配置'}</h2>
                        <div className="text-xs text-n100 mt-0.5">
                            {isEdit ? 'Key 留空时保留现有密钥' : '新增配置需要填写 API Key'}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-2 py-1 rounded border border-n40 text-n300 hover:bg-n20 disabled:opacity-60"
                    >
                        关闭
                    </button>
                </div>

                <div className="p-5 overflow-y-auto overflow-x-hidden space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">名称</span>
                            <input
                                required
                                value={form.name}
                                onChange={event => patch({ name: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                                placeholder="Gemini Text"
                            />
                        </label>
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">Provider</span>
                            <select
                                required
                                value={form.provider}
                                onChange={event => patch({ provider: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                            >
                                <option value="">选择 provider</option>
                                {providerOptions.map(item => (
                                    <option key={item.provider} value={item.provider}>
                                        {item.label} ({item.provider})
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <label className="block min-w-0">
                        <span className="block text-xs font-medium text-n300 mb-1">Endpoint</span>
                        <textarea
                            required
                            value={form.endpoint}
                            onChange={event => patch({ endpoint: event.target.value })}
                            rows={3}
                            className="w-full min-h-[76px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                            placeholder="https://api.example.com/v1"
                        />
                    </label>

                    {selectedMeta && (
                        <div className="rounded border border-n40 bg-n20 px-3 py-2">
                            <div className="text-[11px] font-semibold text-n300 mb-1">Key 获取入口</div>
                            <ProviderCredentialLinks meta={selectedMeta} compact />
                        </div>
                    )}

                    {!isEdit && (
                        <label className="inline-flex items-center gap-2 text-sm text-n700">
                            <input
                                type="checkbox"
                                checked={form.bulk_mode}
                                onChange={event => patch({ bulk_mode: event.target.checked })}
                            />
                            <span>批量添加多个 API Key</span>
                        </label>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">模型名</span>
                            <input
                                value={form.model_name}
                                onChange={event => patch({ model_name: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                placeholder="model-name"
                            />
                        </label>
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">API Key</span>
                            <input
                                type="password"
                                required={!isEdit && !form.bulk_mode}
                                value={form.api_key}
                                disabled={form.bulk_mode && !isEdit}
                                onChange={event => patch({ api_key: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                placeholder={isEdit ? '留空保留现有 Key' : 'sk-...'}
                            />
                        </label>
                    </div>

                    {form.bulk_mode && !isEdit && (
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">API Key 列表</span>
                            <textarea
                                required
                                value={form.bulk_api_keys}
                                onChange={event => patch({ bulk_api_keys: event.target.value })}
                                rows={5}
                                className="w-full min-h-[120px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                                placeholder="每行一个 Key，或用逗号分隔。第一个 Key 默认生效。"
                            />
                            <span className="mt-1 block text-[11px] text-n100">保存后会生成多条 Key 记录，第一条自动设为当前生效 Key。</span>
                        </label>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">分类</span>
                            <select
                                value={form.category}
                                onChange={event => patch({ category: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                            >
                                {Object.entries(CATEGORY_LABELS).filter(([key]) => key !== 'other').map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">代理模式</span>
                            <select
                                value={form.proxy_mode}
                                onChange={event => patch({ proxy_mode: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                            >
                                <option value="direct">direct</option>
                                <option value="custom">custom</option>
                                <option value="agent">agent</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-2 pt-6 min-w-0">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={event => patch({ enabled: event.target.checked })}
                            />
                            <span className="text-sm text-n700">启用配置</span>
                        </label>
                    </div>

                    {form.proxy_mode === 'custom' && (
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">自定义代理</span>
                            <textarea
                                value={form.custom_proxy}
                                onChange={event => patch({ custom_proxy: event.target.value })}
                                rows={2}
                                className="w-full min-h-[64px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                                placeholder="http://127.0.0.1:7890"
                            />
                        </label>
                    )}

                    {extraFields.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {extraFields.map(field => (
                                <label key={field.field} className="block min-w-0">
                                    <span className="block text-xs font-medium text-n300 mb-1">{field.label || field.field}</span>
                                    <input
                                        type={field.secret || field.input_type === 'password' ? 'password' : 'text'}
                                        value={extraFieldValueFromForm(form, field)}
                                        onChange={event => patch({
                                            extra_values: {
                                                ...form.extra_values,
                                                [field.field]: event.target.value,
                                            },
                                        })}
                                        className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                        placeholder={field.placeholder || field.env_key || field.field}
                                    />
                                    {(field.help || field.env_key) && (
                                        <span className="mt-1 block text-[11px] text-n100">
                                            {field.help || `Hot-reloads into ${field.env_key}`}
                                        </span>
                                    )}
                                </label>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">Request Template JSON</span>
                            <textarea
                                value={form.request_template}
                                onChange={event => patch({ request_template: event.target.value })}
                                rows={5}
                                className="w-full min-h-[120px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                                placeholder='{"group_id":"..."}'
                            />
                        </label>
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">Headers JSON</span>
                            <textarea
                                value={form.headers}
                                onChange={event => patch({ headers: event.target.value })}
                                rows={5}
                                className="w-full min-h-[120px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                                placeholder='{"X-Custom":"value"}'
                            />
                        </label>
                    </div>
                </div>

                <div className="responsive-toolbar flex items-center justify-end gap-2 px-5 py-4 border-t border-n40 bg-n20">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 rounded text-sm border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                    >
                        取消
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:opacity-60"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        保存
                    </button>
                </div>
            </form>
        </div>
    );
};

const ApiConfigCard: React.FC<{
    config: ApiConfig;
    meta?: ProviderMeta;
    runtime?: RuntimeStatus;
    health?: ProviderHealth;
    configTest?: ApiConfigTest;
    checking: boolean;
    testingConfig: boolean;
    onCheck: (provider: string, modelName?: string | null) => void;
    onTestConfig: (config: ApiConfig) => void;
    onEdit: (config: ApiConfig) => void;
    onActivate: (config: ApiConfig) => void;
    onToggle: (config: ApiConfig) => void;
    onDelete: (config: ApiConfig) => void;
}> = ({ config, meta, runtime, health, configTest, checking, testingConfig, onCheck, onTestConfig, onEdit, onActivate, onToggle, onDelete }) => {
    const provider = normalizeProvider(config.provider);
    const runtimeHasKey = typeof runtime?.has_key === 'boolean' ? runtime.has_key : Boolean(config.has_key ?? config.api_key_encrypted);
    const configHasKey = Boolean(config.has_key ?? config.api_key_encrypted);
    const status = mergedHealthStatus(health, runtime, runtimeHasKey, configTest);
    const view = statusView(status);
    const healthError = health?.health?.error || runtime?.health_error || '';
    const healthLatency = typeof health?.latency_ms === 'number' ? health.latency_ms : runtime?.health_latency_ms;
    const healthCheckedAt = health?.checked_at || runtime?.health_checked_at || runtime?.health_cached_at;
    const runtimeIssue = runtimeIssueText(runtime?.issues);
    const runtimeEndpoint = runtime?.endpoint || '';
    const dbEndpoint = config.endpoint || '';
    const runtimeDbEndpointMismatch = endpointMismatch(runtimeEndpoint, dbEndpoint);
    const effectiveConfig = runtime?.db_effective_config_name || runtime?.db_effective_config_id || '';
    const isRuntimeActive = Boolean(
        config.config_id
        && runtime?.db_effective_config_id
        && config.config_id === runtime.db_effective_config_id
    );
    const keyedCount = runtime?.db_keyed_enabled_config_count || 0;
    const endpointCount = runtime?.db_enabled_endpoint_count || 0;
    const fallbackText = (runtime?.fallback || [])
        .map(fallbackEntryText)
        .filter(Boolean)
        .join('，');
    const selectedFailover = [
        runtime?.failover_selected_provider,
        runtime?.failover_selected_model_name,
    ].filter(Boolean).join(' / ');
    const failoverActive = Boolean(runtime?.failover_active);
    const configTestNoKey = isNoKeyTest(configTest);
    const configTestRuntimeWarningText = configTest?.ok ? configTestRuntimeWarning(configTest) : '';
    const configTestUsesRuntimeKey = Boolean(configTest?.ok && (configTest.used_runtime_key || configTestRuntimeWarningText));
    const configTestClass = configTest?.ok
        ? configTestUsesRuntimeKey
            ? 'border-y200 bg-y50 text-y400'
            : 'border-g75 bg-g50 text-g400'
        : configTestNoKey
            ? 'border-y200 bg-y50 text-y400'
        : 'border-r75 bg-r50 text-r400';
    const configTestLabel = !configTest
        ? ''
        : configTest.ok
            ? configTestRuntimeWarningText
                || (configTest.used_runtime_key
                ? '运行时连通正常；此条 DB 记录仍未保存 Key'
                : '此条记录连通正常')
            : configTestNoKey
                ? '此条 DB 记录未保存 Key'
                : '此条记录异常';
    const configTestKeySource = !configTest
        ? ''
        : configTest.used_runtime_key
            ? `运行时 ${configTest.key_env || 'Key'}`
            : configTest.key_source === 'db'
                ? 'DB 保存 Key'
                : configTest.key_source === 'missing'
                    ? '未配置 Key'
                    : configTest.key_source || '';
    const configTestEndpoint = configTestEndpointText(configTest);

    return (
        <article className="bg-n0 border border-n40 rounded-md shadow-card p-4 min-w-0">
            <div className="flex items-start gap-3 min-w-0">
                <div className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${view.dot}`} title={view.text} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <h3 className="text-sm font-semibold text-n800 leading-snug break-words">{config.name || meta?.label || provider}</h3>
                                {isRuntimeActive && (
                                    <span className="rounded bg-g50 text-g400 px-1.5 py-0.5 text-[10px] font-semibold">当前生效 Key</span>
                                )}
                                {config.api_key_preview && (
                                    <span className="rounded bg-n20 text-n300 px-1.5 py-0.5 text-[10px] font-mono">{config.api_key_preview}</span>
                                )}
                                {!config.enabled && (
                                    <span className="rounded bg-r50 text-danger px-1.5 py-0.5 text-[10px] font-semibold">禁用</span>
                                )}
                                {!configHasKey && !runtimeHasKey && (
                                    <span className="rounded bg-r50 text-r400 px-1.5 py-0.5 text-[10px] font-semibold">DB 未保存 Key</span>
                                )}
                                {!configHasKey && runtimeHasKey && (
                                    <span className="rounded bg-y50 text-y400 px-1.5 py-0.5 text-[10px] font-semibold">DB 未保存 Key</span>
                                )}
                                {runtimeHasKey && !configHasKey && (
                                    <span className="rounded bg-g50 text-g400 px-1.5 py-0.5 text-[10px] font-semibold">运行时 Key 可用</span>
                                )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-n100 flex-wrap">
                                <span className="font-mono">{provider}</span>
                                <span className="font-mono">{config.model_name || '-'}</span>
                                <span>{meta?.vendor || '-'}</span>
                            </div>
                        </div>

                        <div className="toolbar-actions justify-end">
                            <button
                                type="button"
                                onClick={() => onTestConfig(config)}
                                disabled={testingConfig || !config.config_id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60 shrink-0"
                                title="只测试这条数据库记录保存的 Key、Endpoint 和模型；结果不会覆盖生效配置健康状态"
                            >
                                {testingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                                测试 DB 配置
                            </button>
                            <button
                                type="button"
                                onClick={() => onCheck(provider, config.model_name || runtime?.runtime_model_name || null)}
                                disabled={checking || !provider}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60 shrink-0"
                                title="测试实际生成调用会使用的生效 Key、Endpoint 和模型"
                            >
                                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                测试生效配置
                            </button>
                            {!isRuntimeActive && (
                                <button
                                    type="button"
                                    onClick={() => onActivate(config)}
                                    disabled={!configHasKey || !config.config_id}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-g75 bg-g50 text-g400 hover:bg-g50 disabled:opacity-60 shrink-0"
                                >
                                    <KeyRound className="w-3.5 h-3.5" />
                                    设为生效
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => onEdit(config)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                                配置 / 修改 API Key
                            </button>
                            <button
                                type="button"
                                onClick={() => onToggle(config)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                            >
                                {config.enabled === false ? '启用' : '禁用'}
                            </button>
                            <button
                                type="button"
                                onClick={() => onDelete(config)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-danger/30 bg-r50 text-danger hover:bg-r50"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                删除
                            </button>
                        </div>
                    </div>

                    <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
                        <div className="min-w-0 rounded bg-n20 border border-n40 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-n100 mb-1">Runtime</div>
                            <div className="font-mono text-xs text-n700 break-all">{formatEndpoint(runtimeEndpoint || dbEndpoint)}</div>
                            {runtimeDbEndpointMismatch && (
                                <div className="mt-1 text-[11px] text-y400 break-all">
                                    DB Endpoint: <span className="font-mono">{formatEndpoint(dbEndpoint)}</span>
                                </div>
                            )}
                            <div className="mt-2 grid gap-1 text-[11px] text-n100 sm:grid-cols-2">
                                <div className="min-w-0">
                                    Key: <span className="font-mono text-n700 break-all">{sourceText(runtime?.api_key_source, runtime?.api_key_env)}</span>
                                </div>
                                <div className="min-w-0">
                                    Key 状态: <span className="font-mono text-n700 break-all">{keySourceText(runtime, configHasKey)}</span>
                                </div>
                                <div className="min-w-0">
                                    Endpoint: <span className="font-mono text-n700 break-all">{sourceText(runtime?.endpoint_source, runtime?.endpoint_env)}</span>
                                </div>
                                <div className="min-w-0">
                                    Model: <span className="font-mono text-n700 break-all">{runtime?.runtime_model_name || config.model_name || '-'}</span>
                                </div>
                                <div className="min-w-0">
                                    Model source: <span className="font-mono text-n700 break-all">{sourceText(runtime?.model_source, runtime?.model_env || undefined)}</span>
                                </div>
                                <div className="min-w-0">
                                    Proxy: <span className="font-mono text-n700">{config.proxy_mode || runtime?.proxy_mode || 'direct'}</span>
                                </div>
                                <div className="min-w-0">
                                    Source: <span className="font-mono text-n700">{runtime?.runtime_source || '-'}</span>
                                </div>
                            </div>
                            {(effectiveConfig || keyedCount > 1 || endpointCount > 1) && (
                                <div className="mt-2 border-t border-n40 pt-2 text-[11px] text-n100">
                                    {effectiveConfig && (
                                        <div className="min-w-0">
                                            生效配置: <span className="font-mono text-n700 break-all">{effectiveConfig}</span>
                                        </div>
                                    )}
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        {keyedCount > 0 && (
                                            <span className="rounded bg-n0 border border-n40 px-1.5 py-0.5">启用 Key {keyedCount}</span>
                                        )}
                                        {endpointCount > 0 && (
                                            <span className="rounded bg-n0 border border-n40 px-1.5 py-0.5">Endpoint {endpointCount}</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            {runtimeIssue && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {runtimeIssue.split('，').map(issue => (
                                        <span key={issue} className="rounded bg-y50 text-y400 px-1.5 py-0.5 text-[10px] font-semibold">{issue}</span>
                                    ))}
                                </div>
                            )}
                            {(failoverActive || fallbackText) && (
                                <div className={`mt-2 rounded border px-2 py-1.5 text-[11px] break-words ${
                                    failoverActive
                                        ? 'border-y200 bg-y50 text-y400'
                                        : 'border-n40 bg-n0 text-n100'
                                }`}>
                                    <span className="font-semibold">{failoverActive ? '已切换备用' : '备用链路'}</span>
                                    ：
                                    <span className="font-mono text-n700">
                                        {failoverActive ? (selectedFailover || '-') : fallbackText}
                                    </span>
                                    {failoverActive && (
                                        <span className="ml-2">
                                            原因：{failoverReasonText(runtime?.failover_reason)}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="min-w-0 rounded bg-n20 border border-n40 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-n100">生效配置状态</span>
                                <HealthBadge status={status} />
                                <span className="text-[11px] text-n100 font-mono">{health?.health?.status_code || '-'}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                                <div className="min-w-0">
                                    <div className="text-n100 flex items-center gap-1"><Timer className="w-3 h-3" /> 最近延迟</div>
                                    <div className="text-n700 font-mono">{typeof healthLatency === 'number' ? `${healthLatency} ms` : '-'}</div>
                                </div>
                                <div className="min-w-0">
                                    <div className="text-n100">最后检测</div>
                                    <div className="text-n700 font-mono break-words">{formatTime(healthCheckedAt)}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {healthError && (
                        <div className="mt-2 rounded border border-r75 bg-r50 px-3 py-2 text-[11px] text-r400 break-words">
                            {healthError}
                        </div>
                    )}

                    {configTest && (
                        <div className={`mt-2 rounded border px-3 py-2 text-[11px] break-words ${configTestClass}`}>
                            <span className="font-semibold">DB 配置测试：</span>
                            <span>{configTestLabel}</span>
                            {configTestKeySource && (
                                <span className="ml-1">；Key 来源：{configTestKeySource}</span>
                            )}
                            {configTestEndpoint && (
                                <span className="ml-1">；{configTestEndpoint}</span>
                            )}
                            <span className="mx-1 text-n100">/</span>
                            <span className="font-mono text-n700">
                                {typeof configTest.latency_ms === 'number' ? `${configTest.latency_ms} ms` : '- ms'}
                            </span>
                            <span className="mx-1 text-n100">/</span>
                            <span className="font-mono text-n700">HTTP {configTest.status_code || '-'}</span>
                            <span className="mx-1 text-n100">/</span>
                            <span>{formatTime(configTest.checked_at)}</span>
                            {configTest.url && (
                                <div className="mt-1 font-mono text-n700 break-all">{formatEndpoint(configTest.url)}</div>
                            )}
                            {configTest.endpoint_matches_runtime === false && configTest.runtime_endpoint && (
                                <div className="mt-1 font-mono text-y400 break-all">
                                    运行时 Endpoint: {formatEndpoint(configTest.runtime_endpoint)}
                                </div>
                            )}
                            {configTest.error && (
                                <div className="mt-1">{configTest.error}</div>
                            )}
                        </div>
                    )}

                    {meta?.notes && (
                        <div className="mt-2 text-[11px] text-n100 leading-relaxed break-words">{meta.notes}</div>
                    )}
                    <ProviderOperationPaths meta={meta} runtime={runtime} />
                    <ProviderCredentialLinks meta={meta} />
                </div>
            </div>
        </article>
    );
};

const ProviderQuickCard: React.FC<{
    meta: ProviderMeta;
    configs: ApiConfig[];
    runtime?: RuntimeStatus;
    health?: ProviderHealth;
    configTest?: ApiConfigTest;
    checking: boolean;
    testingConfig: boolean;
    onConfigure: (meta: ProviderMeta) => void;
    onEditConfig: (config: ApiConfig) => void;
    onTestConfig: (config: ApiConfig) => void;
    onCheck: (provider: string, modelName?: string | null) => void;
}> = ({ meta, configs, runtime, health, configTest, checking, testingConfig, onConfigure, onEditConfig, onTestConfig, onCheck }) => {
    const provider = normalizeProvider(meta.provider);
    const primaryConfig = bestConfigForProvider(configs, provider);
    const hasSavedKey = configs.some(config => Boolean(config.has_key ?? config.api_key_encrypted));
    const runtimeHasKey = typeof runtime?.has_key === 'boolean' ? runtime.has_key : hasSavedKey;
    const status = mergedHealthStatus(health, runtime, runtimeHasKey, configTest);
    const view = statusView(status);
    const latency = typeof health?.latency_ms === 'number' ? health.latency_ms : runtime?.health_latency_ms;
    const checkedAt = health?.checked_at || runtime?.health_checked_at || runtime?.health_cached_at;
    const endpoint = runtime?.endpoint || primaryConfig?.endpoint || meta.default_endpoint || '';
    const primaryDbEndpoint = primaryConfig?.endpoint || '';
    const runtimePrimaryEndpointMismatch = endpointMismatch(runtime?.endpoint, primaryDbEndpoint);
    const model = primaryConfig?.model_name || runtime?.runtime_model_name || meta.default_model_name || '';
    const enabledCount = configs.filter(config => config.enabled !== false).length;
    const keySource = keySourceText(runtime, hasSavedKey);
    const keySourceClass = runtimeHasKey || hasSavedKey ? 'text-g400' : 'text-r400';
    const dbKeyText = dbKeyStateText(hasSavedKey, runtimeHasKey);
    const dbKeyClass = dbKeyStateClass(hasSavedKey, runtimeHasKey);
    const quickConfigTestNoKey = isNoKeyTest(configTest);
    const quickConfigTestRuntimeWarningText = configTest?.ok ? configTestRuntimeWarning(configTest) : '';
    const quickConfigTestUsesRuntimeKey = Boolean(configTest?.ok && (configTest.used_runtime_key || quickConfigTestRuntimeWarningText));
    const quickConfigTestClass = configTest?.ok
        ? quickConfigTestUsesRuntimeKey
            ? 'border-y200 bg-y50 text-y400'
            : 'border-g75 bg-g50 text-g400'
        : quickConfigTestNoKey
            ? 'border-y200 bg-y50 text-y400'
        : 'border-r75 bg-r50 text-r400';
    const quickConfigTestLabel = !configTest
        ? ''
        : configTest.ok
            ? quickConfigTestRuntimeWarningText
                || (configTest.used_runtime_key
                ? '运行时连通正常；DB 仍未保存 Key'
                : 'DB 配置可用')
            : quickConfigTestNoKey
                ? 'DB 配置未保存 Key'
                : 'DB 配置异常';
    const quickConfigTestKeySource = !configTest
        ? ''
        : configTest.used_runtime_key
            ? `运行时 ${configTest.key_env || 'Key'}`
            : configTest.key_source === 'db'
                ? 'DB 保存 Key'
                : configTest.key_source === 'missing'
                    ? '未配置 Key'
                    : configTest.key_source || '';
    const quickConfigTestEndpoint = configTestEndpointText(configTest);

    return (
        <article className={`bg-n0 border rounded-md shadow-card p-4 min-w-0 ${
            status === 'ok' ? 'border-g75' : status === 'no_key' || status === 'error' ? 'border-r75' : 'border-y200'
        }`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-2.5 h-2.5 rounded-full ${view.dot}`} />
                        <h3 className="text-sm font-semibold text-n800 break-words">{meta.label || provider}</h3>
                        <span className="text-[10px] rounded bg-n20 border border-n40 px-1.5 py-0.5 text-n100 font-mono">
                            {provider}
                        </span>
                    </div>
                    <div className="mt-1 text-[11px] text-n100 break-words">
                        {meta.vendor || '-'} · {CATEGORY_LABELS[categoryFromProviderMeta(meta)] || '其他'}
                    </div>
                    <ProviderCredentialLinks meta={meta} compact showHelp={false} />
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] uppercase tracking-wider text-n100">生效配置状态</span>
                    <HealthBadge status={status} />
                </div>
            </div>

            <div className="mt-3 grid gap-2 text-[11px]">
                <div className="min-w-0">
                    <div className="text-n100">Endpoint</div>
                    <div className="font-mono text-n700 break-all">{formatEndpoint(endpoint)}</div>
                    {runtimePrimaryEndpointMismatch && (
                        <div className="mt-1 text-y400 break-all">
                            DB Endpoint: <span className="font-mono">{formatEndpoint(primaryDbEndpoint)}</span>
                        </div>
                    )}
                </div>
                <div className="min-w-0">
                    <div className="text-n100">Model</div>
                    <div className="font-mono text-n700 break-all">{model || '-'}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <div className="text-n100">配置</div>
                        <div className="font-mono text-n700">{configs.length}</div>
                    </div>
                    <div>
                        <div className="text-n100">启用</div>
                        <div className="font-mono text-n700">{enabledCount}</div>
                    </div>
                    <div>
                        <div className="text-n100">延迟</div>
                        <div className="font-mono text-n700">{typeof latency === 'number' ? `${latency} ms` : '-'}</div>
                    </div>
                </div>
                <div className="text-[11px] text-n100">
                    生效 Key：<span className={`font-mono break-words ${keySourceClass}`}>{keySource}</span>
                </div>
                <div className="text-[11px] text-n100">
                    DB Key：<span className={`font-mono break-words ${dbKeyClass}`}>{dbKeyText}</span>
                </div>
                <div className="text-[11px] text-n100">
                    最后检测：<span className="font-mono text-n700 break-words">{formatTime(checkedAt)}</span>
                </div>
                {runtime?.issues?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {runtimeIssueText(runtime.issues).split('，').map(issue => (
                            <span key={issue} className="rounded bg-y50 text-y400 px-1.5 py-0.5 text-[10px] font-semibold">{issue}</span>
                        ))}
                    </div>
                ) : null}
            </div>

            <ProviderOperationPaths meta={meta} runtime={runtime} compact />

            <div className="mt-3 flex flex-wrap gap-2">
                {primaryConfig ? (
                    <>
                        <button
                            type="button"
                            onClick={() => onEditConfig(primaryConfig)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                            title="打开配置弹窗，可修改 Endpoint、模型名和 API Key"
                        >
                            <KeyRound className="w-3.5 h-3.5" />
                            配置 / 修改 API Key
                        </button>
                        <button
                            type="button"
                            onClick={() => onTestConfig(primaryConfig)}
                            disabled={testingConfig || !primaryConfig.config_id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                            title="只测试这条数据库记录保存的 Key、Endpoint 和模型；结果不会覆盖生效配置健康状态"
                        >
                            {testingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                            测试 DB 配置
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={() => onConfigure(meta)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                        title="新增此厂商的 Endpoint、模型名和 API Key"
                    >
                        <KeyRound className="w-3.5 h-3.5" />
                        配置 / 修改 API Key
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => onCheck(provider, model || null)}
                    disabled={checking || !provider}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                    title="测试实际生成调用会使用的生效 Key、Endpoint 和模型"
                >
                    {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    测试生效配置
                </button>
            </div>

            {configTest && (
                <div className={`mt-2 rounded border px-2 py-1.5 text-[11px] break-words ${quickConfigTestClass}`}>
                    <span className="font-semibold">DB 配置测试：</span>
                    <span>{quickConfigTestLabel}</span>
                    {quickConfigTestKeySource && (
                        <span className="ml-1">Key 来源：{quickConfigTestKeySource}</span>
                    )}
                    {quickConfigTestEndpoint && (
                        <span className="ml-1">；{quickConfigTestEndpoint}</span>
                    )}
                    <span className="mx-1 text-n100">/</span>
                    <span className="font-mono text-n700">{typeof configTest.latency_ms === 'number' ? `${configTest.latency_ms} ms` : '- ms'}</span>
                    <span className="mx-1 text-n100">/</span>
                    <span className="font-mono text-n700">HTTP {configTest.status_code || '-'}</span>
                    {configTest.endpoint_matches_runtime === false && configTest.runtime_endpoint && (
                        <div className="mt-1 font-mono text-y400 break-all">
                            运行时 Endpoint: {formatEndpoint(configTest.runtime_endpoint)}
                        </div>
                    )}
                    {configTest.error && <div className="mt-1">{configTest.error}</div>}
                </div>
            )}
        </article>
    );
};

const AdminRecycleBinPanel: React.FC = () => {
    const [items, setItems] = useState<TrashFile[]>([]);
    const [total, setTotal] = useState(0);
    const [diskBytes, setDiskBytes] = useState(0);
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [previewItem, setPreviewItem] = useState<TrashFile | null>(null);

    const loadTrash = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ limit: '50', offset: '0' });
            if (keyword.trim()) query.set('keyword', keyword.trim());
            const result = await apiJson<TrashFilesResponse>(`/api/admin/trash/files?${query.toString()}`);
            setItems(result.items || []);
            setTotal(result.total || 0);
            setDiskBytes(result.disk_bytes || 0);
        } catch (err: any) {
            crmMessage.error(`回收站加载失败：${err?.message || 'unknown'}`);
        } finally {
            setLoading(false);
        }
    }, [keyword]);

    useEffect(() => {
        loadTrash();
    }, [loadTrash]);

    const setItemBusy = (fileId: string, value: boolean) => {
        setBusy(prev => ({ ...prev, [fileId]: value }));
    };

    const restoreFile = useCallback(async (item: TrashFile) => {
        if (!item.file_id) return;
        const warnings = item.restore_warnings || [];
        if (warnings.length) {
            const ok = await crmConfirm({
                title: '恢复前确认',
                message: `文件：${item.media_name || item.file_name || item.file_id}。${warnings.join('；')} 是否继续恢复？`,
                type: item.restore_visibility === 'missing_disk' ? 'danger' : 'warning',
                confirmText: '继续恢复',
            });
            if (!ok) return;
        }
        setItemBusy(item.file_id, true);
        try {
            const result = await apiJson<TrashRestoreResponse>(`/api/admin/trash/files/${encodeURIComponent(item.file_id)}/restore`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            setPreviewItem(null);
            if (result.restore_warnings?.length) {
                crmMessage.warning(`文件已恢复，但请注意：${result.restore_warnings.join('；')}`);
            } else {
                const targets = result.restore_targets?.length ? `：${result.restore_targets.join('、')}` : '';
                crmMessage.success(`文件已从回收站恢复${targets}`);
            }
            await loadTrash();
        } catch (err: any) {
            crmMessage.error(`恢复失败：${err?.message || 'unknown'}`);
        } finally {
            setItemBusy(item.file_id, false);
        }
    }, [loadTrash]);

    const purgeFile = useCallback(async (item: TrashFile) => {
        if (!item.file_id) return;
        const ok = await crmConfirm({
            title: '彻底释放磁盘空间',
            message: `将永久删除磁盘文件并删除文件库记录，操作不可恢复。文件：${item.file_name || item.file_id}，预计释放 ${formatBytes(item.disk_size_bytes)}。确认继续？`,
            type: 'danger',
            confirmText: '彻底删除',
        });
        if (!ok) return;
        setItemBusy(item.file_id, true);
        try {
            const result = await apiJson<TrashPurgeResponse>(`/api/admin/trash/files/${encodeURIComponent(item.file_id)}/purge`, {
                method: 'DELETE',
                body: JSON.stringify({ risk_ack: true, delete_db_record: true }),
            });
            if (result.success) {
                setPreviewItem(null);
                crmMessage.success(`已释放 ${formatBytes(result.freed_bytes)}`);
            } else {
                crmMessage.error(`释放失败：${result.errors?.[0]?.error || 'unknown'}`);
            }
            await loadTrash();
        } catch (err: any) {
            crmMessage.error(`释放失败：${err?.message || 'unknown'}`);
        } finally {
            setItemBusy(item.file_id, false);
        }
    }, [loadTrash]);

    const downloadTrashFile = useCallback(async (item: TrashFile) => {
        if (!item.file_id || !item.download_available) {
            crmMessage.warning(item.preview_unavailable_reason || '磁盘文件不存在，无法下载。');
            return;
        }
        const url = trashDownloadUrl(item);
        if (!url) {
            crmMessage.warning('缺少下载地址。');
            return;
        }
        setItemBusy(item.file_id, true);
        try {
            const blob = await apiBlob(url, { method: 'GET' }, '下载回收站文件', { includeContentType: false });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = trashDownloadName(item);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            crmMessage.success('已开始下载。');
        } catch (err: any) {
            crmMessage.error(`下载失败：${err?.message || '文件不存在或无权限'}`);
            await loadTrash();
        } finally {
            setItemBusy(item.file_id, false);
        }
    }, [loadTrash]);

    return (
        <section className="bg-n0 border border-n40 rounded-md shadow-card p-4 min-w-0">
            <div className="responsive-toolbar flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-n100">
                        <Trash2 className="w-3.5 h-3.5" />
                        Recycle Bin
                    </div>
                    <h2 className="mt-1 text-sm font-semibold text-n800">文件回收站</h2>
                    <p className="mt-0.5 text-xs text-n100">仅展示已软删除文件。释放磁盘会永久删除本地文件；以后切到 OSS 后可调整为对象软删除。</p>
                </div>
                <div className="toolbar-actions">
                    <input
                        value={keyword}
                        onChange={event => setKeyword(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') loadTrash(); }}
                        className="w-52 rounded border border-n40 bg-n0 px-3 py-1.5 text-xs text-n800 focus:border-primary focus:outline-none"
                        placeholder="搜索文件名 / URL"
                    />
                    <button
                        type="button"
                        onClick={loadTrash}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                    >
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        刷新
                    </button>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded border border-n40 bg-n20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-n100">Deleted Files</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-n800">{total}</div>
                </div>
                <div className="rounded border border-n40 bg-n20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-n100">Current Page Disk</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-n800">{formatBytes(diskBytes)}</div>
                </div>
                <div className="rounded border border-y200 bg-y50 px-3 py-2 md:col-span-2">
                    <div className="text-xs font-semibold text-y400">风险提示</div>
                    <div className="mt-1 text-[11px] text-y400">恢复会撤销文件和素材库软删除，但不会重建已清空的分镜/视频/资产字段；释放磁盘会删除本机 persistent_storage 文件并移除文件记录，不可恢复。</div>
                </div>
            </div>

            <div className="mt-3 overflow-x-auto border border-n40 rounded-md">
                <table className="min-w-full text-xs">
                    <thead className="bg-n20 text-n100">
                        <tr>
                            <th className="text-left font-medium px-3 py-2">预览</th>
                            <th className="text-left font-medium px-3 py-2">文件</th>
                            <th className="text-left font-medium px-3 py-2">类型</th>
                            <th className="text-left font-medium px-3 py-2">磁盘</th>
                            <th className="text-left font-medium px-3 py-2">恢复去向</th>
                            <th className="text-left font-medium px-3 py-2">删除时间</th>
                            <th className="text-right font-medium px-3 py-2">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-n40">
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-n100">
                                    <Loader2 className="inline w-4 h-4 animate-spin mr-2" />
                                    加载中
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-n100">暂无回收站文件</td>
                            </tr>
                        ) : items.map(item => (
                            <tr key={item.file_id} className="bg-n0">
                                <td className="px-3 py-2 w-[88px] align-top">
                                    {isPreviewableTrashImage(item) ? (
                                        <button
                                            type="button"
                                            onClick={() => setPreviewItem(item)}
                                            className="group relative block w-16 h-16 overflow-hidden rounded border border-n40 bg-n20 hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                                            title="点击预览"
                                        >
                                            <img
                                                src={trashPreviewUrl(item)}
                                                alt={item.media_name || item.file_name || item.file_id}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                            <span className="absolute inset-x-0 bottom-0 hidden bg-n900/70 px-1 py-0.5 text-[10px] text-n0 group-hover:block">
                                                预览
                                            </span>
                                        </button>
                                    ) : (
                                        <div className="flex w-16 h-16 flex-col items-center justify-center rounded border border-dashed border-n40 bg-n20 text-[10px] text-n100">
                                            <ImageIcon className="w-4 h-4 mb-1" />
                                            {item.preview_unavailable_reason ? '文件缺失' : '无预览'}
                                        </div>
                                    )}
                                </td>
                                <td className="px-3 py-2 min-w-[260px]">
                                    <div className="font-medium text-n800 break-words">{item.media_name || item.file_name || item.file_id}</div>
                                    <div className="mt-0.5 font-mono text-[11px] text-n100 break-all">{item.file_url || item.file_path || '-'}</div>
                                </td>
                                <td className="px-3 py-2 font-mono text-n700">{item.file_type || '-'}</td>
                                <td className="px-3 py-2">
                                    <div className={item.disk_exists ? 'text-g400' : 'text-n100'}>{item.disk_exists ? '存在' : '不存在'}</div>
                                    <div className="font-mono text-n700">{formatBytes(item.disk_size_bytes)}</div>
                                </td>
                                <td className="px-3 py-2 min-w-[190px]">
                                    <div className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${restoreVisibilityClass(item)}`}>
                                        {restoreVisibilityText(item)}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {(item.restore_targets || ['仅文件记录']).map((target, index) => (
                                            <span key={`${item.file_id}-target-${index}`} className="rounded border border-n40 bg-n20 px-1.5 py-0.5 text-[10px] text-n700">
                                                {target}
                                            </span>
                                        ))}
                                    </div>
                                    {item.restore_warnings?.length ? (
                                        <div className="mt-1 text-[10px] leading-snug text-y400">
                                            {item.restore_warnings.join('；')}
                                        </div>
                                    ) : null}
                                </td>
                                <td className="px-3 py-2 font-mono text-n700">{formatTime(item.deleted_at)}</td>
                                <td className="px-3 py-2">
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => downloadTrashFile(item)}
                                            disabled={Boolean(busy[item.file_id]) || !item.download_available}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-50"
                                            title={item.download_available ? '下载原文件' : (item.preview_unavailable_reason || '磁盘文件不存在，无法下载')}
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                            下载
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => restoreFile(item)}
                                            disabled={Boolean(busy[item.file_id])}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                        >
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            恢复
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => purgeFile(item)}
                                            disabled={Boolean(busy[item.file_id]) || !item.purge_eligible}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-danger/30 bg-r50 text-danger hover:bg-r50 disabled:opacity-60"
                                            title={item.purge_blocked_reason || ''}
                                        >
                                            {busy[item.file_id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                            释放磁盘
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {previewItem && isPreviewableTrashImage(previewItem) && (
                <div
                    className="fixed inset-0 z-[10002] flex items-center justify-center bg-n900/70 p-4"
                    onClick={() => setPreviewItem(null)}
                >
                    <div
                        className="w-full max-w-5xl overflow-hidden rounded-md border border-n40 bg-n0 shadow-bottom"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3 border-b border-n40 px-4 py-3">
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-n800 truncate">
                                    {previewItem.media_name || previewItem.file_name || previewItem.file_id}
                                </div>
                                <div className="mt-0.5 font-mono text-[11px] text-n100 truncate">
                                    {previewItem.file_url || previewItem.file_path || '-'}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPreviewItem(null)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded border border-n40 bg-n0 text-n700 hover:bg-n20"
                                aria-label="关闭预览"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="max-h-[76vh] overflow-auto bg-n900/5 p-4">
                            <img
                                src={trashPreviewUrl(previewItem)}
                                alt={previewItem.media_name || previewItem.file_name || previewItem.file_id}
                                className="mx-auto max-h-[70vh] max-w-full rounded border border-n40 bg-n0 object-contain"
                            />
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};

const ApiConfigPanel: React.FC = () => {
    const [configs, setConfigs] = useState<ApiConfig[]>([]);
    const [providers, setProviders] = useState<ProviderMeta[]>([]);
    const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus[]>([]);
    const [healthMap, setHealthMap] = useState<Record<string, ProviderHealth>>({});
    const [monitorState, setMonitorState] = useState<ProviderHealthMonitorState | null>(null);
    const [configTestMap, setConfigTestMap] = useState<Record<string, ApiConfigTest>>({});
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState<Record<string, boolean>>({});
    const [testingConfig, setTestingConfig] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string>('');
    const [editingForm, setEditingForm] = useState<ApiConfigFormState | null>(null);
    const [saving, setSaving] = useState(false);
    const [sweeping, setSweeping] = useState(false);
    const [refreshingHealth, setRefreshingHealth] = useState(false);
    const [testingAllConfigs, setTestingAllConfigs] = useState(false);
    const [reloadingEnv, setReloadingEnv] = useState(false);
    const [repairingConflicts, setRepairingConflicts] = useState(false);
    const [migratingRuntimeKeys, setMigratingRuntimeKeys] = useState(false);

    const loadConfigs = useCallback(async (options?: { showLoading?: boolean }) => {
        const showLoading = options?.showLoading !== false;
        if (showLoading) setLoading(true);
        setError('');
        try {
            const data = await apiJson<ApiConfigsResponse>('/api/admin/api-configs');
            const rows = (data.api_configs || data.configs || []).filter(item => normalizeProvider(item.provider) !== 'comfyui');
            setConfigs(rows);
            setProviders(data.providers || []);
            setRuntimeStatus(data.runtime_status || []);
            setMonitorState(data.monitor_state || null);
            setHealthMap(buildProviderHealthMap(data.provider_health || []));
        } catch (err: any) {
            const message = err?.message || '加载 API 配置失败';
            setError(message);
            crmMessage.error(`API 配置加载失败：${message}`);
        } finally {
            if (showLoading) setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadConfigs();
    }, [loadConfigs]);

    const refreshHealthCache = useCallback(async () => {
        setRefreshingHealth(true);
        try {
            const result = await apiJson<ProviderHealthCacheResponse>('/api/admin/api-configs/health/cache');
            const rows = result.provider_health || [];
            setMonitorState(result.monitor_state || null);
            setHealthMap(buildProviderHealthMap(rows));
            const summary = result.summary || {};
            crmMessage.success(`状态已刷新：ok ${summary.ok ?? 0} / reachable ${summary.connectivity_ok ?? 0} / error ${summary.error ?? 0} / no_key ${summary.no_key ?? 0}`);
        } catch (err: any) {
            crmMessage.error(`刷新状态失败：${err?.message || 'unknown'}`);
        } finally {
            setRefreshingHealth(false);
        }
    }, []);

    const providerMetaMap = useMemo(() => {
        const out = new Map<string, ProviderMeta>();
        providers.forEach(item => out.set(normalizeProvider(item.provider), item));
        return out;
    }, [providers]);

    const runtimeMap = useMemo(() => {
        const out = new Map<string, RuntimeStatus>();
        runtimeStatus.forEach(item => {
            const provider = normalizeProvider(item.provider);
            if (provider && !out.has(provider)) out.set(provider, item);
        });
        return out;
    }, [runtimeStatus]);

    const runtimeByKey = useMemo(() => {
        const out = new Map<string, RuntimeStatus>();
        runtimeStatus.forEach(item => {
            const provider = normalizeProvider(item.provider);
            if (!provider) return;
            const key = runtimeStatusKey(provider, item.model_name || item.runtime_model_name);
            if (!out.has(key)) out.set(key, item);
        });
        return out;
    }, [runtimeStatus]);

    const runtimeForProviderModel = useCallback((providerRaw: string, modelName?: string | null): RuntimeStatus | undefined => {
        const provider = normalizeProvider(providerRaw);
        if (!provider) return undefined;
        const model = String(modelName || '').trim();
        return runtimeByKey.get(runtimeStatusKey(provider, model)) || runtimeMap.get(provider);
    }, [runtimeByKey, runtimeMap]);

    const runtimeForConfig = useCallback((config: ApiConfig): RuntimeStatus | undefined => {
        const provider = normalizeProvider(config.provider);
        return runtimeForProviderModel(provider, config.model_name || '');
    }, [runtimeForProviderModel]);

    const grouped = useMemo(() => {
        const out: Record<string, ApiConfig[]> = {};
        configs.forEach(config => {
            const category = groupCategory(config);
            if (!out[category]) out[category] = [];
            out[category].push(config);
        });
        return out;
    }, [configs]);

    const configsByProvider = useMemo(() => {
        const out = new Map<string, ApiConfig[]>();
        configs.forEach(config => {
            const provider = normalizeProvider(config.provider);
            if (!provider) return;
            const existing = out.get(provider) || [];
            existing.push(config);
            out.set(provider, existing);
        });
        return out;
    }, [configs]);

    const quickProviders = useMemo(() => {
        const known = new Set<string>();
        const rows = providers
            .filter(item => normalizeProvider(item.provider) && normalizeProvider(item.provider) !== 'comfyui')
            .map(item => {
                known.add(normalizeProvider(item.provider));
                return item;
            });
        configs.forEach(config => {
            const provider = normalizeProvider(config.provider);
            if (!provider || provider === 'comfyui' || known.has(provider)) return;
            known.add(provider);
            rows.push({
                provider,
                label: provider,
                default_endpoint: config.endpoint,
                default_model_name: config.model_name,
                default_category: groupCategory(config),
                default_proxy_mode: config.proxy_mode || 'direct',
            });
        });
        return rows.sort((a, b) => categoryFromProviderMeta(a).localeCompare(categoryFromProviderMeta(b)) || normalizeProvider(a.provider).localeCompare(normalizeProvider(b.provider)));
    }, [configs, providers]);

    const summary = useMemo(() => {
        const providerIds = Array.from(new Set(configs.map(item => normalizeProvider(item.provider)).filter(Boolean)));
        const dbKeyedProviders = Array.from(new Set(
            configs
                .filter(item => Boolean(item.has_key ?? item.api_key_encrypted))
                .map(item => normalizeProvider(item.provider))
                .filter(Boolean)
        ));
        const dbKeyedProviderSet = new Set(dbKeyedProviders);
        const runtimeKeyedProviders = Array.from(new Set(
            runtimeStatus
                .filter(item => item.has_key)
                .map(item => normalizeProvider(item.provider))
                .filter(Boolean)
        ));
        const runtimeOnlyKeyProviders = runtimeKeyedProviders.filter(provider => !dbKeyedProviderSet.has(provider));
        const counts = { ok: 0, error: 0, no_key: 0, blocked_region: 0, connectivity_ok: 0, unknown: 0 };
        providerIds.forEach(provider => {
            const runtime = runtimeMap.get(provider);
            counts[healthStatusFrom(providerHealthFrom(healthMap, provider, runtime?.runtime_model_name), runtime)] += 1;
        });
        return {
            total: configs.length,
            providers: providerIds.length,
            configured: configs.filter(item => Boolean(item.has_key ?? item.api_key_encrypted)).length,
            dbKeyedProviders: dbKeyedProviders.length,
            runtimeKeyedProviders: runtimeKeyedProviders.length,
            runtimeOnlyKeyProviders,
            counts,
        };
    }, [configs, healthMap, runtimeMap, runtimeStatus]);

    const testProvider = useCallback(async (providerRaw: string, modelName?: string | null) => {
        const provider = normalizeProvider(providerRaw);
        if (!provider) return;
        const model = String(modelName || '').trim();
        const query = new URLSearchParams();
        if (model) query.set('model_name', model);
        const suffix = query.toString() ? `?${query.toString()}` : '';
        const displayName = model ? `${provider} / ${model}` : provider;
        const checkKey = providerHealthKey(provider, model);
        setChecking(prev => ({ ...prev, [checkKey]: true }));
        try {
            const result = await apiJson<ProviderHealth>(`/api/admin/api-configs/${encodeURIComponent(provider)}/health${suffix}`);
            setHealthMap(prev => {
                const next = { ...prev };
                putProviderHealth(next, result, model);
                return next;
            });
            await loadConfigs({ showLoading: false });
            const status = healthStatusFromResult(result);
            if (status === 'ok') {
                crmMessage.success(`${provider} 连接正常 (${result.latency_ms ?? '-'} ms)`);
            } else if (status === 'no_key') {
                crmMessage.warning(`${provider} 缺少 API Key`);
            } else if (status === 'connectivity_ok') {
                crmMessage.warning(`${provider} 连接可达，但真实生成未验证 (${result.latency_ms ?? '-'} ms)`);
            } else if (status === 'blocked_region') {
                crmMessage.warning(`${provider} 地区受限：${result.health?.error || result.status || 'unknown'}`);
            } else {
                crmMessage.error(`${provider} 连接异常：${result.health?.error || result.status || 'unknown'}`);
            }
        } catch (err: any) {
            crmMessage.error(`${provider} 测试失败：${err?.message || 'unknown'}`);
        } finally {
            setChecking(prev => ({ ...prev, [checkKey]: false }));
        }
    }, [loadConfigs]);

    const testConfig = useCallback(async (config: ApiConfig) => {
        const configId = config.config_id;
        if (!configId) return;
        setTestingConfig(prev => ({ ...prev, [configId]: true }));
        try {
            const startedAt = performance.now();
            const result = await apiJson<ApiConfigTestResponse>(`/api/admin/api-configs/${encodeURIComponent(configId)}/test`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const latencyMs = Math.round(performance.now() - startedAt);
            const test = { ...(result.test || {}), latency_ms: latencyMs };
            setConfigTestMap(prev => ({ ...prev, [configId]: test }));
            if (test.ok) {
                const runtimeWarning = configTestRuntimeWarning(test);
                if (runtimeWarning) {
                    crmMessage.warning(`${config.name || config.provider} ${runtimeWarning}`);
                } else if (test.used_runtime_key) {
                    crmMessage.warning(`${config.name || config.provider} 运行时 Key 可用，但 DB 未保存 Key`);
                } else {
                    crmMessage.success(`${config.name || config.provider} 配置可用`);
                }
            } else if (test.error === 'No API key configured') {
                crmMessage.warning(`${config.name || config.provider} 缺少 API Key`);
            } else if (healthStatusFromConfigTest(test) === 'connectivity_ok') {
                crmMessage.warning(`${config.name || config.provider} 连接可达，但真实生成未验证`);
            } else if (healthStatusFromConfigTest(test) === 'blocked_region') {
                crmMessage.warning(`${config.name || config.provider} 地区受限：${test.error || `HTTP ${test.status_code || '-'}`}`);
            } else {
                crmMessage.error(`${config.name || config.provider} 配置异常：${test.error || `HTTP ${test.status_code || '-'}`}`);
            }
        } catch (err: any) {
            crmMessage.error(`配置测试失败：${err?.message || 'unknown'}`);
        } finally {
            setTestingConfig(prev => ({ ...prev, [configId]: false }));
        }
    }, []);

    const testAllConfigs = useCallback(async () => {
        if (!configs.length) return;
        setTestingAllConfigs(true);
        try {
            const result = await apiJson<ApiConfigBatchTestResponse>('/api/admin/api-configs/test-all', {
                method: 'POST',
                body: JSON.stringify({ enabled_only: false }),
            });
            const rows = result.config_tests || [];
            setConfigTestMap(prev => {
                const next = { ...prev };
                rows.forEach(item => {
                    if (item.config_id && item.test) next[item.config_id] = item.test;
                });
                return next;
            });
            const summary = result.summary || {};
            crmMessage.success(
                `配置测试完成：ok ${summary.ok ?? 0} / reachable ${summary.connectivity_ok ?? 0} / no_key ${summary.no_key ?? 0} / auth ${summary.auth_error ?? 0} / error ${summary.error ?? 0}`
            );
        } catch (err: any) {
            crmMessage.error(`批量配置测试失败：${err?.message || 'unknown'}`);
        } finally {
            setTestingAllConfigs(false);
        }
    }, [configs]);

    const sweepProviders = useCallback(async () => {
        const targets = Array.from(configsByProvider.entries())
            .map(([provider, providerConfigs]) => {
                const primaryConfig = bestConfigForProvider(providerConfigs, provider);
                const modelNameHint = primaryConfig?.model_name || providerMetaMap.get(provider)?.default_model_name || null;
                const runtime = runtimeForProviderModel(provider, modelNameHint);
                return {
                    provider,
                    model_name: modelNameHint || runtime?.runtime_model_name || undefined,
                };
            })
            .filter(target => target.provider);
        if (!targets.length) return;
        setSweeping(true);
        try {
            const result = await apiJson<ProviderHealthSweepResponse>('/api/admin/api-configs/health/sweep', {
                method: 'POST',
                body: JSON.stringify({ targets }),
            });
            const rows = result.provider_health || [];
            setMonitorState(result.monitor_state || null);
            setHealthMap(prev => {
                const next = { ...prev };
                rows.forEach(item => {
                    putProviderHealth(next, item);
                });
                return next;
            });
            await loadConfigs({ showLoading: false });
            const summary = result.summary || {};
            crmMessage.success(`巡检完成：ok ${summary.ok ?? 0} / reachable ${summary.connectivity_ok ?? 0} / error ${summary.error ?? 0} / no_key ${summary.no_key ?? 0}`);
        } catch (err: any) {
            crmMessage.error(`批量巡检失败：${err?.message || 'unknown'}`);
        } finally {
            setSweeping(false);
        }
    }, [configsByProvider, loadConfigs, providerMetaMap, runtimeForProviderModel]);

    const reloadRuntimeEnv = useCallback(async () => {
        setReloadingEnv(true);
        try {
            const result = await apiJson<ApiConfigReloadEnvResponse>('/api/admin/api-configs/reload-env', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            if (result.env_refreshed) {
                crmMessage.success(`运行时已刷新：加载 ${result.loaded ?? 0} 条配置`);
            } else {
                crmMessage.warning(`运行时刷新失败：${result.error || 'unknown'}`);
            }
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`运行时刷新失败：${err?.message || 'unknown'}`);
        } finally {
            setReloadingEnv(false);
        }
    }, [loadConfigs]);

    const repairProviderConflicts = useCallback(async () => {
        setRepairingConflicts(true);
        try {
            const dryRun = await apiJson<ApiConfigRepairConflictsResponse>('/api/admin/api-configs/repair-conflicts', {
                method: 'POST',
                body: JSON.stringify({ dry_run: true }),
            });
            const wouldDisable = dryRun.would_disable ?? 0;
            const conflictCount = dryRun.total_conflicts ?? dryRun.conflicts?.length ?? 0;
            if (!wouldDisable) {
                crmMessage.success('没有发现需要修复的重复启用配置');
                return;
            }

            const ok = await crmConfirm({
                title: '修复 API 配置冲突',
                message: `检测到 ${conflictCount} 个 provider 存在重复启用 Key，将关闭 ${wouldDisable} 条旧配置，并保留当前运行时生效配置。是否继续？`,
                type: 'warning',
                confirmText: '修复',
            });
            if (!ok) return;

            const result = await apiJson<ApiConfigRepairConflictsResponse>('/api/admin/api-configs/repair-conflicts', {
                method: 'POST',
                body: JSON.stringify({ dry_run: false }),
            });
            const disabled = result.total_disabled ?? 0;
            const message = `已关闭 ${disabled} 条重复配置`;
            if (result.env_refreshed === false) crmMessage.warning(`${message}，但运行时刷新失败`);
            else crmMessage.success(`${message}并刷新运行时`);
            setConfigTestMap({});
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`修复冲突失败：${err?.message || 'unknown'}`);
        } finally {
            setRepairingConflicts(false);
        }
    }, [loadConfigs]);

    const openCreate = useCallback(() => {
        setEditingForm(emptyConfigForm());
    }, []);

    const openEdit = useCallback((config: ApiConfig) => {
        const provider = normalizeProvider(config.provider);
        const extraFields = providerMetaMap.get(provider)?.extra_fields || [];
        setEditingForm(configToForm(config, extraFields));
    }, [providerMetaMap]);

    const openProviderConfig = useCallback((meta: ProviderMeta) => {
        const provider = normalizeProvider(meta.provider);
        const existing = bestConfigForProvider(configsByProvider.get(provider) || [], provider);
        if (existing) {
            const extraFields = providerMetaMap.get(provider)?.extra_fields || [];
            setEditingForm(configToForm(existing, extraFields));
            return;
        }
        setEditingForm(providerMetaToForm(meta));
    }, [configsByProvider, providerMetaMap]);

    const saveConfig = useCallback(async () => {
        if (!editingForm) return;
        const name = editingForm.name.trim();
        const provider = normalizeProvider(editingForm.provider);
        const endpoint = editingForm.endpoint.trim();
        const apiKey = editingForm.api_key.trim();
        const bulkApiKeys = splitBulkApiKeys(editingForm.bulk_api_keys);
        if (!name || !provider || !endpoint) {
            crmMessage.warning('请填写名称、provider 和 endpoint');
            return;
        }
        if (!editingForm.config_id && editingForm.bulk_mode && bulkApiKeys.length === 0) {
            crmMessage.warning('请至少填写一个 API Key');
            return;
        }
        if (!editingForm.config_id && !editingForm.bulk_mode && !apiKey) {
            crmMessage.warning('新增 API 配置需要填写 API Key');
            return;
        }

        let requestTemplate: JsonRecord;
        let headers: JsonRecord;
        const extraFields = providerMetaMap.get(provider)?.extra_fields || [];
        try {
            requestTemplate = parseJsonText(editingForm.request_template, 'Request Template');
            headers = parseJsonText(editingForm.headers, 'Headers');
        } catch (err: any) {
            crmMessage.warning(err?.message || '高级配置 JSON 格式错误');
            return;
        }
        applyExtraValuesToRecords(
            extraFields,
            {
                ...extraValuesFromRecords(extraFields, requestTemplate, headers),
                ...editingForm.extra_values,
            },
            requestTemplate,
            headers,
        );

        setSaving(true);
        try {
            const body: Record<string, any> = {
                name,
                provider,
                endpoint,
                model_name: editingForm.model_name.trim(),
                proxy_mode: editingForm.proxy_mode || 'direct',
                custom_proxy: editingForm.proxy_mode === 'custom' ? editingForm.custom_proxy.trim() : '',
                request_template: requestTemplate,
                headers,
                category: editingForm.category || '',
                enabled: editingForm.enabled,
            };
            if (apiKey) body.api_key = apiKey;

            const isEdit = Boolean(editingForm.config_id);
            const result = isEdit
                ? await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${editingForm.config_id}`, {
                    method: 'PUT',
                    body: JSON.stringify(body),
                })
                : editingForm.bulk_mode
                ? await apiJson<ApiConfigWriteResponse>('/api/admin/api-configs/bulk-keys', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...body,
                        api_keys: bulkApiKeys,
                        name_prefix: name,
                        activate_index: 0,
                    }),
                })
                : await apiJson<ApiConfigWriteResponse>('/api/admin/api-configs', {
                    method: 'POST',
                    body: JSON.stringify({ ...body, api_key: apiKey }),
                });

            const message = `${envRefreshMessage(result, isEdit ? '配置' : '新配置')}${conflictDisableSuffix(result)}`;
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success(message);
            setEditingForm(null);
            setConfigTestMap(prev => {
                if (!editingForm.config_id) return prev;
                const next = { ...prev };
                delete next[editingForm.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`保存失败：${err?.message || 'unknown'}`);
        } finally {
            setSaving(false);
        }
    }, [editingForm, loadConfigs, providerMetaMap]);

    const toggleConfig = useCallback(async (config: ApiConfig) => {
        const nextEnabled = config.enabled === false;
        try {
            const result = await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${config.config_id}`, {
                method: 'PUT',
                body: JSON.stringify({ enabled: nextEnabled }),
            });
            const action = nextEnabled ? '启用' : '禁用';
            const message = `${envRefreshMessage(result, action)}${conflictDisableSuffix(result)}`;
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success(message);
            setConfigTestMap(prev => {
                const next = { ...prev };
                delete next[config.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`切换失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const activateConfig = useCallback(async (config: ApiConfig) => {
        if (!config.config_id) return;
        try {
            const result = await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${config.config_id}/activate`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const message = `${envRefreshMessage(result, 'Key 已切换')}${activationDisableSuffix(result)}`;
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success(message);
            setConfigTestMap(prev => {
                const next = { ...prev };
                delete next[config.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`Key 切换失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const deleteConfig = useCallback(async (config: ApiConfig) => {
        const ok = await crmConfirm({
            title: '删除 API 配置',
            message: `确认删除「${config.name || config.provider}」？删除后运行时环境会重新刷新。`,
            type: 'danger',
            confirmText: '删除',
        });
        if (!ok) return;
        try {
            const result = await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${config.config_id}`, {
                method: 'DELETE',
            });
            const message = envRefreshMessage(result, '配置');
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success('配置已删除并刷新');
            setConfigTestMap(prev => {
                const next = { ...prev };
                delete next[config.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`删除失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const importPresets = useCallback(async () => {
        try {
            const result = await apiJson<ApiConfigImportResponse>('/api/admin/api-configs/import-presets', {
                method: 'POST',
                body: JSON.stringify(RUNTIME_KEY_IMPORT_BODY),
            });
            const message = `导入完成：新增 ${result.imported ?? 0}，更新 ${result.updated_existing ?? 0}，写入Key ${result.env_keys_imported ?? 0}，缺Key ${result.env_keys_missing ?? 0}`;
            if (result.env_refreshed === false) crmMessage.warning(`${message}，但运行时刷新失败`);
            else crmMessage.success(message);
            setConfigTestMap({});
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`导入失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const migrateRuntimeKeys = useCallback(async () => {
        setMigratingRuntimeKeys(true);
        try {
            const dryRun = await apiJson<ApiConfigImportResponse>('/api/admin/api-configs/import-presets', {
                method: 'POST',
                body: JSON.stringify({ ...RUNTIME_KEY_IMPORT_BODY, dry_run: true }),
            });
            const importableKeys = dryRun.env_keys_imported ?? 0;
            const existingKeys = dryRun.env_keys_existing ?? 0;
            const missingKeys = dryRun.env_keys_missing ?? 0;
            const claimedKeys = dryRun.env_keys_skipped_provider_claimed ?? 0;
            if (importableKeys <= 0) {
                crmMessage.success(`没有可迁移的运行时 Key：已落库 ${existingKeys}，缺 Key ${missingKeys}，重复预设 ${claimedKeys}`);
                return;
            }

            const ok = await crmConfirm({
                title: '迁移运行时 Key',
                message: `将把 ${importableKeys} 个运行时 Key 写入后台 DB 配置，并跳过 ${claimedKeys} 个同 provider 重复预设；缺 Key ${missingKeys}。是否继续？`,
                type: 'warning',
                confirmText: '迁移',
            });
            if (!ok) return;

            const result = await apiJson<ApiConfigImportResponse>('/api/admin/api-configs/import-presets', {
                method: 'POST',
                body: JSON.stringify(RUNTIME_KEY_IMPORT_BODY),
            });
            const message = `运行时 Key 迁移完成：写入 ${result.env_keys_imported ?? 0}，更新 ${result.updated_existing ?? 0}，新增 ${result.imported ?? 0}，缺 Key ${result.env_keys_missing ?? 0}`;
            if (result.env_refreshed === false) crmMessage.warning(`${message}，但运行时刷新失败`);
            else crmMessage.success(message);
            setConfigTestMap({});
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`运行时 Key 迁移失败：${err?.message || 'unknown'}`);
        } finally {
            setMigratingRuntimeKeys(false);
        }
    }, [loadConfigs]);

    const categoryOrder = ['text', 'image', 'video', 'audio', 'other'];

    return (
        <>
        <div className="layout-safe h-full min-h-0 w-full overflow-auto bg-n20">
            <div className="mx-auto max-w-7xl p-5 space-y-4">
                <header className="responsive-toolbar flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-n100">
                            <ServerCog className="w-3.5 h-3.5" />
                            API Providers
                        </div>
                        <h1 className="mt-1 text-xl font-semibold text-n800">厂商 API Key 与 Endpoint</h1>
                    </div>
                    <div className="toolbar-actions">
                        <button
                            type="button"
                            onClick={openCreate}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            新增 / 修改厂商 API
                        </button>
                        <button
                            type="button"
                            onClick={() => loadConfigs()}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={refreshHealthCache}
                            disabled={refreshingHealth || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {refreshingHealth ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                            查看健康缓存
                        </button>
                        <button
                            type="button"
                            onClick={reloadRuntimeEnv}
                            disabled={reloadingEnv || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {reloadingEnv ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            刷新运行时
                        </button>
                        <button
                            type="button"
                            onClick={sweepProviders}
                            disabled={sweeping || loading || configs.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {sweeping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                            刷新生效健康
                        </button>
                        <button
                            type="button"
                            onClick={repairProviderConflicts}
                            disabled={repairingConflicts || loading || configs.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-y200 bg-y50 text-y400 hover:bg-y50 disabled:opacity-60"
                        >
                            {repairingConflicts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
                            修复冲突
                        </button>
                        <button
                            type="button"
                            onClick={testAllConfigs}
                            disabled={testingAllConfigs || loading || configs.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {testingAllConfigs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                            批量测试 DB 配置
                        </button>
                        <button
                            type="button"
                            onClick={importPresets}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                        >
                            <ServerCog className="w-3.5 h-3.5" />
                            导入预设模型
                        </button>
                        <button
                            type="button"
                            onClick={migrateRuntimeKeys}
                            disabled={migratingRuntimeKeys || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-y200 bg-y50 text-y400 hover:bg-y50 disabled:opacity-60"
                        >
                            {migratingRuntimeKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                            迁移运行时 Key
                        </button>
                    </div>
                </header>

                <ProviderHealthMonitorStrip state={monitorState} />

                <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Configs</div>
                        <div className="mt-1 text-2xl font-semibold text-n800 font-mono">{summary.total}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Providers</div>
                        <div className="mt-1 text-2xl font-semibold text-n800 font-mono">{summary.providers}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Keyed</div>
                        <div className="mt-1 text-2xl font-semibold text-n800 font-mono">{summary.configured}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">OK</div>
                        <div className="mt-1 text-2xl font-semibold text-success font-mono">{summary.counts.ok}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Error</div>
                        <div className="mt-1 text-2xl font-semibold text-danger font-mono">{summary.counts.error}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">No Key</div>
                        <div className="mt-1 text-2xl font-semibold text-r400 font-mono">{summary.counts.no_key}</div>
                    </div>
                </section>

                {error && (
                    <div className="rounded-md border border-r75 bg-r50 px-3 py-2 text-sm text-danger">{error}</div>
                )}

                {summary.runtimeOnlyKeyProviders.length > 0 && (
                    <section className="rounded-md border border-y200 bg-y50 px-3 py-2 shadow-card flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 text-xs text-y400">
                            <span className="font-semibold">运行时 Key 未落库</span>
                            <span className="ml-2">
                                {summary.runtimeOnlyKeyProviders.length} 个 provider 正在使用 env/运行时 Key，后台 DB 暂无保存 Key。
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={migrateRuntimeKeys}
                            disabled={migratingRuntimeKeys || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-y200 bg-n0 text-y400 hover:bg-y50 disabled:opacity-60"
                        >
                            {migratingRuntimeKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                            迁移运行时 Key
                        </button>
                    </section>
                )}

                <section className="space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <h2 className="text-sm font-semibold text-n800">厂商快速配置</h2>
                            <p className="mt-0.5 text-xs text-n100">每张卡片都可以直接配置或修改 API Key、Endpoint 和模型；状态以实际生效配置为准。</p>
                        </div>
                        <div className="toolbar-actions">
                            <span className="text-xs text-n100 font-mono">{quickProviders.length} providers</span>
                            <button
                                type="button"
                                onClick={openCreate}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                新增自定义 API
                            </button>
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {quickProviders.map(meta => {
                            const provider = normalizeProvider(meta.provider);
                            const providerConfigs = configsByProvider.get(provider) || [];
                            const primaryConfig = bestConfigForProvider(providerConfigs, provider);
                            const modelNameHint = primaryConfig?.model_name || meta.default_model_name || null;
                            const runtime = runtimeForProviderModel(provider, modelNameHint);
                            const modelName = modelNameHint || runtime?.runtime_model_name || null;
                            return (
                                <ProviderQuickCard
                                    key={provider}
                                    meta={meta}
                                    configs={providerConfigs}
                                    runtime={runtime}
                                    health={providerHealthFrom(healthMap, provider, modelName)}
                                    configTest={primaryConfig ? configTestMap[primaryConfig.config_id] : undefined}
                                    checking={Boolean(checking[providerHealthKey(provider, modelName)])}
                                    testingConfig={testingAllConfigs || Boolean(primaryConfig && testingConfig[primaryConfig.config_id])}
                                    onConfigure={openProviderConfig}
                                    onEditConfig={openEdit}
                                    onTestConfig={testConfig}
                                    onCheck={testProvider}
                                />
                            );
                        })}
                    </div>
                </section>

                {loading ? (
                    <div className="flex items-center justify-center h-64 text-n100">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        加载中
                    </div>
                ) : configs.length === 0 ? (
                    <div className="bg-n0 border border-n40 rounded-md p-10 text-center text-n100">
                        暂无 API 配置记录，可在上方选择厂商新增配置
                    </div>
                ) : (
                    <div className="space-y-5">
                        {categoryOrder.map(category => {
                            const items = grouped[category] || [];
                            if (!items.length) return null;
                            return (
                                <section key={category} className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-semibold text-n800">{CATEGORY_LABELS[category] || category}</h2>
                                        <span className="text-xs text-n100 font-mono">{items.length}</span>
                                    </div>
                                    <div className="grid gap-3">
                                        {items.map(config => {
                                            const provider = normalizeProvider(config.provider);
                                            const runtime = runtimeForConfig(config);
                                            const modelName = config.model_name || runtime?.runtime_model_name || null;
                                            return (
                                                <ApiConfigCard
                                                    key={config.config_id}
                                                    config={config}
                                                    meta={providerMetaMap.get(provider)}
                                                    runtime={runtime}
                                                    health={providerHealthFrom(healthMap, provider, modelName)}
                                                    configTest={configTestMap[config.config_id]}
                                                    checking={Boolean(checking[providerHealthKey(provider, modelName)])}
                                                    testingConfig={testingAllConfigs || Boolean(testingConfig[config.config_id])}
                                                    onCheck={testProvider}
                                                    onTestConfig={testConfig}
                                                    onEdit={openEdit}
                                                    onActivate={activateConfig}
                                                    onToggle={toggleConfig}
                                                    onDelete={deleteConfig}
                                                />
                                            );
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
        {editingForm && (
            <ApiConfigEditorModal
                form={editingForm}
                providers={providers}
                saving={saving}
                onChange={setEditingForm}
                onClose={() => {
                    if (!saving) setEditingForm(null);
                }}
                onSubmit={saveConfig}
            />
        )}
        </>
    );
};

export const AdminSettingsPage: React.FC = () => {
    const [sp] = useSearchParams();
    const raw = sp.get('item') || 'apiconfig';

    if (raw === 'apiconfig' || raw === 'legacy-apiconfig') {
        return <ApiConfigPanel />;
    }

    if (raw === 'recyclebin') {
        return (
            <div className="p-6">
                <AdminRecycleBinPanel />
            </div>
        );
    }

    const page = LEGACY_PAGE_BY_ITEM[raw];
    if (!page) {
        return <ApiConfigPanel />;
    }

    return (
        <div className="h-full w-full min-h-0 min-w-0 overflow-hidden">
            <iframe
                key={page}
                title="legacy-admin"
                src={`/admin-legacy/?embed=1&v=${LEGACY_VER}&page=${page}#${page}`}
                className="w-full h-full min-w-0 border-0 block bg-n20"
            />
        </div>
    );
};

export default AdminSettingsPage;
