import { describe, expect, it } from 'vitest';
import { reconcileActiveVideoTasks } from '../../services/videoTaskReconciliation';
import type { TaskGroup, VideoTask } from '../../services/videoTaskTypes';

const groups: TaskGroup[] = [
  { uuid: 'group-1', ids: ['storyboard-1'], model: 'MiniMaxH3' },
  { uuid: 'group-2', ids: ['storyboard-2'], model: 'Wan2' },
];

function task(overrides: Partial<VideoTask>): VideoTask {
  return {
    task_id: 'task-default',
    task_type: 'i2v',
    status: 'processing',
    created_at: '2026-08-19T08:30:00+08:00',
    data: {},
    ...overrides,
  };
}

describe('video task reconciliation', () => {
  it('replaces a stale failed card with the matching live workspace task', () => {
    const result = reconcileActiveVideoTasks(groups, {
      'group-1': { state: 'failed', taskId: 'old-failed', error: 'old error', videos: ['/old.mp4'] },
    }, [task({
      task_id: 'live-task',
      progress: 74,
      data: { workspace_group_id: 'group-1', model: 'MiniMaxH3', episode_id: 'ep-1' },
    })], {}, 'ep-1');

    expect(result.statuses['group-1']).toMatchObject({
      state: 'processing',
      taskId: 'live-task',
      progress: 74,
      pendingVideoModel: 'MiniMaxH3',
      videos: ['/old.mp4'],
    });
    expect(result.statuses['group-1'].error).toBeUndefined();
    expect(result.resumable).toEqual([{ uuid: 'group-1', taskId: 'live-task' }]);
  });

  it('recovers an older task through its video segment entity id', () => {
    const result = reconcileActiveVideoTasks(groups, {}, [task({
      task_id: 'legacy-live-task',
      status: 'queued',
      data: { entity_id: 'segment-2', model: 'Wan2' },
    })], { 'group-2': 'segment-2' });

    expect(result.statuses['group-2']).toMatchObject({
      state: 'pending',
      taskId: 'legacy-live-task',
      pendingVideoModel: 'Wan2',
    });
  });

  it('uses the newest live task and ignores completed history', () => {
    const result = reconcileActiveVideoTasks(groups, {}, [
      task({ task_id: 'older', created_at: '2026-08-19T08:00:00+08:00', data: { workspace_group_id: 'group-1' } }),
      task({ task_id: 'completed', status: 'completed', created_at: '2026-08-19T08:20:00+08:00', data: { workspace_group_id: 'group-1' } }),
      task({ task_id: 'newer', created_at: '2026-08-19T08:35:00+08:00', data: { workspace_group_id: 'group-1' } }),
    ]);

    expect(result.statuses['group-1'].taskId).toBe('newer');
    expect(result.resumable).toEqual([{ uuid: 'group-1', taskId: 'newer' }]);
  });

  it('turns a stale failure into a completed card and restores its result', () => {
    const result = reconcileActiveVideoTasks(groups, {
      'group-1': { state: 'failed', taskId: 'old-failed', error: 'old error' },
    }, [task({
      task_id: 'completed-new',
      status: 'completed',
      progress: 100,
      data: { workspace_group_id: 'group-1', model: 'MiniMaxH3' },
      result: { videos: [{ url: '/uploads/result.mp4', generateTime: 42 }] },
    })], {}, undefined, url => `https://spti.ai${url}`);

    expect(result.statuses['group-1']).toMatchObject({
      state: 'done',
      taskId: 'completed-new',
      progress: 100,
      result: 'https://spti.ai/uploads/result.mp4',
      videos: ['https://spti.ai/uploads/result.mp4'],
      videoGenerateTimes: [42],
      videoModels: ['MiniMaxH3'],
    });
    expect(result.statuses['group-1'].error).toBeUndefined();
    expect(result.resumable).toEqual([]);
  });

  it('does not attach a task from another episode', () => {
    const result = reconcileActiveVideoTasks(groups, {}, [task({
      task_id: 'wrong-episode',
      data: { workspace_group_id: 'group-1', episode_id: 'ep-other' },
    })], {}, 'ep-current');

    expect(result.resumable).toEqual([]);
    expect(result.statuses).toEqual({});
  });
});
