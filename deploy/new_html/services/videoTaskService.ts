import { enqueueComfyUITask } from './comfyuiTaskQueue';
import { apiFetch, apiJson, buildAuthHeaders, handleUnauthorized } from './httpClient';
import {
    getMiniMaxVideoParamsError,
    inferDashScopeTaskType,
    inferSeedanceTaskType,
    isComfyUIModel,
    isSeedanceVideoModel,
    normalizeMiniMaxVideoParams,
    normalizeSeedanceMediaForSubmission,
    seedanceSubModelForVideoModel,
    type DashScopeVideoParams,
    type SeedanceMediaInput,
    type SeedanceParams,
    type ShotType,
    type VideoModel,
} from './videoModelService';
import type { VideoTask } from './videoTaskTypes';
import { resolveGpuTaskRouting } from './clusterNodeService';
import { confirmProcessingQueue } from './processingQueueService';

export type { VideoTask } from './videoTaskTypes';
export { cancelTask, deleteTask } from './taskControlService';

export interface VideoGenerationOptions {
    duration?: number;
    resolution?: string;
    seed?: number;
    negative_prompt?: string;
    shot_type?: ShotType;
    minimax_model?: string;
    minimax_resolution?: '768P' | '1080P';
    minimax_prompt_optimizer?: boolean;
}

export function buildComfyUIVideoTaskPayload(
    taskType: 'i2v' | 'morph',
    imageFilename: string,
    imageFilenameEnd: string | null,
    prompt: string,
    model: VideoModel,
    generationOptions?: VideoGenerationOptions,
): Record<string, any> {
    const payload: Record<string, any> = {
        task_type: taskType,
        image_path: imageFilename,
        prompt,
        negative_prompt: generationOptions?.negative_prompt || 'nsfw, bad quality, worst quality',
        model,
        duration: generationOptions?.duration ?? 5,
        seed: generationOptions?.seed ?? -1,
        priority: 2,
    };
    if (imageFilenameEnd) {
        payload.image_path_end = imageFilenameEnd;
    }
    return payload;
}

function requiresStrictProcessingNode(model: VideoModel): boolean {
    return model === 'MiniMaxH3' || model === 'LTXNode1' || model === 'WanNode2';
}

function hasAuthHeader(): boolean {
    const headers = buildAuthHeaders(undefined, { requireAuth: false, includeContentType: false });
    return Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
}

async function throwResponseError(response: Response, fallback: string): Promise<never> {
    const error = await response.json().catch(() => ({ detail: fallback }));
    const detail = error?.detail ?? error?.message;
    throw new Error(typeof detail === 'string' && detail ? detail : fallback);
}

export function normalizeVideoMediaRef(ref: string): string {
    const value = (ref || '').trim();
    if (!value) return '';
    if (
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('data:') ||
        value.startsWith('/') ||
        value.startsWith('file_')
    ) {
        return value;
    }
    return `/uploads/${value.replace(/^uploads\//, '')}`;
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
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
    },
    generationOptions?: VideoGenerationOptions
): Promise<{ task_id: string }> {
    let taskType = imageFilenameEnd ? 'morph' : 'i2v';
    let requestData: Record<string, any> = {};

    if (model === 'MINI') {
        // MiniMax API
        const minimaxParams = normalizeMiniMaxVideoParams({
            duration: generationOptions?.duration as 6 | 10 | undefined,
            resolution: generationOptions?.minimax_resolution,
            promptOptimizer: generationOptions?.minimax_prompt_optimizer,
        });
        const parameterError = getMiniMaxVideoParamsError(minimaxParams);
        if (parameterError) {
            throw new Error(`MiniMax 参数无效：${parameterError}`);
        }
        taskType = imageFilenameEnd ? 'minimax_morph' : 'minimax_i2v';
        const imageUrl = normalizeVideoMediaRef(imageFilename);
        requestData = {
            task_type: taskType,
            first_frame_image: imageUrl,
            prompt: prompt,
            duration: minimaxParams.duration,
            minimax_model: generationOptions?.minimax_model,
            minimax_resolution: minimaxParams.resolution,
            minimax_prompt_optimizer: minimaxParams.promptOptimizer,
            priority: 2
        };
        if (imageFilenameEnd) {
            requestData.last_frame_image = normalizeVideoMediaRef(imageFilenameEnd);
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
    } else if (isSeedanceVideoModel(model)) {
        // Seedance 系列 — 兼容 i2v/morph 入口；多模态完整路径用 submitSeedanceTask
        const subModel = seedanceSubModelForVideoModel(model);
        const media: SeedanceMediaInput[] = [];
        if (imageFilename) {
            const url = imageFilename.startsWith('http') ? imageFilename : `/uploads/${imageFilename}`;
            media.push({ kind: 'image', url, role: imageFilenameEnd ? 'first_frame' : undefined });
        }
        if (imageFilenameEnd) {
            const urlEnd = imageFilenameEnd.startsWith('http') ? imageFilenameEnd : `/uploads/${imageFilenameEnd}`;
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
            resolution: generationOptions?.resolution || '1080P',
            duration: generationOptions?.duration ?? 5,
            shot_type: generationOptions?.shot_type || shotType,
            seed: generationOptions?.seed ?? -1,
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
        requestData = buildComfyUIVideoTaskPayload(
            taskType,
            imageFilename,
            imageFilenameEnd,
            prompt,
            model,
            generationOptions,
        );
    }

    if (entityOptions) {
        requestData.entity_type = entityOptions.entity_type;
        requestData.entity_id = entityOptions.entity_id;
        requestData.file_role = entityOptions.file_role || 'video';
        requestData.project_id = entityOptions.project_id;
        requestData.episode_id = entityOptions.episode_id;
    }

    if (isComfyUIModel(model)) {
        const preferredTarget = entityOptions?.preferred_agent_id || entityOptions?.preferred_node_id;
        const strictPreferredRouting = requiresStrictProcessingNode(model) && Boolean(preferredTarget);
        const routing = await resolveGpuTaskRouting(
            preferredTarget,
            { strict: strictPreferredRouting },
        );
        requestData.preferred_agent_id = entityOptions?.preferred_agent_id || routing.preferredAgentId;
        requestData.preferred_node_id = entityOptions?.preferred_node_id || routing.preferredNodeId;
        await confirmProcessingQueue(requestData);
    }

    const response = await apiFetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify(requestData)
    }, { apiName: 'submitTask' });

    if (!response.ok) {
        await throwResponseError(response, '任务提交失败');
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
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
        resolution?: string;
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
        requestData.project_id = entityOptions.project_id;
        requestData.episode_id = entityOptions.episode_id;
        requestData.resolution = entityOptions.resolution;
    }


    const routing = await resolveGpuTaskRouting(
        entityOptions?.preferred_agent_id || entityOptions?.preferred_node_id,
    );
    requestData.preferred_agent_id = entityOptions?.preferred_agent_id || routing.preferredAgentId;
    requestData.preferred_node_id = entityOptions?.preferred_node_id || routing.preferredNodeId;
    await confirmProcessingQueue(requestData);

    const response = await apiFetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify(requestData)
    }, { apiName: 'submitUpscaleTask' });

    if (!response.ok) {
        await throwResponseError(response, '放大任务提交失败');
    }

    return await response.json();
}

/**
 * Submit a GPU frame-interpolation task.
 */
export async function submitInterpolateTask(
    videoFilename: string,
    targetFps: 30 | 60 | 120,
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
    },
): Promise<{ task_id: string }> {
    const routing = await resolveGpuTaskRouting(
        entityOptions?.preferred_agent_id || entityOptions?.preferred_node_id,
    );
    return apiJson<{ task_id: string }>('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
            task_type: 'interpolate',
            video_filename: videoFilename,
            target_fps: targetFps,
            seed: -1,
            priority: 2,
            ...entityOptions,
            preferred_agent_id: entityOptions?.preferred_agent_id || routing.preferredAgentId,
            preferred_node_id: entityOptions?.preferred_node_id || routing.preferredNodeId,
        }),
    }, 'submitInterpolateTask');
}

/**
 * 提交配音任务
 */
export async function submitVoiceTask(
    imageFilename: string,
    videoFilename: string,
    audioFilename: string,
    prompt: string,
    model: VideoModel = 'Wan2',
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
    },
    generationOptions?: {
        duration?: number;
    },
): Promise<{ task_id: string }> {
    const routing = await resolveGpuTaskRouting(
        entityOptions?.preferred_agent_id || entityOptions?.preferred_node_id,
    );
    return await apiJson<{ task_id: string }>('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
            task_type: 'voice',
            image_path: imageFilename,
            video_filename: videoFilename,
            audio_filename: audioFilename,
            prompt_AU: prompt,
            model: model,
            seed: -1,
            priority: 2,
            duration: generationOptions?.duration,
            ...entityOptions,
            preferred_agent_id: entityOptions?.preferred_agent_id || routing.preferredAgentId,
            preferred_node_id: entityOptions?.preferred_node_id || routing.preferredNodeId,
        })
    }, 'submitVoiceTask');
}

/**
 * 查询任务状态
 */
export async function getTaskStatus(taskId: string): Promise<VideoTask> {
    const response = await apiFetch(`/api/task/${taskId}`, {}, { apiName: 'getTaskStatus' });

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
    const headers = buildAuthHeaders(undefined, { requireAuth: false, includeContentType: false });
    if (!hasAuthHeader()) {
        return { tasks: [] };
    }

    let response: Response;
    try {
        response = await apiFetch(`/api/tasks?limit=${limit}`, {
            headers,
        }, { apiName: 'getTasks', requireAuth: false, includeContentType: false });
    } catch (e: any) {
        if (e?.message?.includes('未授权')) {
            throw new Error('登录已过期');
        }
        throw e;
    }

    if (!response.ok) {
        if (response.status === 401) {
            handleUnauthorized('getTasks');
        }
        throw new Error('加载历史任务失败');
    }

    return await response.json();
}

// ==================== 会话管理 ====================

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
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
    },
    generationOptions?: VideoGenerationOptions
): Promise<{ task_id: string }> {
    // 外部API模型不需要排队，直接提交
    if (!isComfyUIModel(model)) {
        console.log(`🌐 外部API模型 ${model} 不需要排队，直接提交`);
        return submitTask(imageFilename, imageFilenameEnd, prompt, model, videoFilename, audioFilename, shotType, entityOptions, generationOptions);
    }

    // ComfyUI模型需要排队
    const taskName = imageFilenameEnd ? `视频生成-${model}-首尾帧` : `视频生成-${model}`;
    // 2026-05-20 (M6)：videoService 这 3 处只提交任务、不等待 — 不连 taskRegistry，
    // 等待由 VideoPage 的 videoTaskPoller 单独负责。无需传 registryMeta。
    return enqueueComfyUITask(async (_frontendKey) => {
        return submitTask(imageFilename, imageFilenameEnd, prompt, model, videoFilename, audioFilename, shotType, entityOptions, generationOptions);
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
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
        resolution?: string;
    }
): Promise<{ task_id: string }> {
    return enqueueComfyUITask(async (_frontendKey) => {
        return submitUpscaleTask(videoFilename, entityOptions);
    }, '视频放大');
}

/**
 * Queue execution: GPU frame interpolation.
 */
export async function submitInterpolateTaskQueued(
    videoFilename: string,
    targetFps: 30 | 60 | 120,
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
    },
): Promise<{ task_id: string }> {
    return enqueueComfyUITask(async (_frontendKey) => {
        return submitInterpolateTask(videoFilename, targetFps, entityOptions);
    }, '智能补帧');
}

/**
 * 队列执行：配音任务（ComfyUI工作流，需要排队）
 */
export async function submitVoiceTaskQueued(
    imageFilename: string,
    videoFilename: string,
    audioFilename: string,
    prompt: string,
    model: VideoModel = 'Wan2',
    entityOptions?: {
        entity_type?: string;
        entity_id?: string;
        file_role?: string;
        project_id?: string;
        episode_id?: string;
        preferred_agent_id?: string;
        preferred_node_id?: string;
    },
    generationOptions?: {
        duration?: number;
    },
): Promise<{ task_id: string }> {
    return enqueueComfyUITask(async (_frontendKey) => {
        return submitVoiceTask(
            imageFilename,
            videoFilename,
            audioFilename,
            prompt,
            model,
            entityOptions,
            generationOptions,
        );
    }, '视频配音');
}

// ==================== Seedance 多模态任务 ====================

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
        project_id?: string;
        episode_id?: string;
    },
    draftTaskId?: string,
    agentPlanCompat: boolean = false,
): Promise<{ task_id: string }> {
    // fast / mini 子型号不使用 1080p：前端兜底降级，配合后端二次校验
    const resolution = ((params.sub_model === 'fast' || params.sub_model === 'mini') && params.resolution === '1080p')
        ? '720p'
        : params.resolution;

    const mediaInputs = normalizeSeedanceMediaForSubmission(params.media_inputs, agentPlanCompat);
    const taskType = inferSeedanceTaskType(mediaInputs, !!draftTaskId);
    const body: Record<string, any> = {
        task_type: taskType,
        sub_model: params.sub_model,
        model_scope: params.model_scope,
        prompt: params.prompt,
        media_inputs: mediaInputs,
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
        body.project_id = entityOptions.project_id;
        body.episode_id = entityOptions.episode_id;
    }

    const resp = await apiFetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify(body),
    }, { apiName: 'submitSeedanceTask' });
    if (!resp.ok) {
        await throwResponseError(resp, 'Seedance 任务提交失败');
    }
    return await resp.json();
}

// ==================== DashScope 共享 API · 三家视频模型 ====================

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
        project_id?: string;
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
        // HappyHorse — 面板参数存在 hh_* 字段（hh_ratio/hh_resolution/hh_duration/…），
        // 此前误读通用 params.ratio 导致用户选的 9:16 被忽略、回落 16:9。显式透传 hh_*，
        // worker 也优先读 hh_*；同时给通用字段兜底兼容。
        body.hh_resolution = params.hh_resolution || params.resolution || '1080P';
        body.hh_ratio = params.hh_ratio || params.ratio || '16:9';
        body.hh_duration = params.hh_duration ?? params.duration ?? 5;
        if (params.hh_watermark !== undefined) body.hh_watermark = !!params.hh_watermark;
        if (params.hh_seed !== undefined) body.hh_seed = params.hh_seed;
        body.resolution = body.hh_resolution;
        body.ratio = body.hh_ratio;
        body.duration = body.hh_duration;
    }

    if (entityOptions) {
        body.entity_type = entityOptions.entity_type;
        body.entity_id = entityOptions.entity_id;
        body.file_role = entityOptions.file_role || 'video';
        body.project_id = entityOptions.project_id;
        body.episode_id = entityOptions.episode_id;
    }

    const resp = await apiFetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify(body),
    }, { apiName: 'submitDashScopeVideoTask' });
    if (!resp.ok) {
        await throwResponseError(resp, `${params.model} 任务提交失败`);
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
    const resp = await apiFetch('/api/storyboard/mix-audio', {
        method: 'POST',
        body: JSON.stringify(body),
    }, { apiName: 'mixStoryboardAudio' });
    if (!resp.ok) {
        throw new Error(`mix-audio failed: ${resp.status} ${await resp.text()}`);
    }
    return resp.json();
}

// ==================== Task 6 helpers ====================

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
