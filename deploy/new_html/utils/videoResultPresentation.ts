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
