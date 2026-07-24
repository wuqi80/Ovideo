import { describe, expect, it } from 'vitest';
import {
  canUseDesignImageReferences,
  DESIGN_IMAGE_BATCH_LIMIT,
  DESIGN_IMAGE_MODEL_OPTIONS,
  findDesignImageModel,
  maxDesignImageOutputCount,
  normalizeDesignImageResolution,
} from '../../utils/designImageModels';

describe('design image model capabilities', () => {
  it('maps the three product levels to their runtime models', () => {
    expect(DESIGN_IMAGE_MODEL_OPTIONS.map(option => `${option.label} · ${option.runtime}`)).toEqual([
      '化神1阶 · Gemini 2.5 Flash Image',
      '化神2阶 · Gemini 3 Pro Image',
      '筑基 · Doubao-Seedream-5.0-lite',
    ]);
    expect(DESIGN_IMAGE_MODEL_OPTIONS.map(option => option.usageLabel)).toEqual([
      '快速生成',
      '高质量生成',
      '参考图生成',
    ]);
    expect(DESIGN_IMAGE_MODEL_OPTIONS[2].id).toBe('doubao-seedream-5-0-lite-260128');
  });

  it('only offers resolutions supported by each model', () => {
    const fastGemini = findDesignImageModel('nanobanana', 'gemini-2.5-flash-image');
    const qualityGemini = findDesignImageModel('nanobanana', 'gemini-3-pro-image-preview');
    const doubao = findDesignImageModel('doubao', '');

    expect(fastGemini.resolutions).toEqual(['1K']);
    expect(qualityGemini.resolutions).toEqual(['1K', '2K', '4K']);
    expect(doubao.resolutions).toEqual(['1K', '2K', '4K']);
    expect(doubao.supportsImageToImageBatch).toBe(true);
    expect(fastGemini.supportsImageToImageBatch).toBe(false);
  });

  it('only enables references after image-to-image is selected on a capable model', () => {
    const doubao = findDesignImageModel('doubao', '');
    const gemini = findDesignImageModel('nanobanana', 'gemini-2.5-flash-image');

    expect(canUseDesignImageReferences(doubao, false)).toBe(false);
    expect(canUseDesignImageReferences(doubao, true)).toBe(true);
    expect(canUseDesignImageReferences(gemini, true)).toBe(false);
  });

  it('keeps reference and generated image counts within the provider batch limit', () => {
    expect(DESIGN_IMAGE_BATCH_LIMIT).toBe(15);
    expect(maxDesignImageOutputCount(0)).toBe(15);
    expect(maxDesignImageOutputCount(6)).toBe(9);
    expect(maxDesignImageOutputCount(14)).toBe(1);
  });

  it('falls back to the model default when a persisted resolution is unsupported', () => {
    const fastGemini = findDesignImageModel('nanobanana', 'gemini-2.5-flash-image');
    expect(normalizeDesignImageResolution(fastGemini, '4K')).toBe('1K');
  });
});
