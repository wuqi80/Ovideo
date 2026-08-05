import type { TaskGroup } from '../services/videoTaskTypes';

const normalizeSegmentKey = (key: string | null | undefined): string => String(key || '').trim();

const sameMergeSegment = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const left = normalizeSegmentKey(a);
  const right = normalizeSegmentKey(b);
  if (!left && !right) return true;
  return Boolean(left && right && left === right);
};

const normalizeDuration = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

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

export type DownwardMergeBlockedReason =
  | 'unsupported_model'
  | 'no_downward_target'
  | 'model_mismatch'
  | 'duration_exceeded';

export interface DownwardMergePlan {
  /** 连续向下、属于同一剧本分段的候选卡片，包含当前卡。 */
  groups: TaskGroup[];
  startIndex: number;
  endIndex: number;
  totalDuration: number;
  maxDuration: number;
  hasDownwardTarget: boolean;
  canMerge: boolean;
  blockedReason?: DownwardMergeBlockedReason;
  blockingIndex?: number;
}

export interface BuildDownwardMergePlanOptions {
  isMergeableModel: (model: TaskGroup['model']) => boolean;
  getSegmentKey: (group: TaskGroup) => string | null | undefined;
  getDurationSeconds: (group: TaskGroup) => number | null | undefined;
  maxDurationSeconds: number;
}

/**
 * Builds the "merge downward within one script segment" plan for video cards.
 *
 * A segment key is considered safe to merge only when both cards share the same
 * non-empty key; manual/upload-only cards with no segment key may still merge
 * with adjacent no-key cards. This prevents a script-generated card from
 * accidentally absorbing the next script segment.
 */
export function buildDownwardMergePlan(
  groups: TaskGroup[],
  index: number,
  options: BuildDownwardMergePlanOptions,
): DownwardMergePlan {
  const current = groups[index];
  const maxDuration = normalizeDuration(options.maxDurationSeconds);
  const base: DownwardMergePlan = {
    groups: current ? [current] : [],
    startIndex: index,
    endIndex: index,
    totalDuration: current ? normalizeDuration(options.getDurationSeconds(current)) : 0,
    maxDuration,
    hasDownwardTarget: false,
    canMerge: false,
    blockedReason: 'no_downward_target',
  };
  if (!current) return base;
  if (!options.isMergeableModel(current.model)) {
    return { ...base, blockedReason: 'unsupported_model' };
  }

  const segmentKey = options.getSegmentKey(current);
  const candidateGroups: TaskGroup[] = [current];
  let totalDuration = normalizeDuration(options.getDurationSeconds(current));

  for (let i = index + 1; i < groups.length; i += 1) {
    const next = groups[i];
    if (!next) break;
    if (!sameMergeSegment(segmentKey, options.getSegmentKey(next))) {
      break;
    }
    candidateGroups.push(next);
    totalDuration += normalizeDuration(options.getDurationSeconds(next));

    if (next.model !== current.model || !options.isMergeableModel(next.model)) {
      return {
        groups: candidateGroups,
        startIndex: index,
        endIndex: i,
        totalDuration,
        maxDuration,
        hasDownwardTarget: candidateGroups.length > 1,
        canMerge: false,
        blockedReason: next.model !== current.model ? 'model_mismatch' : 'unsupported_model',
        blockingIndex: i,
      };
    }
  }

  if (candidateGroups.length <= 1) {
    return base;
  }
  if (maxDuration > 0 && totalDuration > maxDuration) {
    return {
      groups: candidateGroups,
      startIndex: index,
      endIndex: index + candidateGroups.length - 1,
      totalDuration,
      maxDuration,
      hasDownwardTarget: true,
      canMerge: false,
      blockedReason: 'duration_exceeded',
    };
  }

  return {
    groups: candidateGroups,
    startIndex: index,
    endIndex: index + candidateGroups.length - 1,
    totalDuration,
    maxDuration,
    hasDownwardTarget: true,
    canMerge: true,
  };
}
