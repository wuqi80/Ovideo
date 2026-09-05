import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPreferredGpuNodeId,
  resolveGpuTaskRouting,
  selectGpuTaskNode,
  setPreferredGpuNodeId,
} from '../../services/clusterNodeService';
import { crmMessage } from '../../admin/crmUI';

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

describe('processing cluster routing', () => {
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
    expect(routing.node?.name).toBe('处理节点1');
  });

  it('persists a manual GPU2 preference', async () => {
    setPreferredGpuNodeId('agent_gpu2');
    expect(getPreferredGpuNodeId()).toBe('agent_gpu2');
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

  it('keeps default routing stable when the GPU display name changes', async () => {
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        {
          id: 'agent_gpu1',
          agent_id: 'agent_gpu1',
          name: '主渲染机',
          routing_name: 'GPU1',
          status: 'online',
        },
        {
          id: 'agent_gpu2',
          agent_id: 'agent_gpu2',
          name: '备用渲染机',
          routing_name: 'GPU2',
          status: 'online',
        },
      ],
    }));

    const routing = await resolveGpuTaskRouting();

    expect(routing.preferredAgentId).toBe('agent_gpu1');
    expect(routing.node?.name).toBe('主渲染机');
    expect(getPreferredGpuNodeId()).toBe('agent_gpu1');
  });

  it('falls back to GPU1 when the selected node is offline', async () => {
    setPreferredGpuNodeId('GPU2');
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'online' },
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'offline' },
      ],
    }));

    const routing = await resolveGpuTaskRouting();
    expect(routing.preferredAgentId).toBe('agent_gpu1');
  });

  it('uses another healthy cluster node when GPU1 and the selected node are unavailable', async () => {
    setPreferredGpuNodeId('GPU2');
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'unavailable' },
        { id: 'agent_gpu3', agent_id: 'agent_gpu3', name: 'GPU3', status: 'online', tasks: 1, max_concurrent: 2 },
      ],
    }));

    const routing = await resolveGpuTaskRouting();
    expect(routing.preferredAgentId).toBe('agent_gpu3');
  });

  it('selects the least-loaded healthy node when no preferred node is available', () => {
    const selected = selectGpuTaskNode([
      { id: 'gpu3', nodeId: 'gpu3', name: 'GPU3', status: 'online', tasks: 2, maxConcurrent: 2 },
      { id: 'gpu4', nodeId: 'gpu4', name: 'GPU4', status: 'online', tasks: 1, maxConcurrent: 4 },
      { id: 'gpu5', nodeId: 'gpu5', name: 'GPU5', status: 'offline', tasks: 0, maxConcurrent: 4 },
    ], 'missing-node');

    expect(selected?.name).toBe('GPU4');
  });

  it('automatically selects live capacity without using or announcing a stale GPU1 preference', async () => {
    setPreferredGpuNodeId('GPU1');
    const infoSpy = vi.spyOn(crmMessage, 'info').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'unavailable' },
        { id: 'agent_local', agent_id: 'agent_local', name: '本地处理节点', status: 'online', tasks: 0, max_concurrent: 2 },
      ],
    }));

    const routing = await resolveGpuTaskRouting(undefined, { automatic: true });

    expect(routing.preferredAgentId).toBe('agent_local');
    expect(routing.node?.name).toBe('本地处理节点');
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it('skips a preferred node that has reached its concurrency limit', () => {
    const selected = selectGpuTaskNode([
      { id: 'gpu2', nodeId: 'gpu2', name: 'GPU2', status: 'online', tasks: 2, maxConcurrent: 2 },
      { id: 'gpu1', nodeId: 'gpu1', name: 'GPU1', status: 'online', tasks: 0, maxConcurrent: 1 },
      { id: 'gpu3', nodeId: 'gpu3', name: 'GPU3', status: 'online', tasks: 0, maxConcurrent: 4 },
    ], 'GPU2');

    expect(selected?.name).toBe('GPU1');
  });

  it('keeps an all-busy online cluster available as a server queue target', async () => {
    const infoSpy = vi.spyOn(crmMessage, 'info').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'busy', tasks: 1, max_concurrent: 1 },
      ],
    }));

    const routing = await resolveGpuTaskRouting(undefined, { automatic: true });

    expect(routing.preferredAgentId).toBe('agent_gpu2');
    expect(routing.node?.status).toBe('busy');
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('已进入服务端队列等待'));
    infoSpy.mockRestore();
  });

  it('keeps a strict preferred node even when it is already busy', async () => {
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'busy', tasks: 1, max_concurrent: 1 },
        { id: 'agent_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'online', tasks: 0, max_concurrent: 1 },
      ],
    }));

    const routing = await resolveGpuTaskRouting('agent_gpu2', { strict: true });
    expect(routing.preferredAgentId).toBe('agent_gpu2');
  });

  it('fails only when the whole cluster has no usable nodes', async () => {
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'agent_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'offline' },
        { id: 'agent_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'unavailable' },
      ],
    }));

    await expect(resolveGpuTaskRouting()).rejects.toThrow('没有可用节点');
  });
});
