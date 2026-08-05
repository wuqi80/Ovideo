import { describe, expect, it } from 'vitest';

import type { TaskGroup } from '../../services/videoTaskTypes';
import {
  buildDownwardMergePlan,
  canCreateFirstLastPair,
  canMergeAdjacentGroups,
} from '../../utils/videoTaskMerge';

const group = (
  uuid: string,
  model: TaskGroup['model'],
  ids = [uuid],
  duration = 5,
): TaskGroup => ({ uuid, model, ids, duration });

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

  it('plans a continuous downward merge inside the same script segment', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 3),
      group('b', 'Seedance2', ['b'], 4),
      group('c', 'Seedance2', ['c'], 5),
      group('d', 'Seedance2', ['d'], 5),
    ];
    const segments: Record<string, string> = {
      a: 'segment-1',
      b: 'segment-1',
      c: 'segment-1',
      d: 'segment-2',
    };

    const plan = buildDownwardMergePlan(groups, 0, {
      isMergeableModel: model => model === 'Seedance2',
      getSegmentKey: item => segments[item.uuid],
      getDurationSeconds: item => item.duration,
      maxDurationSeconds: 15,
    });

    expect(plan.canMerge).toBe(true);
    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b', 'c']);
    expect(plan.totalDuration).toBe(12);
  });

  it('blocks the whole segment merge when the merged duration exceeds the limit', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 6),
      group('b', 'Seedance2', ['b'], 6),
      group('c', 'Seedance2', ['c'], 4),
    ];

    const plan = buildDownwardMergePlan(groups, 0, {
      isMergeableModel: model => model === 'Seedance2',
      getSegmentKey: () => 'segment-1',
      getDurationSeconds: item => item.duration,
      maxDurationSeconds: 15,
    });

    expect(plan.hasDownwardTarget).toBe(true);
    expect(plan.canMerge).toBe(false);
    expect(plan.blockedReason).toBe('duration_exceeded');
    expect(plan.totalDuration).toBe(16);
  });

  it('does not merge script cards across a known segment boundary', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 5),
      group('b', 'Seedance2', ['b'], 5),
    ];

    const plan = buildDownwardMergePlan(groups, 0, {
      isMergeableModel: model => model === 'Seedance2',
      getSegmentKey: item => item.uuid === 'a' ? 'segment-1' : 'segment-2',
      getDurationSeconds: item => item.duration,
      maxDurationSeconds: 15,
    });

    expect(plan.hasDownwardTarget).toBe(false);
    expect(plan.canMerge).toBe(false);
    expect(plan.groups.map(item => item.uuid)).toEqual(['a']);
  });
});
