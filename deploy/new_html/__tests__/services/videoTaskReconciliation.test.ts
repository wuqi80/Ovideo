import { describe, expect, it } from 'vitest';
import { getVideoTaskModel, reconcileActiveVideoTasks } from '../../services/videoTaskReconciliation';
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

  it('uses the newest live task for card state while retaining completed history', () => {
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
    })], {}, undefined, url => `https://tv.ostory.ai${url}`);

    expect(result.statuses['group-1']).toMatchObject({
      state: 'done',
      taskId: 'completed-new',
      progress: 100,
      result: 'https://tv.ostory.ai/uploads/result.mp4',
      videos: ['https://tv.ostory.ai/uploads/result.mp4'],
      videoGenerateTimes: [42],
      videoModels: ['MiniMaxH3'],
    });
    expect(result.statuses['group-1'].error).toBeUndefined();
    expect(result.resumable).toEqual([]);
  });

  it('uses the MiniMax task route as the authoritative model and repairs a legacy Wan label', () => {
    const result = reconcileActiveVideoTasks(groups, {
      'group-2': {
        state: 'done',
        videos: ['/uploads/hailuo.mp4'],
        videoGenerateTimes: [0],
        videoModels: ['Wan2'],
      },
    }, [task({
      task_id: 'legacy-minimax',
      task_type: 'minimax_i2v',
      status: 'completed',
      data: { workspace_group_id: 'group-2', model: 'Wan2' },
      result: { videos: [{ url: '/uploads/hailuo.mp4', generateTime: 36 }] },
    })]);

    expect(result.statuses['group-2'].videoModels).toEqual(['MINI']);
    expect(result.statuses['group-2'].videoGenerateTimes).toEqual([36]);
  });

  it('repairs every historical result by URL instead of only using the newest task model', () => {
    const result = reconcileActiveVideoTasks(groups, {
      'group-2': {
        state: 'done',
        videos: ['/uploads/one.mp4', '/uploads/two.mp4', '/uploads/three.mp4'],
        videoGenerateTimes: [0, 0, 0],
        videoModels: ['Wan2', 'Wan2', 'MINI'],
      },
    }, [
      task({
        task_id: 'hailuo-one',
        task_type: 'minimax_i2v',
        status: 'completed',
        created_at: '2026-08-19T08:10:00+08:00',
        data: { workspace_group_id: 'group-2', model: 'Wan2' },
        result: { videos: [{ url: '/uploads/one.mp4', generateTime: 28 }] },
      }),
      task({
        task_id: 'hailuo-two',
        task_type: 'minimax_i2v',
        status: 'completed',
        created_at: '2026-08-19T08:20:00+08:00',
        data: { workspace_group_id: 'group-2', model: 'Wan2' },
        result: { videos: [{ url: '/uploads/two.mp4', generateTime: 31 }] },
      }),
      task({
        task_id: 'hailuo-three',
        task_type: 'minimax_morph',
        status: 'completed',
        created_at: '2026-08-19T08:30:00+08:00',
        data: { workspace_group_id: 'group-2', model: 'MINI' },
        result: { videos: [{ url: '/uploads/three.mp4', generateTime: 34 }] },
      }),
    ]);

    expect(result.statuses['group-2'].videoModels).toEqual(['MINI', 'MINI', 'MINI']);
    expect(result.statuses['group-2'].videoGenerateTimes).toEqual([28, 31, 34]);
  });

  it('derives API model keys from the executed route and Seedance sub-model', () => {
    expect(getVideoTaskModel(task({ task_type: 'kling_morph' }))).toBe('Kling');
    expect(getVideoTaskModel(task({ task_type: 'vidu_r2v' }))).toBe('Vidu');
    expect(getVideoTaskModel(task({ task_type: 'seedance_i2v', data: { sub_model: 'agent_plan' } }))).toBe('Seedance15');
    expect(getVideoTaskModel(task({ task_type: 'seedance_multi', data: { sub_model: 'fast' } }))).toBe('Seedance2Fast');
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
