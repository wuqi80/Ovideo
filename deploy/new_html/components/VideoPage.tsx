import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Upload, Video, Play, RefreshCw, Trash2, Link, Unlink, 
    GripVertical, CheckSquare, Square, Clock, Film, AlertCircle,
    Image as ImageIcon, ChevronDown, Download, Maximize, Mic, Scissors,
    LayoutGrid, List, X, Loader2, Check, Music, Eye, Volume2, Plus,
    History, ArrowRight, Maximize2, Database, ImageOff, RotateCw, Settings,
    Combine, Split
} from 'lucide-react';
import * as videoService from '../services/videoService';
import type { SeedanceParams } from '../services/videoService';
import { AppView, TaskNotification } from '../types';
import {
    getCardHeightClass,
    getPreviewImageHeightClass,
    getResultVisualHeightClass,
    isSeedanceModel,
    CARD_MEDIA_HEIGHT_CLASS,
    CARD_BODY_SCROLL_CLASS,
    SIMPLE_PROMPT_TEXTAREA_CLASS,
    PLACEHOLDER_PROMPT_TEXTAREA_CLASS,
    RESULT_PROMPT_READONLY_CLASS,
} from '../utils/videoCardLayout';
import {
    SeedancePanelWithCandidates,
    DashScopeCardWithCandidates,
    DurationFieldForGroup,
    AudioBadgesRow,
} from './video/VideoCard';
import { MediaBadges } from './video/MediaBadges';
import { SeedanceDetailModal } from './video/SeedanceDetailModal';
// 2026-05-24 — DashScope 共享 API：合体(Kling) / 大乘(Vidu) / 炼虚(HappyHorse)
// Task 3 cleanup：`makeDefaultDashScopeParams` 单一可信源在 videoService.ts，
// 不再从 DashScopeCards.tsx 间接导入（旧 legacy 工厂已删除）。
// DashScopeVideoCard 不再直接 import — 走 DashScopeCardWithCandidates 包装器以注入 mention candidates。
import { makeDefaultDashScopeParams, type DashScopeVideoParams } from '../services/videoService';
import { getVideoSegments, createVideoSegment } from '../services/apiService';
import { buildEmptyTaskGroup } from '../utils/videoTaskInsert';
import { useSeedanceCandidates } from '../hooks/useSeedanceCandidates';
import { StoryboardSyncModal, type SyncMode } from './video/StoryboardSyncModal';
import { applySyncStrategy } from '../utils/storyboardSync';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
// 2026-05-20 (Task System Overhaul M2)：把视频任务的轮询提到模块级 service，
// 实现「切页后台继续生成 + 完成时铃铛通知」。
//   M2a：注册到 TaskRegistry，让铃铛 / TaskBadge 看到任务（之前已注入）。
//   M2b：轮询本身 detach 时不再 clearInterval —— 切到其它页继续 polling，
//        新到状态实时同步到 TaskRegistry；回页时通过 attachVideoPollCallbacks
//        把 UI 更新回调重新接上。
import {
    startVideoPoll,
    detachVideoPollCallbacks,
    attachVideoPollCallbacks,
    stopVideoPoll,
    getKnownVideoTaskIds,
    getVideoPollTaskId,
    isVideoPollActive,
} from '../services/videoTaskPoller';

// ==================== 类型定义 ====================

interface VideoPageProps {
    onAddNotification?: (notification: Omit<TaskNotification, 'id' | 'timestamp'>) => string;
    onUpdateNotification?: (id: string, updates: Partial<TaskNotification>) => void;
    isActive?: boolean;
    sessionScope?: string;
    /** 纯 episodeId（sessionScope 可能带 :scriptId 后缀，不能用于 video-segments API）。
     *  视频生成完成后需把 video_url 同步进该剧集的 video_segments，美化页才看得到。 */
    episodeId?: string;
    /** Task 6：上层（VideoGenPage）下传的 storyboard 列表，用于 ↻ 同步分镜弹窗。 */
    storyboardItems?: any[];
    /** Task 6：full_reset 后回到上层重新触发 handleImportAll。 */
    onRequestReimport?: () => void | Promise<void>;
}

// 2026-05-25 (Task B2)：手工在 storyboard 卡片之间插入空卡的小按钮。
// 渲染在左侧分镜列表的顶部和每张卡之后，独立组件方便后续单独样式化或测试。
//
// 2026-05-25 hotfix：左右两侧高度对齐——把按钮和右侧 spacer 共用
// 同一组 CLASSES（除颜色/可点击性外），保证像素级对齐（参考 link button
// 的 h-[18px] 对齐手法）。任何 padding/margin/border/font-size 改动都必须
// 同时反映到 spacer，否则左右又会错位。
const INSERT_EMPTY_BTN_BASE_CLASSES =
    'w-full my-1 py-1.5 border border-dashed rounded text-[10px] flex items-center justify-center gap-1 transition-colors';
const InsertEmptyCardButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`${INSERT_EMPTY_BTN_BASE_CLASSES} border-n40 hover:border-primary hover:bg-primary-light text-n100 hover:text-primary`}
        title="在此处插入一张空白卡片"
    >
        <Plus className="w-3 h-3" /> 插入空卡
    </button>
);
// 右侧结果队列的占位元素：DOM 结构、字体、padding 必须与按钮一致才能像素对齐。
// 用 <button type="button"> + tabIndex=-1 + aria-hidden 而不是 <div>，
// 避免 button 与 div 在某些 browser default reset 下 line-height 微差。
const InsertEmptyCardSpacer: React.FC = () => (
    <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className={`${INSERT_EMPTY_BTN_BASE_CLASSES} border-transparent text-transparent pointer-events-none select-none`}
    >
        <Plus className="w-3 h-3" /> 插入空卡
    </button>
);

// ==================== 主组件 ====================

export const VideoPage: React.FC<VideoPageProps> = ({ 
    onAddNotification,
    onUpdateNotification,
    isActive = true,
    sessionScope,
    episodeId,
    storyboardItems = [],
    onRequestReimport,
}) => {
    // 状态管理
    const [uploadedImages, setUploadedImages] = useState<videoService.UploadedImage[]>([]);
    const [taskGroups, setTaskGroups] = useState<videoService.TaskGroup[]>([]);
    const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({});
    const [tasksStatus, setTasksStatus] = useState<Record<string, videoService.TaskStatus>>({});
    const [taskStartTimes, setTaskStartTimes] = useState<Record<string, number>>({});
    
    // UI状态
    // 2026-05-20 (Bug #3)：viewMode / globalModel 是用户偏好，按 sessionScope（episodeId）持久化。
    // 切换页面 + 刷新都不会丢，避免每次回到这页都需重新选「卡片/列表」和默认模型。
    const [viewMode, setViewMode] = usePersistedPageState<'card' | 'list'>({
        page: 'VideoPage:viewMode',
        episodeId: sessionScope ?? null,
        version: 1,
        defaultValue: 'card',
    });
    const [isLoading, setIsLoading] = useState(true);
    const [globalModel, setGlobalModel] = usePersistedPageState<videoService.VideoModel>({
        page: 'VideoPage:globalModel',
        episodeId: sessionScope ?? null,
        // 2026-06-15：默认从 'Wan2'（练气/ComfyUI，需 GPU agent，本部署跑不了）改为
        // 'HappyHorse'（炼虚，百炼外部 API，支持多参考图，实测稳定出片）。bump version
        // 让已保存的旧偏好（含历史 episode 选中的飞升）一并重置到新默认。
        version: 2,
        defaultValue: 'HappyHorse',
    });
    
    // 拖拽状态
    const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null);
    
    // 弹窗状态
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [lightboxType, setLightboxType] = useState<'image' | 'video'>('image');
    
    // 功能弹窗状态
    const [upscaleModalUuid, setUpscaleModalUuid] = useState<string | null>(null);
    const [voiceModalUuid, setVoiceModalUuid] = useState<string | null>(null);
    const [editModalUuid, setEditModalUuid] = useState<string | null>(null);
    // Issue 7: list-view ⚙ detail modal
    const [seedanceDetailUuid, setSeedanceDetailUuid] = useState<string | null>(null);
    const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);
    const [voiceAudioFile, setVoiceAudioFile] = useState<File | null>(null);
    const [voiceStartTime, setVoiceStartTime] = useState(0);
    const [voicePrompt, setVoicePrompt] = useState('');
    const [cropStartTime, setCropStartTime] = useState(0);
    const [cropEndTime, setCropEndTime] = useState(5);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Toast消息
    const [toast, setToast] = useState<string | null>(null);
    
    // Refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const leftPanelRef = useRef<HTMLDivElement>(null);
    const rightPanelRef = useRef<HTMLDivElement>(null);
    const editVideoRef = useRef<HTMLVideoElement>(null);
    const pollingIntervals = useRef<Record<string, NodeJS.Timeout>>({});
    const isScrollSyncing = useRef(false);
    
    // Seedance 2.0 参数（按 group.uuid 索引），不污染 TaskGroup 类型
    const [seedanceParamsByUuid, setSeedanceParamsByUuid] = useState<Record<string, SeedanceParams>>({});

    // 2026-05-24 — DashScope 共享 API（合体/大乘/炼虚）参数（按 group.uuid 索引）
    const [dashScopeParamsByUuid, setDashScopeParamsByUuid] = useState<Record<string, DashScopeVideoParams>>({});

    // 2026-05-24 — DashScope 图片选择器：调用方注入 callback，picker 选完后回调
    const [dashScopePicker, setDashScopePicker] = useState<{
        groupUuid: string;
        callback: (m: videoService.SeedanceMediaInput) => void;
    } | null>(null);

    // Task 6：分镜元信息（音轨 URL / 时长 / 已混音）按 itemId 索引
    const [storyboardMetaByItemId, setStoryboardMetaByItemId] = useState<Record<string, videoService.StoryboardMeta>>({});

    // Task 6：↻ 同步分镜弹窗
    const [syncModalOpen, setSyncModalOpen] = useState(false);

    // 2026-05-19 (Task A): reverse-lookup storyboard_item.item_id from a task group.
    // Convention: handleImportAll sets uploadedImage.id === item_id and stores
    // the linked groupUuid on uploadedImage.linkedGroupUuids[]. We pick the first
    // matching image. Returns undefined for upload-only cards (no storyboard origin).
    const getStoryboardItemId = useCallback((uuid: string): string | undefined => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return undefined;
        const firstId = group.ids?.[0];
        if (!firstId) return undefined;
        const img = uploadedImages.find(i => i.id === firstId || i.linkedGroupUuids?.includes(uuid));
        return img?.storyboardItemId ?? undefined;
    }, [taskGroups, uploadedImages]);

    const getSeedanceParams = useCallback((uuid: string, model: videoService.VideoModel): SeedanceParams => {
        const existing = seedanceParamsByUuid[uuid];
        if (existing) return existing;

        // Issue 5a: when a card is freshly switched to Seedance2/Fast, auto-pull the
        // storyboard image linked to this group as a reference_image so the prompt
        // editor's @-popover can resolve "current_card" candidates and the panel
        // doesn't show 0/9 while the card visually has an image.
        const group = taskGroups.find(g => g.uuid === uuid);
        const linkedImages = uploadedImages.filter(img =>
            img.url
            && !img.isPlaceholder
            && (
                img.linkedGroupUuids?.includes(uuid)
                || group?.ids?.includes(img.id)
            )
        );
        const seedMedia: videoService.SeedanceMediaInput[] = linkedImages.map(img => ({
            kind: 'image',
            url: img.url,
            role: 'reference_image',
        }));

        // 2026-05-20 (Bug 1): duration must follow audio > planned > default, not a
        // hard-coded 5. group.duration is already kept in sync by useReactiveDuration
        // (DurationFieldForGroup); fall back to storyboard_meta if group is missing.
        // 2026-05-20 (Bug 3)：兜底从 5s 改为 3s（DURATION_MIN_SEC），与 export-script
        // 端写入的最小 2000ms 一致——只有当 DB/meta 全空时才会走到这里。
        const itemId = group?.ids?.[0];
        const meta = itemId ? storyboardMetaByItemId[itemId] : undefined;
        const reactiveDur = meta ? videoService.computeReactiveDurationFromMeta(meta) : undefined;
        const dur = group?.duration ?? reactiveDur ?? 3;

        // 2026-05-20 (Bug 3b)：切到 Seedance 时自动带本分镜的参考音
        // 优先级与 handleImportAll 一致：mixed > dialogue > narration > sfx。
        const refAudio =
            meta?.mixedAudioUrl
            || meta?.audioUrls?.dialogue
            || meta?.audioUrls?.narration
            || meta?.audioUrls?.sfx
            || null;
        if (refAudio) {
            seedMedia.push({ kind: 'audio', url: refAudio, role: 'reference_audio' });
        }

        return {
            sub_model: model === 'Seedance2Fast' ? 'fast' : 'standard',
            prompt: imagePrompts[itemId || ''] || '',
            media_inputs: seedMedia,
            resolution: '720p',
            ratio: 'adaptive',
            duration: dur,
            seed: -1,
            watermark: false,
            generate_audio: true,
            camera_fixed: false,
        };
    }, [seedanceParamsByUuid, taskGroups, uploadedImages, imagePrompts, storyboardMetaByItemId]);

    const setSeedanceParams = useCallback((uuid: string, next: SeedanceParams) => {
        setSeedanceParamsByUuid(prev => ({ ...prev, [uuid]: next }));
    }, []);

    // 2026-05-24 — DashScope 共享 API 参数 getter/setter（合体/大乘/炼虚）
    // 2026-05-25 #1/#2 hotfix — storyboard 图按 isPair 注入 role：
    //   - 单图 I2V  → first_frame（Vidu reference 通道 / Kling i2v 通道）
    //   - 双图 MORPH → first_frame + last_frame（Vidu startend / Kling morph 通道）
    //   - HappyHorse → 始终 reference_image（仅支持 r2v 通道）
    // 之前统一注入为 reference_image 是 bug：导致 Kling/Vidu 看到 storyboard
    // 双图也走不到 morph/startend 通道，并且卡内首/尾槽永远空。
    const getDashScopeParams = useCallback((
        uuid: string,
        model: videoService.DashScopeVideoModel,
    ): DashScopeVideoParams => {
        const existing = dashScopeParamsByUuid[uuid];
        if (existing && existing.model === model) return existing;

        const group = taskGroups.find(g => g.uuid === uuid);
        const isPair = (group?.ids?.length || 0) === 2;
        const linkedImages = uploadedImages.filter(img =>
            img.url
            && !img.isPlaceholder
            && (
                img.linkedGroupUuids?.includes(uuid)
                || group?.ids?.includes(img.id)
            )
        );

        // 重要：按 storyboard ids 的顺序（不是 uploadedImages 的顺序）配对，
        // 否则 Morph 双图的 first/last 会随机翻转。
        const orderedImgs = (group?.ids || [])
            .map(id => linkedImages.find(i => i.id === id))
            .filter((x): x is typeof linkedImages[number] => !!x);

        // sb_ 开头是分镜项 ID（非 files 表 file_id），不能当 file_id 下发。
        // 留空 file_id → submitDashScopeVideoTask.resolveUrl 会用 url（worker 负责还原 Base64）。
        const fileIdOf = (id: string): string | undefined =>
            id && !id.startsWith('sb_') ? id : undefined;

        let seedMedia: videoService.SeedanceMediaInput[];
        if (model === 'HappyHorse') {
            // HH 始终 r2v，全部当参考图
            seedMedia = orderedImgs.map(img => ({
                kind: 'image' as const,
                url: img.url,
                file_id: fileIdOf(img.id),
                role: 'reference_image' as const,
            }));
        } else if (isPair && orderedImgs.length >= 2) {
            seedMedia = [
                { kind: 'image', url: orderedImgs[0].url, file_id: fileIdOf(orderedImgs[0].id), role: 'first_frame' },
                { kind: 'image', url: orderedImgs[1].url, file_id: fileIdOf(orderedImgs[1].id), role: 'last_frame' },
            ];
        } else if (orderedImgs.length >= 1) {
            seedMedia = [
                { kind: 'image', url: orderedImgs[0].url, file_id: fileIdOf(orderedImgs[0].id), role: 'first_frame' },
            ];
        } else {
            seedMedia = [];
        }

        const seedPrompt = group?.ids?.[0] ? (imagePrompts[group.ids[0]] || '') : '';
        return makeDefaultDashScopeParams(model, seedPrompt, seedMedia);
    }, [dashScopeParamsByUuid, taskGroups, uploadedImages, imagePrompts]);

    const setDashScopeParams = useCallback((uuid: string, next: DashScopeVideoParams) => {
        setDashScopeParamsByUuid(prev => ({ ...prev, [uuid]: next }));
    }, []);

    // 2026-05-24 — picker 打开器：DashScope 卡片调用此函数请求选图
    const openDashScopePicker = useCallback((
        uuid: string,
        callback: (m: videoService.SeedanceMediaInput) => void,
    ) => {
        setDashScopePicker({ groupUuid: uuid, callback });
    }, []);

    // Task 6：单 group patch（用于响应式时长 hook 写回 duration / durationUserOverride）
    const patchTaskGroup = useCallback((uuid: string, patch: Partial<videoService.TaskGroup>) => {
        setTaskGroups(prev => prev.map(g => (g.uuid === uuid ? { ...g, ...patch } : g)));
    }, []);

    // ==================== Toast工具 ====================
    
    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    }, []);
    
    // ==================== 排序后的任务组 ====================
    
    // 2026-05-20 (Bug 5)：去掉二次排序——保留 taskGroups 数组的当前顺序，
    // 让用户的拖拽 (handleDragDrop) 真正生效。初次导入时 handleImportAll 已按
    // storyboard.sort_order 升序构造 groups[]，所以默认仍是镜头 1→N；用户拖拽后
    // 顺序写回 setTaskGroups + saveSession，下次进入页面从 WorkspaceSession 恢复。
    // 想退回剧本顺序的用户可以点「↻ 同步分镜 / 重新导入」。
    const sortedTaskGroups = useMemo(() => {
        return taskGroups.map((group, originalIndex) => ({ group, originalIndex }));
    }, [taskGroups]);
    
    // ==================== 滚动同步 ====================
    
    useEffect(() => {
        const leftPanel = leftPanelRef.current;
        const rightPanel = rightPanelRef.current;
        
        if (!leftPanel || !rightPanel) return;
        
        const syncScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
            if (isScrollSyncing.current) return;
            isScrollSyncing.current = true;
            
            const maxScroll = source.scrollHeight - source.clientHeight;
            if (maxScroll <= 0) {
                isScrollSyncing.current = false;
                return;
            }
            
            const scrollPercentage = source.scrollTop / maxScroll;
            const targetMaxScroll = target.scrollHeight - target.clientHeight;
            if (targetMaxScroll > 0) {
                target.scrollTop = scrollPercentage * targetMaxScroll;
            }
            
            requestAnimationFrame(() => {
                isScrollSyncing.current = false;
            });
        };
        
        const handleLeftScroll = () => syncScroll(leftPanel, rightPanel);
        const handleRightScroll = () => syncScroll(rightPanel, leftPanel);
        
        leftPanel.addEventListener('scroll', handleLeftScroll);
        rightPanel.addEventListener('scroll', handleRightScroll);
        
        return () => {
            leftPanel.removeEventListener('scroll', handleLeftScroll);
            rightPanel.removeEventListener('scroll', handleRightScroll);
        };
    }, [taskGroups.length]);
    
    // ==================== 初始化和会话管理 ====================
    
    useEffect(() => {
        loadSession();
        // 2026-05-20 (M2)：组件 unmount 时不再 clearInterval —— 切页后台任务持续。
        // 仅 detach 回调（避免持有过期 setTasksStatus 闭包），以及清掉本组件
        // 内部留下的 component-scoped pollingIntervals（旧路径残留，理论上空）。
        return () => {
            Object.values(pollingIntervals.current).forEach(clearInterval);
            for (const uuid of getKnownVideoTaskIds()) {
                detachVideoPollCallbacks(uuid);
            }
        };
    }, []);

    // 2026-05-20 (M2)：组件 mount / 重新 mount 时把全局已存活的 video poller
    // 回调重新接到本组件 setState 上 —— 这样即使在其它页面期间任务完成了，回到
    // 视频页时本地 tasksStatus 也会立即被对齐。
    // 注意：此 useEffect 必须放在 `buildPollCallbacks`（useCallback 声明在下方
    // 1200+ 行）之后，否则 deps 数组 `[buildPollCallbacks]` 求值时该 const 还在
    // TDZ，会抛 `Cannot access 'buildPollCallbacks' before initialization`。
    // 实际定义见后文 reattachActiveVideoPollers useEffect。

    // 🔒 双保险：从 DB(video_segments，worker 已落库) 兜底重载已完成视频。
    // 即使 workspace session 丢失/未及时保存，只要 video_segments.video_url 有值，
    // 视频页就能恢复出来（再配合美化页本就直接读 video_segments）。按 storyboard_item_id
    // (=group.ids[0]) 匹配任务组；只补会话里没有的视频，不覆盖用户已有的多个 take。
    useEffect(() => {
        if (!episodeId || taskGroups.length === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const res: any = await getVideoSegments(episodeId);
                const byItem: Record<string, string> = {};
                for (const sg of (res?.segments || [])) {
                    const item = sg.storyboard_item_id ?? sg.storyboardItemId;
                    const url = sg.video_url ?? sg.videoUrl;
                    if (item && url) byItem[item] = url;
                }
                if (cancelled || Object.keys(byItem).length === 0) return;
                const token = localStorage.getItem('auth_token');
                const bare = (u: any) => (typeof u === 'string' ? u.split('?')[0] : u);
                setTasksStatus(prev => {
                    const next = { ...prev };
                    let changed = false;
                    for (const g of taskGroups) {
                        const item = g.ids && g.ids[0];
                        const raw = item ? byItem[item] : undefined;
                        if (!raw) continue;
                        const url = raw.includes('token=') ? raw : raw + (raw.includes('?') ? '&' : '?') + `token=${token}`;
                        const cur = next[g.uuid] || {};
                        const curVideos = cur.videos || [];
                        if (curVideos.some((v: any) => bare(v) === bare(url))) continue; // 已有，跳过
                        next[g.uuid] = {
                            ...cur,
                            state: 'done',
                            progress: 100,
                            videos: [...curVideos, url],
                            result: url,
                            keepResult: true,
                        };
                        changed = true;
                    }
                    return changed ? next : prev;
                });
            } catch (e) {
                console.warn('DB 兜底重载 video_segments 失败（不致命）:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [episodeId, taskGroups]);

    // 🆕 当页面激活时检查是否有新导出的 video_tasks
    useEffect(() => {
        if (isActive) {
            checkAndLoadVideoTasks();
        }
    }, [isActive]);
    
    // 🆕 单独检查 video_tasks（不重载整个会话）
    const checkAndLoadVideoTasks = async () => {
        const username = localStorage.getItem('username') || 'guest';
        const storageKey = `anime-current-project-id-${username}`;
        const projectId = localStorage.getItem(storageKey);
        
        if (!projectId) return;
        
        try {
            console.log('🔄 页面激活，检查新导出的 video_tasks:', projectId);
            const projectResponse = await fetch(`/api/projects/${projectId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
            });
            
            if (!projectResponse.ok) return;
            
            const projectData = await projectResponse.json();
            const videoTasks = projectData.project?.video_tasks || [];
            
            console.log('📋 检查结果:', { videoTasksCount: videoTasks.length });
            
            if (videoTasks.length > 0) {
                console.log(`📦 发现 ${videoTasks.length} 个新导出的镜头，追加到现有数据`);
                
                const newImages: videoService.UploadedImage[] = [];
                const newGroups: videoService.TaskGroup[] = [];
                const newPrompts: Record<string, string> = {};
                
                videoTasks.forEach((task: any, index: number) => {
                    const imgId = `img_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
                    const token = localStorage.getItem('auth_token');
                    let imageUrl = task.image_url || '';
                    
                    if (imageUrl && !imageUrl.includes('token=')) {
                        imageUrl += (imageUrl.includes('?') ? '&' : '?') + `token=${token}`;
                    }
                    
                    if (!imageUrl) {
                        console.warn(`⚠️ 镜头 ${task.storyboard_id} 没有图片，跳过`);
                        return;
                    }
                    
                    newImages.push({
                        id: imgId,
                        url: imageUrl,
                        filename: `${task.scene || 'shot'}_${task.storyboard_id}.png`,
                        uploadTime: Date.now()
                    });
                    
                    newPrompts[imgId] = task.video_prompt || '';
                    
                    newGroups.push({
                        uuid: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        ids: [imgId],
                        model: 'HappyHorse',  // 默认炼虚（百炼，可用）；原 'Wan2' 需 GPU agent
                        createdAt: Date.now()
                    });
                });
                
                // 追加到现有数据
                setUploadedImages(prev => [...prev, ...newImages]);
                setTaskGroups(prev => [...prev, ...newGroups]);
                setImagePrompts(prev => ({...prev, ...newPrompts}));
                
                console.log(`✅ 已追加 ${newImages.length} 个新导出的镜头`);
                
                // 清空项目的 video_tasks（避免重复加载）
                try {
                    await fetch(`/api/projects/${projectId}/clear-video-tasks`, {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    console.log('✅ 已清空项目的 video_tasks');
                } catch (err) {
                    console.warn('清空 video_tasks 失败:', err);
                }
            }
        } catch (err) {
            console.warn('检查 video_tasks 失败:', err);
        }
    };
    
    const loadSession = async () => {
        setIsLoading(true);
        try {
            // 加载保存的会话数据
            const result = await videoService.loadWorkspaceSession(sessionScope);
            let existingImages: videoService.UploadedImage[] = [];
            let existingGroups: videoService.TaskGroup[] = [];
            let existingPrompts: Record<string, string> = {};
            let existingStatus: Record<string, videoService.TaskStatus> = {};
            
            if (result.success && result.session) {
                // 空数据保护：服务器返回空session时保留当前内存状态
                const session = result.session;
                const hasData = (session.task_groups?.length > 0) || (session.uploaded_images?.length > 0);
                if (!hasData && (uploadedImages.length > 0 || taskGroups.length > 0)) {
                    console.warn('⚠️ 服务器返回空session但内存中有数据，保留当前状态');
                    setIsLoading(false);
                    return;
                }
                
                // ⚠️ URL 严格白名单：仅接受 http(s):// 或 / 起头的可持久化 URL。
                // 拒绝 data:（base64 内联图，长度可达几 MB，会撑爆 system_configs JSONB
                // 并触发 414 Request-URI Too Large）和 blob:（页面切换即失效）。
                // 历史上写入了 data:/blob: 的旧 session 会在这里被报告并清理，避免静默崩。
                // ⭐ Task 6：占位卡（isPlaceholder=true 且 url='') 必须保留，用于空分镜流程。
                const rawImages = session.uploaded_images || [];
                const dropped: { id: string; reason: string; sample: string }[] = [];
                existingImages = rawImages.reduce<videoService.UploadedImage[]>((acc, img) => {
                    if (!img.url) {
                        if (img.isPlaceholder) {
                            acc.push(img);
                        } else {
                            dropped.push({ id: img.id, reason: 'empty url', sample: '' });
                        }
                        return acc;
                    }
                    const url = img.url;
                    if (url.startsWith('data:')) {
                        dropped.push({ id: img.id, reason: 'data: URL（base64 内联图）', sample: url.slice(0, 60) + '...' });
                        return acc;
                    }
                    if (url.startsWith('blob:')) {
                        dropped.push({ id: img.id, reason: 'blob: URL（已失效）', sample: url.slice(0, 60) });
                        return acc;
                    }
                    if (!url.startsWith('http') && !url.startsWith('/')) {
                        dropped.push({ id: img.id, reason: '未识别协议', sample: url.slice(0, 60) });
                        return acc;
                    }
                    acc.push(img);
                    return acc;
                }, []);
                if (dropped.length > 0) {
                    console.warn('[VideoPage] loadSession 丢弃 %d 张图片:', dropped.length, dropped.slice(0, 5));
                }
                if (rawImages.length > 0 && existingImages.length === 0) {
                    console.error('[VideoPage] loadSession 收到 %d 张图但全部被过滤！scope=%s sample=%o', rawImages.length, sessionScope, rawImages.slice(0, 2));
                }

                // 给图片 URL 注入 token（保持与 videos/result 处理一致，否则 <img src> 401）
                // ⭐ Task 6：占位卡 url 为空，此处直接跳过不报错。
                {
                    const _token = localStorage.getItem('auth_token');
                    if (_token) {
                        existingImages = existingImages.map(img => {
                            if (img.url && !img.url.includes('token=')) {
                                const sep = img.url.includes('?') ? '&' : '?';
                                return { ...img, url: img.url + sep + 'token=' + _token };
                            }
                            return img;
                        });
                    }
                }

                // ⭐ Task 6：恢复 seedance_params 与 storyboard_meta
                const sessSP = (session as any).seedance_params as Record<string, SeedanceParams> | undefined;
                if (sessSP && typeof sessSP === 'object') {
                    setSeedanceParamsByUuid(sessSP);
                } else {
                    setSeedanceParamsByUuid({});
                }
                const sessMeta = (session as any).storyboard_meta as Record<string, videoService.StoryboardMeta> | undefined;
                if (sessMeta && typeof sessMeta === 'object') {
                    setStoryboardMetaByItemId(sessMeta);
                } else {
                    setStoryboardMetaByItemId({});
                }

                // 2026-05-24 — 恢复 DashScope 共享 API 参数
                const sessDS = (session as any).dashscope_params as Record<string, DashScopeVideoParams> | undefined;
                if (sessDS && typeof sessDS === 'object') {
                    setDashScopeParamsByUuid(sessDS);
                } else {
                    setDashScopeParamsByUuid({});
                }
                
                const validImageIds = new Set(existingImages.map(img => img.id));
                
                // 过滤任务组，确保引用的图片存在（兼容 ids 和旧的 imageId）
                existingGroups = (session.task_groups || []).filter(group => {
                    if (Array.isArray(group.ids) && group.ids.length > 0) {
                        return group.ids.some(id => validImageIds.has(id));
                    }
                    return validImageIds.has((group as any).imageId);
                });
                
                const validGroupUuids = new Set(existingGroups.map(g => g.uuid));
                
                // 过滤prompts
                existingPrompts = {};
                Object.entries(session.image_prompts || {}).forEach(([key, value]) => {
                    if (validImageIds.has(key) || validGroupUuids.has(key)) {
                        existingPrompts[key] = value;
                    }
                });
                
                // 处理任务状态
                const token = localStorage.getItem('auth_token');
                const statusWithToken: Record<string, videoService.TaskStatus> = {};
                const pendingTaskIds: { uuid: string; taskId: string }[] = [];
                
                Object.entries(session.tasks_status || {}).forEach(([uuid, status]) => {
                    if (!validGroupUuids.has(uuid)) return;
                    
                    const videos = (status.videos || []).map(url => {
                        if (typeof url === 'string' && url && !url.includes('token=')) {
                            return url + (url.includes('?') ? '&' : '?') + `token=${token}`;
                        }
                        return url;
                    });
                    let result = status.result || '';
                    if (result && !result.includes('token=')) {
                        result = result + (result.includes('?') ? '&' : '?') + `token=${token}`;
                    }
                    statusWithToken[uuid] = { ...status, videos, result };
                    
                    if (status.state === 'pending' && status.taskId) {
                        pendingTaskIds.push({ uuid, taskId: status.taskId });
                    }
                });
                existingStatus = statusWithToken;
                
                console.log(`✅ 会话恢复: ${existingImages.length}张图片, ${existingGroups.length}个任务组`);
                
                // 恢复未完成任务的轮询
                if (pendingTaskIds.length > 0) {
                    setTimeout(() => {
                        pendingTaskIds.forEach(({ uuid, taskId }) => {
                            setTasksStatus(prev => ({
                                ...prev,
                                [uuid]: { ...prev[uuid], state: 'running', taskId }
                            }));
                            startPolling(uuid, taskId);
                        });
                    }, 500);
                }
            }
            
            // 🆕 检查当前项目是否有新导出的 video_tasks
            const username = localStorage.getItem('username') || 'guest';
            const storageKey = `anime-current-project-id-${username}`;
            const projectId = localStorage.getItem(storageKey);
            
            if (projectId) {
                try {
                    console.log('🔍 检查项目 video_tasks:', projectId);
                    const projectResponse = await fetch(`/api/projects/${projectId}`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
                    });
                    
                    if (projectResponse.ok) {
                        const projectData = await projectResponse.json();
                        // 🔧 修复：API返回 {success, project}，不是 {data}
                        const videoTasks = projectData.project?.video_tasks || [];
                        
                        // 🔍 调试日志
                        console.log('📋 API返回的 projectData:', {
                            success: projectData.success,
                            hasProject: !!projectData.project,
                            videoTasksCount: videoTasks.length,
                            videoTasks: videoTasks
                        });
                        
                        if (videoTasks.length > 0) {
                            console.log(`📦 从项目发现 ${videoTasks.length} 个新导出的镜头，追加到现有数据`);
                            
                            // 🆕 转换 video_tasks 并追加到现有数据
                            const newImages: videoService.UploadedImage[] = [];
                            const newGroups: videoService.TaskGroup[] = [];
                            const newPrompts: Record<string, string> = {};
                            
                            videoTasks.forEach((task: any, index: number) => {
                                // 🔧 修复：允许没有 image_url 的任务也导入，用户可以后续上传图片
                                const imgId = `img_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
                                const token = localStorage.getItem('auth_token');
                                let imageUrl = task.image_url || '';
                                
                                // 🔧 修复：只有有效的 image_url 才添加 token
                                if (imageUrl && !imageUrl.includes('token=')) {
                                    imageUrl += (imageUrl.includes('?') ? '&' : '?') + `token=${token}`;
                                }
                                
                                // 🔧 如果没有图片URL，跳过这个任务（在画面分镜中没有选择图片）
                                if (!imageUrl) {
                                    console.warn(`⚠️ 镜头 ${task.storyboard_id} 没有图片，跳过`);
                                    return;
                                }
                                
                                newImages.push({
                                    id: imgId,
                                    url: imageUrl,
                                    filename: `${task.scene || 'shot'}_${task.storyboard_id}.png`,
                                    uploadTime: Date.now()
                                });
                                
                                // 使用 video_prompt 作为提示词
                                newPrompts[imgId] = task.video_prompt || '';
                                
                                // 创建任务组
                                newGroups.push({
                                    uuid: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                    ids: [imgId],
                                    model: 'HappyHorse',  // 默认炼虚（百炼，可用）；原 'Wan2' 需 GPU agent
                                    createdAt: Date.now()
                                });
                            });
                            
                            // 🆕 追加到现有数据后面
                            setUploadedImages([...existingImages, ...newImages]);
                            setTaskGroups([...existingGroups, ...newGroups]);
                            setImagePrompts({...existingPrompts, ...newPrompts});
                            setTasksStatus(existingStatus);
                            
                            console.log(`✅ 已追加 ${newImages.length} 个新导出的镜头`);
                            console.log(`📊 当前总计: ${existingImages.length + newImages.length}张图片, ${existingGroups.length + newGroups.length}个任务组`);
                            
                            // 🔧 清空项目的 video_tasks（避免重复加载）
                            try {
                                await fetch(`/api/projects/${projectId}/clear-video-tasks`, {
                                    method: 'POST',
                                    headers: { 
                                        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
                                        'Content-Type': 'application/json'
                                    }
                                });
                                console.log('✅ 已清空项目的 video_tasks');
                            } catch (err) {
                                console.warn('清空 video_tasks 失败:', err);
                            }
                        } else {
                            // 没有新的 video_tasks，使用现有数据
                            setUploadedImages(existingImages);
                            setTaskGroups(existingGroups);
                            setImagePrompts(existingPrompts);
                            setTasksStatus(existingStatus);
                        }
                    } else {
                        // 加载项目失败，使用现有数据
                        setUploadedImages(existingImages);
                        setTaskGroups(existingGroups);
                        setImagePrompts(existingPrompts);
                        setTasksStatus(existingStatus);
                    }
                } catch (err) {
                    console.warn('加载项目 video_tasks 失败:', err);
                    // 出错时使用现有数据
                    setUploadedImages(existingImages);
                    setTaskGroups(existingGroups);
                    setImagePrompts(existingPrompts);
                    setTasksStatus(existingStatus);
                }
            } else {
                // 没有项目ID，使用现有数据
                setUploadedImages(existingImages);
                setTaskGroups(existingGroups);
                setImagePrompts(existingPrompts);
                setTasksStatus(existingStatus);
            }
            
        } catch (error) {
            console.error('加载会话失败:', error);
        } finally {
            setIsLoading(false);
        }
    };
    
    const saveSession = useCallback(async () => {
        const cleanedStatus: Record<string, videoService.TaskStatus> = {};
        Object.entries(tasksStatus).forEach(([uuid, status]) => {
            // 保存所有状态的任务，运行中的任务标记为 pending 以便恢复后重新轮询
            const savedState = (status.state === 'running' || status.state === 'processing') 
                ? 'pending'  // 运行中的任务保存为 pending，恢复后会重新检查
                : status.state;
            
            cleanedStatus[uuid] = {
                ...status,
                state: savedState,
                taskId: status.taskId, // 保留 taskId 以便恢复后继续轮询
                videos: (status.videos || []).map(url => typeof url === 'string' ? url.split('?')[0] : url),
                videoGenerateTimes: status.videoGenerateTimes || [], // 保留视频生成时间
                result: status.result ? status.result.split('?')[0] : '',
                isUpscaled: status.isUpscaled,
                selected: status.selected
            };
        });
        
        // ⭐ Task 6：占位卡（isPlaceholder + url=''）也需要保留写回会话。
        const validImages = uploadedImages.filter(img => {
            if (img.isUploading || img.uploadFailed) return false;
            if (!img.url) return !!img.isPlaceholder;
            if (img.url.startsWith('blob:')) return false;
            return true;
        });
        
        await videoService.saveWorkspaceSession({
            task_groups: taskGroups,
            uploaded_images: validImages,
            image_prompts: imagePrompts,
            tasks_status: cleanedStatus,
            seedance_params: seedanceParamsByUuid,
            storyboard_meta: storyboardMetaByItemId,
            // 2026-05-24 — DashScope 共享 API 参数持久化
            dashscope_params: dashScopeParamsByUuid as any,
        } as any, sessionScope);
    }, [taskGroups, uploadedImages, imagePrompts, tasksStatus, sessionScope, seedanceParamsByUuid, storyboardMetaByItemId, dashScopeParamsByUuid]);

    // 始终指向最新 saveSession，供 video 完成回调等"非 deps 闭包"立即持久化时用，
    // 避免 React 闭包陈旧（直接调旧 saveSession 会漏掉刚写入的视频）。
    const saveSessionRef = useRef(saveSession);
    saveSessionRef.current = saveSession;

    useEffect(() => {
        const timer = setTimeout(() => {
            if (taskGroups.length > 0 || uploadedImages.length > 0) {
                saveSession();
            }
        }, 2000);
        return () => clearTimeout(timer);
    }, [taskGroups, uploadedImages, imagePrompts, tasksStatus, seedanceParamsByUuid, storyboardMetaByItemId, dashScopeParamsByUuid, saveSession]);
    
    // 页面切到后台时立即保存（比 beforeunload 更可靠）
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && (taskGroups.length > 0 || uploadedImages.length > 0)) {
                saveSession();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [taskGroups, uploadedImages, saveSession]);
    
    // ==================== 图片上传 ====================
    
    const handleFiles = useCallback(async (files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        
        const items = imageFiles.map(file => {
            const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const tempUrl = URL.createObjectURL(file);
            return { file, id, tempUrl };
        });

        for (const { id, tempUrl, file } of items) {
            const newImage: videoService.UploadedImage = {
                id,
                url: tempUrl,
                filename: file.name,
                uploadTime: Date.now(),
                isUploading: true
            };
            setUploadedImages(prev => [...prev, newImage]);
            setImagePrompts(prev => ({ ...prev, [id]: '' }));
            setTaskGroups(prev => [...prev, {
                uuid: videoService.generateUUID(),
                ids: [id],
                model: globalModel,
                shotType: 'multi'
            }]);
        }

        const CONCURRENCY = 3;
        const queue = [...items];
        const uploadOne = async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;
                const { file, id, tempUrl } = item;
                try {
                    const result = await videoService.uploadImage(file, {
                        onProgress: (p) => {
                            setUploadedImages(prev => prev.map(img =>
                                img.id === id ? { ...img, uploadProgress: p.percent } : img
                            ));
                        }
                    });
                    setUploadedImages(prev => prev.map(img => 
                        img.id === id ? {
                            ...img,
                            url: result.url,
                            storageUrl: result.storage_url || result.url,
                            filename: result.filename,
                            isUploading: false,
                            uploadProgress: undefined
                        } : img
                    ));
                    URL.revokeObjectURL(tempUrl);
                } catch (error: any) {
                    if (error?.name === 'AbortError') return;
                    console.error('上传失败:', error);
                    setUploadedImages(prev => prev.map(img => 
                        img.id === id ? { ...img, isUploading: false, uploadFailed: true, uploadProgress: undefined } : img
                    ));
                }
            }
        };
        await Promise.all(Array(Math.min(CONCURRENCY, items.length)).fill(null).map(() => uploadOne()));
    }, [globalModel]);

    // 2026-05-25 #5：把已有图像清空，使整卡退回为空镜（保留 group + uuid + 提示词），
    // 同时清掉 Seedance / DashScope params 里的 media_inputs，避免老图遗留。
    const clearTaskImage = useCallback((uuid: string) => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return;
        // 释放 blob: URL（若有）
        group.ids.forEach(imgId => {
            const img = uploadedImages.find(i => i.id === imgId);
            if (img?.url?.startsWith('blob:')) URL.revokeObjectURL(img.url);
        });
        setUploadedImages(prev => prev.map(img =>
            group.ids.includes(img.id)
                ? { ...img, url: '', storageUrl: undefined, filename: '', isPlaceholder: true, isUploading: false, uploadProgress: undefined, uploadFailed: false }
                : img
        ));
        // Seedance：把 media_inputs 全清，保留 prompt / sub_model
        setSeedanceParamsByUuid(prev => {
            if (!prev[uuid]) return prev;
            return { ...prev, [uuid]: { ...prev[uuid], media_inputs: [] } };
        });
        // DashScope：把 media_inputs 全清，保留 prompt / 模型偏好（含 kling_active_mode）
        setDashScopeParamsByUuid(prev => {
            if (!prev[uuid]) return prev;
            return { ...prev, [uuid]: { ...prev[uuid], media_inputs: [] } };
        });
        setTimeout(() => saveSession(), 100);
    }, [taskGroups, uploadedImages, saveSession]);

    // 2026-05-25：把空卡的 placeholder image 转正——点击上传本地文件后填 url、isPlaceholder=false
    const handlePlaceholderUpload = useCallback(async (imageId: string, file: File) => {
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件');
            return;
        }
        const tempUrl = URL.createObjectURL(file);
        setUploadedImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, url: tempUrl, filename: file.name, isPlaceholder: false, isUploading: true, uploadProgress: 0 }
                : img
        ));

        try {
            const result = await videoService.uploadImage(file, {
                onProgress: (p) => setUploadedImages(prev => prev.map(img =>
                    img.id === imageId ? { ...img, uploadProgress: p.percent } : img
                ))
            });
            setUploadedImages(prev => prev.map(img =>
                img.id === imageId
                    ? {
                        ...img,
                        url: result.url,
                        storageUrl: result.storage_url || result.url,
                        filename: result.filename,
                        isUploading: false,
                        uploadProgress: undefined,
                    }
                    : img
            ));
            URL.revokeObjectURL(tempUrl);
            setTimeout(() => saveSession(), 100);
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            console.error('占位卡上传失败:', err);
            setUploadedImages(prev => prev.map(img =>
                img.id === imageId
                    ? { ...img, isUploading: false, uploadFailed: true, uploadProgress: undefined }
                    : img
            ));
            showToast(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [saveSession, showToast]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            handleFiles(e.target.files);
        }
    };
    
    // ==================== 视频上传（抽帧） ====================
    
    const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith('video/')) {
            showToast('请选择视频文件');
            return;
        }
        
        showToast('正在从视频抽取帧...');
        
        try {
            // 创建video元素抽取第一帧
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            
            const videoUrl = URL.createObjectURL(file);
            video.src = videoUrl;
            
            await new Promise<void>((resolve, reject) => {
                video.onloadeddata = () => resolve();
                video.onerror = () => reject(new Error('视频加载失败'));
                setTimeout(() => reject(new Error('视频加载超时')), 10000);
            });
            
            video.currentTime = 0.1; // 跳到第一帧附近
            
            await new Promise<void>(resolve => {
                video.onseeked = () => resolve();
                setTimeout(resolve, 2000);
            });
            
            // 抽取帧
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法创建canvas');
            
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('转换失败')), 'image/jpeg', 0.95);
            });
            
            const imageFile = new File([blob], `frame_${Date.now()}.jpg`, { type: 'image/jpeg' });
            
            // 使用图片上传流程
            handleFiles([imageFile]);
            
            URL.revokeObjectURL(videoUrl);
            showToast('✅ 视频帧已提取并添加');
            
        } catch (error: any) {
            console.error('视频抽帧失败:', error);
            showToast('视频抽帧失败: ' + error.message);
        }
        
        // 清空input
        e.target.value = '';
    }, [handleFiles, showToast]);
    
    const handlePaste = useCallback((e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) imageFiles.push(file);
            }
        }
        if (imageFiles.length > 0) {
            handleFiles(imageFiles);
        }
    }, [handleFiles]);
    
    useEffect(() => {
        document.addEventListener('paste', handlePaste);
        return () => document.removeEventListener('paste', handlePaste);
    }, [handlePaste]);
    
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        handleFiles(files);
    }, [handleFiles]);
    
    // ==================== 任务管理 ====================
    
    const removeTask = useCallback((uuid: string) => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return;
        
        group.ids.forEach(imgId => {
            const img = uploadedImages.find(i => i.id === imgId);
            if (img?.url?.startsWith('blob:')) {
                URL.revokeObjectURL(img.url);
            }
        });
        
        setUploadedImages(prev => prev.filter(i => !group.ids.includes(i.id)));
        setImagePrompts(prev => {
            const next = { ...prev };
            group.ids.forEach(id => delete next[id]);
            return next;
        });
        setTaskGroups(prev => prev.filter(g => g.uuid !== uuid));
        setTasksStatus(prev => {
            const next = { ...prev };
            delete next[uuid];
            return next;
        });
        
        if (pollingIntervals.current[uuid]) {
            clearInterval(pollingIntervals.current[uuid]);
            delete pollingIntervals.current[uuid];
        }
        
        // 🆕 删除后立即保存会话
        setTimeout(() => saveSession(), 100);
    }, [taskGroups, uploadedImages, saveSession]);
    
    const updatePrompt = useCallback((imgId: string, value: string) => {
        setImagePrompts(prev => ({ ...prev, [imgId]: value }));
    }, []);
    
    const updateTaskModel = useCallback((uuid: string, model: videoService.VideoModel) => {
        setTaskGroups(prev => prev.map(g => g.uuid === uuid ? { ...g, model } : g));
    }, []);
    
    const linkGroups = useCallback((index: number) => {
        if (index >= taskGroups.length - 1) return;
        
        const groupA = taskGroups[index];
        const groupB = taskGroups[index + 1];
        
        if (groupA.ids.length !== 1 || groupB.ids.length !== 1) return;
        
        const newGroup: videoService.TaskGroup = {
            uuid: videoService.generateUUID(),
            ids: [groupA.ids[0], groupB.ids[0]],
            model: groupA.model
        };
        
        setTaskGroups(prev => {
            const next = [...prev];
            next.splice(index, 2, newGroup);
            return next;
        });
        
        setTasksStatus(prev => {
            const next = { ...prev };
            delete next[groupA.uuid];
            delete next[groupB.uuid];
            return next;
        });
    }, [taskGroups]);
    
    const unlinkGroup = useCallback((index: number) => {
        const group = taskGroups[index];
        if (group.ids.length !== 2) return;
        
        const newA: videoService.TaskGroup = { uuid: videoService.generateUUID(), ids: [group.ids[0]], model: group.model };
        const newB: videoService.TaskGroup = { uuid: videoService.generateUUID(), ids: [group.ids[1]], model: group.model };
        
        setTaskGroups(prev => {
            const next = [...prev];
            next.splice(index, 1, newA, newB);
            return next;
        });
        
        setTasksStatus(prev => {
            const next = { ...prev };
            if (next[group.uuid]) {
                next[newA.uuid] = { ...next[group.uuid] };
            }
            delete next[group.uuid];
            return next;
        });
    }, [taskGroups]);

    // 2026-06-05 — 合并相邻同模型卡片（Seedance / DashScope，可多次合并 + 可拆分）
    // 与 linkGroups（拼首尾帧）不同：这里是把两卡的提示词追加合并、媒体素材拼接（保留各自 role），
    // 结果写回上卡 uuid 的 params map；记录 mergedFrom 快照供 splitMergedCard 原位还原。
    const isSeedanceModel = useCallback(
        (m: videoService.VideoModel) => m === 'Seedance2' || m === 'Seedance2Fast',
        [],
    );
    const isMergeableModel = useCallback(
        (m: videoService.VideoModel) => isSeedanceModel(m) || videoService.isDashScopeVideoModel(m),
        [isSeedanceModel],
    );
    // 相邻 + 同模型 + 可合并模型，才允许把 index 与 index+1 合并
    const canMergeWithNext = useCallback((index: number): boolean => {
        if (index < 0 || index >= taskGroups.length - 1) return false;
        const a = taskGroups[index];
        const b = taskGroups[index + 1];
        return !!a && !!b && a.model === b.model && isMergeableModel(a.model);
    }, [taskGroups, isMergeableModel]);

    const mergeWithNext = useCallback((index: number) => {
        if (index < 0 || index >= taskGroups.length - 1) return;
        const A = taskGroups[index];
        const B = taskGroups[index + 1];
        if (!A || !B) return;
        if (A.model !== B.model) { showToast('只能合并相邻且模型相同的卡片'); return; }
        if (!isMergeableModel(A.model)) { showToast('仅 飞升/渡劫(Seedance) 与 合体/大乘/炼虚(Kling/Vidu/炼气) 卡片支持合并'); return; }

        const isDS = videoService.isDashScopeVideoModel(A.model);
        // 取一卡的当前有效参数快照（用于拆分还原）
        const snap = (g: videoService.TaskGroup): videoService.MergedCardSnapshot => {
            const ds = videoService.isDashScopeVideoModel(g.model);
            const seed = ds ? undefined : getSeedanceParams(g.uuid, g.model);
            const dash = ds ? getDashScopeParams(g.uuid, g.model as videoService.DashScopeVideoModel) : undefined;
            return {
                uuid: g.uuid,
                ids: [...g.ids],
                model: g.model,
                prompt: ds ? (dash?.prompt || '') : (seed?.prompt || ''),
                seedanceParams: seed,
                dashScopeParams: dash,
            };
        };
        // 若本身已是合并卡，展开其 mergedFrom，从而支持多次合并后整体拆回原始子卡
        const childrenOf = (g: videoService.TaskGroup): videoService.MergedCardSnapshot[] =>
            (g.mergedFrom && g.mergedFrom.length) ? g.mergedFrom : [snap(g)];
        const mergedFrom = [...childrenOf(A), ...childrenOf(B)];

        if (isDS) {
            const pA = getDashScopeParams(A.uuid, A.model as videoService.DashScopeVideoModel);
            const pB = getDashScopeParams(B.uuid, B.model as videoService.DashScopeVideoModel);
            const mergedPrompt = [pA.prompt, pB.prompt].filter(Boolean).join('\n');
            const mergedMedia = [...(pA.media_inputs || []), ...(pB.media_inputs || [])];
            setDashScopeParamsByUuid(prev => {
                const next = { ...prev, [A.uuid]: { ...pA, prompt: mergedPrompt, media_inputs: mergedMedia } };
                delete next[B.uuid];
                return next;
            });
        } else {
            const pA = getSeedanceParams(A.uuid, A.model);
            const pB = getSeedanceParams(B.uuid, B.model);
            const mergedPrompt = [pA.prompt, pB.prompt].filter(Boolean).join('\n');
            const mergedMedia = [...(pA.media_inputs || []), ...(pB.media_inputs || [])];
            setSeedanceParamsByUuid(prev => {
                const next = { ...prev, [A.uuid]: { ...pA, prompt: mergedPrompt, media_inputs: mergedMedia } };
                delete next[B.uuid];
                return next;
            });
        }

        setTaskGroups(prev => {
            const next = [...prev];
            const a = next[index];
            const b = next[index + 1];
            if (!a || !b || a.uuid !== A.uuid || b.uuid !== B.uuid) return prev; // stale guard
            next.splice(index, 2, { ...a, ids: [...a.ids, ...b.ids], mergedFrom });
            return next;
        });
        setTasksStatus(prev => { const n = { ...prev }; delete n[B.uuid]; return n; });
        setTimeout(() => saveSession(), 100);
    }, [taskGroups, isMergeableModel, getSeedanceParams, getDashScopeParams, showToast, saveSession]);

    const splitMergedCard = useCallback((index: number) => {
        const g = taskGroups[index];
        if (!g || !g.mergedFrom || !g.mergedFrom.length) return;
        const children = g.mergedFrom;
        const restored: videoService.TaskGroup[] = children.map(c => ({ uuid: c.uuid, ids: [...c.ids], model: c.model }));

        setSeedanceParamsByUuid(prev => {
            const next = { ...prev };
            delete next[g.uuid];
            children.forEach(c => { if (c.seedanceParams) next[c.uuid] = c.seedanceParams; });
            return next;
        });
        setDashScopeParamsByUuid(prev => {
            const next = { ...prev };
            delete next[g.uuid];
            children.forEach(c => { if (c.dashScopeParams) next[c.uuid] = c.dashScopeParams; });
            return next;
        });
        setTaskGroups(prev => {
            const next = [...prev];
            const cur = next[index];
            if (!cur || cur.uuid !== g.uuid) return prev; // stale guard
            next.splice(index, 1, ...restored);
            return next;
        });
        setTasksStatus(prev => { const n = { ...prev }; delete n[g.uuid]; return n; });
        setTimeout(() => saveSession(), 100);
    }, [taskGroups, saveSession]);

    // 2026-05-25 (Task B2)：手工在 insertIndex 位置之后插入一张空卡；insertIndex = -1 表示插到最前
    const insertEmptyTaskGroup = useCallback((insertIndex: number) => {
        const { image, group } = buildEmptyTaskGroup(globalModel);
        setUploadedImages(prev => [...prev, image]);
        setImagePrompts(prev => ({ ...prev, [image.id]: '' }));
        setTaskGroups(prev => {
            const next = [...prev];
            next.splice(insertIndex + 1, 0, group);
            return next;
        });
        // 用户手工新增的卡也写回 session
        setTimeout(() => saveSession(), 100);
    }, [globalModel, saveSession]);

    // 删除单个视频（从多视频数组中）
    const deleteVideo = useCallback((uuid: string, videoIndex: number) => {
        if (!confirm('确定要删除这个视频吗？')) return;
        
        setTasksStatus(prev => {
            const status = prev[uuid];
            if (!status || !status.videos) return prev;
            
            const newVideos = status.videos.filter((_, idx) => idx !== videoIndex);
            const newTimes = (status.videoGenerateTimes || []).filter((_, idx) => idx !== videoIndex);
            
            // 如果删完了，状态改为 idle
            if (newVideos.length === 0) {
                return {
                    ...prev,
                    [uuid]: {
                        ...status,
                        state: 'idle',
                        videos: [],
                        videoGenerateTimes: [],
                        result: ''
                    }
                };
            }
            
            return {
                ...prev,
                [uuid]: {
                    ...status,
                    videos: newVideos,
                    videoGenerateTimes: newTimes,
                    result: newVideos[newVideos.length - 1]  // 最新视频作为result
                }
            };
        });
        
        showToast('视频已删除');
        
        // 🔧 删除视频后立即保存会话
        setTimeout(() => saveSession(), 100);
    }, [showToast, saveSession]);
    
    const clearAll = useCallback(() => {
        if (!confirm('确定要清空所有任务吗？')) return;
        
        uploadedImages.forEach(img => {
            if (img.url?.startsWith('blob:')) {
                URL.revokeObjectURL(img.url);
            }
        });
        
        Object.values(pollingIntervals.current).forEach(clearInterval);
        pollingIntervals.current = {};
        
        setUploadedImages([]);
        setImagePrompts({});
        setTaskGroups([]);
        setTasksStatus({});
        setTaskStartTimes({});
        
        // 🆕 清空后立即保存会话
        setTimeout(() => saveSession(), 100);
    }, [uploadedImages, saveSession]);
    
    // ==================== 任务执行 ====================
    
    // 辅助函数：从URL提取file_id
    const extractFileId = (url: string): string | null => {
        const match = url.match(/\/api\/files\/(file_[a-f0-9]+)/);
        return match ? match[1] : null;
    };
    
    // 辅助函数：获取图片标识符（外部API使用file_id，ComfyUI使用filename）
    const getImageIdentifier = (img: videoService.UploadedImage, isExternalAPI: boolean): string => {
        if (isExternalAPI) {
            // 外部API模型（大能、Sora2、Veo、MINI）：需要file_id
            // 优先使用storageUrl中的file_id
            const storageUrl = img.storageUrl || img.url;
            const fileId = extractFileId(storageUrl);
            if (fileId) {
                console.log('🌐 外部API使用file_id:', fileId);
                return fileId;
            }
            // 回退到filename（可能不起作用，但作为最后尝试）
            console.warn('⚠️ 无法提取file_id，使用filename:', img.filename);
        }
        // ComfyUI工作流：使用filename
        return img.filename || img.url.split('/').pop() || '';
    };
    
    // uuid(任务组) → 真实 video_segments.segment_id 缓存，避免重跑任务重复建 segment 行。
    const segmentIdByGroupRef = useRef<Record<string, string>>({});

    // 取或建该任务组对应的 video_segment，返回真实 segment_id。
    // 视频完成后 worker 执行 UPDATE video_segments SET video_url WHERE segment_id=entity_id，
    // 美化页只读 video_segments.video_url —— 必须传真实 segment_id + episodeId，否则视频进不了美化。
    const ensureVideoSegmentId = useCallback(async (group: videoService.TaskGroup): Promise<string | null> => {
        if (!episodeId) return null;
        if (segmentIdByGroupRef.current[group.uuid]) return segmentIdByGroupRef.current[group.uuid];
        const sbItemId = (group.ids && group.ids[0]) || '';   // = storyboard_items.item_id
        const sortOrder = Math.max(0, taskGroups.findIndex(g => g.uuid === group.uuid));
        try {
            // 先按 storyboard_item_id 复用现有 segment，避免重复建行
            if (sbItemId) {
                const res: any = await getVideoSegments(episodeId);
                const hit = (res?.segments || []).find((s: any) => (s.storyboard_item_id ?? s.storyboardItemId) === sbItemId);
                const sid = hit?.segment_id ?? hit?.segmentId;
                if (sid) { segmentIdByGroupRef.current[group.uuid] = sid; return sid; }
            }
            const created: any = await createVideoSegment(episodeId, {
                storyboard_item_id: sbItemId || null,
                sort_order: sortOrder,
                generation_mode: 'i2v',
                model: group.model,
            });
            const sid = created?.segment?.segment_id ?? created?.segment?.segmentId;
            if (sid) { segmentIdByGroupRef.current[group.uuid] = sid; return sid; }
        } catch (e) {
            console.warn('取/建 video_segment 失败（视频仍会生成，但可能进不了美化）:', e);
        }
        return null;
    }, [episodeId, taskGroups]);

    const runTask = useCallback(async (uuid: string) => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return;

        // 提交前先拿到真实 segment_id（取或建），供下方各分支作为 entity_id 写回 video_segments。
        const segmentId = await ensureVideoSegmentId(group);
        const entityId = segmentId || uuid;  // 拿不到 episodeId 时回退 uuid（至少不报错）

        // ==================== Seedance 2.0 早期分支 ====================
        // 飞升/渡劫 走多模态面板（params.media_inputs），完全跳过 prepareImage / submitTaskQueued
        if (group.model === 'Seedance2' || group.model === 'Seedance2Fast') {
            const rawParams = getSeedanceParams(group.uuid, group.model);
            // Issue 4: in 首尾帧 mode (any image has role first_frame/last_frame),
            // the panel greys out videos/audios — strip them before submit so the
            // backend only receives first/last-frame images.
            const isFirstLastMode = rawParams.media_inputs.some(
                m => m.kind === 'image' && (m.role === 'first_frame' || m.role === 'last_frame')
            );
            const params = isFirstLastMode
                ? { ...rawParams, media_inputs: rawParams.media_inputs.filter(m => m.kind === 'image') }
                : rawParams;
            setTasksStatus(prev => {
                const oldStatus = prev[uuid] || {};
                return {
                    ...prev,
                    [uuid]: {
                        state: 'running',
                        progress: 0,
                        keepResult: true,
                        videos: oldStatus.videos || [],
                        videoGenerateTimes: oldStatus.videoGenerateTimes || [],
                        selected: oldStatus.selected,
                        isUpscaled: oldStatus.isUpscaled,
                    },
                };
            });
            setTaskStartTimes(prev => ({ ...prev, [uuid]: Date.now() }));
            try {
                console.log('Seedance 2.0 提交:', { uuid, sub_model: params.sub_model, media: params.media_inputs.length, prompt: params.prompt.substring(0, 40) });
                const result = await videoService.submitSeedanceTask(params, {
                    entity_type: 'video_segment',
                    entity_id: entityId,
                    file_role: 'video',
                    episode_id: episodeId,
                });
                console.log('Seedance 任务提交成功:', result.task_id);
                showToast('任务已提交');
                startPolling(uuid, result.task_id);
            } catch (error: any) {
                console.error('Seedance 任务提交失败:', error);
                showToast('任务提交失败: ' + error.message);
                setTasksStatus(prev => ({
                    ...prev,
                    [uuid]: { ...prev[uuid], state: 'failed', error: error.message },
                }));
            }
            return;
        }
        // ==================== DashScope 共享 API (合体/大乘/炼虚) ====================
        // 2026-05-24 — Kling/Vidu/HappyHorse 走专用多模态面板（params.media_inputs）
        if (videoService.isDashScopeVideoModel(group.model)) {
            const params = getDashScopeParams(group.uuid, group.model);
            // 校验：Vidu 不允许无图；HappyHorse 至少 1 张
            const images = (params.media_inputs || []).filter(m => m.kind === 'image');
            if (group.model === 'Vidu' && images.length === 0) {
                showToast('大乘 (Vidu) 至少需要 1 张图，参考生 或 首尾帧');
                return;
            }
            if (group.model === 'HappyHorse' && images.length === 0) {
                showToast('炼虚 (HappyHorse) 至少需要 1 张参考图');
                return;
            }
            setTasksStatus(prev => {
                const oldStatus = prev[uuid] || {};
                return {
                    ...prev,
                    [uuid]: {
                        state: 'running',
                        progress: 0,
                        keepResult: true,
                        videos: oldStatus.videos || [],
                        videoGenerateTimes: oldStatus.videoGenerateTimes || [],
                        selected: oldStatus.selected,
                        isUpscaled: oldStatus.isUpscaled,
                    },
                };
            });
            setTaskStartTimes(prev => ({ ...prev, [uuid]: Date.now() }));
            try {
                console.log('DashScope 视频任务提交:', { uuid, model: group.model, media: images.length, prompt: (params.prompt || '').substring(0, 40) });
                const result = await videoService.submitDashScopeVideoTask(params, {
                    entity_type: 'video_segment',
                    entity_id: entityId,
                    file_role: 'video',
                    episode_id: episodeId,
                });
                console.log('DashScope 任务提交成功:', result.task_id);
                showToast('任务已提交');
                startPolling(uuid, result.task_id);
            } catch (error: any) {
                console.error('DashScope 任务提交失败:', error);
                showToast('任务提交失败: ' + error.message);
                setTasksStatus(prev => ({
                    ...prev,
                    [uuid]: { ...prev[uuid], state: 'failed', error: error.message },
                }));
            }
            return;
        }

        // ==================== 其他模型保持原路径不变 ====================

        const img1 = uploadedImages.find(i => i.id === group.ids[0]);
        const img2 = group.ids.length === 2 ? uploadedImages.find(i => i.id === group.ids[1]) : null;
        
        if (!img1) {
            console.error('找不到图片');
            showToast('找不到图片，请重新上传');
            return;
        }
        
        // 判断是否为外部API模型
        const isExternalAPI = ['Sora2', 'Veo', 'MINI', '大能'].includes(group.model);
        
        console.log('📋 任务执行信息:', {
            uuid,
            model: group.model,
            isExternalAPI,
            img1: { id: img1.id, filename: img1.filename, url: img1.url?.substring(0, 80), storageUrl: img1.storageUrl?.substring(0, 80) },
            img2: img2 ? { id: img2.id, filename: img2.filename } : null
        });
        
        // 🆕 保留旧视频和时间戳，运行新任务
        setTasksStatus(prev => {
            const oldStatus = prev[uuid] || {};
            return {
                ...prev,
                [uuid]: { 
                    state: 'running', 
                    progress: 0, 
                    keepResult: true,
                    videos: oldStatus.videos || [],  // 保留旧视频
                    videoGenerateTimes: oldStatus.videoGenerateTimes || [],  // 保留旧视频时间
                    selected: oldStatus.selected,
                    isUpscaled: oldStatus.isUpscaled
                }
            };
        });
        setTaskStartTimes(prev => ({ ...prev, [uuid]: Date.now() }));
        
        try {
            // 获取正确的图片标识符
            const filename1 = getImageIdentifier(img1, isExternalAPI);
            const filename2 = img2 ? getImageIdentifier(img2, isExternalAPI) : null;
            
            const prompt = imagePrompts[group.ids[0]] || '';
            
            console.log('📤 提交任务:', { filename1, filename2, prompt: prompt.substring(0, 50), model: group.model });
            
            // 🔧 使用队列执行（ComfyUI模型会排队，外部API模型直接提交）
            const result = await videoService.submitTaskQueued(
                filename1,
                filename2,
                prompt,
                group.model,
                undefined,
                undefined,
                group.shotType || 'multi',
                {
                    entity_type: 'video_segment',
                    entity_id: entityId,
                    file_role: 'video',
                    episode_id: episodeId,
                }
            );
            
            console.log('✅ 任务提交成功:', result.task_id);
            showToast('任务已提交');
            startPolling(uuid, result.task_id);
            
        } catch (error: any) {
            console.error('任务提交失败:', error);
            showToast('任务提交失败: ' + error.message);
            setTasksStatus(prev => ({
                ...prev,
                [uuid]: { ...prev[uuid], state: 'failed', error: error.message }
            }));
        }
    }, [taskGroups, uploadedImages, imagePrompts, showToast, getSeedanceParams, getDashScopeParams, ensureVideoSegmentId, episodeId]);
    
    // 2026-05-20 (M2)：startPolling 完全交给 videoTaskPoller。
    //   - 同 uuid 重复提交安全（poller 内部去重）
    //   - 切页 unmount 不断（cleanup 仅 detach）
    //   - 状态变更通过回调写回本地 tasksStatus，与原行为一致
    // 注意：onComplete / onFail / onProgress 三个回调 closure 必须读最新业务数据，
    // 但本组件主要用 setState（已支持函数式更新）和 ref 局部数据，所以闭包不会过期。
    const buildPollCallbacks = useCallback((uuid: string) => ({
        onComplete: ({ status }: { status: videoService.VideoTask }) => {
            const token = localStorage.getItem('auth_token');
            const videos = status.result?.videos?.map(v => {
                let url = v.url.startsWith('http') ? v.url : `${window.location.origin}${v.url}`;
                if (!url.includes('token=')) {
                    url += (url.includes('?') ? '&' : '?') + `token=${token}`;
                }
                return url;
            }) || [];

            const videoTimes = status.result?.videos?.map(v => v.generateTime || 0) || [];

            setTasksStatus(prev => {
                const oldStatus = prev[uuid] || {};
                const oldVideos = oldStatus.videos || [];
                const oldTimes = oldStatus.videoGenerateTimes || [];
                const allVideos = [...oldVideos, ...videos].slice(-12);
                const allTimes = [...oldTimes, ...videoTimes].slice(-12);

                return {
                    ...prev,
                    [uuid]: {
                        ...oldStatus,
                        state: 'done',
                        progress: 100,
                        result: allVideos[allVideos.length - 1] || '',
                        videos: allVideos,
                        videoGenerateTimes: allTimes,
                        keepResult: true,
                    },
                };
            });

            // 🔒 关键：完成后立即持久化，不等 2s debounce。否则刚生成的视频在
            // 自动刷新/整页重载时（会话仍是完成前的旧快照）会丢失。用 ref 拿最新
            // saveSession（含刚写入的 videos），延后到 state 提交后再存。
            setTimeout(() => { try { saveSessionRef.current?.(); } catch {} }, 250);

            // 兼容旧 WorkspaceApp 通知系统（M5 持久化任务列表后可移除）
            if (onAddNotification) {
                onAddNotification({
                    type: 'video',
                    status: 'completed',
                    message: `视频生成完成 (${videos.length}个视频)`,
                    targetView: AppView.Video,
                    taskId: uuid,
                });
            }
        },
        onFail: (error: string) => {
            setTasksStatus(prev => ({
                ...prev,
                [uuid]: { ...prev[uuid], state: 'failed', error },
            }));
            if (onAddNotification) {
                onAddNotification({
                    type: 'video',
                    status: 'failed',
                    message: `视频生成失败: ${error}`,
                    targetView: AppView.Video,
                    taskId: uuid,
                });
            }
        },
        onProgress: (progress: number, status: 'queued' | 'running' | 'processing' | 'completed' | 'failed' | 'cancelled') => {
            setTasksStatus(prev => ({
                ...prev,
                [uuid]: {
                    ...prev[uuid],
                    state: 'processing',
                    progress,
                },
            }));
        },
    }), [onAddNotification]);

    // 2026-05-20 (M2)：mount / 重新 mount 时把全局已存活的 video poller 回调
    // 重新接到本组件 setState 上。必须放在 `buildPollCallbacks` 定义之后，
    // 否则首次 render 求值 deps 数组 `[buildPollCallbacks]` 会命中 TDZ
    // （`Cannot access 'buildPollCallbacks' before initialization`）。
    useEffect(() => {
        for (const uuid of getKnownVideoTaskIds()) {
            const ok = attachVideoPollCallbacks(uuid, buildPollCallbacks(uuid));
            if (ok) {
                const backendId = getVideoPollTaskId(uuid);
                if (backendId) {
                    setTasksStatus(prev => ({
                        ...prev,
                        [uuid]: { ...(prev[uuid] || {}), taskId: backendId, state: 'processing' },
                    }));
                }
            }
        }
    }, [buildPollCallbacks]);

    const startPolling = useCallback((uuid: string, taskId: string) => {
        // 立即保存 backend taskId 到本地 state（用于 saveSession / 恢复路径）
        setTasksStatus(prev => ({
            ...prev,
            [uuid]: {
                ...prev[uuid],
                state: 'running',
                taskId,
            },
        }));

        const projectId = (() => {
            try { return localStorage.getItem('current_project_id') || undefined; } catch { return undefined; }
        })();
        const groupRef = taskGroups.find(g => g.uuid === uuid);
        const promptText = groupRef ? (imagePrompts[groupRef.ids[0]] || '') : '';
        const titleText = groupRef
            ? `视频 · ${groupRef.model} · ${promptText.slice(0, 24) || `#${uuid.slice(0, 6)}`}`
            : `视频 · #${uuid.slice(0, 6)}`;

        startVideoPoll(uuid, {
            taskId,
            title: titleText,
            kind: groupRef?.model === 'Seedance2' ? 'seedance'
                : groupRef?.model === 'Seedance2Fast' ? 'seedance-fast'
                : groupRef?.model === 'Wan2' ? 'wan2'
                : groupRef?.model === 'Kling' ? 'kling'
                : groupRef?.model === 'Vidu' ? 'vidu'
                : groupRef?.model === 'HappyHorse' ? 'happyhorse'
                : 'video-i2v',
            targetPage: 'video',
            episodeId: sessionScope ?? null,
            projectId: projectId ?? null,
            targetEntityId: uuid,
            targetEntityType: 'video_segment',
            callbacks: buildPollCallbacks(uuid),
        });
    }, [taskGroups, imagePrompts, sessionScope, buildPollCallbacks]);
    
    const runAllSelected = useCallback(async () => {
        const selected = taskGroups.filter(g => tasksStatus[g.uuid]?.selected);
        for (const group of selected) {
            await runTask(group.uuid);
            await new Promise(r => setTimeout(r, 500));
        }
    }, [taskGroups, tasksStatus, runTask]);
    
    // 批量执行所有待处理任务
    const runAllPending = useCallback(async () => {
        const pending = taskGroups.filter(g => {
            const status = tasksStatus[g.uuid];
            return !status || status.state === 'idle' || status.state === 'failed';
        });
        
        if (pending.length === 0) {
            showToast('没有待处理的任务');
            return;
        }
        
        if (!confirm(`确定要执行 ${pending.length} 个任务吗？`)) return;
        
        showToast(`开始执行 ${pending.length} 个任务...`);
        
        for (const group of pending) {
            await runTask(group.uuid);
            await new Promise(r => setTimeout(r, 500));
        }
    }, [taskGroups, tasksStatus, runTask, showToast]);
    
    // 批量放大已完成的视频
    const batchUpscale = useCallback(async () => {
        // 优先处理选中的任务
        let toUpscale = taskGroups.filter(g => {
            const status = tasksStatus[g.uuid];
            return status?.selected && status.state === 'done' && !status.isUpscaled && status.videos && status.videos.length > 0;
        });
        
        // 如果没有选中的，处理所有已完成的
        if (toUpscale.length === 0) {
            toUpscale = taskGroups.filter(g => {
                const status = tasksStatus[g.uuid];
                return status?.state === 'done' && !status.isUpscaled && status.videos && status.videos.length > 0;
            });
        }
        
        if (toUpscale.length === 0) {
            showToast('没有可放大的视频');
            return;
        }
        
        if (!confirm(`确定要放大 ${toUpscale.length} 个视频吗？`)) return;
        
        showToast(`开始放大 ${toUpscale.length} 个视频...`);
        
        let successCount = 0;
        for (const group of toUpscale) {
            const status = tasksStatus[group.uuid];
            const videoUrl = status?.videos?.[0];
            if (!videoUrl) continue;
            
            const filename = videoUrl.split('/').pop()?.split('?')[0] || '';
            if (!filename) continue;
            
            try {
                // 🔧 使用队列执行视频放大
                await videoService.submitUpscaleTaskQueued(filename);
                setTasksStatus(prev => ({
                    ...prev,
                    [group.uuid]: { ...prev[group.uuid], isUpscaled: true }
                }));
                successCount++;
                await new Promise(r => setTimeout(r, 1000));
            } catch (error) {
                console.error('放大任务提交失败:', error);
            }
        }
        
        showToast(`✅ 已提交 ${successCount} 个放大任务`);
    }, [taskGroups, tasksStatus, showToast]);
    
    // ==================== 视频放大 ====================
    
    const openUpscaleModal = useCallback((uuid: string) => {
        const status = tasksStatus[uuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可放大的视频');
            return;
        }
        setUpscaleModalUuid(uuid);
        setSelectedVideoIndex(0);
    }, [tasksStatus, showToast]);
    
    const submitUpscale = useCallback(async () => {
        if (!upscaleModalUuid) return;
        
        const status = tasksStatus[upscaleModalUuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可放大的视频');
            return;
        }
        
        const videoUrl = status.videos[selectedVideoIndex] || status.videos[0];
        const filename = videoUrl.split('/').pop()?.split('?')[0] || '';
        
        if (!filename) {
            showToast('无法获取视频文件名');
            return;
        }
        
        setIsSubmitting(true);
        try {
            console.log('🔍 开始放大视频:', filename);
            // 🔧 使用队列执行视频放大
            const result = await videoService.submitUpscaleTaskQueued(filename);
            console.log('✅ 放大任务提交成功:', result.task_id);
            
            setTasksStatus(prev => ({
                ...prev,
                [upscaleModalUuid]: { ...prev[upscaleModalUuid], isUpscaled: true }
            }));
            
            showToast('放大任务已提交');
            setUpscaleModalUuid(null);
        } catch (error: any) {
            console.error('放大任务提交失败:', error);
            showToast('放大任务提交失败: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    }, [upscaleModalUuid, tasksStatus, selectedVideoIndex, showToast]);
    
    // ==================== 配音功能 ====================
    
    const openVoiceModal = useCallback((uuid: string) => {
        const status = tasksStatus[uuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可配音的视频');
            return;
        }
        setVoiceModalUuid(uuid);
        setSelectedVideoIndex(0);
        setVoiceAudioFile(null);
        setVoiceStartTime(0);
        setVoicePrompt('');
    }, [tasksStatus, showToast]);
    
    const handleVoiceAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setVoiceAudioFile(file);
        }
    };
    
    const submitVoice = useCallback(async () => {
        if (!voiceModalUuid || !voiceAudioFile) {
            showToast('请先上传音频文件');
            return;
        }
        
        const status = tasksStatus[voiceModalUuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可用的视频');
            return;
        }
        
        const group = taskGroups.find(g => g.uuid === voiceModalUuid);
        if (!group) return;
        
        const videoUrl = status.videos[selectedVideoIndex] || status.videos[0];
        const videoFilename = videoUrl.split('/').pop()?.split('?')[0] || '';
        const img = uploadedImages.find(i => i.id === group.ids[0]);
        const imageFilename = img?.filename || '';
        const prompt = voicePrompt || '生动的表情、自然的口型同步';
        
        setIsSubmitting(true);
        try {
            // 先上传音频
            const audioResult = await videoService.uploadAudio(voiceAudioFile, voiceStartTime, 5);
            const audioFilename = audioResult.filename;
            
            // 🔧 使用队列执行配音任务
            const result = await videoService.submitVoiceTaskQueued(
                imageFilename,
                videoFilename,
                audioFilename,
                prompt,
                group.model
            );
            
            console.log('✅ 配音任务提交成功:', result.task_id);
            showToast('配音任务已提交');
            setVoiceModalUuid(null);
        } catch (error: any) {
            console.error('配音任务提交失败:', error);
            showToast('配音任务提交失败: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    }, [voiceModalUuid, voiceAudioFile, tasksStatus, selectedVideoIndex, taskGroups, uploadedImages, voicePrompt, voiceStartTime, showToast]);
    
    // ==================== 视频编辑 ====================
    
    const openEditModal = useCallback((uuid: string) => {
        const status = tasksStatus[uuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可编辑的视频');
            return;
        }
        setEditModalUuid(uuid);
        setSelectedVideoIndex(0);
        setCropStartTime(0);
        setCropEndTime(5);
    }, [tasksStatus, showToast]);
    
    const getCurrentEditVideoUrl = () => {
        if (!editModalUuid) return '';
        const status = tasksStatus[editModalUuid];
        if (!status || !status.videos) return '';
        return status.videos[selectedVideoIndex] || status.videos[0] || '';
    };
    
    const extractCurrentFrame = useCallback(async () => {
        const videoElement = editVideoRef.current;
        if (!videoElement || !editModalUuid) {
            showToast('没有视频');
            return;
        }
        
        try {
            showToast('正在抽取帧...');
            
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法创建canvas上下文');
            
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((b) => b ? resolve(b) : reject(new Error('转换失败')), 'image/jpeg', 0.95);
            });
            
            const imageFile = new File([blob], `frame_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const imageUrl = URL.createObjectURL(imageFile);
            
            // 上传图片
            const uploadResult = await videoService.uploadImage(imageFile);
            
            setUploadedImages(prev => [...prev, {
                id,
                url: uploadResult.url,
                storageUrl: uploadResult.storage_url || uploadResult.url,
                filename: uploadResult.filename,
                uploadTime: Date.now(),
                isUploading: false
            }]);
            
            setImagePrompts(prev => ({ ...prev, [id]: `抽帧时间: ${videoElement.currentTime.toFixed(2)}s` }));
            setTaskGroups(prev => [...prev, {
                uuid: videoService.generateUUID(),
                ids: [id],
                model: globalModel,
                shotType: 'multi'
            }]);
            
            showToast('✅ 已抽取帧并添加到左侧');
            URL.revokeObjectURL(imageUrl);
        } catch (error: any) {
            console.error('抽帧失败:', error);
            showToast('抽帧失败: ' + error.message);
        }
    }, [editModalUuid, globalModel, showToast]);
    
    const submitCrop = useCallback(async () => {
        if (!editModalUuid) return;
        
        if (cropEndTime <= cropStartTime) {
            showToast('结束时间必须大于开始时间');
            return;
        }
        
        const videoUrl = getCurrentEditVideoUrl();
        if (!videoUrl) {
            showToast('无法获取视频URL');
            return;
        }
        
        const filename = videoUrl.split('/').pop()?.split('?')[0] || '';
        
        setIsSubmitting(true);
        try {
            const result = await videoService.cropVideo(filename, cropStartTime, cropEndTime);
            
            // 将裁剪后的视频添加到视频列表
            const token = localStorage.getItem('auth_token');
            let croppedUrl = result.url || `/storage/videos/${result.filename}`;
            if (!croppedUrl.startsWith('http')) {
                croppedUrl = `${window.location.origin}${croppedUrl}`;
            }
            if (!croppedUrl.includes('token=')) {
                croppedUrl += (croppedUrl.includes('?') ? '&' : '?') + `token=${token}`;
            }
            
            setTasksStatus(prev => {
                const status = prev[editModalUuid];
                if (!status) return prev;
                
                const newVideos = [...(status.videos || []), croppedUrl];
                return {
                    ...prev,
                    [editModalUuid]: { ...status, videos: newVideos }
                };
            });
            
            showToast('✅ 视频裁剪成功');
            setEditModalUuid(null);
        } catch (error: any) {
            console.error('视频裁剪失败:', error);
            showToast('视频裁剪失败: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    }, [editModalUuid, cropStartTime, cropEndTime, showToast]);
    
    const seekToTime = (seconds: number) => {
        if (editVideoRef.current) {
            editVideoRef.current.currentTime = seconds;
        }
    };
    
    const setCurrentTimeAsStart = () => {
        if (editVideoRef.current) {
            setCropStartTime(parseFloat(editVideoRef.current.currentTime.toFixed(1)));
        }
    };
    
    const setCurrentTimeAsEnd = () => {
        if (editVideoRef.current) {
            setCropEndTime(parseFloat(editVideoRef.current.currentTime.toFixed(1)));
        }
    };
    
    // ==================== 选择管理 ====================
    
    const toggleTaskSelection = useCallback((uuid: string) => {
        setTasksStatus(prev => ({
            ...prev,
            [uuid]: { ...prev[uuid], selected: !prev[uuid]?.selected }
        }));
    }, []);
    
    const selectAll = useCallback(() => {
        const allSelected = taskGroups.every(g => tasksStatus[g.uuid]?.selected);
        setTasksStatus(prev => {
            const next = { ...prev };
            taskGroups.forEach(g => {
                next[g.uuid] = { ...next[g.uuid], selected: !allSelected };
            });
            return next;
        });
    }, [taskGroups, tasksStatus]);
    
    // ==================== 计时器 ====================
    
    const getElapsedTimeStr = useCallback((uuid: string) => {
        const startTime = taskStartTimes[uuid];
        if (!startTime) return '0s';
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
    }, [taskStartTimes]);
    
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => forceUpdate(v => v + 1), 1000);
        return () => clearInterval(timer);
    }, []);
    
    // ==================== 拖拽排序 ====================
    
    const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
        setDragSrcIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    }, []);
    
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);
    
    const handleDragDrop = useCallback((e: React.DragEvent, destIndex: number) => {
        e.preventDefault();
        if (dragSrcIndex === null || dragSrcIndex === destIndex) return;
        
        setTaskGroups(prev => {
            const next = [...prev];
            const [item] = next.splice(dragSrcIndex, 1);
            next.splice(destIndex, 0, item);
            return next;
        });
        // 2026-05-20 (Bug 5)：拖拽后立即落盘，避免刷新还原 sort_order
        setTimeout(() => saveSession(), 100);
        setDragSrcIndex(null);
    }, [dragSrcIndex]);
    
    // ==================== 列表视图渲染 ====================
    
    // 右侧列表结果卡片
    const renderListResultCard = (group: videoService.TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2;
        const status = tasksStatus[group.uuid] || { state: 'idle' };
        const promptText = imagePrompts[group.ids[0]] || '';
        const videos = status.videos || [];
        
        return (
            <div
                key={group.uuid}
                className={`bg-n0 rounded-lg border px-3 flex items-center gap-3 transition-all hover:border-n40 mb-2 h-16 ${
                    status.selected ? 'border-primary ring-1 ring-primary/30' : 'border-n40'
                }`}
            >
                {/* 拖拽占位（与左侧 GripVertical w-4 对齐，2026-05-20 Bug 1） */}
                <div className="w-4 shrink-0" />
                
                {/* 序号和选择框（与左侧 w-16 对齐） */}
                <div className="flex items-center gap-2 w-16 shrink-0">
                    <input
                        type="checkbox"
                        checked={status.selected || false}
                        onChange={() => toggleTaskSelection(group.uuid)}
                        className="w-4 h-4 rounded bg-n0 border-n40 text-primary cursor-pointer"
                    />
                    <span className="text-xs font-bold text-n300">#{index + 1}</span>
                </div>
                
                {/* 视频缩略图/状态（与左侧 w-20 h-14 对齐） */}
                <div className="w-20 h-14 shrink-0 bg-n800 rounded overflow-hidden border border-n40">
                    {status.state === 'done' && videos.length > 0 ? (
                        <video 
                            src={videos[0]}
                            className="w-full h-full object-cover cursor-pointer"
                            muted
                            preload="metadata"
                            onClick={() => { setLightboxUrl(videos[0]); setLightboxType('video'); }}
                            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                            onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                        />
                    ) : status.state === 'running' || status.state === 'processing' ? (
                        <div className="w-full h-full flex items-center justify-center bg-n20">
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-n20/50">
                            <Film className="w-5 h-5 text-n100" />
                        </div>
                    )}
                </div>
                
                {/* 类型和模型（与左侧 w-24 对齐） */}
                <div className="flex flex-col gap-1 w-24 shrink-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase text-center ${
                        isPair ? 'bg-p50 text-p400' : 'bg-b50 text-b400'
                    }`}>
                        {isPair ? 'Morph' : 'I2V'}
                    </span>
                    <span className="text-[10px] text-n100 text-center truncate">
                        {videoService.getModelDisplayName(group.model)}
                    </span>
                </div>
                
                {/* 提示词（只读） */}
                <div className="flex-1 min-w-0 text-xs text-n300 truncate px-2">
                    {promptText || <span className="italic opacity-50">无描述...</span>}
                </div>
                
                {/* 状态 */}
                <div className="w-20 shrink-0 text-center">
                    {status.state === 'done' ? (
                        <span className="text-xs text-success flex items-center justify-center gap-1">
                            <Check className="w-3 h-3" /> 完成
                        </span>
                    ) : status.state === 'running' || status.state === 'processing' ? (
                        <span className="text-xs text-primary flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> {getElapsedTimeStr(group.uuid)}
                        </span>
                    ) : status.state === 'failed' ? (
                        <span className="text-xs text-danger flex items-center justify-center gap-1">
                            <AlertCircle className="w-3 h-3" /> 失败
                        </span>
                    ) : (
                        <span className="text-xs text-n100">等待</span>
                    )}
                </div>
                
                {/* 操作按钮 */}
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => runTask(group.uuid)}
                        disabled={status.state === 'running' || status.state === 'processing'}
                        className="p-1.5 bg-n0 hover:bg-primary-hover text-n700 hover:text-white rounded transition-colors disabled:opacity-50"
                        title={status.state === 'done' ? '重做' : '生成'}
                    >
                        {status.state === 'done' ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    </button>
                    
                    {status.state === 'done' && videos.length > 0 && (
                        <>
                            <button
                                onClick={() => openUpscaleModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="放大"
                            >
                                <Maximize className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openVoiceModal(group.uuid)}
                                className="p-1.5 bg-warning hover:bg-warning text-white rounded transition-colors"
                                title="配音"
                            >
                                <Mic className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openEditModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="编辑"
                            >
                                <Scissors className="w-3 h-3" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        );
    };
    
    // Issue 7: compact Seedance row used inside renderListViewCard.
    // Single line of textarea + media badges + ⚙ detail button.
    const ListSeedanceRow: React.FC<{
        group: videoService.TaskGroup;
        params: SeedanceParams;
        onChangeParams: (next: SeedanceParams) => void;
        onOpenDetail: () => void;
        isPlaceholder: boolean;
    }> = ({ group, params, onChangeParams, onOpenDetail, isPlaceholder }) => {
        return (
            <>
                <div className="flex-1 min-w-0">
                    <textarea
                        value={params.prompt}
                        onChange={(e) => onChangeParams({ ...params, prompt: e.target.value })}
                        placeholder={isPlaceholder ? '@ 选首帧...' : '描述动作、镜头...'}
                        rows={1}
                        className="w-full bg-n20 border border-n40 rounded px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none resize-none h-10 leading-tight"
                    />
                </div>
                <MediaBadges params={params} />
                <button
                    type="button"
                    onClick={onOpenDetail}
                    className="p-1 text-n300 hover:text-primary transition-colors"
                    title="完整参数 / @-mention / 模式切换"
                    aria-label={`Seedance 详情 ${group.uuid}`}
                >
                    <Settings className="w-3.5 h-3.5" />
                </button>
            </>
        );
    };

    // Issue 7 helper: SeedanceDetailModal needs candidates from current params,
    // and useSeedanceCandidates must be called from a function component (not the
    // outer VideoPage callback). Wrap it once here.
    const SeedanceDetailModalWithCandidates: React.FC<{
        title: string;
        value: SeedanceParams;
        onChange: (next: SeedanceParams) => void;
        onClose: () => void;
        storyboardItemId?: string;
    }> = ({ title, value, onChange, onClose, storyboardItemId }) => {
        const { candidates } = useSeedanceCandidates({
            currentParams: value,
            currentStoryboardItemId: storyboardItemId,
        });
        return (
            <SeedanceDetailModal
                open={true}
                title={title}
                value={value}
                onChange={onChange}
                candidates={candidates}
                onClose={onClose}
                onPreviewMedia={(url, kind) => {
                    if (kind === 'audio') { showToast('音频在浏览器新标签播放'); window.open(url, '_blank'); return; }
                    setLightboxUrl(url);
                    setLightboxType(kind === 'video' ? 'video' : 'image');
                }}
            />
        );
    };

    // 左侧列表卡片
    const renderListViewCard = (group: videoService.TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2;
        const img1 = uploadedImages.find(i => i.id === group.ids[0]);
        const img2 = isPair ? uploadedImages.find(i => i.id === group.ids[1]) : null;
        const status = tasksStatus[group.uuid] || { state: 'idle' };
        const promptText = imagePrompts[group.ids[0]] || '';
        
        if (!img1) return null;
        
        return (
            <div
                key={group.uuid}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDragDrop(e, index)}
                className={`bg-n0 rounded-lg border px-3 flex items-center gap-3 transition-all hover:border-n40 mb-2 h-16 ${
                    status.selected ? 'border-primary ring-1 ring-primary/30' : 'border-n40'
                }`}
            >
                {/* 拖拽手柄 */}
                <div className="cursor-grab active:cursor-grabbing text-n100 hover:text-n300">
                    <GripVertical className="w-4 h-4" />
                </div>
                
                {/* 序号和选择框 */}
                <div className="flex items-center gap-2 w-16 shrink-0">
                    <input
                        type="checkbox"
                        checked={status.selected || false}
                        onChange={() => toggleTaskSelection(group.uuid)}
                        className="w-4 h-4 rounded bg-n0 border-n40 text-primary cursor-pointer"
                    />
                    <span className="text-xs font-bold text-n300">#{index + 1}</span>
                </div>
                
                {/* 缩略图 */}
                <div 
                    className="w-20 h-14 shrink-0 bg-n800 rounded overflow-hidden cursor-pointer border border-n40 relative"
                    onClick={() => { if (img1.url) { setLightboxUrl(img1.url); setLightboxType('image'); } }}
                >
                    {isPair && img2 ? (
                        <div className="flex h-full">
                            <img src={img1.url} className="w-1/2 h-full object-cover" />
                            <img src={img2.url} className="w-1/2 h-full object-cover" />
                        </div>
                    ) : img1.isPlaceholder || !img1.url ? (
                        // Task 6：列表视图占位缩略图
                        <div className="w-full h-full bg-n0 border border-dashed border-n40 rounded flex items-center justify-center text-n100">
                            <ImageOff size={14} />
                        </div>
                    ) : (
                        <img src={img1.url} className="w-full h-full object-cover" />
                    )}
                    {img1.isUploading && (
                        <div className="absolute inset-0 bg-n900/60 flex flex-col items-center justify-center">
                            <div className="text-[9px] text-white mb-1">{img1.uploadProgress ?? 0}%</div>
                            <div className="w-14 h-1 bg-n0 rounded-full overflow-hidden">
                                <div className="h-full bg-primary transition-all duration-200 rounded-full" style={{ width: `${img1.uploadProgress ?? 0}%` }} />
                            </div>
                        </div>
                    )}
                    {img1.uploadFailed && (
                        <div className="absolute inset-0 bg-r50 flex items-center justify-center">
                            <span className="text-[9px] text-danger">上传失败</span>
                        </div>
                    )}
                </div>
                
                {/* 类型和模型 */}
                <div className="flex flex-col gap-1 w-24 shrink-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase text-center ${
                        isPair ? 'bg-p50 text-p400' : 'bg-b50 text-b400'
                    }`}>
                        {isPair ? 'Morph' : 'I2V'}
                    </span>
                    <select
                        value={group.model}
                        onChange={(e) => updateTaskModel(group.uuid, e.target.value as videoService.VideoModel)}
                        className="bg-n20 border border-n40 text-[10px] text-n800 rounded px-1 py-0.5 focus:outline-none focus:border-primary cursor-pointer"
                    >
                        {(videoService.SELECTABLE_MODELS.includes(group.model)
                            ? videoService.SELECTABLE_MODELS
                            : [group.model, ...videoService.SELECTABLE_MODELS]
                        ).map(m => (
                            <option key={m} value={m}>{videoService.getModelDisplayName(m)}</option>
                        ))}
                    </select>
                </div>
                
                {/* 提示词 + (Seedance only) 媒体徽章 + 详情按钮 */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                    {(group.model === 'Seedance2' || group.model === 'Seedance2Fast') ? (
                        <ListSeedanceRow
                            group={group}
                            params={getSeedanceParams(group.uuid, group.model)}
                            onChangeParams={(next) => setSeedanceParams(group.uuid, next)}
                            onOpenDetail={() => setSeedanceDetailUuid(group.uuid)}
                            isPlaceholder={!!img1.isPlaceholder}
                        />
                    ) : videoService.isDashScopeVideoModel(group.model) ? (
                        // 2026-05-24 — DashScope list 简版：prompt 直绑 params；详情请去卡片视图
                        (() => {
                            const dsParams = getDashScopeParams(group.uuid, group.model);
                            const refCount = (dsParams.media_inputs || []).filter(m => m.kind === 'image').length;
                            const subLabel = group.model === 'Kling'
                                ? (dsParams.sub_model_kling === 'omni' ? 'omni' : `${dsParams.mode || 'std'}`)
                                : group.model === 'Vidu' ? (dsParams.sub_model_vidu || 'q3')
                                : `${dsParams.resolution || '720P'} · ${dsParams.ratio || '16:9'}`;
                            return (
                                <>
                                    <span className="text-[9px] text-n300 px-1.5 py-0.5 bg-n0 rounded border border-n40 whitespace-nowrap">
                                        {subLabel} · {refCount}图
                                    </span>
                                    <textarea
                                        value={dsParams.prompt || ''}
                                        onChange={(e) => setDashScopeParams(group.uuid, { ...dsParams, prompt: e.target.value })}
                                        placeholder="描述画面/动作（详情请切到卡片视图）"
                                        className="flex-1 bg-n20 border border-n40 rounded px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none resize-none h-10"
                                    />
                                </>
                            );
                        })()
                    ) : (
                        <textarea
                            value={promptText}
                            onChange={(e) => updatePrompt(group.ids[0], e.target.value)}
                            placeholder={isPair ? '描述变化过程...' : '描述动作内容...'}
                            className="flex-1 bg-n20 border border-n40 rounded px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none resize-none h-10"
                        />
                    )}
                </div>
                
                {/* 状态 */}
                <div className="w-20 shrink-0 text-center">
                    {status.state === 'done' ? (
                        <span className="text-xs text-success flex items-center justify-center gap-1">
                            <Check className="w-3 h-3" /> 完成
                        </span>
                    ) : status.state === 'running' || status.state === 'processing' ? (
                        <span className="text-xs text-primary flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> {getElapsedTimeStr(group.uuid)}
                        </span>
                    ) : status.state === 'failed' ? (
                        <span className="text-xs text-danger flex items-center justify-center gap-1">
                            <AlertCircle className="w-3 h-3" /> 失败
                        </span>
                    ) : (
                        <span className="text-xs text-n100">等待</span>
                    )}
                </div>
                
                {/* 操作按钮 */}
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => runTask(group.uuid)}
                        disabled={status.state === 'running' || status.state === 'processing'}
                        className="p-1.5 bg-n0 hover:bg-primary-hover text-n700 hover:text-white rounded transition-colors disabled:opacity-50"
                        title={status.state === 'done' ? '重做' : '生成'}
                    >
                        {status.state === 'done' ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    </button>
                    
                    {status.state === 'done' && status.videos && status.videos.length > 0 && (
                        <>
                            <button
                                onClick={() => openUpscaleModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="放大"
                            >
                                <Maximize className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openVoiceModal(group.uuid)}
                                className="p-1.5 bg-warning hover:bg-warning text-white rounded transition-colors"
                                title="配音"
                            >
                                <Mic className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openEditModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="编辑"
                            >
                                <Scissors className="w-3 h-3" />
                            </button>
                        </>
                    )}
                    
                    {/* 2026-06-05 — 合并 / 拆分（仅 Seedance / DashScope 卡） */}
                    {group.mergedFrom && group.mergedFrom.length > 0 ? (
                        <button
                            onClick={() => splitMergedCard(index)}
                            className="p-1.5 bg-n0 hover:bg-warning text-n700 hover:text-white rounded transition-colors"
                            title={`拆分为 ${group.mergedFrom.length} 张原始卡片`}
                        >
                            <Split className="w-3 h-3" />
                        </button>
                    ) : isMergeableModel(group.model) ? (
                        <button
                            onClick={() => mergeWithNext(index)}
                            disabled={!canMergeWithNext(index)}
                            className="p-1.5 bg-n0 hover:bg-teal text-n700 hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={canMergeWithNext(index) ? '与下一张合并（提示词追加、素材合并）' : '需与下一张相邻且同模型才能合并'}
                        >
                            <Combine className="w-3 h-3" />
                        </button>
                    ) : null}

                    <button
                        onClick={() => removeTask(group.uuid)}
                        className="p-1.5 text-n100 hover:text-danger hover:bg-r50 rounded transition-colors"
                        title="删除"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>
        );
    };
    
    // ==================== 卡片视图渲染 ====================
    
    const renderStoryboardCard = (group: videoService.TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2;
        const img1 = uploadedImages.find(i => i.id === group.ids[0]);
        const img2 = isPair ? uploadedImages.find(i => i.id === group.ids[1]) : null;
        
        if (!img1) return null;
        
        // 2026-05-25：固定高度 + 左右同一函数 → 像素级对齐（见 videoCardLayout.ts）
        const isPlaceholderCard = !!img1.isPlaceholder;
        const cardHeight = getCardHeightClass(group.model, isPlaceholderCard);
        const previewHeight = isPlaceholderCard ? 'h-24 shrink-0' : getPreviewImageHeightClass(group.model, isPair);
        const seedanceCard = isSeedanceModel(group.model);
        
        return (
            <div
                key={group.uuid}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDragDrop(e, index)}
                className={`bg-n0 rounded-md border border-n40 p-4 transition-all hover:border-n40 shadow-card hover:shadow-atlas group mb-4 flex flex-col overflow-hidden ${cardHeight} ${
                    seedanceCard ? 'border-primary/40 bg-gradient-to-b from-n0 to-n20' : ''
                }`}
            >
                {/* Header */}
                <div className="flex justify-between items-center w-full mb-2 pb-2 border-b border-n40 shrink-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* 拖拽手柄 - 明确显示 */}
                        <div className="cursor-grab active:cursor-grabbing text-n100 hover:text-n300 mr-1">
                            <GripVertical className="w-4 h-4" />
                        </div>
                        {/* 2026-05-20 (Bug 2)：卡片视图也显示分镜编号，与列表视图 #N 一致；
                            对应 storyboard sort_order，没有 linkedImg 的卡退化用 index+1。 */}
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-n30 text-n700 mr-1 tabular-nums">
                            {(() => {
                                const sortOrder = img1.sortOrder;
                                return sortOrder != null ? `SB-${sortOrder + 1}` : `#${index + 1}`;
                            })()}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border mr-2 ${
                            isPair ? 'bg-p50 text-p400 border-p75' : 'bg-b50 text-b400 border-b75'
                        }`}>
                            {isPair ? 'Morph' : 'I2V'}
                        </span>
                        
                        {/* 模型选择 */}
                        <select
                            value={group.model}
                            onChange={(e) => updateTaskModel(group.uuid, e.target.value as videoService.VideoModel)}
                            className="bg-n20 border border-n40 text-[10px] text-n800 rounded px-1 py-0.5 focus:outline-none focus:border-primary cursor-pointer hover:bg-n0"
                        >
                            {videoService.ALL_MODELS.map(m => (
                                <option key={m} value={m}>{videoService.getModelDisplayName(m)}</option>
                            ))}
                        </select>
                        
                        {/* 大能模型的镜头类型 */}
                        {group.model === '大能' && (
                            <select
                                value={group.shotType || 'multi'}
                                onChange={(e) => setTaskGroups(prev => prev.map(g => 
                                    g.uuid === group.uuid ? { ...g, shotType: e.target.value as videoService.ShotType } : g
                                ))}
                                className="bg-y50 border border-warning/50 text-[10px] text-warning rounded px-1 py-0.5 focus:outline-none focus:border-warning cursor-pointer hover:bg-y75"
                            >
                                <option value="multi">智能多镜头</option>
                                <option value="single">单镜头</option>
                            </select>
                        )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {img1.uploadTime && (
                            <span className="text-[10px] text-n100 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {videoService.formatUploadTime(img1.uploadTime)}
                            </span>
                        )}
                        {isPair ? (
                            <button
                                onClick={() => unlinkGroup(index)}
                                className="text-xs text-n100 hover:text-danger p-1"
                                title="拆分"
                            >
                                <Unlink className="w-3.5 h-3.5" />
                            </button>
                        ) : (
                            <button
                                onClick={() => removeTask(group.uuid)}
                                className="text-n100 hover:text-danger p-1"
                                title="删除"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
                
                {/* 图片预览 */}
                <div className="w-full flex items-center justify-center gap-2 shrink-0 mb-1">
                    {isPair && img2 ? (
                        <>
                            <div 
                                className="flex-1 relative bg-n800 rounded-lg overflow-hidden border border-n40 cursor-zoom-in"
                                onClick={() => { setLightboxUrl(img1.url); setLightboxType('image'); }}
                            >
                                <img src={img1.url} className={`w-full ${previewHeight} object-contain bg-n900/50`} />
                                <div className="absolute bottom-0 left-0 bg-n900/60 text-white text-[10px] px-1">Start</div>
                            </div>
                            <ArrowRight className="w-4 h-4 text-n100" />
                            <div 
                                className="flex-1 relative bg-n800 rounded-lg overflow-hidden border border-n40 cursor-zoom-in"
                                onClick={() => { setLightboxUrl(img2.url); setLightboxType('image'); }}
                            >
                                <img src={img2.url} className={`w-full ${previewHeight} object-contain bg-n900/50`} />
                                <div className="absolute bottom-0 left-0 bg-n900/60 text-white text-[10px] px-1">End</div>
                            </div>
                        </>
                    ) : img1.isPlaceholder || !img1.url ? (
                        // 2026-05-25：空分镜占位卡改为可点击上传本地图片
                        <label className={`relative w-full bg-n0 border border-dashed border-n40 hover:border-primary hover:bg-primary-light rounded-lg overflow-hidden flex flex-col items-center justify-center text-n100 cursor-pointer transition-colors ${previewHeight}`}>
                            <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handlePlaceholderUpload(img1.id, file);
                                    e.target.value = '';
                                }}
                            />
                            <ImageIcon size={20} />
                            <div className="text-[10px] mt-1">点击上传图片</div>
                            <div className="text-[9px] mt-0.5 text-n100">或 @ 选首帧</div>
                        </label>
                    ) : (
                        <div 
                            className="relative w-full bg-n800 rounded-lg overflow-hidden border border-n40 cursor-zoom-in group/img"
                            onClick={() => { setLightboxUrl(img1.url); setLightboxType('image'); }}
                        >
                            <img src={img1.url} className={`w-full ${previewHeight} object-contain bg-n900/50`} />
                            {/* 2026-05-25 #5：右上角"清空图"按钮——hover 时显示，点击后整卡退回空镜 */}
                            {!img1.isUploading && (
                                <button
                                    type="button"
                                    title="清空图（恢复为空卡）"
                                    onClick={(e) => { e.stopPropagation(); clearTaskImage(group.uuid); }}
                                    className="absolute top-1 right-1 p-1 bg-n900/70 hover:bg-danger rounded text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                            {img1.isUploading && (
                                <div className="absolute inset-0 bg-n900/60 flex flex-col items-center justify-center">
                                    <div className="text-xs text-white mb-1">上传中 {img1.uploadProgress ?? 0}%</div>
                                    <div className="w-2/3 h-1.5 bg-n0 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all duration-200 rounded-full" style={{ width: `${img1.uploadProgress ?? 0}%` }} />
                                    </div>
                                </div>
                            )}
                            {img1.uploadFailed && (
                                <div className="absolute inset-0 bg-r50 flex items-center justify-center">
                                    <span className="text-xs text-danger">上传失败，点击重试</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Task 6：分镜元信息（音频徽章 + 响应式时长字段） */}
                {(() => {
                    const itemId = img1.storyboardItemId;
                    const m = itemId ? storyboardMetaByItemId[itemId] : undefined;
                    const showDuration = group.model === 'Seedance2' || group.model === 'Seedance2Fast';
                    if (!m && !showDuration) return null;
                    return (
                        <div className="flex items-center justify-between gap-2 shrink-0 mb-1">
                            <AudioBadgesRow meta={m} />
                            {showDuration && (
                                <DurationFieldForGroup
                                    group={group}
                                    meta={m}
                                    onPatchGroup={patchTaskGroup}
                                />
                            )}
                        </div>
                    );
                })()}
                
                {/* 提示词 / 参数面板 — flex-1 内部滚，长文不溢出框外 */}
                <div className={`${CARD_BODY_SCROLL_CLASS} flex flex-col`}>
                    {isPlaceholderCard ? (
                        <textarea
                            value={imagePrompts[group.ids[0]] || ''}
                            onChange={(e) => updatePrompt(group.ids[0], e.target.value)}
                            placeholder="先上传图片，再描述此分镜内容..."
                            className={PLACEHOLDER_PROMPT_TEXTAREA_CLASS}
                        />
                    ) : (group.model === 'Seedance2' || group.model === 'Seedance2Fast') ? (
                        <SeedancePanelWithCandidates
                            value={getSeedanceParams(group.uuid, group.model)}
                            onChange={(next) => setSeedanceParams(group.uuid, next)}
                            autoOpenMentionOnMount={!!img1.isPlaceholder && (getSeedanceParams(group.uuid, group.model).prompt || '').trim() === '@'}
                            storyboardItemId={getStoryboardItemId(group.uuid)}
                            onPreviewMedia={(url, kind) => {
                                if (kind === 'audio') { showToast('音频点击预览（请在浏览器新标签播放）'); window.open(url, '_blank'); return; }
                                setLightboxUrl(url);
                                setLightboxType(kind === 'video' ? 'video' : 'image');
                            }}
                        />
                    ) : videoService.isDashScopeVideoModel(group.model) ? (
                        <DashScopeCardWithCandidates
                            params={getDashScopeParams(group.uuid, group.model)}
                            onChange={(next) => setDashScopeParams(group.uuid, next)}
                            onPickImage={(cb) => openDashScopePicker(group.uuid, cb)}
                            onPreviewImage={(url) => { setLightboxUrl(url); setLightboxType('image'); }}
                            storyboardItemId={getStoryboardItemId(group.uuid)}
                            onPreviewMedia={(url, kind) => {
                                if (kind === 'audio') { showToast('音频点击预览（请在浏览器新标签播放）'); window.open(url, '_blank'); return; }
                                setLightboxUrl(url);
                                setLightboxType(kind === 'video' ? 'video' : 'image');
                            }}
                        />
                    ) : (
                        <textarea
                            value={imagePrompts[group.ids[0]] || ''}
                            onChange={(e) => updatePrompt(group.ids[0], e.target.value)}
                            placeholder={isPair ? '描述变化过程...' : '描述动作内容...'}
                            className={SIMPLE_PROMPT_TEXTAREA_CLASS}
                        />
                    )}
                </div>
            </div>
        );
    };
    
    const renderResultCard = (group: videoService.TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2;
        const status = tasksStatus[group.uuid] || { state: 'idle' };
        const promptText = imagePrompts[group.ids[0]] || '';
        
        // 2026-05-25 hotfix：空卡（左侧 storyboard 卡走 200px 紧凑模式）右侧
        // 必须同步用 200px，否则左右又错位。参考 renderStoryboardCard 同一标记。
        const img1 = uploadedImages.find(i => i.id === group.ids[0]);
        const isPlaceholderCard = !!img1?.isPlaceholder;
        const cardHeight = getCardHeightClass(group.model, isPlaceholderCard);
        const seedanceCard = isSeedanceModel(group.model);
        const resultVisualHeight = getResultVisualHeightClass(group.model);
        
        const renderStatusBadge = () => {
            if (status.state === 'running') {
                return (
                    <div className="text-xs text-primary flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {getElapsedTimeStr(group.uuid)}
                    </div>
                );
            }
            if (status.state === 'processing') {
                return (
                    <div className="text-xs text-primary flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        处理中 {status.progress || 0}%
                    </div>
                );
            }
            if (status.state === 'done') {
                return (
                    <div className="text-xs text-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        完成
                    </div>
                );
            }
            if (status.state === 'failed') {
                return (
                    <div className="text-xs text-danger flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        失败
                    </div>
                );
            }
            return <div className="text-xs text-n100">等待</div>;
        };
        
        const renderVisual = () => {
            const videos = status.videos || [];
            const videoCount = videos.length;
            const isPair = group.ids.length === 2;
            const isRunning = status.state === 'running' || status.state === 'processing';
            
            // 完成状态或运行中（显示旧视频）：显示视频
            if ((status.state === 'done' || isRunning) && videoCount > 0) {
                // 多视频网格显示（超过1个视频或运行中）
                if (videoCount > 1 || (videoCount === 1 && isRunning)) {
                    return (
                        <div className="w-full">
                            <div className="grid grid-cols-3 gap-2 max-h-[140px] overflow-y-auto shrink-0">
                                {videos.map((videoUrl, idx) => (
                                    <div 
                                        key={idx}
                                        className="relative bg-n800 rounded border border-n40 group/video overflow-hidden"
                                    >
                                        <video 
                                            src={videoUrl} 
                                            className="w-full h-full object-cover cursor-pointer"
                                            muted
                                            preload="metadata"
                                            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                                            onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                                            onClick={() => { setLightboxUrl(videoUrl); setLightboxType('video'); }}
                                        />
                                        {/* 视频编号 - 左上角 */}
                                        <span className="absolute top-1 left-1 bg-primary/90 text-white text-[10px] px-1.5 py-0.5 rounded font-bold z-10 backdrop-blur-sm">
                                            #{idx + 1}
                                        </span>
                                        {/* 生成时间 - 左下角 */}
                                        {status.videoGenerateTimes && status.videoGenerateTimes[idx] && (
                                            <span className="absolute bottom-1 left-1 bg-success/80 text-white text-[10px] px-1.5 py-0.5 rounded font-bold z-10 backdrop-blur-sm">
                                                {status.videoGenerateTimes[idx]}s
                                            </span>
                                        )}
                                        {!isRunning && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); deleteVideo(group.uuid, idx); }}
                                                className="absolute top-1 right-1 w-5 h-5 bg-danger hover:bg-danger text-white rounded-full flex items-center justify-center opacity-0 group-hover/video:opacity-100 transition-opacity z-10"
                                                title="删除此视频"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {/* 运行中时显示loading网格 */}
                                {isRunning && (
                                    <div className="bg-gradient-to-br from-n30 to-n20 rounded border border-n40 flex flex-col items-center justify-center">
                                        <div className="relative w-8 h-8 mb-2">
                                            <div className="absolute inset-0 border-2 border-t-indigo-500 border-r-indigo-500 border-b-transparent border-l-transparent rounded-full animate-spin" />
                                        </div>
                                        <div className="text-primary text-[10px] font-medium">生成中</div>
                                        <div className="text-n100 text-[9px]">{status.progress || 0}%</div>
                                    </div>
                                )}
                                {/* 显示剩余空位 */}
                                {!isRunning && videoCount < 12 && (
                                    <div className="bg-n20 rounded border border-dashed border-n40 flex items-center justify-center text-n100 text-xs">
                                        +
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }
                
                // 单视频显示（仅在不运行时）- 根据任务类型调整高度
                const videoHeight = resultVisualHeight;
                return (
                    <div 
                        className={`relative w-full bg-n800 rounded-lg overflow-hidden border border-n40 ${videoHeight} group/video`}
                    >
                        <video 
                            src={videos[0]} 
                            className="w-full h-full object-contain cursor-pointer"
                            muted
                            preload="metadata"
                            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                            onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                            onClick={() => { setLightboxUrl(videos[0]); setLightboxType('video'); }}
                        />
                        {status.videoGenerateTimes && status.videoGenerateTimes[0] && (
                            <span className="absolute top-2 right-2 bg-success/80 text-white text-[10px] px-2 py-0.5 rounded-full font-bold z-10 backdrop-blur-sm">
                                {status.videoGenerateTimes[0]}s
                            </span>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-n900/50 opacity-0 group-hover/video:opacity-100 transition-opacity pointer-events-none">
                            <Maximize2 className="w-5 h-5 text-white" />
                        </div>
                    </div>
                );
            }
            
            // 运行中状态（没有旧视频）- 根据任务类型调整高度
            if (status.state === 'running' || status.state === 'processing') {
                const loadingHeight = resultVisualHeight;
                return (
                    <div className={`w-full ${loadingHeight} rounded border border-n40 flex flex-col items-center justify-center bg-gradient-to-br from-n30 to-n20`}>
                        <div className="relative w-12 h-12 mb-2">
                            <div className="absolute inset-0 border-2 border-t-indigo-500 border-r-indigo-500 border-b-transparent border-l-transparent rounded-full animate-spin" />
                        </div>
                        <div className="text-primary text-sm font-medium">生成中...</div>
                        <div className="text-n300 text-xs">{status.progress || 0}%</div>
                    </div>
                );
            }
            
            // 空闲状态显示原图（灰度）— 与左图预览同高 h-28
            const idleImg = uploadedImages.find(i => i.id === group.ids[0]);
            const idleHeight = resultVisualHeight;
            if (isPlaceholderCard || !idleImg?.url) {
                return (
                    <div className={`w-full ${idleHeight} bg-n30 rounded border border-dashed border-n40 overflow-hidden flex flex-col items-center justify-center text-n100`}>
                        <ImageIcon size={18} />
                        <div className="text-[9px] mt-1">等待上传</div>
                    </div>
                );
            }
            return (
                <div className={`w-full ${idleHeight} bg-n800 rounded border border-n40 overflow-hidden opacity-60 grayscale`}>
                    <img src={idleImg.url} className="w-full h-full object-contain" alt="" />
                </div>
            );
        };
        
        return (
            <div
                key={group.uuid}
                className={`bg-n0 rounded-md border p-4 mb-4 shadow-card hover:shadow-atlas flex flex-col overflow-hidden ${cardHeight} ${
                    seedanceCard ? 'bg-gradient-to-b from-n0 to-n20' : ''
                } ${
                    status.selected ? 'border-primary ring-1 ring-primary/30' : (seedanceCard ? 'border-primary/40' : 'border-n40')
                }`}
            >
                {/* Header - 包含状态和操作按钮 */}
                <div className="flex justify-between items-center w-full pb-2 border-b border-n40 shrink-0">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={status.selected || false}
                            onChange={() => toggleTaskSelection(group.uuid)}
                            className="w-4 h-4 rounded bg-n0 border-n40 text-primary cursor-pointer"
                        />
                        <span className="text-xs font-bold text-n700">
                            #{index + 1} {isPair ? 'Morph' : 'I2V'}
                        </span>
                        <span className="text-[10px] px-1 rounded border border-n40 text-n300">
                            {videoService.getModelDisplayName(group.model)}
                        </span>
                        {renderStatusBadge()}
                    </div>
                    
                    {/* 操作按钮移到顶部右侧 */}
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => runTask(group.uuid)}
                            disabled={status.state === 'running' || status.state === 'processing'}
                            className="flex items-center gap-1 px-2 py-1 bg-n0 hover:bg-primary-hover text-n700 hover:text-white text-[10px] rounded transition-colors disabled:opacity-50"
                        >
                            {status.state === 'done' ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            {status.state === 'done' ? '重做' : '生成'}
                        </button>
                        
                        {/* 只要有视频就显示操作按钮，不管是否在运行中 */}
                        {status.videos && status.videos.length > 0 && (
                            <>
                                {!status.isUpscaled ? (
                                    <button
                                        onClick={() => openUpscaleModal(group.uuid)}
                                        className="flex items-center gap-1 px-2 py-1 bg-primary hover:bg-primary-hover text-white text-[10px] rounded transition-colors"
                                        title="视频放大"
                                    >
                                        <Maximize className="w-3 h-3" />
                                        放大
                                    </button>
                                ) : (
                                    <span className="flex items-center gap-1 px-2 py-1 bg-success text-white text-[10px] rounded" title="已放大">
                                        <Check className="w-3 h-3" />
                                        已放大
                                    </span>
                                )}
                                <button
                                    onClick={() => openVoiceModal(group.uuid)}
                                    className="flex items-center gap-1 px-2 py-1 bg-warning hover:bg-warning text-white text-[10px] rounded transition-colors"
                                    title="配音"
                                >
                                    <Mic className="w-3 h-3" />
                                    配音
                                </button>
                                <button
                                    onClick={() => openEditModal(group.uuid)}
                                    className="flex items-center gap-1 px-2 py-1 bg-primary hover:bg-primary-hover text-white text-[10px] rounded transition-colors"
                                    title="编辑"
                                >
                                    <Scissors className="w-3 h-3" />
                                    编辑
                                </button>
                            </>
                        )}
                    </div>
                </div>
                
                {/* 视觉内容 — 固定高度 media 区，与左侧预览对齐 */}
                <div className="shrink-0 mb-1">
                    {renderVisual()}
                </div>
                
                {/* 提示词（只读）— flex-1 内部滚，长文完整可读 */}
                <div className={`${CARD_BODY_SCROLL_CLASS} flex flex-col`}>
                    <div
                        className={RESULT_PROMPT_READONLY_CLASS}
                        title={promptText || ''}
                    >
                        {promptText || <span className="italic opacity-50">无描述...</span>}
                    </div>
                </div>
            </div>
        );
    };
    
    // ==================== 弹窗渲染 ====================
    
    const renderUpscaleModal = () => {
        if (!upscaleModalUuid) return null;
        const status = tasksStatus[upscaleModalUuid];
        const videos = status?.videos || [];
        
        return (
            <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center" onClick={() => setUpscaleModalUuid(null)}>
                <div className="bg-n0 rounded-md p-6 w-[500px] max-h-[80vh] overflow-y-auto shadow-bottom" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                            <Maximize className="w-5 h-5 text-primary" />
                            视频放大
                        </h3>
                        <button onClick={() => setUpscaleModalUuid(null)} className="text-n300 hover:text-n800">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    
                    {videos.length > 1 && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">选择要放大的视频</label>
                            <select
                                value={selectedVideoIndex}
                                onChange={(e) => setSelectedVideoIndex(parseInt(e.target.value))}
                                className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                            >
                                {videos.map((_, idx) => (
                                    <option key={idx} value={idx}>视频 #{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    
                    <div className="mb-4">
                        <video 
                            src={videos[selectedVideoIndex]}
                            className="w-full rounded border border-n40"
                            controls
                        />
                    </div>
                    
                    <div className="text-sm text-n300 mb-4 p-3 bg-n20/50 rounded">
                        <p>放大后的视频将提升至2倍分辨率，处理时间约5-10分钟。</p>
                    </div>
                    
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setUpscaleModalUuid(null)}
                            className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded"
                        >
                            取消
                        </button>
                        <button
                            onClick={submitUpscale}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            开始放大
                        </button>
                    </div>
                </div>
            </div>
        );
    };
    
    const renderVoiceModal = () => {
        if (!voiceModalUuid) return null;
        const status = tasksStatus[voiceModalUuid];
        const videos = status?.videos || [];
        
        return (
            <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center" onClick={() => setVoiceModalUuid(null)}>
                <div className="bg-n0 rounded-md p-6 w-[600px] max-h-[90vh] overflow-y-auto shadow-bottom" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                            <Mic className="w-5 h-5 text-warning" />
                            视频配音
                        </h3>
                        <button onClick={() => setVoiceModalUuid(null)} className="text-n300 hover:text-n800">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    
                    {videos.length > 1 && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">选择视频</label>
                            <select
                                value={selectedVideoIndex}
                                onChange={(e) => setSelectedVideoIndex(parseInt(e.target.value))}
                                className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                            >
                                {videos.map((_, idx) => (
                                    <option key={idx} value={idx}>视频 #{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    
                    <div className="mb-4">
                        <label className="text-sm text-n300 mb-2 block">上传音频文件</label>
                        <div 
                            className="border-2 border-dashed border-n40 rounded-lg p-4 text-center hover:border-warning transition-colors cursor-pointer"
                            onClick={() => audioInputRef.current?.click()}
                        >
                            <input
                                ref={audioInputRef}
                                type="file"
                                accept="audio/*"
                                onChange={handleVoiceAudioUpload}
                                className="hidden"
                            />
                            {voiceAudioFile ? (
                                <div className="flex items-center justify-center gap-2 text-warning">
                                    <Music className="w-5 h-5" />
                                    <span>{voiceAudioFile.name}</span>
                                </div>
                            ) : (
                                <div className="text-n100">
                                    <Upload className="w-8 h-8 mx-auto mb-2" />
                                    <p>点击或拖拽上传音频文件</p>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {voiceAudioFile && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">音频裁剪（取5秒）</label>
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <label className="text-xs text-n100">起始时间(秒)</label>
                                    <input
                                        type="number"
                                        value={voiceStartTime}
                                        onChange={(e) => setVoiceStartTime(parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={0.1}
                                        className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs text-n100">结束时间(秒)</label>
                                    <input
                                        type="number"
                                        value={voiceStartTime + 5}
                                        disabled
                                        className="w-full bg-n20 border border-n40 text-n100 rounded px-3 py-2"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div className="mb-4">
                        <label className="text-sm text-n300 mb-2 block">配音提示词（可选）</label>
                        <textarea
                            value={voicePrompt}
                            onChange={(e) => setVoicePrompt(e.target.value)}
                            placeholder="例如：生动的表情、自然的口型同步"
                            className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2 h-20 resize-none"
                        />
                    </div>
                    
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setVoiceModalUuid(null)}
                            className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded"
                        >
                            取消
                        </button>
                        <button
                            onClick={submitVoice}
                            disabled={isSubmitting || !voiceAudioFile}
                            className="px-4 py-2 bg-warning hover:bg-warning text-white rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            开始配音
                        </button>
                    </div>
                </div>
            </div>
        );
    };
    
    const renderEditModal = () => {
        if (!editModalUuid) return null;
        const status = tasksStatus[editModalUuid];
        const videos = status?.videos || [];
        const currentVideoUrl = videos[selectedVideoIndex] || videos[0] || '';
        
        return (
            <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center" onClick={() => setEditModalUuid(null)}>
                <div className="bg-n0 rounded-md p-6 w-[700px] max-h-[90vh] overflow-y-auto shadow-bottom" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                            <Scissors className="w-5 h-5 text-primary" />
                            视频编辑
                        </h3>
                        <button onClick={() => setEditModalUuid(null)} className="text-n300 hover:text-n800">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    
                    {videos.length > 1 && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">选择视频</label>
                            <select
                                value={selectedVideoIndex}
                                onChange={(e) => setSelectedVideoIndex(parseInt(e.target.value))}
                                className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                            >
                                {videos.map((_, idx) => (
                                    <option key={idx} value={idx}>视频 #{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    
                    <div className="mb-4">
                        <video 
                            ref={editVideoRef}
                            src={currentVideoUrl}
                            className="w-full rounded border border-n40"
                            controls
                        />
                    </div>
                    
                    {/* 时间裁剪控制 */}
                    <div className="mb-4 p-4 bg-n20/50 rounded-lg">
                        <h4 className="text-sm font-medium text-n800 mb-3">视频裁剪</h4>
                        <div className="grid grid-cols-2 gap-4 mb-3">
                            <div>
                                <label className="text-xs text-n100 block mb-1">开始时间(秒)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={cropStartTime}
                                        onChange={(e) => setCropStartTime(parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={0.1}
                                        className="flex-1 bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                                    />
                                    <button
                                        onClick={setCurrentTimeAsStart}
                                        className="px-3 py-2 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                                    >
                                        当前
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-n100 block mb-1">结束时间(秒)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={cropEndTime}
                                        onChange={(e) => setCropEndTime(parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={0.1}
                                        className="flex-1 bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                                    />
                                    <button
                                        onClick={setCurrentTimeAsEnd}
                                        className="px-3 py-2 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                                    >
                                        当前
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => seekToTime(cropStartTime)}
                                className="flex-1 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                            >
                                跳到开始
                            </button>
                            <button
                                onClick={() => seekToTime(cropEndTime)}
                                className="flex-1 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                            >
                                跳到结束
                            </button>
                        </div>
                    </div>
                    
                    {/* 抽帧功能 */}
                    <div className="mb-4 p-4 bg-n20/50 rounded-lg">
                        <h4 className="text-sm font-medium text-n800 mb-3">抽取帧</h4>
                        <button
                            onClick={extractCurrentFrame}
                            className="w-full px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded flex items-center justify-center gap-2"
                        >
                            <ImageIcon className="w-4 h-4" />
                            抽取当前帧为图片
                        </button>
                        <p className="text-xs text-n100 mt-2">抽取的图片将添加到左侧分镜板</p>
                    </div>
                    
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setEditModalUuid(null)}
                            className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded"
                        >
                            取消
                        </button>
                        <button
                            onClick={submitCrop}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            裁剪视频
                        </button>
                    </div>
                </div>
            </div>
        );
    };
    
    // ==================== 主渲染 ====================
    
    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-n20">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-n300">加载工作区...</p>
                </div>
            </div>
        );
    }
    
    return (
        <div className="flex-1 flex flex-col bg-n20 text-n800 overflow-hidden">
            {/* Toast消息 */}
            {toast && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-n0 border border-n40 text-n800 rounded-lg shadow-bottom">
                    {toast}
                </div>
            )}
            
            {/* 工具栏 - 固定52px高度 */}
            <div className="h-[52px] flex-shrink-0 px-4 border-b border-n40 bg-n30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {/* 上传按钮组 */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold transition-colors"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        批量上传
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFileInput}
                        className="hidden"
                    />
                    
                    <button
                        onClick={() => videoInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold transition-colors"
                    >
                        <Video className="w-3.5 h-3.5" />
                        上传视频
                    </button>
                    <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/*"
                        onChange={handleVideoUpload}
                        className="hidden"
                    />
                    
                    {/* 视图切换 */}
                    <div className="h-6 w-px bg-n40 mx-1" />
                    
                    <div className="flex items-center bg-n0 rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('card')}
                            className={`p-1.5 rounded ${viewMode === 'card' ? 'bg-primary text-white' : 'text-n300'}`}
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-primary text-white' : 'text-n300'}`}
                        >
                            <List className="w-4 h-4" />
                        </button>
                    </div>
                    
                    <span className="text-xs text-n300">
                        {taskGroups.length} 任务
                    </span>

                    {/* Task 6：同步分镜按钮（仅当上层下传了 storyboardItems 时可见） */}
                    {storyboardItems.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setSyncModalOpen(true)}
                            title="比对当前 storyboard 与工作区，按需同步"
                            className="ml-2 p-1 text-n700 hover:text-n800"
                        >
                            <RotateCw size={14} />
                        </button>
                    )}
                </div>
                
                <div className="flex items-center gap-2">
                    {/* 选择和批量操作 */}
                    <button
                        onClick={selectAll}
                        className="flex items-center gap-1 text-xs text-n300 hover:text-n800"
                    >
                        {taskGroups.every(g => tasksStatus[g.uuid]?.selected) ? (
                            <CheckSquare className="w-3.5 h-3.5" />
                        ) : (
                            <Square className="w-3.5 h-3.5" />
                        )}
                        全选
                    </button>
                    
                    <div className="h-5 w-px bg-n40 mx-1"></div>
                    
                    <button
                        onClick={batchUpscale}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs font-bold rounded transition-colors"
                    >
                        <Maximize className="w-3.5 h-3.5" />
                        批量放大
                    </button>
                    
                    <button
                        onClick={runAllSelected}
                        disabled={!taskGroups.some(g => tasksStatus[g.uuid]?.selected)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 text-xs font-bold rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Play className="w-3.5 h-3.5" />
                        执行选中
                    </button>
                    
                    <button
                        onClick={runAllPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-success hover:bg-success text-white text-xs font-bold rounded shadow-sm transition-colors"
                    >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        批量执行
                    </button>
                    
                    <button
                        onClick={clearAll}
                        className="flex items-center gap-1 px-3 py-1.5 text-danger hover:text-danger hover:bg-r50 rounded text-xs transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        清空
                    </button>
                </div>
            </div>
            
            {/* 主内容区 */}
            {viewMode === 'list' ? (
                /* 列表视图 - 双栏 */
                <div 
                    className="flex-1 flex overflow-hidden"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                >
                    {/* 左侧列表 - 隐藏滚动条 */}
                    <div 
                        ref={leftPanelRef}
                        className="w-1/2 p-4 overflow-y-auto border-r border-n40 scrollbar-hide"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
                                <p className="text-sm">拖拽图片或 Ctrl+V 粘贴</p>
                            </div>
                        ) : (
                            sortedTaskGroups.map(({ group, originalIndex }) => renderListViewCard(group, originalIndex))
                        )}
                    </div>
                    {/* 右侧列表 - 显示滚动条 */}
                    <div 
                        ref={rightPanelRef}
                        className="w-1/2 p-4 overflow-y-auto scrollbar-thin"
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <Film className="w-12 h-12 mb-4 opacity-20" />
                                <p className="text-sm">等待任务配置...</p>
                            </div>
                        ) : (
                            sortedTaskGroups.map(({ group, originalIndex }) => renderListResultCard(group, originalIndex))
                        )}
                    </div>
                </div>
            ) : (
                /* 卡片视图 - 双栏同步滚动 */
                <div 
                    className="flex-1 flex overflow-hidden"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                >
                    {/* 左侧：分镜板 - 隐藏滚动条 */}
                    <div 
                        ref={leftPanelRef}
                        className="w-1/2 p-4 overflow-y-auto border-r border-n40 scrollbar-hide"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
                                <p className="text-sm">拖拽图片或 Ctrl+V 粘贴</p>
                            </div>
                        ) : (
                            <>
                                {/* 2026-05-25 (Task B2)：最顶部"+ 插入空卡"按钮（insertIndex = -1 = 插到列表最前） */}
                                <InsertEmptyCardButton onClick={() => insertEmptyTaskGroup(-1)} />

                                {sortedTaskGroups.map(({ group, originalIndex }, displayIndex) => (
                                    <React.Fragment key={group.uuid}>
                                        {renderStoryboardCard(group, originalIndex)}
                                        
                                        {/* 链接按钮 - 使用原始索引查找下一个任务 */}
                                        {originalIndex < taskGroups.length - 1 && 
                                         group.ids?.length === 1 && 
                                         taskGroups[originalIndex + 1]?.ids?.length === 1 && (
                                            // 2026-05-19 (Task C): match right-side placeholder geometry EXACTLY
                                            // (h-[18px] -mt-3 mb-2). Button absolute, not in flow → per-row delta = 0.
                                            <div className="h-[18px] -mt-3 mb-2 relative pointer-events-none">
                                                <button
                                                    onClick={() => linkGroups(originalIndex)}
                                                    className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-n0 hover:bg-primary-hover text-n300 hover:text-white border border-n40 hover:border-primary rounded-full p-1 transition-all shadow-lg hover:scale-110 z-10"
                                                    title="合并为首尾帧任务"
                                                >
                                                    <Link className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}

                                        {/* 2026-05-25 (Task B2)：每张卡之后的"+ 插入空卡"按钮 */}
                                        <InsertEmptyCardButton onClick={() => insertEmptyTaskGroup(originalIndex)} />
                                    </React.Fragment>
                                ))}
                            </>
                        )}
                    </div>
                    
                    {/* 右侧：结果队列 - 显示滚动条 */}
                    <div 
                        ref={rightPanelRef}
                        className="w-1/2 p-4 overflow-y-auto scrollbar-thin"
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <Film className="w-12 h-12 mb-4 opacity-20" />
                                <p className="text-sm">等待任务配置...</p>
                            </div>
                        ) : (
                            <>
                                {/* 2026-05-25 hotfix：与左侧顶部 InsertEmptyCardButton 对齐的占位 spacer */}
                                <InsertEmptyCardSpacer />

                                {sortedTaskGroups.map(({ group, originalIndex }, displayIndex) => (
                                    <React.Fragment key={group.uuid}>
                                        {renderResultCard(group, originalIndex)}
                                        
                                        {/* 与左侧链接按钮对齐的占位符 */}
                                        {originalIndex < taskGroups.length - 1 && 
                                         group.ids?.length === 1 && 
                                         taskGroups[originalIndex + 1]?.ids?.length === 1 && (
                                            <div className="h-[18px] -mt-3 mb-2" />
                                        )}

                                        {/* 2026-05-25 hotfix：与左侧每张卡之后的 InsertEmptyCardButton 对齐的 spacer */}
                                        <InsertEmptyCardSpacer />
                                    </React.Fragment>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            )}
            
            {/* 2026-05-24 — DashScope 图片选择器（合体/大乘/炼虚 添加首尾帧 / 参考图）
                2026-05-25 #4 — 新增本地上传按钮：与 Seedance 选素材 UX 对齐 */}
            {dashScopePicker && (
                <div
                    className="fixed inset-0 z-50 bg-n900/85 flex items-center justify-center p-4"
                    onClick={() => setDashScopePicker(null)}
                >
                    <div
                        className="bg-n20 border border-n40 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-y-auto p-4 shadow-bottom"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-n700">选择 / 替换图片</h3>
                            <div className="flex items-center gap-2">
                                <label className="px-2 py-1 bg-primary hover:bg-primary-hover text-white text-[11px] rounded cursor-pointer inline-flex items-center gap-1">
                                    <Upload className="w-3 h-3" /> 上传新图
                                    <input
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            e.target.value = '';
                                            if (!file) return;
                                            try {
                                                const r = await videoService.uploadImage(file);
                                                const url = r.url || (r as any).storage_url || '';
                                                // 立即派发给卡片
                                                dashScopePicker.callback({
                                                    kind: 'image',
                                                    url,
                                                    file_id: (r as any).file_id || r.filename || file.name,
                                                });
                                                setDashScopePicker(null);
                                            } catch (err: any) {
                                                showToast(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
                                            }
                                        }}
                                    />
                                </label>
                                <button
                                    className="text-n300 hover:text-n800"
                                    onClick={() => setDashScopePicker(null)}
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <p className="text-[11px] text-n100 mb-3">
                            从已上传的素材中选一张，或点击右上角"上传新图"上传本地文件后立即替换。
                        </p>
                        {(() => {
                            const candidates = uploadedImages.filter(img => img.url && !img.isPlaceholder);
                            if (candidates.length === 0) {
                                return (
                                    <div className="text-center text-n100 py-12 text-sm">
                                        当前会话还没有可选的图片，请点击"上传新图"或从分镜导入。
                                    </div>
                                );
                            }
                            return (
                                <div className="grid grid-cols-4 gap-2">
                                    {candidates.map((img) => (
                                        <button
                                            key={img.id}
                                            type="button"
                                            onClick={() => {
                                                dashScopePicker.callback({
                                                    kind: 'image',
                                                    url: img.url,
                                                    file_id: img.id,
                                                });
                                                setDashScopePicker(null);
                                            }}
                                            className="relative aspect-video rounded border border-n40 hover:border-primary overflow-hidden bg-n800"
                                        >
                                            <img src={img.url} className="w-full h-full object-cover" />
                                            <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-n900/60 text-[9px] text-n700 truncate">
                                                {img.filename || img.id}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Lightbox */}
            {lightboxUrl && (
                <div 
                    className="fixed inset-0 z-50 bg-n900/90 flex items-center justify-center"
                    onClick={() => setLightboxUrl(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white hover:text-n300"
                        onClick={() => setLightboxUrl(null)}
                    >
                        <X className="w-8 h-8" />
                    </button>
                    <a
                        href={lightboxUrl}
                        download
                        className="absolute top-4 right-16 text-white hover:text-n300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Download className="w-8 h-8" />
                    </a>
                    {lightboxType === 'video' ? (
                        <video
                            src={lightboxUrl}
                            className="max-w-[90vw] max-h-[90vh]"
                            controls
                            autoPlay
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <img
                            src={lightboxUrl}
                            className="max-w-[90vw] max-h-[90vh] object-contain"
                            onClick={(e) => e.stopPropagation()}
                        />
                    )}
                </div>
            )}
            
            {/* 功能弹窗 */}
            {renderUpscaleModal()}
            {renderVoiceModal()}
            {renderEditModal()}

            {/* Task 6：同步分镜弹窗 */}
            <StoryboardSyncModal
                open={syncModalOpen}
                onClose={() => setSyncModalOpen(false)}
                storyboardItems={storyboardItems}
                session={{
                    uploaded_images: uploadedImages,
                    task_groups: taskGroups,
                    image_prompts: imagePrompts,
                    tasks_status: tasksStatus,
                    seedance_params: seedanceParamsByUuid,
                    storyboard_meta: storyboardMetaByItemId,
                }}
                onApply={async (mode: SyncMode) => {
                    try {
                        const r = await applySyncStrategy(
                            mode,
                            storyboardItems,
                            {
                                uploaded_images: uploadedImages,
                                task_groups: taskGroups,
                                image_prompts: imagePrompts,
                                tasks_status: tasksStatus,
                                seedance_params: seedanceParamsByUuid,
                                storyboard_meta: storyboardMetaByItemId,
                            },
                            sessionScope,
                        );
                        if (r.shouldReimport && onRequestReimport) {
                            await onRequestReimport();
                        } else {
                            // 重新拉取最新会话以反映 patch 后的状态
                            await loadSession();
                        }
                    } catch (e) {
                        console.error('[VideoPage] applySyncStrategy 失败:', e);
                    } finally {
                        setSyncModalOpen(false);
                    }
                }}
            />

            {/* Issue 7: list-view ⚙ Seedance detail modal */}
            {seedanceDetailUuid && (() => {
                const g = taskGroups.find(x => x.uuid === seedanceDetailUuid);
                if (!g || (g.model !== 'Seedance2' && g.model !== 'Seedance2Fast')) return null;
                const params = getSeedanceParams(g.uuid, g.model);
                return (
                    <SeedanceDetailModalWithCandidates
                        title={`#${(taskGroups.findIndex(x => x.uuid === g.uuid) + 1)}`}
                        value={params}
                        storyboardItemId={getStoryboardItemId(g.uuid)}
                        onChange={(next) => setSeedanceParams(g.uuid, next)}
                        onClose={() => setSeedanceDetailUuid(null)}
                    />
                );
            })()}
        </div>
    );
};

export default VideoPage;
