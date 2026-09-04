import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByTestId('seedance15-control-row')).toHaveClass('flex-wrap');
    expect(screen.getByLabelText('Seedance 1.5 画面比例').closest('label')).toHaveClass('rounded-full');
    expect(Array.from((screen.getByLabelText('Seedance 1.5 清晰度') as HTMLSelectElement).options).map(option => option.value)).toEqual(['720p', '1080p']);
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

    const durationSummary = screen.getByLabelText('Seedance 1.5 Pro 时长设置');
    expect(durationSummary.closest('details')).not.toHaveAttribute('open');
    const slider = screen.getByRole('slider', { name: 'Seedance 1.5 Pro 视频时长' });
    expect(slider).toHaveAttribute('min', '3');
    expect(slider).toHaveAttribute('max', '12');
    expect(screen.getByText('3–12 秒')).toBeInTheDocument();
  });
});

describe('Seedance 2.0 Jimeng-style controls', () => {
  it('shows all-reference and first/last-frame modes with explicit reference guidance', () => {
    const onChange = vi.fn();
    render(
      <SeedanceMultimodalPanel
        value={{
          ...agentPlanValue,
          sub_model: 'standard',
          media_inputs: [{ kind: 'image', url: '/reference.png', role: 'reference_image' }],
        }}
        onChange={onChange}
        candidates={[]}
        supportsMultimodal
      />,
    );

    expect(screen.getByTestId('seedance-jimeng-composer')).toBeInTheDocument();
    expect(screen.getAllByText(/最多输入 15 个参考素材/).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/输入文字描述，或输入 @ 选择参考内容/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '全能参考' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '首尾帧' })).toBeInTheDocument();
    expect(screen.getByTestId('seedance-jimeng-composer')).toHaveClass('h-full');
    expect(screen.queryByTestId('seedance-output-selectors')).not.toBeInTheDocument();
    expect(screen.getByTestId('seedance-control-row')).toHaveClass('flex-wrap');

    const ratioSelect = screen.getByLabelText('选择比例') as HTMLSelectElement;
    expect(Array.from(ratioSelect.options).map(option => option.value)).toEqual([
      'adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9',
    ]);
    const resolutionSelect = screen.getByLabelText('选择清晰度') as HTMLSelectElement;
    expect(Array.from(resolutionSelect.options).map(option => option.value)).toEqual([
      '480p', '720p', '1080p',
    ]);
    expect(ratioSelect.closest('label')).toHaveClass('rounded-full');
    expect(resolutionSelect.closest('label')).toHaveClass('rounded-full');

    fireEvent.change(screen.getByLabelText('Seedance 生成模式'), { target: { value: 'first_last' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      media_inputs: [expect.objectContaining({ role: 'first_frame' })],
    }));
  });
});
