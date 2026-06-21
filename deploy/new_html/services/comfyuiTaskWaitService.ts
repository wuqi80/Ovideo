import type { SourcePage, TaskKind } from "../types";
import { getComfyUIQueueStatus } from './comfyuiTaskQueue';
import type { ComfyQueueRegistryMeta } from './comfyuiTaskQueue';
import { apiJson } from './httpClient';
import { taskRegistry } from './taskRegistry';

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

        const finish = (cb: () => void) => {
            if (pollInterval !== null) clearInterval(pollInterval);
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            cb();
        };

        pollInterval = setInterval(async () => {
            try {
                const status = await checkComfyUITaskStatus(taskId);

                if (onProgress && status.progress) {
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
                    const message = status.error || 'Generation failed';
                    failTask(registryKey, hasRegistryMeta, message);
                    finish(() => reject(new Error(message)));
                }
            } catch (error: any) {
                failTask(registryKey, hasRegistryMeta, error?.message || 'Generation failed');
                finish(() => reject(error));
            }
        }, 2000);

        timeoutHandle = setTimeout(() => {
            failTask(registryKey, hasRegistryMeta, 'Task timed out');
            finish(() => reject(new Error('Task timed out')));
        }, 300000);
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

        const finish = (cb: () => void) => {
            if (pollInterval !== null) clearInterval(pollInterval);
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            cb();
        };

        pollInterval = setInterval(async () => {
            try {
                const status = await checkComfyUITaskStatus(taskId);

                if (onProgress && status.progress) {
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
                    const message = status.error || 'Generation failed';
                    failTask(registryKey, hasRegistryMeta, message);
                    finish(() => reject(new Error(message)));
                }
            } catch (error: any) {
                failTask(registryKey, hasRegistryMeta, error?.message || 'Generation failed');
                finish(() => reject(error));
            }
        }, 2000);

        timeoutHandle = setTimeout(() => {
            failTask(registryKey, hasRegistryMeta, 'Task timed out');
            finish(() => reject(new Error('Task timed out')));
        }, 300000);
    });
};
