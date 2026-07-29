export const STUDIO_IMAGE_MODEL_CONFIGURED = 'gemini-image-configured';
export const STUDIO_IMAGE_MODEL_LABEL = 'Gemini 图像 · 后台配置';
export const STUDIO_IMAGE_MODEL_SHORT_LABEL = 'Gemini 图像';
export const STUDIO_IMAGE_MODEL_POSE_LABEL = 'Gemini 姿态 · 后台配置';

export const STUDIO_IMAGE_MODEL_OPTIONS = [
  { l: STUDIO_IMAGE_MODEL_LABEL, v: STUDIO_IMAGE_MODEL_CONFIGURED },
] as const;

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
