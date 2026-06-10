/**
 * 模型名称映射 - 使用修真境界命名
 */

export const aiModelNames = {
  'deepseek': 'DK筑基',
  'gemini': 'GI化神'
};

export const imageModelNames = {
  'gemini-2.5-flash-image': '化神1阶',
  'gemini-3.1-flash-image-preview': '化神2阶',
  'gemini-3.0-pro-image': '化神2阶',
  'nanobanana': '化神进阶',
  'doubao': '筑基境界'
};

// 分镜页(GenerationPage)模型选择按钮显示名。
// 后端 ID 用前端键即可（'gpt_image_vip'/'gpt_image_official'/'nanobanana' 等），
// 前端按钮上只显示"修真境界"别名隐藏真实模型名。
// 2026-05-21：新增 gpt_image_vip / gpt_image_official；nano3→nano2 不改 key 'nanobanana'。
export const generationModelNames = {
  'qwen': '练气一阶',
  'qwenN': '练气一阶',
  'qwen_lora': '筑基',
  'qwenN_lora': '筑基',
  'kontext': '练气二阶',
  'nanobanana': '化神',
  'gpt_image_vip': '天劫一阶',
  'gpt_image_official': '天劫二阶'
};

export const videoModelNames = {
  'wan2': '练气',
  'sora2': '金丹',
  'veo': '化神',
  'mini': '筑基',
  // 2026-05-24 DashScope 共享 API 三家
  'kling': '合体',
  'vidu': '大乘',
  'happyhorse': '炼虚'
};

// 通用获取显示名称的函数
export const getModelDisplayName = (
  modelKey: string,
  category: 'ai' | 'image' | 'generation' | 'video'
): string => {
  switch (category) {
    case 'ai':
      return aiModelNames[modelKey as keyof typeof aiModelNames] || modelKey;
    case 'image':
      return imageModelNames[modelKey as keyof typeof imageModelNames] || modelKey;
    case 'generation':
      return generationModelNames[modelKey as keyof typeof generationModelNames] || modelKey;
    case 'video':
      return videoModelNames[modelKey as keyof typeof videoModelNames] || modelKey;
    default:
      return modelKey;
  }
};

