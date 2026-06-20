import { apiJson, buildAuthHeaders, secureApiUrl } from './httpClient';

export interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface ProjectVideoTask {
  image_url?: string;
  scene?: string;
  storyboard_id?: string;
  video_prompt?: string;
  [key: string]: any;
}

function xhrUpload(url: string, formData: FormData, options: UploadOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    const headers = buildAuthHeaders(undefined, { requireAuth: false, includeContentType: false });
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) {
        options.onProgress({
          percent: Math.round((e.loaded / e.total) * 100),
          loaded: e.loaded,
          total: e.total,
        });
      }
    };

    if (options.signal) {
      options.signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.onload = () => {
      if (xhr.status === 401) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
        window.location.href = '/login';
        reject(new Error('登录已过期'));
        return;
      }

      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.detail || `上传失败 (${xhr.status})`));
        }
      } catch {
        reject(new Error(`上传失败 (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));
    xhr.ontimeout = () => reject(new Error('上传超时'));

    xhr.send(formData);
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let i = 0; i <= maxRetries; i += 1) {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      if (i < maxRetries && !(e?.message?.includes('401'))) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('上传失败');
}

function ensureAuthenticated(message = '请先登录'): void {
  buildAuthHeaders(undefined, { includeContentType: false, authErrorMessage: message });
}

export function secureMediaUrl(url: string, options: { absolute?: boolean } = {}): string {
  return secureApiUrl(url, { absolute: options.absolute, requireAuth: false });
}

export async function uploadImage(file: File, options?: UploadOptions): Promise<{
  filename: string;
  storage_url: string;
  url: string;
  path: string;
  size: number;
}> {
  ensureAuthenticated();

  const formData = new FormData();
  formData.append('file', file);

  const result = await withRetry(() => xhrUpload('/api/upload', formData, options));
  result.url = result.storage_url || result.url;
  return result;
}

export async function uploadImageToComfyUI(file: File, nodeType = 'video', options?: UploadOptions): Promise<{
  filename: string;
  storage_url: string;
  node_id?: string;
}> {
  ensureAuthenticated();

  const formData = new FormData();
  formData.append('image', file);
  formData.append('node_type', nodeType);

  return withRetry(() => xhrUpload('/api/comfyui/upload', formData, options));
}

export async function uploadAudio(file: File, startTime = 0, duration = 5, options?: UploadOptions): Promise<{
  filename: string;
  url: string;
}> {
  const formData = new FormData();
  formData.append('audio', file);
  formData.append('start_time', startTime.toString());
  formData.append('duration', duration.toString());

  return withRetry(() => xhrUpload('/api/upload/audio', formData, options));
}

export async function uploadVideoFile(file: File, options?: UploadOptions): Promise<{
  filename: string;
  storage_url: string;
  url: string;
  path: string;
  size: number;
}> {
  return uploadImage(file, options);
}

export async function getProjectVideoTasks(projectId: string): Promise<ProjectVideoTask[]> {
  const data = await apiJson<{ success?: boolean; project?: { video_tasks?: ProjectVideoTask[] } }>(
    `/api/projects/${projectId}`,
    { method: 'GET' },
    'getProjectVideoTasks',
  );
  const tasks = data.project?.video_tasks;
  return Array.isArray(tasks) ? tasks : [];
}

export async function clearProjectVideoTasks(projectId: string): Promise<void> {
  await apiJson<{ success?: boolean }>(
    `/api/projects/${projectId}/clear-video-tasks`,
    { method: 'POST' },
    'clearProjectVideoTasks',
  );
}

export async function cropVideo(videoFilename: string, startTime: number, endTime: number): Promise<{
  filename: string;
  url: string;
}> {
  return apiJson<{
    filename: string;
    url: string;
  }>('/api/video/crop', {
    method: 'POST',
    body: JSON.stringify({
      video_filename: videoFilename,
      start_time: startTime,
      end_time: endTime,
    }),
  }, 'cropVideo');
}

export async function reuploadVideo(filename: string, fileType = 'output'): Promise<{
  filename: string;
  url: string;
}> {
  return apiJson<{
    filename: string;
    url: string;
  }>(
    `/api/comfyui/reupload/video?filename=${encodeURIComponent(filename)}&file_type=${fileType}`,
    { method: 'POST' },
    'reuploadVideo',
  );
}
