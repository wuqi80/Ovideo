export const STUDIO_TEXT_MODEL_CONFIGURED = 'gemini-2.5-flash';
export const STUDIO_TEXT_MODEL_LABEL = 'Gemini 文本 · 后台配置';

export const STUDIO_IMAGE_MODEL_CONFIGURED = 'gemini-2.5-flash-image';
export const STUDIO_IMAGE_MODEL_LABEL = 'Gemini 图像 · 后台配置';
export const STUDIO_IMAGE_MODEL_SHORT_LABEL = 'Gemini 图像';
export const STUDIO_IMAGE_MODEL_POSE_LABEL = 'Gemini 姿态 · 后台配置';

export const STUDIO_VIDEO_MODEL_STANDARD = 'standard';
export const STUDIO_VIDEO_MODEL_FAST = 'fast';
export const STUDIO_VIDEO_MODEL_STANDARD_LABEL = '飞升 · Seedance 标准';
export const STUDIO_VIDEO_MODEL_FAST_LABEL = '渡劫 · Seedance 极速';

export const STUDIO_AUDIO_MODEL_SPEECH_HD = 'speech-hd';
export const STUDIO_AUDIO_MODEL_LABEL = 'MiniMax 语音 · 后台配置';

export const STUDIO_TEXT_MODEL_OPTIONS = [
  { l: STUDIO_TEXT_MODEL_LABEL, v: STUDIO_TEXT_MODEL_CONFIGURED },
] as const;

export const STUDIO_IMAGE_MODEL_OPTIONS = [
  { l: STUDIO_IMAGE_MODEL_LABEL, v: STUDIO_IMAGE_MODEL_CONFIGURED },
] as const;

export const STUDIO_VIDEO_MODEL_OPTIONS = [
  { l: STUDIO_VIDEO_MODEL_FAST_LABEL, v: STUDIO_VIDEO_MODEL_FAST },
  { l: STUDIO_VIDEO_MODEL_STANDARD_LABEL, v: STUDIO_VIDEO_MODEL_STANDARD },
] as const;

export const STUDIO_AUDIO_MODEL_OPTIONS = [
  { l: STUDIO_AUDIO_MODEL_LABEL, v: STUDIO_AUDIO_MODEL_SPEECH_HD },
] as const;

export function normalizeStudioTextModel(model?: string | null): string {
  const value = String(model || '').trim();
  if (!value || value.toLowerCase() === 'gemini') {
    return STUDIO_TEXT_MODEL_CONFIGURED;
  }
  return value;
}

export function normalizeStudioImageModel(model?: string | null): string {
  const value = String(model || '').trim();
  if (!value || value.toLowerCase() === 'nanobanana') {
    return STUDIO_IMAGE_MODEL_CONFIGURED;
  }
  return value;
}

export function studioImageModelOverride(model?: string | null): string | undefined {
  const normalized = normalizeStudioImageModel(model);
  return normalized === STUDIO_IMAGE_MODEL_CONFIGURED ? undefined : normalized;
}

export function normalizeStudioVideoModel(model?: string | null): string {
  const value = String(model || '').trim();
  const normalized = value.toLowerCase();
  if (!normalized || normalized === 'seedance2fast' || normalized === 'seedance-fast') {
    return STUDIO_VIDEO_MODEL_FAST;
  }
  if (normalized === 'seedance2' || normalized === 'seedance-standard') {
    return STUDIO_VIDEO_MODEL_STANDARD;
  }
  if (normalized === STUDIO_VIDEO_MODEL_STANDARD || normalized === STUDIO_VIDEO_MODEL_FAST) {
    return normalized;
  }
  return STUDIO_VIDEO_MODEL_FAST;
}

export function studioVideoCapabilityKey(model?: string | null): 'Seedance2' | 'Seedance2Fast' {
  return normalizeStudioVideoModel(model) === STUDIO_VIDEO_MODEL_STANDARD ? 'Seedance2' : 'Seedance2Fast';
}

export function normalizeStudioAudioModel(model?: string | null): string {
  const value = String(model || '').trim();
  const normalized = value.toLowerCase();
  if (!normalized || normalized === 'minimax-speech-2.6-hd' || normalized === 'speech-2.6-hd' || normalized === 'speech-2.8-hd') {
    return STUDIO_AUDIO_MODEL_SPEECH_HD;
  }
  if (normalized === 'minimax-speech-2.6-turbo' || normalized === 'speech-2.6-turbo' || normalized === 'speech-2.8-turbo') {
    return 'speech-turbo';
  }
  if (normalized === 'speech-hd' || normalized === 'speech-turbo') {
    return normalized;
  }
  return STUDIO_AUDIO_MODEL_SPEECH_HD;
}
