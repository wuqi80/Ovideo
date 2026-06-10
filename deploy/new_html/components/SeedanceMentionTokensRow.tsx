// new_html/components/SeedanceMentionTokensRow.tsx
//
// 2026-05-20 (Bug 4)：@-mention 文字块预览侧栏。
//
// 设计：textarea 内 token 仍是纯文本（图片1 / 视频1 / 音频1），无法 hover 预览。
// 在 textarea 下方/外侧加一行胶囊清单：每个 media_inputs 一格小卡，
// hover 弹大图、点击调用 onPreview（外层 lightbox），X 调用 removeMediaInput。
//
// 这样 textarea 完全不动（IME / 复制粘贴 / Backspace 块删行为不变），
// 视觉锚点交给独立组件，是改造代价最小的方案（参见 docs/conventions.md）。
import React, { useState } from 'react';
import { ImageIcon, Music, Video as VideoIcon, X } from 'lucide-react';
import type { SeedanceParams, SeedanceMediaInput } from '../services/videoService';
import { removeMediaInput, TOKEN_PREFIX } from '../utils/seedanceMedia';

export interface SeedanceMentionTokensRowProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    /** Called when the user clicks the thumbnail (open in lightbox). Optional. */
    onPreview?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    disabled?: boolean;
    /** Hide row entirely when no media (default true). */
    hideWhenEmpty?: boolean;
    /** 2026-06-05：hover 大图预览向上弹出（放大编辑弹窗里 chips 贴底，向下会被裁切）。 */
    openUpward?: boolean;
}

interface TokenInfo {
    absIdx: number;          // index in media_inputs
    kind: SeedanceMediaInput['kind'];
    url: string;
    rankInKind: number;      // 1-based among same kind
    label: string;           // 图片1 / 视频1 / 音频1
}

function buildTokens(value: SeedanceParams): TokenInfo[] {
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    return value.media_inputs.map((m, i) => {
        counters[m.kind]++;
        return {
            absIdx: i,
            kind: m.kind,
            url: m.url,
            rankInKind: counters[m.kind],
            label: `${TOKEN_PREFIX[m.kind]}${counters[m.kind]}`,
        };
    });
}

export const SeedanceMentionTokensRow: React.FC<SeedanceMentionTokensRowProps> = (p) => {
    const tokens = buildTokens(p.value);
    const [hovering, setHovering] = useState<number | null>(null);

    if (tokens.length === 0 && (p.hideWhenEmpty ?? true)) return null;

    return (
        <div
            className="flex flex-wrap items-center gap-1 mt-1.5 pt-1.5 border-t border-slate-800/60"
            data-testid="seedance-mention-tokens-row"
            aria-label="已插入素材"
        >
            {tokens.length === 0 ? (
                <span className="text-[10px] text-slate-600 italic">尚未插入素材，输入 @ 选择</span>
            ) : (
                tokens.map((t) => (
                    <TokenChip
                        key={t.absIdx}
                        token={t}
                        hovering={hovering === t.absIdx}
                        onHoverStart={() => setHovering(t.absIdx)}
                        onHoverEnd={() => setHovering(prev => prev === t.absIdx ? null : prev)}
                        onPreview={() => p.onPreview?.(t.url, t.kind)}
                        onRemove={() => p.onChange(removeMediaInput(p.value, t.absIdx))}
                        disabled={!!p.disabled}
                        openUpward={!!p.openUpward}
                    />
                ))
            )}
        </div>
    );
};

interface TokenChipProps {
    token: TokenInfo;
    hovering: boolean;
    onHoverStart: () => void;
    onHoverEnd: () => void;
    onPreview: () => void;
    onRemove: () => void;
    disabled: boolean;
    openUpward?: boolean;
}

const TokenChip: React.FC<TokenChipProps> = ({ token, hovering, onHoverStart, onHoverEnd, onPreview, onRemove, disabled, openUpward }) => {
    const isImage = token.kind === 'image';
    const isVideo = token.kind === 'video';
    const isAudio = token.kind === 'audio';
    // 向上：bottom-full mb-1（悬浮卡在 chip 上方）；向下：top-full mt-1（默认）
    const popoverPos = openUpward ? 'bottom-full mb-1' : 'top-full mt-1';

    // 尺寸：48×36 缩略图（图片）/ 48×24 文字（视频/音频）
    return (
        <div
            className="relative inline-flex items-center gap-1 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-200 group"
            onMouseEnter={onHoverStart}
            onMouseLeave={onHoverEnd}
        >
            {/* 缩略图 / kind 图标 */}
            {isImage ? (
                <button
                    type="button"
                    onClick={onPreview}
                    title={`点击预览 ${token.label}`}
                    className="block w-12 h-9 rounded overflow-hidden bg-slate-900 border border-slate-700 cursor-zoom-in"
                >
                    <img src={token.url} alt={token.label} className="w-full h-full object-cover" />
                </button>
            ) : isVideo ? (
                <button
                    type="button"
                    onClick={onPreview}
                    title={`点击预览 ${token.label}`}
                    className="flex items-center justify-center w-12 h-9 rounded bg-slate-900 border border-slate-700 text-purple-300 cursor-zoom-in"
                >
                    <VideoIcon size={14} />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onPreview}
                    title={`点击预览 ${token.label}`}
                    className="flex items-center justify-center w-12 h-9 rounded bg-slate-900 border border-slate-700 text-emerald-300 cursor-zoom-in"
                >
                    <Music size={14} />
                </button>
            )}

            {/* 标签 + 删除 */}
            <div className="flex flex-col items-start min-w-0">
                <span className="font-medium tabular-nums text-slate-100">{token.label}</span>
                <span className="text-[9px] text-slate-500 truncate max-w-[80px]">
                    {(token.url || '').split('/').pop()?.split('?')[0] || token.kind}
                </span>
            </div>

            <button
                type="button"
                onClick={onRemove}
                disabled={disabled}
                aria-label={`删除 ${token.label}`}
                className="ml-0.5 p-0.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded opacity-60 group-hover:opacity-100 transition-opacity"
            >
                <X size={10} />
            </button>

            {/* hover 大图悬浮卡（仅 image 有意义） */}
            {hovering && isImage && (
                <div
                    className={`absolute z-50 left-0 ${popoverPos} p-1 bg-slate-900 border border-slate-600 rounded shadow-lg pointer-events-none`}
                    style={{ minWidth: 180 }}
                >
                    <img src={token.url} alt={token.label} className="block max-w-[220px] max-h-[160px] object-contain rounded" />
                    <div className="mt-1 text-[9px] text-slate-400 text-center">{token.label}</div>
                </div>
            )}
            {hovering && (isVideo || isAudio) && (
                <div
                    className={`absolute z-50 left-0 ${popoverPos} p-1.5 bg-slate-900 border border-slate-600 rounded shadow-lg pointer-events-none text-[10px] text-slate-300`}
                    style={{ minWidth: 180 }}
                >
                    <div className="flex items-center gap-1">
                        {isVideo ? <VideoIcon size={12} /> : <Music size={12} />}
                        <span className="truncate" style={{ maxWidth: 160 }}>{token.url}</span>
                    </div>
                    <div className="mt-0.5 text-[9px] text-slate-500">点击在 lightbox 预览</div>
                </div>
            )}
        </div>
    );
};

export default SeedanceMentionTokensRow;
