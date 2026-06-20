import { apiJson } from './httpClient';

let seedanceOmniCache: boolean | null = null;
let seedanceOmniPromise: Promise<boolean> | null = null;

export function fetchSeedanceOmni(): Promise<boolean> {
  if (seedanceOmniCache !== null) return Promise.resolve(seedanceOmniCache);
  if (!seedanceOmniPromise) {
    seedanceOmniPromise = apiJson<any>('/api/video/capabilities', { method: 'GET' }, 'fetchSeedanceOmni')
      .then((data) => {
        seedanceOmniCache = !!data.seedance_omni;
        return seedanceOmniCache;
      })
      .catch(() => {
        seedanceOmniCache = false;
        return false;
      });
  }
  return seedanceOmniPromise;
}

let comfyuiAvailableCache: boolean | null = null;
let comfyuiAvailablePromise: Promise<boolean> | null = null;

export function fetchComfyuiAvailable(): Promise<boolean> {
  if (comfyuiAvailableCache !== null) return Promise.resolve(comfyuiAvailableCache);
  if (!comfyuiAvailablePromise) {
    comfyuiAvailablePromise = apiJson<any>('/api/video/capabilities', { method: 'GET' }, 'fetchComfyuiAvailable')
      .then((data) => {
        comfyuiAvailableCache = !!data.comfyui_available;
        return comfyuiAvailableCache;
      })
      .catch(() => {
        comfyuiAvailableCache = false;
        return false;
      });
  }
  return comfyuiAvailablePromise;
}

export interface ComposeStatus {
  success?: boolean;
  status: 'idle' | 'running' | 'done' | 'failed';
  total: number;
  done: number;
  url?: string | null;
  duration?: number;
  error?: string | null;
}

export interface VideoTake {
  segment_id: string;
  video_url: string;
  thumbnail_url?: string | null;
  created_at?: string | null;
}

export interface VideoShot {
  item_id: string;
  sort_order: number;
  scene?: string;
  dialogue?: string;
  takes: VideoTake[];
}

export async function createVideoSegment(episodeId: string, data: any) {
  return apiJson<any>(`/api/episodes/${episodeId}/video-segments`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createVideoSegment');
}

export async function updateVideoSegment(segmentId: string, data: any) {
  return apiJson<any>(`/api/video-segments/${segmentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateVideoSegment');
}

export async function getVideoTakes(episodeId: string): Promise<{ success: boolean; shots: VideoShot[] }> {
  return apiJson<any>(`/api/episodes/${episodeId}/video-takes`, { method: 'GET' }, 'getVideoTakes');
}

export async function startCompose(
  episodeId: string,
  selections?: Record<string, string>,
): Promise<ComposeStatus> {
  return apiJson<any>(`/api/episodes/${episodeId}/compose`, {
    method: 'POST',
    body: JSON.stringify(selections ? { selections } : {}),
  }, 'startCompose');
}

export async function getComposeStatus(episodeId: string): Promise<ComposeStatus> {
  return apiJson<any>(`/api/episodes/${episodeId}/compose/status`, { method: 'GET' }, 'getComposeStatus');
}
