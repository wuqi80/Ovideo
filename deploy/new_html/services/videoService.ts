/**
 * 视频生成服务 - 迁移自static/js/api.js和task.js
 */

import { enqueueComfyUITask, getComfyUIQueueStatus } from './comfyuiTaskQueue';
import { computeReactiveDuration as _crd } from '../utils/durationMapping';

const API_BASE = '';

// 重新导出队列状态
export { getComfyUIQueueStatus };

// ComfyUI模型列表（需要排队）
const COMFYUI_MODELS: string[] = ['Wan2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶'];

// 外部API模型列表（不需要排队）
// 2026-05-24 新增 DashScope 视频族：合体(Kling) / 大乘(Vidu) / 炼虚(HappyHorse)
const EXTERNAL_API_MODELS: string[] = ['MINI', 'Sora2', 'Veo', '大能', 'Seedance2', 'Seedance2Fast', 'Kling', 'Vidu', 'HappyHorse'];

/**
 * 判断模型是否需要ComfyUI队列
 */
export function isComfyUIModel(model: VideoModel): boolean {
    return COMFYUI_MODELS.includes(model);
}

/**
 * 获取认证token
 */
function getAuthToken(): string | null {
    return localStorage.getItem('auth_token');
}

/**
 * 构造请求头
 */
function getHeaders(includeContentType = true): HeadersInit {
    const headers: Record<string, string> = {};
    
    const token = getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (includeContentType) {
        headers['Content-Type'] = 'application/json';
    }
    
    return headers;
}

// ==================== 视频生成任务相关类型 ====================

export type VideoModel =
    | 'Wan2' | '一阶' | '二阶' | '三阶' | '四阶' | '五阶' | '六阶' | '七阶'
    | 'Veo' | 'Sora2' | 'MINI' | '大能'
    | 'Seedance2' | 'Seedance2Fast'
    // 2026-05-24 DashScope 共享 API 三家
    | 'Kling' | 'Vidu' | 'HappyHorse';

/** 2026-05-24：DashScope 共享 API 的三家视频模型。 */
export type DashScopeVideoModel = 'Kling' | 'Vidu' | 'HappyHorse';
export function isDashScopeVideoModel(model: VideoModel): model is DashScopeVideoModel {
    return model === 'Kling' || model === 'Vidu' || model === 'HappyHorse';
}
export type ShotType = 'multi' | 'single';

// ==================== Seedance 2.0 (飞升/渡劫) 类型定义 ====================

export type SeedanceMediaKind = 'image' | 'video' | 'audio';
export type SeedanceMediaRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio';

export interface SeedanceMediaInput {
    kind: SeedanceMediaKind;
    url: string;          // 持久化 URL（已上传）
    role?: SeedanceMediaRole;
    file_id?: string;
}

export interface SeedanceParams {
    sub_model: 'standard' | 'fast';
    prompt: string;
    media_inputs: SeedanceMediaInput[];
    resolution?: '480p' | '720p' | '1080p';
    ratio?: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9';
    duration?: number;     // 4-15 或 -1 (智能)
    seed?: number;         // -1 = 随机
    watermark?: boolean;
    generate_audio?: boolean;
    camera_fixed?: boolean;
}

/**
 * 根据 media_inputs 推断 Seedance task_type。
 * - 无媒体且无 prompt 不能调用（前端校验）
 * - 仅 prompt → seedance_t2v
 * - 单图无 role → seedance_i2v
 * - 2 张图带 first_frame + last_frame → seedance_morph
 * - 其他（带 reference_image / 多模态混合）→ seedance_multi
 * - 传入 draftTaskId → seedance_draft
 */
export function inferSeedanceTaskType(media: SeedanceMediaInput[], hasDraftId?: boolean): string {
    if (hasDraftId) return 'seedance_draft';
    if (!media || media.length === 0) return 'seedance_t2v';
    const images = media.filter(m => m.kind === 'image');
    const hasFirst = images.some(m => m.role === 'first_frame');
    const hasLast = images.some(m => m.role === 'last_frame');
    if (hasFirst && hasLast) return 'seedance_morph';
    if (media.length === 1 && images.length === 1 && !images[0].role) return 'seedance_i2v';
    return 'seedance_multi';
}

export type TaskState = 'idle' | 'running' | 'processing' | 'done' | 'failed';

export interface UploadedImage {
    id: string;
    url: string;                          // 空分镜时为空字符串
    filename: string;
    storageUrl?: string;
    comfyuiFilename?: string;
    uploadTime: number;
    isUploading?: boolean;
    uploadFailed?: boolean;
    uploadProgress?: number;
    isPlaceholder?: boolean;              // ⭐ true = 空分镜
    storyboardItemId?: string;            // ⭐ 反查 storyboard_meta
    sortOrder?: number;                   // ⭐ 显示顺序
    tags?: string[];                      // legacy: VideoGenPage 导入时初始化为 []
    linkedGroupUuids?: string[];          // legacy: 反查所属 task_group
}

export interface TaskGroup {
    uuid: string;
    ids: string[];                        // 图片ID列表 (1个=I2V, 2个=Morph)
    model: VideoModel;
    shotType?: ShotType;                  // 仅大能模型使用
    duration?: number;                    // 通用时长（秒，3–15）
    durationUserOverride?: boolean;       // true 后响应式规则不再自动改
    // 2026-06-05：合并相邻同模型卡片时记录各子卡快照，供「拆分」原位还原。
    // 仅 Seedance / DashScope 卡可合并；每次合并把当前卡（若已是合并卡则展开其 mergedFrom）追加进来。
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
    state: TaskState;
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
    progress?: number;  // 后端返回的真实进度 (0-100)
    data?: {
        prompt?: string;
        model?: string;
    };
    result?: {
        videos?: Array<{ url: string; filename?: string; generateTime?: number }>;
        images?: Array<{ url: string; filename?: string }>;
    };
    error?: string;
}

// ==================== 上传进度与取消 ====================

export interface UploadProgress {
    percent: number;
    loaded: number;
    total: number;
}

export interface UploadOptions {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
}

function xhrUpload(url: string, formData: FormData, options: UploadOptions = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        
        const token = getAuthToken();
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && options.onProgress) {
                options.onProgress({
                    percent: Math.round((e.loaded / e.total) * 100),
                    loaded: e.loaded,
                    total: e.total
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
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (e: any) {
            if (e?.name === 'AbortError') throw e;
            if (i < maxRetries && !(e?.message?.includes('401'))) {
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                continue;
            }
            throw e;
        }
    }
    throw new Error('上传失败');
}

// ==================== 图片上传 ====================

/**
 * 上传图片到持久化存储
 */
export async function uploadImage(file: File, options?: UploadOptions): Promise<{
    filename: string;
    storage_url: string;
    url: string;
    path: string;
    size: number;
}> {
    const token = getAuthToken();
    if (!token) {
        throw new Error('请先登录');
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    const result = await withRetry(() => xhrUpload(`${API_BASE}/api/upload`, formData, options));
    result.url = result.storage_url || result.url;
    return result;
}

/**
 * 上传图片到ComfyUI
 */
export async function uploadImageToComfyUI(file: File, nodeType = 'video', options?: UploadOptions): Promise<{
    filename: string;
    storage_url: string;
    node_id?: string;
}> {
    const token = getAuthToken();
    if (!token) {
        throw new Error('请先登录');
    }
    
    const formData = new FormData();
    formData.append('image', file);
    formData.append('node_type', nodeType);
    
    return withRetry(() => xhrUpload(`${API_BASE}/api/comfyui/upload`, formData, options));
}

/**
 * 上传音频文件
 */
export async function uploadAudio(file: File, startTime = 0, duration = 5, options?: UploadOptions): Promise<{
    filename: string;
    url: string;
}> {
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('start_time', startTime.toString());
    formData.append('duration', duration.toString());
    
    return withRetry(() => xhrUpload(`${API_BASE}/api/upload/audio`, formData, options));
}

/**
 * 上传视频文件（复用 /api/upload 通用端点，后端按 content_type 自动识别 image/video）
 * Seedance 多模态参考生视频用此函数上传 0-3 个参考视频
 */
export async function uploadVideoFile(file: File, options?: UploadOptions): Promise<{
    filename: string;
    storage_url: string;
    url: string;
    path: string;
    size: number;
}> {
    return uploadImage(file, options);
}

// ==================== 视频生成任务 ====================

/**
 * 提交视频生成任务
 */
export async function submitTask(
    imageFilename: string,
    imageFilenameEnd: string | null,
    prompt: string,
    model: VideoModel,
    videoFilename?: string,
    audioFilename?: string,
    shotType: ShotType = 'multi',
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        episode_id?: string;
    }
): Promise<{ task_id: string }> {
    let taskType = imageFilenameEnd ? 'morph' : 'i2v';
    let requestData: Record<string, any> = {};
    
    if (model === 'MINI') {
        // MiniMax API
        taskType = imageFilenameEnd ? 'minimax_morph' : 'minimax_i2v';
        const imageUrl = imageFilename.startsWith('http') ? imageFilename : `${API_BASE}/uploads/${imageFilename}`;
        requestData = {
            task_type: taskType,
            first_frame_image: imageUrl,
            prompt: prompt,
            priority: 2
        };
        if (imageFilenameEnd) {
            requestData.last_frame_image = imageFilenameEnd.startsWith('http') ? imageFilenameEnd : `${API_BASE}/uploads/${imageFilenameEnd}`;
        }
    } else if (model === 'Sora2') {
        // Sora2 API
        taskType = imageFilenameEnd ? 'sora2_morph' : 'sora2_i2v';
        requestData = {
            task_type: taskType,
            image_path: imageFilename,
            prompt: prompt,
            priority: 2
        };
        if (imageFilenameEnd) {
            requestData.image_path_end = imageFilenameEnd;
        }
    } else if (model === 'Seedance2' || model === 'Seedance2Fast') {
        // Seedance 2.0 (飞升/渡劫) — 兼容 i2v/morph 入口；多模态完整路径用 submitSeedanceTask
        const subModel = model === 'Seedance2' ? 'standard' : 'fast';
        const media: SeedanceMediaInput[] = [];
        if (imageFilename) {
            const url = imageFilename.startsWith('http') ? imageFilename : `${API_BASE}/uploads/${imageFilename}`;
            media.push({ kind: 'image', url, role: imageFilenameEnd ? 'first_frame' : undefined });
        }
        if (imageFilenameEnd) {
            const urlEnd = imageFilenameEnd.startsWith('http') ? imageFilenameEnd : `${API_BASE}/uploads/${imageFilenameEnd}`;
            media.push({ kind: 'image', url: urlEnd, role: 'last_frame' });
        }
        taskType = inferSeedanceTaskType(media);
        requestData = {
            task_type: taskType,
            sub_model: subModel,
            prompt: prompt,
            media_inputs: media,
            ratio: 'adaptive',
            generate_audio: true,
            priority: 2,
        };
    } else if (model === 'Veo') {
        // Veo API
        taskType = imageFilenameEnd ? 'veo_morph' : 'veo_i2v';
        requestData = {
            task_type: taskType,
            image_path: imageFilename,
            prompt: prompt,
            priority: 2
        };
        if (imageFilenameEnd) {
            requestData.image_path_end = imageFilenameEnd;
        }
    } else if (model === '大能') {
        // Wan2.6 DashScope API
        if (imageFilenameEnd) {
            throw new Error('大能模型不支持首尾帧模式');
        }
        requestData = {
            task_type: 'wan26_i2v',
            image_path: imageFilename,
            prompt: prompt,
            resolution: '1080P',
            duration: 5,
            shot_type: shotType,
            seed: -1,
            priority: 2
        };
    } else if (model === 'Kling') {
        // 2026-05-24 合体 — Kling (DashScope 共享 API)
        // 简化分支：仅 0/1/2 张图（多参考图走 submitDashScopeVideoTask）
        if (!imageFilename && !imageFilenameEnd) {
            taskType = 'kling_t2v';
            requestData = { task_type: taskType, prompt, mode: 'std', duration: 5, aspect_ratio: '16:9', audio: false, watermark: false, seed: -1, priority: 2 };
        } else if (imageFilenameEnd) {
            taskType = 'kling_morph';
            requestData = { task_type: taskType, prompt, image_path: imageFilename, image_path_end: imageFilenameEnd, mode: 'std', duration: 5, audio: false, watermark: false, seed: -1, priority: 2 };
        } else {
            taskType = 'kling_i2v';
            requestData = { task_type: taskType, prompt, image_path: imageFilename, mode: 'std', duration: 5, audio: false, watermark: false, seed: -1, priority: 2 };
        }
    } else if (model === 'Vidu') {
        // 2026-05-24 大乘 — Vidu (DashScope 共享 API)
        // 简化分支：双图=首尾帧；单图=单参考；无图禁止（Vidu 不支持纯文生）
        if (!imageFilename && !imageFilenameEnd) {
            throw new Error('大乘 (Vidu) 不支持纯文生视频，请至少提供 1 张参考图');
        }
        if (imageFilenameEnd) {
            taskType = 'vidu_morph';
            requestData = {
                task_type: taskType, prompt,
                image_path: imageFilename, image_path_end: imageFilenameEnd,
                sub_model: 'q3-turbo', resolution: '720P', duration: 5, audio: false, watermark: false, seed: -1, priority: 2,
            };
        } else {
            taskType = 'vidu_r2v';
            requestData = {
                task_type: taskType, prompt,
                media_inputs: [{ kind: 'image', url: imageFilename, role: 'reference_image' }],
                sub_model: 'q3', resolution: '720P', duration: 5, audio: false, watermark: false, seed: -1, priority: 2,
            };
        }
    } else if (model === 'HappyHorse') {
        // 2026-05-24 炼虚 — HappyHorse (DashScope 共享 API)
        // 简化分支：仅多图参考生；首尾帧不支持；多图走 submitDashScopeVideoTask
        if (!imageFilename) {
            throw new Error('炼虚 (HappyHorse) 至少需要 1 张参考图');
        }
        if (imageFilenameEnd) {
            throw new Error('炼虚 (HappyHorse) 不支持首尾帧模式（仅多图参考）');
        }
        taskType = 'happyhorse_r2v';
        requestData = {
            task_type: taskType, prompt,
            media_inputs: [{ kind: 'image', url: imageFilename, role: 'reference_image' }],
            resolution: '720P', ratio: '16:9', duration: 5, watermark: false, seed: -1, priority: 2,
        };
    } else {
        // ComfyUI工作流（Wan2, 一阶~七阶）
        requestData = {
            task_type: taskType,
            image_path: imageFilename,
            prompt: prompt,
            negative_prompt: 'nsfw, bad quality, worst quality',
            model: model,
            seed: -1,
            priority: 2
        };
        if (imageFilenameEnd) {
            requestData.image_path_end = imageFilenameEnd;
        }
    }
    
    if (entityOptions) {
        requestData.entity_type = entityOptions.entity_type;
        requestData.entity_id = entityOptions.entity_id;
        requestData.file_role = entityOptions.file_role || 'video';
        requestData.episode_id = entityOptions.episode_id;
    }

    const response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: '任务提交失败' }));
        throw new Error(error.detail || '任务提交失败');
    }
    
    return await response.json();
}

/**
 * 提交视频放大任务
 */
export async function submitUpscaleTask(
    videoFilename: string,
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        episode_id?: string;
    }
): Promise<{ task_id: string }> {
    const requestData: Record<string, any> = {
        task_type: 'upscale',
        video_filename: videoFilename,
        seed: -1,
        priority: 2
    };

    if (entityOptions) {
        requestData.entity_type = entityOptions.entity_type;
        requestData.entity_id = entityOptions.entity_id;
        requestData.file_role = entityOptions.file_role || 'video';
        requestData.episode_id = entityOptions.episode_id;
    }

    const response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
        throw new Error('放大任务提交失败');
    }
    
    return await response.json();
}

/**
 * 提交配音任务
 */
export async function submitVoiceTask(
    imageFilename: string,
    videoFilename: string,
    audioFilename: string,
    prompt: string,
    model: VideoModel = 'Wan2'
): Promise<{ task_id: string }> {
    const response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
            task_type: 'voice',
            image_path: imageFilename,
            video_filename: videoFilename,
            audio_filename: audioFilename,
            prompt_AU: prompt,
            model: model,
            seed: -1,
            priority: 2
        })
    });
    
    if (!response.ok) {
        throw new Error('配音任务提交失败');
    }
    
    return await response.json();
}

/**
 * 查询任务状态
 */
export async function getTaskStatus(taskId: string): Promise<VideoTask> {
    const response = await fetch(`${API_BASE}/api/task/${taskId}`, {
        headers: getHeaders()
    });
    
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('TASK_NOT_FOUND');
        }
        throw new Error('查询任务状态失败');
    }
    
    return await response.json();
}

/**
 * 获取历史任务列表
 */
export async function getTasks(limit = 100): Promise<{ tasks: VideoTask[] }> {
    const token = getAuthToken();
    if (!token) {
        return { tasks: [] };
    }
    
    const response = await fetch(`${API_BASE}/api/tasks?limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('username');
            throw new Error('登录已过期');
        }
        throw new Error('加载历史任务失败');
    }
    
    return await response.json();
}

/**
 * 取消任务（后端会把状态落为 cancelled 并从队列移除，
 * 避免前端刷新后从 /api/tasks/active 重新拉回）。
 */
export async function cancelTask(taskId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/task/${taskId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: '取消失败' }));
        throw new Error(error.detail || '取消失败');
    }
}

/**
 * 删除任务
 */
export async function deleteTask(taskId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/task/${taskId}/delete`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: '删除失败' }));
        throw new Error(error.detail || '删除失败');
    }
}

// ==================== 会话管理 ====================

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
    dialogue?: string;
    lastSyncedAt?: number;
}

export interface WorkspaceSession {
    task_groups: TaskGroup[];
    uploaded_images: UploadedImage[];
    image_prompts: Record<string, string>;
    tasks_status: Record<string, TaskStatus>;
    seedance_params?: Record<string /* groupUuid */, SeedanceParams>;
    storyboard_meta?: Record<string /* itemId */, StoryboardMeta>;
}

/**
 * 保存工作区会话
 * @param scope 作用域（如 "ep_xxx:script_yyy"），为空时使用用户级全局会话
 */
export async function saveWorkspaceSession(session: WorkspaceSession, scope?: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_BASE}/api/workspace/save-session`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ...session, scope: scope || '' })
    });
    
    if (!response.ok) {
        console.error('保存会话失败:', response.statusText);
        return { success: false };
    }
    
    return await response.json();
}

/**
 * 加载工作区会话
 * @param scope 作用域（如 "ep_xxx:script_yyy"），为空时使用用户级全局会话
 */
export async function loadWorkspaceSession(scope?: string): Promise<{ success: boolean; session: WorkspaceSession | null }> {
    const params = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    const response = await fetch(`${API_BASE}/api/workspace/load-session${params}`, {
        method: 'GET',
        headers: getHeaders()
    });
    
    if (!response.ok) {
        console.error('加载会话失败:', response.statusText);
        return { success: false, session: null };
    }
    
    return await response.json();
}

// ==================== 视频操作 ====================

/**
 * 视频裁剪
 */
export async function cropVideo(videoFilename: string, startTime: number, endTime: number): Promise<{
    filename: string;
    url: string;
}> {
    const response = await fetch(`${API_BASE}/api/video/crop`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
            video_filename: videoFilename,
            start_time: startTime,
            end_time: endTime
        })
    });
    
    if (!response.ok) {
        throw new Error('视频裁剪失败');
    }
    
    return await response.json();
}

/**
 * 视频重新上传
 */
export async function reuploadVideo(filename: string, fileType = 'output'): Promise<{
    filename: string;
    url: string;
}> {
    const response = await fetch(
        `${API_BASE}/api/comfyui/reupload/video?filename=${encodeURIComponent(filename)}&file_type=${fileType}`,
        {
            method: 'POST',
            headers: getHeaders()
        }
    );
    
    if (!response.ok) {
        throw new Error('视频文件准备失败');
    }
    
    return await response.json();
}

// ==================== 工具函数 ====================

/**
 * 生成UUID
 */
export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 获取模型显示名称
 */
export function getModelDisplayName(model: VideoModel): string {
    const modelNameMap: Record<VideoModel, string> = {
        'Wan2': '练气',
        '一阶': '一阶',
        '二阶': '二阶',
        '三阶': '三阶',
        '四阶': '四阶',
        '五阶': '五阶',
        '六阶': '六阶',
        '七阶': '七阶',
        'Veo': '筑基',
        'MINI': '金丹',
        'Sora2': '化神',
        '大能': '大能',
        'Seedance2': '飞升',
        'Seedance2Fast': '渡劫',
        // 2026-05-24 DashScope 共享 API
        'Kling': '合体',
        'Vidu': '大乘',
        'HappyHorse': '炼虚',
    };
    return modelNameMap[model] || model;
}

/**
 * 所有可用模型
 */
export const ALL_MODELS: VideoModel[] = [
    'Wan2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶',
    'Veo', 'Sora2', 'MINI', '大能',
    'Seedance2', 'Seedance2Fast',
    'Kling', 'Vidu', 'HappyHorse',
];

/**
 * 格式化时间
 */
export function formatUploadTime(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 格式化生成时间
 */
export function formatGenerationTime(seconds: number): string {
    if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}分${secs}秒`;
    }
    return `${seconds}秒`;
}

// ==================== ComfyUI 队列执行函数 ====================

/**
 * 轮询等待任务完成
 */
async function waitForTask(taskId: string, timeout = 300000): Promise<VideoTask> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const status = await getTaskStatus(taskId);
        
        if (status.status === 'completed') {
            return status;
        } else if (status.status === 'failed') {
            throw new Error(status.result?.error || '任务失败');
        }
        
        // 等待2秒后继续轮询
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('任务超时');
}

/**
 * 队列执行：视频生成任务（仅ComfyUI模型需要排队）
 * @returns 返回taskId，由调用方自行轮询状态
 */
export async function submitTaskQueued(
    imageFilename: string,
    imageFilenameEnd: string | null,
    prompt: string,
    model: VideoModel,
    videoFilename?: string,
    audioFilename?: string,
    shotType: ShotType = 'multi',
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        episode_id?: string;
    }
): Promise<{ task_id: string }> {
    // 外部API模型不需要排队，直接提交
    if (!isComfyUIModel(model)) {
        console.log(`🌐 外部API模型 ${model} 不需要排队，直接提交`);
        return submitTask(imageFilename, imageFilenameEnd, prompt, model, videoFilename, audioFilename, shotType, entityOptions);
    }
    
    // ComfyUI模型需要排队
    const taskName = imageFilenameEnd ? `视频生成-${model}-首尾帧` : `视频生成-${model}`;
    // 2026-05-20 (M6)：videoService 这 3 处只提交任务、不等待 — 不连 taskRegistry，
    // 等待由 VideoPage 的 videoTaskPoller 单独负责。无需传 registryMeta。
    return enqueueComfyUITask(async (_frontendKey) => {
        return submitTask(imageFilename, imageFilenameEnd, prompt, model, videoFilename, audioFilename, shotType, entityOptions);
    }, taskName);
}

/**
 * 队列执行：视频放大任务（ComfyUI工作流，需要排队）
 */
export async function submitUpscaleTaskQueued(
    videoFilename: string,
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        episode_id?: string;
    }
): Promise<{ task_id: string }> {
    return enqueueComfyUITask(async (_frontendKey) => {
        return submitUpscaleTask(videoFilename, entityOptions);
    }, '视频放大');
}

/**
 * 队列执行：配音任务（ComfyUI工作流，需要排队）
 */
export async function submitVoiceTaskQueued(
    imageFilename: string,
    videoFilename: string,
    audioFilename: string,
    prompt: string,
    model: VideoModel = 'Wan2'
): Promise<{ task_id: string }> {
    return enqueueComfyUITask(async (_frontendKey) => {
        return submitVoiceTask(imageFilename, videoFilename, audioFilename, prompt, model);
    }, '视频配音');
}

// ==================== Seedance 2.0 (飞升/渡劫) 多模态任务 ====================

/**
 * 提交 Seedance 2.0 多模态任务（VideoPage 多模态面板专用）。
 * 自动根据 media_inputs 推断 task_type（t2v/i2v/morph/multi/draft）。
 *
 * @param params Seedance 7 参数 + media_inputs + sub_model + prompt
 * @param entityOptions 用于实体绑定（推荐传 video_segment + segment_id 触发 video_segments.video_url 同步）
 * @param draftTaskId 1.5pro 样片任务 ID（2.0 不支持，传了会被服务端拒绝；前端通常灰显此入口）
 */
export async function submitSeedanceTask(
    params: SeedanceParams,
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        episode_id?: string;
    },
    draftTaskId?: string,
): Promise<{ task_id: string }> {
    // fast 子型号不支持 1080p：前端兜底降级，配合后端二次校验
    const resolution = (params.sub_model === 'fast' && params.resolution === '1080p')
        ? '720p'
        : params.resolution;

    const taskType = inferSeedanceTaskType(params.media_inputs, !!draftTaskId);
    const body: Record<string, any> = {
        task_type: taskType,
        sub_model: params.sub_model,
        prompt: params.prompt,
        media_inputs: params.media_inputs,
        resolution,
        ratio: params.ratio || 'adaptive',
        duration: params.duration,
        seed: params.seed ?? -1,
        watermark: !!params.watermark,
        generate_audio: params.generate_audio !== false,
        camera_fixed: !!params.camera_fixed,
        priority: 2,
    };
    if (draftTaskId) body.draft_task_id = draftTaskId;
    if (entityOptions) {
        body.entity_type = entityOptions.entity_type;
        body.entity_id = entityOptions.entity_id;
        body.file_role = entityOptions.file_role || 'video';
        body.episode_id = entityOptions.episode_id;
    }

    const resp = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Seedance 任务提交失败' }));
        throw new Error(err.detail || 'Seedance 任务提交失败');
    }
    return await resp.json();
}

// ==================== DashScope 共享 API · 三家视频模型 ====================
// 2026-05-24 新增：合体(Kling) / 大乘(Vidu) / 炼虚(HappyHorse)
// 全部走阿里云百炼 DashScope endpoint，共享 DASHSCOPE_API_KEY。
// 设计与 SeedanceParams 平行，复用 SeedanceMediaInput（已包含 first/last/reference_image 角色）。

export type KlingMode = 'std' | 'pro';           // std=720P / pro=1080P
export type KlingSubModel = 'standard' | 'omni'; // omni 支持多参考图、参考视频、多分镜

export type ViduSubModel =
    | 'q3-mix' | 'q3' | 'q3-turbo' | 'q3-pro'
    | 'q2' | 'q2-pro' | 'q2-turbo';

export type DashScopeResolution = '540P' | '720P' | '1080P';
export type DashScopeAspectRatio = '16:9' | '9:16' | '1:1';
export type HappyHorseRatio = '16:9' | '9:16' | '3:4' | '4:3' | '4:5' | '5:4' | '1:1' | '9:21' | '21:9';

// 2026-05-24 — Task 2 of dashscope-cards-redesign：三家专属新增字段类型。
// Kling 多镜头模式（kling/kling-v3-* 都支持，最多 6 个分镜）
export type KlingShotType = 'intelligence' | 'customize';
export interface KlingMultiPromptItem {
    index: number;
    prompt: string;
    duration: number;
}
// Vidu 真实支持的分辨率档（与既有 DashScopeResolution 同义；保留独立别名以便 UI 引用）
export type ViduResolution = DashScopeResolution;
// HappyHorse 仅支持 720P / 1080P 两档（不含 540P）
export type HhResolution = '720P' | '1080P';
// HappyHorse 9 种比例（与既有 HappyHorseRatio 同义；保留独立别名以贴近 plan 命名约定）
export type HhRatio = HappyHorseRatio;

export interface DashScopeVideoParams {
    /** 必填：模型选择 */
    model: DashScopeVideoModel;
    /** 必填：文本提示词 */
    prompt: string;
    /** 媒体输入（first_frame / last_frame / reference_image），url 可填 file_id 或公网 URL，worker 自动 Base64 转换 */
    media_inputs?: SeedanceMediaInput[];

    // ─── 公共 ─────────────────────────────────────────────────────────
    /** 时长（秒）：Kling 3-15 / Vidu q3 1-16 / Vidu q2 1-10 / HappyHorse 3-15 */
    duration?: number;
    /** 随机种子，-1 自动 */
    seed?: number;
    /** 水印 */
    watermark?: boolean;

    // ─── Kling ────────────────────────────────────────────────────────
    /** Kling 子型号：standard(kling-v3) / omni(kling-v3-omni) */
    sub_model_kling?: KlingSubModel;
    /** Kling 模式：std(720P) / pro(1080P) */
    mode?: KlingMode;
    /** Kling 文生/参考生视频画面比例（图生视频以图为基准不必传） */
    aspect_ratio?: DashScopeAspectRatio;
    /** Kling/Vidu 是否生成有声视频 */
    audio?: boolean;

    // ─── Vidu ─────────────────────────────────────────────────────────
    /** Vidu 子型号：q3-mix / q3 / q3-turbo / q3-pro / q2 / q2-pro / q2-turbo */
    sub_model_vidu?: ViduSubModel;
    /** Vidu / HappyHorse 分辨率档：540P/720P/1080P */
    resolution?: DashScopeResolution;
    /** Vidu 自定义 size，如 "1280*720"，与 resolution 二选一或同传 */
    size?: string;

    // ─── HappyHorse ──────────────────────────────────────────────────
    /** HappyHorse 宽高比（9 档可选） */
    ratio?: HappyHorseRatio;

    // 2026-05-24 — Task 2 of dashscope-cards-redesign：补齐三家真实文档字段。
    // 既有的 resolution / aspect_ratio / audio / ratio 是早期通用别名；
    // 下面是各家独占命名空间字段（kling_* / vidu_* / hh_*），与后端 payload 序列化一一对应。

    /** Kling：多镜头能力开关（kling/kling-v3-* 都支持） */
    kling_multi_shot?: boolean;
    /** Kling：多镜头分镜模式（intelligence=智能拆分 / customize=逐镜头自定义） */
    kling_shot_type?: KlingShotType;
    /** Kling：customize 模式下的逐分镜列表，最多 6 个 */
    kling_multi_prompt?: KlingMultiPromptItem[];
    /** Kling：omni 模式接收 type=base/feature 视频时是否保留原声 */
    kling_keep_original_sound?: 'yes' | 'no';

    // 2026-05-25 — Kling 卡片 UI 显式 state，避免从 media_inputs 反推引起的"切换后卡住"bug。
    // 后端真实 task_type 仍由 inferDashScopeTaskType 推导（这里只是 UI 状态）。
    // 'auto'：跟随 storyboard 注入的 media（单图→i2v / 双图→morph / 无→t2v）—— 默认值
    // 'omni'：用户额外提供多参考图（卡内 MultiRefRow）
    // 'multi'：多镜头脚本
    kling_active_mode?: 'auto' | 'omni' | 'multi';

    /** Vidu：分辨率档 540P/720P/1080P（独占命名空间，避免与公共 resolution 互相覆盖） */
    vidu_resolution?: ViduResolution;
    /** Vidu：像素尺寸字符串，如 "1280*720" */
    vidu_size?: string;
    /** Vidu：种子；undefined = 随机 */
    vidu_seed?: number;
    /** Vidu：是否生成有声视频；仅 q3 系列子模型生效 */
    vidu_audio?: boolean;

    /** HappyHorse：分辨率档（仅 720P / 1080P；文档默认 1080P） */
    hh_resolution?: HhResolution;
    /** HappyHorse：宽高比（9 档可选） */
    hh_ratio?: HhRatio;
    /** HappyHorse：时长 3-15 秒，文档默认 5 */
    hh_duration?: number;
    /** HappyHorse：水印；文档默认 true */
    hh_watermark?: boolean;
    /** HappyHorse：种子；undefined = 随机 */
    hh_seed?: number;
}

/**
 * 2026-05-24 — Task 2 of dashscope-cards-redesign：DashScope 三家视频参数默认值工厂。
 *
 * 项目里历史上同名函数住在 `components/video/DashScopeCards.tsx`，沿用 3 参数签名
 * (model, prompt, seedMedia)。本版本提供 service 层的"单一可信源"实现，
 * 字段默认值按真实 API 文档补齐：
 * - Kling：kling_multi_shot=false / kling_shot_type='intelligence' /
 *   kling_multi_prompt=[] / kling_keep_original_sound='no'
 * - Vidu：vidu_resolution='720P' / vidu_size='1280*720' / vidu_audio=false
 *   （vidu_seed undefined 表示随机）
 * - HappyHorse：hh_resolution='1080P' / hh_ratio='16:9' / hh_duration=5 /
 *   hh_watermark=true（按文档默认开启）/ hh_seed undefined
 *
 * 模型名沿用项目既有 `DashScopeVideoModel`（'Kling' | 'Vidu' | 'HappyHorse'），
 * 而非 plan literal 里的中文别名（'合体' / '大乘' / '炼虚'），保持跨文件类型一致。
 */
export function makeDefaultDashScopeParams(
    model: DashScopeVideoModel,
    prompt: string = '',
    seedMedia: SeedanceMediaInput[] = [],
): DashScopeVideoParams {
    const base: DashScopeVideoParams = {
        model,
        prompt,
        media_inputs: seedMedia,
        duration: 5,
        seed: -1,
        watermark: false,
    };

    if (model === 'Kling') {
        return {
            ...base,
            sub_model_kling: 'standard',
            mode: 'std',
            aspect_ratio: '16:9',
            audio: false,
            kling_multi_shot: false,
            kling_shot_type: 'intelligence',
            kling_multi_prompt: [],
            kling_keep_original_sound: 'no',
            kling_active_mode: 'auto',
        };
    }
    if (model === 'Vidu') {
        return {
            ...base,
            sub_model_vidu: 'q3',
            resolution: '720P',
            audio: false,
            vidu_resolution: '720P',
            vidu_size: '1280*720',
            vidu_audio: false,
        };
    }
    return {
        ...base,
        resolution: '720P',
        ratio: '16:9',
        hh_resolution: '1080P',
        hh_ratio: '16:9',
        hh_duration: 5,
        hh_watermark: true,
    };
}

/**
 * 根据 model + media_inputs 推断对应 task_type（与后端 worker 派发 elif 对齐）。
 */
export function inferDashScopeTaskType(
    model: DashScopeVideoModel,
    media: SeedanceMediaInput[] = [],
): string {
    const images = media.filter(m => m.kind === 'image');
    const hasFirst = images.some(m => m.role === 'first_frame');
    const hasLast = images.some(m => m.role === 'last_frame');

    if (model === 'Kling') {
        if (!media.length) return 'kling_t2v';
        if (hasFirst && hasLast) return 'kling_morph';
        if (hasFirst && !hasLast) return 'kling_i2v';
        return 'kling_refer';   // omni 多参考图
    }
    if (model === 'Vidu') {
        if (hasFirst && hasLast) return 'vidu_morph';
        return 'vidu_r2v';
    }
    return 'happyhorse_r2v';
}

/**
 * 提交 DashScope 共享 API 视频任务（合体/大乘/炼虚专用入口）。
 *
 * 自动按 `model` + media role 分布推断 task_type；首/尾帧从 media_inputs 抽出
 * 后单独以 image_path / image_path_end 字段下发（与 worker `_process_dashscope_video_task`
 * 约定一致）；剩余 reference_image 走 media_inputs 列表透传给 worker。
 *
 * @param params DashScope 视频参数（model + prompt + media + 各家专属）
 * @param entityOptions 实体绑定（推荐传 video_segment + segment_id，自动同步 video_segments.video_url）
 */
export async function submitDashScopeVideoTask(
    params: DashScopeVideoParams,
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        episode_id?: string;
    },
): Promise<{ task_id: string }> {
    const media = params.media_inputs || [];
    const images = media.filter(m => m.kind === 'image');
    const firstFrame = images.find(m => m.role === 'first_frame');
    const lastFrame = images.find(m => m.role === 'last_frame');
    const refImages = images.filter(m => m !== firstFrame && m !== lastFrame);

    const taskType = inferDashScopeTaskType(params.model, media);

    const body: Record<string, any> = {
        task_type: taskType,
        prompt: params.prompt || '',
        duration: params.duration ?? 5,
        seed: params.seed ?? -1,
        watermark: !!params.watermark,
        priority: 2,
    };

    // 单图（首帧/尾帧）走 image_path（worker file_id → Base64 自动处理）
    const resolveUrl = (m: SeedanceMediaInput): string => m.file_id || m.url;
    if (firstFrame) body.image_path = resolveUrl(firstFrame);
    if (lastFrame) body.image_path_end = resolveUrl(lastFrame);

    // 多参考图走 media_inputs[]（kind=image，可附 role=reference_image）
    if (refImages.length > 0) {
        body.media_inputs = refImages.map(m => ({
            kind: 'image' as const,
            url: resolveUrl(m),
            role: m.role || 'reference_image',
        }));
    }

    // 各家专属参数
    if (params.model === 'Kling') {
        body.mode = params.mode || 'std';
        if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio;
        if (params.audio !== undefined) body.audio = !!params.audio;
        if (params.sub_model_kling) body.sub_model = params.sub_model_kling;
    } else if (params.model === 'Vidu') {
        body.resolution = params.resolution || '720P';
        if (params.size) body.size = params.size;
        if (params.audio !== undefined) body.audio = !!params.audio;
        if (params.sub_model_vidu) body.sub_model = params.sub_model_vidu;
    } else {
        // HappyHorse
        body.resolution = params.resolution || '720P';
        body.ratio = params.ratio || '16:9';
    }

    if (entityOptions) {
        body.entity_type = entityOptions.entity_type;
        body.entity_id = entityOptions.entity_id;
        body.file_role = entityOptions.file_role || 'video';
        body.episode_id = entityOptions.episode_id;
    }

    const resp = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `${params.model} 任务提交失败` }));
        throw new Error(err.detail || `${params.model} 任务提交失败`);
    }
    return await resp.json();
}

// ==================== 分镜参考音频混音 ====================

export interface MixStoryboardAudioRequest {
    item_id: string;
    dialogue_url?: string;
    narration_url?: string;
    sfx_url?: string;
    dialogue_gain_db?: number;
    narration_gain_db?: number;
    sfx_gain_db?: number;
}

export interface MixStoryboardAudioResponse {
    success: boolean;
    mixed_audio_url: string;
    cached: boolean;
    duration_ms: number;
}

export async function mixStoryboardAudio(
    body: MixStoryboardAudioRequest,
): Promise<MixStoryboardAudioResponse> {
    const token = localStorage.getItem('auth_token') || '';
    const resp = await fetch('/api/storyboard/mix-audio', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`mix-audio failed: ${resp.status} ${await resp.text()}`);
    }
    return resp.json();
}

// ==================== Task 6 helpers ====================

/**
 * StoryboardMeta 的部分字段 → 响应式时长（秒）。
 * 优先 audioDurationMs；否则 plannedDurationMs；否则默认值。
 */
export function computeReactiveDurationFromMeta(meta: Partial<StoryboardMeta>): number {
    return _crd({
        audioDurationMs: meta.audioDurationMs,
        plannedDurationMs: meta.plannedDurationMs,
    });
}

/**
 * 并发受限的 async 批处理。
 * - items: 输入列表
 * - limit: 同时运行的 worker 上限
 * - fn:    每个 item 的异步处理器
 * 失败的 item 会让整个 Promise.all 拒绝，调用方负责在 fn 内 try/catch。
 */
export async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}

/**
 * 拉取当前 workspace 会话，应用 mutator 返回的 patch，再保存合并后的整体。
 * - 适合在异步流程（如 mix-audio 后）打补丁，而不会覆盖期间用户做的其他改动。
 * - mutator 必须是纯函数：返回浅 patch 对象，由本函数与最新会话合并后写回。
 * - 没有当前会话时静默警告并直接返回（不会抛错，避免后台任务把页面打崩）。
 */
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
