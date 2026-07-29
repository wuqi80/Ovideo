import { AiModel } from '../types';
import { apiJson } from './httpClient';

export interface ScriptModelOption {
  value: AiModel;
  label: string;
  operation: string;
  requestedProvider: string;
  provider: string;
  runtime: string;
  failoverActive: boolean;
  modelScope?: string;
}

interface TextModelCatalogResponse {
  success: boolean;
  models?: Array<{
    value?: string;
    label?: string;
    operation?: string;
    requested_provider?: string;
    provider?: string;
    runtime_model_name?: string;
    failover_active?: boolean;
    model_scope?: string;
  }>;
}

export const DEFAULT_SCRIPT_MODEL_OPTIONS: readonly ScriptModelOption[] = [
  {
    value: AiModel.MinimaxM3,
    label: '练气',
    operation: 'minimax-m3',
    requestedProvider: 'minimax',
    provider: 'minimax',
    runtime: 'MiniMax-M3',
    failoverActive: false,
  },
  {
    value: AiModel.Gemini,
    label: '化神',
    operation: 'gemini-text',
    requestedProvider: 'gemini-text',
    provider: 'gemini-text',
    runtime: 'gemini-2.5-flash',
    failoverActive: false,
  },
  {
    value: AiModel.Deepseek,
    label: '筑基',
    operation: 'deepseek-reasoner',
    requestedProvider: 'deepseek',
    provider: 'deepseek',
    runtime: 'deepseek-v4-pro',
    failoverActive: false,
  },
  {
    value: AiModel.DeepseekChat,
    label: '金丹',
    operation: 'deepseek-chat',
    requestedProvider: 'deepseek',
    provider: 'deepseek',
    runtime: 'deepseek-v4-flash',
    failoverActive: false,
  },
];

const isAiModel = (value: string): value is AiModel => (
  value === AiModel.MinimaxM3
  || value === AiModel.Gemini
  || value === AiModel.Deepseek
  || value === AiModel.DeepseekChat
);

export function normalizeScriptModelOptions(
  rows: TextModelCatalogResponse['models'],
): readonly ScriptModelOption[] {
  if (!Array.isArray(rows)) return DEFAULT_SCRIPT_MODEL_OPTIONS;

  const runtimeByValue = new Map(
    rows
      .filter(row => isAiModel(String(row.value || '')) && String(row.runtime_model_name || '').trim())
      .map(row => [String(row.value) as AiModel, row]),
  );

  return DEFAULT_SCRIPT_MODEL_OPTIONS.map(fallback => {
    const row = runtimeByValue.get(fallback.value);
    if (!row) return fallback;
    return {
      value: fallback.value,
      label: String(row.label || fallback.label).trim(),
      operation: String(row.operation || fallback.operation).trim(),
      requestedProvider: String(row.requested_provider || fallback.requestedProvider).trim(),
      provider: String(row.provider || fallback.provider).trim(),
      runtime: String(row.runtime_model_name || fallback.runtime).trim(),
      failoverActive: Boolean(row.failover_active),
      modelScope: String(row.model_scope || '').trim() || undefined,
    };
  });
}

export async function fetchScriptModelOptions(scope: string = 'workflow'): Promise<readonly ScriptModelOption[]> {
  const normalizedScope = String(scope || 'workflow').trim().toLowerCase() || 'workflow';
  const query = normalizedScope === 'workflow' ? '' : `?scope=${encodeURIComponent(normalizedScope)}`;
  const response = await apiJson<TextModelCatalogResponse>(
    `/api/ai/text-models${query}`,
    undefined,
    '文本模型配置',
  );
  return normalizeScriptModelOptions(response.models);
}

export function getScriptModelOption(
  model: AiModel,
  options: readonly ScriptModelOption[] = DEFAULT_SCRIPT_MODEL_OPTIONS,
): ScriptModelOption {
  return options.find(option => option.value === model)
    || DEFAULT_SCRIPT_MODEL_OPTIONS.find(option => option.value === model)
    || DEFAULT_SCRIPT_MODEL_OPTIONS.find(option => option.value === AiModel.DeepseekChat)
    || DEFAULT_SCRIPT_MODEL_OPTIONS[0];
}

export function resolveScriptAiModel(
  modelName?: string,
  options: readonly ScriptModelOption[] = DEFAULT_SCRIPT_MODEL_OPTIONS,
): AiModel | null {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (!normalized) return null;

  const exact = options.find(option => (
    option.value.toLowerCase() === normalized
    || option.operation.toLowerCase() === normalized
    || option.runtime.toLowerCase() === normalized
  ));
  if (exact) return exact.value;

  if (normalized.includes('minimax') && normalized.includes('m3')) return AiModel.MinimaxM3;
  if (normalized.includes('gemini')) return AiModel.Gemini;
  if (normalized.includes('reasoner') || normalized.includes('v4-pro')) return AiModel.Deepseek;
  if (normalized.includes('deepseek')) return AiModel.DeepseekChat;
  return null;
}

export function formatScriptModelDisplay(option: ScriptModelOption): string {
  if (option.value === AiModel.MinimaxM3) return `${option.label}·Minimax M3`;
  return `${option.label} · ${option.runtime}`;
}
