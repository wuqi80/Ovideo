/**
 * ComfyUI 全局任务队列
 * 
 * 确保同一账号同时只有一个ComfyUI任务在执行
 * 
 * 需要排队的ComfyUI任务：
 * - 视频生成: Wan2, 一阶~七阶
 * - 视频放大: upscale
 * - 配音: voice  
 * - 画面分镜: Qwen, Qwen LoRA, Kontext, qwenN
 * - 角度调整: i2i_fj
 * - 多角度人物: i2i_human
 * - 全景角度: i2i_around
 * 
 * 不需要排队的外部API任务：
 * - MINI (MiniMax API)
 * - Sora2 (老张API)
 * - Veo (老张API)
 * - 大能/Wan2.6 (阿里云API)
 * - NanoBanana/化神 (Gemini API)
 * - 豆包图像生成 (豆包API)
 *
 * 2026-05-20 (Task System Overhaul M6)：与 taskRegistry 联动。
 * 调用方传 registryMeta 时：
 *   1. enqueue 立即用 frontendKey 注册一条 RegisteredTask（status='queued', queuePosition=N）
 *   2. 队列变化时同步所有 queued 任务的 queuePosition（"前面 N 个"实时刷新）
 *   3. dequeue（_runTask 入口）→ update 为 status='running', queuePosition=undefined
 *   4. taskFn 内部 wait 函数被注入相同 frontendKey，幂等 update 同一条 RegisteredTask
 * 这样从用户视角，"画面分镜 镜头3" 是单条任务从「排队中（前面 2 个）」流畅过渡到「执行中 30%」。
 */

import { taskRegistry } from './taskRegistry';
import type { TaskKind, SourcePage } from '../types';

/** 队列侧持有的任务注册元数据（与 geminiService 的 ComfyUITaskRegistryMeta 同形态，避免循环依赖） */
export interface ComfyQueueRegistryMeta {
    title: string;
    kind: TaskKind;
    targetPage: SourcePage;
    targetEntityType?: string;
    targetEntityId?: string;
    targetItemId?: string;
    targetProjectId?: string;
    episodeId?: string;
    fileRole?: string;
}

interface QueuedTask<T> {
    id: string;
    name: string;
    /** 2026-05-20 (M6)：execute 接收 frontendKey 参数，可注入到 wait 函数让 register 复用同一 RegisteredTask */
    execute: (frontendKey: string) => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: any) => void;
    addedAt: number;
    /** 排队期注册到 taskRegistry 的元数据；undefined 表示调用方未启用 registry 联动 */
    registryMeta?: ComfyQueueRegistryMeta;
}

type QueueEventCallback = (event: QueueEvent) => void;

export interface QueueEvent {
    type: 'task_added' | 'task_started' | 'task_completed' | 'task_failed';
    taskId: string;
    taskName: string;
    queueLength: number;
    isRunning: boolean;
}

class ComfyUITaskQueue {
    private queue: QueuedTask<any>[] = [];
    private runningCount = 0;
    // Keep browser submissions serial too, so every preflight observes the latest
    // authoritative GPU2 queue position before the next task is submitted.
    private maxConcurrent = 1;
    private currentTaskId: string | null = null;
    private currentTaskName: string | null = null;
    private listeners: QueueEventCallback[] = [];
    private taskIdCounter = 0;

    get isProcessing(): boolean {
        return this.runningCount > 0;
    }

    /**
     * 将任务加入队列
     * @param taskFn 任务执行函数（接收 frontendKey 参数，可注入到 wait 函数复用 RegisteredTask）
     * @param taskName 任务名称（用于日志和UI显示）
     * @param registryMeta 可选：传入则在排队期就注册到 taskRegistry，让铃铛 / TaskBadge 看到「排队中（前面 N 个）」
     * @returns Promise，在任务完成时resolve
     */
    async enqueue<T>(
        taskFn: (frontendKey: string) => Promise<T>,
        taskName: string = '处理任务',
        registryMeta?: ComfyQueueRegistryMeta,
    ): Promise<T> {
        const taskId = `comfyui_${++this.taskIdCounter}_${Date.now()}`;

        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                id: taskId,
                name: taskName,
                execute: taskFn,
                resolve,
                reject,
                addedAt: Date.now(),
                registryMeta,
            });

            // 2026-05-20 (M6)：调用方传 registryMeta → 立刻注册一条 'queued' 任务到 taskRegistry。
            // queuePosition = 当前 queue 中索引（最尾巴 = queue.length - 1）。
            if (registryMeta) {
                try {
                    taskRegistry.register({
                        taskId,
                        kind: registryMeta.kind,
                        title: registryMeta.title,
                        targetPage: registryMeta.targetPage,
                        initialStatus: 'queued',
                        queuePosition: this.queue.length - 1,
                        targetEntityType: registryMeta.targetEntityType,
                        targetEntityId: registryMeta.targetEntityId,
                        targetItemId: registryMeta.targetItemId,
                        targetProjectId: registryMeta.targetProjectId,
                        episodeId: registryMeta.episodeId,
                        fileRole: registryMeta.fileRole,
                    });
                } catch (e) {
                    console.warn('[处理队列] register 失败 (不影响任务):', e);
                }
            }

            console.log(`📋 [处理队列] 任务已加入: ${taskName} (ID: ${taskId})`);
            console.log(`   当前队列长度: ${this.queue.length}, 是否有任务执行中: ${this.isProcessing}`);

            this.emit({
                type: 'task_added',
                taskId,
                taskName,
                queueLength: this.queue.length,
                isRunning: this.isProcessing
            });

            this.processNext();
        });
    }

    /**
     * 2026-05-20 (M6)：扫描 queue，对每条带 registryMeta 的任务 update queuePosition。
     * 在 task_started / task_completed / task_failed / task_added 后调用，让铃铛上的"前面 N 个"实时刷新。
     */
    private syncQueuePositions(): void {
        for (let i = 0; i < this.queue.length; i++) {
            const t = this.queue[i];
            if (!t.registryMeta) continue;
            try {
                taskRegistry.update(t.id, { queuePosition: i, status: 'queued' });
            } catch { /* noop */ }
        }
    }

    private async processNext() {
        while (this.runningCount < this.maxConcurrent && this.queue.length > 0) {
            this.runningCount++;
            const task = this.queue.shift()!;
            this.currentTaskId = task.id;
            this.currentTaskName = task.name;
            this._runTask(task);
        }
    }

    private async _runTask(task: QueuedTask<any>) {
        // 2026-05-20 (M6)：dequeue 瞬间把这条任务从 queued → running，并刷新其它任务的 queuePosition。
        if (task.registryMeta) {
            try { taskRegistry.update(task.id, { status: 'running', queuePosition: undefined, progress: 0 }); } catch { /* noop */ }
        }
        this.syncQueuePositions();

        this.emit({
            type: 'task_started',
            taskId: task.id,
            taskName: task.name,
            queueLength: this.queue.length,
            isRunning: true
        });

        const waitTime = Date.now() - task.addedAt;
        console.log(`🚀 [处理队列] 开始执行: ${task.name} (等待了 ${Math.round(waitTime/1000)}秒, 并发: ${this.runningCount}/${this.maxConcurrent})`);

        try {
            // 2026-05-20 (M6)：把 frontendKey 注入 taskFn —— 调用方可以传给 wait 函数让 register 复用同一条 task
            const result = await task.execute(task.id);

            console.log(`✅ [处理队列] 任务完成: ${task.name}`);

            // 2026-05-20 (M6)：兜底 complete —— 若 taskFn 内部 wait 函数已 complete 过则幂等更新；
            // 若 taskFn 仅做提交不等待（如 videoService 的 submitTaskQueued）则保留 running，
            // 因此仅在仍为 running/queued 时才标记 completed（避免覆盖 wait 函数已设的 resultUrls）。
            if (task.registryMeta) {
                const reg = taskRegistry.get(task.id);
                if (reg && (reg.status === 'running' || reg.status === 'queued')) {
                    try { taskRegistry.complete(task.id); } catch { /* noop */ }
                }
            }

            this.emit({
                type: 'task_completed',
                taskId: task.id,
                taskName: task.name,
                queueLength: this.queue.length,
                isRunning: this.runningCount > 1
            });

            task.resolve(result);
        } catch (error) {
            console.error(`❌ [处理队列] 任务失败: ${task.name}`, error);

            // 2026-05-20 (M6)：失败兜底 —— wait 函数已在 catch 里 fail 过，但若是 submit 阶段抛错（taskFn 内部）
            // 则未必走过 wait → 这里再 fail 一次（taskRegistry.fail 幂等，多次调用安全）。
            if (task.registryMeta) {
                try { taskRegistry.fail(task.id, (error as any)?.message || '处理任务失败'); } catch { /* noop */ }
            }

            this.emit({
                type: 'task_failed',
                taskId: task.id,
                taskName: task.name,
                queueLength: this.queue.length,
                isRunning: this.runningCount > 1
            });

            task.reject(error);
        } finally {
            this.runningCount--;
            if (this.runningCount <= 0) {
                this.currentTaskId = null;
                this.currentTaskName = null;
            }
            this.processNext();
        }
    }

    /**
     * 获取队列状态
     */
    getStatus(): {
        queueLength: number;
        isRunning: boolean;
        currentTaskId: string | null;
        currentTaskName: string | null;
        pendingTasks: { id: string; name: string; waitTime: number }[];
    } {
        const now = Date.now();
        return {
            queueLength: this.queue.length,
            isRunning: this.isProcessing,
            currentTaskId: this.currentTaskId,
            currentTaskName: this.currentTaskName,
            pendingTasks: this.queue.map(t => ({
                id: t.id,
                name: t.name,
                waitTime: Math.round((now - t.addedAt) / 1000)
            }))
        };
    }

    /**
     * 添加事件监听器
     */
    addEventListener(callback: QueueEventCallback): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private emit(event: QueueEvent) {
        this.listeners.forEach(callback => {
            try {
                callback(event);
            } catch (e) {
                console.error('队列事件处理器错误:', e);
            }
        });
    }

    /**
     * 2026-05-20 (M6)：测试用 — 清空所有内部状态（队列 + runningCount + 当前任务标记）。
     * 仅在测试 beforeEach 中调用以隔离 singleton 跨测试污染；生产代码勿用。
     */
    _resetForTesting(): void {
        this.queue.forEach(task => {
            try { task.reject(new Error('队列重置')); } catch { /* noop */ }
            if (task.registryMeta) {
                try { taskRegistry.cancel(task.id); } catch { /* noop */ }
            }
        });
        this.queue = [];
        this.runningCount = 0;
        this.currentTaskId = null;
        this.currentTaskName = null;
    }

    /**
     * 清空队列（仅用于紧急情况）
     */
    clearQueue(): number {
        const count = this.queue.length;
        this.queue.forEach(task => {
            // 2026-05-20 (M6)：clear 时把已注册的排队任务标记 cancelled，避免铃铛上一直显示"排队中"
            if (task.registryMeta) {
                try { taskRegistry.cancel(task.id); } catch { /* noop */ }
            }
            task.reject(new Error('队列已清空'));
        });
        this.queue = [];
        console.log(`🗑️ [处理队列] 已清空 ${count} 个等待中的任务`);
        return count;
    }
}

// 全局单例
export const comfyuiTaskQueue = new ComfyUITaskQueue();

// 导出便捷函数
export const enqueueComfyUITask = <T>(
    taskFn: (frontendKey: string) => Promise<T>,
    taskName?: string,
    registryMeta?: ComfyQueueRegistryMeta,
) =>
    comfyuiTaskQueue.enqueue(taskFn, taskName, registryMeta);

export const getComfyUIQueueStatus = () => comfyuiTaskQueue.getStatus();

export const onComfyUIQueueEvent = (callback: QueueEventCallback) => 
    comfyuiTaskQueue.addEventListener(callback);

