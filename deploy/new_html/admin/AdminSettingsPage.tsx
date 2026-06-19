/**
 * AdminSettingsPage.tsx - system settings shell.
 *
 * API config is rendered natively so provider health can be shown without
 * reaching into the legacy iframe. Other settings pages continue to use the
 * legacy console until they are migrated.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    Edit3,
    ExternalLink,
    KeyRound,
    Loader2,
    Plus,
    RefreshCw,
    ServerCog,
    Timer,
    Trash2,
} from 'lucide-react';
import { pickTokenForCurrentRoute } from './adminAuth';
import { crmConfirm, crmMessage } from './crmUI';

const LEGACY_VER = '20260619b';
const LEGACY_PAGE_BY_ITEM: Record<string, string> = {
    'legacy-apiconfig': 'apiconfig',
    cluster: 'cluster',
    workflows: 'workflows',
    dashboard: 'dashboard',
};

type HealthStatus = 'ok' | 'error' | 'no_key' | 'unknown';

interface ApiConfig {
    config_id: string;
    name: string;
    provider: string;
    endpoint?: string;
    api_key_encrypted?: string;
    model_name?: string;
    proxy_mode?: string;
    custom_proxy?: string;
    category?: string;
    enabled?: boolean;
}

interface ProviderMeta {
    provider: string;
    label?: string;
    vendor?: string;
    env_key?: string;
    notes?: string;
    capabilities?: string[];
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
    endpoint_env?: string;
    endpoint_source?: string;
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

interface ApiConfigTest {
    ok?: boolean;
    reachable?: boolean;
    auth_ok?: boolean;
    status_code?: number | null;
    url?: string | null;
    error?: string | null;
    provider?: string | null;
    model_name?: string | null;
    method?: string;
    checked_at?: string;
    urls_tried?: string[];
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
}

interface ApiConfigFormState {
    config_id?: string;
    name: string;
    provider: string;
    endpoint: string;
    api_key: string;
    model_name: string;
    proxy_mode: string;
    custom_proxy: string;
    category: string;
    enabled: boolean;
}

interface ApiConfigWriteResponse {
    success: boolean;
    api_config?: ApiConfig;
    deleted?: boolean;
    env_refreshed?: boolean | null;
    disabled_conflicting_config_ids?: string[];
}

interface ApiConfigImportResponse {
    success: boolean;
    imported?: number;
    skipped?: number;
    updated_existing?: number;
    env_keys_imported?: number;
    env_keys_missing?: number;
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
        unknown?: number;
    };
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

function normalizeProvider(provider: string | undefined | null): string {
    return String(provider || '').trim().toLowerCase();
}

function getHeaders(): HeadersInit {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = pickTokenForCurrentRoute();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...getHeaders(),
            ...(options.headers || {}),
        },
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
    }
    return response.json();
}

function formatEndpoint(endpoint?: string): string {
    if (!endpoint) return '-';
    return endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
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
            text: '正常',
            dot: 'bg-success',
            badge: 'bg-success-light text-success',
            icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        },
        error: {
            label: 'error',
            text: '异常',
            dot: 'bg-danger',
            badge: 'bg-r50 text-danger',
            icon: <AlertCircle className="w-3.5 h-3.5" />,
        },
        no_key: {
            label: 'no_key',
            text: '缺少 Key',
            dot: 'bg-warning',
            badge: 'bg-y50 text-y400',
            icon: <KeyRound className="w-3.5 h-3.5" />,
        },
        unknown: {
            label: 'unknown',
            text: '未检测',
            dot: 'bg-n100',
            badge: 'bg-n30 text-n300',
            icon: <Activity className="w-3.5 h-3.5" />,
        },
    };
    return map[status];
}

function healthStatusFrom(health?: ProviderHealth, runtime?: RuntimeStatus): HealthStatus {
    const status = String(health?.status || runtime?.health_status || '').toLowerCase();
    if (status === 'ok' || status === 'error' || status === 'no_key') return status;
    if (runtime?.has_key === false) return 'no_key';
    return 'unknown';
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

function emptyConfigForm(): ApiConfigFormState {
    return {
        name: '',
        provider: '',
        endpoint: '',
        api_key: '',
        model_name: '',
        proxy_mode: 'direct',
        custom_proxy: '',
        category: 'text',
        enabled: true,
    };
}

function configToForm(config: ApiConfig): ApiConfigFormState {
    return {
        config_id: config.config_id,
        name: config.name || '',
        provider: config.provider || '',
        endpoint: config.endpoint || '',
        api_key: '',
        model_name: config.model_name || '',
        proxy_mode: config.proxy_mode || 'direct',
        custom_proxy: config.custom_proxy || '',
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
                                required={!isEdit}
                                value={form.api_key}
                                onChange={event => patch({ api_key: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                placeholder={isEdit ? '留空保留现有 Key' : 'sk-...'}
                            />
                        </label>
                    </div>

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
    onCheck: (provider: string) => void;
    onTestConfig: (config: ApiConfig) => void;
    onEdit: (config: ApiConfig) => void;
    onToggle: (config: ApiConfig) => void;
    onDelete: (config: ApiConfig) => void;
}> = ({ config, meta, runtime, health, configTest, checking, testingConfig, onCheck, onTestConfig, onEdit, onToggle, onDelete }) => {
    const provider = normalizeProvider(config.provider);
    const status = healthStatusFrom(health, runtime);
    const view = statusView(status);
    const hasKey = Boolean(config.api_key_encrypted);
    const healthError = health?.health?.error || runtime?.health_error || '';
    const healthLatency = typeof health?.latency_ms === 'number' ? health.latency_ms : runtime?.health_latency_ms;
    const healthCheckedAt = health?.checked_at || runtime?.health_checked_at || runtime?.health_cached_at;
    const runtimeIssue = runtimeIssueText(runtime?.issues);
    const effectiveConfig = runtime?.db_effective_config_name || runtime?.db_effective_config_id || '';
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
    const configTestClass = configTest?.ok
        ? 'border-g75 bg-g50 text-success'
        : 'border-y200 bg-y50 text-y400';

    return (
        <article className="bg-n0 border border-n40 rounded-md shadow-card p-4 min-w-0">
            <div className="flex items-start gap-3 min-w-0">
                <div className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${view.dot}`} title={view.text} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <h3 className="text-sm font-semibold text-n800 leading-snug break-words">{config.name || meta?.label || provider}</h3>
                                {!config.enabled && (
                                    <span className="rounded bg-r50 text-danger px-1.5 py-0.5 text-[10px] font-semibold">禁用</span>
                                )}
                                {!hasKey && (
                                    <span className="rounded bg-y50 text-y400 px-1.5 py-0.5 text-[10px] font-semibold">待填 Key</span>
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
                                onClick={() => onCheck(provider)}
                                disabled={checking || !provider}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60 shrink-0"
                                title="测试当前 provider 的运行时 key 和 endpoint"
                            >
                                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                测运行时
                            </button>
                            <button
                                type="button"
                                onClick={() => onTestConfig(config)}
                                disabled={testingConfig || !config.config_id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60 shrink-0"
                                title="测试这条配置自身保存的 key 和 endpoint"
                            >
                                {testingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                                测配置
                            </button>
                            <button
                                type="button"
                                onClick={() => onEdit(config)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                                编辑
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
                            <div className="font-mono text-xs text-n700 break-all">{formatEndpoint(config.endpoint || runtime?.endpoint)}</div>
                            <div className="mt-2 grid gap-1 text-[11px] text-n100 sm:grid-cols-2">
                                <div className="min-w-0">
                                    Key: <span className="font-mono text-n700 break-all">{sourceText(runtime?.api_key_source, runtime?.api_key_env)}</span>
                                </div>
                                <div className="min-w-0">
                                    Endpoint: <span className="font-mono text-n700 break-all">{sourceText(runtime?.endpoint_source, runtime?.endpoint_env)}</span>
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
                        <div className="mt-2 rounded border border-y200 bg-y50 px-3 py-2 text-[11px] text-y400 break-words">
                            {healthError}
                        </div>
                    )}

                    {configTest && (
                        <div className={`mt-2 rounded border px-3 py-2 text-[11px] break-words ${configTestClass}`}>
                            <span className="font-semibold">配置测试：</span>
                            <span>{configTest.ok ? '正常' : '异常'}</span>
                            <span className="mx-1 text-n100">/</span>
                            <span className="font-mono text-n700">HTTP {configTest.status_code || '-'}</span>
                            <span className="mx-1 text-n100">/</span>
                            <span>{formatTime(configTest.checked_at)}</span>
                            {configTest.url && (
                                <div className="mt-1 font-mono text-n700 break-all">{formatEndpoint(configTest.url)}</div>
                            )}
                            {configTest.error && (
                                <div className="mt-1">{configTest.error}</div>
                            )}
                        </div>
                    )}

                    {meta?.notes && (
                        <div className="mt-2 text-[11px] text-n100 leading-relaxed break-words">{meta.notes}</div>
                    )}
                </div>
            </div>
        </article>
    );
};

const ApiConfigPanel: React.FC = () => {
    const navigate = useNavigate();
    const [configs, setConfigs] = useState<ApiConfig[]>([]);
    const [providers, setProviders] = useState<ProviderMeta[]>([]);
    const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus[]>([]);
    const [healthMap, setHealthMap] = useState<Record<string, ProviderHealth>>({});
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
            const nextHealth: Record<string, ProviderHealth> = {};
            (data.provider_health || []).forEach(item => {
                const provider = normalizeProvider(item.provider);
                if (provider) nextHealth[provider] = item;
            });
            setHealthMap(nextHealth);
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
            setHealthMap(prev => {
                const next = { ...prev };
                rows.forEach(item => {
                    const provider = normalizeProvider(item.provider);
                    if (provider) next[provider] = item;
                });
                return next;
            });
            const summary = result.summary || {};
            crmMessage.success(`状态已刷新：ok ${summary.ok ?? 0} / error ${summary.error ?? 0} / no_key ${summary.no_key ?? 0}`);
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

    const grouped = useMemo(() => {
        const out: Record<string, ApiConfig[]> = {};
        configs.forEach(config => {
            const category = groupCategory(config);
            if (!out[category]) out[category] = [];
            out[category].push(config);
        });
        return out;
    }, [configs]);

    const summary = useMemo(() => {
        const providerIds = Array.from(new Set(configs.map(item => normalizeProvider(item.provider)).filter(Boolean)));
        const counts = { ok: 0, error: 0, no_key: 0, unknown: 0 };
        providerIds.forEach(provider => {
            counts[healthStatusFrom(healthMap[provider], runtimeMap.get(provider))] += 1;
        });
        return {
            total: configs.length,
            providers: providerIds.length,
            configured: configs.filter(item => Boolean(item.api_key_encrypted)).length,
            counts,
        };
    }, [configs, healthMap, runtimeMap]);

    const testProvider = useCallback(async (providerRaw: string) => {
        const provider = normalizeProvider(providerRaw);
        if (!provider) return;
        setChecking(prev => ({ ...prev, [provider]: true }));
        try {
            const result = await apiJson<ProviderHealth>(`/api/admin/api-configs/${encodeURIComponent(provider)}/health`);
            setHealthMap(prev => ({ ...prev, [provider]: result }));
            await loadConfigs({ showLoading: false });
            const status = healthStatusFrom(result, runtimeMap.get(provider));
            if (status === 'ok') {
                crmMessage.success(`${provider} 连接正常 (${result.latency_ms ?? '-'} ms)`);
            } else if (status === 'no_key') {
                crmMessage.warning(`${provider} 缺少 API Key`);
            } else {
                crmMessage.error(`${provider} 连接异常：${result.health?.error || result.status || 'unknown'}`);
            }
        } catch (err: any) {
            crmMessage.error(`${provider} 测试失败：${err?.message || 'unknown'}`);
        } finally {
            setChecking(prev => ({ ...prev, [provider]: false }));
        }
    }, [loadConfigs, runtimeMap]);

    const testConfig = useCallback(async (config: ApiConfig) => {
        const configId = config.config_id;
        if (!configId) return;
        setTestingConfig(prev => ({ ...prev, [configId]: true }));
        try {
            const result = await apiJson<ApiConfigTestResponse>(`/api/admin/api-configs/${encodeURIComponent(configId)}/test`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const test = result.test || {};
            setConfigTestMap(prev => ({ ...prev, [configId]: test }));
            if (test.ok) {
                crmMessage.success(`${config.name || config.provider} 配置可用`);
            } else if (test.error === 'No API key configured') {
                crmMessage.warning(`${config.name || config.provider} 缺少 API Key`);
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
                `配置测试完成：ok ${summary.ok ?? 0} / no_key ${summary.no_key ?? 0} / auth ${summary.auth_error ?? 0} / error ${summary.error ?? 0}`
            );
        } catch (err: any) {
            crmMessage.error(`批量配置测试失败：${err?.message || 'unknown'}`);
        } finally {
            setTestingAllConfigs(false);
        }
    }, [configs]);

    const sweepProviders = useCallback(async () => {
        const providerIds = Array.from(new Set(configs.map(item => normalizeProvider(item.provider)).filter(Boolean)));
        if (!providerIds.length) return;
        setSweeping(true);
        try {
            const result = await apiJson<ProviderHealthSweepResponse>('/api/admin/api-configs/health/sweep', {
                method: 'POST',
                body: JSON.stringify({ providers: providerIds }),
            });
            const rows = result.provider_health || [];
            setHealthMap(prev => {
                const next = { ...prev };
                rows.forEach(item => {
                    const provider = normalizeProvider(item.provider);
                    if (provider) next[provider] = item;
                });
                return next;
            });
            await loadConfigs({ showLoading: false });
            const summary = result.summary || {};
            crmMessage.success(`巡检完成：ok ${summary.ok ?? 0} / error ${summary.error ?? 0} / no_key ${summary.no_key ?? 0}`);
        } catch (err: any) {
            crmMessage.error(`批量巡检失败：${err?.message || 'unknown'}`);
        } finally {
            setSweeping(false);
        }
    }, [configs, loadConfigs]);

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
        setEditingForm(configToForm(config));
    }, []);

    const saveConfig = useCallback(async () => {
        if (!editingForm) return;
        const name = editingForm.name.trim();
        const provider = normalizeProvider(editingForm.provider);
        const endpoint = editingForm.endpoint.trim();
        const apiKey = editingForm.api_key.trim();
        if (!name || !provider || !endpoint) {
            crmMessage.warning('请填写名称、provider 和 endpoint');
            return;
        }
        if (!editingForm.config_id && !apiKey) {
            crmMessage.warning('新增 API 配置需要填写 API Key');
            return;
        }

        setSaving(true);
        try {
            const body: Record<string, any> = {
                name,
                provider,
                endpoint,
                model_name: editingForm.model_name.trim(),
                proxy_mode: editingForm.proxy_mode || 'direct',
                custom_proxy: editingForm.proxy_mode === 'custom' ? editingForm.custom_proxy.trim() : '',
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
    }, [editingForm, loadConfigs]);

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
                body: JSON.stringify({
                    copy_runtime_env_keys: true,
                    update_existing_empty_keys: true,
                    enable_copied_keys: true,
                }),
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
                        <h1 className="mt-1 text-xl font-semibold text-n800">API 配置</h1>
                    </div>
                    <div className="toolbar-actions">
                        <button
                            type="button"
                            onClick={openCreate}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            新增配置
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
                            刷新状态
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
                            测试全部
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
                            测全部配置
                        </button>
                        <button
                            type="button"
                            onClick={importPresets}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                        >
                            <ServerCog className="w-3.5 h-3.5" />
                            导入预设
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/settings?item=legacy-apiconfig')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            旧版编辑
                        </button>
                    </div>
                </header>

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
                        <div className="mt-1 text-2xl font-semibold text-y400 font-mono">{summary.counts.no_key}</div>
                    </div>
                </section>

                {error && (
                    <div className="rounded-md border border-r75 bg-r50 px-3 py-2 text-sm text-danger">{error}</div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center h-64 text-n100">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        加载中
                    </div>
                ) : configs.length === 0 ? (
                    <div className="bg-n0 border border-n40 rounded-md p-10 text-center text-n100">
                        暂无 API 配置
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
                                            return (
                                                <ApiConfigCard
                                                    key={config.config_id}
                                                    config={config}
                                                    meta={providerMetaMap.get(provider)}
                                                    runtime={runtimeMap.get(provider)}
                                                    health={healthMap[provider]}
                                                    configTest={configTestMap[config.config_id]}
                                                    checking={Boolean(checking[provider])}
                                                    testingConfig={testingAllConfigs || Boolean(testingConfig[config.config_id])}
                                                    onCheck={testProvider}
                                                    onTestConfig={testConfig}
                                                    onEdit={openEdit}
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

    if (raw === 'apiconfig') {
        return <ApiConfigPanel />;
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
