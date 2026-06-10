// new_html/components/AIRewritePromptModal.tsx
//
// 2026-05-20 (Bug 2)：AI 改写视频提示词模态框。
//
// UI 流程：
//   1. 顶部：原 prompt（只读，方便对照）
//   2. 改写模式下拉：5 个预设 + "自定义..."；选自定义才出 instruction textarea
//   3. 后端下拉：geminiProxy / geminiSDK / deepseek
//   4. [生成] 按钮 → 异步调用 rewritePrompt → 结果区可编辑
//   5. [接受] 把结果回写到原 textarea / [重新生成] / [取消]
//
// 不依赖外部 modal 库，复用 Tailwind + lucide-react 图标。
import React, { useEffect, useState } from 'react';
import { X, Sparkles, Loader2, RotateCcw, Check } from 'lucide-react';
import {
    rewritePrompt,
    REWRITE_PRESETS,
    REWRITE_BACKEND_LABELS,
    type RewriteBackend,
} from '../services/promptRewriter';

export interface AIRewritePromptModalProps {
    open: boolean;
    originalPrompt: string;
    /** 用户接受改写时回调，参数为新的 prompt 文本。 */
    onAccept: (newPrompt: string) => void;
    onClose: () => void;
    /** 默认后端；用户可在 modal 里下拉切换。 */
    defaultBackend?: RewriteBackend;
}

const PRESET_CUSTOM = '__custom__';

export const AIRewritePromptModal: React.FC<AIRewritePromptModalProps> = (p) => {
    const [presetId, setPresetId] = useState<string>(REWRITE_PRESETS[0]?.id ?? PRESET_CUSTOM);
    const [customInstr, setCustomInstr] = useState('');
    const [backend, setBackend] = useState<RewriteBackend>(p.defaultBackend ?? 'geminiProxy');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 打开时重置
    useEffect(() => {
        if (p.open) {
            setPresetId(REWRITE_PRESETS[0]?.id ?? PRESET_CUSTOM);
            setCustomInstr('');
            setResult('');
            setError(null);
            setLoading(false);
        }
    }, [p.open]);

    // Esc 关闭
    useEffect(() => {
        if (!p.open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) p.onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [p.open, p.onClose, loading]);

    if (!p.open) return null;

    const isCustom = presetId === PRESET_CUSTOM;
    const presetMeta = REWRITE_PRESETS.find(x => x.id === presetId);
    const effectiveInstruction = isCustom ? customInstr.trim() : (presetMeta?.instruction ?? '');
    const canGenerate = !!p.originalPrompt.trim() && !!effectiveInstruction && !loading;

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        try {
            const out = await rewritePrompt({
                originalPrompt: p.originalPrompt,
                instruction: effectiveInstruction,
                backend,
            });
            if (!out.trim()) throw new Error('AI 返回空内容');
            setResult(out);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = () => {
        if (!result.trim()) return;
        p.onAccept(result);
        p.onClose();
    };

    return (
        <div
            role="dialog"
            aria-label="AI 改写视频提示词"
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => { if (!loading) p.onClose(); }}
        >
            <div
                /* 2026-06-05：弹窗整体放大约 3 倍（640px → min(96vw,1400px)）。
                   2026-06-05(2)：高度再放大 2 倍——文本框行数翻倍（原文/自定义/结果 8/4/16 → 16/8/32），max-h 96vh。 */
                className="w-[min(96vw,1400px)] max-w-full max-h-[96vh] bg-slate-900 border border-purple-700/40 rounded-xl shadow-2xl shadow-purple-950/40 overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-purple-900/40 bg-gradient-to-r from-purple-900/20 to-transparent">
                    <div className="flex items-center gap-2 text-sm text-purple-200">
                        <Sparkles size={14} className="text-purple-400" />
                        <span className="font-semibold">AI 改写视频提示词</span>
                    </div>
                    <button
                        type="button"
                        onClick={p.onClose}
                        disabled={loading}
                        aria-label="关闭"
                        className="p-1 text-slate-400 hover:text-purple-300 transition-colors disabled:opacity-30"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {/* 原 prompt */}
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">原提示词</div>
                        <textarea
                            value={p.originalPrompt}
                            readOnly
                            rows={16}
                            className="w-full px-2 py-1.5 bg-slate-950/60 border border-slate-700 rounded text-slate-300 text-xs resize-none"
                        />
                    </div>

                    {/* 模式 + 后端 */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">改写模式</div>
                            <select
                                value={presetId}
                                onChange={e => setPresetId(e.target.value)}
                                disabled={loading}
                                className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs focus:border-purple-500 focus:outline-none"
                            >
                                {REWRITE_PRESETS.map(opt => (
                                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                                ))}
                                <option value={PRESET_CUSTOM}>自定义...</option>
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">后端模型</div>
                            <select
                                value={backend}
                                onChange={e => setBackend(e.target.value as RewriteBackend)}
                                disabled={loading}
                                className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs focus:border-purple-500 focus:outline-none"
                            >
                                {(Object.keys(REWRITE_BACKEND_LABELS) as RewriteBackend[]).map(k => (
                                    <option key={k} value={k}>{REWRITE_BACKEND_LABELS[k]}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* 自定义指令 */}
                    {isCustom && (
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">自定义改写要求</div>
                            <textarea
                                value={customInstr}
                                onChange={e => setCustomInstr(e.target.value)}
                                disabled={loading}
                                placeholder="例如：把背景改成下雨；让动作更慢；翻译为英文..."
                                rows={8}
                                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs resize-none focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    )}

                    {/* 生成按钮 */}
                    <div>
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={!canGenerate}
                            className="w-full px-3 py-1.5 text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded inline-flex items-center justify-center gap-2 transition-colors"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    AI 改写中...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={14} />
                                    {result ? '重新生成' : '生成改写'}
                                </>
                            )}
                        </button>
                    </div>

                    {/* 错误 */}
                    {error && (
                        <div className="p-2 bg-red-900/30 border border-red-700/40 rounded text-[11px] text-red-300">
                            ✗ {error}
                        </div>
                    )}

                    {/* 结果 */}
                    {result && (
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">改写结果（可编辑）</div>
                            <textarea
                                value={result}
                                onChange={e => setResult(e.target.value)}
                                rows={32}
                                className="w-full px-2 py-1.5 bg-slate-800 border border-purple-700/40 rounded text-slate-200 text-xs resize-none focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    )}
                </div>

                {/* 底部按钮 */}
                <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-purple-900/40">
                    <button
                        type="button"
                        onClick={p.onClose}
                        disabled={loading}
                        className="px-3 py-1 text-xs text-slate-300 hover:text-slate-200 disabled:opacity-30"
                    >
                        取消
                    </button>
                    {result && (
                        <button
                            type="button"
                            onClick={() => setResult('')}
                            disabled={loading}
                            className="px-3 py-1 text-xs text-slate-300 hover:text-slate-200 disabled:opacity-30 inline-flex items-center gap-1"
                        >
                            <RotateCcw size={12} />
                            清空结果
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleAccept}
                        disabled={!result.trim() || loading}
                        className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded inline-flex items-center gap-1"
                    >
                        <Check size={12} />
                        接受并替换
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AIRewritePromptModal;
