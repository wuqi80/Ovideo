/**
 * 全局任务管理器
 * SSE 优先推送 + HTTP 轮询降级
 */
import type { GlobalTask, TaskNotification } from '../types';
import { authTokenFromHeaders } from './httpClient';
import { getActiveTasks, getTaskNotifications } from './taskNotificationService';

export type TaskEventType = 'tasks_updated' | 'notification' | 'progress';
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
    private pollIntervalMs = 5000;
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
                this.stopPolling();
                this.poll();
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
            const notification: TaskNotification = {
                id: data.task_id,
                type: this.mapTaskType(data.task_type || ''),
                status: data.type === 'task_complete' ? 'completed' : 'failed',
                message: `${data.display_name || data.task_type || '任务'} ${data.type === 'task_complete' ? '已完成' : '失败'}`,
                targetView: 'Video' as any,
                targetProjectId: data.project_id,
                targetPage: data.source_page,
                timestamp: Date.now(),
                taskId: data.task_id,
                entityType: data.entity_type || undefined,
                entityId: data.entity_id || undefined,
                fileRole: data.file_role || undefined,
                episodeId: data.episode_id || undefined,
            };
            if (this.rememberNotificationId(notification.id)) {
                this.emit('notification', { notification });
            }
            this.poll();
        } else {
            this.emit('progress', {
                taskId: data.task_id,
                progress: data.progress,
                message: data.message,
                // 2026-05-20 (Phase 8)：把 SSE 原始 payload 透传给 TaskContext，
                // 由后者按需 cherry-pick 字段（stage/step/eta/worker_node_id/...）写入 metadata。
                raw: data,
            });
        }
    }

    private startPollingFallback() {
        if (this.pollingTimer) return;
        this.poll();
        this.pollingTimer = setInterval(() => this.poll(), this.pollIntervalMs);
        console.log('[TaskManager] 轮询已启动');
    }

    private stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    }

    private async poll() {
        const pollStartedAt = Date.now();
        const isBaselinePoll = !this.notificationBaselineReady;
        const since = this.lastPollTime || pollStartedAt;

        try {
            const [activeRes, notifRes] = await Promise.all([
                getActiveTasks().catch(() => null),
                getTaskNotifications(since).catch(() => null)
            ]);

            if (activeRes?.success && activeRes.tasks) {
                this.activeTasks = activeRes.tasks.map((t: any) => ({
                    id: t.task_id,
                    category: t.category || t.task_type,
                    status: t.status === 'processing' ? 'running' : t.status,
                    displayName: t.display_name || t.task_type,
                    projectId: t.project_id || '',
                    sourcePage: t.source_page || 'editor',
                    sourceItemId: t.source_item_id,
                    progress: 0,
                    createdAt: new Date(t.created_at).getTime()
                }));
                this.emit('tasks_updated', { tasks: this.activeTasks });
            }

            if (notifRes?.success && Array.isArray(notifRes.notifications)) {
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
                        targetPage: n.source_page,
                        targetItemId: n.source_item_id,
                        timestamp: new Date(n.completed_at).getTime(),
                        taskId: n.task_id,
                        entityType: n.entity_type || undefined,
                        entityId: n.entity_id || undefined,
                        fileRole: n.file_role || undefined,
                        episodeId: n.episode_id || undefined,
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
        if (taskType.includes('video') || taskType.includes('i2v') || taskType.includes('morph') || taskType.includes('upscale')) return 'video';
        if (taskType.includes('text') || taskType.includes('rewrite') || taskType.includes('storyboard')) return 'text';
        if (taskType.includes('material')) return 'material';
        return 'image';
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
