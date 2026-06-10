// new_html/__tests__/utils/gptImageSizeMap.test.ts
//
// 2026-05-21：GPT Image 2 系列尺寸推荐表测试。
// 这张表把 (ratio, K) → 像素串映射集中到一处，是前端唯一的"分辨率契约"，
// 一旦表错，UI 选项 / service 透传 / 后端校验三方都跟着错，必须有测试守住。

import { describe, it, expect } from 'vitest';
import {
  recommendGptImageSize,
  GPT_IMAGE_RATIO_OPTIONS,
  GPT_IMAGE_K_OPTIONS,
  GPT_IMAGE_QUALITY_OPTIONS,
  GEMINI_NANO2_RATIO_OPTIONS,
  GEMINI_NANO2_SIZE_OPTIONS,
} from '../../utils/gptImageSizeMap';

describe('recommendGptImageSize', () => {
  it('1:1 + 1K → 1024x1024（标准方形）', () => {
    expect(recommendGptImageSize('1:1', '1K')).toBe('1024x1024');
  });

  it('16:9 + 2K → 2688x1536（横屏高清）', () => {
    expect(recommendGptImageSize('16:9', '2K')).toBe('2688x1536');
  });

  it('9:16 + 4K → 3072x5376（竖屏超清）', () => {
    expect(recommendGptImageSize('9:16', '4K')).toBe('3072x5376');
  });

  it('21:9 + 1K → 1536x640（超宽屏）', () => {
    expect(recommendGptImageSize('21:9', '1K')).toBe('1536x640');
  });

  it('ratio=auto → 始终返回 "auto"', () => {
    expect(recommendGptImageSize('auto', '1K')).toBe('auto');
    expect(recommendGptImageSize('auto', '4K')).toBe('auto');
    expect(recommendGptImageSize('auto', 'auto')).toBe('auto');
  });

  it('K=auto → 始终返回 "auto"', () => {
    expect(recommendGptImageSize('1:1', 'auto')).toBe('auto');
    expect(recommendGptImageSize('16:9', 'auto')).toBe('auto');
  });

  it('每个非 auto ratio 都覆盖 1K/2K/4K 三档', () => {
    const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '5:4', '4:5'] as const;
    const ks = ['1K', '2K', '4K'] as const;
    for (const r of ratios) {
      for (const k of ks) {
        const size = recommendGptImageSize(r, k);
        expect(size).toMatch(/^\d{3,4}x\d{3,4}$/);
        expect(size).not.toBe('auto');
      }
    }
  });

  it('2K 像素积大约是 1K 的 4 倍（1 megapixel → 4 megapixel）', () => {
    const ratios = ['1:1', '16:9', '9:16'] as const;
    for (const r of ratios) {
      const [w1k, h1k] = recommendGptImageSize(r, '1K').split('x').map(Number);
      const [w2k, h2k] = recommendGptImageSize(r, '2K').split('x').map(Number);
      const ratio = (w2k * h2k) / (w1k * h1k);
      // 4× ± 一定容差（取整造成）
      expect(ratio).toBeGreaterThan(3.5);
      expect(ratio).toBeLessThan(4.5);
    }
  });
});

describe('option arrays', () => {
  it('GPT_IMAGE_RATIO_OPTIONS 第一项是 auto', () => {
    expect(GPT_IMAGE_RATIO_OPTIONS[0].value).toBe('auto');
  });

  it('GPT_IMAGE_K_OPTIONS 第一项是 auto', () => {
    expect(GPT_IMAGE_K_OPTIONS[0].value).toBe('auto');
  });

  it('GPT_IMAGE_QUALITY_OPTIONS 第一项是 auto（默认值约定）', () => {
    expect(GPT_IMAGE_QUALITY_OPTIONS[0].value).toBe('auto');
  });

  it('化神(Nano2) 选项不含 auto — 化神 API 不接受 auto', () => {
    expect(GEMINI_NANO2_RATIO_OPTIONS.find(o => o.value === 'auto')).toBeUndefined();
    expect(GEMINI_NANO2_SIZE_OPTIONS.find(o => o.value === 'auto' as never)).toBeUndefined();
  });

  it('化神尺寸选项严格三档', () => {
    expect(GEMINI_NANO2_SIZE_OPTIONS.map(o => o.value)).toEqual(['1K', '2K', '4K']);
  });
});
