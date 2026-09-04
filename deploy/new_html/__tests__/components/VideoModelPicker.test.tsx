import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VideoModelPicker } from '../../components/video/VideoModelPicker';
import type { VideoModelOption } from '../../services/videoModelService';

const options: VideoModelOption[] = [
  {
    value: 'MINI',
    label: 'MiniMax Hailuo 2.3 · 首尾帧标准视频模型',
    baseLabel: 'MiniMax Hailuo 2.3',
    runtimeLabel: 'MiniMax-Hailuo-2.3',
    available: true,
    provider: 'minimax',
  },
  {
    value: 'MiniMaxH3',
    label: 'MiniMax H3 · 本地节点模型',
    baseLabel: 'MiniMax H3',
    runtimeLabel: 'MiniMax H3',
    available: false,
    unavailableReason: '处理节点离线',
    provider: 'processing_cluster',
  },
];

describe('VideoModelPicker', () => {
  it('uses a compact Jimeng-style picker and keeps unavailable models visible with their reason', () => {
    const onChange = vi.fn();
    render(<VideoModelPicker value="MINI" options={options} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /MiniMax Hailuo 2.3/ }));
    const modelRows = screen.getAllByRole('option');
    expect(modelRows).toHaveLength(2);
    expect(modelRows[0]).toHaveTextContent('MiniMax Hailuo 2.3');
    expect(modelRows[1]).toHaveTextContent('本地节点');
    expect(modelRows[1]).toHaveTextContent('不可用');
    expect(modelRows[1]).toHaveTextContent('处理节点离线');
    expect(modelRows[1]).toHaveAttribute('aria-disabled', 'true');
    expect(modelRows[1]).toHaveAttribute('title', '处理节点离线');
    fireEvent.click(modelRows[1]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
