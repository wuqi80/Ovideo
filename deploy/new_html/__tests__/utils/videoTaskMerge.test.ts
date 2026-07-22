import { describe, expect, it } from 'vitest';

import type { TaskGroup } from '../../services/videoTaskTypes';
import { canCreateFirstLastPair, canMergeAdjacentGroups } from '../../utils/videoTaskMerge';

const group = (uuid: string, model: TaskGroup['model'], ids = [uuid]): TaskGroup => ({ uuid, model, ids });

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
});
