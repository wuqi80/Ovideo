import type { TaskStatus } from '../services/videoTaskTypes';

/**
 * A failed retry must not hide a video produced by an earlier successful run.
 * Task state describes the latest attempt; videos are the persisted result history.
 */
export function hasStoredVideoResult(
  status: TaskStatus | null | undefined,
): boolean {
  return (status?.videos || []).some(
    videoUrl => typeof videoUrl === 'string' && videoUrl.trim().length > 0,
  );
}

export function normalizeVideoResultKey(value: unknown): unknown {
  return typeof value === 'string'
    ? value.split('?')[0].replace(/^https?:\/\/[^/]+/, '')
    : value;
}

export function mergeStoredVideoResult(
  status: TaskStatus | null | undefined,
  videoUrl: string,
): TaskStatus {
  const url = typeof videoUrl === 'string' ? videoUrl.trim() : '';
  const current = status || {};
  if (!url) return current;

  const currentVideos = current.videos || [];
  if (currentVideos.some(video => normalizeVideoResultKey(video) === normalizeVideoResultKey(url))) {
    return current;
  }

  const shouldMarkDone = !current.state || current.state === 'idle' || current.state === 'done';
  return {
    ...current,
    ...(shouldMarkDone ? { state: 'done' as const, progress: 100 } : {}),
    videos: [...currentVideos, url],
    result: current.result || url,
    keepResult: true,
  };
}
