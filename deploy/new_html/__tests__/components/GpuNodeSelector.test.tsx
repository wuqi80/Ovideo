import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GpuNodeSelector } from '../../components/GpuNodeSelector';

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

describe('GpuNodeSelector', () => {
  it('shows a neutral node name while emitting the real routing ids', async () => {
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'row_gpu1', node_id: 'node_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'online' },
        { id: 'row_gpu2', node_id: 'node_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'online' },
      ],
    }));
    const onChange = vi.fn();

    render(<GpuNodeSelector onSelectionChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      name: '处理节点1',
      preferredAgentId: 'agent_gpu1',
      preferredNodeId: 'node_gpu1',
      usable: true,
    })));

    fireEvent.change(screen.getByLabelText('处理集群节点'), { target: { value: 'row_gpu2' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      name: '处理节点2',
      preferredAgentId: 'agent_gpu2',
      preferredNodeId: 'node_gpu2',
    }));
    expect(localStorage.getItem('mecha:preferred-gpu-node-id')).toBe('agent_gpu2');
  });

  it('marks an explicitly selected offline processing node as unavailable', async () => {
    localStorage.setItem('mecha:preferred-gpu-node-id', 'GPU2');
    mockFetch.mockResolvedValueOnce(response({
      success: true,
      nodes: [
        { id: 'row_gpu1', agent_id: 'agent_gpu1', name: 'GPU1', status: 'online' },
        { id: 'row_gpu2', agent_id: 'agent_gpu2', name: 'GPU2', status: 'offline' },
      ],
    }));
    const onChange = vi.fn();

    render(<GpuNodeSelector onSelectionChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      name: '处理节点2',
      usable: false,
    })));
    expect(screen.getByText(/处理节点2 当前不可用/)).toBeTruthy();
    expect(screen.queryByText(/GPU|ComfyUI/i)).toBeNull();
  });
});
