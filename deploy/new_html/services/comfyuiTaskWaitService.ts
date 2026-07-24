import type { SourcePage, TaskKind } from "../types";
import { getComfyUIQueueStatus } from './comfyuiTaskQueue';
import type { ComfyQueueRegistryMeta } from './comfyuiTaskQueue';
import { apiJson } from './httpClient';
import { taskRegistry } from './taskRegistry';

// 轮询任务状态时，允许的最大连续瞬时错误次数。2 秒一次轮询，5 次约等于容忍 10 秒的网络抖动，
// 超过才判定生成失败，避免单次网关抖动误杀仍在后端运行的生成任务。
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
const COMFYUI_TASK_TIMEOUT_MS = 30 * 60 * 1000;

export interface ComfyUITaskRegistryMeta {
    title: string;
    kind: TaskKind;
    targetPage?: SourcePage;
    targetEntityId?: string;
    targetEntityType?: string;
    targetProjectId?: string;
    episodeId?: string;
    fileRole?: string;
    targetItemId?: string;
    frontendKey?: string;
}

export interface GeneratedImageResult {
    url: string;
    fileId: string | null;
}

type ErrorNormalizeContext = Pick<ComfyUITaskRegistryMeta, 'kind' | 'title'>;

function sanitizeComfyUIErrorDetail(message: string): string {
    return message
        .replace(/https?:\/\/127\.0\.0\.1:8188\/prompt/gi, '本地 ComfyUI /prompt')
        .replace(/\s+/g, ' ')
        .trim();
}

function workflowLabelFromContext(message: string, context?: ErrorNormalizeContext): string {
    const workflowMatch = message.match(/\bworkflow=([A-Za-z0-9_.-]+)/);
    const workflow = workflowMatch?.[1];
    const workflowLabels: Record<string, string> = {
        I2I_FJ: '角度调整',
        I2I_HUMAN: '多角度人物生成',
        I2I_Around: '全景角度生成',
        upscale_hd: '高清放大',
        remove_watermark: '去水印',
        three_view: '三视图',
    };
    if (workflow && workflowLabels[workflow]) return workflowLabels[workflow];

    const titlePrefix = context?.title?.split('·')[0]?.trim();
    if (titlePrefix) return titlePrefix;

    const kindLabels: Partial<Record<TaskKind, string>> = {
        'angle-adjust': '角度调整',
        'video-upscale': '高清放大',
        matting: '抠图/去水印',
    };
    if (context?.kind && kindLabels[context.kind]) return kindLabels[context.kind]!;

    return '当前';
}

export function toQueueMeta(m: ComfyUITaskRegistryMeta): ComfyQueueRegistryMeta {
    return {
        title: m.title,
        kind: m.kind,
        targetPage: m.targetPage ?? 'generation',
        targetEntityType: m.targetEntityType,
        targetEntityId: m.targetEntityId,
        targetItemId: m.targetItemId ?? m.targetEntityId,
        targetProjectId: m.targetProjectId,
        episodeId: m.episodeId,
        fileRole: m.fileRole,
    };
}

export { getComfyUIQueueStatus };

export function normalizeComfyUITaskError(error: unknown, context?: ErrorNormalizeContext): string {
    const raw = error instanceof Error
        ? error.message
        : typeof error === 'string'
            ? error
            : '';
    const message = raw.trim();

    if (!message) {
        return 'ComfyUI 任务失败。请检查所选 GPU 集群节点 / Agent 日志。';
    }

    if (/400\s+Client Error|Bad Request/i.test(message) && /127\.0\.0\.1:8188\/prompt|\/prompt/i.test(message)) {
        const label = workflowLabelFromContext(message, context);
        const detail = sanitizeComfyUIErrorDetail(message);
        return `GPU 集群节点的 ComfyUI 拒绝了${label}工作流（HTTP 400）。请检查该节点是否安装工作流所需节点和模型，然后重试。详情：${detail}`;
    }

    if (/ComfyUI\s+\/prompt\s+failed:\s*HTTP\s+400/i.test(message)) {
        const label = workflowLabelFromContext(message, context);
        const detail = sanitizeComfyUIErrorDetail(message);
        return `GPU 集群节点的 ComfyUI 拒绝了${label}工作流（HTTP 400）。请检查该节点是否安装工作流所需节点和模型，然后重试。详情：${detail}`;
    }

    if (/Task timed out/i.test(message)) {
        return 'ComfyUI 等待超时。GPU 首次加载模型可能较慢，请检查 GPU 集群节点 / Agent 和 ComfyUI 队列后再重试。';
    }

    if (/Auto-cleanup:\s*stale task exceeded timeout/i.test(message)) {
        return '任务长时间未被 GPU 集群节点接走，已被系统自动清理。请确认目标 Agent 在线后再重试。';
    }

    return sanitizeComfyUIErrorDetail(message);
}

function errorWithTaskId(message: string, taskId: string): Error {
    return new Error(`${message} (task_id: ${taskId})`);
}

export const checkComfyUITaskStatus = async (taskId: string): Promise<{
    status: string;
    progress: number;
    result?: any;
    error?: string;
}> => {
    try {
        const data = await apiJson<any>(
            `/api/task/${taskId}`,
            { method: 'GET' },
            'Query ComfyUI task status',
            { authErrorMessage: 'Not logged in' }
        );
        if (data.status === 'completed') {
            console.log(`ComfyUI task ${taskId} completed:`, JSON.stringify(data.result, null, 2));
        }
        return {
            status: data.status,
            progress: data.progress || 0,
            result: data.result,
            error: data.error,
        };
    } catch (error) {
        console.error('Check Task Status Error:', error);
        throw error;
    }
};

function registryKeyFor(taskId: string, registryMeta?: ComfyUITaskRegistryMeta): string {
    return registryMeta?.frontendKey || taskId;
}

function registerTask(taskId: string, registryMeta?: ComfyUITaskRegistryMeta): string {
    const registryKey = registryKeyFor(taskId, registryMeta);
    if (!registryMeta) return registryKey;

    try {
        taskRegistry.register({
            taskId: registryKey,
            kind: registryMeta.kind,
            title: registryMeta.title,
            targetPage: registryMeta.targetPage ?? 'generation',
            initialStatus: 'running',
            progress: 0,
            queuePosition: undefined,
            targetEntityType: registryMeta.targetEntityType,
            targetEntityId: registryMeta.targetEntityId,
            targetItemId: registryMeta.targetItemId ?? registryMeta.targetEntityId,
            targetProjectId: registryMeta.targetProjectId,
            episodeId: registryMeta.episodeId,
            fileRole: registryMeta.fileRole,
        });
    } catch {
        // Registry updates are best-effort and should not block generation.
    }
    return registryKey;
}

function updateTaskProgress(registryKey: string, status: Awaited<ReturnType<typeof checkComfyUITaskStatus>>, hasRegistryMeta: boolean): void {
    if (!hasRegistryMeta || status.progress == null) return;
    const normalized = status.progress > 1 ? status.progress / 100 : status.progress;
    try {
        taskRegistry.update(registryKey, { status: 'running', progress: normalized });
    } catch {
        // noop
    }
}

function failTask(registryKey: string, hasRegistryMeta: boolean, message: string): void {
    if (!hasRegistryMeta) return;
    try {
        taskRegistry.fail(registryKey, message);
    } catch {
        // noop
    }
}

function completeTask(registryKey: string, hasRegistryMeta: boolean, resultUrls: string[]): void {
    if (!hasRegistryMeta) return;
    try {
        taskRegistry.complete(registryKey, { resultUrls, progress: 1 });
    } catch {
        // noop
    }
}

export const waitForComfyUITask = async (
    taskId: string,
    onProgress?: (progress: number) => void,
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<string> => {
    const registryKey = registerTask(taskId, registryMeta);
    const hasRegistryMeta = Boolean(registryMeta);

    return new Promise((resolve, reject) => {
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let consecutiveErrors = 0;

        const finish = (cb: () => void) => {
            if (pollInterval !== null) clearInterval(pollInterval);
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            cb();
        };

        pollInterval = setInterval(async () => {
            try {
                const status = await checkComfyUITaskStatus(taskId);
                // 一次状态读取成功就清零瞬时错误计数。
                consecutiveErrors = 0;

                if (onProgress && status.progress != null) {
                    onProgress(status.progress);
                }
                updateTaskProgress(registryKey, status, hasRegistryMeta);

                if (status.status === 'completed') {
                    const url = status.result?.videos?.[0]?.url || status.result?.images?.[0]?.url;
                    if (!url) {
                        failTask(registryKey, hasRegistryMeta, 'No generated result found');
                        finish(() => reject(new Error('No generated result found')));
                        return;
                    }
                    completeTask(registryKey, hasRegistryMeta, [url]);
                    finish(() => resolve(url));
                } else if (status.status === 'failed') {
                    const message = normalizeComfyUITaskError(status.error || 'Generation failed', registryMeta);
                    failTask(registryKey, hasRegistryMeta, message);
                    finish(() => reject(errorWithTaskId(message, taskId)));
                }
            } catch (error: any) {
                // 单次轮询出错（网络抖动 / 网关 502 等）不代表生成失败：后端任务很可能仍在运行。
                // 容忍若干次连续失败后才放弃，避免把正常生成中的镜头误判为失败。
                consecutiveErrors += 1;
                if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
                    const message = normalizeComfyUITaskError(error?.message || 'Generation failed', registryMeta);
                    failTask(registryKey, hasRegistryMeta, message);
                    finish(() => reject(errorWithTaskId(message, taskId)));
                } else {
                    console.warn(`轮询任务 ${taskId} 第 ${consecutiveErrors} 次出错，继续重试:`, error?.message || error);
                }
            }
        }, 2000);

        timeoutHandle = setTimeout(() => {
            const message = normalizeComfyUITaskError('Task timed out', registryMeta);
            failTask(registryKey, hasRegistryMeta, message);
            finish(() => reject(errorWithTaskId(message, taskId)));
        }, COMFYUI_TASK_TIMEOUT_MS);
    });
};

export const waitForComfyUITaskAllImages = async (
    taskId: string,
    onProgress?: (progress: number) => void,
    registryMeta?: ComfyUITaskRegistryMeta,
): Promise<GeneratedImageResult[]> => {
    const registryKey = registerTask(taskId, registryMeta);
    const hasRegistryMeta = Boolean(registryMeta);

    return new Promise((resolve, reject) => {
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let consecutiveErrors = 0;

        const finish = (cb: () => void) => {
            if (pollInterval !== null) clearInterval(pollInterval);
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            cb();
        };

        pollInterval = setInterval(async () => {
            try {
                const status = await checkComfyUITaskStatus(taskId);
                // 一次状态读取成功就清零瞬时错误计数。
                consecutiveErrors = 0;

                if (onProgress && status.progress != null) {
                    onProgress(status.progress);
                }
                updateTaskProgress(registryKey, status, hasRegistryMeta);

                if (status.status === 'completed') {
                    const images = status.result?.images || [];
                    console.log(`ComfyUI returned ${images.length} images:`, images);
                    const results: GeneratedImageResult[] = images
                        .filter((img: any) => img.url)
                        .map((img: any) => ({
                            url: img.url,
                            fileId: img.file_id || null,
                        }));
                    console.log(`Extracted ${results.length} ComfyUI image results:`, results);

                    if (results.length === 0) {
                        failTask(registryKey, hasRegistryMeta, 'No generated result found');
                        finish(() => reject(new Error('No generated result found')));
                        return;
                    }

                    completeTask(registryKey, hasRegistryMeta, results.map(r => r.url));
                    finish(() => resolve(results));
                } else if (status.status === 'failed') {
                    const message = normalizeComfyUITaskError(status.error || 'Generation failed', registryMeta);
                    failTask(registryKey, hasRegistryMeta, message);
                    finish(() => reject(errorWithTaskId(message, taskId)));
                }
            } catch (error: any) {
                // 单次轮询出错（网络抖动 / 网关 502 等）不代表生成失败：后端任务很可能仍在运行。
                // 容忍若干次连续失败后才放弃，避免把正常生成中的镜头误判为失败。
                consecutiveErrors += 1;
                if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
                    const message = normalizeComfyUITaskError(error?.message || 'Generation failed', registryMeta);
                    failTask(registryKey, hasRegistryMeta, message);
                    finish(() => reject(errorWithTaskId(message, taskId)));
                } else {
                    console.warn(`轮询任务 ${taskId} 第 ${consecutiveErrors} 次出错，继续重试:`, error?.message || error);
                }
            }
        }, 2000);

        timeoutHandle = setTimeout(() => {
            const message = normalizeComfyUITaskError('Task timed out', registryMeta);
            failTask(registryKey, hasRegistryMeta, message);
            finish(() => reject(errorWithTaskId(message, taskId)));
        }, COMFYUI_TASK_TIMEOUT_MS);
    });
};
