/**
 * 图像生成相关提示词配置
 * 
 * 注意：图像生成主要依赖于分镜中的 imagePrompt 字段
 * 这里提供一些辅助提示词模板
 */

/**
 * 图像优化提示词（用于增强生成质量）
 */
export const IMAGE_QUALITY_SUFFIX = {
  // 高质量通用后缀
  highQuality: ', masterpiece, best quality, highly detailed, 8k, professional',
  
  // 动画风格
  anime: ', anime style, vibrant colors, clean lines, cel shading',
  
  // 写实风格
  realistic: ', photorealistic live-action photography, cinematic lighting, depth of field, ray tracing, realistic skin texture, natural facial anatomy and body proportions, real-world materials, strictly non-illustrated, exclude anime, manga, cartoon, cel shading, CGI, 3D render, game art, and doll-like appearance; if reference images are provided, use them only for identity, clothing, and structure, never inherit an illustrated rendering style',
  
  // 水彩风格
  watercolor: ', watercolor painting, soft edges, pastel colors, artistic',
  
  // 3D渲染
  render3d: ', 3d render, octane render, unreal engine, volumetric lighting',
} as const;

export type ImageStylePresetId = keyof typeof IMAGE_QUALITY_SUFFIX;

const LEGACY_IMAGE_STYLE_MARKERS: Array<{ id: ImageStylePresetId; fragment: string }> = [
  ...Object.entries(IMAGE_QUALITY_SUFFIX).map(([id, fragment]) => ({
    id: id as ImageStylePresetId,
    fragment,
  })),
  // 兼容已经保存到项目或 localStorage 的旧写实后缀。
  { id: 'realistic', fragment: ', photorealistic, cinematic lighting, depth of field, ray tracing' },
  // 兼容旧版公共 Gemini 封装追加的固定动漫风格。
  { id: 'anime', fragment: 'Style: Anime/Manga style, high detail, character sheet or environment concept art.' },
  { id: 'anime', fragment: 'Style: High quality Anime/Manga screenshot, detailed background, cinematic lighting.' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanStylePrompt(value: string): string {
  return value
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/,\s*,+/g, ', ')
    .replace(/(?:,|，)\s*$/g, '')
    .trim();
}

function stripRealisticStyleConflicts(prompt: string): string {
  return cleanStylePrompt(prompt
    .replace(/\b(?:anime|manga|cartoon)\s+(?:art\s+)?style\b/gi, '')
    .replace(/\bcel[-\s]?shad(?:ed|ing)\b/gi, '')
    .replace(/(?:二次元|动漫|漫画|卡通)(?:画面|绘画|插画)?风格/g, ''));
}

/**
 * 清除由产品风格按钮或旧版公共封装写入的风格片段。
 *
 * 只移除系统已知的完整片段，不删除用户自己写在主体描述中的风格要求。
 */
export function stripImageStylePresets(prompt: string): string {
  let result = String(prompt || '');
  for (const { fragment } of LEGACY_IMAGE_STYLE_MARKERS) {
    result = result.replace(new RegExp(escapeRegExp(fragment), 'gi'), '');
  }
  return cleanStylePrompt(result);
}

/** 识别旧项目已经写入提示词的最后一个系统风格，便于无损迁移到独立选中状态。 */
export function detectImageStylePreset(prompt: string): ImageStylePresetId | '' {
  const source = String(prompt || '').toLocaleLowerCase();
  let detected: ImageStylePresetId | '' = '';
  let detectedAt = -1;
  for (const { id, fragment } of LEGACY_IMAGE_STYLE_MARKERS) {
    const index = source.lastIndexOf(fragment.toLocaleLowerCase());
    if (index > detectedAt) {
      detected = id;
      detectedAt = index;
    }
  }
  return detected;
}

/**
 * 在真正提交生图请求时应用唯一风格，避免历史动漫后缀和当前写实选择并存。
 */
export function applyImageStylePreset(prompt: string, styleId?: string | null): string {
  const stripped = stripImageStylePresets(prompt);
  const base = styleId === 'realistic' ? stripRealisticStyleConflicts(stripped) : stripped;
  const suffix = styleId && styleId in IMAGE_QUALITY_SUFFIX
    ? IMAGE_QUALITY_SUFFIX[styleId as ImageStylePresetId]
    : '';
  return `${base}${suffix}`.trim();
}

/**
 * 负面提示词（需要避免的元素）
 */
export const NEGATIVE_PROMPTS = {
  // 通用负面提示
  common: 'low quality, blurry, distorted, ugly, bad anatomy, bad proportions',
  
  // 动画负面提示
  anime: 'low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
  
  // 人物负面提示
  character: 'bad anatomy, bad hands, missing fingers, extra fingers, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed',
};

/**
 * 场景类型提示词模板
 */
export const SCENE_TEMPLATES: Record<string, string> = {
  // 室内场景
  indoor: '{description}, indoor scene, interior lighting, comfortable atmosphere',
  
  // 室外场景
  outdoor: '{description}, outdoor scene, natural lighting, open space',
  
  // 城市场景
  city: '{description}, urban environment, city street, modern architecture',
  
  // 自然场景
  nature: '{description}, natural landscape, serene environment, beautiful scenery',
  
  // 战斗场景
  battle: '{description}, dynamic action, intense atmosphere, dramatic lighting',
  
  // 情感场景
  emotional: '{description}, emotional moment, intimate atmosphere, soft lighting',
};

/**
 * 镜头类型提示词
 */
export const CAMERA_SHOTS: Record<string, string> = {
  // 特写
  closeup: 'extreme close-up shot, detailed view, shallow depth of field',
  
  // 中景
  medium: 'medium shot, waist-up view, balanced composition',
  
  // 全景
  full: 'full shot, entire subject visible, environmental context',
  
  // 远景
  wide: 'wide shot, establishing shot, panoramic view',
  
  // 仰拍
  lowAngle: 'low angle shot, looking up, powerful perspective',
  
  // 俯拍
  highAngle: 'high angle shot, looking down, bird\'s eye view',
  
  // 第一人称视角
  pov: 'POV shot, first person perspective, subjective view',
};

/**
 * 光照类型提示词
 */
export const LIGHTING_TYPES: Record<string, string> = {
  // 自然光
  natural: 'natural lighting, soft shadows, realistic illumination',
  
  // 戏剧性光照
  dramatic: 'dramatic lighting, strong contrast, chiaroscuro',
  
  // 柔和光照
  soft: 'soft lighting, diffused light, gentle shadows',
  
  // 霓虹灯
  neon: 'neon lighting, vibrant colors, cyberpunk aesthetic',
  
  // 金色时刻
  golden: 'golden hour lighting, warm tones, magical atmosphere',
  
  // 夜晚
  night: 'night scene, moonlight, dark atmosphere, artificial lights',
};

/**
 * 情绪/氛围提示词
 */
export const MOOD_ATMOSPHERE: Record<string, string> = {
  // 快乐
  happy: 'joyful atmosphere, bright colors, cheerful mood',
  
  // 悲伤
  sad: 'melancholic atmosphere, muted colors, somber mood',
  
  // 紧张
  tense: 'tense atmosphere, dark colors, suspenseful mood',
  
  // 浪漫
  romantic: 'romantic atmosphere, soft colors, dreamy mood',
  
  // 史诗
  epic: 'epic atmosphere, grand scale, heroic mood',
  
  // 神秘
  mysterious: 'mysterious atmosphere, fog, enigmatic mood',
};

