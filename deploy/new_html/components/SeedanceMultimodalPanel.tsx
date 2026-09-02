import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Upload, X, AlertCircle, Info, Plus, Maximize2, Volume2, Loader2 } from 'lucide-react';
import { uploadAudio, uploadImage, uploadVideoFile } from '../services/videoMediaService';
import {
    getModelDisplayName,
    type SeedanceMediaInput,
    type SeedanceMediaRole,
    type SeedanceParams,
} from '../services/videoModelService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { SeedanceMentionPromptEditor } from './SeedanceMentionPromptEditor';
import { SeedanceAssetPickerModal } from './SeedanceAssetPickerModal';

interface Props {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    disabled?: boolean;
    candidates: SeedanceAssetCandidate[];
    autoOpenMentionOnMount?: boolean;
    /** 2026-05-20 (Bug 4)：mention token 缩略图点击时打开外层 lightbox。 */
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    /** 从上一条已生成视频提取原声，作为当前卡片 reference_audio。 */
    onUsePreviousVideoAudio?: () => void;
    previousVideoAudioBusy?: boolean;
    audioReferenceNotice?: string;
    supportsMultimodal?: boolean;
}

// Role options split per mode (Issue 3/4):
// - 全能参考 (reference): image acts as a generic reference; first/last-frame disallowed
// - 首尾帧 (first_last):  exactly first_frame / last_frame; reference_image disallowed
const ROLE_OPTIONS_REFERENCE: { value: SeedanceMediaRole | ''; label: string }[] = [
    { value: '', label: '无角色' },
    { value: 'reference_image', label: '参考图' },
];
const ROLE_OPTIONS_FIRST_LAST: { value: SeedanceMediaRole | ''; label: string }[] = [
    { value: 'first_frame', label: '首帧' },
    { value: 'last_frame', label: '尾帧' },
];

const RATIO_OPTIONS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p'] as const;

const SEEDANCE_TIER_LABELS: Record<SeedanceParams['sub_model'], string> = {
    agent_plan: getModelDisplayName('Seedance15'),
    standard: getModelDisplayName('Seedance2'),
    fast: getModelDisplayName('Seedance2Fast'),
    mini: getModelDisplayName('Seedance2Mini'),
};

export const SeedanceMultimodalPanel: React.FC<Props> = ({
    value,
    onChange,
    disabled,
    candidates,
    autoOpenMentionOnMount,
    onPreviewMedia,
    onUsePreviousVideoAudio,
    previousVideoAudioBusy,
    audioReferenceNotice,
    supportsMultimodal = true,
}) => {
    const [uploadBusy, setUploadBusy] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [promptModalOpen, setPromptModalOpen] = useState(false);
    const imgInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    const images = value.media_inputs.filter(m => m.kind === 'image');
    const videos = value.media_inputs.filter(m => m.kind === 'video');
    const audios = value.media_inputs.filter(m => m.kind === 'audio');

    // Issue 3/4: derive mode from existing media_inputs[].role (no new persisted field).
    const isFirstLastMode = images.some(m => m.role === 'first_frame' || m.role === 'last_frame');
    const mode: 'reference' | 'first_last' = isFirstLastMode ? 'first_last' : 'reference';
    const effectiveMode: 'reference' | 'first_last' = supportsMultimodal ? mode : 'first_last';

    const setMode = useCallback((newMode: 'reference' | 'first_last') => {
        if (newMode === mode) return;
        const nextInputs = value.media_inputs.map((m, idx) => {
            if (m.kind !== 'image') return m;
            if (newMode === 'first_last') {
                // 1st image -> first_frame, 2nd -> last_frame, 3+ cleared (panel will grey them)
                const imgIdx = value.media_inputs.slice(0, idx).filter(x => x.kind === 'image').length;
                if (imgIdx === 0) return { ...m, role: 'first_frame' as SeedanceMediaRole };
                if (imgIdx === 1) return { ...m, role: 'last_frame' as SeedanceMediaRole };
                return { ...m, role: undefined };
            }
            return { ...m, role: 'reference_image' as SeedanceMediaRole };
        });
        onChange({ ...value, media_inputs: nextInputs });
    }, [mode, value, onChange]);

    // 全能参考(r2v) 仅 Seedance 2.0 系列支持；Seedance15 / Agent Plan 走首尾帧兼容。
    const omniEnabled = supportsMultimodal;
    useEffect(() => {
        if (!omniEnabled && mode === 'reference' && images.length > 0) {
            setMode('first_last');
        }
    }, [omniEnabled, mode, images.length, setMode]);

    const validation = useMemo(() => {
        const hasFirst = images.some(m => m.role === 'first_frame');
        const hasLast = images.some(m => m.role === 'last_frame');
        const hasRef = images.some(m => m.role === 'reference_image');
        if ((hasFirst || hasLast) && hasRef) return { ok: false, msg: '首尾帧 与 参考图 不能同时使用' };
        if (hasLast && !hasFirst) return { ok: false, msg: '首帧 / 尾帧 必须成对出现' };
        if (value.media_inputs.length === 0 && !value.prompt.trim()) return { ok: false, msg: '至少提供 1 个媒体或非空提示词' };
        if (audios.length > 0 && images.length === 0 && videos.length === 0) {
            return { ok: false, msg: '不可单独输入音频，必须至少包含 1 张图或 1 段视频' };
        }
        if (!omniEnabled && (videos.length > 0 || audios.length > 0)) {
            return { ok: false, msg: '兼容通道不支持视频/音频参考输入' };
        }
        if (!omniEnabled && images.length > 2) {
            return { ok: false, msg: '兼容通道最多支持 2 张图片（单图或首尾帧）' };
        }
        if ((value.sub_model === 'fast' || value.sub_model === 'mini') && value.resolution === '1080p') {
            return { ok: false, msg: `${SEEDANCE_TIER_LABELS[value.sub_model]}不支持 1080p` };
        }
        if (images.length > 9) return { ok: false, msg: '图片最多 9 张' };
        if (videos.length > 3) return { ok: false, msg: '参考视频最多 3 个' };
        if (audios.length > 3) return { ok: false, msg: '参考音频最多 3 个' };
        return { ok: true, msg: '' };
    }, [images, videos, audios, value.media_inputs, value.prompt, value.sub_model, value.resolution, omniEnabled]);

    const patch = useCallback((p: Partial<SeedanceParams>) => onChange({ ...value, ...p }), [value, onChange]);

    const addMedia = useCallback((m: SeedanceMediaInput) => {
        onChange({ ...value, media_inputs: [...value.media_inputs, m] });
    }, [value, onChange]);

    const updateMediaRole = useCallback((idx: number, role: SeedanceMediaRole | '') => {
        const next = [...value.media_inputs];
        if (role) next[idx] = { ...next[idx], role: role as SeedanceMediaRole };
        else next[idx] = { ...next[idx], role: undefined };
        onChange({ ...value, media_inputs: next });
    }, [value, onChange]);

    const removeMedia = useCallback((idx: number) => {
        onChange({ ...value, media_inputs: value.media_inputs.filter((_, i) => i !== idx) });
    }, [value, onChange]);

    const onPickImages = useCallback(async (files: FileList | null) => {
        if (!files) return;
        setUploadBusy(true);
        try {
            for (const file of Array.from(files)) {
                if (images.length >= 9) break;
                const r = await uploadImage(file);
                addMedia({ kind: 'image', url: r.url || (r as any).storage_url });
            }
        } finally {
            setUploadBusy(false);
            if (imgInputRef.current) imgInputRef.current.value = '';
        }
    }, [images.length, addMedia]);

    const onPickAudios = useCallback(async (files: FileList | null) => {
        if (!files) return;
        setUploadBusy(true);
        try {
            for (const file of Array.from(files)) {
                if (audios.length >= 3) break;
                const r = await uploadAudio(file, 0, 5);
                addMedia({ kind: 'audio', url: r.url, role: 'reference_audio' });
            }
        } finally {
            setUploadBusy(false);
            if (audioInputRef.current) audioInputRef.current.value = '';
        }
    }, [audios.length, addMedia]);

    const onPickVideos = useCallback(async (files: FileList | null) => {
        if (!files) return;
        setUploadBusy(true);
        try {
            for (const file of Array.from(files)) {
                if (videos.length >= 3) break;
                const r = await uploadVideoFile(file);
                addMedia({ kind: 'video', url: r.url || (r as any).storage_url, role: 'reference_video' });
            }
        } finally {
            setUploadBusy(false);
            if (videoInputRef.current) videoInputRef.current.value = '';
        }
    }, [videos.length, addMedia]);

    return (
        <div className="space-y-3 bg-n0 border border-n40 rounded-md p-3 shadow-card">
            <div className="flex items-center justify-between border-b border-n40 pb-2">
                <div>
                    <div className="text-[11px] font-semibold text-primary tracking-wide">
                        {value.sub_model === 'agent_plan' ? 'Seedance 1.5 Pro · Agent Plan' : 'Seedance 2.0 多模态控制台'}
                    </div>
                    <div className="text-[9px] text-n100">
                        {effectiveMode === 'reference'
                            ? '全能参考：图片 0-9 · 视频 0-3 · 音频 0-3'
                            : '首尾帧：首/尾图；支持通道可发送参考配音，视频不发送'}
                    </div>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-primary text-primary bg-primary-light">
                    {SEEDANCE_TIER_LABELS[value.sub_model]}
                </span>
            </div>

            {/* Mode toggle (Issue 3/4) */}
            <div className="flex items-center gap-2 -mt-1">
                <span className="text-[10px] text-n300 shrink-0">模式</span>
                <div className="inline-flex rounded-md border border-n40 bg-n30 overflow-hidden text-[10px]">
                    {omniEnabled && (
                    <button
                        type="button"
                        aria-pressed={mode === 'reference'}
                        onClick={() => setMode('reference')}
                        disabled={disabled}
                        className={`px-2 py-1 transition-colors ${
                            mode === 'reference'
                                ? 'bg-primary text-white'
                                : 'text-n300 hover:text-primary'
                        }`}
                    >
                        全能参考
                    </button>
                    )}
                    <button
                        type="button"
                        aria-pressed={effectiveMode === 'first_last'}
                        onClick={() => setMode('first_last')}
                        disabled={disabled}
                        className={`px-2 py-1 transition-colors ${
                            effectiveMode === 'first_last'
                                ? 'bg-primary text-white'
                                : 'text-n300 hover:text-primary'
                        }`}
                    >
                        首尾帧{!omniEnabled && <span className="ml-1 opacity-70">（兼容通道）</span>}
                    </button>
                </div>
            </div>

            <section className="space-y-1">
                <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-medium text-n700">提示词</div>
                    <div className="flex items-center gap-1">
                        <span className="text-[9px] text-n100">可空，但必须有媒体或文本</span>
                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            disabled={disabled}
                            className="ml-1 p-1 text-n700 hover:text-n800 bg-n0 hover:bg-n20 rounded inline-flex items-center gap-0.5 text-[10px]"
                            title="从设计、素材、分镜及通用素材库添加"
                        >
                            <Plus size={11} /> 从库里添加
                        </button>
                        <button
                            type="button"
                            onClick={() => setPromptModalOpen(true)}
                            className="p-1 text-primary hover:text-white bg-n0 hover:bg-primary rounded inline-flex items-center gap-0.5 text-[10px]"
                            title="放大编辑提示词"
                        >
                            <Maximize2 size={11} /> 放大编辑
                        </button>
                    </div>
                </div>
                <SeedanceMentionPromptEditor
                    value={value}
                    onChange={onChange}
                    candidates={candidates}
                    disabled={disabled}
                    autoOpenOnMount={autoOpenMentionOnMount}
                    rows={5}
                    placeholder="描述动作、镜头、声音；@ 选素材..."
                    onPreviewMedia={onPreviewMedia}
                />
                <SeedanceAssetPickerModal
                    open={pickerOpen}
                    onClose={() => setPickerOpen(false)}
                    value={value}
                    onChange={onChange}
                    candidates={candidates}
                />
            </section>

            <section className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] font-medium text-n700">媒体输入</div>
                    <div className="text-[9px] text-n100">不可仅音频</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-n40 bg-n30 p-2 min-h-[122px]">
                        <div className="flex items-center justify-between text-[10px] text-n300 mb-1">
                            <span>图片 {images.length}/9</span>
                            <button
                                onClick={() => imgInputRef.current?.click()}
                                disabled={disabled || uploadBusy || images.length >= 9}
                                className="px-2 py-0.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded text-[10px]"
                            >
                                <Upload size={10} className="inline mr-1" />从外部添加
                            </button>
                            <input ref={imgInputRef} type="file" accept="image/*" multiple hidden
                                   onChange={e => onPickImages(e.target.files)} />
                        </div>
                        {images.length > 0 && (
                            <div className="grid grid-cols-3 gap-1 max-h-28 overflow-y-auto pr-0.5">
                                {value.media_inputs.map((m, i) => m.kind !== 'image' ? null : (
                                    <div key={i} className="relative bg-n0 rounded p-1">
                                        <img src={m.url} alt="" className="w-full h-12 object-cover rounded" />
                                        <select
                                            value={m.role || ''}
                                            onChange={e => updateMediaRole(i, e.target.value as SeedanceMediaRole | '')}
                                            disabled={disabled}
                                            className="w-full mt-1 bg-n0 border border-n40 text-[9px] text-n800 rounded px-1"
                                        >
                                            {(effectiveMode === 'first_last' ? ROLE_OPTIONS_FIRST_LAST : ROLE_OPTIONS_REFERENCE)
                                                .map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                        <button onClick={() => removeMedia(i)} disabled={disabled}
                                            className="absolute top-0 right-0 bg-danger text-white rounded p-0.5">
                                            <X size={8} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div
                        data-section="video"
                        data-greyed={effectiveMode === 'first_last' ? 'true' : 'false'}
                        className={`rounded-md border border-n40 bg-n30 p-2 min-h-[122px] ${
                            effectiveMode === 'first_last' ? 'opacity-30 pointer-events-none' : ''
                        }`}
                        title={effectiveMode === 'first_last' ? '首尾帧模式不发送视频给后端' : ''}
                    >
                        <div className="flex items-center justify-between text-[10px] text-n300 mb-1">
                            <span>视频 {videos.length}/3 {effectiveMode === 'first_last' && '(跳过)'}</span>
                            <button
                                onClick={() => videoInputRef.current?.click()}
                                disabled={disabled || uploadBusy || videos.length >= 3}
                                className="px-2 py-0.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded text-[10px]"
                            >
                                <Upload size={10} className="inline mr-1" />从外部添加
                            </button>
                            <input ref={videoInputRef} type="file" accept="video/*" multiple hidden
                                   onChange={e => onPickVideos(e.target.files)} />
                        </div>
                        {videos.length > 0 && (
                            <ul className="text-[10px] text-n700 space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                                {value.media_inputs.map((m, i) => m.kind !== 'video' ? null : (
                                    <li key={i} className="flex items-center justify-between bg-n0 rounded px-1 py-0.5">
                                        <span className="truncate">{(m.url || '').split('/').pop()}</span>
                                        <button onClick={() => removeMedia(i)} disabled={disabled}>
                                            <X size={10} className="text-danger" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div
                        data-section="audio"
                        data-greyed={audioReferenceNotice ? 'true' : 'false'}
                        className="rounded-md border border-n40 bg-n30 p-2 min-h-[122px]"
                        title={audioReferenceNotice || ''}
                    >
                        <div className="flex items-start justify-between gap-1 text-[10px] text-n300 mb-1">
                            <span className="pt-0.5">参考配音 {audios.length}/3</span>
                            <div className="flex flex-wrap justify-end gap-1">
                                {onUsePreviousVideoAudio && (
                                    <button
                                        type="button"
                                        onClick={onUsePreviousVideoAudio}
                                        disabled={disabled || previousVideoAudioBusy}
                                        className="px-1.5 py-0.5 bg-n0 hover:bg-success disabled:opacity-40 text-success hover:text-white border border-success/40 rounded text-[10px] inline-flex items-center gap-1"
                                        title="提取上一条已生成视频的原声作为参考配音"
                                    >
                                        {previousVideoAudioBusy ? <Loader2 size={10} className="animate-spin" /> : <Volume2 size={10} />}
                                        上一条原声
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => audioInputRef.current?.click()}
                                    disabled={disabled || uploadBusy || audios.length >= 3}
                                    className="px-1.5 py-0.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded text-[10px] inline-flex items-center gap-1"
                                >
                                    <Upload size={10} />从外部添加
                                </button>
                            </div>
                            <input ref={audioInputRef} type="file" accept="audio/*" multiple hidden
                                   onChange={e => onPickAudios(e.target.files)} />
                        </div>
                        {audioReferenceNotice && (
                            <div className="mb-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-1 text-[9px] leading-relaxed text-warning">
                                {audioReferenceNotice}
                            </div>
                        )}
                        {audios.length > 0 && (
                            <ul className="text-[10px] text-n700 space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                                {value.media_inputs.map((m, i) => m.kind !== 'audio' ? null : (
                                    <li key={i} className="flex items-center justify-between gap-1 bg-n0 rounded px-1 py-0.5">
                                        <span className="truncate" title={m.url}>{m.url.split('/').pop()}</span>
                                        <button onClick={() => removeMedia(i)} disabled={disabled}>
                                            <X size={10} className="text-danger" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </section>

            <section className="space-y-2 border-t border-n40 pt-2">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] font-medium text-n700">输出参数</div>
                    <div className="text-[9px] text-n100">核心参数默认展开</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <label className="space-y-1">
                        <span className="text-n300">分辨率</span>
                        <select
                            value={value.resolution || '720p'}
                            onChange={e => patch({ resolution: e.target.value as SeedanceParams['resolution'] })}
                            disabled={disabled}
                            className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-n700"
                        >
                            {RESOLUTION_OPTIONS.map(r => {
                                const disabledResolution = r === '1080p' && (value.sub_model === 'fast' || value.sub_model === 'mini');
                                return (
                                <option key={r} value={r} disabled={disabledResolution}>
                                    {r}{disabledResolution ? `（${SEEDANCE_TIER_LABELS[value.sub_model]}不支持）` : ''}
                                </option>
                                );
                            })}
                        </select>
                    </label>

                    <label className="space-y-1">
                        <span className="text-n300">画面比例</span>
                        <select
                            value={value.ratio || 'adaptive'}
                            onChange={e => patch({ ratio: e.target.value as SeedanceParams['ratio'] })}
                            disabled={disabled}
                            className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-n700"
                        >
                            {RATIO_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </label>

                    <label className="space-y-1">
                        <span className="text-n300">Seed</span>
                        <input
                            type="number"
                            value={value.seed ?? -1}
                            onChange={e => patch({ seed: parseInt(e.target.value, 10) })}
                            disabled={disabled}
                            className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-n700"
                        />
                    </label>

                    <label className="flex items-center gap-2 rounded border border-n40 bg-n30 px-2 py-1 text-n700">
                        <input
                            type="checkbox"
                            checked={!!value.watermark}
                            onChange={e => patch({ watermark: e.target.checked })}
                            disabled={disabled}
                        />
                        水印
                    </label>

                    <label className="flex items-center gap-2 rounded border border-primary bg-primary-light px-2 py-1 text-primary">
                        <input
                            type="checkbox"
                            checked={value.generate_audio !== false}
                            onChange={e => patch({ generate_audio: e.target.checked })}
                            disabled={disabled}
                        />
                        AI 配音
                    </label>

                    <label className="col-span-2 flex items-center gap-2 rounded border border-n40 bg-n30 px-2 py-1 text-n100 opacity-70" title="Seedance 2.0 系列不支持 camera_fixed">
                        <input type="checkbox" disabled />
                        固定镜头（仅 1.5pro）
                    </label>
                </div>
            </section>

            <section className="space-y-1">
                <div className="flex items-start gap-1 text-[10px] text-warning bg-warning/15 border border-warning/40 rounded px-1.5 py-1">
                    <Info size={10} className="mt-0.5 shrink-0" />
                    <span>Seedance 2.0 不支持直接上传含真人人脸的图/视频；请使用模型产物、预置虚拟人像或已授权真人素材。</span>
                </div>
                <div className="text-[9px] text-n100">
                    样片任务 ID / draft 仅 1.5pro 支持，2.0 系列不开放。
                </div>
            </section>

            {!validation.ok && (
                <div className="flex items-center gap-1 text-[10px] text-danger bg-r50 border border-danger/40 rounded px-1.5 py-1">
                    <AlertCircle size={10} />{validation.msg}
                </div>
            )}

            {/* 放大编辑提示词弹窗：图像与提示词在小面板里会重叠，这里提供大画布全面编辑 */}
            {promptModalOpen && ReactDOM.createPortal(
                <div
                    className="fixed inset-0 z-[9500] flex items-center justify-center bg-n900/50 backdrop-blur-sm p-4"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setPromptModalOpen(false); }}
                >
                    <div
                        role="dialog"
                        aria-label="放大编辑提示词"
                        /* 2026-06-05：放大编辑弹窗整体再放大 1.5 倍（max-w-3xl 768px → max-w-6xl 1152px，max-h 88vh → 94vh） */
                        className="w-full max-w-6xl max-h-[94vh] flex flex-col bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden"
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-n40">
                            <div>
                                <div className="text-sm font-semibold text-primary">提示词 · 放大编辑</div>
                                <div className="text-[10px] text-n100">@ 从库里添加 · ✨ AI 改写 · 全面修改提示词</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPromptModalOpen(false)}
                                className="p-1.5 rounded hover:bg-n20 text-n300 hover:text-n800 transition-colors"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <SeedanceMentionPromptEditor
                                value={value}
                                onChange={onChange}
                                candidates={candidates}
                                disabled={disabled}
                                rows={27}
                                openUpward
                                placeholder="描述动作、镜头、声音；@ 选素材..."
                                onPreviewMedia={onPreviewMedia}
                            />
                        </div>
                        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-n40">
                            <button
                                type="button"
                                onClick={() => setPromptModalOpen(false)}
                                className="px-4 py-1.5 text-xs rounded bg-primary hover:bg-primary-hover text-white transition-colors"
                            >
                                完成
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

export default SeedanceMultimodalPanel;
