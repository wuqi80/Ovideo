/**
 * 全局任务上下文（2026-05-20 重构）
 *
 * 内部使用 taskRegistry 作为单一信任源；保留旧 API（activeTasks / notifications / unreadCount）
 * 兼容现有调用方，新增 API 暴露 register / update / complete / fail / cancel / remove +
 * summaryByPage（per-page indicator 用）。
 *
 * SSE 推送 / 轮询 → globalTaskManager → taskRegistry.update → 此 Context re-render → UI 刷新
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { GlobalTask, TaskNotification, RegisteredTask, SourcePage } from '../types';
import { globalTaskManager } from '../services/globalTaskManager';
import { taskRegistry, type RegisterInput } from '../services/taskRegistry';
import {
    dismissNotification as apiDismissNotification,
    getNotifications,
    getUnreadNotificationCount,
    markAllNotificationsRead,
} from '../services/taskNotificationService';
import { mapNotificationsToTasks, type ServerNotificationRow } from '../services/notificationMapping';
import { cancelTask as apiCancelTask } from '../services/videoTaskService';

interface TaskContextValue {
    /** 兼容旧接口：仅活跃任务（pending/queued/running） */
    activeTasks: GlobalTask[];
    /** 完整注册表 — 含已完成/失败 */
    registeredTasks: RegisteredTask[];
    /** 通知历史（最多 50 条，新→旧） */
    notifications: TaskNotification[];
    /** 未读数（含完成 + 失败，不含 running） */
    unreadCount: number;
    /** Per-page 计数：{ video: 3, storyboard: 1, ... }，仅活跃任务 */
    activeCountByPage: Record<SourcePage, number>;
    /** Per-page 详细汇总：{ video: { running: 1, queued: 2, pending: 0 }, ... } */
    summaryByPage: Record<SourcePage, { running: number; queued: number; pending: number }>;

    // 兼容旧 API
    dismissNotification: (id: string) => void;
    clearNotifications: () => void;
    markAllRead: () => void;

    // 新 API（页面提交任务时使用）
    registerTask: (input: RegisterInput) => RegisteredTask;
    updateTask: (taskId: string, updates: Partial<RegisteredTask>) => RegisteredTask | null;
    completeTask: (taskId: string, result?: { resultUrls?: string[]; progress?: number }) => RegisteredTask | null;
    failTask: (taskId: string, error: string) => RegisteredTask | null;
    cancelTask: (taskId: string) => RegisteredTask | null;
    removeTask: (taskId: string) => void;
    /** 监听 task 完成（页面 mount 时调，return unsubscribe） */
    onTaskComplete: (taskId: string, callback: (task: RegisteredTask) => void) => () => void;
    /** 监听 task 失败 */
    onTaskFail: (taskId: string, callback: (task: RegisteredTask) => void) => () => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export const useTaskManager = (): TaskContextValue => {
    const ctx = useContext(TaskContext);
    if (!ctx) {
        // 旧调用方期待无 Provider 时拿到默认值，给一个空 stub 保持兼容
        return STUB_VALUE;
    }
    return ctx;
};

// 当 Provider 不存在时（极少数测试场景或 mount 顺序问题）避免崩溃
const STUB_VALUE: TaskContextValue = {
    activeTasks: [],
    registeredTasks: [],
    notifications: [],
    unreadCount: 0,
    activeCountByPage: {} as Record<SourcePage, number>,
    summaryByPage: {} as Record<SourcePage, { running: number; queued: number; pending: number }>,
    dismissNotification: () => {},
    clearNotifications: () => {},
    markAllRead: () => {},
    registerTask: (() => { throw new Error('TaskProvider missing'); }) as any,
    updateTask: () => null,
    completeTask: () => null,
    failTask: () => null,
    cancelTask: () => null,
    removeTask: () => {},
    onTaskComplete: () => () => {},
    onTaskFail: () => () => {},
};

export const TaskProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // registeredTasks 来自 taskRegistry
    const [registeredTasks, setRegisteredTasks] = useState<RegisteredTask[]>(() => taskRegistry.list());
    const [notifications, setNotifications] = useState<TaskNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const startedRef = useRef(false);
    const seenNotificationIdsRef = useRef<Set<string>>(new Set());

    // ── 启动 + SSE 接入 ───────────────────────────────────────
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        // 2026-05-26 修复：在独立后台 (/admin/*) 路径下跳过所有主站任务拉取。
        //   admin shell 没有"主站任务"概念；它要的 token 在 sessionStorage 而非 localStorage。
        //   不 guard 的话，访问 /admin/login 时 mount 触发 getNotifications / getUnreadCount —
        //   apiService 拿不到 admin token（用户还没登），拿不到主站 token（也没登），全部 401 →
        //   handleResponse 拦截 → window.location.href='/admin/login' 循环跳。
        try {
            if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
                return;
            }
        } catch {}

        // mount 时先 rehydrate 持久化的任务（刷新页面后保留）
        try {
            const restored = taskRegistry.rehydrate();
            if (restored.length > 0) setRegisteredTasks(restored);
        } catch (e) {
            console.warn('[TaskContext] rehydrate failed:', e);
        }

        globalTaskManager.start();

        getUnreadNotificationCount()
            .then(res => { if (res?.success) setUnreadCount(res.count || 0); })
            .catch(() => {});

        // 2026-05-20 (M5)：从后端 dao_notification 表拉历史任务（最近 50 条），合并到 registry。
        // 这样用户重新打开浏览器、token 还有效 → 立即看到之前提交过任务的最终状态（铃铛历史）。
        // 合并不会覆盖正在运行的内存态（mergeFromServer 内部判断 isActive 跳过）。
        getNotifications(undefined, 50, 0)
            .then(res => {
                if (!res?.success || !Array.isArray(res.notifications)) return;
                const tasks = mapNotificationsToTasks(res.notifications as ServerNotificationRow[]);
                if (tasks.length > 0) {
                    const stats = taskRegistry.mergeFromServer(tasks);
                    if (stats.added > 0 || stats.updated > 0) {
                        setRegisteredTasks(taskRegistry.list());
                    }
                }
            })
            .catch(err => { console.warn('[TaskContext] load server notifications failed:', err); });

        // 1. globalTaskManager 事件 → registry update + notifications
        const unsubGTM = globalTaskManager.addEventListener((type, data) => {
            if (type === 'tasks_updated' && data.tasks) {
                // 把后端推来的 active tasks 同步到 registry（仅当 registry 没记录时新建）
                for (const t of data.tasks) {
                    const existing = taskRegistry.get(t.id);
                    if (!existing) {
                        taskRegistry.register({
                            taskId: t.id,
                            kind: 'other',
                            title: t.displayName || t.id,
                            targetPage: t.sourcePage as SourcePage,
                            initialStatus: t.status === 'running' ? 'running' : 'queued',
                            targetItemId: t.sourceItemId,
                            targetProjectId: t.projectId,
                            progress: t.progress,
                        });
                    } else if (existing.status !== t.status) {
                        taskRegistry.update(t.id, {
                            status: t.status,
                            progress: t.progress,
                        });
                    }
                }
            }
            if (type === 'progress' && data.taskId) {
                // 2026-05-20 (Phase 8)：进度推送除了 progress 外，从 raw payload 提取
                // 阶段名 / step / total_steps / eta_seconds / worker_node_id / model_name
                // 等富信息字段，浅合并进 RegisteredTask.metadata。snake_case → camelCase 在此层做。
                const raw = (data.raw || {}) as Record<string, unknown>;
                const metadata: Record<string, unknown> = {};
                const stage = data.message ?? (raw.stage as string | undefined) ?? (raw.message as string | undefined);
                if (stage != null) metadata.stage = stage;
                if (raw.step != null) metadata.step = raw.step;
                if (raw.total_steps != null) metadata.totalSteps = raw.total_steps;
                if (raw.eta_seconds != null) metadata.etaSeconds = raw.eta_seconds;
                if (raw.worker_node_id != null) metadata.workerNodeId = raw.worker_node_id;
                if (raw.model_name != null) metadata.modelName = raw.model_name;
                metadata.lastUpdateAt = Date.now();

                taskRegistry.update(data.taskId, {
                    status: 'running',
                    progress: data.progress,
                    metadata,
                });
            }
            if (type === 'notification' && data.notification) {
                // 通知推送：合并完成/失败 → registry + notifications list
                const n = data.notification;
                if (n.taskId) {
                    if (n.status === 'completed') {
                        taskRegistry.complete(n.taskId);
                    } else if (n.status === 'failed') {
                        taskRegistry.fail(n.taskId, n.message || '任务失败');
                    }
                }
                setNotifications(prev => {
                    // 去重：相同 taskId 仅保留最新的
                    const filtered = prev.filter(p => p.id !== n.id && p.taskId !== n.taskId);
                    return [n, ...filtered].slice(0, 50);
                });
                const key = n.id || n.taskId;
                if (!key || !seenNotificationIdsRef.current.has(key)) {
                    if (key) seenNotificationIdsRef.current.add(key);
                    setUnreadCount(prev => prev + 1);
                }
            }
        });

        // 2. registry 变化 → setRegisteredTasks（驱动 UI re-render）
        const unsubReg = taskRegistry.subscribe((_event, snapshot) => {
            setRegisteredTasks(snapshot);
        });

        return () => {
            unsubGTM();
            unsubReg();
            globalTaskManager.stop();
            startedRef.current = false;
        };
    }, []);

    // ── Derived state ────────────────────────────────────────
    const activeTasks: GlobalTask[] = useMemo(() => {
        return registeredTasks
            .filter(t => t.status === 'pending' || t.status === 'queued' || t.status === 'running')
            .map(t => ({
                id: t.taskId,
                category: 'comfyui' as const, // 不严格区分，UI 不依赖
                status: t.status === 'running' ? 'running' as const
                      : t.status === 'queued' ? 'queued' as const
                      : 'queued' as const,
                displayName: t.title,
                projectId: t.targetProjectId || '',
                sourcePage: t.targetPage,
                sourceItemId: t.targetItemId,
                progress: t.progress ?? 0,
                createdAt: t.createdAt,
                startedAt: t.startedAt,
            }));
    }, [registeredTasks]);

    const activeCountByPage = useMemo(() => taskRegistry.countActiveByPage(), [registeredTasks]);
    const summaryByPage = useMemo(() => taskRegistry.summaryByPage(), [registeredTasks]);

    // ── API ─────────────────────────────────────────────────
    const dismissNotification = useCallback((id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const clearNotifications = useCallback(() => {
        setNotifications([]);
    }, []);

    const markAllRead = useCallback(() => {
        markAllNotificationsRead().catch(() => {});
        setUnreadCount(0);
    }, []);

    const registerTask = useCallback((input: RegisterInput) => taskRegistry.register(input), []);
    const updateTask = useCallback((taskId: string, updates: Partial<RegisteredTask>) => taskRegistry.update(taskId, updates), []);
    const completeTask = useCallback((taskId: string, result?: { resultUrls?: string[]; progress?: number }) => taskRegistry.complete(taskId, result), []);
    const failTask = useCallback((taskId: string, error: string) => taskRegistry.fail(taskId, error), []);
    const cancelTask = useCallback((taskId: string) => {
        // 乐观更新本地（状态置 cancelled → 通知面板立即隐藏），
        // 同时调用后端把任务落为 cancelled 并移出队列，避免刷新后又拉回。
        const result = taskRegistry.cancel(taskId);
        apiCancelTask(taskId).catch((e) => {
            console.warn('[TaskContext] 取消任务后端调用失败（本地已取消，刷新可能恢复）:', e);
        });
        return result;
    }, []);
    const removeTask = useCallback((taskId: string) => {
        const target = taskRegistry.get(taskId);
        taskRegistry.remove(taskId);
        // 2026-05-20 (M5)：UI 上点"关闭"时同步通知后端 dismiss，避免下次 mount 又拉回来。
        // 仅对终态（completed/failed/cancelled）做 — 活跃态走 cancelTask 更合适。
        // 后端 notification_id 不与前端 taskId 同键时，需要先反查；这里用 try/catch 兜底，
        // 失败也不影响本地 UI（只是下次 mount 可能再看到，能接受）。
        if (target && (target.status === 'completed' || target.status === 'failed' || target.status === 'cancelled')) {
            apiDismissNotification(taskId).catch(() => { /* 后端可能用 notification_id 而非 task_id 做主键，忽略 */ });
        }
    }, []);
    const onTaskComplete = useCallback((taskId: string, callback: (t: RegisteredTask) => void) => taskRegistry.onComplete(taskId, callback), []);
    const onTaskFail = useCallback((taskId: string, callback: (t: RegisteredTask) => void) => taskRegistry.onFail(taskId, callback), []);

    const value: TaskContextValue = {
        activeTasks,
        registeredTasks,
        notifications,
        unreadCount,
        activeCountByPage,
        summaryByPage,
        dismissNotification,
        clearNotifications,
        markAllRead,
        registerTask,
        updateTask,
        completeTask,
        failTask,
        cancelTask,
        removeTask,
        onTaskComplete,
        onTaskFail,
    };

    return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
};
