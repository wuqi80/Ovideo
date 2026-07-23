import { describe, expect, it, vi } from 'vitest';
import {
  DESIGN_CREDIT_DEFAULTS,
  DESIGN_CREDIT_FEATURES,
  designImageCreditParams,
  designOperationCreditParams,
  newDesignCreditUsageId,
} from '../../utils/designCredits';

describe('designCredits', () => {
  it('defines independently configurable design feature keys and defaults', () => {
    expect(DESIGN_CREDIT_FEATURES).toEqual({
      imageGeneration: 'design_image_generation',
      angleAdjustment: 'design_angle_adjustment',
      upscaleHd: 'design_upscale_hd',
    });
    expect(DESIGN_CREDIT_DEFAULTS).toEqual({
      imageGenerationPerImage: 10,
      angleAdjustment: 5,
      upscaleHd: 5,
    });
  });

  it('normalizes image counts while retaining model parameters', () => {
    expect(designImageCreditParams({
      imageCount: 2.9,
      model: 'gemini-2.5-flash-image',
      resolution: '2K',
      aspectRatio: '16:9',
    })).toEqual({
      image_count: 2,
      model: 'gemini-2.5-flash-image',
      resolution: '2K',
      aspect_ratio: '16:9',
    });
  });

  it('builds operation params and unique usage ids', () => {
    expect(designOperationCreditParams('angle_adjustment')).toEqual({
      operation_count: 1,
      workflow: 'angle_adjustment',
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'usage-1' });
    expect(newDesignCreditUsageId('design-image')).toBe('design-image:usage-1');
    vi.unstubAllGlobals();
  });
});
