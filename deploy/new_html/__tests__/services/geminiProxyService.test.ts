import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.fn();

vi.mock('../../services/httpClient', () => ({
  apiJson: (...args: any[]) => apiJson(...args),
}));

import { callGeminiProxy } from '../../services/geminiProxyService';

describe('geminiProxyService task context', () => {
  beforeEach(() => {
    apiJson.mockReset();
    apiJson.mockResolvedValue({ content: 'ok' });
  });

  it('sends readable task context to the backend notification pipeline', async () => {
    await expect(callGeminiProxy('prompt', undefined, 'gemini-model', {
      operation: 'script_rewrite',
      displayName: '剧本修改',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourcePage: 'script',
      sourceItemId: 'script_1',
    })).resolves.toBe('ok');

    const request = apiJson.mock.calls[0][1];
    expect(JSON.parse(request.body)).toMatchObject({
      operation: 'script_rewrite',
      display_name: '剧本修改',
      project_id: 'proj_1',
      episode_id: 'ep_1',
      source_page: 'script',
      source_item_id: 'script_1',
      model: 'gemini-model',
    });
  });
});
