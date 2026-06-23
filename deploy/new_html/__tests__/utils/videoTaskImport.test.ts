import { describe, expect, it } from 'vitest';
import { buildVideoTaskImport } from '../../utils/videoTaskImport';

describe('buildVideoTaskImport', () => {
  it('converts project video tasks into workspace images, groups, and prompts', () => {
    let t = 1000;
    const result = buildVideoTaskImport([
      {
        image_url: '/uploads/shot.png',
        storyboard_id: 'sb_1',
        scene: 'living-room',
        video_prompt: 'camera pans right',
      },
    ], {
      normalizeUrl: url => `secure:${url}`,
      now: () => t++,
      random: () => 0.123456789,
    });

    expect(result.skipped).toEqual([]);
    expect(result.images).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^img_1000_0_/),
        url: 'secure:/uploads/shot.png',
        filename: 'living-room_sb_1.png',
        uploadTime: 1000,
      }),
    ]);
    expect(result.groups).toEqual([
      expect.objectContaining({
        uuid: expect.stringMatching(/^task_1001_/),
        ids: [result.images[0].id],
        model: 'HappyHorse',
        createdAt: 1001,
      }),
    ]);
    expect(result.prompts[result.images[0].id]).toBe('camera pans right');
  });

  it('skips tasks without a usable image url', () => {
    const result = buildVideoTaskImport([
      { storyboard_id: 'sb_missing', image_url: '', video_prompt: 'unused' },
    ], {
      normalizeUrl: () => '',
      now: () => 1,
      random: () => 0.5,
    });

    expect(result.images).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
    expect(result.prompts).toEqual({});
    expect(result.skipped).toEqual([
      { storyboardId: 'sb_missing', reason: 'missing_image_url' },
    ]);
  });
});
