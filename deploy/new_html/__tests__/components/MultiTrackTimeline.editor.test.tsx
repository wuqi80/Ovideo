import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateAudioTrack } = vi.hoisted(() => ({
  updateAudioTrack: vi.fn(),
}));

vi.mock('../../services/audioGenerationService', () => ({
  updateAudioTrack,
}));
vi.mock('../../components/audio/MusicModal', () => ({
  MusicModal: () => null,
}));
vi.mock('../../components/audio/SfxModal', () => ({
  SfxModal: () => null,
}));

import { MultiTrackTimeline } from '../../components/audio/MultiTrackTimeline';

describe('MultiTrackTimeline editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateAudioTrack.mockResolvedValue({ success: true });
  });

  it('shows clip editing controls and persists BGM fades', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(
      <MultiTrackTimeline
        storyboardItems={[
          {
            itemId: 'shot_1',
            sortOrder: 1,
            plannedDurationMs: 10_000,
          } as any,
        ]}
        clips={[]}
        localAudio={{}}
        audioTracks={[
          {
            trackId: 'bgm_1',
            episodeId: 'ep_1',
            trackType: 'bgm',
            name: '主题音乐',
            audioUrl: '/storage/audio/theme.mp3',
            durationMs: 10_000,
            startItemId: null,
            endItemId: null,
            generationParams: {},
          },
        ]}
        clipKeyFn={clip => clip.clipId}
        onClickItem={vi.fn()}
        episodeId="ep_1"
        projectId="project_1"
        script=""
        reload={reload}
      />,
    );

    fireEvent.click(screen.getByTitle('主题音乐 · 拖动移动，左右边缘裁剪'));
    const fadeIn = screen.getByLabelText(/淡入/);
    fireEvent.change(fadeIn, { target: { value: '1.2' } });
    fireEvent.blur(fadeIn);

    await waitFor(() => {
      expect(updateAudioTrack).toHaveBeenCalledWith(
        'bgm_1',
        expect.objectContaining({
          generation_params: expect.objectContaining({
            timeline: expect.objectContaining({
              fadeInMs: 1_200,
            }),
          }),
        }),
      );
    });
    expect(reload).toHaveBeenCalled();
  });
});
