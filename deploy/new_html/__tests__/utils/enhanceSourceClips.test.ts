import { describe, expect, it } from 'vitest';
import {
  buildEnhanceSourceClips,
  withEntityFileVideoFallbacks,
} from '../../utils/enhanceSourceClips';

describe('enhanceSourceClips', () => {
  it('uses entity-file video fallbacks for segments whose legacy videoUrl is missing', () => {
    const segments = withEntityFileVideoFallbacks([
      {
        segmentId: 'seg_1',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_1',
        sortOrder: 0,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'completed',
        durationMs: 5000,
        videoUrl: null,
        thumbnailUrl: null,
      },
    ], {
      seg_1: '/api/files/file_gpu2_video/download',
    });

    expect(segments[0].videoUrl).toBe('/api/files/file_gpu2_video/download');
  });

  it('prefers entity-file video URLs over stale legacy segment URLs for display', () => {
    const segments = withEntityFileVideoFallbacks([
      {
        segmentId: 'seg_2',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_2',
        sortOrder: 0,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'completed',
        durationMs: 5000,
        videoUrl: '/storage/missing-old-video.mp4',
        thumbnailUrl: null,
      },
    ], {
      seg_2: '/api/files/file_latest_video/download',
    });

    expect(segments[0].videoUrl).toBe('/api/files/file_latest_video/download');
  });

  it('does not add empty video clips to the beautify timeline', () => {
    const clips = buildEnhanceSourceClips([
      {
        segmentId: 'seg_empty',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_empty',
        sortOrder: 0,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'pending',
        durationMs: 5000,
        videoUrl: null,
        thumbnailUrl: null,
      },
      {
        segmentId: 'seg_video',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_video',
        sortOrder: 1,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'completed',
        durationMs: 5000,
        videoUrl: '/api/files/file_video/download',
        thumbnailUrl: null,
      },
    ], [], []);

    expect(clips.filter(clip => clip.type === 'video')).toEqual([
      expect.objectContaining({
        id: 'seg_video',
        url: '/api/files/file_video/download',
        startTime: 5,
      }),
    ]);
  });
});
