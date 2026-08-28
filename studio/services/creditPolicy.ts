import type { AppNode } from '../types';
import { NodeType } from '../types';
import {
  STUDIO_AUDIO_MODEL_SPEECH_HD,
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_TEXT_MODEL_CONFIGURED,
  normalizeStudioAudioModel,
  normalizeStudioImageModel,
  normalizeStudioVideoModel,
} from './modelOptions';

export type StudioCreditFeature =
  | 'prompt_optimize'
  | 'image_generation'
  | 'video_generation'
  | 'audio_generation_tts';

export interface StudioCreditRequest {
  featureKey: StudioCreditFeature;
  params: Record<string, unknown>;
  /**
   * One queued video task is reserved and settled independently. The quote API
   * returns the price of one task, so the canvas multiplies it for batch video
   * generation before the first task is submitted.
   */
  quantity: number;
  fallbackUnitCost: number;
}

export interface StudioCreditQuote {
  enabled: boolean;
  estimatedCost: number;
  balance: number | null;
  enough: boolean;
}

export interface StudioCreditSummary extends StudioCreditQuote {
  totalCost: number;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fallbackSeedanceUnitCost(model: string, duration: number): number {
  const fiveSecondCost = model === 'standard' ? 95 : 75;
  return Math.max(1, Math.round((fiveSecondCost * duration) / 5));
}

export function estimateStudioTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const nonCjkLength = Math.max(0, text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '').trim().length);
  return Math.max(1, cjkCount + Math.ceil(nonCjkLength / 4));
}

export function buildStudioTextCreditRequest(text: string): StudioCreditRequest {
  return {
    featureKey: 'prompt_optimize',
    params: {
      input_tokens: estimateStudioTextTokens(text),
      output_tokens: 1200,
      model: STUDIO_TEXT_MODEL_CONFIGURED,
    },
    quantity: 1,
    fallbackUnitCost: 2,
  };
}

export function buildStudioNodeCreditRequest(
  node: AppNode,
  promptOverride?: string,
): StudioCreditRequest | null {
  const prompt = promptOverride ?? node.data.prompt ?? '';

  if (node.type === NodeType.IMAGE_GENERATOR || node.type === NodeType.IMAGE_EDITOR) {
    return {
      featureKey: 'image_generation',
      params: {
        image_count: node.type === NodeType.IMAGE_EDITOR ? 1 : positiveInt(node.data.imageCount, 1),
        model: normalizeStudioImageModel(node.data.model) || STUDIO_IMAGE_MODEL_CONFIGURED,
        resolution: node.data.resolution || '2K',
        aspect_ratio: node.data.aspectRatio || '16:9',
      },
      quantity: 1,
      fallbackUnitCost: 10,
    };
  }

  if (node.type === NodeType.VIDEO_GENERATOR) {
    const model = normalizeStudioVideoModel(node.data.model);
    const duration = positiveInt(node.data.duration, 5);
    return {
      featureKey: 'video_generation',
      params: {
        task_type: 'seedance_multi',
        model: `seedance-${model}`,
        sub_model: model,
        duration_seconds: duration,
        // Studio currently submits Seedance at 720p; the estimate must mirror
        // the trusted task payload instead of a display-only legacy value.
        resolution: '720p',
      },
      quantity: positiveInt(node.data.videoCount, 1),
      fallbackUnitCost: fallbackSeedanceUnitCost(model, duration),
    };
  }

  if (node.type === NodeType.AUDIO_GENERATOR) {
    return {
      featureKey: 'audio_generation_tts',
      params: {
        character_count: prompt.length,
        model: normalizeStudioAudioModel(node.data.model) || STUDIO_AUDIO_MODEL_SPEECH_HD,
      },
      quantity: 1,
      fallbackUnitCost: 2,
    };
  }

  return null;
}

export function summarizeStudioCreditQuote(
  request: StudioCreditRequest,
  quote: StudioCreditQuote | null,
): StudioCreditSummary {
  const enabled = quote?.enabled ?? true;
  const unitCost = enabled
    ? Math.max(0, quote?.estimatedCost ?? request.fallbackUnitCost)
    : 0;
  const totalCost = unitCost * Math.max(1, request.quantity);
  const balance = quote?.balance ?? null;
  return {
    enabled,
    estimatedCost: unitCost,
    totalCost,
    balance,
    enough: !enabled || balance === null || balance >= totalCost,
  };
}
