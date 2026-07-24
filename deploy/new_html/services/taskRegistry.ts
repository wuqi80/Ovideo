// new_html/services/taskRegistry.ts
//
// 2026-05-20 (Task System Overhaul M0)：全局任务注册中心。
//
// 设计层次：
//   - globalTaskManager.ts  ← SSE / 轮询的传输层（已有，不动）
//   - taskRegistry.ts       ← 业务任务状态机（本文件）
//   - TaskContext.tsx       ← React 适配层
//   - 各页面                ← register / onComplete callback
//
// 关键能力：
//   - register: 页面提交任务时注册到 store，立即进入 'pending' / 'queued'
//   - update: 全局 poller 或 SSE 收到状态时调用，更新 status / progress / queuePosition
//   - complete / fail: 终态，触发 callback 并广播 listeners
//   - subscribe / onComplete / onFail: React 组件订阅
//   - persist + rehydrate: sessionStorage 缓存（刷新页保留 transient 状态）
//   - listByPage: per-page 计数 / per-page 任务列表（UI 用）

import type { RegisteredTask, GlobalTaskStatus, SourcePage, TaskKind } from '../types';

const STORAGE_KEY_PREFIX = 'h-my2:task-registry:v1';
const ANONYMOUS_USER_SCOPE = 'anonymous';
// 已完成/失败任务在 sessionStorage 里保留 30 分钟（用于 reload 后能看到刚完成的任务）
const COMPLETED_RETAIN_MS = 30 * 60 * 1000;
// 2026-06-14：active（pending/queued/running）任务超过此时长仍未完成，视为僵尸/超时，
// rehydrate 时自动判失败清出「运行中」。否则卡死的任务（如无 GPU agent 的 qwen 出图）
// 会永远显示「运行中 0%」幽灵在通知面板里。
const STALE_ACTIVE_MS = 60 * 60 * 1000;
// listTasks 默认排序时，已完成 / 失败保留前 N 条（避免 store 无限增长）
const MAX_COMPLETED_KEEP = 50;
const FRONTEND_QUEUE_TASK_ID_RE = /^comfyui_\d+_\d+$/;
const FRONTEND_QUEUE_TASK_LOST_MESSAGE = '页面刷新后，本地排队任务已失效，请重新提交';

export type TaskRegistryEvent =
    | { type: 'register'; task: RegisteredTask }
    | { type: 'update'; task: RegisteredTask }
    | { type: 'complete'; task: RegisteredTask }
    | { type: 'fail'; task: RegisteredTask }
    | { type: 'cancel'; task: RegisteredTask }
    | { type: 'remove'; taskId: string }
    | { type: 'rehydrate'; tasks: RegisteredTask[] };

export type RegistryListener = (event: TaskRegistryEvent, snapshot: RegisteredTask[]) => void;
export type TaskCompleteListener = (task: RegisteredTask) => void;

export interface TaskFilter {
    status?: GlobalTaskStatus | GlobalTaskStatus[];
    targetPage?: SourcePage | SourcePage[];
    kind?: TaskKind | TaskKind[];
    episodeId?: string;
}

export interface RegisterInput {
    taskId: string;
    kind: TaskKind;
    title: string;
    targetPage: SourcePage;
    /** 默认 'queued'，如果调用方明确知道已开始可传 'running' */
    initialStatus?: GlobalTaskStatus;
    progress?: number;
    queuePosition?: number;
    targetEntityType?: string;
    targetEntityId?: string;
    targetItemId?: string;
    targetProjectId?: string;
    episodeId?: string;
    fileRole?: string;
}

class TaskRegistry {
    private tasks: Map<string, RegisteredTask> = new Map();
    private listeners: Set<RegistryListener> = new Set();
    /** taskId -> Set of complete callbacks */
    private completeCallbacks: Map<string, Set<TaskCompleteListener>> = new Map();
    /** taskId -> Set of fail callbacks */
    private failCallbacks: Map<string, Set<TaskCompleteListener>> = new Map();
    /** SSR-safe storage handle（测试时可注入） */
    private storage: Storage | null = null;
    private storageInitialized = false;
    private userScope = ANONYMOUS_USER_SCOPE;

    /**
     * Constructor：默认不接 storage（避免 SSR + jsdom 启动期触发 sessionStorage）；
     * 由 setStorage / rehydrate 显式启用，便于测试。
     */
    constructor(storage?: Storage | null) {
        if (storage !== undefined) {
            this.setStorage(storage);
        }
    }

    /** 测试 / 自定义 storage 接入。null 表示禁用持久化。 */
    setStorage(storage: Storage | null): void {
        this.storage = storage;
        this.storageInitialized = true;
    }

    /**
     * Browser task state is account-scoped. Without this boundary, switching users
     * in the same tab can rehydrate the previous user's locally cached tasks.
     */
    setUserScope(scope?: string | null, emit = true): void {
        const nextScope = (scope || '').trim() || ANONYMOUS_USER_SCOPE;
        if (nextScope === this.userScope) return;
        this.userScope = nextScope;
        this.tasks.clear();
        this.completeCallbacks.clear();
        this.failCallbacks.clear();
        if (emit) this.emit({ type: 'rehydrate', tasks: [] });
    }

    private storageKey(): string {
        return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(this.userScope)}`;
    }

    private resolveStorage(): Storage | null {
        if (this.storageInitialized) return this.storage;
        // Lazy init：第一次访问时尝试 sessionStorage
        try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
                this.storage = window.sessionStorage;
            } else {
                this.storage = null;
            }
        } catch {
            this.storage = null;
        }
        this.storageInitialized = true;
        return this.storage;
    }

    // ===== 核心：register / update / complete / fail / cancel =====

    /**
     * 注册一个新任务。如果 taskId 已存在则视为 update（防止 SSE 推送 + 页面 register 重复）。
     */
    register(input: RegisterInput): RegisteredTask {
        const now = Date.now();
        const existing = this.tasks.get(input.taskId);

        const task: RegisteredTask = existing
            ? { ...existing, ...this.toTaskFields(input) }
            : {
                taskId: input.taskId,
                kind: input.kind,
                title: input.title,
                status: input.initialStatus || 'queued',
                createdAt: now,
                progress: input.progress,
                queuePosition: input.queuePosition,
                targetPage: input.targetPage,
                targetEntityType: input.targetEntityType,
                targetEntityId: input.targetEntityId,
                targetItemId: input.targetItemId,
                targetProjectId: input.targetProjectId,
                episodeId: input.episodeId,
                fileRole: input.fileRole,
            };

        this.tasks.set(task.taskId, task);
        this.persist();
        this.emit({ type: existing ? 'update' : 'register', task });
        return task;
    }

    private toTaskFields(input: RegisterInput): Partial<RegisteredTask> {
        const out: Partial<RegisteredTask> = {
            kind: input.kind,
            title: input.title,
            targetPage: input.targetPage,
        };
        if (input.initialStatus) out.status = input.initialStatus;
        if (input.progress !== undefined) out.progress = input.progress;
        if (input.queuePosition !== undefined) out.queuePosition = input.queuePosition;
        if (input.targetEntityType !== undefined) out.targetEntityType = input.targetEntityType;
        if (input.targetEntityId !== undefined) out.targetEntityId = input.targetEntityId;
        if (input.targetItemId !== undefined) out.targetItemId = input.targetItemId;
        if (input.targetProjectId !== undefined) out.targetProjectId = input.targetProjectId;
        if (input.episodeId !== undefined) out.episodeId = input.episodeId;
        if (input.fileRole !== undefined) out.fileRole = input.fileRole;
        return out;
    }

    /**
     * 更新任务状态：通常由全局 poller 或 SSE 推送驱动。
     * - status 转 'running' 时自动填充 startedAt
     * - status 转 'completed' / 'failed' 自动填充 completedAt 并触发 onComplete / onFail
     */
    update(taskId: string, updates: Partial<RegisteredTask>): RegisteredTask | null {
        const existing = this.tasks.get(taskId);
        if (!existing) return null;

        const next: RegisteredTask = { ...existing, ...updates };
        // 2026-05-20 (Phase 8)：metadata 浅合并而非覆盖 — 避免 progress 推送时把 stage/eta 等
        // 之前累积的 key 冲掉。深合并不必要（嵌套对象用例几乎没有）。
        // 调用方传 `metadata: undefined` 视为不改；传 `metadata: {}` 也保留 existing（无意义清空）。
        if (updates.metadata !== undefined) {
            next.metadata = { ...(existing.metadata || {}), ...updates.metadata };
        }
        const now = Date.now();

        if (updates.status === 'running' && !existing.startedAt) {
            next.startedAt = now;
        }

        const becameComplete = existing.status !== 'completed' && next.status === 'completed';
        const becameFailed = existing.status !== 'failed' && next.status === 'failed';

        if ((becameComplete || becameFailed) && !next.completedAt) {
            next.completedAt = now;
        }

        this.tasks.set(taskId, next);
        this.persist();

        if (becameComplete) {
            this.emit({ type: 'complete', task: next });
            this.runCallbacks(this.completeCallbacks, taskId, next);
        } else if (becameFailed) {
            this.emit({ type: 'fail', task: next });
            this.runCallbacks(this.failCallbacks, taskId, next);
        } else {
            this.emit({ type: 'update', task: next });
        }
        return next;
    }

    /** 便捷方法：标记完成 + 写入 resultUrls。 */
    complete(taskId: string, result?: { resultUrls?: string[]; progress?: number }): RegisteredTask | null {
        return this.update(taskId, {
            status: 'completed',
            progress: result?.progress ?? 1,
            resultUrls: result?.resultUrls,
        });
    }

    /**
     * 2026-05-20 (Phase 8)：便捷方法 — 仅更新 metadata（自动浅合并）。
     * 用于 SSE / 轮询推阶段名 / step / eta 等 UI 富信息时不动其它字段。
     */
    updateMetadata(taskId: string, partial: Record<string, unknown>): RegisteredTask | null {
        return this.update(taskId, { metadata: partial });
    }

    /** 便捷方法：标记失败 + 错误。 */
    fail(taskId: string, error: string): RegisteredTask | null {
        return this.update(taskId, { status: 'failed', error });
    }

    /** 用户主动取消（不会触发 onComplete/onFail，但广播 cancel 事件）。 */
    cancel(taskId: string): RegisteredTask | null {
        const existing = this.tasks.get(taskId);
        if (!existing) return null;
        const next: RegisteredTask = {
            ...existing,
            status: 'cancelled',
            completedAt: Date.now(),
        };
        this.tasks.set(taskId, next);
        this.persist();
        this.emit({ type: 'cancel', task: next });
        return next;
    }

    /** 删除任务（用户从面板里手动 dismiss）。 */
    remove(taskId: string): void {
        if (!this.tasks.has(taskId)) return;
        this.tasks.delete(taskId);
        this.completeCallbacks.delete(taskId);
        this.failCallbacks.delete(taskId);
        this.persist();
        this.emit({ type: 'remove', taskId });
    }

    /** 清理早于 olderThanMs 完成/失败的任务（默认 30 分钟）。 */
    clearCompleted(olderThanMs: number = COMPLETED_RETAIN_MS): number {
        const cutoff = Date.now() - olderThanMs;
        let removed = 0;
        for (const [taskId, t] of this.tasks) {
            if ((t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
                && t.completedAt
                && t.completedAt < cutoff) {
                this.tasks.delete(taskId);
                this.completeCallbacks.delete(taskId);
                this.failCallbacks.delete(taskId);
                removed++;
            }
        }
        if (removed > 0) {
            this.persist();
            this.emit({ type: 'rehydrate', tasks: this.list() });
        }
        return removed;
    }

    // ===== 查询 =====

    get(taskId: string): RegisteredTask | undefined {
        return this.tasks.get(taskId);
    }

    list(filter?: TaskFilter): RegisteredTask[] {
        const all = Array.from(this.tasks.values());
        let out = all;
        if (filter?.status) {
            const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
            out = out.filter(t => allowed.includes(t.status));
        }
        if (filter?.targetPage) {
            const allowed = Array.isArray(filter.targetPage) ? filter.targetPage : [filter.targetPage];
            out = out.filter(t => allowed.includes(t.targetPage));
        }
        if (filter?.kind) {
            const allowed = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
            out = out.filter(t => allowed.includes(t.kind));
        }
        if (filter?.episodeId) {
            out = out.filter(t => t.episodeId === filter.episodeId);
        }
        // 默认排序：未完成在前（按 createdAt 升序），已完成/失败/取消在后（按 completedAt 降序）
        return out.sort((a, b) => {
            const aActive = isActive(a.status);
            const bActive = isActive(b.status);
            if (aActive !== bActive) return aActive ? -1 : 1;
            if (aActive) return a.createdAt - b.createdAt;
            return (b.completedAt || 0) - (a.completedAt || 0);
        });
    }

    /** Per-page 数量分布（UI 侧栏 indicator 用）。仅统计 pending/queued/running。 */
    countActiveByPage(): Record<SourcePage, number> {
        const counts = {} as Record<SourcePage, number>;
        for (const t of this.tasks.values()) {
            if (isActive(t.status)) {
                counts[t.targetPage] = (counts[t.targetPage] || 0) + 1;
            }
        }
        return counts;
    }

    /** Per-page 状态聚合（更细：含 running 数量 vs 仅 queued）。 */
    summaryByPage(): Record<SourcePage, { running: number; queued: number; pending: number }> {
        const out = {} as Record<SourcePage, { running: number; queued: number; pending: number }>;
        for (const t of this.tasks.values()) {
            if (!isActive(t.status)) continue;
            const bucket = (out[t.targetPage] = out[t.targetPage] || { running: 0, queued: 0, pending: 0 });
            if (t.status === 'running') bucket.running++;
            else if (t.status === 'queued') bucket.queued++;
            else if (t.status === 'pending') bucket.pending++;
        }
        return out;
    }

    // ===== 订阅 =====

    subscribe(listener: RegistryListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** 监听某 task 完成。如果任务已经完成则立即调用 callback（once）。 */
    onComplete(taskId: string, callback: TaskCompleteListener): () => void {
        const existing = this.tasks.get(taskId);
        if (existing && existing.status === 'completed') {
            // 已经完成 → 立即触发，但仍返回 unsubscribe（no-op）
            try { callback(existing); } catch (e) { console.error('[taskRegistry] onComplete callback error', e); }
            return () => {};
        }
        const set = this.completeCallbacks.get(taskId) || new Set<TaskCompleteListener>();
        set.add(callback);
        this.completeCallbacks.set(taskId, set);
        return () => {
            const s = this.completeCallbacks.get(taskId);
            if (s) {
                s.delete(callback);
                if (s.size === 0) this.completeCallbacks.delete(taskId);
            }
        };
    }

    onFail(taskId: string, callback: TaskCompleteListener): () => void {
        const existing = this.tasks.get(taskId);
        if (existing && existing.status === 'failed') {
            try { callback(existing); } catch (e) { console.error('[taskRegistry] onFail callback error', e); }
            return () => {};
        }
        const set = this.failCallbacks.get(taskId) || new Set<TaskCompleteListener>();
        set.add(callback);
        this.failCallbacks.set(taskId, set);
        return () => {
            const s = this.failCallbacks.get(taskId);
            if (s) {
                s.delete(callback);
                if (s.size === 0) this.failCallbacks.delete(taskId);
            }
        };
    }

    // ===== 持久化 =====

    private persist(): void {
        const storage = this.resolveStorage();
        if (!storage) return;
        try {
            // 仅持久化最新 N 条已完成 + 全部活跃任务，避免 store 无限增长
            const all = Array.from(this.tasks.values());
            const active = all.filter(t => isActive(t.status));
            const done = all
                .filter(t => !isActive(t.status))
                .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
                .slice(0, MAX_COMPLETED_KEEP);
            const payload = { active, done, savedAt: Date.now() };
            storage.setItem(this.storageKey(), JSON.stringify(payload));
        } catch (err) {
            // QuotaExceeded / 其它存储错误：log but don't break runtime
            console.warn('[taskRegistry] persist failed:', err);
        }
    }

    rehydrate(): RegisteredTask[] {
        const storage = this.resolveStorage();
        if (!storage) return [];
        try {
            // The legacy unscoped cache has unknown ownership and must never be
            // shown after an account switch.
            storage.removeItem(STORAGE_KEY_PREFIX);
            const raw = storage.getItem(this.storageKey());
            if (!raw) return [];
            const data = JSON.parse(raw) as { active?: RegisteredTask[]; done?: RegisteredTask[] };
            const all = [...(data.active || []), ...(data.done || [])];
            this.tasks.clear();
            // 自动清理过期完成任务 + 自动判失败僵尸 active 任务
            const cutoff = Date.now() - COMPLETED_RETAIN_MS;
            const staleCutoff = Date.now() - STALE_ACTIVE_MS;
            let mutated = false;
            for (const t of all) {
                if (!isActive(t.status)) {
                    if (t.completedAt && t.completedAt < cutoff) { mutated = true; continue; }
                    this.tasks.set(t.taskId, t);
                    continue;
                }
                // active 但创建太久仍未完成 → 判为超时失败，清出「运行中」
                if (isFrontendOnlyQueueTask(t)) {
                    this.tasks.set(t.taskId, {
                        ...t,
                        status: 'failed',
                        completedAt: Date.now(),
                        error: FRONTEND_QUEUE_TASK_LOST_MESSAGE,
                    });
                    mutated = true;
                } else if (t.createdAt < staleCutoff) {
                    this.tasks.set(t.taskId, { ...t, status: 'failed', completedAt: Date.now(), error: '任务超时，已自动清理' });
                    mutated = true;
                } else {
                    this.tasks.set(t.taskId, t);
                }
            }
            if (mutated) this.persist();
            const snapshot = this.list();
            this.emit({ type: 'rehydrate', tasks: snapshot });
            return snapshot;
        } catch (err) {
            console.warn('[taskRegistry] rehydrate failed:', err);
            return [];
        }
    }

    /**
     * 2026-05-20 (M5)：把后端 dao_notification 表里的历史 task 合并进内存。
     *
     * 合并规则（重要：不破坏正在跑的运行时状态）：
     *   - 内存里已有此 taskId 且为活跃态 (pending/queued/running) → 跳过（SSE/轮询数据更新鲜）
     *   - 内存里没有 → 直接 set（首次加载就能看到刷新前完成的任务）
     *   - 内存里有但已是终态 → 用后端数据补 createdAt/completedAt（不会改 status）
     *
     * 返回新增 / 跳过 / 更新的计数，便于调试。
     */
    mergeFromServer(serverTasks: RegisteredTask[]): { added: number; skipped: number; updated: number } {
        let added = 0;
        let skipped = 0;
        let updated = 0;
        for (const incoming of serverTasks) {
            if (!incoming || !incoming.taskId) {
                skipped++;
                continue;
            }
            const existing = this.tasks.get(incoming.taskId);
            if (!existing) {
                this.tasks.set(incoming.taskId, incoming);
                added++;
            } else if (isActive(existing.status)) {
                // 内存里在跑，后端不可能更新 → 直接跳过
                skipped++;
            } else {
                // 内存终态 + 后端终态：用后端时间戳补全（不改 status）
                this.tasks.set(incoming.taskId, {
                    ...incoming,
                    ...existing,
                    createdAt: existing.createdAt || incoming.createdAt,
                    startedAt: existing.startedAt || incoming.startedAt,
                    completedAt: existing.completedAt || incoming.completedAt,
                    notificationId: incoming.notificationId || existing.notificationId,
                    metadata: {
                        ...(incoming.metadata || {}),
                        ...(existing.metadata || {}),
                    },
                });
                updated++;
            }
        }
        if (added > 0 || updated > 0) {
            this.persist();
            this.emit({ type: 'rehydrate', tasks: this.list() });
        }
        return { added, skipped, updated };
    }

    /** 测试用：完全清空 store + storage。 */
    reset(): void {
        this.tasks.clear();
        this.completeCallbacks.clear();
        this.failCallbacks.clear();
        const storage = this.resolveStorage();
        if (storage) {
            try { storage.removeItem(this.storageKey()); } catch { /* ignore */ }
        }
        this.emit({ type: 'rehydrate', tasks: [] });
    }

    // ===== 内部 =====

    private emit(event: TaskRegistryEvent): void {
        const snapshot = this.list();
        this.listeners.forEach(l => {
            try { l(event, snapshot); } catch (e) {
                console.error('[taskRegistry] listener error', e);
            }
        });
    }

    private runCallbacks(
        map: Map<string, Set<TaskCompleteListener>>,
        taskId: string,
        task: RegisteredTask,
    ): void {
        const set = map.get(taskId);
        if (!set) return;
        // 拷贝以避免 callback 中 unsubscribe 修改 set 时迭代异常
        const callbacks = Array.from(set);
        for (const cb of callbacks) {
            try { cb(task); } catch (e) {
                console.error('[taskRegistry] task callback error', e);
            }
        }
        // 完成/失败的 callback 一次性消费（避免重复触发）
        map.delete(taskId);
    }
}

function isActive(status: GlobalTaskStatus): boolean {
    return status === 'pending' || status === 'queued' || status === 'running';
}

function isFrontendOnlyQueueTask(task: RegisteredTask): boolean {
    return FRONTEND_QUEUE_TASK_ID_RE.test(task.taskId);
}

// 全局单例（生产 / dev / 浏览器）。测试用 `new TaskRegistry(memoryStorage)` 隔离。
export const taskRegistry = new TaskRegistry();

// 导出类供测试用
export { TaskRegistry };
