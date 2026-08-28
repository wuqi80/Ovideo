import { describe, expect, it } from 'vitest';

import {
  getStoryboardGenerationModelOption,
  STORYBOARD_GENERATION_MODEL_OPTIONS,
} from '../../utils/storyboardGenerationModels';

describe('storyboard generation model catalog', () => {
  it('keeps all stable operation identifiers while exposing model versions and capabilities', () => {
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
      'Gemini 3.1 Flash Image Preview · 快速生图模型',
      'Qwen Image Edit 2509 · 多参考图模型',
      'Qwen Image Edit 2509 + Lightning LoRA · 风格强化模型',
      'Kontext v2 · 高质量生图模型',
      'Qwen Image Edit 2509 · 连贯编辑模型',
      'Qwen Image Edit 2509 + Lightning LoRA · 风格增强模型',
      'GPT Image 2 VIP · 高清生图模型',
      'GPT Image 2 · 全能生图模型',
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
