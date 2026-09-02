import { describe, expect, it } from 'vitest';
import {
  buildVideoModelOptions,
  SELECTABLE_MODELS,
  getModelDisplayName,
  getVideoCreditFallbackCost,
  getVideoCreditEstimateParams,
  getMiniMaxVideoParamsError,
  inferSeedanceTaskType,
  isSeedanceAgentPlanModel,
  isSeedanceVideoModel,
  normalizeMiniMaxVideoParams,
  normalizeSeedanceMediaForSubmission,
  seedanceSubModelForVideoModel,
  supportsSeedanceMultimodalModel,
  validateSeedanceMediaInputs,
  withCurrentVideoModelOption,
} from '../../services/videoModelService';

describe('public video model labels', () => {
  it('exposes runtime model versions with their capability suffixes', () => {
    expect(getModelDisplayName('MiniMaxH3')).toBe('MiniMax H3 · 本地节点模型');
    expect(getModelDisplayName('MiniMaxH3Fast')).toBe('MiniMax H3 Fast · 本地节点模型');
    expect(getModelDisplayName('MiniMaxH3Mini')).toBe('MiniMax H3 Mini · 本地节点模型');
    expect(getModelDisplayName('Seedance2')).toBe('Seedance 2.0 · 多模态标准视频模型');
    expect(getModelDisplayName('Seedance2Fast')).toBe('Seedance 2.0 Fast · 多模态快速视频模型');
    expect(getModelDisplayName('Seedance2Mini')).toBe('Seedance 2.0 Mini · 多模态简化视频模型');
    expect(getModelDisplayName('Wan2')).toBe('Wan 2.2 · 本地节点模型');
    expect(getModelDisplayName('一阶')).toBe('Smooth · 本地节点模型');
  });
});

describe('video credit estimate params', () => {
  it('keeps standard and fast equal, halves mini, and adds five for 720p upscale', () => {
    expect(getVideoCreditFallbackCost('MiniMaxH3')).toBe(10);
    expect(getVideoCreditFallbackCost('MiniMaxH3Fast')).toBe(10);
    expect(getVideoCreditFallbackCost('MiniMaxH3Mini')).toBe(5);
    expect(getVideoCreditFallbackCost('Seedance15')).toBe(32);
    expect(getVideoCreditFallbackCost('MiniMaxH3', { h3_upscale_720p: true })).toBe(15);
    expect(getVideoCreditFallbackCost('MiniMaxH3Fast', { h3_upscale_720p: true })).toBe(15);
    expect(getVideoCreditFallbackCost('MiniMaxH3Mini', { h3_upscale_720p: true })).toBe(10);
  });

  it('uses the real default generation spec for each priced provider', () => {
    expect(getVideoCreditEstimateParams('HappyHorse')).toMatchObject({
      duration_seconds: 5,
      hh_resolution: '1080P',
    });
    expect(getVideoCreditEstimateParams('MINI')).toMatchObject({
      duration_seconds: 6,
      minimax_model: 'MiniMax-Hailuo-2.3',
      minimax_resolution: '768P',
    });
    expect(getVideoCreditEstimateParams('Seedance2Fast')).toMatchObject({
      duration_seconds: 5,
      sub_model: 'fast',
      resolution: '720P',
    });
    expect(getVideoCreditEstimateParams('MiniMaxH3')).toEqual({
      model: 'MiniMaxH3',
      duration_seconds: 5,
    });
    expect(getVideoCreditEstimateParams('MiniMaxH3', {
      h3_upscale_720p: true,
    })).toEqual({
      model: 'MiniMaxH3',
      duration_seconds: 5,
      h3_upscale_720p: true,
    });
  });

  it('lets a video card override defaults with its current generation settings', () => {
    expect(getVideoCreditEstimateParams('HappyHorse', {
      duration_seconds: 10,
      hh_resolution: '720P',
    })).toMatchObject({
      model: 'HappyHorse',
      duration_seconds: 10,
      hh_resolution: '720P',
    });
    expect(getVideoCreditEstimateParams('Vidu', {
      task_type: 'vidu_morph',
      sub_model: 'q3-turbo',
      vidu_resolution: '1080P',
    })).toMatchObject({
      model: 'Vidu',
      task_type: 'vidu_morph',
      sub_model: 'q3-turbo',
      vidu_resolution: '1080P',
    });
    expect(getVideoCreditEstimateParams('MINI', {
      duration_seconds: 10,
      minimax_model: 'MiniMax-Hailuo-2.3-Fast',
      minimax_resolution: '768P',
    })).toMatchObject({
      model: 'MINI',
      duration_seconds: 10,
      minimax_model: 'MiniMax-Hailuo-2.3-Fast',
      minimax_resolution: '768P',
    });
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
    expect(seedanceSubModelForVideoModel('Seedance15')).toBe('agent_plan');
    expect(seedanceSubModelForVideoModel('Seedance2')).toBe('standard');
    expect(seedanceSubModelForVideoModel('Seedance2Fast')).toBe('fast');
    expect(seedanceSubModelForVideoModel('Seedance2Mini')).toBe('mini');
    expect(isSeedanceAgentPlanModel('Seedance15')).toBe(true);
    expect(isSeedanceAgentPlanModel('Seedance2Mini')).toBe(false);
    expect(supportsSeedanceMultimodalModel('Seedance2Mini')).toBe(true);
    expect(supportsSeedanceMultimodalModel('Seedance15')).toBe(false);
  });

  it('only normalizes reference images for agent-plan compatibility', () => {
    const media = [
      { kind: 'image' as const, url: '/start.png', role: 'reference_image' as const },
      { kind: 'image' as const, url: '/end.png', role: 'reference_image' as const },
    ];

    expect(normalizeSeedanceMediaForSubmission(media, false)).toEqual(media);
    expect(normalizeSeedanceMediaForSubmission(media, true).map(item => item.role)).toEqual([
      'first_frame',
      'last_frame',
    ]);
  });

  it('allows multimodal media for Seedance 2.0 models but blocks it for agent-plan compatibility', () => {
    const media = [
      { kind: 'image' as const, url: '/ref.png', role: 'reference_image' as const },
      { kind: 'video' as const, url: '/ref.mp4', role: 'reference_video' as const },
      { kind: 'audio' as const, url: '/ref.mp3', role: 'reference_audio' as const },
    ];

    expect(validateSeedanceMediaInputs(media, true)).toBeNull();
    expect(validateSeedanceMediaInputs(media, false)).toContain('1.5-pro 不支持视频/音频');
  });
});

describe('buildVideoModelOptions', () => {
  it('keeps only H3 nodes and supported provider-backed models selectable', () => {
    expect(SELECTABLE_MODELS).toEqual([
      'MiniMaxH3',
      'MiniMaxH3Fast',
      'MiniMaxH3Mini',
      'Seedance15',
      'Seedance2',
      'Seedance2Fast',
      'Seedance2Mini',
      'MINI',
      'Veo',
      'Sora2',
      '大能',
      'Kling',
      'Vidu',
      'HappyHorse',
    ]);
    expect(SELECTABLE_MODELS).not.toContain('Wan2');
    expect(SELECTABLE_MODELS).not.toContain('LTXNode1');
    expect(SELECTABLE_MODELS).not.toContain('WanNode2');
    expect(SELECTABLE_MODELS).not.toContain('一阶');
  });

  it('keeps only available models and exposes one concise preferred runtime label', () => {
    const options = buildVideoModelOptions([
      {
        key: 'LTXNode1',
        label: '处理节点1 · LTX',
        provider: 'processing_cluster',
        model_name: 'LTX',
        available: false,
      },
      {
        key: 'WanNode2',
        label: '处理节点2 · Wan',
        provider: 'processing_cluster',
        model_name: 'Wan',
        available: true,
      },
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
      {
        key: 'MiniMaxH3',
        label: '本地 MiniMax H3',
        provider: 'processing_cluster',
        model_name: 'MiniMax H3',
        available: true,
      },
      {
        key: 'MiniMaxH3Fast',
        label: 'MiniMax H3 Fast',
        provider: 'processing_cluster',
        model_name: 'MiniMax H3 Fast',
        available: true,
      },
      {
        key: 'MiniMaxH3Mini',
        label: '本地 MiniMax H3 Mini',
        provider: 'processing_cluster',
        model_name: 'MiniMax H3 Mini',
        available: true,
      },
    ]);

    expect(options.map(option => option.value)).toEqual([
      'MiniMaxH3',
      'MiniMaxH3Fast',
      'MiniMaxH3Mini',
      'Seedance2Mini',
      'MINI',
      'HappyHorse',
    ]);
    expect(options.every(option => option.available)).toBe(true);
    expect(options.some(option => option.label.includes('当前不可用'))).toBe(false);
    expect(options.some(option => option.label.includes('MiniMax H3'))).toBe(true);
    expect(options.some(option => option.label.includes('Seedance 2.0'))).toBe(true);
    expect(options.some(option => option.label.includes('HappyHorse 1.0'))).toBe(true);
    expect(options.find(option => option.value === 'MiniMaxH3')?.label).toBe('MiniMax H3 · 本地节点模型');
    expect(options.find(option => option.value === 'Seedance2Mini')?.label).toBe('Seedance 2.0 Mini · 多模态简化视频模型');
    expect(options.find(option => option.value === 'MINI')?.label).toBe('MiniMax Hailuo 2.3 · 首尾帧标准视频模型');
    expect(options.find(option => option.value === 'MINI')?.runtimeLabel).toBe('MiniMax-Hailuo-2.3');
    expect(options.find(option => option.value === 'MINI')?.capability?.model_options).toEqual([
      'MiniMax-Hailuo-2.3',
      'MiniMax-Hailuo-2.3-Fast',
    ]);
  });

  it('does not concatenate Kling and Vidu routing alternatives into the selector label', () => {
    const options = buildVideoModelOptions([
      {
        key: 'Kling',
        provider: 'dashscope',
        model_options: [
          'kling/kling-v3-video-generation',
          'kling/kling-v3-omni-video-generation',
        ],
        available: true,
      },
      {
        key: 'Vidu',
        provider: 'dashscope',
        model_options: [
          'vidu/viduq3-mix_reference2video',
          'vidu/viduq3_reference2video',
          'vidu/viduq3-turbo_reference2video',
        ],
        available: true,
      },
    ], ['Kling', 'Vidu']);

    expect(options.map(option => option.label)).toEqual([
      'Kling V3 · 全能音画视频模型',
      'Vidu Q3 · 多参考视频模型',
    ]);
    expect(options[0].capability?.model_options).toHaveLength(2);
    expect(options[1].capability?.model_options).toHaveLength(3);
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
    ], ['Seedance15']);

    expect(options.map(option => option.value)).toEqual(['Seedance15']);
    expect(options[0].label).toBe('Seedance 1.5 Pro · 首尾帧视频模型');
    expect(options[0].runtimeLabel).toBe('doubao-seedance-1.5-pro');
  });

  it('does not resurrect the current legacy or unavailable model', () => {
    const options = buildVideoModelOptions([
      {
        key: 'HappyHorse',
        label: '炼虚',
        provider: 'dashscope',
        model_name: 'happyhorse-1.0-r2v',
        available: true,
      },
    ], ['HappyHorse']);

    const withCurrent = withCurrentVideoModelOption(options, 'Seedance2', [
      {
        key: 'Seedance2',
        label: '飞升',
        provider: 'seedance',
        model_name: 'doubao-seedance-2-0-260128',
        available: false,
      },
    ]);

    expect(withCurrent.map(option => option.value)).toEqual(['HappyHorse']);
  });
});
