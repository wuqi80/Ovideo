import { afterEach, describe, expect, it, vi } from 'vitest';

const { generateGeminiImageViaProxy } = vi.hoisted(() => ({
  generateGeminiImageViaProxy: vi.fn(),
}));

vi.mock('../../services/geminiImageService', () => ({
  generateGeminiImageViaProxy,
}));

import {
  generateFinalIllustrationResult,
  generateMaterialImage,
} from '../../services/geminiImageGenerationService';

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

  it('does not override a final illustration prompt with a forced anime style', async () => {
    generateGeminiImageViaProxy.mockResolvedValueOnce([{ file_id: 'file_1', url: '/storage/image/file_1.webp' }]);

    await generateFinalIllustrationResult('photorealistic portrait', []);

    const request = generateGeminiImageViaProxy.mock.calls[0][0];
    expect(request.prompt).toContain('photorealistic portrait');
    expect(request.prompt).toContain('Preserve the visual style explicitly stated above');
    expect(request.prompt).not.toMatch(/Anime\/Manga/i);
  });

  it('does not force material generation to anime', async () => {
    generateGeminiImageViaProxy.mockResolvedValueOnce([{ file_id: 'file_1', url: '/storage/image/file_1.webp' }]);

    await expect(generateMaterialImage('小男孩', 'character', '写实人物')).resolves.toBe('/storage/image/file_1.webp');

    const request = generateGeminiImageViaProxy.mock.calls[0][0];
    expect(request.prompt).toContain('Follow the style explicitly requested in the context');
    expect(request.prompt).not.toMatch(/Anime\/Manga/i);
  });

  it('forwards storyboard navigation context to the proxy task', async () => {
    generateGeminiImageViaProxy.mockResolvedValueOnce([{ file_id: 'file_1', url: '/storage/image/file_1.webp' }]);

    await generateFinalIllustrationResult('shot prompt', [], {
      entityType: 'storyboard_item',
      entityId: 'shot_06',
      fileRole: 'generated_image',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourcePage: 'generation',
      sourceItemId: 'shot_06',
    });

    expect(generateGeminiImageViaProxy.mock.calls[0][0]).toMatchObject({
      model: 'nanobanana',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourcePage: 'generation',
      sourceItemId: 'shot_06',
    });
  });
});
