import { describe, expect, it } from 'vitest';
import {
  DESIGN_IMAGE_MODEL_OPTIONS,
  findDesignImageModel,
  normalizeDesignImageResolution,
} from '../../utils/designImageModels';

describe('design image model capabilities', () => {
  it('maps the three product levels to their runtime models', () => {
    expect(DESIGN_IMAGE_MODEL_OPTIONS.map(option => `${option.label} · ${option.runtime}`)).toEqual([
      '筑基 · Doubao SeedDream 4.0',
      '化神1阶 · Gemini 2.5 Flash Image',
      '化神2阶 · Gemini 3 Pro Image',
    ]);
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

  it('falls back to the model default when a persisted resolution is unsupported', () => {
    const fastGemini = findDesignImageModel('nanobanana', 'gemini-2.5-flash-image');
    expect(normalizeDesignImageResolution(fastGemini, '4K')).toBe('1K');
  });
});
