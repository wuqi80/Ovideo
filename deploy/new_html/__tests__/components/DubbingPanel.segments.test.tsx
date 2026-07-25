import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/audio/DubbingCard', () => ({
  DubbingCard: () => <div data-testid="dubbing-card" />,
}));

import { DubbingPanel } from '../../components/audio/DubbingPanel';

function item(
  itemId: string,
  sortOrder: number,
  scriptSegmentId: string,
  plannedDurationMs: number,
) {
  return {
    itemId,
    episodeId: 'episode_1',
    sortOrder,
    scriptSegmentId,
    sceneHeading: '',
    actionText: '',
    dialogue: '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: '',
    generatedImageUrl: null,
    boundAssets: [],
    configuredReferences: [],
    status: 'draft',
    dialogueAudioUrl: null,
    narrationAudioUrl: null,
    sfxAudioUrl: null,
    audioDurationMs: null,
    plannedDurationMs,
  };
}

describe('DubbingPanel storyboard segmentation', () => {
  it('shows segment headings and restarts the visible shot number per segment', () => {
    render(
      <DubbingPanel
        storyboardItems={[
          item('shot_1', 1, 'segment_1', 8_000),
          item('shot_2', 2, 'segment_1', 7_000),
          item('shot_3', 3, 'segment_2', 6_000),
        ]}
        clips={[]}
        voiceMap={new Map()}
        charAssetMap={new Map()}
        localOverrides={{}}
        setLocalOverrides={vi.fn()}
        localAudio={{}}
        generatingIds={new Set()}
        errors={{}}
        playingKey=""
        onGenerate={vi.fn()}
        onTogglePlay={vi.fn()}
        onBatchGenerate={vi.fn()}
        batchRunning={false}
        allCharNames={[]}
        clipKeyFn={clip => clip.clipId}
      />,
    );

    expect(screen.getByText('分段1')).toBeInTheDocument();
    expect(screen.getByText('分段2')).toBeInTheDocument();
    expect(screen.getByText('镜头1-1')).toBeInTheDocument();
    expect(screen.getByText('镜头1-2')).toBeInTheDocument();
    expect(screen.getByText('镜头2-1')).toBeInTheDocument();
    expect(screen.queryByText('#3')).not.toBeInTheDocument();
  });
});
