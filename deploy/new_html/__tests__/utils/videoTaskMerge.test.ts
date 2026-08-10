import { describe, expect, it } from 'vitest';

import type { MergedCardSnapshot, TaskGroup } from '../../services/videoTaskTypes';
import {
  buildDownwardMergePlan,
  buildVideoStoryboardShotLookup,
  canCreateFirstLastPair,
  canMergeAdjacentGroups,
  partitionMergedSnapshots,
} from '../../utils/videoTaskMerge';

const group = (
  uuid: string,
  model: TaskGroup['model'],
  ids = [uuid],
  duration = 5,
): TaskGroup => ({ uuid, model, ids, duration });

const mergeOptions = (
  segments: Record<string, string>,
  selectedEndIndex?: number,
) => ({
  isMergeableModel: (model: TaskGroup['model']) => model === 'Seedance2',
  getSegmentKey: (item: TaskGroup) => segments[item.uuid],
  getDurationSeconds: (item: TaskGroup) => item.duration,
  maxDurationSeconds: 15,
  maxImages: 9,
  selectedEndIndex,
});

describe('video storyboard shot labels', () => {
  it('numbers shots locally inside ordered script segments for snake and camel case rows', () => {
    const lookup = buildVideoStoryboardShotLookup([
      { item_id: 'b', sort_order: 2, script_segment_id: 'segment-a' },
      { itemId: 'a', sortOrder: 1, scriptSegmentId: 'segment-a' },
      { item_id: 'c', sort_order: 3, script_segment_id: 'segment-b' },
    ]);

    expect(lookup.get('a')).toMatchObject({ label: '镜头1-1', isFirstInSegment: true });
    expect(lookup.get('b')).toMatchObject({ label: '镜头1-2', isFirstInSegment: false });
    expect(lookup.get('c')).toMatchObject({ label: '镜头2-1', isFirstInSegment: true });
  });

  it('preserves explicit hierarchical segment numbers for legacy rows', () => {
    const lookup = buildVideoStoryboardShotLookup([
      { item_id: 'a', sort_order: 1, source_video_shot_no: '分镜2-7' },
      { item_id: 'b', sort_order: 2, source_video_shot_no: '分镜2-8' },
    ]);

    expect(lookup.get('a')?.label).toBe('镜头2-1');
    expect(lookup.get('b')?.label).toBe('镜头2-2');
  });
});

describe('video task merge eligibility', () => {
  it('creates first/last pairs only from adjacent single-image cards of the same model', () => {
    expect(canCreateFirstLastPair([group('a', 'Seedance2'), group('b', 'Seedance2')], 0)).toBe(true);
    expect(canCreateFirstLastPair([group('a', 'Seedance2'), group('b', 'MINI')], 0)).toBe(false);
    expect(canCreateFirstLastPair([group('a', 'Seedance2', ['a', 'b']), group('c', 'Seedance2')], 0)).toBe(false);
  });

  it('allows repeated content merges while the next model remains compatible', () => {
    const groups = [
      { ...group('a', 'Seedance2', ['a', 'b']), mergedFrom: [] },
      group('c', 'Seedance2'),
      group('d', 'MINI'),
    ];
    const supportsMerge = (model: TaskGroup['model']) => model === 'Seedance2';
    expect(canMergeAdjacentGroups(groups, 0, supportsMerge)).toBe(true);
    expect(canMergeAdjacentGroups(groups, 1, supportsMerge)).toBe(false);
  });

  it('recommends the furthest continuous range that remains within 15 seconds', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 3),
      group('b', 'Seedance2', ['b'], 4),
      group('c', 'Seedance2', ['c'], 5),
      group('d', 'Seedance2', ['d'], 5),
    ];
    const plan = buildDownwardMergePlan(groups, 0, mergeOptions({
      a: 'segment-1', b: 'segment-1', c: 'segment-1', d: 'segment-2',
    }));

    expect(plan.canMerge).toBe(true);
    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b', 'c']);
    expect(plan.availableGroups.map(item => item.uuid)).toEqual(['a', 'b', 'c', 'd']);
    expect(plan.totalDuration).toBe(12);
    expect(plan.crossesSegment).toBe(false);
  });

  it('allows an explicitly selected over-duration range and reports the warning', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 6),
      group('b', 'Seedance2', ['b'], 6),
      group('c', 'Seedance2', ['c'], 4),
    ];
    const plan = buildDownwardMergePlan(
      groups,
      0,
      mergeOptions({ a: 'segment-1', b: 'segment-1', c: 'segment-1' }, 2),
    );

    expect(plan.canMerge).toBe(true);
    expect(plan.exceedsDuration).toBe(true);
    expect(plan.totalDuration).toBe(16);
  });

  it('allows a cross-segment range and reports the warning', () => {
    const groups = [group('a', 'Seedance2', ['a'], 5), group('b', 'Seedance2', ['b'], 5)];
    const plan = buildDownwardMergePlan(
      groups,
      0,
      mergeOptions({ a: 'segment-1', b: 'segment-2' }, 1),
    );

    expect(plan.canMerge).toBe(true);
    expect(plan.crossesSegment).toBe(true);
  });

  it('recommends the next segment when it brings a short range closer to 15 seconds', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 4),
      group('b', 'Seedance2', ['b'], 4),
      group('c', 'Seedance2', ['c'], 4),
      group('d', 'Seedance2', ['d'], 4),
    ];
    const plan = buildDownwardMergePlan(groups, 0, mergeOptions({
      a: 'segment-1', b: 'segment-1', c: 'segment-2', d: 'segment-2',
    }));

    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b', 'c']);
    expect(plan.totalDuration).toBe(12);
    expect(plan.crossesSegment).toBe(true);
  });

  it('stops before a range would exceed nine images', () => {
    const groups = [
      group('a', 'Seedance2', ['1', '2', '3', '4', '5'], 5),
      group('b', 'Seedance2', ['6', '7', '8', '9'], 5),
      group('c', 'Seedance2', ['10'], 5),
    ];
    const plan = buildDownwardMergePlan(groups, 0, mergeOptions({
      a: 'segment-1', b: 'segment-1', c: 'segment-1',
    }));

    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b']);
    expect(plan.imageCount).toBe(9);
    expect(plan.hardStopReason).toBe('image_limit');
    expect(plan.blockingIndex).toBe(2);
  });
});

describe('merged card reverse operation', () => {
  const snapshots = ['a', 'b', 'c'].map(uuid => ({
    uuid,
    ids: [uuid],
    model: 'Seedance2' as const,
    prompt: uuid,
  })) satisfies MergedCardSnapshot[];

  it('partitions a middle child into contiguous before, removed, and after ranges', () => {
    expect(partitionMergedSnapshots(snapshots, 1)).toEqual({
      before: [snapshots[0]],
      removed: snapshots[1],
      after: [snapshots[2]],
    });
  });
});
