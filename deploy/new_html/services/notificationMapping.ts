// new_html/services/notificationMapping.ts
//
// 2026-05-20 (Task System Overhaul M5)：把后端 dao_notification 表里的 row
// 反向映射到前端 RegisteredTask，使刷新页面后铃铛仍能展示历史 (completed / failed)。
//
// 后端写入路径：task_queue.py · complete_task / fail_task → NotificationDAO.create
//   title    = `<display_name> 已完成` 或 `<display_name> 失败`
//   message  = `任务 <task_id> 执行成功` 或 `任务 <task_id> 执行失败: <err>`
//   status   = 'unread' | 'read' | 'dismissed'
//   category = 'video' | 'image' | 'text' | 'material'
//
// 前端只关心 "我之前提交的任务现在到底是 completed 还是 failed"，所以
// rehydrate 时把它们注册成 RegisteredTask（终态）；运行中状态不持久化（用 SSE / 轮询恢复）。
//
// 注意：后端 notification_id 与 task_id 是不同概念。RegisteredTask.taskId 用 task_id 优先（与
// 内存中正在跑的 RegisteredTask 同键，避免重复），缺失时回退到 notification_id。

import type { RegisteredTask, SourcePage, TaskKind, GlobalTaskStatus } from '../types';

// 后端 dao_notification row 的 JSON 形态
export interface ServerNotificationRow {
    notification_id: string;
    user_id: string;
    task_id: string | null;
    type: string;
    category: string | null;
    title: string;
    message: string | null;
    status: 'unread' | 'read' | 'dismissed';
    target_view: string | null;
    target_project_id: string | null;
    target_page: string | null;
    target_item_id: string | null;
    metadata?: Record<string, unknown> | null;
    created_at: string;
    read_at?: string | null;
}

// SourcePage 白名单，过滤未知字符串
const VALID_PAGES: ReadonlyArray<SourcePage> = [
    'editor', 'script', 'design', 'materials', 'audio',
    'storyboard', 'generation', 'video', 'enhance',
    'postprocess', 'canvas', 'history', 'global',
];

function normalizeTargetPage(raw: string | null): SourcePage {
    if (raw && (VALID_PAGES as ReadonlyArray<string>).includes(raw)) {
        return raw as SourcePage;
    }
    return 'global';
}

/**
 * category（后端粗粒度）+ title（含模型/任务类型关键词）→ TaskKind（前端细粒度）。
 * 大致还原 generation kind，找不到就退到 'other'。
 */
function inferKindFromCategoryAndTitle(category: string | null, title: string): TaskKind {
    const t = (title || '').toLowerCase();
    if (category === 'video' || /upscale|放大|i2v|视频|seedance|wan2|kling|vidu|happyhorse|sora|veo/.test(t)) {
        if (/upscale|放大/.test(t)) return 'video-upscale';
        if (/seedance/.test(t)) return 'seedance';
        if (/wan2/.test(t)) return 'wan2';
        if (/kling/.test(t)) return 'kling';
        if (/vidu/.test(t)) return 'vidu';
        if (/happyhorse|happy[ -_]?horse/.test(t)) return 'happyhorse';
        if (/sora/.test(t)) return 'sora2';
        if (/veo/.test(t)) return 'veo';
        return 'video-i2v';
    }
    if (category === 'text' || /改写|分镜|rewrite|storyboard/.test(t)) {
        if (/改写|rewrite/.test(t)) return 'prompt-rewrite';
        if (/分镜|storyboard/.test(t)) return 'auto-storyboard';
        return 'script-segment';
    }
    if (category === 'material' || /抠图|matting/.test(t)) return 'matting';
    if (category === 'image' || /图|image/.test(t)) {
        if (/qwen.*lora/.test(t)) return 'qwen-lora';
        if (/qwen/.test(t)) return 'qwen-image';
        if (/kontext/.test(t)) return 'kontext';
        if (/角度|angle/.test(t)) return 'angle-adjust';
        if (/融合|fusion/.test(t)) return 'image-fusion';
        if (/全景|panorama/.test(t)) return 'panorama-360';
        if (/gemini/.test(t)) return 'gemini-image';
        if (/doubao|豆包/.test(t)) return 'doubao-image';
        if (/nanobanana|香蕉/.test(t)) return 'nanobanana';
        return 'comfyui-image';
    }
    if (/tts|配音/.test(t)) {
        if (/minimax/.test(t)) return 'minimax-tts';
        if (/gemini/.test(t)) return 'gemini-tts';
        return 'minimax-tts';
    }
    return 'other';
}

/**
 * "<X> 已完成" → completed；"<X> 失败" → failed；其它 → completed（系统通知也算完成态展示）
 */
function inferStatusFromTitle(title: string): GlobalTaskStatus {
    if (/失败|failed|error/i.test(title)) return 'failed';
    return 'completed';
}

/**
 * "<X> 已完成" / "<X> 失败" → "<X>" （把后缀剥掉，UI 自己根据 status 显示）
 */
function stripStatusSuffix(title: string): string {
    return title
        .replace(/\s*已完成\s*$/, '')
        .replace(/\s*失败\s*$/, '')
        .replace(/\s*completed\s*$/i, '')
        .replace(/\s*failed\s*$/i, '')
        .trim() || title;
}

/**
 * 解析 ISO / Pg timestamp 到 unix ms。失败回退到 Date.now()，避免 NaN 污染 store 排序。
 */
function parseTs(input: string | null | undefined): number {
    if (!input) return Date.now();
    const t = Date.parse(input);
    if (Number.isFinite(t)) return t;
    return Date.now();
}

/**
 * 后端 notification row → 前端 RegisteredTask。
 * 仅支持终态（completed / failed）—— 运行中任务靠 SSE / 轮询恢复，不走这条路。
 */
export function mapNotificationToTask(n: ServerNotificationRow): RegisteredTask | null {
    if (!n || !n.title) return null;
    const status = inferStatusFromTitle(n.title);
    const taskId = n.task_id || n.notification_id;
    if (!taskId) return null;

    const ts = parseTs(n.created_at);
    // 2026-05-20 (Phase 8)：后端 dao_notification.metadata 是 jsonb，直接透传给前端做富展示。
    // 形态非强约束（无效值或非对象兜底为 undefined）。
    const metadata = (n.metadata && typeof n.metadata === 'object' && !Array.isArray(n.metadata))
        ? (n.metadata as Record<string, unknown>)
        : undefined;

    return {
        taskId,
        kind: inferKindFromCategoryAndTitle(n.category, n.title),
        title: stripStatusSuffix(n.title),
        status,
        progress: status === 'completed' ? 1 : undefined,
        createdAt: ts,
        startedAt: ts,
        completedAt: ts,
        targetPage: normalizeTargetPage(n.target_page),
        targetProjectId: n.target_project_id || undefined,
        targetItemId: n.target_item_id || undefined,
        episodeId: undefined,
        error: status === 'failed' ? (n.message || '任务失败') : undefined,
        metadata,
        // 持久化标志：之后 mergeFromServer 用它去重 + 区分内存/后端来源
        // @ts-ignore 不污染 RegisteredTask 公共形态，只是个内部 hint
        _fromServer: true,
    } as RegisteredTask;
}

/**
 * 批量映射（从 GET /api/notifications 返回值）。过滤掉 dismissed —— 用户已主动隐藏。
 */
export function mapNotificationsToTasks(rows: ServerNotificationRow[]): RegisteredTask[] {
    return rows
        .filter(n => n && n.status !== 'dismissed')
        .map(mapNotificationToTask)
        .filter((t): t is RegisteredTask => t != null);
}
