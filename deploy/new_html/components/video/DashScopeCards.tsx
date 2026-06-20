// new_html/components/video/DashScopeCards.tsx
// =============================================================================
// 2026-05-24 — DashScope 共享 API 三家视频模型的卡片组件
//
//  - <DashScopeVideoCard>      按 model 字段派发到下面三个具体卡片
//  - <KlingCard>               合体（蓝调 · 科技感）  kling-v3 / kling-v3-omni
//  - <ViduCard>                大乘（紫调 · 抽象感）  viduq3-* / viduq2-*
//  - <HappyHorseCard>          炼虚（橙调 · 奋放感）  happyhorse-1.0-r2v
//
// 共享：
//  - DashScopeCardShell        卡片视觉外壳（色彩主题、徽章、标题、底部按钮区）
//  - ImageSlot                 单图槽（点击上传/点击放大/已用 file_id 显示文件名）
//  - MediaModeToggle           首尾帧 / 多参考 切换（复用 Seedance mode 范式）
//  - useDashScopeMediaHelpers  抽出 first/last/reference 媒体
//
// 跟 VideoPage 的对接由 `params: DashScopeVideoParams + onChange` 完成；
// 卡片不直接发起任务，调用方在 runTask 里调用 submitDashScopeVideoTask。
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    ImagePlus, X, Wand2, Layers, Sparkles, Move, RotateCcw,
    Film, Play, Volume2, Hash, Maximize2, Image as ImageIcon,
} from 'lucide-react';
import type {
    DashScopeVideoParams, DashScopeVideoModel,
    SeedanceMediaInput, KlingMode, KlingSubModel,
    ViduSubModel, DashScopeResolution, DashScopeAspectRatio, HappyHorseRatio,
    ViduResolution, HhResolution, HhRatio,
} from '../../services/videoService';
import { secureApiUrl } from '../../services/httpClient';

// ─── 主题色板（对应修真境界视觉气质） ─────────────────────────────────────────

type Theme = {
    name: '合体' | '大乘' | '炼虚';
    accent: string;         // 主色 hex（按钮/边框 hover）
    accentText: string;     // 主色文字 tailwind class
    accentBorder: string;   // 主色边框 tailwind class
    accentBg: string;       // 主色背景（弱）tailwind class
    accentBgStrong: string; // 主色背景（强）tailwind class
    gradient: string;       // 头部渐变 tailwind class
    badge: string;          // 模型徽章 tailwind class
};

const THEMES: Record<DashScopeVideoModel, Theme> = {
    Kling: {
        name: '合体',
        accent: '#0ea5e9',
        accentText: 'text-sky-300',
        accentBorder: 'border-sky-500/40',
        accentBg: 'bg-sky-500/10',
        accentBgStrong: 'bg-sky-600 hover:bg-sky-500',
        gradient: 'from-sky-500/15 via-blue-500/10 to-cyan-400/15',
        badge: 'bg-sky-500/20 text-sky-200 border-sky-500/30',
    },
    Vidu: {
        name: '大乘',
        accent: '#a855f7',
        accentText: 'text-purple-300',
        accentBorder: 'border-purple-500/40',
        accentBg: 'bg-purple-500/10',
        accentBgStrong: 'bg-purple-600 hover:bg-purple-500',
        gradient: 'from-purple-500/15 via-fuchsia-500/10 to-violet-400/15',
        badge: 'bg-purple-500/20 text-purple-200 border-purple-500/30',
    },
    HappyHorse: {
        name: '炼虚',
        accent: '#f97316',
        accentText: 'text-orange-300',
        accentBorder: 'border-orange-500/40',
        accentBg: 'bg-orange-500/10',
        accentBgStrong: 'bg-orange-600 hover:bg-orange-500',
        gradient: 'from-orange-500/15 via-amber-500/10 to-rose-400/15',
        badge: 'bg-orange-500/20 text-orange-200 border-orange-500/30',
    },
};

// ─── 共享外壳 ─────────────────────────────────────────────────────────────────

interface ShellProps {
    theme: Theme;
    subtitle: string;
    children: React.ReactNode;
}

// 2026-05-24：从固定 h-[400px] overflow-hidden 改为 flex flex-col flex-1 min-h-0
// 配合 VideoPage 的 'min-h-[420px] h-full flex flex-col' 卡片外壳，让 Shell 撑满；
// 主体内容区自己负责滚动，避免整张卡撑出滚动条破坏 grid stretch。
const DashScopeCardShell: React.FC<ShellProps> = ({ theme, subtitle, children }) => (
    <div className={`w-full rounded-md border ${theme.accentBorder} bg-n0 shadow-card flex flex-col flex-1 min-h-0`}>
        <div className={`px-2.5 py-1.5 bg-gradient-to-r ${theme.gradient} flex items-center justify-between border-b border-n40 rounded-t-md shrink-0`}>
            <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border ${theme.badge}`}>
                    {theme.name}
                </span>
                <span className="text-[10px] text-n300">{subtitle}</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-n100">
                <Sparkles className="w-2.5 h-2.5" /> DashScope
            </div>
        </div>
        {/* 主体内容：可滚动；padding 略大让信息呼吸 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
            {children}
        </div>
    </div>
);

// ─── 共享小组件 ────────────────────────────────────────────────────────────────

interface ImageSlotProps {
    media?: SeedanceMediaInput;
    placeholder: string;
    accentBorder: string;
    accentBg: string;
    onUploadClick: () => void;
    onClear?: () => void;
    onPreview?: (url: string) => void;
}

const ImageSlot: React.FC<ImageSlotProps> = ({
    media, placeholder, accentBorder, accentBg,
    onUploadClick, onClear, onPreview,
}) => {
    const hasImage = !!media && (media.url || media.file_id);
    // 2026-05-25 #3: previewUrl 之前只接受 http/data:，
    // 导致上传后端返回的相对路径 (/api/file/...) 或 blob: URL 都没有缩略图。
    // 放宽到接受任意非空 url（<img src> 会自行处理相对路径）。
    const previewUrl = media?.url || '';

    if (!hasImage) {
        return (
            <button
                type="button"
                onClick={onUploadClick}
                className={`relative aspect-video w-full rounded border border-dashed ${accentBorder} ${accentBg} hover:opacity-90 transition-opacity flex flex-col items-center justify-center text-n300`}
            >
                <ImagePlus className="w-5 h-5 mb-1" />
                <span className="text-[10px]">{placeholder}</span>
            </button>
        );
    }
    return (
        <div className={`relative aspect-video w-full rounded border ${accentBorder} overflow-hidden bg-black group`}>
            {previewUrl ? (
                <img
                    src={previewUrl}
                    className="w-full h-full object-contain cursor-zoom-in"
                    onClick={() => onPreview?.(previewUrl)}
                />
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-n100 text-[10px] px-2">
                    <ImageIcon className="w-5 h-5 mb-1" />
                    <span className="truncate w-full text-center">{media?.file_id || '已选'}</span>
                </div>
            )}
            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {previewUrl && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onPreview?.(previewUrl); }}
                        className="p-1 bg-n900/50 hover:bg-n900/50 rounded"
                        title="放大"
                    >
                        <Maximize2 className="w-2.5 h-2.5 text-white" />
                    </button>
                )}
                {onClear && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onClear(); }}
                        className="p-1 bg-n900/50 hover:bg-danger rounded"
                        title="移除"
                    >
                        <X className="w-2.5 h-2.5 text-white" />
                    </button>
                )}
            </div>
        </div>
    );
};

// 2026-05-25 — Task A3：紧凑图槽（w-20 h-14 缩略图 + 文字按钮），用于单图/双图模式
// 替代原 aspect-video 全宽槽（卡宽 280 → 158px 高），节省 ~100px 垂直空间；
// ImageSlot 保留给 ViduCard 'startend' 等仍需大槽的场景。
interface CompactImageSlotProps {
    media?: SeedanceMediaInput;
    label: string;
    accentBorder: string;
    accentBg: string;
    onUploadClick: () => void;
    onClear?: () => void;
    onPreview?: (url: string) => void;
}

const CompactImageSlot: React.FC<CompactImageSlotProps> = ({
    media, label, accentBorder, accentBg,
    onUploadClick, onClear, onPreview,
}) => {
    const hasImage = !!media && (media.url || media.file_id);
    // 2026-05-25 #3: previewUrl 之前只接受 http/data:，
    // 导致上传后端返回的相对路径 (/api/file/...) 或 blob: URL 都没有缩略图。
    // 放宽到接受任意非空 url（<img src> 会自行处理相对路径）。
    const previewUrl = media?.url || '';
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-n300 shrink-0 w-10">{label}</span>
            {hasImage ? (
                <div className={`relative w-20 h-14 shrink-0 rounded border ${accentBorder} overflow-hidden bg-black group`}>
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => onPreview?.(previewUrl)}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-n100 px-1 truncate">
                            {media?.file_id || '已选'}
                        </div>
                    )}
                    {onClear && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onClear(); }}
                            className="absolute top-0 right-0 p-0.5 bg-n900/50 hover:bg-danger opacity-0 group-hover:opacity-100 transition-opacity"
                            title="移除"
                        >
                            <X className="w-2.5 h-2.5 text-white" />
                        </button>
                    )}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={onUploadClick}
                    className={`w-20 h-14 shrink-0 rounded border border-dashed ${accentBorder} ${accentBg} hover:opacity-90 flex flex-col items-center justify-center text-n300 transition-opacity`}
                >
                    <ImagePlus className="w-3.5 h-3.5 mb-0.5" />
                    <span className="text-[9px]">上传</span>
                </button>
            )}
        </div>
    );
};

// 多参考图行（HappyHorse 1-9 + Kling omni 1-7 + Vidu r2v 1-7）
interface MultiRefRowProps {
    refs: SeedanceMediaInput[];
    maxCount: number;
    accentBorder: string;
    accentBg: string;
    placeholder?: string;
    onAdd: () => void;
    onRemove: (idx: number) => void;
    onPreview?: (url: string) => void;
}

const MultiRefRow: React.FC<MultiRefRowProps> = ({
    refs, maxCount, accentBorder, accentBg, placeholder = '+ 添加参考图',
    onAdd, onRemove, onPreview,
}) => (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {refs.map((m, idx) => {
            // 2026-05-25 #3: 同前两个 Slot，previewUrl 接受任意非空 url（含相对路径 / blob:）。
            const url = m.url || '';
            return (
                <div key={idx} className={`relative w-14 h-14 shrink-0 rounded border ${accentBorder} overflow-hidden bg-black group`}>
                    {url ? (
                        <img src={url} className="w-full h-full object-cover cursor-zoom-in" onClick={() => onPreview?.(url)} />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-n100">
                            #{idx + 1}
                        </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 text-center text-[8px] bg-n900/50 text-white">
                        [Image {idx + 1}]
                    </div>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                        className="absolute top-0 right-0 p-0.5 bg-n900/50 hover:bg-danger opacity-0 group-hover:opacity-100"
                        title="移除"
                    >
                        <X className="w-2.5 h-2.5 text-white" />
                    </button>
                </div>
            );
        })}
        {refs.length < maxCount && (
            <button
                type="button"
                onClick={onAdd}
                className={`w-14 h-14 shrink-0 rounded border border-dashed ${accentBorder} ${accentBg} hover:opacity-90 flex flex-col items-center justify-center text-n300 text-[8px] leading-tight px-1`}
                title={placeholder}
            >
                <ImagePlus className="w-3 h-3 mb-0.5" />
                {refs.length}/{maxCount}
            </button>
        )}
    </div>
);

// 表单字段统一样式
const inputCls = 'bg-n0 border border-n40 text-[11px] text-n800 rounded px-1.5 py-0.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const labelCls = 'flex items-center gap-1 text-[10px] text-n300';

// ─── Media 辅助：拆分 first/last/reference ─────────────────────────────────────

function splitMedia(media: SeedanceMediaInput[]) {
    const images = (media || []).filter(m => m.kind === 'image');
    const first = images.find(m => m.role === 'first_frame');
    const last = images.find(m => m.role === 'last_frame');
    const refs = images.filter(m => m !== first && m !== last);
    return { first, last, refs };
}

function patchMediaRole(
    media: SeedanceMediaInput[],
    role: 'first_frame' | 'last_frame' | 'reference_image' | undefined,
    next: SeedanceMediaInput | null,
    idx?: number,
): SeedanceMediaInput[] {
    const out = (media || []).filter(m => {
        if (role === 'first_frame' || role === 'last_frame') return m.role !== role;
        if (role === 'reference_image' && idx !== undefined) return true; // ref by idx 单独处理
        return true;
    });
    if (next) out.push({ ...next, role });
    return out;
}

// ─── 通用 props ────────────────────────────────────────────────────────────────

/** 2026-05-25 #3 — 可选注入的 prompt 编辑器，由外层 VideoPage 接 SeedanceMentionPromptEditor。
 *  默认情况下卡片回退到普通 textarea；当 PromptEditor 传入时启用 @ mention + 素材库。 */
export interface DashScopePromptEditorProps {
    params: DashScopeVideoParams;
    onChange: (next: DashScopeVideoParams) => void;
    disabled?: boolean;
    placeholder?: string;
}

export interface DashScopeCardProps {
    params: DashScopeVideoParams;
    onChange: (next: DashScopeVideoParams) => void;
    /** 调用方注入：打开图片选择器，回调拿到 SeedanceMediaInput */
    onPickImage: (cb: (m: SeedanceMediaInput) => void) => void;
    /** 调用方注入：图片预览 lightbox */
    onPreviewImage?: (url: string) => void;
    disabled?: boolean;
    /** 2026-05-25 #3 — 可选的 prompt 编辑器适配器（mention + 素材库） */
    PromptEditor?: React.FC<DashScopePromptEditorProps>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// KlingCard — 合体 · 蓝调
// ═══════════════════════════════════════════════════════════════════════════════

export const KlingCard: React.FC<DashScopeCardProps> = (props) => {
    const { params, onChange, onPickImage, onPreviewImage, disabled } = props;
    const theme = THEMES.Kling;
    const { first, last, refs } = useMemo(() => splitMedia(params.media_inputs || []), [params.media_inputs]);

    // 2026-05-25 hotfix — 模式简化为 2 个可 toggle 的按钮：Omni / Multi。
    // 默认 'auto'：storyboard 注入的 first/last 自然走 i2v/morph/t2v 通道，卡内不再
    // 单独显示首/尾上传槽（避免与左侧 storyboard image preview 形成"双源"困惑）。
    // 再次点击同一按钮 → 回到 'auto'（toggle 关闭）。
    type Mode = 'auto' | 'omni' | 'multi';
    const currentMode: Mode = useMemo(() => {
        if (params.kling_multi_shot) return 'multi';
        if (params.kling_active_mode === 'omni') return 'omni';
        if (params.kling_active_mode === 'multi') return 'multi';
        return 'auto';
    }, [params.kling_active_mode, params.kling_multi_shot]);

    const switchMode = useCallback((m: Mode) => {
        if (m === 'multi') {
            onChange({
                ...params,
                kling_active_mode: 'multi',
                kling_multi_shot: true,
                kling_shot_type: params.kling_shot_type || 'intelligence',
                kling_multi_prompt: params.kling_multi_prompt || [],
                media_inputs: [],
                sub_model_kling: 'standard',
            });
            return;
        }
        if (m === 'omni') {
            // 切到 omni：保留 refs，并把 storyboard 注入的 first/last 也转为 reference_image
            // —— 否则点 Omni 后会丢掉 storyboard 图，这跟用户预期相反。
            const fromFirst = first ? [{ ...first, role: 'reference_image' as const, file_id: first.file_id }] : [];
            const fromLast = last ? [{ ...last, role: 'reference_image' as const, file_id: last.file_id }] : [];
            const keptRefs = refs.map(r => ({ ...r, role: 'reference_image' as const }));
            onChange({
                ...params,
                kling_active_mode: 'omni',
                kling_multi_shot: false,
                media_inputs: [...fromFirst, ...fromLast, ...keptRefs],
                sub_model_kling: 'omni',
            });
            return;
        }
        // m === 'auto': 回到默认。如果用户之前是 omni 累加了额外 refs，需把它们清掉
        // 并把 refs[0] / refs[1] 重新映射为 first/last，否则切回 auto 会丢图。
        // 这里取保守做法：保留所有图，但 role 重映射为 first / (first+last) / refs。
        const allImgs = [
            ...(first ? [{ ...first, role: 'first_frame' as const }] : []),
            ...(last ? [{ ...last, role: 'last_frame' as const }] : []),
            ...refs,
        ];
        onChange({
            ...params,
            kling_active_mode: 'auto',
            kling_multi_shot: false,
            media_inputs: allImgs,
            sub_model_kling: 'standard',
        });
    }, [params, first, last, refs, onChange]);

    const addRef = useCallback(() => {
        onPickImage((m) => {
            const next = [...(params.media_inputs || []), { ...m, role: 'reference_image' as const }];
            onChange({
                ...params,
                sub_model_kling: 'omni',
                media_inputs: next.slice(0, 9),
            });
        });
    }, [params, onChange, onPickImage]);

    const removeRef = useCallback((idx: number) => {
        // refs 的 idx 是相对 splitMedia 后的 refs 列表的，转回 media_inputs 绝对 idx
        const target = refs[idx];
        if (!target) return;
        const absIdx = (params.media_inputs || []).indexOf(target);
        if (absIdx < 0) return;
        const next = (params.media_inputs || []).filter((_, i) => i !== absIdx);
        onChange({ ...params, media_inputs: next });
    }, [params, refs, onChange]);

    // 2026-05-25 #1/#2 — 子标题反映 storyboard 注入的 first/last：
    //   - auto + 无图  → 文生视频
    //   - auto + 首帧  → 图生视频
    //   - auto + 首+尾 → 首尾帧过渡（morph）
    //   - omni → 多参考
    //   - multi → 多镜头
    const autoSubLabel = first && last ? '首尾帧过渡' : first ? '图生视频' : '文生视频';
    const showAspect = currentMode === 'omni' || currentMode === 'multi'
        || (currentMode === 'auto' && !first); // auto 无首帧 = t2v，需要 aspect
    const dispatchSubtitle = currentMode === 'auto' ? autoSubLabel
        : currentMode === 'omni' ? 'omni 多参考'
            : '多镜头';
    const isCustomMulti = currentMode === 'multi' && params.kling_shot_type === 'customize';

    return (
        <DashScopeCardShell theme={theme} subtitle={`Kling · ${dispatchSubtitle}`}>
            {/* 2026-05-25 hotfix — 模式 toggle 简化为 2 个：Omni / Multi，可再点取消回 auto。
                首/尾帧不再单独占位 —— storyboard 顶部 image preview 决定 i2v/morph/t2v 通道，
                避免与 storyboard 形成双源真相。 */}
            <div className="flex items-center gap-1 text-[10px]">
                {([
                    ['omni', 'Omni 多参考', Layers],
                    ['multi', 'Multi 多镜头', Sparkles],
                ] as [Exclude<Mode, 'auto'>, string, any][]).map(([m, label, Icon]) => (
                    <button
                        key={m}
                        type="button"
                        disabled={disabled}
                        onClick={() => switchMode(currentMode === m ? 'auto' : m)}
                        className={`flex-1 px-1.5 py-1 rounded border flex items-center justify-center gap-1 transition-colors ${
                            currentMode === m
                                ? `${theme.accentBg} ${theme.accentBorder} ${theme.accentText}`
                                : 'bg-n0 border-n40 text-n100 hover:text-n700'
                        }`}
                    >
                        <Icon className="w-3 h-3" /> {label}
                    </button>
                ))}
            </div>

            {/* prompt（mention-aware） — 由外层 DashScopePromptEditor 适配后注入 */}
            {props.PromptEditor ? (
                <props.PromptEditor
                    params={params}
                    onChange={onChange}
                    disabled={!!(disabled || isCustomMulti)}
                    placeholder={
                        isCustomMulti
                            ? '自定义分镜模式下 prompt 不生效，请在下方为每个分镜单独写'
                            : '描述画面内容、动作、镜头语言；@ 选素材...'
                    }
                />
            ) : (
                <textarea
                    value={params.prompt || ''}
                    onChange={(e) => onChange({ ...params, prompt: e.target.value })}
                    placeholder={
                        isCustomMulti
                            ? '自定义分镜模式下 prompt 不生效，请在下方为每个分镜单独写'
                            : '描述画面内容、动作、镜头语言...'
                    }
                    disabled={disabled || isCustomMulti}
                    className={`w-full bg-n0 border border-n40 rounded px-2 py-1 text-[11px] text-n700 focus:border-sky-500 focus:outline-none resize-none h-12 disabled:opacity-50`}
                />
            )}

            {/* 媒体行 — Omni 时展示 MultiRefRow（含 storyboard 注入的图，已被 switchMode 转 reference_image） */}
            {currentMode === 'omni' && (
                <MultiRefRow
                    refs={refs}
                    maxCount={7}
                    accentBorder={theme.accentBorder}
                    accentBg={theme.accentBg}
                    placeholder="+ 参考图 (omni 最多 7 张)"
                    onAdd={addRef}
                    onRemove={removeRef}
                    onPreview={onPreviewImage}
                />
            )}

            {/* 2026-05-24 Task 3：多镜头编辑区（intelligence/customize） */}
            {currentMode === 'multi' && (
                <div className="flex flex-col gap-1.5 border border-sky-700/40 rounded p-2 bg-sky-950/20">
                    {/* shot_type 切换 */}
                    <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-n300">分镜模式：</span>
                        {(['intelligence', 'customize'] as const).map(st => (
                            <button
                                key={st}
                                type="button"
                                disabled={disabled}
                                onClick={() => onChange({ ...params, kling_shot_type: st })}
                                className={`px-2 py-0.5 rounded border ${
                                    (params.kling_shot_type || 'intelligence') === st
                                        ? `${theme.accentBg} ${theme.accentBorder} ${theme.accentText}`
                                        : 'bg-n0 border-n40 text-n300'
                                }`}
                            >
                                {st === 'intelligence' ? '智能分镜' : '自定义分镜'}
                            </button>
                        ))}
                    </div>

                    {params.kling_shot_type === 'customize' && (
                        <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto pr-1">
                            {(params.kling_multi_prompt || []).map((seg, idx) => (
                                <div key={idx} className="flex items-center gap-1 bg-n20 rounded px-1.5 py-1">
                                    <span className="text-[10px] text-sky-300 shrink-0 w-12">分镜 {seg.index}</span>
                                    <textarea
                                        value={seg.prompt}
                                        onChange={(e) => {
                                            const next = [...(params.kling_multi_prompt || [])];
                                            next[idx] = { ...next[idx], prompt: e.target.value };
                                            onChange({ ...params, kling_multi_prompt: next });
                                        }}
                                        placeholder="本镜头的画面描述"
                                        rows={2}
                                        disabled={disabled}
                                        className="flex-1 bg-n0 border border-n40 rounded px-1.5 py-0.5 text-[11px] text-n700 focus:border-sky-500 focus:outline-none resize-none"
                                    />
                                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                                        <input
                                            type="number" min={1} max={params.duration || 15} step={1}
                                            value={seg.duration}
                                            onChange={(e) => {
                                                const next = [...(params.kling_multi_prompt || [])];
                                                next[idx] = { ...next[idx], duration: Number(e.target.value) };
                                                onChange({ ...params, kling_multi_prompt: next });
                                            }}
                                            disabled={disabled}
                                            className={`${inputCls} w-12`}
                                        />
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => {
                                                const next = (params.kling_multi_prompt || []).filter((_, i) => i !== idx);
                                                onChange({ ...params, kling_multi_prompt: next });
                                            }}
                                            className="text-[9px] text-danger hover:text-danger"
                                        >移除</button>
                                    </div>
                                </div>
                            ))}
                            {(params.kling_multi_prompt?.length || 0) < 6 && (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        const arr = [...(params.kling_multi_prompt || [])];
                                        arr.push({ index: arr.length + 1, prompt: '', duration: 5 });
                                        onChange({ ...params, kling_multi_prompt: arr });
                                    }}
                                    className="text-[10px] text-sky-300 hover:text-sky-200 border border-dashed border-sky-700/50 rounded py-1 hover:bg-sky-950/30"
                                >+ 添加分镜 ({(params.kling_multi_prompt?.length || 0)}/6)</button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* 参数行 1：mode + duration + aspect_ratio */}
            <div className="grid grid-cols-3 gap-1.5">
                <label className={labelCls}>
                    <Sparkles className="w-2.5 h-2.5" /> 画质
                    <select
                        value={params.mode || 'std'}
                        onChange={(e) => onChange({ ...params, mode: e.target.value as KlingMode })}
                        disabled={disabled}
                        className={inputCls}
                    >
                        <option value="std">std · 720P</option>
                        <option value="pro">pro · 1080P</option>
                    </select>
                </label>
                <label className={labelCls}>
                    <Hash className="w-2.5 h-2.5" /> 时长
                    <input
                        type="number" min={3} max={15} step={1}
                        value={params.duration ?? 5}
                        onChange={(e) => onChange({ ...params, duration: Number(e.target.value) })}
                        disabled={disabled}
                        className={`${inputCls} w-12`}
                    />
                    s
                </label>
                {showAspect && (
                    <label className={labelCls}>
                        <RotateCcw className="w-2.5 h-2.5" /> 比例
                        <select
                            value={params.aspect_ratio || '16:9'}
                            onChange={(e) => onChange({ ...params, aspect_ratio: e.target.value as DashScopeAspectRatio })}
                            disabled={disabled}
                            className={inputCls}
                        >
                            <option value="16:9">16:9</option>
                            <option value="9:16">9:16</option>
                            <option value="1:1">1:1</option>
                        </select>
                    </label>
                )}
            </div>

            {/* 参数行 2：audio + watermark + sub_model */}
            <div className="grid grid-cols-3 gap-1.5">
                <label className={`${labelCls} cursor-pointer`}>
                    <input
                        type="checkbox"
                        checked={!!params.audio}
                        onChange={(e) => onChange({ ...params, audio: e.target.checked })}
                        disabled={disabled}
                    />
                    <Volume2 className="w-2.5 h-2.5" /> 有声
                </label>
                <label className={`${labelCls} cursor-pointer`}>
                    <input
                        type="checkbox"
                        checked={!!params.watermark}
                        onChange={(e) => onChange({ ...params, watermark: e.target.checked })}
                        disabled={disabled}
                    />
                    水印
                </label>
                <div className="flex items-center justify-end text-[9px] text-n100">
                    {params.sub_model_kling === 'omni' ? 'omni · 多参考' : 'standard'}
                </div>
            </div>
        </DashScopeCardShell>
    );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ViduCard — 大乘 · 紫调
// ═══════════════════════════════════════════════════════════════════════════════

export const ViduCard: React.FC<DashScopeCardProps> = (props) => {
    const { params, onChange, onPickImage, onPreviewImage, disabled } = props;
    const theme = THEMES.Vidu;
    const { first, last, refs } = useMemo(() => splitMedia(params.media_inputs || []), [params.media_inputs]);

    // 2026-05-25 #6 — 不再切换"参考/首尾帧"，两个上传槽 + 参考行始终可见。
    // sub_model_vidu 自动联动：双帧填齐 → 切到 startend 兼容的 turbo 子模型。
    // 2026-05-25 #1 hotfix — 模式纯由 storyboard 注入的 first/last 决定，卡内不再单独占位。
    // 双图 storyboard → startend 通道；单图/无图 → reference 通道。
    type Mode = 'reference' | 'startend';
    const currentMode: Mode = first && last ? 'startend' : 'reference';

    // sub_model 跟随 first/last 自动切 turbo（startend 通道偏好 turbo）。
    // 单图/无图 时不强制改 sub_model，避免误改用户的显式选择。
    useEffect(() => {
        const hasPair = !!(first && last);
        const m = params.sub_model_vidu || 'q3';
        if (hasPair && !m.includes('turbo')) {
            const turbo = (m.includes('q3') ? 'q3-turbo' : 'q2-turbo') as ViduSubModel;
            onChange({ ...params, sub_model_vidu: turbo });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [first, last]);

    const addRef = useCallback(() => {
        onPickImage((m) => {
            const newRefs = [...refs, { ...m, role: 'reference_image' as const }];
            const keep = (params.media_inputs || []).filter(x => x.role === 'first_frame' || x.role === 'last_frame');
            onChange({
                ...params,
                media_inputs: [...keep, ...newRefs.slice(0, 7)],
            });
        });
    }, [refs, params, onChange, onPickImage]);

    const removeRef = useCallback((idx: number) => {
        const target = refs[idx];
        if (!target) return;
        const absIdx = (params.media_inputs || []).indexOf(target);
        if (absIdx < 0) return;
        onChange({
            ...params,
            media_inputs: (params.media_inputs || []).filter((_, i) => i !== absIdx),
        });
    }, [params, refs, onChange]);

    // q3 模型默认上限 16s；q2 模型上限 10s
    const subModel = params.sub_model_vidu || 'q3';
    const maxDuration = subModel.startsWith('q3') ? 16 : 10;
    const supportsAudio = subModel.startsWith('q3'); // 仅 q3 支持
    const subtitle = currentMode === 'startend' ? '首尾帧通道' : (refs.length > 0 ? '参考生视频' : '待上传');

    return (
        <DashScopeCardShell theme={theme} subtitle={`Vidu · ${subtitle}`}>
            {/* 2026-05-25 #3 — prompt 编辑器（mention + 素材库），由外层 VideoPage 注入 */}
            {props.PromptEditor ? (
                <props.PromptEditor
                    params={params}
                    onChange={onChange}
                    disabled={disabled}
                    placeholder="描述参考主体如何融合到场景中；@ 选素材..."
                />
            ) : (
                <textarea
                    value={params.prompt || ''}
                    onChange={(e) => onChange({ ...params, prompt: e.target.value })}
                    placeholder="描述参考主体如何融合到场景中..."
                    disabled={disabled}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-[11px] text-n700 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none resize-none h-12"
                />
            )}

            {/* 2026-05-25 #1 hotfix — 始终只展示一行参考图行。
                storyboard 单图 → first_frame，走 reference 通道；
                storyboard 双图 → first_frame + last_frame，自动走 startend 通道；
                用户额外 @ 或点 + 添加的图 → reference_image。 */}
            <div className="flex items-center gap-2 text-[10px] text-n300">
                <span className="shrink-0">参考</span>
                <MultiRefRow
                    refs={refs}
                    maxCount={7}
                    accentBorder={theme.accentBorder} accentBg={theme.accentBg}
                    placeholder={currentMode === 'startend'
                        ? '+ 参考图（已通过分镜启用首尾帧通道）'
                        : '+ 参考图 (Vidu 1-7 张)'}
                    onAdd={addRef} onRemove={removeRef}
                    onPreview={onPreviewImage}
                />
            </div>

            {/* 核心参数：子模型 + 时长 + 水印 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                <label className={labelCls}>
                    <Wand2 className="w-2.5 h-2.5" /> 子模型
                    <select
                        value={subModel}
                        onChange={(e) => onChange({ ...params, sub_model_vidu: e.target.value as ViduSubModel })}
                        disabled={disabled}
                        className={inputCls}
                    >
                        {/* 2026-05-25 #6 — 全部子模型一次列全，由用户自行匹配；当 first+last 同时填
                            时上面 updateFirst/updateLast 会自动切到 turbo 子模型。 */}
                        <option value="q3-mix">q3-mix</option>
                        <option value="q3">q3</option>
                        <option value="q3-pro">q3-pro</option>
                        <option value="q3-turbo">q3-turbo</option>
                        <option value="q2">q2</option>
                        <option value="q2-pro">q2-pro</option>
                        <option value="q2-turbo">q2-turbo</option>
                    </select>
                </label>
                <label className={labelCls}>
                    <Hash className="w-2.5 h-2.5" /> 时长
                    <input
                        type="number" min={1} max={maxDuration} step={1}
                        value={params.duration ?? 5}
                        onChange={(e) => onChange({ ...params, duration: Number(e.target.value) })}
                        disabled={disabled}
                        className={`${inputCls} w-12`}
                    />
                    s
                </label>
                <label className={`${labelCls} cursor-pointer`}>
                    <input
                        type="checkbox"
                        checked={!!params.watermark}
                        onChange={(e) => onChange({ ...params, watermark: e.target.checked })}
                        disabled={disabled}
                    />
                    水印
                </label>
            </div>

            {/* 高级参数：永久展开（2026-05-25 A5：<section> 替换 <details open>，
                用户明确"参数显示都全"，不允许折叠后参数消失） */}
            <section className="border-t border-n40 pt-2">
                <div className="text-[10px] text-n300 mb-1.5">高级参数</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    <label className={labelCls}>
                        <Maximize2 className="w-2.5 h-2.5" /> 分辨率
                        <select
                            value={params.vidu_resolution || '720P'}
                            onChange={(e) => {
                                const r = e.target.value as ViduResolution;
                                const defaultSize: Record<ViduResolution, string> = {
                                    '540P': '1024*576',
                                    '720P': '1280*720',
                                    '1080P': '1920*1080',
                                };
                                onChange({ ...params, vidu_resolution: r, vidu_size: defaultSize[r] });
                            }}
                            disabled={disabled}
                            className={inputCls}
                            aria-label="分辨率"
                        >
                            <option value="540P">540P</option>
                            <option value="720P">720P</option>
                            <option value="1080P">1080P</option>
                        </select>
                    </label>
                    <label className={labelCls}>
                        size
                        <input
                            type="text"
                            value={params.vidu_size || ''}
                            onChange={(e) => onChange({ ...params, vidu_size: e.target.value })}
                            placeholder="1280*720"
                            disabled={disabled}
                            className={`${inputCls} w-20`}
                            aria-label="像素尺寸"
                        />
                    </label>
                    <label className={labelCls}>
                        种子
                        <input
                            type="number" min={0} max={2147483647} step={1}
                            value={params.vidu_seed ?? ''}
                            onChange={(e) => onChange({
                                ...params,
                                vidu_seed: e.target.value === '' ? undefined : Number(e.target.value),
                            })}
                            placeholder="随机"
                            disabled={disabled}
                            className={`${inputCls} w-20`}
                            aria-label="seed"
                        />
                    </label>
                    <label className={`${labelCls} cursor-pointer ${!supportsAudio ? 'opacity-60' : ''}`}>
                        <input
                            type="checkbox"
                            checked={supportsAudio && !!params.vidu_audio}
                            onChange={(e) => onChange({ ...params, vidu_audio: e.target.checked })}
                            disabled={disabled || !supportsAudio}
                            aria-label="audio"
                        />
                        <Volume2 className="w-2.5 h-2.5" /> 有声 {!supportsAudio && <span className="text-[8px] text-warning">(仅 q3)</span>}
                    </label>
                </div>
            </section>
        </DashScopeCardShell>
    );
};

// ═══════════════════════════════════════════════════════════════════════════════
// HappyHorseCard — 炼虚 · 橙调
// ═══════════════════════════════════════════════════════════════════════════════

const HH_RATIOS: HappyHorseRatio[] = ['16:9', '9:16', '3:4', '4:3', '4:5', '5:4', '1:1', '9:21', '21:9'];

// 按图片实际宽高选最接近的 HappyHorse 比例档（分镜竖图 → 9:16，横图 → 16:9）。
function closestHhRatio(w: number, h: number): HappyHorseRatio {
    if (!w || !h) return '16:9';
    const target = w / h;
    let best: HappyHorseRatio = '16:9';
    let bestDiff = Infinity;
    for (const r of HH_RATIOS) {
        const [rw, rh] = r.split(':').map(Number);
        const diff = Math.abs(rw / rh - target);
        if (diff < bestDiff) { bestDiff = diff; best = r; }
    }
    return best;
}

export const HappyHorseCard: React.FC<DashScopeCardProps> = (props) => {
    const { params, onChange, onPickImage, onPreviewImage, disabled } = props;
    const theme = THEMES.HappyHorse;
    const { refs } = useMemo(() => splitMedia(params.media_inputs || []), [params.media_inputs]);

    // HappyHorse 没有"自适应"档，默认写死 16:9 会让分镜的 9:16 竖图被强转横版。
    // 这里按首张参考图的实际宽高自动推断比例（用户当前会话手动改过则不再覆盖）。
    const userSetRatioRef = useRef(false);
    const firstRefUrl = refs[0]?.url || '';
    useEffect(() => {
        if (userSetRatioRef.current || !firstRefUrl) return;
        const src = firstRefUrl.startsWith('data:') || firstRefUrl.startsWith('blob:')
            ? firstRefUrl
            : secureApiUrl(firstRefUrl, { absolute: true, requireAuth: false });
        const im = new Image();
        im.onload = () => {
            if (userSetRatioRef.current) return;
            const r = closestHhRatio(im.naturalWidth, im.naturalHeight);
            if (r && r !== (params.hh_ratio || '16:9')) onChange({ ...params, hh_ratio: r });
        };
        im.src = src;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstRefUrl]);

    const addRef = useCallback(() => {
        onPickImage((m) => {
            onChange({
                ...params,
                media_inputs: [...(params.media_inputs || []), { ...m, role: 'reference_image' as const }].slice(0, 9),
            });
        });
    }, [params, onChange, onPickImage]);

    const removeRef = useCallback((idx: number) => {
        onChange({
            ...params,
            media_inputs: (params.media_inputs || []).filter((_, i) => i !== idx),
        });
    }, [params, onChange]);

    return (
        <DashScopeCardShell theme={theme} subtitle="HappyHorse · 多图参考生">
            <div className="flex items-center gap-1 text-[10px] text-n100">
                <Sparkles className="w-3 h-3" />
                提示词中用 <span className={`${theme.accentText} font-mono mx-0.5`}>[Image 1]</span> 等引用第 N 张参考图
            </div>

            {props.PromptEditor ? (
                <props.PromptEditor
                    params={params}
                    onChange={onChange}
                    disabled={disabled}
                    placeholder="[Image 1] 中身着红衣的女性，... 也可 @ 选素材"
                />
            ) : (
                <textarea
                    value={params.prompt || ''}
                    onChange={(e) => onChange({ ...params, prompt: e.target.value })}
                    placeholder="[Image 1] 中身着红衣的女性，... [Image 2] 中的折扇..."
                    disabled={disabled}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-[11px] text-n700 focus:border-orange-500 focus:outline-none resize-none h-14"
                />
            )}

            <MultiRefRow
                refs={refs}
                maxCount={9}
                accentBorder={theme.accentBorder} accentBg={theme.accentBg}
                placeholder="+ 参考图 (1-9 张)"
                onAdd={addRef} onRemove={removeRef}
                onPreview={onPreviewImage}
            />

            {/* 核心参数：时长 + 分辨率 + 比例 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                <label className={labelCls}>
                    <Hash className="w-2.5 h-2.5" /> 时长
                    <input
                        type="number" min={3} max={15} step={1}
                        value={params.hh_duration ?? 5}
                        onChange={(e) => onChange({ ...params, hh_duration: Number(e.target.value) })}
                        disabled={disabled}
                        className={`${inputCls} w-12`}
                        aria-label="时长"
                    />
                    s
                </label>
                <label className={labelCls}>
                    <Maximize2 className="w-2.5 h-2.5" /> 分辨率
                    <select
                        value={params.hh_resolution || '1080P'}
                        onChange={(e) => onChange({ ...params, hh_resolution: e.target.value as HhResolution })}
                        disabled={disabled}
                        className={inputCls}
                        aria-label="分辨率"
                    >
                        <option value="720P">720P</option>
                        <option value="1080P">1080P</option>
                    </select>
                </label>
                <label className={labelCls}>
                    <RotateCcw className="w-2.5 h-2.5" /> 比例
                    <select
                        value={params.hh_ratio || '16:9'}
                        onChange={(e) => { userSetRatioRef.current = true; onChange({ ...params, hh_ratio: e.target.value as HhRatio }); }}
                        disabled={disabled}
                        className={inputCls}
                        aria-label="比例"
                    >
                        <option value="16:9">16:9 横版宽</option>
                        <option value="9:16">9:16 竖版</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                        <option value="1:1">1:1 方形</option>
                        <option value="4:5">4:5</option>
                        <option value="5:4">5:4</option>
                        <option value="21:9">21:9 影院宽</option>
                        <option value="9:21">9:21</option>
                    </select>
                </label>
            </div>

            {/* 高级参数：永久展开（2026-05-25 A5：<section> 替换 <details open>，
                用户明确"参数显示都全"，不允许折叠后参数消失） */}
            <section className="border-t border-n40 pt-2">
                <div className="text-[10px] text-n300 mb-1.5">高级参数</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    <label className={`${labelCls} cursor-pointer`}>
                        <input
                            type="checkbox"
                            checked={params.hh_watermark !== false}
                            onChange={(e) => onChange({ ...params, hh_watermark: e.target.checked })}
                            disabled={disabled}
                            aria-label="watermark"
                        />
                        水印（"Happy Horse" 右下角）
                    </label>
                    <label className={labelCls}>
                        种子
                        <input
                            type="number" min={0} max={2147483647} step={1}
                            value={params.hh_seed ?? ''}
                            onChange={(e) => onChange({
                                ...params,
                                hh_seed: e.target.value === '' ? undefined : Number(e.target.value),
                            })}
                            placeholder="随机"
                            disabled={disabled}
                            className={`${inputCls} w-20`}
                            aria-label="seed"
                        />
                    </label>
                </div>
            </section>
        </DashScopeCardShell>
    );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 派发器
// ═══════════════════════════════════════════════════════════════════════════════

export const DashScopeVideoCard: React.FC<DashScopeCardProps> = (props) => {
    if (props.params.model === 'Kling') return <KlingCard {...props} />;
    if (props.params.model === 'Vidu') return <ViduCard {...props} />;
    if (props.params.model === 'HappyHorse') return <HappyHorseCard {...props} />;
    return null;
};

// 2026-05-24 Task 3：legacy `makeDefaultDashScopeParams` 已迁移到
// `new_html/services/videoService.ts`（包含 Kling 多镜头 / Vidu vidu_* / HappyHorse hh_* 默认值）。
// VideoPage 等消费方应从 service 层导入，本文件不再重新导出工厂函数。
