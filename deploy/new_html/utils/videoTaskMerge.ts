import type { TaskGroup } from '../services/videoTaskTypes';

export function canCreateFirstLastPair(groups: TaskGroup[], index: number): boolean {
  const current = groups[index];
  const next = groups[index + 1];
  return Boolean(
    current
    && next
    && current.model === next.model
    && current.ids.length === 1
    && next.ids.length === 1,
  );
}

export function canMergeAdjacentGroups(
  groups: TaskGroup[],
  index: number,
  isMergeableModel: (model: TaskGroup['model']) => boolean,
): boolean {
  const current = groups[index];
  const next = groups[index + 1];
  return Boolean(current && next && current.model === next.model && isMergeableModel(current.model));
}
