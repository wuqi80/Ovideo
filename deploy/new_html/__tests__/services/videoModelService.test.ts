import { describe, expect, it } from 'vitest';
import {
  buildVideoModelOptions,
  SELECTABLE_MODELS,
  getModelDisplayName,
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

describe('processing cluster model label', () => {
  it('shows node-specific processing model labels and keeps Wan2 as a legacy ID', () => {
    expect(getModelDisplayName('LTXNode1')).toBe('处理节点1 · LTX');
    expect(getModelDisplayName('WanNode2')).toBe('处理节点2 · Wan');
    expect(getModelDisplayName('Wan2')).toBe('集群视频（旧版兼容）');
  });
});

describe('video credit estimate params', () => {
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
    expect(seedanceSubModelForVideoModel('Seedance15')).toBe('standard');
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
  it('keeps the local and legacy workflow entries visible at the top of the selector', () => {
    expect(SELECTABLE_MODELS.slice(0, 11)).toEqual([
      'MiniMaxH3',
      'MiniMaxH3Fast',
      'MiniMaxH3Mini',
      'Wan2',
      '一阶',
      '二阶',
      '三阶',
      '四阶',
      '五阶',
      '六阶',
      '七阶',
    ]);
  });

  it('keeps all selectable models and marks unavailable ones with runtime labels', () => {
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
        model_name: 'MiniMax-H3 FL2VA',
        available: true,
      },
      {
        key: 'MiniMaxH3Fast',
        label: 'MiniMax H3 Fast',
        provider: 'processing_cluster',
        model_name: 'MiniMax-H3 FL2VA + SageAttention',
        available: true,
      },
      {
        key: 'MiniMaxH3Mini',
        label: '本地 MiniMax H3 Mini',
        provider: 'processing_cluster',
        model_name: 'MiniMax-H3 FL2VA + Qwen3-VL-4B ClipProj',
        available: true,
      },
    ]);

    expect(options.map(option => option.value)).toEqual(SELECTABLE_MODELS);
    expect(options.find(option => option.value === 'LTXNode1')?.available).toBe(false);
    expect(options.find(option => option.value === 'LTXNode1')?.label).toContain('当前不可用');
    expect(options.find(option => option.value === 'WanNode2')?.available).toBe(true);
    expect(options.find(option => option.value === 'HappyHorse')?.label).toContain('happyhorse-1.0-r2v');
    expect(options.find(option => option.value === 'Seedance2Mini')?.label).toContain('doubao-seedance-2-0-mini-260615');
    expect(options.find(option => option.value === 'MiniMaxH3')?.label).toContain('MiniMax-H3 FL2VA');
    expect(options.find(option => option.value === 'MiniMaxH3Fast')?.label).toContain('SageAttention');
    expect(options.find(option => option.value === 'MiniMaxH3Mini')?.label).toContain('Qwen3-VL-4B ClipProj');
    expect(options.find(option => option.value === 'MINI')?.label).toContain('MiniMax-Hailuo-2.3');
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
    ], ['MiniMaxH3']);

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
