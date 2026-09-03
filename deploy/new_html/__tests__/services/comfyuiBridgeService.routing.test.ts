import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  resolveGpuTaskRouting: vi.fn(),
}));

vi.mock('../../services/httpClient', () => ({
  apiBlob: vi.fn(),
  apiJson: mocks.apiJson,
  getAuthToken: () => 'test-token',
  publicBlob: vi.fn(),
  secureApiUrl: (url: string) => url,
}));

vi.mock('../../services/clusterNodeService', () => ({
  resolveGpuTaskRouting: mocks.resolveGpuTaskRouting,
}));

import { processMaterial } from '../../services/comfyuiBridgeService';

describe('processMaterial routing', () => {
  beforeEach(() => {
    mocks.apiJson.mockReset().mockResolvedValue({ success: true, task_id: 'task_1', message: 'queued' });
    mocks.resolveGpuTaskRouting.mockReset().mockResolvedValue({
      preferredAgentId: 'agent_local',
      preferredNodeId: 'node_local',
    });
  });

  it('uses automatic live-capacity routing when the workflow did not choose a node', async () => {
    await processMaterial('source.png', 'image_upscale', { projectId: 'proj_1' });

    expect(mocks.resolveGpuTaskRouting).toHaveBeenCalledWith(undefined, { automatic: true });
    expect(mocks.apiJson).toHaveBeenCalledWith(
      '/api/materials/process',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"preferred_agent_id":"agent_local"'),
      }),
      'processMaterial',
    );
  });

  it('preserves an explicitly selected node', async () => {
    await processMaterial('source.png', 'upscale_hd', {
      preferredAgentId: 'agent_manual',
    });

    expect(mocks.resolveGpuTaskRouting).toHaveBeenCalledWith('agent_manual', undefined);
  });
});
