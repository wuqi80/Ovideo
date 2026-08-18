// Shared video model names, parameter types, and pure inference helpers.

const MINIMAX_H3_MODELS = ['MiniMaxH3', 'MiniMaxH3Fast', 'MiniMaxH3Mini'] as const;
const COMFYUI_MODELS: string[] = ['Wan2', 'LTXNode1', 'WanNode2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', ...MINIMAX_H3_MODELS];

export type VideoModel =
  | 'Wan2' | 'LTXNode1' | 'WanNode2' | '一阶' | '二阶' | '三阶' | '四阶' | '五阶' | '六阶' | '七阶'
  | 'MiniMaxH3' | 'MiniMaxH3Fast' | 'MiniMaxH3Mini'
  | 'Veo' | 'Sora2' | 'MINI' | '大能'
  | 'Seedance15' | 'Seedance2' | 'Seedance2Fast' | 'Seedance2Mini'
  | 'Kling' | 'Vidu' | 'HappyHorse';

export type MiniMaxVideoModelName = string;
export type MiniMaxVideoDuration = 6 | 10;
export type MiniMaxVideoResolution = '768P' | '1080P';

export interface MiniMaxVideoParams {
  model: MiniMaxVideoModelName;
  duration: MiniMaxVideoDuration;
  resolution: MiniMaxVideoResolution;
  promptOptimizer: boolean;
}

export const DEFAULT_MINIMAX_VIDEO_PARAMS: MiniMaxVideoParams = {
  model: 'MiniMax-Hailuo-2.3',
  duration: 6,
  resolution: '768P',
  promptOptimizer: true,
};

export function normalizeMiniMaxVideoParams(
  params?: Partial<MiniMaxVideoParams> | null,
  defaultModel: MiniMaxVideoModelName = DEFAULT_MINIMAX_VIDEO_PARAMS.model,
): MiniMaxVideoParams {
  const model = String(params?.model || defaultModel || DEFAULT_MINIMAX_VIDEO_PARAMS.model).trim()
    || DEFAULT_MINIMAX_VIDEO_PARAMS.model;
  const resolution: MiniMaxVideoResolution = params?.resolution === '1080P' ? '1080P' : '768P';
  const requestedDuration: MiniMaxVideoDuration = Number(params?.duration) === 10 ? 10 : 6;

  return {
    model,
    duration: requestedDuration,
    resolution,
    promptOptimizer: params?.promptOptimizer !== false,
  };
}

export function getMiniMaxVideoParamsError(params: MiniMaxVideoParams): string | null {
  if (params.resolution === '1080P' && params.duration !== 6) {
    return '1080P 仅支持 6 秒；请选择 6 秒，或将清晰度改为 768P。';
  }
  return null;
}

export type DashScopeVideoModel = 'Kling' | 'Vidu' | 'HappyHorse';

export function isComfyUIModel(model: VideoModel): boolean {
  return COMFYUI_MODELS.includes(model);
}

export function isMiniMaxH3Model(model: VideoModel): boolean {
  return (MINIMAX_H3_MODELS as readonly string[]).includes(model);
}

export function isDashScopeVideoModel(model: VideoModel): model is DashScopeVideoModel {
  return model === 'Kling' || model === 'Vidu' || model === 'HappyHorse';
}

export type ShotType = 'multi' | 'single';

export type SeedanceMediaKind = 'image' | 'video' | 'audio';
export type SeedanceMediaRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio';

export interface SeedanceMediaInput {
  kind: SeedanceMediaKind;
  url: string;
  role?: SeedanceMediaRole;
  file_id?: string;
}

export interface SeedanceParams {
  sub_model: 'standard' | 'fast' | 'mini';
  model_scope?: string;
  prompt: string;
  media_inputs: SeedanceMediaInput[];
  resolution?: '480p' | '720p' | '1080p';
  ratio?: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9';
  duration?: number;
  seed?: number;
  watermark?: boolean;
  generate_audio?: boolean;
  camera_fixed?: boolean;
}

export type SeedanceVideoModel = 'Seedance15' | 'Seedance2' | 'Seedance2Fast' | 'Seedance2Mini';

export function isSeedanceVideoModel(model: VideoModel): model is SeedanceVideoModel {
  return model === 'Seedance15'
    || model === 'Seedance2'
    || model === 'Seedance2Fast'
    || model === 'Seedance2Mini';
}

export function isSeedanceAgentPlanModel(model: VideoModel | SeedanceVideoModel): boolean {
  return model === 'Seedance15';
}

export function supportsSeedanceMultimodalModel(model: VideoModel | SeedanceVideoModel): boolean {
  return isSeedanceVideoModel(model as VideoModel) && !isSeedanceAgentPlanModel(model);
}

export function seedanceSubModelForVideoModel(model: SeedanceVideoModel | VideoModel): SeedanceParams['sub_model'] {
  if (model === 'Seedance2Fast') return 'fast';
  if (model === 'Seedance2Mini') return 'mini';
  return 'standard';
}

export function inferSeedanceTaskType(media: SeedanceMediaInput[], hasDraftId?: boolean): string {
  if (hasDraftId) return 'seedance_draft';
  if (!media || media.length === 0) return 'seedance_t2v';
  const images = media.filter((m) => m.kind === 'image');
  const hasFirst = images.some((m) => m.role === 'first_frame');
  const hasLast = images.some((m) => m.role === 'last_frame');
  if (hasFirst && hasLast) return 'seedance_morph';
  if (
    media.length === 1
    && images.length === 1
    && (!images[0].role || images[0].role === 'first_frame')
  ) return 'seedance_i2v';
  return 'seedance_multi';
}

export function normalizeSeedanceMediaForSubmission(
  media: SeedanceMediaInput[] = [],
  agentPlanCompat: boolean = false,
): SeedanceMediaInput[] {
  if (!agentPlanCompat || !media.length) return media;
  if (media.some((m) => m.kind !== 'image')) return media;

  const images = media.filter((m) => m.kind === 'image');
  if (images.length === 1) {
    return media.map((m) => (
      m.kind === 'image' ? { ...m, role: 'first_frame' } : m
    ));
  }
  if (images.length === 2) {
    let imageIndex = 0;
    return media.map((m) => {
      if (m.kind !== 'image') return m;
      imageIndex += 1;
      return { ...m, role: imageIndex === 1 ? 'first_frame' : 'last_frame' };
    });
  }
  return media;
}

/**
 * 2026-07-11：Seedance 1.5-pro 仅支持单图或首尾帧，禁止多模态多输入。
 * Drama 后端（seedance.py）会在 Agent Plan endpoint 上强制覆盖 model=1.5-pro，
 * 1.5-pro 拒绝 video/audio kind 与 3+ 张图。前端拦截避免用户点了提交才报错、浪费扣费。
 *
 * 返回 null 表示可通过；返回 string 是禁用原因（同时也是按钮 tooltip）。
 * supportsMultimodal=true 表示当前卡片所选模型是 Seedance 2.0 系列，不走 1.5 / Agent Plan 限制。
 */
export function validateSeedanceMediaInputs(
    media: SeedanceMediaInput[],
    supportsMultimodal: boolean = false,
): string | null {
    if (supportsMultimodal) return null;
    if (!media) return null;
    const hasVideoAudio = media.some((m) => m.kind === 'video' || m.kind === 'audio');
    if (hasVideoAudio) {
        return 'Seedance 1.5-pro 不支持视频/音频参考输入，请移除 @视频/@音频 引用';
    }
    if (media.length > 2) {
        return 'Seedance 1.5-pro 最多支持 2 张图片（单图或首尾帧），请减少到 ≤2 张图';
    }
    return null;
}

export type KlingMode = 'std' | 'pro';
export type KlingSubModel = 'standard' | 'omni';

export type ViduSubModel =
  | 'q3-mix' | 'q3' | 'q3-turbo' | 'q3-pro'
  | 'q2' | 'q2-pro' | 'q2-turbo';

export type DashScopeResolution = '540P' | '720P' | '1080P';
export type DashScopeAspectRatio = '16:9' | '9:16' | '1:1';
export type HappyHorseRatio = '16:9' | '9:16' | '3:4' | '4:3' | '4:5' | '5:4' | '1:1' | '9:21' | '21:9';

export type KlingShotType = 'intelligence' | 'customize';
export interface KlingMultiPromptItem {
  index: number;
  prompt: string;
  duration: number;
}

export type ViduResolution = DashScopeResolution;
export type HhResolution = '720P' | '1080P';
export type HhRatio = HappyHorseRatio;

export interface DashScopeVideoParams {
  model: DashScopeVideoModel;
  prompt: string;
  media_inputs?: SeedanceMediaInput[];

  duration?: number;
  seed?: number;
  watermark?: boolean;

  sub_model_kling?: KlingSubModel;
  mode?: KlingMode;
  aspect_ratio?: DashScopeAspectRatio;
  audio?: boolean;

  sub_model_vidu?: ViduSubModel;
  resolution?: DashScopeResolution;
  size?: string;

  ratio?: HappyHorseRatio;

  kling_multi_shot?: boolean;
  kling_shot_type?: KlingShotType;
  kling_multi_prompt?: KlingMultiPromptItem[];
  kling_keep_original_sound?: 'yes' | 'no';
  kling_active_mode?: 'auto' | 'omni' | 'multi';

  vidu_resolution?: ViduResolution;
  vidu_size?: string;
  vidu_seed?: number;
  vidu_audio?: boolean;

  hh_resolution?: HhResolution;
  hh_ratio?: HhRatio;
  hh_duration?: number;
  hh_watermark?: boolean;
  hh_seed?: number;
}

export function makeDefaultDashScopeParams(
  model: DashScopeVideoModel,
  prompt: string = '',
  seedMedia: SeedanceMediaInput[] = [],
): DashScopeVideoParams {
  const base: DashScopeVideoParams = {
    model,
    prompt,
    media_inputs: seedMedia,
    duration: 5,
    seed: -1,
    watermark: false,
  };

  if (model === 'Kling') {
    return {
      ...base,
      sub_model_kling: 'standard',
      mode: 'std',
      aspect_ratio: '16:9',
      audio: false,
      kling_multi_shot: false,
      kling_shot_type: 'intelligence',
      kling_multi_prompt: [],
      kling_keep_original_sound: 'no',
      kling_active_mode: 'auto',
    };
  }

  if (model === 'Vidu') {
    return {
      ...base,
      sub_model_vidu: 'q3',
      resolution: '720P',
      audio: false,
      vidu_resolution: '720P',
      vidu_size: '1280*720',
      vidu_audio: false,
    };
  }

  return {
    ...base,
    resolution: '720P',
    ratio: '16:9',
    hh_resolution: '1080P',
    hh_ratio: '16:9',
    hh_duration: 5,
    hh_watermark: true,
  };
}

export function inferDashScopeTaskType(
  model: DashScopeVideoModel,
  media: SeedanceMediaInput[] = [],
): string {
  const images = media.filter((m) => m.kind === 'image');
  const hasFirst = images.some((m) => m.role === 'first_frame');
  const hasLast = images.some((m) => m.role === 'last_frame');

  if (model === 'Kling') {
    if (!media.length) return 'kling_t2v';
    if (hasFirst && hasLast) return 'kling_morph';
    if (hasFirst && !hasLast) return 'kling_i2v';
    return 'kling_refer';
  }

  if (model === 'Vidu') {
    if (hasFirst && hasLast) return 'vidu_morph';
    return 'vidu_r2v';
  }

  return 'happyhorse_r2v';
}

export function getModelDisplayName(model: VideoModel): string {
  const modelNameMap: Record<VideoModel, string> = {
    Wan2: '集群视频（旧版兼容）',
    LTXNode1: '处理节点1 · LTX',
    WanNode2: '处理节点2 · Wan',
    '一阶': '一阶',
    '二阶': '二阶',
    '三阶': '三阶',
    '四阶': '四阶',
    '五阶': '五阶',
    '六阶': '六阶',
    '七阶': '七阶',
    MiniMaxH3: '本地 MiniMax H3',
    MiniMaxH3Fast: 'MiniMax H3 Fast',
    MiniMaxH3Mini: '本地 MiniMax H3 Mini',
    Veo: '筑基',
    MINI: '金丹',
    Sora2: '化神',
    '大能': '大能',
    Seedance15: 'Seedance 1.5',
    Seedance2: '飞升',
    Seedance2Fast: '渡劫',
    Seedance2Mini: '元婴',
    Kling: '合体',
    Vidu: '大乘',
    HappyHorse: '炼虚',
  };
  return modelNameMap[model] || model;
}

export const ALL_MODELS: VideoModel[] = [
  'Wan2', 'LTXNode1', 'WanNode2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', ...MINIMAX_H3_MODELS,
  'Veo', 'Sora2', 'MINI', '大能',
  'Seedance15', 'Seedance2', 'Seedance2Fast', 'Seedance2Mini',
  'Kling', 'Vidu', 'HappyHorse',
];

export const SELECTABLE_MODELS: VideoModel[] = [
  'MiniMaxH3', 'MiniMaxH3Fast', 'MiniMaxH3Mini', 'Wan2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶',
  'LTXNode1', 'WanNode2',
  'Veo', 'Sora2', 'MINI', '大能',
  'Seedance2', 'Seedance2Fast', 'Seedance2Mini',
  'Kling', 'Vidu', 'HappyHorse',
];

export function getVideoCreditEstimateParams(
  model: VideoModel,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const applyOverrides = (defaults: Record<string, unknown>): Record<string, unknown> => {
    const definedOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([key, value]) => (
        key !== 'model'
        && value !== undefined
        && value !== null
        && value !== ''
      )),
    );
    return { ...defaults, ...definedOverrides, model };
  };
  const base: Record<string, unknown> = { model, duration_seconds: 5 };
  if (model === 'HappyHorse') return applyOverrides({ ...base, hh_resolution: '1080P' });
  if (model === 'Vidu') return applyOverrides({ ...base, sub_model: 'q3', vidu_resolution: '720P' });
  if (model === 'Kling') return applyOverrides({ ...base, resolution: '720P', audio: false });
  if (model === '大能') return applyOverrides({ ...base, resolution: '1080P' });
  if (model === 'MINI') {
    return applyOverrides({
      model,
      duration_seconds: 6,
      minimax_model: DEFAULT_MINIMAX_VIDEO_PARAMS.model,
      minimax_resolution: DEFAULT_MINIMAX_VIDEO_PARAMS.resolution,
    });
  }
  if (isSeedanceVideoModel(model)) {
    return applyOverrides({
      ...base,
      sub_model: seedanceSubModelForVideoModel(model),
      resolution: '720P',
    });
  }
  if (model === 'Sora2') return applyOverrides({ model, duration_seconds: 15, resolution: '720P' });
  if (model === 'Veo') return applyOverrides({ model, duration_seconds: 8, resolution: '720P' });
  return applyOverrides(base);
}

const ALL_MODEL_VALUES = new Set<string>(ALL_MODELS);

export interface VideoCapabilityModelLike {
  key?: string;
  label?: string;
  provider?: string;
  model_name?: string | null;
  model_options?: string[];
  available?: boolean;
  preferred_agent_id?: string | null;
  preferred_node_id?: string | null;
  preferred_comfyui_port?: number | null;
  strict_preferred_routing?: boolean;
}

export interface VideoModelOption {
  value: VideoModel;
  label: string;
  baseLabel: string;
  runtimeLabel: string;
  available: boolean;
  provider?: string;
  capability?: VideoCapabilityModelLike;
}

export function isVideoModelKey(value: string): value is VideoModel {
  return ALL_MODEL_VALUES.has(value);
}

function uniqueNonEmpty(values: Iterable<unknown>): string[] {
  const out: string[] = [];
  for (const item of values) {
    const value = String(item || '').trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export function getVideoModelRuntimeNames(capability?: VideoCapabilityModelLike | null): string[] {
  if (!capability) return [];
  return uniqueNonEmpty([
    ...(Array.isArray(capability.model_options) ? capability.model_options : []),
    capability.model_name,
  ]);
}

export function formatVideoModelRuntimeLabel(capability?: VideoCapabilityModelLike | null): string {
  const names = getVideoModelRuntimeNames(capability);
  if (names.length <= 2) return names.join(' / ');
  return `${names[0]} / ${names[1]} / +${names.length - 2}`;
}

export function formatVideoModelOptionLabel(
  model: VideoModel,
  capability?: VideoCapabilityModelLike | null,
): string {
  const base = getModelDisplayName(model);
  const runtimeLabel = formatVideoModelRuntimeLabel(capability);
  return runtimeLabel ? `${base} · ${runtimeLabel}` : base;
}

export function buildVideoModelOptions(
  capabilities: readonly VideoCapabilityModelLike[] | null | undefined,
  fallbackModels: readonly VideoModel[] = SELECTABLE_MODELS,
): VideoModelOption[] {
  const hasManifest = Array.isArray(capabilities) && capabilities.length > 0;
  const capabilityByKey = new Map<string, VideoCapabilityModelLike>();
  if (hasManifest) {
    for (const capability of capabilities || []) {
      const key = String(capability.key || '').trim();
      if (isVideoModelKey(key)) capabilityByKey.set(key, capability);
    }
  }

  return fallbackModels.flatMap((model) => {
    const capability = capabilityByKey.get(model);
    const available = capability ? capability.available !== false : false;
    const runtimeLabel = formatVideoModelRuntimeLabel(capability);
    return [{
      value: model,
      label: formatVideoModelOptionLabel(model, capability),
      baseLabel: getModelDisplayName(model),
      runtimeLabel,
      available,
      provider: capability?.provider,
      capability,
    }];
  });
}

export function withCurrentVideoModelOption(
  options: readonly VideoModelOption[],
  currentModel: VideoModel,
  capabilities: readonly VideoCapabilityModelLike[] | null | undefined,
): VideoModelOption[] {
  if (options.some(option => option.value === currentModel)) return [...options];
  const capability = Array.isArray(capabilities)
    ? capabilities.find(item => item.key === currentModel)
    : undefined;
  return [
    {
      value: currentModel,
      label: `${formatVideoModelOptionLabel(currentModel, capability)}（当前不可用）`,
      baseLabel: getModelDisplayName(currentModel),
      runtimeLabel: formatVideoModelRuntimeLabel(capability),
      available: false,
      provider: capability?.provider,
      capability,
    },
    ...options,
  ];
}
