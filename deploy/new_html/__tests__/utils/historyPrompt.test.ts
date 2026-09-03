import { describe, expect, it } from 'vitest';
import { getHistoryPromptText } from '../../utils/historyPrompt';

describe('getHistoryPromptText', () => {
  it('labels promptless upscale results as image upscales', () => {
    expect(getHistoryPromptText({ fileRole: 'upscaled_image', metadata: {} }))
      .toBe('图片高清放大');
  });

  it('keeps the generic empty state for other promptless files', () => {
    expect(getHistoryPromptText({ fileRole: 'generated_image', metadata: {} }))
      .toBe('');
  });

  it('preserves a user prompt even for an upscale result', () => {
    expect(getHistoryPromptText({
      fileRole: 'upscaled_image',
      metadata: { prompt: '保留这段用户提示词' },
    })).toBe('保留这段用户提示词');
  });

  it('treats a whitespace-only prompt as missing', () => {
    expect(getHistoryPromptText({
      fileRole: 'upscaled_image',
      metadata: { prompt: '   ' },
    })).toBe('图片高清放大');
  });
});
