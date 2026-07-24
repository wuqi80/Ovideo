import { afterEach, describe, expect, it, vi } from 'vitest';

const { generateGeminiImageViaProxy } = vi.hoisted(() => ({
  generateGeminiImageViaProxy: vi.fn(),
}));

vi.mock('../../services/geminiImageService', () => ({
  generateGeminiImageViaProxy,
}));

import { generateFinalIllustrationResult } from '../../services/geminiImageGenerationService';

describe('geminiImageGenerationService', () => {
  afterEach(() => {
    vi.useRealTimers();
    generateGeminiImageViaProxy.mockReset();
  });

  it('preserves the upstream error so the UI can show the actual failure', async () => {
    generateGeminiImageViaProxy.mockRejectedValueOnce(new Error('HTTP 400: content policy rejected'));

    await expect(generateFinalIllustrationResult('prompt', [])).rejects.toThrow(
      'HTTP 400: content policy rejected',
    );
    expect(generateGeminiImageViaProxy).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 503 before returning the generated file', async () => {
    vi.useFakeTimers();
    generateGeminiImageViaProxy
      .mockRejectedValueOnce(new Error('HTTP 503: model unavailable'))
      .mockResolvedValueOnce([{ file_id: 'file_1', url: '/storage/image/file_1.webp' }]);

    const pending = generateFinalIllustrationResult('prompt', []);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ file_id: 'file_1' });
    expect(generateGeminiImageViaProxy).toHaveBeenCalledTimes(2);
  });
});
