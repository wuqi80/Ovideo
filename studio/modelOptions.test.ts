import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_IMAGE_MODEL_LABEL,
  normalizeStudioImageModel,
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
