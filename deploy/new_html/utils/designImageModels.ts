export type DesignImageEngine = 'nanobanana' | 'doubao';
export type DesignImageResolution = '1K' | '2K' | '4K';

export interface DesignImageModelOption {
  id: string;
  label: string;
  runtime: string;
  engine: DesignImageEngine;
  geminiModel: string;
  resolutions: readonly DesignImageResolution[];
  maxReferences: number;
  supportsImageToImageBatch: boolean;
}

export const DESIGN_IMAGE_MODEL_OPTIONS: readonly DesignImageModelOption[] = [
  {
    id: 'doubao-seedream-4-0-250828',
    label: '筑基',
    runtime: 'Doubao SeedDream 4.0',
    engine: 'doubao',
    geminiModel: 'gemini-2.5-flash-image',
    resolutions: ['1K', '2K', '4K'],
    maxReferences: 14,
    supportsImageToImageBatch: true,
  },
  {
    id: 'gemini-2.5-flash-image',
    label: '化神1阶',
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
    runtime: 'Gemini 3 Pro Image',
    engine: 'nanobanana',
    geminiModel: 'gemini-3-pro-image-preview',
    resolutions: ['1K', '2K', '4K'],
    maxReferences: 6,
    supportsImageToImageBatch: false,
  },
] as const;

export function findDesignImageModel(
  engine: DesignImageEngine,
  geminiModel: string,
): DesignImageModelOption {
  if (engine === 'doubao') return DESIGN_IMAGE_MODEL_OPTIONS[0];
  return DESIGN_IMAGE_MODEL_OPTIONS.find(option => (
    option.engine === engine && option.geminiModel === geminiModel
  )) || DESIGN_IMAGE_MODEL_OPTIONS[1];
}

export function normalizeDesignImageResolution(
  model: DesignImageModelOption,
  resolution: string,
): DesignImageResolution {
  return model.resolutions.includes(resolution as DesignImageResolution)
    ? resolution as DesignImageResolution
    : model.resolutions[0];
}
