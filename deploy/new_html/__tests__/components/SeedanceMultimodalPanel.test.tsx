import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useScriptModelOptions', () => ({
  useScriptModelOptions: () => [],
}));

import { SeedanceMultimodalPanel } from '../../components/SeedanceMultimodalPanel';
import { CardDurationField } from '../../components/video/CardDurationField';
import type { SeedanceParams } from '../../services/videoModelService';

const agentPlanValue: SeedanceParams = {
  sub_model: 'agent_plan',
  prompt: '人物缓慢转身，镜头平稳推进',
  media_inputs: [
    { kind: 'image', url: '/first.png', role: 'first_frame' },
    { kind: 'audio', url: '/reference.mp3', role: 'reference_audio' },
  ],
  resolution: '720p',
  ratio: '16:9',
  duration: 5,
  seed: -1,
  watermark: false,
  generate_audio: true,
  camera_fixed: false,
};

describe('Seedance 1.5 Pro controls', () => {
  it('uses dedicated first/last-frame UI and retains reference dubbing without the 2.0 warning', () => {
    render(
      <SeedanceMultimodalPanel
        value={agentPlanValue}
        onChange={vi.fn()}
        candidates={[]}
        supportsMultimodal={false}
        audioReferenceNotice="参考配音会保留在卡片中，提交时不发送。"
      />,
    );

    expect(screen.getByText('Seedance 1.5 Pro · 首尾帧生成')).toBeInTheDocument();
    expect(screen.getByTitle('添加尾帧')).toBeInTheDocument();
    expect(screen.getByText('参考配音')).toBeInTheDocument();
    expect(screen.getAllByText('reference.mp3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/图片 .*\/9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Seedance 2\.0 不支持直接上传/)).not.toBeInTheDocument();
  });

  it('renders a bounded 3–12 second slider for Seedance 1.5 Pro', () => {
    render(
      <CardDurationField
        duration={5}
        userOverride={false}
        onChange={vi.fn()}
        onClear={vi.fn()}
        maxDuration={12}
        variant="seedance15"
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Seedance 1.5 Pro 视频时长' });
    expect(slider).toHaveAttribute('min', '3');
    expect(slider).toHaveAttribute('max', '12');
    expect(screen.getByText('3–12 秒')).toBeInTheDocument();
  });
});
