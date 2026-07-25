import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiModel } from '../../types';

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn(),
}));

import { apiJson } from '../../services/httpClient';
import {
  DEFAULT_SCRIPT_MODEL_OPTIONS,
  fetchScriptModelOptions,
  getScriptModelOption,
  normalizeScriptModelOptions,
  resolveScriptAiModel,
} from '../../services/scriptModelCatalogService';

describe('scriptModelCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses backend runtime models without changing stable frontend values or operations', async () => {
    vi.mocked(apiJson).mockResolvedValue({
      success: true,
      models: [
        {
          value: 'deepseek-chat',
          label: '金丹',
          operation: 'deepseek-chat',
          requested_provider: 'deepseek',
          provider: 'deepseek',
          runtime_model_name: 'deepseek-v4-flash-admin',
          failover_active: false,
        },
        {
          value: 'deepseek',
          label: '筑基',
          operation: 'deepseek-reasoner',
          requested_provider: 'deepseek',
          provider: 'deepseek',
          runtime_model_name: 'deepseek-v4-pro-admin',
          failover_active: false,
        },
        {
          value: 'gemini',
          label: '化神',
          operation: 'gemini-text',
          requested_provider: 'gemini-text',
          provider: 'deepseek',
          runtime_model_name: 'deepseek-v4-pro-fallback',
          failover_active: true,
        },
      ],
    });

    const options = await fetchScriptModelOptions();

    expect(options.map(option => option.value)).toEqual([
      AiModel.Gemini,
      AiModel.Deepseek,
      AiModel.DeepseekChat,
    ]);
    expect(getScriptModelOption(AiModel.DeepseekChat, options)).toMatchObject({
      operation: 'deepseek-chat',
      runtime: 'deepseek-v4-flash-admin',
    });
    expect(getScriptModelOption(AiModel.Deepseek, options)).toMatchObject({
      operation: 'deepseek-reasoner',
      runtime: 'deepseek-v4-pro-admin',
    });
    expect(getScriptModelOption(AiModel.Gemini, options)).toMatchObject({
      provider: 'deepseek',
      runtime: 'deepseek-v4-pro-fallback',
      failoverActive: true,
    });
    expect(resolveScriptAiModel('deepseek-v4-pro-admin', options)).toBe(AiModel.Deepseek);
    expect(resolveScriptAiModel('deepseek-v4-flash-admin', options)).toBe(AiModel.DeepseekChat);
  });

  it('falls back per option when the response is incomplete', () => {
    const options = normalizeScriptModelOptions([{
      value: 'deepseek-chat',
      runtime_model_name: 'custom-chat',
    }]);

    expect(getScriptModelOption(AiModel.DeepseekChat, options).runtime).toBe('custom-chat');
    expect(getScriptModelOption(AiModel.Deepseek, options).runtime).toBe('deepseek-v4-pro');
    expect(getScriptModelOption(AiModel.Gemini, options).runtime).toBe('gemini-2.5-flash');
    expect(DEFAULT_SCRIPT_MODEL_OPTIONS).toHaveLength(3);
  });

  it('restores legacy aliases and new V4 runtime names to the correct selector', () => {
    expect(resolveScriptAiModel('deepseek-reasoner')).toBe(AiModel.Deepseek);
    expect(resolveScriptAiModel('deepseek-v4-pro')).toBe(AiModel.Deepseek);
    expect(resolveScriptAiModel('deepseek-chat')).toBe(AiModel.DeepseekChat);
    expect(resolveScriptAiModel('deepseek-v4-flash')).toBe(AiModel.DeepseekChat);
  });
});
