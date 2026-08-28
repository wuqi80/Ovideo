import { describe, expect, it } from 'vitest';

import {
  IMAGE_QUALITY_SUFFIX,
  applyImageStylePreset,
  detectImageStylePreset,
  stripImageStylePresets,
} from '../../prompts/imagePrompts';

describe('image style presets', () => {
  it('replaces a legacy anime suffix with strong photorealistic constraints', () => {
    const result = applyImageStylePreset(
      `school boy${IMAGE_QUALITY_SUFFIX.anime}`,
      'realistic',
    );

    expect(result).toContain('photorealistic live-action photography');
    expect(result).toContain('cinematic lighting');
    expect(result).toContain('depth of field');
    expect(result).toContain('ray tracing');
    expect(result).toContain('exclude anime, manga, cartoon');
    expect(result).toContain('never inherit an illustrated rendering style');
    expect(result).not.toContain('anime style, vibrant colors');
    expect(result).not.toContain('cel shading, photorealistic');
  });

  it('is idempotent when the same style is applied repeatedly', () => {
    const once = applyImageStylePreset('school boy', 'realistic');
    expect(applyImageStylePreset(once, 'realistic')).toBe(once);
  });

  it('removes common Chinese and English cartoon-style conflicts in realistic mode', () => {
    const result = applyImageStylePreset(
      '校服男孩，动漫风格, anime style, cel shading',
      'realistic',
    );

    expect(result).not.toContain('动漫风格');
    expect(result).not.toContain('anime style');
    expect(result).not.toMatch(/cel shading, photorealistic/i);
    expect(result).toContain('photorealistic live-action photography');
  });

  it('keeps the original animation wording when animation is selected', () => {
    const original = '少年角色，手绘逐帧动画质感，柔和赛璐片色彩';
    const result = applyImageStylePreset(original, 'anime');

    expect(result).toContain(original);
    expect(result).toContain(IMAGE_QUALITY_SUFFIX.anime);
    expect(result).not.toContain('photorealistic live-action photography');
    expect(result).not.toContain('strictly non-illustrated');
  });

  it('removes legacy forced anime service text without changing the subject', () => {
    const result = stripImageStylePresets(
      'school boy\n\nStyle: High quality Anime/Manga screenshot, detailed background, cinematic lighting.',
    );

    expect(result).toBe('school boy');
  });

  it('recovers the selected style from an old saved prompt before stripping it', () => {
    const oldPrompt = 'school boy, photorealistic, cinematic lighting, depth of field, ray tracing';

    expect(detectImageStylePreset(oldPrompt)).toBe('realistic');
    expect(stripImageStylePresets(oldPrompt)).toBe('school boy');
  });
});
