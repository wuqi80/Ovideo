export const DESIGN_CREDIT_FEATURES = {
  imageGeneration: 'design_image_generation',
  angleAdjustment: 'design_angle_adjustment',
  upscaleHd: 'design_upscale_hd',
} as const;

export const DESIGN_CREDIT_DEFAULTS = {
  imageGenerationPerImage: 40,
  angleAdjustment: 5,
  upscaleHd: 5,
} as const;

export function designImageCreditParams(options: {
  imageCount: number;
  model: string;
  resolution: string;
  aspectRatio: string;
}) {
  return {
    image_count: Math.max(1, Math.floor(options.imageCount || 1)),
    model: options.model,
    resolution: options.resolution,
    aspect_ratio: options.aspectRatio,
  };
}

export function designOperationCreditParams(workflow: 'angle_adjustment' | 'upscale_hd') {
  return {
    operation_count: 1,
    workflow,
  };
}

export function newDesignCreditUsageId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}:${uuid}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}
