import { computeReactiveDuration as computeReactiveDuration } from '../utils/durationMapping';
import { apiFetch } from './httpClient';
import type { SeedanceParams } from './videoModelService';
import type { TaskGroup, TaskStatus, UploadedImage } from './videoTaskTypes';

export interface StoryboardMeta {
  plannedDurationMs?: number;
  audioDurationMs?: number;
  audioUrls?: {
    dialogue?: string;
    narration?: string;
    sfx?: string;
  };
  mixedAudioUrl?: string;
  mixedAudioHash?: string;
  sceneHeading?: string;
  actionText?: string;
  dialogue?: string;
  lastSyncedAt?: number;
}

export interface WorkspaceSession {
  task_groups: TaskGroup[];
  uploaded_images: UploadedImage[];
  image_prompts: Record<string, string>;
  tasks_status: Record<string, TaskStatus>;
  seedance_params?: Record<string, SeedanceParams>;
  storyboard_meta?: Record<string, StoryboardMeta>;
}

function mergeListByIdentity<T extends Record<string, any>>(lists: T[][], keys: string[]): T[] {
  const merged = new Map<string, T>();
  let anonymousIndex = 0;
  for (const list of lists) {
    for (const item of list || []) {
      const identity = keys.map(key => item?.[key]).find(Boolean);
      merged.set(identity ? String(identity) : `anonymous:${anonymousIndex++}`, item);
    }
  }
  return Array.from(merged.values());
}

export function mergeWorkspaceSessions(sessions: WorkspaceSession[]): WorkspaceSession {
  return {
    task_groups: mergeListByIdentity(
      sessions.map(session => session.task_groups || []),
      ['id', 'groupId', 'group_id', 'uuid'],
    ),
    uploaded_images: mergeListByIdentity(
      sessions.map(session => session.uploaded_images || []),
      ['uuid', 'id', 'itemId', 'item_id'],
    ),
    image_prompts: Object.assign({}, ...sessions.map(session => session.image_prompts || {})),
    tasks_status: Object.assign({}, ...sessions.map(session => session.tasks_status || {})),
    seedance_params: Object.assign({}, ...sessions.map(session => session.seedance_params || {})),
    storyboard_meta: Object.assign({}, ...sessions.map(session => session.storyboard_meta || {})),
  };
}

export async function saveWorkspaceSession(
  session: WorkspaceSession,
  scope?: string,
): Promise<{ success: boolean }> {
  try {
    const response = await apiFetch('/api/workspace/save-session', {
      method: 'POST',
      body: JSON.stringify({ ...session, scope: scope || '' }),
    }, { apiName: 'saveWorkspaceSession' });

    if (!response.ok) {
      console.error('保存会话失败:', response.statusText);
      return { success: false };
    }

    return await response.json();
  } catch (e) {
    console.error('保存会话失败:', e);
    return { success: false };
  }
}

export async function loadWorkspaceSession(
  scope?: string,
): Promise<{ success: boolean; session: WorkspaceSession | null }> {
  const params = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  try {
    const response = await apiFetch(`/api/workspace/load-session${params}`, {
      method: 'GET',
    }, { apiName: 'loadWorkspaceSession' });

    if (!response.ok) {
      console.error('加载会话失败:', response.statusText);
      return { success: false, session: null };
    }

    return await response.json();
  } catch (e) {
    console.error('加载会话失败:', e);
    return { success: false, session: null };
  }
}

export function computeReactiveDurationFromMeta(meta: Partial<StoryboardMeta>): number {
  return computeReactiveDuration({
    audioDurationMs: meta.audioDurationMs,
    plannedDurationMs: meta.plannedDurationMs,
  });
}

export async function patchWorkspaceSession(
  scope: string | undefined,
  mutator: (current: WorkspaceSession) => Partial<WorkspaceSession>,
): Promise<void> {
  const cur = await loadWorkspaceSession(scope);
  if (!cur?.success || !cur.session) {
    console.warn('[patchWorkspaceSession] no current session; skip patch');
    return;
  }
  const patch = mutator(cur.session);
  await saveWorkspaceSession({ ...cur.session, ...patch }, scope);
}
