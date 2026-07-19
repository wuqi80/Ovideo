/**
 * GPT Image 2 系列前端服务
 * 
 * 单一入口 generateGptImage：
 * - tier="vip"      → 默认分组 GPT_IMAGE_API_KEY → 模型 gpt-image-2-vip   （天劫一阶）
 * - tier="official" → Sora2Official 分组 SORA2_GPT_IMAGE_API_KEY → 模型 gpt-image-2 （天劫二阶）
 * 
 * references 为空 → 文生图 (后端 /v1/images/generations)
 * references 非空 → 图改图 (后端 /v1/images/edits, multipart)
 * 
 * size 推荐：
 * - 调用方传 ratio + k 档位（GptImageRatio × GptImageK），service 内部映射成
 *   "1024x1024" 这类像素串后透传给后端。这样 UI 永远只暴露「比例 + 分辨率档位」，
 *   像素值由本 service 集中管理，避免前端两个地方维护 30 项映射表。
 */

import {
  recommendGptImageSize,
  type GptImageRatio,
  type GptImageK,
} from '../utils/gptImageSizeMap';
import { apiJson } from './httpClient';
import type { GeminiImageReferenceMetadata } from './geminiImageService';

export type GptImageTier = 'vip' | 'official';
export type GptImageQuality = 'auto' | 'low' | 'medium' | 'high';

export interface GenerateGptImageOptions {
  tier: GptImageTier;
  prompt: string;
  referenceMetadata?: GeminiImageReferenceMetadata[];
  references?: string[];        // data:URL 或 /storage/ 路径，空 → 文生图
  ratio?: GptImageRatio;        // 默认 "auto"
  k?: GptImageK;                // 默认 "auto"
  quality?: GptImageQuality;    // 默认 "auto"
  n?: number;                   // 默认 1，最大 4
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  projectId?: string;
  episodeId?: string;
}

export interface GptImageResult {
  data_url?: string | null;
  url?: string | null;
  file_id?: string | null;
  file_url?: string | null;
}

export interface GenerateGptImageResponse {
  success: boolean;
  images: string[];
  files: GptImageResult[];
  model: string;
  tier: GptImageTier;
}

export async function generateGptImage(
  opts: GenerateGptImageOptions
): Promise<GenerateGptImageResponse> {
  if (!opts.prompt || !opts.prompt.trim()) {
    throw new Error('prompt 不能为空');
  }
  if (opts.tier !== 'vip' && opts.tier !== 'official') {
    throw new Error(`不支持的 tier: ${opts.tier}（应为 vip|official）`);
  }

  const ratio: GptImageRatio = opts.ratio ?? 'auto';
  const k: GptImageK = opts.k ?? 'auto';
  const size = recommendGptImageSize(ratio, k);
  const quality: GptImageQuality = opts.quality ?? 'auto';
  const n = Math.max(1, Math.min(4, opts.n ?? 1));

  const body = {
    tier: opts.tier,
    prompt: opts.prompt,
    reference_metadata: opts.referenceMetadata ?? [],
    references: opts.references ?? [],
    size,
    quality,
    n,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    file_role: opts.fileRole,
    project_id: opts.projectId,
    episode_id: opts.episodeId,
  };

  const data = await apiJson<GenerateGptImageResponse>('/api/gpt-image/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'GPT Image 生成');

  if (!data || !Array.isArray(data.images) || data.images.length === 0) {
    throw new Error('GPT Image 未返回图片');
  }
  return data;
}
