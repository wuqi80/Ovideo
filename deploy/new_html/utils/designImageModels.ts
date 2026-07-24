export type DesignImageEngine = 'nanobanana' | 'doubao';
export type DesignImageResolution = '1K' | '2K' | '4K';

export interface DesignImageModelOption {
  id: string;
  label: string;
  usageLabel: string;
  runtime: string;
  engine: DesignImageEngine;
  geminiModel: string;
  resolutions: readonly DesignImageResolution[];
  maxReferences: number;
  supportsImageToImageBatch: boolean;
}

export const DESIGN_IMAGE_BATCH_LIMIT = 15;

export const DESIGN_IMAGE_MODEL_OPTIONS: readonly DesignImageModelOption[] = [
  {
    id: 'gemini-2.5-flash-image',
    label: '化神1阶',
    usageLabel: '快速生成',
    runtime: 'Gemini 2.5 Flash Image',
    engine: 'nanobanana',
    geminiModel: 'gemini-2.5-flash-image',
    resolutions: ['1K'],
    maxReferences: 6,
    supportsImageToImageBatch: false,
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: '化神2阶',
    usageLabel: '高质量生成',
    runtime: 'Gemini 3 Pro Image',
    engine: 'nanobanana',
    geminiModel: 'gemini-3-pro-image-preview',
    resolutions: ['1K', '2K', '4K'],
    maxReferences: 6,
    supportsImageToImageBatch: false,
  },
  {
    id: 'doubao-seedream-5-0-lite-260128',
    label: '筑基',
    usageLabel: '参考图生成',
    runtime: 'Doubao-Seedream-5.0-lite',
    engine: 'doubao',
    geminiModel: 'gemini-2.5-flash-image',
    resolutions: ['1K', '2K', '4K'],
    maxReferences: 14,
    supportsImageToImageBatch: true,
  },
] as const;

export function findDesignImageModel(
  engine: DesignImageEngine,
  geminiModel: string,
): DesignImageModelOption {
  return DESIGN_IMAGE_MODEL_OPTIONS.find(option => (
    option.engine === engine && option.geminiModel === geminiModel
  )) || DESIGN_IMAGE_MODEL_OPTIONS.find(option => option.engine === engine)
    || DESIGN_IMAGE_MODEL_OPTIONS[0];
}

export function normalizeDesignImageResolution(
  model: DesignImageModelOption,
  resolution: string,
): DesignImageResolution {
  return model.resolutions.includes(resolution as DesignImageResolution)
    ? resolution as DesignImageResolution
    : model.resolutions[0];
}

export function canUseDesignImageReferences(
  model: DesignImageModelOption,
  imageToImageEnabled: boolean,
): boolean {
  return model.supportsImageToImageBatch && imageToImageEnabled;
}

export function maxDesignImageOutputCount(referenceCount: number): number {
  return Math.max(1, DESIGN_IMAGE_BATCH_LIMIT - Math.max(0, referenceCount));
}
