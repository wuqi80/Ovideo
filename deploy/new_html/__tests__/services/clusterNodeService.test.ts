import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPreferredGpuNodeId,
  resolveGpuTaskRouting,
  setPreferredGpuNodeId,
} from '../../services/clusterNodeService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function response(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  localStorage.setItem('auth_token', 'test-token');
});

describe('GPU cluster routing', () => {
  it('uses GPU1 by default even when another node is also online', async () => {
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'online' },
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'online' },
      ],
    }));

    const routing = await resolveGpuTaskRouting();

    expect(routing.preferredAgentId).toBe('agent_gpu1');
    expect(routing.node?.name).toBe('GPU1');
  });

  it('persists a manual GPU2 preference', async () => {
    setPreferredGpuNodeId('GPU2');
    expect(getPreferredGpuNodeId()).toBe('GPU2');
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'online' },
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'online' },
      ],
    }));

    const routing = await resolveGpuTaskRouting();
    expect(routing.preferredAgentId).toBe('agent_gpu2');
  });

  it('does not silently reroute when the selected node is offline', async () => {
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'offline' },
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'online' },
      ],
    }));

    await expect(resolveGpuTaskRouting()).rejects.toThrow('GPU1');
  });

  it('does not route to an agent whose ComfyUI instance is unavailable', async () => {
    setPreferredGpuNodeId('GPU2');
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'unavailable' },
      ],
    }));

    await expect(resolveGpuTaskRouting()).rejects.toThrow('GPU2');
  });
});
