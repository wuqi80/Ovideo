import type {
  DashScopeVideoParams,
  MiniMaxVideoParams,
  SeedanceParams,
  ShotType,
  VideoModel,
} from './videoModelService';

export type TaskState = 'idle' | 'pending' | 'running' | 'processing' | 'done' | 'failed';

export interface UploadedImage {
  id: string;
  url: string;
  filename: string;
  storageUrl?: string;
  comfyuiFilename?: string;
  uploadTime: number;
  isUploading?: boolean;
  uploadFailed?: boolean;
  uploadProgress?: number;
  isPlaceholder?: boolean;
  storyboardItemId?: string;
  sortOrder?: number;
  tags?: string[];
  linkedGroupUuids?: string[];
}

export interface TaskGroup {
  uuid: string;
  ids: string[];
  model: VideoModel;
  createdAt?: number;
  shotType?: ShotType;
  duration?: number;
  durationUserOverride?: boolean;
  minimaxParams?: MiniMaxVideoParams;
  mergedFrom?: MergedCardSnapshot[];
}

export interface MergedCardSnapshot {
  uuid: string;
  ids: string[];
  model: VideoModel;
  prompt: string;
  seedanceParams?: SeedanceParams;
  dashScopeParams?: DashScopeVideoParams;
}

export interface TaskStatus {
  state?: TaskState;
  taskId?: string;
  progress?: number;
  result?: string;
  videos?: string[];
  videoGenerateTimes?: number[];
  totalGenerationTime?: number;
  isUpscaled?: boolean;
  isExpired?: boolean;
  keepResult?: boolean;
  selected?: boolean;
  originalResult?: string;
  error?: string;
}

export interface VideoTask {
  task_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  task_type: string;
  created_at: string;
  completed_at?: string;
  started_at?: string;
  progress?: number;
  data?: {
    prompt?: string;
    model?: string;
  };
  result?: {
    videos?: Array<{ url: string; filename?: string; generateTime?: number }>;
    images?: Array<{ url: string; filename?: string }>;
    error?: string;
  };
  error?: string;
}
