import { describe, expect, it } from 'vitest';
import { hasStoredVideoResult } from '../../utils/videoResultPresentation';

describe('hasStoredVideoResult', () => {
  it('keeps a previous successful video visible after a retry fails', () => {
    expect(hasStoredVideoResult({
      state: 'failed',
      videos: ['/storage/videos/previous-success.mp4'],
      error: 'latest generation failed',
    })).toBe(true);
  });

  it('does not treat an empty result list as video history', () => {
    expect(hasStoredVideoResult({ state: 'failed', videos: [] })).toBe(false);
    expect(hasStoredVideoResult({ state: 'failed', videos: [''] })).toBe(false);
  });
});
