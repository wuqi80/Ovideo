import { describe, expect, it } from 'vitest';
import {
  buildVideoModelOptions,
  getModelDisplayName,
  getMiniMaxVideoParamsError,
  inferSeedanceTaskType,
  isSeedanceVideoModel,
  normalizeMiniMaxVideoParams,
  seedanceSubModelForVideoModel,
  withCurrentVideoModelOption,
} from '../../services/videoModelService';

describe('processing cluster model label', () => {
  it('uses neutral processing-node names behind the stable Wan2 operation ID', () => {
    expect(getModelDisplayName('Wan2')).toBe('集群视频（处理节点1·LTX / 处理节点2·Wan）');
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

  it('preserves backend-provided runtime model names', () => {
    expect(normalizeMiniMaxVideoParams(undefined, 'MiniMax-Hailuo-2.3-Preview')).toMatchObject({
      model: 'MiniMax-Hailuo-2.3-Preview',
    });
    expect(normalizeMiniMaxVideoParams({
      model: 'MiniMax-Hailuo-2.3-Custom',
    })).toMatchObject({
      model: 'MiniMax-Hailuo-2.3-Custom',
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

describe('Seedance model mapping', () => {
  it('maps frontend model IDs to backend sub_model operations', () => {
    expect(isSeedanceVideoModel('Seedance15')).toBe(true);
    expect(isSeedanceVideoModel('Seedance2Mini')).toBe(true);
    expect(seedanceSubModelForVideoModel('Seedance15')).toBe('standard');
    expect(seedanceSubModelForVideoModel('Seedance2')).toBe('standard');
    expect(seedanceSubModelForVideoModel('Seedance2Fast')).toBe('fast');
    expect(seedanceSubModelForVideoModel('Seedance2Mini')).toBe('mini');
  });
});

describe('buildVideoModelOptions', () => {
  it('filters unavailable capability models and shows runtime model names', () => {
    const options = buildVideoModelOptions([
      {
        key: 'HappyHorse',
        label: '炼虚',
        provider: 'dashscope',
        model_name: 'happyhorse-1.0-r2v',
        available: true,
      },
      {
        key: 'MINI',
        label: '金丹',
        provider: 'minimax',
        model_options: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast'],
        available: true,
      },
      {
        key: 'Seedance2',
        label: '飞升',
        provider: 'seedance',
        model_name: 'doubao-seedance-2-0-260128',
        available: false,
      },
      {
        key: 'Seedance2Mini',
        label: '元婴',
        provider: 'seedance',
        model_name: 'doubao-seedance-2-0-mini-260615',
        available: true,
      },
    ]);

    expect(options.map(option => option.value)).toEqual(['HappyHorse', 'Seedance2Mini', 'MINI']);
    expect(options[0].label).toContain('happyhorse-1.0-r2v');
    expect(options[1].label).toContain('doubao-seedance-2-0-mini-260615');
    expect(options[2].label).toContain('MiniMax-Hailuo-2.3');
  });

  it('uses backend Plan-mode manifest to expose only Seedance 1.5', () => {
    const options = buildVideoModelOptions([
      {
        key: 'Seedance15',
        label: 'Seedance 1.5',
        provider: 'seedance',
        model_name: 'doubao-seedance-1.5-pro',
        available: true,
      },
    ]);

    expect(options.map(option => option.value)).toEqual(['Seedance15']);
    expect(options[0].label).toContain('doubao-seedance-1.5-pro');
  });

  it('keeps the current legacy model visible as unavailable', () => {
    const options = buildVideoModelOptions([
      {
        key: 'HappyHorse',
        label: '炼虚',
        provider: 'dashscope',
        model_name: 'happyhorse-1.0-r2v',
        available: true,
      },
    ]);

    const withCurrent = withCurrentVideoModelOption(options, 'Seedance2', [
      {
        key: 'Seedance2',
        label: '飞升',
        provider: 'seedance',
        model_name: 'doubao-seedance-2-0-260128',
        available: false,
      },
    ]);

    expect(withCurrent[0]).toMatchObject({
      value: 'Seedance2',
      available: false,
    });
    expect(withCurrent[0].label).toContain('当前不可用');
  });
});
