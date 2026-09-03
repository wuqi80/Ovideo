import { describe, expect, it } from 'vitest';
import type { EnhanceMediaClip } from '../../utils/enhanceSourceClips';
import {
  composeTimelineItems,
  deleteTimelineClip,
  duplicateTimelineClip,
  formatTimelineTime,
  moveTimelineClip,
  resolveTimelineSnap,
  restoreEnhanceTimeline,
  serializeEnhanceTimeline,
  splitTimelineClip,
  trimTimelineClip,
} from '../../utils/enhanceTimelineEditor';

function video(id: string, startTime: number, duration: number): EnhanceMediaClip {
  return {
    id,
    sourceId: id,
    url: `/${id}.mp4`,
    startTime,
    duration,
    sourceDuration: duration,
    sourceOffset: 0,
    type: 'video',
    settings: { upscale: false, interpolate: false, lipSync: false },
  };
}

describe('enhance timeline editor', () => {
  it('splits a clip without changing the total video duration', () => {
    const result = splitTimelineClip([video('a', 0, 5), video('b', 5, 4)], 'a', 2, 'a-copy');

    expect(result.filter(clip => clip.type === 'video')).toMatchObject([
      { id: 'a', startTime: 0, duration: 2, sourceOffset: 0 },
      { id: 'a-copy', sourceId: 'a', startTime: 2, duration: 3, sourceOffset: 2 },
      { id: 'b', startTime: 5, duration: 4 },
    ]);
  });

  it('ripple-deletes and reorders the single video lane', () => {
    const clips = [video('a', 0, 2), video('b', 2, 3), video('c', 5, 4)];
    const deleted = deleteTimelineClip(clips, 'b');
    expect(deleted.map(clip => [clip.id, clip.startTime])).toEqual([['a', 0], ['c', 2]]);

    const moved = moveTimelineClip(clips, 'c', 0.1, { ripple: true, snap: false }).clips;
    expect(moved.filter(clip => clip.type === 'video').map(clip => [clip.id, clip.startTime]))
      .toEqual([['a', 4], ['b', 6], ['c', 0]]);
  });

  it('trims source in/out and keeps following video clips contiguous', () => {
    const clips = [video('a', 0, 5), video('b', 5, 4)];
    const left = trimTimelineClip(clips, 'a', 'left', 1);
    expect(left[0]).toMatchObject({ startTime: 0, sourceOffset: 1, duration: 4 });
    expect(left[1].startTime).toBe(4);

    const right = trimTimelineClip(left, 'a', 'right', -1.5);
    expect(right[0].duration).toBe(2.5);
    expect(right[1].startTime).toBe(2.5);
  });

  it('duplicates a source and sends both cuts to composition', () => {
    const duplicated = duplicateTimelineClip([video('a', 0, 5)], 'a', 'a-2');
    expect(composeTimelineItems(duplicated)).toEqual([
      { clip_id: 'a', segment_id: 'a', start_ms: 0, duration_ms: 5000, source_offset_ms: 0 },
      { clip_id: 'a-2', segment_id: 'a', start_ms: 5000, duration_ms: 5000, source_offset_ms: 0 },
    ]);
  });

  it('round-trips persisted cuts and remembers excluded source clips', () => {
    const source = [video('a', 0, 5), video('b', 5, 4), video('c', 9, 2)];
    const edited = splitTimelineClip(deleteTimelineClip(source, 'b'), 'a', 2, 'a-split');
    const saved = serializeEnhanceTimeline(edited, source.map(clip => clip.id));
    const restored = restoreEnhanceTimeline(source, saved);

    expect(restored.filter(clip => clip.type === 'video').map(clip => clip.id)).toEqual(['a', 'a-split', 'c']);
    expect(saved).toContainEqual({ kind: 'excluded_video', sourceId: 'b' });
  });

  it('uses the closest snap point and formats frame timecode', () => {
    expect(resolveTimelineSnap(4.91, [0, 5, 9], 0.2)).toEqual({ time: 5, guide: 5 });
    expect(formatTimelineTime(65.5, 30)).toBe('00:01:05:15');
  });
});
