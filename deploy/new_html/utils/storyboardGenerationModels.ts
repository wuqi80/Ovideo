import type { StoryboardGenerationModel } from './storyboardConsistency';

export interface StoryboardGenerationModelOption {
  value: StoryboardGenerationModel;
  label: string;
  shortLabel: string;
  hint: string;
  requiresCluster: boolean;
}
// Public names describe product capabilities while keeping stable operation IDs internal.
export const STORYBOARD_GENERATION_MODEL_OPTIONS: readonly StoryboardGenerationModelOption[] = [
  {
    value: 'nanobanana',
    label: '一阶 · 快速生图模型',
    shortLabel: '一阶 · 快速',
    hint: '速度优先，适合快速预览和批量出图',
    requiresCluster: false,
  },
  {
    value: 'qwen',
    label: '二阶 · 多参考图模型',
    shortLabel: '二阶 · 多参考',
    hint: '多参考图一致性优先，适合人物与场景组合',
    requiresCluster: true,
  },
  {
    value: 'qwen_lora',
    label: '二阶 · 风格强化模型',
    shortLabel: '二阶 · 风格',
    hint: '风格表现优先，适合统一视觉风格',
    requiresCluster: true,
  },
  {
    value: 'kontext',
    label: '三阶 · 高质量生图模型',
    shortLabel: '三阶 · 高质量',
    hint: '质量优先，适合正式分镜画面',
    requiresCluster: true,
  },
  {
    value: 'qwenN',
    label: '三阶 · 连贯编辑模型',
    shortLabel: '三阶 · 连贯',
    hint: '上下文连贯优先，适合基于单图延续画面',
    requiresCluster: true,
  },
  {
    value: 'qwenN_lora',
    label: '三阶 · 风格增强模型',
    shortLabel: '三阶 · 风格增强',
    hint: '兼顾画面质量与风格一致性',
    requiresCluster: true,
  },
  {
    value: 'gpt_image_vip',
    label: '四阶 · 高清生图模型',
    shortLabel: '四阶 · 高清',
    hint: '高清输出优先，支持比例和分辨率设置',
    requiresCluster: false,
  },
  {
    value: 'gpt_image_official',
    label: '四阶 · 全能生图模型',
    shortLabel: '四阶 · 全能',
    hint: '综合能力优先，支持比例、分辨率和质量设置',
    requiresCluster: false,
  },
] as const;

export function getStoryboardGenerationModelOption(
  value: StoryboardGenerationModel,
): StoryboardGenerationModelOption {
  return STORYBOARD_GENERATION_MODEL_OPTIONS.find(option => option.value === value)
    || STORYBOARD_GENERATION_MODEL_OPTIONS[0];
}
