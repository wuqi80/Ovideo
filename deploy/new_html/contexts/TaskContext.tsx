import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GlobalTask, RegisteredTask, SourcePage, TaskKind, TaskNotification } from '../types';
import { taskRegistry, type RegisterInput } from '../services/taskRegistry';
import type { ServerNotificationRow } from '../services/notificationMapping';

interface TaskContextValue {
  activeTasks: GlobalTask[];
  registeredTasks: RegisteredTask[];
  notifications: TaskNotification[];
  unreadCount: number;
  activeCountByPage: Record<SourcePage, number>;
  summaryByPage: Record<SourcePage, { running: number; queued: number; pending: number }>;

  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  markAllRead: () => void;
  refreshNotifications: () => Promise<void>;

  registerTask: (input: RegisterInput) => RegisteredTask;
  updateTask: (taskId: string, updates: Partial<RegisteredTask>) => RegisteredTask | null;
  completeTask: (taskId: string, result?: { resultUrls?: string[]; progress?: number }) => RegisteredTask | null;
  failTask: (taskId: string, error: string) => RegisteredTask | null;
  cancelTask: (taskId: string) => RegisteredTask | null;
  removeTask: (taskId: string) => void;
  onTaskComplete: (taskId: string, callback: (task: RegisteredTask) => void) => () => void;
  onTaskFail: (taskId: string, callback: (task: RegisteredTask) => void) => () => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

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
  refreshNotifications: async () => {},
  registerTask: (() => { throw new Error('TaskProvider missing'); }) as any,
  updateTask: () => null,
  completeTask: () => null,
  failTask: () => null,
  cancelTask: () => null,
  removeTask: () => {},
  onTaskComplete: () => () => {},
  onTaskFail: () => () => {},
};

function isAdminRoute(): boolean {
  try {
    return typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  } catch {
    return false;
  }
}

function inferRuntimeTaskKind(task: GlobalTask): TaskKind {
  const category = String(task.category || '').toLowerCase();
  const name = String(task.displayName || task.id || '').toLowerCase();
  if (category.includes('image') || name.includes('image') || name.includes('图像') || name.includes('生图')) {
    if (name.includes('doubao') || name.includes('豆包')) return 'doubao-image';
    if (name.includes('gemini')) return 'gemini-image';
    return 'comfyui-image';
  }
  if (category.includes('video')) return 'video-i2v';
  if (category.includes('text')) return 'script-segment';
  if (category.includes('material')) return 'matting';
  return 'other';
}

function notifyEpisodeDataChanged(notification: TaskNotification) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('drama:episode-data-changed', {
    detail: {
      episodeId: notification.episodeId,
      entityType: notification.entityType,
      entityId: notification.entityId,
      fileRole: notification.fileRole,
      targetPage: notification.targetPage,
      targetItemId: notification.targetItemId,
      taskId: notification.taskId,
      status: notification.status,
      type: notification.type,
    },
  }));
}

export const useTaskManager = (): TaskContextValue => {
  const ctx = useContext(TaskContext);
  return ctx || STUB_VALUE;
};

export const TaskProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [registeredTasks, setRegisteredTasks] = useState<RegisteredTask[]>(() => taskRegistry.list());
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const startedRef = useRef(false);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());

  const refreshNotifications = useCallback(async () => {
    const [
      { getNotifications },
      { mapNotificationsToTasks },
    ] = await Promise.all([
      import('../services/taskNotificationService'),
      import('../services/notificationMapping'),
    ]);
    const res = await getNotifications(undefined, 50, 0);
    if (!res?.success || !Array.isArray(res.notifications)) return;
    const tasks = mapNotificationsToTasks(res.notifications as ServerNotificationRow[]);
    const stats = taskRegistry.mergeFromServer(tasks);
    if (stats.added > 0 || stats.updated > 0) {
      setRegisteredTasks(taskRegistry.list());
    }
  }, []);

  useEffect(() => {
    if (isAdminRoute()) return;
    if (startedRef.current) return;
    startedRef.current = true;

    let disposed = false;
    let stopRuntime: (() => void) | null = null;

    try {
      const restored = taskRegistry.rehydrate();
      if (restored.length > 0) setRegisteredTasks(restored);
    } catch (e) {
      console.warn('[TaskContext] rehydrate failed:', e);
    }

    const unsubscribeRegistry = taskRegistry.subscribe((_event, snapshot) => {
      setRegisteredTasks(snapshot);
    });

    void (async () => {
      const [
        { globalTaskManager },
        {
          getNotifications,
          getUnreadNotificationCount,
        },
        { mapNotificationsToTasks, mapRuntimeNotificationToTask },
      ] = await Promise.all([
        import('../services/globalTaskManager'),
        import('../services/taskNotificationService'),
        import('../services/notificationMapping'),
      ]);

      if (disposed) return;

      globalTaskManager.start();

      getUnreadNotificationCount()
        .then(res => { if (res?.success) setUnreadCount(res.count || 0); })
        .catch(() => {});

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

      const unsubscribeRuntime = globalTaskManager.addEventListener((type, data) => {
        if (type === 'tasks_updated' && data.tasks) {
          for (const t of data.tasks) {
            const existing = taskRegistry.get(t.id);
            if (!existing) {
              taskRegistry.register({
                taskId: t.id,
                kind: inferRuntimeTaskKind(t),
                title: t.displayName || t.id,
                targetPage: t.sourcePage as SourcePage,
                initialStatus: t.status === 'running' ? 'running' : 'queued',
                targetItemId: t.sourceItemId,
                targetProjectId: t.projectId,
                progress: t.progress,
              });
            } else if (existing.status !== t.status || existing.progress !== t.progress || existing.error) {
              taskRegistry.update(t.id, {
                status: t.status,
                progress: t.progress,
                error: undefined,
              });
            }
          }
        }

        if (type === 'progress' && data.taskId) {
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
          const n = data.notification;

          if (n.entityType && n.entityId) {
            void queryClient.invalidateQueries({ queryKey: ['entityFiles', n.entityType, n.entityId] });
          }
          if (n.episodeId) {
            void queryClient.invalidateQueries({ queryKey: ['storyboardItems', n.episodeId] });
            void queryClient.invalidateQueries({ queryKey: ['videoSegments', n.episodeId] });
          }
          if (n.status === 'completed') {
            notifyEpisodeDataChanged(n);
          }

          if (n.taskId) {
            const existing = taskRegistry.get(n.taskId);
            if (existing) {
              if (n.status === 'completed') {
                taskRegistry.complete(n.taskId);
              } else if (n.status === 'failed') {
                taskRegistry.fail(n.taskId, n.message || '任务失败');
              }
            } else {
              const terminalTask = mapRuntimeNotificationToTask(n);
              if (terminalTask) taskRegistry.mergeFromServer([terminalTask]);
            }
          }

          setNotifications(prev => {
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

      stopRuntime = () => {
        unsubscribeRuntime();
        globalTaskManager.stop();
      };
    })().catch(err => {
      console.warn('[TaskContext] task runtime failed to start:', err);
    });

    return () => {
      disposed = true;
      stopRuntime?.();
      unsubscribeRegistry();
      startedRef.current = false;
    };
  }, [queryClient]);

  const activeTasks: GlobalTask[] = useMemo(() => {
    return registeredTasks
      .filter(t => t.status === 'pending' || t.status === 'queued' || t.status === 'running')
      .map(t => ({
        id: t.taskId,
        category: 'comfyui' as const,
        status: t.status === 'running' ? 'running' as const
          : t.status === 'queued' ? 'queued' as const
          : 'queued' as const,
        displayName: t.title,
        projectId: t.targetProjectId || '',
        sourcePage: t.targetPage,
        sourceItemId: t.targetItemId,
        progress: t.progress,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
      }));
  }, [registeredTasks]);

  const activeCountByPage = useMemo(() => taskRegistry.countActiveByPage(), [registeredTasks]);
  const summaryByPage = useMemo(() => taskRegistry.summaryByPage(), [registeredTasks]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const markAllRead = useCallback(() => {
    import('../services/taskNotificationService')
      .then(({ markAllNotificationsRead }) => markAllNotificationsRead())
      .catch(() => {});
    setUnreadCount(0);
  }, []);

  const registerTask = useCallback((input: RegisterInput) => taskRegistry.register(input), []);
  const updateTask = useCallback((taskId: string, updates: Partial<RegisteredTask>) => taskRegistry.update(taskId, updates), []);
  const completeTask = useCallback((taskId: string, result?: { resultUrls?: string[]; progress?: number }) => taskRegistry.complete(taskId, result), []);
  const failTask = useCallback((taskId: string, error: string) => taskRegistry.fail(taskId, error), []);

  const cancelTask = useCallback((taskId: string) => {
    const result = taskRegistry.cancel(taskId);
    import('../services/taskControlService')
      .then(({ cancelTask: apiCancelTask }) => apiCancelTask(taskId))
      .catch((e) => {
        console.warn('[TaskContext] backend cancel failed after local cancel:', e);
      });
    return result;
  }, []);

  const removeTask = useCallback((taskId: string) => {
    const target = taskRegistry.get(taskId);
    taskRegistry.remove(taskId);
    if (target && (target.status === 'completed' || target.status === 'failed' || target.status === 'cancelled')) {
      import('../services/taskNotificationService')
        .then(({ dismissNotification: apiDismissNotification }) => apiDismissNotification(target.notificationId || taskId))
        .catch(() => {});
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
    refreshNotifications,
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
