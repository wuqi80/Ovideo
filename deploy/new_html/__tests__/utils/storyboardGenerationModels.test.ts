import { describe, expect, it } from 'vitest';

import {
  getStoryboardGenerationModelOption,
  STORYBOARD_GENERATION_MODEL_OPTIONS,
} from '../../utils/storyboardGenerationModels';

describe('storyboard generation model catalog', () => {
  it('keeps all stable operation identifiers while exposing capability names', () => {
    expect(STORYBOARD_GENERATION_MODEL_OPTIONS.map(option => option.value)).toEqual([
      'nanobanana',
      'qwen',
      'qwen_lora',
      'kontext',
      'qwenN',
      'qwenN_lora',
      'gpt_image_vip',
      'gpt_image_official',
    ]);
    expect(STORYBOARD_GENERATION_MODEL_OPTIONS.map(option => option.label)).toEqual([
      '一阶 · 快速生图模型',
      '二阶 · 多参考图模型',
      '二阶 · 风格强化模型',
      '三阶 · 高质量生图模型',
      '三阶 · 连贯编辑模型',
      '三阶 · 风格增强模型',
      '四阶 · 高清生图模型',
      '四阶 · 全能生图模型',
    ]);
  });

  it('derives processing-cluster models from capability metadata', () => {
    expect(
      STORYBOARD_GENERATION_MODEL_OPTIONS
        .filter(option => option.requiresCluster)
        .map(option => option.value),
    ).toEqual(['qwen', 'qwen_lora', 'kontext', 'qwenN', 'qwenN_lora']);
    expect(getStoryboardGenerationModelOption('qwenN').hint).toContain('上下文连贯');
    expect(getStoryboardGenerationModelOption('gpt_image_official').hint).toContain('质量设置');
  });
});
