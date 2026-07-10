import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineTrack } from '../../components/TimelineTrack';

describe('TimelineTrack audio actions', () => {
  it('shows BGM and sound-effect actions even before audio clips exist', () => {
    const onAddBgm = vi.fn();
    const onGenerateBgm = vi.fn();
    const onAddSfx = vi.fn();
    const onGenerateSfx = vi.fn();

    render(
      <TimelineTrack
        mode="combined"
        clips={[
          {
            id: 'image-1',
            label: '镜头 1',
            track: 'image',
            durationMs: 3000,
            startMs: 0,
          },
        ]}
        totalDurationMs={3000}
        onAddBgm={onAddBgm}
        onGenerateBgm={onGenerateBgm}
        onAddSfx={onAddSfx}
        onGenerateSfx={onGenerateSfx}
      />,
    );

    expect(screen.getByText('BGM')).toBeInTheDocument();
    expect(screen.getByText('音效')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('添加本地 BGM'));
    fireEvent.click(screen.getByTitle('AI 音乐制作'));
    fireEvent.click(screen.getByTitle('添加本地音效'));
    fireEvent.click(screen.getByTitle('AI 音效制作'));

    expect(onAddBgm).toHaveBeenCalledOnce();
    expect(onGenerateBgm).toHaveBeenCalledOnce();
    expect(onAddSfx).toHaveBeenCalledOnce();
    expect(onGenerateSfx).toHaveBeenCalledOnce();
  });
});
