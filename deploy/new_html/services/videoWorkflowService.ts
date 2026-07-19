import { apiJson } from './httpClient';

export interface VideoModelCapability {
  key: string;
  label: string;
  provider: string;
  model_name?: string | null;
  model_options?: string[];
  task_types: string[];
  media_inputs: string[];
  supports_original_audio?: boolean;
  supports_cancel?: boolean;
  requires_gpu_node?: boolean;
  available?: boolean;
  query_mode: 'async' | 'queue' | string;
  parameter_rules: Record<string, unknown>;
}

export interface VideoCapabilityManifest {
  seedance_omni: boolean;
  comfyui_available: boolean;
  manifest_version: string;
  models: VideoModelCapability[];
}

const UNAVAILABLE_VIDEO_CAPABILITIES: VideoCapabilityManifest = {
  seedance_omni: false,
  comfyui_available: false,
  manifest_version: 'unavailable',
  models: [],
};

let videoCapabilitiesCache: VideoCapabilityManifest | null = null;
let videoCapabilitiesPromise: Promise<VideoCapabilityManifest> | null = null;

export function fetchVideoCapabilities(): Promise<VideoCapabilityManifest> {
  if (videoCapabilitiesCache) return Promise.resolve(videoCapabilitiesCache);
  if (!videoCapabilitiesPromise) {
    videoCapabilitiesPromise = apiJson<VideoCapabilityManifest>(
      '/api/video/capabilities',
      { method: 'GET' },
      'fetchVideoCapabilities',
    )
      .then((data) => {
        videoCapabilitiesCache = {
          seedance_omni: !!data.seedance_omni,
          comfyui_available: !!data.comfyui_available,
          manifest_version: String(data.manifest_version || 'legacy'),
          models: Array.isArray(data.models) ? data.models : [],
        };
        return videoCapabilitiesCache;
      })
      .catch(() => {
        videoCapabilitiesCache = UNAVAILABLE_VIDEO_CAPABILITIES;
        return videoCapabilitiesCache;
      });
  }
  return videoCapabilitiesPromise;
}

export function fetchSeedanceOmni(): Promise<boolean> {
  return fetchVideoCapabilities().then(data => data.seedance_omni);
}

export function fetchComfyuiAvailable(): Promise<boolean> {
  return fetchVideoCapabilities().then(data => data.comfyui_available);
}

export interface ComposeStatus {
  success?: boolean;
  status: 'idle' | 'running' | 'done' | 'failed';
  total: number;
  done: number;
  url?: string | null;
  duration?: number;
  error?: string | null;
  audio_mode?: 'video_original' | 'reference_dubbing';
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
  audioMode: 'video_original' | 'reference_dubbing' = 'video_original',
): Promise<ComposeStatus> {
  return apiJson<any>(`/api/episodes/${episodeId}/compose`, {
    method: 'POST',
    body: JSON.stringify({
      ...(selections ? { selections } : {}),
      audio_mode: audioMode,
    }),
  }, 'startCompose');
}

export async function getComposeStatus(episodeId: string): Promise<ComposeStatus> {
  return apiJson<any>(`/api/episodes/${episodeId}/compose/status`, { method: 'GET' }, 'getComposeStatus');
}
