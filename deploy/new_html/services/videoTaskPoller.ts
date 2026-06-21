// 2026-05-20 (Task System Overhaul M2b): 模块级视频任务轮询 service。
//
// 为什么存在
// ----------
// 原来 VideoPage 把 setInterval 句柄放在 component-scoped useRef 里，组件
// unmount（用户切到其它页）时 cleanup 一律 clearInterval。后果：用户离开
// 视频页后任务"前端意义上不再被监控" —— 铃铛/Toast 不更新，完成通知会延迟
// 到下次回到该页才触发，与「切页后台继续生成 + 完成通知」需求严重冲突。
//
// 设计要点
// ---------
// 1. 用模块级 Map<uuid, IntervalHandle> 持有 interval 句柄；模块只 import
//    一次，刷新整页才重建 → 跨页跳转完全保留。
// 2. 同时维护 callbacks Map<uuid, Callbacks>。组件 mount 时 attach，unmount
//    时 detach（不清 interval）。
// 3. 所有状态变更都同步到 `taskRegistry`，让铃铛/Badge/历史看得到。
// 4. 暴露 `getKnownVideoTaskIds()` 给 VideoPage 在 mount 时反向同步。
//
// 关于 uuid vs taskId
// -------------------
// VideoPage 业务侧用 `group.uuid` 索引一切（imagePrompts、tasksStatus），
// 我们的 entries Map 也以 uuid 为键 —— 一个 group 同一时刻最多一条 polling。
// 但 taskRegistry 的唯一键是后端 `task_id`（每次提交都是独立任务），所以
// 调用 taskRegistry.register/update/... 时必须用 backendTaskId。两者通过
// `targetEntityId = uuid` 关联回业务侧。

import * as videoTaskService from './videoTaskService';
import { taskRegistry } from './taskRegistry';
import type { SourcePage, TaskKind, GlobalTaskStatus } from '../types';

export type VideoPollStatus = 'queued' | 'running' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface VideoPollCompletePayload {
    /** 后端返回的最新状态对象（VideoPage 自己拼 URL / 写视频数组）。 */
    status: videoTaskService.VideoTask;
}

export interface VideoPollCallbacks {
    /** 进度 / 状态更新；status 是后端原始字符串映射后的统一值。 */
    onProgress?: (progress: number, status: VideoPollStatus) => void;
    /** 任务成功完成。VideoPage 自己负责拼 URL 和写视频数组。 */
    onComplete?: (payload: VideoPollCompletePayload) => void;
    /** 任务失败 / 取消 / 不存在。 */
    onFail?: (error: string) => void;
}

interface PollerEntry {
    /** 业务侧 group uuid（VideoPage 索引键） */
    uuid: string;
    /** 后端任务 id（taskRegistry 索引键） */
    backendTaskId: string;
    intervalId: ReturnType<typeof setInterval> | null;
    callbacks: VideoPollCallbacks | null;
    pollIntervalMs: number;
}

const entries = new Map<string, PollerEntry>();

export interface StartVideoPollOptions {
    /** 后端任务 ID（用于 videoTaskService.getTaskStatus + taskRegistry 索引）。 */
    taskId: string;
    /** 全局 TaskRegistry 中的展示标题。 */
    title: string;
    /** 注册到 TaskRegistry 的 kind（默认 'video-i2v'）。 */
    kind?: TaskKind;
    /** 哪个页面发起的（用于 per-page 徽章 / 跳转目标）。默认 'video'。 */
    targetPage?: SourcePage;
    episodeId?: string | null;
    projectId?: string | null;
    /** 业务实体 id（通常 = group.uuid，用于回页面后定位卡片）。 */
    targetEntityId?: string;
    /** 业务实体类型（默认 'video_segment'）。 */
    targetEntityType?: string;
    /** 轮询间隔，默认 3000ms。 */
    pollIntervalMs?: number;
    /** 立刻 attach 的回调（首次 register 时也支持）。 */
    callbacks?: VideoPollCallbacks;
}

/** Internal: build a poll function for an entry. */
function buildPollFn(uuid: string): () => Promise<void> {
    return async function poll() {
        const entry = entries.get(uuid);
        if (!entry) return;
        try {
            const status = await videoTaskService.getTaskStatus(entry.backendTaskId);
            const cbs = entry.callbacks;
            if (status.status === 'completed') {
                stopAndClear(uuid);
                try { taskRegistry.complete(entry.backendTaskId); } catch { /* noop */ }
                cbs?.onComplete?.({ status });
            } else if (status.status === 'failed' || status.status === 'cancelled') {
                stopAndClear(uuid);
                const err = status.error || '任务失败';
                try { taskRegistry.fail(entry.backendTaskId, err); } catch { /* noop */ }
                cbs?.onFail?.(err);
            } else if (status.status === 'processing' || status.status === 'queued') {
                const rawProgress = status.progress ?? 0;
                // 后端 progress 用 0-100；RegisteredTask.progress 文档约定 0-1 区间。
                // 回调 onProgress 仍传 0-100 以保持 VideoPage 旧行为。
                const normalized = rawProgress > 1 ? rawProgress / 100 : rawProgress;
                const mapped: VideoPollStatus = status.status === 'queued' ? 'queued' : 'processing';
                const regStatus: GlobalTaskStatus = status.status === 'queued' ? 'queued' : 'running';
                try {
                    taskRegistry.update(entry.backendTaskId, {
                        status: regStatus,
                        progress: normalized,
                    });
                } catch { /* noop */ }
                cbs?.onProgress?.(rawProgress, mapped);
            }
        } catch (error: any) {
            if (error?.message === 'TASK_NOT_FOUND') {
                // 先拿 callbacks 引用，再 stopAndClear（stopAndClear 会从 entries 移除）
                const cbs = entry.callbacks;
                stopAndClear(uuid);
                try { taskRegistry.fail(entry.backendTaskId, '任务不存在'); } catch { /* noop */ }
                cbs?.onFail?.('任务不存在');
            }
            // 其它瞬时错误：吞掉，下一拍再试
        }
    };
}

function stopAndClear(uuid: string): void {
    const entry = entries.get(uuid);
    if (!entry) return;
    if (entry.intervalId !== null) {
        clearInterval(entry.intervalId);
        entry.intervalId = null;
    }
    entries.delete(uuid);
}

/**
 * 启动一个视频任务的轮询。如果同 uuid 已经在轮询：
 *   - 重置 backendTaskId（少见，但允许重新提交同一个 group）
 *   - 重新绑定回调（原有的会被覆盖）
 *   - 不启动重复 interval。
 */
export function startVideoPoll(uuid: string, options: StartVideoPollOptions): void {
    const existing = entries.get(uuid);

    const registerInput = {
        taskId: options.taskId,
        kind: options.kind ?? ('video-i2v' as TaskKind),
        title: options.title,
        targetPage: options.targetPage ?? ('video' as SourcePage),
        initialStatus: 'running' as GlobalTaskStatus,
        progress: 0,
        targetEntityType: options.targetEntityType ?? 'video_segment',
        targetEntityId: options.targetEntityId ?? uuid,
        targetProjectId: options.projectId ?? undefined,
        episodeId: options.episodeId ?? undefined,
    };

    if (existing) {
        existing.backendTaskId = options.taskId;
        existing.callbacks = options.callbacks ?? existing.callbacks;
        try { taskRegistry.register(registerInput); } catch { /* noop */ }
        return;
    }

    const entry: PollerEntry = {
        uuid,
        backendTaskId: options.taskId,
        intervalId: null,
        callbacks: options.callbacks ?? null,
        pollIntervalMs: options.pollIntervalMs ?? 3000,
    };
    entries.set(uuid, entry);

    try { taskRegistry.register(registerInput); } catch { /* noop */ }

    const poll = buildPollFn(uuid);
    entry.intervalId = setInterval(poll, entry.pollIntervalMs);
    void poll();
}

/** 解绑回调但保留轮询继续运行（组件 unmount 时调用）。 */
export function detachVideoPollCallbacks(uuid: string): void {
    const entry = entries.get(uuid);
    if (!entry) return;
    entry.callbacks = null;
}

/** 重新绑定回调（组件重新 mount 时调用）。返回轮询是否还存在。 */
export function attachVideoPollCallbacks(uuid: string, callbacks: VideoPollCallbacks): boolean {
    const entry = entries.get(uuid);
    if (!entry) return false;
    entry.callbacks = callbacks;
    return true;
}

/** 强制停止某个轮询（例如用户主动取消任务）。 */
export function stopVideoPoll(uuid: string): void {
    stopAndClear(uuid);
}

/** 当前已知的所有 polling uuid。 */
export function getKnownVideoTaskIds(): string[] {
    return Array.from(entries.keys());
}

/** 该 uuid 是否还在被轮询。 */
export function isVideoPollActive(uuid: string): boolean {
    return entries.has(uuid);
}

/** 获取后端 backendTaskId（用于 mount 时恢复 tasksStatus.taskId）。 */
export function getVideoPollTaskId(uuid: string): string | null {
    return entries.get(uuid)?.backendTaskId ?? null;
}

/** 仅给测试 / 热重载用：清空所有 poller。 */
export function __resetVideoTaskPollerForTesting(): void {
    for (const uuid of Array.from(entries.keys())) stopAndClear(uuid);
}
