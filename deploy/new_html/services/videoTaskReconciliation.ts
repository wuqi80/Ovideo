import { ALL_MODELS, type VideoModel } from './videoModelService';
import type { TaskGroup, TaskStatus, VideoTask } from './videoTaskTypes';

const ACTIVE_VIDEO_TASK_STATES = new Set(['queued', 'pending', 'running', 'processing']);
const RECONCILABLE_VIDEO_TASK_STATES = new Set([...ACTIVE_VIDEO_TASK_STATES, 'completed']);

export interface VideoTaskReconciliationResult {
  statuses: Record<string, TaskStatus>;
  resumable: Array<{ uuid: string; taskId: string }>;
}

function createdAtValue(task: VideoTask): number {
  const value = Date.parse(String(task.created_at || ''));
  return Number.isFinite(value) ? value : 0;
}

function taskModel(task: VideoTask): VideoModel | undefined {
  const raw = String(task.data?.model || '').trim() as VideoModel;
  return ALL_MODELS.includes(raw) ? raw : undefined;
}

/**
 * Reconcile persisted workspace cards with the server's authoritative live tasks.
 *
 * New submissions carry workspace_group_id. Older submissions are recovered via
 * their video_segment entity_id so a reload before the debounced session save
 * cannot leave an old "failed" badge on a task that is actually still running.
 */
export function reconcileActiveVideoTasks(
  groups: TaskGroup[],
  currentStatuses: Record<string, TaskStatus>,
  serverTasks: VideoTask[],
  segmentIdByGroup: Record<string, string> = {},
  episodeId?: string,
  normalizeVideoUrl: (url: string) => string = url => url,
): VideoTaskReconciliationResult {
  const groupUuids = new Set(groups.map(group => group.uuid));
  const groupBySegmentId = new Map<string, string>();
  Object.entries(segmentIdByGroup).forEach(([uuid, segmentId]) => {
    if (groupUuids.has(uuid) && segmentId) groupBySegmentId.set(String(segmentId), uuid);
  });

  const latestByGroup = new Map<string, VideoTask>();
  for (const task of serverTasks || []) {
    if (!task?.task_id || !RECONCILABLE_VIDEO_TASK_STATES.has(String(task.status || '').toLowerCase())) continue;
    const data = task.data || {};
    if (episodeId && data.episode_id && String(data.episode_id) !== String(episodeId)) continue;

    const workspaceGroupId = String(data.workspace_group_id || '').trim();
    const entityId = String(data.entity_id || '').trim();
    const uuid = groupUuids.has(workspaceGroupId)
      ? workspaceGroupId
      : groupUuids.has(entityId)
        ? entityId
        : groupBySegmentId.get(entityId);
    if (!uuid) continue;

    const previous = latestByGroup.get(uuid);
    if (!previous || createdAtValue(task) >= createdAtValue(previous)) {
      latestByGroup.set(uuid, task);
    }
  }

  const statuses = { ...currentStatuses };
  const resumable: Array<{ uuid: string; taskId: string }> = [];
  latestByGroup.forEach((task, uuid) => {
    const previous: TaskStatus = statuses[uuid] || {};
    const progress = Number(task.progress);
    const model = taskModel(task) || previous.pendingVideoModel;
    if (task.status === 'completed') {
      const previousVideos = previous.videos || [];
      const previousTimes = previous.videoGenerateTimes || [];
      const previousModels = previousVideos.map((_, index) => previous.videoModels?.[index]);
      const generated = (task.result?.videos || [])
        .map(video => ({
          url: normalizeVideoUrl(String(video?.url || '').trim()),
          generateTime: Number(video?.generateTime || 0),
        }))
        .filter(video => Boolean(video.url));
      const videos = [...previousVideos];
      const times = [...previousTimes];
      const models = [...previousModels];
      generated.forEach(video => {
        const normalized = video.url.split('?')[0];
        if (videos.some(existing => String(existing).split('?')[0] === normalized)) return;
        videos.push(video.url);
        times.push(video.generateTime);
        models.push(model);
      });
      statuses[uuid] = {
        ...previous,
        state: 'done',
        taskId: task.task_id,
        progress: 100,
        result: videos[videos.length - 1] || previous.result || '',
        videos,
        videoGenerateTimes: times,
        videoModels: models,
        pendingVideoModel: undefined,
        keepResult: true,
        error: undefined,
      };
      return;
    }

    statuses[uuid] = {
      ...previous,
      state: task.status === 'queued' || task.status === 'pending' ? 'pending' : 'processing',
      taskId: task.task_id,
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
      pendingVideoModel: model,
      keepResult: true,
      error: undefined,
    };
    resumable.push({ uuid, taskId: task.task_id });
  });

  return { statuses, resumable };
}
