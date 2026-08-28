/**
 * 全局任务管理器
 * SSE 优先推送 + HTTP 轮询降级
 */
import type { GlobalTask, TaskNotification } from '../types';
import { authTokenFromHeaders } from './httpClient';
import { getActiveTasks, getTaskNotifications } from './taskNotificationService';

function normalizeProgress(value: unknown): number | undefined {
    if (value == null || value === '' || typeof value === 'boolean') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    const normalized = numeric > 1 ? numeric / 100 : numeric;
    return Math.min(1, Math.max(0, normalized));
}

export type TaskEventType = 'tasks_updated' | 'tasks_terminal' | 'notification' | 'progress';
export type TaskEventCallback = (
    type: TaskEventType,
    data: {
        tasks?: GlobalTask[];
        notification?: TaskNotification;
        taskId?: string;
        progress?: number;
        message?: string;
        /**
         * 2026-05-20 (Phase 8)：'progress' 事件携带的原始 SSE payload 副本，
         * 让 TaskContext 能从中提取 stage/step/totalSteps/etaSeconds/workerNodeId 等
         * 富展示字段写入 RegisteredTask.metadata（不强约束 schema，后端日后加字段
         * 前端不需改类型）。
         */
        raw?: Record<string, unknown>;
    }
) => void;

export class GlobalTaskManager {
    private listeners: TaskEventCallback[] = [];
    private pollingTimer: ReturnType<typeof setInterval> | null = null;
    private lastPollTime = 0;
    private activeTasks: GlobalTask[] = [];
    private pollingIntervalMs: number | null = null;
    private readonly fallbackPollIntervalMs = 5000;
    private readonly reconciliationPollIntervalMs = 15000;
    private eventSource: EventSource | null = null;
    private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private sseConnected = false;
    private notificationBaselineReady = false;
    private emittedNotificationIds: Set<string> = new Set();
    private maxRememberedNotificationIds = 300;

    start() {
        if (this.eventSource || this.pollingTimer) return;
        this.trySSE();
    }

    stop() {
        this.stopSSE();
        this.stopPolling();
    }

    private trySSE() {
        const token = authTokenFromHeaders({ requireAuth: false });
        if (!token) {
            this.startPollingFallback();
            return;
        }

        try {
            this.eventSource = new EventSource(`/api/tasks/stream?token=${encodeURIComponent(token)}`);

            this.eventSource.onopen = () => {
                console.log('[TaskManager] SSE 已连接');
                this.sseConnected = true;
                // SSE 可能在页面切换、代理重连或浏览器休眠期间漏掉一次终态。
                // 保留低频 HTTP 对账，避免服务端已 completed、前端仍永久 running。
                this.startPolling(this.reconciliationPollIntervalMs);
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSSEMessage(data);
                } catch (e) {
                    console.warn('[TaskManager] SSE 消息解析失败:', e);
                }
            };

            this.eventSource.onerror = () => {
                console.warn('[TaskManager] SSE 断开，降级轮询');
                this.stopSSE();
                this.startPollingFallback();
                this.sseReconnectTimer = setTimeout(() => {
                    if (!this.eventSource) this.trySSE();
                }, 10000);
            };
        } catch {
            this.startPollingFallback();
        }
    }

    private stopSSE() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.sseConnected = false;
        if (this.sseReconnectTimer) {
            clearTimeout(this.sseReconnectTimer);
            this.sseReconnectTimer = null;
        }
    }

    private handleSSEMessage(data: any) {
        if (data.type === 'task_complete' || data.type === 'task_failed') {
            if (data.type === 'task_complete' && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('credits:updated'));
            }
            const notification: TaskNotification = {
                id: data.task_id,
                type: this.mapTaskType(data.task_type || ''),
                status: data.type === 'task_complete' ? 'completed' : 'failed',
                message: `${data.display_name || data.task_type || '任务'} ${data.type === 'task_complete' ? '已完成' : '失败'}`,
                targetView: 'Video' as any,
                targetProjectId: data.project_id,
                targetPage: this.normalizeTaskSourcePage(data.source_page, data.entity_type),
                timestamp: Date.now(),
                taskId: data.task_id,
                taskType: data.task_type || undefined,
                entityType: data.entity_type || undefined,
                entityId: data.entity_id || undefined,
                fileRole: data.file_role || undefined,
                episodeId: data.episode_id || undefined,
                targetItemId: data.source_item_id || data.entity_id || undefined,
                provider: data.provider || undefined,
                modelName: data.model || data.model_name || undefined,
            };
            if (this.rememberNotificationId(notification.id)) {
                this.emit('notification', { notification });
            }
            this.poll();
        } else {
            this.emit('progress', {
                taskId: data.task_id,
                progress: normalizeProgress(data.progress),
                message: data.message,
                // 2026-05-20 (Phase 8)：把 SSE 原始 payload 透传给 TaskContext，
                // 由后者按需 cherry-pick 字段（stage/step/eta/worker_node_id/...）写入 metadata。
                raw: data,
            });
        }
    }

    private startPollingFallback() {
        this.startPolling(this.fallbackPollIntervalMs);
        console.log('[TaskManager] 轮询已启动');
    }

    private startPolling(intervalMs: number) {
        if (this.pollingTimer && this.pollingIntervalMs === intervalMs) return;
        this.stopPolling();
        void this.poll();
        this.pollingIntervalMs = intervalMs;
        this.pollingTimer = setInterval(() => void this.poll(), intervalMs);
    }

    private stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
        this.pollingIntervalMs = null;
    }

    private async poll() {
        const pollStartedAt = Date.now();
        const isBaselinePoll = !this.notificationBaselineReady;
        // 首轮拉取最近终态用于修复 sessionStorage 中的幽灵 running，但不弹历史通知。
        // 后续保留 60 秒重叠窗口，抵消浏览器/服务器时钟偏差；notification id 会负责去重。
        const since = this.lastPollTime ? Math.max(0, this.lastPollTime - 60_000) : undefined;

        try {
            const [activeRes, notifRes] = await Promise.all([
                getActiveTasks().catch(() => null),
                getTaskNotifications(since).catch(() => null)
            ]);

            if (activeRes?.success && activeRes.tasks) {
                this.activeTasks = activeRes.tasks.map((t: any) => ({
                    id: t.task_id,
                    category: t.category || t.task_type,
                    taskType: t.task_type || undefined,
                    status: t.status === 'processing' ? 'running' : t.status,
                    displayName: t.display_name || t.task_type,
                    projectId: t.project_id || '',
                    sourcePage: this.normalizeTaskSourcePage(t.source_page, t.entity_type),
                    sourceItemId: t.source_item_id || t.entity_id,
                    entityType: t.entity_type || undefined,
                    entityId: t.entity_id || undefined,
                    fileRole: t.file_role || undefined,
                    episodeId: t.episode_id || undefined,
                    provider: t.provider || undefined,
                    modelName: t.model || undefined,
                    progress: normalizeProgress(t.progress),
                    createdAt: new Date(t.created_at).getTime()
                }));
                this.emit('tasks_updated', { tasks: this.activeTasks });
            }

            if (notifRes?.success && Array.isArray(notifRes.notifications)) {
                const terminalTasks = notifRes.notifications.map((n: any) => ({
                    id: n.task_id,
                    category: n.category || n.task_type,
                    taskType: n.task_type || undefined,
                    status: n.status === 'completed' ? 'completed' : 'failed',
                    displayName: n.display_name || n.task_type,
                    projectId: n.project_id || '',
                    sourcePage: this.normalizeTaskSourcePage(n.source_page, n.entity_type),
                    sourceItemId: n.source_item_id || n.entity_id,
                    entityType: n.entity_type || undefined,
                    entityId: n.entity_id || undefined,
                    fileRole: n.file_role || undefined,
                    episodeId: n.episode_id || undefined,
                    provider: n.provider || undefined,
                    modelName: n.model || undefined,
                    createdAt: new Date(n.created_at).getTime(),
                    completedAt: new Date(n.completed_at).getTime(),
                    error: n.error_message || undefined,
                })).filter((task: GlobalTask) => Boolean(task.id));
                if (terminalTasks.length > 0) {
                    // 终态同步只负责收口本地状态，不等同于用户可见通知。
                    // suppress_notification 的内部修复任务也可以静默退出 running。
                    this.emit('tasks_terminal', { tasks: terminalTasks });
                }
                this.notificationBaselineReady = true;
                this.lastPollTime = pollStartedAt;
            }

            if (!this.sseConnected && !isBaselinePoll && notifRes?.success && notifRes.notifications?.length) {
                for (const n of notifRes.notifications) {
                    const notification: TaskNotification = {
                        id: n.task_id,
                        type: this.mapTaskType(n.task_type),
                        status: n.status === 'completed' ? 'completed' : 'failed',
                        message: `${n.display_name || n.task_type} ${n.status === 'completed' ? '已完成' : '失败'}`,
                        targetView: 'Editor' as any,
                        targetProjectId: n.project_id,
                        targetPage: this.normalizeTaskSourcePage(n.source_page, n.entity_type),
                        targetItemId: n.source_item_id || n.entity_id,
                        timestamp: new Date(n.completed_at).getTime(),
                        taskId: n.task_id,
                        taskType: n.task_type || undefined,
                        entityType: n.entity_type || undefined,
                        entityId: n.entity_id || undefined,
                        fileRole: n.file_role || undefined,
                        episodeId: n.episode_id || undefined,
                        provider: n.provider || undefined,
                        modelName: n.model || undefined,
                    };
                    if (this.rememberNotificationId(notification.id)) {
                        this.emit('notification', { notification });
                    }
                }
            } else if (isBaselinePoll && notifRes?.success && notifRes.notifications?.length) {
                for (const n of notifRes.notifications) {
                    this.rememberNotificationId(n.task_id);
                }
            }
        } catch (e) {
            console.warn('[TaskManager] 轮询失败:', e);
        }
    }

    private rememberNotificationId(id: string | null | undefined): boolean {
        if (!id) return true;
        if (this.emittedNotificationIds.has(id)) return false;
        this.emittedNotificationIds.add(id);
        if (this.emittedNotificationIds.size > this.maxRememberedNotificationIds) {
            const oldest = this.emittedNotificationIds.values().next().value;
            if (oldest) this.emittedNotificationIds.delete(oldest);
        }
        return true;
    }

    private mapTaskType(taskType: string): 'video' | 'image' | 'material' | 'text' {
        const normalized = taskType.toLowerCase();
        if (normalized.includes('video') || normalized.includes('i2v') || normalized.includes('morph') || normalized.includes('upscale')) return 'video';
        if (normalized.includes('text') || normalized.includes('rewrite') || normalized.includes('storyboard')) return 'text';
        if (normalized.includes('material')) return 'material';
        return 'image';
    }

    private normalizeTaskSourcePage(sourcePage?: string, entityType?: string): string {
        const normalizedPage = sourcePage || 'editor';
        // Older storyboard image tasks persisted `design`, even though their
        // generated assets belong to a shot in the generation workspace.
        if (entityType === 'storyboard_item' && normalizedPage === 'design') {
            return 'generation';
        }
        return normalizedPage;
    }

    isSSEConnected(): boolean {
        return this.sseConnected;
    }

    getActiveTasks(): GlobalTask[] {
        return this.activeTasks;
    }

    addEventListener(callback: TaskEventCallback): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private emit(type: TaskEventType, data: any) {
        this.listeners.forEach(cb => {
            try { cb(type, data); } catch (e) { console.error('[TaskManager] 事件处理错误:', e); }
        });
    }
}

export const globalTaskManager = new GlobalTaskManager();
