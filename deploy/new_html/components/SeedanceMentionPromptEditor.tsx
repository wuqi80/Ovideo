// new_html/components/SeedanceMentionPromptEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { SeedanceParams, SeedanceMediaInput } from '../services/videoService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { insertMention, parseArkAssetId, removeMediaInput, TOKEN_PREFIX } from '../utils/seedanceMedia';
import { SeedanceMentionTokensRow } from './SeedanceMentionTokensRow';
import { AIRewritePromptModal } from './AIRewritePromptModal';
import { splitPromptSegments, TOKEN_KIND_OVERLAY_CLASS } from '../utils/promptHighlight';

export interface SeedanceMentionPromptEditorProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
    disabled?: boolean;
    autoOpenOnMount?: boolean;
    placeholder?: string;
    /** Click on a token thumbnail → external lightbox handler (see VideoPage). Optional. */
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    /** Hide the row even when there's media (used by list-view rows where space is tight). */
    hideTokensRow?: boolean;
    /** textarea 行数（默认 3）；放大编辑弹窗里传大值（如 18）。 */
    rows?: number;
    /** 2026-06-05：@ 候选弹层 + 素材 hover 大图改为向上弹出（放大编辑弹窗里编辑器很高、贴底，向下会被裁切）。 */
    openUpward?: boolean;
}

const GROUP_LABELS: Record<string, string> = {
    current_card: '当前卡',
    storyboard_data: '分镜',
    assets: '素材库',
    audio: '音频',
    video_segments: '视频片段',
    user_files: '媒体库',
    ark_asset_id: '远程 ID',
};

export const SeedanceMentionPromptEditor: React.FC<SeedanceMentionPromptEditorProps> = (props) => {
    const { value, onChange, candidates, disabled, autoOpenOnMount, placeholder, onPreviewMedia, hideTokensRow, rows, openUpward } = props;
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const [composing, setComposing] = useState(false);
    // 2026-05-20 (Bug 1)：popover 打开时记录 @ 在 prompt 中的下标；handleSelect 用它做 caret-mode 替换。
    const [atPos, setAtPos] = useState<number | null>(null);
    // 2026-05-20 (Bug 2)：AI 改写 modal 开关。
    const [rewriteOpen, setRewriteOpen] = useState(false);

    // autoOpenOnMount
    useEffect(() => {
        if (autoOpenOnMount && (value.prompt || '').trim() === '@') {
            setOpen(true);
            setSearch('');
            // 2026-05-20 (Bug 1)：autoOpen 时记录 @ 位置（trim() 之后）便于 caret 替换
            const idx = value.prompt.indexOf('@');
            setAtPos(idx >= 0 ? idx : 0);
            // Focus + place cursor at end so the popover anchors at the @
            taRef.current?.focus();
            taRef.current?.setSelectionRange(value.prompt.length, value.prompt.length);
        }
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Compose (IME) suppression
    useEffect(() => { if (composing) setOpen(false); }, [composing]);

    // Filtered + grouped candidates
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = q
            ? candidates.filter(c => c.label.toLowerCase().includes(q))
            : candidates;
        const groups: Record<string, SeedanceAssetCandidate[]> = {};
        for (const c of list) {
            (groups[c.group] ||= []).push(c);
        }
        return groups;
    }, [search, candidates]);

    const flatList = useMemo(
        () => Object.entries(filtered).flatMap(([_, items]) => items),
        [filtered],
    );

    const handleSelect = useCallback(
        (cand: SeedanceAssetCandidate) => {
            // 2026-05-20 (Bug 1)：caret 模式 — atPos 是 @ 字符位置，caretPos 是 textarea 当前光标；
            // 替换 [atPos, caretPos) 为 token；popover 关闭后焦点回到 textarea，光标移到 token 之后。
            const ta = taRef.current;
            const caretPos = ta ? ta.selectionStart : (value.prompt || '').length;
            const opts = atPos != null && caretPos >= atPos
                ? { atPos, caretPos }
                : undefined;

            let next: SeedanceParams;
            if (cand.group === 'ark_asset_id') {
                const raw = window.prompt('输入 asset:// id（如 asset://abc-123）：') || '';
                const valid = parseArkAssetId(raw);
                if (!valid) {
                    window.alert('无效的 asset:// 格式');
                    return;
                }
                const arkCand: SeedanceAssetCandidate = { ...cand, arkAssetId: valid };
                next = insertMention(value, arkCand, opts);
            } else {
                next = insertMention(value, cand, opts);
            }
            onChange(next);
            setOpen(false);
            setSearch('');
            setAtPos(null);
            // 把光标移到 token 之后（异步，等 onChange flush 后）
            setTimeout(() => {
                if (!taRef.current) return;
                taRef.current.focus();
                const newCursor = opts ? Math.min(next.prompt.length, opts.atPos + (next.prompt.length - (value.prompt || '').length + (caretPos - opts.atPos))) : next.prompt.length;
                taRef.current.setSelectionRange(newCursor, newCursor);
            }, 0);
        },
        [value, onChange, atPos],
    );

    // Detect @ trigger after each input event
    const handleInput = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const v = e.target.value;
            onChange({ ...value, prompt: v });
            if (composing || disabled) return;
            const cursor = e.target.selectionStart || 0;
            // Look at the char just typed and the one before it
            const justTyped = v.charAt(cursor - 1);
            if (justTyped !== '@') {
                // 2026-05-20 (Bug 1)：用户在 popover 打开后继续打字搜索；search 跟随 cursor 与 atPos 之间的文本。
                if (open && atPos != null) {
                    if (cursor < atPos) {
                        // 用户向前删除越过了 @，关闭
                        setOpen(false);
                        setAtPos(null);
                    } else {
                        const segment = v.slice(atPos + 1, cursor);
                        // 如果段中含空白或换行，说明用户结束了 @ 输入，不再过滤
                        if (/\s/.test(segment)) {
                            setOpen(false);
                            setAtPos(null);
                        } else {
                            setSearch(segment);
                            setActiveIdx(0);
                        }
                    }
                } else if (open) {
                    const lastAt = v.lastIndexOf('@', cursor - 1);
                    if (lastAt < 0) setOpen(false);
                }
                return;
            }
            // Trigger when char before @ is line-start, whitespace, OR any non-ASCII-word
            // character (Chinese, punctuation, full-width). Previous /\s/-only check
            // (Bug 3, 2026-05-20) silently swallowed @ when the prompt ended in 中文 or
            // a punctuation mark — exactly the case for imported video_prompt cards.
            const prev = cursor >= 2 ? v.charAt(cursor - 2) : '';
            if (prev === '' || !/[A-Za-z0-9_]/.test(prev)) {
                setOpen(true);
                setSearch('');
                setActiveIdx(0);
                // 2026-05-20 (Bug 1)：记录 @ 在 prompt 中的下标，cursor - 1 即为 @ 位置
                setAtPos(cursor - 1);
            }
        },
        [value, onChange, composing, disabled, open, atPos],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            // Issue 5b: Backspace at end of a token deletes whole 图片N / 视频N / 音频N
            // and removes the matching media_inputs entry (renumbers remaining tokens).
            // TOKEN_PREFIX is imported as the canonical label source; the regex below
            // uses the literal labels for clarity.
            if (e.key === 'Backspace' && !composing) {
                const ta = taRef.current;
                if (ta) {
                    const cursor = ta.selectionStart;
                    // Only fire when there's no selection (range delete is plain text)
                    if (cursor === ta.selectionEnd) {
                        const before = (value.prompt || '').slice(0, cursor);
                        const m = /(图片|视频|音频)(\d+)$/.exec(before);
                        if (m) {
                            e.preventDefault();
                            const tokenLen = m[0].length;
                            const labelToKind: Record<string, 'image' | 'video' | 'audio'> = {
                                '图片': 'image', '视频': 'video', '音频': 'audio',
                            };
                            const kind = labelToKind[m[1]];
                            const tokenN = parseInt(m[2], 10);
                            // Find the corresponding media_inputs index (N-th of that kind)
                            const sameKindAbs = value.media_inputs
                                .map((mi, i) => mi.kind === kind ? i : -1)
                                .filter(i => i >= 0);
                            const targetAbsIdx = sameKindAbs[tokenN - 1];

                            // Delete the token text and (if present) one preceding space
                            const start = cursor - tokenLen;
                            const trimStart = start > 0 && (value.prompt || '').charAt(start - 1) === ' ' ? start - 1 : start;
                            const promptStripped =
                                (value.prompt || '').slice(0, trimStart) + (value.prompt || '').slice(cursor);

                            if (targetAbsIdx === undefined || targetAbsIdx < 0) {
                                // No backing media (orphan token) — just strip text
                                onChange({ ...value, prompt: promptStripped });
                            } else {
                                // removeMediaInput operates on the full SeedanceParams (renumbers
                                // remaining tokens automatically). We then overlay our stripped
                                // prompt because removeMediaInput preserves text around the token.
                                const after = removeMediaInput(value, targetAbsIdx);
                                onChange({ ...after, prompt: removeMediaInput({ ...value, prompt: promptStripped }, targetAbsIdx).prompt });
                            }
                            return;
                        }
                    }
                }
            }
            if (!open) return;
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx(i => Math.min(flatList.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx(i => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const cand = flatList[activeIdx];
                if (cand) handleSelect(cand);
            }
        },
        [open, flatList, activeIdx, handleSelect, value, onChange, composing],
    );

    // 2026-05-20 (Bug #1)：mask overlay — textarea 字色透明，上方 div 渲染高亮 token。
    // 关键：textarea 与 overlay 必须共享 padding / font / line-height / letter-spacing
    // 才能保证字符位置一致（光标 + 高亮严丝合缝）。
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const promptText = value.prompt || '';
    const segments = useMemo(() => splitPromptSegments(promptText), [promptText]);
    // textarea 滚动时同步 overlay 滚动位置
    const handleScroll = useCallback(() => {
        if (taRef.current && overlayRef.current) {
            overlayRef.current.scrollTop = taRef.current.scrollTop;
            overlayRef.current.scrollLeft = taRef.current.scrollLeft;
        }
    }, []);

    // textarea + overlay 共享的样式：保证字符尺寸完全一致
    const SHARED_TEXT_CLS =
        'w-full px-2 py-1.5 pr-8 text-xs leading-5 font-sans whitespace-pre-wrap break-words';

    return (
        <div className="relative">
            {/* 2026-06-05 修复（文字压图）：overlay+textarea 收进一个仅 textarea 高度的内层 relative 盒子，
                避免 overlay 的 absolute inset-0 把高度撑到包含下方 tokensRow，导致长提示词高亮文字
                溢出渲染、压在媒体缩略图上。tokensRow / AI 改写 modal / @-popover 移到内层盒子外作兄弟节点。 */}
            <div className="relative">
            {/* mask overlay（高亮层）：z-0、pointer-events:none，渲染同 prompt 字符的高亮版本 */}
            {/* 2026-05-21 修复：overlay 的 text-color 必须跟 textarea 互斥
                （任意时刻只有一层显字），否则要么文字消失要么双层叠出重影。
                - 非 composing：textarea text-transparent → overlay text-slate-100（用户看到的字其实是 overlay 渲染的，token 段被 TOKEN_KIND_CLASS 自带的颜色覆盖）
                - composing 中（中文输入候选）：textarea 切 text-slate-100 → overlay 切 text-transparent，避免双字 */}
            <div
                ref={overlayRef}
                aria-hidden="true"
                className={
                    `${SHARED_TEXT_CLS} absolute inset-0 m-0 rounded ` +
                    'bg-n30 border border-transparent select-none ' +
                    `${composing ? 'text-transparent' : 'text-n800'} ` +
                    'overflow-hidden pointer-events-none'
                }
                style={{ zIndex: 0 }}
            >
                {segments.length === 0 ? '\u200b' : segments.map((seg, i) => {
                    if (seg.type === 'token') {
                        return (
                            // 2026-06-05：不加 px-/border —— 必须与 textarea 逐字符等宽，否则光标漂移、高亮框错位。
                            <span
                                key={`tok-${i}`}
                                className={`rounded-sm ${TOKEN_KIND_OVERLAY_CLASS[seg.kind]}`}
                            >
                                {seg.text}
                            </span>
                        );
                    }
                    return <span key={`txt-${i}`}>{seg.text}</span>;
                })}
                {/* 末尾占位换行：确保 overlay 高度跟得上 textarea（textarea 末尾换行的视觉行） */}
                {promptText.endsWith('\n') && '\u200b'}
            </div>
            <textarea
                ref={taRef}
                value={value.prompt}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                placeholder={placeholder || '描述动作、镜头、声音；@ 选素材...'}
                disabled={disabled}
                rows={rows ?? 3}
                className={
                    `${SHARED_TEXT_CLS} relative bg-transparent border border-n40 rounded ` +
                    `${composing ? 'text-n800' : 'text-transparent'} ` +
                    'caret-n800 placeholder:text-n100 resize-none ' +
                    // 2026-06-05 修复（紫色框错位）：focus 不再用 ring（ring 画在边框外、和 overlay/
                    // textarea 的 inset-0 边框对不齐，长提示词时看起来像一个错位的紫色框），
                    // 改为只变边框色，边框与 overlay 像素重合，不再溢出。
                    'focus:outline-none focus:border-primary'
                }
                style={{ zIndex: 1 }}
            />
            {/* 2026-05-20 (Bug 2)：右上角 ✨ AI 改写按钮
                2026-05-21 修复：必须 `z-10` —— textarea 设了 zIndex:1 且 w-full（pr-8 仅影响
                内边距，不影响 click target），物理上覆盖按钮右上角区域；button 默认 z-auto
                会被 textarea 拦截所有点击（视觉看得到、点不动）。*/}
            <button
                type="button"
                onClick={() => setRewriteOpen(true)}
                disabled={disabled || !(value.prompt || '').trim()}
                className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center text-primary hover:text-primary-hover bg-n0 hover:bg-primary-light border border-primary rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="AI 改写视频提示词"
                aria-label="AI 改写"
            >
                <Sparkles size={13} />
            </button>
            </div>{/* /内层 relative 盒子（overlay + textarea + ✨） */}
            <AIRewritePromptModal
                open={rewriteOpen}
                originalPrompt={value.prompt || ''}
                onAccept={(newPrompt) => {
                    onChange({ ...value, prompt: newPrompt });
                    setRewriteOpen(false);
                }}
                onClose={() => setRewriteOpen(false)}
            />
            {/* 2026-05-20 (Bug 4)：textarea 下方胶囊清单——hover 弹大图、点击 lightbox、X 删除。 */}
            {!hideTokensRow && (
                <SeedanceMentionTokensRow
                    value={value}
                    onChange={onChange}
                    onPreview={onPreviewMedia}
                    disabled={disabled}
                    openUpward={openUpward}
                />
            )}
            {/* 2026-06-05：@ 候选弹层锚到编辑器底部的零高 anchor —— 向下(top-full)落在编辑器下方(默认)，
                向上(bottom-full)从编辑器底部往上长，覆盖在 textarea 上方且不被弹窗底裁切。 */}
            <div className="relative">
            {open && !composing && (
                <div
                    role="listbox"
                    aria-label="mention candidates"
                    className={
                        'absolute left-0 right-0 max-h-64 overflow-y-auto bg-n0 border border-n40 rounded shadow-bottom z-50 ' +
                        (openUpward ? 'bottom-full mb-1' : 'top-full mt-1')
                    }
                >
                    <input
                        autoFocus
                        type="text"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setActiveIdx(0); }}
                        onKeyDown={e => handleKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>)}
                        placeholder="搜索..."
                        className="w-full px-2 py-1 text-xs bg-n0 border-b border-n40 text-n700"
                    />
                    {Object.entries(filtered).map(([group, items]) => (
                        <div key={group}>
                            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-n100 bg-n30">
                                {GROUP_LABELS[group] || group}
                            </div>
                            {items.map((c) => {
                                const idx = flatList.indexOf(c);
                                return (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => handleSelect(c)}
                                        className={`flex items-center gap-2 w-full text-left px-2 py-1 text-xs hover:bg-n20 ${
                                            idx === activeIdx ? 'bg-n20' : ''
                                        }`}
                                    >
                                        {c.thumbnailUrl && (
                                            <img src={c.thumbnailUrl} alt="" className="w-6 h-6 object-cover rounded" />
                                        )}
                                        <span className="text-n700">{c.label}</span>
                                        <span className="ml-auto text-[10px] text-n100">{c.kind}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    {flatList.length === 0 && (
                        <div className="px-2 py-2 text-[11px] text-n100">无匹配</div>
                    )}
                </div>
            )}
            </div>{/* /@ 候选弹层底部 anchor */}
        </div>
    );
};
