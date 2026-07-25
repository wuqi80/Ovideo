import { describe, expect, it } from 'vitest';
import {
  getModelDisplayName,
  getMiniMaxVideoParamsError,
  inferSeedanceTaskType,
  normalizeMiniMaxVideoParams,
} from '../../services/videoModelService';

describe('GPU runtime model label', () => {
  it('shows the actual node-specific engines behind the stable Wan2 operation ID', () => {
    expect(getModelDisplayName('Wan2')).toBe('GPU视频（GPU1·LTX / GPU2·Wan）');
  });
});

describe('inferSeedanceTaskType', () => {
  it('treats a single first frame as image-to-video', () => {
    expect(inferSeedanceTaskType([
      { kind: 'image', url: '/shot.png', role: 'first_frame' },
    ])).toBe('seedance_i2v');
  });

  it('treats paired first and last frames as morph', () => {
    expect(inferSeedanceTaskType([
      { kind: 'image', url: '/start.png', role: 'first_frame' },
      { kind: 'image', url: '/end.png', role: 'last_frame' },
    ])).toBe('seedance_morph');
  });
});

describe('normalizeMiniMaxVideoParams', () => {
  it('uses the current MiniMax defaults for an existing card without saved parameters', () => {
    expect(normalizeMiniMaxVideoParams()).toEqual({
      model: 'MiniMax-Hailuo-2.3',
      duration: 6,
      resolution: '768P',
      promptOptimizer: true,
    });
  });

  it('preserves supported Fast 10-second 768P settings', () => {
    expect(normalizeMiniMaxVideoParams({
      model: 'MiniMax-Hailuo-2.3-Fast',
      duration: 10,
      resolution: '768P',
      promptOptimizer: false,
    })).toEqual({
      model: 'MiniMax-Hailuo-2.3-Fast',
      duration: 10,
      resolution: '768P',
      promptOptimizer: false,
    });
  });

  it('preserves an invalid saved combination so the UI can explain it instead of silently changing it', () => {
    const params = normalizeMiniMaxVideoParams({ duration: 10, resolution: '1080P' });
    expect(params).toMatchObject({
      duration: 10,
      resolution: '1080P',
    });
    expect(getMiniMaxVideoParamsError(params)).toContain('1080P 仅支持 6 秒');
  });
});
