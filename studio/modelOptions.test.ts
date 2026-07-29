import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STUDIO_AUDIO_MODEL_OPTIONS,
  STUDIO_IMAGE_MODEL_OPTIONS,
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_IMAGE_MODEL_LABEL,
  STUDIO_TEXT_MODEL_OPTIONS,
  STUDIO_VIDEO_MODEL_OPTIONS,
  normalizeStudioAudioModel,
  normalizeStudioImageModel,
  normalizeStudioTextModel,
  normalizeStudioVideoModel,
  studioImageModelOverride,
} from './services/modelOptions';

const studioRoot = resolve(__dirname);

function readStudioFile(path: string): string {
  return readFileSync(resolve(studioRoot, path), 'utf8');
}

describe('Studio image model contract', () => {
  it('normalizes the old NanoBanana canvas value to the configured backend image model', () => {
    expect(normalizeStudioImageModel('nanobanana')).toBe(STUDIO_IMAGE_MODEL_CONFIGURED);
    expect(normalizeStudioImageModel('')).toBe(STUDIO_IMAGE_MODEL_CONFIGURED);
    expect(studioImageModelOverride('nanobanana')).toBeUndefined();
  });

  it('normalizes legacy Studio model ids to backend API config operation ids', () => {
    expect(normalizeStudioTextModel('gemini')).toBe('gemini-2.5-flash');
    expect(normalizeStudioVideoModel('Seedance2Fast')).toBe('fast');
    expect(normalizeStudioVideoModel('Seedance2')).toBe('standard');
    expect(normalizeStudioAudioModel('minimax-speech-2.6-hd')).toBe('speech-hd');
  });

  it('only exposes model ids that exist in the backend provider binding registry', () => {
    const backendOperations = new Set([
      'gemini-2.5-flash',
      'gemini-2.5-flash-image',
      'gemini-3-pro-image-preview',
      'standard',
      'fast',
      'speech-hd',
      'speech-turbo',
    ]);
    const exposedValues = [
      ...STUDIO_TEXT_MODEL_OPTIONS,
      ...STUDIO_IMAGE_MODEL_OPTIONS,
      ...STUDIO_VIDEO_MODEL_OPTIONS,
      ...STUDIO_AUDIO_MODEL_OPTIONS,
    ].map(option => option.v);

    expect(exposedValues).not.toContain('nanobanana');
    expect(exposedValues).not.toContain('Seedance2Fast');
    expect(exposedValues).not.toContain('minimax-speech-2.6-hd');
    expect(exposedValues.every(value => backendOperations.has(value))).toBe(true);
  });

  it('labels image generation as a backend-configured Gemini image model', () => {
    expect(STUDIO_IMAGE_MODEL_LABEL).toContain('后台配置');
    expect(readStudioFile('components/Node.tsx')).toContain('STUDIO_IMAGE_MODEL_OPTIONS');
  });

  it('does not expose the migrated NanoBanana alias in Studio canvas source', () => {
    for (const path of [
      'App.tsx',
      'components/Node.tsx',
      'components/SketchEditor.tsx',
      'services/videoStrategies.ts',
      'platform/dramaRuntime.ts',
    ]) {
      expect(readStudioFile(path).toLowerCase()).not.toContain('nanobanana');
    }
  });
});
