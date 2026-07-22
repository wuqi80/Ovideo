import { describe, expect, it } from 'vitest';
import { recommendDoubaoImageSize } from '../../utils/doubaoImageSize';

describe('recommendDoubaoImageSize', () => {
  it('converts 16:9 K presets to explicit pixel sizes', () => {
    expect(recommendDoubaoImageSize('16:9', '1K')).toBe('1024x576');
    expect(recommendDoubaoImageSize('16:9', '2K')).toBe('2048x1152');
    expect(recommendDoubaoImageSize('16:9', '4K')).toBe('4096x2304');
  });

  it('supports portrait and square ratios', () => {
    expect(recommendDoubaoImageSize('9:16', '2K')).toBe('1152x2048');
    expect(recommendDoubaoImageSize('3:4', '1K')).toBe('768x1024');
    expect(recommendDoubaoImageSize('1:1', '4K')).toBe('4096x4096');
  });

  it('keeps the K preset when a future ratio is unknown', () => {
    expect(recommendDoubaoImageSize('auto', '2K')).toBe('2K');
  });
});
